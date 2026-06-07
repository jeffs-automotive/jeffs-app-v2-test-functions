-- =====================================================================
-- QTekLink — qbo_accounts.acct_num (the QBO account NUMBER, e.g. "120")
-- =====================================================================
-- 2026-06-07. The COA mirror stored the QBO API Id (qbo_account_id, e.g. "235")
-- + the name, but NOT the user-facing ACCOUNT NUMBER (QBO Account.AcctNum, e.g.
-- "120"). Shop owners recognize accounts by that number — it's what QBO's own COA
-- UI leads with — and a JE references the Id while the human thinks in the number;
-- that mismatch caused a real "is the A/R account 120 or 235?" round-trip. Capture
-- AcctNum so the mapping UI can show "120 · ACCOUNTS RECEIVABLE".
--
-- Postings still reference the Id (qbo_account_id); acct_num is display /
-- recognition only and is NULLABLE (QBO AcctNum is optional — many system accounts
-- have none).
--
-- Extends the C1 true-mirror sync (20260606000000) by threading acct_num through
-- the recordset + upsert. The RPC signature (integer, text, jsonb) is UNCHANGED,
-- so no caller breaks and an older payload without acct_num simply lands NULL. The
-- full body is reproduced (CREATE OR REPLACE) to keep the soft-delete true-mirror
-- semantics intact.
--
-- Apply: supabase db push. IDEMPOTENT (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE).
-- =====================================================================

BEGIN;

ALTER TABLE public.qbo_accounts ADD COLUMN IF NOT EXISTS acct_num text;

COMMENT ON COLUMN public.qbo_accounts.acct_num IS
  'QBO Account.AcctNum — the user-facing account NUMBER (e.g. "120" for ACCOUNTS RECEIVABLE). Display / recognition only; postings reference qbo_account_id (the API Id). Nullable: QBO AcctNum is optional.';

CREATE OR REPLACE FUNCTION public.qbo_accounts_sync(
  p_shop_id  integer,
  p_realm_id text,
  p_accounts jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qbo_accounts_sync: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_accounts IS NULL OR jsonb_typeof(p_accounts) <> 'array' THEN
    RAISE EXCEPTION 'qbo_accounts_sync: p_accounts must be a JSON array';
  END IF;

  -- Serialize concurrent refreshes for this (shop, realm). Transaction-scoped.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_realm_id, 0));

  -- Upsert the current chart; a reappearing account is REVIVED (deleted_at NULL).
  INSERT INTO public.qbo_accounts (
    shop_id, realm_id, qbo_account_id, name, acct_num, fully_qualified_name,
    account_type, account_sub_type, classification, active, deleted_at, synced_at, updated_at
  )
  SELECT
    p_shop_id, p_realm_id, a.qbo_account_id, a.name, a.acct_num, a.fully_qualified_name,
    a.account_type, a.account_sub_type, a.classification, coalesce(a.active, true),
    NULL, now(), now()
  FROM jsonb_to_recordset(p_accounts) AS a(
    qbo_account_id       text,
    name                 text,
    acct_num             text,
    fully_qualified_name text,
    account_type         text,
    account_sub_type     text,
    classification       text,
    active               boolean
  )
  WHERE a.qbo_account_id IS NOT NULL AND length(btrim(a.qbo_account_id)) > 0
    AND a.name IS NOT NULL AND length(btrim(a.name)) > 0
  ON CONFLICT (shop_id, realm_id, qbo_account_id) DO UPDATE
    SET name                 = EXCLUDED.name,
        acct_num             = EXCLUDED.acct_num,
        fully_qualified_name = EXCLUDED.fully_qualified_name,
        account_type         = EXCLUDED.account_type,
        account_sub_type     = EXCLUDED.account_sub_type,
        classification       = EXCLUDED.classification,
        active               = EXCLUDED.active,
        deleted_at           = NULL,
        synced_at            = now(),
        updated_at           = now();

  -- TRUE MIRROR: soft-delete live rows no longer present in the full chart.
  UPDATE public.qbo_accounts t
     SET deleted_at = now(), updated_at = now()
   WHERE t.shop_id = p_shop_id AND t.realm_id = p_realm_id AND t.deleted_at IS NULL
     AND NOT EXISTS (
       SELECT 1
         FROM jsonb_to_recordset(p_accounts) AS a(qbo_account_id text, name text)
        WHERE a.qbo_account_id = t.qbo_account_id
          AND a.qbo_account_id IS NOT NULL AND length(btrim(a.qbo_account_id)) > 0
          AND a.name IS NOT NULL AND length(btrim(a.name)) > 0
     );

  -- Live count (the true current chart) -> sync-state.
  SELECT count(*) INTO v_live
    FROM public.qbo_accounts
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id AND deleted_at IS NULL;

  INSERT INTO public.qbo_coa_sync_state (shop_id, realm_id, last_synced_at, account_count)
  VALUES (p_shop_id, p_realm_id, now(), v_live)
  ON CONFLICT (shop_id, realm_id) DO UPDATE
    SET last_synced_at = now(), account_count = v_live;

  RETURN v_live;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qbo_accounts_sync(integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_accounts_sync(integer, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.qbo_accounts_sync(integer, text, jsonb) IS
  'QTekLink COA true-mirror refresh for one (shop_id, realm_id): upsert the full chart (incl. acct_num; reviving reappearing accounts), soft-delete accounts absent from the payload, record the LIVE count in qbo_coa_sync_state, and RETURN that live count. service_role only.';

COMMIT;
