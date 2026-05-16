"use server";

/**
 * Step 3 — OTP verify (V2, server-state-driven).
 *
 * Per chat-design.md §Step 3 + the Architecture amendment — 2026-05-14 +
 * the Option B decision (2026-05-13): new customers receive OTP too.
 *
 * Flow:
 *   1. Validate the 6-digit code (Zod, server-side)
 *   2. Call scheduler-otp-direct op='verify' — the deterministic edge
 *      function calls verifyOtp(sb, shopId, { phone, code, session_id })
 *      which: consumes the otp_codes row on success, increments otp_attempts
 *      on failure, writes otp_verified_at + identity_verification_level=
 *      'full' to customer_chat_sessions on success (Phase 1 fix)
 *   3. Branch on verified + customer_id:
 *        verified=true + customer_id set      → 'customer_info_edit' (returning)
 *        verified=true + customer_id NULL     → 'new_customer_info' (Option B)
 *        verified=false + attempts_remaining>0→ stay on 'otp_pending'
 *        verified=false + attempts_remaining<=0 → 'escalated'
 *   4. applyWizardTransition handles row write + bubble + revalidate.
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  callOtpVerify,
  OtpDirectError,
} from "@/lib/scheduler/otp-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import { logError } from "@/lib/scheduler/wizard/log-error";

const submitOtpSchema = z.object({
  chatId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
});

export type SubmitOtpV2Args = z.infer<typeof submitOtpSchema>;

export async function submitOtpV2(
  args: SubmitOtpV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitOtpSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, code } = parsed.data;

  try {
    // Call the deterministic edge function. verifyOtp internally writes
    // otp_verified_at + identity_verification_level='full' on success
    // (Phase 1 fix in scheduler-otp.ts).
    let verifyResult;
    try {
      verifyResult = await callOtpVerify({ session_id: chatId, code });
    } catch (e) {
      const reasonTag =
        e instanceof OtpDirectError
          ? `otp_direct_${e.status ?? "network"}`
          : "otp_direct_unknown";
      Sentry.captureException(e, {
        tags: {
          surface: "submit_otp_v2_otp_call",
          reason: reasonTag,
        },
        level: "error",
      });
      // Fail-safe: escalate so the customer has a path forward.
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: reasonTag,
        },
        nextStep: "escalated",
        jeffBubble:
          "Hmm, something glitched while checking your code. Please call us at (610) 253-6565 and we'll take care of you. 📞",
      });
    }

    // Defensive: edge function returned an error envelope (no `verified`).
    if ("verified" in verifyResult === false) {
      const errMsg =
        "error" in verifyResult ? verifyResult.error : "unknown_response_shape";
      Sentry.captureMessage("submit_otp_v2 unexpected response shape", {
        level: "warning",
        extra: { chatId, response: verifyResult },
      });
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: `otp_verify_${errMsg}`,
        },
        nextStep: "escalated",
        jeffBubble:
          "Sorry — something unexpected came back. Please call us at (610) 253-6565. 📞",
      });
    }

    // Wrong / expired / no-active-code branch.
    if (!verifyResult.verified) {
      const attemptsRemaining = verifyResult.attempts_remaining;
      // 3 strikes → escalate per chat-design.md §Step 3 lines 668-680
      if (attemptsRemaining <= 0) {
        return applyWizardTransition({
          chatId,
          updates: {
            status: "escalated",
            escalated_at: new Date().toISOString(),
            escalation_reason: "otp_max_attempts",
          },
          nextStep: "escalated",
          jeffBubble:
            "I want to make sure your info stays safe, so let's get someone on the phone. Please call us at (610) 253-6565. 📞",
        });
      }
      // Stay on otp_pending; the row's otp_attempts was already bumped
      // server-side. revalidatePath will cause the page to re-render with
      // the updated attempts_remaining payload.
      return applyWizardTransition({
        chatId,
        updates: {}, // no row updates here — verify endpoint already bumped otp_attempts
        nextStep: "otp_pending",
        jeffBubble: wrongCodeBubble(verifyResult.error, attemptsRemaining),
      });
    }

    // Verified=true. Branch on customer_id:
    //   - customer_id set → returning customer → Step 5 customer_info_edit
    //   - customer_id null → new customer (Option B) → Step 4 new_customer_info
    if (verifyResult.customer_id !== null) {
      return applyWizardTransition({
        chatId,
        updates: {},
        nextStep: "customer_info_edit",
        jeffBubble: returningSuccessBubble(),
      });
    }

    // Option B path: phone verified, no Tekmetric match → new-client flow.
    // Read entered_first_name for a warmer bubble greeting.
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("customer_chat_sessions")
      .select("entered_first_name")
      .eq("id", chatId)
      .maybeSingle();
    const firstName = (row?.entered_first_name as string | null) ?? null;
    return applyWizardTransition({
      chatId,
      updates: {},
      nextStep: "new_customer_info",
      jeffBubble: newCustomerSuccessBubble(firstName),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_otp_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_otp_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, error: msg };
  }
}

// ─── Bubble copy ────────────────────────────────────────────────────────────

function wrongCodeBubble(
  error: "invalid_code" | "expired" | "no_active_code" | "too_many_attempts",
  remaining: number,
): string {
  switch (error) {
    case "expired":
      return "That code expired — tap Resend below for a fresh one.";
    case "no_active_code":
      return "Hmm, I can't find an active code. Tap Resend below for a fresh one.";
    case "too_many_attempts":
      return "That code's been tried too many times. Tap Resend for a new one.";
    case "invalid_code":
    default:
      return remaining === 1
        ? "That code doesn't match — one try left! ⚠️"
        : `That code doesn't match — ${remaining} tries left.`;
  }
}

function returningSuccessBubble(): string {
  return "Got it — your number checks out! ✅";
}

function newCustomerSuccessBubble(firstName: string | null): string {
  if (firstName) {
    return `Welcome aboard, ${firstName}! 👋 Let's get your account set up.`;
  }
  return "Welcome aboard! 👋 Let's get your account set up.";
}
