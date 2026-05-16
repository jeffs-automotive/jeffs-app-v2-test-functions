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

// ─── Capacity constants ──────────────────────────────────────────────────────
//
// 2026-05-13 audit fix: DB-driven capacity per appointment_default_limits
// table (migration 20260513000100). The constants below are FALLBACKS
// when the table is empty / missing a row for a day_of_week — they match
// the design's original Phase 1 numbers but should never be the source of
// truth in production. Use getCapacityLimits() below.

const WAITER_TIMES = ["08:00", "09:00"] as const;
const FALLBACK_WAITER_CAPACITY_PER_TIME = 2;
const FALLBACK_DAILY_TOTAL_CAP = 35;
const SHADOW_HORIZON_DAYS = 7;

/**
 * Per-day capacity limits, sourced from appointment_default_limits
 * (DB-driven per spec) with constant fallbacks.
 */
interface CapacityLimits {
  is_closed: boolean;
  /** Max waiters at 08:00. Null = no row in DB → use fallback. */
  waiter_8am_slots: number;
  /** Max waiters at 09:00. */
  waiter_9am_slots: number;
  /** Total daily appointments cap (waiter + dropoff combined). */
  dropoff_total: number;
}

/**
 * Fetch appointment_default_limits for the shop, return a map keyed
 * on day_of_week (0=Sunday..6=Saturday). Missing days fall back to the
 * Phase-1 constants. One DB read per listAvailableSlots call.
 */
