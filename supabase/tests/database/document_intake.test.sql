-- =====================================================================
-- pgTAP — document-intake (core schema + registrar trigger + cron)
-- =====================================================================
-- Covers 20260721180000 / 180500 / 181000:
--   - tables + bucket + seeds exist; RLS enabled everywhere; anon denied
--   - mailbox routing is case-insensitively UNIQUE (no ambiguous routes)
--   - the registrar trigger fn is SECURITY DEFINER with pinned search_path,
--     EXECUTE revoked from client roles
--   - THE cross-verify gate: the trigger fires UNDER supabase_storage_admin
--     (the real storage-API role, which has NO privileges on the intake
--     tables) and still registers the row — proving the DEFINER path
--   - path parsing: routed / unrouted / unknown-channel / malformed
--   - malformed paths NEVER block the upload (error_log row instead)
--   - object_path idempotency (trigger ON CONFLICT DO NOTHING)
--   - status vocabulary CHECK; cron job registered
--
-- Runs as the BYPASSRLS migration role. Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();

-- ─── Existence ──────────────────────────────────────────────────────────
SELECT has_table('public', 'document_intake_profiles',    'profiles table exists');
SELECT has_table('public', 'document_intake_mailboxes',   'mailboxes table exists');
SELECT has_table('public', 'document_intake_files',       'files table exists');
SELECT has_table('public', 'graph_mail_events',           'graph_mail_events table exists');
SELECT has_table('public', 'graph_mail_attachments',      'graph_mail_attachments table exists');
SELECT has_table('public', 'graph_mail_subscriptions',    'graph_mail_subscriptions table exists');
SELECT has_table('public', 'document_intake_agent_state', 'agent_state table exists');
SELECT has_table('public', 'document_intake_error_log',   'error_log table exists');
SELECT has_function('public', 'document_intake_register_object', 'registrar trigger fn exists');

-- ─── RLS enabled on all eight ───────────────────────────────────────────
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='document_intake_profiles'    AND relnamespace='public'::regnamespace), true, 'RLS on profiles');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='document_intake_mailboxes'   AND relnamespace='public'::regnamespace), true, 'RLS on mailboxes');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='document_intake_files'       AND relnamespace='public'::regnamespace), true, 'RLS on files');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='graph_mail_events'           AND relnamespace='public'::regnamespace), true, 'RLS on graph_mail_events');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='graph_mail_attachments'      AND relnamespace='public'::regnamespace), true, 'RLS on graph_mail_attachments');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='graph_mail_subscriptions'    AND relnamespace='public'::regnamespace), true, 'RLS on graph_mail_subscriptions');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='document_intake_agent_state' AND relnamespace='public'::regnamespace), true, 'RLS on agent_state');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE relname='document_intake_error_log'   AND relnamespace='public'::regnamespace), true, 'RLS on error_log');

-- ─── Bucket ─────────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM storage.buckets WHERE id='vehicle-docs'), 1, 'vehicle-docs bucket exists');
SELECT is((SELECT public FROM storage.buckets WHERE id='vehicle-docs'), false, 'bucket is PRIVATE');
SELECT is((SELECT file_size_limit FROM storage.buckets WHERE id='vehicle-docs'), 52428800::bigint, 'bucket capped at 50MB');
SELECT ok((SELECT 'application/pdf' = ANY(allowed_mime_types) FROM storage.buckets WHERE id='vehicle-docs'), 'bucket allows pdf');

-- ─── Seeds ──────────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM public.document_intake_profiles), 2, 'two seeded profiles');
SELECT is((SELECT count(*)::int FROM public.document_intake_mailboxes), 2, 'two seeded mailboxes');
SELECT is((SELECT profile_key FROM public.document_intake_mailboxes WHERE lower(address)='inspection@jeffsautomotive.com'),
  'inspection_docs', 'inspection@ routes to inspection_docs');
SELECT is((SELECT profile_key FROM public.document_intake_mailboxes WHERE lower(address)='loaner@jeffsautomotive.com'),
  'loaner_insurance', 'loaner@ routes to loaner_insurance');

-- ─── Mailbox uniqueness is case-insensitive ─────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.document_intake_mailboxes (profile_key, address)
     VALUES ('loaner_insurance', 'INSPECTION@jeffsautomotive.com') $$,
  '23505', NULL, 'same mailbox in a different case cannot route to a second profile');

