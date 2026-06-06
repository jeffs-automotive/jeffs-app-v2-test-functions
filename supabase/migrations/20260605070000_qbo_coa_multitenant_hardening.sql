-- =====================================================================
-- QTekLink C1 hardening — multi-tenant shop->realm binding + COA integrity
-- =====================================================================
-- 2026-06-05. Cross-verify (GPT) flagged that the COA sync resolved the QBO
-- realm globally ("most recent connection") rather than the realm BOUND to the
-- shop — a cross-shop pollution risk once a 2nd shop exists. This migration
-- makes the binding explicit + DB-enforced, and folds in the rest of the review
-- sweep (advisory lock for concurrent refreshes, a sync-state row to tell
-- "never synced" from "synced 0", and table-level integrity CHECKs).
--
-- Scope note: `shop_id` on qbo_connections is left NULLABLE so the existing
-- connect flow (qbo-oauth-callback -> qbo_persist_tokens) + token-refresh path
-- are untouched; the single live connection is backfilled to Jeff's shop. The
-- connect flow writing shop_id on NEW connections is the multi-shop-ONBOARDING
-- task, deferred until a 2nd shop is added.
--
-- Apply: supabase db push. IDEMPOTENT (IF NOT EXISTS / guarded ALTERs).
-- =====================================================================

BEGIN;

-- ─── 1. Shop-scope the QBO connection (1:1 shop <-> realm) ──────────────
ALTER TABLE public.qbo_connections ADD COLUMN IF NOT EXISTS shop_id integer;

-- Backfill the single live connection -> Jeff's Tekmetric shop (seeded data).
UPDATE public.qbo_connections
   SET shop_id = 7476
 WHERE shop_id IS NULL
   AND realm_id = '9341455608740708';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qbo_connections_shop_realm_key') THEN
    ALTER TABLE public.qbo_connections
      ADD CONSTRAINT qbo_connections_shop_realm_key UNIQUE (shop_id, realm_id);
  END IF;
END $$;

COMMENT ON COLUMN public.qbo_connections.shop_id IS
  'Tekmetric shop that owns this QBO connection (1:1 shop<->realm). NULLABLE only for legacy/pre-onboarding rows; the connect flow sets it for new connections (multi-shop onboarding).';

-- ─── 2. Bind qbo_accounts to a real connection + harden invariants ──────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qbo_accounts_connection_fk') THEN
    ALTER TABLE public.qbo_accounts
      ADD CONSTRAINT qbo_accounts_connection_fk
      FOREIGN KEY (shop_id, realm_id)
      REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qbo_accounts_shop_id_positive') THEN
    ALTER TABLE public.qbo_accounts
      ADD CONSTRAINT qbo_accounts_shop_id_positive CHECK (shop_id > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qbo_accounts_name_not_blank') THEN
    ALTER TABLE public.qbo_accounts
      ADD CONSTRAINT qbo_accounts_name_not_blank CHECK (length(btrim(name)) > 0);
  END IF;
END $$;

-- ─── 3. COA sync-state — "never synced" vs "synced, 0 accounts" ─────────
CREATE TABLE IF NOT EXISTS public.qbo_coa_sync_state (
  shop_id        integer     NOT NULL,
  realm_id       text        NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  account_count  integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, realm_id),
  CONSTRAINT qbo_coa_sync_state_connection_fk
    FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE CASCADE
);
ALTER TABLE public.qbo_coa_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qbo_coa_sync_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_coa_sync_state TO service_role;
COMMENT ON TABLE public.qbo_coa_sync_state IS
  'QTekLink: one row per (shop_id, realm_id) recording the last COA refresh (time + count). Lets the dashboard tell "never synced" from "synced, 0 accounts". service_role only.';

-- ─── 4. Resolve the realm BOUND to a shop (multi-tenant safety) ─────────
CREATE OR REPLACE FUNCTION public.qbo_resolve_realm_for_shop(p_shop_id integer)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT realm_id FROM public.qbo_connections WHERE shop_id = p_shop_id LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.qbo_resolve_realm_for_shop(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_resolve_realm_for_shop(integer) TO service_role;
COMMENT ON FUNCTION public.qbo_resolve_realm_for_shop(integer) IS
  'QTekLink multi-tenant guard: resolve the QBO realm bound to a shop (never "most recent global"). Returns NULL when the shop has no connection. service_role only.';

-- ─── 5. qbo_accounts_sync: + advisory lock + sync-state (same signature) ─
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
  v_total integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qbo_accounts_sync: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_accounts IS NULL OR jsonb_typeof(p_accounts) <> 'array' THEN
    RAISE EXCEPTION 'qbo_accounts_sync: p_accounts must be a JSON array';
  END IF;

  -- Serialize concurrent refreshes for this (shop, realm) so a slower request
  -- carrying an OLDER QBO snapshot can't finish last and overwrite newer data.
  -- Transaction-scoped: auto-released at COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_realm_id, 0));

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

  -- Record the sync run (independent of how many rows changed) so the UI can
  -- distinguish "never synced" from "synced, returned 0 accounts".
  SELECT count(*) INTO v_total
    FROM public.qbo_accounts
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id;

  INSERT INTO public.qbo_coa_sync_state (shop_id, realm_id, last_synced_at, account_count)
  VALUES (p_shop_id, p_realm_id, now(), v_total)
  ON CONFLICT (shop_id, realm_id) DO UPDATE
    SET last_synced_at = now(), account_count = v_total;

  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qbo_accounts_sync(integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_accounts_sync(integer, text, jsonb) TO service_role;

COMMIT;
