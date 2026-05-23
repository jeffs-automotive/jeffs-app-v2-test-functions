-- =====================================================================
-- Plan 01 Phase 1B — Drop scratch / dev tables (audit B3 + B4)
-- =====================================================================
-- 2026-05-22. Audit found 2 tables with RLS DISABLED, exposed to the anon
-- and authenticated roles via supabase-js. Pre-flight grep confirmed zero
-- functional code references — both are dev/test artifacts from earlier
-- iterations.
--
-- Schema records preserved at .tmp/scratch-tables-drop-record-2026-05-22.md
-- so future researchers can reconstruct what was here if needed.
--
-- Drop order: no FKs reference either table; safe to drop in either order.

BEGIN;

DROP TABLE IF EXISTS public._bulk_keytag_backfill;
DROP TABLE IF EXISTS public._smoke_test_run;

COMMIT;
