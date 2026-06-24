# Keytag Live-board: release/assign spin + RO-disappear + tab-reset — root cause & fix plan

**Date:** 2026-06-24 · **Worktree:** `keytag-board-release-fix` (module `keytag`) · **Reporter:** Chris
**Trigger commit (regression source):** `db3019b` "feat(keytag): merge Assign/Release into the Live board (functional)"
**Method:** 4 parallel investigators + adversarial verifiers, all framework claims cited to official docs; empirical anchors from `keytag_audit_log`, `keytag_confirmation_tokens`, and `orchestrator-mcp` edge logs.

---

## Incident timeline (RO 153380) — empirically reconstructed

| Time (UTC) | Event | Source |
|---|---|---|
| 15:03:50 | tag **red #75 assigned** (`ro_work_approved`) | webhook |
| 15:11:16 | tag **red #75 released** — **this was the DASHBOARD board release** (Chris confirms Claude Desktop was NOT used) | admin-app board, **mislabeled `claude_desktop`** in audit |
| 15:12:38, 15:13:17 | two `force_assign` confirmation tokens for "Force-assign Red 77 to RO #153380" created, **both `consumed_at = null`** | board assign retries that never settled |

**The board release SUCCEEDED server-side.** The spinner kept spinning *after* the mutation already applied. That single fact reframes everything below.

---

## Root causes

### Bug 1 — Release/Assign buttons "continually load" (HIGH confidence, verified)

