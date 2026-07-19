-- =====================================================================
-- concern-triage — establish a category when the classifier can't
-- Created 2026-07-19 — feature `concern-triage`
-- Plan: docs/scheduler/concern-triage-and-unsure-path-plan.md
-- =====================================================================
-- When Stage 1 returns ZERO category candidates for a triage-eligible reason
-- (`too_vague` / `no_catalog_fit`) on the concern's first pass, the wizard no
-- longer dead-ends to an advisor with no questions. Instead it shows a new
-- `concern_triage` chip card ("What kind of trouble is it?") — 12 broad
-- categories in customer voice + a "Something else / not sure" escape. Tapping
-- a chip drives a CONSTRAINED re-diagnosis: the chip's audited
-- `allowed_service_keys` subset filters the Stage-1 catalog, re-entering the
-- SAME downstream graph (1→direct, 2-3→clarify, 0→advisor). Worst case: one
-- triage tap, then the normal flow. (Full contract: INV-1…INV-19 in the plan.)
--
-- This migration lands the DB half of build step 2 (backend, no UI):
--   1. customer_chat_sessions.concern_triage_state JSONB   (INV-12)
--   2. apply_wizard_transition RECREATE + a concern_triage_state arm (INV-1)
--   3. concern_triage_chips table (shop-scoped, deny-all RLS)   (INV-9)
--   4. the 12 literal, hand-audited chips for shop 7476 (§10.2)  (INV-9/18)
--   5. a scheduler_card_text default row for the new card
--
-- INV-1 (RPC allowlist): apply_wizard_transition is a column ALLOWLIST — a
-- payload key with no CASE arm is SILENTLY IGNORED. Without the new arm, every
-- triage write no-ops and the card never renders. The RPC is recreated FROM ITS
-- LATEST FULL DEFINITION (20260703080000_scheduler_concern_clarify_column.sql
-- lines 69-416 — the most-recent CREATE OR REPLACE; NOT the older 20260525000000)
-- adding ONE arm with the standard explicit-JSONB-null-clears pattern. Every
-- existing arm + the `current_step` handling is preserved verbatim. SECURITY
-- INVOKER + SET search_path='' are asserted explicitly (the 2026-05-25 hardening).
-- The RPC reads NO other table — chip resolution happens in the
-- submit-concern-triage server action via the service-role admin client, never
-- here (INV-1/INV-9 clarification, plan §10.4) — so the deny-all chips RLS is fine.
--
-- INV-9 conventions (scheduler family, not the generic UUID-FK anchor):
-- `shop_id INTEGER NOT NULL CHECK (shop_id > 0)` (Tekmetric integer shop id),
-- UUID PK gen_random_uuid(), TIMESTAMPTZ created_at/updated_at, TEXT columns,
-- `sort` (not display_order), UNIQUE (shop_id, chip_key), RLS deny-all,
-- idempotent seed with LITERAL audited values (not SELECT-derived from tags).
-- =====================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────
-- 1 / 5 — new column on customer_chat_sessions (INV-12)
-- Sibling of concern_clarify_candidates: nullable JSONB, no default
-- (a constant-default ADD COLUMN is metadata-only in PG11+ either way — safe
-- on the live sessions table). Parser accepts NULL AND [].
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE public.customer_chat_sessions
  ADD COLUMN IF NOT EXISTS concern_triage_state JSONB;

COMMENT ON COLUMN public.customer_chat_sessions.concern_triage_state IS
  'concern-triage (2026-07-19): one entry per triaged concern, persisted by run_diagnostics when Stage 1 returned 0 candidates with a triage-eligible no_match_reason (too_vague|no_catalog_fit) on triage_round 0. Array (or [] / NULL) of {concern_id (uuid — INV-13 stable identity, NOT array index / service_key), concern_index (int — display order only), service_key (source picker chip), concern_text (echoed to the customer), chips:[{chip_key, display_label}] (rendered snapshot so card + tap agree even if the seed is later edited), allowed_by_chip:{<chip_key>:[service_key…]} (SERVER-resolved audited subset snapshot — INV-14), triage_round (0|1), created_version (chip-seed version)}. The concern_triage chip card renders from this; the tap derives its category_constraint from the persisted allowed_by_chip snapshot (the clarify idiom — not a live table read that can drift). Parser accepts NULL and []; consumed/cleared/pruned on tap, empty-items branch, fresh picker submit, and start-over (INV-2). Sibling of concern_clarify_candidates.';

