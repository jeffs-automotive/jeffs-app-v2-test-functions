-- =====================================================================
-- QTekLink — accounts_receivable role accepts Other Current Asset
-- =====================================================================
-- 2026-06-07. Plan §0 (macro/micro) + §4 + §13/§17. The role<->QBO-account-type
-- compatibility matrix (qteklink_role_accepts_type) required the
-- `accounts_receivable` posting role to target a true 'Accounts Receivable'-TYPE
-- account. For QTekLink's design that is BACKWARDS:
--
--   QBO mandates a Customer Entity on EVERY JournalEntry line that posts to an
--   'Accounts Receivable'-type account (a Vendor for 'Accounts Payable'). QTekLink
--   posts BULK, customer-less A/R — Tekmetric is the per-customer sub-ledger; QBO
--   is the macro roll-up (no QBO Customers / Invoices / Vendors). So the A/R target
--   MUST be a non-A/R asset type. Jeff's receivable [235] "ACCOUNTS RECEIVABLE"
--   (acct# 120) is type 'Other Current Asset' — an Entity-less JE Debit to it was
--   live-accepted at minorversion 75 (probe JE 25735, created + deleted net-zero).
--
-- A true 'Accounts Receivable'-type target would make every bulk JE fail for a
-- missing customer, so it is intentionally REJECTED (the RAISE message guides the
-- admin to an Other-Current-Asset receivable). Only the `accounts_receivable` arm
-- of the CASE changes ('Accounts Receivable' -> 'Other Current Asset'); the
-- signature, IMMUTABLE, search_path='' and the least-privilege grants are
-- preserved, and the C2 BEFORE-write validation trigger that calls this is
-- unaffected (it references the function by name).
--
-- The `ar_entity_rejected` post-time guard (C6) stays as defense-in-depth for a
-- future A/R-type misconfiguration or a minorversion tightening.
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
  SELECT CASE p_role
    WHEN 'income'              THEN p_account_type IN ('Income','Other Income')
    WHEN 'sales_tax_payable'   THEN p_account_type IN ('Other Current Liability','Long Term Liability')
    WHEN 'tire_fee_payable'    THEN p_account_type IN ('Other Current Liability','Long Term Liability')
    -- Bulk, customer-less A/R ⇒ an Other Current Asset account. A true
    -- 'Accounts Receivable'-type account would force a per-line Customer Entity
    -- (QBO API contract) and break bulk posting, so it is rejected here.
    WHEN 'accounts_receivable' THEN p_account_type = 'Other Current Asset'
    WHEN 'undeposited_funds'   THEN p_account_type = 'Other Current Asset'
    WHEN 'cc_fee'              THEN p_account_type IN ('Expense','Other Expense')
    WHEN 'noncash_contra'      THEN p_account_type IN ('Expense','Other Expense')
    ELSE false
  END;
$$;

-- Re-affirm least-privilege (CREATE OR REPLACE preserves grants, but the repo's
-- convention restates them so the migration is self-documenting).
REVOKE EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text) TO service_role;

COMMENT ON FUNCTION public.qteklink_role_accepts_type(text, text) IS
  'QTekLink role->QBO account_type compatibility matrix. Pure (IMMUTABLE). accounts_receivable ⇒ Other Current Asset (bulk customer-less A/R; a true Accounts Receivable type would force a per-line Customer Entity — see migration 20260607020000 + plan §0/§13). Used by qteklink_set_mapping + the BEFORE-write validation trigger.';

COMMIT;
