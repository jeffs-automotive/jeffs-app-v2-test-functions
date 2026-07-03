"use server";

/**
 * submitConcernClarifyV2 — act-or-ask AO4 (2026-07-03) Server Action.
 *
 * Resolves ONE concern_clarify chip tap. When a concern's Stage-1
 * diagnostic returned 2-3 ranked candidates, run-diagnostics persisted a
 * ConcernClarifyEntry (with per-candidate precomputed Stage-2/Stage-3
 * payloads) to customer_chat_sessions.concern_clarify_candidates and routed
 * the wizard here. The customer's tap resolves DETERMINISTICALLY from the
 * precomputed payloads — no second LLM call, no second spinner (act-or-ask
 * locked decision #2).
 *
 * Input: { chatId, chosen_key: string | null }
 *   - chosen_key = a candidate key  → resolve that candidate.
 *   - chosen_key = null             → "None of these" (soft advisor path).
 *
 * Resolution branches (mirrors run-diagnostics aggregation EXACTLY):
 *   - CHOSEN testing_service candidate: hydrate its precomputed
 *     unanswered_question_ids into clarification_questions_pending entries
 *     (loading the catalog for question text/options), dedupe the
 *     recommendation into recommended_testing_services by service_key
 *     (accumulating source_concerns), and annotate the concern's
 *     explanation_required_items entry with the queued question ids.
 *   - CHOSEN other_subcategory candidate OR none-of-these: no
 *     recommendation, no questions — the concern reaches advisors via the
 *     summary (same semantics as the confidence-gate advisor_handoff).
 *
 * Then pop the head from concern_clarify_candidates:
 *   - more entries remain → nextStep "concern_clarify" again.
 *   - else → routeAfterDiagnostics({pending_count, recommendation_count})
 *     for the MERGED totals, and (matching run-diagnostics) trigger the
 *     deferred ensureConcernSummaries once the queue drains AND no
 *     clarification questions were queued.
 *
 * Concurrency: re-reads the row, validates current_step === "concern_clarify"
 * and the head entry exists; a stale-tap (queue-head mismatch or already
 * drained) returns ok=false so the page re-renders the current head. Every
 * write goes through ONE applyWizardTransition call.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WizardStep } from "@/lib/scheduler/session-state";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
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
  // null = "None of these / not sure" (the soft advisor path).
  chosen_key: z.string().min(1).max(200).nullable(),
});

export type SubmitConcernClarifyV2Args = z.infer<typeof inputSchema>;

const NONE_OF_THESE_LABEL = "None of these";

// ─── Persisted shapes (mirror run-diagnostics.ts EXACTLY) ───────────────────

interface ClarifyCandidateOption {
  key: string;
  kind: "testing_service" | "other_subcategory";
  display_name: string;
  starting_price_cents: number | null;
  description: string | null;
  precomputed: {
    matched_subcategory_slug: string | null;
    unanswered_question_ids: number[];
  };
}

interface ConcernClarifyEntry {
  concern_index: number;
  service_key: string;
  display_name: string;
  concern_text: string;
  candidates: ClarifyCandidateOption[];
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
  multi_select: boolean;
}

interface ExplanationItem {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category: string | null;
  unanswered_question_ids?: number[];
  summary?: string;
}

// ─── Row-column parsers (defensive coercion; mirror the sibling actions) ────

function parseClarifyEntries(raw: unknown): ConcernClarifyEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ConcernClarifyEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const service_key =
      typeof e.service_key === "string" ? e.service_key : null;
    if (!service_key) continue;
    if (!Array.isArray(e.candidates)) continue;
    const concern_index =
      typeof e.concern_index === "number" ? e.concern_index : 0;
    const display_name =
      typeof e.display_name === "string" ? e.display_name : service_key;
    const concern_text =
      typeof e.concern_text === "string" ? e.concern_text : "";
    const candidates: ClarifyCandidateOption[] = [];
    for (const cand of e.candidates) {
      if (!cand || typeof cand !== "object") continue;
      const c = cand as Record<string, unknown>;
      const key = typeof c.key === "string" ? c.key : null;
      const kind =
        c.kind === "testing_service" || c.kind === "other_subcategory"
          ? c.kind
          : null;
      const cand_display =
        typeof c.display_name === "string" ? c.display_name : null;
      if (!key || !kind || !cand_display) continue;
      const pre =
        c.precomputed && typeof c.precomputed === "object"
          ? (c.precomputed as Record<string, unknown>)
          : {};
      const unanswered = Array.isArray(pre.unanswered_question_ids)
        ? pre.unanswered_question_ids.filter(
            (x): x is number => typeof x === "number",
          )
        : [];
      candidates.push({
        key,
        kind,
        display_name: cand_display,
        starting_price_cents:
          typeof c.starting_price_cents === "number"
            ? c.starting_price_cents
            : null,
        description:
          typeof c.description === "string" ? c.description : null,
        precomputed: {
          matched_subcategory_slug:
            typeof pre.matched_subcategory_slug === "string"
              ? pre.matched_subcategory_slug
              : null,
          unanswered_question_ids: unanswered,
        },
      });
    }
    out.push({
      concern_index,
      service_key,
      display_name,
      concern_text,
      candidates,
    });
  }
  return out;
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
      return {
        question_id,
        question_text,
        options,
        service_key:
          typeof obj.service_key === "string" ? obj.service_key : "",
        category: typeof obj.category === "string" ? obj.category : "other",
        subcategory_slug:
          typeof obj.subcategory_slug === "string" ? obj.subcategory_slug : "",
        multi_select: obj.multi_select === true,
      } satisfies PendingQuestionEntry;
    })
    .filter((x): x is PendingQuestionEntry => x !== null);
}

function parseExplanationItems(raw: unknown): ExplanationItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ExplanationItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const service_key =
      typeof obj.service_key === "string" ? obj.service_key : null;
    if (!service_key) continue;
    const display_name =
      typeof obj.display_name === "string" ? obj.display_name : service_key;
    const explanation_text =
      typeof obj.explanation_text === "string" ? obj.explanation_text : "";
    const category =
      typeof obj.category === "string" && obj.category.length > 0
        ? obj.category
        : null;
    const item: ExplanationItem = {
      service_key,
      display_name,
      explanation_text,
      category,
    };
    if (Array.isArray(obj.unanswered_question_ids)) {
      item.unanswered_question_ids = obj.unanswered_question_ids.filter(
        (x): x is number => typeof x === "number",
      );
    }
    if (typeof obj.summary === "string" && obj.summary.length > 0) {
      item.summary = obj.summary;
    }
    out.push(item);
  }
  return out;
}

// ─── Catalog helpers (mirror run-diagnostics.ts) ────────────────────────────

function findCategoryByKey(
  catalog: DiagnosticCatalog,
  key: string,
): CatalogCategory | null {
  for (const c of catalog.categories) {
    if (
      (c.kind === "testing_service" && c.service_key === key) ||
      (c.kind === "other_subcategory" && c.subcategory_slug === key)
    ) {
      return c;
    }
  }
  return null;
}

/** Look up a question record (text + options) by ID within the matched
 *  category + subcategory. Mirrors run-diagnostics.findQuestionInCatalog. */
