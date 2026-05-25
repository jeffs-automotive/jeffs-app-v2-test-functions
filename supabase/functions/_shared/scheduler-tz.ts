// scheduler-tz.ts — shop-local timezone helpers for Deno edge functions.
//
// 2026-05-25 extraction — was inline in `_shared/tools/scheduler-slots.ts`
// only. Promoted to a shared module after the post-fix audit found 4
// more callsites doing UTC-vs-shop-local math that needed these helpers
// (appointments-sync window, scheduler-slots listAvailableSlots +
// getSlotCapacity, plus the already-fixed holdAppointmentSlot in
// scheduler-slots.ts via the same shopLocalDayBoundsUtc).
//
// The shop is in America/New_York (single-shop Phase 1). When multi-shop
// ships, callers will pass shop_id and resolve timezone from the shops
// table; these helpers will accept an optional `tz` arg defaulting to
// SHOP_TIMEZONE.
//
// Why these helpers exist: the original ymd(new Date()) / setUTCHours(0)
// pattern produces UTC-day bounds that DON'T match shop-local-day
// bounds for any non-UTC shop. For America/New_York that's a 4-5 hour
// off-by-day error during 8pm-midnight ET — exactly when customers
// book "tomorrow" and Tekmetric pre-checks span the wrong window.

export const SHOP_TIMEZONE = "America/New_York";

/**
 * Convert a shop-local wall-clock date + time to a TIMESTAMPTZ-compatible
 * ISO string with the correct UTC offset for THAT specific date (handles
 * DST automatically — "-04:00" in EDT, "-05:00" in EST).
 *
 * @param date "YYYY-MM-DD" (shop-local calendar date)
 * @param timeHHMM "HH:MM" 24-hour zero-padded (shop-local wall time)
 * @returns "YYYY-MM-DDTHH:MM:00±HH:MM"
 *
 * Probes Intl.DateTimeFormat at noon-UTC of the target date (far from
 * any DST transition window) to derive the offset, then assembles the
 * ISO string. `new Date()` of the returned value resolves to the
 * correct UTC instant.
 */
export function shopLocalToIsoString(
  date: string,
  timeHHMM: string,
): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const tzName =
    new Intl.DateTimeFormat("en-US", {
      timeZone: SHOP_TIMEZONE,
      timeZoneName: "longOffset",
    })
      .formatToParts(probe)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  // tzName: "GMT-04:00" (EDT) or "GMT-05:00" (EST). Strip "GMT" prefix.
  const offset = tzName.replace(/^GMT/, "") || "-05:00";
  return `${date}T${timeHHMM}:00${offset}`;
}

/**
 * Returns the UTC instants that bound a shop-local calendar day. Each
 * end is shop-local midnight (DST-aware) converted to its UTC instant.
 *
 * Use this for ANY Tekmetric `/appointments` query window OR any
 * supabase TIMESTAMPTZ range filter that's logically "this shop-local
 * day." The naive `${date}T00:00:00Z` to `${nextDate}T00:00:00Z`
 * approach spans TWO shop-local days for non-UTC shops and causes
 * the well-documented "slot_just_taken" / capacity-miscount class of
 * bugs.
 *
 * DST safety: the "next date" is computed by string arithmetic on the
 * YYYY-MM-DD calendar date, NOT by adding 24 hours to a UTC instant.
 * shopLocalToIsoString re-derives the offset per date so DST transitions
 * (twice a year, 23h or 25h shop-local days) are handled correctly.
 */
export function shopLocalDayBoundsUtc(
  date: string,
): { start: string; end: string } {
  const startLocal = shopLocalToIsoString(date, "00:00");
  const nextDate = addDaysToYmd(date, 1);
  const endLocal = shopLocalToIsoString(nextDate, "00:00");
  return {
    start: new Date(startLocal).toISOString(),
    end: new Date(endLocal).toISOString(),
  };
}

/**
 * Today's calendar date in the shop's local timezone, formatted as
 * "YYYY-MM-DD". Use this anywhere the code wants "today shop-local"
 * — comparing against `new Date().toISOString().slice(0,10)` gives
 * the WRONG day from 8 PM ET onward (UTC has already rolled).
 */
export function shopLocalToday(): string {
  return shopLocalDate(new Date());
}

/**
 * Pure helper: shop-local "YYYY-MM-DD" for any instant.
 */
export function shopLocalDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Decompose a UTC ISO timestamp into shop-local { date, hour }.
 *
 * Used by capacity / waiter-slot bucketing logic that needs to know
 * "is this appointment at shop-local 8 AM or 9 AM?". The naive
 * `new Date(iso).getUTCHours()` approach works in EDT (UTC-4 — 8 AM ET
 * = 12 UTC, 9 AM ET = 13 UTC) but is OFF BY ONE in EST (UTC-5 — 8 AM
 * ET = 13 UTC, 9 AM ET = 14 UTC). This helper handles both DST states
 * correctly via Intl.
 */
export function shopLocalDateAndHour(
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
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? "";
  const yyyy = get("year");
  const mm = get("month");
  const dd = get("day");
  const hh = parseInt(get("hour"), 10);
  // Intl returns "24" for midnight in some impls; normalize.
  return { date: `${yyyy}-${mm}-${dd}`, hour: hh >= 24 ? 0 : hh };
}

/**
 * Add N days to a "YYYY-MM-DD" string, returning the resulting
 * "YYYY-MM-DD" string. Pure calendar arithmetic via UTC noon (DST-safe
 * anchor — adding 1 day at noon UTC always lands on the next UTC date
 * regardless of which timezone observes DST overnight).
 *
 * Used internally by shopLocalDayBoundsUtc to compute "tomorrow"; also
 * useful for callers walking a date window via string arithmetic
 * (matches the Vercel-side addDaysToYmd helper in availability.ts).
 */
export function addDaysToYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
