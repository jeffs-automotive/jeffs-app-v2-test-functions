# Subcategory Descriptions — vibration

<!--
Wave C3 draft. Authored 2026-05-21.

Sources (customer language and symptom phrasings extracted from these pages):
  - https://nrsbrakes.com/blogs/supporting-articles/diagnosing-warped-rotors-symptoms-and-repair-options
  - https://blog.1aauto.com/steering-wheel-shakes-when-braking/
  - https://www.brakepadboss.com/signs-of-warped-rotors/
  - https://www.thecarbuzz.com/symptoms-of-a-warped-brake-rotor
  - https://www.tiresplus.com/blog/brakes/car-shakes-when-i-brake/
  - https://www.chapelhilltire.com/tire-alignment-issues-vs-warped-brake-rotors
  - https://www.yourmechanic.com/article/how-to-diagnose-a-shaking-steering-wheel-by-timothy-charlet
  - https://www.wheelsetgo.com/blog/why-your-steering-wheel-shakes-after-new-wheels-or-tires-and-how-to-fix-it/
  - https://brianstireandservice.com/why-is-my-car-shaking/
  - https://goodyeartiresandautorepairsantacruz.com/blog/tire-balancing-vibration-causes/
  - https://www.thedrive.com/maintenance-repair/37562/car-vibrates-when-accelerating
  - https://repairpal.com/cv-half-shaft-assembly
  - https://www.gsplatinamerica.com/post/cv-axle-vibrations-acceleration-vs-cruising
  - https://www.mechanicwiz.com/bad-cv-axle-vibration/
  - https://www.yourmechanic.com/article/symptoms-of-a-bad-or-failing-axle-cv-shaft-assembly
  - https://www.tolimas-auto.com/vibrations-while-accelerating-and-worn-cv-axles
  - https://cartreatments.com/car-shakes-accelerating/
  - https://lodishell.net/2026/05/01/bad-cv-axle-signs/
  - https://www.carvira.com/vibrations-during-acceleration-common-causes-and-solutions/
  - https://repairpal.com/symptom/ford/edge/2017/engine-vibrates
  - https://repairpal.com/low-rumbling-sound-when-in-reverse-bad-engine-mounts-598
  - https://www.lesschwab.com/article/shocks-struts/how-to-tell-if-your-shocks-or-struts-are-bad.html
  - https://www.monroe.com/technical-resources/shocks-101/symptoms-worn-shock-struts.html
  - https://www.greatwater360autocare.com/news/signs-of-worn-out-shocks-and-struts
  - https://www.strutmasters.com/a/blog/common-symptoms-of-bad-struts-and-shocks
  - https://www.firestonecompleteautocare.com/blog/alignment/signs-of-bad-shocks-and-struts/
  - https://www.geico.com/living/7-signs-of-worn-shocks-and-struts/
  - https://carsmartautoservice.com/identifying-the-sounds-of-bad-struts-in-your-vehicle/
  - https://automotivetechinfo.com/2015/03/shake-driveline-vibration/
  - https://carinterior.alibaba.com/tips/vibration-troubleshooting