Both `release-keytag.ts:82` and `assign-keytag.ts:101` call `revalidatePath('/keytags')` on success. Per the [Next.js Server Actions docs](https://nextjs.org/docs/app/guides/server-actions), a `revalidatePath` inside a Server Action re-renders the **current route server-side** and ships the new RSC payload **in the same action response** (a seeded navigation). `/keytags` is `export const dynamic = 'force-dynamic'` ([page.tsx:25](admin-app/app/keytags/page.tsx)) and renders **all six tab server components** every render ([page.tsx:55-63](admin-app/app/keytags/page.tsx)). Per [react.dev/useTransition](https://react.dev/reference/react/useTransition), `useActionState`'s `isPending` "stays true until all Actions complete and the final state is shown … awaited async work is included." So the button spinner stays on for the **entire multi-tab re-render**, even though the orchestrator already applied the change. The old bottom `ReleaseKeytagForm` shares the same action → it spins too.

**Critical refinement (adversarial verifier, via git):** the page-wide `revalidatePath` **existed pre-combine and worked** (`git show db3019b^:.../release-keytag.ts:82` is identical; the page was already `force-dynamic`). So `revalidatePath` alone is *not* the regression. The **delta introduced by `db3019b`** is:
1. **NEW `LiveBoardPoller`** — a 15 s `getBoardStateAction` server action that **did not exist pre-combine** ("No client-side polling for v1" in the old `LiveStateTab`). Next.js [dispatches Server Actions one-at-a-time per client](https://nextjs.org/docs/app/guides/server-actions), so a poll tick in flight **serializes ahead of** the user's mutation, and a poll firing during the multi-second revalidation render **queues behind it**.
2. **Board read doubled** from 1 orchestrator call (`listWipKeyTags`) to 2 (`+ listManualReviews`) per render.

(DashboardTab uses `unstable_cache` 60 s, so it's *not* re-hit every revalidation; the heavy uncached reads are LiveBoard + ManualReviews + Audit.)

**→ A clean fix needs BOTH:** stop the page-wide revalidate **and** stop the poller from contending.

### Bug 2 — RO disappears and can't be re-assigned (HIGH confidence, verified)

The board is built from exactly two sources ([load-board-state.ts:52-79](admin-app/src/lib/keytag/load-board-state.ts)): **tagged** = `listWipKeyTags` (keytags `status IN ('assigned','posted_ar')`), and **untagged** = OPEN `keytag_manual_reviews` in 3 categories. A released RO with no tag and no open review is in **neither** list → invisible.

**Strengthened by the verifier:** on release, `keytag-management.ts:539` calls `autoResolveReviewsForRo`, which **closes every open review for the RO** (this is the very recent commit `0e108b3` "auto-resolve hooks at terminal-release sites"). So a single release drops the RO from *tagged* **and** closes any review keeping it on *untagged* — disappearance is **structurally guaranteed**, not incidental.

The re-assign "didn't bring it back" for two reasons: (a) **discoverability** — there's no per-row assign for an off-board RO; the only typed-RO# path is `BoardBackupTools → AssignKeytagForm`, buried under a dashed "Manual tools" card (pre-combine, `AssignReleaseTab` made this the *primary* UI for any RO); and (b) the re-assign repaint rides Bug 1's hung post-success path (or a mid-spin refresh aborted the unconsumed confirmation token — see 15:12:38/15:13:17).

### Bug 3 — Reload always lands on Dashboard (HIGH confidence, verified)

[KeytagsTabs.tsx:44](admin-app/src/components/keytag/KeytagsTabs.tsx) renders `<Tabs defaultValue={...}>` **uncontrolled** (Base UI reads `defaultValue` once, tracks the rest internally). Tab clicks never write `?tab=` to the URL, so on reload [page.tsx:33-45](admin-app/app/keytags/page.tsx) sees no `tab` param and defaults to `'dashboard'`.

### Provenance bug (confirmed, CROSS-MODULE)

`keytag-management.ts:317` (assign) and `:523` (release) **hardcode `p_source: 'claude_desktop'`** in `log_keytag_audit`. The board routes through these tools, so **every admin-app board action is mislabeled `claude_desktop`**. The admin-app auth branch is identifiable at `orchestrator-mcp/index.ts:301` (X-Actor-Email). Fix requires threading the real source from the orchestrator into the tool → touches `supabase/functions/_shared/**` + `supabase/functions/orchestrator-mcp/**` (**outside the `keytag` module lock**).

---

## Scope decisions (locked by Chris, 2026-06-24)
- **Bug 2 → "keep ROs on board":** don't just un-bury the manual form — make a released-but-still-**open** RO stay visible on the board so it can be re-tagged in place.
- **Provenance → include now:** fix the `claude_desktop` mislabel in this worktree. The `orchestrator` module has been **co-claimed** (`orchestrator.lock`); `_shared` is soft-warning. Release both at `/project-done`.

### ⚠️ Key open design question (resolve first in the implement session's research)
"Keep ROs on board" needs a signal for **"released but work still open"** vs **"released because work is done"** (the latter should correctly leave the board). The system already models "WIP RO without a tag" as a manual review (`ar_regression` = "back in WIP, its tag was already released — needs a tag"). **Recommended approach:** on a terminal release, if the RO is still an open/WIP repair order, **keep/issue an `ar_regression` review instead of auto-resolving it** (`keytag-management.ts:539 autoResolveReviewsForRo`) so it stays in the board's untagged list — reusing existing plumbing, no new board concept. Must confirm: (a) the available open/WIP signal at release time (Tekmetric RO status vs keytags history), and (b) that issuing `ar_regression` won't fire an unwanted Pattern-B email. Read `.claude/memory/keytag/keytag_system_architecture.md` + the release tool + the reconciler before coding.

## Fix plan (keytag-module-owned unless noted)

### Bug 1 — stop the spin
1. **Remove `revalidatePath('/keytags')`** from `release-keytag.ts:82` and `assign-keytag.ts:101`. Rely on the **already-present optimistic update**: `BoardClient.onResolved` ([BoardClient.tsx:79-89](admin-app/src/components/keytag/BoardClient.tsx)) splices the resolved row out on success, and `LiveBoardPoller` reconverges every 15 s (cheap, no Tekmetric). `isPending` then clears the instant the orchestrator returns.
   - *Alternative if server-truth refresh is still wanted:* a **scoped `revalidateTag`** that only `loadBoardState` wraps — never re-run the Dashboard/ManualReviews/Audit reads for a single-row mutation.
2. **Pause the poller during activity** — in `LiveBoardPoller`/`BoardClient`, skip the 15 s tick while `frozen.current.size > 0` (a row is busy), so a poll can't serialize ahead of a user mutation.

### Bug 2 — keep ROs on board (CHOSEN)
- **Close the read-coverage gap** so a released-but-still-open RO stays in the board's "Needs a tag" list (with its per-row Assign control) instead of vanishing. Implement per the "Key open design question" above — recommended path is to keep/issue an `ar_regression` review on terminal release when the RO is still open, gating `autoResolveReviewsForRo` (`keytag-management.ts:539`) on RO work-status. Touches `load-board-state.ts`, the release tool in `_shared/tools/keytag-management.ts`, and possibly `repair-orders.ts` (listWipKeyTags). Keep `BoardBackupTools`' typed-RO# form as the existing fallback.

### Bug 3 — persist the tab
- Make `KeytagsTabs` **controlled + URL-synced**: seed `useState` from `props.defaultValue` (SSR-correct first paint), drive `<Tabs value>`/`onValueChange`, and on change write `?tab=` via **`window.history.replaceState`** (NOT `router.replace` — that re-runs all six server components on a force-dynamic page; NOT `pushState` — keeps the back button clean). Verified against [base-ui tabs](https://base-ui.com/react/components/tabs) + [Next.js linking-and-navigating](https://nextjs.org/docs/app/getting-started/linking-and-navigating).

### ⚠️ Audit-source DB guards (caught at review — migration required)
Threading `source='admin_app'` is NOT enough on its own: TWO DB guards reject any
source outside `claude_desktop/webhook/cron/manual_sql` — the
`keytag_audit_log_source_check` CHECK and the `auto_resolve_manual_review(p_source)`
allow-list. Without widening them, an admin-app assign/release **silently loses its
audit row** (the `log_keytag_audit` RPC error was unchecked) and **strands moot
reviews**. Fixed in migration `20260624140000_keytag_audit_source_admin_app.sql`
(both guards += `admin_app`) + the audit RPC error is now structured-logged.
**Lesson: a new `source` value needs DB-guard changes in 2 places, not just TS.**

### Provenance — INCLUDED (CROSS-MODULE; `orchestrator` co-claimed)
Thread the real caller/source from the orchestrator's admin-app auth branch (`orchestrator-mcp/index.ts:301`, X-Actor-Email) into `keytag-management.ts:{317,523}` instead of the hardcoded `'claude_desktop'` — e.g. pass a `source`/`channel` (`admin_app` vs `claude_desktop`) in the tool-call context and have `log_keytag_audit` record it. Add a regression test asserting an admin-app-originated release/assign is logged with the admin-app source, not `claude_desktop`.

---

## Secondary hardening (found in the sweep — not blockers)
- **Frozen-row leak** (`BoardClient.tsx:62-116`): `frozen.current` isn't cleared if a busy row unmounts for a non-resolve reason; and freeze keys on `ro_number` while `onState` merges untagged by `review_code`. Add an unmount cleanup + reconcile the key. (Once `revalidatePath` is removed, the dominant churn source is gone.)
- **Assign double-handle**: `onResolved` splice + `revalidatePath` re-add — self-resolves once `revalidatePath` is removed.

## Broader pattern (out of keytag scope — report only)
`SchedulerConfigTabs.tsx:84` has the **same uncontrolled-tabs bug across 10 tabs, and worse** — `schedulerconfig/page.tsx:135` hardcodes `defaultValue="sub-desc"` and never reads `searchParams.tab`. This is the same "reload should keep the current tab" requirement Chris raised app-wide. Belongs to `schedulerconfig`/`admin-core`, not this worktree.

## Webhook lifecycle / auto-resolve — verified (2026-06-24, Chris: leave as-is)
Confirmed the keytag lifecycle is already **webhook-driven in real time**, not cron-dependent:
- Counter-paid (POSTED_PAID) `keytag-tekmetric-webhook/index.ts:1095-1128` and A/R-paid
  (`payment_made`) `:1303` both **release the tag + `autoResolveReviewsForRo`** immediately.
  Unpost (A/R→WIP) `:538` reverts `posted_ar`→`assigned` (tag stays on). The nightly cron
  is the backstop, not the primary path. These auto-resolve hooks were added 2026-06-23/24
  (commits ec847e8/0e108b3 + the 70-stale-review backfill) — so the historical
  "unpost→repay reviews stay stuck" pain predates them and is now handled on payment.
- **Bug-2 filter verified accurate:** `released` from `prior_status='assigned'` catches ONLY
  manual WIP releases (keys came back). Counter-paid releases write `prior_status=NULL`
  (`:1113`), A/R-paid writes `posted_ar` — there are **0 webhook releases from `assigned`**,
  so paid/closed ROs never leak onto the board.
- **A/R stays tagged + stale@3d** is already in place (the "In use" table's `STALE_DAYS=3`).

**Deferred (Chris, leave-as-is — revisit only if a stuck review recurs):** fleet A/R
`payment_made` webhooks can arrive with no RO object → `roId=null` → `autoResolveReviewsForRo`
no-ops, so *those* reviews wouldn't auto-clear (same null-RO quirk the qteklink RO# cache hit).

## Test plan (TDD)
- **Bug 1:** unit-assert `release-keytag`/`assign-keytag` success paths no longer call `revalidatePath`; component test that the row button's `isPending` clears on the action's resolved success without awaiting a page refresh.
- **Bug 3:** component test — selecting a tab writes `?tab=` and a re-mount seeded from `?tab=` shows that tab; Playwright reload-keeps-tab E2E.
- **Bug 2:** E2E — release an RO, confirm the assign-by-RO# control is visible and re-assigning re-surfaces it.
