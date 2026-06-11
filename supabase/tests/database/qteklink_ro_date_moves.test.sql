-- =====================================================================
-- pgTAP — QTekLink date-move queue + acknowledged days + notification settings
-- =====================================================================
-- Covers 20260610100000: qteklink_ro_date_moves (+4 RPCs), the daily-postings
-- 'acknowledged' status + RPC, and the extended qteklink_upsert_settings:
--   - upsert: INSERT new pending (changed=true); refresh a PENDING row's new date
--     (changed=true); unchanged re-detect (changed=false); APPROVED rows untouched
--   - approve (pending→approved), unapprove (approved→pending, clears approver),
--     resolve (pending/approved→resolved)
--   - the partial unique (one OPEN move per RO+origin); same-date CHECK; FK
--   - acknowledge: pending→acknowledged (terminal); only pending flips
--   - settings: the 9-param upsert sets + clears the notification recipients
--   - least-priv grant matrix + anon denial
--
-- Runnable --local AND --linked (SET ROLE postgres — the CLI's NOINHERIT login role
-- can't see pgTAP or the service_role-only RPCs). Synthetic tenant 424243 (the live
-- shop 7476 must never collide). Run: supabase test db
-- =====================================================================

BEGIN;
SET ROLE postgres;
SET LOCAL search_path TO public, extensions;
SELECT * FROM no_plan();

-- ─── Existence + grants ──────────────────────────────────────────────────
SELECT has_table('public', 'qteklink_ro_date_moves', 'date-moves table exists');
SELECT has_function('public', 'qteklink_upsert_date_move',
  ARRAY['integer','text','bigint','text','date','date','bigint','bigint'], 'upsert RPC exists');
SELECT has_function('public', 'qteklink_acknowledge_daily_posting', ARRAY['integer','text','uuid','text'], 'acknowledge RPC exists');
SELECT ok(has_table_privilege('service_role','public.qteklink_ro_date_moves','SELECT'), 'service_role CAN SELECT moves');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_ro_date_moves','INSERT'), 'service_role NO INSERT (definer RPCs)');
SELECT ok(NOT has_function_privilege('anon','public.qteklink_upsert_date_move(integer,text,bigint,text,date,date,bigint,bigint)','EXECUTE'), 'anon CANNOT EXECUTE upsert');

-- ─── Seed a connection (the FK target) ──────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('pgtap-realm-B', 424243, now() + interval '1 hour', now() + interval '100 days');

-- ─── Upsert: insert → changed; unchanged re-detect → not changed; refresh → changed ──
SELECT is((SELECT changed FROM public.qteklink_upsert_date_move(424243,'pgtap-realm-B',101,'101','2026-06-08'::date,'2026-06-09'::date,NULL,5000)), true, 'first detection inserts (changed=true)');
SELECT is((SELECT status FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), 'pending', 'inserted pending');
SELECT is((SELECT changed FROM public.qteklink_upsert_date_move(424243,'pgtap-realm-B',101,'101','2026-06-08'::date,'2026-06-09'::date,NULL,5000)), false, 'unchanged re-detect reports changed=false (no re-email)');
SELECT is((SELECT changed FROM public.qteklink_upsert_date_move(424243,'pgtap-realm-B',101,'101','2026-06-08'::date,'2026-06-10'::date,NULL,6000)), true, 'a pending row refreshes to a NEW new-date (changed=true)');
SELECT is((SELECT new_business_date FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), '2026-06-10'::date, 'new date stored');
SELECT is((SELECT count(*)::int FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), 1, 'one OPEN row per RO+origin (partial unique honored by the RPC)');

-- ─── Approve / unapprove / resolve ───────────────────────────────────────
SELECT is(public.qteklink_approve_date_move(424243,'pgtap-realm-B',
  (SELECT id FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), 'om@shop.com'), true, 'approve pending -> true');
SELECT is((SELECT status FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), 'approved', 'approved');
-- an APPROVED row is NOT refreshed by upsert
SELECT is((SELECT changed FROM public.qteklink_upsert_date_move(424243,'pgtap-realm-B',101,'101','2026-06-08'::date,'2026-06-11'::date,NULL,7000)), false, 'approved row untouched by upsert');
SELECT is(public.qteklink_unapprove_date_move(424243,'pgtap-realm-B',
  (SELECT id FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), 'om@shop.com'), true, 'unapprove approved -> true');
