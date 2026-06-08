-- =====================================================================
-- QTekLink — allow a noncash_payment_type to map as a DEPOSIT (financing types)
-- =====================================================================
-- 2026-06-08. Tekmetric sends consumer-financing payments (Synchrony, Affirm, CareCredit,
-- …) as paymentType "Other" → QTekLink classified them ALL as non-cash (Dr <contra> / Cr
-- A/R). But financing providers DEPOSIT the money to the shop's bank (minus their fee),
-- exactly like a credit card — so they should book Dr Undeposited / Cr A/R (the deposit
-- leg), with the financing fee entered in QBO at reconcile (Tekmetric doesn't give it).
--
-- The role IS the deposit-vs-non-cash switch: a noncash_payment_type mapped with role
-- 'undeposited_funds' (account = Undeposited Funds or a clearing Other-Current-Asset)
-- routes through the DEPOSIT path; role 'noncash_contra' stays the non-cash path. This
-- only WIDENS the kind->role matrix (function + CHECK); role 'undeposited_funds' already
-- accepts Other Current Asset, and the per-account validate trigger is unchanged.
-- Idempotent. Apply: supabase db push.
-- =====================================================================

BEGIN;

-- (1) the kind->role compat function (mirrors the CHECK + catalog.ts) — add the deposit role.
CREATE OR REPLACE FUNCTION public.qteklink_kind_accepts_role(p_kind text, p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_kind
    WHEN 'labor'                THEN p_role = 'income'
    WHEN 'part_category'        THEN p_role = 'income'
    WHEN 'fee'                  THEN p_role = 'income'
    WHEN 'sublet'               THEN p_role = 'income'
    WHEN 'tax'                  THEN p_role IN ('sales_tax_payable','tire_fee_payable')
    WHEN 'payment_type'         THEN p_role = 'undeposited_funds'
    -- non-cash payment types are EITHER a true contra (warranty / internal) OR a financing
    -- type that deposits like a card (role 'undeposited_funds').
    WHEN 'noncash_payment_type' THEN p_role IN ('noncash_contra','undeposited_funds')
    WHEN 'system'               THEN p_role IN ('accounts_receivable','undeposited_funds','cc_fee')
    ELSE false
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text) TO service_role;

-- (2) the within-row CHECK — keep it in lock-step with the function.
ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_kind_role;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_kind_role CHECK (
  (kind IN ('labor','part_category','fee','sublet') AND posting_role = 'income')
  OR (kind = 'tax' AND posting_role IN ('sales_tax_payable','tire_fee_payable'))
  OR (kind = 'payment_type' AND posting_role = 'undeposited_funds')
  OR (kind = 'noncash_payment_type' AND posting_role IN ('noncash_contra','undeposited_funds'))
  OR (kind = 'system' AND posting_role IN ('accounts_receivable','undeposited_funds','cc_fee'))
);

COMMIT;
