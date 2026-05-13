"use server";

/**
 * Server Actions for wizard step submissions (Phase 1 row-as-truth
 * refactor 2026-05-13).
 *
 * Per chat-design.md locked architecture decision #1: each card's submit
 * writes its data DIRECTLY to `customer_chat_sessions` columns via these
 * Server Actions. The chat agent LLM (if it runs at all this turn) reads
 * the row, never message text. Orchestrator specialists read the row
 * when they need real values (phone for Telnyx, customer_id for Tekmetric,
 * etc.).
 *
 * Each action:
 *   1. UPDATEs the matching columns
 *   2. Bumps `current_step`
 *   3. (Optionally) invokes orchestrator-direct via consultOrchestrator
 *      for server-side work (lookup, OTP, hold, confirm)
 *   4. Returns `SessionActionResult` — a structured directive the client
 *      uses to render the next card (typically via the AI SDK tool-result
 *      handler, which threads the directive back through the chat agent
 *      for now; Stage 3 eliminates that round-trip).
 *
 * IMPORTANT: these are Server Actions (the "use server" directive at the
 * top). They run on Vercel Node runtime, NOT in the browser. The Supabase
 * admin client is service-role and bypasses RLS — callers are app-level
 * trusted (they're invoked by the wizard's own cards).
 *
 * Audit logging: each Server Action appends a row to
 * `scheduler_audit_log` (event_type='card_submitted' or 'tool_called') for
 * the per-step audit trail. PII-sanitized event_detail.
 */

import * as Sentry from "@sentry/nextjs";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/database.types";
import {
  consultOrchestrator,
  OrchestratorError,
} from "@/lib/scheduler/orchestrator-client";
import {
  listWaiterTimes as bookingListWaiterTimes,
  holdSlot as bookingHoldSlot,
  confirmBooking as bookingConfirmBooking,
  createCustomer as bookingCreateCustomer,
  createVehicle as bookingCreateVehicle,
  type NewCustomerPayload,
  type NewVehiclePayload,
} from "@/lib/scheduler/booking-direct-client";
import {
  callStep2Direct,
  Step2DirectError,
} from "@/lib/scheduler/step2-direct-client";
import { getBubbleCopy } from "@/lib/scheduler/bubble-templates";
import { scanForEscalationKeywords } from "@/lib/scheduler/escalation-keywords";
import {
  greetingBucketToBoolean,
  type GreetingBucket,
  type WizardStep,
} from "@/lib/scheduler/session-state";
// Types live in a separate file — "use server" forbids non-async function
// exports, and that includes plain interface re-exports through the file.
// The semantic-directive→tool-name mapping is applied in Chat.tsx at the
// addToolResult boundary so this file can stay focused on row writes.
import type { SessionActionResult } from "./session-action-types";

// SHOP_ID copied from chat-store.ts to avoid an import cycle (chat-store
// would import this file's types if we re-exported). Phase 1 single-shop.
const SHOP_ID_FOR_MESSAGES = 7476;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface AuditEventDetail {
  [k: string]: unknown;
}

async function logAudit(args: {
  session_id: string;
  step: WizardStep;
  event_type: string;
  event_detail?: AuditEventDetail;
  error_message?: string;
  latency_ms?: number;
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  // Best-effort logging; never throw from here.
  try {
    await supabase.from("scheduler_audit_log").insert({
      session_id: args.session_id,
      step: args.step,
      event_type: args.event_type,
      event_detail: args.event_detail ?? null,
      error_message: args.error_message ?? null,
      latency_ms: args.latency_ms ?? null,
    });
  } catch (e) {
    // Don't block customer flow on audit failure, but DO surface to Sentry
    // — silent catches violate .claude/rules/observability.md rule 15
    // ("Empty .catch() ... are CI-blocked"). Warning level (not error) so
    // it doesn't spam the issues list when the table is temporarily
    // unavailable.
    Sentry.captureException(e, {
      tags: { surface: "scheduler_audit_log", wizard_step: args.step },
      level: "warning",
    });
  }
}

async function writeSession(args: {
  chatId: string;
  updates: Record<string, unknown>;
  nextStep?: WizardStep;
}): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const payload: Record<string, unknown> = {
    ...args.updates,
    last_active_at: new Date().toISOString(),
  };
  if (args.nextStep) payload.current_step = args.nextStep;
  const { error } = await supabase
    .from("customer_chat_sessions")
    .update(payload)
    .eq("id", args.chatId);
  if (error) {
    throw new Error(
      `customer_chat_sessions UPDATE failed for ${args.chatId}: ${error.message}`,
    );
  }
}

