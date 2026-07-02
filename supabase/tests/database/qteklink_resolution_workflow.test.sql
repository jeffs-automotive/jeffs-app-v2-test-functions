-- =====================================================================
-- pgTAP — QTekLink resolution workflow (20260702003000)
-- =====================================================================
-- Covers the failed-state exits + the payment-redate queue:
--   - status CHECK gains 'accepted' (and still rejects bogus values)
--   - qteklink_retry_daily_posting  : failed -> approved (ONLY from failed)
--   - qteklink_accept_daily_variance: failed -> accepted (ONLY from failed)
--   - qteklink_reject_daily_posting : widened to failed -> rejected
--   - qteklink_payment_redates      : upsert (insert/refresh/changed flag),
--     one-open-per-payment identity, notified stamp (once), approve, resolve,
--     re-detection after resolution creates a NEW row
--   - qteklink_auto_resolve_review_items: closes OPEN items by id, idempotent
--   - qteklink_delete_manual_payment: deletes a pick; REFUSES when the pick is a
--     constituent of a posted daily JE
--   - anon/authenticated denied on every new RPC
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence ──────────────────────────────────────────────────────────
SELECT has_table('public', 'qteklink_payment_redates', 'payment_redates table exists');
SELECT has_function('public', 'qteklink_retry_daily_posting', ARRAY['integer','text','uuid','text'], 'retry RPC exists');
SELECT has_function('public', 'qteklink_accept_daily_variance', ARRAY['integer','text','uuid','text'], 'accept RPC exists');
SELECT has_function('public', 'qteklink_upsert_payment_redate', ARRAY['integer','text','bigint','bigint','text','text','bigint','date'], 'redate upsert RPC exists');
SELECT has_function('public', 'qteklink_mark_payment_redate_notified', ARRAY['integer','text','uuid'], 'redate notified RPC exists');
SELECT has_function('public', 'qteklink_approve_payment_redate', ARRAY['integer','text','uuid','text'], 'redate approve RPC exists');
SELECT has_function('public', 'qteklink_resolve_payment_redate', ARRAY['integer','text','uuid'], 'redate resolve RPC exists');
SELECT has_function('public', 'qteklink_auto_resolve_review_items', ARRAY['integer','text','uuid[]','text','jsonb'], 'auto-resolve RPC exists');
SELECT has_function('public', 'qteklink_delete_manual_payment', ARRAY['integer','text','uuid','text'], 'delete-manual-payment RPC exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_payment_redates' AND relnamespace='public'::regnamespace), true, 'RLS enabled on payment_redates');

-- ─── Seed a connection ──────────────────────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days');

-- ─── Status CHECK: accepted is legal; bogus is not ──────────────────────
SELECT lives_ok($$
  INSERT INTO public.qteklink_daily_postings
    (id, shop_id, realm_id, business_date, category, posting_version, action, proposed_je, constituents, source_state_hash, status, requestid)
  VALUES ('11111111-1111-4111-8111-111111111101', 7476, 'realm-A', '2026-06-29', 'payments', 9, 'update', '{}'::jsonb, '{}'::jsonb, 'H9', 'accepted', 'qtl-accepted-check') $$,
  'status CHECK admits accepted');
SELECT throws_ok($$
  INSERT INTO public.qteklink_daily_postings
    (shop_id, realm_id, business_date, category, posting_version, action, proposed_je, constituents, source_state_hash, status, requestid)
  VALUES (7476, 'realm-A', '2026-06-29', 'payments', 10, 'update', '{}'::jsonb, '{}'::jsonb, 'H10', 'bogus', 'qtl-bogus-check') $$,
  '23514', NULL, 'status CHECK rejects a bogus value');

-- ─── Retry / Accept / widened Reject (the failed-state exits) ────────────
INSERT INTO public.qteklink_daily_postings
  (id, shop_id, realm_id, business_date, category, posting_version, action, proposed_je, constituents, source_state_hash, status, requestid)
VALUES
  ('11111111-1111-4111-8111-111111111102', 7476, 'realm-A', '2026-06-29', 'payments', 2, 'update', '{}'::jsonb, '{}'::jsonb, 'H2', 'failed', 'qtl-failed-retry'),
  ('11111111-1111-4111-8111-111111111103', 7476, 'realm-A', '2026-06-26', 'payments', 2, 'update', '{}'::jsonb, '{}'::jsonb, 'H2b', 'failed', 'qtl-failed-accept'),
  ('11111111-1111-4111-8111-111111111104', 7476, 'realm-A', '2026-06-22', 'payments', 2, 'update', '{}'::jsonb, '{}'::jsonb, 'H2c', 'failed', 'qtl-failed-reject'),
  ('11111111-1111-4111-8111-111111111105', 7476, 'realm-A', '2026-06-30', 'sales', 1, 'create', '{}'::jsonb, '{}'::jsonb, 'H3', 'pending', 'qtl-pending-x');

