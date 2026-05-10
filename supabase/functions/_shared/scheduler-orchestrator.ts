// Scheduler orchestrator agent.
//
// Sister of _shared/orchestrator.ts (the keytag orchestrator) but scoped to the
// customer-facing scheduler flow.
//
// Per appointments_design.md §2 (two-LLM architecture) + §7.2 (tool catalog) +
// §11 (logging). The chat-agent-side caller is scheduler-app's
// orchestrator-client.ts which sends:
//
//   POST /functions/v1/orchestrator-direct
//   Body: { session_id, context, hints? }
//
// We:
//   1. Resolve the session (customer_chat_sessions row)
//   2. Open an orchestrator_runs log row
//   3. Run generateText with getSchedulerTools + a system prompt that
//      requires the model to emit a final JSON directive
//   4. Parse the JSON from result.text
//   5. Log tokens + tools_called + close the run row
//   6. Return { directive, data?, flags? }

// AI SDK pinned at v5 per ai_sdk_and_models.md. v6 has open vercel/ai #12020.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateText, stepCountIs } from "npm:ai@^5";
import { anthropic } from "npm:@ai-sdk/anthropic@^2";

import { getSchedulerTools } from "./scheduler-tools.ts";
import { makeToolCallRecorder } from "./orchestrator-tools.ts";

// Default model: Sonnet 4.6 (May 2026). NOT 4.5 (deprecated), NOT 4.7
// (4.7 only exists for Opus). Override via SCHEDULER_ORCHESTRATOR_MODEL env.
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_STEPS = 8;       // higher than the keytag agent (5) — booking flows need more rounds
const MAX_TOKENS = 4096;   // larger than keytag (2048) — directives may include slot maps

export interface SchedulerOrchestratorInput {
  /** Required. UUID of the customer_chat_sessions row this run is scoped to. */
  session_id: string;
  /** Plain-English summary the chat agent built from the conversation. */
  context: string;
  /** Optional structured hints (phone, customer_id, vehicle_id, picked services, etc.). */
  hints?: Record<string, unknown>;
}

export interface SchedulerOrchestratorResult {
  ok: boolean;
  /** What the chat agent should do next. */
  directive: string;
  /** Optional structured data the chat agent surfaces to the customer. */
  data?: Record<string, unknown>;
  /** Optional flags the chat agent branches on. */
  flags?: Record<string, unknown>;
  meta: {
    run_id: string;
    model: string;
    tools_called: string[];
    total_tokens_in: number;
    total_tokens_out: number;
    latency_ms: number;
    steps: number;
  };
  error?: string;
}

const TODAY_HINT = (): string => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};

