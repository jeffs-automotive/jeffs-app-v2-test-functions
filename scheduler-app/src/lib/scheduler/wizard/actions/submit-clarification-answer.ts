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

const inputSchema = z.object({
  chatId: z.string().min(1),
  question_id: z.number().int().positive(),
  // either { action: 'answer', value: '<option_value>' } or { action: 'skip' }
  action: z.union([
    z.object({
      kind: z.literal("answer"),
      value: z.string().min(1).max(120),
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
      return {
        question_id,
        question_text,
        options,
        service_key,
        category,
      } satisfies PendingQuestionEntry;
    })
    .filter((x): x is PendingQuestionEntry => x !== null);
}

function parseAnswered(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
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
        "id, clarification_questions_pending, clarification_questions_answered",
      )
      .eq("id", chatId)
      .maybeSingle();

    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }

    const pending = parsePending(row.clarification_questions_pending);
    const answered = parseAnswered(row.clarification_questions_answered);

    const head = pending[0];
    if (!head) {
      // Queue already drained (likely a stale submit after a refresh).
      // Just skip ahead to second_routine_pass without changing answered
      // state.
      return applyWizardTransition({
        chatId,
        nextStep: "second_routine_pass",
      });
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

    // Validate the answer value is one of the allowed options when 'answer'.
    if (action.kind === "answer") {
      const valid = head.options.some((o) => o.value === action.value);
      if (!valid) {
        return { ok: false, error: "invalid_option_value" };
      }
    }

    const writeValue = action.kind === "skip" ? "skipped" : action.value;
    const nextAnswered: Record<string, string> = {
      ...answered,
      [String(question_id)]: writeValue,
    };
    const nextPending = pending.slice(1);

    const userBubble = action.kind === "skip"
      ? "I'm not sure"
      : head.options.find((o) => o.value === action.value)?.label ?? action.value;

    const nextStep = nextPending.length > 0
      ? ("clarification_question" as const)
      : ("second_routine_pass" as const);

    const jeffBubble = nextPending.length > 0
      ? undefined
      : "Thanks — that's everything I needed. Let me check the schedule! 📅";

    return applyWizardTransition({
      chatId,
      updates: {
        clarification_questions_pending: nextPending,
        clarification_questions_answered: nextAnswered,
      },
      nextStep,
      userBubble,
      jeffBubble,
    });
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
