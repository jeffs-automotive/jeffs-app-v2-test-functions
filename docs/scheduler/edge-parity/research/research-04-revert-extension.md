# Research 04 — Extending `revertMdUpload` to cover legacy tables

**Feature:** `scheduler-edge-parity`
**Scope:** Design the extension to `revertMdUpload` so it covers the 5 legacy tables once they start persisting `pre_state_snapshot` (per research-03). Closes Important finding I4 from `.claude/work/ai-review-2026-05-25T22-40-58Z.md`.
**Authored:** 2026-05-25 via Explore sub-agent (Opus). Content returned inline + transcribed verbatim.

## 1. Current `revertMdUpload` table dispatch logic

The dispatch is a **simple two-string allow-list guard** in `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:874-882`:

```ts
const tableName = row.table_name as string;
if (tableName !== "testing_services" && tableName !== "routine_services") {
  return {
    ok: false, upload_id, table_name: tableName,
    error_message: `revert only supports testing_services or routine_services (got ${tableName})`,
  };
}
```

The actual restore (lines 913-929) is **table-agnostic** because both supported tables share the same `(shop_id, service_key)` natural key and the same snapshot shape: `{ before: Record<service_key, FullRow>, added_keys: string[] }`. It does:

1. `sb.from(tableName).upsert(upsertRows, { onConflict: "shop_id,service_key" })` for rows in `snapshot.before`
2. `sb.from(tableName).update({ active: false }).in("service_key", added_keys)` for rows the original upload had INSERTed

This is **not a per-table handler dispatch** — it's one generic UPSERT+soft-delete path that only works because the two V2 catalogs are structurally identical.

**Crucial gap already present today:** three V2 uploaders (`uploadSubcategoryServiceMapMdV2` line 1052, `uploadSubcategoryDescriptionsMdV2` line 1732, plus the legacy `uploadConcernCategoryMd`) **all write `table_name="concern_subcategories"`** with structurally different snapshot shapes. Today's revert guard rejects all three by table-name allow-list. After extension we cannot dispatch on `table_name` alone — we need a discriminator. **Recommendation: add a `snapshot_kind` string field to the snapshot JSON itself** (e.g. `"testing_services_v2"`, `"concern_subcategories_descriptions"`, `"concern_subcategories_map"`, `"concern_subcategories_catalog_per_category"`, `"closed_dates_future"`, …) and dispatch on it. This is forward-compatible and survives the table-name overload.

## 2. What changes to extend dispatch — per-table handler proposal

Proposed handler registry keyed on `snapshot_kind`:

```ts
type RevertHandler = (
  sb: SupabaseClient,
  shopId: number,
  snapshot: unknown,
  audit: AdminAudit,
) => Promise<{ restored: number; deactivated: number; deleted: number }>;

const REVERT_HANDLERS: Record<string, RevertHandler> = {
  // already supported
  testing_services_v2: revertCatalogV2,
  routine_services_v2: revertCatalogV2,
  // already need handlers for the 3 V2 uploaders that write concern_subcategories
  concern_subcategories_map_v2: revertSubcategoryMap,
  concern_subcategories_descriptions_v2: revertSubcategoryDescriptions,
  concern_questions_required_facts_v2: revertQuestionRequiredFacts,
  // the 5 new legacy tables (this research)
  concern_questions_per_category: revertConcernCategoryUpload,        // 2-table
  concern_subcategories_per_category: revertConcernCategoryUpload,    // alias
  concern_category_guidelines: revertConcernCategoryGuideline,        // 1-row upsert
  appointment_default_limits: revertAppointmentDefaultLimits,         // 7-row upsert
  closed_dates: revertClosedDates,                                    // future-only add/del
};
```

