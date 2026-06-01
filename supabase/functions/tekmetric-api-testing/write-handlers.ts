// write-handlers — tekmetric-api-testing module.
// Extracted from tekmetric-api-testing/index.ts (file-size-refactor). Mechanical split.

import { SHOP_ID, jsonResponse } from "./config.ts";
import { tekmetricCall } from "./call-wrapper.ts";
import { isObject, asNumber, asString } from "./read-handlers.ts";
import { issueToken, consumeToken } from "./confirmation-gate.ts";
import { tekmetricWrite, logTestWrite, writeOpResponse } from "./write-helpers.ts";

// ─── Write op handlers ──────────────────────────────────────────────────────

export async function handleTestPostAppointment(
  args: Record<string, unknown>,
): Promise<Response> {
  if (!isObject(args.body)) {
    return jsonResponse(
      { ok: false, op: "test_post_appointment", error: "missing body object" },
      400,
    );
  }
  const bodyWithShop: Record<string, unknown> = { ...args.body };
  // Always server-derived; never honor a client-supplied shopId.
  bodyWithShop.shopId = SHOP_ID;

  const scope = { op: "test_post_appointment", body: bodyWithShop };
  const incomingToken = asString(args.confirmation_token);

  if (incomingToken === null) {
    const { token, expires_at } = await issueToken(
      scope,
      `POST /appointments — shop ${SHOP_ID}`,
    );
    return jsonResponse(
      {
        ok: false,
        op: "test_post_appointment",
        needs_confirmation: true,
        confirmation_token: token,
        expires_at,
        would_send: { method: "POST", path: "/appointments", body: bodyWithShop },
      },
      200,
    );
  }

  const consume = await consumeToken(incomingToken, scope);
  if (!consume.ok) {
    return jsonResponse(
      { ok: false, op: "test_post_appointment", error: consume.reason },
      400,
    );
  }

  const result = await tekmetricWrite("POST", "/appointments", bodyWithShop);
  await logTestWrite({ op: "test_post_appointment", scope, result });
  return writeOpResponse("test_post_appointment", result);
}

export async function handleUpdateAppointment(
  args: Record<string, unknown>,
): Promise<Response> {
  const appointmentId = asNumber(args.appointment_id);
  if (appointmentId === null) {
    return jsonResponse(
      {
        ok: false,
        op: "update_appointment",
        error: "missing or invalid appointment_id",
      },
      400,
    );
  }
  if (!isObject(args.body)) {
    return jsonResponse(
      { ok: false, op: "update_appointment", error: "missing body object" },
      400,
    );
  }

  const scope = {
    op: "update_appointment",
    appointment_id: appointmentId,
    body: args.body,
  };
  const incomingToken = asString(args.confirmation_token);
  const path = `/appointments/${appointmentId}`;

  if (incomingToken === null) {
    const { token, expires_at } = await issueToken(
      scope,
      `PATCH ${path}`,
    );
    return jsonResponse(
      {
        ok: false,
        op: "update_appointment",
        needs_confirmation: true,
        confirmation_token: token,
        expires_at,
        would_send: { method: "PATCH", path, body: args.body },
      },
      200,
    );
  }

  const consume = await consumeToken(incomingToken, scope);
  if (!consume.ok) {
    return jsonResponse(
      { ok: false, op: "update_appointment", error: consume.reason },
      400,
    );
  }

  const result = await tekmetricWrite("PATCH", path, args.body);
  await logTestWrite({ op: "update_appointment", scope, result });
  return writeOpResponse("update_appointment", result);
}

export async function handleDeleteAppointment(
  args: Record<string, unknown>,
): Promise<Response> {
  const appointmentId = asNumber(args.appointment_id);
  if (appointmentId === null) {
    return jsonResponse(
      {
        ok: false,
        op: "delete_appointment",
        error: "missing or invalid appointment_id",
      },
      400,
    );
  }

  const scope = { op: "delete_appointment", appointment_id: appointmentId };
  const incomingToken = asString(args.confirmation_token);
  const path = `/appointments/${appointmentId}`;

  if (incomingToken === null) {
    const { token, expires_at } = await issueToken(scope, `DELETE ${path}`);
    return jsonResponse(
      {
        ok: false,
        op: "delete_appointment",
        needs_confirmation: true,
        confirmation_token: token,
        expires_at,
        would_send: { method: "DELETE", path },
      },
      200,
    );
  }

  const consume = await consumeToken(incomingToken, scope);
  if (!consume.ok) {
    return jsonResponse(
      { ok: false, op: "delete_appointment", error: consume.reason },
      400,
    );
  }

  const result = await tekmetricWrite("DELETE", path);
  await logTestWrite({ op: "delete_appointment", scope, result });
  return writeOpResponse("delete_appointment", result);
}

export async function handleRawGet(
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
