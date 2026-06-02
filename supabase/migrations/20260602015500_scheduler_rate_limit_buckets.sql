-- =====================================================================
-- SEC-7 rate-limit swap — per-phone rate limiter on Postgres
-- =====================================================================
-- 2026-06-02. Replaces the Upstash per-phone-hash limiter (3 sends /
-- phone-hash / hour) with a Supabase Postgres RPC + bucket table +
-- nightly pruner. The per-IP half moves to a Vercel Firewall edge rule
-- (no DB component). See:
--   docs/scheduler/plans/SEC-7-rate-limit-postgres-swap-plan.md
--   docs/scheduler/DEFERRED-AUDIT-ITEMS.md  (SEC-7, rate-limit half)
--
-- check_and_increment_rate_limit is an atomic (per-key advisory-locked)
-- sliding-window-log limiter: counts attempts for the key in the trailing
-- window; if under the max it records the attempt + allows, else denies +
-- returns retry_after_seconds. Called by the scheduler-app wizard actions
-- via the service-role admin client.
--
-- IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS; CREATE OR REPLACE
-- functions; cron unschedule-then-schedule.
-- =====================================================================

BEGIN;

-- ─── Bucket table (append-heavy, ephemeral, pruned at 24h) ──────────────
-- NOT shop-scoped: global platform abuse-prevention infra (like
-- webhook_events), keyed by an opaque rate-limit key (e.g. a phone hash),
-- never by shop. BIGINT identity PK matches the keytag attempts tables —
-- high insert churn; a UUID PK would bloat the index for no benefit.
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         text        NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rate_limit_buckets_key_time_idx
  ON public.rate_limit_buckets (key, occurred_at DESC);

-- service_role-only. The app calls via the admin/service-role client,
-- which BYPASSES RLS — enabling RLS with no policy denies anon +
-- authenticated (defense in depth; nothing else should ever read this).
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.rate_limit_buckets TO service_role;

-- ─── Atomic sliding-window limiter RPC ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key             text,
  p_window_seconds  integer,
  p_max             integer
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window interval := make_interval(secs => p_window_seconds);
  v_count  integer;
  v_oldest timestamptz;
BEGIN
  -- Serialize concurrent calls for THIS key within the txn so the
  -- count-then-insert can't double-spend under a burst. Other keys run
  -- in parallel. hashtext() maps the text key into the advisory-lock space.
  PERFORM pg_advisory_xact_lock(hashtext(p_key));

  SELECT count(*), min(b.occurred_at)
    INTO v_count, v_oldest
    FROM public.rate_limit_buckets AS b
   WHERE b.key = p_key
     AND b.occurred_at > now() - v_window;

  IF v_count >= p_max THEN
    -- Denied: do NOT record the attempt. retry_after = when the oldest
    -- in-window attempt ages out (floored at 1s).
    allowed := false;
    retry_after_seconds := GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM ((v_oldest + v_window) - now())))::integer
    );
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.rate_limit_buckets (key) VALUES (p_key);
  allowed := true;
  retry_after_seconds := 0;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer)
  TO service_role;

-- ─── Nightly pruner (rows age out at 24h; cheap GC) ─────────────────────
-- EXCEPTION → scheduler_error_log + RAISE per observability.md rule 8
-- (so cron.job_run_details also records failure). Mirrors
-- run_admin_snapshot_prune (20260522190500_fix_snapshot_prune_cron.sql).
CREATE OR REPLACE FUNCTION public.run_rate_limit_buckets_prune()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pruned integer;
BEGIN
  DELETE FROM public.rate_limit_buckets
   WHERE occurred_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_pruned = ROW_COUNT;

  IF v_pruned > 0 THEN
    INSERT INTO public.scheduler_error_log
      (origin, origin_id, surface, level, error_code, message, context)
    VALUES (
      'cron', 'rate-limit-buckets-prune', 'cron/rate-limit-buckets-prune',
      'info', 'prune_run', format('pruned %s rate-limit rows', v_pruned),
      jsonb_build_object('pruned_count', v_pruned)
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.scheduler_error_log
    (origin, origin_id, surface, level, error_code, message, context)
  VALUES (
    'cron', 'rate-limit-buckets-prune', 'cron/rate-limit-buckets-prune',
    'error', SQLSTATE, SQLERRM,
    jsonb_build_object('detail', 'rate-limit prune fn threw')
  );
  RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_rate_limit_buckets_prune()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_rate_limit_buckets_prune()
  TO postgres, service_role;

-- ─── Schedule the pruner (04:15 UTC daily; off-peak, distinct slot) ─────
SELECT public.cron_unschedule_if_exists('rate-limit-buckets-prune');
SELECT cron.schedule(
  'rate-limit-buckets-prune',
  '15 4 * * *',
  'SELECT public.run_rate_limit_buckets_prune();'
);

COMMIT;
