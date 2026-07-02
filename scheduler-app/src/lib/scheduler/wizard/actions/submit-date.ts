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
  getAppointmentTypeBySlug,
  laneFor,
} from "@/lib/scheduler/appointment-types";
import {
  holdSlot,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { buildServiceSummary } from "@/lib/scheduler/wizard/build-service-summary";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import { logError } from "@/lib/scheduler/wizard/log-error";
// P1.6 (2026-05-25): same-day cutoff defensive re-check now reads from
// the Postgres clock via getShopClock so it agrees with availability.ts's
// render-time decision.
import { getShopClock } from "@/lib/scheduler/shop-clock";
import { SAME_DAY_CUTOFF_HOUR } from "@/lib/scheduler/wizard/shop-tz";

const submitDateSchema = z.object({
  chatId: z.string().min(1),
  selected_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
});

export type SubmitDateV2Args = z.infer<typeof submitDateSchema>;

async function submitDateV2Impl(
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
      .select("appointment_type, customer_id, vehicle_id, current_step")
      .eq("id", chatId)
      .maybeSingle();
    if (rowErr || !row) {
      return {
        ok: false,
        error: rowErr?.message ?? "session_not_found",
      };
    }
    // 2026-05-17 rapid-click defense: if current_step has already
    // advanced past date_pick (the previous click won the race + the
    // navigation is in flight), no-op this call so we don't double-book.
    // Returns ok=true so the client treats the navigation as in flight;
    // the next router.refresh() will land them on the right step.
    const currentStep = row.current_step as string | null;
    if (currentStep && currentStep !== "date_pick") {
      return { ok: true, next_step: currentStep as never };
    }
    const apptType = (row.appointment_type as string | null) ?? null;
    // B4 (2026-07-02): branch on the type's capacity LANE (time-slotted vs
    // daily-cap) from scheduler_appointment_types, not the slug literal.
    // Legacy fallback keeps mid-flight sessions working if a type row is
    // unreadable/deactivated; unknown slugs escalate below with the
    // missing-type path.
    const typeRow = apptType ? await getAppointmentTypeBySlug(apptType) : null;
    const lane: "waiter" | "dropoff" | null = typeRow
      ? laneFor(typeRow)
      : apptType === "waiter" || apptType === "dropoff"
        ? apptType
        : null;

    // Same-day cutoff defense (added 2026-05-18). The date picker filters
    // today out of the available set when (a) appointment_type === 'waiter'
    // or (b) shop-local time is past SAME_DAY_CUTOFF_HOUR. This re-check
    // catches the rare race where a customer loaded the picker at 11:55 AM,
    // tapped today, and submits at 12:01 PM — the calendar still showed
    // today as valid client-side, but it's no longer offerable.
    //
    // P1.6 (2026-05-25): clock source is the Postgres RPC (getShopClock).
    // Same snapshot as availability.ts's render-time decision — no
    // cross-clock drift at the cutoff minute. React `cache()` on the
    // helper keeps this to one RPC call per request.
    const shopNow = await getShopClock();
    if (selected_date === shopNow.date) {
      if (lane === "waiter") {
        return applyWizardTransition({
          chatId,
          nextStep: "date_pick",
          jeffBubble:
            "Same-day waiter appointments aren't possible — our waiter slots are 8 AM and 9 AM. Pick another day below and I'll line you up. ⏰",
        });
      }
      if (lane === "dropoff" && shopNow.hour >= SAME_DAY_CUTOFF_HOUR) {
        return applyWizardTransition({
          chatId,
          nextStep: "date_pick",
          jeffBubble:
            "We just hit our same-day cutoff for today — let me pull up the next available days. 📅",
        });
      }
    }

    if (lane === null) {
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

    // Waiter-lane path: just write the date + advance to time picker.
    if (lane === "waiter") {
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
      //
      // 2026-05-25 audit (Validator-3 SF-1) — was silent here. The
      // first instance of this bouncing (session a7168b3b) took DB
      // forensics on `customer_chat_messages` to diagnose because the
      // only signal was the chat bubble. Now Sentry warning + logError
      // so ops sees the bounce on the first occurrence, not the
      // hundredth.
      Sentry.captureMessage("submit_date_v2 hold race-lost", {
        level: "warning",
        tags: {
          surface: "submit_date_v2_hold_race_lost",
          chat_id: chatId,
          reason: hold.error ?? "unknown",
        },
        extra: { chatId, selected_date, hold_error: hold.error },
      });
      await logError({
        chatId,
        surface: "submit_date_v2",
        error_code: `hold_race_lost:${hold.error ?? "unknown"}`,
        message:
          `holdSlot returned ok=false for date=${selected_date} ` +
          `error=${hold.error ?? "unknown"}; bouncing customer to date_pick`,
        level: "warning",
        context: { selected_date, hold_error: hold.error },
      });
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

export const submitDateV2 = wrapAction("submitDateV2", submitDateV2Impl);

function raceLostBubble(reason: string | undefined): string {
  if (reason === "slot_just_taken") {
    return "That day just got booked up — let me show you the updated list. 📅";
  }
  return "Couldn't reserve that day — pick another and I'll try again. 📅";
}
