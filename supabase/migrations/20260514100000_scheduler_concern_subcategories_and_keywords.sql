-- =====================================================================
-- Scheduler — concern sub-categories + testing-service keywords
-- =====================================================================
-- Phase 9b, 2026-05-14. Per chat-design.md "Architecture amendment —
-- 2026-05-14" §Step 7 redesign + the 14 concern-checklist drafts in
-- dotfiles/jeffs-app-v2-test-data/.claude/work/planning/references/concerns/
--
-- WHAT THIS ADDS:
--   1. concern_subcategories — per-category symptom sub-types (e.g. for
--      "brakes": "High-Pitched Squealing", "Metallic Grinding", etc.).
--      Each concern_questions row will be FK-linked to one sub-category;
--      the diagnostic LLM classifies a description to a sub-category
--      first, then loads ONLY that sub-category's questionnaire for
--      gap-detection.
--   2. concern_questions.subcategory_id — FK to the new table. Existing
--      seeded questions get backfilled into a "General" sub-category
--      per category, so nothing breaks.
--   3. testing_services.example_keywords TEXT[] — example customer
--      phrases that should map to this testing service in the "Describe
--      Concern" free-text recommendation path. Populated from
--      diagnostic-services.md.
--
-- BACKWARD COMPATIBILITY:
--   - concern_questions.category column stays (denormalized for query
--     speed + read paths in Phase 9a code). The upload tool keeps
--     category and subcategory.category in sync.
--   - The old UNIQUE (shop_id, category, question_text) constraint is
--     replaced by UNIQUE (shop_id, subcategory_id, question_text) so
--     similar question text can appear in multiple sub-categories
--     (e.g., "Have you had brake work done recently?" appears in both
--     Squealing AND Grinding sub-categories of brakes).
--
-- IDEMPOTENT: re-applying is safe — IF NOT EXISTS on the table create,
-- IF NOT EXISTS on the column add, idempotent backfill, conditional
-- constraint drop/add.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. concern_subcategories table
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.concern_subcategories (
  id              BIGSERIAL    PRIMARY KEY,
  shop_id         INTEGER      NOT NULL,
  category        TEXT         NOT NULL CHECK (category IN (
                                  'noise',
                                  'vibration',
                                  'pulling',
                                  'smell',
                                  'smoke',
                                  'leak',
                                  'warning_light',
                                  'performance',
                                  'electrical',
                                  'hvac',
                                  'brakes',
                                  'steering',
                                  'tires',
                                  'other'
                                )),
  slug            TEXT         NOT NULL,
  display_label   TEXT         NOT NULL,
  display_order   INTEGER      NOT NULL DEFAULT 0,
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_by_oauth_client_id TEXT,
  updated_by_name TEXT,
  UNIQUE (shop_id, category, slug)
);

CREATE INDEX IF NOT EXISTS concern_subcategories_lookup_idx
  ON public.concern_subcategories(shop_id, category, active, display_order);

ALTER TABLE public.concern_subcategories ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'concern_subcategories'
      AND policyname = 'deny_all'
  ) THEN
    CREATE POLICY "deny_all" ON public.concern_subcategories
      FOR ALL TO public USING (false);
  END IF;
END $$;

COMMENT ON TABLE public.concern_subcategories IS
  'Per-category symptom sub-types for the diagnostic flow. Each row maps to a "-- {name} Checklist --" block in the corresponding concern MD doc. The LLM classifies a customer description to a sub-category first, then loads ONLY that sub-category''s questionnaire for gap-detection. Authored as MD docs in dotfiles/jeffs-app-v2-test-data/.claude/work/planning/references/concerns/{category}/{category}-concerns.md; uploaded via the upload_concern_category_md MCP tool.';

-- ---------------------------------------------------------------------
-- 2. concern_questions.subcategory_id FK
-- ---------------------------------------------------------------------

ALTER TABLE public.concern_questions
  ADD COLUMN IF NOT EXISTS subcategory_id BIGINT
    REFERENCES public.concern_subcategories(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS concern_questions_subcategory_idx
  ON public.concern_questions(subcategory_id, active, display_order);

-- ---------------------------------------------------------------------
-- 3. Backfill: create a "General" sub-category per existing (shop,category)
--    and link all existing questions there. Idempotent.
-- ---------------------------------------------------------------------

INSERT INTO public.concern_subcategories
  (shop_id, category, slug, display_label, display_order, active)
SELECT DISTINCT
  cq.shop_id,
  cq.category,
  'general',
  'General',
  0,
  TRUE
FROM public.concern_questions cq
WHERE cq.subcategory_id IS NULL
ON CONFLICT (shop_id, category, slug) DO NOTHING;

UPDATE public.concern_questions cq
SET subcategory_id = cs.id
FROM public.concern_subcategories cs
WHERE cq.subcategory_id IS NULL
  AND cs.shop_id = cq.shop_id
  AND cs.category = cq.category
  AND cs.slug = 'general';

-- ---------------------------------------------------------------------
-- 4. Lock subcategory_id NOT NULL after backfill
-- ---------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'concern_questions'
      AND column_name = 'subcategory_id'
      AND is_nullable = 'YES'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.concern_questions WHERE subcategory_id IS NULL
  ) THEN
    ALTER TABLE public.concern_questions
      ALTER COLUMN subcategory_id SET NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5. Swap unique constraints: drop (shop_id, category, question_text);
--    add (shop_id, subcategory_id, question_text). Lets duplicate
--    question text live across sub-categories (e.g., "Have you had
--    brake work done recently?" in both Squealing AND Grinding).
-- ---------------------------------------------------------------------

ALTER TABLE public.concern_questions
  DROP CONSTRAINT IF EXISTS concern_questions_shop_category_text_uniq;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'concern_questions_shop_subcategory_text_uniq'
      AND conrelid = 'public.concern_questions'::regclass
  ) THEN
    ALTER TABLE public.concern_questions
      ADD CONSTRAINT concern_questions_shop_subcategory_text_uniq
        UNIQUE (shop_id, subcategory_id, question_text);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6. testing_services.example_keywords (Path B classification source)
-- ---------------------------------------------------------------------

ALTER TABLE public.testing_services
  ADD COLUMN IF NOT EXISTS example_keywords TEXT[];

CREATE INDEX IF NOT EXISTS testing_services_keywords_idx
  ON public.testing_services USING GIN (example_keywords);

COMMENT ON COLUMN public.testing_services.example_keywords IS
  'Example customer phrases that should map to this testing service in the "Describe Concern" free-text recommendation path (e.g. ["dead battery", "need a jump", "slow crank"] for battery_test). Used by the LLM to choose which testing services to recommend when a customer types a free-form concern. Sourced from diagnostic-services.md; service advisors edit via upsert_testing_service or the uploadTestingServicesMd path.';

COMMIT;
