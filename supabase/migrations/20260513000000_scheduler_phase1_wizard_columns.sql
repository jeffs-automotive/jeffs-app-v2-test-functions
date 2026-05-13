-- =====================================================================
-- Scheduler Phase 1 — expand customer_chat_sessions with wizard state
-- =====================================================================
-- Created 2026-05-13. Adds the columns needed to drive the locked 10-step
-- wizard design (chat-design.md in .claude/work/planning/references/).
--
-- ARCHITECTURE (per Plaid Link / Stripe pattern + Vercel AI SDK v5 cookbook):
--   - customer_chat_sessions is the SOURCE OF TRUTH for orchestrator state
--   - customer_chat_messages stores UIMessage[] for chat-bubble rendering ONLY
--   - Chat agent's LLM sees minimal context per turn (current_step + relevant
--     fields), NOT the full message history → token-efficient + simpler
--   - On resume: read row + jump to current_step; chat-bubble history loads
--     from customer_chat_messages separately for visible continuity
--
-- All new columns are NULLABLE (or have safe defaults) because existing rows
-- predate this design. No backfill required — existing rows continue to work
-- with the pre-Phase-1 single-Sonnet orchestrator until that's refactored.
--
-- The existing `status` enum ('active'|'idle'|'ended'|'escalated'|'timed_out')
-- is retained; we add `current_step` for granular wizard step tracking.
--
-- Existing columns kept as-is:
--   id, shop_id, channel, phone_e164, customer_self_identified, customer_id,
--   vehicle_id, cookie_session, status, outcome, appointment_id, opted_out_at,
--   sentiment, started_at, last_active_at, ended_at
-- =====================================================================

ALTER TABLE public.customer_chat_sessions
  -- Wizard step tracking (granular; status remains the high-level lifecycle)
  ADD COLUMN IF NOT EXISTS current_step TEXT,

  -- Identity verification gate (set after OTP verify + Tekmetric lookup)
  -- 'full'    = phone matched on file (or vehicle-disambiguated multi-match)
  -- 'partial' = name match only (no phone match) — PII-suppressed, no edits
  -- 'none'    = neither matched (new customer path OR escalate)
  ADD COLUMN IF NOT EXISTS identity_verification_level TEXT
    CHECK (identity_verification_level IN ('full','partial','none')
           OR identity_verification_level IS NULL),

  -- Step 1: greeting card
  ADD COLUMN IF NOT EXISTS is_returning_customer BOOLEAN,
  ADD COLUMN IF NOT EXISTS greeting_answered_at TIMESTAMPTZ,

  -- Step 2: phone + name entry (entered values; verified versions land later)
  ADD COLUMN IF NOT EXISTS entered_first_name TEXT,
  ADD COLUMN IF NOT EXISTS entered_last_name TEXT,

  -- Step 3: OTP send + verify
  ADD COLUMN IF NOT EXISTS otp_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_verified_at TIMESTAMPTZ,

  -- Step 5: customer info (canonical Tekmetric values; pulled at identity time)
  ADD COLUMN IF NOT EXISTS verified_first_name TEXT,
  ADD COLUMN IF NOT EXISTS verified_last_name TEXT,
  ADD COLUMN IF NOT EXISTS edited_phones JSONB,                      -- [{id?, number, type, primary}]
  ADD COLUMN IF NOT EXISTS edited_emails JSONB,                      -- [{email, primary}] — comma-string rebuilt for Tekmetric
  ADD COLUMN IF NOT EXISTS edited_address JSONB,                     -- {address1, address2, city, state, zip}
  ADD COLUMN IF NOT EXISTS primary_email_for_description TEXT,       -- our DB-only primary (no Tekmetric API field)

  -- Step 6: vehicle pick / new vehicle add (per-session draft)
  ADD COLUMN IF NOT EXISTS new_vehicle_info JSONB,                   -- {year, make, model, license_plate?, notes?}

  -- Step 7: services + concern (multi-sub-card flow)
  ADD COLUMN IF NOT EXISTS selected_simple_services TEXT[],          -- chips without explanation needed
  ADD COLUMN IF NOT EXISTS explanation_required_items JSONB,         -- [{service_key, explanation_text, category, clarifications, recommendations}]
  ADD COLUMN IF NOT EXISTS diagnostic_processing_complete BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS clarification_questions_pending JSONB,    -- aggregated queue
  ADD COLUMN IF NOT EXISTS clarification_questions_answered JSONB,   -- {question_id: answer_value | 'skipped'}
  ADD COLUMN IF NOT EXISTS recommended_testing_services JSONB,       -- aggregated across concerns
  ADD COLUMN IF NOT EXISTS approved_testing_services TEXT[],         -- subset of recommended
  ADD COLUMN IF NOT EXISTS declined_testing_services TEXT[],         -- complement (still logged + emailed)
  ADD COLUMN IF NOT EXISTS additional_routine_services_round2 TEXT[],-- second routine pass after testing decision

  -- Step 8/9: appointment
  ADD COLUMN IF NOT EXISTS appointment_type TEXT
    CHECK (appointment_type IN ('waiter','dropoff') OR appointment_type IS NULL),
  ADD COLUMN IF NOT EXISTS appointment_date DATE,
  ADD COLUMN IF NOT EXISTS appointment_time TIME,                    -- waiter only; dropoff uses hard-coded 12:00 internally
  ADD COLUMN IF NOT EXISTS hold_token UUID,                          -- ref appointment_holds.id; 10-min TTL

  -- Step 10: confirmation + post-confirm
  ADD COLUMN IF NOT EXISTS appointment_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_notes_text TEXT,                 -- raw or trimmed depending on length
  ADD COLUMN IF NOT EXISTS customer_notes_approved BOOLEAN,
  ADD COLUMN IF NOT EXISTS customer_notes_edit_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_question TEXT,
  ADD COLUMN IF NOT EXISTS customer_question_forwarded BOOLEAN NOT NULL DEFAULT FALSE,

  -- Edit-from-summary rate limiter (2-edit cap → escalation)
  ADD COLUMN IF NOT EXISTS summary_edit_attempts INT NOT NULL DEFAULT 0,

  -- Lifecycle (escalated/abandoned/completed timestamps)
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,                   -- 'keyword:lawyer' | 'otp_max_attempts' | 'summary_edit_limit' | etc.
  ADD COLUMN IF NOT EXISTS abandoned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Index for resume-by-cookie lookup (cookie_session is already indexed, but
-- we want fast filter for active-only resumes)
CREATE INDEX IF NOT EXISTS customer_chat_sessions_active_resume_idx
  ON public.customer_chat_sessions(cookie_session, last_active_at DESC)
  WHERE cookie_session IS NOT NULL AND status IN ('active','idle');