Validation notes:
  - WHAT + WHEN structure visible in every description (WHAT shakes = wheel/whole-car/pedal,
    WHEN = idle / braking / accelerating / bumps / constant / highway-cruise).
  - All 6 subcategories carry at least one explicit "Distinct from <slug>" boundary callout,
    most carry 2-3.
  - The two pair collisions that triggered this category split are explicitly handled:
      * vibration/steering_wheel_shake_at_highway_speed VS
        steering/steering_wheel_shakes_at_highway_speed → vibration-side captures
        "I feel it shaking" (vibration-felt complaint at speed). The steering side captures
        wheel-feel / responsiveness complaints. Boundary language mirrors the steering
        agent's framing.
      * vibration/vibration_or_pulsing_when_braking VS
        brakes/pulsating_or_vibrating_pedal → vibration-side is for whole-car / steering-
        wheel / "the entire car shudders." Brakes-side is for pedal-feel specifically.
        Boundary language mirrors brakes/pulsating_or_vibrating_pedal exactly.
      * vibration/shaking_at_idle_while_stopped VS
        performance/rough_idle_or_shaking_at_a_stop → vibration-side is when the WHOLE
        CAR shakes (engine mount, exhaust hanger, broken accessory). Performance side is
        when the ENGINE itself runs rough / sputters / misfires at idle. Boundary
        language mirrors performance agent's framing.
      * vibration/shaking_or_bouncing_over_bumps_and_rough_roads VS
        noise/clunking_over_bumps VS steering/clunking_knocking_or_rough_ride_over_bumps
        → vibration-side is ride QUALITY (shake, bounce, harshness). Noise-side is
        SOUND-only (clunk, thud). Steering-side is wheel-feel from impacts.
  - Synonyms include the requested anchors (shake, shimmy, vibration, wobble, tremor, buzz,
    humming) plus subcategory-specific colloquialisms.
-->

## vibration/steering_wheel_shake_at_highway_speed
Description: The steering wheel shakes, shimmies, or wobbles in the driver's hands once the car reaches highway speeds — usually starting around 50-65 mph, often peaking in a narrow speed band and easing off above or below it. The customer typically describes feeling the shake THROUGH the wheel (in their hands), and the shake gets progressively worse the longer they drive at that speed. Most often caused by an out-of-balance wheel/tire assembly, a bent rim from pothole damage, separated tire belts, worn wheel bearings, or front suspension wear. Distinct from steering/steering_wheel_shakes_at_highway_speed (which is the same physical event reported as a STEERING / wheel-feel complaint — "the wheel feels loose and wobbly," "I can't keep it steady" — this vibration/ subcategory captures the same shake reported as a VIBRATION the driver feels), and distinct from brakes/pulsating_or_vibrating_pedal (which only happens while braking — this one happens at speed without touching the brake) and from vibration/vibration_or_pulsing_when_braking (which is brake-triggered, not speed-triggered).
Positive examples:
  - "Steering wheel shakes really bad at 65 mph but smooths out if I slow down or speed up"
  - "Bad shimmy through the steering wheel once I hit highway speeds — feels like the front end is dancing"
  - "Car shakes like a washing machine on spin cycle when I'm on the freeway"
  - "Wheel vibrates in my hands from about 55 to 70, then it kind of evens out"
  - "Front end started shimmying at highway speed after I hit that big pothole last week"
  - "Steering wheel wobbles back and forth when I'm cruising — gets worse the faster I go"
Negative examples:
  - "Steering wheel shakes ONLY when I press the brake pedal" → vibration_or_pulsing_when_braking
  - "Whole car shudders when I brake from highway speed" → vibration_or_pulsing_when_braking
  - "Wheel feels loose and sloppy, lots of play before the car turns" → steering/loose_or_sloppy_steering
  - "Car shakes at idle but not at speed" → shaking_at_idle_while_stopped
  - "Vibration only when I'm accelerating hard or going uphill" → shaking_when_speeding_up_or_going_uphill
  - "Constant buzz at any speed — never changes" → constant_vibration_that_doesnt_change_with_speed
Synonyms: shake, shaking, shimmy, shimmying, wobble, wobbling, vibration, vibrates, vibrating, tremor, jitter, dancing wheel, steering wheel shake, wheel shimmy, highway vibration, freeway shake, balance shake, out of balance, wheel hop, front-end shake, washing machine

