"use server";

/**
 * Step 7.1 submit — service + concern picker (Phase 9c rewrite 2026-05-15).
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign:
 * the customer's picks come in as a flat list of service_keys spanning BOTH
 * chip sections. This action splits them three ways:
 *
 *   - selected_simple_services[] — routine picks that don't need a description
 *   - approved_testing_services[] — testing-service picks (customer chose
 *     them explicitly, no later approval card; D2 of the redesign)
 *   - explanation_required_items[] — per-service description queue. Each
 *     entry: { service_key, display_name, explanation_text:"", category }.
 *     Set for: testing services + routine services with
 *     requires_explanation=true. The wizard walks this queue via Step 7.2
 *     concern_explanation cards (one per item, filled in by submitExplanationV2).
 *
 * After the queue is built:
 *   - queue non-empty → advance to concern_explanation
 *   - queue empty → advance to appointment_type (skip Steps 7.2-7.5 entirely)
 *
 * Escalation keyword scan: NOT applied here in Phase 9c because the picker
 * no longer has a free-text textarea — the concern_explanation cards in
 * Step 7.2 are where free text comes from, and submitExplanationV2 runs the
 * keyword scan there. Keeping escalation scoped to where the customer
 * actually types prose.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import type { TriageConstraint } from "@/lib/scheduler/wizard/triage";
// P2.8 (2026-05-25): single source of truth for SHOP_ID.
import { SHOP_ID } from "@/lib/scheduler/shop-config";

/**
 * Synthetic service_key for the "💬 Other Issue" fixed pseudo-chip in
 * the picker. NOT a row in routine_services or testing_services — the
 * submit action recognises it explicitly and creates an
 * explanation_required_items entry whose downstream diagnostic flow
 * has no pre-resolved category (the LLM classifies from free text).
 */
const OTHER_ISSUE_SERVICE_KEY = "other_issue";
const OTHER_ISSUE_DISPLAY_NAME = "Other issue";

const submitServiceAndConcernPickerSchema = z.object({
  chatId: z.string().min(1),
  picks: z.array(z.string().min(1)),
});

export type SubmitServiceAndConcernPickerV2Args = z.infer<
  typeof submitServiceAndConcernPickerSchema
>;

interface RoutineRow {
  service_key: string;
  display_name: string;
  requires_explanation: boolean;
  concern_categories: string[] | null;
}

interface TestingRow {
  service_key: string;
  display_name: string;
  concern_categories: string[] | null;
}

/**
 * An explanation_required_items entry. The picker writes the first four
 * fields; run-diagnostics later annotates each entry with
 * `unanswered_question_ids` and `ensureConcernSummaries` with `summary`.
 * The smart merge (summary edit hub) preserves those annotations for
 * surviving concerns so their diagnostic work isn't thrown away.
 */
interface ExplanationEntry {
  service_key: string;
  display_name: string;
  explanation_text: string;
  category: string | null;
  unanswered_question_ids?: number[];
  summary?: string;
  /** INV-13 stable identity — minted here at creation, threaded through every
   *  parser/merge/write-back, and used (never array index / the non-unique
   *  other_issue service_key) as the join key for D2 summaries, the INV-8
   *  approve/decline sets, and INV-2 carry-forward. */
  concern_id?: string;
  /** INV-3 triage fields — must survive this parser + the smart merge so a
   *  vague concern's constrained-re-diagnosis constraint (triage_answers) and
   *  its one-round cap (triage_round) aren't dropped on a services edit. */
  triage_round?: number;
  triage_answers?: TriageConstraint | null;
  handoff_reason?: string | null;
}

/** A recommended-testing-service entry as persisted by run-diagnostics. */
interface RecommendedEntry {
  service_key: string;
  display_name: string;
  description: string | null;
  starting_price_cents: number;
  source_concerns: string[];
}

function parseExistingExplanationItems(raw: unknown): ExplanationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ExplanationEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const service_key =
      typeof e.service_key === "string" ? e.service_key : null;
    if (!service_key) continue;
    const item: ExplanationEntry = {
      service_key,
      display_name:
        typeof e.display_name === "string" ? e.display_name : service_key,
      explanation_text:
        typeof e.explanation_text === "string" ? e.explanation_text : "",
      category:
        typeof e.category === "string" && e.category.length > 0
          ? e.category
          : null,
    };
    if (Array.isArray(e.unanswered_question_ids)) {
      item.unanswered_question_ids = e.unanswered_question_ids.filter(
        (x): x is number => typeof x === "number",
      );
    }
    if (typeof e.summary === "string" && e.summary.length > 0) {
      item.summary = e.summary;
    }
    preserveTriageFields(e, item);
    out.push(item);
  }
  return out;
}

