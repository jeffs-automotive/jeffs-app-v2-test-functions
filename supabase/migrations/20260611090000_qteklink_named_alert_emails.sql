-- =====================================================================
-- QTekLink: NAMED alert emails (Chris's spec, 2026-06-11)
-- =====================================================================
-- Notification settings stop being role-based (office manager / service advisors)
-- and become per-EMAIL recipient lists — you configure who receives each named
-- email, and every field accepts multiple comma-separated addresses:
--
--   DATE CHANGE ALERT     — a repair order on an already-posted day was re-posted
--                           in Tekmetric on a DIFFERENT day (the posting-queue
--                           email). Replaces: office manager + service advisors.
--   DAY CORRECTION ALERT  — a day already posted to QuickBooks changed and
--                           QTekLink updated the journal entry (so someone
--                           double-checks it). Replaces: office manager.
--
-- The old office_manager_email / advisor_emails columns are KEPT (no longer
-- written) so the previously-deployed app keeps reading cleanly through the
-- deploy window; they'll be dropped in a later cleanup migration.
-- =====================================================================

ALTER TABLE public.qteklink_settings
  ADD COLUMN IF NOT EXISTS date_change_alert_emails    text,  -- comma-separated list
  ADD COLUMN IF NOT EXISTS day_correction_alert_emails text;  -- comma-separated list

-- One-time carry-over from the role-based fields (date change went to the office
-- manager + the advisors; day corrections went to the office manager).
UPDATE public.qteklink_settings SET
  date_change_alert_emails    = nullif(btrim(concat_ws(', ', office_manager_email, advisor_emails)), ''),
  day_correction_alert_emails = office_manager_email
WHERE date_change_alert_emails IS NULL AND day_correction_alert_emails IS NULL;

-- Re-point the upsert RPC's two recipient params at the new columns. Same arity +
-- types and the established contract: NULL = leave unchanged, '' = clear the list.
DROP FUNCTION IF EXISTS public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer, text, text);
CREATE OR REPLACE FUNCTION public.qteklink_upsert_settings(
  p_shop_id integer,
  p_realm_id text,
  p_auto_post boolean,
  p_settle_window_minutes integer,
  p_shop_timezone text,
  p_sales_tax_rate_bps integer,
  p_tire_fee_cents integer,
  p_date_change_alert_emails text DEFAULT NULL,
  p_day_correction_alert_emails text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_settle_window_minutes IS NOT NULL AND p_settle_window_minutes < 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: settle_window_minutes must be >= 0';
  END IF;
  IF (p_sales_tax_rate_bps IS NOT NULL AND p_sales_tax_rate_bps < 0)
     OR (p_tire_fee_cents IS NOT NULL AND p_tire_fee_cents < 0) THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: tax rate + tire fee must be >= 0';
  END IF;

  INSERT INTO public.qteklink_settings (
    shop_id, realm_id, auto_post, settle_window_minutes, shop_timezone, sales_tax_rate_bps,
    tire_fee_cents, date_change_alert_emails, day_correction_alert_emails, updated_at
  )
  VALUES (
    p_shop_id, p_realm_id, coalesce(p_auto_post, false), coalesce(p_settle_window_minutes, 0),
    coalesce(nullif(btrim(p_shop_timezone), ''), 'America/New_York'),
    coalesce(p_sales_tax_rate_bps, 600), coalesce(p_tire_fee_cents, 100),
    nullif(btrim(coalesce(p_date_change_alert_emails, '')), ''),
    nullif(btrim(coalesce(p_day_correction_alert_emails, '')), ''),
    now()
  )
  ON CONFLICT (shop_id, realm_id) DO UPDATE SET
    auto_post             = coalesce(p_auto_post, public.qteklink_settings.auto_post),
    settle_window_minutes = coalesce(p_settle_window_minutes, public.qteklink_settings.settle_window_minutes),
    shop_timezone         = coalesce(nullif(btrim(p_shop_timezone), ''), public.qteklink_settings.shop_timezone),
    sales_tax_rate_bps    = coalesce(p_sales_tax_rate_bps, public.qteklink_settings.sales_tax_rate_bps),
    tire_fee_cents        = coalesce(p_tire_fee_cents, public.qteklink_settings.tire_fee_cents),
    -- NULL = leave unchanged; an explicit empty string clears the list.
    date_change_alert_emails    = CASE WHEN p_date_change_alert_emails IS NULL THEN public.qteklink_settings.date_change_alert_emails
                                       ELSE nullif(btrim(p_date_change_alert_emails), '') END,
    day_correction_alert_emails = CASE WHEN p_day_correction_alert_emails IS NULL THEN public.qteklink_settings.day_correction_alert_emails
                                       ELSE nullif(btrim(p_day_correction_alert_emails), '') END,
    updated_at            = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer, text, text) TO service_role;
