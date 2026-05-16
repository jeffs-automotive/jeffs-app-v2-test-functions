-- =====================================================================
-- Concern diagnostic subcategory + question seed — part 1 of 2
-- =====================================================================
-- Created 2026-05-16. Follows the brakes precedent established in
-- migration 20260516210000_scheduler_brakes_subcategory_seed.sql.
--
-- Background: the diagnostic flow (chat-design.md "Architecture amendment
-- — 2026-05-14" §Step 7 redesign) does a two-stage LLM call:
--
--   Stage 1 — subcategory filter: given the customer's description,
--             pick which symptom-bucket subcategories match.
--   Stage 2 — gap detection: from the matched subcategories' questions,
--             drop the ones the description already answered.
--
-- This migration covers 6 of the remaining categories — electrical,
-- hvac, leak, noise, other, performance — sourcing subcategories and
-- questions verbatim from each docs/scheduler/concerns/{cat}/{cat}-
-- concerns.md file. Options arrays are inferred from question wording
-- per the heuristics documented in the brakes seed.
--
-- Counts per category (subcategory_count / question_count):
--   electrical    7 / 49
--   hvac          8 / 56
--   leak          7 / 49
--   noise        10 / 70
--   other         6 / 42
--   performance   9 / 63
--   ─────────────────────
--   TOTAL        47 / 329
--
-- Idempotent re-apply:
--   - Subcategory inserts use ON CONFLICT (shop_id, category, slug)
--   - Question inserts use ON CONFLICT (shop_id, category, question_text)
-- =====================================================================

BEGIN;


-- ---------------------------------------------------------------------
-- 1. Insert all 47 subcategories across 6 categories
-- ---------------------------------------------------------------------

INSERT INTO public.concern_subcategories
  (shop_id, category, slug, display_label, display_order, active)
VALUES
  -- electrical (7)
  (7476, 'electrical', 'wont_crank_just_clicks',          'Won''t Crank / Just Clicks',                              1, TRUE),
  (7476, 'electrical', 'slow_crank_sluggish_start',       'Slow Crank / Sluggish Start',                            2, TRUE),
  (7476, 'electrical', 'battery_drains_overnight',        'Battery Drains Overnight',                               3, TRUE),
  (7476, 'electrical', 'dim_or_flickering_lights',        'Dim or Flickering Lights',                               4, TRUE),
  (7476, 'electrical', 'an_accessory_doesnt_work',        'An Accessory Doesn''t Work',                             5, TRUE),
  (7476, 'electrical', 'multiple_random_electrical_glitches', 'Multiple Random Electrical Glitches',                6, TRUE),
  (7476, 'electrical', 'car_died_while_driving_electrical',   'Car Died While Driving (Electrical)',                7, TRUE),

  -- hvac (8)
  (7476, 'hvac', 'ac_blows_warm_or_hot_air',              'AC Blows Warm or Hot Air',                               1, TRUE),
  (7476, 'hvac', 'ac_is_weak_not_cold_enough',            'AC is Weak (Not Cold Enough)',                           2, TRUE),
  (7476, 'hvac', 'heat_doesnt_work',                      'Heat Doesn''t Work',                                     3, TRUE),
  (7476, 'hvac', 'vents_dont_blow_strongly',              'Vents Don''t Blow Strongly (Weak Airflow)',              4, TRUE),
  (7476, 'hvac', 'foggy_or_hard_to_defog_windows',        'Foggy or Hard-to-Defog Windows',                         5, TRUE),
  (7476, 'hvac', 'strange_noise_from_vents',              'Strange Noise From Vents',                               6, TRUE),
  (7476, 'hvac', 'bad_smell_from_vents',                  'Bad Smell From Vents (Musty / Sweet / Other)',           7, TRUE),
  (7476, 'hvac', 'one_zone_works_but_another_doesnt',     'One Zone Works But Another Doesn''t',                    8, TRUE),

  -- leak (7)
  (7476, 'leak', 'brown_or_black_puddle_engine_oil',      'Brown or Black Puddle (Engine Oil)',                     1, TRUE),
  (7476, 'leak', 'green_orange_yellow_or_pink_puddle_coolant', 'Green, Orange, Yellow, or Pink Puddle (Antifreeze / Coolant)', 2, TRUE),
  (7476, 'leak', 'red_or_pink_puddle_transmission_or_power_steering', 'Red or Pink Puddle (Transmission or Power Steering Fluid)', 3, TRUE),
  (7476, 'leak', 'clear_yellow_or_light_brown_puddle_brake_fluid', 'Clear, Yellow, or Light Brown Puddle (Brake Fluid — Safety Concern)', 4, TRUE),
  (7476, 'leak', 'clear_odorless_puddle_water_or_ac',     'Clear, Odorless Puddle (Likely Water / AC Condensation)', 5, TRUE),
  (7476, 'leak', 'thick_dark_brown_puddle_gear_oil',      'Thick Dark Brown Puddle With Strong Smell (Gear / Differential Oil)', 6, TRUE),
  (7476, 'leak', 'blue_or_light_blue_puddle_washer_fluid','Blue or Light Blue Puddle (Windshield Washer Fluid)',    7, TRUE),

  -- noise (10)
  (7476, 'noise', 'engine_ticking_or_tapping',            'Engine Ticking or Tapping',                              1, TRUE),
  (7476, 'noise', 'clunking_over_bumps',                  'Clunking Over Bumps',                                    2, TRUE),
  (7476, 'noise', 'humming_or_whirring_at_speed',         'Humming or Whirring at Speed',                           3, TRUE),
  (7476, 'noise', 'high_pitched_whining_under_the_hood',  'High-Pitched Whining Under the Hood',                    4, TRUE),
  (7476, 'noise', 'rattling_underneath_the_car',          'Rattling Underneath the Car',                            5, TRUE),
  (7476, 'noise', 'hissing_noise',                        'Hissing Noise',                                          6, TRUE),
  (7476, 'noise', 'popping_or_clicking_when_turning',     'Popping or Clicking When Turning',                       7, TRUE),
  (7476, 'noise', 'deep_knocking_from_the_engine',        'Deep Knocking from the Engine',                          8, TRUE),
  (7476, 'noise', 'squeaking_or_creaking_over_bumps',     'Squeaking or Creaking Over Bumps',                       9, TRUE),
  (7476, 'noise', 'electrical_buzzing',                   'Electrical Buzzing',                                    10, TRUE),

  -- other (6)
  (7476, 'other', 'multiple_symptoms_not_sure',           'Multiple Symptoms / Not Sure What Category',             1, TRUE),
  (7476, 'other', 'after_a_recent_accident_or_impact',    'After a Recent Accident or Impact',                      2, TRUE),
  (7476, 'other', 'after_recent_service_or_repair_work',  'After Recent Service or Repair Work',                    3, TRUE),
  (7476, 'other', 'safety_concern_dont_feel_safe',        'Safety Concern — Don''t Feel Safe Driving It',           4, TRUE),
  (7476, 'other', 'general_check_up_or_pre_trip',         'General Check-Up or Pre-Trip Inspection',                5, TRUE),
  (7476, 'other', 'car_has_been_sitting_unused',          'Car Has Been Sitting Unused for a Long Time',            6, TRUE),

  -- performance (9)
  (7476, 'performance', 'hesitation_or_lag_when_accelerating', 'Hesitation or Lag When Accelerating',               1, TRUE),
  (7476, 'performance', 'rough_idle_or_shaking_at_a_stop',     'Rough Idle or Shaking at a Stop',                   2, TRUE),
  (7476, 'performance', 'stalling_at_idle_or_when_stopping',   'Stalling at Idle or When Stopping',                 3, TRUE),
  (7476, 'performance', 'stalling_while_driving_under_load',   'Stalling While Driving (Under Load)',               4, TRUE),
  (7476, 'performance', 'hard_to_start_when_cold',             'Hard to Start When Cold (After Sitting Overnight)', 5, TRUE),
  (7476, 'performance', 'hard_to_start_when_hot',              'Hard to Start When Hot (Right After Driving)',      6, TRUE),
  (7476, 'performance', 'low_power_or_wont_accelerate_normally','Low Power or Won''t Accelerate Normally',          7, TRUE),
  (7476, 'performance', 'surging_or_rpms_going_up_and_down',   'Surging or RPMs Going Up and Down on Their Own',    8, TRUE),
  (7476, 'performance', 'engine_misfire_or_bucking_feeling',   'Engine Misfire or Bucking Feeling',                 9, TRUE)
ON CONFLICT (shop_id, category, slug) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2A. ELECTRICAL — 7 subcategories × 7 questions = 49 questions
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'electrical'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Won't Crank / Just Clicks (7) ───────────────────────────────────
  ('wont_crank_just_clicks',
   'When you turn the key or push the button, do you hear a single loud click, rapid clicking like a machine gun, or no sound at all?',
   '[{"label":"Single loud click","value":"single_click"},{"label":"Rapid clicking","value":"rapid_clicking"},{"label":"No sound at all","value":"silent"}]',
   1),
  ('wont_crank_just_clicks',
   'Do the dashboard lights and headlights come on when you turn the key, and if so, do they look normal or do they go dim when you try to start it?',
   '[{"label":"Look normal","value":"normal"},{"label":"Go dim when starting","value":"dim"},{"label":"Don''t come on at all","value":"none"}]',
   2),
  ('wont_crank_just_clicks',
   'Have you tried jumping the car, and if you did, did it start right up after the jump?',
   '[{"label":"Yes — started after jump","value":"started"},{"label":"Yes — still wouldn''t start","value":"no_start"},{"label":"Haven''t tried jumping","value":"not_tried"}]',
   3),
  ('wont_crank_just_clicks',
   'How old is the battery — less than 2 years, 2 to 4 years, more than 4 years, or you''re not sure?',
   '[{"label":"Less than 2 years","value":"under_2"},{"label":"2 to 4 years","value":"2_to_4"},{"label":"More than 4 years","value":"over_4"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('wont_crank_just_clicks',
   'Has the car needed a jump-start recently, and if so, was it once or several times?',
   '[{"label":"Once","value":"once"},{"label":"Several times","value":"several"},{"label":"No","value":"no"}]',
   5),
  ('wont_crank_just_clicks',
   'Did this happen suddenly with no warning, or had the car been getting harder to start over the last few days or weeks?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Gradually harder over time","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('wont_crank_just_clicks',
   'Does it happen every time you try to start it, or does it sometimes start normally if you try again a few times?',
   '[{"label":"Every time","value":"every"},{"label":"Sometimes starts on retry","value":"sometimes"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Slow Crank / Sluggish Start (7) ─────────────────────────────────
  ('slow_crank_sluggish_start',
   'When you turn the key, does the engine sound like it''s turning over slowly or laboring before it finally starts?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('slow_crank_sluggish_start',
   'Is the slow cranking worse in cold weather, hot weather, or about the same regardless of temperature?',
   '[{"label":"Worse in cold weather","value":"cold"},{"label":"Worse in hot weather","value":"hot"},{"label":"About the same","value":"same"}]',
   2),
  ('slow_crank_sluggish_start',
   'Is it worse first thing in the morning after sitting overnight, or just as bad after the car has been sitting only a few hours?',
   '[{"label":"Worse in the morning","value":"morning"},{"label":"Same after a few hours","value":"few_hours"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('slow_crank_sluggish_start',
   'How old is the battery — less than 2 years, 2 to 4 years, more than 4 years, or you''re not sure?',
   '[{"label":"Less than 2 years","value":"under_2"},{"label":"2 to 4 years","value":"2_to_4"},{"label":"More than 4 years","value":"over_4"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('slow_crank_sluggish_start',
   'Has the battery been replaced or had any charging-system work done in the last year or two?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('slow_crank_sluggish_start',
   'Do the headlights look dim when you''re trying to start it, and do they brighten up once it finally fires?',
   '[{"label":"Yes — dim then brighten","value":"yes"},{"label":"No change","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('slow_crank_sluggish_start',
   'After it does start, does it run normally or does it idle rough for the first minute or two?',
   '[{"label":"Runs normally","value":"normal"},{"label":"Idles rough for a minute","value":"rough"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Battery Drains Overnight (7) ────────────────────────────────────
  ('battery_drains_overnight',
   'About how long can the car sit before the battery dies — overnight, a couple of days, or a week or more?',
   '[{"label":"Overnight","value":"overnight"},{"label":"A couple of days","value":"days"},{"label":"A week or more","value":"week"}]',
   1),
  ('battery_drains_overnight',
   'Once you jump it or charge it, does the car start and run normally for the rest of the day?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('battery_drains_overnight',
   'Is there anything you''ve added to the car recently — like a dash cam, aftermarket stereo, remote starter, alarm, or trailer wiring?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('battery_drains_overnight',
   'When you walk up to the car after it''s been sitting, do you ever notice an interior light, glove box light, or trunk light still on?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('battery_drains_overnight',
   'Have you noticed the radio, headlights, or wipers ever staying on for a moment after you''ve turned the key off and shut the door?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('battery_drains_overnight',
   'How old is the battery, and has it been replaced once already because of this same dying-overnight problem?',
   '[{"label":"Less than 2 years — replaced for this","value":"replaced_recent"},{"label":"Less than 2 years — original","value":"original_recent"},{"label":"Older than 2 years","value":"older"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('battery_drains_overnight',
   'Does it die faster in hot weather, cold weather, or does the weather not seem to matter?',
   '[{"label":"Faster in hot weather","value":"hot"},{"label":"Faster in cold weather","value":"cold"},{"label":"Weather doesn''t matter","value":"no_pattern"}]',
   7),

  -- ── Dim or Flickering Lights (7) ────────────────────────────────────
  ('dim_or_flickering_lights',
   'Are the headlights and dashboard lights dim, flickering, or pulsing brighter and dimmer while you''re driving?',
   '[{"label":"Dim","value":"dim"},{"label":"Flickering","value":"flickering"},{"label":"Pulsing brighter and dimmer","value":"pulsing"}]',
   1),
  ('dim_or_flickering_lights',
   'Do the lights change brightness when you rev the engine or when you speed up on the highway?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('dim_or_flickering_lights',
   'Is there a battery-shaped warning light or a "CHARGE" light on the dashboard right now?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   3),
  ('dim_or_flickering_lights',
   'Are the interior lights and radio acting normal, or do they also dim and flicker along with the headlights?',
   '[{"label":"Acting normal","value":"normal"},{"label":"Also dim/flicker","value":"affected"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('dim_or_flickering_lights',
   'Have you noticed any burning smell, like hot rubber or hot wires, coming from under the hood?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('dim_or_flickering_lights',
   'Did you hear any squealing or whining belt noise from under the hood before the dimming started?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('dim_or_flickering_lights',
   'Have you had a new battery or alternator installed recently, and if so, did this problem start before or after that work?',
   '[{"label":"Started after recent work","value":"after_work"},{"label":"Started before recent work","value":"before_work"},{"label":"No recent work","value":"no_work"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── An Accessory Doesn't Work (7) ───────────────────────────────────
  ('an_accessory_doesnt_work',
   'Which specific thing isn''t working — for example one window, all the windows, the radio, the dome light, the wipers, or the power locks?',
   '[{"label":"One window","value":"one_window"},{"label":"All windows","value":"all_windows"},{"label":"Radio","value":"radio"},{"label":"Dome light","value":"dome_light"},{"label":"Wipers","value":"wipers"},{"label":"Power locks","value":"locks"},{"label":"Something else","value":"other"}]',
   1),
  ('an_accessory_doesnt_work',
   'If it''s a window or lock, does only one of them not work, or do several of them on the same side or all over the car not work?',
   '[{"label":"Only one","value":"one"},{"label":"Several on same side","value":"side"},{"label":"All over the car","value":"all"},{"label":"Not applicable","value":"na"}]',
   2),
  ('an_accessory_doesnt_work',
   'Did it stop working all at once, or did it act up for a while — working sometimes, not other times — before completely quitting?',
   '[{"label":"All at once","value":"sudden"},{"label":"Acted up first","value":"intermittent"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('an_accessory_doesnt_work',
   'Did anything happen right before it stopped — like a fender bender, a sound system install, a car wash, or spilling a drink inside?',
   '[{"label":"Yes — I''ll describe","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('an_accessory_doesnt_work',
   'When you try to use it, do you hear any sound at all — a click, a hum, a buzz — or is it completely silent and dead?',
   '[{"label":"Click","value":"click"},{"label":"Hum or buzz","value":"hum"},{"label":"Completely silent","value":"silent"}]',
   5),
  ('an_accessory_doesnt_work',
   'Are any other electrical things in the car acting strange right now, even slightly?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('an_accessory_doesnt_work',
   'Has anyone checked the fuses, and if so, did they find a blown one or did they all look okay?',
   '[{"label":"Found a blown fuse","value":"blown"},{"label":"All looked okay","value":"ok"},{"label":"Haven''t checked","value":"unsure"}]',
   7),

  -- ── Multiple Random Electrical Glitches (7) ─────────────────────────
  ('multiple_random_electrical_glitches',
   'Can you list everything that''s been acting up — for example dash gauges, radio resetting, warning lights coming on for no reason, locks cycling on their own?',
   '[{"label":"Yes — I''ll describe","value":"yes"},{"label":"No clear list","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('multiple_random_electrical_glitches',
   'Do the glitches happen at the same time as each other, or do different things act up at different times?',
   '[{"label":"At the same time","value":"together"},{"label":"At different times","value":"separate"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('multiple_random_electrical_glitches',
   'Is it worse over bumps and rough roads, or does it happen just as much on smooth pavement?',
   '[{"label":"Worse over bumps","value":"bumps"},{"label":"Same on smooth pavement","value":"smooth"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('multiple_random_electrical_glitches',
   'Does it get worse in rainy weather, after a car wash, or after a hot/humid day?',
   '[{"label":"Worse in rain","value":"rain"},{"label":"Worse after car wash","value":"wash"},{"label":"Worse on hot/humid days","value":"humid"},{"label":"No pattern","value":"no_pattern"}]',
   4),
  ('multiple_random_electrical_glitches',
   'Has the car been in a flood, had a leak, or been driven through deep water at any point?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('multiple_random_electrical_glitches',
   'Has anyone done any electrical work on the car recently — battery, alternator, stereo, aftermarket lights, remote starter?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('multiple_random_electrical_glitches',
   'Have you noticed any check-engine light, ABS light, traction-control light, or airbag light coming on along with the other problems?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Car Died While Driving (Electrical) (7) ─────────────────────────
  ('car_died_while_driving_electrical',
   'Right before the car died, did the dashboard lights and headlights start getting dim or flicker?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('car_died_while_driving_electrical',
   'Did the engine sputter and lose power gradually, or did everything just shut off all at once like flipping a switch?',
   '[{"label":"Sputtered gradually","value":"gradual"},{"label":"All at once","value":"sudden"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('car_died_while_driving_electrical',
   'Was the battery warning light or "CHARGE" light on the dashboard before it died?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('car_died_while_driving_electrical',
   'Did you hear any squealing belt noise, grinding, or knocking from under the hood beforehand?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('car_died_while_driving_electrical',
   'After it died, did the starter try to crank when you turned the key, or did you get nothing — no lights, no clicks, no sound?',
   '[{"label":"Cranked but didn''t fire","value":"cranked"},{"label":"Nothing at all","value":"nothing"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('car_died_while_driving_electrical',
   'Were you using a lot of accessories at the time — like the AC on high, headlights, defroster, heated seats — or driving with only a few things on?',
   '[{"label":"Lots of accessories on","value":"many"},{"label":"Only a few things on","value":"few"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('car_died_while_driving_electrical',
   'Has the car been jump-started recently, and if so, did this happen during that same drive or a day or two later?',
   '[{"label":"Same drive as jump","value":"same_drive"},{"label":"A day or two later","value":"days_later"},{"label":"No recent jump","value":"no_jump"},{"label":"Not sure","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'electrical',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2B. HVAC — 8 subcategories × 7 questions = 56 questions
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'hvac'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── AC Blows Warm or Hot Air (7) ────────────────────────────────────
  ('ac_blows_warm_or_hot_air',
   'Does the AC blow warm air all the time, or does it cool at first and then warm up after a few minutes of driving?',
   '[{"label":"Warm all the time","value":"always_warm"},{"label":"Cools then warms","value":"cools_then_warms"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('ac_blows_warm_or_hot_air',
   'When you turn the AC on, do you hear a click from under the hood like something is kicking in?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('ac_blows_warm_or_hot_air',
   'Does the AC work better when you''re driving on the highway versus sitting at a stoplight?',
   '[{"label":"Better on highway","value":"highway"},{"label":"Same at both","value":"same"},{"label":"Better at stoplight","value":"stoplight"}]',
   3),
  ('ac_blows_warm_or_hot_air',
   'Have you noticed any oily or wet spots on the ground under the front of the car?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('ac_blows_warm_or_hot_air',
   'Has the AC ever been recharged, or had any work done on it in the last year or two?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('ac_blows_warm_or_hot_air',
   'Did the warm air start suddenly one day, or did the cooling get weaker little by little over time?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Gradually","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('ac_blows_warm_or_hot_air',
   'Does it blow warm from every vent (dash, floor, and defrost), or just some of them?',
   '[{"label":"Every vent","value":"all"},{"label":"Just some","value":"some"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── AC is Weak (Not Cold Enough) (7) ────────────────────────────────
  ('ac_is_weak_not_cold_enough',
   'Is the air at least somewhat cool, just not as cold as it used to be?',
   '[{"label":"Yes — somewhat cool","value":"yes"},{"label":"No — barely cool","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('ac_is_weak_not_cold_enough',
   'Does the air get colder when you press the recirculate or "max AC" button?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('ac_is_weak_not_cold_enough',
   'Has the cabin air filter been changed in the last year or two?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('ac_is_weak_not_cold_enough',
   'Does the AC cool better when the car is moving versus when you''re parked?',
   '[{"label":"Better when moving","value":"moving"},{"label":"Same","value":"same"},{"label":"Better parked","value":"parked"}]',
   4),
  ('ac_is_weak_not_cold_enough',
   'Have you noticed any sweet or chemical smell along with the weak cooling?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('ac_is_weak_not_cold_enough',
   'Did the cooling slowly get worse over a season, or did it drop off all at once?',
   '[{"label":"Slowly over a season","value":"gradual"},{"label":"All at once","value":"sudden"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('ac_is_weak_not_cold_enough',
   'Does the system feel weak on hot, humid days but okay on cooler days?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Heat Doesn't Work (7) ───────────────────────────────────────────
  ('heat_doesnt_work',
   'Does the heater blow cold air, room-temperature air, or just a little warm?',
   '[{"label":"Cold air","value":"cold"},{"label":"Room temperature","value":"room"},{"label":"Just a little warm","value":"slightly_warm"}]',
   1),
  ('heat_doesnt_work',
   'Does it take a long time of driving before any warm air comes out, or does it never warm up at all?',
   '[{"label":"Eventually warms up","value":"eventually"},{"label":"Never warms up","value":"never"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('heat_doesnt_work',
   'Does the temperature gauge on the dash get up to its normal spot, or does it stay cold?',
   '[{"label":"Reaches normal","value":"normal"},{"label":"Stays cold","value":"cold"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('heat_doesnt_work',
   'Have you needed to add coolant or antifreeze recently, or noticed the coolant tank running low?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('heat_doesnt_work',
   'Have you seen any puddles or wet spots under the front of the car?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('heat_doesnt_work',
   'Is the heat the same on the driver and passenger side, or different?',
   '[{"label":"Same on both","value":"same"},{"label":"Different sides","value":"different"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('heat_doesnt_work',
   'Did the heat problem start after the car sat for a while, or after any recent service?',
   '[{"label":"After sitting","value":"after_sitting"},{"label":"After recent service","value":"after_service"},{"label":"Neither","value":"neither"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Vents Don't Blow Strongly (7) ───────────────────────────────────
  ('vents_dont_blow_strongly',
   'Is the air weak on every fan speed, or only on certain speeds (like only working on high)?',
   '[{"label":"Weak on every speed","value":"every"},{"label":"Only weak on certain speeds","value":"some"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('vents_dont_blow_strongly',
   'When was the cabin air filter last replaced?',
   '[{"label":"Less than a year ago","value":"recent"},{"label":"1-2 years ago","value":"1_2_years"},{"label":"More than 2 years","value":"old"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('vents_dont_blow_strongly',
   'Is the airflow weak from every vent, or only the dash, floor, or defrost?',
   '[{"label":"Every vent","value":"all"},{"label":"Just dash","value":"dash"},{"label":"Just floor","value":"floor"},{"label":"Just defrost","value":"defrost"}]',
   3),
  ('vents_dont_blow_strongly',
   'Does the air come out stronger when you switch to recirculate?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('vents_dont_blow_strongly',
   'Have you heard any squeaking, grinding, or rattling from behind the dashboard or passenger footwell?',
   '[{"label":"Squeaking","value":"squeak"},{"label":"Grinding","value":"grind"},{"label":"Rattling","value":"rattle"},{"label":"No","value":"no"}]',
   5),
  ('vents_dont_blow_strongly',
   'Did the weak airflow start suddenly, or did it slowly drop off over months?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Gradually","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('vents_dont_blow_strongly',
   'Does the fan come on at all when you turn it to the lowest speed?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Foggy or Hard-to-Defog Windows (7) ──────────────────────────────
  ('foggy_or_hard_to_defog_windows',
   'Do the windows fog up only on cold or rainy days, or all the time?',
   '[{"label":"Only cold/rainy days","value":"cold_rainy"},{"label":"All the time","value":"all_time"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('foggy_or_hard_to_defog_windows',
   'When you turn on defrost, does air actually come out of the vents at the bottom of the windshield?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Weak airflow","value":"weak"}]',
   2),
  ('foggy_or_hard_to_defog_windows',
   'Does the windshield clear up if you turn the AC on along with the defrost?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('foggy_or_hard_to_defog_windows',
   'Have you noticed any wet carpet on the passenger side floor?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('foggy_or_hard_to_defog_windows',
   'Do the inside of the windows look greasy or oily-streaked when you wipe them?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('foggy_or_hard_to_defog_windows',
   'Does the back window defroster (the lines on the rear glass) work normally?',
   '[{"label":"Yes — works","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   6),
  ('foggy_or_hard_to_defog_windows',
   'Does the fogging get worse when more passengers are in the car?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Strange Noise From Vents (7) ────────────────────────────────────
  ('strange_noise_from_vents',
   'What kind of noise is it: clicking, whistling, grinding, rattling, or buzzing?',
   '[{"label":"Clicking","value":"click"},{"label":"Whistling","value":"whistle"},{"label":"Grinding","value":"grind"},{"label":"Rattling","value":"rattle"},{"label":"Buzzing","value":"buzz"}]',
   1),
  ('strange_noise_from_vents',
   'Does the noise happen only when the fan is on, or also when the fan is off?',
   '[{"label":"Only when fan on","value":"fan_on"},{"label":"Even with fan off","value":"fan_off"},{"label":"Both","value":"both"}]',
   2),
  ('strange_noise_from_vents',
   'Does the noise change when you raise or lower the fan speed?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('strange_noise_from_vents',
   'Does the noise change when you switch the vents between dash, floor, and defrost?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('strange_noise_from_vents',
   'Does the noise change when you switch between fresh air and recirculate?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('strange_noise_from_vents',
   'Did the noise start after leaves, debris, or anything got near the cowl at the base of the windshield?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('strange_noise_from_vents',
   'Is the noise coming from behind the dash, the passenger footwell, or under the hood?',
   '[{"label":"Behind the dash","value":"dash"},{"label":"Passenger footwell","value":"footwell"},{"label":"Under the hood","value":"hood"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Bad Smell From Vents (7) ────────────────────────────────────────
  ('bad_smell_from_vents',
   'How would you describe the smell: musty/moldy, sweet like maple syrup, gasoline, burning, or something else?',
   '[{"label":"Musty/moldy","value":"musty"},{"label":"Sweet like maple syrup","value":"sweet"},{"label":"Gasoline","value":"gasoline"},{"label":"Burning","value":"burning"},{"label":"Something else","value":"other"}]',
   1),
  ('bad_smell_from_vents',
   'Is the smell strongest when you first turn the AC on, or after the AC has been running a while?',
   '[{"label":"When first turned on","value":"first"},{"label":"After running a while","value":"after"},{"label":"Both","value":"both"}]',
   2),
  ('bad_smell_from_vents',
   'Does the smell happen with the AC on, the heat on, or both?',
   '[{"label":"AC only","value":"ac"},{"label":"Heat only","value":"heat"},{"label":"Both","value":"both"}]',
   3),
  ('bad_smell_from_vents',
   'Have the windows been fogging up at the same time the smell shows up?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('bad_smell_from_vents',
   'Has the cabin air filter been changed in the last year or two?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('bad_smell_from_vents',
   'Did the smell start after the car sat unused for a while, or after a recent service?',
   '[{"label":"After sitting unused","value":"after_sitting"},{"label":"After recent service","value":"after_service"},{"label":"Neither","value":"neither"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('bad_smell_from_vents',
   'Does the smell go away if you switch to recirculate, or get worse?',
   '[{"label":"Goes away","value":"better"},{"label":"Gets worse","value":"worse"},{"label":"No change","value":"same"}]',
   7),

  -- ── One Zone Works But Another Doesn't (7) ──────────────────────────
  ('one_zone_works_but_another_doesnt',
   'Which side or zone is the problem: driver, passenger, or rear?',
   '[{"label":"Driver","value":"driver"},{"label":"Passenger","value":"passenger"},{"label":"Rear","value":"rear"}]',
   1),
  ('one_zone_works_but_another_doesnt',
   'Is one side blowing cold while the other blows warm, or one warm while the other is cold?',
   '[{"label":"One cold, other warm","value":"split_cold_warm"},{"label":"Same problem both sides","value":"same"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('one_zone_works_but_another_doesnt',
   'Does the problem happen only with AC, only with heat, or both?',
   '[{"label":"AC only","value":"ac"},{"label":"Heat only","value":"heat"},{"label":"Both","value":"both"}]',
   3),
  ('one_zone_works_but_another_doesnt',
   'Have you heard any clicking or tapping sound from behind the dashboard when you change the temperature setting?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('one_zone_works_but_another_doesnt',
   'Does the temperature on the bad side change at all when you adjust its dial, or does it stay stuck no matter what?',
   '[{"label":"Changes a little","value":"some_change"},{"label":"Stays stuck","value":"stuck"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('one_zone_works_but_another_doesnt',
   'Did the problem start after the car sat in very cold or very hot weather?',
   '[{"label":"After very cold weather","value":"cold"},{"label":"After very hot weather","value":"hot"},{"label":"Neither","value":"neither"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('one_zone_works_but_another_doesnt',
   'Does the airflow strength feel normal on the bad side, even if the temperature is wrong?',
   '[{"label":"Yes — airflow normal","value":"normal"},{"label":"No — also weak","value":"weak"},{"label":"Not sure","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'hvac',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2C. LEAK — 7 subcategories × 7 questions = 49 questions
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'leak'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Brown or Black Puddle (Engine Oil) (7) ──────────────────────────
  ('brown_or_black_puddle_engine_oil',
   'Is the puddle showing up under the front or middle of the car, roughly under the engine?',
   '[{"label":"Front under engine","value":"front"},{"label":"Middle of car","value":"middle"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('brown_or_black_puddle_engine_oil',
   'Does the spot feel thick and slippery between your fingers, almost like cooking oil?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t touched it","value":"unsure"}]',
   2),
  ('brown_or_black_puddle_engine_oil',
   'Have you smelled anything burning or seen smoke coming from under the hood while driving?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('brown_or_black_puddle_engine_oil',
   'Has the oil-can warning light on your dashboard turned on at all?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   4),
  ('brown_or_black_puddle_engine_oil',
   'Have you had to add engine oil between oil changes lately, or is the dipstick reading low?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('brown_or_black_puddle_engine_oil',
   'About how big is the spot — a few drops the size of a quarter, a saucer-sized stain, or a wider puddle?',
   '[{"label":"A few drops (quarter size)","value":"small"},{"label":"Saucer-sized stain","value":"medium"},{"label":"Wider puddle","value":"large"}]',
   6),
  ('brown_or_black_puddle_engine_oil',
   'Does it only leak after you''ve been driving, or do you see fresh drops even after the car has sat overnight?',
   '[{"label":"Only after driving","value":"after_driving"},{"label":"Even after sitting overnight","value":"overnight"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Green, Orange, Yellow, or Pink Puddle (Coolant) (7) ─────────────
  ('green_orange_yellow_or_pink_puddle_coolant',
   'Does the fluid look bright or neon-colored — green, orange, yellow, or pink?',
   '[{"label":"Green","value":"green"},{"label":"Orange","value":"orange"},{"label":"Yellow","value":"yellow"},{"label":"Pink","value":"pink"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('green_orange_yellow_or_pink_puddle_coolant',
   'Have you noticed a sweet smell, kind of like maple syrup or pancake syrup, around the car or inside the cabin?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('green_orange_yellow_or_pink_puddle_coolant',
   'Has the temperature gauge been creeping toward hot, or has the car overheated recently?',
   '[{"label":"Yes — creeping hot","value":"creeping"},{"label":"Yes — overheated","value":"overheated"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('green_orange_yellow_or_pink_puddle_coolant',
   'Is the puddle showing up under the front of the car, near the radiator area?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('green_orange_yellow_or_pink_puddle_coolant',
   'Have you had to add antifreeze to the reservoir under the hood, or has the level dropped?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('green_orange_yellow_or_pink_puddle_coolant',
   'Do you see any steam rising from under the hood when you stop after a drive?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('green_orange_yellow_or_pink_puddle_coolant',
   'Does the inside of the windshield fog up oddly, or do you smell that sweet smell from the vents when the heater is on?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Red or Pink Puddle (Trans / Power Steering) (7) ─────────────────
  ('red_or_pink_puddle_transmission_or_power_steering',
   'Where is the leak showing up — more toward the middle of the car or up near the front by the engine?',
   '[{"label":"Middle of the car","value":"middle"},{"label":"Front near engine","value":"front"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('red_or_pink_puddle_transmission_or_power_steering',
   'When you turn the steering wheel, does it feel heavier than usual or make a whining or groaning noise?',
   '[{"label":"Heavier","value":"heavier"},{"label":"Whining noise","value":"whining"},{"label":"Groaning noise","value":"groaning"},{"label":"No change","value":"no"}]',
   2),
  ('red_or_pink_puddle_transmission_or_power_steering',
   'When you shift into Drive or Reverse, does it hesitate, slip, or feel rough?',
   '[{"label":"Hesitates","value":"hesitates"},{"label":"Slips","value":"slips"},{"label":"Feels rough","value":"rough"},{"label":"Normal","value":"normal"}]',
   3),
  ('red_or_pink_puddle_transmission_or_power_steering',
   'Is the fluid bright red or pink, or has it darkened to a brownish-red color?',
   '[{"label":"Bright red/pink","value":"bright"},{"label":"Brownish-red","value":"dark"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('red_or_pink_puddle_transmission_or_power_steering',
   'Have you had to top off the power steering reservoir under the hood recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('red_or_pink_puddle_transmission_or_power_steering',
   'Does the leak happen more when the car is parked after driving, or also when it sits unused for a day?',
   '[{"label":"After driving","value":"after_driving"},{"label":"Also when sitting","value":"sitting"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('red_or_pink_puddle_transmission_or_power_steering',
   'Do you mainly see the spot after the car has been running, or is it there first thing in the morning too?',
   '[{"label":"After running","value":"after_running"},{"label":"In the morning too","value":"morning"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Clear, Yellow, or Light Brown Puddle (Brake Fluid) (7) ──────────
  ('clear_yellow_or_light_brown_puddle_brake_fluid',
   'Does the brake pedal feel soft, spongy, or sink lower than normal when you press it?',
   '[{"label":"Soft/spongy","value":"spongy"},{"label":"Sinks lower","value":"sinks"},{"label":"Both","value":"both"},{"label":"Normal","value":"normal"}]',
   1),
  ('clear_yellow_or_light_brown_puddle_brake_fluid',
   'Has the brake pedal ever gone almost all the way to the floor?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('clear_yellow_or_light_brown_puddle_brake_fluid',
   'Has the red brake warning light or the ABS light come on recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   3),
  ('clear_yellow_or_light_brown_puddle_brake_fluid',
   'Is the fluid slick and oily but clear-to-yellowish, and does it have an unpleasant fishy or oily smell?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('clear_yellow_or_light_brown_puddle_brake_fluid',
   'Where is the spot showing up — near a wheel, under the middle of the car, or up under the engine bay on the driver''s side?',
   '[{"label":"Near a wheel","value":"wheel"},{"label":"Middle of car","value":"middle"},{"label":"Driver''s side engine bay","value":"driver_engine"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('clear_yellow_or_light_brown_puddle_brake_fluid',
   'Does the car pull to one side when you brake, or does stopping take longer than it used to?',
   '[{"label":"Pulls to one side","value":"pulls"},{"label":"Takes longer to stop","value":"longer"},{"label":"Both","value":"both"},{"label":"Normal","value":"normal"}]',
   6),
  ('clear_yellow_or_light_brown_puddle_brake_fluid',
   'Have you checked the small reservoir under the hood marked "brake fluid" — does it look low?',
   '[{"label":"Yes — looks low","value":"low"},{"label":"Looks normal","value":"normal"},{"label":"Haven''t checked","value":"unsure"}]',
   7),

  -- ── Clear, Odorless Puddle (Water / AC) (7) ─────────────────────────
  ('clear_odorless_puddle_water_or_ac',
   'Does the puddle show up only after you''ve been running the air conditioner, especially on a warm or humid day?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('clear_odorless_puddle_water_or_ac',
   'Is the fluid completely clear, with no color and no smell at all?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('clear_odorless_puddle_water_or_ac',
   'Is the spot small — like a few drops or a wet patch — and toward the front-passenger side of the car?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('clear_odorless_puddle_water_or_ac',
   'Does the spot dry up quickly and leave no stain or residue behind?',
   '[{"label":"Yes","value":"yes"},{"label":"No — leaves residue","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('clear_odorless_puddle_water_or_ac',
   'Have you noticed any wet carpet inside the car, especially on the passenger-side floorboard?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('clear_odorless_puddle_water_or_ac',
   'Does the leak ever appear when the AC has not been on, or only after AC use?',
   '[{"label":"Only after AC use","value":"ac_only"},{"label":"Also without AC","value":"either"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('clear_odorless_puddle_water_or_ac',
   'Have you driven through any deep puddles or had heavy rain recently that could have left water behind?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Thick Dark Brown Puddle (Gear / Diff) (7) ───────────────────────
  ('thick_dark_brown_puddle_gear_oil',
   'Is the spot showing up under the very back of the car, near the rear axle, or under a four-wheel-drive vehicle''s middle area?',
   '[{"label":"Rear axle area","value":"rear"},{"label":"Middle (4WD)","value":"middle"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('thick_dark_brown_puddle_gear_oil',
   'Does the fluid smell strong and unpleasant — kind of like rotten eggs or sulfur?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('thick_dark_brown_puddle_gear_oil',
   'Is the fluid thick and dark — darker and heavier-looking than regular engine oil?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('thick_dark_brown_puddle_gear_oil',
   'Do you hear any whining, humming, or grinding noise from the back of the car that gets louder with speed?',
   '[{"label":"Whining","value":"whining"},{"label":"Humming","value":"humming"},{"label":"Grinding","value":"grinding"},{"label":"None","value":"none"}]',
   4),
  ('thick_dark_brown_puddle_gear_oil',
   'Have you felt any vibrations or clunking, especially during turns or when accelerating?',
   '[{"label":"Vibrations","value":"vibration"},{"label":"Clunking","value":"clunking"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   5),
  ('thick_dark_brown_puddle_gear_oil',
   'Does the leak look like it''s coming from a round, pumpkin-shaped housing on the rear axle?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('thick_dark_brown_puddle_gear_oil',
   'Has the vehicle been used recently for towing, off-roading, or hauling heavy loads?',
   '[{"label":"Towing","value":"towing"},{"label":"Off-roading","value":"offroad"},{"label":"Heavy loads","value":"loads"},{"label":"No","value":"no"}]',
   7),

  -- ── Blue or Light Blue Puddle (Washer Fluid) (7) ────────────────────
  ('blue_or_light_blue_puddle_washer_fluid',
   'Is the fluid a bright blue or blue-green color, and does it have a soapy or chemical smell?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('blue_or_light_blue_puddle_washer_fluid',
   'Does the spot show up near the front of the car, just behind the front bumper?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('blue_or_light_blue_puddle_washer_fluid',
   'When you press the washer button, does any fluid actually reach the windshield, or has the spray weakened?',
   '[{"label":"Reaches windshield","value":"reaches"},{"label":"Spray weak","value":"weak"},{"label":"No spray","value":"none"}]',
   3),
  ('blue_or_light_blue_puddle_washer_fluid',
   'Have you had to refill the washer fluid reservoir more often than usual?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('blue_or_light_blue_puddle_washer_fluid',
   'Does the fluid feel watery and thin rather than oily?',
   '[{"label":"Yes — watery","value":"yes"},{"label":"No — oily","value":"no"},{"label":"Haven''t touched it","value":"unsure"}]',
   5),
  ('blue_or_light_blue_puddle_washer_fluid',
   'Does the leak happen only after you''ve used the windshield washers, or does it drip all the time?',
   '[{"label":"Only after using washers","value":"after_use"},{"label":"All the time","value":"always"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('blue_or_light_blue_puddle_washer_fluid',
   'Have you recently been in cold weather where the washer fluid lines could have frozen and cracked?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'leak',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2D. NOISE — 10 subcategories × 7 questions = 70 questions
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'noise'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Engine Ticking or Tapping (7) ───────────────────────────────────
  ('engine_ticking_or_tapping',
   'Does the ticking start the moment you turn the key, or does it only show up after the engine has been running for a few minutes?',
   '[{"label":"At startup","value":"startup"},{"label":"After running a few minutes","value":"warm"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('engine_ticking_or_tapping',
   'Does the speed of the ticking change as you press the gas pedal?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('engine_ticking_or_tapping',
   'Is the sound coming from the top of the engine or the lower part of the engine?',
   '[{"label":"Top of engine","value":"top"},{"label":"Lower engine","value":"bottom"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('engine_ticking_or_tapping',
   'When was the last time you had the oil changed?',
   '[{"label":"Within 3 months","value":"recent"},{"label":"3-6 months ago","value":"medium"},{"label":"Over 6 months ago","value":"old"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('engine_ticking_or_tapping',
   'Have you noticed the oil pressure warning light flicker on, even briefly?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('engine_ticking_or_tapping',
   'Does the ticking get quieter or go away once the engine warms up?',
   '[{"label":"Yes — goes away","value":"yes"},{"label":"No — stays","value":"no"},{"label":"Gets worse","value":"worse"}]',
   6),
  ('engine_ticking_or_tapping',
   'Does the noise get louder when the engine is working hard, like going up a hill or carrying heavy loads?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Clunking Over Bumps (7) ─────────────────────────────────────────
  ('clunking_over_bumps',
   'Does the clunk happen every time you hit a bump, or only with big bumps and potholes?',
   '[{"label":"Every bump","value":"every"},{"label":"Only big bumps/potholes","value":"big"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('clunking_over_bumps',
   'Is the sound coming from the front of the vehicle, the back, or both?',
   '[{"label":"Front","value":"front"},{"label":"Back","value":"back"},{"label":"Both","value":"both"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('clunking_over_bumps',
   'Does the clunk happen on just one side of the car, or both sides equally?',
   '[{"label":"One side","value":"one"},{"label":"Both sides","value":"both"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('clunking_over_bumps',
   'Have you noticed the vehicle feeling bouncy or unsettled after going over bumps?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('clunking_over_bumps',
   'Does the clunk also happen when you start moving from a stop or when you come to a stop?',
   '[{"label":"Starting from stop","value":"start"},{"label":"Coming to a stop","value":"stop"},{"label":"Both","value":"both"},{"label":"Neither","value":"neither"}]',
   5),
  ('clunking_over_bumps',
   'Have you hit any large potholes, curbs, or road debris recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('clunking_over_bumps',
   'Does the noise happen at any speed, or only at low speeds?',
   '[{"label":"Any speed","value":"any"},{"label":"Only low speeds","value":"low"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Humming or Whirring at Speed (7) ────────────────────────────────
  ('humming_or_whirring_at_speed',
   'Does the hum get louder the faster you drive?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('humming_or_whirring_at_speed',
   'Does the noise change when you turn the steering wheel left versus right?',
   '[{"label":"Louder turning left","value":"left"},{"label":"Louder turning right","value":"right"},{"label":"No change","value":"no_change"}]',
   2),
  ('humming_or_whirring_at_speed',
   'Does the sound seem to come from one specific wheel area, or is it hard to pin down?',
   '[{"label":"One specific wheel","value":"specific"},{"label":"Hard to pin down","value":"unclear"}]',
   3),
  ('humming_or_whirring_at_speed',
   'Does the hum stay the same when you take your foot off the gas and coast?',
   '[{"label":"Stays the same","value":"same"},{"label":"Gets quieter","value":"quieter"},{"label":"Gets louder","value":"louder"}]',
   4),
  ('humming_or_whirring_at_speed',
   'Have you had new tires put on recently, or are your tires worn unevenly?',
   '[{"label":"New tires recently","value":"new"},{"label":"Worn unevenly","value":"uneven"},{"label":"Neither","value":"neither"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('humming_or_whirring_at_speed',
   'Does the noise feel like it''s coming through the floor or the seat as a vibration too?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('humming_or_whirring_at_speed',
   'Does the hum disappear or get quieter when you''re stopped at a light?',
   '[{"label":"Disappears","value":"gone"},{"label":"Gets quieter","value":"quieter"},{"label":"Same","value":"same"}]',
   7),

  -- ── High-Pitched Whining Under the Hood (7) ─────────────────────────
  ('high_pitched_whining_under_the_hood',
   'Does the whine speed up and slow down along with the engine speed?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('high_pitched_whining_under_the_hood',
   'Does the whine get louder when you turn the steering wheel, especially when parking?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('high_pitched_whining_under_the_hood',
   'Does it happen mostly when the engine is cold, when it''s warm, or all the time?',
   '[{"label":"When cold","value":"cold"},{"label":"When warm","value":"warm"},{"label":"All the time","value":"all_time"}]',
   3),
  ('high_pitched_whining_under_the_hood',
   'Does the whine get worse in cold or damp weather?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('high_pitched_whining_under_the_hood',
   'Have you noticed the battery warning light or dim headlights along with the noise?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('high_pitched_whining_under_the_hood',
   'Does the whine come from the front of the engine area where the belts are?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('high_pitched_whining_under_the_hood',
   'Did the noise start suddenly, or has it been getting worse gradually?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Gradually","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Rattling Underneath the Car (7) ─────────────────────────────────
  ('rattling_underneath_the_car',
   'Does the rattle happen mostly at startup, when accelerating, or at idle?',
   '[{"label":"Startup","value":"startup"},{"label":"Accelerating","value":"accel"},{"label":"At idle","value":"idle"},{"label":"All","value":"all"}]',
   1),
  ('rattling_underneath_the_car',
   'Does the sound change or stop when you go over bumps versus smooth road?',
   '[{"label":"Worse over bumps","value":"bumps"},{"label":"Same on smooth","value":"smooth"},{"label":"Stops over bumps","value":"stops"}]',
   2),
  ('rattling_underneath_the_car',
   'Is the rattle more of a tinny sound, like a can with a rock in it, or more of a heavy clang?',
   '[{"label":"Tinny like a can","value":"tinny"},{"label":"Heavy clang","value":"heavy"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('rattling_underneath_the_car',
   'Does it get worse when the engine is revved up?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('rattling_underneath_the_car',
   'Have you driven over anything in the road recently or scraped the underside of the car?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('rattling_underneath_the_car',
   'Does the noise come from the front, middle, or rear underside of the vehicle?',
   '[{"label":"Front","value":"front"},{"label":"Middle","value":"middle"},{"label":"Rear","value":"rear"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('rattling_underneath_the_car',
   'Does the rattle quiet down once you''re at cruising speed on the highway?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Hissing Noise (7) ───────────────────────────────────────────────
  ('hissing_noise',
   'Does the hiss happen with the engine off after you''ve shut the car down, or only when running?',
   '[{"label":"Engine off","value":"off"},{"label":"Only when running","value":"running"},{"label":"Both","value":"both"}]',
   1),
  ('hissing_noise',
   'Does the noise stop when you turn off the air conditioning?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('hissing_noise',
   'Have you noticed the engine running rough, idling unevenly, or a warning light coming on?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('hissing_noise',
   'Is the temperature gauge running higher than normal, or have you seen steam from under the hood?',
   '[{"label":"Yes — gauge high","value":"gauge"},{"label":"Yes — steam","value":"steam"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   4),
  ('hissing_noise',
   'Does the hiss seem to come from under the hood, from underneath the car, or from the dashboard area?',
   '[{"label":"Under the hood","value":"hood"},{"label":"Underneath the car","value":"underneath"},{"label":"Dashboard","value":"dashboard"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('hissing_noise',
   'Does the air conditioning still blow cold, or has it gotten weaker?',
   '[{"label":"Still cold","value":"cold"},{"label":"Weaker","value":"weaker"},{"label":"Not cold","value":"warm"}]',
   6),
  ('hissing_noise',
   'Have you topped off coolant or refrigerant recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Popping or Clicking When Turning (7) ────────────────────────────
  ('popping_or_clicking_when_turning',
   'Does the popping happen mostly during sharp turns, like in parking lots, or also during gentle turns?',
   '[{"label":"Sharp turns only","value":"sharp"},{"label":"Also gentle turns","value":"any"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('popping_or_clicking_when_turning',
   'Is the noise louder when turning one direction versus the other?',
   '[{"label":"Louder turning left","value":"left"},{"label":"Louder turning right","value":"right"},{"label":"Same either way","value":"same"}]',
   2),
  ('popping_or_clicking_when_turning',
   'Does the popping get faster and louder the tighter you turn the wheel?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('popping_or_clicking_when_turning',
   'Does it happen when going forward, in reverse, or both?',
   '[{"label":"Forward","value":"forward"},{"label":"Reverse","value":"reverse"},{"label":"Both","value":"both"}]',
   4),
  ('popping_or_clicking_when_turning',
   'Have you noticed any grease splattered on the back of your wheel or inside of your tire?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   5),
  ('popping_or_clicking_when_turning',
   'Does the noise happen even when you''re not turning, or only during turns?',
   '[{"label":"Only during turns","value":"turns_only"},{"label":"Also when not turning","value":"any"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('popping_or_clicking_when_turning',
   'Have you hit a deep pothole or scraped a curb recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Deep Knocking from the Engine (7) ───────────────────────────────
  ('deep_knocking_from_the_engine',
   'Does the knock happen the moment you start the engine, or does it take a few minutes to show up?',
   '[{"label":"At startup","value":"startup"},{"label":"After a few minutes","value":"warm"},{"label":"Both","value":"both"}]',
   1),
  ('deep_knocking_from_the_engine',
   'Does the knocking get worse when you accelerate or are climbing a hill?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('deep_knocking_from_the_engine',
   'Does it get louder or quieter when the engine warms up?',
   '[{"label":"Louder","value":"louder"},{"label":"Quieter","value":"quieter"},{"label":"Same","value":"same"}]',
   3),
  ('deep_knocking_from_the_engine',
   'What grade of gasoline have you been using, and does your owner''s manual recommend a higher grade?',
   '[{"label":"Regular — manual says higher","value":"regular_should_premium"},{"label":"Premium","value":"premium"},{"label":"Regular — manual says regular","value":"regular_ok"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('deep_knocking_from_the_engine',
   'Have you noticed any warning lights on the dashboard, especially the oil pressure light or check engine light?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('deep_knocking_from_the_engine',
   'Is the knocking a deep, heavy thumping or a lighter, faster tapping?',
   '[{"label":"Deep heavy thumping","value":"heavy"},{"label":"Lighter faster tapping","value":"light"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('deep_knocking_from_the_engine',
   'Have you been low on oil recently, or has it been a long time since the last oil change?',
   '[{"label":"Yes — low on oil","value":"low"},{"label":"Long since oil change","value":"overdue"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   7),

  -- ── Squeaking or Creaking Over Bumps (7) ────────────────────────────
  ('squeaking_or_creaking_over_bumps',
   'Is the squeak worse when the car is cold in the morning, or when it''s warmed up?',
   '[{"label":"Worse when cold","value":"cold"},{"label":"Worse when warm","value":"warm"},{"label":"Same","value":"same"}]',
   1),
  ('squeaking_or_creaking_over_bumps',
   'Does the squeak only happen over bumps, or also when you turn the steering wheel while sitting still?',
   '[{"label":"Only over bumps","value":"bumps"},{"label":"Also when turning still","value":"steering"},{"label":"Both","value":"both"}]',
   2),
  ('squeaking_or_creaking_over_bumps',
   'Does it sound like dry rubber being twisted, or more like metal rubbing on metal?',
   '[{"label":"Dry rubber","value":"rubber"},{"label":"Metal on metal","value":"metal"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('squeaking_or_creaking_over_bumps',
   'Does the noise come from one corner of the car, or all around?',
   '[{"label":"One corner","value":"corner"},{"label":"All around","value":"all"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('squeaking_or_creaking_over_bumps',
   'Does the squeak happen at low speeds only, or also on the highway?',
   '[{"label":"Low speeds only","value":"low"},{"label":"Also highway","value":"any"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('squeaking_or_creaking_over_bumps',
   'Has the car been sitting outside in cold or wet weather a lot?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('squeaking_or_creaking_over_bumps',
   'Does the squeak get worse when carrying passengers or heavy loads?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Electrical Buzzing (7) ──────────────────────────────────────────
  ('electrical_buzzing',
   'Does the buzzing keep going even after you turn the engine off, or does it stop?',
   '[{"label":"Keeps going","value":"continues"},{"label":"Stops","value":"stops"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('electrical_buzzing',
   'Does the sound seem to come from the dashboard, behind the dash, or from under the hood?',
   '[{"label":"Dashboard","value":"dashboard"},{"label":"Behind the dash","value":"behind_dash"},{"label":"Under the hood","value":"hood"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('electrical_buzzing',
   'Does the buzz happen only when certain things are turned on, like the headlights, blower fan, or turn signals?',
   '[{"label":"Headlights","value":"headlights"},{"label":"Blower fan","value":"blower"},{"label":"Turn signals","value":"signals"},{"label":"Always","value":"always"}]',
   3),
  ('electrical_buzzing',
   'Have you noticed the headlights or dashboard lights flickering or dimming?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('electrical_buzzing',
   'Have you had any electrical work, accessories, or aftermarket items installed recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('electrical_buzzing',
   'Does the battery seem weak, or does the car sometimes have trouble starting?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('electrical_buzzing',
   'Does the buzzing happen all the time, or only at certain temperatures or weather conditions?',
   '[{"label":"All the time","value":"always"},{"label":"Only certain weather","value":"weather"},{"label":"Not sure","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'noise',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2E. OTHER — 6 subcategories × 7 questions = 42 questions
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'other'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Multiple Symptoms / Not Sure (7) ────────────────────────────────
  ('multiple_symptoms_not_sure',
   'Which problem do you notice first when you start driving — or do they all show up at the same time?',
   '[{"label":"One specific problem first","value":"one_first"},{"label":"All at the same time","value":"all_at_once"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('multiple_symptoms_not_sure',
   'Are the issues happening together every time, or does each one come and go on its own?',
   '[{"label":"Together every time","value":"together"},{"label":"Come and go separately","value":"separate"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('multiple_symptoms_not_sure',
   'Did everything start around the same time, or did one problem show up first and the others followed later?',
   '[{"label":"Same time","value":"same_time"},{"label":"One first, others later","value":"staggered"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('multiple_symptoms_not_sure',
   'Have you noticed any pattern — like it only happens when it rains, when the car is cold, when you turn, or at certain speeds?',
   '[{"label":"Only in rain","value":"rain"},{"label":"Only when cold","value":"cold"},{"label":"Only when turning","value":"turning"},{"label":"Only at certain speeds","value":"speed"},{"label":"No pattern","value":"none"}]',
   4),
  ('multiple_symptoms_not_sure',
   'Is there one symptom that worries you the most, or feels the most urgent?',
   '[{"label":"Yes — I''ll describe","value":"yes"},{"label":"No — all about the same","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('multiple_symptoms_not_sure',
   'Has anything changed recently — like a long road trip, towing something, an oil change, or new tires?',
   '[{"label":"Long road trip","value":"trip"},{"label":"Towing","value":"towing"},{"label":"Oil change","value":"oil"},{"label":"New tires","value":"tires"},{"label":"Nothing","value":"none"}]',
   6),
  ('multiple_symptoms_not_sure',
   'Have you had any dashboard warning lights come on, even briefly?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── After a Recent Accident or Impact (7) ───────────────────────────
  ('after_a_recent_accident_or_impact',
   'When did the accident or impact happen, and have you driven the car since?',
   '[{"label":"Today — haven''t driven","value":"today_no_drive"},{"label":"Today — drove it","value":"today_drove"},{"label":"Within last week","value":"week"},{"label":"More than a week ago","value":"older"}]',
   1),
  ('after_a_recent_accident_or_impact',
   'Was it a collision with another vehicle, a curb hit, a pothole, or running over something in the road?',
   '[{"label":"Another vehicle","value":"vehicle"},{"label":"Curb hit","value":"curb"},{"label":"Pothole","value":"pothole"},{"label":"Road debris","value":"debris"}]',
   2),
  ('after_a_recent_accident_or_impact',
   'Did any airbags deploy, or did any warning lights come on after the impact?',
   '[{"label":"Airbags deployed","value":"airbags"},{"label":"Warning lights on","value":"lights"},{"label":"Both","value":"both"},{"label":"Neither","value":"neither"}]',
   3),
  ('after_a_recent_accident_or_impact',
   'Are you filing an insurance claim, or is this something you''re handling on your own?',
   '[{"label":"Insurance claim","value":"insurance"},{"label":"Handling on my own","value":"self"},{"label":"Not sure yet","value":"unsure"}]',
   4),
  ('after_a_recent_accident_or_impact',
   'Does the steering feel different — pulling to one side, off-center, or shaky?',
   '[{"label":"Pulling to one side","value":"pulling"},{"label":"Off-center","value":"off_center"},{"label":"Shaky","value":"shaky"},{"label":"Normal","value":"normal"}]',
   5),
  ('after_a_recent_accident_or_impact',
   'Are you seeing any new fluid drips on the ground where you park?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('after_a_recent_accident_or_impact',
   'Does the car feel like it''s sitting level, or does one corner look lower than the others?',
   '[{"label":"Sits level","value":"level"},{"label":"One corner lower","value":"uneven"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── After Recent Service or Repair Work (7) ─────────────────────────
  ('after_recent_service_or_repair_work',
   'Where was the recent work done — at our shop, a dealership, or somewhere else?',
   '[{"label":"Our shop","value":"our_shop"},{"label":"Dealership","value":"dealership"},{"label":"Somewhere else","value":"other"}]',
   1),
  ('after_recent_service_or_repair_work',
   'About how long ago was that service, and do you have the receipt or invoice handy?',
   '[{"label":"Within last week — have receipt","value":"week_yes"},{"label":"Within last week — no receipt","value":"week_no"},{"label":"More than a week — have receipt","value":"older_yes"},{"label":"More than a week — no receipt","value":"older_no"}]',
   2),
  ('after_recent_service_or_repair_work',
   'What was the original reason you took it in — and is this the same problem coming back, or something new?',
   '[{"label":"Same problem coming back","value":"same"},{"label":"Something new","value":"new"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('after_recent_service_or_repair_work',
   'Did the issue show up right after picking up the car, or did it appear days or weeks later?',
   '[{"label":"Right after pickup","value":"immediate"},{"label":"Days later","value":"days"},{"label":"Weeks later","value":"weeks"}]',
   4),
  ('after_recent_service_or_repair_work',
   'Are any parts or labor still under warranty from that previous shop?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('after_recent_service_or_repair_work',
   'Has the car been driven much since the work was done?',
   '[{"label":"Hardly at all","value":"little"},{"label":"Normal driving","value":"normal"},{"label":"A lot","value":"lots"}]',
   6),
  ('after_recent_service_or_repair_work',
   'Did the other shop mention anything they recommended but didn''t end up doing?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Safety Concern — Don't Feel Safe (7) ────────────────────────────
  ('safety_concern_dont_feel_safe',
   'Are you currently somewhere safe, like home or a parking lot, or are you stranded on the road?',
   '[{"label":"Somewhere safe","value":"safe"},{"label":"Stranded on the road","value":"stranded"},{"label":"In a parking lot","value":"parking_lot"}]',
   1),
  ('safety_concern_dont_feel_safe',
   'Is the car drivable at all, or is it not starting or not moving?',
   '[{"label":"Drivable","value":"drivable"},{"label":"Won''t start","value":"no_start"},{"label":"Won''t move","value":"no_move"}]',
   2),
  ('safety_concern_dont_feel_safe',
   'Are you seeing smoke, steam, or smelling something burning?',
   '[{"label":"Smoke","value":"smoke"},{"label":"Steam","value":"steam"},{"label":"Burning smell","value":"burning"},{"label":"None","value":"none"}]',
   3),
  ('safety_concern_dont_feel_safe',
   'Are the brakes working normally, or do they feel soft, low, or like they''re not stopping the car?',
   '[{"label":"Working normally","value":"normal"},{"label":"Soft/low","value":"soft"},{"label":"Not stopping","value":"failed"}]',
   4),
  ('safety_concern_dont_feel_safe',
   'Is the steering working normally, or does it feel stiff, loose, or hard to control?',
   '[{"label":"Working normally","value":"normal"},{"label":"Stiff","value":"stiff"},{"label":"Loose","value":"loose"},{"label":"Hard to control","value":"failed"}]',
   5),
  ('safety_concern_dont_feel_safe',
   'Is there a flashing warning light on the dashboard right now, like a flashing check engine or red temperature light?',
   '[{"label":"Flashing check engine","value":"flash_cel"},{"label":"Red temperature","value":"temp"},{"label":"Other","value":"other"},{"label":"No","value":"no"}]',
   6),
  ('safety_concern_dont_feel_safe',
   'Would you feel comfortable driving it slowly to the shop, or would you rather have it towed in?',
   '[{"label":"Drive it slowly","value":"drive"},{"label":"Tow it","value":"tow"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── General Check-Up or Pre-Trip Inspection (7) ─────────────────────
  ('general_check_up_or_pre_trip',
   'Are you preparing for a long road trip, or is this more of a routine peace-of-mind check?',
   '[{"label":"Long road trip","value":"trip"},{"label":"Routine peace of mind","value":"routine"},{"label":"Both","value":"both"}]',
   1),
  ('general_check_up_or_pre_trip',
   'About when was the last time the car had any maintenance done on it?',
   '[{"label":"Within last 3 months","value":"recent"},{"label":"3-12 months ago","value":"medium"},{"label":"Over a year ago","value":"old"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('general_check_up_or_pre_trip',
   'Are there any small things you''ve noticed but haven''t worried about — like a quiet noise or a soft feel?',
   '[{"label":"Yes — I''ll describe","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('general_check_up_or_pre_trip',
   'About how many miles are on the car right now?',
   '[{"label":"Under 50k","value":"under_50k"},{"label":"50k-100k","value":"50_100"},{"label":"100k-150k","value":"100_150"},{"label":"Over 150k","value":"over_150"}]',
   4),
  ('general_check_up_or_pre_trip',
   'Do you have any service records or a maintenance schedule from the manufacturer you''d like us to follow?',
   '[{"label":"Yes — have records","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('general_check_up_or_pre_trip',
   'Are there any specific areas you want us to focus on, like brakes, tires, or fluids?',
   '[{"label":"Brakes","value":"brakes"},{"label":"Tires","value":"tires"},{"label":"Fluids","value":"fluids"},{"label":"All of the above","value":"all"},{"label":"Whatever you find","value":"any"}]',
   6),
  ('general_check_up_or_pre_trip',
   'Is there a date you need the car ready by?',
   '[{"label":"Yes — I''ll provide it","value":"yes"},{"label":"No rush","value":"no"},{"label":"As soon as possible","value":"asap"}]',
   7),

  -- ── Car Has Been Sitting Unused (7) ─────────────────────────────────
  ('car_has_been_sitting_unused',
   'About how long has the car been sitting without being driven?',
   '[{"label":"A few weeks","value":"weeks"},{"label":"A few months","value":"months"},{"label":"6 months to a year","value":"6_12"},{"label":"More than a year","value":"over_year"}]',
   1),
  ('car_has_been_sitting_unused',
   'Was it parked in a garage, under a cover, or outside in the weather?',
   '[{"label":"Garage","value":"garage"},{"label":"Under a cover","value":"cover"},{"label":"Outside in weather","value":"outside"}]',
   2),
  ('car_has_been_sitting_unused',
   'Did you take any steps before parking it — like adding fuel stabilizer or disconnecting the battery?',
   '[{"label":"Fuel stabilizer","value":"stabilizer"},{"label":"Disconnected battery","value":"battery"},{"label":"Both","value":"both"},{"label":"Neither","value":"none"}]',
   3),
  ('car_has_been_sitting_unused',
   'Have you tried to start it recently, and if so, did it start up or struggle?',
   '[{"label":"Started up","value":"started"},{"label":"Struggled","value":"struggled"},{"label":"Wouldn''t start","value":"no_start"},{"label":"Haven''t tried","value":"not_tried"}]',
   4),
  ('car_has_been_sitting_unused',
   'Is the car a hybrid or electric vehicle?',
   '[{"label":"Hybrid","value":"hybrid"},{"label":"Electric","value":"ev"},{"label":"Gas","value":"gas"}]',
   5),
  ('car_has_been_sitting_unused',
   'Have you noticed any leaks, stains, or puddles where it''s been parked?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   6),
  ('car_has_been_sitting_unused',
   'Do you want it picked up by a tow truck, or have you been able to get it running enough to drive in?',
   '[{"label":"Tow truck","value":"tow"},{"label":"Will drive in","value":"drive"},{"label":"Not sure yet","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'other',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2F. PERFORMANCE — 9 subcategories × 7 questions = 63 questions
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'performance'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── Hesitation or Lag When Accelerating (7) ─────────────────────────
  ('hesitation_or_lag_when_accelerating',
   'Does the hesitation happen when you first press the gas, or only when you push it hard for passing or merging?',
   '[{"label":"When first pressing gas","value":"first"},{"label":"Only when pushing hard","value":"hard"},{"label":"Both","value":"both"}]',
   1),
  ('hesitation_or_lag_when_accelerating',
   'Does it happen in every gear, or only in a certain speed range?',
   '[{"label":"Every gear","value":"every"},{"label":"Certain speed range only","value":"specific"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('hesitation_or_lag_when_accelerating',
   'Is the check engine light on or flashing when it happens?',
   '[{"label":"Flashing","value":"flashing"},{"label":"Solid on","value":"solid"},{"label":"Off","value":"off"}]',
   3),
  ('hesitation_or_lag_when_accelerating',
   'Did this start suddenly, or has it been getting worse over weeks or months?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Gradually","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('hesitation_or_lag_when_accelerating',
   'Have you filled up at a different gas station recently or noticed it after a fuel-up?',
   '[{"label":"Yes — different station","value":"different"},{"label":"Yes — after fuel-up","value":"after_fillup"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('hesitation_or_lag_when_accelerating',
   'Does it ever feel like the car jerks, bucks, or stumbles when you push the pedal?',
   '[{"label":"Jerks","value":"jerks"},{"label":"Bucks","value":"bucks"},{"label":"Stumbles","value":"stumbles"},{"label":"None","value":"none"}]',
   6),
  ('hesitation_or_lag_when_accelerating',
   'Does the problem happen all the time or only sometimes?',
   '[{"label":"All the time","value":"always"},{"label":"Only sometimes","value":"sometimes"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Rough Idle or Shaking at a Stop (7) ─────────────────────────────
  ('rough_idle_or_shaking_at_a_stop',
   'Does the shaking happen only when you''re stopped, or also when you''re driving?',
   '[{"label":"Only stopped","value":"stopped"},{"label":"Also driving","value":"both"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('rough_idle_or_shaking_at_a_stop',
   'Does the shaking get better, worse, or go away when you shift into Neutral or Park?',
   '[{"label":"Better","value":"better"},{"label":"Worse","value":"worse"},{"label":"Goes away","value":"gone"},{"label":"Same","value":"same"}]',
   2),
  ('rough_idle_or_shaking_at_a_stop',
   'Does turning on the A/C, heater, or defrost make the shaking worse?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('rough_idle_or_shaking_at_a_stop',
   'Is the check engine light on, flashing, or has it come on recently?',
   '[{"label":"Flashing","value":"flashing"},{"label":"Solid on","value":"solid"},{"label":"Came on recently","value":"recent"},{"label":"Off","value":"off"}]',
   4),
  ('rough_idle_or_shaking_at_a_stop',
   'Do you smell any gas fumes or rotten-egg smell from the exhaust when it''s shaking?',
   '[{"label":"Gas fumes","value":"gas"},{"label":"Rotten egg","value":"sulfur"},{"label":"Both","value":"both"},{"label":"Neither","value":"neither"}]',
   5),
  ('rough_idle_or_shaking_at_a_stop',
   'Does the RPM needle bounce up and down on its own while you''re sitting at a light?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('rough_idle_or_shaking_at_a_stop',
   'When did you last have spark plugs or a tune-up done?',
   '[{"label":"Within last year","value":"recent"},{"label":"1-3 years ago","value":"medium"},{"label":"Over 3 years ago","value":"old"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Stalling at Idle or When Stopping (7) ───────────────────────────
  ('stalling_at_idle_or_when_stopping',
   'Does the engine die right as you come to a stop, or after sitting still for a few seconds?',
   '[{"label":"As you stop","value":"on_stop"},{"label":"After sitting still","value":"after_sitting"},{"label":"Both","value":"both"}]',
   1),
  ('stalling_at_idle_or_when_stopping',
   'Does it stall more often when the A/C, heater, or headlights are on?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('stalling_at_idle_or_when_stopping',
   'Will it restart right away after it stalls, or do you have to wait?',
   '[{"label":"Restarts right away","value":"immediate"},{"label":"Have to wait","value":"wait"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('stalling_at_idle_or_when_stopping',
   'Does it stall when the engine is cold, after it warms up, or both?',
   '[{"label":"When cold","value":"cold"},{"label":"After warming up","value":"warm"},{"label":"Both","value":"both"}]',
   4),
  ('stalling_at_idle_or_when_stopping',
   'Is the check engine light on when this happens?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('stalling_at_idle_or_when_stopping',
   'Have you noticed a rough or unstable idle leading up to the stall?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('stalling_at_idle_or_when_stopping',
   'Does the stalling happen more in hot weather, cold weather, or no pattern?',
   '[{"label":"Hot weather","value":"hot"},{"label":"Cold weather","value":"cold"},{"label":"No pattern","value":"no_pattern"}]',
   7),

  -- ── Stalling While Driving (Under Load) (7) ─────────────────────────
  ('stalling_while_driving_under_load',
   'Does it cut out at highway speed, while going uphill, or only at slow speeds?',
   '[{"label":"Highway speed","value":"highway"},{"label":"Going uphill","value":"uphill"},{"label":"Slow speeds","value":"slow"},{"label":"All","value":"all"}]',
   1),
  ('stalling_while_driving_under_load',
   'Does it die suddenly with no warning, or does it sputter and lose power first?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Sputters first","value":"sputter"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('stalling_while_driving_under_load',
   'After it dies, does it crank back over right away, or do you have to wait several minutes?',
   '[{"label":"Right away","value":"immediate"},{"label":"Wait several minutes","value":"wait"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('stalling_while_driving_under_load',
   'Does the dashboard go dark or do warning lights flash when it cuts out?',
   '[{"label":"Goes dark","value":"dark"},{"label":"Warning lights flash","value":"flash"},{"label":"Both","value":"both"},{"label":"Neither","value":"neither"}]',
   4),
  ('stalling_while_driving_under_load',
   'How much fuel was in the tank when this happened?',
   '[{"label":"Less than 1/4","value":"low"},{"label":"About half","value":"half"},{"label":"More than half","value":"high"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('stalling_while_driving_under_load',
   'Have you noticed the temperature gauge running hotter than normal?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('stalling_while_driving_under_load',
   'Is there any smoke, smell, or unusual noise right before it dies?',
   '[{"label":"Smoke","value":"smoke"},{"label":"Smell","value":"smell"},{"label":"Noise","value":"noise"},{"label":"None","value":"none"}]',
   7),

  -- ── Hard to Start When Cold (7) ─────────────────────────────────────
  ('hard_to_start_when_cold',
   'Does it take several seconds of cranking before it finally fires up?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('hard_to_start_when_cold',
   'Once it starts, does it run rough for the first minute or so before smoothing out?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   2),
  ('hard_to_start_when_cold',
   'Is this only an issue when it''s been cold outside, or does it happen any time it sits overnight?',
   '[{"label":"Only when cold out","value":"cold_only"},{"label":"Any time sitting","value":"any_sit"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('hard_to_start_when_cold',
   'Did you have to jump-start it, or did the battery sound strong while cranking?',
   '[{"label":"Needed jump","value":"jump"},{"label":"Battery sounded strong","value":"strong"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('hard_to_start_when_cold',
   'Have you noticed any black smoke or strong gas smell when it finally starts?',
   '[{"label":"Black smoke","value":"smoke"},{"label":"Gas smell","value":"gas"},{"label":"Both","value":"both"},{"label":"Neither","value":"neither"}]',
   5),
  ('hard_to_start_when_cold',
   'About how long has it been doing this — days, weeks, or months?',
   '[{"label":"Days","value":"days"},{"label":"Weeks","value":"weeks"},{"label":"Months","value":"months"}]',
   6),
  ('hard_to_start_when_cold',
   'Does the check engine light stay on after it starts, or come on and go off?',
   '[{"label":"Stays on","value":"stays_on"},{"label":"Comes and goes","value":"intermittent"},{"label":"Off","value":"off"}]',
   7),

  -- ── Hard to Start When Hot (7) ──────────────────────────────────────
  ('hard_to_start_when_hot',
   'Does it only happen when you stop for a short errand and try to restart, like at a gas station?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('hard_to_start_when_hot',
   'Does it crank fine but take a long time to actually catch and run?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('hard_to_start_when_hot',
   'Have you noticed it after driving in hot weather or after sitting in traffic?',
   '[{"label":"Hot weather","value":"hot"},{"label":"After traffic","value":"traffic"},{"label":"Both","value":"both"},{"label":"Neither","value":"neither"}]',
   3),
  ('hard_to_start_when_hot',
   'Does it start better if you press the gas pedal partway down while turning the key?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('hard_to_start_when_hot',
   'Once it does start, does it idle rough for a few seconds before smoothing out?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   5),
  ('hard_to_start_when_hot',
   'Is there any smell of raw gas around the engine when this happens?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('hard_to_start_when_hot',
   'Does it ever stall right after starting if you don''t give it gas?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   7),

  -- ── Low Power or Won't Accelerate Normally (7) ──────────────────────
  ('low_power_or_wont_accelerate_normally',
   'Is the loss of power constant, or does it come and go?',
   '[{"label":"Constant","value":"constant"},{"label":"Comes and goes","value":"intermittent"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('low_power_or_wont_accelerate_normally',
   'Does the engine rev up high but the car doesn''t pick up speed like it used to?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('low_power_or_wont_accelerate_normally',
   'Is the check engine light flashing, solid, or off?',
   '[{"label":"Flashing","value":"flashing"},{"label":"Solid","value":"solid"},{"label":"Off","value":"off"}]',
   3),
  ('low_power_or_wont_accelerate_normally',
   'Have you noticed a sudden drop in your gas mileage along with the power loss?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('low_power_or_wont_accelerate_normally',
   'Does the car feel like it''s stuck in a lower gear or "held back" when you accelerate?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('low_power_or_wont_accelerate_normally',
   'Do you hear any unusual sounds — hissing, popping, or a louder-than-normal exhaust?',
   '[{"label":"Hissing","value":"hissing"},{"label":"Popping","value":"popping"},{"label":"Loud exhaust","value":"loud_exhaust"},{"label":"None","value":"none"}]',
   6),
  ('low_power_or_wont_accelerate_normally',
   'Does it happen more on hills, at highway speed, or all the time?',
   '[{"label":"On hills","value":"hills"},{"label":"At highway speed","value":"highway"},{"label":"All the time","value":"all_time"}]',
   7),

  -- ── Surging or RPMs Going Up and Down (7) ───────────────────────────
  ('surging_or_rpms_going_up_and_down',
   'Does the surging happen at idle when you''re stopped, or while you''re driving at a steady speed?',
   '[{"label":"At idle","value":"idle"},{"label":"Driving steady","value":"driving"},{"label":"Both","value":"both"}]',
   1),
  ('surging_or_rpms_going_up_and_down',
   'Does the RPM needle visibly bounce up and down without you touching the pedal?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('surging_or_rpms_going_up_and_down',
   'Does it surge more when the engine is cold, after it warms up, or both?',
   '[{"label":"When cold","value":"cold"},{"label":"After warming up","value":"warm"},{"label":"Both","value":"both"}]',
   3),
  ('surging_or_rpms_going_up_and_down',
   'Does running the A/C or heat make the surging better or worse?',
   '[{"label":"Worse","value":"worse"},{"label":"Better","value":"better"},{"label":"No change","value":"same"}]',
   4),
  ('surging_or_rpms_going_up_and_down',
   'Is the check engine light on or has it flashed recently?',
   '[{"label":"On now","value":"on"},{"label":"Flashed recently","value":"flashed"},{"label":"Off","value":"off"}]',
   5),
  ('surging_or_rpms_going_up_and_down',
   'Have you had any recent work done on the throttle, intake, or air filter?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('surging_or_rpms_going_up_and_down',
   'Does the car feel like it''s lurching forward at low speeds even when your foot isn''t on the gas?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Engine Misfire or Bucking Feeling (7) ───────────────────────────
  ('engine_misfire_or_bucking_feeling',
   'Does it feel like the car is skipping, jerking, or kicking while you''re driving?',
   '[{"label":"Skipping","value":"skipping"},{"label":"Jerking","value":"jerking"},{"label":"Kicking","value":"kicking"},{"label":"All","value":"all"}]',
   1),
  ('engine_misfire_or_bucking_feeling',
   'Is the check engine light flashing when this happens? (Flashing is more serious than solid.)',
   '[{"label":"Flashing","value":"flashing"},{"label":"Solid","value":"solid"},{"label":"Off","value":"off"}]',
   2),
  ('engine_misfire_or_bucking_feeling',
   'Does the misfire happen at certain speeds, under hard acceleration, or randomly?',
   '[{"label":"Certain speeds","value":"speeds"},{"label":"Hard acceleration","value":"hard_accel"},{"label":"Randomly","value":"random"}]',
   3),
  ('engine_misfire_or_bucking_feeling',
   'Does it get worse in rain, humidity, or wet weather?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('engine_misfire_or_bucking_feeling',
   'Have you noticed the exhaust sound has changed — louder, popping, or uneven?',
   '[{"label":"Louder","value":"louder"},{"label":"Popping","value":"popping"},{"label":"Uneven","value":"uneven"},{"label":"No change","value":"no_change"}]',
   5),
  ('engine_misfire_or_bucking_feeling',
   'How long has it been since the spark plugs were replaced?',
   '[{"label":"Within last year","value":"recent"},{"label":"1-3 years","value":"medium"},{"label":"Over 3 years","value":"old"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('engine_misfire_or_bucking_feeling',
   'Does the misfire come and go, or is it constant once it starts?',
   '[{"label":"Comes and goes","value":"intermittent"},{"label":"Constant","value":"constant"},{"label":"Not sure","value":"unsure"}]',
   7)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'performance',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, category, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 3. Sanity check — verify the expected per-category counts
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_subcategory_count INT;
  v_question_count    INT;
  v_orphan_count      INT;
  v_expected_sub_total INT := 47;
  v_expected_q_total   INT := 329;
BEGIN
  -- Subcategory counts per category in scope (excluding 'general' fallback)
  SELECT COUNT(*) INTO v_subcategory_count
    FROM public.concern_subcategories
   WHERE shop_id = 7476
     AND category IN ('electrical','hvac','leak','noise','other','performance')
     AND slug != 'general'
     AND active = TRUE;
  IF v_subcategory_count < v_expected_sub_total THEN
    RAISE EXCEPTION
      'concern subcategory seed (part 1) incomplete: % rows across 6 categories (expected %)',
      v_subcategory_count, v_expected_sub_total;
  END IF;

  -- Question counts linked to non-general subcategories in scope
  SELECT COUNT(*) INTO v_question_count
    FROM public.concern_questions cq
    JOIN public.concern_subcategories cs ON cs.id = cq.subcategory_id
   WHERE cq.shop_id = 7476
     AND cq.category IN ('electrical','hvac','leak','noise','other','performance')
     AND cs.slug != 'general'
     AND cq.active = TRUE;
  IF v_question_count < v_expected_q_total THEN
    RAISE EXCEPTION
      'concern question seed (part 1) incomplete: % subcategory-linked rows across 6 categories (expected %)',
      v_question_count, v_expected_q_total;
  END IF;

  -- Defensive: no orphan questions (subcategory_id NULL or pointing to a
  -- different category's subcategory)
  SELECT COUNT(*) INTO v_orphan_count
    FROM public.concern_questions cq
    LEFT JOIN public.concern_subcategories cs ON cs.id = cq.subcategory_id
   WHERE cq.shop_id = 7476
     AND cq.category IN ('electrical','hvac','leak','noise','other','performance')
     AND (cs.id IS NULL OR cs.category != cq.category);
  IF v_orphan_count > 0 THEN
    RAISE EXCEPTION
      'concern question seed (part 1) corrupted: % rows have NULL or cross-category subcategory_id',
      v_orphan_count;
  END IF;
END $$;


COMMIT;


-- ---------------------------------------------------------------------
-- Post-deploy verification (Chris runs after `supabase db push`)
-- ---------------------------------------------------------------------
--
-- Count subcategories per category (excluding 'general' fallback):
--   SELECT category, COUNT(*) AS subcategory_count
--     FROM public.concern_subcategories
--    WHERE shop_id = 7476
--      AND category IN ('electrical','hvac','leak','noise','other','performance')
--      AND slug != 'general'
--      AND active = TRUE
--    GROUP BY category
--    ORDER BY category;
--   Expected:
--     electrical    7
--     hvac          8
--     leak          7
--     noise        10
--     other         6
--     performance   9
--
-- Count questions per subcategory:
--   SELECT cs.category, cs.slug, cs.display_label, COUNT(cq.id) AS question_count
--     FROM public.concern_subcategories cs
--     LEFT JOIN public.concern_questions cq
--       ON cq.subcategory_id = cs.id AND cq.active = TRUE
--    WHERE cs.shop_id = 7476
--      AND cs.category IN ('electrical','hvac','leak','noise','other','performance')
--      AND cs.slug != 'general'
--    GROUP BY cs.category, cs.slug, cs.display_label, cs.display_order
--    ORDER BY cs.category, cs.display_order;
--   Every row should report a count of 7 (each subcategory has exactly 7
--   questions per the diagnostic markdown source).
--
-- Live diagnostic test (per category):
--   Customer says "my AC blows hot" → LLM should match
--   hvac/ac_blows_warm_or_hot_air subcategory and surface its 7 questions
--   (minus any already answered by the free-text description).
-- ---------------------------------------------------------------------
