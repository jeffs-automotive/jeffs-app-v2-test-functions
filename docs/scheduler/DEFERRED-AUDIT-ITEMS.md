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

---

## Content / MD docs

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

### LLM-1 · `diagnoseConcern` hallucination on subcategory slugs / question IDs

- **What** — 6 of 50 concerns in the 2026-05-18 eval failed with
  `"No object generated: response did not match schema"`. The LLM
  returned subcategory slugs or question IDs that don't exist in the
  catalog, causing Zod schema validation to reject the response.
  Failing concerns: brake grinding after recent replacement, steering
  wheel vibration over 60 mph, car shaking on right side, A/C blows
  warm (two variants), pulls to one side.
- **Why deferred** — the fail-safe path (forward-to-advisor) is
  triggered for these cases, so customers aren't stuck; they're just
  routed to advisor contact instead of getting diagnostic questions.
  Prompt-tuning is a separate quality pass, not a launch blocker.
- **When to revisit** — before any public rollout beyond Jeff's test
  environment. Target: < 5% schema-fail rate (currently 12%).
  Approach: tighten the prompt to enumerate only slug values actually
  present in the injected catalog block; add a "if unsure, return
  matched_category_key=null" fallback instruction.
- **Source** — `docs/scheduler/diagnose-eval-2026-05-18T12-10-40-771Z.md`
  (50-concern eval run).

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