| Table | Snapshot kind | Handler shape | Cleanly mirrors V2? |
|---|---|---|---|
| `concern_questions` (per-category) | `concern_questions_per_category` | Restore both `concern_subcategories` rows (by `id`) and `concern_questions` rows (by `id`); soft-delete (active=false) any IDs in `added_subcategory_ids` / `added_question_ids` | **No** — two-table operation. Snapshot must hold `{ subcategories_before: Record<id, Row>, questions_before: Record<id, Row>, added_subcategory_ids, added_question_ids }`. Restore by PK `id` (not natural key) because subcategory `slug` may have been renamed in the original upload |
| `concern_subcategories` (per-category subset) | shared with above | (same handler) | **No** — must be scoped to category; otherwise a category-A revert touches category-B rows that share a slug |
| `concern_category_guidelines` | `concern_category_guidelines` | UPSERT/DELETE the single `(shop_id, category)` row from snapshot; if `original_was_insert=true`, DELETE instead of restore | **No** — single-row composite PK `(shop_id, category)`; no `active` soft-delete column → must hard-delete the row added by the upload |
| `appointment_default_limits` | `appointment_default_limits` | UPSERT all 7 rows from snapshot keyed on `(shop_id, day_of_week)` | **Yes (close)** — table is essentially complete-replace per day_of_week; never INSERTs new keys because PK domain is fixed [0..6]. `added_keys` always empty, just restore `before` rows. The current uploader (scheduler-admin.ts:1316-1331) never DELETEs, so revert never needs to delete either |
| `closed_dates` | `closed_dates_future` | For every snapshot date: UPSERT row back. For every date in `original_diff.added` (i.e. dates that were inserted by the upload): **hard-DELETE** (no `active` column on `closed_dates`). All scoped `closed_date >= today_at_original_upload_time` | **No** — append-only natural shape + uses HARD DELETE in the original uploader (scheduler-admin.ts:1565-1572). Snapshot needs `{ before_rows: Array<{closed_date, reason, source}>, added_dates: string[], original_today: 'YYYY-MM-DD' }`. The handler must compute "effective revert window" = `>= original_today` to refuse touching dates that have since become past (frozen history) — otherwise a delayed revert resurrects a date that's already in the past, violating the "past closures are immutable history" invariant (scheduler-admin.ts:1611-1612) |

### `concern_subcategories` per-category scoping

**Yes**, the snapshot must be scoped per-category because `uploadConcernCategoryMd` is itself category-scoped (scheduler-admin.ts:1862-1866 selects `WHERE shop_id=? AND category=?`). The Pattern S backfill must capture the same scoping. Snapshot example:

```json
{
  "snapshot_kind": "concern_questions_per_category",
  "category": "brakes",
  "subcategories_before": { "12": { "id": 12, "slug": "squealing", "display_label": "Squealing", "display_order": 1, "active": true } },
  "questions_before": { "247": { "id": 247, "subcategory_id": 12, "question_text": "...", "display_order": 1, "options": [...], "multi_select": false, "active": true } },
  "added_subcategory_ids": [13, 14],
  "added_question_ids": [248, 249, 250]
}
```

The handler restores by PK `id` (subcategory `slug` is editable). It then soft-deletes (active=false) any IDs the upload had INSERTed.

### `concern_category_guidelines` shape

Single composite-PK row, no soft-delete column. Handler must support **both** `original_was_modify` (UPSERT back) and `original_was_insert` (HARD DELETE the row to restore the "no-row" state). Snapshot:

```json
{
  "snapshot_kind": "concern_category_guidelines",
  "category": "brakes",
  "before": { "shop_id": 1, "category": "brakes", "display_label": "Brakes", "guideline_prose": "..." } | null,
  "original_was_insert": false
}
```

### `closed_dates` append-only shape

Two distinct operations in the original upload (scheduler-admin.ts:1558-1573): UPSERT future rows, DELETE future rows missing from MD. Revert must do both inverses:

- For each `before_row`: UPSERT back (`onConflict: "shop_id,closed_date"`) — covers both "modified row" and "row deleted by upload" cases.
- For each `added_dates` entry: HARD DELETE — covers "row inserted by upload".
- All scoped `closed_date >= original_today` to preserve the past-is-frozen invariant.

## 3. 30-day cutoff + revert-of-revert + already-reverted rejection — race analysis

Current rejection logic in `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:843-867`:

```ts
// (a) revert-of-revert chain protection
if (row.operation !== "upload_md") {
  return { ok: false, ..., error_message: `cannot revert: ... is operation=${row.operation}, not upload_md` };
}
// (b) 30-day snapshot pruning
if (row.snapshot_pruned_at) {
  return { ok: false, ..., error_message: `cannot revert: pre_state_snapshot was pruned on ${row.snapshot_pruned_at}` };
}
// (c) snapshot existence
if (!row.pre_state_snapshot) {
  return { ok: false, ..., error_message: "cannot revert: no pre_state_snapshot captured ..." };
}
```

**Raceability assessment:**

