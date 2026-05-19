# Revert a bulk MD upload — Claude Desktop guide

> **What this controls:** undoing a recent successful bulk upload of
> `testing_services` or `routine_services` (more tables coming as snapshot
> support extends). Reads the `pre_state_snapshot` JSONB captured at upload
> time and restores every affected row to its prior state.
>
> **Tool:** `revert_md_upload(upload_id, dry_run)`
>
> **When to use:** the bulk upload made it through validation + parser + apply,
> but the result is wrong on the live scheduler. (If validation/parser blocks
> the upload, nothing's applied — no revert needed.)

## Quick mechanic

Every successful bulk upload via `upload_testing_services_md` or `upload_routine_services_md` (since 2026-05-19) captures the prior state of every affected row in `scheduler_admin_audit_log.pre_state_snapshot`. The audit row's `id` is the **upload_id**.

`revert_md_upload(upload_id)` reads that snapshot and:

- **Restores** every row that was modified → back to its pre-upload state
- **Deactivates** (`active=false`) every row that the upload added → since they didn't exist before
- **Re-activates** every row that the upload soft-deleted → since they were active before

A new audit row is written for the revert itself (`operation='revert_upload'`, references the original `upload_id`).

## Two-step flow

`revert_md_upload` defaults `dry_run: true`. Standard pattern:

1. **Dry-run** — tool returns `revert_plan` describing what would change:
   ```
   {
     restore: [
       { service_key: 'brake_inspection', via: 'upsert' },
       { service_key: 'check_ac', via: 'upsert' }
     ],
     deactivate: [
       { service_key: 'new_service_x', reason: 'was_added_by_original_upload' }
     ],
     no_op_count: 0
   }
   ```
2. **Show advisor the plan**:
   > "Reverting upload `audit_log_id=42` (testing_services, applied 2 hours ago by mike@):
   > - **Restore** 2 services to their prior state: `brake_inspection`, `check_ac`
   > - **Deactivate** 1 service that was added: `new_service_x`
   > Apply revert?"
3. **On approval** → re-call with `dry_run: false`. Returns `revert_audit_log_id` (the audit row id for the revert itself; for the record).

## Restrictions

The tool rejects with a clear error when:

- **Audit row not found** — `upload_id` invalid
- **Not an upload_md row** — can't revert a `revert_upload` or `manual_change` row (no revert-of-revert chains). If the advisor wants to undo a revert, the only path is a fresh bulk upload restoring the desired state.
- **Snapshot pruned** — 30-day retention has elapsed and `snapshot_pruned_at` is set. Earlier-than-30d uploads can't be reverted via this tool; the audit row stays but the JSON snapshot is gone.
- **No snapshot captured** — legacy upload from before the snapshot column was added (pre-2026-05-19), or original upload failed BEFORE apply (no snapshot needed).
- **Unsupported table** — currently only `testing_services` + `routine_services`. (Concerns, closed-dates, appointment-default-limits revert support is in the roadmap but not shipped.)

## Finding the upload_id

Three ways:

1. **From the apply response** — when an upload succeeds, the return value includes `audit_log_id`. Save it.
2. **From the audit log directly** — query `scheduler_admin_audit_log` for recent `operation='upload_md'` rows by `table_name` + `user_label`:
   ```sql
   SELECT id, table_name, user_label, occurred_at, diff_summary
   FROM scheduler_admin_audit_log
   WHERE operation = 'upload_md' AND table_name = 'testing_services'
   ORDER BY occurred_at DESC
   LIMIT 5;
   ```
3. **Ask advisor** — "Which upload do you want to revert? I can list the last 5 testing-service uploads if you want."

## Workflow examples

### Example 1 — straightforward revert

> Advisor: "Revert the last testing-services upload — I made a typo on three prices."

→ Find `upload_id` (last `upload_md` row on `testing_services` in audit log)
→ Dry-run: `revert_md_upload(upload_id=42, dry_run=true)`
→ Show plan:
   > "Reverting upload `42` (testing_services, applied 2026-05-19T14:23 by mike@):
   > - Restore **3 services** to their prior state: `brake_inspection`, `check_battery`, `tpms_testing`
   > - Deactivate **0** added services
   > Apply revert?"
→ On yes: `revert_md_upload(upload_id=42, dry_run=false)`
→ "Reverted. New audit row `revert_audit_log_id=44`."

### Example 2 — revert that added a service

> Advisor: "Undo the upload that added `wheel_alignment_diag` — we don't actually want that service."

→ Find upload_id
→ Dry-run shows: "Restore 0, Deactivate 1 (`wheel_alignment_diag`)"
→ Apply on yes

### Example 3 — revert too old

> Advisor: "Undo the upload from 3 months ago."

→ Tool returns: `error_message: "cannot revert: pre_state_snapshot was pruned on 2026-04-20 (30-day retention)"`
→ "That upload is too old — the snapshot was pruned 30 days after the upload (retention policy). I can't auto-revert it. You'll need to bulk-upload a corrected MD manually. Want me to fetch the current state as a starting point?"

### Example 4 — revert-of-revert

> Advisor: "Undo the revert I just did."

→ Find audit_log_id of the revert itself
→ Tool rejects: `error_message: "cannot revert: audit row N is operation=revert_upload, not upload_md (no revert-of-revert chains)"`
→ "Can't revert a revert. To restore the state that was just reverted, do a fresh bulk upload with that content. Want me to fetch the state from the original upload's diff_summary?"

## Why no revert-of-revert?

Snapshots are captured at the moment of the original upload. The snapshot from a revert would be the post-revert state — which is the same as the pre-revert state, which is what the revert just put back. Chaining reverts would create either no-ops or restore-bugs depending on what changed in between. Bulk uploads are the canonical path for any state-restoration that isn't a simple "undo my last apply."

## Don't

- ❌ Don't run `dry_run: false` without first showing the plan to the advisor.
- ❌ Don't revert without naming which upload — multiple uploads in a day are common; "the last one" is ambiguous.
- ❌ Don't try to revert beyond the 30-day snapshot retention.
- ❌ Don't promise concerns / closed-dates / appointment-default-limits revert until those tables get snapshot support.
