-- =====================================================================
-- QTekLink C1 hardening — COA FKs: ON DELETE RESTRICT (no silent cascade)
-- =====================================================================
-- 2026-06-05. /code-review (db-regression) flagged that the qbo_accounts +
-- qbo_coa_sync_state FKs to qbo_connections used ON DELETE CASCADE, which would
-- SILENTLY hard-delete a shop's mirrored chart of accounts + sync-state when a
-- connection row is deleted. The repo convention is no silent destruction of
-- sync-mirrored data (cross-module-anchors.md — soft-delete / no physical
-- deletes for mirror tables). Switch to ON DELETE RESTRICT: a connection cannot
-- be deleted while its COA mirror exists, so offboarding a shop's QBO connection
-- must clean the COA up explicitly (a deliberate, audited step — a future
-- multi-shop offboarding task), never a silent cascade.
--
-- Apply: supabase db push. IDEMPOTENT (DROP IF EXISTS + re-ADD).
-- =====================================================================

BEGIN;

ALTER TABLE public.qbo_accounts DROP CONSTRAINT IF EXISTS qbo_accounts_connection_fk;
ALTER TABLE public.qbo_accounts
  ADD CONSTRAINT qbo_accounts_connection_fk
  FOREIGN KEY (shop_id, realm_id)
  REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT;

ALTER TABLE public.qbo_coa_sync_state DROP CONSTRAINT IF EXISTS qbo_coa_sync_state_connection_fk;
ALTER TABLE public.qbo_coa_sync_state
  ADD CONSTRAINT qbo_coa_sync_state_connection_fk
  FOREIGN KEY (shop_id, realm_id)
  REFERENCES public.qbo_connections (shop_id, realm_id) ON DELETE RESTRICT;

COMMIT;
