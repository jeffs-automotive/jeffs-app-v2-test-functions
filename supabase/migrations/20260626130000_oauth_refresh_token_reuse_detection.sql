-- =====================================================================
-- M7 — Refresh-token REUSE DETECTION + token-FAMILY revocation
-- L4 — ATOMIC access+refresh issuance in a single SECURITY DEFINER RPC
-- =====================================================================
-- Created 2026-06-26. Hardens the OAuth 2.1 trust root (mcp-auth) that
-- issues the bearer Claude Desktop uses to reach orchestrator-mcp.
--
-- Background (see 20260511190000_oauth_refresh_tokens.sql):
--   Rotation was already implemented — oauth_consume_refresh_token marks
--   the presented refresh token revoked and the handler issues a fresh
--   pair. But a replay of an ALREADY-CONSUMED token was indistinguishable
--   from "unknown/expired" — both just returned an empty row → invalid_grant.
--   That silently absorbed the single strongest signal of refresh-token
--   THEFT (RFC 6819 §5.2.2.3 / OAuth 2.1 §6.1): a token that was already
--   rotated being presented a SECOND time means two parties hold it.
--
-- This migration adds:
--   1. `family_id UUID` on oauth_refresh_tokens AND oauth_access_tokens so
--      an entire rotation chain (descended from one authorization grant)
--      can be revoked together. Backfilled for existing rows by walking the
--      parent_token_hash chain to its root (one family per root).
--   2. oauth_consume_refresh_token() RECREATED to return a STATUS
--      discriminator + the family_id, distinguishing:
--        - 'rotated'  → token was active; now consumed (happy path)
--        - 'reuse'    → token exists but was ALREADY revoked → THEFT signal
--        - 'invalid'  → unknown / expired (no row returned)
--   3. oauth_revoke_token_family() — revokes every active access + refresh
--      token in a family. Called by the handler on a 'reuse' result.
--   4. oauth_issue_token_pair() (L4) — inserts the access + refresh rows in
--      ONE transaction (was two sequential JS .insert() calls with a
--      partial-failure window) and returns nothing extra (the edge handler
--      already holds the raw token values + hashes it computed).
--
-- Safety: existing 3 ACTIVE refresh tokens (Claude Desktop installs) are
-- preserved — the backfill assigns each its chain's family_id and leaves
-- revoked_at untouched, so live sessions keep working.
-- =====================================================================

-- ─── 1. family_id columns ───────────────────────────────────────────────

ALTER TABLE public.oauth_refresh_tokens ADD COLUMN IF NOT EXISTS family_id uuid;
ALTER TABLE public.oauth_access_tokens  ADD COLUMN IF NOT EXISTS family_id uuid;

