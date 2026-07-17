-- =====================================================================
-- pgTAP — Back Office module (issues + audit + RPCs + settings)
-- =====================================================================
-- Covers 20260717170000 / 170500 / 171000:
--   - tables + all RPCs exist; RLS enabled on both tables
--   - least-privilege grants: service_role SELECT-only (writes via definer RPCs),
--     service_role EXECUTE RPCs, anon denied SELECT + EXECUTE
--   - the status machine: create->open, send_to_sa, submit_fix, verify(=close),
--     the awaiting_verify->sent_to_sa re-send loop, and guarded no-ops on wrong
--     from-state (return false, no transition)
--   - shop-scoping: a transition with the wrong shop_id is a no-op
--   - reopened dedup: one row per (shop, ro, unpost cycle); refresh not fork;
--     audit 'detected' only on first create
--   - open-RO auto-close: close_open_ro flips ro_status + returns the ids
--   - dashboard_counts returns the three tallies
--   - validation RAISEs (bad kind / bad source)
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'back_office_issues', 'back_office_issues table exists');
SELECT has_table('public', 'back_office_issue_events', 'back_office_issue_events table exists');
SELECT has_function('public', 'back_office_create_issue', ARRAY['integer','text','text','jsonb','text','text'], 'create_issue RPC exists');
SELECT has_function('public', 'back_office_send_to_sa', ARRAY['integer','uuid','text','text'], 'send_to_sa RPC exists');
SELECT has_function('public', 'back_office_submit_fix', ARRAY['integer','uuid','text','text'], 'submit_fix RPC exists');
SELECT has_function('public', 'back_office_verify', ARRAY['integer','uuid','text','text'], 'verify RPC exists');
SELECT has_function('public', 'back_office_upsert_reopened', ARRAY['integer','bigint','jsonb'], 'upsert_reopened RPC exists');
SELECT has_function('public', 'back_office_close_open_ro', ARRAY['integer','text','bigint','timestamptz'], 'close_open_ro RPC exists');
SELECT has_function('public', 'back_office_dashboard_counts', ARRAY['integer','date','integer'], 'dashboard_counts RPC exists');
SELECT has_function('public', 'back_office_upsert_settings', ARRAY['integer','text','jsonb'], 'upsert_settings RPC exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='back_office_issues' AND relnamespace='public'::regnamespace), true, 'RLS on back_office_issues');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='back_office_issue_events' AND relnamespace='public'::regnamespace), true, 'RLS on back_office_issue_events');

-- ─── Least-privilege grant matrix ───────────────────────────────────────
SELECT ok(has_table_privilege('service_role','public.back_office_issues','SELECT'), 'service_role CAN SELECT issues');
SELECT ok(NOT has_table_privilege('service_role','public.back_office_issues','INSERT'), 'service_role NO INSERT issues (definer RPCs only)');
SELECT ok(NOT has_table_privilege('service_role','public.back_office_issues','UPDATE'), 'service_role NO UPDATE issues');
SELECT ok(NOT has_table_privilege('service_role','public.back_office_issue_events','INSERT'), 'service_role NO INSERT audit');
SELECT ok(has_function_privilege('service_role','public.back_office_verify(integer,uuid,text,text)','EXECUTE'), 'service_role CAN EXECUTE verify');
SELECT ok(NOT has_function_privilege('anon','public.back_office_create_issue(integer,text,text,jsonb,text,text)','EXECUTE'), 'anon CANNOT EXECUTE create');

-- ─── Seed a connection (FK target for invoice/open-ro realm) ─────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days');

-- ─── create -> open, with an audit 'created' row ────────────────────────
SELECT isnt(
  public.back_office_create_issue(7476, 'invoice_issue', 'manual',
    '{"realm_id":"realm-A","ro_number":"154157","vendor_name":"Koch 33 Mazda","bill_no":"110381"}'::jsonb,
    'chris@x.com', 'qteklink'),
  NULL, 'create_issue returns an id');
SELECT is((SELECT status FROM public.back_office_issues WHERE ro_number='154157'), 'open', 'new issue is open');
SELECT is((SELECT count(*)::int FROM public.back_office_issue_events e JOIN public.back_office_issues i ON i.id=e.issue_id
  WHERE i.ro_number='154157' AND e.action='created'), 1, 'a created audit row was written');

-- ─── send_to_sa (open -> sent_to_sa); wrong from-state + wrong shop = no-op ─
SELECT is(public.back_office_send_to_sa(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='154157'), 'chris@x.com', 'part not received'),
  'sent_to_sa', 'send_to_sa from open -> sent_to_sa');
