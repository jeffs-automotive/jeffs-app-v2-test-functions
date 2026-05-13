// Scheduler specialist.
//
// Owns the appointment-booking + customer-lookup tool catalog and the system
// prompt that returns a STRUCTURED JSON DIRECTIVE the chat agent acts on.
//
// Called by the unified orchestrator (`_shared/orchestrator.ts`):
//   - For caller_context='customer' (orchestrator-direct → scheduler-app)
//   - For caller_context='advisor' (orchestrator-mcp → Claude Desktop) when
//     the router decides this specialist owns the intent (e.g. "book RO 152222
//     for waiter Friday 8am" — advisor proxies a booking on the customer's
//     behalf). Phase 1 advisor scope is limited; most advisor traffic goes to
//     the keytag specialist.
//
// Model: Haiku 4.5 (May 2026 line) — fast, cheap, structured-output-reliable
// when paired with strict-JSON output contract. Override via
// SCHEDULER_SPECIALIST_MODEL env. Note: legacy SCHEDULER_ORCHESTRATOR_MODEL
// env is honored for backwards compat with the deployed function.

// AI SDK pinned at v5 per ai_sdk_and_models.md; @ai-sdk/anthropic@^2.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateText, stepCountIs } from "npm:ai@^5";
import { anthropic } from "npm:@ai-sdk/anthropic@^2";

import {
  getSchedulerTools,
  type SchedulerToolsArgs,
} from "../scheduler-tools.ts";
import type { ToolCallRecorder } from "../orchestrator-tools.ts";
import type { CallerContext } from "../orchestrator-types.ts";

const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_STEPS = 8;       // higher than keytag — booking flows need multi-tool rounds
const MAX_TOKENS = 4096;   // larger than keytag — directives may carry slot maps + summaries

export interface SchedulerSpecialistArgs {
  sb: SupabaseClient;
  shopId: number;
  recorder: ToolCallRecorder;
  /** Caller context — gates admin-tool access. Customer never sees admin tools. */
  callerContext: CallerContext;
  /** Customer-chat-sessions row this run is scoped to (customer path); for advisor
   *  proxy bookings, a synthetic session id allocated by the orchestrator entry. */
  sessionId: string;
  /** Plain-English summary the chat agent built from the conversation. */
  context: string;
  /** Optional structured hints (phone, customer_id, vehicle_id, picked services, …). */
  hints?: Record<string, unknown>;
  /** Optional structured intent hint. When set, the specialist may use it to
   *  short-circuit reconciliation matrix work (e.g. 'verify_and_lookup',
   *  'show_calendar', 'hold_slot', 'confirm_appointment'). Free-form for now;
   *  the system prompt teaches the model how to interpret it. */
  intentType?: string;
  /** Session metadata for the system prompt (read by orchestrator from customer_chat_sessions). */
  sessionMetadata?: Record<string, unknown>;
  /** When true, admin tools are exposed (block/unblock capacity, upsert services,
   *  upload MDs). Set by the unified orchestrator only when callerContext='advisor'. */
  includeAdminTools?: boolean;
  /** Required when includeAdminTools is true; denormalized into audit columns. */
  audit?: SchedulerToolsArgs["audit"];
  /** Threaded to admin tools that hit other Edge Functions (run_appointments_sync). */
  supabaseUrl?: string;
  serviceRoleKey?: string;
}

export interface SchedulerSpecialistResult {
  directive: string;
  data?: Record<string, unknown>;
  flags?: Record<string, unknown>;
  tools_called: string[];
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  steps: number;
  model: string;
  agent_started_at: string;
  agent_ended_at: string;
  /** Raw text the model emitted, even when directive parsing failed (for debugging). */
  raw_text: string;
  /** True iff result.text parsed cleanly into a directive object. */
  parsed_ok: boolean;
}

const TODAY_HINT = (): string => {
  return new Date().toISOString().slice(0, 10);
};