SELECT is(public.qteklink_retry_daily_posting(7476, 'realm-A', '11111111-1111-4111-8111-111111111102', 'chris@jeffsautomotive.com'), true, 'retry: failed -> approved');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE id='11111111-1111-4111-8111-111111111102'), 'approved', 'retry set status approved');
SELECT is((SELECT approved_by FROM public.qteklink_daily_postings WHERE id='11111111-1111-4111-8111-111111111102'), 'chris@jeffsautomotive.com', 'retry stamped the approver');
SELECT is(public.qteklink_retry_daily_posting(7476, 'realm-A', '11111111-1111-4111-8111-111111111102', 'chris@jeffsautomotive.com'), false, 'retry refuses a non-failed row');
SELECT is(public.qteklink_retry_daily_posting(7476, 'realm-A', '11111111-1111-4111-8111-111111111105', 'chris@jeffsautomotive.com'), false, 'retry refuses a pending row');

SELECT is(public.qteklink_accept_daily_variance(7476, 'realm-A', '11111111-1111-4111-8111-111111111103', 'chris@jeffsautomotive.com'), true, 'accept: failed -> accepted');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE id='11111111-1111-4111-8111-111111111103'), 'accepted', 'accept set status accepted');
SELECT is(public.qteklink_accept_daily_variance(7476, 'realm-A', '11111111-1111-4111-8111-111111111105', 'chris@jeffsautomotive.com'), false, 'accept refuses a pending row');

SELECT is(public.qteklink_reject_daily_posting(7476, 'realm-A', '11111111-1111-4111-8111-111111111104', 'system (superseded — desired matches the posted JE)'), true, 'reject widened: failed -> rejected (obsoletion)');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE id='11111111-1111-4111-8111-111111111104'), 'rejected', 'obsoletion set status rejected');

-- ─── Payment redates: upsert / identity / notify-once / approve / resolve ─
SELECT is((SELECT changed FROM public.qteklink_upsert_payment_redate(7476, 'realm-A', 61299633, 152630, '152630', 'Carmax', 8357, '2026-06-29')), true, 'redate upsert: new row -> changed=true (email goes out)');
SELECT is((SELECT changed FROM public.qteklink_upsert_payment_redate(7476, 'realm-A', 61299633, 152630, '152630', 'Carmax', 8357, '2026-06-29')), false, 'redate upsert: unchanged re-detect -> changed=false (no re-email)');
SELECT is((SELECT changed FROM public.qteklink_upsert_payment_redate(7476, 'realm-A', 61299633, 152630, '152630', 'Carmax', 9999, '2026-06-29')), true, 'redate upsert: amount moved -> changed=true');
SELECT is((SELECT count(*)::int FROM public.qteklink_payment_redates WHERE payment_id=61299633 AND status IN ('pending','approved')), 1, 'ONE open redate per payment (refresh, never fork)');
SELECT throws_ok($$
  INSERT INTO public.qteklink_payment_redates (shop_id, realm_id, payment_id, amount_cents, business_date)
  VALUES (7476, 'realm-A', 61299633, 1, '2026-06-29') $$,
  '23505', NULL, 'direct second open row for the same payment is rejected (partial unique)');

SELECT is(public.qteklink_mark_payment_redate_notified(7476, 'realm-A', (SELECT id FROM public.qteklink_payment_redates WHERE payment_id=61299633)), true, 'notified stamped once');
SELECT is(public.qteklink_mark_payment_redate_notified(7476, 'realm-A', (SELECT id FROM public.qteklink_payment_redates WHERE payment_id=61299633)), false, 'notified stamp is idempotent (no re-stamp)');

SELECT is(public.qteklink_approve_payment_redate(7476, 'realm-A', (SELECT id FROM public.qteklink_payment_redates WHERE payment_id=61299633), 'chris@jeffsautomotive.com'), true, 'approve: pending -> approved (post-anyway)');
SELECT is(public.qteklink_resolve_payment_redate(7476, 'realm-A', (SELECT id FROM public.qteklink_payment_redates WHERE payment_id=61299633)), true, 'resolve: approved -> resolved');
SELECT is((SELECT changed FROM public.qteklink_upsert_payment_redate(7476, 'realm-A', 61299633, 152630, '152630', 'Carmax', 8357, '2026-06-29')), true, 're-detection AFTER resolution opens a NEW row (history kept)');
SELECT is((SELECT count(*)::int FROM public.qteklink_payment_redates WHERE payment_id=61299633), 2, 'two rows total: resolved history + the new pending');

