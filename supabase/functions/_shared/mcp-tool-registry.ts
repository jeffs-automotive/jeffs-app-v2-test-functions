// mcp-tool-registry.ts
//
// Builds a flat MCP-shaped tool registry from the existing AI-SDK tool
// definitions in getOrchestratorTools() (keytag + manual-review tools) +
// getSchedulerTools() (customer-wizard + admin tools). The MCP layer
// (orchestrator-mcp/index.ts) consumes this registry to:
//
//   1. Emit a `tools/list` response with ~50 typed tools instead of a
//      single `run_orchestrator` tool.
//   2. Validate `tools/call` arguments against the tool's Zod schema and
//      invoke the tool's execute() directly — bypassing the orchestrator
//      LLM router. Routing becomes deterministic at the MCP protocol
//      layer; the chat-agent picks the tool by name + JSON Schema.
//
// Why this works without refactoring scheduler-tools.ts / orchestrator-tools.ts:
// per the AI SDK v5 docs, `tool()` "does not have any runtime behavior, but
// it helps TypeScript infer the types" — i.e., it returns the input object
// verbatim. So a tool() result still has `.description`, `.inputSchema`
// (the original Zod schema), and `.execute` accessible at runtime. We just
// access them.
//
// Ref: https://ai-sdk.dev/docs/reference/ai-sdk-core/tool
//
// Naming: we keep the tool names from scheduler-tools.ts / orchestrator-tools.ts
// verbatim (snake_case from scheduler-tools, camelCase from orchestrator-tools).
// All names conform to Anthropic's tool-name regex `^[a-zA-Z0-9_-]{1,64}$`.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@^4";

import {
  getOrchestratorTools,
  type ToolCallRecorder,
} from "./orchestrator-tools.ts";
import { getSchedulerTools } from "./scheduler-tools.ts";

// ─── Public types ───────────────────────────────────────────────────────────

export interface McpToolDef {
  /** snake_case or camelCase identifier. Matches Anthropic's tool-name regex. */
  name: string;
  /** Human-readable description shown in the MCP `tools/list` response. */
  description: string;
  /** Zod schema for the tool's input arguments. Used to:
   *  (a) generate JSON Schema for `tools/list` via z.toJSONSchema(), and
   *  (b) validate incoming arguments on `tools/call` before exec. */
  inputSchema: z.ZodTypeAny;
  /** Direct invocation of the underlying handler. Takes the already-validated
   *  input (post-Zod-parse). Throws on internal errors; the MCP layer
   *  translates throws to {isError:true} responses. */
  execute: (input: unknown) => Promise<unknown>;
}

export interface BuildRegistryArgs {
  sb: SupabaseClient;
  shopId: number;
  /** OAuth-bound user_label for audit attribution on write tools. */
  userLabel: string;
  /** Channel that originated this session → keytag_audit_log.source on write tools.
   *  'admin_app' for the dashboard (SERVICE_ROLE + X-Actor-Email), 'claude_desktop' for
   *  the OAuth/Claude-Desktop branch. */
  source: "admin_app" | "claude_desktop";
  /** OAuth-bound client_id (DCR registration ID) for audit attribution
   *  on admin write tools (scheduler_admin_audit_log). */
  oauthClientId: string;
  /** Required for tools that invoke other Edge Functions (e.g.
   *  run_appointments_sync, runBulkReconcile). */
  supabaseUrl: string;
  serviceRoleKey: string;
}

// ─── No-op recorder ─────────────────────────────────────────────────────────
//
// The MCP path bypasses the orchestrator's LLM router, so there's no
// agent run row to key tool_calls against. The existing recorder design
// is FK-tied to agent_runs.run_id. A no-op recorder lets us reuse the
// existing tool definitions without re-plumbing recording. Per-operation
// audit is preserved by the underlying admin tools' own writes to
// scheduler_admin_audit_log + keytag_audit_log.
//
// Future: introduce a separate `mcp_tool_calls` table keyed by (oauth_client_id,
// user_label, tool_name, started_at) to give Claude-Desktop calls a top-level
// breadcrumb — deferred per the audit-not-MVP decision.

const NOOP_RECORDER: ToolCallRecorder = {
  recordStart: async () => "", // empty toolCallId → recordEnd no-ops below
  recordEnd: async () => {},
};

// ─── Registry builder ───────────────────────────────────────────────────────

/**
 * Build the full MCP tool registry for an authenticated advisor session.
 * Combines:
 *   - getOrchestratorTools() — keytag + manual-review + listWipKeyTags
 *   - getSchedulerTools()    — customer-wizard read tools + admin write tools
 *
 * Returns a flat map keyed by tool name. The order is stable across
 * authenticated sessions for the same shop, so Claude Desktop's tool list
 * is consistent.
 *
 * @throws if the underlying scheduler/orchestrator tool builders refuse
 *         (e.g., missing audit info when admin tools are requested).
 */
