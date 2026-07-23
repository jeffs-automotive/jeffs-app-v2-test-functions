// tekbridge — the shared Tekmetric internal-API bridge gateway.
//
// Performs Tekmetric actions the PUBLIC API can't (write RO concerns, etc.) by
// replaying the internal API with the bot session JWT. Consumed by multiple
// modules over one HTTP contract; new abilities are drop-in capability modules
// (see _shared/tekbridge/registry.ts). Full design: docs/tekmetric/tekbridge-plan.md.
//
// Auth: SERVICE_ROLE bearer + X-Actor-Email (same trusted-internal contract as
// orchestrator-mcp's admin-app branch). Routes:
//   GET  /            → health (no auth)
//   POST /            → { capability, input } → validate vs zod → execute → { ok, data }
//   POST /session     → { jwt }  → store the bot session JWT in Vault
//   GET  /session     → session health
//
// Every request is wrapped in withSentryScope (per-request isolation — the Deno
// SDK does not isolate across concurrent requests). Observability rule 9: every
// Supabase call checks `error`.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@^4";

import { Sentry, withSentryScope } from "../_shared/sentry-edge.ts";
import { stripFunctionPrefix } from "../_shared/oauth.ts";
import { authenticateServiceRole } from "../_shared/tekbridge/auth.ts";
import { getTekbridgeTools } from "../_shared/tekbridge/registry.ts";
import {
  getSessionHealth,
  setBotJwt,
  TekbridgeSessionError,
} from "../_shared/tekbridge/session.ts";

const FUNCTION_NAME = "tekbridge";
const SERVER_VERSION = "0.1.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SECRET_KEY")!;
const SHOP_ID = parseInt(Deno.env.get("TEKMETRIC_SHOP_ID") ?? "7476", 10);

const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Actor-Email",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// A capability from the registry, viewed structurally (runtime shape of ai@^5 tool()).
type CapabilityDef = {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
};

// ─── Audit ───────────────────────────────────────────────────────────────────

interface AuditArgs {
  capability: string;
  actor: string;
  outcome: "ok" | "error";
  verified?: boolean | null;
  tekmetricRef?: Record<string, unknown> | null;
  inputSummary?: Record<string, unknown> | null;
  error?: string | null;
}

async function recordAudit(args: AuditArgs): Promise<void> {
  const { error } = await sb.from("tekbridge_audit_log").insert({
    shop_id: SHOP_ID,
    capability: args.capability,
    input_summary: args.inputSummary ?? null,
    actor: args.actor,
    outcome: args.outcome,
    verified: args.verified ?? null,
    tekmetric_ref: args.tekmetricRef ?? null,
    error: args.error ?? null,
  });
  if (error) {
    // Audit-write failure must not mask the actual capability result — log only.
    console.error(`tekbridge audit insert failed: ${error.message}`);
  }
}

/** Shallow input summary for audit — truncates long strings so we don't
 *  duplicate full customer-complaint text across tables. */
function summarizeInput(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = typeof v === "string" && v.length > 60 ? { __len: v.length } : v;
  }
  return out;
}

function extractVerified(result: unknown): boolean | null {
  if (result && typeof result === "object" && "verified" in result) {
    const v = (result as { verified?: unknown }).verified;
    return typeof v === "boolean" ? v : null;
  }
  return null;
}

function extractRef(result: unknown): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  const ref: Record<string, unknown> = {};
  for (const key of ["concernId", "repairOrderId", "jobId", "laborId"]) {
    if (typeof r[key] === "number") ref[key] = r[key];
  }
  return Object.keys(ref).length ? ref : null;
}

// ─── Route handlers ──────────────────────────────────────────────────────────