## vibration/vibration_or_pulsing_when_braking
Description: The WHOLE CAR — or the steering wheel, or the driver's seat — shudders, vibrates, or pulses RHYTHMICALLY when the customer presses the brake pedal, especially when slowing down from highway speed or coming down a long hill. Pulsing typically gets worse the harder the pedal is pressed and may fade or disappear when the car comes to a complete stop. Almost always caused by uneven rotor thickness (warped rotors / DTV), heat-distorted rotors after hard or sustained braking, or uneven pad deposits on the rotor face. Distinct from brakes/pulsating_or_vibrating_pedal (which is the SAME physical event reported as a PEDAL-feel complaint — "the pedal pulses back at my foot." This vibration/ subcategory is for customers who describe the WHOLE-CAR shake, steering-wheel shake, or seat shake during braking rather than the pedal feel). Also distinct from steering_wheel_shake_at_highway_speed (which happens at speed even WITHOUT braking — typically wheel balance) and from shaking_or_bouncing_over_bumps_and_rough_roads (which is bump-triggered, not brake-triggered).
Positive examples:
  - "Whole car shudders when I brake from highway speed — really bad shake"
  - "Steering wheel and the seat both vibrate hard when I press the brakes"
  - "Car shakes like crazy when I slow down from 70 — feels like everything is shaking"
  - "After driving down a mountain pass, the whole car started shaking when I'd brake"
  - "Front end shudders back and forth when I'm coming to a stop"
  - "Seat of my pants is shaking when I brake — like the rotors are warped in the back"
Negative examples:
  - "Pedal itself pulses up and down against my foot" → brakes/pulsating_or_vibrating_pedal
  - "Steering wheel shakes at 65 mph even when I'm not braking" → steering_wheel_shake_at_highway_speed
  - "Whole car bounces over every bump in the road" → shaking_or_bouncing_over_bumps_and_rough_roads
  - "Car shakes only when accelerating" → shaking_when_speeding_up_or_going_uphill
  - "Pulls to one side when I brake" → pulling/pulling_only_when_braking
  - "Grinding noise when I brake but no shake" → brakes/metallic_grinding
Synonyms: shudder, shuddering, shake when braking, vibrate when braking, pulsing when braking, judder, juddering, brake shudder, brake shake, brake shimmy, whole car shake, seat shake, body shake when braking, warped rotor shake, rotor shake, throbbing when braking, rhythmic shake, vibration through the car

