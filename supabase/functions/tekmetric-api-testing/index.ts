// tekmetric-api-testing
//
// A read-only Tekmetric API probe + sandbox edge function (created 2026-05-15).
// Purpose: let Chris (and Claude) inspect Tekmetric responses without exposing
// the vault-stored access token, so we can:
//
//   - Discover empirical enum values (e.g., appointmentOption.code returns
//     STAY / DROP, not WAITER / PICKUP_DROPOFF — Phase 9d finding)
//   - Audit individual records by id (raw JSON, not the parsed shadow rows)
//   - Test new endpoints before wiring them into the booking flow
//   - Sanity-check the cached access token after rotation
//
// CATALOG / INDEX (call with { op: 'index' } or no body to list available ops):
//
//   • index                        → returns this catalog
//   • whoami                       → basic token sanity check
//   • get_appointment              { appointment_id }
//   • list_appointments            { start?, end?, page?, size?, sort? }
//   • get_customer                 { customer_id }
//   • search_customer_by_phone     { phone }
//   • get_vehicle                  { vehicle_id }
//   • list_vehicles_for_customer   { customer_id, page?, size? }
//   • get_ro                       { ro_id }
//   • list_ros                     { page?, size?, sort? }
//   • list_payments                { page?, size? }
//   • list_employees               { page?, size? }
//   • list_canned_jobs             { page?, size? }
//   • raw_get                      { path, query? }  — escape hatch for any GET
//
// Response shape (always JSON):
//   200 { ok: true,  op, url_called, status, data }
//   4xx { ok: false, op, url_called?, status?, error, body_excerpt? }
//
// Auth: Supabase's default JWT verification (verify_jwt=true). The
// publishable anon key passes — this is a read-only testing surface, so
// we don't gate it behind the service-role-key Pattern A bearer the
// other scheduler-* functions use. The Tekmetric token still comes from
// the vault via getTekmetricAccessToken (see tekmetric-client.ts).
//
// Safety:
//   - READ-ONLY. No POST/PATCH/DELETE ops exposed. If you need to test a
//     write, add it explicitly with a confirmation token (see
//     pattern-compliance.md Pattern A) — do NOT silently extend raw_get to
//     accept other methods.
//   - Response body is returned verbatim from Tekmetric. Tekmetric strings
//     can contain PII; treat the response as sensitive when sharing.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { tekmetricFetch } from "../_shared/tekmetric-client.ts";
import { ENV_NAMES } from "../_shared/tekmetric.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

// ─── Op catalog ─────────────────────────────────────────────────────────────

interface OpDescriptor {
  op: string;
  description: string;
  args: Record<string, string>;
  example: Record<string, unknown>;
}

