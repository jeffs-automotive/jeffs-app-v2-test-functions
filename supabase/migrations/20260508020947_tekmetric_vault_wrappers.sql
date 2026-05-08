-- Tekmetric Vault wrapper functions
--
-- The Edge Functions need a way to read individual Vault secrets and to update
-- the access_token after the lazy bootstrap. We expose two SECURITY DEFINER
-- functions in the public schema, restricted to service_role only. RPC calls
-- from Edge Functions go through these wrappers; nothing touches vault.* directly.
--
-- Vault-secret naming convention used by the orchestrator:
--   tekmetric_client_id      — OAuth client_id      (added by Chris in Studio Vault UI)
--   tekmetric_client_secret  — OAuth client_secret  (added by Chris in Studio Vault UI)
--   tekmetric_shop_id        — Tekmetric shop_id    (added by Chris in Studio Vault UI)
--   tekmetric_access_token   — bearer token         (created by tekmetric-bootstrap edge function on first call)
--
-- NOT in Vault (lives in supabase/functions/_shared/tekmetric.ts as a constant):
--   Tekmetric base URL + OAuth endpoint URL — non-secret, easier to flip sandbox/production with a code change.

-- ─────────────────────────────────────────────────────────────────────────────
-- READ a single vault secret by name
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tekmetric_get_secret(p_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = p_name
  LIMIT 1
$$;

COMMENT ON FUNCTION public.tekmetric_get_secret(text) IS
  'Returns the decrypted value of a Vault secret by name. service_role only. Returns NULL if the secret does not exist.';

-- ─────────────────────────────────────────────────────────────────────────────
-- WRITE/UPSERT a vault secret by name (used to store access_token after bootstrap)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tekmetric_set_secret(
  p_name        text,
  p_value       text,
  p_description text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_name IS NULL OR length(p_name) = 0 THEN
    RAISE EXCEPTION 'tekmetric_set_secret: p_name is required';
  END IF;
  IF p_value IS NULL OR length(p_value) = 0 THEN
    RAISE EXCEPTION 'tekmetric_set_secret: p_value is required';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name LIMIT 1;

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name, p_description);
  ELSE
    PERFORM vault.update_secret(
      v_id,
      p_value,
      p_name,
      COALESCE(p_description, (SELECT description FROM vault.secrets WHERE id = v_id))
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION public.tekmetric_set_secret(text, text, text) IS
  'Creates or updates a Vault secret by name. service_role only. Used by the tekmetric-bootstrap edge function to persist the access_token after the first OAuth call.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions: service_role only (Edge Functions use service_role key)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.tekmetric_get_secret(text)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tekmetric_get_secret(text)              FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tekmetric_set_secret(text, text, text)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tekmetric_set_secret(text, text, text)  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.tekmetric_get_secret(text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.tekmetric_set_secret(text, text, text)  TO service_role;
