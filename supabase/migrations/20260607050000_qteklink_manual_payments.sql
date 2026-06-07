-- =====================================================================
-- QTekLink C6 — qteklink_manual_payments (the method-pick storage)
-- =====================================================================
-- 2026-06-07. Plan §5. A paid RO's snapshot shows `amountPaid` (that it WAS paid)
-- but NOT how — the method lives only on the `payment_made` event. When a payment
-- webhook is missing (a Tekmetric ingestion outage, ~1% of paid ROs), the daily
-- approval lets the user PICK the method (card / cash / check / non-cash) + ENTER
-- the CC fee for a card. That pick is persisted here; the C6 payment-JE DAL builds
-- the deposit/non-cash JE from it (buildShopManualPaymentJe), routed identically to
-- a real payment_made.
--
-- Multi-tenant (plan §3): shop_id + realm_id on every row + the composite FK ->
-- qbo_connections (the DB refuses a pick for an unbound shop/realm). ONE active
-- pick per RO (a re-classification replaces it via the upsert). Money is BIGINT
-- cents. service_role-only (deny-all RLS); writes go through the SECURITY DEFINER
-- RPC (service_role gets SELECT only — least-privilege, the C4 pattern).
--
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qteklink_manual_payments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            integer     NOT NULL,
  realm_id           text        NOT NULL,
  repair_order_id    bigint      NOT NULL,
  method             text        NOT NULL,            -- paymentType: Credit Card / Cash / Check / Other
  other_payment_type text,                            -- non-cash sub-type (otherPaymentType.name)
  amount_cents       bigint      NOT NULL,            -- gross paid (the RO's amountPaid)
  cc_fee_cents       bigint      NOT NULL DEFAULT 0,  -- user-entered CC fee (card)
  payment_date       timestamptz NOT NULL,            -- the paid date (TxnDate source)
  created_by         text        NOT NULL,            -- the user who classified it (audit)
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_manual_payments_shop_positive  CHECK (shop_id > 0),
  CONSTRAINT qteklink_manual_payments_realm_nonblank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_manual_payments_method_nonblank CHECK (length(btrim(method)) > 0),
  CONSTRAINT qteklink_manual_payments_ro_positive    CHECK (repair_order_id > 0),
  CONSTRAINT qteklink_manual_payments_amount_nonneg  CHECK (amount_cents >= 0),
  CONSTRAINT qteklink_manual_payments_fee_nonneg     CHECK (cc_fee_cents >= 0),
  CONSTRAINT qteklink_manual_payments_one_per_ro UNIQUE (shop_id, realm_id, repair_order_id),
  CONSTRAINT qteklink_manual_payments_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.qteklink_manual_payments IS
  'QTekLink method-pick storage (plan §5): a user-classified payment for a paid RO with no payment_made event (method + CC fee). One per (shop,realm,repair_order_id); the C6 payment-JE builder routes it like a real payment. service_role only.';

ALTER TABLE public.qteklink_manual_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_manual_payments FROM PUBLIC, anon, authenticated;
-- service_role reads (DAL); writes go through the SECURITY DEFINER RPC below.
GRANT SELECT ON public.qteklink_manual_payments TO service_role;

-- ─── Upsert one manual-payment pick (one per RO; re-classify replaces) ──────
CREATE OR REPLACE FUNCTION public.qteklink_record_manual_payment(
  p_shop_id            integer,
  p_realm_id           text,
  p_repair_order_id    bigint,
  p_method             text,
  p_other_payment_type text,
  p_amount_cents       bigint,
  p_cc_fee_cents       bigint,
  p_payment_date       timestamptz,
  p_created_by         text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_record_manual_payment: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_repair_order_id IS NULL OR p_repair_order_id <= 0
     OR p_method IS NULL OR length(btrim(p_method)) = 0
     OR p_amount_cents IS NULL OR p_amount_cents < 0
     OR coalesce(p_cc_fee_cents, 0) < 0
     OR p_payment_date IS NULL
     OR p_created_by IS NULL OR length(btrim(p_created_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_record_manual_payment: ro_id, method, a non-negative amount/fee, payment_date and created_by are required';
  END IF;

  INSERT INTO public.qteklink_manual_payments (
    shop_id, realm_id, repair_order_id, method, other_payment_type,
    amount_cents, cc_fee_cents, payment_date, created_by, updated_at
  ) VALUES (
    p_shop_id, p_realm_id, p_repair_order_id, btrim(p_method), nullif(btrim(coalesce(p_other_payment_type, '')), ''),
    p_amount_cents, coalesce(p_cc_fee_cents, 0), p_payment_date, p_created_by, now()
  )
  ON CONFLICT (shop_id, realm_id, repair_order_id) DO UPDATE
    SET method             = EXCLUDED.method,
        other_payment_type = EXCLUDED.other_payment_type,
        amount_cents       = EXCLUDED.amount_cents,
        cc_fee_cents       = EXCLUDED.cc_fee_cents,
        payment_date       = EXCLUDED.payment_date,
        created_by         = EXCLUDED.created_by,
        updated_at         = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_record_manual_payment(integer, text, bigint, text, text, bigint, bigint, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_record_manual_payment(integer, text, bigint, text, text, bigint, bigint, timestamptz, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_record_manual_payment(integer, text, bigint, text, text, bigint, bigint, timestamptz, text) IS
  'QTekLink: upsert ONE manual-payment pick per (shop,realm,repair_order_id) — re-classifying an RO replaces it. service_role only.';

COMMIT;
