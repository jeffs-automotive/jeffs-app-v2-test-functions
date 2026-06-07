-- =====================================================================
-- QTekLink C4 — qteklink_payment_state (payment-event reducer projection)
-- =====================================================================
-- 2026-06-06. Plan §2/§3/§5/§15-C4/§16-C4. The reducer (pure TS, in
-- qteklink-app/src/lib/payments/reducer.ts) consumes the append-only
-- qteklink_events ledger and PROJECTS the current DESIRED state of each payment,
-- ONE row per (shop_id, realm_id, payment_id). This is a MUTABLE projection
-- table (plan §3) — re-running the reducer recomputes each row from ALL of that
-- payment's events, so the upsert below is a wholesale replace (idempotent).
--
-- The payment model is empirically verified against 627 real Jeff's payment
-- events (keytag_webhook_events, shop 7476):
--   * SUCCEEDED  — amount POSITIVE cents, refund=false, voided=false.
--   * REFUND_SUCCEEDED — a SEPARATE data.id, amount NEGATIVE, applicationFee=null.
--   * VOIDED — the SAME data.id flipped (a 2nd event), amount unchanged (positive),
--     voided=true. The void event reuses the original paymentDate, so
--     tekmetric_event_at TIES the original — received_at breaks the tie (the void
--     is always received later: seconds, sometimes days). That ordering is what
--     makes `voided` terminal.
--
-- Money: BIGINT signed cents (cross-module-anchors.md A). signed_amount_cents keeps
-- the SOURCE sign (refund negative; a void KEEPS its positive face value — status
-- + voided_at drive the C6 suppress/reverse, per plan §5). signed_processing_fee_cents
-- = applicationFee (0 when null; the CC processing fee), hydrated from the original
-- even if a void arrives first.
--
-- Multi-tenant (plan §3/§14): shop_id + realm_id on every row + in the uniqueness
-- key. service_role bypasses RLS, so the DAL scopes shop_id+realm_id on every query;
-- pgTAP proves cross-shop + cross-realm isolation. Writes go ONLY through the
-- SECURITY DEFINER qteklink_upsert_payment_state RPC (mirrors C1 qbo_accounts_sync) —
-- service_role gets SELECT only (least privilege; the definer owns the write).
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_payment_state (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     integer     NOT NULL,
  realm_id                    text        NOT NULL,
  payment_id                  bigint      NOT NULL,          -- data.id (refund has its OWN id; void reuses the original's)
  signed_amount_cents         bigint      NOT NULL,          -- source-signed cents (refund negative; void keeps face value)
  signed_processing_fee_cents bigint      NOT NULL DEFAULT 0,-- applicationFee (CC fee); 0 when null
  status                      text        NOT NULL,          -- 'succeeded' | 'voided' (voided is terminal)
  is_refund                   boolean     NOT NULL DEFAULT false,
  payment_type                text,                          -- paymentType.code (CC/CASH/CHK/OTH/AFFIRM)
  other_payment_type          text,                          -- otherPaymentType.name (for OTH non-cash)
  payment_date                timestamptz,                   -- the payment's business date (tekmetric_event_at)
  voided_at                   timestamptz,                   -- the void event's received_at (OBSERVED time; null unless voided)
  repair_order_id             bigint,                        -- data.repairOrderId (correlation to the RO sale)
  latest_event_at             timestamptz,                   -- max received_at = latest OBSERVED activity (settle window, C8; monotonic upsert key)
  reduced_from_event_ids      uuid[]      NOT NULL DEFAULT '{}', -- qteklink_events.id values that fed this state (audit)
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_payment_state_shop_realm_payment_key
    UNIQUE (shop_id, realm_id, payment_id),
  CONSTRAINT qteklink_payment_state_shop_positive    CHECK (shop_id > 0),
  CONSTRAINT qteklink_payment_state_realm_nonblank   CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_payment_state_payment_positive CHECK (payment_id > 0),
  CONSTRAINT qteklink_payment_state_status_valid     CHECK (status IN ('succeeded','voided')),
  -- The processing fee (applicationFee) is never negative (0 when null/cash/OTH).
  CONSTRAINT qteklink_payment_state_fee_nonneg       CHECK (signed_processing_fee_cents >= 0),
  -- A voided row records WHEN; a non-voided row never carries a voided_at.
  CONSTRAINT qteklink_payment_state_voided_consistent CHECK (
    (status = 'voided'    AND voided_at IS NOT NULL) OR
    (status = 'succeeded' AND voided_at IS NULL)
  )
);

-- RO correlation lookup (C5/C6: "the payments for this RO's sale").
CREATE INDEX IF NOT EXISTS qteklink_payment_state_shop_realm_ro
  ON public.qteklink_payment_state (shop_id, realm_id, repair_order_id)
  WHERE repair_order_id IS NOT NULL;

COMMENT ON TABLE public.qteklink_payment_state IS
  'QTekLink reducer projection: ONE desired-state row per (shop_id, realm_id, payment_id), computed from the append-only qteklink_events ledger. Mutable (recomputed wholesale each reduce). signed_amount_cents keeps the source sign (refund negative; void keeps face value, status=voided drives the C6 reversal). Writes via qteklink_upsert_payment_state (SECURITY DEFINER) only; service_role SELECT.';

-- service_role only. RLS enabled; writes flow through the definer RPC (least privilege).
ALTER TABLE public.qteklink_payment_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payment_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payment_state TO service_role;

-- ─── Bulk upsert a reduced payment-state batch for one (shop, realm) ─────────
-- Mirrors qbo_accounts_sync (20260605060000 / 20260606000000): tenant keys are
-- RPC args (server-derived in the DAL), the rows come as a JSON array, conflict
-- on the (shop, realm, payment_id) uniqueness key, return rows affected. The
-- reducer recomputes a payment from ALL its events, so DO UPDATE replaces every
-- projected field (a later void flips status to 'voided' in place).
CREATE OR REPLACE FUNCTION public.qteklink_upsert_payment_state(
  p_shop_id  integer,
  p_realm_id text,
  p_states   jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_payment_state: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_states IS NULL OR jsonb_typeof(p_states) <> 'array' THEN
    RAISE EXCEPTION 'qteklink_upsert_payment_state: p_states must be a JSON array';
  END IF;

  -- Serialize concurrent reductions for this (shop, realm) — e.g. the nightly
  -- cron (C8) overlapping a manual re-reduce. Transaction-scoped.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_realm_id, 0));

  INSERT INTO public.qteklink_payment_state (
    shop_id, realm_id, payment_id, signed_amount_cents, signed_processing_fee_cents,
    status, is_refund, payment_type, other_payment_type, payment_date, voided_at,
    repair_order_id, latest_event_at, reduced_from_event_ids, updated_at
  )
  SELECT
    p_shop_id, p_realm_id, s.payment_id, s.signed_amount_cents,
    coalesce(s.signed_processing_fee_cents, 0),
    s.status, coalesce(s.is_refund, false), s.payment_type, s.other_payment_type,
    s.payment_date, s.voided_at, s.repair_order_id, s.latest_event_at,
    CASE
      WHEN s.reduced_from_event_ids IS NULL THEN '{}'::uuid[]
      ELSE ARRAY(SELECT jsonb_array_elements_text(s.reduced_from_event_ids)::uuid)
    END,
    now()
  FROM jsonb_to_recordset(p_states) AS s(
    payment_id                  bigint,
    signed_amount_cents         bigint,
    signed_processing_fee_cents bigint,
    status                      text,
    is_refund                   boolean,
    payment_type                text,
    other_payment_type          text,
    payment_date                timestamptz,
    voided_at                   timestamptz,
    repair_order_id             bigint,
    latest_event_at             timestamptz,
    reduced_from_event_ids      jsonb
  )
  WHERE s.payment_id IS NOT NULL AND s.payment_id > 0
    AND s.signed_amount_cents IS NOT NULL
    AND s.status IN ('succeeded','voided')
  ON CONFLICT (shop_id, realm_id, payment_id) DO UPDATE
    SET signed_amount_cents         = EXCLUDED.signed_amount_cents,
        signed_processing_fee_cents = EXCLUDED.signed_processing_fee_cents,
        status                      = EXCLUDED.status,
        is_refund                   = EXCLUDED.is_refund,
        payment_type                = EXCLUDED.payment_type,
        other_payment_type          = EXCLUDED.other_payment_type,
        payment_date                = EXCLUDED.payment_date,
        voided_at                   = EXCLUDED.voided_at,
        repair_order_id             = EXCLUDED.repair_order_id,
        latest_event_at             = EXCLUDED.latest_event_at,
        reduced_from_event_ids      = EXCLUDED.reduced_from_event_ids,
        updated_at                  = now()
    -- MONOTONIC: only let a NEWER snapshot win. The DAL chooses its cutoff + reads
    -- events BEFORE this lock, so two concurrent reducers could read different
    -- snapshots; without this guard an older one (e.g. pre-void) could land last and
    -- overwrite a newer one (voided) back to succeeded. Comparing the observed
    -- watermark (latest_event_at = max received_at) makes the upsert order-independent
    -- (the snapshot that saw more activity wins; a void ALWAYS advances it).
    WHERE qteklink_payment_state.latest_event_at IS NULL
       OR EXCLUDED.latest_event_at IS NULL
       OR EXCLUDED.latest_event_at >= qteklink_payment_state.latest_event_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_payment_state(integer, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_payment_state(integer, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.qteklink_upsert_payment_state(integer, text, jsonb) IS
  'QTekLink C4: bulk-upsert a reduced payment-state batch for one (shop_id, realm_id) from a JSON array, conflict on (shop,realm,payment_id); returns rows affected. Skips rows with a non-positive payment_id / null amount / invalid status. service_role only (writes go through this definer, not direct table grants).';

COMMIT;
