// scheduler-booking-direct
//
// Deterministic booking-ladder endpoint per the F5-full pattern. Same
// shape as scheduler-step2-direct but covers the rest of the wizard
// (date → time → hold → confirm) without an LLM round-trip.
//
// Why this exists: the scheduler specialist's generateText + Output.object +
// tools path was empirically fragile (Sentry JEFFS-APP-V2-TEST-FUNCTIONS-2,
// 2026-05-13 — orchestrator-direct timed out at 30s on fetch_slots during
// submitDate). The booking ladder is pure data + Tekmetric REST; routing
// through an LLM adds latency, fragility, and no value.
//
// Request:
//   POST / { op: 'list_waiter_times' | 'hold_slot' | 'confirm_booking', ...op-specific fields }
//
// Operations:
//
//   op='list_waiter_times'
//     input:  { session_id, date }
//     output: { ok, op, available_times: string[] }   // ['08:00'] | ['08:00','09:00'] | []
//
//   op='hold_slot'
//     input:  { session_id, date, time?, type: 'waiter'|'dropoff', service_summary,
//               customer_id?, vehicle_id? }
//     output: { ok, op, hold_id, expires_at }
//             or { ok: false, error: 'slot_just_taken' }
//
//   op='confirm_booking'
//     input:  { session_id, hold_id, customer_id?, vehicle_id?, title, description,
//               appointment_option?, new_customer?, new_vehicle? }
//     output: { ok, op, appointment_id, status, start_time, customer_id, vehicle_id }
//
// Auth: same Pattern A bearer as scheduler-step2-direct.

import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { ENV_NAMES } from "../_shared/tekmetric.ts";
import {
  checkSchedulerBearer,
  unauthorizedResponse,
  RESOLVED_SERVICE_ROLE_KEY,
} from "../_shared/scheduler-auth.ts";
import {
  holdAppointmentSlot,
  confirmAppointment,
} from "../_shared/tools/scheduler-slots.ts";
import {
  createNewCustomer,
  createNewVehicle,
} from "../_shared/tools/scheduler-customer.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHOP_ID = parseInt(
  Deno.env.get(ENV_NAMES.TEKMETRIC_SHOP_ID) ?? "7476",
  10,
);

const sb = createClient(SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY, {
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

interface ListWaiterTimesInput {
  op: "list_waiter_times";
  session_id: string;
  date: string; // YYYY-MM-DD
}

interface HoldSlotInput {
  op: "hold_slot";
  session_id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM (required for waiter)
  type: "waiter" | "dropoff";
  service_summary: string;
  customer_id?: number;
  vehicle_id?: number;
}

interface NewCustomerPayload {
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

interface NewVehiclePayload {
  year: number;
  make: string;
  model: string;
  sub_model?: string;
  vin?: string;
  license_plate?: string;
  color?: string;
}

interface ConfirmBookingInput {
  op: "confirm_booking";
  session_id: string;
  hold_id: string;
  customer_id?: number;
  vehicle_id?: number;
  title: string;
  description: string;
  appointment_option?: "WAITER" | "PICKUP_DROPOFF" | "TOWED" | "NONE";
  new_customer?: NewCustomerPayload;
  new_vehicle?: NewVehiclePayload;
}

type RequestBody = ListWaiterTimesInput | HoldSlotInput | ConfirmBookingInput;

function parseBody(raw: unknown):
  | { ok: true; input: RequestBody }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.session_id !== "string" || !r.session_id) {
    return { ok: false, error: "session_id required" };
  }
  if (r.op === "list_waiter_times") {
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      return { ok: false, error: "date required (YYYY-MM-DD)" };
    }
    return {
      ok: true,
      input: { op: "list_waiter_times", session_id: r.session_id, date: r.date },
    };
  }
  if (r.op === "hold_slot") {
    if (typeof r.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      return { ok: false, error: "date required (YYYY-MM-DD)" };
    }
    if (r.type !== "waiter" && r.type !== "dropoff") {
      return { ok: false, error: "type must be 'waiter' or 'dropoff'" };
    }
    if (r.type === "waiter" && (typeof r.time !== "string" || !/^\d{2}:\d{2}$/.test(r.time))) {
      return { ok: false, error: "time required for waiter (HH:MM)" };
    }
    if (typeof r.service_summary !== "string") {
      return { ok: false, error: "service_summary required" };
    }
    return {
      ok: true,
      input: {
        op: "hold_slot",
        session_id: r.session_id,
        date: r.date,
        time: typeof r.time === "string" ? r.time : undefined,
        type: r.type,
        service_summary: r.service_summary,
        customer_id:
          typeof r.customer_id === "number" ? r.customer_id : undefined,
        vehicle_id:
          typeof r.vehicle_id === "number" ? r.vehicle_id : undefined,
      },
    };
  }
  if (r.op === "confirm_booking") {
    if (typeof r.hold_id !== "string" || !r.hold_id) {
      return { ok: false, error: "hold_id required" };
    }
    if (typeof r.title !== "string") {
      return { ok: false, error: "title required" };
    }
    if (typeof r.description !== "string") {
      return { ok: false, error: "description required" };
    }
    return {
      ok: true,
      input: {
        op: "confirm_booking",
        session_id: r.session_id,
        hold_id: r.hold_id,
        customer_id:
          typeof r.customer_id === "number" ? r.customer_id : undefined,
        vehicle_id:
          typeof r.vehicle_id === "number" ? r.vehicle_id : undefined,
        title: r.title,
        description: r.description,
        appointment_option:
          r.appointment_option === "WAITER" ||
          r.appointment_option === "PICKUP_DROPOFF" ||
          r.appointment_option === "TOWED" ||
          r.appointment_option === "NONE"
            ? r.appointment_option
            : undefined,
        new_customer: (r.new_customer ?? undefined) as
          | NewCustomerPayload
          | undefined,
        new_vehicle: (r.new_vehicle ?? undefined) as
          | NewVehiclePayload
          | undefined,
      },
    };
  }
  return {
    ok: false,
    error: "op must be 'list_waiter_times' | 'hold_slot' | 'confirm_booking'",
  };
}

