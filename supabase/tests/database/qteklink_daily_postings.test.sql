-- =====================================================================
-- pgTAP — QTekLink daily-JE rework qteklink_daily_postings (day-category ledger)
-- =====================================================================
-- Covers 20260610000000: table + the 8 SECURITY DEFINER lifecycle RPCs + RLS +
-- the default-privileges REVOKE:
--   - table + RPCs exist; RLS enabled
--   - least-privilege GRANT MATRIX: service_role SELECT-only; EXECUTE on the RPCs;
--     anon denied SELECT + EXECUTE
--   - lifecycle: enqueue (idempotent on (shop,realm,date,category,version)) ->
--     approve -> claim_by_id (lease) -> mark_posted (qbo_je_id + sync token)
--   - enqueue REFRESHES a still-PENDING row in place when the hash moved; an
--     APPROVED row is FROZEN (content untouched)
--   - refresh RPC releases a CLAIMED row back to pending (content + hash swapped,
--     approval cleared)
--   - retryable mark_failed re-queues to approved; expired-lease requeue
--   - reject uses its OWN rejected_by/rejected_at columns
--   - requestid uniqueness [23505]; category + action CHECKs; the correction-version
--     CHECK (update/delete require version > 1) [23514]; composite FK [23503]
--
-- pgTAP assertions are on ROW COUNTS / values, never exceptions-from-RLS (blocked RLS
-- writes silently filter). Runs as the BYPASSRLS migration role: supabase test db
-- =====================================================================

BEGIN;
-- Runnable BOTH --local AND --linked: `supabase test db --linked` connects as the CLI's
-- NOINHERIT login role (cli_login_postgres), which can't see pgTAP (no USAGE on
-- `extensions`) nor the service_role-only RPCs. It IS a member of postgres (BYPASSRLS,
-- inherits service_role) — so run the suite as postgres. ROLLBACK reverts the SET ROLE.
SET ROLE postgres;
SET LOCAL search_path TO public, extensions;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'qteklink_daily_postings', 'qteklink_daily_postings table exists');
SELECT has_function('public', 'qteklink_enqueue_daily_posting',
  ARRAY['integer','text','date','text','integer','text','jsonb','jsonb','text','text'], 'enqueue RPC exists');
SELECT has_function('public', 'qteklink_claim_daily_posting_by_id', ARRAY['integer','text','uuid','integer'], 'claim_by_id RPC exists');
SELECT has_function('public', 'qteklink_refresh_daily_posting', ARRAY['integer','text','uuid','text','jsonb','jsonb','text'], 'refresh RPC exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_daily_postings' AND relnamespace='public'::regnamespace), true, 'RLS on qteklink_daily_postings');

-- ─── Least-privilege grant matrix ───────────────────────────────────────
SELECT ok(has_table_privilege('service_role','public.qteklink_daily_postings','SELECT'), 'service_role CAN SELECT');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_daily_postings','INSERT'), 'service_role NO INSERT (definer RPCs)');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_daily_postings','UPDATE'), 'service_role NO UPDATE');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_daily_postings','DELETE'), 'service_role NO DELETE');
SELECT ok(has_function_privilege('service_role','public.qteklink_enqueue_daily_posting(integer,text,date,text,integer,text,jsonb,jsonb,text,text)','EXECUTE'), 'service_role CAN EXECUTE enqueue');
SELECT ok(has_function_privilege('service_role','public.qteklink_mark_daily_posted(integer,text,uuid,text,text,jsonb)','EXECUTE'), 'service_role CAN EXECUTE mark_posted');
SELECT ok(NOT has_function_privilege('anon','public.qteklink_enqueue_daily_posting(integer,text,date,text,integer,text,jsonb,jsonb,text,text)','EXECUTE'), 'anon CANNOT EXECUTE enqueue');

-- ─── Seed a connection (the FK target) ──────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('pgtap-realm-A', 424242, now() + interval '1 hour', now() + interval '100 days');

