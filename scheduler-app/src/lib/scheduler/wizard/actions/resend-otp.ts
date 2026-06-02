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
import { checkPhoneRateLimit } from "@/lib/security/rate-limit";

const resendOtpSchema = z.object({
  chatId: z.string().min(1),
});

export type ResendOtpV2Args = z.infer<typeof resendOtpSchema>;

/**
 * P2.12 post-validator fix (2026-05-25): server-side OTP resend cooldown.
 *
 * The 30-second cooldown was previously CLIENT-ONLY — `OtpInput.tsx`
 * grays the Resend button for 30s after a send. A scripted client
 * (browser console, Playwright, malicious automation) could bypass the
 * cooldown entirely; only the Upstash phone-rate-limit (3/hr) + DB-level
 * otp_codes-per-phone-per-hour cap actually rejected pumped resends.
 * 30s gates the FAR more common "user spams the Resend button" pattern
 * while the rate-limits cover sustained pumping.
 *
 * Implementation: the existing `otp_sent_at` TIMESTAMPTZ column on
 * `customer_chat_sessions` is stamped by the edge fn's `sendOtp` on
 * every send (initial + resend). We read it as part of the same
 * phone_e164 lookup we already do for the phone rate-limit and reject
 * if it was updated within the last 30 seconds.
 *
 * Same UX-error code as the client surface (`resend_cooldown_active`)
 * so the wizard can surface a coherent message when the customer
 * tampered with browser timing OR experienced a clock-skew issue.
 */
const RESEND_COOLDOWN_MS = 30_000;

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

  // ─── SEC-7 — SMS-pump defense ───────────────────────────────────────
  // Order: bot → phone rate-limit. The per-IP limit is enforced upstream at
  // the Vercel Firewall edge. The phone-limit needs the phone off the row
  // (this action's arg is just chatId); if the row has no phone (shouldn't
  // happen in the resend flow — the customer can only land on otp_pending
  // after entering one — but defensively handle it), we skip the phone
  // limit and let the bot gate + DB-level limit cover us.
  const bot = await checkBotForSensitiveAction();
  if (!bot.ok) {
    Sentry.captureMessage("resend_otp_v2 bot detected", {
      level: "warning",
      tags: { surface: "resend_otp_v2_bot_gate", chat_id: chatId },
    });
    return { ok: false, error: "bot_detected" };
  }

  try {
    // P2.12 (2026-05-25): single DB read pulls BOTH phone_e164 (for
    // the phone rate-limit) AND otp_sent_at (for the 30s server-side
    // cooldown). The cooldown check rejects rapid-fire resends BEFORE
    // we hit Upstash + the edge fn + Telnyx — cheapest reject for the
    // most common attacker pattern (scripted button-spam).
    const supabase = createSupabaseAdminClient();
    const { data: phoneRow, error: phoneReadErr } = await supabase
      .from("customer_chat_sessions")
      .select("phone_e164, otp_sent_at")
      .eq("id", chatId)
      .maybeSingle();
    if (phoneReadErr) {
      // Don't fail-closed — log and continue. The edge fn will also
      // resolve this row and either succeed or return its own
      // structured error. We just skip the phone-rate-limit + cooldown
      // on this path.
      Sentry.captureMessage("resend_otp_v2 phone read for rate-limit failed", {
        level: "warning",
        tags: { surface: "resend_otp_v2_phone_read", chat_id: chatId },
        extra: { error: phoneReadErr.message },
      });
    } else {
      // P2.12 server-side cooldown check. Skipped on first send (the
      // row has otp_sent_at=null until the initial sendOtp lands).
      const otpSentAtRaw = phoneRow?.otp_sent_at as string | null | undefined;
      if (otpSentAtRaw) {
        const lastSentMs = Date.parse(otpSentAtRaw);
        if (!Number.isNaN(lastSentMs)) {
          const sinceLastMs = Date.now() - lastSentMs;
          if (sinceLastMs < RESEND_COOLDOWN_MS) {
            const retryAfterSec = Math.ceil(
              (RESEND_COOLDOWN_MS - sinceLastMs) / 1000,
            );
            Sentry.captureMessage("resend_otp_v2 cooldown active", {
              level: "warning",
              tags: {
                surface: "resend_otp_v2_cooldown",
                chat_id: chatId,
              },
              extra: {
                since_last_ms: sinceLastMs,
                retry_after_seconds: retryAfterSec,
              },
            });
            return {
              ok: false,
              error: "resend_cooldown_active",
            };
          }
        }
      }

      if (
        typeof phoneRow?.phone_e164 === "string" &&
        phoneRow.phone_e164.length > 0
      ) {
        const phoneCheck = await checkPhoneRateLimit(phoneRow.phone_e164);
        if (!phoneCheck.allowed) {
          Sentry.captureMessage("resend_otp_v2 phone rate-limited", {
            level: "warning",
            tags: { surface: "resend_otp_v2_phone_limit", chat_id: chatId },
          });
          return { ok: false, error: phoneCheck.reason };
        }
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
