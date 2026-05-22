---
agent: audit-tests-ci
timestamp: 2026-05-22T03:00:00Z
---

# Tests + CI audit

## Executive summary

- 11 unit-test files exist (10 Vitest + 1 colocated mapper test); 1 Deno test file; 3 pgTAP files. **Zero Playwright E2E** tests, **zero CI workflows**, **zero pre-commit hooks**.
- Test surface is heavily skewed to UI presentational components (6 of 11 Vitest files) and a few pure helpers. The **3-stage diagnostic LLM call path (`diagnose-concern.ts`, 1287 lines)** has zero direct tests — only the deterministic mapper downstream of Stage 3 (`question-fact-mapper.test.ts`) and the unrelated `parse-customer-note.ts` LLM helper are covered. Stage 1/2/3 call assembly, JSON-schema gating, and Anthropic-via-AI-Gateway retry are entirely untested.
- Only **1 Server Action of ~25** has unit tests (`submitStartOverV2`). The remaining ~24 Server Actions under `src/lib/scheduler/wizard/actions/` (submit-phone-name, submit-otp, submit-vehicle-pick, submit-summary, submit-service-and-concern-picker, submit-clarification-answer, submit-testing-service-approval, submit-date, submit-waiter-time, submit-escalate, submit-back, run-diagnostics, etc.) are untested.
- **No tests** on `IdleTimer` (the 2026-05-21 event-reset reliability fix is regression-prone), `keytag-tekmetric-webhook` (1120-line Tekmetric webhook handler), `tekmetric-webhook` (passive logger), `appointments-sync` cron (457 lines), `keytag-bulk-reconcile` cron, `keytag-daily-report` cron, `transcript-dispatcher`, or any of the 17 edge functions.
- **No CI workflow**: `.github/` directory does not exist. No husky / lint-staged. Nothing prevents merging broken type-check, broken lint, or failing tests. The dev experience expects Chris to run `npm run typecheck && npm run lint && npm run test` manually before pushing.
- **pgTAP coverage is good** for what it covers (phase 1 + phase 2 schema, negative RLS with row-count assertions per the canonical gotcha) but there is **NO `supabase test db` runner wired into anything**, so the tests rely on human discipline.
- `test:e2e` script (`playwright test`) exists in `package.json` but `playwright.config.*` does NOT exist, `e2e/` and `tests/integration/` directories do NOT exist — the script will fail. `@playwright/test` and `@axe-core/playwright` are devDependencies but unused.

## Test inventory

### Vitest tests (11 files)

| file | covers |
|---|---|
| `scheduler-app/tests/unit/routine-services-cache.test.ts` | `getRoutineServicesForChips` 5-min TTL cache, retry on Supabase error. 5 tests. Mocks `createSupabaseAdminClient`. |
| `scheduler-app/tests/unit/supabase-admin.test.ts` | `createSupabaseAdminClient` env-var resolver — 2026 `SUPABASE_SECRET_KEYS` JSON, `SUPABASE_SECRET_KEY` legacy, `SUPABASE_SERVICE_ROLE_KEY` fallback, error messages. 8 tests. |
| `scheduler-app/tests/unit/parse-customer-note.test.ts` | LLM helper `parseCustomerNote` wrapper around `generateObject` — mocks `ai.generateObject`. Tests Zod gate, 150-char trim, attempt 1 vs 2 prompt switching, fail-safe on LLM error. 7 tests. |
| `scheduler-app/tests/unit/get-current-card.test.ts` | View-builder `getCurrentCard` — `step=null → greeting`, `customer_notes` approval mode, `completed` waiter vs dropoff label format. 7 tests. Stubs out `booking-direct-client`, `routine-services-cache`, `availability`. |
| `scheduler-app/tests/unit/submit-start-over.test.ts` | Server Action `submitStartOverV2` — wipes wizard cols, resets `current_step='greeting'`, deletes messages, inserts `session_restarted` audit, revalidates `/book-v2`. 6 tests. |
| `scheduler-app/tests/unit/WaiterTimePicker.test.tsx` | UI component — button-per-time render, click emits `selected_time`, double-submit prevention, empty fallback. 7 tests. |
| `scheduler-app/tests/unit/OtpInput.test.tsx` | UI component — 6-digit autosubmit, countdown decrement, expired disable, digit-strip, backspace nav. 6 tests. Uses fake timers. |
| `scheduler-app/tests/unit/EscalationCard.test.tsx` | UI component — copy + phone formatting + 2-CTA emit + reason audit text. 8 tests. |
| `scheduler-app/tests/unit/VehiclePicker.test.tsx` | UI component — vehicle button, add-new flow, double-submit guard, empty fallback. 7 tests. |
| `scheduler-app/tests/unit/CalendarDatePicker.test.tsx` | UI component — month/grid render, available vs disabled dates, past-date guard, next/prev month nav, dropoff vs waiter copy. 8 tests. Uses fake timers + `setSystemTime`. |
| `scheduler-app/tests/unit/ServiceAndConcernPicker.test.tsx` | UI component — chip toggle, submit picks, empty-picks alert, free-price render, "Other Issue" pseudo-chip. 11 tests. |
| `scheduler-app/src/lib/scheduler/wizard/llm/question-fact-mapper.test.ts` | **Colocated** — `matchQuestionsToFacts` + `isFactPresent` for the deterministic mapper that consumes Stage 3 facts. 26+ tests anchored to real LLM eval batch concerns. 441 lines — by far the most rigorous test file. |

