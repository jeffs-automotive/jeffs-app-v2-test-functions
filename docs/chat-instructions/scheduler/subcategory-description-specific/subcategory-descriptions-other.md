# Subcategory Descriptions — other category

<!--
Wave B1 draft. 6 subcategories.

The `other` category is NOT a symptom category like brakes or hvac. These are
situational / contextual subcategories that route to a service advisor rather
than to a specific testing service. The diagnostic LLM Stage 1 picks these
ONLY when the customer's description names a SITUATION (recent accident,
multiple unrelated symptoms together, "just want a check-up") rather than a
specific symptom that fits a concrete subcategory.

The over-routing failure mode is REAL: poorly-prompted LLMs default to
"other" whenever they feel uncertain. The descriptions + negative examples
below are deliberately written to LIMIT when `other/<slug>` is the correct
pick. When in doubt between `other/<slug>` and a concrete symptom
subcategory, the concrete subcategory ALWAYS wins.

Research sources consulted (May 2026):
  - https://www.acg.aaa.com/connect/blogs/4c/auto/road-trip-car-maintenance-checklist
  - https://www.consumerreports.org/cars/how-to-inspect-a-used-car-a1377126659/
  - https://www.jdpower.com/cars/shopping-guides/how-do-you-get-a-pre-purchase-inspection-when-buying-a-used-car
  - https://www.jdpower.com/cars/shopping-guides/understanding-pre-purchase-inspection-ppi
  - https://www.edmunds.com/car-buying/inspect-that-used-car-before-buying.html
  - https://www.lendingtree.com/auto/used-car-inspection/
  - https://www.cbac.com/our-services/pre-purchase-inspections/
  - https://lemonsquad.com/
  - https://elsnerlawfirm.com/how-do-rear-end-collisions-damage-your-car/
  - https://schneiderauto.net/blog/70-4-expert-tips-for-addressing-alignment-problems-caused-by-rear-end-collisions-1
  - https://www.uti.edu/blog/collision/rear-end-collision-damage
  - https://harryscollision.com/signs-car-needs-frame-straightening-after-accident/
  - https://mrdentwp.com/frame-alignment-a-critical-step-in-auto-body-repair-after-accidents/
  - https://www.statefarm.com/simple-insights/auto-and-vehicles/immediate-steps-to-take-if-you-hit-a-deer-with-your-car
  - https://www.consumerreports.org/cars/car-safety/how-to-avoid-collisions-with-deer-this-fall-a2981072345/
  - https://www.dairylandinsurance.com/resources/what-to-do-when-you-hit-a-deer-with-your-car
  - https://www.chase.com/personal/auto/education/maintenance/what-to-do-if-you-hit-a-deer-with-your-car
  - https://www.progressive.com/answers/does-car-insurance-cover-pothole-damage/
  - https://www.progressive.com/answers/does-car-insurance-cover-hitting-a-curb/
  - https://www.allstate.com/resources/car-insurance/is-pothole-damage-covered
  - https://www.erieinsurance.com/blog/hit-a-pothole
  - https://www.theconsumerlawgroup.com/faqs/lemon-law-claim-when-a-dealer-can-t-diagnose-a-problem.cfm
  - https://dealerdisputehelp.com/car-repaired-but-same-problem-came-back/
  - https://legalclarity.org/what-to-do-when-a-mechanic-doesnt-fix-the-problem/
  - https://www.capitalone.com/cars/learn/managing-your-money-wisely/you-paid-for-a-repair-that-didnt-fix-your-car-now-what/1433
  - https://consumer.ftc.gov/articles/auto-warranties-and-auto-service-contracts
  - https://www.acarplace.com/2017/12/dealers/
  - https://overbeckauto.com/understanding-car-shakes-when-is-it-safe-to-drive/
  - https://www.wrightscarcare.com/from-check-engine-lights-to-strange-noises-when-to-take-your-car-in
  - https://trojanautocare.com/the-risks-of-driving-a-shaking-car-safety-tips-and-guidelines/
  - https://americanimportsautorepair.com/driving-safety-when-car-shaking-indicates-a-risk/
  - https://www.aaa.com/autorepair/articles/prepare-your-car-for-summer-travel
  - https://cluballiance.aaa.com/the-extra-mile/advice/car/older-car-road-trip-ready
  - https://mwg.aaa.com/via/car/car-safe-road-trip-checklist
  - https://www.theautolink.com/blog/how-long-is-it-bad-for-a-car-to-sit-without-being-driven/
  - https://www.autozone.com/diy/trustworthy-advice/how-long-can-a-car-sit-without-being-driven
  - https://www.carx.com/blog/car-sitting-idle-for-weeks-or-months-heres-what-you-need-to-know/
  - https://carfixautorepair.com/how-should-you-care-for-cars-not-driven-for-extended-periods-of-time/
  - https://www.chapelhilltire.com/6-vital-checks-for-cars-left-sitting-too-long
  - https://www.kbb.com/car-advice/car-storage-what-to-know/
  - https://www.bentonvillechevrolet.com/blogs/8856/most-common-car-issues-explained-engine-battery-ac-brakes-warning-lights
  - https://www.mangoautomotive.com/protect-your-engine-common-warning-signs-and-when-to-visit-an-auto-repair-shop
