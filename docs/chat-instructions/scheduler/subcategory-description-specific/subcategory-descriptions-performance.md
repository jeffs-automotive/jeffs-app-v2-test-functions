# Subcategory Descriptions — performance

<!--
Wave B2 draft. Authored 2026-05-21. 9 subcategories.

Sources (customer language and symptom phrasings extracted from these pages):
  - https://repairpal.com/hesitation-when-accelerating-794
  - https://repairpal.com/symptoms/car-wont-accelerate
  - https://oards.com/causes-of-car-engine-hesitation/
  - https://allaroundautorepair.com/why-your-gas-pedal-feels-laggy-even-without-a-check-engine-light/
  - https://www.lincoln-repair.com/how-to-diagnose-and-fix-a-car-that-hesitates-while-accelerating/
  - https://mechanicsdiary.com/car-hesitates-when-accelerating/
  - https://cartreatments.com/car-hesitates-when-accelerating/
  - https://issautomotive.com/blogs/throttle-response-controller/car-feels-sluggish-when-accelerating
  - https://ricksautomotive.com/blog/shaky-idle-your-engine-might-be-telling-you-something/
  - https://napacarcare.com/auto-repair-tips/why-is-my-car-shaking-at-a-stoplight-when-idle/
  - https://www.autobarn.net/symptoms/engine-shaking-at-idle
  - https://www.danabros.com/blog/6-causes-of-rough-idle-you-shouldnt-ignore
  - https://millerautopartsandpaint.com/how-to-diagnose-and-fix-a-rough-idle/
  - https://www.thecarbuzz.com/car-stalling-while-driving/
  - https://reviewfriendly.com/car-engine-stalling-while-driving/
  - https://www.carparts.com/blog/car-shuts-off-while-driving-causes-what-to-do/
  - https://mechanicbase.com/driving/car-shuts-off-while-driving/
  - https://themotorguy.com/7-reasons-a-car-dies-while-driving/
  - https://www.justanswer.com/nissan/corkn-engine-stalls-sometimes-i-m-waiting-red-lights.html
  - https://www.gmt400.com/threads/truck-stalls-at-stop-signs-and-red-lights.61883/
  - https://pedalcommander.com/blogs/garage/how-to-diagnose-sudden-power-loss-while-driving
  - https://timsquality.com/car-dies-while-driving-and-lost-power-steering/
  - https://oards.com/car-hard-to-start-cold/
  - https://www.tiresplus.com/blog/maintenance/car-wont-start-cold-weather/
  - https://www.crvownersclub.com/threads/2000-hard-to-start-when-cold-sitting-over-night.214331/
  - https://forums.aaca.org/topic/275091-difficult-to-start-cold-engine-or-one-sitting-overnight/
  - https://www.lancerservice.com/car-wont-start-in-cold-but-battery-good
  - https://www.yotatech.com/forums/f116/easy-cold-start-but-hard-start-after-sitting-several-hours-304347/
  - https://excessinjectors.com/blogs/news/why-your-car-struggles-to-start-hot
  - https://www.carparts.com/blog/vapor-lock-symptoms-causes-and-solutions/
  - https://fleetrabbit.com/blogs/post/vapor-lock-symptoms-in-older-cars-causes-and-fixes
  - https://mechlesson.com/vapor-lock/
  - https://mechanicbase.com/engine/limp-mode/
  - https://www.zeroto60times.com/articles/what-is-limp-mode-reduced-engine-power-and-how-to-fix-it/
  - https://www.kbb.com/car-advice/limp-mode/
  - https://oards.com/car-loses-power-when-accelerating/
  - https://www.cbac.com/media-center/blog/2025/may/what-causes-car-engine-surges-/
  - https://vehicleruns.com/troubleshooting/engine-surges-idle/
  - https://autoveteran.tech/blog/details/294/why-does-my-car-s-rpm-go-up-and-down-at-idle-causes-and-solutions/
  - https://engineerfix.com/what-causes-idle-surge-and-how-to-fix-it/
  - https://themotorguy.com/engine-surges-at-idle-causes-fixes-costs/
  - https://cartreatments.com/engine-misfire-symptoms/
  - https://inamotors.com/engine-misfire-symptoms/
  - https://mechanicsdiary.com/engine-misfire-causes-and-symptoms/
  - https://www.firestonecompleteautocare.com/blog/maintenance/engine-misfiring/
  - https://www.williamwellstireandautorepair.com/what-does-it-mean-when-your-car-jerks-when-accelerating

