-- =====================================================================
-- concern_clarify_candidates column + apply_wizard_transition CASE arm
-- Created 2026-07-03 — act-or-ask Stage 1 (AO2d)
-- =====================================================================
-- Stage 1 of the diagnostic classifier now returns 0-3 RANKED category
-- candidates (act-or-ask contract — docs/scheduler/act-or-ask-stage1-plan.md).
-- When a concern gets 2-3 candidates, run-diagnostics persists one entry
-- per such concern to the NEW customer_chat_sessions.concern_clarify_candidates
-- JSONB column:
--
--   [
--     {
--       "concern_index": 0,
--       "service_key": "<picker chip key>",
--       "concern_text": "<explanation text>",
--       "candidates": [
--         {
--           "key": "<category key>",
--           "kind": "testing_service" | "other_subcategory",
--           "display_name": "...",
--           "starting_price_cents": 4768 | null,
--           "description": "<first sentence>" | null,
--           "precomputed": {
--             "matched_subcategory_slug": "..." | null,
--             "unanswered_question_ids": [ ... ]
--           }
--         }, ...
--       ]
--     }, ...
--   ]
--
-- …and routes the wizard to the concern_clarify chip card. The customer's
-- tap resolves DETERMINISTICALLY from the precomputed per-candidate
-- Stage-2/Stage-3 payloads (no second LLM call / spinner). The clarify
-- resolution action clears the column ([] / removal per concern) as taps
-- are consumed.
--
-- The apply_wizard_transition RPC allowlists columns via CASE-WHEN-?
-- arms; this migration recreates it FROM THE LATEST FULL DEFINITION
-- (20260525000000_appointment_verification_columns_and_rpc.sql — verified
-- most-recent CREATE OR REPLACE; 20260525010000 only ALTERed SECURITY)
-- adding the new JSONB arm with the standard explicit-JSONB-null-clears
-- pattern. SECURITY INVOKER is asserted EXPLICITLY in the definition this
-- time (the 2026-05-25 hardening — Validator 1 H1 — required a follow-up
-- ALTER because Phase 4's CREATE OR REPLACE omitted the keyword; don't
-- repeat that).
-- =====================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1 / 2 — new column on customer_chat_sessions
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE public.customer_chat_sessions
  ADD COLUMN concern_clarify_candidates JSONB;

COMMENT ON COLUMN public.customer_chat_sessions.concern_clarify_candidates IS
  'Act-or-ask Stage 1 (2026-07-03): per-concern clarify entries persisted by run_diagnostics_v2 when the diagnostic Stage 1 returned 2-3 ranked category candidates for a concern. Array of {concern_index, service_key, concern_text, candidates:[{key, kind, display_name, starting_price_cents, description, precomputed:{matched_subcategory_slug, unanswered_question_ids}}]}. The concern_clarify chip card renders from this; the customer''s tap resolves deterministically from the precomputed payloads. Cleared ([] or NULL) once resolved.';

