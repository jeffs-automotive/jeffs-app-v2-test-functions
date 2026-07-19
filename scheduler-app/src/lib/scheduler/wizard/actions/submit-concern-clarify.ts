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
import { overAskQuestionIds } from "@/lib/scheduler/wizard/confidence-gate";
import { routeAfterDiagnostics } from "@/lib/scheduler/wizard/route-after-diagnostics";
import { ensureConcernSummaries } from "@/lib/scheduler/wizard/ensure-concern-summaries";
import type { TriageConstraint } from "@/lib/scheduler/wizard/triage";

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
    /** Per-candidate Stage-2/Stage-3 self-reported confidence (persisted by
     *  run-diagnostics — CORE). OPTIONAL: legacy in-flight rows written
     *  before concern-triage lack them → treated as PASS (never gate) at tap
     *  time for INV-8 back-compat. */
    stage2_confidence?: "high" | "medium" | "low";
    stage3_confidence?: "high" | "medium" | "low";
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
  // INV-3: the concern-triage identity + fields MUST survive this action's
  // parse + write-back of explanation_required_items (otherwise the
  // constrained re-diagnosis loses triage_answers / triage_round). This
  // action never consumes them — it only preserves them verbatim.
  concern_id?: string;
  triage_round?: number;
  triage_answers?: TriageConstraint | null;
  handoff_reason?: string | null;
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
      const s2c =
        pre.stage2_confidence === "high" ||
        pre.stage2_confidence === "medium" ||
        pre.stage2_confidence === "low"
          ? pre.stage2_confidence
          : undefined;
      const s3c =
        pre.stage3_confidence === "high" ||
        pre.stage3_confidence === "medium" ||
        pre.stage3_confidence === "low"
          ? pre.stage3_confidence
          : undefined;
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
          // Missing → left undefined → treated as PASS at tap (INV-8).
          ...(s2c ? { stage2_confidence: s2c } : {}),
          ...(s3c ? { stage3_confidence: s3c } : {}),
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
    // INV-3 — carry the triage identity/fields through untouched. This
    // action doesn't consume them; dropping them here would silently
    // degrade the constrained re-diagnosis (triage_answers lost → full
    // unconstrained re-run) and reset the one-round cap (triage_round lost).
    if (typeof obj.concern_id === "string" && obj.concern_id.length > 0) {
      item.concern_id = obj.concern_id;
    }
    if (typeof obj.triage_round === "number") {
      item.triage_round = obj.triage_round;
    }
    if (obj.triage_answers === null) {
      item.triage_answers = null;
    } else if (
      obj.triage_answers &&
      typeof obj.triage_answers === "object" &&
      !Array.isArray(obj.triage_answers)
    ) {
      const ta = obj.triage_answers as Record<string, unknown>;
      if (
        Array.isArray(ta.allowed_service_keys) &&
        typeof ta.chip_key === "string" &&
        typeof ta.label === "string"
      ) {
        item.triage_answers = {
          allowed_service_keys: ta.allowed_service_keys.filter(
            (x): x is string => typeof x === "string",
          ),
          chip_key: ta.chip_key,
          label: ta.label,
        };
      }
    }
    if (typeof obj.handoff_reason === "string") {
      item.handoff_reason = obj.handoff_reason;
    } else if (obj.handoff_reason === null) {
      item.handoff_reason = null;
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

/** Question ids already answered on the row (B4 — never re-queue). Mirrors
 *  run-diagnostics' answeredIds set. Keys are stringified question ids. */
function parseAnsweredIds(raw: unknown): Set<number> {
  const ids = new Set<number>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ids;
  for (const k of Object.keys(raw as Record<string, unknown>)) {
    const n = Number(k);
    if (Number.isFinite(n)) ids.add(n);
  }
  return ids;
}

/** Count the pending triage-queue entries on the row (INV-4). Object-shaped
 *  entries only; a null / [] column → 0. The triage queue outranks the
 *  clarify queue + the normal route. */
function countTriageEntries(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((e) => e && typeof e === "object").length;
}

/**
 * Hydrate a chosen candidate's follow-up questions into pending entries
 * (B3: applies to BOTH a testing_service AND an other_subcategory candidate
 * — the other_subcategory branch previously dropped its precomputed ids).
 *
 * B1 over-ask (INV-5): when the candidate's persisted Stage-3 confidence is
 * "low", the precomputed unanswered set is distrusted and the FULL
 * subcategory question list is queued instead (overAskQuestionIds resolves
 * to null for a non-testing-service, leaving the precomputed set untouched —
 * matching confidence-gate.ts, which gates testing services only).
 *
 * Returns the canonical per-concern question-id list for the item annotation
 * (every catalog-resolved id, INCLUDING already-answered/queued ones —
 * mirrors run-diagnostics: the annotation records the full diagnosed set,
 * the pending queue records what still needs asking).
 */
function hydrateConcernQuestions(params: {
  matchedCat: CatalogCategory;
  subSlug: string;
  precomputedIds: number[];
  stage3Low: boolean;
  serviceKey: string;
  pushPending: (entry: PendingQuestionEntry) => void;
}): number[] {
  const { matchedCat, subSlug, precomputedIds, stage3Low, serviceKey, pushPending } =
    params;
  let idsToHydrate = precomputedIds;
  if (stage3Low) {
    const allIds = overAskQuestionIds(matchedCat, subSlug);
    if (allIds) idsToHydrate = allIds;
  }
  const parentCategory = isTestingService(matchedCat)
    ? matchedCat.subcategories.find((s) => s.slug === subSlug)?.concern_category ??
      "other"
    : "other";
  const idsForConcern: number[] = [];
  for (const qid of idsToHydrate) {
    const q = findQuestionInCatalog(matchedCat, subSlug, qid);
    if (!q) continue;
    idsForConcern.push(q.id);
    pushPending({
      question_id: q.id,
      question_text: q.question_text,
      options: q.options,
      service_key: serviceKey,
      category: parentCategory,
      subcategory_slug: subSlug,
      multi_select: q.multi_select,
    });
  }
  return idsForConcern;
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
        // clarification_questions_answered → B4 skip-answered guard;
        // concern_triage_state → INV-4 triage-first routing (new column;
        // typed once database.types.ts regenerates — WIRING owns that file).
        "id, current_step, concern_clarify_candidates, recommended_testing_services, clarification_questions_pending, clarification_questions_answered, explanation_required_items, concern_triage_state",
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
    // B4: never re-queue an already-answered question. Mirrors
    // run-diagnostics' answeredIds set (built from the answered map keys).
    const answeredIds = parseAnsweredIds(
      (row as Record<string, unknown>).clarification_questions_answered,
    );

    // ── Merge the chosen candidate into the pipeline outputs ──────────────
    //
    // A testing_service candidate produces a recommendation + questions; an
    // other_subcategory candidate produces questions only (B3 — previously
    // its precomputed ids were dropped); none-of-these is the soft advisor
    // path (no rec, no questions — the concern reaches advisors via its
    // summary). B1: a Stage-2-low testing_service pick is an advisor handoff
    // (no rec, no questions) exactly like the direct-path confidence gate.
    const recsByKey = new Map<string, RecommendedService>();
    for (const r of existingRecs) recsByKey.set(r.service_key, r);

    // B4: dedupe + skip-answered guard around the pending queue (mirror
    // run-diagnostics.pushPending). Seed queuedIds from the carried-forward
    // entries so a question already pending isn't queued twice.
    const nextPending: PendingQuestionEntry[] = [];
    const queuedIds = new Set<number>();
    const pushPending = (entry: PendingQuestionEntry): void => {
      if (answeredIds.has(entry.question_id)) return; // already answered
      if (queuedIds.has(entry.question_id)) return; // already queued
      queuedIds.add(entry.question_id);
      nextPending.push(entry);
    };
    for (const p of existingPending) pushPending(p);

    let queuedQuestionIds: number[] = [];
    // B1 (INV-19): why THIS concern was handed to the advisor at tap time.
    let handoffReason: string | null = null;

    if (chosenCandidate) {
      const s2 = chosenCandidate.precomputed.stage2_confidence;
      const s3 = chosenCandidate.precomputed.stage3_confidence;
      const subSlug = chosenCandidate.precomputed.matched_subcategory_slug;

      // B1 (INV-5) — the confidence gate applied at TAP. Mirrors
      // confidence-gate.ts stage2Low: a testing_service pick whose Stage-2
      // confidence is "low" (with a real subcategory slug) is stripped to
      // the advisor path — no rec, no questions. MISSING confidence (legacy
      // rows) → undefined !== "low" → PASS, never gate (INV-8 back-compat).
      const stage2Low =
        chosenCandidate.kind === "testing_service" &&
        s2 === "low" &&
        subSlug !== null;

      if (stage2Low) {
        handoffReason = "stage2_low";
      } else {
        // Load the catalog to hydrate question text/options + resolve the
        // matched category (mirrors run-diagnostics' aggregation shapes).
        const catalog = await loadDiagnosticCatalog(supabase);
        const matchedCat = findCategoryByKey(catalog, chosenCandidate.key);

        if (matchedCat && isTestingService(matchedCat)) {
          // Recommendation dedupe by service_key, accumulate source_concerns.
          // A testing_service candidate always yields a rec, even when it
          // queued no questions (subSlug null).
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
          if (subSlug) {
            // B1 over-ask: distrust the precomputed set when Stage-3 was low.
            queuedQuestionIds = hydrateConcernQuestions({
              matchedCat,
              subSlug,
              precomputedIds: chosenCandidate.precomputed.unanswered_question_ids,
              stage3Low: s3 === "low",
              serviceKey: head.service_key,
              pushPending,
            });
          }
        } else if (
          matchedCat &&
          chosenCandidate.kind === "other_subcategory" &&
          subSlug
        ) {
          // B3 — an other_subcategory candidate: hydrate its precomputed
          // questions (no fee-bearing recommendation). overAskQuestionIds is
          // a no-op for a non-testing-service, so Stage-3-low leaves the
          // precomputed set intact here.
          queuedQuestionIds = hydrateConcernQuestions({
            matchedCat,
            subSlug,
            precomputedIds: chosenCandidate.precomputed.unanswered_question_ids,
            stage3Low: s3 === "low",
            serviceKey: head.service_key,
            pushPending,
          });
        } else {
          // Catalog drift — the candidate key no longer resolves to a
          // matching category. Degrade to the soft advisor path (no rec, no
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
    }

    const recommended_testing_services = Array.from(recsByKey.values());

    // Annotate the source concern's explanation_required_items entry with
    // the queued question ids (the canonical per-concern grouping consumed
    // by ensureConcernSummaries). Match by concern_index ONLY when it's a
    // valid in-range index (the stable, duplicate-safe join key). Matching
    // by service_key would clobber BOTH entries when two duplicate
    // `other_issue` concerns share a service_key (2026-07-04 fix — same
    // class as the run-diagnostics write-back bug); service_key is used
    // only as a defensive fallback when concern_index is out of range.
    const indexInRange =
      head.concern_index >= 0 && head.concern_index < explanationItems.length;
    const updatedExplanationItems = explanationItems.map((item, idx) => {
      const isTarget = indexInRange
        ? idx === head.concern_index
        : item.service_key === head.service_key;
      if (!isTarget) return item;
      // INV-3: `...item` preserves concern_id / triage_round / triage_answers
      // (parseExplanationItems now carries them). Only the target concern's
      // annotation + handoff_reason change here.
      let next = item;
      if (queuedQuestionIds.length > 0) {
        const prior = item.unanswered_question_ids ?? [];
        const merged = Array.from(new Set([...prior, ...queuedQuestionIds]));
        next = { ...next, unanswered_question_ids: merged };
      }
      // B1 — record the Stage-2-low advisor handoff on the concern
      // (observability; the concern still reaches advisors via its summary).
      if (handoffReason !== null) {
        next = { ...next, handoff_reason: handoffReason };
      }
      return next;
    });

    // ── Pop the head; decide next step ────────────────────────────────────
    const remainingClarify = clarifyQueue.slice(1);
    // INV-4 routing priority: triage-queue > clarify-queue > routeAfterDiagnostics.
    const triageCount = countTriageEntries(
      (row as Record<string, unknown>).concern_triage_state,
    );

    let nextStep: WizardStep;
    let jeffBubble: string | undefined;
    if (triageCount > 0) {
      // A pending triage concern outranks this clarify queue AND the normal
      // route — hand to the broad-category card; its submit re-diagnoses.
      nextStep = "concern_triage";
      jeffBubble = undefined;
    } else if (remainingClarify.length > 0) {
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
    // queue-drain branch (same as run-diagnostics). A pending triage concern
    // also defers them — the pipeline isn't done until its re-diagnosis runs.
    // Best-effort — a summarization failure must not block the wizard advance.
    if (
      remainingClarify.length === 0 &&
      nextPending.length === 0 &&
      triageCount === 0
    ) {
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
