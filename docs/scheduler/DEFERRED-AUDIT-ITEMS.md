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

**Last full audit:** 2026-05-18 (6-agent parallel audit: codebase, Supabase MCP, Vercel MCP, Sentry MCP, docs/scheduler, .claude/memory mapping). 18 factual errors found in architecture doc; corrections landed in same commit. New OBS items: OBS-4 (Log Drain not firing), OBS-5 (LLM spans not captured), OBS-6 (PII redaction code only handles phone+OTP). New CLN items: CLN-6 (maxDuration unset), CLN-7 (deprecation warning). New MD item: MD-1 (closed-dates upload pending). Resolved: LLM-2. **Initial audit surfaced OBS-7 as an active blocker but Chris correctly noted the deploy path is GitHub push → Vercel auto-deploy; re-verification via Vercel MCP and Sentry release tagging proved the AI_LoadAPIKeyError was confined to releases before `59561f6` (deployed 2026-05-18 15:21 UTC) — see Historical resolved items below.**

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

### CAT-2 · Subcategory option-array refinement — **RESOLVED 2026-05-18**

- **Resolution** — migration
  `20260518163925_scheduler_concern_catalog_canonical_rebuild.sql`
  rebuilt the catalog from `scheduler-app/scripts/canonical-concern-catalog.ts`.
  - 14 categories, 105 subcategories, 729 questions canonical
  - 42 multi-select questions (location, "where do you feel it" patterns)
  - Schema: added `concern_questions.multi_select BOOLEAN NOT NULL
    DEFAULT FALSE`
  - DB push verified `canonical rebuild OK: 105 subcategories, 729
    questions (42 multi-select)`
- **Code changes shipped together**:
  - `load-diagnostic-catalog.ts` surfaces `multi_select` in
    `CatalogQuestion`
  - `run-diagnostics` embeds `multi_select` in pending queue entries
  - `submit-clarification-answer` accepts `string | string[]` answer
    values; validates per-option-value and rejects shape mismatches
  - `ClarificationQuestionCard` renders multi-select mode (chips toggle,
    Continue button) when `multi_select` is true
  - `card-payloads.ts` + `get-current-card.ts` + `WizardSurface.tsx`
    thread the flag through
  - `transcript-dispatcher` handles `string | string[]` in the
    customer-activity block
- **Source-of-truth audit artifact** —
  `scheduler-app/scripts/canonical-concern-catalog.ts` (3000+ lines).
  Re-running `node --experimental-strip-types
  scheduler-app/scripts/generate-catalog-migration.ts` produces the
  migration SQL from the TS data file.

### CAT-2 (historical context)

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

### OBS-3 · Sentry SDK in Deno edge functions — PARTIALLY RESOLVED 2026-05-19

- **Resolution** — `@sentry/deno` wired into 4 high-value scheduler-relevant
  edge functions (appointments-sync, transcript-dispatcher,
  keytag-bulk-reconcile, keytag-daily-report) via the new
  `_shared/sentry-edge.ts` module + `withSentryScope(req, surface, handler)`
  wrapper around each `Deno.serve` entry point. `_shared/log-edge-error.ts`
  extended to ALSO fire `Sentry.captureMessage` when initialized — every
  `scheduler_error_log` row now belt-and-suspenders surfaces on Sentry.
  See OBS-4 entry for why this was paired with the Log Drain fallback.
- **Still deferred (the remaining ~10 edge functions)** — `mcp-auth`,
  `orchestrator-mcp`, `scheduler-{booking,otp,step2}-direct`,
  `tekmetric-{api-testing,bootstrap,find-ro-by-keytag,list-wip-keytags,
  webhook}`, `keytag-{seed-from-tekmetric,tekmetric-webhook}` — these
  haven't been wrapped yet. Same one-line import + wrap pattern as the 4
  shipped ones; can be done piecemeal as each function gets touched.
- **When to revisit each remaining fn** — when next touching the fn for an
  unrelated change. Don't do a big sweep; just wire each one as you ship
  the next edit to it.
- **Source** — R6 Stream E NICE-4; updated 2026-05-18 multi-agent audit;
  partial resolution 2026-05-19.

### OBS-4 · Supabase Log Drain → Sentry not firing — PARTIALLY RESOLVED 2026-05-19

- **Root cause (verified 2026-05-19 via Supabase MCP `get_organization`)** —
  Supabase Log Drains require **Team or Enterprise** plan. Org
  `Jeff's Automotive` is on **Pro**. The dashboard UI exists but the feature
  is gated. The architecture doc's `observability.md` rule D4
  ("MANDATORY infrastructure") is structurally unfulfillable on the current
  plan. MCP has no `create_log_drain` tool — config is dashboard-only or via
  Management API.
- **Resolution shipped (Option A: Deno SDK fallback)** — wired
  `@sentry/deno` directly into 4 scheduler-relevant edge fns
  (appointments-sync, transcript-dispatcher, keytag-bulk-reconcile,
  keytag-daily-report) via the new `_shared/sentry-edge.ts` module +
  `withSentryScope` wrapper. New secret `EDGE_FN_SENTRY_DSN` points at the
  same `jeffs-app-v2-supabase` Sentry project the drain would have used.
  This closes the edge-function surface for OBS-3 + OBS-4 simultaneously.
- **Still gapped (Postgres / Auth / Realtime / Storage layers)** — These
  Supabase-internal logs still need the Log Drain to reach Sentry. RAISE
  EXCEPTION in SQL functions, migration errors, pg_cron failures all stay
  invisible at the Sentry layer. The defense-in-depth path is
  `BEGIN…EXCEPTION` wraps writing to `scheduler_error_log` (already in
  place for all 4 scheduler crons per migration `20260516200000`).
- **When to fully resolve (Option B)** — upgrade Supabase to Team plan
  ($599/mo base + per-drain hours + events) when rolling out beyond Jeff's
  test environment. Then Project Settings → Log Drains → New Sentry drain →
  paste DSN `https://f291fea017068329aa672e0df463dbe9@o4511066499055616.ingest.us.sentry.io/4511311571124224`.
  Verify via `mcp__sentry__search_events` dataset=`logs` within ~5 min.
- **Doc correction needed** — `.claude/rules/observability.md` D4 must be
  reframed from "MANDATORY" to "Recommended; requires Supabase Team plan.
  Edge fn surface covered by `_shared/sentry-edge.ts` fallback on lower
  plans." (Rule lives in dotfiles — change in same commit.)
- **Source** — 2026-05-18 multi-agent audit + 2026-05-19 OBS-4 deep-dive
  agent + Chris's Sentry-vs-Supabase plan clarification + 2026-05-19 Option
  A wiring + deploy.

### OBS-5 · LLM call spans not captured in Sentry — RESOLVED 2026-05-19

- **Resolution** — two-piece fix shipped:
  1. `Sentry.vercelAIIntegration({ force: true })` added to
     `scheduler-app/sentry.server.config.ts` integrations array.
     `force: true` is MANDATORY on Vercel because the `ai` package gets
     bundled (not externalized) in Next.js production builds, which defeats
     the integration's auto-detection. Per Sentry docs:
     https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/integrations/vercelai/
  2. `experimental_telemetry: { isEnabled: true, functionId, recordInputs:
     false, recordOutputs: false }` added to the `generateObject` call in
     each of the 3 LLM helpers (diagnose-concern, summarize-concern,
     parse-customer-note). `recordInputs/recordOutputs: false` is the PII
     guard — customer concern text + post-booking notes are PII (vehicle
     complaints may include phone-like patterns, plate numbers, free-form
     descriptions).
- **Compatibility verified** — `@sentry/nextjs@10.52.0` ≥ required 10.6.0
  for the vercelAIIntegration; `ai@5.0.186` in supported range ≥3.0.0
  ≤6.0.0. No new dependencies, no version bumps. tsc --noEmit clean.
- **Expected output** — Sentry AI Agents Insights view auto-activates once
  `gen_ai.*` spans arrive with `gen_ai.system: anthropic` /
  `gen_ai.request.model: claude-haiku-4-5` / `gen_ai.usage.input_tokens` etc.
  Nested INSIDE existing `serverAction/runDiagnosticsV2` transactions —
  trace view shows action → LLM → token chain.
- **Sample rate** — production `tracesSampleRate: 0.1` means ~10% of LLM
  calls produce visible spans. Matches Server Action sampling. Raise via
  `tracesSampler` selectively if cost monitoring needs every call.