-- ─── 2. Backfill family_id for existing refresh-token chains ────────────
--
-- Each chain is a linked list via parent_token_hash, rooted where
-- parent_token_hash IS NULL. Walk every node up to its root and give the
-- whole chain one shared family_id (the root's deterministic uuid). We use
-- a recursive CTE: start at roots, assign each root a fresh uuid, then
-- propagate that uuid down to descendants.
WITH RECURSIVE chain AS (
  -- roots: no parent
  SELECT token_hash, gen_random_uuid() AS fam
  FROM public.oauth_refresh_tokens
  WHERE parent_token_hash IS NULL
  UNION ALL
  -- children inherit their parent's family
  SELECT rt.token_hash, c.fam
  FROM public.oauth_refresh_tokens rt
  JOIN chain c ON rt.parent_token_hash = c.token_hash
)
UPDATE public.oauth_refresh_tokens t
SET family_id = chain.fam
FROM chain
WHERE t.token_hash = chain.token_hash
  AND t.family_id IS NULL;

-- Any refresh token whose parent pointer is dangling (parent row was
-- deleted via ON DELETE SET NULL, or an orphan) still needs a family so the
-- NOT NULL + default contract below holds. Give each remaining NULL its own
-- singleton family.
UPDATE public.oauth_refresh_tokens
SET family_id = gen_random_uuid()
WHERE family_id IS NULL;

-- Legacy access tokens predate family tracking and are all expired (1h TTL).
-- They have no structural link to a refresh family, so leave family_id NULL:
-- oauth_revoke_token_family only targets rows WHERE family_id = p_family_id,
-- so NULL-family legacy access tokens are simply never matched (they're
-- already expired regardless). New access tokens get a family_id via
-- oauth_issue_token_pair below.

-- Going forward, refresh tokens must always carry a family. Enforce NOT NULL
-- on refresh tokens (all rows are now backfilled). Access tokens stay
-- nullable to tolerate the legacy rows.
--
-- DEPLOY-WINDOW SAFETY: a DEFAULT lets the OLD edge handler (still live in the
-- brief gap between this migration applying and the new mcp-auth function
-- deploying) — which inserts refresh rows WITHOUT family_id — survive the
-- NOT NULL constraint instead of failing a refresh and forcing a re-auth. The
-- new issuance path (oauth_issue_token_pair) always passes family_id EXPLICITLY,
-- so the default is purely a fallback for that ~30s window; once the function is
-- deployed nothing inserts refresh rows without an explicit family.
ALTER TABLE public.oauth_refresh_tokens ALTER COLUMN family_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.oauth_refresh_tokens ALTER COLUMN family_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_family_idx
  ON public.oauth_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_family_idx
  ON public.oauth_access_tokens (family_id);

COMMENT ON COLUMN public.oauth_refresh_tokens.family_id IS
  'Token-family id: every refresh token descended from one authorization grant shares this uuid. On refresh-token REUSE (a revoked token replayed → theft signal, RFC 6819 §5.2.2.3) the whole family is revoked via oauth_revoke_token_family(). NOT NULL — set at issue time by oauth_issue_token_pair().';
COMMENT ON COLUMN public.oauth_access_tokens.family_id IS
  'Token-family id inherited from the refresh-token family at issue time, so an access token can be revoked alongside its family on reuse detection. NULL on legacy tokens issued before 2026-06-26 (already expired; never matched by family revocation).';

-- ─── 3. Recreate the consume RPC with a reuse-detection discriminator ──
--
-- The return contract changes: it now ALWAYS returns exactly one row with a
-- `status` discriminator (instead of zero-or-one rows). The handler keys on
-- `status`:
--   'rotated' → happy path: token was active, is now revoked; issue new pair
--   'reuse'   → token exists but was already revoked: THEFT — revoke family
--   'invalid' → unknown or expired: plain invalid_grant
--
-- 'rotated' is the only branch that mutates state (sets revoked_at). The
-- mutation is atomic (single UPDATE … WHERE revoked_at IS NULL) so two
-- concurrent legitimate refreshes can't both win — the loser sees the row
-- as already-revoked and is reported as 'reuse'. For a SINGLE-threaded
-- client (Claude Desktop) that never happens on the happy path; it only
-- fires on a genuine replay.
DROP FUNCTION IF EXISTS public.oauth_consume_refresh_token(text);

CREATE OR REPLACE FUNCTION public.oauth_consume_refresh_token(p_token_hash text)
RETURNS TABLE (
  status      text,    -- 'rotated' | 'reuse' | 'invalid'
  user_label  text,
  scope       text,
  client_id   text,
  resource    text,
  family_id   uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.oauth_refresh_tokens%ROWTYPE;
BEGIN
  -- Attempt the atomic active→revoked transition. Wins ONLY if the token is
  -- currently active (not revoked, not expired).
  UPDATE public.oauth_refresh_tokens t
  SET revoked_at = now(),
      last_used_at = now()
  WHERE t.token_hash = p_token_hash
    AND t.revoked_at IS NULL
    AND t.expires_at > now()
  RETURNING t.* INTO v_row;

  IF FOUND THEN
    RETURN QUERY SELECT 'rotated'::text, v_row.user_label, v_row.scope,
                        v_row.client_id, v_row.resource, v_row.family_id;
    RETURN;
  END IF;

  -- The atomic rotation did not fire. Figure out WHY by reading the row.
  SELECT * INTO v_row
  FROM public.oauth_refresh_tokens t
  WHERE t.token_hash = p_token_hash;

  IF NOT FOUND THEN
    -- Unknown token hash → plain invalid_grant. No family to act on.
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text,
                        NULL::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;

  -- Row exists but the atomic UPDATE didn't take it. Two cases:
  --   a) already revoked  → REUSE (a consumed/rotated token replayed) → theft
  --   b) expired (still active flag but past expiry) → invalid, NOT reuse
  IF v_row.revoked_at IS NOT NULL THEN
    RETURN QUERY SELECT 'reuse'::text, v_row.user_label, v_row.scope,
                        v_row.client_id, v_row.resource, v_row.family_id;
  ELSE
    -- not revoked but failed the WHERE → expired
    RETURN QUERY SELECT 'invalid'::text, NULL::text, NULL::text,
                        NULL::text, NULL::text, NULL::uuid;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.oauth_consume_refresh_token(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.oauth_consume_refresh_token(text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.oauth_consume_refresh_token(text) TO service_role;

COMMENT ON FUNCTION public.oauth_consume_refresh_token(text) IS
  'Atomically rotates a refresh token AND classifies the outcome: status=rotated (was active, now consumed), reuse (already-revoked token replayed → theft signal, revoke the family), or invalid (unknown/expired). Single-use per OAuth 2.1 §6.1. service_role only.';

-- ─── 4. Family revocation RPC ──────────────────────────────────────────
--
-- Revokes every still-active access + refresh token in a family. Idempotent
-- — re-running only touches rows that aren't already revoked. Returns the
-- counts revoked for logging.
CREATE OR REPLACE FUNCTION public.oauth_revoke_token_family(p_family_id uuid)
RETURNS TABLE (
  refresh_revoked integer,
  access_revoked  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refresh integer;
  v_access  integer;
BEGIN
  IF p_family_id IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  WITH r AS (
    UPDATE public.oauth_refresh_tokens
    SET revoked_at = now()
    WHERE family_id = p_family_id
      AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_refresh FROM r;

  WITH a AS (
    UPDATE public.oauth_access_tokens
    SET revoked_at = now()
    WHERE family_id = p_family_id
      AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_access FROM a;

  RETURN QUERY SELECT v_refresh, v_access;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.oauth_revoke_token_family(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.oauth_revoke_token_family(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.oauth_revoke_token_family(uuid) TO service_role;

COMMENT ON FUNCTION public.oauth_revoke_token_family(uuid) IS
  'Revokes ALL still-active access + refresh tokens sharing p_family_id. Called on refresh-token reuse detection (theft) to kill the entire compromised chain. Idempotent. Returns (refresh_revoked, access_revoked) counts. service_role only.';

-- ─── 5. L4 — atomic access+refresh issuance in one transaction ─────────
--
-- Replaces two sequential JS .insert() calls (oauth_access_tokens then
-- oauth_refresh_tokens) — a partial-failure window where the access row
-- could persist without its refresh row (or vice versa). A single function
-- body is one implicit transaction, so both rows commit together or not at
-- all.
--
-- The caller passes pre-computed hashes (the raw token values never reach
-- the DB — same at-rest contract as before) + TTLs in seconds, and the
-- family_id (a fresh uuid on initial issue, or the inherited family on
-- rotation). Returns nothing — success is the absence of an exception.
CREATE OR REPLACE FUNCTION public.oauth_issue_token_pair(
  p_access_token_hash   text,
  p_refresh_token_hash  text,
  p_client_id           text,
  p_user_label          text,
  p_scope               text,
  p_resource            text,
  p_family_id           uuid,
  p_parent_token_hash   text,
  p_access_ttl_seconds  integer,
  p_refresh_ttl_seconds integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.oauth_access_tokens (
    token_hash, client_id, user_label, scope, resource, family_id, expires_at
  ) VALUES (
    p_access_token_hash, p_client_id, p_user_label, p_scope, p_resource,
    p_family_id, now() + make_interval(secs => p_access_ttl_seconds)
  );

  INSERT INTO public.oauth_refresh_tokens (
    token_hash, client_id, user_label, scope, resource, family_id,
    parent_token_hash, expires_at
  ) VALUES (
    p_refresh_token_hash, p_client_id, p_user_label, p_scope, p_resource,
    p_family_id, p_parent_token_hash,
    now() + make_interval(secs => p_refresh_ttl_seconds)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.oauth_issue_token_pair(text, text, text, text, text, text, uuid, text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.oauth_issue_token_pair(text, text, text, text, text, text, uuid, text, integer, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.oauth_issue_token_pair(text, text, text, text, text, text, uuid, text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.oauth_issue_token_pair(text, text, text, text, text, text, uuid, text, integer, integer) IS
  'Atomically inserts the access + refresh token pair for an OAuth issue/rotation in ONE transaction (replaces two sequential edge-side INSERTs — L4). Raw tokens never reach the DB; caller passes sha256 hashes. service_role only.';
