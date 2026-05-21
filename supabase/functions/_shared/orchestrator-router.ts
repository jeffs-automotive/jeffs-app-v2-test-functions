// Orchestrator router.
//
// Receives a free-form intent (from advisor) OR a context summary (from
// customer) and decides which specialist owns the conversation turn. Uses
// a small structured-output LLM call (Vercel AI SDK's `generateObject` +
// Zod schema) for 100% JSON reliability via CFG.
//
// Phase 1 model: Haiku 4.5 — fast, cheap, structured-output-reliable.
// Future: swap to OpenAI gpt-5.4-nano per chat-design.md model assignment
// once @ai-sdk/openai is added to the function dependencies. The router is
// the hottest path in the orchestrator — model choice optimizes latency.
//
// Inputs:
//   caller_context — 'advisor' | 'customer' (gates allowed specialists)
//   intent_summary — natural-language input the router classifies
//   intent_type    — optional structured hint that SHORT-CIRCUITS the router
//
// Output:
//   { specialist, reasoning, router_invoked, latency_ms, model }
//
// Special cases (NO router LLM call — instant return):
//   1. intent_type is in INTENT_TYPE_TO_SPECIALIST → direct dispatch.
//   2. Customer caller_context + Phase 1 scheduler-app entry → 'scheduler'
//      is the default (router invoked only if intent looks diagnostic).
//   3. ALLOWED_BY_CONTEXT gate violation → fall back to DEFAULT_SPECIALIST.

// AI SDK v5 + Anthropic provider — same pinning as the rest of the codebase.
import { generateObject } from "npm:ai@^5";
import { anthropic } from "npm:@ai-sdk/anthropic@^2";
import { z } from "npm:zod@^4";

import {
  ALLOWED_BY_CONTEXT,
  type CallerContext,
  DEFAULT_SPECIALIST,
  INTENT_TYPE_TO_SPECIALIST,
  type SpecialistName,
} from "./orchestrator-types.ts";

const DEFAULT_ROUTER_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 256;

const RouterDecisionSchema = z.object({
  specialist: z.enum(["keytag", "scheduler", "diagnostic"]).describe(
    "Which specialist should handle this turn. " +
      "keytag = service-advisor key-tag operations (assign/release/audit). " +
      "scheduler = customer or advisor booking flows (lookup/slots/confirm). " +
      "diagnostic = concern Q&A + testing-service recommendation.",
  ),
  reasoning: z.string().max(280).describe(
    "One-sentence justification for the routing choice. " +
      "Used for debugging routing mistakes — keep terse.",
  ),
});

export interface RouterInput {
  callerContext: CallerContext;
  /** Natural-language summary to classify. For advisor path = the raw intent;
   *  for customer path = the chat agent's context summary. */
  intentSummary: string;
  /** Optional structured intent hint that bypasses the LLM call. */
  intentType?: string;
}

export interface RouterDecision {
  specialist: SpecialistName;
  reasoning: string;
  router_invoked: boolean;
  latency_ms: number;
  model: string;
}

function buildRouterSystemPrompt(callerContext: CallerContext): string {
  const allowed = ALLOWED_BY_CONTEXT[callerContext];
  return `You are a routing classifier for Jeff's Automotive's chat assistant.

Your job: given the user's intent, decide which specialist agent should handle
it. Output ONE specialist name + a one-sentence reason.

Caller context: ${callerContext}
Allowed specialists for this caller: ${allowed.join(", ")}

Specialist descriptions:

- **keytag**: Service-advisor key-tag operations on repair orders. Triggers:
  - "put red 5 on RO 152222" / "give RO X a tag" / "assign Red 7"
  - "release Red 5 from RO 152222" / "the keys are off RO 152300"
  - "who has Yellow 45" / "what car is on tag 5" / "tell me about Red 7"
  - "list all active key tags" / "what's in the shop"
  - "mark RO X as A/R" / "un-post RO X" / "revert RO X"
  - "run reconcile" / "refresh the keytag pool"
  - "who released Red 5 yesterday" / "audit history" / "what did mike do"
  - "code ORP-A4B72C" / "I got an email about ARN-X3K9P2" / "code + option"
  - NEVER allowed for caller_context='customer'.

- **scheduler**: Appointment booking + customer lookup + ALL advisor
  administration of the scheduler's predefined-data tables. Triggers:
  - Booking & lookup:
    - "book an appointment for Sarah Johnson" / "schedule a waiter"
    - "what slots do you have Friday" / "earliest available dropoff"
    - "verify customer +16105557777" / "lookup phone for Tekmetric"
    - "hold a 8am slot for John Doe's 2020 Civic"
    - "reschedule appointment 12345" / "cancel appointment 12345"
    - Customer wizard turns: phone entry, OTP, vehicle pick, slot pick, confirm.
  - Advisor administration (caller_context='advisor' ONLY):
    - "upload the updated testing services" / "upload testing-services.md"
    - "upload the updated routine services"
    - "upload the updated subcategory service mappings" / "upload subcategory-service-map.md" / "upload subcategory mapping" / "change which testing service ABS light routes to"
    - "upload the updated brakes concern doc" / "upload brakes guideline"
    - "upload the updated appointment limits" / "upload closed dates"
    - "dry run the testing services upload" / "preview the upload"
    - "apply the testing services upload" / "confirm the upload with token X"
    - "set brake_inspection price to $45" / "change battery test description"
    - "deactivate tpms_testing" / "remove TPMS testing"
    - "add a new testing service for transmission scans"
    - "what's the current price of brake_inspection" / "show testing service Y"
    - "list routine services" / "list concern questions for brakes"
    - "show the brakes guideline prose"
    - "undo the last testing-services upload" / "revert audit log id 42"
    - "block off 2026-07-04" / "block tomorrow morning"
    - "find orphan customers" / "sync appointments from Tekmetric"
    - ANY mention of admin-data words: upload, edit, change price, set price,
      deactivate, revert, snapshot, dry-run, confirm token, audit log,
      block date, closed dates, capacity limits.

- **diagnostic**: A CUSTOMER explaining a free-form vehicle symptom (caller_context
  ='customer'). The diagnostic LLM classifies the symptom into a concern
  category and asks clarifying questions to recommend testing services.
  This is NEVER the right choice for an advisor uploading or editing the
  testing-services catalog — that's scheduler-admin. Triggers:
  - "I hear a noise from the front when braking" (customer narrating a symptom)
  - "my car is pulling to the left"
  - "the AC isn't blowing cold"
  - "the check engine light just came on, what's wrong"

Routing rules:
- If the intent is ambiguous, prefer the safer specialist (read-only / lookup
  before write).
- For advisor caller_context, default to 'keytag' when the intent mentions
  RO numbers + tag colors. Default to 'scheduler' for booking-shaped intents
  AND for ALL admin/data-management intents (uploads, price edits,
  deactivations, reverts, capacity blocks, audit lookups). Advisors do NOT
  use the diagnostic specialist — that's a customer-side flow.
- For customer caller_context, NEVER return 'keytag' — that's advisor-only.
  Customer free-form symptom narration → 'diagnostic'.
- The phrase "testing service" by itself does NOT imply diagnostic. An
  ADVISOR saying "upload testing services" is administering the catalog
  (scheduler); a CUSTOMER saying "what testing service do I need for X" is
  describing a symptom (diagnostic). Use caller_context to disambiguate.
- Return EXACTLY one specialist from the allowed list above. Do not invent
  new specialist names.`;
}

