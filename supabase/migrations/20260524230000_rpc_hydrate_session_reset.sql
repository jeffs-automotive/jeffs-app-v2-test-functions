-- =====================================================================
-- hydrate_session_reset — atomic 4-write RPC for stale-session reset
-- Created 2026-05-24 — Plan 04 Phase 1B (closes I-COR-2)
-- =====================================================================
-- Replaces the current 4-step non-atomic flow in
-- scheduler-app/src/lib/scheduler/hydrate-session.ts:
--
--   1. UPDATE appointment_holds (release by hold_token pointer)
--      — best-effort, only if row.hold_token was non-null
--   2. UPDATE appointment_holds (release by session_id)
--      — defensive, always runs
--   3. UPDATE customer_chat_sessions (wipe 43 wizard columns + flip
--      status='active' + reset last_active_at)
--   4. DELETE FROM customer_chat_messages WHERE session_id
--
-- Failure modes under the old flow:
--   - W1 succeeds, W3 fails: prior hold released BUT session row still
--     carries stale wizard columns; next render uses the stale state.
--   - W3 succeeds, W4 fails: row wiped to greeting BUT bubble transcript
--     still shows the prior session's messages; customer sees stale
--     ghost bubbles above the fresh GreetingCard.
--   - Any partial-success path leaves the system in an inconsistent state
--     that a casual ops query can't detect (the row LOOKS reset).
--
-- This RPC commits all 4 writes in a single Postgres transaction.
-- PostgREST wraps the function call in a transaction, so any RAISE
-- EXCEPTION (or unhandled error) rolls everything back atomically.
--
-- ─── Reconciliations vs. Plan 04 spec (written 2026-05-22) ──────────────
--
-- 1. The spec used `WHERE hold_token = v_hold_token` on appointment_holds.
--    BUG: appointment_holds has no `hold_token` column. The schema is
--    (id UUID PK, session_id UUID NOT NULL, ...). The current inline
--    code at hydrate-session.ts:198 uses `.eq("id", row.hold_token)` —
--    treating customer_chat_sessions.hold_token as the appointment_holds.id
--    pointer (the column on customer_chat_sessions is misleadingly named
--    but is in fact a UUID FK to appointment_holds.id). This RPC uses the
--    correct `WHERE id = v_hold_token` per the live schema.
--
-- 2. The spec called the function `RETURN JSONB` with
--    `{messages_deleted, hold_token_released}`. Extended with
--    `holds_released_by_session_id` (separate count for the defensive
--    second UPDATE) so observability can surface when defensive cleanup
--    actually finds stragglers — a non-zero value here signals the
--    primary pointer was out of sync with reality and should be probed.
--
-- 3. The spec used inline `now()`. Wrapped as `pg_catalog.now()` per the
--    `SET search_path = ''` convention from Phase 1A — every function
--    call must be schema-qualified once search_path is empty.
--
-- 4. SECURITY INVOKER (NOT DEFINER). Same rationale as
--    apply_wizard_transition: caller is createSupabaseAdminClient (service
--    role JWT), which bypasses RLS naturally. INVOKER preserves caller
--    identity for audit + avoids privilege-escalation risk.
--
-- ─── RESET_COLUMNS divergence note (audit finding 2026-05-24) ───────────
--
-- The wipe column set MIRRORS hydrate-session.ts:64-111 (43 columns).
-- It does NOT match submit-start-over.ts:96-141 — that file's manual
-- "Start Over" payload omits `pending_candidates` and
-- `customer_self_identified`. Both writes effectively reset the wizard,
-- but the manual reset leaves these two columns un-wiped, while the
-- auto-stale reset (this RPC) does wipe them. This pre-existing
-- divergence is intentionally preserved here to keep Phase 1B's scope
-- narrow (refactor without behavior change). The alignment is tracked
-- as a new deferred-audit item; the long-term fix per Plan 06 is to
-- extract RESET_COLUMNS to a shared scheduler-app/src/lib/.../reset-
-- columns.ts module that both call sites import.
--
-- ─── No-row safety ─────────────────────────────────────────────────────
--
-- If `p_chat_id` doesn't exist in customer_chat_sessions, the SELECT
-- INTO returns NULL for v_hold_token, the UPDATE matches 0 rows, the
-- DELETE matches 0 rows. The function returns silently. The caller
-- (hydrate-session.ts) has already verified the row exists before
-- calling this RPC, so this defensive-silent path is for safety, not a
-- normal code flow.
--
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.hydrate_session_reset(
  p_chat_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_hold_token                UUID;
  v_messages_deleted          INTEGER := 0;
  v_holds_released_by_token   INTEGER := 0;
  v_holds_released_by_session INTEGER := 0;
BEGIN
  -- ────────────────────────────────────────────────────────────────────
  -- READ — capture the prior appointment_holds.id pointer (if any).
  -- ────────────────────────────────────────────────────────────────────
  -- customer_chat_sessions.hold_token is a UUID FK to appointment_holds.id
  -- despite the misleading column name. If the row doesn't exist or has no
  -- prior hold, v_hold_token stays NULL and W1 is a no-op.
  SELECT hold_token INTO v_hold_token
    FROM public.customer_chat_sessions
   WHERE id = p_chat_id;

  -- ────────────────────────────────────────────────────────────────────
  -- WRITE 1 / 4 — release the prior hold by pointer (idempotent).
  -- ────────────────────────────────────────────────────────────────────
  IF v_hold_token IS NOT NULL THEN
    UPDATE public.appointment_holds
       SET released_at = pg_catalog.now()
     WHERE id = v_hold_token AND released_at IS NULL;
    GET DIAGNOSTICS v_holds_released_by_token = ROW_COUNT;
  END IF;

  -- ────────────────────────────────────────────────────────────────────
  -- WRITE 2 / 4 — defensive: release ANY non-released holds for this
  -- session. The customer_chat_sessions.hold_token pointer is the
  -- canonical reference, but appointment_holds may carry additional
  -- rows for the same session (multiple consecutive holds during the
  -- wizard's date-picker flow). Belt-and-suspenders cleanup.
  -- ────────────────────────────────────────────────────────────────────
  UPDATE public.appointment_holds
     SET released_at = pg_catalog.now()
   WHERE session_id = p_chat_id AND released_at IS NULL;
  GET DIAGNOSTICS v_holds_released_by_session = ROW_COUNT;

  -- ────────────────────────────────────────────────────────────────────
  -- WRITE 3 / 4 — hardcoded wipe of all wizard-state columns.
  -- ────────────────────────────────────────────────────────────────────
  -- Mirror of RESET_COLUMNS in scheduler-app/src/lib/scheduler/
  -- hydrate-session.ts:64-111. Plus current_step (greeting fallback),
  -- status (back to active from timed_out/abandoned), and last_active_at
  -- (server-canonical pg_catalog.now()).
  --
  -- Columns NOT wiped (preserved on reset): id, shop_id, channel,
  -- started_at — identity / immutable per session.
  --
  -- Most columns reset to NULL. Exceptions:
  --   - otp_attempts (INTEGER)               → 0
  --   - diagnostic_processing_complete (BOOL)→ FALSE
  --   - customer_notes_edit_attempts (INT)   → 0
  --   - customer_question_forwarded (BOOL)   → FALSE
  --   - summary_edit_attempts (INT)          → 0
  -- These match the JS literal defaults in RESET_COLUMNS exactly.
  UPDATE public.customer_chat_sessions
     SET
       is_returning_customer              = NULL,
       greeting_answered_at               = NULL,
       entered_first_name                 = NULL,
       entered_last_name                  = NULL,
       phone_e164                         = NULL,
       otp_sent_at                        = NULL,
       otp_attempts                       = 0,
       otp_verified_at                    = NULL,
       identity_verification_level        = NULL,
       verified_first_name                = NULL,
       verified_last_name                 = NULL,
       edited_phones                      = NULL,
       edited_emails                      = NULL,
       edited_address                     = NULL,
       primary_email_for_description      = NULL,
       new_vehicle_info                   = NULL,
       customer_id                        = NULL,
       vehicle_id                         = NULL,
       appointment_id                     = NULL,
       pending_candidates                 = NULL,
       customer_self_identified           = NULL,
       selected_simple_services           = NULL,
       explanation_required_items         = NULL,
       diagnostic_processing_complete     = FALSE,
       clarification_questions_pending    = NULL,
       clarification_questions_answered   = NULL,
       recommended_testing_services       = NULL,
       approved_testing_services          = NULL,
       declined_testing_services          = NULL,
       additional_routine_services_round2 = NULL,
       appointment_type                   = NULL,
       appointment_date                   = NULL,
       appointment_time                   = NULL,
       hold_token                         = NULL,
       appointment_confirmed_at           = NULL,
       customer_notes_text                = NULL,
       customer_notes_approved            = NULL,
       customer_notes_edit_attempts       = 0,
       customer_question                  = NULL,
       customer_question_forwarded        = FALSE,
       summary_edit_attempts              = 0,
       escalated_at                       = NULL,
       escalation_reason                  = NULL,
       ended_at                           = NULL,
       completed_at                       = NULL,
       outcome                            = NULL,
       current_step                       = NULL,
       status                             = 'active',
       last_active_at                     = pg_catalog.now()
   WHERE id = p_chat_id;

  -- ────────────────────────────────────────────────────────────────────
  -- WRITE 4 / 4 — wipe the transcript so the next render starts from a
  -- clean GreetingCard with no ghost bubbles. Mirror of submitStartOverV2.
  -- ────────────────────────────────────────────────────────────────────
  DELETE FROM public.customer_chat_messages
   WHERE session_id = p_chat_id;
  GET DIAGNOSTICS v_messages_deleted = ROW_COUNT;

  -- All 4 writes succeeded (or were deliberate no-ops). Return a small
  -- bookkeeping object so the caller can record what landed for telemetry
  -- without a follow-up SELECT.
  RETURN pg_catalog.jsonb_build_object(
    'messages_deleted',              v_messages_deleted,
    'hold_token_released',           v_hold_token IS NOT NULL AND v_holds_released_by_token > 0,
    'holds_released_by_session_id',  v_holds_released_by_session
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.hydrate_session_reset(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hydrate_session_reset(UUID) TO service_role;

COMMENT ON FUNCTION public.hydrate_session_reset(UUID) IS
'Atomic 4-write reset for stale customer_chat_sessions. Called from scheduler-app hydrate-session.ts when a row is detected as stale (status=timed_out/abandoned OR active+last_active_at>5min). Mirror of inline RESET_COLUMNS logic at hydrate-session.ts:64-111. Returns {messages_deleted, hold_token_released, holds_released_by_session_id}.';

COMMIT;