- **Source** — 2026-05-18 multi-agent audit + 2026-05-19 OBS-5 deep-dive
  agent + Vercel AI SDK docs verified via Context7.

### OBS-6a · `beforeSend` PII redaction — Vercel-side hardening — RESOLVED 2026-05-19

- **Resolution** — replaced the prior stringify-based scrubber in
  `scheduler-app/sentry.server.config.ts` with a structural walker:
  - Recursively visits `event.user` / `event.contexts` / `event.extra` /
    `event.breadcrumbs[*].data` / `event.request` (data + headers +
    query_string)
  - Key-blocklist scrub (case-insensitive) for `email` / `first_name` /
    `last_name` / `name` / `customer_name` / `customername` /
    `primary_email` / `entered_*name` / `verified_*name` / `edited_emails` /
    `edited_phones` / `phone*` / `address*` / `street_address` / `city` /
    `state` / `zip` / `postal_code` / `tekmetric_error_text` → value
    replaced with `"[redacted]"`
  - String regex pass (applied to every leaf string visited + to
    `event.message` + every `event.exception.values[].value`):
    - email pattern → `[email]`
    - E.164 US/CA phones → `+1******NNNN` (preserve last 4)
    - 6-digit OTP near `code`/`otp_code`/`otp` keys → `[REDACTED]`
  - Fail-closed: any scrubbing exception → drop event entirely
- **Mirror in `_shared/sentry-edge.ts`** — identical blocklist + regexes
  applied to events captured from the 4 OBS-3-wrapped edge functions. The
  edge-side and Vercel-side scrubbers share the same allow/deny semantics.
- **Defends surfaces** (per OBS-6 audit map):
  - `tekmetric_error_text` echoes in extra (4 sites: submit-new-customer-info,
    submit-customer-info-edit, submit-new-vehicle, submit-customer-notes)
  - Postgres constraint violation messages in error.value
  - staff-notification subject embedded in exception.value
  - submit-otp extra.response with verifyResult shape
  - future regression sites (addBreadcrumb with customer data, etc.)
- **Does NOT defend** the Supabase Log Drain → Sentry channel (which
  bypasses `beforeSend`). See OBS-6b below — currently moot since Log
  Drains require Supabase Team plan (org is Pro per OBS-4 finding).
- **Source** — 2026-05-18 multi-agent audit + 2026-05-19 OBS-6 deep-dive
  agent + 2026-05-19 implementation.

### OBS-6b · Sentry server-side Data Scrubbing for Log Drain — DEFERRED (gated by OBS-4 Option B)

- **What** — When/if the Supabase Log Drain → Sentry path activates (Option
  B of OBS-4 — requires Team plan), `beforeSend` does NOT run on those
  events because Log Drain uses direct HTTP ingestion. Sentry project-level
  Data Scrubbing rules (Settings → Security & Privacy) would be the only
  filter at that layer. Without it, a single Postgres RAISE EXCEPTION
  mentioning `customer.email` ships PII to Sentry unscrubbed.
- **Why deferred** — Log Drain isn't enabled (Pro plan blocks it). When/if
  upgraded to Team plan, configure project-level scrubbing alongside the
  drain in the same dashboard pass.
- **When to revisit** — concurrent with OBS-4 Option B (Supabase plan
  upgrade).
- **Source** — 2026-05-19 OBS-6 audit; extracted from former OBS-6 entry.

---

## Security / hardening

### SEC-7 · BotID + rate-limit activation — **BotID HALF RESOLVED 2026-05-25; rate-limit half still deferred**

- **BotID half — RESOLVED 2026-05-25.** The original entry below
  claimed `initBotId()` was wired in `instrumentation-client.ts`
  ("No redeploy needed"). It WASN'T — only Sentry init was. Symptom:
  Vercel logs flooded with "Possible misconfiguration of Vercel BotId
  or malicious request to 'POST /'" and Chris's OTP submits returned
  `bot_detected` (wizard appeared frozen with no customer-facing
  error). Per botid@1.5.11 README the wiring requires THREE pieces:
  1. server `checkBotId()` — was already shipped in PLAN-03 Phase 1A
  2. client `initBotId({ protect: [...] })` — now added to
     `scheduler-app/instrumentation-client.ts`
  3. `withBotId(nextConfig)` in `next.config.ts` — now wrapped
     INSIDE `withSentryConfig` (Sentry stays outermost per its docs)
  Protected routes: `POST /`, `POST /book`, `POST /book-v2`
  (all three wizard surfaces per `BookPageShell.tsx`).
  Verified: typecheck clean, 273/273 tests pass, `npm run build`
  emits the routes with BotID rewrites injected.
- **Rate-limit half — still deferred** (per the pivot below).

### SEC-7 (historical context) · BotID + rate-limit activation (NEW 2026-05-23 · DESIGN PIVOT 2026-05-23 PM · DEFERRED TO PRE-LAUNCH)

- **Status** — DEFERRED until immediately before Phase 1 DNS launch at
  Chris's explicit direction (2026-05-23 PM). Rationale: rate-limit gates
  would constrain manual + automated testing during the remaining
  remediation phases. The wizard isn't public yet, so the SMS-pumping
  attack surface isn't reachable; activating now buys no protection and
  adds friction to test cycles.

- **What was originally shipped** — PLAN-03 Phase 1A + 1B shipped:
  - Vercel BotID (`botid@1.5.11`) — server-side `checkBotId()` on the 3
    SMS-triggering Server Actions: `submit-phone-name.ts`,
    `resend-otp.ts`, `submit-multi-account-choice.ts`.
  - Upstash rate-limit (`@upstash/ratelimit@2.0.8` +
    `@upstash/redis@1.38.0`) — two sliding-window limits per request:
    5/IP/min + 3/phone-hash/hour.
  Code is in place; gates fail OPEN with Sentry warnings when the
  external services are unconfigured. OTP traffic works regardless.

- **DESIGN PIVOT (2026-05-23 PM)** — the rate-limit half is being
  re-architected before activation:
  - **PER-IP limit** moves OUT of app code INTO a **Vercel Firewall
    custom rule** (Pro plan, no extra cost). Match `POST /` to rate-limit
    at the edge BEFORE the Server Action runs. ~30 req/60s per IP is
    the starting tuning — generous enough that a fast wizard click-through
    (~10 steps in 60s) doesn't trip it, tight enough to block scrapers.
  - **PER-PHONE limit** moves OUT of Upstash INTO a **Supabase Postgres
    RPC** (`check_and_increment_rate_limit(p_key, p_window_seconds,
    p_max)`) backed by a `rate_limit_buckets` table + nightly pruner
    cron. Reason: Vercel Firewall can't see request bodies (the phone
    number is encrypted in the POST payload), so per-phone shaping has
    to stay app-layer, but it doesn't need a new vendor (Upstash) when
    Supabase already covers it.
  - **Dependencies to drop on swap**: `@upstash/ratelimit@2.0.8`,
    `@upstash/redis@1.38.0`. Saves ~50KB on the bundle.
  - **Architecture win**: IP-spray attacks rejected at the Vercel edge
    before they reach our infrastructure (faster, free, harder to bypass);
    per-victim harassment still caught in the app layer; one fewer
    external vendor.

