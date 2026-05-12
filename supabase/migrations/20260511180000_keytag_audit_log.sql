-- =====================================================================
-- Keytag audit log + changed_by attribution
-- =====================================================================
-- Created 2026-05-11. Option A from the per-employee MCP auth design:
-- leverage the existing OAuth user_label (captured at consent time and
-- bound to every access token via oauth_access_tokens) and propagate it
-- through every keytag mutation triggered from Claude Desktop.
--
-- Three changes:
--
--   1) keytags.changed_by_user_label TEXT — denormalized "who last
--      touched this row" pointer. NULL for webhook-driven mutations
--      (Tekmetric is the actor), populated for orchestrator-tool calls.
--
--   2) keytag_audit_log table — append-only history of every mutation
--      with the diff (before/after status) + actor + reason. Used for
--      accountability queries ("who released R5 yesterday?").
--
--   3) Helper RPCs for the orchestrator tools to write the audit log
--      atomically with the keytag mutation. The bulk-reconcile / live
--      webhook handler set source = 'webhook' or 'cron'; orchestrator
--      tools pass the user_label and source = 'claude_desktop'.
--
-- Note: the live webhook handler + bulk reconcile DO NOT need to be
-- updated to populate user_label — they write source='webhook' /
-- 'cron' and leave user_label NULL. Only the orchestrator-driven
-- mutation paths (assignKeytagToRo / releaseKeytagFromRo / future
-- force-release) will carry user_label.
-- =====================================================================

ALTER TABLE public.keytags
  ADD COLUMN IF NOT EXISTS changed_by_user_label TEXT;

COMMENT ON COLUMN public.keytags.changed_by_user_label IS
  'The MCP OAuth user_label of the most recent orchestrator-driven mutation. NULL when the most recent change came from a webhook, cron, or seed (i.e. system-driven not human-driven).';

-- ─────────────────────────────────────────────────────────────────────────────
-- keytag_audit_log — append-only history of every mutation
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.keytag_audit_log (
  id              BIGSERIAL    PRIMARY KEY,
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- What changed
  tag_color       TEXT         NOT NULL CHECK (tag_color IN ('red', 'yellow')),
  tag_number      INT          NOT NULL CHECK (tag_number BETWEEN 1 AND 90),
  ro_id           BIGINT,
  ro_number       BIGINT,

  -- The mutation
  action          TEXT         NOT NULL CHECK (action IN (
                                  'assigned',         -- transitioned available → assigned
                                  'force_assigned',   -- specific (color, number) picked by human
                                  'marked_posted',    -- assigned → posted_ar (sent to A/R)
                                  'reverted',         -- posted_ar → assigned (A/R un-posted)
                                  'released',         -- → available (paid, manual, posted-paid)
                                  'released_orphan'   -- cron-driven release (RO deleted / paid w/o webhook)
                                )),
  prior_status    TEXT,
  new_status      TEXT,

  -- Who + how
  source          TEXT         NOT NULL CHECK (source IN (
                                  'claude_desktop',   -- orchestrator-driven via MCP
                                  'webhook',          -- Tekmetric ro_status_updated / sent_to_ar / posted / payment
                                  'cron',             -- bulk-reconcile nightly cron
                                  'manual_sql'        -- direct DB intervention (cleanup, recovery)
                                )),
  user_label      TEXT,                              -- populated when source='claude_desktop'
  reason          TEXT,                              -- free-form context (event_text, p_reason, etc)

  -- Tekmetric PATCH result (when applicable)
  tekmetric_patch_ok    BOOLEAN,
  tekmetric_patch_error TEXT
);

CREATE INDEX IF NOT EXISTS keytag_audit_log_ro_id_idx
  ON public.keytag_audit_log (ro_id);
CREATE INDEX IF NOT EXISTS keytag_audit_log_user_label_idx
  ON public.keytag_audit_log (user_label)
  WHERE user_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS keytag_audit_log_occurred_at_idx
  ON public.keytag_audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS keytag_audit_log_tag_idx
  ON public.keytag_audit_log (tag_color, tag_number);

ALTER TABLE public.keytag_audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.keytag_audit_log IS
  'Append-only mutation history for the keytag pool. Every assign/release/mark_posted/revert writes a row with the actor (user_label when source=claude_desktop, else NULL) so we can answer "who did X" queries.';

-- ─────────────────────────────────────────────────────────────────────────────
-- log_keytag_audit — convenience RPC. Called by orchestrator tools and
-- (optionally) by the webhook handler. We keep it as a helper so the
-- write is atomic with the calling transaction and the schema can evolve
-- behind a stable interface.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_keytag_audit(
  p_tag_color             text,
  p_tag_number            int,
  p_action                text,
  p_source                text,
  p_ro_id                 bigint    DEFAULT NULL,
  p_ro_number             bigint    DEFAULT NULL,
  p_prior_status          text      DEFAULT NULL,
  p_new_status            text      DEFAULT NULL,
  p_user_label            text      DEFAULT NULL,
  p_reason                text      DEFAULT NULL,
  p_tekmetric_patch_ok    boolean   DEFAULT NULL,
  p_tekmetric_patch_error text      DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO keytag_audit_log (
    tag_color, tag_number, action, source,
    ro_id, ro_number, prior_status, new_status,
    user_label, reason,
    tekmetric_patch_ok, tekmetric_patch_error
  ) VALUES (
    p_tag_color, p_tag_number, p_action, p_source,
    p_ro_id, p_ro_number, p_prior_status, p_new_status,
    p_user_label, p_reason,
    p_tekmetric_patch_ok, p_tekmetric_patch_error
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.log_keytag_audit IS
  'Append a row to keytag_audit_log. Orchestrator tools pass p_source=''claude_desktop'' + p_user_label from the OAuth token; webhook handler passes p_source=''webhook''; bulk-reconcile passes p_source=''cron''.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Touch changed_by_user_label on keytags when the orchestrator drives a
-- mutation. The tool layer in TypeScript calls log_keytag_audit AND
-- updates keytags.changed_by_user_label — but the SQL layer enforces
-- the invariant via this trigger if anyone writes to keytags directly.
--
-- (Trigger is purely defensive — the TypeScript path is canonical.)
-- ─────────────────────────────────────────────────────────────────────────────
-- (No trigger added — leaving the TypeScript path canonical so we don't
-- need to thread session-local user_label through Postgres SET LOCAL
-- machinery. If we later want DB-level enforcement we can add it.)
