-- =====================================================================
-- QTekLink — qbo_disconnect (soft disconnect: neutralize tokens, keep config)
-- =====================================================================
-- 2026-06-07. The /qbo/disconnected flow + the dashboard Disconnect button need a
-- way to tear down a QBO grant WITHOUT destroying the realm binding / COA mirror /
-- mappings (the FK chain qteklink_mappings -> qbo_accounts -> qbo_connections is
-- ON DELETE RESTRICT, and rebuilding the mapping config is expensive). So this is a
-- SOFT disconnect: the connection row stays, but the Vault token secrets are
-- neutralized and the expiries are pushed to the past, so the client treats the
-- connection as reconnect-required. Reconnecting the same company re-seeds the
-- tokens via qbo_persist_tokens and everything resumes.
--
-- Token removal mirrors the project's Vault convention (20260602140000 /
-- 20260508020947 use vault.create_secret / vault.update_secret + SELECT from
-- vault.secrets; there is no delete wrapper). We OVERWRITE the secrets with a
-- tombstone via vault.update_secret rather than DELETE the rows — neutralizes the
-- local copy even if the Intuit-side revoke (best-effort, in the DAL) failed.
-- Apply: supabase db push. IDEMPOTENT.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.qbo_disconnect(p_realm_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_access_name  text := 'qbo_access_token:' || p_realm_id;
  v_refresh_name text := 'qbo_refresh_token:' || p_realm_id;
  v_id    uuid;
  v_count integer;
BEGIN
  IF p_realm_id IS NULL OR length(p_realm_id) = 0 THEN
    RAISE EXCEPTION 'qbo_disconnect: p_realm_id is required';
  END IF;

  -- Neutralize the Vault token secrets (tombstone). The local tokens become
  -- unusable even if the Intuit-side revoke failed; reconnect overwrites them.
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_access_name LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, '__disconnected__', v_access_name, 'QBO access token (disconnected)');
  END IF;
  v_id := NULL;
  SELECT id INTO v_id FROM vault.secrets WHERE name = v_refresh_name LIMIT 1;
  IF v_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_id, '__disconnected__', v_refresh_name, 'QBO refresh token (disconnected)');
  END IF;

  -- Expire the connection so qbo_get_connection -> the client treats it as
  -- reconnect-required (the binding row + COA + mappings stay intact).
  UPDATE public.qbo_connections
     SET access_token_expires_at  = 'epoch',
         refresh_token_expires_at = 'epoch',
         updated_at = now()
   WHERE realm_id = p_realm_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN v_count > 0;  -- true if a connection row existed for the realm
END;
$$;

REVOKE EXECUTE ON FUNCTION public.qbo_disconnect(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_disconnect(text) TO service_role;
COMMENT ON FUNCTION public.qbo_disconnect(text) IS
  'QTekLink SOFT disconnect for one realm: tombstone the Vault token secrets + expire the qbo_connections row (keeps the realm binding + COA + mappings; reconnect re-seeds). service_role only.';

COMMIT;
