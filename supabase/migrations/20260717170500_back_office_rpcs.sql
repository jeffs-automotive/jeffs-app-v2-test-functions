-- =====================================================================
-- Back Office module — status-machine + detection RPCs (Phase 1)
-- =====================================================================
-- 2026-07-17. Companion to 20260717170000_back_office_issues.sql.
-- All mutations to back_office_issues / back_office_issue_events go through these
-- SECURITY DEFINER RPCs (SET search_path = public), service_role EXECUTE only. Each
-- transition locks the row (SELECT ... FOR UPDATE), enforces the from-state, and writes
-- the paired audit row atomically. Transitions are shop-scoped (p_shop_id must match the
-- issue's shop) as tenant defense-in-depth on top of the unguessable uuid id.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

-- ─── create (manual / qbo_fetch) ─────────────────────────────────────────────
-- p_payload carries the kind's columns:
--   { realm_id, title, ro_number, tekmetric_ro_id, vendor_name, bill_no, bill_date,
--     total_cents, qbo_txn_type, qbo_txn_id, bo_notes, context }
CREATE OR REPLACE FUNCTION public.back_office_create_issue(
  p_shop_id   integer,
  p_kind      text,
  p_source    text,
  p_payload   jsonb,
  p_actor     text,
  p_actor_app text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 THEN
    RAISE EXCEPTION 'back_office_create_issue: a positive p_shop_id is required';
  END IF;
  IF p_kind NOT IN ('invoice_issue','open_ro','reopened_ro','misc') THEN
    RAISE EXCEPTION 'back_office_create_issue: invalid kind %', p_kind;
  END IF;
  IF p_source NOT IN ('manual','qbo_fetch','tekmetric_detection') THEN
    RAISE EXCEPTION 'back_office_create_issue: invalid source %', p_source;
  END IF;

  INSERT INTO public.back_office_issues (
    shop_id, realm_id, kind, status, source, title, ro_number, tekmetric_ro_id,
    vendor_name, bill_no, bill_date, total_cents, qbo_txn_type, qbo_txn_id,
    bo_notes, context, created_by
  )
  VALUES (
    p_shop_id,
    nullif(btrim(p_payload->>'realm_id'), ''),
    p_kind, 'open', p_source,
    nullif(btrim(p_payload->>'title'), ''),
    nullif(btrim(p_payload->>'ro_number'), ''),
    (p_payload->>'tekmetric_ro_id')::bigint,
    nullif(btrim(p_payload->>'vendor_name'), ''),
    nullif(btrim(p_payload->>'bill_no'), ''),
    (p_payload->>'bill_date')::date,
    (p_payload->>'total_cents')::bigint,
    nullif(btrim(p_payload->>'qbo_txn_type'), ''),
    nullif(btrim(p_payload->>'qbo_txn_id'), ''),
    nullif(btrim(p_payload->>'bo_notes'), ''),
    coalesce(p_payload->'context', '{}'::jsonb),
    nullif(btrim(p_actor), '')
  )
  RETURNING id INTO v_id;

  INSERT INTO public.back_office_issue_events (issue_id, action, prior_status, new_status, actor, actor_app, note)
  VALUES (v_id, 'created', NULL, 'open', nullif(btrim(p_actor), ''), p_actor_app, nullif(btrim(p_payload->>'bo_notes'), ''));

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_create_issue(integer, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_create_issue(integer, text, text, jsonb, text, text) TO service_role;

-- ─── send to service advisor (open | awaiting_verify -> sent_to_sa) ──────────
-- Returns the audit action taken ('sent_to_sa' | 'resent_to_sa') so the caller can pick
-- the right alert, or 'noop' on a wrong from-state (idempotent).
CREATE OR REPLACE FUNCTION public.back_office_send_to_sa(
  p_shop_id  integer,
  p_issue_id uuid,
  p_actor    text,
  p_note     text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prior  text;
  v_action text;
BEGIN
  IF p_shop_id IS NULL OR p_issue_id IS NULL THEN
    RAISE EXCEPTION 'back_office_send_to_sa: p_shop_id + p_issue_id are required';
  END IF;

  SELECT status INTO v_prior FROM public.back_office_issues
   WHERE id = p_issue_id AND shop_id = p_shop_id FOR UPDATE;
  IF v_prior IS NULL OR v_prior NOT IN ('open','awaiting_verify') THEN
    RETURN 'noop';                             -- not found / wrong from-state
  END IF;

  v_action := CASE WHEN v_prior = 'awaiting_verify' THEN 'resent_to_sa' ELSE 'sent_to_sa' END;

  UPDATE public.back_office_issues
     SET status = 'sent_to_sa',
         bo_notes = coalesce(nullif(btrim(p_note), ''), bo_notes),
         sent_to_sa_at = now(),
         last_activity_at = now(),
         updated_at = now()
   WHERE id = p_issue_id AND shop_id = p_shop_id;

  INSERT INTO public.back_office_issue_events (issue_id, action, prior_status, new_status, actor, actor_app, note)
  VALUES (p_issue_id, v_action, v_prior, 'sent_to_sa', nullif(btrim(p_actor), ''), 'qteklink', nullif(btrim(p_note), ''));

  RETURN v_action;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_send_to_sa(integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_send_to_sa(integer, uuid, text, text) TO service_role;

-- ─── service advisor submits the fix (sent_to_sa -> awaiting_verify) ─────────
CREATE OR REPLACE FUNCTION public.back_office_submit_fix(
  p_shop_id  integer,
  p_issue_id uuid,
  p_actor    text,
  p_sa_note  text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prior text;
BEGIN
  IF p_shop_id IS NULL OR p_issue_id IS NULL THEN
    RAISE EXCEPTION 'back_office_submit_fix: p_shop_id + p_issue_id are required';
  END IF;

  SELECT status INTO v_prior FROM public.back_office_issues
   WHERE id = p_issue_id AND shop_id = p_shop_id FOR UPDATE;
  IF v_prior IS DISTINCT FROM 'sent_to_sa' THEN
    RETURN false;
  END IF;

  UPDATE public.back_office_issues
     SET status = 'awaiting_verify',
         sa_notes = nullif(btrim(p_sa_note), ''),
         sa_submitted_at = now(),
         last_activity_at = now(),
         updated_at = now()
   WHERE id = p_issue_id AND shop_id = p_shop_id;

  INSERT INTO public.back_office_issue_events (issue_id, action, prior_status, new_status, actor, actor_app, note)
  VALUES (p_issue_id, 'sa_submitted', v_prior, 'awaiting_verify', nullif(btrim(p_actor), ''), 'admin', nullif(btrim(p_sa_note), ''));

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_submit_fix(integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_submit_fix(integer, uuid, text, text) TO service_role;

-- ─── verify = close (open | sent_to_sa | awaiting_verify -> verified) ────────
CREATE OR REPLACE FUNCTION public.back_office_verify(
  p_shop_id   integer,
  p_issue_id  uuid,
  p_actor     text,
  p_actor_app text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_prior text;
BEGIN
  IF p_shop_id IS NULL OR p_issue_id IS NULL OR p_actor IS NULL OR length(btrim(p_actor)) = 0 THEN
    RAISE EXCEPTION 'back_office_verify: p_shop_id + p_issue_id + p_actor are required';
  END IF;

  SELECT status INTO v_prior FROM public.back_office_issues
   WHERE id = p_issue_id AND shop_id = p_shop_id FOR UPDATE;
  IF v_prior IS NULL OR v_prior = 'verified' THEN
    RETURN false;
  END IF;

  UPDATE public.back_office_issues
     SET status = 'verified',
         verified_at = now(),
         verified_by = btrim(p_actor),
         last_activity_at = now(),
         updated_at = now()
   WHERE id = p_issue_id AND shop_id = p_shop_id;

  INSERT INTO public.back_office_issue_events (issue_id, action, prior_status, new_status, actor, actor_app)
  VALUES (p_issue_id, 'verified', v_prior, 'verified', btrim(p_actor), p_actor_app);

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_verify(integer, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_verify(integer, uuid, text, text) TO service_role;

-- ─── reopened-RO detection upsert (dedup per unpost cycle) ────────────────────
-- p_cycle: { ro_number, change_type, original_posted_date, new_posted_date,
--            original_total_cents, new_total_cents, unposted_by, unposted_at }
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
  IF p_cycle->>'unposted_at' IS NULL OR length(btrim(p_cycle->>'unposted_at')) = 0 THEN
    RAISE EXCEPTION 'back_office_upsert_reopened: p_cycle.unposted_at is required (dedup key)';
  END IF;

  INSERT INTO public.back_office_issues (
    shop_id, kind, status, source, ro_number, tekmetric_ro_id, total_cents, context, last_activity_at
  )
  VALUES (
    p_shop_id, 'reopened_ro', 'open', 'tekmetric_detection',
    nullif(btrim(p_cycle->>'ro_number'), ''),
    p_tekmetric_ro_id,
    (p_cycle->>'new_total_cents')::bigint,
    p_cycle,
    now()
  )
  ON CONFLICT (shop_id, tekmetric_ro_id, (context->>'unposted_at')) WHERE kind = 'reopened_ro'
  DO UPDATE SET
    context     = p_cycle,
    ro_number   = coalesce(nullif(btrim(p_cycle->>'ro_number'), ''), public.back_office_issues.ro_number),
    total_cents = coalesce((p_cycle->>'new_total_cents')::bigint, public.back_office_issues.total_cents),
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

-- ─── open-RO auto-close (decision #12): flip matching open_ro rows to ro_closed ─
-- Matches by RO number (the invoice's customer-line RO#). Returns the affected issue
-- ids so the cron sends a "verify the entries" nudge for each.
CREATE OR REPLACE FUNCTION public.back_office_close_open_ro(
  p_shop_id         integer,
  p_ro_number       text,
  p_tekmetric_ro_id bigint,
  p_closed_at       timestamptz
)
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_now timestamptz := now();
  v_ids uuid[] := '{}';
BEGIN
  IF p_shop_id IS NULL OR p_shop_id <= 0 OR p_ro_number IS NULL OR length(btrim(p_ro_number)) = 0 THEN
    RAISE EXCEPTION 'back_office_close_open_ro: positive p_shop_id + non-blank p_ro_number are required';
  END IF;

  FOR v_id IN
    SELECT id FROM public.back_office_issues
     WHERE shop_id = p_shop_id
       AND kind = 'open_ro'
       AND status <> 'verified'
       AND ro_number = btrim(p_ro_number)
       AND coalesce(context->>'ro_status', 'ro_open') IS DISTINCT FROM 'ro_closed'
     FOR UPDATE
  LOOP
    UPDATE public.back_office_issues
       SET context = context
                     || jsonb_build_object('ro_status', 'ro_closed')
                     || jsonb_build_object('ro_closed_at', coalesce(p_closed_at, v_now)),
           tekmetric_ro_id = coalesce(tekmetric_ro_id, p_tekmetric_ro_id),
           last_activity_at = v_now,
           updated_at = v_now
     WHERE id = v_id;

    INSERT INTO public.back_office_issue_events (issue_id, action, prior_status, new_status, actor_app, note)
    VALUES (v_id, 'ro_closed', 'open', 'open', 'system', 'RO closed in Tekmetric');

    v_ids := array_append(v_ids, v_id);
  END LOOP;

  RETURN v_ids;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_close_open_ro(integer, text, bigint, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_close_open_ro(integer, text, bigint, timestamptz) TO service_role;

-- ─── stamp the email-send result on the latest matching audit row (notify) ────
CREATE OR REPLACE FUNCTION public.back_office_stamp_email(
  p_issue_id uuid,
  p_action   text,
  p_error    text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.back_office_issue_events
     SET email_sent_at = now(), email_error = nullif(btrim(p_error), '')
   WHERE id = (
     SELECT id FROM public.back_office_issue_events
      WHERE issue_id = p_issue_id AND action = p_action
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
   );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_stamp_email(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_stamp_email(uuid, text, text) TO service_role;

-- ─── dashboard counts (the one aggregate; repo has no other) ──────────────────
CREATE OR REPLACE FUNCTION public.back_office_dashboard_counts(
  p_shop_id     integer,
  p_month_start date,
  p_stale_hours integer
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'open_count',        count(*) FILTER (WHERE status <> 'verified'),
    'closed_this_month', count(*) FILTER (WHERE status = 'verified' AND verified_at >= p_month_start::timestamptz),
    'stale_count',       count(*) FILTER (
                            WHERE status <> 'verified'
                              AND last_activity_at < now() - make_interval(hours => coalesce(p_stale_hours, 48))
                         )
  )
  FROM public.back_office_issues
  WHERE shop_id = p_shop_id;
$$;
REVOKE EXECUTE ON FUNCTION public.back_office_dashboard_counts(integer, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.back_office_dashboard_counts(integer, date, integer) TO service_role;

COMMIT;
