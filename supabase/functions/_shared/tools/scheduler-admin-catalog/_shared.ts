// Shared types + constants for the MD-upload catalog surfaces.
// Extracted from scheduler-admin-catalog.ts (file-size-refactor). Mechanical
// split — no logic changes. Public API preserved via the ./index.ts barrel +
// the scheduler-admin-catalog.ts re-export shim.

import {
  type ParsedMdSection,
  type SnapshotKind,
} from "../../scheduler-admin-md.ts";
import type { AdminAudit, ValidationFinding } from "../scheduler-admin.ts";

export const CONCERN_CATEGORY_SLUGS = new Set([
  "noise", "vibration", "pulling", "smell", "smoke", "leak", "warning_light",
  "performance", "electrical", "hvac", "brakes", "steering", "tires", "other",
]);

export const MIN_DESCRIPTION_LEN = 10;
export const MAX_DESCRIPTION_LEN = 500;
export const MAX_ABBREVIATION_LEN = 30;
export const PRICE_WARN_PCT = 0.5;

// ═══════════════════════════════════════════════════════════════════════
// Shared types
// ═══════════════════════════════════════════════════════════════════════

export interface UploadV2Args {
  md_content: string;
  audit: AdminAudit;
  /** Default TRUE — must explicitly pass false to apply. */
  dry_run?: boolean;
  /** Required when dry_run=false; must match the token from a recent dry_run. */
  expected_confirm_token?: string;
}

export interface RowDiff<TRow> {
  added: TRow[];
  modified: Array<{ before: TRow; after: TRow; changed_fields: string[] }>;
  deactivated: TRow[];
  unchanged: TRow[];
}

export interface ParsedCatalog<TRow> {
  rows: TRow[];
  findings: ValidationFinding[];
}

export interface CatalogConfig<TRow extends { service_key: string; active: boolean; starting_price_cents?: number | null }> {
  tableName: "testing_services" | "routine_services";
  selectColumns: string;
  /** E4 (2026-05-26) — snapshot_kind written into pre_state_snapshot.kind +
   *  used to compute expected_after_state_canonical via the E2 helper. MUST
   *  match the closed allow-list in scheduler-admin-md.ts (`SnapshotKind`)
   *  byte-for-byte; drift between this string and the plpgsql kind allow-list
   *  is a production bug. Per PLAN §7 6-column kind mapping table:
   *  testing_services_v2 ↔ testing_services surface,
   *  routine_services_v2 ↔ routine_services surface. */
  snapshotKind: Extract<SnapshotKind, "testing_services_v2" | "routine_services_v2">;
  /** E4 (2026-05-26) — surface_filter enum value per PLAN §7 + ADR-021.
   *  Written into diff_summary.surfaces[] so the list-audit-log tool's
   *  modern surface-filter branch can match logical surface (not just
   *  physical table_name). */
  surfaceFilter: "testing_services" | "routine_services";
  /** Parse + validate ONE section into a typed row. Pushes findings if invalid. */
  parseSection: (
    section: ParsedMdSection,
    findings: ValidationFinding[],
  ) => TRow | null;
  /** Return the field names that changed between before+after. */
  diffFields: (before: TRow, after: TRow) => string[];
  /** Build the row for upsert (add shop_id). */
  toUpsertRow: (row: TRow, shopId: number) => Record<string, unknown>;
  /** Pretty-print a row for the diff summary. */
  prettyRow: (row: TRow) => string;
}

// ═══════════════════════════════════════════════════════════════════════
// testing_services — Option B
// ═══════════════════════════════════════════════════════════════════════
