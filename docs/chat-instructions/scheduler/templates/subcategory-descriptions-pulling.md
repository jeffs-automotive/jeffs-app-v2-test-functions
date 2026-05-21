# Subcategory Descriptions — pulling

<!--
Wave B3 draft. Authored 2026-05-21.

Sources (customer language and symptom phrasings extracted from these pages):
  - https://repairpal.com/symptoms/signs-of-stuck-brake-caliper
  - https://www.firestonecompleteautocare.com/blog/brakes/signs-of-a-bad-brake-caliper/
  - https://www.shermansautorepair.com/signs-brake-calipers-failing/
  - https://www.autozone.com/diy/brakes/brake-caliper-sticking
  - https://www.firestonecompleteautocare.com/blog/alignment/what-to-do-when-car-pulls-to-one-side/
  - https://www.autozone.com/diy/symptoms/why-is-my-car-pulling-to-the-side
  - https://burtbrothers.com/tips/why-does-my-car-pull-to-one-side-common-causes-fixes/
  - https://www.walser.com/blog/wheel-alignment/
  - https://barrysautobody.com/car-drifting-on-straight-road-causes/
  - https://www.mavis.com/learning-center/why-does-my-car-pull-to-one-side/
  - https://www.aa1car.com/library/torque_steer.htm
  - https://www.jdpower.com/cars/shopping-guides/what-is-torque-steer-and-how-do-you-stop-it
  - https://en.wikipedia.org/wiki/Torque_steer
  - https://www.agcoauto.com/content/news/p2_articleid/249
  - https://practicalmotoring.com.au/car-advice/torque-steer-what-is-it-and-why-it-matters-or-doesnt/
  - https://community.cartalk.com/t/road-crown-alignment-problem/75215
  - https://static.nhtsa.gov/odi/tsbs/2020/MC-10185418-0001.pdf
  - https://trillitires.com/why-your-car-pulls-after-installing-new-tires/
  - https://atlanticmotorcar.com/casestudies/radial-tire-pull-or-is-my-tire-really-cone-shaped/
  - https://gat-matic.com/can-i-drive-my-car-right-after-getting-new-tires-without-an-alignment-2/
  - https://www.pepboys.com/car-care/tire-care/do-i-need-an-alignment-with-new-tires
  - https://www.moogparts.com/parts-matter/why-does-my-steering-feel-loose.html
  - https://oldoxtire.com/auto-repair-blog/the-5-signs-of-bad-tie-rods/
  - https://www.autozone.com/diy/suspension/bad-tie-rod-symptoms
  - https://gspnorthamerica.com/blogs/news/tie-rod-end-failure-vs-ball-joint-wear-how-to-diagnose-at-home
  - https://www.onallcylinders.com/2016/08/12/quick-guide-diagnosing-10-common-steering-issues/
  - https://maderaautorepair.com/car-care/what-causes-steering-wheel-play-and-how-to-fix-it/
  - https://www.tomorrowstechnician.com/ball-joint-and-tie-rod-play-customer-symptom-checklist/
  - https://www.quora.com/Once-wheel-alignment-is-done-why-does-my-car-still-pull-to-the-right
  - https://www.lesschwab.com/article/alignment/do-i-really-need-an-alignment.html