### Deno tests (1 file)

| file | covers |
|---|---|
| `supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts` | Pure helpers `parseServiceKeyList` (sentinel/comma/de-dup) + `arraysEqualAsSets` + `parseMdTable` (happy / empty cell / bad-separator) for the subcategory→service MD uploader. ~14 tests. |

### Playwright tests

**None.** `test:e2e` npm script (`playwright test`) is declared in `scheduler-app/package.json` but there is no `playwright.config.{ts,js}`, no `e2e/`, no `tests/integration/`. The script will fail. `@playwright/test` and `@axe-core/playwright` are installed but unreferenced.

### pgTAP tests (3 files)

| file | covers |
|---|---|
| `supabase/tests/database/scheduler_phase1_schema.test.sql` | 13 Phase-1 tables exist; critical column types; CHECK constraints (channel/sentiment/appointment_status/appointment_type); RLS enabled on all 13; indexes (partial+GIN); `hold_waiter_slot` signature; seed counts (testing_services 14, routine_services 10, closed_dates ≥100 Sundays, appointment_sync_state shop 7476); abbreviation presence (no TBD); architectural claims: advisory lock prevents 3rd hold on capacity-2 waiter slot, ON DELETE CASCADE on session removes children, soft-delete preserves rows, UNIQUE constraints reject dupes. ~50 assertions. |
| `supabase/tests/database/scheduler_phase2_schema.test.sql` | 7 later-added tables (scheduler_audit_log, scheduler_admin_audit_log, concern_questions, concern_subcategories, concern_category_guidelines, appointment_default_limits, scheduler_error_log) exist with right columns + RLS + scheduler_error_log CHECK constraints on origin/level enums + FK concern_questions.subcategory_id. |
| `supabase/tests/database/scheduler_rls_negative.test.sql` | Critical — **uses row-count assertions, NOT exception assertions** per pattern-compliance.md silent-filter gotcha. anon + authenticated `SELECT/UPDATE/DELETE` against customer_chat_sessions, customer_chat_messages, appointment_holds, otp_codes, testing_services, routine_services, appointments, scheduler_error_log → expects 0 rows affected. INSERT against deny_all → expects throw. service_role bypass sanity check (catches future regressions to USING (false)). |

## CI workflow

**None.** `.github/` directory does NOT exist. No GitHub Actions, no Vercel build hooks beyond Vercel's default `next build` (which runs `next lint` only if configured, and does NOT run Vitest, Deno test, or pgTAP).

Nothing prevents pushing code that:
- fails `tsc --noEmit` typecheck
- fails ESLint
- fails Vitest
- fails Deno test
- fails pgTAP
- introduces RLS regressions
- breaks the wizard

No pre-commit / pre-push hook either (no `.husky/`, no `lint-staged` in package.json).

## Coverage matrix

