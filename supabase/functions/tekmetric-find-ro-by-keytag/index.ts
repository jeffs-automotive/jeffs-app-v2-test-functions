// tekmetric-find-ro-by-keytag
//
// HTTP wrapper around the findRoByKeyTag pure tool function. Accepts the key tag
// as either a query string param (`?key_tag=5`) for GET or a JSON body (`{key_tag: 5}`)
// for POST. Both work — the orchestrator will eventually call this without HTTP at all.
//
// "Fuzzy language" reminder for the orchestrator's tool description (set in the
// orchestrator code, not here): this tool answers ANY user question about who/what/which
// is on a given key tag — "what RO has key tag 5", "which customer has tag 5", "what
// vehicle is on tag 5", etc. The tool always returns RO data; the orchestrator picks the
// right field for the answer.
//
// Returns:
//   - found:     { ok, found: true,  key_tag, ro_number, ro_id, ro_url, customer_id, vehicle_id, status, ... }
//   - not found: { ok, found: false, key_tag, message }

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { findRoByKeyTag } from "../_shared/tools/repair-orders.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function readKeyTag(req: Request): Promise<number | null> {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("key_tag") ?? url.searchParams.get("keyTag");
  if (fromQuery !== null) {
    const n = parseInt(fromQuery, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (req.method === "POST") {
    try {
      const body = await req.json() as { key_tag?: number | string; keyTag?: number | string };
      const raw = body.key_tag ?? body.keyTag;
      if (raw === undefined || raw === null) return null;
      const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Use GET (?key_tag=N) or POST ({key_tag: N})" }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }

  const keyTag = await readKeyTag(req);
  if (keyTag === null) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Missing or invalid key_tag. Use ?key_tag=N (GET) or {key_tag: N} (POST). N must be an integer 1-100.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const result = await findRoByKeyTag(sb, SHOP_ID, keyTag);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("findRoByKeyTag failed:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
