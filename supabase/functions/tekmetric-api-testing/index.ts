// tekmetric-api-testing
//
// A Tekmetric API probe + sandbox edge function (created 2026-05-15).
// Purpose: let Chris (and Claude) inspect Tekmetric responses without exposing
// the vault-stored access token, so we can:
//
//   - Discover empirical enum values (e.g., appointmentOption.id=1 is STAY,
//     id=2 is DROP — verified 2026-05-15 against 1146 production webhooks)
//   - Audit individual records by id (raw JSON, not the parsed shadow rows)
//   - Test new endpoints before wiring them into the booking flow
//   - Sanity-check the cached access token after rotation
//   - Run controlled write tests (POST/PATCH/DELETE) gated by a UUID
//     two-step confirmation so no accidental fires
//
// CATALOG / INDEX (call with { op: 'index' } or no body to list available ops):
//
//   READ OPS (no gate):
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
//   WRITE OPS (UUID two-step gate — see "UUID confirmation pattern" below):
//   • test_post_appointment        { body, confirmation_token? }
//   • update_appointment           { appointment_id, body, confirmation_token? }
//   • delete_appointment           { appointment_id, confirmation_token? }
//
// Response shape (always JSON):
//   200 { ok: true,  op, url_called, status, data }
//   4xx { ok: false, op, url_called?, status?, error, body_excerpt? }
//
// UUID confirmation pattern (write ops only):
//   Step 1: caller posts WITHOUT `confirmation_token`. Function previews the
//           outgoing Tekmetric request, generates a UUID, returns:
//             { ok: false, needs_confirmation: true,
//               confirmation_token: <uuid>,
//               would_send: { method, path, body }, expires_at }
//   Step 2: caller posts WITH the same op body AND `confirmation_token: <uuid>`.
//           Function checks (token, body_hash) against an in-memory cache,
//           applies the write, returns the Tekmetric response.
//   Tokens expire after 5 minutes. The body hash is sha256 of the
//   canonicalized request payload — changing the body invalidates the token.
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

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { checkSchedulerBearer, unauthorizedResponse } from "../_shared/scheduler-auth.ts";
import { withSentryScope, Sentry } from "../_shared/sentry-edge.ts";
import { CORS_HEADERS, jsonResponse } from "./config.ts";
import { OP_CATALOG, describeIndex } from "./op-catalog.ts";
import { isObject, handleGetAppointment, handleListAppointments, handleGetCustomer, handleSearchCustomerByPhone, handleGetVehicle, handleListVehiclesForCustomer, handleGetRo, handleListRos, handleListPayments, handleListEmployees, handleListCannedJobs, handleWhoami } from "./read-handlers.ts";
import { handleTestPostAppointment, handleUpdateAppointment, handleDeleteAppointment, handleRawGet } from "./write-handlers.ts";

// ─── HTTP entry ─────────────────────────────────────────────────────────────

// PLAN-02 Phase 1 — per-request Sentry isolation scope + flush before response.
Deno.serve((req) => withSentryScope(req, "tekmetric-api-testing", async () => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Pattern A bearer auth (audit B1 fix, 2026-05-22).
  // Previously verify_jwt=true accepted the publishable anon key — any
  // browser client could POST/PATCH/DELETE Tekmetric appointments. Now
  // operator-only via service-role bearer.
  const auth = checkSchedulerBearer(req, "tekmetric-api-testing");
  if (!auth.ok) {
    return unauthorizedResponse(auth);
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
      case "test_post_appointment":
        return await handleTestPostAppointment(raw);
      case "update_appointment":
        return await handleUpdateAppointment(raw);
      case "delete_appointment":
        return await handleDeleteAppointment(raw);
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
}));