| area | unit tests | E2E? | RLS pgTAP? | known gaps |
|---|---|---|---|---|
| diagnose-concern (3-stage LLM) | 0 (only downstream mapper tested) | n | n/a | Stage 1/2/3 prompt assembly, JSON-Schema gating, AI Gateway retry, error fallback. 1287 LoC untested. |
| question-fact-mapper | 26+ tests | n/a | n/a | strong; anchored to real eval cases |
| Server Actions (Step 1 – Step 7) | 1 of ~25 (submit-start-over) | n | n/a | 24 actions untested: submit-greeting, submit-phone-name, submit-otp, submit-customer-info-edit, submit-new-customer-info, submit-vehicle-pick, submit-new-vehicle, submit-service-and-concern-picker, submit-customer-question, submit-customer-notes, submit-explanation, run-diagnostics (the entire 582-line aggregator), submit-clarification-answer, submit-testing-service-approval, submit-second-routine-pass, submit-appointment-type, submit-date, submit-waiter-time, submit-summary, submit-escalate, submit-back, dismiss-escalation, submit-multi-account-choice, submit-no-match-choice, submit-partial-verification-choice, resend-otp, fire-transcript-dispatch |
| DAL functions | 0 — `src/lib/dal/` doesn't exist | n | n/a | The architecture per pattern-compliance.md prescribes Thin Action / Fat DAL, but there's no `src/lib/dal/` directory. Business logic lives in actions + `chat-store.ts` + direct-client files + `wizard/` helpers. Coverage threshold of 80% (vitest.config.ts) targets `src/lib/**` which currently includes those files but coverage isn't being measured (no CI). |
| IdleTimer | 0 | n | n/a | 241 LoC client component with the 2026-05-21 widened event set + capture-phase listeners + 5-min timeout + 20s warning. No regression guard for the recently-fixed event-reset bug. |
| Wizard transitions | 0 | n | n/a | `transition.ts`, `route-after-diagnostics.ts`, `applyWizardTransition`, `append-bubble.ts`, `ensure-concern-summaries.ts` all untested |
| Keytag system (8 tools) | 0 unit | n/a | partial (RLS on keytag tables not in pgTAP files reviewed) | `assignKeytagToRo`, `releaseKeytagFromRo`, `whoIsOnTag`, `revertKeytagToAssigned`, `markKeytagPosted`, `runBulkReconcile`, `getKeytagAuditHistory` — none tested. Confirmation token + manual review patterns untested. |
| Tekmetric webhook handler | 0 | n | n/a | `tekmetric-webhook` (212 LoC) — token validation, header stripping, event classification, dedup via `tekmetric_webhook_events` table. `keytag-tekmetric-webhook` (1120 LoC) — 5 flow paths (ro_work_approved, ro_status_updated, ro_sent_to_ar, ro_posted, payment_made) all untested. |
| Appointments sync cron | 0 | n/a | n/a | 457-LoC edge function — Tekmetric rolling-window pull, soft-delete, prune. Untested. |
| RLS policies (per-table) | n/a | n/a | partial | Phase-1 + Phase-2 scheduler tables covered with row-count assertions. **NOT covered**: keytag tables, OAuth refresh tokens, tekmetric_webhook_events, appointment_default_limits, concern_subcategories, concern_category_guidelines, concern_questions (positive read paths). |
| Scheduler admin upload tools | partial — 14 Deno tests on pure parsers | n/a | n/a | The MD-parser primitives are tested. The end-to-end uploader (dry-run → diff → apply with confirm_token) is "smoke-tested via curl after deploy" per the test file's comment — no automated coverage of `dry-run` JSON diff, confirm_token enforcement, or rollback. `scheduler-admin.ts` mutation tools untested. |
| Edge fn Sentry wrap | 0 | n/a | n/a | 4 edge functions wire `sentry-edge.ts` (`appointments-sync`, `transcript-dispatcher`, `keytag-bulk-reconcile`, `keytag-daily-report`). No test verifies `Sentry.withScope` actually wraps each handler nor that DSN env presence guards correctly. |

## Findings

### BLOCKER

1. **NO CI gate.** `.github/workflows/` does not exist. Pushing a branch that fails `tsc --noEmit`, ESLint, Vitest, Deno test, or pgTAP is undetected. Vercel's default build runs `next build` only — typecheck is implicit via build failure, but the test suites never run, RLS regressions never run, and there's no required-status-check protecting `main`. This is the single most important gap.

