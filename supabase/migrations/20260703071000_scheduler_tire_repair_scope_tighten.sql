-- tire_repair scope tightening (AO1 follow-up, 2026-07-03)
--
-- The tires concern_categories fallback also makes dry_rot_sidewall_cracking and
-- just_want_new_tires eligible under tire_repair. Those are tire-SALES situations,
-- not puncture repairs — steer Stage 1 away via the description boundary callout
-- (the explicit-eligibility mechanism has no "advisor" target; the description is
-- the Stage-1 routing signal).

BEGIN;

UPDATE public.testing_services
SET description = description || ' NOT for worn-out, dry-rotted, or end-of-life tires or requests to buy/replace tires (no catalog fit — a service advisor will quote new tires).',
    updated_at = now()
WHERE shop_id = 7476
  AND service_key = 'tire_repair'
  AND description NOT LIKE '%quote new tires%';

COMMIT;
