// tekmetric-list-wip-keytags
//
// HTTP wrapper around the listWipKeyTags pure tool function. Today: invoked directly
// for testing. Tomorrow: registered with the orchestrator as an AI SDK tool whose
// `execute` calls listWipKeyTags(...) inline (no HTTP hop needed once the orchestrator
// lives in the same edge-function process).
//
// Auth (H5 fix, 2026-06-26): operator-only via a service-role/secret bearer
// (checkSchedulerBearer). Previously verify_jwt=true accepted the publishable anon
// key (a signature-valid Supabase JWT), so any browser could read the whole WIP/A-R
// keytag pool + customer PII. Mirrors tekmetric-bootstrap's B1/B2 hardening.
//
// Returns: { ok, count, shop_id, results: [{ key_tag, ro_number, ro_id, ro_url, ... }] }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { listWipKeyTags } from "../_shared/tools/repair-orders.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";
import { withSentryScope } from "../_shared/sentry-edge.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
} from "../_shared/scheduler-auth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Exported for the auth-gate unit test; wired to Deno.serve below.
export const handler = (req: Request) =>
  withSentryScope(req, "tekmetric-list-wip-keytags", async () => {
    // H5: operator-only bearer gate (the first handler statement). An anon-key
    // bearer doesn't match the service-role/secret key → 401 before any data read.
    const auth = checkSchedulerBearer(req, "tekmetric-list-wip-keytags");
    if (!auth.ok) return unauthorizedResponse(auth);

    if (req.method !== "GET" && req.method !== "POST") {
      return new Response(
        JSON.stringify({ ok: false, error: "Use GET or POST" }),
        { status: 405, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const result = await listWipKeyTags(sb, SHOP_ID);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("listWipKeyTags failed:", msg);
      return new Response(
        JSON.stringify({ ok: false, error: msg }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  });

Deno.serve(handler);