-->

## other/multiple_symptoms_not_sure_what_category
Description: Customer describes TWO OR MORE genuinely UNRELATED problems happening together — e.g., AC stopped working AND a noise from underneath AND a warning light. Pick this ONLY when the description names symptoms across multiple different systems that don't share an obvious common cause. If the customer describes a single symptom (even a strong or scary one), or multiple symptoms within the SAME system (e.g., "brakes squeal and feel mushy"), route to the matching concrete subcategory instead. Distinct from warning_light/multiple_warning_lights_at_once (which is specifically about dashboard lights with no other symptoms named) and from any single-system multi-symptom (which belongs in that system's category).
Positive examples:
  - "My AC stopped working and I'm hearing a noise from underneath, plus the check engine light is on"
  - "There's a few different things going on — it's shaking when I brake, the heat doesn't work, and there's a weird smell"
  - "I've got like three things wrong at once and I don't know where to start"
  - "Multiple problems — battery light, a hissing noise, and it pulls to the left"
  - "Honestly I don't know what category — it's making noises, the AC is weak, and I smell something burning"
Negative examples:
  - "My brakes squeal and feel mushy" → brakes/spongy_or_soft_pedal (same system; pick the most urgent brake subcategory)
  - "The car shakes and the steering wheel vibrates at highway speed" → vibration/steering_wheel_shake_at_highway_speed (same root cause)
  - "Multiple warning lights came on at once" → warning_light/multiple_warning_lights_at_once
  - "Heat doesn't work and AC is weak" → hvac/heat_doesnt_work or hvac/ac_is_weak_not_cold_enough (same HVAC system; pick the more urgent one)
  - "It's making a lot of different noises" → noise/<the loudest or most worrying noise>
  - "My car has multiple issues but they all started after I hit a curb" → other/after_a_recent_accident_or_impact (accident context dominates)
  - "Lots of things wrong but everything started after my last oil change" → other/after_recent_service_or_repair_work (post-service context dominates)
Synonyms: multiple problems, several issues, a few things going on, lots of stuff wrong, bunch of things wrong at once, multiple symptoms, not sure where to start, don't know what category, a few different things, several symptoms, three things wrong, everything seems off

## other/after_a_recent_accident_or_impact
Description: Customer's description names a recent collision, curb hit, pothole strike, deer/animal hit, or other physical impact as the TRIGGER for why they're bringing the car in. Pick this when the accident or impact is the framing event — even if the customer also names a specific symptom (pull, vibration, fluid leak), the post-accident context dominates so the advisor can coordinate inspection + insurance + frame/alignment checks together. Distinct from pulling/pull_that_started_after_recent_tire_or_service_work (which is for routine tire work, NOT a collision) and from any specific symptom subcategory (when no accident is mentioned, route to the symptom).
Positive examples:
  - "I got rear-ended last week and want to make sure the car's okay"
  - "Hit a deer two days ago — it's still running but I want it checked out"
  - "Ran over a huge pothole and now the steering feels weird"
  - "Had a fender bender in the parking lot — bumper looks fine but I want to be sure"
  - "Curbed it pretty hard turning into the driveway, want to get it looked at"
  - "Got into an accident on the highway, insurance is sending me in for inspection"
Negative examples:
  - "Car pulls to the right" (no accident mentioned) → pulling/steady_drift_while_cruising
  - "Steering wheel shakes at highway speed" (no impact mentioned) → vibration/steering_wheel_shake_at_highway_speed
  - "Bouncing or shaking over bumps" (chronic, no accident named) → vibration/shaking_or_bouncing_over_bumps_and_rough_roads
  - "Car pulls left after I got new tires put on" → pulling/pull_that_started_after_recent_tire_or_service_work (service work, NOT accident)
  - "Hit a small bump and now there's a rattle" (a bump, not an impact event) → noise/rattling_underneath_the_car (rattle is the symptom; bump too minor to be the framing)
  - "Don't feel safe driving it" with no accident mentioned → other/safety_concern_dont_feel_safe_driving_it
