# ADR-018: RLS RESTRICTIVE deny-all policies on audit_log + attempts tables

**Status:** Accepted (2026-05-26)
**Supersedes:** v0.5 audit_log had PERMISSIVE deny_all only (`USING (false)`). Distilled from X-FIX-#19 + X-FIX-#27 + cross-verify rounds 2+3 (defensive idempotent setup).
**Superseded by:** (none)

## Context

PostgreSQL combines RLS policies by KIND. PERMISSIVE policies (the default for `CREATE POLICY` without `AS RESTRICTIVE`) are logically OR'd together — if ANY permissive policy returns true, the row is visible. RESTRICTIVE policies are logically AND'd with all others — if ANY restrictive policy returns false, the row is denied regardless of what permissive policies allow. A bare PERMISSIVE `deny_all` with `USING (false)` is therefore fragile: a future migration that adds a PERMISSIVE allow policy (e.g., `CREATE POLICY "allow_self" FOR SELECT TO authenticated USING (true)`) ORs against the deny and overrides it, silently exposing the table.

Both feature tables hold sensitive operational history: `scheduler_admin_revert_attempts` stores `shop_id`, `actor_email`, `oauth_client_id`, `reason_code`, `error_detail` (verbose body that may carry inline staleness-diff content of customer-facing scheduler MD), and `dry_run_confirm_token_hash`. `scheduler_admin_audit_log` is the canonical audit trail across tenants. A misconfigured future GRANT or allow-policy on either table would expose cross-shop history. RESTRICTIVE deny-all is the only RLS shape that survives a future PERMISSIVE allow misconfiguration.

A second concern is idempotency. PostgreSQL provides no `CREATE POLICY IF NOT EXISTS` syntax. If the policy already exists from a prior partial-apply or branch drift, an unconditional `CREATE POLICY` raises `duplicate_object` (SQLSTATE 42710) and the migration fails. The DO-block + `EXCEPTION WHEN duplicate_object` pattern (matching the ADD CONSTRAINT pattern in Migration B) catches this and no-ops, making the migration retry-safe.

## Decision

Migration A creates RESTRICTIVE deny-all on the new attempts table AND hardens the existing audit-log table to the same posture. Each table gets a 3-component setup: defensive `ENABLE ROW LEVEL SECURITY`, idempotent `CREATE POLICY` in a DO-block, and matching table-level `REVOKE ALL FROM PUBLIC, anon, authenticated` + explicit `GRANT SELECT, INSERT, UPDATE TO service_role` + `GRANT USAGE, SELECT ON SEQUENCE … TO service_role`.

```sql
-- scheduler_admin_revert_attempts (new in Migration A)
ALTER TABLE public.scheduler_admin_revert_attempts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY scheduler_admin_revert_attempts_default_deny
    ON public.scheduler_admin_revert_attempts
    AS RESTRICTIVE
    FOR ALL
    TO PUBLIC, anon, authenticated
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- policy already exists from partial-apply; safe no-op
END $$;

REVOKE ALL ON TABLE public.scheduler_admin_revert_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.scheduler_admin_revert_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduler_admin_revert_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scheduler_admin_revert_attempts_id_seq TO service_role;

-- scheduler_admin_audit_log (existing — hardened in Migration A)
-- Defensive ENABLE RLS guards against environmental drift; no-op on fresh deploy
ALTER TABLE public.scheduler_admin_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "scheduler_admin_audit_log_deny_all_restrictive"
    ON public.scheduler_admin_audit_log
    AS RESTRICTIVE
    FOR ALL
    TO public
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN
  NULL;  -- policy already exists from prior partial-apply
END $$;

REVOKE ALL ON TABLE public.scheduler_admin_audit_log FROM PUBLIC;
REVOKE ALL ON TABLE public.scheduler_admin_audit_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scheduler_admin_audit_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.scheduler_admin_audit_log_id_seq TO service_role;
```

The three components are inseparable: RLS denies row visibility at the policy layer; table-level REVOKE denies even the right to issue a SELECT/INSERT/UPDATE/DELETE statement; the service_role GRANT is the single explicit access path. service_role bypasses RLS per Supabase platform behavior, so the outer `revert_md_upload_attempt` RPC (called as service_role through orchestrator-mcp) reads + writes both tables without policy interference.

## Consequences

Both tables are now resistant to the failure mode where a future PERMISSIVE allow policy ORs against the deny and opens the table — the RESTRICTIVE deny ANDs to false regardless. A future operator who naively writes `CREATE POLICY "allow_admins" ON scheduler_admin_audit_log FOR SELECT TO authenticated USING (true)` will find the policy applied but rows still denied (RESTRICTIVE wins by AND). The same future operator must also issue a table-level GRANT to break through — two independent misconfigurations required.

Migrations are retry-safe via the DO-block. A partial-apply that creates the policy then fails on a later statement can be re-run end-to-end without manual cleanup. Service-role access is unaffected: the outer RPC and orchestrator-mcp continue to read + write both tables.

The deferred risk is **definition drift**: the DO-block catches `duplicate_object` by policy NAME only. If a policy with the canonical name exists but carries a different definition (PERMISSIVE instead of RESTRICTIVE, or a relaxed USING clause from a manual operator edit), the DO-block silently accepts the wrong policy. A bulletproof migration would also verify `polpermissive`, `polqual`, `polwithcheck` from `pg_policy` and DROP + recreate on mismatch. The current decision accepts this minor risk because the policy is only ever created here; manual definition drift requires deliberate operator action and would be visible in `\d+` table inspection.

## Sources
- Archived prior plan: `docs/scheduler/edge-parity/archive/PLAN-v0.5+IMPORTANTs+round3-2026-05-26.md` §4.1 attempts-table RESTRICTIVE policy + audit-log RESTRICTIVE policy (X-FIX-#19 + X-FIX-#27)
- Related ADRs: ADR-016 (L2 — RLS is part of Layer 2), ADR-020 (attempts-table schema — table-level grants paired with RLS)
