-- =====================================================================
-- pgTAP — QTekLink C7 qteklink_review_items (the resolution queue, §8/§9)
-- =====================================================================
-- Covers 20260607070000 (table + the two SECURITY DEFINER RPCs + RLS +
-- the folded-in default-privileges REVOKE):
--   - table + both RPCs exist; RLS enabled
--   - least-privilege GRANT MATRIX: service_role SELECT-only (NO INSERT/UPDATE/
--     DELETE — writes go through the definer RPCs); service_role EXECUTE both RPCs;
--     anon denied SELECT + EXECUTE
--   - ONE OPEN per (kind, subject): re-detecting the same issue REFRESHES the open
--     row (detail), never forks; after resolve the subject can RE-OPEN as a new row
--   - resolve closes one (true), re-resolving the same id is a no-op (false)
--   - validation: blank kind / bad subject_kind / blank subject_ref / non-positive
--     shop / blank resolved_by all P0001
--   - composite FK: an item for an unbound (shop,realm) is rejected [23503]
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence + RLS ────────────────────────────────────────────────────
SELECT has_table('public', 'qteklink_review_items', 'qteklink_review_items table exists');
SELECT has_function('public', 'qteklink_upsert_review_item',
  ARRAY['integer','text','text','text','text','jsonb'], 'qteklink_upsert_review_item RPC exists');
SELECT has_function('public', 'qteklink_resolve_review_item',
  ARRAY['integer','text','uuid','jsonb','text'], 'qteklink_resolve_review_item RPC exists');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='qteklink_review_items' AND relnamespace='public'::regnamespace), true, 'RLS on qteklink_review_items');

-- ─── Least-privilege grant matrix (post-REVOKE) ─────────────────────────
SELECT ok(has_table_privilege('service_role','public.qteklink_review_items','SELECT'), 'service_role CAN SELECT (DAL read)');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_review_items','INSERT'), 'service_role NO INSERT (writes via definer RPCs)');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_review_items','UPDATE'), 'service_role NO UPDATE');
SELECT ok(NOT has_table_privilege('service_role','public.qteklink_review_items','DELETE'), 'service_role NO DELETE');
SELECT ok(has_function_privilege('service_role','public.qteklink_upsert_review_item(integer,text,text,text,text,jsonb)','EXECUTE'), 'service_role CAN EXECUTE upsert RPC');
SELECT ok(has_function_privilege('service_role','public.qteklink_resolve_review_item(integer,text,uuid,jsonb,text)','EXECUTE'), 'service_role CAN EXECUTE resolve RPC');
SELECT ok(NOT has_function_privilege('anon','public.qteklink_upsert_review_item(integer,text,text,text,text,jsonb)','EXECUTE'), 'anon CANNOT EXECUTE upsert RPC');
SELECT ok(NOT has_function_privilege('anon','public.qteklink_resolve_review_item(integer,text,uuid,jsonb,text)','EXECUTE'), 'anon CANNOT EXECUTE resolve RPC');

-- ─── Seed a connection (the FK target) ──────────────────────────────────
INSERT INTO public.qbo_connections (realm_id, shop_id, access_token_expires_at, refresh_token_expires_at)
VALUES ('realm-A', 7476, now() + interval '1 hour', now() + interval '100 days');

-- ─── ONE OPEN per (kind, subject): re-detect REFRESHES (no fork) ─────────
SELECT is(
  public.qteklink_upsert_review_item(7476,'realm-A','unmapped','mapping_key','fee:Synchrony','{"a":1}'::jsonb),
  public.qteklink_upsert_review_item(7476,'realm-A','unmapped','mapping_key','fee:Synchrony','{"a":2}'::jsonb),
  're-detecting the same (kind,subject) refreshes the SAME open row (no fork)');
SELECT is((SELECT count(*)::int FROM public.qteklink_review_items
  WHERE shop_id=7476 AND kind='unmapped' AND subject_kind='mapping_key' AND subject_ref='fee:Synchrony' AND status='open'), 1, 'exactly one OPEN item for the subject');