- **Pre-launch activation checklist** (do all 4 right before the
  Phase 1 DNS cutover to `appointments.jeffsautomotive.com`):

  1. **Vercel Firewall rule** (no code change):
     - Vercel dashboard → `scheduler-app` → Firewall → Custom Rules
     - Add rule: `Request Path` equals `/` AND `Request Method` equals
       `POST` → Action: **Rate Limit** 30/60s per IP, Deny 60s on breach.
     - Add a sibling rule for `/book` if that route is still live at
       launch.
     - Tune the threshold from real traffic after the first week.

  2. **BotID dashboard toggle** (no code change):
     - Vercel dashboard → `scheduler-app` → Firewall → Rules → enable
       **Vercel BotID** at Basic level (free on Pro plan).
     - The matching client-side `initBotId()` call already lives in
       `scheduler-app/instrumentation-client.ts`. No redeploy needed.
     - **Deep Analysis** ($1/1k checks) deferred until real attack
       traffic justifies cost.

  3. **Swap in-app rate-limit from Upstash to Postgres** (~1-2 hours of
     code):
     - New migration: `rate_limit_buckets(key TEXT, occurred_at
       TIMESTAMPTZ, window_id TEXT)` + composite index on `(key,
       occurred_at DESC)` + `check_and_increment_rate_limit` RPC
       (sliding-window, returns `(allowed bool, retry_after_seconds int)`)
       + nightly pruner cron (`pg_cron`) deleting rows older than 24h.
     - Refactor `scheduler-app/src/lib/security/rate-limit.ts`:
       - Drop `@upstash/ratelimit` + `@upstash/redis` imports + usage.
       - Drop the per-IP limit (Vercel Firewall handles it now).
       - Keep only the per-phone-hash check, calling the new RPC via
         the admin supabase-js client.
       - External API stays the same (`checkRateLimit({ phoneHash })`),
         so the 3 calling Server Actions don't change.
     - Update `scheduler-app/tests/unit/rate-limit.test.ts` to mock
       the supabase-js admin client instead of Upstash.
     - Remove the npm deps from `package.json` + regenerate
       `package-lock.json` (use `rm -rf node_modules package-lock.json
       && npm install && npm ci --dry-run` per CLN-11).

  4. **Sentry alert hygiene** — once the swap ships:
     - The `rate_limit_init` Sentry warning with tag
       `misconfiguration=upstash_missing` will stop firing.
     - The `check_bot_for_sensitive_action` warning will stop once the
       Vercel dashboard toggle is on.
     - Investigate any of these warnings that fire AFTER activation —
       they signal a real outage.

- **What's NOT blocked by the deferral** — testing freedom. The current
  fail-OPEN behavior means:
  - OTP traffic works for both human and scripted tests
  - DB-level `otp_codes` per-phone-per-hour cap remains the active
    backstop against accidental misuse
  - No risk of accidentally rate-limiting ourselves during Plan 04-07
    development cycles

- **What IS blocked by the deferral** — abuse protection at production
  scale. The wizard is private (no DNS pointed yet) so this is fine.
  Once the cutover happens, attackers can hit
  `appointments.jeffsautomotive.com` directly; the activation MUST be
  complete before then or the OTP endpoint becomes a money pump.

- **Source** — 2026-05-23 PLAN-03 Phase 1A + 1B implementation;
  2026-05-23 PM design pivot per Chris's call (Vercel Firewall +
  Supabase Postgres instead of Upstash, deferral to pre-launch).
  Plan reference: `docs/scheduler/plans/PLAN-03-security-hardening.md`
  Phase 1 (lines 41-150). Existing files (to be refactored):
  `scheduler-app/src/lib/security/check-bot.ts`,
  `scheduler-app/src/lib/security/rate-limit.ts`,
  `scheduler-app/src/lib/security/get-request-ip.ts`. Companion tests:
  `scheduler-app/tests/unit/check-bot.test.ts`,
  `scheduler-app/tests/unit/rate-limit.test.ts`,
  `scheduler-app/tests/unit/get-request-ip.test.ts`.

### SEC-9 · Fire-and-forget Server Action calls should use `after()` for guaranteed post-response execution (NEW 2026-05-25)

- **What** — `submit-summary.ts:745` (`notifyStaffOfNewAppointment`) and
  `:789` (`sendSchedulerManualReviewEmail`) both use the
  `void ...().then().catch()` pattern AFTER the Server Action's return
  path. On Vercel serverless functions, orphan promises after the
  response is sent are NOT guaranteed to complete — the function
  instance may tear down before the I/O lands.
- **Customer impact** — staff doesn't get the new-appointment email +
  advisor doesn't get the AVM manual-review email. The DB row + audit
  log + Sentry capture are intact (graceful), so the customer never
  sees an issue, but the back-office triage paths get partial signal.
- **Why deferred** — the `notifyStaffOfNewAppointment` pattern
  pre-dates this batch + has presumably been working in production
  (no Sentry alarms about missing staff emails). Switching the pattern
  is a focused refactor that needs verification (the existing emails
  may already be missing some fraction; need a measurement first).
- **Path forward** — wrap the fire-and-forget with `after()` from
  `next/server` (Next.js 15.5 stable) OR `waitUntil()` from
  `@vercel/functions`. Both guarantee execution past response flush.
  Reference: https://nextjs.org/docs/app/api-reference/functions/after
- **Severity** — M. Customer-facing flow is unaffected; back-office
  notification reliability is the only concern.
- **Source** — validator-2 post-fix audit (2026-05-25).

### SEC-10 · IdleTimer `beforeunload` handler lacks bfcache guard (NEW 2026-05-25)

- **What** — `IdleTimer.tsx:213-219`. `onPagehide` checks
  `event.persisted` to skip bfcache transitions; `onBeforeUnload` has
  no equivalent guard (the spec has no `persisted` field on
  beforeunload). On iOS Safari, both fire on bfcache-eligible
  navigations.
- **Customer impact** — a customer who idles ≥ 10s (the
  `last_active_at` guard threshold in mark-abandoned) and then
  bfcache-navigates would fire the beacon → release the hold → flip
  to timed_out. The 10s guard catches most cases; the 5-min idle
  timer catches the rest.
- **Why deferred** — existing behavior; not introduced by this batch.
  The Page Lifecycle API spec advice is to drop `beforeunload`
  entirely on modern browsers since `pagehide` supersedes it. But
  removing beforeunload affects browser support (older browsers
  fall back to the server-side reaper cron).
- **Path forward** — drop `onBeforeUnload` listener; rely on
  `pagehide` (with `event.persisted` guard) for tab-close detection
  on modern browsers + server-side 70-min reaper as the catch-all.
- **Severity** — P2. Mitigated by `last_active_at` guard.
- **Source** — validator-2 post-fix audit (2026-05-25).

### SEC-11 · OTP resend cooldown + CAS expires_at compare Date.now() to Postgres now() (NEW 2026-05-25)

- **What** — `resend-otp.ts:135-160` (P2.12 fix) compares `Date.parse(otp_sent_at)` (DB time) to `Date.now()` (Node wall clock). `submit-summary.ts:344` (P0.2 fix) compares `new Date().toISOString()` to `appointment_holds.expires_at`. Both are cross-clock comparisons that P1.6 explicitly rejected for the same-day cutoff. Practical drift is sub-second (NTP-synced) so not a bug today.
- **Why deferred** — operational consistency only; no functional impact at NTP-drift scales.
- **Path forward** — for the OTP cooldown: either route through a Postgres RPC (`scheduler_check_resend_cooldown(chatId, threshold_ms)`) OR add a code comment explicitly accepting the cross-clock drift since the security-critical limits live elsewhere (Upstash + DB-level per-phone caps). For the CAS expires_at: source `nowIso` from the already-memoized `getShopClock().now_utc_iso` snapshot.
- **Severity** — P2. Pattern-drift, not bug.
- **Source** — validator-2 post-fix audit (2026-05-25).

### SEC-8 · `SCHEDULER_BEACON_HMAC_SECRET` env var — pre-launch activation (NEW 2026-05-25)

- **Status** — code shipped; env var NOT yet set on Vercel. Activates the
  `/api/scheduler/mark-abandoned` beacon HMAC validation. With the env
  var unset, the route falls back to its prior auth=NONE posture and a
  one-time Sentry warning is emitted (`beacon_hmac_init` /
  `misconfiguration=secret_missing`).

- **What was shipped** (P1.5 post-validator fix 2026-05-25):
  - `scheduler-app/src/lib/security/beacon-hmac.ts` — `signBeaconChatId`
    + `verifyBeaconSig` + `isBeaconHmacConfigured` helpers.
  - `BookPageShell.tsx` calls `signBeaconChatId(chatId)` server-side
    and threads the sig through `WizardCrossCutting` → `IdleTimer`.
  - `IdleTimer.tsx` attaches `sig=<base64url>` to every
    `mark-abandoned` beacon query string.
  - `mark-abandoned/route.ts` verifies the sig BEFORE any DB read.
    Returns 204 with a Sentry warning (`mark_abandoned_hmac_rejected`)
    on missing or mismatched sig.
  - `tests/unit/beacon-hmac.test.ts` — 19 tests covering
    configured/unconfigured/strict-mode paths.

