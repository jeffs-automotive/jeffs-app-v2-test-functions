-- =====================================================================
-- last_activity_at + backfill-aware RPCs
-- =====================================================================
-- Created 2026-05-11. Two related changes:
--
-- 1) Add `last_activity_at TIMESTAMPTZ` to keytags. This tracks the
--    Tekmetric-side "last activity" timestamp for the RO holding the tag:
--      - For status='assigned' (WIP) tags  → Tekmetric repairOrder.updatedDate
--      - For status='posted_ar' tags       → Tekmetric repairOrder.postedDate
--    Used by the morning report to compute staleness for BOTH WIP and A/R
--    tags. Previously, staleness was A/R-only (driven by our `posted_at`,
--    which is set at the moment the webhook fires — wrong for backfilled
--    rows because backfill sets `posted_at = now()`).
--
-- 2) Replace assign_next_keytag + mark_keytag_posted with overloads that
--    accept an explicit timestamp argument. To avoid PostgREST function-
--    overload ambiguity (PGRST203) — where a JSON body with fewer keys
--    could match either the old or new signature and trigger the "could
--    not choose the best candidate function" error — the OLD signatures
--    are dropped first. The new signatures have DEFAULT NULL on every
--    optional parameter, so existing callers (which omit p_last_activity_at,
--    p_posted_at) still work without code changes.
--
-- This migration is additive — no existing rows are migrated. Once the
-- bulk-reconcile Edge Function runs after this migration, every WIP +
-- A/R tag will have last_activity_at populated; the morning report can
-- then trust it.
-- =====================================================================

ALTER TABLE public.keytags
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

COMMENT ON COLUMN public.keytags.last_activity_at IS
  'Tekmetric-side last-activity timestamp for the RO holding this tag. For status=assigned, this is repairOrder.updatedDate; for status=posted_ar, this is repairOrder.postedDate. Drives staleness calculation in the daily report.';

CREATE INDEX IF NOT EXISTS keytags_last_activity_at_idx
  ON public.keytags (last_activity_at)
  WHERE status IN ('assigned', 'posted_ar');

-- ─────────────────────────────────────────────────────────────────────────────
-- assign_next_keytag — single 7-param signature with DEFAULT NULL on all
-- optional params. The OLD 6-param overload (from
-- 20260511131322_fix_assign_next_keytag_ambiguity.sql) is dropped first to
-- prevent PostgREST function-overload ambiguity (PGRST203 — "could not
-- choose the best candidate function").
--
-- Old callers (Claude Desktop orchestrator tools in
-- supabase/functions/_shared/tools/keytag-management.ts) that omit
-- p_last_activity_at will land on this same function with the parameter
-- defaulting to NULL → COALESCE(NULL, now()) → now(). Behavior is
-- backwards-compatible for those callers.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint);

