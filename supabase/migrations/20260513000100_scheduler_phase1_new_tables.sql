-- =====================================================================
-- Scheduler Phase 1 — new supporting tables
-- =====================================================================
-- Created 2026-05-13. Four new tables:
--   1. scheduler_audit_log         — per-step audit trail
--   2. concern_questions           — pre-defined clarification question catalog
--   3. appointment_default_limits  — per-day-of-week capacity defaults
--   4. scheduler_admin_audit_log   — MD-upload + admin-tool audit
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. scheduler_audit_log — per-step audit trail
-- ---------------------------------------------------------------------
-- Append-only audit log. Records every card_shown, card_submitted,
-- tool_called, specialist_called, escalation_triggered, session_resumed,
-- session_abandoned, etc. event during a wizard session.
--
-- Volume: ~40-60 rows per session (depending on path complexity). Indexed
-- by session_id + occurred_at for fast per-session timeline queries.
--
-- PII rule: event_detail JSONB should NEVER contain raw phone/email/
-- address values. Use last-4-digits or counts/flags. Vehicle YMM is OK
-- (mildly identifying, expected for service records); license plate is
-- NOT logged.

CREATE TABLE IF NOT EXISTS public.scheduler_audit_log (
  id              BIGSERIAL    PRIMARY KEY,
  session_id      UUID         NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  step            TEXT         NOT NULL,                  -- the current_step value at time of event
  event_type      TEXT         NOT NULL,                  -- 'card_shown' | 'card_submitted' | 'tool_called' | 'tool_succeeded' | 'tool_failed' | 'specialist_called' | 'escalation_triggered' | 'escalation_dismissed' | 'idle_warning_shown' | 'session_abandoned' | 'session_resumed' | 'session_resumed_from_abandoned' | 'session_restarted' | 'identity_verified' | 'card_field_changed' | 'card_validation_error' | 'specialist_slow_15s' | 'specialist_slow_45s' | 'rate_limited' | 'offline_detected' | 'online_restored' | 'tekmetric_error' | 'session_completed' | 'transcript_email_queued' | 'transcript_email_sent' | etc.
  event_detail    JSONB,                                  -- event-specific context (PII-sanitized)
  router_decision TEXT,                                   -- specialist picked, when applicable
  model_used      TEXT,                                   -- 'gpt-5.4-nano' | 'claude-haiku-4-5' | 'gpt-5.4-mini-reasoning-medium' | etc.
  latency_ms      INT,
  input_tokens    INT,
  output_tokens   INT,
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS scheduler_audit_log_session_idx
  ON public.scheduler_audit_log(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS scheduler_audit_log_event_type_idx
  ON public.scheduler_audit_log(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS scheduler_audit_log_step_idx
  ON public.scheduler_audit_log(step, occurred_at DESC);
CREATE INDEX IF NOT EXISTS scheduler_audit_log_errors_idx
  ON public.scheduler_audit_log(session_id, occurred_at)
  WHERE event_type IN ('tool_failed', 'tekmetric_error', 'escalation_triggered');

ALTER TABLE public.scheduler_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.scheduler_audit_log FOR ALL TO public USING (false);

COMMENT ON TABLE public.scheduler_audit_log IS
  'Per-step audit trail for scheduler wizard sessions. Append-only. Records every card render, submit, tool call, specialist invocation, and lifecycle event. PII-sanitized in event_detail.';

-- ---------------------------------------------------------------------
-- 2. concern_questions — pre-defined clarification question catalog
-- ---------------------------------------------------------------------
-- Step 7.4 clarification questions are picked from this catalog by the
-- Diagnostic Q&A specialist based on the matched concern category.
-- Service advisors manage via MD-upload tool (Chunk 5).

CREATE TABLE IF NOT EXISTS public.concern_questions (
  id              BIGSERIAL    PRIMARY KEY,
  shop_id         INTEGER      NOT NULL,
  category        TEXT         NOT NULL CHECK (category IN (
                                  'noise',
                                  'vibration',
                                  'pulling',
                                  'smell',
                                  'smoke',
                                  'leak',
                                  'warning_light',
                                  'performance',
                                  'electrical',
                                  'hvac',
                                  'brakes',
                                  'steering',
                                  'tires',
                                  'other'
                                )),
  question_text   TEXT         NOT NULL,
  options         JSONB        NOT NULL,                  -- [{ label: "Front of the car", value: "front" }, ...]
  display_order   INT          NOT NULL DEFAULT 0,
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by_oauth_client_id TEXT,
  updated_by_name TEXT
);

CREATE INDEX IF NOT EXISTS concern_questions_lookup_idx
  ON public.concern_questions(shop_id, category, active, display_order);

ALTER TABLE public.concern_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.concern_questions FOR ALL TO public USING (false);

COMMENT ON TABLE public.concern_questions IS
  'Pre-defined catalog of clarification questions per concern category (14 categories). The Diagnostic Q&A specialist queries this table to pick which questions to ask based on what was/wasn''t answered in the customer''s explanation. Options are stored as JSONB array of {label, value} for multiple-choice rendering.';

-- ---------------------------------------------------------------------
-- 3. appointment_default_limits — per-day-of-week capacity defaults
-- ---------------------------------------------------------------------
-- Step 8 + 9 use these limits + appointment_blocks + closed_dates to
-- compute availability. Service advisors can edit via MD-upload tool.

CREATE TABLE IF NOT EXISTS public.appointment_default_limits (
  shop_id            INTEGER  NOT NULL,
  day_of_week        INT      NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sunday, 1=Monday, ..., 6=Saturday
  is_closed          BOOLEAN  NOT NULL DEFAULT FALSE,
  waiter_8am_slots   INT      NOT NULL DEFAULT 0,
  waiter_9am_slots   INT      NOT NULL DEFAULT 0,
  dropoff_total      INT      NOT NULL DEFAULT 0,
  notes              TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_oauth_client_id TEXT,
  updated_by_name    TEXT,
  PRIMARY KEY (shop_id, day_of_week)
);

ALTER TABLE public.appointment_default_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.appointment_default_limits FOR ALL TO public USING (false);

COMMENT ON TABLE public.appointment_default_limits IS
  'Default per-day-of-week capacity limits. Layered with appointment_blocks (date-specific) + closed_dates (holidays) to compute available slots. Service advisors manage via the upload_appointment_limits_md MCP tool.';

-- ---------------------------------------------------------------------
-- 4. scheduler_admin_audit_log — MD-upload + admin-tool audit
-- ---------------------------------------------------------------------
-- Tracks every MD-upload + manual admin change so we have a paper trail
-- of who changed what in the predefined-data tables.

CREATE TABLE IF NOT EXISTS public.scheduler_admin_audit_log (
  id              BIGSERIAL    PRIMARY KEY,
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  oauth_client_id TEXT,
  user_label      TEXT,                                   -- e.g. advisor email from oauth_access_tokens
  table_name      TEXT         NOT NULL,                  -- 'routine_services' | 'testing_services' | 'concern_questions' | 'appointment_default_limits' | 'closed_dates'
  operation       TEXT         NOT NULL CHECK (operation IN ('upload_md','manual_change','export_md')),
  rows_added      INT          NOT NULL DEFAULT 0,
  rows_modified   INT          NOT NULL DEFAULT 0,
  rows_deactivated INT         NOT NULL DEFAULT 0,
  md_content_hash TEXT,                                   -- sha256 of uploaded MD for de-dup + audit
  diff_summary    JSONB,                                  -- structured diff: what changed per row
  error_message   TEXT
);

CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_table_idx
  ON public.scheduler_admin_audit_log(table_name, occurred_at DESC);
CREATE INDEX IF NOT EXISTS scheduler_admin_audit_log_user_idx
  ON public.scheduler_admin_audit_log(user_label, occurred_at DESC)
  WHERE user_label IS NOT NULL;

ALTER TABLE public.scheduler_admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.scheduler_admin_audit_log FOR ALL TO public USING (false);

COMMENT ON TABLE public.scheduler_admin_audit_log IS
  'Audit trail for service-advisor changes to predefined-data tables (routine_services, testing_services, concern_questions, appointment_default_limits, closed_dates). Records who, when, what, and a structured diff. Source of truth for "who changed X" queries.';
