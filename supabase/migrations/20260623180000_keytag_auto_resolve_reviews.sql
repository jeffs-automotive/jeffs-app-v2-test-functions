-- =====================================================================
-- Keytag manual-review AUTO-RESOLUTION (mootness-on-close)
-- =====================================================================
-- Created 2026-06-23. Design: docs/keytag/keytag-auto-resolve-reviews-plan.md
--
-- A manual review asks "what tag belongs on these keys?" — a question that
-- only has meaning while the physical keys are in the shop (RO still open /
-- WIP / A-R). Once the RO terminally closes (posted-paid, A-R paid off, or an
-- advisor releases the keys), there are no keys left to tag, so the review is
-- MOOT regardless of category.
--
-- This migration:
--   1) auto_resolve_manual_review(code, reason, source) — the SYSTEM path to
--      close a moot review. It is NOT resolve_manual_review (the human path):
--      no options[]/choice validation, no user_label lockout, no attempts row.
--      It only sets resolved_at + writes a paired audit row. It NEVER mutates
--      a key tag (auto-RESOLVE, never auto-FIX).
--   2) A ONE-TIME guarded backfill that closes every currently-moot open
--      review (the 70 stale rows found in the 2026-06-23 audit — each RO is no
--      longer holding a tag AND had a terminal/confirmed release).
--
-- Steady-state hooks (webhook posted-paid/payment, reconcile forward pass,
-- orchestrator manual release) live in the edge functions + call this RPC, so
-- the backlog never rebuilds. The ORP guardrail (never auto-close an orphan
-- review on the orphan-release that BIRTHED it) is honored by simply not
-- hooking the resolver into the reverse-pass orphan-release site.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- auto_resolve_manual_review(p_code, p_reason, p_source)
-- Atomically close-as-moot. Idempotent (already_resolved guard). Writes a
-- paired keytag_audit_log 'manual_review_resolved' row ONLY when the review
-- carries a real tag — ARN is tag-less and keytag_audit_log requires
-- (tag_color, tag_number) NOT NULL with tag_number 1..90 (mirrors the
-- create_manual_review NULL-guard). service_role only.
-- ─────────────────────────────────────────────────────────────────────────────
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
  IF p_source NOT IN ('webhook', 'cron', 'claude_desktop', 'manual_sql') THEN
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

COMMENT ON FUNCTION public.auto_resolve_manual_review IS
  'SYSTEM path to close a manual review whose situation is already moot (the RO terminally closed / keys left the shop). Sets resolved_by_user_label=system:auto, resolved_choice=auto_cleared; writes a paired manual_review_resolved audit row when the review carries a tag (ARN is tag-less). NEVER mutates a key tag. service_role only. Distinct from resolve_manual_review (the advisor path with options/lockout/attempts).';

REVOKE ALL ON FUNCTION public.auto_resolve_manual_review(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_resolve_manual_review(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.auto_resolve_manual_review(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_resolve_manual_review(text, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- ONE-TIME backlog cleanup. Closes every CURRENTLY-MOOT open review:
--   (a) the RO is no longer holding a tag (keys left the shop), AND
--   (b) a terminal/confirmed release actually happened for that RO.
-- On the 2026-06-23 data this resolves all 70 stale reviews; the gate
-- protects any row where the keys are genuinely still held. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r       RECORD;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT mr.code
    FROM keytag_manual_reviews mr
    WHERE mr.resolved_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM keytags k
        WHERE k.ro_id = NULLIF(mr.context->>'ro_id', '')::bigint
      )
      AND EXISTS (
        SELECT 1 FROM keytag_audit_log a
        WHERE a.ro_id = NULLIF(mr.context->>'ro_id', '')::bigint
          AND a.action IN ('released', 'released_orphan')
          AND a.reason IN (
            'webhook:ro_posted_paid',
            'webhook:payment_made_ar_balance_paid',
            'orchestrator_manual_release',
            'orchestrator_manual_release_ar_confirmed'
          )
      )
  LOOP
    PERFORM public.auto_resolve_manual_review(
      r.code,
      'moot_ro_closed:backfill_2026_06_23',
      'manual_sql'
    );
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'auto_resolve backfill: closed % moot manual review(s)', v_count;
END $$;
