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
 * Act-or-ask (2026-07-03): the chip-card step shown when a concern's
 * Stage 1 returned 2-3 ranked candidates. Now a first-class WizardStep
 * member (AO4 wired the card arms + exhaustiveness cases), so this is the
 * real typed value — no cast.
 */
const CONCERN_CLARIFY_STEP: WizardStep = "concern_clarify";

interface ExplanationItem {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category: string | null;
  /** Present as an array once run-diagnostics has diagnosed this entry
   *  (the per-entry write-back below). Its PRESENCE — not its length — is
   *  the "already diagnosed" discriminator for selective re-diagnosis: a
   *  re-run keeps such an entry's stored diagnostic state verbatim and does
   *  NOT re-call diagnoseConcern (2026-07-04 describe-another-issue fix).
   *  Absent on a fresh picker entry (never diagnosed) and on the empty
   *  `other_issue` entry the describe-another-issue branch appends. */
  unanswered_question_ids?: number[];
  /** Populated by ensureConcernSummaries after the queue drains. Preserved
   *  verbatim for skipped (already-diagnosed) entries on a re-run. */
  summary?: string;
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
  /** The picker-chip display name (surfaced by the clarify card's eyebrow). */
  display_name: string;
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
      const item: ExplanationItem = {
        service_key,
        display_name: display_name ?? service_key,
        explanation_text,
        category,
      };
      // Carry the prior diagnostic annotations through so selective
      // re-diagnosis can detect + preserve already-diagnosed entries.
      if (Array.isArray(obj.unanswered_question_ids)) {
        item.unanswered_question_ids = obj.unanswered_question_ids.filter(
          (x): x is number => typeof x === "number",
        );
      }
      if (typeof obj.summary === "string" && obj.summary.length > 0) {
        item.summary = obj.summary;
      }
      return item;
    })
    .filter((x): x is ExplanationItem => x !== null);
}