function findQuestionInCatalog(
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

async function submitConcernClarifyV2Impl(
  args: SubmitConcernClarifyV2Args,
): Promise<WizardTransitionResult> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, chosen_key } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select(
        "id, current_step, concern_clarify_candidates, recommended_testing_services, clarification_questions_pending, explanation_required_items",
      )
      .eq("id", chatId)
      .maybeSingle();

    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }

    // Stale-tap guard: the wizard must actually be on concern_clarify.
    if ((row.current_step as string | null) !== "concern_clarify") {
      Sentry.captureMessage("submit_concern_clarify_v2 stale current_step", {
        level: "warning",
        extra: {
          chatId,
          current_step: row.current_step,
        },
      });
      return { ok: false, error: "stale_current_step" };
    }

    const clarifyQueue = parseClarifyEntries(
      (row as Record<string, unknown>).concern_clarify_candidates,
    );
    const head = clarifyQueue[0];
    if (!head) {
      // Queue already drained (likely a stale submit after a refresh).
      return { ok: false, error: "clarify_queue_empty" };
    }

    // Validate chosen_key: null (none-of-these) OR one of the head's keys.
    const chosenCandidate =
      chosen_key === null
        ? null
        : head.candidates.find((c) => c.key === chosen_key) ?? undefined;
    if (chosen_key !== null && chosenCandidate === undefined) {
      Sentry.captureMessage("submit_concern_clarify_v2 invalid chosen_key", {
        level: "warning",
        extra: {
          chatId,
          chosen_key,
          candidate_keys: head.candidates.map((c) => c.key),
        },
      });
      return { ok: false, error: "invalid_chosen_key" };
    }

    // Existing aggregate state (the merge targets).
    const existingRecs = parseRecommendedServices(
      (row as Record<string, unknown>).recommended_testing_services,
    );
    const existingPending = parsePendingQuestions(
      (row as Record<string, unknown>).clarification_questions_pending,
    );
    const explanationItems = parseExplanationItems(
      row.explanation_required_items,
    );

    // ── Merge the chosen candidate into the pipeline outputs ──────────────
    //
    // Only a testing_service candidate produces a recommendation + questions.
    // An other_subcategory candidate OR none-of-these is the soft advisor
    // path: no recommendation, no questions (the concern still reaches
    // advisors via its summary — same as the confidence-gate handoff).
    const recsByKey = new Map<string, RecommendedService>();
    for (const r of existingRecs) recsByKey.set(r.service_key, r);
    const nextPending: PendingQuestionEntry[] = [...existingPending];
    let queuedQuestionIds: number[] = [];

    if (chosenCandidate && chosenCandidate.kind === "testing_service") {
      // Load the catalog to hydrate question text/options + the parent
      // concern_category (mirrors run-diagnostics' aggregation shapes).
      const catalog = await loadDiagnosticCatalog(supabase);
      const matchedCat = findCategoryByKey(catalog, chosenCandidate.key);
      if (matchedCat && isTestingService(matchedCat)) {
        // Recommendation dedupe by service_key, accumulate source_concerns.
        const existing = recsByKey.get(matchedCat.service_key);
        if (existing) {
          if (!existing.source_concerns.includes(head.service_key)) {
            existing.source_concerns.push(head.service_key);
          }
        } else {
          recsByKey.set(matchedCat.service_key, {
            service_key: matchedCat.service_key,
            display_name: matchedCat.display_name,
            description: matchedCat.description,
            starting_price_cents: matchedCat.starting_price_cents,
            source_concerns: [head.service_key],
          });
        }

        // Hydrate the precomputed unanswered question ids into pending
        // entries (same shape run-diagnostics builds).
        const subSlug = chosenCandidate.precomputed.matched_subcategory_slug;
        if (subSlug) {
          const parentCategory =
            matchedCat.subcategories.find((s) => s.slug === subSlug)
              ?.concern_category ?? "other";
          const idsForConcern: number[] = [];
          for (const qid of chosenCandidate.precomputed
            .unanswered_question_ids) {
            const q = findQuestionInCatalog(matchedCat, subSlug, qid);
            if (!q) continue;
            nextPending.push({
              question_id: q.id,
              question_text: q.question_text,
              options: q.options,
              service_key: head.service_key,
              category: parentCategory,
              subcategory_slug: subSlug,
              multi_select: q.multi_select,
            });
            idsForConcern.push(q.id);
          }
          queuedQuestionIds = idsForConcern;
        }
      } else {
        // Catalog drift — the candidate key no longer resolves to a
        // testing service. Degrade to the soft advisor path (no rec, no
        // questions) rather than crash; surface for observability.
        Sentry.captureMessage(
          "submit_concern_clarify_v2 candidate key unresolved in catalog",
          {
            level: "warning",
            extra: { chatId, chosen_key: chosenCandidate.key },
          },
        );
      }
    }

    const recommended_testing_services = Array.from(recsByKey.values());

    // Annotate the source concern's explanation_required_items entry with
    // the queued question ids (the canonical per-concern grouping consumed
    // by ensureConcernSummaries). Match by concern_index first (stable),
    // falling back to service_key. Only merge NEW ids so a prior concern's
    // annotations survive.
    const updatedExplanationItems = explanationItems.map((item, idx) => {
      const isTarget =
        idx === head.concern_index || item.service_key === head.service_key;
      if (!isTarget || queuedQuestionIds.length === 0) return item;
      const prior = item.unanswered_question_ids ?? [];
      const merged = Array.from(new Set([...prior, ...queuedQuestionIds]));
      return { ...item, unanswered_question_ids: merged };
    });

    // ── Pop the head; decide next step ────────────────────────────────────
    const remainingClarify = clarifyQueue.slice(1);

    let nextStep: WizardStep;
    let jeffBubble: string | undefined;
    if (remainingClarify.length > 0) {
      // More concerns still owe a tap — stay on the chip card.
      nextStep = "concern_clarify";
      jeffBubble = undefined;
    } else {
      // Last clarify resolved → route on the MERGED totals, exactly as
      // run-diagnostics / submit-clarification-answer do.
      const routed = routeAfterDiagnostics({
        pending_count: nextPending.length,
        recommendation_count: recommended_testing_services.length,
      });
      nextStep = routed.nextStep;
      jeffBubble = routed.jeffBubble;
    }

    // User-voice bubble: the tapped candidate name (or the none label).
    const userBubble =
      chosenCandidate?.display_name ?? NONE_OF_THESE_LABEL;

    const transitionResult = await applyWizardTransition({
      chatId,
      updates: {
        recommended_testing_services,
        clarification_questions_pending: nextPending,
        explanation_required_items: updatedExplanationItems,
        // Persist the popped queue ([] clears the column when drained).
        concern_clarify_candidates: remainingClarify,
      },
      nextStep,
      userBubble,
      jeffBubble,
    });

    // Deferred-summary completion (mirrors run-diagnostics' post-drain
    // behavior): once the clarify queue is drained AND no clarification
    // questions were queued, the wizard skips straight to the
    // testing-service-approval / second-routine-pass card, so summaries must
    // be ready for the Tekmetric description builder. When questions ARE
    // pending, summaries are deferred to submit-clarification-answer's
    // queue-drain branch (same as run-diagnostics). Best-effort — a
    // summarization failure must not block the wizard advance.
    if (remainingClarify.length === 0 && nextPending.length === 0) {
      try {
        await ensureConcernSummaries({ chatId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Sentry.captureException(e, {
          tags: {
            surface: "submit_concern_clarify_v2_summarize",
            chat_id: chatId,
          },
          level: "warning",
        });
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "ensure_concern_summaries_failed",
            chat_id: chatId,
            detail: msg,
          }),
        );
      }
    }

    // Best-effort structured audit of the choice (mirrors submit-escalate's
    // fire-and-forget audit insert). Not on the critical path.
    void supabase
      .from("scheduler_audit_log")
      .insert({
        session_id: chatId,
        step: "concern_clarify",
        event_type: "concern_clarify_choice",
        event_detail: {
          chosen_key,
          candidate_keys: head.candidates.map((c) => c.key),
          concern_index: head.concern_index,
        },
      })
      .then(({ error }) => {
        if (error) {
          Sentry.captureMessage(
            "submit_concern_clarify_v2 audit insert failed",
            {
              level: "warning",
              extra: { chatId, error: error.message },
            },
          );
        }
      });

    return transitionResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_concern_clarify_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_concern_clarify_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { chosen_key },
    });
    return { ok: false, error: msg };
  }
}

export const submitConcernClarifyV2 = wrapAction(
  "submitConcernClarifyV2",
  submitConcernClarifyV2Impl,
);
