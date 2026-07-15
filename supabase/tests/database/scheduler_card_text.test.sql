-- =====================================================================
-- pgTAP — scheduler_card_text: shape, seeds, CHECKs, uniques, triggers,
--          the set/reset RPCs (audit + staleness), and role denial.
-- =====================================================================
-- Covers 20260715150000_scheduler_card_text.sql (feature card-text-editor;
-- plan docs/scheduler/card-text-editor-plan.md).
-- RLS per cross-module-anchors.md: assert ROW COUNTS / error codes.
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── shape ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'scheduler_card_text', 'table exists');
SELECT col_type_is('public', 'scheduler_card_text', 'updated_at', 'timestamp with time zone', 'updated_at is timestamptz');
SELECT col_type_is('public', 'scheduler_card_text', 'allowed_merge_fields', 'text[]', 'allowed_merge_fields is text[]');
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.scheduler_card_text'::regclass),
  true, 'RLS is enabled');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='scheduler_card_text'),
  0, 'zero policies (deny-all; service_role bypasses)');

-- ─── seeds (before any mutation below) ───────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting'),
  6, 'greeting seeded with 6 copy slots');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting' AND body <> default_body),
  0, 'seed invariant: body == default_body for every slot');
SELECT is(
  (SELECT body FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting' AND slot_key='title'),
  'Hi, I''m {{agent_name}} 👋', 'greeting title seeded verbatim (merge token intact)');
SELECT is(
  (SELECT allowed_merge_fields FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting' AND slot_key='description'),
  ARRAY['shop_name'], 'description allows {{shop_name}} only');

-- ─── CHECKs (all throws_ok → no persistence) ─────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_card_text (shop_id, card_key, slot_key, label, body, default_body)
     VALUES (7476, 'Bad Key!', 'slot', 'X', 'b', 'b') $$,
  '23514', NULL, 'card_key format CHECK rejects invalid key');
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_card_text (shop_id, card_key, slot_key, label, body, default_body)
     VALUES (7476, 'greeting', 'x_slot', 'X', repeat('a', 2001), 'y') $$,
  '23514', NULL, 'body length CHECK rejects >2000 chars');

-- ─── uniqueness ──────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.scheduler_card_text (shop_id, card_key, slot_key, label, body, default_body)
     VALUES (7476, 'greeting', 'title', 'Dup', 'b', 'b') $$,
  '23505', NULL, 'unique (shop_id, card_key, slot_key)');

-- ─── protection trigger ──────────────────────────────────────────────────
SELECT throws_ok(
  $$ DELETE FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting' AND slot_key='eyebrow' $$,
  'P0001', NULL, 'DELETE is always refused (deactivate instead)');
SELECT throws_ok(
  $$ UPDATE public.scheduler_card_text SET card_key='greeting2' WHERE shop_id=7476 AND card_key='greeting' AND slot_key='eyebrow' $$,
  'P0001', NULL, 'card_key is immutable');
SELECT throws_ok(
  $$ UPDATE public.scheduler_card_text SET slot_key='eyebrow2' WHERE shop_id=7476 AND card_key='greeting' AND slot_key='eyebrow' $$,
  'P0001', NULL, 'slot_key is immutable');
SELECT lives_ok(
  $$ UPDATE public.scheduler_card_text SET body='Welcome!' WHERE shop_id=7476 AND card_key='greeting' AND slot_key='eyebrow' $$,
  'body IS editable');
SELECT lives_ok(
  $$ UPDATE public.scheduler_card_text SET default_body='Welcome default' WHERE shop_id=7476 AND card_key='greeting' AND slot_key='eyebrow' $$,
  'default_body is mutable (migration copy corrections)');
SELECT is(
  (SELECT updated_at > created_at FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting' AND slot_key='eyebrow'),
  true, 'updated_at bumps on UPDATE (trigger-maintained staleness substrate)');

-- ─── set RPC (service_role): updates body + writes one audit row ──────────
SET ROLE service_role;
SELECT lives_ok(
  $$ SELECT public.scheduler_set_card_text(
       7476, 'tester@jeffsautomotive.com', 'greeting', 'title',
       'Hey there {{agent_name}} 👋', 'Title', 'Hi, I''m {{agent_name}} 👋',
       ARRAY['agent_name'], 20, NULL) $$,
  'service_role can set card text via the RPC');
RESET ROLE;
SELECT is(
  (SELECT body FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting' AND slot_key='title'),
  'Hey there {{agent_name}} 👋', 'set RPC updated the body');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_admin_audit_log
     WHERE table_name='scheduler_card_text' AND operation='manual_change'),
  1, 'set RPC wrote exactly one manual_change audit row');

-- ─── set RPC staleness ───────────────────────────────────────────────────
SET ROLE service_role;
SELECT throws_ok(
  $$ SELECT public.scheduler_set_card_text(
       7476, 'tester@jeffsautomotive.com', 'greeting', 'title',
       'x', 'Title', 'y', ARRAY['agent_name'], 20,
       '2000-01-01T00:00:00Z'::timestamptz) $$,
  'P0001', NULL, 'stale expected_updated_at → stale_write');

-- ─── reset RPC restores default_body ─────────────────────────────────────
SELECT lives_ok(
  $$ SELECT public.scheduler_reset_card_text(7476, 'tester@jeffsautomotive.com', 'greeting', 'title', NULL) $$,
  'reset RPC runs');
RESET ROLE;
SELECT is(
  (SELECT body FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting' AND slot_key='title'),
  'Hi, I''m {{agent_name}} 👋', 'reset restored the default_body');

-- ─── set RPC INSERT branch (unseeded slot) — regression guard for the
--     found-classification fix (migration 20260715180000): a first write must
--     log rows_added=1 / rows_modified=0 with a NULL pre-state snapshot. ─────
SET ROLE service_role;
SELECT lives_ok(
  $$ SELECT public.scheduler_set_card_text(
       7476, 'tester@jeffsautomotive.com', 'greeting', 'brand_new_slot',
       'Fresh copy', 'New slot', 'Fresh copy', ARRAY[]::text[], 99, NULL) $$,
  'set RPC inserts an unseeded slot');
RESET ROLE;
SELECT is(
  (SELECT body FROM public.scheduler_card_text
     WHERE shop_id=7476 AND card_key='greeting' AND slot_key='brand_new_slot'),
  'Fresh copy', 'insert-branch row persisted');
SELECT is(
  (SELECT rows_added FROM public.scheduler_admin_audit_log
     WHERE table_name='scheduler_card_text' AND diff_summary->>'slot_key'='brand_new_slot'),
  1, 'insert branch logs rows_added=1 (found-fix)');
SELECT is(
  (SELECT rows_modified FROM public.scheduler_admin_audit_log
     WHERE table_name='scheduler_card_text' AND diff_summary->>'slot_key'='brand_new_slot'),
  0, 'insert branch logs rows_modified=0');
SELECT ok(
  (SELECT pre_state_snapshot IS NULL FROM public.scheduler_admin_audit_log
     WHERE table_name='scheduler_card_text' AND diff_summary->>'slot_key'='brand_new_slot'),
  'insert branch snapshots NULL, not an empty rowtype');

-- ─── role denial ─────────────────────────────────────────────────────────
SET ROLE service_role;
SELECT throws_ok(
  $$ DELETE FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='greeting' AND slot_key='footnote' $$,
  '42501', NULL, 'service_role has no DELETE grant (belt over the trigger)');
RESET ROLE;
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.scheduler_card_text $$, '42501', NULL, 'anon cannot SELECT');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT 1 FROM public.scheduler_card_text $$, '42501', NULL, 'authenticated cannot SELECT');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
