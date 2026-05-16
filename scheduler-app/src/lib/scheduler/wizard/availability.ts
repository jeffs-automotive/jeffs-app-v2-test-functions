/**
 * Deterministic slot-availability helper for the V2 wizard.
 *
 * Phase 10 (2026-05-15): extracted from session-actions.ts so both the legacy
 * /book chat AND the new /book-v2 wizard can use the same capacity math.
 * Phase 16 deletes session-actions.ts entirely; this helper survives that
 * cleanup as the canonical source.
 *
 * Applies the full 5-layer availability stack per chat-design.md §9 + the
 * Phase 1 schema migration spec:
 *
 *   1. Skip dates in closed_dates (Sundays + holidays)
 *   2. Skip dates whose day-of-week is_closed in appointment_default_limits
 *   3. Skip dates with a date-wide appointment_blocks entry for this type
 *      (blocked_type IS NULL OR blocked_type = args.appointment_type) AND
 *      blocked_time IS NULL
 *   4. For each remaining date, count active holds + non-cancelled
 *      appointments matching the type. Time-specific appointment_blocks
 *      entries zero out the affected slot's capacity.
 *   5. Skip the date if total counts >= total remaining capacity:
 *        - waiter: capacity = waiter_8am_slots + waiter_9am_slots (after
 *          subtracting time-blocked slots). Date is available if EITHER
 *          8 AM or 9 AM has room.
 *        - dropoff: capacity = dropoff_total. Date is available if the
 *          combined count is below dropoff_total.
 *
 * Returns a sorted array of YYYY-MM-DD strings for days in the next
 * `days_ahead` window that have ACTUAL remaining capacity for
 * `appointment_type`.
 *
 * Times for waiter slots are extracted from appointment.start_time using
 * the shop timezone (America/New_York) to handle DST correctly. Holds are
 * stored with HH:MM in scheduled_time already.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SHOP_TIMEZONE = "America/New_York"; // Phase 1 single-shop

export interface ComputeAvailableDatesArgs {
  appointment_type: "waiter" | "dropoff";
  days_ahead: number;
}

export async function computeAvailableDates(
  args: ComputeAvailableDatesArgs,
): Promise<string[]> {
  const supabase = createSupabaseAdminClient();

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(today);
  endDate.setUTCDate(endDate.getUTCDate() + args.days_ahead);
  const ymd = (d: Date): string => d.toISOString().slice(0, 10);

  // Layer 1: closed_dates in the window.
  const { data: closed, error: closedErr } = await supabase
    .from("closed_dates")
    .select("closed_date")
    .gte("closed_date", ymd(today))
    .lt("closed_date", ymd(endDate));
  if (closedErr) {
    throw new Error(`closed_dates query failed: ${closedErr.message}`);
  }
  const closedSet = new Set(
    (closed ?? []).map((r) => r.closed_date as string),
  );

  // Layer 2: appointment_default_limits per day-of-week.
  const { data: limits, error: limitsErr } = await supabase
    .from("appointment_default_limits")
    .select(
      "day_of_week, is_closed, waiter_8am_slots, waiter_9am_slots, dropoff_total",
    );
  if (limitsErr) {
    throw new Error(
      `appointment_default_limits query failed: ${limitsErr.message}`,
    );
  }
  type DowLimit = {
    is_closed: boolean;
    waiter_8am_slots: number;
    waiter_9am_slots: number;
    dropoff_total: number;
  };
  const limitsByDow = new Map<number, DowLimit>();
  for (const r of limits ?? []) {
    limitsByDow.set(r.day_of_week as number, {
      is_closed: !!r.is_closed,
      waiter_8am_slots: Number(r.waiter_8am_slots ?? 0),
      waiter_9am_slots: Number(r.waiter_9am_slots ?? 0),
      dropoff_total: Number(r.dropoff_total ?? 0),
    });
  }

  // Layer 3+4: appointment_blocks for this type in the window.
  // A row with blocked_time=NULL fully blocks the date+type; a row with
  // blocked_time set zeroes a specific slot's capacity.
  const { data: blocks, error: blocksErr } = await supabase
    .from("appointment_blocks")
    .select("blocked_date, blocked_type, blocked_time")
    .gte("blocked_date", ymd(today))
    .lt("blocked_date", ymd(endDate));
  if (blocksErr) {
    throw new Error(`appointment_blocks query failed: ${blocksErr.message}`);
  }
  const fullyBlockedDates = new Set<string>();
  const blockedSlotsByDate = new Map<string, Set<string>>();
  for (const b of blocks ?? []) {
    const bType = b.blocked_type as string | null;
    if (bType !== null && bType !== args.appointment_type) continue;
    const bDate = b.blocked_date as string;
    const bTime = b.blocked_time as string | null;
    if (bTime === null) {
      fullyBlockedDates.add(bDate);
    } else {
      const slot = bTime.slice(0, 5);
      if (!blockedSlotsByDate.has(bDate)) {
        blockedSlotsByDate.set(bDate, new Set());
      }
      blockedSlotsByDate.get(bDate)!.add(slot);
    }
  }

  // Layer 4: active holds (not released, not expired) for this type.
  const nowIso = new Date().toISOString();
  const { data: holds, error: holdsErr } = await supabase
    .from("appointment_holds")
    .select("scheduled_date, scheduled_time")
    .eq("appointment_type", args.appointment_type)
    .gte("scheduled_date", ymd(today))
    .lt("scheduled_date", ymd(endDate))
    .is("released_at", null)
    .gt("expires_at", nowIso);
  if (holdsErr) {
    throw new Error(`appointment_holds query failed: ${holdsErr.message}`);
  }

  // Layer 4: non-cancelled appointments for this type in the window.
  // appointments.start_time is TIMESTAMPTZ; filter by start_time within
  // [today, endDate) UTC. We'll bucket by shop-local date afterward.
  const { data: appts, error: apptsErr } = await supabase
    .from("appointments")
    .select("start_time, appointment_type, appointment_status")
    .eq("appointment_type", args.appointment_type)
    .gte("start_time", today.toISOString())
    .lt("start_time", endDate.toISOString())
    .is("deleted_at", null);
  if (apptsErr) {
    throw new Error(`appointments query failed: ${apptsErr.message}`);
  }

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
    const yyyy = get("year");
    const mm = get("month");
    const dd = get("day");
    const hh = parseInt(get("hour"), 10);
    return { date: `${yyyy}-${mm}-${dd}`, hour: hh };
  }

  type DateCounts = { time_08: number; time_09: number; total: number };
  const counts = new Map<string, DateCounts>();
  function bump(date: string, slot: "08:00" | "09:00" | null) {
    if (!counts.has(date)) {
      counts.set(date, { time_08: 0, time_09: 0, total: 0 });
    }
    const c = counts.get(date)!;
    c.total += 1;
    if (slot === "08:00") c.time_08 += 1;
    if (slot === "09:00") c.time_09 += 1;
  }

  for (const h of holds ?? []) {
    const t = String(h.scheduled_time ?? "").slice(0, 5);
    const slot = t === "08:00" ? "08:00" : t === "09:00" ? "09:00" : null;
    bump(h.scheduled_date as string, slot);
  }
  for (const a of appts ?? []) {
    const status = a.appointment_status as string;
    if (status === "CANCELED" || status === "NO_SHOW") continue;
    const st = a.start_time as string | null;
    if (!st) continue;
    const { date, hour } = shopLocalDateAndHour(st);
    const slot = hour === 8 ? "08:00" : hour === 9 ? "09:00" : null;
    bump(date, slot);
  }

  // Layer 5: walk the window and decide each date.
  const result: string[] = [];
  for (
    let cursor = new Date(today);
    cursor < endDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const date = ymd(cursor);
    if (closedSet.has(date)) continue;

    const dow = cursor.getUTCDay();
    const lim = limitsByDow.get(dow);
    if (!lim || lim.is_closed) continue;

    if (fullyBlockedDates.has(date)) continue;

    const dateCounts = counts.get(date) ?? {
      time_08: 0,
      time_09: 0,
      total: 0,
    };
    const blockedSlots = blockedSlotsByDate.get(date) ?? new Set<string>();

    if (args.appointment_type === "waiter") {
      const cap8 = blockedSlots.has("08:00") ? 0 : lim.waiter_8am_slots;
      const cap9 = blockedSlots.has("09:00") ? 0 : lim.waiter_9am_slots;
      const has8 = cap8 > 0 && dateCounts.time_08 < cap8;
      const has9 = cap9 > 0 && dateCounts.time_09 < cap9;
      if (!has8 && !has9) continue;
    } else {
      const cap = lim.dropoff_total;
      if (cap <= 0 || dateCounts.total >= cap) continue;
    }

    result.push(date);
  }
  return result;
}

/**
 * Convenience wrapper: returns the FIRST available date in the window, or
 * null when none exist. Phase 10 appointment_type pre-compute uses this to
 * build the "Earliest: <date>" hint per choice.
 */
export async function getEarliestAvailableDate(
  appointment_type: "waiter" | "dropoff",
  days_ahead = 30,
): Promise<string | null> {
  const dates = await computeAvailableDates({ appointment_type, days_ahead });
  return dates[0] ?? null;
}
