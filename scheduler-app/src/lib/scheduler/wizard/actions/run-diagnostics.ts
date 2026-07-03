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
import type { WizardStep } from "@/lib/scheduler/session-state";
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
import {
  applyConfidenceGate,
  overAskQuestionIds,
  type ConfidenceGateOutcome,
} from "@/lib/scheduler/wizard/confidence-gate";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { routeAfterDiagnostics } from "@/lib/scheduler/wizard/route-after-diagnostics";
import { ensureConcernSummaries } from "@/lib/scheduler/wizard/ensure-concern-summaries";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

const inputSchema = z.object({
  chatId: z.string().min(1),
});

export type RunDiagnosticsV2Args = z.infer<typeof inputSchema>;

const OTHER_ISSUE_SERVICE_KEY = "other_issue";

/**
 * Act-or-ask AO2c (2026-07-03): the chip-card step shown when a concern's
 * Stage 1 returned 2-3 ranked candidates.
 *
 * TODO(AO4 — wizard task): 'concern_clarify' is NOT yet a member of
 * WIZARD_STEPS. It can't be added here because get-current-card.ts (and
 * the card-payload/WizardSurface switches) carry `never` exhaustiveness
 * checks — adding the member without the card arms breaks typecheck, and
 * those files belong to the wizard task. Until AO4 lands, sessions that
 * reach this step render no card (get-current-card falls through to its
 * default → null), which is acceptable pre-ship since AO2+AO4 deploy
 * together. The double-cast below is removed by AO4 when the step joins
 * WIZARD_STEPS.
 */
const CONCERN_CLARIFY_STEP = "concern_clarify" as unknown as WizardStep;

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

// ─── Act-or-ask clarify candidates (AO2c, 2026-07-03) ───────────────────────
//
// When diagnoseConcern returns requires_clarification (Stage 1 produced
// 2-3 ranked candidates), the concern is NOT gated/aggregated into
// recommendations/questions. Instead one ConcernClarifyEntry per such
// concern is persisted to customer_chat_sessions.concern_clarify_candidates
// (JSONB) and the wizard routes to the concern_clarify chip card. The
// customer's tap resolves DETERMINISTICALLY from the precomputed
// per-candidate S2+S3 payloads — no second LLM call, no second spinner.

interface ClarifyCandidateOption {
  key: string;
  kind: "testing_service" | "other_subcategory";
  display_name: string;
  /** null for 'other' (advisor-handoff) candidates — they carry no fee. */
  starting_price_cents: number | null;
  /** First sentence of the catalog description only (chip-card sized). */
  description: string | null;
  /** Precomputed Stage-2/Stage-3 outcome for this candidate, persisted so
   *  the tap resolution can rebuild the normal pipeline outputs. */
  precomputed: {
    matched_subcategory_slug: string | null;
    unanswered_question_ids: number[];
  };
}

interface ConcernClarifyEntry {
  concern_index: number;
  /** The explanation item's picker-chip service_key (source concern id). */
  service_key: string;
  concern_text: string;
  candidates: ClarifyCandidateOption[];
}

/** First sentence of a description (chip-card sized). Falls back to the
 *  whole (trimmed) text when no sentence terminator is found. */
function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const match = trimmed.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : trimmed).trim();
}

