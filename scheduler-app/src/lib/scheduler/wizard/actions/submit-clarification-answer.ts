"use server";

/**
 * submitClarificationAnswerV2 — Phase 9a (2026-05-14) Server Action.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign:
 * One clarification card per pending question. The card lets the customer
 * either pick an answer option OR explicitly skip ("I'm not sure"). Both
 * count as "answered" for queue-advance purposes — skipping is a valid
 * signal in itself.
 *
 *   - Pops the head of `clarification_questions_pending`
 *   - Writes the chosen value (or the literal string "skipped") into
 *     `clarification_questions_answered[question_id]`
 *   - Advances to the next pending OR to 'second_routine_pass' when the
 *     queue drains.
 *
 * Concurrency note: we re-read the row and validate the submitted
 * question_id against the queue head. Mismatch → no-op + ok=false (the
 * page will re-render the current head card). This is the "double-tap"
 * defense — a customer who back-button-then-submits an old card doesn't
 * skip ahead of the actual queue.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { WizardStep } from "@/lib/scheduler/session-state";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import { routeAfterDiagnostics } from "@/lib/scheduler/wizard/route-after-diagnostics";
import { ensureConcernSummaries } from "@/lib/scheduler/wizard/ensure-concern-summaries";

const inputSchema = z.object({
  chatId: z.string().min(1),
  question_id: z.number().int().positive(),
  // { action: 'answer', value: '<option_value>' | ['v1','v2',...] } for
  // single OR multi-select; { action: 'skip' } either way.
  // Array shape added 2026-05-18 with the CAT-2 catalog rebuild.
  action: z.union([
    z.object({
      kind: z.literal("answer"),
      value: z.union([
        z.string().min(1).max(120),
        z.array(z.string().min(1).max(120)).min(1).max(20),
      ]),
    }),
    z.object({ kind: z.literal("skip") }),
  ]),
});

export type SubmitClarificationAnswerV2Args = z.infer<typeof inputSchema>;

interface PendingQuestionEntry {
  question_id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  service_key: string;
  category: string;
  /** Mirrors `concern_questions.multi_select`. Drives validation:
   *  multi-select questions accept string[] of values; single-select
   *  accept a single string. Added 2026-05-18 with CAT-2 rebuild. */
  multi_select: boolean;
}

function parsePending(raw: unknown): PendingQuestionEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      const question_id =
        typeof obj.question_id === "number" ? obj.question_id : null;
      const question_text =
        typeof obj.question_text === "string" ? obj.question_text : null;
      const service_key =
        typeof obj.service_key === "string" ? obj.service_key : "";
      const category =
        typeof obj.category === "string" ? obj.category : "other";
      const optsRaw = Array.isArray(obj.options) ? obj.options : [];
      const options = optsRaw
        .map((o) => {
          if (!o || typeof o !== "object") return null;
          const oo = o as Record<string, unknown>;
          return typeof oo.label === "string" && typeof oo.value === "string"
            ? { label: oo.label, value: oo.value }
            : null;
        })
        .filter(
          (x): x is { label: string; value: string } => x !== null,
        );
      if (question_id === null || question_text === null) return null;
      const multi_select = obj.multi_select === true;
      return {
        question_id,
        question_text,
        options,
        service_key,
        category,
        multi_select,
      } satisfies PendingQuestionEntry;
    })
    .filter((x): x is PendingQuestionEntry => x !== null);
}

function parseAnswered(
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

/**
 * Extract service_key strings from either a recommended_testing_services
 * array (objects with a `service_key`) OR an approved/declined array (bare
 * strings). Used to compute the INV-8 UNDECIDED recommendation count.
 */
function parseServiceKeyList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.length > 0) out.push(entry);
      continue;
    }
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      if (typeof e.service_key === "string" && e.service_key.length > 0) {
        out.push(e.service_key);
      }
    }
  }
  return out;
}

/**
 * INV-8: routeAfterDiagnostics is passed the UNDECIDED recommendation count
 * = recommended − approved − declined. The approval card renders only the
 * undecided recs; routing on the raw recommended count would strand the
 * customer on an empty approval card when every rec is already decided.
 */
function countUndecidedRecommendations(
  recommendedRaw: unknown,
  approvedRaw: unknown,
  declinedRaw: unknown,
): number {
  const approved = new Set(parseServiceKeyList(approvedRaw));
  const declined = new Set(parseServiceKeyList(declinedRaw));
  return parseServiceKeyList(recommendedRaw).filter(
    (k) => !approved.has(k) && !declined.has(k),
  ).length;
}

