// Pure tool functions for customer + vehicle operations against Tekmetric.
//
// Per appointments_design.md §7.2 + §12.1.
// Used by: _shared/scheduler-tools.ts (AI SDK tool registry for the
// scheduler orchestrator).
//
// Tekmetric quirks handled here:
//   - Phone search: GET /customers?search=<phone> returns broad fuzzy results
//     (substrings, name matches). We post-filter to phones whose digits match
//     the queried E.164.
//   - PATCH /customers BODY ARRAY GOTCHA (§12.1.2): every PATCH that touches
//     phone or email arrays MUST first GET the full record, MERGE the desired
//     change into the existing array, then PATCH the COMPLETE array. NEVER
//     PATCH a partial array — Tekmetric REPLACES (not merges) so any phone /
//     email NOT in the body gets deleted.
//   - Customer creation is NOT idempotent. Caller (scheduler orchestrator)
//     must dedup via lookup_customer_by_phone first.
//   - Returns from local appointments shadow for upcoming appointments
//     (rolling 7-day window per Chris 2026-05-10) — no Tekmetric round-trip
//     for that read.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  tekmetricFetch,
  tekmetricGetJson,
  type TekmetricPage,
} from "../tekmetric-client.ts";

// ─── Tekmetric DTO subsets ───────────────────────────────────────────────────

export interface TekmetricPhoneEntry {
  /** Tekmetric internal phone-entry id (stable across PATCHes; needed to mutate). */
  id?: number;
  number: string;
  type?: string | null;
  primary?: boolean;
}

export interface TekmetricCustomer {
  id: number;
  shopId: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: TekmetricPhoneEntry[];
  address?: {
    streetAddress?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  } | null;
  createdDate?: string | null;
  updatedDate?: string | null;
  deletedDate?: string | null;
}

