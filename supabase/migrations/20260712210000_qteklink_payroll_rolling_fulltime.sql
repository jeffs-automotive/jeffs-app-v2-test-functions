-- =====================================================================
-- QTekLink Payroll — rolling-26 avg hourly pay + full-time PTO gate (round-12)
-- =====================================================================
-- 2026-07-12. Plan: docs/qteklink/payroll-rolling-avg-fulltime-plan-2026-07-12.md
-- (v2 AMENDMENTS section supersedes). Two employee/PTO changes, one migration:
--
--   Feature A — rolling-26 average hourly pay. The leave-rate seed SHAPE
--   changes: leave_rate_seed_history entries were {period_start, work_pay_cents,
--   clock_hours} (a pay+hours pair the DAL divided). The new model averages the
--   MEAN of per-period RATES over 26 periods, so each seed entry now carries a
--   pre-computed rate directly: EXACTLY {period_start, avg_hourly_pay_cents}
--   (integer cents >= 0). The old key set is REJECTED. The <=26 cap is kept.
--   Matches types.ts LeaveRateSeedEntrySchema (co-edited on the TS track).
--   DB-VERIFIED 2026-07-12: 0 rows carry leave_rate_seed_history anywhere
--   (employees / run_employees / run snapshots) — the strict swap cannot break a
--   frozen re-parse (SnapshotEmployeeSchema re-validates pay_config on every
--   read). No legacy union, no data migration: a clean cutover (the seeding step
--   was deferred and never ran).
--
--   Feature B — full-time PTO gate. qteklink_payroll_employees gains
--   full_time boolean NOT NULL DEFAULT true (Chris: default true; the
--   part-timers get flipped off). The engine writes ACCRUAL rows only when
--   full_time = true; USAGE is unaffected (a part-timer with a balance still
--   decrements). The employee-PROFILE RPC gains full_time in its patch key set,
--   treated EXACTLY like pto_grandfathered: a boolean type-check that REJECTS
--   JSON null (NOT NULL column), and a present=write / absent=keep UPDATE arm.
--   The legacy upsert RPC is byte-untouched — its fixed column list excludes
--   full_time, so DEFAULT true survives an archive/unarchive.
--
-- 20260712200000 (the PTO phase) is ALREADY APPLIED — this is a FRESH migration
-- that CREATE OR REPLACEs the two functions into their existing signatures (no
-- overload churn). The re-create keeps the advisor-clean state; the full
-- REVOKE/GRANT idiom is re-applied on every re-created function (N1; model:
-- 20260607090000_qteklink_settings_ro_state.sql). Every other line of the two
-- functions is preserved byte-for-byte from 20260712200000.
-- Apply: orchestrator (supabase db push). IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Feature B §1 — full_time column (default true; the engine gates accrual on it,
-- the profile RPC below is its only writer among the new-column set).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.qteklink_payroll_employees
  ADD COLUMN IF NOT EXISTS full_time boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.qteklink_payroll_employees.full_time IS
  'Round-12: full-time flag (default true). Gates PTO ACCRUAL only — a part-time (full_time=false) employee accrues zero regardless of tenure/tiers/grandfather; USAGE still ledgers for anyone with paid PTO hours. Read LIVE at completion (via ptoFieldsFromEmployee on the master row), so a mid-cycle flip changes that run''s accrual. NOT NULL; patch value must be a JSON boolean. Written only via qteklink_payroll_update_employee_profile.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Feature A §2 — qteklink_payroll_validate_pay_config: rewrite ONLY the
-- leave_rate_seed_history structural block to the round-12 rate-only shape
-- (EXACTLY {period_start, avg_hourly_pay_cents}, integer cents >= 0; the old
-- {work_pay_cents, clock_hours} keys are rejected). <=26 cap kept. The whole
-- rest of the function is byte-identical to 20260712200000 (which itself carries
-- the 20260711030000 search_path pin inlined, keeping the advisor-clean state).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_payroll_validate_pay_config(
  p_role text,
  p_pay_config jsonb,
  p_allow_rates_w2 boolean,
  p_context text
)
RETURNS void
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_family   text;
  v_required text[];
  v_allowed  text[];
  v_key      text;
  v_val      jsonb;
  v_num      numeric;
  v_seed     jsonb;