/** Count object-shaped queue entries (concern_triage_state /
 *  concern_clarify_candidates) for the INV-4 drained-branch routing. */
function countQueueEntries(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((e) => e && typeof e === "object").length;
}

/**
 * B5/INV-4 — route once the clarification queue drains. Priority:
 *   pending non-empty        → clarification_question (ask the next one)
 *   triage-queue non-empty   → concern_triage    (a vague concern still owed)
 *   clarify-queue non-empty  → concern_clarify   (a 2-3-candidate tap still owed)
 *   else                     → routeAfterDiagnostics(undecided recs)
 * Without the triage/clarify checks a stale/drained submit would route
 * straight past a pending queue and orphan it.
 */
function routeDrained(args: {
  pending_count: number;
  triage_count: number;
  clarify_count: number;
  undecided_count: number;
}): { nextStep: WizardStep; jeffBubble: string | undefined } {
  if (args.pending_count > 0) {
    return routeAfterDiagnostics({
      pending_count: args.pending_count,
      recommendation_count: args.undecided_count,
    });
  }
  if (args.triage_count > 0) {
    return { nextStep: "concern_triage", jeffBubble: undefined };
  }
  if (args.clarify_count > 0) {
    return { nextStep: "concern_clarify", jeffBubble: undefined };
  }
  return routeAfterDiagnostics({
    pending_count: 0,
    recommendation_count: args.undecided_count,
  });
}

