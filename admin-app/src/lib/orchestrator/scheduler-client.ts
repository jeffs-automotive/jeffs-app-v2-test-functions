/**
 * Typed orchestrator MCP client for the scheduler-admin tool surface.
 *
 * Counterpart to `callKeytagTool` in `./client.ts`. Both share the same
 * underlying JSON-RPC transport (`callOrchestratorRpc`) — only the typed
 * tool map differs. See `./client.ts` for transport details + env
 * validation + host allowlist.
 *
 * Tool wire-names are SNAKE_CASE (different from keytag's camelCase) —
 * the scheduler-admin orchestrator registry in
 * `supabase/functions/_shared/scheduler-tools.ts` registers each tool with
 * its snake_case name (e.g. `upload_subcategory_descriptions_md`,
 * `revert_md_upload`, `list_scheduler_admin_audit_log`).
 *
 * Per plan v0.5 §5 + adapter contract:
 *   - SERVICE_ROLE key lives in server-side env only (this file is
 *     server-only by file location)
 *   - `actor_email` MUST come from `requireAdmin()` session — never from a
 *     form field or client-provided header. Call sites pass session.email
 *     directly.
 */
import { callOrchestratorRpc } from "./client";
import type { SchedulerToolMap, SchedulerToolName } from "@/lib/scheduler/types";

/**
 * Call a single scheduler-admin orchestrator tool by name with typed args.
 * Returns the tool's parsed result.
 *
 * Throws `OrchestratorClientError` (from `./client.ts`) for transport /
 * protocol failures. Tool-level `ok: false` responses (e.g., dry-run
 * needs-confirmation envelopes, drift rejections) are returned to the
 * caller — they're part of the tool's normal return shape.
 *
 * @param toolName - snake_case wire name (typed against SchedulerToolMap)
 * @param args - tool args (typed)
 * @param actorEmail - the authenticated admin's email from requireAdmin()
 *   session — used for the X-Actor-Email header so the edge fn's
 *   audit log captures who-did-what.
 *
 * Timeout: default 30s. Bump via `options.timeoutMs` for slow tools
 * (e.g., `run_appointments_sync` may take 10-30s).
 */
export async function callSchedulerTool<N extends SchedulerToolName>(
  toolName: N,
  args: SchedulerToolMap[N]["args"],
  actorEmail: string,
  options?: { timeoutMs?: number },
): Promise<SchedulerToolMap[N]["result"]> {
  const parsed = await callOrchestratorRpc(toolName, args, actorEmail, options);
  return parsed as SchedulerToolMap[N]["result"];
}
