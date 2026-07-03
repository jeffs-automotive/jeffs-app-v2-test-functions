-- HVAC heating-ownership scope correction (act-or-ask Stage-1 iteration, 2026-07-03)
--
-- The final-baseline eval showed heating complaints ("heat doesn't work",
-- "heat blowing cold") mis-routing to coolant_leak_testing. The 3-family
-- consensus assigns heater complaints to ac_performance_check (it owns the
-- vent-side / HVAC surface, including the heat_doesnt_work subcategory).
--
-- The LIVE ac_performance_check.description currently does the OPPOSITE — its
-- last sentence explicitly routes "HEATER blowing cold or weak heat" to
-- coolant_leak_testing. That sentence is the direct cause of the misroute.
-- This migration:
--   1. Removes that contradicting "routes to coolant_leak_testing" sentence
--      (idempotent — only when present), and
--   2. Appends an explicit heater-ownership callout, and
--   3. Seeds ac_performance_check.example_keywords with heat terms when empty
--      (so the Stage-1 catalog `keywords:` line carries heater vocabulary).
--
-- Scope: Jeff's shop (shop_id 7476) — matches the rest of the scheduler
-- catalog seed migrations. Idempotent via guarded predicates.

BEGIN;

-- 1. Strip the sentence that (wrongly) sends heater complaints to
--    coolant_leak_testing. Guarded so re-running is a no-op.
UPDATE public.testing_services
SET description = trim(
      replace(
        description,
        ' If the customer reports the HEATER blowing cold or weak heat — that''s a coolant/HVAC heat issue and routes to coolant_leak_testing, not here.',
        ''
      )
    ),
    updated_at = now()
WHERE shop_id = 7476
  AND service_key = 'ac_performance_check'
  AND description LIKE '%routes to coolant_leak_testing, not here.%';

-- 2. Append the heater-ownership callout. Guarded on the sentinel phrase so
--    the append happens at most once.
UPDATE public.testing_services
SET description = description || ' Includes heater complaints — no heat, weak heat, heat blowing cold (this is the HVAC heat surface). NOT coolant leaks (visible coolant puddle, sweet smell, overheating route to coolant_leak_testing).',
    updated_at = now()
WHERE shop_id = 7476
  AND service_key = 'ac_performance_check'
  AND description NOT LIKE '%Includes heater complaints%';

-- 3. Seed heat-related example_keywords for ac_performance_check only when the
--    column is currently NULL or empty (don't clobber advisor edits).
UPDATE public.testing_services
SET example_keywords = ARRAY[
      'no heat', 'weak heat', 'heat blows cold', 'heater blows cold',
      'heater not working', 'heat not working', 'heat doesn''t work',
      'cold air from heater', 'takes forever to warm up', 'slow to warm',
      'defroster not warming', 'blower', 'weak airflow', 'AC not cold',
      'AC blows warm', 'musty smell from vents'
    ],
    updated_at = now()
WHERE shop_id = 7476
  AND service_key = 'ac_performance_check'
  AND (example_keywords IS NULL OR cardinality(example_keywords) = 0);

COMMIT;