CREATE OR REPLACE FUNCTION public.assign_next_keytag(
  p_ro_id            bigint,
  p_ro_number        bigint,
  p_customer_id      bigint        DEFAULT NULL,
  p_vehicle_id       bigint        DEFAULT NULL,
  p_advisor_id       bigint        DEFAULT NULL,
  p_technician_id    bigint        DEFAULT NULL,
  p_last_activity_at timestamptz   DEFAULT NULL
)
RETURNS TABLE (tag_color text, tag_number int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_color   text;
  v_existing_number  int;
  v_cursor_color     text;
  v_cursor_number    int;
  v_picked_color     text;
  v_picked_number    int;
BEGIN
  -- Idempotency: if this RO already holds a tag, refresh last_activity_at
  -- (so re-running the reconcile cron updates the staleness clock for
  -- already-assigned tags) and return the existing assignment.
  SELECT k.tag_color, k.tag_number INTO v_existing_color, v_existing_number
  FROM keytags k
  WHERE k.ro_id = p_ro_id
  LIMIT 1;

  IF v_existing_color IS NOT NULL THEN
    -- Idempotency: refresh last_activity_at, but only forward in time.
    -- GREATEST guards against out-of-order webhook delivery (an older
    -- Tekmetric updatedDate arriving after a newer one) clobbering the
    -- staleness clock. Same pattern as touch_keytag_activity below.
    IF p_last_activity_at IS NOT NULL THEN
      UPDATE keytags
      SET last_activity_at = GREATEST(
            COALESCE(last_activity_at, '-infinity'::timestamptz),
            p_last_activity_at
          ),
          updated_at       = now()
      WHERE keytags.ro_id = p_ro_id;
    END IF;
    tag_color  := v_existing_color;
    tag_number := v_existing_number;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock + read cursor
  SELECT c.last_color, c.last_number INTO v_cursor_color, v_cursor_number
  FROM keytag_cursor c
  WHERE c.id = 1
  FOR UPDATE;

  -- Round-robin pick (alias-qualified columns to avoid the OUT-param
  -- ambiguity fixed in 20260511131322).
  WITH ordered AS (
    SELECT
      k.tag_color   AS o_tag_color,
      k.tag_number  AS o_tag_number,
      CASE WHEN k.tag_color = 'red' THEN k.tag_number ELSE 90 + k.tag_number END AS abs_pos,
      CASE WHEN v_cursor_color = 'red' THEN v_cursor_number ELSE 90 + v_cursor_number END AS cursor_abs_pos
    FROM keytags k
    WHERE k.status = 'available'
  ),
  ranked AS (
    SELECT
      ordered.o_tag_color,
      ordered.o_tag_number,
      ((ordered.abs_pos - ordered.cursor_abs_pos - 1 + 180) % 180) + 1 AS rr_rank
    FROM ordered
  )
  SELECT r.o_tag_color, r.o_tag_number
  INTO v_picked_color, v_picked_number
  FROM ranked r
  ORDER BY r.rr_rank ASC
  LIMIT 1;

  IF v_picked_color IS NULL THEN
    RETURN; -- pool exhausted
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
      last_activity_at  = COALESCE(p_last_activity_at, now()),
      updated_at        = now()
  WHERE keytags.tag_color  = v_picked_color
    AND keytags.tag_number = v_picked_number;

  UPDATE keytag_cursor
  SET last_color  = v_picked_color,
      last_number = v_picked_number,
      updated_at  = now()
  WHERE id = 1;

  tag_color  := v_picked_color;
  tag_number := v_picked_number;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint, timestamptz) IS
  'Idempotent round-robin keytag assignment with optional explicit last_activity_at for backfill scenarios. Live webhook handler passes NULL (defaults to now()); the nightly reconcile cron passes Tekmetric.updatedDate.';

-- ─────────────────────────────────────────────────────────────────────────────
-- mark_keytag_posted — single 3-param signature with DEFAULT NULL on the
-- two new params. The OLD 1-param signature (from
-- 20260509215014_keytags_color_round_robin.sql) is dropped first to
-- prevent PostgREST overload ambiguity.
--
-- Backwards-compatible: callers that pass only p_ro_id get
-- p_posted_at = NULL → v_posted = now() (matches old behavior)
-- p_last_activity_at = NULL → v_active = COALESCE(NULL, NULL, now()) = now().
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_keytag_posted(bigint);

CREATE OR REPLACE FUNCTION public.mark_keytag_posted(
  p_ro_id            bigint,
  p_posted_at        timestamptz DEFAULT NULL,
  p_last_activity_at timestamptz DEFAULT NULL
)
RETURNS TABLE (tag_color text, tag_number int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_color   text;
  v_number  int;
  v_posted  timestamptz := COALESCE(p_posted_at, now());
  v_active  timestamptz := COALESCE(p_last_activity_at, p_posted_at, now());
BEGIN
  UPDATE keytags
  SET status            = 'posted_ar',
      posted_at         = v_posted,
      last_activity_at  = v_active,
      updated_at        = now()
  WHERE keytags.ro_id = p_ro_id
  RETURNING keytags.tag_color, keytags.tag_number INTO v_color, v_number;

  IF v_color IS NULL THEN RETURN; END IF;

  tag_color  := v_color;
  tag_number := v_number;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.mark_keytag_posted(bigint, timestamptz, timestamptz) IS
  'Marks the keytag held by this RO as posted_ar. Accepts explicit posted_at + last_activity_at so backfill jobs can write Tekmetric''s actual postedDate (otherwise staleness clock starts at backfill time, not at the real A/R transition).';

-- ─────────────────────────────────────────────────────────────────────────────
-- touch_keytag_activity — used by live webhook handler on every RO update
-- while the tag is held, and by the nightly reconcile to refresh the WIP
-- staleness clock from the latest Tekmetric.updatedDate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_keytag_activity(
  p_ro_id            bigint,
  p_last_activity_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE keytags
  SET last_activity_at = GREATEST(COALESCE(last_activity_at, '-infinity'::timestamptz), p_last_activity_at),
      updated_at       = now()
  WHERE keytags.ro_id = p_ro_id
    AND keytags.status IN ('assigned', 'posted_ar');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.touch_keytag_activity(bigint, timestamptz) IS
  'Refreshes last_activity_at for the keytag held by this RO. Uses GREATEST so older webhook payloads (out-of-order delivery) cannot move the clock backwards. Returns true if a row was updated.';
