// op-catalog — tekmetric-api-testing module.
// Extracted from tekmetric-api-testing/index.ts (file-size-refactor). Mechanical split.

import { SHOP_ID } from "./config.ts";

// ─── Op catalog ─────────────────────────────────────────────────────────────

interface OpDescriptor {
  op: string;
  description: string;
  args: Record<string, string>;
  example: Record<string, unknown>;
}

export const OP_CATALOG: OpDescriptor[] = [
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
  {
    op: "test_post_appointment",
    description:
      "POST /appointments — UUID two-step gate. Step 1 (no confirmation_token): preview + get token. Step 2 (with token + same body): apply. `shopId` auto-added when absent. Empirical enum: appointmentOption=1 is waiter (STAY), 2 is dropoff (DROP). status / confirmationStatus are bare strings.",
    args: {
      body: "object (required, the appointment payload — see appointment-post.md)",
      confirmation_token: "uuid (omit on step 1)",
    },
    example: {
      op: "test_post_appointment",
      body: {
        customerId: 44698535,
        vehicleId: 0,
        startTime: "2026-12-15T13:00:00Z",
        endTime: "2026-12-15T14:00:00Z",
        title: "[TM] Test Booking — appointmentOption probe",
        description: "Test booking — please ignore or cancel.",
        appointmentOption: 1,
        color: "red",
      },
    },
  },
  {
    op: "update_appointment",
    description:
      "PATCH /appointments/{id} — UUID two-step gate. Use to flip an appointment to status=CANCELED after a test, or to test confirmationStatus acceptance, etc.",
    args: {
      appointment_id: "number (required)",
      body: "object (required, partial update — only fields to change)",
      confirmation_token: "uuid (omit on step 1)",
    },
    example: {
      op: "update_appointment",
      appointment_id: 12345678,
      body: { status: "CANCELED" },
    },
  },
  {
    op: "delete_appointment",
    description:
      "DELETE /appointments/{id} — UUID two-step gate. Hard delete; status=CANCELED via update_appointment is the softer alternative.",
    args: {
      appointment_id: "number (required)",
      confirmation_token: "uuid (omit on step 1)",
    },
    example: { op: "delete_appointment", appointment_id: 12345678 },
  },
];

export function describeIndex(): Record<string, unknown> {
  return {
    ok: true,
    op: "index",
    description:
      "tekmetric-api-testing — read + (gated) write probe surface. See the OP_CATALOG entries below for available ops.",
    shop_id: SHOP_ID,
    op_catalog: OP_CATALOG,
  };
}
