-- =====================================================================
-- QTekLink C6 — least-privilege on qteklink_manual_payments (service_role)
-- =====================================================================
-- 2026-06-07. Supabase pre-grants ALL on a new public table to service_role via
-- DEFAULT PRIVILEGES, so the prior migration's `GRANT SELECT` did NOT constrain it
-- (the C4 payment_state gotcha — caught by a live grants check). Writes must go
-- ONLY through the SECURITY DEFINER `qteklink_record_manual_payment` RPC; the DAL
-- reads via service_role SELECT. REVOKE the pre-granted write privileges.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_manual_payments FROM service_role;

COMMIT;