// ─── Answered-map parser (mirrors the sibling actions) ──────────────────────
//
// clarification_questions_answered maps a `question_id` (as a STRING key) to
// the customer's chosen value(s). Selective re-diagnosis reads this so it
// can (a) NEVER wipe it and (b) exclude already-answered question ids from
// the freshly-built pending queue.
function parseAnsweredMap(raw: unknown): Record<string, string | string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = v;
    } else if (
      Array.isArray(v) &&
      v.every((x): x is string => typeof x === "string")
    ) {
      out[k] = v;
    }
  }
  return out;
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
      "id, explanation_required_items, new_vehicle_info, diagnostic_processing_complete, clarification_questions_pending, clarification_questions_answered, recommended_testing_services, concern_clarify_candidates",
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

  // ── Selective re-diagnosis setup (2026-07-04 describe-another-issue fix) ─
  //
  // run-diagnostics can be RE-invoked mid-flow — the "💬 Describe another
  // issue" branch (submit-second-routine-pass) appends a fresh `other_issue`
  // entry and resets diagnostic_processing_complete=false. On that re-run we
  // MUST NOT (a) re-diagnose the already-diagnosed earlier concerns, (b) wipe
  // the answers the customer already gave, or (c) re-queue their already-
  // answered questions. So:
  //   - `answered` is read here and NEVER reset to {} (the picker owns that
  //     reset on a genuinely fresh pick-submit; run-diagnostics only ever
  //     PRESERVES it).
  //   - an entry with a populated explanation_text AND a persisted
  //     unanswered_question_ids array is treated as already diagnosed → its
  //     diagnoseConcern call is SKIPPED and its stored diagnostic state is
  //     kept verbatim.
  //   - the new pending queue carries forward the still-unanswered entries of
  //     the EXISTING queue (skipped concerns' residual questions) plus the
  //     freshly-diagnosed concerns' questions, and EXCLUDES anything already
  //     in `answered`.
  const answered = parseAnsweredMap(
    (row as Record<string, unknown>).clarification_questions_answered,
  );
  const answeredIds = new Set<number>();
  for (const k of Object.keys(answered)) {
    const n = Number(k);
    if (Number.isFinite(n)) answeredIds.add(n);
  }
  const existingPending = parsePendingQuestions(
    (row as Record<string, unknown>).clarification_questions_pending,
  );
  const existingRecs = parseRecommendedServices(
    (row as Record<string, unknown>).recommended_testing_services,
  );

  /** An entry is already diagnosed when run-diagnostics has previously
   *  annotated it (unanswered_question_ids present as an array) AND it has
   *  a populated description. Such entries are SKIPPED on a re-run. A fresh
   *  picker entry (no annotation) and the empty `other_issue` entry the
   *  describe branch appends (no annotation, empty text until the
   *  concern_explanation step fills it) both fail this test → diagnosed. */
  const isAlreadyDiagnosed = (item: ExplanationItem): boolean =>
    Array.isArray(item.unanswered_question_ids) &&
    item.explanation_text.trim().length > 0;

  // ── Load supporting context in parallel ──────────────────────────────
  const [catalog, routineChipCats] = await Promise.all([
    loadDiagnosticCatalog(supabase),
    loadRoutineChipConcernCategories(supabase),
  ]);

  // ── Per-concern LLM call in parallel (skipping already-diagnosed) ────
  const perConcernResults = await Promise.all(
    items.map(async (item, concernIndex): Promise<{
      item: ExplanationItem;
      /** Null for a skipped (already-diagnosed) entry — it ran no LLM. */
      result: DiagnoseConcernResult | null;
      matchedCat: CatalogCategory | null;
      gate: ConfidenceGateOutcome;
      clarify: ConcernClarifyEntry | null;
      /** True when this entry reused its stored diagnostic state (no LLM). */
      skipped: boolean;
    }> => {
      // Selective re-diagnosis: reuse stored state for already-diagnosed
      // entries. Their unanswered_question_ids / category / summary are kept
      // verbatim; no diagnoseConcern call, no new recommendation derivation.
      if (isAlreadyDiagnosed(item)) {
        Sentry.addBreadcrumb({
          category: "scheduler.diagnose",
          type: "info",
          level: "info",
          message: `diagnoseConcern: ${item.service_key} → SKIPPED (already diagnosed)`,
          data: {
            chip_service_key: item.service_key,
            concern_index: concernIndex,
            skipped: true,
            stored_unanswered_count: (item.unanswered_question_ids ?? []).length,
          },
        });
        return {
          item,
          result: null,
          matchedCat: null,
          gate: "pass",
          clarify: null,
          skipped: true,
        };
      }
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
          display_name: item.display_name,
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
        return {
          item,
          result: raw,
          matchedCat: null,
          gate: "pass",
          clarify,
          skipped: false,
        };
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
      return {
        item,
        result,
        matchedCat,
        gate: gated.gate,
        clarify: null,
        skipped: false,
      };
    }),
  );

  // ── Act-or-ask clarify entries (routed BEFORE routeAfterDiagnostics) ──
  const clarifyEntries = perConcernResults
    .map((r) => r.clarify)
    .filter((c): c is ConcernClarifyEntry => c !== null);

  // ── Aggregate recommendations ────────────────────────────────────────
  //
  // Seed from the EXISTING recommendations so a skipped (already-diagnosed)
  // concern's recommendation survives the re-run — its diagnoseConcern was
  // not re-called, so its rec isn't re-derived below. Only freshly-diagnosed
  // concerns add/merge recs (deduped by service_key, source_concerns
  // accumulated). On a genuinely fresh first run existingRecs is [] (the
  // picker resets it), so seeding is a no-op there.
  const recsByService = new Map<string, RecommendedService>();
  for (const rec of existingRecs) {
    recsByService.set(rec.service_key, {
      service_key: rec.service_key,
      display_name: rec.display_name,
      description: rec.description,
      starting_price_cents: rec.starting_price_cents,
      source_concerns: [...rec.source_concerns],
    });
  }
  for (const r of perConcernResults) {
    if (r.skipped || !r.result) continue;
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

  // ── Aggregate pending questions (INDEX-SAFE write-back) ──────────────
  //
  // perIndexQuestionIds is keyed by the concern's ARRAY INDEX, not its
  // service_key. Two duplicate `other_issue` entries share a service_key,
  // so a service_key-keyed map would let the second concern's write-back
  // CLOBBER the first's ids (the confirmed 2026-07-04 bug). Concern order is
  // stable across the pass, so the index is the safe join key.
  const pending: PendingQuestionEntry[] = [];
  const perIndexQuestionIds = new Map<number, number[]>();
  // De-dupe guard so a question queued once (carried forward or freshly
  // built) is never queued twice.
  const queuedIds = new Set<number>();

  const pushPending = (entry: PendingQuestionEntry): void => {
    if (answeredIds.has(entry.question_id)) return; // already answered
    if (queuedIds.has(entry.question_id)) return; // already queued
    queuedIds.add(entry.question_id);
    pending.push(entry);
  };

  // (1) Carry forward the EXISTING queue's still-unanswered entries. These
  //     belong to skipped (already-diagnosed) concerns whose questions the
  //     customer hadn't finished answering. In the normal describe flow the
  //     earlier concerns are fully answered by the time run-diagnostics
  //     re-fires, so this is usually empty — but preserving residuals keeps
  //     the queue correct without a catalog rebuild. On a fresh first run
  //     existingPending is [] (picker cleared it), so this is a no-op.
  for (const p of existingPending) {
    pushPending(p);
  }

  // (2) Freshly-diagnosed concerns contribute their new questions. Skipped
  //     concerns produce no r.result, so they never re-enter the queue here.
  for (let idx = 0; idx < perConcernResults.length; idx++) {
    const r = perConcernResults[idx]!;
    if (r.skipped || !r.result || !r.matchedCat || !r.result.matched_subcategory_slug) {
      continue;
    }
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
      // Record the id for THIS concern's annotation even if it's already
      // answered / queued — the annotation is the canonical "these questions
      // belong to this concern" record ensureConcernSummaries reads, so it
      // must reflect the full diagnosed set, not just what's still pending.
      idsForConcern.push(q.id);
      pushPending({
        question_id: q.id,
        question_text: q.question_text,
        options: q.options,
        service_key: r.item.service_key,
        category: parentCategory,
        subcategory_slug: subSlug,
        multi_select: q.multi_select,
      });
    }
    if (idsForConcern.length > 0) {
      perIndexQuestionIds.set(idx, idsForConcern);
    }
  }

  // Annotate each explanation_required_items entry with the question_ids
  // it queued. INDEX-SAFE: skipped entries keep their STORED annotation
  // verbatim; freshly-diagnosed entries get their new ids from the
  // by-index map. This is the canonical "which questions belong to this
  // concern" record consumed later by ensureConcernSummaries.
  const updatedExplanationItems = items.map((item, idx) => {
    const base: {
      service_key: string;
      display_name: string;
      explanation_text: string;
      category: string | null;
      unanswered_question_ids: number[];
      summary?: string;
    } = {
      service_key: item.service_key,
      display_name: item.display_name,
      explanation_text: item.explanation_text,
      category: item.category,
      unanswered_question_ids: isAlreadyDiagnosed(item)
        ? // Skipped — keep its stored ids verbatim (never re-derived).
          item.unanswered_question_ids ?? []
        : // Freshly diagnosed — its new ids (or [] when it queued none).
          perIndexQuestionIds.get(idx) ?? [],
    };
    // Preserve a skipped entry's stored summary so ensureConcernSummaries
    // doesn't have to regenerate it.
    if (item.summary) base.summary = item.summary;
    return base;
  });

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
        skipped: r.skipped,
        matched_kind: r.result?.matched_kind ?? null,
        matched_category_key: r.result?.matched_category_key ?? null,
        confidence_gate: r.gate,
        stage1_candidates: r.result?.stage1_candidates.join(",") ?? "",
        candidate_count: r.result?.stage1_candidates.length ?? 0,
        requires_clarification: r.result?.requires_clarification ?? false,
        stage2_confidence: r.result?.stage2_confidence ?? null,
        stage3_confidence: r.result?.stage3_confidence ?? null,
        parsed_ok: r.result?.parsed_ok ?? null,
        error_message: r.result?.error_message ?? null,
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
      // PRESERVE the answered map (2026-07-04 fix) — NEVER reset it to {}.
      // On a genuinely fresh first run the picker already set it to {} at
      // submit time, so preserving that {} is correct; on a describe-another-
      // issue re-run this keeps the earlier concerns' answers so their
      // already-answered questions are not re-queued.
      clarification_questions_answered: answered,
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
