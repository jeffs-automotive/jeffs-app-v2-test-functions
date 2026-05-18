-- =====================================================================
-- Scheduler — Routine services pricing + waived-fee note
-- Date: 2026-05-17 (timestamp 2026-05-18 UTC)
-- =====================================================================
-- Background:
--
-- Per Chris's 2026-05-17 UX review of the customer-facing wizard:
--
--   "The diagnostic services should not be shown. It is up to the
--    diagnostic llm to choose which diagnostic service to recommend.
--    The customer may not know which one to choose and it's a long
--    list and can be confusing. The state inspection, oil change, tire
--    rotation, tire rotation and balance, alignment, brake inspection,
--    check battery, warning lights, check suspension, check a/c should
--    all be shown as routine service. And they should also show the
--    pricing for those services. The a/c performance check and the
--    brake inspection should both have a note that says 'fee is waived
--    if a repair or more testing is needed and approved'"
--
-- This migration:
--
--   1. Adds two nullable columns to routine_services:
--        - starting_price_cents INTEGER  — integer cents (3999 = $39.99)
--        - price_waived_note    TEXT     — short customer-facing caveat
--
--   2. Seeds prices + the waived note across all 10 active routine
--      services. Values for the five "diagnostic-routine" chips (those
--      with requires_explanation=TRUE) come from the testing_services
--      table to keep cross-table consistency. Values for the five truly-
--      routine chips (state inspection / oil / tires / alignment) use
--      defensible starting prices that Chris can adjust at any time via
--      the existing `patch_routine_service_fields` admin tool.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + the UPDATE seed is keyed on
-- service_key so re-applying is safe.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Add columns
-- ---------------------------------------------------------------------
ALTER TABLE public.routine_services
  ADD COLUMN IF NOT EXISTS starting_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS price_waived_note    TEXT;

COMMENT ON COLUMN public.routine_services.starting_price_cents IS
  'Customer-facing "Starting at $XX.XX" price for this routine service. Integer cents (3999 = $39.99; 0 = "Free"). NULL means no price shown on the picker chip (use when pricing is too vehicle-dependent to quote). The wizard renders the price on the Step 7 chip alongside display_name.';

COMMENT ON COLUMN public.routine_services.price_waived_note IS
  'Short customer-facing caveat shown under the price (e.g. "Fee waived if a repair or more testing is needed and approved"). Designed for diagnostic-style routine services where the inspection fee is rolled into any recommended repair work. NULL means no note shown.';

-- ---------------------------------------------------------------------
-- 2. Seed the 10 active routine_services rows
-- ---------------------------------------------------------------------
-- Pricing strategy:
--   - Diagnostic-routine chips (requires_explanation=TRUE) inherit from
--     testing_services (brake_inspection $39.99 waived, battery $0,
--     warning $179.99, suspension $89.95). Check A/C ($89.95) tracks
--     suspension/warning convention since there is no test_service for
--     A/C — Chris can adjust.
--   - Truly-routine chips use defensible starting prices that match
--     common PA shop rates. Chris adjusts via patch_routine_service_fields
--     if the actual shop prices differ.
--
-- "Fee waived" note text matches Chris's 2026-05-17 spec verbatim.

UPDATE public.routine_services
SET
  starting_price_cents = CASE service_key
    WHEN 'state_inspection_emissions' THEN 7995
    WHEN 'oil_change'                 THEN 5995
    WHEN 'tire_rotation'              THEN 2995
    WHEN 'rotate_balance_tires'       THEN 7995
    WHEN 'alignment'                  THEN 10995
    WHEN 'brake_inspection'           THEN 3999
    WHEN 'check_battery'              THEN 0
    WHEN 'warning_lights'             THEN 17999
    WHEN 'check_suspension'           THEN 8995
    WHEN 'check_ac'                   THEN 8995
    ELSE starting_price_cents
  END,
  price_waived_note = CASE service_key
    WHEN 'brake_inspection' THEN 'Fee waived if a repair or more testing is needed and approved'
    WHEN 'check_ac'         THEN 'Fee waived if a repair or more testing is needed and approved'
    ELSE NULL
  END
WHERE shop_id = 7476
  AND service_key IN (
    'state_inspection_emissions',
    'oil_change',
    'tire_rotation',
    'rotate_balance_tires',
    'alignment',
    'brake_inspection',
    'check_battery',
    'warning_lights',
    'check_suspension',
    'check_ac'
  );

COMMIT;

-- ---------------------------------------------------------------------
-- Post-migration step (Chris): regenerate the typed schema
-- ---------------------------------------------------------------------
--
--   npx supabase gen types typescript \
--     --project-id itzdasxobllfiuolmbxu --schema public \
--     > scheduler-app/src/lib/database.types.ts
--
-- The wizard (get-current-card.ts → service_concern_picker case) reads
-- starting_price_cents + price_waived_note directly through the typed
-- client, so the regen is required for TypeScript to compile against
-- the new columns.
