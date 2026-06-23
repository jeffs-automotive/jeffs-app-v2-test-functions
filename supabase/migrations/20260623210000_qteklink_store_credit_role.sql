-- =====================================================================
-- QTekLink — store_credit system mapping role (Customer Store Credit liability)
-- =====================================================================
-- 2026-06-23. Feature qteklink-payments-fixes (Task 2 — store credits).
-- (docs/qteklink/payments-fixes-{findings,plan}.md.)
--
-- Store credit at Jeff's is a top-level Tekmetric paymentType (STORE_CREDIT,
-- redemption) plus an UNATTACHED real-tender payment (repairOrderId null, issuance).
-- Both book against ONE new QBO "Customer Store Credit" Other-Current-Liability
-- account: issuance Dr Undeposited / Cr it; redemption Dr it / Cr A/R.
--
-- That account is a FIXED shop-level account, so it's a `system` mapping (like
-- accounts_receivable / undeposited_funds / cc_fee), keyed source_key='store_credit'
-- with role 'store_credit' (system rule: role == source_key). This WIDENS five gates,
-- in lock-step (functions + CHECKs + RPC), so the mapping can be set + validated:
--   1. qteklink_role_accepts_type : store_credit => Other Current Liability
--   2. qteklink_kind_accepts_role : system accepts store_credit
--   3. CHECK qteklink_mappings_kind_role   : system + store_credit
--   4. CHECK qteklink_mappings_system_key  : store_credit is an allowed system key
--   5. RPC qteklink_set_mapping            : store_credit in the system allowlist
-- The per-account BEFORE-write trigger (qteklink_mappings_validate) is unchanged.
-- No account is bound here — Chris creates the QBO account + sets the mapping via the
-- /mappings UI; until then a store-credit payment routes to the resolution queue
-- (unmapped:store_credit), never mis-posted. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- (1) role -> QBO account_type matrix: store_credit accepts Other Current Liability.
CREATE OR REPLACE FUNCTION public.qteklink_role_accepts_type(p_role text, p_account_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    CASE p_role
      WHEN 'income'              THEN p_account_type IN ('Income','Other Income')
      WHEN 'sales_tax_payable'   THEN p_account_type IN ('Other Current Liability','Long Term Liability')
      WHEN 'tire_fee_payable'    THEN p_account_type IN ('Other Current Liability','Long Term Liability')
      WHEN 'accounts_receivable' THEN p_account_type = 'Other Current Asset'
      WHEN 'undeposited_funds'   THEN p_account_type = 'Other Current Asset'
      WHEN 'cc_fee'              THEN p_account_type IN ('Expense','Other Expense')
      WHEN 'noncash_contra'      THEN p_account_type IN ('Expense','Other Expense')
      WHEN 'store_credit'        THEN p_account_type = 'Other Current Liability'
      ELSE false
    END,
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text) TO service_role;

COMMENT ON FUNCTION public.qteklink_role_accepts_type(text, text) IS
  'QTekLink role->QBO account_type compatibility matrix. Pure (IMMUTABLE), NULL-safe (a NULL account_type => FALSE). accounts_receivable => Other Current Asset (bulk customer-less A/R). store_credit => Other Current Liability (the Customer Store Credit account: issuance credits it, redemption debits it). Used by qteklink_set_mapping + the BEFORE-write validation trigger.';

-- (2) kind -> role matrix: system accepts store_credit (alongside ar/undeposited/cc_fee).
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
    WHEN 'noncash_payment_type' THEN p_role IN ('noncash_contra','undeposited_funds')
    WHEN 'system'               THEN p_role IN ('accounts_receivable','undeposited_funds','cc_fee','store_credit')
    ELSE false
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text) TO service_role;

-- (3) kind<->role CHECK — keep it in lock-step with the function.
ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_kind_role;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_kind_role CHECK (
  (kind IN ('labor','part_category','fee','sublet') AND posting_role = 'income')
  OR (kind = 'tax' AND posting_role IN ('sales_tax_payable','tire_fee_payable'))
  OR (kind = 'payment_type' AND posting_role = 'undeposited_funds')
  OR (kind = 'noncash_payment_type' AND posting_role IN ('noncash_contra','undeposited_funds'))
  OR (kind = 'system' AND posting_role IN ('accounts_receivable','undeposited_funds','cc_fee','store_credit'))
);

-- (4) system source_key allowlist CHECK — add store_credit (role == source_key still enforced).
ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_system_key;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_system_key CHECK (
  kind <> 'system'
  OR (source_key IN ('accounts_receivable','undeposited_funds','cc_fee','store_credit') AND posting_role = source_key)
);

-- (5) RPC: add store_credit to the system source_key allowlist (clean message). Body is
-- otherwise IDENTICAL to 20260607000000 (preserves source_key identity, kind<->role
-- pre-check, fee-only pass_through, role==source_key, search_path = '').
CREATE OR REPLACE FUNCTION public.qteklink_set_mapping(
  p_shop_id        integer,
  p_realm_id       text,
  p_kind           text,
  p_source_key     text,
  p_source_id      text,
  p_qbo_account_id text,
  p_posting_role   text,
  p_pass_through   boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_src_id  text := nullif(btrim(p_source_id), '');
  v_src_key text := btrim(coalesce(p_source_key, ''));
  v_id      uuid;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_set_mapping: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_kind IS NULL OR length(v_src_key) = 0
     OR p_qbo_account_id IS NULL OR length(btrim(p_qbo_account_id)) = 0
     OR p_posting_role IS NULL THEN
    RAISE EXCEPTION 'qteklink_set_mapping: kind, source_key, qbo_account_id and posting_role are required';
  END IF;

  IF NOT public.qteklink_kind_accepts_role(p_kind, p_posting_role) THEN
    RAISE EXCEPTION 'qteklink_set_mapping: a % mapping cannot use posting_role %', p_kind, p_posting_role;
  END IF;
  IF coalesce(p_pass_through, false) AND p_kind <> 'fee' THEN
    RAISE EXCEPTION 'qteklink_set_mapping: pass_through is only valid for a fee mapping (got kind=%)', p_kind;
  END IF;
  IF p_kind = 'system' THEN
    IF v_src_key NOT IN ('accounts_receivable','undeposited_funds','cc_fee','store_credit') THEN
      RAISE EXCEPTION 'qteklink_set_mapping: system source_key % must be accounts_receivable, undeposited_funds, cc_fee or store_credit', v_src_key;
    END IF;
    IF p_posting_role <> v_src_key THEN
      RAISE EXCEPTION 'qteklink_set_mapping: a system mapping''s posting_role must equal its source_key (got % vs %)', p_posting_role, v_src_key;
    END IF;
  END IF;

  UPDATE public.qteklink_mappings
     SET active = false, updated_at = now()
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND kind = p_kind
     AND source_key = v_src_key AND active;

  INSERT INTO public.qteklink_mappings (
    shop_id, realm_id, kind, source_key, source_id, qbo_account_id, posting_role, pass_through, active, effective_from
  ) VALUES (
    p_shop_id, p_realm_id, p_kind, v_src_key, v_src_id, p_qbo_account_id, p_posting_role,
    coalesce(p_pass_through, false), true, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text, boolean) TO service_role;

COMMIT;
