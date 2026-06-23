# Keytag Live Board — merge Assign/Release into Live state + customer column — plan

> Feature marker: `.feature/current-feature.json` (`keytag-live-board`). Status: **plan** — awaiting Chris's
> approval before `/feature-implement`. Research basis: workflow `wf_ad92bbc9-00a` (4 agents incl.
> adversarial verify vs live DB) — full output in the session transcript `tasks/wwkedy7fd.output`.

---

## 1. Why

The `/keytags` Live state tab is read-only and the Assign/Release actions live in a separate tab where you
re-type the RO#. Operators want a single operational **board**: see every in-use tag (with the customer
name) and act on each row inline, plus see the ROs that *need* a tag and assign them in one click.

## 2. Locked decisions (from Chris)

| # | Decision |
|---|---|
| D1 | Merge Assign/Release into the Live board; per-row **Release** on tagged rows, per-row **Assign** on untagged rows. |
| D2 | Add a **Customer name** column — resolve once **at assign time**, store on the keytags row (+ one-time backfill). No per-load Tekmetric lookups. |
| D3 | Add **untagged ROs** to the board so they can be tagged from a row. |
| D4 | Keep the board fresh by **polling our own DB** (not re-pulling Tekmetric's WIP list each load). |
| D5 | **Remove** the Assign/Release tab; add a **backup Release+Assign card** (manual by-RO# + the tag lookup) at the bottom of the board. |
| D6 | **No Tekmetric backup poll for now.** If untagged-WIP staleness ever bites, a future `wip`-refresh cron is the fix. |

## 3. ⚠️ Critical correction from the adversarial verify (needs Chris's nod — §8)

D3+D4 originally implied deriving "untagged WIP ROs" from the `keytag_webhook_events` lifecycle. **The verify
step falsified that against live data:** that derivation returns 10 ROs today, of which **6 are closed/paid-out
false positives** (3 posted-paid; 3 orchestrator `claude_desktop` releases that emit *no* webhook row) and
**4 are open-DRF review-pending**; **0 are genuine "WIP, no tag, no review."** A stale `status_updated`
(status_id=2) arriving 0.9–11.3 s *after* a release resurrects closed ROs. Shipping that would invite an
operator to tag an **already-paid** RO (Tekmetric may even block the PATCH).

**Corrected data layer (recommended):**
- **Tagged section** = the `keytags` in-use set (assigned + posted_ar) — our authoritative table, as today.
- **Untagged section** = **reconciled sources only**: open **DRF/REG** manual reviews (`keytag_manual_reviews`
  — work approved, drift-gate fired, needs a human tag; already tracked + emailed) **+** the dashboard
  snapshot's `ros_without_tags` (ARN / A‑R-without-tag, reconciled nightly). This is the real actionable set
  and it's already reconciled — no fragile webhook inference.
- **Polling** = re-read the **small in-use `keytags` set** (~32 rows, fast DB, no Tekmetric) each tick, so
  out-of-band (orchestrator) releases converge too — instead of a webhook-delta that misses them.

This still honors D4 ("don't re-pull Tekmetric; poll our DB") and D3 ("untagged ROs on the board") — it just
sources them from reconciled tables instead of raw event lifecycle.

## 4. File-by-file change list

### 4a. Database (`supabase/migrations/`)
- **NEW** `…_keytags_customer_name.sql` — `ALTER TABLE public.keytags ADD COLUMN IF NOT EXISTS customer_name TEXT;`
  + comment. Additive (mirrors `last_activity_at` / `changed_by_user_label`). **No new index.**
- **EDIT (in same migration)** `release_keytag_for_ro` + `release_keytag_as_orphan` — add `customer_name = NULL`
  to their existing UPDATE SET lists (1 line each; mirror `customer_id = NULL`). **No change to
  `assign_next_keytag` / `force_assign_keytag` signatures** (frozen — PGRST203 risk).

### 4b. Edge / shared TS (`supabase/functions/`)
| File | Change |
|---|---|
| `_shared/keytag-customer-name.ts` | **NEW** `resolveCustomerName(sb, shopId, customerId)` → reuse `customerDisplayName` + `tekmetricGetJson('/customers/{id}')`; null on null id / any failure. |
| `keytag-tekmetric-webhook/index.ts` | After a **new** `assign_next_keytag` success (~:815), resolve + `UPDATE keytags SET customer_name WHERE ro_id = roId` (gated on a fresh pick; try/catch; **check the UPDATE error**). |
| `_shared/tools/keytag-management.ts` | Fold `customer_name` into the existing post-assign UPDATE (:287-291), **keyed on `ro_id`**, only on a new assignment. |
| `_shared/tools/manual-review-tools.ts` | Sites c1/c2/c3 (force/round-robin assign): after success, `getRepairOrderById`→customerId→resolve→`UPDATE … WHERE ro_id` (or leave null for backfill). Low priority. |
| `keytag-bulk-reconcile/reconcile.ts` | Steady-state self-heal: when a touched/assigned row has `customer_name IS NULL`, resolve + set it (24h ceiling on any miss). |
| **one-time backfill** | A `--backfill-names` invocation of bulk-reconcile (or a small script): for in-use tags with `customer_name IS NULL AND customer_id IS NOT NULL`, run the dedup'd serial `buildCustomerNameMap` walk + UPDATE. 32 rows today. |

### 4c. admin-app (`admin-app/`)
| File | Change |
|---|---|
| `src/components/keytag/LiveBoardTab.tsx` | **NEW** Server Component (replaces LiveStateTab as the `live` content): header strip + tagged table (+ Customer column + per-row Release) + untagged table (from reconciled source + per-row Assign) + bottom backup card. |
| `src/components/keytag/BoardClient.tsx` | **NEW** `"use client"` — holds both row arrays + poll cursor in state (seeded from server props); renders the poller + both tables; merge/onResolved handlers; **freezes a row with an in-flight action/open dialog** so a poll can't splice it. |
| `src/components/keytag/KeytagActionRow.tsx` | **NEW** `"use client"` shared per-row: own `useActionState(assign|release)` + own `dialogOpen` + reused `ConfirmationDialog` + toasts; icon-first button; `onResolved(ro_number)` on success. Auto-assign never opens a dialog (matches existing contract). |
| `src/components/keytag/LiveBoardPoller.tsx` | **NEW** `"use client"` poller (models `DashboardPoller`): re-reads the authoritative in-use set each tick; calm status dot + manual Refresh. |
| `src/actions/keytag/board-state.ts` | **NEW** `"use server"` (`wrapAdminAction`+`requireAdmin`) returning the current board state (in-use keytags + untagged-review/ros_without_tags) for the poll. DB-only, no Tekmetric. |
| `src/components/keytag/BoardBackupTools.tsx` | **NEW** thin wrapper composing `AssignKeytagForm` + `ReleaseKeytagForm` + `WhoIsOnTagForm` **verbatim** (the backup card). |
| `src/components/keytag/KeytagsTabs.tsx` | Drop `assignRelease` prop + the `assign-release` trigger/content + the now-unused `ArrowLeftRight` import (7 → 6 tabs). |
| `app/keytags/page.tsx` | Remove `AssignReleaseTab` import/prop; remove `assign-release` from the `?tab=` allowlist (stale link → dashboard, verified safe); `live={<LiveBoardTab actorEmail={email} />}`. |
| `src/lib/orchestrator/types.ts` | Add `BoardRow` (enriched WipKeyTagEntry + `customer_name`) + the board-state result shape. |
| `src/components/keytag/AssignReleaseTab.tsx` | **DELETE** (absorbed into the backup card). |
| `src/components/keytag/LiveStateTab.tsx` | **DELETE** (superseded by LiveBoardTab). |
| `_shared/tools/repair-orders.ts` (+ registration) | **Optional backend step:** enrich `listWipKeyTags` with `customer_name` (read the new column) so the tagged table renders names server-side; mirror in `WipKeyTagEntry`. |

> Kept (NOT dead): `AssignKeytagForm`, `ReleaseKeytagForm`, `WhoIsOnTagForm`, and the `assignKeytagAction` /
> `releaseKeytagAction` / `whoIsOnTagAction` — used by the backup card and the per-row rows.

## 5. Phasing
1. **Backend-1** — migration (customer_name column + release-RPC nulling) + `resolveCustomerName` + capture at the assign sites + reconcile self-heal + run the one-time backfill. TDD on the helper + a pgTAP for the column/RPC.
2. **Backend-2** — `listWipKeyTags` customer_name enrichment + the board-state read path + types.
3. **Frontend-1 (functional)** — LiveBoardTab + BoardClient + KeytagActionRow + LiveBoardPoller + backup card + tab removal. Wire actions; get behavior right.
4. **Design polish** — `frontend-implementer` against the design spec.
5. **Verify** — typecheck/tests/build + `/code-review` + UI hard-gate reviewers.

## 6. Verification
- Unit: `resolveCustomerName` (null id, failure→null), board-state shaping. pgTAP: customer_name column + release RPCs null it.
- Behavior: customer-name capture never blocks/changes an assign (assign succeeds even when the customer GET fails); released tag's name is cleared.
- Build clean; `/code-review` gate; UI hard-gate (design/wiring/dead-code/behavior-parity) blocker-free; dead-code confirms AssignReleaseTab/LiveStateTab fully removed.
- Smoke: per-row Release/Assign + confirmation; the board stays live as tags change; backup card works for an RO not on the board.

## 7. Frontend design spec
UI work is substantial (new board, two action-tables, poller, backup card). A `frontend-design-director`
spec is **mandatory** this phase → `.claude/work/design/keytag-live-board-spec.md` (dispatched; linked in the
marker `artifacts.design_spec`).

## 8. Open decision for Chris (approve before implement)
1. **Untagged-section source (the big one):** OK to source the untagged rows from **open DRF/REG reviews +
   the reconciled `ros_without_tags` snapshot** (correct, already-reconciled) instead of the raw
   webhook-lifecycle derivation (which the verify proved surfaces paid-out ROs)? *(Strongly recommended.)*
2. **Polling source:** re-read the small in-use `keytags` set each tick (DB-only, catches orchestrator
   releases) vs. a webhook-event delta (cheaper but misses out-of-band releases). *(Recommend the keytags
   re-read; it's tiny and authoritative.)*
3. **Poll interval:** 15 s (snappier; DB-only so cheap) vs. 60 s like the dashboard. *(Recommend 15 s.)*
