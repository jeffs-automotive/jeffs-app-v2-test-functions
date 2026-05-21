-- =====================================================================
-- Scheduler — subcategory → testing-service mapping (1:N)
-- =====================================================================
-- 2026-05-20. Adds an explicit subcategory → testing_service mapping
-- column on concern_subcategories so the diagnostic LLM can route
-- ABS / CEL / traction / SES / SRS / EPS / oil-pressure / engine-temp
-- warning lights (and any future fine-grained subcategory) to a SPECIFIC
-- testing_service instead of falling back to warning_light_general.
--
-- WHAT THIS ADDS:
--   1. concern_subcategories.eligible_testing_service_keys TEXT[]
--      NOT NULL DEFAULT '{}'. When non-empty, the catalog loader uses
--      this list as the ONLY eligibility signal — testing_services'
--      concern_categories[] is ignored for THIS subcategory. When empty,
--      the loader falls back to the existing concern_categories[]
--      behavior (backward-compat — no upload required to keep current
--      routing).
--   2. GIN index on the new column so the catalog loader's reverse
--      query (`WHERE service_key = ANY(eligible_testing_service_keys)`)
--      is O(log n) instead of O(n).
--
-- CARDINALITY: 1:N. One subcategory can be eligible under multiple
-- services (e.g., engine_temperature_light might be reachable from both
-- coolant_leak_testing AND check_engine_light_testing — the LLM picks
-- the right one based on description wording). Validated at upload
-- time, not at the DB level (no FK enforcement on array elements).
--
-- BACKWARD COMPATIBILITY:
--   - DEFAULT '{}' means every existing row keeps the current behavior
--     until explicitly mapped via upload_subcategory_service_map_md.
--   - Partial mapping is fine. An unmapped subcategory falls back to
--     concern_categories[] resolution (the current behavior, unchanged).
--
-- IDEMPOTENT: re-applying is safe — `ADD COLUMN IF NOT EXISTS` +
-- `CREATE INDEX IF NOT EXISTS`.

BEGIN;

ALTER TABLE public.concern_subcategories
  ADD COLUMN IF NOT EXISTS eligible_testing_service_keys TEXT[]
    NOT NULL DEFAULT '{}'::TEXT[];

CREATE INDEX IF NOT EXISTS concern_subcategories_eligible_services_idx
  ON public.concern_subcategories
  USING GIN (eligible_testing_service_keys);

COMMENT ON COLUMN public.concern_subcategories.eligible_testing_service_keys IS
  'Explicit subcategory → testing_service mapping (1:N). When non-empty, the diagnostic catalog loader uses this list as the ONLY eligibility signal for this subcategory — testing_services.concern_categories[] is ignored. When empty (the default), the loader falls back to concern_categories[] resolution (subcategory is eligible under every service whose concern_categories[] includes the subcategory''s parent category). Validated at upload time via upload_subcategory_service_map_md; not enforced at the DB level since Postgres has no FK constraint on array elements.';

COMMIT;
