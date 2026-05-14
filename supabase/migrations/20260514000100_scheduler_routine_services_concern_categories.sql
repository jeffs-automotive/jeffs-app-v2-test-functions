-- =====================================================================
-- Scheduler — routine_services.concern_categories (Phase 9a, 2026-05-14)
-- =====================================================================
-- Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign
-- decision D1: both routine and testing service routes flow through the
-- SAME questionnaire / gap-detection LLM. The routine row's category
-- determines which questionnaire + guideline to load.
--
-- Adds the same shape testing_services already has — concern_categories
-- TEXT[] — so a single resolveServiceCategory() helper can read either
-- table with one branch. Phase 9a seeds the 5 rows currently flagged
-- requires_explanation=true with their best-fit category mapping:
--
--   brake_inspection  → brakes
--   check_battery     → electrical
--   warning_lights    → warning_light
--   check_suspension  → steering    (most steering-coupled symptoms surface
--                                    here; if a future suspension-only
--                                    category gets added, re-seed)
--   check_ac          → hvac
--
-- Other routine rows (oil_change, tire_rotate, etc.) stay NULL — they
-- don't trigger the explanation flow.

BEGIN;

ALTER TABLE public.routine_services
  ADD COLUMN IF NOT EXISTS concern_categories TEXT[];

CREATE INDEX IF NOT EXISTS routine_services_categories_idx
  ON public.routine_services USING GIN (concern_categories);

COMMENT ON COLUMN public.routine_services.concern_categories IS
  'Maps a routine_service to one or more concern_questions categories so the diagnostic gap-detection LLM can load the right guideline + questionnaire when a customer picks a routine chip that requires_explanation=true. Mirrors testing_services.concern_categories shape. NULL for routine rows that do not require an explanation.';

-- ---------------------------------------------------------------------
-- Seed the 5 requires_explanation=true rows for shop_id=7476.
-- Idempotent: only writes when concern_categories IS NULL OR the array
-- doesn't already cover the new category (defensive — admin MD-uploads
-- in the future shouldn't be silently overwritten by a re-applied
-- migration).
-- ---------------------------------------------------------------------

UPDATE public.routine_services
SET concern_categories = ARRAY['brakes']::TEXT[]
WHERE shop_id = 7476
  AND service_key = 'brake_inspection'
  AND (concern_categories IS NULL OR NOT ('brakes' = ANY (concern_categories)));

UPDATE public.routine_services
SET concern_categories = ARRAY['electrical']::TEXT[]
WHERE shop_id = 7476
  AND service_key = 'check_battery'
  AND (concern_categories IS NULL OR NOT ('electrical' = ANY (concern_categories)));

UPDATE public.routine_services
SET concern_categories = ARRAY['warning_light']::TEXT[]
WHERE shop_id = 7476
  AND service_key = 'warning_lights'
  AND (concern_categories IS NULL OR NOT ('warning_light' = ANY (concern_categories)));

UPDATE public.routine_services
SET concern_categories = ARRAY['steering']::TEXT[]
WHERE shop_id = 7476
  AND service_key = 'check_suspension'
  AND (concern_categories IS NULL OR NOT ('steering' = ANY (concern_categories)));

UPDATE public.routine_services
SET concern_categories = ARRAY['hvac']::TEXT[]
WHERE shop_id = 7476
  AND service_key = 'check_ac'
  AND (concern_categories IS NULL OR NOT ('hvac' = ANY (concern_categories)));

COMMIT;
