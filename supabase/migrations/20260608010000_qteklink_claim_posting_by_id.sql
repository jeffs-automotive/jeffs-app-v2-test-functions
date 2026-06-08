-- =====================================================================
-- QTekLink — qteklink_claim_posting_by_id (scoped claim for the bulk approve+post)
-- =====================================================================
-- 2026-06-08. The approval-dashboard "Approve + post" bulk action posts the EXACT set
-- the admin confirmed (plan §6). The existing qteklink_claim_posting claims the "next"
-- approved posting of ANY scope — unsafe for a scoped bulk op (it could post a different
-- day/type). This variant claims ONE SPECIFIC posting id (still atomic + leased +
-- SKIP LOCKED, still WHERE status='approved' so it can't double-claim an in-flight or
-- posted row). Same RETURNS shape as qteklink_claim_posting (the poster reuses it).
-- service_role-only. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.qteklink_claim_posting_by_id(
  p_shop_id      integer,
  p_realm_id     text,
  p_id           uuid,
  p_lease_seconds integer
)
RETURNS public.qteklink_postings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   public.qteklink_postings;
  v_lease integer := coalesce(p_lease_seconds, 120);
BEGIN
  IF p_shop_id IS NULL OR p_realm_id IS NULL OR p_id IS NULL THEN
    RAISE EXCEPTION 'qteklink_claim_posting_by_id: shop/realm/id are required';
  END IF;
  WITH c AS (
    SELECT id FROM public.qteklink_postings
     WHERE id = p_id AND shop_id = p_shop_id AND realm_id = p_realm_id AND status = 'approved'
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  )
  UPDATE public.qteklink_postings p
     SET status = 'posting', lease_until = now() + make_interval(secs => v_lease), updated_at = now()
    FROM c
   WHERE p.id = c.id
  RETURNING p.* INTO v_row;
  RETURN v_row; -- all-NULL row when not claimable (not approved / wrong tenant / locked)
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qteklink_claim_posting_by_id(integer, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_claim_posting_by_id(integer, text, uuid, integer) TO service_role;

COMMIT;
