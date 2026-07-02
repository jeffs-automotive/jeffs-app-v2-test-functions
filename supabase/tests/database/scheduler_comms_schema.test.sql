-- =====================================================================
-- pgTAP — scheduler comms schema: sms_consents, sms_messages,
-- scheduler_reminders, appointments contact columns
-- =====================================================================
-- Covers 20260702180000_scheduler_comms_schema.sql
-- (plan: docs/scheduler/comms-phases-1-3-plan-2026-07-02.md).
-- RLS per cross-module-anchors.md: assert ROW COUNTS / error codes —
-- blocked RLS UPDATE/DELETE silently filters rather than throws.
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── shape ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'sms_consents', 'sms_consents exists');
SELECT has_table('public', 'sms_messages', 'sms_messages exists');
SELECT has_table('public', 'scheduler_reminders', 'scheduler_reminders exists');
SELECT has_column('public', 'appointments', 'customer_phone_e164', 'appointments has contact phone');
SELECT has_column('public', 'appointments', 'customer_email', 'appointments has contact email');
SELECT col_type_is('public', 'sms_consents', 'granted_at', 'timestamp with time zone', 'granted_at is timestamptz');

-- deny-all RLS on all three
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sms_consents'::regclass), true, 'sms_consents RLS enabled');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='sms_consents'), 0, 'sms_consents zero policies');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sms_messages'::regclass), true, 'sms_messages RLS enabled');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='sms_messages'), 0, 'sms_messages zero policies');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.scheduler_reminders'::regclass), true, 'scheduler_reminders RLS enabled');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='scheduler_reminders'), 0, 'scheduler_reminders zero policies');

-- ─── sms_consents semantics ─────────────────────────────────────────────
-- Grant a consent.
INSERT INTO public.sms_consents (shop_id, phone_e164, cta_text, cta_version, acquisition_medium, consenter_label)
VALUES (7476, '+16105551234', 'I agree to receive appointment texts…', 'v1-2026-07-02', 'wizard_checkbox', 'Pat Tester');

SELECT is(
  (SELECT count(*)::int FROM public.sms_consents WHERE shop_id=7476 AND phone_e164='+16105551234' AND revoked_at IS NULL),
  1, 'active consent row exists after grant');

-- Second ACTIVE grant for the same phone is rejected (partial unique).
SELECT throws_ok(
  $$ INSERT INTO public.sms_consents (shop_id, phone_e164, cta_text, cta_version, acquisition_medium)
     VALUES (7476, '+16105551234', 'dup', 'v1', 'wizard_checkbox') $$,
  '23505', NULL, 'second active consent for same phone rejected');

-- Phone format CHECK.
SELECT throws_ok(
  $$ INSERT INTO public.sms_consents (shop_id, phone_e164, cta_text, cta_version, acquisition_medium)
     VALUES (7476, '6105551234', 'x', 'v1', 'wizard_checkbox') $$,
  '23514', NULL, 'non-E.164 phone rejected');

-- revoked_at and revoke_source travel together.
SELECT throws_ok(
  $$ UPDATE public.sms_consents SET revoked_at = now() WHERE phone_e164='+16105551234' AND revoked_at IS NULL $$,
  '23514', NULL, 'revoked_at without revoke_source rejected');

-- Immutability guard: cta_text cannot be rewritten.
SELECT throws_ok(
  $$ UPDATE public.sms_consents SET cta_text='tampered' WHERE phone_e164='+16105551234' $$,
  NULL, 'sms_consents rows are append-then-revoke: only revoked_at/revoke_source may change',
  'grant fields are immutable');

-- Legit revoke works…
UPDATE public.sms_consents
   SET revoked_at = now(), revoke_source = 'sms_stop'
 WHERE phone_e164='+16105551234' AND revoked_at IS NULL;
SELECT is(
  (SELECT count(*)::int FROM public.sms_consents WHERE phone_e164='+16105551234' AND revoked_at IS NULL),
  0, 'no active row after STOP revoke');