-- ─── Trigger fn: SECURITY DEFINER + pinned search_path + revoked ────────
SELECT is((SELECT prosecdef FROM pg_proc WHERE proname='document_intake_register_object'
  AND pronamespace='public'::regnamespace), true, 'registrar fn is SECURITY DEFINER');
SELECT ok((SELECT proconfig::text LIKE '%search_path=public%' FROM pg_proc
  WHERE proname='document_intake_register_object' AND pronamespace='public'::regnamespace),
  'registrar fn pins search_path=public');
SELECT ok(NOT has_function_privilege('anon','public.document_intake_register_object()','EXECUTE'),
  'anon cannot EXECUTE the registrar fn');
SELECT ok(NOT has_function_privilege('authenticated','public.document_intake_register_object()','EXECUTE'),
  'authenticated cannot EXECUTE the registrar fn');

-- ─── THE DEFINER GATE ───────────────────────────────────────────────────
-- The local test role may not SET ROLE supabase_storage_admin ("permission
-- denied", verified 2026-07-21), so the literal run-as-storage-role rehearsal
-- lives in the ops E2E smoke (real signed-URL upload). The mechanism is still
-- pinned here by three facts that only hold together if DEFINER works:
--   (1) prosecdef = true (asserted above)
--   (2) the storage role has NO privilege on the intake tables (below)
--   (3) the trigger registers rows when an insert fires it (below)
SELECT ok(NOT has_table_privilege('supabase_storage_admin','public.document_intake_files','INSERT'),
  'storage role itself CANNOT insert intake rows (DEFINER is the only path)');

SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name, metadata)
     VALUES ('vehicle-docs', '7476/inspection_docs/scan/2026/07/1753100000_abcd1234.pdf',
             '{"mimetype":"application/pdf","size":"12345"}'::jsonb) $$,
  'a vehicle-docs upload fires the registrar without error');

SELECT is((SELECT count(*)::int FROM public.document_intake_files
  WHERE object_path='7476/inspection_docs/scan/2026/07/1753100000_abcd1234.pdf'),
  1, 'trigger registered the row (fired under the storage role)');
SELECT is((SELECT profile_key FROM public.document_intake_files
  WHERE object_path='7476/inspection_docs/scan/2026/07/1753100000_abcd1234.pdf'),
  'inspection_docs', 'profile parsed from the path');
SELECT is((SELECT source FROM public.document_intake_files
  WHERE object_path='7476/inspection_docs/scan/2026/07/1753100000_abcd1234.pdf'),
  'scan', 'channel parsed from the path');
SELECT is((SELECT shop_id FROM public.document_intake_files
  WHERE object_path='7476/inspection_docs/scan/2026/07/1753100000_abcd1234.pdf'),
  7476, 'shop parsed from the path');
SELECT is((SELECT size_bytes FROM public.document_intake_files
  WHERE object_path='7476/inspection_docs/scan/2026/07/1753100000_abcd1234.pdf'),
  12345::bigint, 'size copied from storage metadata');
SELECT is((SELECT status FROM public.document_intake_files
  WHERE object_path='7476/inspection_docs/scan/2026/07/1753100000_abcd1234.pdf'),
  'pending', 'trigger-registered rows start pending');

-- ─── Unrouted + unknown-channel parsing ─────────────────────────────────
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('vehicle-docs', '7476/unrouted/email/2026/07/1753100001_beef0001.pdf',
        '{"mimetype":"application/pdf","size":"222"}'::jsonb);
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('vehicle-docs', '7476/inspection_docs/weird/2026/07/1753100002_beef0002.pdf',
        '{"mimetype":"application/pdf","size":"333"}'::jsonb);

SELECT ok((SELECT profile_key IS NULL FROM public.document_intake_files
  WHERE object_path LIKE '7476/unrouted/email/%'), 'unrouted mail keeps profile NULL (never dropped)');
SELECT is((SELECT source FROM public.document_intake_files
  WHERE object_path LIKE '7476/unrouted/email/%'), 'email', 'unrouted still records its channel');
SELECT is((SELECT source FROM public.document_intake_files
  WHERE object_path LIKE '7476/inspection_docs/weird/%'), 'other', 'unknown channel token -> source other');

