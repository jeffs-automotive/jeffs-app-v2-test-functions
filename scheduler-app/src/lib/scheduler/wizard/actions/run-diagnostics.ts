"use server";

/**
 * runDiagnosticsV2 — Phase 1 restoration (2026-05-17).
 *
 * Per chat-design.md §7.3 + Chris's 2026-05-17 design clarification:
 * the customer has filled in concern_explanation text for one or more
 * Step 7.1 picks (5 routine requires_explanation chips + the "💬 Other
 * Issue" pseudo-chip). This action runs the diagnostic LLM ONCE per
 * concern in parallel — each call classifies + gap-detects + recommends.
 *
 * Per-concern LLM behaviour (see diagnoseConcern):
 *   - Picks ONE of 20 categories (14 testing services + 6 'other'
 *     subcategories), or returns null when the description doesn't fit.
 *   - Picks a subcategory whose questions match the customer's symptoms.
 *   - Returns the question IDs the description did NOT answer.
 *
 * Aggregation across concerns:
 *   - recommended_testing_services: dedup by service_key, accumulate the
 *     source_concerns[] (which picker chips triggered each recommendation).
 *   - clarification_questions_pending: flat queue across all concerns,
 *     each entry tagged with its source service_key + subcategory.
 *
 * Routing after persist:
 *   - pending queue non-empty → clarification_question (one-card-at-a-time)
 *   - pending empty + recommendations non-empty → testing_service_approval
 *   - pending empty + recommendations empty → second_routine_pass with the
 *     "we'll forward this to a service advisor" Jeff-bubble (all concerns
 *     either matched a 'other' subcategory OR couldn't be categorized)
 *
 * Idempotency: re-invocations after diagnostic_processing_complete=true
 * skip the LLM and re-route based on existing row state. Lets the
 * diagnostic_loading card mount/unmount on refresh without re-running.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import {
  diagnoseConcern,
  type DiagnoseConcernChipHint,
  type DiagnoseConcernResult,
} from "@/lib/scheduler/wizard/llm/diagnose-concern";
import {
  loadDiagnosticCatalog,
  isTestingService,
  type CatalogCategory,
  type CatalogQuestion,
  type DiagnosticCatalog,
} from "@/lib/scheduler/wizard/llm/load-diagnostic-catalog";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { routeAfterDiagnostics } from "@/lib/scheduler/wizard/route-after-diagnostics";
import { ensureConcernSummaries } from "@/lib/scheduler/wizard/ensure-concern-summaries";

const inputSchema = z.object({
  chatId: z.string().min(1),
});

export type RunDiagnosticsV2Args = z.infer<typeof inputSchema>;

const SHOP_ID = 7476;
const OTHER_ISSUE_SERVICE_KEY = "other_issue";

interface ExplanationItem {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category: string | null;
}

interface RecommendedService {
  service_key: string;
  display_name: string;
  description: string | null;
  starting_price_cents: number;
  source_concerns: string[];
}

interface PendingQuestionEntry {
  question_id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  service_key: string;
  category: string;
  subcategory_slug: string;
  /** Mirrors `concern_questions.multi_select` so the card knows whether
   *  to render multi-chip + Continue (true) or single-tap-to-submit
   *  (false). Added 2026-05-18 with the CAT-2 catalog rebuild. */
  multi_select: boolean;
}

function parseExplanationItems(raw: unknown): ExplanationItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const service_key =
        typeof obj.service_key === "string" ? obj.service_key : null;
      const display_name =
        typeof obj.display_name === "string" ? obj.display_name : service_key;
      const explanation_text =
        typeof obj.explanation_text === "string" ? obj.explanation_text : "";
      if (!service_key) return null;
      const category =
        typeof obj.category === "string" && obj.category.length > 0
          ? obj.category
          : null;
      return {
        service_key,
        display_name: display_name ?? service_key,
        explanation_text,
        category,
      } satisfies ExplanationItem;
    })
    .filter((x): x is ExplanationItem => x !== null);
}

function parseVehicleNotes(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.notes === "string" && obj.notes.trim().length > 0) {
    return obj.notes;
  }
  return null;
}

