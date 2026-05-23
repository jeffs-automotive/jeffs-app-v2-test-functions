-- =====================================================================
-- Plan 01 Phase 1D — REVOKE anon + authenticated EXECUTE on 17 more
-- SECURITY DEFINER functions + drop _smoke_fire2 scratch function
-- =====================================================================
-- 2026-05-22. Audit-driven security advisor (post-Phase-1B re-run, after
-- the 2 RLS_DISABLED tables were dropped) surfaced 17 SECURITY DEFINER
-- functions still executable by the `anon` and `authenticated` roles.
-- The original 2026-05-13 revoke migration (`20260513130000_*`) only
-- covered 3 specific functions; the rest of the keytag + manual-review
-- function set was missed.
--
-- Each function below is service-role-only by design — called exclusively
-- from edge functions (using the service-role bearer) or from cron jobs
-- (running as `postgres`). None are invoked by the customer-facing wizard.
-- REVOKE'ing anon + authenticated EXECUTE closes the PostgREST
-- `/rest/v1/rpc/<fn>` attack surface (anon publishable key was sufficient
-- to invoke them).
--
-- Pattern follows `20260513130000_scheduler_phase1_revoke_anon_security_definer.sql`:
-- DO-block with dynamic SQL so every overload of each function is covered
-- without having to enumerate by signature.
--
-- IDEMPOTENT: REVOKE/GRANT are no-ops if already in the desired state.
--
-- Also drops `public._smoke_fire2(p_test_id, p_tool, p_bucket, p_desc, p_intent)`
-- — paired scratch function for the dropped `_smoke_test_run` table.
-- Flagged as `function_search_path_mutable` by the advisor.

BEGIN;

-- ─── Drop scratch function ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._smoke_fire2(TEXT, TEXT, TEXT, TEXT, TEXT);

-- ─── REVOKE anon + authenticated EXECUTE on 17 service-role-only fns ───
DO $$
DECLARE
  fn_oid OID;
  fn_name TEXT;
  fn_names TEXT[] := ARRAY[
    -- Keytag system (assign/release/revert/log/mark/touch)
    'assign_next_keytag',
    'force_assign_keytag',
    'release_keytag_for_ro',
    'release_keytag_as_orphan',
    'revert_keytag_to_assigned',
    'mark_keytag_posted',
    'touch_keytag_activity',
    'log_keytag_audit',
    'record_keytag_patched',
    -- Keytag confirmation tokens (Pattern A)
    'create_keytag_confirmation_token',
    'consume_keytag_confirmation_token',
    -- Keytag A/R lockdown trigger
    'enforce_keytag_ar_lockdown',
    -- Manual-review (Pattern B)
    'create_manual_review',
    'generate_manual_review_code',
    'lookup_manual_review',
    'resolve_manual_review',
    'check_manual_review_lockout',
    'attach_resolution_audit_log',
    'mark_manual_review_email_sent',
    -- Cron admin
    'cron_unschedule_if_exists'
  ];
BEGIN
  FOREACH fn_name IN ARRAY fn_names LOOP
    FOR fn_oid IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = fn_name
    LOOP
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated;',
        fn_oid::regprocedure
      );
      -- cron_unschedule_if_exists is called from migrations as postgres,
      -- so it needs postgres GRANT in addition to service_role.
      IF fn_name = 'cron_unschedule_if_exists' THEN
        EXECUTE format(
          'GRANT EXECUTE ON FUNCTION %s TO postgres, service_role;',
          fn_oid::regprocedure
        );
      ELSE
        EXECUTE format(
          'GRANT EXECUTE ON FUNCTION %s TO service_role;',
          fn_oid::regprocedure
        );
      END IF;
      RAISE NOTICE 'Revoked anon/authenticated EXECUTE on %', fn_oid::regprocedure;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
