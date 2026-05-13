-- Scheduler Phase 1 — catalog imports
-- Date: 2026-05-13
--
-- Fixes a category-naming bug + imports the predetermined questions from
-- the appointments-diagnostics.md spec into concern_questions, plus
-- normalises the testing_services concern_categories tags so the
-- diagnostic specialist's `s.concern_categories.includes(category)`
-- filter actually finds matching services.
--
-- 1. Fix testing_services.concern_categories: 'warning-light' → 'warning_light'
--    The concern_questions catalog (and the chat agent) uses underscore for
--    every category key. testing_services was seeded with a hyphen for the
--    warning-light category only, which silently dropped 4 services
--    (warning_light_general, tpms_testing, alternator_testing, battery_test)
--    from the diagnostic specialist's recommendation filter for warning_light
--    concerns. Verified live 2026-05-13 — Playwright happy-path test of
--    "check engine light came on" returned recommended_testing_services: [].
--
-- 2. Bring each concern_questions category up to the spec's intended
--    coverage (~5 questions per category from appointments-diagnostics.md
--    §4.1-4.14). The original seed comment said "~50 rows" but only 35
--    landed. The specialist picks UP TO 4 per turn so a thinner pool
--    means the specialist sometimes has nothing to skip and asks
--    questions the customer already answered.
--
-- Idempotent: re-applying is safe.
--   - UPDATE testing_services uses array_replace which is a no-op for
--     already-fixed rows.
--   - INSERTs use ON CONFLICT DO NOTHING keyed on (shop_id, category,
--     question_text) which is the unique index.

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Add unique constraint on concern_questions so re-running the seed
--    is safe. The original migration used `ON CONFLICT DO NOTHING`
--    without a target spec which depends on PK conflict — and since
--    id is BIGSERIAL there is no PK conflict, so re-runs would have
--    DUPLICATED every row. Adding the explicit unique key makes the
--    catalog seed safely idempotent going forward.
-- ---------------------------------------------------------------------

ALTER TABLE public.concern_questions
  ADD CONSTRAINT concern_questions_shop_category_text_uniq
    UNIQUE (shop_id, category, question_text);

-- ---------------------------------------------------------------------
-- 1. Fix testing_services category-tag mismatch
-- ---------------------------------------------------------------------

UPDATE public.testing_services
SET concern_categories = array_replace(
  concern_categories,
  'warning-light',
  'warning_light'
)
WHERE shop_id = 7476
  AND 'warning-light' = ANY (concern_categories);

-- ---------------------------------------------------------------------
-- 2. Add missing concern_questions per the spec
-- ---------------------------------------------------------------------

