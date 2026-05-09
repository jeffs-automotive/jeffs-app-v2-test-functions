-- Color-coded round-robin keytag pool.
--
-- Replaces the previous 100-tag (numbered-only) pool with a 180-tag pool of
-- 90 RED + 90 YELLOW tags. Assignment strategy is true round-robin:
--
--   Red 1 → Red 2 → … → Red 90 → Yellow 1 → … → Yellow 90 → Red 1 → …
--
-- A single-row `keytag_cursor` table tracks the last-assigned (color, number)
-- so each new request picks the next available position in the cycle (skipping
-- any tags currently 'assigned' or 'posted_ar'). Concurrent webhooks are
-- handled via FOR UPDATE SKIP LOCKED on the picked row.
--
-- Tekmetric keytag string convention going forward:
--   "R<n>" for red, "Y<n>" for yellow (e.g. "R5", "Y45")
-- Bare-number legacy values from earlier deployments are interpreted as red.
--
-- Schema break: this migration DROPS the existing keytags table and recreates
-- it. Any in-flight assignments are lost. Re-run keytag-seed-from-tekmetric
-- after this migration applies.

DROP TABLE IF EXISTS public.keytags CASCADE;

CREATE TABLE public.keytags (
  tag_color           text          NOT NULL CHECK (tag_color IN ('red', 'yellow')),
  tag_number          int           NOT NULL CHECK (tag_number BETWEEN 1 AND 90),
  status              text          NOT NULL DEFAULT 'available'
                                    CHECK (status IN ('available', 'assigned', 'posted_ar')),

  -- Current assignment (NULL when status='available')
  ro_id               bigint,
  ro_number           bigint,
  customer_id         bigint,
  vehicle_id          bigint,
  advisor_id          bigint,
  technician_id       bigint,

  -- Lifecycle timestamps
  assigned_at         timestamptz,
  posted_at           timestamptz,
  released_at         timestamptz,

  -- Last Tekmetric PATCH attempt observability
  last_patch_at       timestamptz,
  last_patch_success  boolean,
  last_patch_error    text,

  updated_at          timestamptz   NOT NULL DEFAULT now(),

  PRIMARY KEY (tag_color, tag_number)
);

COMMENT ON TABLE public.keytags IS
  'Pool of 90 red + 90 yellow physical key tags. Composite PK (tag_color, tag_number). Assigned via round-robin through keytag_cursor.';

CREATE UNIQUE INDEX keytags_ro_id_unique
  ON public.keytags (ro_id)
  WHERE ro_id IS NOT NULL;

CREATE INDEX keytags_status_idx ON public.keytags (status);

-- Seed 90 red + 90 yellow
INSERT INTO public.keytags (tag_color, tag_number)
SELECT c.color, n.n
FROM (VALUES ('red'), ('yellow')) AS c(color)
CROSS JOIN generate_series(1, 90) AS n(n);

ALTER TABLE public.keytags ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- keytag_cursor — single-row table tracking the last-assigned position so the
-- next assignment picks the next slot in the red→yellow→red cycle.
--
-- The starting cursor is set to (yellow, 90) so the FIRST assignment after this
-- migration goes to red 1 (the first slot after wrapping past yellow 90).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.keytag_cursor (
  id           int          PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- single-row guard
  last_color   text         NOT NULL DEFAULT 'yellow' CHECK (last_color IN ('red', 'yellow')),
  last_number  int          NOT NULL DEFAULT 90 CHECK (last_number BETWEEN 1 AND 90),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO public.keytag_cursor (id, last_color, last_number) VALUES (1, 'yellow', 90);

ALTER TABLE public.keytag_cursor ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- assign_next_keytag — round-robin pick + assign + cursor bump, atomic.
--
-- Returns the picked (tag_color, tag_number). NULL row if pool exhausted.
-- Idempotent for the same RO: if ro_id already has a tag, returns that tag.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint);

