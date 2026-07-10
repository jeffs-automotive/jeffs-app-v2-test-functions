-- =====================================================================
-- QTekLink Payroll — schema + RPCs (build contract: docs/qteklink/payroll-contract.md)
-- =====================================================================
-- 2026-07-10. Replaces the bi-weekly Excel pay-sheet workbook.
--   qteklink_payroll_employees      — roster + per-role-family pay_config JSONB
--   qteklink_payroll_runs           — bi-weekly runs; open -> completed -> voided;
--                                     completed/voided rows are IMMUTABLE (GUC trigger)
--   qteklink_payroll_run_employees  — per-run entry rows (manual hours + overrides)
--   qteklink_payroll_confirm_tokens — Pattern S support (5-min TTL, atomic single-use)
--   qteklink_payroll_audit_log      — append-only (UPDATE/DELETE always rejected)
--
-- Immutability wall (GUC pattern, model: 20260511210000_keytag_ar_lockdown_trigger.sql):
-- BEFORE UPDATE/DELETE on runs + run_employees RAISE once the run is completed/voided
-- unless qteklink.payroll_lock_bypass='on' — set ONLY by qteklink_payroll_void_run
-- (the completed->voided flip genuinely trips the trigger) around its own statement.
-- qteklink_payroll_complete_run runs UNBYPASSED: an open->completed flip never trips
-- the lock trigger, and staying unbypassed means a racing double-complete loser is
-- rejected by the trigger even if every other guard were somehow skipped.
--
-- Concurrency: complete_run/void_run read the run row FOR UPDATE, and the open-run
-- edit RPCs (update_entry / update_run / sync_run_roster) read it with a shared row
-- lock — an edit can never overlap a completion and land on a frozen run unguarded.
--
-- Documented departure: no realm_id / qbo_connections FK — payroll is Tekmetric-side.
-- Grant idiom: RLS deny-all; service_role SELECT-only; writes only via SECURITY DEFINER
-- RPCs (SET search_path = public); REVOKE EXECUTE FROM PUBLIC/anon on every function
-- (model: 20260607090000_qteklink_settings_ro_state.sql). Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── qteklink_payroll_employees ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_payroll_employees (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               integer     NOT NULL,
  display_name          text        NOT NULL,
  role                  text        NOT NULL,
  tekmetric_employee_id bigint,
  tekmetric_id_type     text,
  pay_config            jsonb       NOT NULL,
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by_label      text,
  updated_by_label      text,
  CONSTRAINT qteklink_payroll_employees_shop_positive CHECK (shop_id > 0),
  CONSTRAINT qteklink_payroll_employees_name_nonblank CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT qteklink_payroll_employees_role_valid CHECK (role IN
    ('general_manager','service_manager','asst_manager','office_manager',
     'shop_foreman','technician','shop_support','office_support')),
  CONSTRAINT qteklink_payroll_employees_idtype_valid CHECK
    (tekmetric_id_type IS NULL OR tekmetric_id_type IN ('technician','service_writer')),
  CONSTRAINT qteklink_payroll_employees_tm_id_positive CHECK
    (tekmetric_employee_id IS NULL OR tekmetric_employee_id > 0),
  -- id_type must match the role family whenever a Tekmetric id is bound.
  CONSTRAINT qteklink_payroll_employees_idtype_matches_role CHECK (
    tekmetric_employee_id IS NULL
    OR (tekmetric_id_type IS NOT NULL
        AND tekmetric_id_type = CASE
          WHEN role IN ('general_manager','service_manager','asst_manager','office_manager')
            THEN 'service_writer'
          ELSE 'technician'
        END)
  ),
  -- composite-FK target so run rows are shop-tied to their employee.
  CONSTRAINT qteklink_payroll_employees_id_shop_uq UNIQUE (id, shop_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS qteklink_payroll_employees_tm_identity
  ON public.qteklink_payroll_employees (shop_id, tekmetric_employee_id)
  WHERE archived_at IS NULL AND tekmetric_employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS qteklink_payroll_employees_shop
  ON public.qteklink_payroll_employees (shop_id);

COMMENT ON TABLE public.qteklink_payroll_employees IS
  'QTekLink payroll roster: role (8-value enum), optional Tekmetric id (+ derived id type), per-role-family pay_config JSONB (config_version 1). Archive via archived_at (never delete). service_role SELECT-only; writes via qteklink_payroll_upsert_employee.';

ALTER TABLE public.qteklink_payroll_employees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payroll_employees FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payroll_employees TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payroll_employees FROM service_role;

-- ─── qteklink_payroll_runs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_payroll_runs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               integer     NOT NULL,
  period_start          date        NOT NULL,
  period_end            date        NOT NULL,
  status                text        NOT NULL DEFAULT 'open',
  bonus_period          boolean     NOT NULL DEFAULT false,
  bonus_month           date,
  snapshot              jsonb,
  completed_at          timestamptz,
  completed_by_user_id  uuid,
  completed_by_label    text,
  voided_at             timestamptz,
  voided_by_user_id     uuid,
  voided_by_label       text,
  void_reason           text,
  cloned_from_run_id    uuid REFERENCES public.qteklink_payroll_runs(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_payroll_runs_shop_positive CHECK (shop_id > 0),
  CONSTRAINT qteklink_payroll_runs_status_valid  CHECK (status IN ('open','completed','voided')),
  CONSTRAINT qteklink_payroll_runs_period_14d    CHECK (period_end - period_start = 13),
  CONSTRAINT qteklink_payroll_runs_bonus_month_required CHECK (NOT bonus_period OR bonus_month IS NOT NULL),
  CONSTRAINT qteklink_payroll_runs_bonus_month_first_of_month CHECK
    (bonus_month IS NULL OR bonus_month = date_trunc('month', bonus_month)::date),
  -- status consistency: open = nothing stamped (except lineage); completed = snapshot +
  -- completion stamps, no void stamps; voided = completion stamps kept + void stamps.
  CONSTRAINT qteklink_payroll_runs_status_consistency CHECK (
    (status = 'open'
      AND snapshot IS NULL AND completed_at IS NULL AND completed_by_user_id IS NULL
      AND completed_by_label IS NULL AND voided_at IS NULL AND voided_by_user_id IS NULL
      AND voided_by_label IS NULL AND void_reason IS NULL)
    OR
    (status = 'completed'
      AND snapshot IS NOT NULL AND completed_at IS NOT NULL AND completed_by_label IS NOT NULL
      AND voided_at IS NULL AND voided_by_user_id IS NULL
      AND voided_by_label IS NULL AND void_reason IS NULL)
    OR
    (status = 'voided'
      AND snapshot IS NOT NULL AND completed_at IS NOT NULL AND completed_by_label IS NOT NULL
      AND voided_at IS NOT NULL AND void_reason IS NOT NULL)
  ),
  -- composite-FK target so entry rows are shop-tied to their run.
  CONSTRAINT qteklink_payroll_runs_id_shop_uq UNIQUE (id, shop_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS qteklink_payroll_runs_period_identity
  ON public.qteklink_payroll_runs (shop_id, period_start)
  WHERE status <> 'voided';

CREATE UNIQUE INDEX IF NOT EXISTS qteklink_payroll_runs_bonus_month_identity
  ON public.qteklink_payroll_runs (shop_id, bonus_month)
  WHERE bonus_period AND status <> 'voided';

COMMENT ON TABLE public.qteklink_payroll_runs IS
  'QTekLink bi-weekly payroll runs (period_end = period_start + 13). open -> completed (Pattern S snapshot write) -> voided (void-and-clone). Completed/voided rows are IMMUTABLE — GUC-guarded BEFORE UPDATE/DELETE trigger. service_role SELECT-only; writes via the payroll RPCs.';

ALTER TABLE public.qteklink_payroll_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payroll_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payroll_runs TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payroll_runs FROM service_role;

-- ─── qteklink_payroll_run_employees ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_payroll_run_employees (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                 uuid        NOT NULL REFERENCES public.qteklink_payroll_runs(id) ON DELETE CASCADE,
  shop_id                integer     NOT NULL,
  employee_id            uuid        NOT NULL REFERENCES public.qteklink_payroll_employees(id),
  role_snapshot          text        NOT NULL,
  pay_config             jsonb       NOT NULL,
  clock_hours_w1         numeric(6,2) CHECK (clock_hours_w1  >= 0 AND clock_hours_w1  <= 120),
  clock_hours_w2         numeric(6,2) CHECK (clock_hours_w2  >= 0 AND clock_hours_w2  <= 120),
  pto_w1                 numeric(6,2) CHECK (pto_w1          >= 0 AND pto_w1          <= 120),
  pto_w2                 numeric(6,2) CHECK (pto_w2          >= 0 AND pto_w2          <= 120),
  holiday_w1             numeric(6,2) CHECK (holiday_w1      >= 0 AND holiday_w1      <= 120),
  holiday_w2             numeric(6,2) CHECK (holiday_w2      >= 0 AND holiday_w2      <= 120),
  bereavement_w1         numeric(6,2) CHECK (bereavement_w1  >= 0 AND bereavement_w1  <= 120),
  bereavement_w2         numeric(6,2) CHECK (bereavement_w2  >= 0 AND bereavement_w2  <= 120),
  training_w1            numeric(6,2) CHECK (training_w1     >= 0 AND training_w1     <= 120),
  training_w2            numeric(6,2) CHECK (training_w2     >= 0 AND training_w2     <= 120),
  manual_incentive_cents bigint       CHECK (manual_incentive_cents >= 0 AND manual_incentive_cents <= 5000000),
  overrides              jsonb       NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_payroll_run_employees_shop_positive CHECK (shop_id > 0),
  CONSTRAINT qteklink_payroll_run_employees_identity UNIQUE (run_id, employee_id),
  -- shop ties: the entry's shop must equal both its run's and its employee's shop.
  CONSTRAINT qteklink_payroll_run_employees_run_shop_fk FOREIGN KEY (run_id, shop_id)
    REFERENCES public.qteklink_payroll_runs (id, shop_id) ON DELETE CASCADE,
  CONSTRAINT qteklink_payroll_run_employees_employee_shop_fk FOREIGN KEY (employee_id, shop_id)
    REFERENCES public.qteklink_payroll_employees (id, shop_id)
);

CREATE INDEX IF NOT EXISTS qteklink_payroll_run_employees_employee
  ON public.qteklink_payroll_run_employees (employee_id);

COMMENT ON TABLE public.qteklink_payroll_run_employees IS
  'Per-run payroll entry rows: role + pay_config snapshotted at run creation (per-run editable while open; rates_w2 mid-period override allowed here only), the office manager''s manual hour entries, optional manual incentive, and {value, note} overrides for auto-derived numbers. Locked with the run (GUC trigger). service_role SELECT-only; writes via the payroll RPCs.';

ALTER TABLE public.qteklink_payroll_run_employees ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payroll_run_employees FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payroll_run_employees TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payroll_run_employees FROM service_role;

-- ─── qteklink_payroll_confirm_tokens (Pattern S support) ─────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_payroll_confirm_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     integer     NOT NULL,
  action_kind text        NOT NULL,
  scope_hash  text        NOT NULL,
  run_id      uuid        NOT NULL REFERENCES public.qteklink_payroll_runs(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT qteklink_payroll_confirm_tokens_shop_positive CHECK (shop_id > 0),
  CONSTRAINT qteklink_payroll_confirm_tokens_kind_valid CHECK (action_kind IN ('complete_run','void_run')),
  CONSTRAINT qteklink_payroll_confirm_tokens_scope_nonblank CHECK (length(btrim(scope_hash)) > 0)
);

CREATE INDEX IF NOT EXISTS qteklink_payroll_confirm_tokens_run
  ON public.qteklink_payroll_confirm_tokens (run_id);

COMMENT ON TABLE public.qteklink_payroll_confirm_tokens IS
  'Pattern S confirmation tokens for complete_run / void_run: 5-minute TTL, scope_hash = the server-computed state hash, consumed atomically (single-use) inside the acting RPC. service_role SELECT-only; issued via qteklink_payroll_issue_confirm_token.';

ALTER TABLE public.qteklink_payroll_confirm_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payroll_confirm_tokens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payroll_confirm_tokens TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payroll_confirm_tokens FROM service_role;

-- ─── qteklink_payroll_audit_log (append-only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qteklink_payroll_audit_log (
  id              bigserial   PRIMARY KEY,
  shop_id         integer     NOT NULL,
  run_id          uuid,
  run_employee_id uuid,
  employee_id     uuid,
  actor_user_id   uuid,
  actor_label     text        NOT NULL,
  action          text        NOT NULL,
  detail          jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qteklink_payroll_audit_log_shop_positive CHECK (shop_id > 0),
  CONSTRAINT qteklink_payroll_audit_log_actor_nonblank CHECK (length(btrim(actor_label)) > 0),
  CONSTRAINT qteklink_payroll_audit_log_action_nonblank CHECK (length(btrim(action)) > 0)
);

CREATE INDEX IF NOT EXISTS qteklink_payroll_audit_log_run
  ON public.qteklink_payroll_audit_log (run_id);
CREATE INDEX IF NOT EXISTS qteklink_payroll_audit_log_shop_time
  ON public.qteklink_payroll_audit_log (shop_id, created_at);

COMMENT ON TABLE public.qteklink_payroll_audit_log IS
  'Append-only payroll audit trail (open-run edits are compensation-affecting): every mutating payroll RPC writes >= 1 row. UPDATE/DELETE always rejected by trigger — no bypass. service_role SELECT-only.';

ALTER TABLE public.qteklink_payroll_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qteklink_payroll_audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.qteklink_payroll_audit_log TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.qteklink_payroll_audit_log FROM service_role;
REVOKE ALL ON SEQUENCE public.qteklink_payroll_audit_log_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Immutability triggers (GUC pattern — model: keytag Layer-4 lockdown)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qteklink_payroll_enforce_run_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('completed','voided')
     AND coalesce(current_setting('qteklink.payroll_lock_bypass', true), '') <> 'on' THEN
    RAISE EXCEPTION 'qteklink payroll: run % is % and immutable — direct % rejected', OLD.id, OLD.status, TG_OP
      USING HINT = 'Completed/voided payroll runs are frozen. Use qteklink_payroll_void_run to reverse a completed run.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_enforce_run_lock IS
  'BEFORE UPDATE/DELETE on qteklink_payroll_runs: RAISE once status is completed/voided unless qteklink.payroll_lock_bypass=on (set only by void_run around its status flip; complete_run runs unbypassed — open->completed never trips this trigger).';

DROP TRIGGER IF EXISTS qteklink_payroll_runs_lock ON public.qteklink_payroll_runs;
CREATE TRIGGER qteklink_payroll_runs_lock
  BEFORE UPDATE OR DELETE ON public.qteklink_payroll_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.qteklink_payroll_enforce_run_lock();

CREATE OR REPLACE FUNCTION public.qteklink_payroll_enforce_entry_lock()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT r.status INTO v_status FROM public.qteklink_payroll_runs r WHERE r.id = OLD.run_id;
  IF v_status IN ('completed','voided')
     AND coalesce(current_setting('qteklink.payroll_lock_bypass', true), '') <> 'on' THEN
    RAISE EXCEPTION 'qteklink payroll: run % is % — its entry rows are immutable (direct % rejected)', OLD.run_id, v_status, TG_OP
      USING HINT = 'Completed/voided payroll runs (and their entries) are frozen. Use qteklink_payroll_void_run to reverse a completed run.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_enforce_entry_lock IS
  'BEFORE UPDATE/DELETE on qteklink_payroll_run_employees: resolves the parent run''s status via the FK and RAISEs once completed/voided unless qteklink.payroll_lock_bypass=on.';

DROP TRIGGER IF EXISTS qteklink_payroll_run_employees_lock ON public.qteklink_payroll_run_employees;
CREATE TRIGGER qteklink_payroll_run_employees_lock
  BEFORE UPDATE OR DELETE ON public.qteklink_payroll_run_employees
  FOR EACH ROW
  EXECUTE FUNCTION public.qteklink_payroll_enforce_entry_lock();

CREATE OR REPLACE FUNCTION public.qteklink_payroll_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'qteklink payroll audit log is append-only — % rejected', TG_OP;
END;
$$;
COMMENT ON FUNCTION public.qteklink_payroll_audit_append_only IS
  'BEFORE UPDATE/DELETE on qteklink_payroll_audit_log: always RAISE. No bypass.';

DROP TRIGGER IF EXISTS qteklink_payroll_audit_log_append_only ON public.qteklink_payroll_audit_log;
CREATE TRIGGER qteklink_payroll_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.qteklink_payroll_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.qteklink_payroll_audit_append_only();

REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_enforce_run_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_enforce_entry_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_audit_append_only() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Validators (RPC-side pay_config / overrides validation — mirrors the DAL Zod)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.qteklink_payroll_validate_pay_config(
  p_role text,
  p_pay_config jsonb,
  p_allow_rates_w2 boolean,
  p_context text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_family   text;
  v_required text[];
  v_allowed  text[];
  v_key      text;
  v_val      jsonb;
  v_num      numeric;
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

  v_required := ARRAY['config_version','pto_balance_hours','pto_accrual_hours_per_period']
    || CASE v_family
         WHEN 'technician'      THEN ARRAY['hourly_rate_cents','billed_rate_cents']
         WHEN 'shop_foreman'    THEN ARRAY['hourly_rate_cents','billed_rate_cents','shop_hour_goal','shop_hour_bonus_cents_per_hour']
         WHEN 'service_advisor' THEN ARRAY['weekly_salary_cents','gp_goal_1_cents','gp_goal_2_cents','sales_goal_cents',
                                           'tier1_pct','tier2_pct','tier3_pct','spiff_amount_cents']
         WHEN 'office_manager'  THEN ARRAY['hourly_rate_cents','sales_goal_cents','bonus_pct']
         ELSE                        ARRAY['hourly_rate_cents']  -- support
       END;
  v_allowed := v_required || CASE WHEN p_allow_rates_w2 THEN ARRAY['rates_w2'] ELSE ARRAY[]::text[] END;

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
    IF v_key = 'rates_w2' THEN
      CONTINUE;  -- validated below
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
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_validate_pay_config(text, jsonb, boolean, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.qteklink_payroll_validate_overrides(
  p_overrides jsonb,
  p_context text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  c_allowed CONSTANT text[] := ARRAY['billed_hours_w1','billed_hours_w2','month_sales_cents',
    'month_gp_with_fees_cents','month_gp_without_fees_cents','spiff_count','shop_hours',
    'sales_goal_cents','leave_rate_cents_per_hour'];
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

-- State hash for the Pattern S dance: md5 over (run.updated_at, count(entries),
-- max(entries.updated_at), run.bonus_period, run.bonus_month). Timestamps hashed as
-- epoch so the session TimeZone can never skew the text form between calls.
CREATE OR REPLACE FUNCTION public.qteklink_payroll_state_hash(p_run_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_updated_at   timestamptz;
  v_bonus_period boolean;
  v_bonus_month  date;
  v_count        bigint;
  v_max_updated  timestamptz;
BEGIN
  SELECT r.updated_at, r.bonus_period, r.bonus_month
  INTO v_updated_at, v_bonus_period, v_bonus_month
  FROM public.qteklink_payroll_runs r WHERE r.id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_state_hash: run % not found', p_run_id;
  END IF;
  SELECT count(*), max(re.updated_at) INTO v_count, v_max_updated
  FROM public.qteklink_payroll_run_employees re WHERE re.run_id = p_run_id;
  RETURN md5(
    extract(epoch FROM v_updated_at)::text
    || '|' || v_count::text
    || '|' || coalesce(extract(epoch FROM v_max_updated)::text, '-')
    || '|' || v_bonus_period::text
    || '|' || coalesce(v_bonus_month::text, '-')
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_state_hash(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs (exact signatures per the build contract)
-- ─────────────────────────────────────────────────────────────────────────────

-- p_employee_id NULL = create; derives tekmetric_id_type from the role family.
CREATE OR REPLACE FUNCTION public.qteklink_payroll_upsert_employee(
  p_shop_id integer,
  p_employee_id uuid,
  p_display_name text,
  p_role text,
  p_tekmetric_employee_id bigint,
  p_pay_config jsonb,
  p_archived boolean,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id      uuid;
  v_id_type text;
  v_action  text;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_upsert_employee: a positive p_shop_id is required';
  END IF;
  IF p_display_name IS NULL OR length(btrim(p_display_name)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_upsert_employee: a non-blank p_display_name is required';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('general_manager','service_manager','asst_manager','office_manager',
                                      'shop_foreman','technician','shop_support','office_support') THEN
    RAISE EXCEPTION 'qteklink_payroll_upsert_employee: invalid role "%"', p_role;
  END IF;
  IF p_tekmetric_employee_id IS NOT NULL AND p_tekmetric_employee_id <= 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_upsert_employee: p_tekmetric_employee_id must be positive';
  END IF;
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_upsert_employee: a non-blank p_actor_label is required';
  END IF;
  -- rates_w2 is a per-RUN override (run_employees.pay_config only) — not allowed here.
  PERFORM public.qteklink_payroll_validate_pay_config(p_role, p_pay_config, false, 'qteklink_payroll_upsert_employee');

  v_id_type := CASE
    WHEN p_role IN ('general_manager','service_manager','asst_manager','office_manager') THEN 'service_writer'
    ELSE 'technician'
  END;

  IF p_employee_id IS NULL THEN
    INSERT INTO public.qteklink_payroll_employees
      (shop_id, display_name, role, tekmetric_employee_id, tekmetric_id_type, pay_config,
       archived_at, created_by_label, updated_by_label)
    VALUES
      (p_shop_id, btrim(p_display_name), p_role, p_tekmetric_employee_id, v_id_type, p_pay_config,
       CASE WHEN coalesce(p_archived, false) THEN now() END, p_actor_label, p_actor_label)
    RETURNING id INTO v_id;
    v_action := 'employee_created';
  ELSE
    UPDATE public.qteklink_payroll_employees e SET
      display_name          = btrim(p_display_name),
      role                  = p_role,
      tekmetric_employee_id = p_tekmetric_employee_id,
      tekmetric_id_type     = v_id_type,
      pay_config            = p_pay_config,
      archived_at           = CASE WHEN coalesce(p_archived, false) THEN coalesce(e.archived_at, now()) ELSE NULL END,
      updated_by_label      = p_actor_label,
      updated_at            = now()
    WHERE e.id = p_employee_id AND e.shop_id = p_shop_id
    RETURNING e.id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'qteklink_payroll_upsert_employee: employee % not found for shop %', p_employee_id, p_shop_id;
    END IF;
    v_action := 'employee_updated';
  END IF;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, employee_id, actor_user_id, actor_label, action, detail)
  VALUES (p_shop_id, v_id, p_actor_user_id, p_actor_label, v_action,
          jsonb_build_object('display_name', btrim(p_display_name), 'role', p_role,
                             'tekmetric_employee_id', p_tekmetric_employee_id,
                             'archived', coalesce(p_archived, false)));
  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_upsert_employee(integer, uuid, text, text, bigint, jsonb, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_upsert_employee(integer, uuid, text, text, bigint, jsonb, boolean, uuid, text) TO service_role;

-- Validates the anchor cadence ((p_period_start - anchor) % 14 = 0) against
-- qteklink_settings.payroll->>'anchor_period_start', then clones every active
-- employee's pay_config into the run's entry rows.
CREATE OR REPLACE FUNCTION public.qteklink_payroll_create_run(
  p_shop_id integer,
  p_period_start date,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_anchor date;
  v_run_id uuid;
  v_added  integer;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_create_run: a positive p_shop_id is required';
  END IF;
  IF p_period_start IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_create_run: p_period_start is required';
  END IF;
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_create_run: a non-blank p_actor_label is required';
  END IF;

  SELECT (s.payroll->>'anchor_period_start')::date INTO v_anchor
  FROM public.qteklink_settings s
  WHERE s.shop_id = p_shop_id AND s.payroll ? 'anchor_period_start'
  ORDER BY s.updated_at DESC
  LIMIT 1;
  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'qteklink_payroll_create_run: payroll.anchor_period_start is not configured in qteklink_settings for shop %', p_shop_id;
  END IF;
  IF (p_period_start - v_anchor) % 14 <> 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_create_run: % is off the bi-weekly cadence anchored at %', p_period_start, v_anchor;
  END IF;
  IF EXISTS (SELECT 1 FROM public.qteklink_payroll_runs r
             WHERE r.shop_id = p_shop_id AND r.period_start = p_period_start AND r.status <> 'voided') THEN
    RAISE EXCEPTION 'qteklink_payroll_create_run: a non-voided run already exists for shop % period %', p_shop_id, p_period_start;
  END IF;

  INSERT INTO public.qteklink_payroll_runs (shop_id, period_start, period_end)
  VALUES (p_shop_id, p_period_start, p_period_start + 13)
  RETURNING id INTO v_run_id;

  INSERT INTO public.qteklink_payroll_run_employees (run_id, shop_id, employee_id, role_snapshot, pay_config)
  SELECT v_run_id, e.shop_id, e.id, e.role, e.pay_config
  FROM public.qteklink_payroll_employees e
  WHERE e.shop_id = p_shop_id AND e.archived_at IS NULL;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
  VALUES (p_shop_id, v_run_id, p_actor_user_id, p_actor_label, 'run_created',
          jsonb_build_object('period_start', p_period_start, 'period_end', p_period_start + 13,
                             'employees_added', v_added));
  RETURN v_run_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_create_run(integer, date, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_create_run(integer, date, uuid, text) TO service_role;

-- Open runs only. Adds newly-created active employees; removes ONLY entry-less rows
-- (and only for employees that have since been archived — rows with any entered data stay).
CREATE OR REPLACE FUNCTION public.qteklink_payroll_sync_run_roster(
  p_run_id uuid,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run     public.qteklink_payroll_runs%ROWTYPE;
  v_added   uuid[];
  v_removed uuid[];
BEGIN
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_sync_run_roster: a non-blank p_actor_label is required';
  END IF;
  -- FOR KEY SHARE: serializes the roster sync against complete_run/void_run's
  -- FOR UPDATE on the run row (see qteklink_payroll_update_entry) so rows can
  -- never be added to / removed from a run mid-completion.
  SELECT * INTO v_run FROM public.qteklink_payroll_runs r WHERE r.id = p_run_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_sync_run_roster: run % not found', p_run_id;
  END IF;
  IF v_run.status <> 'open' THEN
    RAISE EXCEPTION 'qteklink_payroll_sync_run_roster: run % is % — roster can only be synced on open runs', p_run_id, v_run.status;
  END IF;

  WITH ins AS (
    INSERT INTO public.qteklink_payroll_run_employees (run_id, shop_id, employee_id, role_snapshot, pay_config)
    SELECT v_run.id, e.shop_id, e.id, e.role, e.pay_config
    FROM public.qteklink_payroll_employees e
    WHERE e.shop_id = v_run.shop_id
      AND e.archived_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.qteklink_payroll_run_employees re
                      WHERE re.run_id = v_run.id AND re.employee_id = e.id)
    RETURNING employee_id
  )
  SELECT coalesce(array_agg(employee_id), ARRAY[]::uuid[]) INTO v_added FROM ins;

  WITH del AS (
    DELETE FROM public.qteklink_payroll_run_employees re
    USING public.qteklink_payroll_employees e
    WHERE re.run_id = v_run.id
      AND e.id = re.employee_id
      AND e.archived_at IS NOT NULL
      AND re.clock_hours_w1 IS NULL AND re.clock_hours_w2 IS NULL
      AND re.pto_w1 IS NULL AND re.pto_w2 IS NULL
      AND re.holiday_w1 IS NULL AND re.holiday_w2 IS NULL
      AND re.bereavement_w1 IS NULL AND re.bereavement_w2 IS NULL
      AND re.training_w1 IS NULL AND re.training_w2 IS NULL
      AND re.manual_incentive_cents IS NULL
      AND re.overrides = '{}'::jsonb
    RETURNING re.employee_id
  )
  SELECT coalesce(array_agg(employee_id), ARRAY[]::uuid[]) INTO v_removed FROM del;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
  VALUES (v_run.shop_id, v_run.id, p_actor_user_id, p_actor_label, 'roster_synced',
          jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));

  RETURN jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_sync_run_roster(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_sync_run_roster(uuid, uuid, text) TO service_role;

-- Whitelisted patch keys: the ten hour columns, manual_incentive_cents, overrides,
-- pay_config (rates_w2 allowed here). Open runs only. Audits old -> new per key.
CREATE OR REPLACE FUNCTION public.qteklink_payroll_update_entry(
  p_run_employee_id uuid,
  p_patch jsonb,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  c_allowed CONSTANT text[] := ARRAY[
    'clock_hours_w1','clock_hours_w2','pto_w1','pto_w2','holiday_w1','holiday_w2',
    'bereavement_w1','bereavement_w2','training_w1','training_w2',
    'manual_incentive_cents','overrides','pay_config'];
  v_row    public.qteklink_payroll_run_employees%ROWTYPE;
  v_status text;
  v_key    text;
  v_old    jsonb;
  v_num    numeric;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entry: a non-empty JSON object p_patch is required';
  END IF;
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entry: a non-blank p_actor_label is required';
  END IF;

  SELECT * INTO v_row FROM public.qteklink_payroll_run_employees re WHERE re.id = p_run_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entry: run employee row % not found', p_run_employee_id;
  END IF;
  -- FOR KEY SHARE serializes this edit against complete_run/void_run (which take
  -- FOR UPDATE on the run row) without blocking concurrent entry edits: an edit
  -- overlapping an in-flight completion waits here and sees the final status —
  -- it can never land on the entry rows of a just-completed run (the entry-lock
  -- trigger reads committed status and cannot catch that race alone).
  SELECT r.status INTO v_status FROM public.qteklink_payroll_runs r WHERE r.id = v_row.run_id FOR KEY SHARE;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entry: run % is % — entries are locked', v_row.run_id, v_status;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT v_key = ANY (c_allowed) THEN
      RAISE EXCEPTION 'qteklink_payroll_update_entry: key "%" is not editable', v_key;
    END IF;
    IF v_key NOT IN ('overrides','pay_config')
       AND jsonb_typeof(p_patch->v_key) NOT IN ('number','null') THEN
      RAISE EXCEPTION 'qteklink_payroll_update_entry: % must be a number or null', v_key;
    END IF;
  END LOOP;

  IF p_patch ? 'manual_incentive_cents' AND jsonb_typeof(p_patch->'manual_incentive_cents') = 'number' THEN
    v_num := (p_patch->>'manual_incentive_cents')::numeric;
    IF v_num <> trunc(v_num) THEN
      RAISE EXCEPTION 'qteklink_payroll_update_entry: manual_incentive_cents must be an integer (cents)';
    END IF;
  END IF;
  IF p_patch ? 'pay_config' THEN
    PERFORM public.qteklink_payroll_validate_pay_config(v_row.role_snapshot, p_patch->'pay_config', true, 'qteklink_payroll_update_entry');
  END IF;
  IF p_patch ? 'overrides' THEN
    PERFORM public.qteklink_payroll_validate_overrides(p_patch->'overrides', 'qteklink_payroll_update_entry');
  END IF;

  v_old := to_jsonb(v_row);

  UPDATE public.qteklink_payroll_run_employees re SET
    clock_hours_w1  = CASE WHEN p_patch ? 'clock_hours_w1'  THEN (p_patch->>'clock_hours_w1')::numeric  ELSE re.clock_hours_w1  END,
    clock_hours_w2  = CASE WHEN p_patch ? 'clock_hours_w2'  THEN (p_patch->>'clock_hours_w2')::numeric  ELSE re.clock_hours_w2  END,
    pto_w1          = CASE WHEN p_patch ? 'pto_w1'          THEN (p_patch->>'pto_w1')::numeric          ELSE re.pto_w1          END,
    pto_w2          = CASE WHEN p_patch ? 'pto_w2'          THEN (p_patch->>'pto_w2')::numeric          ELSE re.pto_w2          END,
    holiday_w1      = CASE WHEN p_patch ? 'holiday_w1'      THEN (p_patch->>'holiday_w1')::numeric      ELSE re.holiday_w1      END,
    holiday_w2      = CASE WHEN p_patch ? 'holiday_w2'      THEN (p_patch->>'holiday_w2')::numeric      ELSE re.holiday_w2      END,
    bereavement_w1  = CASE WHEN p_patch ? 'bereavement_w1'  THEN (p_patch->>'bereavement_w1')::numeric  ELSE re.bereavement_w1  END,
    bereavement_w2  = CASE WHEN p_patch ? 'bereavement_w2'  THEN (p_patch->>'bereavement_w2')::numeric  ELSE re.bereavement_w2  END,
    training_w1     = CASE WHEN p_patch ? 'training_w1'     THEN (p_patch->>'training_w1')::numeric     ELSE re.training_w1     END,
    training_w2     = CASE WHEN p_patch ? 'training_w2'     THEN (p_patch->>'training_w2')::numeric     ELSE re.training_w2     END,
    manual_incentive_cents = CASE WHEN p_patch ? 'manual_incentive_cents' THEN (p_patch->>'manual_incentive_cents')::bigint ELSE re.manual_incentive_cents END,
    overrides       = CASE WHEN p_patch ? 'overrides'       THEN p_patch->'overrides'                   ELSE re.overrides       END,
    pay_config      = CASE WHEN p_patch ? 'pay_config'      THEN p_patch->'pay_config'                  ELSE re.pay_config      END,
    updated_at      = now()
  WHERE re.id = p_run_employee_id;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    INSERT INTO public.qteklink_payroll_audit_log
      (shop_id, run_id, run_employee_id, employee_id, actor_user_id, actor_label, action, detail)
    VALUES
      (v_row.shop_id, v_row.run_id, v_row.id, v_row.employee_id, p_actor_user_id, p_actor_label, 'entry_updated',
       jsonb_build_object('key', v_key, 'old', v_old->v_key, 'new', p_patch->v_key));
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_update_entry(uuid, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_update_entry(uuid, jsonb, uuid, text) TO service_role;

-- Whitelisted patch: bonus_period (boolean). ON derives + stores bonus_month =
-- first of (month of period_start - 1 month); OFF clears it. Open runs only.
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
    IF v_key <> 'bonus_period' THEN
      RAISE EXCEPTION 'qteklink_payroll_update_run: key "%" is not editable', v_key;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_patch->'bonus_period') <> 'boolean' THEN
    RAISE EXCEPTION 'qteklink_payroll_update_run: bonus_period must be a boolean';
  END IF;

  v_bonus := (p_patch->>'bonus_period')::boolean;
  v_month := CASE WHEN v_bonus
                  THEN (date_trunc('month', v_run.period_start::timestamp) - interval '1 month')::date
                  ELSE NULL END;

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

-- Pattern S: issue a 5-minute single-use token bound to (run, action, state hash).
CREATE OR REPLACE FUNCTION public.qteklink_payroll_issue_confirm_token(
  p_run_id uuid,
  p_action_kind text,
  p_scope_hash text,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS TABLE (token_id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop_id integer;
  v_id      uuid;
  v_expires timestamptz;
BEGIN
  IF p_action_kind IS NULL OR p_action_kind NOT IN ('complete_run','void_run') THEN
    RAISE EXCEPTION 'qteklink_payroll_issue_confirm_token: invalid action_kind "%"', p_action_kind;
  END IF;
  IF p_scope_hash IS NULL OR length(btrim(p_scope_hash)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_issue_confirm_token: a non-blank p_scope_hash is required';
  END IF;
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_issue_confirm_token: a non-blank p_actor_label is required';
  END IF;
  SELECT r.shop_id INTO v_shop_id FROM public.qteklink_payroll_runs r WHERE r.id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_issue_confirm_token: run % not found', p_run_id;
  END IF;

  v_expires := now() + interval '5 minutes';
  INSERT INTO public.qteklink_payroll_confirm_tokens (shop_id, action_kind, scope_hash, run_id, expires_at)
  VALUES (v_shop_id, p_action_kind, p_scope_hash, p_run_id, v_expires)
  RETURNING id INTO v_id;

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
  VALUES (v_shop_id, p_run_id, p_actor_user_id, p_actor_label, 'confirm_token_issued',
          jsonb_build_object('action_kind', p_action_kind, 'token_id', v_id));

  RETURN QUERY SELECT v_id, v_expires;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_issue_confirm_token(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_issue_confirm_token(uuid, text, text, uuid, text) TO service_role;

-- Pattern S completion. dry_run: recompute + return {state_hash} (the caller then
-- issues a token against it). Non-dry: recompute the hash, abort on mismatch (state
-- moved since the preview), require a non-null snapshot, atomically consume the token
-- (kind complete_run, scope = the recomputed hash, unexpired, unconsumed), then
-- GUC-write snapshot + status + completed_* in one statement. Returns {completed: true}.
CREATE OR REPLACE FUNCTION public.qteklink_payroll_complete_run(
  p_run_id uuid,
  p_dry_run boolean,
  p_confirm_token uuid,
  p_state_hash text,
  p_snapshot jsonb,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_run   public.qteklink_payroll_runs%ROWTYPE;
  v_hash  text;
  v_token uuid;
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

  INSERT INTO public.qteklink_payroll_audit_log (shop_id, run_id, actor_user_id, actor_label, action, detail)
  VALUES (v_run.shop_id, p_run_id, p_actor_user_id, p_actor_label, 'run_completed',
          jsonb_build_object('state_hash', v_hash, 'confirm_token', p_confirm_token));

  RETURN jsonb_build_object('completed', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_complete_run(uuid, boolean, uuid, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_complete_run(uuid, boolean, uuid, text, jsonb, uuid, text) TO service_role;

-- Void-and-clone (completed runs only; same token dance, kind void_run). The voided
-- run's data stays frozen forever; every input row is cloned into a new OPEN run for
-- the same period with cloned_from_run_id lineage. Returns {voided: true, clone_run_id}.
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
  v_run    public.qteklink_payroll_runs%ROWTYPE;
  v_hash   text;
  v_token  uuid;
  v_clone  uuid;
  v_copied integer;
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
     jsonb_build_object('reason', btrim(p_reason), 'clone_run_id', v_clone, 'state_hash', v_hash)),
    (v_run.shop_id, v_clone, p_actor_user_id, p_actor_label, 'run_cloned',
     jsonb_build_object('cloned_from_run_id', p_run_id, 'entries_copied', v_copied));

  RETURN jsonb_build_object('voided', true, 'clone_run_id', v_clone);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_void_run(uuid, text, boolean, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_void_run(uuid, text, boolean, uuid, text, uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- qteklink_settings: new `payroll` JSONB key via the existing partial-update RPC
-- (anchor_period_start + spiff_categories + alert_emails live here).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.qteklink_settings
  ADD COLUMN IF NOT EXISTS payroll jsonb;

COMMENT ON COLUMN public.qteklink_settings.payroll IS
  'Payroll module settings: { anchor_period_start: ISO date, spiff_categories: [{name, counted, multiplier, first_seen, is_new}], alert_emails: {void_clone: [], completed: []} }. NULL p_payroll in the upsert leaves it unchanged.';

-- Same contract as 20260611090000 (NULL = leave unchanged) + a 10th p_payroll param
-- (whole-object replace when non-null; the DAL read-modify-writes the object).
DROP FUNCTION IF EXISTS public.qteklink_upsert_settings(integer, text, boolean, integer, text, integer, integer, text, text);
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

COMMIT;