Synonyms: accident, collision, crash, fender bender, rear-ended, rear end, hit something, hit a deer, hit a curb, curbed it, hit a pothole, ran over something, impact, struck, got into an accident, insurance claim, after the wreck, post-collision

## other/after_recent_service_or_repair_work
Description: Customer's description names a recent visit to a shop, dealership, or DIY repair as the TRIGGER — the symptom appeared right after, OR the same problem came back after a repair. Pick this when the customer frames the issue around the previous service (warranty, comeback, "they just worked on this"). The advisor needs to coordinate documentation, warranty review, and possible re-diagnosis. Distinct from pulling/pull_that_started_after_recent_tire_or_service_work which is the SPECIFIC tire/alignment-related pull (always route there for tire/alignment-specific pull symptoms) and from tires/recent_tire_work_then_new_symptom (specific to tire-shop work). When the prior service is non-tire-related (oil change, brake job, transmission, engine) OR the customer can't pinpoint a single concrete symptom, pick this one.
Positive examples:
  - "Just got my oil changed and now there's a knocking noise that wasn't there before"
  - "They replaced my alternator last week but the battery light is back on"
  - "Same problem keeps coming back — third time at the shop for the same issue"
  - "Picked the car up from the dealer yesterday and something feels off"
  - "Had brake work done a month ago and now I'm having a different problem"
  - "It's under warranty from another shop and the original repair didn't hold"
Negative examples:
  - "Pull started right after I got new tires" → pulling/pull_that_started_after_recent_tire_or_service_work
  - "New vibration after tire rotation" → tires/recent_tire_work_then_new_symptom
  - "Brakes squeal" (no recent service named) → brakes/high_pitched_squealing
  - "Check engine light came on" (no recent service named) → warning_light/check_engine_light
  - "Hit a curb after I got my car back from the shop" → other/after_a_recent_accident_or_impact (accident is the dominant trigger)
  - "Multiple things wrong since the last service" → other/after_recent_service_or_repair_work (this — post-service framing dominates)
Synonyms: comeback, came back, just had it serviced, recently repaired, after the shop, after the dealer, post-repair, post-service, under warranty, warranty work, just got it back, picked it up yesterday, same problem returned, fix didn't hold, recurring issue, dealership work, just had work done

## other/safety_concern_dont_feel_safe_driving_it
Description: Customer's description uses safety-fear language ("not safe", "scared to drive", "don't trust it", "afraid something will fail") WITHOUT naming a specific concrete symptom strong enough to route on. Pick this when the customer expresses generalized fear or a vague "something's wrong and I'm worried" framing — the advisor needs to triage whether to dispatch a tow, get safety details, or guide them to drive in. Distinct from concrete safety-critical subcategories like brakes/pedal_sinks_to_floor or steering/hard_to_turn_heavy_steering — if the customer names the specific symptom (sinking pedal, no brakes, can't steer), ALWAYS route to that concrete subcategory even though it IS a safety issue. The customer's PHRASING is what determines routing: generalized fear → here; named symptom → there.
Positive examples:
  - "I don't feel safe driving it — something's not right"
  - "Scared to take it on the highway"
  - "It just doesn't feel right and I'm worried"
  - "I don't trust the car right now"
  - "Afraid something is going to fail while I'm driving"
  - "Doesn't feel safe — I want it towed in just to be sure"
