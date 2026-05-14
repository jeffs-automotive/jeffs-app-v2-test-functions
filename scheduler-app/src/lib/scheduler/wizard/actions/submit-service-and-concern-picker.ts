"use server";

/**
 * Step 7.1 — Service + concern picker submit (V2, server-state-driven).
 *
 * Per chat-design.md §Step 7.1 + the Architecture amendment — 2026-05-14.
 *
 * Branches per V1 (which matches the actual card's single-concern-textarea
 * UX, NOT the spec's per-chip explanation flow — see card-payloads.ts
 * comment for the rationale):
 *
 *   - concern_text present → advance to 'diagnostic_loading'.
 *     Phase 9 wires the diagnostic LLM specialist from there.
 *   - no concern_text → skip Steps 7.2-7.6 entirely, advance directly to
 *     'appointment_type'.
 *
 * Keyword-escalation scan runs FIRST on the concern_text (spec §A). A hit
 * routes to escalated terminal state without persisting the picks —
 * intentional: the customer's flagged concern shouldn't sit on the row
 * silently waiting for the LLM specialist to ignore the trigger.
 *
 * Both services list and concern (when present) are persisted so Phase 9
 * (diagnostic flow) + Phase 12 (summary) can read them via the same row
 * shape as V1.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { scanForEscalationKeywords } from "@/lib/scheduler/escalation-keywords";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";

const submitServiceAndConcernPickerSchema = z.object({
  chatId: z.string().min(1),
  services: z.array(z.string().min(1)),
  concern_text: z.string().trim().optional(),
});

export type SubmitServiceAndConcernPickerV2Args = z.infer<
  typeof submitServiceAndConcernPickerSchema
>;

export async function submitServiceAndConcernPickerV2(
  args: SubmitServiceAndConcernPickerV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitServiceAndConcernPickerSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, services, concern_text } = parsed.data;

  // The card itself enforces "at least one service OR a concern" before
  // calling here; defensive server-side check matches.
  if (services.length === 0 && !concern_text) {
    return {
      ok: false,
      error: "Pick at least one service or describe a concern.",
    };
  }

  const hasConcern = !!concern_text && concern_text.length > 0;

  try {
    // Escalation keyword scan FIRST — covers "lawyer / refund / manager /
    // …". A hit routes to escalated without persisting picks (the row's
    // selected_simple_services / explanation_required_items stay null,
    // which matches the chat-design.md intent: the flagged concern shouldn't
    // be quietly carried forward by the wizard).
    if (hasConcern) {
      const hit = scanForEscalationKeywords(concern_text);
      if (hit) {
        return applyWizardTransition({
          chatId,
          updates: {
            status: "escalated",
            escalated_at: new Date().toISOString(),
            escalation_reason: `keyword:${hit.category}:${hit.keyword}`,
          },
          nextStep: "escalated",
          jeffBubble:
            "Let me get a real person on this one — please call us at (610) 253-6565 and we'll take great care of you. 📞",
        });
      }
    }

    // Persist the picks. explanation_required_items wraps the concern as
    // a pseudo-item with service_key='concern' so Phase 9's diagnostic
    // specialist reads the same row shape regardless of which Server
    // Action wrote it (V1 used the same wrapping pattern).
    const explanationItems = hasConcern
      ? [{ service_key: "concern", explanation_text: concern_text }]
      : [];

    if (hasConcern) {
      return applyWizardTransition({
        chatId,
        updates: {
          selected_simple_services: services,
          explanation_required_items: explanationItems,
        },
        nextStep: "diagnostic_loading",
        jeffBubble:
          "Thanks for telling me — one moment while I think through what testing might be needed. 🤔",
      });
    }

    // No concern → skip Steps 7.2-7.6 entirely.
    return applyWizardTransition({
      chatId,
      updates: {
        selected_simple_services: services,
        explanation_required_items: [],
      },
      nextStep: "appointment_type",
      jeffBubble: "Got it — let me check the schedule! 📅",
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