function buildSystemPrompt(): string {
  return `You are the orchestrator agent for Jeff's Automotive's appointment
scheduler. The chat agent (customer-facing) consults you whenever it needs
data (Tekmetric lookups, slot capacity, OTP, booking writes). You decide
which tool(s) to call, run them, and respond with a STRUCTURED DIRECTIVE
the chat agent will act on.

Today's date is ${TODAY_HINT()}.

# Your job
1. Read the chat agent's \`context\` and \`hints\`.
2. Decide which tool(s) to call. You may call tools in parallel when independent.
3. Compose a structured directive based on the tool results.
4. Respond with EXACTLY one JSON object as your final message — NO prose,
   NO markdown fences, NO explanation. Just the JSON.

# Strict JSON output contract

Your final message MUST be valid JSON parseable by JSON.parse. Shape:

{
  "directive": "<one of the directives below>",
  "data": { ... directive-specific fields ... },
  "flags": { ... optional booleans the chat agent branches on ... }
}

# Directives the chat agent understands

| Directive | When to use | Required \`data\` fields |
|---|---|---|
| \`show_phone_entry\` | Need phone before any other lookup | \`reason\` (string) |
| \`send_otp_first\` | Customer is matched in Tekmetric; need to verify ownership before booking | \`phone_last_four\`, \`ttl_seconds\` |
| \`identity_match_required\` | Reschedule/cancel/full-account-disclosure flow; need name + vehicle confirm | \`customer_candidates\` (array of {customer_id, name_redacted}) |
| \`show_new_customer_form\` | Phone has no Tekmetric hits and customer self-IDs as new (or reconciled to new) | \`mode\` ('full'\\|'vehicle-only') |
| \`show_vehicle_picker\` | Customer matched, need to pick a vehicle | \`vehicles\` (array of {id, label}), \`allow_add_new\` (bool) |
| \`offer_earliest_available\` | Customer + vehicle ready, slots fetched | \`earliest\` ({ waiter?: {date, times}, dropoff?: {date} }), \`available\` (per-date map) |
| \`show_calendar_date_picker\` | Customer wants a different day | \`available_dates\` (array of YYYY-MM-DD), \`type\` ('waiter'\\|'dropoff') |
| \`show_waiter_time_picker\` | Customer picked a date for a waiter | \`date\`, \`available_times\` |
| \`render_confirmation_card\` | Slot held; show summary before final confirm | \`hold_id\`, \`summary\`, \`starts_at\`, \`customer\`, \`vehicle\`, \`type\` |
| \`appointment_booked\` | Tekmetric POST succeeded | \`appointment_id\`, \`starts_at\`, \`type\`, \`reminders\` (array of strings the chat agent must include) |
| \`show_pricing_quote\` | lookup_testing_service_pricing returned a match | \`services\` (array of {display_name, starting_price_cents, notes}) |
| \`pricing_unavailable\` | Pricing lookup returned no match | \`shop_phone\` |
| \`slot_just_taken\` | Race lost — re-fetch and offer fresh options | \`available\`, \`earliest\` |
| \`hold_expired\` | 30-min hold expired before customer confirmed | (none) |
| \`escalate\` | Any §10 trigger fires | \`reason\`, \`shop_phone\` |
| \`tool_error\` | Tekmetric or other tool failed after retry | \`message\` |
| \`continue\` | Generic ack — chat agent continues without UI change | \`message\` (optional) |

# Decision rules (apply in order)

1. **Capacity is server-side.** NEVER invent a slot, time, customer_id, or
   appointment_id. ONLY surface what tools return.
2. **Reconciliation matrix (§4.3) is non-negotiable.** When the chat agent
   sends context implying a customer just submitted phone + self-ID, you MUST:
   - Call \`lookup_customer_by_phone\`
   - Match phone-hits count × self-ID bucket against the matrix
   - Return the right directive (\`send_otp_first\`, \`show_new_customer_form\`,
     \`identity_match_required\`, etc.).
3. **Web channel needs OTP for verify; SMS does not.** The chat agent's
   context will say which channel; default to web semantics if not specified.
4. **Booking ladder:** lookup_customer_by_phone -> verify_otp/identity ->
   lookup_vehicles_for_customer -> list_available_slots ->
   hold_appointment_slot -> render_confirmation_card -> confirm_appointment.
   Don't skip steps.
5. **Build the Tekmetric title yourself** at confirm time:
   '<first> <last> <year> <make> <model> <abbreviation>'. The abbreviation
   comes from routine_services.abbreviation OR testing_services.abbreviation
   for the chosen service. The description is the prose summary the chat
   agent built (or 'Oil Change' / similar for routine).
6. **Reminders for appointment_booked directive:**
   - If type='dropoff': add 'Please drop off your vehicle before 10 AM on the day of your appointment.'
   - If services include state inspection: add 'Please bring up-to-date copies of your insurance and registration cards.'
   - If both apply: include both.
7. **Errors:** if a tool throws (Tekmetric 5xx, network, etc.) AFTER one
   retry, return \`{ directive: 'tool_error', flags: { tekmetric_error: true } }\`.
   The chat agent escalates on this signal.
8. **Slot race:** if hold_appointment_slot throws 'slot_just_taken', call
   list_available_slots again and return \`slot_just_taken\` directive with
   fresh data.

# Forbidden
- Inventing customer info, slot times, appointment IDs.
- Disclosing another customer's data (you have multi-customer query results;
  filter to the matched one).
- Quoting prices for parts/labor/repairs/routine maintenance — only testing
  services from lookup_testing_service_pricing.

Return ONLY the JSON. Final message must be parseable.`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyMeta(model: string) {
  return {
    run_id: "",
    model,
    tools_called: [] as string[],
    total_tokens_in: 0,
    total_tokens_out: 0,
    latency_ms: 0,
    steps: 0,
  };
}

interface ParsedDirective {
  directive: string;
  data?: Record<string, unknown>;
  flags?: Record<string, unknown>;
}

function tryParseDirective(text: string): ParsedDirective | null {
  // Strip whitespace + optional code fences (defensive)
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "directive" in parsed &&
      typeof (parsed as { directive: unknown }).directive === "string"
    ) {
      return parsed as ParsedDirective;
    }
  } catch {
    // fall through
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runSchedulerOrchestrator(
  sb: SupabaseClient,
  shopId: number,
  input: SchedulerOrchestratorInput,
): Promise<SchedulerOrchestratorResult> {
  const startedAt = new Date();
  const model =
    Deno.env.get("SCHEDULER_ORCHESTRATOR_MODEL") || DEFAULT_MODEL;

  // ── 1. Resolve session — make sure the session_id is real before logging ──
  const { data: sessionRow, error: sessionErr } = await sb
    .from("customer_chat_sessions")
    .select("id, channel, customer_id, vehicle_id, customer_self_identified, phone_e164")
    .eq("id", input.session_id)
    .maybeSingle();
  if (sessionErr) {
    return {
      ok: false,
      directive: "tool_error",
      flags: { internal_error: true },
      meta: emptyMeta(model),
      error: `customer_chat_sessions lookup failed: ${sessionErr.message}`,
    };
  }
  if (!sessionRow) {
    return {
      ok: false,
      directive: "tool_error",
      flags: { internal_error: true },
      meta: emptyMeta(model),
      error: `session_not_found: ${input.session_id}`,
    };
  }

  // ── 2. Open orchestrator_runs log row (tied to a chat_sessions row, NOT
  //       customer_chat_sessions — see migration 20260508225430_orchestrator_logging.sql).
  //       The keytag orchestrator uses chat_sessions; for the customer scheduler we
  //       write a synthetic chat_sessions row keyed on the customer session id so
  //       the existing logs schema continues to work.
  const sessionLabel = `scheduler:${input.session_id.slice(0, 8)}`;
  const { data: legacySession } = await sb
    .from("chat_sessions")
    .select("id")
    .eq("user_label", sessionLabel)
    .gte(
      "last_active_at",
      new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    )
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
      return {
        ok: false,
        directive: "tool_error",
        flags: { internal_error: true },
        meta: emptyMeta(model),
        error: `chat_sessions insert failed: ${createErr?.message ?? "unknown"}`,
      };
    }
    chatSessionId = created.id as string;
  }

  const { data: runRow, error: runErr } = await sb
    .from("orchestrator_runs")
    .insert({
      session_id: chatSessionId,
      user_intent: input.context,
      user_params: input.hints ?? null,
      model,
      status: "in_progress",
    })
    .select("id")
    .single();
  if (runErr || !runRow) {
    return {
      ok: false,
      directive: "tool_error",
      flags: { internal_error: true },
      meta: emptyMeta(model),
      error: `orchestrator_runs insert failed: ${runErr?.message ?? "unknown"}`,
    };
  }
  const runId = runRow.id as string;

  // ── 3. Run the agent ──
  const recorder = makeToolCallRecorder(sb, runId);
  const tools = getSchedulerTools({
    sb,
    shopId,
    recorder,
    sessionId: input.session_id,
    includeAdminTools: false,
  });

  // Compose the prompt: context + hints
  const promptParts = [`# Context\n${input.context}`];
  if (input.hints && Object.keys(input.hints).length > 0) {
    promptParts.push(`# Hints\n${JSON.stringify(input.hints, null, 2)}`);
  }
  promptParts.push(`# Session metadata\n${JSON.stringify(
    {
      session_id: input.session_id,
      channel: sessionRow.channel,
      customer_id: sessionRow.customer_id,
      vehicle_id: sessionRow.vehicle_id,
      customer_self_identified: sessionRow.customer_self_identified,
      phone_e164: sessionRow.phone_e164,
    },
    null,
    2,
  )}`);

  const agentStartedAt = new Date();
  let result;
  try {
    result = await generateText({
      model: anthropic(model),
      system: buildSystemPrompt(),
      prompt: promptParts.join("\n\n"),
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      maxOutputTokens: MAX_TOKENS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb
      .from("orchestrator_runs")
      .update({
        status: "error",
        error_message: msg,
        ended_at: new Date().toISOString(),
        latency_ms: Date.now() - startedAt.getTime(),
      })
      .eq("id", runId);
    return {
      ok: false,
      directive: "tool_error",
      flags: { internal_error: true },
      meta: { ...emptyMeta(model), run_id: runId, latency_ms: Date.now() - startedAt.getTime() },
      error: msg,
    };
  }
  const agentEndedAt = new Date();

  // ── 4. Aggregate ──
  const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
  const tokensIn = Number(usage.inputTokens ?? 0);
  const tokensOut = Number(usage.outputTokens ?? 0);

  const toolsCalled: string[] = [];
  for (const step of result.steps ?? []) {
    for (const tc of step.toolCalls ?? []) {
      if (!toolsCalled.includes(tc.toolName)) toolsCalled.push(tc.toolName);
    }
  }

  // ── 5. Log agent_calls + close run ──
  await sb.from("agent_calls").insert({
    run_id: runId,
    agent_name: "scheduler-orchestrator",
    model,
    step_number: 1,
    input: {
      context_first_120: input.context.slice(0, 120),
      hints: input.hints ?? null,
    },
    output: { text: result.text, tools_called: toolsCalled, steps: result.steps?.length ?? 0 },
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_cents: null,
    started_at: agentStartedAt.toISOString(),
    ended_at: agentEndedAt.toISOString(),
    latency_ms: agentEndedAt.getTime() - agentStartedAt.getTime(),
  });

  // ── 6. Parse directive ──
  const parsed = tryParseDirective(result.text);
  if (!parsed) {
    const endedAt = new Date();
    await sb
      .from("orchestrator_runs")
      .update({
        status: "complete",
        final_response: { raw_text: result.text, parse_failed: true },
        total_tokens_in: tokensIn,
        total_tokens_out: tokensOut,
        ended_at: endedAt.toISOString(),
        latency_ms: endedAt.getTime() - startedAt.getTime(),
      })
      .eq("id", runId);
    return {
      ok: false,
      directive: "tool_error",
      flags: { directive_parse_failed: true },
      meta: {
        run_id: runId,
        model,
        tools_called: toolsCalled,
        total_tokens_in: tokensIn,
        total_tokens_out: tokensOut,
        latency_ms: endedAt.getTime() - startedAt.getTime(),
        steps: result.steps?.length ?? 0,
      },
      error: `directive_parse_failed: ${result.text.slice(0, 300)}`,
    };
  }

  const endedAt = new Date();
  await sb
    .from("orchestrator_runs")
    .update({
      status: "complete",
      final_response: parsed,
      total_tokens_in: tokensIn,
      total_tokens_out: tokensOut,
      ended_at: endedAt.toISOString(),
      latency_ms: endedAt.getTime() - startedAt.getTime(),
    })
    .eq("id", runId);

  return {
    ok: true,
    directive: parsed.directive,
    data: parsed.data,
    flags: parsed.flags,
    meta: {
      run_id: runId,
      model,
      tools_called: toolsCalled,
      total_tokens_in: tokensIn,
      total_tokens_out: tokensOut,
      latency_ms: endedAt.getTime() - startedAt.getTime(),
      steps: result.steps?.length ?? 0,
    },
  };
}
