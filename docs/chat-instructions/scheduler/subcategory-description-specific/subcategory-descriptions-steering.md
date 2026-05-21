# Subcategory Descriptions — steering

<!--
Wave C1 draft. Authored 2026-05-21.

Sources (customer language and symptom phrasings extracted from these pages):
  - https://auto.howstuffworks.com/under-the-hood/vehicle-maintenance/how-to-diagnose-power-steering-problems.htm
  - https://www.autozone.com/diy/power-steering/why-is-my-steering-wheel-hard-to-turn
  - https://www.autozone.com/diy/power-steering/what-causes-power-steering-whine
  - https://www.firestonecompleteautocare.com/blog/alignment/steering-wheel-stiff-when-turning/
  - https://ericscarcare.com/blogs/why-is-my-steering-wheel-hard-to-turn
  - https://oards.com/steering-wheel-hard-to-turn/
  - https://cartreatments.com/steering-wheel-hard-to-turn/
  - https://petenelsonautorepair.com/why-is-turning-your-wheel-so-hard-6-signs-of-power-steering-problems/
  - https://theweeklydriver.com/2026/03/why-is-my-steering-wheel-loose/
  - https://www.moogparts.com/parts-matter/symptoms-of-bad-ball-joints.html
  - https://www.moogparts.com/parts-matter/why-does-my-steering-feel-loose.html
  - https://www.carbibles.com/loose-steering-wheel/
  - https://maderaautorepair.com/car-care/what-causes-steering-wheel-play-and-how-to-fix-it/
  - https://www.advantagesalvage.com/3-possible-reasons-your-steering-wheel-feels-loose
  - https://www.firestonecompleteautocare.com/blog/maintenance/symptoms-of-bad-tie-rod-ends/
  - https://blog.1aauto.com/diagnose-bad-inner-tie-rod/
  - https://hmar.net/steering-wheel-feels-loose-pi688/
  - https://slrspeed.com/blogs/news/5-signs-your-inner-tie-rod-is-failing-and-how-to-replace-it
  - https://www.carparts.com/blog/steering-wheel-off-center-symptoms-causes-and-fixes/
  - https://huntersgaragepa.com/steering-wheel-not-straight-common-alignment-issues/
  - https://www.lesschwab.com/article/alignment/common-causes-and-how-to-fix-off-center-steering-wheel.html
  - https://gresham4wheeldrive.com/steering-wheel-still-crooked-after-alignment/
  - https://cartreatments.com/steering-wheel-off-center/
  - https://oxfordautomotivepa.com/why-is-my-steering-wheel-off-center-when-im-driving-straight/
  - https://autoroundparts.com/blogs/news/why-is-my-power-steering-pump-whining-top-4-causes
  - https://springs-auto.com/blog/causes-of-a-noisy-power-steering-pump/
  - https://springs-auto.com/blog/why-does-my-steering-wheel-whine-or-groan-when-turning-and-what-to-do-in-vancouver-wa/
  - https://knowhow.napaonline.com/power-steering-whine-steering-noisy/
  - https://www.caledonchrysler.ca/power-steering-pump-whining-causes-symptoms-what-it-means/
  - https://www.thedrive.com/maintenance-repair/38866/power-steering-pump-noise
  - https://scanneranswers.com/clunking-sounds-when-you-turn-the-steering-wheel/
  - https://realtruck.com/blog/why-does-my-steering-wheel-shake-at-high-speeds/
  - https://www.wheelsetgo.com/blog/why-your-steering-wheel-shakes-after-new-wheels-or-tires-and-how-to-fix-it/
  - https://www.gmsquarebody.com/threads/death-wobble-or-bad-wheel-balance.43983/
  - https://www.theaa.com/breakdown-cover/advice/steering-wheel-shaking
  - https://www.woodiesautoservice.com/blog/what-makes-a-steering-wheel-shake-at-highway-speeds
  - https://goodyeartiresandautorepairsantacruz.com/blog/tire-balancing-vibration-causes/
  - https://www.topspeed.com/cars/car-news/this-is-what-the-infamous-death-wobble-is-like-on-a-newer-ford-f-350-ar188401.html
  - https://www.f150forum.com/f6/death-wobble-458176/
  - https://www.torquenews.com/3769/wobble-death-affects-heavy-duty-ford-pickups-well-jeeps-and-others
  - https://www.shockwarehouse.com/pages/what-is-death-wobble-and-how-do-i-fix-it
  - https://realtruck.com/blog/what-is-jeep-death-wobble/
  - https://www.axleboy.com/4x4-offroad/death-wobble-what-is-it-and-how-is-it-fixed
  - https://www.jeepgladiatorforum.com/forum/threads/death-wobble-dw-death-wobble-dw-death-wobble-shimmy-wander-drift-bump-steer.68302/
  - https://www.yourmechanic.com/article/symptoms-of-a-bad-or-failing-ball-joint-front
  - https://www.onallcylinders.com/2016/08/12/quick-guide-diagnosing-10-common-steering-issues/
  - https://www.delphiautoparts.com/gbr/en/article/steering-you-down-right-way-common-symptoms-causes-and-fixes-best-practice-steering-repairs
  - https://www.hoganandsonsinc.com/blog/8-warning-signs-of-steering-problems
  - https://blog.autointhebox.com/2015/03/28/why-does-my-car-steering-wander/
  - https://www.genautoinc.com/6-reasons-your-steering-feels-loose
  - https://blog.1aauto.com/front-end-clunking-noise-mechanic-advice-video/
  - https://www.thecarbuzz.com/clunking-noise-over-bumps/
  - https://themotorguy.com/10-reasons-your-suspension-clunks-only-over-bumps-with-solutions/
  - https://www.autoracing1.com/pl/476555/automotive-news-vehicle-clunking-over-bumps-common-causes-and-fixes/
  - https://www.subaruforester.org/threads/stumped-by-sway-bar-clunk.116277/

