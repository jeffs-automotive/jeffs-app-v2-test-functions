-- ────────────────────────────────────────────────────────────────────────
-- scheduler-edge-parity feature — Migration A Part 2c of 5
-- ────────────────────────────────────────────────────────────────────────
-- ONE CONCURRENT statement per file (see Part 2a header for rationale).
-- ────────────────────────────────────────────────────────────────────────
-- supabase: skip-tx-wrap

-- Composite scan path for the list_scheduler_admin_audit_log tool's
-- (surface_filter, operation_filter) combinations. Same Migration B
-- Part 2 evolution as shop_recent_idx.

CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_surface_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, table_name, operation, occurred_at DESC)
  WHERE shop_id IS NOT NULL;