function tooErrResult(err: unknown, step: WizardStep): SessionActionResult {
  // Every Server Action's catch path funnels through here. Capture to
  // Sentry so the failure leaves a trace even though we return a graceful
  // tool_error directive to the chat agent. Per observability rule 14
  // ("Never console.log(error) in production code. Use
  // Sentry.captureException with extra+tags").
  Sentry.captureException(err, {
    tags: { surface: "server_action", wizard_step: step },
    level: "error",
  });
  const msg = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    directive: "tool_error",
    flags: { internal_error: true },
    bubble_copy: getBubbleCopy("tool_error"),
    current_step: step,
    error: msg,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 1 — Greeting
// ═════════════════════════════════════════════════════════════════════════════

export async function submitGreeting(args: {
  chatId: string;
  is_returning: GreetingBucket;
}): Promise<SessionActionResult> {
  try {
    await writeSession({
      chatId: args.chatId,
      updates: {
        is_returning_customer: greetingBucketToBoolean(args.is_returning),
        // The orchestrator's resolveCustomerSession reads
        // `customer_self_identified` (text 'returning'|'new'|'unsure') —
        // NOT the boolean. Without this write the specialist's identity
        // reconciliation matrix can't fire correctly (always sees NULL,
        // falls back to defaults). Boolean kept for app-layer convenience.
        customer_self_identified: args.is_returning,
        greeting_answered_at: new Date().toISOString(),
      },
      nextStep: "phone_name",
    });
    await logAudit({
      session_id: args.chatId,
      step: "greeting",
      event_type: "card_submitted",
      event_detail: { bucket: args.is_returning },
    });

    const stepLabel =
      args.is_returning === "returning"
        ? "Step 2 · Welcome back"
        : args.is_returning === "new"
          ? "Step 2 · Let's get you set up"
          : "Step 2 · A few details";

    return {
      ok: true,
      directive: "show_phone_name_card",
      data: { step_label: stepLabel },
      bubble_copy: getBubbleCopy(`greeting_${args.is_returning}`),
      current_step: "phone_name",
    };
  } catch (e) {
    await logAudit({
      session_id: args.chatId,
      step: "greeting",
      event_type: "tool_failed",
      error_message: e instanceof Error ? e.message : String(e),
    });
    return tooErrResult(e, "greeting");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 2 — Phone + Name (triggers Tekmetric lookup + OTP send)
// ═════════════════════════════════════════════════════════════════════════════

export async function submitPhoneName(args: {
  chatId: string;
  first_name: string;
  last_name: string;
  phone_e164: string;
}): Promise<SessionActionResult> {
  try {
    // Write the row FIRST so even if the downstream Tekmetric/Telnyx call
    // fails, the customer's data isn't lost (row-as-truth per locked
    // decision #1).
    await writeSession({
      chatId: args.chatId,
      updates: {
        entered_first_name: args.first_name,
        entered_last_name: args.last_name,
        phone_e164: args.phone_e164,
      },
      nextStep: "otp_pending",
    });
    await logAudit({
      session_id: args.chatId,
      step: "phone_name",
      event_type: "card_submitted",
      event_detail: {
        phone_last_four: args.phone_e164.slice(-4),
        first_name_length: args.first_name.length,
        last_name_length: args.last_name.length,
      },
    });

    // Read the customer_self_identified bucket from the row (set by
    // submitGreeting at Step 1). Required for the §4.3 reconciliation
    // matrix below.
    const supabase = createSupabaseAdminClient();
    const { data: prior } = await supabase
      .from("customer_chat_sessions")
      .select("customer_self_identified")
      .eq("id", args.chatId)
      .maybeSingle();
    const bucket =
      (prior?.customer_self_identified as
        | "returning"
        | "new"
        | "unsure"
        | null) ?? "unsure";

    // DETERMINISTIC Step 2 path per chat-design.md §605 + audit B-1
    // (2026-05-13 ship). The prior LLM-specialist path (orchestrator-
    // direct → scheduler specialist → generateText → JSON.parse) was
    // empirically fragile: free-form text parsing failed on Haiku
    // drift, returning directive='tool_error' even when send_otp had
    // succeeded. The new scheduler-step2-direct edge function does the
    // same Tekmetric lookup + §4.3 reconciliation + Telnyx send in
    // plain TypeScript — no LLM, no parsing.
    const startedAt = Date.now();
    const step2 = await callStep2Direct({
      session_id: args.chatId,
      first_name: args.first_name,
      last_name: args.last_name,
      phone_e164: args.phone_e164,
      customer_self_identified: bucket,
    });

    await logAudit({
      session_id: args.chatId,
      step: "phone_name",
      event_type: "tool_called",
      event_detail: {
        tool: "scheduler-step2-direct",
        directive: step2.directive,
        data_keys: step2.data ? Object.keys(step2.data) : [],
      },
      latency_ms: Date.now() - startedAt,
    });
    // Structured log so the deterministic path's outcome is visible in
    // Vercel logs without depending on Sentry.
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: "info",
        msg: "phone_name_step2_direct_result",
        session_id: args.chatId,
        directive: step2.directive,
        data_keys: step2.data ? Object.keys(step2.data) : [],
        latency_ms: Date.now() - startedAt,
      }),
    );

    // Map the deterministic directive to:
    //   - The chat-agent tool to render (via Chat.tsx's mapDirectiveToToolName)
    //   - A bubble_copy template
    //   - The next current_step value
    if (step2.directive === "send_otp_first") {
      return {
        ok: true,
        // Sent through mapDirectiveToToolName in Chat.tsx → show_otp_input
        directive: "send_otp_first",
        data: {
          phone_last_four: step2.data?.phone_last_four,
          ttl_seconds: step2.data?.ttl_seconds,
          attempts_remaining: 3,
        },
        bubble_copy: getBubbleCopy("phone_name_to_otp"),
        current_step: "otp_pending",
      };
    }
    if (step2.directive === "show_new_customer_form") {
      // No phone hits + bucket = new/unsure → new customer form
      await writeSession({
        chatId: args.chatId,
        updates: {},
        nextStep: "new_customer_info",
      });
      return {
        ok: true,
        directive: "show_new_customer_form",
        data: { mode: "full", ...(step2.data ?? {}) },
        bubble_copy: getBubbleCopy("show_new_customer_form"),
        current_step: "new_customer_info",
      };
    }
    if (step2.directive === "show_no_match_choose_path") {
      await writeSession({
        chatId: args.chatId,
        updates: {},
        nextStep: "no_match_choose_path",
      });
      return {
        ok: true,
        directive: "show_no_match_choose_path",
        data: step2.data ?? {},
        bubble_copy: getBubbleCopy("identity_match_required"),
        current_step: "no_match_choose_path",
      };
    }
    if (step2.directive === "show_multi_account_disambiguation") {
      await writeSession({
        chatId: args.chatId,
        updates: {},
        nextStep: "multi_account_disambiguation",
      });
      return {
        ok: true,
        directive: "show_multi_account_disambiguation",
        data: step2.data ?? {},
        bubble_copy: getBubbleCopy("identity_match_required"),
        current_step: "multi_account_disambiguation",
      };
    }
    if (step2.directive === "show_partial_verification_gate") {
      await writeSession({
        chatId: args.chatId,
        updates: {},
        nextStep: "partial_verification_gate",
      });
      return {
        ok: true,
        directive: "show_partial_verification_gate",
        data: step2.data ?? {},
        bubble_copy: getBubbleCopy("partial_verification"),
        current_step: "partial_verification_gate",
      };
    }
    // show_escalation_card (Telnyx or Tekmetric hard fail)
    if (step2.directive === "show_escalation_card") {
      await writeSession({
        chatId: args.chatId,
        updates: {
          escalated_at: new Date().toISOString(),
          escalation_reason:
            String(step2.data?.reason ?? "step2_direct_failed"),
          status: "escalated",
        },
        nextStep: "escalated",
      });
      return {
        ok: true,
        directive: "show_escalation_card",
        data: {
          reason: step2.data?.reason ?? "step2_direct_failed",
          shop_phone: step2.data?.shop_phone ?? "6102536565",
          allow_back_to_scheduling: true,
        },
        bubble_copy: getBubbleCopy("escalate"),
        current_step: "escalated",
      };
    }

    // Unknown directive — defensive escalation. Should never fire since
    // the edge function's response shape is finite + tested.
    Sentry.captureMessage("step2_direct_unknown_directive", {
      level: "warning",
      tags: { surface: "server_action", wizard_step: "phone_name" },
      extra: { directive: step2.directive, data: step2.data },
    });
    return {
      ok: false,
      directive: "show_escalation_card",
      data: {
        reason: `step2_direct_unknown_directive:${step2.directive}`,
        shop_phone: "6102536565",
      },
      bubble_copy: getBubbleCopy("escalate"),
      current_step: "escalated",
    };
  } catch (e) {
    if (e instanceof Step2DirectError) {
      await logAudit({
        session_id: args.chatId,
        step: "phone_name",
        event_type: "tekmetric_error",
        error_message: e.message,
      });
    } else if (e instanceof OrchestratorError) {
      await logAudit({
        session_id: args.chatId,
        step: "phone_name",
        event_type: "tekmetric_error",
        error_message: e.message,
      });
    } else {
      await logAudit({
        session_id: args.chatId,
        step: "phone_name",
        event_type: "tool_failed",
        error_message: e instanceof Error ? e.message : String(e),
      });
    }
    return tooErrResult(e, "phone_name");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 3 — OTP verify
// ═════════════════════════════════════════════════════════════════════════════

export async function submitOtp(args: {
  chatId: string;
  code: string;
}): Promise<SessionActionResult> {
  try {
    await logAudit({
      session_id: args.chatId,
      step: "otp_pending",
      event_type: "card_submitted",
      event_detail: { code_length: args.code.length },
    });

    // Pre-read the session row so the orchestrator/specialist context can
    // be enriched (closes edge audit finding I-3). The specialist
    // previously got "Customer submitted Step 3 OTP code. Verify it." +
    // hints.code — it had to figure out phone_e164 + the next-step tool
    // chain from a one-sentence context. Now we hand it the explicit
    // tool chain to execute.
    const supabase = createSupabaseAdminClient();
    const { data: priorRow } = await supabase
      .from("customer_chat_sessions")
      .select("phone_e164, customer_self_identified, otp_attempts")
      .eq("id", args.chatId)
      .maybeSingle();

    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context:
        `Customer submitted Step 3 OTP code (6 digits). Tool chain:\n` +
        `  1. verify_otp({ phone_e164: <from session_metadata>, code: <hints.code> })\n` +
        `  2. If verified=true → get_appointment_eligibility → lookup_vehicles_for_customer\n` +
        `     → emit directive 'show_vehicle_picker' with vehicles+ineligibility.\n` +
        `  3. If verified=false and error='invalid_code' → emit 'show_otp_input'\n` +
        `     with attempts_remaining in data. After 3 cumulative failures\n` +
        `     across the session, emit 'show_escalation_card'.\n` +
        `  4. If verified=false and error='expired' → emit 'show_otp_input'\n` +
        `     with a fresh send_otp call first.`,
      hints: {
        code: args.code,
        phone_e164: priorRow?.phone_e164 ?? null,
        customer_self_identified:
          priorRow?.customer_self_identified ?? null,
        session_otp_attempts_before: priorRow?.otp_attempts ?? 0,
      },
      intent_type: "verify_otp",
    });
    await logAudit({
      session_id: args.chatId,
      step: "otp_pending",
      event_type: "tool_called",
      event_detail: { tool: "verify_otp", directive: result.directive },
      latency_ms: Date.now() - startedAt,
    });

    // Per chat-design.md §3 (Step 3 OTP) + audit M-3: bump the
    // session-level otp_attempts counter on a wrong/expired/no-active
    // result. otp_codes.attempts counts per-code; customer_chat_sessions
    // .otp_attempts counts per-session, which is what the 3-strike
    // escalation logic and the customer-facing "X tries left" UX read.
    // The specialist already increments otp_codes via verify_otp; we
    // mirror at session level here.
    const failedDirectives = new Set([
      "tool_error",
      "show_escalation_card",
      "escalate",
    ]);
    const stayedAtOtp = result.directive === "show_otp_input";
    const escalated = failedDirectives.has(result.directive ?? "");
    if (stayedAtOtp || escalated) {
      const nextAttempts = (priorRow?.otp_attempts ?? 0) + 1;
      await supabase
        .from("customer_chat_sessions")
        .update({
          otp_attempts: nextAttempts,
          last_active_at: new Date().toISOString(),
        })
        .eq("id", args.chatId);
    }

    // For returning customers per chat-design.md §Step 5: after OTP
    // verify, route to show_customer_info_edit (NOT directly to vehicle
    // picker). The customer needs a chance to confirm/edit phones/emails/
    // address before we lock the appointment. Only new customers / unsure
    // bucket that fell through to NewCustomerForm skip this step.
    const verifiedReturning =
      result.directive === "show_vehicle_picker" &&
      priorRow?.customer_self_identified === "returning";
    if (verifiedReturning) {
      return {
        ok: true,
        directive: "show_customer_info_edit",
        data: {
          // The specialist's verify_otp returned vehicles in result.data —
          // we'll stash them for the next step and read them after the
          // customer-info-edit submit so we don't re-call Tekmetric.
          stashed_vehicle_data: result.data ?? null,
          // The card itself will be hydrated by the route handler / agent
          // via show_customer_info_edit tool with first_name + initial_*
          // fields populated from the row + Tekmetric lookup. Server
          // Action returns the directive shell; the chat agent fills in
          // the card's input from the snapshot + result.data.
        },
        flags: result.flags,
        bubble_copy: getBubbleCopy("otp_to_info_edit"),
        current_step: "customer_info_edit",
      };
    }

    return {
      ok: result.directive !== "tool_error",
      directive: result.directive,
      data: result.data,
      flags: result.flags,
      // Bubble depends on outcome — orchestrator sets verified state on the row.
      bubble_copy:
        result.directive === "show_vehicle_picker"
          ? getBubbleCopy("to_vehicle_pick")
          : undefined,
    };
  } catch (e) {
    return tooErrResult(e, "otp_pending");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 3 (resend) — Resend OTP
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resend the OTP for an existing session that's already on Step 3
 * (otp_pending). Triggered by the OTP card's "Resend code" button per
 * chat-design.md §Step 3 lines 645-651.
 *
 * Does NOT increment session-level otp_attempts — that counter is for
 * wrong-CODE attempts, not resend requests. The per-phone rate limit
 * (3 active codes per hour) prevents abuse at the OTP layer.
 */
export async function resendOtp(args: {
  chatId: string;
}): Promise<SessionActionResult> {
  try {
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("customer_chat_sessions")
      .select("phone_e164, entered_first_name, entered_last_name")
      .eq("id", args.chatId)
      .maybeSingle();

    await logAudit({
      session_id: args.chatId,
      step: "otp_pending",
      event_type: "otp_resend_requested",
      event_detail: {
        phone_last_four: row?.phone_e164
          ? String(row.phone_e164).slice(-4)
          : null,
      },
    });

    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context:
        `Customer tapped Resend on Step 3. Tool chain:\n` +
        `  1. send_otp({ phone_e164: <session_metadata.phone_e164> })\n` +
        `  2. Emit directive 'show_otp_input' with the fresh ttl_seconds and\n` +
        `     phone_last_four. Do NOT call lookup_customer_by_phone (already\n` +
        `     done at Step 2).\n` +
        `  3. If send_otp returns 'rate_limited' or 'send_failed', emit\n` +
        `     'show_escalation_card' with the appropriate reason.`,
      hints: {
        phone_e164: row?.phone_e164 ?? null,
        is_resend: true,
      },
      intent_type: "verify_and_lookup",
    });
    await logAudit({
      session_id: args.chatId,
      step: "otp_pending",
      event_type: "tool_called",
      event_detail: {
        tool: "send_otp",
        is_resend: true,
        directive: result.directive,
      },
      latency_ms: Date.now() - startedAt,
    });

    return {
      ok: result.directive !== "tool_error",
      directive: result.directive ?? "show_otp_input",
      data: result.data,
      flags: result.flags,
      bubble_copy:
        result.directive === "show_otp_input"
          ? getBubbleCopy("phone_name_to_otp")
          : undefined,
    };
  } catch (e) {
    return tooErrResult(e, "otp_pending");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 5 (returning customer) — Customer info edit
// ═════════════════════════════════════════════════════════════════════════════

export async function submitCustomerInfoEdit(args: {
  chatId: string;
  edited_phones: Array<{ phone_e164: string; is_primary: boolean }>;
  edited_emails: Array<{ email: string; is_primary: boolean }>;
  edited_address: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  primary_email_for_description: string | null;
}): Promise<SessionActionResult> {
  try {
    await writeSession({
      chatId: args.chatId,
      updates: {
        edited_phones: args.edited_phones,
        edited_emails: args.edited_emails,
        edited_address: args.edited_address,
        primary_email_for_description: args.primary_email_for_description,
      },
      nextStep: "vehicle_pick",
    });
    await logAudit({
      session_id: args.chatId,
      step: "customer_info_edit",
      event_type: "card_submitted",
      event_detail: {
        phone_count: args.edited_phones.length,
        email_count: args.edited_emails.length,
        has_address: !!args.edited_address,
        has_primary_email: !!args.primary_email_for_description,
      },
    });

    // Per chat-design.md spec line 946 ("Submit triggers a Tekmetric
    // PATCH if anything changed") + lines 1015-1018 ("Server Action
    // posts to orchestrator-direct with intent_type='patch_customer'"):
    // patch the changes through to Tekmetric BEFORE advancing to vehicle
    // pick. Without this, edits silently die at the session row and
    // Tekmetric stays stale.
    //
    // Only full-verification customers reach this Server Action (the
    // partial-verify path skips this step entirely per spec line 285).
    // So we can safely PATCH without checking identity_verification_level.
    //
    // Best-effort: if the PATCH fails (Tekmetric outage / LLM-specialist
    // JSON parse drift), we still proceed to vehicle_pick — the customer
    // shouldn't be blocked from booking by a stale-data issue. Audit log
    // captures the failure for retroactive fix-up.
    const patchStartedAt = Date.now();
    const hasChanges =
      args.edited_phones.length > 0 ||
      args.edited_emails.length > 0 ||
      args.edited_address !== null;
    if (hasChanges) {
      try {
        const patchResult = await consultOrchestrator({
          session_id: args.chatId,
          context:
            `Customer submitted Step 5 customer-info edits. Tool chain:\n` +
            `  1. patch_customer({\n` +
            `       customer_id: <session_metadata.customer_id>,\n` +
            `       edited_phones: <session_metadata.edited_phones>,\n` +
            `       edited_emails: <session_metadata.edited_emails>,\n` +
            `       edited_address: <session_metadata.edited_address>,\n` +
            `     })\n` +
            `     Tekmetric §12.1.2 array-PATCH semantics are handled\n` +
            `     internally by the patch_customer tool.\n` +
            `  2. On success → emit directive 'continue' with\n` +
            `     data: { patched: true }.\n` +
            `  3. On Tekmetric error → emit 'tool_error' with\n` +
            `     flags.tekmetric_error=true and data.reason.`,
          intent_type: "patch_customer",
          hints: {
            customer_id_from_row: true,
          },
        });
        await logAudit({
          session_id: args.chatId,
          step: "customer_info_edit",
          event_type:
            patchResult.directive === "tool_error"
              ? "tool_failed"
              : "tool_succeeded",
          event_detail: {
            tool: "patch_customer",
            directive: patchResult.directive,
          },
          latency_ms: Date.now() - patchStartedAt,
        });
      } catch (e) {
        // Don't block the customer from booking on a PATCH failure —
        // their edits remain in the row for retroactive sync. Log + carry.
        await logAudit({
          session_id: args.chatId,
          step: "customer_info_edit",
          event_type: "tool_failed",
          event_detail: { tool: "patch_customer" },
          error_message: e instanceof Error ? e.message : String(e),
          latency_ms: Date.now() - patchStartedAt,
        });
        Sentry.captureException(e, {
          tags: {
            surface: "server_action",
            wizard_step: "customer_info_edit",
            stage: "patch_customer",
          },
          level: "warning",
        });
      }
    }

    // Now request the vehicle list from the orchestrator so the next
    // card (show_vehicle_picker) has fresh Tekmetric vehicles. The
    // orchestrator reads customer_id from the row.
    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context:
        `Customer's Step 5 PATCH (if any) is complete. Tool chain:\n` +
        `  1. lookup_vehicles_for_customer({ customer_id: <session_metadata.customer_id> })\n` +
        `  2. Emit directive 'show_vehicle_picker' with the vehicle list.`,
      intent_type: "lookup_vehicles",
    });
    await logAudit({
      session_id: args.chatId,
      step: "customer_info_edit",
      event_type: "tool_called",
      event_detail: {
        tool: "lookup_vehicles_for_customer",
        directive: result.directive,
      },
      latency_ms: Date.now() - startedAt,
    });

    return {
      ok: result.directive !== "tool_error",
      directive: result.directive ?? "show_vehicle_picker",
      data: result.data,
      flags: result.flags,
      bubble_copy: getBubbleCopy("to_vehicle_pick"),
      current_step: "vehicle_pick",
    };
  } catch (e) {
    return tooErrResult(e, "customer_info_edit");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 4 (NEW CLIENT) — New customer info
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Spec-aligned new-customer info submit per chat-design.md §2595-2683.
 *
 * Replaces the legacy combined-card `submitNewCustomer`. This Server
 * Action receives Step 4 form output (emails + address; phone already
 * verified at Step 3, name carried from Step 2), persists the edited
 * fields onto the row, then calls Tekmetric POST /customers
 * IMMEDIATELY via scheduler-booking-direct's `create_customer` op.
 *
 * On success: customer_id + identity_verification_level='full' are
 * persisted by the edge function; this Server Action just advances the
 * wizard to `new_vehicle_form` and returns the show_new_vehicle_form
 * directive.
 *
 * Failure modes per spec §2651-§2654:
 *   - Tekmetric 409 phone-duplicate → friendly bubble + restart at
 *     Step 1 with `is_returning_customer=true` (the spec's intended UX).
 *   - Tekmetric 4xx (validation) → surface as a graceful tool_error
 *     so the card shows the error inline. Phase 1 minimal: we
 *     return the directive `show_escalation_card` so the customer
 *     can call. A later refinement will pipe Tekmetric errors back
 *     into the inline FormMessage on the right field.
 *   - Tekmetric 5xx → same escalation path. Spec §2651 calls for one
 *     retry with 1s backoff; that's TODO on the edge function side.
 */
export async function submitNewCustomerInfo(args: {
  chatId: string;
  edited_phones: Array<{ phone_e164: string; is_primary: boolean }>;
  edited_emails: Array<{ email: string; is_primary: boolean }>;
  edited_address: {
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zip: string;
  };
  primary_email_for_description: string;
}): Promise<SessionActionResult> {
  try {
    // Persist the edited fields to the row BEFORE the Tekmetric call —
    // ensures resume works correctly if the network drops mid-POST.
    await writeSession({
      chatId: args.chatId,
      updates: {
        edited_phones: args.edited_phones,
        edited_emails: args.edited_emails,
        edited_address: args.edited_address,
        primary_email_for_description: args.primary_email_for_description,
      },
    });
    await logAudit({
      session_id: args.chatId,
      step: "new_customer_info",
      event_type: "card_submitted",
      event_detail: {
        phone_count: args.edited_phones.length,
        email_count: args.edited_emails.length,
        has_address: true,
      },
    });

    // Look up the verified phone + name (Step 2 saved verified_*).
    const supabase = createSupabaseAdminClient();
    const { data: rowRaw } = await supabase
      .from("customer_chat_sessions")
      .select("*")
      .eq("id", args.chatId)
      .maybeSingle();
    const row = rowRaw as Record<string, unknown> | null;
    const firstName = String(row?.verified_first_name ?? "").trim();
    const lastName = String(row?.verified_last_name ?? "").trim();
    const verifiedPhone = String(row?.phone_e164 ?? "").trim();
    if (!firstName || !lastName) {
      throw new Error(
        "verified_first_name / verified_last_name missing on row (Step 2 did not persist)",
      );
    }
    if (!/^\+1\d{10}$/.test(verifiedPhone)) {
      throw new Error("phone_e164 missing or malformed on row");
    }

    // Pick the primary email for the Tekmetric customer record.
    const primaryEmail =
      args.edited_emails.find((e) => e.is_primary)?.email
        ?? args.edited_emails[0]?.email
        ?? args.primary_email_for_description;

    // Address shape: Tekmetric wants { streetAddress, city, state, zip }.
    // We collected address1 + address2 separately; concat them.
    const addressBlock: NewCustomerPayload["address"] = {
      streetAddress: [args.edited_address.address1, args.edited_address.address2]
        .filter((s) => s && s.trim().length > 0)
        .join(" ")
        .trim(),
      city: args.edited_address.city,
      state: args.edited_address.state,
      zip: args.edited_address.zip,
    };

    const startedAt = Date.now();
    const result = await bookingCreateCustomer({
      op: "create_customer",
      session_id: args.chatId,
      payload: {
        first_name: firstName,
        last_name: lastName,
        phone_e164: verifiedPhone,
        email: primaryEmail,
        address: addressBlock,
      },
    });

    if (!result.ok) {
      await logAudit({
        session_id: args.chatId,
        step: "new_customer_info",
        event_type: "tool_failed",
        event_detail: {
          tool: "createCustomer",
          error: result.error,
          tekmetric_error_text: result.tekmetric_error_text ?? null,
        },
        latency_ms: Date.now() - startedAt,
      });
      // 409 phone-duplicate: per spec §2653, route back to Step 1 with
      // returning-customer flow. Phase 1 minimal — we use the
      // show_no_match_choose_path card to let them pick "try returning"
      // or "use a different phone".
      if (result.error === "phone_duplicate") {
        return {
          ok: true,
          directive: "show_no_match_choose_path",
          data: {
            attempted_phone_last_four: verifiedPhone.slice(-4),
            attempted_first_name: firstName,
          },
          bubble_copy:
            "Hmm — that phone number is already on file with us. Want to try as a returning customer?",
          current_step: "phone_name",
        };
      }
      // 4xx / 5xx — surface as a graceful escalation. Future refinement:
      // surface the Tekmetric error inline on the relevant field.
      return {
        ok: false,
        directive: "tool_error",
        flags: { tekmetric_error: true },
        bubble_copy: getBubbleCopy("tool_error"),
        error: result.tekmetric_error_text ?? result.error,
        current_step: "new_customer_info",
      };
    }

    // Success — customer_id + identity_verification_level='full' are
    // already persisted by the edge function. Advance to Step 5.
    await writeSession({
      chatId: args.chatId,
      updates: {},
      nextStep: "new_vehicle_form",
    });
    await logAudit({
      session_id: args.chatId,
      step: "new_customer_info",
      event_type: "tool_succeeded",
      event_detail: { tool: "createCustomer", customer_id: result.customer_id },
      latency_ms: Date.now() - startedAt,
    });
    return {
      ok: true,
      directive: "show_new_vehicle_form",
      data: {
        step_label: "Step 5 · Add your vehicle",
        title: "Now tell me about your ride! 🚗",
      },
      bubble_copy: "Account set up! 🎉",
      current_step: "new_vehicle_form",
    };
  } catch (e) {
    return tooErrResult(e, "new_customer_info");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 3.5 — Identity reconciliation forks (partial/none/multi)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Customer picked a path on NoMatchChoosePathCard (Step 3.5b).
 *   - 'continue_as_new' → route to NewCustomerForm.
 *   - 'try_different_phone' → bounce back to PhoneNameCard (clear phone +
 *     OTP state, keep first/last name pre-filled for continuity).
 */
export async function submitNoMatchChoice(args: {
  chatId: string;
  action: "continue_as_new" | "try_different_phone";
}): Promise<SessionActionResult> {
  try {
    await logAudit({
      session_id: args.chatId,
      step: "no_match_choose_path",
      event_type: "card_submitted",
      event_detail: { action: args.action },
    });

    if (args.action === "try_different_phone") {
      await writeSession({
        chatId: args.chatId,
        updates: {
          phone_e164: null,
          otp_sent_at: null,
          otp_verified_at: null,
          otp_attempts: 0,
        },
        nextStep: "phone_name",
      });
      return {
        ok: true,
        directive: "show_phone_name_card",
        data: {
          // Pre-fill first/last name so the customer doesn't retype.
          step_label: "Step 2 · Try a different number",
        },
        bubble_copy: getBubbleCopy("retry_phone"),
        current_step: "phone_name",
      };
    }

    // continue_as_new — set up the new-customer flow
    await writeSession({
      chatId: args.chatId,
      updates: {
        customer_self_identified: "new",
      },
      nextStep: "new_customer_info",
    });
    return {
      ok: true,
      directive: "show_new_customer_form",
      data: { mode: "full" },
      bubble_copy: getBubbleCopy("show_new_customer_form"),
      current_step: "new_customer_info",
    };
  } catch (e) {
    return tooErrResult(e, "no_match_choose_path");
  }
}

/**
 * Customer picked a path on PartialVerificationGateCard (Step 3.5).
 *   - 'use_different_phone' → bounce back to PhoneNameCard.
 *   - 'proceed_as_partial' → continue with the partial match (lower
 *     identity_verification_level — orchestrator's downstream actions
 *     gate sensitive operations on this).
 *   - 'continue_as_new' → fork to new-customer flow.
 *   - 'escalate' → straight to escalation.
 */
export async function submitPartialVerificationChoice(args: {
  chatId: string;
  action:
    | "use_different_phone"
    | "proceed_as_partial"
    | "continue_as_new"
    | "escalate";
}): Promise<SessionActionResult> {
  try {
    await logAudit({
      session_id: args.chatId,
      step: "partial_verification_gate",
      event_type: "card_submitted",
      event_detail: { action: args.action },
    });

    if (args.action === "escalate") {
      return submitEscalate({
        chatId: args.chatId,
        reason: "partial_verification:customer_chose_escalate",
      });
    }

    if (args.action === "use_different_phone") {
      await writeSession({
        chatId: args.chatId,
        updates: {
          phone_e164: null,
          otp_sent_at: null,
          otp_verified_at: null,
          otp_attempts: 0,
        },
        nextStep: "phone_name",
      });
      return {
        ok: true,
        directive: "show_phone_name_card",
        data: { step_label: "Step 2 · Try a different number" },
        bubble_copy: getBubbleCopy("retry_phone"),
        current_step: "phone_name",
      };
    }

    if (args.action === "continue_as_new") {
      await writeSession({
        chatId: args.chatId,
        updates: { customer_self_identified: "new" },
        nextStep: "new_customer_info",
      });
      return {
        ok: true,
        directive: "show_new_customer_form",
        data: { mode: "full" },
        bubble_copy: getBubbleCopy("show_new_customer_form"),
        current_step: "new_customer_info",
      };
    }

    // proceed_as_partial — per chat-design.md spec line 217 + 285 + 918:
    //   "partial = no phone match BUT name match found (PII suppressed;
    //    no edits allowed; appointment-only access)"
    //   "Tekmetric PATCH on customer: BLOCKED (no customer-record writes)"
    //   "blocked_actions: ['edit_customer_info', 'patch_customer']"
    //
    // So partial users SKIP CustomerInfoEditCard entirely and go straight
    // to vehicle_pick (Step 6). The orchestrator's downstream sensitive-
    // action gates read identity_verification_level='partial' and refuse
    // any PATCH or edit operation.
    //
    // We need a vehicles list before rendering show_vehicle_picker, so
    // invoke the orchestrator with intent_type=lookup_vehicles. customer_id
    // was stashed onto the row earlier by scheduler-step2-direct when it
    // emitted the partial gate.
    await writeSession({
      chatId: args.chatId,
      updates: { identity_verification_level: "partial" },
      nextStep: "vehicle_pick",
    });
    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context:
        `Customer accepted the partial-verification gate. Their\n` +
        `identity_verification_level is 'partial' — PII suppressed, no\n` +
        `Tekmetric PATCH allowed (spec line 285). Tool chain:\n` +
        `  1. lookup_vehicles_for_customer({ customer_id: <session_metadata.customer_id> })\n` +
        `  2. Emit directive 'show_vehicle_picker' with the vehicle list.`,
      intent_type: "lookup_vehicles",
    });
    await logAudit({
      session_id: args.chatId,
      step: "vehicle_pick",
      event_type: "tool_called",
      event_detail: {
        tool: "lookup_vehicles_for_customer",
        partial_verification: true,
        directive: result.directive,
      },
      latency_ms: Date.now() - startedAt,
    });
    return {
      ok: result.directive !== "tool_error",
      directive: result.directive ?? "show_vehicle_picker",
      data: result.data,
      flags: result.flags,
      bubble_copy: getBubbleCopy("to_vehicle_pick"),
      current_step: "vehicle_pick",
    };
  } catch (e) {
    return tooErrResult(e, "partial_verification_gate");
  }
}

/**
 * Customer picked an account on MultiAccountDisambiguationCard (Step 3.5c)
 * OR said 'none of these'. Selecting writes the chosen customer_id to
 * the row + advances to OTP for that account.
 */
export async function submitMultiAccountChoice(args: {
  chatId: string;
  action: "select" | "none_of_these";
  selected_customer_id?: number;
}): Promise<SessionActionResult> {
  try {
    await logAudit({
      session_id: args.chatId,
      step: "multi_account_disambiguation",
      event_type: "card_submitted",
      event_detail: {
        action: args.action,
        selected: args.selected_customer_id ?? null,
      },
    });

    if (args.action === "none_of_these") {
      // Fall through to NoMatchChoosePathCard — treat as if zero matches.
      return {
        ok: true,
        directive: "show_no_match_choose_path",
        data: {},
        bubble_copy: getBubbleCopy("identity_match_required"),
        current_step: "no_match_choose_path",
      };
    }

    if (
      typeof args.selected_customer_id !== "number" ||
      !Number.isFinite(args.selected_customer_id)
    ) {
      throw new Error("multi_account_choice missing selected_customer_id");
    }

    await writeSession({
      chatId: args.chatId,
      updates: { customer_id: args.selected_customer_id },
      // After disambiguation we still need OTP to verify ownership.
      nextStep: "otp_pending",
    });

    // Re-trigger OTP send for the now-resolved account.
    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context:
        `Customer disambiguated multi-account match (selected customer_id=${args.selected_customer_id}). ` +
        `Tool chain: send_otp({ phone_e164: <session_metadata.phone_e164> }) → ` +
        `emit 'show_otp_input' with phone_last_four + ttl_seconds + ` +
        `attempts_remaining=3 (counter resets for the resolved account).`,
      hints: { selected_customer_id: args.selected_customer_id },
      intent_type: "verify_and_lookup",
    });
    await logAudit({
      session_id: args.chatId,
      step: "multi_account_disambiguation",
      event_type: "tool_called",
      event_detail: { tool: "send_otp", directive: result.directive },
      latency_ms: Date.now() - startedAt,
    });

    return {
      ok: result.directive !== "tool_error",
      directive: result.directive ?? "show_otp_input",
      data: result.data,
      flags: result.flags,
      bubble_copy: getBubbleCopy("phone_name_to_otp"),
      current_step: "otp_pending",
    };
  } catch (e) {
    return tooErrResult(e, "multi_account_disambiguation");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 6 — Vehicle pick / Add new vehicle
// ═════════════════════════════════════════════════════════════════════════════

export async function submitVehiclePick(args: {
  chatId: string;
  vehicle_id: string; // can be 'new' to flip to new_vehicle_form
}): Promise<SessionActionResult> {
  try {
    if (args.vehicle_id === "new") {
      await writeSession({
        chatId: args.chatId,
        updates: { vehicle_id: null, new_vehicle_info: {} },
        nextStep: "new_vehicle_form",
      });
      await logAudit({
        session_id: args.chatId,
        step: "vehicle_pick",
        event_type: "card_submitted",
        event_detail: { chose: "new" },
      });
      return {
        ok: true,
        directive: "show_new_customer_form",
        data: { mode: "vehicle-only" },
        bubble_copy: undefined,
        current_step: "new_vehicle_form",
      };
    }

    const vehicleIdInt = Number.parseInt(args.vehicle_id, 10);
    if (!Number.isFinite(vehicleIdInt)) {
      return {
        ok: false,
        directive: "tool_error",
        error: `Invalid vehicle_id: ${args.vehicle_id}`,
      };
    }
    await writeSession({
      chatId: args.chatId,
      updates: { vehicle_id: vehicleIdInt },
      nextStep: "service_concern_picker",
    });
    await logAudit({
      session_id: args.chatId,
      step: "vehicle_pick",
      event_type: "card_submitted",
      event_detail: { vehicle_id: vehicleIdInt },
    });
    return {
      ok: true,
      directive: "show_service_and_concern_picker",
      data: {},
      bubble_copy: getBubbleCopy("to_service_picker"),
      current_step: "service_concern_picker",
    };
  } catch (e) {
    return tooErrResult(e, "vehicle_pick");
  }
}

/**
 * Spec-aligned new-vehicle submit per chat-design.md §2684-2753 (new
 * client Step 5) + §1248-1306 (returning client Step 6 add-new
 * drill-down).
 *
 * Both flows reach this Server Action with the same payload shape:
 *   year (required, 1980-2027)
 *   make (required, 1-50)
 *   model (required, 1-50)
 *   license_plate (optional, ≤15)
 *   notes (optional, ≤200)
 *
 * Calls Tekmetric POST /vehicles IMMEDIATELY via the booking-direct
 * `create_vehicle` op. customer_id is read from the row (set at
 * Step 4 for new client, or pre-existing for returning).
 *
 * On success: vehicle_id is persisted by the edge function; this
 * Server Action advances the wizard to `service_concern_picker`.
 */
export async function submitNewVehicle(args: {
  chatId: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    license_plate?: string;
    notes?: string;
  };
}): Promise<SessionActionResult> {
  try {
    // Persist the form values to the row BEFORE the Tekmetric call —
    // resume safety. Use new_vehicle_info as the storage column.
    await writeSession({
      chatId: args.chatId,
      updates: {
        new_vehicle_info: args.vehicle as unknown as Json,
      },
    });
    await logAudit({
      session_id: args.chatId,
      step: "new_vehicle_form",
      event_type: "card_submitted",
      event_detail: {
        year: args.vehicle.year,
        make: args.vehicle.make,
        model: args.vehicle.model,
        has_plate: !!args.vehicle.license_plate,
        has_notes: !!args.vehicle.notes,
      },
    });

    const supabase = createSupabaseAdminClient();
    const { data: rowRaw } = await supabase
      .from("customer_chat_sessions")
      .select("*")
      .eq("id", args.chatId)
      .maybeSingle();
    const row = rowRaw as Record<string, unknown> | null;
    const customerId =
      typeof row?.customer_id === "number" ? row.customer_id : null;
    if (customerId == null) {
      throw new Error(
        "customer_id missing on row — Step 4 must complete before Step 5",
      );
    }

    const startedAt = Date.now();
    const result = await bookingCreateVehicle({
      op: "create_vehicle",
      session_id: args.chatId,
      customer_id: customerId,
      payload: {
        year: args.vehicle.year,
        make: args.vehicle.make,
        model: args.vehicle.model,
        license_plate: args.vehicle.license_plate,
        // notes stored only in new_vehicle_info for Phase 1 — spec §1281
        // "Phase 1 = stored verbatim, no AI parsing"; Tekmetric POST
        // /vehicles doesn't take a notes/comment field.
      },
    });

    if (!result.ok) {
      await logAudit({
        session_id: args.chatId,
        step: "new_vehicle_form",
        event_type: "tool_failed",
        event_detail: {
          tool: "createVehicle",
          error: result.error,
          tekmetric_error_text: result.tekmetric_error_text ?? null,
        },
        latency_ms: Date.now() - startedAt,
      });
      return {
        ok: false,
        directive: "tool_error",
        flags: { tekmetric_error: true },
        bubble_copy: getBubbleCopy("tool_error"),
        error: result.tekmetric_error_text ?? result.error,
        current_step: "new_vehicle_form",
      };
    }

    // Success — vehicle_id is persisted by the edge function. Advance.
    await writeSession({
      chatId: args.chatId,
      updates: {},
      nextStep: "service_concern_picker",
    });
    await logAudit({
      session_id: args.chatId,
      step: "new_vehicle_form",
      event_type: "tool_succeeded",
      event_detail: { tool: "createVehicle", vehicle_id: result.vehicle_id },
      latency_ms: Date.now() - startedAt,
    });
    return {
      ok: true,
      directive: "show_service_and_concern_picker",
      data: {},
      bubble_copy: `Got it — added your ${args.vehicle.year} ${args.vehicle.make} ${args.vehicle.model}! 🚗 ✨`,
      current_step: "service_concern_picker",
    };
  } catch (e) {
    return tooErrResult(e, "new_vehicle_form");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 7 — Service + concern picker, clarification, testing approval
// ═════════════════════════════════════════════════════════════════════════════

export async function submitServiceAndConcernPicker(args: {
  chatId: string;
  services: string[];
  concern_text?: string;
}): Promise<SessionActionResult> {
  try {
    const hasConcern = !!args.concern_text && args.concern_text.trim().length > 0;

    // Keyword scan per chat-design.md §A (lines 2849-2861). If the customer
    // typed a flagged word in the concern textarea, divert to escalation
    // BEFORE the diagnostic specialist runs (saves a Tekmetric call + an
    // LLM round-trip on a conversation we can't safely handle here).
    if (hasConcern) {
      const hit = scanForEscalationKeywords(args.concern_text);
      if (hit) {
        await logAudit({
          session_id: args.chatId,
          step: "service_concern_picker",
          event_type: "keyword_escalation",
          event_detail: { keyword: hit.keyword, category: hit.category },
        });
        return submitEscalate({
          chatId: args.chatId,
          reason: `keyword:${hit.category}:${hit.keyword}`,
        });
      }
    }
    await writeSession({
      chatId: args.chatId,
      updates: {
        selected_simple_services: args.services,
        explanation_required_items: hasConcern
          ? [{ service_key: "concern", explanation_text: args.concern_text }]
          : [],
      },
      nextStep: hasConcern ? "diagnostic_loading" : "appointment_type",
    });
    await logAudit({
      session_id: args.chatId,
      step: "service_concern_picker",
      event_type: "card_submitted",
      event_detail: {
        services_count: args.services.length,
        has_concern: hasConcern,
      },
    });

    if (!hasConcern) {
      return {
        ok: true,
        directive: "show_appointment_type",
        data: {},
        bubble_copy: getBubbleCopy("to_appointment_type"),
        current_step: "appointment_type",
      };
    }

    // Concern present → invoke diagnostic specialist
    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context:
        `Customer described a concern: "${args.concern_text}". Run the ` +
        `diagnostic specialist to classify category + decide if we need ` +
        `clarification questions or can go straight to testing-service ` +
        `recommendations.`,
      hints: { concern_text: args.concern_text },
      intent_type: "diagnose_concern",
    });
    await logAudit({
      session_id: args.chatId,
      step: "diagnostic_loading",
      event_type: "specialist_called",
      event_detail: { specialist: "diagnostic", directive: result.directive },
      latency_ms: Date.now() - startedAt,
    });

    // Transform the specialist's ARRAY-shaped clarify_concern_question
    // response into the single-question card shape the UI expects, and
    // persist the remaining questions for submitClarificationAnswer to
    // walk through one at a time.
    if (result.directive === "clarify_concern_question") {
      const shaped = await shapeClarificationDirective({
        chatId: args.chatId,
        data: (result.data ?? {}) as Record<string, unknown>,
      });
      return {
        ok: true,
        directive: shaped.directive,
        data: shaped.data,
        flags: result.flags,
        bubble_copy: getBubbleCopy("concern_to_diagnostic_loading"),
      };
    }

    // propose_testing_services: specialist returns
    // `recommended_testing_services` key but the UI reads `services`.
    // Rename so the TestingServiceApprovalCard actually renders the
    // list. Same shape gymnastics as the queue-drain path in
    // advanceClarificationQueue.
    if (result.directive === "propose_testing_services") {
      const rawData = (result.data ?? {}) as Record<string, unknown>;
      const services = Array.isArray(rawData.recommended_testing_services)
        ? rawData.recommended_testing_services
        : Array.isArray(rawData.services)
          ? rawData.services
          : [];
      const category = typeof rawData.category === "string"
        ? rawData.category
        : "";
      // Persist the deferred list so SummaryCard / downstream readers
      // can replay the recommendation set without re-asking the LLM.
      await writeSession({
        chatId: args.chatId,
        updates: {
          recommended_testing_services: services as unknown as Json,
          diagnostic_processing_complete: true,
        },
        nextStep: "testing_service_approval",
      });
      return {
        ok: true,
        directive: "propose_testing_services",
        data: { category, services },
        flags: result.flags,
        bubble_copy: getBubbleCopy("concern_to_diagnostic_loading"),
      };
    }

    // continue / tool_error / anything else flows through unchanged.
    return {
      ok: result.directive !== "tool_error",
      directive: result.directive,
      data: result.data,
      flags: result.flags,
      bubble_copy: getBubbleCopy("concern_to_diagnostic_loading"),
    };
  } catch (e) {
    return tooErrResult(e, "service_concern_picker");
  }
}

// ─── Clarification question pipeline helpers ───────────────────────────────
//
// The diagnostic specialist returns:
//   { category, questions: [{id, question_text, options}, ...],
//     recommended_testing_services: [...], reasoning }
// but the UI's ClarificationQuestionCard renders ONE question at a time
// with flat fields. These helpers bridge the contract:
//   - shapeClarificationDirective: pops the first question, persists the
//     remaining queue + the deferred testing services, returns the flat
//     card-ready shape.
//   - advanceClarificationQueue: called from submitClarificationAnswer to
//     either return the next pending question OR transition to propose
//     testing / continue when the queue empties.

type CatalogQuestion = {
  id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
};

type CatalogTestingService = {
  service_key: string;
  display_name: string;
  abbreviation?: string;
  starting_price_cents: number;
  notes?: string | null;
};

function parseQuestionList(raw: unknown): CatalogQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: CatalogQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = Number(r.id);
    const question_text = typeof r.question_text === "string"
      ? r.question_text
      : "";
    const options = Array.isArray(r.options)
      ? (r.options as unknown[])
          .filter(
            (o): o is { label: string; value: string } =>
              !!o &&
              typeof o === "object" &&
              typeof (o as Record<string, unknown>).label === "string" &&
              typeof (o as Record<string, unknown>).value === "string",
          )
      : [];
    if (Number.isFinite(id) && id > 0 && question_text && options.length > 0) {
      out.push({ id, question_text, options });
    }
  }
  return out;
}

