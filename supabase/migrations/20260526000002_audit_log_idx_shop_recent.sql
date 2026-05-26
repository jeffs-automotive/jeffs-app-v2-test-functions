-- ────────────────────────────────────────────────────────────────────────
-- scheduler-edge-parity feature — Migration A Part 2b of 5
-- ────────────────────────────────────────────────────────────────────────
-- ONE CONCURRENT statement per file (see Part 2a header for rationale).
-- ────────────────────────────────────────────────────────────────────────
-- supabase: skip-tx-wrap

-- Primary scan path for the list_scheduler_admin_audit_log tool's
-- shop-scoped recent-uploads query.
--
-- Migration A state: shop_id is NULLABLE. Predicate excludes NULL rows
-- (historical rows pre-backfill). Migration B Part 2 (E11e) DROPs +
-- CREATEs CONCURRENTLY with WHERE shop_id > 0 after shop_id flips
-- NOT NULL (sentinel -1 rows are then also excluded).

CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_shop_recent_idx
  ON public.scheduler_admin_audit_log (shop_id, occurred_at DESC)
  WHERE shop_id IS NOT NULL;
