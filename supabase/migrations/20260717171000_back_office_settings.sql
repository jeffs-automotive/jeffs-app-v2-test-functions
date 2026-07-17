-- =====================================================================
-- Back Office module — settings on qteklink_settings (Phase 1)
-- =====================================================================
-- 2026-07-17. Recipient lists + stale threshold for the back-office module live as a
-- single `back_office` jsonb blob on the existing per-(shop,realm) qteklink_settings row
-- (the payroll-blob idiom). A DEDICATED upsert RPC touches ONLY this column so it does
-- not have to track the (already long) qteklink_upsert_settings signature.
--
--   back_office = {
--     sa_emails: text[],           -- service-advisor recipients (sent_to_sa alerts)
--     office_emails: text[],       -- office manager (sa_submitted, ro_closed, verified)
--     accounting_emails: text[],   -- accounting (detected, sa_submitted, verified)
--     digest_emails: text[],       -- daily digest recipients
--     fallback_admin_email: text,  -- "send to admin" when a QBO fetch can't be resolved
--     stale_hours: int             -- default 48
--   }
-- The app does a read-modify-write of the whole blob; p_back_office NULL = leave unchanged.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

ALTER TABLE public.qteklink_settings
  ADD COLUMN IF NOT EXISTS back_office jsonb;

COMMENT ON COLUMN public.qteklink_settings.back_office IS
  'Back-office module config blob: { sa_emails[], office_emails[], accounting_emails[], digest_emails[], fallback_admin_email, stale_hours }. Whole-blob read-modify-write via back_office_upsert_settings.';

CREATE OR REPLACE FUNCTION public.back_office_upsert_settings(
  p_shop_id     integer,
  p_realm_id    text,
  p_back_office jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'back_office_upsert_settings: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;

  INSERT INTO public.qteklink_settings (shop_id, realm_id, back_office, updated_at)
  VALUES (p_shop_id, p_realm_id, p_back_office, now())
  ON CONFLICT (shop_id, realm_id) DO UPDATE SET
    back_office = coalesce(p_back_office, public.qteklink_settings.back_office),
    updated_at  = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_upsert_settings(integer, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_upsert_settings(integer, text, jsonb) TO service_role;

COMMIT;