function parseRecommendedServices(raw: unknown): RecommendedService[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const service_key =
        typeof obj.service_key === "string" ? obj.service_key : null;
      const display_name =
        typeof obj.display_name === "string" ? obj.display_name : null;
      const starting_price_cents =
        typeof obj.starting_price_cents === "number"
          ? obj.starting_price_cents
          : null;
      if (!service_key || !display_name || starting_price_cents === null) {
        return null;
      }
      const description =
        typeof obj.description === "string" ? obj.description : null;
      const source_concerns = Array.isArray(obj.source_concerns)
        ? (obj.source_concerns as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      return {
        service_key,
        display_name,
        description,
        starting_price_cents,
        source_concerns,
      } satisfies RecommendedService;
    })
    .filter((x): x is RecommendedService => x !== null);
}

function parsePendingQuestions(raw: unknown): PendingQuestionEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const question_id =
        typeof obj.question_id === "number" ? obj.question_id : null;
      const question_text =
        typeof obj.question_text === "string" ? obj.question_text : null;
      if (question_id === null || question_text === null) return null;
      const optsRaw = Array.isArray(obj.options) ? obj.options : [];
      const options = optsRaw
        .map((o) => {
          if (!o || typeof o !== "object") return null;
          const oo = o as Record<string, unknown>;
          return typeof oo.label === "string" && typeof oo.value === "string"
            ? { label: oo.label, value: oo.value }
            : null;
        })
        .filter((x): x is { label: string; value: string } => x !== null);
      const service_key =
        typeof obj.service_key === "string" ? obj.service_key : "";
      const category =
        typeof obj.category === "string" ? obj.category : "other";
      const subcategory_slug =
        typeof obj.subcategory_slug === "string" ? obj.subcategory_slug : "";
      const multi_select = obj.multi_select === true;
      return {
        question_id,
        question_text,
        options,
        service_key,
        category,
        subcategory_slug,
        multi_select,
      } satisfies PendingQuestionEntry;
    })
    .filter((x): x is PendingQuestionEntry => x !== null);
}

/**
 * Routine-chip → concern_categories[] map for the 5 requires_explanation
 * routine chips. Lets us build the LLM chip hint without a separate DB
 * trip per concern. Pulled live from routine_services at action start;
 * cached only for the duration of one runDiagnostics call.
 */
async function loadRoutineChipConcernCategories(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("routine_services")
    .select("service_key, concern_categories")
    .eq("shop_id", SHOP_ID)
    .eq("active", true)
    .eq("requires_explanation", true);
  if (error) {
    Sentry.captureMessage(
      "run_diagnostics_v2 routine_services chip-hint lookup failed",
      { level: "warning", extra: { error: error.message } },
    );
    return new Map();
  }
  const out = new Map<string, string[]>();
  for (const row of (data ?? []) as Array<{
    service_key: string;
    concern_categories: string[] | null;
  }>) {
    out.set(row.service_key, row.concern_categories ?? []);
  }
  return out;
}

function buildChipHint(
  item: ExplanationItem,
  routineChipCats: Map<string, string[]>,
  catalog: DiagnosticCatalog,
): DiagnoseConcernChipHint | null {
  if (item.service_key === OTHER_ISSUE_SERVICE_KEY) {
    return {
      chip_service_key: OTHER_ISSUE_SERVICE_KEY,
      chip_display_name: item.display_name,
      chip_concern_categories: [],
    };
  }
  const routineCats = routineChipCats.get(item.service_key);
  if (routineCats !== undefined) {
    return {
      chip_service_key: item.service_key,
      chip_display_name: item.display_name,
      chip_concern_categories: routineCats,
    };
  }
  // Defensive — testing-service-keyed concerns (shouldn't happen in the
  // current picker but kept for backward compat). Pull concern_categories
  // from the catalog rather than a fresh DB hit.
  for (const c of catalog.categories) {
    if (isTestingService(c) && c.service_key === item.service_key) {
      return {
        chip_service_key: item.service_key,
        chip_display_name: item.display_name,
        chip_concern_categories: c.concern_categories,
      };
    }
  }
  return null;
}