async function shapeClarificationDirective(args: {
  chatId: string;
  data: Record<string, unknown>;
}): Promise<{
  directive: "clarify_concern_question" | "propose_testing_services" | "continue";
  data: Record<string, unknown>;
}> {
  const category = typeof args.data.category === "string"
    ? args.data.category
    : "";
  const questions = parseQuestionList(args.data.questions);
  const testingServices = Array.isArray(args.data.recommended_testing_services)
    ? (args.data.recommended_testing_services as CatalogTestingService[])
    : [];

  if (questions.length === 0) {
    // No questions to ask — go straight to testing proposal (or continue).
    if (testingServices.length > 0) {
      // Use `services` key — that's what the
      // TestingServiceApprovalCard renderer reads (Chat.tsx ~1237).
      return {
        directive: "propose_testing_services",
        data: { category, services: testingServices },
      };
    }
    return { directive: "continue", data: { category } };
  }

  // Pop the first question, persist the rest as the pending queue.
  const [first, ...rest] = questions;
  if (!first) {
    // Type-safety: shouldn't happen given the length check above.
    return { directive: "continue", data: { category } };
  }
  await writeSession({
    chatId: args.chatId,
    updates: {
      clarification_questions_pending: {
        category,
        remaining: rest,
        // Stash the testing services so we don't lose them while walking
        // through the queue — submitClarificationAnswer reads this back
        // when the queue drains.
        deferred_testing_services: testingServices,
      } as unknown as Json,
    },
  });

  return {
    directive: "clarify_concern_question",
    data: {
      question_id: first.id,
      question_text: first.question_text,
      options: first.options,
      category,
    },
  };
}

