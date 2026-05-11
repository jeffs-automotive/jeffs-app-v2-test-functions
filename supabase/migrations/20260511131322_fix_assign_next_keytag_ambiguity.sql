-- =====================================================================
-- Fix assign_next_keytag — column reference "tag_color" is ambiguous
-- =====================================================================
-- Diagnosed 2026-05-11. The keytag round-robin function introduced in
-- migration 20260509215014_keytags_color_round_robin has a Postgres
-- ambiguity bug: the RETURNS TABLE clause declares OUT parameters named
-- `tag_color` and `tag_number`, and the `ranked` CTE inside the function
-- body references those same names UNqualified. Postgres raises:
--
--   ERROR: column reference "tag_color" is ambiguous
--
-- This blocks every RO-to-WIP automatic keytag assignment. The
-- keytag-tekmetric-webhook captures the error in keytag_webhook_events
-- with processing_result='error' / processing_detail={"stage":"assign_rpc"}
-- and returns 200 to Tekmetric (so we don't get retry storms), but no
-- tag is actually assigned to the RO.
--
-- Verified blast radius (as of 2026-05-11 12:24):
--   * 3 ROs went WIP on 2026-05-11 without getting a tag assigned:
--     - RO 326409536 (11:42:55)
--     - RO 326243337 (12:16:28)
--     - RO 326283459 (12:24:29)
--   * All other paths (force_assign_keytag, release_keytag_for_ro,
--     mark_keytag_posted) are unaffected — they use returning-into or
--     RETURNING-clause patterns that don't collide with the OUT params.
--
-- Fix: qualify every CTE column reference in the function body with the
-- CTE alias (ordered.tag_color, ordered.tag_number, etc.). The function
-- signature, behavior, and external contract stay identical — only the
-- internal query syntax changes. After CREATE OR REPLACE applies,
-- previously-failed ROs still need manual tag assignment via
-- force_assign_keytag (or just let the next status-update event re-fire).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.assign_next_keytag(
  p_ro_id        bigint,
  p_ro_number    bigint,
  p_customer_id  bigint DEFAULT NULL,
  p_vehicle_id   bigint DEFAULT NULL,
  p_advisor_id   bigint DEFAULT NULL,
  p_technician_id bigint DEFAULT NULL
)
RETURNS TABLE(tag_color text, tag_number integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_color   text;
  v_existing_number  int;
  v_cursor_color     text;
  v_cursor_number    int;
  v_picked_color     text;
  v_picked_number    int;
BEGIN
  -- Idempotency: if this RO already holds a tag, return it.
  SELECT k.tag_color, k.tag_number INTO v_existing_color, v_existing_number
  FROM keytags k
  WHERE k.ro_id = p_ro_id
  LIMIT 1;

  IF v_existing_color IS NOT NULL THEN
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

  -- Round-robin pick:
  --   Each tag has an absolute position in the cycle: Red 1..90 = positions 1..90,
  --   Yellow 1..90 = positions 91..180.
  --   Cursor's absolute position is similarly computed.
  --   For each available tag, compute its rank as the distance after cursor (1 = next slot)
  --   modulo 180, then pick the lowest rank.
  --
  -- IMPORTANT: every CTE column reference must be qualified with the CTE
  -- alias (`ordered.*`, `ranked.*`). Unqualified `tag_color` / `tag_number`
  -- collide with the function's OUT parameters of the same name and
  -- Postgres raises "column reference ambiguous".
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
    RETURN; -- pool exhausted; caller surfaces "all 180 in use"
  END IF;

  UPDATE keytags
  SET status         = 'assigned',
      ro_id          = p_ro_id,
      ro_number      = p_ro_number,
      customer_id    = p_customer_id,
      vehicle_id     = p_vehicle_id,
      advisor_id     = p_advisor_id,
      technician_id  = p_technician_id,
      assigned_at    = now(),
      posted_at      = NULL,
      released_at    = NULL,
      updated_at     = now()
  WHERE keytags.tag_color  = v_picked_color
    AND keytags.tag_number = v_picked_number;

  -- Bump cursor for next assignment
  UPDATE keytag_cursor
  SET last_color  = v_picked_color,
      last_number = v_picked_number,
      updated_at  = now()
  WHERE id = 1;

  tag_color  := v_picked_color;
  tag_number := v_picked_number;
  RETURN NEXT;
END;
$function$;
