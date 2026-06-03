-- =====================================================================
-- qbo-api-client C3 — qbo_connections + Vault-backed token RPCs
-- =====================================================================
-- 2026-06-02. Stores the QBO OAuth connection so the admin-app client can
-- autonomously refresh (attestation #1). Secrets-at-rest = Supabase Vault
-- (the app standard — mirrors 20260508020947_tekmetric_vault_wrappers.sql),
-- NOT pgcrypto columns. The access + refresh tokens live in Vault, keyed by
-- name per realm; this table holds only the non-secret metadata (expiries,
-- environment). Two SECURITY DEFINER RPCs (service_role-only) are the ONLY
-- path to the secrets — nothing touches vault.* directly from app code.
--
-- See docs/qbo/qbo-api-client-plan.md §Token lifecycle. Apply: supabase db push.
-- IDEMPOTENT: CREATE TABLE/REPLACE FUNCTION; upsert RPC.
-- =====================================================================

BEGIN;

-- ─── Connection metadata (NON-secret; tokens live in Vault) ─────────────
-- NOT shop-scoped: keyed by the QBO realm_id (the connected company).
CREATE TABLE IF NOT EXISTS public.qbo_connections (
  realm_id                 text PRIMARY KEY,
  environment              text NOT NULL DEFAULT 'production'
                             CHECK (environment IN ('production', 'sandbox')),
  access_token_expires_at  timestamptz NOT NULL,
  refresh_token_expires_at timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- service_role only — tokens must never reach the browser. RLS enabled with
-- NO policy = deny anon + authenticated (defense in depth; only the
-- service-role RPCs below read/write this).
ALTER TABLE public.qbo_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qbo_connections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_connections TO service_role;

-- ─── Read + decrypt the connection (tokens pulled from Vault by name) ────
-- p_realm_id NULL → the most-recently-updated connection (single-company
-- default). Empty result set when not connected (caller maps to
-- reconnect_required).
CREATE OR REPLACE FUNCTION public.qbo_get_connection(p_realm_id text DEFAULT NULL)
RETURNS TABLE (
  realm_id                 text,
  environment              text,
  access_token             text,
  refresh_token            text,
  access_token_expires_at  timestamptz,
  refresh_token_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_realm_id    text;
  v_env         text;
  v_access_exp  timestamptz;
  v_refresh_exp timestamptz;
BEGIN
  IF p_realm_id IS NULL THEN
    SELECT c.realm_id, c.environment, c.access_token_expires_at, c.refresh_token_expires_at
      INTO v_realm_id, v_env, v_access_exp, v_refresh_exp
      FROM public.qbo_connections c
      ORDER BY c.updated_at DESC
      LIMIT 1;
  ELSE
    SELECT c.realm_id, c.environment, c.access_token_expires_at, c.refresh_token_expires_at
      INTO v_realm_id, v_env, v_access_exp, v_refresh_exp
      FROM public.qbo_connections c
      WHERE c.realm_id = p_realm_id;
  END IF;

  IF v_realm_id IS NULL THEN
    RETURN; -- not connected
  END IF;

  realm_id := v_realm_id;
  environment := v_env;
  access_token := (
    SELECT decrypted_secret FROM vault.decrypted_secrets
    WHERE name = 'qbo_access_token:' || v_realm_id LIMIT 1
  );
  refresh_token := (
    SELECT decrypted_secret FROM vault.decrypted_secrets
    WHERE name = 'qbo_refresh_token:' || v_realm_id LIMIT 1
  );
  access_token_expires_at := v_access_exp;
  refresh_token_expires_at := v_refresh_exp;
  RETURN NEXT;
END;
$$;

-- ─── Upsert tokens (Vault secrets) + expiries (row); single-flight ──────
-- Handles BOTH the initial seed (from the qbo-oauth-callback handshake) and
-- refresh rotation. FOR UPDATE on the existing row serializes concurrent
-- refreshes (write-side); a rotated refresh token's predecessor stays valid
-- ~24h, so last-write-wins never locks anyone out.
CREATE OR REPLACE FUNCTION public.qbo_persist_tokens(
  p_realm_id                 text,
  p_access_token             text,
  p_refresh_token            text,
  p_access_token_expires_at  timestamptz,
  p_refresh_token_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_access_name  text := 'qbo_access_token:' || p_realm_id;
  v_refresh_name text := 'qbo_refresh_token:' || p_realm_id;
  v_id uuid;
BEGIN
  IF p_realm_id IS NULL OR length(p_realm_id) = 0 THEN
    RAISE EXCEPTION 'qbo_persist_tokens: p_realm_id is required';
  END IF;
  IF p_access_token IS NULL OR p_refresh_token IS NULL THEN
    RAISE EXCEPTION 'qbo_persist_tokens: access + refresh tokens are required';
  END IF;

  -- Serialize concurrent refreshes on the existing row.
  PERFORM 1 FROM public.qbo_connections WHERE realm_id = p_realm_id FOR UPDATE;

  -- Upsert the access-token Vault secret.
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_access_name LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_access_token, v_access_name, 'QBO access token for realm ' || p_realm_id);
  ELSE
    PERFORM vault.update_secret(v_id, p_access_token, v_access_name, 'QBO access token for realm ' || p_realm_id);
  END IF;

  -- Upsert the refresh-token Vault secret.
  v_id := NULL;
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_refresh_name LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_refresh_token, v_refresh_name, 'QBO refresh token for realm ' || p_realm_id);
  ELSE
    PERFORM vault.update_secret(v_id, p_refresh_token, v_refresh_name, 'QBO refresh token for realm ' || p_realm_id);
  END IF;

  -- Upsert the connection row (expiries + updated_at).
  INSERT INTO public.qbo_connections (realm_id, access_token_expires_at, refresh_token_expires_at, updated_at)
  VALUES (p_realm_id, p_access_token_expires_at, p_refresh_token_expires_at, now())
  ON CONFLICT (realm_id) DO UPDATE
    SET access_token_expires_at = EXCLUDED.access_token_expires_at,
        refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
        updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qbo_get_connection(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.qbo_persist_tokens(text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_get_connection(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.qbo_persist_tokens(text, text, text, timestamptz, timestamptz) TO service_role;

COMMENT ON TABLE public.qbo_connections IS
  'QBO OAuth connection metadata (per realm). Tokens are in Vault (qbo_access_token:<realm> / qbo_refresh_token:<realm>); access only via qbo_get_connection / qbo_persist_tokens (service_role).';

COMMIT;
