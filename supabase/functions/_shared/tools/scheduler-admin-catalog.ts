// scheduler-admin-catalog.ts — Option B (per-service-block) uploaders +
// exporters + revert for testing_services and routine_services.
//
// Replaces the legacy table-row uploaders in scheduler-admin.ts for these
// two tables. Three pieces:
//
//   1. uploadTestingServicesMdV2 — parseMdSections → validate → diff → snapshot → apply
//      Same shape for uploadRoutineServicesMdV2.
//   2. exportTestingServicesMdV2 / exportRoutineServicesMdV2 — dump DB state
//      in the Option B per-service-block format. Round-trips through the
//      uploader cleanly.
//   3. revertMdUpload(upload_id) — reads pre_state_snapshot from audit log,
//      UPSERTs every row back. Idempotent. Rejects revert-of-revert chains.
//      Rejects if the snapshot was pruned (>30d retention).
//
// Pre-parser validation rules (BLOCKS apply if violated):
//   - service_key matches ^[a-z0-9_]+$
//   - no duplicate service_keys in the same upload
//   - starting_price_cents is non-negative integer (or null where allowed)
//   - concern_categories ⊆ 14 canonical slugs
//   - description length 10..500 chars
//   - abbreviation length 1..30 chars
//
// Pre-parser warning rules (visible on dry_run, not blocking):
//   - price moves >50% in either direction (catches typos)
//   - service being deactivated (soft-delete)
//   - description was set then cleared (suspicious)
//
// Dry-run flow (default — per Chris's 2026-05-19 decision):
//   - Call with dry_run=true (or omit): tool parses + validates + computes
//     diff + computes confirm_token. Writes NOTHING. Returns the report.
//   - Advisor reviews the report. Approves.
//   - Call with dry_run=false + expected_confirm_token=<token from dry_run>:
//     tool re-parses, re-computes the confirm_token, must match, then
//     captures pre_state_snapshot + applies + writes audit row.
//   - Mismatch → reject with reason. Forces a fresh dry_run.

// ─── file-size-refactor ──────────────────────────────────────────────────
// Split into ./scheduler-admin-catalog/* (one file per MD-upload surface).
// This shim preserves the public import path.
export * from "./scheduler-admin-catalog/index.ts";
