-- =====================================================================
-- Scheduler-app cron setup
-- =====================================================================
-- Created 2026-05-10 per appointments_design.md §7.4 + §11.
--
-- Enables pg_cron + pg_net, stores the project URL in a config GUC, and
-- schedules two cron jobs:
--
--   1. appointments-sync       — every 10 min, full 7-day pull from Tekmetric
--   2. transcript-dispatcher   — every 5 min, backstop dispatch of pending/retry
--                                transcript_emails rows
--
-- Auth: each cron call needs the Supabase service-role bearer (the same
-- value the Vercel side sends as SUPABASE_SECRET_KEY). We store it once in
-- Supabase Vault — Chris runs the one-time INSERT below after applying the
-- migration, NEVER commits the raw key to git. The cron body reads the
-- decrypted secret from `vault.decrypted_secrets` on each invocation.
--
-- Phase 1: a single 10-minute cadence for appointments-sync regardless of
-- time of day. The overhead is negligible (one 7-day GET to Tekmetric is
-- cheap) and the simplicity is worth the tiny extra compute. Future tuning
-- can split to *every 10 min during shop hours / every 1h overnight* if
-- needed (see design memo "Pull strategy" notes).
--
-- Idempotency: every cron.schedule is preceded by cron.unschedule of the
-- same job name (using a soft-fail wrapper) so re-running this migration
-- on an environment that already has the jobs is a no-op.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Enable extensions
-- ---------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;


-- ---------------------------------------------------------------------
-- 2. Helper: soft-unschedule a cron job by name (no-op if it doesn't exist)
-- ---------------------------------------------------------------------
-- pg_cron's cron.unschedule(name TEXT) raises an error if the job doesn't
-- exist. Wrap so the migration is re-runnable.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cron_unschedule_if_exists(p_jobname TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = p_jobname) THEN
    PERFORM cron.unschedule(p_jobname);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_unschedule_if_exists(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cron_unschedule_if_exists(TEXT) TO postgres;


-- ---------------------------------------------------------------------
-- 3. Helper: read the service-role key from Vault for cron HTTP calls
-- ---------------------------------------------------------------------
-- Reads vault.decrypted_secrets where name = 'service_role_key'. Returns
-- NULL (and RAISES NOTICE) if the secret isn't set — useful diagnostic
-- in the cron logs when Chris forgets the one-time secret insert.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scheduler_get_service_role_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_key TEXT;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  IF v_key IS NULL THEN
    RAISE NOTICE 'scheduler_get_service_role_key: vault secret "service_role_key" is not set. Insert via vault.create_secret().';
  END IF;
  RETURN v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.scheduler_get_service_role_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduler_get_service_role_key() TO postgres;


-- ---------------------------------------------------------------------
-- 4. Helper: post to a scheduler Edge Function with the service-role bearer
-- ---------------------------------------------------------------------
-- Encapsulates the net.http_post + auth-header wiring so each cron job
-- body is a one-liner. Returns the pg_net request_id (BIGINT) so the
-- cron log captures the in-flight request.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.scheduler_invoke_edge_function(
  p_function_name TEXT,
  p_body          JSONB DEFAULT '{}'::jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  v_key       TEXT;
  v_base_url  TEXT;
  v_url       TEXT;
  v_req_id    BIGINT;
BEGIN
  v_key := public.scheduler_get_service_role_key();
  IF v_key IS NULL THEN
    -- Skip the call; the cron run logs the NOTICE from the helper
    RETURN NULL;
  END IF;

  -- Base URL discovered from supabase_url() if available; otherwise pinned
  -- to the test project. We pin per-project rather than using a GUC so the
  -- migration is portable + readable. Update on environment migration.
  v_base_url := 'https://itzdasxobllfiuolmbxu.supabase.co';
  v_url := v_base_url || '/functions/v1/' || p_function_name;

  SELECT net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := COALESCE(p_body, '{}'::jsonb),
    timeout_milliseconds := 60000
  ) INTO v_req_id;

  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.scheduler_invoke_edge_function(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scheduler_invoke_edge_function(TEXT, JSONB) TO postgres;


-- ---------------------------------------------------------------------
-- 5. Schedule appointments-sync — every 10 min
-- ---------------------------------------------------------------------
-- Pulls the rolling 7-day window from Tekmetric and upserts into the
-- local appointments shadow. Soft-deletes Tekmetric-deleted rows. Prunes
-- start_time < now() - 1 day. Updates appointment_sync_state.
--
-- 10 min is the canonical Phase 1 cadence per scheduler_project_state.md
-- + design memo §7.4. Bumps to /5 only if a customer reports stale data;
-- bumps to /15 if Tekmetric rate-limit budget becomes a concern.
-- ---------------------------------------------------------------------

SELECT public.cron_unschedule_if_exists('scheduler-appointments-sync');

SELECT cron.schedule(
  'scheduler-appointments-sync',
  '*/10 * * * *',
  $cron$SELECT public.scheduler_invoke_edge_function('appointments-sync', '{}'::jsonb);$cron$
);


-- ---------------------------------------------------------------------
-- 6. Schedule transcript-dispatcher backstop — every 5 min
-- ---------------------------------------------------------------------
-- Picks up transcript_emails rows in status pending|retry that are older
-- than 30s (the immediate-dispatch grace window). The HAPPY PATH for
-- transcript send is the Vercel after() / Deno waitUntil() invocation
-- triggered when a conversation ends — this cron is the BACKSTOP for
-- those failures (Vercel function crash, network blip, Resend 5xx).
--
-- Resend's Idempotency-Key: transcript:<session_id> guarantees the
-- happy path + the backstop never double-send.
-- ---------------------------------------------------------------------

SELECT public.cron_unschedule_if_exists('scheduler-transcript-dispatcher');

SELECT cron.schedule(
  'scheduler-transcript-dispatcher',
  '*/5 * * * *',
  $cron$SELECT public.scheduler_invoke_edge_function('transcript-dispatcher', '{}'::jsonb);$cron$
);


-- =====================================================================
-- POST-MIGRATION STEPS (Chris runs manually after `supabase db push`)
-- =====================================================================
--
-- 1. Insert the service-role key into Vault (ONE TIME — never commit this
--    to git; copy the value from Supabase Dashboard → Project Settings →
--    API → service_role key):
--
--      SELECT vault.create_secret(
--        '<service_role_key_value_here>',
--        'service_role_key',
--        'Scheduler cron auth (appointments-sync + transcript-dispatcher)'
--      );
--
--    If the secret already exists from a prior environment, update it:
--
--      UPDATE vault.secrets
--        SET secret = '<new_value>'
--        WHERE name = 'service_role_key';
--
-- 2. Verify the crons landed:
--
--      SELECT jobid, jobname, schedule, active FROM cron.job
--        WHERE jobname LIKE 'scheduler-%';
--
-- 3. Verify the helper picks up the secret:
--
--      SELECT public.scheduler_get_service_role_key() IS NOT NULL AS ok;
--
-- 4. Smoke-run each cron manually (writes to net._http_response so you can
--    inspect the result):
--
--      SELECT public.scheduler_invoke_edge_function('appointments-sync', '{}'::jsonb) AS request_id;
--      -- wait ~30s
--      SELECT id, status_code, content
--        FROM net._http_response
--        WHERE id = <request_id>;
--
-- 5. Check pg_cron run history once the schedules have ticked once:
--
--      SELECT runid, jobid, start_time, status, return_message
--        FROM cron.job_run_details
--        WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'scheduler-%')
--        ORDER BY start_time DESC
--        LIMIT 10;
-- =====================================================================
