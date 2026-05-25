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
// P1.6 + P1.6-followup (2026-05-25): every clock read in this function
// flows from a SINGLE per-request snapshot via `getShopClock()`. Both
// the same-day cutoff (P1.6) AND the window start/end dates AND the
// active-holds expiry filter AND the appointment range filter all
// derive from the same snapshot. Eliminates the cross-clock-call
// drift that the original `new Date()`-everywhere pattern accumulated
// across 4 supabase filters within one render.
import { getShopClock } from "@/lib/scheduler/shop-clock";
import {
  SAME_DAY_CUTOFF_HOUR,
  shopLocalToIsoString,
} from "@/lib/scheduler/wizard/shop-tz";

const SHOP_TIMEZONE = "America/New_York"; // Phase 1 single-shop

export interface ComputeAvailableDatesArgs {
  appointment_type: "waiter" | "dropoff";
  days_ahead: number;
}

/**
 * Add N days to a "YYYY-MM-DD" string, returning the resulting
 * "YYYY-MM-DD" string. Pure calendar arithmetic via UTC noon (DST-safe
 * anchor — adding 1 day at noon UTC always lands on the next UTC date
 * regardless of which timezone observes DST overnight).
 */
function addDaysToYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Day-of-week (0-6, Sunday=0) for a "YYYY-MM-DD" string. Calendar
 * dates have one day-of-week regardless of timezone; noon UTC is a
 * safe DST-anchor for the underlying Date.
 */
