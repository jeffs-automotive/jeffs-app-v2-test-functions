# keytag-audit-fixes — implementation plan

> Fixes for the findings in [`AUDIT-2026-06-25.md`](AUDIT-2026-06-25.md) (re-audit vs deployed `b70eb93`).
> Phased: each phase is its own commit(s) with its own verification. TDD throughout.
> **No UI / design change** — these are behavior / correctness / security fixes; the existing look + layout
> are preserved (design spec: none, same as the board-spin feature).

## Why

The re-audit confirmed a production blocker (operators can't force-assign) plus a security exposure and a
cluster of audit-integrity / defense fail-open defects, several introduced by the 06-24/25 board-fix series.

## Locked decisions (Chris)

- Fast-forward pushed the audit report; archived the board-spin feature (its spin fix shipped); this feature
  owns B1 (the regression that feature introduced) + the rest of the audit.
- "Make sure you can thoroughly verify the fixes" → TDD; B1 gets a **real-browser** repro (Playwright +
  MSW-SSR), not just RTL. The one manual gate is the Entra-gated deployed re-test for B1's final sign-off.
- Start with B1 + H5; then the provenance cluster; then the fail-closed defense reads.

## Verification harness (the load-bearing prerequisite)

- **MSW-SSR stub of `orchestrator-mcp`** — admin-app already has `msw` + `instrumentation.ts`. Add an
  **env-gated** (`KEYTAG_E2E_MOCK=1`, never on in dev/prod) Node mock that intercepts the server-side
  `fetch` to the orchestrator URL and returns canned tool responses (`listWipKeyTags`, `listManualReviews`,
  `getKeytagDashboard`, and `assignKeytagToRo` → `needs_confirmation` on the first call / `success` when a
  `confirmation_token` is present). This is the only way to deterministically drive the **server-side**
  Pattern-A flow (browser `page.route` can't intercept it).
- **Playwright authed e2e** (`e2e/keytag-confirm.authed.spec.ts`) using the existing `auth.setup.ts`
  session: open the Board → Manual tools → force-assign R-/RO → assert the `ConfirmationDialog` appears
  **and stays mounted** → click Confirm → assert the **second** orchestrator call (with the token) fires and
  a success toast renders. **Red on current code, green after the B1 fix.**
- **Deno/unit** for the edge + DB fixes; **`curl` + advisors/SQL** for security + audit-integrity.
- **Final B1 sign-off (manual, needs Chris):** after deploy, one real force-assign on the deployed admin app →
  query `keytag_confirmation_tokens` for a fresh `consumed_at` (the unambiguous live proof).

---

## Phase 1 — B1 (blocker) + L1: force-assign confirmation survives the action re-render

**Root cause:** every Server Action on the `force-dynamic` `/keytags` route re-renders the route;
`LiveBoardTab` `await`s `loadBoardState` (2 uncached orchestrator calls) so the Live `<Suspense>` (added
`cd91ecf`) falls back and **unmounts `AssignKeytagForm`** (inside `BoardBackupTools`), wiping its
`useActionState` + the issued token before Confirm.

**Strategy (TDD — write the failing repro first):**
1. `admin-app/instrumentation.ts` (+ new `e2e/msw/` handlers) — env-gated MSW-SSR orchestrator stub.
2. `admin-app/e2e/keytag-confirm.authed.spec.ts` — the failing repro.
3. **Core fix (deterministic for the proven-broken force-assign path):** lift `BoardBackupTools` (the
   standalone confirmation forms) OUT of the suspending `LiveBoardTab` subtree — render it as a sibling of
   the `<Suspense>` in `admin-app/app/keytags/page.tsx`'s `live` slot, so it never unmounts on a re-render.
   `LiveBoardTab` stops rendering `BoardBackupTools` itself.
4. **Per-row board dialogs (A/R release):** mirror `dashboard-cache.ts` — wrap `loadBoardState` in
   `unstable_cache` (short TTL, keyed on actorEmail) and/or narrow the Live `<Suspense>` so the board
   subtree doesn't re-suspend on an action re-render. **The repro test arbitrates** whether caching alone
   suffices or the Suspense boundary must be removed (now safe — the dashboard is a fast DB read, so the
   45s spin that justified Suspense is gone).
5. **L1:** `admin-app/src/components/keytag/ConfirmationDialog.tsx` — don't born-disable Confirm off a raw
   client-clock countdown; derive remaining time from a duration captured when `needs_confirmation` arrives
   (or make the countdown advisory and let the server's atomic consume reject expiry).

**Files:** `admin-app/app/keytags/page.tsx`, `admin-app/src/components/keytag/LiveBoardTab.tsx`,
`admin-app/src/lib/keytag/load-board-state.ts`, `admin-app/src/components/keytag/ConfirmationDialog.tsx`,
`admin-app/instrumentation.ts`, `admin-app/e2e/keytag-confirm.authed.spec.ts` (+ `e2e/msw/*`).
**Verify:** the Playwright repro goes green; `tsc` + `vitest` + `build` clean; existing e2e still pass.

## Phase 2 — H5: lock the three anon-readable/writable keytag edge functions

`tekmetric-list-wip-keytags`, `tekmetric-find-ro-by-keytag` (read PII), `keytag-seed-from-tekmetric` (WRITE)
are `verify_jwt=true` with zero in-handler auth. **Fix:** mirror the B1/B2 hardening — `verify_jwt=false` in
`supabase/config.toml` + `checkSchedulerBearer(req, …)` + `unauthorizedResponse` as the first handler
statement in each (seed is operator-only). **Files:** `supabase/config.toml` + the three
`supabase/functions/*/index.ts`. **Verify:** Deno test asserting anon-key bearer → 401; `deno check`;
post-deploy `curl` with the publishable anon key → 401 (was: data).

## Phase 3 — Audit-provenance cluster (H1 + M1 + M2 + H4) as one change

- **H1:** `keytag-bulk-reconcile/reconcile.ts:399,465,500` + `reverse-reconcile.ts:167,225` — change
  `p_source:"reconcile"` → `"cron"` (the allowed value). Gate the `surfaceRpcError` boolean so an enum
  mismatch can't silently drop rows again.
- **M1:** thread `source` into `revertKeytagToAssigned`, `markKeytagPosted`, `resolveManualReviewTool`/
  `dispatchResolution` (+ their `orchestrator-tools` execute wrappers) — default `claude_desktop`,
  `admin_app` from the X-Actor-Email branch — so admin-app mutations aren't mislabeled.
- **M2:** `manual-review-tools.ts:401-412` DRF/REG `no_tag` → write `tagColor:null, tagNumber:null` (matches
  ARN); make `writeAuditLog` `Sentry.captureException` on insert failure (no more silent drop).
- **H4:** `keytag-dashboard-data.ts:248-252` + `reconcile.ts:105-116` — treat `{claude_desktop, admin_app}`
  as human releases in the "ROs without key tags" skip.

**Verify:** Deno tests (reconcile source ∈ CHECK set; `no_tag` writes null/null; `admin_app` release is
skipped); a guard test that no `p_source` is outside the live CHECK set; post-deploy `keytag_audit_log`
query showing reconcile rows land as `cron`.

## Phase 4 — Fail-closed defense reads (H2 + H3) + silent-failure cluster (M3)

- **H2:** `keytag-management.ts:434-462` — capture the keytags status-read `error`; **fail closed** (require
  confirmation / abort) instead of falling through to a no-confirmation A/R release.
- **H3:** `keytag-tekmetric-webhook/index.ts:694-701` — capture the prior-history read `error`; **fail
  closed** (treat unreadable audit as "has history" → DRF/manual-review, never auto-assign).
- **M3:** check + surface `error` (Sentry, non-fatal) on `markProcessed`, the `keytag-extras` revert/mark
  audit writes, `touch_keytag_activity`, `record_keytag_patched`, the dedup SELECT.

**Verify:** Deno tests forcing each read to error and asserting the fail-closed branch; existing webhook
suite stays green.

## Deferred (follow-up feature, listed for the record)

M4 (manual-review dedup partial-UNIQUE), M5 (PAF false-"issued" message), M6 (orchestrator-mcp catch →
Sentry), M7 (OAuth refresh reuse-detection), L2 (Tekmetric timeout + write-path 401-retry), L3 (REVOKE anon
DML grants — own migration), L4 (mcp-auth atomic token pair), L5 (bundle), and the audit's coverage-gap
probes (mcp-auth front door / DCR, orchestrator-router customer→never-keytag reachability, X-Actor-Email
server-trust, daily-report HTTP auth).

## Open questions

- Phase 1 step 4: does caching `loadBoardState` stop the Suspense re-suspend, or must the Live `<Suspense>`
  be removed? **Decided empirically by the repro test.**
- L3 (revoke anon grants) is a DB migration with broader blast radius — keep it deferred / its own change?
