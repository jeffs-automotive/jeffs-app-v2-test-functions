-- =====================================================================
-- QTekLink — resolution workflow: failed-state exits + payment-redate queue
-- =====================================================================
-- 2026-07-02. Feature qteklink-resolution-workflow
-- (docs/qteklink/resolution-workflow-plan-2026-07-01.md; incident 2026-06-29).
--
-- A failed daily posting had NO exit: the diff skips failed+unchanged-hash
-- (correct — never re-hammer QBO), but no RPC/button could ever retry or
-- terminally settle one, so a deposit-locked correction locked its day FOREVER
-- while the fix-it list (a separate queue) sat empty. This migration adds the
-- missing state machinery, in LOCK-STEP (store-credit lesson: widen EVERY
-- constraining object in one migration):
--
--   1. status CHECK gains 'accepted' — variance accepted by a human: QBO is
--      intentionally left as-is; terminal like rejected, but remembered as a
--      deliberate decision (statusToColumn maps it OUT of needs-attention).
--   2. qteklink_retry_daily_posting   : failed -> approved (the human retry —
--      "I unlinked the deposit"; the poster's claim-time recheck still guards).
--   3. qteklink_accept_daily_variance : failed -> accepted ("keep QBO as-is").
--   4. qteklink_reject_daily_posting  : widened to ALSO take failed -> rejected
--      (system obsoletion of a moot correction — desired matches posted again,
--      e.g. after a late payment is voided, or a descriptions-only delta).
--   5. qteklink_payment_redates — Chris's late-payment queue (mirror of
--      qteklink_ro_date_moves): a payment landing on a day whose payments JE is
--      already posted is HELD out of that day + the office is emailed ONCE
--      ("Void this payment: $X on RO #### — take it on a different day");
--      auto-RESOLVES when the payment is voided/re-dated in Tekmetric.
--   6. qteklink_auto_resolve_review_items — batch system-close of review items
--      whose condition provably cleared (reconcile convergence / retry success /
--      accept / redate resolution).
--
-- Multi-tenant: shop_id + realm_id everywhere; deny-all RLS; writes via
-- SECURITY DEFINER RPCs. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── 1. Widen the daily-postings status enum with 'accepted' ─────────────────
ALTER TABLE public.qteklink_daily_postings
  DROP CONSTRAINT IF EXISTS qteklink_daily_postings_status_valid;
ALTER TABLE public.qteklink_daily_postings
  ADD CONSTRAINT qteklink_daily_postings_status_valid
  CHECK (status IN ('pending','approved','posting','posted','needs_resolution','rejected','failed','acknowledged','accepted'));

