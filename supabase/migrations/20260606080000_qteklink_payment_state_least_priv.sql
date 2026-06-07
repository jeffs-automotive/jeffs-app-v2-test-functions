-- =====================================================================
-- QTekLink C4 fix — make qteklink_payment_state writes go through the RPC only
-- =====================================================================
-- 2026-06-06. 20260606070000 GRANTed service_role SELECT intending a read-only
-- runtime role (all writes flow through the SECURITY DEFINER
-- qteklink_upsert_payment_state RPC, which executes as the table owner). But
-- Supabase's default privileges (ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES
-- TO service_role) had ALREADY granted ALL on the new table, and GRANT is
-- ADDITIVE — so service_role still held INSERT/UPDATE/DELETE/TRUNCATE
-- (live-verified: service_role_privs = ALL, not SELECT). Identical to the
-- qteklink_events case fixed by 20260606050000.
--
-- For least privilege (the DAL reads via service_role; the definer owns the
-- writes), revoke the mutating privileges from the app's runtime role explicitly.
-- service_role keeps SELECT; the definer RPC (owner = postgres) is unaffected.
-- pgTAP (qteklink_payment_state.test.sql) asserts the post-revoke state:
-- service_role can SELECT + EXECUTE the RPC, but cannot INSERT/UPDATE/DELETE.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payment_state FROM service_role;

COMMIT;