SELECT is((SELECT status FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), 'pending', 'back to pending');
SELECT is((SELECT approved_by FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), NULL, 'approver cleared');
SELECT is(public.qteklink_resolve_date_move(424243,'pgtap-realm-B',
  (SELECT id FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101)), true, 'resolve pending -> true');
SELECT is((SELECT status FROM public.qteklink_ro_date_moves WHERE shop_id=424243 AND tekmetric_ro_id=101), 'resolved', 'resolved');
-- a resolved row no longer blocks a NEW open move for the same RO+origin
SELECT is((SELECT changed FROM public.qteklink_upsert_date_move(424243,'pgtap-realm-B',101,'101','2026-06-08'::date,'2026-06-12'::date,NULL,8000)), true, 'a new move can open after resolution');

-- ─── Validation: same-date rejected; FK enforced ─────────────────────────
SELECT throws_ok($$ SELECT * FROM public.qteklink_upsert_date_move(424243,'pgtap-realm-B',102,'102','2026-06-08'::date,'2026-06-08'::date,NULL,NULL) $$, 'P0001', NULL, 'same original/new date rejected');
SELECT throws_ok($$ SELECT * FROM public.qteklink_upsert_date_move(99999,'no-conn',103,'103','2026-06-08'::date,'2026-06-09'::date,NULL,NULL) $$, '23503', NULL, 'unbound shop/realm FK-rejected');

-- ─── Acknowledge: pending → acknowledged (terminal); only pending flips ───
SELECT public.qteklink_enqueue_daily_posting(424243,'pgtap-realm-B','2026-06-01'::date,'sales',1,'create','{"je":{"lines":[{"a":1}]}}'::jsonb,'{"ro_ids":[7]}'::jsonb,'h-ack-1','req-ack-1') AS _;
SELECT is(public.qteklink_acknowledge_daily_posting(424243,'pgtap-realm-B',
  (SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424243 AND business_date='2026-06-01' AND category='sales'), 'chris@x.com'), true, 'acknowledge pending -> true');
SELECT is((SELECT status FROM public.qteklink_daily_postings WHERE shop_id=424243 AND business_date='2026-06-01' AND category='sales'), 'acknowledged', 'status acknowledged');
SELECT is(public.qteklink_acknowledge_daily_posting(424243,'pgtap-realm-B',
  (SELECT id FROM public.qteklink_daily_postings WHERE shop_id=424243 AND business_date='2026-06-01' AND category='sales'), 'chris@x.com'), false, 'acknowledge is pending-only (terminal)');

-- ─── Settings: the 9-param upsert sets + clears recipients ────────────────
SELECT public.qteklink_upsert_settings(424243,'pgtap-realm-B', NULL, NULL, NULL, NULL, NULL, 'om@shop.com', 'a@shop.com, b@shop.com') AS _;
SELECT is((SELECT office_manager_email FROM public.qteklink_settings WHERE shop_id=424243), 'om@shop.com', 'office manager email set');
SELECT is((SELECT advisor_emails FROM public.qteklink_settings WHERE shop_id=424243), 'a@shop.com, b@shop.com', 'advisor emails set');
-- NULL leaves unchanged; '' clears
SELECT public.qteklink_upsert_settings(424243,'pgtap-realm-B', true, NULL, NULL, NULL, NULL, NULL, NULL) AS _;
SELECT is((SELECT office_manager_email FROM public.qteklink_settings WHERE shop_id=424243), 'om@shop.com', 'NULL recipient param leaves value unchanged');
SELECT public.qteklink_upsert_settings(424243,'pgtap-realm-B', NULL, NULL, NULL, NULL, NULL, '', '') AS _;
SELECT is((SELECT office_manager_email FROM public.qteklink_settings WHERE shop_id=424243), NULL, 'empty string clears the recipient');

-- ─── SECURITY: anon denied ────────────────────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_ro_date_moves $$, '42501', NULL, 'anon cannot SELECT moves');
SET ROLE postgres;

SELECT * FROM finish();
ROLLBACK;
