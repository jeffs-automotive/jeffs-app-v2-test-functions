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
  appendAppointmentDescription,
} from "../_shared/tools/scheduler-slots.ts";
import {
  createNewCustomer,
  createNewVehicle,
  lookupVehiclesForCustomer,
  patchCustomer,
} from "../_shared/tools/scheduler-customer.ts";
import { logEdgeError } from "../_shared/log-edge-error.ts";

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
    // R4-IMPORTANT-B-2 2026-05-16: prior shape declared `streetAddress` but
    // the helper + Vercel-side client both use address1/address2. The cast
    // at parseBody was a TS no-op so the runtime worked, but the interface
    // was misleading drift waiting to bite a future refactor.
    address1?: string;
    address2?: string;
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
  customer_id: number;
  vehicle_id: number;
  title: string;
  description: string;
  /**
   * Phase 12 2026-05-16: replaces the unused appointment_option field.
   * Color is the staff-facing channel in the Tekmetric calendar
   * ("red" = waiter, "navy" = dropoff). See appointment-post.md
   * Empirical findings section.
   */
  color?: string;
}

interface CreateCustomerInput {
  op: "create_customer";
  session_id: string;
  payload: NewCustomerPayload;
}

interface CreateVehicleInput {
  op: "create_vehicle";
  session_id: string;
  customer_id: number;
  payload: NewVehiclePayload;
}

