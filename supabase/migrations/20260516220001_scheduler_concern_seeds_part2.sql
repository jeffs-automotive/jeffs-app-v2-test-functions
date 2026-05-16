-- =====================================================================
-- Scheduler concern subcategory + question seed — PART 2
-- =====================================================================
-- Created 2026-05-16 per R6-C-1 BLOCKER (continuation).
--
-- Background: this is the second half of the concern category seed work
-- started by migration 20260516210000 (brakes). The diagnostic flow
-- (chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign)
-- does a two-stage LLM call:
--
--   Stage 1 — subcategory filter: given the customer's description,
--             pick which symptom-bucket subcategories match.
--   Stage 2 — gap detection: from the matched subcategories' questions,
--             drop the ones the description already answered.
--
-- Migration 20260514100000 only created a "general" subcategory per
-- (shop, category) as a backfill. Real subcategories must be seeded
-- per the docs/scheduler/concerns/{category}/{category}-concerns.md
-- spec for the LLM filter to have anything to filter on.
--
-- This migration seeds 7 categories (52 subcategories, 363 questions):
--   - pulling          (6 subs, 42 questions)
--   - smell            (8 subs, 56 questions)
--   - smoke            (6 subs, 42 questions)
--   - steering         (7 subs, 49 questions)
--   - tires            (7 subs, 49 questions)
--   - vibration        (6 subs, 42 questions)
--   - warning_light    (12 subs, 83 questions)
--
-- Idempotent re-apply:
--   - Subcategory inserts use ON CONFLICT (shop_id, category, slug)
--   - Question inserts use ON CONFLICT (shop_id, category, question_text)
-- =====================================================================

BEGIN;


-- ---------------------------------------------------------------------
-- 1. Insert 52 subcategories across 7 categories
-- ---------------------------------------------------------------------

INSERT INTO public.concern_subcategories
  (shop_id, category, slug, display_label, display_order, active)
VALUES
  -- ── pulling (6) ──────────────────────────────────────────────────
  (7476, 'pulling', 'pulling_only_when_braking',              'Pulling only when braking',                  1, TRUE),
  (7476, 'pulling', 'steady_drift_while_cruising',            'Steady drift while cruising',                2, TRUE),
  (7476, 'pulling', 'pulling_only_during_acceleration',       'Pulling only during acceleration',           3, TRUE),
  (7476, 'pulling', 'drift_that_follows_the_roads_slope',     'Drift that follows the road''s slope',       4, TRUE),
  (7476, 'pulling', 'pull_after_recent_tire_or_service_work', 'Pull that started after recent tire or service work', 5, TRUE),
  (7476, 'pulling', 'wandering_or_drifting_in_both_directions','Wandering or drifting in both directions',  6, TRUE),

  -- ── smell (8) ────────────────────────────────────────────────────
  (7476, 'smell', 'sweet_smell',                  'Sweet smell (maple syrup / antifreeze)',       1, TRUE),
  (7476, 'smell', 'burnt_oil_smell',              'Burnt oil smell',                              2, TRUE),
  (7476, 'smell', 'gasoline_fuel_smell',          'Gasoline / fuel smell',                        3, TRUE),
  (7476, 'smell', 'rotten_egg_sulfur_smell',      'Rotten egg / sulfur smell',                    4, TRUE),
  (7476, 'smell', 'burning_electrical_plastic_smell','Burning electrical / plastic smell',        5, TRUE),
  (7476, 'smell', 'burning_rubber_hot_brake_smell','Burning rubber / hot brake smell',            6, TRUE),
  (7476, 'smell', 'musty_mildew_smell_from_vents','Musty / mildew smell from vents',              7, TRUE),
  (7476, 'smell', 'exhaust_fumes_inside_the_cabin','Exhaust fumes inside the cabin',              8, TRUE),

  -- ── smoke (6) ────────────────────────────────────────────────────
  (7476, 'smoke', 'white_smoke_from_tailpipe',          'White smoke from tailpipe',          1, TRUE),
  (7476, 'smoke', 'blue_or_gray_smoke_from_tailpipe',   'Blue or gray smoke from tailpipe',   2, TRUE),
  (7476, 'smoke', 'black_smoke_from_tailpipe',          'Black smoke from tailpipe',          3, TRUE),
  (7476, 'smoke', 'smoke_from_under_the_hood',          'Smoke from under the hood',          4, TRUE),
  (7476, 'smoke', 'smoke_or_burning_smell_from_a_wheel','Smoke or burning smell from a wheel',5, TRUE),
  (7476, 'smoke', 'smoke_or_strong_smell_inside_the_cabin','Smoke or strong smell inside the cabin',6, TRUE),

  -- ── steering (7) ─────────────────────────────────────────────────
  (7476, 'steering', 'hard_to_turn_heavy_steering',          'Hard to turn / heavy steering',          1, TRUE),
  (7476, 'steering', 'loose_or_sloppy_steering',             'Loose or sloppy steering',               2, TRUE),
  (7476, 'steering', 'steering_wheel_off_center_when_driving_straight','Steering wheel off-center when driving straight',3, TRUE),
  (7476, 'steering', 'noise_when_turning_the_steering_wheel','Noise when turning the steering wheel',  4, TRUE),
  (7476, 'steering', 'steering_wheel_shakes_at_highway_speed','Steering wheel shakes at highway speed',5, TRUE),
  (7476, 'steering', 'pulling_drifting_or_wandering_on_the_road','Pulling, drifting, or wandering on the road',6, TRUE),
  (7476, 'steering', 'clunking_knocking_or_rough_ride_over_bumps','Clunking, knocking, or rough ride over bumps',7, TRUE),

  -- ── tires (7) ────────────────────────────────────────────────────
  (7476, 'tires', 'visible_damage',                  'Visible damage (nail / screw / bulge / cut)', 1, TRUE),
  (7476, 'tires', 'tire_going_flat_losing_air',      'Tire going flat / losing air',                2, TRUE),
  (7476, 'tires', 'low_pressure_warning_light_only', 'Low pressure warning light only',             3, TRUE),
  (7476, 'tires', 'uneven_tire_wear_bald_spots',     'Uneven tire wear / bald spots',               4, TRUE),
  (7476, 'tires', 'dry_rot_sidewall_cracking',       'Dry rot / sidewall cracking',                 5, TRUE),
  (7476, 'tires', 'just_want_new_tires',             'Just want new tires',                         6, TRUE),
  (7476, 'tires', 'recent_tire_work_then_new_symptom','Recent tire work then new symptom',          7, TRUE),

  -- ── vibration (6) ────────────────────────────────────────────────
  (7476, 'vibration', 'steering_wheel_shake_at_highway_speed',     'Steering wheel shake at highway speed',     1, TRUE),
  (7476, 'vibration', 'vibration_or_pulsing_when_braking',         'Vibration or pulsing when braking',         2, TRUE),
  (7476, 'vibration', 'shaking_at_idle_while_stopped',             'Shaking at idle while stopped',             3, TRUE),
  (7476, 'vibration', 'shaking_when_speeding_up_or_going_uphill',  'Shaking when speeding up or going uphill',  4, TRUE),
  (7476, 'vibration', 'shaking_or_bouncing_over_bumps_and_rough_roads','Shaking or bouncing over bumps and rough roads',5, TRUE),
  (7476, 'vibration', 'constant_vibration_that_doesnt_change_with_speed','Constant vibration that doesn''t change with speed',6, TRUE),

  -- ── warning_light (12) ───────────────────────────────────────────
  (7476, 'warning_light', 'check_engine_light',                       'Check engine light',                                1, TRUE),
  (7476, 'warning_light', 'service_engine_soon_maintenance_required', 'Service engine soon / maintenance required light', 2, TRUE),
  (7476, 'warning_light', 'battery_charging_light',                   'Battery / charging light',                          3, TRUE),
  (7476, 'warning_light', 'oil_pressure_light',                       'Oil pressure light',                                4, TRUE),
  (7476, 'warning_light', 'engine_temperature_light',                 'Engine temperature light',                          5, TRUE),
  (7476, 'warning_light', 'tpms_tire_pressure_light',                 'TPMS / tire pressure light',                        6, TRUE),
  (7476, 'warning_light', 'abs_anti_lock_brake_light',                'ABS / anti-lock brake light',                       7, TRUE),
  (7476, 'warning_light', 'brake_system_red_light',                   'Brake system (red) light',                          8, TRUE),
  (7476, 'warning_light', 'airbag_srs_light',                         'Airbag / SRS light',                                9, TRUE),
  (7476, 'warning_light', 'traction_control_stability_light',         'Traction control / stability light',               10, TRUE),
  (7476, 'warning_light', 'power_steering_eps_light',                 'Power steering / EPS light',                       11, TRUE),
  (7476, 'warning_light', 'multiple_warning_lights_at_once',          'Multiple warning lights at once',                  12, TRUE)
