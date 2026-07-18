-- =====================================================================
-- Back Office — Reopened-RO: net-change saga model (2026-07-18)
-- =====================================================================
-- Feature back-office-reopened-history. Plan: docs/back-office/reopened-ro-history-plan.md.
--
-- Replaces the per-unpost-CYCLE model with a per-RO net SAGA model:
--   * dedup is now "one un-verified reopened_ro issue per (shop, RO)" — a partial unique
--     index — instead of one row per unpost cycle. Verifying a row frees the slot so a
--     LATER reopen (D7) can open a fresh active issue re-baselined from the verified state.
--   * `context` carries baseline_* / final_* / final_at / a full posting-lifecycle `history[]`
--     (see back-office-detect.ts). Only ROs with a real net change are written (the edge
--     detector suppresses same-day-total-only and corrected/no-net-change sagas — D1/D6).
--
-- The 18 existing reopened_ro rows (all status='open', source='tekmetric_detection',
-- 0 human-touched) are deleted and rebuilt by a one-time wide-lookback cron run after deploy.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- 1. Dedup index: per-cycle → one active (un-verified) issue per RO ------------
DROP INDEX IF EXISTS public.back_office_issues_reopened_cycle;

CREATE UNIQUE INDEX IF NOT EXISTS back_office_issues_reopened_active
  ON public.back_office_issues (shop_id, tekmetric_ro_id)
  WHERE kind = 'reopened_ro' AND status <> 'verified';

-- 2. Clear the old-shape rows so the backfill rebuilds them in the new shape ---
--    Scoped to auto-detected, untouched rows (defensive — never delete human work).
DELETE FROM public.back_office_issues
 WHERE kind = 'reopened_ro'
   AND status = 'open'
   AND source = 'tekmetric_detection';

-- 3. Upsert RPC — new saga context shape + active-row dedup --------------------
-- p_cycle (from buildReopenedSaga): {
--   ro_number, change_type (date_changed|total_changed|date_and_total_changed),
--   saga_started_at, reopened_by, baseline_posted_date, baseline_total_cents,
--   final_posted_date, final_total_cents, final_at, history[]
-- }
-- Returns the issue id + whether it was newly created (so the cron only alerts on new).
CREATE OR REPLACE FUNCTION public.back_office_upsert_reopened(
  p_shop_id         integer,
  p_tekmetric_ro_id bigint,
  p_cycle           jsonb
)
RETURNS TABLE (issue_id uuid, was_created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_created boolean;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_tekmetric_ro_id IS NULL OR p_tekmetric_ro_id <= 0 THEN
    RAISE EXCEPTION 'back_office_upsert_reopened: positive p_shop_id + p_tekmetric_ro_id are required';
  END IF;
  IF p_cycle->>'change_type' IS NULL
     OR p_cycle->>'change_type' NOT IN ('date_changed', 'total_changed', 'date_and_total_changed') THEN
    RAISE EXCEPTION 'back_office_upsert_reopened: p_cycle.change_type must be date_changed|total_changed|date_and_total_changed';
  END IF;

  INSERT INTO public.back_office_issues (
    shop_id, kind, status, source, ro_number, tekmetric_ro_id, total_cents, context, last_activity_at
  )
  VALUES (
    p_shop_id, 'reopened_ro', 'open', 'tekmetric_detection',
    nullif(btrim(p_cycle->>'ro_number'), ''),
    p_tekmetric_ro_id,
    (p_cycle->>'final_total_cents')::bigint,
    p_cycle,
    now()
  )
  ON CONFLICT (shop_id, tekmetric_ro_id) WHERE kind = 'reopened_ro' AND status <> 'verified'
  DO UPDATE SET
    context     = p_cycle,
    ro_number   = coalesce(nullif(btrim(p_cycle->>'ro_number'), ''), public.back_office_issues.ro_number),
    total_cents = coalesce((p_cycle->>'final_total_cents')::bigint, public.back_office_issues.total_cents),
    updated_at  = now()
  RETURNING id, (xmax = 0) INTO v_id, v_created;

  IF v_created THEN
    INSERT INTO public.back_office_issue_events (issue_id, action, prior_status, new_status, actor_app, note)
    VALUES (v_id, 'detected', NULL, 'open', 'system', p_cycle->>'change_type');
  END IF;

  RETURN QUERY SELECT v_id, v_created;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_upsert_reopened(integer, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_upsert_reopened(integer, bigint, jsonb) TO service_role;

COMMIT;