interface PatchCustomerInput {
  op: "patch_customer";
  session_id: string;
  customer_id: number;
  edited_phones?: Array<{ phone_e164: string; is_primary: boolean }>;
  edited_emails?: Array<{ email: string; is_primary: boolean }>;
  edited_address?: {
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
}

interface FetchVehiclesInput {
  op: "fetch_vehicles_for_customer";
  session_id: string;
  customer_id: number;
}

interface AppendDescriptionInput {
  op: "append_appointment_description";
  session_id: string;
  appointment_id: number;
  append_text: string;
}

type RequestBody =
  | ListWaiterTimesInput
  | HoldSlotInput
  | ConfirmBookingInput
  | CreateCustomerInput
  | CreateVehicleInput
  | PatchCustomerInput
  | FetchVehiclesInput
  | AppendDescriptionInput;

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
    // Per chat-design.md §10 and the New Client flow §2589-2755, the
    // customer + vehicle MUST already exist in Tekmetric by the time
    // we hit confirm_booking — created at Step 4 (new client) /
    // Step 5 (new vehicle) / Step 6 (vehicle picker add-new). This op
    // no longer accepts new_customer / new_vehicle payloads.
    if (typeof r.customer_id !== "number") {
      return {
        ok: false,
        error: "customer_id required (must be created at Step 4 before confirm)",
      };
    }
    if (typeof r.vehicle_id !== "number") {
      return {
        ok: false,
        error: "vehicle_id required (must be created at Step 5/6 before confirm)",
      };
    }
    return {
      ok: true,
      input: {
        op: "confirm_booking",
        session_id: r.session_id,
        hold_id: r.hold_id,
        customer_id: r.customer_id,
        vehicle_id: r.vehicle_id,
        title: r.title,
        description: r.description,
        color: typeof r.color === "string" && r.color.length > 0
          ? r.color
          : undefined,
      },
    };
  }
  if (r.op === "create_customer") {
    if (!r.payload || typeof r.payload !== "object") {
      return { ok: false, error: "payload required (new customer fields)" };
    }
    const p = r.payload as Record<string, unknown>;
    if (typeof p.first_name !== "string" || !p.first_name) {
      return { ok: false, error: "payload.first_name required" };
    }
    if (typeof p.last_name !== "string" || !p.last_name) {
      return { ok: false, error: "payload.last_name required" };
    }
    if (typeof p.phone_e164 !== "string" || !/^\+1\d{10}$/.test(p.phone_e164)) {
      return { ok: false, error: "payload.phone_e164 required (+1XXXXXXXXXX)" };
    }
    return {
      ok: true,
      input: {
        op: "create_customer",
        session_id: r.session_id,
        payload: {
          first_name: p.first_name,
          last_name: p.last_name,
          phone_e164: p.phone_e164,
          email: typeof p.email === "string" ? p.email : undefined,
          address:
            p.address && typeof p.address === "object"
              ? (p.address as NewCustomerPayload["address"])
              : undefined,
        },
      },
    };
  }
  if (r.op === "create_vehicle") {
    if (typeof r.customer_id !== "number") {
      return { ok: false, error: "customer_id required" };
    }
    if (!r.payload || typeof r.payload !== "object") {
      return { ok: false, error: "payload required (new vehicle fields)" };
    }
    const p = r.payload as Record<string, unknown>;
    if (typeof p.year !== "number" || !Number.isFinite(p.year)) {
      return { ok: false, error: "payload.year required (number)" };
    }
    if (typeof p.make !== "string" || !p.make) {
      return { ok: false, error: "payload.make required" };
    }
    if (typeof p.model !== "string" || !p.model) {
      return { ok: false, error: "payload.model required" };
    }
    return {
      ok: true,
      input: {
        op: "create_vehicle",
        session_id: r.session_id,
        customer_id: r.customer_id,
        payload: {
          year: p.year,
          make: p.make,
          model: p.model,
          sub_model:
            typeof p.sub_model === "string" ? p.sub_model : undefined,
          vin: typeof p.vin === "string" ? p.vin : undefined,
          license_plate:
            typeof p.license_plate === "string" ? p.license_plate : undefined,
          color: typeof p.color === "string" ? p.color : undefined,
        },
      },
    };
  }
  if (r.op === "fetch_vehicles_for_customer") {
    if (typeof r.customer_id !== "number") {
      return { ok: false, error: "customer_id required" };
    }
    return {
      ok: true,
      input: {
        op: "fetch_vehicles_for_customer",
        session_id: r.session_id,
        customer_id: r.customer_id,
      },
    };
  }
  if (r.op === "append_appointment_description") {
    if (typeof r.appointment_id !== "number") {
      return { ok: false, error: "appointment_id required (number)" };
    }
    if (typeof r.append_text !== "string" || !r.append_text.trim()) {
      return { ok: false, error: "append_text required (non-empty string)" };
    }
    return {
      ok: true,
      input: {
        op: "append_appointment_description",
        session_id: r.session_id,
        appointment_id: r.appointment_id,
        append_text: r.append_text,
      },
    };
  }
  if (r.op === "patch_customer") {
    if (typeof r.customer_id !== "number") {
      return { ok: false, error: "customer_id required" };
    }
    // Per chat-design.md §Step 5 (lines 1029-1057): the Server Action sends
    // the FULL phone array on every PATCH (omitting an entry deletes it
    // from Tekmetric). Either phones, emails, or address must be present —
    // an op with all three null is a no-op the caller should have skipped.
    const phonesProvided = Array.isArray(r.edited_phones);
    const emailsProvided = Array.isArray(r.edited_emails);
    const addressProvided =
      r.edited_address !== undefined && r.edited_address !== null;
    if (!phonesProvided && !emailsProvided && !addressProvided) {
      return {
        ok: false,
        error: "patch_customer: at least one of edited_phones / edited_emails / edited_address must be provided",
      };
    }
    return {
      ok: true,
      input: {
        op: "patch_customer",
        session_id: r.session_id,
        customer_id: r.customer_id,
        edited_phones: phonesProvided
          ? (r.edited_phones as Array<{ phone_e164: string; is_primary: boolean }>)
          : undefined,
        edited_emails: emailsProvided
          ? (r.edited_emails as Array<{ email: string; is_primary: boolean }>)
          : undefined,
        edited_address: addressProvided
          ? (r.edited_address as PatchCustomerInput["edited_address"])
          : undefined,
      },
    };
  }
  return {
    ok: false,
    error:
      "op must be 'list_waiter_times' | 'hold_slot' | 'confirm_booking' | 'create_customer' | 'create_vehicle' | 'patch_customer' | 'fetch_vehicles_for_customer' | 'append_appointment_description'",
  };
}

