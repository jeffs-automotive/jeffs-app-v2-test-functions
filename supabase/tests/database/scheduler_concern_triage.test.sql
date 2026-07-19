-- =====================================================================
-- pgTAP — concern-triage: the concern_triage_state column, the
--   concern_triage_chips table (shape / seed / RLS deny-all / uniqueness),
--   and the apply_wizard_transition allowlist recreation (regression + the
--   new arm + unknown-key ignore).
-- =====================================================================
-- Covers 20260719040000_scheduler_concern_triage.sql (feature concern-triage;
-- plan docs/scheduler/concern-triage-and-unsure-path-plan.md — INV-1/9/12/18).
-- RLS per cross-module-anchors.md: assert ROW COUNTS / error codes, never
-- exceptions (a blocked RLS write silently filters rows).
--
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── 1. customer_chat_sessions.concern_triage_state column ────────────────
SELECT has_column('public', 'customer_chat_sessions', 'concern_triage_state',
  'concern_triage_state column exists on customer_chat_sessions');
SELECT col_type_is('public', 'customer_chat_sessions', 'concern_triage_state', 'jsonb',
  'concern_triage_state is jsonb');
SELECT col_is_null('public', 'customer_chat_sessions', 'concern_triage_state',
  'concern_triage_state is nullable (sibling of concern_clarify_candidates)');

-- ─── 2. concern_triage_chips — shape ──────────────────────────────────────
SELECT has_table('public', 'concern_triage_chips', 'table exists');
SELECT col_type_is('public', 'concern_triage_chips', 'shop_id', 'integer', 'shop_id is integer');
SELECT col_type_is('public', 'concern_triage_chips', 'allowed_service_keys', 'text[]', 'allowed_service_keys is text[]');
SELECT col_type_is('public', 'concern_triage_chips', 'maps_to_categories', 'text[]', 'maps_to_categories is text[]');
SELECT col_type_is('public', 'concern_triage_chips', 'created_at', 'timestamp with time zone', 'created_at is timestamptz');
SELECT col_type_is('public', 'concern_triage_chips', 'updated_at', 'timestamp with time zone', 'updated_at is timestamptz');

-- RLS enabled + deny-all (no policies; service_role bypasses)
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.concern_triage_chips'::regclass),
  true, 'RLS is enabled');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename='concern_triage_chips'),
  0, 'zero policies (deny-all; service_role bypasses)');

-- ─── 3. seeds (12 literal audited chips for shop 7476; §10.2) ─────────────
SELECT is(
  (SELECT count(*)::int FROM public.concern_triage_chips WHERE shop_id=7476),
  12, 'shop 7476 seeded with exactly 12 category chips');
SELECT is(
  (SELECT count(*)::int FROM public.concern_triage_chips
     WHERE shop_id=7476 AND coalesce(array_length(allowed_service_keys, 1), 0) = 0),
  0, 'every seeded chip has a NON-EMPTY allowed_service_keys (no dead-end chip)');
SELECT is(
  (SELECT count(*)::int FROM public.concern_triage_chips WHERE shop_id=7476 AND chip_key='not_sure'),
  0, 'the not_sure escape is NOT a seeded row (in-code affordance)');

-- literal-subset spot checks (the **bold** confusable-matrix additions)
SELECT is(
  (SELECT display_label FROM public.concern_triage_chips WHERE shop_id=7476 AND chip_key='noise'),
  'A noise it shouldn''t be making', 'noise chip label seeded verbatim');
SELECT ok(
  (SELECT 'brake_inspection' = ANY(allowed_service_keys)
     FROM public.concern_triage_chips WHERE shop_id=7476 AND chip_key='shaking'),
  'shaking subset includes brake_inspection (§10.2 P6 confusable add #8)');
SELECT ok(
  (SELECT 'suspension_steering_check' = ANY(allowed_service_keys)
     FROM public.concern_triage_chips WHERE shop_id=7476 AND chip_key='tires'),
  'tires subset includes suspension_steering_check (§10.2 P6 confusable add #6)');
SELECT is(
  (SELECT array_length(allowed_service_keys, 1)
     FROM public.concern_triage_chips WHERE shop_id=7476 AND chip_key='warning_light'),
  10, 'warning_light seeds all 10 audited services');
SELECT is(
  (SELECT maps_to_categories FROM public.concern_triage_chips WHERE shop_id=7476 AND chip_key='steering'),
  ARRAY['steering','pulling'], 'steering chip merges the steering+pulling categories');

-- ─── 4. CHECK + uniqueness ────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.concern_triage_chips (shop_id, chip_key, display_label)
     VALUES (0, 'bad', 'X') $$,
  '23514', NULL, 'shop_id > 0 CHECK rejects non-positive shop id');
