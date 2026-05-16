-- =====================================================================
-- Scheduler-app cron reapers — created 2026-05-16
-- =====================================================================
-- Per Round 4 audit (R4-BLOCKER-C-1, R4-IMPORTANT-C-1):
--
-- The V2 ephemeral-session architecture (commit c7a3614) relies on a
-- 5-minute browser-side beacon (IdleTimer.tsx) to release appointment_holds
-- when the customer is idle or navigates away. That beacon path fails on
-- network drop at tab-close, browser killed by OS, mobile background-tab
-- eviction, and laptop-lid-closed scenarios. In each case the hold row
-- sits with `released_at = NULL` and `expires_at < now()` indefinitely.
--
-- holdAppointmentSlot's read path (booking-direct/index.ts:478-479) DOES
-- filter `expires_at > now() AND released_at IS NULL`, so stale holds
-- don't actually block new bookings — but they ARE unbounded table growth.
-- This migration adds a server-side reaper.
--
-- Additionally, scheduler_error_log (migration 20260516180000) has no
-- retention policy; without one the table grows monotonically. This
-- migration adds a daily pruner.
--
-- Both crons wrap their body in EXCEPTION WHEN OTHERS → INSERT INTO
-- scheduler_error_log per .claude/rules/observability.md rule 8. The
-- canonical job_failures table doesn't exist yet (deferred); reusing
-- scheduler_error_log is the equivalent triage surface and avoids
-- inventing a new table just for cron failures.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Hold reaper — every 30 min
-- ---------------------------------------------------------------------
-- Sets released_at = now() on appointment_holds rows where:
--   - released_at IS NULL (still considered "active" by the index)
--   - expires_at < now() - interval '1 hour' (1-hour grace beyond the
--     10-minute hold TTL so we don't race with an in-flight legitimate
--     beacon trying to release a hold that just expired)
--
-- Why not DELETE: preserve the row for postmortem analytics
-- ("how often does the beacon fail?"). The partial active-only index
-- (`appointment_holds_active_idx WHERE released_at IS NULL`) drops the
-- row from index size once released_at is set, so query performance
-- doesn't degrade.
--
-- Cadence: every 30 min. The 1-hour grace + 30-min cadence guarantees
-- a worst-case 90-minute lag between true-abandonment and reaper
-- visibility — well within Phase 1 acceptable window. Tighten to
-- every 10 min if growth analytics show it's needed.
-- ---------------------------------------------------------------------

SELECT public.cron_unschedule_if_exists('scheduler-hold-reaper');

SELECT cron.schedule(
  'scheduler-hold-reaper',
  '*/30 * * * *',
  $cron$
  DO $$
  DECLARE
    v_released_count INTEGER;
  BEGIN
    UPDATE public.appointment_holds
       SET released_at = now()
     WHERE released_at IS NULL
       AND expires_at < now() - interval '1 hour';

    GET DIAGNOSTICS v_released_count = ROW_COUNT;

    -- Best-effort observability: only log if we actually released something.
    -- Avoids a no-op INSERT every 30 min.
    IF v_released_count > 0 THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message, context)
      VALUES
        ('cron',
         'scheduler-hold-reaper',
         'cron/scheduler-hold-reaper',
         'info',
         'reaper_run',
         format('released %s stale appointment_holds', v_released_count),
         jsonb_build_object('released_count', v_released_count));
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
  $cron$
);


-- ---------------------------------------------------------------------
-- 2. scheduler_error_log pruner — daily at 03:00 UTC
-- ---------------------------------------------------------------------
-- Removes rows older than 180 days regardless of resolved_at. Rationale:
-- 180 days is enough postmortem horizon for ops triage on any reasonable
-- incident; older rows have no actionable value and bloat the table /
-- index. The bigserial PK is preserved (no resequencing). Runs once a
-- day during low-traffic UTC overnight window.
-- ---------------------------------------------------------------------

SELECT public.cron_unschedule_if_exists('scheduler-error-log-prune');

SELECT cron.schedule(
  'scheduler-error-log-prune',
  '0 3 * * *',
  $cron$
  DO $$
  DECLARE
    v_deleted_count INTEGER;
  BEGIN
    DELETE FROM public.scheduler_error_log
     WHERE occurred_at < now() - interval '180 days';

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    IF v_deleted_count > 0 THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message, context)
      VALUES
        ('cron',
         'scheduler-error-log-prune',
         'cron/scheduler-error-log-prune',
         'info',
         'prune_run',
         format('pruned %s expired scheduler_error_log rows', v_deleted_count),
         jsonb_build_object('deleted_count', v_deleted_count));
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO public.scheduler_error_log
        (origin, origin_id, surface, level, error_code, message, stack)
      VALUES
        ('cron',
         'scheduler-error-log-prune',
         'cron/scheduler-error-log-prune',
         'error',
         SQLSTATE,
         SQLERRM,
         NULL);
  END;
  $$;
  $cron$
);


-- ---------------------------------------------------------------------
-- 3. Notes for ops
-- ---------------------------------------------------------------------
-- After `supabase db push`, verify jobs landed:
--
--   SELECT jobname, schedule, active
--     FROM cron.job
--    WHERE jobname IN ('scheduler-hold-reaper', 'scheduler-error-log-prune');
--
-- Force a reaper run:
--
--   SELECT cron.schedule('manual-reaper', '* * * * *',
--     $$ <copy the body from above> $$);
--   -- wait a minute
--   SELECT cron.unschedule('manual-reaper');
--
-- Check reaper history:
--
--   SELECT * FROM public.scheduler_error_log
--    WHERE origin = 'cron'
--      AND origin_id IN ('scheduler-hold-reaper', 'scheduler-error-log-prune')
--    ORDER BY occurred_at DESC LIMIT 50;
-- ---------------------------------------------------------------------
