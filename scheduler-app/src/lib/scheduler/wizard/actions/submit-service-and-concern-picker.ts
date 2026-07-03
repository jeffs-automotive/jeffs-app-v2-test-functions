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
    out.push(item);
  }
  return out;
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
    const explanationItems: Array<{
      service_key: string;
      display_name: string;
      explanation_text: string;
      category: string | null;
    }> = [];

    const unknownPicks: string[] = [];

    for (const key of uniquePicks) {
      // Other Issue is a fixed pseudo-chip (not in any DB table). Treat
      // it as a requires_explanation chip with no pre-resolved category
      // — the diagnostic LLM classifies + recommends from the customer's
      // free-text description in the next step.
      if (key === OTHER_ISSUE_SERVICE_KEY) {
        explanationItems.push({
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

    // ── SMART MERGE (summary edit hub, task EH1) ─────────────────────────
    // When this submit is an EDIT reached from the hub, do NOT wipe the
    // customer's diagnostic work. Concern entries whose service_key survives
    // KEEP their explanation_text / unanswered_question_ids / summary; removed
    // keys drop; brand-new picks get the normal empty-entry treatment. See
    // docs/scheduler/summary-edit-hub-plan.md §C + the Decisions-during-
    // implement note.
    if (fromHub) {
      return await applyMerge({
        chatId,
        supabase,
        newSimpleServices: simpleServices,
        newApprovedTesting: approvedTesting,
        newExplanationItems: explanationItems,
        existingExplanation: parseExistingExplanationItems(
          sessionRow?.explanation_required_items,
        ),
        existingAnswered: parseExistingAnswered(
          sessionRow?.clarification_questions_answered,
        ),
        existingRecommended: parseExistingRecommended(
          sessionRow?.recommended_testing_services,
        ),
        existingDeclined: Array.isArray(sessionRow?.declined_testing_services)
          ? (sessionRow?.declined_testing_services as string[])
          : [],
      });
    }

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
  supabase: ReturnType<typeof createSupabaseAdminClient>;
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
      // Surviving concern — keep its diagnostic work verbatim (the new
      // pick's empty explanation_text/category are discarded in favor of
      // the survivor's populated ones).
      mergedExplanation.push(survivor);
      // A survivor still counts as "unexplained" (needs the explanation
      // step) if its explanation_text is empty — e.g. the customer added
      // it last time but bailed before typing anything.
      if (!survivor.explanation_text) hasNewOrUnexplained = true;
    } else {
      // Brand-new concern — normal empty-entry treatment.
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

  // Decision (#8 landing): only re-run diagnostics when new/unexplained
  // concerns exist. Otherwise the diagnostic state is fully intact — go
  // straight back to the hub, no re-diagnosis. When new concerns DO exist
  // the customer walks the normal concern_explanation → diagnostics →
  // approval flow forward; edit_return_step STAYS set (only the slot flow's
  // landing on summary / hub "done" / start-over clears it), so the new
  // concern legitimately continues forward to summary via the appointment
  // steps. See the plan's Decisions-during-implement note.
  if (!hasNewOrUnexplained) {
    return applyWizardTransition({
      chatId,
      updates: {
        selected_simple_services: newSimpleServices,
        approved_testing_services: mergedApproved,
        explanation_required_items: mergedExplanation,
        clarification_questions_answered: mergedAnswered,
        recommended_testing_services: mergedRecommended,
        declined_testing_services: mergedDeclined,
        // Untouched: diagnostic_processing_complete stays true (no
        // re-diagnosis). clarification_questions_pending is already drained.
      },
      nextStep: "summary_edit_hub",
      userBubble: "Update my services",
      jeffBubble: "Updated your services. ✅",
    });
  }

  // New / unexplained concerns exist → re-run the explanation + diagnostic
  // flow. Reset diagnostic_processing_complete so run-diagnostics does the
  // work; keep the pruned answered map + surviving recs (run-diagnostics
  // re-derives pending questions + recs, but preserving them avoids a
  // flicker for the surviving concerns). clarification_questions_pending is
  // cleared so the queue rebuilds cleanly.
  return applyWizardTransition({
    chatId,
    updates: {
      selected_simple_services: newSimpleServices,
      approved_testing_services: mergedApproved,
      explanation_required_items: mergedExplanation,
      diagnostic_processing_complete: false,
      clarification_questions_pending: [],
      clarification_questions_answered: mergedAnswered,
      recommended_testing_services: mergedRecommended,
      declined_testing_services: mergedDeclined,
    },
    nextStep: "concern_explanation",
    userBubble: "Update my services",
    jeffBubble:
      "Got it — tell me a little about the new one and I'll match up what we should test. 🤔",
  });
}

export const submitServiceAndConcernPickerV2 = wrapAction(
  "submitServiceAndConcernPickerV2",
  submitServiceAndConcernPickerV2Impl,
);
