-- Teardown: retired qteklink per-RO posting queue + settings ro_state.
--
-- Context: qteklink's posting model moved from a per-RO enqueue/claim/approve
-- ledger (`qteklink_postings`) to the current per-DAY bulk-JE model (≤3 JEs/day,
-- see qteklink-app/src/lib/dal/daily-*.ts). The per-RO queue table + its RPCs and
-- the `qteklink_ro_state` mirror are no longer read or written by any code
-- (verified: zero .from()/.rpc() callers in qteklink-app/admin-app/edge fns;
-- only stale comments + generated types referenced them). No cron schedules any
-- of these. No inbound FK references them (leaf tables).
--
-- KEPT (still live — do NOT drop): qteklink_settings + qteklink_upsert_settings
-- (used by back-office / notify / payroll / settings DALs), qteklink_ros,
-- qteklink_daily_postings.
--
-- NOTE: docs/code-quality/codebase-audit-2026-07-23.md also listed a
-- "scheduler_admin_snapshots table + snapshot-prune cron" here. There is no such
-- table (snapshots are the scheduler_admin_audit_log.pre_state_snapshot column),
-- and scheduler_admin_audit_log is STILL live (admin-app schedulerconfig History
-- tab reads it via list_scheduler_admin_audit_log_filtered). The snapshot-prune
-- retention cron is therefore intentionally left in place, pending a separate
-- determination of whether pre_state_snapshot is still populated.

BEGIN;

-- Per-RO posting-queue functions (retired; unambiguous names → drop by name).
DROP FUNCTION IF EXISTS public.qteklink_enqueue_posting        CASCADE;
DROP FUNCTION IF EXISTS public.qteklink_approve_posting        CASCADE;
DROP FUNCTION IF EXISTS public.qteklink_reject_posting         CASCADE;
DROP FUNCTION IF EXISTS public.qteklink_claim_posting          CASCADE;
DROP FUNCTION IF EXISTS public.qteklink_claim_posting_by_id    CASCADE;
DROP FUNCTION IF EXISTS public.qteklink_mark_posted            CASCADE;
DROP FUNCTION IF EXISTS public.qteklink_mark_failed            CASCADE;
DROP FUNCTION IF EXISTS public.qteklink_requeue_expired_leases CASCADE;
DROP FUNCTION IF EXISTS public.qteklink_upsert_ro_state        CASCADE;

-- Retired tables (leaf — CASCADE covers own indexes + outbound FK constraints).
DROP TABLE IF EXISTS public.qteklink_postings CASCADE;
DROP TABLE IF EXISTS public.qteklink_ro_state CASCADE;

COMMIT;
