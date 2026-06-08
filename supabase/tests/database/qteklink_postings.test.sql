-- =====================================================================
-- pgTAP — QTekLink C8 qteklink_postings (the posting lifecycle ledger, §3)
-- =====================================================================
-- Covers 20260607080000: table + the 7 SECURITY DEFINER lifecycle RPCs + RLS +
-- the folded-in default-privileges REVOKE:
--   - table + RPCs exist; RLS enabled
--   - least-privilege GRANT MATRIX: service_role SELECT-only (writes via the definer
--     RPCs); service_role EXECUTE the RPCs; anon denied SELECT + EXECUTE
--   - lifecycle: enqueue (idempotent on logical identity) -> approve -> claim (lease) ->
--     mark_posted; the retryable mark_failed re-queues to approved; expired-lease requeue
--   - requestid uniqueness [23505]; payment-shape CHECK (sale w/o payment, payment w/ one)
--   - composite FK -> qbo_connections [23503]
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'qteklink_postings', 'qteklink_postings table exists');
SELECT has_function('public', 'qteklink_enqueue_posting',
  ARRAY['integer','text','date','bigint','bigint','text','date','integer','jsonb','text','text','text'], 'enqueue RPC exists');
SELECT has_function('public', 'qteklink_claim_posting', ARRAY['integer','text','integer'], 'claim RPC exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_postings' AND relnamespace='public'::regnamespace), true, 'RLS on qteklink_postings');

-- ─── Least-privilege grant matrix ───────────────────────────────────────
SELECT ok(has_table_privilege('service_role','public.qteklink_postings','SELECT'), 'service_role CAN SELECT');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_postings','INSERT'), 'service_role NO INSERT (definer RPCs)');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_postings','UPDATE'), 'service_role NO UPDATE');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_postings','DELETE'), 'service_role NO DELETE');
SELECT ok(has_function_privilege('service_role','public.qteklink_enqueue_posting(integer,text,date,bigint,bigint,text,date,integer,jsonb,text,text,text)','EXECUTE'), 'service_role CAN EXECUTE enqueue');
SELECT ok(has_function_privilege('service_role','public.qteklink_mark_posted(integer,text,uuid,text,jsonb)','EXECUTE'), 'service_role CAN EXECUTE mark_posted');
SELECT ok(NOT has_function_privilege('anon','public.qteklink_enqueue_posting(integer,text,date,bigint,bigint,text,date,integer,jsonb,text,text,text)','EXECUTE'), 'anon CANNOT EXECUTE enqueue');

-- ─── Seed a connection (the FK target) ──────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days');

-- ─── Lifecycle: enqueue (idempotent) -> approve -> claim -> mark_posted ──
SELECT is(
  public.qteklink_enqueue_posting(7476,'realm-A','2026-05-19'::date,152805,NULL,'sale','2026-05-19'::date,1,'{"a":1}'::jsonb,'h1','req-sale-1','pass'),
  public.qteklink_enqueue_posting(7476,'realm-A','2026-05-19'::date,152805,NULL,'sale','2026-05-19'::date,1,'{"a":1}'::jsonb,'h1','req-DIFF','pass'),
  're-enqueue the same logical identity returns the SAME id (idempotent)');
SELECT is((SELECT count(*)::int FROM public.qteklink_postings WHERE tekmetric_ro_id=152805 AND kind='sale'), 1, 'exactly one posting row for the subject');

SELECT is(public.qteklink_approve_posting(7476,'realm-A',
  (SELECT id FROM public.qteklink_postings WHERE tekmetric_ro_id=152805 AND kind='sale'), 'chris@x.com'), true, 'approve pending -> true');
SELECT is((SELECT status FROM public.qteklink_postings WHERE tekmetric_ro_id=152805 AND kind='sale'), 'approved', 'status is approved');
SELECT is((public.qteklink_claim_posting(7476,'realm-A',120)).status, 'posting', 'claim sets status=posting');
SELECT is((SELECT lease_until IS NOT NULL FROM public.qteklink_postings WHERE tekmetric_ro_id=152805 AND kind='sale'), true, 'claim set a lease');
SELECT ok((public.qteklink_claim_posting(7476,'realm-A',120)).id IS NULL, 'nothing else claimable (returns null row)');
SELECT is(public.qteklink_mark_posted(7476,'realm-A',
  (SELECT id FROM public.qteklink_postings WHERE tekmetric_ro_id=152805 AND kind='sale'), 'QBO-1', '{"Id":"1"}'::jsonb), true, 'mark_posted -> true');
SELECT is((SELECT status FROM public.qteklink_postings WHERE tekmetric_ro_id=152805 AND kind='sale'), 'posted', 'status is posted');

-- ─── Retryable mark_failed re-queues to approved; expired lease re-queues ─
SELECT public.qteklink_enqueue_posting(7476,'realm-A','2026-05-19'::date,152805,555,'payment','2026-05-19'::date,1,'{"a":1}'::jsonb,'h2','req-pay-1','pass') AS _;
SELECT public.qteklink_approve_posting(7476,'realm-A',(SELECT id FROM public.qteklink_postings WHERE payment_id=555),'chris@x.com') AS _;
SELECT public.qteklink_claim_posting(7476,'realm-A',120) AS _;
SELECT is(public.qteklink_mark_failed(7476,'realm-A',(SELECT id FROM public.qteklink_postings WHERE payment_id=555), true, '{"f":"429"}'::jsonb), true, 'mark_failed retryable -> true');
SELECT is((SELECT status FROM public.qteklink_postings WHERE payment_id=555), 'approved', 'retryable re-queued to approved');
SELECT public.qteklink_claim_posting(7476,'realm-A',-10) AS _; -- claim with an already-expired lease
SELECT ok(public.qteklink_requeue_expired_leases(7476,'realm-A') >= 1, 'expired lease re-queued');
SELECT is((SELECT status FROM public.qteklink_postings WHERE payment_id=555), 'approved', 'requeue set status=approved');

-- ─── requestid uniqueness + payment-shape CHECK + FK ─────────────────────
SELECT throws_ok($$ SELECT public.qteklink_enqueue_posting(7476,'realm-A','2026-05-20'::date,999,NULL,'sale','2026-05-20'::date,1,'{}'::jsonb,'h','req-sale-1','pass') $$, '23505', NULL, 'duplicate requestid rejected');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_posting(7476,'realm-A','2026-05-19'::date,152805,7,'sale','2026-05-19'::date,9,'{}'::jsonb,'h','rx1','pass') $$, '23514', NULL, 'sale with a payment_id rejected (CHECK)');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_posting(7476,'realm-A','2026-05-19'::date,152805,NULL,'payment','2026-05-19'::date,9,'{}'::jsonb,'h','rx2','pass') $$, '23514', NULL, 'payment without a payment_id rejected (CHECK)');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_posting(9999,'no-conn','2026-05-19'::date,1,NULL,'sale','2026-05-19'::date,1,'{}'::jsonb,'h','rx3','pass') $$, '23503', NULL, 'posting for an unbound shop/realm is FK-rejected');

-- ─── SECURITY: anon denied SELECT + EXECUTE ─────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_postings $$, '42501', NULL, 'anon cannot SELECT qteklink_postings');
SELECT throws_ok($$ SELECT public.qteklink_enqueue_posting(7476,'realm-A','2026-05-19'::date,1,NULL,'sale','2026-05-19'::date,1,'{}'::jsonb,'h','rx4','pass') $$, '42501', NULL, 'anon cannot EXECUTE enqueue');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