2. **NO unit tests on the 3-stage diagnostic LLM call path.** `diagnose-concern.ts` is 1287 lines. The Anthropic SDK + Vercel AI Gateway integration, the three JSON-Schemas, retry/fallback behaviour, and the structured-output validation gates are all entirely untested. Only the downstream deterministic mapper (`question-fact-mapper.test.ts`) has coverage. Because this code path WAS just refactored from 2-stage → 3-stage on 2026-05-21 (migration `20260521120000_scheduler_three_stage_classifier.sql`), regression risk is high right now.

3. **NO test of any Tekmetric webhook handler.** `tekmetric-webhook` (212 LoC) and `keytag-tekmetric-webhook` (1120 LoC) handle 5 production webhook flows including A/R lifecycle and tag assignment. Idempotency, token validation, header redaction, statusId branching — all live in code that has never been exercised by a test. Per `.claude/rules/observability.md` Rule 5+6 webhook idempotency + signature-verification logging is mandatory — neither is tested.

4. **`run-diagnostics` Server Action (582 LoC) has zero tests.** This is the orchestrator that calls `diagnoseConcern` per concern, aggregates results across concerns, dedups testing services, builds the clarification queue, and routes the wizard. It is the linchpin between Step 7.1 picker and Step 7.3 clarification/approval. Single largest untested business-logic surface.

5. **No `playwright.config.*` despite `test:e2e` script.** Either remove the script + remove devDependencies (`@playwright/test`, `@axe-core/playwright`) or wire E2E. Currently `npm run test:e2e` fails. No full-wizard E2E exists.

### IMPORTANT

1. **24 of ~25 Server Actions are untested.** Only `submit-start-over` has tests. Each Server Action under `src/lib/scheduler/wizard/actions/` carries multi-step DB mutations + wizard transition + audit-log inserts. The unit-test pattern is established (see `submit-start-over.test.ts` mock chain); adding equivalent tests is mechanical but uncovered.

2. **IdleTimer event-reset regression risk.** The 2026-05-21 fix widened the event set to include `mousemove`, `click`, `visibilitychange` and added capture-phase listeners. No test prevents reverting that fix.

3. **Webhook idempotency unverified.** `tekmetric-webhook` UPSERTs into `tekmetric_webhook_events`. The keying on `(event_id, source)` is dictated by the table schema but no test asserts dupe-rejection or the de-dup path. Per `observability.md` Rule 6 idempotency is required + DLQ behaviour on failure.

4. **Cron handlers untested.** `appointments-sync` (457 LoC), `keytag-bulk-reconcile`, `keytag-daily-report`, `transcript-dispatcher` — none. These functions wrap in `Sentry.withScope` per `_shared/sentry-edge.ts` but no test confirms the wrap nor the `BEGIN…EXCEPTION` paths in the cron SQL bodies (migration `20260516200000_scheduler_cron_exception_wraps.sql`).

5. **The 6 "Other" subcategories routing is untested.** `run-diagnostics.ts` routes to `second_routine_pass` when all concerns hit "other" subcategories or return null. The branching logic across (pending queue, recommendations, "other" routing) is the most complex single decision in the wizard and has no coverage.

6. **No DAL directory.** Per `pattern-compliance.md` "Thin Action / Fat DAL", business logic should live in `src/lib/dal/{module}.ts`. There is no `src/lib/dal/` folder. Business logic is mixed into actions + `chat-store.ts` + direct-client files. Adding tests now requires re-architecting first; the coverage threshold of 80% in `vitest.config.ts` cannot be hit until that's resolved.

7. **No `lint`/`typecheck`/`test` pre-commit hook.** Without husky/lint-staged or a CI gate, broken commits land on `main`. The 3-iteration agent retry protocol (orchestration.md Rule 5) assumes deterministic gates — without CI, those gates only fire at human review.

8. **`.env`-resolver tests are good but no test for the equivalent edge-runtime path.** `scheduler-auth.ts` and `sentry-edge.ts` DSN resolution in Deno functions parallel `createSupabaseAdminClient`'s env-resolver logic with NO test coverage.

9. **pgTAP not run by anything.** No `supabase test db` runner is invoked from any script. The 3 pgTAP files exist as a static safety net that depends on manual invocation.

### NICE-TO-HAVE