const OP_CATALOG: OpDescriptor[] = [
  {
    op: "index",
    description:
      "Returns this catalog. Default op when no `op` field is supplied.",
    args: {},
    example: { op: "index" },
  },
  {
    op: "whoami",
    description:
      "Basic token sanity check — calls GET /shops?id={SHOP_ID} which returns the configured shop record when auth works.",
    args: {},
    example: { op: "whoami" },
  },
  {
    op: "get_appointment",
    description: "GET /appointments/{id} — single appointment by Tekmetric id.",
    args: { appointment_id: "number (required)" },
    example: { op: "get_appointment", appointment_id: 61802832 },
  },
  {
    op: "list_appointments",
    description:
      "GET /appointments?shop={shop} — paginated list. Defaults to next 30 days when start/end not supplied.",
    args: {
      start: "YYYY-MM-DD (optional)",
      end: "YYYY-MM-DD (optional)",
      page: "number (optional, 0-indexed)",
      size: "number (optional, default 100, max 100)",
      sort: 'string (optional, e.g. "startTime,desc")',
    },
    example: {
      op: "list_appointments",
      start: "2026-05-15",
      end: "2026-05-22",
    },
  },
  {
    op: "get_customer",
    description: "GET /customers/{id} — single customer by Tekmetric id.",
    args: { customer_id: "number (required)" },
    example: { op: "get_customer", customer_id: 44695767 },
  },
  {
    op: "search_customer_by_phone",
    description:
      "GET /customers/search?search={phone}&shop={shop} — Tekmetric's free-text search across phone/email/name.",
    args: { phone: "string (required, normalized; '6105595520' or '+16105595520')" },
    example: { op: "search_customer_by_phone", phone: "6105595520" },
  },
  {
    op: "get_vehicle",
    description: "GET /vehicles/{id} — single vehicle by Tekmetric id.",
    args: { vehicle_id: "number (required)" },
    example: { op: "get_vehicle", vehicle_id: 155373669 },
  },
  {
    op: "list_vehicles_for_customer",
    description:
      "GET /vehicles?customerId={id}&shop={shop} — every vehicle on file for a customer.",
    args: {
      customer_id: "number (required)",
      page: "number (optional)",
      size: "number (optional, default 50)",
    },
    example: { op: "list_vehicles_for_customer", customer_id: 44695767 },
  },
  {
    op: "get_ro",
    description: "GET /repair-orders/{id} — single repair order by id.",
    args: { ro_id: "number (required)" },
    example: { op: "get_ro", ro_id: 12345678 },
  },
  {
    op: "list_ros",
    description:
      "GET /repair-orders?shop={shop} — paginated RO list. Newest-first by default.",
    args: {
      page: "number (optional)",
      size: "number (optional, default 50)",
      sort: 'string (optional, default "postedDate,desc")',
    },
    example: { op: "list_ros", size: 10 },
  },
  {
    op: "list_payments",
    description: "GET /payments?shop={shop} — paginated payments list.",
    args: {
      page: "number (optional)",
      size: "number (optional, default 50)",
    },
    example: { op: "list_payments", size: 10 },
  },
  {
    op: "list_employees",
    description:
      "GET /employees?shop={shop} — service writers, technicians, etc.",
    args: {
      page: "number (optional)",
      size: "number (optional, default 50)",
    },
    example: { op: "list_employees" },
  },
  {
    op: "list_canned_jobs",
    description:
      "GET /canned-jobs?shop={shop} — Tekmetric's pre-defined job catalog.",
    args: {
      page: "number (optional)",
      size: "number (optional, default 50)",
    },
    example: { op: "list_canned_jobs" },
  },
  {
    op: "raw_get",
    description:
      "GET {path}?{query} — escape hatch for any Tekmetric GET endpoint. `path` must start with /. `query` is a flat string-or-number map; shop={SHOP_ID} is auto-added when absent. NEVER use this for writes; method is GET-only.",
    args: {
      path: 'string (required, e.g. "/inventory/items")',
      query: "object (optional, keys/values flat)",
    },
    example: {
      op: "raw_get",
      path: "/canned-jobs",
      query: { size: 5 },
    },
  },
];

function describeIndex(): Record<string, unknown> {
  return {
    ok: true,
    op: "index",
    description:
      "tekmetric-api-testing — read-only probe surface. See the OP_CATALOG entries below for available ops.",
    shop_id: SHOP_ID,
    op_catalog: OP_CATALOG,
  };
}

// ─── Generic call wrapper ───────────────────────────────────────────────────

interface CallResult {
  url_called: string;
  status: number;
  body: unknown;
  body_excerpt?: string;
}

async function tekmetricCall(
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): Promise<CallResult> {
  // Note: tekmetric-client's buildUrl handles undefined/null values by
  // dropping them. We always add shop=SHOP_ID when caller didn't.
  const mergedQuery: Record<string, string | number | boolean | undefined | null> = {
    ...(query ?? {}),
  };
  if (!("shop" in mergedQuery) && !("customerId" in mergedQuery)) {
    // Most Tekmetric resource endpoints accept `shop` as the scoping key.
    // /customers/{id} (no query needed) and /vehicles/{id} (no shop) work fine
    // with an extra shop= param attached; Tekmetric ignores unknown query keys.
    mergedQuery.shop = SHOP_ID;
  }

  const res = await tekmetricFetch(sb, path, {
    method: "GET",
    query: mergedQuery,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Tekmetric returned non-JSON (rare; usually an HTML error page on 500).
    return {
      url_called: buildUrlForLog(path, mergedQuery),
      status: res.status,
      body: null,
      body_excerpt: text.slice(0, 1000),
    };
  }
  return {
    url_called: buildUrlForLog(path, mergedQuery),
    status: res.status,
    body: parsed,
  };
}

/**
 * Build the called URL string for logging — mirrors tekmetric-client's
 * buildUrl but returns a string (we don't have access to the internal
 * helper). Used only in the response payload for debugging.
 */
function buildUrlForLog(
  path: string,
  query: Record<string, unknown>,
): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.length > 0 ? `${path}?${parts.join("&")}` : path;
}

