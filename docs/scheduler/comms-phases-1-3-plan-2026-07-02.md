# Scheduler comms — Phases 1–3 plan (2026-07-02)

> Executes REVAMP-PLAN-2026-06-24 §7 Phases 1–3 (§4 comms design, §12 staff-booked consent deferred to
> the contact-backfill fast-follow). Research artifact: the 2026-07-02 comms-surface survey (session
> agent). SMS consent is the P0 go-live blocker (§8.2).

## What already exists (survey-verified, don't rebuild)

- `telnyx-webhook` v1 (capture-only): token gate + Ed25519 verify-if-present (`TELNYX_PUBLIC_KEY`
  pending), firehose insert into `telnyx_webhook_events` (idempotent on `telnyx_event_id`), campaign
  suspension Sentry alert. NO STOP/HELP consumer, NO DLR consumer yet.
- `_shared/resend-client.ts` (`sendResendEmail`, idempotency-key aware, tested). Two inline Resend
  callers remain: `transcript-dispatcher`, `scheduler-manual-review-email`.
- `sendViaTelnyx()` complete inside `_shared/tools/scheduler-otp.ts` (Telnyx POST /v2/messages, status
  mapping, 15s timeout) — needs EXTRACTION to `_shared/telnyx-client.ts`, not a rewrite.
- `scheduler_message_templates` + admin editor + `template-renderer.ts` (whitelist merge fields,
  GSM-7/segments validators). NOTHING renders-and-sends yet.
