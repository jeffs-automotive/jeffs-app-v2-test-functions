-- =====================================================================
-- apply_wizard_transition — explicit SECURITY INVOKER re-assertion
-- Created 2026-05-25 — Validator 1 H1 (post-Phase-5B audit)
-- =====================================================================
-- Phase 4 migration `20260525000000_appointment_verification_columns_and_rpc.sql`
-- redefined `public.apply_wizard_transition` via CREATE OR REPLACE
-- but omitted the explicit `SECURITY INVOKER` clause that the Phase 1A
-- definition (`20260524220000_rpc_apply_wizard_transition.sql:121`)
-- carried as a documented hardening decision.
--
-- Postgres defaults to SECURITY INVOKER when the clause is omitted,
-- so the function's current behavior is unchanged. But the intent
-- ("INVOKER, NOT DEFINER — preserves caller's role for audit; caller
-- is service_role via createSupabaseAdminClient which bypasses RLS
-- naturally") was documented in the Phase 1A migration header + lost
-- in Phase 4. A future maintainer reading only the Phase 4 migration
-- would see no SECURITY clause and not know whether to keep the
-- default or switch to DEFINER. This migration re-asserts INVOKER
-- via ALTER FUNCTION so a future toggle requires an explicit edit.
--
-- Pure metadata change. No function body change. No re-application
-- of the CASE-WHEN-? merge logic (which would be byte-fragile and
-- isn't needed here).
-- =====================================================================

BEGIN;

ALTER FUNCTION public.apply_wizard_transition(UUID, JSONB, TEXT, TEXT)
  SECURITY INVOKER;

COMMENT ON FUNCTION public.apply_wizard_transition(UUID, JSONB, TEXT, TEXT) IS
'Atomic 3-write wizard step advance (UPDATE customer_chat_sessions + optional user-bubble INSERT + optional assistant-bubble INSERT) wrapped in a single Postgres transaction. SECURITY INVOKER (caller is service_role via createSupabaseAdminClient — bypasses RLS naturally; INVOKER preserves caller identity for audit + avoids DEFINER privilege-escalation surface). Plan 04 Phase 1A. Phase 4 (20260525000000) added appointment_verification_status + appointment_verification_diff branches. SECURITY INVOKER re-asserted 2026-05-25 post-validator-audit (Phase 4 CREATE OR REPLACE silently dropped the explicit keyword).';

COMMIT;