SELECT is((SELECT status FROM public.back_office_issues WHERE ro_number='154157'), 'sent_to_sa', 'status is sent_to_sa');
SELECT is((SELECT bo_notes FROM public.back_office_issues WHERE ro_number='154157'), 'part not received', 'bo_notes captured');
SELECT is(public.back_office_send_to_sa(9999, (SELECT id FROM public.back_office_issues WHERE ro_number='154157'), 'x', 'y'),
  'noop', 'send_to_sa with the WRONG shop is a no-op (tenant scoping)');

-- ─── submit_fix (sent_to_sa -> awaiting_verify) ─────────────────────────
SELECT is(public.back_office_submit_fix(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='154157'), 'zane@x.com', 'marked received on order screen'),
  true, 'submit_fix from sent_to_sa -> true');
SELECT is((SELECT status FROM public.back_office_issues WHERE ro_number='154157'), 'awaiting_verify', 'status is awaiting_verify');
SELECT is((SELECT sa_notes FROM public.back_office_issues WHERE ro_number='154157'), 'marked received on order screen', 'sa_notes captured');
SELECT is(public.back_office_submit_fix(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='154157'), 'x', 'y'),
  false, 'submit_fix again (not sent_to_sa) is a no-op');

-- ─── the re-send loop (awaiting_verify -> sent_to_sa = resent_to_sa) ────
SELECT is(public.back_office_send_to_sa(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='154157'), 'chris@x.com', 'still wrong'),
  'resent_to_sa', 'send_to_sa from awaiting_verify -> resent_to_sa (the loop)');
SELECT is((SELECT count(*)::int FROM public.back_office_issue_events e JOIN public.back_office_issues i ON i.id=e.issue_id
  WHERE i.ro_number='154157' AND e.action='resent_to_sa'), 1, 'a resent_to_sa audit row was written');

-- ─── verify = close (any active -> verified); re-verify = no-op ─────────
SELECT is(public.back_office_submit_fix(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='154157'), 'zane@x.com', 'really fixed now'), true, 'sa re-submits');
SELECT is(public.back_office_verify(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='154157'), 'chris@x.com', 'qteklink'),
  true, 'verify -> true');
SELECT is((SELECT status FROM public.back_office_issues WHERE ro_number='154157'), 'verified', 'status is verified');
SELECT ok((SELECT verified_at IS NOT NULL AND verified_by='chris@x.com' FROM public.back_office_issues WHERE ro_number='154157'), 'verified stamps verified_at + verified_by');
SELECT is(public.back_office_verify(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='154157'), 'x', 'qteklink'),
  false, 're-verifying a verified issue is a no-op');

-- ─── reopened dedup: one row per (shop, ro, unpost cycle) ────────────────
SELECT is((SELECT was_created FROM public.back_office_upsert_reopened(7476, 154119,
  '{"unposted_at":"2026-07-16T15:12:00Z","change_type":"unposted","ro_number":"154119","new_total_cents":632593}'::jsonb)),
  true, 'first reopened detection creates the row (was_created)');
SELECT is((SELECT was_created FROM public.back_office_upsert_reopened(7476, 154119,
  '{"unposted_at":"2026-07-16T15:12:00Z","change_type":"date_changed","ro_number":"154119","new_total_cents":632593}'::jsonb)),
  false, 're-detecting the SAME cycle refreshes (not was_created)');
