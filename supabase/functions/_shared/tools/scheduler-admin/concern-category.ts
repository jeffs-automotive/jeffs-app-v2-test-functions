// concern-category — scheduler admin surface.
// Extracted from scheduler-admin.ts (file-size-refactor). Mechanical split —
// no logic changes. Public API preserved via ./index.ts + the re-export shim.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeCanonicalAfterState,
  computeConfirmToken,
  parseConcernCategoryMd,
  sha256Hex,
  type ParsedConcernSubcategory,
} from "../../scheduler-admin-md.ts";
import { _logAuditError, classifyApplyRpcError, checkDuplicate, type ValidationFinding, type AdminAudit, type UploadResult } from "./_shared.ts";

// ─── Concern category MD upload (Pattern S — E5e) ───────────────────────────
//
// Refactored 2026-05-26 per PLAN §4.2 + R6-B3 + E1b-N1 + E1cf-N4 — snapshot_kind
// = 'concern_questions_per_category'. Apply RPC: apply_concern_category_upload
// (migration 20260526000500).
//
// Significant rewrite: legacy code INTERLEAVED diff + apply across two tables
// (concern_subcategories + concern_questions). New design: parse → fetch BOTH
// tables → build NESTED diff (subcategories + questions, each with
// added/modified/deactivated) → compute confirm_token → dry-run early return
// → else call apply RPC.
//
// Per E1cf-N4 the p_diff shape is:
//   {
//     subcategories: { added: SubcategoryRow[], modified: SubcategoryRow[], deactivated: [<id>] },
//     questions:     { added: QuestionWithSlug[], modified: QuestionRow[], deactivated: [<id>] }
//   }
// where QuestionWithSlug = QuestionRow & { slug_of_sub: string } — the apply
// RPC uses slug_of_sub to resolve subcategory_id for newly-INSERTed subs.
//
// Per E1b-N1 snapshot fields are EXACTLY:
//   subcategories_before, added_subcategory_ids,
//   questions_before, added_question_ids
// (the canonical_state + revert handler read these by name).

export const CONCERN_CATEGORY_SLUGS = [
  "noise",
  "vibration",
  "pulling",
  "smell",
  "smoke",
  "leak",
  "warning_light",
  "performance",
  "electrical",
  "hvac",
  "brakes",
  "steering",
  "tires",
  "other",
] as const;

export type ConcernCategorySlug = (typeof CONCERN_CATEGORY_SLUGS)[number];

interface SubcategoryRow {
  id: number;
  slug: string;
  display_label: string;
  display_order: number;
  active: boolean;
  /** Preserved during MODIFY — apply RPC's UPDATE sets ALL columns, so omitting
   *  these from the modified payload would NULL them out. Fetched + carried
   *  forward unchanged unless the MD format ever supports editing them. */
  description?: string | null;
  positive_examples?: string[] | null;
  negative_examples?: string[] | null;
  synonyms?: string[] | null;
  eligible_testing_service_keys?: string[] | null;
}

interface ConcernQuestionRow {
  id: number;
  subcategory_id: number | null;
  question_text: string;
  display_order: number;
  active: boolean;
  /** JSONB column — array of {label, value}. Fetched + diffed against the
   *  parsed MD options so the upload tool only writes when the MD's
   *  options actually changed. Added 2026-05-18 with the CAT-2 catalog
   *  rebuild + new MD format. */
  options?: unknown;
  multi_select?: boolean;
  /** Preserved during MODIFY — same rationale as SubcategoryRow descriptive
   *  fields above. required_facts is ORDERED (MD-order preserved per ADR-025
   *  canonical_state_question_required_facts_v2). */
  required_facts?: string[] | null;
}

// Default-options for new questions (the multiple-choice card needs at
// least one option even when the MD didn't supply one). Plain yes/no/skip
// is the safe initial set; advisors revise via upsertConcernQuestionOptions
// or future MD format extensions.
const DEFAULT_OPTIONS_VALUE: Array<{ label: string; value: string }> = [
  { label: "Yes", value: "yes" },
  { label: "No", value: "no" },
  { label: "Sometimes / Not sure", value: "sometimes" },
];

/** Order-sensitive deep-equal for option arrays. */
function optionsEqualOrder(
  a: unknown,
  b: Array<{ label: string; value: string }>,
): boolean {
  if (!Array.isArray(a)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const aEntry = a[i];
    const bEntry = b[i];
    if (!aEntry || typeof aEntry !== "object" || !bEntry) return false;
    const ao = aEntry as Record<string, unknown>;
    if (ao.label !== bEntry.label || ao.value !== bEntry.value) return false;
  }
  return true;
}

