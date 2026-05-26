# Revert a bulk MD upload — Claude Desktop guide

> **What this controls:** undoing a recent successful bulk upload of ANY of
> the 10 admin-MD surfaces. Reads the `pre_state_snapshot` JSONB captured at
> upload time and restores every affected row to its prior state.
>
> **Tool:** `revert_md_upload(upload_id, dry_run, expected_confirm_token, force_no_after_hash)`
>
> **When to use:** the bulk upload made it through validation + parser + apply,
> but the result is wrong on the live scheduler. (If validation/parser blocks
> the upload, nothing's applied — no revert needed.)
>
> **Updated 2026-05-26 (edge-parity E8):** the tool now supports ALL 10
> surfaces (was testing_services + routine_services only). Two new args
> (`expected_confirm_token` + `force_no_after_hash`) gate apply mode for
> safety. New structured outcome shape (`outcome` + `reason_code` + sanitized
> `error_message` + `attempt_id` for debug pivot).

## Tools you have for this task — they WORK, use them

You DO have orchestrator MCP access. If you find yourself thinking "I can't
do this" or "I don't have that tool" — STOP. You DO. Use it. Relay any
error verbatim. Never refuse a task because you "don't have access".

- **Orchestrator MCP** — exposes ~50 specific typed tools. For THIS
  task, the relevant tools are:
  - `revert_md_upload` — undo a previous bulk MD upload by `upload_id`
    (the `audit_log_id` returned at upload time). TWO-STEP Pattern S
    flow: dry_run + expected_confirm_token, same shape as the upload
    tools.
  - `list_scheduler_admin_audit_log` — find recent uploads + their
    revert-eligibility hints (per-row reasons union). Filter by
    `surface_filter`, `limit`, `only_successful`, `only_revertable`.
    Use this when the advisor doesn't have the upload_id handy.

(You do NOT need to read any file from disk for a revert — the snapshot is
stored in the database alongside the original upload's audit row.)

Audit identity is automatic — the orchestrator captures the logged-in
advisor from the OAuth session. Don't ask "who are you?".

## Quick mechanic

Every successful bulk upload via ANY of the 10 admin uploaders (testing_services,
routine_services, the 3 subcategory-column uploaders, concern_questions_flat,
concern_category, concern_category_guideline, appointment_default_limits,
closed_dates) captures the prior state of every affected row in
`scheduler_admin_audit_log.pre_state_snapshot` + sets `diff_summary.kind`
to one of 10 canonical snapshot_kinds. The audit row's `id` is the **upload_id**.

`revert_md_upload(upload_id)` dispatches to the matching per-kind handler
inside the plpgsql `revert_md_upload_attempt` outer RPC. The handler:

- **Restores** every row that was modified → back to its pre-upload state
  (via UPSERT with shop-scoped WHERE — cross-shop hijack-safe)
- **Deactivates / hard-deletes** every row that the upload added → since
  they didn't exist before. (Soft-delete via `active=false` for the catalog
  surfaces; hard DELETE for the 2 tables that lack an `active` column —
  `concern_category_guidelines`, `appointment_default_limits` — and
  CONDITIONAL hard DELETE for `closed_dates_future` past-date immutability.)
- **Re-activates** every row that the upload soft-deleted → since they
  were active before
- **Atomically writes** a revert audit row (`operation='revert_upload'`,
  `reverts_upload_id` = the original upload's id) inside the same transaction

If anything fails mid-revert, the entire transaction rolls back — but the
failure-trail row in `scheduler_admin_revert_attempts` is preserved with
the `reason_code` for operator triage. Pivot from the returned `attempt_id`
to that row for full debug detail (verbose `error_detail` lives there, NOT
in the tool's return).

## Two-step Pattern S flow

`revert_md_upload` defaults `dry_run: true`. Standard pattern:

1. **Dry-run** — tool returns structured outcome:
   ```
   {
     ok: true,
     upload_id: 42,
     outcome: 'dry_run_success',
     reason_code: null,
     error_message: null,
     attempt_id: 17,
     dry_run: true,
     audit_log_id: null,
     confirm_token: '<hex sha256>',     ← pass back as expected_confirm_token in step 3
     restored: 3,
     deactivated: 1,
     deleted: 0
   }
   ```
2. **Show advisor the plan**:
   > "Reverting upload `audit_log_id=42` (testing_services, applied 2 hours ago by mike@):
   > - **Restore** 3 services to their prior state
   > - **Deactivate** 1 service that was added
   > Apply revert?"
3. **On approval** → re-call with `dry_run: false` AND `expected_confirm_token: <token from step 1>`. Returns:
   ```
   {
     ok: true,
     upload_id: 42,
     outcome: 'success',
     reason_code: null,
     error_message: null,
     attempt_id: 17,
     dry_run: false,
     audit_log_id: 78,                  ← the revert's own audit row id (for the record)
     confirm_token: null,
     restored: 3,
     deactivated: 1,
     deleted: 0
   }
   ```

**Strict ordering rule:** advisor MUST see the dry-run plan + give explicit
"yes" in a NEW conversation turn before you call apply. NEVER same-run-confirm.
Same Pattern A confirmation discipline as keytag voids/deletes/AR mutations.

## Restrictions (the outer RPC rejects with these reason_codes)

When `outcome IN ('rejected', 'crashed')` the `reason_code` tells you what's wrong:

| reason_code | What it means | Advisor-facing recovery |
|---|---|---|
| `not_found` | `upload_id` doesn't exist or belongs to a different shop | Confirm the upload_id is correct (advisor may have typed it wrong) |
| `not_upload_md` | Audit row is `operation='revert_upload'` or `'manual_change'` — can't revert-of-revert | "I can't revert a revert. If you want to undo the revert, you'll need to bulk-upload a corrected MD manually." |
| `snapshot_pruned` | 30-day retention has elapsed; snapshot_pruned_at is set | "That upload is too old — snapshot pruned. I can't auto-revert. Want me to fetch the current state as a starting point?" |
| `no_snapshot` | Legacy upload before snapshot capture shipped, OR upload failed BEFORE apply | "No snapshot was captured for that upload. Auto-revert isn't possible." |
| `over_30_day_cutoff` | `occurred_at < now() - 30 days` | Same as snapshot_pruned: too old. |
| `successor_revert_exists` | A prior successful revert already landed for this upload | "That upload was already reverted. Check audit_log row {revert's id} for what happened." |
| `table_not_supported` | `snapshot_kind` couldn't be resolved (legacy row pre-backfill, or unknown kind) | "I can't dispatch a revert for this row. Operator review needed." |
| `current_state_drift` | Live table state has changed since the upload — reverting would clobber legitimate edits | "Reverting would overwrite changes that happened after the upload. Want me to fetch the current state for review first?" |
| `cannot_safely_verify` | Snapshot has neither `after_hash` nor `expected_after_state_canonical` (very old rows) | Use `force_no_after_hash: true` ONLY if the advisor accepts the "we can't verify the state we're reverting OVER" risk. |
| `confirm_token_mismatch` | The `expected_confirm_token` you passed doesn't match the recomputed token (state changed between dry-run and apply, OR token was wrong) | Re-do the dry-run to get a fresh token, then re-confirm + apply. |
| `another_revert_in_progress` | Another revert is mid-flight on the same upload (NOWAIT lock contention) | Wait a few seconds and retry. |
| `cross_shop_hijack_attempt` | The snapshot references rows in a different shop (tampered or stale) | Operator review — likely a bug. |
| `fk_broken` | The snapshot references a FK target row that has been deleted or moved to another shop | Operator review — can't safely restore. |
| `snapshot_invalid` | The snapshot is malformed (missing required fields for the snapshot_kind) | Operator review. |
| `unique_violation` / `unclassified_revert_blocked` | Unexpected — pivot to `attempt_id` row in `scheduler_admin_revert_attempts` for debug | Surface the `attempt_id` to operator. |

## Finding the upload_id

Three ways:

1. **From the apply response** — when an upload succeeds, the return value includes `audit_log_id`. Save it.
2. **`list_scheduler_admin_audit_log`** — call this tool with `surface_filter` (e.g. `'testing_services'`) + `limit: 10` + optionally `only_revertable: true` to filter to actionable rows. Returns per-row `revert_eligibility.is_revertable` + `reasons[]` — tell the advisor which rows are eligible before they pick.
3. **Ask advisor** — "Which upload do you want to revert? I can list the last 5 testing-service uploads if you want."

## Workflow examples

### Example 1 — straightforward revert

> Advisor: "Revert the last testing-services upload — I made a typo on three prices."

→ Find `upload_id` via `list_scheduler_admin_audit_log({ surface_filter: 'testing_services', limit: 5, only_revertable: true })`
→ Dry-run: `revert_md_upload({ upload_id: 42, dry_run: true })`
→ Show plan:
   > "Reverting upload `42` (testing_services, applied 2026-05-19T14:23 by mike@):
   > - Restore **3 services** to their prior state
   > - Deactivate **0** added services
   > Apply revert?"
→ On yes: `revert_md_upload({ upload_id: 42, dry_run: false, expected_confirm_token: '<token from step 1>' })`
→ "Reverted. New audit row `audit_log_id=78`. Pivot to `attempt_id=17` in `scheduler_admin_revert_attempts` if you need debug detail."

### Example 2 — revert that added a service

> Advisor: "Undo the upload that added `wheel_alignment_diag` — we don't actually want that service."

→ Find upload_id via `list_scheduler_admin_audit_log`
→ Dry-run shows: `{outcome: 'dry_run_success', restored: 0, deactivated: 1, ...}`
→ Apply on yes with the `expected_confirm_token` from the dry-run

### Example 3 — current_state_drift

> Advisor: "Revert that upload from earlier today."

→ Dry-run returns: `{outcome: 'rejected', reason_code: 'current_state_drift', attempt_id: 23, ...}`
→ Tell advisor: "Reverting that upload would overwrite changes that happened after it. Someone else (or you) made manual edits since. Want me to fetch the current state for review first, then we can decide together whether to revert anyway?"

### Example 4 — revert too old

> Advisor: "Undo the upload from 3 months ago."

→ Dry-run returns: `{outcome: 'rejected', reason_code: 'snapshot_pruned', ...}`
→ "That upload is too old — the snapshot was pruned 30 days after the upload (retention policy). I can't auto-revert it. You'll need to bulk-upload a corrected MD manually. Want me to fetch the current state as a starting point?"

### Example 5 — revert-of-revert

> Advisor: "I just reverted upload 42 but now I want to UN-revert it."

→ Tool would return: `{outcome: 'rejected', reason_code: 'not_upload_md', ...}` if advisor tries to revert the revert audit row (id=78).
→ "I can't revert a revert. To get back to the state from upload 42, you'd need to bulk-upload that MD again. Want me to fetch the diff between current state and what upload 42 changed, then re-upload?"

### Example 6 — cannot_safely_verify (force override)

> Advisor: "Revert this very old upload — yes I know the format was different back then."

→ Dry-run returns: `{outcome: 'rejected', reason_code: 'cannot_safely_verify', ...}`
→ Tell advisor: "That upload's snapshot doesn't include the state-verification hash that newer uploads have. If I revert without that check, I can't guarantee I'm not overwriting changes that happened in between. Are you sure you want me to proceed without the safety check?"
→ On explicit "yes": `revert_md_upload({ upload_id, dry_run: true, force_no_after_hash: true })` → if dry_run_success, re-call apply with the token

## What changed 2026-05-26 (edge-parity feature)

- **Supports all 10 surfaces** (was 2). The new dispatch in `revert_md_upload_attempt` covers every kind the V2 + legacy uploaders write.
- **New args:** `expected_confirm_token` (REQUIRED for apply) + `force_no_after_hash` (operator override, default false).
- **New return shape:** `{outcome, reason_code, error_message, attempt_id, restored, deactivated, deleted, audit_log_id, confirm_token}`. The old `revert_plan` shape is gone — show the counts (restored / deactivated / deleted) directly.
- **Sanitized error messages:** the returned `error_message` is safe to display verbatim to the advisor — no row IDs, no schema details, no diff text. Verbose debug detail lives in `scheduler_admin_revert_attempts.error_detail` (DB-only, accessible via `attempt_id` pivot).
- **Failure-trail observability:** even rejected/crashed reverts produce an audit row in `scheduler_admin_revert_attempts` with the canonical `reason_code`. Operators can audit all revert attempts (not just the successful ones).
