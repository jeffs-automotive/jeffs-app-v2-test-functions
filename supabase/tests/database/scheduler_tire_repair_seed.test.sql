-- pgTAP: tire_repair catalog seed (migration 20260703070000)
BEGIN;
SELECT plan(6);

SELECT is(
  (SELECT count(*)::int FROM public.testing_services
   WHERE shop_id = 7476 AND service_key = 'tire_repair' AND active),
  1, 'tire_repair service exists and is active');

SELECT is(
  (SELECT starting_price_cents FROM public.testing_services
   WHERE shop_id = 7476 AND service_key = 'tire_repair')::int,
  4768, 'price anchors the PATCH/PLUG canned job ($47.68)');

SELECT ok(
  (SELECT description LIKE '%Scope:%' FROM public.testing_services
   WHERE shop_id = 7476 AND service_key = 'tire_repair'),
  'description carries a Scope boundary callout');

SELECT ok(
  (SELECT eligible_testing_service_keys @> ARRAY['tire_repair']
   FROM public.concern_subcategories
   WHERE shop_id = 7476 AND slug = 'visible_damage_nail_screw_bulge_cut'),
  'nail/screw subcategory routes to tire_repair');

SELECT ok(
  (SELECT eligible_testing_service_keys @> ARRAY['tire_repair']
   FROM public.concern_subcategories
   WHERE shop_id = 7476 AND slug = 'tire_going_flat_losing_air'),
  'losing-air subcategory routes to tire_repair');

SELECT is(
  (SELECT count(*)::int FROM public.testing_services
   WHERE shop_id = 7476
     AND service_key IN ('tpms_testing', 'suspension_steering_check')
     AND description LIKE '%route to tire_repair%'),
  2, 'tpms + suspension descriptions carry the tire_repair boundary callout');

SELECT * FROM finish();
ROLLBACK;