CREATE OR REPLACE FUNCTION public.assign_next_keytag(
  p_ro_id          bigint,
  p_ro_number      bigint,
  p_customer_id    bigint DEFAULT NULL,
  p_vehicle_id     bigint DEFAULT NULL,
  p_advisor_id     bigint DEFAULT NULL,
  p_technician_id  bigint DEFAULT NULL
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
  WITH ordered AS (
    SELECT
      k.tag_color,
      k.tag_number,
      CASE WHEN k.tag_color = 'red' THEN k.tag_number ELSE 90 + k.tag_number END AS abs_pos,
      CASE WHEN v_cursor_color = 'red' THEN v_cursor_number ELSE 90 + v_cursor_number END AS cursor_abs_pos
    FROM keytags k
    WHERE k.status = 'available'
  ),
  ranked AS (
    SELECT
      tag_color,
      tag_number,
      ((abs_pos - cursor_abs_pos - 1 + 180) % 180) + 1 AS rr_rank
    FROM ordered
  )
  SELECT r.tag_color, r.tag_number
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
$$;

COMMENT ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint) IS
  'Idempotently assigns the next round-robin keytag to an RO. Returns existing tag if RO already holds one. Returns empty row if pool exhausted.';

-- ─────────────────────────────────────────────────────────────────────────────
-- force_assign_keytag — assign a SPECIFIC color+number to an RO (advisor manual override)
--
-- Used by the orchestrator's "assign_keytag_to_ro" tool when a service advisor
-- specifies which physical tag they put on a car. Does NOT advance the cursor —
-- manual assignments are a side-channel and shouldn't perturb the round-robin.
--
-- Returns (tag_color, tag_number) on success. Errors:
--   tag_in_use_by_other_ro  — the requested tag is held by a different RO
--   ro_already_has_tag      — this RO already holds a different tag
--   tag_not_found           — color+number out of range (shouldn't happen via Zod)
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
  WHERE keytags.tag_color  = p_tag_color
    AND keytags.tag_number = p_tag_number;

  tag_color  := p_tag_color;
  tag_number := p_tag_number;
  error_code := NULL;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.force_assign_keytag(bigint, bigint, text, int, bigint, bigint, bigint, bigint) IS
  'Assigns a specific (color, number) tag to an RO. Used for service-advisor manual assignments via the orchestrator. Does not advance the round-robin cursor.';

-- ─────────────────────────────────────────────────────────────────────────────
-- release_keytag_for_ro — unchanged contract, returns color + number now
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.release_keytag_for_ro(bigint, text);

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
  SET status         = 'available',
      ro_id          = NULL,
      ro_number      = NULL,
      customer_id    = NULL,
      vehicle_id     = NULL,
      advisor_id     = NULL,
      technician_id  = NULL,
      assigned_at    = NULL,
      posted_at      = NULL,
      released_at    = now(),
      updated_at     = now()
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
  'Releases the keytag currently held by the given RO. Returns the freed (color, number), or empty if no tag was held.';

-- ─────────────────────────────────────────────────────────────────────────────
-- mark_keytag_posted — also returns color + number
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_keytag_posted(bigint);

CREATE OR REPLACE FUNCTION public.mark_keytag_posted(
  p_ro_id bigint
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
  SET status     = 'posted_ar',
      posted_at  = now(),
      updated_at = now()
  WHERE keytags.ro_id = p_ro_id
  RETURNING keytags.tag_color, keytags.tag_number INTO v_color, v_number;

  IF v_color IS NULL THEN RETURN; END IF;

  tag_color  := v_color;
  tag_number := v_number;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.mark_keytag_posted(bigint) IS
  'Marks the keytag held by this RO as posted_ar (RO went to A/R balance). Tag stays held until payment_made fires.';

-- ─────────────────────────────────────────────────────────────────────────────
-- record_keytag_patched — unchanged
-- ─────────────────────────────────────────────────────────────────────────────
-- (left intact from prior migration; signature still bigint, boolean, text)

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.assign_next_keytag(bigint, bigint, bigint, bigint, bigint, bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.force_assign_keytag(bigint, bigint, text, int, bigint, bigint, bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.force_assign_keytag(bigint, bigint, text, int, bigint, bigint, bigint, bigint) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.force_assign_keytag(bigint, bigint, text, int, bigint, bigint, bigint, bigint) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_keytag_for_ro(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_keytag_for_ro(bigint, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.release_keytag_for_ro(bigint, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.mark_keytag_posted(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_keytag_posted(bigint) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_keytag_posted(bigint) TO service_role;
