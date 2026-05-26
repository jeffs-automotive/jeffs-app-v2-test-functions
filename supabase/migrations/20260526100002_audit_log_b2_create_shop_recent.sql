-- supabase: skip-tx-wrap
-- ────────────────────────────────────────────────────────────────────────
-- Migration B Part 2b — CREATE shop_recent_idx with narrowed predicate.
-- Sentinel rows (shop_id = -1) excluded; positive shop_id only.
-- ────────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_shop_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, occurred_at DESC)
  WHERE shop_id > 0;