-- ────────────────────────────────────────────────────────────────────
-- 2 / 5 — apply_wizard_transition gains the concern_triage_state CASE arm
-- (INV-1). Standard JSONB pattern: explicit JSONB null clears to SQL NULL.
-- Full body reproduced via CREATE OR REPLACE from the 20260703080000
-- definition (lines 69-416); ALL other columns' behavior preserved exactly.
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
    -- ─── CONCERN-TRIAGE (2026-07-19) — new branch (INV-1) ──────────────
    -- concern_triage_state: JSONB array of per-concern triage entries (the
    -- rendered chip snapshot + server-resolved allowed_by_chip subset —
    -- INV-12). Written by run_diagnostics on a 0-candidate triage-eligible
    -- concern; consumed/cleared by submit-concern-triage + the INV-2 resets.
    -- Same JSONB idiom as concern_clarify_candidates: explicit JSONB null
    -- clears to SQL NULL; a payload with no `concern_triage_state` key leaves
    -- the column untouched.
    concern_triage_state = CASE
      WHEN NOT (p_payload ? 'concern_triage_state') THEN concern_triage_state
      WHEN pg_catalog.jsonb_typeof(p_payload->'concern_triage_state') = 'null' THEN NULL
      ELSE p_payload->'concern_triage_state'
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
'Atomic 3-write wizard step advance (UPDATE customer_chat_sessions + optional user-bubble INSERT + optional assistant-bubble INSERT) wrapped in a single Postgres transaction. SECURITY INVOKER (caller is service_role via createSupabaseAdminClient — bypasses RLS naturally; INVOKER preserves caller identity for audit + avoids DEFINER privilege-escalation surface; keyword EXPLICIT per the 2026-05-25 hardening). Reads no other table (chip resolution lives in the submit-concern-triage server action, not here). Plan 04 Phase 1A. Phase 4 (20260525000000) added appointment_verification_status + appointment_verification_diff branches. Act-or-ask AO2d (20260703080000) added concern_clarify_candidates. concern-triage (20260719040000) added the concern_triage_state JSONB branch (INV-1 allowlist arm — a payload key with no CASE arm is silently ignored).';

-- ────────────────────────────────────────────────────────────────────
-- 3 / 5 — concern_triage_chips (shop-scoped; INV-9)
-- The broad-category chips the concern_triage card renders. Seeded with
-- LITERAL hand-audited allowed_service_keys (§10.2) — the tag-partition
-- audit's OUTPUT, NOT a SELECT from testing_services.concern_categories[]
-- (the tags are not a complete routing partition). INV-18 validates each
-- allowed_service_keys element resolves to an ACTIVE testing_services row for
-- the shop at load; unknown keys are dropped + warned, never crashed on.
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE public.concern_triage_chips (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              INTEGER NOT NULL CHECK (shop_id > 0),
  -- chip_key: stable machine key ('noise', 'warning_light', …). The decorative
  -- icon is keyed off this in-code with an unknown-key → no-icon fallback.
  chip_key             TEXT NOT NULL,
  -- display_label: customer-voice label the card renders (from the DB row, so
  -- no drift between diagnosis snapshot and render).
  display_label        TEXT NOT NULL,
  -- maps_to_categories: the concern_categories[] this chip fans out to
  -- (observability / provenance; steering+pulling are merged into one chip).
  maps_to_categories   TEXT[] NOT NULL DEFAULT '{}',
  -- allowed_service_keys: the audited Stage-1 catalog subset a tap constrains
  -- re-diagnosis to (the **bold** confusable-matrix additions are baked in).
  allowed_service_keys TEXT[] NOT NULL DEFAULT '{}',
  sort                 INTEGER NOT NULL DEFAULT 0,
  active               BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, chip_key)
);

CREATE INDEX concern_triage_chips_shop_active
  ON public.concern_triage_chips (shop_id, sort)
  WHERE active;

COMMENT ON TABLE public.concern_triage_chips IS
  'Broad-category chips for the concern_triage wizard step (feature concern-triage, docs/scheduler/concern-triage-and-unsure-path-plan.md). Shop-scoped; seeded with LITERAL hand-audited allowed_service_keys (plan §10.2 — the tag-partition audit''s output, NOT SELECT-derived from concern_categories[] tags). On a 0-candidate triage-eligible concern the card renders the ACTIVE chips; a tap constrains re-diagnosis to that chip''s allowed_service_keys subset. INV-18: elements are validated to resolve to ACTIVE testing_services rows at load (unknown dropped + warned); a shop with no/empty/all-invalid chips → triage does NOT fire (advisor as today). Deny-all RLS; reached only by the service-role admin client. The not_sure escape is an in-code affordance, NOT a seeded row.';

-- updated_at maintenance — reuse the shared scheduler-family touch fn
-- (public.scheduler_appt_types_touch, 20260702031500; also used by
-- scheduler_message_templates). SECURITY DEFINER, SET search_path=''.
CREATE TRIGGER concern_triage_chips_touch_updated_at
  BEFORE UPDATE ON public.concern_triage_chips
  FOR EACH ROW EXECUTE FUNCTION public.scheduler_appt_types_touch();