- **(a)** is only a SELECT, not a serializable transaction. A 2-second window exists where two parallel `revertMdUpload(123)` calls each load `row.operation="upload_md"`, both pass the guard, both call UPSERT, both insert audit rows. The DB state ends up reverted-then-reverted-again (still equals snapshot, so visible idempotent), but two `revert_upload` audit rows are inserted.
- **"already reverted"** detection is **completely missing today**. No SELECT-then-INSERT-WHERE-NOT-EXISTS guard. The current implementation just lets you revert the same upload N times.
- **(b) 30-day** is fine — `snapshot_pruned_at` is set once by cron, set-once semantics, no race.

**Additional critical bug found (not in I4):** the audit-log CHECK constraint at `supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql:140` only allows `operation IN ('upload_md','manual_change','export_md')`. The revert call at scheduler-admin-catalog.ts:937 passes `operation: "revert_upload"`. **Every successful revert INSERT throws a CHECK violation**, `_logAudit` returns `null` via the warn-and-swallow path (line 673-682), and the revert returns `ok: true, revert_audit_log_id: undefined`. **The audit-log row for the revert action is silently never written today.** This must be fixed in the same migration as the race fix (see §6).

### Proposed race-fix (raceable rejection → atomic):

Add a `successor_revert_id BIGINT` column to `scheduler_admin_audit_log` with a **unique partial index**, plus a CHECK extension:

```sql
-- Migration: fix audit-log CHECK + add revert linkage
ALTER TABLE public.scheduler_admin_audit_log
  DROP CONSTRAINT scheduler_admin_audit_log_operation_check,
  ADD CONSTRAINT scheduler_admin_audit_log_operation_check
    CHECK (operation IN ('upload_md','manual_change','export_md','revert_upload'));

ALTER TABLE public.scheduler_admin_audit_log
  ADD COLUMN IF NOT EXISTS successor_revert_id BIGINT NULL
    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reverts_upload_id BIGINT NULL
    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE SET NULL;

-- Race-proof "already reverted" guard: a given upload_id can have AT MOST
-- ONE successful revert pointing back at it.
CREATE UNIQUE INDEX scheduler_admin_audit_log_one_successful_revert_per_upload_idx
  ON public.scheduler_admin_audit_log (reverts_upload_id)
  WHERE reverts_upload_id IS NOT NULL AND error_message IS NULL;
```

Then the apply path becomes a single transaction:

```ts
// (1) Pre-flight: lock the target row with FOR UPDATE so two parallel reverts
//     of the same upload_id serialize at the DB layer.
const { data: target } = await sb.rpc("revert_md_upload_acquire", {
  p_upload_id: upload_id,
});
// the RPC does:
//   SELECT id, operation, pre_state_snapshot, snapshot_pruned_at,
//          successor_revert_id, occurred_at
//     FROM scheduler_admin_audit_log
//    WHERE id = p_upload_id
//      FOR UPDATE NOWAIT;  -- second concurrent caller fails fast
// then returns the row.

// (2) Apply guards on the locked row.
if (target.operation !== 'upload_md') return { error_message: 'cannot revert: ...' };
if (target.successor_revert_id !== null) return { error_message: 'cannot revert: already reverted by audit_log_id=' + target.successor_revert_id };
if (target.snapshot_pruned_at !== null) return { error_message: 'snapshot pruned' };
if (target.occurred_at < now - 30d) return { error_message: '30-day cutoff' };

// (3) Apply revert + insert revert audit row + update parent.successor_revert_id
//     all in the SAME transaction. ON CONFLICT on the unique partial index
//     gives a hard "already reverted" failure if a parallel caller wins.
```

Server-side enforcement is now race-proof: even if the dry-run was approved 10 seconds ago, the row-lock during apply will fail one of two concurrent attempts, and the unique partial index is the second line of defense.

## 4. Pre-apply staleness check — currently missing

`revertMdUpload` today **does not** check whether the catalog head has drifted since dry-run. There is no `expected_confirm_token` in the `RevertArgs` interface (`scheduler-admin-catalog.ts:800-806`), and the apply path goes straight from the table-name guard to the UPSERT loop (lines 911-929).

**Scenario that silently regresses a 3rd-party change:**