// ─── Op dispatchers ─────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function handleGetAppointment(
  args: Record<string, unknown>,
): Promise<Response> {
  const appointmentId = asNumber(args.appointment_id);
  if (appointmentId === null) {
    return jsonResponse(
      { ok: false, op: "get_appointment", error: "missing or invalid appointment_id" },
      400,
    );
  }
  const result = await tekmetricCall(`/appointments/${appointmentId}`);
  return jsonResponse({ ok: result.status < 400, op: "get_appointment", ...result });
}

async function handleListAppointments(
  args: Record<string, unknown>,
): Promise<Response> {
  const query: Record<string, string | number | undefined> = {};
  const start = asString(args.start);
  const end = asString(args.end);
  const page = asNumber(args.page);
  const size = asNumber(args.size);
  const sort = asString(args.sort);
  if (start) query.start = start;
  if (end) query.end = end;
  if (page !== null) query.page = page;
  if (size !== null) query.size = size;
  if (sort) query.sort = sort;
  const result = await tekmetricCall("/appointments", query);
  return jsonResponse({ ok: result.status < 400, op: "list_appointments", ...result });
}

async function handleGetCustomer(
  args: Record<string, unknown>,
): Promise<Response> {
  const customerId = asNumber(args.customer_id);
  if (customerId === null) {
    return jsonResponse(
      { ok: false, op: "get_customer", error: "missing or invalid customer_id" },
      400,
    );
  }
  const result = await tekmetricCall(`/customers/${customerId}`);
  return jsonResponse({ ok: result.status < 400, op: "get_customer", ...result });
}

async function handleSearchCustomerByPhone(
  args: Record<string, unknown>,
): Promise<Response> {
  const phone = asString(args.phone);
  if (phone === null) {
    return jsonResponse(
      { ok: false, op: "search_customer_by_phone", error: "missing phone" },
      400,
    );
  }
  const result = await tekmetricCall("/customers/search", { search: phone });
  return jsonResponse({
    ok: result.status < 400,
    op: "search_customer_by_phone",
    ...result,
  });
}

async function handleGetVehicle(
  args: Record<string, unknown>,
): Promise<Response> {
  const vehicleId = asNumber(args.vehicle_id);
  if (vehicleId === null) {
    return jsonResponse(
      { ok: false, op: "get_vehicle", error: "missing or invalid vehicle_id" },
      400,
    );
  }
  const result = await tekmetricCall(`/vehicles/${vehicleId}`);
  return jsonResponse({ ok: result.status < 400, op: "get_vehicle", ...result });
}

async function handleListVehiclesForCustomer(
  args: Record<string, unknown>,
): Promise<Response> {
  const customerId = asNumber(args.customer_id);
  if (customerId === null) {
    return jsonResponse(
      {
        ok: false,
        op: "list_vehicles_for_customer",
        error: "missing or invalid customer_id",
      },
      400,
    );
  }
  const query: Record<string, string | number | undefined> = {
    customerId,
  };
  const page = asNumber(args.page);
  const size = asNumber(args.size);
  if (page !== null) query.page = page;
  if (size !== null) query.size = size;
  const result = await tekmetricCall("/vehicles", query);
  return jsonResponse({
    ok: result.status < 400,
    op: "list_vehicles_for_customer",
    ...result,
  });
}

async function handleGetRo(
  args: Record<string, unknown>,
): Promise<Response> {
  const roId = asNumber(args.ro_id);
  if (roId === null) {
    return jsonResponse(
      { ok: false, op: "get_ro", error: "missing or invalid ro_id" },
      400,
    );
  }
  const result = await tekmetricCall(`/repair-orders/${roId}`);
  return jsonResponse({ ok: result.status < 400, op: "get_ro", ...result });
}

async function handleListRos(
  args: Record<string, unknown>,
): Promise<Response> {
  const query: Record<string, string | number | undefined> = {};
  const page = asNumber(args.page);
  const size = asNumber(args.size);
  const sort = asString(args.sort) ?? "postedDate,desc";
  if (page !== null) query.page = page;
  if (size !== null) query.size = size;
  query.sort = sort;
  const result = await tekmetricCall("/repair-orders", query);
  return jsonResponse({ ok: result.status < 400, op: "list_ros", ...result });
}

async function handleListPayments(
  args: Record<string, unknown>,
): Promise<Response> {
  const query: Record<string, string | number | undefined> = {};
  const page = asNumber(args.page);
  const size = asNumber(args.size);
  if (page !== null) query.page = page;
  if (size !== null) query.size = size;
  const result = await tekmetricCall("/payments", query);
  return jsonResponse({ ok: result.status < 400, op: "list_payments", ...result });
}

