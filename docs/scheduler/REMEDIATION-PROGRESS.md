# Remediation progress

> Per-phase status tracker for the 7 plans in [`plans/`](./plans/). Companion to the index at [`plans/PLANS-MASTER.md`](./plans/PLANS-MASTER.md) — the master defines WHAT each plan does; this file tracks WHAT'S LANDED.
>
> **Last refresh:** 2026-05-27 (memory + docs consolidation pass — adds Plan 04 follow-up sweep + edge-parity + schedulerconfig context). Update this file in the same commit that closes a phase. Always cite the commit SHA so future readers can `git show <sha>` for the actual change.
>
> ## Out-of-band ships post-Plan 04 Phase 5B (not driven by the 7-plan roadmap, but architecturally relevant)
>
> | Ship | Date | Where to find it |
> |---|---|---|
> | Plan 04 follow-up fixes (P0.1–P2.12, H1–H3, M1–M3, L1, C1) — 20 fixes across BLOCKERs / IMPORTANTs / NICE-TO-HAVEs surfaced by post-Phase 5B validator + cross-verify | 2026-05-24/25 | Task list #46–#67; commits referenced in scheduler arch doc § 15 |
> | admin-app Phase A — Microsoft Entra OAuth + sandbox routes (sibling Next.js app at `admin-app/`) | 2026-05-25 | `docs/admin-dashboard/PLAN.md` Phase A + `.claude/memory/scheduler/scheduler_system_architecture.md` § 5b |
> | admin-app Phase C — Keytags page wired to all 10 orchestrator MCP tools | 2026-05-25 | `docs/admin-dashboard/PLAN.md` Phase C + `.claude/memory/keytag/keytag_system_architecture.md` § 5 |
> | scheduler-edge-parity feature — Pattern S retrofit + 17 migrations + revert dispatch + 25 ADRs | 2026-05-26 (commit `4443d77`) | `docs/scheduler/edge-parity/PLAN.md` + 25 ADRs in `decisions/` + `.claude/memory/scheduler/scheduler_system_architecture.md` § 8.4 |
> | admin-app Phase D — schedulerconfig UI (10 live tabs) | 2026-05-26/27 (commits `0dc24bf` → `4b7d570`) | `docs/admin-dashboard/schedulerconfig-plan.md` v0.5 + `ROUND-2-RESIDUALS.md` |
>
> These shipped without going through the 7-plan roadmap because they're feature work (not audit remediation). Plans 05/06/07 remain unstarted.

---

## At a glance

| Plan | Title | Status | Effort spent | Findings closed |
|---|---|---|---|---|
| [01](./plans/PLAN-01-pre-launch-blockers.md) | Pre-launch BLOCKERs | ✅ **COMPLETE 2026-05-22** | 4 phases | B1–B10 (10/10 BLOCKERs) |
| [02](./plans/PLAN-02-observability-hardening.md) | Observability hardening | ✅ **COMPLETE 2026-05-24** | 5 phases | I-OBS-1, 4, 5, 7 + OBS-8 |
| [03](./plans/PLAN-03-security-hardening.md) | Security hardening | ✅ **COMPLETE 2026-05-23** (SEC-7 BotID deferred to pre-launch) | 5 phases | I-SEC-1, 3, 4, 5, 6 + RFC 8707 |
| [04](./plans/PLAN-04-atomicity-correctness.md) | Atomicity + correctness | 🟡 **IN PROGRESS** (Phase 5B landed 2026-05-24/25) | 7 of 8 phases | I-COR-1, I-COR-2, I-COR-3, I-COR-4, I-COR-5, I-COR-6, I-OTH-3 (Phase 1A + 1B + 2 + 3A + 3B + 4 + 5B done) |
| [05](./plans/PLAN-05-integration-robustness.md) | Integration robustness | 🔜 **NOT STARTED** | — | I-INT-1, 2, 3, 4 |
| [06](./plans/PLAN-06-test-coverage-expansion.md) | Test coverage + DAL refactor | 🔜 **NOT STARTED** | — | I-TEST-1–8 |
| [07](./plans/PLAN-07-operational-pre-launch.md) | Operational + pre-launch | 🔜 **NOT STARTED** | — | I-OTH-1, 2, 4, P1, P2 |