// Compute the available waiter times for `date` by reading
// appointment_default_limits.waiter_8am_slots + waiter_9am_slots − active
// holds for that date+time. Skips Tekmetric pre-check (the hold RPC's
// UNIQUE constraint handles the race + daily-cap floor). This is
// "best-effort" availability; the hold RPC is the source of truth for
// race resolution.
//
// Timezone: appointments.start_time is TIMESTAMPTZ stored in UTC. Shop is
// in America/New_York. We extract shop-local hour via Intl.DateTimeFormat
// so EDT (UTC-4) and EST (UTC-5) both work correctly — 8 AM shop-local is
// 12 UTC in summer and 13 UTC in winter. Don't rely on a fixed offset.
const SHOP_TIMEZONE = "America/New_York"; // Phase 1 single-shop

function shopLocalDateAndHour(
  isoUtc: string,
): { date: string; hour: number } {
  const d = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) =>
    parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: parseInt(get("hour"), 10),
  };
}

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

  // Count existing confirmed appointments on this date+slot. Query a 1-day
  // buffer on each side in UTC, then filter by shop-local date in JS —
  // avoids miscounting at DST boundaries when a shop-local day's UTC bounds
  // shift by an hour.
  const dayBefore = new Date(`${date}T00:00:00Z`);
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const dayAfter = new Date(`${date}T00:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 2);

  const { data: appts, error: apptsErr } = await sb
    .from("appointments")
    .select("start_time, appointment_status")
    .eq("shop_id", SHOP_ID)
    .gte("start_time", dayBefore.toISOString())
    .lt("start_time", dayAfter.toISOString())
    .is("deleted_at", null);
  if (apptsErr) {
    throw new Error(`appointments read failed: ${apptsErr.message}`);
  }
  let appts8 = 0;
  let appts9 = 0;
  for (const a of appts ?? []) {
    if (
      a.appointment_status === "CANCELED" ||
      a.appointment_status === "NO_SHOW"
    ) {
      continue;
    }
    const st = a.start_time as string | null;
    if (!st) continue;
    const { date: apptDate, hour } = shopLocalDateAndHour(st);
    if (apptDate !== date) continue; // outside target shop-local day
    if (hour === 8) appts8 += 1;
    if (hour === 9) appts9 += 1;
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

    if (input.op === "create_customer") {
      // Per chat-design.md §2638-§2682 (New Client Step 4): Server Action
      // calls Tekmetric POST /customers IMMEDIATELY on form submit. Caller
      // (submitNewCustomerInfo) handles row persistence + error routing.
      //
      // Failure-mode policy per spec §2651-§2654:
      //   - 5xx → retry once with 1s backoff (handled by Server Action's
      //     consumer of this response — we just return ok:false on second
      //     failure here)
      //   - 4xx (validation) → ok:false with the Tekmetric error text
      //   - 409 phone-duplicate → ok:false + error tag 'phone_duplicate'
      //     so the Server Action can route back to Step 1 returning flow
      let result: { customer_id: number };
      try {
        result = await createNewCustomer(sb, SHOP_ID, {
          first_name: input.payload.first_name,
          last_name: input.payload.last_name,
          phone_e164: input.payload.phone_e164,
          email: input.payload.email,
          address: input.payload.address,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // Tekmetric 409 body includes "Customer(s) with the same email
        // and/or phone exist" — surface as a structured error tag.
        if (msg.includes("HTTP 409") || msg.includes("same email and/or phone")) {
          return jsonResponse({
            ok: false,
            op: "create_customer",
            error: "phone_duplicate",
            tekmetric_error_text: msg.slice(0, 500),
            meta: { latency_ms: Date.now() - startedAt },
          });
        }
        // 4xx validation
        if (/HTTP 4\d\d/.test(msg)) {
          return jsonResponse({
            ok: false,
            op: "create_customer",
            error: "tekmetric_4xx",
            tekmetric_error_text: msg.slice(0, 500),
            meta: { latency_ms: Date.now() - startedAt },
          });
        }
        // 5xx / network — bubble up as tekmetric_5xx
        return jsonResponse({
          ok: false,
          op: "create_customer",
          error: "tekmetric_5xx",
          tekmetric_error_text: msg.slice(0, 500),
          meta: { latency_ms: Date.now() - startedAt },
        });
      }

      // Persist the new customer_id + verification level onto the row.
      await sb
        .from("customer_chat_sessions")
        .update({
          customer_id: result.customer_id,
          identity_verification_level: "full",
          last_active_at: new Date().toISOString(),
        })
        .eq("id", input.session_id);

      return jsonResponse({
        ok: true,
        op: "create_customer",
        customer_id: result.customer_id,
        meta: { latency_ms: Date.now() - startedAt },
      });
    }

    if (input.op === "create_vehicle") {
      // Per chat-design.md §2712-§2752 (New Client Step 5) and §1285-§1306
      // (Returning Client Step 6 add-new drill-down): Server Action calls
      // Tekmetric POST /vehicles IMMEDIATELY on form submit.
      let result: { vehicle_id: number };
      try {
        result = await createNewVehicle(sb, SHOP_ID, {
          customer_id: input.customer_id,
          year: input.payload.year,
          make: input.payload.make,
          model: input.payload.model,
          sub_model: input.payload.sub_model,
          vin: input.payload.vin,
          license_plate: input.payload.license_plate,
          color: input.payload.color,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/HTTP 4\d\d/.test(msg)) {
          return jsonResponse({
            ok: false,
            op: "create_vehicle",
            error: "tekmetric_4xx",
            tekmetric_error_text: msg.slice(0, 500),
            meta: { latency_ms: Date.now() - startedAt },
          });
        }
        return jsonResponse({
          ok: false,
          op: "create_vehicle",
          error: "tekmetric_5xx",
          tekmetric_error_text: msg.slice(0, 500),
          meta: { latency_ms: Date.now() - startedAt },
        });
      }

      // Persist the new vehicle_id onto the row.
      await sb
        .from("customer_chat_sessions")
        .update({
          vehicle_id: result.vehicle_id,
          last_active_at: new Date().toISOString(),
        })
        .eq("id", input.session_id);

      return jsonResponse({
        ok: true,
        op: "create_vehicle",
        vehicle_id: result.vehicle_id,
        meta: { latency_ms: Date.now() - startedAt },
      });
    }

    if (input.op === "fetch_vehicles_for_customer") {
      // Step 6 vehicle picker — fetch the customer's current Tekmetric
      // vehicle list. Fail-soft on Tekmetric error so the page can still
      // render with allow_add_new=true and zero vehicles.
      try {
        const result = await lookupVehiclesForCustomer(
          sb,
          SHOP_ID,
          input.customer_id,
        );
        return jsonResponse({
          ok: true,
          op: "fetch_vehicles_for_customer",
          vehicles: result.vehicles.map((v) => ({
            id: v.id,
            year: v.year ?? null,
            make: v.make ?? null,
            model: v.model ?? null,
            sub_model: v.subModel ?? null,
            license_plate: v.licensePlate ?? null,
            color: v.color ?? null,
          })),
          meta: { latency_ms: Date.now() - startedAt },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          JSON.stringify({
            level: "warn",
            msg: "fetch_vehicles_for_customer_failed",
            customer_id: input.customer_id,
            detail: msg,
          }),
        );
        return jsonResponse({
          ok: false,
          op: "fetch_vehicles_for_customer",
          error: /HTTP 4\d\d/.test(msg) ? "tekmetric_4xx" : "tekmetric_5xx",
          tekmetric_error_text: msg.slice(0, 500),
          meta: { latency_ms: Date.now() - startedAt },
        });
      }
    }

    if (input.op === "patch_customer") {
      // Step 5 returning-customer info-edit. Per chat-design.md §Step 5
      // (lines 1029-1057): always send the FULL phone array (omission =
      // delete from Tekmetric). The Deno helper handles existing-entry id
      // round-trip + the email/address single-line concat per Tekmetric's
      // contract.
      try {
        await patchCustomer(sb, SHOP_ID, {
          customer_id: input.customer_id,
          edited_phones: input.edited_phones,
          edited_emails: input.edited_emails,
          edited_address: input.edited_address,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/HTTP 4\d\d/.test(msg)) {
          return jsonResponse({
            ok: false,
            op: "patch_customer",
            error: "tekmetric_4xx",
            tekmetric_error_text: msg.slice(0, 500),
            meta: { latency_ms: Date.now() - startedAt },
          });
        }
        return jsonResponse({
          ok: false,
          op: "patch_customer",
          error: "tekmetric_5xx",
          tekmetric_error_text: msg.slice(0, 500),
          meta: { latency_ms: Date.now() - startedAt },
        });
      }

      // The Server Action persists edited_* to the row separately (so
      // resume / re-render reads the same values). This op is the
      // Tekmetric-write side-effect only.
      return jsonResponse({
        ok: true,
        op: "patch_customer",
        customer_id: input.customer_id,
        meta: { latency_ms: Date.now() - startedAt },
      });
    }

    if (input.op === "append_appointment_description") {
      // Phase 13 (2026-05-16): customer-authored note from Step 10.3 gets
      // appended to the existing appointment description (NOT overwritten).
      // Per chat-design.md §10.3-10.5 amendment, this is the Phase 1
      // channel for customer notes — customer.notes field is deferred.
      try {
        const result = await appendAppointmentDescription(sb, SHOP_ID, {
          appointment_id: input.appointment_id,
          append_text: input.append_text,
        });
        return jsonResponse({
          ok: true,
          op: "append_appointment_description",
          appointment_id: input.appointment_id,
          new_description: result.new_description,
          meta: { latency_ms: Date.now() - startedAt },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/HTTP 4\d\d/.test(msg)) {
          return jsonResponse({
            ok: false,
            op: "append_appointment_description",
            error: "tekmetric_4xx",
            tekmetric_error_text: msg.slice(0, 500),
            meta: { latency_ms: Date.now() - startedAt },
          });
        }
        return jsonResponse({
          ok: false,
          op: "append_appointment_description",
          error: "tekmetric_5xx",
          tekmetric_error_text: msg.slice(0, 500),
          meta: { latency_ms: Date.now() - startedAt },
        });
      }
    }

    if (input.op === "confirm_booking") {
      // Per the spec-aligned refactor 2026-05-13: customer + vehicle MUST
      // already exist in Tekmetric. parseBody enforces customer_id +
      // vehicle_id are numbers. confirm_booking just runs
      // confirmAppointment with the existing IDs.
      const result = await confirmAppointment(sb, SHOP_ID, {
        hold_id: input.hold_id,
        customer_id: input.customer_id,
        vehicle_id: input.vehicle_id,
        title: input.title,
        description: input.description,
        color: input.color,
      });

      return jsonResponse({
        ok: true,
        op: "confirm_booking",
        appointment_id: result.appointment_id,
        status: result.status,
        start_time: result.start_time,
        customer_id: input.customer_id,
        vehicle_id: input.vehicle_id,
        verification: result.verification,
        meta: { latency_ms: Date.now() - startedAt },
      });
    }

    return jsonResponse({ ok: false, error: "unreachable" }, 500);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? (e.stack ?? null) : null;
    console.error(
      JSON.stringify({
        level: "error",
        msg: "booking_direct_unhandled",
        op: input.op,
        detail: msg,
      }),
    );
    await logEdgeError(sb, {
      session_id: input.session_id,
      surface: `scheduler-booking-direct/${input.op}`,
      origin_id: "scheduler-booking-direct",
      level: "error",
      error_code: `${input.op}_unhandled`,
      message: msg,
      stack,
    });
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
