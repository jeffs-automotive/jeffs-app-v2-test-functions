-- =====================================================================
-- QTekLink: payment-projection WATERMARK (live-page performance, Chris 2026-06-12)
-- =====================================================================
-- The live-on-view model re-reduced EVERY payment event (full webhook bodies) on
-- every page view — correct, but it grows forever. The fix is incremental: the
-- projection remembers the newest `received_at` it has fully reduced through
-- (per shop+realm), and each view only re-reduces payments that have NEWER
-- events (re-read with their FULL per-payment history, so the reduce stays
-- deterministic; a small overlap window absorbs clock skew / commit latency).
-- The nightly sync still runs a FULL reduce as the verification net.
--
--   - qteklink_projection_state: one row per (shop, realm) — the watermark.
--   - qteklink_advance_projection_watermark: MONOTONIC upsert (GREATEST) — a
--     concurrent slower reader can never move the mark backwards.
--   - Partial index on the events ledger for the newness probe + ordered reads.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_projection_state (
  shop_id                  integer     NOT NULL,
  realm_id                 text        NOT NULL,
  last_reduced_received_at timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shop_id, realm_id),
  CONSTRAINT qteklink_projection_state_conn_fk
    FOREIGN KEY (shop_id, realm_id) REFERENCES public.qbo_connections (shop_id, realm_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.qteklink_projection_state IS
  'Payment-state projection watermark per (shop, realm): the newest qteklink_events.received_at fully reduced. Incremental reduces only touch payments with newer events; the nightly full reduce re-anchors it. Advance ONLY via qteklink_advance_projection_watermark (monotonic).';

-- service_role reads; writes only through the RPC (the sibling-table convention).
ALTER TABLE public.qteklink_projection_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_projection_state FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_projection_state FROM service_role;
GRANT SELECT ON public.qteklink_projection_state TO service_role;

CREATE OR REPLACE FUNCTION public.qteklink_advance_projection_watermark(
  p_shop_id   integer,
  p_realm_id  text,
  p_watermark timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored timestamptz;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0
     OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0
     OR p_watermark IS NULL THEN
    RAISE EXCEPTION 'qteklink_advance_projection_watermark: shop, realm and watermark are required';
  END IF;

  INSERT INTO public.qteklink_projection_state (shop_id, realm_id, last_reduced_received_at, updated_at)
  VALUES (p_shop_id, p_realm_id, p_watermark, now())
  ON CONFLICT (shop_id, realm_id) DO UPDATE SET
    -- MONOTONIC: a slower concurrent reducer can never drag the mark backwards.
    last_reduced_received_at = GREATEST(public.qteklink_projection_state.last_reduced_received_at, EXCLUDED.last_reduced_received_at),
    updated_at               = now()
  RETURNING last_reduced_received_at INTO v_stored;
  RETURN v_stored;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_advance_projection_watermark(integer, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_advance_projection_watermark(integer, text, timestamptz) TO service_role;

-- The newness probe (`received_at > watermark` on payment events) + the ordered
-- snapshot reads, kept fast as the ledger grows.
CREATE INDEX IF NOT EXISTS qteklink_events_payment_received_idx
  ON public.qteklink_events (shop_id, realm_id, received_at)
  WHERE payment_id IS NOT NULL;

COMMIT;
