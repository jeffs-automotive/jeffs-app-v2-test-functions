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
 * Count the recommended_testing_services entries on the row without
 * fully reshaping the payload — just need a non-zero check for routing.
 */
function countRecommendedServices(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let n = 0;
  for (const entry of raw) {
    if (entry && typeof entry === "object") {
      const e = entry as Record<string, unknown>;
      if (typeof e.service_key === "string" && e.service_key.length > 0) {
        n += 1;
      }
    }
  }
  return n;
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
        "id, clarification_questions_pending, clarification_questions_answered, recommended_testing_services",
      )
      .eq("id", chatId)
      .maybeSingle();

    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }

    const pending = parsePending(row.clarification_questions_pending);
    const answered = parseAnswered(row.clarification_questions_answered);
    const recsCount = countRecommendedServices(
      (row as Record<string, unknown>).recommended_testing_services,
    );

    const head = pending[0];
    if (!head) {
      // Queue already drained (likely a stale submit after a refresh).
      // Re-route based on whether the diagnostic LLM left any
      // recommendations on the row.
      const { nextStep, jeffBubble } = routeAfterDiagnostics({
        pending_count: 0,
        recommendation_count: recsCount,
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

    // Route at queue-drain time the same way run-diagnostics does:
    //   - more questions → clarification_question (next one)
    //   - drained + recommendations exist → testing_service_approval
    //   - drained + no recommendations → second_routine_pass + forward-
    //     to-advisor bubble
    const { nextStep, jeffBubble } = routeAfterDiagnostics({
      pending_count: nextPending.length,
      recommendation_count: recsCount,
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
    // visible to ensureConcernSummaries. Best-effort: a summarization
    // failure must not block the wizard advance — fall back to the
    // raw explanation_text downstream.
    if (nextPending.length === 0) {
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
        // eslint-disable-next-line no-console
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
