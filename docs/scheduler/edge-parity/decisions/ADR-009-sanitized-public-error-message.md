# ADR-009: Sanitized public-facing error_message

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 outer RPC behavior `error_message := v_sqlerrm` which leaked the full inner-RAISE body (including unified-diff content from `compute_unified_diff` with customer-facing scheduler MD). Distilled from the v0.5 outer/inner two-RPC split + cross-verify round 1 chunk 1 BLOCKER on diff-leak via Sentry.
**Superseded by:** (none)

## Context

The outer RPC `revert_md_upload_attempt` catches every exception RAISEd by the inner RPC `revert_md_upload_apply` and returns a structured row to the TS caller (ADR-001). The RETURN row carries `outcome`, `reason_code`, `error_message`, `attempt_id`, plus the zeroed counts. Three of those fields are observability surfaces with different audiences:

- `reason_code` — machine-readable enum (ADR-007), safe everywhere
- `error_detail` — verbose `SQLSTATE:CONSTRAINT_NAME:SQLERRM` body, DB-only
- `error_message` — human-readable short summary, returned to TS caller

The problem with v0.5's draft behavior: `v_sqlerrm` for the `staleness_check_failed` rejection path includes the inline unified diff produced by `compute_unified_diff(expected_md, current_md)`. That diff text can contain customer-facing scheduler MD (questions, options, instructions, concern descriptions, category guidelines). The original outer RPC RETURN passed `v_sqlerrm` raw into the `error_message` column. Sentry capture per ADR-010 explicitly omits `error_detail` to avoid this leak, but `error_message` was a third leakage surface flowing through TS → log lines → potentially Sentry breadcrumbs / toast UI.

## Decision

The outer RPC declares a local `v_sanitized_error_message TEXT;` and populates it via CASE on the classified `(v_outcome, v_reason_code)` tuple — a templated short summary that embeds only `v_attempt_id` (an opaque BIGINT) as the operator-pivot key. No diff body, no row IDs from the staleness comparison, no MD content. Full `v_sqlerrm` flows ONLY to `error_detail` (DB-only). The RETURN row sets `error_message := v_sanitized_error_message`.

```sql
v_sanitized_error_message := CASE v_outcome
  WHEN 'rejected' THEN
    CASE v_reason
      WHEN 'current_state_drift'        THEN 'current state drifted since dry-run; re-run dry_run to view the diff (attempt_id ' || v_attempt_id::TEXT || ')'
      WHEN 'confirm_token_mismatch'     THEN 'confirm_token did not match the latest dry-run for this upload; re-run dry_run for a fresh token (attempt_id ' || v_attempt_id::TEXT || ')'
      WHEN 'successor_revert_exists'    THEN 'upload has already been successfully reverted (attempt_id ' || v_attempt_id::TEXT || ')'
      WHEN 'another_revert_in_progress' THEN 'another revert is in progress for this upload; retry shortly (attempt_id ' || v_attempt_id::TEXT || ')'
      ELSE 'revert rejected: ' || COALESCE(v_reason, '<unknown>') || ' (attempt_id ' || v_attempt_id::TEXT || ')'
    END
  WHEN 'crashed' THEN
    'internal error occurred during revert; operators pivot to attempt_id ' || v_attempt_id::TEXT || ' for the verbose SQLSTATE:SQLERRM body in scheduler_admin_revert_attempts.error_detail'
  ELSE
    'revert failed with unclassified outcome: ' || COALESCE(v_outcome, '<null>') || ' (attempt_id ' || v_attempt_id::TEXT || ')'
END;

UPDATE public.scheduler_admin_revert_attempts
  SET outcome      = v_outcome,
      reason_code  = v_reason,
      error_detail = v_sqlstate || ':' || COALESCE(v_constraint_name, '<none>') || ':' || v_sqlerrm,
      completed_at = now()
  WHERE id = v_attempt_id;

RETURN QUERY SELECT
  NULL::BIGINT, NULL::TEXT, 0, 0, 0, p_dry_run,
  v_outcome,
  v_reason,                    -- canonical enum per ADR-007 (machine-readable)
  v_sanitized_error_message,   -- templated, no PII / no diff body (this ADR)
  v_attempt_id;
```

**Invariants:**

1. **No raw `v_sqlerrm` in `error_message`.** The CASE never references `v_sqlerrm`. The only dynamic value embedded in the sanitized message is `v_attempt_id`.
2. **`error_detail` captures everything.** The terminal UPDATE writes `v_sqlstate || ':' || COALESCE(v_constraint_name, '<none>') || ':' || v_sqlerrm` to `error_detail`. The constraint name aids unique-violation triage. DB-only; never sent to Sentry per ADR-010.
3. **CASE table stays in lock-step with ADR-007.** When a new enum is added to the canonical reason_code list, decide: custom templated arm or `ELSE` fallback. The `ELSE` already handles unknown rejection enums gracefully via `COALESCE(v_reason, '<unknown>')`.
4. **TS wrapper responsibility.** The TS `revertMdUpload` wrapper returns `{ ok: false, outcome, reason_code, error_message, attempt_id }` to its caller. Per ADR-010, the wrapper's Sentry emission sends `tags.reason_code` + `tags.attempt_id` but NOT `error_message` (Sentry already has the machine-readable enum; `error_message` is reserved for the immediate caller's user-facing surface — toast, log line).

## Consequences

TS callers can log or propagate `error_message` without coordinating a secondary scrubber — sanitization is enforced at the DB boundary, so every consumer is safe by construction. Operators query `attempt_id → error_detail` via a service-role-gated surface for verbose triage; the operator-pivot story remains intact because `attempt_id` is embedded in every message variant.

The cost is the CASE table itself: it must stay in lock-step with ADR-007 enum changes. The `ELSE` fallback degrades gracefully for unknown enums (no broken message), but a custom arm is preferred when the enum has a user-meaningful next-action (e.g., "re-run dry_run for a fresh token"). New enums without a custom arm will surface as `'revert rejected: <enum> (attempt_id N)'`, which is correct but generic.

The pattern also closes a subtle attack surface: a hostile or buggy handler that RAISEs with attacker-controlled text in the message body cannot leak that text through the `error_message` return field. Only enums in the ADR-007 allow-list reach the RETURN row's `reason_code`; only templated strings reach `error_message`. The defense-in-depth posture matches ADR-010's three-tier redaction policy.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.4 outer RPC EXCEPTION block (`v_sanitized_error_message` declaration + CASE table at L1535-L1548; terminal UPDATE at L1556-L1569; RETURN row at L1571-L1576) + §3b CV2-B6 redaction policy table (L450-L458)
- Related ADRs: ADR-007 (canonical reason_code enum), ADR-008 (classifier extracts enum from `v_sqlerrm`), ADR-010 (3-tier redaction policy across Sentry / RPC return / DB attempt row)
