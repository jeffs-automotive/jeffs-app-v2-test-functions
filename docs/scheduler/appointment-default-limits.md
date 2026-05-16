# Appointment Default Limits

<!-- day_of_week: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday. -->
<!-- is_closed: true if the shop is closed that day of the week (overrides slot counts). -->
<!-- waiter_8am_slots: number of "stay with vehicle" customers we can take at the 8 AM block. -->
<!-- waiter_9am_slots: number of "stay with vehicle" customers we can take at the 9 AM block. -->
<!-- dropoff_total: total drop-off capacity across the whole day for that day-of-week. -->
<!-- notes: human-readable note (not shown to customers). -->
<!-- Must be exactly 7 rows — one per day of week. -->

| day_of_week | is_closed | waiter_8am_slots | waiter_9am_slots | dropoff_total | notes |
|-------------|-----------|------------------|------------------|---------------|-------|
| 0 | true | 0 | 0 | 0 | Sunday — closed |
| 1 | false | 2 | 2 | 31 | Monday |
| 2 | false | 2 | 2 | 31 | Tuesday |
| 3 | false | 2 | 2 | 31 | Wednesday |
| 4 | false | 2 | 2 | 31 | Thursday |
| 5 | false | 2 | 2 | 31 | Friday |
| 6 | false | 2 | 2 | 15 | Saturday — shorter day |

---

## How to update

Ask Claude to upload this file via `upload_appointment_default_limits_md`. The upload **replaces the entire 7-row set** for the shop.

**Effects of changing the capacity:**
- Lowering `waiter_8am_slots` or `waiter_9am_slots` means fewer customers can book the wait-with-vehicle slot. Existing waiter appointments at that time are NOT affected — but new bookings won't be offered the option once we hit the new lower limit.
- Lowering `dropoff_total` doesn't kick out existing drop-offs; it just stops new bookings once the day is at the new lower number.
- Flipping `is_closed=true` for a day-of-week stops ALL bookings for future occurrences of that day. Future appointments already booked stay intact.

**One-off closures** (a single holiday, an out-of-office day) go in `closed-dates.md`, NOT here. This file is for the WEEKLY pattern only.

**Slot math**: total daily capacity = `waiter_8am_slots + waiter_9am_slots + dropoff_total`. Saturday (15 dropoff) is intentionally smaller because it's a shorter day. Sunday is closed.
