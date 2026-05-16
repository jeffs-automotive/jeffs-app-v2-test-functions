"use server";

/**
 * Step 10.1-10.2 submit — Summary card confirm + per-section edits.
 * Phase 12 (2026-05-16).
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" + the
 * 2026-05-16 Tekmetric API findings amendment.
 *
 * Two paths:
 *
 * 1. CONFIRM path (`confirmed: true`)
 *    - Read row to verify hold_token + customer_id + vehicle_id present
 *    - Re-validate hold is not expired (server-side gate — the card's
 *      countdown is client-side and can race past expiry)
 *    - Build title + description from row state via the V2 helpers
 *    - Call scheduler-booking-direct confirm_booking op with the new
 *      8-field POST shape (no appointmentOption — see appointment-post.md
 *      Empirical findings 2026-05-16)
 *    - On success:
 *        a. Write appointment_id + appointment_confirmed_at on the row,
 *           advance to 'customer_notes'
 *        b. Fire staff email notification (fire-and-forget; failure
 *           does not block customer confirmation)
 *    - On hold_expired: bounce to date_pick with a friendly bubble
 *    - On Tekmetric failure: log + escalate
 *
 * 2. EDIT path (`confirmed: false`, with optional `edit_target`)
 *    - Increment summary_edit_attempts; at >=3 the next edit escalates
 *      (per chat-design §10.1.5 + the off-by-one fix in legacy
 *      session-actions.ts:2208)
 *    - Route to the appropriate step:
 *        'date' or 'datetime' → date_pick
 *        'vehicle'            → vehicle_pick
 *        'services'           → service_concern_picker
 *        'other' / undefined  → customer_info_edit (catch-all)
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  confirmBooking,
  BookingDirectError,
} from "@/lib/scheduler/booking-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import type { WizardStep } from "@/lib/scheduler/session-state";
import {
  buildAppointmentTitleV2,
} from "@/lib/scheduler/wizard/build-summary-data";
import { buildServiceSummary } from "@/lib/scheduler/wizard/build-service-summary";
import { notifyStaffOfNewAppointment } from "@/lib/scheduler/wizard/staff-notification";

const EDIT_ATTEMPT_ESCALATION_THRESHOLD = 3;

const submitSummarySchema = z.object({
  chatId: z.string().min(1),
  confirmed: z.boolean(),
  edit_target: z
    .enum(["date", "datetime", "vehicle", "services", "other"])
    .optional(),
});

export type SubmitSummaryV2Args = z.infer<typeof submitSummarySchema>;

export async function submitSummaryV2(
  args: SubmitSummaryV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitSummarySchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, confirmed, edit_target } = parsed.data;

  try {
    if (!confirmed) {
      return await handleEditPath(chatId, edit_target);
    }
    return await handleConfirmPath(chatId);
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_summary_v2", confirmed: String(confirmed) },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ─── Edit path ──────────────────────────────────────────────────────────────

async function handleEditPath(
  chatId: string,
  edit_target?: "date" | "datetime" | "vehicle" | "services" | "other",
): Promise<WizardTransitionResult> {
  const supabase = createSupabaseAdminClient();
  const { data: row, error: rowErr } = await supabase
    .from("customer_chat_sessions")
    .select("summary_edit_attempts")
    .eq("id", chatId)
    .maybeSingle();
  if (rowErr) {
    return { ok: false, error: rowErr.message };
  }
  const prior = (row?.summary_edit_attempts as number | null) ?? 0;
  const nextAttempts = prior + 1;

  // At the 3rd edit attempt, escalate per chat-design.md §10.1.5
  // (allows 2 edits; 3rd is intercepted).
  if (nextAttempts >= EDIT_ATTEMPT_ESCALATION_THRESHOLD) {
    return applyWizardTransition({
      chatId,
      updates: {
        summary_edit_attempts: nextAttempts,
        status: "escalated",
        escalated_at: new Date().toISOString(),
        escalation_reason: "summary_edit_limit",
      },
      nextStep: "escalated",
      jeffBubble:
        "Let me get one of our advisors to help you sort this out — please call us at (610) 253-6565 and we'll make sure everything's right. 📞",
    });
  }

  const nextStep = mapEditTargetToStep(edit_target);
  const bubble = buildEditJumpBubble(edit_target);

  return applyWizardTransition({
    chatId,
    updates: { summary_edit_attempts: nextAttempts },
    nextStep,
    jeffBubble: bubble,
  });
}

function mapEditTargetToStep(
  edit_target: "date" | "datetime" | "vehicle" | "services" | "other" | undefined,
): WizardStep {
  switch (edit_target) {
    case "date":
    case "datetime":
      return "date_pick";
    case "vehicle":
      return "vehicle_pick";
    case "services":
      return "service_concern_picker";
    case "other":
    case undefined:
    default:
      // Catch-all goes to customer_info_edit — the most common edit
      // target (phones/emails/address). Customers who want a different
      // section after that hop will edit again, which counts toward
      // the 2-edit cap.
      return "customer_info_edit";
  }
}

function buildEditJumpBubble(
  edit_target:
    | "date"
    | "datetime"
    | "vehicle"
    | "services"
    | "other"
    | undefined,
): string {
  switch (edit_target) {
    case "date":
    case "datetime":
      return "Sure — pick a different day below. 📅";
    case "vehicle":
      return "Got it — let's pick the right vehicle. 🚙";
    case "services":
      return "No problem — let's adjust the services. 🛠️";
    case "other":
    case undefined:
    default:
      return "Sure thing — let's update your contact info. 👤";
  }
}

// ─── Confirm path ───────────────────────────────────────────────────────────

async function handleConfirmPath(chatId: string): Promise<WizardTransitionResult> {
  const supabase = createSupabaseAdminClient();
  const { data: row, error: rowErr } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", chatId)
    .maybeSingle();
  if (rowErr || !row) {
    return { ok: false, error: rowErr?.message ?? "session_not_found" };
  }
  const r = row as Record<string, unknown>;

  // Pre-flight checks
  const holdToken = r.hold_token as string | null;
  if (!holdToken) {
    return {
      ok: false,
      error: "hold_token missing on session row — cannot confirm",
    };
  }
  const customerId = r.customer_id;
  const vehicleId = r.vehicle_id;
  if (typeof customerId !== "number") {
    return applyWizardTransition({
      chatId,
      nextStep: "escalated",
      updates: {
        status: "escalated",
        escalated_at: new Date().toISOString(),
        escalation_reason: "missing_customer_id_at_confirm",
      },
      jeffBubble:
        "Something got out of sync on my end — please call us at (610) 253-6565 and we'll take care of you. 📞",
    });
  }
  if (typeof vehicleId !== "number") {
    return applyWizardTransition({
      chatId,
      nextStep: "escalated",
      updates: {
        status: "escalated",
        escalated_at: new Date().toISOString(),
        escalation_reason: "missing_vehicle_id_at_confirm",
      },
      jeffBubble:
        "Something got out of sync on my end — please call us at (610) 253-6565 and we'll take care of you. 📞",
    });
  }

  // Verify the hold is still alive. Client-side countdown might race
  // past expiry between display and confirm tap; server-side gate is the
  // authoritative check.
  const { data: hold } = await supabase
    .from("appointment_holds")
    .select("expires_at, released_at")
    .eq("id", holdToken)
    .maybeSingle();
  if (!hold) {
    return applyWizardTransition({
      chatId,
      nextStep: "date_pick",
      jeffBubble:
        "Hmm, that slot reservation timed out. Let me show you the latest openings. 📅",
    });
  }
  if (hold.released_at) {
    return applyWizardTransition({
      chatId,
      nextStep: "date_pick",
      jeffBubble:
        "Looks like that slot reservation was released. Let me show you the latest openings. 📅",
    });
  }
  if (new Date(hold.expires_at as string) <= new Date()) {
    return applyWizardTransition({
      chatId,
      nextStep: "date_pick",
      jeffBubble:
        "Your slot just expired — but don't worry, let me re-check the schedule for you! 📅",
    });
  }

  // Build title + description from row state.
  const [title, description] = await Promise.all([
    buildAppointmentTitleV2({ chatId }),
    buildServiceSummary({ chatId }),
  ]);

  // Color = staff-facing channel: red for waiter, navy for dropoff.
  const apptType =
    r.appointment_type === "waiter" ? "waiter" : "dropoff";
  const color = apptType === "waiter" ? "red" : "navy";

  // Call scheduler-booking-direct confirm_booking op.
  let confirmResult: Awaited<ReturnType<typeof confirmBooking>>;
  try {
    confirmResult = await confirmBooking({
      op: "confirm_booking",
      session_id: chatId,
      hold_id: holdToken,
      customer_id: customerId,
      vehicle_id: vehicleId,
      title,
      description,
      color,
    });
  } catch (e) {
    const reason =
      e instanceof BookingDirectError
        ? `booking_direct_${e.status ?? "network"}`
        : "booking_direct_unknown";
    Sentry.captureException(e, {
      tags: { surface: "submit_summary_v2_confirm_call", reason },
      level: "error",
    });
    return applyWizardTransition({
      chatId,
      nextStep: "escalated",
      updates: {
        status: "escalated",
        escalated_at: new Date().toISOString(),
        escalation_reason: "confirm_booking_threw",
      },
      jeffBubble:
        "Hmm, my system hiccuped while booking. Please call us at (610) 253-6565 and we'll take great care of you. 📞",
    });
  }

  if (!confirmResult.ok) {
    // Tekmetric-side rejection. Could be a hold-expired race (very rare
    // since we verified above), Tekmetric outage, or validation rejection.
    const errMsg = confirmResult.error ?? "unknown";
    if (errMsg.includes("hold_expired") || errMsg.includes("hold_not_found")) {
      return applyWizardTransition({
        chatId,
        nextStep: "date_pick",
        jeffBubble:
          "Looks like that slot just expired — let me show you the latest openings. 📅",
      });
    }
    Sentry.captureMessage("submit_summary_v2 confirm_booking returned !ok", {
      level: "error",
      extra: { chatId, error: errMsg.slice(0, 500) },
    });
    return applyWizardTransition({
      chatId,
      nextStep: "escalated",
      updates: {
        status: "escalated",
        escalated_at: new Date().toISOString(),
        escalation_reason: `confirm_booking_failed:${errMsg.slice(0, 100)}`,
      },
      jeffBubble:
        "Hmm, my system hiccuped while booking. Please call us at (610) 253-6565 and we'll take great care of you. 📞",
    });
  }

  const appointmentId = confirmResult.appointment_id;
  if (typeof appointmentId !== "number") {
    Sentry.captureMessage(
      "submit_summary_v2 confirm_booking returned ok but no appointment_id",
      { level: "error", extra: { chatId, result: confirmResult } },
    );
    return applyWizardTransition({
      chatId,
      nextStep: "escalated",
      updates: {
        status: "escalated",
        escalated_at: new Date().toISOString(),
        escalation_reason: "confirm_booking_no_appointment_id",
      },
      jeffBubble:
        "Something didn't come back quite right from our system — please call us at (610) 253-6565 to confirm your appointment. 📞",
    });
  }

  // Surface verify-mismatch to Sentry (don't block the customer — the
  // booking is in Tekmetric per the 200 response).
  if (confirmResult.verification && !confirmResult.verification.ok) {
    Sentry.captureMessage("submit_summary_v2 confirm verify mismatch", {
      level: "warning",
      extra: {
        chatId,
        appointment_id: appointmentId,
        diff: confirmResult.verification.diff,
      },
    });
  }

  // Fire-and-forget staff email notification.
  void notifyStaffOfNewAppointment({
    chatId,
    appointmentId,
    startsAtIso: confirmResult.start_time ?? "",
    appointmentType: apptType,
    title,
    description,
  }).catch((e) => {
    Sentry.captureException(e, {
      tags: { surface: "submit_summary_v2_staff_email" },
      level: "warning",
      extra: { chatId, appointment_id: appointmentId },
    });
  });

  // Advance to customer_notes with celebratory bubble.
  return applyWizardTransition({
    chatId,
    updates: {
      appointment_id: appointmentId,
      appointment_confirmed_at: new Date().toISOString(),
    },
    nextStep: "customer_notes",
    jeffBubble: buildConfirmedBubble(
      r.entered_first_name as string | null,
      apptType,
      confirmResult.start_time ?? "",
    ),
  });
}

function buildConfirmedBubble(
  firstName: string | null,
  type: "waiter" | "dropoff",
  startTimeIso: string,
): string {
  const name = (firstName ?? "").trim();
  const greeting = name ? `🎉 All set, ${name}!` : "🎉 All set!";
  const friendly = formatFriendlyTime(startTimeIso, type);
  if (type === "waiter") {
    return `${greeting} You're booked for ${friendly}.\n\nBefore you go — is there anything special I should let our techs know about your car or the visit?`;
  }
  return `${greeting} You're booked for drop-off on ${friendly} — drop before 10 AM and we'll text you when it's ready.\n\nBefore you go — is there anything special I should let our techs know about your car or the visit?`;
}

function formatFriendlyTime(
  iso: string,
  type: "waiter" | "dropoff",
): string {
  if (!iso) return "your appointment date";
  try {
    const d = new Date(iso);
    const datePart = d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York",
    });
    if (type === "dropoff") return datePart;
    const timePart = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
    return `${datePart} at ${timePart}`;
  } catch {
    return iso;
  }
}
