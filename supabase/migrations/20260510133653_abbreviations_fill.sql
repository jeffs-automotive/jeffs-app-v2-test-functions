-- =====================================================================
-- Fill in service abbreviations per Chris 2026-05-10
-- =====================================================================
-- Replaces the 'TBD' placeholders left by 20260510131752_scheduler_phase1_schema.sql
-- with the shop's abbreviations.
--
-- Pattern locked: short noun + action word, all caps. Example:
--   "Brake Inspection"           → "BRAKE INSPECT"
--   "ABS light testing"          → "ABS TESTING"
--   "Transmission issues testing" → "TRANS TESTING"
--
-- Action words: TESTING (diagnostics), INSPECT (inspections), CHECK
-- (routine checks), TEST (electrical-style tests).
-- =====================================================================


-- ---------------------------------------------------------------------
-- routine_services — 8 remaining abbreviations (SI IM + LOF were
-- seeded in the prior migration)
-- ---------------------------------------------------------------------

UPDATE public.routine_services SET abbreviation = 'ROT'
  WHERE shop_id = 7476 AND service_key = 'tire_rotation';

UPDATE public.routine_services SET abbreviation = 'ROT BAL'
  WHERE shop_id = 7476 AND service_key = 'rotate_balance_tires';

UPDATE public.routine_services SET abbreviation = 'ALIGN'
  WHERE shop_id = 7476 AND service_key = 'alignment';

UPDATE public.routine_services SET abbreviation = 'BRAKE INSPECT'
  WHERE shop_id = 7476 AND service_key = 'brake_inspection';

UPDATE public.routine_services SET abbreviation = 'BATT CHECK'
  WHERE shop_id = 7476 AND service_key = 'check_battery';

UPDATE public.routine_services SET abbreviation = 'WARN LIGHT'
  WHERE shop_id = 7476 AND service_key = 'warning_lights';

UPDATE public.routine_services SET abbreviation = 'SUSP CHECK'
  WHERE shop_id = 7476 AND service_key = 'check_suspension';

UPDATE public.routine_services SET abbreviation = 'AC CHECK'
  WHERE shop_id = 7476 AND service_key = 'check_ac';


-- ---------------------------------------------------------------------
-- testing_services — 13 remaining abbreviations (CEL TESTING was
-- seeded in the prior migration; normalize that one to all-caps for
-- consistency with the rest)
-- ---------------------------------------------------------------------

UPDATE public.testing_services SET abbreviation = 'CEL TESTING'
  WHERE shop_id = 7476 AND service_key = 'warning_light_general';

UPDATE public.testing_services SET abbreviation = 'TPMS TESTING'
  WHERE shop_id = 7476 AND service_key = 'tpms_testing';

UPDATE public.testing_services SET abbreviation = 'SUSP CHECK'
  WHERE shop_id = 7476 AND service_key = 'suspension_check';

UPDATE public.testing_services SET abbreviation = 'BRAKE INSPECT'
  WHERE shop_id = 7476 AND service_key = 'brake_inspection';

UPDATE public.testing_services SET abbreviation = 'BATT TEST'
  WHERE shop_id = 7476 AND service_key = 'battery_test';

UPDATE public.testing_services SET abbreviation = 'ALT TESTING'
  WHERE shop_id = 7476 AND service_key = 'alternator_testing';

UPDATE public.testing_services SET abbreviation = 'ELEC TESTING'
  WHERE shop_id = 7476 AND service_key = 'electrical_testing_general';

UPDATE public.testing_services SET abbreviation = 'OIL LEAK TEST'
  WHERE shop_id = 7476 AND service_key = 'oil_leak_testing';

UPDATE public.testing_services SET abbreviation = 'COOL LEAK TEST'
  WHERE shop_id = 7476 AND service_key = 'coolant_leak_testing';

UPDATE public.testing_services SET abbreviation = 'EURO COOL LEAK TEST'
  WHERE shop_id = 7476 AND service_key = 'coolant_leak_testing_euro';

UPDATE public.testing_services SET abbreviation = 'NO START TEST'
  WHERE shop_id = 7476 AND service_key = 'no_start_testing';

UPDATE public.testing_services SET abbreviation = 'TRANS TESTING'
  WHERE shop_id = 7476 AND service_key = 'transmission_testing';

UPDATE public.testing_services SET abbreviation = 'WIN INOP TEST'
  WHERE shop_id = 7476 AND service_key = 'window_inop_testing';

UPDATE public.testing_services SET abbreviation = 'WSHIELD INOP TEST'
  WHERE shop_id = 7476 AND service_key = 'windshield_inop_testing';


-- ---------------------------------------------------------------------
-- Verify no TBDs remain (defensive — fail fast if a service_key was
-- mis-spelled above)
-- ---------------------------------------------------------------------

DO $$
DECLARE
  v_tbd_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_tbd_count
    FROM public.routine_services
    WHERE shop_id = 7476 AND abbreviation = 'TBD';
  IF v_tbd_count > 0 THEN
    RAISE EXCEPTION 'routine_services still has % TBD rows after this migration', v_tbd_count;
  END IF;

  SELECT COUNT(*) INTO v_tbd_count
    FROM public.testing_services
    WHERE shop_id = 7476 AND abbreviation = 'TBD';
  IF v_tbd_count > 0 THEN
    RAISE EXCEPTION 'testing_services still has % TBD rows after this migration', v_tbd_count;
  END IF;
END;
$$;
