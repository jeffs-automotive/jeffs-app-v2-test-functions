# Scheduler-app audit cleanup — implementation plan (2026-06-13)

## Why

Acts on the 2026-06-12/13 line-by-line scheduler-app audit (146-agent Opus workflow;
116 raw findings, 114 survived adversarial verification, 2 refuted). The app is
structurally sound (no blockers/highs); this cleanup removes verified dead code, fixes
stale comments left over from the finished Phase 15/16 migration, and fixes 2 real
correctness bugs + a few functional-hardening items.

## Locked decisions (Chris, 2026-06-13)

1. **Sub-agent model:** Opus (fable unavailable in this env) — applied to the audit.
2. **Sequencing:** (1) stale comments → (2) dead code → (3) Tier-1 bugs. Three commits.
3. **Overlap rule:** do NOT fix comments in files Batch 2 deletes (the `/book-v2` route,
   `append-bubble.ts`). Repoint the e2e specs off `/book-v2` when the route is removed.
4. Read-only audit applied no code changes; all changes happen here under `implement`.

## Verification gate (run after EACH batch)

- `cd scheduler-app && npm run typecheck` — clean
- `cd scheduler-app && npx vitest run tests/unit src` — green (baseline 154 unit + colocated)
- After Batch 3: `npm run build` clean.
- Architecture doc (`.claude/memory/scheduler/scheduler_system_architecture.md`) +
  "Last updated" bumped per scheduler-app/CLAUDE.md, in the same commit.

---

## Batch 1 — Stale comments + stale generated types (commit 1)

Comment-only edits (no logic change). Skip files slated for Batch-2 deletion
(`app/book-v2/**`, `append-bubble.ts`). Notable value-mismatch fixes (real trip hazards):

- `app/page.tsx:4-12`, `app/book/page.tsx:9-12` — drop "Phase 16 will delete the legacy
  ChatBootstrap/AI-SDK/XState tree" (already deleted); keep the still-true Phase-15 line.
- `app/api/scheduler/mark-abandoned/route.ts:193` — threshold comment says `< 5_000`, code
  is `< 10_000`. Also `:36-39, 82-86` `verifyBeaconSig` → `verifyBeaconPayloadSig`.
- `src/components/scheduler/wizard/IdleTimer.tsx:205-211` — "< 5 seconds" → 10 seconds.
- `src/lib/scheduler/booking-direct-client.ts:14-16` — "30s timeout" → 45s.
- `submit-greeting.ts:10-13, 87-91` — drop deleted `session-actions.ts`/`bubble-templates.ts`
  legacy-surface refs.
- `submit-phone-name.ts:268-273` — comment says "stamp otp_sent_at"; code writes
  `otp_attempts = 0`. Fix comment to match code.
- `submit-new-customer-info.ts:105-117` — idempotency-replay comment overstates what the
  prior write persisted.
- `availability.ts:1-34` — header refs deleted `/book` chat + `/book-v2` + completed Phase 16.
- `submit-summary.ts:30-33, 306-308` — deleted `session-actions.ts:2208` ref; `availability.ts`
  line cite drift (128-137 → 183).
- `build-service-summary.ts:82-94` — comments describe comma-join; code newline-joins.
- `submit-back.ts:19-34` — header contradicts actual back-enabled steps (`summary`,
  `testing_service_approval`).
- `extracted-facts.ts:15-18` ("~28"→29 slots); `session-state.ts:10-12` ("23"→25 states);
  `routine-services-cache.ts:19,32-34` (deleted AI-SDK tool surfaces); `shop-clock.ts:175-179`
  (nonexistent `getShopClockToday()`); `step2-direct-client.ts:10-11` (deleted
  `orchestrator-client.ts`); `get-current-card.ts:9-30, 188-190` (completed phased build-out +
  stale `TODO(phase_06)`).
- Components: `CustomerQuestionCard.tsx:7` (Step 10.3→10.4); `ClarificationQuestionCard.tsx`,
  `GreetingCard.tsx`, `WizardFooter.tsx`, `CustomerNotesCard.tsx`, `NewVehicleCard.tsx`,
  `CalendarDatePicker.tsx` (5/6 widgets share the stale header) — drop AI-SDK/chat-agent refs;
  `WizardSurface.tsx:3-32`, `WizardProgress.tsx`, `WizardCrossCutting.tsx:9-13`,
  `BookPageShell.tsx:15-21` — drop "/book-v2 is live / three routes" framing.
- Config: `sentry.edge.config.ts`, `sentry.server.config.ts`, `middleware.ts:19-30` — drop
  deleted `app/api/chat/route.ts` + `loadChat` refs.
