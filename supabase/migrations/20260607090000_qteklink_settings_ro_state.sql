-- =====================================================================
-- QTekLink C8b — qteklink_settings + qteklink_ro_state (§3)
-- =====================================================================
-- 2026-06-08. Plan §3.
--   qteklink_settings — per (shop, realm) config: the human/auto-post gate
--     (auto_post default FALSE), the settle window, and the shop's tz + PA tax/tire
--     defaults (replaces the hardcoded DEFAULT_* in the daily-reconcile DAL — the
--     'qteklink_settings -> C8' TODO). One row per shop+realm.
--   qteklink_ro_state — per-RO projection: the last posted SALE JE id + SyncToken
--     (a JE UPDATE is a full balanced re-send under SyncToken, §13) + the source hash
--     (desired-vs-posted diff) + the last total/date. SALE JE only (payments are their
--     own postings). Unique (shop, realm, tekmetric_ro_id).
--
-- Multi-tenant: shop_id + realm_id + composite FK -> qbo_connections. service_role-only
-- (deny-all RLS); writes via the SECURITY DEFINER RPCs (default-privs write REVOKE
-- folded in). Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── qteklink_settings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_settings (
  shop_id              integer     NOT NULL,
  realm_id             text        NOT NULL,
  auto_post            boolean     NOT NULL DEFAULT false,
  settle_window_minutes integer    NOT NULL DEFAULT 0,
  shop_timezone        text        NOT NULL DEFAULT 'America/New_York',
  sales_tax_rate_bps   integer     NOT NULL DEFAULT 600,  -- PA 6.00%
  tire_fee_cents       integer     NOT NULL DEFAULT 100,  -- PA $1.00 / tire
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_settings_pk PRIMARY KEY (shop_id, realm_id),
  CONSTRAINT qteklink_settings_shop_positive  CHECK (shop_id > 0),
  CONSTRAINT qteklink_settings_realm_nonblank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_settings_settle_nonneg  CHECK (settle_window_minutes >= 0),
  CONSTRAINT qteklink_settings_tz_nonblank    CHECK (length(btrim(shop_timezone)) > 0),
  CONSTRAINT qteklink_settings_rate_nonneg    CHECK (sales_tax_rate_bps >= 0),
  CONSTRAINT qteklink_settings_tire_nonneg    CHECK (tire_fee_cents >= 0),
  CONSTRAINT qteklink_settings_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.qteklink_settings IS
  'QTekLink per (shop,realm) config (plan §3): auto_post gate (default false), settle window, shop tz + PA tax/tire defaults. service_role only; writes via the definer RPC.';

ALTER TABLE public.qteklink_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_settings TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_settings FROM service_role;

-- Upsert the settings (admin-edited; auto_post is a sensitive gate). Partial-update
-- semantics: a NULL arg leaves the existing value (or the default on first insert).
CREATE OR REPLACE FUNCTION public.qteklink_upsert_settings(
  p_shop_id integer,
  p_realm_id text,
  p_auto_post boolean,
  p_settle_window_minutes integer,
  p_shop_timezone text,
  p_sales_tax_rate_bps integer,
  p_tire_fee_cents integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_settle_window_minutes IS NOT NULL AND p_settle_window_minutes < 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: settle_window_minutes must be >= 0';
  END IF;
  IF (p_sales_tax_rate_bps IS NOT NULL AND p_sales_tax_rate_bps < 0)
     OR (p_tire_fee_cents IS NOT NULL AND p_tire_fee_cents < 0) THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: tax rate + tire fee must be >= 0';
  END IF;

  INSERT INTO public.qteklink_settings (
    shop_id, realm_id, auto_post, settle_window_minutes, shop_timezone, sales_tax_rate_bps, tire_fee_cents, updated_at
  )
  VALUES (
    p_shop_id, p_realm_id, coalesce(p_auto_post, false), coalesce(p_settle_window_minutes, 0),
    coalesce(nullif(btrim(p_shop_timezone), ''), 'America/New_York'),
    coalesce(p_sales_tax_rate_bps, 600), coalesce(p_tire_fee_cents, 100), now()
  )
  ON CONFLICT (shop_id, realm_id) DO UPDATE SET
    auto_post             = coalesce(p_auto_post, public.qteklink_settings.auto_post),
    settle_window_minutes = coalesce(p_settle_window_minutes, public.qteklink_settings.settle_window_minutes),
    shop_timezone         = coalesce(nullif(btrim(p_shop_timezone), ''), public.qteklink_settings.shop_timezone),
    sales_tax_rate_bps    = coalesce(p_sales_tax_rate_bps, public.qteklink_settings.sales_tax_rate_bps),
    tire_fee_cents        = coalesce(p_tire_fee_cents, public.qteklink_settings.tire_fee_cents),
    updated_at            = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer) TO service_role;

-- ─── qteklink_ro_state ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_ro_state (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             integer     NOT NULL,
  realm_id            text        NOT NULL,
  tekmetric_ro_id     bigint      NOT NULL,
  ro_number           text,
  last_total_cents    bigint,
  last_posted_date    date,
  source_snapshot_hash text,
  sale_qbo_je_id      text,
  sale_qbo_sync_token text,
  status              text        NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_ro_state_shop_positive  CHECK (shop_id > 0),
  CONSTRAINT qteklink_ro_state_realm_nonblank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_ro_state_ro_positive    CHECK (tekmetric_ro_id > 0),
  CONSTRAINT qteklink_ro_state_status_valid   CHECK (status IN ('pending','posted','needs_resolution')),
  CONSTRAINT qteklink_ro_state_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS qteklink_ro_state_identity
  ON public.qteklink_ro_state (shop_id, realm_id, tekmetric_ro_id);

COMMENT ON TABLE public.qteklink_ro_state IS
  'QTekLink per-RO SALE projection (plan §3): last posted SALE JE id + SyncToken (full-replacement update, §13) + source hash (desired-vs-posted diff). service_role only; writes via the definer RPC.';

ALTER TABLE public.qteklink_ro_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_ro_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_ro_state TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_ro_state FROM service_role;

-- Upsert the per-RO projection (the poster records the SALE JE id + SyncToken here).
CREATE OR REPLACE FUNCTION public.qteklink_upsert_ro_state(
  p_shop_id integer,
  p_realm_id text,
  p_tekmetric_ro_id bigint,
  p_ro_number text,
  p_last_total_cents bigint,
  p_last_posted_date date,
  p_source_snapshot_hash text,
  p_sale_qbo_je_id text,
  p_sale_qbo_sync_token text,
  p_status text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0
     OR p_tekmetric_ro_id IS NULL OR p_tekmetric_ro_id <= 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_ro_state: positive shop/ro id + non-blank realm are required';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('pending','posted','needs_resolution') THEN
    RAISE EXCEPTION 'qteklink_upsert_ro_state: invalid status %', p_status;
  END IF;

  INSERT INTO public.qteklink_ro_state (
    shop_id, realm_id, tekmetric_ro_id, ro_number, last_total_cents, last_posted_date,
    source_snapshot_hash, sale_qbo_je_id, sale_qbo_sync_token, status, updated_at
  )
  VALUES (
    p_shop_id, p_realm_id, p_tekmetric_ro_id, p_ro_number, p_last_total_cents, p_last_posted_date,
    p_source_snapshot_hash, p_sale_qbo_je_id, p_sale_qbo_sync_token, coalesce(p_status, 'pending'), now()
  )
  ON CONFLICT (shop_id, realm_id, tekmetric_ro_id) DO UPDATE SET
    ro_number            = coalesce(p_ro_number, public.qteklink_ro_state.ro_number),
    last_total_cents     = coalesce(p_last_total_cents, public.qteklink_ro_state.last_total_cents),
    last_posted_date     = coalesce(p_last_posted_date, public.qteklink_ro_state.last_posted_date),
    source_snapshot_hash = coalesce(p_source_snapshot_hash, public.qteklink_ro_state.source_snapshot_hash),
    sale_qbo_je_id       = coalesce(p_sale_qbo_je_id, public.qteklink_ro_state.sale_qbo_je_id),
    sale_qbo_sync_token  = coalesce(p_sale_qbo_sync_token, public.qteklink_ro_state.sale_qbo_sync_token),
    status               = coalesce(p_status, public.qteklink_ro_state.status),
    updated_at           = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_ro_state(integer, text, bigint, text, bigint, date, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_ro_state(integer, text, bigint, text, bigint, date, text, text, text, text) TO service_role;

COMMIT;