async function submitClarificationAnswerV2Impl(
  args: SubmitClarificationAnswerV2Args,
): Promise<WizardTransitionResult> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, question_id, action } = parsed.data;

  // Bug fix 2026-05-16 (R4-IMPORTANT-D-4): every other V2 action wraps
  // the body in try/catch with Sentry + logError. This one previously
  // had none — uncaught throws from applyWizardTransition or the parse
  // helpers became opaque Server Action rejections with no breadcrumb.
  try {
    const supabase = createSupabaseAdminClient();

    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select(
        // current_step → B5 step guard; approved/declined → INV-8 undecided
        // count; concern_triage_state (new column) + concern_clarify_candidates
        // → INV-4 triage-and-clarify-aware drained routing.
        "id, current_step, clarification_questions_pending, clarification_questions_answered, recommended_testing_services, approved_testing_services, declined_testing_services, concern_triage_state, concern_clarify_candidates",
      )
      .eq("id", chatId)
      .maybeSingle();

    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }

    // B5 step guard: the wizard must actually be on the clarification card.
    // A stale submit (back-button then submit after the wizard already moved
    // on) must NOT drain/route — it would orphan a pending triage/clarify
    // queue. Mirrors submit-concern-clarify's stale-current_step guard.
    if ((row.current_step as string | null) !== "clarification_question") {
      Sentry.captureMessage(
        "submit_clarification_answer_v2 stale current_step",
        {
          level: "warning",
          extra: { chatId, current_step: row.current_step },
        },
      );
      return { ok: false, error: "stale_current_step" };
    }

    const pending = parsePending(row.clarification_questions_pending);
    const answered = parseAnswered(row.clarification_questions_answered);
    const undecidedCount = countUndecidedRecommendations(
      (row as Record<string, unknown>).recommended_testing_services,
      (row as Record<string, unknown>).approved_testing_services,
      (row as Record<string, unknown>).declined_testing_services,
    );
    // INV-4 drained-branch queues (concern_triage_state is a new column —
    // typed once database.types.ts regenerates; WIRING owns that file).
    const triageCount = countQueueEntries(
      (row as Record<string, unknown>).concern_triage_state,
    );
    const clarifyCount = countQueueEntries(
      (row as Record<string, unknown>).concern_clarify_candidates,
    );

    const head = pending[0];
    if (!head) {
      // Queue already drained (a stale submit after a refresh). Re-route
      // triage-and-clarify-aware (B5) so a pending queue is never orphaned.
      const { nextStep, jeffBubble } = routeDrained({
        pending_count: 0,
        triage_count: triageCount,
        clarify_count: clarifyCount,
        undecided_count: undecidedCount,
      });
      return applyWizardTransition({ chatId, nextStep, jeffBubble });
    }

    if (head.question_id !== question_id) {
      Sentry.captureMessage(
        "submit_clarification_answer_v2 queue head mismatch",
        {
          level: "warning",
          extra: {
            chatId,
            submitted_question_id: question_id,
            actual_head_question_id: head.question_id,
            pending_count: pending.length,
          },
        },
      );
      return { ok: false, error: "queue_head_mismatch" };
    }

    // Validate the answer values when 'answer'. Multi-select questions
    // accept string[]; single-select accept a single string. Validation
    // rejects: shape mismatches, empty arrays, unknown option values,
    // and duplicate values in the array.
    if (action.kind === "answer") {
      if (head.multi_select) {
        const values = Array.isArray(action.value)
          ? action.value
          : [action.value];
        if (values.length === 0) {
          return { ok: false, error: "empty_answer" };
        }
        const seen = new Set<string>();
        for (const v of values) {
          if (seen.has(v)) {
            return { ok: false, error: "duplicate_option_value" };
          }
          seen.add(v);
          if (!head.options.some((o) => o.value === v)) {
            return { ok: false, error: "invalid_option_value" };
          }
        }
      } else {
        if (Array.isArray(action.value)) {
          return { ok: false, error: "array_value_for_single_select" };
        }
        const valid = head.options.some((o) => o.value === action.value);
        if (!valid) {
          return { ok: false, error: "invalid_option_value" };
        }
      }
    }

    // Storage shape:
    //   skipped → "skipped"
    //   single-select → "value" (string, back-compat)
    //   multi-select  → ["v1","v2"] (array — handled by consumers since 2026-05-18)
    //
    // The single-select-with-array-value case is already validation-rejected
    // above (`array_value_for_single_select`), so by this point single-select
    // implies action.value is a single string.
    let writeValue: string | string[];
    if (action.kind === "skip") {
      writeValue = "skipped";
    } else if (head.multi_select) {
      writeValue = Array.isArray(action.value) ? action.value : [action.value];
    } else {
      // Single-select: validated above; action.value is a string.
      writeValue = action.value as string;
    }

    const nextAnswered: Record<string, string | string[]> = {
      ...answered,
      [String(question_id)]: writeValue,
    };
    const nextPending = pending.slice(1);

    // Customer-facing bubble shows the chosen label(s) joined with " · ".
    // Capture head's options in a local so the nested closure keeps TS's
    // narrowing (head is non-null here per the early-return above).
    const headOptions = head.options;
    const lookupLabel = (v: string): string =>
      headOptions.find((o) => o.value === v)?.label ?? v;
    const userBubble =
      action.kind === "skip"
        ? "I'm not sure"
        : Array.isArray(writeValue)
          ? writeValue.map(lookupLabel).join(" · ")
          : lookupLabel(writeValue);

    // Route at queue-drain time (B5/INV-4 triage-and-clarify-aware):
    //   - more questions → clarification_question (next one)
    //   - drained + triage queue → concern_triage
    //   - drained + clarify queue → concern_clarify
    //   - drained + undecided recs → testing_service_approval
    //   - drained + none → second_routine_pass + forward-to-advisor bubble
    const { nextStep, jeffBubble } = routeDrained({
      pending_count: nextPending.length,
      triage_count: triageCount,
      clarify_count: clarifyCount,
      undecided_count: undecidedCount,
    });

    const transitionResult = await applyWizardTransition({
      chatId,
      updates: {
        clarification_questions_pending: nextPending,
        clarification_questions_answered: nextAnswered,
      },
      nextStep,
      userBubble,
      jeffBubble,
    });

    // Queue just drained → synthesize the per-concern "Customer states ..."
    // summaries before the customer reaches the Tekmetric description
    // builder. Run AFTER the transition so the freshly-answered row is
    // visible to ensureConcernSummaries. Deferred while a triage/clarify
    // concern is still owed (routed to concern_triage / concern_clarify) —
    // the pipeline isn't done, mirroring run-diagnostics' clarify gate.
    // Best-effort: a summarization failure must not block the wizard advance
    // — fall back to the raw explanation_text downstream.
    if (nextPending.length === 0 && triageCount === 0 && clarifyCount === 0) {
      try {
        await ensureConcernSummaries({ chatId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Sentry.captureException(e, {
          tags: {
            surface: "submit_clarification_answer_v2_summarize",
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

    return transitionResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_clarification_answer_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_clarification_answer_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { question_id, action_kind: action.kind },
    });
    return { ok: false, error: msg };
  }
}

export const submitClarificationAnswerV2 = wrapAction(
  "submitClarificationAnswerV2",
  submitClarificationAnswerV2Impl,
);
