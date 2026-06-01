// concern-category-export — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeCanonicalAfterState,
  parseConcernCategoryMd,
  slugifyForConcernSubcategory,
} from "../../scheduler-admin-md.ts";
import { CONCERN_CATEGORY_SLUGS, type ConcernCategorySlug } from "./concern-category.ts";

// ─── exportConcernCategoryMd (E6 — 2026-05-26) ──────────────────────────────
//
// Per PLAN §5.2 + research-02 §Q6. Pure UI-facing serializer for the admin-app
// download → edit → re-upload round trip. Reads `concern_subcategories` +
// `concern_questions` (ACTIVE only) for one (shop_id, category) and emits the
// hierarchical MD format `parseConcernCategoryMd` consumes.
//
// IMPORTANT — round-trip contract:
//   parseConcernCategoryMd(serializeConcernCategoryMd(subs, qs, label)) ===
//     { display_label: label,
//       subcategories: [ { slug, display_label, display_order, questions: [...] }, ... ] }
//
// Stable round-trip rules:
//   - Question numbers come from INDEX POSITION (idx + 1) within the sub-cat,
//     NOT from the DB `display_order` column. Two questions with the same DB
//     display_order would otherwise re-number across export/upload (research-02
//     §Open #5).
//   - Options always emit `Label=value` form (no shorthand), for unambiguous
//     reparse (research-02 §Open #2).
//   - Sub-category headers emit `display_label` so the parser regenerates the
//     same slug via `slugifyForConcernSubcategory(label)`.
//   - `[multi]` prefix is emitted iff `multi_select === true`.
//   - Trailing HTML comment + `---` HR are parser-ignored — informational only.
//
// CRITICAL — per ADR-025 this exporter is for the admin-app UI ONLY. It is
// NOT the byte-parity source for the staleness check. The canonical-state
// byte-parity contract is between `canonical_state_concern_category_upload`
// (plpgsql, E1b) and `computeCanonicalAfterState({kind: 'concern_questions_per_category'})`
// (TS, E2). The two formats are intentionally divergent (UI vs staleness).

export interface ExportConcernCategorySubRow {
  /** id is unused by the serializer but kept in the type so the DB-reading
   *  exporter can pass the raw row through without restructuring. */
  id: number;
  slug: string;
  display_label: string;
  display_order: number;
}

export interface ExportConcernCategoryQuestionRow {
  subcategory_id: number;
  question_text: string;
  display_order: number;
  options: Array<{ label: string; value: string }> | null;
  multi_select: boolean | null;
}

/**
 * Pure serializer — does NOT touch the SupabaseClient. Unit-testable per
 * PLAN §5 + research-02 §Q8. Subs MUST already be in the desired display
 * order; questions MUST already be in the desired display order within their
 * subcategory_id. The serializer groups by subcategory_id and numbers
 * questions by index position (NOT DB display_order).
 */
export function serializeConcernCategoryMd(
  subs: ExportConcernCategorySubRow[],
  questions: ExportConcernCategoryQuestionRow[],
  categoryLabel: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${categoryLabel}`);
  lines.push("");

  const qBySubId = new Map<number, ExportConcernCategoryQuestionRow[]>();
  for (const q of questions) {
    const arr = qBySubId.get(q.subcategory_id) ?? [];
    arr.push(q);
    qBySubId.set(q.subcategory_id, arr);
  }

  for (const s of subs) {
    lines.push(`-- ${s.display_label} Checklist --`);
    const qs = qBySubId.get(s.id) ?? [];
    qs.forEach((q, idx) => {
      const prefix = q.multi_select ? "[multi] " : "";
      lines.push(`${idx + 1}. ${prefix}${q.question_text}`);
      if (q.options && q.options.length > 0) {
        // Always emit Label=value form (no shorthand) for unambiguous reparse.
        // The parser tolerates either form, but emitting both shapes from the
        // same input would create export/upload non-determinism.
        const optStr = q.options
          .map((o) => `${o.label}=${o.value}`)
          .join(" | ");
        lines.push(`   - ${optStr}`);
      }
    });
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * DB-reading exporter for one (shop_id, category). Resolves the H1 display
 * label from `concern_category_guidelines.display_label` (canonical), falling
 * back to a title-cased slug when no guideline row exists yet. Reads only
 * ACTIVE rows from both tables (matches the uploader's diff semantics —
 * soft-deleted rows are excluded from the round-trip surface).
 *
 * @returns { md_content, row_count } — row_count is the SUM of sub-categories
 *   + questions returned. row_count === 0 means no active rows for this
 *   (shop, category); the UI may surface an empty-state.
 */
export async function exportConcernCategoryMd(
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

  // Sub-categories (ACTIVE only) for this (shop, category).
  const { data: subRows, error: subErr } = await sb
    .from("concern_subcategories")
    .select("id, slug, display_label, display_order")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (subErr) {
    throw new Error(`concern_subcategories export failed: ${subErr.message}`);
  }
  const subs = (subRows ?? []) as ExportConcernCategorySubRow[];

  // Questions (ACTIVE only) for this (shop, category). Grouped by
  // subcategory_id at serialize time.
  const { data: qRows, error: qErr } = await sb
    .from("concern_questions")
    .select("subcategory_id, question_text, display_order, options, multi_select")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (qErr) {
    throw new Error(`concern_questions export failed: ${qErr.message}`);
  }
  const questions = (qRows ?? []) as ExportConcernCategoryQuestionRow[];

  // Resolve H1 label: prefer the guideline row's display_label (canonical),
  // fall back to a title-cased slug ("warning_light" → "Warning light").
  const { data: guide, error: guideErr } = await sb
    .from("concern_category_guidelines")
    .select("display_label")
    .eq("shop_id", shopId)
    .eq("category", categorySlug)
    .maybeSingle();
  if (guideErr) {
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "concern category label lookup failed",
        category: categorySlug,
        detail: guideErr.message,
      }),
    );
  }
  const categoryLabel = (guide?.display_label as string | undefined) ??
    (categorySlug.charAt(0).toUpperCase() +
      categorySlug.slice(1).replace(/_/g, " "));

  const body = serializeConcernCategoryMd(subs, questions, categoryLabel);

  // Trailing HR + HTML comment are parser-ignored — informational only so
  // a downstream human reader can see what shop/category the file is from.
  const md = [
    body,
    "---",
    "",
    `<!-- exported from concern_subcategories + concern_questions (shop_id=${shopId}, category=${categorySlug}) -->`,
    "",
  ].join("\n");

  return { md_content: md, row_count: subs.length + questions.length };
}
