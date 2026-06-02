"use server";

/**
 * Step 2 — Phone + name submit (V2, server-state-driven).
 *
 * Per chat-design.md §Step 2 + the Architecture amendment — 2026-05-14:
 *
 *   1. Validate first_name + last_name + phone_e164 (Zod, server-side)
 *   2. Pre-write the customer's input to the row so even if the downstream
 *      Tekmetric/Telnyx call fails, the data isn't lost (row-as-truth)
 *   3. Call the deterministic scheduler-step2-direct edge function — same
 *      one /book uses today; reuses callStep2Direct + step2-direct-client.ts
 *   4. Map the returned directive to the matching WizardStep
 *   5. Hand off to applyWizardTransition for the step advance + bubble +
 *      revalidate
 *
 * No LLM in this path. The Tekmetric lookup + Telnyx send happen inside
 * the edge function deterministically (per the Phase 1 refactor that
 * predates this migration).
 */
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  callStep2Direct,
  Step2DirectError,
} from "@/lib/scheduler/step2-direct-client";
import { applyWizardTransition } from "@/lib/scheduler/wizard/transition";
import type { WizardTransitionResult } from "@/lib/scheduler/wizard/transition-types";
import type { WizardStep } from "@/lib/scheduler/session-state";
import { logError } from "@/lib/scheduler/wizard/log-error";
import { wrapAction } from "@/lib/scheduler/wizard/instrument-action";
// SEC-7 — defense-in-depth against SMS pumping. BotID classifies the caller
// as bot/human (client challenge + server check); the per-phone-hash limit
// (3/hour) is a Postgres RPC; the per-IP limit is a Vercel Firewall edge rule
// (no app code). The app gate fails OPEN so legitimate OTPs aren't broken;
// the DB-level otp_codes 3/phone/hour cap is the final backstop.
import { checkBotForSensitiveAction } from "@/lib/security/check-bot";
import { checkPhoneRateLimit } from "@/lib/security/rate-limit";
import { getCachedSessionRow } from "@/lib/scheduler/cache";

// ─── Input validation ───────────────────────────────────────────────────────

const submitPhoneNameSchema = z.object({
  chatId: z.string().min(1),
  first_name: z.string().trim().min(1).max(50),
  last_name: z.string().trim().min(1).max(50),
  // The PhoneNameCard normalizes to E.164 +1XXXXXXXXXX before calling us.
  phone_e164: z.string().regex(/^\+1\d{10}$/),
});

export type SubmitPhoneNameV2Args = z.infer<typeof submitPhoneNameSchema>;

// ─── Directive → step mapping (single source of truth) ──────────────────────

/**
 * scheduler-step2-direct's documented directive shape per
 * step2-direct-client.ts line 27-35. Includes the legacy
 * 'show_new_customer_form' alias the function still emits per
 * spec deviation flagged at scheduler-step2-direct/index.ts:216-229.
 */
function directiveToNextStep(directive: string): WizardStep | null {
  switch (directive) {
    case "send_otp_first":
      return "otp_pending";
    case "show_no_match_choose_path":
      return "no_match_choose_path";
    case "show_multi_account_disambiguation":
      return "multi_account_disambiguation";
    case "show_partial_verification_gate":
      return "partial_verification_gate";
    case "show_new_customer_info_card":
    case "show_new_customer_form":
      return "new_customer_info";
    case "show_escalation_card":
      return "escalated";
    default:
      return null;
  }
}

function bubbleForDirective(directive: string): string | undefined {
  switch (directive) {
    case "send_otp_first":
      return "Texting your security code now — give it a sec! 📱";
    case "show_partial_verification_gate":
      return "Hmm, I see your name on file but not this phone. Let me know how you'd like to continue.";
    case "show_multi_account_disambiguation":
      return "A few accounts share this number — which vehicle are you here for?";
    case "show_no_match_choose_path":
      return "I can't quite find that combo on file — let me know how you'd like to continue.";
    case "show_new_customer_info_card":
    case "show_new_customer_form":
      return "Welcome aboard! Let's set up your account real quick.";
    case "show_escalation_card":
      return "Sorry — I'm hitting a snag. Please call us at (610) 253-6565 and we'll get you sorted. 📞";
    default:
      return undefined;
  }
}

