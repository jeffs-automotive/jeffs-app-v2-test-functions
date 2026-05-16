shopId
Integer
required	Shop id

customerId
Integer
Customer id - required

vehicleId
Integer
Vehicle id - required

startTime
DateTime
required	This should be the date of the appointment. Time is only needed if it is a wait appointment. Start is 8am or 9am. for drop off appointments the start time can be anytime between 8-4 pm. It is not necessary to pick a specific time as service advisors will move to a slot as needed but specific times are not used in drop offs they are just put in a list under a technicians name.

endTime
DateTime
required	end time is always 1 hour after start time. This includes drop offs and waiters. If more time is needed service advisors will expand the end time manually.

title
String
required	Title - "[OP] customer first and last name, year make and model and a short description of services needed (use abbreciation, initialism, or truncation. Ex. - state inspection and emissions = SI IM, oil change = LOF, brake inspection = Brake Insp, check engine light testing = CEL Testing, etc. whatever is used it needs to be understandable by the service advisors so they can schedule correctly.)

description
String
Description
Required - Can use the same as asin title for services. each service needs to be comma separated.

color
String
Color which will be shown with the Appointment
Permitted Values: [ red, pink, yellow, orange, light green, green, blue, navy, lavender, purple ]
Default Value:  navy
dropoffTime
DateTime
Vehicle Drop-off time
Required - default is navy, waiter is red, yellow is loaner car, Orange is tow in, blue is needs ride, light green is will reschedule (not used), purple is new customer, lavender is no show, green is needs by. For now we will just use navy and red while we test. We will add more in later as we add more features to the scheduler.

pickupTime
DateTime
Vehicle Pick-up time
Not required (now) - We will use this later as a promised time. We will ask the customer is they need their vehicle by a certain time, use the green color, and note "Needs by {time}" in the title between [OP] and customer first name. 

rideOption
String
Ride option of the appointment
Permitted Values: [ LOANER, RIDE, NONE ]
Default Value:  NONE
not required - We will add this later as we add more features. We do offer shuttle services and loaner vehicles. When we use these we use the appropriate appointment color and add "Needs Loaner" or "Needs Ride" between [OP] and customer first name

status
String
Status of the appointment
Permitted Values: [ NONE, ARRIVED, NO_SHOW, CANCELED ]
Default Value:  NONE
not required - use default. We will use later when a customer needs to cancel their appointment when using the scheduler. When we are looking at the schedule to see whats available canceled does not count for the day limit ro appointment type limits. Whgen same day is open canceled and no show will not count towards day limits or appointment type limits.

leadSource
String
Marketing source for the appointment, must be one of the values in `Shop Settings - Marketing` section
not required - We will add this feature in later. We will ask the customer how they heard about us if they are new customers and we will pick from a list of available options. If they are current customers we will use Returning customer.

---

## Empirical findings — tested 2026-05-16 via `tekmetric-api-testing` edge function

18 distinct POST/PATCH probes against shop 7476 against the live `shop.tekmetric.com/api/v1/appointments` endpoint. Authoritative results below.

### What the API ACCEPTS on POST

| Field | Shape sent | Persisted as |
|---|---|---|
| `shopId` | integer | exact |
| `customerId` | integer | exact |
| `vehicleId` | integer | exact |
| `startTime` | ISO 8601 UTC string | exact |
| `endTime` | ISO 8601 UTC string | exact |
| `title` | string | exact |
| `description` | string | exact |
| `color` | color-name string (`"red"`, `"navy"`, `"orange"`, etc.) | hex code (`#D01919`, `#0D4A80`, `#F0572A`) |
| `status` (alias for `appointmentStatus`) | bare enum string | exact — valid values `NONE \| ARRIVED \| NO_SHOW \| CANCELED` |

### What Tekmetric SILENTLY IGNORES on POST

| Field | Shapes attempted | Result |
|---|---|---|
| `appointmentOption` | numbers `1/2/3`; legacy strings `"WAITER"/"PICKUP_DROPOFF"/"TOWED"`; new strings `"STAY"/"DROP"/"TOW"`; objects `{id}`, `{code}`, `{id, code, name}` | Always stored as `{id:1, code:"STAY", name:"Stay With Vehicle"}` |
| `confirmationStatus` | `"CONFIRMED"` | Always stored as `"NONE"` |

### What Tekmetric EXPLICITLY REJECTS on POST

