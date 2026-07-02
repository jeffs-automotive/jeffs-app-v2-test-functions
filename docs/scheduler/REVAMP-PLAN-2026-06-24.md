# Scheduler revamp — research findings & plan (2026-06-24)

> Produced from a multi-agent investigation: a 12-agent deep audit of every scheduler subsystem +
> Telnyx/Resend external research + a prompts/categories/questions deep-dive, an adversarial completeness
> critic, and a 6-agent gap-closing pass that verified the critic's concrete findings against source.
> Every code claim below was checked against actual files. **Status: DRAFT pending Chris's decisions
> (see §10).**

---

## 1. Headline verdict — revamp, do NOT rebuild

**Recommendation: a targeted incremental revamp, not a ground-up rebuild.** The trial-and-error churn you
remember is concentrated in the *wizard flow/UI/LLM-layering* (the chat→wizard pivot). But the foundation
underneath is genuinely hardened and would be expensive and risky to throw away:

- Deterministic FSM with **one** transition choke point (`applyWizardTransition` → `apply_wizard_transition`
  atomic RPC), `customer_chat_sessions` row = source of truth.
- Atomic Tekmetric booking edge functions, CAS locks on holds (`claimed_by_session_id`), a two-branch
  hold-reaper cron, idempotent Resend sends, DST-aware slot math, RLS deny-all on sensitive tables,
  Pattern S/A/B confirmation flows, a 7-day appointments shadow sync.

The only ground-up **new** work is **comms** (Telnyx outbound senders + inbound webhook, Resend customer
emails, the reminder scheduler) and **loaner** — all additive at clean seams. Everything else is
delete-dead-code + targeted refactor + config/compliance activation.

A from-scratch rebuild would discard months of hardened, tested infrastructure to re-solve problems that
are already solved, and would *not* get you to "working and in use" faster.

---

## 2. The three big constraints you set — feasibility

### 2a. "Bypass the orchestrator" — mostly already done

- The **customer wizard already does not touch any LLM orchestrator** — it's deterministic Server Actions.
  Grep finds zero references from `orchestrator-mcp` to the wizard, `current_step`, or
  `customer_chat_sessions`.
- `orchestrator-mcp` is used by (a) the Claude Desktop **advisor** and (b) the **admin-app config writes**
  — and the admin path uses a *deterministic* tool registry (no LLM in the request path). **Keytag also
  depends on `orchestrator-mcp`**, so it cannot be deleted wholesale.
- What IS dead: the LLM-routing chain — `_shared/orchestrator.ts` (`runOrchestrator`, ~737 LOC),
  `orchestrator-router.ts`, `orchestrator-types.ts`, and `specialists/{scheduler,diagnostic,keytag}.ts`.
  **Zero live callers — pure deletion.** (Note: `specialists/diagnostic.ts` is *not* the keep-LLM; the live
  classifier is the separate `diagnose-concern.ts`.)

**Net:** delete the dead LLM-routing files; keep `orchestrator-mcp` (deterministic dispatch) alive for
keytag + admin. Migrating admin-app's scheduler config writes off `orchestrator-mcp` to direct Supabase
calls is *optional* and deferred (keytag keeps it alive anyway).

### 2b. "Only the categorization LLM" — exact mapping

**KEEP exactly one LLM:** `diagnose-concern.ts` — the 3-stage Haiku 4.5 classifier
(Stage 1 service/category match → Stage 2 subcategory via positive/negative examples + synonyms → Stage 3
29-slot fact extraction → a **pure-TS** deterministic gap-detect mapper that decides "need more
questions?"). It is gateway-routed, well-tested, ~88% eval accuracy, and already isolated behind
`run-diagnostics`. This is precisely "figure out if more questions are needed and what testing to
recommend." Preserve its public contract (`matched_kind`, `recommended_testing_service`,
`matched_subcategory_slug`, `unanswered_question_ids[]`).

**DROP the other two customer-facing LLMs** (both already fail-safe to raw text, so removal degrades prose,
not correctness):
- `summarize-concern.ts` (via `ensure-concern-summaries.ts`) → use the existing deterministic
  `fallbackSummary()`; `build-service-summary.ts` already falls back to raw `explanation_text`.
- `parse-customer-note.ts` → present the raw note as the preview; drop the rewrite/approve loop.