Negative examples:
  - "Brake pedal goes to the floor" → brakes/pedal_sinks_to_floor (named symptom — that's the route, even though it IS a safety issue)
  - "Can barely turn the steering wheel" → steering/hard_to_turn_heavy_steering
  - "Car died on the highway and won't restart" → electrical/car_died_while_driving_electrical
  - "Smoke coming from under the hood" → smoke/smoke_from_under_the_hood
  - "Brakes don't feel right — pedal is soft" → brakes/spongy_or_soft_pedal (named symptom)
  - "Steering wheel shakes really bad at highway speed and I'm scared" → vibration/steering_wheel_shake_at_highway_speed (named symptom — the fear is secondary)
  - "Don't feel safe after I got rear-ended" → other/after_a_recent_accident_or_impact (accident context dominates)
Synonyms: not safe, unsafe, don't feel safe, scared to drive, afraid to drive, nervous driving it, don't trust it, doesn't feel right, something's not right, worried about driving it, afraid it'll break down, feels dangerous, want it towed, won't drive it, scared to take it on the highway

## other/general_check_up_or_pre_trip_inspection
Description: Customer is requesting a NON-DIAGNOSTIC general inspection — no symptom is named. Common framings: pre-road-trip check, pre-purchase inspection (PPI), "just bought it used", peace-of-mind check, "haven't had it looked at in a while", or annual once-over. Pick this when the customer is asking for a service rather than reporting a problem. Distinct from any symptom subcategory (when a symptom IS named, route to the symptom even if they also mention an upcoming trip) and from warning_light/multiple_warning_lights_at_once (which IS a problem-report, even if vague).
Positive examples:
  - "Got a road trip coming up next week and want to make sure the car's ready"
  - "Just bought this used and want it checked over"
  - "Want a pre-purchase inspection on a car I'm thinking about buying"
  - "Nothing wrong, just want a general check-up — haven't had it looked at in a year"
  - "Heading on a long drive, can you do a quick once-over?"
  - "Peace of mind inspection — no issues, just want it gone over"
  - "Daughter's heading to college, want the car looked at before she goes"
Negative examples:
  - "Going on a road trip and the brakes are squealing" → brakes/high_pitched_squealing (named symptom dominates)
  - "Just bought this used and the check engine light is on" → warning_light/check_engine_light
  - "Want a check-up because I'm hearing a noise" → noise/<the specific noise>
  - "Multiple warning lights — want a check" → warning_light/multiple_warning_lights_at_once
  - "Pre-trip check, but it also pulls to the right" → pulling/steady_drift_while_cruising (named symptom dominates)
  - "Haven't driven it in months and want it checked" → other/car_has_been_sitting_unused_for_a_long_time (sat-unused context dominates)
Synonyms: general inspection, check-up, peace of mind, pre-trip inspection, pre trip check, pre-purchase inspection, PPI, used car inspection, road trip check, going on a trip, just bought it, just purchased, looked it over, once-over, annual check, want it gone over, bumper to bumper check, nothing wrong but, no issues just want, multi-point inspection, general check

## other/car_has_been_sitting_unused_for_a_long_time
Description: Customer's description names that the car has been STORED or NOT DRIVEN for an extended period (weeks, months, years) as the framing context. Pick this when the dormant-storage context is what brings them in — whether or not they've already tried to start it. The advisor needs to coordinate towing, multi-system inspection (battery, fluids, fuel, tires, brakes, rodent damage), and possibly a recommissioning service. Distinct from electrical/battery_drains_overnight (which is about a battery problem on an ACTIVELY-driven car, NOT a car that's been parked for months) and from electrical/wont_crank_just_clicks (when the customer names the no-crank symptom on a regularly-driven car).
Positive examples:
  - "Car's been sitting in my garage for over a year — want to get it running again"
  - "Haven't driven it in 8 months, what should I check?"
  - "It's been parked outside through winter and hasn't been started"
  - "My dad's old car has been sitting in storage for 3 years"
  - "Garage queen, hasn't moved in 2 years, want to get it back on the road"
  - "Was deployed overseas, car sat for 18 months, just got back"
  - "Inherited a car that's been sitting — needs to come in"
Negative examples:
  - "Battery is dead — it won't start" (no mention of long storage) → electrical/wont_crank_just_clicks
  - "Battery drains overnight" (active daily driver) → electrical/battery_drains_overnight
  - "Won't start in the morning" (regular use, just hard to start) → performance/hard_to_start_when_cold
  - "Sat overnight and now it won't start" (overnight, not long-term) → electrical/wont_crank_just_clicks
  - "Tires are dry-rotted from sitting" (specific tire symptom named) → tires/dry_rot_sidewall_cracking
  - "Has been sitting and now I want to take it on a road trip" → other/car_has_been_sitting_unused_for_a_long_time (sat-unused dominates; trip is downstream)
  - "Sitting because I got into an accident" → other/after_a_recent_accident_or_impact (accident is the trigger)
Synonyms: been sitting, hasn't been driven, sat in the garage, sat in storage, garage queen, barn find, hasn't moved, parked for months, parked for years, dormant, long-term storage, hasn't started in months, hasn't run in a while, stored for the winter, parked outside, sat out in the weather, didn't drive it all winter, inherited, project car that sat