export interface TekmetricVehicle {
  id: number;
  customerId: number;
  shopId: number;
  year: number | null;
  make: string | null;
  model: string | null;
  subModel?: string | null;
  vin?: string | null;
  licensePlate?: string | null;
  color?: string | null;
  deletedDate?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeDigits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Match a Tekmetric customer's phone array against a queried E.164 number.
 * Tolerant: matches if the last 10 digits agree (ignores +1 country code +
 * any formatting present on Tekmetric's side).
 */
function customerHasPhone(
  customer: TekmetricCustomer,
  phoneE164: string,
): boolean {
  const queryLast10 = normalizeDigits(phoneE164).slice(-10);
  if (queryLast10.length !== 10) return false;
  return (customer.phone ?? []).some((p) => {
    const last10 = normalizeDigits(p.number).slice(-10);
    return last10 === queryLast10;
  });
}

// ─── Read tools ──────────────────────────────────────────────────────────────

/**
 * Look up customers by phone number via Tekmetric search; post-filter to ones
 * with a matching phone entry. Returns the matched customers (typically 0, 1,
 * or 2+ in shared-phone scenarios).
 */
export async function lookupCustomerByPhone(
  sb: SupabaseClient,
  shopId: number,
  phoneE164: string,
): Promise<{ customers: TekmetricCustomer[]; count: number }> {
  const queryLast10 = normalizeDigits(phoneE164).slice(-10);
  const page = await tekmetricGetJson<TekmetricPage<TekmetricCustomer>>(
    sb,
    "/customers",
    { shop: shopId, search: queryLast10, size: 25 },
  );
  const filtered = (page.content ?? []).filter((c) =>
    customerHasPhone(c, phoneE164)
  );
  return { customers: filtered, count: filtered.length };
}

/**
 * Look up customers by name via Tekmetric search; tolerant case-insensitive
 * filter. Returns up to 25 matches.
 */
export async function lookupCustomerByName(
  sb: SupabaseClient,
  shopId: number,
  name: string,
): Promise<{ customers: TekmetricCustomer[]; count: number }> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return { customers: [], count: 0 };
  const page = await tekmetricGetJson<TekmetricPage<TekmetricCustomer>>(
    sb,
    "/customers",
    { shop: shopId, search: trimmed, size: 25 },
  );
  return { customers: page.content ?? [], count: (page.content ?? []).length };
}

/**
 * Get the FULL customer record from Tekmetric by id. Required before any
 * PATCH that touches phone/email arrays (per §12.1.2).
 */
export async function getCustomerById(
  sb: SupabaseClient,
  shopId: number,
  customerId: number,
): Promise<TekmetricCustomer | null> {
  try {
    return await tekmetricGetJson<TekmetricCustomer>(
      sb,
      `/customers/${customerId}`,
      { shop: shopId },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("404")) return null;
    throw e;
  }
}

/**
 * Verify a self-asserted customer identity matches a Tekmetric customer
 * record by lenient name compare + vehicle match.
 *
 * Lenient name: case-insensitive + simple Levenshtein ≤ 2 + nickname-aware.
 * Phase 1: full nickname dictionary deferred — for now the lenient compare is
 * lowercased exact match on first or full name. Returning customer's
 * confirmation is the strong signal; the lenient compare just guards against
 * typos.
 */
export async function verifyCustomerIdentity(
  sb: SupabaseClient,
  shopId: number,
  args: {
    customer_id: number;
    name?: string;
    vehicle_id?: number;
    vehicle_label?: string;
  },
): Promise<{
  verified: boolean;
  name_match?: boolean;
  vehicle_match?: boolean;
  mismatch_reason?: string;
}> {
  const customer = await getCustomerById(sb, shopId, args.customer_id);
  if (!customer) {
    return { verified: false, mismatch_reason: "customer_not_found" };
  }

  let nameMatch: boolean | undefined;
  if (args.name) {
    const submitted = args.name.trim().toLowerCase();
    const fullName = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`
      .trim()
      .toLowerCase();
    const firstName = (customer.firstName ?? "").trim().toLowerCase();
    nameMatch =
      submitted === fullName ||
      submitted === firstName ||
      fullName.includes(submitted) ||
      submitted.includes(firstName);
  }

  let vehicleMatch: boolean | undefined;
  if (args.vehicle_id !== undefined || args.vehicle_label) {
    const { vehicles } = await lookupVehiclesForCustomer(
      sb,
      shopId,
      args.customer_id,
    );
    if (args.vehicle_id !== undefined) {
      vehicleMatch = vehicles.some((v) => v.id === args.vehicle_id);
    } else if (args.vehicle_label) {
      const target = args.vehicle_label.trim().toLowerCase();
      vehicleMatch = vehicles.some((v) => {
        const label =
          `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim().toLowerCase();
        return label === target || label.includes(target);
      });
    }
  }

  const verified =
    (nameMatch === undefined || nameMatch === true) &&
    (vehicleMatch === undefined || vehicleMatch === true);

  let mismatch_reason: string | undefined;
  if (!verified) {
    if (nameMatch === false && vehicleMatch === false) {
      mismatch_reason = "name_and_vehicle_mismatch";
    } else if (nameMatch === false) {
      mismatch_reason = "name_mismatch";
    } else if (vehicleMatch === false) {
      mismatch_reason = "vehicle_mismatch";
    }
  }

  return { verified, name_match: nameMatch, vehicle_match: vehicleMatch, mismatch_reason };
}

/**
 * List the customer's vehicles from Tekmetric. Used by show_vehicle_picker.
 */
export async function lookupVehiclesForCustomer(
  sb: SupabaseClient,
  shopId: number,
  customerId: number,
): Promise<{ vehicles: TekmetricVehicle[]; count: number }> {
  const page = await tekmetricGetJson<TekmetricPage<TekmetricVehicle>>(
    sb,
    "/vehicles",
    { shop: shopId, customerId, size: 50 },
  );
  const live = (page.content ?? []).filter((v) => !v.deletedDate);
  return { vehicles: live, count: live.length };
}