After this, `diagnoseConcern` is the **sole** LLM in the entire scheduler.

### 2c. Telnyx + Resend — what actually exists vs. what's missing

- **Telnyx send path EXISTS** (`sendViaTelnyx()` in `_shared/tools/scheduler-otp.ts` is a complete
  `POST /v2/messages` client with full 401/403/422/429 mapping), gated behind `SMS_PROVIDER` (default
  `stub`). The "stubbed" label in the architecture doc is **stale**.
- **OTP system is complete** (roll-your-own, sha256-hashed codes, attempts counter, rate limits,
  single-use). Keep it — do **not** adopt Telnyx Verify (it doesn't waive 10DLC and adds per-verification
  cost).
- **Resend transport** (`_shared/resend-client.ts`) is tested and live for internal transcript email.
- **MISSING (net-new):** A2P 10DLC registration; a Telnyx inbound/delivery webhook; SMS consent capture +
  ledger; booking-confirmation SMS+email; appointment-reminder SMS+email (scheduled); loaner messaging.

---

## 3. Prompts / categories / questions assessment (your explicit ask)

The concern catalog is **the strongest-engineered part of the scheduler** and is in good shape to be the
single LLM's input. 14 categories, **107** active subcategories, **729** questions, all read live on every
render. Question writing is consistently high quality (lay language, "Not sure"/"Haven't checked" escape
hatches, source citations). The gold standard is `warning_light` (12 subcats / 83 questions / 71%
`required_facts` coverage).

The real problems are **data/pipeline integrity, not question wording:**

| # | Issue | Severity | Fix |
|---|---|---|---|
| 1 | **Tire routing hole** — every tire concern (nail, bulge, flat, dry-rot, "just want new tires") routes to `tpms_testing`, a **$39.99 TPMS scan**, because no tire-repair/sales service exists. | High (customer-facing) | Add a tire-repair/tire-sales service; remap the 5 tire subcategories off `tpms_testing` (keep TPMS only for "low-pressure light"). |
| 2 | **Two noise subcategories have ZERO questions** (`exhaust_louder_or_rumbling`, `exhaust_manifold_tick_or_puff`) yet appear in the Stage-2 picker → recommendation with no clarification. | High | Author 7 questions each; add an invariant test: every active subcategory ≥1 question. |
| 3 | **Catalog seed tool is silently destructive** — re-running `generate-catalog-migration.ts` soft-deletes admin-added rows and **wipes all enrichment + `required_facts`** (it only re-seeds options/multi_select). The DB is the live source of truth. | High | Freeze/retire the generator as a one-time historical seed; document DB + admin MD uploads as canonical. |
| 4 | **14 `{cat}-guideline.md` files + `concern_category_guidelines` table are dead cruft** — they claim to feed the LLM "before the questions," but `diagnose-concern.ts` never reads them. | Medium | Wire into Stage 1/2 prompt *or* delete the tables/tools/docs + the misleading claim. |
| 5 | **`required_facts` coverage uneven** (29% for "other" → 71% for warning-lights). Low-coverage categories always over-ask. The 29-slot fact set has no slot for "other"-style facts (accident, sitting-duration), so "other" can never be gap-detected. | Medium | Re-run the per-category authoring pass for brakes/leak/smoke/other/vibration; add ExtractedFacts slots for "other". |
| 6 | **Eval fixture gaps** — `scripts/concerns.json` has zero steering/tires cases, predates the 3-stage refactor, and only checks Stage-1 category (not subcategory / unanswered-ids). | Medium | Add steering/tires/safety cases; assert Stage-2 + the deterministic mapper output; re-baseline to 107/729. |
| 7 | **Stage-1 near-duplicates** — `coolant_leak_testing` vs `_euro` (no make signal at Stage 1); `warning_light_general` can beat the correct specific light service. | Medium | Collapse the Euro split into a post-pick price modifier; demote `warning_light_general` to last-resort. |
| 8 | **Routine-services polish** — `oil_change` blank price; `alignment` has 3 "alignemnt" typos + pricing prose in the customer caption; `tire_rotation` description is "(none)"; routine-vs-testing price mismatches. | Low | Copy/price cleanup. |

