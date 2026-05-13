-- =====================================================================
-- Scheduler Phase 1 — REVOKE anon + authenticated EXECUTE on
-- SECURITY DEFINER functions
-- =====================================================================
-- Created 2026-05-13. Found by 2026-05-13 DB audit (audit_database_2026-05-13.md
-- findings C-1 + C-2).
--
-- Problem: three SECURITY DEFINER functions had default PostgreSQL
-- permissions (PUBLIC EXECUTE), exposing them to anyone with the Supabase
-- anon key:
--
--   1. public.hold_waiter_slot(...)       — anon could fill waiter holds + DoS booking
--   2. public.scheduler_invoke_edge_function(...)  — anon could invoke edge functions
--   3. public.scheduler_get_service_role_key(...)  — anon could ESCALATE to service role (worst case — full authorization bypass if the function returns the key)
--
-- For #1: the original migration (20260510131752 line 463) ran the right
-- REVOKE/GRANT but the rewrite in 20260513000200 + the fix in
-- 20260513000300 did not repeat them.
--
-- For #2 + #3: there is no committed CREATE migration; they were created
-- ad-hoc via MCP or psql. We REVOKE defensively (IF EXISTS) so the
-- migration doesn't fail if they don't exist on a given environment.
--
-- This migration:
--   1. REVOKES EXECUTE FROM PUBLIC, anon, authenticated on all three
--   2. GRANTS EXECUTE TO service_role only
--
-- Defense-in-depth — the application path uses the admin client (service
-- role) which already bypasses these grants, but RPC over PostgREST with
-- the anon key was the leak.
-- =====================================================================

-- ─── hold_waiter_slot (10-min TTL, 8-arg signature) ─────────────────────
-- Match the signature created in migration 20260513000300 exactly.
REVOKE ALL ON FUNCTION public.hold_waiter_slot(
  INTEGER, UUID, INTEGER, INTEGER, DATE, TIME, TEXT, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.hold_waiter_slot(
  INTEGER, UUID, INTEGER, INTEGER, DATE, TIME, TEXT, TEXT
) FROM anon;

REVOKE ALL ON FUNCTION public.hold_waiter_slot(
  INTEGER, UUID, INTEGER, INTEGER, DATE, TIME, TEXT, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.hold_waiter_slot(
  INTEGER, UUID, INTEGER, INTEGER, DATE, TIME, TEXT, TEXT
) TO service_role;

-- ─── scheduler_invoke_edge_function ─────────────────────────────────────
-- Signature unknown (no committed CREATE). Use the function name without
-- args — REVOKE/GRANT can't be name-only, so we do a DO block + dynamic
-- SQL to revoke from every overload that exists.
DO $$
DECLARE
  fn_oid OID;
BEGIN
  FOR fn_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'scheduler_invoke_edge_function'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION %s TO service_role;',
      fn_oid::regprocedure,
      fn_oid::regprocedure
    );
    RAISE NOTICE 'Revoked anon/authenticated EXECUTE on %', fn_oid::regprocedure;
  END LOOP;
END $$;

-- ─── scheduler_get_service_role_key ─────────────────────────────────────
-- Same shape. This is the highest-risk function in the set — if it
-- returns the service-role key (per its name), exposing it to anon is a
-- complete authorization bypass. The function may not exist (audit
-- noted no committed CREATE migration); the DO block no-ops if so.
DO $$
DECLARE
  fn_oid OID;
BEGIN
  FOR fn_oid IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'scheduler_get_service_role_key'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION %s TO service_role;',
      fn_oid::regprocedure,
      fn_oid::regprocedure
    );
    RAISE NOTICE 'Revoked anon/authenticated EXECUTE on %', fn_oid::regprocedure;
  END LOOP;
END $$;

COMMENT ON FUNCTION public.hold_waiter_slot(
  INTEGER, UUID, INTEGER, INTEGER, DATE, TIME, TEXT, TEXT
) IS
  'Reserve a waiter or drop-off slot with 10-min TTL. SECURITY DEFINER. '
  'service_role-only — anon + authenticated REVOKED 2026-05-13 per '
  'audit C-1. App path uses createSupabaseAdminClient() which is '
  'service_role.';
