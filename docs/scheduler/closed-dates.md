# Closed Dates (Holidays + One-Off Closures)

<!-- closed_date: YYYY-MM-DD. Must be today or in the future — past closed_dates are immutable. -->
<!-- reason: short human-readable label. Not shown to customers. Examples: "memorial-day", "thanksgiving", "tradeshow", "snowstorm". -->
<!-- DO NOT list Sundays here — those are auto-managed by a weekly cron based on appointment-default-limits.md (Sunday row's is_closed=true). -->
<!-- This file is for HOLIDAYS and ONE-OFF closures only. Add specific dates Chris wants blocked beyond the regular weekly pattern. -->

| closed_date | reason |
|-------------|--------|
| 2026-05-25 | memorial-day |
| 2026-07-04 | independence-day |
| 2026-09-07 | labor-day |
| 2026-11-26 | thanksgiving |
| 2026-11-27 | day-after-thanksgiving |
| 2026-12-24 | christmas-eve |
| 2026-12-25 | christmas-day |
| 2026-12-31 | new-years-eve |
| 2027-01-01 | new-years-day |

---

## How to update

Ask Claude to upload this file via `upload_closed_dates_md`. The upload **replaces the FUTURE closed_dates set** (everything from today forward). Past dates are NEVER touched.

**Sundays are managed separately.** A weekly cron reads `appointment-default-limits.md`'s Sunday row (`is_closed=true`) and auto-adds the next ~104 Sundays. Don't list Sundays here — they'll just get auto-re-added. If you want to flip Sundays to "open" permanently, change the Sunday row in `appointment-default-limits.md` instead.

**One-off closures** (snowstorm, tradeshow, etc.): add the date here and re-upload. Take it out after the date passes (or just let the past-dates-are-immutable rule keep it as a historical record — your call).

**Reason field**: free-text, short, lowercase-with-hyphens. Used in audit logs and any "why is the shop closed that day?" lookups. Not customer-facing.

**Effect**: when the customer is picking an appointment date, the wizard skips any date listed here. Existing appointments on those dates are NOT touched (they remain on the calendar — re-schedule or contact those customers manually if needed).
