# Keytag board — spin + disappear, PROVEN root cause + fix (plan)

**Feature:** `keytag-board-residual-fixes` (reopened) · **Date:** 2026-06-25
**Research:** workflow `wf_89486d1f-7b0` — 5 cited agents, Next.js + React mechanics quoted verbatim from official docs, code+runtime forensics, disappear predicate validated against live DB rows. NO guessing.

Supersedes `board-residual-fixes-plan-2026-06-24.md` (which DROPPED `released_wip` — that was wrong and reintroduced the disappear).

---

## Why (proven root cause)

### The spin
The board's 15s auto-refresh, `LiveBoardPoller`, calls **`getBoardStateAction` — a Server Action** — every tick (inside `useTransition`). Two official-doc facts make that fatal next to the Release/Assign buttons:

- **React** (react.dev/reference/react/useActionState + useTransition, verbatim): *"If there are multiple ongoing Actions, React batches them together"*; `isPending` *"stays true until all Actions complete and the final state is shown to the user."*
- **Next.js 15.5** (nextjs.org/docs/15/.../updating-data, verbatim): *"The client currently dispatches and awaits them one at a time."*

So a user Release/Assign Action **batches/serializes with the poller's Action**; because the poller re-fires every 15s (some calls ~8s, per the edge logs), a fresh poll Action keeps re-entering the batch → the user button's "all Actions complete" condition is never met → **perpetual spin**. The mutation itself succeeds in ~600ms (DB-confirmed: RO 153280 released `admin_app` 14:41:52).

Corroboration: the old `AssignReleaseTab` had **no poller** (so the identical forms cleared instantly); `db3019b` introduced the first Server-Action poller onto the forms' panel; removing `revalidatePath` didn't help because these actions emit no re-render (*"an action that does none of [revalidate/redirect/cookie] carries only its return value, current route is not re-rendered"*); the PR#3 pause failed because it flips its flag in a **post-commit `useEffect`** — too late to un-batch a poll already in flight. Base UI Tabs `keepMounted=false` ⇒ the Dashboard poller is unmounted on the Board tab and is NOT a factor.

### The disappear
The release tool calls `autoResolveReviewsForRo` (`keytag-management.ts:581`) which **closes** every open review for the RO and creates none. With the audit-derived `released_wip` board source dropped (b615bf0), a manually-released still-WIP RO has no tag and no review → it appears on **neither** board list. That's why 153280 vanished. (My drop, my fault.)

---

## Locked decisions (Chris, 2026-06-25)
1. **Spin fix = remove the auto-poller** (manual refresh + optimistic updates) — the pre-`db3019b` working config. (Not the route-handler auto-refresh option.)
2. **Keep the inline board actions + the merged board** — the fix makes them safe; no rollback to separate tabs.
3. **Restore released-WIP visibility now**, with the paid/closed exclusion (disappear fix Option a).

---

## Part 1 — Spin fix (remove the recurring Server-Action poller)