function buildSystemPrompt(): string {
  return `You are the scheduler specialist for Jeff's Automotive's appointment
booking flow. The chat agent (customer-facing) — OR an advisor proxying on a
customer's behalf — consults you whenever it needs scheduling data (Tekmetric
lookups, slot capacity, OTP, booking writes). You decide which tool(s) to call,
run them, and respond with a STRUCTURED DIRECTIVE the chat agent will act on.

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
| \`hold_expired\` | 10-min hold expired before customer confirmed (TTL changed from 30 → 10 min on 2026-05-13) | (none) |
| \`escalate\` | Any §10 trigger fires | \`reason\`, \`shop_phone\` |
| \`tool_error\` | Tekmetric or other tool failed after retry | \`message\` |
| \`continue\` | Generic ack — chat agent continues without UI change | \`message\` (optional) |

# Decision rules (apply in order)

1. **Capacity is server-side.** NEVER invent a slot, time, customer_id, or
   appointment_id. ONLY surface what tools return.
2. **Reconciliation matrix (§4.3) is non-negotiable.** When the chat agent
   sends context implying a customer just submitted phone + self-ID, you MUST:
   - Call \`lookup_customer_by_phone\` first
   - If phone has 0 hits AND customer self-IDs as 'returning', try
     \`lookup_customer_by_name\` with \`max_distance: 2\` (typo-tolerant fuzzy
     fallback — catches "Jefery" → "Jeffrey")
   - Match phone-hits count × self-ID bucket against the matrix
   - Return the right directive (\`send_otp_first\`, \`show_new_customer_form\`,
     \`identity_match_required\`, etc.).
3. **Web channel needs OTP for verify; SMS does not.** The chat agent's
   context will say which channel; default to web semantics if not specified.
4. **Eligibility gate AFTER OTP verify, BEFORE slot listing.** Once a
   returning customer's identity is verified, call
   \`get_appointment_eligibility(customer_id)\`:
   - eligible=false + reason='repeated_no_shows' → emit \`escalate\` directive
     with reason 'repeated_no_shows' and shop_phone for the human handoff
   - eligible=true + warning='recent_no_show_with_pending' → proceed normally
     BUT include the warning in your data field so the chat agent can surface
     a friendly "we see you already have one coming up" reminder
   - eligible=true (no warning) → proceed
   - New customers (no Tekmetric history) trivially pass — skip the check.
5. **Booking ladder:** lookup_customer_by_phone → (optional fuzzy by_name) →
   verify_otp/identity → get_appointment_eligibility →
   lookup_vehicles_for_customer → list_routine_services (for picker chips) →
   get_earliest_available_slots (offer soonest) OR list_available_slots
   (full calendar) → hold_appointment_slot → render_confirmation_card →
   confirm_appointment. Don't skip steps.

   **NEW-customer path at confirm_appointment time:** when
   session_metadata.customer_id is NULL at the confirm step (the customer
   went through NewCustomerForm), you MUST run create_new_customer FIRST
   (with verified_first_name, verified_last_name, edited_phones,
   edited_emails, edited_address from session_metadata) → then
   create_new_vehicle (with the new_vehicle_info JSON from
   session_metadata + the new tekmetric_customer_id) → then
   confirm_appointment. The Server Action's context will spell out this
   chain when needed; respect it. Return the tekmetric_customer_id +
   tekmetric_vehicle_id in result.data so the Server Action can persist
   them onto the row. If create_new_customer or create_new_vehicle fails,
   emit directive 'tool_error' with flags.tekmetric_error=true and a
   data.reason describing which step failed — do NOT silently fall back
   to confirm_appointment with null IDs.
6. **Soonest-available shortcut.** When the customer has just confirmed
   service + vehicle and hasn't named a specific day, use
   \`get_earliest_available_slots\` (cheap, single row of times/dates) before
   reaching for the full \`list_available_slots\` grid. Only call the full
   grid when the customer picks "different day."
7. **Build the Tekmetric title yourself** at confirm time:
   '<first> <last> <year> <make> <model> <abbreviation>'. The abbreviation
   comes from routine_services.abbreviation OR testing_services.abbreviation
   for the chosen service. The description is the prose summary the chat
   agent built (or 'Oil Change' / similar for routine).
8. **Reminders for appointment_booked directive:**
   - If type='dropoff': add 'Please drop off your vehicle before 10 AM on the day of your appointment.'
   - If services include state inspection: add 'Please bring up-to-date copies of your insurance and registration cards.'
   - If both apply: include both.
9. **Errors:** if a tool throws (Tekmetric 5xx, network, etc.) AFTER one
   retry, return \`{ directive: 'tool_error', flags: { tekmetric_error: true } }\`.
   The chat agent escalates on this signal.
10. **Slot race:** if hold_appointment_slot throws 'slot_just_taken', call
    list_available_slots again and return \`slot_just_taken\` directive with
    fresh data.
11. **Hold TTL is 10 minutes** (changed from 30 min on 2026-05-13). hold_expired
    directive fires when a confirm comes in after the TTL has lapsed.
12. **Concern-question catalog.** When the customer's free-form explanation
    classifies into one of the 14 concern categories (noise, vibration,
    pulling, …, other), use \`list_concern_questions(category)\` to fetch the
    pre-seeded clarification questions. Pick 2-4 the customer hasn't already
    answered and return them via the appropriate directive. The full diagnostic
    Q&A specialist (Chunk 4) handles answer-tracking + recommendation; for
    Chunk 3 the scheduler specialist defers to it via intent_type='diagnose_concern'.

# Forbidden
- Inventing customer info, slot times, appointment IDs.
- Disclosing another customer's data (you have multi-customer query results;
  filter to the matched one).
- Quoting prices for parts/labor/repairs/routine maintenance — only testing
  services from lookup_testing_service_pricing.

Return ONLY the JSON. Final message must be parseable.`;
}

