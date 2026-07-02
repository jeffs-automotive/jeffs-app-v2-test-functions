-- =====================================================================
-- required_facts backfill — revamp Phase A (llm-launch-gate)
-- =====================================================================
-- REVAMP-PLAN §7 Phase A: "Backfill required_facts on the empty questions
-- (or ratify as always-ask)." Outcome of the 2026-07-02 conservative
-- backfill workflow (scheduler-app/scripts/eval/required-facts-backfill.json
-- — per-category proposals, adversarially challenged, intersection-on-
-- conflict for double-mapped questions):
--
--   - 6 questions get a defensible 1-slot assignment (below).
--   - 319 distinct questions are RATIFIED ALWAYS-ASK: their answer options
--     don't map cleanly onto the 29 extraction slots, and a wrong
--     assignment silently SKIPS a question a customer should be asked
--     (the expensive error). Leaving '{}' is the sanctioned outcome, not
--     a gap — the mapper treats empty as "must ask".
--
-- Each UPDATE is guarded on required_facts = '{}' so a row an advisor has
-- since edited via /schedulerconfig is never clobbered. Rationales are in
-- the committed mapping file.

update public.concern_questions set required_facts = '{warning_light_named}'
 where id = 124 and required_facts = '{}';

update public.concern_questions set required_facts = '{pull_direction}'
 where id = 190 and required_facts = '{}';

update public.concern_questions set required_facts = '{fluid_color}'
 where id = 241 and required_facts = '{}';

update public.concern_questions set required_facts = '{fluid_under_car_location}'
 where id = 304 and required_facts = '{}';

update public.concern_questions set required_facts = '{smoke_color}'
 where id = 320 and required_facts = '{}';

update public.concern_questions set required_facts = '{fluid_color}'
 where id = 644 and required_facts = '{}';
