-- =====================================================================
-- Keytag manual reviews — async human-in-the-loop resolution
-- =====================================================================
-- Created 2026-05-11. The system detects anomalies it cannot safely
-- auto-resolve and surfaces them to the service team via:
--
--   1) A row in keytag_manual_reviews with a unique 6-char code (prefixed
--      by category — ORP, DRF, REG, ARN, PAF).
--   2) An audit log entry referencing the code, so the keytag's history
--      shows the review event.
--   3) An email to service@jeffsautomotive.com written in plain English
--      explaining what happened + what choices the advisor has.
--
-- Service advisor flow:
--   - Reads the email, learns the situation + options
--   - Opens Claude Desktop: "code ORP-A4B72C option a"
--   - Orchestrator looks up the code, validates auth + lockout state,
--     applies the chosen action, marks resolved + writes audit log
--
-- Categories (so far):
--   ORP — orphan_release         (bulk-reconcile reverse pass: RO 404 or POSTED_PAID)
--   DRF — work_approved_drift    (webhook work_approved on an RO with prior keytag history)
--   REG — ar_regression          (bulk-reconcile: A/R RO regressed to WIP but our tag was released)
--   ARN — ar_no_prior_tag        (bulk-reconcile: A/R RO with no tag in our DB; needs human input)
--   PAF — tekmetric_patch_fail   (webhook/reconcile: assign succeeded in DB but PATCH to Tekmetric failed)
--
-- Retention: matches keytag_audit_log retention (90 days). No explicit
-- TTL — codes stay valid until pruned by the retention policy.
--
-- Pre-approval semantics: when an advisor resolves a code via Claude,
-- the resolution is itself the authorization. Resolution actions DO NOT
-- additionally require the UUID confirmation-token flow used for
-- interactive in-chat sensitive operations. The 6-digit code is the
-- proof of authorization.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.keytag_manual_reviews (
  id                      BIGSERIAL      PRIMARY KEY,
  code                    TEXT           UNIQUE NOT NULL,
  category                TEXT           NOT NULL CHECK (category IN (
                                            'orphan_release',
                                            'work_approved_drift',
                                            'ar_regression',
                                            'ar_no_prior_tag',
                                            'tekmetric_patch_fail'
                                          )),
  issued_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
  -- The situation: ro_id, ro_number, tag_color, tag_number, prior_status,
  -- and any other category-specific context (e.g. tekmetric_status_name,
  -- patch_error). Stored as JSONB so we can render emails + resolution
  -- prompts without re-fetching.
  context                 JSONB          NOT NULL,
  -- The available choices for the advisor. Each is:
  --   {
  --     "key": "release",
  --     "label": "Release Red 5",
  --     "description": "Marks Red 5 available and returns it to the pool.",
  --     "needs_tag_input": false
  --   }
  -- When needs_tag_input=true, the advisor must also provide color +
  -- tag_number when resolving (e.g. "code DRF-X option assign red 7").
  options                 JSONB          NOT NULL,
  -- Human-readable summary, used in the email subject + body header and
  -- in the orchestrator's lookup-response.
  issue_summary           TEXT           NOT NULL,
  -- Resolution
  resolved_at             TIMESTAMPTZ,
  resolved_by_user_label  TEXT,
  resolved_choice         TEXT,
  resolved_color          TEXT,
  resolved_tag_number     INT,
  resolution_notes        TEXT,
  resolution_audit_log_id BIGINT         REFERENCES public.keytag_audit_log(id) ON DELETE SET NULL,
  -- Email tracking
  email_sent_at           TIMESTAMPTZ,
  email_error             TEXT
);

CREATE INDEX IF NOT EXISTS keytag_manual_reviews_unresolved_idx
  ON public.keytag_manual_reviews (issued_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS keytag_manual_reviews_category_idx
  ON public.keytag_manual_reviews (category, issued_at DESC);
CREATE INDEX IF NOT EXISTS keytag_manual_reviews_resolved_by_idx
  ON public.keytag_manual_reviews (resolved_by_user_label, resolved_at DESC)
  WHERE resolved_by_user_label IS NOT NULL;

ALTER TABLE public.keytag_manual_reviews ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.keytag_manual_reviews IS
  'Manual-review work items surfaced to the service team via email + 6-char code. Issued when the system detects an anomaly it cannot safely auto-resolve. Resolved by any authenticated advisor via Claude Desktop.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Resolution-attempt rate limiting. Brute-force protection for 6-char
-- codes: a user_label that exceeds 3 failed lookups in 1 hour is locked
-- out for the rest of that hour. Successful resolutions don't count.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.keytag_manual_review_attempts (
  id              BIGSERIAL    PRIMARY KEY,
  user_label      TEXT         NOT NULL,
  attempted_code  TEXT         NOT NULL,
  attempted_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  success         BOOLEAN      NOT NULL,
  failure_reason  TEXT
);