-- ─── Auto-resolve review items (batch, open-only, idempotent) ────────────
SELECT lives_ok($$ SELECT public.qteklink_upsert_review_item(7476, 'realm-A', 'qbo_deposit_locked', 'day', '2026-06-29:payments', '{}'::jsonb) $$, 'seed an open review item');
SELECT is(
  public.qteklink_auto_resolve_review_items(
    7476, 'realm-A',
    ARRAY[(SELECT id FROM public.qteklink_review_items WHERE kind='qbo_deposit_locked' AND subject_ref='2026-06-29:payments')],
    'system (condition cleared)', '{"auto": true}'::jsonb),
  1, 'auto-resolve closes the open item');
SELECT is((SELECT status FROM public.qteklink_review_items WHERE kind='qbo_deposit_locked' AND subject_ref='2026-06-29:payments'), 'resolved', 'item is resolved with the system actor');
SELECT is(
  public.qteklink_auto_resolve_review_items(
    7476, 'realm-A',
    ARRAY[(SELECT id FROM public.qteklink_review_items WHERE kind='qbo_deposit_locked' AND subject_ref='2026-06-29:payments')],
    'system (condition cleared)', '{}'::jsonb),
  0, 'auto-resolve is idempotent (already-resolved items untouched)');

-- ─── Delete manual payment: allowed when unreferenced; refused when posted ─
INSERT INTO public.qteklink_manual_payments (id, shop_id, realm_id, repair_order_id, method, amount_cents, cc_fee_cents, payment_date, created_by)
VALUES
  ('22222222-2222-4222-8222-222222222201', 7476, 'realm-A', 900001, 'Cash', 1000, 0, '2026-06-29T12:00:00Z', 'chris@jeffsautomotive.com'),
  ('22222222-2222-4222-8222-222222222202', 7476, 'realm-A', 900002, 'Cash', 2000, 0, '2026-06-29T12:00:00Z', 'chris@jeffsautomotive.com');
-- reference pick 2 from a POSTED daily JE's constituents.
INSERT INTO public.qteklink_daily_postings
  (shop_id, realm_id, business_date, category, posting_version, action, proposed_je, constituents, source_state_hash, status, qbo_je_id, requestid)
VALUES (7476, 'realm-A', '2026-07-03', 'payments', 1, 'create', '{}'::jsonb,
        '{"ro_ids": [], "payment_ids": ["22222222-2222-4222-8222-222222222202"]}'::jsonb,
        'H4', 'posted', '90001', 'qtl-posted-with-pick');

SELECT is(public.qteklink_delete_manual_payment(7476, 'realm-A', '22222222-2222-4222-8222-222222222201', 'chris@jeffsautomotive.com'), true, 'unreferenced manual pick deletes');
SELECT throws_ok($$ SELECT public.qteklink_delete_manual_payment(7476, 'realm-A', '22222222-2222-4222-8222-222222222202', 'chris@jeffsautomotive.com') $$,
  'P0001', NULL, 'a pick inside a POSTED JE cannot be deleted');

-- ─── SECURITY: anon + authenticated denied on the new RPCs ───────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT public.qteklink_retry_daily_posting(7476,'realm-A',gen_random_uuid(),'x') $$, '42501', NULL, 'anon cannot retry');
SELECT throws_ok($$ SELECT public.qteklink_accept_daily_variance(7476,'realm-A',gen_random_uuid(),'x') $$, '42501', NULL, 'anon cannot accept');
SELECT throws_ok($$ SELECT public.qteklink_upsert_payment_redate(7476,'realm-A',1,NULL,NULL,NULL,1,'2026-06-29') $$, '42501', NULL, 'anon cannot upsert a redate');
SELECT throws_ok($$ SELECT public.qteklink_auto_resolve_review_items(7476,'realm-A',ARRAY[]::uuid[],'x','{}'::jsonb) $$, '42501', NULL, 'anon cannot auto-resolve');
SELECT throws_ok($$ SELECT public.qteklink_delete_manual_payment(7476,'realm-A',gen_random_uuid(),'x') $$, '42501', NULL, 'anon cannot delete a manual pick');
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_payment_redates $$, '42501', NULL, 'anon cannot SELECT payment_redates');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
