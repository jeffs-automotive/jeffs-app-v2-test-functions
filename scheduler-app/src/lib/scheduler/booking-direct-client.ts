/**
 * Client wrapper for the scheduler-booking-direct Supabase Edge Function.
 *
 * This is the DETERMINISTIC replacement for the LLM-based orchestrator
 * path on the booking ladder (date → time → hold → confirm) per the
 * F5-full pattern. The scheduler specialist's generateText + Output.object +
 * tools path was empirically fragile (Sentry JEFFS-APP-V2-TEST-FUNCTIONS-2
 * 2026-05-13: orchestrator-direct timed out at 30s on fetch_slots during
 * submitDate; appointment_type call earlier silently returned
 * directive_parse_failed). This client routes those same operations
 * through a pure Tekmetric REST + Postgres RPC path inside the
 * scheduler-booking-direct edge function — no LLM hop.
 *
 * Same auth pattern as scheduler-step2-direct (Pattern A bearer +
 * apikey). 30s timeout matches the prior client's headroom.
 */

import { resolveServiceRoleKey } from "@/lib/supabase/resolve-keys";

export type BookingDirectOp =
  | "list_waiter_times"
  | "hold_slot"
  | "confirm_booking"
  | "create_customer"
  | "create_vehicle";

export interface ListWaiterTimesRequest {
  op: "list_waiter_times";
  session_id: string;
  date: string; // YYYY-MM-DD
}

export interface ListWaiterTimesResponse {
  ok: true;
  op: "list_waiter_times";
  available_times: string[]; // ['08:00'] | ['08:00','09:00'] | []
  meta?: { latency_ms?: number };
}

export interface HoldSlotRequest {
  op: "hold_slot";
  session_id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM (required for waiter)
  type: "waiter" | "dropoff";
  service_summary: string;
  customer_id?: number;
  vehicle_id?: number;
}

export interface HoldSlotResponse {
  ok: boolean;
  op: "hold_slot";
  hold_id?: string;
  expires_at?: string;
  error?: string; // 'slot_just_taken' | etc.
  meta?: { latency_ms?: number };
}

export interface NewCustomerPayload {
  first_name: string;
  last_name: string;
  phone_e164: string;
  email?: string;
  address?: {
    streetAddress?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}

export interface NewVehiclePayload {
  year: number;
  make: string;
  model: string;
  sub_model?: string;
  vin?: string;
  license_plate?: string;
  color?: string;
}

export interface ConfirmBookingRequest {
  op: "confirm_booking";
  session_id: string;
  hold_id: string;
  /** REQUIRED — created at Step 4 (new client) or already on row (returning). */
  customer_id: number;
  /** REQUIRED — created at Step 5 (new) or Step 6 (returning add or pick). */
  vehicle_id: number;
  title: string;
  description: string;
  appointment_option?: "WAITER" | "PICKUP_DROPOFF" | "TOWED" | "NONE";
}

export interface ConfirmBookingResponse {
  ok: boolean;
  op: "confirm_booking";
  appointment_id?: number;
  status?: string;
  start_time?: string;
  customer_id?: number;
  vehicle_id?: number;
  error?: string;
  meta?: { latency_ms?: number };
}

export interface CreateCustomerRequest {
  op: "create_customer";
  session_id: string;
  payload: NewCustomerPayload;
}

export interface CreateCustomerResponse {
  ok: boolean;
  op: "create_customer";
  customer_id?: number;
  /** One of: 'phone_duplicate' | 'tekmetric_4xx' | 'tekmetric_5xx'. */
  error?: string;
  tekmetric_error_text?: string;
  meta?: { latency_ms?: number };
}

export interface CreateVehicleRequest {
  op: "create_vehicle";
  session_id: string;
  customer_id: number;
  payload: NewVehiclePayload;
}

export interface CreateVehicleResponse {
  ok: boolean;
  op: "create_vehicle";
  vehicle_id?: number;
  error?: string;
  tekmetric_error_text?: string;
  meta?: { latency_ms?: number };
}

export type BookingDirectRequest =
  | ListWaiterTimesRequest
  | HoldSlotRequest
  | ConfirmBookingRequest
  | CreateCustomerRequest
  | CreateVehicleRequest;

export type BookingDirectResponse =
  | ListWaiterTimesResponse
  | HoldSlotResponse
  | ConfirmBookingResponse
  | CreateCustomerResponse
  | CreateVehicleResponse;

export class BookingDirectError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BookingDirectError";
  }
}

function bookingDirectUrl(): string {
  const orchestratorUrl = process.env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    throw new BookingDirectError(
      "Missing ORCHESTRATOR_URL env var — needed to derive the booking endpoint.",
    );
  }
  return orchestratorUrl.replace(
    /\/[^/]+\/?$/,
    "/scheduler-booking-direct",
  );
}

async function call(req: BookingDirectRequest): Promise<BookingDirectResponse> {
  const url = bookingDirectUrl();
  const secretKey = resolveServiceRoleKey();
  if (!secretKey) {
    throw new BookingDirectError(
      "Missing service-role bearer (SUPABASE_SECRET_KEYS / SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY).",
    );
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        apikey: secretKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
      // Slightly higher than the orchestrator client because confirm_booking
      // chains 2-3 Tekmetric REST calls (create_customer + create_vehicle +
      // confirm_appointment) on the new-customer path. Each is ~1-2 s.
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    throw new BookingDirectError(
      `Network error calling scheduler-booking-direct (op=${req.op})`,
      undefined,
      e,
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "<unreadable body>");
    throw new BookingDirectError(
      `scheduler-booking-direct returned ${res.status}: ${text}`,
      res.status,
    );
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (e) {
    throw new BookingDirectError(
      "scheduler-booking-direct returned non-JSON body",
      res.status,
      e,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("op" in (parsed as Record<string, unknown>))
  ) {
    throw new BookingDirectError(
      "scheduler-booking-direct response missing `op` field",
      res.status,
    );
  }

  return parsed as BookingDirectResponse;
}

export async function listWaiterTimes(
  req: ListWaiterTimesRequest,
): Promise<ListWaiterTimesResponse> {
  const r = await call(req);
  if (r.op !== "list_waiter_times") {
    throw new BookingDirectError(
      `scheduler-booking-direct returned wrong op (${r.op}) for list_waiter_times`,
    );
  }
  return r;
}

export async function holdSlot(
  req: HoldSlotRequest,
): Promise<HoldSlotResponse> {
  const r = await call(req);
  if (r.op !== "hold_slot") {
    throw new BookingDirectError(
      `scheduler-booking-direct returned wrong op (${r.op}) for hold_slot`,
    );
  }
  return r;
}

export async function confirmBooking(
  req: ConfirmBookingRequest,
): Promise<ConfirmBookingResponse> {
  const r = await call(req);
  if (r.op !== "confirm_booking") {
    throw new BookingDirectError(
      `scheduler-booking-direct returned wrong op (${r.op}) for confirm_booking`,
    );
  }
  return r;
}

export async function createCustomer(
  req: CreateCustomerRequest,
): Promise<CreateCustomerResponse> {
  const r = await call(req);
  if (r.op !== "create_customer") {
    throw new BookingDirectError(
      `scheduler-booking-direct returned wrong op (${r.op}) for create_customer`,
    );
  }
  return r;
}

export async function createVehicle(
  req: CreateVehicleRequest,
): Promise<CreateVehicleResponse> {
  const r = await call(req);
  if (r.op !== "create_vehicle") {
    throw new BookingDirectError(
      `scheduler-booking-direct returned wrong op (${r.op}) for create_vehicle`,
    );
  }
  return r;
}
