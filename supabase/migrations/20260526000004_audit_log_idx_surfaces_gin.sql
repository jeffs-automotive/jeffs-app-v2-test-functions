-- ────────────────────────────────────────────────────────────────────────
-- scheduler-edge-parity feature — Migration A Part 2d of 5
-- ────────────────────────────────────────────────────────────────────────
-- ONE CONCURRENT statement per file (see Part 2a header for rationale).
-- ────────────────────────────────────────────────────────────────────────
-- supabase: skip-tx-wrap

-- GIN expression index on diff_summary->'surfaces' for ADR-021's
-- modern-row surface filter precision path:
--   diff_summary->'surfaces' ? $1
--
-- The `?` JSONB existence operator uses a GIN index when the LHS is an
-- indexed JSONB expression. Falls back to seq scan if the index is
-- missing → list-tool query slows substantially at scale.
--
-- Stable WHERE clause (no shop_id filter) because Migration B's evolution
-- of the other 3 indexes doesn't affect the surfaces[] semantics.

CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduler_admin_audit_log_surfaces_gin_idx
  ON public.scheduler_admin_audit_log
  USING GIN ((diff_summary->'surfaces'));
