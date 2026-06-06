-- =====================================================================
-- QTekLink C2 hardening — mapping-model integrity (cross-verify fixes 1-4,8)
-- =====================================================================
-- 2026-06-06. Gemini + GPT cross-verify found a financial-config integrity
-- cluster in the mapping model (calibrated gates had passed). This migration:
--
-- (1) SOURCE IDENTITY = source_key. The original `coalesce(source_id, source_key)`
--     active-uniqueness let the SAME source fork into two active rows (map "Labor"
--     with no id, then re-map "Labor"+id => the identity changed key->id, so the
--     old row was not deactivated) and let a numeric source_id collide with a
--     different source's source_key. Fix: source_key is the STABLE identity (one
--     active per (shop,realm,kind,source_key)); source_id is supplementary, with
--     its OWN partial-unique guard so an id can't be reused within a kind.
-- (2) Reject INACTIVE QBO accounts (not just soft-deleted) — QBO won't post to an
--     inactive account, so it must not be mappable. Enforced in the trigger below
--     (the DAL picker also filters active=true).
-- (3) kind <-> posting_role compatibility (e.g. a `labor` mapping may only post as
--     `income`; `tax` only as a tax-payable) — a within-row CHECK, all paths.
-- (4) `system` rows are the fixed posting accounts — their source_key is limited
--     to {accounts_receivable, undeposited_funds, cc_fee} and posting_role must
--     equal the source_key — a within-row CHECK.
-- (8) The pure helper qteklink_role_accepts_type gets SET search_path (clears
--     advisor 0011), as does the new qteklink_kind_accepts_role.
--
-- DEFENSE IN DEPTH (GPT): role<->account-type + account-live/active were only
-- RPC-enforced, but service_role has direct DML. A BEFORE INSERT/UPDATE TRIGGER
-- now enforces them on EVERY write of an active row (keytag Layer-4 precedent),
-- and the kind/role + system rules are table CHECKs — so a direct service_role
-- write cannot create a financially-invalid mapping.
--
-- Apply: supabase db push. IDEMPOTENT (DROP/CREATE IF (NOT) EXISTS / OR REPLACE).
-- =====================================================================

BEGIN;

-- ─── (8) pin search_path on the pure role<->type helper (advisor 0011) ──────
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
    WHEN 'accounts_receivable' THEN p_account_type = 'Accounts Receivable'
    WHEN 'undeposited_funds'   THEN p_account_type = 'Other Current Asset'
    WHEN 'cc_fee'              THEN p_account_type IN ('Expense','Other Expense')
    WHEN 'noncash_contra'      THEN p_account_type IN ('Expense','Other Expense')
    ELSE false
  END;
$$;