-- ────────────────────────────────────────────────────────────────────
-- 2 / 2 — apply_wizard_transition gains the concern_clarify_candidates
-- CASE arm (standard JSONB pattern: explicit JSONB null clears to SQL
-- NULL). Full body reproduced via CREATE OR REPLACE from the
-- 20260525000000 definition; all other columns' behavior preserved
-- exactly.
-- ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_wizard_transition(
  p_chat_id UUID,
  p_payload JSONB,
  p_user_bubble_text TEXT DEFAULT NULL,
  p_assistant_bubble_text TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row                JSONB;
  v_shop_id            INTEGER;
  v_user_inserted      BOOLEAN := FALSE;
  v_assistant_inserted BOOLEAN := FALSE;
  v_user_text          TEXT;
  v_assistant_text     TEXT;
  v_session_row        public.customer_chat_sessions;
BEGIN
  IF p_payload IS NOT NULL AND pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'apply_wizard_transition: p_payload must be a JSONB object, got %',
      pg_catalog.jsonb_typeof(p_payload)
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.customer_chat_sessions SET
    channel = CASE
      WHEN p_payload ? 'channel' THEN p_payload->>'channel'
      ELSE channel
    END,
    phone_e164 = CASE
      WHEN p_payload ? 'phone_e164' THEN p_payload->>'phone_e164'
      ELSE phone_e164
    END,
    customer_self_identified = CASE
      WHEN p_payload ? 'customer_self_identified' THEN p_payload->>'customer_self_identified'
      ELSE customer_self_identified
    END,
    customer_id = CASE
      WHEN p_payload ? 'customer_id' THEN (p_payload->>'customer_id')::BIGINT
      ELSE customer_id
    END,
    vehicle_id = CASE
      WHEN p_payload ? 'vehicle_id' THEN (p_payload->>'vehicle_id')::BIGINT
      ELSE vehicle_id
    END,
    cookie_session = CASE
      WHEN p_payload ? 'cookie_session' THEN p_payload->>'cookie_session'
      ELSE cookie_session
    END,
    status = CASE
      WHEN p_payload ? 'status' THEN p_payload->>'status'
      ELSE status
    END,
    outcome = CASE
      WHEN p_payload ? 'outcome' THEN p_payload->>'outcome'
      ELSE outcome
    END,
    appointment_id = CASE
      WHEN p_payload ? 'appointment_id' THEN (p_payload->>'appointment_id')::BIGINT
      ELSE appointment_id
    END,
    opted_out_at = CASE
      WHEN p_payload ? 'opted_out_at' THEN (p_payload->>'opted_out_at')::TIMESTAMPTZ
      ELSE opted_out_at
    END,
    sentiment = CASE
      WHEN p_payload ? 'sentiment' THEN p_payload->>'sentiment'
      ELSE sentiment
    END,
    ended_at = CASE
      WHEN p_payload ? 'ended_at' THEN (p_payload->>'ended_at')::TIMESTAMPTZ
      ELSE ended_at
    END,
    current_step = CASE
      WHEN p_payload ? 'current_step' THEN p_payload->>'current_step'
      ELSE current_step
    END,
    identity_verification_level = CASE
      WHEN p_payload ? 'identity_verification_level' THEN p_payload->>'identity_verification_level'
      ELSE identity_verification_level
    END,
    is_returning_customer = CASE
      WHEN p_payload ? 'is_returning_customer' THEN (p_payload->>'is_returning_customer')::BOOLEAN
      ELSE is_returning_customer
    END,
    greeting_answered_at = CASE
      WHEN p_payload ? 'greeting_answered_at' THEN (p_payload->>'greeting_answered_at')::TIMESTAMPTZ
      ELSE greeting_answered_at
    END,
    entered_first_name = CASE
      WHEN p_payload ? 'entered_first_name' THEN p_payload->>'entered_first_name'
      ELSE entered_first_name
    END,
    entered_last_name = CASE
      WHEN p_payload ? 'entered_last_name' THEN p_payload->>'entered_last_name'
      ELSE entered_last_name
    END,
    otp_sent_at = CASE
      WHEN p_payload ? 'otp_sent_at' THEN (p_payload->>'otp_sent_at')::TIMESTAMPTZ
      ELSE otp_sent_at
    END,
    otp_attempts = CASE
      WHEN p_payload ? 'otp_attempts' THEN (p_payload->>'otp_attempts')::INTEGER
      ELSE otp_attempts
    END,
    otp_verified_at = CASE
      WHEN p_payload ? 'otp_verified_at' THEN (p_payload->>'otp_verified_at')::TIMESTAMPTZ
      ELSE otp_verified_at
    END,
    verified_first_name = CASE
      WHEN p_payload ? 'verified_first_name' THEN p_payload->>'verified_first_name'
      ELSE verified_first_name
    END,
    verified_last_name = CASE
      WHEN p_payload ? 'verified_last_name' THEN p_payload->>'verified_last_name'
      ELSE verified_last_name
    END,
    edited_phones = CASE
      WHEN NOT (p_payload ? 'edited_phones') THEN edited_phones
      WHEN pg_catalog.jsonb_typeof(p_payload->'edited_phones') = 'null' THEN NULL
      ELSE p_payload->'edited_phones'
    END,
    edited_emails = CASE
      WHEN NOT (p_payload ? 'edited_emails') THEN edited_emails
      WHEN pg_catalog.jsonb_typeof(p_payload->'edited_emails') = 'null' THEN NULL
      ELSE p_payload->'edited_emails'
    END,
    edited_address = CASE
      WHEN NOT (p_payload ? 'edited_address') THEN edited_address
      WHEN pg_catalog.jsonb_typeof(p_payload->'edited_address') = 'null' THEN NULL
      ELSE p_payload->'edited_address'
    END,
    primary_email_for_description = CASE
      WHEN p_payload ? 'primary_email_for_description' THEN p_payload->>'primary_email_for_description'
      ELSE primary_email_for_description
    END,
    new_vehicle_info = CASE
      WHEN NOT (p_payload ? 'new_vehicle_info') THEN new_vehicle_info
      WHEN pg_catalog.jsonb_typeof(p_payload->'new_vehicle_info') = 'null' THEN NULL
      ELSE p_payload->'new_vehicle_info'
    END,
    selected_simple_services = CASE
      WHEN NOT (p_payload ? 'selected_simple_services') THEN selected_simple_services
      WHEN pg_catalog.jsonb_typeof(p_payload->'selected_simple_services') = 'null' THEN NULL
      ELSE ARRAY(
        SELECT pg_catalog.jsonb_array_elements_text(
          p_payload->'selected_simple_services'
        )
      )
    END,
    explanation_required_items = CASE
      WHEN NOT (p_payload ? 'explanation_required_items') THEN explanation_required_items
      WHEN pg_catalog.jsonb_typeof(p_payload->'explanation_required_items') = 'null' THEN NULL
      ELSE p_payload->'explanation_required_items'
    END,
    diagnostic_processing_complete = CASE
      WHEN p_payload ? 'diagnostic_processing_complete' THEN (p_payload->>'diagnostic_processing_complete')::BOOLEAN
      ELSE diagnostic_processing_complete
    END,
    clarification_questions_pending = CASE
      WHEN NOT (p_payload ? 'clarification_questions_pending') THEN clarification_questions_pending
      WHEN pg_catalog.jsonb_typeof(p_payload->'clarification_questions_pending') = 'null' THEN NULL
      ELSE p_payload->'clarification_questions_pending'
    END,
    clarification_questions_answered = CASE
      WHEN NOT (p_payload ? 'clarification_questions_answered') THEN clarification_questions_answered
      WHEN pg_catalog.jsonb_typeof(p_payload->'clarification_questions_answered') = 'null' THEN NULL
      ELSE p_payload->'clarification_questions_answered'
    END,
    recommended_testing_services = CASE
      WHEN NOT (p_payload ? 'recommended_testing_services') THEN recommended_testing_services
      WHEN pg_catalog.jsonb_typeof(p_payload->'recommended_testing_services') = 'null' THEN NULL
      ELSE p_payload->'recommended_testing_services'
    END,
    -- ─── ACT-OR-ASK STAGE 1 (AO2d, 2026-07-03) — new branch ────────────
    -- concern_clarify_candidates: JSONB array of per-concern clarify
    -- entries (2-3 ranked Stage-1 candidates + precomputed per-candidate
    -- Stage-2/3 payloads). Written by run_diagnostics_v2; cleared by the
    -- clarify resolution action. JSONB pattern same as edited_phones/
    -- clarification_questions_pending: explicit JSONB null clears to SQL
    -- NULL.
    concern_clarify_candidates = CASE
      WHEN NOT (p_payload ? 'concern_clarify_candidates') THEN concern_clarify_candidates
      WHEN pg_catalog.jsonb_typeof(p_payload->'concern_clarify_candidates') = 'null' THEN NULL
      ELSE p_payload->'concern_clarify_candidates'
    END,
    -- ────────────────────────────────────────────────────────────────────
    approved_testing_services = CASE
      WHEN NOT (p_payload ? 'approved_testing_services') THEN approved_testing_services
      WHEN pg_catalog.jsonb_typeof(p_payload->'approved_testing_services') = 'null' THEN NULL
      ELSE ARRAY(
        SELECT pg_catalog.jsonb_array_elements_text(
          p_payload->'approved_testing_services'
        )
      )
    END,
    declined_testing_services = CASE
      WHEN NOT (p_payload ? 'declined_testing_services') THEN declined_testing_services
      WHEN pg_catalog.jsonb_typeof(p_payload->'declined_testing_services') = 'null' THEN NULL
      ELSE ARRAY(
        SELECT pg_catalog.jsonb_array_elements_text(
          p_payload->'declined_testing_services'
        )
      )
    END,
    additional_routine_services_round2 = CASE
      WHEN NOT (p_payload ? 'additional_routine_services_round2') THEN additional_routine_services_round2
      WHEN pg_catalog.jsonb_typeof(p_payload->'additional_routine_services_round2') = 'null' THEN NULL
      ELSE ARRAY(
        SELECT pg_catalog.jsonb_array_elements_text(
          p_payload->'additional_routine_services_round2'
        )
      )
    END,
    appointment_type = CASE
      WHEN p_payload ? 'appointment_type' THEN p_payload->>'appointment_type'
      ELSE appointment_type
    END,
    appointment_date = CASE
      WHEN p_payload ? 'appointment_date' THEN (p_payload->>'appointment_date')::DATE
      ELSE appointment_date
    END,
    appointment_time = CASE
      WHEN p_payload ? 'appointment_time' THEN (p_payload->>'appointment_time')::TIME WITHOUT TIME ZONE
      ELSE appointment_time
    END,
    hold_token = CASE
      WHEN p_payload ? 'hold_token' THEN (p_payload->>'hold_token')::UUID
      ELSE hold_token
    END,
    appointment_confirmed_at = CASE
      WHEN p_payload ? 'appointment_confirmed_at' THEN (p_payload->>'appointment_confirmed_at')::TIMESTAMPTZ
      ELSE appointment_confirmed_at
    END,
    appointment_verification_status = CASE
      WHEN p_payload ? 'appointment_verification_status' THEN p_payload->>'appointment_verification_status'
      ELSE appointment_verification_status
    END,
    appointment_verification_diff = CASE
      WHEN NOT (p_payload ? 'appointment_verification_diff') THEN appointment_verification_diff
      WHEN pg_catalog.jsonb_typeof(p_payload->'appointment_verification_diff') = 'null' THEN NULL
      ELSE p_payload->'appointment_verification_diff'
    END,
    customer_notes_text = CASE
      WHEN p_payload ? 'customer_notes_text' THEN p_payload->>'customer_notes_text'
      ELSE customer_notes_text
    END,
    customer_notes_approved = CASE
      WHEN p_payload ? 'customer_notes_approved' THEN (p_payload->>'customer_notes_approved')::BOOLEAN
      ELSE customer_notes_approved
    END,
    customer_notes_edit_attempts = CASE
      WHEN p_payload ? 'customer_notes_edit_attempts' THEN (p_payload->>'customer_notes_edit_attempts')::INTEGER
      ELSE customer_notes_edit_attempts
    END,
    customer_question = CASE
      WHEN p_payload ? 'customer_question' THEN p_payload->>'customer_question'
      ELSE customer_question
    END,
    customer_question_forwarded = CASE
      WHEN p_payload ? 'customer_question_forwarded' THEN (p_payload->>'customer_question_forwarded')::BOOLEAN
      ELSE customer_question_forwarded
    END,
    summary_edit_attempts = CASE
      WHEN p_payload ? 'summary_edit_attempts' THEN (p_payload->>'summary_edit_attempts')::INTEGER
      ELSE summary_edit_attempts
    END,
    escalated_at = CASE
      WHEN p_payload ? 'escalated_at' THEN (p_payload->>'escalated_at')::TIMESTAMPTZ
      ELSE escalated_at
    END,
    escalation_reason = CASE
      WHEN p_payload ? 'escalation_reason' THEN p_payload->>'escalation_reason'
      ELSE escalation_reason
    END,
    abandoned_at = CASE
      WHEN p_payload ? 'abandoned_at' THEN (p_payload->>'abandoned_at')::TIMESTAMPTZ
      ELSE abandoned_at
    END,
    completed_at = CASE
      WHEN p_payload ? 'completed_at' THEN (p_payload->>'completed_at')::TIMESTAMPTZ
      ELSE completed_at
    END,
    pending_candidates = CASE
      WHEN NOT (p_payload ? 'pending_candidates') THEN pending_candidates
      WHEN pg_catalog.jsonb_typeof(p_payload->'pending_candidates') = 'null' THEN NULL
      ELSE p_payload->'pending_candidates'
    END,
    last_active_at = pg_catalog.now()
  WHERE id = p_chat_id
  RETURNING * INTO v_session_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found: no customer_chat_sessions row with id %', p_chat_id
      USING ERRCODE = 'P0002';
  END IF;

  v_shop_id := v_session_row.shop_id;
  v_row := pg_catalog.row_to_json(v_session_row)::JSONB;

  v_user_text := p_user_bubble_text;
  IF v_user_text IS NOT NULL AND pg_catalog.length(v_user_text) > 0 THEN
    INSERT INTO public.customer_chat_messages (
      id,
      session_id,
      shop_id,
      role,
      parts
    ) VALUES (
      extensions.gen_random_uuid(),
      p_chat_id,
      v_shop_id,
      'user',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type', 'text', 'text', v_user_text)
      )
    );
    v_user_inserted := TRUE;
  END IF;

  v_assistant_text := p_assistant_bubble_text;
  IF v_assistant_text IS NOT NULL AND pg_catalog.length(v_assistant_text) > 0 THEN
    INSERT INTO public.customer_chat_messages (
      id,
      session_id,
      shop_id,
      role,
      parts
    ) VALUES (
      extensions.gen_random_uuid(),
      p_chat_id,
      v_shop_id,
      'assistant',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('type', 'text', 'text', v_assistant_text)
      )
    );
    v_assistant_inserted := TRUE;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'row', v_row,
    'user_bubble_inserted', v_user_inserted,
    'assistant_bubble_inserted', v_assistant_inserted
  );
END;
$$;

-- (REVOKE/GRANT already in place from migration 20260524220000 — CREATE
-- OR REPLACE preserves grants.)

COMMENT ON FUNCTION public.apply_wizard_transition(UUID, JSONB, TEXT, TEXT) IS
'Atomic 3-write wizard step advance (UPDATE customer_chat_sessions + optional user-bubble INSERT + optional assistant-bubble INSERT) wrapped in a single Postgres transaction. SECURITY INVOKER (caller is service_role via createSupabaseAdminClient — bypasses RLS naturally; INVOKER preserves caller identity for audit + avoids DEFINER privilege-escalation surface; keyword now EXPLICIT in the definition per the 2026-05-25 hardening). Plan 04 Phase 1A. Phase 4 (20260525000000) added appointment_verification_status + appointment_verification_diff branches. Act-or-ask AO2d (20260703080000) added the concern_clarify_candidates JSONB branch.';

COMMIT;
