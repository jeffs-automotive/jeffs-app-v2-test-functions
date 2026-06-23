-- =====================================================================
-- keytags.customer_name — denormalized customer display name — 2026-06-23
-- =====================================================================
-- The admin-app Live board shows a Customer column. Resolving the name from
-- Tekmetric (/customers/{id}) on every page load is slow, so we denormalize:
-- the name is resolved ONCE at assign time (webhook + manual assign paths)
-- and stored here. Best-effort — NULL when the RO had no customer_id or the
-- Tekmetric fetch failed; the nightly reconcile backfills any miss, and the
-- daily-report/dashboard still resolve names live, so this is an optimization,
-- not the source of record. Additive ALTER (mirrors last_activity_at /
-- changed_by_user_label). No index — read alongside the single-row-per-tag
-- pool scan, never filtered on.
-- =====================================================================

ALTER TABLE public.keytags
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

COMMENT ON COLUMN public.keytags.customer_name IS
  'Tekmetric-resolved customer display name (customerDisplayName) captured at assign time. Best-effort: NULL when the RO had no customer_id or the /customers/{id} fetch failed; backfilled by the nightly reconcile. Cleared on release alongside customer_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Clear customer_name on release, alongside customer_id, so a freed tag does
-- not carry a stale name into its next availability window. Both release RPCs
-- are reproduced verbatim from their current definitions with the single
-- `customer_name = NULL` line added to the UPDATE SET list.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_keytag_for_ro(p_ro_id bigint, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(tag_color text, tag_number integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      customer_name     = NULL,
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
$function$;

CREATE OR REPLACE FUNCTION public.release_keytag_as_orphan(p_ro_id bigint, p_reason text)
 RETURNS TABLE(tag_color text, tag_number integer, prior_status text, prior_ro_number bigint, prior_customer_id bigint, prior_vehicle_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      customer_name    = NULL,
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
$function$;
