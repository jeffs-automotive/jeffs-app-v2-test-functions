/**
 * Eastern-time formatter for user-facing timestamps in the admin app.
 *
 * Why: Server Components render on Vercel's Node runtime (TZ=UTC by default),
 * so `.toLocaleString()` there shows UTC strings instead of shop-local time.
 * Client Components render in browser-local — also wrong if the operator is
 * outside Eastern. This forces every timestamp display to the shop's zone
 * regardless of render context.
 *
 * DST is handled automatically via the IANA zone `America/New_York` — it
 * resolves to EDT (UTC-4) March–November and EST (UTC-5) the rest of the
 * year. No manual flip needed.
 */
const fmt = new Intl.DateTimeFormat("en-US", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/New_York",
});

export function formatEastern(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return "—";
  return fmt.format(d);
}