Legend: ✅ COMPLETE · ⚠ PARTIAL · 🔜 NOT STARTED · 🟡 IN PROGRESS

---

## Plan 01 — Pre-launch BLOCKERs · ✅ COMPLETE 2026-05-22

All 10 BLOCKERs (B1–B10) closed. Four code-shipping phases + one out-of-repo carrier-side phase.

| Phase | What it did | Commit | Closes |
|---|---|---|---|
| 1A | tekmetric-api-testing + tekmetric-bootstrap anon-key lockdown — moved to bearer auth via `tekmetric_admin_bearer` RPC | `9826f88` | B1, B2 |
| 1B | `_bulk_keytag_backfill` + `_smoke_test_run` scratch-table RLS hardening (deny_all + revoke EXECUTE from public) | `9826f88` | B3, B4 |
| 1C | Snapshot-prune cron `SECURITY DEFINER` + `search_path = public` correctness | `9826f88` | (NICE-TO-HAVE in Plan 01) |
| 2 | `tekmetric_webhook_events` UNIQUE constraint on `(provider, event_id)` — webhook idempotency at DB level | `d31c105` | B5 |
| 3 | CI gate via `.github/workflows/ci.yml` (typecheck + lint + unit + deno-check) + ESLint flat-config migration | `ec381a7` | B6 |
| 4 | Critical test coverage — diagnose-concern.ts (Stage-1 + Stage-2 + gap-detect), Tekmetric webhook handler tests, run-diagnostics.ts shape tests, Playwright multi-tenant smoke harness | `d139b33` | B7, B8, B9, B10 |
| 5 (deferred) | A2P 10DLC brand + campaign registration — out-of-repo carrier process. Not blocked by code. Track separately in operator activation. | — | — |

**Follow-on commits:** `ecea50c` + `e752498` (CI lock-file unblock pattern — see CLN-11 in `DEFERRED-AUDIT-ITEMS.md`), `d96516b` (defer pgTAP/Playwright stages — see CLN-9 + CLN-10).

---

## Plan 02 — Observability hardening · ✅ COMPLETE 2026-05-24

All 5 phases landed. Two natural cron cycles 2026-05-24 18:30 + 18:35 UTC confirm Sentry Cron Monitoring is fully operational end-to-end (OBS-8 was the final dependency).

| Phase | What it did | Commit | Closes |
|---|---|---|---|
| 1 | `_shared/sentry-edge.ts` — `withSentryScope(req, surface, handler)` wrapper for per-request isolation in Deno edge runtime. Wired into 4 high-value edge fns (appointments-sync, transcript-dispatcher, keytag-bulk-reconcile, keytag-daily-report). PII scrubber mirrors `scheduler-app/sentry.server.config.ts`. | `a94c876` | I-OBS-3 (partial — 4/17 fns), I-OBS-4 (Option A) |
| 2 | Webhook sig-fail Sentry alerts via `captureMessage('warning', ...)` + cleanup of legacy `captureException` patterns | `f1b602b` | I-OBS-1 |
| 3 | Sentry Cron Monitoring — `sentry_cron_checkin` SECURITY DEFINER helper + 4 per-cron wrappers (`run_<slug>_with_checkin`). Vault-stored DSN. | `b5bc4c4` | I-OBS-4 (cron channel) |
| 3.1 (fix) | API alignment — added missing `status` field to POST body (resolves 422 from Sentry) | `85fe0c3` ([SUPERSEDED]) | — |
| 3.2 (refinement) | Strict-spec rewrite per re-read of canonical Sentry docs | `85fe0c3` ([SUPERSEDED] — pg_net async ordering breaks pairing) | — |
| 3.3 (final fix) | **Re-add `check_in_id` to BOTH calls** (POST body + GET querystring) so Sentry pairs by ID, not recency. Survives pg_net's non-deterministic batched delivery. Verified clean across 2 natural cron cycles. | `3d9de2d` | — |
| OBS-8 | `vault.secrets.sentry_dsn` populated 2026-05-24 17:24:22Z (same DSN as `EDGE_FN_SENTRY_DSN`) | (Chris-set via SQL) | I-OBS-8 / OBS-8 ([see `DEFERRED-AUDIT-ITEMS.md` OBS-8 RESOLVED](./DEFERRED-AUDIT-ITEMS.md)) |
| 4 | Anthropic `gen_ai.*` spans via `Sentry.vercelAIIntegration({ force: true })` + `experimental_telemetry` per LLM call. Prompt cache_control restructure. | `38311f7` | I-OBS-5 |
| 5 | `scheduler_error_log` column-name audit + `logEdgeError` extension to also fire `Sentry.captureMessage` (belt-and-suspenders) | `a94c876` (shared) | I-OBS-7 |

