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
import { logError } from "@/lib/scheduler/wizard/log-error";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
import type { WizardStep } from "@/lib/scheduler/session-state";
import {
  buildAppointmentTitleV2,
} from "@/lib/scheduler/wizard/build-summary-data";
import { buildServiceSummary } from "@/lib/scheduler/wizard/build-service-summary";
import { notifyStaffOfNewAppointment } from "@/lib/scheduler/wizard/staff-notification";
import {
  isSameDayLocal,
  shopLocalDate,
} from "@/lib/scheduler/wizard/shop-tz";

const EDIT_ATTEMPT_ESCALATION_THRESHOLD = 3;

const submitSummarySchema = z.object({
  chatId: z.string().min(1),
  confirmed: z.boolean(),
  edit_target: z
    .enum(["date", "datetime", "vehicle", "services", "other"])
    .optional(),
});

export type SubmitSummaryV2Args = z.infer<typeof submitSummarySchema>;

async function submitSummaryV2Impl(
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
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: {
        surface: "submit_summary_v2",
        confirmed: String(confirmed),
        chat_id: chatId,
      },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_summary_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
      context: { confirmed },
    });
    return { ok: false, error: msg };
  }
}

export const submitSummaryV2 = wrapAction(
  "submitSummaryV2",
  submitSummaryV2Impl,
);

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

  // Idempotency pre-flight (R4-IMPORTANT-B-1 2026-05-16): Tekmetric POST
  // /appointments is NOT idempotent. If this action is retried after a
  // prior successful confirm (double-tap, network blip between the POST
  // returning 200 and our row write succeeding), appointment_id is
  // already on the row. Skip the second POST and re-emit the confirm
  // success bubble + advance to customer_notes (where the prior pass
  // was already heading).
  //
  // M1 post-validator fix (2026-05-25): branch the bubble between
  // celebratory + apology based on appointment_verification_status.
  // Previously this idempotency-replay branch always emitted the
  // celebratory "All set!" bubble — UX contradiction when the row
  // says appointment_verification_status='needs_review' (the original
  // confirm wrote a needs_review state + showed the apology bubble,
  // but a double-tap-retry would then surface a celebratory bubble,
  // contradicting the customer's prior experience).
  if (typeof r.appointment_id === "number" && r.appointment_id > 0) {
    const isMismatch = r.appointment_verification_status === "needs_review";
    return applyWizardTransition({
      chatId,
      updates: {},
      nextStep: "customer_notes",
      jeffBubble: isMismatch
        ? buildVerificationMismatchBubble(
            (r.entered_first_name as string | null) ?? null,
          )
        : buildConfirmedBubble(
            (r.entered_first_name as string | null) ?? null,
            r.appointment_type === "waiter" ? "waiter" : "dropoff",
            // start_time isn't kept on the row post-confirm; fall back to
            // empty string which buildConfirmedBubble handles gracefully.
            "",
          ),
    });
  }

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

  // Plan 04 Phase 2 (closes I-COR-3) — CAS-claim the hold atomically.
  //
  // Replaces a prior READ-then-3-check pattern that had a race window:
  // between the SELECT and the Tekmetric POST below, mark-abandoned
  // (idle-timer beacon, pagehide, tab-close) OR a concurrent
  // hydrate_session_reset could flip released_at to now() and free
  // the slot to other customers — while THIS request still proceeded
  // to confirm with Tekmetric. Result: a confirmed Tekmetric appointment
  // backed by a hold that's been released to someone else.
  //
  // CAS gate (single UPDATE):
  //   WHERE id = holdToken           (the canonical hold pointer)
  //     AND session_id = chatId      (defense: don't claim another session's hold)
  //     AND released_at IS NULL      (not already released by abandon/reset)
  //     AND expires_at > now()       (still within TTL)
  //
  // On any condition failing, supabase returns data:null (no error).
  // We then do a diagnostic SELECT to choose ONE of 3 user-facing
  // copies (not-found / released / expired) — preserves the prior
  // UX that distinguished these three failure modes.
  //
  // Hold stays released_at-stamped whether Tekmetric POST succeeds or
  // fails. Spec-acceptable per PLAN-04 §Phase 2: even if Tekmetric
  // fails we leave released_at set (the slot becomes available to
  // others; hold-reaper would otherwise sweep it within 30 min).
  const nowIso = new Date().toISOString();
  const { data: claimedHold, error: claimErr } = await supabase
    .from("appointment_holds")
    .update({ released_at: nowIso })
    .eq("id", holdToken)
    .eq("session_id", chatId)
    .is("released_at", null)
    .gt("expires_at", nowIso)
    .select("id")
    .maybeSingle();

  if (claimErr) {
    // Non-CAS DB error (connection failure, schema mismatch, etc.) —
    // distinct from CAS-miss (data:null with no error). Escalate.
    Sentry.captureException(claimErr, {
      tags: {
        surface: "submit_summary_v2_cas_claim",
        code: claimErr.code,
      },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_summary_v2",
      error_code: "cas_claim_db_error",
      message: claimErr.message,
      level: "error",
    });
    return applyWizardTransition({
      chatId,
      nextStep: "escalated",
      updates: {
        status: "escalated",
        escalated_at: nowIso,
        escalation_reason: "cas_claim_db_error",
      },
      jeffBubble:
        "Something hiccuped on my end — please call us at (610) 253-6565 and we'll take care of you. 📞",
    });
  }

  if (!claimedHold) {
    // CAS missed — one of (not-found / released / expired). Diagnostic
    // read picks the precise user-facing copy. Session-bound so a
    // session-mismatch (would never happen in normal flow) maps to
    // "not found" rather than mis-classifying as expired.
    const { data: diag } = await supabase
      .from("appointment_holds")
      .select("released_at, expires_at")
      .eq("id", holdToken)
      .eq("session_id", chatId)
      .maybeSingle();

    Sentry.captureMessage("submit_summary_v2_cas_missed", {
      level: "warning",
      extra: {
        chatId,
        holdToken,
        diag_found: diag !== null,
        diag_released_at: diag?.released_at ?? null,
        diag_expires_at: diag?.expires_at ?? null,
      },
    });

    if (!diag) {
      return applyWizardTransition({
        chatId,
        nextStep: "date_pick",
        jeffBubble:
          "Hmm, that slot reservation timed out. Let me show you the latest openings. 📅",
      });
    }
    if (diag.released_at) {
      return applyWizardTransition({
        chatId,
        nextStep: "date_pick",
        jeffBubble:
          "Looks like that slot reservation was released. Let me show you the latest openings. 📅",
      });
    }
    // Remaining branch: expires_at <= now() (released_at was null, row
    // existed, session matched — only the TTL check could have missed).
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

  // Plan 04 Phase 4 (closes I-COR-6) — verification-mismatch 3-state
  // envelope. When Tekmetric's GET-after-POST verification reports that
  // fields differ between what we sent and what it persisted, do NOT
  // silently treat the booking as confirmed:
  //   - Persist appointment_verification_status='needs_review' +
  //     appointment_verification_diff (so advisors can query the DB and
  //     reconcile)
  //   - Queue a Pattern B manual review (AVM-XXXXXX code) so the team
  //     gets a code to reference in Claude Desktop ("code AVM-XXXX
  //     option a" style resolution)
  //   - Sentry capture at ERROR level (was warning under the prior
  //     "log + proceed as confirmed" behavior — error is correct now
  //     since the customer-facing bubble apologizes)
  //   - Still advance to customer_notes (per Chris's UX call —
  //     customer continues the flow; the advisor handles the backend
  //     verification fix separately)
  //   - Different jeffBubble: apology copy instead of celebratory
  //
  // Email send for the manual review is DEFERRED (existing keytag
  // email path is Deno-only; Vercel Server Action can't import it
  // directly). Tracked as a new CLN deferred item; advisors can query
  // keytag_manual_reviews WHERE category='appointment_verification_mismatch'
  // for now.
  const isVerifyMismatch =
    confirmResult.verification && !confirmResult.verification.ok;
  // M3 post-validator fix (2026-05-25): scheduler-booking-direct's
  // verification.diff is always a string (issues.join("; ") OR a
  // 'verify_get_status_<N>' shape OR an exception-message slice — see
  // supabase/functions/_shared/tools/scheduler-slots.ts:968-1018).
  // Storing a bare string into a JSONB column makes it a JSON string
  // literal — valid but awkward for advisors who would query
  // `appointment_verification_diff->>'field'` expecting object shape.
  // Wrap as `{ raw: string }` so the JSONB column is always an
  // object — advisors query `diff->>'raw'` for the message.
  const verifyDiff = confirmResult.verification?.diff ?? null;
  const verifyDiffJsonb: { raw: string } | null =
    typeof verifyDiff === "string" ? { raw: verifyDiff } : null;

  if (isVerifyMismatch) {
    Sentry.captureMessage("appointment_verification_mismatch", {
      level: "error",
      tags: {
        surface: "submit_summary_v2_verify_mismatch",
        chat_id: chatId,
      },
      extra: {
        appointment_id: appointmentId,
        diff: verifyDiff,
      },
    });

    // Pattern B — create_manual_review RPC. The keytag-specific
    // p_tag_color / p_tag_number / p_ro_id / p_ro_number params stay
    // unset (use their NULL defaults). Failure of this insert is
    // best-effort: the appointment_verification_status column on the
    // session row + the Sentry error capture above are sufficient
    // for advisor triage without the code.
    try {
      const { error: reviewErr } = await supabase.rpc(
        "create_manual_review",
        {
          p_category: "appointment_verification_mismatch",
          p_prefix: "AVM",
          p_context: {
            chat_id: chatId,
            appointment_id: appointmentId,
            customer_id: customerId,
            vehicle_id: vehicleId,
            diff: verifyDiff,
          },
          p_options: [
            {
              key: "update_tekmetric",
              label: "Update Tekmetric to match what we sent",
              description:
                "Edit the appointment in Tekmetric so it reflects what the customer confirmed in the wizard.",
            },
            {
              key: "update_our_records",
              label: "Update our records to match Tekmetric",
              description:
                "Accept Tekmetric's version as correct; update the customer_chat_sessions row accordingly.",
            },
            {
              key: "contact_customer",
              label: "Contact customer to resolve",
              description:
                "Call/text the customer to confirm which version is correct, then fix the other side.",
            },
          ],
          p_issue_summary:
            "Appointment confirmation succeeded but Tekmetric's verification shows the persisted fields differ from what we sent.",
        },
      );
      if (reviewErr) {
        Sentry.captureException(reviewErr, {
          tags: { surface: "submit_summary_v2_create_manual_review" },
          level: "warning",
          extra: { chatId, appointment_id: appointmentId },
        });
      }
    } catch (e) {
      Sentry.captureException(e, {
        tags: { surface: "submit_summary_v2_create_manual_review" },
        level: "warning",
        extra: { chatId, appointment_id: appointmentId },
      });
    }
  }

  // Fire-and-forget staff email notification. Fires for BOTH
  // confirmed and needs_review paths — staff still needs to prep
  // for the appointment regardless of verification state.
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

  // Advance to customer_notes. Both confirmed + needs_review paths
  // go through customer_notes per Chris's UX call — the apology
  // bubble + the needs_review backend handling are orthogonal to
  // the customer's notes-taking step.
  return applyWizardTransition({
    chatId,
    updates: {
      appointment_id: appointmentId,
      appointment_confirmed_at: new Date().toISOString(),
      appointment_verification_status: isVerifyMismatch
        ? "needs_review"
        : "confirmed",
      // M3 post-validator fix: wrap the string diff as `{ raw: string }`
      // JSONB object so advisor queries can use `diff->>'raw'` instead of
      // dealing with a bare JSON string literal. Explicit null on
      // confirmed path clears any prior value (defensive; first-write
      // to this column on this row would otherwise leave it null).
      appointment_verification_diff: isVerifyMismatch ? verifyDiffJsonb : null,
    },
    nextStep: "customer_notes",
    jeffBubble: isVerifyMismatch
      ? buildVerificationMismatchBubble(r.entered_first_name as string | null)
      : buildConfirmedBubble(
          r.entered_first_name as string | null,
          apptType,
          confirmResult.start_time ?? "",
        ),
  });
}

