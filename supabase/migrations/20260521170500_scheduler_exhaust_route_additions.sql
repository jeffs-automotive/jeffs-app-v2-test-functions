-- =====================================================================
-- Scheduler — fan out 2 existing subcategories to exhaust_system_testing
-- =====================================================================
-- 2026-05-21, follow-on to 20260521170000_scheduler_exhaust_subcategories.sql.
--
-- Adds `exhaust_system_testing` to the eligible_testing_service_keys list
-- on 2 existing subcategories that semantically also reach the new
-- exhaust service:
--
--   1. noise/rattling_underneath_the_car
--      — already routes to suspension_steering_check. The subcategory's
--      description names "loose heat shields, a failing catalytic
--      converter (with broken internals), or loose exhaust hangers" as
--      common causes; all three are exhaust-system issues. Fan-out lets
--      the diagnostic LLM choose the right Stage-1 service from the
--      customer's wording.
--   2. smell/exhaust_fumes_inside_the_cabin
--      — already routes to check_engine_light_testing. Exhaust fumes in
--      the cabin frequently come from an exhaust breach (manifold,
--      flex pipe, downpipe, or muffler), which is exactly what
--      exhaust_system_testing inspects.
--
-- Both rows keep their existing service_keys; this migration only
-- APPENDS exhaust_system_testing. Order is preserved (the existing
-- service goes first; exhaust_system_testing is appended).
--
-- IDEMPOTENT: the UPDATE is guarded with NOT (... @> ARRAY['exhaust_system_testing']),
-- so re-running is a no-op once exhaust_system_testing is in the list.

BEGIN;

UPDATE public.concern_subcategories
SET eligible_testing_service_keys =
  eligible_testing_service_keys || ARRAY['exhaust_system_testing']::TEXT[]
WHERE shop_id = 7476
  AND category = 'noise'
  AND slug = 'rattling_underneath_the_car'
  AND NOT (eligible_testing_service_keys @> ARRAY['exhaust_system_testing']::TEXT[]);

UPDATE public.concern_subcategories
SET eligible_testing_service_keys =
  eligible_testing_service_keys || ARRAY['exhaust_system_testing']::TEXT[]
WHERE shop_id = 7476
  AND category = 'smell'
  AND slug = 'exhaust_fumes_inside_the_cabin'
  AND NOT (eligible_testing_service_keys @> ARRAY['exhaust_system_testing']::TEXT[]);

COMMIT;
