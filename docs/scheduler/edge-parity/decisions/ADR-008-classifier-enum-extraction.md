# ADR-008: Classifier extracts reason_code via regex + allow-list

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 classifier rule `reason_code := trim(both ' ' from substring(v_sqlerrm from 17))` which captured the full RAISE-message body (including row IDs, table names, customer-facing scheduler MD). Distilled from X-FIX-#11 + X-FIX-#24 + cross-verify rounds 2-3 BLOCKER findings.
**Superseded by:** (none)

## Context

The outer RPC `revert_md_upload_attempt` wraps the inner RPC in a `BEGIN…EXCEPTION WHEN OTHERS THEN` block. When the inner RAISEs, the outer captures `v_sqlerrm` via `GET STACKED DIAGNOSTICS MESSAGE_TEXT`. That message body is unbounded text: handlers RAISE messages like `revert_blocked: <enum>: cannot restore concern_questions.id=42 because subcategory_id=17 was deleted` or `staleness_check_failed: <inline unified diff of customer-facing scheduler MD>`. A naive extractor (the deprecated `substring(... from 17)`) captured the entire body into `reason_code`, defeating the §3b CV2-B6 promise that `reason_code` is short, machine-readable, and Sentry-safe (no PII, no row IDs, no customer-data-derived strings).

The classifier MUST distill `v_sqlerrm` into one of the canonical enum values from ADR-007 (and reclassify outcome for ADR-011's system-bug case) while preserving the verbose body in `error_detail` for DB-only operator triage. Unknown enums must fall back to a safe sentinel so Sentry alerts still fire on unrecognized rejection paths without leaking the unrecognized body to `reason_code`.

## Decision

The outer RPC's `EXCEPTION WHEN OTHERS THEN` block runs a priority-ordered classifier that extracts `reason_code` via PostgreSQL `substring(v_sqlerrm from <regex>)` followed by an allow-list `IN(...)` check.

```sql
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS
    v_sqlstate = RETURNED_SQLSTATE,
    v_sqlerrm = MESSAGE_TEXT,
    v_constraint_name = CONSTRAINT_NAME;

  IF v_sqlstate = '55P03' THEN
    v_outcome := 'rejected'; v_reason := 'another_revert_in_progress';
  ELSIF v_sqlstate = '23505' AND v_constraint_name = 'scheduler_admin_audit_log_one_successful_revert_idx' THEN
    v_outcome := 'rejected'; v_reason := 'successor_revert_exists';
  ELSIF v_sqlstate = '23505' THEN
    v_outcome := 'crashed';  v_reason := 'unique_violation';
  ELSIF v_sqlerrm LIKE 'revert_blocked:%' THEN
    v_outcome := 'rejected';
    v_reason := substring(v_sqlerrm from 'revert_blocked:\s+([a-z0-9_]+)');
    IF v_reason IS NULL OR v_reason NOT IN (
      'not_found','not_upload_md','successor_revert_exists','snapshot_pruned',
      'no_snapshot','over_30_day_cutoff','table_not_supported','snapshot_kind_unknown',
      'dry_run_token_present','cannot_safely_verify',
      'cross_shop_hijack_attempt','fk_target_tenant_mismatch','fk_broken',
      'snapshot_invalid'
    ) THEN
      v_reason := 'unclassified_revert_blocked';
    END IF;
    IF v_reason = 'snapshot_kind_unknown' THEN
      v_outcome := 'crashed';
    END IF;
    IF v_reason = 'fk_target_tenant_mismatch' THEN
      v_reason := 'fk_broken';
    END IF;
  ELSIF v_sqlerrm LIKE 'confirm_token_mismatch:%' THEN
    v_outcome := 'rejected'; v_reason := 'confirm_token_mismatch';
  ELSIF v_sqlerrm LIKE 'staleness_check_failed:%' THEN
    v_outcome := 'rejected'; v_reason := 'current_state_drift';
  ELSE
    v_outcome := 'crashed'; v_reason := NULL;
  END IF;
```

Key invariants:

1. The regex `'revert_blocked:\s+([a-z0-9_]+)'` extracts ONLY the first lowercase-identifier token after `revert_blocked: `. Per ADR-007 enum naming rules, enums use `[a-z0-9_]` and never lead with a digit (e.g., `over_30_day_cutoff`, not `30_day_cutoff`). The trailing verbose text (everything after the second colon) is dropped from `reason_code` and lives in `v_sqlerrm` → `error_detail`.
2. The `IN(...)` allow-list MUST stay in lock-step with the ADR-007 canonical enum table. Adding a new enum requires updating BOTH together.
3. `fk_target_tenant_mismatch` (raised by handler Invariant 6) is mapped at the classifier to canonical `fk_broken` so ALL FK-related rejections share a single Sentry-grouping enum. Handlers MAY use either RAISE prefix for clarity in `error_detail`; the classifier normalizes.
4. `snapshot_kind_unknown` (raised by inner dispatch ELSE branch) is reclassified from `rejected` to `crashed` per ADR-011 because it represents a missing handler — a system bug requiring deploy, not a user-remediable rejection.
5. The catch-all ELSE → `crashed, reason_code=NULL` ensures any unexpected exception (FK violation surfaced via handler, NPE-equivalent) produces a structured `crashed` outcome with full diagnostic in `error_detail`. No raw exception escapes to the caller.

## Consequences

`reason_code` is now provably Sentry-safe: it can only ever take a value from the allow-list (or `unclassified_revert_blocked` as the safe fallback), with no row-derived data or customer-facing MD content possible. Verbose detail is preserved in `error_detail` for operator triage via the `attempt_id` pivot (ADR-010). Unknown rejection paths still surface to Sentry (via `unclassified_revert_blocked`) so undocumented enums get noticed without leaking the body. The cost is a regex match + allow-list lookup per failure — negligible relative to the staleness diff that precedes it on the slow path. The constraint that bites: every new enum requires coordinated updates to the ADR-007 table AND this classifier's allow-list AND the handler RAISE callsite AND optionally the `revert_eligibility.reasons` union (ADR-021), so the enum surface is deliberately small and additions are gated.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.4 outer RPC EXCEPTION block
- Related ADRs: ADR-007 (canonical enum), ADR-009 (sanitized error_message), ADR-010 (3-tier redaction), ADR-011 (snapshot_kind_unknown → crashed)