-- …and a revoked row cannot be re-opened.
SELECT throws_ok(
  $$ UPDATE public.sms_consents SET revoked_at = NULL, revoke_source = NULL WHERE phone_e164='+16105551234' $$,
  NULL, 'sms_consents: a revoked row cannot be re-opened or re-revoked',
  'revoked row cannot be re-opened');

-- A fresh grant AFTER revoke is allowed (re-consent via signed START).
INSERT INTO public.sms_consents (shop_id, phone_e164, cta_text, cta_version, acquisition_medium)
VALUES (7476, '+16105551234', 're-grant via START', 'v1', 'sms_start');
SELECT is(
  (SELECT count(*)::int FROM public.sms_consents WHERE phone_e164='+16105551234'),
  2, 'history preserved: revoked + new active row');

-- DELETE is revoked from service_role (append-then-revoke, never delete).
SELECT throws_ok(
  $$ DELETE FROM public.sms_consents WHERE phone_e164='+16105551234' $$,
  '42501', NULL, 'DELETE revoked on sms_consents');

-- ─── sms_messages semantics ─────────────────────────────────────────────
-- OTP rows must not store the code body.
SELECT throws_ok(
  $$ INSERT INTO public.sms_messages (shop_id, direction, phone_e164, kind, body)
     VALUES (7476, 'outbound', '+16105551234', 'otp', '123456') $$,
  '23514', NULL, 'otp body storage rejected');

INSERT INTO public.sms_messages (shop_id, direction, phone_e164, kind, body, telnyx_message_id, status)
VALUES (7476, 'outbound', '+16105551234', 'confirmation', 'See you Friday!', 'tx-msg-001', 'sent');

-- DLR-style status update by telnyx id.
UPDATE public.sms_messages SET status='delivered', updated_at=now() WHERE telnyx_message_id='tx-msg-001';
SELECT is(
  (SELECT status FROM public.sms_messages WHERE telnyx_message_id='tx-msg-001'),
  'delivered', 'status updates by telnyx_message_id');

-- Duplicate telnyx id rejected.
SELECT throws_ok(
  $$ INSERT INTO public.sms_messages (shop_id, direction, phone_e164, kind, telnyx_message_id)
     VALUES (7476, 'inbound', '+16105551234', 'inbound', 'tx-msg-001') $$,
  '23505', NULL, 'duplicate telnyx_message_id rejected');

-- ─── scheduler_reminders idempotency ────────────────────────────────────
INSERT INTO public.scheduler_reminders (shop_id, tekmetric_appointment_id, reminder_kind, channel, status)
VALUES (7476, 999001, 'reminder_24h', 'sms', 'claimed');

-- The claim: second insert for the same (appt, kind, channel) conflicts.
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_reminders (shop_id, tekmetric_appointment_id, reminder_kind, channel, status)
     VALUES (7476, 999001, 'reminder_24h', 'sms', 'claimed') $$,
  '23505', NULL, 'duplicate (appt, kind, channel) claim rejected');

-- ON CONFLICT DO NOTHING claim pattern: 0 rows on re-claim.
WITH claim AS (
  INSERT INTO public.scheduler_reminders (shop_id, tekmetric_appointment_id, reminder_kind, channel, status)
  VALUES (7476, 999001, 'reminder_24h', 'sms', 'claimed')
  ON CONFLICT (tekmetric_appointment_id, reminder_kind, channel) DO NOTHING
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM claim), 0, 'ON CONFLICT DO NOTHING re-claim returns 0 rows');

-- Same appt, different channel is a separate claim.
INSERT INTO public.scheduler_reminders (shop_id, tekmetric_appointment_id, reminder_kind, channel, status)
VALUES (7476, 999001, 'reminder_24h', 'email', 'claimed');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_reminders WHERE tekmetric_appointment_id=999001 AND reminder_kind='reminder_24h'),
  2, 'sms + email are independent claims');

-- skipped requires a reason.
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_reminders (shop_id, tekmetric_appointment_id, reminder_kind, channel, status)
     VALUES (7476, 999002, 'reminder_2h', 'sms', 'skipped') $$,
  '23514', NULL, 'skipped without skip_reason rejected');

SELECT * FROM finish();
ROLLBACK;
