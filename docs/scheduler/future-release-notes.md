# Scheduler — future release notes (post-V2)

Items deferred from V2's scope to be revisited in later versions. Track here so they don't get lost between conversations / sessions.

## V2.1 — staff coordination + confirmation polish

### Tekmetric customer SMS confirmation handoff

When V2 goes live, Chris will turn off Tekmetric's auto-SMS confirmation. V2 will send its own.

- **Why:** consistent customer experience — the V2 chat already collected their info; the confirmation should come through the same channel.
- **What:** V2 sends a confirmation SMS via the same provider as the OTP (Telnyx, or whatever SMS provider is wired up at launch).
- **Trigger:** after successful Tekmetric POST + email-to-staff fires.
- **Content:** date / time / services + (optional) "Reply YES to confirm" link.
- **Code site:** new edge function or extension of an existing booking flow.

### CONFIRMED title-prefix on webhook handler

Per the appointment-post.md empirical findings (2026-05-16), `confirmationStatus` is read-only via the Tekmetric API but webhooks carry the field with values `NONE` or `CONFIRMED`. To surface "this customer confirmed" visually in the Tekmetric calendar:

- **Webhook handler change:** when the `appointment_updated` webhook fires and the appointment's `confirmationStatus` flips to `"CONFIRMED"`, PATCH the appointment's title to prepend `"CONFIRMED "`.
- **Idempotency:** check whether the title already starts with `"CONFIRMED "` before patching to avoid `"CONFIRMED CONFIRMED [TM] ..."` infinite-update loops.
- **Code site:** `supabase/functions/tekmetric-webhook/index.ts` — add post-classification handler.

### `leadSource = "TM"` on POST (deferred)

- **Why:** marketing-source attribution; analytics on "how many bookings came from the chatbot."
- **Status:** Chris said leave default for now; not required to post an appointment. Revisit when adding analytics.
- **Blocker:** must match a Shop Settings → Marketing entry. Verify `"TM"` is a valid value (or pick the right one) before turning on.
- **Code site:** `supabase/functions/_shared/tools/scheduler-slots.ts` (the POST body builder).

## V2.2+ — customer-side features

### Customer cancellation flow

- **UI:** "Cancel my appointment" button in the V2 wizard footer or completed card.
- **Verification:** session-bound (cookie) + OTP if expired session.
- **Backend:** PATCH `{status: "CANCELED"}` on Tekmetric (confirmed working in 2026-05-16 testing).
- **Local state:** update `customer_chat_sessions.status = 'cancelled'` and the local `appointments` shadow.
- **Capacity:** `computeAvailableDates` already excludes CANCELED/NO_SHOW from capacity counting — no change there.

### Customer reschedule flow

- **UI:** "Change my date" button.
- **Two implementation options:**
  - **A. Cancel-then-rebook**: simple, preserves audit trail, but creates two appointments.
  - **B. PATCH startTime/endTime directly**: preserves appointment_id, requires capacity re-check.
- Decide A vs B in V2.2 planning. B is cleaner but requires more careful capacity math.

### Customer appointment-status lookup post-booking

- **Entry path:** "Check my appointment status" from the landing page.
- **Verifies via OTP**, displays date/time/services/status from the local shadow.
- **Hand-off:** for changes other than cancel, ask the customer to call the shop (until reschedule flow ships).

### `rideOption` (loaner / shuttle) selection

- **Tekmetric accepts:** `LOANER | RIDE | NONE` (per docs + empirical webhook distribution).
- **V2 wizard step:** between vehicle pick and date pick — "Need a ride or loaner?"
- **Color convention** per shop docs: yellow = LOANER, blue = RIDE.
- **Operational complexity:** loaner inventory tracking is a real thing. Decide if V2.2 owns loaner availability or just records the request.

### Customer-side TOW path

- **Tekmetric accepts:** appointmentOption=3 (TOW) — but only via UI, not API (confirmed 2026-05-16).
- **V2 wizard:** could add an option after waiter/dropoff: "Have it towed in." Until appointmentOption is settable via API, the workflow is:
  1. Customer picks TOW in V2.
  2. We POST with `color: "orange"` (visual signal).
  3. Staff manually sets appointmentOption to TOW in Tekmetric UI when they see the orange block.
- **Or:** keep TOW out of customer-facing flow and require a phone call. Decide based on volume.

## V2.3+ — operational improvements

### Service writer assignment test

- **Goal:** can we PATCH a service-writer / technician onto an appointment via API?
- **Status:** untested. Worth probing via `tekmetric-api-testing`'s `raw_get` (to find the endpoint) + extending with a `patch_appointment_employee` op.
- **Why it matters:** if customers can request a specific advisor or get auto-routed by service category, this is the wiring.

### `appointmentOption` write support (Tekmetric API gap)

- **Issue:** Tekmetric's API has no functioning input for `appointmentOption` on POST or PATCH. All API-created appointments default to STAY (waiter). Staff must manually flip in the UI.
- **Workaround:** color is the visual channel (red=waiter, navy=dropoff, orange=tow). `appointments-sync` derives our local `appointment_type` from color for capacity tracking.
- **Long-term fix:** file a Tekmetric support ticket asking them to honor `appointmentOption` on POST/PATCH. If they expose the field properly, our POST builder can send it and we can drop the color-derivation hack in `appointments-sync`.

### PATCH `description` for post-booking customer notes (Phase 13)

- **Status:** confirmed working in 2026-05-16 testing.
- **Phase 13 work:** when customer enters a note on the post-confirmation card, PATCH the appointment's description to append the note.
- **Implementation note:** GET the existing description first, then PATCH with `existing + "\n\nCustomer note: " + new`. Avoid overwriting.

## Forever-deferred (not on roadmap, just noted)

- **Walk-in / phone-call appointment ingestion** — out of scope; staff books these via Tekmetric directly.
- **Multi-shop support** — V2 is single-shop (Jeff's, shop_id=7476). Cross-shop tenancy is a v3+ project.
- **Customer-side language switching** — not a current product requirement.
- **Direct Tekmetric API request for `appointmentOption` write support** — added as a "long-term fix" under V2.3; might never get resolved on Tekmetric's side, so the color-derivation workaround is our long-term answer.

## Reference

- `docs/scheduler/appointment-post.md` — Tekmetric POST contract + empirical findings (2026-05-16)
- `supabase/functions/tekmetric-api-testing/` — probe surface used to derive these findings
- `scheduler-refactor-state.json` — V2 phase orchestration ledger
