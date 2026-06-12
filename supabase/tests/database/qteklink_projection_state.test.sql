-- =====================================================================
-- pgTAP — QTekLink payment-projection watermark (20260612234000)
-- =====================================================================
-- Covers: the monotonic advance RPC (insert, forward advance, NEVER backwards),
-- input validation, FK enforcement, and the anon/service_role denial matrix.
--
-- Runnable --local AND --linked (SET ROLE postgres — the CLI's NOINHERIT login
-- role can't see pgTAP or the service_role-only RPCs). Synthetic tenant 424246
-- (the live shop 7476 must never collide). Run: supabase test db
-- =====================================================================

BEGIN;
SET ROLE postgres;
SET LOCAL search_path TO public, extensions;
SELECT * FROM no_plan();

SELECT has_table('public', 'qteklink_projection_state', 'watermark table exists');
SELECT has_function('public', 'qteklink_advance_projection_watermark', ARRAY['integer','text','timestamptz'], 'advance RPC exists');
SELECT ok(has_table_privilege('service_role', 'public.qteklink_projection_state', 'SELECT'), 'service_role CAN SELECT');
SELECT ok(NOT has_table_privilege('service_role', 'public.qteklink_projection_state', 'INSERT'), 'service_role NO direct INSERT (RPC only)');
SELECT ok(NOT has_function_privilege('anon', 'public.qteklink_advance_projection_watermark(integer,text,timestamptz)', 'EXECUTE'), 'anon CANNOT EXECUTE advance');

-- Seed the FK target.
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('pgtap-realm-W', 424246, now() + interval '1 hour', now() + interval '100 days');

-- Insert → forward advance → a BACKWARDS advance keeps the newer mark (monotonic).
SELECT is(public.qteklink_advance_projection_watermark(424246, 'pgtap-realm-W', '2026-06-12T10:00:00Z'::timestamptz),
  '2026-06-12T10:00:00Z'::timestamptz, 'first advance inserts the mark');
SELECT is(public.qteklink_advance_projection_watermark(424246, 'pgtap-realm-W', '2026-06-12T11:00:00Z'::timestamptz),
  '2026-06-12T11:00:00Z'::timestamptz, 'forward advance moves the mark');
SELECT is(public.qteklink_advance_projection_watermark(424246, 'pgtap-realm-W', '2026-06-12T09:00:00Z'::timestamptz),
  '2026-06-12T11:00:00Z'::timestamptz, 'a BACKWARDS advance is ignored (monotonic — a slow concurrent reducer cannot regress the mark)');
SELECT is((SELECT last_reduced_received_at FROM public.qteklink_projection_state WHERE shop_id = 424246),
  '2026-06-12T11:00:00Z'::timestamptz, 'stored mark is the newest');

-- Validation + FK.
SELECT throws_ok($$ SELECT public.qteklink_advance_projection_watermark(424246, 'pgtap-realm-W', NULL) $$, 'P0001', NULL, 'NULL watermark rejected');
SELECT throws_ok($$ SELECT public.qteklink_advance_projection_watermark(99999, 'no-conn', '2026-06-12T10:00:00Z'::timestamptz) $$, '23503', NULL, 'unbound shop/realm FK-rejected');

-- anon denial on the table itself.
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_projection_state $$, '42501', NULL, 'anon cannot SELECT the watermark');
SET ROLE postgres;

SELECT * FROM finish();
ROLLBACK;
