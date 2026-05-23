"use server";

/**
 * Step 3.5c — Multi-account disambiguation submit (V2, server-state-driven).
 *
 * Per chat-design.md §3.5c lines 685 + 710 + the Architecture amendment
 * — 2026-05-14.
 *
 * Two actions:
 *   - 'select' (with selected_customer_id) → set customer_id on the row,
 *     clear pending_candidates, send OTP for the now-resolved single
 *     account, advance to otp_pending. The multi-account branch in
 *     scheduler-step2-direct does NOT send OTP (no single match yet);
 *     OTP send happens here after the customer disambiguates.
 *
 *   - 'none_of_these' → clear pending_candidates, advance to
 *     no_match_choose_path. The customer says it's not their phone;
 *     §3.5b's choose-path forks (try different phone / continue as new)
 *     are the appropriate next step.
 *
 * OTP send is implemented via callOtpResend — same scheduler-otp-direct
 * 'resend' op as the regular resend flow. The op resets otp_attempts to
 * 0 and stamps otp_sent_at; equivalent to a fresh first send.
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
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
// PLAN-03 Phase 1 — the 'select' branch sends an OTP (callOtpResend).
// The 'none_of_these' branch does not — it just clears candidates and
// advances. Bot + rate gates only apply to the SMS-sending branch.
import { checkBotForSensitiveAction } from "@/lib/security/check-bot";
import {
  checkIpRateLimit,
  checkPhoneRateLimit,
} from "@/lib/security/rate-limit";
import { getRequestIp } from "@/lib/security/get-request-ip";

const submitMultiAccountChoiceSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("select"),
    chatId: z.string().min(1),
    selected_customer_id: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("none_of_these"),
    chatId: z.string().min(1),
  }),
]);

export type SubmitMultiAccountChoiceV2Args = z.infer<
  typeof submitMultiAccountChoiceSchema
>;

async function submitMultiAccountChoiceV2Impl(
  args: SubmitMultiAccountChoiceV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitMultiAccountChoiceSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }

  const { chatId } = parsed.data;

  try {
    if (parsed.data.action === "none_of_these") {
      return applyWizardTransition({
        chatId,
        updates: { pending_candidates: null },
        nextStep: "no_match_choose_path",
        jeffBubble:
          "No worries — let me take a different angle. Pick what fits below. 🤔",
      });
    }

    // 'select' — bind the chosen customer_id to the row, clear the
    // candidates list, then send OTP for the resolved single account.
    const supabase = createSupabaseAdminClient();

    // ─── PLAN-03 Phase 1 — SMS-pump defense on the 'select' branch ────
    // BotID first (cheapest), then IP rate-limit. Phone rate-limit needs
    // the phone off the row — read it here so we can key the limit even
    // though the action's arg only carries selected_customer_id. We
    // reject BEFORE the picker write so a pumping bot can't churn the
    // row's customer_id field while attacking.
    const bot = await checkBotForSensitiveAction();
    if (!bot.ok) {
      Sentry.captureMessage("submit_multi_account_choice_v2 bot detected", {
        level: "warning",
        tags: {
          surface: "submit_multi_account_choice_v2_bot_gate",
          chat_id: chatId,
        },
      });
      return { ok: false, error: "bot_detected" };
    }

    const ip = await getRequestIp();
    const ipCheck = await checkIpRateLimit(ip);
    if (!ipCheck.allowed) {
      Sentry.captureMessage(
        "submit_multi_account_choice_v2 IP rate-limited",
        {
          level: "warning",
          tags: {
            surface: "submit_multi_account_choice_v2_ip_limit",
            chat_id: chatId,
          },
        },
      );
      return { ok: false, error: ipCheck.reason };
    }

    // Phone limit — best-effort read; on read failure we proceed without
    // it (IP + bot + DB-level limit are still active). Skipping the
    // phone limit on a transient read error is strictly better than
    // failing-closed and breaking legitimate disambiguation.
    const { data: phoneRow } = await supabase
      .from("customer_chat_sessions")
      .select("phone_e164")
      .eq("id", chatId)
      .maybeSingle();
    if (
      typeof phoneRow?.phone_e164 === "string" &&
      phoneRow.phone_e164.length > 0
    ) {
      const phoneCheck = await checkPhoneRateLimit(phoneRow.phone_e164);
      if (!phoneCheck.allowed) {
        Sentry.captureMessage(
          "submit_multi_account_choice_v2 phone rate-limited",
          {
            level: "warning",
            tags: {
              surface: "submit_multi_account_choice_v2_phone_limit",
              chat_id: chatId,
            },
          },
        );
        return { ok: false, error: phoneCheck.reason };
      }
    }

    const { error: pickErr } = await supabase
      .from("customer_chat_sessions")
      .update({
        customer_id: parsed.data.selected_customer_id,
        pending_candidates: null,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", chatId);
    if (pickErr) {
      Sentry.captureException(pickErr, {
        tags: { surface: "submit_multi_account_choice_v2_select_write" },
        level: "error",
      });
      return { ok: false, error: pickErr.message };
    }

    // Send OTP via the scheduler-otp-direct 'resend' op — internally
    // calls sendOtp + stamps otp_sent_at + resets otp_attempts to 0.
    // Same path the OtpInput card's Resend button uses, reused here
    // as the first-send for this newly-resolved customer_id.
    let otpResult;
    try {
      otpResult = await callOtpResend({ session_id: chatId });
    } catch (e) {
      const reasonTag =
        e instanceof OtpDirectError
          ? `otp_send_${e.status ?? "network"}`
          : "otp_send_unknown";
      Sentry.captureException(e, {
        tags: {
          surface: "submit_multi_account_choice_v2_otp_send",
          reason: reasonTag,
        },
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
          "Hmm, something glitched while sending your code. Please call us at (610) 253-6565. 📞",
      });
    }

    if (!otpResult.ok) {
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: `otp_send_${otpResult.error}`,
        },
        nextStep: "escalated",
        jeffBubble:
          otpResult.error === "rate_limited"
            ? "Looks like we've sent a few codes already. Please call us at (610) 253-6565. 📞"
            : "Hmm, the code didn't go through. Please call us at (610) 253-6565. 📞",
      });
    }

    return applyWizardTransition({
      chatId,
      updates: {},
      nextStep: "otp_pending",
      jeffBubble: "Got it — texting your code now! 📱",
    });
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "submit_multi_account_choice_v2" },
      level: "error",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const submitMultiAccountChoiceV2 = wrapAction(
  "submitMultiAccountChoiceV2",
  submitMultiAccountChoiceV2Impl,
);
