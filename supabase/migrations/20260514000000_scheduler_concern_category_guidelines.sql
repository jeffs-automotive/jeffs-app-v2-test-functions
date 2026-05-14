-- =====================================================================
-- Scheduler — concern_category_guidelines (Phase 9a, 2026-05-14)
-- =====================================================================
-- Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign:
--
-- The diagnostic LLM's job has been narrowed from "recommend testing
-- services + classify category + pick questions" to ONLY "gap-detection on
-- the per-service description" (the customer EXPLICITLY picked the diagnostic
-- service at Step 7.1, so no recommendation needed). To make the gap
-- detection reliable and consistent, the LLM now receives a short per-
-- category prose guideline alongside the questionnaire — describing what
-- pieces of information matter for that kind of concern, written in
-- laymen-terms voice Jeff would use.
--
-- One row per (shop_id, category). Seeded with the 14 concern_questions
-- categories. Service advisors revise the prose via MD-upload (Phase 9c
-- adds the tool surface).
--
-- RLS: deny_all to all PostgREST clients. The diagnostic Server Action
-- uses the service-role admin client (createSupabaseAdminClient), same
-- pattern as concern_questions + scheduler_audit_log.

BEGIN;

CREATE TABLE IF NOT EXISTS public.concern_category_guidelines (
  shop_id                     INTEGER     NOT NULL,
  category                    TEXT        NOT NULL CHECK (category IN (
                                            'noise',
                                            'vibration',
                                            'pulling',
                                            'smell',
                                            'smoke',
                                            'leak',
                                            'warning_light',
                                            'performance',
                                            'electrical',
                                            'hvac',
                                            'brakes',
                                            'steering',
                                            'tires',
                                            'other'
                                          )),
  display_label               TEXT        NOT NULL,
  guideline_prose             TEXT        NOT NULL,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by_oauth_client_id  TEXT,
  updated_by_name             TEXT,
  PRIMARY KEY (shop_id, category)
);

ALTER TABLE public.concern_category_guidelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deny_all" ON public.concern_category_guidelines
  FOR ALL TO public USING (false);

COMMENT ON TABLE public.concern_category_guidelines IS
  'Per-category prose guideline shown to the diagnostic Q&A LLM alongside the concern_questions catalog. Phase 9a (2026-05-14): the LLM does gap-detection only — given guideline + questionnaire + description, returns IDs of unanswered questions. Service advisors edit the prose via the upload_concern_category_guidelines_md MCP tool. Voice: laymen terms; what matters for THIS kind of concern.';
COMMENT ON COLUMN public.concern_category_guidelines.display_label IS
  'Human-readable label for the category (e.g. "Warning light"). Used in chat-bubble copy and admin tools.';
COMMENT ON COLUMN public.concern_category_guidelines.guideline_prose IS
  'Short prose paragraph (recommended 100-200 words) describing what pieces of information matter for diagnosing this kind of concern. Read by the diagnostic LLM before evaluating a customer''s description for gaps. NOT shown to the customer.';

