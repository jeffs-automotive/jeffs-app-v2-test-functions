"use server";

/**
 * Step 9.2 submit — waiter time pick (Phase 11, 2026-05-15).
 *
 * Per chat-design.md §Step 9.2 (lines 2313-2351). Customer taps 08:00 or
 * 09:00 on the waiter time picker; we:
 *   1. Validate the time string against the small accepted set.
 *   2. Write `appointment_time` to the row.
 *   3. Call scheduler-booking-direct `hold_slot` with type='waiter'.
 *   4. On success → advance to 'summary' (the edge function persisted
 *      hold_token to the row).
 *   5. On race-lost → bounce back to 'date_pick' with a clarifying bubble
 *      so the customer re-picks against fresh availability (the spec's
 *      "auto-fall-back" path in §2338-2342).
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  holdSlot,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { buildServiceSummary } from "@/lib/scheduler/wizard/build-service-summary";

const submitWaiterTimeSchema = z.object({
  chatId: z.string().min(1),
  selected_time: z.enum(["08:00", "09:00"]),
});

export type SubmitWaiterTimeV2Args = z.infer<typeof submitWaiterTimeSchema>;

export async function submitWaiterTimeV2(
  args: SubmitWaiterTimeV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitWaiterTimeSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, selected_time } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select("appointment_date, customer_id, vehicle_id")
      .eq("id", chatId)
      .maybeSingle();
    if (rowErr || !row) {
      return {
        ok: false,
        error: rowErr?.message ?? "session_not_found",
      };
    }
    const date = (row.appointment_date as string | null) ?? "";
    if (!date) {
      // Phase 11 always sets appointment_date before advancing to
      // waiter_time_pick; defensive bounce if it's missing.
      return applyWizardTransition({
        chatId,
        nextStep: "date_pick",
        jeffBubble:
          "Let's pick the day first — tap a date and I'll show you the times. 📅",
      });
    }

    // Hold first; write appointment_time atomically with the final
    // transition so a hold failure doesn't leave the row in a half-state
    // with a time recorded but no hold_token to back it.
    const serviceSummary = await buildServiceSummary({ chatId });
    let hold: Awaited<ReturnType<typeof holdSlot>>;
    try {
      hold = await holdSlot({
        op: "hold_slot",
        session_id: chatId,
        date,
        time: selected_time,
        type: "waiter",
        service_summary: serviceSummary,
        customer_id:
          typeof row.customer_id === "number" ? row.customer_id : undefined,
        vehicle_id:
          typeof row.vehicle_id === "number" ? row.vehicle_id : undefined,
      });
    } catch (e) {
      // Bug audit 2026-05-16: previously terminal-escalated on a single
      // transient throw. Phase 1 policy now: bounce back to date_pick
      // (where the customer can retry the same day or pick another).
      Sentry.captureException(e, {
        tags: {
          surface: "submit_waiter_time_v2_hold_call",
          reason:
            e instanceof BookingDirectError
              ? `booking_direct_${e.status ?? "network"}`
              : "booking_direct_unknown",
        },
        level: "warning",
      });
      return applyWizardTransition({
        chatId,
        nextStep: "date_pick",
        jeffBubble:
          "Hmm, my system hiccuped reserving that slot. Let me re-check availability — pick a day below. 📅",
      });
    }

    if (!hold.ok) {
      // Race-lost on the picked time. Per chat-design.md §2338-2342: bounce
      // back to date_pick. The next render's getCurrentCard re-computes
      // available_dates so the customer sees the updated set (which may
      // not include the just-filled day at all).
      return applyWizardTransition({
        chatId,
        nextStep: "date_pick",
        jeffBubble: raceLostBubble(hold.error),
      });
    }

    return applyWizardTransition({
      chatId,
      updates: { appointment_time: selected_time },
      nextStep: "summary",
      jeffBubble: "Locked it in! Take a look — does this look right? ✨",
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_waiter_time_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function raceLostBubble(reason: string | undefined): string {
  if (reason === "slot_just_taken") {
    return "That time just got booked — let me show you the next openings. 📅";
  }
  return "Couldn't lock that one in — pick another day and I'll re-check. 📅";
}