Validation notes:
  - All 9 subcategories carry at least one explicit "Distinct from <slug>" callout in
    the description.
  - CONDITIONS are embedded in every description and at least one positive example:
    cold-start vs hot-start pair both put TEMPERATURE TRIGGER in description + positive
    examples. Stalling pair both put IDLE vs DRIVING in description + positive examples.
  - rough_idle_or_shaking_at_a_stop description explicitly says "engine running rough"
    and points at vibration/shaking_at_idle_while_stopped (whole-car shake) in negative
    examples per the validation requirement.
  - Surging vs misfire boundary handled per cbac.com / vehicleruns.com guidance: smooth
    oscillation (surging) vs jerky bucking (misfire).
  - Cross-category negatives included for electrical/wont_crank_just_clicks vs the
    hard_to_start pair (different engine state — cranking vs not cranking).
  - Synonyms span casual ("bogs down", "won't go", "shuts off"), neutral ("hesitates",
    "stalls", "surges"), and semi-technical ("idle hunting", "vapor lock", "limp mode",
    "heat soak").
-->

## performance/hesitation_or_lag_when_accelerating
Description: A momentary pause, stumble, or delay between when the driver presses the gas pedal and when the engine responds — feels like the car "hiccups" or briefly holds back before catching and pulling normally. Usually short (a second or two) and most noticeable when first stepping on the gas from a stop, while merging, or while passing. Common causes are dirty mass airflow sensor, weak ignition, vacuum leak, or transmission shift delay. Distinct from low_power_or_wont_accelerate_normally (which is SUSTAINED weakness, not a momentary pause) and from engine_misfire_or_bucking_feeling (which is jerky/bucking with skip-a-beat feel, not a smooth delay).
Positive examples:
  - "When I push the gas, there's a delay before the car actually goes"
  - "The car hesitates for a second when I step on it to merge onto the highway"
  - "Feels like a little hiccup right when I take off from a stop sign"
  - "Pedal feels laggy — I press it and the engine takes a moment to wake up"
  - "Briefly bogs down when I floor it, then catches up and goes normally"
Negative examples:
  - "Car has no power at all and won't pick up speed even pedal to the floor" → low_power_or_wont_accelerate_normally
  - "Engine bucks and jerks like it's skipping a beat when I accelerate" → engine_misfire_or_bucking_feeling
  - "RPMs go up and down on their own while I'm cruising" → surging_or_rpms_going_up_and_down
  - "Engine dies when I come to a stop" → stalling_at_idle_or_when_stopping
Synonyms: hesitates, hesitation, stumble, stumbles, lag, laggy, delay, hiccup, hiccups, pause, pauses, bogs down briefly, takes a second, slow to respond, throttle lag, accelerator lag, gas pedal delay, sluggish off the line

## performance/rough_idle_or_shaking_at_a_stop
Description: The ENGINE is running rough or uneven while the car is stopped at a light, in park, or in drive with foot on brake — RPM needle bounces or sits unusually low/high, the engine note sounds choppy or sputtering, and the customer feels shudder through the steering wheel or seat that smooths out once they start moving. Often tied to misfiring spark plugs, vacuum leak, dirty fuel injectors, or carbon-fouled throttle body. Distinct from vibration/shaking_at_idle_while_stopped (which is the WHOLE CAR shaking with the engine itself sounding fine — usually broken engine mounts or accessory issue) and from stalling_at_idle_or_when_stopping (which is the engine actually dying, not just running rough).
Positive examples:
  - "Engine shakes and runs rough every time I'm stopped at a red light"
  - "Car sputters and the RPM bounces around when I'm sitting still in park"
  - "Idles really rough — sounds like it's struggling and the steering wheel trembles"
  - "Engine sounds choppy and uneven at stoplights but smooths out when I drive"
  - "RPM needle dances up and down and the car feels jittery when I'm stopped"
