-- =====================================================================
-- Back Office — refresh the qteklink_settings.back_office column comment (2026-07-18)
-- =====================================================================
-- The live column comment (from 20260717171000) predates the reopened-RO rework: it omits
-- `reopened_emails` and still says accounting receives the `detected` alert. This brings the
-- DB introspection doc in line with the shipped routing (recipients in
-- supabase/functions/_shared/back-office-recipients.ts). COMMENT-only, no schema change.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

COMMENT ON COLUMN public.qteklink_settings.back_office IS
  'Back-office module config blob: { sa_emails[], office_emails[], accounting_emails[], reopened_emails[], digest_emails[], fallback_admin_email, stale_hours }. Whole-blob read-modify-write via back_office_upsert_settings. Alert routing (back-office-notify): sent_to_sa/resent_to_sa -> sa_emails; sa_submitted -> office_emails+accounting_emails; verified -> sa+office+accounting; ro_closed -> office_emails; detected (reopened-RO net change) -> reopened_emails ONLY (no fallback; empty = no send); daily digest -> digest_emails.';
