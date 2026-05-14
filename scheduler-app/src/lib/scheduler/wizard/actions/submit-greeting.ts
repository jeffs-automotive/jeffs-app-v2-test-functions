"use server";

/**
 * Step 1 — Greeting submit (V2, server-state-driven).
 *
 * Per chat-design.md §Step 1 + the Architecture amendment — 2026-05-14: this
 * is a thin Server Action that writes the three greeting columns, advances
 * current_step to 'phone_name', appends a Jeff-voice transition bubble, and
 * revalidates the wizard page (via applyWizardTransition).
 *
 * Replaces the legacy submitGreeting in session-actions.ts. The legacy
 * action stays live for /book (the AI-SDK-driven surface) during the
 * migration; phase 16 deletes it.
 */
import * as Sentry from "@sentry/nextjs";

import {
  greetingBucketToBoolean,
  type GreetingBucket,
} from "@/lib/scheduler/session-state";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";

export interface SubmitGreetingV2Args {
  chatId: string;
  is_returning: GreetingBucket;
}

export async function submitGreetingV2(
  args: SubmitGreetingV2Args,
): Promise<WizardTransitionResult> {
  try {
    return await applyWizardTransition({
      chatId: args.chatId,
      updates: {
        is_returning_customer: greetingBucketToBoolean(args.is_returning),
        customer_self_identified: args.is_returning,
        greeting_answered_at: new Date().toISOString(),
      },
      nextStep: "phone_name",
      jeffBubble: greetingBubble(args.is_returning),
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_greeting_v2", bucket: args.is_returning },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Bubble copy per chat-design.md §4a Jeff voice — warm + light emoji.
 * Phase 14 may consolidate all bubble copy into a shared module; for now,
 * inline keeps the V2 Server Actions self-contained without depending on
 * the legacy bubble-templates.ts which is destined for deletion in phase 16.
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
