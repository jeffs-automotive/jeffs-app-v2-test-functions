// orchestrator
//
// Internal JSON-RPC 2.0 endpoint. Its ONE live caller is admin-app's Server
// Actions (lib/orchestrator/client.ts), which POST `tools/call` to run keytag
// + scheduler write tools server-side.
//
// Auth: SERVICE_ROLE bearer + X-Actor-Email header. The admin-app is a trusted
// server-side Next.js context (gated by Microsoft Entra @jeffsautomotive.com);
// X-Actor-Email carries the authenticated employee for the tools' audit log.
//
// HISTORY: this function also hosted the Claude Desktop Custom-Connector path —
// OAuth 2.1 + PKCE via the mcp-auth authorization server, the oauth_* token
// tables, PRM discovery, and the MCP handshake methods (initialize / tools-list
// / ping / notifications). Claude Desktop was retired 2026-07-02, and that
// entire half was removed 2026-07-23 (mcp-auth deleted, oauth_* tables dropped).
// Only the admin-app SERVICE_ROLE path + the `tools/call` dispatch remain.
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
import { stripFunctionPrefix } from "../_shared/oauth.ts";
import {
  buildMcpToolRegistry,
  validateToolInput,
  type McpToolDef,
} from "../_shared/mcp-tool-registry.ts";
import { Sentry, withSentryScope } from "../_shared/sentry-edge.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const FUNCTION_NAME = "orchestrator";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

const SERVER_NAME = "jeffs-app-orchestrator";
const SERVER_VERSION = "0.5.0"; // 2026-07-23: OAuth/Claude-Desktop half removed; SERVICE_ROLE-only

// ─── Internal-caller auth branch (admin-app) ────────────────────────────────
//
// Added 2026-05-25 for Phase C of the admin-app build. The admin-app is a
// trusted server-side Next.js context (Microsoft Entra OAuth gates @
// jeffsautomotive.com employees in front; Server Actions then call us with
// SERVICE_ROLE bearer + X-Actor-Email header carrying the authenticated
// employee's email).
//
// This is now the ONLY auth path (the Claude Desktop OAuth branch was removed
// 2026-07-23). A bearer that is not the SERVICE_ROLE key is rejected outright.
//
// Security rules — all three must hold for the path to accept:
//   1. Authorization: Bearer <token> where <token> exactly matches the
//      Supabase project's SERVICE_ROLE secret (constant-time compare to
//      mitigate timing-attack leakage; though SERVICE_ROLE is long enough
//      that practical exploitation is hard)
//   2. X-Actor-Email header is present
//   3. Email ends with "@jeffsautomotive.com" (case-insensitive)
//
// If 1 holds but 2 or 3 fail, we REJECT — a leaked SERVICE_ROLE must never be
// accepted without an audit identity. The reject is a separate AuthErr reason
// so the caller can fix their request.
//
// Audit identity: the synthesized AuthOk uses actorEmail (lowercased) as
// userLabel — every keytag/scheduler tool's audit log entry shows
// "chris@jeffsautomotive.com" (etc.) as who-did-what.
const ALLOWED_ADMIN_EMAIL_DOMAIN = "@jeffsautomotive.com";
const ADMIN_APP_CLIENT_ID = "admin-app";
const ADMIN_APP_SCOPE = "mcp";

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
  // X-Actor-Email added 2026-05-25 for the SERVICE_ROLE+actor-email branch
  // used by admin-app Server Actions. Server-to-server fetches don't trigger
  // CORS preflight in the first place, but listing it here documents the
  // accepted header set for any future browser-side caller.
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Actor-Email, mcp-session-id, mcp-protocol-version",
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

// ─── Auth: OAuth bearer validation + internal SERVICE_ROLE branch ──────────

interface AuthOk {
  ok: true;
  userLabel: string;
  scope: string;
  clientId: string;
  /** Channel of this authenticated call → keytag_audit_log.source on write tools.
   *  Always 'admin_app' now — the SERVICE_ROLE + X-Actor-Email dashboard path
   *  is the only surviving auth branch (the OAuth 'claude_desktop' branch was
   *  removed 2026-07-23). Kept as a union for the registry's source contract. */
  source: "admin_app";
}
interface AuthErr {
  ok: false;
  reason:
    | "missing_token"
    | "invalid_token"
    | "missing_actor_email"
    | "invalid_actor_email_domain";
}

