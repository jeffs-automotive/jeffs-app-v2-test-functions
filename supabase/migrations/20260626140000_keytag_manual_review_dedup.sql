-- =====================================================================
-- Keytag manual-review dedup — M4 (audit follow-up)
-- =====================================================================
-- Completes the item DEFERRED by 20260626120000_keytag_db_hardening.sql.
--
-- The app dedups manual reviews best-effort in issueManualReview()
-- (supabase/functions/_shared/manual-review.ts): a SELECT-then-INSERT on
-- (category, context->>'ro_id'). That is a TOCTOU race — the webhook
-- handler and the reconcile cron can both pass the SELECT gate (no prior
-- row) at the same instant and then BOTH INSERT, producing two open
-- reviews (and two emails) for the same (category, ro_id).
--
-- This migration closes the race with a DB-level guarantee, shipped as a
-- PAIR (the reason M4 was deferred — the index alone would make a race
-- THROW instead of degrade to a no-op):
--
--   1. A PARTIAL UNIQUE index on (category, (context->>'ro_id')) WHERE
--      resolved_at IS NULL. Only OPEN reviews are constrained, so a new
--      anomaly for an RO whose prior review was already resolved is still
--      allowed (matches the app's category-aware dedup intent). NULL
--      ro_id rows are excluded from the constraint by NULL distinctness +
--      the JSONB-expression yielding NULL — they never conflict, matching
--      the app's "dedup skipped when no ro_id" branch.
--
--   2. A unique_violation EXCEPTION handler in create_manual_review() so a
--      concurrent loser of the race degrades to returning the EXISTING
--      open review (created-equivalent: same RETURNS TABLE shape) instead
--      of raising. The happy path (no conflict) is BYTE-FOR-BYTE the prior
--      behavior.
--
-- Verified before authoring: 0 open reviews, 0 duplicate open groups by
-- the (category, context->>'ro_id') expression — the index builds clean.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Partial UNIQUE index (the DB-level dedup guarantee for OPEN reviews).
--    Expression matches the existing functional index
--    keytag_manual_reviews_category_ro_id_idx EXACTLY —
--    (category, (context->>'ro_id')) — and the app's dedup filter
--    `.filter("context->>ro_id", "eq", String(roId))`. context->'ro_id' is
--    stored as a JSON number, so ->> extracts the same canonical text the
--    app produces with String(roId).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS keytag_manual_reviews_open_uniq
  ON public.keytag_manual_reviews (category, (context->>'ro_id'))
  WHERE resolved_at IS NULL;

COMMENT ON INDEX public.keytag_manual_reviews_open_uniq IS
  'Partial UNIQUE: at most ONE open (resolved_at IS NULL) review per (category, context->>ro_id). DB-level backstop for the best-effort dedup in issueManualReview(); the create_manual_review() unique_violation handler degrades a concurrent race to a no-op. NULL ro_id rows are excluded (NULL distinctness) — matching the app branch that skips dedup when context has no ro_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. create_manual_review — recreated with graceful unique-violation
--    handling. The signature, RETURNS TABLE contract, SECURITY DEFINER,
--    SET search_path, and grants are all preserved. The ONLY change versus
--    20260511220000 is the BEGIN/EXCEPTION wrapper around the INSERT: on a
--    unique_violation against keytag_manual_reviews_open_uniq, instead of
--    raising, select the EXISTING open review for (category, ro_id) and
--    return it (review_id from the existing row; audit_log_id NULL — the
--    existing row owns its own issuance audit entry, and resolution audit
--    ids only attach at resolution time, so there is no issuance audit id
--    to surface here — same NULL the caller's own dedup short-circuit
--    returns).
--
--    Why EXCEPTION rather than ON CONFLICT: ON CONFLICT inference against a
--    PARTIAL index on a JSONB expression is brittle (the inference must
--    restate the predicate AND the expression exactly, and partial-index
--    arbiter inference does not compose cleanly with the RETURNING used
--    here). Catching unique_violation is robust to the exact index shape.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_manual_review(
  p_category      text,
  p_prefix        text,
  p_context       jsonb,
  p_options       jsonb,
  p_issue_summary text,
  -- For the paired audit-log entry. tag_color/number may be NULL for ARN
  -- (A/R RO with no tag in our DB yet).
  p_tag_color     text DEFAULT NULL,
  p_tag_number    int  DEFAULT NULL,
  p_ro_id         bigint DEFAULT NULL,
  p_ro_number     bigint DEFAULT NULL,
  p_audit_source  text DEFAULT 'webhook'  -- 'webhook' | 'cron'
)
RETURNS TABLE (
  code            TEXT,
  review_id       BIGINT,
  audit_log_id    BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code      TEXT;
  v_review_id BIGINT;
  v_audit_id  BIGINT;
BEGIN
  v_code := public.generate_manual_review_code(p_prefix);

  -- Wrap the issuance INSERT so a concurrent race that violates the
  -- partial UNIQUE index (keytag_manual_reviews_open_uniq) degrades to a
  -- quiet no-op: return the existing OPEN review instead of throwing.
  -- The happy path (no conflict) is unchanged from 20260511220000.
  BEGIN
    INSERT INTO keytag_manual_reviews (
      code, category, context, options, issue_summary
    ) VALUES (
      v_code, p_category, p_context, p_options, p_issue_summary
    )
    RETURNING id INTO v_review_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- A parallel issuer won the race for this (category, ro_id) open
      -- slot. Return the existing open review; do NOT insert, do NOT write
      -- a duplicate audit entry. ro_id is compared on the same
      -- (context->>'ro_id') text expression the index uses.
      SELECT mr.code, mr.id
        INTO v_code, v_review_id
        FROM keytag_manual_reviews mr
       WHERE mr.category = p_category
         AND mr.resolved_at IS NULL
         AND (mr.context->>'ro_id') = (p_context->>'ro_id')
       ORDER BY mr.issued_at DESC
       LIMIT 1;

      -- Defensive: the violation guarantees a conflicting open row exists.
      -- If it somehow vanished between the failed INSERT and this SELECT
      -- (e.g. resolved in the same instant), re-raise rather than return a
      -- half-formed result — never silently swallow.
      IF v_review_id IS NULL THEN
        RAISE;
      END IF;

      RETURN QUERY SELECT v_code, v_review_id, NULL::bigint;
      RETURN;
  END;

  -- Audit-log entry referencing the code. For ARN where tag_color/number
  -- are NULL, we still need a row to exist (so accountability queries
  -- find it) — use a sentinel-friendly approach. The CHECK on
  -- keytag_audit_log requires (tag_color, tag_number) NOT NULL, so for
  -- ARN we use a placeholder: 'red' / 0. Daily report + audit-history
  -- tool filter ARN entries by reason prefix.
  IF p_tag_color IS NOT NULL AND p_tag_number IS NOT NULL THEN
    INSERT INTO keytag_audit_log (
      tag_color, tag_number, action, source,
      ro_id, ro_number, prior_status, new_status,
      user_label, reason, manual_review_code
    ) VALUES (
      p_tag_color, p_tag_number,
      'manual_review_issued', p_audit_source,
      p_ro_id, p_ro_number,
      NULL, NULL,
      NULL,
      'manual_review_issued:' || p_category || ':' || p_issue_summary,
      v_code
    )
    RETURNING id INTO v_audit_id;
  END IF;

  RETURN QUERY SELECT v_code, v_review_id, v_audit_id;
END;
$$;

COMMENT ON FUNCTION public.create_manual_review IS
  'Issues a new manual review with a fresh code, writes a paired keytag_audit_log entry referencing the code. Called by the webhook handler + bulk-reconcile + the orchestrator''s detection paths. A concurrent race on the partial UNIQUE index keytag_manual_reviews_open_uniq is caught and degrades to returning the existing open review (no duplicate insert, no duplicate audit entry).';

-- Re-assert grants (no-op if unchanged) so the recreate preserves access.
-- Verified live grantee set: service_role (postgres is owner-implicit).
GRANT EXECUTE ON FUNCTION public.create_manual_review(
  text, text, jsonb, jsonb, text, text, int, bigint, bigint, text
) TO service_role;
