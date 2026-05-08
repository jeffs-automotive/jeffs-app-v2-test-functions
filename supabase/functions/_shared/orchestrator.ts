// Orchestrator agent.
//
// Receives a user intent (free-form string from Claude Desktop / Haiku),
// runs Vercel AI SDK's generateText with the orchestrator system prompt
// and the registered tool catalog, and returns a structured JSON response
// for Claude Desktop to format.
//
// Pattern: Claude Desktop (cheap chat) → MCP `run_orchestrator` tool
// → this function → smart model w/ tools → JSON back to Claude Desktop
// → Haiku formats it for the user.
//
// Logging: every run writes to public.orchestrator_runs + public.agent_calls
// (the LLM call) + public.tool_calls (each tool invocation, via the recorder).

// AI SDK pinned at v5 — see .claude/memory/ai_sdk_and_models.md for rationale.
// `ai@^5` pairs with `@ai-sdk/anthropic@^2`. Do NOT bump to v6 / v3 until issue
// vercel/ai #12020 (empty input_schema on zod tools w/ Anthropic) closes.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateText, stepCountIs } from "npm:ai@^5";
import { anthropic } from "npm:@ai-sdk/anthropic@^2";

import {
  getOrchestratorTools,
  makeToolCallRecorder,
} from "./orchestrator-tools.ts";

// Default model per Anthropic's current line (May 2026 — verified at
// platform.claude.com/docs/en/about-claude/models/overview). NOT 4.5 (deprecated)
// and NOT 4.7 (4.7 only exists for Opus, not Sonnet).
const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_STEPS = 5;        // hard cap on tool-call rounds — protection against runaway loops
const MAX_TOKENS = 2048;    // hard cap on the orchestrator's output tokens per run

export interface OrchestratorInput {
  intent: string;
  params?: Record<string, unknown>;
  /** Free-form label identifying the team member (Phase 1 — replaces team_member FK). */
  user_label: string;
}

export interface OrchestratorResult {
  ok: boolean;
  run_id: string;
  /** Final natural-language answer the orchestrator wrote. Claude Desktop renders this. */
  answer: string;
  /** Structured tool-result data the orchestrator pulled, for Claude Desktop to optionally format more richly. */
  data: unknown[];
  meta: {
    model: string;
    tools_called: string[];
    total_tokens_in: number;
    total_tokens_out: number;
    latency_ms: number;
    steps: number;
  };
  error?: string;
}

const SYSTEM_PROMPT = `You are the orchestrator agent for Jeff's Automotive's chat assistant.

Your job:
1. Receive a user intent (a question or request, in free-form language).
2. Decide which tool(s) — if any — to call to answer it.
3. Call them. You may call tools in parallel when independent.
4. Compose a concise, factual answer from the tool results.
5. Return a clear, natural-language answer that Claude Desktop's chat agent will deliver to the user verbatim.

Decision rules (apply in order):
- If you can answer directly without a tool, do not call one. Token-efficient is the goal.
- For "who/what/which is on key tag N" / "what RO has tag N" / "which car has tag N" — call findRoByKeyTag.
- For "list all active key tags" / "what's in the shop" / "show me WIP" — call listWipKeyTags.
- Never invent data. If a tool returns found:false, say so plainly.
- When a tool returns an ro_url, include it in your answer as a markdown link so the user can click through.
- Never disclose internal IDs (ro_id, customer_id, vehicle_id) in the user-facing answer unless the user asks. The RO NUMBER (ro_number) is what the user identifies repair orders by.
- Multi-tenant: the shop scope is server-side. Never trust shop_id values from the user; never ask for them.

Output: a short, factual answer. Markdown is fine (links, lists). Do NOT wrap your answer in code fences.`;