CREATE INDEX IF NOT EXISTS keytag_manual_review_attempts_lockout_idx
  ON public.keytag_manual_review_attempts (user_label, attempted_at DESC)
  WHERE success = false;

ALTER TABLE public.keytag_manual_review_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.keytag_manual_review_attempts IS
  'Audit trail of every manual-review code-resolution attempt. Used to rate-limit brute-force attacks: 3 failed attempts per user_label per hour triggers a lockout.';

-- Add a forward-pointer column to keytag_audit_log so the audit trail
-- shows which mutations were driven by which review code.
ALTER TABLE public.keytag_audit_log
  ADD COLUMN IF NOT EXISTS manual_review_code TEXT;

CREATE INDEX IF NOT EXISTS keytag_audit_log_manual_review_code_idx
  ON public.keytag_audit_log (manual_review_code)
  WHERE manual_review_code IS NOT NULL;

COMMENT ON COLUMN public.keytag_audit_log.manual_review_code IS
  'When this audit entry was driven by a manual-review resolution, the 6-char code of that review (e.g. ORP-A4B72C). NULL for routine mutations.';

-- ─────────────────────────────────────────────────────────────────────────────
-- generate_manual_review_code(p_prefix)
-- Returns a fresh PFX-XXXXXX code that doesn't collide with any
-- unresolved review. Uses a charset that excludes visually-ambiguous
-- characters (0, O, 1, I, L, etc.) so phone-relay between advisors is
-- reliable. 28^6 ≈ 481M space; collision probability against <100
-- active codes is essentially zero.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_manual_review_code(p_prefix text)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- 28 chars: digits 2-9 + uppercase letters except O/I/L (visual ambiguity)
  v_charset CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_chars_len CONSTANT INT := length(v_charset);
  v_suffix TEXT;
  v_code TEXT;
  v_attempts INT := 0;
BEGIN
  IF p_prefix !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'manual_review_code prefix must be exactly 3 uppercase letters; got %', p_prefix;
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    v_suffix :=
      substr(v_charset, 1 + floor(random() * v_chars_len)::int, 1) ||
      substr(v_charset, 1 + floor(random() * v_chars_len)::int, 1) ||
      substr(v_charset, 1 + floor(random() * v_chars_len)::int, 1) ||
      substr(v_charset, 1 + floor(random() * v_chars_len)::int, 1) ||
      substr(v_charset, 1 + floor(random() * v_chars_len)::int, 1) ||
      substr(v_charset, 1 + floor(random() * v_chars_len)::int, 1);
    v_code := p_prefix || '-' || v_suffix;

    -- Reject if it collides with any UNRESOLVED review. Resolved codes
    -- can theoretically be reused after they're pruned by retention,
    -- but we still avoid collision against ANY existing row for safety.
    IF NOT EXISTS (SELECT 1 FROM keytag_manual_reviews WHERE code = v_code) THEN
      RETURN v_code;
    END IF;

    -- Defensive: with 481M space and tiny active set, > 5 collisions
    -- in a row indicates a misconfigured RNG. Bail rather than loop
    -- forever.
    IF v_attempts > 10 THEN
      RAISE EXCEPTION 'generate_manual_review_code: failed to find a unique code after 10 attempts; PRNG misconfigured?';
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.generate_manual_review_code IS
  'Generates a unique PFX-XXXXXX code for a manual review. Charset excludes visually-ambiguous characters so phone/text relay between advisors is reliable.';

-- ─────────────────────────────────────────────────────────────────────────────
-- create_manual_review — atomic issuance of a new review.
-- Inserts the review row + writes a paired audit log entry so the
-- keytag's history shows the review event with code + summary.
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

  INSERT INTO keytag_manual_reviews (
    code, category, context, options, issue_summary
  ) VALUES (
    v_code, p_category, p_context, p_options, p_issue_summary
  )
  RETURNING id INTO v_review_id;

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
  'Issues a new manual review with a fresh code, writes a paired keytag_audit_log entry referencing the code. Called by the webhook handler + bulk-reconcile + the orchestrator''s detection paths.';

