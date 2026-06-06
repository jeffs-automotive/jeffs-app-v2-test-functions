-- =====================================================================
-- QTekLink C1 — qbo_accounts (Chart-of-Accounts mirror) + sync RPC
-- =====================================================================
-- 2026-06-05. Mirrors the connected QBO company's chart of accounts so the
-- mapping UI (C2) can resolve Tekmetric lines -> QBO accounts and the posting
-- layer can validate targets at post-time (plan §8h). Shop+realm scoped per
-- plan §3 (`shop_id`+`realm_id` on every table); UNIQUE(shop_id, realm_id,
-- qbo_account_id) — QBO account ids are realm-specific.
--
-- Security mirrors 20260602140000_qbo_connections.sql: service_role-only
-- (deny-all RLS). The COA is read by the mapping UI via the service-role DAL
-- (tenant-scoped in code); it never reaches the browser directly.
--
-- Refresh is manual (admin "Refresh COA" button -> syncQboAccounts DAL ->
-- qbo_accounts_sync). Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qbo_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              integer     NOT NULL,
  realm_id             text        NOT NULL,
  qbo_account_id       text        NOT NULL,
  name                 text        NOT NULL,
  fully_qualified_name text,
  account_type         text,
  account_sub_type     text,
  classification       text,
  active               boolean     NOT NULL DEFAULT true,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qbo_accounts_shop_realm_acct_key UNIQUE (shop_id, realm_id, qbo_account_id),
  CONSTRAINT qbo_accounts_realm_not_blank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qbo_accounts_acct_not_blank  CHECK (length(btrim(qbo_account_id)) > 0)
);

COMMENT ON TABLE public.qbo_accounts IS
  'QTekLink Chart-of-Accounts mirror (one row per QBO Account, per shop+realm). UNIQUE(shop_id, realm_id, qbo_account_id) — QBO ids are realm-specific. Manual refresh via qbo_accounts_sync; the mapping UI + post-time validation read it. service_role only.';

-- service_role only. RLS enabled, no policy -> deny anon + authenticated.
ALTER TABLE public.qbo_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qbo_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_accounts TO service_role;

-- ─── Bulk upsert a refreshed COA for one (shop, realm) ──────────────────
-- Takes the accounts as a JSON array (one object per QBO Account). Upserts by
-- (shop_id, realm_id, qbo_account_id), refreshing synced_at. Returns the number
-- of rows affected. Tenant keys are RPC args (server-derived in the DAL), never
-- from the client. Note: this upserts the accounts present in the payload; it
-- does NOT deactivate accounts absent from it (deactivation handling is a later
-- refinement — post-time validation §8h re-checks active state).
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
  v_count integer;
BEGIN
  IF p_shop_id IS NULL OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qbo_accounts_sync: p_shop_id + p_realm_id are required';
  END IF;
  IF p_accounts IS NULL OR jsonb_typeof(p_accounts) <> 'array' THEN
    RAISE EXCEPTION 'qbo_accounts_sync: p_accounts must be a JSON array';
  END IF;

  INSERT INTO public.qbo_accounts (
    shop_id, realm_id, qbo_account_id, name, fully_qualified_name,
    account_type, account_sub_type, classification, active, synced_at, updated_at
  )
  SELECT
    p_shop_id, p_realm_id, a.qbo_account_id, a.name, a.fully_qualified_name,
    a.account_type, a.account_sub_type, a.classification,
    coalesce(a.active, true), now(), now()
  FROM jsonb_to_recordset(p_accounts) AS a(
    qbo_account_id       text,
    name                 text,
    fully_qualified_name text,
    account_type         text,
    account_sub_type     text,
    classification       text,
    active               boolean
  )
  WHERE a.qbo_account_id IS NOT NULL
    AND length(btrim(a.qbo_account_id)) > 0
    AND a.name IS NOT NULL
    AND length(btrim(a.name)) > 0
  ON CONFLICT (shop_id, realm_id, qbo_account_id) DO UPDATE
    SET name                 = EXCLUDED.name,
        fully_qualified_name = EXCLUDED.fully_qualified_name,
        account_type         = EXCLUDED.account_type,
        account_sub_type     = EXCLUDED.account_sub_type,
        classification       = EXCLUDED.classification,
        active               = EXCLUDED.active,
        synced_at            = now(),
        updated_at           = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qbo_accounts_sync(integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_accounts_sync(integer, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.qbo_accounts_sync(integer, text, jsonb) IS
  'QTekLink COA refresh: bulk-upsert the QBO accounts for one (shop_id, realm_id) from a JSON array; returns rows affected. service_role only. Skips entries with a blank id/name; does not deactivate accounts absent from the payload.';

COMMIT;