**Today's bonus** (not strictly in Plan 02 scope but related): `sentry-webhook` receiver edge fn + `sentry_webhook_events` table (commits `85fe0c3` + today's session). Provides reverse-direction observability — Sentry deliveries land in our DB for MCP queryability.

**Plan 02 deferred sub-items:** I-OBS-3 remaining (10–13 edge fns not yet wrapped in `withSentryScope`) — see `DEFERRED-AUDIT-ITEMS.md` OBS-3.

---

## Plan 03 — Security hardening · ✅ COMPLETE 2026-05-23 (with one deferral)

All 5 plan phases landed. SEC-7 (BotID Deep Analysis + Upstash rate-limit activation) was deferred to pre-launch per design-pivot decision.

| Phase | What it did | Commit | Closes |
|---|---|---|---|
| 1 + 4 | Vercel BotID + Upstash rate-limit infrastructure + OAuth resource validation (RFC 8707 + MCP spec 2025-11-25 audience binding) | `cec4e65` | I-SEC-1 (partial — Upstash), I-SEC-7 (RFC 8707) |
| 1 (deferred) | BotID Deep Analysis enablement + rate-limit activation — design pivot 2026-05-23 PM, deferred to pre-launch | `cf412ad` (deferred doc) | (see SEC-7 in `DEFERRED-AUDIT-ITEMS.md`) |
| 2 + 3 | Constant-time HMAC compare via `bearersEqual` + UUID validation + PostgREST `.or()` injection guard + HMAC secret separation (test vs prod) | `82dc03d` | I-SEC-1, I-SEC-3, I-SEC-5, I-SEC-6 |
| 4 (immediate cutoff) | Same-day OAuth NULL-resource backward-compat cutoff (rejects unsigned-resource tokens immediately, no 30-day window) | `4155a85` | I-SEC-7 final |
| 5 | Customer-facing route hardening — security headers (CSP, X-Frame-Options, Referrer-Policy, etc.) | `3ce2e4f` | I-SEC-4 |

**Plan 03 deferred sub-items:**
- SEC-7 BotID + rate-limit activation — defer to pre-launch (see `DEFERRED-AUDIT-ITEMS.md` SEC-7)
- SEC-3 `tekmetric-api-testing` dedicated HMAC secret separation completed today via secret upgrade — closed.

---

## Plan 04 — Atomicity + correctness · 🟡 IN PROGRESS (1 of 8 phases done)

Findings: I-COR-1 through I-COR-8 + I-OTH-3.

Per the master plan's dependency graph, Plan 04 can run in parallel with Plans 05 + 07 after Plan 01 Phase 4 (tests) is in place — which it is. **No blocker.**

### Completed phases

