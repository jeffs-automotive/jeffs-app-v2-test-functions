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
import {
  consultOrchestrator,
  OrchestratorError,
} from "@/lib/scheduler/orchestrator-client";
import { getBubbleCopy } from "@/lib/scheduler/bubble-templates";
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

    // Invoke orchestrator: do Tekmetric lookup + reconciliation matrix +
    // send OTP. Orchestrator-direct picks the right directive based on
    // (phone hits) × (self-id bucket) per chat-design.md §4.3.
    //
    // NOTE — design audit B-1 (2026-05-13) recommends inlining the
    // Telnyx OTP send + Tekmetric lookup directly in this Server Action
    // (NO LLM hop on Step 2, per locked design §605). That's a Phase 1.5
    // refactor — it requires either duplicating Telnyx env vars to Vercel
    // OR creating a deterministic `scheduler-step2-direct` edge function.
    // For now we strengthen the specialist contract via explicit tool-
    // chain instructions in `context` + structured `hints` so Haiku 4.5
    // doesn't have to infer what to do. Closes edge-audit I-1 partially.
    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context:
        `Customer submitted Step 2 (phone+name). The row already has\n` +
        `entered_first_name + entered_last_name + phone_e164 + self_id_bucket\n` +
        `written by submitPhoneName — see the session_metadata in your\n` +
        `system prompt for the authoritative values. Tool chain:\n` +
        `  1. lookup_customer_by_phone({ phone_e164: <session_metadata.phone_e164> })\n` +
        `  2. Apply §4.3 reconciliation matrix:\n` +
        `       returning + 1 hit  → send_otp → emit 'send_otp_first'\n` +
        `       returning + 0 hits → emit 'identity_match_required'\n` +
        `       new       + 0 hits → emit 'show_new_customer_form'\n` +
        `       new       + N hits → emit 'identity_match_required'\n` +
        `                            (treat as suspicious; escalate)\n` +
        `       unsure    + 1 hit  → send_otp → emit 'send_otp_first'\n` +
        `                            (verify, then disambiguate)\n` +
        `       unsure    + 0 hits → emit 'show_new_customer_form'\n` +
        `       N hits + name match→ send_otp → emit 'send_otp_first'\n` +
        `       N hits + no match  → emit 'identity_match_required'\n` +
        `  3. NEVER emit 'send_otp_first' without first calling send_otp —\n` +
        `     the directive is only valid AFTER the SMS is actually queued.`,
      hints: {
        first_name: args.first_name,
        last_name: args.last_name,
        phone_e164: args.phone_e164,
      },
      intent_type: "verify_and_lookup",
    });
    await logAudit({
      session_id: args.chatId,
      step: "phone_name",
      event_type: "tool_called",
      event_detail: { tool: "consultOrchestrator", intent_type: "verify_and_lookup", directive: result.directive },
      latency_ms: Date.now() - startedAt,
    });

    // Map the orchestrator's directive to a bubble template + step.
    const bubbleKey =
      result.directive === "send_otp_first"
        ? "phone_name_to_otp"
        : result.directive === "show_new_customer_form"
          ? "show_new_customer_form"
          : result.directive === "identity_match_required"
            ? "identity_match_required"
            : undefined;

    return {
      ok: result.directive !== "tool_error",
      directive: result.directive,
      data: result.data,
      flags: result.flags,
      bubble_copy: bubbleKey ? getBubbleCopy(bubbleKey) : undefined,
      current_step: "otp_pending",
    };
  } catch (e) {
    if (e instanceof OrchestratorError) {
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

    // Now request the vehicle list from the orchestrator so the next
    // card (show_vehicle_picker) has fresh Tekmetric vehicles. The
    // orchestrator reads customer_id from the row.
    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context:
        `Customer confirmed their info on Step 5. Tool chain:\n` +
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
//   STEP 5 — New customer info
// ═════════════════════════════════════════════════════════════════════════════

export async function submitNewCustomer(args: {
  chatId: string;
  first_name: string;
  last_name: string;
  email?: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    sub_model?: string;
    vin?: string;
    license_plate?: string;
    state?: string;
  };
}): Promise<SessionActionResult> {
  try {
    await writeSession({
      chatId: args.chatId,
      updates: {
        verified_first_name: args.first_name,
        verified_last_name: args.last_name,
        edited_emails: args.email
          ? [{ email: args.email, primary: true }]
          : null,
        primary_email_for_description: args.email ?? null,
        new_vehicle_info: args.vehicle,
      },
      nextStep: "service_concern_picker",
    });
    await logAudit({
      session_id: args.chatId,
      step: "new_customer_info",
      event_type: "card_submitted",
      event_detail: {
        has_email: !!args.email,
        vehicle_year: args.vehicle.year,
        vehicle_make: args.vehicle.make,
      },
    });

    // Orchestrator will create the customer + vehicle in Tekmetric on confirm.
    return {
      ok: true,
      directive: "show_service_and_concern_picker",
      data: {},
      bubble_copy: getBubbleCopy("to_service_picker"),
      current_step: "service_concern_picker",
    };
  } catch (e) {
    return tooErrResult(e, "new_customer_info");
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

export async function submitNewVehicle(args: {
  chatId: string;
  vehicle: {
    year: number;
    make: string;
    model: string;
    sub_model?: string;
    vin?: string;
    license_plate?: string;
    state?: string;
  };
}): Promise<SessionActionResult> {
  try {
    await writeSession({
      chatId: args.chatId,
      updates: { new_vehicle_info: args.vehicle },
      nextStep: "service_concern_picker",
    });
    await logAudit({
      session_id: args.chatId,
      step: "new_vehicle_form",
      event_type: "card_submitted",
      event_detail: {
        vehicle_year: args.vehicle.year,
        vehicle_make: args.vehicle.make,
      },
    });
    return {
      ok: true,
      directive: "show_service_and_concern_picker",
      data: {},
      bubble_copy: getBubbleCopy("vehicle_added"),
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

    // Ask the orchestrator what's next: another question, propose testing, or move on.
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context: `Customer answered clarification question ${args.question_id} with "${args.answer}". What's next?`,
      hints: { question_id: args.question_id, answer: args.answer },
      intent_type: "diagnose_concern",
    });
    return {
      ok: result.directive !== "tool_error",
      directive: result.directive,
      data: result.data,
      flags: result.flags,
    };
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

    // Ask orchestrator for available dates (per appointment type).
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context: `Customer chose appointment type ${args.appointment_type}. Fetch available dates.`,
      hints: { appointment_type: args.appointment_type },
      intent_type: "fetch_slots",
    });
    return {
      ok: result.directive !== "tool_error",
      directive: result.directive ?? "show_calendar_date_picker",
      data: result.data ?? {},
      flags: result.flags,
      bubble_copy: getBubbleCopy("to_date_pick"),
      current_step: "date_pick",
    };
  } catch (e) {
    return tooErrResult(e, "appointment_type");
  }
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
      .select("appointment_type")
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
      // Ask orchestrator for available times on this date.
      const result = await consultOrchestrator({
        session_id: args.chatId,
        context: `Customer picked date ${args.selected_date} for waiter. Fetch times.`,
        hints: { date: args.selected_date },
        intent_type: "fetch_slots",
      });
      return {
        ok: true,
        directive: result.directive ?? "show_waiter_time_picker",
        data: result.data ?? { date: args.selected_date, available_times: ["08:00", "09:00"] },
        bubble_copy: getBubbleCopy("to_waiter_time_pick", { date: args.selected_date }),
        current_step: "waiter_time_pick",
      };
    }

    // Dropoff — skip time pick and go directly to placing the hold + summary.
    const holdResult = await consultOrchestrator({
      session_id: args.chatId,
      context: `Customer picked dropoff date ${args.selected_date}. Place the hold.`,
      hints: { date: args.selected_date, type: "dropoff" },
      intent_type: "hold_slot",
    });
    return {
      ok: holdResult.directive !== "tool_error",
      directive: holdResult.directive ?? "show_summary_card",
      data: holdResult.data,
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

    // Place the hold.
    const holdResult = await consultOrchestrator({
      session_id: args.chatId,
      context: `Customer picked waiter time ${args.selected_time}. Place the hold.`,
      hints: { time: args.selected_time, type: "waiter" },
      intent_type: "hold_slot",
    });
    return {
      ok: holdResult.directive !== "tool_error",
      directive: holdResult.directive ?? "show_summary_card",
      data: holdResult.data,
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
      if (attempts >= 2) {
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

    // Customer confirmed → invoke orchestrator confirm_appointment.
    const startedAt = Date.now();
    const result = await consultOrchestrator({
      session_id: args.chatId,
      context: `Customer confirmed the summary. Book the appointment.`,
      hints: {},
      intent_type: "confirm_appointment",
    });
    await logAudit({
      session_id: args.chatId,
      step: "summary",
      event_type: "tool_called",
      event_detail: { tool: "confirm_appointment", directive: result.directive },
      latency_ms: Date.now() - startedAt,
    });

    if (result.directive === "appointment_booked") {
      await writeSession({
        chatId: args.chatId,
        updates: { appointment_confirmed_at: new Date().toISOString() },
        nextStep: "customer_notes",
      });
      return {
        ok: true,
        directive: "show_customer_notes_card",
        data: { result_data: result.data },
        bubble_copy: getBubbleCopy("appointment_confirmed", {
          starts_at_friendly: String(
            (result.data?.["starts_at"] as string) ?? "",
          ),
        }),
        current_step: "customer_notes",
      };
    }
    return {
      ok: result.directive !== "tool_error",
      directive: result.directive,
      data: result.data,
      flags: result.flags,
    };
  } catch (e) {
    return tooErrResult(e, "summary");
  }
}

export async function submitCustomerNotes(args: {
  chatId: string;
  text: string | null;
  approved: boolean;
}): Promise<SessionActionResult> {
  try {
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
    // Reset the session row to greeting state. We DON'T delete the row —
    // we wipe the wizard-state fields but keep the id so existing
    // customer_chat_messages aren't orphaned (we want resume to load the
    // refreshed state, not a totally new chatId).
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
    await writeSession({
      chatId: args.chatId,
      updates: {
        escalated_at: new Date().toISOString(),
        escalation_reason: args.reason ?? "footer_button",
        status: "escalated",
      },
      nextStep: "escalated",
    });
    await logAudit({
      session_id: args.chatId,
      step: "escalated",
      event_type: "escalation_triggered",
      event_detail: { reason: args.reason ?? "footer_button" },
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
      data: { reason: args.reason ?? "footer_button", shop_phone: "6102536565" },
      bubble_copy: getBubbleCopy("escalate"),
      current_step: "escalated",
    };
  } catch (e) {
    return tooErrResult(e, "escalated");
  }
}
