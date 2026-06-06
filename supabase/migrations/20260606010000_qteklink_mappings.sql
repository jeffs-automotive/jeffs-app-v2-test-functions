-- =====================================================================
-- QTekLink C2 — qteklink_mappings (Tekmetric line -> QBO account) + RPCs
-- =====================================================================
-- 2026-06-06. Plan §3/§4/§15-C2. Every Tekmetric source (labor / part category
-- / fee / sublet / tax / payment type / non-cash type) AND every fixed posting
-- account (A/R, Undeposited, CC-fee) resolves to a QBO account through this
-- table — NO account ids live in code (shop-agnostic.md: shop config in the DB).
-- The posting layer (C5+) snapshots the resolved account into the posting, so a
-- later mapping edit never retro-generates a correction.
--
-- Invariants (DB-enforced):
--   * shop_id + realm_id on every row + in the uniqueness key + the account FK.
--   * ONE ACTIVE per source: partial unique (shop, realm, kind,
--     coalesce(source_id, source_key)) WHERE active — edits deactivate the prior
--     row (history kept via effective_from + active=false).
--   * ROLE-COMPAT: qteklink_set_mapping rejects a posting_role that doesn't match
--     the target account's QBO account_type, and refuses a soft-deleted account.
--   * account FK (shop, realm, qbo_account_id) -> qbo_accounts ON DELETE RESTRICT.
--
-- Security mirrors qbo_accounts (20260605060000): deny-all RLS, service_role
-- only; all writes go through SECURITY DEFINER RPCs (DAL is tenant-scoped in
-- code — service_role bypasses RLS). Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_mappings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         integer     NOT NULL,
  realm_id        text        NOT NULL,
  kind            text        NOT NULL,
  source_key      text        NOT NULL,
  source_id       text,
  qbo_account_id  text        NOT NULL,
  posting_role    text        NOT NULL,
  active          boolean     NOT NULL DEFAULT true,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_mappings_shop_positive   CHECK (shop_id > 0),
  CONSTRAINT qteklink_mappings_realm_nonblank  CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_mappings_srckey_nonblank CHECK (length(btrim(source_key)) > 0),
  CONSTRAINT qteklink_mappings_acct_nonblank   CHECK (length(btrim(qbo_account_id)) > 0),
  CONSTRAINT qteklink_mappings_kind_valid CHECK (kind IN (
    'labor','part_category','fee','sublet','tax','payment_type','noncash_payment_type','system')),
  CONSTRAINT qteklink_mappings_role_valid CHECK (posting_role IN (
    'income','sales_tax_payable','tire_fee_payable','accounts_receivable',
    'undeposited_funds','cc_fee','noncash_contra')),
  CONSTRAINT qteklink_mappings_account_fk FOREIGN KEY (shop_id, realm_id, qbo_account_id)
    REFERENCES public.qbo_accounts (shop_id, realm_id, qbo_account_id) ON DELETE RESTRICT
);

-- ONE ACTIVE mapping per (shop, realm, kind, source identity).
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_mappings_one_active
  ON public.qteklink_mappings (shop_id, realm_id, kind, coalesce(source_id, source_key))
  WHERE active;

-- Reverse lookup for the account FK (RESTRICT check) + "what maps to this account".
CREATE INDEX IF NOT EXISTS qteklink_mappings_account
  ON public.qteklink_mappings (shop_id, realm_id, qbo_account_id);

COMMENT ON TABLE public.qteklink_mappings IS
  'QTekLink mapping: Tekmetric source (kind + source_key/source_id) -> QBO account + posting_role, per shop+realm. One ACTIVE per source (partial unique); edits keep history (active=false). Fixed accounts (A/R, Undeposited, CC-fee) are kind=system rows too — no account ids in code. service_role only.';

-- deny-all RLS; service_role only (DAL is tenant-scoped in code).
ALTER TABLE public.qteklink_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qteklink_mappings TO service_role;

-- ─── Role <-> QBO account-type compatibility (financial-correctness guard) ──
-- Pure logic (no table refs). QBO AccountType strings per Intuit's enum.
CREATE OR REPLACE FUNCTION public.qteklink_role_accepts_type(p_role text, p_account_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
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
REVOKE EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_role_accepts_type(text, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_role_accepts_type(text, text) IS
  'QTekLink role->QBO account_type compatibility matrix. Used by qteklink_set_mapping + the mapping UI to filter/validate. Pure (IMMUTABLE).';

-- ─── Upsert one active mapping (validate compat + one-active, atomic) ───────
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
  v_type    text;
  v_deleted timestamptz;
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

  -- Target account must exist in the COA mirror for this shop/realm and be LIVE.
  SELECT account_type, deleted_at INTO v_type, v_deleted
    FROM public.qbo_accounts
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND qbo_account_id = p_qbo_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_set_mapping: account % is not in the COA for shop % realm %',
      p_qbo_account_id, p_shop_id, p_realm_id;
  END IF;
  IF v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'qteklink_set_mapping: account % is soft-deleted (not live) — cannot map to it', p_qbo_account_id;
  END IF;

  -- Role <-> account-type compatibility (checked BEFORE touching existing rows).
  IF NOT public.qteklink_role_accepts_type(p_posting_role, coalesce(v_type, '')) THEN
    RAISE EXCEPTION 'qteklink_set_mapping: posting_role % is not compatible with account type % (account %)',
      p_posting_role, coalesce(v_type, '(null)'), p_qbo_account_id;
  END IF;

  -- One active per source: deactivate the current active row (history kept).
  UPDATE public.qteklink_mappings
     SET active = false, updated_at = now()
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND kind = p_kind
     AND coalesce(source_id, source_key) = coalesce(v_src_id, v_src_key)
     AND active;

  INSERT INTO public.qteklink_mappings (
    shop_id, realm_id, kind, source_key, source_id, qbo_account_id, posting_role, active, effective_from
  ) VALUES (
    p_shop_id, p_realm_id, p_kind, v_src_key, v_src_id, p_qbo_account_id, p_posting_role, true, now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_set_mapping(integer, text, text, text, text, text, text) IS
  'QTekLink: upsert ONE active mapping for a source — validates role<->account_type compat + account is live, atomically deactivates the prior active row, inserts the new active row, returns its id. service_role only.';

-- ─── Deactivate (unmap) one mapping, tenant-scoped ──────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_deactivate_mapping(
  p_shop_id  integer,
  p_realm_id text,
  p_id       uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 OR p_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_deactivate_mapping: positive p_shop_id + non-blank p_realm_id + p_id are required';
  END IF;
  UPDATE public.qteklink_mappings
     SET active = false, updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND active;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_deactivate_mapping(integer, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_deactivate_mapping(integer, text, uuid) TO service_role;
COMMENT ON FUNCTION public.qteklink_deactivate_mapping(integer, text, uuid) IS
  'QTekLink: deactivate (unmap) one mapping by id, scoped to shop+realm. Returns true if a currently-active row was deactivated. service_role only.';

COMMIT;
