-- =====================================================================
-- PLAN-03 Phase 4 — RFC 8707 + MCP spec 2025-11-25 audience validation
-- =====================================================================
-- The `resource` columns on oauth_authorization_codes, oauth_access_tokens,
-- and oauth_refresh_tokens already exist (migrations 20260509001426 +
-- 20260511190000). Application code already captures the value at /authorize
-- and carries it through to the issued token pair.
--
-- Two gaps remained:
--   1. `oauth_validate_access_token` (used by orchestrator-mcp on every MCP
--      call) returned (user_label, scope, client_id) — NO `resource` column.
--      This made it impossible for the resource server to validate token
--      audience at use-time, which is the core defence against the OAuth
--      "confused deputy" vulnerability (RFC 8707 §1 + MCP spec
--      "Access Token Privilege Restriction" + "Confused Deputy Problem").
--   2. Columns lacked database-level COMMENT entries documenting what
--      `resource` means + the canonicalisation contract enforced by
--      mcp-auth (lowercase scheme/host, no trailing slash, no fragment,
--      http or https only). Inline `--` comments in the original migration
--      are invisible in pg_catalog and `\d` output. Future operators reading
--      the schema directly couldn't tell that resource carries a SECURITY
--      contract beyond "audit string".
--
-- This migration:
--   - Recreates `oauth_validate_access_token` with an additional `resource`
--     column in its RETURNS TABLE. Behaviour otherwise identical.
--   - Adds COMMENT ON COLUMN to the three resource columns explaining the
--     RFC 8707 contract + canonical form.
--
-- Backwards compat: tokens issued BEFORE this code shipped have NULL
-- `resource`. orchestrator-mcp's `authenticateRequest` allows NULL with a
-- Sentry warning during a 30-day cutover window. See
-- docs/scheduler/DEFERRED-AUDIT-ITEMS.md item SEC-6.
-- =====================================================================

-- ─── 1. Extend the access-token validator to surface `resource` ─────────

DROP FUNCTION IF EXISTS public.oauth_validate_access_token(text);

CREATE OR REPLACE FUNCTION public.oauth_validate_access_token(p_token_hash text)
RETURNS TABLE (
  user_label text,
  scope      text,
  client_id  text,
  resource   text
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
  RETURNING t.user_label, t.scope, t.client_id, t.resource;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.oauth_validate_access_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.oauth_validate_access_token(text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.oauth_validate_access_token(text) TO service_role;

COMMENT ON FUNCTION public.oauth_validate_access_token(text) IS
  'Validates an MCP OAuth bearer token by sha256 hash, bumps last_used_at, returns user/scope/client/resource. Resource column added 2026-05-23 (PLAN-03 Phase 4) so orchestrator-mcp can enforce RFC 8707 audience binding. service_role only.';

-- ─── 2. Schema-level documentation for the resource columns ─────────────

COMMENT ON COLUMN public.oauth_authorization_codes.resource IS
  'RFC 8707 resource indicator captured at /authorize. Stored in canonical form (lowercase scheme/host, no trailing slash, no fragment). Required as of PLAN-03 Phase 4 — /authorize rejects requests that do not supply it, and that do not match getExpectedMcpResource() in supabase/functions/_shared/oauth.ts.';

COMMENT ON COLUMN public.oauth_access_tokens.resource IS
  'RFC 8707 resource indicator copied from the auth code the token was issued against. orchestrator-mcp validates that token.resource matches the canonical orchestrator-mcp URL on every MCP call. NULL on legacy tokens issued before PLAN-03 Phase 4 (2026-05-23) — allowed during a 30-day backward-compat window; rejected thereafter. See docs/scheduler/DEFERRED-AUDIT-ITEMS.md item SEC-6.';

COMMENT ON COLUMN public.oauth_refresh_tokens.resource IS
  'RFC 8707 resource indicator copied from the original auth code. Survives refresh-token rotation — the new access+refresh pair inherits this audience. Refresh requests that supply a different resource are rejected with invalid_target.';