**Important coupling to the orchestrator decision:** the live editor for catalog *enrichment*
(descriptions/examples/synonyms/`required_facts`/service-map) runs through `orchestrator-mcp`'s
deterministic dispatch. Keeping `orchestrator-mcp` alive (which we are, for keytag) preserves the catalog
editor — no re-homing needed.

---

## 4. Comms plan

### 4a. Telnyx A2P 10DLC (verified against official Telnyx + CTIA sources)

- **One Low-Volume Mixed campaign (~$1.50/mo) on one number** legally covers OTP + confirmations +
  reminders (+ loaner later). Brand reg ~$4 one-time; campaign review $15; per-SMS carrier fee ~$0.003.
  T-Mobile throughput is **brand-level** (max 5 campaigns/brand), so a second campaign adds zero capacity
  — and one blanket STOP silencing all message types is the correct behavior for one customer
  relationship. A 1–2 week carrier lead time makes registration the **longest-lead blocker — start it
  first.**
- **The binding compliance constraint** (per the critic) is *use-case consistency*: every message body must
  be transactional, and the registration must declare **Mixed** (not a single transactional use case).
  Author the opt-in CTA, opt-in description, and 2–3 sample messages from one canonical source so they
  match the wizard verbatim (mismatch is the #1 rejection cause).

### 4b. SMS consent — HARD P0 go-live blocker (newly confirmed)

There is **no consent capture anywhere today** — `PhoneNameCard` shows only a passive footnote, and nothing
is stored. And the OTP code comment claiming a "10DLC OTP exemption from STOP-handling" is **factually
wrong** (CTIA requires all A2P streams to honor STOP/HELP and to have captured opt-in). Required:

1. **Wizard consent control** on `PhoneNameCard` — explicit, unchecked-by-default, label = the registered
   CTA copy (program name, message types, "frequency varies", "msg & data rates may apply", "Reply STOP /
   HELP", Terms + Privacy URLs). Block submit until checked; capture the exact rendered string + version.
2. **`sms_consents` ledger** (provable proof): `phone_e164`, `consent_status`, `consent_acquired_at`,
   `acquisition_medium`, `cta_text` (verbatim), `cta_version`, `consenter_identity`, `consent_ip`,
   `user_agent`, `revoked_at`, `revoke_source`. Deny-all RLS. Write it *before* `sendOtp`; gate all sends
   on an active, non-revoked consent.
3. **STOP/HELP**: enable Telnyx profile-level Advanced Opt-In/Out + a HELP response; the `telnyx-webhook`
   consumes `opt_out` and flips the ledger to revoked. The OTP body may legitimately omit the STOP footer
   *only because* the profile auto-handles it — fix the wrong code comment.

### 4c. Confirmation + reminder emails (Resend)

- Reuse the tested `_shared/resend-client.ts` for all email; migrate the two inline-fetch callers
  (`transcript-dispatcher`, `scheduler-manual-review-email`) onto it.
- Customer-facing **confirmation** (immediate, fired from the confirm path) + **reminder** templates via
  React Email (Node-rendered). **SMS-primary, email-optional** (new customers may not give an email;
  returning customers' email comes from Tekmetric).
- Send from a verified **sending subdomain** with SPF/DKIM/DMARC (the apex has Google Workspace MX — apex
  sending will fail). Add a `resend-webhook` for bounce/complaint suppression.

### 4d. Reminders — recipient resolution + freshness (the two real gaps, now designed)

- **Recipient data:** the `appointments` shadow has **no phone/email**. Fix = denormalize
  `phone_e164` + `email` onto `appointments`, populated by the sync cron: for app-booked rows, join
  `customer_chat_sessions.appointment_id` (OTP-verified `phone_e164`); for the rest, the already-wired
  Tekmetric `getCustomerById()` (returns phone[] + email), batched + fail-soft. PII stays **plaintext**
  to match the entire codebase (encryption is aspirational/deferred — see §6).
- **Freshness (~10-min worst-case stale window):** two guards on the 2h reminder — (1) a local state gate
  (`deleted_at IS NULL`, status ∉ {CANCELED, NO_SHOW}, start_time still ~2h out) and (2) a JIT
  `GET /appointments/{id}` re-check immediately before send (the primitive already exists in
  `confirmAppointment`). Idempotency ledger keyed on `(appointment_id, reminder_kind)`. Sweeper cron every
  5 min, `BEGIN…EXCEPTION → scheduler_error_log`.
- **Quiet hours:** gate non-OTP sends to 8am–9pm — **recipient-local** per TCPA (reconcile the
  shop-local vs recipient-local wording; pick conservative). DST-aware library + tests.
- **Double-notify guards:** a shared sent-ledger with a DB-level UNIQUE / `ON CONFLICT DO NOTHING` (not
  check-then-insert) across SMS+email per kind.
- **⚠ Double-messaging risk:** if Tekmetric's own "Automatic Messaging for Appointments" is enabled, our
  reminders duplicate Tekmetric's. **Chris must confirm the shop toggle** (decision in §10).

### 4e. Loaner — net-new capture, decoupled from launch (newly confirmed)

The assumed trigger does **not exist**: the scheduler never writes `ride_option`; "yellow" is the keytag
color convention; and whether Tekmetric accepts `rideOption` on write is **unverified** (needs a probe).
Loaner SMS is therefore a **new capture feature**: a wizard ride/loaner question → persisted to the session
+ local `appointments.ride_option` (with a real CHECK) → staff visibility via color+title → *best-effort*
Tekmetric `rideOption` only after a `tekmetric-api-testing` probe confirms it persists. **Recommend
deferring loaner SMS to a fast-follow** so OTP+confirmation+reminder ship without a blocked dependency.

---

## 5. Verified gap resolutions (the "iterate again" pass)

| Gap | Verdict | Action |
|---|---|---|
| Reminder recipients | CONFIRMED — no contact on `appointments`; resolvable via session join + Tekmetric `getCustomerById` | Denormalize contact columns; sequence before the reminder cron |
| Loaner trigger | Assumption FALSE — no signal exists; Tekmetric write unverified | Net-new capture; defer; add a Tekmetric probe |
| `appointment_concerns` | CONFIRMED dead (only a pgTAP test writes it) | DROP table + index + types + test refs; fix stale comment |
| SMS consent | CONFIRMED — none exists; OTP "exemption" comment wrong | P0 blocker: consent UI + ledger + STOP/HELP + webhook |
| PII encryption | Premise FALSE — pgcrypto rule is aspirational, implemented nowhere | Plaintext (match codebase); DON'T add encryption scope; redact OTP body |
| Reminder freshness | Real but bounded (~10 min); Tekmetric appt webhooks exist but only log | State-gate + JIT re-check + idempotency ledger; confirm Tekmetric auto-messaging |

---

## 6. Things that are NOT problems (scope guards)

- **PII encryption** is *not* a blocker — the repo stores all customer phone/name as plaintext today; the
  pgcrypto `_enc/_hash` rule in `cross-module-anchors.md` is aspirational and implemented by no table. The
  SMS tables should be plaintext to match. (One narrow note: don't store the live OTP code verbatim in an
  `sms_messages.body`.)
- **Multi-tenant/shops table** is *not* launch-critical — Jeff's runs as shop 7476; a real `shops` table +
  removing the `America/New_York` hardcodes is a nice-to-have, deferred (keep `shop_id INTEGER`).

---

## 7. Phased plan

> Start **10DLC registration in parallel on day one** (1–2 week carrier lead).

**Phase 0 — Dead-code purge + doc reconciliation + catalog hygiene (low risk)**
- Delete the dead LLM-routing chain (`orchestrator.ts`, `orchestrator-router.ts`, `orchestrator-types.ts`,
  `specialists/*`). Drop `summarizeConcern` + `parseCustomerNote` (+ their tests/telemetry).
- Execute the 2026-06-13 cleanup (sweep stale `append-bubble`/two-stage comments; repoint e2e `/book-v2`→`/book`); retire the `chat-store.ts` vestige.
- `DROP TABLE appointment_concerns` (+ index, types, pgTAP refs, stale comment).
- Freeze/retire `canonical-concern-catalog.ts`; document the DB as catalog source of truth.
- Reconcile the architecture doc's stale facts (AI_GATEWAY live, OTP code-ready, 6 crons, 107 subcats,
  `scheduler_subcategory_service_map` is a column, 3-stage classifier).
- **Tekmetric `rideOption` probe** (extend `tekmetric-api-testing`) to settle loaner feasibility.
- **LLM P0 fixes (free / high-leverage, see §11):** wire the confidence gate into `run-diagnostics.ts`;
  migrate `output_format` → `output_config.format` (GA); fix the Haiku 4.5 4,096-token caching threshold +
  the stale "2048" comment.

**Phase A — LLM reliability hardening (the launch gate Chris asked for; see §11)**
- Rebuild `concerns.json` into a real labeled eval (per-stage ground truth: 14 category keys, 107
  subcategory slugs, 29 fact slots; ~150–300 cases; add steering/tires/HVAC/electrical + near-miss pairs).
- Make `eval-diagnose-concern.ts` **auto-grade** (Stage-1 F1, Stage-2 on correct-Stage-1, Stage-3 slot
  precision/recall, over-ask rate, and a misroute-safety assertion).
- Backfill `required_facts` on the 355/729 empty questions (or ratify as always-ask).
- Measure the real per-stage baseline + mobile p95 latency; collapse Stage-1+Stage-2 if p95 is too high.
- **Gate launch on the two-part bar** (§11): reliability bar AND ~100% safe-degradation bar, tested.

**Phase 1 — Comms schema foundation**
- `sms_messages`, `sms_consents`, `telnyx_webhook_events` (idempotent on `data.id`), the
  notification/reminder ledger, and contact columns on `appointments`. All deny-all RLS, `shop_id INTEGER`,
  plaintext PII, pgTAP row-count tests. New session columns go into `apply_wizard_transition` (high-touch).

**Phase 2 — Shared transports + inbound webhook + consent**
- Extract `sendViaTelnyx` → `_shared/telnyx-client.ts` (stubbed-fetch unit tests). Migrate the two inline
  Resend callers onto `resend-client.ts`.
- Build `telnyx-webhook` (Ed25519 verify-before-parse, idempotent, delivery receipts → status, STOP/HELP →
  consent revoke). Apply `withSentryScope` to the 3 customer-facing scheduler-direct fns + both webhooks.
- **Consent capture UI + ledger live before any real send** (P0).

**Phase 3 — Senders + reminder scheduler**
- Flip OTP to live Telnyx (config only). Booking confirmation SMS+email from the confirm path
  (idempotent). Reminder sweeper cron (recipient resolution + freshness guards + quiet hours + idempotency
  ledger). UI truthfulness (consent line; "we'll text/email you" copy fires only when sends actually occur).

**Phase 4 — Refactor + test hardening + catalog fixes**
- Split `get-current-card.ts` (1255 LOC) + `submit-summary.ts` (914 LOC); extract the duplicated JSONB
  row-parsers. Re-enable real E2E (TEST-3, via Vercel Dashboard env). Unit tests for the branch-heavy
  untested actions + new senders + cron fns. Catalog fixes: tire service, the two empty noise subcats,
  `required_facts` coverage, the catalog invariant test, eval-fixture expansion.

**Phase 5 — Go-live activation + cutover**
- 10DLC brand+campaign active with the FROM number; secrets confirmed (`TELNYX_*`, `RESEND_API_KEY`,
  `AI_GATEWAY_API_KEY`); Resend sending subdomain verified; **bot-traffic gating** (SEC-7) on
  session-create + OTP + `/book` before public cutover; SEC-8 beacon HMAC; confirm production Tekmetric
  (shop 7476) target is deliberate; DNS for `appointments.jeffsautomotive.com`; first real end-to-end
  OTP + confirmation; go-live checklist.

**Phase 6 (fast-follow) — Loaner messaging** + optional admin-app transport migration + optional shops
table / multi-shop.

---

## 8. Go-live blockers (consolidated)

1. **A2P 10DLC brand + Mixed campaign approved** with the FROM number (longest lead — start first).
2. **SMS consent capture + ledger live before the first send** (TCPA/CTIA + registration approval).
3. **`telnyx-webhook`** for delivery receipts + STOP/HELP opt-out sync (without it, sends silently 403
   after a STOP).
4. Confirm live secrets: `TELNYX_API_KEY` + `TELNYX_FROM_NUMBER` (+ `MESSAGING_PROFILE_ID`),
   `SMS_PROVIDER=telnyx`, **`AI_GATEWAY_API_KEY`** (a missing key silently null-matches every concern →
   everyone routed to handoff — also fix this fail-open), `RESEND_API_KEY`.
5. Resend **sending subdomain** verified (apex has Google MX).
6. **Bot-traffic gating** before public cutover (the unauthenticated session-create path is heavily abused
   today; the OTP endpoint is otherwise a money-pump).
7. **Confirm Tekmetric "Automatic Messaging" toggle** to avoid double-texting customers.
8. Real **E2E happy-path** green (TEST-3) before "actually using it."
9. Confirm the **production Tekmetric (shop 7476)** target is deliberate (edge fns already write live).

---

## 9. What Chris must provide (not decisions — inputs)

- Telnyx account funded; **EIN-based brand** (exact IRS legal name — #1 rejection cause); live HTTPS
  website + **Privacy Policy + Terms URLs**; the exact opt-in CTA copy + per-use-case sample messages.
- Whether the shop's 610 line is already a Telnyx long code or a new number must be bought.
- Approval of customer-facing email templates' brand voice + the SMS consent language.
- Confirmation (via Vercel/Supabase secrets — out of read-only scope) that `AI_GATEWAY_API_KEY`,
  `RESEND_API_KEY`, the `TELNYX_*` secrets are set, and that `SCHEDULER_TEST_PHONE_E164` is UNSET in prod.
- Approval for each deploy step + the production Tekmetric cutover.

---

## 10. Decisions

**Recorded 2026-06-24 (Chris):**
1. **Direction → incremental revamp** — *with the condition: prove a single LLM can carry the diagnose job.*
   (LLM-feasibility verdict + config + proof plan: see §11.)
2. **Reminder coverage → ALL appointments** — brings the Tekmetric contact-backfill into scope AND requires
   establishing an SMS-consent basis for staff-booked customers (see §12).
3. **Loaner SMS → deferred to fast-follow (Phase 6)** — net-new capture, out of the launch-critical path.
4. **Tekmetric auto-messaging → use ours, disable Tekmetric's** — our confirmation/reminders become the
   system of record; go-live task to disable Tekmetric's built-in appointment messaging.

**Still open (recommend-and-proceed unless you object):**

1. **Direction** — incremental revamp (recommended) vs full rebuild.
2. **Reminder coverage** — ALL appointments (needs Tekmetric contact backfill + a consent basis for
   staff-booked customers) vs app-booked-only (phone from session, simplest) vs SMS-app-booked-first then
   expand.
3. **Loaner SMS timing** — defer to a fast-follow (recommended) vs include in initial launch (requires a
   new wizard capture step + a Tekmetric write probe).
4. **Tekmetric auto-messaging** — is the shop's built-in appointment messaging on? Use our reminders and
   disable Tekmetric's, vs lean on Tekmetric's and skip ours.
5. **Reminder cadence/channels** — 24h + 2h, both SMS + email (recommended) vs a single offset / one
   channel.
6. Lower-stakes (recommend-and-proceed unless you object): one Mixed 10DLC campaign; freeze the catalog
   generator (DB canonical); SMS-primary/email-optional; DROP `appointment_concerns`; move AVM resolution
   into admin-app; defer the admin-app transport migration + shops table.

---

## 11. Can one LLM do this job? — verdict, config & proof plan

**Verdict: YES, with conditions.** This is not a "big" autonomous job — it's three *narrow*
constrained-classification calls (category ∈ ~20 keys, subcategory ∈ a shortlist, facts ∈ 29 typed slots),
each post-validated against the live catalog in TS, with the consequential "need more questions?" decision
made by a **pure-TS deterministic mapper** (no LLM). Error cost is bounded: a human advisor reviews every
recommendation, and every failure degrades to over-ask or advisor-handoff — **never an autonomous wrong
booking** (verified in `run-diagnostics.ts` + the `diagnose-concern.ts` fallbacks). Anthropic's own
classification cookbook reaches 95–97% F1 on a comparable ~10-class Haiku task, so the bar below is a
conservative floor.

The conditions are about **proving reliability and removing latent defects**, not model capability:

**P0 — free / highest-leverage**
- **Wire the confidence gate.** `run-diagnostics.ts` reads only the matched keys + `unanswered_question_ids`
  and *discards* all three `stageN_confidence` values — so a low-confidence-but-valid pick silently wins.
  Route low Stage-1/Stage-2 confidence to advisor-handoff. (Small models are *overconfident* → trust "low"
  as a strong escalate signal; never let "high" suppress the human net.)
- **Migrate the structured-outputs API** `output_format` + `betas:[…]` → `output_config.format` (now GA).
- **Fix prompt caching** — Haiku 4.5's minimum cacheable block is **4,096 tokens** (not the 2,048 the comment
  claims); the Stage-1 static block is ~1,500–2,400 so caching silently never fires. Enlarge it or accept
  Stage-3-only caching. Verify `cache_read_input_tokens > 0`.

**Model config:** keep **all three stages on Haiku 4.5** (don't default to Sonnet — narrow task, 86% mobile,
Sonnet 3× cost for little gain on the easy majority). Temperature 0 + native constrained decoding stay.
Optional **async** Haiku→Sonnet escalation on the low-confidence tail *only after* the gate exists and *off*
the customer's critical path. Opus is offline-eval/judge only.

**Launch bar (both required, measured on the rebuilt auto-graded eval under production config):**
1. **Reliability** — Stage-1 category accuracy ≥ 90% (F1 ≥ 0.85); Stage-2 subcategory ≥ 85% on
   Stage-1-correct cases; Stage-3 per-slot **precision** ≥ 0.85 (precision-weighted: a wrongly-asserted fact
   *skips* a question — the expensive error; a missed fact just over-asks — cheap).
2. **Safe degradation** — ~100% of misroutes + induced stage failures land in over-ask/handoff (zero
   autonomous wrong bookings). *This is the bar that actually answers the question* — because error cost is
   bounded, the go/no-go hinges more on proving safe degradation than on the accuracy number.

**Debunked scares:** the Stage-3 schema does **not** hit the 16-union limit (3 unions; enums don't count),
and structured outputs are GA — neither blocks the revamp (one-time live smoke-test of the Stage-3 schema is
the only residual).

**Honest caveat:** Stage-2/Stage-3 accuracy is currently **unmeasured** — the verdict rests on the bounded-
error design + cookbook precedent, so the eval rebuild (Phase A) is what converts "fails safely" into
"works well *and* fails safely." That's why Phase A leads the build.

## 12. Staff-booked SMS consent (the "all appointments" dependency)

Appointment reminders are **transactional** under the TCPA → they need prior **express** consent (not the
*written* standard that applies to marketing). The existing service relationship + a customer-provided
number supports that basis, but post-*McLaughlin* (2025) "they gave us their number" is no longer
litigation-safe on its own.

- **Recommended basis:** a one-time **confirmed opt-in SMS** to staff-booked customers ("Reply YES to get
  Jeff's appointment reminders; STOP to opt out"), layered on the existing-relationship basis, with a logged
  CTIA opt-in record per number and STOP honored at any time.
- **Do not** rely on Tekmetric's `okForMarketing` field — it's a *marketing* flag (wrong scope) and is the
  only consent-adjacent field the documented Tekmetric customer object exposes.
- Keep reminder copy **strictly transactional** (no promo) to stay at the express-consent level; maintain a
  suppression list synced from the Telnyx opt-out webhook.
- **Reconcile/disable Tekmetric Automatic Messaging** — a Telnyx STOP is number-scoped and won't span
  Tekmetric's separate number, so two un-reconciled channels could text an opted-out customer (this is why
  "use ours, disable Tekmetric's" is the safe choice you already picked).
- The 10DLC campaign registration must describe both consent paths + STOP/HELP + a privacy-policy URL.

**Open sub-decisions for Chris:** (a) launch reminders on existing-relationship basis *now* (higher risk)
vs *after* building opt-in capture; (b) require an affirmative YES vs silent no-STOP opt-in; (c) confirm
disabling Tekmetric Automatic Messaging at shop 7476.

## Appendix — method & provenance

- Audit agents (12): wizard flow, wizard UI, LLM layer, edge/booking/comms, orchestrator+admin, DB schema,
  catalog/prompts/questions, tests/obs/backlog, comms current-state, + Telnyx-10DLC, Telnyx-loaner, Resend
  research. Then a synthesis agent + an adversarial completeness critic, then a 6-agent gap-closing pass.
- Raw structured outputs cached under `.tmp/wfout/` (gitignored). Canonical system map:
  `.claude/memory/scheduler/scheduler_system_architecture.md` (note: it carries several stale facts this
  plan corrects — see Phase 0).