export async function runOrchestrator(
  sb: SupabaseClient,
  shopId: number,
  input: OrchestratorInput,
): Promise<OrchestratorResult> {
  const startedAt = new Date();
  const model = Deno.env.get("ORCHESTRATOR_MODEL") || DEFAULT_MODEL;

  // ── 1. Find or create the chat session for this user_label (last 30 min counts as same session) ──
  const sessionId = await getOrCreateSession(sb, input.user_label);

  // ── 2. Open the orchestrator_run row ──
  const { data: runRow, error: runErr } = await sb
    .from("orchestrator_runs")
    .insert({
      session_id: sessionId,
      user_intent: input.intent,
      user_params: input.params ?? null,
      model,
      status: "in_progress",
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return {
      ok: false,
      run_id: "",
      answer: "",
      data: [],
      meta: emptyMeta(model),
      error: `failed to open orchestrator_runs row: ${runErr?.message ?? "unknown"}`,
    };
  }
  const runId = runRow.id as string;

  // ── 3. Run the agent ──
  const recorder = makeToolCallRecorder(sb, runId);
  const tools = getOrchestratorTools({ sb, shopId, recorder });

  const agentStartedAt = new Date();
  let result;
  try {
    result = await generateText({
      model: anthropic(model),
      system: SYSTEM_PROMPT,
      prompt: input.intent,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      // Hard caps — protect token spend and prevent runaway agents.
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
      run_id: runId,
      answer: "",
      data: [],
      meta: { ...emptyMeta(model), latency_ms: Date.now() - startedAt.getTime() },
      error: msg,
    };
  }
  const agentEndedAt = new Date();

  // ── 4. Aggregate tool results + token usage ──
  const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
  const tokensIn = Number(usage.inputTokens ?? 0);
  const tokensOut = Number(usage.outputTokens ?? 0);

  const toolsCalled: string[] = [];
  const toolData: unknown[] = [];
  for (const step of result.steps ?? []) {
    for (const tc of step.toolCalls ?? []) {
      if (!toolsCalled.includes(tc.toolName)) toolsCalled.push(tc.toolName);
    }
    for (const tr of step.toolResults ?? []) {
      toolData.push({ tool: tr.toolName, output: tr.output });
    }
  }

  // ── 5. Log the agent_call row ──
  await sb.from("agent_calls").insert({
    run_id: runId,
    agent_name: "orchestrator",
    model,
    step_number: 1,
    input: { system_prompt_first_120: SYSTEM_PROMPT.slice(0, 120), user_intent: input.intent },
    output: { text: result.text, tools_called: toolsCalled, steps: result.steps?.length ?? 0 },
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_cents: null,                 // pricing math left for follow-up; AI SDK doesn't surface cost
    started_at: agentStartedAt.toISOString(),
    ended_at: agentEndedAt.toISOString(),
    latency_ms: agentEndedAt.getTime() - agentStartedAt.getTime(),
  });

  // ── 6. Close the run row ──
  const finalResponse = {
    answer: result.text,
    data: toolData,
    tools_called: toolsCalled,
  };

  const endedAt = new Date();
  await sb
    .from("orchestrator_runs")
    .update({
      status: "complete",
      final_response: finalResponse,
      total_tokens_in: tokensIn,
      total_tokens_out: tokensOut,
      ended_at: endedAt.toISOString(),
      latency_ms: endedAt.getTime() - startedAt.getTime(),
    })
    .eq("id", runId);

  // ── 7. Return ──
  return {
    ok: true,
    run_id: runId,
    answer: result.text,
    data: toolData,
    meta: {
      model,
      tools_called: toolsCalled,
      total_tokens_in: tokensIn,
      total_tokens_out: tokensOut,
      latency_ms: endedAt.getTime() - startedAt.getTime(),
      steps: result.steps?.length ?? 0,
    },
  };
}

// ─── Session helper ──────────────────────────────────────────────────────────
const SESSION_WINDOW_MIN = 30;

async function getOrCreateSession(
  sb: SupabaseClient,
  userLabel: string,
): Promise<string> {
  const cutoff = new Date(Date.now() - SESSION_WINDOW_MIN * 60 * 1000).toISOString();
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
    throw new Error(`Failed to create chat_session: ${error?.message ?? "unknown"}`);
  }
  return created.id as string;
}

function emptyMeta(model: string) {
  return {
    model,
    tools_called: [] as string[],
    total_tokens_in: 0,
    total_tokens_out: 0,
    latency_ms: 0,
    steps: 0,
  };
}
