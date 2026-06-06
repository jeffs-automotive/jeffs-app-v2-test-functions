-- =====================================================================
-- QTekLink C1 hardening — enforce 1:1 shop <-> QBO connection
-- =====================================================================
-- 2026-06-05. Pattern review: qbo_resolve_realm_for_shop does `WHERE shop_id =
-- p_shop_id LIMIT 1`, which is only deterministic if a shop has at most one
-- connection. UNIQUE(shop_id, realm_id) (the FK target) does NOT guarantee that.
-- This DB-enforces the documented 1:1 invariant so the "realm bound to the shop"
-- is unambiguous. UNIQUE on a NULLABLE column permits multiple NULLs, so the
-- legacy/pre-onboarding null-shop rows are unaffected; a real shop gets at most
-- one connection. Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qbo_connections_shop_id_key') THEN
    ALTER TABLE public.qbo_connections
      ADD CONSTRAINT qbo_connections_shop_id_key UNIQUE (shop_id);
  END IF;
END $$;

COMMENT ON CONSTRAINT qbo_connections_shop_id_key ON public.qbo_connections IS
  '1:1 shop <-> connection: a shop has at most one QBO company. Makes qbo_resolve_realm_for_shop deterministic. NULL shop_id (pre-onboarding) is exempt (multiple NULLs allowed).';

COMMIT;
