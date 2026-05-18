/**
 * shop-tz — Vercel-side helpers for converting shop-local wall-clock
 * date+time values to TIMESTAMPTZ-compatible ISO strings.
 *
 * Created 2026-05-16 per the R6 pattern-extension audit: the same
 * hardcoded "-04:00" DST bug fixed in the edge-fn helper
 * (scheduler-slots.ts shopLocalToIsoString) was also present in the
 * Vercel-side card-data builders at:
 *   - build-summary-data.ts:255 (summary starts_at ISO)
 *   - get-current-card.ts:1303  (buildAppointmentLabel display string)
 *
 * Centralizing here so the next Vercel-side caller writes one line
 * instead of re-introducing the same offset string.
 *
 * Mechanics: probe Intl.DateTimeFormat with timeZone "America/New_York"
 * at 12:00 UTC on the target date (which is 7-8 AM shop-local — far
 * from any DST transition window) and read the longOffset value
 * ("GMT-04:00" in EDT, "GMT-05:00" in EST). Strip the "GMT" prefix to
 * build a TIMESTAMPTZ-compatible ISO suffix.
 *
 * Returns the wall-clock ISO `${date}T${HH:MM}:00${offset}` so
 * `new Date()` of the result resolves to the correct UTC instant.
 */

const SHOP_TIMEZONE = "America/New_York";

/**
 * The wall-clock hour (shop-local) at which today becomes unavailable
 * for ALL same-day appointments — even drop-off. Set 2026-05-18 per
 * Chris's directive: "After 12:00 PM local time same day needs to be
 * automatically cut off." Service writers used to do this manually
 * by adding appointment_blocks; we now enforce it in the read path.
 *
 * Real-time enforcement (in `computeAvailableDates`) is the primary
 * mechanism. `submit-date.ts` has a defensive re-check to catch the
 * narrow case of a customer crossing the cutoff mid-flight.
 */
export const SAME_DAY_CUTOFF_HOUR = 12;

/**
 * Default drop-off-by hour used in customer-facing copy when the
 * appointment is NOT same-day ("drop off before 10 AM"). Future days
 * get this copy; today gets the looser "drop off as soon as you can
 * today" copy via `isSameDayLocal()`.
 */
export const DROP_OFF_BY_HOUR_DEFAULT = 10;

/**
 * Convert shop-local date+time to an ISO string with the correct
 * UTC offset for THAT specific date.
 *
 * @param date — "YYYY-MM-DD" (shop-local calendar date)
 * @param timeHHMM — "HH:MM" 24-hour zero-padded (shop-local wall time)
 * @returns "YYYY-MM-DDTHH:MM:00±HH:MM"
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

// ─── Same-day helpers (added 2026-05-18) ────────────────────────────────────

/**
 * Today's calendar date in the shop's local timezone, formatted as
 * "YYYY-MM-DD". Use this anywhere `computeAvailableDates`'s output
 * dates need to be compared against "today" — comparing against
 * `new Date().toISOString().slice(0,10)` (UTC midnight) gives the
 * WRONG day when shop-local is between midnight and 5 AM (e.g., 2 AM ET
 * on May 18 is UTC 6 AM May 18 → both agree) but the WRONG day from
 * 7 PM ET to midnight (UTC has already rolled to the next day).
 */
export function shopLocalToday(): string {
  return shopLocalDate(new Date());
}

/** Pure helper: shop-local "YYYY-MM-DD" for any instant. */
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
 * Current shop-local wall-clock hour (0-23). Used by
 * `isAfterSameDayCutoff` and any future time-of-day gating.
 */
export function shopLocalHourNow(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHOP_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const raw = parts.find((p) => p.type === "hour")?.value ?? "0";
  // Intl returns "24" for midnight in some impls; normalize.
  const h = parseInt(raw, 10);
  return h >= 24 ? 0 : h;
}

/**
 * TRUE when the current shop-local time is at or past the cutoff
 * (default 12:00 PM). At this point today is no longer offered as a
 * same-day appointment option, even for drop-off.
 */
export function isAfterSameDayCutoff(): boolean {
  return shopLocalHourNow() >= SAME_DAY_CUTOFF_HOUR;
}

/**
 * TRUE when the supplied "YYYY-MM-DD" date matches today in the shop's
 * local timezone. Used by the SummaryCard + reminder builder + final
 * confirmation bubble to swap "drop off before 10 AM" copy for
 * "drop off as soon as you can today" copy on same-day bookings.
 */
export function isSameDayLocal(date: string | null | undefined): boolean {
  if (!date) return false;
  return date === shopLocalToday();
}