| Phase | What it did | Commit | Closes |
|---|---|---|---|
| 1A | `public.apply_wizard_transition` SECURITY INVOKER RPC — atomic 3-write (UPDATE customer_chat_sessions + optional user-bubble INSERT + optional assistant-bubble INSERT) in a single Postgres transaction (PostgREST-wrapped). `scheduler-app/src/lib/scheduler/wizard/transition.ts` rewritten to call the RPC. Server-canonical `last_active_at = pg_catalog.now()` removes client clock-drift risk. Column-merge uses `CASE WHEN p_payload ? 'col' THEN ... ELSE col END` (NOT COALESCE — matches supabase-js .update semantic so explicit-null payload entries clear columns to SQL NULL; 6 callers depend on this). New `transition.test.ts` (13 tests) + refactored `submit-start-over.test.ts` + `run-diagnostics.test.ts` for new persistence shape. | `5d8a122` | I-COR-1 |
| 1B | `public.hydrate_session_reset(p_chat_id UUID) RETURNS JSONB` SECURITY INVOKER RPC — atomic 4-write (UPDATE appointment_holds by pointer + UPDATE appointment_holds by session_id defensive + UPDATE customer_chat_sessions full RESET_COLUMNS wipe + DELETE customer_chat_messages) in a single Postgres transaction. `scheduler-app/src/lib/scheduler/hydrate-session.ts` rewritten to call the RPC. `RESET_COLUMNS` JS constant removed; SQL migration is now source of truth. Sentry capture level bumped warning→error on reset failure (atomic RPC failure means everything rolled back — customer-visible). Audit caught a column-name bug in the spec: `appointment_holds` has no `hold_token` column; corrected to `WHERE id = v_hold_token` per live schema. RESET_COLUMNS divergence between hydrate-session (43 cols) + submit-start-over (41 cols, missing `pending_candidates` + `customer_self_identified`) preserved intentionally; flagged as new deferred CLN item. New `hydrate-session.test.ts` (16 tests); 183/183 unit suite passes (was 167). | `221b855` | I-COR-2 |
| 2 | `submit-summary` hold CAS lock — replaces the prior READ-then-3-check pattern (which had a race window between SELECT and Tekmetric POST where mark-abandoned could release the hold) with a single atomic UPDATE that claims the hold by setting `released_at = now()` WHERE `id = holdToken AND session_id = chatId AND released_at IS NULL AND expires_at > now()`. On CAS miss, a diagnostic SELECT (session-bound) determines WHICH condition tripped to preserve the prior 3-state user-facing copy (`not-found / released / expired`); CAS DB error escalates with `cas_claim_db_error` reason. Hold stays released whether Tekmetric POST succeeds or fails (spec-acceptable; hold-reaper sweeps within 30 min). Same column-name correction as Phase 1B (`.eq("id", holdToken)` not `.eq("hold_token", holdToken)` — spec was wrong). Added `.gt("expires_at", now)` to CAS WHERE clause (spec only checked released_at IS NULL; without expiry gate a TTL-expired hold could still be CAS-claimed). New `submit-summary.test.ts` (8 tests covering happy + DB error + 3 CAS-miss diag branches + Tekmetric-failure-no-rollback + column-name correctness). Pure code refactor — no migration. 191/191 unit suite passes. | `59452f0` | I-COR-3 |
| 3A | `submit-vehicle-pick` IDOR defense — server-side enforcement that `vehicle_id` is in the customer's Tekmetric-owned vehicles list. The file's existing `fetchVehiclesForCustomer` call (originally for metadata-only fail-soft) now ALSO serves as the IDOR check on success: if vehicle not in list → reject with `vehicle_id_not_owned` + Sentry warning. Hard-fail also added when `customer_id` is missing on the session row (data-integrity issue). Fail-soft preserved on fetch throw / `result.ok=false` (transient Tekmetric outages don't block legitimate users; the casual-tampering risk this defends against is much smaller than the operational risk of failing-closed on Tekmetric flakiness). File header comment updated to reflect the new ownership-enforcement contract. New `submit-vehicle-pick.test.ts` (7 tests: 'new' branch, happy IDOR pass, IDOR reject, empty vehicle list, fetch throw fail-soft, fetch ok:false fail-soft, missing customer_id). | _(commit SHA after push)_ | I-COR-4 |
| 3B | `submit-multi-account-choice` IDOR defense — server-side enforcement that the `'select'` branch's `selected_customer_id` is in the session's `pending_candidates` list (which was written by `scheduler-step2-direct` after phone match). Combined the existing phone_e164 read with `pending_candidates` into a single SELECT (saves a round-trip). Hard-fail on null/empty/read-failure since it's a security gate, not best-effort. **Spec correction:** PLAN-04 used `Array<{ id: number }>` for pending_candidates membership, but the actual stored shape per the writer at `scheduler-step2-direct/index.ts:262-269` is `Array<{ customer_id: number; recent_vehicle: string }>` — spec code would have rejected EVERY legitimate selection. Corrected to `customer_id` field. IDOR check runs AFTER bot/IP gates (existing PLAN-03 Phase 1 defenses) but BEFORE phone rate-limit (no point rate-limiting an attacker that's failing IDOR). New `submit-multi-account-choice.test.ts` (9 tests: 'none_of_these' branch, happy 'select', IDOR reject + null candidates + shape-correctness sanity, bot/IP/phone gates short-circuit checks). | `80038cd` | I-COR-5 |
| 4 | Verification-mismatch 3-state envelope — when scheduler-booking-direct's GET-after-POST verification reports `verification.ok=false`, the wizard now persists `appointment_verification_status='needs_review'` + `appointment_verification_diff=<jsonb>` instead of silently treating the booking as confirmed. Migration `20260525000000` adds 2 columns on `customer_chat_sessions` (CHECK constraint on status enum) + extends `apply_wizard_transition` RPC with CASE-WHEN-? branches for both new keys. `submit-summary.ts` verify-mismatch block (was log-only warning) now: bumps Sentry to ERROR level + calls `create_manual_review` RPC with category=`appointment_verification_mismatch` + prefix='AVM' + 3 advisor options (update_tekmetric / update_our_records / contact_customer) + advances to customer_notes with an apology bubble (`buildVerificationMismatchBubble`) in place of the celebratory `buildConfirmedBubble`. Customer still completes the flow per Chris's UX call. Reuses `keytag_manual_reviews` table per Chris's decision (existing RPCs are extensible — keytag-specific p_tag_color / p_tag_number / p_ro_id / p_ro_number stay NULL for AVM entries). **Deferred:** the per-issuance email send (existing keytag email path is Deno-only; Vercel Server Action can't import it directly). Filed as CLN-13 in DEFERRED-AUDIT-ITEMS.md with two paths forward (new send-manual-review-email edge fn OR direct Resend integration on Vercel side). 4 new tests in `submit-summary.test.ts` (verification.ok=true → confirmed bubble + no review row; verification.ok=false → needs_review + apology bubble + manual review created; create_manual_review RPC error → customer still advances; verification absent → defaults to confirmed). 211/211 unit suite passes (was 207 + 4 new). | `a12cf0e` | I-COR-6 |
| 5B | Per-session Next.js data cache for the wizard's RSC reads (closes I-OTH-3). New helper `scheduler-app/src/lib/scheduler/cache.ts` exports `sessionTag(chatId)` + `getCachedSessionRow(chatId)` — wraps the `customer_chat_sessions` row read via `unstable_cache` (keyParts=`[scheduler-session-row, chatId]`, tag=`session-${chatId}`, 60s TTL backstop). Three RSC readers refactored: `hydrate-session.ts`, `get-current-card.ts`, `build-summary-data.ts:buildSummaryCardPayload` (last one caught by verifier A). `transition.ts:applyWizardTransition` rewritten to fire `revalidateTag(sessionTag(chatId)) + revalidatePath("/", "page")` instead of the pre-Phase-5B 3-path loop (`/`, `/book`, `/book-v2`). **Gaps caught + closed by 2 parallel Opus verifier agents:** (A) `buildSummaryCardPayload` had a direct uncached supabase read — now routed through `getCachedSessionRow`; (B) `mark-abandoned/route.ts` wrote status='timed_out' without firing `revalidateTag` — customers returning within 60s would have gotten cached pre-abandon state. Now fires the tag after the row update succeeds. Bonus fix: `ensure-concern-summaries.ts` (called from run-diagnostics.ts AFTER applyWizardTransition's revalidateTag) now fires its own `revalidateTag` so the customer's next clarification card sees fresh summaries immediately. **Risk mitigations per spec:** kept `revalidatePath("/", "page")` as single-path fallback (defense in depth for any future RSC reader added without tagging); 60s TTL ceiling so missed-tag failures cap at 60s of staleness instead of forever. **Process notes:** Phase 5B was the first scheduler phase to use Opus sub-agents for verification — 2 parallel Opus Explore agents (reader inventory + anti-pattern audit), each in fresh context. Both found real gaps that the orchestrator-alone audit would likely have missed. Pattern documented in new `feedback_opus_for_subagents.md`. Also: Context7 MCP was permanently deny-listed in this session (`feedback_no_context7.md`) — official vendor docs only. CLN-15 deferred item filed for the future drop of the revalidatePath fallback once all RSC readers are independently re-verified as tag-instrumented. Refactored tests across 6 files. 212/212 unit suite passes (was 211; net +1 after test consolidation in submit-start-over removing redundant 3-path assertion). | _(commit SHA after push)_ | I-OTH-3 |