| File | Change |
|---|---|
| `components/keytag/LiveBoardPoller.tsx` | Remove the 15s `setInterval` auto-tick + the `useIsMutating`/`mutatingRef` plumbing. Keep the **manual Refresh button** (one-shot `getBoardStateAction` — user-initiated + solitary, so it never batches with a click) + the "Updated HH:MM" stamp. |
| `components/keytag/board-mutation-store.ts` | **Delete** (the failed pause machinery — now dead). |
| `components/keytag/KeytagActionRow.tsx` | Remove the two `useReportMutation(isPending)` calls + import. `useActionState` now clears normally. |
| `components/keytag/AssignKeytagForm.tsx`, `ReleaseKeytagForm.tsx` | Remove `useReportMutation(isPending)` + import. |
| `components/keytag/DashboardPoller.tsx` | Revert the `useIsMutating`/pause I added (back to plain 60s `router.refresh`; it's on the Dashboard tab with no mutations, so it was never a factor). |
| `components/keytag/BoardClient.tsx` | No poller-related change — keep optimistic `onResolved` splice + the `onState` merge (Refresh feeds it). |
| `tests/unit/LiveBoardPoller.test.tsx` | Rewrite: assert NO recurring auto-tick fires (a regression guard against re-introducing a background Server Action); manual Refresh still polls once. |

**Why it clears the spin (adversarially checked):** with no recurring Action mounted on the Board panel, the user's Release/Assign is the *sole* ongoing Action → React's "all Actions complete" is just that one action (~600ms) → `isPending` clears. Refutation attempt: any other concurrent Action? No — Dashboard panel (and its `router.refresh`) is unmounted (`keepMounted=false`). Holds.

## Part 2 — Disappear fix (restore released-WIP visibility, exclude paid/closed)

Re-apply the **non-spin** board-source parts of `dd298a1`, **plus** a `keytag_webhook_events` terminal-exclusion the original lacked.

| File | Change |
|---|---|
| `supabase/functions/_shared/tools/repair-orders.ts` | Re-add `listReleasedWipNeedingTag` (+ result type + window const) **with** the exclusion below. |
| `supabase/functions/_shared/orchestrator-tools.ts` | Re-register the `listReleasedWipNeedingTag` tool + import. |
| `admin-app/src/lib/orchestrator/types.ts` | Re-add the tool's `KeytagToolMap` entry + arg/result types; re-add `UntaggedBoardRow.kind` + `released_tag`. |
| `admin-app/src/lib/keytag/load-board-state.ts` | Re-add the 3rd source, merged + de-duped vs open reviews (reviews win). |
| `admin-app/src/components/keytag/BoardClient.tsx` | Re-add the `kind`-discriminated row: render released_wip rows as **assign-in-place** (only action = "assign a tag"; no review `code`). |
| `admin-app/tests/unit/load-board-state.test.ts` | Re-add the merge/de-dup test. |
| new unit test | The exclusion predicate: **RO 153280 IN, RO 153688 OUT** (the two real ROs). |

**Validated exclusion predicate** (proven on live data — 153280 stays, 153688 excluded):
```
released-while-WIP (keytag_audit_log: action='released', prior_status='assigned', within window)
  AND keytags.status NOT IN ('assigned','posted_ar')            -- no current tag
  AND NOT EXISTS (keytag_webhook_events w
        WHERE w.tekmetric_ro_id = audit.ro_id
          AND w.received_at > audit.occurred_at
          AND ( (w.event_kind='ro_posted'     AND w.status_id IN (5,6))
             OR (w.event_kind='ro_sent_to_ar' AND w.status_id = 6)
             OR  w.event_kind='payment_made' ))
  -- belt-and-suspenders (close that landed while still tagged):
  AND NOT EXISTS later keytag_audit_log row action='marked_posted'
                 OR (action='released' AND reason LIKE 'webhook:%')
```
Window bounded (default 3 days) so the derived list can't accumulate. **Verify** (don't assume) that `listManualReviews` still yields `ro_number` from `context->>'ro_number'` so the reviews-win de-dup works.

---

## Verification
- admin-app `tsc` + `vitest` (incl. the 153280-in/153688-out predicate test + a no-auto-tick guard) + `eslint` + `build`.
- `deno test` full suite + `deno check` on the changed edge files.
- Claude review agents (regression/pattern/wiring/dead-code) + `/code-review` gate.
- **Definitive pre-merge check** (from forensics): the Board panel with the poller removed → release/assign clear instantly.

## Deploy order (REVERSED from last time)
The admin-app will now CALL `listReleasedWipNeedingTag`, so the orchestrator must have it first:
1. `supabase functions deploy orchestrator-mcp` (re-adds the tool) → confirm v69 ACTIVE.
2. Merge → Vercel deploys admin-app (which calls the tool).
3. **Hard gate — Chris re-tests:** per-row Release + bottom Assign/Release stop spinning; a released-WIP RO (153280-style) stays on "needs a tag"; a paid/closed RO does NOT; the page still keeps your tab on reload.
