// tekmetric-find-ro-by-keytag
//
// HTTP wrapper around the findRoByKeyTag pure tool function. Accepts a key
// tag in any of these shapes:
//   GET   ?tag=R5      ?tag=Y45      ?tag=5         (preferred; '5' = legacy red)
//   GET   ?key_tag=5                                (legacy bare-number)
//   POST  {tag: "R5"}  {tag: "Y45"}  {tag: "5"}     (preferred body shape)
//   POST  {key_tag: 5}                              (legacy bare-number)
//
// Color prefix is REQUIRED for yellow tags — the legacy bare-number shape
// defaults to RED for backward compatibility (per `parseKeytag` in
// _shared/keytag-format.ts).
//
// Returns:
//   - found:     { ok, found: true,  tag, tag_color, tag_number, ro_number, ro_id, ro_url, customer_id, vehicle_id, status, ... }
//   - not found: { ok, found: false, tag, tag_color, tag_number, message }
//
// History: prior to 2026-05-11 this wrapper took a bare numeric `key_tag` and
// the underlying findRoByKeyTag treated it as a single-color search. The
// underlying function changed to require (color, number) when Tekmetric
// adopted R/Y tag prefixes. The wrapper compiled-but-broken in production
// for ~2 weeks (no caller relied on it because orchestrator-mcp v0.3.0
// dispatches the underlying function directly without HTTP). This rewrite
// (PLAN-02 Phase 1 follow-up) restores the wrapper as a working
// diagnostic endpoint that accepts both new and legacy inputs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { findRoByKeyTag } from "../_shared/tools/repair-orders.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";
import { parseKeytag } from "../_shared/keytag-format.ts";
import { withSentryScope } from "../_shared/sentry-edge.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476", 10);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Reads the request and extracts a parsed keytag.
 *
 * Accepts `tag` (preferred — supports R/Y prefix), `key_tag`, or `keyTag`
 * in either query string (GET/POST) or JSON body (POST). The first value
 * found is parsed via `parseKeytag`.
 *
 * Returns `{ color, number, legacy }` on success or `null` if no input was
 * present OR the value didn't parse OR the number was out of range.
 */
async function readKeytag(
  req: Request,
): Promise<{ color: "red" | "yellow"; number: number; legacy: boolean } | null> {
  const url = new URL(req.url);
  // Query-string priority: tag → key_tag → keyTag.
  const fromQuery =
    url.searchParams.get("tag") ??
    url.searchParams.get("key_tag") ??
    url.searchParams.get("keyTag");
  if (fromQuery !== null) {
    return parseKeytag(fromQuery);
  }

  if (req.method === "POST") {
    try {
      const body = await req.json() as {
        tag?: string | number;
        key_tag?: number | string;
        keyTag?: number | string;
      };
      const raw = body.tag ?? body.key_tag ?? body.keyTag;
      return parseKeytag(raw ?? null);
    } catch {
      return null;
    }
  }
  return null;
}

// PLAN-02 Phase 1 — per-request Sentry isolation scope + flush before response.
Deno.serve((req) =>
  withSentryScope(req, "tekmetric-find-ro-by-keytag", async () => {
    if (req.method !== "GET" && req.method !== "POST") {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Use GET (?tag=R5|Y45|5) or POST ({tag: \"R5\"}). Bare numbers (legacy) default to red.",
        }),
        { status: 405, headers: { "Content-Type": "application/json" } },
      );
    }

    const parsed = await readKeytag(req);
    if (!parsed) {
      return new Response(
        JSON.stringify({
          ok: false,
          error:
            "Missing or invalid tag. Use ?tag=R5 / ?tag=Y45 / ?tag=5 (GET) or {tag: \"R5\"} (POST). Tag numbers must be 1-90.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    try {
      const result = await findRoByKeyTag(sb, SHOP_ID, parsed.color, parsed.number);
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
  }),
);
