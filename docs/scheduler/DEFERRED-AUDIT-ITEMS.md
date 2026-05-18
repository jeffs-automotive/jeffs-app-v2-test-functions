# Scheduler audit — deferred items

Living backlog of audit findings that were INTENTIONALLY not applied
in the round that surfaced them. Each entry has:

- **Why deferred** — the coditional-intelligence call at the time.
- **When to revisit** — a trigger condition or future phase.
- **Where it came from** — round + audit stream so context is recoverable.

Created 2026-05-16 after a multi-round audit cycle (R3 → R6 + pattern-
extension waves). Maintained in-tree so future sessions / developers
pick it up. Add new entries as deferrals happen; remove entries when
the work lands.

---

## Catalog data

### CAT-1 · Subcategory seed for 13 concern categories — RESOLVED 2026-05-16

- **Status** — RESOLVED. All 13 concern categories now have real
  subcategories the LLM filter can match on:
  - `20260516210000_scheduler_brakes_subcategory_seed.sql` (brakes
    — 6 subs, 37 questions)
  - `20260516220000_scheduler_concern_seeds_part1.sql` (6 cats
    electrical/hvac/leak/noise/other/performance — 47 subs, 329
    questions)
  - `20260516220001_scheduler_concern_seeds_part2.sql` (7 cats
    pulling/smell/smoke/steering/tires/vibration/warning_light —
    52 subs, 363 questions)
  - Grand total: 105 subcategories + 729 questions across 13
    categories.
- **Follow-up tracking** — CAT-2 (option-array refinement per
  service-writer review).

### CAT-2 · Subcategory option-array refinement — **REOPENED 2026-05-18 (BLOCKER)**