// Compute the available waiter times for `date` by reading
// appointment_default_limits.waiter_8am_slots + waiter_9am_slots − active
// holds for that date+time. Skips Tekmetric pre-check (the hold RPC's
// UNIQUE constraint handles the race + daily-cap floor). This is
// "best-effort" availability; the hold RPC is the source of truth for
// race resolution.
async function listWaiterTimes(date: string): Promise<string[]> {
  // day_of_week: 0=Sun, 1=Mon, ..., 6=Sat (matches appointment_default_limits)
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();

  const { data: limit, error: limitErr } = await sb
    .from("appointment_default_limits")
    .select("waiter_8am_slots, waiter_9am_slots, is_closed")
    .eq("shop_id", SHOP_ID)
    .eq("day_of_week", dow)
    .maybeSingle();
  if (limitErr) {
    throw new Error(`limits read failed: ${limitErr.message}`);
  }
  if (!limit || limit.is_closed) {
    return [];
  }

  // Count active holds for each time slot on this date.
  const nowIso = new Date().toISOString();
  const { data: holds, error: holdsErr } = await sb
    .from("appointment_holds")
    .select("scheduled_time")
    .eq("shop_id", SHOP_ID)
    .eq("scheduled_date", date)
    .eq("appointment_type", "waiter")
    .is("released_at", null)
    .gt("expires_at", nowIso);
  if (holdsErr) {
    throw new Error(`holds read failed: ${holdsErr.message}`);
  }
  let holds8 = 0;
  let holds9 = 0;
  for (const h of holds ?? []) {
    const t = String(h.scheduled_time ?? "").slice(0, 5);
    if (t === "08:00") holds8 += 1;
    if (t === "09:00") holds9 += 1;
  }

  // Also count existing confirmed appointments on this date+slot.
  const dayStart = `${date}T00:00:00-04:00`;
  const dayEnd = `${date}T23:59:59-04:00`;
  const { data: appts, error: apptsErr } = await sb
    .from("appointments")
    .select("start_time, appointment_status")
    .eq("shop_id", SHOP_ID)
    .gte("start_time", dayStart)
    .lte("start_time", dayEnd)
    .is("deleted_at", null);
  if (apptsErr) {
    throw new Error(`appointments read failed: ${apptsErr.message}`);
  }
  let appts8 = 0;
  let appts9 = 0;
  for (const a of appts ?? []) {
    const st = a.start_time as string;
    if (a.appointment_status === "CANCELED" || a.appointment_status === "NO_SHOW") {
      continue;
    }
    // Compare local time component — Tekmetric times in EDT.
    if (!st) continue;
    const hour = new Date(st).getUTCHours();
    // 8 AM EDT = 12 UTC; 9 AM EDT = 13 UTC (during DST).
    if (hour === 12) appts8 += 1;
    if (hour === 13) appts9 += 1;
  }

  const available: string[] = [];
  const cap8 = Number(limit.waiter_8am_slots ?? 0);
  const cap9 = Number(limit.waiter_9am_slots ?? 0);
  if (cap8 > 0 && holds8 + appts8 < cap8) available.push("08:00");
  if (cap9 > 0 && holds9 + appts9 < cap9) available.push("09:00");
  return available;
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "POST only" }, 405);
  }

  const authCheck = checkSchedulerBearer(req, "scheduler-booking-direct");
  if (!authCheck.ok) {
    return unauthorizedResponse(authCheck);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
  }
  const parse = parseBody(raw);
  if (!parse.ok) {
    return jsonResponse({ ok: false, error: parse.error }, 400);
  }
  const input = parse.input;
  const startedAt = Date.now();

  try {
    if (input.op === "list_waiter_times") {
      const available_times = await listWaiterTimes(input.date);
      return jsonResponse({
        ok: true,
        op: "list_waiter_times",
        available_times,
        meta: { latency_ms: Date.now() - startedAt },
      });
    }

    if (input.op === "hold_slot") {
      try {
        const { hold_id, expires_at } = await holdAppointmentSlot(sb, SHOP_ID, {
          session_id: input.session_id,
          customer_id: input.customer_id,
          vehicle_id: input.vehicle_id,
          date: input.date,
          time: input.time,
          type: input.type,
          service_summary: input.service_summary,
        });
        // Persist hold_token on the chat session so confirm-time can reload it.
        await sb
          .from("customer_chat_sessions")
          .update({
            hold_token: hold_id,
            last_active_at: new Date().toISOString(),
          })
          .eq("id", input.session_id);
        return jsonResponse({
          ok: true,
          op: "hold_slot",
          hold_id,
          expires_at,
          meta: { latency_ms: Date.now() - startedAt },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "slot_just_taken") {
          return jsonResponse({
            ok: false,
            op: "hold_slot",
            error: "slot_just_taken",
            meta: { latency_ms: Date.now() - startedAt },
          });
        }
        throw e;
      }
    }

    if (input.op === "confirm_booking") {
      let customerId = input.customer_id ?? null;
      let vehicleId = input.vehicle_id ?? null;

      // New-customer path: create Tekmetric customer + vehicle before confirm.
      if (!customerId && input.new_customer) {
        const created = await createNewCustomer(sb, SHOP_ID, {
          first_name: input.new_customer.first_name,
          last_name: input.new_customer.last_name,
          phone_e164: input.new_customer.phone_e164,
          email: input.new_customer.email,
          address: input.new_customer.address,
        });
        customerId = created.customer_id;
      }
      if (!customerId) {
        return jsonResponse({
          ok: false,
          op: "confirm_booking",
          error: "missing_customer_id_and_new_customer_data",
        }, 400);
      }
      if (!vehicleId && input.new_vehicle) {
        const createdVeh = await createNewVehicle(sb, SHOP_ID, {
          customer_id: customerId,
          year: input.new_vehicle.year,
          make: input.new_vehicle.make,
          model: input.new_vehicle.model,
          sub_model: input.new_vehicle.sub_model,
          vin: input.new_vehicle.vin,
          license_plate: input.new_vehicle.license_plate,
          color: input.new_vehicle.color,
        });
        vehicleId = createdVeh.vehicle_id;
      }
      if (!vehicleId) {
        return jsonResponse({
          ok: false,
          op: "confirm_booking",
          error: "missing_vehicle_id_and_new_vehicle_data",
        }, 400);
      }

      // Persist resolved IDs onto the session so downstream readers find them.
      await sb
        .from("customer_chat_sessions")
        .update({
          customer_id: customerId,
          vehicle_id: vehicleId,
          last_active_at: new Date().toISOString(),
        })
        .eq("id", input.session_id);

      const result = await confirmAppointment(sb, SHOP_ID, {
        hold_id: input.hold_id,
        customer_id: customerId,
        vehicle_id: vehicleId,
        title: input.title,
        description: input.description,
        appointment_option: input.appointment_option,
      });

      return jsonResponse({
        ok: true,
        op: "confirm_booking",
        appointment_id: result.appointment_id,
        status: result.status,
        start_time: result.start_time,
        customer_id: customerId,
        vehicle_id: vehicleId,
        meta: { latency_ms: Date.now() - startedAt },
      });
    }

    return jsonResponse({ ok: false, error: "unreachable" }, 500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      JSON.stringify({
        level: "error",
        msg: "booking_direct_unhandled",
        op: input.op,
        detail: msg,
      }),
    );
    return jsonResponse(
      {
        ok: false,
        op: input.op,
        error: msg,
        meta: { latency_ms: Date.now() - startedAt },
      },
      500,
    );
  }
}

Deno.serve(handleRequest);
