// Unified orchestrator.
//
// ONE entry point — `runOrchestrator(sb, shopId, input)` — for both:
//   - Claude Desktop advisor path (orchestrator-mcp → caller_context='advisor')
//   - scheduler-app customer path (orchestrator-direct → caller_context='customer')
//
// The architecture (Chunk 2 build-out 2026-05-13):
//
//   orchestrator-mcp           orchestrator-direct
//        │                              │
//        ▼                              ▼
//   runOrchestrator(input with caller_context)
//        │
//        ▼
//   orchestrator-router.ts  ── classify (LLM or intent_type short-circuit) ──┐
//        │                                                                  │
//        ▼                                                                  │
//   ALLOWED_BY_CONTEXT gate (refuses keytag for customer)                    │
//        │                                                                  │
//        ▼                                                                  │
//   specialists/{keytag|scheduler|diagnostic}.ts ─── generateText + tools ───┘
//        │
//        ▼
//   { ok, run_id, answer?, directive?, data?, flags?, meta }
//
// Replaces the old separate _shared/orchestrator.ts (keytag-only) +
// _shared/scheduler-orchestrator.ts (scheduler-only). Per Chris's directive
// 2026-05-13: "I was under the impression we were using one orchestrator. For
// key tags scheduling and future additions..."
//
// Run-row logging: ALL paths log to public.orchestrator_runs + public.agent_calls
// + public.tool_calls. The specialist files return raw agent results; this
// file owns the persistence + meta-shape.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import {
  makeToolCallRecorder,
  type ToolCallRecorder,
} from "./orchestrator-tools.ts";
import {
  type CallerContext,
  DEFAULT_SPECIALIST,
  type OrchestratorResultMeta,
  type SpecialistName,
} from "./orchestrator-types.ts";
import { routeToSpecialist } from "./orchestrator-router.ts";
import {
  runKeytagSpecialist,
  type KeytagSpecialistResult,
} from "./specialists/keytag.ts";
import {
  runSchedulerSpecialist,
  type SchedulerSpecialistResult,
} from "./specialists/scheduler.ts";
import {
  runDiagnosticSpecialist,
  type DiagnosticSpecialistResult,
} from "./specialists/diagnostic.ts";

// ─── Input + result types ────────────────────────────────────────────────────

export interface OrchestratorInput {
  /** Who is calling — gates allowed specialists. REQUIRED. */
  caller_context: CallerContext;

  // ─── Advisor-path fields (caller_context='advisor') ────────────────────────
  /** Free-form intent (advisor's natural-language request via Claude Desktop). */
  intent?: string;
  /** OAuth-bound identity for audit attribution. */
  user_label?: string;
  /** Optional structured params from MCP tools/call arguments. */
  params?: Record<string, unknown>;

  // ─── Customer-path fields (caller_context='customer') ──────────────────────
  /** UUID of the customer_chat_sessions row this run is scoped to. */
  session_id?: string;
  /** Chat agent's plain-English summary of the conversation context. */
  context?: string;
  /** Optional structured hints (phone, customer_id, vehicle_id, picked services, …). */
  hints?: Record<string, unknown>;

  // ─── Routing hints (either caller_context) ─────────────────────────────────
  /** Structured intent hint that short-circuits the router LLM call.
   *  See INTENT_TYPE_TO_SPECIALIST in orchestrator-types.ts. */
  intent_type?: string;
  /** When true, exposes admin tools to the scheduler specialist (block/unblock
   *  capacity, upsert services, upload MDs). Only honored when
   *  caller_context='advisor'. */
  include_admin_tools?: boolean;
  /** Audit info for admin tool calls; required when include_admin_tools=true. */
  admin_audit?: { oauth_client_id: string; display_name: string };
}

export interface OrchestratorResult {
  ok: boolean;
  run_id: string;

  // ─── Specialist-shaped output (at most one is set) ─────────────────────────
  /** Keytag specialist: natural-language answer for Claude Desktop. */
  answer?: string;
  /** Scheduler/diagnostic specialist: structured directive for the chat agent. */
  directive?: string;

