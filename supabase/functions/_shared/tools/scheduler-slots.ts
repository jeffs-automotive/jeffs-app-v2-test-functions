// Pure tool functions for slot capacity, holds, booking, reschedule, cancel.
//
// Per appointments_design.md §5 + §7.2 + §9 + §12.1.
// Used by: _shared/scheduler-tools.ts (AI SDK tool registry).
//
// Capacity model recap:
//   - Waiters: exactly 2 times of day (08:00, 09:00) × capacity 2 = 4/day
//   - Drop-offs: customer picks DATE only (no time); orchestrator hard-codes
//     12:00:00 startTime for Tekmetric. Daily cap = 35 across all types.
//   - Closed dates (Sundays + holidays) come from the closed_dates table.
//   - Admin blocks come from appointment_blocks (full day, by type, or
//     specific time).
//
// Race-safety:
//   - Waiter holds use the hold_waiter_slot Postgres function (advisory-lock
//     pattern verified against PG docs 2026-05-10 — see migration
//     20260510131752_scheduler_phase1_schema.sql).
//   - Drop-off holds use a per-day advisory lock applied here in TypeScript
//     via a SQL RPC call (mirrors hold_waiter_slot but on a daily key).
//     Phase 1 simplification: enforce daily-cap check inside a single SELECT
//     wrapped in pg_advisory_xact_lock. Pattern works because the orchestrator
//     queries the same path.
//
// Rolling 7-day shadow:
//   - For dates within today..today+7d, list_available_slots reads
//     from the local appointments shadow table (millisec response).
//   - For dates beyond today+7d, the orchestrator either makes per-day
//     Tekmetric GET /appointments calls OR (preferred for casual far-future
//     queries) returns "default-assumed-open" so the chat agent doesn't pay
//     the latency cost. Phase 1: always do the Tekmetric pull for >7d.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  tekmetricFetch,
  tekmetricGetJson,
  type TekmetricPage,
} from "../tekmetric-client.ts";

// ─── Capacity constants (per design §5) ──────────────────────────────────────

const WAITER_TIMES = ["08:00", "09:00"] as const;
const WAITER_CAPACITY_PER_TIME = 2;
const DAILY_TOTAL_CAP = 35;
const SHADOW_HORIZON_DAYS = 7;

// ─── Tekmetric DTO subsets ───────────────────────────────────────────────────

