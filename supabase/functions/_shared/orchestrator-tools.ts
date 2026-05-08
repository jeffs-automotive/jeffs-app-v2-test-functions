// AI SDK tool registry for the orchestrator.
//
// Wraps each pure tool function from `_shared/tools/` into a Vercel AI SDK
// `tool({ description, inputSchema, execute })` definition. The orchestrator
// passes this map into `generateText({ ..., tools: getOrchestratorTools(...) })`
// and the model picks which to call based on each tool's description.
//
// Tool description guidance (read this when adding new tools):
//   - Be specific about WHEN this tool is the right answer. Vague descriptions
//     cause routing mistakes.
//   - Mention the FUZZY phrasings the user might use. The orchestrator only sees
//     this description when deciding — if a user asks "which car has key tag 5"
//     and the tool description doesn't mention "car", the model may not pick it.
//   - List what the tool RETURNS so the orchestrator knows whether one call
//     suffices or whether it needs a follow-up.
//
// Logging: each tool's execute logs to public.tool_calls before/after via the
// supplied recorder. If the tool throws, the error message is captured.

// AI SDK pinned at v5 — see .claude/memory/ai_sdk_and_models.md.
// v6 has an open bug (vercel/ai #12020) that drops zod input_schema when used
// with the Anthropic provider's tool calls; switch to v6 only when that closes.
// zod must be 4.1.8+ — AI SDK 5+ uses the v2 schema spec.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tool } from "npm:ai@^5";
import { z } from "npm:zod@^4";

import { listWipKeyTags, findRoByKeyTag } from "./tools/repair-orders.ts";

// ─── Tool-call recorder (writes to public.tool_calls) ────────────────────────

export interface ToolCallRecorder {
  recordStart(args: { toolName: string; input: unknown; stepNumber: number }): Promise<string>;
  recordEnd(args: {
    toolCallId: string;
    output?: unknown;
    error?: string;
  }): Promise<void>;
}

export function makeToolCallRecorder(sb: SupabaseClient, runId: string): ToolCallRecorder {
  let stepCounter = 0;
  return {
    async recordStart({ toolName, input }) {
      stepCounter += 1;
      const { data, error } = await sb
        .from("tool_calls")
        .insert({
          run_id: runId,
          tool_name: toolName,
          step_number: stepCounter,
          input,
        })
        .select("id")
        .single();
      if (error) {
        // Logging failure should not block the actual tool call — just warn and proceed.
        console.error("tool_calls insert failed:", error.message);
        return "";
      }
      return data!.id as string;
    },
    async recordEnd({ toolCallId, output, error }) {
      if (!toolCallId) return; // recordStart failed; nothing to update
      const truncatedOutput = truncateForLog(output);
      await sb
        .from("tool_calls")
        .update({
          output: truncatedOutput.value,
          output_truncated: truncatedOutput.truncated,
          ended_at: new Date().toISOString(),
          latency_ms: null,             // computed by trigger or set by caller if needed
          error_message: error ?? null,
        })
        .eq("id", toolCallId);
    },
  };
}

function truncateForLog(value: unknown): { value: unknown; truncated: boolean } {
  if (value === undefined || value === null) return { value, truncated: false };
  const json = JSON.stringify(value);
  const limit = 8 * 1024; // 8 KB
  if (json.length <= limit) return { value, truncated: false };
  return {
    value: { _truncated: true, preview: json.slice(0, limit) },
    truncated: true,
  };
}

// ─── Build the tool map passed to generateText ───────────────────────────────

export function getOrchestratorTools(args: {
  sb: SupabaseClient;
  shopId: number;
  recorder: ToolCallRecorder;
}) {
  const { sb, shopId, recorder } = args;

  return {
    listWipKeyTags: tool({
      description:
        "Returns every repair order currently in WIP (work-in-progress) status that has a key tag assigned. " +
        "Each result has the key tag number, repair-order number (RO #), Tekmetric internal RO id, customer id, " +
        "vehicle id, and a direct link to open the RO in Tekmetric. Use this when the user asks to list all " +
        "active key tags, see who is in the shop right now, count active jobs, or anything that requires the " +
        "full set of currently-assigned tags. The list only contains active WIP orders — posted, paid, or " +
        "deleted ROs are excluded.",
      inputSchema: z.object({}),
      execute: async () => {
        const callId = await recorder.recordStart({
          toolName: "listWipKeyTags",
          input: {},
          stepNumber: 0,
        });
        try {
          const result = await listWipKeyTags(sb, shopId);
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),

    findRoByKeyTag: tool({
      description:
        "Looks up the repair order currently holding a specific key tag number. Use this for ANY user " +
        "question of the form 'who/what/which (vehicle | car | customer | RO | repair order | work order | " +
        "job) is on key tag N' — the answer is always the repair order number, regardless of how the user " +
        "phrased the question. Returns the RO number, RO id, customer id, vehicle id, and a direct Tekmetric " +
        "link. Searches WIP only — if the tag isn't currently on a WIP order, returns found:false (the tag " +
        "may still be physically on a vehicle that's been posted, but the system considers it no longer " +
        "actively assigned). Key tag must be an integer between 1 and 100.",
      inputSchema: z.object({
        key_tag: z.number().int().min(1).max(100).describe(
          "The key tag number the user is asking about. Integer 1-100.",
        ),
      }),
      execute: async ({ key_tag }) => {
        const callId = await recorder.recordStart({
          toolName: "findRoByKeyTag",
          input: { key_tag },
          stepNumber: 0,
        });
        try {
          const result = await findRoByKeyTag(sb, shopId, key_tag);
          await recorder.recordEnd({ toolCallId: callId, output: result });
          return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await recorder.recordEnd({ toolCallId: callId, error: msg });
          throw e;
        }
      },
    }),
  };
}
