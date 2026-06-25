# Keytag board — residual fixes (plan)

**Feature:** `keytag-board-residual-fixes` · **Branch:** `keytag-board-residual-fixes` (off `origin/main` 660cf57) · **Date:** 2026-06-24
**Method:** multi-agent research (2 independent spin lenses + released_wip design + webhook/sweep), adversarially verified vs live data + official React/Next/Base-UI docs. (The final auto-reconciliation agent hung on an API timeout; the two spin lenses are reconciled below by hand — they converge on the same fix.)

These are the issues that survived the first PR (#2). The first "spin" fix targeted the wrong layer (`revalidatePath`); this plan replaces that with the verified root cause.

---

## Issue 1 — Action SPIN (the manual forms + per-row buttons keep spinning after the action already succeeded)

**Confirmed empirically:** the clicks SUCCEED server-side (audit: released RO 153688 @20:22:35, assigned RO 153380 @20:22:48, both `source=admin_app`); the orchestrator is fast (all 200, 300–1800 ms); removing `revalidatePath` did NOT help. So the spinner hangs even though the action is done — a **client-side** problem.

**Root cause — poller transitions co-batch / serialize with the user's action.** The board runs always-on pollers, each on its own React transition:
- `LiveBoardPoller` (15 s) → `getBoardStateAction()` (now **3** orchestrator calls, up to ~5 s in flight) in `useTransition`.
- `DashboardPoller` (60 s) → `router.refresh()` in `useTransition` (re-renders the whole force-dynamic 6-tab page).

The forms/buttons submit via `useActionState` (auto-wrapped in a transition; `Button loading={isPending}`). Per **react.dev/useTransition** (verbatim): *"isPending … stays true until all Actions complete"* and *"If there are multiple ongoing Transitions, React currently batches them together."* Per **nextjs.org/server-actions**: *"Next.js dispatches Server Actions one at a time per client."* So when a poll is in flight (or fires) during a release/assign, the user's action is **batched/queued with the poll**, and the form's `isPending` stays true until the *poll* settles. Because polls fire every 15 s, it reads as a perpetual spinner. (Base-UI `Tabs.Panel keepMounted=false` → only the active tab mounts, so on the Board tab the culprit is `LiveBoardPoller`; `DashboardPoller`/`router.refresh` only matters on the Dashboard tab.)

**Why my first fix missed it:** I removed `revalidatePath` (never the cause) and paused `LiveBoardPoller` only when `BoardClient.busyRows` is set — but the **bottom manual forms (`BoardBackupTools`) live in `LiveBoardTab` OUTSIDE `BoardClient`**, so they never feed `busyRows`, so the poll never paused for them.

**Fix:**
1. **Pause ALL pollers while ANY mutation is in flight** — lift a shared "mutating" signal (React context provided by `LiveBoardTab`, or a small zustand store) that BOTH the per-row buttons AND the bottom forms set, and have `LiveBoardPoller` skip its 15 s tick (and `DashboardPoller` skip `router.refresh`) while it's set. This stops the user action from ever co-batching/serializing with a poll.
2. **Replace `DashboardPoller`'s `router.refresh()`** with an action-scoped read (the cached `getCachedDashboard` pattern, like `LiveBoardPoller` already uses) so a full force-dynamic RSC re-render can never co-batch with a user action.
3. Defense-in-depth: gate pollers to the active tab (`keepMounted=false` already helps).

**Verify:** a component/Playwright test that starts a poll, dispatches a release while the poll is mid-flight, and asserts the button's `loading` clears within ~2 s of the action resolving. **+ Chris re-tests in prod** (I got this wrong once — manual confirmation required before close).

Cites: react.dev/useTransition, react.dev/useActionState, nextjs.org/use-router, nextjs.org/server-actions, base-ui.com/react/components/tabs.

---

## Issue 2 — `released_wip` false positives (closed/paid ROs shown as "needs a tag")

**Confirmed:** RO 153688 (manual WIP release, then paid/closed) still shows. Its keytag_audit_log has only 2 rows (assign 18:13, release 20:22) — **no terminal-close row**, because once the tag was already released, the posted-paid webhook had no tag to release (noop `posted_paid_no_tag_held`). The close signal lives in **`keytag_webhook_events`**, not the audit log. `listReleasedWipNeedingTag` only excludes ROs that currently hold a tag — never ROs that closed after the release. Live: the shipped query returns {153688, 153547} as net false positives and **0 unique true positives** (the genuine open one, 153527, is already covered by its open review).

**Decision (Chris, 2026-06-24): DROP `released_wip` entirely.** The verifier found it yields **0 unique true positives** — every genuine "released, still WIP, re-tag" case is *also* caught by the reconciler's `work_approved_drift` / `ar_regression` review (which appears when the RO next shows WIP activity) and clears via the webhook auto-resolve on close. So removing it kills the whole false-positive class with no real loss (the RO still shows as a review row, re-taggable). This REVERTS the Bug-2 additions from PR #2.

**Remove (surgical revert of the released_wip parts of PR #2):**
- `supabase/functions/_shared/tools/repair-orders.ts` — delete `listReleasedWipNeedingTag`, `ReleasedWipNeedingTagResult`, `DEFAULT_RELEASED_WIP_WINDOW_DAYS`.
- `supabase/functions/_shared/orchestrator-tools.ts` — delete the `listReleasedWipNeedingTag` tool def + its import.
- `admin-app/src/lib/orchestrator/types.ts` — delete the `listReleasedWipNeedingTag` `KeytagToolMap` entry + `ListReleasedWipNeedingTagArgs` / `ReleasedWipNeedingTagEntry` / `ReleasedWipNeedingTagResult`; revert `UntaggedBoardRow` (drop `kind` + `released_tag`, back to review-only).
- `admin-app/src/lib/keytag/load-board-state.ts` — revert to 2 sources (reviews only); drop the released_wip call + merge + de-dup.
- `admin-app/src/components/keytag/BoardClient.tsx` — revert the RO# cell + Review cell conditionals back to the original review-only rendering.
- `admin-app/tests/unit/load-board-state.test.ts` — simplify to review-only (keep the `server-only` vitest alias/stub — useful infra).

**Deploy ordering (important):** deploy the **admin-app first** (it stops calling the tool) → confirm READY → **then** redeploy `orchestrator-mcp` with the tool removed. Otherwise the live admin-app (660cf57) would call a now-missing tool and the board would error. (Or leave the unused tool deployed and remove it in a follow-up — but cleanest is admin-app-first then orchestrator.)

**Verify:** board "Needs a tag" shows review rows only; RO 153688 no longer appears; the genuine re-tag case (a released WIP RO that's still open) still surfaces via its review.

---

## Issue 3 — stale webhook Deno test (CI red, deterministic)

`09a7b34` added `resolveCustomerName` (a `GET /customers/{id}`) to the assign path (`index.ts:956`, after the PATCH), so the ro_work_approved-assign now makes 3 fetches `[GET ro, PATCH, GET customer]`; `index.test.ts:240` still asserts 2. **Fix:** make the test mock URL-aware (`/customers/` → return a person), assert `scope.calls.length===3`, keep PATCH at `calls[1]`, add `calls[2].url` includes `/customers/`. Only this one test is affected (9/10 webhook tests pass).

---

## Logistics + verify gate
- Implement on `keytag-board-residual-fixes` (off origin/main — it has the released_wip + URL-tabs code; local `main` is 4 commits behind).
- Verify: admin-app `tsc` + `vitest` + `eslint` + `build`; **`deno test`** (not just `deno check` — that's what caught the stale webhook test) + the new repair-orders/test; review agents on the diff; `/code-review`.
- Deploy: orchestrator-mcp (the new tool query) via CLI; admin-app via merge→Vercel. Migration: none expected (read-only query change).
- **Hard gate:** Chris manually confirms the spin is gone + 153688 leaves the board, before `/feature-done`.