-- ─── 2. Retry a FAILED daily posting (failed -> approved; the human retry) ────
-- "I unlinked the deposit — retry now": same version, same content, same
-- requestid (content is hash-verified unchanged by the DAL dry-run/execute
-- binding). The poster's claim-time staleness recheck remains the last guard.
CREATE OR REPLACE FUNCTION public.qteklink_retry_daily_posting(
  p_shop_id integer, p_realm_id text, p_id uuid, p_retried_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_retried_by IS NULL OR length(btrim(p_retried_by)) = 0
     OR p_shop_id IS NULL OR p_realm_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_retry_daily_posting: p_id + non-blank p_retried_by + shop/realm are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'approved', approved_by = p_retried_by, approved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'failed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_retry_daily_posting(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_retry_daily_posting(integer, text, uuid, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_retry_daily_posting(integer, text, uuid, text) IS
  'QTekLink: human retry of a FAILED daily posting (failed -> approved; the click is the approval — Pattern S dry-run/execute in the DAL binds it to unchanged content). The daily poster then claims + posts it. service_role only.';

-- ─── 3. Accept the variance (failed -> accepted; terminal human decision) ─────
-- "Keep QuickBooks as-is": the correction is intentionally NOT posted; the day
-- stops counting it as needs-attention but the version stays in history. A later
-- REAL source change still stages v(N+1) (the diff treats accepted like
-- failed/rejected: unchanged hash -> skip, changed hash -> new version).
CREATE OR REPLACE FUNCTION public.qteklink_accept_daily_variance(
  p_shop_id integer, p_realm_id text, p_id uuid, p_accepted_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_accepted_by IS NULL OR length(btrim(p_accepted_by)) = 0
     OR p_shop_id IS NULL OR p_realm_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_accept_daily_variance: p_id + non-blank p_accepted_by + shop/realm are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'accepted', approved_by = p_accepted_by, approved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'failed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_accept_daily_variance(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_accept_daily_variance(integer, text, uuid, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_accept_daily_variance(integer, text, uuid, text) IS
  'QTekLink: terminal human acceptance of a FAILED daily correction (failed -> accepted) — QuickBooks is intentionally left as-is; the day stops counting it as needs-attention; a later real source change still stages a new version. service_role only.';

-- ─── 4. Reject: widened to failed -> rejected (system obsoletion) ─────────────
-- Body identical to 20260610000000 except the from-set gains 'failed' — the
-- moot-correction obsoletion path ("desired matches posted again": a voided late
-- payment, or a descriptions-only delta) closes the stuck version as rejected.
CREATE OR REPLACE FUNCTION public.qteklink_reject_daily_posting(
  p_shop_id integer, p_realm_id text, p_id uuid, p_rejected_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_rejected_by IS NULL OR length(btrim(p_rejected_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_reject_daily_posting: p_id + non-blank p_rejected_by are required';
  END IF;
  UPDATE public.qteklink_daily_postings
     SET status = 'rejected', rejected_by = p_rejected_by, rejected_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status IN ('pending','approved','failed');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_reject_daily_posting(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_reject_daily_posting(integer, text, uuid, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_reject_daily_posting(integer, text, uuid, text) IS
  'QTekLink: reject/withdraw a daily posting version (pending/approved/failed -> rejected). failed -> rejected is the SYSTEM obsoletion of a moot correction (desired state matches the posted JE again, or differs only cosmetically). service_role only.';

-- ─── 5. The payment-redate queue (Chris''s late-payment flow) ─────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_payment_redates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          integer     NOT NULL,
  realm_id         text        NOT NULL,
  payment_id       bigint      NOT NULL,
  tekmetric_ro_id  bigint,               -- null for an unattached (store-credit-issuance) payment
  ro_number        text,
  customer_name    text,
  amount_cents     bigint      NOT NULL,
  -- the ALREADY-POSTED business day the payment landed on (shop-local).
  business_date    date        NOT NULL,
  -- pending  -> awaiting the void/re-date in Tekmetric (the payment is HELD OUT
  --             of the posted day''s desired state — no correction stages)
  -- approved -> admin chose "post it to this day anyway" (the hold lifts; the
  --             normal correction flow takes over)
  -- resolved -> the payment was voided / no longer lands on this day
  status           text        NOT NULL DEFAULT 'pending',
  detected_at      timestamptz NOT NULL DEFAULT now(),
  notified_at      timestamptz,
  approved_by      text,
  approved_at      timestamptz,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_payment_redates_shop_positive  CHECK (shop_id > 0),
  CONSTRAINT qteklink_payment_redates_realm_nonblank CHECK (length(btrim(realm_id)) > 0),
  CONSTRAINT qteklink_payment_redates_payment_positive CHECK (payment_id > 0),
  CONSTRAINT qteklink_payment_redates_status_valid   CHECK (status IN ('pending','approved','resolved')),
  CONSTRAINT qteklink_payment_redates_conn_fk FOREIGN KEY (shop_id, realm_id)
    REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT
);

-- One OPEN (pending/approved) redate per payment; resolved rows keep history.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_payment_redates_open_identity
  ON public.qteklink_payment_redates (shop_id, realm_id, payment_id)
  WHERE status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS qteklink_payment_redates_status
  ON public.qteklink_payment_redates (shop_id, realm_id, status, detected_at);

COMMENT ON TABLE public.qteklink_payment_redates IS
  'QTekLink late-payment queue (Chris 2026-07-01): a payment dated to a business day whose payments JE is already POSTED. pending = the payment is held out of that day + the office was emailed to void + re-date it in Tekmetric; approved = admin chose to post it to the day anyway (hold lifted); resolved = the payment was voided / re-dated.';

ALTER TABLE public.qteklink_payment_redates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payment_redates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payment_redates TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payment_redates FROM service_role;

-- Upsert a detected late payment. INSERTs a new pending row (changed=true — the
-- caller sends THE one email + stamps notified_at), or refreshes a PENDING row''s
-- amount/RO metadata (changed only when a value moved — no nightly re-emails).
CREATE OR REPLACE FUNCTION public.qteklink_upsert_payment_redate(
  p_shop_id integer, p_realm_id text, p_payment_id bigint, p_tekmetric_ro_id bigint,
  p_ro_number text, p_customer_name text, p_amount_cents bigint, p_business_date date
)
RETURNS TABLE (id uuid, changed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing public.qteklink_payment_redates;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0
     OR p_payment_id IS NULL OR p_payment_id <= 0
     OR p_amount_cents IS NULL OR p_business_date IS NULL THEN
    RAISE EXCEPTION 'qteklink_upsert_payment_redate: shop/realm/payment/amount/business_date are required';
  END IF;

  SELECT * INTO v_existing FROM public.qteklink_payment_redates r
   WHERE r.shop_id = p_shop_id AND r.realm_id = p_realm_id
     AND r.payment_id = p_payment_id
     AND r.status IN ('pending','approved')
   LIMIT 1;

  IF v_existing.id IS NULL THEN
    RETURN QUERY
      INSERT INTO public.qteklink_payment_redates
        (shop_id, realm_id, payment_id, tekmetric_ro_id, ro_number, customer_name, amount_cents, business_date)
      VALUES (p_shop_id, p_realm_id, p_payment_id, p_tekmetric_ro_id, p_ro_number, p_customer_name,
              p_amount_cents, p_business_date)
      RETURNING qteklink_payment_redates.id, true;
  ELSIF v_existing.status = 'pending'
        AND (v_existing.amount_cents IS DISTINCT FROM p_amount_cents
             OR v_existing.business_date IS DISTINCT FROM p_business_date) THEN
    UPDATE public.qteklink_payment_redates r
       SET amount_cents = p_amount_cents,
           business_date = p_business_date,
           tekmetric_ro_id = coalesce(p_tekmetric_ro_id, r.tekmetric_ro_id),
           ro_number = coalesce(p_ro_number, r.ro_number),
           customer_name = coalesce(p_customer_name, r.customer_name),
           updated_at = now()
     WHERE r.id = v_existing.id;
    RETURN QUERY SELECT v_existing.id, true;
  ELSE
    -- Metadata-only enrichment (RO#/customer resolved later) never re-emails.
    UPDATE public.qteklink_payment_redates r
       SET tekmetric_ro_id = coalesce(p_tekmetric_ro_id, r.tekmetric_ro_id),
           ro_number = coalesce(p_ro_number, r.ro_number),
           customer_name = coalesce(p_customer_name, r.customer_name),
           updated_at = now()
     WHERE r.id = v_existing.id
       AND (r.tekmetric_ro_id IS DISTINCT FROM coalesce(p_tekmetric_ro_id, r.tekmetric_ro_id)
            OR r.ro_number IS DISTINCT FROM coalesce(p_ro_number, r.ro_number)
            OR r.customer_name IS DISTINCT FROM coalesce(p_customer_name, r.customer_name));
    RETURN QUERY SELECT v_existing.id, false;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_payment_redate(integer, text, bigint, bigint, text, text, bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_payment_redate(integer, text, bigint, bigint, text, text, bigint, date) TO service_role;

-- Stamp the ONE notification (idempotent: only if not yet stamped).
CREATE OR REPLACE FUNCTION public.qteklink_mark_payment_redate_notified(
  p_shop_id integer, p_realm_id text, p_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_mark_payment_redate_notified: p_id is required';
  END IF;
  UPDATE public.qteklink_payment_redates
     SET notified_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND notified_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_mark_payment_redate_notified(integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_mark_payment_redate_notified(integer, text, uuid) TO service_role;

-- Approve: "post it to this day anyway" (pending -> approved; the hold lifts and
-- the normal correction flow stages/attempts the update).
CREATE OR REPLACE FUNCTION public.qteklink_approve_payment_redate(
  p_shop_id integer, p_realm_id text, p_id uuid, p_approved_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL OR p_approved_by IS NULL OR length(btrim(p_approved_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_approve_payment_redate: p_id + non-blank p_approved_by are required';
  END IF;
  UPDATE public.qteklink_payment_redates
     SET status = 'approved', approved_by = p_approved_by, approved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_approve_payment_redate(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_approve_payment_redate(integer, text, uuid, text) TO service_role;

-- Resolve: the payment was voided / no longer lands on the posted day.
CREATE OR REPLACE FUNCTION public.qteklink_resolve_payment_redate(
  p_shop_id integer, p_realm_id text, p_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_resolve_payment_redate: p_id is required';
  END IF;
  UPDATE public.qteklink_payment_redates
     SET status = 'resolved', resolved_at = now(), updated_at = now()
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status IN ('pending','approved');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_resolve_payment_redate(integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_resolve_payment_redate(integer, text, uuid) TO service_role;

-- ─── 5b. Delete a manual payment pick (kills the manual_payment_conflict zombie) ─
-- A manual method-pick whose RO later received a REAL payment is suppressed by the
-- reconcile (never double-posts) but could NEVER be removed in-app — the conflict
-- item re-spawned after every resolve, forever. Deleting the pick is safe ONLY
-- while no posted day-JE references it: the guard refuses when the pick's id
-- appears in any posted/posting/approved daily posting's constituents.
CREATE OR REPLACE FUNCTION public.qteklink_delete_manual_payment(
  p_shop_id integer, p_realm_id text, p_id uuid, p_deleted_by text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_id IS NULL OR p_deleted_by IS NULL OR length(btrim(p_deleted_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_delete_manual_payment: p_id + non-blank p_deleted_by are required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.qteklink_daily_postings dp
     WHERE dp.shop_id = p_shop_id AND dp.realm_id = p_realm_id
       AND dp.status IN ('posted','posting','approved')
       AND dp.constituents->'payment_ids' @> to_jsonb(ARRAY[p_id::text])
  ) THEN
    RAISE EXCEPTION 'qteklink_delete_manual_payment: pick % is part of a posted/in-flight journal entry — it cannot be deleted', p_id;
  END IF;
  DELETE FROM public.qteklink_manual_payments
   WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_delete_manual_payment(integer, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_delete_manual_payment(integer, text, uuid, text) TO service_role;
COMMENT ON FUNCTION public.qteklink_delete_manual_payment(integer, text, uuid, text) IS
  'QTekLink: delete a manual payment method-pick (the manual_payment_conflict resolution — a real payment arrived, the pick must go). Refuses while the pick is a constituent of a posted/in-flight daily JE. service_role only.';

-- ─── 6. Batch system-close of review items (convergence) ─────────────────────
-- Close OPEN review items by id when the system can PROVE the condition cleared
-- (reconcile re-detection absence, an active mapping now existing, a successful
-- retry, an accepted variance, a resolved redate). Mirrors
-- qteklink_resolve_review_item semantics; ids keep the predicate in the DAL.
CREATE OR REPLACE FUNCTION public.qteklink_auto_resolve_review_items(
  p_shop_id integer, p_realm_id text, p_ids uuid[], p_resolved_by text, p_resolution jsonb DEFAULT '{}'::jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0
     OR p_ids IS NULL OR p_resolved_by IS NULL OR length(btrim(p_resolved_by)) = 0 THEN
    RAISE EXCEPTION 'qteklink_auto_resolve_review_items: shop/realm/ids/resolved_by are required';
  END IF;
  UPDATE public.qteklink_review_items
     SET status = 'resolved', resolved_at = now(), resolved_by = p_resolved_by,
         resolution = coalesce(p_resolution, '{}'::jsonb), updated_at = now()
   WHERE shop_id = p_shop_id AND realm_id = p_realm_id
     AND id = ANY(p_ids) AND status = 'open';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_auto_resolve_review_items(integer, text, uuid[], text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_auto_resolve_review_items(integer, text, uuid[], text, jsonb) TO service_role;
COMMENT ON FUNCTION public.qteklink_auto_resolve_review_items(integer, text, uuid[], text, jsonb) IS
  'QTekLink: batch SYSTEM resolution of open review items whose condition provably cleared (reconcile convergence / retry success / accepted variance / resolved redate). Ids only — the proving predicate lives in the DAL. service_role only.';

COMMIT;