export function buildMcpToolRegistry(args: BuildRegistryArgs): Record<string, McpToolDef> {
  const { sb, shopId, userLabel, source, oauthClientId, supabaseUrl, serviceRoleKey } = args;

  // (a) Keytag + listWipKeyTags + manual-review + audit-history tools
  const orchestratorTools = getOrchestratorTools({
    sb,
    shopId,
    recorder: NOOP_RECORDER,
    userLabel,
    source,
    supabaseUrl,
    serviceRoleKey,
  });

  // (b) Customer-wizard reads + booking tools. 2026-07-02 (sub-feature A):
  //     the scheduler ADMIN tools (uploads/exports/revert/audit/ops/patches)
  //     were deleted from getSchedulerTools — the schedulerconfig webforms
  //     call the direct RPCs. includeAdminTools/audit are accepted-but-
  //     ignored legacy params (kept so this call site + keytag flows need
  //     no signature change).
  const schedulerTools = getSchedulerTools({
    sb,
    shopId,
    recorder: NOOP_RECORDER,
    // sessionId is reserved-for-future per-session admin-tag column in
    // scheduler-tools.ts. Generate one per registry build so audit rows
    // could be grouped later if we add the column.
    sessionId: crypto.randomUUID(),
    includeAdminTools: true,
    audit: {
      oauth_client_id: oauthClientId,
      display_name: userLabel,
    },
    supabaseUrl,
    serviceRoleKey,
  });

  const registry: Record<string, McpToolDef> = {};

  // Merge both maps. There is currently NO name collision between
  // orchestrator-tools and scheduler-tools — verified by name list:
  //   orchestrator-tools: listWipKeyTags, whoIsOnTag, assignKeytagToRo,
  //     releaseKeytagFromRo, revertKeytagToAssigned, markKeytagPosted,
  //     runBulkReconcile, lookupManualReview, resolveManualReview,
  //     getKeytagAuditHistory
  //   scheduler-tools: lookup_customer_by_phone, ..., upload_*, export_*,
  //     patch_*, deactivate_*, upsert_*, block_*, find_orphan_customers,
  //     run_appointments_sync, etc.
  // If a collision is ever introduced, the loop below throws.
  for (const [name, t] of [
    ...Object.entries(orchestratorTools),
    ...Object.entries(schedulerTools),
  ]) {
    if (!isValidToolName(name)) {
      throw new Error(
        `mcp-tool-registry: tool name "${name}" does not match Anthropic's tool-name regex ^[a-zA-Z0-9_-]{1,64}$`,
      );
    }
    if (registry[name]) {
      throw new Error(`mcp-tool-registry: duplicate tool name "${name}" across orchestrator-tools and scheduler-tools`);
    }
    const def = extractToolDef(name, t);
    if (def) registry[name] = def;
  }

  return registry;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Anthropic's tool-name regex per docs.claude.com tool-use/define-tools. */
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
function isValidToolName(s: string): boolean {
  return TOOL_NAME_RE.test(s);
}

/**
 * Extract the runtime shape from an AI SDK v5 tool() result. Per AI SDK v5
 * docs, tool() is a TypeScript-only helper that returns the input object
 * verbatim — so `.description`, `.inputSchema`, and `.execute` are all
 * accessible at runtime.
 *
 * Returns null if the tool is missing required fields (defensive — should
 * never happen for tools authored in this codebase).
 */
function extractToolDef(name: string, raw: unknown): McpToolDef | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as {
    description?: unknown;
    inputSchema?: unknown;
    execute?: unknown;
  };

  if (typeof t.description !== "string" || t.description.length === 0) {
    console.warn(`mcp-tool-registry: tool "${name}" missing description; skipping`);
    return null;
  }
  if (!t.inputSchema || typeof t.inputSchema !== "object") {
    console.warn(`mcp-tool-registry: tool "${name}" missing inputSchema; skipping`);
    return null;
  }
  if (typeof t.execute !== "function") {
    console.warn(`mcp-tool-registry: tool "${name}" missing execute; skipping`);
    return null;
  }

  return {
    name,
    description: t.description,
    inputSchema: t.inputSchema as z.ZodTypeAny,
    // AI SDK v5 execute signature is `(input, options) => Promise<output>`.
    // We call it with the validated input + an empty options bag. Options
    // include things like abortSignal, toolCallId, messages — none of
    // which are meaningful in the direct-call MCP path.
    execute: async (input: unknown) => {
      const execFn = t.execute as (input: unknown, options: unknown) => Promise<unknown>;
      return await execFn(input, {});
    },
  };
}

/**
 * Convert a tool's Zod schema to JSON Schema draft-7 for the MCP
 * `tools/list` response. draft-7 is the most widely-supported JSON Schema
 * dialect for tool-use frameworks; Anthropic's tool-use accepts it
 * directly. (Zod 4's z.toJSONSchema defaults to draft-2020-12 which
 * Anthropic also accepts, but draft-7 is the safer interop choice.)
 *
 * Per Zod 4 docs (https://zod.dev/json-schema): native API, no extra dep.
 */
export function schemaToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Cast: Zod's return type is a deep union; the MCP layer only cares
  // that it's a JSON-serializable record.
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  // Strip the top-level $schema key that Zod adds — Anthropic's tool
  // input_schema is implicitly draft-7+ and the $schema URL only adds
  // bytes to the prompt for no model benefit.
  if ("$schema" in js) delete js.$schema;
  return js;
}

/**
 * Validate raw arguments from a tools/call request against a tool's Zod
 * schema. Returns the parsed value on success; throws ZodError on failure.
 * Caller (the MCP layer) translates ZodError → JSON-RPC INVALID_PARAMS.
 */
export function validateToolInput(schema: z.ZodTypeAny, raw: unknown): unknown {
  // Default to {} for tools with empty inputSchema (e.g., listWipKeyTags).
  const input = raw === undefined || raw === null ? {} : raw;
  return schema.parse(input);
}
