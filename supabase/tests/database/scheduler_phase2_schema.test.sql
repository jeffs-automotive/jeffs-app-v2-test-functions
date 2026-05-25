-- =====================================================================
-- pgTAP tests for scheduler-app — tables added AFTER initial Phase 1
-- =====================================================================
-- Extends scheduler_phase1_schema.test.sql which only covered the 13
-- tables from migration 20260510131752. Seven tables were added in
-- later migrations; this file gives them structural + RLS coverage so
-- a future schema regression on any of them is caught by `supabase test
-- db`.
--
-- Tables covered:
--   - scheduler_audit_log              (20260513000100)
--   - scheduler_admin_audit_log        (20260513000100)
--   - concern_questions                (20260513000100)
--   - appointment_default_limits       (20260513000100)
--   - concern_category_guidelines      (20260514000000)
--   - concern_subcategories            (20260514100000)
--   - scheduler_error_log              (20260516180000)
--
-- Created 2026-05-16 per R6 Stream E IMPORTANT #3.
-- Run with: supabase test db
-- =====================================================================

BEGIN;
SELECT * FROM no_plan();


-- ---------------------------------------------------------------------
-- 1. Tables exist
-- ---------------------------------------------------------------------

SELECT has_table('public', 'scheduler_audit_log',          'scheduler_audit_log table exists');
SELECT has_table('public', 'scheduler_admin_audit_log',    'scheduler_admin_audit_log table exists');
SELECT has_table('public', 'concern_questions',            'concern_questions table exists');
SELECT has_table('public', 'concern_subcategories',        'concern_subcategories table exists');
SELECT has_table('public', 'concern_category_guidelines',  'concern_category_guidelines table exists');
SELECT has_table('public', 'appointment_default_limits',   'appointment_default_limits table exists');
SELECT has_table('public', 'scheduler_error_log',          'scheduler_error_log table exists');


-- ---------------------------------------------------------------------
-- 2. Critical columns exist with the right types
-- ---------------------------------------------------------------------

-- scheduler_audit_log — session-scoped append-only log
SELECT col_type_is(
  'public', 'scheduler_audit_log', 'session_id', 'uuid',
  'scheduler_audit_log.session_id is uuid'
);
SELECT col_type_is(
  'public', 'scheduler_audit_log', 'event_type', 'text',
  'scheduler_audit_log.event_type is text'
);
SELECT col_type_is(
  'public', 'scheduler_audit_log', 'event_detail', 'jsonb',
  'scheduler_audit_log.event_detail is jsonb'
);

-- scheduler_admin_audit_log — admin actions (different surface from
-- scheduler_audit_log). Migration 20260513000100 defines this table
-- with table_name / operation / diff_summary / rows_added /
-- rows_modified / rows_deactivated — NOT event_type / event_detail.
-- The prior assertions here were copy-pasted from the
-- scheduler_audit_log block above and the table name wasn't updated;
-- replaced with assertions for columns that ACTUALLY exist on this
-- table so we still get type-drift coverage.
SELECT col_type_is(
  'public', 'scheduler_admin_audit_log', 'operation', 'text',
  'scheduler_admin_audit_log.operation is text'
);
SELECT col_type_is(
  'public', 'scheduler_admin_audit_log', 'diff_summary', 'jsonb',
  'scheduler_admin_audit_log.diff_summary is jsonb'
);
SELECT col_type_is(
  'public', 'scheduler_admin_audit_log', 'table_name', 'text',
  'scheduler_admin_audit_log.table_name is text'
);

-- concern_questions — the diagnostic Q catalog
SELECT col_type_is(
  'public', 'concern_questions', 'category', 'text',
  'concern_questions.category is text'
);
SELECT col_type_is(
  'public', 'concern_questions', 'question_text', 'text',
  'concern_questions.question_text is text'
);
SELECT col_type_is(
  'public', 'concern_questions', 'options', 'jsonb',
  'concern_questions.options is jsonb'
);
SELECT col_not_null(
  'public', 'concern_questions', 'subcategory_id',
  'concern_questions.subcategory_id is NOT NULL (post-backfill DDL lock)'
);
SELECT col_type_is(
  'public', 'concern_questions', 'active', 'boolean',
  'concern_questions.active is boolean'
);

