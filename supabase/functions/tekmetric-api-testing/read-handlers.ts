// read-handlers — tekmetric-api-testing module.
// Extracted from tekmetric-api-testing/index.ts (file-size-refactor). Mechanical split.

import { SHOP_ID, jsonResponse } from "./config.ts";
import { tekmetricCall } from "./call-wrapper.ts";

// ─── Op dispatchers ─────────────────────────────────────────────────────────

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function handleGetAppointment(
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

export async function handleListAppointments(
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

export async function handleGetCustomer(
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

export async function handleSearchCustomerByPhone(
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

export async function handleGetVehicle(
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

export async function handleListVehiclesForCustomer(
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

export async function handleGetRo(
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

export async function handleListRos(
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

export async function handleListPayments(
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

export async function handleListEmployees(
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

export async function handleListCannedJobs(
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

export async function handleWhoami(): Promise<Response> {
  // /shops/{id} is a cheap auth-validation call.
  const result = await tekmetricCall(`/shops/${SHOP_ID}`);
  return jsonResponse({ ok: result.status < 400, op: "whoami", ...result });
}