Validation notes:
  - The STEERING category is fundamentally about WHAT THE DRIVER FEELS THROUGH
    THE WHEEL (and what they hear from the steering system). Every subcategory's
    primary-report angle is wheel-feel-first. Cross-category collisions
    explicitly addressed below.

  - CRITICAL: The steering_wheel_shakes_at_highway_speed (steering) vs
    vibration/steering_wheel_shake_at_highway_speed (vibration) pair is
    intentional. Both descriptions and both negative-example lists call out
    the discriminator: STEERING subcategory = customer frames the complaint
    around the WHEEL specifically ("wheel shakes in my hands", "shimmy in
    the steering wheel"), suggesting a balance / suspension / wheel-bearing
    workup. VIBRATION subcategory = customer frames the complaint as
    "vibration" passing through the seat / floor / whole car, suggesting a
    broader vibration-source workup (driveline, mounts, balance). The verb
    "shake" + the noun "wheel" routes here; the verb "vibrate" + "whole car"
    or "seat" routes to vibration. This is subtle and the LLM will see this
    boundary spelled out in both blocks.

  - noise_when_turning_the_steering_wheel (steering) vs
    noise/popping_or_clicking_when_turning (noise) is the
    power-steering-system noise (whine/groan/growl/creak heard from the
    engine bay or steering column while the wheel turns) vs CV-joint
    pop/click (a sharp percussive clack from the drive axle joints when
    turning at low speed in parking lots). Different physical systems,
    different sound qualities — call out in both blocks.

  - pulling_drifting_or_wandering_on_the_road (steering) vs the entire
    pulling/* category is disambiguated by the primary report angle:
    STEERING subcategory = the customer's complaint is about the
    STEERING WHEEL'S feel or about a vague "drifting / wandering /
    can't tell what's wrong" framing that mixes wheel-feel + car-direction.
    pulling/* = the customer frames the complaint precisely around the
    CAR'S directional track (which way it pulls, when it pulls, etc.).
    Negative examples cross-link pulling/steady_drift_while_cruising and
    pulling/wandering_or_drifting_in_both_directions.

  - loose_or_sloppy_steering (steering) vs
    pulling/wandering_or_drifting_in_both_directions (pulling) overlap.
    Steering subcategory = the WHEEL ITSELF feels loose, has play, has
    deadband before the car responds. Pulling subcategory = the CAR
    wanders left-then-right on the road even with the wheel held steady.
    Both blocks call out the test: wiggle the wheel while parked — if
    there's slop in the wheel itself, route to steering; if the wheel is
    tight but the car wanders, route to pulling. Both blocks cross-link.

  - clunking_knocking_or_rough_ride_over_bumps (steering) vs
    noise/clunking_over_bumps (noise) vs
    vibration/shaking_or_bouncing_over_bumps_and_rough_roads (vibration)
    is a three-way differentiation. Steering = clunk/jolt TRANSMITTED
    THROUGH THE STEERING WHEEL (or felt at the wheel as a kickback /
    rough ride). Noise = clunk you HEAR from underneath without a strong
    wheel-feel component. Vibration = whole-car bounce / continued
    oscillation after the bump (worn shocks/struts). All three blocks
    explicitly cross-link. The customer's primary verb ("felt in the
    wheel" vs "heard from below" vs "the whole car keeps bouncing") is
    the discriminator.

  - Synonyms span the four customer-language registers: effort ("hard",
    "stiff", "heavy", "tight", "crank the wheel"), play / looseness
    ("loose", "play", "wiggle", "deadband", "vague", "sloppy", "floaty"),
    sound ("whine", "groan", "moan", "growl", "creak", "clunk"), and
    motion ("shake", "shimmy", "wobble", "drift", "wander", "pull",
    "tracks off").
-->

## steering/hard_to_turn_heavy_steering
Description: The steering wheel takes significantly more effort to turn than it used to — often most noticeable at low speeds in parking lots and during three-point turns, where the driver has to "crank the wheel" or use both hands. Most commonly caused by a low or leaking power steering fluid level, a failing power steering pump (often accompanied by a whine or groan), a loose or worn serpentine belt, an electric power steering (EPS) motor or module fault, or low tire pressure. Distinct from loose_or_sloppy_steering (which is the opposite problem — the wheel is too easy to move and has play) and from noise_when_turning_the_steering_wheel (which focuses on the SOUND of turning rather than the EFFORT).
Positive examples:
  - "Steering wheel is really hard to turn, especially in parking lots"
  - "Have to use both hands to turn the wheel — it's gotten really stiff"
  - "Power steering feels like it quit — wheel takes way more effort now"
  - "Wheel is heavy at low speeds but feels normal on the highway"
  - "Almost lost the power steering — it went stiff overnight"
Negative examples:
  - "Steering wheel feels loose with a lot of play" → loose_or_sloppy_steering
  - "Whining noise when I turn the wheel but it turns fine" → noise_when_turning_the_steering_wheel
  - "Steering wheel is tilted to one side when I drive straight" → steering_wheel_off_center_when_driving_straight
  - "Whine from under the hood, gets louder as engine revs" → noise/high_pitched_whining_under_the_hood
  - "Red puddle under the front of the car" → leak/red_or_pink_puddle_transmission_or_power_steering
Synonyms: hard to turn, stiff steering, heavy steering, hard to steer, tight steering, hard to crank the wheel, lost power steering, no power assist, steering feels heavy, takes effort to turn, wheel won't turn easy, stiff wheel, hard wheel, manual steering feel

## steering/loose_or_sloppy_steering
Description: The steering wheel itself feels loose, vague, or disconnected — the driver can wiggle the wheel side-to-side a noticeable amount before the front tires actually respond, and tends to constantly correct to keep the car going straight. Often described as "play in the wheel," "deadband," "the wheel feels floaty," or "the car lags behind the wheel." Most commonly caused by worn inner or outer tie rod ends, worn ball joints, a worn steering rack or gearbox, or loose pitman/idler arm components. Distinct from pulling/wandering_or_drifting_in_both_directions (where the CAR wanders even when the wheel is held steady — choose this steering subcategory when the WHEEL ITSELF feels loose or has play) and from steering_wheel_off_center_when_driving_straight (which is about wheel POSITION, not wheel feel).
Positive examples:
  - "Steering wheel feels really loose — I can wiggle it before the car turns"
  - "Lots of play in the wheel, like there's a dead zone in the middle"
  - "Wheel feels sloppy and disconnected from the road"
  - "I have to constantly correct to keep it going straight"
  - "Car kind of lags behind the steering wheel — I turn and then it turns a second later"
Negative examples:
  - "Steering wheel is hard to turn, takes a lot of effort" → hard_to_turn_heavy_steering
  - "Car wanders both ways even though the wheel feels tight" → pulling/wandering_or_drifting_in_both_directions
  - "Steering wheel is tilted off-center going straight" → steering_wheel_off_center_when_driving_straight
  - "Car pulls steady to the right all the time" → pulling/steady_drift_while_cruising
  - "Clunk when I hit bumps, felt in the wheel" → clunking_knocking_or_rough_ride_over_bumps
Synonyms: loose steering, sloppy steering, play in the wheel, steering wheel play, wheel wiggles, deadband, dead zone, vague steering, floaty steering, disconnected steering, wheel lag, steering lag, slop in the wheel, excessive free play, rubbery steering, mushy steering, loose front end feel

## steering/steering_wheel_off_center_when_driving_straight
Description: The car drives straight down the road but the steering wheel itself is visibly tilted off-center — the top of the wheel sits past the 11 or 1 o'clock position, or the logo is rotated left or right, while the vehicle tracks correctly. Often shows up right after a recent alignment, tire rotation, suspension repair, or after hitting a curb / pothole. Most commonly caused by an alignment that didn't properly center the wheel, a bumped tie rod adjustment, a shifted rear-axle thrust angle, or impact damage to a steering component. Distinct from pulling/* subcategories (which involve the CAR drifting to one side, not just a cosmetically crooked wheel — though the two can co-occur) and from loose_or_sloppy_steering (which is about wheel FEEL / play, not wheel POSITION).
Positive examples:
  - "Steering wheel is crooked when I'm driving straight"
  - "Have to hold the wheel at 10 o'clock to go straight"
  - "Wheel is tilted to the right but the car goes straight"
  - "Just had an alignment and now the steering wheel isn't centered"
  - "Hit a curb and ever since the wheel sits off to the left"
Negative examples:
  - "Steering wheel is straight but car pulls to the right" → pulling/steady_drift_while_cruising
  - "Wheel feels loose with a lot of play" → loose_or_sloppy_steering
  - "Wheel shakes at highway speed" → steering_wheel_shakes_at_highway_speed
  - "Drifts on crowned roads, fine on flat parking lots" → pulling/drift_that_follows_the_roads_slope
  - "Car wanders both ways" → pulling/wandering_or_drifting_in_both_directions
Synonyms: steering wheel off-center, wheel not straight, crooked steering wheel, wheel tilted, wheel cocked, wheel sits off-center, wheel isn't centered, wheel position off, steering wheel turned to one side going straight, off-center after alignment, logo not straight, wheel pointed left, wheel pointed right

## steering/noise_when_turning_the_steering_wheel
Description: A noise that occurs SPECIFICALLY when the steering wheel is turned — most often a whine, groan, moan, hum, growl, creak, or pop coming from the engine bay or steering column. Often most noticeable when turning fully lock-to-lock at low speeds (parking, three-point turns), or when turning while parked (engine running, vehicle stationary). Most commonly caused by a low power steering fluid level, air in the power steering system, a failing power steering pump, worn steering shaft / U-joint, or dry strut bearings. Distinct from noise/popping_or_clicking_when_turning (which is a sharp percussive CV-joint click from the drive axle, only when the car is rolling — different physical system) and from noise/high_pitched_whining_under_the_hood (which is a continuous whine tied to engine RPM, present even when not turning).
Positive examples:
  - "Loud whine when I turn the wheel at low speed"
  - "Steering wheel groans when I turn it in the parking lot"
  - "Moaning sound only when I turn — goes away when wheel is straight"
  - "Creak from the steering column when I turn the wheel while parked"
  - "Growling noise from under the hood every time I crank the wheel"
Negative examples:
  - "Clicking from the front wheels when I turn at parking-lot speed" → noise/popping_or_clicking_when_turning
  - "Whine under the hood all the time, gets louder with RPM" → noise/high_pitched_whining_under_the_hood
  - "Squeak going over bumps" → noise/squeaking_or_creaking_over_bumps
  - "Steering wheel is hard to turn but no noise" → hard_to_turn_heavy_steering
  - "Clunk when I hit a bump, felt in the wheel" → clunking_knocking_or_rough_ride_over_bumps
Synonyms: whine when turning, groan when turning, moan when turning, growl when turning, hum when turning, creak when turning, power steering whine, power steering noise, steering pump noise, noise turning the wheel, noise turning steering wheel, whining steering, groaning steering, power steering moan, wheel noise

## steering/steering_wheel_shakes_at_highway_speed
Description: The steering wheel shakes, shimmies, or wobbles in the driver's hands at highway speed — typically starting between 50 and 70 mph, often steady at a given speed and sometimes smoothing out at higher speeds. The customer's primary framing is the WHEEL ITSELF shaking (not the seat, not the whole car). Most commonly caused by a tire that's out of balance (lost wheel weight, irregular tire wear), a bent wheel, a worn wheel bearing, or — in severe oscillating cases triggered by hitting a bump on solid-axle trucks/SUVs (Ford Super Duty, Jeep Wrangler) — "death wobble" from worn track bars / ball joints / steering damper. Distinct from vibration/steering_wheel_shake_at_highway_speed (which is the SAME physical symptom but framed differently by the customer — choose this STEERING subcategory when the customer says "the wheel shakes" or "shimmy in the wheel"; choose the vibration subcategory when the customer says "vibration in the wheel" or describes it as part of a broader car-vibration complaint). Also distinct from clunking_knocking_or_rough_ride_over_bumps (which is bump-triggered, not speed-triggered) and from pulling_drifting_or_wandering_on_the_road (which is a directional issue, not a shake).
Positive examples:
  - "Steering wheel shakes really bad around 60 mph"
  - "Wheel shimmies in my hands on the highway"
  - "Wheel wobbles between 55 and 65, smooths out after that"
  - "Just the steering wheel shaking, the seat feels fine"
  - "Hit a pothole and now the wheel goes into a violent shake at 50 mph — death wobble"
Negative examples:
  - "Whole car vibrates at highway speed, not just the wheel" → vibration/steering_wheel_shake_at_highway_speed
  - "Vibration through the seat and floor at speed" → vibration/steering_wheel_shake_at_highway_speed
  - "Steering wheel shakes only when I press the brakes" → vibration/vibration_or_pulsing_when_braking
  - "Car shakes at idle when stopped" → vibration/shaking_at_idle_while_stopped
  - "Wheel feels loose but doesn't shake" → loose_or_sloppy_steering
Synonyms: steering wheel shake, steering wheel shakes, wheel shimmy, shimmy in the wheel, wheel wobble, wheel wobbles, shaky wheel, wheel vibration at speed, wheel shudders, wheel quivers in my hands, death wobble, highway speed shake, wheel goes into a shake, front-end shimmy, balance shake, wheel weight off

## steering/pulling_drifting_or_wandering_on_the_road
Description: A pulling, drifting, or wandering complaint where the customer's primary framing mixes wheel-feel with car-direction — they describe the car not tracking straight AND the steering wheel feeling involved (drifts, wanders, has to fight the wheel) without cleanly separating the two. Most commonly caused by wheel alignment out of spec, uneven tire pressure or wear, worn tie rods / ball joints / wheel bearings, or a tire defect (conicity). When the customer's complaint is clearly ONLY about the car's directional track (pulls steady to the right, drifts on crowned roads, pulls only when braking) route to the appropriate pulling/* subcategory instead; this steering subcategory is for the broader / wheel-feel-mixed framing. Distinct from pulling/steady_drift_while_cruising (which is a clean directional-only complaint that always pulls one way), pulling/drift_that_follows_the_roads_slope (slope-dependent), pulling/wandering_or_drifting_in_both_directions (clean bi-directional wander complaint), and loose_or_sloppy_steering (where the wheel itself has play but the car tracks straight).
Positive examples:
  - "Car kind of drifts and the wheel feels weird"
  - "Wheel wants to pull to the right and I'm always correcting"
  - "Steering feels off — car wanders and I'm fighting the wheel"
  - "Pulls to one side and the wheel feels loose at the same time"
  - "Something's wrong with the steering — it won't drive straight"
Negative examples:
  - "Pulls steady to the right on every road" → pulling/steady_drift_while_cruising
  - "Only pulls when I brake" → pulling/pulling_only_when_braking
  - "Only pulls when I accelerate" → pulling/pulling_only_during_acceleration
  - "Drifts on crowned roads, straight in parking lots" → pulling/drift_that_follows_the_roads_slope
  - "Car wanders both ways constantly" → pulling/wandering_or_drifting_in_both_directions
  - "Wheel is loose with play but car tracks straight" → loose_or_sloppy_steering
  - "Steering wheel is tilted but car drives straight" → steering_wheel_off_center_when_driving_straight
Synonyms: car drifts, car wanders, won't drive straight, wheel pulls, steering pulls, drifts and wanders, fighting the wheel, can't drive straight, pulls and wanders, steering feels off, drifts to one side, wheel wants to go, won't track straight, hunts back and forth, weaves on the road

## steering/clunking_knocking_or_rough_ride_over_bumps
Description: A clunk, knock, jolt, or harsh impact transmitted up through the steering wheel and front end when the car goes over bumps, potholes, speed bumps, or rough pavement — the driver feels the hit IN THE WHEEL (sometimes as a kickback or shudder) and often describes the ride as "rough" or "jarring" compared to before. Frequently accompanied by continued bouncing after the bump (worn struts/shocks), excessive body lean in corners, or fluid streaks down the strut posts. Most commonly caused by worn struts/shocks, worn strut mounts, worn ball joints, worn tie rod ends, worn sway bar end links, or worn control arm bushings. Distinct from noise/clunking_over_bumps (which is the same family of components but framed as a NOISE the customer HEARS from underneath rather than an IMPACT felt in the wheel — choose this steering subcategory when the customer's primary report is "felt in the wheel" or "rough ride") and from vibration/shaking_or_bouncing_over_bumps_and_rough_roads (which is a whole-car bouncing / oscillation complaint after a bump, not a discrete clunk-felt-in-the-wheel).
Positive examples:
  - "Big clunk through the steering wheel every time I hit a bump"
  - "Wheel kicks back hard when I roll over a pothole"
  - "Front end feels really rough — every bump comes right up through the wheel"
  - "Knocking I can feel in the steering wheel going over speed bumps"
  - "Ride is jarring and I feel the impact in my hands"
Negative examples:
  - "Clunk from underneath I can hear but don't feel in the wheel" → noise/clunking_over_bumps
  - "Whole car bounces three times after every bump" → vibration/shaking_or_bouncing_over_bumps_and_rough_roads
  - "Click only when I turn at parking-lot speed" → noise/popping_or_clicking_when_turning
  - "Squeak going over bumps" → noise/squeaking_or_creaking_over_bumps
  - "Steering wheel shakes at highway speed" → steering_wheel_shakes_at_highway_speed
  - "Wheel feels loose with play" → loose_or_sloppy_steering
Synonyms: clunk through the wheel, clunk in the steering wheel, knock through the steering, felt in the wheel, kickback through the wheel, kickback from bumps, rough ride felt in the wheel, jarring ride, harsh impact through the wheel, wheel kicks over bumps, jolt through the steering, bump steer feeling, worn struts feel, bouncing through the wheel
