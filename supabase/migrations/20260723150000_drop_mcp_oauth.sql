-- Teardown: MCP OAuth 2.1 authorization-server storage (Claude Desktop path).
--
-- Context: Claude Desktop was retired 2026-07-02. The `mcp-auth` edge function
-- (OAuth authorization server) and the OAuth-bearer validation branch of
-- `orchestrator` are removed in the same change. After that removal NOTHING
-- reads or writes these objects:
--
--   Tables (leaf cluster — only FK each other, verified no external FK):
--     oauth_clients, oauth_authorization_codes, oauth_access_tokens,
--     oauth_refresh_tokens
--   Functions (called only by the removed mcp-auth / orchestrator Branch B):
--     oauth_validate_access_token(text)        -- orchestrator Branch B (removed)
--     oauth_consume_refresh_token(text)        -- mcp-auth token endpoint (removed)
--     oauth_revoke_token_family(uuid)          -- mcp-auth reuse-detection (removed)
--     oauth_issue_token_pair(text,text,text,text,text,text,uuid,text,integer,integer)
--
-- The admin-app keytag-write path uses orchestrator's OTHER auth branch
-- (SERVICE_ROLE bearer + X-Actor-Email) which does NOT touch any oauth_* object,
-- so it is unaffected.
--
-- Indexes, grants, RLS policies and comments on these objects drop automatically
-- with their owning table/function. Dropping is irreversible; the data is retired
-- Claude Desktop OAuth clients/tokens with no ongoing consumer.

BEGIN;

-- Functions first (they read the tables). Explicit signatures so the right
-- overload is targeted; IF EXISTS makes the migration idempotent/re-runnable.
DROP FUNCTION IF EXISTS public.oauth_issue_token_pair(
  text, text, text, text, text, text, uuid, text, integer, integer);
DROP FUNCTION IF EXISTS public.oauth_revoke_token_family(uuid);
DROP FUNCTION IF EXISTS public.oauth_consume_refresh_token(text);
DROP FUNCTION IF EXISTS public.oauth_validate_access_token(text);

-- Tables. CASCADE covers the inter-table FKs (refresh/access/codes -> clients,
-- refresh.parent_token_hash -> refresh) and any dependent index/policy.
DROP TABLE IF EXISTS public.oauth_refresh_tokens CASCADE;
DROP TABLE IF EXISTS public.oauth_access_tokens CASCADE;
DROP TABLE IF EXISTS public.oauth_authorization_codes CASCADE;
DROP TABLE IF EXISTS public.oauth_clients CASCADE;

COMMIT;