-- Index for finding holds about to expire (cross-check with appointment_holds)
CREATE INDEX IF NOT EXISTS customer_chat_sessions_hold_token_idx
  ON public.customer_chat_sessions(hold_token)
  WHERE hold_token IS NOT NULL;

-- Comment explaining the `current_step` value space (enforced in code, not via CHECK)
COMMENT ON COLUMN public.customer_chat_sessions.current_step IS
  'Wizard step value. Enum enforced at app layer (no CHECK constraint to allow rapid iteration). Values: greeting | phone_name | otp_pending | partial_verification_gate | multi_account_disambiguation | no_match_choose_path | customer_info_edit | new_customer_info | vehicle_pick | new_vehicle_form | service_concern_picker | concern_explanation | diagnostic_loading | clarification_question | testing_service_approval | second_routine_pass | appointment_type | date_pick | waiter_time_pick | summary | customer_notes | customer_question | completed | escalated | abandoned';

COMMENT ON COLUMN public.customer_chat_sessions.identity_verification_level IS
  'Set after OTP verify + Tekmetric customer lookup. Drives downstream PII access: full=normal flow, partial=read-only customer info + no vehicle add, none=new customer path or escalate. The Scheduler Specialist filters returned data by this level — chat agent NEVER sees raw customer data above the level.';

COMMENT ON COLUMN public.customer_chat_sessions.explanation_required_items IS
  'Step 7 per-concern data. Array of {service_key, explanation_text, category, clarifications, recommendations}. Populated through Step 7.1→7.5. After appointment confirms (Step 10.2), copied to appointment_concerns table for long-term normalized storage.';

COMMENT ON COLUMN public.customer_chat_sessions.hold_token IS
  'UUID referencing appointment_holds.id. 10-minute TTL (changed from 30 min on 2026-05-13). On confirm at Step 10, hold must still be valid; otherwise customer is bounced to Step 9 to re-pick.';