### Remaining phases (estimated)

| Phase | Scope | Effort | Notes |
|---|---|---|---|
| 6 | FK `ON DELETE CASCADE` rationale audit (I-COR-7) + early-migration idempotency guard docs (I-COR-8) | ~3 hr | Documentation + 1-2 FK changes |

Open decisions:
- Verification-mismatch UX copy wordsmithing
- `revalidatePath` scope reduction — wizard-cards-only or full session-tag refactor?
- Early-migration idempotency — rewrite or document in README?

Closed decisions (resolved during execution):
- Phase 2 CAS lock value — RESOLVED 2026-05-24: reuse `released_at` per spec (no schema change); preserved 3-state user-facing copy via diagnostic-read on CAS-miss path.

See [`plans/PLAN-04-atomicity-correctness.md`](./plans/PLAN-04-atomicity-correctness.md) for the full 616-line plan.

---

## Plan 05 — Integration robustness · 🔜 NOT STARTED

Findings: I-INT-1, 2, 3, 4 (I-INT-5 closed in Plan 01, I-INT-6 closed in Plan 02).

Estimated effort: 5–6 days. Open decisions:
- Telnyx public key + Resend webhook secret env vars
- Upstash Redis account — same as Plan 03 (existing or new?)
- Queue-for-replay (Phase 3C) — ship now or wait for first outage?
- Fallback UX wording