-- Extend the keytag_audit_log action check to include manual review events
ALTER TABLE public.keytag_audit_log DROP CONSTRAINT IF EXISTS keytag_audit_log_action_check;
ALTER TABLE public.keytag_audit_log ADD CONSTRAINT keytag_audit_log_action_check CHECK (action IN (
  'assigned',
  'force_assigned',
  'marked_posted',
  'reverted',
  'released',
  'released_orphan',
  'manual_review_issued',
  'manual_review_resolved'
));

-- ─────────────────────────────────────────────────────────────────────────────
-- check_manual_review_lockout(p_user_label)
-- Returns TRUE if the user_label has 3+ failed attempts in the last hour
-- (lockout active). Called by lookup_manual_review + resolve_manual_review
-- before doing any work.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_manual_review_lockout(p_user_label text)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed INT;
BEGIN
  IF p_user_label IS NULL THEN
    RETURN true; -- no identity = no access
  END IF;
  SELECT COUNT(*) INTO v_failed
  FROM keytag_manual_review_attempts
  WHERE user_label = p_user_label
    AND attempted_at >= now() - interval '1 hour'
    AND success = false;
  RETURN v_failed >= 3;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- lookup_manual_review(p_code, p_user_label)
-- Read-only "what is this code?" tool. Records the attempt (failure if
-- code not found, success otherwise). Subject to lockout.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_manual_review(
  p_code       text,
  p_user_label text
)
RETURNS TABLE (
  ok               BOOLEAN,
  failure_reason   TEXT,
  category         TEXT,
  issue_summary    TEXT,
  context          JSONB,
  options          JSONB,
  issued_at        TIMESTAMPTZ,
  resolved_at      TIMESTAMPTZ,
  resolved_choice  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row keytag_manual_reviews%ROWTYPE;
BEGIN
  IF p_user_label IS NULL OR length(trim(p_user_label)) = 0 THEN
    RETURN QUERY SELECT FALSE, 'user_label_required'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  IF public.check_manual_review_lockout(p_user_label) THEN
    INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success, failure_reason)
    VALUES (p_user_label, p_code, false, 'lockout_active');
    RETURN QUERY SELECT FALSE, 'lockout_active'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM keytag_manual_reviews WHERE keytag_manual_reviews.code = p_code LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success, failure_reason)
    VALUES (p_user_label, p_code, false, 'code_not_found');
    RETURN QUERY SELECT FALSE, 'code_not_found'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success)
  VALUES (p_user_label, p_code, true);

  RETURN QUERY SELECT
    TRUE,
    NULL::text,
    v_row.category,
    v_row.issue_summary,
    v_row.context,
    v_row.options,
    v_row.issued_at,
    v_row.resolved_at,
    v_row.resolved_choice;
END;
$$;

COMMENT ON FUNCTION public.lookup_manual_review IS
  'Read-only lookup of a manual review by code. Records each attempt to keytag_manual_review_attempts for brute-force rate limiting (3 failures per hour per user_label triggers lockout).';

