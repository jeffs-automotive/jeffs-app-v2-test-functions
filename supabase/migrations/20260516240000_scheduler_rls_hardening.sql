-- Scheduler RLS + CHECK hardening
-- Date: 2026-05-16
--
-- Two small consistency fixes from the R6 audit Stream C + Stream E
-- IMPORTANT findings:
--
-- 1. scheduler_error_log uses "RLS-enabled-no-policy" denial (anon +
--    authenticated implicit-deny because no policy matches). Every
--    OTHER scheduler table uses an explicit `deny_all` policy. Pin
--    the policy explicitly here too — grep-ability matters for
--    auditors + the existing scheduler_phase1_schema.test.sql pattern
--    expects "deny_all" to show up in pg_policies.
--
-- 2. testing_services.concern_categories had a 'warning-light'
--    literal bug fixed by a one-shot UPDATE in migration
--    20260513200000:51-58. Nothing prevents a future
--    upsert_testing_service MCP call (scheduler-tools.ts:1042) from
--    re-introducing the hyphenated form. Add a CHECK constraint that
--    rejects 'warning-light' at insert/update time.
--
-- Idempotent re-apply: IF NOT EXISTS / ALTER TABLE … ADD CONSTRAINT
-- IF NOT EXISTS guard each step.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Explicit deny_all on scheduler_error_log
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'scheduler_error_log'
       AND policyname = 'deny_all'
  ) THEN
    CREATE POLICY "deny_all" ON public.scheduler_error_log
      FOR ALL TO public USING (false);
  END IF;
END $$;

COMMENT ON POLICY "deny_all" ON public.scheduler_error_log IS
  'Explicit deny for anon + authenticated. service_role bypasses RLS.
  Matches the pattern every other scheduler table uses so audit greps
  for "deny_all" surface every protected table uniformly.';


-- ---------------------------------------------------------------------
-- 2. CHECK constraint blocking 'warning-light' literal in
--    testing_services.concern_categories
-- ---------------------------------------------------------------------
-- The canonical key is 'warning_light' (underscore). The hyphenated
-- form was a one-time data import bug; the constraint prevents
-- recurrence via future admin tools.

ALTER TABLE public.testing_services
  DROP CONSTRAINT IF EXISTS testing_services_concern_categories_no_hyphen;

ALTER TABLE public.testing_services
  ADD CONSTRAINT testing_services_concern_categories_no_hyphen
    CHECK (
      concern_categories IS NULL
      OR NOT ('warning-light' = ANY (concern_categories))
    );

COMMENT ON CONSTRAINT testing_services_concern_categories_no_hyphen
  ON public.testing_services IS
  $$Prevents reintroducing the hyphenated "warning-light" literal in
  concern_categories. Canonical key is "warning_light". One-time data
  fix shipped in migration 20260513200000; this constraint guards
  future admin-tool inserts/updates from drift.$$;


COMMIT;
