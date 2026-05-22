-- =====================================================================
-- Scheduler — exhaust-system noise subcategories (2 new rows)
-- =====================================================================
-- 2026-05-21. Closes the catalog gap surfaced by batch-17 #22
-- ("exhaust manifold gasket" → routed to oil_leak_testing) and broader
-- evidence that exhaust-system concerns currently have no dedicated
-- subcategory under `noise`. Adds 2 new rows in concern_subcategories
-- so the Stage-2 classifier can pick them when Stage-1 has picked the
-- new `exhaust_system_testing` testing service.
--
-- WHAT THIS ADDS:
--   1. noise/exhaust_louder_or_rumbling — louder-than-normal exhaust,
--      rumble/drone under the car, lost-muffler sound, deeper tone at
--      idle (typical of a rotted muffler, broken exhaust hanger, or
--      cracked downpipe).
--   2. noise/exhaust_manifold_tick_or_puff — rhythmic ticking from the
--      engine bay that's loudest on cold start and quiets when warm,
--      puffing/chuffing sound that goes with engine cycles (classic
--      exhaust-manifold-gasket leak symptom — often misdiagnosed as a
--      valvetrain tick or an oil leak).
--
-- Both rows are seeded with description, positive_examples,
-- negative_examples, synonyms, and eligible_testing_service_keys =
-- ARRAY['exhaust_system_testing'] so the Stage-1 → Stage-2 routing
-- works as soon as the testing_services row for exhaust_system_testing
-- is uploaded.
--
-- IDEMPOTENT: ON CONFLICT (shop_id, category, slug) DO NOTHING. Re-
-- applying is a no-op if the rows already exist.
--
-- NOTE on questions: the new subcategories ship WITHOUT clarifying
-- questions in concern_questions. The wizard handles a zero-question
-- subcategory by routing straight to testing_service_approval (no
-- clarification round). That's the correct UX for exhaust concerns:
-- the customer's description is already specific enough to recommend
-- the exhaust evaluation. Advisors can add per-question follow-ups
-- later via the standard question-upload path if testing surfaces a
-- need.
--
-- ROLLBACK:
--   DELETE FROM public.concern_subcategories
--   WHERE shop_id = 7476
--     AND category = 'noise'
--     AND slug IN ('exhaust_louder_or_rumbling', 'exhaust_manifold_tick_or_puff');

BEGIN;

INSERT INTO public.concern_subcategories (
  shop_id,
  category,
  slug,
  display_label,
  display_order,
  active,
  description,
  positive_examples,
  negative_examples,
  synonyms,
  eligible_testing_service_keys
)
VALUES
  (
    7476,
    'noise',
    'exhaust_louder_or_rumbling',
    'Exhaust louder than normal or rumbling',
    100,
    TRUE,
    'A deep, throaty rumble, drone, or "louder-than-it-used-to-be" exhaust note — the car sounds like a muscle car, motorcycle, or has a hole in the muffler. Often loudest at idle or under throttle and may be paired with a faint exhaust smell. Common causes are a rusted-through muffler, a cracked downpipe or flex pipe, broken/missing exhaust hangers, or a failed cat-back section. Distinct from noise/rattling_underneath_the_car (which is a metallic loose-parts rattle, not a deeper exhaust note) and from noise/exhaust_manifold_tick_or_puff (which is a sharp rhythmic tick from the engine bay that quiets when warm, not a steady rumble from underneath). Cross-category: an exhaust smell coming through the cabin belongs to smell/exhaust_fumes_inside_the_cabin.',
    ARRAY[
      'My exhaust got really loud all of a sudden — sounds like a muscle car now',
      'The car sounds like a Harley when I start it up',
      'Deep rumble underneath, way louder than it used to be',
      'I think my muffler is gone — sounds awful',
      'Loud drone from the back of the car under throttle',
      'Exhaust note is way deeper than normal',
      'Sounds like there''s a hole in my exhaust somewhere'
    ]::TEXT[],
    ARRAY[
      '"Tinny rattle that comes and goes" → noise/rattling_underneath_the_car',
      '"Ticking from the engine bay that goes away once it warms up" → noise/exhaust_manifold_tick_or_puff',
      '"Hissing under the hood" → noise/hissing_noise',
      '"Whistle when I accelerate hard" → noise/high_pitched_whining_under_the_hood',
      '"Exhaust smell in the cabin" → smell/exhaust_fumes_inside_the_cabin'
    ]::TEXT[],
    ARRAY[
      'loud exhaust', 'louder exhaust', 'rumbling exhaust', 'rumble', 'drone',
      'muffler is gone', 'no muffler', 'hole in muffler', 'hole in exhaust',
      'muscle car sound', 'harley sound', 'motorcycle sound', 'deeper exhaust',
      'throaty exhaust', 'broken muffler', 'rotted exhaust', 'rusted muffler',
      'cracked exhaust', 'exhaust leak'
    ]::TEXT[],
    ARRAY['exhaust_system_testing']::TEXT[]
  ),
  (
    7476,
    'noise',
    'exhaust_manifold_tick_or_puff',
    'Engine-bay tick or puff — exhaust manifold leak',
    101,
    TRUE,
    'A sharp, rhythmic ticking, tapping, or puffing/chuffing from the engine bay that follows engine RPM — fast at idle, faster under acceleration. Often loudest right after a cold start and quiets (or disappears) once the engine reaches full operating temperature, because the exhaust manifold and gasket expand and seal as they heat up. Classic exhaust-manifold-gasket leak symptom. Distinct from noise/engine_ticking_or_tapping (which is a valvetrain tick from the TOP of the engine that does NOT quiet with warmth — and is often paired with oil-pressure concerns) and from noise/deep_knocking_from_the_engine (which is a deep heavy hammer-blow knock, not a sharp rhythmic tick). Cross-category: a hiss (no rhythm) belongs to noise/hissing_noise; an exhaust smell in the cabin belongs to smell/exhaust_fumes_inside_the_cabin.',
    ARRAY[
      'Ticking sound from the engine bay when I start the car cold — goes away after about 5 minutes',
      'Puffing noise that goes with the engine, louder when it''s cold',
      'I think I have an exhaust manifold leak — it ticks at startup',
      'Sharp chuff-chuff-chuff from under the hood — quiets down as it warms up',
      'Sounds like a sewing machine on cold mornings, then disappears',
      'Rhythmic tapping from the front of the engine bay, only when cold',
      'Exhaust manifold gasket leak — I can hear it ticking'
    ]::TEXT[],
    ARRAY[
      '"Light tap from the top of the engine that''s always there" → noise/engine_ticking_or_tapping',
      '"Deep knock from the bottom of the engine under load" → noise/deep_knocking_from_the_engine',
      '"Hissing from under the hood — no rhythm" → noise/hissing_noise',
      '"Loud deep rumble that''s always there" → noise/exhaust_louder_or_rumbling',
      '"Exhaust smell inside the car" → smell/exhaust_fumes_inside_the_cabin'
    ]::TEXT[],
    ARRAY[
      'exhaust manifold leak', 'manifold gasket leak', 'exhaust manifold gasket',
      'tick at startup', 'cold tick', 'cold-start tick', 'tick that goes away',
      'puff puff puff', 'chuffing', 'chuff', 'exhaust tick', 'manifold tick',
      'sewing machine sound', 'rhythmic tick', 'puffing noise', 'cold-engine tick',
      'exhaust leak tick', 'header leak'
    ]::TEXT[],
    ARRAY['exhaust_system_testing']::TEXT[]
  )
ON CONFLICT (shop_id, category, slug) DO NOTHING;

COMMIT;
