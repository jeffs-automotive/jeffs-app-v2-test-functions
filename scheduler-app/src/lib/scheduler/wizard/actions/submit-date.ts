"use server";

/**
 * Step 9.1 submit — date pick (Phase 11, 2026-05-15).
 *
 * Per chat-design.md §Step 9 (lines 2265-2424). Customer taps a date on
 * the calendar; we:
 *   1. Validate the date string is YYYY-MM-DD format.
 *   2. Write `appointment_date` to the row.
 *   3. Read `appointment_type` (set in Phase 10 / Step 8) to decide what
 *      happens next:
 *        - waiter  → advance to 'waiter_time_pick' (Step 9.2 picks the
 *          8/9 AM slot before holding).
 *        - dropoff → place the hold directly via scheduler-booking-direct
 *          `hold_slot` op and advance to 'summary'.
 *   4. On hold race-lost (someone booked between page load and tap):
 *      stay on 'date_pick' with a clarifying bubble; the next render
 *      re-fetches available_dates so the customer sees the updated set.
 *
 * Hold persistence: the edge function writes `hold_token` to the chat
 * session row itself (scheduler-booking-direct line 559), so this action
 * doesn't have to manage hold_token directly.
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

const submitDateSchema = z.object({
  chatId: z.string().min(1),
  selected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
});

export type SubmitDateV2Args = z.infer<typeof submitDateSchema>;

export async function submitDateV2(
  args: SubmitDateV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitDateSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, selected_date } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: row, error: rowErr } = await supabase
      .from("customer_chat_sessions")
      .select("appointment_type, customer_id, vehicle_id")
      .eq("id", chatId)
      .maybeSingle();
    if (rowErr || !row) {
      return {
        ok: false,
        error: rowErr?.message ?? "session_not_found",
      };
    }
    const apptType = (row.appointment_type as "waiter" | "dropoff" | null) ??
      null;
    if (apptType === null) {
      // Shouldn't normally happen — Phase 10 always writes appointment_type
      // before advancing to date_pick. Defensive escalation if it does.
      return applyWizardTransition({
        chatId,
        nextStep: "escalated",
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: "missing_appointment_type_at_date_pick",
        },
        jeffBubble:
          "Something got out of sync on my end — please call us at (610) 253-6565 and we'll take great care of you. 📞",
      });
    }

    // Waiter path: just write the date + advance to time picker.
    if (apptType === "waiter") {
      return applyWizardTransition({
        chatId,
        updates: { appointment_date: selected_date },
        nextStep: "waiter_time_pick",
      });
    }

    // Dropoff path: hold the slot now (no time picker), then advance to
    // summary. The edge function writes hold_token + appointment_holds row
    // on success. We don't pre-write appointment_date because the hold
    // outcome decides whether we advance to summary or bounce back to
    // date_pick — and either way the final applyWizardTransition writes
    // the date column atomically with the step change.
    const serviceSummary = await buildServiceSummary({ chatId });
    let hold: Awaited<ReturnType<typeof holdSlot>>;
    try {
      hold = await holdSlot({
        op: "hold_slot",
        session_id: chatId,
        date: selected_date,
        type: "dropoff",
        service_summary: serviceSummary,
        customer_id:
          typeof row.customer_id === "number" ? row.customer_id : undefined,
        vehicle_id:
          typeof row.vehicle_id === "number" ? row.vehicle_id : undefined,
      });
    } catch (e) {
      // Bug audit 2026-05-16: previously this terminally escalated on a
      // single transient throw (network blip, edge fn cold-start timeout).
      // The customer would land at the EscalationCard with no way back.
      // Phase 1 policy now: bounce back to date_pick with a "try again"
      // bubble so the customer can retry the same day or pick another.
      // If the throw is persistent the customer can fall back via the
      // page-footer "Talk to a person" button.
      Sentry.captureException(e, {
        tags: {
          surface: "submit_date_v2_hold_call",
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
          "Hmm, my system hiccuped reserving that day. Let me re-check availability — pick a day below and I'll try again. 📅",
      });
    }

    if (!hold.ok) {
      // 'slot_just_taken' or other race-lost cases: bounce back to
      // date_pick so the customer sees the refreshed availability set.
      return applyWizardTransition({
        chatId,
        nextStep: "date_pick",
        jeffBubble: raceLostBubble(hold.error),
      });
    }

    return applyWizardTransition({
      chatId,
      updates: { appointment_date: selected_date },
      nextStep: "summary",
      jeffBubble: "Locked it in! Take a look — does this look right? ✨",
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_date_v2" },
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
    return "That day just got booked up — let me show you the updated list. 📅";
  }
  return "Couldn't reserve that day — pick another and I'll try again. 📅";
}
