-- =====================================================================
-- DROP appointment_concerns — dead table (scheduler revamp Phase 0)
-- =====================================================================
-- REVAMP-PLAN §5 (CONFIRMED dead): the table was created in the Phase 1
-- schema but the wizard never writes it — the concern data lives on
-- customer_chat_sessions.explanation_required_items (JSONB). Verified
-- 2026-07-02: zero TS writers/readers (only database.types.ts + a pgTAP
-- cascade assertion referenced it). Its FK to customer_chat_sessions has
-- ON DELETE CASCADE, so dropping it changes no other table's behavior.

drop table if exists public.appointment_concerns;
