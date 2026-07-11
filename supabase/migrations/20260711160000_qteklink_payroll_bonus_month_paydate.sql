-- =====================================================================
-- QTekLink Payroll — bonus month derives from the PAY DATE + explicit
-- office-manager month pick + shop_hour_goal override
-- (round-5 decisions #32/#33, docs/qteklink/payroll-workbook-extraction-2026-07-10.md)
-- =====================================================================
-- 2026-07-11.
--
-- 1. qteklink_payroll_update_run (CREATE OR REPLACE; base = 20260710210000):
--    a. BUG FIX (#33, live): the auto bonus month now derives from PERIOD_END —
--       date_trunc('month', period_end) - interval '1 month'. The 6/28–7/11 run
--       is PAID in July, so its bonus month is June; the old period_start
--       derivation wrongly gave May.
--    b. The patch whitelist gains 'bonus_month' (#33 fallback): an explicit
--       first-of-month date the office manager can pick. Validated (string,
--       YYYY-MM-DD, real date, first of month) and only accepted while
--       bonus_period is true or becoming true in the same patch; explicit wins
--       over derivation; a re-sent bonus_period=true never clobbers an earlier
--       explicit pick; clearing bonus_period still nulls the month. Audited
--       old -> new (same audit shape as before).
--
-- 2. One-time data correction (#33, live): the open 6/28–7/11 run was toggled
--    bonus_period=true BEFORE this migration and stored the stale
--    period_start-derived bonus_month (May). The fixed derivation in (1) only
--    runs on an OFF->ON transition, and an idempotent bonus_period=true re-send
--    keeps the stored month — so the stale May would never self-heal. A guarded
--    UPDATE re-derives bonus_month from period_end for exactly the stale shape
--    (+ a 'run_updated' audit row). Safe + idempotent: see the inline comment.
--
-- 3. qteklink_payroll_validate_overrides (CREATE OR REPLACE; base =
--    20260710210000 + the 20260711030000 search_path pin, now inlined so the
--    re-create keeps it): the whitelist gains 'shop_hour_goal' (#32 — the
--    foreman goal is auto-derived from prior-year shop hours and must be
--    overridable per run like the SA sales goal).
--
-- Every other guard, lock comment, and audit write is byte-identical to the
-- current bodies. Grant idiom restated (CREATE OR REPLACE preserves ACLs, but
-- the REVOKE/GRANT block keeps the migration self-describing + idempotent).
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- Whitelisted patch: bonus_period (boolean) + bonus_month (explicit first-of-month
-- date, round-5 #33). Slider ON derives bonus_month = first of (month of PERIOD_END
-- - 1 month) — the month before the pay date; an explicit bonus_month wins over the
-- derivation; OFF clears it. Open runs only.
CREATE OR REPLACE FUNCTION public.qteklink_payroll_update_run(
  p_run_id uuid,
  p_patch jsonb,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run   public.qteklink_payroll_runs%ROWTYPE;
  v_key   text;
  v_bonus boolean;
  v_month date;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'qteklink_payroll_update_run: a non-empty JSON object p_patch is required';
  END IF;
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_update_run: a non-blank p_actor_label is required';
  END IF;
  -- FOR NO KEY UPDATE (this RPC updates the row itself; grabbing the write lock at
  -- the read avoids a share->exclusive upgrade deadlock) serializes the bonus toggle
  -- against complete_run/void_run's FOR UPDATE — the status check below always sees
  -- the final status of an overlapping completion.
  SELECT * INTO v_run FROM public.qteklink_payroll_runs r WHERE r.id = p_run_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_update_run: run % not found', p_run_id;
  END IF;
  IF v_run.status <> 'open' THEN
    RAISE EXCEPTION 'qteklink_payroll_update_run: run % is % — it can no longer be edited', p_run_id, v_run.status;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN ('bonus_period', 'bonus_month') THEN
      RAISE EXCEPTION 'qteklink_payroll_update_run: key "%" is not editable', v_key;
    END IF;
  END LOOP;

  -- Effective slider state: the patch value when present, else the stored one.
  IF p_patch ? 'bonus_period' THEN
    IF jsonb_typeof(p_patch->'bonus_period') <> 'boolean' THEN
      RAISE EXCEPTION 'qteklink_payroll_update_run: bonus_period must be a boolean';
    END IF;
    v_bonus := (p_patch->>'bonus_period')::boolean;
  ELSE
    v_bonus := v_run.bonus_period;
  END IF;

  IF p_patch ? 'bonus_month' THEN
    -- Explicit month (round-5 #33 office-manager escape hatch): only meaningful
    -- while the run IS (or is becoming, in this same patch) a bonus run; wins
    -- over the derivation below.
    IF NOT v_bonus THEN
      RAISE EXCEPTION 'qteklink_payroll_update_run: bonus_month can only be set while bonus_period is on';
    END IF;
    IF jsonb_typeof(p_patch->'bonus_month') <> 'string'
       OR (p_patch->>'bonus_month') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'qteklink_payroll_update_run: bonus_month must be a YYYY-MM-DD date string';
    END IF;
    BEGIN
      v_month := (p_patch->>'bonus_month')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'qteklink_payroll_update_run: bonus_month "%" is not a valid date', p_patch->>'bonus_month';
    END;
    IF v_month <> date_trunc('month', v_month::timestamp)::date THEN
      RAISE EXCEPTION 'qteklink_payroll_update_run: bonus_month must be the first day of a month';
    END IF;
  ELSIF NOT v_bonus THEN
    -- Clearing (or staying off) still nulls the month.
    v_month := NULL;
  ELSIF NOT v_run.bonus_period THEN
    -- Slider turning ON with no explicit pick: derive the month before the PAY
    -- DATE (round-5 #33 — the 6/28..7/11 run is paid in July => June; the old
    -- period_start derivation wrongly gave May).
    v_month := (date_trunc('month', v_run.period_end::timestamp) - interval '1 month')::date;
  ELSE
    -- Slider already on, no explicit pick in this patch: keep the stored month —
    -- an idempotent bonus_period=true re-send must not clobber an earlier
    -- explicit office-manager pick.
    v_month := v_run.bonus_month;
  END IF;

  UPDATE public.qteklink_payroll_runs r
  SET bonus_period = v_bonus, bonus_month = v_month, updated_at = now()
  WHERE r.id = p_run_id;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
  VALUES (v_run.shop_id, p_run_id, p_actor_user_id, p_actor_label, 'run_updated',
          jsonb_build_object(
            'bonus_period', jsonb_build_object('old', v_run.bonus_period, 'new', v_bonus),
            'bonus_month',  jsonb_build_object('old', v_run.bonus_month,  'new', v_month)));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_update_run(uuid, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_update_run(uuid, jsonb, uuid, text) TO service_role;

-- ─── One-time data correction (round-5 #33, live) ────────────────────────────
-- Any run toggled bonus_period=true BEFORE this migration stored the old
-- period_start-derived bonus_month (the live open 6/28–7/11 run: May instead of
-- June). The fixed derivation above only fires on an OFF->ON transition, and an
-- idempotent bonus_period=true re-send deliberately keeps the stored month — so
-- without this the stale month never self-heals and every bonus derivation
-- (month sales, GP, QBO 6010 tech cost, SA prior-year goal, foreman prior-year
-- hours, spiffs) keeps computing the wrong month.
--
-- Safe: explicit office-manager picks cannot exist pre-migration (this very
-- migration introduces the bonus_month patch key), so a stored month that
-- matches the period_start derivation is machine-derived. Only open bonus runs
-- whose stored month matches the OLD derivation AND differs from the NEW one
-- are touched. Idempotent: after the fix the WHERE no longer matches (and the
-- audit row is only written for actually-corrected rows). The updated_at bump
-- invalidates any outstanding Pattern S confirm token via the state hash. If a
-- non-voided bonus run already held the corrected month, the partial unique
-- (shop_id, bonus_month) index would abort this migration loudly — fail-closed.
WITH corrected AS (
  UPDATE public.qteklink_payroll_runs r
  SET bonus_month = (date_trunc('month', r.period_end::timestamp) - interval '1 month')::date,
      updated_at  = now()
  WHERE r.status = 'open'
    AND r.bonus_period
    AND r.bonus_month = (date_trunc('month', r.period_start::timestamp) - interval '1 month')::date
    AND r.bonus_month <> (date_trunc('month', r.period_end::timestamp) - interval '1 month')::date
  RETURNING r.id, r.shop_id, r.period_start, r.bonus_month
)
INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
SELECT c.shop_id, c.id, NULL, 'migration:20260711160000', 'run_updated',
       jsonb_build_object(
         'bonus_period', jsonb_build_object('old', true, 'new', true),
         'bonus_month',  jsonb_build_object(
           'old', (date_trunc('month', c.period_start::timestamp) - interval '1 month')::date,
           'new', c.bonus_month),
         'note', 'one-time correction (round-5 #33): stale period_start-derived bonus_month re-derived from the pay date (period_end)')
FROM corrected c;

-- Overrides whitelist + shop_hour_goal (round-5 #32). Body otherwise identical to
-- 20260710210000; the 20260711030000 ALTER's search_path pin is inlined in the
-- header so this re-create keeps the advisor-clean state.
CREATE OR REPLACE FUNCTION public.qteklink_payroll_validate_overrides(
  p_overrides jsonb,
  p_context text
)
RETURNS void
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  c_allowed CONSTANT text[] := ARRAY['billed_hours_w1','billed_hours_w2','month_sales_cents',
    'month_gp_with_fees_cents','month_gp_without_fees_cents','spiff_count','shop_hours',
    'sales_goal_cents','leave_rate_cents_per_hour','shop_hour_goal'];
  v_key   text;
  v_inner text;
  v_entry jsonb;
BEGIN
  IF p_overrides IS NULL OR jsonb_typeof(p_overrides) <> 'object' THEN
    RAISE EXCEPTION '%: overrides must be a JSON object', p_context;
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_overrides) LOOP
    IF NOT v_key = ANY (c_allowed) THEN
      RAISE EXCEPTION '%: unknown overrides key "%"', p_context, v_key;
    END IF;
    v_entry := p_overrides->v_key;
    IF jsonb_typeof(v_entry) <> 'object' THEN
      RAISE EXCEPTION '%: overrides.% must be an object of shape {value, note}', p_context, v_key;
    END IF;
    IF NOT v_entry ? 'value' OR jsonb_typeof(v_entry->'value') <> 'number' THEN
      RAISE EXCEPTION '%: overrides.%.value must be a number', p_context, v_key;
    END IF;
    IF v_entry ? 'note' AND jsonb_typeof(v_entry->'note') <> 'string' THEN
      RAISE EXCEPTION '%: overrides.%.note must be a string', p_context, v_key;
    END IF;
    FOR v_inner IN SELECT jsonb_object_keys(v_entry) LOOP
      IF v_inner NOT IN ('value','note') THEN
        RAISE EXCEPTION '%: overrides.% may only contain value + note (found "%")', p_context, v_key, v_inner;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_validate_overrides(jsonb, text) FROM PUBLIC, anon, authenticated;

COMMIT;