function buildVerificationMismatchBubble(firstName: string | null): string {
  const name = (firstName ?? "").trim();
  const greeting = name ? `Thanks, ${name} —` : "Thanks —";
  return `${greeting} we've got your appointment booked, but a couple of details came through differently than expected on our end. Our team will text or call you shortly to verify everything's right before your visit. 📞\n\nBefore you go — is there anything special I should let our techs know about your car or the visit?`;
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
  // Same-day check (added 2026-05-18): compare the appointment's
  // shop-local date against today's shop-local date. We resolve the
  // shop-local YYYY-MM-DD from the UTC ISO via shopLocalDate (not a
  // raw .slice(0,10) which would return the UTC date — same for most
  // morning dropoff times in the East, but wrong for any appointment
  // that's a UTC-day later than shop-local). When the customer is
  // booking for today, the "drop before 10 AM" guidance is misleading
  // (cutoff is noon and 10 AM may already be past) — swap to
  // "drop off as soon as you can today."
  const sameDay = startTimeIso
    ? isSameDayLocal(shopLocalDate(new Date(startTimeIso)))
    : false;
  if (sameDay) {
    return `${greeting} You're booked for drop-off today — drop off as soon as you can and we'll text you when it's ready.\n\nBefore you go — is there anything special I should let our techs know about your car or the visit?`;
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