interface ParsedDirective {
  directive: string;
  data?: Record<string, unknown>;
  flags?: Record<string, unknown>;
}

function tryParseDirective(text: string): ParsedDirective | null {
  // Strip whitespace + optional code fences (defensive — Haiku occasionally wraps).
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
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

export async function runSchedulerSpecialist(
  args: SchedulerSpecialistArgs,
): Promise<SchedulerSpecialistResult> {
  const model = Deno.env.get("SCHEDULER_SPECIALIST_MODEL") ||
    Deno.env.get("SCHEDULER_ORCHESTRATOR_MODEL") || // legacy env name
    DEFAULT_MODEL;

  const tools = getSchedulerTools({
    sb: args.sb,
    shopId: args.shopId,
    recorder: args.recorder,
    sessionId: args.sessionId,
    includeAdminTools: !!args.includeAdminTools,
    audit: args.audit,
    supabaseUrl: args.supabaseUrl,
    serviceRoleKey: args.serviceRoleKey,
  });

  // Compose the prompt: context + hints + session metadata + optional intent_type hint
  const promptParts: string[] = [`# Context\n${args.context}`];
  if (args.hints && Object.keys(args.hints).length > 0) {
    promptParts.push(`# Hints\n${JSON.stringify(args.hints, null, 2)}`);
  }
  if (args.intentType) {
    promptParts.push(
      `# Intent type hint\nThe chat agent suggests this is a \`${args.intentType}\` step. Use it to short-circuit reconciliation when applicable, but verify with the tools — never trust intent_type alone for write operations.`,
    );
  }
  if (args.sessionMetadata) {
    promptParts.push(
      `# Session metadata\n${JSON.stringify(args.sessionMetadata, null, 2)}`,
    );
  }

  const agentStartedAt = new Date();
  const result = await generateText({
    model: anthropic(model),
    system: buildSystemPrompt(),
    prompt: promptParts.join("\n\n"),
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_TOKENS,
  });
  const agentEndedAt = new Date();

  const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
  const tokensIn = Number(usage.inputTokens ?? 0);
  const tokensOut = Number(usage.outputTokens ?? 0);

  const toolsCalled: string[] = [];
  for (const step of result.steps ?? []) {
    for (const tc of step.toolCalls ?? []) {
      if (!toolsCalled.includes(tc.toolName)) toolsCalled.push(tc.toolName);
    }
  }

  const parsed = tryParseDirective(result.text);

  return {
    directive: parsed?.directive ?? "tool_error",
    data: parsed?.data,
    flags: parsed
      ? parsed.flags
      : { directive_parse_failed: true },
    tools_called: toolsCalled,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    latency_ms: agentEndedAt.getTime() - agentStartedAt.getTime(),
    steps: result.steps?.length ?? 0,
    model,
    agent_started_at: agentStartedAt.toISOString(),
    agent_ended_at: agentEndedAt.toISOString(),
    raw_text: result.text,
    parsed_ok: parsed !== null,
  };
}