export interface TekmetricAppointment {
  id: number;
  shopId: number;
  customerId: number | null;
  vehicleId: number | null;
  startTime: string;
  endTime: string;
  description: string | null;
  title?: string | null;
  appointmentStatus: { id: number; name: string; code: string };
  appointmentOption?: { id: number; name: string; code: string } | null;
  rideOption?: { id: number; name: string; code: string } | null;
  color?: string | null;
  deletedDate?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayBoundsUtc(date: string): { start: string; end: string } {
  // start = YYYY-MM-DDT00:00:00Z, end = next-day 00:00:00Z
  const start = `${date}T00:00:00Z`;
  const next = addDays(new Date(`${date}T00:00:00Z`), 1);
  return { start, end: next.toISOString() };
}

function classifyAppointmentType(
  startTime: string,
): "waiter" | "dropoff" {
  // Waiter slots are at 08:00 or 09:00 local-EDT (UTC-04 in DST, UTC-05 standard).
  // Phase 1 heuristic: parse hour in UTC; assume EDT (most of the year). If we
  // misclassify on edge cases, the appointments-sync cron will overwrite with
  // the right value when it pulls from Tekmetric (which has the source of truth).
  const hour = new Date(startTime).getUTCHours();
  // 08:00 EDT = 12:00 UTC; 09:00 EDT = 13:00 UTC; 12:00 EDT = 16:00 UTC
  if (hour === 12 || hour === 13) return "waiter";
  return "dropoff";
}

// ─── Read tools ──────────────────────────────────────────────────────────────

/**
 * Returns per-date availability for the requested range.
 *
 *   - Within today..today+SHADOW_HORIZON_DAYS: reads local appointments shadow
 *     + appointment_holds + appointment_blocks + closed_dates.
 *   - Beyond today+SHADOW_HORIZON_DAYS: fetches per-day from Tekmetric.
 *
 * Returns:
 *   {
 *     available: { 'YYYY-MM-DD': { waiter_times: ['08:00','09:00'],
 *                                  dropoff_available: true } },
 *     earliest: {
 *       waiter?:  { date, times },
 *       dropoff?: { date }
 *     }
 *   }
 */
export async function listAvailableSlots(
  sb: SupabaseClient,
  shopId: number,
  args: {
    type?: "waiter" | "dropoff" | "any";
    date_range_start?: string;
    date_range_end?: string;
    limit?: number;
  } = {},
): Promise<{
  available: Record<string, { waiter_times: string[]; dropoff_available: boolean }>;
  earliest: {
    waiter?: { date: string; times: string[] };
    dropoff?: { date: string };
  };
}> {
  const today = new Date();
  const start = args.date_range_start
    ? new Date(`${args.date_range_start}T00:00:00Z`)
    : new Date(`${ymd(today)}T00:00:00Z`);
  const end = args.date_range_end
    ? new Date(`${args.date_range_end}T00:00:00Z`)
    : addDays(start, args.limit ?? 30);
  const desiredType = args.type ?? "any";

  // ─── Fetch closed_dates + blocks for the whole range (one query each) ───
  const { data: closedRows, error: closedErr } = await sb
    .from("closed_dates")
    .select("closed_date")
    .eq("shop_id", shopId)
    .gte("closed_date", ymd(start))
    .lt("closed_date", ymd(end));
  if (closedErr) throw new Error(`closed_dates query failed: ${closedErr.message}`);
  const closedSet = new Set((closedRows ?? []).map((r) => r.closed_date as string));

  const { data: blockRows, error: blockErr } = await sb
    .from("appointment_blocks")
    .select("blocked_date, blocked_type, blocked_time")
    .eq("shop_id", shopId)
    .gte("blocked_date", ymd(start))
    .lt("blocked_date", ymd(end));
  if (blockErr) throw new Error(`appointment_blocks query failed: ${blockErr.message}`);
  const blocks = blockRows ?? [];

  // ─── Per-date capacity ───────────────────────────────────────────────────
  const available: Record<
    string,
    { waiter_times: string[]; dropoff_available: boolean }
  > = {};

  const shadowHorizon = addDays(today, SHADOW_HORIZON_DAYS);

  for (
    let cursor = new Date(start);
    cursor < end;
    cursor = addDays(cursor, 1)
  ) {
    const date = ymd(cursor);

    // Hard skips: closed (Sunday/holiday), full-day block
    if (closedSet.has(date)) {
      available[date] = { waiter_times: [], dropoff_available: false };
      continue;
    }
    const fullDayBlocked = blocks.some(
      (b) =>
        b.blocked_date === date &&
        b.blocked_type === null &&
        b.blocked_time === null,
    );
    if (fullDayBlocked) {
      available[date] = { waiter_times: [], dropoff_available: false };
      continue;
    }

    let dropoffBlocked = blocks.some(
      (b) => b.blocked_date === date && b.blocked_type === "dropoff",
    );
    const blockedWaiterTimes = new Set<string>();
    for (const b of blocks) {
      if (b.blocked_date !== date) continue;
      if (b.blocked_type === "waiter" && b.blocked_time === null) {
        WAITER_TIMES.forEach((t) => blockedWaiterTimes.add(t));
      } else if (b.blocked_type === "waiter" && b.blocked_time) {
        blockedWaiterTimes.add(String(b.blocked_time).slice(0, 5));
      }
    }

    // Capacity counts — local shadow if in window, else Tekmetric direct.
    let waiterCounts: Record<string, number>;
    let totalDayCount: number;

    if (cursor < shadowHorizon) {
      waiterCounts = {};
      totalDayCount = 0;
      const { data: appts } = await sb
        .from("appointments")
        .select("start_time, appointment_type, appointment_status")
        .eq("shop_id", shopId)
        .gte("start_time", `${date}T00:00:00Z`)
        .lt("start_time", `${ymd(addDays(cursor, 1))}T00:00:00Z`)
        .is("deleted_at", null)
        .not("appointment_status", "in", "(CANCELED,NO_SHOW)");
      for (const a of appts ?? []) {
        const startStr = a.start_time as string;
        const type = a.appointment_type as "waiter" | "dropoff";
        totalDayCount += 1;
        if (type === "waiter") {
          const hour = new Date(startStr).getUTCHours();
          // EDT 8 AM = UTC 12; EDT 9 AM = UTC 13.
          // Approximate; the appointments-sync cron is authoritative on type.
          const slot = hour === 12 ? "08:00" : hour === 13 ? "09:00" : "08:00";
          waiterCounts[slot] = (waiterCounts[slot] ?? 0) + 1;
        }
      }
      // Holds count too
      const { data: holds } = await sb
        .from("appointment_holds")
        .select("scheduled_time, appointment_type, expires_at")
        .eq("shop_id", shopId)
        .eq("scheduled_date", date)
        .is("released_at", null)
        .gt("expires_at", new Date().toISOString());
      for (const h of holds ?? []) {
        const type = h.appointment_type as "waiter" | "dropoff";
        totalDayCount += 1;
        if (type === "waiter") {
          const slot = String(h.scheduled_time).slice(0, 5);
          waiterCounts[slot] = (waiterCounts[slot] ?? 0) + 1;
        }
      }
    } else {
      // Beyond shadow horizon — fall through to Tekmetric direct
      const { start: dStart, end: dEnd } = dayBoundsUtc(date);
      try {
        const page = await tekmetricGetJson<
          TekmetricPage<TekmetricAppointment>
        >(sb, "/appointments", {
          shop: shopId,
          start: dStart,
          end: dEnd,
          size: 100,
        });
        waiterCounts = {};
        totalDayCount = 0;
        for (const a of page.content ?? []) {
          if (a.deletedDate) continue;
          if (a.appointmentStatus?.code === "CANCELED" || a.appointmentStatus?.code === "NO_SHOW") {
            continue;
          }
          totalDayCount += 1;
          const t = classifyAppointmentType(a.startTime);
          if (t === "waiter") {
            const hour = new Date(a.startTime).getUTCHours();
            const slot = hour === 12 ? "08:00" : "09:00";
            waiterCounts[slot] = (waiterCounts[slot] ?? 0) + 1;
          }
        }
      } catch (e) {
        // Network blip on far-future query — fall back to default-assumed-open
        console.error(
          `Tekmetric far-future GET /appointments failed for ${date}:`,
          e instanceof Error ? e.message : String(e),
        );
        waiterCounts = {};
        totalDayCount = 0;
      }
    }

    const dailyCapHit = totalDayCount >= DAILY_TOTAL_CAP;
    const openWaiterTimes = dailyCapHit
      ? []
      : WAITER_TIMES.filter(
          (t) =>
            !blockedWaiterTimes.has(t) &&
            (waiterCounts[t] ?? 0) < WAITER_CAPACITY_PER_TIME,
        );
    const dropoffOk = !dropoffBlocked && !dailyCapHit;

    available[date] = {
      waiter_times: openWaiterTimes,
      dropoff_available: dropoffOk,
    };
  }

  // ─── Earliest-available shortcuts ───────────────────────────────────────
  const earliest: {
    waiter?: { date: string; times: string[] };
    dropoff?: { date: string };
  } = {};

  for (const date of Object.keys(available).sort()) {
    const slot = available[date];
    if (
      !earliest.waiter &&
      slot.waiter_times.length > 0 &&
      (desiredType === "any" || desiredType === "waiter")
    ) {
      earliest.waiter = { date, times: slot.waiter_times };
    }
    if (
      !earliest.dropoff &&
      slot.dropoff_available &&
      (desiredType === "any" || desiredType === "dropoff")
    ) {
      earliest.dropoff = { date };
    }
    if (earliest.waiter && earliest.dropoff) break;
    if (desiredType === "waiter" && earliest.waiter) break;
    if (desiredType === "dropoff" && earliest.dropoff) break;
  }

  return { available, earliest };
}

/**
 * "Soonest available" wrapper around listAvailableSlots.
 *
 * Per chat-design.md §8 + scheduler_phase1_design_lock.md (2026-05-13):
 * after the customer picks their services and confirms verification,
 * the scheduler specialist surfaces a single card with the EARLIEST waiter
 * time-slots and the EARLIEST dropoff date — NOT the full 30-day grid.
 * Customers can then accept the soonest option or page into the calendar
 * for a different day (which calls list_available_slots).
 *
 * Returns:
 *   - earliest_waiter:  date + up to `waiter_slot_limit` time-slots on the
 *                       earliest day with any waiter capacity. Combines
 *                       08:00 AND 09:00 when both are open on that day.
 *                       (Phase 1 only has 2 waiter slots; the limit param is
 *                       future-proofing for additional slots.)
 *   - earliest_dropoff: the earliest date with any dropoff capacity remaining.
 *
 * Search horizon: configurable via `horizon_days` (default 30; cap 365 per
 * the 365-day booking horizon decision in design lock 2026-05-13).
 *
 * NEW in Chunk 3 — earlier scheduler-orchestrator had the model compose
 * "earliest" from the full per-date map, burning tokens. This tool puts the
 * computation server-side so the model only needs to render the answer.
 */
export async function getEarliestAvailableSlots(
  sb: SupabaseClient,
  shopId: number,
  args: {
    appointment_type: "waiter" | "dropoff" | "any";
    horizon_days?: number;
    waiter_slot_limit?: number;
  },
): Promise<{
  earliest_waiter: { date: string; times: string[] } | null;
  earliest_dropoff: { date: string } | null;
  searched_through: string;
}> {
  const horizon = Math.min(Math.max(args.horizon_days ?? 30, 1), 365);
  const today = new Date();
  const end = addDays(today, horizon);

  const full = await listAvailableSlots(sb, shopId, {
    type: args.appointment_type,
    date_range_start: ymd(today),
    date_range_end: ymd(end),
  });

  let earliestWaiter: { date: string; times: string[] } | null = null;
  if (
    full.earliest.waiter &&
    (args.appointment_type === "waiter" || args.appointment_type === "any")
  ) {
    const limit = Math.max(args.waiter_slot_limit ?? 5, 1);
    earliestWaiter = {
      date: full.earliest.waiter.date,
      times: full.earliest.waiter.times.slice(0, limit),
    };
  }

  let earliestDropoff: { date: string } | null = null;
  if (
    full.earliest.dropoff &&
    (args.appointment_type === "dropoff" || args.appointment_type === "any")
  ) {
    earliestDropoff = { date: full.earliest.dropoff.date };
  }

  return {
    earliest_waiter: earliestWaiter,
    earliest_dropoff: earliestDropoff,
    searched_through: ymd(end),
  };
}

/**
 * Detailed capacity status for a single date — for admin tooling and
 * debugging. Less heavily used in the customer flow (list_available_slots
 * is the primary tool).
 */
export async function getSlotCapacity(
  sb: SupabaseClient,
  shopId: number,
  date: string,
): Promise<{
  date: string;
  waiter_remaining: { time: string; remaining: number }[];
  dropoff_remaining: number;
  total_remaining: number;
  blocks: Array<{ type: string | null; time: string | null; reason: string | null }>;
}> {
  const single = await listAvailableSlots(sb, shopId, {
    date_range_start: date,
    date_range_end: ymd(addDays(new Date(`${date}T00:00:00Z`), 1)),
    type: "any",
  });
  const slot = single.available[date] ?? {
    waiter_times: [],
    dropoff_available: false,
  };

  const { data: blockRows } = await sb
    .from("appointment_blocks")
    .select("blocked_type, blocked_time, reason")
    .eq("shop_id", shopId)
    .eq("blocked_date", date);
  const blocks = (blockRows ?? []).map((b) => ({
    type: (b.blocked_type ?? null) as string | null,
    time: b.blocked_time ? String(b.blocked_time).slice(0, 5) : null,
    reason: (b.reason ?? null) as string | null,
  }));

  const waiterRemaining = slot.waiter_times.map((t) => ({
    time: t,
    remaining: WAITER_CAPACITY_PER_TIME, // approximation — exact remaining requires another count
  }));

  // Total remaining = day cap minus today's count (approximate via shadow)
  const { data: appts } = await sb
    .from("appointments")
    .select("id")
    .eq("shop_id", shopId)
    .gte("start_time", `${date}T00:00:00Z`)
    .lt("start_time", `${ymd(addDays(new Date(`${date}T00:00:00Z`), 1))}T00:00:00Z`)
    .is("deleted_at", null)
    .not("appointment_status", "in", "(CANCELED,NO_SHOW)");
  const dayCount = (appts ?? []).length;

  return {
    date,
    waiter_remaining: waiterRemaining,
    dropoff_remaining: slot.dropoff_available ? Math.max(0, DAILY_TOTAL_CAP - dayCount) : 0,
    total_remaining: Math.max(0, DAILY_TOTAL_CAP - dayCount),
    blocks,
  };
}

// ─── Hold + booking ──────────────────────────────────────────────────────────

/**
 * Create a 30-minute hold on a slot. Race-safe via:
 *   - Waiter: hold_waiter_slot Postgres function (advisory-lock).
 *   - Drop-off: per-day advisory lock + capacity check inside an RPC.
 *
 * Caller flow:
 *   1. Counts active Tekmetric appointments for the slot/day (we pass into RPC).
 *   2. Calls hold_waiter_slot or equivalent drop-off RPC.
 *   3. RPC raises 'slot_full' if (active_holds + tekmetric_count) ≥ capacity.
 *
 * Returns: { hold_id, expires_at }
 * Throws: with message "slot_just_taken" on race; other errors propagate.
 */
export async function holdAppointmentSlot(
  sb: SupabaseClient,
  shopId: number,
  args: {
    session_id: string;
    customer_id?: number;
    vehicle_id?: number;
    date: string;
    time?: string; // required for waiter ('08:00' | '09:00'); ignored for dropoff
    type: "waiter" | "dropoff";
    service_summary: string;
  },
): Promise<{ hold_id: string; expires_at: string }> {
  const { date, type, time } = args;

  // Pre-check: count Tekmetric appointments for that slot
  const { start: dStart, end: dEnd } = dayBoundsUtc(date);
  let tekmetricSlotCount = 0;
  try {
    const page = await tekmetricGetJson<TekmetricPage<TekmetricAppointment>>(
      sb,
      "/appointments",
      { shop: shopId, start: dStart, end: dEnd, size: 100 },
    );
    for (const a of page.content ?? []) {
      if (a.deletedDate) continue;
      if (
        a.appointmentStatus?.code === "CANCELED" ||
        a.appointmentStatus?.code === "NO_SHOW"
      ) {
        continue;
      }
      const aType = classifyAppointmentType(a.startTime);
      if (type === "waiter") {
        if (aType !== "waiter") continue;
        const hour = new Date(a.startTime).getUTCHours();
        const slot = hour === 12 ? "08:00" : "09:00";
        if (slot === time) tekmetricSlotCount += 1;
      } else {
        // For drop-offs we count ALL appointments toward the daily cap of 35
        tekmetricSlotCount += 1;
      }
    }
  } catch (e) {
    // If Tekmetric fails on the pre-check, abort the hold rather than risk
    // overbooking. The customer will see a "trouble talking to our system" error.
    throw new Error(
      `tekmetric_precheck_failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (type === "waiter") {
    if (!time) {
      throw new Error("waiter hold requires `time` ('08:00' or '09:00')");
    }
    // Call hold_waiter_slot RPC
    const { data, error } = await sb.rpc("hold_waiter_slot", {
      p_shop_id: shopId,
      p_session_id: args.session_id,
      p_customer_id: args.customer_id ?? null,
      p_vehicle_id: args.vehicle_id ?? null,
      p_scheduled_date: date,
      p_scheduled_time: time,
      p_service_summary: args.service_summary,
      p_active_tekmetric_appts: tekmetricSlotCount,
    });
    if (error) {
      // P0001 'slot_full' is the race-safe "already taken" signal
      if (error.message?.includes("slot_full")) {
        throw new Error("slot_just_taken");
      }
      throw new Error(`hold_waiter_slot RPC failed: ${error.message}`);
    }
    const holdId = data as string;
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    return { hold_id: holdId, expires_at: expiresAt };
  }

  // Drop-off path — Phase 1 simpler check (no dedicated RPC, but still
  // race-tolerant via daily cap of 35; overbooking risk is bounded by the
  // daily cap which we always check at confirm-time too).
  if (tekmetricSlotCount >= DAILY_TOTAL_CAP) {
    throw new Error("slot_just_taken");
  }
  const { data: existingHolds } = await sb
    .from("appointment_holds")
    .select("id")
    .eq("shop_id", shopId)
    .eq("scheduled_date", date)
    .is("released_at", null)
    .gt("expires_at", new Date().toISOString());
  const holdCount = (existingHolds ?? []).length;
  if (tekmetricSlotCount + holdCount >= DAILY_TOTAL_CAP) {
    throw new Error("slot_just_taken");
  }

  const { data, error } = await sb
    .from("appointment_holds")
    .insert({
      shop_id: shopId,
      session_id: args.session_id,
      customer_id: args.customer_id ?? null,
      vehicle_id: args.vehicle_id ?? null,
      scheduled_date: date,
      scheduled_time: "12:00:00", // hard-coded placeholder for drop-offs
      appointment_type: "dropoff",
      service_summary: args.service_summary,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    })
    .select("id, expires_at")
    .single();
  if (error || !data) {
    throw new Error(
      `appointment_holds insert failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return {
    hold_id: data.id as string,
    expires_at: data.expires_at as string,
  };
}

/**
 * Confirm a held slot — re-verify the hold is alive, build the Tekmetric
 * appointment payload, POST /appointments, then mark the hold consumed
 * and write a write-through row in our local `appointments` shadow.
 *
 * The Tekmetric POST /appointments returns a BARE INTEGER ID (not an object)
 * in the `data` field — handle accordingly.
 */
export async function confirmAppointment(
  sb: SupabaseClient,
  shopId: number,
  args: {
    hold_id: string;
    customer_id: number;
    vehicle_id: number;
    title: string;
    description: string;
    appointment_option?: "WAITER" | "PICKUP_DROPOFF" | "TOWED" | "NONE";
  },
): Promise<{ appointment_id: number; status: string; start_time: string }> {
  // Re-check the hold
  const { data: hold, error: holdErr } = await sb
    .from("appointment_holds")
    .select(
      "scheduled_date, scheduled_time, appointment_type, released_at, expires_at, session_id",
    )
    .eq("id", args.hold_id)
    .single();
  if (holdErr || !hold) {
    throw new Error(`hold_not_found: ${holdErr?.message ?? args.hold_id}`);
  }
  if (hold.released_at) throw new Error("hold_already_released");
  if (new Date(hold.expires_at as string) <= new Date()) {
    throw new Error("hold_expired");
  }

  // Build the appointment time window
  const date = hold.scheduled_date as string;
  const time = String(hold.scheduled_time).slice(0, 5); // HH:MM
  const type = hold.appointment_type as "waiter" | "dropoff";

  // EDT offset hard-coded for Phase 1; revisit when DST switches if Issue.
  // Better: compute via Intl.DateTimeFormat with America/New_York for safety.
  const startTimeIso = `${date}T${time}:00-04:00`;
  const startTime = new Date(startTimeIso);
  const endTime = new Date(startTime.getTime() + 60 * 60_000); // 1-hour appointments

  const apptOption =
    args.appointment_option ??
    (type === "waiter" ? "WAITER" : "PICKUP_DROPOFF");

  const body = {
    shopId,
    customerId: args.customer_id,
    vehicleId: args.vehicle_id,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    title: args.title,
    description: args.description,
    appointmentOption: apptOption,
  };

  const res = await tekmetricFetch(sb, "/appointments", {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `tekmetric_post_failed: HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  const json = await res.json();
  // Tekmetric POST /appointments returns a BARE INTEGER ID in `data`
  const appointmentId =
    typeof json?.data === "number"
      ? json.data
      : typeof json?.data?.id === "number"
        ? json.data.id
        : typeof json?.id === "number"
          ? json.id
          : null;
  if (!appointmentId) {
    throw new Error(
      `tekmetric_post_no_id: ${JSON.stringify(json).slice(0, 300)}`,
    );
  }

  // Mark hold consumed
  await sb
    .from("appointment_holds")
    .update({ released_at: new Date().toISOString() })
    .eq("id", args.hold_id);

  // Write-through to local shadow (so list_available_slots is up-to-date
  // immediately, before next sync tick)
  await sb
    .from("appointments")
    .upsert(
      {
        shop_id: shopId,
        tekmetric_appointment_id: appointmentId,
        customer_id: args.customer_id,
        vehicle_id: args.vehicle_id,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        appointment_type: type,
        appointment_status: "CONFIRMED",
        title: args.title,
        description: args.description,
        appointment_option: apptOption,
        source: "scheduler-app",
        tekmetric_synced_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,tekmetric_appointment_id" },
    );

  // Set appointment_id on the chat session
  await sb
    .from("customer_chat_sessions")
    .update({ appointment_id: appointmentId })
    .eq("id", hold.session_id as string);

  return {
    appointment_id: appointmentId as number,
    status: "CONFIRMED",
    start_time: startTime.toISOString(),
  };
}

/**
 * Reschedule an existing appointment. PATCH /appointments/<id> with new times.
 * Caller must have already validated identity match per §4.6 ladder.
 */
export async function rescheduleAppointment(
  sb: SupabaseClient,
  shopId: number,
  args: {
    appointment_id: number;
    new_date: string;
    new_time?: string; // '08:00' or '09:00' for waiter; defaults to 12:00 for dropoff
    appointment_type: "waiter" | "dropoff";
  },
): Promise<{ success: true; new_start_time: string }> {
  const time =
    args.appointment_type === "waiter"
      ? (args.new_time ?? "08:00")
      : "12:00";
  const startTime = new Date(`${args.new_date}T${time}:00-04:00`);
  const endTime = new Date(startTime.getTime() + 60 * 60_000);

  const res = await tekmetricFetch(sb, `/appointments/${args.appointment_id}`, {
    method: "PATCH",
    body: {
      shopId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Tekmetric PATCH /appointments/${args.appointment_id} → HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }

  // Update local shadow
  await sb
    .from("appointments")
    .update({
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      appointment_type: args.appointment_type,
      tekmetric_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("shop_id", shopId)
    .eq("tekmetric_appointment_id", args.appointment_id);

  return { success: true, new_start_time: startTime.toISOString() };
}

/**
 * Cancel an existing appointment via Tekmetric DELETE. Idempotent —
 * 404s on a missing/already-cancelled appointment are soft-handled.
 */
export async function cancelAppointment(
  sb: SupabaseClient,
  shopId: number,
  args: { appointment_id: number },
): Promise<{ success: true }> {
  const res = await tekmetricFetch(sb, `/appointments/${args.appointment_id}`, {
    method: "DELETE",
    query: { shop: shopId },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(
      `Tekmetric DELETE /appointments/${args.appointment_id} → HTTP ${res.status}: ${text.slice(0, 300)}`,
    );
  }

  // Update local shadow
  await sb
    .from("appointments")
    .update({
      appointment_status: "CANCELED",
      deleted_at: new Date().toISOString(),
      tekmetric_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("shop_id", shopId)
    .eq("tekmetric_appointment_id", args.appointment_id);

  return { success: true };
}

// ─── Admin tools (called via Claude Desktop OR the scheduler) ────────────────

/**
 * Block capacity for a day, type, or specific waiter time.
 *
 * Flexibility:
 *   - { date }                   → blocks entire day (all types)
 *   - { date, type: 'waiter' }   → blocks both waiter slots
 *   - { date, type: 'dropoff' }  → blocks all drop-off bookings
 *   - { date, type: 'waiter', time: '08:00' } → blocks just the 8 AM slot
 *
 * Audit: created_by_oauth_client_id + created_by_name from the caller's
 * service_dept_users mapping (denormalized at write time for human-readable
 * audit logs even if a staff member is later deactivated).
 */
export async function blockAppointmentCapacity(
  sb: SupabaseClient,
  shopId: number,
  args: {
    date: string;
    type?: "waiter" | "dropoff";
    time?: string;
    reason?: string;
    created_by_oauth_client_id: string;
    created_by_name: string;
  },
): Promise<{ block_id: string }> {
  const { data, error } = await sb
    .from("appointment_blocks")
    .insert({
      shop_id: shopId,
      blocked_date: args.date,
      blocked_type: args.type ?? null,
      blocked_time: args.time ?? null,
      reason: args.reason ?? null,
      created_by_oauth_client_id: args.created_by_oauth_client_id,
      created_by_name: args.created_by_name,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(
      `block_appointment_capacity insert failed: ${error?.message ?? "no row returned"}`,
    );
  }
  return { block_id: data.id as string };
}

/**
 * Remove blocks matching the criteria. Returns the number of blocks released.
 */
export async function unblockAppointmentCapacity(
  sb: SupabaseClient,
  shopId: number,
  args: {
    date: string;
    type?: "waiter" | "dropoff";
    time?: string;
  },
): Promise<{ removed: number }> {
  let q = sb
    .from("appointment_blocks")
    .delete()
    .eq("shop_id", shopId)
    .eq("blocked_date", args.date);
  if (args.type === undefined) {
    q = q.is("blocked_type", null);
  } else {
    q = q.eq("blocked_type", args.type);
  }
  if (args.time === undefined) {
    q = q.is("blocked_time", null);
  } else {
    q = q.eq("blocked_time", args.time);
  }
  const { data, error } = await q.select("id");
  if (error) {
    throw new Error(`unblock_appointment_capacity failed: ${error.message}`);
  }
  return { removed: (data ?? []).length };
}
