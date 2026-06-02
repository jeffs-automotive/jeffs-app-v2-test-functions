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
import { checkPhoneRateLimit } from "@/lib/security/rate-limit";
import { getCachedSessionRow } from "@/lib/scheduler/cache";

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

/**
 * Runtime validation schema for the pending_candidates JSONB column.
 *
 * Plan 04 post-validator H3 fix (2026-05-25):
 *
 * The IDOR check below filters `c.customer_id === selected_customer_id`
 * against an untyped JSON array. A raw TS cast (the prior implementation)
 * would silently produce objects without `customer_id` if the writer
 * shape ever drifts — every legitimate selection would then fail the
 * .some() check → all customers rejected as "not member."
 *
 * The migration history (PLAN-04 spec/reality mismatch on this exact
 * field) shows this is a real risk surface. zod validation surfaces
 * drift immediately as a Sentry error.
 *
 * recent_vehicle is .nullable() because some live rows from before
 * scheduler-step2-direct's recent_vehicle filter (lines 267-269 of
 * that file) was added still have null values. Don't fail-closed on
 * null — only fail when customer_id is missing or wrong type.
 */
const pendingCandidateSchema = z.object({
  customer_id: z.number().int().positive(),
  recent_vehicle: z.string().nullable(),
});
const pendingCandidatesSchema = z.array(pendingCandidateSchema).nullable();

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
    // Extract selected_customer_id into a local so TS narrowing
    // survives the later `await` + closure boundaries (control-flow
    // narrowing on parsed.data isn't preserved across awaits).
    const { selected_customer_id } = parsed.data;
    const supabase = createSupabaseAdminClient();

    // ─── SEC-7 — SMS-pump defense on the 'select' branch ──────────────
    // BotID first (cheapest); the per-IP limit is enforced upstream at the
    // Vercel Firewall edge. Phone rate-limit needs the phone off the row —
    // read it below so we can key the limit even though the action's arg
    // only carries selected_customer_id. We reject BEFORE the picker write
    // so a pumping bot can't churn the row's customer_id field while attacking.
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

    // Combined row read: phone_e164 (for the phone rate-limit below)
    // AND pending_candidates (for the PLAN-04 Phase 3B IDOR check).
    // Single query saves a round-trip vs. the prior 2-read flow.
    //
    // pending_candidates shape per the writer at supabase/functions/
    // scheduler-step2-direct/index.ts:262-269:
    //   Array<{ customer_id: number; recent_vehicle: string }>
    // (Plan 04 spec proposed `Array<{ id: number }>` — corrected here
    // per the live schema; the spec shape would reject every legitimate
    // selection.)
    // SEC-7: read via the shared getCachedSessionRow helper (per-request
    // memoized, service-role; throws on DB error → caught by the outer
    // try/catch, which fails the IDOR gate closed). Replaces the prior
    // ad-hoc read that silently dropped the Supabase error.
    const rowReadResult = await getCachedSessionRow(chatId);

    // ─── PLAN-04 Phase 3B (closes I-COR-5) — IDOR defense ─────────────
    // The disambiguation card only renders customer_ids that came from
    // scheduler-step2-direct's phone match. A tampered Server Action
    // call could bind any customer_id to the row, hijacking another
    // shop customer's identity. Require selected_customer_id to be in
    // the session's pending_candidates list.
    //
    // Hard-fail on null/empty/read-failure: this is a security gate,
    // not the rate-limit's best-effort posture. If we can't verify
    // membership, refuse the write.
    //
    // H3 post-validator (2026-05-25): runtime-validate the JSONB shape
    // via zod (not a raw cast) so writer drift in scheduler-step2-direct
    // surfaces immediately as a Sentry error instead of silently
    // rejecting every legitimate selection.
    const candidatesParsed = pendingCandidatesSchema.safeParse(
      rowReadResult?.pending_candidates ?? null,
    );
    if (!candidatesParsed.success) {
      Sentry.captureMessage(
        "submit_multi_account_choice_v2 pending_candidates shape mismatch",
        {
          level: "error",
          tags: {
            surface: "submit_multi_account_choice_v2_shape_check",
            chat_id: chatId,
          },
          extra: {
            issues: candidatesParsed.error.issues.slice(0, 5),
            sample_received: JSON.stringify(
              rowReadResult?.pending_candidates ?? null,
            ).slice(0, 500),
          },
        },
      );
      // Fail-closed on shape drift — better to block + alert than to
      // silently pass-through-malformed-data. Operator gets a Sentry
      // error pointing at the writer drift; can fix + retry.
      return {
        ok: false,
        error: "customer_id_invalid",
      };
    }
    const candidates = candidatesParsed.data;
    const isMember = candidates?.some(
      (c) => c.customer_id === selected_customer_id,
    );
    if (!isMember) {
      Sentry.captureMessage("customer_id_not_in_pending_candidates", {
        level: "warning",
        tags: {
          surface: "submit_multi_account_choice_v2_idor",
          chat_id: chatId,
        },
        extra: {
          attempted_customer_id: selected_customer_id,
          candidate_count: candidates?.length ?? 0,
        },
      });
      return {
        ok: false,
        error: "customer_id_invalid",
      };
    }

    // Phone limit — best-effort read; on read failure we proceed without
    // it (IP + bot + DB-level limit are still active). Skipping the
    // phone limit on a transient read error is strictly better than
    // failing-closed and breaking legitimate disambiguation.
    if (
      typeof rowReadResult?.phone_e164 === "string" &&
      rowReadResult.phone_e164.length > 0
    ) {
      const phoneCheck = await checkPhoneRateLimit(rowReadResult.phone_e164);
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

    // ─── H2 post-validator fix (2026-05-25): customer_id write order ───
    //
    // The prior implementation wrote customer_id + cleared
    // pending_candidates BEFORE calling callOtpResend. If the OTP send
    // failed (throw or !ok), the escalation path didn't clear
    // customer_id — the row was left claiming customer identity without
    // any OTP verification. Any later code path treating customer_id
    // as identity-trusted would have re-opened the IDOR surface that
    // Phase 3B was meant to close.
    //
    // Verified safe to defer (scheduler-otp-direct's handleResend reads
    // ONLY phone_e164 — line 276): customer_id is not needed for OTP
    // SEND, only for OTP VERIFY. Sending the OTP first + binding the
    // customer_id only after OTP send succeeds eliminates the
    // bound-but-unverified state on failure paths.
    //
    // Bonus: post-OTP-success commit goes through applyWizardTransition
    // (Phase 1A atomic RPC) instead of a direct .update — picks up
    // server-canonical last_active_at + atomicity for free.
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
      // No customer_id was written; escalation safe to issue without
      // a cleanup write.
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
      // Same: no customer_id was written; escalation is clean.
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

    // OTP send succeeded — NOW commit the customer_id binding +
    // clear pending_candidates + advance to otp_pending. All atomic
    // via applyWizardTransition's RPC.
    return applyWizardTransition({
      chatId,
      updates: {
        customer_id: selected_customer_id,
        pending_candidates: null,
      },
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