function parseClarifyEntries(raw: unknown): ConcernClarifyEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ConcernClarifyEntry =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).service_key === "string" &&
      Array.isArray((entry as Record<string, unknown>).candidates),
  );
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
      "id, explanation_required_items, new_vehicle_info, diagnostic_processing_complete, clarification_questions_pending, recommended_testing_services, concern_clarify_candidates",
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
    // Act-or-ask AO2c: unresolved clarify candidates take priority over
    // the standard routing — the customer still owes us a chip tap. The
    // clarify-resolution action clears the column when it merges the
    // chosen candidate, so a non-empty array means "still pending".
    const existingClarify = parseClarifyEntries(
      (row as Record<string, unknown>).concern_clarify_candidates,
    );
    if (existingClarify.length > 0) {
      return applyWizardTransition({ chatId, nextStep: CONCERN_CLARIFY_STEP });
    }
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
        concern_clarify_candidates: [],
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
    items.map(async (item, concernIndex): Promise<{
      item: ExplanationItem;
      result: DiagnoseConcernResult;
      matchedCat: CatalogCategory | null;
      gate: ConfidenceGateOutcome;
      clarify: ConcernClarifyEntry | null;
    }> => {
      const hint = buildChipHint(item, routineChipCats, catalog);
      const raw = await diagnoseConcern({
        catalog,
        customer_description: item.explanation_text,
        customer_chip_hint: hint,
        vehicle_notes: vehicleNotes,
      });
      // Act-or-ask AO2c (2026-07-03): a 2-3-candidate Stage-1 result is
      // NOT gated or aggregated into recommendations/questions. It
      // becomes a ConcernClarifyEntry (with the per-candidate precomputed
      // S2/S3 payloads) that the customer resolves with one chip tap.
      if (raw.requires_clarification) {
        const candidateResults = raw.candidate_results ?? [];
        const options: ClarifyCandidateOption[] = [];
        for (const key of raw.stage1_candidates) {
          let cat: CatalogCategory | null = null;
          for (const c of catalog.categories) {
            if (
              (c.kind === "testing_service" && c.service_key === key) ||
              (c.kind === "other_subcategory" && c.subcategory_slug === key)
            ) {
              cat = c;
              break;
            }
          }
          // diagnoseConcern already validated the keys against this same
          // catalog — defensive skip only.
          if (!cat) continue;
          const cr =
            candidateResults.find((c) => c.category_key === key) ?? null;
          options.push({
            key,
            kind: cat.kind,
            display_name:
              cat.kind === "testing_service"
                ? cat.display_name
                : cat.display_label,
            starting_price_cents:
              cat.kind === "testing_service" ? cat.starting_price_cents : null,
            description:
              cat.kind === "testing_service"
                ? firstSentence(cat.description)
                : null,
            precomputed: {
              matched_subcategory_slug: cr?.matched_subcategory_slug ?? null,
              unanswered_question_ids: cr?.unanswered_question_ids ?? [],
            },
          });
        }
        const clarify: ConcernClarifyEntry = {
          concern_index: concernIndex,
          service_key: item.service_key,
          concern_text: item.explanation_text,
          candidates: options,
        };
        Sentry.addBreadcrumb({
          category: "scheduler.diagnose",
          type: "info",
          level: "info",
          message: `diagnoseConcern: ${item.service_key} → clarify:${raw.stage1_candidates.join("|")}`,
          data: {
            chip_service_key: item.service_key,
            description_chars: item.explanation_text.length,
            requires_clarification: true,
            candidate_count: options.length,
            stage1_candidates: raw.stage1_candidates.join(","),
            parsed_ok: raw.parsed_ok,
            tokens_in: raw.tokens_in,
            tokens_out: raw.tokens_out,
            latency_ms: raw.latency_ms,
            error_message: raw.error_message,
          },
        });
        return { item, result: raw, matchedCat: null, gate: "pass", clarify };
      }
      // Confidence gate (REVAMP-PLAN §11 P0, wired 2026-07-02; Stage-1
      // branch replaced by the structural candidate signal 2026-07-03) —
      // low Stage-2 confidence strips the match (advisor handoff);
      // low Stage-3 confidence keeps the match but flags over-ask (the
      // full subcategory question list is queued below instead of the
      // fact-mapper's unanswered set). See confidence-gate.ts.
      const gated = applyConfidenceGate(raw);
      let result = gated.result;
      // Find the matched category record for question lookup. We re-walk
      // the catalog here (cheap — ≤20 entries) rather than expose it from
      // diagnoseConcern's signature. A gated (handoff) result has a null
      // key, so matchedCat stays null — the exact null-match path.
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
      if (gated.gate === "over_ask") {
        const allIds = overAskQuestionIds(
          matchedCat,
          result.matched_subcategory_slug,
        );
        if (allIds) {
          result = { ...result, unanswered_question_ids: allIds };
        }
      }
      // Observability — record per-concern outcome to Sentry so we can
      // see what the LLM is doing in production (testing-service match
      // vs 'other'-subcategory match vs null-match, plus parse_ok +
      // token usage + the confidence-gate verdict). One breadcrumb per
      // concern; the aggregate route-decision is captured separately
      // below. Confidence + gate fields reflect the RAW LLM self-report;
      // matched_* fields reflect the post-gate result.
      Sentry.addBreadcrumb({
        category: "scheduler.diagnose",
        type: "info",
        level: "info",
        message: `diagnoseConcern: ${item.service_key} → ${result.matched_kind ?? "null"}:${result.matched_category_key ?? "none"} (gate: ${gated.gate})`,
        data: {
          chip_service_key: item.service_key,
          description_chars: item.explanation_text.length,
          matched_kind: result.matched_kind,
          matched_category_key: result.matched_category_key,
          matched_subcategory_slug: result.matched_subcategory_slug,
          recommended_service_key: result.recommended_testing_service?.service_key ?? null,
          unanswered_count: result.unanswered_question_ids.length,
          confidence_gate: gated.gate,
          stage1_candidates: raw.stage1_candidates.join(","),
          candidate_count: raw.stage1_candidates.length,
          stage2_confidence: raw.stage2_confidence,
          stage3_confidence: raw.stage3_confidence,
          pre_gate_matched_category_key: raw.matched_category_key,
          parsed_ok: result.parsed_ok,
          tokens_in: result.tokens_in,
          tokens_out: result.tokens_out,
          latency_ms: result.latency_ms,
          error_message: result.error_message,
        },
      });
      return { item, result, matchedCat, gate: gated.gate, clarify: null };
    }),
  );

  // ── Act-or-ask clarify entries (routed BEFORE routeAfterDiagnostics) ──
  const clarifyEntries = perConcernResults
    .map((r) => r.clarify)
    .filter((c): c is ConcernClarifyEntry => c !== null);

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
  //
  // Act-or-ask AO2c: pending clarify candidates take top routing priority
  // — this branch sits BEFORE routeAfterDiagnostics (which is left
  // untouched; the wizard task centralizes the routing later). No
  // jeffBubble here: the concern_clarify transcript bubbles (chip-shown +
  // tapped) are owned by the wizard task's card/submit surfaces (AO4).
  const { nextStep, jeffBubble } =
    clarifyEntries.length > 0
      ? { nextStep: CONCERN_CLARIFY_STEP, jeffBubble: undefined }
      : routeAfterDiagnostics({
          pending_count: pending.length,
          recommendation_count: recommended_testing_services.length,
        });

  // Aggregate outcome telemetry — PLAN-02 Phase 2B (I-OBS-8): migrated FROM
  // Sentry.captureMessage('info') (creates a Sentry issue per call, which
  // produced "false alarm" J/G/K/A issues) TO Sentry.logger.info (separate
  // log envelope, queryable in the Sentry Logs UI, NEVER creates an issue).
  // The attribute set is preserved verbatim so existing log-volume queries
  // continue to work. Requires `enableLogs: true` in sentry.server.config.ts
  // (added in the same PR).
  Sentry.logger.info(
    `runDiagnostics: ${items.length} concern(s) → ${nextStep}`,
    {
      surface: "run_diagnostics_v2_outcome",
      next_step: nextStep,
      chatId,
      concern_count: items.length,
      recommendation_count: recommended_testing_services.length,
      pending_question_count: pending.length,
      clarify_concern_count: clarifyEntries.length,
      per_concern: perConcernResults.map((r) => ({
        chip: r.item.service_key,
        matched_kind: r.result.matched_kind,
        matched_category_key: r.result.matched_category_key,
        confidence_gate: r.gate,
        stage1_candidates: r.result.stage1_candidates.join(","),
        candidate_count: r.result.stage1_candidates.length,
        requires_clarification: r.result.requires_clarification,
        stage2_confidence: r.result.stage2_confidence,
        stage3_confidence: r.result.stage3_confidence,
        parsed_ok: r.result.parsed_ok,
        error_message: r.result.error_message,
      })),
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
      // Act-or-ask AO2c: persisted per-concern clarify candidates (with
      // precomputed per-candidate S2/S3 payloads). [] when every concern
      // resolved directly — also clears any stale prior value.
      concern_clarify_candidates: clarifyEntries,
    },
    nextStep,
    jeffBubble,
  });
  if (pending.length === 0 && clarifyEntries.length === 0) {
    // Fire-and-forget? No — we want summaries persisted before the
    // customer reaches submit. Await it. Cost is one Haiku call per
    // concern (~500ms each, parallel) which is acceptable here since
    // the customer is about to read the recommendation card anyway.
    // (Deferred while clarify candidates are pending — the tap resolution
    // merges the chosen candidate first.)
    await ensureConcernSummaries({ chatId });
  }
  return transitionResult;
}

export const runDiagnosticsV2 = wrapAction(
  "runDiagnosticsV2",
  runDiagnosticsV2Impl,
);
