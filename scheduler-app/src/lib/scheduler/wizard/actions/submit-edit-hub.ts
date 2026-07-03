"use server";

/**
 * Step 10.2 submit — summary edit hub (task EH1, 2026-07-04).
 *
 * The hub (`summary_edit_hub` step) lets the customer jump into ONE section
 * to edit, keeping every other section's data intact, then come back to the
 * hub and edit another — or finish and return to the summary. See
 * docs/scheduler/summary-edit-hub-plan.md.
 *
 * Input: { chatId, section }. Routing per section:
 *
 *   - "done"     → clear edit_return_step (explicit null) + nextStep summary.
 *   - "contact"  → set edit_return_step='summary_edit_hub' + customer_info_edit.
 *   - "vehicle"  → set edit_return_step='summary_edit_hub' + vehicle_pick.
 *   - "services" → set edit_return_step='summary_edit_hub' + service_concern_picker.
 *   - "time"     → set edit_return_step='summary_edit_hub' + release the
 *                  existing hold (same mechanics as submit-back) + date_pick.
 *                  The date→time flow clears edit_return_step when it lands
 *                  on summary, so the "time" edit ends at summary (not the
 *                  hub) — matching the plan's slot-edits-end-at-summary rule.
 *
 * The edit_return_step flag STAYS set while a section is being edited: the
 * section-edit actions (submit-customer-info-edit, submit-vehicle-pick,
 * submit-service-and-concern-picker) read it and route BACK to the hub, so
 * the customer can edit multiple sections in a row. Only "done" (and the
 * date/time flow's landing on summary, and start-over) clears it.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import { releaseSessionHold } from "@/lib/scheduler/wizard/release-hold";

const EDIT_RETURN_STEP = "summary_edit_hub";

const submitEditHubSchema = z.object({
  chatId: z.string().min(1),
  section: z.enum(["contact", "vehicle", "services", "time", "done"]),
});

export type SubmitEditHubV2Args = z.infer<typeof submitEditHubSchema>;
export type EditHubSection = SubmitEditHubV2Args["section"];

async function submitEditHubV2Impl(
  args: SubmitEditHubV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitEditHubSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, section } = parsed.data;

  try {
    // Done → clear the flag and go back to the summary card.
    if (section === "done") {
      return applyWizardTransition({
        chatId,
        updates: { edit_return_step: null },
        nextStep: "summary",
        userBubble: "That all looks right",
        jeffBubble: "Great — here's your summary. Ready when you are. ✨",
      });
    }

    if (section === "contact") {
      return applyWizardTransition({
        chatId,
        updates: { edit_return_step: EDIT_RETURN_STEP },
        nextStep: "customer_info_edit",
        userBubble: "Edit my contact info",
        jeffBubble: "Sure — update anything below and I'll save it. 👤",
      });
    }

    if (section === "vehicle") {
      return applyWizardTransition({
        chatId,
        updates: { edit_return_step: EDIT_RETURN_STEP },
        nextStep: "vehicle_pick",
        userBubble: "Edit my vehicle",
        jeffBubble: "Got it — pick the right vehicle below. 🚙",
      });
    }

    if (section === "services") {
      return applyWizardTransition({
        chatId,
        updates: { edit_return_step: EDIT_RETURN_STEP },
        nextStep: "service_concern_picker",
        userBubble: "Edit my services",
        jeffBubble:
          "No problem — adjust the services below. Anything you already picked is still selected. 🛠️",
      });
    }

    // section === "time" — release the current hold (identical mechanics to
    // submit-back's hold release) so re-picking a date/time forms a fresh
    // hold rather than double-holding the slot. Clear hold_token on the row
    // in the same transition. edit_return_step is set so the date→time flow
    // knows this edit originated at the hub (it clears the flag when it
    // reaches summary).
    const supabase = createSupabaseAdminClient();
    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select("hold_token")
      .eq("id", chatId)
      .maybeSingle();
    if (rowErr) {
      return { ok: false, error: rowErr.message };
    }
    const holdToken =
      row && typeof row.hold_token === "string" && row.hold_token.length > 0
        ? row.hold_token
        : null;
    if (holdToken) {
      await releaseSessionHold(supabase, holdToken);
    }

    return applyWizardTransition({
      chatId,
      updates: {
        edit_return_step: EDIT_RETURN_STEP,
        // Clear hold_token so re-entry forms a fresh hold (mirrors
        // submit-back's leaving-the-hold-zone write).
        hold_token: null,
      },
      nextStep: "date_pick",
      userBubble: "Edit my appointment time",
      jeffBubble: "Sure — pick a different day below and I'll re-check. 📅",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_edit_hub_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_edit_hub_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { section },
    });
    return { ok: false, error: msg };
  }
}

export const submitEditHubV2 = wrapAction("submitEditHubV2", submitEditHubV2Impl);