- **Pre-launch activation steps** (do BEFORE the Phase 1 DNS cutover):

  1. **Generate the secret** (one-time, on operator machine):
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
     Outputs a 64-char hex string (32 bytes). ≥ 32 chars is the floor
     enforced by `isBeaconHmacConfigured`.

  2. **Set on Vercel** (Production + Preview envs both):
     - Vercel dashboard → `scheduler-app` → Settings → Environment
       Variables → Add `SCHEDULER_BEACON_HMAC_SECRET` with the value
       from step 1.
     - DO NOT prefix with `NEXT_PUBLIC_` — this must stay server-only.

  3. **Redeploy** so the new env var is in scope. After redeploy:
     - The `beacon_hmac_init` Sentry warning stops firing.
     - The `mark_abandoned_hmac_rejected` warning fires whenever the
       beacon is forged (attacker probes, browser bug, etc.) — treat
       as signal worth triage.

  4. **Rotation** (operational): rotating the secret mid-session breaks
     the live page's cached sig and drops in-flight beacons. Rotate
     during low-traffic windows. The 70-min cron reaper covers
     orphaned holds; Tekmetric's hold TTL bounds slot loss.

- **What's NOT blocked by the deferral** — local dev. The helper
  fail-OPENs when the env var is missing so `npm run dev` and CI
  builds keep working without operator intervention.

- **What IS blocked** — production abuse protection on the abandon
  beacon. An attacker who learns a victim's `chat_id` (from URL
  history, screen-share, leaky analytics tag) can fire forged beacons
  to release the victim's hold and flip their session to `timed_out`.
  Low-severity but easy to exploit; pre-launch activation closes it.

- **Strict-mode interaction** — `SCHEDULER_REQUIRE_RATE_LIMIT=true`
  bumps the missing-secret warning to ERROR level for operator
  visibility but does NOT change runtime behavior (still fail-OPEN on
  missing secret to avoid breaking dev environments). The strict flag
  only adds the ERROR-level signal to find misconfigurations sooner.

- **Source** — P1.5 validator-2 finding (mark-abandoned route had no
  auth). Implementation across `beacon-hmac.ts` + `BookPageShell.tsx`
  + `WizardCrossCutting.tsx` + `IdleTimer.tsx` + `mark-abandoned/
  route.ts` + `tests/unit/beacon-hmac.test.ts`.

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

### CLN-2 · `orchestrator-direct` cloud-side function prune — RESOLVED 2026-05-19

- **Resolution** — `supabase functions delete orchestrator-direct
  --project-ref itzdasxobllfiuolmbxu` executed successfully on
  2026-05-19. Output: "Deleted Function orchestrator-direct from
  project itzdasxobllfiuolmbxu." Verified no live caller via grep
  across local source — all 20 file matches were comments / docs /
  state JSON / type annotations / historical changelog entries.
  The `ORCHESTRATOR_URL` Vercel env var is only used as a URL
  template by 4 V2 clients (scheduler-step2-direct,
  scheduler-otp-direct, scheduler-booking-direct,
  fire-transcript-dispatch) which substitute the trailing path
  segment with the correct function name — they never actually
  hit `orchestrator-direct` itself.
- **Historical context** — `supabase/functions/orchestrator-direct/`
  was deleted from local source in Phase 16; the `config.toml`
  block was removed in R6 batch 1 (`197e3c8`). The cloud function
  remained orphaned (version 25, last updated 2026-05-16 01:03 ET)
  until this delete. One Sentry event `OrchestratorError: Network
  error calling orchestrator-direct` (issue
  `JEFFS-APP-V2-TEST-FUNCTIONS-2`) was from pre-refactor code that
  has since been replaced.
- **Source of resolution** — 2026-05-19 cleanup pass following
  the 2026-05-18 multi-agent audit.

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

### CLN-6 · `maxDuration: 300` not actually set on any route handler (NEW 2026-05-18)

- **What** — `scheduler-app/next.config.ts:10` comment claims
  `maxDuration is set on the route handler itself (export const
  maxDuration = 300)`. Reality verified 2026-05-18 via grep:
  zero `export const maxDuration` exports in `scheduler-app/`.
  The only existing route handler
  (`app/api/scheduler/mark-abandoned/route.ts`) only exports
  `runtime = "nodejs"` + `dynamic = "force-dynamic"`. No
  `vercel.json` exists.
- **Impact** — Server Actions invoking long Anthropic completions
  (the 3 wizard LLM helpers) inherit Vercel's default function
  timeout (60s on Pro plan, possibly stricter on Hobby).
  Long Anthropic completions over 60s would be cut off mid-flight.
  Currently invisible because no real customer traffic
  (`live: false` flag on Vercel project) — no runtime logs in 24h.
- **Why deferred** — currently unobservable; turns into a real
  bug when traffic starts. The architecture doc was already
  asserting maxDuration was set, so the gap was masked.
- **When to revisit** — before public rollout. Either (a) add
  `export const maxDuration = 300` to the route handler + verify
  Server Actions are covered, or (b) update the doc comment to
  reflect actual default behavior.
- **Source** — 2026-05-18 Vercel MCP audit.

### CLN-7 · Sentry `reactComponentAnnotation` config deprecated — RESOLVED 2026-05-19

- **Resolution** — moved `reactComponentAnnotation: { enabled: false }`
  from top-level Sentry options to the `webpack:` namespace in
  `scheduler-app/next.config.ts`. Matches the new shape introduced in
  `@sentry/nextjs` v10 for the Webpack-vs-Turbopack split.
- **Compatibility verified** — single coherent `@sentry/nextjs@10.52.0`
  line per `npm ls`, no `UNMET PEER` warnings. No `nextConfig.webpack(...)`
  override exists → no collision with Sentry's `webpack:` namespace.
  tsc --noEmit clean.
- **Other deprecations checked** — project-wide grep for
  `disableLogger` / `automaticVercelMonitors` / `autoInstrumentServerFunctions` /
  `autoInstrumentMiddleware` / `autoInstrumentAppDirectory` /
  `excludeServerRoutes` / `widenClientFileUpload` / `hideSourceMaps` /
  `unstable_sentryWebpackPluginOptions` / `disableSentryWebpackConfig` /
  `disableManifestInjection` returned ZERO additional hits. Nothing else
  needed bundling.
- **Removal timeline** — Sentry hasn't committed a removal version.
  Realistic expectation: `@sentry/nextjs@11.0.0`.
- **Source** — 2026-05-18 Vercel MCP audit + 2026-05-19 CLN-7 deep-dive
  agent + 2026-05-19 implementation.

### SEC-3 · `tekmetric-api-testing` needs dedicated HMAC secret (NEW 2026-05-23)

- **What** — Plan 03 Phase 3B shipped `tekmetric-api-testing` with a
  graceful fallback: it reads
  `TEKMETRIC_API_TEST_HMAC_SECRET` env var when set, falls back to
  `SUPABASE_SERVICE_ROLE_KEY` (the previous behavior) when unset. The
  fallback path logs a `console.warn` on cold start so the
  misconfiguration is visible.
- **What's blocked** — The security benefit (HMAC secret + service role
  key uncoupled) only kicks in once the dedicated secret is set. Until
  then, a service-role-key leak still allows attackers to forge
  two-step confirmation tokens.
- **What to do** — Chris runs ONE shell command to set the secret on
  the test (and later, prod) Supabase project:
  ```bash
  npx supabase secrets set \
    --project-ref itzdasxobllfiuolmbxu \
    TEKMETRIC_API_TEST_HMAC_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ```
  Then redeploy: `npx supabase functions deploy tekmetric-api-testing`.
  After redeploy, the warning stops + HMAC secret is properly separated.
- **Rotation note** — Token TTL is 5 min, so rotating the secret
  invalidates all in-flight tokens within 5 min. Generate a new value +
  `secrets set` to rotate; no coordinated cut-over needed.
- **Source** — 2026-05-23 PLAN-03 Phase 3B implementation. Migration
  comment in `supabase/functions/tekmetric-api-testing/index.ts` (line
  ~581) also documents this prerequisite.

### SEC-6 · OAuth resource backward-compat cutoff — RESOLVED 2026-05-23 (same day, immediate cutoff per Chris)

