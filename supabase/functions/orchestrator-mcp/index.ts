// orchestrator-mcp
//
// Custom MCP server hit by Claude Desktop's Custom Connector. Implements:
//   - the MCP JSON-RPC 2.0 protocol (initialize, tools/list, tools/call,
//     ping) over HTTP per the 2025-06-18 spec
//   - Protected Resource Metadata discovery on
//     GET /.well-known/oauth-protected-resource
//
// Auth: OAuth 2.1 + PKCE with the mcp-auth function as the authorization
// server. Unauthenticated calls return 401 + WWW-Authenticate header
// pointing at our PRM endpoint, kicking off Claude Desktop's discovery /
// DCR / PKCE flow. All MCP calls require a valid Bearer access_token
// issued by mcp-auth and stored hashed in public.oauth_access_tokens.
//
// Tool exposure (2026-05-20 rewrite):
//
// Previously this MCP server exposed a single `run_orchestrator(intent,
// params)` tool — Claude Desktop's chat agent passed a natural-language
// intent string + the orchestrator's Sonnet 4.6 LLM router decided which
// internal tool to call. That introduced two layers of LLM-driven routing
// (chat-agent → run_orchestrator with paraphrased intent → router LLM →
// specialist LLM → tool execute). Each layer was a source of:
//   - non-determinism (model occasionally paraphrased intent wrong, tool
//     args dropped/renamed)
//   - cost (one or two extra Sonnet calls per simple operation)
//   - latency (sequential LLM calls)
//   - debugging cost (failed uploads showed as "the orchestrator said it
//     worked" with nothing in the audit log)
//
// The 2026-05-20 rewrite exposes ~50 SPECIFIC typed tools — one per
// operation the chat agent can perform. Each tool has:
//   - a stable name (the underlying handler's internal name, snake_case
//     or camelCase per existing convention)
//   - a detailed JSON Schema for its inputs (derived from the existing
//     Zod schemas via Zod 4's native z.toJSONSchema)
//   - a description tuned for tool selection
//   - a direct-invocation execute path: no LLM router, no specialist LLM,
//     just validate-args → call the underlying handler → return JSON
//
// `run_orchestrator` is REMOVED. The chat agent now MUST pick a specific
// tool. If a new operation needs to be exposed, add it to scheduler-tools.ts
// or orchestrator-tools.ts and it appears automatically here.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@^4";

import { ENV_NAMES } from "../_shared/tekmetric.ts";
import {
  functionUrl,
  getExpectedMcpResource,
  type ProtectedResourceMetadata,
  sha256Base64Url,
  stripFunctionPrefix,
} from "../_shared/oauth.ts";
import {
  buildMcpToolRegistry,
  schemaToJsonSchema,
  validateToolInput,
  type McpToolDef,
} from "../_shared/mcp-tool-registry.ts";
import { Sentry, withSentryScope } from "../_shared/sentry-edge.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const FUNCTION_NAME = "orchestrator-mcp";
const AUTH_FUNCTION_NAME = "mcp-auth";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

const PROTOCOL_VERSION = "2025-11-25"; // current MCP spec version
const SERVER_NAME = "jeffs-app-orchestrator";
const SERVER_VERSION = "0.3.0"; // bumped on 2026-05-20 tools/list rewrite

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

