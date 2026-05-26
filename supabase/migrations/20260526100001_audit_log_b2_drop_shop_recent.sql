-- supabase: skip-tx-wrap
-- ────────────────────────────────────────────────────────────────────────
-- Migration B Part 2a — DROP shop_recent_idx (narrowed version follows in
-- 20260526100002). ONE CONCURRENT statement per file per pipeline-mode
-- workaround (ROUND-6-RESIDUALS E1a-DEPLOY).
-- ────────────────────────────────────────────────────────────────────────

DROP INDEX CONCURRENTLY IF EXISTS public.scheduler_admin_audit_log_shop_recent_idx;
