-- supabase: skip-tx-wrap
-- ────────────────────────────────────────────────────────────────────────
-- Migration B Part 2d — CREATE surface_recent_idx with narrowed predicate.
-- ────────────────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_surface_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, table_name, operation, occurred_at DESC)
  WHERE shop_id > 0;
