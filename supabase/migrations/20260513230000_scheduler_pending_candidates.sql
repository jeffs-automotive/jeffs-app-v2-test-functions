-- =====================================================================
-- Scheduler Phase 1 — pending_candidates JSONB column
-- =====================================================================
-- Created 2026-05-13 per scheduler-refactor-state.json phase_05b.
--
-- Adds a transient JSONB column to customer_chat_sessions for stashing
-- the multi-account disambiguation candidates returned by
-- scheduler-step2-direct.
--
-- Why this column exists (chat-design.md "Architecture amendment —
-- 2026-05-14" + the row-as-truth principle):
--
--   When a customer's phone hits 2+ Tekmetric records, scheduler-step2-
--   direct emits show_multi_account_disambiguation along with the
--   candidate list (customer_id + recent_vehicle pairs, vehicle-only per
--   PII protection in chat-design.md §3.5c lines 685 + 710). The
--   §3.5c card needs that list to render on next page load.
--
--   Per the architecture amendment, the row IS the source of truth.
--   Transient client-side state (e.g., URL params, cookies) wouldn't
--   survive resume / refresh. So scheduler-step2-direct stashes the
--   candidate JSONB here, and get-current-card.ts reads it for the
--   multi_account_disambiguation step's payload.
--
--   submit-multi-account-choice.ts clears this column once the customer
--   picks (or "none of these" falls through to no_match_choose_path).
--   NULL is the default — non-NULL only during the disambiguation flow.
--
-- Safe to apply on a live database with traffic:
--   - ADD COLUMN IF NOT EXISTS is idempotent.
--   - No NOT NULL — existing rows keep NULL until they enter the flow.
--   - No CHECK constraint — JSON shape is enforced at the application
--     layer (parseCandidates in get-current-card.ts).
-- =====================================================================

ALTER TABLE public.customer_chat_sessions
  ADD COLUMN IF NOT EXISTS pending_candidates JSONB;

COMMENT ON COLUMN public.customer_chat_sessions.pending_candidates IS
  'Multi-account disambiguation candidates (chat-design.md §3.5c). Array of {customer_id: number, recent_vehicle: string} written by scheduler-step2-direct when phone hits 2+ Tekmetric records. Cleared by submit-multi-account-choice once the customer picks (or "none of these" falls through). NULL when not in the disambiguation flow.';