Negative examples:
  - "Whole car shakes at idle but the engine sounds normal" → vibration/shaking_at_idle_while_stopped
  - "Engine completely dies when I come to a stop" → stalling_at_idle_or_when_stopping
  - "RPMs surge up and down on their own without me touching the pedal" → surging_or_rpms_going_up_and_down
  - "Engine shakes only when I accelerate, not at idle" → engine_misfire_or_bucking_feeling
  - "Steering wheel shakes at highway speed" → vibration/steering_wheel_shake_at_highway_speed
Synonyms: rough idle, shaky idle, lopey idle, choppy idle, sputtering idle, engine shudders at stop, engine vibrates at stoplight, uneven idle, unstable idle, RPM bouncing at idle, engine misses at idle, engine runs rough in park

## performance/stalling_at_idle_or_when_stopping
Description: The engine completely dies (shuts off) when the car comes to a stop or is sitting still at idle — at a red light, stop sign, drive-through, or right as the customer pulls into a parking spot. Usually the engine restarts on the next crank, sometimes immediately, sometimes after a wait. Common causes are bad idle air control valve, vacuum leak, dirty throttle body, failing fuel pump, or faulty crankshaft sensor. Distinct from stalling_while_driving_under_load (which is the engine dying WHILE MOVING — at highway speed, on a hill, or under acceleration) and from rough_idle_or_shaking_at_a_stop (which is rough running but the engine stays alive).
Positive examples:
  - "Engine dies every time I come to a stop at a red light"
  - "Car shuts off when I'm sitting at the drive-through but it starts right back up"
  - "Stalls out right as I pull up to a stop sign"
  - "Engine just turns off when I'm idling — happens more when the AC is on"
  - "Whenever I come to a stop the car wants to die, especially when it's hot outside"
Negative examples:
  - "Engine cuts out while I'm driving on the highway" → stalling_while_driving_under_load
  - "Engine shakes at idle but doesn't actually die" → rough_idle_or_shaking_at_a_stop
  - "Car cranks and cranks but won't start in the morning" → hard_to_start_when_cold
  - "Won't even crank — just a click when I turn the key" → electrical/wont_crank_just_clicks
Synonyms: stalls at idle, dies at red light, shuts off at stop, engine quits at stop, dies coming to a stop, conks out at idle, stalls in drive-through, engine cuts out at idle, idle stall, killed at stop sign

## performance/stalling_while_driving_under_load
Description: The engine dies WHILE THE CAR IS MOVING — at highway speed, while climbing a hill, while accelerating, or in stop-and-go traffic — typically with the steering and brakes suddenly going heavy because the engine has shut off. The car may sputter and lose power first or just cut out with no warning. Common causes are failing fuel pump, crankshaft position sensor failure, alternator failure, ignition coil/module failure, or clogged catalytic converter. Distinct from stalling_at_idle_or_when_stopping (which only happens when the car is already stopped or about to stop) and from low_power_or_wont_accelerate_normally (where the car keeps running but feels weak).
Positive examples:
  - "Was driving on the highway and the engine just shut off — had to coast to the shoulder"
  - "Car cut out going uphill and I lost power steering"
  - "Engine dies while I'm driving, then I have to pull over and wait to restart it"
  - "Sputtered for a second and then just quit on me at 55 mph"
  - "Stalled out under acceleration on the on-ramp"
Negative examples:
  - "Engine dies only when I come to a stop at lights" → stalling_at_idle_or_when_stopping
  - "Car loses power on hills but keeps running" → low_power_or_wont_accelerate_normally
  - "Engine bucks and jerks but doesn't actually die" → engine_misfire_or_bucking_feeling
  - "Cranks but won't start when I try to leave in the morning" → hard_to_start_when_cold
Synonyms: stalls while driving, dies on highway, engine cuts out, shuts off while driving, lost power suddenly, car died at speed, conked out, quit while moving, engine quit, suddenly stalled, stalled under load, died on the freeway