async function advanceClarificationQueue(args: {
  chatId: string;
}): Promise<SessionActionResult> {
  const supabase = createSupabaseAdminClient();
  const { data: row, error } = await supabase
    .from("customer_chat_sessions")
    .select("clarification_questions_pending")
    .eq("id", args.chatId)
    .maybeSingle();
  if (error) {
    throw new Error(`session read failed: ${error.message}`);
  }
  const pending = (row?.clarification_questions_pending ?? {}) as {
    category?: string;
    remaining?: CatalogQuestion[];
    deferred_testing_services?: CatalogTestingService[];
  };
  const category = typeof pending.category === "string" ? pending.category : "";
  const remaining = parseQuestionList(pending.remaining);
  const deferredTesting = Array.isArray(pending.deferred_testing_services)
    ? (pending.deferred_testing_services as CatalogTestingService[])
    : [];

  if (remaining.length > 0) {
    const [next, ...rest] = remaining;
    if (!next) {
      // Type-safety; shouldn't happen given length check.
      await writeSession({
        chatId: args.chatId,
        updates: { clarification_questions_pending: null },
      });
      return {
        ok: true,
        directive: "show_appointment_type",
        data: {},
        bubble_copy: getBubbleCopy("to_appointment_type"),
        current_step: "appointment_type",
      };
    }
    await writeSession({
      chatId: args.chatId,
      updates: {
        clarification_questions_pending: {
          category,
          remaining: rest,
          deferred_testing_services: deferredTesting,
        } as unknown as Json,
      },
    });
    return {
      ok: true,
      directive: "clarify_concern_question",
      data: {
        question_id: next.id,
        question_text: next.question_text,
        options: next.options,
        category,
      },
    };
  }

  // Queue drained — clear pending + emit the deferred next step.
  await writeSession({
    chatId: args.chatId,
    updates: {
      clarification_questions_pending: null,
      diagnostic_processing_complete: true,
      recommended_testing_services: deferredTesting as unknown as Json,
    },
    nextStep: deferredTesting.length > 0
      ? "testing_service_approval"
      : "appointment_type",
  });

  if (deferredTesting.length > 0) {
    return {
      ok: true,
      directive: "propose_testing_services",
      data: {
        category,
        // The UI's TestingServiceApprovalCard renderer reads
        // `tp.input.services` (Chat.tsx line ~1237). The diagnostic
        // specialist's `recommended_testing_services` key was getting
        // stripped to empty by the array-check fallback. Match the
        // card's expected key name.
        services: deferredTesting,
      },
    };
  }
  return {
    ok: true,
    directive: "show_appointment_type",
    data: {},
    bubble_copy: getBubbleCopy("to_appointment_type"),
    current_step: "appointment_type",
  };
}