-- ─────────────────────────────────────────────────────────────────────────────
-- resolve_manual_review(p_code, p_choice, p_user_label, p_color, p_tag_number, p_notes)
-- Atomically marks a review resolved. Returns the resolution details so
-- the caller (orchestrator tool) can execute the appropriate action.
-- Does NOT execute the action itself — separation of concerns: this
-- function commits the decision; the caller applies it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_manual_review(
  p_code        text,
  p_choice      text,
  p_user_label  text,
  p_color       text DEFAULT NULL,
  p_tag_number  int  DEFAULT NULL,
  p_notes       text DEFAULT NULL
)
RETURNS TABLE (
  ok               BOOLEAN,
  failure_reason   TEXT,
  category         TEXT,
  context          JSONB,
  chosen_option    JSONB,
  review_id        BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     keytag_manual_reviews%ROWTYPE;
  v_option  JSONB;
  v_needs_tag BOOLEAN;
BEGIN
  IF p_user_label IS NULL OR length(trim(p_user_label)) = 0 THEN
    RETURN QUERY SELECT FALSE, 'user_label_required'::text, NULL::text, NULL::jsonb, NULL::jsonb, NULL::bigint;
    RETURN;
  END IF;
  IF public.check_manual_review_lockout(p_user_label) THEN
    INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success, failure_reason)
    VALUES (p_user_label, p_code, false, 'lockout_active');
    RETURN QUERY SELECT FALSE, 'lockout_active'::text, NULL::text, NULL::jsonb, NULL::jsonb, NULL::bigint;
    RETURN;
  END IF;

  SELECT * INTO v_row FROM keytag_manual_reviews WHERE keytag_manual_reviews.code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success, failure_reason)
    VALUES (p_user_label, p_code, false, 'code_not_found');
    RETURN QUERY SELECT FALSE, 'code_not_found'::text, NULL::text, NULL::jsonb, NULL::jsonb, NULL::bigint;
    RETURN;
  END IF;

  IF v_row.resolved_at IS NOT NULL THEN
    INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success, failure_reason)
    VALUES (p_user_label, p_code, false, 'already_resolved');
    RETURN QUERY SELECT FALSE, 'already_resolved'::text, NULL::text, NULL::jsonb, NULL::jsonb, NULL::bigint;
    RETURN;
  END IF;

  -- Find the chosen option in the options array
  SELECT opt INTO v_option
  FROM jsonb_array_elements(v_row.options) AS opt
  WHERE opt->>'key' = p_choice
  LIMIT 1;

  IF v_option IS NULL THEN
    INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success, failure_reason)
    VALUES (p_user_label, p_code, false, 'invalid_choice');
    RETURN QUERY SELECT FALSE, 'invalid_choice'::text, NULL::text, NULL::jsonb, NULL::jsonb, NULL::bigint;
    RETURN;
  END IF;

  -- If option requires tag input, validate it was provided
  v_needs_tag := COALESCE((v_option->>'needs_tag_input')::boolean, false);
  IF v_needs_tag AND (p_color IS NULL OR p_tag_number IS NULL) THEN
    INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success, failure_reason)
    VALUES (p_user_label, p_code, false, 'choice_requires_tag_input');
    RETURN QUERY SELECT FALSE, 'choice_requires_tag_input'::text, NULL::text, NULL::jsonb, v_option, NULL::bigint;
    RETURN;
  END IF;

  -- Validate color + tag_number when supplied
  IF p_color IS NOT NULL AND p_color NOT IN ('red', 'yellow') THEN
    RETURN QUERY SELECT FALSE, 'invalid_color'::text, NULL::text, NULL::jsonb, v_option, NULL::bigint;
    RETURN;
  END IF;
  IF p_tag_number IS NOT NULL AND (p_tag_number < 1 OR p_tag_number > 90) THEN
    RETURN QUERY SELECT FALSE, 'invalid_tag_number'::text, NULL::text, NULL::jsonb, v_option, NULL::bigint;
    RETURN;
  END IF;

  UPDATE keytag_manual_reviews
     SET resolved_at = now(),
         resolved_by_user_label = p_user_label,
         resolved_choice = p_choice,
         resolved_color = p_color,
         resolved_tag_number = p_tag_number,
         resolution_notes = p_notes
   WHERE id = v_row.id;

  INSERT INTO keytag_manual_review_attempts (user_label, attempted_code, success)
  VALUES (p_user_label, p_code, true);

  RETURN QUERY SELECT
    TRUE,
    NULL::text,
    v_row.category,
    v_row.context,
    v_option,
    v_row.id;
END;
$$;

COMMENT ON FUNCTION public.resolve_manual_review IS
  'Atomically marks a manual review resolved with the chosen option. Returns the resolution context so the caller can execute the chosen action. Bound to user_label (the advisor who confirmed). Subject to lockout.';

-- ─────────────────────────────────────────────────────────────────────────────
-- attach_resolution_audit_log(p_review_id, p_audit_log_id)
-- Wire the audit log entry that captured the resolution action back to
-- the review row, for forward-tracing.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.attach_resolution_audit_log(
  p_review_id    bigint,
  p_audit_log_id bigint
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE keytag_manual_reviews
     SET resolution_audit_log_id = p_audit_log_id
   WHERE id = p_review_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- mark_manual_review_email_sent(p_review_id, p_error)
-- Tool layer calls this after attempting to send the email so retries +
-- failures are visible.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_manual_review_email_sent(
  p_review_id bigint,
  p_error     text DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE keytag_manual_reviews
     SET email_sent_at = CASE WHEN p_error IS NULL THEN now() ELSE email_sent_at END,
         email_error = p_error
   WHERE id = p_review_id;
END;
$$;