-- ─── Lifecycle: enqueue (idempotent) -> approve -> claim_by_id -> mark_posted ──
SELECT is(
  public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-05'::date,'sales',1,'create','{"je":{"lines":[{"a":1}]}}'::jsonb,'{"ro_ids":[101,102]}'::jsonb,'h-sales-1','req-d-sales-1'),
  public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-05'::date,'sales',1,'create','{"je":{"lines":[{"a":1}]}}'::jsonb,'{"ro_ids":[101,102]}'::jsonb,'h-sales-1','req-DIFF'),
  're-enqueue the same (day,category,version) returns the SAME id (idempotent)');
SELECT is((SELECT count(*)::int FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), 1, 'exactly one row for the day-category');

-- enqueue REFRESHES a still-PENDING row when the hash moved (the day grew).
SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-05'::date,'sales',1,'create','{"je":{"lines":[{"a":1},{"a":2}]}}'::jsonb,'{"ro_ids":[101,102,103]}'::jsonb,'h-sales-2','req-d-sales-1') AS _;
SELECT is((SELECT source_state_hash FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), 'h-sales-2', 'pending row refreshed to the new hash');
SELECT is((SELECT constituents->'ro_ids' FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), '[101,102,103]'::jsonb, 'pending row refreshed to the new constituents');

SELECT is(public.qteklink_approve_daily_posting(424242,'pgtap-realm-A',
  (SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), 'chris@x.com'), true, 'approve pending -> true');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), 'approved', 'status is approved');

-- an APPROVED row is FROZEN — enqueue must NOT refresh it.
SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-05'::date,'sales',1,'create','{"je":{"lines":[]}}'::jsonb,'{"ro_ids":[999]}'::jsonb,'h-sales-3','req-d-sales-1') AS _;
SELECT is((SELECT source_state_hash FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), 'h-sales-2', 'approved row NOT refreshed (frozen)');