-- concern_subcategories — symptom buckets per category
SELECT col_type_is(
  'public', 'concern_subcategories', 'category', 'text',
  'concern_subcategories.category is text'
);
SELECT col_type_is(
  'public', 'concern_subcategories', 'slug', 'text',
  'concern_subcategories.slug is text'
);
SELECT col_type_is(
  'public', 'concern_subcategories', 'display_label', 'text',
  'concern_subcategories.display_label is text'
);

-- concern_category_guidelines — service-advisor prose per category
SELECT col_type_is(
  'public', 'concern_category_guidelines', 'category', 'text',
  'concern_category_guidelines.category is text'
);
SELECT col_type_is(
  'public', 'concern_category_guidelines', 'guideline_prose', 'text',
  'concern_category_guidelines.guideline_prose is text'
);
SELECT col_type_is(
  'public', 'concern_category_guidelines', 'display_label', 'text',
  'concern_category_guidelines.display_label is text'
);

-- appointment_default_limits — DB-driven capacity per day-of-week
SELECT col_type_is(
  'public', 'appointment_default_limits', 'day_of_week', 'integer',
  'appointment_default_limits.day_of_week is integer'
);
SELECT col_type_is(
  'public', 'appointment_default_limits', 'waiter_8am_slots', 'integer',
  'appointment_default_limits.waiter_8am_slots is integer'
);
SELECT col_type_is(
  'public', 'appointment_default_limits', 'waiter_9am_slots', 'integer',
  'appointment_default_limits.waiter_9am_slots is integer'
);

-- scheduler_error_log — Vercel + Edge fn triage table (R4 addition)
SELECT col_type_is(
  'public', 'scheduler_error_log', 'origin', 'text',
  'scheduler_error_log.origin is text'
);
SELECT col_type_is(
  'public', 'scheduler_error_log', 'surface', 'text',
  'scheduler_error_log.surface is text'
);
SELECT col_type_is(
  'public', 'scheduler_error_log', 'level', 'text',
  'scheduler_error_log.level is text'
);
SELECT col_type_is(
  'public', 'scheduler_error_log', 'message', 'text',
  'scheduler_error_log.message is text'
);
SELECT col_type_is(
  'public', 'scheduler_error_log', 'context', 'jsonb',
  'scheduler_error_log.context is jsonb'
);


-- ---------------------------------------------------------------------
-- 3. RLS enabled (deny-all expected for every scheduler table per
--    pattern-compliance.md). Negative-RLS coverage is in
--    scheduler_rls_negative.test.sql.
-- ---------------------------------------------------------------------

SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'scheduler_audit_log' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'scheduler_audit_log has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'scheduler_admin_audit_log' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'scheduler_admin_audit_log has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'concern_questions' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'concern_questions has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'concern_subcategories' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'concern_subcategories has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'concern_category_guidelines' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'concern_category_guidelines has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'appointment_default_limits' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'appointment_default_limits has RLS enabled'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'scheduler_error_log' AND relnamespace = 'public'::regnamespace),
  TRUE,
  'scheduler_error_log has RLS enabled'
);


-- ---------------------------------------------------------------------
-- 4. FK relationships — concern_questions.subcategory_id → concern_subcategories(id)
-- ---------------------------------------------------------------------

SELECT col_is_fk(
  'public', 'concern_questions', 'subcategory_id',
  'concern_questions.subcategory_id has FK constraint'
);


-- ---------------------------------------------------------------------
-- 5. CHECK constraints — origin + level enums on scheduler_error_log
-- ---------------------------------------------------------------------
-- Verifies the enum-shaped CHECK constraints survive future migration
-- churn. Tests by attempting an invalid INSERT (as the BYPASSRLS test
-- role) and expecting a constraint violation.

SELECT throws_ok(
  $$ INSERT INTO public.scheduler_error_log (origin, surface, level, message)
     VALUES ('invalid-origin', 'pgtap-test', 'error', 'should reject') $$,
  '23514',
  NULL,
  'scheduler_error_log rejects invalid origin (CHECK violation 23514)'
);

SELECT throws_ok(
  $$ INSERT INTO public.scheduler_error_log (origin, surface, level, message)
     VALUES ('cron', 'pgtap-test', 'invalid-level', 'should reject') $$,
  '23514',
  NULL,
  'scheduler_error_log rejects invalid level (CHECK violation 23514)'
);


SELECT * FROM finish();
ROLLBACK;
