-- =====================================================================
-- appointment_verification_diff — clarify JSONB shape in column COMMENT
-- Created 2026-05-25 — Validator 1 M3 (post-Phase-5B audit)
-- =====================================================================
-- The Phase 4 column comment described the JSONB shape vaguely
-- ("JSONB payload describing fields ... captured verbatim from
-- scheduler-booking-direct's verification.diff"). But the actual
-- writer (scheduler-app/src/lib/scheduler/wizard/actions/submit-summary.ts)
-- now wraps the diff string as `{ raw: string }` before storing —
-- because the source verification.diff at scheduler-slots.ts:968-1018
-- is always a string (issues.join("; ") | "verify_get_status_<N>" |
-- exception-message slice).
--
-- This migration just updates the column comment to match the actual
-- shape so advisor queries know to use `diff->>'raw'`. No data
-- change; no behavioral change.
-- =====================================================================

BEGIN;

COMMENT ON COLUMN public.customer_chat_sessions.appointment_verification_diff IS
'JSONB object of shape `{ raw: string }` (post-2026-05-25-M3-wrap). NULL when verification passed (status=''confirmed'') or pre-confirm. The .raw field is the verbatim verification.diff string from scheduler-booking-direct (typically a "; "-joined list of field-mismatch descriptions like "customerId mismatch (got 123); vehicleId mismatch (got 456)", OR "verify_get_status_<HTTP_STATUS>", OR a sliced exception message). Advisor queries: SELECT id, appointment_verification_diff->>''raw'' FROM customer_chat_sessions WHERE appointment_verification_status=''needs_review''. Forensic context for the Pattern B AVM manual review (category=''appointment_verification_mismatch'').';

COMMIT;