/** Preserve the INV-13/INV-3 identity + triage fields verbatim onto `item`.
 *  Dropping any of these silently degrades the triage feature (constraint
 *  lost → the constrained re-diagnosis becomes an unconstrained re-run;
 *  triage_round lost → the one-round cap resets). */
function preserveTriageFields(
  e: Record<string, unknown>,
  item: ExplanationEntry,
): void {
  if (typeof e.concern_id === "string" && e.concern_id.length > 0) {
    item.concern_id = e.concern_id;
  }
  if (typeof e.triage_round === "number") {
    item.triage_round = e.triage_round;
  }
  if (e.triage_answers && typeof e.triage_answers === "object") {
    item.triage_answers = e.triage_answers as TriageConstraint;
  } else if (e.triage_answers === null) {
    item.triage_answers = null;
  }
  if (typeof e.handoff_reason === "string") {
    item.handoff_reason = e.handoff_reason;
  } else if (e.handoff_reason === null) {
    item.handoff_reason = null;
  }
}

function parseExistingRecommended(raw: unknown): RecommendedEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RecommendedEntry[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const service_key =
      typeof e.service_key === "string" ? e.service_key : null;
    const display_name =
      typeof e.display_name === "string" ? e.display_name : null;
    const starting_price_cents =
      typeof e.starting_price_cents === "number"
        ? e.starting_price_cents
        : null;
    if (!service_key || !display_name || starting_price_cents === null) {
      continue;
    }
    out.push({
      service_key,
      display_name,
      description: typeof e.description === "string" ? e.description : null,
      starting_price_cents,
      source_concerns: Array.isArray(e.source_concerns)
        ? (e.source_concerns as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [],
    });
  }
  return out;
}