ON CONFLICT (shop_id, category, slug) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2A. Seed pulling questions (6 subs × 7 questions = 42)
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'pulling'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Pulling Only When Braking (7) ─────────────────────────────────
  ('pulling_only_when_braking',
   'Does the pulling only happen when you press the brake pedal, or also when cruising?',
   '[{"label":"Only when braking","value":"braking"},{"label":"Also when cruising","value":"cruising"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('pulling_only_when_braking',
   'Does it pull harder to one side the harder you press the brakes?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('pulling_only_when_braking',
   'Have you had any brake work done recently, like new pads, rotors, or a caliper job?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('pulling_only_when_braking',
   'After driving for a while, does one wheel feel hotter than the others when you stand near it?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('pulling_only_when_braking',
   'Do you smell anything burning or notice any smoke after a longer drive?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('pulling_only_when_braking',
   'Does the steering wheel jerk in your hands the moment you start braking, or does the pull build up gradually?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Gradually","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('pulling_only_when_braking',
   'Does it pull the same direction every single time you brake, or does the direction vary?',
   '[{"label":"Same direction every time","value":"same"},{"label":"Direction varies","value":"varies"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Steady Drift While Cruising (7) ───────────────────────────────
  ('steady_drift_while_cruising',
   'Does the car drift the same direction the entire time you''re driving straight on the highway?',
   '[{"label":"Yes — same direction","value":"yes"},{"label":"No — varies","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('steady_drift_while_cruising',
   'When was the last time you had the wheels aligned or had any steering or suspension work done?',
   '[{"label":"Recently","value":"recent"},{"label":"A while ago","value":"long_ago"},{"label":"Never","value":"never"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('steady_drift_while_cruising',
   'Have you bumped a curb, hit a deep pothole, or had any accident even a small one in the last few months?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('steady_drift_while_cruising',
   'Do you have to hold the steering wheel slightly off-center to make the car go straight?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('steady_drift_while_cruising',
   'Have you checked the air pressure in all four tires recently, and are they all roughly the same?',
   '[{"label":"Yes — all the same","value":"yes_same"},{"label":"Yes — some are different","value":"yes_different"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('steady_drift_while_cruising',
   'Have any of the tires been replaced or rotated in the last few weeks?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('steady_drift_while_cruising',
   'Does the car drift even when you let go of the wheel briefly on a flat empty parking lot?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t tried","value":"unsure"}]',
   7),

  -- ── Pulling Only During Acceleration (7) ──────────────────────────
  ('pulling_only_during_acceleration',
   'Does the car only pull when you step on the gas hard, like merging onto the highway or passing?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('pulling_only_during_acceleration',
   'Does the steering wheel tug or twist in your hands when you accelerate firmly?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('pulling_only_during_acceleration',
   'Does the car straighten back out as soon as you ease off the gas?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('pulling_only_during_acceleration',
   'Does it pull the opposite direction when you let off the gas or slow down?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('pulling_only_during_acceleration',
   'Is this a front-wheel-drive car, and has it always done this since you bought it, or did it start recently?',
   '[{"label":"Always done it","value":"always"},{"label":"Started recently","value":"recent"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('pulling_only_during_acceleration',
   'Have you had any work done on the engine mounts, axles, or CV joints recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('pulling_only_during_acceleration',
   'Does it pull more when the road is wet or when one wheel is on a different surface than the other?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Drift That Follows the Road''s Slope (7) ───────────────────────
  ('drift_that_follows_the_roads_slope',
   'When you drive on a perfectly flat parking lot with no slope, does the car still pull or does it go straight?',
   '[{"label":"Still pulls","value":"pulls"},{"label":"Goes straight","value":"straight"},{"label":"Haven''t tried","value":"unsure"}]',
   1),
  ('drift_that_follows_the_roads_slope',
   'Does the pull only show up on certain roads or in certain lanes?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('drift_that_follows_the_roads_slope',
   'Does the direction of the pull change depending on which lane you''re in or which road you''re on?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('drift_that_follows_the_roads_slope',
   'Do you find that you''re constantly making small steering corrections to stay in your lane?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('drift_that_follows_the_roads_slope',
   'Has anyone else driven the car and noticed the same drift, or is it something only you feel?',
   '[{"label":"Yes — others noticed too","value":"others"},{"label":"Only I noticed","value":"only_me"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('drift_that_follows_the_roads_slope',
   'Did the drift start suddenly or has it always been there since you got the car?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Always been there","value":"always"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('drift_that_follows_the_roads_slope',
   'When you cross a bridge or get on a road that''s tilted the other direction, does the pull reverse?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t noticed","value":"unsure"}]',
   7),

  -- ── Pull After Recent Tire or Service Work (7) ────────────────────
  ('pull_after_recent_tire_or_service_work',
   'Did the pulling start right after a tire rotation, new tire installation, or wheel alignment?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('pull_after_recent_tire_or_service_work',
   'About how many miles or days passed between the service and the start of the pulling?',
   '[{"label":"Same day","value":"same_day"},{"label":"Within a week","value":"week"},{"label":"More than a week","value":"longer"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('pull_after_recent_tire_or_service_work',
   'Did the shop replace one tire by itself, or were they all replaced together?',
   '[{"label":"One tire","value":"one"},{"label":"All replaced","value":"all"},{"label":"Pair","value":"pair"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('pull_after_recent_tire_or_service_work',
   'Does the pull get more noticeable the faster you drive, especially over 45 or 50 miles per hour?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('pull_after_recent_tire_or_service_work',
   'Was the car pulling before the service, just in a different direction or to a different degree?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('pull_after_recent_tire_or_service_work',
   'Did the shop mention any other concerns or recommend follow-up work at the same visit?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('pull_after_recent_tire_or_service_work',
   'Have you taken the car back to the shop to have them re-check, and what did they say?',
   '[{"label":"Yes — they re-checked","value":"yes"},{"label":"No — haven''t gone back","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Wandering or Drifting in Both Directions (7) ──────────────────
  ('wandering_or_drifting_in_both_directions',
   'Does the car wander back and forth on its own, instead of pulling steady to one side?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('wandering_or_drifting_in_both_directions',
   'Does the steering feel loose, like there''s slack or play before the wheels respond?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('wandering_or_drifting_in_both_directions',
   'Do you hear any clunking, knocking, or popping noises from the front end when you go over bumps?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('wandering_or_drifting_in_both_directions',
   'Does the car feel worse and harder to control when the road is rough or uneven?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('wandering_or_drifting_in_both_directions',
   'Have you noticed any tires wearing unevenly, especially on the inside or outside edges?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('wandering_or_drifting_in_both_directions',
   'Does the steering wheel sit straight when the car is going straight, or is it tilted off-center?',
   '[{"label":"Sits straight","value":"straight"},{"label":"Tilted off-center","value":"off_center"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('wandering_or_drifting_in_both_directions',
   'Does the wandering get worse at highway speeds or stay about the same at all speeds?',
   '[{"label":"Worse at highway speeds","value":"highway"},{"label":"Same at all speeds","value":"same"},{"label":"Not sure","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'pulling',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2B. Seed smell questions (8 subs × 7 questions = 56)
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'smell'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Sweet Smell (Maple Syrup / Antifreeze) (7) ────────────────────
  ('sweet_smell',
   'Do you smell it more when the heater or defroster is running?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('sweet_smell',
   'Is the smell stronger inside the cabin or outside under the hood?',
   '[{"label":"Inside cabin","value":"inside"},{"label":"Outside under hood","value":"outside"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('sweet_smell',
   'Have you noticed any damp spots or wet patches on the passenger-side floor or carpet?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('sweet_smell',
   'Does the windshield fog up on the inside even when the weather is dry?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('sweet_smell',
   'Have you had to add coolant or antifreeze to the vehicle recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('sweet_smell',
   'Does the smell come and go, or is it there every time you drive?',
   '[{"label":"Comes and goes","value":"intermittent"},{"label":"Every time","value":"every_time"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('sweet_smell',
   'Do you see any green, orange, or pink fluid leaking under the car when it sits?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   7),

  -- ── Burnt Oil Smell (7) ───────────────────────────────────────────
  ('burnt_oil_smell',
   'Do you smell it most when the engine has been running hard or after a long drive?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('burnt_oil_smell',
   'Does the smell come from under the hood, from underneath the car, or through the vents?',
   '[{"label":"Under the hood","value":"hood"},{"label":"Underneath the car","value":"underneath"},{"label":"Through the vents","value":"vents"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('burnt_oil_smell',
   'Have you seen any blue or gray smoke coming from the back of the car or from under the hood?',
   '[{"label":"Yes — from tailpipe","value":"tailpipe"},{"label":"Yes — from under hood","value":"hood"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('burnt_oil_smell',
   'Have you noticed oil drops or oil spots on the ground where you park?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('burnt_oil_smell',
   'Has the oil light on the dash come on, or have you had to top off the oil between changes?',
   '[{"label":"Yes — light came on","value":"light"},{"label":"Yes — topped off","value":"topped_off"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   5),
  ('burnt_oil_smell',
   'Does the smell get stronger right after you turn the engine off and walk away?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('burnt_oil_smell',
   'Have you had any recent oil changes or engine work done?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Gasoline / Fuel Smell (7) ─────────────────────────────────────
  ('gasoline_fuel_smell',
   'Do you smell it most right after starting the car, while driving, or after parking?',
   '[{"label":"After starting","value":"starting"},{"label":"While driving","value":"driving"},{"label":"After parking","value":"parking"},{"label":"All the time","value":"all"}]',
   1),
  ('gasoline_fuel_smell',
   'Is the smell stronger inside the cabin or outside near the back of the car?',
   '[{"label":"Inside cabin","value":"inside"},{"label":"Outside near back","value":"outside_back"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('gasoline_fuel_smell',
   'Have you noticed any wet spots or puddles under the vehicle where it sits?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('gasoline_fuel_smell',
   'Did you recently fill up the tank, and did the pump click off normally?',
   '[{"label":"Yes — clicked off normally","value":"normal"},{"label":"Yes — pump kept clicking","value":"kept_clicking"},{"label":"No — haven''t filled up","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('gasoline_fuel_smell',
   'Is your gas cap on tight, and does it click when you close it?',
   '[{"label":"Yes — clicks tight","value":"yes"},{"label":"No — doesn''t click","value":"no_click"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('gasoline_fuel_smell',
   'Has the check-engine light come on?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   6),
  ('gasoline_fuel_smell',
   'Does the smell get worse when you''re driving uphill, accelerating hard, or sitting at idle?',
   '[{"label":"Yes — uphill","value":"uphill"},{"label":"Yes — accelerating","value":"accel"},{"label":"Yes — idle","value":"idle"},{"label":"No","value":"no"}]',
   7),

  -- ── Rotten Egg / Sulfur Smell (7) ─────────────────────────────────
  ('rotten_egg_sulfur_smell',
   'Do you smell it mostly from the tailpipe area, or is it inside the cabin too?',
   '[{"label":"Tailpipe area","value":"tailpipe"},{"label":"Inside cabin too","value":"cabin"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('rotten_egg_sulfur_smell',
   'Does it happen more after hard driving or sitting in traffic for a while?',
   '[{"label":"After hard driving","value":"hard_driving"},{"label":"After traffic","value":"traffic"},{"label":"Both","value":"both"},{"label":"Neither","value":"neither"}]',
   2),
  ('rotten_egg_sulfur_smell',
   'Has the check-engine light come on or been on recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   3),
  ('rotten_egg_sulfur_smell',
   'Is the car running rough, hesitating, or losing power when you smell it?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('rotten_egg_sulfur_smell',
   'Have you noticed the smell more after filling up at a particular gas station or with a different brand of fuel?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('rotten_egg_sulfur_smell',
   'Have you had any work done on the exhaust, catalytic converter, or emissions system?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('rotten_egg_sulfur_smell',
   'Is the smell present right at startup, or only once the engine has warmed up?',
   '[{"label":"At startup","value":"startup"},{"label":"Only when warmed up","value":"warm"},{"label":"All the time","value":"all"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Burning Electrical / Plastic Smell (7) ────────────────────────
  ('burning_electrical_plastic_smell',
   'Have you noticed any flickering lights, blown fuses, or dashboard warnings around the same time?',
   '[{"label":"Yes — flickering lights","value":"flickering"},{"label":"Yes — blown fuses","value":"fuses"},{"label":"Yes — dashboard warnings","value":"warnings"},{"label":"No","value":"no"}]',
   1),
  ('burning_electrical_plastic_smell',
   'Does the smell get worse when you turn on the heater, AC, or fan?',
   '[{"label":"Yes — heater","value":"heater"},{"label":"Yes — AC","value":"ac"},{"label":"Yes — fan","value":"fan"},{"label":"No","value":"no"}]',
   2),
  ('burning_electrical_plastic_smell',
   'Is the smell coming from the dashboard area, the vents, or under the hood?',
   '[{"label":"Dashboard","value":"dashboard"},{"label":"Vents","value":"vents"},{"label":"Under hood","value":"hood"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('burning_electrical_plastic_smell',
   'Have any electrical accessories or aftermarket parts been installed recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('burning_electrical_plastic_smell',
   'Does the smell come on when you use a specific feature like the radio, seat warmers, or power windows?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   5),
  ('burning_electrical_plastic_smell',
   'Have you seen any smoke or haze inside the cabin?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   6),
  ('burning_electrical_plastic_smell',
   'Does the smell stay even after the car is turned off and cooled down?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Burning Rubber / Hot Brake Smell (7) ──────────────────────────
  ('burning_rubber_hot_brake_smell',
   'Do you smell it more after stopping the car, especially after coming down a hill or heavy braking?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('burning_rubber_hot_brake_smell',
   'Is the smell coming from one specific wheel or all four?',
   '[{"label":"One specific wheel","value":"one"},{"label":"All four","value":"all"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('burning_rubber_hot_brake_smell',
   'Does the parking brake release fully, and have you been able to confirm it''s all the way off?',
   '[{"label":"Yes — fully released","value":"yes"},{"label":"No — still partly engaged","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('burning_rubber_hot_brake_smell',
   'Have you noticed any squealing, grinding, or dragging feeling from the brakes?',
   '[{"label":"Yes — squealing","value":"squealing"},{"label":"Yes — grinding","value":"grinding"},{"label":"Yes — dragging","value":"dragging"},{"label":"No","value":"no"}]',
   4),
  ('burning_rubber_hot_brake_smell',
   'Does the smell happen after long highway drives even when you haven''t braked much?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('burning_rubber_hot_brake_smell',
   'Have you seen any smoke or haze coming from a wheel area or from under the hood?',
   '[{"label":"Yes — from wheel","value":"wheel"},{"label":"Yes — from hood","value":"hood"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('burning_rubber_hot_brake_smell',
   'Does the steering feel heavier or different when the smell is present?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Musty / Mildew Smell from Vents (7) ───────────────────────────
  ('musty_mildew_smell_from_vents',
   'Does the smell only come through the vents when you turn on the AC or heater?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('musty_mildew_smell_from_vents',
   'Is the smell strongest in the first few seconds after you turn the fan on, then fade?',
   '[{"label":"Yes","value":"yes"},{"label":"No — it stays","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('musty_mildew_smell_from_vents',
   'Does the smell go away when you switch to outside-air mode versus recirculate?',
   '[{"label":"Yes — goes away","value":"yes"},{"label":"No — same either way","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('musty_mildew_smell_from_vents',
   'Have you noticed any water dripping under the dashboard onto your feet?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t noticed","value":"unsure"}]',
   4),
  ('musty_mildew_smell_from_vents',
   'When was the cabin air filter last changed, if you know?',
   '[{"label":"Recently","value":"recent"},{"label":"A while ago","value":"long_ago"},{"label":"Never","value":"never"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('musty_mildew_smell_from_vents',
   'Is the car parked outside often, or does it sit unused for long stretches?',
   '[{"label":"Outside often","value":"outside"},{"label":"Sits unused","value":"unused"},{"label":"In a garage","value":"garage"},{"label":"Mix","value":"mix"}]',
   6),
  ('musty_mildew_smell_from_vents',
   'Have the carpets or seats been wet recently from a spill, leak, or open window in the rain?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Exhaust Fumes Inside the Cabin (7) ────────────────────────────
  ('exhaust_fumes_inside_the_cabin',
   'Do you smell the exhaust more when the windows are up, or only with a window cracked open?',
   '[{"label":"Windows up","value":"up"},{"label":"Window cracked","value":"cracked"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('exhaust_fumes_inside_the_cabin',
   'Does the smell get worse when you''re stopped at a light versus when you''re driving?',
   '[{"label":"Worse when stopped","value":"stopped"},{"label":"Worse when driving","value":"driving"},{"label":"Same either way","value":"same"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('exhaust_fumes_inside_the_cabin',
   'Does it come on stronger when the heater or fan is running, especially on recirculate mode?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('exhaust_fumes_inside_the_cabin',
   'Have you noticed the car running louder than normal, like a rumble or hissing sound?',
   '[{"label":"Yes — louder rumble","value":"rumble"},{"label":"Yes — hissing","value":"hissing"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('exhaust_fumes_inside_the_cabin',
   'Have you felt lightheaded, dizzy, drowsy, or had a headache while driving?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   5),
  ('exhaust_fumes_inside_the_cabin',
   'Has anyone done recent work on the exhaust, muffler, or undercarriage?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('exhaust_fumes_inside_the_cabin',
   'Is the rear hatch, trunk seal, or any window seal damaged or leaking air?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'smell',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2C. Seed smoke questions (6 subs × 7 questions = 42)
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'smoke'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── White Smoke From Tailpipe (7) ─────────────────────────────────
  ('white_smoke_from_tailpipe',
   'Does the smoke only appear for the first minute or two after starting up cold, then disappear once the engine warms up?',
   '[{"label":"Yes — disappears","value":"yes"},{"label":"No — stays","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('white_smoke_from_tailpipe',
   'Does it keep happening even after you''ve been driving for ten or fifteen minutes?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('white_smoke_from_tailpipe',
   'Does the smoke have a sweet or syrupy smell to it?',
   '[{"label":"Yes — sweet","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('white_smoke_from_tailpipe',
   'Have you had to add coolant or top off the radiator recently, or noticed the coolant level dropping?',
   '[{"label":"Yes — added coolant","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('white_smoke_from_tailpipe',
   'Has the engine been running hotter than normal or has the temperature gauge crept up?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('white_smoke_from_tailpipe',
   'Is the smoke thin and wispy, or thick and heavy like a cloud?',
   '[{"label":"Thin and wispy","value":"thin"},{"label":"Thick like a cloud","value":"thick"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('white_smoke_from_tailpipe',
   'Have you noticed any milky or frothy stuff on the underside of the oil filler cap?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   7),

  -- ── Blue or Gray Smoke From Tailpipe (7) ──────────────────────────
  ('blue_or_gray_smoke_from_tailpipe',
   'Does the smoke puff out mainly when you first start the car after it''s been sitting overnight?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('blue_or_gray_smoke_from_tailpipe',
   'Does it show up when you press the gas hard, like accelerating onto a highway?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('blue_or_gray_smoke_from_tailpipe',
   'Does it appear when you''re slowing down or coasting down a hill with your foot off the gas?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('blue_or_gray_smoke_from_tailpipe',
   'Have you been adding oil between oil changes, and if so, how often?',
   '[{"label":"Every few weeks","value":"weeks"},{"label":"Every month","value":"month"},{"label":"Rarely","value":"rare"},{"label":"Never","value":"never"}]',
   4),
  ('blue_or_gray_smoke_from_tailpipe',
   'Does the smoke smell more like burning oil than anything sweet or like raw fuel?',
   '[{"label":"Yes — burning oil","value":"yes"},{"label":"No — sweet","value":"sweet"},{"label":"No — raw fuel","value":"fuel"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('blue_or_gray_smoke_from_tailpipe',
   'Is there a turbocharger on the vehicle that you know of, and has it been making any whining or whistling noises?',
   '[{"label":"Yes — turbo, whining","value":"turbo_whining"},{"label":"Yes — turbo, no noise","value":"turbo_quiet"},{"label":"No turbo","value":"no_turbo"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('blue_or_gray_smoke_from_tailpipe',
   'Have you noticed any oily film or buildup around the tailpipe tip when you wipe a finger in it?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   7),

  -- ── Black Smoke From Tailpipe (7) ─────────────────────────────────
  ('black_smoke_from_tailpipe',
   'Does the black smoke puff out when you stomp on the gas, or is it there all the time?',
   '[{"label":"Only when accelerating","value":"accel"},{"label":"All the time","value":"all"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('black_smoke_from_tailpipe',
   'Is the vehicle a diesel, or does it run on regular gasoline?',
   '[{"label":"Diesel","value":"diesel"},{"label":"Gasoline","value":"gas"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('black_smoke_from_tailpipe',
   'Have you noticed the fuel mileage dropping recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('black_smoke_from_tailpipe',
   'Does the engine seem to hesitate, surge, or run rough?',
   '[{"label":"Yes — hesitates","value":"hesitates"},{"label":"Yes — surges","value":"surges"},{"label":"Yes — runs rough","value":"rough"},{"label":"No","value":"no"}]',
   4),
  ('black_smoke_from_tailpipe',
   'When was the last time the air filter was changed, if you remember?',
   '[{"label":"Recently","value":"recent"},{"label":"A while ago","value":"long_ago"},{"label":"Never","value":"never"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('black_smoke_from_tailpipe',
   'Is the check engine light on, and does it stay on or flash?',
   '[{"label":"On, steady","value":"steady"},{"label":"Flashing","value":"flashing"},{"label":"Off","value":"off"}]',
   6),
  ('black_smoke_from_tailpipe',
   'Do you smell strong raw fuel along with the smoke, almost like gasoline or diesel fumes?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Smoke From Under the Hood (7) ─────────────────────────────────
  ('smoke_from_under_the_hood',
   'Does the smoke have a sweet smell, a burnt-oil smell, or more of a plastic or electrical burn smell?',
   '[{"label":"Sweet","value":"sweet"},{"label":"Burnt oil","value":"oil"},{"label":"Plastic/electrical","value":"electrical"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('smoke_from_under_the_hood',
   'Did the temperature gauge climb into the red or did a hot-engine warning come on before you saw smoke?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('smoke_from_under_the_hood',
   'Have you noticed any puddles, drips, or wet spots under the car after parking?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('smoke_from_under_the_hood',
   'Does the smoke seem to be coming from one specific spot, or is it billowing out from all around the engine?',
   '[{"label":"One specific spot","value":"one"},{"label":"All around engine","value":"all"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('smoke_from_under_the_hood',
   'Did the smoke start right after a recent oil change or other work done on the vehicle?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('smoke_from_under_the_hood',
   'Is the smoke only showing up after you''ve been driving for a while, or does it appear right away on startup?',
   '[{"label":"After driving","value":"after_driving"},{"label":"On startup","value":"startup"},{"label":"All the time","value":"all"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('smoke_from_under_the_hood',
   'Did you hear any popping, hissing, or boiling sounds along with the smoke?',
   '[{"label":"Yes — popping","value":"popping"},{"label":"Yes — hissing","value":"hissing"},{"label":"Yes — boiling","value":"boiling"},{"label":"No","value":"no"}]',
   7),

  -- ── Smoke or Burning Smell From a Wheel (7) ───────────────────────
  ('smoke_or_burning_smell_from_a_wheel',
   'Is the smoke coming from one specific wheel, or do all four wheels look hot?',
   '[{"label":"One specific wheel","value":"one"},{"label":"All four","value":"all"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('smoke_or_burning_smell_from_a_wheel',
   'Does the vehicle pull to one side when you''re driving straight on a flat road?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('smoke_or_burning_smell_from_a_wheel',
   'After a drive, does one wheel feel much hotter than the others when you hold a hand near it (without touching)?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('smoke_or_burning_smell_from_a_wheel',
   'Did you maybe leave the parking brake on, even partly, during your last drive?',
   '[{"label":"Yes — possibly","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('smoke_or_burning_smell_from_a_wheel',
   'Have the brakes felt soft, grabby, or like they''re dragging when you let off the pedal?',
   '[{"label":"Yes — soft","value":"soft"},{"label":"Yes — grabby","value":"grabby"},{"label":"Yes — dragging","value":"dragging"},{"label":"No","value":"no"}]',
   5),
  ('smoke_or_burning_smell_from_a_wheel',
   'Does the smoke smell more like hot metal and burning brake material, or more like burning rubber from a tire?',
   '[{"label":"Hot metal/brake","value":"brake"},{"label":"Burning rubber","value":"rubber"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('smoke_or_burning_smell_from_a_wheel',
   'Did you just come off a long downhill stretch or a lot of stop-and-go traffic before noticing the smoke?',
   '[{"label":"Yes — downhill","value":"downhill"},{"label":"Yes — stop-and-go","value":"traffic"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Smoke or Strong Smell Inside the Cabin (7) ────────────────────
  ('smoke_or_strong_smell_inside_the_cabin',
   'Does the smoke or smell only come out when the heater or air conditioner is running?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('smoke_or_strong_smell_inside_the_cabin',
   'Does it smell more like burning plastic and electrical, or more like burning leaves and dust?',
   '[{"label":"Plastic/electrical","value":"electrical"},{"label":"Leaves/dust","value":"dust"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('smoke_or_strong_smell_inside_the_cabin',
   'Did this start the first time you turned on the heat for the season after a long stretch of not using it?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('smoke_or_strong_smell_inside_the_cabin',
   'Are any dashboard warning lights on, or have any electrical features like windows, fans, or lights been acting up?',
   '[{"label":"Yes — warning lights","value":"lights"},{"label":"Yes — electrical features","value":"electrical"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   4),
  ('smoke_or_strong_smell_inside_the_cabin',
   'Is the smoke visible coming out of the vents, or is it just a smell with no visible smoke?',
   '[{"label":"Visible smoke","value":"visible"},{"label":"Just smell","value":"smell_only"},{"label":"Both","value":"both"}]',
   5),
  ('smoke_or_strong_smell_inside_the_cabin',
   'Does the smell get stronger when you turn the fan speed up?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('smoke_or_strong_smell_inside_the_cabin',
   'Have you been able to pull over and stop the car safely, or is this happening while you''re calling from the road?',
   '[{"label":"Pulled over safely","value":"safe"},{"label":"Calling from the road","value":"road"},{"label":"Other","value":"other"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'smoke',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2D. Seed steering questions (7 subs × 7 questions = 49)
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'steering'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Hard to Turn / Heavy Steering (7) ─────────────────────────────
  ('hard_to_turn_heavy_steering',
   'Is it harder to turn the wheel at low speeds and parking, or also at higher speeds?',
   '[{"label":"Low speeds/parking","value":"low"},{"label":"Higher speeds too","value":"high"},{"label":"All speeds","value":"all"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('hard_to_turn_heavy_steering',
   'Did this come on suddenly overnight, or has it gotten gradually worse over days or weeks?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Gradually","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('hard_to_turn_heavy_steering',
   'Is it equally hard to turn in both directions, or worse turning one way than the other?',
   '[{"label":"Equal both directions","value":"equal"},{"label":"Worse one way","value":"one_way"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('hard_to_turn_heavy_steering',
   'Have you noticed any red or pink fluid spots under the front of the car where you park?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('hard_to_turn_heavy_steering',
   'Do you hear any whining, groaning, or humming sound while turning?',
   '[{"label":"Yes — whining","value":"whining"},{"label":"Yes — groaning","value":"groaning"},{"label":"Yes — humming","value":"humming"},{"label":"No","value":"no"}]',
   5),
  ('hard_to_turn_heavy_steering',
   'Does your car have power steering you can feel quitting, or has the wheel always felt this stiff since you got it?',
   '[{"label":"Felt power steering quit","value":"quit"},{"label":"Always felt stiff","value":"always"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('hard_to_turn_heavy_steering',
   'Has the battery been dying or have any warning lights been on the dashboard recently?',
   '[{"label":"Yes — battery dying","value":"battery"},{"label":"Yes — warning lights","value":"lights"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   7),

  -- ── Loose or Sloppy Steering (7) ──────────────────────────────────
  ('loose_or_sloppy_steering',
   'Can you wiggle the steering wheel a little bit side-to-side before the car actually starts to turn?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('loose_or_sloppy_steering',
   'Do you find yourself constantly making small corrections to keep the car going straight?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('loose_or_sloppy_steering',
   'Does the car feel floaty or disconnected from the road, like it''s not really tracking where you point it?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('loose_or_sloppy_steering',
   'Have you hit any large potholes, curbs, or had a fender-bender recently?',
   '[{"label":"Yes — pothole","value":"pothole"},{"label":"Yes — curb","value":"curb"},{"label":"Yes — fender-bender","value":"accident"},{"label":"No","value":"no"}]',
   4),
  ('loose_or_sloppy_steering',
   'Are your front tires wearing more on the inside or outside edges than in the middle?',
   '[{"label":"Inside edge","value":"inside"},{"label":"Outside edge","value":"outside"},{"label":"Middle","value":"middle"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('loose_or_sloppy_steering',
   'Does the looseness feel worse at higher speeds, lower speeds, or about the same all the time?',
   '[{"label":"Worse at higher speeds","value":"high"},{"label":"Worse at lower speeds","value":"low"},{"label":"About the same","value":"same"}]',
   6),
  ('loose_or_sloppy_steering',
   'About how many miles are on the car, and do you know roughly when the front-end parts were last looked at?',
   '[{"label":"Low mileage / recently checked","value":"low_recent"},{"label":"High mileage / not checked","value":"high_unchecked"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Steering Wheel Off-Center When Driving Straight (7) ───────────
  ('steering_wheel_off_center_when_driving_straight',
   'When the car is going straight down a flat road, is the steering wheel tilted left or right of center?',
   '[{"label":"Tilted left","value":"left"},{"label":"Tilted right","value":"right"},{"label":"Sits straight","value":"straight"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('steering_wheel_off_center_when_driving_straight',
   'Did this start right after a recent alignment, tire rotation, or other suspension work?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('steering_wheel_off_center_when_driving_straight',
   'Have you hit a curb, pothole, or had any kind of impact to the front of the car recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('steering_wheel_off_center_when_driving_straight',
   'Does the car still drive straight, or does it also pull to one side along with the wheel being crooked?',
   '[{"label":"Still drives straight","value":"straight"},{"label":"Also pulls","value":"pulls"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('steering_wheel_off_center_when_driving_straight',
   'Have any tires been replaced recently, and if so were all four done or just some of them?',
   '[{"label":"All four","value":"all"},{"label":"Just some","value":"some"},{"label":"No replacements","value":"none"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('steering_wheel_off_center_when_driving_straight',
   'Are all four tires the same brand, model, and roughly the same age?',
   '[{"label":"Yes — same","value":"yes"},{"label":"No — different","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('steering_wheel_off_center_when_driving_straight',
   'Do you remember when you last had the tire pressures checked on all four corners?',
   '[{"label":"Recently","value":"recent"},{"label":"A while ago","value":"long_ago"},{"label":"Never","value":"never"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Noise When Turning the Steering Wheel (7) ─────────────────────
  ('noise_when_turning_the_steering_wheel',
   'What does the sound feel like — a whine or hum, a clicking or popping, a creak, or a clunk?',
   '[{"label":"Whine/hum","value":"whine"},{"label":"Clicking/popping","value":"clicking"},{"label":"Creak","value":"creak"},{"label":"Clunk","value":"clunk"}]',
   1),
  ('noise_when_turning_the_steering_wheel',
   'Does the noise happen mostly at low speeds and parking, or also at higher speeds?',
   '[{"label":"Low speeds/parking","value":"low"},{"label":"Higher speeds too","value":"high"},{"label":"All speeds","value":"all"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('noise_when_turning_the_steering_wheel',
   'Is it louder when you turn the wheel all the way to one side and hold it there?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('noise_when_turning_the_steering_wheel',
   'Does the noise happen even when the car isn''t moving, just turning the wheel while parked?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('noise_when_turning_the_steering_wheel',
   'Does it sound like it''s coming from the front wheels, the engine bay, or somewhere underneath?',
   '[{"label":"Front wheels","value":"wheels"},{"label":"Engine bay","value":"engine"},{"label":"Underneath","value":"underneath"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('noise_when_turning_the_steering_wheel',
   'Have you checked the power steering fluid level recently, or do you know if it''s low?',
   '[{"label":"Yes — low","value":"low"},{"label":"Yes — normal","value":"normal"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('noise_when_turning_the_steering_wheel',
   'Does the noise change or go away in cold weather versus warm weather?',
   '[{"label":"Worse cold","value":"cold"},{"label":"Worse warm","value":"warm"},{"label":"No change","value":"same"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Steering Wheel Shakes at Highway Speed (7) ────────────────────
  ('steering_wheel_shakes_at_highway_speed',
   'At what speed does the shake start, and does it get worse the faster you go or eventually smooth back out?',
   '[{"label":"Worse the faster","value":"worse"},{"label":"Smooths back out","value":"smooths"},{"label":"Same","value":"same"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('steering_wheel_shakes_at_highway_speed',
   'Does the shake happen all the time at that speed, or only when you press the brakes?',
   '[{"label":"All the time","value":"all"},{"label":"Only when braking","value":"braking"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('steering_wheel_shakes_at_highway_speed',
   'If you briefly let go of the wheel at highway speed, does the shake continue or quiet down?',
   '[{"label":"Continues","value":"continues"},{"label":"Quiets down","value":"quiets"},{"label":"Haven''t tried","value":"unsure"}]',
   3),
  ('steering_wheel_shakes_at_highway_speed',
   'Is the whole car shaking, or is it really just the steering wheel in your hands?',
   '[{"label":"Whole car","value":"whole_car"},{"label":"Just steering wheel","value":"wheel_only"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('steering_wheel_shakes_at_highway_speed',
   'When were your tires last balanced or rotated?',
   '[{"label":"Recently","value":"recent"},{"label":"A while ago","value":"long_ago"},{"label":"Never","value":"never"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('steering_wheel_shakes_at_highway_speed',
   'Have you recently lost a wheel weight or hit something that could have knocked a tire out of balance?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('steering_wheel_shakes_at_highway_speed',
   'Are any of the tires showing uneven wear, scalloped patches, or bald spots?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   7),

  -- ── Pulling, Drifting, or Wandering on the Road (7) ───────────────
  ('pulling_drifting_or_wandering_on_the_road',
   'Does the car pull steadily to one specific side, or does it wander back and forth between lanes?',
   '[{"label":"Pulls one side","value":"one_side"},{"label":"Wanders","value":"wanders"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('pulling_drifting_or_wandering_on_the_road',
   'Which direction does it pull — always left, always right, or it changes?',
   '[{"label":"Always left","value":"left"},{"label":"Always right","value":"right"},{"label":"Changes","value":"changes"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('pulling_drifting_or_wandering_on_the_road',
   'Does the pull happen on flat roads too, or mostly on roads that slope to one side?',
   '[{"label":"Flat roads too","value":"flat"},{"label":"Mostly sloped","value":"sloped"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('pulling_drifting_or_wandering_on_the_road',
   'Does it pull harder when you press the brakes, when you accelerate, or about the same regardless?',
   '[{"label":"Worse braking","value":"braking"},{"label":"Worse accelerating","value":"accel"},{"label":"About the same","value":"same"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('pulling_drifting_or_wandering_on_the_road',
   'When was the last time the tires were rotated, replaced, or had pressures checked?',
   '[{"label":"Recently","value":"recent"},{"label":"A while ago","value":"long_ago"},{"label":"Never","value":"never"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('pulling_drifting_or_wandering_on_the_road',
   'Have you been in a recent accident, hit a big pothole, or run over a curb?',
   '[{"label":"Yes — accident","value":"accident"},{"label":"Yes — pothole","value":"pothole"},{"label":"Yes — curb","value":"curb"},{"label":"No","value":"no"}]',
   6),
  ('pulling_drifting_or_wandering_on_the_road',
   'Have you had an alignment done recently, and did the problem start before or after that?',
   '[{"label":"Yes — started after","value":"after"},{"label":"Yes — started before","value":"before"},{"label":"No alignment","value":"none"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Clunking, Knocking, or Rough Ride Over Bumps (7) ──────────────
  ('clunking_knocking_or_rough_ride_over_bumps',
   'Does the noise happen every time you go over a bump, or only over bigger ones?',
   '[{"label":"Every bump","value":"every"},{"label":"Only bigger ones","value":"bigger"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('clunking_knocking_or_rough_ride_over_bumps',
   'Does the front of the car keep bouncing two or three times after a bump instead of settling right away?',
   '[{"label":"Yes — keeps bouncing","value":"yes"},{"label":"No — settles right away","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('clunking_knocking_or_rough_ride_over_bumps',
   'Does the front end dip down hard when you brake, or does the back end squat down hard when you accelerate?',
   '[{"label":"Front dips when braking","value":"front_brake"},{"label":"Back squats when accelerating","value":"back_accel"},{"label":"Both","value":"both"},{"label":"Neither","value":"neither"}]',
   3),
  ('clunking_knocking_or_rough_ride_over_bumps',
   'Does the car lean or sway a lot when you go around corners or change lanes quickly?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('clunking_knocking_or_rough_ride_over_bumps',
   'Where does the clunking seem to come from — front left, front right, or the back of the car?',
   '[{"label":"Front left","value":"front_left"},{"label":"Front right","value":"front_right"},{"label":"Back","value":"back"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('clunking_knocking_or_rough_ride_over_bumps',
   'Have you noticed any oily or wet streaks running down the metal posts behind the front wheels?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('clunking_knocking_or_rough_ride_over_bumps',
   'About how many miles are on the car, and have the shocks or suspension parts ever been replaced?',
   '[{"label":"High miles / never replaced","value":"high_never"},{"label":"Low miles","value":"low"},{"label":"Replaced recently","value":"recent"},{"label":"Not sure","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'steering',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2E. Seed tires questions (7 subs × 7 questions = 49)
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'tires'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Visible Damage (Nail / Screw / Bulge / Cut) (7) ───────────────
  ('visible_damage',
   'Which tire is it — front-left, front-right, rear-left, rear-right, or are you not sure?',
   '[{"label":"Front-left","value":"front_left"},{"label":"Front-right","value":"front_right"},{"label":"Rear-left","value":"rear_left"},{"label":"Rear-right","value":"rear_right"}]',
   1),
  ('visible_damage',
   'What do you see — a nail or screw sticking out, a bubble or bulge in the side, a cut or gash, or something else?',
   '[{"label":"Nail/screw","value":"nail"},{"label":"Bubble/bulge","value":"bulge"},{"label":"Cut/gash","value":"cut"},{"label":"Something else","value":"other"}]',
   2),
  ('visible_damage',
   'Is the damage on the flat part of the tire that touches the road, or on the curved side wall of the tire?',
   '[{"label":"Flat tread","value":"tread"},{"label":"Sidewall","value":"sidewall"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('visible_damage',
   'Is the tire holding air right now, or is it going flat?',
   '[{"label":"Holding air","value":"holding"},{"label":"Going flat","value":"flat"},{"label":"Already flat","value":"already_flat"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('visible_damage',
   'Is the car drivable right now, or is it parked because the tire is too low to drive on?',
   '[{"label":"Drivable","value":"drivable"},{"label":"Parked — too low","value":"parked"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('visible_damage',
   'Do you have a spare tire on the vehicle, or is the damaged tire still mounted?',
   '[{"label":"Spare is on","value":"spare"},{"label":"Damaged still mounted","value":"damaged"},{"label":"No spare","value":"no_spare"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('visible_damage',
   'Did this happen suddenly today, or have you been driving on it for a few days?',
   '[{"label":"Suddenly today","value":"sudden"},{"label":"A few days","value":"days"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Tire Going Flat / Losing Air (7) ──────────────────────────────
  ('tire_going_flat_losing_air',
   'Which tire keeps losing air — front-left, front-right, rear-left, rear-right, or more than one?',
   '[{"label":"Front-left","value":"front_left"},{"label":"Front-right","value":"front_right"},{"label":"Rear-left","value":"rear_left"},{"label":"Rear-right","value":"rear_right"},{"label":"More than one","value":"multiple"}]',
   1),
  ('tire_going_flat_losing_air',
   'Did the tire go flat suddenly, or has it been slowly losing air over days or weeks?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Slowly","value":"slow"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('tire_going_flat_losing_air',
   'How often are you having to add air — every day, every week, or every month?',
   '[{"label":"Every day","value":"daily"},{"label":"Every week","value":"weekly"},{"label":"Every month","value":"monthly"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('tire_going_flat_losing_air',
   'Did you hear a hissing sound when it happened, or did you just notice it was low?',
   '[{"label":"Heard hissing","value":"hiss"},{"label":"Just noticed low","value":"noticed"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('tire_going_flat_losing_air',
   'Have you driven over anything sharp recently, hit a pothole, or scraped a curb?',
   '[{"label":"Yes — sharp object","value":"sharp"},{"label":"Yes — pothole","value":"pothole"},{"label":"Yes — curb","value":"curb"},{"label":"No","value":"no"}]',
   5),
  ('tire_going_flat_losing_air',
   'Have you looked the tire over and seen anything stuck in it like a nail or screw?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('tire_going_flat_losing_air',
   'Is the car drivable to the shop right now, or does it need to be towed?',
   '[{"label":"Drivable","value":"drivable"},{"label":"Needs tow","value":"tow"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Low Pressure Warning Light Only (7) ───────────────────────────
  ('low_pressure_warning_light_only',
   'Is the warning light steady on, or is it flashing or blinking?',
   '[{"label":"Steady on","value":"steady"},{"label":"Flashing","value":"flashing"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('low_pressure_warning_light_only',
   'If it flashes, does it blink for about a minute and then stay solid, or does it just stay blinking?',
   '[{"label":"Blinks then solid","value":"blink_then_solid"},{"label":"Stays blinking","value":"stays_blinking"},{"label":"Doesn''t flash","value":"no_flash"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('low_pressure_warning_light_only',
   'Have you checked the tires and do any of them actually look low?',
   '[{"label":"Yes — one looks low","value":"one_low"},{"label":"Yes — multiple look low","value":"multiple_low"},{"label":"All look normal","value":"normal"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('low_pressure_warning_light_only',
   'Did the light come on after a cold morning, or did it come on while driving on a warm day?',
   '[{"label":"Cold morning","value":"cold"},{"label":"Warm day driving","value":"warm"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('low_pressure_warning_light_only',
   'Have you added air recently and the light still won''t turn off?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('low_pressure_warning_light_only',
   'Have you had new tires put on or had the tires off the vehicle recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('low_pressure_warning_light_only',
   'Has the light been coming on and off, or has it stayed on without going away?',
   '[{"label":"On and off","value":"intermittent"},{"label":"Stays on","value":"stays_on"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Uneven Tire Wear / Bald Spots (7) ─────────────────────────────
  ('uneven_tire_wear_bald_spots',
   'Where is the wear showing up — the inside edge, outside edge, center of the tread, or in patchy spots around the tire?',
   '[{"label":"Inside edge","value":"inside"},{"label":"Outside edge","value":"outside"},{"label":"Center","value":"center"},{"label":"Patchy spots","value":"patchy"}]',
   1),
  ('uneven_tire_wear_bald_spots',
   'Is it happening on one tire, both front tires, both rear tires, or all four?',
   '[{"label":"One tire","value":"one"},{"label":"Both front","value":"front"},{"label":"Both rear","value":"rear"},{"label":"All four","value":"all"}]',
   2),
  ('uneven_tire_wear_bald_spots',
   'Does the tire look or feel bumpy and scalloped when you run your hand across the tread?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('uneven_tire_wear_bald_spots',
   'When was the last time the tires were rotated or had an alignment done?',
   '[{"label":"Recently","value":"recent"},{"label":"A while ago","value":"long_ago"},{"label":"Never","value":"never"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('uneven_tire_wear_bald_spots',
   'Are you noticing this with any vibration in the steering wheel or seat while driving?',
   '[{"label":"Yes — steering wheel","value":"steering"},{"label":"Yes — seat","value":"seat"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   5),
  ('uneven_tire_wear_bald_spots',
   'Does the vehicle pull to one side when you''re driving on a flat, straight road?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   6),
  ('uneven_tire_wear_bald_spots',
   'Do you know about how many miles are on this set of tires?',
   '[{"label":"Low (under 20k)","value":"low"},{"label":"Medium (20-50k)","value":"medium"},{"label":"High (50k+)","value":"high"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Dry Rot / Sidewall Cracking (7) ───────────────────────────────
  ('dry_rot_sidewall_cracking',
   'Are you seeing small cracks in the rubber on the side of the tire, the tread, or both?',
   '[{"label":"Sidewall","value":"sidewall"},{"label":"Tread","value":"tread"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('dry_rot_sidewall_cracking',
   'Are the cracks just on the surface, or do they look deep enough to put a fingernail into?',
   '[{"label":"Just surface","value":"surface"},{"label":"Deep enough for fingernail","value":"deep"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('dry_rot_sidewall_cracking',
   'Do you know roughly how old the tires are, or about how many years you''ve had them?',
   '[{"label":"Less than 3 years","value":"new"},{"label":"3-6 years","value":"medium"},{"label":"6+ years","value":"old"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('dry_rot_sidewall_cracking',
   'Does the vehicle sit parked for long stretches without being driven?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('dry_rot_sidewall_cracking',
   'Is it on one tire, or are you seeing the same cracking on all of them?',
   '[{"label":"One tire","value":"one"},{"label":"All of them","value":"all"},{"label":"Some","value":"some"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('dry_rot_sidewall_cracking',
   'Have any of the tires lost air recently or shown a pressure warning?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('dry_rot_sidewall_cracking',
   'Is the car parked outside in the sun most of the time, or kept in a garage?',
   '[{"label":"Outside in sun","value":"sun"},{"label":"In garage","value":"garage"},{"label":"Mix","value":"mix"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Just Want New Tires (7) ───────────────────────────────────────
  ('just_want_new_tires',
   'Are you replacing all four tires, just the front pair, just the rear pair, or only one?',
   '[{"label":"All four","value":"all"},{"label":"Front pair","value":"front"},{"label":"Rear pair","value":"rear"},{"label":"Only one","value":"one"}]',
   1),
  ('just_want_new_tires',
   'Do you know what brand or model of tire is currently on the vehicle, or do you want a recommendation?',
   '[{"label":"I know","value":"know"},{"label":"Want recommendation","value":"recommend"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('just_want_new_tires',
   'Are you looking for the lowest-cost option, a mid-range tire, or a longer-lasting premium tire?',
   '[{"label":"Lowest cost","value":"low"},{"label":"Mid-range","value":"mid"},{"label":"Premium","value":"premium"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('just_want_new_tires',
   'Do you do mostly highway driving, mostly around-town driving, or a mix of both?',
   '[{"label":"Mostly highway","value":"highway"},{"label":"Mostly around-town","value":"town"},{"label":"Mix","value":"mix"}]',
   4),
  ('just_want_new_tires',
   'Do you drive in snow or heavy rain regularly, or mostly dry-weather driving?',
   '[{"label":"Snow regularly","value":"snow"},{"label":"Heavy rain","value":"rain"},{"label":"Mostly dry","value":"dry"},{"label":"Mix","value":"mix"}]',
   5),
  ('just_want_new_tires',
   'Has the vehicle had an alignment in the last year, or would you like us to check it with the new tires?',
   '[{"label":"Yes — had alignment","value":"yes"},{"label":"Please check","value":"check"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('just_want_new_tires',
   'Are you planning to keep this vehicle for several more years, or only another year or two?',
   '[{"label":"Several more years","value":"long"},{"label":"Another year or two","value":"short"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Recent Tire Work Then New Symptom (7) ─────────────────────────
  ('recent_tire_work_then_new_symptom',
   'What work was done — new tires, a rotation, a patch or plug, a balance, or a flat repair?',
   '[{"label":"New tires","value":"new"},{"label":"Rotation","value":"rotation"},{"label":"Patch/plug","value":"patch"},{"label":"Balance","value":"balance"},{"label":"Flat repair","value":"flat"}]',
   1),
  ('recent_tire_work_then_new_symptom',
   'Roughly when was the work done — a few days ago, a week ago, or longer?',
   '[{"label":"Few days ago","value":"days"},{"label":"A week ago","value":"week"},{"label":"Longer","value":"longer"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('recent_tire_work_then_new_symptom',
   'What is the new symptom — vibration, noise, pulling, a warning light, or the tire losing air again?',
   '[{"label":"Vibration","value":"vibration"},{"label":"Noise","value":"noise"},{"label":"Pulling","value":"pulling"},{"label":"Warning light","value":"light"},{"label":"Losing air","value":"air"}]',
   3),
  ('recent_tire_work_then_new_symptom',
   'At what speed does the issue show up — only on the highway, only at lower speeds, or all the time?',
   '[{"label":"Only highway","value":"highway"},{"label":"Only lower speeds","value":"low"},{"label":"All the time","value":"all"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('recent_tire_work_then_new_symptom',
   'If it''s a vibration, do you feel it more in the steering wheel or in the seat?',
   '[{"label":"Steering wheel","value":"steering"},{"label":"Seat","value":"seat"},{"label":"Both","value":"both"},{"label":"N/A","value":"na"}]',
   5),
  ('recent_tire_work_then_new_symptom',
   'Did the same shop that did the work get a chance to look at it again, or is this the first time it''s being checked?',
   '[{"label":"Yes — re-checked","value":"yes"},{"label":"First time","value":"first"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('recent_tire_work_then_new_symptom',
   'Was a tire pressure sensor disturbed, replaced, or does the warning light keep coming on since the work was done?',
   '[{"label":"Sensor disturbed","value":"disturbed"},{"label":"Sensor replaced","value":"replaced"},{"label":"Warning light","value":"light"},{"label":"No","value":"no"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'tires',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2F. Seed vibration questions (6 subs × 7 questions = 42)
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'vibration'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Steering Wheel Shake at Highway Speed (7) ─────────────────────
  ('steering_wheel_shake_at_highway_speed',
   'Does the shaking start at a specific speed, like around 50 or 60 mph?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('steering_wheel_shake_at_highway_speed',
   'Does the shaking get better or go away if you speed up past that point?',
   '[{"label":"Better","value":"better"},{"label":"Worse","value":"worse"},{"label":"No change","value":"same"}]',
   2),
  ('steering_wheel_shake_at_highway_speed',
   'If you carefully let off the gas and coast, does the shaking stay the same?',
   '[{"label":"Stays same","value":"same"},{"label":"Better","value":"better"},{"label":"Worse","value":"worse"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('steering_wheel_shake_at_highway_speed',
   'Is the shake mostly in the steering wheel, or do you also feel it in your seat?',
   '[{"label":"Steering wheel","value":"steering"},{"label":"Seat too","value":"both"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('steering_wheel_shake_at_highway_speed',
   'Have you hit a pothole, curb, or big bump recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('steering_wheel_shake_at_highway_speed',
   'Have you had new tires put on, tires rotated, or wheels balanced in the last few months?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('steering_wheel_shake_at_highway_speed',
   'Does the car pull to one side at the same time the shaking happens?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   7),

  -- ── Vibration or Pulsing When Braking (7) ─────────────────────────
  ('vibration_or_pulsing_when_braking',
   'Does the shaking only happen when you press the brake pedal?',
   '[{"label":"Yes — only braking","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('vibration_or_pulsing_when_braking',
   'Do you feel the brake pedal pushing back up against your foot as you slow down?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('vibration_or_pulsing_when_braking',
   'Is it worse when slowing down from highway speeds, or when stopping from low speeds?',
   '[{"label":"Worse from highway","value":"highway"},{"label":"Worse from low speeds","value":"low"},{"label":"About the same","value":"same"}]',
   3),
  ('vibration_or_pulsing_when_braking',
   'Do you feel the shake in the steering wheel, the seat, the brake pedal, or all three?',
   '[{"label":"Steering wheel","value":"steering"},{"label":"Seat","value":"seat"},{"label":"Pedal","value":"pedal"},{"label":"All three","value":"all"}]',
   4),
  ('vibration_or_pulsing_when_braking',
   'Does it get worse after a long downhill drive or after towing something heavy?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t done either","value":"na"}]',
   5),
  ('vibration_or_pulsing_when_braking',
   'Have you had any brake work done in the last year?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('vibration_or_pulsing_when_braking',
   'Does the car pull to one side when you brake at the same time?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   7),

  -- ── Shaking at Idle While Stopped (7) ─────────────────────────────
  ('shaking_at_idle_while_stopped',
   'Does the shaking happen when the car is sitting still in Drive or Reverse?',
   '[{"label":"Yes — Drive","value":"drive"},{"label":"Yes — Reverse","value":"reverse"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   1),
  ('shaking_at_idle_while_stopped',
   'Does it smooth out or get better when you shift into Park or Neutral?',
   '[{"label":"Yes — smooths","value":"yes"},{"label":"No change","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('shaking_at_idle_while_stopped',
   'Does it get noticeably worse when you turn the air conditioning on?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('shaking_at_idle_while_stopped',
   'Is the check engine light on, flashing, or has it been on recently?',
   '[{"label":"On steady","value":"steady"},{"label":"Flashing","value":"flashing"},{"label":"On recently","value":"recent"},{"label":"Off","value":"off"}]',
   4),
  ('shaking_at_idle_while_stopped',
   'Does the engine sound rough, sputtery, or like it''s about to stall?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   5),
  ('shaking_at_idle_while_stopped',
   'Does it shake more when the engine is cold first thing in the morning, or after it warms up?',
   '[{"label":"Cold","value":"cold"},{"label":"Warmed up","value":"warm"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('shaking_at_idle_while_stopped',
   'Have you noticed any drop in gas mileage recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Shaking When Speeding Up or Going Uphill (7) ──────────────────
  ('shaking_when_speeding_up_or_going_uphill',
   'Does the shaking only happen when you''re pressing the gas, and go away when you let off?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('shaking_when_speeding_up_or_going_uphill',
   'Is it worse when you''re really pushing the engine, like passing on the highway or climbing a hill?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('shaking_when_speeding_up_or_going_uphill',
   'Do you hear any clicking or popping noises when turning, especially in tight parking lots?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('shaking_when_speeding_up_or_going_uphill',
   'Have you noticed any grease or oil splatter on the inside of your wheels?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('shaking_when_speeding_up_or_going_uphill',
   'Does the shaking come and go, or is it there every time you accelerate?',
   '[{"label":"Comes and goes","value":"intermittent"},{"label":"Every time","value":"every"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('shaking_when_speeding_up_or_going_uphill',
   'Do you feel it more through the floor and seat than the steering wheel?',
   '[{"label":"Floor/seat","value":"floor"},{"label":"Steering wheel","value":"steering"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('shaking_when_speeding_up_or_going_uphill',
   'Has the transmission been slipping or shifting strangely along with the shaking?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Shaking or Bouncing Over Bumps and Rough Roads (7) ────────────
  ('shaking_or_bouncing_over_bumps_and_rough_roads',
   'Does the car keep bouncing more than once or twice after going over a bump?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('shaking_or_bouncing_over_bumps_and_rough_roads',
   'Do you hear a clunking or knocking noise when you hit bumps or dips?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('shaking_or_bouncing_over_bumps_and_rough_roads',
   'Does the car feel like it''s wandering or hard to keep straight on uneven pavement?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('shaking_or_bouncing_over_bumps_and_rough_roads',
   'Is the ride a lot rougher than it used to be, even on roads that used to feel fine?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('shaking_or_bouncing_over_bumps_and_rough_roads',
   'Have you noticed any oily fluid leaking near the wheels or shock absorbers?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('shaking_or_bouncing_over_bumps_and_rough_roads',
   'Does the front end dive down more than usual when you brake hard?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('shaking_or_bouncing_over_bumps_and_rough_roads',
   'Are your tires wearing unevenly, with bald spots or scalloped patches?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   7),

  -- ── Constant Vibration That Doesn''t Change With Speed (7) ────────
  ('constant_vibration_that_doesnt_change_with_speed',
   'Is the vibration there even when the car is barely moving, like in a parking lot?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('constant_vibration_that_doesnt_change_with_speed',
   'Does it stay roughly the same whether you''re going 25 mph or 65 mph?',
   '[{"label":"Yes — same","value":"yes"},{"label":"No — changes","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('constant_vibration_that_doesnt_change_with_speed',
   'Do you feel it more in the floor, the seat, or all over the car?',
   '[{"label":"Floor","value":"floor"},{"label":"Seat","value":"seat"},{"label":"All over","value":"all"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('constant_vibration_that_doesnt_change_with_speed',
   'Have you driven through anything recently that could have damaged a wheel, like a deep pothole?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('constant_vibration_that_doesnt_change_with_speed',
   'Does the vibration change at all when you turn the steering wheel left or right?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('constant_vibration_that_doesnt_change_with_speed',
   'Have you had a tire repaired or patched recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('constant_vibration_that_doesnt_change_with_speed',
   'Does it feel like something is loose or flopping under the car?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'vibration',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2G. Seed warning_light questions (12 subs, 83 questions)
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'warning_light'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Check Engine Light (7) ────────────────────────────────────────
  ('check_engine_light',
   'Is the light flashing/blinking or just steady on?',
   '[{"label":"Flashing/blinking","value":"flashing"},{"label":"Steady on","value":"steady"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('check_engine_light',
   'Does the engine feel rough, like it''s shaking, hesitating, or losing power?',
   '[{"label":"Yes — shaking","value":"shaking"},{"label":"Yes — hesitating","value":"hesitating"},{"label":"Yes — losing power","value":"power_loss"},{"label":"No","value":"no"}]',
   2),
  ('check_engine_light',
   'Have you noticed any unusual smells, especially something that smells like rotten eggs or burning?',
   '[{"label":"Yes — rotten eggs","value":"rotten"},{"label":"Yes — burning","value":"burning"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('check_engine_light',
   'Did the light come on right after you filled up with gas? Did you check that your gas cap is tight?',
   '[{"label":"After filling — cap loose","value":"loose"},{"label":"After filling — cap tight","value":"tight"},{"label":"Not after filling","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('check_engine_light',
   'Is the car using more gas than usual, or is there any black smoke coming out of the tailpipe?',
   '[{"label":"Yes — more gas","value":"gas"},{"label":"Yes — black smoke","value":"smoke"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   5),
  ('check_engine_light',
   'About how long has the light been on, and does it ever turn itself off and come back on later?',
   '[{"label":"Constant","value":"constant"},{"label":"Comes and goes","value":"intermittent"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('check_engine_light',
   'Have you noticed any clicking, ticking, or popping sounds from the engine while the light is on?',
   '[{"label":"Yes — clicking","value":"clicking"},{"label":"Yes — ticking","value":"ticking"},{"label":"Yes — popping","value":"popping"},{"label":"No","value":"no"}]',
   7),

  -- ── Service Engine Soon / Maintenance Required Light (6) ──────────
  ('service_engine_soon_maintenance_required',
   'Does the message on your dash say "Service Engine Soon," "Maintenance Required," or "Service Due" — anything that sounds like a reminder rather than an alarm?',
   '[{"label":"Service Engine Soon","value":"ses"},{"label":"Maintenance Required","value":"maint"},{"label":"Service Due","value":"due"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('service_engine_soon_maintenance_required',
   'About how many miles has it been since your last oil change or scheduled service?',
   '[{"label":"Under 3,000","value":"low"},{"label":"3,000-7,500","value":"medium"},{"label":"Over 7,500","value":"high"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('service_engine_soon_maintenance_required',
   'Does the car feel and drive completely normal otherwise?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('service_engine_soon_maintenance_required',
   'Did the light come on at a round-number mileage, like right at 5,000 or 75,000 miles?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('service_engine_soon_maintenance_required',
   'Is there a separate check engine light on too, or is this the only warning showing?',
   '[{"label":"Yes — check engine too","value":"yes"},{"label":"No — only this one","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('service_engine_soon_maintenance_required',
   'Has anyone reset this reminder for you recently after a service?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),

  -- ── Battery / Charging Light (7) ──────────────────────────────────
  ('battery_charging_light',
   'Did the light come on suddenly while you were driving, or did it gradually start showing up?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Gradually","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('battery_charging_light',
   'When you turn the car off and try to start it again, does it crank slowly, click, or not start at all?',
   '[{"label":"Cranks slowly","value":"slow"},{"label":"Just clicks","value":"click"},{"label":"Won''t start","value":"no_start"},{"label":"Starts normally","value":"normal"}]',
   2),
  ('battery_charging_light',
   'Have you noticed your headlights or dashboard lights getting dimmer, especially at idle or when you turn other things on?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('battery_charging_light',
   'Are your power windows, radio, or wipers running slower or acting weird?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('battery_charging_light',
   'Have you had to jump-start the car recently, or have you replaced the battery in the last couple of years?',
   '[{"label":"Yes — jumped recently","value":"jumped"},{"label":"Yes — new battery","value":"new"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   5),
  ('battery_charging_light',
   'Do you hear any squealing or whining sound from under the hood when the light is on?',
   '[{"label":"Yes — squealing","value":"squealing"},{"label":"Yes — whining","value":"whining"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('battery_charging_light',
   'Does the light go off when you rev the engine, or does it stay on no matter what?',
   '[{"label":"Goes off when revving","value":"off_rev"},{"label":"Stays on","value":"stays"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Oil Pressure Light (7) ────────────────────────────────────────
  ('oil_pressure_light',
   'Did you pull over and shut the engine off when the light came on, or have you been driving with it on?',
   '[{"label":"Pulled over and shut off","value":"stopped"},{"label":"Still driving","value":"driving"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('oil_pressure_light',
   'Have you checked the oil level on the dipstick? If yes, was it low, empty, or normal?',
   '[{"label":"Low","value":"low"},{"label":"Empty","value":"empty"},{"label":"Normal","value":"normal"},{"label":"Haven''t checked","value":"unsure"}]',
   2),
  ('oil_pressure_light',
   'When was your last oil change, and do you know if the car has been burning or leaking oil between changes?',
   '[{"label":"Recent / no burning","value":"good"},{"label":"Recent / burning oil","value":"burning"},{"label":"Recent / leaking","value":"leaking"},{"label":"Long ago / not sure","value":"unsure"}]',
   3),
  ('oil_pressure_light',
   'Do you hear any ticking, tapping, or knocking noises from the engine when it''s running?',
   '[{"label":"Yes — ticking","value":"ticking"},{"label":"Yes — tapping","value":"tapping"},{"label":"Yes — knocking","value":"knocking"},{"label":"No","value":"no"}]',
   4),
  ('oil_pressure_light',
   'Did the light come on suddenly, or does it flicker on and off — maybe at idle or when stopping at a light?',
   '[{"label":"Suddenly steady","value":"sudden"},{"label":"Flickers at idle","value":"flickers"},{"label":"Comes and goes","value":"intermittent"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('oil_pressure_light',
   'Have you noticed any oil spots on your driveway or garage floor?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('oil_pressure_light',
   'Does the light come on and stay on, or does it go away once you start driving?',
   '[{"label":"Stays on","value":"stays"},{"label":"Goes away","value":"goes_away"},{"label":"Comes and goes","value":"intermittent"}]',
   7),

  -- ── Engine Temperature Light (7) ──────────────────────────────────
  ('engine_temperature_light',
   'Is the temperature gauge reading high or in the red zone, or is the gauge normal but the light is still on?',
   '[{"label":"High/red zone","value":"high"},{"label":"Gauge normal","value":"normal"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('engine_temperature_light',
   'Have you seen any steam or smoke coming from under the hood?',
   '[{"label":"Yes — steam","value":"steam"},{"label":"Yes — smoke","value":"smoke"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('engine_temperature_light',
   'Have you checked the coolant reservoir? Is it full, low, or completely empty?',
   '[{"label":"Full","value":"full"},{"label":"Low","value":"low"},{"label":"Empty","value":"empty"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('engine_temperature_light',
   'Have you had to add coolant or water to the car recently, or noticed green, orange, or pink puddles where you park?',
   '[{"label":"Yes — added","value":"added"},{"label":"Yes — puddles","value":"puddles"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   4),
  ('engine_temperature_light',
   'Does the heater inside the car still blow hot, or does it blow cold air now?',
   '[{"label":"Blows hot","value":"hot"},{"label":"Blows cold","value":"cold"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('engine_temperature_light',
   'Did the light come on after sitting in heavy traffic, climbing a hill, or pulling a load?',
   '[{"label":"Heavy traffic","value":"traffic"},{"label":"Climbing hill","value":"hill"},{"label":"Pulling load","value":"load"},{"label":"None","value":"none"}]',
   6),
  ('engine_temperature_light',
   'Have you continued driving with the light on, or did you stop right away?',
   '[{"label":"Stopped right away","value":"stopped"},{"label":"Still driving","value":"driving"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── TPMS / Tire Pressure Light (7) ────────────────────────────────
  ('tpms_tire_pressure_light',
   'Has it been noticeably colder outside recently — like a cold morning or the first chilly day of the season?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('tpms_tire_pressure_light',
   'Is the light steady on, or is it flashing on and off?',
   '[{"label":"Steady on","value":"steady"},{"label":"Flashing","value":"flashing"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('tpms_tire_pressure_light',
   'Do any of your tires look visibly low or flat compared to the others?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('tpms_tire_pressure_light',
   'Have you noticed the car pulling to one side, riding rougher, or feeling slower to respond?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   4),
  ('tpms_tire_pressure_light',
   'Did you recently have tires rotated, replaced, or air added?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('tpms_tire_pressure_light',
   'Have you driven over any potholes, debris, curbs, or noticed a slow leak in any tire?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('tpms_tire_pressure_light',
   'Does the light go off after you''ve been driving for a while, or does it stay on the whole trip?',
   '[{"label":"Goes off","value":"goes_off"},{"label":"Stays on","value":"stays"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── ABS / Anti-Lock Brake Light (7) ───────────────────────────────
  ('abs_anti_lock_brake_light',
   'Are the regular brakes still working normally when you press the pedal — stopping the car like usual?',
   '[{"label":"Yes — normal","value":"yes"},{"label":"No — different","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('abs_anti_lock_brake_light',
   'Is the red BRAKE light on too, or is it just the yellow ABS light?',
   '[{"label":"Yes — red brake too","value":"both"},{"label":"Just yellow ABS","value":"abs_only"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('abs_anti_lock_brake_light',
   'When you brake hard or on a slippery surface, do you feel pulsing or vibrating in the pedal like normal, or nothing at all?',
   '[{"label":"Pulses/vibrates normally","value":"normal"},{"label":"Nothing","value":"nothing"},{"label":"Haven''t tried","value":"unsure"}]',
   3),
  ('abs_anti_lock_brake_light',
   'Have you noticed the car pulling to one side when braking, or one wheel locking up?',
   '[{"label":"Yes — pulls","value":"pulls"},{"label":"Yes — wheel locks","value":"locks"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('abs_anti_lock_brake_light',
   'Did the light come on right after driving through deep water, a car wash, or hitting a big pothole or curb?',
   '[{"label":"Yes — water/car wash","value":"water"},{"label":"Yes — pothole/curb","value":"impact"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('abs_anti_lock_brake_light',
   'Have you had any brake work, tire work, or wheel bearing work done recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('abs_anti_lock_brake_light',
   'Does the light come on every time you start the car, or only sometimes while driving?',
   '[{"label":"Every time","value":"every"},{"label":"Only sometimes","value":"sometimes"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Brake System (Red) Light (7) ──────────────────────────────────
  ('brake_system_red_light',
   'First thing — is your parking brake or emergency brake fully released?',
   '[{"label":"Yes — fully released","value":"yes"},{"label":"No — still engaged","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('brake_system_red_light',
   'Does the brake pedal feel different — softer, spongy, sinking to the floor, or harder than normal?',
   '[{"label":"Softer/spongy","value":"soft"},{"label":"Sinking to floor","value":"sinking"},{"label":"Harder","value":"hard"},{"label":"Normal","value":"normal"}]',
   2),
  ('brake_system_red_light',
   'Have you checked the brake fluid reservoir under the hood? Was the level near the MIN line or below?',
   '[{"label":"Near MIN/below","value":"low"},{"label":"Normal","value":"normal"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('brake_system_red_light',
   'Is the yellow ABS light on at the same time, or is it just the red brake light?',
   '[{"label":"Yes — ABS too","value":"both"},{"label":"Just red brake","value":"red_only"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('brake_system_red_light',
   'Does the car still stop normally when you press the brake, or does it take longer than usual?',
   '[{"label":"Stops normally","value":"normal"},{"label":"Takes longer","value":"longer"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('brake_system_red_light',
   'Have you noticed any fluid leaking near any of the wheels or in the spot where you park?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('brake_system_red_light',
   'Did the light come on suddenly, or did it start coming on and going off before staying on?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Intermittent then steady","value":"intermittent"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Airbag / SRS Light (7) ────────────────────────────────────────
  ('airbag_srs_light',
   'Has the car been in any kind of accident, collision, or hard bump recently — even a minor one?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('airbag_srs_light',
   'Has anyone done work on the seats, dashboard, steering wheel, or seat belts recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('airbag_srs_light',
   'Is there anything stuck in any seat belt buckle — a coin, a crumb, a piece of plastic?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('airbag_srs_light',
   'Did you recently have a car seat installed or use the front passenger seat occupancy area differently than usual?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('airbag_srs_light',
   'Does the light flash a pattern of blinks, or is it just on steady?',
   '[{"label":"Pattern of blinks","value":"pattern"},{"label":"Steady on","value":"steady"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('airbag_srs_light',
   'Has the car been sitting unused for a long time, or has the battery been disconnected or replaced recently?',
   '[{"label":"Sitting unused","value":"unused"},{"label":"Battery disconnected/replaced","value":"battery"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   6),
  ('airbag_srs_light',
   'Did the light come on right after driving through a flooded area or getting the interior wet?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Traction Control / Stability Light (7) ────────────────────────
  ('traction_control_stability_light',
   'Is the light on steady all the time, or does it only flash briefly when the road is slippery?',
   '[{"label":"Steady all the time","value":"steady"},{"label":"Flashes briefly on slippery road","value":"flashes"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('traction_control_stability_light',
   'Is the ABS light on at the same time, or just the traction/stability light?',
   '[{"label":"Yes — ABS too","value":"both"},{"label":"Just traction","value":"traction_only"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('traction_control_stability_light',
   'Have you noticed the car feeling slippery, losing grip, or wheels spinning when you don''t expect it?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('traction_control_stability_light',
   'Did the light come on after driving in snow, rain, mud, or off-road?',
   '[{"label":"Yes — snow/rain/mud","value":"weather"},{"label":"Yes — off-road","value":"off_road"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('traction_control_stability_light',
   'Have you recently put on new tires, especially a different size or only replaced one or two?',
   '[{"label":"Yes — new tires","value":"new"},{"label":"Yes — different size","value":"different_size"},{"label":"Yes — partial set","value":"partial"},{"label":"No","value":"no"}]',
   5),
  ('traction_control_stability_light',
   'Did you accidentally press the traction-control button to turn the system off?',
   '[{"label":"Yes — possibly","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('traction_control_stability_light',
   'Does the steering feel heavier, or have you noticed any other warning lights joining this one?',
   '[{"label":"Yes — heavier","value":"heavier"},{"label":"Yes — other lights","value":"other_lights"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   7),

  -- ── Power Steering / EPS Light (7) ────────────────────────────────
  ('power_steering_eps_light',
   'Is the steering wheel harder to turn than usual, especially at low speeds or when parking?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('power_steering_eps_light',
   'Does the steering feel heavy all the time, or only when the light is on?',
   '[{"label":"All the time","value":"always"},{"label":"Only when light is on","value":"when_light"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('power_steering_eps_light',
   'Have you heard any whining or groaning sound when turning the wheel?',
   '[{"label":"Yes — whining","value":"whining"},{"label":"Yes — groaning","value":"groaning"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('power_steering_eps_light',
   'Did you notice the light come on right after starting the car, or did it come on while you were already driving?',
   '[{"label":"After starting","value":"startup"},{"label":"While driving","value":"driving"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('power_steering_eps_light',
   'Has your battery been weak, dead, or recently replaced?',
   '[{"label":"Yes — weak","value":"weak"},{"label":"Yes — dead","value":"dead"},{"label":"Yes — replaced","value":"replaced"},{"label":"No","value":"no"}]',
   5),
  ('power_steering_eps_light',
   'Are there any reddish-pink fluid spots where you park (only applies if your car uses hydraulic power steering, not all do)?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure if hydraulic","value":"unsure"}]',
   6),
  ('power_steering_eps_light',
   'Does the light come on and go off on its own, or does it stay on the whole time?',
   '[{"label":"Stays on","value":"stays"},{"label":"Comes and goes","value":"intermittent"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Multiple Warning Lights At Once (7) ───────────────────────────
  ('multiple_warning_lights_at_once',
   'Which lights are on — can you describe the colors and shapes, or read what they say?',
   '[{"label":"I can describe","value":"can_describe"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('multiple_warning_lights_at_once',
   'Did all the lights come on at the same time, or did they show up one after another?',
   '[{"label":"All at once","value":"at_once"},{"label":"One after another","value":"sequential"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('multiple_warning_lights_at_once',
   'Is the car running rough, losing power, or do the headlights and dashboard look dimmer than normal?',
   '[{"label":"Yes — running rough","value":"rough"},{"label":"Yes — dimmer","value":"dim"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   3),
  ('multiple_warning_lights_at_once',
   'When you try to start the car, does it crank slowly, click, or struggle?',
   '[{"label":"Cranks slowly","value":"slow"},{"label":"Clicks","value":"click"},{"label":"Struggles","value":"struggle"},{"label":"Starts normally","value":"normal"}]',
   4),
  ('multiple_warning_lights_at_once',
   'Have you noticed any burning smell or smoke from under the hood?',
   '[{"label":"Yes — burning smell","value":"smell"},{"label":"Yes — smoke","value":"smoke"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   5),
  ('multiple_warning_lights_at_once',
   'Has the battery been replaced recently, or have you had any electrical work done on the car?',
   '[{"label":"Yes — battery","value":"battery"},{"label":"Yes — electrical work","value":"electrical"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   6),
  ('multiple_warning_lights_at_once',
   'Does anything electrical inside the car act weird — radio resetting, gauges jumping around, windows slow, dome light flickering?',
   '[{"label":"Yes — radio resetting","value":"radio"},{"label":"Yes — gauges jumping","value":"gauges"},{"label":"Yes — windows slow","value":"windows"},{"label":"Yes — dome flickering","value":"dome"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'warning_light',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 3. Sanity check — verify all 7 categories' counts
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_subcategory_count INT;
  v_question_count INT;
  v_orphan_count INT;
  v_category TEXT;
  v_expected_subs INT;
  v_expected_questions INT;
  v_total_new_subs INT;
  v_total_new_questions INT;
BEGIN
  -- Per-category counts (excluding 'general' fallback subcategory)
  FOR v_category, v_expected_subs, v_expected_questions IN
    SELECT * FROM (VALUES
      ('pulling',       6, 42),
      ('smell',         8, 56),
      ('smoke',         6, 42),
      ('steering',      7, 49),
      ('tires',         7, 49),
      ('vibration',     6, 42),
      ('warning_light',12, 83)
    ) AS t(category, expected_subs, expected_questions)
  LOOP
    -- Subcategory count for this category (excluding 'general')
    SELECT COUNT(*) INTO v_subcategory_count
      FROM public.concern_subcategories
     WHERE shop_id = 7476
       AND category = v_category
       AND slug != 'general'
       AND active = TRUE;
    IF v_subcategory_count < v_expected_subs THEN
      RAISE EXCEPTION
        '% subcategory seed incomplete: % rows (expected %)',
        v_category, v_subcategory_count, v_expected_subs;
    END IF;

    -- Question count for this category (excluding 'general' fallback questions)
    SELECT COUNT(*) INTO v_question_count
      FROM public.concern_questions cq
      JOIN public.concern_subcategories cs ON cs.id = cq.subcategory_id
     WHERE cq.shop_id = 7476
       AND cq.category = v_category
       AND cs.slug != 'general'
       AND cq.active = TRUE;
    IF v_question_count < v_expected_questions THEN
      RAISE EXCEPTION
        '% question seed incomplete: % subcategory-linked rows (expected %)',
        v_category, v_question_count, v_expected_questions;
    END IF;

    -- Defensive: no orphan questions for this category
    SELECT COUNT(*) INTO v_orphan_count
      FROM public.concern_questions cq
      LEFT JOIN public.concern_subcategories cs ON cs.id = cq.subcategory_id
     WHERE cq.shop_id = 7476
       AND cq.category = v_category
       AND (cs.id IS NULL OR cs.category != cq.category);
    IF v_orphan_count > 0 THEN
      RAISE EXCEPTION
        '% question seed corrupted: % rows have NULL or cross-category subcategory_id',
        v_category, v_orphan_count;
    END IF;
  END LOOP;

  -- Aggregate sanity: 52 subs + 363 questions across these 7 categories
  SELECT COUNT(*) INTO v_total_new_subs
    FROM public.concern_subcategories
   WHERE shop_id = 7476
     AND category IN ('pulling','smell','smoke','steering','tires','vibration','warning_light')
     AND slug != 'general'
     AND active = TRUE;
  IF v_total_new_subs < 52 THEN
    RAISE EXCEPTION
      'part2 seed total subcategories incomplete: % rows (expected 52 across 7 categories)',
      v_total_new_subs;
  END IF;

  SELECT COUNT(*) INTO v_total_new_questions
    FROM public.concern_questions cq
    JOIN public.concern_subcategories cs ON cs.id = cq.subcategory_id
   WHERE cq.shop_id = 7476
     AND cq.category IN ('pulling','smell','smoke','steering','tires','vibration','warning_light')
     AND cs.slug != 'general'
     AND cq.active = TRUE;
  IF v_total_new_questions < 363 THEN
    RAISE EXCEPTION
      'part2 seed total questions incomplete: % rows (expected 363 across 7 categories)',
      v_total_new_questions;
  END IF;
END $$;


COMMIT;


-- ---------------------------------------------------------------------
-- Post-deploy verification (Chris runs after `supabase db push`)
-- ---------------------------------------------------------------------
--
-- Per-category subcategory + question counts:
--   SELECT cs.category, cs.slug, cs.display_label, cs.display_order,
--          COUNT(cq.id) FILTER (WHERE cq.active = TRUE) AS question_count
--     FROM public.concern_subcategories cs
--     LEFT JOIN public.concern_questions cq
--       ON cq.subcategory_id = cs.id
--    WHERE cs.shop_id = 7476
--      AND cs.category IN ('pulling','smell','smoke','steering','tires','vibration','warning_light')
--      AND cs.slug != 'general'
--      AND cs.active = TRUE
--    GROUP BY cs.category, cs.slug, cs.display_label, cs.display_order
--    ORDER BY cs.category, cs.display_order;
--
-- Expected per category:
--   pulling       — 6 subs, 7 questions each = 42 total
--   smell         — 8 subs, 7 questions each = 56 total
--   smoke         — 6 subs, 7 questions each = 42 total
--   steering      — 7 subs, 7 questions each = 49 total
--   tires         — 7 subs, 7 questions each = 49 total
--   vibration     — 6 subs, 7 questions each = 42 total
--   warning_light — 12 subs (CEL/SES/Batt/Oil/Temp/TPMS/ABS/Brake/Airbag/Traction/PowerSteer/Multi)
--                   7 questions each except SES (6) = 83 total
--
-- Aggregate totals across 7 categories: 52 subs, 363 questions
--
-- Live diagnostic test examples:
--   "My check engine light is flashing" → LLM matches 'check_engine_light'
--   "I smell antifreeze" → LLM matches 'sweet_smell'
--   "The car drifts left on the highway" → LLM matches 'steady_drift_while_cruising'
--   "Tire pressure light is on" → LLM matches 'low_pressure_warning_light_only'
--   "Steering wheel shakes at 60 mph" → LLM matches 'steering_wheel_shake_at_highway_speed'
-- ---------------------------------------------------------------------