SELECT throws_ok(
  $$ INSERT INTO public.concern_triage_chips (shop_id, chip_key, display_label)
     VALUES (7476, 'noise', 'Dup') $$,
  '23505', NULL, 'unique (shop_id, chip_key)');

-- updated_at maintenance (shared scheduler-family touch trigger wiring)
SELECT lives_ok(
  $$ UPDATE public.concern_triage_chips SET sort = 99 WHERE shop_id=7476 AND chip_key='noise' $$,
  'chip row is updatable');
SELECT is(
  (SELECT updated_at > created_at FROM public.concern_triage_chips WHERE shop_id=7476 AND chip_key='noise'),
  true, 'updated_at bumps on UPDATE (scheduler_appt_types_touch trigger)');

-- ─── 5. role denial (deny-all; service_role reaches via RLS bypass) ───────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.concern_triage_chips $$, '42501', NULL, 'anon has NO privilege on the chips table');
RESET ROLE;
SET ROLE authenticated;
SELECT throws_ok($$ SELECT 1 FROM public.concern_triage_chips $$, '42501', NULL, 'authenticated has NO privilege on the chips table');
RESET ROLE;

-- ─── 6. scheduler_card_text seed for the new concern_triage card ──────────
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='concern_triage'),
  4, 'concern_triage card seeded with 4 copy slots (eyebrow/title/description/footnote)');
SELECT is(
  (SELECT body FROM public.scheduler_card_text WHERE shop_id=7476 AND card_key='concern_triage' AND slot_key='title'),
  'What kind of trouble is it?', 'concern_triage title seeded verbatim');
SELECT is(
  (SELECT count(*)::int FROM public.scheduler_card_text
     WHERE shop_id=7476 AND card_key='concern_triage' AND body <> default_body),
  0, 'seed invariant: body == default_body for every concern_triage slot');

-- ─── 7. apply_wizard_transition — allowlist recreation (INV-1) ────────────
-- Regression: the recreated RPC still exists with the frozen signature +
-- SECURITY INVOKER + pinned search_path + service_role EXECUTE grant.
SELECT has_function('public', 'apply_wizard_transition',
  ARRAY['uuid','jsonb','text','text'], 'apply_wizard_transition(uuid,jsonb,text,text) exists');
SELECT is(
  (SELECT prosecdef FROM pg_proc
     WHERE oid = 'public.apply_wizard_transition(uuid,jsonb,text,text)'::regprocedure),
  false, 'apply_wizard_transition is SECURITY INVOKER (prosecdef=false)');
SELECT ok(
  (SELECT proconfig::text LIKE '%search_path=%' FROM pg_proc
     WHERE oid = 'public.apply_wizard_transition(uuid,jsonb,text,text)'::regprocedure),
  'apply_wizard_transition pins search_path');
SELECT ok(
  has_function_privilege('service_role',
    'public.apply_wizard_transition(uuid,jsonb,text,text)', 'EXECUTE'),
  'service_role retains EXECUTE on apply_wizard_transition (CREATE OR REPLACE preserves grants)');

-- Behavior: seed a session, then one RPC call that (a) writes an EXISTING
-- column, (b) writes the NEW concern_triage_state column, (c) carries an
-- unknown key with no CASE arm — which must be silently IGNORED, not error.
INSERT INTO public.customer_chat_sessions (id, shop_id, channel)
VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 7476, 'web');

SELECT lives_ok(
  $$ SELECT public.apply_wizard_transition(
       'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'::uuid,
       '{"current_step":"concern_triage",
         "concern_triage_state":[{"concern_id":"11111111-1111-1111-1111-111111111111","triage_round":0}],
         "totally_unknown_key_with_no_arm":"ignored"}'::jsonb) $$,
  'apply_wizard_transition runs with an unknown payload key present (allowlist)');

SELECT is(
  (SELECT current_step FROM public.customer_chat_sessions
     WHERE id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
  'concern_triage', 'existing column current_step written (regression)');
SELECT is(
  (SELECT concern_triage_state FROM public.customer_chat_sessions
     WHERE id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
  '[{"concern_id":"11111111-1111-1111-1111-111111111111","triage_round":0}]'::jsonb,
  'NEW column concern_triage_state written by the added arm');
SELECT is(
  (SELECT channel FROM public.customer_chat_sessions
     WHERE id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
  'web', 'a column absent from the payload is untouched (unknown key ignored, no clobber)');

-- explicit-JSONB-null clears concern_triage_state to SQL NULL
SELECT lives_ok(
  $$ SELECT public.apply_wizard_transition(
       'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'::uuid,
       '{"concern_triage_state":null}'::jsonb) $$,
  'apply_wizard_transition accepts an explicit-null concern_triage_state');
SELECT ok(
  (SELECT concern_triage_state IS NULL FROM public.customer_chat_sessions
     WHERE id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
  'explicit JSONB null clears concern_triage_state to SQL NULL');

SELECT * FROM finish();
ROLLBACK;
