-- Tire repair testing service (act-or-ask-stage1 AO1, 2026-07-03)
--
-- Closes the catalog gap found by the real-concern eval
-- (docs/scheduler/act-or-ask-real-data-eval-2026-07-03.md §4.1): physical tire
-- problems (nail/screw, losing air, flat) had NO bookable catalog entry — the
-- tires subcategories existed but mapped only to tpms_testing via the
-- concern_categories fallback, so "nail in my tire" recommended a TPMS sensor
-- test. Chris (2026-07-03): recommend the PATCH/PLUG job; advisors swap the
-- job on the RO if a different tire repair is needed.
--
-- Template: 20260521171000_scheduler_exhaust_service_and_boundary_callouts.sql.
-- Price anchors Tekmetric canned job 417342052 "TIRE REPAIR WITH PATCH/PLUG"
-- ($47.68 total: 0.25h @ $159.96 + fee).

BEGIN;

INSERT INTO public.testing_services
  (shop_id, service_key, display_name, abbreviation, starting_price_cents,
   notes, concern_categories, active, description)
VALUES
  (7476,
   'tire_repair',
   'Tire repair (patch & plug)',
   'TIRE RPR',
   4768,
   'Tire repair with patch/plug is $47.68 (Tekmetric canned job TIRE REPAIR WITH PATCH/PLUG). If the tire is unrepairable or needs a different tire service (valve stem, bead-area leak, fix-a-flat cleanup), swap the job on the RO.',
   ARRAY['tires']::TEXT[],
   TRUE,
   'The technician will remove the wheel and inspect the tire to locate the puncture and confirm it is in a repairable area of the tread. The tire is dismounted from the rim, the damaged area is prepared, and a patch/plug combination is installed from the inside to properly seal the puncture and restore tire integrity. The tire is then remounted, balanced, and reinstalled, and the repair is verified. Scope: physical tire damage — a nail or screw in the tire, a puncture, or a tire that keeps losing air. NOT for a tire-pressure warning light with no visible damage or leak (route to tpms_testing); NOT for vibration, pulling, or steering concerns (route to suspension_steering_check).')
ON CONFLICT (shop_id, service_key) DO NOTHING;

-- Wire the EXISTING tires subcategories to the new service (explicit map wins
-- over the concern_categories fallback). Pattern:
-- 20260521170500_scheduler_exhaust_route_additions.sql.
UPDATE public.concern_subcategories
SET eligible_testing_service_keys = eligible_testing_service_keys || ARRAY['tire_repair'],
    updated_at = now()
WHERE shop_id = 7476
  AND slug IN ('visible_damage_nail_screw_bulge_cut', 'tire_going_flat_losing_air')
  AND NOT (eligible_testing_service_keys @> ARRAY['tire_repair']);

-- Boundary callouts on the two services the eval saw absorbing tire concerns.
UPDATE public.testing_services
SET description = description || ' NOT for physical tire damage — a nail or screw in the tire, a puncture, or a tire losing air (route to tire_repair).',
    updated_at = now()
WHERE shop_id = 7476
  AND service_key IN ('tpms_testing', 'suspension_steering_check')
  AND description NOT LIKE '%route to tire_repair%';

COMMIT;