| Field | Attempted value | Server response |
|---|---|---|
| `status` | `"CONFIRMED"` | HTTP 200 with `"type": "ERROR", "message": "Appointment invalid", "details": { "status": "Invalid status. It should be NONE, ARRIVED, NO_SHOW or CANCELED." }`. No appointment created. |

### What works on PATCH `/appointments/{id}`

| Field | Behavior |
|---|---|
| `status` | ✅ Accepts `NONE/ARRIVED/NO_SHOW/CANCELED` |
| `title` | ✅ Replaces title exactly |
| `description` | ✅ Replaces description exactly |
| `appointmentOption` | ❌ Same as POST — silently ignored |
| `color` | ✅ Accepts color name, stored as hex |

### Empirical enum tables

`appointmentOption` (across 1146 production webhooks + our test runs):

| id | code | name | Counts (1146 webhook sample) |
|---|---|---|---|
| 1 | STAY | Stay With Vehicle | 158 |
| 2 | DROP | Drop-off Vehicle | 972 |
| 3 | TOW | Towed-In Vehicle | 0 (only seen via the manual change on appointment 61802832) |

`rideOption`:

| id | code | name |
|---|---|---|
| 1 | RIDE | Ride Required |
| 2 | LOANER | Loaner Required |
| 3 | NONE | None |

`appointmentStatus` (bare strings, no object wrapper):

| Code | Counts in production webhooks |
|---|---|
| NONE | 1141 |
| CANCELED | 4 |
| ARRIVED / NO_SHOW | 0 in our sample window (but accepted on POST per testing) |

`confirmationStatus` (bare strings):

| Code | Counts | How set |
|---|---|---|
| NONE | 1141 (default) | default for new appointments |
| CONFIRMED | 2 | Tekmetric's internal flow (SMS reply / staff confirm) — NOT settable via our API |

### Critical implications for V2 scheduler

1. **All chat-driven (API-created) appointments default to STAY in Tekmetric's `appointmentOption` field.** Staff manually flip to DROP / TOW in the Tekmetric UI if they care about that field for internal routing.

2. **Color is the staff-facing channel:**
   - `"red"` (`#D01919`) → waiter
   - `"navy"` (`#0D4A80`) → dropoff (default)
   - `"orange"` (`#F0572A`) → tow-in (future)
   - Other colors per shop convention (yellow=loaner, blue=ride, green=needs-by-time, etc.)

3. **`appointments-sync` must derive `appointment_type` from `color`, NOT from `appointmentOption.code`.** Otherwise every chat-driven booking gets counted as waiter in our capacity math regardless of customer pick.

4. **`confirmationStatus` is read-only via API.** Webhook payloads carry it (`NONE` / `CONFIRMED`); POST/PATCH writes are dropped. To surface "customer confirmed" in the calendar, the webhook handler PATCHes the appointment title to prepend `"CONFIRMED "` when it sees the field flip to `CONFIRMED`.

5. **Title format for V2 bookings:**
   - Waiter @ 8 AM: `[TM] 8AM WAIT <First Last>, <Year> <Make> <Model> <ABBRS>`
   - Waiter @ 9 AM: `[TM] 9AM WAIT <First Last>, <Year> <Make> <Model> <ABBRS>`
   - Dropoff: `[TM] <First Last>, <Year> <Make> <Model> <ABBRS>`
   - `[TM]` replaces the `[OP]` placeholder above — marks "online appointment from Tekmetric Manager scheduler" so advisors recognize it at a glance.

6. **PATCH `description` is the safe channel for post-booking customer notes/questions.** Phase 13 appends customer notes to `appointment.description` via PATCH.

### V2 Phase 12 POST body shape (locked 2026-05-16)

```json
{
  "shopId": 7476,
  "customerId": <int>,
  "vehicleId": <int>,
  "startTime": "<ISO 8601 Z>",
  "endTime": "<ISO 8601 Z, startTime +1hr>",
  "title": "[TM] <slot-tag-if-waiter> <First Last>, <Year> <Make> <Model> <service abbrs>",
  "description": "<comma-separated services + concerns>",
  "color": "red" | "navy"
}
```

Eight fields. Drop the previous `appointmentOption` — it's dead weight.

Reference: empirical test runs T1–T18 via the `tekmetric-api-testing` edge function on 2026-05-16. All 17 successful test appointments cancelled post-test.