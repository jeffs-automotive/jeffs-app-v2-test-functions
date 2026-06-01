// concern-category-guidelines — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeCanonicalAfterState,
  computeConfirmToken,
  parseConcernCategoryGuidelineMd,
  sha256Hex,
} from "../../scheduler-admin-md.ts";
import { _logAuditError, classifyApplyRpcError, checkDuplicate, type AdminAudit, type UploadResult } from "./_shared.ts";
import { CONCERN_CATEGORY_SLUGS, type ConcernCategorySlug } from "./concern-category.ts";

// ─── Concern category guidelines (Pattern S — E5a) ──────────────────────────
//
// Refactored 2026-05-26 per PLAN §4.3 — snapshot_kind = 'concern_category_guidelines'.
// Apply RPC: apply_concern_category_guideline_upload (migration 20260526000500).
// Composite PK (shop_id, category) — single row per category.
// Snapshot shape: {before: {<category>: existing|null}, added_keys: existing ? [] : [category]}.
// Revert handles BOTH update-back AND hard-DELETE (when original was INSERT).

export async function uploadConcernCategoryGuidelineMd(
  sb: SupabaseClient,
  shopId: number,
  args: {
    category_slug: string;
    md_content: string;
    audit: AdminAudit;
    dry_run?: boolean;
    expected_confirm_token?: string;
  },
): Promise<UploadResult> {
  const tableName = "concern_category_guidelines";
  const { md_content, audit, dry_run = true, expected_confirm_token } = args;

  if (!CONCERN_CATEGORY_SLUGS.includes(args.category_slug as ConcernCategorySlug)) {
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: "",
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: `category_slug must be one of: ${CONCERN_CATEGORY_SLUGS.join(", ")}`,
    };
  }
  const categorySlug = args.category_slug as ConcernCategorySlug;

  const hash = await sha256Hex(md_content);
  if (await checkDuplicate(sb, tableName, hash)) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      duplicate_upload: true,
      dry_run,
    };
  }

  // ── 1. Parse
  let parsed;
  try {
    parsed = parseConcernCategoryGuidelineMd(md_content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 0,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  // ── 2. Fetch existing row
  const { data: existing, error: fetchErr } = await sb
    .from("concern_category_guidelines")
    .select("display_label, guideline_prose")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .maybeSingle();
  if (fetchErr) {
    const msg = `concern_category_guidelines fetch failed: ${fetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 1,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  const priorExisted = !!existing;
  const willChange =
    !priorExisted ||
    (existing!.display_label !== parsed.display_label ||
      existing!.guideline_prose !== parsed.guideline_prose);

  // ── 3. Build snapshot per PLAN §4.3
  // before[<category>] = existing row | null (insert case)
  // added_keys = [category] if insert, [] if update.
  const beforeRow = priorExisted
    ? { ...existing!, shop_id: shopId, category: categorySlug }
    : null;
  const snapshotBase: Record<string, unknown> = {
    snapshot_kind: "concern_category_guidelines",
    before: { [categorySlug]: beforeRow },
    added_keys: priorExisted ? ([] as string[]) : [categorySlug],
  };

  // ── 4. Canonical-current + hash
  let expectedCurrentHash: string;
  try {
    const canonicalCurrent = await computeCanonicalAfterState({
      kind: "concern_category_guidelines",
      supabase: sb,
      shopId,
      snapshot: snapshotBase,
    });
    expectedCurrentHash = await sha256Hex(canonicalCurrent);
  } catch (e) {
    const msg = `canonical_state_concern_category_guideline compute failed: ${e instanceof Error ? e.message : String(e)}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 1,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  // ── 5. confirm_token via E2 helper (guideline kind REQUIRES categorySlug)
  const confirm_token = await computeConfirmToken({
    shopId,
    kind: "concern_category_guidelines",
    expectedCurrentHash,
    mdContentHash: hash,
    actorEmail: audit.display_name,
    categorySlug,
  });

  const action = !priorExisted ? "inserted" : willChange ? "updated" : "no-op";
  const diffSummary: Record<string, unknown> = {
    surfaces: ["concern_category_guidelines"],
    category_slug: categorySlug,
    display_label: parsed.display_label,
    prose_length: parsed.guideline_prose.length,
    action,
  };

  // ── 6. Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 1,
      rows_added: !priorExisted ? 1 : 0,
      rows_modified: priorExisted && willChange ? 1 : 0,
      rows_deactivated: 0,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // ── 7. Apply mode — call apply_concern_category_guideline_upload RPC
  const pAudit: Record<string, unknown> = {
    actor_email: audit.display_name,
    oauth_client_id: audit.oauth_client_id,
    md_content_hash: hash,
    expected_current_hash: expectedCurrentHash,
    expected_confirm_token: expected_confirm_token ?? null,
    dry_run: false,
  };
  // Per apply RPC contract: p_diff carries display_label, guideline_prose,
  // prior_existed. The RPC uses prior_existed to decide INSERT vs UPDATE
  // semantics for revert (insert → revert hard-DELETEs; update → revert
  // restores prior row).
  const pDiff: Record<string, unknown> = {
    display_label: parsed.display_label,
    guideline_prose: parsed.guideline_prose,
    prior_existed: priorExisted,
  };

  const { data: auditLogId, error: rpcErr } = await sb.rpc(
    "apply_concern_category_guideline_upload",
    {
      p_shop_id: shopId,
      p_snapshot: snapshotBase,
      p_diff: pDiff,
      p_audit: pAudit,
      p_category_slug: categorySlug,
    },
  );

  if (rpcErr) {
    const { reason_code, sanitized } = classifyApplyRpcError(rpcErr.message);
    console.warn(JSON.stringify({
      level: "warning",
      msg: "apply_concern_category_guideline_upload_failed",
      shop_id: shopId,
      category_slug: categorySlug,
      reason_code,
      detail: rpcErr.message,
    }));
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: 1,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      diff_summary: diffSummary,
      dry_run: false,
      confirm_token,
      reason_code,
      attempt_id: null,
      error_message: sanitized,
    };
  }

  return {
    ok: true,
    table_name: tableName,
    md_content_hash: hash,
    rows_parsed: 1,
    rows_added: !priorExisted ? 1 : 0,
    rows_modified: priorExisted && willChange ? 1 : 0,
    rows_deactivated: 0,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: (auditLogId as number | null) ?? undefined,
  };
}

// ─── exportConcernCategoryGuidelineMd (E6 — 2026-05-26) ─────────────────────
//
// Per PLAN §5.1 + research-02 §Q5. Pure UI-facing serializer for the admin-app
// download → edit → re-upload round trip. Reads `concern_category_guidelines`
// for one (shop_id, category) and emits the MD format that
// `parseConcernCategoryGuidelineMd` consumes.
//
// IMPORTANT — round-trip contract:
//   parseConcernCategoryGuidelineMd(
//     serializeConcernCategoryGuidelineMd(state, shop_id, slug)
//   ) === { display_label: state.display_label,
//           guideline_prose: state.guideline_prose }
//
// Stable round-trip rules:
//   - H1 emits `# {display_label} — Diagnostic Guideline`; the parser
//     strips the trailing ` — Diagnostic Guideline` suffix so display_label
//     round-trips literally.
//   - Prose body is emitted verbatim (no normalization). The parser's
//     blank-line collapse is a no-op when there are no consecutive blanks.
//   - Trailing `---` HR terminates the parser; the HTML comment after is
//     informational only and parser-ignored.
//
// EMPTY-STATE BEHAVIOR (research-02 §Open #1):
// When no row exists yet for (shop, category), this exporter returns
// `{ md_content: "", row_count: 0 }` — the UI uses row_count===0 as a sentinel
// to seed a new doc rather than render invalid (parser-rejecting) MD.
// Emitting a placeholder scaffold was considered + deferred (UI concern, not
// exporter concern).
//
// CRITICAL — per ADR-025 this exporter is for the admin-app UI ONLY. It is
// NOT the byte-parity source for the staleness check. The canonical-state
// byte-parity contract is between `canonical_state_concern_category_guideline`
// (plpgsql, E1b) and `computeCanonicalAfterState({kind: 'concern_category_guidelines'})`
// (TS, E2). The two formats are intentionally divergent (UI vs staleness).

export interface ExportConcernCategoryGuidelineState {
  display_label: string;
  guideline_prose: string;
}

/**
 * Pure serializer — does NOT touch the SupabaseClient. Unit-testable per
 * PLAN §5 + research-02 §Q8. Emits an MD doc that round-trips through
 * `parseConcernCategoryGuidelineMd`. The shopId + categorySlug are folded
 * into the trailing HTML comment only (parser-ignored) for debugging.
 */
export function serializeConcernCategoryGuidelineMd(
  state: ExportConcernCategoryGuidelineState,
  shopId: number,
  categorySlug: string,
): string {
  return [
    `# ${state.display_label} — Diagnostic Guideline`,
    "",
    state.guideline_prose,
    "",
    "---",
    "",
    `<!-- exported from concern_category_guidelines (shop_id=${shopId}, category=${categorySlug}) -->`,
    "",
  ].join("\n");
}

/**
 * DB-reading exporter for one (shop_id, category) guideline row. When no
 * row exists yet (UI hasn't seeded one), returns
 * `{ md_content: "", row_count: 0 }` — the empty md_content is a sentinel
 * for "no guideline yet" so the UI can switch into a seed-new flow rather
 * than render parser-rejecting MD.
 */
export async function exportConcernCategoryGuidelineMd(
  sb: SupabaseClient,
  shopId: number,
  args: { category_slug: string },
): Promise<{ md_content: string; row_count: number }> {
  if (!CONCERN_CATEGORY_SLUGS.includes(args.category_slug as ConcernCategorySlug)) {
    throw new Error(
      `category_slug must be one of: ${CONCERN_CATEGORY_SLUGS.join(", ")}`,
    );
  }
  const categorySlug = args.category_slug as ConcernCategorySlug;

  const { data, error } = await sb
    .from("concern_category_guidelines")
    .select("display_label, guideline_prose")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .maybeSingle();
  if (error) {
    throw new Error(
      `concern_category_guidelines export failed: ${error.message}`,
    );
  }
  if (!data) {
    // No row yet — return the empty sentinel. UI uses row_count===0 to seed
    // a new doc rather than render invalid MD.
    return { md_content: "", row_count: 0 };
  }

  const state: ExportConcernCategoryGuidelineState = {
    display_label: data.display_label as string,
    guideline_prose: data.guideline_prose as string,
  };
  return {
    md_content: serializeConcernCategoryGuidelineMd(state, shopId, categorySlug),
    row_count: 1,
  };
}
