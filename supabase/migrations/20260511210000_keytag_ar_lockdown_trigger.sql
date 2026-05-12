-- =====================================================================
-- A/R lockdown trigger — defense in depth (Layer 4)
-- =====================================================================
-- Created 2026-05-11. Even if every TS-layer confirmation check is
-- bypassed by a bug or attacker, the DB itself rejects unauthorized
-- transitions out of posted_ar.
--
-- Mechanism:
--   - BEFORE UPDATE trigger on keytags
--   - If OLD.status='posted_ar' and NEW.status<>'posted_ar', the
--     transaction MUST have set the GUC `keytag.ar_mutation_allowed='1'`
--     via `SET LOCAL` (i.e. SECURITY DEFINER RPCs that we trust).
--   - Otherwise RAISE EXCEPTION blocks the UPDATE.
--
-- Trusted callers (set the GUC at function start):
--   - revert_keytag_to_assigned
--   - release_keytag_for_ro
--   - release_keytag_as_orphan
--
-- mark_keytag_posted does NOT need the GUC because moving INTO posted_ar
-- is the protected direction; moving OUT is what we lock down.
--
-- Direct SQL UPDATE bypassing these RPCs (e.g. manual psql session) will
-- fail unless the operator explicitly issues `SET LOCAL
-- keytag.ar_mutation_allowed='1'` first — a deliberate, auditable choice.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.enforce_keytag_ar_lockdown()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text;
BEGIN
  -- Only fire when the row is transitioning OUT of posted_ar
  IF OLD.status = 'posted_ar' AND NEW.status IS DISTINCT FROM 'posted_ar' THEN
    BEGIN
      v_allowed := current_setting('keytag.ar_mutation_allowed', true);
    EXCEPTION WHEN OTHERS THEN
      v_allowed := NULL;
    END;
    IF v_allowed IS NULL OR v_allowed <> '1' THEN
      RAISE EXCEPTION
        'A/R lockdown violation: keytag % % cannot transition out of posted_ar without explicit authorization',
        OLD.tag_color, OLD.tag_number
        USING HINT =
          'Use revert_keytag_to_assigned / release_keytag_for_ro / release_keytag_as_orphan, ' ||
          'which set keytag.ar_mutation_allowed=1. Direct UPDATEs must SET LOCAL keytag.ar_mutation_allowed=''1'' first.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_keytag_ar_lockdown IS
  'BEFORE-UPDATE trigger function: blocks any transition out of posted_ar unless keytag.ar_mutation_allowed=1 GUC is set on the transaction. Defense in depth for A/R lockdown.';

DROP TRIGGER IF EXISTS keytag_ar_lockdown ON public.keytags;
CREATE TRIGGER keytag_ar_lockdown
  BEFORE UPDATE ON public.keytags
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_keytag_ar_lockdown();

-- ─────────────────────────────────────────────────────────────────────────────
-- Update 3 trusted RPCs to set the GUC at function entry. SET LOCAL means
-- the GUC is reset at transaction end, so subsequent unrelated work in
-- the same connection isn't affected.
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Layer-4 A/R lockdown authorization: this function is trusted to flip
  -- posted_ar back to assigned, so it sets the GUC before the UPDATE.
  PERFORM set_config('keytag.ar_mutation_allowed', '1', true);

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
  'Reverses an A/R-posting. Flips status posted_ar → assigned, clears posted_at, refreshes last_activity_at. Idempotent. Sets keytag.ar_mutation_allowed=1 for the Layer-4 lockdown trigger.';

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
  -- Layer-4 A/R lockdown authorization
  PERFORM set_config('keytag.ar_mutation_allowed', '1', true);

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
      last_activity_at  = NULL,
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
  'Releases the keytag currently held by the given RO. Returns the freed (color, number), or empty if no tag was held. Sets keytag.ar_mutation_allowed=1 for the Layer-4 lockdown trigger so posted_ar → available is allowed.';

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
  -- Layer-4 A/R lockdown authorization
  PERFORM set_config('keytag.ar_mutation_allowed', '1', true);

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
      posted_at         = NULL,
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
  'Releases a tag whose RO is no longer reachable in Tekmetric. Returns prior assignment metadata for the audit email. Sets keytag.ar_mutation_allowed=1 for the Layer-4 lockdown trigger.';
