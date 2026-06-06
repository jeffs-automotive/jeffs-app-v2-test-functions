-- =====================================================================
-- QTekLink C3 fix — make qteklink_events truly append-only for service_role
-- =====================================================================
-- 2026-06-06. 20260606040000 GRANTed service_role SELECT+INSERT intending an
-- append-only ledger — but Supabase's default privileges
-- (ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO service_role) had ALREADY
-- granted ALL on the new table, and GRANT is ADDITIVE, so service_role still held
-- UPDATE/DELETE (live-verified: service_role could UPDATE the ledger).
--
-- For a financial audit ledger that must be immutable, revoke the mutating
-- privileges from the app's runtime role explicitly (service_role has BYPASSRLS
-- but NOT superuser, so table privileges are still enforced). The edge function
-- only ever INSERTs; nothing should ever UPDATE/DELETE an event. Owner (postgres)
-- retains privileges for migrations.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

REVOKE UPDATE, DELETE, TRUNCATE ON public.qteklink_events FROM service_role;

COMMIT;
