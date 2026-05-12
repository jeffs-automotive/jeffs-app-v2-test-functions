-- =====================================================================
-- Regression-handling RPCs for keytag lifecycle reversals
-- =====================================================================
-- Created 2026-05-11. Companions to mark_keytag_posted / release_keytag_for_ro
-- that handle the rarer "RO moved BACKWARDS" cases:
--
--   1) revert_keytag_to_assigned(ro_id)
--      A/R → un-posted → WIP regression. Tag stays held but its status
--      flips from posted_ar back to assigned, posted_at clears, and
--      last_activity_at refreshes. Triggered by status_updated webhook
--      OR nightly reconcile (forward pass catches it when the RO is back
--      in the WIP list).
--
--   2) release_keytag_as_orphan(ro_id, reason)
--      RO has been deleted in Tekmetric (404) or has moved past
--      POSTED_PAID without us seeing the release webhook. Either way,
--      the tag must go back to the available pool. Returns the freed
--      (color, number) and the prior assignment metadata so the caller
--      can build an audit email (service team verifies the action).
--      Sets released_at = now() and a special marker in last_patch_error
--      so the daily report can flag these in its "Released by cron"
--      audit section.
--
-- Both functions are idempotent — calling them on a tag whose state
-- already matches the target state is a no-op that returns the current
-- (color, number) without raising.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.revert_keytag_to_assigned(
  p_ro_id            bigint,
  p_last_activity_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  tag_color text,
  tag_number int,
  prior_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_color        text;
  v_number       int;
  v_prior_status text;
BEGIN
  SELECT k.status, k.tag_color, k.tag_number
  INTO v_prior_status, v_color, v_number
  FROM keytags k
  WHERE k.ro_id = p_ro_id
  LIMIT 1;

  IF v_color IS NULL THEN
    RETURN; -- no tag held; nothing to revert
  END IF;

  -- Idempotent: if already assigned, just refresh last_activity_at
  IF v_prior_status = 'assigned' THEN
    UPDATE keytags
    SET last_activity_at = COALESCE(p_last_activity_at, last_activity_at),
        updated_at = now()
    WHERE keytags.ro_id = p_ro_id;
    tag_color := v_color;
    tag_number := v_number;
    prior_status := v_prior_status;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE keytags
  SET status           = 'assigned',
      posted_at        = NULL,
      released_at      = NULL,
      last_activity_at = COALESCE(p_last_activity_at, now()),
      updated_at       = now()
  WHERE keytags.ro_id = p_ro_id;

  tag_color    := v_color;
  tag_number   := v_number;
  prior_status := v_prior_status;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.revert_keytag_to_assigned(bigint, timestamptz) IS
  'Reverses an A/R-posting (or estimate regression that came after one). Flips status posted_ar → assigned, clears posted_at, refreshes last_activity_at. Idempotent.';

-- ─────────────────────────────────────────────────────────────────────────────
-- release_keytag_as_orphan — same effect as release_keytag_for_ro but
-- preserves the RO id and prior status in the return so the orchestrator
-- can build an "alert service" email. Adds a marker to last_patch_error
-- so daily report can distinguish cron-driven releases from posted-paid
-- and payment-driven releases.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_keytag_as_orphan(
  p_ro_id  bigint,
  p_reason text
)
RETURNS TABLE (
  tag_color text,
  tag_number int,
  prior_status text,
  prior_ro_number bigint,
  prior_customer_id bigint,
  prior_vehicle_id bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_color    text;
  v_number   int;
  v_status   text;
  v_ro_num   bigint;
  v_cust_id  bigint;
  v_veh_id   bigint;
BEGIN
  SELECT k.status, k.tag_color, k.tag_number, k.ro_number, k.customer_id, k.vehicle_id
  INTO v_status, v_color, v_number, v_ro_num, v_cust_id, v_veh_id
  FROM keytags k
  WHERE k.ro_id = p_ro_id
  LIMIT 1;

  IF v_color IS NULL THEN
    RETURN; -- no tag held; nothing to release
  END IF;

  UPDATE keytags
  SET status           = 'available',
      ro_id            = NULL,
      ro_number        = NULL,
      customer_id      = NULL,
      vehicle_id       = NULL,
      advisor_id       = NULL,
      technician_id    = NULL,
      assigned_at      = NULL,
      posted_at        = NULL,
      released_at      = now(),
      last_activity_at = NULL,
      last_patch_error = 'cron_orphan_release: ' || COALESCE(p_reason, 'unknown'),
      updated_at       = now()
  WHERE keytags.tag_color  = v_color
    AND keytags.tag_number = v_number;

  tag_color         := v_color;
  tag_number        := v_number;
  prior_status      := v_status;
  prior_ro_number   := v_ro_num;
  prior_customer_id := v_cust_id;
  prior_vehicle_id  := v_veh_id;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.release_keytag_as_orphan(bigint, text) IS
  'Releases a tag whose RO is no longer reachable in Tekmetric (deleted, or moved past POSTED_PAID without us seeing release webhook). Returns prior assignment metadata so caller can build an audit email for the service team to verify.';