export async function submitClarificationAnswer(args: {
  chatId: string;
  question_id: number;
  answer: string; // option value or "skipped"
}): Promise<SessionActionResult> {
  try {
    // Append to clarification_questions_answered JSONB
    const supabase = createSupabaseAdminClient();
    const { data: row, error: readErr } = await supabase
      .from("customer_chat_sessions")
      .select("clarification_questions_answered")
      .eq("id", args.chatId)
      .maybeSingle();
    if (readErr) throw new Error(`session read failed: ${readErr.message}`);

    const prev = (row?.clarification_questions_answered ??
      {}) as Record<string, string>;
    prev[String(args.question_id)] = args.answer;
    await writeSession({
      chatId: args.chatId,
      updates: { clarification_questions_answered: prev },
    });
    await logAudit({
      session_id: args.chatId,
      step: "clarification_question",
      event_type: "card_submitted",
      event_detail: { question_id: args.question_id, skipped: args.answer === "skipped" },
    });

    // Walk the pending-question queue locally — the diagnostic specialist
    // returned the full question set + deferred testing services in one
    // shot when the concern was first described, so we don't need a
    // second consultOrchestrator() call per question. (The prior version
    // called the specialist on EVERY answer, which was slow + expensive
    // + caused the specialist to drift its earlier classification.)
    return await advanceClarificationQueue({ chatId: args.chatId });
  } catch (e) {
    return tooErrResult(e, "clarification_question");
  }
}

