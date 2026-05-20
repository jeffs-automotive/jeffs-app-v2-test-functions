// orchestrator-mcp
//
// Custom MCP server hit by Claude Desktop's Custom Connector. Implements:
//   - the MCP JSON-RPC 2.0 protocol over HTTP (initialize, tools/list,
//     tools/call, ping) on POST/GET /
//   - Protected Resource Metadata discovery on
//     GET /.well-known/oauth-protected-resource
//
// Auth: OAuth 2.1 + PKCE with the mcp-auth function as the authorization server.
// On unauthenticated calls we return 401 + WWW-Authenticate header pointing at
// our PRM endpoint, kicking off Claude Desktop's discovery / DCR / PKCE flow.
// All MCP calls require a valid Bearer access_token issued by mcp-auth and
// stored hashed in public.oauth_access_tokens.
//
// Phase 1 architecture:
//   Claude Desktop (Haiku) → MCP run_orchestrator(intent) → THIS FUNCTION
//   → runOrchestrator (Vercel AI SDK + Sonnet 4.6 + tools) → JSON back to
//   Claude Desktop → Haiku formats for the user.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runOrchestrator } from "../_shared/orchestrator.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";
import {
  functionUrl,
  type ProtectedResourceMetadata,
  sha256Base64Url,
  stripFunctionPrefix,
} from "../_shared/oauth.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const FUNCTION_NAME = "orchestrator-mcp";
const AUTH_FUNCTION_NAME = "mcp-auth";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

const PROTOCOL_VERSION = "2025-11-25";   // current MCP spec version
const SERVER_NAME = "jeffs-app-orchestrator";
const SERVER_VERSION = "0.2.0";

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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, mcp-session-id, mcp-protocol-version",
};

function jsonRpcResponse(body: JsonRpcResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): Response {
  return jsonRpcResponse({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

// ─── Auth: OAuth bearer validation ────────────────────────────────────────

interface AuthOk { ok: true; userLabel: string; scope: string; clientId: string; }
interface AuthErr { ok: false; reason: "missing_token" | "invalid_token" | "server_error"; }

async function authenticateRequest(req: Request): Promise<AuthOk | AuthErr> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return { ok: false, reason: "missing_token" };
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "invalid_token" };

  const token = m[1].trim();
  if (!token) return { ok: false, reason: "invalid_token" };

  const tokenHash = await sha256Base64Url(token);
  const { data, error } = await sb.rpc("oauth_validate_access_token", { p_token_hash: tokenHash });
  if (error) {
    console.error("oauth_validate_access_token RPC failed:", error.message);
    return { ok: false, reason: "server_error" };
  }
  // The RPC returns a table; supabase-js gives an array
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.user_label) return { ok: false, reason: "invalid_token" };

  return {
    ok: true,
    userLabel: row.user_label as string,
    scope: row.scope as string,
    clientId: row.client_id as string,
  };
}

/** Build the WWW-Authenticate header that points clients at our PRM endpoint. */
function wwwAuthenticate(error: "missing_token" | "invalid_token" | "server_error"): string {
  const prmUrl = `${functionUrl(FUNCTION_NAME)}/.well-known/oauth-protected-resource`;
  const errorMap: Record<string, { code: string; description: string }> = {
    missing_token: { code: "invalid_token", description: "Bearer token required" },
    invalid_token: { code: "invalid_token", description: "Bearer token is invalid or expired" },
    server_error:  { code: "invalid_token", description: "Token validation failed (server error)" },
  };
  const e = errorMap[error];
  return `Bearer realm="MCP", error="${e.code}", error_description="${e.description}", resource_metadata="${prmUrl}"`;
}

function unauthorized(reason: AuthErr["reason"]): Response {
  return new Response(JSON.stringify({ error: "unauthorized", reason }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": wwwAuthenticate(reason),
      ...CORS_HEADERS,
    },
  });
}

// ─── Route: GET /.well-known/oauth-protected-resource ───────────────────────

function handleProtectedResourceMetadata(): Response {
  const metadata: ProtectedResourceMetadata = {
    resource: functionUrl(FUNCTION_NAME),
    authorization_servers: [functionUrl(AUTH_FUNCTION_NAME)],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  };
  return json(metadata);
}

// ─── MCP method handlers ─────────────────────────────────────────────────────

function handleInitialize(): unknown {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
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
              description: "Optional structured parameters parsed from the user's message.",
              additionalProperties: true,
            },
          },
          required: ["intent"],
        },
      },
    ],
  };
}

class RpcInvalidParams extends Error {}
class RpcMethodNotFound extends Error {}

async function handleToolsCall(
  params: unknown,
  userLabel: string,
  clientId: string,
): Promise<unknown> {
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

  // user_label comes from the OAuth token's bound identity, NOT from the tool's
  // arguments — the Claude-Desktop-side caller can't override audit trail.
  //
  // caller_context='advisor' opens the full specialist set (keytag + scheduler
  // + diagnostic). The unified orchestrator + router pick the right specialist
  // for the intent. Existing keytag traffic continues to land on the keytag
  // specialist unchanged; new advisor-driven booking / diagnostic intents now
  // route correctly without needing a new MCP tool.
  //
  // include_admin_tools: orchestrator-mcp ONLY accepts advisor traffic
  // (OAuth-authenticated Claude Desktop), so we always expose the scheduler
  // specialist's admin tool registry (upload_*_md, patch_*_fields,
  // deactivate_*, revert_md_upload, run_appointments_sync, etc.). The audit
  // identity comes from the OAuth bearer's clientId + userLabel and is
  // written to scheduler_admin_audit_log on every successful write.
  const orchestratorResult = await runOrchestrator(sb, SHOP_ID, {
    caller_context: "advisor",
    intent,
    params: userParams,
    user_label: userLabel,
    include_admin_tools: true,
    admin_audit: {
      oauth_client_id: clientId,
      display_name: userLabel,
    },
  });

  const text = JSON.stringify(orchestratorResult);
  return {
    content: [{ type: "text", text }],
    isError: !orchestratorResult.ok,
  };
}

// ─── Main entrypoint ─────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const path = stripFunctionPrefix(req, FUNCTION_NAME);

  // PRM discovery — public, no auth required (it's the lookup that tells
  // unauthenticated clients HOW to authenticate).
  if (req.method === "GET" && path === "/.well-known/oauth-protected-resource") {
    return handleProtectedResourceMetadata();
  }

  // Health check via GET (Claude Desktop pings the URL when adding the connector).
  // We respond OK without auth so the dialog can verify the URL is reachable;
  // any actual MCP call still requires a token.
  if (req.method === "GET" && (path === "/" || path === "")) {
    return json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION });
  }

  // Everything else requires auth
  const auth = await authenticateRequest(req);
  if (!auth.ok) return unauthorized(auth.reason);

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
        const result = await handleToolsCall(
          rpcReq.params,
          auth.userLabel,
          auth.clientId,
        );
        return jsonRpcResponse({ jsonrpc: "2.0", id, result });
      }

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