INSERT INTO public.concern_questions (shop_id, category, question_text, options, display_order)
VALUES
  -- Noise (spec §4.1) — add Q5 (recent changes)
  (7476, 'noise', 'Anything recently change with the car?',
   '[{"label":"New tires","value":"new_tires"},{"label":"Recent service","value":"recent_service"},{"label":"Hit a pothole / curb","value":"pothole"},{"label":"After winter / storage","value":"storage"},{"label":"Nothing I can think of","value":"none"}]'::jsonb, 5),

  -- Vibration (spec §4.2) — add Q4 (duration), Q5 (recent impact)
  (7476, 'vibration', 'How long has this been happening?',
   '[{"label":"Today","value":"today"},{"label":"A few days","value":"days"},{"label":"A few weeks","value":"weeks"},{"label":"Longer","value":"long"}]'::jsonb, 4),
  (7476, 'vibration', 'Any recent impact (curb, pothole) or alignment work?',
   '[{"label":"Hit a curb / pothole","value":"impact"},{"label":"Recent alignment","value":"alignment"},{"label":"Nothing recent","value":"none"}]'::jsonb, 5),

  -- Pulling (spec §4.3) — add Q3 (under what), Q4 (duration), Q5 (recent work)
  (7476, 'pulling', 'Does it pull more under braking, acceleration, or just cruising?',
   '[{"label":"Braking","value":"braking"},{"label":"Acceleration","value":"accel"},{"label":"Cruising","value":"cruise"},{"label":"All the time","value":"all"}]'::jsonb, 3),
  (7476, 'pulling', 'How long has this been happening?',
   '[{"label":"Today","value":"today"},{"label":"A few days","value":"days"},{"label":"A few weeks","value":"weeks"},{"label":"Longer","value":"long"}]'::jsonb, 4),
  (7476, 'pulling', 'Any recent tire, alignment, or suspension work?',
   '[{"label":"Recent tire work","value":"tires"},{"label":"Recent alignment","value":"align"},{"label":"Recent suspension","value":"susp"},{"label":"Hit a curb / pothole","value":"impact"},{"label":"Nothing recent","value":"none"}]'::jsonb, 5),

  -- Smell (spec §4.4) — add Q4 (duration), Q5 (anything else changed)
  (7476, 'smell', 'How long has this been happening?',
   '[{"label":"Today","value":"today"},{"label":"A few days","value":"days"},{"label":"A few weeks","value":"weeks"},{"label":"Longer","value":"long"}]'::jsonb, 4),
  (7476, 'smell', 'Anything else changed (new noise, light, leak)?',
   '[{"label":"New noise","value":"noise"},{"label":"Warning light","value":"light"},{"label":"Leak / drip","value":"leak"},{"label":"Performance change","value":"perf"},{"label":"Nothing else","value":"none"}]'::jsonb, 5),

  -- Smoke (spec §4.5) — add Q3 (when), Q4 (smell with it), Q5 (warning lights)
  (7476, 'smoke', 'When does the smoke happen?',
   '[{"label":"Cold start","value":"cold_start"},{"label":"Accelerating","value":"accel"},{"label":"After driving warm","value":"warm"},{"label":"Always","value":"always"}]'::jsonb, 3),
  (7476, 'smoke', 'Any smell with the smoke?',
   '[{"label":"Sweet (coolant)","value":"sweet"},{"label":"Burnt oil","value":"oil"},{"label":"Fuel / gas","value":"fuel"},{"label":"Electrical / plastic","value":"electrical"},{"label":"No smell I can identify","value":"none"}]'::jsonb, 4),
  (7476, 'smoke', 'Any warning lights on?',
   '[{"label":"Check engine","value":"cel"},{"label":"Oil pressure","value":"oil"},{"label":"Temperature / coolant","value":"temp"},{"label":"None that I noticed","value":"none"}]'::jsonb, 5),

  -- Leak (spec §4.6) — add Q4 (when noticed), Q5 (warning lights / driving)
  (7476, 'leak', 'When did you notice the leak?',
   '[{"label":"Today","value":"today"},{"label":"This week","value":"week"},{"label":"After driving","value":"after_drive"},{"label":"Only when parked overnight","value":"overnight"}]'::jsonb, 4),
  (7476, 'leak', 'Any warning lights on or unusual driving?',
   '[{"label":"Temperature / coolant light","value":"temp"},{"label":"Oil pressure light","value":"oil"},{"label":"Check engine","value":"cel"},{"label":"Driving feels different","value":"driving"},{"label":"Nothing unusual","value":"none"}]'::jsonb, 5),

  -- Warning light (spec §4.7) — add Q4 (how driving), Q5 (other symptoms)
  (7476, 'warning_light', 'How is the car driving?',
   '[{"label":"Normally","value":"normal"},{"label":"Sluggish / low power","value":"sluggish"},{"label":"Hesitating","value":"hesitating"},{"label":"Stalling","value":"stalling"},{"label":"Different than usual","value":"different"}]'::jsonb, 4),
  (7476, 'warning_light', 'Any other symptoms (smell, sound, vibration, smoke)?',
   '[{"label":"New smell","value":"smell"},{"label":"New sound","value":"sound"},{"label":"New vibration","value":"vibration"},{"label":"Smoke","value":"smoke"},{"label":"Nothing else","value":"none"}]'::jsonb, 5),

  -- Performance (spec §4.8) — add Q3 (under conditions), Q4 (duration), Q5 (warning lights)
  (7476, 'performance', 'Under what conditions does it happen?',
   '[{"label":"Uphill","value":"uphill"},{"label":"Accelerating from stop","value":"from_stop"},{"label":"Cruising","value":"cruising"},{"label":"In a certain gear","value":"gear"},{"label":"All the time","value":"always"}]'::jsonb, 3),
  (7476, 'performance', 'How long has this been happening?',
   '[{"label":"Today","value":"today"},{"label":"A few days","value":"days"},{"label":"A few weeks","value":"weeks"},{"label":"Longer","value":"long"}]'::jsonb, 4),
  (7476, 'performance', 'Any warning lights on?',
   '[{"label":"Check engine","value":"cel"},{"label":"Service / wrench","value":"service"},{"label":"Battery","value":"battery"},{"label":"None I see","value":"none"}]'::jsonb, 5),

  -- Electrical (spec §4.9) — add Q3 (battery age), Q4 (recent jump-starts), Q5 (anything else)
  (7476, 'electrical', 'How old is the battery?',
   '[{"label":"Less than 2 years","value":"new"},{"label":"2–4 years","value":"mid"},{"label":"More than 4 years","value":"old"},{"label":"I don''t know","value":"unsure"}]'::jsonb, 3),
  (7476, 'electrical', 'Any recent jump-starts?',
   '[{"label":"Yes — once recently","value":"once"},{"label":"Yes — multiple times","value":"multi"},{"label":"No","value":"no"}]'::jsonb, 4),
  (7476, 'electrical', 'Anything else acting weird (slow crank, dim lights)?',
   '[{"label":"Slow crank","value":"slow_crank"},{"label":"Dim lights","value":"dim"},{"label":"Stalls / shuts off","value":"stalls"},{"label":"Nothing else","value":"none"}]'::jsonb, 5),

  -- HVAC (spec §4.10) — add Q3 (vents), Q4 (when started), Q5 (anything else)
  (7476, 'hvac', 'Which vents are affected?',
   '[{"label":"Dash vents","value":"dash"},{"label":"Floor vents","value":"floor"},{"label":"Defrost (windshield)","value":"defrost"},{"label":"All vents","value":"all"}]'::jsonb, 3),
  (7476, 'hvac', 'When did this start?',
   '[{"label":"Today","value":"today"},{"label":"This week","value":"week"},{"label":"Gradually over time","value":"gradual"},{"label":"After a recent service","value":"after_service"}]'::jsonb, 4),
  (7476, 'hvac', 'Anything else changed (noise, leak in cabin, foggy windows)?',
   '[{"label":"Noise from vents","value":"noise"},{"label":"Leak / wet floor","value":"leak"},{"label":"Foggy / can''t defog","value":"fog"},{"label":"Nothing else","value":"none"}]'::jsonb, 5),

  -- Brakes (spec §4.11) — add Q4 (recent brake work — already exists as Q3 in DB; add Q5 anything else)
  (7476, 'brakes', 'Anything else change (warning light, longer stopping)?',
   '[{"label":"Brake warning light","value":"light"},{"label":"Takes longer to stop","value":"long_stop"},{"label":"Steering pulls when braking","value":"pull"},{"label":"Nothing else","value":"none"}]'::jsonb, 4),

  -- Steering (spec §4.12) — add Q3 (one direction or both), Q4 (duration), Q5 (recent work)
  (7476, 'steering', 'One direction or both?',
   '[{"label":"Left only","value":"left"},{"label":"Right only","value":"right"},{"label":"Both directions","value":"both"}]'::jsonb, 3),
  (7476, 'steering', 'How long has this been happening?',
   '[{"label":"Today","value":"today"},{"label":"A few days","value":"days"},{"label":"A few weeks","value":"weeks"},{"label":"Longer","value":"long"}]'::jsonb, 4),
  (7476, 'steering', 'Any recent suspension/alignment work or impact?',
   '[{"label":"Recent alignment","value":"align"},{"label":"Recent suspension","value":"susp"},{"label":"Hit a curb / pothole","value":"impact"},{"label":"Nothing recent","value":"none"}]'::jsonb, 5),

  -- Tires (spec §4.13) — add Q3 (recent tire work), Q4 (visible damage), Q5 (vibration / pulling)
  (7476, 'tires', 'Any recent tire work (rotation, patch, new tires)?',
   '[{"label":"Recent rotation","value":"rotation"},{"label":"Recent patch","value":"patch"},{"label":"New tires","value":"new"},{"label":"Nothing recent","value":"none"}]'::jsonb, 3),
  (7476, 'tires', 'Any visible damage to the tire?',
   '[{"label":"Nail / object stuck","value":"nail"},{"label":"Sidewall damage / bulge","value":"sidewall"},{"label":"Tread damage / cuts","value":"tread"},{"label":"No visible damage","value":"none"}]'::jsonb, 4),
  (7476, 'tires', 'Any vibration or pulling along with it?',
   '[{"label":"Yes — vibration","value":"vib"},{"label":"Yes — pulling","value":"pull"},{"label":"Both","value":"both"},{"label":"Neither","value":"none"}]'::jsonb, 5),

  -- Other (spec §4.14) — add Q3 (have you noticed anything specific), Q4 (recent service), Q5 (safe to drive)
  (7476, 'other', 'Have you noticed anything specific (smell, sound, vibration, light)?',
   '[{"label":"New smell","value":"smell"},{"label":"New sound","value":"sound"},{"label":"New vibration","value":"vibration"},{"label":"Warning light","value":"light"},{"label":"Nothing specific","value":"none"}]'::jsonb, 3),
  (7476, 'other', 'Any recent service or repairs?',
   '[{"label":"Recent oil change","value":"oil"},{"label":"Recent tire work","value":"tires"},{"label":"Recent brake / suspension work","value":"chassis"},{"label":"Other recent service","value":"other"},{"label":"Nothing recent","value":"none"}]'::jsonb, 4),
  (7476, 'other', 'Is the car safe to drive in?',
   '[{"label":"Yes — drives fine","value":"yes"},{"label":"Maybe — not sure","value":"maybe"},{"label":"No — I''m worried about driving it","value":"no"}]'::jsonb, 5)

ON CONFLICT (shop_id, category, question_text) DO NOTHING;

COMMIT;
