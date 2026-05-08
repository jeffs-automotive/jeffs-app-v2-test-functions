// orchestrator-mcp
//
// Custom MCP server hit by Claude Desktop's Custom Connector. Implements the MCP
// JSON-RPC 2.0 protocol over HTTP directly (no SDK) — the surface we need is small:
//   - initialize     handshake; advertise tools capability
//   - tools/list     return our single tool: run_orchestrator
//   - tools/call     dispatch to runOrchestrator(...) and return curated JSON
//   - ping           empty response (good citizen)
//
// Phase 1 architecture:
//   Claude Desktop (Haiku) → MCP run_orchestrator(intent) → THIS FUNCTION
//   → runOrchestrator (Vercel AI SDK + Sonnet 4.5 + tools) → JSON back to Claude Desktop
//   → Haiku formats for the user.
//
// Auth: shared bearer token (MCP_BEARER_TOKEN env var). Each team member configures
// the same token in their Claude Desktop Custom Connector. Phase 2: per-user tokens
// mapped to team_members.tekmetric_employee_id.
//
// References:
//   MCP spec:  https://modelcontextprotocol.io/specification/
//   JSON-RPC:  https://www.jsonrpc.org/specification

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runOrchestrator } from "../_shared/orchestrator.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_BEARER_TOKEN = Deno.env.get("MCP_BEARER_TOKEN");
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);
const DEFAULT_USER_LABEL = Deno.env.get("MCP_DEFAULT_USER_LABEL") ?? "shared-test";

const PROTOCOL_VERSION = "2025-06-18";   // current MCP spec version supported by Claude Desktop
const SERVER_NAME = "jeffs-app-orchestrator";
const SERVER_VERSION = "0.1.0";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── JSON-RPC helpers ────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const RPC_ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

function jsonRpcResponse(body: JsonRpcResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): Response {
  return jsonRpcResponse({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function checkAuth(req: Request): { ok: true } | { ok: false; reason: string } {
  if (!MCP_BEARER_TOKEN) {
    return { ok: false, reason: "Server misconfigured — MCP_BEARER_TOKEN is not set." };
  }
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth) return { ok: false, reason: "Missing Authorization header" };
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "Authorization header is not 'Bearer <token>'" };
  if (m[1].trim() !== MCP_BEARER_TOKEN) return { ok: false, reason: "Invalid bearer token" };
  return { ok: true };
}

// ─── MCP method handlers ─────────────────────────────────────────────────────

function handleInitialize(): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: {},        // we expose tools; no resources/prompts/sampling for now
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  };
}

function handleToolsList(): unknown {
  return {
    tools: [
      {
        name: "run_orchestrator",
        description:
          "Send a free-form intent to Jeff's Automotive's orchestrator agent. The orchestrator decides " +
          "which internal tools (Tekmetric lookups, DB queries, specialist agents) to call and returns a " +
          "structured JSON response with a natural-language answer plus the underlying data. Use this for " +
          "any user question about repair orders, key tags, customers, vehicles, or shop status.",
        inputSchema: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              description: "The user's request, in their own words.",
            },
            params: {
              type: "object",
              description: "Optional structured parameters parsed from the user's message (orchestrator may use or ignore).",
              additionalProperties: true,
            },
            user_label: {
              type: "string",
              description: "Optional team-member label for session/audit grouping. Defaults to 'shared-test' in Phase 1.",
            },
          },
          required: ["intent"],
        },
      },
    ],
  };
}