1. T0: Alice uploads `testing_services` v100 → audit_log_id=A100, head_hash=`hA`.
2. T1: Alice runs `revertMdUpload(upload_id=A100, dry_run=true)` → returns revert_plan.
3. T2: Bob uploads `testing_services` v101 → audit_log_id=A101, head_hash=`hB`. Adds new service `oil_pressure_diag`.
4. T3: Alice runs `revertMdUpload(upload_id=A100, dry_run=false)`. The UPSERT replays A100's snapshot — but `oil_pressure_diag` is NOT in A100's snapshot, so it's left untouched in active state. Worse: any column Bob modified that A100's snapshot has a "before" value for **silently rolls back to A100's pre-state**.

### Proposed fix — staleness token on the revert

Mirror the V2 uploader's `expected_confirm_token` pattern. Compute the token over `(upload_id || current_head_content_hash || table_name)`:

```ts
// Dry-run computes:
const currentHead = await computeCatalogHeadHash(sb, shopId, tableName);  // sha256 of canonical export
const confirm_token = await sha256Hex(JSON.stringify({
  upload_id, table_name: tableName, head_at_dry_run: currentHead,
  snapshot_hash: await sha256Hex(JSON.stringify(snapshot)),
}));

// Apply re-computes and rejects on mismatch:
const currentHeadNow = await computeCatalogHeadHash(sb, shopId, tableName);
const recomputed = await sha256Hex(JSON.stringify({
  upload_id, table_name: tableName, head_at_dry_run: currentHeadNow,
  snapshot_hash: ...,
}));
if (recomputed !== args.expected_confirm_token) {
  return { ok: false, error_message: "confirm_token mismatch — table head changed since dry_run. Re-run dry_run." };
}
```

`computeCatalogHeadHash` reuses the existing exporter (`exportTestingServicesMdV2` etc.) and hashes the canonical MD output. The per-table handler must declare which exporter to use; this is one extra field on the handler registry: `canonicalHashFn`.

## 5. Dry-run + token shape — current state

The current `RevertArgs` (scheduler-admin-catalog.ts:800-806) supports `dry_run` but **NOT** `expected_confirm_token`. The dry-run path (lines 899-909) returns the plan but **does not return a token** for the apply path to echo back. This is a divergence from the V2 catalog uploaders (which DO require token round-trip; see lines 538-556).

**Proposal:** add `expected_confirm_token: string` to `RevertArgs` and `confirm_token: string` to `RevertResult.revert_plan`. Computation as in §4. Tool registry (scheduler-tools.ts:1176-1184) gets a new optional input field, and the description text gets updated to call out the two-step flow explicitly.

```ts
export interface RevertArgs {
  upload_id: number;
  audit: AdminAudit;
  dry_run?: boolean;
  expected_confirm_token?: string;  // ← new; required when dry_run=false
}

export interface RevertResult {
  // ... existing fields ...
  confirm_token?: string;           // ← new; returned on dry_run, echoed on apply
}
```

## 6. Audit-log entry for the revert itself

**Current state:** `revertMdUpload` does call `_logAudit` at scheduler-admin-catalog.ts:934-948 with `operation: "revert_upload"`. **However, the audit-log CHECK constraint at migration line 140 only allows `('upload_md','manual_change','export_md')`** — so the INSERT throws every time, the swallow-and-warn branch in `_logAudit` (lines 673-682) logs a warning to console, and the function returns `revert_audit_log_id: undefined`.

**Net effect today: zero revert audit rows exist in the database**. The diff_summary captures `reverted_upload_id`, intended for a future revert-detection query (`WHERE reverts_upload_id = ?`), but that field doesn't exist on the table.

### Required fixes (must land together):

1. **Loosen the CHECK** to include `'revert_upload'` (migration in §3).
2. **Add `reverts_upload_id` foreign-key column** (migration in §3) so the parent reference chain is queryable without text-parsing `diff_summary`.
3. **Update `_logAudit`** in scheduler-admin-catalog.ts:641-684 to set `reverts_upload_id` when present.
4. **Update the dispatcher** to set the parent's `successor_revert_id = <new revert row id>` in the same transaction (race-fix from §3).

Parent reference chain after fix:

```
upload row:   id=A100, operation='upload_md',    successor_revert_id=R201
revert row:   id=R201, operation='revert_upload', reverts_upload_id=A100
```

The "already reverted" guard then becomes a 1-row SELECT: `WHERE id=A100 AND successor_revert_id IS NULL`, race-proof by the unique partial index.

## 7. Multi-tenant safety

**Today's scoping is inconsistent and unsafe for multi-tenant.** Specifically:

- `scheduler_admin_audit_log` has **no `shop_id` column** (migration at supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql:134-147).
- `revertMdUpload` at scheduler-admin-catalog.ts:833-837 selects the audit row `WHERE id = upload_id` only — **not scoped by shop**. In a multi-tenant world, shop B could revert shop A's upload by passing the audit ID.
- The apply path does correctly use `shopId` for the actual table writes (lines 917, 926). So the revert WOULD write to shop B's tables — but using shop A's snapshot data. Silent cross-shop pollution.

### Required for the 5 new handlers (and pre-existing 2):

1. **Add `shop_id INTEGER NOT NULL` to `scheduler_admin_audit_log`** in the same migration as §3 fixes. Backfill via existing data (single-shop today) — `UPDATE ... SET shop_id = 1`. Add an index `(shop_id, occurred_at DESC)`.
2. **`revertMdUpload` selects `WHERE id = upload_id AND shop_id = $shopId`**. If not found → return generic "audit log row not found" (same error path as today, no info leak).
3. **Each new per-table handler reads/writes scoped by `shop_id`**, mirroring the existing V2 handlers:
   - `concern_questions_per_category`: `WHERE shop_id=$ AND category=$ AND id IN (...)` for both subcategory and question tables.
   - `concern_category_guidelines`: `WHERE shop_id=$ AND category=$` (composite PK).
   - `appointment_default_limits`: `WHERE shop_id=$ AND day_of_week=$`.
   - `closed_dates`: `WHERE shop_id=$ AND closed_date IN (...)`.
4. **Audit log INSERT** sets `shop_id: shopId`.

## 8. Test surface — new test cases

Mirror the existing `supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts` style (Deno-native, JSR `@std/assert`). One file per handler keeps blast radius small; alternatively one extended file. Each handler needs:

### `revertConcernCategoryUpload` (concern_subcategories + concern_questions, two-table per-category)

- `revert_restores_modified_subcategory_display_label` — round-trips a label change.
- `revert_deactivates_added_subcategory` — sub added by upload becomes `active=false`.
- `revert_restores_deleted_subcategory_to_active` — sub deactivated by upload becomes `active=true`.
- `revert_restores_modified_question_text` — round-trips a question_text edit.
- `revert_deactivates_added_question` — q added by upload becomes `active=false`.
- `revert_scopes_by_category` — modifying brakes/squealing doesn't touch noise/squealing with same slug.
- `revert_scopes_by_shop_id` — shop_id mismatch on audit_log row returns "not found".

### `revertConcernCategoryGuideline` (single-row composite PK, hard-delete on original-insert)

- `revert_restores_modified_prose` — UPSERT back when `original_was_insert=false`.
- `revert_deletes_inserted_row` — HARD DELETE when `original_was_insert=true`.
- `revert_idempotent_if_already_reverted` — second call rejected by `successor_revert_id` guard.

### `revertAppointmentDefaultLimits` (7-row complete-replace)

- `revert_restores_all_seven_day_of_week_rows` — full round-trip.
- `revert_handles_is_closed_toggle` — `is_closed: true → false` restored.
- `revert_handles_capacity_change` — `waiter_8am_slots: 4 → 6` restored.

### `revertClosedDates` (future-only append/delete)

- `revert_restores_deleted_future_date` — date removed by upload comes back with original reason.
- `revert_deletes_added_future_date` — date added by upload is hard-deleted.
- `revert_refuses_to_touch_past_dates` — if `closed_date < today` at revert time, that entry is skipped (no resurrection of frozen-history dates) and noted in `revert_plan.skipped_past_dates[]`.
- `revert_handles_reason_change` — reason text edit reverts cleanly.

### Shared invariants (one per handler, parameterized)

- `revert_rejects_when_snapshot_pruned` — `snapshot_pruned_at` set → error.
- `revert_rejects_revert_of_revert` — `operation='revert_upload'` parent → error.
- `revert_rejects_when_already_reverted` — `successor_revert_id IS NOT NULL` → error.
- `revert_rejects_when_head_drifted` — confirm_token mismatch when head changed between dry-run and apply.
- `revert_rejects_when_30_day_window_passed` — `occurred_at < now - 30d` → error (separate from `snapshot_pruned_at` since cron runs daily, not real-time).
- `revert_writes_audit_row_with_operation_revert_upload` — verifies the CHECK-loosen migration actually landed and audit row exists in DB.
- `revert_sets_parent_successor_revert_id` — second `revertMdUpload(same_id)` after first succeeds returns "already reverted".

