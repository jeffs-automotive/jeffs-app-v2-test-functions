# Keytag Board "spin forever" — PROVEN root cause + fix (after 3 failed attempts)

**Date:** 2026-06-25 · **Feature:** `keytag-board-residual-fixes` (reopened)
**Audit:** workflow `wf_de131083-3f3` — 7 agents, runtime-log-backed. Supersedes the poller-batching diagnosis (`board-spin-fix-plan-2026-06-25.md`), which was WRONG.

---

## Root cause (runtime-proven, not theory)

**Defect ① (load-bearing):** every Server Action on `/keytags` re-renders the whole `force-dynamic` page (Next.js Flight response carries the re-rendered route tree). `page.tsx` renders ALL six tab Server Components unconditionally with NO `<Suspense>`, so the re-render synchronously runs `DashboardTab` → `getKeytagDashboard` (45s timeout, `dashboard-cache.ts:29` / `client.ts:177`). That tool does a **serial 125ms-per-customer Tekmetric walk** (`keytag-dashboard-data.ts:130-155,379`) that exceeds 45s. So the action's response — and `useActionState` `isPending` — blocks up to 45s. **Evidence:** 231+ `getKeytagDashboard … aborted due to timeout (45s)` errors in Vercel runtime logs, current deployment (`dpl_A5Tvnnxz` = 79e62fb), multiple users. The fast <3s orchestrator 200s in the edge logs are the *board-state* calls; the slow dashboard calls abort at 45s before completing, so they never log a 200 — the contradiction is resolved.

**Defect ② (independent, pins the lone Refresh):** `LiveBoardPoller.refresh()` runs `setState` after `await` inside `startTransition` without re-wrapping (`LiveBoardPoller.tsx:50-60`). react.dev: *"state updates after an `await` inside `startTransition` are not marked as Transitions"* → `isPending` can stay stuck.

**Ruled out with evidence:** stale code / service worker / CDN (deploy IS live — release-stamp `79e62fb` in served HTML; no PWA/SW); Sentry wrapper (flush is fire-and-forget `waitUntil`, no-op on Node, 2s cap); middleware (only refreshes cookies, returns `next()`, 200s prove it); the action files (unchanged since the tab worked).

**Why the 3 prior fixes failed:** PR#2 (drop revalidatePath), PR#3 (poller skip-store), PR#4 (remove the 15s poller) all chased poller co-batching — a red herring. The coupling is `DashboardTab`'s 45s fetch on the action's forced re-render path, independent of any poller.

---

## The fix

### A. admin-app — stop the spin + decouple the slow tab
| File | Change |
|---|---|
| `src/components/keytag/KeytagsTabs.tsx` | Wrap each `<TabsContent>` child in `<Suspense fallback={…}>` so an action re-render streams the shell immediately and a slow tab (`DashboardTab`) resolves/falls-back independently instead of blocking the whole Flight stream. |
| `src/lib/keytag/dashboard-cache.ts:29` | `timeoutMs: 45_000` → `10_000` (seatbelt — bound the worst case; `DashboardTab.tsx:56-68` already renders a fast error state). |
| `src/components/keytag/LiveBoardPoller.tsx:50-60` | Fix defect ②: drop `useTransition`, use a plain `useState` loading flag (it awaits a single action — no transition semantics needed), so post-await `setState` can't orphan `isPending`. |
| `src/components/keytag/DashboardPoller.tsx:42-46` | Gate the 60s `router.refresh()` on `document.visibilityState === "visible"` so a backgrounded tab stops hammering the orchestrator once/min. |
| `app/keytags/page.tsx` | Add a visible `BUILD: <short-sha>` stamp from `process.env.VERCEL_GIT_COMMIT_SHA` so Chris can confirm on-screen which build he's on (no more "is it deployed?"). |

### B. orchestrator — make the dashboard genuinely fast (the durable root)
| File | Change |
|---|---|
| `supabase/functions/_shared/keytag-dashboard-data.ts:130-155,379` | Replace the serial 125ms-per-id Tekmetric customer-name walk. Preferred: read names from the already-denormalized `keytags.customer_name` (populated by the customer-name feature) instead of walking Tekmetric at all → one DB read, sub-second. Fallback for nulls only, with bounded concurrency. This is the real fix; the 10s admin-app timeout is the seatbelt. |

### C. Tests + the post-deploy log-audit gate (Chris's process request — and how this fix is verified)
- **RTL** (`LiveBoardPoller`): mock `getBoardStateAction` resolving after a tick → assert the Refresh button's `disabled`/`animate-spin` clears. Fails on current code (defect ②), passes after.
- **E2E** (Playwright, `/keytags` Board): stub orchestrator so `getKeytagDashboard` is slow but board-state fast → click Release → assert it settles <5s and the row updates. Fails today (45s hang), passes after the Suspense + timeout fix.
- **Regression guard**: an E2E/structural test asserting each `/keytags` tab is `<Suspense>`-isolated (a slow tab can't block the page).
- **NEW post-deploy log-audit gate** (`/code-review --deployment <id>` mode + a new agent in `.agents/code-review/`): pulls Vercel runtime logs + Supabase edge logs for the deployed version and **fails closed** on function/render timeouts, `OrchestratorClientError … aborted due to timeout`, 5xx, unhandled errors, or any render >5s. Runs post-deploy (matches the team's workflow). **This fix is verified by running this gate against the live deploy and confirming zero `getKeytagDashboard` timeout lines after the deploy timestamp.**

---

## Deploy order
1. **orchestrator-mcp** (B) first — so the dashboard is fast before the admin-app's 10s timeout applies. Confirm v69 ACTIVE.
2. Merge → admin-app (A) deploys.
3. Run the **log-audit gate** against the new admin-app deployment → must show zero new `getKeytagDashboard` timeouts.
4. **Hard gate — Chris re-tests:** on-screen `BUILD:` SHA matches the merge; per-row Release, Assign, bottom Release, AND Refresh all settle within a few seconds; leave the page open >60s — no periodic hang.

## Adversarial check (does a lone Refresh settle?)
After B, `getKeytagDashboard` is sub-second, so even if Suspense doesn't fully decouple the action from the render, the re-render is fast → `isPending` clears in seconds. Suspense + the 10s seatbelt bound the worst case regardless. Defect ② fix clears the Refresh's own orphaned-transition path. Both are independent and ship together. Remaining low-confidence item (a single `POST /keytags status 0` middleware outlier) is deprioritized — revisit only if any spin survives A+B.