/**
 * Constant-time string equality. Mitigates timing-attack leakage on the
 * bearer-vs-SERVICE_ROLE comparison. Returns false if lengths differ.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Return all the valid SERVICE_ROLE / SECRET KEY values the edge runtime
 * knows about. Supabase rolled out new `sb_secret_*` key forms in 2026
 * alongside the legacy JWT-style keys, and which one is populated depends
 * on the project + the caller (Vercel may hold the legacy form while
 * Supabase edge has the new form, or vice versa). Accept both so the
 * admin-app's resolveServiceRoleKey() result will match no matter which
 * shape happens to be in scope.
 *
 * Order: try SUPABASE_SECRET_KEYS (JSON dict — canonical 2026), then
 * SUPABASE_SECRET_KEY (singular transition form), then
 * SUPABASE_SERVICE_ROLE_KEY (legacy). All non-empty values returned.
 */
function getAllowedServiceRoleBearers(): string[] {
  const out = new Set<string>();
  const dictRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (dictRaw) {
    try {
      const parsed = JSON.parse(dictRaw);
      if (Array.isArray(parsed)) {
        for (const v of parsed) {
          if (typeof v === "string" && v.length > 0) out.add(v);
          else if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") {
            out.add((v as { value: string }).value);
          }
        }
      } else if (parsed && typeof parsed === "object") {
        for (const v of Object.values(parsed as Record<string, unknown>)) {
          if (typeof v === "string" && v.length > 0) out.add(v);
          else if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") {
            out.add((v as { value: string }).value);
          }
        }
      }
    } catch {
      // Tolerate malformed JSON — just fall through to the singular forms.
    }
  }
  const singular = Deno.env.get("SUPABASE_SECRET_KEY");
  if (singular && singular.length > 0) out.add(singular);
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy && legacy.length > 0) out.add(legacy);
  return Array.from(out);
}

/**
 * True if the supplied X-Actor-Email value is a syntactically-valid email
 * AND its domain matches the allowed admin tenant.
 *
 * Defense in depth: the admin-app's own requireAdmin() already enforces
 * this same domain check, but we re-verify here so a leaked SERVICE_ROLE
 * can't be used to spoof an arbitrary actor identity (e.g., from a curl
 * script with an attacker-controlled email).
 */
function isAllowedAdminEmail(email: string): boolean {
  // Reject obvious bad shapes
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 320) return false;
  if (!trimmed.includes("@")) return false;
  // Reject embedded newlines / control chars (header injection guard)
  if (/[\r\n\t\0]/.test(trimmed)) return false;
  // Domain match (case-insensitive)
  return trimmed.toLowerCase().endsWith(ALLOWED_ADMIN_EMAIL_DOMAIN);
}

function authenticateRequest(req: Request): AuthOk | AuthErr {
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!authHeader) return { ok: false, reason: "missing_token" };
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "invalid_token" };

  const token = m[1].trim();
  if (!token) return { ok: false, reason: "invalid_token" };

  // ── BRANCH A — SERVICE_ROLE bearer (admin-app Server Action path) ──────
  //
  // Try the cryptographic bearer-match first. If it matches ANY of the
  // allowed SERVICE_ROLE / SECRET_KEY env values (handles 2026 multi-form
  // key surface — legacy JWT, new sb_secret_*, JSON-dict variants), this
  // is a trusted internal call and we ONLY need the X-Actor-Email contract.
  // If bearer doesn't match any of those, fall through to OAuth validation
  // (existing Claude Desktop path).
  //
  // Order matters: SERVICE_ROLE check is purely string-compare against
  // env vars (sync, no DB). OAuth check is async DB lookup. Putting
  // SERVICE_ROLE first means Claude Desktop OAuth calls pay one extra
  // length-compare per allowed bearer (always false → fast path).
  const allowedBearers = getAllowedServiceRoleBearers();
  const isServiceRoleBearer = allowedBearers.some(
    (k) => token.length === k.length && timingSafeStringEqual(token, k),
  );
  if (isServiceRoleBearer) {
    const actorEmail = req.headers.get("X-Actor-Email") ?? req.headers.get("x-actor-email");
    if (!actorEmail) {
      // Reject — don't fall through to OAuth. A SERVICE_ROLE bearer must
      // be paired with an actor identity for audit purposes.
      Sentry.captureMessage("SERVICE_ROLE bearer received without X-Actor-Email", {
        level: "warning",
        tags: { auth_path: "service_role_missing_actor" },
      });
      return { ok: false, reason: "missing_actor_email" };
    }
    if (!isAllowedAdminEmail(actorEmail)) {
      Sentry.captureMessage("SERVICE_ROLE bearer with disallowed X-Actor-Email domain", {
        level: "warning",
        tags: { auth_path: "service_role_bad_actor_domain" },
        // Don't put the actor email in extra — it could be an attacker's
        // spoofed value; treat as untrusted input. Just record the length
        // for triage.
        extra: { actor_email_length: actorEmail.length },
      });
      return { ok: false, reason: "invalid_actor_email_domain" };
    }
    // Authoritative: this is an admin-app Server Action call. Synthesize
    // an AuthOk that looks identical to a Claude-Desktop-OAuth-derived
    // one for downstream tools (same userLabel shape → identical audit log).
    return {
      ok: true,
      userLabel: actorEmail.toLowerCase(),
      scope: ADMIN_APP_SCOPE,
      clientId: ADMIN_APP_CLIENT_ID,
      source: "admin_app",
    };
  }

  // The OAuth bearer branch (Claude Desktop path) was removed 2026-07-23. A
  // bearer that is not the SERVICE_ROLE key has no valid path here.
  return { ok: false, reason: "invalid_token" };
}