End-to-end smoke (out of scope for unit tests; ship in the deploy verification doc):

- Run dry_run → wait 5s → run another dry_run with a deliberate parallel mutation → assert token mismatch on apply.
- Manually update `scheduler_admin_audit_log.occurred_at = now() - interval '31 days'` → assert 30-day rejection.

---

## Open questions

1. **`successor_revert_id` vs. `reverts_upload_id`**: I propose adding BOTH columns (one on parent, one on child), enabling both "is this upload already reverted?" (look at parent) and "what did this revert undo?" (look at child) without a self-join. Alternative: one column only + always self-join. Decision is a readability/storage tradeoff; recommend both for clarity.

2. **Per-shop snapshot pruning**: today's cron (migration 20260519140000) prunes by `occurred_at < now() - 30 days` globally. With `shop_id` added (per §7), should the 30-day TTL be per-shop-configurable? Out of scope for this research — single-shop today, flag for future.

3. **`concern_subcategories` snapshot disambiguation timing**: do we add `snapshot_kind` to existing V2 snapshots before backfilling the 5 legacy tables, or do we add it as a required field only on new captures (and treat snapshots without it as `kind=infer-by-shape`)? Recommend: add field unconditionally in the next deploy; for existing legacy V2 snapshots already in the DB, run a one-shot backfill that derives `snapshot_kind` from `(table_name, top-level keys of pre_state_snapshot.before)`.

4. **Hash-stability for `confirm_token`**: `JSON.stringify` is non-deterministic for object key ordering across Node/Deno versions. The current V2 uploaders have this same latent bug. Recommend a canonical-JSON helper (sorted keys) for token computation. Open thread separate from this feature.

5. **Reverting a per-category upload that referenced subcategory IDs since deleted by a 3rd party**: if Alice's upload added sub_id=99, then Bob deleted sub_id=99 entirely (via a different tool), then Alice tries to revert — restoring `concern_questions` rows that FK-reference sub_id=99 will fail. Need to either (a) restore-with-cascade-of-deps, (b) refuse with clear error, or (c) `ON CONFLICT DO NOTHING` and report skipped rows. Recommend (b) with an explicit list; the staleness token from §4 will catch most cases, but not all (sub_id deletion via direct SQL bypasses the catalog head hash).

---

## File references

- Canonical revert: `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:826-961`
- `_logAudit` (warn-and-swallow on insert failure): `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:641-684`
- Tool registry entry: `supabase/functions/_shared/scheduler-tools.ts:1161-1192`
- Audit-log table + CHECK constraint: `supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql:134-160`
- Snapshot columns + 30-day cron: `supabase/migrations/20260519140000_scheduler_md_edit_v2_schema.sql:30-80`
- `subcategory_service_map` uploader (writes `concern_subcategories`): `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:1046-1396`
- `subcategory_descriptions` uploader (also writes `concern_subcategories`): `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:1726-2032`
- `concern_questions` required_facts uploader: `supabase/functions/_shared/tools/scheduler-admin-catalog.ts:2234-2519`
- Legacy per-category uploader (two-table): `supabase/functions/_shared/tools/scheduler-admin.ts:1792-`
- Legacy `appointment_default_limits` uploader: `supabase/functions/_shared/tools/scheduler-admin.ts:1121-1387`
- Legacy `closed_dates` uploader: `supabase/functions/_shared/tools/scheduler-admin.ts:1389-1605`
- Legacy `concern_category_guidelines` uploader: `supabase/functions/_shared/tools/scheduler-admin.ts:2210-`
- Existing test file pattern: `supabase/functions/_shared/tools/scheduler-admin-catalog.test.ts:1-162`
- Schema for 5 legacy tables:
  - `concern_questions`: `supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql:64-101`
  - `appointment_default_limits`: `supabase/migrations/20260513000100_scheduler_phase1_new_tables.sql:108-126`
  - `concern_subcategories`: `supabase/migrations/20260514100000_scheduler_concern_subcategories_and_keywords.sql:43-75`
  - `concern_category_guidelines`: `supabase/migrations/20260514000000_scheduler_concern_category_guidelines.sql:25-60`
  - `closed_dates`: `supabase/migrations/20260510131752_scheduler_phase1_schema.sql:191-203`