async function handleToolsCall(params: unknown): Promise<unknown> {
  if (!params || typeof params !== "object") {
    throw new RpcInvalidParams("tools/call: params must be an object with name + arguments");
  }
  const { name, arguments: args } = params as { name?: string; arguments?: Record<string, unknown> };

  if (name !== "run_orchestrator") {
    throw new RpcMethodNotFound(`Unknown tool: ${name}`);
  }
  if (!args || typeof args !== "object") {
    throw new RpcInvalidParams("tools/call: arguments object required");
  }
  const intent = (args as { intent?: unknown }).intent;
  if (typeof intent !== "string" || intent.trim().length === 0) {
    throw new RpcInvalidParams("run_orchestrator: 'intent' (non-empty string) is required");
  }
  const userParams = (args as { params?: Record<string, unknown> }).params;
  const userLabel = ((args as { user_label?: unknown }).user_label as string | undefined) ?? DEFAULT_USER_LABEL;

  const orchestratorResult = await runOrchestrator(sb, SHOP_ID, {
    intent,
    params: userParams,
    user_label: userLabel,
  });

  // MCP `tools/call` responses must have `content: [{type, text|json|...}]`. The model
  // reading this gets the JSON-stringified payload as the tool result text.
  const text = JSON.stringify(orchestratorResult);
  return {
    content: [{ type: "text", text }],
    isError: !orchestratorResult.ok,
  };
}

// ─── Internal RPC error types ────────────────────────────────────────────────
class RpcInvalidParams extends Error {}
class RpcMethodNotFound extends Error {}

// ─── Main entrypoint ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight (Claude Desktop sends OPTIONS in some flows)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-session-id, mcp-protocol-version",
      },
    });
  }

  // Auth gate (applies to POST and GET)
  const auth = checkAuth(req);
  if (!auth.ok) {
    return new Response(
      JSON.stringify({ error: auth.reason }),
      {
        status: 401,
        headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" },
      },
    );
  }

  // Health check via GET (Claude Desktop pings the URL when adding the connector)
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ ok: true, server: SERVER_NAME, version: SERVER_VERSION }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json", "Allow": "POST, GET, OPTIONS" } },
    );
  }

  // Parse JSON-RPC envelope
  let rpcReq: JsonRpcRequest;
  try {
    rpcReq = await req.json();
  } catch {
    return jsonRpcError(null, RPC_ERR.PARSE, "Invalid JSON in request body");
  }
  if (!rpcReq || rpcReq.jsonrpc !== "2.0" || typeof rpcReq.method !== "string") {
    return jsonRpcError(rpcReq?.id ?? null, RPC_ERR.INVALID_REQUEST, "Not a valid JSON-RPC 2.0 request");
  }
  const id = rpcReq.id ?? null;

  // Notification (no id) — just 200 with empty body. Claude Desktop sends
  // `notifications/initialized` after the initialize handshake.
  const isNotification = rpcReq.id === undefined || rpcReq.id === null;

  try {
    switch (rpcReq.method) {
      case "initialize":
        return jsonRpcResponse({ jsonrpc: "2.0", id, result: handleInitialize() });

      case "ping":
        return jsonRpcResponse({ jsonrpc: "2.0", id, result: {} });

      case "tools/list":
        return jsonRpcResponse({ jsonrpc: "2.0", id, result: handleToolsList() });

      case "tools/call": {
        const result = await handleToolsCall(rpcReq.params);
        return jsonRpcResponse({ jsonrpc: "2.0", id, result });
      }

      // Notifications — accept silently
      case "notifications/initialized":
      case "notifications/cancelled":
        if (isNotification) return new Response(null, { status: 202 });
        return jsonRpcResponse({ jsonrpc: "2.0", id, result: {} });

      default:
        return jsonRpcError(id, RPC_ERR.METHOD_NOT_FOUND, `Method not implemented: ${rpcReq.method}`);
    }
  } catch (e) {
    if (e instanceof RpcInvalidParams) return jsonRpcError(id, RPC_ERR.INVALID_PARAMS, e.message);
    if (e instanceof RpcMethodNotFound) return jsonRpcError(id, RPC_ERR.METHOD_NOT_FOUND, e.message);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("orchestrator-mcp internal error:", msg);
    return jsonRpcError(id, RPC_ERR.INTERNAL, "Internal server error", { message: msg });
  }
});