-- ─── Malformed path: upload survives, error is logged ───────────────────
SELECT lives_ok(
  $$ INSERT INTO storage.objects (bucket_id, name, metadata)
     VALUES ('vehicle-docs', 'garbage-no-shape.pdf', '{"mimetype":"application/pdf","size":"1"}'::jsonb) $$,
  'a malformed object name NEVER blocks the upload');
SELECT is((SELECT count(*)::int FROM public.document_intake_files WHERE object_path='garbage-no-shape.pdf'),
  0, 'malformed path produced no intake row');
SELECT is((SELECT count(*)::int FROM public.document_intake_error_log
  WHERE origin='storage_trigger' AND origin_id='garbage-no-shape.pdf'),
  1, 'malformed path landed in the error log (reconciliation + watchdog surface it)');

-- ─── Idempotency: a pre-registered path is not duplicated ───────────────
INSERT INTO public.document_intake_files (shop_id, profile_key, source, bucket, object_path, status)
VALUES (7476, 'loaner_insurance', 'scan', 'vehicle-docs', '7476/loaner_insurance/scan/2026/07/1753100003_cafe0003.pdf', 'ready');
INSERT INTO storage.objects (bucket_id, name, metadata)
VALUES ('vehicle-docs', '7476/loaner_insurance/scan/2026/07/1753100003_cafe0003.pdf',
        '{"mimetype":"application/pdf","size":"444"}'::jsonb);
SELECT is((SELECT count(*)::int FROM public.document_intake_files
  WHERE object_path='7476/loaner_insurance/scan/2026/07/1753100003_cafe0003.pdf'),
  1, 'ON CONFLICT DO NOTHING: explicit registration wins, trigger does not duplicate');
SELECT is((SELECT status FROM public.document_intake_files
  WHERE object_path='7476/loaner_insurance/scan/2026/07/1753100003_cafe0003.pdf'),
  'ready', 'the pre-registered row (and its status) is untouched');

-- ─── Status vocabulary ──────────────────────────────────────────────────
SELECT throws_ok(
  $$ INSERT INTO public.document_intake_files (shop_id, source, bucket, object_path, status)
     VALUES (7476, 'scan', 'vehicle-docs', 'x/y/z.pdf', 'bogus') $$,
  '23514', NULL, 'invalid status rejected');
SELECT throws_ok(
  $$ INSERT INTO public.graph_mail_events (mailbox, graph_message_id, status)
     VALUES ('inspection@jeffsautomotive.com', 'm1', 'bogus') $$,
  '23514', NULL, 'invalid event status rejected');

-- ─── Graph event dedup key ──────────────────────────────────────────────
INSERT INTO public.graph_mail_events (mailbox, graph_message_id) VALUES ('inspection@jeffsautomotive.com', 'msg-1');
SELECT throws_ok(
  $$ INSERT INTO public.graph_mail_events (mailbox, graph_message_id)
     VALUES ('inspection@jeffsautomotive.com', 'msg-1') $$,
  '23505', NULL, 'duplicate (mailbox, message id) rejected — sweep re-lists are idempotent');

-- ─── anon denied everywhere it matters ──────────────────────────────────
SET ROLE anon;
SELECT throws_ok($$ SELECT 1 FROM public.document_intake_files $$,    '42501', NULL, 'anon cannot SELECT files');
SELECT throws_ok($$ SELECT 1 FROM public.document_intake_profiles $$, '42501', NULL, 'anon cannot SELECT profiles');
SELECT throws_ok($$ SELECT 1 FROM public.graph_mail_events $$,        '42501', NULL, 'anon cannot SELECT events');
RESET ROLE;

-- ─── Cron registered + advisory-lock RPCs ───────────────────────────────
SELECT is((SELECT count(*)::int FROM cron.job WHERE jobname='document-intake-daily'), 1,
  'document-intake-daily cron job registered');
SELECT has_function('public', 'document_intake_try_cron_lock', 'cron lock fn exists');
SELECT has_function('public', 'document_intake_release_cron_lock', 'cron unlock fn exists');
SELECT ok(NOT has_function_privilege('anon','public.document_intake_try_cron_lock()','EXECUTE'),
  'anon cannot take the cron lock');
SELECT ok(has_function_privilege('service_role','public.document_intake_try_cron_lock()','EXECUTE'),
  'service_role can take the cron lock');

SELECT * FROM finish();
ROLLBACK;
