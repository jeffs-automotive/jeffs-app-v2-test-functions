# ADR-003: PL/pgSQL transaction-control pattern (BEGIN/EXCEPTION, not literal SAVEPOINT)

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.3/v0.4 prose that used the word "SAVEPOINT" without clarifying it meant the BEGIN/EXCEPTION pattern. Distilled from X-FIX-AGENT-A + cross-verify rounds 1-2 SAVEPOINT-compilation findings.
**Superseded by:** (none)

## Context

The outer/inner two-RPC split (ADR-001) requires the outer RPC to invoke the inner RPC inside a transaction-control boundary so the inner's mutations can be atomically rolled back on any failure while the outer's pre-INSERTed attempt-tracking row survives (ADR-002).

Prior PLAN.md prose repeatedly used the word "SAVEPOINT" to describe this boundary — e.g., "the outer wraps the inner in SAVEPOINT" and "ROLLBACK TO SAVEPOINT semantics." Read literally, that prose implies a function body containing SQL statements like `SAVEPOINT revert_apply`, `ROLLBACK TO SAVEPOINT revert_apply`, and `RELEASE SAVEPOINT revert_apply`. PostgreSQL functions invoked as Supabase RPCs cannot do that — the PL/pgSQL compiler rejects `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` / `RELEASE SAVEPOINT` SQL statements inside function bodies (these are transaction-control statements reserved for the top-level session or procedures invoked via `CALL`).

X-FIX-AGENT-A and the round 1-2 cross-verify findings caught operators / coding agents reading "SAVEPOINT" verbatim, attempting to implement it, and producing code that fails to compile. The fix is to fix the prose: in this codebase "SAVEPOINT" is a shorthand for the PL/pgSQL nested-block pattern documented below. Literal SQL `SAVEPOINT` keywords appear nowhere in the feature's migrations.

## Decision

The canonical pattern is a nested `BEGIN … EXCEPTION WHEN <condition> THEN <handler> END;` block, which the PL/pgSQL runtime automatically wraps in an implicit subtransaction. On any RAISE inside the block, the subtransaction auto-rolls back and control transfers to the EXCEPTION handler, which then runs in the outer transaction frame.

```sql
BEGIN
  -- nested subtransaction (implicit, no literal SAVEPOINT keyword)
  SELECT * INTO v_inner FROM public.revert_md_upload_apply(...);
  -- inner succeeded: classify dry_run vs apply, UPDATE attempt row to success
EXCEPTION WHEN OTHERS THEN
  -- inner RAISEd: subtransaction auto-rolled back (inner mutations + audit row gone)
  GET STACKED DIAGNOSTICS
    v_sqlstate        = RETURNED_SQLSTATE,
    v_sqlerrm         = MESSAGE_TEXT,
    v_constraint_name = CONSTRAINT_NAME;
  -- classify (outcome, reason_code) per ADR-008; UPDATE attempt row to terminal state
  -- RETURN QUERY structured row; do NOT re-RAISE
END;
```

Two related contract details:

- **Inner is a function, not a procedure.** It is invoked via `SELECT * INTO v_inner FROM public.revert_md_upload_apply(...)`, NOT via `CALL public.revert_md_upload_apply(...)`. Procedures can issue `COMMIT` / `ROLLBACK` SQL statements directly; functions cannot. The feature uses functions throughout to keep the transaction model clean — one outer transaction frame, with exactly one nested subtransaction opened via the BEGIN/EXCEPTION block above.

- **The outer's attempt-row INSERT runs BEFORE the BEGIN/EXCEPTION block.** When the inner RAISEs and the subtransaction rolls back, the pre-INSERTed `outcome='pending'` row remains in the outer transaction frame. The outer's EXCEPTION handler then UPDATEs that row to the terminal `(outcome, reason_code, completed_at, ...)` tuple. This pre-INSERT-then-wrap ordering is the foundation of the always-an-attempt-row contract (ADR-002).

## Consequences

This pattern works because PL/pgSQL's implicit subtransaction is the only mechanism available to function bodies for catching errors without aborting the surrounding transaction. It gives the feature exactly-once attempt-row accounting, atomic inner rollback, and a uniform classifier surface — all without depending on SAVEPOINT SQL keywords that would fail to compile.

It constrains the design to one nested level: nested BEGIN/EXCEPTION blocks can be stacked, but the outer/inner split deliberately keeps that depth at 1. Anything more (e.g., handler-level BEGIN/EXCEPTION for per-row recovery) is explicitly out of scope — handlers RAISE on any failure and the outer's single block catches everything.

It also forecloses moving the inner to a procedure. Switching `revert_md_upload_apply` to `CREATE PROCEDURE` would enable `COMMIT`/`ROLLBACK` semantics but break the `SELECT … INTO v_inner FROM …` invocation (procedures require `CALL`), and would re-open the question of how the outer atomically rolls back inner work. The function-with-nested-BEGIN/EXCEPTION pattern is the chosen shape; the cost of breaking it is high.

## Sources

- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.4 "PL/pgSQL transaction-control note" and surrounding outer RPC SQL (lines 1389-1499)
- Related ADRs: ADR-001 (outer/inner split), ADR-002 (attempt-row insertion contract), ADR-008 (classifier — runs inside the EXCEPTION block)
