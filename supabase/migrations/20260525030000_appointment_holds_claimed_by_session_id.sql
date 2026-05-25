-- =====================================================================
-- appointment_holds.claimed_by_session_id — P0.2 post-validator fix
-- Created 2026-05-25 — Validator 2 P0.2 (post-Phase-5B audit)
-- =====================================================================
-- Phase 2 (submit-summary.ts CAS lock) reused `released_at = now()` as
-- the claim signal. The downside Validator 2 caught: between CAS-claim
-- and Tekmetric POST success (a window of ~1-5 sec for the POST), the
-- slot APPEARS released to other customers' availability scans
-- (`scheduler-app/src/lib/scheduler/wizard/availability.ts:128-137`
-- filters appointment_holds .is("released_at", null) — released slots
-- look free). A second customer could see the slot, create their own
-- hold, confirm, and end up double-booking with the in-flight session.
--
-- Fix: separate the "in-flight claim" marker from the "permanently
-- released" marker. New column claimed_by_session_id UUID:
--
--   - SET claimed_by_session_id = chatId in the CAS step BEFORE
--     Tekmetric POST. released_at STAYS NULL — availability queries
--     continue to see the slot as TAKEN.
--   - On Tekmetric POST success: SET released_at = now() (consume).
--     Hold is now dead; slot stays bound to the confirmed appointment.
--   - On Tekmetric POST failure: SET released_at = now() (same as
--     Phase 2's spec-accepted release-on-failure behavior — see
--     PLAN-04 §Phase 2). Hold is dead; slot returns to availability;
--     customer escalates per existing error handling.
--
-- Why we DON'T clear claimed_by_session_id on POST failure: the
-- released_at being set makes the hold dead anyway. claimed_by_session_id
-- becomes historical metadata after release — useful for forensics
-- ("which session was holding this when it released?"). The
-- hold-reaper cron clears stuck claims (claimed > 5 min without
-- release) so crashed mid-POST sessions don't leave indefinite ghost
-- claims.
--
-- Availability queries (.is("released_at", null)) are CORRECT as-is:
-- a claimed-but-not-released hold has released_at NULL → counts as
-- taken to other customers. No availability-query change needed.
--
-- mark-abandoned + hydrate_session_reset already match holds via
-- released_at IS NULL — they cover claimed-but-not-released holds
-- automatically. No change needed there either.
--
-- =====================================================================

BEGIN;

ALTER TABLE public.appointment_holds
  ADD COLUMN claimed_by_session_id UUID;

COMMENT ON COLUMN public.appointment_holds.claimed_by_session_id IS
'Post-validator P0.2 fix (2026-05-25). Set to chatId by the CAS step in submit-summary.ts BEFORE the Tekmetric POST. While set + released_at IS NULL: hold is in-flight-claimed by this session (other sessions see it as taken via existing released_at IS NULL availability filter). On POST success: released_at = now() (consume). On POST failure: released_at = now() (same as Phase 2''s release-on-failure). The hold-reaper cron clears stuck claims (claimed > 5 min without release) for crashed-mid-POST sessions. Historical metadata after release — used for forensics on which session claimed-then-released a slot.';

-- Index for the hold-reaper's new "stuck claims" branch.
CREATE INDEX IF NOT EXISTS appointment_holds_stuck_claim_idx
  ON public.appointment_holds (claimed_by_session_id, expires_at)
  WHERE released_at IS NULL AND claimed_by_session_id IS NOT NULL;

-- Update the hold-reaper cron to also clear stuck claims.
-- The cron command itself uses $reaper$ ... $reaper$ as its dollar-tag
-- so the inner DO block can use $$ without colliding with our outer
-- $migration$ tag.
DO $migration$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id
    FROM cron.job
   WHERE jobname = 'scheduler-hold-reaper';

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'scheduler-hold-reaper cron job not found — cannot update for P0.2';
  END IF;

  PERFORM cron.alter_job(
    job_id  := v_job_id,
    command := $reaper$
  DO $$
  DECLARE
    v_released_count INTEGER;
    v_cleared_claim_count INTEGER;
  BEGIN
    -- Branch 1 (existing): release held-too-long holds (TTL grace + 1h).
    UPDATE public.appointment_holds
       SET released_at = now()
     WHERE released_at IS NULL
       AND claimed_by_session_id IS NULL
       AND expires_at < now() - interval '1 hour';

    GET DIAGNOSTICS v_released_count = ROW_COUNT;

    -- Branch 2 (P0.2 NEW): clear stuck in-flight claims. A claim sits on
    -- a hold while the session calls Tekmetric POST. If the session
    -- crashed mid-POST OR the Tekmetric POST hung past our 45s timeout,
    -- the claim stays set. After 5 minutes of stuck-claim, release the
    -- hold so the slot returns to availability — the customer has long
    -- since escalated or moved on.
    UPDATE public.appointment_holds
       SET released_at = now()
     WHERE released_at IS NULL
       AND claimed_by_session_id IS NOT NULL
       AND expires_at < now() - interval '5 minutes';

    GET DIAGNOSTICS v_cleared_claim_count = ROW_COUNT;

    -- Best-effort observability: only log if work happened.
    IF v_released_count > 0 OR v_cleared_claim_count > 0 THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message, context)
      VALUES
        ('cron',
         'scheduler-hold-reaper',
         'cron/scheduler-hold-reaper',
         'info',
         'reaper_run',
         format(
           'released %s stale holds, cleared %s stuck claims',
           v_released_count,
           v_cleared_claim_count
         ),
         jsonb_build_object(
           'released_count', v_released_count,
           'cleared_claim_count', v_cleared_claim_count
         ));
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message, stack)
      VALUES
        ('cron',
         'scheduler-hold-reaper',
         'cron/scheduler-hold-reaper',
         'error',
         SQLSTATE,
         SQLERRM,
         NULL);
  END;
  $$;
  $reaper$
  );
END;
$migration$;

COMMIT;
