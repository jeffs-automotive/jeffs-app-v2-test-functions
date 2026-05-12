-- =====================================================================
-- Wire last_activity_at into force_assign_keytag + release_keytag_for_ro
-- =====================================================================
-- Created 2026-05-11. Companion to 20260511143000 which introduced
-- last_activity_at + the new assign/mark-posted overloads. This migration
-- updates the TWO existing RPCs that touch keytag rows but didn't yet
-- write last_activity_at:
--
--   1) force_assign_keytag — used by Claude Desktop orchestrator tools
--      (supabase/functions/_shared/tools/keytag-management.ts) when a
--      service advisor manually picks a specific tag for an RO. Before
--      this migration, manually-assigned tags had last_activity_at = NULL
--      and would NEVER show in the daily report's staleness section.
--      Fix: set last_activity_at = now() at assignment time.
--
--   2) release_keytag_for_ro — clears the row when a tag returns to the
--      pool (posted-paid via ro_posted webhook, or A/R balance paid via
--      payment_made webhook, or manual release via orchestrator). Before
--      this migration, last_activity_at stayed at its old value even
--      though the row went status=available. Daily report filters by
--      status, so this is cosmetic, but cleaning up keeps audit data
--      honest. Fix: set last_activity_at = NULL on release.
--
-- Neither function changes its signature — backwards-compatible with
-- every existing caller (no overload-ambiguity risk).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- force_assign_keytag — same body + signature as the original from
-- 20260509215014_keytags_color_round_robin.sql, with one addition:
-- last_activity_at = now() in the successful-assignment UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.force_assign_keytag(
  p_ro_id          bigint,
  p_ro_number      bigint,
  p_tag_color      text,
  p_tag_number     int,
  p_customer_id    bigint DEFAULT NULL,
  p_vehicle_id     bigint DEFAULT NULL,
  p_advisor_id     bigint DEFAULT NULL,
  p_technician_id  bigint DEFAULT NULL
)
RETURNS TABLE (tag_color text, tag_number int, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_holder_ro       bigint;
  v_holder_status   text;
  v_existing_color  text;
  v_existing_number int;
BEGIN
  -- Already-on-this-RO short-circuit (idempotent)
  SELECT k.tag_color, k.tag_number INTO v_existing_color, v_existing_number
  FROM keytags k
  WHERE k.ro_id = p_ro_id
  LIMIT 1;

  IF v_existing_color IS NOT NULL THEN
    IF v_existing_color = p_tag_color AND v_existing_number = p_tag_number THEN
      -- Refresh activity clock on the idempotent re-assignment so the
      -- staleness math reflects this latest manual touch.
      UPDATE keytags
      SET last_activity_at = now(),
          updated_at       = now()
      WHERE keytags.ro_id = p_ro_id;
      tag_color  := v_existing_color;
      tag_number := v_existing_number;
      error_code := NULL;
      RETURN NEXT;
      RETURN;
    ELSE
      tag_color  := v_existing_color;
      tag_number := v_existing_number;
      error_code := 'ro_already_has_tag';
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Check the requested tag's current state
  SELECT k.ro_id, k.status INTO v_holder_ro, v_holder_status
  FROM keytags k
  WHERE k.tag_color = p_tag_color AND k.tag_number = p_tag_number
  FOR UPDATE;

  IF v_holder_status IS NULL THEN
    tag_color  := p_tag_color;
    tag_number := p_tag_number;
    error_code := 'tag_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_holder_status <> 'available' THEN
    tag_color  := p_tag_color;
    tag_number := p_tag_number;
    error_code := 'tag_in_use_by_other_ro';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE keytags
  SET status            = 'assigned',
      ro_id             = p_ro_id,
      ro_number         = p_ro_number,
      customer_id       = p_customer_id,
      vehicle_id        = p_vehicle_id,
      advisor_id        = p_advisor_id,
      technician_id     = p_technician_id,
      assigned_at       = now(),
      posted_at         = NULL,
      released_at       = NULL,
      last_activity_at  = now(),  -- NEW: ensures manual assignments show in staleness
      updated_at        = now()
  WHERE keytags.tag_color  = p_tag_color
    AND keytags.tag_number = p_tag_number;

  tag_color  := p_tag_color;
  tag_number := p_tag_number;
  error_code := NULL;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.force_assign_keytag(bigint, bigint, text, int, bigint, bigint, bigint, bigint) IS
  'Assigns a specific (color, number) tag to an RO. Used for service-advisor manual assignments via the orchestrator. Does not advance the round-robin cursor. Sets last_activity_at = now() so manually-assigned tags participate in daily-report staleness math.';

-- ─────────────────────────────────────────────────────────────────────────────
-- release_keytag_for_ro — same signature as the original, just adds
-- last_activity_at = NULL to the release UPDATE so released rows don't
-- retain stale timestamps. Daily report filters by status so the change
-- is cosmetic, but cleaner state simplifies audit queries.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_keytag_for_ro(
  p_ro_id  bigint,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (tag_color text, tag_number int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_color  text;
  v_number int;
BEGIN
  UPDATE keytags
  SET status            = 'available',
      ro_id             = NULL,
      ro_number         = NULL,
      customer_id       = NULL,
      vehicle_id        = NULL,
      advisor_id        = NULL,
      technician_id     = NULL,
      assigned_at       = NULL,
      posted_at         = NULL,
      released_at       = now(),
      last_activity_at  = NULL,  -- NEW: clears stale clock on release
      updated_at        = now()
  WHERE keytags.ro_id = p_ro_id
  RETURNING keytags.tag_color, keytags.tag_number INTO v_color, v_number;

  IF v_color IS NULL THEN
    RETURN; -- no tag was held
  END IF;

  tag_color  := v_color;
  tag_number := v_number;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.release_keytag_for_ro(bigint, text) IS
  'Releases the keytag currently held by the given RO. Returns the freed (color, number), or empty if no tag was held. Clears last_activity_at so released rows don''t retain stale audit timestamps.';