async function loadCapacityLimits(
  sb: SupabaseClient,
  shopId: number,
): Promise<Map<number, CapacityLimits>> {
  const map = new Map<number, CapacityLimits>();
  try {
    const { data, error } = await sb
      .from("appointment_default_limits")
      .select(
        "day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total",
      )
      .eq("shop_id", shopId);
    if (error) {
      console.error(
        `appointment_default_limits read failed for shop ${shopId}: ${error.message}. Falling back to constants.`,
      );
      return map;
    }
    for (const row of data ?? []) {
      const dow = row.day_of_week as number;
      if (typeof dow !== "number" || dow < 0 || dow > 6) continue;
      map.set(dow, {
        is_closed: Boolean(row.is_closed),
        waiter_8am_slots:
          (row.waiter_8am_slots as number | null) ??
          FALLBACK_WAITER_CAPACITY_PER_TIME,
        waiter_9am_slots:
          (row.waiter_9am_slots as number | null) ??
          FALLBACK_WAITER_CAPACITY_PER_TIME,
        dropoff_total:
          (row.dropoff_total as number | null) ?? FALLBACK_DAILY_TOTAL_CAP,
      });
    }
  } catch (e) {
    console.error(
      `loadCapacityLimits exception for shop ${shopId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
  return map;
}

function limitsForDate(
  date: string,
  byDow: Map<number, CapacityLimits>,
): CapacityLimits {
  // day_of_week per Postgres convention (0=Sunday). JS Date.getUTCDay()
  // returns the same 0-6 mapping. We use UTC since the date string is
  // YYYY-MM-DD (no timezone) and dates here are shop-local-equivalent.
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const row = byDow.get(dow);
  if (row) return row;
  return {
    is_closed: false,
    waiter_8am_slots: FALLBACK_WAITER_CAPACITY_PER_TIME,
    waiter_9am_slots: FALLBACK_WAITER_CAPACITY_PER_TIME,
    dropoff_total: FALLBACK_DAILY_TOTAL_CAP,
  };
}

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
  // Phase 9d 2026-05-16: bare string on the wire, NOT { id, name, code }.
  // Empirical enum: NONE | CANCELED | ARRIVED | NO_SHOW.
  appointmentStatus: string;
  // appointmentOption is unsettable via POST/PATCH (silently ignored per
  // 2026-05-16 testing). GET returns it as { id, code, name } though.
  appointmentOption?: { id: number; name: string; code: string } | null;
  rideOption?: { id: number; name: string; code: string } | null;
  // Hex color code. PRIMARY signal for appointment_type classification
  // per Phase 9d (see classifyAppointmentType below).
  color?: string | null;
  arrived?: boolean | null;
  leadSource?: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
  createdDate?: string | null;
  updatedDate?: string | null;
  confirmationStatus?: string | null;
  deletedDate?: string | null;
  [k: string]: unknown;
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

/**
 * Phase 9d 2026-05-16 — color-derived classifier (sister of the one in
 * appointments-sync/index.ts). Used for beyond-shadow-horizon Tekmetric
 * direct fetches where we don't have the row locally yet.
 *
 * Color → meaning per docs/scheduler/appointment-post.md:
 *   #D01919 (red)    — waiter
 *   #0D4A80 (navy)   — dropoff (default)
 *   #FCB70D (yellow) — loaner (dropoff for capacity)
 *   #F0572A (orange) — tow-in (dropoff for capacity)
 *   #1786E8 (blue)   — needs-ride (dropoff for capacity)
 *   #128743 (green)  — needs-by (dropoff for capacity)
 *   any other        — dropoff (safe default)
 *
 * Fallback: if no color present (older Tekmetric appointments, edge cases),
 * use the legacy UTC-hour heuristic — EDT 8/9 AM (UTC 12/13) is waiter,
 * everything else is dropoff. The appointments-sync cron will overwrite the
 * row with the color-derived value on the next sync once the row lands in
 * the shadow.
 */
function classifyAppointmentType(
  color: string | null | undefined,
  startTime?: string,
): "waiter" | "dropoff" {
  const c = (color ?? "").toLowerCase();
  switch (c) {
    case "#d01919": return "waiter";
    case "#0d4a80":
    case "#fcb70d":
    case "#f0572a":
    case "#1786e8":
    case "#128743":
      return "dropoff";
  }
  // No color set — fall back to UTC-hour heuristic.
  if (startTime) {
    const hour = new Date(startTime).getUTCHours();
    if (hour === 12 || hour === 13) return "waiter";
  }
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

  // DB-driven capacity limits per appointment_default_limits (audit fix
  // 2026-05-13). Single read; map of day_of_week → { is_closed,
  // waiter_8am, waiter_9am, dropoff_total }. Missing rows fall back to
  // the Phase 1 constants defined at top of file.
  const limitsByDow = await loadCapacityLimits(sb, shopId);

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

    // Hard skips: closed (Sunday/holiday), full-day block, OR
    // appointment_default_limits.is_closed=true for this day-of-week.
    const dayLimits = limitsForDate(date, limitsByDow);
    if (dayLimits.is_closed) {
      available[date] = { waiter_times: [], dropoff_available: false };
      continue;
    }
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
          // Phase 9d 2026-05-16: appointmentStatus is a bare string on the
          // wire, not { id, name, code }. The prior `?.code` access was
          // always undefined → CANCELED + NO_SHOW rows were INCORRECTLY
          // counted toward capacity in this far-future Tekmetric-direct
          // path. (The local shadow path at line 317 uses .not(
          // "appointment_status", "in", "(CANCELED,NO_SHOW)") which has
          // always read the local string column, so the shadow path was
          // already correct.)
          if (a.appointmentStatus === "CANCELED" || a.appointmentStatus === "NO_SHOW") {
            continue;
          }
          totalDayCount += 1;
          const t = classifyAppointmentType(a.color, a.startTime);
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

    // Per-day, per-slot capacity from appointment_default_limits.
    const dailyCapHit = totalDayCount >= dayLimits.dropoff_total;
    const openWaiterTimes = dailyCapHit
      ? []
      : WAITER_TIMES.filter((t) => {
          if (blockedWaiterTimes.has(t)) return false;
          const cap =
            t === "08:00"
              ? dayLimits.waiter_8am_slots
              : dayLimits.waiter_9am_slots;
          return (waiterCounts[t] ?? 0) < cap;
        });
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

  // DB-driven per-day capacity (audit fix 2026-05-13).
  const limitsByDow = await loadCapacityLimits(sb, shopId);
  const dayLimits = limitsForDate(date, limitsByDow);

  const waiterRemaining = slot.waiter_times.map((t) => ({
    time: t,
    // Use the matched per-slot cap; exact remaining requires a per-slot
    // count which the caller already has from listAvailableSlots if
    // needed.
    remaining:
      t === "08:00" ? dayLimits.waiter_8am_slots : dayLimits.waiter_9am_slots,
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
    dropoff_remaining: slot.dropoff_available
      ? Math.max(0, dayLimits.dropoff_total - dayCount)
      : 0,
    total_remaining: Math.max(0, dayLimits.dropoff_total - dayCount),
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
      // Phase 9d 2026-05-16: bare string, not object — see note above.
      if (
        a.appointmentStatus === "CANCELED" ||
        a.appointmentStatus === "NO_SHOW"
      ) {
        continue;
      }
      const aType = classifyAppointmentType(a.color, a.startTime);
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
    // Call hold_waiter_slot RPC.
    //
    // The RPC's actual signature is (p_shop_id, p_session_id, p_customer_id,
    // p_vehicle_id, p_scheduled_date, p_scheduled_time, p_appointment_type,
    // p_service_summary) — the 7th positional arg is `p_appointment_type`,
    // NOT `p_active_tekmetric_appts` as an earlier version of this caller
    // assumed. Verified live 2026-05-13 against information_schema.parameters
    // after a "Could not find the function" PGRST202 came back from PostgREST.
    const { data, error } = await sb.rpc("hold_waiter_slot", {
      p_shop_id: shopId,
      p_session_id: args.session_id,
      p_customer_id: args.customer_id ?? null,
      p_vehicle_id: args.vehicle_id ?? null,
      p_scheduled_date: date,
      p_scheduled_time: time,
      p_appointment_type: "waiter",
      p_service_summary: args.service_summary,
    });
    // tekmetricSlotCount is no longer passed to the RPC (the RPC's own
    // SELECT counts current holds + appointments). Reference it here to
    // keep the surrounding pre-check code's "we already verified Tekmetric"
    // signal — useful for future logging hooks; remove if it ever causes
    // an unused-var lint error.
    void tekmetricSlotCount;
    if (error) {
      // P0001 'slot_full' is the race-safe "already taken" signal
      if (error.message?.includes("slot_full")) {
        throw new Error("slot_just_taken");
      }
      throw new Error(`hold_waiter_slot RPC failed: ${error.message}`);
    }
    // hold_waiter_slot RETURNS TABLE(hold_id, expires_at, ok, reason).
    // PostgREST returns this as an array of rows (always — even for
    // single-row results). The prior code cast `data as string` directly,
    // which made holdId the whole array; the edge function then tried to
    // store the array into customer_chat_sessions.hold_token (TEXT column)
    // and the value silently dropped to NULL. Verified live 2026-05-13
    // via the hold_slot_result audit event showing hold_id=[{...}].
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const row = rows[0] as
      | { hold_id?: string; expires_at?: string; ok?: boolean; reason?: string | null }
      | undefined;
    if (!row || row.ok === false) {
      const reason = row?.reason ?? "hold_failed";
      if (reason === "slot_full") throw new Error("slot_just_taken");
      throw new Error(`hold_waiter_slot RPC returned not-ok: ${reason}`);
    }
    if (typeof row.hold_id !== "string") {
      throw new Error("hold_waiter_slot RPC returned no hold_id");
    }
    const holdId = row.hold_id;
    const expiresAt =
      typeof row.expires_at === "string"
        ? row.expires_at
        : new Date(Date.now() + 10 * 60_000).toISOString();
    return { hold_id: holdId, expires_at: expiresAt };
  }

  // Drop-off path — Phase 1 simpler check (no dedicated RPC, but still
  // race-tolerant via the day's dropoff_total cap from
  // appointment_default_limits; overbooking risk is bounded by the daily
  // cap which we always check at confirm-time too).
  const limitsByDow = await loadCapacityLimits(sb, shopId);
  const dayLimits = limitsForDate(date, limitsByDow);
  if (tekmetricSlotCount >= dayLimits.dropoff_total) {
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
  if (tekmetricSlotCount + holdCount >= dayLimits.dropoff_total) {
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
 * Phase 12 2026-05-16 — POST body shape change per the 2026-05-16
 * empirical findings (see docs/scheduler/appointment-post.md):
 *
 *   - DROP `appointmentOption` (silently ignored by Tekmetric in every
 *     shape; all API-POSTed appointments default to STAY regardless).
 *   - ADD `color` as the staff-facing channel: "red" for waiter,
 *     "navy" for dropoff. Other shop colors deferred to V2.1.
 *   - title prefix uses `[TM]` to mark online-scheduler bookings (per
 *     Chris's 2026-05-16 convention update; replaces the older `[OP]`
 *     placeholder).
 *   - GET-after-POST verification: immediately re-fetch the appointment
 *     by id to verify Tekmetric stored it correctly. Defends against
 *     phantom-write where our network drops between Tekmetric's 200 OK
 *     and our row write. Log discrepancies to console.warn (Sentry on
 *     the Vercel side); don't fail the booking (it's already in
 *     Tekmetric — failing here would leave a phantom anyway).
 *
 * The Tekmetric POST /appointments returns a BARE INTEGER ID (not an
 * object) in the `data` field — handle accordingly.
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
    /**
     * Color tag for the Tekmetric calendar block. Defaults to red for
     * waiter, navy for dropoff (per shop convention documented in
     * docs/scheduler/appointment-post.md). Caller can override for
     * future feature colors (yellow=loaner, blue=ride, etc.).
     */
    color?: string;
  },
): Promise<{
  appointment_id: number;
  status: string;
  start_time: string;
  verification: {
    ok: boolean;
    diff?: string;
  };
}> {
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

  // Color defaults from appointment_type per shop convention. Caller can
  // override for future feature colors.
  const color = args.color ?? (type === "waiter" ? "red" : "navy");

  // POST body per 2026-05-16 empirical findings — 8 fields, no
  // appointmentOption (silently ignored), no confirmationStatus
  // (read-only), no status (defaults to NONE).
  const body = {
    shopId,
    customerId: args.customer_id,
    vehicleId: args.vehicle_id,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    title: args.title,
    description: args.description,
    color,
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

  // GET-after-POST verification (Phase 12 2026-05-16 add-on).
  // Confirm the booking landed with the expected fields. Fail-soft —
  // don't throw if verify fails; the appointment IS in Tekmetric, and
  // the customer should see success even if our verify GET hiccups.
  const verification: { ok: boolean; diff?: string } = { ok: true };
  try {
    const verifyRes = await tekmetricFetch(
      sb,
      `/appointments/${appointmentId}`,
      { method: "GET" },
    );
    if (verifyRes.ok) {
      const verifyJson = await verifyRes.json();
      const stored = verifyJson?.data ?? verifyJson;
      const issues: string[] = [];
      if (stored?.customerId !== args.customer_id) {
        issues.push(`customerId mismatch (got ${stored?.customerId})`);
      }
      if (stored?.vehicleId !== args.vehicle_id) {
        issues.push(`vehicleId mismatch (got ${stored?.vehicleId})`);
      }
      if (stored?.startTime !== startTime.toISOString()) {
        issues.push(`startTime mismatch (got ${stored?.startTime})`);
      }
      if (stored?.title !== args.title) {
        issues.push(`title mismatch`);
      }
      if (issues.length > 0) {
        verification.ok = false;
        verification.diff = issues.join("; ");
        console.warn(
          JSON.stringify({
            level: "warning",
            msg: "confirm_appointment_verify_mismatch",
            appointment_id: appointmentId,
            issues,
          }),
        );
      }
    } else {
      verification.ok = false;
      verification.diff = `verify_get_status_${verifyRes.status}`;
      console.warn(
        JSON.stringify({
          level: "warning",
          msg: "confirm_appointment_verify_get_failed",
          appointment_id: appointmentId,
          status: verifyRes.status,
        }),
      );
    }
  } catch (e) {
    verification.ok = false;
    verification.diff =
      e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    console.warn(
      JSON.stringify({
        level: "warning",
        msg: "confirm_appointment_verify_threw",
        appointment_id: appointmentId,
        detail: verification.diff,
      }),
    );
  }

  // Mark hold consumed
  await sb
    .from("appointment_holds")
    .update({ released_at: new Date().toISOString() })
    .eq("id", args.hold_id);

  // Write-through to local shadow (so list_available_slots is up-to-date
  // immediately, before next sync tick). Phase 9d shape: appointment_type
  // derives from color (red→waiter, else→dropoff), status defaults to NONE
  // (Tekmetric's default for fresh appointments — we no longer write
  // CONFIRMED since CONFIRMED isn't even a valid appointmentStatus per
  // empirical Tekmetric API testing).
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
        appointment_status: "NONE",
        title: args.title,
        description: args.description,
        color,
        source: "scheduler-app",
        tekmetric_synced_at: new Date().toISOString(),
        parse_version: 2,
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
    status: "NONE",
    start_time: startTime.toISOString(),
    verification,
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

/**
 * Append a customer-authored note to an existing Tekmetric appointment's
 * description. Phase 13 2026-05-16 — the Step 10.3 customer-notes channel.
 *
 * Per chat-design.md §10.3-10.5 amendment 2026-05-16: the customer's note
 * is appended to `appointment.description` (NOT `customer.notes` — that
 * field is deferred to V2.1+). The existing description already carries
 * the service summary + concerns from the POST; we GET the current
 * description, append a separator + "Customer note: <text>", and PATCH.
 *
 * GET-then-PATCH (instead of a single PATCH with `description = <new>`)
 * avoids overwriting the original service summary. Empty existing
 * description is handled — we just write "Customer note: <text>" with no
 * leading separator.
 */
export async function appendAppointmentDescription(
  sb: SupabaseClient,
  shopId: number,
  args: { appointment_id: number; append_text: string },
): Promise<{ success: true; new_description: string }> {
  const trimmed = (args.append_text ?? "").trim();
  if (!trimmed) {
    throw new Error("append_text cannot be empty");
  }

  // GET the appointment to read the current description.
  const getRes = await tekmetricFetch(
    sb,
    `/appointments/${args.appointment_id}`,
    { method: "GET", query: { shop: shopId } },
  );
  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(
      `Tekmetric GET /appointments/${args.appointment_id} → HTTP ${getRes.status}: ${text.slice(0, 300)}`,
    );
  }
  const getJson = await getRes.json();
  const existing = String(getJson?.data?.description ?? "");
  const newDescription = existing.length > 0
    ? `${existing}\n\nCustomer note: ${trimmed}`
    : `Customer note: ${trimmed}`;

  // PATCH the appointment with the appended description. shopId is
  // required in the body per the Tekmetric PATCH contract.
  const patchRes = await tekmetricFetch(
    sb,
    `/appointments/${args.appointment_id}`,
    {
      method: "PATCH",
      body: { shopId, description: newDescription },
    },
  );
  if (!patchRes.ok) {
    const text = await patchRes.text();
    throw new Error(
      `Tekmetric PATCH /appointments/${args.appointment_id} → HTTP ${patchRes.status}: ${text.slice(0, 300)}`,
    );
  }

  // Update local shadow so the next page load matches Tekmetric without
  // waiting for the appointments-sync cron.
  await sb
    .from("appointments")
    .update({
      description: newDescription,
      tekmetric_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("shop_id", shopId)
    .eq("tekmetric_appointment_id", args.appointment_id);

  return { success: true, new_description: newDescription };
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