1. **Test files split between two roots.** Most live in `scheduler-app/tests/unit/`, one (`question-fact-mapper.test.ts`) is colocated next to source, and one Deno test is colocated under `supabase/functions/_shared/tools/`. Inconsistent. The colocated one is by far the most rigorous — that pattern is good and could be normalized.

2. **No shared test fixtures.** Each Server Action test rebuilds its own Supabase chain mock from scratch (compare `routine-services-cache.test.ts` vs `submit-start-over.test.ts` vs `get-current-card.test.ts` — three different chain-builder patterns). A shared `tests/fixtures/mock-supabase.ts` would cut boilerplate.

3. **`vitest.config.ts` declares an 80% coverage threshold** but no script enforces it (`test:coverage` exists but nothing fails CI). Threshold is aspirational only.

4. **MSW is installed (`msw@2.0.0`) but unused.** No `mockServiceWorker.js`, no `tests/msw/handlers.ts`. The test setup file (`tests/setup.ts`) has a TODO note: "Add MSW server.listen()/close() here once we wire MSW handlers (Story 2+)." Not done.

5. **Tests use `vi.useFakeTimers({ shouldAdvanceTime: true })` inconsistently** (CalendarDatePicker yes, OtpInput yes, others no) — depends on whether `userEvent` is involved. Could be standardised in `tests/setup.ts`.

6. **No test for `error.tsx` / `global-error.tsx` Sentry capture** per observability.md Rule 3 (mandatory `Sentry.captureException` in useEffect).

7. **No test for instrumentation.ts** `onRequestError = Sentry.captureRequestError` per observability.md Rule 4.

8. **No accessibility tests.** `@axe-core/playwright` is installed but unused. The wizard cards have ARIA labels under test (e.g., `aria-disabled` in CalendarDatePicker) but no full-page axe scan exists.

9. **Concern catalog seed integrity not tested.** Migrations `20260516220000_scheduler_concern_seeds_part1.sql` + `…part2.sql` + `20260521170000_scheduler_exhaust_subcategories.sql` seed concern_subcategories + concern_questions. The pgTAP files check Phase-1 tables but not these later seed counts/contents.

## File paths cited

- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/package.json` — npm scripts (`test`, `test:watch`, `test:coverage`, `test:e2e`, `lint`, `typecheck`)
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/vitest.config.ts` — jsdom env, 80% coverage threshold on `src/lib/**` + `app/api/**`
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/eslint.config.mjs` — `no-floating-promises`, `no-misused-promises`, `no-empty` with `allowEmptyCatch: false`
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/tests/setup.ts` — `@testing-library/jest-dom/vitest` extension; MSW TODO note
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/tests/unit/` — 10 of 11 Vitest files
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/src/lib/scheduler/wizard/llm/question-fact-mapper.test.ts` — colocated 441-LoC mapper test
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` — 1287 LoC, untested
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/src/lib/scheduler/wizard/actions/run-diagnostics.ts` — 582 LoC, untested
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/scheduler-app/src/components/scheduler/wizard/IdleTimer.tsx` — 241 LoC, untested
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/supabase/functions/tekmetric-webhook/index.ts` — 212 LoC, untested
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/supabase/functions/keytag-tekmetric-webhook/index.ts` — 1120 LoC, untested
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/supabase/functions/appointments-sync/index.ts` — 457 LoC, untested
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts` — 161 LoC, 14 Deno tests
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/supabase/tests/database/scheduler_phase1_schema.test.sql` — Phase 1 pgTAP, ~50 assertions
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/supabase/tests/database/scheduler_phase2_schema.test.sql` — 7 later-added tables
- `C:/Users/ChristopherGoodson/Apps/jeffs-app-v2-test-data/supabase/tests/database/scheduler_rls_negative.test.sql` — anon/authenticated negative RLS with row-count assertions

## Files / dirs that DO NOT exist (confirmed)

- `.github/` (no CI workflow whatsoever)
- `.husky/` (no pre-commit hook)
- `scheduler-app/playwright.config.{ts,js,mjs}` (despite `test:e2e` script)
- `scheduler-app/e2e/`
- `scheduler-app/tests/integration/`
- `scheduler-app/src/lib/dal/` (no DAL layer despite pattern-compliance.md requiring Thin Action / Fat DAL)
- `scheduler-app/tests/msw/handlers.ts` (MSW installed but not configured)
