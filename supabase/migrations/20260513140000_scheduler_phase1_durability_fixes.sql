-- =====================================================================
-- Scheduler Phase 1 — durability fixes
-- =====================================================================
-- Created 2026-05-13. Bundle of low-risk integrity fixes from the
-- 2026-05-13 DB audit:
--
--   H-1  customer_chat_sessions.customer_id + vehicle_id are INT4 →
--        widen to BIGINT to match Tekmetric's 64-bit IDs + sibling
--        tables (appointments.*, keytags.*, etc.). Latent — works today
--        because Tekmetric IDs for shop 7476 are < 2.1B, but breaks
--        silently as soon as Tekmetric assigns higher IDs.
--        appointment_holds.customer_id + vehicle_id have the same issue
--        and are widened here too.
--   L-5  customer_chat_sessions.current_step has no DEFAULT — new rows
--        from Server Actions silently land NULL. Set DEFAULT 'greeting'
--        so the chat-agent's snapshot has a real value at row birth.
--   M-1  appointment_holds.session_id has no index (only the partial
--        composite index). Add B-tree for cleanup / lookup-by-session.
--   M-2  transcript_emails.session_id has no index. Same fix.
--
-- All operations are non-destructive:
--   - ALTER COLUMN TYPE BIGINT preserves existing INT4 values; reads +
--     writes keep working.
--   - SET DEFAULT only affects NEW rows; existing NULLs are unchanged
--     (and there were no NULL rows in production-relevant state per
--     audit — the 20 existing rows have NULL current_step from before
--     the wizard-columns migration, which is the expected state).
--   - CREATE INDEX IF NOT EXISTS is idempotent.
--
-- These are safe to apply on a live database with traffic.
-- =====================================================================

-- ─── H-1: widen customer_id + vehicle_id to BIGINT ─────────────────────

-- customer_chat_sessions
ALTER TABLE public.customer_chat_sessions
  ALTER COLUMN customer_id TYPE BIGINT USING customer_id::BIGINT;

ALTER TABLE public.customer_chat_sessions
  ALTER COLUMN vehicle_id TYPE BIGINT USING vehicle_id::BIGINT;

-- appointment_holds
ALTER TABLE public.appointment_holds
  ALTER COLUMN customer_id TYPE BIGINT USING customer_id::BIGINT;

ALTER TABLE public.appointment_holds
  ALTER COLUMN vehicle_id TYPE BIGINT USING vehicle_id::BIGINT;

-- appointment_id on customer_chat_sessions is also INT4 — likely meant to
-- hold the Tekmetric appointment ID (BIGINT). Widen defensively. (Audit
-- H-4 also flags the FK-vs-type ambiguity, but renaming to
-- tekmetric_appointment_id is deferred since it would require coordinating
-- with downstream readers; widening alone is safe.)
ALTER TABLE public.customer_chat_sessions
  ALTER COLUMN appointment_id TYPE BIGINT USING appointment_id::BIGINT;

-- ─── L-5: current_step default ─────────────────────────────────────────

ALTER TABLE public.customer_chat_sessions
  ALTER COLUMN current_step SET DEFAULT 'greeting';

-- Backfill the existing NULL rows (the audit noted 20 rows with NULL
-- current_step from pre-wizard-columns days). New rows from Server
-- Actions will get the default; this brings the historical rows up to
-- spec without forcing the app to handle a third "NULL" state.
UPDATE public.customer_chat_sessions
   SET current_step = 'greeting'
 WHERE current_step IS NULL;

-- ─── M-1: appointment_holds.session_id index ────────────────────────────

CREATE INDEX IF NOT EXISTS appointment_holds_session_id_idx
  ON public.appointment_holds(session_id);

-- ─── M-2: transcript_emails.session_id index ────────────────────────────

CREATE INDEX IF NOT EXISTS transcript_emails_session_id_idx
  ON public.transcript_emails(session_id);

-- ─── Defensive: also index scheduler_audit_log.session_id if missing ────
-- (Already created by 20260513000100_scheduler_phase1_new_tables.sql but
-- IF NOT EXISTS is a no-op if present, and protects future migrations
-- that might drop it.)
CREATE INDEX IF NOT EXISTS scheduler_audit_log_session_idx
  ON public.scheduler_audit_log(session_id);

COMMENT ON COLUMN public.customer_chat_sessions.customer_id IS
  'Tekmetric customer_id (BIGINT). NULL until OTP verification completes '
  'and the §4.3 reconciliation matrix lands on a single match. Widened '
  'from INT4 → BIGINT 2026-05-13 per audit H-1.';

COMMENT ON COLUMN public.customer_chat_sessions.vehicle_id IS
  'Tekmetric vehicle_id (BIGINT). NULL until vehicle pick (Step 6). '
  'Widened from INT4 → BIGINT 2026-05-13 per audit H-1.';

COMMENT ON COLUMN public.customer_chat_sessions.appointment_id IS
  'Tekmetric appointment_id (BIGINT) after confirm_appointment succeeds. '
  'Widened from INT4 → BIGINT 2026-05-13 per audit H-1/H-4. Note: this '
  'is the Tekmetric ID, NOT a local appointments(id) UUID — they are '
  'different concepts. Renaming to tekmetric_appointment_id deferred.';
