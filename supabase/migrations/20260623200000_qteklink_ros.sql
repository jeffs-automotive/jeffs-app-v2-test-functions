-- =====================================================================
-- QTekLink — qteklink_ros (Tekmetric RO-number cache)
-- =====================================================================
-- 2026-06-23. Feature qteklink-payments-fixes
-- (docs/qteklink/payments-fixes-plan.md, Task 1).
--
-- The breakdown Payments tab resolves a payment's RO NUMBER from same-day sale
-- snapshots, then falls back to lookupRoMeta (qteklink_events ro_* events ->
-- keytag firehose). For FLEET / A-R-account CHECK payments ("Payment made by
-- Carmax", Kleen Tech, Flexicon, ...) the webhook is a payment-only event that
-- carries the RO id but NO RO object, and the original sale predates our event
-- capture — so the repairOrderNumber exists in NEITHER source and the row shows
-- "—". Live data (shop 7476, 2026-06-23): 81 of 130 distinct CHK RO ids are
-- unresolvable this way. The only source for those is Tekmetric itself.
--
-- This is a small read-through CACHE of tekmetric_ro_id -> repair_order_number,
-- populated best-effort from GET /repair-orders/{id} (qteklink-app
-- src/lib/dal/ro-numbers.ts), warmed by the nightly cron OFF the view/post path.
-- lookupRoMeta consults it CACHE-ONLY (deterministic — the daily JE line
-- descriptions / source-state hash never depend on live API timing).
--
-- One row per (shop_id, tekmetric_ro_id). shop_id is the Tekmetric shopId (7476
-- for Jeff's), matching qteklink_payment_state / qteklink_customers. NOT
-- realm-scoped: a repair order's number is a shop-level fact, independent of
-- which QBO realm posts (mirrors qteklink_customers, 20260616190000).
--
-- Multi-tenant: service_role bypasses RLS; the DAL scopes shop_id on every
-- query. Writes flow ONLY through the SECURITY DEFINER qteklink_upsert_ros RPC
-- (least privilege — service_role gets SELECT only), mirroring
-- qteklink_upsert_customers. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_ros (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              integer     NOT NULL,
  tekmetric_ro_id      bigint      NOT NULL,          -- Tekmetric data.repairOrderId
  repair_order_number  text,                          -- resolved human RO# (null until/if resolvable)
  fetched_at           timestamptz NOT NULL DEFAULT now(),  -- last successful resolve
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_ros_shop_ro_key
    UNIQUE (shop_id, tekmetric_ro_id),
  CONSTRAINT qteklink_ros_shop_positive CHECK (shop_id > 0),
  CONSTRAINT qteklink_ros_ro_positive   CHECK (tekmetric_ro_id > 0)
);

COMMENT ON TABLE public.qteklink_ros IS
  'QTekLink Tekmetric RO-number cache: ONE row per (shop_id, tekmetric_ro_id), repair_order_number resolved best-effort from GET /repair-orders/{id}. Closes the fleet/A-R check-payment "—" gap (the RO# is absent from our event ledgers). lookupRoMeta reads this cache only (keeps RO# resolution deterministic on the view/post path); the nightly cron warms it. Writes via qteklink_upsert_ros (SECURITY DEFINER) only; service_role SELECT.';

-- service_role only. RLS enabled; writes flow through the definer RPC (least privilege).
ALTER TABLE public.qteklink_ros ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_ros FROM PUBLIC, anon, authenticated;
-- Strip writes so the ONLY write path is the definer RPC below (matches qteklink_customers).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_ros FROM service_role;
GRANT SELECT ON public.qteklink_ros TO service_role;

-- ─── Bulk upsert resolved RO numbers for one shop ───────────────────────────
-- Mirrors qteklink_upsert_customers: tenant key is an RPC arg (server-derived in
-- the DAL), rows come as a JSON array, conflict on (shop_id, tekmetric_ro_id),
-- return rows affected. A re-fetch refreshes the number + fetched_at.
CREATE OR REPLACE FUNCTION public.qteklink_upsert_ros(
  p_shop_id integer,
  p_ros     jsonb
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
    RAISE EXCEPTION 'qteklink_upsert_ros: a positive p_shop_id is required';
  END IF;
  IF p_ros IS NULL OR jsonb_typeof(p_ros) <> 'array' THEN
    RAISE EXCEPTION 'qteklink_upsert_ros: p_ros must be a JSON array';
  END IF;

  INSERT INTO public.qteklink_ros (
    shop_id, tekmetric_ro_id, repair_order_number, fetched_at, updated_at
  )
  SELECT
    p_shop_id, r.tekmetric_ro_id, r.repair_order_number, now(), now()
  FROM jsonb_to_recordset(p_ros) AS r(
    tekmetric_ro_id     bigint,
    repair_order_number text
  )
  WHERE r.tekmetric_ro_id IS NOT NULL AND r.tekmetric_ro_id > 0
  ON CONFLICT (shop_id, tekmetric_ro_id) DO UPDATE
    SET repair_order_number = EXCLUDED.repair_order_number,
        fetched_at          = now(),
        updated_at          = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_ros(integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_ros(integer, jsonb) TO service_role;

COMMENT ON FUNCTION public.qteklink_upsert_ros(integer, jsonb) IS
  'QTekLink: bulk-upsert resolved RO numbers for one shop_id from a JSON array [{tekmetric_ro_id, repair_order_number}], conflict on (shop_id, tekmetric_ro_id); returns rows affected. service_role only (writes go through this definer, not direct table grants).';

COMMIT;