-- ─── grants (deny-all; service_role reaches via RLS bypass — INV-9) ────
ALTER TABLE public.concern_triage_chips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.concern_triage_chips FROM public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 4 / 5 — seed the 12 literal audited chips for shop 7476 (§10.2)
-- Verbatim from the plan appendix (12 category chips; the not_sure escape is
-- an in-code affordance, not seeded). Idempotent: ON CONFLICT re-asserts the
-- audited seed (structural/reference data, admin-editable later via a follow-up
-- /schedulerconfig editor — v1 is seed-only).
-- ────────────────────────────────────────────────────────────────────

INSERT INTO public.concern_triage_chips
  (shop_id, chip_key, display_label, maps_to_categories, allowed_service_keys, sort)
VALUES
  (7476, 'noise', 'A noise it shouldn''t be making',
   ARRAY['noise'],
   ARRAY['brake_inspection','brake_inspection_warning_light','exhaust_system_testing','suspension_steering_check'],
   1),
  (7476, 'shaking', 'Shaking or vibration',
   ARRAY['vibration'],
   ARRAY['suspension_steering_check','brake_inspection'],
   2),
  (7476, 'warning_light', 'A warning light on the dash',
   ARRAY['warning_light'],
   ARRAY['warning_light_general','check_engine_light_testing','abs_traction_stability_testing','brake_inspection_warning_light','airbag_srs_testing','tpms_testing','oil_pressure_light_testing','power_steering_eps_testing','battery_test','charging_starting_testing'],
   3),
  (7476, 'leak', 'Leaking or a puddle under the car',
   ARRAY['leak'],
   ARRAY['coolant_leak_testing','coolant_leak_testing_euro','oil_leak_testing','oil_pressure_light_testing','ac_leak_testing'],
   4),
  (7476, 'smell', 'A strange smell',
   ARRAY['smell'],
   ARRAY['coolant_leak_testing','oil_leak_testing','exhaust_system_testing','ac_performance_check'],
   5),
  (7476, 'smoke', 'Smoke or steam',
   ARRAY['smoke'],
   ARRAY['coolant_leak_testing','oil_leak_testing','check_engine_light_testing','exhaust_system_testing'],
   6),
  (7476, 'brakes', 'The brakes',
   ARRAY['brakes'],
   ARRAY['brake_inspection','brake_inspection_warning_light','abs_traction_stability_testing'],
   7),
  (7476, 'steering', 'Steering, pulling, or drifting',
   ARRAY['steering','pulling'],
   ARRAY['suspension_steering_check','power_steering_eps_testing'],
   8),
  (7476, 'hvac', 'Heat or A/C',
   ARRAY['hvac'],
   ARRAY['ac_performance_check','ac_leak_testing'],
   9),
  (7476, 'electrical', 'Battery, electrical, or something won''t turn on',
   ARRAY['electrical'],
   ARRAY['charging_starting_testing','no_start_testing','battery_test','electrical_testing_general','window_inop_testing','windshield_inop_testing'],
   10),
  (7476, 'performance', 'How it runs or drives (power, stalling, shifting)',
   ARRAY['performance'],
   ARRAY['check_engine_light_testing','no_start_testing','transmission_testing','awd_4x4_testing','charging_starting_testing'],
   11),
  (7476, 'tires', 'Tires or wheels',
   ARRAY['tires'],
   ARRAY['tire_repair','tpms_testing','suspension_steering_check'],
   12)
ON CONFLICT (shop_id, chip_key) DO UPDATE SET
  display_label        = EXCLUDED.display_label,
  maps_to_categories   = EXCLUDED.maps_to_categories,
  allowed_service_keys = EXCLUDED.allowed_service_keys,
  sort                 = EXCLUDED.sort,
  active               = EXCLUDED.active;

-- ────────────────────────────────────────────────────────────────────
-- 5 / 5 — scheduler_card_text default row for the new concern_triage card
-- (mirrors how concern_clarify is seeded in 20260715170000). body ==
-- default_body at seed; the CARD_TEXT_DEFAULTS entry in scheduler-app
-- card-text.ts must stay byte-identical (INV-9 addendum Vitest). Idempotent:
-- ON CONFLICT DO NOTHING so a re-run never clobbers an admin's edited body.
-- ────────────────────────────────────────────────────────────────────

INSERT INTO public.scheduler_card_text
  (shop_id, card_key, slot_key, label, body, default_body, allowed_merge_fields, sort)
VALUES
  (7476, 'concern_triage', 'eyebrow', 'Eyebrow',
   'One more thing', 'One more thing', '{}', 10),
  (7476, 'concern_triage', 'title', 'Title',
   'What kind of trouble is it?', 'What kind of trouble is it?', '{}', 20),
  (7476, 'concern_triage', 'description', 'Description',
   'I couldn''t quite match that to one of our tests — pick the closest and I''ll narrow it down.',
   'I couldn''t quite match that to one of our tests — pick the closest and I''ll narrow it down.',
   '{}', 30),
  (7476, 'concern_triage', 'footnote', 'Footnote',
   '', '', '{}', 40)
ON CONFLICT (shop_id, card_key, slot_key) DO NOTHING;

COMMIT;