function unauthorized(reason: AuthErr["reason"]): Response {
  return new Response(JSON.stringify({ error: "unauthorized", reason }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer realm="orchestrator"`,
      ...CORS_HEADERS,
    },
  });
}

// ─── MCP method handler: tools/call ──────────────────────────────────────────

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
  source: "admin_app" | "claude_desktop",
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
    source,
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
    // M6: this catch turns a tool crash into an isError:true MCP result (HTTP
    // 200), so the exception never propagates out to withSentryScope — without
    // an explicit capture the failure is invisible. Report it; do NOT change
    // the response shape/status.
    Sentry.captureException(e, {
      tags: { fn: "orchestrator", mcp_method: "tools/call", tool: name },
    });
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
Deno.serve((req) => withSentryScope(req, "orchestrator", async () => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const path = stripFunctionPrefix(req, FUNCTION_NAME);

  // Health check via GET — respond OK without auth so uptime probes can verify
  // the URL is reachable; any actual tools/call still requires a valid bearer.
  if (req.method === "GET" && (path === "/" || path === "")) {
    return json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION });
  }

  // Everything else requires auth
  const auth = authenticateRequest(req);
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

  try {
    switch (rpcReq.method) {
      // tools/call is the only method admin-app's Server Actions invoke. The
      // MCP-handshake methods (initialize / tools-list / ping / notifications)
      // were Claude-Desktop-only and were removed 2026-07-23 with the OAuth path.
      case "tools/call": {
        const result = await handleToolsCall(rpcReq.params, auth.userLabel, auth.clientId, auth.source);
        return jsonRpcResponse({ jsonrpc: "2.0", id, result });
      }

      default:
        return jsonRpcError(
          id,
          RPC_ERR.METHOD_NOT_FOUND,
          `Method not implemented: ${rpcReq.method}`,
        );
    }
  } catch (e) {
    // RpcInvalidParams / RpcMethodNotFound are client protocol errors (bad
    // args / unknown method), NOT orchestrator failures — return them without
    // a Sentry capture to avoid noise.
    if (e instanceof RpcInvalidParams) return jsonRpcError(id, RPC_ERR.INVALID_PARAMS, e.message);
    if (e instanceof RpcMethodNotFound) return jsonRpcError(id, RPC_ERR.METHOD_NOT_FOUND, e.message);
    const msg = e instanceof Error ? e.message : String(e);
    console.error("orchestrator internal error:", msg);
    // M6: this catch converts a genuine internal failure into a JSON-RPC
    // INTERNAL error response (HTTP 200), so it never reaches withSentryScope's
    // captureException. Report it explicitly; the response/status is unchanged.
    Sentry.captureException(e, {
      tags: { fn: "orchestrator", mcp_method: rpcReq.method },
    });
    return jsonRpcError(id, RPC_ERR.INTERNAL, "Internal server error", { message: msg });
  }
}));