SELECT is((SELECT detail->>'a' FROM public.qteklink_review_items
  WHERE shop_id=7476 AND subject_ref='fee:Synchrony' AND status='open'), '2', 'detail refreshed to the latest detection');

-- a DIFFERENT kind on the same subject is a SEPARATE open item
SELECT isnt(public.qteklink_upsert_review_item(7476,'realm-A','tax_mismatch','mapping_key','fee:Synchrony','{}'::jsonb), NULL, 'a different kind on the same subject opens a separate item');
SELECT is((SELECT count(*)::int FROM public.qteklink_review_items WHERE shop_id=7476 AND subject_ref='fee:Synchrony' AND status='open'), 2, 'two open items (distinct kinds) for the subject');

-- ─── Resolve closes one (true); re-resolving is a no-op (false) ──────────
SELECT is(public.qteklink_resolve_review_item(7476,'realm-A',
  (SELECT id FROM public.qteklink_review_items WHERE shop_id=7476 AND kind='unmapped' AND subject_ref='fee:Synchrony' AND status='open'),
  '{"note":"picked an account"}'::jsonb, 'chris@x.com'), true, 'resolve closes the open item -> true');
SELECT is((SELECT status FROM public.qteklink_review_items WHERE shop_id=7476 AND kind='unmapped' AND subject_ref='fee:Synchrony' ORDER BY created_at DESC LIMIT 1), 'resolved', 'item is now resolved');
SELECT is(public.qteklink_resolve_review_item(7476,'realm-A', gen_random_uuid(), '{}'::jsonb, 'chris@x.com'), false, 're-resolving a non-open id -> false (no-op)');

-- after resolve, the same (kind,subject) can RE-OPEN as a new row
SELECT isnt(public.qteklink_upsert_review_item(7476,'realm-A','unmapped','mapping_key','fee:Synchrony','{"a":3}'::jsonb), NULL, 'the resolved subject can re-open as a new item');
SELECT is((SELECT count(*)::int FROM public.qteklink_review_items WHERE shop_id=7476 AND kind='unmapped' AND subject_ref='fee:Synchrony'), 2, 'one resolved + one re-opened (partial unique only binds OPEN)');

-- ─── Validation (RPC RAISEs P0001) ──────────────────────────────────────
SELECT throws_ok($$ SELECT public.qteklink_upsert_review_item(7476,'realm-A','   ','ro','1','{}'::jsonb) $$, 'P0001', NULL, 'blank kind rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_review_item(7476,'realm-A','x','bogus','1','{}'::jsonb) $$, 'P0001', NULL, 'bad subject_kind rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_review_item(7476,'realm-A','x','ro','   ','{}'::jsonb) $$, 'P0001', NULL, 'blank subject_ref rejected');
SELECT throws_ok($$ SELECT public.qteklink_upsert_review_item(0,'realm-A','x','ro','1','{}'::jsonb) $$, 'P0001', NULL, 'non-positive shop rejected');
SELECT throws_ok($$ SELECT public.qteklink_resolve_review_item(7476,'realm-A',gen_random_uuid(),'{}'::jsonb,'   ') $$, 'P0001', NULL, 'blank resolved_by rejected');

-- ─── Composite FK: an item for an unbound (shop,realm) is rejected ───────
SELECT throws_ok($$ SELECT public.qteklink_upsert_review_item(9999,'no-conn','x','ro','1','{}'::jsonb) $$, '23503', NULL, 'item for an unbound shop/realm is FK-rejected');

-- ─── SECURITY: anon denied SELECT + EXECUTE ─────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.qteklink_review_items $$, '42501', NULL, 'anon cannot SELECT qteklink_review_items');
SELECT throws_ok($$ SELECT public.qteklink_upsert_review_item(7476,'realm-A','x','ro','1','{}'::jsonb) $$, '42501', NULL, 'anon cannot EXECUTE the upsert RPC');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