async function handleListEmployees(
  args: Record<string, unknown>,
): Promise<Response> {
  const query: Record<string, string | number | undefined> = {};
  const page = asNumber(args.page);
  const size = asNumber(args.size);
  if (page !== null) query.page = page;
  if (size !== null) query.size = size;
  const result = await tekmetricCall("/employees", query);
  return jsonResponse({ ok: result.status < 400, op: "list_employees", ...result });
}

async function handleListCannedJobs(
  args: Record<string, unknown>,
): Promise<Response> {
  const query: Record<string, string | number | undefined> = {};
  const page = asNumber(args.page);
  const size = asNumber(args.size);
  if (page !== null) query.page = page;
  if (size !== null) query.size = size;
  const result = await tekmetricCall("/canned-jobs", query);
  return jsonResponse({
    ok: result.status < 400,
    op: "list_canned_jobs",
    ...result,
  });
}

async function handleWhoami(): Promise<Response> {
  // /shops/{id} is a cheap auth-validation call.
  const result = await tekmetricCall(`/shops/${SHOP_ID}`);
  return jsonResponse({ ok: result.status < 400, op: "whoami", ...result });
}

async function handleRawGet(
  args: Record<string, unknown>,
): Promise<Response> {
  const path = asString(args.path);
  if (path === null || !path.startsWith("/")) {
    return jsonResponse(
      {
        ok: false,
        op: "raw_get",
        error: "missing path; must start with /",
      },
      400,
    );
  }
  let query: Record<string, string | number | boolean | undefined | null> = {};
  if (args.query !== undefined) {
    if (!isObject(args.query)) {
      return jsonResponse(
        { ok: false, op: "raw_get", error: "query must be an object" },
        400,
      );
    }
    for (const [k, v] of Object.entries(args.query)) {
      if (
        v === null ||
        typeof v === "string" ||
        typeof v === "number" ||
        typeof v === "boolean"
      ) {
        query[k] = v;
      } else {
        return jsonResponse(
          {
            ok: false,
            op: "raw_get",
            error: `query value for "${k}" must be string|number|boolean|null`,
          },
          400,
        );
      }
    }
  }
  const result = await tekmetricCall(path, query);
  return jsonResponse({ ok: result.status < 400, op: "raw_get", ...result });
}

// ─── HTTP entry ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { ok: false, error: "method_not_allowed", allowed: ["POST"] },
      405,
    );
  }

  // Empty body → default to op='index' so a bare POST returns the catalog.
  let raw: unknown = {};
  const text = await req.text();
  if (text.trim().length > 0) {
    try {
      raw = JSON.parse(text);
    } catch (e) {
      return jsonResponse(
        {
          ok: false,
          error: "invalid_json_body",
          detail: e instanceof Error ? e.message : String(e),
        },
        400,
      );
    }
  }

  if (!isObject(raw)) {
    return jsonResponse(
      { ok: false, error: "body must be a JSON object" },
      400,
    );
  }

  const op = typeof raw.op === "string" ? raw.op : "index";

  try {
    switch (op) {
      case "index":
        return jsonResponse(describeIndex());
      case "whoami":
        return await handleWhoami();
      case "get_appointment":
        return await handleGetAppointment(raw);
      case "list_appointments":
        return await handleListAppointments(raw);
      case "get_customer":
        return await handleGetCustomer(raw);
      case "search_customer_by_phone":
        return await handleSearchCustomerByPhone(raw);
      case "get_vehicle":
        return await handleGetVehicle(raw);
      case "list_vehicles_for_customer":
        return await handleListVehiclesForCustomer(raw);
      case "get_ro":
        return await handleGetRo(raw);
      case "list_ros":
        return await handleListRos(raw);
      case "list_payments":
        return await handleListPayments(raw);
      case "list_employees":
        return await handleListEmployees(raw);
      case "list_canned_jobs":
        return await handleListCannedJobs(raw);
      case "raw_get":
        return await handleRawGet(raw);
      default:
        return jsonResponse(
          {
            ok: false,
            op,
            error: `unknown_op`,
            known_ops: OP_CATALOG.map((o) => o.op),
          },
          400,
        );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(
      {
        ok: false,
        op,
        error: "internal_error",
        detail: message.slice(0, 1000),
      },
      500,
    );
  }
});
