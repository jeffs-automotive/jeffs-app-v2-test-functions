-- =====================================================================
-- QTekLink Payroll — PTO + employee management (round-11 decisions #52–#60)
-- =====================================================================
-- 2026-07-12. Plan: docs/qteklink/payroll-pto-employee-mgmt-plan-2026-07-12.md
-- (v2 — folds in all 37 confirmed regression-check findings). Stage 1 of the
-- PTO + employee-management phase:
--
--   §2a  qteklink_payroll_employees gains 9 profile columns; ALL new-column
--        writes go through the NEW qteklink_payroll_update_employee_profile
--        (patch semantics). qteklink_payroll_upsert_employee is BYTE-UNTOUCHED
--        (C2/C3/C11/C18/C24/C30) — its three pass-through callers structurally
--        cannot touch or wipe the new columns. The legacy pay_config PTO keys
--        (pto_balance_hours / pto_accrual_hours_per_period) are demoted from
--        required to optional in the SQL validator — still ALLOWED forever
--        (stored rows, void-cloned entry rows, and frozen snapshots are never
--        backfilled) (C6/C22/N5/N12).
--   §2b  qteklink_payroll_pto_ledger — RPC-write-only, the single balance
--        truth. Partial UNIQUEs as INDEXES (C34), CHECK guards (C4/C9/C19/C29),
--        per-shop advisory lock discipline (C13). Standalone RPC
--        qteklink_payroll_adjust_pto for kinds initial/adjustment ONLY;
--        run-driven kinds are written exclusively inside complete_run/void_run.
--   §2c  qteklink_payroll_email_log — the §5 wrong-recipient safety rail.
--        One identity row per (run, employee, 'pay_summary') EVER (partial
--        UNIQUE INDEX + NULL-dodge CHECK); pay_summary rows are born ONLY
--        inside the completion transaction; finalized via the atomic claim RPC
--        qteklink_payroll_transition_email (pending→sent, pending→failed,
--        failed→pending are the ONLY legal transitions; sent is TERMINAL —
--        that transition IS the never-double-send guarantee, C27).
--        qteklink_payroll_log_email inserts rows for the two NON-completion
--        kinds (pto_adjustment / pto_negative) — it REFUSES pay_summary.
--   §2d  qteklink_upsert_settings (existing 10-param signature — NO change;
--        its pgTAP pins the 10-param form): the payroll validator gains the
--        four PTO keys, each validated ONLY when present (the
--        anchor_period_start idiom, C7); absent/null/[] tiers = valid
--        "unconfigured"; deliberately NO top-level key whitelist.
--   §4   qteklink_payroll_complete_run DROP-then-recreated (drop the exact
--        old 7-param signature — NEVER CREATE OR REPLACE into an overload,
--        which breaks PostgREST named/positional resolution for the LIVE
--        dance) with a trailing p_pto_entries jsonb DEFAULT NULL. Dry-run
--        branch ignores it (the hash/token Pattern-S flow is byte-identical).
--        NULL p_pto_entries = legacy behavior byte-identical (the LIVE app
--        keeps completing runs between db push and the TS deploy). Non-NULL:
--        inside the ONE transaction, under the shop ledger advisory lock,
--        BEFORE the status flip — ledger inserts (accrual/usage/
--        rollover_forfeit) + running-balance stamps + §2c email-log
--        pre-inserts. Any RAISE (incl. the UNIQUE guards) rolls back the
--        WHOLE completion (C5/C12/C32 — never the post-confirm never-throw
--        idiom here). rollover_forfeit is at-most-once per (employee,
--        boundary_year): the RPC receives precomputed entries but enforces
--        the no-un-reversed-forfeit check in-transaction under the lock (C33).
--        qteklink_payroll_void_run DROP-then-recreated (same 7-param
--        signature, extended body): kind='void_reversal' rows with
--        reverses_ledger_id write inside ITS transaction, between the status
--        flip and the clone.
--
-- LOCK INVARIANT (C13) — all payroll ledger writers: run row → shop ledger
-- advisory (pg_advisory_xact_lock over 'qteklink_payroll_pto_ledger:<shop>');
-- never interleave. One lock class ⇒ deadlock cycles are unconstructible, and
-- adjustments serialize against completions (the running-balance stamp
-- requires that anyway).
--
-- Grant idiom: RLS deny-all; service_role SELECT-only; writes only via
-- SECURITY DEFINER RPCs (SET search_path = public); REVOKE EXECUTE FROM
-- PUBLIC/anon/authenticated + GRANT service_role on EVERY new/re-created
-- function (N1; model: 20260607090000_qteklink_settings_ro_state.sql).
-- Apply: orchestrator (supabase db push). IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2a — employee profile columns (all writes via the NEW profile RPC below)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.qteklink_payroll_employees
  ADD COLUMN IF NOT EXISTS work_email             text,
  ADD COLUMN IF NOT EXISTS personal_email         text,
  ADD COLUMN IF NOT EXISTS personal_phone         text,
  ADD COLUMN IF NOT EXISTS work_phone             text,
  ADD COLUMN IF NOT EXISTS address                text,
  ADD COLUMN IF NOT EXISTS start_date             date,
  ADD COLUMN IF NOT EXISTS termination_date       date,
  ADD COLUMN IF NOT EXISTS pto_grandfathered      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pto_tenure_credit_date date;

COMMENT ON COLUMN public.qteklink_payroll_employees.work_email IS
  'Round-11 #52: work email — stored for later use (no send path yet). Written only via qteklink_payroll_update_employee_profile.';
COMMENT ON COLUMN public.qteklink_payroll_employees.personal_email IS
  'Round-11 #52/#53: PERSONAL email — the pay-summary + employee-alert recipient. Blank/NULL ⇒ completion pre-inserts a skipped_no_email pay_summary row. Written only via qteklink_payroll_update_employee_profile.';
COMMENT ON COLUMN public.qteklink_payroll_employees.start_date IS
  'Round-11 #55: tenure anchor for PTO eligibility (first cadence period ≥ start_date + 6 full periods) and tier lookup (unless pto_tenure_credit_date overrides). Written only via the profile RPC.';
COMMENT ON COLUMN public.qteklink_payroll_employees.termination_date IS
  'Round-11 #52: set via the ARCHIVE modal (one profile-RPC call). termination_date < period_start ⇒ no accrual (usage still ledgers — C37). Unarchive (p_archived=false) AUTO-CLEARS it (C8/C23/C36 — a rehired employee must accrue again; the cleared value is preserved in the audit detail).';
COMMENT ON COLUMN public.qteklink_payroll_employees.pto_grandfathered IS
  'Round-11 #55: waives the 6-full-period PTO wait (matters only for employees the calendar math has not yet cleared — C35). NOT NULL; patch value must be a JSON boolean.';
COMMENT ON COLUMN public.qteklink_payroll_employees.pto_tenure_credit_date IS
  'Round-11 #55: overrides start_date for TIER lookup only (acquired-company seniority). Never affects eligibility.';

-- ─────────────────────────────────────────────────────────────────────────────
-- §2b — qteklink_payroll_pto_ledger (RPC-write-only, the single balance truth)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_payroll_pto_ledger (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             integer     NOT NULL,
  employee_id         uuid        NOT NULL REFERENCES public.qteklink_payroll_employees(id),
  run_id              uuid        REFERENCES public.qteklink_payroll_runs(id),
  kind                text        NOT NULL,
  -- signed; matches the run_employees NUMERIC-hours idiom (money never stored here, N14)
  hours               numeric(7,2) NOT NULL,
  -- running balance stamped in-RPC under the shop ledger advisory lock
  balance_after_hours numeric(8,2) NOT NULL,
  reason              text,
  -- void_reversal → the exact row it negates
  reverses_ledger_id  uuid        REFERENCES public.qteklink_payroll_pto_ledger(id),
  -- rollover_forfeit → the calendar year it applies to
  boundary_year       integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by_label    text        NOT NULL,
  CONSTRAINT qteklink_payroll_pto_ledger_kind_valid CHECK
    (kind IN ('initial','accrual','usage','adjustment','rollover_forfeit','void_reversal')),
  -- NULLs can't dodge the completion-idempotency guard; reversals keep the voided run's linkage.
  CONSTRAINT qteklink_payroll_pto_ledger_run_required CHECK
    (kind NOT IN ('accrual','usage','void_reversal') OR run_id IS NOT NULL),
  CONSTRAINT qteklink_payroll_pto_ledger_adjustment_reason CHECK
    (kind <> 'adjustment' OR reason IS NOT NULL),
  CONSTRAINT qteklink_payroll_pto_ledger_forfeit_year CHECK
    (kind <> 'rollover_forfeit' OR boundary_year IS NOT NULL),
  -- fat-finger bound (N14)
  CONSTRAINT qteklink_payroll_pto_ledger_hours_bound CHECK (abs(hours) <= 500),
  CONSTRAINT qteklink_payroll_pto_ledger_reversal_target CHECK
    (kind <> 'void_reversal' OR reverses_ledger_id IS NOT NULL)
);

-- Completion idempotency ONLY (accrual/usage; forfeits are guarded per
-- (employee, boundary_year) in-RPC — a partial UNIQUE here would collide with
-- void-and-clone). Partial UNIQUE as an INDEX (C34 — partial UNIQUE
-- constraints don't exist in CREATE TABLE).
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_payroll_pto_ledger_run_kind_identity
  ON public.qteklink_payroll_pto_ledger (run_id, employee_id, kind)
  WHERE kind IN ('accrual','usage');

-- Per-row void idempotency: a ledger row can be reversed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_payroll_pto_ledger_reversal_identity
  ON public.qteklink_payroll_pto_ledger (reverses_ledger_id)
  WHERE reverses_ledger_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS qteklink_payroll_pto_ledger_employee
  ON public.qteklink_payroll_pto_ledger (shop_id, employee_id, created_at);
CREATE INDEX IF NOT EXISTS qteklink_payroll_pto_ledger_run
  ON public.qteklink_payroll_pto_ledger (run_id);

COMMENT ON TABLE public.qteklink_payroll_pto_ledger IS
  'QTekLink PTO ledger — append-style, RPC-write-only, the SINGLE balance truth (balance = sum(hours) = last balance_after_hours). Kinds: initial/adjustment via qteklink_payroll_adjust_pto ONLY; accrual/usage/rollover_forfeit written exclusively inside qteklink_payroll_complete_run; void_reversal exclusively inside qteklink_payroll_void_run. Every writer serializes on the per-shop advisory lock (run row → shop ledger advisory; never interleave — C13). service_role SELECT-only.';

ALTER TABLE public.qteklink_payroll_pto_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payroll_pto_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payroll_pto_ledger TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payroll_pto_ledger FROM service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2c — qteklink_payroll_email_log (the §5 safety rail; RPC-write-only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_payroll_email_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     integer     NOT NULL,
  run_id      uuid,
  employee_id uuid,
  kind        text        NOT NULL,
  recipient   text        NOT NULL DEFAULT '',
  subject     text        NOT NULL DEFAULT '',
  status      text        NOT NULL,
  sent_at     timestamptz,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_payroll_email_log_kind_valid CHECK
    (kind IN ('pay_summary','pto_adjustment','pto_negative')),
  CONSTRAINT qteklink_payroll_email_log_status_valid CHECK
    (status IN ('pending','sent','failed','skipped_no_email')),
  -- no pay-summary row can dodge exactly-once via NULLs
  CONSTRAINT qteklink_payroll_email_log_pay_summary_identity_required CHECK
    (kind <> 'pay_summary' OR (run_id IS NOT NULL AND employee_id IS NOT NULL))
);

-- One row per (run, employee) pay-summary identity, EVER (partial INDEX, not
-- an inline constraint — C34). Pre-inserted pending/skipped_no_email inside
-- the completion transaction; finalized by the atomic claim RPC.
CREATE UNIQUE INDEX IF NOT EXISTS qteklink_payroll_email_log_pay_summary_identity
  ON public.qteklink_payroll_email_log (run_id, employee_id, kind)
  WHERE kind = 'pay_summary';

CREATE INDEX IF NOT EXISTS qteklink_payroll_email_log_run
  ON public.qteklink_payroll_email_log (run_id);

COMMENT ON TABLE public.qteklink_payroll_email_log IS
  'QTekLink payroll email audit + exactly-once rail (plan §2c/§5). pay_summary rows are born ONLY inside qteklink_payroll_complete_run (pending per emailable employee, skipped_no_email per skip); pto_adjustment/pto_negative rows via qteklink_payroll_log_email. Legal transitions (qteklink_payroll_transition_email): pending→sent, pending→failed, failed→pending. sent is TERMINAL — that transition IS the never-double-send guarantee. Teardown loss surfaces as stuck-pending rows: visible, retryable, never silent. service_role SELECT-only.';

ALTER TABLE public.qteklink_payroll_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payroll_email_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payroll_email_log TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payroll_email_log FROM service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2a — pay_config validator: legacy PTO keys demoted required → optional
-- (C6/C22/N5/N12). Body otherwise identical to 20260710210000; the
-- 20260711030000 ALTER's search_path pin is inlined in the header so this
-- re-create keeps the advisor-clean state (the 20260711160000 precedent).
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

  -- optional round-4 leave-rate seed history (tech/foreman): pre-qteklink per-period
  -- figures written by scripts/payroll-seed-leave-rates.mjs. Max 26 entries (a year
  -- of bi-weekly periods); each entry is EXACTLY {period_start, work_pay_cents,
  -- clock_hours}. A completed run for the same period wins over the seed in the DAL.
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
        IF v_key NOT IN ('period_start','work_pay_cents','clock_hours') THEN
          RAISE EXCEPTION '%: unknown leave_rate_seed_history entry key "%"', p_context, v_key;
        END IF;
      END LOOP;
      IF NOT (v_seed ? 'period_start' AND v_seed ? 'work_pay_cents' AND v_seed ? 'clock_hours') THEN
        RAISE EXCEPTION '%: leave_rate_seed_history entries require period_start + work_pay_cents + clock_hours', p_context;
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
      IF jsonb_typeof(v_seed->'work_pay_cents') <> 'number' THEN
        RAISE EXCEPTION '%: leave_rate_seed_history.work_pay_cents must be a number', p_context;
      END IF;
      v_num := (v_seed->>'work_pay_cents')::numeric;
      IF v_num < 0 OR v_num <> trunc(v_num) THEN
        RAISE EXCEPTION '%: leave_rate_seed_history.work_pay_cents must be an integer >= 0 (cents)', p_context;
      END IF;
      IF jsonb_typeof(v_seed->'clock_hours') <> 'number' THEN
        RAISE EXCEPTION '%: leave_rate_seed_history.clock_hours must be a number', p_context;
      END IF;
      IF (v_seed->>'clock_hours')::numeric < 0 THEN
        RAISE EXCEPTION '%: leave_rate_seed_history.clock_hours must be >= 0', p_context;
      END IF;
    END LOOP;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_validate_pay_config(text, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2d — qteklink_upsert_settings: the payroll validator gains the four PTO
-- keys. Existing 10-param signature UNCHANGED (its pgTAP pins the 10-param
-- form; CREATE OR REPLACE into the same signature — no overload). Each new
-- key is validated ONLY when present (the anchor_period_start idiom, C7);
-- absent/null/[] tiers = valid "unconfigured"; NO top-level key whitelist.
-- Body otherwise identical to 20260710210000.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_upsert_settings(
  p_shop_id integer,
  p_realm_id text,
  p_auto_post boolean,
  p_settle_window_minutes integer,
  p_shop_timezone text,
  p_sales_tax_rate_bps integer,
  p_tire_fee_cents integer,
  p_date_change_alert_emails text DEFAULT NULL,
  p_day_correction_alert_emails text DEFAULT NULL,
  p_payroll jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tier     jsonb;
  v_elem     jsonb;
  v_key      text;
  v_num      numeric;
  v_prev_min numeric;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_realm_id IS NULL OR length(btrim(p_realm_id)) = 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: a positive p_shop_id + non-blank p_realm_id are required';
  END IF;
  IF p_settle_window_minutes IS NOT NULL AND p_settle_window_minutes < 0 THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: settle_window_minutes must be >= 0';
  END IF;
  IF (p_sales_tax_rate_bps IS NOT NULL AND p_sales_tax_rate_bps < 0)
     OR (p_tire_fee_cents IS NOT NULL AND p_tire_fee_cents < 0) THEN
    RAISE EXCEPTION 'qteklink_upsert_settings: tax rate + tire fee must be >= 0';
  END IF;
  IF p_payroll IS NOT NULL THEN
    IF jsonb_typeof(p_payroll) <> 'object' THEN
      RAISE EXCEPTION 'qteklink_upsert_settings: payroll must be a JSON object';
    END IF;
    IF p_payroll ? 'anchor_period_start' THEN
      BEGIN
        PERFORM (p_payroll->>'anchor_period_start')::date;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'qteklink_upsert_settings: payroll.anchor_period_start must be an ISO date';
      END;
    END IF;

    -- Round-11 §2d PTO keys — validated ONLY when present; JSON null is a
    -- valid "unconfigured" value for every key; empty tiers are valid.
    IF p_payroll ? 'pto_tenure_tiers' AND jsonb_typeof(p_payroll->'pto_tenure_tiers') <> 'null' THEN
      IF jsonb_typeof(p_payroll->'pto_tenure_tiers') <> 'array' THEN
        RAISE EXCEPTION 'qteklink_upsert_settings: payroll.pto_tenure_tiers must be a JSON array (or null)';
      END IF;
      v_prev_min := NULL;
      FOR v_tier IN SELECT jsonb_array_elements(p_payroll->'pto_tenure_tiers') LOOP
        IF jsonb_typeof(v_tier) <> 'object' THEN
          RAISE EXCEPTION 'qteklink_upsert_settings: pto_tenure_tiers entries must be JSON objects';
        END IF;
        FOR v_key IN SELECT jsonb_object_keys(v_tier) LOOP
          IF v_key NOT IN ('min_years','hours_per_period') THEN
            RAISE EXCEPTION 'qteklink_upsert_settings: unknown pto_tenure_tiers entry key "%"', v_key;
          END IF;
        END LOOP;
        IF NOT (v_tier ? 'min_years' AND v_tier ? 'hours_per_period') THEN
          RAISE EXCEPTION 'qteklink_upsert_settings: pto_tenure_tiers entries require min_years + hours_per_period';
        END IF;
        IF jsonb_typeof(v_tier->'min_years') <> 'number' THEN
          RAISE EXCEPTION 'qteklink_upsert_settings: pto_tenure_tiers.min_years must be a number';
        END IF;
        v_num := (v_tier->>'min_years')::numeric;
        IF v_num < 0 OR v_num <> trunc(v_num) THEN
          RAISE EXCEPTION 'qteklink_upsert_settings: pto_tenure_tiers.min_years must be an integer >= 0';
        END IF;
        IF jsonb_typeof(v_tier->'hours_per_period') <> 'number'
           OR (v_tier->>'hours_per_period')::numeric < 0 THEN
          RAISE EXCEPTION 'qteklink_upsert_settings: pto_tenure_tiers.hours_per_period must be a number >= 0';
        END IF;
        IF v_prev_min IS NULL THEN
          -- must include min_years 0 when non-empty (sorted ⇒ it is first)
          IF v_num <> 0 THEN
            RAISE EXCEPTION 'qteklink_upsert_settings: pto_tenure_tiers must start with a min_years 0 tier when non-empty';
          END IF;
        ELSIF v_num <= v_prev_min THEN
          RAISE EXCEPTION 'qteklink_upsert_settings: pto_tenure_tiers must be sorted ascending by UNIQUE min_years';
        END IF;
        v_prev_min := v_num;
      END LOOP;
    END IF;

    IF p_payroll ? 'pto_rollover_cap_hours' AND jsonb_typeof(p_payroll->'pto_rollover_cap_hours') <> 'null' THEN
      IF jsonb_typeof(p_payroll->'pto_rollover_cap_hours') <> 'number'
         OR (p_payroll->>'pto_rollover_cap_hours')::numeric < 0 THEN
        RAISE EXCEPTION 'qteklink_upsert_settings: payroll.pto_rollover_cap_hours must be a number >= 0 (or null = unlimited)';
      END IF;
    END IF;

    FOREACH v_key IN ARRAY ARRAY['pto_adjustment_alert_emails','pto_negative_alert_admin_emails'] LOOP
      IF p_payroll ? v_key AND jsonb_typeof(p_payroll->v_key) <> 'null' THEN
        IF jsonb_typeof(p_payroll->v_key) <> 'array' THEN
          RAISE EXCEPTION 'qteklink_upsert_settings: payroll.% must be a JSON array of strings (or null)', v_key;
        END IF;
        FOR v_elem IN SELECT jsonb_array_elements(p_payroll->v_key) LOOP
          IF jsonb_typeof(v_elem) <> 'string' OR length(btrim(v_elem #>> '{}')) = 0 THEN
            RAISE EXCEPTION 'qteklink_upsert_settings: payroll.% entries must be non-blank strings', v_key;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.qteklink_settings (
    shop_id, realm_id, auto_post, settle_window_minutes, shop_timezone, sales_tax_rate_bps,
    tire_fee_cents, date_change_alert_emails, day_correction_alert_emails, payroll, updated_at
  )
  VALUES (
    p_shop_id, p_realm_id, coalesce(p_auto_post, false), coalesce(p_settle_window_minutes, 0),
    coalesce(nullif(btrim(p_shop_timezone), ''), 'America/New_York'),
    coalesce(p_sales_tax_rate_bps, 600), coalesce(p_tire_fee_cents, 100),
    nullif(btrim(coalesce(p_date_change_alert_emails, '')), ''),
    nullif(btrim(coalesce(p_day_correction_alert_emails, '')), ''),
    p_payroll,
    now()
  )
  ON CONFLICT (shop_id, realm_id) DO UPDATE SET
    auto_post             = coalesce(p_auto_post, public.qteklink_settings.auto_post),
    settle_window_minutes = coalesce(p_settle_window_minutes, public.qteklink_settings.settle_window_minutes),
    shop_timezone         = coalesce(nullif(btrim(p_shop_timezone), ''), public.qteklink_settings.shop_timezone),
    sales_tax_rate_bps    = coalesce(p_sales_tax_rate_bps, public.qteklink_settings.sales_tax_rate_bps),
    tire_fee_cents        = coalesce(p_tire_fee_cents, public.qteklink_settings.tire_fee_cents),
    -- NULL = leave unchanged; an explicit empty string clears the list.
    date_change_alert_emails    = CASE WHEN p_date_change_alert_emails IS NULL THEN public.qteklink_settings.date_change_alert_emails
                                       ELSE nullif(btrim(p_date_change_alert_emails), '') END,
    day_correction_alert_emails = CASE WHEN p_day_correction_alert_emails IS NULL THEN public.qteklink_settings.day_correction_alert_emails
                                       ELSE nullif(btrim(p_day_correction_alert_emails), '') END,
    payroll               = coalesce(p_payroll, public.qteklink_settings.payroll),
    updated_at            = now();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer, text, text, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2a — the NEW profile RPC. ALL new-column writes go through here; the
-- existing qteklink_payroll_upsert_employee stays byte-untouched and its
-- callers structurally cannot touch or wipe these columns.
--
-- p_patch semantics: key PRESENT = write that value (JSON null clears);
-- key ABSENT = leave unchanged. Allowed keys = exactly the nine new columns;
-- unknown keys RAISE. Shape-validated (emails look like emails, dates cast,
-- booleans boolean; pto_grandfathered is NOT NULL, so JSON null RAISEs there).
--
-- p_archived: NULL = leave unchanged; true/false flips archived_at atomically
-- in the same UPDATE (mirroring the upsert's CASE idiom, audited).
-- p_archived = false AUTO-CLEARS termination_date (C8/C23/C36 — a rehired
-- employee must accrue again; the cleared value is preserved in the audit
-- detail). Re-archiving overwrites any prior termination_date via the modal
-- (one call: p_patch {"termination_date": …} + p_archived true).
--
-- p_actor carries DEFAULT NULL only because SQL requires defaults after a
-- defaulted parameter (p_patch) — it is REQUIRED and RAISEs when blank.
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
    'start_date','termination_date','pto_grandfathered','pto_tenure_credit_date'];
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

    IF v_key = 'pto_grandfathered' THEN
      -- NOT NULL column: must be a JSON boolean (null does NOT clear here).
      IF jsonb_typeof(p_patch->'pto_grandfathered') <> 'boolean' THEN
        RAISE EXCEPTION 'qteklink_payroll_update_employee_profile: pto_grandfathered must be a boolean';
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
  'Patch the round-11 employee profile columns (key present = write, JSON null clears; key absent = keep) + optionally flip archived_at (p_archived=false auto-clears termination_date; the cleared value rides in the audit detail). The legacy upsert RPC stays byte-untouched — this is the ONLY writer of the nine profile columns.';
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_update_employee_profile(integer, uuid, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_update_employee_profile(integer, uuid, jsonb, boolean, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2b — standalone ledger RPC: kinds initial/adjustment ONLY (run-driven kinds
-- are written exclusively inside complete_run/void_run).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_payroll_adjust_pto(
  p_shop integer,
  p_employee uuid,
  p_kind text,
  p_hours numeric,
  p_reason text,
  p_actor text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_exists  boolean;
  v_balance numeric;
  v_id      uuid;
BEGIN
  IF p_shop IS NULL OR p_shop <= 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_adjust_pto: a positive p_shop is required';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('initial','adjustment') THEN
    RAISE EXCEPTION 'qteklink_payroll_adjust_pto: p_kind must be initial or adjustment (run-driven kinds are written only by complete_run/void_run)';
  END IF;
  IF p_hours IS NULL OR p_hours = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_adjust_pto: a non-zero p_hours is required';
  END IF;
  IF abs(p_hours) > 500 THEN
    RAISE EXCEPTION 'qteklink_payroll_adjust_pto: abs(p_hours) must be <= 500 (fat-finger bound)';
  END IF;
  IF p_kind = 'adjustment' AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
    RAISE EXCEPTION 'qteklink_payroll_adjust_pto: a non-blank p_reason is required for adjustments';
  END IF;
  IF p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_adjust_pto: a non-blank p_actor is required';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.qteklink_payroll_employees e
                 WHERE e.id = p_employee AND e.shop_id = p_shop) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'qteklink_payroll_adjust_pto: employee % not found for shop %', p_employee, p_shop;
  END IF;

  -- all payroll ledger writers: run row → shop ledger advisory; never
  -- interleave (C13). No run row is held here, so this is the first lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('qteklink_payroll_pto_ledger:' || p_shop::text, 0));

  SELECT coalesce(sum(l.hours), 0) + p_hours INTO v_balance
  FROM public.qteklink_payroll_pto_ledger l
  WHERE l.shop_id = p_shop AND l.employee_id = p_employee;

  INSERT INTO public.qteklink_payroll_pto_ledger
    (shop_id, employee_id, kind, hours, balance_after_hours, reason, created_by_label)
  VALUES
    (p_shop, p_employee, p_kind, p_hours, v_balance, nullif(btrim(coalesce(p_reason, '')), ''), btrim(p_actor))
  RETURNING id INTO v_id;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, employee_id, actor_label, action, detail)
  VALUES (p_shop, p_employee, btrim(p_actor), 'pto_adjusted',
          jsonb_build_object('ledger_id', v_id, 'kind', p_kind, 'hours', p_hours,
                             'balance_after_hours', v_balance,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  RETURN jsonb_build_object('ledger_id', v_id, 'balance_after_hours', v_balance);
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_adjust_pto(integer, uuid, text, numeric, text, text) IS
  'Write an initial/adjustment PTO ledger row (signed hours; reason REQUIRED for adjustments) with the running balance stamped under the per-shop ledger advisory lock. Returns {ledger_id, balance_after_hours}. §8.6 seeding = initial-balance adjustments ONLY — never reads pay_config.pto_balance_hours (auto-migration would double-count).';
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_adjust_pto(integer, uuid, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_adjust_pto(integer, uuid, text, numeric, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2c — email-log writers. The table is RPC-write-only:
--   * pay_summary rows are born ONLY inside qteklink_payroll_complete_run
--     (the exactly-once identity rail) — log_email REFUSES that kind.
--   * log_email inserts pto_adjustment / pto_negative rows (the other two
--     kinds ride the same sequential send queue + claim finalization).
--   * transition_email is the atomic claim: pending→sent, pending→failed,
--     failed→pending are the ONLY legal transitions; sent is TERMINAL.
-- DELIBERATE DEPARTURE from "every mutating RPC writes >= 1 audit row":
-- the email log IS its own audit surface ("every attempt logged with
-- recipient + status", §5.4) — mirroring it into qteklink_payroll_audit_log
-- would double-log every send (the live-snapshot precedent).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_payroll_log_email(
  p_shop integer,
  p_kind text,
  p_recipient text,
  p_subject text,
  p_status text DEFAULT 'pending',
  p_run uuid DEFAULT NULL,
  p_employee uuid DEFAULT NULL,
  p_detail text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_shop IS NULL OR p_shop <= 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_log_email: a positive p_shop is required';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('pto_adjustment','pto_negative') THEN
    RAISE EXCEPTION 'qteklink_payroll_log_email: p_kind must be pto_adjustment or pto_negative (pay_summary rows are born only inside qteklink_payroll_complete_run)';
  END IF;
  IF p_recipient IS NULL OR length(btrim(p_recipient)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_log_email: a non-blank p_recipient is required';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending','sent','failed') THEN
    RAISE EXCEPTION 'qteklink_payroll_log_email: p_status must be pending, sent, or failed';
  END IF;

  INSERT INTO public.qteklink_payroll_email_log
    (shop_id, run_id, employee_id, kind, recipient, subject, status, sent_at, detail)
  VALUES
    (p_shop, p_run, p_employee, p_kind, btrim(p_recipient), coalesce(btrim(p_subject), ''),
     p_status, CASE WHEN p_status = 'sent' THEN now() END, p_detail)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_log_email(integer, text, text, text, text, uuid, uuid, text) IS
  'Insert a pto_adjustment / pto_negative email-log row (the email_log table is RPC-write-only). REFUSES kind=pay_summary — those identity rows are born only inside the completion transaction.';
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_log_email(integer, text, text, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_log_email(integer, text, text, text, text, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.qteklink_payroll_transition_email(
  p_email_id uuid,
  p_to_status text,
  p_recipient text DEFAULT NULL,
  p_subject text DEFAULT NULL,
  p_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row  public.qteklink_payroll_email_log%ROWTYPE;
  v_from text;
BEGIN
  v_from := CASE p_to_status
    WHEN 'sent'    THEN 'pending'
    WHEN 'failed'  THEN 'pending'
    WHEN 'pending' THEN 'failed'   -- explicit retry (C27)
    ELSE NULL
  END;
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_transition_email: "%" is not a legal target status (legal transitions: pending->sent, pending->failed, failed->pending)', p_to_status;
  END IF;

  -- FOR NO KEY UPDATE: the atomic claim — two racing finalizers serialize
  -- here; the loser re-reads the flipped status and RAISEs below.
  SELECT * INTO v_row FROM public.qteklink_payroll_email_log l
  WHERE l.id = p_email_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_transition_email: email-log row % not found', p_email_id;
  END IF;
  IF v_row.status <> v_from THEN
    RAISE EXCEPTION 'qteklink_payroll_transition_email: row % is "%" — %->% is not a legal transition (sent is terminal; skipped_no_email never transitions)',
      p_email_id, v_row.status, v_row.status, p_to_status;
  END IF;

  UPDATE public.qteklink_payroll_email_log l SET
    status    = p_to_status,
    sent_at   = CASE WHEN p_to_status = 'sent' THEN now() ELSE l.sent_at END,
    recipient = coalesce(nullif(btrim(coalesce(p_recipient, '')), ''), l.recipient),
    subject   = coalesce(nullif(btrim(coalesce(p_subject, '')), ''), l.subject),
    detail    = coalesce(p_detail, l.detail)
  WHERE l.id = p_email_id;

  RETURN jsonb_build_object('id', p_email_id, 'status', p_to_status);
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_transition_email(uuid, text, text, text, text) IS
  'Atomic email-log claim (plan §2c): pending->sent (stamps sent_at), pending->failed, failed->pending (explicit retry) are the ONLY legal transitions — sent is TERMINAL (the never-double-send guarantee) and skipped_no_email never transitions. Optionally updates recipient/subject/detail. No audit-log row — the email log IS the audit surface.';
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_transition_email(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_transition_email(uuid, text, text, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4 — complete_run: DROP the exact old 7-param signature, recreate with a
-- trailing p_pto_entries jsonb DEFAULT NULL (never CREATE OR REPLACE into an
-- overload — PostgREST named/positional resolution must stay unambiguous for
-- the LIVE dance). Existing 7-arg positional/named calls keep resolving via
-- the DEFAULT; NULL = legacy behavior byte-identical.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.qteklink_payroll_complete_run(uuid, boolean, uuid, text, jsonb, uuid, text);

-- Pattern S completion. dry_run: recompute + return {state_hash} (the caller
-- then issues a token against it) — the dry-run branch IGNORES p_pto_entries
-- (byte-identical Pattern-S flow; only the confirm call passes it). Non-dry:
-- recompute the hash, abort on mismatch, require a non-null snapshot,
-- atomically consume the token, then — when p_pto_entries is non-NULL — under
-- the shop ledger advisory lock and BEFORE the status flip: insert the
-- engine's accrual/usage/rollover_forfeit ledger rows with running balances
-- stamped, and pre-insert the pay_summary email-log rows (pending per
-- emailable employee, skipped_no_email per skip). Any RAISE (incl. the UNIQUE
-- guards) rolls back the WHOLE completion. Finally GUC-write snapshot +
-- status + completed_* in one statement. Returns {completed: true} (+ pto/
-- email counts when p_pto_entries was provided).
CREATE OR REPLACE FUNCTION public.qteklink_payroll_complete_run(
  p_run_id uuid,
  p_dry_run boolean,
  p_confirm_token uuid,
  p_state_hash text,
  p_snapshot jsonb,
  p_actor_user_id uuid,
  p_actor_label text,
  p_pto_entries jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run     public.qteklink_payroll_runs%ROWTYPE;
  v_hash    text;
  v_token   uuid;
  v_entry   jsonb;
  v_key     text;
  v_emp     uuid;
  v_kind    text;
  v_hours   numeric;
  v_year    integer;
  v_balance numeric;
  v_written integer := 0;
  v_pending integer := 0;
  v_skipped integer := 0;
  v_roster  record;
BEGIN
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_complete_run: a non-blank p_actor_label is required';
  END IF;
  -- FOR UPDATE serializes completion against concurrent completes/voids AND against
  -- the open-run edit RPCs (which hold a shared lock on this row): when two
  -- non-dry completes overlap, the loser blocks here, re-reads status='completed'
  -- after the winner commits, and RAISEs below instead of overwriting the frozen
  -- snapshot (READ COMMITTED re-evaluation would otherwise let its UPDATE through).
  SELECT * INTO v_run FROM public.qteklink_payroll_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_complete_run: run % not found', p_run_id;
  END IF;
  IF v_run.status <> 'open' THEN
    RAISE EXCEPTION 'qteklink_payroll_complete_run: run % is % — only open runs can be completed', p_run_id, v_run.status;
  END IF;

  v_hash := public.qteklink_payroll_state_hash(p_run_id);

  IF coalesce(p_dry_run, false) THEN
    -- p_pto_entries deliberately IGNORED here: the Pattern-S preview flow is
    -- byte-identical to 20260710210000 (PTO is advisory-display only and is
    -- NOT part of the state hash — an adjustment must not invalidate an
    -- in-flight completion preview).
    RETURN jsonb_build_object('state_hash', v_hash);
  END IF;

  IF p_state_hash IS NULL OR p_state_hash <> v_hash THEN
    RAISE EXCEPTION 'qteklink_payroll_complete_run: run % changed since the preview (stale state hash) — re-run the dry run', p_run_id;
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'qteklink_payroll_complete_run: a non-null snapshot JSON object is required';
  END IF;
  IF p_confirm_token IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_complete_run: a confirmation token is required';
  END IF;

  UPDATE public.qteklink_payroll_confirm_tokens t
  SET consumed_at = now()
  WHERE t.id = p_confirm_token
    AND t.action_kind = 'complete_run'
    AND t.run_id = p_run_id
    AND t.scope_hash = v_hash
    AND t.consumed_at IS NULL
    AND t.expires_at > now()
  RETURNING t.id INTO v_token;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_complete_run: confirmation token is invalid, expired, already consumed, or scope-mismatched';
  END IF;

  -- ── PTO ledger writes + email pre-inserts (round-11 §4) — BEFORE the status
  -- flip, inside this one transaction. NULL p_pto_entries = the pre-round-11
  -- caller: skip everything (legacy behavior byte-identical). Ledger writes
  -- must NOT use the post-confirm never-throw idiom — silently swallowing a
  -- failed balance write is worse than failing completion (C5/C12/C32).
  IF p_pto_entries IS NOT NULL THEN
    IF jsonb_typeof(p_pto_entries) <> 'array' THEN
      RAISE EXCEPTION 'qteklink_payroll_complete_run: p_pto_entries must be a JSON array';
    END IF;

    -- all payroll ledger writers: run row → shop ledger advisory; never
    -- interleave (C13). The run-row FOR UPDATE above is already held.
    PERFORM pg_advisory_xact_lock(hashtextextended('qteklink_payroll_pto_ledger:' || v_run.shop_id::text, 0));

    FOR v_entry IN SELECT jsonb_array_elements(p_pto_entries) LOOP
      IF jsonb_typeof(v_entry) <> 'object' THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: each p_pto_entries element must be a JSON object';
      END IF;
      FOR v_key IN SELECT jsonb_object_keys(v_entry) LOOP
        IF v_key NOT IN ('employee_id','kind','hours','boundary_year') THEN
          RAISE EXCEPTION 'qteklink_payroll_complete_run: unexpected p_pto_entries key "%"', v_key;
        END IF;
      END LOOP;
      -- lead with the `? ` presence test: jsonb_typeof(NULL) is NULL, so
      -- `NULL <> 'string'` alone would silently fall through on an absent key.
      IF NOT (v_entry ? 'employee_id') OR jsonb_typeof(v_entry->'employee_id') <> 'string' THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: p_pto_entries.employee_id must be a uuid string';
      END IF;
      BEGIN
        v_emp := (v_entry->>'employee_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: p_pto_entries.employee_id "%" is not a valid uuid', v_entry->>'employee_id';
      END;
      v_kind := v_entry->>'kind';
      IF v_kind IS NULL OR v_kind NOT IN ('accrual','usage','rollover_forfeit') THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: p_pto_entries.kind must be accrual, usage, or rollover_forfeit (got "%")', coalesce(v_kind, 'null');
      END IF;
      IF NOT (v_entry ? 'hours') OR jsonb_typeof(v_entry->'hours') <> 'number' THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: p_pto_entries.hours must be a number';
      END IF;
      v_hours := (v_entry->>'hours')::numeric;
      IF v_hours = 0 THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: zero-hour p_pto_entries are meaningless — the engine must omit them';
      END IF;
      IF abs(v_hours) > 500 THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: abs(p_pto_entries.hours) must be <= 500 (fat-finger bound)';
      END IF;
      IF v_kind = 'accrual' AND v_hours < 0 THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: accrual hours must be positive';
      END IF;
      IF v_kind IN ('usage','rollover_forfeit') AND v_hours > 0 THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: % hours must be negative (the ledger decrements)', v_kind;
      END IF;
      IF v_kind = 'rollover_forfeit' THEN
        -- an ABSENT boundary_year makes jsonb_typeof(...) NULL (not 'number'),
        -- so the `? ` presence test must lead — otherwise NULL <> 'number' is
        -- NULL and the guard would silently fall through to the table CHECK.
        IF NOT (v_entry ? 'boundary_year')
           OR jsonb_typeof(v_entry->'boundary_year') <> 'number'
           OR (v_entry->>'boundary_year')::numeric <> trunc((v_entry->>'boundary_year')::numeric) THEN
          RAISE EXCEPTION 'qteklink_payroll_complete_run: rollover_forfeit entries require an integer boundary_year';
        END IF;
        v_year := (v_entry->>'boundary_year')::integer;
      ELSE
        IF v_entry ? 'boundary_year' THEN
          RAISE EXCEPTION 'qteklink_payroll_complete_run: boundary_year is rollover_forfeit-only';
        END IF;
        v_year := NULL;
      END IF;
      -- roster guard: every entry must belong to an employee ON this run
      -- (no cross-run / cross-shop smuggling).
      IF NOT EXISTS (SELECT 1 FROM public.qteklink_payroll_run_employees re
                     WHERE re.run_id = p_run_id AND re.employee_id = v_emp) THEN
        RAISE EXCEPTION 'qteklink_payroll_complete_run: employee % has no entry row on run %', v_emp, p_run_id;
      END IF;
      -- rollover at-most-once per (employee, boundary_year), order-independent
      -- (C33): checked in-transaction under the shop lock. An existing
      -- UN-REVERSED forfeit means the pure function already fired (whichever
      -- year-Y run completed first in wall-clock order) — SKIP, don't RAISE:
      -- the value is identical by construction, and void→clone must re-fire
      -- exactly once (the void reverses the row, re-arming this check).
      IF v_kind = 'rollover_forfeit' AND EXISTS (
           SELECT 1 FROM public.qteklink_payroll_pto_ledger f
           WHERE f.shop_id = v_run.shop_id AND f.employee_id = v_emp
             AND f.kind = 'rollover_forfeit' AND f.boundary_year = v_year
             AND NOT EXISTS (SELECT 1 FROM public.qteklink_payroll_pto_ledger r
                             WHERE r.reverses_ledger_id = f.id)) THEN
        CONTINUE;
      END IF;

      SELECT coalesce(sum(l.hours), 0) + v_hours INTO v_balance
      FROM public.qteklink_payroll_pto_ledger l
      WHERE l.shop_id = v_run.shop_id AND l.employee_id = v_emp;

      INSERT INTO public.qteklink_payroll_pto_ledger
        (shop_id, employee_id, run_id, kind, hours, balance_after_hours, boundary_year, created_by_label)
      VALUES
        (v_run.shop_id, v_emp, p_run_id, v_kind, v_hours, v_balance, v_year, btrim(p_actor_label));
      v_written := v_written + 1;
    END LOOP;

    -- §2c pay_summary pre-inserts: ONE identity row per (run, employee), EVER.
    -- Recipient read from the SAME employee row in this transaction (§5.2
    -- single-source binding); blank/NULL personal_email ⇒ skipped_no_email
    -- (the #53.3 skips, recorded). Subject is stamped by the sender at claim
    -- time. A 23505 here means corruption — let it roll back the completion.
    FOR v_roster IN
      SELECT re.employee_id, e.personal_email
      FROM public.qteklink_payroll_run_employees re
      JOIN public.qteklink_payroll_employees e ON e.id = re.employee_id
      WHERE re.run_id = p_run_id
    LOOP
      IF v_roster.personal_email IS NOT NULL AND length(btrim(v_roster.personal_email)) > 0 THEN
        INSERT INTO public.qteklink_payroll_email_log
          (shop_id, run_id, employee_id, kind, recipient, status)
        VALUES
          (v_run.shop_id, p_run_id, v_roster.employee_id, 'pay_summary', btrim(v_roster.personal_email), 'pending');
        v_pending := v_pending + 1;
      ELSE
        INSERT INTO public.qteklink_payroll_email_log
          (shop_id, run_id, employee_id, kind, recipient, status)
        VALUES
          (v_run.shop_id, p_run_id, v_roster.employee_id, 'pay_summary', '', 'skipped_no_email');
        v_skipped := v_skipped + 1;
      END IF;
    END LOOP;
  END IF;

  -- Deliberately NO GUC bypass here: an open->completed flip never trips the lock
  -- trigger (it checks OLD.status), so the bypass would only ever serve to let a
  -- lost double-complete race replace an already-frozen snapshot. Unbypassed, the
  -- trigger is a second wall behind the FOR UPDATE re-read above.
  UPDATE public.qteklink_payroll_runs r SET
    status               = 'completed',
    snapshot             = p_snapshot,
    completed_at         = now(),
    completed_by_user_id = p_actor_user_id,
    completed_by_label   = p_actor_label,
    updated_at           = now()
  WHERE r.id = p_run_id;

  IF p_pto_entries IS NULL THEN
    INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
    VALUES (v_run.shop_id, p_run_id, p_actor_user_id, p_actor_label, 'run_completed',
            jsonb_build_object('state_hash', v_hash, 'confirm_token', p_confirm_token));
    RETURN jsonb_build_object('completed', true);
  END IF;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
  VALUES (v_run.shop_id, p_run_id, p_actor_user_id, p_actor_label, 'run_completed',
          jsonb_build_object('state_hash', v_hash, 'confirm_token', p_confirm_token,
                             'pto_entries_written', v_written,
                             'pay_summary_pending', v_pending,
                             'pay_summary_skipped_no_email', v_skipped));

  RETURN jsonb_build_object('completed', true,
                            'pto_entries_written', v_written,
                            'pay_summary_pending', v_pending,
                            'pay_summary_skipped_no_email', v_skipped);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_complete_run(uuid, boolean, uuid, text, jsonb, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_complete_run(uuid, boolean, uuid, text, jsonb, uuid, text, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4 — void_run: DROP-then-recreate (SAME 7-param signature — no new
-- parameter; the reversals are fully derivable from the ledger). Extended
-- body: kind='void_reversal' rows write inside ITS transaction, between the
-- status flip and the clone.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.qteklink_payroll_void_run(uuid, text, boolean, uuid, text, uuid, text);

-- Void-and-clone (completed runs only; same token dance, kind void_run). The
-- voided run's data stays frozen forever; every input row is cloned into a new
-- OPEN run for the same period with cloned_from_run_id lineage. Round-11: the
-- run's un-reversed accrual/usage/rollover_forfeit ledger rows are negated by
-- void_reversal rows (reverses_ledger_id; the partial UNIQUE makes each
-- reversal at-most-once) under the shop ledger advisory lock — restoring the
-- PTO balance and re-arming the rollover at-most-once check for the clone.
-- Returns {voided: true, clone_run_id, pto_entries_reversed}.
CREATE OR REPLACE FUNCTION public.qteklink_payroll_void_run(
  p_run_id uuid,
  p_reason text,
  p_dry_run boolean,
  p_confirm_token uuid,
  p_state_hash text,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run      public.qteklink_payroll_runs%ROWTYPE;
  v_hash     text;
  v_token    uuid;
  v_clone    uuid;
  v_copied   integer;
  v_lrow     public.qteklink_payroll_pto_ledger%ROWTYPE;
  v_balance  numeric;
  v_reversed integer := 0;
BEGIN
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_void_run: a non-blank p_actor_label is required';
  END IF;
  -- FOR UPDATE: a concurrent void of the same run (two admins, each with a valid
  -- token) blocks here, re-reads status='voided' after the winner commits, and
  -- RAISEs below — instead of double-voiding / double-cloning (the second clone
  -- was previously stopped only incidentally by the partial unique index).
  SELECT * INTO v_run FROM public.qteklink_payroll_runs r WHERE r.id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_void_run: run % not found', p_run_id;
  END IF;
  IF v_run.status <> 'completed' THEN
    RAISE EXCEPTION 'qteklink_payroll_void_run: run % is % — only completed runs can be voided', p_run_id, v_run.status;
  END IF;

  v_hash := public.qteklink_payroll_state_hash(p_run_id);

  IF coalesce(p_dry_run, false) THEN
    RETURN jsonb_build_object('state_hash', v_hash);
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_void_run: a non-blank p_reason is required';
  END IF;
  IF p_state_hash IS NULL OR p_state_hash <> v_hash THEN
    RAISE EXCEPTION 'qteklink_payroll_void_run: run % changed since the preview (stale state hash) — re-run the dry run', p_run_id;
  END IF;
  IF p_confirm_token IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_void_run: a confirmation token is required';
  END IF;

  UPDATE public.qteklink_payroll_confirm_tokens t
  SET consumed_at = now()
  WHERE t.id = p_confirm_token
    AND t.action_kind = 'void_run'
    AND t.run_id = p_run_id
    AND t.scope_hash = v_hash
    AND t.consumed_at IS NULL
    AND t.expires_at > now()
  RETURNING t.id INTO v_token;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_void_run: confirmation token is invalid, expired, already consumed, or scope-mismatched';
  END IF;

  -- status flip on the frozen row needs the GUC bypass.
  PERFORM set_config('qteklink.payroll_lock_bypass', 'on', true);
  UPDATE public.qteklink_payroll_runs r SET
    status            = 'voided',
    voided_at         = now(),
    voided_by_user_id = p_actor_user_id,
    voided_by_label   = p_actor_label,
    void_reason       = btrim(p_reason),
    updated_at        = now()
  WHERE r.id = p_run_id;
  PERFORM set_config('qteklink.payroll_lock_bypass', 'off', true);

  -- ── PTO void reversals (round-11 §4) — between status flip and clone.
  -- all payroll ledger writers: run row → shop ledger advisory; never
  -- interleave (C13). The run-row FOR UPDATE above is already held.
  -- Every un-reversed accrual/usage/rollover_forfeit row of THIS run gets one
  -- negating void_reversal row (kind='void_reversal', the voided run's
  -- run_id, negated hours, reverses_ledger_id — NEVER "kind preserved": that
  -- collided with the completion-idempotency UNIQUE and would have broken
  -- void-and-clone). The partial UNIQUE(reverses_ledger_id) makes a replayed
  -- reversal impossible. A run completed with zero ledger rows (pre-round-11
  -- or PTO-unconfigured) reverses zero rows — that is success, not an error.
  PERFORM pg_advisory_xact_lock(hashtextextended('qteklink_payroll_pto_ledger:' || v_run.shop_id::text, 0));
  FOR v_lrow IN
    SELECT l.* FROM public.qteklink_payroll_pto_ledger l
    WHERE l.run_id = p_run_id
      AND l.kind IN ('accrual','usage','rollover_forfeit')
      AND NOT EXISTS (SELECT 1 FROM public.qteklink_payroll_pto_ledger r
                      WHERE r.reverses_ledger_id = l.id)
    ORDER BY l.created_at, l.id
  LOOP
    SELECT coalesce(sum(x.hours), 0) - v_lrow.hours INTO v_balance
    FROM public.qteklink_payroll_pto_ledger x
    WHERE x.shop_id = v_run.shop_id AND x.employee_id = v_lrow.employee_id;

    INSERT INTO public.qteklink_payroll_pto_ledger
      (shop_id, employee_id, run_id, kind, hours, balance_after_hours, reverses_ledger_id, created_by_label)
    VALUES
      (v_run.shop_id, v_lrow.employee_id, p_run_id, 'void_reversal', -v_lrow.hours, v_balance, v_lrow.id, btrim(p_actor_label));
    v_reversed := v_reversed + 1;
  END LOOP;

  -- CLONE: new open run for the same period (the old row is now voided, so the
  -- partial unique indexes admit the clone) + copy every entry row verbatim.
  INSERT INTO public.qteklink_payroll_runs
    (shop_id, period_start, period_end, status, bonus_period, bonus_month, cloned_from_run_id)
  VALUES
    (v_run.shop_id, v_run.period_start, v_run.period_end, 'open', v_run.bonus_period, v_run.bonus_month, v_run.id)
  RETURNING id INTO v_clone;

  INSERT INTO public.qteklink_payroll_run_employees
    (run_id, shop_id, employee_id, role_snapshot, pay_config,
     clock_hours_w1, clock_hours_w2, pto_w1, pto_w2, holiday_w1, holiday_w2,
     bereavement_w1, bereavement_w2, training_w1, training_w2,
     manual_incentive_cents, overrides)
  SELECT
    v_clone, re.shop_id, re.employee_id, re.role_snapshot, re.pay_config,
    re.clock_hours_w1, re.clock_hours_w2, re.pto_w1, re.pto_w2, re.holiday_w1, re.holiday_w2,
    re.bereavement_w1, re.bereavement_w2, re.training_w1, re.training_w2,
    re.manual_incentive_cents, re.overrides
  FROM public.qteklink_payroll_run_employees re
  WHERE re.run_id = p_run_id;
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
  VALUES
    (v_run.shop_id, p_run_id, p_actor_user_id, p_actor_label, 'run_voided',
     jsonb_build_object('reason', btrim(p_reason), 'clone_run_id', v_clone, 'state_hash', v_hash,
                        'pto_entries_reversed', v_reversed)),
    (v_run.shop_id, v_clone, p_actor_user_id, p_actor_label, 'run_cloned',
     jsonb_build_object('cloned_from_run_id', p_run_id, 'entries_copied', v_copied));

  RETURN jsonb_build_object('voided', true, 'clone_run_id', v_clone, 'pto_entries_reversed', v_reversed);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_void_run(uuid, text, boolean, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_void_run(uuid, text, boolean, uuid, text, uuid, text) TO service_role;

COMMIT;
