-- =====================================================================
-- QTekLink — qteklink_customers (Tekmetric customer-name cache)
-- =====================================================================
-- 2026-06-16. Feature qteklink-je-line-descriptions
-- (docs/qteklink/je-line-descriptions-2026-06-16-plan.md).
--
-- The daily payment/fee JE lines need the CUSTOMER NAME, but the Tekmetric
-- webhook payload (qteklink_events.raw_body.data) carries only `customerId`,
-- never the name. This is a small read-through CACHE of customerId -> name,
-- populated best-effort from GET /customers/{id} (qteklink-app
-- src/lib/dal/customers.ts ensureCustomerNames). The JE build reads ONLY this
-- cache (deterministic — the line description, and thus the daily source-state
-- hash, never depends on live API timing).
--
-- One row per (shop_id, tekmetric_customer_id). shop_id is the Tekmetric shopId
-- (7476 for Jeff's), matching qteklink_payment_state. NOT realm-scoped: a
-- customer's name is a shop-level fact, independent of which QBO realm posts.
--
-- Multi-tenant: service_role bypasses RLS; the DAL scopes shop_id on every
-- query. Writes flow ONLY through the SECURITY DEFINER qteklink_upsert_customers
-- RPC (least privilege — service_role gets SELECT only), mirroring
-- qteklink_upsert_payment_state (20260606070000). Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_customers (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                integer     NOT NULL,
  tekmetric_customer_id  bigint      NOT NULL,          -- Tekmetric data.customerId
  display_name           text,                          -- resolved label (null until/if resolvable)
  first_name             text,                          -- raw Tekmetric firstName (commercial: company name)
  last_name              text,                          -- raw Tekmetric lastName
  fetched_at             timestamptz NOT NULL DEFAULT now(),  -- last successful resolve
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_customers_shop_customer_key
    UNIQUE (shop_id, tekmetric_customer_id),
  CONSTRAINT qteklink_customers_shop_positive     CHECK (shop_id > 0),
  CONSTRAINT qteklink_customers_customer_positive CHECK (tekmetric_customer_id > 0)
);

COMMENT ON TABLE public.qteklink_customers IS
  'QTekLink Tekmetric customer-name cache: ONE row per (shop_id, tekmetric_customer_id), display_name resolved best-effort from GET /customers/{id}. The daily JE build reads this cache only (keeps the line description + source-state hash deterministic). Writes via qteklink_upsert_customers (SECURITY DEFINER) only; service_role SELECT.';

-- service_role only. RLS enabled; writes flow through the definer RPC (least privilege).
ALTER TABLE public.qteklink_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_customers FROM PUBLIC, anon, authenticated;
-- service_role retains ALL by default (ALTER DEFAULT PRIVILEGES grants it on new public
-- tables, and the REVOKE above doesn't touch service_role) — explicitly strip writes so the
-- ONLY write path is the definer RPC below (matches qteklink_projection_state / _daily_postings).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_customers FROM service_role;
GRANT SELECT ON public.qteklink_customers TO service_role;

-- ─── Bulk upsert resolved customer names for one shop ───────────────────────
-- Mirrors qteklink_upsert_payment_state: tenant key is an RPC arg (server-derived
-- in the DAL), rows come as a JSON array, conflict on (shop_id, tekmetric_customer_id),
-- return rows affected. A re-fetch refreshes the name + fetched_at.
CREATE OR REPLACE FUNCTION public.qteklink_upsert_customers(
  p_shop_id   integer,
  p_customers jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_customers: a positive p_shop_id is required';
  END IF;
  IF p_customers IS NULL OR jsonb_typeof(p_customers) <> 'array' THEN
    RAISE EXCEPTION 'qteklink_upsert_customers: p_customers must be a JSON array';
  END IF;

  INSERT INTO public.qteklink_customers (
    shop_id, tekmetric_customer_id, display_name, first_name, last_name, fetched_at, updated_at
  )
  SELECT
    p_shop_id, c.tekmetric_customer_id, c.display_name, c.first_name, c.last_name, now(), now()
  FROM jsonb_to_recordset(p_customers) AS c(
    tekmetric_customer_id bigint,
    display_name          text,
    first_name            text,
    last_name             text
  )
  WHERE c.tekmetric_customer_id IS NOT NULL AND c.tekmetric_customer_id > 0
  ON CONFLICT (shop_id, tekmetric_customer_id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        first_name   = EXCLUDED.first_name,
        last_name    = EXCLUDED.last_name,
        fetched_at   = now(),
        updated_at   = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_customers(integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_customers(integer, jsonb) TO service_role;

COMMENT ON FUNCTION public.qteklink_upsert_customers(integer, jsonb) IS
  'QTekLink: bulk-upsert resolved customer names for one shop_id from a JSON array [{tekmetric_customer_id, display_name, first_name, last_name}], conflict on (shop_id, tekmetric_customer_id); returns rows affected. service_role only (writes go through this definer, not direct table grants).';

COMMIT;