SELECT is((public.qteklink_claim_daily_posting_by_id(424242,'pgtap-realm-A',
  (SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'),120)).status, 'posting', 'claim_by_id sets status=posting');
SELECT ok((public.qteklink_claim_daily_posting_by_id(424242,'pgtap-realm-A',
  (SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'),120)).id IS NULL, 'a claimed row cannot be claimed again (null row)');
SELECT is(public.qteklink_mark_daily_posted(424242,'pgtap-realm-A',
  (SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), 'QBO-77', '3', '{"Id":"77"}'::jsonb), true, 'mark_posted -> true');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), 'posted', 'status is posted');
SELECT is((SELECT qbo_sync_token FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), '3', 'SyncToken persisted first-class');

-- ─── A correction version: update action at version 2 ───────────────────
SELECT ok(public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-05'::date,'sales',2,'update','{"je":{"lines":[{"a":9}]}}'::jsonb,'{"ro_ids":[101,102,103,104]}'::jsonb,'h-sales-v2','req-d-sales-2') IS NOT NULL, 'correction v2 (update) enqueues');
SELECT is((SELECT count(*)::int FROM public.qteklink_daily_postings WHERE shop_id=424242 AND business_date='2026-06-05' AND category='sales'), 2, 'two versions coexist for the day-category');

-- ─── refresh: a CLAIMED row releases back to pending with new content ────
SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-05'::date,'payments',1,'create','{"je":{"lines":[{"p":1}]}}'::jsonb,'{"payment_ids":["57852813"]}'::jsonb,'h-pay-1','req-d-pay-1') AS _;
SELECT public.qteklink_approve_daily_posting(424242,'pgtap-realm-A',(SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'),'chris@x.com') AS _;
SELECT public.qteklink_claim_daily_posting_by_id(424242,'pgtap-realm-A',(SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'),120) AS _;
SELECT is(public.qteklink_refresh_daily_posting(424242,'pgtap-realm-A',
  (SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'),
  'create','{"je":{"lines":[{"p":1},{"p":2}]}}'::jsonb,'{"payment_ids":["57852813","57900001"]}'::jsonb,'h-pay-2'), true, 'refresh releases the claimed row');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'), 'pending', 'refreshed row is pending again (re-approval required)');
SELECT is((SELECT approved_by FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'), NULL, 'refresh cleared the stale approval');
SELECT is((SELECT source_state_hash FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'), 'h-pay-2', 'refresh swapped in the new hash');

-- ─── Retryable mark_failed re-queues; expired lease re-queues ────────────
SELECT public.qteklink_approve_daily_posting(424242,'pgtap-realm-A',(SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'),'chris@x.com') AS _;
SELECT public.qteklink_claim_daily_posting_by_id(424242,'pgtap-realm-A',(SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'),120) AS _;
SELECT is(public.qteklink_mark_daily_failed(424242,'pgtap-realm-A',(SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'), true, '{"f":"429"}'::jsonb), true, 'mark_failed retryable -> true');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'), 'approved', 'retryable re-queued to approved');
SELECT public.qteklink_claim_daily_posting_by_id(424242,'pgtap-realm-A',(SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'),-10) AS _; -- already-expired lease
SELECT ok(public.qteklink_requeue_expired_daily_leases(424242,'pgtap-realm-A') >= 1, 'expired lease re-queued');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='payments'), 'approved', 'requeue set status=approved');

-- ─── Reject uses its own columns ─────────────────────────────────────────
SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-05'::date,'fees',1,'create','{"je":{"lines":[{"f":1}]}}'::jsonb,'{"payment_ids":["57852813"]}'::jsonb,'h-fee-1','req-d-fee-1') AS _;
SELECT is(public.qteklink_reject_daily_posting(424242,'pgtap-realm-A',(SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='fees'),'chris@x.com'), true, 'reject pending -> true');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='fees'), 'rejected', 'status is rejected');
SELECT is((SELECT rejected_by FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='fees'), 'chris@x.com', 'rejected_by recorded (its own column)');
SELECT is((SELECT approved_by FROM public.qteklink_daily_postings WHERE shop_id=424242 AND category='fees'), NULL, 'approved_by untouched by reject');

-- ─── Constraints: requestid unique, category/action/version CHECKs, FK ────
SELECT throws_ok($$ SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-06'::date,'sales',1,'create','{}'::jsonb,'{}'::jsonb,'h','req-d-sales-1') $$, '23505', NULL, 'duplicate requestid rejected');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-06'::date,'bogus',1,'create','{}'::jsonb,'{}'::jsonb,'h','rx1') $$, 'P0001', NULL, 'bad category rejected by the RPC validation');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-06'::date,'sales',1,'destroy','{}'::jsonb,'{}'::jsonb,'h','rx2') $$, 'P0001', NULL, 'bad action rejected by the RPC validation');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-06'::date,'sales',1,'update','{}'::jsonb,'{}'::jsonb,'h','rx3') $$, '23514', NULL, 'update at version 1 rejected (correction-version CHECK)');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_daily_posting(9999,'no-conn','2026-06-06'::date,'sales',1,'create','{}'::jsonb,'{}'::jsonb,'h','rx4') $$, '23503', NULL, 'posting for an unbound shop/realm is FK-rejected');

-- ─── SECURITY: anon denied SELECT + EXECUTE ─────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_daily_postings $$, '42501', NULL, 'anon cannot SELECT qteklink_daily_postings');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_daily_posting(424242,'pgtap-realm-A','2026-06-05'::date,'sales',1,'create','{}'::jsonb,'{}'::jsonb,'h','rx5') $$, '42501', NULL, 'anon cannot EXECUTE enqueue');
-- back to postgres, NOT RESET ROLE — a --linked run would reset to the CLI login role,
-- which can't see finish().
SET ROLE postgres;

SELECT * FROM finish();
ROLLBACK;