## performance/hard_to_start_when_cold
Description: After the car has SAT FOR HOURS (typically overnight or longer) so the engine is fully cold, the engine cranks (starter spins and you hear it turning over) but takes many seconds to fire — sometimes requires multiple attempts. May run rough for the first minute before smoothing out. Trigger is COLD ENGINE — the car starts fine later in the day once it's warmed up. Common causes are weak battery losing capacity in cold weather, bad cold-start injector, leaking fuel pressure overnight, failing coolant temperature sensor, or worn spark plugs. Distinct from hard_to_start_when_hot (opposite trigger — happens AFTER driving when engine is hot) and from electrical/wont_crank_just_clicks (where the starter doesn't spin at all — just a click).
Positive examples:
  - "Cranks forever in the morning before it finally fires up, but starts fine once it's warmed up"
  - "Takes 5-6 seconds of cranking to start when it's been sitting overnight"
  - "Hard to start first thing in the morning, especially when it's cold outside"
  - "Engine has to crank a long time after sitting all night, then runs rough for the first minute"
  - "Won't catch on the first try when it's cold — have to crank it again"
Negative examples:
  - "Hard to start right after I drove it and parked for 10 minutes" → hard_to_start_when_hot
  - "Won't crank at all — just makes a clicking sound" → electrical/wont_crank_just_clicks
  - "Cranks slow and sounds weak when I turn the key" → electrical/slow_crank_sluggish_start
  - "Starts fine but idles rough for a few minutes" → rough_idle_or_shaking_at_a_stop
Synonyms: hard cold start, won't start in the morning, slow to start when cold, takes forever to start cold, cranks but won't fire when cold, cold start problem, hard start after sitting, won't fire up overnight, sluggish cold start, no-start when cold

## performance/hard_to_start_when_hot
Description: The car cranks but is difficult to start RIGHT AFTER DRIVING — typically after a short stop like a gas station, drive-through, or quick errand — when the engine is fully warmed up and sitting in its own heat. The starter spins fine, but the engine takes many seconds (or multiple attempts) to catch and run. Often comes back to normal after the car sits and cools for 20-30 minutes. Common causes are vapor lock / heat soak (fuel boiling in lines near hot exhaust), failing crankshaft position sensor, failing fuel pressure regulator, leaking injector, or weak ignition coil that breaks down with heat. Distinct from hard_to_start_when_cold (opposite trigger — happens only after sitting overnight when engine is fully cold) and from stalling_while_driving_under_load (where the car dies during operation, not on a restart attempt).
Positive examples:
  - "Won't start back up when I stop for gas — cranks and cranks but won't fire"
  - "Hard to restart after driving in hot weather, but starts fine the next morning"
  - "After a 30-minute drive it's hard to get going again when I stop somewhere quick"
  - "Cranks fine but takes forever to actually catch when the engine is hot"
  - "Have to hold the gas down to get it to start after driving in summer traffic"
Negative examples:
  - "Hard to start in the morning after sitting overnight" → hard_to_start_when_cold
  - "Engine dies while driving, not when starting" → stalling_while_driving_under_load
  - "Cranks slow when I turn the key" → electrical/slow_crank_sluggish_start
  - "Won't crank at all" → electrical/wont_crank_just_clicks
Synonyms: hard hot start, won't start when hot, vapor lock, heat soak, hard restart after driving, hot-start problem, won't fire when hot, cranks but won't start hot, no-start when warm, hard to start at gas station

## performance/low_power_or_wont_accelerate_normally
Description: SUSTAINED loss of power — the car feels weak, dragging, like the parking brake is on, or like the engine "isn't all there." Pressing the gas pedal harder doesn't help; the car barely picks up speed, struggles on hills, or won't go past a certain RPM or MPH. Often paired with a sudden drop in gas mileage. Can be triggered by limp mode (computer-limited safe state), clogged catalytic converter, failing fuel pump, bad mass airflow sensor, or transmission slipping (engine revs without speed). Distinct from hesitation_or_lag_when_accelerating (which is a MOMENTARY pause, not constant weakness) and from stalling_while_driving_under_load (where the engine actually dies rather than just feeling weak).
Positive examples:
  - "Car has no power — feels like the emergency brake is on even with my foot to the floor"
  - "Engine revs high but the car barely picks up speed, especially on hills"
  - "Feels weak and dragging — can't get above 45 mph anymore"
  - "Like it's stuck in limp mode — won't accelerate past 3,000 RPM"
  - "Lost a lot of power and my gas mileage tanked at the same time"
