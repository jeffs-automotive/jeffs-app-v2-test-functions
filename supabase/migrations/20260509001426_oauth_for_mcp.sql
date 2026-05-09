-- OAuth 2.1 + PKCE state for the MCP Custom Connector flow.
--
-- Flow (per MCP spec 2025-11-25):
--   Claude Desktop hits orchestrator-mcp without a token → 401 +
--   WWW-Authenticate header pointing at /.well-known/oauth-protected-resource →
--   discovery → /register (DCR) → /authorize (consent + PKCE) → /token →
--   Bearer access_token in subsequent MCP calls.
--
-- These tables back the mcp-auth edge function. Token VALUES are never stored;
-- only sha256 hashes go into the database (matches OAuth provider best practice).
--
-- Phase 1 scope:
--   - Dynamic Client Registration enabled (no pre-shared client credentials needed)
--   - Authorization codes single-use, 10 min TTL
--   - Access tokens 24h TTL — when expired, user re-authorizes (no refresh tokens yet)
--   - user_label captured at consent time; populates chat_sessions.user_label
--     when the orchestrator runs

-- ─────────────────────────────────────────────────────────────────────────────
-- oauth_clients — registered clients (each Claude install registers via DCR)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.oauth_clients (
  id                              text          PRIMARY KEY,                   -- random url-safe string
  client_secret_hash              text,                                        -- sha256(secret); NULL for public PKCE-only clients
  client_name                     text          NOT NULL DEFAULT 'unknown',    -- from DCR client_name field
  redirect_uris                   text[]        NOT NULL,
  grant_types                     text[]        NOT NULL DEFAULT ARRAY['authorization_code'],
  response_types                  text[]        NOT NULL DEFAULT ARRAY['code'],
  scope                           text          NOT NULL DEFAULT 'mcp',
  token_endpoint_auth_method      text          NOT NULL DEFAULT 'client_secret_post',
  -- DCR (RFC 7592) management
  registration_access_token_hash  text,                                        -- sha256 of the client-management token
  dynamically_registered          boolean       NOT NULL DEFAULT true,
  active                          boolean       NOT NULL DEFAULT true,
  created_at                      timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX oauth_clients_active_idx ON public.oauth_clients (active);

ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- oauth_authorization_codes — short-lived, single-use codes from /authorize
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.oauth_authorization_codes (
  code_hash               text          PRIMARY KEY,                  -- sha256(code)
  client_id               text          NOT NULL REFERENCES public.oauth_clients(id) ON DELETE RESTRICT,
  redirect_uri            text          NOT NULL,                     -- must match the one used on /token
  code_challenge          text          NOT NULL,                     -- PKCE
  code_challenge_method   text          NOT NULL CHECK (code_challenge_method IN ('S256', 'plain')),
  scope                   text          NOT NULL,
  user_label              text          NOT NULL,                     -- collected on consent page; flows into chat_sessions
  resource                text,                                        -- RFC 8707 resource indicator (the MCP server URL)
  expires_at              timestamptz   NOT NULL,
  used_at                 timestamptz,                                  -- set on first /token use; reject if not null
  created_at              timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX oauth_codes_client_idx  ON public.oauth_authorization_codes (client_id);
CREATE INDEX oauth_codes_expires_idx ON public.oauth_authorization_codes (expires_at);

ALTER TABLE public.oauth_authorization_codes ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- oauth_access_tokens — issued tokens; we look these up on every MCP call
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.oauth_access_tokens (
  token_hash      text          PRIMARY KEY,                          -- sha256(token)
  client_id       text          NOT NULL REFERENCES public.oauth_clients(id) ON DELETE RESTRICT,
  user_label      text          NOT NULL,
  scope           text          NOT NULL,
  resource        text,                                                -- per RFC 8707
  issued_at       timestamptz   NOT NULL DEFAULT now(),
  expires_at      timestamptz   NOT NULL,
  revoked_at      timestamptz,
  last_used_at    timestamptz
);

CREATE INDEX oauth_tokens_client_idx  ON public.oauth_access_tokens (client_id);
CREATE INDEX oauth_tokens_user_idx    ON public.oauth_access_tokens (user_label);
CREATE INDEX oauth_tokens_expires_idx ON public.oauth_access_tokens (expires_at);

ALTER TABLE public.oauth_access_tokens ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper RPC: validate a bearer token + bump last_used_at atomically.
-- Used by orchestrator-mcp on every request to authenticate the caller.
--
-- Returns the user_label + scope + client_id on success; NULL row on failure.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.oauth_validate_access_token(p_token_hash text)
RETURNS TABLE (
  user_label text,
  scope      text,
  client_id  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.oauth_access_tokens t
  SET last_used_at = now()
  WHERE t.token_hash  = p_token_hash
    AND t.revoked_at IS NULL
    AND t.expires_at  > now()
  RETURNING t.user_label, t.scope, t.client_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.oauth_validate_access_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.oauth_validate_access_token(text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.oauth_validate_access_token(text) TO service_role;

COMMENT ON FUNCTION public.oauth_validate_access_token(text) IS
  'Validates an MCP OAuth bearer token by sha256 hash, bumps last_used_at, returns user/scope/client. service_role only.';
