/**
 * Build the SummaryCard payload AND the Tekmetric POST title from the
 * customer_chat_sessions row. Phase 12 2026-05-16.
 *
 * Reads the row's customer/vehicle/services/appointment columns and
 * assembles two distinct outputs:
 *
 *   1. `buildSummaryCardPayload` — the {customer, vehicle, services,
 *      reminders, starts_at, hold_id, hold_expires_at, type} shape the
 *      SummaryCard component renders.
 *   2. `buildAppointmentTitleV2` — the `[TM] <slot-tag-if-waiter>
 *      <First Last>, <Year> <Make> <Model> <ABBRS>` title sent to
 *      Tekmetric on POST. `[TM]` marks "online scheduler appointment"
 *      per Chris's 2026-05-16 convention (replaces the legacy `[OP]`
 *      placeholder).
 *
 * Both helpers read the row via the admin client. Caller is a Server
 * Action so the admin client is appropriate (bypasses RLS, app-trusted).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface SummaryServiceItem {
  display_name: string;
  kind: "routine" | "concern" | "testing";
  starting_price_cents?: number;
  notes?: string;
}

/**
 * Matches the card-payloads.ts SummaryPayload discriminated-union shape
 * (nullable hold_id + hold_expires_at, not optional). The SummaryCard
 * client component accepts both optional + null gracefully via its
 * `hold_id?: string` prop (null becomes undefined at the boundary).
 */
export interface SummaryCardPayload {
  hold_id: string | null;
  hold_expires_at: string | null;
  starts_at: string;
  customer: string;
  vehicle: string;
  type: "waiter" | "dropoff";
  services: SummaryServiceItem[];
  reminders: string[];
}

const SHOP_ID = 7476;

/**
 * Build the title string for Tekmetric POST /appointments per the
 * 2026-05-16 chat-design amendment.
 *
 * Format:
 *   Waiter @ 8 AM: `[TM] 8AM WAIT <First Last>, <Year> <Make> <Model> <ABBRS>`
 *   Waiter @ 9 AM: `[TM] 9AM WAIT <First Last>, <Year> <Make> <Model> <ABBRS>`
 *   Dropoff:       `[TM] <First Last>, <Year> <Make> <Model> <ABBRS>`
 *
 * ABBRS = concatenation of routine + testing service abbreviations (e.g.,
 * "SI IM LOF" for State Inspection + Oil Change). Falls back to "APPT" if
 * no service abbreviations resolve.
 */