-- ─── (3) kind -> allowed posting_role(s) matrix (for clean RPC messages) ────
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
    WHEN 'noncash_payment_type' THEN p_role = 'noncash_contra'
    WHEN 'system'               THEN p_role IN ('accounts_receivable','undeposited_funds','cc_fee')
    ELSE false
  END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_kind_accepts_role(text, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_kind_accepts_role(text, text) IS
  'QTekLink kind->posting_role compatibility (mirrors the qteklink_mappings_kind_role CHECK + catalog.ts). Used by qteklink_set_mapping for a clean message. Pure (IMMUTABLE).';

-- ─── (1) source_key is the stable identity; source_id is a guarded alias ────
DROP INDEX IF EXISTS public.qteklink_mappings_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_mappings_one_active_key
  ON public.qteklink_mappings (shop_id, realm_id, kind, source_key)
  WHERE active;
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_mappings_one_active_srcid
  ON public.qteklink_mappings (shop_id, realm_id, kind, source_id)
  WHERE active AND source_id IS NOT NULL;

-- ─── (3)(4) within-row CHECKs — enforced on ALL write paths ─────────────────
ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_kind_role;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_kind_role CHECK (
  (kind IN ('labor','part_category','fee','sublet') AND posting_role = 'income')
  OR (kind = 'tax' AND posting_role IN ('sales_tax_payable','tire_fee_payable'))
  OR (kind = 'payment_type' AND posting_role = 'undeposited_funds')
  OR (kind = 'noncash_payment_type' AND posting_role = 'noncash_contra')
  OR (kind = 'system' AND posting_role IN ('accounts_receivable','undeposited_funds','cc_fee'))
);

ALTER TABLE public.qteklink_mappings DROP CONSTRAINT IF EXISTS qteklink_mappings_system_key;
ALTER TABLE public.qteklink_mappings ADD CONSTRAINT qteklink_mappings_system_key CHECK (
  kind <> 'system'
  OR (source_key IN ('accounts_receivable','undeposited_funds','cc_fee') AND posting_role = source_key)
);

-- ─── (2) defense-in-depth: validate the mapped account on every ACTIVE write ─
-- Reads qbo_accounts (cross-table → must be a trigger, not a CHECK). Only
-- validates active rows, so deactivating a mapping to a since-removed/inactive
-- account is always allowed. Enforces existence + not-soft-deleted + QBO-active
-- + role<->account_type, for the RPC path AND any direct service_role DML.
CREATE OR REPLACE FUNCTION public.qteklink_mappings_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type    text;
  v_deleted timestamptz;
  v_active  boolean;
BEGIN
  IF NOT NEW.active THEN
    RETURN NEW;  -- deactivations / historical rows are never re-validated
  END IF;

  SELECT account_type, deleted_at, active INTO v_type, v_deleted, v_active
    FROM public.qbo_accounts
   WHERE shop_id = NEW.shop_id AND realm_id = NEW.realm_id AND qbo_account_id = NEW.qbo_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_mappings: account % is not in the COA for shop % realm %',
      NEW.qbo_account_id, NEW.shop_id, NEW.realm_id;
  END IF;
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'qteklink_mappings: account % has been removed from QuickBooks — cannot map to it', NEW.qbo_account_id;
  END IF;
  IF NOT v_active THEN
    RAISE EXCEPTION 'qteklink_mappings: account % is inactive in QuickBooks — only active accounts can be mapped', NEW.qbo_account_id;
  END IF;
  IF NOT public.qteklink_role_accepts_type(NEW.posting_role, coalesce(v_type, '')) THEN
    RAISE EXCEPTION 'qteklink_mappings: posting_role % is not compatible with account type % (account %)',
      NEW.posting_role, coalesce(v_type, '(null)'), NEW.qbo_account_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS qteklink_mappings_validate_trg ON public.qteklink_mappings;
CREATE TRIGGER qteklink_mappings_validate_trg
  BEFORE INSERT OR UPDATE ON public.qteklink_mappings
  FOR EACH ROW EXECUTE FUNCTION public.qteklink_mappings_validate();

-- ─── (1)(3)(4) set_mapping: deactivate by source_key + clean within-row msgs ─
CREATE OR REPLACE FUNCTION public.qteklink_set_mapping(
  p_shop_id        integer,
  p_realm_id       text,
  p_kind           text,
  p_source_key     text,
  p_source_id      text,
  p_qbo_account_id text,
  p_posting_role   text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- Within-row rules pre-checked here for clean messages (the table CHECKs are
  -- the all-path backstop; the trigger validates the account itself).
  IF NOT public.qteklink_kind_accepts_role(p_kind, p_posting_role) THEN
    RAISE EXCEPTION 'qteklink_set_mapping: a % mapping cannot use posting_role %', p_kind, p_posting_role;
  END IF;
  IF p_kind = 'system' THEN
    IF v_src_key NOT IN ('accounts_receivable','undeposited_funds','cc_fee') THEN
      RAISE EXCEPTION 'qteklink_set_mapping: system source_key % must be accounts_receivable, undeposited_funds or cc_fee', v_src_key;
    END IF;
    IF p_posting_role <> v_src_key THEN
      RAISE EXCEPTION 'qteklink_set_mapping: a system mapping''s posting_role must equal its source_key (got % vs %)', p_posting_role, v_src_key;
    END IF;
  END IF;

  -- One active per source_key (the stable identity): deactivate the current
  -- active row (history kept). A reappearing source replaces, never forks.
  UPDATE public.qteklink_mappings
     SET active = false, updated_at = now()
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND kind = p_kind
     AND source_key = v_src_key AND active;

  -- Insert the new active row. The BEFORE trigger validates account existence +
  -- live + active + role<->type; the source_id partial-unique guards id reuse.
  INSERT INTO public.qteklink_mappings (
    shop_id, realm_id, kind, source_key, source_id, qbo_account_id, posting_role, active, effective_from
  ) VALUES (
    p_shop_id, p_realm_id, p_kind, v_src_key, v_src_id, p_qbo_account_id, p_posting_role, true, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMIT;