- Tests: `run-diagnostics.test.ts` (aggregate captureMessage → `Sentry.logger.info`;
  append-bubble mock comment), `transition.test.ts:17-18` (3-path revalidate claim),
  `tests/setup.ts:7` (drop never-landed MSW note). (e2e `/book-v2` nav handled in Batch 2.)
- Misc: `rate-limit.ts:41-49` (no such caller), `scripts/fix-env-encoding.mjs:64-65`
  (leading not trailing BOM).
- **`src/lib/database.types.ts`** — regenerate via Supabase MCP `generate_typescript_types`
  (adds `rate_limit_buckets` + `check_and_increment_rate_limit` from the 2026-06-02 migration).

## Batch 2 — Dead code removal (commit 2)

Delete (all repo-grep-verified zero production callers):
- **Files:** `src/lib/scheduler/wizard/append-bubble.ts`,
  `src/components/scheduler/heritage/ChatBubble.tsx`, `app/book-v2/page.tsx`,
  `app/book-v2/error.tsx` (whole `/book-v2` route). Remove 2 orphaned
  `vi.mock('@/lib/scheduler/wizard/append-bubble')` blocks (`run-diagnostics.test.ts:226-230`,
  `submit-start-over.test.ts:178-180`). Repoint e2e specs (`wizard-smoke.spec.ts`,
  `wizard-happy-path.spec.ts`) from `/book-v2` → `/book` and drop the book-v2/error assertion.
- **Dead exports/fns:** `shop-clock.ts` `getShopTodayPg`/`isAfterSameDayCutoffPg` (test-only —
  confirm tests; keep if a test asserts them, else remove with tests); `shop-tz.ts`
  `isAfterSameDayCutoff` + `DROP_OFF_BY_HOUR_DEFAULT`; `shop-config.ts` `getSchedulerShopId`;
  `beacon-hmac.ts` `signBeaconChatId`/`verifyBeaconSig`; `chat-store.ts`
  `SessionStatus`/`SessionOutcome`; `manual-review-email-client.ts` `_manualReviewEmailUrl`;
  `diagnose-concern.ts` `DiagnoseConcernConfidence`; `supabase/server.ts`
  `createSupabaseServerClient` (confirm admin-app doesn't import it first).
- **Dead props/variants:** `Card.noAnimate`, `Button.trailingIcon`, `Field.Chip.leadingIcon`,
  `ui/index.ts` re-exported `*Props`, `NewVehicleCard.server_error`,
  `PartialVerificationGateCard.matched_first_name`, `CustomerNotesCard` `approved` output,
  `EscalationCard.allow_back_to_scheduling=false` branch, `SecondRoutinePassCard` redundant
  `aria-pressed`.
- **CSS/config:** `VehiclePicker.tsx:86` `group-hover` with no `group` ancestor (add `group` or
  drop); `instrumentation-client.ts` BotID `/book-v2 POST` entry; `next.config.ts:103`
  `va.vercel-scripts.com` CSP entry; empty `experimental:{}`; vestigial catalog section dividers.

## Batch 3 — Tier-1 bugs (commit 3, TDD)

1. **`submit-testing-service-approval.ts:102-110`** — union approved testing services
   (1.x-picked ∪ recommendation-approved) − declined, instead of overwrite. New test:
   1.x-picked testing service survives a 7.5 approval round.
2. **`availability.ts`** — add `.eq("shop_id", SHOP_ID)` to all 5 queries (closed_dates,
   appointment_default_limits, appointment_blocks, appointment_holds, appointments). Test/spy.
3. **`mark-abandoned/route.ts:194-200`** — destructure + check `error` on snapshot read;
   fail-safe (204) instead of running the abandon path on unknown row state.
4. **`fire-transcript-dispatch.ts` (+ `otp-direct-client.ts`, `step2-direct-client.ts`)** — add
   the P0.3 two-layer host validation; extract a shared derive-+-validate helper reused by all
   five ORCHESTRATOR_URL clients.
5. **`WizardSurface.tsx`** — suppress the top `SubmitFailedBanner` on `diagnostic_loading`
   (DiagnosticLoadingCard renders its own alert).
6. Minor: `get-current-card.ts:633` summary hold-read error check; `build-summary-data.ts:269`
   collapse no-op ternary; `CalendarDatePicker.tsx` add `canNavForward` horizon cap.

## Open questions

- None blocking. Will confirm at Batch 2 that `supabase/server.ts createSupabaseServerClient`
  has no cross-app importer before deleting (grep admin-app).
