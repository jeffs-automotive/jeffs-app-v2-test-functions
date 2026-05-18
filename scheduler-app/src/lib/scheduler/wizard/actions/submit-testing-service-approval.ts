"use server";

/**
 * submitTestingServiceApprovalV2 — Step 7.5 submit (2026-05-17 restoration).
 *
 * Per chat-design.md §7.5: the customer ticks the testing services they
 * approve from the diagnostic LLM's recommendation list (or unticks to
 * decline). Both lists are persisted — the service team sees what was
 * recommended AND what was passed on in the transcript email.
 *
 * Validation: the approved + declined sets must be disjoint and their
 * union must be a subset of row.recommended_testing_services (which the
 * diagnostic LLM populated). We don't let the client invent service_keys.
 *
 * Advance: always to second_routine_pass after this step. The customer
 * may still add routine add-ons there before scheduling.
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
  approved: z.array(z.string().min(1)).max(20),
  declined: z.array(z.string().min(1)).max(20),
});

export type SubmitTestingServiceApprovalV2Args = z.infer<typeof inputSchema>;

async function submitTestingServiceApprovalV2Impl(
  args: SubmitTestingServiceApprovalV2Args,
): Promise<WizardTransitionResult> {
  const parsed = inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, approved, declined } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select("recommended_testing_services")
      .eq("id", chatId)
      .maybeSingle();
    if (rowErr || !row) {
      return { ok: false, error: rowErr?.message ?? "session_not_found" };
    }

    const recsRaw = (row as Record<string, unknown>).recommended_testing_services;
    const recommendedKeys = new Set<string>();
    if (Array.isArray(recsRaw)) {
      for (const entry of recsRaw as Array<Record<string, unknown>>) {
        if (typeof entry.service_key === "string") {
          recommendedKeys.add(entry.service_key);
        }
      }
    }

    // Validate: every approved/declined key must come from the
    // recommendation set written by the diagnostic LLM. The client
    // doesn't get to invent new approvals.
    const approvedSet = new Set(approved);
    const declinedSet = new Set(declined);
    const invalidApproved = [...approvedSet].filter(
      (k) => !recommendedKeys.has(k),
    );
    const invalidDeclined = [...declinedSet].filter(
      (k) => !recommendedKeys.has(k),
    );
    if (invalidApproved.length > 0 || invalidDeclined.length > 0) {
      Sentry.captureMessage(
        "submit_testing_service_approval_v2 invalid keys",
        {
          level: "warning",
          extra: { chatId, invalidApproved, invalidDeclined },
        },
      );
      return { ok: false, error: "invalid_service_keys" };
    }
    const overlap = [...approvedSet].filter((k) => declinedSet.has(k));
    if (overlap.length > 0) {
      return { ok: false, error: "approved_declined_overlap" };
    }

    const approvedDedup = Array.from(approvedSet);
    const declinedDedup = Array.from(declinedSet);

    const jeffBubble =
      approvedDedup.length > 0
        ? "Locked in those tests. Want to add any routine services before we schedule? 🛠️"
        : "Got it — no testing services this visit. Want to add any routine services before we schedule? 🛠️";

    return applyWizardTransition({
      chatId,
      updates: {
        approved_testing_services: approvedDedup,
        declined_testing_services: declinedDedup,
      },
      nextStep: "second_routine_pass",
      jeffBubble,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_testing_service_approval_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_testing_service_approval_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { approved_count: approved.length, declined_count: declined.length },
    });
    return { ok: false, error: msg };
  }
}

export const submitTestingServiceApprovalV2 = wrapAction(
  "submitTestingServiceApprovalV2",
  submitTestingServiceApprovalV2Impl,
);
