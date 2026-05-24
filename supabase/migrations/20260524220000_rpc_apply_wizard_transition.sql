-- =====================================================================
-- apply_wizard_transition — atomic 3-write RPC for wizard step advance
-- Created 2026-05-24 — Plan 04 Phase 1A (closes I-COR-1)
-- =====================================================================
-- Replaces the current 3-step non-atomic flow in
-- scheduler-app/src/lib/scheduler/wizard/transition.ts:
--
--   1. UPDATE customer_chat_sessions  (row write)
--   2. INSERT customer_chat_messages  (user bubble — best-effort, never
--      throws back into transition.ts)
--   3. INSERT customer_chat_messages  (assistant bubble — same)
--
-- Failure modes under the old flow:
--   - Row UPDATE succeeds, user-bubble INSERT fails: transcript is missing
--     the user's submit (because appendBubble swallows errors); next page
--     render reads a row that says "advanced past greeting" but transcript
--     has no record of the customer typing anything.
--   - Row UPDATE succeeds, assistant-bubble INSERT fails: customer sees the
--     new step's card BUT no Jeff-voice bubble preceding it.
--   - Either INSERT failure was caught only by Sentry warning — not
--     surfaced to the customer, never retried, no recovery path.
--
-- This RPC commits all three writes in a single Postgres transaction.
-- PostgREST wraps the function call in a transaction, so RAISE EXCEPTION
-- (or any unhandled error) rolls everything back atomically.
--
-- ─── WHY THIS REWRITE (vs. an earlier COALESCE-based draft) ─────────────
--
-- An earlier version of this migration wrapped every scalar column in
-- `COALESCE((p_payload->>'col')::TYPE, col)`. That pattern preserves the
-- existing column value any time `p_payload->>'col'` returns SQL NULL —
-- which happens BOTH when the key is absent from the payload AND when the
-- key is present with an explicit JSONB null value. So `.update({col: null})`
-- (the supabase-js way of clearing a column to SQL NULL) became a silent
-- no-op when routed through the RPC.
--
-- Six production callers depend on the "clear column to NULL by passing
-- explicit null" semantic the previous supabase-js `.update(payload)` call
-- had:
--
--   1. submit-start-over.ts          — wipes ~30 columns (catastrophic)
--   2. submit-partial-verification-choice.ts — phone/OTP reset (5 nulls)
--   3. submit-no-match-choice.ts     — phone/OTP reset (5 nulls)
--   4. submit-customer-notes.ts      — notes reset (2 nulls across 2 calls)
--   5. submit-multi-account-choice.ts — pending_candidates clear (1 null)
--   6. dismiss-escalation.ts          — escalation clear (3 nulls)
--
-- The CASE/key-presence pattern below restores the original semantic:
-- absent keys preserve the column; present-and-null keys clear it.
--
-- ─── Reconciliations vs. Plan 04 spec (written 2026-05-22) ──────────────
--
-- 1. The plan spec called for `WHERE id = p_chat_id AND status = 'active'`.
--    DROPPED. The 2026-05-23 date-picker bug fix made `status: 'active'`
--    part of every transition payload precisely so transitions can RESCUE
--    racing-timed_out sessions (mark-abandoned cron flips status before
--    the customer's next click reaches us). Keeping the `status = 'active'`
--    guard would silently no-op every rescue. WHERE is now id-only; if the
--    session row doesn't exist we RAISE EXCEPTION 'session_not_found' with
--    SQLSTATE P0002 so transition.ts can map to ok:false.
--
-- 2. The plan spec wrote `customer_chat_messages.content`. The real column
--    is `parts: jsonb`. RPC builds the canonical parts array internally
--    (`[{"type":"text","text":"<bubble>"}]`) so callers only pass text.
--
-- 3. The plan spec passed `last_active_at` in p_payload. RPC ignores any
--    such key — server canonicalizes via pg_catalog.now() to remove
--    client/server clock-drift risk. The table has NO updated_at column;
--    we do not add one.
--
-- 4. Bubble params are `p_user_bubble_text TEXT` and
--    `p_assistant_bubble_text TEXT` — NULL or empty string skips the
--    insert (matches append-bubble.ts's `if (!text || text.length === 0)`
--    short-circuit).
--
-- 5. SECURITY INVOKER (NOT DEFINER). The wizard calls via
--    createSupabaseAdminClient() which uses the service_role JWT — that
--    role bypasses RLS naturally. SECURITY INVOKER preserves the caller's
--    identity for audit/observability and avoids the privilege-escalation
--    risk of DEFINER. Per Plan 02 hardening default, all new RPCs use
--    `SET search_path = ''` and fully-qualify every reference
--    (public.customer_chat_sessions, pg_catalog.now(),
--    extensions.gen_random_uuid()).
--
-- 6. Permission grants: REVOKE from PUBLIC/anon/authenticated; GRANT only
--    to service_role.
--
-- ─── Key-present vs key-absent semantics (matches supabase-js .update) ──
--
-- For each column we use:
--   <col> = CASE WHEN p_payload ? '<col>' THEN <typed_extract> ELSE <col> END
--
-- (JSONB and ARRAY columns add an inner jsonb_typeof check to map explicit
-- JSONB null to SQL NULL — see column blocks below.)
--
-- This preserves the EXACT semantic the previous supabase-js
-- `.update(payload)` call had:
--
--   - Key ABSENT from payload    → preserve existing column value
--   - Key present, value string  → cast + set
--   - Key present, value JSONB null (explicit clear) → set column to SQL NULL
--   - Key present, value array   → convert via jsonb_array_elements_text
--
-- An earlier draft used `COALESCE(..., col)` which silently preserved
-- existing values when the payload key was JSONB null. That broke 6
-- production callers that use `updates: { col: null, ... }` to CLEAR
-- columns: submit-start-over (~30 nulls), submit-partial-verification-choice,
-- submit-no-match-choice, submit-customer-notes, submit-multi-account-choice,
-- dismiss-escalation. The CASE pattern fixes them all.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_wizard_transition(
  p_chat_id                UUID,
  p_payload                JSONB,
  p_user_bubble_text       TEXT DEFAULT NULL,
  p_assistant_bubble_text  TEXT DEFAULT NULL
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
  -- p_payload must be a JSONB object (or NULL). Anything else is a bug.
  IF p_payload IS NOT NULL AND pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'apply_wizard_transition: p_payload must be a JSONB object, got %',
      pg_catalog.jsonb_typeof(p_payload)
      USING ERRCODE = '22023'; -- invalid_parameter_value
  END IF;

  -- ────────────────────────────────────────────────────────────────────
  -- WRITE 1 / 3 — partial UPDATE on customer_chat_sessions
  -- ────────────────────────────────────────────────────────────────────
  -- Every column eligible for caller-driven update is wrapped in a
  -- CASE WHEN p_payload ? '<col>' so absent keys are no-ops and explicit
  -- null values clear the column to SQL NULL. last_active_at is server-
  -- canonical via pg_catalog.now(). Server-managed columns (id, shop_id,
  -- started_at) are NOT in this list.
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
    -- JSONB columns: use -> (not ->>) to preserve the JSONB subtree. The
    -- inner jsonb_typeof('null') check maps explicit JSONB null to SQL NULL;
    -- without it, assigning the JSONB scalar `null` would store JSONB null
    -- in the column rather than clearing it.
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
    -- ARRAY columns: build via jsonb_array_elements_text inside the CASE.
    -- The inner jsonb_typeof('null') branch lets callers clear the column
    -- to SQL NULL by passing explicit JSONB null.
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
    -- Server-canonical timestamp. Ignores any p_payload->>'last_active_at'.
    last_active_at = pg_catalog.now()
  WHERE id = p_chat_id
  RETURNING * INTO v_session_row;

  -- No row matched → either chat_id is bogus or the row was deleted between
  -- transition.ts read and our write. Either way, surface a stable SQLSTATE
  -- so transition.ts can map to a typed ok:false return.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found: no customer_chat_sessions row with id %', p_chat_id
      USING ERRCODE = 'P0002'; -- no_data_found
  END IF;

  v_shop_id := v_session_row.shop_id;
  v_row := pg_catalog.row_to_json(v_session_row)::JSONB;

  -- ────────────────────────────────────────────────────────────────────
  -- WRITE 2 / 3 — optional user-bubble INSERT into customer_chat_messages
  -- ────────────────────────────────────────────────────────────────────
  -- Skip if param is NULL or empty string (matches append-bubble.ts gate).
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

  -- ────────────────────────────────────────────────────────────────────
  -- WRITE 3 / 3 — optional assistant-bubble INSERT
  -- ────────────────────────────────────────────────────────────────────
  -- User bubble lands BEFORE assistant bubble in transcript order (same as
  -- the current transition.ts call sequence).
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

  -- All three writes have succeeded (or been deliberately skipped). The
  -- function returns the updated row + a small bookkeeping object so the
  -- caller can confirm what landed without a follow-up SELECT.
  RETURN pg_catalog.jsonb_build_object(
    'row', v_row,
    'user_bubble_inserted', v_user_inserted,
    'assistant_bubble_inserted', v_assistant_inserted
  );
END;
$$;

-- ─── Permission lockdown ──────────────────────────────────────────────
-- Wizard calls via service_role. anon/authenticated should never see this
-- function. Pattern matches 20260522191000_revoke_anon_security_definer_phase2.
REVOKE ALL ON FUNCTION public.apply_wizard_transition(UUID, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_wizard_transition(UUID, JSONB, TEXT, TEXT)
  TO service_role;

-- ─── Function comment for catalog introspection ───────────────────────
COMMENT ON FUNCTION public.apply_wizard_transition(UUID, JSONB, TEXT, TEXT) IS
  'Plan 04 Phase 1A (closes I-COR-1). Atomically updates customer_chat_sessions '
  'and (optionally) inserts user + assistant bubbles into customer_chat_messages '
  'in a single Postgres transaction. service_role-only. SECURITY INVOKER. '
  'See migration 20260524220000 header comment for design rationale.';

COMMIT;
