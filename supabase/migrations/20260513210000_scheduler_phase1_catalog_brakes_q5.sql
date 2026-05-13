-- Scheduler Phase 1 — fill in missing "How long" question for brakes
-- Date: 2026-05-13
--
-- Earlier import migration (20260513200000) added Q5 ("Anything else
-- change") for brakes but the brakes category was already missing
-- Q3 ("How long has this been happening?") per appointments-diagnostics.md
-- §4.11. Adding it here so brakes matches every other category at 5
-- questions. Idempotent via the unique constraint added in 200000.

INSERT INTO public.concern_questions (shop_id, category, question_text, options, display_order)
VALUES
  (7476, 'brakes', 'How long has this been happening?',
   '[{"label":"Today","value":"today"},{"label":"A few days","value":"days"},{"label":"A few weeks","value":"weeks"},{"label":"Longer","value":"long"}]'::jsonb, 5)
ON CONFLICT (shop_id, category, question_text) DO NOTHING;
