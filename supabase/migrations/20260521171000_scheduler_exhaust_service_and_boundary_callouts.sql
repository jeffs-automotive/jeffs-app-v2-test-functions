-- =====================================================================
-- Scheduler — exhaust_system_testing service + 5 boundary callouts
-- =====================================================================
-- 2026-05-21, follow-on to 20260521170000_scheduler_exhaust_subcategories.sql
-- + 20260521170500_scheduler_exhaust_route_additions.sql.
--
-- WHAT THIS DOES:
--   1. INSERTS a new testing_services row for `exhaust_system_testing`
--      at $39.99 (matches the existing Tekmetric canned_job for exhaust
--      evaluation). Without this row the 4 subcategories mapped to
--      exhaust_system_testing (the 2 new ones + rattling_underneath_the_car
--      + exhaust_fumes_inside_the_cabin) would be orphans — the catalog
--      loader needs the testing_services row to register the
--      TestingServiceCategory for Stage-1 picking.
--
--   2. UPDATES the description field on 5 existing testing_services
--      rows to append Stage-1 boundary callouts. These prevent the
--      Stage-1 LLM from mis-routing 5 specific concern patterns
--      identified in the batch 12-17 audit:
--        - ac_performance_check      — routes heater-cold concerns to
--          coolant_leak_testing instead of itself
--        - coolant_leak_testing      — routes blue/gray tailpipe smoke
--          to check_engine_light_testing (oil burn), and routes musty
--          vent smell to ac_performance_check (HVAC, not cooling)
--        - oil_leak_testing          — routes exhaust manifold gasket
--          concerns to exhaust_system_testing (new)
--        - suspension_steering_check — routes brake-induced vibration
--          to brake_inspection, and vent-shake from blower to
--          ac_performance_check
--        - window_inop_testing       — routes power seats/sunroofs/
--          mirrors to electrical_testing_general
--
-- These callouts mirror the same edits Chris made to
-- docs/chat-instructions/scheduler/templates/testing-services.md;
-- applying both keeps the MD source-of-truth and the DB in sync without
-- waiting for a manual Claude Desktop upload.
--
-- IDEMPOTENT:
--   - INSERT uses ON CONFLICT (shop_id, service_key) DO NOTHING (the
--     existing UNIQUE constraint key).
--   - UPDATEs only fire when the new description text isn't already
--     in the column (guarded by NOT (description LIKE '%Scope:%')).

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Seed exhaust_system_testing
-- ---------------------------------------------------------------------

