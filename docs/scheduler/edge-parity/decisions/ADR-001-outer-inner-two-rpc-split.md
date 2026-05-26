# ADR-001: Outer/inner two-RPC split for revert dispatch

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.3 monolithic `revert_md_upload` RPC (CV2-B2). Distilled from prior plan X-FIX markers AGENT-A, AGENT-F, #12, #19 + cross-verify rounds 1-3.
**Superseded by:** (none)

## Context

Operators need an auditable trail for every revert attempt, including ones that fail eligibility, conflict on staleness, or crash mid-handler. A single-RPC design forces an unsolvable trade-off: either the whole transaction rolls back on failure (in which case any "we tried and failed" row also disappears), or the RPC returns a structured failure without atomicity (in which case partial mutations could land before the failure path runs). Both modes leak: the rollback variant hides rejected reverts entirely from operators, and the structured-failure variant breaks the "every mutation + audit row + parent-pointer update commit together or roll back together" guarantee that downstream tooling relies on.

The v0.3 monolithic `revert_md_upload` RPC tried to thread that needle and could not. Eligibility-failure responses went back to TypeScript, which threw; the audit log only saw successes. The Sentry alert rule keyed on `revert_upload` audit rows with a non-null `error_message` never fired for rejected reverts because no such row was ever written. There was no DB-resident record an operator could pivot to from a Sentry tag.

The classifier surface also mattered. With a mixed contract (inner sometimes RAISEing, sometimes returning structured failure), the outer's SQLSTATE-plus-RAISE-prefix classifier had to handle two shapes of signal, which led to GPT and Gemini round-3 review confusion about which failures mapped to which `reason_code`. A uniform RAISE-only inner contract was a prerequisite for a clean classifier.

## Decision

Split the dispatch into two RPCs: `revert_md_upload_attempt` (outer, public-facing, granted to `service_role`) wraps `revert_md_upload_apply` (inner, dispatch + handlers, NOT granted to `service_role` per ADR-005) inside a PL/pgSQL `BEGIN…EXCEPTION WHEN OTHERS THEN END` block (per ADR-003). For any inner-path outcome (success, eligibility rejection, token mismatch, staleness, handler error, or unclassified crash) the outer returns a structured `(audit_log_id, confirm_token, restored, deactivated, deleted, dry_run, outcome, reason_code, error_message, attempt_id)` row — the EXCEPTION block NEVER re-RAISEs. The inner RAISEs on any failure (eligibility, token mismatch, staleness, handler error) — its contract is RAISE-only.

**Out of scope for the "never re-RAISEs" claim — STEP 0 pre-inner guards.** Per ADR-002 Branch 3, STEP 0a (`p_shop_id` shape), 0b (`p_actor_email` present), and 0c (boolean params non-NULL) RAISE per Postgres convention BEFORE the BEGIN/EXCEPTION subtransaction is opened. These are upstream of the structured-outcome promise — they fire when the call is so malformed that even the attempt-row INSERT would be impossible (no shop_id to scope the row, no actor identity, etc.). Callers MUST handle Postgres exceptions from STEP 0 guards as call-level errors (visible as a Postgres SQLSTATE on the RPC client), not as structured outcomes. STEP 0d (upload-existence pre-check) returns Branch 2's structured `rejected/not_found` row without RAISE — it's the only STEP 0 guard that participates in the structured-outcome contract.

The outer's INSERT into `scheduler_admin_revert_attempts` runs in the outer transaction frame BEFORE the `BEGIN…EXCEPTION` subtransaction starts, so the attempt row survives the inner's rollback. On inner success, the outer UPDATEs the attempt row to `success` (or `dry_run_success`) with the inner's `revert_audit_log_id` (or `dry_run_confirm_token_hash`). On inner RAISE, the subtransaction auto-rolls back the inner's mutations and audit-row INSERT; the outer's `EXCEPTION` block catches, classifies the failure (via SQLSTATE + CONSTRAINT_NAME + the canonical enum prefix per ADR-008), UPDATEs the attempt row to `rejected` or `crashed` with `reason_code` + `error_detail`, and returns a structured outcome to TypeScript.