## vibration/shaking_at_idle_while_stopped
Description: The WHOLE CAR shakes, trembles, or vibrates while the customer is sitting still — at a red light, stop sign, in the drive-through, or in park — but the shake smooths out once they get moving. Often felt most through the seat, steering wheel, and gear shifter at the same time. Most often caused by broken/collapsed engine mounts (the engine's vibration is no longer absorbed and transfers straight to the body), a broken motor mount on one side, or a loose/broken accessory like a bad cooling fan. Distinct from performance/rough_idle_or_shaking_at_a_stop (which is the SAME timing but reported as an ENGINE-runs-rough complaint — "the engine sputters and the RPM bounces around." This vibration/ subcategory is for customers who say the WHOLE CAR shakes while the engine itself sounds normal, or who specifically suspect motor mounts). Also distinct from constant_vibration_that_doesnt_change_with_speed (which is present at all speeds, not just at idle).
Positive examples:
  - "Whole car shakes really bad when I'm sitting at a red light, smooths out as soon as I drive"
  - "Car vibrates badly in drive at stop signs but if I shift to neutral it gets much better"
  - "Feels like the engine is going to jump out of the car when I'm idling — I think it's the motor mounts"
  - "Body shake at idle — seat, wheel, and shifter all shaking together"
  - "Sitting still in park the car trembles all over — engine doesn't sound rough though"
  - "Whole car shudders when I'm stopped, especially when the AC kicks on"
Negative examples:
  - "Engine sounds rough and sputters at idle, RPM bounces around" → performance/rough_idle_or_shaking_at_a_stop
  - "Engine actually dies when I come to a stop" → performance/stalling_at_idle_or_when_stopping
  - "Steering wheel shakes at highway speed" → steering_wheel_shake_at_highway_speed
  - "Constant vibration at every speed including driving" → constant_vibration_that_doesnt_change_with_speed
  - "Car shakes only when I'm accelerating" → shaking_when_speeding_up_or_going_uphill
  - "Whole car shudders when I brake" → vibration_or_pulsing_when_braking
Synonyms: shake at idle, shaking at idle, shake at stop, idle shake, idle vibration, vibrates at idle, engine mount shake, motor mount shake, broken engine mount, broken motor mount, car shudders at stop, trembles at idle, jumps at idle, car shakes at red light, whole car shake idle, body shake at stop, tremor at idle, vibrates in drive

## vibration/shaking_when_speeding_up_or_going_uphill
Description: The car shakes, shudders, or vibrates ONLY when the customer presses the gas pedal — most noticeable under heavy load like passing on the highway, merging from a stop, or climbing a hill — and the shake fades or disappears as soon as they let off the throttle and coast. Typically felt through the floor, seat, and sometimes the steering wheel. Tied to engine RPM and torque load rather than vehicle speed. Most often caused by a worn or torn-boot CV axle (especially the inner joint), a damaged driveshaft or U-joint, broken motor/transmission mounts that let the powertrain twist under torque, or a slipping torque converter. Distinct from steering_wheel_shake_at_highway_speed (which is tied to ROAD SPEED and happens even when coasting — this one is tied to ENGINE LOAD and goes away the moment you lift off the gas) and from constant_vibration_that_doesnt_change_with_speed (which never changes regardless of throttle input).
Positive examples:
  - "Car shakes when I'm accelerating hard, especially going uphill — fine when I coast"
  - "Vibrates like crazy when I push the gas to pass someone, smooths out when I let off"
  - "Feels like driving on rumble strips when I'm climbing a hill or pulling onto the freeway"
  - "Shudders under acceleration but stops the second I take my foot off the gas"
  - "Bad shake from the floor when I floor it — could be a CV axle, there's grease on the inside of my tire"
  - "Whole car shudders when the transmission is working hard on hills"
Negative examples:
  - "Steering wheel shakes at 65 mph even when I'm coasting" → steering_wheel_shake_at_highway_speed
  - "Car shakes when I brake from highway speed" → vibration_or_pulsing_when_braking
  - "Shake at idle when I'm stopped" → shaking_at_idle_while_stopped
  - "Clicking noise only when I turn the steering wheel sharp" → noise/popping_or_clicking_when_turning
  - "Engine bucks and jerks like it's misfiring when I accelerate" → performance/engine_misfire_or_bucking_feeling
  - "Just feels like the car has no power when I press the gas" → performance/low_power_or_wont_accelerate_normally
Synonyms: shakes when accelerating, vibration under acceleration, acceleration shake, shake on hills, shake going uphill, rumble strip feeling, CV axle vibration, driveshaft vibration, U-joint shake, torque-load shake, throttle-on vibration, shakes under load, shudders under power, shake when passing, accelerator vibration, shake under throttle

## vibration/shaking_or_bouncing_over_bumps_and_rough_roads
Description: The car shakes, bounces, jolts, or rides harshly when the customer goes over bumps, potholes, expansion joints, speed bumps, or rough/uneven pavement — and the ride feels much rougher than it used to. After a single bump, the car may keep bouncing two, three, or four times instead of settling once. Often paired with poor handling, body roll in turns, nose-dive when braking, or the front end "diving down." Most often caused by worn-out shocks/struts, broken coil springs, blown strut mounts, or worn suspension bushings. Distinct from noise/clunking_over_bumps (which is the SAME trigger reported as a SOUND complaint — a hard metallic thud/clunk over bumps — this vibration/ subcategory is for customers describing RIDE QUALITY: the shake, bounce, harshness, or roughness, not the noise) and from steering/clunking_knocking_or_rough_ride_over_bumps (which is bump-feel transmitted through the STEERING WHEEL — this one is felt through the whole body / seat / chassis). Also distinct from constant_vibration_that_doesnt_change_with_speed (which is there even on smooth pavement).
Positive examples:
  - "Car bounces three or four times after every bump instead of settling — ride feels really rough"
  - "Every pothole feels like it's going through the whole car — really jarring"
  - "Ride is way harsher than it used to be, even small bumps shake the whole car"
  - "Front end keeps bouncing forever after I hit a bump — shocks have to be done"
  - "Car feels really jittery and bouncy on rough roads, like the suspension isn't doing anything"
  - "Hits every bump hard now and the back end is jumping around"
Negative examples:
  - "Hard metallic clunk over bumps but the ride itself feels okay" → noise/clunking_over_bumps
  - "Clunking and rough ride over bumps, also feels it in the steering wheel" → steering/clunking_knocking_or_rough_ride_over_bumps
  - "Squeak or creak when I roll over bumps" → noise/squeaking_or_creaking_over_bumps
  - "Steering wheel shakes at highway speed on smooth pavement" → steering_wheel_shake_at_highway_speed
  - "Constant vibration even on perfectly smooth road" → constant_vibration_that_doesnt_change_with_speed
  - "Whole car shakes when I brake" → vibration_or_pulsing_when_braking
Synonyms: bouncy, bounces, bouncing, bouncing over bumps, rough ride, harsh ride, jarring, jolts, jolty, jittery, shakes over bumps, suspension shake, suspension bounce, no damping, bouncing after bump, bottom out, bottoming out, front-end dive, nose dive, ride feels rough, ride quality bad, springy suspension, pogo-stick feeling

## vibration/constant_vibration_that_doesnt_change_with_speed
Description: A steady, constant vibration, hum, or buzz that the customer feels at ALL speeds — parking-lot crawl, city driving, and highway cruise alike — and that does NOT change pitch or intensity with road speed, engine RPM, braking, or accelerating. Often described as feeling it through the floor or the seat as much as the steering wheel, like a constant low-frequency tremor humming through the body of the car. Less common than the speed-dependent / brake-triggered / acceleration-triggered shakes; usually caused by a broken driveshaft center support bearing, a bent wheel that's bad enough to vibrate at every speed, a thrown wheel weight, a tire with a thrown belt or internal damage from a patch/plug going wrong, or a failed accessory pulley creating a continuous imbalance. Distinct from steering_wheel_shake_at_highway_speed (which has a clear onset speed and goes away outside the band), from shaking_at_idle_while_stopped (which goes away once driving), and from shaking_when_speeding_up_or_going_uphill (which goes away when coasting). The defining feature here is "it's there all the time, doesn't matter what I'm doing."
Positive examples:
  - "There's a constant vibration through the floor no matter how fast or slow I'm going"
  - "Car has a steady hum and shake at 25 mph, 45 mph, 65 mph — same the whole time"
  - "Always feels like something is loose or out of round — never stops vibrating"
  - "Buzz through the seat at every speed, even crawling through a parking lot"
  - "Tremor through the whole car that's there from the moment I start driving until I stop"
  - "Vibration doesn't get worse with speed or braking — just constantly there"
Negative examples:
  - "Shake only at 60 mph, goes away below 50 or above 70" → steering_wheel_shake_at_highway_speed
  - "Vibration only when I press the brake pedal" → vibration_or_pulsing_when_braking
  - "Only shakes when I accelerate" → shaking_when_speeding_up_or_going_uphill
  - "Only shakes when I'm stopped at a light" → shaking_at_idle_while_stopped
  - "Shakes over every bump and pothole" → shaking_or_bouncing_over_bumps_and_rough_roads
  - "Humming wheel bearing noise that gets louder with speed" → noise/humming_or_whirring_at_speed
Synonyms: constant vibration, steady vibration, always vibrating, vibrating all the time, vibration at every speed, continuous shake, constant tremor, steady hum, steady buzz, low-frequency vibration, hum through the floor, vibration that doesn't change, non-speed-dependent vibration, droning vibration, persistent vibration, vibration everywhere, always shaking, doesn't matter the speed