/**
 * Classify a turn and return which specialist should handle it.
 *
 * Three paths:
 *  1. intent_type maps directly → return without LLM call.
 *  2. caller_context gates routing → run LLM router for the allowed set.
 *  3. LLM fails → fall back to DEFAULT_SPECIALIST for caller_context.
 */
export async function routeToSpecialist(
  input: RouterInput,
): Promise<RouterDecision> {
  const startedAt = Date.now();

  // Short-circuit: intent_type direct map (no LLM call)
  if (input.intentType) {
    const mapped = INTENT_TYPE_TO_SPECIALIST[input.intentType];
    if (mapped) {
      const allowed = ALLOWED_BY_CONTEXT[input.callerContext];
      if (allowed.includes(mapped)) {
        return {
          specialist: mapped,
          reasoning:
            `intent_type='${input.intentType}' directly maps to ${mapped}; router LLM skipped`,
          router_invoked: false,
          latency_ms: Date.now() - startedAt,
          model: "direct-map",
        };
      }
      // intent_type maps to a specialist this caller is not allowed to invoke
      // — fall back to default (NEVER silently route to keytag for customer).
      const fallback = DEFAULT_SPECIALIST[input.callerContext];
      return {
        specialist: fallback,
        reasoning:
          `intent_type='${input.intentType}' maps to ${mapped} but caller_context='${input.callerContext}' is not allowed; falling back to ${fallback}`,
        router_invoked: false,
        latency_ms: Date.now() - startedAt,
        model: "direct-map-fallback",
      };
    }
    // Unknown intent_type — fall through to LLM router.
  }

  // LLM-routed classification
  const model = Deno.env.get("ORCHESTRATOR_ROUTER_MODEL") || DEFAULT_ROUTER_MODEL;

  try {
    const result = await generateObject({
      model: anthropic(model),
      system: buildRouterSystemPrompt(input.callerContext),
      prompt: `Intent to classify:\n\n${input.intentSummary}`,
      schema: RouterDecisionSchema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });

    const decision = result.object;
    const allowed = ALLOWED_BY_CONTEXT[input.callerContext];

    if (!allowed.includes(decision.specialist)) {
      // Router returned a specialist this caller can't invoke — clamp to default.
      const fallback = DEFAULT_SPECIALIST[input.callerContext];
      return {
        specialist: fallback,
        reasoning:
          `Router picked '${decision.specialist}' but caller_context='${input.callerContext}' is not allowed; clamped to ${fallback}. ` +
          `Original reason: ${decision.reasoning}`,
        router_invoked: true,
        latency_ms: Date.now() - startedAt,
        model,
      };
    }

    return {
      specialist: decision.specialist,
      reasoning: decision.reasoning,
      router_invoked: true,
      latency_ms: Date.now() - startedAt,
      model,
    };
  } catch (e) {
    // Router LLM crashed — fall back to default. We MUST NOT throw here;
    // a failed router blocks ALL traffic for that caller_context otherwise.
    const fallback = DEFAULT_SPECIALIST[input.callerContext];
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "warn",
        msg: "orchestrator_router_failed",
        caller_context: input.callerContext,
        fallback,
        error: msg,
      }),
    );
    return {
      specialist: fallback,
      reasoning: `Router LLM failed (${msg.slice(0, 120)}); falling back to ${fallback}`,
      router_invoked: true,
      latency_ms: Date.now() - startedAt,
      model,
    };
  }
}