export async function buildAppointmentTitleV2(args: {
  chatId: string;
}): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const { data: rowRaw } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", args.chatId)
    .maybeSingle();
  const row = (rowRaw ?? {}) as Record<string, unknown>;

  // Customer name (post-verification)
  const first =
    (row.verified_first_name as string | null) ??
    (row.entered_first_name as string | null) ??
    "";
  const last =
    (row.verified_last_name as string | null) ??
    (row.entered_last_name as string | null) ??
    "";
  const customerName = [first.trim(), last.trim()].filter(Boolean).join(" ");

  // Vehicle string from new_vehicle_info (set by Step 6 new-vehicle form
  // OR Step 5 returning-customer's chosen vehicle). For returning
  // customers without a fresh new_vehicle_info, derive from the Tekmetric
  // vehicle GET — but that's an extra round-trip. Phase 12 uses what's
  // on the row; if vehicle_id is set but new_vehicle_info isn't, we fall
  // back to a generic vehicle string and the title gains the year/make/
  // model post-launch when staff sees the appointment in Tekmetric.
  const nvi = (row.new_vehicle_info ?? {}) as Record<string, unknown>;
  const year = nvi.year ? String(nvi.year).trim() : "";
  const make = nvi.make ? String(nvi.make).trim() : "";
  const model = nvi.model ? String(nvi.model).trim() : "";
  const vehicleStr = [year, make, model].filter(Boolean).join(" ");

  // Service abbreviations — union of selected_simple_services + the
  // explanation-required items' service_keys + approved_testing_services +
  // additional_routine_services_round2. Look up `abbreviation` from
  // routine_services and testing_services tables.
  const selectedRoutine = Array.isArray(row.selected_simple_services)
    ? (row.selected_simple_services as string[])
    : [];
  const additionalRoutine = Array.isArray(
    row.additional_routine_services_round2,
  )
    ? (row.additional_routine_services_round2 as string[])
    : [];
  const approvedTesting = Array.isArray(row.approved_testing_services)
    ? (row.approved_testing_services as string[])
    : [];
  const explanationKeys: string[] = [];
  if (Array.isArray(row.explanation_required_items)) {
    for (const entry of row.explanation_required_items as Array<unknown>) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).service_key === "string"
      ) {
        explanationKeys.push(
          (entry as Record<string, unknown>).service_key as string,
        );
      }
    }
  }
  const allKeys = Array.from(
    new Set([
      ...selectedRoutine,
      ...additionalRoutine,
      ...approvedTesting,
      ...explanationKeys,
    ]),
  );

  let abbreviation = "APPT";
  if (allKeys.length > 0) {
    const [routineRes, testingRes] = await Promise.all([
      supabase
        .from("routine_services")
        .select("service_key, abbreviation")
        .eq("shop_id", SHOP_ID)
        .in("service_key", allKeys),
      supabase
        .from("testing_services")
        .select("service_key, abbreviation")
        .eq("shop_id", SHOP_ID)
        .in("service_key", allKeys),
    ]);
    const abbrevByKey = new Map<string, string>();
    for (const r of (routineRes.data ?? []) as Array<{
      service_key: string;
      abbreviation: string;
    }>) {
      abbrevByKey.set(r.service_key, r.abbreviation);
    }
    for (const r of (testingRes.data ?? []) as Array<{
      service_key: string;
      abbreviation: string;
    }>) {
      abbrevByKey.set(r.service_key, r.abbreviation);
    }
    // Preserve pick order — selected_routine first, then explanation
    // queue, then testing, then additional second-pass.
    const ordered: string[] = [];
    const pushAbbr = (k: string) => {
      const a = abbrevByKey.get(k);
      if (a && a !== "TBD" && !ordered.includes(a)) ordered.push(a);
    };
    for (const k of selectedRoutine) pushAbbr(k);
    for (const k of explanationKeys) pushAbbr(k);
    for (const k of approvedTesting) pushAbbr(k);
    for (const k of additionalRoutine) pushAbbr(k);
    if (ordered.length > 0) {
      abbreviation = ordered.join(" ");
    }
  }

  // Slot tag for waiter (between [TM] and the customer name).
  const apptType =
    row.appointment_type === "waiter" ? "waiter" : "dropoff";
  const apptTime = (row.appointment_time as string | null) ?? "";
  let slotTag = "";
  if (apptType === "waiter") {
    if (apptTime.startsWith("08:") || apptTime === "08:00:00") {
      slotTag = "8AM WAIT ";
    } else if (apptTime.startsWith("09:") || apptTime === "09:00:00") {
      slotTag = "9AM WAIT ";
    } else {
      // Unknown waiter time — use a generic WAIT tag so advisors know
      // it's a waiter without seeing the time. Shouldn't fire in practice
      // since Phase 11's waiter time picker enforces 08:00/09:00.
      slotTag = "WAIT ";
    }
  }

  // Assemble: `[TM] <slotTag><name>, <vehicle> <abbreviation>`
  const nameVehicle = [customerName, vehicleStr].filter(Boolean).join(", ");
  const parts = ["[TM]", `${slotTag}${nameVehicle}`.trim(), abbreviation];
  return parts.filter((p) => p.length > 0).join(" ");
}

/**
 * Build the full SummaryCardPayload from the row.
 *
 * Reads display names for routine + testing services so the customer
 * sees friendly labels (not raw service_keys). Reads concern texts from
 * the explanation_required_items queue. Computes reminders based on
 * appointment_type + service set.
 *
 * starts_at is built from appointment_date + appointment_time. For
 * dropoff (no time), defaults to 08:00 EDT so the SummaryCard's fmtStarts
 * helper renders the date cleanly.
 */
