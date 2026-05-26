# ADR-020: scheduler_admin_revert_attempts table schema

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.4 6-outcome enum (had `failed` dead state). Distilled from prior schema redesign + CHECK-gap closures + shop_id positivity hardening + cross-verify rounds 2-3.
**Superseded by:** (none)

## Context

`scheduler_admin_audit_log` only carries SUCCESSFUL revert rows: when the inner RPC RAISEs, its transaction rolls back, and the would-be audit row is never persisted. Operators need a failure trail — every attempt that REACHES the inner RPC, regardless of outcome — to triage 55P03 contention, staleness drift, and crash classification. The new `scheduler_admin_revert_attempts` table is the canonical home for that trail; the outer RPC writes its row AFTER STEP 0d (after parameters validate AND the upload is confirmed to exist in the caller's tenant) and updates it to terminal outcome from the EXCEPTION block.

**Honest scope of the "every attempt" guarantee** (per ADR-002 three-branch contract): the attempts table records every Branch-1 attempt that progressed past STEP 0d. Branch-2 rejections (`not_found` — upload_id missing in caller's tenant) return a structured `{outcome: 'rejected', reason_code: 'not_found', attempt_id: NULL}` WITHOUT writing an attempt row — because the FK on `upload_id` makes recording a nonexistent upload schema-impossible, and the rejection itself is logged at the RPC-call layer. Branch-3 STEP 0a/0b/0c RAISEs (malformed parameters) never reach the attempt-row INSERT either. Operators querying for a complete trail of failed reverts must consult BOTH the attempts table AND the RPC-call log; the attempts table alone is the trail for failures that reached the inner-RPC dispatch, NOT for pre-dispatch rejections.

The column set must capture (a) WHO acted (actor_email, oauth_client_id, shop_id), (b) WHAT was attempted (upload_id, dry_run, dry_run_confirm_token_hash), (c) WHEN (attempted_at, completed_at), (d) HOW it ended (outcome, reason_code, error_detail, revert_audit_log_id back-pointer on success), and (e) FUTURE extension headroom (metadata JSONB). 6 CHECK constraints total — 5 NAMED pairwise-scope table constraints (token_hash_scope, completed_at_invariant, audit_log_scope, dry_run_outcome_scope, success_field_scope) PLUS 1 inline column CHECK (`shop_id > 0` on the shop_id column) — close pairwise nonsense-state combinations that nothing else in the system would catch if a future writer (operator backfill script, admin-app UPDATE surface) bypassed the outer RPC. Retention is deferred to OBS-9 until operators see real volume after Phase 1 ships.

## Decision

```sql
CREATE TABLE IF NOT EXISTS public.scheduler_admin_revert_attempts (
  id                              BIGSERIAL PRIMARY KEY,
  attempted_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at                    TIMESTAMPTZ NULL,
  upload_id                       BIGINT NOT NULL
                                    REFERENCES public.scheduler_admin_audit_log(id) ON DELETE RESTRICT,
  shop_id                         INTEGER NOT NULL CHECK (shop_id > 0),
  actor_email                     TEXT,
  oauth_client_id                 TEXT,
  dry_run                         BOOLEAN NOT NULL,
  outcome                         TEXT NOT NULL
                                    CHECK (outcome IN ('pending','dry_run_success','success','rejected','crashed')),
  reason_code                     TEXT NULL,
  error_detail                    TEXT NULL,
  metadata                        JSONB NULL,
  dry_run_confirm_token_hash      TEXT NULL,
  revert_audit_log_id             BIGINT NULL
                                    REFERENCES public.scheduler_admin_audit_log(id),

  CONSTRAINT scheduler_admin_revert_attempts_token_hash_scope_check
    CHECK (
      (outcome = 'dry_run_success' AND dry_run_confirm_token_hash IS NOT NULL)
      OR (outcome <> 'dry_run_success' AND dry_run_confirm_token_hash IS NULL)
    ),

  CONSTRAINT scheduler_admin_revert_attempts_completed_at_invariant_check
    CHECK (
      (outcome = 'pending' AND completed_at IS NULL)
      OR (outcome <> 'pending' AND completed_at IS NOT NULL)
    ),

  CONSTRAINT scheduler_admin_revert_attempts_audit_log_scope_check
    CHECK (
      (outcome = 'success' AND revert_audit_log_id IS NOT NULL)
      OR (outcome <> 'success' AND revert_audit_log_id IS NULL)
    ),

  CONSTRAINT scheduler_admin_revert_attempts_dry_run_outcome_scope_check
    CHECK (
      (outcome = 'success'         AND dry_run = FALSE) OR
      (outcome = 'dry_run_success' AND dry_run = TRUE)  OR
      outcome IN ('pending', 'rejected', 'crashed')
    ),

  CONSTRAINT scheduler_admin_revert_attempts_success_field_scope_check
    CHECK (
      (outcome IN ('success', 'dry_run_success')
         AND reason_code IS NULL AND error_detail IS NULL)
      OR (outcome = 'rejected' AND reason_code IS NOT NULL)
      OR outcome = 'crashed'
      OR (outcome = 'pending' AND reason_code IS NULL AND error_detail IS NULL)
    )
);
```

5 indexes total (NOT 4 — prior draft text said "Plus 4 indexes" then listed 5; fixed here):
1. `one_successful_revert_attempt_idx` — partial unique on `revert_audit_log_id WHERE revert_audit_log_id IS NOT NULL`. **Invariant scope:** at most one attempt row may reference any given revert audit-log row (i.e., a single audit-log success row cannot be referenced by two attempt rows). This does NOT enforce "at most one successful revert per upload" — that hard invariant lives on the audit_log itself via `scheduler_admin_audit_log_one_successful_revert_idx` (per ADR-022 Migration A: `UNIQUE (reverts_upload_id) WHERE reverts_upload_id IS NOT NULL AND error_message IS NULL`). The attempts table's index closes a different race (attempt-row write doubling), not the audit-log-row uniqueness.
2. `outcome` btree
3. `shop_id` btree
4. `upload_id` btree
5. `pending` partial index (`WHERE outcome = 'pending'`) for stuck-pending alerting

RLS RESTRICTIVE deny-all policy on the table plus `REVOKE ALL FROM PUBLIC/anon/authenticated` + `GRANT SELECT/INSERT/UPDATE TO service_role` on the table and `USAGE/SELECT` on the sequence, per ADR-018.

The 5-outcome enum (NOT 6): the v0.4 `failed` outcome was dropped because no code path emits it. The ADR-008 classifier maps inner success to `success` or `dry_run_success`; 55P03 to `rejected/another_revert_in_progress`; narrow 23505 to `rejected/successor_revert_exists`; generic 23505 to `crashed/unique_violation`; `revert_blocked:` prefixed RAISEs to `rejected` (with `crashed` reserved for `snapshot_kind_unknown` per ADR-011); `confirm_token_mismatch:` and `staleness_check_failed:` to `rejected` with their respective reason_codes; ELSE to `crashed` with NULL reason_code. `pending` is the in-flight pre-terminal state; the other four are terminal.

## Consequences

Operators get a complete failure trail visible to SQL queries even when the inner RPC's transaction rolls back. The 6 CHECK constraints encode invariants at the DB layer so future writers (backfill scripts, admin-app, manual fixes) cannot produce internally contradictory rows — e.g., `outcome='success' AND dry_run=TRUE` is rejected by the engine, not just by application convention. The `one_successful_revert` partial unique index makes "at most one successful revert per upload" a hard schema invariant. The `pending` partial index makes stuck-in-flight rows cheap to detect from a monitoring query.

What CHECK cannot enforce gets deferred to triggers: SEC-14 covers semantic validation of `revert_audit_log_id` (referenced audit row must be `operation='revert_upload'`, `reverts_upload_id=this.upload_id`, `shop_id=this.shop_id`, `error_message IS NULL`) and SEC-16 covers `attempts.shop_id = audit_log[upload_id].shop_id` consistency. Both require querying OTHER rows, which CHECK constraints cannot do. The outer RPC's STEP 0d pre-check enforces these at insert time today; the triggers are defense-in-depth against direct service_role writes bypassing the outer RPC. OBS-9 covers the retention cron (designed: 90-day online → archive at 91 → hard-delete at 365; pending rows never pruned because stuck-pending deserves human attention).

## Sources
- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.1 `CREATE TABLE public.scheduler_admin_revert_attempts` block + the 6 CHECK constraint definitions
- Deferred follow-ups: `docs/scheduler/DEFERRED-AUDIT-ITEMS.md` SEC-14 (revert_audit_log_id semantic trigger), SEC-16 (attempts.shop_id ↔ upload.shop_id trigger), OBS-9 (retention cron)
- Related ADRs: ADR-002 (attempt-row insertion contract), ADR-005 (outer-only entry point), ADR-018 (RLS RESTRICTIVE)
