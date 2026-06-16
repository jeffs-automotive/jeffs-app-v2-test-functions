-- =====================================================================
-- pgTAP — webhook event idempotency: whole-body dedup hash
-- =====================================================================
-- Covers 20260616160000_webhook_event_wholebody_hash.sql (which replaces the
-- synthetic event_hash from 20260522191500).
--
-- The regression this guards: the old synthetic hash
--   sha256(event_kind | coalesce(ro_id, payment_id, data.id) | status_id | data.updatedDate)
-- collapsed EVERY payment_made on an RO to one value — payment_id lost the
-- coalesce to tekmetric_ro_id, status_id is NULL for payments, and payment
-- payloads carry no data.updatedDate. So the 2nd (paid-in-full) payment was
-- 23505'd away as a "retry" and the tag never released (Y1 #152753, Y32 #153119).
--
-- The whole-body hash sha256(raw_body::text) dedups byte-identical retries but
-- keeps genuinely-distinct events (two payments differ in data.id -> stored).
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── keytag_webhook_events ──────────────────────────────────────────────
SELECT has_column('public', 'keytag_webhook_events', 'event_hash', 'keytag: has generated event_hash');

-- event_hash = sha256(raw_body::text)
INSERT INTO public.keytag_webhook_events (event_kind, tekmetric_ro_id, payment_id, raw_body)
VALUES ('payment_made', 900000001, 11111,
  '{"event":"Payment made by X","data":{"id":11111,"repairOrderId":900000001,"arPayment":true,"paymentStatus":"SUCCEEDED"}}'::jsonb);
SELECT is(
  (SELECT event_hash FROM public.keytag_webhook_events WHERE tekmetric_ro_id=900000001 AND payment_id=11111),
  encode(extensions.digest('{"event":"Payment made by X","data":{"id":11111,"repairOrderId":900000001,"arPayment":true,"paymentStatus":"SUCCEEDED"}}'::jsonb::text, 'sha256'), 'hex'),
  'keytag: event_hash = sha256(raw_body::text)');

-- THE FIX: a 2nd payment on the SAME RO with a DIFFERENT payment id in the body
-- (the paid-in-full payment) is now stored — under the old synthetic hash it
-- collided with the first and was dropped.
INSERT INTO public.keytag_webhook_events (event_kind, tekmetric_ro_id, payment_id, raw_body)
VALUES ('payment_made', 900000001, 22222,
  '{"event":"Payment made by X","data":{"id":22222,"repairOrderId":900000001,"arPayment":true,"paymentStatus":"SUCCEEDED"}}'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM public.keytag_webhook_events WHERE tekmetric_ro_id=900000001 AND event_kind='payment_made'),
  2, 'keytag: two payments on one RO (different payment id in body) BOTH stored — release-bug fixed');

-- Genuine retry (byte-identical body) is still deduped.
SELECT throws_ok(
  $$ INSERT INTO public.keytag_webhook_events (event_kind, tekmetric_ro_id, payment_id, raw_body)
     VALUES ('payment_made', 900000001, 11111,
       '{"event":"Payment made by X","data":{"id":11111,"repairOrderId":900000001,"arPayment":true,"paymentStatus":"SUCCEEDED"}}'::jsonb) $$,
  '23505', NULL, 'keytag: byte-identical retry is deduped (idempotency preserved)');

-- Pre-migration historical rows (idempotency_active=false) are exempt from the
-- partial unique index — they keep their duplicates.
INSERT INTO public.keytag_webhook_events (event_kind, tekmetric_ro_id, payment_id, raw_body, idempotency_active)
VALUES ('payment_made', 900000001, 11111,
  '{"event":"Payment made by X","data":{"id":11111,"repairOrderId":900000001,"arPayment":true,"paymentStatus":"SUCCEEDED"}}'::jsonb, false);
SELECT is(
  (SELECT count(*)::int FROM public.keytag_webhook_events WHERE tekmetric_ro_id=900000001 AND payment_id=11111),
  2, 'keytag: idempotency_active=false row is exempt (historical duplicates preserved)');

-- ─── tekmetric_webhook_events (firehose — same fix) ─────────────────────
SELECT has_column('public', 'tekmetric_webhook_events', 'event_hash', 'tekmetric: has generated event_hash');

INSERT INTO public.tekmetric_webhook_events (raw_body)
VALUES ('{"event":"Payment made by X","data":{"id":33333,"repairOrderId":900000002}}'::jsonb);
INSERT INTO public.tekmetric_webhook_events (raw_body)
VALUES ('{"event":"Payment made by X","data":{"id":44444,"repairOrderId":900000002}}'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM public.tekmetric_webhook_events
   WHERE raw_body->'data'->>'repairOrderId' = '900000002'),
  2, 'tekmetric: two distinct-body events on one RO BOTH stored');

SELECT throws_ok(
  $$ INSERT INTO public.tekmetric_webhook_events (raw_body)
     VALUES ('{"event":"Payment made by X","data":{"id":33333,"repairOrderId":900000002}}'::jsonb) $$,
  '23505', NULL, 'tekmetric: byte-identical retry is deduped');

SELECT * FROM finish();
ROLLBACK;