function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): Response {
  return jsonRpcResponse({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

// ─── Auth: OAuth bearer validation ──────────────────────────────────────────

interface AuthOk {
  ok: true;
  userLabel: string;
  scope: string;
  clientId: string;
}
interface AuthErr {
  ok: false;
  reason: "missing_token" | "invalid_token" | "invalid_audience" | "server_error";
}

async function authenticateRequest(req: Request): Promise<AuthOk | AuthErr> {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return { ok: false, reason: "missing_token" };
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "invalid_token" };

  const token = m[1].trim();
  if (!token) return { ok: false, reason: "invalid_token" };

  const tokenHash = await sha256Base64Url(token);
  const { data, error } = await sb.rpc("oauth_validate_access_token", {
    p_token_hash: tokenHash,
  });
  if (error) {
    console.error("oauth_validate_access_token RPC failed:", error.message);
    return { ok: false, reason: "server_error" };
  }
  // The RPC returns a table; supabase-js gives an array
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.user_label) return { ok: false, reason: "invalid_token" };

  // RFC 8707 + MCP spec 2025-11-25 "Token Handling": the resource server MUST
  // validate the token was issued for it. mcp-auth stores the audience as
  // `resource` (the canonical URL of the MCP server this token is bound to)
  // on the access_token row at issue time. Compare to this server's canonical
  // URL on every call.
  //
  // SEC-6 cutoff applied 2026-05-23 (immediate, vs the original 30-day plan).
  // Tokens issued BEFORE the PLAN-03 Phase 4 migration ran have NULL resource;
  // those are now REJECTED outright per MCP spec 2025-11-25 §"Token Audience
  // Binding and Validation": "MCP servers MUST validate that presented tokens
  // were issued specifically for their use." NULL resource = not bound to any
  // audience = doesn't satisfy that contract.
  //
  // Impact for legitimate users: existing Claude Desktop sessions get a 401
  // on their next request and must re-auth ONCE. The OAuth refresh-token grant
  // already requires a `resource` parameter (Plan 03 Phase 4 `mcp-auth`
  // changes), so the re-auth flow naturally produces a resource-bound token
  // and subsequent requests succeed. No client-code change needed.
  const tokenResource = (row.resource as string | null | undefined) ?? null;
  const expectedResource = getExpectedMcpResource();

  if (tokenResource === null) {
    Sentry.captureMessage("OAuth legacy token (NULL resource) rejected at orchestrator-mcp", {
      level: "warning",
      tags: {
        oauth_event: "legacy_no_resource_rejected",
        client_id: row.client_id as string,
      },
      extra: {
        user_label: row.user_label,
        expected_resource: expectedResource,
        sec6_cutoff_applied: "2026-05-23",
      },
    });
    return { ok: false, reason: "invalid_audience" };
  }
  if (tokenResource !== expectedResource) {
    Sentry.captureMessage("OAuth token audience mismatch at orchestrator-mcp", {
      level: "warning",
      tags: {
        oauth_event: "token_audience_mismatch",
        client_id: row.client_id as string,
      },
      extra: {
        token_resource: tokenResource,
        expected_resource: expectedResource,
      },
    });
    return { ok: false, reason: "invalid_audience" };
  }

  return {
    ok: true,
    userLabel: row.user_label as string,
    scope: row.scope as string,
    clientId: row.client_id as string,
  };
}

/** Build the WWW-Authenticate header that points clients at our PRM endpoint. */
function wwwAuthenticate(error: AuthErr["reason"]): string {
  const prmUrl = `${functionUrl(FUNCTION_NAME)}/.well-known/oauth-protected-resource`;
  // Map our internal reasons to OAuth 2.0 Bearer Token Usage (RFC 6750 §3.1)
  // error codes. `invalid_token` covers missing/expired/wrong-shape tokens
  // AND audience mismatches per OAuth 2.1 §5.2 + MCP spec "Token Handling"
  // (audience-failure tokens MUST receive 401, and the standardised error
  // code for them is `invalid_token` — `invalid_audience` is not a registered
  // RFC 6750 value, so we surface the semantic in error_description instead).
  const errorMap: Record<AuthErr["reason"], { code: string; description: string }> = {
    missing_token:    { code: "invalid_token", description: "Bearer token required" },
    invalid_token:    { code: "invalid_token", description: "Bearer token is invalid or expired" },
    invalid_audience: { code: "invalid_token", description: "Bearer token was not issued for this MCP server (RFC 8707 audience mismatch)" },
    server_error:     { code: "invalid_token", description: "Token validation failed (server error)" },
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

/**
 * tools/list — enumerate the full per-auth-session tool registry as MCP
 * tool definitions. Returns up to ~50 tools. The registry is built once
 * per request (cheap — both getOrchestratorTools and getSchedulerTools
 * are pure factory calls that just instantiate function references).
 *
 * Per MCP spec 2025-06-18: each tool MUST have name + inputSchema.
 * description and outputSchema are optional but we always emit
 * description.
 */
function handleToolsList(userLabel: string, clientId: string): unknown {
  const registry = buildMcpToolRegistry({
    sb,
    shopId: SHOP_ID,
    userLabel,
    oauthClientId: clientId,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_ROLE_KEY,
  });

  const tools = Object.values(registry).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: schemaToJsonSchema(t.inputSchema),
  }));

  // Sort alphabetically for stable diffs across deploys + easier
  // debugging when the registry changes.
  tools.sort((a, b) => a.name.localeCompare(b.name));

  return { tools };
}

class RpcInvalidParams extends Error {}
class RpcMethodNotFound extends Error {}

/**
 * tools/call — validate the requested tool exists in the registry,
 * validate the arguments against its Zod schema, then invoke its
 * execute() directly. No LLM in this path.
 *
 * Errors:
 *   - tool not in registry           → JSON-RPC METHOD_NOT_FOUND
 *   - arguments fail Zod validation  → JSON-RPC INVALID_PARAMS
 *   - execute() throws unexpectedly  → MCP result {isError: true, content}
 *   - execute() returns a "failed"   → MCP result {isError: false, content}
 *     business-logic result            (per MCP spec: isError indicates a
 *     CRASH, not a failed business
 *     operation; the underlying handlers already wrap business failures
 *     in their own {ok:false} envelope which we surface as-is)
 */
