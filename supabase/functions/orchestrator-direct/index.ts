// orchestrator-direct
//
// Plain JSON in/out endpoint hit by the scheduler-app's Vercel Server Action /
// Route Handler. Sister of orchestrator-mcp (which speaks JSON-RPC + OAuth+PKCE
// to Claude Desktop). Same orchestrator agent under the hood — different tool
// catalog, different system prompt, different auth.
//
// Auth: Pattern A per appointments_design.md §15:
//   - Authorization: Bearer <SUPABASE_SECRET_KEY>
//   - apikey: <SUPABASE_SECRET_KEY>
//   The Vercel side's process.env.SUPABASE_SECRET_KEY equals this Edge
//   Function's Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') (same value, different
//   env names; Marketplace integration auto-injects on Vercel side, runtime
//   auto-injects on Supabase side).
//
// Request:
//   POST / { session_id, context, hints? }
// Response:
//   200 { directive, data?, flags?, meta }   (success)
//   401 { ok: false, error }                  (missing/invalid bearer)
//   400 { ok: false, error }                  (malformed body)
//   500 { ok: false, error }                  (orchestrator threw)

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import {
  runSchedulerOrchestrator,
  type SchedulerOrchestratorInput,
} from "../_shared/scheduler-orchestrator.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/**
 * Verify the Authorization bearer matches our service-role key.
 * Pattern A — service-role key IS the auth token.
 */
function checkAuth(req: Request): { ok: true } | { ok: false; reason: string } {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return { ok: false, reason: "missing_bearer" };
  }
  const submitted = auth.slice("bearer ".length).trim();
  if (submitted.length === 0) {
    return { ok: false, reason: "empty_bearer" };
  }
  // Constant-time-ish compare (string-length first then char compare).
  if (
    submitted.length !== SERVICE_ROLE_KEY.length ||
    submitted !== SERVICE_ROLE_KEY
  ) {
    return { ok: false, reason: "bearer_mismatch" };
  }
  return { ok: true };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseBody(raw: unknown):
  | { ok: true; input: SchedulerOrchestratorInput }
  | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "body_not_object" };
  }
  if (typeof raw.session_id !== "string" || raw.session_id.length === 0) {
    return { ok: false, error: "missing_session_id" };
  }
  if (typeof raw.context !== "string" || raw.context.length === 0) {
    return { ok: false, error: "missing_context" };
  }
  let hints: Record<string, unknown> | undefined;
  if (raw.hints !== undefined) {
    if (!isPlainObject(raw.hints)) {
      return { ok: false, error: "hints_not_object" };
    }
    hints = raw.hints;
  }
  return {
    ok: true,
    input: {
      session_id: raw.session_id,
      context: raw.context,
      hints,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const auth = checkAuth(req);
  if (!auth.ok) {
    return jsonResponse({ ok: false, error: auth.reason }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return jsonResponse({ ok: false, error: parsed.error }, 400);
  }

  try {
    const result = await runSchedulerOrchestrator(sb, SHOP_ID, parsed.input);
    // Always 200 even on orchestrator-internal "error" directive — the chat
    // agent branches on `directive`, not HTTP status. Only return 5xx for
    // pre-orchestrator failures (auth, parse).
    return jsonResponse(result, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "orchestrator_direct_unhandled",
        detail: msg,
      }),
    );
    return jsonResponse(
      {
        ok: false,
        directive: "tool_error",
        flags: { internal_error: true },
        error: msg,
      },
      500,
    );
  }
});