/**
 * Get a customer's upcoming appointments from the local 7-day shadow.
 * Phase 1 = forward-only 7-day window (no historical appointments cached).
 * If a customer asks about an appointment outside this window, the chat
 * agent's pre-canned fallback is "I don't have that handy — please call
 * us at 6102536565."
 *
 * Returns: appointments where customer_id matches, status NOT IN
 * ('CANCELED','NO_SHOW'), deleted_at IS NULL, start_time >= now().
 */
export async function getCustomerUpcomingAppointments(
  sb: SupabaseClient,
  shopId: number,
  customerId: number,
): Promise<{
  appointments: Array<{
    appointment_id: number;
    start_time: string;
    end_time: string;
    appointment_type: "waiter" | "dropoff";
    appointment_status: string;
    title: string | null;
    vehicle_id: number | null;
  }>;
  count: number;
}> {
  const { data, error } = await sb
    .from("appointments")
    .select(
      "tekmetric_appointment_id, start_time, end_time, appointment_type, appointment_status, title, vehicle_id",
    )
    .eq("shop_id", shopId)
    .eq("customer_id", customerId)
    .is("deleted_at", null)
    .not("appointment_status", "in", "(CANCELED,NO_SHOW)")
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`getCustomerUpcomingAppointments failed: ${error.message}`);
  }

  const rows = (data ?? []).map((r) => ({
    appointment_id: r.tekmetric_appointment_id as number,
    start_time: r.start_time as string,
    end_time: r.end_time as string,
    appointment_type: r.appointment_type as "waiter" | "dropoff",
    appointment_status: r.appointment_status as string,
    title: (r.title ?? null) as string | null,
    vehicle_id: (r.vehicle_id ?? null) as number | null,
  }));

  return { appointments: rows, count: rows.length };
}

// ─── Write tools ─────────────────────────────────────────────────────────────

/**
 * Create a new customer in Tekmetric. NOT idempotent. Caller must first
 * lookupCustomerByPhone to dedup.
 *
 * Tekmetric POST /customers expects:
 *   { firstName, lastName, email?, phone: [{number, type?, primary?}], ... }
 */
export async function createNewCustomer(
  sb: SupabaseClient,
  shopId: number,
  args: {
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
  },
): Promise<{ customer_id: number }> {
  const body = {
    shopId,
    firstName: args.first_name.trim(),
    lastName: args.last_name.trim(),
    email: args.email?.trim() || null,
    phone: [
      {
        number: args.phone_e164,
        type: "Mobile",
        primary: true,
      },
    ],
    address: args.address ?? null,
  };

  const res = await tekmetricFetch(sb, "/customers", {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Tekmetric POST /customers → HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = await res.json();
  // Tekmetric POST returns the full customer object in `data` (or directly,
  // depending on shape). Be tolerant.
  const created = (json.data ?? json) as TekmetricCustomer;
  if (!created || typeof created.id !== "number") {
    throw new Error(
      `Tekmetric POST /customers returned no customer.id: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return { customer_id: created.id };
}

/**
 * Create a new vehicle in Tekmetric for an existing customer.
 *
 * Tekmetric POST /vehicles expects:
 *   { customerId, shopId, year, make, model, subModel?, vin?, licensePlate?, ... }
 */
export async function createNewVehicle(
  sb: SupabaseClient,
  shopId: number,
  args: {
    customer_id: number;
    year: number;
    make: string;
    model: string;
    sub_model?: string;
    vin?: string;
    license_plate?: string;
    color?: string;
  },
): Promise<{ vehicle_id: number }> {
  const body = {
    customerId: args.customer_id,
    shopId,
    year: args.year,
    make: args.make.trim(),
    model: args.model.trim(),
    subModel: args.sub_model?.trim() || null,
    vin: args.vin?.trim() || null,
    licensePlate: args.license_plate?.trim() || null,
    color: args.color?.trim() || null,
  };

  const res = await tekmetricFetch(sb, "/vehicles", {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Tekmetric POST /vehicles → HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = await res.json();
  const created = (json.data ?? json) as TekmetricVehicle;
  if (!created || typeof created.id !== "number") {
    throw new Error(
      `Tekmetric POST /vehicles returned no vehicle.id: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return { vehicle_id: created.id };
}
