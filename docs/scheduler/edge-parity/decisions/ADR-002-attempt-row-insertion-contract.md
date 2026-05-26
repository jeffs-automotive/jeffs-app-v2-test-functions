# ADR-002: Attempt-row insertion contract

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 "always inserts an attempt row regardless of outcome" promise.
**Superseded by:** (none)

## Context

The v0.5 plan promised the outer RPC would "always insert an attempt row regardless of outcome" as a hard audit-trail guarantee. That promise collided with the `attempt.upload_id BIGINT NOT NULL REFERENCES scheduler_admin_audit_log(id)` foreign-key constraint: a nonexistent or wrong-shop `p_upload_id` would raise FK 23503 OUTSIDE the inner BEGIN/EXCEPTION subtransaction (the pre-INSERT runs in the outer frame), surfacing as a raw FK error string to the caller AND failing to write any attempt row at all. The "always inserts" claim therefore could not be honored as stated.

Cross-verify round 2 (GPT chunk 2 IMPORTANTs #27 + #28) flagged the gap and prompted STEP 0d — a pre-INSERT upload-existence + shop-ownership check that converts the would-be FK violation into a clean rejection shape. The contract below reflects that distillation: the guarantee is no longer "always" — it is conditional on valid parameters AND existence of the referenced upload, with three explicit branches that callers and operators can reason about.

## Decision

The outer RPC has three terminal branches:

**Branch 1 — Row IS inserted.** All four guards pass: STEP 0a (`p_shop_id IS NOT NULL AND > 0`), STEP 0b (`p_actor_email` present), STEP 0c (boolean params `p_dry_run` / `p_force_no_after_hash` non-NULL), STEP 0d (the referenced upload exists in the caller's shop). The outer's pre-INSERT writes a pending attempt row in the outer transaction frame BEFORE the inner BEGIN/EXCEPTION subtransaction starts. The inner runs; on success or controlled failure, the outer's terminal UPDATE finalizes the outcome on that same row. Because the pre-INSERT lives in the outer frame, the failed-attempt row survives the inner's rollback and remains as audit evidence.

**Branch 2 — Row is NOT inserted; caller gets a clean rejection.** STEP 0d finds no matching row (nonexistent upload_id, or upload belongs to a different shop). Outer returns `{outcome: 'rejected', reason_code: 'not_found', attempt_id: NULL}` WITHOUT writing an attempt row. Rationale: there is no upload to attempt against, so no audit-trail row is owed; the rejection itself is the audit record (logged at the caller).

**Branch 3 — Call RAISEs without writing a row.** STEP 0a / 0b / 0c guards fail (NULL or invalid params). Outer RAISEs an exception per Postgres convention; the RPC client surfaces it as a call error, not as an attempt row.

SQL skeleton for STEP 0d:

```sql
-- Inside outer RPC, after STEP 0a/0b/0c guards.
-- RETURN QUERY shape MUST match the RETURNS TABLE signature declared in
-- ADR-001 (10 columns, exact types). Any drift here causes a structure-
-- mismatch error at call time and breaks the no-RAISE contract.
IF NOT EXISTS (
  SELECT 1 FROM public.scheduler_admin_audit_log
  WHERE id = p_upload_id AND shop_id = p_shop_id
) THEN
  RETURN QUERY SELECT
    NULL::BIGINT       AS audit_log_id,
    NULL::TEXT         AS confirm_token,
    0::INT             AS restored,
    0::INT             AS deactivated,
    0::INT             AS deleted,
    p_dry_run          AS dry_run,
    'rejected'::TEXT   AS outcome,
    'not_found'::TEXT  AS reason_code,
    'upload not found in caller shop'::TEXT AS error_message,
    NULL::BIGINT       AS attempt_id;
  RETURN;
END IF;

-- STEP 1: pre-INSERT pending attempt row (outer frame, survives inner rollback)
INSERT INTO public.scheduler_admin_revert_attempts (upload_id, shop_id, actor_email, ...)
VALUES (p_upload_id, p_shop_id, p_actor_email, ...)
RETURNING id INTO v_attempt_id;
```

## Consequences

Operators can rely on: every Branch-1 call leaves exactly one attempt row whose terminal state reflects the inner's outcome (success or controlled failure), in the caller's shop, against the referenced upload. Branch 2 rejections never pollute the attempts table with FK-orphan-shaped rows. Branch 3 RAISEs never land silent — the caller sees a Postgres exception with a recognizable SQLSTATE.

Operators cannot rely on: an attempt row existing for every call. A missing or wrong-shop `p_upload_id` produces no attempt row by design — observers must consult the caller's RPC-call log (not the attempts table) to see Branch 2 events. The v0.5 "always inserts" mental model is retired; the canonical model is "always inserts IF parameters are valid AND upload exists."

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §3b CV2-B6, §4.4 STEP 0d
- Related ADRs: ADR-001 (outer/inner split), ADR-020 (attempt-row schema)
