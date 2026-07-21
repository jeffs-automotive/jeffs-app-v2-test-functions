-- =====================================================================
-- document-intake — advisory-lock RPCs for cron serialization (P2, D8)
-- =====================================================================
-- 2026-07-21. The document-intake-email cron mode (renew/sweep/drain/
-- reconcile/watchdog) must never run concurrently with itself (manual run
-- vs pg_cron vs retry — cross-verify: overlapping runs can double-create
-- subscriptions or double-process events). Session-scoped pg advisory lock
-- keyed on a fixed module id; the edge fn takes it at cron start and the
-- lock dies with the session (crash-safe — no stuck leases).
-- Lock key namespace: hashtext('document-intake') = stable per database.
-- SECURITY DEFINER + revoked from client roles; service_role only.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.document_intake_try_cron_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_try_advisory_lock(hashtext('document-intake-cron')::bigint);
$$;

CREATE OR REPLACE FUNCTION public.document_intake_release_cron_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(hashtext('document-intake-cron')::bigint);
$$;

REVOKE EXECUTE ON FUNCTION public.document_intake_try_cron_lock()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.document_intake_release_cron_lock() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.document_intake_try_cron_lock()     TO service_role;
GRANT  EXECUTE ON FUNCTION public.document_intake_release_cron_lock() TO service_role;

COMMENT ON FUNCTION public.document_intake_try_cron_lock() IS
  'Session advisory lock for the document-intake cron (plan D8). true = lock '
  'acquired, run; false = another run is active, exit. Released explicitly '
  'or on session end.';

COMMIT;
