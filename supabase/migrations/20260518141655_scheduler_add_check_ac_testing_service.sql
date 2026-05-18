-- =====================================================================
-- Scheduler — Add A/C performance check to testing_services catalog
-- Date: 2026-05-18
-- =====================================================================
-- Background:
--
-- The 2026-05-18 diagnose-concern LLM eval surfaced a routing gap: A/C
-- concerns ("AC blows warm while idling", "AC blows cold then warm",
-- "AC not blowing cold and plastic smell") had no matching
-- testing_services entry. The LLM either failed to classify them
-- (Zod schema parse failures) or routed them to coolant_leak_testing
-- (a close-but-imperfect fit; A/C is HVAC-category, coolant is leak/
-- smoke/smell/performance).
--
-- routine_services already has `check_ac` (concern_categories=['hvac'],
-- requires_explanation=TRUE, $89.95 with the "waived if repair/more
-- testing is needed and approved" note). Adding the matching testing
-- service so the LLM can recommend it with the same pricing + note
-- when the customer's concern resolves to A/C.
--
-- This follows the established intentional cross-table collision
-- pattern documented at R6-C-2 in get-current-card.ts: brake_inspection
-- lives in BOTH routine_services and testing_services with the same
-- service_key. The customer-facing picker shows the routine chip; the
-- diagnostic LLM recommends the testing variant. The routine row wins
-- in lookup-order conflicts.
--
-- Per docs/scheduler/testing-services.md format: service_key,
-- display_name, abbreviation, starting_price_cents, notes (advisor),
-- description (customer-facing on the approval card), concern_categories,
-- active.
--
-- Idempotent: ON CONFLICT DO UPDATE keyed on the natural unique index
-- (shop_id, service_key).

BEGIN;

INSERT INTO public.testing_services (
  shop_id,
  service_key,
  display_name,
  abbreviation,
  starting_price_cents,
  notes,
  description,
  concern_categories,
  active
) VALUES (
  7476,
  'check_ac',
  'A/C performance check',
  'AC CHECK',
  8995,
  'Waived if a repair or more testing is needed and approved',
  'Our technician will run the A/C system through a performance check — pressure on both the high and low sides, condenser airflow, blend-door operation, refrigerant level, and compressor cycling. We''ll identify whether it''s low refrigerant, a compressor or clutch issue, a blend-door failure, or a condenser problem, and quote any needed work. Fee waived if you approve any recommended repair or further testing.',
  ARRAY['hvac']::TEXT[],
  TRUE
)
ON CONFLICT (shop_id, service_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  abbreviation = EXCLUDED.abbreviation,
  starting_price_cents = EXCLUDED.starting_price_cents,
  notes = EXCLUDED.notes,
  description = EXCLUDED.description,
  concern_categories = EXCLUDED.concern_categories,
  active = EXCLUDED.active,
  updated_at = now();

COMMIT;

-- ---------------------------------------------------------------------
-- Post-migration step (Chris): regenerate the typed schema
-- ---------------------------------------------------------------------
-- This migration doesn't change the table SHAPE (no new columns), so a
-- regen of scheduler-app/src/lib/database.types.ts isn't strictly
-- required. The new row will be returned by the same typed select shape
-- as the existing 14 testing services.
--
-- Verify in Supabase SQL Editor:
--   SELECT service_key, display_name, starting_price_cents, concern_categories
--     FROM public.testing_services
--     WHERE shop_id = 7476 AND service_key = 'check_ac';
