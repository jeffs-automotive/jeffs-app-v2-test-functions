"use server";

/**
 * Step 3 — Resend OTP (V2, server-state-driven).
 *
 * Per chat-design.md §Step 3 lines 645-651 + the Architecture amendment
 * — 2026-05-14.
 *
 * Calls scheduler-otp-direct op='resend' which:
 *   - Reads phone_e164 off the session row
 *   - Invokes sendOtp (per-phone rate-limit checks happen inside)
 *   - Inserts a fresh otp_codes row + dispatches via Telnyx
 *   - Resets session-level otp_attempts to 0
 *
 * Does NOT change current_step — customer stays on the OTP card with a
 * fresh code. revalidatePath causes the page to re-render so the
 * OtpInput's TTL countdown resets via the new payload.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  callOtpResend,
  OtpDirectError,
} from "@/lib/scheduler/otp-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
// PLAN-03 Phase 1 — SMS-pump defense. The resend path doesn't accept
// the phone as an arg (it reads off the session row inside the edge
// function), so we look the phone up here to key the rate limit. See
// submit-phone-name.ts for the full pattern + rationale.
import { checkBotForSensitiveAction } from "@/lib/security/check-bot";
import {
  checkIpRateLimit,
  checkPhoneRateLimit,
} from "@/lib/security/rate-limit";
import { getRequestIp } from "@/lib/security/get-request-ip";

const resendOtpSchema = z.object({
  chatId: z.string().min(1),
});

export type ResendOtpV2Args = z.infer<typeof resendOtpSchema>;

async function resendOtpV2Impl(
  args: ResendOtpV2Args,
): Promise<WizardTransitionResult> {
  const parsed = resendOtpSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId } = parsed.data;

  // ─── PLAN-03 Phase 1 — SMS-pump defense ────────────────────────────
  // Order: bot → IP rate-limit → phone rate-limit. The phone-limit needs
  // the phone off the row (this action's arg is just chatId). If the row
  // has no phone (shouldn't happen in the resend flow — the customer
  // can only land on otp_pending after entering one — but defensively
  // handle it), we skip the phone limit and let the IP + bot gates +
  // DB-level limit cover us.
  const bot = await checkBotForSensitiveAction();
  if (!bot.ok) {
    Sentry.captureMessage("resend_otp_v2 bot detected", {
      level: "warning",
      tags: { surface: "resend_otp_v2_bot_gate", chat_id: chatId },
    });
    return { ok: false, error: "bot_detected" };
  }

  const ip = await getRequestIp();
  const ipCheck = await checkIpRateLimit(ip);
  if (!ipCheck.allowed) {
    Sentry.captureMessage("resend_otp_v2 IP rate-limited", {
      level: "warning",
      tags: { surface: "resend_otp_v2_ip_limit", chat_id: chatId },
    });
    return { ok: false, error: ipCheck.reason };
  }

  try {
    // Phone-rate-limit needs the phone off the row. We do this BEFORE
    // calling the edge function so we reject pumped requests before
    // they cost us a Telnyx send.
    const supabase = createSupabaseAdminClient();
    const { data: phoneRow, error: phoneReadErr } = await supabase
      .from("customer_chat_sessions")
      .select("phone_e164")
      .eq("id", chatId)
      .maybeSingle();
    if (phoneReadErr) {
      // Don't fail-closed — log and continue. The edge fn will also
      // resolve this row and either succeed or return its own
      // structured error. We just skip the phone-rate-limit on this
      // path.
      Sentry.captureMessage("resend_otp_v2 phone read for rate-limit failed", {
        level: "warning",
        tags: { surface: "resend_otp_v2_phone_read", chat_id: chatId },
        extra: { error: phoneReadErr.message },
      });
    } else if (typeof phoneRow?.phone_e164 === "string" && phoneRow.phone_e164.length > 0) {
      const phoneCheck = await checkPhoneRateLimit(phoneRow.phone_e164);
      if (!phoneCheck.allowed) {
        Sentry.captureMessage("resend_otp_v2 phone rate-limited", {
          level: "warning",
          tags: { surface: "resend_otp_v2_phone_limit", chat_id: chatId },
        });
        return { ok: false, error: phoneCheck.reason };
      }
    }

    let resendResult;
    try {
      resendResult = await callOtpResend({ session_id: chatId });
    } catch (e) {
      const reasonTag =
        e instanceof OtpDirectError
          ? `otp_resend_${e.status ?? "network"}`
          : "otp_resend_unknown";
      Sentry.captureException(e, {
        tags: { surface: "resend_otp_v2_call", reason: reasonTag },
        level: "error",
      });
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: reasonTag,
        },
        nextStep: "escalated",
        jeffBubble:
          "Hmm, something glitched while resending. Please call us at (610) 253-6565. 📞",
      });
    }

    if (!resendResult.ok) {
      // rate_limited / send_failed / no_phone_on_session — escalate so the
      // customer has an out. Phase 14 may add a more granular UX (e.g.,
      // inline "Try again in N minutes" for rate-limited).
      Sentry.captureMessage("resend_otp_v2 returned !ok", {
        level: "warning",
        extra: { chatId, error: resendResult.error },
      });
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: `otp_resend_${resendResult.error}`,
        },
        nextStep: "escalated",
        jeffBubble:
          resendResult.error === "rate_limited"
            ? "Looks like we've sent a few codes already. Please call us at (610) 253-6565 and we'll get you sorted. 📞"
            : "Hmm, the resend didn't go through. Please call us at (610) 253-6565. 📞",
      });
    }

    // Success — stay on otp_pending; the row's otp_sent_at / otp_attempts
    // were updated server-side. revalidatePath causes the card to re-render
    // with a fresh ttl_seconds countdown.
    return applyWizardTransition({
      chatId,
      updates: {},
      nextStep: "otp_pending",
      jeffBubble: "Just sent a fresh code — check your phone! 📱",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "resend_otp_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "resend_otp_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, error: msg };
  }
}

export const resendOtpV2 = wrapAction("resendOtpV2", resendOtpV2Impl);