- `appointments` shadow: NO contact columns; `appointments-sync` never calls getCustomerById.
- Wizard consent TODAY: one passive footnote in `PhoneNameCard.tsx`; no checkbox, no ledger.
- Cron pattern to copy: `20260516200000_scheduler_cron_exception_wraps.sql` (BEGIN/EXCEPTION →
  `scheduler_error_log`; `job_failures` doesn't exist here) + Sentry monitor wrap `20260523022303`.

## Locked decisions (Chris 2026-06-24 §10 + recommend-and-proceed defaults)

1. Reminders for ALL appointments eventually; THIS batch ships app-booked-first (phone/email from the
   verified session — no Tekmetric backfill dependency); the staff-booked contact backfill + consent
   basis (§12) is scoped as the immediate fast-follow, gated on Chris's staff-consent decision.
2. Loaner SMS deferred (Phase 6). Tekmetric auto-messaging: ours is the system of record; disabling
   Tekmetric's toggle is a go-live task for Chris.
3. Cadence (recommended default): 24h + 2h reminders, SMS (consent-gated) + email. Quiet hours:
   conservative shop-local 08:00–21:00 (single-shop; recipient-local resolution deferred).
4. OTP keeps its own consent basis (customer requests the code); the NEW checkbox governs
   confirmation/reminder messaging only and never blocks the wizard.
5. Sends stay OFF until go-live inputs land (10DLC approval, `TELNYX_*` secrets, `SMS_PROVIDER=telnyx`,
   Resend sending subdomain): SMS sender fail-closed on missing consent AND stub provider; email
   confirmation sender ships live (transactional, Resend already live for transcripts).

## Phase 1 — schema (one migration + pgTAP)

`supabase/migrations/<ts>_scheduler_comms_schema.sql`:

- **`sms_consents`** — the P0 ledger. `id uuid PK`, `shop_id int NOT NULL CHECK (shop_id > 0)`,
  `phone_e164 text NOT NULL`, `status text CHECK IN ('granted','revoked')`, `granted_at timestamptz`,
  `acquisition_medium text` ('wizard_checkbox' | 'sms_start' | 'staff'), `cta_text text` (the exact
  rendered consent copy), `cta_version text`, `consenter_label text` (entered name), `chat_session_id
  uuid`, `consent_ip text`, `user_agent text`, `revoked_at timestamptz`, `revoke_source text`
  ('sms_stop' | 'staff' | 'wizard'), timestamps. Partial unique: one ACTIVE (`revoked_at IS NULL`) row
  per `(shop_id, phone_e164)`. Append-then-revoke history (no updates to granted rows besides revoke).
- **`sms_messages`** — outbound/inbound ledger. `id uuid PK`, `shop_id int`, `direction`
  ('outbound'|'inbound'), `phone_e164`, `kind` ('otp'|'confirmation'|'reminder_24h'|'reminder_2h'|
  'inbound'), `body text` (NULL for OTP — never store live codes), `telnyx_message_id text UNIQUE`,
  `status` ('queued'|'sent'|'delivered'|'failed'|'received'), `status_detail text`,
  `appointment_id bigint`, `chat_session_id uuid`, timestamps. DLR consumer updates by
  `telnyx_message_id`.
- **`scheduler_reminders`** — send-idempotency ledger. `id uuid PK`, `shop_id int`,
  `tekmetric_appointment_id bigint NOT NULL`, `reminder_kind text CHECK IN
  ('confirmation','reminder_24h','reminder_2h')`, `channel text CHECK IN ('sms','email')`,
  `status text CHECK IN ('sent','skipped','failed')`, `skip_reason text` (no_consent | quiet_hours |
  no_contact | stale_appointment | provider_stub), `sent_at`, `error text`, UNIQUE
  `(tekmetric_appointment_id, reminder_kind, channel)` — the ON CONFLICT DO NOTHING anchor.
- **`appointments` contact columns** — `customer_phone_e164 text`, `customer_email text`,
  `customer_first_name text`, `contact_source text` ('session'|'tekmetric'), `contact_synced_at
  timestamptz` (plaintext per §6 — pgcrypto rule is aspirational, out of scope).
- All new tables: deny-all RLS, revoke anon/authenticated; pgTAP row-count tests (positive+negative)
  in `supabase/tests/database/scheduler_comms_schema.test.sql`.
- NO `apply_wizard_transition` change: consent writes go straight to `sms_consents` from the server
  action (avoids the high-touch RPC rebuild).

## Phase 2 — transports, webhook consumer, consent capture

1. **`_shared/telnyx-client.ts`** — extract `sendViaTelnyx` + `SmsProviderResult` + provider gating
   (`resolveSmsProvider()`, `sendSms()`), re-export from `scheduler-otp.ts` for back-compat. Fix the
   factually-wrong "OTP exempt from STOP" comment (§4b). Deno unit tests with stubbed fetch.
2. **Resend migration** — `transcript-dispatcher` + `scheduler-manual-review-email` inline fetches →
   `sendResendEmail` (behavior-preserving; keep Idempotency-Key semantics).
3. **`telnyx-webhook` v2** — post-store consumers:
   - Inbound `message.received`: match STOP/UNSTOP/HELP keywords (CTIA set: STOP, STOPALL, UNSUBSCRIBE,
     CANCEL, END, QUIT / START, YES, UNSTOP / HELP, INFO). STOP → revoke active consent row
     (`revoke_source='sms_stop'`) + insert `sms_messages` inbound row. STOP acts even when
     signature-unverified (fail toward not-sending — spoof-safe). START/UNSTOP re-grant ONLY when
     `signature_verified` (spoofing a re-grant must be impossible). HELP → log only (Telnyx
     auto-responder handles reply per campaign config).
   - `message.finalized`/DLR events: update `sms_messages.status` by `telnyx_message_id`.
   - Keep firehose insert; consumers are additive after the store, each error-checked → `logEdgeError`.
4. **Consent capture UI** — per the frontend-design-director spec
   (`.claude/work/design/scheduler-comms-consent-spec.md`): checkbox + compliant copy in
   `PhoneNameCard.tsx` (unchecked default, non-blocking), consent boolean + rendered `cta_text`/version
   threaded through `submit-phone-name.ts` → INSERT into `sms_consents` (server-side, before the
   step2-direct call). Confirmed-card truthfulness copy variants (consented vs not). Unit tests.

## Phase 3 — senders + reminder sweeper (app-booked scope)

1. **`_shared/scheduler-comms.ts`** — `renderTemplate` (ported/shared from admin-app renderer — Deno
   copy with a sync-note header, same whitelist), `resolveTemplate(kind, channel, type_id)` (per-type →
   shop-default fallback), `sendConfirmation(sessionRow, appointment)`:
   - email via `sendResendEmail` (Idempotency-Key `confirm:<appointment_id>:email`) — LIVE now;
   - SMS via `sendSms` — gated: active consent row + provider resolves to telnyx; otherwise
     `scheduler_reminders` row with `status='skipped'` + reason. Ledger UNIQUE prevents dupes.
   Hook: `submit-summary.ts` confirm success path (fire-and-forget with error logging), keyed on the
   `appointment_confirmed_at` write.
2. **`scheduler-reminders` edge fn + cron** (`*/10 * * * *`, BEGIN/EXCEPTION wrap + Sentry monitor):
   window scan of local `appointments` (source='scheduler-app', status not CANCELED) for T-24h±window
   and T-2h±window; per hit: freshness re-check via Tekmetric `GET /appointments/{id}` (reuse the
   verify primitive; skip on time-moved/canceled → `stale_appointment`), quiet-hours gate, contact from
   the booking session (join `customer_chat_sessions.appointment_id`; else `no_contact` skip — the
   staff-booked backfill is the fast-follow), consent gate for SMS, template render, send, ledger
   insert ON CONFLICT DO NOTHING first (claim-then-send).
3. **Contact denormalization (app-booked)** — on confirm, write session phone/email/first-name into the
   `appointments` contact columns (`contact_source='session'`).
4. UI truthfulness (in the consent spec's confirmed-card copy).

## Verification

- Deno unit tests (telnyx-client, webhook consumers, comms senders w/ stubbed fetch + stubbed sb),
  vitest (consent action, UI), pgTAP (3 new tables + partial unique + revoke semantics), typecheck +
  build both stacks, `/code-review` gate, deploy (db push + 3 edge fns + Vercel), post-deploy MCP/CLI
  verification.

## Blocked on Chris (unchanged from plan §9)

10DLC campaign approval + `TELNYX_PUBLIC_KEY`/`TELNYX_*` secrets + `SMS_PROVIDER=telnyx` flip; Resend
sending-subdomain verification; Tekmetric auto-messaging toggle off; staff-booked consent basis
decision (§12) before the ALL-appointments expansion.