SELECT is((SELECT count(*)::int FROM public.back_office_issues WHERE kind='reopened_ro' AND tekmetric_ro_id=154119), 1, 'exactly one reopened row for the cycle');
SELECT is((SELECT context->>'change_type' FROM public.back_office_issues WHERE kind='reopened_ro' AND tekmetric_ro_id=154119), 'date_changed', 'context refreshed to the latest classification');
SELECT is((SELECT count(*)::int FROM public.back_office_issue_events e JOIN public.back_office_issues i ON i.id=e.issue_id
  WHERE i.kind='reopened_ro' AND i.tekmetric_ro_id=154119 AND e.action='detected'), 1, 'detected audit written ONCE (only on create)');
-- a DIFFERENT unpost cycle (later unposted_at) is a separate row
SELECT is((SELECT was_created FROM public.back_office_upsert_reopened(7476, 154119,
  '{"unposted_at":"2026-07-17T09:00:00Z","change_type":"total_changed","ro_number":"154119"}'::jsonb)),
  true, 'a later unpost cycle is a new row');
SELECT is((SELECT count(*)::int FROM public.back_office_issues WHERE kind='reopened_ro' AND tekmetric_ro_id=154119), 2, 'two reopened rows (two cycles)');

-- ─── open-RO auto-close + verify gate (decision #12) ────────────────────
SELECT public.back_office_create_issue(7476, 'open_ro', 'manual', '{"realm_id":"realm-A","ro_number":"200001"}'::jsonb, 'chris@x.com', 'qteklink');
-- an open_ro cannot be verified while the RO is still open
SELECT is(public.back_office_verify(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='200001'), 'chris@x.com', 'qteklink'),
  false, 'verify is BLOCKED on an open_ro until the RO closes (decision #12)');
SELECT is((SELECT status FROM public.back_office_issues WHERE ro_number='200001'), 'open', 'the blocked open_ro is still open (no transition)');
SELECT is(array_length(public.back_office_close_open_ro(7476, '200001', 555, now()), 1), 1, 'close_open_ro flips the matching open_ro and returns 1 id');
SELECT is((SELECT context->>'ro_status' FROM public.back_office_issues WHERE ro_number='200001'), 'ro_closed', 'open_ro is now ro_closed');
SELECT is((SELECT count(*)::int FROM public.back_office_issue_events e JOIN public.back_office_issues i ON i.id=e.issue_id
  WHERE i.ro_number='200001' AND e.action='ro_closed'), 1, 'ro_closed audit written');
SELECT is(coalesce(array_length(public.back_office_close_open_ro(7476, '200001', 555, now()), 1), 0), 0, 'closing an already-closed open_ro returns no ids (idempotent)');
-- now that it's closed, verify is allowed
SELECT is(public.back_office_verify(7476, (SELECT id FROM public.back_office_issues WHERE ro_number='200001'), 'chris@x.com', 'qteklink'),
  true, 'verify is ALLOWED once the RO has closed');

-- ─── dashboard_counts ───────────────────────────────────────────────────
SELECT ok(
  (public.back_office_dashboard_counts(7476, date_trunc('month', now())::date, 48)) ? 'open_count'
  AND (public.back_office_dashboard_counts(7476, date_trunc('month', now())::date, 48)) ? 'closed_this_month'
  AND (public.back_office_dashboard_counts(7476, date_trunc('month', now())::date, 48)) ? 'stale_count',
  'dashboard_counts returns the three tallies');
SELECT is(
  ((public.back_office_dashboard_counts(7476, date_trunc('month', now())::date, 48))->>'closed_this_month')::int,
  2, 'closed_this_month counts both verified issues (the invoice flow + the closed open_ro)');

-- ─── Validation ─────────────────────────────────────────────────────────
SELECT throws_ok($$ SELECT public.back_office_create_issue(7476,'bogus','manual','{}'::jsonb,'x','qteklink') $$, 'P0001', NULL, 'bad kind rejected');
SELECT throws_ok($$ SELECT public.back_office_create_issue(7476,'misc','bogus','{}'::jsonb,'x','qteklink') $$, 'P0001', NULL, 'bad source rejected');

-- ─── SECURITY: anon denied ──────────────────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.back_office_issues $$, '42501', NULL, 'anon cannot SELECT issues');
SELECT throws_ok($$ SELECT public.back_office_verify(7476, gen_random_uuid(), 'x', 'qteklink') $$, '42501', NULL, 'anon cannot EXECUTE verify');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
