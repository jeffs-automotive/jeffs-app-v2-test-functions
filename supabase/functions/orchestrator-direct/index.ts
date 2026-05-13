// orchestrator-direct
//
// Plain JSON in/out endpoint hit by the scheduler-app's Vercel Server Action /
// Route Handler. Sister of orchestrator-mcp (which speaks JSON-RPC + OAuth+PKCE
// to Claude Desktop). Same unified orchestrator under the hood (Chunk 2
// refactor 2026-05-13) — different caller_context, different response shaping.
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
//   POST / { session_id, context, hints?, intent_type? }
// Response:
//   200 { directive, data?, flags?, meta }   (success)
//   401 { ok: false, error }                  (missing/invalid bearer)
//   400 { ok: false, error }                  (malformed body)
//   500 { ok: false, error }                  (orchestrator threw)
//
// Chunk 2 changes (2026-05-13):
//   - Switched from runSchedulerOrchestrator → runOrchestrator with
//     caller_context='customer'
//   - Added optional `intent_type` body field that short-circuits the router
//     LLM call when the chat-side caller already knows which specialist owns
//     the turn (e.g. 'verify_and_lookup', 'hold_slot', 'diagnose_concern')

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { runOrchestrator } from "../_shared/orchestrator.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

interface ParsedBody {
  session_id: string;
  context: string;
  hints?: Record<string, unknown>;
  intent_type?: string;
}

function parseBody(
  raw: unknown,
):
  | { ok: true; input: ParsedBody }
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
  let intentType: string | undefined;
  if (raw.intent_type !== undefined) {
    if (typeof raw.intent_type !== "string" || raw.intent_type.length === 0) {
      return { ok: false, error: "intent_type_not_string" };
    }
    intentType = raw.intent_type;
  }
  return {
    ok: true,
    input: {
      session_id: raw.session_id,
      context: raw.context,
      hints,
      intent_type: intentType,
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

  const auth = checkSchedulerBearer(req, "orchestrator-direct");
  if (!auth.ok) {
    return unauthorizedResponse(auth);
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
    const result = await runOrchestrator(sb, SHOP_ID, {
      caller_context: "customer",
      session_id: parsed.input.session_id,
      context: parsed.input.context,
      hints: parsed.input.hints,
      intent_type: parsed.input.intent_type,
    });

    // Re-shape for the existing scheduler-app caller. The unified orchestrator
    // result includes meta + maybe answer (for keytag — never reached here
    // since customer caller_context can't route to keytag), so we just project
    // the customer-relevant fields.
    return jsonResponse(
      {
        ok: result.ok,
        directive: result.directive ?? "tool_error",
        data: result.data,
        flags: result.flags,
        meta: result.meta,
        run_id: result.run_id,
        error: result.error,
      },
      200, // 200 even on orchestrator-internal "error" directive — the chat
      // agent branches on `directive`, not HTTP status. Only return 5xx for
      // pre-orchestrator failures (auth, parse).
    );
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