```sql
CREATE OR REPLACE FUNCTION public.revert_md_upload_attempt(...)
RETURNS TABLE(audit_log_id BIGINT, confirm_token TEXT, restored INT,
              deactivated INT, deleted INT, dry_run BOOLEAN,
              outcome TEXT, reason_code TEXT, error_message TEXT,
              attempt_id BIGINT)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, extensions, public, pg_temp AS $$
DECLARE v_attempt_id BIGINT; v_inner RECORD;
BEGIN
  -- STEP 0a-0d: param + tenant pre-checks (RAISE on shape failure)
  INSERT INTO public.scheduler_admin_revert_attempts(...)
    VALUES (..., 'pending') RETURNING id INTO v_attempt_id;
  BEGIN
    SELECT * INTO v_inner FROM public.revert_md_upload_apply(...);
    UPDATE public.scheduler_admin_revert_attempts
      SET outcome = CASE WHEN p_dry_run THEN 'dry_run_success' ELSE 'success' END, ...
      WHERE id = v_attempt_id;
    RETURN QUERY SELECT v_inner.audit_log_id, ...,
                        (CASE WHEN p_dry_run THEN 'dry_run_success' ELSE 'success' END)::TEXT,
                        NULL::TEXT, NULL::TEXT, v_attempt_id;
  EXCEPTION WHEN OTHERS THEN
    -- classify SQLSTATE + RAISE-prefix → reason_code; UPDATE attempt row to
    -- 'rejected'/'crashed'; RETURN QUERY structured outcome. NEVER re-RAISE.
  END;
END $$;

-- MANDATORY function-execute hardening (do NOT skip — PostgreSQL grants EXECUTE
-- on new functions to PUBLIC by default, so withholding the GRANT is necessary
-- but NOT sufficient. CREATE OR REPLACE also preserves existing privileges —
-- explicit REVOKE defends against stale grants from prior partial migrations).
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_attempt(<arg list>) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_md_upload_attempt(<arg list>) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revert_md_upload_attempt(<arg list>) TO service_role;
```

**MANDATORY function-execute hardening triple for the outer RPC.** Every SECURITY DEFINER function in this feature carries the same three-line block (REVOKE PUBLIC + REVOKE anon/authenticated + GRANT service_role) — the outer is no exception. The inner RPC (ADR-005) is the ONLY documented variant: same REVOKE triple, NO GRANT (so only the function-owner postgres role can call it directly; outer reaches inner via SECURITY DEFINER ownership chain). Skipping any line of the triple opens a privilege gap that ADR-016 Layer 2 depends on being closed.

## Consequences

This enables the failure-trail surface that operators need: every shape-valid attempt produces a row in `scheduler_admin_revert_attempts` that survives the inner's rollback, carrying the machine-readable `reason_code` enum, the verbose DB-only `error_detail`, and an `attempt_id` that flows into the Sentry tag for operator pivot. The TypeScript wrapper can branch uniformly on `outcome` without parsing `error_message`, and the Sentry alert key shifts from "audit row with error_message" (which never fired) to the attempt-row outcome surface (which always does).

The split costs one extra RPC hop per revert and one extra UPDATE per attempt row, plus the discipline of maintaining two function signatures in lockstep across migrations. It also makes the inner RPC's "RAISE-only" contract load-bearing: any future contributor who returns a structured failure from inner instead of RAISEing will silently break the classifier path and produce attempt rows with `outcome='success'` for what were actually failures. The `extensions, public` search_path and the `service_role` GRANT on the outer (paired with the absence of any GRANT on the inner per ADR-005) are the only entry points; bypassing the outer to call inner directly is impossible for the `service_role` caller, which preserves the attempt-row audit-trail invariant.

What is now impossible: a revert attempt that mutates anything without first producing an attempt row, and a revert attempt that rolls back without leaving an audit-trail. Both classes of silent failure were the point of the split.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §3b CV2-B6, §4.4
- Related ADRs: ADR-002 (attempt-row contract), ADR-003 (PL/pgSQL BEGIN/EXCEPTION), ADR-005 (outer-only service_role entry)