function dayOfWeekForYmd(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

export async function computeAvailableDates(
  args: ComputeAvailableDatesArgs,
): Promise<string[]> {
  const supabase = createSupabaseAdminClient();

  // P1.6-followup (2026-05-25): the single per-request snapshot drives
  // ALL clock-derived values: window dates (today + N), TIMESTAMPTZ
  // comparison instants (now_utc_iso for hold expiry, shop-local
  // midnight ISOs for appointment range), AND the same-day cutoff
  // (already P1.6). Inside one render, these all agree.
  const shopNow = await getShopClock();
  const todayYmd = shopNow.date;
  const endYmd = addDaysToYmd(todayYmd, args.days_ahead);

  // For TIMESTAMPTZ range filters on appointments.start_time, convert
  // shop-local-midnight to its UTC instant. shopLocalToIsoString
  // handles DST automatically — "2026-06-10T00:00:00-04:00" in EDT
  // vs "-05:00" in EST.
  const startIsoTz = shopLocalToIsoString(todayYmd, "00:00");
  const endIsoTz = shopLocalToIsoString(endYmd, "00:00");

  // Layer 1: closed_dates in the window. DATE column → string compare.
  const { data: closed, error: closedErr } = await supabase
    .from("closed_dates")
    .select("closed_date")
    .gte("closed_date", todayYmd)
    .lt("closed_date", endYmd);
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
    .gte("blocked_date", todayYmd)
    .lt("blocked_date", endYmd);
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

  // Layer 4: active holds (not released, not expired) — ALL TYPES.
  // 2026-05-25 audit: same fix as the appointments query below — the
  // edge fn's holdAppointmentSlot counts ALL hold types toward the
  // dropoff_total cap (per the "daily cap across all types" design).
  // Removed the `.eq("appointment_type", ...)` filter so this picker
  // agrees. SELECT now includes appointment_type so per-type bucketing
  // (waiter slot caps) stays correct below.
  //
  // P1.6-followup (2026-05-25): expires_at compared against the
  // snapshot's UTC instant so this filter agrees with the rest of
  // the render's time-based decisions.
  const { data: holds, error: holdsErr } = await supabase
    .from("appointment_holds")
    .select("scheduled_date, scheduled_time, appointment_type")
    .gte("scheduled_date", todayYmd)
    .lt("scheduled_date", endYmd)
    .is("released_at", null)
    .gt("expires_at", shopNow.now_utc_iso);
  if (holdsErr) {
    throw new Error(`appointment_holds query failed: ${holdsErr.message}`);
  }

  // Layer 4: non-cancelled appointments in the window — ALL TYPES,
  // not just args.appointment_type.
  //
  // 2026-05-25 audit (live-traced): the prior `.eq("appointment_type",
  // args.appointment_type)` filter created a count-mismatch between
  // this picker and the edge fn's `holdAppointmentSlot` capacity check.
  // The edge fn correctly counts ALL types toward `dropoff_total` per
  // the original design ("Daily cap = 35 across all types" — see the
  // scheduler-slots.ts file header). This picker was counting only
  // dropoffs → on a day with e.g. 27 dropoff + 5 waiter = 32 total,
  // 27 < 31 cap → picker offered the day; customer clicks → edge fn
  // sees 32 ≥ 31 → "slot_just_taken" → wizard appears broken with
  // bubble "That day just got booked up". Confirmed via DB forensics
  // on session b1223666 + appointments table count (May 26 ET: 27
  // dropoff_only vs 32 all_types vs cap 31).
  //
  // Fix: drop the type filter on the SELECT; the dropoff branch below
  // sums total across all types (matching edge fn). The waiter branch
  // still buckets only waiter appointments by hour for the per-slot
  // sub-caps (waiter_8am_slots / waiter_9am_slots) — that part of the
  // logic is correct since waiter slot caps are per-type-per-slot.
  //
  // P1.6-followup (2026-05-25): startIsoTz / endIsoTz come from
  // shopLocalToIsoString() — DST-aware UTC instants matching the shop
  // calendar boundary.
  const { data: appts, error: apptsErr } = await supabase
    .from("appointments")
    .select("start_time, appointment_type, appointment_status")
    .gte("start_time", startIsoTz)
    .lt("start_time", endIsoTz)
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
  // `total` increments for EVERY row (matches edge fn behavior — all
  // types count toward dropoff_total daily cap). `time_08` / `time_09`
  // increment only for WAITER rows in the matching slot, so the
  // per-slot waiter sub-caps (waiter_8am_slots / waiter_9am_slots)
  // remain type-bounded.
  function bump(
    date: string,
    slot: "08:00" | "09:00" | null,
    type: "waiter" | "dropoff" | null,
  ) {
    if (!counts.has(date)) {
      counts.set(date, { time_08: 0, time_09: 0, total: 0 });
    }
    const c = counts.get(date)!;
    c.total += 1;
    if (type === "waiter") {
      if (slot === "08:00") c.time_08 += 1;
      if (slot === "09:00") c.time_09 += 1;
    }
  }

  for (const h of holds ?? []) {
    const t = String(h.scheduled_time ?? "").slice(0, 5);
    const slot = t === "08:00" ? "08:00" : t === "09:00" ? "09:00" : null;
    const type = (h.appointment_type as "waiter" | "dropoff" | null) ?? null;
    bump(h.scheduled_date as string, slot, type);
  }
  for (const a of appts ?? []) {
    const status = a.appointment_status as string;
    if (status === "CANCELED" || status === "NO_SHOW") continue;
    const st = a.start_time as string | null;
    if (!st) continue;
    const { date, hour } = shopLocalDateAndHour(st);
    const slot = hour === 8 ? "08:00" : hour === 9 ? "09:00" : null;
    const type = (a.appointment_type as "waiter" | "dropoff" | null) ?? null;
    bump(date, slot, type);
  }

  // Layer 5: walk the window and decide each date. String-date walk
  // via addDaysToYmd — same date sequence as a UTC Date walk but
  // without the second cursor=new Date() that could drift from
  // shopNow.date if rendering crossed midnight UTC.
  const result: string[] = [];
  for (let date = todayYmd; date < endYmd; date = addDaysToYmd(date, 1)) {
    if (closedSet.has(date)) continue;

    const dow = dayOfWeekForYmd(date);
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

  // Same-day filter (added 2026-05-18 per Chris's directive). Drop today
  // from the result when either:
  //   - appointment_type === 'waiter' — waiter slots are 8/9 AM only,
  //     same-day is always past the slot.
  //   - shop-local time is at or past SAME_DAY_CUTOFF_HOUR (12 PM ET) —
  //     drop-off after noon is too late to be useful for our techs.
  // Applied at the end so capacity math above is unaffected; this is a
  // pure output filter. The defensive check in submit-date.ts catches
  // the rare race where a customer crosses noon mid-flight.
  //
  // P1.6 (2026-05-25): clock source is the Postgres RPC via getShopClock
  // (per-request memoized via React `cache()`). availability.ts +
  // submit-date.ts share the same snapshot within a render, eliminating
  // the cross-clock drift class. Reuses the `shopNow` snapshot from
  // the top of this function — same instant for the window AND the
  // cutoff filter.
  const blockSameDay =
    args.appointment_type === "waiter" ||
    shopNow.hour >= SAME_DAY_CUTOFF_HOUR;
  if (blockSameDay) {
    return result.filter((d) => d !== shopNow.date);
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
