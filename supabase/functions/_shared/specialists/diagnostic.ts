// Diagnostic Q&A specialist — STUB for Chunk 2.
//
// The real diagnostic specialist comes online in Chunk 4 per the Phase 1
// scheduler design (chat-design.md §7.4). It will:
//   - Classify the customer's free-form concern explanation into one of 14
//     categories (noise, vibration, pulling, smell, smoke, leak,
//     warning_light, performance, electrical, hvac, brakes, steering, tires,
//     other)
//   - Pull the matching clarification questions from concern_questions
//   - Decide which sub-questions remain unanswered after the customer's
//     explanation and the chat agent's follow-ups
//   - Recommend testing_services that map to the concern category
//   - Return a structured directive the scheduler agent acts on
//
// Model: gpt-5.4-mini reasoning medium (per chat-design.md model assignment).
// AI SDK + @ai-sdk/openai integration deferred to Chunk 4. For Chunk 2 this
// stub returns a single 'continue' directive with a not_yet_implemented flag
// so the chat agent can fall back to the legacy single-orchestrator path
// while Chunks 3-4 wire up the real tools.
//
// IMPORTANT: this stub MUST be cheap and fast — orchestrator routing accidents
// (intent classified as 'diagnostic' when it should have been 'scheduler')
// would otherwise burn tokens against a useless agent. Stub returns instantly
// without any LLM call.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { ToolCallRecorder } from "../orchestrator-tools.ts";
import type { CallerContext } from "../orchestrator-types.ts";

const STUB_MODEL = "stub-no-llm-call";

export interface DiagnosticSpecialistArgs {
  sb: SupabaseClient;
  shopId: number;
  recorder: ToolCallRecorder;
  callerContext: CallerContext;
  sessionId: string;
  context: string;
  hints?: Record<string, unknown>;
  intentType?: string;
  sessionMetadata?: Record<string, unknown>;
}

export interface DiagnosticSpecialistResult {
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
  raw_text: string;
  parsed_ok: boolean;
}

/**
 * Chunk 2 stub: returns a `continue` directive with `not_yet_implemented: true`.
 * Chunk 4 replaces this with the real generateObject + Zod-schema call against
 * gpt-5.4-mini reasoning medium.
 */
export async function runDiagnosticSpecialist(
  args: DiagnosticSpecialistArgs,
): Promise<DiagnosticSpecialistResult> {
  const startedAt = new Date();
  // Suppress unused-arg warnings while keeping the signature stable for Chunk 4.
  void args.sb;
  void args.shopId;
  void args.recorder;
  void args.context;
  void args.hints;
  void args.intentType;
  void args.sessionMetadata;
  void args.sessionId;

  const endedAt = new Date();
  return {
    directive: "continue",
    data: {
      message:
        "Diagnostic Q&A specialist is not yet implemented (Chunk 4 deliverable). " +
        "Chat agent should fall back to the scheduler-specialist explanation flow " +
        "or escalate if the concern category cannot be inferred from the explanation alone.",
    },
    flags: {
      not_yet_implemented: true,
      stub_specialist: true,
      caller_context: args.callerContext,
    },
    tools_called: [],
    tokens_in: 0,
    tokens_out: 0,
    latency_ms: endedAt.getTime() - startedAt.getTime(),
    steps: 0,
    model: STUB_MODEL,
    agent_started_at: startedAt.toISOString(),
    agent_ended_at: endedAt.toISOString(),
    raw_text: '{"directive":"continue","flags":{"not_yet_implemented":true}}',
    parsed_ok: true,
  };
}
