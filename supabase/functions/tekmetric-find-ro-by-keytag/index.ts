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
// Auth (H5 fix, 2026-06-26): operator-only via a service-role/secret bearer
// (checkSchedulerBearer). Previously verify_jwt=true accepted the publishable anon
// key, so any browser could enumerate any tag → RO/customer/vehicle. Mirrors
// tekmetric-bootstrap's B1/B2 hardening.
//
// Returns:
//   - found:     { ok, found: true,  tag, tag_color, tag_number, ro_number, ro_id, ro_url, customer_id, vehicle_id, status, ... }
//   - not found: { ok, found: false, tag, tag_color, tag_number, message }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { findRoByKeyTag } from "../_shared/tools/repair-orders.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";
import { parseKeytag } from "../_shared/keytag-format.ts";
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

// Exported for the auth-gate unit test; wired to Deno.serve below.
export const handler = (req: Request) =>
  withSentryScope(req, "tekmetric-find-ro-by-keytag", async () => {
    // H5: operator-only bearer gate (the first handler statement). An anon-key
    // bearer doesn't match the service-role/secret key → 401 before any lookup.
    const auth = checkSchedulerBearer(req, "tekmetric-find-ro-by-keytag");
    if (!auth.ok) return unauthorizedResponse(auth);

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
  });

Deno.serve(handler);