// ─── Server Action ──────────────────────────────────────────────────────────

async function submitPhoneNameV2Impl(
  args: SubmitPhoneNameV2Args,
): Promise<WizardTransitionResult> {
  const parsed = submitPhoneNameSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const { chatId, first_name, last_name, phone_e164 } = parsed.data;

  // ─── SEC-7 — SMS-pump defense (bot → phone gates) ───────────────────
  // Cheapest check first (BotID is a single header read). The per-IP limit
  // is enforced upstream at the Vercel Firewall edge; the remaining gates
  // must pass before we touch the DB or call the edge fn that talks to Telnyx.
  const bot = await checkBotForSensitiveAction();
  if (!bot.ok) {
    Sentry.captureMessage("submit_phone_name_v2 bot detected", {
      level: "warning",
      tags: { surface: "submit_phone_name_v2_bot_gate", chat_id: chatId },
    });
    return { ok: false, error: "bot_detected" };
  }

  const phoneCheck = await checkPhoneRateLimit(phone_e164);
  if (!phoneCheck.allowed) {
    Sentry.captureMessage("submit_phone_name_v2 phone rate-limited", {
      level: "warning",
      tags: { surface: "submit_phone_name_v2_phone_limit", chat_id: chatId },
    });
    return { ok: false, error: phoneCheck.reason };
  }

  try {
    const supabase = createSupabaseAdminClient();

    // Step 1: pre-write the customer's typed input + bump last_active_at.
    // Don't change current_step yet — the directive from step2-direct
    // determines what comes next. Per chat-design.md "Architecture
    // amendment" + locked decision #1, the row is the source of truth;
    // writing the values now guarantees they survive a downstream failure.
    const { error: prewriteErr } = await supabase
      .from("customer_chat_sessions")
      .update({
        entered_first_name: first_name,
        entered_last_name: last_name,
        phone_e164,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", chatId);
    if (prewriteErr) {
      Sentry.captureException(prewriteErr, {
        tags: { surface: "submit_phone_name_v2_prewrite" },
        level: "error",
      });
      return { ok: false, error: prewriteErr.message };
    }

    // Step 2: read the greeting bucket (set by submitGreetingV2 at Step 1).
    // step2-direct's §4.3 reconciliation matrix needs it to decide between
    // 'show_no_match_choose_path' (returning) and 'show_new_customer_info_card'
    // (new / unsure).
    // SEC-7: read via the shared getCachedSessionRow helper (per-request
    // memoized, service-role; throws on DB error → caught by the outer
    // try/catch). The prewrite above didn't touch customer_self_identified.
    const row = await getCachedSessionRow(chatId);
    const bucket =
      (row?.customer_self_identified as
        | "returning"
        | "new"
        | "unsure"
        | null) ?? "unsure";

    // Step 3: call the deterministic edge function. 30s timeout (matches
    // the client default in step2-direct-client.ts).
    let step2Result;
    try {
      step2Result = await callStep2Direct({
        session_id: chatId,
        first_name,
        last_name,
        phone_e164,
        customer_self_identified: bucket,
      });
    } catch (e) {
      const reasonTag =
        e instanceof Step2DirectError
          ? `step2_direct_${e.status ?? "network"}`
          : "step2_direct_unknown";
      Sentry.captureException(e, {
        tags: {
          surface: "submit_phone_name_v2_step2_call",
          reason: reasonTag,
        },
        level: "error",
      });
      // Fail-safe: escalate so the customer has a path forward. The row
      // already has their input; advisors can pick up the thread on the
      // shop phone.
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: reasonTag,
        },
        nextStep: "escalated",
        jeffBubble:
          "Hmm, something glitched on my end while reaching our system. Please call us at (610) 253-6565 and we'll take care of you. 📞",
      });
    }

    // Step 4: map directive → next_step. Defense in depth: an unknown
    // directive shouldn't crash; route to escalation with a tagged reason.
    const nextStep = directiveToNextStep(step2Result.directive);
    if (!nextStep) {
      Sentry.captureMessage("submit_phone_name_v2 unknown directive", {
        level: "warning",
        extra: { directive: step2Result.directive, chatId },
      });
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: `step2_unknown_directive:${step2Result.directive}`,
        },
        nextStep: "escalated",
        jeffBubble:
          "Sorry — something unexpected came back. Please call us at (610) 253-6565. 📞",
      });
    }

    // Step 4b: show_escalation_card path — step2-direct hit either a
    // multi-name-match-no-phone block (security risk to disclose) OR
    // sendOtp rate_limited / send_failed OR Tekmetric lookup failure.
    // The directive maps to step='escalated' but we ALSO need to write
    // status/escalated_at/escalation_reason so the row stays consistent
    // and the transcript email + EscalationCard render correctly.
    // (Bug audit 2026-05-16: previously this branch fell through to the
    // catch-all transition below with empty branchUpdates, leaving
    // status='active' + reason=null while current_step='escalated'.)
    if (step2Result.directive === "show_escalation_card") {
      const reason =
        typeof (step2Result.data as { reason?: unknown })?.reason === "string"
          ? ((step2Result.data as { reason: string }).reason)
          : "step2_direct_escalation";
      return applyWizardTransition({
        chatId,
        updates: {
          status: "escalated",
          escalated_at: new Date().toISOString(),
          escalation_reason: reason,
        },
        nextStep: "escalated",
        jeffBubble: bubbleForDirective(step2Result.directive),
      });
    }

    // Step 5: branch-specific row updates.
    const branchUpdates: Record<string, unknown> = {};

    // 'send_otp_first' implies OTP was sent successfully — stamp otp_sent_at
    // on the row in case the edge function didn't (it does, per the
    // function's source, but mirroring here is cheap insurance).
    if (step2Result.directive === "send_otp_first") {
      branchUpdates.otp_attempts = 0;
    }

    // 'show_multi_account_disambiguation' — persist the vehicle-only
    // candidates the edge fn returned so getCurrentCard's
    // multi_account_disambiguation case can hydrate the picker. Without
    // this, pending_candidates stays NULL, parseCandidates returns [],
    // and the user sees an empty list with no candidates to pick.
    // (Bug audit 2026-05-16: this was a known TODO in the Phase 4
    // implementation that never got done in Phase 5.)
    if (step2Result.directive === "show_multi_account_disambiguation") {
      const candidates = (step2Result.data as { candidates?: unknown })
        ?.candidates;
      if (Array.isArray(candidates)) {
        branchUpdates.pending_candidates = candidates;
      }
    }

    // 'show_partial_verification_gate' — Phase 4 plan was to stash
    // matched_axis on the row. Deferred to V2.1 since the column doesn't
    // exist yet AND step2-direct only ever emits 'name'. getCurrentCard
    // hard-codes matched_axis='name' as a documented Phase 1 default;
    // when a future migration adds the column + step2-direct starts
    // emitting 'phone', this branch will need to persist it.

    return applyWizardTransition({
      chatId,
      updates: branchUpdates,
      nextStep,
      jeffBubble: bubbleForDirective(step2Result.directive),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: { surface: "submit_phone_name_v2", chat_id: chatId },
      level: "error",
    });
    await logError({
      chatId,
      surface: "submit_phone_name_v2",
      error_code: "uncaught",
      message: msg,
      stack: e instanceof Error ? (e.stack ?? null) : null,
    });
    return { ok: false, error: msg };
  }
}

export const submitPhoneNameV2 = wrapAction(
  "submitPhoneNameV2",
  submitPhoneNameV2Impl,
);
