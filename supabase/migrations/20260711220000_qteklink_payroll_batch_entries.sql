-- =====================================================================
-- QTekLink Payroll — batch entry updates (round-8, decision #43)
-- =====================================================================
-- 2026-07-11. docs/qteklink/payroll-workbook-extraction-2026-07-10.md #43 +
-- docs/qteklink/payroll-contract.md §Round-8.
--
-- The entry grid gets ONE Save button: all dirty cells submit as ONE ATOMIC
-- batch. New RPC:
--
--   qteklink_payroll_update_entries(p_run_id uuid, p_patches jsonb,
--     p_actor_user_id uuid, p_actor_label text) RETURNS jsonb  -- {updated: n}
--
--   * p_patches = JSON ARRAY of {run_employee_id, patch}; every patch uses
--     EXACTLY the same whitelisted-key semantics as qteklink_payroll_update_entry.
--   * ONE VALIDATOR: the per-row validate+apply+audit body is extracted into
--     qteklink_payroll_apply_entry_patch(...) below, and update_entry is
--     RE-CREATED here to delegate to that same helper — there is no forked
--     validation logic anywhere (single + batch share one code path).
--   * ALL-OR-NOTHING: a plpgsql function body is a single transaction — any
--     invalid patch RAISEs and rolls back EVERY row (the repo's
--     non-atomic-multi-write invariant).
--   * The open-run guard (FOR KEY SHARE against complete_run/void_run's
--     FOR UPDATE) is taken ONCE on the run row — not per row.
--   * CROSS-RUN SMUGGLING: every run_employee row must belong to p_run_id;
--     a row from any other run RAISEs (and rolls back the batch).
--   * Per-row audit preserved: the same 'entry_updated' action + per-key
--     {key, old, new} detail as single updates, PLUS detail.batch_id (one
--     uuid per batch call) linking the batch's audit rows together.
--
-- Grant idiom (model: 20260607090000_qteklink_settings_ro_state.sql):
-- REVOKE EXECUTE FROM PUBLIC/anon/authenticated on everything; GRANT
-- service_role on the public RPCs only. The helper gets REVOKE only — it is
-- internal, invoked from inside the DEFINER RPCs (like the two validators).
-- Apply: orchestrator (supabase db push). IDEMPOTENT (CREATE OR REPLACE).
-- =====================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1) The shared per-row validator/applier (extracted from update_entry).
--    Validates the patch (whitelist, types, manual-incentive integer,
--    pay_config + overrides validators), applies the UPDATE, and writes the
--    per-key audit rows. p_fn prefixes the error messages so the single and
--    batch paths keep self-describing errors; p_batch_id (nullable) rides
--    into every audit row's detail when present.
--    Callers own the run-status lock: this helper NEVER locks the run row.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_payroll_apply_entry_patch(
  p_row public.qteklink_payroll_run_employees,
  p_patch jsonb,
  p_actor_user_id uuid,
  p_actor_label text,
  p_fn text,
  p_batch_id uuid
)
RETURNS void
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  c_allowed CONSTANT text[] := ARRAY[
    'clock_hours_w1','clock_hours_w2','pto_w1','pto_w2','holiday_w1','holiday_w2',
    'bereavement_w1','bereavement_w2','training_w1','training_w2',
    'manual_incentive_cents','overrides','pay_config'];
  v_key    text;
  v_old    jsonb;
  v_num    numeric;
  v_detail jsonb;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION '%: a non-empty JSON object patch is required', p_fn;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT v_key = ANY (c_allowed) THEN
      RAISE EXCEPTION '%: key "%" is not editable', p_fn, v_key;
    END IF;
    IF v_key NOT IN ('overrides','pay_config')
       AND jsonb_typeof(p_patch->v_key) NOT IN ('number','null') THEN
      RAISE EXCEPTION '%: % must be a number or null', p_fn, v_key;
    END IF;
  END LOOP;

  IF p_patch ? 'manual_incentive_cents' AND jsonb_typeof(p_patch->'manual_incentive_cents') = 'number' THEN
    v_num := (p_patch->>'manual_incentive_cents')::numeric;
    IF v_num <> trunc(v_num) THEN
      RAISE EXCEPTION '%: manual_incentive_cents must be an integer (cents)', p_fn;
    END IF;
  END IF;
  IF p_patch ? 'pay_config' THEN
    PERFORM public.qteklink_payroll_validate_pay_config(p_row.role_snapshot, p_patch->'pay_config', true, p_fn);
  END IF;
  IF p_patch ? 'overrides' THEN
    PERFORM public.qteklink_payroll_validate_overrides(p_patch->'overrides', p_fn);
  END IF;

  v_old := to_jsonb(p_row);

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
  WHERE re.id = p_row.id;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    v_detail := jsonb_build_object('key', v_key, 'old', v_old->v_key, 'new', p_patch->v_key);
    IF p_batch_id IS NOT NULL THEN
      v_detail := v_detail || jsonb_build_object('batch_id', p_batch_id);
    END IF;
    INSERT INTO public.qteklink_payroll_audit_log
      (shop_id, run_id, run_employee_id, employee_id, actor_user_id, actor_label, action, detail)
    VALUES
      (p_row.shop_id, p_row.run_id, p_row.id, p_row.employee_id, p_actor_user_id, p_actor_label, 'entry_updated', v_detail);
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_apply_entry_patch(public.qteklink_payroll_run_employees, jsonb, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) update_entry — RE-CREATED to delegate to the shared helper. Signature,
--    locking, error codes and audit shape are UNCHANGED from 20260710210000;
--    only the per-row validate/apply/audit body moved into the helper (the
--    single-validator requirement of #43).
-- ─────────────────────────────────────────────────────────────────────
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
  v_row    public.qteklink_payroll_run_employees%ROWTYPE;
  v_status text;
BEGIN
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

  PERFORM public.qteklink_payroll_apply_entry_patch(
    v_row, p_patch, p_actor_user_id, p_actor_label, 'qteklink_payroll_update_entry', NULL);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_update_entry(uuid, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_update_entry(uuid, jsonb, uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3) update_entries — the #43 atomic batch. One run lock, N rows through the
--    shared helper, one batch_id linking the audit rows. Any failure rolls
--    back everything (single plpgsql transaction).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qteklink_payroll_update_entries(
  p_run_id uuid,
  p_patches jsonb,
  p_actor_user_id uuid,
  p_actor_label text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status   text;
  v_batch_id uuid := gen_random_uuid();
  v_elem     jsonb;
  v_key      text;
  v_reid     uuid;
  v_row      public.qteklink_payroll_run_employees%ROWTYPE;
  v_count    integer := 0;
BEGIN
  IF p_actor_label IS NULL OR length(btrim(p_actor_label)) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entries: a non-blank p_actor_label is required';
  END IF;
  IF p_patches IS NULL OR jsonb_typeof(p_patches) <> 'array' THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entries: p_patches must be a JSON array of {run_employee_id, patch}';
  END IF;
  IF jsonb_array_length(p_patches) = 0 THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entries: the batch is empty — nothing to update';
  END IF;

  -- The open-run guard, ONCE for the whole batch (not per row): FOR KEY SHARE
  -- serializes against complete_run/void_run's FOR UPDATE without blocking
  -- concurrent entry edits — same rationale as update_entry.
  SELECT r.status INTO v_status FROM public.qteklink_payroll_runs r WHERE r.id = p_run_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entries: run % not found', p_run_id;
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'qteklink_payroll_update_entries: run % is % — entries are locked', p_run_id, v_status;
  END IF;

  FOR v_elem IN SELECT jsonb_array_elements(p_patches) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'qteklink_payroll_update_entries: each batch element must be a {run_employee_id, patch} object';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_elem) LOOP
      IF v_key NOT IN ('run_employee_id','patch') THEN
        RAISE EXCEPTION 'qteklink_payroll_update_entries: unexpected batch element key "%"', v_key;
      END IF;
    END LOOP;
    IF jsonb_typeof(v_elem->'run_employee_id') <> 'string' THEN
      RAISE EXCEPTION 'qteklink_payroll_update_entries: run_employee_id must be a uuid string';
    END IF;
    BEGIN
      v_reid := (v_elem->>'run_employee_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'qteklink_payroll_update_entries: run_employee_id "%" is not a valid uuid', v_elem->>'run_employee_id';
    END;

    SELECT * INTO v_row FROM public.qteklink_payroll_run_employees re WHERE re.id = v_reid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'qteklink_payroll_update_entries: run employee row % not found', v_reid;
    END IF;
    -- Cross-run smuggling guard: every row must belong to THE locked run.
    IF v_row.run_id <> p_run_id THEN
      RAISE EXCEPTION 'qteklink_payroll_update_entries: run employee row % belongs to run %, not %', v_reid, v_row.run_id, p_run_id;
    END IF;

    PERFORM public.qteklink_payroll_apply_entry_patch(
      v_row, v_elem->'patch', p_actor_user_id, p_actor_label, 'qteklink_payroll_update_entries', v_batch_id);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_count);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.qteklink_payroll_update_entries(uuid, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qteklink_payroll_update_entries(uuid, jsonb, uuid, text) TO service_role;

COMMIT;
