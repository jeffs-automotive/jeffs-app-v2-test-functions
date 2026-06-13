"use server";

/**
 * Step 1 — Greeting submit (V2, server-state-driven).
 *
 * Per chat-design.md §Step 1 + the Architecture amendment — 2026-05-14: this
 * is a thin Server Action that writes the three greeting columns, advances
 * current_step to 'phone_name', appends a Jeff-voice transition bubble, and
 * revalidates the wizard page (via applyWizardTransition).
 *
 * This is the server-state-driven greeting action used by every scheduler
 * route (/ and /book).
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import {
  greetingBucketToBoolean,
  type GreetingBucket,
} from "@/lib/scheduler/session-state";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";

// Bug fix 2026-05-16 (R4-IMPORTANT-D-2): every other V2 action runs a
// .safeParse on entry; submit-greeting previously trusted the TS interface
// alone. Server Actions are exposed to untrusted clients — validate.
const submitGreetingSchema = z.object({
  chatId: z.string().min(1),
  is_returning: z.enum(["returning", "new", "unsure"]),
});

export type SubmitGreetingV2Args = z.infer<typeof submitGreetingSchema>;

async function submitGreetingV2Impl(
  args: SubmitGreetingV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitGreetingSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, is_returning } = parsed.data;

  try {
    return await applyWizardTransition({
      chatId,
      updates: {
        is_returning_customer: greetingBucketToBoolean(is_returning),
        customer_self_identified: is_returning,
        greeting_answered_at: new Date().toISOString(),
      },
      nextStep: "phone_name",
      jeffBubble: greetingBubble(is_returning),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: {
        surface: "submit_greeting_v2",
        bucket: is_returning,
        chat_id: chatId,
      },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_greeting_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { bucket: is_returning },
    });
    return { ok: false, error: msg };
  }
}

export const submitGreetingV2 = wrapAction(
  "submitGreetingV2",
  submitGreetingV2Impl,
);

/**
 * Bubble copy per chat-design.md §4a Jeff voice — warm + light emoji.
 * Inlined to keep each V2 Server Action self-contained.
 */
function greetingBubble(bucket: GreetingBucket): string {
  switch (bucket) {
    case "returning":
      return "Welcome back! 👋 Let me grab your info real quick.";
    case "new":
      return "Welcome to Jeff's! 👋 Let's get you set up.";
    case "unsure":
      return "No worries — let me grab a few details and we'll figure it out.";
  }
}