BEGIN
  IF p_pay_config IS NULL OR jsonb_typeof(p_pay_config) <> 'object' THEN
    RAISE EXCEPTION '%: pay_config must be a JSON object', p_context;
  END IF;

  v_family := CASE p_role
    WHEN 'general_manager' THEN 'service_advisor'
    WHEN 'service_manager' THEN 'service_advisor'
    WHEN 'asst_manager'    THEN 'service_advisor'
    WHEN 'office_manager'  THEN 'office_manager'
    WHEN 'shop_foreman'    THEN 'shop_foreman'
    WHEN 'technician'      THEN 'technician'
    WHEN 'shop_support'    THEN 'support'
    WHEN 'office_support'  THEN 'support'
    ELSE NULL
  END;
  IF v_family IS NULL THEN
    RAISE EXCEPTION '%: unknown role "%"', p_context, p_role;
  END IF;

  -- Round-11 §2a: pto_balance_hours + pto_accrual_hours_per_period are no
  -- longer REQUIRED (the ledger + tier engine own PTO now) but stay ALLOWED
  -- forever — stored rows, void-cloned entry rows, and frozen snapshots are
  -- never backfilled.
  v_required := ARRAY['config_version']
    || CASE v_family
         WHEN 'technician'      THEN ARRAY['hourly_rate_cents','billed_rate_cents']
         WHEN 'shop_foreman'    THEN ARRAY['hourly_rate_cents','billed_rate_cents','shop_hour_goal','shop_hour_bonus_cents_per_hour']
         WHEN 'service_advisor' THEN ARRAY['weekly_salary_cents','gp_goal_1_cents','gp_goal_2_cents','sales_goal_cents',
                                           'tier1_pct','tier2_pct','tier3_pct','spiff_amount_cents']
         WHEN 'office_manager'  THEN ARRAY['hourly_rate_cents','sales_goal_cents','bonus_pct']
         ELSE                        ARRAY['hourly_rate_cents']  -- support
       END;
  v_allowed := v_required
    || ARRAY['pto_balance_hours','pto_accrual_hours_per_period']
    || CASE WHEN p_allow_rates_w2 THEN ARRAY['rates_w2'] ELSE ARRAY[]::text[] END
    -- round-4 leave-rate seeds (optional; tech/foreman only). The single rate is
    -- covered by the numeric loop's _cents_per_hour rule; the history array gets
    -- the structural block below.
    || CASE WHEN v_family IN ('technician','shop_foreman')
            THEN ARRAY['leave_rate_seed_cents_per_hour','leave_rate_seed_history']
            ELSE ARRAY[]::text[] END;

  -- reject unknown top-level keys
  FOR v_key IN SELECT jsonb_object_keys(p_pay_config) LOOP
    IF NOT v_key = ANY (v_allowed) THEN
      RAISE EXCEPTION '%: unknown pay_config key "%" for role %', p_context, v_key, p_role;
    END IF;
  END LOOP;

  -- required keys per role family
  FOREACH v_key IN ARRAY v_required LOOP
    IF NOT p_pay_config ? v_key THEN
      RAISE EXCEPTION '%: pay_config is missing required key "%" for role %', p_context, v_key, p_role;
    END IF;
  END LOOP;

  IF jsonb_typeof(p_pay_config->'config_version') <> 'number'
     OR (p_pay_config->>'config_version')::numeric <> 1 THEN
    RAISE EXCEPTION '%: pay_config.config_version must be 1', p_context;
  END IF;

  -- typed checks: *_cents (incl. _cents_per_hour) integers >= 0; *_pct numeric 0..1; rest numbers
  FOR v_key IN SELECT jsonb_object_keys(p_pay_config) LOOP
    IF v_key IN ('rates_w2', 'leave_rate_seed_history') THEN
      CONTINUE;  -- validated below (structured values, not bare numbers)
    END IF;
    v_val := p_pay_config->v_key;
    IF jsonb_typeof(v_val) <> 'number' THEN
      RAISE EXCEPTION '%: pay_config.% must be a number', p_context, v_key;
    END IF;
    v_num := (p_pay_config->>v_key)::numeric;
    IF v_key ~ '_cents(_per_hour)?$' THEN
      IF v_num < 0 OR v_num <> trunc(v_num) THEN
        RAISE EXCEPTION '%: pay_config.% must be an integer >= 0 (cents)', p_context, v_key;
      END IF;
    ELSIF v_key ~ '_pct$' THEN
      IF v_num < 0 OR v_num > 1 THEN
        RAISE EXCEPTION '%: pay_config.% must be a numeric between 0 and 1', p_context, v_key;
      END IF;
    END IF;
  END LOOP;

  -- optional per-run rates_w2 (mid-period rate change; week 1 uses the base fields)
  IF p_pay_config ? 'rates_w2' THEN
    IF jsonb_typeof(p_pay_config->'rates_w2') <> 'object' THEN
      RAISE EXCEPTION '%: pay_config.rates_w2 must be a JSON object', p_context;
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(p_pay_config->'rates_w2') LOOP
      IF v_key NOT IN ('hourly_rate_cents','billed_rate_cents','weekly_salary_cents') THEN
        RAISE EXCEPTION '%: unknown pay_config.rates_w2 key "%"', p_context, v_key;
      END IF;
      IF jsonb_typeof(p_pay_config->'rates_w2'->v_key) <> 'number' THEN
        RAISE EXCEPTION '%: pay_config.rates_w2.% must be a number', p_context, v_key;
      END IF;
      v_num := (p_pay_config->'rates_w2'->>v_key)::numeric;
      IF v_num < 0 OR v_num <> trunc(v_num) THEN
        RAISE EXCEPTION '%: pay_config.rates_w2.% must be an integer >= 0 (cents)', p_context, v_key;
      END IF;
    END LOOP;
  END IF;

  -- Round-12: leave-rate seed history (tech/foreman) is now a rate-only shape.
  -- Each entry is EXACTLY {period_start, avg_hourly_pay_cents} — a per-period
  -- average hourly RATE in integer cents (>= 0), because the round-12 model
  -- averages the MEAN of per-period rates over 26 periods (NOT Σpay÷Σhours).
  -- The old {work_pay_cents, clock_hours} keys are REJECTED (the swap is clean:
  -- DB-verified 0 rows carry this history anywhere). Max 26 entries (a year of
  -- bi-weekly periods). A completed run for the same period wins over the seed
  -- in the DAL (mergeLeaveRateWindow). Matches types.ts LeaveRateSeedEntrySchema.
  IF p_pay_config ? 'leave_rate_seed_history' THEN
    IF jsonb_typeof(p_pay_config->'leave_rate_seed_history') <> 'array' THEN
      RAISE EXCEPTION '%: pay_config.leave_rate_seed_history must be a JSON array', p_context;
    END IF;
    IF jsonb_array_length(p_pay_config->'leave_rate_seed_history') > 26 THEN
      RAISE EXCEPTION '%: pay_config.leave_rate_seed_history may hold at most 26 entries', p_context;
    END IF;
    FOR v_seed IN SELECT jsonb_array_elements(p_pay_config->'leave_rate_seed_history') LOOP
      IF jsonb_typeof(v_seed) <> 'object' THEN
        RAISE EXCEPTION '%: leave_rate_seed_history entries must be JSON objects', p_context;
      END IF;
      FOR v_key IN SELECT jsonb_object_keys(v_seed) LOOP
        IF v_key NOT IN ('period_start','avg_hourly_pay_cents') THEN
          RAISE EXCEPTION '%: unknown leave_rate_seed_history entry key "%"', p_context, v_key;
        END IF;
      END LOOP;
      IF NOT (v_seed ? 'period_start' AND v_seed ? 'avg_hourly_pay_cents') THEN
        RAISE EXCEPTION '%: leave_rate_seed_history entries require period_start + avg_hourly_pay_cents', p_context;
      END IF;
      IF jsonb_typeof(v_seed->'period_start') <> 'string'
         OR (v_seed->>'period_start') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION '%: leave_rate_seed_history.period_start must be a YYYY-MM-DD string', p_context;
      END IF;
      BEGIN
        PERFORM (v_seed->>'period_start')::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '%: leave_rate_seed_history.period_start "%" is not a valid date',
          p_context, v_seed->>'period_start';
      END;
      IF jsonb_typeof(v_seed->'avg_hourly_pay_cents') <> 'number' THEN
        RAISE EXCEPTION '%: leave_rate_seed_history.avg_hourly_pay_cents must be a number', p_context;
      END IF;
      v_num := (v_seed->>'avg_hourly_pay_cents')::numeric;
      IF v_num < 0 OR v_num <> trunc(v_num) THEN
        RAISE EXCEPTION '%: leave_rate_seed_history.avg_hourly_pay_cents must be an integer >= 0 (cents)', p_context;
      END IF;
    END LOOP;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_validate_pay_config(text, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Feature B §1 — the profile RPC gains full_time. Treated EXACTLY like
-- pto_grandfathered: added to c_allowed, a boolean type-check branch that
-- REJECTS JSON null (NOT NULL column), and a present=write / absent=keep UPDATE
-- arm. Every other line is byte-identical to 20260712200000 (CREATE OR REPLACE
-- into the same signature — no overload churn). The full REVOKE/GRANT is
-- re-applied.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_payroll_update_employee_profile(
  p_shop integer,
  p_employee uuid,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_archived boolean DEFAULT NULL,
  p_actor text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c_allowed CONSTANT text[] := ARRAY[
    'work_email','personal_email','personal_phone','work_phone','address',
    'start_date','termination_date','pto_grandfathered','pto_tenure_credit_date','full_time'];
  c_emails  CONSTANT text[] := ARRAY['work_email','personal_email'];
  c_texts   CONSTANT text[] := ARRAY['personal_phone','work_phone','address'];
  c_dates   CONSTANT text[] := ARRAY['start_date','termination_date','pto_tenure_credit_date'];
  v_emp     public.qteklink_payroll_employees%ROWTYPE;
  v_key     text;
  v_txt     text;
  v_changes jsonb := '{}'::jsonb;
  v_detail  jsonb;
BEGIN
  IF p_shop IS NULL OR p_shop <= 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: a positive p_shop is required';
  END IF;
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: a non-blank p_actor is required';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: p_patch must be a JSON object';
  END IF;
  IF p_patch = '{}'::jsonb AND p_archived IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: nothing to update (empty p_patch and no p_archived)';
  END IF;

  -- FOR NO KEY UPDATE (this RPC updates the row itself; grabbing the write
  -- lock at the read avoids a share->exclusive upgrade deadlock — the
  -- update_run idiom).
  SELECT * INTO v_emp FROM public.qteklink_payroll_employees e
  WHERE e.id = p_employee AND e.shop_id = p_shop FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: employee % not found for shop %', p_employee, p_shop;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT v_key = ANY (c_allowed) THEN
      RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: key "%" is not editable here', v_key;
    END IF;

    IF v_key IN ('pto_grandfathered','full_time') THEN
      -- NOT NULL columns: must be a JSON boolean (null does NOT clear here).
      IF jsonb_typeof(p_patch->v_key) <> 'boolean' THEN
        RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: % must be a boolean', v_key;
      END IF;
    ELSIF jsonb_typeof(p_patch->v_key) = 'null' THEN
      NULL;  -- JSON null clears the (nullable) column
    ELSIF v_key = ANY (c_emails) THEN
      IF jsonb_typeof(p_patch->v_key) <> 'string' THEN
        RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: % must be a string or null', v_key;
      END IF;
      v_txt := btrim(p_patch->>v_key);
      IF v_txt !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: % "%" does not look like an email address', v_key, p_patch->>v_key;
      END IF;
    ELSIF v_key = ANY (c_texts) THEN
      IF jsonb_typeof(p_patch->v_key) <> 'string' OR length(btrim(p_patch->>v_key)) = 0 THEN
        RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: % must be a non-blank string (use JSON null to clear)', v_key;
      END IF;
    ELSIF v_key = ANY (c_dates) THEN
      IF jsonb_typeof(p_patch->v_key) <> 'string'
         OR (p_patch->>v_key) !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: % must be a YYYY-MM-DD date string or null', v_key;
      END IF;
      BEGIN
        PERFORM (p_patch->>v_key)::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: % "%" is not a valid date', v_key, p_patch->>v_key;
      END;
    END IF;
  END LOOP;

  -- Unarchive auto-clears termination_date — a simultaneous non-null
  -- termination_date patch would contradict that; RAISE loudly.
  IF p_archived IS NOT DISTINCT FROM false
     AND p_patch ? 'termination_date'
     AND jsonb_typeof(p_patch->'termination_date') <> 'null' THEN
    RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: cannot set termination_date while unarchiving (p_archived=false clears it)';
  END IF;

  UPDATE public.qteklink_payroll_employees e SET
    work_email             = CASE WHEN p_patch ? 'work_email'             THEN nullif(btrim(coalesce(p_patch->>'work_email', '')), '')     ELSE e.work_email             END,
    personal_email         = CASE WHEN p_patch ? 'personal_email'         THEN nullif(btrim(coalesce(p_patch->>'personal_email', '')), '') ELSE e.personal_email         END,
    personal_phone         = CASE WHEN p_patch ? 'personal_phone'         THEN nullif(btrim(coalesce(p_patch->>'personal_phone', '')), '') ELSE e.personal_phone         END,
    work_phone             = CASE WHEN p_patch ? 'work_phone'             THEN nullif(btrim(coalesce(p_patch->>'work_phone', '')), '')     ELSE e.work_phone             END,
    address                = CASE WHEN p_patch ? 'address'                THEN nullif(btrim(coalesce(p_patch->>'address', '')), '')        ELSE e.address                END,
    start_date             = CASE WHEN p_patch ? 'start_date'             THEN (p_patch->>'start_date')::date                              ELSE e.start_date             END,
    termination_date       = CASE WHEN p_archived IS NOT DISTINCT FROM false THEN NULL
                                  WHEN p_patch ? 'termination_date'       THEN (p_patch->>'termination_date')::date
                                  ELSE e.termination_date END,
    pto_grandfathered      = CASE WHEN p_patch ? 'pto_grandfathered'      THEN (p_patch->>'pto_grandfathered')::boolean                    ELSE e.pto_grandfathered      END,
    pto_tenure_credit_date = CASE WHEN p_patch ? 'pto_tenure_credit_date' THEN (p_patch->>'pto_tenure_credit_date')::date                  ELSE e.pto_tenure_credit_date END,
    full_time              = CASE WHEN p_patch ? 'full_time'              THEN (p_patch->>'full_time')::boolean                            ELSE e.full_time              END,
    archived_at            = CASE WHEN p_archived IS NULL THEN e.archived_at
                                  WHEN p_archived THEN coalesce(e.archived_at, now())
                                  ELSE NULL END,
    updated_by_label       = p_actor,
    updated_at             = now()
  WHERE e.id = p_employee AND e.shop_id = p_shop;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    v_changes := v_changes || jsonb_build_object(
      v_key, jsonb_build_object('old', to_jsonb(v_emp)->v_key, 'new', p_patch->v_key));
  END LOOP;
  v_detail := jsonb_build_object('changes', v_changes);
  IF p_archived IS NOT NULL THEN
    v_detail := v_detail || jsonb_build_object('archived',
      jsonb_build_object('old', v_emp.archived_at IS NOT NULL, 'new', p_archived));
  END IF;
  IF p_archived IS NOT DISTINCT FROM false AND v_emp.termination_date IS NOT NULL THEN
    -- preserve the auto-cleared value (C8/C23/C36)
    v_detail := v_detail || jsonb_build_object('termination_date_cleared', to_jsonb(v_emp.termination_date));
  END IF;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, employee_id, actor_label, action, detail)
  VALUES (p_shop, p_employee, p_actor, 'employee_profile_updated', v_detail);
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_update_employee_profile(integer, uuid, jsonb, boolean, text) IS
  'Patch the round-11/12 employee profile columns (key present = write, JSON null clears the nullable ones; pto_grandfathered + full_time are NOT NULL so JSON null RAISEs; key absent = keep) + optionally flip archived_at (p_archived=false auto-clears termination_date; the cleared value rides in the audit detail). The legacy upsert RPC stays byte-untouched — this is the ONLY writer of the profile columns.';
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_update_employee_profile(integer, uuid, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_update_employee_profile(integer, uuid, jsonb, boolean, text) TO service_role;

COMMIT;