/**
 * Look up a question record (text + options) by its ID across the
 * catalog. Used when turning LLM-returned IDs into pending queue
 * entries with the human-facing fields.
 */
function findQuestionInCatalog(
  catalog: DiagnosticCatalog,
  matchedCat: CatalogCategory,
  subcategorySlug: string,
  question_id: number,
): CatalogQuestion | null {
  if (matchedCat.kind === "other_subcategory") {
    if (matchedCat.subcategory_slug !== subcategorySlug) return null;
    return matchedCat.questions.find((q) => q.id === question_id) ?? null;
  }
  const sub = matchedCat.subcategories.find((s) => s.slug === subcategorySlug);
  if (!sub) return null;
  return sub.questions.find((q) => q.id === question_id) ?? null;
}

async function runDiagnosticsV2Impl(
  args: RunDiagnosticsV2Args,
): Promise<WizardTransitionResult> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId } = parsed.data;

  try {
    return await runDiagnosticsBody(chatId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "run_diagnostics_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "run_diagnostics_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, error: msg };
  }
}

async function runDiagnosticsBody(
  chatId: string,
): Promise<WizardTransitionResult> {
  const supabase = createSupabaseAdminClient();

  const { data: row, error: rowErr } = await supabase
    .from("customer_chat_sessions")
    .select(
      "id, explanation_required_items, new_vehicle_info, diagnostic_processing_complete, clarification_questions_pending, recommended_testing_services",
    )
    .eq("id", chatId)
    .maybeSingle();

  if (rowErr || !row) {
    const msg = rowErr?.message ?? "session_not_found";
    Sentry.captureMessage("run_diagnostics_v2 row load failed", {
      level: "error",
      extra: { chatId, error: msg },
    });
    return { ok: false, error: msg };
  }

  // Idempotency — diagnostic_processing_complete=true means the LLM
  // already ran for this session's current explanation queue. Just
  // re-route based on the persisted pending + recommendation state.
  if (row.diagnostic_processing_complete) {
    const existingPending = parsePendingQuestions(
      (row as Record<string, unknown>).clarification_questions_pending,
    );
    const existingRecs = parseRecommendedServices(
      (row as Record<string, unknown>).recommended_testing_services,
    );
    const { nextStep, jeffBubble } = routeAfterDiagnostics({
      pending_count: existingPending.length,
      recommendation_count: existingRecs.length,
    });
    return applyWizardTransition({ chatId, nextStep, jeffBubble });
  }

  const items = parseExplanationItems(row.explanation_required_items);
  const vehicleNotes = parseVehicleNotes(row.new_vehicle_info);

  if (items.length === 0) {
    // No concerns to process — skip directly to second_routine_pass.
    return applyWizardTransition({
      chatId,
      updates: {
        diagnostic_processing_complete: true,
        clarification_questions_pending: [],
        recommended_testing_services: [],
      },
      nextStep: "second_routine_pass",
    });
  }

  // ── Load supporting context in parallel ──────────────────────────────
  const [catalog, routineChipCats] = await Promise.all([
    loadDiagnosticCatalog(supabase),
    loadRoutineChipConcernCategories(supabase),
  ]);

  // ── Per-concern LLM call in parallel ─────────────────────────────────
  const perConcernResults = await Promise.all(
    items.map(async (item): Promise<{
      item: ExplanationItem;
      result: DiagnoseConcernResult;
      matchedCat: CatalogCategory | null;
    }> => {
      const hint = buildChipHint(item, routineChipCats, catalog);
      const result = await diagnoseConcern({
        catalog,
        customer_description: item.explanation_text,
        customer_chip_hint: hint,
        vehicle_notes: vehicleNotes,
      });
      // Observability — record per-concern outcome to Sentry so we can
      // see what the LLM is doing in production (testing-service match
      // vs 'other'-subcategory match vs null-match, plus parse_ok +
      // token usage). One breadcrumb per concern; the aggregate
      // route-decision is captured separately below.
      Sentry.addBreadcrumb({
        category: "scheduler.diagnose",
        type: "info",
        level: "info",
        message: `diagnoseConcern: ${item.service_key} → ${result.matched_kind ?? "null"}:${result.matched_category_key ?? "none"}`,
        data: {
          chip_service_key: item.service_key,
          description_chars: item.explanation_text.length,
          matched_kind: result.matched_kind,
          matched_category_key: result.matched_category_key,
          matched_subcategory_slug: result.matched_subcategory_slug,
          recommended_service_key: result.recommended_testing_service?.service_key ?? null,
          unanswered_count: result.unanswered_question_ids.length,
          parsed_ok: result.parsed_ok,
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
          latency_ms: result.latency_ms,
          error_message: result.error_message,
        },
      });
      // TEMP DEBUG (2026-05-21): write the diagnose result to scheduler_audit_log
      // so we can read it back via SQL. Production wizard is silently dropping
      // recommendations even when the edge-function mirror with the same input
      // returns valid matches — need the actual stage1/stage2 outcomes to
      // diagnose. Remove this block once the bug is fixed.
      try {
        await supabase.from("scheduler_audit_log").insert({
          session_id: chatId,
          step: "service_concern_picker",
          event_type: "diagnose_concern_result_debug",
          event_detail: {
            chip_service_key: item.service_key,
            description_chars: item.explanation_text.length,
            description_preview: item.explanation_text.slice(0, 200),
            matched_kind: result.matched_kind,
            matched_category_key: result.matched_category_key,
            matched_subcategory_slug: result.matched_subcategory_slug,
            recommended_service_key: result.recommended_testing_service?.service_key ?? null,
            unanswered_count: result.unanswered_question_ids.length,
            stage1_confidence: result.stage1_confidence,
            stage2_confidence: result.stage2_confidence,
            stage3_confidence: result.stage3_confidence,
            parsed_ok: result.parsed_ok,
            extracted_facts_present: result.extracted_facts !== null,
            tokens_in: result.tokens_in,
            tokens_out: result.tokens_out,
            latency_ms: result.latency_ms,
            error_message_truncated: (result.error_message ?? "").slice(0, 500),
            catalog_size: catalog.categories.length,
          },
          model_used: result.model,
          latency_ms: result.latency_ms,
          input_tokens: result.tokens_in,
          output_tokens: result.tokens_out,
          error_message: result.error_message,
        });
      } catch (auditErr) {
        // Audit failure must never break the wizard flow.
        Sentry.captureException(auditErr, {
          tags: { surface: "diagnose_debug_audit" },
          level: "warning",
        });
      }
      // Find the matched category record for question lookup. We re-walk
      // the catalog here (cheap — ≤20 entries) rather than expose it from
      // diagnoseConcern's signature.
      let matchedCat: CatalogCategory | null = null;
      if (result.matched_category_key) {
        for (const c of catalog.categories) {
          if (
            (c.kind === "testing_service" &&
              c.service_key === result.matched_category_key) ||
            (c.kind === "other_subcategory" &&
              c.subcategory_slug === result.matched_category_key)
          ) {
            matchedCat = c;
            break;
          }
        }
      }
      return { item, result, matchedCat };
    }),
  );

  // ── Aggregate recommendations ────────────────────────────────────────
  const recsByService = new Map<string, RecommendedService>();
  for (const r of perConcernResults) {
    const rec = r.result.recommended_testing_service;
    if (!rec) continue;
    const existing = recsByService.get(rec.service_key);
    if (existing) {
      if (!existing.source_concerns.includes(r.item.service_key)) {
        existing.source_concerns.push(r.item.service_key);
      }
      continue;
    }
    recsByService.set(rec.service_key, {
      service_key: rec.service_key,
      display_name: rec.display_name,
      description: rec.description,
      starting_price_cents: rec.starting_price_cents,
      source_concerns: [r.item.service_key],
    });
  }
  const recommended_testing_services: RecommendedService[] = Array.from(
    recsByService.values(),
  );

  // ── Aggregate pending questions ──────────────────────────────────────
  const pending: PendingQuestionEntry[] = [];
  // Per-concern question_id list — also persisted on each
  // explanation_required_items entry so ensureConcernSummaries can
  // group the answered Q&A back to its source concern after the queue
  // drains. (Without this map, summaries would have to re-derive the
  // grouping via subcategory→category→source, which is heuristic when
  // two concerns hit the same category.)
  const perItemQuestionIds = new Map<string, number[]>();
  for (const r of perConcernResults) {
    if (!r.matchedCat || !r.result.matched_subcategory_slug) continue;
    const subSlug = r.result.matched_subcategory_slug;
    const parentCategory =
      r.matchedCat.kind === "testing_service"
        ? // Find which concern_subcategory.category the subcategory belongs to.
          r.matchedCat.subcategories.find((s) => s.slug === subSlug)
            ?.concern_category ?? "other"
        : "other";
    const idsForConcern: number[] = [];
    for (const qid of r.result.unanswered_question_ids) {
      const q = findQuestionInCatalog(catalog, r.matchedCat, subSlug, qid);
      if (!q) continue;
      pending.push({
        question_id: q.id,
        question_text: q.question_text,
        options: q.options,
        service_key: r.item.service_key,
        category: parentCategory,
        subcategory_slug: subSlug,
        multi_select: q.multi_select,
      });
      idsForConcern.push(q.id);
    }
    if (idsForConcern.length > 0) {
      perItemQuestionIds.set(r.item.service_key, idsForConcern);
    }
  }

  // Annotate each explanation_required_items entry with the question_ids
  // it queued. This is the canonical "which questions belong to this
  // concern" record consumed later by ensureConcernSummaries.
  const updatedExplanationItems = items.map((item) => ({
    service_key: item.service_key,
    display_name: item.display_name,
    explanation_text: item.explanation_text,
    category: item.category,
    unanswered_question_ids:
      perItemQuestionIds.get(item.service_key) ?? [],
  }));

  // ── Persist + advance ────────────────────────────────────────────────
  const { nextStep, jeffBubble } = routeAfterDiagnostics({
    pending_count: pending.length,
    recommendation_count: recommended_testing_services.length,
  });

  // Aggregate outcome telemetry — info-level so Sentry samples it but
  // it's queryable when we need to know how often the forward-to-advisor
  // path is firing vs the recommendation path.
  Sentry.captureMessage(
    `runDiagnostics: ${items.length} concern(s) → ${nextStep}`,
    {
      level: "info",
      tags: {
        surface: "run_diagnostics_v2_outcome",
        next_step: nextStep,
      },
      extra: {
        chatId,
        concern_count: items.length,
        recommendation_count: recommended_testing_services.length,
        pending_question_count: pending.length,
        per_concern: perConcernResults.map((r) => ({
          chip: r.item.service_key,
          matched_kind: r.result.matched_kind,
          matched_category_key: r.result.matched_category_key,
          parsed_ok: r.result.parsed_ok,
          error_message: r.result.error_message,
        })),
      },
    },
  );
  // Generate concern summaries NOW if there are no clarification
  // questions queued for the customer — the wizard skips straight to the
  // testing-service-approval card and we need summaries ready for the
  // Tekmetric description builder. When pending is non-empty, summaries
  // are deferred to submit-clarification-answer's queue-drain branch.
  const transitionResult = await applyWizardTransition({
    chatId,
    updates: {
      diagnostic_processing_complete: true,
      explanation_required_items: updatedExplanationItems,
      clarification_questions_pending: pending,
      clarification_questions_answered: {},
      recommended_testing_services,
    },
    nextStep,
    jeffBubble,
  });
  if (pending.length === 0) {
    // Fire-and-forget? No — we want summaries persisted before the
    // customer reaches submit. Await it. Cost is one Haiku call per
    // concern (~500ms each, parallel) which is acceptable here since
    // the customer is about to read the recommendation card anyway.
    await ensureConcernSummaries({ chatId });
  }
  return transitionResult;
}

export const runDiagnosticsV2 = wrapAction(
  "runDiagnosticsV2",
  runDiagnosticsV2Impl,
);