Validation notes:
  - The CONDITION trigger is the load-bearing discriminator across all 6
    subcategories: "only when braking" vs "while cruising" vs "during
    acceleration" vs "follows road slope" vs "after recent work" vs "both
    directions / wandering". Every description leads with the condition.
  - The trickiest pair (steady_drift_while_cruising vs
    drift_that_follows_the_roads_slope) is disambiguated by the parking-lot /
    flat-road test: drift that persists on a flat surface = steady_drift;
    drift that goes away on a flat surface but returns on crowned roads =
    drift_that_follows_the_roads_slope. Both descriptions reference this
    test verbatim, and they cross-link each other as negative examples.
  - pulling_only_when_braking is consistently framed as a DIRECTIONAL pull
    (vehicle veers left/right) tied to brake application, NOT a pedal-feel
    or pedal-noise complaint — those route to the brakes/* subcategories.
    Negative examples explicitly call out brakes/pulsating_or_vibrating_pedal
    and brakes/pedal_sinks_to_floor to block cross-matching.
  - Cross-category negative examples cover the high-collision boundaries:
    brakes/* (pedal-feel + noise), steering/loose_or_sloppy_steering,
    steering/steering_wheel_off_center_when_driving_straight, tires/*
    (uneven wear + recent_tire_work_then_new_symptom), and
    other/after_recent_service_or_repair_work.
  - Synonyms span casual ("pulls", "drifts", "tugs"), directional ("veers",
    "leads", "wants to go right"), and condition-anchored ("torque steer",
    "tramlining", "wanders").
-->

## pulling/pulling_only_when_braking
Description: The car veers or pulls toward one side only when the brake pedal is pressed, then tracks straight again once the brakes are released. Typically caused by a stuck or sticking brake caliper, a collapsed brake hose, contaminated brake fluid, or uneven pad wear on one side — one wheel's brake grips harder than the other and tugs the car that direction. Distinct from steady_drift_while_cruising (which pulls all the time, not just when braking) and from the brakes/* subcategories that cover pedal feel (spongy, hard, pulsating) or noise (squealing, grinding) without a directional pull.
Positive examples:
  - "Car pulls hard to the right every time I hit the brakes"
  - "Steering wheel jerks left when I brake"
  - "Only pulls to one side when I'm slowing down — drives straight otherwise"
  - "When I brake on the highway it veers into the next lane"
  - "Smells like burning brake on one wheel and pulls when I stop"
Negative examples:
  - "Brake pedal pulsates when I stop" → brakes/pulsating_or_vibrating_pedal
  - "Pedal sinks to the floor when I press it" → brakes/pedal_sinks_to_floor
  - "Brakes squeal but car drives straight" → brakes/high_pitched_squealing
  - "Car drifts to the right all the time, not just when braking" → steady_drift_while_cruising
  - "Pedal feels hard, takes a lot of force to stop" → brakes/hard_or_unresponsive_pedal
Synonyms: pulls when braking, brakes pull, veers when stopping, pulls to one side when I brake, tugs when slowing down, sticking caliper pull, brake pull, drifts during braking, jerks when braking

## pulling/steady_drift_while_cruising
Description: The car constantly drifts or pulls to one side while driving straight on the highway or surface streets, requiring continuous small steering corrections to stay in the lane. The pull is consistent in direction (always the same side), happens on roads with no obvious slope, and persists in a flat empty parking lot when briefly letting go of the wheel. Most commonly caused by wheel alignment out of spec (camber, caster, or toe), uneven tire pressure, a tire defect like conicity, or worn suspension components. Distinct from drift_that_follows_the_roads_slope (which goes away on a flat surface and changes direction with the road's tilt) and from wandering_or_drifting_in_both_directions (which wanders unpredictably both ways instead of consistently to one side).
Positive examples:
  - "Car constantly pulls to the right on the highway"
  - "Have to hold the wheel slightly left just to go straight"
  - "Drifts to the left even on a flat parking lot"
  - "Won't track straight — always wants to go right no matter what road I'm on"
  - "I feel like I'm fighting the steering wheel to stay in my lane"
Negative examples:
  - "Only pulls when I brake" → pulling_only_when_braking
  - "Only drifts on certain roads or in certain lanes" → drift_that_follows_the_roads_slope
  - "Car wanders both ways, never settles" → wandering_or_drifting_in_both_directions
  - "Started pulling right after I got new tires" → pull_that_started_after_recent_tire_or_service_work
  - "Steering wheel is off-center when I'm going straight" → steering/steering_wheel_off_center_when_driving_straight
Synonyms: pulls to one side, drifts, drifts right, drifts left, won't track straight, wants to go one way, lateral pull, alignment pull, leads to one side, tracks off, won't drive straight, fights the wheel

## pulling/pulling_only_during_acceleration
Description: The car tugs or pulls to one side only when the driver accelerates firmly — most noticeable when merging, passing, or accelerating from a stop — and straightens back out as soon as the throttle is eased. This is the classic torque steer pattern in front-wheel-drive vehicles, caused by unequal-length driveshafts or unequal torque delivery to the front wheels under hard acceleration; can also stem from worn engine mounts, worn CV joints, or worn control arm bushings. Distinct from steady_drift_while_cruising (which pulls at any speed regardless of throttle) and from pulling_only_when_braking (which pulls when slowing, not when accelerating).
Positive examples:
  - "Pulls hard to the right when I step on the gas"
  - "Steering wheel tugs in my hands when I accelerate"
  - "Only pulls when I'm getting on the highway, goes straight as soon as I let off"
  - "Front-wheel drive car, tugs sideways when I floor it"
  - "Wheel twists to one side under hard acceleration, fine at cruise"
Negative examples:
  - "Pulls all the time, not just when accelerating" → steady_drift_while_cruising
  - "Only pulls when I brake" → pulling_only_when_braking
  - "Engine feels weak and sluggish when I accelerate" → performance/lacks_power_or_acceleration
  - "Steering feels loose and wanders all over" → wandering_or_drifting_in_both_directions
  - "Clunking from the front end when I accelerate" → noise/clunking_or_knocking_from_front_end
Synonyms: torque steer, pulls during acceleration, tugs when accelerating, pulls when I gas it, jerks under acceleration, twists wheel during acceleration, FWD pull, pulls when I step on it, acceleration pull, drifts under throttle

## pulling/drift_that_follows_the_roads_slope
Description: The car drifts in the direction the road is tilted — leans right on a road crowned to the right, leans left on a road crowned to the left, and tracks straight or nearly straight on a perfectly flat surface like an empty parking lot. This is largely a normal physics effect because most roads are built with a slight slope (crown) for drainage, and cars are often aligned from the factory to gently drift toward the shoulder away from oncoming traffic. Can be exaggerated by a marginal alignment, mismatched tires, or low pressure on one side, but unlike steady_drift_while_cruising the pull GOES AWAY on a flat surface. Distinct from steady_drift_while_cruising (which persists even on a flat parking lot and always pulls the same direction regardless of road slope).
Positive examples:
  - "Only pulls on certain roads — drives fine on others"
  - "Drifts right on the highway but straight in a parking lot"
  - "If I'm in the left lane it pulls one way, in the right lane it pulls the other way"
  - "Pull reverses when I cross a bridge that's tilted the other direction"
  - "Always drifts toward the shoulder no matter which road I'm on, but never on flat ground"
Negative examples:
  - "Pulls the same direction on every single road, even flat parking lots" → steady_drift_while_cruising
  - "Only pulls when I brake" → pulling_only_when_braking
  - "Only pulls when I accelerate" → pulling_only_during_acceleration
  - "Started right after I got new tires" → pull_that_started_after_recent_tire_or_service_work
  - "Car wanders both ways, doesn't follow the road" → wandering_or_drifting_in_both_directions
Synonyms: road crown drift, slope drift, drifts with the road, follows the crown, tracks with the road, leans toward the shoulder, only pulls on certain roads, crowned road pull, lane-dependent drift, normal road drift

## pulling/pull_that_started_after_recent_tire_or_service_work
Description: A new pulling or drifting symptom that appeared right after recent tire work, wheel alignment, or front-end service — for example, after new tires were installed, a tire was rotated, an alignment was done, or suspension parts were replaced. Common root causes include tire conicity on a freshly installed tire, an alignment that was performed incorrectly or didn't compensate for a pre-existing issue, a tire mounted on the wrong side, or a part bumped out of spec during the service. Distinct from steady_drift_while_cruising (a long-standing pull with no recent service trigger) and from other/after_recent_service_or_repair_work (which covers post-service symptoms broadly — choose this pulling subcategory whenever the post-service symptom is specifically a pulling or drifting complaint).
Positive examples:
  - "Started pulling to the right right after I got new tires last week"
  - "Just had an alignment done and now it pulls worse than before"
  - "Shop rotated my tires yesterday and now the car drifts left"
  - "Got new tires put on and it's been pulling ever since"
  - "Had front-end work done last month and the car's been tugging to one side"
Negative examples:
  - "Has always pulled to the right, no recent service" → steady_drift_while_cruising
  - "Only pulls when I brake — had brake work recently" → pulling_only_when_braking
  - "Recent service and the car runs rough, doesn't pull" → other/after_recent_service_or_repair_work
  - "New tires and now it vibrates at highway speed" → vibration/vibration_at_highway_speed
  - "Recent tire work and now low pressure warning is on" → tires/low_pressure_warning_light_only
Synonyms: pulls after new tires, pulls after alignment, drifts after tire rotation, post-alignment pull, tire conicity, new tires pulling, alignment made it worse, started pulling after service, post-tire-work pull, drifts since the shop

## pulling/wandering_or_drifting_in_both_directions
Description: Instead of pulling steadily toward one side, the car wanders back and forth on its own — drifting left, then right, then left — and feels unstable or unpredictable, especially at highway speeds or on rough roads. The steering often feels loose, sloppy, or "rubbery" with noticeable play before the wheels respond. Most commonly caused by worn tie rod ends, worn ball joints, a loose steering gear or rack, worn control arm bushings, or a loose wheel bearing — components that allow the front wheels to move side-to-side or up-and-down independently of the driver's steering input. Distinct from steady_drift_while_cruising (which pulls consistently to ONE direction) and from steering/loose_or_sloppy_steering (which focuses on the feel of the steering wheel itself — choose this pulling subcategory when the customer's primary complaint is the car's PATH wandering on the road rather than the steering wheel's looseness).
Positive examples:
  - "Car wanders all over the lane — I'm constantly correcting"
  - "Drifts left, then right, doesn't track straight either way"
  - "Feels like the front end has a mind of its own"
  - "Steering feels loose and the car won't stay in its lane"
  - "Wanders back and forth at highway speed, especially over bumps"
Negative examples:
  - "Pulls steady to the right, same direction every time" → steady_drift_while_cruising
  - "Steering wheel feels loose but car tracks straight" → steering/loose_or_sloppy_steering
  - "Steering wheel is tilted off-center when going straight" → steering/steering_wheel_off_center_when_driving_straight
  - "Front end clunks over bumps" → noise/clunking_or_knocking_from_front_end
  - "Vibrates at highway speed but goes straight" → vibration/vibration_at_highway_speed
Synonyms: wanders, wandering, drifts both ways, all over the road, won't stay straight, loose front end, sloppy tracking, unpredictable steering, drifts side to side, tramlining, front end wander, hunts left and right, loose steering feel
