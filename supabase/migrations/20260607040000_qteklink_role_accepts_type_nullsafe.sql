-- =====================================================================
-- QTekLink — qteklink_role_accepts_type is NULL-safe (defense in depth)
-- =====================================================================
-- 2026-06-07. Round-2 hardening (cross-verify). The role↔type matrix is a
-- boolean compatibility predicate, but for a NULL p_account_type the arm
-- expressions (`p_account_type = 'Other Current Asset'`, `... IN (...)`) evaluate
-- to NULL, not false. Both live callers already pass `coalesce(v_type, '')` (the
-- RPC `qteklink_set_mapping` + the BEFORE-write trigger `qteklink_mappings_validate`),
-- so the gate is currently SAFE — but a function that can return NULL is a footgun
-- for any future caller or a CHECK usage (`IF NOT f() THEN reject` skips the reject
-- branch on NULL). Wrap the CASE in `coalesce(..., false)` so a NULL account type
-- (an account QBO returned without a type) is hard-FALSE → unmappable for every
-- role. No behavior change for non-NULL inputs; only the NULL path is tightened.
--
-- Preserves the migration 20260607020000 body (accounts_receivable ⇒ Other
-- Current Asset), signature, IMMUTABLE, search_path = '', and grants.
--
-- Apply: supabase db push. IDEMPOTENT (CREATE OR REPLACE).
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.qteklink_role_accepts_type(p_role text, p_account_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- coalesce(..., false): a NULL p_account_type makes the matched arm NULL; force
  -- it to FALSE so an unknown-type account is never silently accepted.
  SELECT coalesce(
    CASE p_role
      WHEN 'income'              THEN p_account_type IN ('Income','Other Income')
      WHEN 'sales_tax_payable'   THEN p_account_type IN ('Other Current Liability','Long Term Liability')
      WHEN 'tire_fee_payable'    THEN p_account_type IN ('Other Current Liability','Long Term Liability')
      WHEN 'accounts_receivable' THEN p_account_type = 'Other Current Asset'
      WHEN 'undeposited_funds'   THEN p_account_type = 'Other Current Asset'
      WHEN 'cc_fee'              THEN p_account_type IN ('Expense','Other Expense')
      WHEN 'noncash_contra'      THEN p_account_type IN ('Expense','Other Expense')
      ELSE false
    END,
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text) TO service_role;

COMMENT ON FUNCTION public.qteklink_role_accepts_type(text, text) IS
  'QTekLink role->QBO account_type compatibility matrix. Pure (IMMUTABLE), NULL-safe (a NULL account_type ⇒ FALSE). accounts_receivable ⇒ Other Current Asset (bulk customer-less A/R; a true Accounts Receivable type would force a per-line Customer Entity — migration 20260607020000 + plan §0/§13). Used by qteklink_set_mapping + the BEFORE-write validation trigger.';

COMMIT;