INSERT INTO public.testing_services (
  shop_id,
  service_key,
  display_name,
  abbreviation,
  starting_price_cents,
  notes,
  concern_categories,
  active,
  description,
  example_keywords
)
VALUES (
  7476,
  'exhaust_system_testing',
  'Exhaust system evaluation',
  'EXH SYS EVAL',
  3999,
  'Exhaust evaluation is $39.99. If a repair is needed and approved, the evaluation fee is waived.',
  ARRAY['noise', 'smell', 'performance']::TEXT[],
  TRUE,
  'The technician will inspect the exhaust system from manifold to tailpipe — checking the exhaust manifold and gaskets, downpipe, flex pipe, catalytic converter, resonator, muffler, tailpipe, and hangers — for leaks, cracks, rust-through, broken internals (rattle), and loose mounts. A road test or under-hood listening test may be performed to localize a tick, puff, or louder-than-normal exhaust sound. Scope: exhaust components specifically — exhaust manifold gasket leaks (ticking sound from engine bay that quiets when warm), louder-than-normal exhaust, rattle from catalytic converter, exhaust hanger noise, and exhaust fumes entering the cabin from an exhaust breach. NOT for blue/gray tailpipe smoke (oil burn — route to check_engine_light_testing) and NOT for sweet smell with overheating (coolant — route to coolant_leak_testing).',
  NULL
)
ON CONFLICT (shop_id, service_key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. ac_performance_check boundary callout
-- ---------------------------------------------------------------------

UPDATE public.testing_services
SET description =
  'The technician will check A/C performance by measuring vent temperature and verifying blower, mode, and cooling fan operation, checking system pressures if needed. They will also inspect for leaks and check related belts and pulleys. Scope: AC cooling, blower/mode operation, and vent-side HVAC complaints (weak airflow, musty smell from vents, one zone vs another). If the customer reports the HEATER blowing cold or weak heat — that''s a coolant/HVAC heat issue and routes to coolant_leak_testing, not here.'
WHERE shop_id = 7476
  AND service_key = 'ac_performance_check'
  AND description NOT LIKE '%Scope:%';

-- ---------------------------------------------------------------------
-- 3. coolant_leak_testing boundary callout
-- ---------------------------------------------------------------------

UPDATE public.testing_services
SET description =
  'The technician will inspect the cooling system and perform a pressure test to check for external leaks at hoses, clamps, radiator, water pump, and related components. They''ll also verify fan operation, thermostat function, and coolant circulation, and may perform a block test to check for internal engine issues. Scope: cooling-system concerns — puddles of coolant under the car, sweet/syrup smell, overheating, steam from under the hood, WHITE smoke from the tailpipe, and heater-blowing-cold (low-coolant or thermostat-related). NOT for BLUE or GRAY smoke from the tailpipe (that''s an oil burn — route to check_engine_light_testing) and NOT for musty smell from vents (that''s HVAC — route to ac_performance_check).'
WHERE shop_id = 7476
  AND service_key = 'coolant_leak_testing'
  AND description NOT LIKE '%Scope:%';

-- ---------------------------------------------------------------------
-- 4. oil_leak_testing boundary callout
-- ---------------------------------------------------------------------

UPDATE public.testing_services
SET description =
  'The technician will inspect the engine and surrounding components for oil leaks, focusing on common areas like valve covers, gaskets, seals, and the oil pan. The vehicle will be brought to operating temperature and the underside/splash shields will be rechecked for fresh oil residue or buildup. Scope: oil leaks specifically — visible oil drips/puddles, burnt-oil smell from the engine bay, oil residue on the underbody. If the customer describes an EXHAUST manifold gasket, exhaust leak, or louder-than-normal exhaust — that''s exhaust_system_testing, not oil_leak_testing. Coolant puddles route to coolant_leak_testing.'
WHERE shop_id = 7476
  AND service_key = 'oil_leak_testing'
  AND description NOT LIKE '%Scope:%';

-- ---------------------------------------------------------------------
-- 5. suspension_steering_check boundary callout
-- ---------------------------------------------------------------------

UPDATE public.testing_services
SET description =
  'The technician will inspect the steering and suspension components for wear, damage, looseness, and leaks, including joints, tie rods, control arms, bushings, and shocks/struts. Tires will be checked for uneven wear and a road test may be performed to verify ride quality, steering response, and handling. Scope: steering/suspension/tire-related shakes, pulls, drifts, clunks, and uneven tire wear. NOT for vibration that happens ONLY when braking (route to brake_inspection — that''s a brake-rotor or caliper issue, not suspension) and NOT for vents/dashboard physically shaking from blower airflow (route to ac_performance_check — that''s HVAC blower).'
WHERE shop_id = 7476
  AND service_key = 'suspension_steering_check'
  AND description NOT LIKE '%Scope:%';

-- ---------------------------------------------------------------------
-- 6. window_inop_testing boundary callout
-- ---------------------------------------------------------------------

UPDATE public.testing_services
SET description =
  'Window diagnosis: switch, motor, regulator, or wiring. Includes tear-down for inspection. Scope: power-window glass motion ONLY — window won''t go up/down, only works sometimes, makes grinding noise during travel. NOT for power seats, sunroofs/moonroofs, side mirrors, door locks, or other power accessories — those route to electrical_testing_general.'
WHERE shop_id = 7476
  AND service_key = 'window_inop_testing'
  AND description NOT LIKE '%Scope:%';

COMMIT;
