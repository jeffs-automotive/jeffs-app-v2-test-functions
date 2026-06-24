-- =====================================================================
-- Widen keytag `source` provenance to include 'admin_app'
-- =====================================================================
-- 2026-06-24 (board-release-fix). The admin-app dashboard drives keytag
-- assign/release through the orchestrator-mcp SERVICE_ROLE + X-Actor-Email
-- branch; those mutations are now correctly attributed source='admin_app'
-- (previously mis-labeled 'claude_desktop'). Two DB guards must accept the new
-- value or the admin-app path breaks at runtime:
--   1) keytag_audit_log.source CHECK — else log_keytag_audit's INSERT raises
--      check_violation; that RPC error is unchecked, so the audit row is
--      silently lost while the mutation still returns ok.
--   2) auto_resolve_manual_review(p_source) guard — else an admin-app terminal
--      release returns 'invalid_source' and moot manual reviews strand.
-- Pairs with the orchestrator-mcp source-provenance change.
-- =====================================================================

-- 1) keytag_audit_log.source CHECK — add 'admin_app'
ALTER TABLE public.keytag_audit_log
  DROP CONSTRAINT IF EXISTS keytag_audit_log_source_check;
ALTER TABLE public.keytag_audit_log
  ADD CONSTRAINT keytag_audit_log_source_check CHECK (source IN (
    'claude_desktop',  -- orchestrator OAuth branch (Claude Desktop)
    'webhook',         -- Tekmetric webhooks
    'cron',            -- bulk-reconcile nightly cron
    'manual_sql',      -- direct DB intervention
    'admin_app'        -- admin dashboard (orchestrator SERVICE_ROLE + X-Actor-Email branch)
  ));

-- 2) auto_resolve_manual_review — add 'admin_app' to the source allow-list.
--    Body identical to migration 20260623180000 except the IF-guard line.
CREATE OR REPLACE FUNCTION public.auto_resolve_manual_review(
  p_code   text,
  p_reason text,
  p_source text DEFAULT 'cron'
)
RETURNS TABLE (
  ok              BOOLEAN,
  failure_reason  TEXT,
  review_id       BIGINT,
  audit_log_id    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        keytag_manual_reviews%ROWTYPE;
  v_tag_color  TEXT;
  v_tag_number INT;
  v_audit_id   BIGINT;
BEGIN
  -- source must be one of the keytag_audit_log enum values
  IF p_source NOT IN ('webhook', 'cron', 'claude_desktop', 'manual_sql', 'admin_app') THEN
    RETURN QUERY SELECT FALSE, 'invalid_source'::text, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM keytag_manual_reviews
  WHERE keytag_manual_reviews.code = p_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'code_not_found'::text, NULL::bigint, NULL::bigint;
    RETURN;
  END IF;

  IF v_row.resolved_at IS NOT NULL THEN
    -- Idempotent: already closed (by a human, or a prior auto-resolve). No-op.
    RETURN QUERY SELECT FALSE, 'already_resolved'::text, v_row.id, NULL::bigint;
    RETURN;
  END IF;

  UPDATE keytag_manual_reviews
     SET resolved_at            = now(),
         resolved_by_user_label = 'system:auto',
         resolved_choice        = 'auto_cleared',
         resolution_notes       = p_reason
   WHERE id = v_row.id;

  -- Paired audit row — only when the review carries a real tag.
  v_tag_color  := v_row.context->>'tag_color';
  v_tag_number := NULLIF(v_row.context->>'tag_number', '')::int;
  IF v_tag_color IN ('red', 'yellow') AND v_tag_number BETWEEN 1 AND 90 THEN
    INSERT INTO keytag_audit_log (
      tag_color, tag_number, action, source,
      ro_id, ro_number, prior_status, new_status,
      user_label, reason, manual_review_code
    ) VALUES (
      v_tag_color, v_tag_number,
      'manual_review_resolved', p_source,
      NULLIF(v_row.context->>'ro_id', '')::bigint,
      NULLIF(v_row.context->>'ro_number', '')::bigint,
      NULL, NULL, NULL,
      'auto_cleared:' || p_reason,
      v_row.code
    )
    RETURNING id INTO v_audit_id;

    UPDATE keytag_manual_reviews
       SET resolution_audit_log_id = v_audit_id
     WHERE id = v_row.id;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::text, v_row.id, v_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_resolve_manual_review(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_resolve_manual_review(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.auto_resolve_manual_review(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resolve_manual_review(text, text, text) TO service_role;
