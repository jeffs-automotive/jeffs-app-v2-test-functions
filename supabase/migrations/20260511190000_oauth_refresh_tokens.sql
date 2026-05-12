-- =====================================================================
-- OAuth 2.1 refresh tokens — silent renewal so advisors don't re-consent
-- =====================================================================
-- Created 2026-05-11. Phase 1 used 24h access tokens with no refresh
-- (locked-in choice from 20260509001426_oauth_for_mcp.sql line 15-16).
-- The friction of re-consent every 24h was unacceptable.
--
-- This migration adds the refresh-token half of OAuth 2.1 §6.1:
--   - Issue refresh_token alongside access_token on authorization_code grant
--   - Accept grant_type=refresh_token at /token
--   - ROTATE refresh tokens on every use (per OAuth 2.1 best practice):
--     issue a new refresh + new access; mark the old refresh revoked.
--   - Long TTL on refresh (90 days) so advisors only re-consent quarterly.
--
-- After this lands, the advisor's consent-page experience is:
--   First time:  type identifier → approve → tokens issued
--   Every subsequent call until 90d:  silent refresh (no UI)
--   At 90d:      consent page once more
--
-- Reuse detection (revoke-the-chain on stolen-token replay) is documented
-- as a Phase 2 hardening; the current implementation simply revokes the
-- presented token on rotation and trusts that legitimate refreshes are
-- single-threaded per client.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.oauth_refresh_tokens (
  token_hash      text          PRIMARY KEY,                                       -- sha256(token)
  client_id       text          NOT NULL REFERENCES public.oauth_clients(id) ON DELETE RESTRICT,
  user_label      text          NOT NULL,
  scope           text          NOT NULL,
  resource        text,                                                            -- RFC 8707
  -- Rotation chain: each refresh issues a new token; the new row points
  -- back at the prior row's hash. Used by future reuse-detection logic
  -- to revoke the whole chain if an old refresh token is replayed.
  parent_token_hash text        REFERENCES public.oauth_refresh_tokens(token_hash) ON DELETE SET NULL,
  issued_at       timestamptz   NOT NULL DEFAULT now(),
  expires_at      timestamptz   NOT NULL,
  revoked_at      timestamptz,                                                      -- set on rotation OR explicit revoke
  last_used_at    timestamptz
);

CREATE INDEX oauth_refresh_tokens_client_idx     ON public.oauth_refresh_tokens (client_id);
CREATE INDEX oauth_refresh_tokens_user_label_idx ON public.oauth_refresh_tokens (user_label);
CREATE INDEX oauth_refresh_tokens_expires_idx    ON public.oauth_refresh_tokens (expires_at);
CREATE INDEX oauth_refresh_tokens_active_idx
  ON public.oauth_refresh_tokens (token_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE public.oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.oauth_refresh_tokens IS
  'OAuth 2.1 refresh tokens. Rotated on every use (per spec §6.1). Stored as sha256 hash. 90-day TTL — advisor re-consents quarterly.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper RPC: atomically validate + revoke a refresh token, returning the
-- bound identity. Used by mcp-auth's refresh_token grant handler.
--
-- Returns the user_label / scope / client_id / resource of the validated
-- token on success; empty row on miss/expired/revoked/etc.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.oauth_consume_refresh_token(p_token_hash text)
RETURNS TABLE (
  user_label  text,
  scope       text,
  client_id   text,
  resource    text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.oauth_refresh_tokens t
  SET revoked_at  = now(),
      last_used_at = now()
  WHERE t.token_hash  = p_token_hash
    AND t.revoked_at  IS NULL
    AND t.expires_at  > now()
  RETURNING t.user_label, t.scope, t.client_id, t.resource;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.oauth_consume_refresh_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.oauth_consume_refresh_token(text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.oauth_consume_refresh_token(text) TO service_role;

COMMENT ON FUNCTION public.oauth_consume_refresh_token(text) IS
  'Atomically validates a refresh token (active + not expired) AND marks it revoked. Returns the bound identity for issuing the rotation pair. Single-use per OAuth 2.1 §6.1.';