async function handleCapability(req: Request, actor: string): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const capability = (body as { capability?: unknown })?.capability;
  const rawInput = (body as { input?: unknown })?.input;
  if (typeof capability !== "string" || capability.length === 0) {
    return json({ ok: false, error: "'capability' (non-empty string) is required" }, 400);
  }

  // shop_id is resolved SERVER-side from env — never from the client body.
  // Cast through `unknown`: ai@^5's Tool.inputSchema type is FlexibleSchema, but
  // tool() stores our zod schema verbatim at runtime (same access pattern as
  // mcp-tool-registry.ts), so `.inputSchema.parse` / `.execute` are valid.
  const registry = getTekbridgeTools({ sb, shopId: SHOP_ID }) as unknown as Record<string, CapabilityDef>;
  const tool = registry[capability];
  if (!tool) {
    return json(
      { ok: false, code: "unknown_capability", error: `unknown capability: ${capability}` },
      400,
    );
  }

  let validated: unknown;
  try {
    validated = tool.inputSchema.parse(rawInput ?? {});
  } catch (e) {
    if (e instanceof z.ZodError) {
      return json(
        {
          ok: false,
          code: "invalid_input",
          error: e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
        },
        400,
      );
    }
    throw e;
  }

  const inputSummary = summarizeInput(validated);
  try {
    const result = await tool.execute(validated);
    await recordAudit({
      capability,
      actor,
      outcome: "ok",
      verified: extractVerified(result),
      tekmetricRef: extractRef(result),
      inputSummary,
    });
    return json({ ok: true, data: result });
  } catch (e) {
    if (e instanceof TekbridgeSessionError) {
      Sentry.captureMessage(`tekbridge session ${e.code} on ${capability}`, {
        level: "warning",
        tags: { fn: FUNCTION_NAME, capability, session_code: e.code },
      });
      await recordAudit({ capability, actor, outcome: "error", error: e.code, inputSummary });
      return json(
        { ok: false, code: e.code, error: e.message, needs_session_refresh: true },
        409,
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, { tags: { fn: FUNCTION_NAME, capability } });
    await recordAudit({ capability, actor, outcome: "error", error: msg.slice(0, 500), inputSummary });
    return json({ ok: false, error: `${capability} failed: ${msg}` }, 502);
  }
}

async function handleSessionSubmit(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON body" }, 400);
  }
  const jwt = (body as { jwt?: unknown })?.jwt;
  if (typeof jwt !== "string" || jwt.length === 0) {
    return json({ ok: false, error: "'jwt' (non-empty string) is required" }, 400);
  }
  try {
    const { expiresAt } = await setBotJwt(sb, jwt, SHOP_ID);
    // Never log the JWT itself; just record that a refresh happened.
    Sentry.captureMessage("tekbridge session JWT submitted", {
      level: "info",
      tags: { fn: FUNCTION_NAME },
    });
    return json({ ok: true, expires_at: expiresAt });
  } catch (e) {
    if (e instanceof TekbridgeSessionError) {
      return json({ ok: false, code: e.code, error: e.message }, 400);
    }
    throw e;
  }
}

async function handleSessionHealth(): Promise<Response> {
  const health = await getSessionHealth(sb, SHOP_ID);
  return json({
    ok: true,
    session: health ?? { shopId: SHOP_ID, status: "stale", expiresAt: null, lastError: null },
  });
}

// ─── Entrypoint ──────────────────────────────────────────────────────────────

Deno.serve((req) =>
  withSentryScope(req, FUNCTION_NAME, async () => {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const path = stripFunctionPrefix(req, FUNCTION_NAME);

    // Health — public, no auth (lets a caller verify reachability).
    if (req.method === "GET" && (path === "/" || path === "")) {
      return json({ ok: true, server: FUNCTION_NAME, version: SERVER_VERSION });
    }

    // Everything else requires the SERVICE_ROLE + actor contract.
    const auth = authenticateServiceRole(req);
    if (!auth.ok) {
      return json({ ok: false, error: `unauthorized: ${auth.reason}` }, 401);
    }

    if (path === "/session") {
      if (req.method === "GET") return await handleSessionHealth();
      if (req.method === "POST") return await handleSessionSubmit(req);
      return json({ ok: false, error: "method not allowed" }, 405);
    }

    if ((path === "/" || path === "") && req.method === "POST") {
      return await handleCapability(req, auth.actorEmail);
    }

    return json({ ok: false, error: `not found: ${req.method} ${path}` }, 404);
  })
);