- **Resolution (2026-05-23 PM)** — Chris directed immediate close of the
  30-day backward-compat window. `orchestrator-mcp/index.ts`
  `authenticateRequest` now REJECTS tokens with NULL resource (returns
  `{ ok: false, reason: "invalid_audience" }` → 401 + WWW-Authenticate
  with `error="invalid_token"` per MCP spec 2025-11-25 §"Token Audience
  Binding and Validation" + RFC 6750 §3.1 error codes). The prior
  warn-and-allow branch + 30-day window documented below is HISTORICAL.

  - **Code change**: orchestrator-mcp/index.ts (deployed 2026-05-23 to
    ref itzdasxobllfiuolmbxu). The NULL-resource branch flipped from
    breadcrumb + `Sentry.captureMessage` + allow → `Sentry.captureMessage`
    + return invalid_audience. Mismatch branch unchanged.
  - **Impact on existing Claude Desktop sessions**: any session with a
    pre-Plan-03-Phase-4 token gets a 401 on its next request. Re-auth
    in Claude Desktop ONCE produces a resource-bound token; subsequent
    requests succeed. No client-code change needed — the existing
    refresh flow already sends the `resource` parameter (shipped in
    `mcp-auth` Phase 4).
  - **MCP spec citation** — `/websites/modelcontextprotocol_io_specification_2025-11-25`
    §Token Audience Binding and Validation: "MCP servers MUST validate
    that presented tokens were issued specifically for their use."
    NULL resource doesn't satisfy this contract.
  - **Sentry event to monitor** — `oauth_legacy_no_resource_rejected`
    (warning level, tag `oauth_event=legacy_no_resource_rejected`).
    Expected pattern: one or two events when Chris re-auths Claude
    Desktop, then zero. Anything else signals a stale session worth
    investigating.

#### Historical context (below preserved for audit trail)

- **What** — Plan 03 Phase 4 shipped RFC 8707 + MCP spec 2025-11-25 audience
  validation across the OAuth stack:
  - `mcp-auth /authorize` REJECTS requests without `resource` (400
    `invalid_request`), with malformed `resource` (400 `invalid_target`),
    or with `resource` that doesn't match the canonical orchestrator-mcp
    URL (400 `invalid_target`).
  - `mcp-auth /token` (authorization_code + refresh_token grants) REJECTS
    requests whose `resource` doesn't match the auth code / refresh token's
    stored resource (400 `invalid_target`). Token requests MAY omit
    `resource` to inherit (per RFC 8707 §2.2).
  - `orchestrator-mcp authenticateRequest` REJECTS bearer tokens whose
    stored `resource` doesn't match the canonical orchestrator-mcp URL
    (401 + WWW-Authenticate with `error_description` calling out RFC 8707
    audience mismatch).
  - Migration `20260523040239_oauth_resource_indicator_validation.sql`
    extends `oauth_validate_access_token` RPC to surface `resource`, adds
    column COMMENTs documenting the canonical form contract.
- **Backward-compat window** — tokens issued BEFORE the migration applied
  have NULL resource. `authenticateRequest` allows NULL with a Sentry
  warning + breadcrumb tag `oauth_legacy_no_resource: true` instead of
  rejecting. Refresh tokens have a 90-day TTL, so the longest a legitimate
  legacy token can survive is 90 days from the deploy date.
- **When to revisit** — 30 days from the migration apply date
  (2026-05-23 → cutoff date 2026-06-22). After that date:
  1. Confirm Sentry breadcrumb volume for `oauth_legacy_no_resource:true`
     is approaching zero (active Claude Desktop installs should have
     re-authed at least once in that window — refresh-token rotation alone
     replaces the NULL-resource token with a resource-bound one).
  2. Change `authenticateRequest` in
     `supabase/functions/orchestrator-mcp/index.ts` — the existing
     `if (tokenResource === null)` branch currently allows + logs; change
     to `return { ok: false, reason: "invalid_audience" };`
  3. Optionally tighten the DB by setting
     `oauth_access_tokens.resource NOT NULL` once production confirms zero
     NULL-resource active tokens.
- **How to identify legacy traffic** — Sentry events with tag
  `oauth_event=legacy_no_resource` OR breadcrumb data
  `oauth_legacy_no_resource: true`. Each event carries the `client_id`
  and `user_label` so we can trace which Claude install is still on a
  legacy token.
- **Prerequisite for cutoff** — Claude Desktop must be sending `resource`
  on /authorize (verified post-Phase-4-deploy 2026-05-23 by re-adding the
  connector and observing the resulting auth code row). If a future
  Claude Desktop build regresses on this, surface in this entry before
  cutoff.
- **Source** — 2026-05-23 PLAN-03 Phase 4 implementation. Migration
  filename: `20260523040239_oauth_resource_indicator_validation.sql`.
  Spec sources:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
  ("Token Audience Binding and Validation" + "Access Token Privilege
  Restriction") and https://datatracker.ietf.org/doc/html/rfc8707.

### OBS-8 · Sentry Cron Monitoring needs `sentry_dsn` in Vault — **RESOLVED 2026-05-24**

- **What was deferred** — Plan 02 Phase 3 (migration
  `20260523022303_sentry_cron_monitoring.sql`) shipped the
  `sentry_cron_checkin` helper + 4 per-cron wrappers + re-scheduled the
  4 cron jobs (`scheduler-appointments-sync`,
  `scheduler-transcript-dispatcher`, `keytag-bulk-reconcile`,
  `keytag-daily-report`) to call the wrappers. The helper was in
  graceful no-op mode until the Vault secret `sentry_dsn` was populated —
  it parses the DSN from Vault, falls back to RETURN NULL if missing,
  cron continues normally regardless.
- **What was blocked** — Sentry Cron Monitoring dashboard couldn't see
  the crons until the secret landed. Misses + errors at the cron-body
  layer were invisible to Sentry on that channel until then. (The
  edge functions they invoke remained surfaced via `withSentryScope`.)
- **Resolution** — `vault.secrets.sentry_dsn` populated 2026-05-24
  17:24:22Z (same DSN as `EDGE_FN_SENTRY_DSN`, points at the
  `jeffs-app-v2-supabase` Sentry project per Plan 02 Phase 3 §1).
  Verified via two natural cron cycles 2026-05-24 18:30 + 18:35 UTC:
  9/9 calls to Sentry's `/cron/<slug>/<key>/` endpoint returned 2xx
  (POST `202` upsert + GET `202` close-out per cycle × 2 fires + the
  edge fn `200`s), and Sentry auto-resolved the active cron-failure
  issues (JEFFS-APP-V2-SUPABASE-A transcript-dispatcher + -C
  appointments-sync) once the post-migration check-ins paired
  correctly. Daily-cron issues (-B keytag-daily-report + -D
  keytag-bulk-reconcile) manually resolved — they can't naturally
  re-fire same day.
- **Companion fix (same day)** — initial pairing failures surfaced
  immediately after the DSN went in, traced to pg_net async delivery
  ordering. See migration `20260524210000_sentry_cron_checkin_pair_by_id.sql`
  (commit `3d9de2d`) — re-adds explicit `check_in_id` to both POST
  body + GET querystring so Sentry pairs by ID instead of recency,
  making pg_net's batch ordering irrelevant.

### CLN-11 · npm install + npm ci lock-file drift recurrence pattern (NEW 2026-05-23)

- **What** — `npm install <pkg>` (incremental adds) occasionally leaves
  transitive deps (notably `@emnapi/core` + `@emnapi/runtime` pulled in
  via Sentry's native bindings on Linux runners) UNRECORDED in
  `scheduler-app/package-lock.json`. Locally the install works (npm
  install is forgiving) but CI's `npm ci` is strict and fails with
  EUSAGE "Missing: @emnapi/X from lock file".
- **Why it keeps happening** — npm 11 + the way optional/native deps
  are resolved (Rollup native binaries, @emnapi rebuild flags) means
  the lock file's `optionalDependencies` tree is sometimes incomplete
  after `npm install <pkg>`. Affected runs so far:
  - 2026-05-22 PLAN-01 Phase 3 (eslint-config-next migration)
  - 2026-05-23 PLAN-03 Phase 1 (botid + @upstash deps)
- **Workaround (use after every `npm install -D` run)**:
  ```bash
  cd scheduler-app
  rm -rf node_modules package-lock.json
  npm install
  npm ci --dry-run  # verify lock is full
  ```
  Then commit + push the regenerated lock file. The size of the diff
  is large (hundreds of insertions/deletions) but legitimate — npm
  rewrites the lock to include the previously-missing transitive
  entries.
- **Permanent fix candidate** — add a pre-push hook check that runs
  `npm ci --dry-run` and rejects the push if lock is out of sync.
  Or move scheduler-app to pnpm (stricter lock file management). Both
  are bigger surgery; the workaround is acceptable for the v1 launch
  cycle.
- **Source** — CI run 26323221261 (Plan 03 Phase 1+4 push) reproduced
  the same EUSAGE error from the earlier CI run 26319790437
  (Plan 01 Phase 3).

### CLN-9 · pgTAP suite has 5 stale-schema failures — **RESOLVED 2026-05-25**

All 5 stale assertions corrected so the pgTAP suite goes green
without `continue-on-error`:

1. **Test 50/51** (`hold_waiter_slot` signature) — migration
   20260516230000 widened the 8th arg `idempotency_key` from
   `integer` → `text`. Test signature array updated to match;
   inline comment added so a future re-narrowing has to update
   both sides.

2. **Test 52** (`testing_services` count) — Phase 1 seeded 14
   rows, then migrations 20260518141655 (check_ac) +
   20260521171000 (exhaust_service) each added 1. Test updated
   to assert 16 + inline comment names the migrations to keep
   in sync.

3. **Test 11/12** (`scheduler_admin_audit_log.event_type` +
   `.event_detail`) — these columns NEVER existed on
   `scheduler_admin_audit_log`; the assertions were copy-paste
   from the `scheduler_audit_log` block above where the table
   name didn't get updated. Replaced with assertions for columns
   that DO exist on the admin table (`operation`,
   `diff_summary`, `table_name`) so we still get type-drift
   coverage on the admin surface.

Source: investigation triggered by CI staying red after the
@emnapi lockfile fix (aae74c4). Chris's correct push-back: "anything
pre-existing you wrote — we need to fix it" — these tests were
mine to repair, not document around.

### CLN-9 (historical) · pgTAP suite has 5 stale-schema failures — `continue-on-error` in CI (NEW 2026-05-22)

- **What** — `supabase test db` against the local Supabase fails 5 of
  ~109 tests across 3 files because the test SQL is stale relative to
  the current schema:
  - `scheduler_phase1_schema.test.sql:393` — calls
    `hold_waiter_slot(integer, uuid, unknown, unknown, date, time,
    unknown, integer)` but the current function signature uses different
    typed params (function was refactored, tests not updated)
  - `scheduler_phase1_schema.test.sql:50-52` — assertion
    `testing_services seeded with 14 rows for shop 7476` is now off — the
    catalog grew to 23 active + 3 deprecated rows after the 2026-05-19
    refactor + 2026-05-21 exhaust_system_testing addition
  - `scheduler_phase2_schema.test.sql:11-12` — assertions
    `scheduler_admin_audit_log.event_type is text` +
    `event_detail is jsonb` are stale — columns were renamed (the table
    exists, but with different column names)
  - `scheduler_rls_negative.test.sql:54` — INSERT into `otp_codes`
    omits `salt` (required NOT NULL column added in a migration
    after the test was written)
- **Why deferred** — these are pre-existing test failures, NOT new
  regressions from Plan 01 Phase 4. The `continue-on-error: true` keeps
  CI green while these are tracked. The schema IS correct; the tests
  need updating.
- **When to revisit** — Plan 06 (test coverage expansion). Update each
  failing test to match the current schema:
  - hold_waiter_slot: update signature assertion + parameter types
  - testing_services count: change to range check (`>= 14`) or fetch
    `select count(*) from testing_services` dynamically
  - audit_log columns: read current schema, update column-type
    assertions to match
  - otp_codes negative-RLS test: include `salt` (any non-empty bytea)
    in the test INSERT
- **Source** — 2026-05-22 PLAN-01 Phase 4 CI run 26320134478. The
  CI workflow now sets `continue-on-error: true` on the pgtap job
  with a comment pointing here.

### CLN-10 · Playwright smoke can't run against stub-env Next.js build (NEW 2026-05-22)

- **What** — the `playwright-smoke` CI job builds Next.js with stub
  env vars (`NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co`
  etc.) and serves it on localhost:3000. The `/book-v2` Server
  Component fails to render the greeting card because it hits Supabase
  for session/shop context on first render; with stub creds the fetch
  throws and the error boundary or empty page renders.
- **Why deferred** — getting the smoke test to work in CI without
  real credentials requires either (a) bundling a mocked Supabase
  client into the build, (b) running against a real Vercel preview
  deployment with `VERCEL_AUTOMATION_BYPASS_SECRET` set as a GitHub
  Action secret, or (c) standing up local Supabase in CI like the
  pgtap job does. All three are non-trivial.
- **Current mitigation** — the `playwright-smoke` job is gated on
  `if: github.event_name == 'workflow_dispatch'` — it only runs on
  manual trigger. The smoke spec still exists and runs locally
  against `http://localhost:3000` with real `.env.local` creds.
- **When to revisit** — Plan 06 (test coverage expansion). The
  recommended path is (b) — Vercel preview deployments — because:
  - PR-preview deploys land before CI runs against them, so they
    test the actual artifact that's about to merge
  - The bypass-secret flow is documented in
    `scheduler-app/playwright.config.ts`
  - No need to maintain a parallel "CI build with stubs" path
- **Source** — 2026-05-22 PLAN-01 Phase 4 CI run 26320134478. The
  workflow gating + comment point here.

### CLN-8 · `react-hooks/refs` + `react-hooks/set-state-in-effect` lint warnings (NEW 2026-05-22)

- **What** — the v6 `eslint-plugin-react-hooks` rules introduced as part
  of PLAN-01 Phase 3A (ESLint migration off `eslint-config-next`) flag
  5 pre-existing scheduler-app patterns:
  - `src/components/scheduler/OtpInput.tsx:100,102` — `priorAttemptsRef.current`
    read during render to detect attempts-remaining decrement
  - `src/components/scheduler/heritage/SummaryCard.tsx:125` — synchronous
    `setRemaining(null)` inside the countdown effect
  - `src/components/scheduler/wizard/OfflineBanner.tsx:29` — synchronous
    `setIsOffline(true)` on mount when `navigator.onLine === false`
- **Why deferred** — these are React Compiler advisories, not silent-failure
  bugs. The current patterns work in production today (verified via
  appointments.jeffsautomotive.com). Fixing them requires non-trivial
  refactor of the OTP comparison flow + the countdown effect — risky for
  v1 launch. Rules downgraded from `error` to `warn` in
  `scheduler-app/eslint.config.mjs` so CI is unblocked.
- **When to revisit** — post-launch refactor pass, before adopting
  React Compiler. Each site has a documented fix in the rule message
  (move ref read into `useEffect` for OtpInput; use derived state or
  move into event handler for SummaryCard; mirror via `useSyncExternalStore`
  or a render-time read of `navigator.onLine` for OfflineBanner).
- **Source** — 2026-05-22 PLAN-01 Phase 3A ESLint migration. Companion
  `Unused eslint-disable directive` warnings (4 sites) auto-clean once
  the underlying rules are reactivated.

### CLN-15 · Drop `revalidatePath` fallback from `applyWizardTransition` (NEW 2026-05-24/25)

- **What** — Plan 04 Phase 5B added `revalidateTag(sessionTag(chatId))` for
  per-session cache invalidation AND kept `revalidatePath("/", "page")` as
  a defense-in-depth fallback (down from the pre-Phase-5B 3-path loop
  `/`, `/book`, `/book-v2`). The fallback catches any RSC reader that
  isn't yet wrapped in `getCachedSessionRow` — if a future reader gets
  added without tag instrumentation, the path-revalidate keeps it from
  going stale.
- **Why deferred** — current Phase 5B verification confirms only 3 RSC
  readers exist (`hydrate-session.ts`, `get-current-card.ts`,
  `build-summary-data.ts:buildSummaryCardPayload`) and all are wrapped.
  But there's no automated check that prevents a future PR from adding
  a 4th uninstrumented RSC reader. Until we have that check (or a
  re-verification pass after substantial scheduler-app work), the
  fallback is cheap insurance.
- **What to do when revisited:**
  1. Re-run the Phase 5B verifier agents (Explore, Opus): "find every
     supabase-js read of `customer_chat_sessions` in
     `scheduler-app/src/` and confirm each RSC-level read goes through
     `getCachedSessionRow`." If both verifiers come back clean → safe
     to drop.
  2. Edit `scheduler-app/src/lib/scheduler/wizard/transition.ts`: remove
     the `revalidatePath("/", "page")` line. Keep the
     `revalidateTag(sessionTag(args.chatId))` line.
  3. Edit the related tests (`transition.test.ts`,
     `run-diagnostics.test.ts`, `submit-start-over.test.ts`) to remove
     the `revalidatePath` assertions.
  4. Add a hook or lint rule that BLOCKS new `supabase.from(
     "customer_chat_sessions").select` calls in any file UNDER
     `src/components/` (the RSC surface) — they must go through
     `getCachedSessionRow` instead.
- **Risk if NOT addressed** — none for current customers; the fallback
  is doing zero harm beyond invalidating slightly more cache than
  strictly needed when a transition fires. The Phase 5B per-session
  granularity already wins back the 3-paths-becomes-1 reduction.
- **When to revisit** — after any large scheduler-app feature work
  (e.g., a new wizard step OR a new RSC surface), OR ~3 months from
  Phase 5B landing if no significant scheduler-app refactor has shipped
  (gives time for the cache pattern to bed in + the verifier-agent
  pattern to mature).
- **Source** — Plan 04 Phase 5B 2026-05-24/25, per spec's mitigation
  "Keep `revalidatePath` as a fallback (single-path, not 'layout'
  scope)." The fallback was always intended as a temporary safety net.

### CLN-13 · Email send for `appointment_verification_mismatch` manual reviews — **RESOLVED 2026-05-25 (P1.7)**

**Resolution** — shipped new edge fn `scheduler-manual-review-email`
+ Vercel client `scheduler-app/src/lib/scheduler/manual-review-email-client.ts`
+ wired fire-and-forget into `submit-summary.ts` after `create_manual_review`
returns the AVM code. Email template renders the same laymen-terms layout
as the keytag manual-review emails with category-specific body for
`appointment_verification_mismatch` (per-issue diff block + 3 advisor
options + "code AVM-XXXXXX option a" footer). Same Pattern A bearer auth
+ Resend `Idempotency-Key` keyed on the 6-char code as the keytag path.
Tests cover happy path + RPC error suppresses email + email-ok=false +
email throws — all paths verified non-blocking for the customer flow.

Path taken: Path 1 (new edge fn) per the original recommendation. Vercel
client mirrors `booking-direct-client`'s 2-layer host validation (P0.3).

Operator pre-launch: ensure `RESEND_API_KEY` is set on the edge fn's
Supabase secrets (Project Settings → Edge Functions → Secrets); the fn
returns 503 with `resend_not_configured` if missing.

**Historical context below preserved for posterity.**

### CLN-13 (historical) · Email send for `appointment_verification_mismatch` manual reviews (NEW 2026-05-24/25)

- **What** — Plan 04 Phase 4 ships the `appointment_verification_mismatch`
  manual review (Pattern B AVM-XXXXXX code) via the existing
  `create_manual_review` RPC. The review row is created in
  `keytag_manual_reviews` so advisors can query it by category. **The
  per-issuance email send is NOT wired.** Keytag-category reviews fire
  an email automatically via the Deno-side `issueManualReview` helper +
  `sendManualReviewEmail` — but that path is in
  `supabase/functions/_shared/` and not importable from the Vercel/Node
  Server Action that submit-summary runs in.
- **Customer impact** — advisors can FIND scheduler verify-mismatch
  reviews by querying `keytag_manual_reviews WHERE
  category='appointment_verification_mismatch'`. They just won't get
  pushed an email when one fires. The Sentry ERROR alert
  (`appointment_verification_mismatch`) is the live notification today.
- **Why deferred** — Phase 4's structural fix (atomically persist the
  needs_review state + create a queryable review row + apology bubble)
  is the load-bearing change. Email is the convenience-notification
  layer. Doing it in the same commit would have either (a) required a
  new edge fn surface + deployment, or (b) required pulling Resend SDK
  into scheduler-app's Node runtime (a different vendor-touch question)
  — both bigger scope than the structural fix.
- **Two paths forward** when ready:
  1. **New edge function `scheduler-manual-review-email`** that takes
     `{review_id}`, looks up the row in `keytag_manual_reviews`, and
     dispatches the email via the existing Deno `sendManualReviewEmail`
     helper. The Vercel Server Action POSTs to this fn after the
     `create_manual_review` RPC succeeds (fire-and-forget; failure
     surfaces to Sentry, doesn't block customer).
  2. **Direct Resend integration on Vercel** — install `resend` npm
     package in scheduler-app, replicate the email template logic from
     Deno `manual-review-email.ts` into a Node-importable module, send
     directly from the Server Action.
- **Recommendation** — Path 1 (new edge function) is the cleaner shape
  because it reuses the existing Deno email template (single source of
  truth for AVM + ORP + DRF + REG + ARN + PAF copy) and matches the
  current architecture where scheduler-app dispatches all integration-
  vendor calls through edge functions (booking-direct, otp-direct,
  step2-direct). Estimated effort: ~2 hr for the new fn + Server Action
  wire-up + 1-2 tests.
- **When to revisit** — when scheduler appointments hit real customer
  volume + advisor team confirms the Sentry-only notification surface
  isn't sufficient. Until then, the DB-queryable review is the canonical
  record + Sentry is the alarm.
- **Companion item** — eventual `keytag_manual_reviews` → `manual_reviews`
  table rename (pure DDL refactor); the table holds both keytag + scheduler
  + future manual-review categories.
- **Source** — Plan 04 Phase 4 (2026-05-24/25) — scope decision to keep
  phase narrow + ship the structural fix first.

### CLN-12 · RESET_COLUMNS divergence between auto-stale reset + manual Start Over (NEW 2026-05-24)

- **What** — Plan 04 Phase 1B audit surfaced that the two reset paths
  in scheduler-app cover DIFFERENT column sets:
  - **Auto-stale reset** (`hydrate_session_reset` RPC, called from
    `hydrate-session.ts` when status='timed_out'/'abandoned' or
    active+age>5min) wipes 43 wizard-state columns including
    `pending_candidates` + `customer_self_identified`.
  - **Manual "🔄 Start over" reset** (`submitStartOverV2` →
    `applyWizardTransition` payload at
    `scheduler-app/src/lib/scheduler/wizard/actions/submit-start-over.ts:96-141`)
    wipes 41 columns — OMITS `pending_candidates` +
    `customer_self_identified`.
- **Customer impact** — if a customer hits the footer "Start over"
  button mid-session, stale state from the prior session could leak
  into the new one:
  - `pending_candidates`: the multi-account-choice list (which
    customers in the DB matched the phone number lookup); leftover
    state could confuse the multi-account-choice card if re-reached.
  - `customer_self_identified`: the greeting answer
    (returning/new); leftover state could pre-fill the new session's
    greeting before the customer answers it.
- **Why deferred** — Phase 1B intentionally narrowed scope to "atomize
  the existing auto-stale reset without changing its column set" —
  fixing the divergence in the same commit would have widened blast
  radius. The auto-stale path (the RPC) is the canonical reset; the
  manual Start Over path is the one missing columns.
- **Why two paths in the first place** — the divergence is a
  pre-existing bug, not a deliberate design. The two paths were
  written separately (auto-stale in `hydrate-session.ts` 2026-05-16,
  manual Start Over in `submit-start-over.ts` later same week) and
  diverged through copy-paste drift.
- **When to revisit** — Plan 06 Phase X already foreshadows the fix:
  "extract RESET_COLUMNS to a shared `reset-columns.ts` module that
  both call sites import." Either approach works:
  - **(a)** Extract a shared `scheduler-app/src/lib/scheduler/reset-columns.ts`
    constant; import in both `submit-start-over.ts` AND in a future
    refactor that has `hydrate_session_reset` consume the same shape
    via a generic reset RPC.
  - **(b)** Add the 2 missing keys to `submit-start-over.ts`'s
    `applyWizardTransition` payload (1-line fix), preserving the
    current 2-path architecture.
  Option (b) is the cheap fix; option (a) is the right long-term shape.
- **Source** — 2026-05-24 Plan 04 Phase 1B audit pass. Captured in the
  Phase 1B migration header comment + REMEDIATION-PROGRESS.md row.

---

## Content / MD docs

### MD-2 · `exhaust_system_testing` not linked to Tekmetric canned_job (NEW 2026-05-21)

- **What** — the new `exhaust_system_testing` testing_services row
  (added 2026-05-21 via migration
  `20260521171000_scheduler_exhaust_service_and_boundary_callouts.sql`)
  is priced $39.99 to match the existing Tekmetric canned_job for
  "exhaust evaluation" (per Chris). There is no testing_services →
  Tekmetric canned_jobs linkage table seeded yet, so when this
  service ships and a customer accepts the recommendation, the
  appointment-creation path has no automatic way to attach the
  matching canned_job to the Tekmetric work order.
- **Why deferred** — the testing_services ↔ Tekmetric canned_jobs
  mapping table is its own design problem (every active testing
  service needs the same mapping). Doing it just for
  exhaust_system_testing would create a partial pattern. Better
  to design the full mapping table once.
- **Customer impact** — currently zero (no real customer traffic
  yet). When live, the workaround is the same as for every other
  testing_service: advisors manually pick the canned_job in
  Tekmetric after the customer confirms.
- **When to revisit** — when the testing_services → canned_job
  mapping table is designed (likely as part of the Tekmetric
  appointment-sync hardening pass).
- **Source** — 2026-05-21 exhaust catalog gap fix.

### MD-1 · `docs/chat-instructions/scheduler/templates/closed-dates.md` lists 9 holidays NOT in DB (NEW 2026-05-18; format verified 2026-05-19)

- **What** — `docs/chat-instructions/scheduler/templates/closed-dates.md` lists 9 explicit
  holidays (memorial-day, independence-day, labor-day,
  thanksgiving, day-after-thanksgiving, christmas-eve,
  christmas-day, new-years-eve, new-years-day). Querying the DB
  for `closed_dates` shop=7476 returns **only `source='default-sunday'`
  rows** (105 of them; 0 explicit holidays). The MD was never
  uploaded via `upload_closed_dates_md` after the 2026-05-18
  regeneration pass.
- **Format check (2026-05-19)** — the MD is **the current format**,
  not an older version. Verified by reading the
  `uploadClosedDatesMd` parser in
  `supabase/functions/_shared/tools/scheduler-admin.ts:1330`:
  `CLOSED_COLUMNS = ["closed_date", "reason"]` — the MD has
  exactly those two columns. The MD is ready to upload as-is.
- **Architecture doc gap (now corrected)** —
  `scheduler_system_architecture.md` 2026-05-18 (latest+4) section
  claimed "closed-dates.md | Matches DB future-set (Sundays
  auto-managed by cron; 9 holidays listed)" — that was misleading:
  the holidays are in the MD but not in DB.
- **Why deferred** — Chris needs to decide: upload via
  `upload_closed_dates_md` to seed the 9 holidays into the DB,
  OR strip them from the MD if the holidays should be left to
  Tekmetric's own calendar. Either side fixes the drift.
- **Customer impact** — currently zero (no real customer traffic,
  no domain mapped). When traffic starts, customers attempting to
  book on a "documented" holiday would succeed and the booking
  would hit Tekmetric. If Tekmetric is closed that day, the staff
  cleans up manually.
- **When to revisit** — before public rollout. Quick decision +
  fast fix.
- **Source** — 2026-05-18 docs/scheduler audit (sub-agent); format
  check 2026-05-19.

---

## LLM quality

### LLM-1 · `diagnoseConcern` hallucination on subcategory slugs / question IDs — RESOLVED 2026-05-21

- **Resolution** — superseded by the 3-stage classifier refactor (functions
  commit `5e7bba5`, deployed 2026-05-21). The new pipeline uses Anthropic SDK
  native structured outputs (`output_format: json_schema` + `betas:
  ["structured-outputs-2025-11-13"]`) with constrained decoding, which makes
  it impossible for the LLM to emit a subcategory_slug or question_id
  outside the injected catalog. Schema-fail rate dropped to 0/25 on batches
  5-9 (vs 12% under the original AI SDK + Anthropic generateObject path).
- **Stage progression that closed this:**
  - Stage 1 (category pick): brief catalog, constrained-enum output. 0/25 fails.
  - Stage 2 (subcategory pick): per-category subcategory list, constrained-enum. 0/25 fails.
  - Stage 3 (fact extraction): 29-slot ExtractedFacts schema with enum-constrained
    values; deterministic mapper consumes facts (no LLM judgment on which
    question_ids are answered — pure TS).
- **Quality measurements** — see `docs/chat-instructions/diagnostic-llm-tests/`
  for the batch-by-batch progression from llm-test-1 (single-stage Anthropic,
  60% match) through llm-test-9 (3-stage Anthropic SDK, 88%+ match with 0
  hallucinations / 0 silent filters).

### LLM-2 · `other` subcategory count drift vs spec — RESOLVED 2026-05-18

- **Resolution** — 2026-05-18 multi-agent audit verified the DB has
  exactly **6 active `other` subcategories** for shop=7476, matching
  `chat-design.md §7.1` spec. The CAT-2 canonical rebuild migration
  (`20260518163925_scheduler_concern_catalog_canonical_rebuild.sql`)
  seeded the correct set. The earlier "10 subcategories" finding
  was stale — pre-CAT-2.
- The 6 subcategories: `after_a_recent_accident_or_impact`,
  `after_recent_service_or_repair_work`,
  `car_has_been_sitting_unused_for_a_long_time`,
  `general_check_up_or_pre_trip_inspection`,
  `multiple_symptoms_not_sure_what_category`,
  `safety_concern_dont_feel_safe_driving_it`.
- **Source of resolution** — 2026-05-18 Supabase MCP audit
  (sub-agent direct query: `SELECT slug FROM concern_subcategories
  WHERE category='other' AND active=true AND shop_id=7476;`
  returned 6 rows).

### OBS-7 · `AI_LoadAPIKeyError` in `runDiagnosticsV2` — RESOLVED 2026-05-18 (transient)

- **What** — Sentry issue
  [`JEFFS-APP-V2-TEST-FUNCTIONS-B`](https://jeffs-automotive.sentry.io/issues/?query=JEFFS-APP-V2-TEST-FUNCTIONS-B):
  6 events between 2026-05-16T16:55Z and 2026-05-18T02:29:54Z, all
  tagged with releases `98cbac0` / `c7a3614` / `74f1c76` /
  `ef4efce`. Culprit `serverAction/runDiagnosticsV2`. Error
  `AI_LoadAPIKeyError: Anthropic API key is missing.`
- **Resolution** — Vercel auto-deploys on every push to `main`. The
  `ANTHROPIC_API_KEY` env var was added to Vercel 2026-05-17 ~16:00 UTC,
  and every subsequent deployment (releases `59561f6` at 2026-05-18
  15:21 UTC and 8 deploys onward through current HEAD `d4d9db7` at
  2026-05-19 01:08 UTC) picked it up automatically. Zero
  AI_LoadAPIKeyError events have fired since (verified via Sentry
  MCP — last 24h events come from releases `59561f6` / `dfaac2e` /
  `2618f84` / `f557db0` and none are AI_LoadAPIKeyError).
- **Initial audit misread (kept for transparency)** — the 2026-05-18
  audit pass initially classified this as an ACTIVE pre-launch
  blocker, assuming the doc's stated deploy path (`vercel deploy
  --prod` CLI) was canonical and that a manual redeploy was needed.
  Chris pointed out the actual deploy path is `git push origin main`
  → Vercel auto-deploy. Re-verification via Vercel MCP showed the
  current `main` HEAD `d4d9db7` IS the active production deploy and
  has `ANTHROPIC_API_KEY` available at runtime. **No intervention
  required.** Architecture doc §11 was corrected in the same pass
  to document push-to-main as the canonical deploy trigger.
- **Lesson learned** — when assessing "is this issue still active",
  cross-check Sentry events' `release` tag against the current
  Vercel deploy SHA. Events tagged with an older release SHA are
  from older deployments that may already be replaced.
- **Source** — 2026-05-18 multi-agent audit + Chris's correction +
  Sentry MCP re-verification.

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

### TEST-2 · Component tests for the 26 V2 actions

- **What** — only 1 of 27 V2 actions has a unit test
  (`submit-start-over.test.ts`). The remaining 26 are uncovered.
  Phase 17 ("Test suite migration") is the canonical owner per
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