export async function buildSummaryCardPayload(args: {
  chatId: string;
  hold_id?: string;
  hold_expires_at?: string;
}): Promise<SummaryCardPayload> {
  const supabase = createSupabaseAdminClient();
  const { data: rowRaw } = await supabase
    .from("customer_chat_sessions")
    .select("*")
    .eq("id", args.chatId)
    .maybeSingle();
  const row = (rowRaw ?? {}) as Record<string, unknown>;

  // Customer name
  const first =
    (row.verified_first_name as string | null) ??
    (row.entered_first_name as string | null) ??
    "";
  const last =
    (row.verified_last_name as string | null) ??
    (row.entered_last_name as string | null) ??
    "";
  const customer = [first.trim(), last.trim()].filter(Boolean).join(" ");

  // Vehicle string from new_vehicle_info
  const nvi = (row.new_vehicle_info ?? {}) as Record<string, unknown>;
  const year = nvi.year ? String(nvi.year).trim() : "";
  const make = nvi.make ? String(nvi.make).trim() : "";
  const model = nvi.model ? String(nvi.model).trim() : "";
  const sub = nvi.sub_model ? String(nvi.sub_model).trim() : "";
  const vehicle = [year, make, model, sub].filter(Boolean).join(" ");

  // Appointment time
  const type: "waiter" | "dropoff" =
    row.appointment_type === "waiter" ? "waiter" : "dropoff";
  const apptDate = (row.appointment_date as string | null) ?? "";
  const apptTime =
    (row.appointment_time as string | null) ??
    (type === "dropoff" ? "08:00:00" : "08:00:00");
  // EDT/EST handled correctly by toLocaleDateString in the card; we just
  // need a valid ISO with offset. Use -04:00 for Phase 1 (EDT).
  const starts_at = apptDate
    ? `${apptDate}T${apptTime.slice(0, 8)}-04:00`
    : "";

  // Services breakdown — routine + concerns + testing.
  const selectedRoutine = Array.isArray(row.selected_simple_services)
    ? (row.selected_simple_services as string[])
    : [];
  const additionalRoutine = Array.isArray(
    row.additional_routine_services_round2,
  )
    ? (row.additional_routine_services_round2 as string[])
    : [];
  const approvedTesting = Array.isArray(row.approved_testing_services)
    ? (row.approved_testing_services as string[])
    : [];
  const explanationItems = Array.isArray(row.explanation_required_items)
    ? (row.explanation_required_items as Array<{
        service_key: string;
        display_name?: string;
        explanation_text?: string;
      }>)
    : [];

  const services: SummaryServiceItem[] = [];

  const routineKeys = Array.from(
    new Set([...selectedRoutine, ...additionalRoutine]),
  );
  if (routineKeys.length > 0) {
    const { data } = await supabase
      .from("routine_services")
      .select("service_key, display_name")
      .eq("shop_id", SHOP_ID)
      .in("service_key", routineKeys);
    const nameByKey = new Map(
      ((data ?? []) as Array<{ service_key: string; display_name: string }>)
        .map((r) => [r.service_key, r.display_name]),
    );
    for (const key of routineKeys) {
      const name = nameByKey.get(key);
      if (name) services.push({ display_name: name, kind: "routine" });
    }
  }

  for (const item of explanationItems) {
    const name = item.display_name ?? item.service_key;
    services.push({
      display_name: name,
      kind: "concern",
      notes: item.explanation_text || undefined,
    });
  }

  if (approvedTesting.length > 0) {
    const { data } = await supabase
      .from("testing_services")
      .select("service_key, display_name, starting_price_cents")
      .eq("shop_id", SHOP_ID)
      .in("service_key", approvedTesting);
    for (const t of (data ?? []) as Array<{
      service_key: string;
      display_name: string;
      starting_price_cents: number | null;
    }>) {
      services.push({
        display_name: t.display_name,
        kind: "testing",
        starting_price_cents:
          typeof t.starting_price_cents === "number"
            ? t.starting_price_cents
            : undefined,
      });
    }
  }

  // Reminders — Phase 1 minimal set.
  const reminders: string[] = [];
  if (type === "dropoff") {
    reminders.push("Drop off before 10 AM. We'll text or call when ready.");
  }
  // State Inspection requires title + registration + insurance.
  const hasInspection = selectedRoutine.includes("state_inspection_emissions") ||
    additionalRoutine.includes("state_inspection_emissions");
  if (hasInspection) {
    reminders.push(
      "State Inspection: bring your title (or registration) + insurance card.",
    );
  }

  return {
    hold_id: args.hold_id ?? null,
    hold_expires_at: args.hold_expires_at ?? null,
    starts_at,
    customer,
    vehicle,
    type,
    services,
    reminders,
  };
}