export async function uploadConcernCategoryMd(
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
  const tableName = "concern_questions";
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

  // ── 1. Parse the MD doc
  let parsed;
  try {
    parsed = parseConcernCategoryMd(md_content);
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

  const totalQuestions = parsed.subcategories.reduce(
    (sum, s) => sum + s.questions.length,
    0,
  );

  // ── 2. Fetch current state for this (shop_id, category)
  // Select ALL descriptive columns so MODIFIED rows can preserve them — the
  // apply RPC's UPDATE sets every column; omitting one would NULL it out.
  const { data: subRowsData, error: subFetchErr } = await sb
    .from("concern_subcategories")
    .select(
      "id, slug, display_label, display_order, active, description, positive_examples, negative_examples, synonyms, eligible_testing_service_keys",
    )
    .eq("shop_id", shopId)
    .eq("category", categorySlug);
  if (subFetchErr) {
    const msg = `concern_subcategories fetch failed: ${subFetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }
  const currentSubs = (subRowsData ?? []) as unknown as SubcategoryRow[];

  const { data: qRowsData, error: qFetchErr } = await sb
    .from("concern_questions")
    .select(
      "id, subcategory_id, question_text, display_order, active, options, multi_select, required_facts",
    )
    .eq("shop_id", shopId)
    .eq("category", categorySlug);
  if (qFetchErr) {
    const msg = `concern_questions fetch failed: ${qFetchErr.message}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }
  const currentQuestions = (qRowsData ?? []) as unknown as ConcernQuestionRow[];

  // ── 3. Build the NESTED diff (no writes)
  // currentSubBySlug: existing subcategories for this category, keyed by slug
  // mdSubBySlug:      parsed MD subcategories, keyed by slug
  const currentSubBySlug = new Map<string, SubcategoryRow>();
  for (const s of currentSubs) currentSubBySlug.set(s.slug, s);
  const mdSubBySlug = new Map<string, ParsedConcernSubcategory>();
  for (const s of parsed.subcategories) mdSubBySlug.set(s.slug, s);

  // Existing question lookup by (subcategory_id, question_text)
  const currentQByKey = new Map<string, ConcernQuestionRow>();
  for (const q of currentQuestions) {
    if (q.subcategory_id !== null) {
      currentQByKey.set(`${q.subcategory_id}::${q.question_text}`, q);
    }
  }

  // ── 3a. Subcategory diff
  const subAdded: Array<Record<string, unknown>> = [];
  const subModified: Array<Record<string, unknown>> = [];
  const subDeactivated: number[] = [];
  const subcategoriesBefore: Record<string, SubcategoryRow> = {};

  for (const mdSub of parsed.subcategories) {
    const existing = currentSubBySlug.get(mdSub.slug);
    if (existing) {
      const needsUpdate =
        existing.display_label !== mdSub.display_label ||
        existing.display_order !== mdSub.display_order ||
        existing.active !== true;
      if (needsUpdate) {
        // Apply RPC SETs every column — preserve descriptive fields by passing
        // existing values through unchanged (MD format doesn't carry them).
        subModified.push({
          id: existing.id,
          slug: mdSub.slug,
          display_label: mdSub.display_label,
          display_order: mdSub.display_order,
          active: true,
          description: existing.description ?? null,
          positive_examples: existing.positive_examples ?? null,
          negative_examples: existing.negative_examples ?? null,
          synonyms: existing.synonyms ?? null,
          eligible_testing_service_keys: existing.eligible_testing_service_keys ?? null,
        });
        subcategoriesBefore[String(existing.id)] = existing;
      }
    } else {
      // New subcategory — apply RPC INSERTs + resolves id by slug for any
      // questions referencing it via slug_of_sub. Descriptive fields default
      // to NULL on insert (matches legacy uploader behavior).
      subAdded.push({
        slug: mdSub.slug,
        display_label: mdSub.display_label,
        display_order: mdSub.display_order,
        active: true,
      });
    }
  }
  for (const existing of currentSubs) {
    if (!mdSubBySlug.has(existing.slug) && existing.active) {
      subDeactivated.push(existing.id);
      subcategoriesBefore[String(existing.id)] = existing;
    }
  }

  // ── 3b. Question diff (per-sub, identified by slug_of_sub)
  // For modified questions: they live under an EXISTING sub, so subcategory_id
  // is known. For added questions: they may live under either an existing OR
  // newly-INSERTed sub — we carry slug_of_sub so apply RPC resolves.
  const qAdded: Array<Record<string, unknown>> = [];
  const qModified: Array<Record<string, unknown>> = [];
  const qDeactivated: number[] = [];
  const questionsBefore: Record<string, ConcernQuestionRow> = {};

  // Build slug→existing-sub-id lookup (existing subs only — added subs have
  // no id yet, but the apply RPC resolves those at insert time via the
  // v_sub_id_by_slug JSONB).
  const existingSubIdBySlug = new Map<string, number>();
  for (const s of currentSubs) existingSubIdBySlug.set(s.slug, s.id);

  const seenExistingQIds = new Set<number>();

  for (const mdSub of parsed.subcategories) {
    const existingSubId = existingSubIdBySlug.get(mdSub.slug);
    for (const q of mdSub.questions) {
      // Default options when MD didn't supply any (legacy MDs).
      const effectiveOptions =
        q.options !== undefined ? q.options : DEFAULT_OPTIONS_VALUE;
      const effectiveMultiSelect = q.multi_select === true;

      // Existing question? Only possible when the sub already exists (and
      // has an id we can match against).
      let existingQ: ConcernQuestionRow | undefined;
      if (existingSubId !== undefined) {
        existingQ = currentQByKey.get(`${existingSubId}::${q.question_text}`);
      }

      if (existingQ) {
        seenExistingQIds.add(existingQ.id);
        // Determine if any field changed
        const needsUpdate =
          existingQ.display_order !== q.display_order ||
          existingQ.active !== true ||
          (q.options !== undefined &&
            !optionsEqualOrder(existingQ.options, q.options)) ||
          (q.multi_select !== undefined &&
            existingQ.multi_select !== q.multi_select);
        if (needsUpdate) {
          // For modified questions we have a known subcategory_id (existing
          // sub). Include slug_of_sub for symmetry + future-proofing (apply
          // RPC uses it as a defensive resolver). Preserve required_facts
          // by passing the existing value — apply RPC SETs every column.
          qModified.push({
            id: existingQ.id,
            slug_of_sub: mdSub.slug,
            subcategory_id: existingSubId,
            question_text: q.question_text,
            options:
              q.options !== undefined ? q.options : (existingQ.options ?? DEFAULT_OPTIONS_VALUE),
            multi_select:
              q.multi_select !== undefined
                ? q.multi_select
                : (existingQ.multi_select ?? false),
            display_order: q.display_order,
            active: true,
            required_facts: existingQ.required_facts ?? null,
          });
          questionsBefore[String(existingQ.id)] = existingQ;
        }
      } else {
        // New question — apply RPC resolves subcategory_id via slug_of_sub.
        qAdded.push({
          slug_of_sub: mdSub.slug,
          question_text: q.question_text,
          options: effectiveOptions,
          multi_select: effectiveMultiSelect,
          display_order: q.display_order,
          active: true,
        });
      }
    }
  }

  // Soft-delete questions no longer in MD (only consider questions tied to
  // a known subcategory).
  for (const q of currentQuestions) {
    if (q.subcategory_id !== null && !seenExistingQIds.has(q.id) && q.active) {
      qDeactivated.push(q.id);
      questionsBefore[String(q.id)] = q;
    }
  }

  // ── 4. Build snapshot per E1b-N1 EXACT field names
  // (subcategories_before, added_subcategory_ids, questions_before,
  //  added_question_ids). category_slug is also injected so canonical_state
  // can derive the per-category scope without grovelling row data.
  const snapshotBase: Record<string, unknown> = {
    snapshot_kind: "concern_questions_per_category",
    category_slug: categorySlug,
    subcategories_before: subcategoriesBefore,
    added_subcategory_ids: [] as number[],
    questions_before: questionsBefore,
    added_question_ids: [] as number[],
  };

  // ── 5. Canonical-current + hash (requires category_slug — see R6-B3)
  let expectedCurrentHash: string;
  try {
    const canonicalCurrent = await computeCanonicalAfterState({
      kind: "concern_questions_per_category",
      supabase: sb,
      shopId,
      snapshot: snapshotBase,
    });
    expectedCurrentHash = await sha256Hex(canonicalCurrent);
  } catch (e) {
    const msg = `canonical_state_concern_category_upload compute failed: ${e instanceof Error ? e.message : String(e)}`;
    if (!dry_run) await _logAuditError(sb, shopId, audit, tableName, hash, msg);
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      dry_run,
      error_message: msg,
    };
  }

  // ── 6. confirm_token via E2 helper (per-category kind REQUIRES categorySlug)
  const confirm_token = await computeConfirmToken({
    shopId,
    kind: "concern_questions_per_category",
    expectedCurrentHash,
    mdContentHash: hash,
    actorEmail: audit.display_name,
    categorySlug,
  });

  // ── 7. Build diff_summary (surfaces[] = BOTH physical tables per E1f apply RPC)
  // Surface advisor-visible warning about DEFAULT_OPTIONS injection for new
  // questions whose MD didn't carry options.
  const defaultedQuestionKeys: string[] = [];
  for (const mdSub of parsed.subcategories) {
    for (const q of mdSub.questions) {
      if (q.options === undefined) {
        // Only counts as "defaulted" if it would be an INSERT (not an
        // existing row preserving its options).
        const subId = existingSubIdBySlug.get(mdSub.slug);
        const existing = subId !== undefined
          ? currentQByKey.get(`${subId}::${q.question_text}`)
          : undefined;
        if (!existing) {
          defaultedQuestionKeys.push(`${mdSub.slug}::${q.question_text}`);
        }
      }
    }
  }
  const validationWarnings: ValidationFinding[] = [];
  for (const key of defaultedQuestionKeys) {
    validationWarnings.push({
      key,
      field: "options",
      level: "warning",
      message:
        "MD did not supply options — apply will inject default [Yes / No / Sometimes-Not-sure]. Add an options line in the MD to override.",
    });
  }

  const diffSummary: Record<string, unknown> = {
    surfaces: ["concern_subcategories", "concern_questions"],
    category_slug: categorySlug,
    display_label: parsed.display_label,
    subcategories: {
      added: subAdded.map((s) => s.slug),
      modified: subModified.map((s) => s.slug),
      deactivated_ids: subDeactivated,
      total_in_md: parsed.subcategories.length,
    },
    questions: {
      added: qAdded.map((q) => `${q.slug_of_sub}::${q.question_text}`),
      modified: qModified.map((q) => `${q.slug_of_sub}::${q.question_text}`),
      deactivated_ids: qDeactivated,
      total_in_md: totalQuestions,
    },
  };

  // ── 8. Dry-run path
  if (dry_run) {
    return {
      ok: true,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: subAdded.length + qAdded.length,
      rows_modified: subModified.length + qModified.length,
      rows_deactivated: subDeactivated.length + qDeactivated.length,
      validation_warnings: validationWarnings.length > 0 ? validationWarnings : undefined,
      diff_summary: diffSummary,
      dry_run: true,
      confirm_token,
    };
  }

  // ── 9. Apply mode — call apply_concern_category_upload RPC
  const pAudit: Record<string, unknown> = {
    actor_email: audit.display_name,
    oauth_client_id: audit.oauth_client_id,
    md_content_hash: hash,
    expected_current_hash: expectedCurrentHash,
    expected_confirm_token: expected_confirm_token ?? null,
    dry_run: false,
  };
  // Per E1cf-N4 the apply RPC expects nested shape with slug_of_sub on
  // every question (added + modified).
  const pDiff: Record<string, unknown> = {
    subcategories: {
      added: subAdded,
      modified: subModified,
      deactivated: subDeactivated.map((id) => String(id)),
    },
    questions: {
      added: qAdded,
      modified: qModified,
      deactivated: qDeactivated.map((id) => String(id)),
    },
  };

  const { data: auditLogId, error: rpcErr } = await sb.rpc(
    "apply_concern_category_upload",
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
      msg: "apply_concern_category_upload_failed",
      shop_id: shopId,
      category_slug: categorySlug,
      reason_code,
      detail: rpcErr.message,
    }));
    return {
      ok: false,
      table_name: tableName,
      md_content_hash: hash,
      rows_parsed: totalQuestions,
      rows_added: 0,
      rows_modified: 0,
      rows_deactivated: 0,
      validation_warnings: validationWarnings.length > 0 ? validationWarnings : undefined,
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
    rows_parsed: totalQuestions,
    rows_added: subAdded.length + qAdded.length,
    rows_modified: subModified.length + qModified.length,
    rows_deactivated: subDeactivated.length + qDeactivated.length,
    validation_warnings: validationWarnings.length > 0 ? validationWarnings : undefined,
    diff_summary: diffSummary,
    dry_run: false,
    confirm_token,
    audit_log_id: (auditLogId as number | null) ?? undefined,
  };
}
