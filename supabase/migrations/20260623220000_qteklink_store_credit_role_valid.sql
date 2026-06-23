-- =====================================================================
-- QTekLink — add store_credit to the qteklink_mappings_role_valid CHECK
-- =====================================================================
-- 2026-06-23. Fixes a gap in 20260623210000 (store_credit system role): that
-- migration widened the role<->type matrix, the kind<->role function + CHECK, the
-- system_key CHECK, and the set_mapping RPC — but MISSED the standalone column-level
-- `qteklink_mappings_role_valid` CHECK that enumerates every legal posting_role.
-- So inserting a `store_credit` mapping passed every gate yet violated
-- qteklink_mappings_role_valid → "qteklink_set_mapping failed: new row ... violates
-- check constraint qteklink_mappings_role_valid" (Sentry JEFFS-APP-V2-TEST-FUNCTIONS-Z,
-- serverAction/qboMapTekmetricItem). Add store_credit so the role is accepted.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_role_valid;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_role_valid CHECK (
  posting_role = ANY (ARRAY[
    'income','sales_tax_payable','tire_fee_payable','accounts_receivable',
    'undeposited_funds','cc_fee','noncash_contra','store_credit'
  ])
);

COMMIT;