- **What** — comprehensive rewrite of `concern_questions.options`
  needed. Direct DB audit on 2026-05-18 found **740 of 913
  active questions have generic `[Yes/No/Sometimes-Not-sure]`
  options** — including questions whose text clearly demands
  a different answer shape:
  - "Does the sound feel like it is coming from the front or
    rear? Left or right side?" (id 632, metallic_grinding) →
    needs `[Front, Rear, All four wheels, Not sure]` and
    should be multi-select (customer may pick rear + left).
  - "Did this sound start suddenly, or build up over several
    weeks?" (id 634, metallic_grinding) → needs `[Suddenly,
    Built up gradually, Not sure]`.
  - "Did the noise start suddenly, or has it been getting worse
    gradually?" (id 98), "Did this start suddenly, or has it
    been getting worse over weeks or months?" (id 458), etc.
    Pattern repeats across noise, performance, hvac,
    electrical, pulling, steering, tires, vibration,
    warning_light.
- **Root cause** — the initial seed wave (created
  2026-05-15T23:59 via an MD-upload tool that pre-dated the
  current migration set) heuristically wrote yes/no/sometimes
  for ANY question whose text didn't have an obvious enum.
  The 2026-05-16 brake-seed migration (and part1/part2)
  ON CONFLICT (shop_id, subcategory_id, question_text) DO
  NOTHING'd — so where it tried to insert the CORRECT row
  with matching text, it was skipped because the bad-options
  row was already there. The only rows the migration actually
  landed are typo-corrected duplicates (e.g., "louder" vs
  "loiuder").
- **Customer impact** — REPRODUCED LIVE 2026-05-18 by Chris
  in a real wizard run on production: the diagnostic flow
  asked "Does the sound feel like it is coming from the
  front or rear?" and offered only Yes/No/Sometimes chips.
  Customer cannot answer the question correctly.
- **Why STILL deferred (but now urgent)** — the fix is a
  full catalog rewrite (~913 rows). Touches 14 categories +
  131 active subcategories. Needs to be one migration that:
  1. Soft-deletes the duplicate-subcategory rows (22 of
     them — slug drift between apostrophe-stripped versions
     like `won_t_crank_just_clicks` vs `wont_crank_just_clicks`).
     Pick the canonical (cleaner) slug per pair and reattach
     questions to it.
  2. UPDATEs `options` for each question where the current
     options are inconsistent with the question text.
  3. Adds a `multi_select BOOLEAN DEFAULT FALSE` column +
     sets TRUE for location/side/area-type questions.
  4. Updates `ClarificationQuestionCard.tsx` to render a
     multi-select mode (with a Confirm button) when the
     catalog flag is set.
- **When to revisit** — before any further user-facing
  rollout. Highest priority of any deferred catalog item.
- **Source** — Chris's 2026-05-18 11:36 AM ET live wizard
  run. Reproduced via direct DB query on test project
  `itzdasxobllfiuolmbxu`.

### CAT-3 · `concern_questions.category` ↔ `concern_subcategories.category` consistency

- **What** — the two columns are kept in sync by the seed UPSERTs.
  Nothing prevents a future writer from inserting a
  `concern_questions` row with `category='brakes'` while
  `subcategory_id` references a row where
  `concern_subcategories.category='steering'`.
- **Why deferred** — risky to add a CHECK without coordinating
  with the seed migration order. Possible patterns: trigger,
  composite FK `(subcategory_id, category) REFERENCES
  concern_subcategories(id, category)` — requires adding a unique
  key on `(id, category)` on the subcategories side.
- **When to revisit** — before the `upload_concern_category_md`
  MCP tool ships (the tool's the most likely source of drift).
- **Source** — R6 Stream C IMPORTANT-I-2 (escalated from
  NICE-E-3).

---

## Observability

### OBS-1 · `logError` coverage on the remaining 13 V2 actions

- **What** — 13 of the 26 V2 Server Actions don't call `logError`
  on their top-level catch. The 10 that DO are the ones that hit
  external systems (Tekmetric / OTP / LLM); the 13 that don't are
  pure state-transition actions. Sentry captures all uncaughts
  either way; `scheduler_error_log` triage rows are absent for
  these surfaces.
- **Why deferred** — coditional intelligence: bug-cost is 0
  (Sentry still catches), and the value-add is "uniform SQL-
  queryable triage rows for actions that rarely fail with anything
  novel." Diminishing returns.
- **When to revisit** — if ops triage finds itself querying
  scheduler_error_log and missing rows for `dismiss_escalation_v2`,
  `submit_no_match_choice_v2`, etc. Or if a unified
  observability sweep is happening anyway.
- **Source** — R4 IMPORTANT-D-1 partial coverage; pattern-
  extension audit 2026-05-16.

### OBS-2 · Inner Tekmetric op catches → `logEdgeError`

- **What** — `scheduler-booking-direct/index.ts` has ~5 inner
  catches mapping Tekmetric 4xx/5xx to typed error responses
  (`tekmetric_4xx`, `tekmetric_5xx`, `phone_duplicate`, etc.).
  These don't write to `scheduler_error_log`.
- **Why deferred** — the typed error response goes back to Vercel,
  where the Server Action logs it via its own Sentry +
  `logError`. The Tekmetric failure IS observable; adding
  `logEdgeError` in the edge fn would be redundant double-logging
  with a slight scheduler_error_log row inflation.
- **When to revisit** — if ops needs to query
  "all Tekmetric 4xx/5xx events" without joining via
  Vercel-side records. Or if Vercel-side coverage degrades.

### OBS-3 · Sentry SDK in Deno edge functions

- **What** — Deno edge fns currently log via
  `console.error(JSON.stringify(...))` → Supabase Log Drain →
  Sentry. Per `observability.md` rule 5, the canonical pattern is
  explicit `Sentry.captureMessage`. The Vercel side does this
  natively; the Deno side does NOT have `@sentry/deno` imported.
- **Why deferred** — adding the Sentry Deno SDK requires init
  (DSN env var, integration setup), and the existing log-drain
  path delivers the same events. Pure consistency / explicitness
  win.
- **When to revisit** — if log-drain coverage drops, OR a future
  migration adopts a structured-tracing approach that needs
  explicit Sentry spans in Deno.
- **Source** — R6 Stream E NICE-4.

---

## Security / hardening

### SEC-1 · `tekmetric_webhook_events` missing canonical
`(provider, event_id)` idempotency UNIQUE

- **What** — the table is a firehose; no UNIQUE constraint per
  the `pattern-compliance.md` "Webhook idempotency" anchor.
- **Why deferred** — dormant today. The V2 scheduler is OUTBOUND-
  only to Tekmetric (POST customers / vehicles / appointments).
  No inbound webhook consumer in the wizard path.
- **When to revisit** — before V2.1 ships ANY inbound Tekmetric
  webhook consumer that mutates state.
- **Source** — R4 Stream E IMPORTANT-E-3.

### SEC-2 · Helper-layer Tekmetric idempotency (createNewCustomer / createNewVehicle / confirmAppointment retries)

- **What** — these helpers POST to Tekmetric and rely on the
  caller to NOT retry on 5xx. The Vercel-side pre-flight added
  in R4 handles "row already has customer_id" but NOT the
  micro-window between "Tekmetric POST returned 200" and "row
  write succeeded" — if the caller retries in that window, two
  Tekmetric records exist.
- **Why deferred** — implementing helper-layer idempotency
  requires lookup-before-create on every retry, adding latency
  and false-positive edge cases. The probability of the
  micro-window race is low under normal load.
- **When to revisit** — if duplicate Tekmetric customers /
  vehicles / appointments surface in production. OR if Chris
  wants tighter idempotency before V2 multi-shop rollout
  (multi-tenant load + retries make races more likely).
- **Source** — R4 Stream A IMPORTANT-A-3, R4 Stream B
  IMPORTANT-B-1 (pre-flight partial fix already shipped).

### SEC-3 · Tekmetric token cache invalidation — caller-side
trigger

- **What** — `clearTekmetricTokenCache()` is exported (R5);
  `tekmetricFetch` auto-retries once on 401. No external hook
  invalidates the cache manually (e.g., when an admin rotates
  the Vault secret).
- **Why deferred** — the 401 retry path handles ALL practical
  cases. A manual hook is only useful for fast-rollover
  scenarios that don't happen in this single-shop setup yet.
- **When to revisit** — if Tekmetric rotates tokens frequently
  enough that warm Edge instances accumulate 401s before the
  retry kicks in.

### SEC-4 · `pg_cron` concurrent-fire idempotency

- **What** — `scheduler-appointments-sync` (10-min cadence) and
  `scheduler-transcript-dispatcher` (5-min cadence) don't use
  `pg_try_advisory_xact_lock` to prevent overlapping runs.
- **Why deferred** — `scheduler_invoke_edge_function` returns
  immediately after `net.http_post`. The Edge Function itself
  is the long-running half. To enforce mutual exclusion, the
  Edge Function would need to grab the advisory lock — currently
  it doesn't.
- **When to revisit** — if a 10-min sync ever takes > 10 min
  (Tekmetric slowdown). Add `pg_advisory_xact_lock(hashtext(
  'appointments-sync'))` at the top of the function body.
- **Source** — R4 Stream C IMPORTANT-C-4.

### SEC-5 · IdleTimer + in-flight Server Action race (post-confirm
guard already shipped, but pre-confirm window still exists)

- **What** — the 5-min IdleTimer can fire DURING a Server Action
  in flight. Post-confirm race is handled (R5: `mark-abandoned`
  checks `appointment_id`/`appointment_confirmed_at` before
  flipping). PRE-confirm race (e.g., 5:00 fires while
  Tekmetric POST is mid-flight before any row update) can still
  drop the customer's in-flight context.
- **Why deferred** — adds an in-flight signal protocol (React
  context or ref) that the IdleTimer subscribes to. Larger
  refactor; pre-confirm window is < 5 sec for most actions.
- **When to revisit** — if customers report "I clicked confirm
  and it just reloaded" telemetry. Add an
  `in_flight_action_at` row timestamp + mark-abandoned guard.

---

## Cleanliness / drift

### CLN-1 · `streetAddress` READ-direction shape (Tekmetric GET responses)

- **What** — `TekmetricCustomer.address.streetAddress` in
  `scheduler-customer.ts:52` + the read at
  `scheduler-otp-direct/index.ts:220`. The R6 pattern-ext fix
  changed the WRITE-direction interfaces (NewCustomerPayload,
  scheduler-tools.ts, specialists/scheduler.ts) from
  `streetAddress` to `address1/address2`. The READ paths were
  intentionally left alone.
- **Why deferred** — no audit evidence the READ paths are broken.
  Tekmetric's GET response shape may differ from POST input
  (their API is not guaranteed symmetric); changing the read
  unilaterally could break existing flows.
- **When to revisit** — when an empirical Tekmetric GET probe
  confirms the response shape. The `tekmetric-api-testing`
  edge fn would be the natural place to add a probe.
- **Source** — R6 pattern-extension 2026-05-16 commit `c5ba41e`.

### CLN-2 · `orchestrator-direct` cloud-side function prune

- **What** — `supabase/functions/orchestrator-direct/` was
  deleted in Phase 16; the `config.toml` block was removed in
  R6 batch 1 (`197e3c8`). The deployed function on
  `*.functions.supabase.co` may still serve traffic if Tekmetric
  webhooks or AI SDK tools ever hit it.
- **Why deferred** — requires `supabase functions delete
  orchestrator-direct` from the CLI; Chris does cloud-side
  deletes manually per `deployment.md`.
- **When to revisit** — next time Chris runs a deploy round.
  Recovery from accidental delete is trivial (the function is
  intentionally unreferenced).

### CLN-3 · Hardcoded `shop_phone: "6102536565"` across multiple
files

- **What** — `escalateToHuman` helper + ~5 sites in
  `scheduler-step2-direct`, `scheduler-customer.ts`, etc.
  hardcode the shop phone number.
- **Why deferred** — Phase 1 single-tenant; the project's
  `shop-agnostic.md` rule says multi-tenant is V2+ work.
- **When to revisit** — when the multi-shop refactor begins.
  Should read from `shops.phone` or `appointment_default_limits`
  config column.
- **Source** — R4 Stream A NICE-A-2.

### CLN-4 · `next-safe-action` — REMOVED

Was deferred from R4 (auto-mode blocked the package.json edit).
**Removed in R6 batch A (commit `e679001`).** Listed here for
historical reference; can delete this entry next cleanup.

### CLN-5 · Architectural-exception doc for V2 row-as-truth pattern

- **What** — `pattern-compliance.md` prescribes next-safe-action
  + Thin Action / Fat DAL + `useActionState` keyed on
  `state.timestamp`. The V2 scheduler intentionally departs: no
  `src/lib/dal/`, manual `safeParse` + applyWizardTransition,
  `router.refresh()` instead of `useActionState`, return shape
  omits `timestamp`. The departure IS documented in
  `chat-design.md` "Architecture amendment — 2026-05-14" but the
  specific incompatibilities with `pattern-compliance.md` aren't
  enumerated.
- **Why deferred** — pure doc work; doesn't affect runtime.
  Useful for the next developer reading both docs side-by-side.
- **When to revisit** — when V2 wizard ships fully or when
  another module-level architectural exception is needed
  (parallel structure).
- **Source** — R6 Stream B.

---

## A11y (deferred from R6 Stream D — `8469209`/`e679001` shipped
most; these are the leftover NICEs)

### A11Y-1 · `Button` size="sm" min-h-9 (36px) under WCAG 2.5.5
AAA's 44×44

- **What** — passes AA 24×24 minimum; fails AAA 44×44. Affects
  WizardFooter Start Over + Talk to a Person, OtpInput Resend,
  NewCustomerInfoCard Remove buttons.
- **Why deferred** — AAA is aspirational; AA compliance is the
  policy bar. Touch-target size is a design system decision.
- **When to revisit** — if mobile-tap accuracy complaints
  surface, OR if the brand-level accessibility target is
  upgraded to AAA.
- **Source** — R6 Stream D NICE-D-1.

### A11Y-2 · `EscalationCard` ack button does ghost transition
for a no-op

- **What** — "I'll call — close this chat" button shows pending
  state but doesn't actually transition state (per the
  WizardSurface comment 514-521). Visual feedback is
  misleading.
- **Why deferred** — minor UX confusion; not a hard a11y fail.
  Fix is replacing the button with a plain link or modal
  dismiss.
- **Source** — R6 Stream D NICE-D-2.

### A11Y-3 · `CustomerNotesCard` approval-mode "last try"
indicator not in live region

- **What** — `lastTry` paragraph visible text not wrapped in
  `role="status" aria-live="polite"`. SR users only hear it on
  re-traverse.
- **Source** — R6 Stream D NICE-D-3.

### A11Y-4 · `AppointmentTypeCard` + `VehiclePicker` radio-like
buttons missing `role="radiogroup"` semantics

- **What** — Currently uses `aria-pressed` (toggle button)
  pattern. ARIA radio pattern with `role="radiogroup"` + arrow-
  key nav is more discoverable for SR users.
- **Why deferred** — both work; ARIA radio is a richer pattern
  that requires arrow-key handlers + visual focus management.
- **Source** — R6 Stream D NICE-D-4.

### A11Y-5 · Verify `prefers-reduced-motion` override exists in
`globals.css`

- **What** — Card.tsx's motion fade-in claims to honor
  reduced-motion via the globals.css override. The audit
  didn't verify the override actually exists.
- **Source** — R6 Stream D NICE-D-5.

---

## Testing

### TEST-1 · pgTAP coverage for 4 keytag tables + `webhook_events`

- **What** — pgTAP suite covers scheduler tables (R6 batch A +
  batch 3). Keytag-domain tables (`keytag_confirmation_tokens`,
  `keytag_manual_reviews`, `keytag_audit_log`, `keytag_attempts`)
  + the canonical webhook_events table (TBD per SEC-1) have no
  pgTAP coverage.
- **Why deferred** — keytag domain is out of scope for the V2
  scheduler audit cycle.
- **When to revisit** — next keytag-domain audit OR before V2.1.
- **Source** — R6 Stream E "Open gaps".

### TEST-2 · Component tests for the 25 V2 actions

- **What** — only 1 of 26 V2 actions has a unit test
  (`submit-start-over.test.ts`). Phase 17 ("Test suite
  migration") is the canonical owner per
  `scheduler-refactor-state.json`.
- **Why deferred** — Phase 17 is its own work-stream; we don't
  want to fragment test writing across rounds.
- **When to revisit** — Phase 17.

### TEST-3 · Playwright E2E suite for the 5 main flows

- **What** — credential wiring + actual E2E coverage (existing
  customer flow, new customer flow, returning customer with
  multi-account, partial-verification, no-match) was deferred
  per the audit-state JSON.
- **Why deferred** — needs sandbox Tekmetric credentials + a
  permission grant for the test runner.
- **When to revisit** — when Chris is ready to wire Playwright
  credentials.

---

## How to use this file

- When deferring an item: add an entry here with the 3 fields
  (what / why deferred / when to revisit).
- When revisiting: search for the ID (CAT-2, SEC-1, etc.) and
  remove or update the entry once the work lands.
- Don't add items here that are pure follow-up tasks for the
  current commit — those belong in the commit message itself.

This is a backlog of FINDINGS that AREN'T currently bugs but
might become bugs OR matter for a future phase. Coditional
intelligence: keep the bar high enough that the list stays
useful, not exhaustive.