  // ─── Common payloads ───────────────────────────────────────────────────────
  /** Specialist-dependent payload. For keytag: array of {tool, output}. For
   *  scheduler/diagnostic: structured data fields. */
  data?: unknown;
  /** Optional flags the caller branches on (tekmetric_error, slot_just_taken, …). */
  flags?: Record<string, unknown>;

  meta: OrchestratorResultMeta;
  error?: string;
}

// ─── Defaults + constants ────────────────────────────────────────────────────

const ADVISOR_SESSION_WINDOW_MIN = 30;
const CUSTOMER_SESSION_WINDOW_MIN = 30;

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function runOrchestrator(
  sb: SupabaseClient,
  shopId: number,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const startedAt = new Date();

  // ── 1. Validate input shape against caller_context ────────────────────────
  const validation = validateInput(input);
  if (!validation.ok) {
    return {
      ok: false,
      run_id: "",
      meta: emptyMeta(),
      error: validation.error,
    };
  }

  // ── 2. Resolve or create the chat session row ─────────────────────────────
  let chatSessionId: string;
  let customerSessionMetadata: Record<string, unknown> | undefined;
  try {
    if (input.caller_context === "advisor") {
      chatSessionId = await getOrCreateAdvisorSession(sb, input.user_label!);
    } else {
      const resolved = await resolveCustomerSession(sb, input.session_id!);
      chatSessionId = resolved.chatSessionId;
      customerSessionMetadata = resolved.metadata;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      run_id: "",
      meta: emptyMeta(),
      error: msg,
    };
  }

  // ── 3. Open the orchestrator_runs row ─────────────────────────────────────
  const userIntent = input.caller_context === "advisor"
    ? input.intent!
    : input.context!;
  const userParams = input.caller_context === "advisor"
    ? input.params ?? null
    : input.hints ?? null;
  const { data: runRow, error: runErr } = await sb
    .from("orchestrator_runs")
    .insert({
      session_id: chatSessionId,
      user_intent: userIntent,
      user_params: userParams,
      // model field is updated after specialist runs (we don't yet know which model)
      model: "pending",
      status: "in_progress",
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return {
      ok: false,
      run_id: "",
      meta: emptyMeta(),
      error: `orchestrator_runs insert failed: ${runErr?.message ?? "unknown"}`,
    };
  }
  const runId = runRow.id as string;
  const recorder = makeToolCallRecorder(sb, runId);

  // ── 4. Route to specialist ────────────────────────────────────────────────
  const routerDecision = await routeToSpecialist({
    callerContext: input.caller_context,
    intentSummary: userIntent,
    intentType: input.intent_type,
  });

  // ── 5. Dispatch ───────────────────────────────────────────────────────────
  let specialistResult: SpecialistDispatch | null = null;
  let dispatchError: string | null = null;
  try {
    specialistResult = await dispatchSpecialist({
      specialist: routerDecision.specialist,
      sb,
      shopId,
      recorder,
      input,
      customerSessionMetadata,
    });
  } catch (e) {
    dispatchError = e instanceof Error ? e.message : String(e);
  }

  // ── 6. Aggregate + log + close run row ────────────────────────────────────
  const endedAt = new Date();
  const latencyMs = endedAt.getTime() - startedAt.getTime();

  if (dispatchError || !specialistResult) {
    await sb
      .from("orchestrator_runs")
      .update({
        status: "error",
        error_message: dispatchError ?? "unknown_dispatch_error",
        ended_at: endedAt.toISOString(),
        latency_ms: latencyMs,
        model: routerDecision.model,
      })
      .eq("id", runId);
    return {
      ok: false,
      run_id: runId,
      meta: {
        specialist: routerDecision.specialist,
        model: routerDecision.model,
        tools_called: [],
        total_tokens_in: 0,
        total_tokens_out: 0,
        latency_ms: latencyMs,
        steps: 0,
        router_invoked: routerDecision.router_invoked,
        router_model: routerDecision.model,
        router_latency_ms: routerDecision.latency_ms,
        router_reason: routerDecision.reasoning,
      },
      error: dispatchError ?? "unknown_dispatch_error",
    };
  }

  // Log agent_calls (one row per specialist run)
  await sb.from("agent_calls").insert({
    run_id: runId,
    agent_name: `specialist:${routerDecision.specialist}`,
    model: specialistResult.value.model,
    step_number: 1,
    input: {
      caller_context: input.caller_context,
      intent_first_120: userIntent.slice(0, 120),
      intent_type: input.intent_type ?? null,
      router_decision: routerDecision.specialist,
      router_reason: routerDecision.reasoning,
    },
    output: {
      // Keytag returns answer; scheduler/diagnostic return directive
      answer: specialistResult.kind === "keytag"
        ? specialistResult.value.answer
        : undefined,
      directive: specialistResult.kind === "keytag"
        ? undefined
        : specialistResult.value.directive,
      tools_called: specialistResult.value.tools_called,
      steps: specialistResult.value.steps,
    },
    tokens_in: specialistResult.value.tokens_in,
    tokens_out: specialistResult.value.tokens_out,
    cost_cents: null,
    started_at: specialistResult.value.agent_started_at,
    ended_at: specialistResult.value.agent_ended_at,
    latency_ms: specialistResult.value.latency_ms,
  });

  // Close the run row
  const finalResponse = specialistResult.kind === "keytag"
    ? {
      answer: specialistResult.value.answer,
      data: specialistResult.value.data,
      tools_called: specialistResult.value.tools_called,
    }
    : {
      directive: specialistResult.value.directive,
      data: specialistResult.value.data,
      flags: specialistResult.value.flags,
      tools_called: specialistResult.value.tools_called,
      parsed_ok: specialistResult.value.parsed_ok,
    };

  await sb
    .from("orchestrator_runs")
    .update({
      status: "complete",
      final_response: finalResponse,
      total_tokens_in: specialistResult.value.tokens_in,
      total_tokens_out: specialistResult.value.tokens_out,
      ended_at: endedAt.toISOString(),
      latency_ms: latencyMs,
      model: specialistResult.value.model,
    })
    .eq("id", runId);

  // ── 7. Return ─────────────────────────────────────────────────────────────
  const meta: OrchestratorResultMeta = {
    specialist: routerDecision.specialist,
    model: specialistResult.value.model,
    tools_called: specialistResult.value.tools_called,
    total_tokens_in: specialistResult.value.tokens_in,
    total_tokens_out: specialistResult.value.tokens_out,
    latency_ms: latencyMs,
    steps: specialistResult.value.steps,
    router_invoked: routerDecision.router_invoked,
    router_model: routerDecision.model,
    router_latency_ms: routerDecision.latency_ms,
    router_reason: routerDecision.reasoning,
  };

  if (specialistResult.kind === "keytag") {
    return {
      ok: true,
      run_id: runId,
      answer: specialistResult.value.answer,
      data: specialistResult.value.data,
      meta,
    };
  }
  // scheduler or diagnostic
  return {
    ok: specialistResult.value.parsed_ok,
    run_id: runId,
    directive: specialistResult.value.directive,
    data: specialistResult.value.data,
    flags: specialistResult.value.flags,
    meta,
    error: specialistResult.value.parsed_ok
      ? undefined
      : `directive_parse_failed: ${specialistResult.value.raw_text.slice(0, 300)}`,
  };
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

interface DispatchArgs {
  specialist: SpecialistName;
  sb: SupabaseClient;
  shopId: number;
  recorder: ToolCallRecorder;
  input: OrchestratorInput;
  customerSessionMetadata?: Record<string, unknown>;
}

type SpecialistDispatch =
  | { kind: "keytag"; value: KeytagSpecialistResult }
  | { kind: "scheduler"; value: SchedulerSpecialistResult }
  | { kind: "diagnostic"; value: DiagnosticSpecialistResult };

async function dispatchSpecialist(
  args: DispatchArgs,
): Promise<SpecialistDispatch> {
  const { specialist, sb, shopId, recorder, input, customerSessionMetadata } = args;

  // Defense in depth — re-check the caller_context gate before dispatch.
  // (Router clamps to a safe default; this is the second line of defense.)
  if (specialist === "keytag" && input.caller_context !== "advisor") {
    throw new Error(
      "keytag specialist not allowed for caller_context='customer' — gate violation",
    );
  }

  if (specialist === "keytag") {
    const result = await runKeytagSpecialist({
      sb,
      shopId,
      recorder,
      intent: input.intent!,
      params: input.params,
      userLabel: input.user_label!,
      supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SUPABASE_SECRET_KEY") ??
        "",
    });
    return { kind: "keytag", value: result };
  }

  if (specialist === "scheduler") {
    // For advisor path the session_id may be absent; allocate a synthetic
    // session id keyed on user_label so logging stays consistent.
    const sessionId = input.session_id ??
      `advisor-synth:${input.user_label ?? "unknown"}`;
    const context = input.caller_context === "advisor"
      ? input.intent!
      : input.context!;
    const result = await runSchedulerSpecialist({
      sb,
      shopId,
      recorder,
      callerContext: input.caller_context,
      sessionId,
      context,
      hints: input.hints ?? input.params,
      intentType: input.intent_type,
      sessionMetadata: customerSessionMetadata,
      includeAdminTools: input.caller_context === "advisor" &&
        !!input.include_admin_tools,
      audit: input.admin_audit,
      // Threaded only for admin-tool paths (run_appointments_sync). Customer
      // path never has admin tools, so these are no-ops there.
      supabaseUrl: Deno.env.get("SUPABASE_URL") ?? undefined,
      serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SUPABASE_SECRET_KEY") ?? undefined,
    });
    return { kind: "scheduler", value: result };
  }

  // diagnostic
  const sessionId = input.session_id ??
    `advisor-synth:${input.user_label ?? "unknown"}`;
  const context = input.caller_context === "advisor"
    ? input.intent!
    : input.context!;
  const result = await runDiagnosticSpecialist({
    sb,
    shopId,
    recorder,
    callerContext: input.caller_context,
    sessionId,
    context,
    hints: input.hints ?? input.params,
    intentType: input.intent_type,
    sessionMetadata: customerSessionMetadata,
  });
  return { kind: "diagnostic", value: result };
}

// ─── Input validation ────────────────────────────────────────────────────────

function validateInput(
  input: OrchestratorInput,
): { ok: true } | { ok: false; error: string } {
  if (input.caller_context === "advisor") {
    if (!input.intent || input.intent.trim().length === 0) {
      return { ok: false, error: "advisor caller_context requires non-empty intent" };
    }
    if (!input.user_label || input.user_label.trim().length === 0) {
      return { ok: false, error: "advisor caller_context requires user_label" };
    }
    return { ok: true };
  }
  if (input.caller_context === "customer") {
    if (!input.session_id || input.session_id.trim().length === 0) {
      return { ok: false, error: "customer caller_context requires session_id" };
    }
    if (!input.context || input.context.trim().length === 0) {
      return { ok: false, error: "customer caller_context requires context" };
    }
    return { ok: true };
  }
  return {
    ok: false,
    error: `invalid caller_context: ${String((input as { caller_context?: unknown }).caller_context)}`,
  };
}

// ─── Session resolution ─────────────────────────────────────────────────────

/**
 * Find or create a chat_sessions row for the advisor. Existing pattern from
 * the legacy _shared/orchestrator.ts — preserved verbatim to keep audit logs
 * continuous across the Chunk 2 refactor.
 */
async function getOrCreateAdvisorSession(
  sb: SupabaseClient,
  userLabel: string,
): Promise<string> {
  const cutoff = new Date(
    Date.now() - ADVISOR_SESSION_WINDOW_MIN * 60 * 1000,
  ).toISOString();
  const { data: existing } = await sb
    .from("chat_sessions")
    .select("id")
    .eq("user_label", userLabel)
    .gte("last_active_at", cutoff)
    .order("last_active_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await sb
      .from("chat_sessions")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.id as string;
  }

  const { data: created, error } = await sb
    .from("chat_sessions")
    .insert({ user_label: userLabel })
    .select("id")
    .single();

  if (error || !created) {
    throw new Error(
      `Failed to create chat_session: ${error?.message ?? "unknown"}`,
    );
  }
  return created.id as string;
}

/**
 * For the customer path:
 *  1. Validate the customer_chat_sessions row exists
 *  2. Find or create a synthetic chat_sessions row (keyed on the customer
 *     session uuid) so orchestrator_runs has a foreign-key target
 *  3. Return the chat_session uuid + a metadata bag the specialist will use
 *
 * Existing pattern from legacy _shared/scheduler-orchestrator.ts — preserved
 * verbatim to keep run-row logging continuous across the Chunk 2 refactor.
 */
async function resolveCustomerSession(
  sb: SupabaseClient,
  customerSessionId: string,
): Promise<{
  chatSessionId: string;
  metadata: Record<string, unknown>;
}> {
  // Per chat-design.md locked architecture decision #1 + the design audit
  // 2026-05-13 finding I-2: the customer_chat_sessions row is the
  // authoritative source of wizard state. The specialist needs to see ALL
  // wizard columns the Server Actions have written, NOT just the legacy 8.
  // Without these, the specialist has to chain extra lookup tools to
  // reconstruct state already on the row (slower, more tokens, can hit the
  // MAX_STEPS=8 ceiling on multi-step flows).
  const { data: sessionRow, error: sessionErr } = await sb
    .from("customer_chat_sessions")
    .select(
      [
        "id",
        "channel",
        "current_step",
        "identity_verification_level",
        // Identity (Step 1-3)
        "is_returning_customer",
        "customer_self_identified",
        "entered_first_name",
        "entered_last_name",
        "phone_e164",
        "verified_first_name",
        "verified_last_name",
        "customer_id",
        "primary_email_for_description",
        "edited_phones",
        "edited_emails",
        "edited_address",
        // Vehicle (Step 6)
        "vehicle_id",
        "new_vehicle_info",
        // Service + concern (Step 7)
        "selected_simple_services",
        "explanation_required_items",
        "clarification_questions_pending",
        "clarification_questions_answered",
        "recommended_testing_services",
        "approved_testing_services",
        "declined_testing_services",
        "diagnostic_processing_complete",
        "additional_routine_services_round2",
        // Appointment (Step 8-10)
        "appointment_type",
        "appointment_date",
        "appointment_time",
        "hold_token",
        "appointment_id",
        "appointment_confirmed_at",
        // Post-confirm (Step 10.2-10.3)
        "customer_notes_text",
        "customer_notes_approved",
        "customer_question",
        "customer_question_forwarded",
        // Counts / status
        "otp_attempts",
        "summary_edit_attempts",
        "customer_notes_edit_attempts",
        "status",
        "outcome",
        "escalated_at",
        "escalation_reason",
        "completed_at",
        "last_active_at",
      ].join(", "),
    )
    .eq("id", customerSessionId)
    .maybeSingle();

  if (sessionErr) {
    throw new Error(
      `customer_chat_sessions lookup failed: ${sessionErr.message}`,
    );
  }
  if (!sessionRow) {
    throw new Error(`session_not_found: ${customerSessionId}`);
  }
  const row = sessionRow as Record<string, unknown>;

  const sessionLabel = `scheduler:${customerSessionId.slice(0, 8)}`;
  const cutoff = new Date(
    Date.now() - CUSTOMER_SESSION_WINDOW_MIN * 60 * 1000,
  ).toISOString();
  const { data: legacySession } = await sb
    .from("chat_sessions")
    .select("id")
    .eq("user_label", sessionLabel)
    .gte("last_active_at", cutoff)
    .order("last_active_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let chatSessionId: string;
  if (legacySession?.id) {
    chatSessionId = legacySession.id as string;
    await sb
      .from("chat_sessions")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", chatSessionId);
  } else {
    const { data: created, error: createErr } = await sb
      .from("chat_sessions")
      .insert({ user_label: sessionLabel })
      .select("id")
      .single();
    if (createErr || !created) {
      throw new Error(
        `chat_sessions insert failed: ${createErr?.message ?? "unknown"}`,
      );
    }
    chatSessionId = created.id as string;
  }

  return {
    chatSessionId,
    metadata: {
      // Identity
      session_id: row.id,
      channel: row.channel,
      current_step: row.current_step,
      identity_verification_level: row.identity_verification_level,
      is_returning_customer: row.is_returning_customer,
      customer_self_identified: row.customer_self_identified,
      entered_first_name: row.entered_first_name,
      entered_last_name: row.entered_last_name,
      phone_e164: row.phone_e164,
      verified_first_name: row.verified_first_name,
      verified_last_name: row.verified_last_name,
      customer_id: row.customer_id,
      primary_email_for_description: row.primary_email_for_description,
      edited_phones: row.edited_phones,
      edited_emails: row.edited_emails,
      edited_address: row.edited_address,
      // Vehicle
      vehicle_id: row.vehicle_id,
      new_vehicle_info: row.new_vehicle_info,
      // Service + concern
      selected_simple_services: row.selected_simple_services,
      explanation_required_items: row.explanation_required_items,
      clarification_questions_pending: row.clarification_questions_pending,
      clarification_questions_answered: row.clarification_questions_answered,
      recommended_testing_services: row.recommended_testing_services,
      approved_testing_services: row.approved_testing_services,
      declined_testing_services: row.declined_testing_services,
      diagnostic_processing_complete: row.diagnostic_processing_complete,
      additional_routine_services_round2: row.additional_routine_services_round2,
      // Appointment
      appointment_type: row.appointment_type,
      appointment_date: row.appointment_date,
      appointment_time: row.appointment_time,
      hold_token: row.hold_token,
      appointment_id: row.appointment_id,
      appointment_confirmed_at: row.appointment_confirmed_at,
      // Post-confirm
      customer_notes_text: row.customer_notes_text,
      customer_notes_approved: row.customer_notes_approved,
      customer_question: row.customer_question,
      customer_question_forwarded: row.customer_question_forwarded,
      // Counts / status
      otp_attempts: row.otp_attempts,
      summary_edit_attempts: row.summary_edit_attempts,
      customer_notes_edit_attempts: row.customer_notes_edit_attempts,
      status: row.status,
      outcome: row.outcome,
      escalated_at: row.escalated_at,
      escalation_reason: row.escalated_at ? row.escalation_reason : null,
      completed_at: row.completed_at,
      last_active_at: row.last_active_at,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyMeta(): OrchestratorResultMeta {
  return {
    specialist: "unknown",
    model: "",
    tools_called: [],
    total_tokens_in: 0,
    total_tokens_out: 0,
    latency_ms: 0,
    steps: 0,
    router_invoked: false,
  };
}

// ─── Backwards-compat re-exports ─────────────────────────────────────────────
// Existing callers of `runSchedulerOrchestrator` from the legacy
// `_shared/scheduler-orchestrator.ts` still need their interface. The Chunk 2
// refactor updates orchestrator-direct/index.ts to call runOrchestrator
// directly with caller_context='customer'. Until that's deployed, the legacy
// file re-exports from here.
//
// (See _shared/scheduler-orchestrator.ts which now just re-exports a thin
// adapter that wraps runOrchestrator.)

export { DEFAULT_SPECIALIST };
