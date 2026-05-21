# Subcategory Descriptions — tires

<!--
Stage-1 classifier metadata for the 7 `tires` subcategories.

Cross-category routing notes carried from the briefing:

1. `tires/low_pressure_warning_light_only` vs `warning_light/tpms_tire_pressure_light` —
   the two subcategories cover overlapping ground. Coordination rule documented
   inline in each description: when the customer LEADS with warning-light
   language ("TPMS light came on", "tire pressure light is on", "yellow horseshoe
   symbol"), `warning_light/tpms_tire_pressure_light` is canonical. When the
   customer LEADS with tire-pressure language ("my tires are low", "low tire
   pressure warning") AND tire-system context dominates the framing, this
   tires subcategory is the better fit. Both should exist for graceful fallback.

2. `tires/visible_damage_*` vs `tires/tire_going_flat_losing_air` — choice is
   crisp: customer names a VISIBLE OBJECT or VISIBLE DEFORMATION (nail, screw,
   bulge, cut, gash, slash) → visible_damage. Customer names only the AIR LOSS
   without naming a visible cause → going_flat. If both are named, visible
   damage wins (the damage is the more actionable framing for the advisor).

3. `tires/recent_tire_work_then_new_symptom` vs `pulling/pull_that_started_after_recent_tire_or_service_work`
   vs `other/after_recent_service_or_repair_work` — if the new symptom is
   specifically a PULL or DRIFT, route to pulling/. If the prior work was
   non-tire (oil change, brake, engine, transmission) OR the customer can't
   pinpoint a concrete symptom, route to other/. This tires subcategory is
   correct when the work was specifically TIRE work (mount, balance, rotate,
   patch, plug, new tires) AND the new symptom is non-pulling (vibration,
   noise, TPMS light, re-leak).

4. `tires/just_want_new_tires` is a NON-DIAGNOSTIC SALES REQUEST. The customer
   is shopping for tires. NEVER route diagnostic concerns here. NEVER route
   here for "tires are worn out and I think I need new ones" if the customer
   leads with a wear-pattern symptom — that's uneven_tire_wear. ONLY route
   here when buying language clearly dominates ("I want a quote for 4 tires",
   "I need to buy tires").

5. `tires/uneven_tire_wear_bald_spots` is about VISIBLE TREAD WEAR PATTERNS
   the customer (or their last shop) noticed. Distinct from any downstream
   symptom (vibration, pull, noise) — if the customer leads with the downstream
   symptom and only mentions wear as supporting evidence, route to the
   downstream category. Route here when the wear pattern itself is the
   framing concern.

Source URLs consulted during drafting:
  - https://www.lesschwab.com/article/tires/tire-dry-rot-causes-signs-prevention.html
  - https://oldoxtire.com/auto-repair-blog/cracks-in-your-tires-heres-what-tire-dry-rot-really-means/
  - https://www.tireagent.com/blog/what-causes-dry-rotting-tires-are-tires-with-dry-rot-safe
  - https://www.goodyear.com/en-us/learn/tire-cupping
  - https://www.tomorrowstechnician.com/tire-tread-wear-causes-and-symptoms/
  - https://www.prioritytire.com/blog/tire-wear-patterns-all-you-need-to-know
  - https://wheelsasap.com/tire-wear-patterns/
  - https://www.mevotech.com/article/what-is-my-tire-wear-telling-me/
  - https://cartreatments.com/outside-tire-wear/
  - https://brausenauto.com/reasons-why-your-tpms-light-is-on-even-after-filling-tires/
  - https://www.schradertpms.com/en/driver-education/what-do-when-your-low-tire-pressure-light-wont-turn
  - https://www.greasepro.com/why-is-my-tpms-sensor-light-on/
  - https://www.kingstoyota.com/how-to-reset-tire-pressure-light-cincinnati-oh.htm
  - https://www.tirerack.com/specialoffers/specialoffers.jsp
  - https://www.discounttire.com/customer-service/tire-rack-always-full
  - https://trillitires.com/why-your-car-pulls-after-installing-new-tires/
  - https://atlanticmotorcar.com/casestudies/radial-tire-pull-or-is-my-tire-really-cone-shaped/
-->

## tires/visible_damage_nail_screw_bulge_cut
Description: Customer has visually identified physical damage to a tire — a nail or screw sticking out, a bubble or bulge on the sidewall, a cut, gash, or slash in the rubber, or another object embedded in the tread. The damage itself is the framing concern, regardless of whether the tire is currently holding air. Pick this whenever the customer names a SPECIFIC visible object or visible deformation, even if they also mention air loss. Distinct from tires/tire_going_flat_losing_air (which is air loss with NO visible cause named) and from tires/dry_rot_sidewall_cracking (where the "damage" is age-related rubber cracking and weather checking, not impact or puncture damage).
Positive examples:
  - "There's a nail sticking out of my tire"
  - "Got a screw in my tire and the head is showing"
  - "I see a bubble on the sidewall of my front tire"
  - "Hit a curb and now there's a bulge in the side of the tire"
  - "Big gash in my tire — looks like I ran over something sharp"
Negative examples:
  - "Tire keeps going flat but I don't see anything in it" → tire_going_flat_losing_air
  - "Tire pressure light keeps coming on" → low_pressure_warning_light_only
  - "Lots of little cracks on the sidewall of my tires" → dry_rot_sidewall_cracking
  - "Tires are wearing on the inside edge" → uneven_tire_wear_bald_spots
  - "Hit a pothole hard and now the car shakes" → vibration/steering_wheel_shake_at_highway_speed
Synonyms: nail in tire, screw in tire, sidewall bulge, tire bubble, sidewall bubble, tire blister, gash in tire, cut in tire, slash in tire, tire damage, puncture, object stuck in tire, hole in tire, sidewall damage, curb damage, pothole damage

## tires/tire_going_flat_losing_air
Description: A tire is losing air over time — going flat suddenly, slowly leaking down between fill-ups, or repeatedly needing to be topped off — with NO visible damage named by the customer. The customer's framing is the AIR LOSS itself, not a visible object or defect. Common causes include slow valve stem leaks, bead leaks where tire meets wheel, small punctures the customer hasn't spotted, or a damaged TPMS sensor. Distinct from tires/visible_damage_nail_screw_bulge_cut (where the customer names a specific nail, screw, bulge, cut, or gash — visible damage always wins) and from tires/low_pressure_warning_light_only (where the customer's ONLY concern is the dashboard warning light and they haven't confirmed any tire is actually low). Pick this when air-loss language dominates and no visible cause is named.
Positive examples:
  - "My tire keeps going flat"
  - "I have to put air in my front tire every week"
  - "Tire was flat this morning — looked fine yesterday"
  - "One of my tires is slowly losing air"
  - "Pulled into the driveway and heard hissing, now the tire is soft"
Negative examples:
  - "There's a nail in my tire" → visible_damage_nail_screw_bulge_cut
  - "Bubble on the sidewall" → visible_damage_nail_screw_bulge_cut
  - "Just the TPMS light is on, tires look fine" → low_pressure_warning_light_only
  - "Sidewall is all cracked from sitting" → dry_rot_sidewall_cracking
  - "Tire pressure light came on after the cold snap" → warning_light/tpms_tire_pressure_light
Synonyms: losing air, going flat, won't hold air, slow leak, tire leak, flat tire, low tire, soft tire, deflating tire, leaks down, needs air, keeps going low, tire keeps losing pressure, slow flat

## tires/low_pressure_warning_light_only
Description: The customer's ONLY framing is that a low-tire-pressure warning has appeared on the dashboard — they may or may not have confirmed any tire is actually low, and they have not named visible damage or active air loss. Common causes include cold-weather pressure drop, a tire that needs topping off, a TPMS sensor that needs to relearn after a fill-up or tire service, or a failing TPMS sensor battery. NOTE on routing: this subcategory has a parallel sibling at `warning_light/tpms_tire_pressure_light`. When the customer LEADS with warning-light language ("TPMS light came on", "yellow horseshoe symbol on my dash") the warning_light sibling is canonical and preferred. Route to THIS subcategory when the customer LEADS with tire-pressure language ("my tire pressure light is on", "low tire pressure warning") AND the framing stays tire-focused. Both exist for graceful fallback. Distinct from tires/tire_going_flat_losing_air (where the customer has confirmed a tire is actually losing air, beyond just the light) and from tires/recent_tire_work_then_new_symptom (when the light is one of multiple new symptoms following recent tire work — route there instead).
Positive examples:
  - "My low tire pressure light is on"
  - "Tire pressure warning came on this morning"
  - "Tire pressure light keeps coming on and off"
  - "I added air but the light won't go off"
  - "Low pressure warning light, tires look fine to me"
Negative examples:
  - "TPMS light came on" → warning_light/tpms_tire_pressure_light (warning-light framing)
  - "Tire keeps going flat" → tire_going_flat_losing_air
  - "Got a nail in my tire and the light is on" → visible_damage_nail_screw_bulge_cut
  - "Had new tires put on yesterday and now the light is on" → recent_tire_work_then_new_symptom
  - "Tire pressure light AND check engine light came on" → warning_light/multiple_warning_lights_at_once
Synonyms: TPMS light, tire pressure light, low pressure warning, low tire pressure light, yellow horseshoe light, tire warning, pressure warning, TPMS warning, low tire light, dashboard tire light

## tires/uneven_tire_wear_bald_spots
Description: Customer has noticed (or their last shop has flagged) that a tire's tread is wearing unevenly — wearing more on the inside edge, the outside edge, the center, or in patchy/scalloped/cupped patterns around the tire. The visible wear pattern itself is the framing concern, and the customer typically names where on the tire the wear shows up. Common causes include wheel alignment out of spec (toe, camber), chronic over- or under-inflation, missed rotations, or worn shocks/struts (which cause cupping or scalloping). Distinct from tires/dry_rot_sidewall_cracking (which is age-related rubber cracking on the sidewall, not tread wear pattern), from tires/just_want_new_tires (a buying request, NOT a diagnostic), and from any downstream symptom like vibration or pulling — when the customer leads with the symptom (shake, drift) and only mentions wear as evidence, route to the symptom subcategory instead.
Positive examples:
  - "My tires are wearing on the inside edge"
  - "Outside edges of the front tires are bald"
  - "Tread is worn in the middle but the edges still look good"
  - "Shop told me my tires are cupping"
  - "Bald spots on my tire — like patchy worn areas"
Negative examples:
  - "Sidewall has lots of small cracks" → dry_rot_sidewall_cracking
  - "I just want to buy new tires" → just_want_new_tires
  - "Steering wheel shakes at highway speed" → vibration/steering_wheel_shake_at_highway_speed
  - "Car pulls to the right on flat roads" → pulling/steady_drift_while_cruising
  - "Got a nail in the tire" → visible_damage_nail_screw_bulge_cut
Synonyms: uneven wear, bald spots, inside edge wear, outside edge wear, center wear, edge wear, scalloping, cupping, feathering, worn tread, bald tire, balding tires, choppy wear, patchy wear, tire wearing funny, wearing crooked, tire worn unevenly, scalloped tread

## tires/dry_rot_sidewall_cracking
Description: Customer sees small cracks, splits, or weather-checking lines on the rubber of one or more tires — typically on the sidewall (the curved side wall of the tire) but sometimes also in the tread grooves. The rubber may look chalky, faded, or feel brittle. Most commonly caused by tire age (rubber breaks down after 5-10 years even with low mileage), prolonged sun exposure on a parked vehicle, dry-climate UV / ozone exposure, or a car that sits for long stretches without driving. Distinct from tires/visible_damage_nail_screw_bulge_cut (impact / puncture damage, not aging), from tires/uneven_tire_wear_bald_spots (tread WEAR pattern, not rubber CRACKING), and from other/car_has_been_sitting_unused_for_a_long_time (when the customer's framing is the long-term storage itself rather than this specific tire symptom — when they NAME the sidewall cracking, route here).
Positive examples:
  - "Sidewall of my tires has a bunch of small cracks"
  - "Tires are dry-rotted — cracks all along the side"
  - "Lots of little hairline cracks on the rubber"
  - "Rubber on my tires looks dry and brittle, with cracks"
  - "Car's been sitting and now the tires are all cracked"
Negative examples:
  - "Big gash in the sidewall from hitting something" → visible_damage_nail_screw_bulge_cut
  - "Bulge on the sidewall" → visible_damage_nail_screw_bulge_cut
  - "Inside edge of the tread is wearing fast" → uneven_tire_wear_bald_spots
  - "Tire keeps losing air slowly" → tire_going_flat_losing_air
  - "Car has been sitting for two years, I want a full check" → other/car_has_been_sitting_unused_for_a_long_time
Synonyms: dry rot, dry-rotted tires, sidewall cracking, sidewall cracks, weather checking, weather cracking, ozone cracking, rubber cracks, cracked sidewall, brittle rubber, chalky rubber, hairline cracks, surface cracks, aged tires, old tires, tire cracking

## tires/just_want_new_tires
Description: NON-DIAGNOSTIC SALES REQUEST — the customer is shopping to buy tires. They want a quote, a recommendation, or to schedule installation of new tires. There is no diagnostic complaint driving the visit; the framing is purchase, not problem. Customer language is buying-focused ("I need a set of 4", "what would 4 tires cost me", "looking to put new tires on"). The advisor's job is to gather tire-shopping context (current size, driving style, budget tier, road conditions) and prepare a tire quote — NOT to diagnose a symptom. Distinct from EVERY diagnostic subcategory in this category: if the customer names ANY tire symptom (low pressure, going flat, dry rot, uneven wear, visible damage, post-service issue), route to the matching diagnostic subcategory even if they ALSO mention possibly needing new tires. Only route here when buying-language clearly dominates and no diagnostic complaint is named.
Positive examples:
  - "I want a quote for 4 new tires"
  - "Looking to put new tires on my car"
  - "Need to buy a set of tires"
  - "How much would it cost to get 4 new tires installed?"
  - "Want to do tires — what do you guys recommend?"
Negative examples:
  - "Tires are wearing on the inside edge, probably need new ones" → uneven_tire_wear_bald_spots (diagnostic framing)
  - "Sidewalls are all cracked, I think I need new tires" → dry_rot_sidewall_cracking (diagnostic framing)
  - "Tire keeps going flat, might as well replace it" → tire_going_flat_losing_air (diagnostic framing)
  - "Got a nail and probably need a new tire" → visible_damage_nail_screw_bulge_cut (diagnostic framing)
  - "Want an alignment with my new tires" → just_want_new_tires (still the dominant request — advisor can add alignment to the quote)
Synonyms: new tires, want to buy tires, tire quote, tire shopping, set of 4, set of four, replace tires, install tires, buy tires, tire purchase, need tires, looking for tires, tire recommendation, tire installation quote, four new tires, get tires

## tires/recent_tire_work_then_new_symptom
Description: Customer had recent tire-related work done — new tires installed, a rotation, a balance, a patch or plug repair, a flat repair, or a TPMS sensor service — and a NEW symptom appeared right after. The new symptom is non-pulling: a vibration, a noise, a TPMS warning light that won't clear, or the tire going flat again. The recent tire work is the framing trigger. Distinct from pulling/pull_that_started_after_recent_tire_or_service_work (when the new symptom is specifically a PULL or DRIFT — always route there for pull-specific post-tire-work complaints), from other/after_recent_service_or_repair_work (when the recent work was NON-tire — oil change, brake job, engine, transmission), and from the tires/* diagnostic subcategories above (when the customer does NOT frame the symptom as starting after recent tire work — e.g., a long-standing slow leak with no recent service trigger goes to tire_going_flat_losing_air).
Positive examples:
  - "Got new tires last week and now the car vibrates at highway speed"
  - "Had a tire rotation yesterday and now there's a noise from the back"
  - "Tire was patched two days ago and it's going flat again"
  - "Just had tires put on and the TPMS light is still on"
  - "Shop balanced my tires Monday and it still shakes worse than before"
Negative examples:
  - "Started pulling to the right after new tires" → pulling/pull_that_started_after_recent_tire_or_service_work
  - "Had brake job done and now it makes noise" → other/after_recent_service_or_repair_work
  - "Tire pressure light came on this morning, no recent work" → low_pressure_warning_light_only
  - "Tire has been losing air for months, no recent service" → tire_going_flat_losing_air
  - "Sidewall has cracks, no tire work done recently" → dry_rot_sidewall_cracking
Synonyms: new symptom after tire work, vibration after new tires, noise after tire rotation, TPMS won't clear after tire service, leak came back after patch, leak after plug, shaking after balance, comeback after tire work, post-tire-work issue, problem after tires installed, returned after tire service