function parseExistingAnswered(
  raw: unknown,
): Record<string, string | string[]> {
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

async function submitServiceAndConcernPickerV2Impl(
  args: SubmitServiceAndConcernPickerV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitServiceAndConcernPickerSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, picks } = parsed.data;

  if (picks.length === 0) {
    return {
      ok: false,
      error: "Pick at least one service to continue.",
    };
  }

  const uniquePicks = Array.from(new Set(picks));
  const supabase = createSupabaseAdminClient();

  try {
    // Read the session row up front so we know whether this submit is an
    // EDIT reached from the summary edit hub (edit_return_step set) — that
    // switches us from the wholesale reset onto the smart merge below — and
    // so the merge has the prior diagnostic state to preserve.
    const { data: sessionRow, error: sessionErr } = await supabase
      .from("customer_chat_sessions")
      .select(
        "edit_return_step, selected_simple_services, approved_testing_services, declined_testing_services, explanation_required_items, clarification_questions_answered, recommended_testing_services, diagnostic_processing_complete",
      )
      .eq("id", chatId)
      .maybeSingle();
    if (sessionErr) {
      throw new Error(`session row lookup: ${sessionErr.message}`);
    }
    const fromHub =
      (sessionRow?.edit_return_step as string | null) === "summary_edit_hub";

    const [routineRes, testingRes] = await Promise.all([
      supabase
        .from("routine_services")
        .select("service_key, display_name, requires_explanation, concern_categories")
        .eq("shop_id", SHOP_ID)
        .eq("active", true)
        .in("service_key", uniquePicks),
      supabase
        .from("testing_services")
        .select("service_key, display_name, concern_categories")
        .eq("shop_id", SHOP_ID)
        .eq("active", true)
        .in("service_key", uniquePicks),
    ]);

    if (routineRes.error) {
      throw new Error(`routine_services lookup: ${routineRes.error.message}`);
    }
    if (testingRes.error) {
      throw new Error(`testing_services lookup: ${testingRes.error.message}`);
    }

    const routineRows = (routineRes.data ?? []) as RoutineRow[];
    const testingRows = (testingRes.data ?? []) as TestingRow[];
    const routineByKey = new Map(routineRows.map((r) => [r.service_key, r]));
    const testingByKey = new Map(testingRows.map((r) => [r.service_key, r]));

    const simpleServices: string[] = [];
    const approvedTesting: string[] = [];
    // Each entry is minted with a stable concern_id at creation (INV-13). The
    // smart merge preserves survivors' ids; a brand-new pick keeps this one.
    const explanationItems: ExplanationEntry[] = [];

    const unknownPicks: string[] = [];

    for (const key of uniquePicks) {
      // Other Issue is a fixed pseudo-chip (not in any DB table). Treat
      // it as a requires_explanation chip with no pre-resolved category
      // — the diagnostic LLM classifies + recommends from the customer's
      // free-text description in the next step.
      if (key === OTHER_ISSUE_SERVICE_KEY) {
        explanationItems.push({
          concern_id: crypto.randomUUID(),
          service_key: OTHER_ISSUE_SERVICE_KEY,
          display_name: OTHER_ISSUE_DISPLAY_NAME,
          explanation_text: "",
          category: null,
        });
        continue;
      }
      const routine = routineByKey.get(key);
      if (routine) {
        if (routine.requires_explanation) {
          explanationItems.push({
            concern_id: crypto.randomUUID(),
            service_key: routine.service_key,
            display_name: routine.display_name,
            explanation_text: "",
            category:
              routine.concern_categories && routine.concern_categories.length > 0
                ? (routine.concern_categories[0] ?? null)
                : null,
          });
        } else {
          simpleServices.push(routine.service_key);
        }
        continue;
      }
      const testing = testingByKey.get(key);
      if (testing) {
        approvedTesting.push(testing.service_key);
        explanationItems.push({
          concern_id: crypto.randomUUID(),
          service_key: testing.service_key,
          display_name: testing.display_name,
          explanation_text: "",
          category:
            testing.concern_categories && testing.concern_categories.length > 0
              ? (testing.concern_categories[0] ?? null)
              : null,
        });
        continue;
      }
      unknownPicks.push(key);
    }

    if (unknownPicks.length > 0) {
      Sentry.captureMessage("submit_service_and_concern_picker unknown picks", {
        level: "warning",
        extra: { chatId, unknownPicks },
      });
    }

    // ── SMART MERGE — data preservation on EVERY resubmit (D3 / INV-7) ────
    // Split the old behavior into DATA (always preserve) vs ROUTING (mode).
    // A resubmit over prior diagnostic work must NEVER wholesale-wipe it — the
    // old code only preserved on the hub edit path, so a plain Back-to-picker
    // re-submit wiped the customer's explanations, summaries, and recs (the D3
    // live bug). We now run the merge whenever there IS prior work, and only
    // the ROUTING differs:
    //   - fromHub   → summary_edit_hub (the existing edit-return bubbles)
    //   - non-hub resubmit with prior work → route FORWARD (concern_explanation
    //     if an unexplained item exists, else the idempotent diagnostics
    //     re-route / appointment_type) — a fresh customer must NEVER land on
    //     the summary_edit_hub.
    // See docs/scheduler/concern-triage-and-unsure-path-plan.md INV-7 + the
    // summary-edit-hub-plan.md §C note.
    const existingExplanation = parseExistingExplanationItems(
      sessionRow?.explanation_required_items,
    );
    const existingAnswered = parseExistingAnswered(
      sessionRow?.clarification_questions_answered,
    );
    const existingRecommended = parseExistingRecommended(
      sessionRow?.recommended_testing_services,
    );
    const existingDeclined = Array.isArray(sessionRow?.declined_testing_services)
      ? (sessionRow?.declined_testing_services as string[])
      : [];

    // "Prior work" = the customer has already been through the diagnostic loop
    // at least once (there are concern entries or recommendations to preserve).
    // A genuinely-fresh simple-only pick has neither → today's wholesale path.
    const hasPriorWork =
      existingExplanation.length > 0 || existingRecommended.length > 0;

    if (fromHub || hasPriorWork) {
      return await applyMerge({
        chatId,
        mode: fromHub ? "hub" : "forward",
        newSimpleServices: simpleServices,
        newApprovedTesting: approvedTesting,
        newExplanationItems: explanationItems,
        existingExplanation,
        existingAnswered,
        existingRecommended,
        existingDeclined,
      });
    }

    // ── Genuinely-fresh pick (no prior diagnostic work) ──────────────────
    const nextStep = explanationItems.length > 0
      ? ("concern_explanation" as const)
      : ("appointment_type" as const);

    const jeffBubble = explanationItems.length > 0
      ? `Tell me a little about each one and I'll match up what we should test. 🤔`
      : "Got it — let me check the schedule! 📅";

    return applyWizardTransition({
      chatId,
      updates: {
        selected_simple_services: simpleServices,
        approved_testing_services: approvedTesting,
        explanation_required_items: explanationItems,
        // Phase 9a's run-diagnostics expects this to start FALSE so it does
        // the work; reset on every fresh pick-submit in case the customer
        // came back through Start Over.
        diagnostic_processing_complete: false,
        clarification_questions_pending: [],
        clarification_questions_answered: {},
        // 2026-05-17: also reset the diagnostic-output columns so a
        // back-button → re-pick flow doesn't carry stale recommendations
        // or declined entries from the prior run into the new one. The
        // next runDiagnostics will repopulate these atomically.
        recommended_testing_services: [],
        declined_testing_services: [],
        // INV-2: a genuinely-fresh pick also clears BOTH diagnostic-loop
        // queues so no stale clarify candidate or vague-concern triage entry
        // (from a prior Start-Over-less re-entry) survives into the new run.
        concern_clarify_candidates: [],
        concern_triage_state: [],
      },
      nextStep,
      jeffBubble,
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_service_and_concern_picker_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Smart merge (summary edit hub) ──────────────────────────────────────

interface ApplyMergeArgs {
  chatId: string;
  /** ROUTING mode (D3 / INV-7). "hub": the edit reached from summary_edit_hub
   *  returns there (no new concerns) or forward (new concerns). "forward": a
   *  non-hub resubmit over prior work always routes forward — a fresh customer
   *  must never land on the hub. DATA preservation is identical either way. */
  mode: "hub" | "forward";
  /** The freshly-split picks for this resubmit. */
  newSimpleServices: string[];
  newApprovedTesting: string[];
  newExplanationItems: ExplanationEntry[];
  /** Prior row state to merge against. */
  existingExplanation: ExplanationEntry[];
  existingAnswered: Record<string, string | string[]>;
  existingRecommended: RecommendedEntry[];
  existingDeclined: string[];
}

/**
 * The actual data-loss fix. Diffs the new concern picks against the prior
 * explanation_required_items and preserves each surviving concern's
 * diagnostic work (explanation_text, unanswered_question_ids, summary,
 * category). Positional match handles the v1 caveat where multiple
 * "other_issue" concerns share one service_key. Prunes the answered map,
 * recommendations, and declined list to the surviving concern set. Only
 * re-runs diagnostics when there are NEW / unexplained concerns.
 */
async function applyMerge(
  args: ApplyMergeArgs,
): Promise<WizardTransitionResult> {
  const {
    chatId,
    mode,
    newSimpleServices,
    newApprovedTesting,
    newExplanationItems,
    existingExplanation,
    existingAnswered,
    existingRecommended,
    existingDeclined,
  } = args;

  // Index existing concerns by service_key → FIFO queue of entries, so
  // duplicate keys (multiple "other_issue") are consumed positionally.
  const existingByKey = new Map<string, ExplanationEntry[]>();
  for (const entry of existingExplanation) {
    const q = existingByKey.get(entry.service_key);
    if (q) q.push(entry);
    else existingByKey.set(entry.service_key, [entry]);
  }

  const mergedExplanation: ExplanationEntry[] = [];
  let hasNewOrUnexplained = false;
  for (const pick of newExplanationItems) {
    const queue = existingByKey.get(pick.service_key);
    const survivor = queue && queue.length > 0 ? queue.shift() : undefined;
    if (survivor) {
      // Surviving concern — keep its diagnostic work verbatim, INCLUDING its
      // concern_id + triage fields (INV-13/INV-3). A legacy survivor with no
      // concern_id gets one minted on this write-back (never on a pure read),
      // so downstream identity joins are stable going forward. The new pick's
      // empty explanation_text/category are discarded for the populated ones.
      mergedExplanation.push(
        survivor.concern_id
          ? survivor
          : { ...survivor, concern_id: crypto.randomUUID() },
      );
      // A survivor still counts as "unexplained" (needs the explanation
      // step) if its explanation_text is empty — e.g. the customer added
      // it last time but bailed before typing anything.
      if (!survivor.explanation_text) hasNewOrUnexplained = true;
    } else {
      // Brand-new concern — normal empty-entry treatment (already minted a
      // concern_id at split time).
      mergedExplanation.push(pick);
      hasNewOrUnexplained = true;
    }
  }

  // Surviving concern service_keys (for pruning recs/declined). The set of
  // question_ids that still belong to a surviving concern (for pruning the
  // answered map).
  const survivingKeys = new Set(mergedExplanation.map((e) => e.service_key));
  const survivingQuestionIds = new Set<number>();
  for (const e of mergedExplanation) {
    for (const qid of e.unanswered_question_ids ?? []) {
      survivingQuestionIds.add(qid);
    }
  }

  // Prune the answered map: keep only answers whose question_id belongs to
  // a surviving concern's question set. Answers whose id came from a REMOVED
  // concern drop.
  const mergedAnswered: Record<string, string | string[]> = {};
  for (const [qidStr, value] of Object.entries(existingAnswered)) {
    const qid = Number(qidStr);
    if (Number.isFinite(qid) && survivingQuestionIds.has(qid)) {
      mergedAnswered[qidStr] = value;
    }
  }

  // Prune recommendations: keep a rec whose source concerns still survive
  // (at least one surviving source). Recs with no surviving source drop.
  const mergedRecommended = existingRecommended.filter((rec) =>
    rec.source_concerns.some((k) => survivingKeys.has(k)),
  );
  const survivingRecKeys = new Set(
    mergedRecommended.map((r) => r.service_key),
  );

  // approved_testing_services: the customer's direct testing picks on this
  // resubmit (same semantics as the normal path — approved = testing chips
  // picked). declined: keep only declines that still map to a surviving
  // recommendation (a decline for a recommendation whose source concern was
  // removed is stale).
  const mergedApproved = newApprovedTesting;
  const mergedDeclined = existingDeclined.filter((k) =>
    survivingRecKeys.has(k),
  );

  // The preserved data payload is identical across routing modes (D3/INV-7:
  // DATA preservation is decoupled from ROUTING).
  const preservedData = {
    selected_simple_services: newSimpleServices,
    approved_testing_services: mergedApproved,
    explanation_required_items: mergedExplanation,
    clarification_questions_answered: mergedAnswered,
    recommended_testing_services: mergedRecommended,
    declined_testing_services: mergedDeclined,
  };

  // ── ROUTING: no new/unexplained concerns (diagnostic state fully intact) ──
  if (!hasNewOrUnexplained) {
    if (mode === "hub") {
      // Hub edit path: straight back to the hub, no re-diagnosis.
      // diagnostic_processing_complete stays true;
      // clarification_questions_pending is already drained. edit_return_step
      // STAYS set (only the slot flow / hub "done" / start-over clears it).
      return applyWizardTransition({
        chatId,
        updates: preservedData,
        nextStep: "summary_edit_hub",
        userBubble: "Update my services",
        jeffBubble: "Updated your services. ✅",
      });
    }
    // Forward (non-hub resubmit) with all concerns explained → re-enter the
    // diagnostics loading step so run-diagnostics' idempotent early-exit
    // re-routes to clarify/triage/approval from the PRESERVED state (INV-4
    // site 2). diagnostic_processing_complete is left untouched (stays true).
    if (mergedExplanation.length > 0) {
      return applyWizardTransition({
        chatId,
        updates: preservedData,
        nextStep: "diagnostic_loading",
        jeffBubble: "Let me pull your details back up. 🔎",
      });
    }
    // Forward with no concern entries at all (simple-only merged set) →
    // straight to scheduling.
    return applyWizardTransition({
      chatId,
      updates: preservedData,
      nextStep: "appointment_type",
      jeffBubble: "Got it — let me check the schedule! 📅",
    });
  }

  // ── ROUTING: new / unexplained concerns exist → re-run the explanation +
  // diagnostic flow (both modes). Reset diagnostic_processing_complete so
  // run-diagnostics does the work; keep the pruned answered map + surviving
  // recs (run-diagnostics re-derives pending + recs, but preserving them
  // avoids a flicker for surviving concerns). clarification_questions_pending
  // is cleared so the queue rebuilds cleanly.
  const forwardUpdates = {
    ...preservedData,
    diagnostic_processing_complete: false,
    clarification_questions_pending: [],
  };
  if (mode === "hub") {
    return applyWizardTransition({
      chatId,
      updates: forwardUpdates,
      nextStep: "concern_explanation",
      userBubble: "Update my services",
      jeffBubble:
        "Got it — tell me a little about the new one and I'll match up what we should test. 🤔",
    });
  }
  return applyWizardTransition({
    chatId,
    updates: forwardUpdates,
    nextStep: "concern_explanation",
    jeffBubble:
      "Tell me a little about each one and I'll match up what we should test. 🤔",
  });
}

export const submitServiceAndConcernPickerV2 = wrapAction(
  "submitServiceAndConcernPickerV2",
  submitServiceAndConcernPickerV2Impl,
);
