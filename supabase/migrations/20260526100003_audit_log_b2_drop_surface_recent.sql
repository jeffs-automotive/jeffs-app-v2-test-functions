-- supabase: skip-tx-wrap
-- ────────────────────────────────────────────────────────────────────────
-- Migration B Part 2c — DROP surface_recent_idx (narrowed version follows
-- in 20260526100004).
-- ────────────────────────────────────────────────────────────────────────

DROP INDEX CONCURRENTLY IF EXISTS public.scheduler_admin_audit_log_surface_recent_idx;
