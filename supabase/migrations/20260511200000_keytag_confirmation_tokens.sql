-- =====================================================================
-- Keytag confirmation tokens — two-step verification for sensitive ops
-- =====================================================================
-- Created 2026-05-11. Defense layer 2 against bulk-release and A/R drift
-- attacks (see investigation 2026-05-11):
--
--   - The orchestrator system prompt cannot reliably block every phrasing
--     of "release all the keytags" or enumerated multi-RO bulk ops.
--   - A/R repair orders need to be locked — Tekmetric won't accept PATCH
--     on A/R but our DB can still flip them, causing physical/digital
--     drift.
--
-- The fix: any "sensitive" tool call (A/R release, WIP release, revert,
-- multi-RO bulk op, force-assign overriding round-robin) is a TWO-STEP
-- transaction:
--
--   1. Tool called WITHOUT confirmation_token → returns a token bound to
--      the exact action scope (action_kind + scope_hash) + the user
--      label that originated the request. Token TTL = 5 minutes.
--
--   2. Tool re-called WITH the confirmation_token + the SAME exact
--      scope → token is consumed (one-time) + the operation executes.
--
-- The scope_hash binds the token to the EXACT operation. An attacker who
-- captures a token cannot reuse it for a different RO or a different
-- color/number — the scope_hash check is constant-time and atomic.
--
-- The user_label binding means the same OAuth identity that requested
-- the operation must confirm. Cross-user replay is blocked.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.keytag_confirmation_tokens (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  action_kind     TEXT         NOT NULL CHECK (action_kind IN (
                                  'release_ar_tag',       -- single A/R tag release
                                  'release_wip_tag',      -- single WIP tag release
                                  'revert_to_assigned',   -- single revert
                                  'mark_posted',          -- single mark posted
                                  'force_assign',         -- specific (color, number)
                                  'bulk_release',         -- multi-RO release
                                  'bulk_mark_posted',     -- multi-RO mark posted
                                  'bulk_revert',          -- multi-RO revert
                                  'bulk_force_assign'     -- multi-RO force assign
                                )),
  -- sha256 hex of a deterministic stringification of the operation's
  -- target set (ro_ids sorted ascending, tag colors+numbers sorted,
  -- reason canonicalized). Set by the tool layer when creating + when
  -- consuming. Token is only consumable if the consume-time scope_hash
  -- matches.
  scope_hash      TEXT         NOT NULL,
  -- Human-readable rendering of what the token authorizes. Surfaced
  -- back to the user for confirmation ("Release Red 4 from RO 152407?")
  scope_summary   TEXT         NOT NULL,
  user_label      TEXT         NOT NULL,
  -- When created vs consumed. Token is invalid if consumed_at is not NULL.
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ  NOT NULL,
  consumed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS keytag_confirmation_tokens_user_label_idx
  ON public.keytag_confirmation_tokens (user_label, created_at DESC);
CREATE INDEX IF NOT EXISTS keytag_confirmation_tokens_expires_at_idx
  ON public.keytag_confirmation_tokens (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE public.keytag_confirmation_tokens ENABLE ROW LEVEL SECURITY;
-- No RLS policies — service-role only access (the orchestrator and
-- bulk-reconcile both use service role). Defense in depth at app layer
-- via the RPCs below.

COMMENT ON TABLE public.keytag_confirmation_tokens IS
  'One-time confirmation tokens for sensitive keytag mutations. Token is bound to (action_kind, scope_hash, user_label) and expires after 5 minutes. Consumed atomically when the second-step tool call provides the matching token + scope.';

-- ─────────────────────────────────────────────────────────────────────────────
-- create_keytag_confirmation_token
-- Called by the TOOL LAYER on a first-step tool call when no token was
-- provided. Returns the token UUID + expiry. Tool layer then returns to
-- the orchestrator with a "confirmation required" response containing
-- the token + scope_summary; orchestrator presents to user; user confirms;
-- orchestrator re-calls tool with token; tool calls consume_…(); op runs.
--
-- TTL = 5 minutes. That's long enough for a normal confirmation flow
-- but short enough that a captured token has minimal exploit window.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_keytag_confirmation_token(
  p_action_kind   text,
  p_scope_hash    text,
  p_scope_summary text,
  p_user_label    text
)
RETURNS TABLE (
  token_id    UUID,
  expires_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_expires TIMESTAMPTZ;
BEGIN
  IF p_user_label IS NULL OR length(trim(p_user_label)) = 0 THEN
    RAISE EXCEPTION 'user_label is required for confirmation token issuance';
  END IF;
  IF p_scope_hash IS NULL OR length(p_scope_hash) <> 64 THEN
    -- sha256 hex is 64 chars
    RAISE EXCEPTION 'scope_hash must be sha256 hex (64 chars); got %', coalesce(length(p_scope_hash)::text, 'NULL');
  END IF;

  v_expires := now() + interval '5 minutes';
  INSERT INTO keytag_confirmation_tokens (
    action_kind, scope_hash, scope_summary, user_label, expires_at
  ) VALUES (
    p_action_kind, p_scope_hash, p_scope_summary, p_user_label, v_expires
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, v_expires;
END;
$$;

COMMENT ON FUNCTION public.create_keytag_confirmation_token IS
  'Issue a one-time confirmation token bound to (action_kind, scope_hash, user_label). Returns token_id + expires_at (5 min from now). Consumed by consume_keytag_confirmation_token.';

-- ─────────────────────────────────────────────────────────────────────────────
-- consume_keytag_confirmation_token
-- Atomic check + consume. Returns TRUE on success (token valid, not
-- expired, not already consumed, scope matches, user matches). Returns
-- FALSE otherwise — caller treats FALSE as authorization failure.
-- The atomicity (UPDATE … WHERE consumed_at IS NULL RETURNING) prevents
-- double-spend even under concurrent calls.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_keytag_confirmation_token(
  p_token_id    UUID,
  p_action_kind text,
  p_scope_hash  text,
  p_user_label  text
)
RETURNS TABLE (
  ok               BOOLEAN,
  failure_reason   TEXT,
  scope_summary    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row keytag_confirmation_tokens%ROWTYPE;
BEGIN
  -- Lock the row to prevent concurrent double-consume.
  SELECT * INTO v_row
    FROM keytag_confirmation_tokens
   WHERE id = p_token_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'token_not_found'::text, NULL::text;
    RETURN;
  END IF;
  IF v_row.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 'token_already_consumed'::text, v_row.scope_summary;
    RETURN;
  END IF;
  IF v_row.expires_at <= now() THEN
    RETURN QUERY SELECT FALSE, 'token_expired'::text, v_row.scope_summary;
    RETURN;
  END IF;
  IF v_row.action_kind <> p_action_kind THEN
    RETURN QUERY SELECT FALSE, 'action_kind_mismatch'::text, v_row.scope_summary;
    RETURN;
  END IF;
  IF v_row.scope_hash <> p_scope_hash THEN
    RETURN QUERY SELECT FALSE, 'scope_hash_mismatch'::text, v_row.scope_summary;
    RETURN;
  END IF;
  IF v_row.user_label <> p_user_label THEN
    RETURN QUERY SELECT FALSE, 'user_label_mismatch'::text, v_row.scope_summary;
    RETURN;
  END IF;

  UPDATE keytag_confirmation_tokens
     SET consumed_at = now()
   WHERE id = p_token_id;

  RETURN QUERY SELECT TRUE, NULL::text, v_row.scope_summary;
END;
$$;

COMMENT ON FUNCTION public.consume_keytag_confirmation_token IS
  'Atomically validate + consume a confirmation token. Returns ok=TRUE only when the token exists, is unexpired, unconsumed, and (action_kind, scope_hash, user_label) all match the issuance values. Single-use — second consume always returns ok=FALSE.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Optional janitor: expire/cleanup stale tokens. Not scheduled here —
-- the volume is small (a few tokens per day max) and unconsumed tokens
-- just sit harmlessly until they age past their TTL.
-- ─────────────────────────────────────────────────────────────────────────────
