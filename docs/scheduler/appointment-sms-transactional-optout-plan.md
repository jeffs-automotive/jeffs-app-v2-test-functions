# Appointment SMS → transactional + opt-out

**Feature:** `appointment-sms-transactional-optout` · 2026-07-17 · for Chris

## Why

Today appointment confirmation/reminder **SMS** is opt-IN and fail-closed —
`scheduler-comms/core.ts` `hasActiveConsent()` skips the send unless there's a
non-revoked `sms_consents` row. Chris's decision: appointment confirmations &
reminders are **transactional** (the customer handed us their number to book,
and sees a disclosure), so they should send **by default**, with a clear
**opt-out**. Marketing consent moves to the future customer portal.

## Locked decisions (Chris, 2026-07-17)

1. Appointment SMS sends by default; phone-level opt-out. ✓
2. **STOP suppresses appointment SMS too** (legally required) — STOP → no SMS,
   email still sends. ✓
3. Opt-out is **SMS-only**; email confirmations/reminders are unchanged. ✓
4. The checkbox is **unchecked by default** with the disclosure:
   *"By not checking this box, you consent to receive text messages about your
   appointment."* Leaving it unchecked = consent (transactional basis). Record
   the disclosure version as proof.

## File-by-file

### DB — migration `20260717234331_sms_appointment_opt_outs.sql`
- New table `public.sms_appointment_opt_outs` (matches `sms_consents` conventions):
  `id uuid pk`, `shop_id integer >0`, `phone_e164 text ~ '^\+1[0-9]{10}$'`,
  `source text in ('wizard_checkbox','sms_stop','staff')`,
  `opted_out_at timestamptz default now()`, `restored_at timestamptz`,
  `restore_source text in ('sms_start','staff','wizard')`,
  `chat_session_id uuid → customer_chat_sessions`, paired-null check on restore.
  Active opt-out = `restored_at IS NULL`. Partial unique index on
  `(shop_id, phone_e164) where restored_at is null`; phone lookup index.
  RLS on; revoke from anon/authenticated; service_role select/insert/update
  (revoke delete/truncate).
- Add `customer_chat_sessions.appointment_sms_disclosure_version text` — proof
  of the disclosure the customer saw when they proceeded without opting out.

### Send path — `supabase/functions/scheduler-comms/core.ts`
- Replace `hasActiveConsent()` gate with `isAppointmentSmsSuppressed()` (active
  opt-out row?). SMS sends unless suppressed → `skip_reason: "opted_out"`.
  Email branch untouched.

### STOP/START — `supabase/functions/telnyx-webhook/consumers.ts`
- STOP: also insert an `sms_appointment_opt_outs` row (source `sms_stop`) so
  appointment SMS halts. Keep the existing `sms_consents` revoke (marketing).
- START (Ed25519-verified only): set `restored_at`/`restore_source='sms_start'`
  on the active opt-out (mirrors the existing START-restores-prior rule).

### Wizard UI — `PhoneNameCard.tsx` + `consent-copy.ts`
- Invert: `smsOptOut` state, **unchecked by default**. Label "Don't send me text
  messages about my appointment"; disclosure line per decision #4. New
  `APPT_SMS_DISCLOSURE_VERSION` (+ retire the opt-in copy).

### Action — `submit-phone-name.ts`
- Client sends `sms_opt_out: boolean` (was `sms_consent`). If opted out → insert
  opt-out row. Always record `appointment_sms_disclosure_version` on the session.
  Stop writing marketing `sms_consents` grants from the wizard.

## Tests
- `core.ts`: sends by default; skips with `opted_out` when suppressed.
- `telnyx-webhook` STOP → writes opt-out; START → restores.
- `submit-phone-name`: opt-out writes suppression + records version.
- `PhoneNameCard` component: default unchecked, opt-out wiring.

## Verify + deploy
- typecheck + vitest + deno check + build; `/code-review` gate.
- `supabase db push`; deploy `scheduler-comms` + `telnyx-webhook`; push scheduler-app (Vercel).

## Not in scope (flagged)
- Telnyx **10DLC campaign registration** should reflect transactional appointment
  messaging (Chris/carrier, not code).
- Customer-portal marketing consent (future).
