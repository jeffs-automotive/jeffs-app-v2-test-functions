// Admin tool functions for the scheduler MD-upload + maintenance workflow.
//
// Per chat-design.md "MD-upload pattern" + scheduler_phase1_design_lock.md
// 2026-05-13. Service advisors edit the predefined-data tables by uploading
// markdown files; the tools here parse, diff against current DB state,
// apply changes, and log to scheduler_admin_audit_log.
//
// Tables covered:
//   - routine_services
//   - testing_services
//   - concern_questions
//   - appointment_default_limits
//   - closed_dates
//
// Helper tools also exposed here:
//   - runAppointmentsSync   — on-demand call to the appointments-sync function
//   - findOrphanCustomers   — locally-cached customers Tekmetric has deleted
//
// Audit: every successful upload writes ONE row to scheduler_admin_audit_log
// with the md_content_hash + structured diff_summary JSONB. Re-uploading
// the same MD content fast-paths to a no-op (caught via the hash).
//
// ─── scheduler-edge-parity E5 (2026-05-26) ──────────────────────────────
// The 5 LEGACY uploaders below have been refactored to Pattern S per
// PLAN §4.1-4.5. Each two-step:
//   1. dry_run mode (default TRUE) — parse + validate + diff + compute
//      confirm_token; NO writes; returns preview.
//   2. apply mode (dry_run=false + expected_confirm_token) — delegates the
//      apply phase to the per-kind apply_<table>_upload plpgsql RPC
//      (migration 20260526000500). The apply RPC takes the surface lock,
//      re-verifies canonical state + token, performs mutations, and writes
//      the audit row atomically.
//
// Audit-log inserts in this file ALL go through the consolidated
// `logAuditEntry` helper in scheduler-admin-md.ts (requires shopId per E2).
// The historical local `logAdminAudit` helper has been DELETED (see comment
// at end of file).

// ─── file-size-refactor ──────────────────────────────────────────────────
// Split into ./scheduler-admin/* (one file per MD-upload surface + shared
// types/helpers + audit-log). This shim preserves the public import path.
export * from "./scheduler-admin/index.ts";