Negative examples:
  - "Car hesitates for a second when I press the gas, then catches up" → hesitation_or_lag_when_accelerating
  - "Engine bucks and jerks during acceleration" → engine_misfire_or_bucking_feeling
  - "Engine just shut off while I was driving" → stalling_while_driving_under_load
  - "RPMs surge up and down on their own" → surging_or_rpms_going_up_and_down
Synonyms: no power, low power, no acceleration, feels weak, drags, dragging, sluggish, won't pick up speed, won't accelerate, feels held back, limp mode, reduced engine power, stuck in gear, engine revs but car doesn't move, like emergency brake is on, bogged down, weak engine

## performance/surging_or_rpms_going_up_and_down
Description: The engine RPM rises and falls on its own in a smooth, oscillating pattern WITHOUT the driver touching the gas pedal — most noticeable at idle (RPM needle visibly bouncing up and down) or while trying to cruise at a steady speed (car wants to lurch forward and pull back). The customer's foot stays in the same place but the engine doesn't. Common causes are vacuum leak, dirty idle air control valve, failing throttle position sensor, bad MAF sensor, or fuel pressure problem causing the computer to constantly over-correct. Distinct from engine_misfire_or_bucking_feeling (which is JERKY/BUCKING and rough, not smooth oscillation) and from rough_idle_or_shaking_at_a_stop (which is general roughness without the up-down RPM cycling).
Positive examples:
  - "RPMs go up and down on their own when I'm sitting at a red light"
  - "Car surges forward and back at a steady cruising speed without me touching the pedal"
  - "Engine keeps revving itself — RPM needle swings between 800 and 1500 in park"
  - "Feels like the car is hunting for the right idle speed"
  - "Lurches forward at low speeds even when my foot is off the gas"
Negative examples:
  - "Engine bucks and jerks like it's misfiring" → engine_misfire_or_bucking_feeling
  - "Engine shakes and runs rough at idle but RPMs are steady" → rough_idle_or_shaking_at_a_stop
  - "Pedal goes lifeless and car feels weak when I accelerate" → low_power_or_wont_accelerate_normally
  - "Engine dies at stoplights" → stalling_at_idle_or_when_stopping
Synonyms: surging, surges, idle surge, RPM surge, RPM hunting, idle hunting, RPMs bouncing, RPMs swinging, engine races on its own, engine fluctuates, oscillating idle, unstable RPM, revs up and down, throttle ghosting, lurching at low speed

## performance/engine_misfire_or_bucking_feeling
Description: A JERKY, BUCKING, KICKING, or "skip-a-beat" feeling from the engine — the car jerks forward then catches, jerks again then catches, like it's skipping or stuttering. Most noticeable under acceleration, climbing hills, in wet weather, or at certain RPMs. Often paired with check engine light (flashing CEL = serious — pull over). Caused when one or more cylinders fail to fire properly: bad spark plug, failing ignition coil, leaking injector, low compression, or vacuum leak on a specific cylinder. Distinct from hesitation_or_lag_when_accelerating (which is a SMOOTH momentary pause, not repeated jerks) and from surging_or_rpms_going_up_and_down (which is smooth RPM oscillation, not violent jerking).
Positive examples:
  - "Engine bucks and jerks when I press the gas — feels like it's kicking the car"
  - "Car is misfiring — I can feel it skipping a beat at highway speed"
  - "Stutters and stumbles under acceleration like it's running on 3 cylinders"
  - "Check engine light is flashing and the car jerks every few seconds"
  - "Feels like the car keeps trying to stall but catches itself — bucks really hard"
Negative examples:
  - "Brief delay when I press the gas, then it goes normally" → hesitation_or_lag_when_accelerating
  - "RPMs smoothly go up and down on their own" → surging_or_rpms_going_up_and_down
  - "Car just feels weak and won't pick up speed" → low_power_or_wont_accelerate_normally
  - "Engine shakes only at idle, not while driving" → rough_idle_or_shaking_at_a_stop
  - "Engine completely shut off while driving" → stalling_while_driving_under_load
Synonyms: misfire, misfires, misfiring, bucking, bucks, jerking, jerks, kicking, kicks, stumbling, stumbles, skipping, skips, skip-a-beat, sputters under load, jerks under acceleration, cylinder misfire, running on 3 cylinders, engine kicking, jerks when I floor it, popping under acceleration