-- ---------------------------------------------------------------------
-- Seed: 14 starter guidelines for shop_id=7476 (Jeff's Automotive). Each
-- row describes the WHAT-TO-LISTEN-FOR axis for that category in plain
-- language — the LLM uses it to judge whether a customer's description
-- has covered the salient ground or still has gaps.
-- ---------------------------------------------------------------------

INSERT INTO public.concern_category_guidelines
  (shop_id, category, display_label, guideline_prose)
VALUES
  (7476, 'noise', 'Noise',
   'When a customer describes an unusual noise from their vehicle, the key information we need is: WHERE the noise is coming from (front, rear, a specific corner; inside the cabin or outside the car), WHEN it happens (only when braking, only on bumps, only at certain speed, idling, always), the CHARACTER of the noise (squeak, grind, clunk, rattle, whine, click, hum), and HOW RECENT any vehicle changes are (after new tires, after a pothole, after winter storage, no recent changes). Don''t worry about the exact mechanical cause — that''s our job. Focus on what the customer hears and what was happening at the time.'),
  (7476, 'vibration', 'Vibration',
   'Vibrations narrow down quickly with three pieces: WHERE the customer feels it (steering wheel, seat, pedals, the whole car), WHEN it shows up (only above a certain speed, only when braking, idling, accelerating, all the time), and any recent IMPACT or work (curb hit, pothole, alignment, new tires). Tire balance, warped rotors, and suspension wear are common drivers but we don''t need the customer to guess — just describe what they feel and when.'),
  (7476, 'pulling', 'Pulling',
   'When a car pulls to one side, we want to know: WHICH DIRECTION it pulls (left, right, or both ways at different times), UNDER WHAT CONDITION (braking, accelerating, cruising, all the time), HOW LONG it''s been happening, and any RECENT WORK (tire rotation, alignment, suspension service, curb or pothole impact). Customers don''t need to know whether it''s alignment or brakes — just describe the behavior.'),
  (7476, 'smell', 'Smell',
   'Different smells point to different problems — the customer only needs to describe what their nose tells them. We want: WHAT THE SMELL IS LIKE (sweet, burnt, fuel/gas, rotten, electrical or plastic), WHERE they smell it (inside the cabin, only outside the car, only after parking), and WHEN they smell it (idling, after driving, only when AC is on, cold start). Map to what they recognize, not chemistry.'),
  (7476, 'smoke', 'Smoke',
   'Smoke color and source narrow it down fast: WHAT COLOR (white, blue, black, gray), WHERE it comes from (tailpipe, under the hood, inside the cabin, from a wheel), WHEN it happens (cold start, accelerating, after driving warm, always), and any SMELL or WARNING LIGHTS with it. Customers may not know coolant smoke from oil smoke — let them describe what they see in their own words.'),
  (7476, 'leak', 'Leak',
   'Leaks are mostly about the fluid: WHAT COLOR or texture (red, green, brown, black, clear, oily, watery), WHERE on the ground they see it (under the engine, under the rear, in the middle), HOW BIG the puddle is (slow drips vs running stream), and WHEN they first noticed it (today, this week, only when parked overnight, only after driving). AC condensation under the dash on a hot day is normal — most everything else is worth a look.'),
  (7476, 'warning_light', 'Warning light',
   'For warning lights we need: WHICH LIGHT (check engine, ABS, airbag, oil pressure, temperature, battery, TPMS — customers can usually identify by color or shape), BEHAVIOR (steady on, flashing, comes and goes), HOW THE CAR IS DRIVING (normally, sluggish, hesitating, stalling), and any OTHER SYMPTOMS (smell, sound, vibration, smoke). A flashing check engine light is more urgent than a steady one.'),
  (7476, 'performance', 'Performance',
   'When a car isn''t performing right, we want: WHAT IT''S DOING (hesitating, stalling, low power, surging, hard to start, won''t start), UNDER WHAT CONDITIONS (uphill, accelerating from a stop, cruising, in a specific gear, cold vs warm), HOW LONG it''s been happening, and any WARNING LIGHTS on. Bonus context: any recent fuel station, jump-start, or aftermarket parts.'),
  (7476, 'electrical', 'Electrical',
   'Electrical issues are about WHAT''S MISBEHAVING (won''t crank, slow crank, dim lights, won''t stay started, intermittent stalls, dashboard flickers, accessories dying), BATTERY AGE if they know it, RECENT JUMP-STARTS (frequency matters — once vs every morning), and OTHER WEIRDNESS happening at the same time. Battery, alternator, starter, parasitic drains, and bad grounds all live here.'),
  (7476, 'hvac', 'HVAC',
   'For heating/AC issues we want: HOT or COLD (or both not working), WHICH VENTS (all vents, just dash, just floor, just defrost), WHEN it started (today, this week, gradually over time), and any OTHER CABIN WEIRDNESS (foggy windows, noise from vents, wet floor, unusual smell). Refrigerant low, blend door, blower motor, cabin filter — all surface from these clues.'),
  (7476, 'brakes', 'Brakes',
   'Brakes are about FEEL plus SOUND plus DISTANCE. We want: WHAT THE CUSTOMER NOTICES (squealing, grinding, pedal goes soft, pedal feels hard, pedal pulses, takes longer to stop, pulls one way when braking), WHEN it shows up (hard stops, light stops, only when cold, only when hot), and any WARNING LIGHT on. Last brake service date helps if they remember it.'),
  (7476, 'steering', 'Steering',
   'Steering complaints map to: WHAT THE WHEEL DOES (hard to turn, loose or sloppy, vibrates, makes noise on turns, pulls/drifts), ONE DIRECTION OR BOTH, HOW LONG it''s been happening, and any RECENT WORK (alignment, suspension, curb hit). Power-steering fluid leaks, worn tie rods, bad bushings, and alignment all surface here.'),
  (7476, 'tires', 'Tires',
   'For tire concerns: WHICH WHEEL the customer thinks is affected (or all), VISIBLE DAMAGE (nail in tread, sidewall bulge, cuts, separating tread, low pressure light only), RECENT TIRE WORK (rotation, patch, new set), and any RELATED SYMPTOMS (vibration, pulling, noise). Customer doesn''t need to know plies and load ratings — just what they see and feel.'),
  (7476, 'other', 'Other',
   'When a customer''s concern doesn''t fit a clear category, dig for SPECIFIC SYMPTOMS (any smell, sound, vibration, warning light, fluid leak — anything they''ve noticed even peripherally), RECENT WORK or unusual events (oil change, body shop, hit something, tow), and DRIVING SAFETY (does the car feel safe to drive in, or are they worried). Goal is to narrow into one of the other categories or escalate to a tech for diagnosis.')

ON CONFLICT (shop_id, category) DO NOTHING;

COMMIT;
