// ⚠️  DEPRECATED — Chunk 2 refactor (2026-05-13).
//
// This file used to host the customer-scheduler orchestrator. It has been
// folded into the unified orchestrator at `_shared/orchestrator.ts` per
// Chris's directive: "I was under the impression we were using one
// orchestrator. For key tags scheduling and future additions..."
//
// New callers should use:
//   import { runOrchestrator } from "./orchestrator.ts";
//   runOrchestrator(sb, shopId, {
//     caller_context: "customer",
//     session_id, context, hints, intent_type?,
//   });
//
// This shim re-exports a thin adapter with the OLD interface
// (runSchedulerOrchestrator + SchedulerOrchestratorInput) so any latent
// imports continue to compile. Slated for deletion once all callers migrate.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { runOrchestrator } from "./orchestrator.ts";

export interface SchedulerOrchestratorInput {
  session_id: string;
  context: string;
  hints?: Record<string, unknown>;
}

export interface SchedulerOrchestratorResult {
  ok: boolean;
  directive: string;
  data?: Record<string, unknown>;
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

/**
 * @deprecated Use `runOrchestrator(sb, shopId, { caller_context: 'customer', ... })`
 * from `_shared/orchestrator.ts`. This shim translates the legacy call shape
 * into the unified orchestrator.
 */
export async function runSchedulerOrchestrator(
  sb: SupabaseClient,
  shopId: number,
  input: SchedulerOrchestratorInput,
): Promise<SchedulerOrchestratorResult> {
  const result = await runOrchestrator(sb, shopId, {
    caller_context: "customer",
    session_id: input.session_id,
    context: input.context,
    hints: input.hints,
  });

  // Project the unified result back into the legacy shape. Note: the new
  // OrchestratorResultMeta has more fields (specialist, router_invoked, …)
  // — the legacy shape strips them, which is intentional for backwards-compat.
  return {
    ok: result.ok,
    directive: result.directive ?? "tool_error",
    data: result.data as Record<string, unknown> | undefined,
    flags: result.flags,
    meta: {
      run_id: result.run_id,
      model: result.meta.model,
      tools_called: result.meta.tools_called,
      total_tokens_in: result.meta.total_tokens_in,
      total_tokens_out: result.meta.total_tokens_out,
      latency_ms: result.meta.latency_ms,
      steps: result.meta.steps,
    },
    error: result.error,
  };
}
