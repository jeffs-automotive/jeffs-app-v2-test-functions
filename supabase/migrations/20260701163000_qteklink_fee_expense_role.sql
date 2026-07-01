-- =====================================================================
-- QTekLink — fee_expense posting role (a fee may credit an Expense account)
-- =====================================================================
-- 2026-07-01. Feature qteklink-fee-expense-mapping
-- (docs/qteklink/fee-expense-mapping-plan-2026-07-01.md).
--
-- Chris wants a customer-charged fee (first case: "Gas") to post to an EXPENSE
-- account so it OFFSETS the shop's cost, instead of being booked as income. The
-- SALE JE builder already CREDITS whatever account a fee maps to (sale-builder.ts);
-- crediting an Expense account is a contra-expense (offset) — the desired result.
-- So this is a pure ENABLEMENT change: today a `fee` mapping is locked to
-- posting_role='income', which only accepts Income/Other Income accounts.
--
-- Add a new posting role `fee_expense` (accepts Expense/Other Expense, like
-- cc_fee/noncash_contra) and let a `fee` use EITHER role. The mapping action
-- picks the role from the chosen account's type server-side; the fee is otherwise
-- unchanged (still discountable unless pass_through). This WIDENS the four
-- (kind='fee', posting_role, account_type) gates in lock-step:
--   1. qteklink_role_accepts_type : fee_expense => Expense/Other Expense
--   2. qteklink_kind_accepts_role : fee accepts income OR fee_expense
--   3. CHECK qteklink_mappings_kind_role   : fee + (income|fee_expense)
--   4. CHECK qteklink_mappings_role_valid  : fee_expense is a legal role
--
-- The store-credit rollout (20260623210000) MISSED the standalone role_valid CHECK
-- and hit a live insert failure (patched by 20260623220000) — it is gate (4) here.
-- qteklink_set_mapping (the RPC) and qteklink_mappings_validate (the trigger) call
-- the two functions BY NAME, so a CREATE OR REPLACE of the functions takes effect
-- with no body change to either. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- (1) role -> QBO account_type: fee_expense accepts Expense/Other Expense.
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
      WHEN 'fee_expense'         THEN p_account_type IN ('Expense','Other Expense')
      ELSE false
    END,
    false
  );
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_role_accepts_type(text, text) IS
  'QTekLink role->QBO account_type compatibility matrix. Pure (IMMUTABLE), NULL-safe (a NULL account_type => FALSE). fee_expense => Expense/Other Expense (a fee credited to offset that expense; a fee may use income OR fee_expense). Used by qteklink_set_mapping + the BEFORE-write validation trigger.';

-- (2) kind -> role: a fee accepts income OR fee_expense (all other arms verbatim).
CREATE OR REPLACE FUNCTION public.qteklink_kind_accepts_role(p_kind text, p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_kind
    WHEN 'labor'                THEN p_role = 'income'
    WHEN 'part_category'        THEN p_role = 'income'
    WHEN 'fee'                  THEN p_role IN ('income','fee_expense')
    WHEN 'sublet'               THEN p_role = 'income'
    WHEN 'tax'                  THEN p_role IN ('sales_tax_payable','tire_fee_payable')
    WHEN 'payment_type'         THEN p_role = 'undeposited_funds'
    WHEN 'noncash_payment_type' THEN p_role IN ('noncash_contra','undeposited_funds')
    WHEN 'system'               THEN p_role IN ('accounts_receivable','undeposited_funds','cc_fee','store_credit')
    ELSE false
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_kind_accepts_role(text, text) IS
  'QTekLink kind->posting_role compatibility (mirrors the qteklink_mappings_kind_role CHECK + catalog.ts). fee accepts income OR fee_expense (an expense-offset fee). Used by qteklink_set_mapping for a clean message. Pure (IMMUTABLE).';

-- (3) within-row kind<->role CHECK: split fee out to accept income|fee_expense.
ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_kind_role;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_kind_role CHECK (
  (kind IN ('labor','part_category','sublet') AND posting_role = 'income')
  OR (kind = 'fee' AND posting_role IN ('income','fee_expense'))
  OR (kind = 'tax' AND posting_role IN ('sales_tax_payable','tire_fee_payable'))
  OR (kind = 'payment_type' AND posting_role = 'undeposited_funds')
  OR (kind = 'noncash_payment_type' AND posting_role IN ('noncash_contra','undeposited_funds'))
  OR (kind = 'system' AND posting_role IN ('accounts_receivable','undeposited_funds','cc_fee','store_credit'))
);

-- (4) standalone posting_role enum CHECK: add fee_expense (the gate store-credit forgot).
ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_role_valid;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_role_valid CHECK (
  posting_role IN ('income','sales_tax_payable','tire_fee_payable','accounts_receivable',
    'undeposited_funds','cc_fee','noncash_contra','store_credit','fee_expense')
);

COMMIT;
