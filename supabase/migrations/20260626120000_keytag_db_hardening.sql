-- =====================================================================
-- Keytag DB hardening — two deferred audit items (L3 + M4)
-- =====================================================================
-- Created 2026-06-26. Defense-in-depth for the keytag subsystem. Neither
-- item changes any application behavior today; both close latent footguns
-- the security/audit review flagged.
--
--   L3 — Revoke the latent anon/authenticated DML grants on the 7 keytag
--        tables. They are RLS-enabled with ZERO policies (service-role-only
--        by design: service_role bypasses RLS; anon/authenticated are
--        already fully blocked). But the default Supabase table GRANTs to
--        anon/authenticated still EXIST — harmless while RLS is on, but a
--        live hole the instant RLS is ever disabled OR a permissive policy
--        is added. Revoking them is pure defense-in-depth: every edge
--        function and admin-app path that touches these tables uses the
--        SERVICE-ROLE client (which is unaffected by these REVOKEs), so
--        there is no functional change.
--
--   M4 — DEFERRED to a follow-up (NOT in this migration). A partial UNIQUE
--        index on (category, context->>'ro_id') WHERE resolved_at IS NULL would
--        turn the app's best-effort SELECT-then-INSERT dedup into a hard DB
--        guarantee — BUT create_manual_review() does not yet catch a
--        unique-violation, so a (rare) webhook+cron race would THROW instead of
--        degrading to a quiet no-op. The index must ship TOGETHER with ON
--        CONFLICT / catch handling in the issuance RPC, not before. There are 0
--        duplicate groups and 0 open reviews today, so there is no urgency.
-- =====================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- L3 — Revoke anon/authenticated DML on the 7 keytag tables.
--
-- Current state (verified 2026-06-26 via information_schema.role_table_grants):
-- all 7 tables grant the full default set
--   { SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER }
-- to BOTH anon AND authenticated (the standard Supabase
-- `GRANT ALL ... TO anon, authenticated` default), and the identical set to
-- service_role. RLS is enabled on every table with zero policies, so
-- anon/authenticated are currently blocked at the RLS layer regardless of
-- these grants — the grants are latent, not live. service_role bypasses RLS
-- and must keep its grants, so we ONLY revoke from anon + authenticated.
--
-- REVOKE ALL is idempotent (no error if a privilege is already absent), so
-- this migration is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON public.keytags                       FROM anon, authenticated;
REVOKE ALL ON public.keytag_audit_log              FROM anon, authenticated;
REVOKE ALL ON public.keytag_confirmation_tokens    FROM anon, authenticated;
REVOKE ALL ON public.keytag_cursor                 FROM anon, authenticated;
REVOKE ALL ON public.keytag_manual_review_attempts FROM anon, authenticated;
REVOKE ALL ON public.keytag_manual_reviews         FROM anon, authenticated;
REVOKE ALL ON public.keytag_webhook_events         FROM anon, authenticated;


-- M4 (the partial UNIQUE index on (category, context->>'ro_id') WHERE
-- resolved_at IS NULL) is intentionally NOT in this migration — see the header
-- note. It ships in a follow-up together with ON CONFLICT / unique-violation
-- handling in the create_manual_review issuance path, so a concurrent race
-- degrades to a no-op instead of throwing.
