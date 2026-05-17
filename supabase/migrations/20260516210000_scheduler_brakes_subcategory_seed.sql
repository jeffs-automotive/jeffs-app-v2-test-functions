-- =====================================================================
-- Brakes diagnostic subcategory + question seed
-- =====================================================================
-- Created 2026-05-16 per R6-C-1 BLOCKER.
--
-- Background: the diagnostic flow (chat-design.md "Architecture amendment
-- — 2026-05-14" §Step 7 redesign) does a two-stage LLM call:
--
--   Stage 1 — subcategory filter: given the customer's description,
--             pick which symptom-bucket subcategories match.
--   Stage 2 — gap detection: from the matched subcategories' questions,
--             drop the ones the description already answered.
--
-- The R4 fix (commit c05f876) wired the LLM to filter by subcategory_slug,
-- BUT migration 20260514100000 only created a "general" subcategory per
-- (shop, category) as a backfill. There were no REAL subcategories in
-- the DB — the filter had nothing to filter on, so customers got every
-- question in the category regardless of symptom (the original user
-- bug: "brakes are grinding" → asked about pedal-sinking, vibration, etc.).
--
-- This migration seeds the 6 brake subcategories from
-- docs/scheduler/concerns/brakes/brakes-concerns.md + their 37 questions
-- with options arrays inferred from the question wording. The
-- pre-existing 5 "general" brake questions stay where they are — they
-- act as the fallback when the LLM can't match a specific subcategory.
--
-- Idempotent re-apply:
--   - Subcategory inserts use ON CONFLICT (shop_id, category, slug)
--   - Question inserts use ON CONFLICT (shop_id, subcategory_id, question_text)
-- =====================================================================

BEGIN;


-- ---------------------------------------------------------------------
-- 1. Insert the 6 brake subcategories
-- ---------------------------------------------------------------------

INSERT INTO public.concern_subcategories
  (shop_id, category, slug, display_label, display_order, active)
VALUES
  (7476, 'brakes', 'high_pitched_squealing',      'High-pitched squealing',      1, TRUE),
  (7476, 'brakes', 'metallic_grinding',           'Metallic grinding',           2, TRUE),
  (7476, 'brakes', 'spongy_or_soft_pedal',        'Spongy or soft pedal',        3, TRUE),
  (7476, 'brakes', 'pedal_sinks_to_floor',        'Pedal sinks to floor',        4, TRUE),
  (7476, 'brakes', 'pulsating_or_vibrating_pedal','Pulsating or vibrating pedal',5, TRUE),
  (7476, 'brakes', 'hard_or_unresponsive_pedal',  'Hard or unresponsive pedal',  6, TRUE)
ON CONFLICT (shop_id, category, slug) DO NOTHING;


-- ---------------------------------------------------------------------
-- 2. Seed the 37 questions across the 6 subcategories
--
-- Options inferred from question wording. Where a question is
-- yes/no-shaped, options are "Yes" / "No" (sometimes plus "Not sure"
-- for ambiguous-recall questions like "Have you had brake work done
-- recently?"). Where the question is multi-choice (speed bands,
-- locations, conditions), options reflect those.
--
-- The "verbatim from spec" question_text comes from
-- docs/scheduler/concerns/brakes/brakes-concerns.md (typos preserved
-- where the customer-facing copy is clear enough; spec authors can
-- edit via the future upload_concern_category_md MCP tool).
--
-- ON CONFLICT keys on (shop_id, category, question_text) which has a
-- UNIQUE constraint per migration 20260513200000 line 43-45. Existing
-- generic brake questions (e.g., "What are you noticing?") are NOT
-- re-inserted by this migration; they stay under the "general"
-- subcategory as the LLM fallback.
-- ---------------------------------------------------------------------

WITH sub AS (
  SELECT id, slug FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'brakes'
),
new_questions(slug, question_text, options_json, display_order) AS (
  VALUES
  -- ── High-Pitched Squealing (7) ─────────────────────────────────────
  ('high_pitched_squealing',
   'Does it occur at high speeds, low speeds, or right before stopping?',
   '[{"label":"High speeds","value":"high"},{"label":"Low speeds","value":"low"},{"label":"Right before stopping","value":"stopping"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('high_pitched_squealing',
   'Does it quiet down or get louder when pressing the pedal harder?',
   '[{"label":"Quieter","value":"quieter"},{"label":"Louder","value":"louder"},{"label":"No change","value":"no_change"}]',
   2),
  ('high_pitched_squealing',
   'Is the noise worse during the first few stops in the morning or does it get louder the longer you drive?',
   '[{"label":"Worse in the morning","value":"morning"},{"label":"Louder the longer I drive","value":"longer"},{"label":"About the same","value":"same"}]',
   3),
  ('high_pitched_squealing',
   'Does rain, high humidity, or morning dew affect the sound?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   4),
  ('high_pitched_squealing',
   'Have you had any brake work done recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('high_pitched_squealing',
   'Does the noise happen after the vehicle sits for a while and then goes away after driving?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),
  ('high_pitched_squealing',
   'Do you hear the noise coming from the front or rear of the vehicle? Left or right side?',
   '[{"label":"Front","value":"front"},{"label":"Rear","value":"rear"},{"label":"All four wheels","value":"all"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Metallic Grinding (7) ──────────────────────────────────────────
  ('metallic_grinding',
   'Does the grinding happen every single time you apply the brakes?',
   '[{"label":"Every time","value":"every"},{"label":"Sometimes","value":"sometimes"},{"label":"Only at certain speeds","value":"speed_dependent"}]',
   1),
  ('metallic_grinding',
   'Do you hear a scraping sound even when your foot is off the pedal?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   2),
  ('metallic_grinding',
   'Does the sound feel like it is coming from the front or rear? Left or right side?',
   '[{"label":"Front","value":"front"},{"label":"Rear","value":"rear"},{"label":"All four wheels","value":"all"},{"label":"Not sure","value":"unsure"}]',
   3),
  ('metallic_grinding',
   'Can you feel a harsh grinding sensation through the floor or pedal?',
   '[{"label":"Through the pedal","value":"pedal"},{"label":"Through the floor","value":"floor"},{"label":"Both","value":"both"},{"label":"No","value":"no"}]',
   4),
  ('metallic_grinding',
   'Did this sound start suddenly, or build up over several weeks?',
   '[{"label":"Suddenly","value":"sudden"},{"label":"Built up gradually","value":"gradual"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('metallic_grinding',
   'Do you feel safe driving the vehicle?',
   '[{"label":"Yes","value":"yes"},{"label":"No — I''m worried","value":"no"}]',
   6),
  ('metallic_grinding',
   'Have you had brake work done recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   7),

  -- ── Spongy or Soft Pedal (5) ───────────────────────────────────────
  ('spongy_or_soft_pedal',
   'Does the brake pedal get firmer if you pump it rapidly three times?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   1),
  ('spongy_or_soft_pedal',
   'Can you easily push the pedal all the way down to the carpet?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   2),
  ('spongy_or_soft_pedal',
   'Does the vehicle take longer to start slowing down than it used to?',
   '[{"label":"Yes — noticeably longer","value":"longer"},{"label":"Slightly longer","value":"slight"},{"label":"No change","value":"no_change"}]',
   3),
  ('spongy_or_soft_pedal',
   'Have you noticed the brake fluid reservoir level dropping recently?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   4),
  ('spongy_or_soft_pedal',
   'Has the brake system been opened or bled for service recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),

  -- ── Pedal Sinks to Floor (6) ───────────────────────────────────────
  ('pedal_sinks_to_floor',
   'Does the pedal creep down while holding pressure at a red light?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   1),
  ('pedal_sinks_to_floor',
   'Does it sink faster if you press lightly or if you press firmly?',
   '[{"label":"Faster with light pressure","value":"light"},{"label":"Faster with firm pressure","value":"firm"},{"label":"About the same","value":"same"}]',
   2),
  ('pedal_sinks_to_floor',
   'Are there any visible fluid spots on your driveway or garage floor?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t checked","value":"unsure"}]',
   3),
  ('pedal_sinks_to_floor',
   'Are there any warning lights on the dash?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   4),
  ('pedal_sinks_to_floor',
   'Does the pedal pop right back up instantly when you release your foot?',
   '[{"label":"Yes","value":"yes"},{"label":"No — feels slow to return","value":"slow"}]',
   5),
  ('pedal_sinks_to_floor',
   'Have you had any brake work done recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),

  -- ── Pulsating or Vibrating Pedal (6) ───────────────────────────────
  ('pulsating_or_vibrating_pedal',
   'At what specific speed does the foot pedal vibration become noticeable?',
   '[{"label":"Low speeds (under 30 mph)","value":"low"},{"label":"Highway speeds (45+ mph)","value":"highway"},{"label":"Any speed","value":"any"},{"label":"Not sure","value":"unsure"}]',
   1),
  ('pulsating_or_vibrating_pedal',
   'Does the pulsation get worse the harder you press on the brakes?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"About the same","value":"same"}]',
   2),
  ('pulsating_or_vibrating_pedal',
   'Do you feel the vibration in the steering wheel or in your seat?',
   '[{"label":"Steering wheel","value":"steering"},{"label":"Seat","value":"seat"},{"label":"Both","value":"both"},{"label":"Just the pedal","value":"pedal_only"}]',
   3),
  ('pulsating_or_vibrating_pedal',
   'Does the pulsation worsen after driving down a long hill or mountain?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Haven''t driven on hills lately","value":"na"}]',
   4),
  ('pulsating_or_vibrating_pedal',
   'Do you feel the vibration all the time, when first driving or after driving for a while?',
   '[{"label":"All the time","value":"all_time"},{"label":"Only when first driving","value":"cold"},{"label":"After driving a while","value":"warm"}]',
   5),
  ('pulsating_or_vibrating_pedal',
   'Have you had brake work done recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6),

  -- ── Hard or Unresponsive Pedal (6) ─────────────────────────────────
  ('hard_or_unresponsive_pedal',
   'Is the pedal stiff before you turn the engine key on in the morning?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"}]',
   1),
  ('hard_or_unresponsive_pedal',
   'Does the pedal drop slightly when you crank the engine over?',
   '[{"label":"Yes — drops slightly","value":"yes"},{"label":"No change","value":"no"},{"label":"Not sure","value":"unsure"}]',
   2),
  ('hard_or_unresponsive_pedal',
   'Does the pedal get harder to press the longer you drive the vehicle?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Sometimes","value":"sometimes"}]',
   3),
  ('hard_or_unresponsive_pedal',
   'Do you hear any noises while you are braking?',
   '[{"label":"Yes — I''ll describe","value":"yes"},{"label":"No","value":"no"}]',
   4),
  ('hard_or_unresponsive_pedal',
   'Does the engine idle rough or stumble when you press the brakes?',
   '[{"label":"Yes","value":"yes"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   5),
  ('hard_or_unresponsive_pedal',
   'Have you had brake work done recently?',
   '[{"label":"Yes — recently","value":"recent"},{"label":"No","value":"no"},{"label":"Not sure","value":"unsure"}]',
   6)
)
INSERT INTO public.concern_questions
  (shop_id, category, subcategory_id, question_text, options, display_order, active)
SELECT
  7476,
  'brakes',
  sub.id,
  nq.question_text,
  nq.options_json::jsonb,
  nq.display_order,
  TRUE
FROM new_questions nq
JOIN sub ON sub.slug = nq.slug
ON CONFLICT (shop_id, subcategory_id, question_text) DO NOTHING;


-- ---------------------------------------------------------------------
-- 3. Sanity check — every brake subcategory has questions
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_subcategory_count INT;
  v_question_count INT;
  v_orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO v_subcategory_count
    FROM public.concern_subcategories
   WHERE shop_id = 7476 AND category = 'brakes' AND active = TRUE;
  IF v_subcategory_count < 7 THEN  -- 6 specific + 1 'general'
    RAISE EXCEPTION
      'brake subcategory seed incomplete: % rows (expected 7 = 6 specific + 1 general)',
      v_subcategory_count;
  END IF;

  SELECT COUNT(*) INTO v_question_count
    FROM public.concern_questions cq
    JOIN public.concern_subcategories cs ON cs.id = cq.subcategory_id
   WHERE cq.shop_id = 7476
     AND cq.category = 'brakes'
     AND cs.slug != 'general'
     AND cq.active = TRUE;
  IF v_question_count < 37 THEN
    RAISE EXCEPTION
      'brake question seed incomplete: % subcategory-linked rows (expected 37)',
      v_question_count;
  END IF;

  -- Defensive: no orphan questions (subcategory_id NULL or pointing to
  -- a different category's subcategory)
  SELECT COUNT(*) INTO v_orphan_count
    FROM public.concern_questions cq
    LEFT JOIN public.concern_subcategories cs ON cs.id = cq.subcategory_id
   WHERE cq.shop_id = 7476
     AND cq.category = 'brakes'
     AND (cs.id IS NULL OR cs.category != cq.category);
  IF v_orphan_count > 0 THEN
    RAISE EXCEPTION
      'brake question seed corrupted: % rows have NULL or cross-category subcategory_id',
      v_orphan_count;
  END IF;
END $$;


COMMIT;


-- ---------------------------------------------------------------------
-- Post-deploy verification (Chris runs after `supabase db push`)
-- ---------------------------------------------------------------------
--
-- Count brake subcategories (expect 7 = 6 new + 1 general backfill):
--   SELECT slug, display_label, display_order
--     FROM public.concern_subcategories
--    WHERE shop_id = 7476 AND category = 'brakes' AND active = TRUE
--    ORDER BY display_order;
--
-- Count questions per subcategory:
--   SELECT cs.slug, cs.display_label, COUNT(cq.id) AS question_count
--     FROM public.concern_subcategories cs
--     LEFT JOIN public.concern_questions cq
--       ON cq.subcategory_id = cs.id AND cq.active = TRUE
--    WHERE cs.shop_id = 7476 AND cs.category = 'brakes'
--    GROUP BY cs.slug, cs.display_label, cs.display_order
--    ORDER BY cs.display_order;
--   Expected:
--     high_pitched_squealing       — 7
--     metallic_grinding            — 7
--     spongy_or_soft_pedal         — 5
--     pedal_sinks_to_floor         — 6
--     pulsating_or_vibrating_pedal — 6
--     hard_or_unresponsive_pedal   — 6
--     general                      — 5 (existing fallback)
--
-- Live diagnostic test:
--   Customer says "brakes are grinding" → LLM should match
--   "metallic_grinding" + return up to 7 questions from THAT subcategory,
--   skipping any already-answered by the description. Should NOT
--   return questions from any other subcategory.
-- ---------------------------------------------------------------------