async function handleToolsCall(
  params: unknown,
  userLabel: string,
  clientId: string,
): Promise<unknown> {
  if (!params || typeof params !== "object") {
    throw new RpcInvalidParams("tools/call: params must be an object with name + arguments");
  }
  const { name, arguments: rawArgs } = params as {
    name?: string;
    arguments?: unknown;
  };

  if (typeof name !== "string" || name.length === 0) {
    throw new RpcInvalidParams("tools/call: 'name' (non-empty string) is required");
  }

  const registry = buildMcpToolRegistry({
    sb,
    shopId: SHOP_ID,
    userLabel,
    oauthClientId: clientId,
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_ROLE_KEY,
  });

  const tool: McpToolDef | undefined = registry[name];
  if (!tool) {
    throw new RpcMethodNotFound(`Unknown tool: ${name}. tools/list to discover available tools.`);
  }

  // Validate arguments against the tool's Zod schema. Per MCP spec,
  // bad-input errors are returned as JSON-RPC errors (not tool-result
  // errors) because they're protocol-level violations — the client
  // didn't follow the tool's contract.
  let validatedInput: unknown;
  try {
    validatedInput = validateToolInput(tool.inputSchema, rawArgs);
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new RpcInvalidParams(
        `tools/call ${name}: argument validation failed: ${
          e.issues
            .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
            .join("; ")
        }`,
      );
    }
    throw e;
  }

  // Invoke the underlying handler. Crashes (unexpected throws) become
  // {isError: true} MCP results. Business failures (the handler returns
  // an explicit {ok:false} envelope) are passed through with isError:false
  // since the operation itself didn't crash.
  try {
    const result = await tool.execute(validatedInput);
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return {
      content: [{ type: "text", text }],
      isError: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`tools/call ${name} crashed:`, msg);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: `${name} failed: ${msg}`,
            tool: name,
          }),
        },
      ],
      isError: true,
    };
  }
}

// ─── Main entrypoint ─────────────────────────────────────────────────────────

// PLAN-02 Phase 1 — per-request Sentry isolation scope + flush before response.
Deno.serve((req) => withSentryScope(req, "orchestrator-mcp", async () => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const path = stripFunctionPrefix(req, FUNCTION_NAME);

  // PRM discovery — public, no auth required (it's the lookup that tells
  // unauthenticated clients HOW to authenticate).
  if (req.method === "GET" && path === "/.well-known/oauth-protected-resource") {
    return handleProtectedResourceMetadata();
  }

  // Health check via GET (Claude Desktop pings the URL when adding the
  // connector). We respond OK without auth so the dialog can verify the
  // URL is reachable; any actual MCP call still requires a token.
  if (req.method === "GET" && (path === "/" || path === "")) {
    return json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION });
  }

  // Everything else requires auth
  const auth = await authenticateRequest(req);
  if (!auth.ok) return unauthorized(auth.reason);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        "Content-Type": "application/json",
        Allow: "POST, GET, OPTIONS",
      },
    });
  }

  // Parse JSON-RPC envelope
  let rpcReq: JsonRpcRequest;
  try {
    rpcReq = await req.json();
  } catch {
    return jsonRpcError(null, RPC_ERR.PARSE, "Invalid JSON in request body");
  }
  if (!rpcReq || rpcReq.jsonrpc !== "2.0" || typeof rpcReq.method !== "string") {
    return jsonRpcError(
      rpcReq?.id ?? null,
      RPC_ERR.INVALID_REQUEST,
      "Not a valid JSON-RPC 2.0 request",
    );
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
        return jsonRpcResponse({
          jsonrpc: "2.0",
          id,
          result: handleToolsList(auth.userLabel, auth.clientId),
        });

      case "tools/call": {
        const result = await handleToolsCall(rpcReq.params, auth.userLabel, auth.clientId);
        return jsonRpcResponse({ jsonrpc: "2.0", id, result });
      }

      case "notifications/initialized":
      case "notifications/cancelled":
        if (isNotification) return new Response(null, { status: 202 });
        return jsonRpcResponse({ jsonrpc: "2.0", id, result: {} });

      default:
        return jsonRpcError(
          id,
          RPC_ERR.METHOD_NOT_FOUND,
          `Method not implemented: ${rpcReq.method}`,
        );
    }
  } catch (e) {
    if (e instanceof RpcInvalidParams) return jsonRpcError(id, RPC_ERR.INVALID_PARAMS, e.message);
    if (e instanceof RpcMethodNotFound) return jsonRpcError(id, RPC_ERR.METHOD_NOT_FOUND, e.message);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("orchestrator-mcp internal error:", msg);
    return jsonRpcError(id, RPC_ERR.INTERNAL, "Internal server error", { message: msg });
  }
}));