See [`plans/PLAN-05-integration-robustness.md`](./plans/PLAN-05-integration-robustness.md) for the full 650-line plan.

---

## Plan 06 — Test coverage expansion + DAL refactor · 🔜 NOT STARTED

Findings: I-TEST-1 through I-TEST-8.

Per the dependency graph, Plan 06 sits ON TOP of Plans 01–04. Plan 04 must land first.

Estimated effort: 1–2 weeks. Open decisions:
- DAL refactor — incremental over 2–3 sprints or one push?
- Coverage threshold ramp — 60% → 85% over time or hard 85% now?

See [`plans/PLAN-06-test-coverage-expansion.md`](./plans/PLAN-06-test-coverage-expansion.md) for the full 548-line plan.

---

## Plan 07 — Operational + pre-launch · 🔜 NOT STARTED

Findings: I-OTH-1, 2, 4 + P1, P2 (I-OTH-3 closed in Plan 04 once it lands).

Independent — can run anytime; ideally just before Phase 1 DNS launch.

Estimated effort: 2 days. Open decisions:
- DNS provider — GoDaddy / Cloudflare / Route53?
- Auth DB connections percentage — 25% or 50%?
- Sentry Seer — defer to post-launch (recommended) or enable now?

See [`plans/PLAN-07-operational-pre-launch.md`](./plans/PLAN-07-operational-pre-launch.md) for the full 178-line plan.

---

## Next step recommendation

Plans 04, 05, 07 are all unblocked + parallel-runnable. **Plan 04 (Atomicity)** is the recommended next pick because:

1. It unblocks Plan 06 (test coverage + DAL refactor) — the biggest downstream item.
2. The 8 I-COR findings are correctness bugs (data loss / race conditions / double-write risk) — higher latent risk than I-INT findings (integration robustness, mostly graceful-degradation work) or Plan 07's operational checklist.
3. Plan 04 phase breakdown is well-scoped: 4 days estimated, 8 phases, clear DAL touch points.

If wall-clock matters more than risk surface, **Plan 05 (Integration robustness)** or **Plan 07 (Operational)** are tighter scopes that land faster.

---

## How to use this file

- After ANY phase commit lands: append a row to the relevant plan's table with the SHA + close criteria. Bump the "Last refresh" date at top of this file in the same commit.
- When a plan's last phase lands: flip the "At a glance" row to ✅ COMPLETE with the completion date.
- Open decisions are migrated FROM `PLANS-MASTER.md` → here only when the decision is made (so this stays a STATUS doc, not a planning doc).
- Deferrals: cross-link to the canonical entry in `DEFERRED-AUDIT-ITEMS.md` — that file is the source of truth for deferrals; this file just notes the cross-link.