export async function submitTestingApproval(args: {
  chatId: string;
  approved: string[];
  declined: string[];
}): Promise<SessionActionResult> {
  try {
    await writeSession({
      chatId: args.chatId,
      updates: {
        approved_testing_services: args.approved,
        declined_testing_services: args.declined,
      },
      nextStep: "appointment_type",
    });
    await logAudit({
      session_id: args.chatId,
      step: "testing_service_approval",
      event_type: "card_submitted",
      event_detail: {
        approved_count: args.approved.length,
        declined_count: args.declined.length,
      },
    });
    return {
      ok: true,
      directive: "show_appointment_type",
      data: {},
      bubble_copy: args.approved.length > 0
        ? getBubbleCopy("testing_approved")
        : getBubbleCopy("testing_skipped"),
      current_step: "appointment_type",
    };
  } catch (e) {
    return tooErrResult(e, "testing_service_approval");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 8 — Appointment type
// ═════════════════════════════════════════════════════════════════════════════

export async function submitAppointmentType(args: {
  chatId: string;
  appointment_type: "waiter" | "dropoff";
}): Promise<SessionActionResult> {
  try {
    await writeSession({
      chatId: args.chatId,
      updates: { appointment_type: args.appointment_type },
      nextStep: "date_pick",
    });
    await logAudit({
      session_id: args.chatId,
      step: "appointment_type",
      event_type: "card_submitted",
      event_detail: { type: args.appointment_type },
    });

    // Deterministic slot fetch — bypass the orchestrator for this step.
    //
    // The scheduler specialist's generateText + Output.object pattern
    // intermittently returned `result.output === undefined` even with
    // structured output enforced, causing the fallback path to fire and
    // return `directive_parse_failed: true` → tool_error → no calendar
    // card rendered. Same fragility class as the 2026-05-13 Step 2 bug.
    //
    // Fix (F5-full pattern): same shape as scheduler-step2-direct —
    // query the slot data tables (closed_dates + appointment_default_limits)
    // directly here and synthesize the show_calendar_date_picker directive
    // without any LLM hop. The data is deterministic; no LLM needed.
    const availableDates = await computeAvailableDates({
      chatId: args.chatId,
      appointment_type: args.appointment_type,
      days_ahead: 30,
    });
    return {
      ok: true,
      directive: "show_calendar_date_picker",
      data: {
        available_dates: availableDates,
        type: args.appointment_type,
      },
      bubble_copy: getBubbleCopy("to_date_pick"),
      current_step: "date_pick",
    };
  } catch (e) {
    return tooErrResult(e, "appointment_type");
  }
}

// ─── Deterministic slot-availability helper ───────────────────────────────
//
// Replaces the orchestrator's fetch_slots round-trip for the calendar-date
// picker. Returns a sorted array of YYYY-MM-DD strings for days within the
// next `days_ahead` window that are NOT in closed_dates and NOT marked
// is_closed in appointment_default_limits for that day-of-week.
//
// Notes:
// - Capacity-based exclusion (full days) is NOT applied here. listAvailableSlots
//   in the Edge bundle does that with appointment_blocks + held capacity;
//   re-implementing here would duplicate ~80 lines of slot math. The customer
//   can still pick a "full" day and see no times in the waiter time picker;
//   we'll filter out fully-blocked days in a follow-up.
// - Sunday is the default closed day (seeded into closed_dates via the
//   schema migration's generate_series).
async function computeAvailableDates(args: {
  chatId: string;
  appointment_type: "waiter" | "dropoff";
  days_ahead: number;
}): Promise<string[]> {
  const supabase = createSupabaseAdminClient();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() + args.days_ahead);

  const ymd = (d: Date): string => d.toISOString().slice(0, 10);

  // Fetch closed_dates in the window.
  const { data: closed, error: closedErr } = await supabase
    .from("closed_dates")
    .select("closed_date")
    .gte("closed_date", ymd(today))
    .lt("closed_date", ymd(endDate));
  if (closedErr) {
    throw new Error(`closed_dates query failed: ${closedErr.message}`);
  }
  const closedSet = new Set(
    (closed ?? []).map((r) => r.closed_date as string),
  );

  // Fetch appointment_default_limits → day_of_week → is_closed map.
  const { data: limits, error: limitsErr } = await supabase
    .from("appointment_default_limits")
    .select("day_of_week, is_closed");
  if (limitsErr) {
    throw new Error(
      `appointment_default_limits query failed: ${limitsErr.message}`,
    );
  }
  const closedDows = new Set(
    (limits ?? [])
      .filter((r) => r.is_closed)
      .map((r) => r.day_of_week as number),
  );

  // Walk the window day-by-day; collect dates that pass both filters.
  const result: string[] = [];
  for (
    let cursor = new Date(today);
    cursor < endDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = ymd(cursor);
    if (closedSet.has(date)) continue;
    if (closedDows.has(cursor.getUTCDay())) continue;
    result.push(date);
  }
  return result;
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 9 — Date pick + waiter time pick
// ═════════════════════════════════════════════════════════════════════════════

export async function submitDate(args: {
  chatId: string;
  selected_date: string; // YYYY-MM-DD
}): Promise<SessionActionResult> {
  try {
    // Read appointment_type to decide if we need a time picker next.
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("customer_chat_sessions")
      .select("appointment_type, customer_id, vehicle_id")
      .eq("id", args.chatId)
      .maybeSingle();
    const type = (row?.appointment_type ?? "dropoff") as "waiter" | "dropoff";

    await writeSession({
      chatId: args.chatId,
      updates: { appointment_date: args.selected_date },
      nextStep: type === "waiter" ? "waiter_time_pick" : "summary",
    });
    await logAudit({
      session_id: args.chatId,
      step: "date_pick",
      event_type: "card_submitted",
      event_detail: { date: args.selected_date, type },
    });

    if (type === "waiter") {
      // Deterministic waiter-time fetch via the booking-direct edge function.
      // Replaces the prior consultOrchestrator call that timed out at 30 s
      // (Sentry JEFFS-APP-V2-TEST-FUNCTIONS-2 2026-05-13).
      const wt = await bookingListWaiterTimes({
        op: "list_waiter_times",
        session_id: args.chatId,
        date: args.selected_date,
      });
      return {
        ok: true,
        directive: "show_waiter_time_picker",
        data: {
          date: args.selected_date,
          available_times: wt.available_times,
        },
        bubble_copy: getBubbleCopy("to_waiter_time_pick", {
          date: args.selected_date,
        }),
        current_step: "waiter_time_pick",
      };
    }

    // Dropoff — skip time pick and go directly to placing the hold + summary.
    // Service summary is captured at confirm time; for the hold we just need
    // a placeholder so the hold row passes its NOT-NULL service_summary check.
    const serviceSummary = await buildServiceSummary({
      chatId: args.chatId,
    });
    const hold = await bookingHoldSlot({
      op: "hold_slot",
      session_id: args.chatId,
      date: args.selected_date,
      type: "dropoff",
      service_summary: serviceSummary,
      customer_id:
        typeof row?.customer_id === "number" ? row.customer_id : undefined,
      vehicle_id:
        typeof row?.vehicle_id === "number" ? row.vehicle_id : undefined,
    });
    if (!hold.ok) {
      // 'slot_just_taken' → re-show the calendar picker; capacity changed.
      return {
        ok: true,
        directive: "show_calendar_date_picker",
        data: {
          available_dates: await computeAvailableDates({
            chatId: args.chatId,
            appointment_type: "dropoff",
            days_ahead: 30,
          }),
          type: "dropoff",
        },
        bubble_copy: "That slot was just taken — please pick another day.",
        current_step: "date_pick",
      };
    }
    return {
      ok: true,
      directive: "show_summary_card",
      data: await buildSummaryCardData({
        chatId: args.chatId,
        hold_id: hold.hold_id,
        hold_expires_at: hold.expires_at,
      }),
      bubble_copy: getBubbleCopy("to_summary"),
      current_step: "summary",
    };
  } catch (e) {
    return tooErrResult(e, "date_pick");
  }
}

export async function submitWaiterTime(args: {
  chatId: string;
  selected_time: string; // HH:MM
}): Promise<SessionActionResult> {
  try {
    await writeSession({
      chatId: args.chatId,
      updates: { appointment_time: args.selected_time },
      nextStep: "summary",
    });
    await logAudit({
      session_id: args.chatId,
      step: "waiter_time_pick",
      event_type: "card_submitted",
      event_detail: { time: args.selected_time },
    });

    // Read the row to get the chosen date + any existing customer/vehicle IDs.
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("customer_chat_sessions")
      .select("appointment_date, customer_id, vehicle_id")
      .eq("id", args.chatId)
      .maybeSingle();
    const date = String(row?.appointment_date ?? "");
    if (!date) {
      throw new Error("appointment_date missing on session row");
    }

    const serviceSummary = await buildServiceSummary({
      chatId: args.chatId,
    });
    await logAudit({
      session_id: args.chatId,
      step: "waiter_time_pick",
      event_type: "pre_hold_call",
      event_detail: {
        date,
        time: args.selected_time,
        service_summary_len: serviceSummary.length,
        customer_id: typeof row?.customer_id === "number" ? row.customer_id : null,
        vehicle_id: typeof row?.vehicle_id === "number" ? row.vehicle_id : null,
      },
    });
    let hold: Awaited<ReturnType<typeof bookingHoldSlot>>;
    try {
      hold = await bookingHoldSlot({
        op: "hold_slot",
        session_id: args.chatId,
        date,
        time: args.selected_time,
        type: "waiter",
        service_summary: serviceSummary,
        customer_id:
          typeof row?.customer_id === "number" ? row.customer_id : undefined,
        vehicle_id:
          typeof row?.vehicle_id === "number" ? row.vehicle_id : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logAudit({
        session_id: args.chatId,
        step: "waiter_time_pick",
        event_type: "hold_slot_threw",
        event_detail: { error: msg.slice(0, 500) },
      });
      throw e;
    }
    await logAudit({
      session_id: args.chatId,
      step: "waiter_time_pick",
      event_type: "hold_slot_result",
      event_detail: {
        ok: hold.ok,
        hold_id: hold.hold_id ?? null,
        error: hold.error ?? null,
      },
    });
    if (!hold.ok) {
      // 'slot_just_taken' → re-show waiter time picker with refreshed list.
      const refreshed = await bookingListWaiterTimes({
        op: "list_waiter_times",
        session_id: args.chatId,
        date,
      });
      return {
        ok: true,
        directive: "show_waiter_time_picker",
        data: {
          date,
          available_times: refreshed.available_times,
        },
        bubble_copy: "That time was just taken — please pick another.",
        current_step: "waiter_time_pick",
      };
    }
    return {
      ok: true,
      directive: "show_summary_card",
      data: await buildSummaryCardData({
        chatId: args.chatId,
        hold_id: hold.hold_id,
        hold_expires_at: hold.expires_at,
      }),
      bubble_copy: getBubbleCopy("to_summary"),
      current_step: "summary",
    };
  } catch (e) {
    return tooErrResult(e, "waiter_time_pick");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   STEP 10 — Summary confirm + customer notes + customer question
// ═════════════════════════════════════════════════════════════════════════════

export async function submitSummaryConfirm(args: {
  chatId: string;
  confirmed: boolean;
  edit_target?: "date" | "vehicle" | "services" | "other";
}): Promise<SessionActionResult> {
  try {
    await logAudit({
      session_id: args.chatId,
      step: "summary",
      event_type: "card_submitted",
      event_detail: { confirmed: args.confirmed, edit_target: args.edit_target ?? null },
    });

    if (!args.confirmed) {
      // Customer wants to edit something — bump summary_edit_attempts +
      // route back to the appropriate step via orchestrator.
      const supabase = createSupabaseAdminClient();
      const { data: row } = await supabase
        .from("customer_chat_sessions")
        .select("summary_edit_attempts")
        .eq("id", args.chatId)
        .maybeSingle();
      const attempts = ((row?.summary_edit_attempts as number | null) ?? 0) + 1;
      await writeSession({
        chatId: args.chatId,
        updates: { summary_edit_attempts: attempts },
      });
      // Spec lock: allow TWO edits, escalate on the 3rd attempt.
      // Off-by-one fix 2026-05-13 per audit synthesis: was `>= 2`
      // which escalated on the 2nd edit (only allowed 1).
      if (attempts >= 3) {
        // Escalate per design lock (2-edit cap).
        return {
          ok: true,
          directive: "escalate",
          data: { reason: "summary_edit_limit" },
          bubble_copy: getBubbleCopy("escalate"),
        };
      }
      // Route back to date_pick by default — chat-design specifies finer-grained
      // per-section edits but Phase 1 routes everything through the calendar.
      await writeSession({
        chatId: args.chatId,
        updates: { current_step: "date_pick" },
      });
      return {
        ok: true,
        directive: "show_calendar_date_picker",
        data: {},
        current_step: "date_pick",
      };
    }

    // Customer confirmed → call the deterministic booking-direct
    // confirm_booking op. Per spec §2589-2755 (new client) + §1178-1408
    // (returning), customer_id + vehicle_id are ALREADY on the row by
    // this point — created at Step 4 / 5 / 6 respectively. confirm_booking
    // just runs confirmAppointment with the existing IDs (no inline
    // createCustomer / createVehicle chaining).
    const supabaseConfirm = createSupabaseAdminClient();
    const { data: confirmRowRaw } = await supabaseConfirm
      .from("customer_chat_sessions")
      .select("*")
      .eq("id", args.chatId)
      .maybeSingle();
    const confirmRow = confirmRowRaw as Record<string, unknown> | null;

    if (!confirmRow?.hold_token) {
      throw new Error("hold_token missing on session row — cannot confirm");
    }
    if (typeof confirmRow.customer_id !== "number") {
      throw new Error(
        "customer_id missing on row at summary confirm — Step 4 must have run",
      );
    }
    if (typeof confirmRow.vehicle_id !== "number") {
      throw new Error(
        "vehicle_id missing on row at summary confirm — Step 5/6 must have run",
      );
    }

    const title = await buildAppointmentTitle({ chatId: args.chatId });
    const description = await buildServiceSummary({ chatId: args.chatId });
    const apptOption =
      confirmRow.appointment_type === "waiter"
        ? "WAITER"
        : "PICKUP_DROPOFF";

    const startedAt = Date.now();
    let confirmResult: Awaited<ReturnType<typeof bookingConfirmBooking>>;
    try {
      confirmResult = await bookingConfirmBooking({
        op: "confirm_booking",
        session_id: args.chatId,
        hold_id: String(confirmRow.hold_token),
        customer_id: confirmRow.customer_id,
        vehicle_id: confirmRow.vehicle_id,
        title,
        description,
        appointment_option: apptOption,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logAudit({
        session_id: args.chatId,
        step: "summary",
        event_type: "confirm_threw",
        event_detail: { error: msg.slice(0, 2000) },
      });
      throw e;
    }
    await logAudit({
      session_id: args.chatId,
      step: "summary",
      event_type: "tool_called",
      event_detail: {
        tool: "scheduler-booking-direct:confirm_booking",
        ok: confirmResult.ok,
        error: confirmResult.error ?? null,
      },
      latency_ms: Date.now() - startedAt,
    });

    if (!confirmResult.ok) {
      return {
        ok: false,
        directive: "tool_error",
        flags: { tekmetric_error: true },
        bubble_copy: getBubbleCopy("tool_error"),
        error: confirmResult.error,
        current_step: "summary",
      };
    }

    const updates: Record<string, unknown> = {
      appointment_confirmed_at: new Date().toISOString(),
    };
    if (typeof confirmResult.appointment_id === "number") {
      updates.appointment_id = confirmResult.appointment_id;
    }
    await writeSession({
      chatId: args.chatId,
      updates,
      nextStep: "customer_notes",
    });
    return {
      ok: true,
      directive: "show_customer_notes_card",
      data: {
        appointment_id: confirmResult.appointment_id,
        starts_at: confirmResult.start_time,
      },
      bubble_copy: getBubbleCopy("appointment_confirmed", {
        starts_at_friendly: String(confirmResult.start_time ?? ""),
      }),
      current_step: "customer_notes",
    };
  } catch (e) {
    return tooErrResult(e, "summary");
  }
}

// ─── Helpers used by the F5-full booking ladder ──────────────────────────────

/**
 * Compose a one-line service summary from the session row's accumulated
 * service + concern signals. Used as the `service_summary` field of
 * `appointment_holds` and the `description` field of the Tekmetric
 * appointment.
 */
async function buildServiceSummary(args: {
  chatId: string;
}): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data: rowRaw } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", args.chatId)
    .maybeSingle();
  const row = rowRaw as Record<string, unknown> | null;
  const services = Array.isArray(row?.selected_simple_services)
    ? (row?.selected_simple_services as string[])
    : [];
  const explanations = Array.isArray(row?.explanation_required_items)
    ? (row?.explanation_required_items as Array<{
        service_key?: string;
        explanation_text?: string;
      }>)
    : [];
  const approvedTesting = Array.isArray(row?.approved_testing_services)
    ? (row?.approved_testing_services as string[])
    : [];

  const parts: string[] = [];
  if (services.length > 0) {
    parts.push(`Routine: ${services.join(", ")}`);
  }
  for (const ex of explanations) {
    if (ex?.explanation_text) {
      parts.push(`Concern: ${ex.explanation_text}`);
    }
  }
  if (approvedTesting.length > 0) {
    parts.push(`Testing approved: ${approvedTesting.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "General appointment";
}

/**
 * Build the Tekmetric appointment title per chat-design rule:
 *   '<first> <last> <year> <make> <model> <abbreviation>'
 * Falls back gracefully when some fields are absent.
 */
async function buildAppointmentTitle(args: {
  chatId: string;
}): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data: rowRaw } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", args.chatId)
    .maybeSingle();
  const row = rowRaw as Record<string, unknown> | null;
  const first = String(row?.verified_first_name ?? "").trim();
  const last = String(row?.verified_last_name ?? "").trim();
  const nvi = (row?.new_vehicle_info ?? {}) as Record<string, unknown>;
  const year = nvi.year ? String(nvi.year) : "";
  const make = nvi.make ? String(nvi.make).trim() : "";
  const model = nvi.model ? String(nvi.model).trim() : "";

  // Pick the first service abbreviation. Routine takes precedence over
  // testing per spec; falls back to a generic tag.
  const services = Array.isArray(row?.selected_simple_services)
    ? (row?.selected_simple_services as string[])
    : [];
  const approvedTesting = Array.isArray(row?.approved_testing_services)
    ? (row?.approved_testing_services as string[])
    : [];
  let abbreviation = "APPT";
  if (services.length > 0 || approvedTesting.length > 0) {
    const allKeys = [...services, ...approvedTesting];
    const lookup = await supabase
      .from("routine_services")
      .select("service_key, abbreviation")
      .in("service_key", allKeys);
    const routineMap = new Map(
      (lookup.data ?? []).map(
        (r) => [r.service_key as string, r.abbreviation as string],
      ),
    );
    const testingLookup = await supabase
      .from("testing_services")
      .select("service_key, abbreviation")
      .in("service_key", allKeys);
    const testingMap = new Map(
      (testingLookup.data ?? []).map(
        (r) => [r.service_key as string, r.abbreviation as string],
      ),
    );
    for (const k of allKeys) {
      const a = routineMap.get(k) ?? testingMap.get(k);
      if (a && a !== "TBD") {
        abbreviation = a;
        break;
      }
    }
  }
  return [first, last, year, make, model, abbreviation]
    .filter(Boolean)
    .join(" ");
}

/**
 * Build the data payload for SummaryCard. The card renderer in Chat.tsx
 * (case "show_summary_card", line 1436) reads tp.input.{hold_id,
 * hold_expires_at, starts_at, customer, vehicle, type, services,
 * reminders} — flat string-shaped fields, NOT the structured objects
 * the prior version returned. Shape matches SummaryCardProps in
 * heritage/SummaryCard.tsx.
 *
 *   customer:    "First Last"
 *   vehicle:     "Year Make Model"
 *   starts_at:   ISO timestamp built from appointment_date +
 *                appointment_time, EDT-anchored for Phase 1
 *   services:    flat array of {display_name, kind, starting_price_cents?, notes?}
 *   reminders:   string[] — dropoff cutoff + state-inspection paperwork
 *
 * hold_id / hold_expires_at are passed in from the caller (the hold
 * Server Action result) so the countdown timer + confirm-side hold ID
 * are wired up.
 */
async function buildSummaryCardData(args: {
  chatId: string;
  hold_id?: string;
  hold_expires_at?: string;
}): Promise<Record<string, unknown>> {
  const supabase = createSupabaseAdminClient();
  const { data: rowRaw } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", args.chatId)
    .maybeSingle();
  const row = rowRaw as Record<string, unknown> | null;

  // Customer name (use verified_* set at Step 5 NewCustomerForm submit).
  const fn = String(row?.verified_first_name ?? "").trim();
  const ln = String(row?.verified_last_name ?? "").trim();
  const customerName = [fn, ln].filter(Boolean).join(" ");

  // Vehicle string.
  const nvi = (row?.new_vehicle_info ?? {}) as Record<string, unknown>;
  const year = nvi.year ? String(nvi.year) : "";
  const make = nvi.make ? String(nvi.make).trim() : "";
  const model = nvi.model ? String(nvi.model).trim() : "";
  const sub = nvi.sub_model ? String(nvi.sub_model).trim() : "";
  const vehicleStr = [year, make, model, sub].filter(Boolean).join(" ");

  // Appointment details.
  const apptType =
    row?.appointment_type === "waiter" ? "waiter" : "dropoff";
  const apptDate = String(row?.appointment_date ?? "");
  const apptTime = String(row?.appointment_time ?? "09:00:00");

  // Compose ISO start time. EDT offset for Phase 1; revisit on DST.
  // For dropoff, time defaults to opening (set 08:00 so SummaryCard.fmtStarts
  // shows the date cleanly even if appointment_time is null).
  const startsAt = apptDate
    ? `${apptDate}T${apptType === "dropoff" ? "08:00:00" : apptTime.slice(0, 8)}-04:00`
    : "";

  // Services list — flatten routine + concerns + approved testing into
  // the {display_name, kind, ...} shape SummaryCard expects.
  const selectedRoutine = Array.isArray(row?.selected_simple_services)
    ? (row?.selected_simple_services as string[])
    : [];
  const explanations = Array.isArray(row?.explanation_required_items)
    ? (row?.explanation_required_items as Array<{
        service_key?: string;
        explanation_text?: string;
      }>)
    : [];
  const approvedTesting = Array.isArray(row?.approved_testing_services)
    ? (row?.approved_testing_services as string[])
    : [];
  const recommendedTesting = Array.isArray(row?.recommended_testing_services)
    ? (row?.recommended_testing_services as Array<{
        service_key: string;
        display_name: string;
        starting_price_cents?: number;
        notes?: string | null;
      }>)
    : [];

  // Look up display names + prices for the routine service keys.
  const services: Array<{
    display_name: string;
    kind: "routine" | "concern" | "testing";
    starting_price_cents?: number;
    notes?: string;
  }> = [];

  if (selectedRoutine.length > 0) {
    const { data: routineRows } = await supabase
      .from("routine_services")
      .select("service_key, display_name")
      .in("service_key", selectedRoutine);
    for (const r of routineRows ?? []) {
      services.push({
        display_name: String(r.display_name),
        kind: "routine",
        starting_price_cents: 0,
      });
    }
  }
  for (const ex of explanations) {
    if (ex?.explanation_text) {
      services.push({
        display_name: `Customer states: "${ex.explanation_text}"`,
        kind: "concern",
        starting_price_cents: 0,
      });
    }
  }
  // Approved testing — use the recommended_testing_services array which
  // has the display_name + starting_price_cents already populated.
  const recByKey = new Map(
    recommendedTesting.map((r) => [r.service_key, r]),
  );
  for (const key of approvedTesting) {
    const rec = recByKey.get(key);
    if (rec) {
      services.push({
        display_name: rec.display_name,
        kind: "testing",
        starting_price_cents:
          typeof rec.starting_price_cents === "number"
            ? rec.starting_price_cents
            : 0,
        notes: rec.notes ?? undefined,
      });
    }
  }

  // Reminders per chat-design.md §5 / §10:
  //   - dropoff: "Please drop off your vehicle before 10 AM on the day..."
  //   - includes state_inspection_emissions: "bring insurance + registration"
  const reminders: string[] = [];
  if (apptType === "dropoff") {
    reminders.push(
      "Please drop off your vehicle before 10 AM on the day of your appointment.",
    );
  }
  if (selectedRoutine.includes("state_inspection_emissions")) {
    reminders.push(
      "Please bring up-to-date copies of your insurance and registration cards.",
    );
  }

  return {
    hold_id: args.hold_id,
    hold_expires_at: args.hold_expires_at,
    starts_at: startsAt,
    customer: customerName,
    vehicle: vehicleStr,
    type: apptType,
    services,
    reminders,
  };
}

export async function submitCustomerNotes(args: {
  chatId: string;
  text: string | null;
  approved: boolean;
}): Promise<SessionActionResult> {
  try {
    // Keyword scan before persisting — same protection as concern_text.
    const hit = scanForEscalationKeywords(args.text);
    if (hit) {
      await logAudit({
        session_id: args.chatId,
        step: "customer_notes",
        event_type: "keyword_escalation",
        event_detail: { keyword: hit.keyword, category: hit.category },
      });
      return submitEscalate({
        chatId: args.chatId,
        reason: `keyword:${hit.category}:${hit.keyword}`,
      });
    }

    await writeSession({
      chatId: args.chatId,
      updates: {
        customer_notes_text: args.text,
        customer_notes_approved: args.approved,
      },
      nextStep: "customer_question",
    });
    await logAudit({
      session_id: args.chatId,
      step: "customer_notes",
      event_type: "card_submitted",
      event_detail: {
        has_text: !!args.text,
        text_length: args.text?.length ?? 0,
        approved: args.approved,
      },
    });
    return {
      ok: true,
      directive: "show_customer_question_card",
      data: {},
      bubble_copy: getBubbleCopy("to_customer_question"),
      current_step: "customer_question",
    };
  } catch (e) {
    return tooErrResult(e, "customer_notes");
  }
}

export async function submitCustomerQuestion(args: {
  chatId: string;
  question: string | null;
}): Promise<SessionActionResult> {
  try {
    // Keyword scan — questions like "I want a refund" should escalate
    // even though they look optional. We still mark the question forwarded
    // (the advisor will see it in the escalation handoff).
    const hit = scanForEscalationKeywords(args.question);
    if (hit) {
      await logAudit({
        session_id: args.chatId,
        step: "customer_question",
        event_type: "keyword_escalation",
        event_detail: { keyword: hit.keyword, category: hit.category },
      });
      return submitEscalate({
        chatId: args.chatId,
        reason: `keyword:${hit.category}:${hit.keyword}`,
      });
    }

    await writeSession({
      chatId: args.chatId,
      updates: {
        customer_question: args.question,
        customer_question_forwarded: !!args.question,
        completed_at: new Date().toISOString(),
        status: "ended",
        outcome: "scheduled",
      },
      nextStep: "completed",
    });
    await logAudit({
      session_id: args.chatId,
      step: "customer_question",
      event_type: "card_submitted",
      event_detail: { has_question: !!args.question },
    });
    // Fire transcript-dispatcher (on-demand per design lock)
    const startedAt = Date.now();
    await consultOrchestrator({
      session_id: args.chatId,
      context: "Session complete — dispatch transcript email.",
      intent_type: "finalize_session",
    }).catch(() => null); // best-effort
    await logAudit({
      session_id: args.chatId,
      step: "completed",
      event_type: "transcript_email_queued",
      latency_ms: Date.now() - startedAt,
    });

    // Read confirmed appointment details for the completed card's recap.
    // Best-effort — if the row read fails the card still renders, just
    // without the friendly date/time recap.
    const supabase = createSupabaseAdminClient();
    const { data: row } = await supabase
      .from("customer_chat_sessions")
      .select(
        "verified_first_name, entered_first_name, appointment_date, appointment_time, appointment_type",
      )
      .eq("id", args.chatId)
      .maybeSingle();

    const firstName =
      (row?.verified_first_name as string | null) ??
      (row?.entered_first_name as string | null) ??
      null;
    const dateStr = row?.appointment_date as string | null | undefined;
    const timeStr = row?.appointment_time as string | null | undefined;
    const apptType = row?.appointment_type as string | null | undefined;

    let appointmentLabel: string | null = null;
    if (dateStr) {
      try {
        const d = new Date(`${dateStr}T${timeStr ?? "12:00"}:00`);
        const dayLabel = d.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        // Hide time for dropoff per chat-design.md §10 (no time on drop-off).
        if (apptType === "waiter" && timeStr) {
          const timeLabel = d.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
          appointmentLabel = `${dayLabel} at ${timeLabel}`;
        } else {
          appointmentLabel = dayLabel;
        }
      } catch {
        appointmentLabel = null;
      }
    }

    return {
      ok: true,
      directive: "show_completed_card",
      data: {
        first_name: firstName,
        appointment_label: appointmentLabel,
        allow_schedule_another: true,
      },
      bubble_copy: getBubbleCopy("session_complete"),
      current_step: "completed",
    };
  } catch (e) {
    return tooErrResult(e, "customer_question");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   Cross-cutting — Start Over + Escalate (footer buttons)
// ═════════════════════════════════════════════════════════════════════════════

export async function submitStartOver(args: {
  chatId: string;
}): Promise<SessionActionResult> {
  try {
    // Reset the session row to greeting state. We keep the row id so the
    // cookie-bound chatId still resolves, but we DELETE every
    // customer_chat_messages row so the next hydrateSession() returns an
    // empty transcript and the client renders the GreetingCard.
    // (Earlier version intentionally left messages in place. That blocked
    // Start Over from actually resetting the UI: hydrateSession loaded the
    // stale dead bubble + card, showClientGreeting bailed because
    // messages.length > 0, and the user was stuck.)
    const supabase = createSupabaseAdminClient();
    const { error: deleteMsgError } = await supabase
      .from("customer_chat_messages")
      .delete()
      .eq("session_id", args.chatId);
    if (deleteMsgError) {
      console.log(
        JSON.stringify({
          level: "warn",
          msg: "submit_start_over_delete_messages_failed",
          chatId: args.chatId,
          error: deleteMsgError.message,
        }),
      );
      // Don't throw — wiping the row is the more important half. Surface
      // via Sentry breadcrumb on the next failure if hydrate is wrong.
    }

    await writeSession({
      chatId: args.chatId,
      updates: {
        // Wipe wizard state
        is_returning_customer: null,
        greeting_answered_at: null,
        entered_first_name: null,
        entered_last_name: null,
        phone_e164: null,
        otp_sent_at: null,
        otp_attempts: 0,
        otp_verified_at: null,
        identity_verification_level: null,
        verified_first_name: null,
        verified_last_name: null,
        edited_phones: null,
        edited_emails: null,
        edited_address: null,
        primary_email_for_description: null,
        new_vehicle_info: null,
        // Identity bindings — clear so a "Start Over" truly starts fresh
        // (otherwise stale customer_id / vehicle_id from a prior session
        // would skip the Step 4 / Step 5 creation flow).
        customer_id: null,
        vehicle_id: null,
        appointment_id: null,
        selected_simple_services: null,
        explanation_required_items: null,
        diagnostic_processing_complete: false,
        clarification_questions_pending: null,
        clarification_questions_answered: null,
        recommended_testing_services: null,
        approved_testing_services: null,
        declined_testing_services: null,
        additional_routine_services_round2: null,
        appointment_type: null,
        appointment_date: null,
        appointment_time: null,
        hold_token: null,
        appointment_confirmed_at: null,
        customer_notes_text: null,
        customer_notes_approved: null,
        customer_notes_edit_attempts: 0,
        customer_question: null,
        customer_question_forwarded: false,
        summary_edit_attempts: 0,
        escalated_at: null,
        escalation_reason: null,
      },
      nextStep: "greeting",
    });
    await logAudit({
      session_id: args.chatId,
      step: "greeting",
      event_type: "session_restarted",
    });
    return {
      ok: true,
      directive: "show_greeting_card",
      data: {},
      bubble_copy: getBubbleCopy("session_restarted"),
      current_step: "greeting",
    };
  } catch (e) {
    return tooErrResult(e, "greeting");
  }
}

export async function submitEscalate(args: {
  chatId: string;
  reason?: string;
}): Promise<SessionActionResult> {
  try {
    // Snapshot the pre-escalation step so back_to_scheduling can restore.
    const supabase = createSupabaseAdminClient();
    const { data: priorRow } = await supabase
      .from("customer_chat_sessions")
      .select("current_step")
      .eq("id", args.chatId)
      .maybeSingle();
    const priorStep = (priorRow?.current_step as string | null) ?? "greeting";

    await writeSession({
      chatId: args.chatId,
      updates: {
        escalated_at: new Date().toISOString(),
        escalation_reason: args.reason ?? "footer_button",
        status: "escalated",
        // Stash the pre-escalation step in the reason JSON so
        // dismissEscalation can restore (no separate column needed).
      },
      nextStep: "escalated",
    });
    await logAudit({
      session_id: args.chatId,
      step: "escalated",
      event_type: "escalation_triggered",
      event_detail: {
        reason: args.reason ?? "footer_button",
        pre_escalation_step: priorStep,
      },
    });
    // Fire transcript on escalation too.
    await consultOrchestrator({
      session_id: args.chatId,
      context: `Session escalated — reason: ${args.reason ?? "footer_button"}. Dispatch transcript.`,
      intent_type: "finalize_session",
    }).catch(() => null);
    return {
      ok: true,
      directive: "show_escalation_card",
      data: {
        reason: args.reason ?? "footer_button",
        shop_phone: "6102536565",
        allow_back_to_scheduling: true,
      },
      bubble_copy: getBubbleCopy("escalate"),
      current_step: "escalated",
    };
  } catch (e) {
    return tooErrResult(e, "escalated");
  }
}

/**
 * "Back to scheduling" — dismiss an active escalation per chat-design.md
 * §A lines 2873-2898. Reverts status to 'active', clears escalated_at +
 * escalation_reason, restores current_step from the most-recent
 * 'escalation_triggered' audit-log event's `pre_escalation_step`. If
 * that lookup fails (e.g., audit log unavailable), falls back to
 * 'greeting' so the customer at least has a working surface.
 */
export async function dismissEscalation(args: {
  chatId: string;
}): Promise<SessionActionResult> {
  try {
    const supabase = createSupabaseAdminClient();

    // Find the pre_escalation_step from the latest escalation_triggered audit.
    const { data: auditRow } = await supabase
      .from("scheduler_audit_log")
      .select("event_detail")
      .eq("session_id", args.chatId)
      .eq("event_type", "escalation_triggered")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const preStep =
      (
        auditRow?.event_detail as
          | { pre_escalation_step?: string }
          | null
          | undefined
      )?.pre_escalation_step ?? "greeting";

    await writeSession({
      chatId: args.chatId,
      updates: {
        escalated_at: null,
        escalation_reason: null,
        status: "active",
      },
      nextStep: preStep as WizardStep,
    });
    await logAudit({
      session_id: args.chatId,
      step: preStep as WizardStep,
      event_type: "escalation_dismissed",
      event_detail: { restored_to_step: preStep },
    });

    return {
      ok: true,
      directive: "continue",
      data: { restored_to_step: preStep },
      bubble_copy: getBubbleCopy("back_to_scheduling"),
      current_step: preStep as WizardStep,
    };
  } catch (e) {
    return tooErrResult(e, "escalated");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//   CLIENT-SIDE CARD INJECTION — persist a synthetic assistant message
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Persist a synthetic assistant message that Chat.tsx generated client-side
 * (via setMessages) to skip the chat-agent LLM round-trip for wizard
 * transitions. Without this, page refresh during a transition loses the
 * card.
 *
 * Called from Chat.tsx's dispatchCardSubmit AFTER addToolResult fires and
 * setMessages appends the next card's tool-call (state='input-available').
 * Best-effort: don't throw — UI doesn't await the result. The audit log
 * + Sentry capture the failure if upsert breaks; customer can still
 * re-derive state from the row on refresh.
 */
export async function saveAssistantCardMessage(args: {
  chatId: string;
  message: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const m = args.message;
    if (typeof m.id !== "string" || typeof m.role !== "string") {
      return { ok: false, error: "message shape missing id|role" };
    }
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("customer_chat_messages").upsert(
      {
        id: m.id,
        session_id: args.chatId,
        shop_id: SHOP_ID_FOR_MESSAGES,
        role: m.role,
        parts: (m.parts ?? []) as unknown,
      },
      { onConflict: "id" },
    );
    if (error) {
      Sentry.captureException(new Error(error.message), {
        tags: {
          surface: "save_assistant_card_message",
        },
        level: "warning",
      });
      return { ok: false, error: error.message };
    }
    // Bump last_active_at so resume / idle-detection sees fresh activity.
    await supabase
      .from("customer_chat_sessions")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", args.chatId);
    return { ok: true };
  } catch (e) {
    Sentry.captureException(e, {
      tags: { surface: "save_assistant_card_message" },
      level: "warning",
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
