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

/** Parse a TEXT[] column into a de-duplicated ordered string list, dropping
 *  non-string entries. Order is preserved for stable persisted output. */
function parseKeySet(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of raw) {
    if (typeof k === "string" && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

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
      .select(
        "recommended_testing_services, approved_testing_services, declined_testing_services",
      )
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

    // ── Symmetric approve/decline merge (D1 / INV-8) ────────────────────────
    // Do NOT overwrite either set. The customer may have explicitly picked
    // testing services back at Step 7.1 (submit-service-and-concern-picker
    // writes them to approved_testing_services); those picks are independent
    // of the diagnostic LLM's recommendations surfaced at this step. Prior
    // declines (from an earlier pass, or recs no longer surfaced this submit)
    // must ALSO survive — writing only this submit's declines silently loses
    // them.
    //
    // The write is symmetric: finalDeclined = (existingDeclined ∪ newDeclined)
    // − finalApproved. Crucially, every key the customer acted on in THIS
    // submit is cleared from BOTH prior sets FIRST (re-decline safety): a
    // re-decline of a previously-approved service must not be silently
    // stripped by the "− finalApproved" step, and a re-approval of a
    // previously-declined one likewise flips cleanly.
    const existingApproved = parseKeySet(
      (row as Record<string, unknown>).approved_testing_services,
    );
    const existingDeclined = parseKeySet(
      (row as Record<string, unknown>).declined_testing_services,
    );

    // Keys the customer explicitly acted on this submit — cleared from both
    // prior sets so the unions below are authoritative.
    const actedThisSubmit = new Set<string>([...approvedSet, ...declinedSet]);
    const baseApproved = existingApproved.filter(
      (k) => !actedThisSubmit.has(k),
    );
    const baseDeclined = existingDeclined.filter(
      (k) => !actedThisSubmit.has(k),
    );

    const finalApproved = Array.from(
      new Set([...baseApproved, ...approvedSet]),
    );
    const finalApprovedSet = new Set(finalApproved);
    const finalDeclined = Array.from(
      new Set([...baseDeclined, ...declinedSet]),
    ).filter((k) => !finalApprovedSet.has(k));

    const jeffBubble =
      finalApproved.length > 0
        ? "Locked in those tests. Want to add any routine services before we schedule? 🛠️"
        : "Got it — no testing services this visit. Want to add any routine services before we schedule? 🛠️";

    return applyWizardTransition({
      chatId,
      updates: {
        approved_testing_services: finalApproved,
        declined_testing_services: finalDeclined,
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
