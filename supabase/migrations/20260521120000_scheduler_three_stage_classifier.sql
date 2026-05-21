-- =====================================================================
-- Scheduler — 3-stage diagnostic LLM classifier support columns
-- =====================================================================
-- 2026-05-21. Adds the per-subcategory + per-question metadata the
-- 3-stage diagnostic LLM classifier needs in order to (a) pick the
-- right subcategory from a customer utterance, (b) extract the right
-- facts, and (c) know when a question's required facts are present.
--
-- WHAT THIS ADDS:
--
--   concern_subcategories (4 new columns):
--     1. description TEXT NOT NULL DEFAULT ''
--        Long-form (2-3 sentence) subcategory description shown to the
--        LLM during stage-1 (subcategory selection). Empty default keeps
--        the migration non-breaking; advisors fill it in via the new
--        upload tool. An empty description means the LLM falls back to
--        the subcategory slug + parent category for context (degraded
--        but functional).
--     2. positive_examples TEXT[] NOT NULL DEFAULT '{}'
--        Sample customer utterances that SHOULD match this subcategory.
--        Used as few-shot exemplars in the stage-1 classifier prompt.
--     3. negative_examples TEXT[] NOT NULL DEFAULT '{}'
--        Sample utterances that should NOT match this subcategory
--        (boundary cases — e.g., "noise when braking" matches brake
--        subcategories but NOT suspension subcategories, even though
--        both involve noise). Used to sharpen subcategory boundaries.
--     4. synonyms TEXT[] NOT NULL DEFAULT '{}'
--        Alt phrasings the customer might use ("AC", "air con",
--        "climate control"). Used for embedding-similarity boosts +
--        keyword pre-filtering before the LLM call.
--
--   concern_questions (1 new column):
--     5. required_facts TEXT[] NOT NULL DEFAULT '{}'
--        List of ExtractedFacts slot names (e.g.,
--        ARRAY['speed_specific_mph'] or ARRAY['hvac_mode',
--        'smell_descriptor']) that must be present in the LLM's
--        extracted facts for the question to count as "answered."
--        Empty default = no fact gating (question is treated as
--        answered if the LLM marks it answered by free-text).
--
-- INDEXES: none added. The new columns are read in bulk (full-row
-- scans for ~105 subcategories and ~729 questions) by the catalog
-- loader at startup; there is no per-element membership query against
-- positive_examples, negative_examples, synonyms, or required_facts.
-- The existing PK + (shop_id, category, slug) unique constraint on
-- concern_subcategories and the existing PK + FK on concern_questions
-- already cover every access pattern. GIN indexes would be dead
-- weight here — skipped intentionally.
--
-- BACKWARD COMPATIBILITY:
--   - All new columns are NOT NULL DEFAULT '' or '{}', so existing
--     rows fill in with safe empty values. No application code that
--     reads these columns will see NULL.
--   - The classifier degrades gracefully when columns are empty:
--     missing description → slug + category used as LLM context;
--     missing examples → no few-shot exemplars (zero-shot only);
--     missing synonyms → no keyword pre-filter (LLM-only matching);
--     missing required_facts → no fact gating (answer-by-free-text).
--
-- RLS:
--   - No policy changes. The existing `deny_all` policy on both
--     tables stays. Service-role bypasses RLS, which is the only
--     caller path for the catalog loader + upload tool.
--
-- IDEMPOTENT: re-applying is safe — every column uses
-- `ADD COLUMN IF NOT EXISTS`.
--
-- ROLLBACK: drop the columns individually. No data migration is
-- needed since defaults are empty. Example:
--   ALTER TABLE public.concern_subcategories
--     DROP COLUMN IF EXISTS description,
--     DROP COLUMN IF EXISTS positive_examples,
--     DROP COLUMN IF EXISTS negative_examples,
--     DROP COLUMN IF EXISTS synonyms;
--   ALTER TABLE public.concern_questions
--     DROP COLUMN IF EXISTS required_facts;

BEGIN;

-- ---------------------------------------------------------------------
-- concern_subcategories: stage-1 (subcategory selection) metadata
-- ---------------------------------------------------------------------

ALTER TABLE public.concern_subcategories
  ADD COLUMN IF NOT EXISTS description TEXT
    NOT NULL DEFAULT '';

ALTER TABLE public.concern_subcategories
  ADD COLUMN IF NOT EXISTS positive_examples TEXT[]
    NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE public.concern_subcategories
  ADD COLUMN IF NOT EXISTS negative_examples TEXT[]
    NOT NULL DEFAULT '{}'::TEXT[];

ALTER TABLE public.concern_subcategories
  ADD COLUMN IF NOT EXISTS synonyms TEXT[]
    NOT NULL DEFAULT '{}'::TEXT[];

COMMENT ON COLUMN public.concern_subcategories.description IS
  'Long-form (2-3 sentence) subcategory description shown to the 3-stage diagnostic LLM during stage-1 (subcategory selection from a customer utterance). NOT NULL DEFAULT '''' keeps the migration non-breaking — advisors fill it in via the catalog-upload tool. When empty, the classifier falls back to the subcategory slug + parent category name for LLM context (degraded but functional).';

COMMENT ON COLUMN public.concern_subcategories.positive_examples IS
  'Sample customer utterances that SHOULD match this subcategory. Used as few-shot exemplars in the stage-1 classifier prompt to sharpen subcategory selection. Empty array = zero-shot classification (LLM relies on description + slug only).';

COMMENT ON COLUMN public.concern_subcategories.negative_examples IS
  'Sample customer utterances that should NOT match this subcategory (boundary cases — e.g., a brake-noise subcategory might list suspension-noise utterances here to prevent cross-matching). Used to sharpen subcategory boundaries in the stage-1 classifier prompt. Empty array = no negative examples are shown to the LLM.';

COMMENT ON COLUMN public.concern_subcategories.synonyms IS
  'Alt phrasings the customer might use (e.g., ARRAY[''AC'', ''air con'', ''climate control'']). Used for embedding-similarity boosts and keyword pre-filtering before the stage-1 LLM call. Empty array = no synonym matching (LLM-only).';

-- ---------------------------------------------------------------------
-- concern_questions: stage-3 (question-answered gate) fact-slot list
-- ---------------------------------------------------------------------

ALTER TABLE public.concern_questions
  ADD COLUMN IF NOT EXISTS required_facts TEXT[]
    NOT NULL DEFAULT '{}'::TEXT[];

COMMENT ON COLUMN public.concern_questions.required_facts IS
  'List of ExtractedFacts slot names (e.g., ARRAY[''speed_specific_mph''] or ARRAY[''hvac_mode'', ''smell_descriptor'']) that must be present in the LLM''s extracted facts for this question to count as "answered" by the stage-3 question-gate. Empty array = no fact gating (question is treated as answered if the LLM marks it answered via free-text). NOT NULL DEFAULT ''{}'' keeps the migration non-breaking — advisors fill it in via the catalog-upload tool per question.';

COMMIT;
