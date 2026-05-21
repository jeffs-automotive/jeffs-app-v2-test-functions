# Subcategory Descriptions

<!--
Authored 2026-05-21 via 14 parallel Opus 4.7 research agents, one per concern
category. Each agent researched real customer language (Reddit r/MechanicAdvice,
RepairPal, AutoZone, AAA, NHTSA complaints, OEM owner forums) before drafting.
Self-validated against critical cross-category collision pairs.

This file consolidates the 14 per-category drafts at:
  docs/chat-instructions/scheduler/templates/subcategory-descriptions-CATEGORY.md

Total: 105 subcategories across 14 categories. Each block has:
- Description (50-1000 chars) - 2-3 sentence customer-perspective explanation
  with at least one "Distinct from OTHER_SLUG" boundary callout
- Positive examples (3-7) - verbatim customer-style phrasings that SHOULD match
- Negative examples (1-7) - boundary phrasings that should NOT match this slug,
  each with arrow OTHER_SLUG routing annotation
- Synonyms (5-20) - alt customer phrasings spanning casual to technical

Format note: heading is composite category/subcategory_slug, matches the upload
tool's parser. Negative-example arrow annotations are advisor-side only -
the parser strips them before storage.

Upload via Claude Desktop: ask the orchestrator MCP "upload subcategory
descriptions" - it will use upload_subcategory_descriptions_md (two-step
dry-run-then-confirm flow).

When the diagnostic LLM (Anthropic Claude Haiku 4.5) reads this catalog,
it picks ONE subcategory whose description + examples best fit the customer's
verbatim concern text. Haiku has less reasoning capacity than Opus and
relies on rich, concrete descriptions + explicit boundary callouts to
discriminate between adjacent subcategories. Every "Distinct from X" sentence
in a description is load-bearing.
-->

## brakes/high_pitched_squealing
Description: A high-pitched squeal, squeak, screech, or chirp coming from one or more wheels when the customer applies the brakes, releases them, or sometimes just rolls along with the pedal lightly resting. The noise is typically continuous and sharp — like fingernails on a chalkboard or a tea kettle — and most often signals worn brake pads where the metal wear-indicator tab is now contacting the rotor, glazed pads, or surface contamination after the car sat overnight in rain or humidity. Distinct from metallic_grinding (which is harsher, deeper, metal-on-metal and indicates pads are completely worn through) and from noise/squeaking_or_creaking_over_bumps (which is suspension-related and happens going over bumps, not when braking).
Positive examples:
  - "My brakes squeal every time I come to a stop"
  - "There's a really high-pitched squeak from the front wheels when I slow down"
  - "Screeching noise when I press the brake pedal, especially at low speeds"
  - "Annoying chirping sound from the brakes — sounds like a bird"
  - "Brakes squeal when I let off the pedal, goes away when I press harder"
  - "High pitch whistle from the wheels when I'm braking"
Negative examples:
  - ""Grinding or scraping like metal on metal when I brake" → metallic_grinding"
  - ""Squeaking sound when I go over bumps in the road" → noise/squeaking_or_creaking_over_bumps"
  - ""Whining noise from under the hood, not the wheels" → noise/high_pitched_whining_under_the_hood"
  - ""Squealing only when I turn the steering wheel, not when braking" → steering/noise_when_turning_the_steering_wheel"
Synonyms: squeal, squeaking, squeaky brakes, screech, screeching, screaming brakes, chirping, whistle, high-pitched brake noise, brake whine, brakes squeak, brake squealing, pad wear indicator, brake noise

## brakes/metallic_grinding
Description: A harsh, low-pitched metal-on-metal grinding, scraping, or growling noise from one or more wheels when the brake pedal is pressed — sometimes felt as a vibration through the pedal or floorboard. This almost always means the brake pads have worn completely through the friction material and the bare metal backing plate is now scraping against the rotor; it can also be caused by a rock or debris lodged in the caliper, or a severely seized caliper. Customers often describe it as "sounds like metal grinding on metal," "scraping," "like something is dragging," or "a gritty growl." Distinct from high_pitched_squealing (which is a sharper, higher-frequency warning sound that comes BEFORE grinding stage) and from noise/humming_or_whirring_at_speed (which is wheel-bearing noise present even when not braking).
Positive examples:
  - "Loud grinding noise every time I push the brake pedal"
  - "Sounds like metal scraping on metal when I slow down"
  - "Awful grinding from the front of the car when I brake, getting worse"
  - "Brakes sound like there's gravel or something stuck in them"
  - "Harsh grinding noise when braking — feel it through the floor"
  - "It's grinding really bad now, started as a squeak a few weeks ago"
Negative examples:
  - ""High-pitched squealing when I brake, not really grinding" → high_pitched_squealing"
  - ""Grinding noise even when I'm not pressing the brakes" → noise/humming_or_whirring_at_speed"
  - ""Grinding sound only when turning, not braking" → noise/popping_or_clicking_when_turning"
  - ""Pedal vibrates and shakes when I brake, no grinding" → pulsating_or_vibrating_pedal"
Synonyms: grinding, grind, metal grinding, metal on metal, metal-on-metal, scraping, scrape, gritty noise, growling, growl, gnashing, brake grinding, rotor scrape, rotor on metal, worn pads scraping

## brakes/spongy_or_soft_pedal
Description: The brake pedal feels soft, mushy, squishy, or spongy when the customer presses it — like stepping on a marshmallow, sponge, or wet cake — with little or no firm resistance. The customer often has to push the pedal farther down than usual, or pump it a few times, before the brakes really grab. Most commonly caused by air in the brake lines, a brake fluid leak, deteriorated rubber brake hoses bulging under pressure, or contaminated/boiling brake fluid. Distinct from pedal_sinks_to_floor (where the pedal continues to drop toward the floor under steady foot pressure — typically a master cylinder bypass) and from hard_or_unresponsive_pedal (which is the opposite — stiff and won't depress).
Positive examples:
  - "Brake pedal feels really soft and mushy"
  - "The pedal feels spongy when I press it, like there's no resistance"
  - "I have to pump the brakes a few times before they really work"
  - "Brakes feel squishy, kind of like stepping on a sponge"
  - "Pedal goes down farther than it used to before the car starts slowing"
  - "Brake pedal feels low and squishy compared to normal"
Negative examples:
  - ""Pedal slowly sinks all the way to the floor when I hold pressure" → pedal_sinks_to_floor"
  - ""Pedal is really stiff and hard to push down" → hard_or_unresponsive_pedal"
  - ""Pedal pulsates and vibrates when I brake hard" → pulsating_or_vibrating_pedal"
  - ""Brake warning light is on but pedal feels fine" → warning_light/brake_system_red_light"
Synonyms: spongy, soft, mushy, squishy, soft pedal, spongy pedal, mushy pedal, low pedal, pumping brakes, pump the brakes, soft brakes, weak pedal, brakes feel weird, air in brake lines, brake fluid leak, soggy pedal

## brakes/pedal_sinks_to_floor
Description: When the customer presses the brake pedal and holds steady foot pressure, the pedal slowly sinks or creeps toward the floor — especially noticeable while stopped at a red light or stop sign — even though they aren't pressing any harder. In severe cases the pedal goes straight to the floorboard on first press. This is almost always a master cylinder internal bypass (worn internal seals letting fluid leak past instead of building pressure) or a hydraulic leak somewhere in the system. Distinct from spongy_or_soft_pedal (where the pedal feels soft but doesn't continuously sink under steady pressure) and from hard_or_unresponsive_pedal (which is the stiff/won't-move opposite symptom).
Positive examples:
  - "Brake pedal sinks all the way to the floor when I hold it at a red light"
  - "Pedal slowly drops to the floor even though I'm not pressing harder"
  - "If I sit at a stop, the pedal just keeps creeping down toward the carpet"
  - "Brake pedal goes straight to the floorboard, almost no resistance"
  - "I have to keep adjusting my foot because the pedal sinks while I'm stopped"
  - "Pedal pumps up when I tap it but then drops again if I hold it"
Negative examples:
  - ""Pedal feels spongy and soft but doesn't keep sinking" → spongy_or_soft_pedal"
  - ""Pedal is rock hard, won't go down at all" → hard_or_unresponsive_pedal"
  - ""Brake fluid is leaking onto my driveway" → leak/clear_yellow_or_light_brown_puddle_brake_fluid"
  - ""Red brake light came on but pedal still feels normal" → warning_light/brake_system_red_light"
Synonyms: pedal sinks, pedal goes to floor, pedal drops, pedal creeps down, sinking pedal, dropping pedal, pedal falls to floor, pedal to the floorboard, master cylinder bypass, bypassing master cylinder, no pedal pressure, pedal won't hold, brake pedal fade, fading pedal

## brakes/pulsating_or_vibrating_pedal
Description: The brake pedal pulses, vibrates, shudders, or pushes back rhythmically against the customer's foot when they apply the brakes — especially noticeable when braking from higher speeds or coming down a long hill. The pulsation often gets worse the harder they press. Customer may also feel it as a shake in the steering wheel (front rotors) or seat (rear rotors). Almost always caused by uneven rotor thickness (DTV / "warped rotors"), heat-distorted rotors after hard or sustained braking, or uneven pad-material deposits on the rotor face. Distinct from vibration/steering_wheel_shake_at_highway_speed (which happens at speed even WITHOUT braking — typically a wheel-balance or tire issue), from spongy_or_soft_pedal (a steady soft feel, no rhythm), and from grinding noises (this is a feel, not a sound).
Positive examples:
  - "Brake pedal pulses up and down when I press it"
  - "Pedal shudders and vibrates when I brake from highway speed"
  - "Feels like the brakes are pushing back at my foot in a rhythm"
  - "Steering wheel and pedal both shake when I'm slowing down"
  - "Car shudders when I brake — like a thump-thump-thump through the pedal"
  - "After driving down a mountain pass, the brake pedal started pulsing badly"
Negative examples:
  - ""Steering wheel shakes at 70 mph even when I'm not braking" → vibration/steering_wheel_shake_at_highway_speed"
  - ""Whole car shakes over bumps and rough roads" → vibration/shaking_or_bouncing_over_bumps_and_rough_roads"
  - ""Pedal feels soft and mushy, no vibration" → spongy_or_soft_pedal"
  - ""Grinding noise when I brake but pedal feels normal" → metallic_grinding"
Synonyms: pulsating, pulsing, pulses, vibrates, vibration, vibrating, shudder, shudders, shuddering, shake, shakes, judder, juddering, throbbing pedal, thumping pedal, brake shimmy, brake shake, warped rotors, DTV, rotor thickness variation

## brakes/hard_or_unresponsive_pedal
Description: The brake pedal feels unusually stiff, hard, or rock-like — the customer has to press much harder than normal to get the car to slow down, or in the worst case the pedal barely moves at all. Customers often describe it as "feels like stepping on a rock," "like the pedal turned to wood," or "I can't push it down." Almost always caused by a failed brake booster (most common), a leaking or disconnected vacuum hose to the booster, a seized caliper or guide pin, or in rare cases a kinked brake line. Often accompanied by a hissing sound under the hood when braking or rough engine idle when the pedal is pressed. Distinct from spongy_or_soft_pedal (the opposite — soft and gives easily) and from pedal_sinks_to_floor (where the pedal moves freely but doesn't build pressure).
Positive examples:
  - "Brake pedal is really hard to push down, feels like a rock"
  - "I have to stand on the pedal to get the car to stop"
  - "Pedal feels stiff and unresponsive — like the brakes aren't assisted anymore"
  - "Brake pedal barely moves, takes both feet to slow down"
  - "Pedal feels like wood, no give at all"
  - "Hissing sound when I press the brakes and the pedal is super stiff"
Negative examples:
  - ""Brake pedal feels soft and spongy" → spongy_or_soft_pedal"
  - ""Pedal slowly sinks to the floor when I hold pressure" → pedal_sinks_to_floor"
  - ""Pedal vibrates and pulses when I brake hard" → pulsating_or_vibrating_pedal"
  - ""Hissing under the dash but pedal feels normal" → noise/hissing_noise"
Synonyms: hard pedal, stiff pedal, hard to push, won't push down, rock-hard pedal, pedal like wood, unresponsive pedal, no power assist, brake booster failure, vacuum leak, hard brakes, stiff brakes, frozen pedal, locked pedal, pedal won't depress

## electrical/wont_crank_just_clicks
Description: When the driver turns the key or presses the start button, the engine does not rotate at all — instead there is only a click (or a rapid stream of clicks that sounds like a machine gun). The starter motor is not turning the engine over. Dash lights and headlights may or may not come on, but if they do, they often dim noticeably during the click. Most often caused by a dead / weak battery, corroded battery terminals, or a failing starter / solenoid. Distinct from slow_crank_sluggish_start — there, the engine DOES rotate, just slowly. Distinct from battery_drains_overnight — if the customer mentions the car is regularly fine all day but keeps dying when parked, that's battery_drains_overnight even though it ends in a click.
Positive examples:
  - "Turn the key and all I get is a click, click, click — it won't turn over at all"
  - "I hear one loud clunk-click and then nothing happens, the engine won't crank"
  - "Just rapid clicking like a machine gun when I try to start it, jumped it and it fired right up"
  - "Car won't start, dashboard lights come on but it just clicks when I twist the key"
  - "Push the start button and nothing, just a clicking sound under the hood"
Negative examples:
  - ""Engine cranks but really slowly before it starts" → slow_crank_sluggish_start"
  - ""Car was fine yesterday, dead this morning, third time this week I've needed a jump" → battery_drains_overnight"
  - ""It cranks fine but won't catch / won't fire when it's cold" → performance/hard_to_start_when_cold"
  - ""Cranks normal but won't start once it's hot" → performance/hard_to_start_when_hot"
  - ""Was driving down the highway when the dash went dark and the engine quit" → car_died_while_driving_electrical"
Synonyms: clicking, just clicks, click click click, rapid clicking, machine gun clicking, single click, one click, no crank, won't crank, won't turn over, dead battery click, solenoid click, starter clicking, key turn click, no start clicks, doesn't turn over just clicks

## electrical/slow_crank_sluggish_start
Description: When the driver turns the key, the engine DOES rotate / turn over — but slowly, laboriously, "rrrr… rrrr… rrrr" — like it's struggling to spin fast enough to fire. It usually does start eventually, often after several seconds of cranking. Frequently worse in cold weather, worse first thing in the morning after sitting overnight, or worse with a high accessory load. Most often caused by a weakening battery, a parasitic draw slowly pulling the battery down, corroded terminals, or a failing starter drawing too much current. Distinct from wont_crank_just_clicks — there, the engine doesn't rotate at all. Distinct from performance/hard_to_start_when_cold — that one is about the engine cranking normally but refusing to catch / fire; this one is specifically about the cranking speed itself being slow.
Positive examples:
  - "Engine sounds like it's struggling to turn over before it finally starts, especially when it's cold out"
  - "Takes way longer to start than it used to — sounds tired"
  - "When I twist the key it goes rrr… rrr… rrr and eventually catches"
  - "Cranks really slowly in the morning but starts fine once it's warmed up"
  - "Starter sounds weak and labored, like the battery doesn't have enough oomph"
Negative examples:
  - ""Just clicks, the engine doesn't turn over at all" → wont_crank_just_clicks"
  - ""Engine cranks at normal speed but won't fire up when it's cold" → performance/hard_to_start_when_cold"
  - ""Engine cranks normal but won't start when it's hot after I stop for gas" → performance/hard_to_start_when_hot"
  - ""Dies overnight in the parking lot, fine all day when driving" → battery_drains_overnight"
Synonyms: slow crank, sluggish crank, lazy crank, weak crank, struggling to start, labored start, slow turning over, rrr rrr rrr, weak starter sound, tired starter, slow starter, sluggish start, hard cranking, taking forever to start

## electrical/battery_drains_overnight
Description: The car runs fine while being driven, but the battery is dead (or very weak) when the customer comes back to it after the car has sat — typically overnight, but sometimes after just a few hours or a long weekend. After a jump-start or charge, it usually runs normally for the rest of the day. This is the classic parasitic-draw / phantom-drain pattern: something in the car continues to pull current after the ignition is off (a stuck relay, a dome light that won't go off, an aftermarket dash cam or remote starter, a failing module that won't go to sleep). Often accompanied by frequent jump-starts and a battery that's been replaced once already with no fix. Distinct from wont_crank_just_clicks — in THIS subcategory the customer's mental model is "the car keeps draining when I'm not using it," not just "it clicks today." Distinct from slow_crank_sluggish_start — here the car is fully DEAD, not just slow.
Positive examples:
  - "Car was fine yesterday, totally dead this morning — third time this week I've had to jump it"
  - "Battery keeps dying when the car sits, even though I just replaced it"
  - "If I don't drive it for a couple of days it won't start, but if I drive it daily it's fine"
  - "Something is killing my battery overnight — by morning it's drained down completely"
  - "I jump it, drive all day no problem, come back in the morning and it's dead again"
Negative examples:
  - ""Battery is weak and slow to crank every time I start it" → slow_crank_sluggish_start"
  - ""Just clicks when I turn the key right now, never started this morning" → wont_crank_just_clicks"
  - ""Car was running and then suddenly the dash went dark and it died on the highway" → car_died_while_driving_electrical"
  - ""Battery light is on but the car is still running" → warning_light/battery_charging_light"
Synonyms: battery drain, parasitic draw, parasitic drain, phantom drain, battery dies overnight, dead in the morning, battery keeps dying, drains when sitting, needs a jump every morning, won't hold a charge, battery goes dead when parked, frequent jump-starts, repeated jump starts, something draining the battery

## electrical/dim_or_flickering_lights
Description: The headlights and/or dashboard lights are visibly dim, flickering, pulsing, or strobing while the car is running. Customers commonly notice the brightness rising and falling with engine RPM ("brighter when I rev, dimmer at idle"), or the lights dimming whenever a heavy accessory load kicks on (AC, heated seats, blower fan, brakes). Most often caused by a failing alternator / voltage regulator, a loose or corroded battery cable, or a bad ground / serpentine belt slipping. The CHARGE / battery light on the dash may or may not also be on. Distinct from accessory_doesnt_work — that's about ONE accessory being completely dead. Distinct from multiple_random_electrical_glitches — that one covers MANY unrelated things acting up, not just brightness changes. Distinct from warning_light/battery_charging_light — that's specifically about the battery-shaped icon being on, not about the visible brightness of the headlights / dash.
Positive examples:
  - "My headlights pulse brighter and dimmer when the engine is running, especially at stoplights"
  - "Dashboard lights flicker and strobe while I'm driving — they brighten up when I rev the engine"
  - "Lights dim every time I turn on the AC or hit the brakes"
  - "Headlights look weak and yellow lately, getting dimmer the longer I drive"
  - "Dash lights flicker on and off while the car is running, like a strobe"
Negative examples:
  - ""Only the driver-side headlight is out — the other one is fine" → accessory_doesnt_work"
  - ""Radio resets, gauges jump around, dome light comes on by itself" → multiple_random_electrical_glitches"
  - ""Battery-shaped warning light came on while driving" → warning_light/battery_charging_light"
  - ""Headlights got dim and then the car shut off completely on the highway" → car_died_while_driving_electrical"
Synonyms: dim headlights, dim lights, flickering lights, flickering headlights, pulsing lights, strobing lights, lights getting dim, lights brighten with RPM, headlights weak, dash lights dim, instrument lights flicker, lights dim at idle, lights dim under load, alternator failing, charging system weak

## electrical/accessory_doesnt_work
Description: One specific electrical accessory has stopped working, while the rest of the car is operating normally. Common examples customers describe: a single power window that won't go up or down, the radio is completely dead, the dome / interior light won't turn on, the wipers don't move, a power lock or power mirror is unresponsive, the cigarette lighter or USB port has no power. Usually caused by a blown fuse, a failed switch, a broken motor, or a wiring break in one circuit. The classifier should pick this subcategory when the customer names ONE item (or a small related set on the same circuit, like "the radio and the cigarette lighter") that is dead. Distinct from multiple_random_electrical_glitches — that subcategory is for MANY unrelated things glitching at random. Distinct from dim_or_flickering_lights — that's about brightness, not a fully-dead accessory.
Positive examples:
  - "My driver-side power window won't go up anymore, the rest of the windows work fine"
  - "Radio is completely dead — won't turn on at all, screen is black"
  - "Dome light stopped working, can't see inside the car at night"
  - "Rear windshield wiper doesn't move when I turn it on, the front wipers work normal"
  - "Cigarette lighter / 12V outlet stopped giving any power, my phone won't charge"
  - "Driver door lock won't lock or unlock from the switch, the other three doors are fine"
Negative examples:
  - ""Radio resets AND gauges jump AND dome light flickers all together" → multiple_random_electrical_glitches"
  - ""All four windows AND the radio AND the wipers all stopped at the same time" → multiple_random_electrical_glitches (shared-fuse/big-circuit failure, not one accessory)"
  - ""Headlights are dim and flicker when I drive" → dim_or_flickering_lights"
  - ""Heater fan won't blow at all" → hvac/vents_dont_blow_strongly"
  - ""Battery-shaped warning light is on" → warning_light/battery_charging_light"
Synonyms: window won't work, radio dead, radio won't turn on, dome light out, wipers don't work, power lock broken, power mirror not working, cigarette lighter not working, USB port dead, accessory not working, single circuit dead, blown fuse, one window stuck, sunroof won't open, seat heater not working, power seat not moving

## electrical/multiple_random_electrical_glitches
Description: Multiple unrelated electrical things in the car are misbehaving at the same time — and the pattern feels random, intermittent, or weather-related. Customers describe "electrical gremlins": the radio resets itself, the gauges jump or sweep, warning lights flash on and off for no reason, the dome light comes on by itself, the door locks cycle, the wipers turn on randomly. Often worse over bumps, after a car wash, in humid weather, or after recent electrical / aftermarket work. Distinct from accessory_doesnt_work — that's ONE thing dead and stable; this is MANY things misbehaving. Distinct from dim_or_flickering_lights — that's purely a brightness symptom; this is a broad mix of symptoms across unrelated circuits. Distinct from warning_light/multiple_warning_lights_at_once — that one is specifically about dashboard warning icons being lit; THIS subcategory covers a wider grab-bag of weirdness (resets, gauge sweeps, accessories cycling).
Positive examples:
  - "Bunch of weird stuff happening — radio resets, gauges jump around, dome light comes on by itself"
  - "Electrical gremlins all over the place — locks cycle on their own, wipers turn on randomly, dash lights flicker"
  - "It's always something different — one day the radio cuts out, next day the windows act up, next day a warning light flashes"
  - "Multiple things acting up at once — gets worse over bumpy roads and after rain"
  - "Random electrical issues started after I had a stereo installed, ever since the car has been glitchy"
Negative examples:
  - ""Only my driver window doesn't work, everything else is fine" → accessory_doesnt_work"
  - ""Headlights dim and brighten with the engine RPM" → dim_or_flickering_lights"
  - ""Three warning lights came on at the same time — ABS, traction, and check engine" → warning_light/multiple_warning_lights_at_once"
  - ""Buzzing sound from the dash when the headlights are on" → noise/electrical_buzzing"
Synonyms: electrical gremlins, random electrical issues, weird electrical problems, intermittent electrical, multiple things glitching, electrical bugs, ghost in the machine, things acting up, glitchy car, multiple weird symptoms, random resets, gauge sweep, gauges jumping, locks cycling, bad ground symptoms, after car wash electrical, after rain electrical

## electrical/car_died_while_driving_electrical
Description: The car was running and then died / shut off while in motion — and the failure pattern points to the ELECTRICAL / charging system rather than the engine itself. Telltale signs customers describe: the headlights and dash got progressively dim before the shutdown, the battery / CHARGE warning light came on shortly before, the radio cut out, the power steering went heavy, and finally everything just went dark "like flipping a switch." After it dies, it often won't crank back over or only gives a click. Distinct from performance/stalling_while_driving_under_load — that one is engine-side (sputtering, hesitation, stumbling under throttle) with no electrical warnings; here the FIRST signs are electrical (dimming lights, battery light, dashboard going dark). Distinct from battery_drains_overnight — that's a car that dies WHILE SITTING; this one died WHILE DRIVING.
Positive examples:
  - "Lights went dim, battery light came on, then the car just shut off on the highway"
  - "Everything went dark while I was driving — dash, radio, headlights — then the engine quit"
  - "Car died at a stoplight, won't restart now, only clicks when I try"
  - "Was driving and suddenly lost all power like flipping a switch, dashboard went black"
  - "Battery light came on a few miles back and then the car coasted to a stop and won't start again"
Negative examples:
  - ""Engine sputtered and stumbled and lost power going uphill, no warning lights" → performance/stalling_while_driving_under_load"
  - ""Car kept dying in the parking lot overnight" → battery_drains_overnight"
  - ""Battery light came on but the car is still running fine" → warning_light/battery_charging_light"
  - ""Just clicks when I try to start it this morning, never moved from the driveway" → wont_crank_just_clicks"
  - ""Engine stalls at stoplights but restarts immediately" → performance/stalling_at_idle_or_when_stopping"
Synonyms: car died while driving, shut off while driving, lost power while driving, dashboard went dark, everything shut off, alternator died on the road, car quit driving, lost all electrical power, total electrical failure, charging system failed, battery died while driving, coasted to a stop, car stranded me on the road

## hvac/ac_blows_warm_or_hot_air
Description: Customer says the AC produces NO meaningful cooling — vent air feels the same as outside temperature, or actually warm/hot, even with AC set to max cold. A missing "click" from under the hood when AC is requested is a key tell that the compressor isn't engaging. Common causes: very low refrigerant from a leak, a failed compressor or compressor clutch, or an electrical fault stopping the compressor. Distinct from `ac_is_weak_not_cold_enough` — that is PARTIAL cooling (cool but not cold), whereas this is TOTAL absence of cooling. Distinct from `vents_dont_blow_strongly` — there the airflow VOLUME is weak; here plenty of air comes out but it isn't cold. If customer reports "warm AC plus a sweet smell", route smell first only if smell is the primary complaint; otherwise route here.
Positive examples:
  - "My AC is blowing warm air"
  - "Air conditioner is blowing hot air, basically just outside air"
  - "AC stopped working, feels like it's not on at all"
  - "Turn the AC to max cold and I just get warm air out of the vents"
  - "Compressor isn't kicking in — no click when I turn AC on"
Negative examples:
  - ""AC is on but it's just not as cold as last summer" → ac_is_weak_not_cold_enough"
  - ""AC blows cold but the airflow is really weak" → vents_dont_blow_strongly"
  - ""Heater blows cold air" → heat_doesnt_work"
  - ""Driver side is cold but passenger side is warm" → one_zone_works_but_another_doesnt"
  - ""AC blows cold for 5 minutes then turns warm, then cold again" → ac_is_weak_not_cold_enough"
Synonyms: AC, A/C, air conditioning, air con, climate control, no cool air, no cold air, blowing warm, blowing hot, AC not working, AC dead, AC out, refrigerant low, freon low, needs recharge, AC recharge, compressor not engaging, no AC click

## hvac/ac_is_weak_not_cold_enough
Description: Customer says the AC IS cooling, just not as cold as it used to be or not cold enough for the weather. Often described as "lukewarm", "barely cool", or "cools on the highway but warms at stoplights". Common causes: slow refrigerant leak (partial charge), clogged cabin air filter, dirty condenser, weak cooling fan, or an evaporator icing over from low charge. The cycling pattern — cold for 5-20 minutes then warming — is a classic evaporator-freeze symptom of low charge. Distinct from `ac_blows_warm_or_hot_air` — that is ZERO cooling (warm/hot air); this is PARTIAL cooling (cool but inadequate). Distinct from `vents_dont_blow_strongly` — there air VOLUME is weak; here plenty of air comes out and it's somewhat cool, just not cold enough. When customer says BOTH "weak AND warm", lean toward `ac_blows_warm_or_hot_air` only if cooling is essentially absent; otherwise this one.
Positive examples:
  - "AC isn't as cold as it used to be"
  - "AC works but it's pretty weak, only slightly cool"
  - "Air conditioning cools fine on the highway but barely cools at stoplights"
  - "AC cools for about 15 minutes then warms up, then cools again"
  - "It blows cool air but you really have to crank it to feel anything"
  - "Cooling is fine on cool days but useless on hot days"
Negative examples:
  - ""AC is blowing warm air, no cooling at all" → ac_blows_warm_or_hot_air"
  - ""AC is cold but the airflow is really weak out of the vents" → vents_dont_blow_strongly"
  - ""Heater doesn't get warm — heat doesn't work" → heat_doesnt_work"
  - ""One side blows cold, other side blows warm" → one_zone_works_but_another_doesnt"
  - ""Musty smell from the vents along with weak cooling" → bad_smell_from_vents"
Synonyms: AC, A/C, air conditioning, climate control, weak AC, weak cooling, not cold enough, lukewarm, barely cool, marginal cooling, low refrigerant, slow leak, freon low, AC underperforming, cycling AC, intermittent cooling, AC freezes up

## hvac/heat_doesnt_work
Description: Customer says the heater blows cold or room-temperature air instead of warm, OR heat takes a very long time to warm up. Common causes: stuck-open thermostat (engine never reaches operating temp), low coolant from a leak, clogged or failing heater core, or stuck blend door actuator. Key tell: the dash temp gauge — if it stays low while driving, thermostat is suspect; if gauge is normal but cabin stays cold, heater core or actuator is suspect. Distinct from `ac_blows_warm_or_hot_air` — that's AC producing no cool; this is HEAT producing no warm. Distinct from `vents_dont_blow_strongly` — there air VOLUME is weak; here air comes out fine but stays cold. If customer reports no heat plus wet passenger carpet plus foggy windows, cause is likely a leaking heater core — still route here. Distinct from `warning_light/engine_temperature_light` — if primary report is a dash light, route there; if primary report is "no heat in the cabin", route here.
Positive examples:
  - "My heater blows cold air"
  - "Heat doesn't work, just blows room-temperature air"
  - "Takes forever to get any warm air, and it's never really hot"
  - "Heater is dead — defrost doesn't help my breath fogging up either"
  - "Engine runs cool, gauge stays low, and I get no heat in the cabin"
  - "Heat blows warm for the first 5 minutes then goes cold"
Negative examples:
  - ""AC blows warm in the summer" → ac_blows_warm_or_hot_air"
  - ""Heat is hot but the airflow from the vents is really weak" → vents_dont_blow_strongly"
  - ""Heat is fine on the driver side but cold on the passenger side" → one_zone_works_but_another_doesnt"
  - ""Engine temp warning light is on" → engine_temperature_light"
  - ""Windows fog up even with heat on" → foggy_or_hard_to_defog_windows"
Synonyms: heat, heater, heating, no heat, cold heat, heater blows cold, heater not warming, defroster not warming, thermostat stuck, low coolant, heater core, heater core clogged, takes forever to warm, slow to warm, engine runs cool, blend door stuck

## hvac/vents_dont_blow_strongly
Description: Customer reports weak or no airflow VOLUME from the vents regardless of temperature — turning the fan up doesn't help, or the fan only blows hard on the highest setting. Air temperature may be correct (cold AC, warm heat); the problem is how much air comes out. Common causes: failed or failing blower motor, bad blower motor resistor (classic "only works on speed 4 or 5" symptom), clogged cabin air filter, debris (leaves, mouse nest) in the blower housing, or a stuck mode/recirc door blocking the vent path. Distinct from `ac_is_weak_not_cold_enough` — that is COOLING that's inadequate while airflow volume is normal; this is AIRFLOW inadequate regardless of temperature. Distinct from `ac_blows_warm_or_hot_air` — there plenty of air comes out but isn't cold; here the issue is HOW MUCH air comes out. Distinct from `strange_noise_from_vents` — if customer leads with a noise complaint, route there; if customer leads with airflow, route here even if there's also a noise.
Positive examples:
  - "Vents barely blow any air, even on the highest fan setting"
  - "Fan only works on the highest speed — speeds 1, 2, 3 do nothing"
  - "Air conditioning is cold but the airflow is so weak I can barely feel it"
  - "Blower stopped working completely — no air comes out at all"
  - "Air comes out fine on max but is weak on low and medium"
Negative examples:
  - ""AC isn't cold enough" → ac_is_weak_not_cold_enough"
  - ""AC blows warm air" → ac_blows_warm_or_hot_air"
  - ""Rattling noise from the dash when fan is on" → strange_noise_from_vents"
  - ""Driver side has no air but passenger side is fine" → one_zone_works_but_another_doesnt"
  - ""Defrost vents don't blow air on the windshield" → foggy_or_hard_to_defog_windows"
Synonyms: blower motor, blower fan, fan, vent airflow, weak airflow, no airflow, fan dead, fan only works on high, fan speeds don't work, blower resistor, cabin air filter, cabin filter clogged, intake blocked, fan won't turn on, mode door stuck, recirc door stuck

## hvac/foggy_or_hard_to_defog_windows
Description: Customer says the inside of the windshield or other windows fog up and stay fogged, or the defroster doesn't clear them quickly. Some fog on cold/rainy mornings is normal; this slug is the pick when fog is persistent, defroster doesn't help, or there are deeper clues (oily film on glass, sweet smell, wet passenger carpet). Common causes: non-engaging AC compressor (AC dehumidifies even in winter — many cars auto-engage AC with defrost), clogged AC evaporator drain dumping water into the cabin, leaking heater core leaving coolant vapor on the glass, blocked defrost vents, or a stuck-recirculate fresh-air door. Rear-window defroster (lines on back glass) not heating is also covered here — that's electrical, not airflow. Distinct from `heat_doesnt_work` — customer here leads with FOG / VISIBILITY, not cabin temperature. Distinct from `vents_dont_blow_strongly` — there airflow is weak everywhere; here the complaint is fog persistence or defrost vents specifically being weak.
Positive examples:
  - "My windshield keeps fogging up and the defroster doesn't clear it"
  - "Windows fog up bad in the rain, defrost barely helps"
  - "Inside of the windshield has a greasy film I can't wipe off"
  - "Defrost vents don't seem to blow much air on the windshield"
  - "Rear window defroster doesn't work — lines on the back glass don't heat up"
  - "Windows fog over the second I get more than one passenger in the car"
Negative examples:
  - ""Heater blows cold air" → heat_doesnt_work"
  - ""AC is weak" → ac_is_weak_not_cold_enough"
  - ""Wipers don't clear the windshield" → (out of HVAC scope; would be vibration/visibility category)"
  - ""Sweet smell from the vents" → bad_smell_from_vents"
  - ""Weak airflow from all vents including defrost" → vents_dont_blow_strongly"
Synonyms: defroster, defogger, defog, windshield fog, foggy windows, foggy windshield, defrost not working, defrost weak, rear defroster, rear window defogger, back glass defroster, defroster grid, oily film on windshield, cabin humidity, AC won't engage with defrost, fresh air stuck

## hvac/strange_noise_from_vents
Description: Customer reports an unusual sound from the dashboard, vents, or behind the dash that is clearly tied to the HVAC system — noise changes with fan speed, vent mode (dash / floor / defrost), or recirculate vs fresh-air. Includes whistling (debris in ducts, dirty filter, refrigerant leak chirp), rattling (loose debris in blower, leaves in cowl), clicking/ticking (failing blend door actuator with stripped plastic gears — loudest right after start or when changing temp), and grinding/whirring (failing blower motor bearings). Distinct from `noise/electrical_buzzing` and `noise/hissing_noise` — those appear without the fan on or are clearly underhood; this slug is for noises that follow HVAC controls. Distinct from `vents_dont_blow_strongly` — if customer leads with NOISE, route here; if they lead with WEAK AIRFLOW, route there. A click from behind the dash that fires only when the temp dial moves is almost always a blend door actuator.
Positive examples:
  - "Clicking noise behind the dashboard when I change the temperature"
  - "Vents make a rattling sound when the fan is on, stops when I turn it off"
  - "Whistling sound coming out of the air vents at higher fan speeds"
  - "Grinding noise from behind the glove box, sounds like leaves in the blower"
  - "Tick tick tick from the dash right after I start the car, then it stops"
Negative examples:
  - ""Buzzing noise from the dash all the time, fan-independent" → electrical_buzzing"
  - ""Hissing under the hood after I shut the car off" → hissing_noise"
  - ""Vents barely blow any air" → vents_dont_blow_strongly"
  - ""AC compressor squeals" → high_pitched_whining_under_the_hood"
  - ""Rattling underneath the car" → rattling_underneath_the_car"
Synonyms: vent noise, dashboard noise, behind the dash noise, blower noise, blower motor noise, blower rattle, blend door clicking, actuator clicking, vent whistle, vent whistling, vent rattle, vent rattling, AC clicking, fan grinding, fan squeak, leaves in vents, debris in blower

## hvac/bad_smell_from_vents
Description: Unpleasant odor from the dashboard vents while the HVAC runs — smell is clearly tied to vent airflow (worse with fan on, weaker with fan off; may change with AC vs heat or fresh-air vs recirculate). Most common: musty / mildew / dirty-socks smell from microbial growth on the damp evaporator coil — peaks when AC first turns on, worsened by an overdue cabin filter. Sweet / maple-syrup smell when heat is on, often paired with foggy windows or wet passenger carpet, points at a leaking heater core. Burning electrical or plastic smell points at a failing blower motor or resistor. Gasoline smell on cold starts can point at a fresh-air-intake issue. This slug is the canonical pick whenever smell comes through cabin vents — even though `smell/musty_mildew_smell_from_vents` and `smell/sweet_smell_maple_syrup_antifreeze` exist, route HERE when vent airflow is the smell's vehicle. Route to `smell/` only when smell is clearly NOT through the vents.
Positive examples:
  - "Vents smell like dirty socks when I turn on the AC"
  - "Musty smell every time I first start the car and turn on the air"
  - "Sweet smell, kind of like maple syrup, comes out when the heater is on"
  - "Burning smell from the dashboard vents when fan is on high"
  - "Moldy smell from the AC, gets worse on humid days"
Negative examples:
  - ""Burning smell from under the hood" → burnt_oil_smell"
  - ""Exhaust smell in the cabin while driving" → exhaust_fumes_inside_the_cabin"
  - ""Rotten egg smell" → rotten_egg_sulfur_smell"
  - ""Gas smell outside the car, not through the vents" → gasoline_fuel_smell"
  - ""AC blows warm" → ac_blows_warm_or_hot_air"
  - ""Sweet smell from the engine bay, not through the vents" → sweet_smell_maple_syrup_antifreeze"
Synonyms: AC smell, vent smell, vent odor, musty smell, mildew smell, moldy smell, dirty sock smell, sweet smell, antifreeze smell, coolant smell, heater core leak, burning smell, electrical smell, plastic burning, foul vent air, evaporator smell, AC stinks, AC stinks like mildew

## hvac/one_zone_works_but_another_doesnt
Description: Customer reports cabin temperature is wrong on one side or zone while another side is fine — driver vs passenger, or front vs rear in vehicles with rear climate. Most common pattern: "driver side blows cold, passenger side blows warm" (or vice versa) in dual-zone systems. Often paired with a ticking/clicking noise from behind the dash that fires only when the temp dial is adjusted. Common cause: failed blend door actuator (stripped plastic gears) on the affected side; less common: a stuck blend door, a wiring problem, or marginal refrigerant favoring one zone. Distinct from `ac_blows_warm_or_hot_air` and `heat_doesnt_work` — those are SYSTEM-WIDE failures (no side works); this slug requires asymmetry between zones. Distinct from `vents_dont_blow_strongly` — there airflow VOLUME is weak; here airflow volume is usually normal but TEMPERATURE is wrong on one side. If customer says "left vents don't blow air" with normal right-side airflow, that's still a zone problem.
Positive examples:
  - "Driver side blows cold, passenger side blows warm — heat or AC, doesn't matter"
  - "My passenger side won't get warm even with the dial all the way up"
  - "Rear vents blow warm while the front blows cold"
  - "Heat works on the driver side but the passenger side stays cold"
  - "When I turn the temperature dial on the passenger side nothing changes — it just stays cold"
Negative examples:
  - ""AC blows warm from every vent" → ac_blows_warm_or_hot_air"
  - ""Heater doesn't work at all" → heat_doesnt_work"
  - ""Vents are weak on every side" → vents_dont_blow_strongly"
  - ""Clicking from the dash, both sides work fine" → strange_noise_from_vents"
  - ""Defroster doesn't work" → foggy_or_hard_to_defog_windows"
Synonyms: dual zone, dual climate, two zone, zone problem, driver side hot passenger cold, passenger side warm driver cold, one side cold one side hot, left vent right vent different, rear climate not working, blend door actuator, blend door, climate door, temperature door, asymmetric temperature, uneven temperature

## leak/brown_or_black_puddle_engine_oil
Description: A slick, oily puddle that ranges from honey-amber (fresh oil) to brown or black (used oil), most often appearing under the front or middle of the car beneath the engine. The fluid feels thick and greasy between the fingers and usually smells of petroleum, sometimes burnt if it has been dripping onto hot exhaust. Distinct from the much thicker, sulfur-smelling gear oil that pools further back near an axle, and distinct from red transmission fluid which tends to drip nearer the center under the transmission.
Positive examples:
  - "Dark brown puddle under my engine when I park"
  - "Black oily stain on my driveway in the morning"
  - "Found some amber-colored drips under the front of the car after my oil change"
  - "There's a slick brown spot under the motor and the oil light came on"
  - "Greasy black puddle, smells like burning oil after I drive"
Negative examples:
  - ""Thick dark fluid under the rear axle that smells like rotten eggs" → thick_dark_brown_puddle_gear_or_differential_oil"
  - ""Bright red fluid under the middle of the car" → red_or_pink_puddle_transmission_or_power_steering"
  - ""Green slimy puddle under the radiator" → green_orange_yellow_or_pink_puddle_coolant"
  - ""Blue smoke from the tailpipe" → smoke/blue_smoke_from_exhaust"
Synonyms: motor oil, engine oil, oil leak, oil drip, oil pan leak, valve cover leak, oily puddle, black oil spot, brown oil stain, petroleum leak

## leak/green_orange_yellow_or_pink_puddle_coolant
Description: A brightly colored, slightly slimy puddle — most commonly green, orange, yellow, pink, or even bright blue depending on the vehicle make — usually found under the front of the car near the radiator or hoses. Coolant has a distinctively sweet, syrupy smell (often described as maple syrup or pancake syrup) and feels slick but watery, not greasy. Distinct from the red puddle of transmission or power-steering fluid which is darker, oilier, and located more toward the middle/front rather than directly under the radiator — and distinct from washer fluid, which is the same blue but watery and odorless-soapy rather than sweet.
Positive examples:
  - "Bright green puddle right under the front of my car"
  - "Neon yellow fluid leaking near the radiator, kind of sticky"
  - "Orange stain on the driveway, smells sweet"
  - "Pink puddle under the front, and my temperature gauge has been running hot"
  - "Snot-green slimy fluid dripping under the hood area"
  - "Bright blue coolant looking stuff under my Honda"
Negative examples:
  - ""Bright red puddle under the middle of the car" → red_or_pink_puddle_transmission_or_power_steering"
  - ""Light blue watery puddle near the front wheel, no smell" → blue_or_light_blue_puddle_washer_fluid"
  - ""Sweet smell inside the cabin when the heat is on, no puddle outside" → smell/sweet_smell_maple_syrup_antifreeze"
  - ""Foggy windows and wet passenger floor" → hvac/foggy_or_hard_to_defog_windows"
  - ""Clear water under the car after running the AC" → clear_odorless_puddle_water_or_ac_condensation"
Synonyms: antifreeze, coolant, radiator fluid, ethylene glycol, Dex-Cool, green coolant, orange coolant, pink coolant, yellow coolant, blue coolant, sweet-smelling leak, radiator leak

## leak/red_or_pink_puddle_transmission_or_power_steering
Description: A red, pink, or reddish-brown oily puddle, typically thinner than engine oil but slick to the touch, with a faint sweet-burnt or petroleum smell. The same red dye is used in both automatic transmission fluid (ATF) and power-steering fluid that uses ATF, so the customer usually cannot tell which one is leaking without a mechanic looking — a leak toward the middle/rear under the transmission pan suggests ATF, while a leak toward the front of the engine bay suggests power-steering fluid. Distinct from pink/red OAT coolant, which is bright neon, watery, smells sweet like syrup, and pools right under the radiator instead of under the transmission or steering rack.
Positive examples:
  - "Bright red puddle under the middle of my car"
  - "Pink oily fluid leaking under the front, hard to turn the wheel now"
  - "Dark reddish-brown drips under the transmission area"
  - "ATF-looking fluid under the car and it's slipping in gear"
  - "Reddish puddle near the steering, whining when I turn"
Negative examples:
  - ""Bright neon pink fluid right under the radiator, smells sweet" → green_orange_yellow_or_pink_puddle_coolant"
  - ""Dark brown oily puddle under the engine" → brown_or_black_puddle_engine_oil"
  - ""Thick dark fluid that smells like sulfur" → thick_dark_brown_puddle_gear_or_differential_oil"
  - ""Clear yellow oily spot near a wheel" → clear_yellow_or_light_brown_puddle_brake_fluid"
Synonyms: ATF, automatic transmission fluid, transmission fluid, transmission leak, power steering fluid, PSF, red fluid leak, pink oily puddle, hydraulic fluid leak, steering rack leak

## leak/clear_yellow_or_light_brown_puddle_brake_fluid
Description: A small, slippery, oily puddle that looks nearly clear when fresh and turns yellow, light brown, or even dark brown as it ages — most often found near one of the wheels, along the underside of the car near a brake line, or on the driver-side firewall under the master cylinder. Brake fluid is thinner than engine oil but has a slick, vegetable-oil-like feel and a distinct chemical (sometimes faintly fishy) smell, NOT the petroleum smell of motor oil. This is a safety emergency — a soft or sinking brake pedal combined with a clear-to-yellow puddle near a wheel means the customer should stop driving immediately. Distinct from harmless clear AC condensation, which drips only at the front-passenger area, has no oily feel, and only appears after running the AC.
Positive examples:
  - "Clear oily puddle next to my front tire"
  - "Yellowish slippery fluid under the wheel and my brake pedal feels soft"
  - "Light brown wet spot behind the rear tire"
  - "Slippery clear fluid near the brake line, pedal goes almost to the floor"
  - "Amber-colored drips on the driver side near the firewall"
Negative examples:
  - ""Clear puddle under the front of the car after running AC, no oil to it" → clear_odorless_puddle_water_or_ac_condensation"
  - ""Yellow neon coolant under the radiator" → green_orange_yellow_or_pink_puddle_coolant"
  - ""Brown oil leak under the engine" → brown_or_black_puddle_engine_oil"
  - ""Hard brake pedal, no puddle anywhere" → other/brake_concern_no_leak"
Synonyms: brake fluid, brake fluid leak, DOT 3, DOT 4, hydraulic brake fluid, master cylinder leak, brake line leak, caliper leak, wheel cylinder leak, soft pedal leak

## leak/clear_odorless_puddle_water_or_ac_condensation
Description: A clear, watery, odorless puddle — usually small (saucer- to dinner-plate-sized) — that appears under the front passenger side of the car after the air conditioner has been running, especially on hot or humid days. The fluid feels exactly like tap water, has no oily sheen, no smell, and disappears when the AC is off. This is normal and harmless: the AC evaporator drains condensation through a tube that empties under the car. Distinct from a brake fluid leak (which is also clear-ish but slippery, oily-feeling, located near a wheel, and yellows with age), and distinct from a heater core leak (sweet-smelling, pools INSIDE the cabin on the passenger floor — that case belongs in hvac/foggy_or_hard_to_defog_windows or the sweet-smell subcategory).
Positive examples:
  - "Clear water puddle under the front passenger side after I run the AC"
  - "Just water dripping under the car on hot days, no color or smell"
  - "Small clear wet spot under the engine area, only when AC is on"
  - "Looks like plain water, evaporates pretty quick"
  - "Tap-water looking drip near the front, nothing oily about it"
Negative examples:
  - ""Clear slippery puddle near a wheel and the brake pedal is soft" → clear_yellow_or_light_brown_puddle_brake_fluid"
  - ""Wet carpet on the passenger floor and the windows fog up" → hvac/foggy_or_hard_to_defog_windows"
  - ""Sweet smell inside the car when I run the heater" → smell/sweet_smell_maple_syrup_antifreeze"
  - ""Green slimy puddle, not clear water" → green_orange_yellow_or_pink_puddle_coolant"
Synonyms: AC condensation, air conditioning water, AC drip, condensate, water under car, clear water leak, harmless puddle, AC drain, evaporator drain, normal water dripping

## leak/thick_dark_brown_puddle_gear_or_differential_oil
Description: A thick, sticky, dark brown or near-black puddle — visibly heavier and more viscous than engine oil — usually found under the rear axle, transfer case, or front differential rather than under the engine. The most distinctive identifier is the smell: gear oil has a powerful sulfur or rotten-egg odor that engine oil never has. The fluid is so thick that it tends to stick to the underside of the car and pick up dust rather than running in clean drips. Distinct from regular engine oil (which is thinner, located further forward under the engine, and smells like petroleum rather than sulfur), and distinct from transmission fluid (red and thinner).
Positive examples:
  - "Thick dark fluid under the rear axle, smells like rotten eggs"
  - "Sticky black puddle near the back of the truck and the rear end is whining"
  - "Strong sulfur smell coming from the rear, with dark oil drips"
  - "Heavy dark brown grease-looking stuff under the differential"
  - "Gear oil leaking from the transfer case area, dusty greasy mess"
Negative examples:
  - ""Brown oily puddle under the engine" → brown_or_black_puddle_engine_oil"
  - ""Red fluid under the transmission" → red_or_pink_puddle_transmission_or_power_steering"
  - ""Black smoke from tailpipe" → smoke/black_smoke_from_exhaust"
  - ""Grinding noise from the rear with no leak" → noise/grinding_or_rumbling_from_rear"
Synonyms: gear oil, differential fluid, diff oil, axle oil, hypoid gear oil, transfer case fluid, rear end fluid, sulfur smell leak, rotten egg smell oil, gear lube

## leak/blue_or_light_blue_puddle_washer_fluid
Description: A thin, watery, light blue or bluish-green puddle, usually found near one of the front wheels or right under the front bumper, often paired with the customer noticing the windshield washer reservoir is empty or that no fluid sprays when they try the wipers. It smells faintly soapy or like alcohol/window cleaner, not sweet. The fluid is no thicker than water and is essentially harmless to the car — a cracked washer reservoir or a split hose is the usual cause. Distinct from blue or light-blue COOLANT used by some Asian manufacturers (Honda, some Toyota), which is slimier, smells sweet like syrup, and pools right under the radiator instead of off to the side.
Positive examples:
  - "Light blue watery puddle near my front tire, washer fluid won't spray anymore"
  - "Blue fluid leak under the front bumper, no smell really"
  - "Looks like windex leaking under the car"
  - "Thin blue puddle, washer reservoir keeps going empty"
  - "Light bluish-green watery drip near the front, nothing sticky about it"
Negative examples:
  - ""Bright blue slimy fluid right under the radiator, smells sweet" → green_orange_yellow_or_pink_puddle_coolant"
  - ""Clear watery puddle, no color" → clear_odorless_puddle_water_or_ac_condensation"
  - ""Wipers won't move at all" → other/wiper_motor_concern"
  - ""Window won't roll up" → electrical/power_window_failure"
Synonyms: washer fluid, windshield washer fluid, wiper fluid, washer reservoir leak, windshield cleaner, blue fluid leak, watery blue puddle, washer bottle leak

## noise/engine_ticking_or_tapping
Description: Light, rapid tapping or ticking from the upper part of the engine — most often described as a sewing-machine sound, a typewriter, or a small object tapping fast in time with engine speed. Usually loudest at idle or cold start, tied to camshaft speed, and sometimes quiets as oil pressure builds and the engine warms up. Common causes are low/dirty oil, worn hydraulic lifters, or fuel injector clicks. Distinct from deep_knocking_from_the_engine (which is a deeper, heavier, slower hammering from the lower block) and from electrical_buzzing (continuous electrical tone, not a discrete tap-tap-tap rhythm).
Positive examples:
  - "Engine sounds like a sewing machine when I first start it in the morning"
  - "Light ticking from the top of the engine that speeds up when I press the gas"
  - "Rapid tapping noise under the hood — kind of like a typewriter"
  - "Lifter tick — quiets down after about a minute of driving"
  - "Sounds like a clock or a metronome coming from up top when it idles"
Negative examples:
  - ""Deep heavy knock from down low that gets worse when I accelerate" → deep_knocking_from_the_engine"
  - ""High whine under the hood that changes with engine RPM" → high_pitched_whining_under_the_hood"
  - ""Constant buzzing from the dash even when the car is off" → electrical_buzzing"
  - ""Clicking only when I turn the steering wheel sharply" → popping_or_clicking_when_turning"
  - ""Hissing from under the hood after I shut it off" → hissing_noise"
Synonyms: tick, ticking, tap, tapping, click, clicking, sewing machine, typewriter, lifter tick, lifter tap, valve tick, valve tap, injector tick, valvetrain tick, clatter, clacking, top-end noise, clicky clacky

## noise/clunking_over_bumps
Description: A sharp metallic or hollow clunk, thud, thump, or bang from the suspension area when the car rolls over bumps, potholes, speed bumps, dips, or driveways — sometimes a single sharp report, sometimes a double-knock. Usually felt as much as heard, coming from a specific corner or "front end" / "rear end." Common causes are worn sway bar end links, ball joints, control arm bushings, strut mounts, or shocks. Distinct from squeaking_or_creaking_over_bumps (which is a rubbery squeak/groan, not a metallic impact) and from rattling_underneath_the_car (which is a tinny ongoing buzz/shake of something loose, not a discrete impact-triggered clunk). Cross-category: a "clunk when going over bumps AND when turning" with steering involvement may belong to steering/clunking_knocking_or_rough_ride_over_bumps.
Positive examples:
  - "Big clunk from the front whenever I hit a pothole"
  - "Loud thud from the back going over speed bumps"
  - "Sounds like a bang from the driver's side when I go over bumps"
  - "Thunk-thunk over rough roads — feels like something is loose underneath"
  - "Hollow knock from the front end every time I hit a bump in the road"
Negative examples:
  - ""Squeak or creak when I go over bumps" → squeaking_or_creaking_over_bumps"
  - ""Tinny rattle underneath when I'm driving normally" → rattling_underneath_the_car"
  - ""Clunk only when I turn the steering wheel" → popping_or_clicking_when_turning"
  - ""Clunking that goes with bumps AND happens when I turn into my driveway" → steering/clunking_knocking_or_rough_ride_over_bumps"
  - ""Deep knock from the engine when I accelerate" → deep_knocking_from_the_engine"
Synonyms: clunk, clunking, thud, thump, thunk, bang, knock, clank, clanking, clatter, bump noise, suspension clunk, pothole noise, hollow clunk, metallic thud, jolt, bonk

## noise/humming_or_whirring_at_speed
Description: A steady humming, whirring, droning, or growling sound from the wheel area that gets louder the faster you drive — usually starting around 30-40 mph and intensifying with speed. The sound often changes pitch or volume when you steer left versus right (loading one bearing more than the other). Most commonly a worn wheel bearing or uneven tire wear; sometimes a worn differential or U-joint. Distinct from high_pitched_whining_under_the_hood (which is from the engine bay and changes with engine RPM, not road speed) and from rattling_underneath_the_car (which is a discrete shake/buzz, not a continuous hum). Cross-category: a hum tied to engine RPM, not road speed, may belong to performance.
Positive examples:
  - "Loud humming from the front wheel area that gets louder the faster I go"
  - "Whirring sound that increases with speed — like a propeller"
  - "Drone or growl from underneath, louder when I turn right"
  - "Sounds like an airplane taking off when I'm on the highway"
  - "Wheel area is making a humming noise — quiets down when I stop"
Negative examples:
  - ""Whining noise under the hood that goes up with engine speed" → high_pitched_whining_under_the_hood"
  - ""Hum only when AC is on" → hissing_noise"
  - ""Steady road noise that doesn't change when I steer" → tires/loud_road_noise_drone_or_growl"
  - ""Buzzing from the dashboard or fuse box" → electrical_buzzing"
  - ""Light ticking from the top of the engine" → engine_ticking_or_tapping"
Synonyms: hum, humming, whir, whirring, drone, droning, growl, growling, roar, roaring, rumble, rumbling, wheel bearing noise, hum at speed, airplane noise, propeller sound

## noise/high_pitched_whining_under_the_hood
Description: A continuous high-pitched whine, whirr, or squeal from the front of the engine bay — usually changes pitch with engine RPM (revs up with the engine), and often louder during steering input (parking lot maneuvers) or with electrical load (headlights, blower). Common causes are a glazed or slipping serpentine belt, a failing alternator bearing, or a power-steering pump low on fluid. Distinct from humming_or_whirring_at_speed (which is wheel-bearing area and tied to road speed, not engine RPM) and from electrical_buzzing (which is a steady electrical tone, not a rising/falling whine). Cross-category: a power-steering whine that ONLY happens when turning the wheel belongs to steering/noise_when_turning_the_steering_wheel; this subcategory is for the under-hood whine that's there whenever the engine runs.
Positive examples:
  - "High-pitched whine under the hood that goes up and down with the engine"
  - "Belt squealing first thing in the morning when it's cold"
  - "Whining sound from the engine bay — gets worse when I turn the wheel hard"
  - "Steady whine from up front that gets louder when I turn on the headlights"
  - "Sounds like a turbine or a jet engine under the hood"
Negative examples:
  - ""Humming from the wheel area that gets worse with speed" → humming_or_whirring_at_speed"
  - ""Whine only when turning the steering wheel" → steering/noise_when_turning_the_steering_wheel"
  - ""Squealing brakes when I come to a stop" → brakes/high_pitched_squealing"
  - ""Buzzing from the fuse box even with engine off" → electrical_buzzing"
  - ""Ticking from the top of the engine at idle" → engine_ticking_or_tapping"
Synonyms: whine, whining, whirr, whirring, squeal, squealing, screech, screeching, belt squeal, alternator whine, power steering whine, serpentine belt noise, high-pitched, jet engine sound, turbine

## noise/rattling_underneath_the_car
Description: A loose-metal rattle, buzz, or tinny clatter from under the car — often described as "a can with rocks in it" or "loose change in a tin." Frequently triggered by engine vibration (idle, revving), bumps, or thermal expansion right after start-up, and may quiet down at highway cruise. Most common causes are loose heat shields, a failing catalytic converter (with broken internals), or loose exhaust hangers. Distinct from clunking_over_bumps (which is a discrete impact when a bump triggers it, not an ongoing rattle) and from electrical_buzzing (electrical tone from a relay/dash, not a mechanical metal-on-metal shake). Cross-category: a rattle from the dashboard or vents belongs to hvac/strange_noise_from_vents or another module — this subcategory is specifically UNDERNEATH the vehicle.
Positive examples:
  - "Loud rattle underneath when I'm at idle — sounds like a can of marbles"
  - "Tinny rattle from under the car that goes away once I get up to speed"
  - "Something is rattling underneath — heat shield or exhaust maybe"
  - "Buzzing rattle from below when I rev the engine"
  - "Sounds like loose change shaking around under the car"
Negative examples:
  - ""Clunk only when I hit a bump" → clunking_over_bumps"
  - ""Rattling from the dash vents when the blower is on high" → hvac/strange_noise_from_vents"
  - ""Buzzing from inside the dashboard" → electrical_buzzing"
  - ""Ticking from the top of the engine" → engine_ticking_or_tapping"
  - ""Hissing from under the hood" → hissing_noise"
Synonyms: rattle, rattling, clatter, clattering, buzz, tinny, can of marbles, can of rocks, loose change, heat shield rattle, exhaust rattle, catalytic converter rattle, cat rattle, vibrating metal, shaking metal

## noise/hissing_noise
Description: A continuous air-escape sound — soft hiss, sharp psssss, or steady steam-like sound — usually from under the hood or near the dashboard. Hisses tied to AC/refrigerant usually appear when the AC is on or just after shutting it off; coolant hisses often come with high temperature gauge readings or visible steam; vacuum-leak hisses are loudest at idle and may cause rough running. Distinct from electrical_buzzing (which is an electrical tone, not airflow) and from high_pitched_whining_under_the_hood (which has a clear pitch and rises with engine RPM — a hiss has no rhythm or pitch change). Cross-category: a hiss from a tire belongs to tires/flat_or_low_tire.
Positive examples:
  - "Hissing sound from under the hood after I shut the car off"
  - "Psssss noise when I turn on the AC"
  - "Sounds like air escaping from somewhere up front"
  - "Steady hiss when the engine is idling — runs rough too"
  - "Steam-like noise and the temperature gauge is high"
Negative examples:
  - ""Electrical buzzing from the dash" → electrical_buzzing"
  - ""High whine under the hood that goes with the engine" → high_pitched_whining_under_the_hood"
  - ""Hiss coming from one of my tires" → tires/flat_or_low_tire"
  - ""Rattle underneath when I'm idling" → rattling_underneath_the_car"
  - ""Whoosh sound from the vents" → hvac/strange_noise_from_vents"
Synonyms: hiss, hissing, psss, pssh, air leak, steam, steaming, escape of air, sssss sound, refrigerant hiss, vacuum leak, coolant hiss, sizzle, sizzling

## noise/popping_or_clicking_when_turning
Description: A repeating pop, click, or clack that happens ONLY when the steering wheel is turned — most noticeable at low speed in parking lots, U-turns, and tight cornering. The rhythm typically speeds up and gets louder the tighter the turn, and is usually one-sided (worse turning one direction than the other). Classic symptom of a worn CV (constant velocity) joint or torn CV boot leaking grease. Distinct from clunking_over_bumps (which is bump-triggered, not turn-triggered) and from squeaking_or_creaking_over_bumps (which is a rubbery squeak, not a metallic click). Cross-category: a creak or pop from the steering column itself — happening even while parked — belongs to steering/noise_when_turning_the_steering_wheel.
Positive examples:
  - "Clicking noise from the front wheels only when I turn in parking lots"
  - "Pop-pop-pop when I make a sharp turn — louder turning left"
  - "Clacking from the driver's side when I'm backing up and turning"
  - "Sounds like a card in bicycle spokes when I turn the wheel hard"
  - "Tick-tick-tick during tight turns, faster the tighter I go"
Negative examples:
  - ""Clunk over bumps" → clunking_over_bumps"
  - ""Creak when I turn the steering wheel while parked" → steering/noise_when_turning_the_steering_wheel"
  - ""Squeak going over bumps" → squeaking_or_creaking_over_bumps"
  - ""Light tick from the engine at idle" → engine_ticking_or_tapping"
  - ""Whine when I crank the steering wheel hard at low speed" → high_pitched_whining_under_the_hood"
Synonyms: pop, popping, click, clicking, clack, clacking, tick, ticking, snap, CV joint noise, axle click, turn click, parking lot pop, click on turns, popping on turns

## noise/deep_knocking_from_the_engine
Description: A deep, heavy, hammering knock from the lower part of the engine block — slower and more forceful than a tick, often described as a sledgehammer, a hammer hitting a board, or someone banging from inside the engine. Usually gets louder under load (acceleration, climbing hills) and may be accompanied by low oil pressure warnings. Most often connecting-rod-bearing wear (rod knock), low oil, or severe pre-ignition (pinging). This is typically a do-not-drive warning. Distinct from engine_ticking_or_tapping (which is light, fast, top-of-engine valvetrain) and from clunking_over_bumps (which is suspension and bump-triggered, not engine-load-triggered).
Positive examples:
  - "Deep knocking from the engine that gets worse when I accelerate"
  - "Sounds like someone is hammering inside the engine"
  - "Heavy thump-thump-thump from down low when I'm climbing a hill"
  - "Loud banging from the engine bay — louder under throttle"
  - "Engine is making a thudding sound from the bottom — oil light flickered too"
Negative examples:
  - ""Light rapid tapping from the top of the engine" → engine_ticking_or_tapping"
  - ""Clunk from the suspension when I hit a bump" → clunking_over_bumps"
  - ""Knocking noise only when I turn the steering wheel" → popping_or_clicking_when_turning"
  - ""Pinging or rattling only under hard acceleration with cheap gas" → performance/pinging_or_pre_ignition"
  - ""Buzzing electrical sound from the dash" → electrical_buzzing"
Synonyms: knock, knocking, deep knock, rod knock, bottom-end knock, heavy thump, hammering, bang, banging, thud, thudding, pound, pounding, sledgehammer sound, lower-engine noise, bottom-of-engine knock, piston slap

## noise/squeaking_or_creaking_over_bumps
Description: A high-pitched rubbery squeak, groan, or creak from the suspension when the car flexes over bumps, speed bumps, or driveways — often worse on cold mornings, after the car has sat in wet weather, or under heavy loads. Sounds like dry rubber twisting or an old porch step, not a metallic impact. Most common causes are dried-out sway bar bushings, control arm bushings, or ungreased ball joints. Distinct from clunking_over_bumps (which is a hard metallic thud/bang, not a squeak/creak) and from brakes/high_pitched_squealing (which is from the wheels when braking, not from suspension flexing). Cross-category: a squeak/creak ONLY when turning the steering wheel (not over bumps) belongs to steering/noise_when_turning_the_steering_wheel.
Positive examples:
  - "Squeaking from the front suspension every time I go over a speed bump"
  - "Creaks like an old door when I drive over bumps in the morning"
  - "Rubbery squeak when the car bounces — worse in cold weather"
  - "Groaning sound from underneath when I go over uneven pavement"
  - "Sounds like dry rubber twisting when I roll into my driveway"
Negative examples:
  - ""Hard metallic clunk over bumps" → clunking_over_bumps"
  - ""Squealing brakes when I stop" → brakes/high_pitched_squealing"
  - ""Creak when I turn the wheel sitting still" → steering/noise_when_turning_the_steering_wheel"
  - ""Whining under the hood with engine RPM" → high_pitched_whining_under_the_hood"
  - ""Squeaky wipers across the windshield" → other/wiper_noise"
Synonyms: squeak, squeaking, creak, creaking, groan, groaning, squeal, rubbery squeak, dry bushing noise, suspension squeak, bushing creak, ball joint creak, old door sound, porch step sound

## noise/electrical_buzzing
Description: A steady electrical buzz, hum, or vibration tone — usually from the dashboard, behind the dash, fuse box, or under the hood near the alternator. Often happens only when a specific accessory is on (headlights, blower fan, turn signals) or, suspiciously, even after the engine is shut off. May be paired with dim/flickering lights, weak battery, or a stuck relay rapidly opening and closing. Distinct from hissing_noise (which is airflow, no electrical pitch) and from high_pitched_whining_under_the_hood (which rises and falls with engine RPM — a buzz is steady at a fixed frequency). Cross-category: a buzz from the speakers belongs to electrical/audio_or_infotainment_issue; a buzz from the AC vents belongs to hvac/strange_noise_from_vents.
Positive examples:
  - "Buzzing noise from the dashboard even after I turn the car off"
  - "Electrical hum from the fuse box when I turn on the headlights"
  - "Loud buzz behind the dash — happens when I use the turn signal"
  - "Continuous electrical buzz under the hood near the battery"
  - "Sounds like a beehive coming from the dash area"
Negative examples:
  - ""Hissing from under the hood" → hissing_noise"
  - ""High whine that rises with the engine" → high_pitched_whining_under_the_hood"
  - ""Buzz/rattle from the AC vents when blower is on high" → hvac/strange_noise_from_vents"
  - ""Humming wheel bearing at highway speed" → humming_or_whirring_at_speed"
  - ""Tick from the engine valvetrain" → engine_ticking_or_tapping"
Synonyms: buzz, buzzing, electrical buzz, electrical hum, dash buzz, fuse box buzz, relay buzz, alternator buzz, beehive sound, vibration tone, 60-cycle hum, electrical noise, steady hum, drone (electrical)

## other/multiple_symptoms_not_sure_what_category
Description: Customer describes TWO OR MORE genuinely UNRELATED problems happening together — e.g., AC stopped working AND a noise from underneath AND a warning light. Pick this ONLY when the description names symptoms across multiple different systems that don't share an obvious common cause. If the customer describes a single symptom (even a strong or scary one), or multiple symptoms within the SAME system (e.g., "brakes squeal and feel mushy"), route to the matching concrete subcategory instead. Distinct from warning_light/multiple_warning_lights_at_once (which is specifically about dashboard lights with no other symptoms named) and from any single-system multi-symptom (which belongs in that system's category).
Positive examples:
  - "My AC stopped working and I'm hearing a noise from underneath, plus the check engine light is on"
  - "There's a few different things going on — it's shaking when I brake, the heat doesn't work, and there's a weird smell"
  - "I've got like three things wrong at once and I don't know where to start"
  - "Multiple problems — battery light, a hissing noise, and it pulls to the left"
  - "Honestly I don't know what category — it's making noises, the AC is weak, and I smell something burning"
Negative examples:
  - ""My brakes squeal and feel mushy" → brakes/spongy_or_soft_pedal (same system; pick the most urgent brake subcategory)"
  - ""The car shakes and the steering wheel vibrates at highway speed" → vibration/steering_wheel_shake_at_highway_speed (same root cause)"
  - ""Multiple warning lights came on at once" → warning_light/multiple_warning_lights_at_once"
  - ""Heat doesn't work and AC is weak" → hvac/heat_doesnt_work or hvac/ac_is_weak_not_cold_enough (same HVAC system; pick the more urgent one)"
  - ""It's making a lot of different noises" → noise/<the loudest or most worrying noise>"
  - ""My car has multiple issues but they all started after I hit a curb" → other/after_a_recent_accident_or_impact (accident context dominates)"
  - ""Lots of things wrong but everything started after my last oil change" → other/after_recent_service_or_repair_work (post-service context dominates)"
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
  - ""Car pulls to the right" (no accident mentioned) → pulling/steady_drift_while_cruising"
  - ""Steering wheel shakes at highway speed" (no impact mentioned) → vibration/steering_wheel_shake_at_highway_speed"
  - ""Bouncing or shaking over bumps" (chronic, no accident named) → vibration/shaking_or_bouncing_over_bumps_and_rough_roads"
  - ""Car pulls left after I got new tires put on" → pulling/pull_that_started_after_recent_tire_or_service_work (service work, NOT accident)"
  - ""Hit a small bump and now there's a rattle" (a bump, not an impact event) → noise/rattling_underneath_the_car (rattle is the symptom; bump too minor to be the framing)"
  - ""Don't feel safe driving it" with no accident mentioned → other/safety_concern_dont_feel_safe_driving_it"
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
  - ""Pull started right after I got new tires" → pulling/pull_that_started_after_recent_tire_or_service_work"
  - ""New vibration after tire rotation" → tires/recent_tire_work_then_new_symptom"
  - ""Brakes squeal" (no recent service named) → brakes/high_pitched_squealing"
  - ""Check engine light came on" (no recent service named) → warning_light/check_engine_light"
  - ""Hit a curb after I got my car back from the shop" → other/after_a_recent_accident_or_impact (accident is the dominant trigger)"
  - ""Multiple things wrong since the last service" → other/after_recent_service_or_repair_work (this — post-service framing dominates)"
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
  - ""Brake pedal goes to the floor" → brakes/pedal_sinks_to_floor (named symptom — that's the route, even though it IS a safety issue)"
  - ""Can barely turn the steering wheel" → steering/hard_to_turn_heavy_steering"
  - ""Car died on the highway and won't restart" → electrical/car_died_while_driving_electrical"
  - ""Smoke coming from under the hood" → smoke/smoke_from_under_the_hood"
  - ""Brakes don't feel right — pedal is soft" → brakes/spongy_or_soft_pedal (named symptom)"
  - ""Steering wheel shakes really bad at highway speed and I'm scared" → vibration/steering_wheel_shake_at_highway_speed (named symptom — the fear is secondary)"
  - ""Don't feel safe after I got rear-ended" → other/after_a_recent_accident_or_impact (accident context dominates)"
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
  - ""Going on a road trip and the brakes are squealing" → brakes/high_pitched_squealing (named symptom dominates)"
  - ""Just bought this used and the check engine light is on" → warning_light/check_engine_light"
  - ""Want a check-up because I'm hearing a noise" → noise/<the specific noise>"
  - ""Multiple warning lights — want a check" → warning_light/multiple_warning_lights_at_once"
  - ""Pre-trip check, but it also pulls to the right" → pulling/steady_drift_while_cruising (named symptom dominates)"
  - ""Haven't driven it in months and want it checked" → other/car_has_been_sitting_unused_for_a_long_time (sat-unused context dominates)"
Synonyms: general inspection, check-up, peace of mind, pre-trip inspection, pre trip check, pre-purchase inspection, PPI, used car inspection, road trip check, going on a trip, just bought it, just purchased, looked it over, once-over, annual check, want it gone over, bumper to bumper check, nothing wrong but, no issues just want, multi-point inspection

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
  - ""Battery is dead — it won't start" (no mention of long storage) → electrical/wont_crank_just_clicks"
  - ""Battery drains overnight" (active daily driver) → electrical/battery_drains_overnight"
  - ""Won't start in the morning" (regular use, just hard to start) → performance/hard_to_start_when_cold"
  - ""Sat overnight and now it won't start" (overnight, not long-term) → electrical/wont_crank_just_clicks"
  - ""Tires are dry-rotted from sitting" (specific tire symptom named) → tires/dry_rot_sidewall_cracking"
  - ""Has been sitting and now I want to take it on a road trip" → other/car_has_been_sitting_unused_for_a_long_time (sat-unused dominates; trip is downstream)"
  - ""Sitting because I got into an accident" → other/after_a_recent_accident_or_impact (accident is the trigger)"
Synonyms: been sitting, hasn't been driven, sat in the garage, sat in storage, garage queen, barn find, hasn't moved, parked for months, parked for years, dormant, long-term storage, hasn't started in months, hasn't run in a while, stored for the winter, parked outside, sat out in the weather, didn't drive it all winter, inherited, project car that sat

## performance/hesitation_or_lag_when_accelerating
Description: A momentary pause, stumble, or delay between when the driver presses the gas pedal and when the engine responds — feels like the car "hiccups" or briefly holds back before catching and pulling normally. Usually short (a second or two) and most noticeable when first stepping on the gas from a stop, while merging, or while passing. Common causes are dirty mass airflow sensor, weak ignition, vacuum leak, or transmission shift delay. Distinct from low_power_or_wont_accelerate_normally (which is SUSTAINED weakness, not a momentary pause) and from engine_misfire_or_bucking_feeling (which is jerky/bucking with skip-a-beat feel, not a smooth delay).
Positive examples:
  - "When I push the gas, there's a delay before the car actually goes"
  - "The car hesitates for a second when I step on it to merge onto the highway"
  - "Feels like a little hiccup right when I take off from a stop sign"
  - "Pedal feels laggy — I press it and the engine takes a moment to wake up"
  - "Briefly bogs down when I floor it, then catches up and goes normally"
Negative examples:
  - ""Car has no power at all and won't pick up speed even pedal to the floor" → low_power_or_wont_accelerate_normally"
  - ""Engine bucks and jerks like it's skipping a beat when I accelerate" → engine_misfire_or_bucking_feeling"
  - ""RPMs go up and down on their own while I'm cruising" → surging_or_rpms_going_up_and_down"
  - ""Engine dies when I come to a stop" → stalling_at_idle_or_when_stopping"
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
  - ""Whole car shakes at idle but the engine sounds normal" → vibration/shaking_at_idle_while_stopped"
  - ""Engine completely dies when I come to a stop" → stalling_at_idle_or_when_stopping"
  - ""RPMs surge up and down on their own without me touching the pedal" → surging_or_rpms_going_up_and_down"
  - ""Engine shakes only when I accelerate, not at idle" → engine_misfire_or_bucking_feeling"
  - ""Steering wheel shakes at highway speed" → vibration/steering_wheel_shake_at_highway_speed"
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
  - ""Engine cuts out while I'm driving on the highway" → stalling_while_driving_under_load"
  - ""Engine shakes at idle but doesn't actually die" → rough_idle_or_shaking_at_a_stop"
  - ""Car cranks and cranks but won't start in the morning" → hard_to_start_when_cold"
  - ""Won't even crank — just a click when I turn the key" → electrical/wont_crank_just_clicks"
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
  - ""Engine dies only when I come to a stop at lights" → stalling_at_idle_or_when_stopping"
  - ""Car loses power on hills but keeps running" → low_power_or_wont_accelerate_normally"
  - ""Engine bucks and jerks but doesn't actually die" → engine_misfire_or_bucking_feeling"
  - ""Cranks but won't start when I try to leave in the morning" → hard_to_start_when_cold"
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
  - ""Hard to start right after I drove it and parked for 10 minutes" → hard_to_start_when_hot"
  - ""Won't crank at all — just makes a clicking sound" → electrical/wont_crank_just_clicks"
  - ""Cranks slow and sounds weak when I turn the key" → electrical/slow_crank_sluggish_start"
  - ""Starts fine but idles rough for a few minutes" → rough_idle_or_shaking_at_a_stop"
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
  - ""Hard to start in the morning after sitting overnight" → hard_to_start_when_cold"
  - ""Engine dies while driving, not when starting" → stalling_while_driving_under_load"
  - ""Cranks slow when I turn the key" → electrical/slow_crank_sluggish_start"
  - ""Won't crank at all" → electrical/wont_crank_just_clicks"
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
  - ""Car hesitates for a second when I press the gas, then catches up" → hesitation_or_lag_when_accelerating"
  - ""Engine bucks and jerks during acceleration" → engine_misfire_or_bucking_feeling"
  - ""Engine just shut off while I was driving" → stalling_while_driving_under_load"
  - ""RPMs surge up and down on their own" → surging_or_rpms_going_up_and_down"
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
  - ""Engine bucks and jerks like it's misfiring" → engine_misfire_or_bucking_feeling"
  - ""Engine shakes and runs rough at idle but RPMs are steady" → rough_idle_or_shaking_at_a_stop"
  - ""Pedal goes lifeless and car feels weak when I accelerate" → low_power_or_wont_accelerate_normally"
  - ""Engine dies at stoplights" → stalling_at_idle_or_when_stopping"
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
  - ""Brief delay when I press the gas, then it goes normally" → hesitation_or_lag_when_accelerating"
  - ""RPMs smoothly go up and down on their own" → surging_or_rpms_going_up_and_down"
  - ""Car just feels weak and won't pick up speed" → low_power_or_wont_accelerate_normally"
  - ""Engine shakes only at idle, not while driving" → rough_idle_or_shaking_at_a_stop"
  - ""Engine completely shut off while driving" → stalling_while_driving_under_load"
Synonyms: misfire, misfires, misfiring, bucking, bucks, jerking, jerks, kicking, kicks, stumbling, stumbles, skipping, skips, skip-a-beat, sputters under load, jerks under acceleration, cylinder misfire, running on 3 cylinders, engine kicking, jerks when I floor it

## pulling/pulling_only_when_braking
Description: The car veers or pulls toward one side only when the brake pedal is pressed, then tracks straight again once the brakes are released. Typically caused by a stuck or sticking brake caliper, a collapsed brake hose, contaminated brake fluid, or uneven pad wear on one side — one wheel's brake grips harder than the other and tugs the car that direction. Distinct from steady_drift_while_cruising (which pulls all the time, not just when braking) and from the brakes/* subcategories that cover pedal feel (spongy, hard, pulsating) or noise (squealing, grinding) without a directional pull.
Positive examples:
  - "Car pulls hard to the right every time I hit the brakes"
  - "Steering wheel jerks left when I brake"
  - "Only pulls to one side when I'm slowing down — drives straight otherwise"
  - "When I brake on the highway it veers into the next lane"
  - "Smells like burning brake on one wheel and pulls when I stop"
Negative examples:
  - ""Brake pedal pulsates when I stop" → brakes/pulsating_or_vibrating_pedal"
  - ""Pedal sinks to the floor when I press it" → brakes/pedal_sinks_to_floor"
  - ""Brakes squeal but car drives straight" → brakes/high_pitched_squealing"
  - ""Car drifts to the right all the time, not just when braking" → steady_drift_while_cruising"
  - ""Pedal feels hard, takes a lot of force to stop" → brakes/hard_or_unresponsive_pedal"
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
  - ""Only pulls when I brake" → pulling_only_when_braking"
  - ""Only drifts on certain roads or in certain lanes" → drift_that_follows_the_roads_slope"
  - ""Car wanders both ways, never settles" → wandering_or_drifting_in_both_directions"
  - ""Started pulling right after I got new tires" → pull_that_started_after_recent_tire_or_service_work"
  - ""Steering wheel is off-center when I'm going straight" → steering/steering_wheel_off_center_when_driving_straight"
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
  - ""Pulls all the time, not just when accelerating" → steady_drift_while_cruising"
  - ""Only pulls when I brake" → pulling_only_when_braking"
  - ""Engine feels weak and sluggish when I accelerate" → performance/lacks_power_or_acceleration"
  - ""Steering feels loose and wanders all over" → wandering_or_drifting_in_both_directions"
  - ""Clunking from the front end when I accelerate" → noise/clunking_or_knocking_from_front_end"
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
  - ""Pulls the same direction on every single road, even flat parking lots" → steady_drift_while_cruising"
  - ""Only pulls when I brake" → pulling_only_when_braking"
  - ""Only pulls when I accelerate" → pulling_only_during_acceleration"
  - ""Started right after I got new tires" → pull_that_started_after_recent_tire_or_service_work"
  - ""Car wanders both ways, doesn't follow the road" → wandering_or_drifting_in_both_directions"
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
  - ""Has always pulled to the right, no recent service" → steady_drift_while_cruising"
  - ""Only pulls when I brake — had brake work recently" → pulling_only_when_braking"
  - ""Recent service and the car runs rough, doesn't pull" → other/after_recent_service_or_repair_work"
  - ""New tires and now it vibrates at highway speed" → vibration/vibration_at_highway_speed"
  - ""Recent tire work and now low pressure warning is on" → tires/low_pressure_warning_light_only"
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
  - ""Pulls steady to the right, same direction every time" → steady_drift_while_cruising"
  - ""Steering wheel feels loose but car tracks straight" → steering/loose_or_sloppy_steering"
  - ""Steering wheel is tilted off-center when going straight" → steering/steering_wheel_off_center_when_driving_straight"
  - ""Front end clunks over bumps" → noise/clunking_or_knocking_from_front_end"
  - ""Vibrates at highway speed but goes straight" → vibration/vibration_at_highway_speed"
Synonyms: wanders, wandering, drifts both ways, all over the road, won't stay straight, loose front end, sloppy tracking, unpredictable steering, drifts side to side, tramlining, front end wander, hunts left and right, loose steering feel

## smell/sweet_smell_maple_syrup_antifreeze
Description: A distinctive sweet, syrupy odor — most often described like maple syrup, pancake syrup, or "that antifreeze smell" — coming from the car. The smell is ethylene-glycol vapor from a coolant leak dripping onto hot engine parts, most noticeable after driving when the engine is fully warm. Distinct from `leak/green_orange_yellow_or_pink_puddle_coolant` — pick that leak slug when the customer LEADS with a visible green / orange / pink puddle; pick this `smell/` slug when they LEAD with the sweet odor and haven't mentioned a puddle. Distinct from `hvac/bad_smell_from_vents` — pick HVAC when the sweet smell is clearly arriving through the dash vents with the heat on (heater-core leak); pick this `smell/` slug when the sweet smell is from under the hood, around the outside of the car, or "just everywhere".
Positive examples:
  - "Sweet smell coming from under the hood after I drive"
  - "Smells like maple syrup around my car, kind of sticky-sweet"
  - "Antifreeze smell when the engine gets warm"
  - "Sweet, syrupy smell — temperature gauge has been running a little hot too"
  - "There's a sweet pancake-syrup smell when I park, no leak I can find yet"
  - "Sweet chemical smell, almost like cough syrup, from the engine area"
Negative examples:
  - ""Bright green puddle under the front of the car" → leak/green_orange_yellow_or_pink_puddle_coolant"
  - ""Sweet smell coming through the vents when the heat is on, windows fog up" → hvac/bad_smell_from_vents"
  - ""Sweet smell AND wet passenger floor carpet" → hvac/bad_smell_from_vents"
  - ""Burning oil smell from under the hood" → burnt_oil_smell"
  - ""Sticky red puddle under the middle of the car" → leak/red_or_pink_puddle_transmission_or_power_steering"
Synonyms: sweet smell, syrupy smell, maple syrup smell, pancake syrup smell, antifreeze smell, coolant smell, glycol smell, sweet chemical smell, sugary smell, cough syrup smell, sweet engine smell, sweet odor from under hood, sweet smell when driving, sweet smell when warm

## smell/burnt_oil_smell
Description: A greasy, hot-petroleum smell of engine oil burning — usually most noticeable after the car has been driven hard or sat idling, when the engine is fully hot. Caused by engine oil leaking from a gasket (valve cover, oil pan, main seal) onto a hot exhaust component, where it sizzles and smokes off. Customers say "burning oil", "hot oil", "burnt oil", or "burning smell from under the hood after I drive". Distinct from `leak/brown_or_black_puddle_engine_oil` — pick the leak slug when the customer leads with a visible dark puddle; pick this `smell/` slug when they lead with the odor. Distinct from `burning_rubber_hot_brake_smell` — burnt oil comes from UNDER THE HOOD and smells petroleum-greasy; hot brakes come from A WHEEL and smell sharper / more rubbery. Distinct from `burning_electrical_plastic_smell` — burnt oil is greasy and rich; burning electrical is sharp and acrid.
Positive examples:
  - "Burning oil smell after I drive, especially in parking lots"
  - "Smells like hot oil under the hood, kind of greasy and burnt"
  - "Burnt motor oil smell when I idle for a while"
  - "Greasy burning smell from the engine bay after a highway run"
  - "I keep smelling oil burning — like a drip on the exhaust manifold"
  - "Hot petroleum smell from under the hood, no smoke I can see yet"
Negative examples:
  - ""Dark brown oily puddle in my driveway" → leak/brown_or_black_puddle_engine_oil"
  - ""Burning rubber smell from one of the wheels after braking" → burning_rubber_hot_brake_smell"
  - ""Sharp burning plastic smell from the dash" → burning_electrical_plastic_smell"
  - ""Sweet maple syrup smell from under the hood" → sweet_smell_maple_syrup_antifreeze"
  - ""Black smoke from the tailpipe and burning oil smell" → smoke/blue_or_gray_smoke_from_tailpipe"
Synonyms: burnt oil smell, burning oil smell, hot oil smell, burning motor oil, burning engine oil, oil burning smell, greasy burning smell, hot petroleum smell, oil on exhaust smell, valve cover leak smell, oil dripping on manifold smell, smoldering oil smell

## smell/gasoline_fuel_smell
Description: The unmistakable smell of raw gasoline — fuel, petrol, gas fumes — coming from somewhere on the car. Most often noticed inside the cabin, around the gas-cap area after fill-up, under the hood near the engine, or "just everywhere" around the car when parked. Causes range from harmless (loose gas cap, recent fill-up spill) to serious (cracked fuel line, leaking injector, failing EVAP canister, pinhole in the tank). Any persistent fuel odor is a fire-and-fumes safety concern. Distinct from `exhaust_fumes_inside_the_cabin` — raw gasoline smells fresh and sharp like the pump (unburned hydrocarbon); exhaust smells smoky and burnt. Distinct from `performance/stalling_while_driving_under_load` — pick this `smell/` subcategory when the LEAD complaint is the gas smell; pick the performance slug when the LEAD complaint is the engine sputtering / stalling with no smell mentioned. If both, smell/ usually wins because raw fuel is a fire hazard.
Positive examples:
  - "I smell gas inside my car when I'm driving"
  - "Strong gasoline smell around the car after I fill up"
  - "Fuel smell from under the hood, like raw gas"
  - "Petrol smell in the cabin when the heat is on, makes me lightheaded"
  - "Whole garage smells like gasoline when I park"
  - "Gas fumes when I start the car cold in the morning"
Negative examples:
  - ""Exhaust / tailpipe smell inside the car when driving" → exhaust_fumes_inside_the_cabin"
  - ""Rotten egg smell from the exhaust" → rotten_egg_sulfur_smell"
  - ""Engine sputters and stalls under throttle, no smell" → performance/stalling_while_driving_under_load"
  - ""Burning oil smell from the engine bay" → burnt_oil_smell"
  - ""Sweet syrup smell from the engine" → sweet_smell_maple_syrup_antifreeze"
Synonyms: gas smell, gasoline smell, gasoline odor, fuel smell, petrol smell, raw gas smell, gas fumes, fuel fumes, smell of gasoline, car smells like gas, gas leak smell, smell of fuel inside cabin, gas cap smell, evap leak smell, fuel vapor smell

## smell/rotten_egg_sulfur_smell
Description: A foul, eggy, sulfur smell — customers nearly always describe it as "rotten eggs" — coming from the exhaust, the engine area, or sometimes from under the hood near the battery. The smell is hydrogen sulfide (H2S), a byproduct of fuel combustion that a healthy catalytic converter is supposed to convert to odorless sulfur dioxide. When the cat is failing, the engine is running too rich, the battery is overcharging / venting, or a manual-transmission fluid leaks onto something hot, the rotten-egg smell escapes. Most noticeable while driving or right after parking. Distinct from `exhaust_fumes_inside_the_cabin` — that slug covers the general "tailpipe smell in the cabin" complaint that may or may not be sulfur; this slug is for when the customer specifically calls out rotten eggs or sulfur. Distinct from `leak/thick_dark_brown_puddle_gear_or_differential_oil` — gear oil also smells sulfurous, but that's a PUDDLE-LED report; this is a SMELL-LED report.
Positive examples:
  - "My car smells like rotten eggs from the exhaust"
  - "Strong sulfur smell when I drive, especially under acceleration"
  - "Eggy smell out of the tailpipe — getting worse"
  - "Smells like a swamp / sewer behind the car when I'm idling"
  - "Awful sulfur stench from under the hood, maybe near the battery"
  - "Hydrogen sulfide / rotten egg smell when the engine is hot"
Negative examples:
  - ""General exhaust / tailpipe smell in the cabin" → exhaust_fumes_inside_the_cabin"
  - ""Thick dark fluid under the rear axle that smells like sulfur" → leak/thick_dark_brown_puddle_gear_or_differential_oil"
  - ""Burning rubber from a wheel after braking" → burning_rubber_hot_brake_smell"
  - ""Gas / fuel smell, not eggy" → gasoline_fuel_smell"
  - ""Black smoke from the tailpipe" → smoke/black_smoke_from_tailpipe"
Synonyms: rotten egg smell, rotten eggs, sulfur smell, sulphur smell, eggy smell, hydrogen sulfide smell, H2S smell, swampy smell, sewer smell from exhaust, foul exhaust smell, sulfurous smell, bad egg smell, sulfur from tailpipe, sulfur from battery

## smell/burning_electrical_plastic_smell
Description: A sharp, acrid, chemical smell — customers describe it as "burning plastic", "burning electrical", "melting wires", "burning electronics", or sometimes "burning hair" — distinct from the greasier smell of burning oil or rubber. Caused by overheating wiring insulation, a melting fuse-box / relay, a shorted accessory, or aftermarket wiring drawing too much current. Often accompanies dim / flickering lights. STOP-AND-INSPECT-NOW safety signal — electrical fires escalate fast. Distinct from `burnt_oil_smell` — burnt oil is greasy / petroleum; this is sharp / chemical / acrid. Distinct from `burning_rubber_hot_brake_smell` — hot brakes come from a wheel; this comes from the dash, fuse box, or wiring. Distinct from `electrical/multiple_random_electrical_glitches` and `electrical/dim_or_flickering_lights` — pick this `smell/` slug when the SMELL is the lead signal; pick the electrical slugs when the symptom is the lead.
Positive examples:
  - "Burning plastic smell from the dashboard, no smoke yet"
  - "Smells like burning electrical wires / melting plastic inside the car"
  - "Acrid chemical burning smell from the fuse box area"
  - "I think I smell burning electronics — like a hot circuit board"
  - "Burning hair / burning plastic smell, lights are flickering at the same time"
  - "Sharp burning smell from under the dash when I run the heater fan"
Negative examples:
  - ""Greasy burning oil smell from under the hood" → burnt_oil_smell"
  - ""Burning rubber smell from a wheel after I brake" → burning_rubber_hot_brake_smell"
  - ""Lights flicker but no burning smell" → electrical/dim_or_flickering_lights"
  - ""Multiple random electrical glitches, no smell" → electrical/multiple_random_electrical_glitches"
  - ""Musty / mildew smell from the carpet" → musty_mildew_smell_from_vents"
Synonyms: burning plastic smell, burning electrical smell, electrical burning smell, melting plastic smell, melting wires smell, burning wires smell, burning electronics, burning circuit smell, acrid burning smell, chemical burning smell, hot wire smell, burning hair smell, fuse box burning smell, hot insulation smell, plasticky burning smell

## smell/burning_rubber_hot_brake_smell
Description: A sharp, hot, rubbery / scorched smell — customers say "burning rubber", "hot brakes", "scorched", "acrid hot smell" — typically coming from one or more wheels after braking hard, descending a hill, or driving with the parking brake partially engaged. Caused by overheated brake pads / rotors (stuck caliper, dragging brake, prolonged hard braking) or, less commonly, a slipping drive belt. Distinct from `burnt_oil_smell` — burnt oil is greasy and from UNDER THE HOOD; hot brakes are sharp / rubbery and from A WHEEL. Distinct from `burning_electrical_plastic_smell` — that's acrid / chemical from the dash; this is rubbery / hot from a wheel. Distinct from `brakes/metallic_grinding` — that's the GRINDING NOISE on pedal press; this is the SMELL of overheated brake friction. Distinct from `smoke/smoke_or_burning_smell_from_a_wheel` — pick the smoke slug when the customer SEES actual smoke; pick this slug when they only SMELL the burning.
Positive examples:
  - "Burning rubber smell from one of my wheels after I drove down a hill"
  - "Hot brake smell when I get out of the car, especially the front wheels"
  - "Sharp burning rubber smell after stop-and-go traffic"
  - "Scorched / acrid smell from the rear — pretty sure I left the parking brake on"
  - "Brakes smell hot and burnt after a long drive on the highway"
  - "Burning rubber smell when I get out, one wheel is way hotter than the others"
Negative examples:
  - ""Burning oil smell from under the hood" → burnt_oil_smell"
  - ""Burning plastic / electrical smell from the dash" → burning_electrical_plastic_smell"
  - ""Grinding noise when I press the brake pedal" → brakes/metallic_grinding"
  - ""Visible smoke coming from a wheel" → smoke/smoke_or_burning_smell_from_a_wheel"
  - ""Sweet / syrupy smell from the engine area" → sweet_smell_maple_syrup_antifreeze"
Synonyms: burning rubber smell, hot brake smell, hot brakes smell, brakes burning, brakes burning smell, scorched smell from wheel, acrid wheel smell, burnt brake smell, overheated brakes smell, dragging brake smell, parking brake burning, stuck caliper smell, brake pad burning, hot rubber smell, friction burning smell

## smell/musty_mildew_smell_from_vents
Description: A musty, moldy, mildewy, "funky" smell — customers describe it as "dirty socks", "gym socks", "locker room", "wet dog", "damp basement", "stale", "swampy", or "moldy". Caused by bacteria / mold in damp carpet, a wet trunk liner, soaked floor mats, or upholstery (NOT vent-routed). **ROUTING:** when the customer clearly ties the smell to the dash vents / AC / heat, the canonical destination is `hvac/bad_smell_from_vents` (7 dedicated diagnostic questions for vent-routed odors). Use THIS `smell/` slug when the smell is mildewy but NOT tied to vent airflow — e.g., moldy carpet, musty trunk smell, damp basement smell after the car got rained in, wet-dog smell from upholstery, mildew smell from a forgotten gym bag in the back seat. When in doubt and vents are involved, prefer HVAC.
Positive examples:
  - "Musty smell from the back seat / floor carpet, especially when it rains"
  - "Moldy / mildewy smell from the trunk after I had water in there"
  - "Wet dog smell from the upholstery, won't go away"
  - "Damp basement smell from the rear of the car"
  - "Funky locker-room smell from the back seat"
  - "Mildew smell from the carpet, no obvious wet spot"
Negative examples:
  - ""Musty smell when I turn on the AC" → hvac/bad_smell_from_vents"
  - ""Dirty sock smell from the vents" → hvac/bad_smell_from_vents"
  - ""Moldy smell from the dash when heat is on" → hvac/bad_smell_from_vents"
  - ""Sweet syrupy smell, not musty" → sweet_smell_maple_syrup_antifreeze"
  - ""Burning electrical smell from the dash" → burning_electrical_plastic_smell"
Synonyms: musty smell, moldy smell, mildew smell, mildewy smell, funky smell, dirty sock smell, gym sock smell, locker room smell, wet dog smell, damp basement smell, swampy smell, stale smell, mold smell, mildew odor, basement smell, damp smell, dank smell, wet carpet smell, sour smell

## smell/exhaust_fumes_inside_the_cabin
Description: The unmistakable smoky, sooty smell of exhaust fumes (the kind of smell you get standing right behind a tailpipe) getting inside the cabin while driving. Customers say "exhaust in the car", "fumes coming inside", "tailpipe smell in the cabin", "smells like the muffler is in the car with me". Caused by a cracked exhaust manifold, a hole in the muffler / exhaust pipe, a bad manifold gasket, or a worn door / trunk seal letting fumes in. **CARBON MONOXIDE SAFETY EMERGENCY** — CO itself is odorless, but exhaust smell means the exhaust path into the cabin is open and CO is along for the ride. Distinct from `rotten_egg_sulfur_smell` — that's specifically a sulfur smell from a failing catalytic converter; this is general smoky exhaust. Distinct from `gasoline_fuel_smell` — raw gasoline smells sharp / fresh; exhaust smells smoky / burnt. Distinct from `burnt_oil_smell` — burnt oil is greasy and from under the hood; exhaust is sooty and inside the cabin.
Positive examples:
  - "I smell exhaust fumes inside the car when I'm driving"
  - "Tailpipe smell in the cabin, especially at stoplights"
  - "Exhaust fumes coming through the vents, makes me lightheaded"
  - "Smells like the muffler is leaking into the car with me"
  - "Smoky exhaust smell in the cabin, hissing noise too"
  - "Fumes coming inside the car, getting headaches when I drive"
Negative examples:
  - ""Rotten egg / sulfur smell from the exhaust" → rotten_egg_sulfur_smell"
  - ""Raw gasoline / fuel smell inside the car" → gasoline_fuel_smell"
  - ""Burning oil smell from under the hood" → burnt_oil_smell"
  - ""Musty / moldy smell from the vents" → hvac/bad_smell_from_vents"
  - ""Black smoke from the tailpipe" → smoke/black_smoke_from_tailpipe"
Synonyms: exhaust smell, exhaust fumes, tailpipe smell, exhaust in cabin, fumes inside car, exhaust in the car, smoky cabin smell, exhaust leak smell, manifold leak smell, CO smell, carbon monoxide leak, exhaust coming through vents, muffler smell inside, smoky burnt smell inside, exhaust gas in cabin

## smoke/white_smoke_from_tailpipe
Description: Persistent white smoke coming out of the exhaust pipe at the back of the vehicle, often with a sweet or syrupy smell, frequently paired with a dropping coolant level or the temperature gauge creeping up. Typically caused by coolant leaking into the cylinders through a failed head gasket, cracked head, or bad intake gasket — the coolant gets burned along with the fuel and exits as white smoke. Distinct from normal cold-morning steam (thin wispy vapor that clears within a minute or two of warm-up, no smell — NOT this subcategory) and distinct from blue_or_gray_smoke_from_tailpipe (oil burning — oily smell, not sweet).
Positive examples:
  - "Lots of white smoke coming out of the tailpipe even after I've been driving for 20 minutes"
  - "Thick white smoke from the exhaust and it smells kind of sweet"
  - "My car is blowing white smoke and I've had to add coolant twice this week"
  - "White cloud out the back, temperature gauge is running high"
  - "Persistent white smoke from the exhaust pipe, doesn't go away when the engine warms up"
Negative examples:
  - ""A little white steam from the tailpipe on cold mornings that goes away" → (normal — no subcategory)"
  - ""Blue smoke from the tailpipe when I start it up" → blue_or_gray_smoke_from_tailpipe"
  - ""Black smoke from the exhaust when I floor it" → black_smoke_from_tailpipe"
  - ""Sweet smell but no visible smoke" → sweet_smell_maple_syrup_antifreeze"
  - ""Smoke coming from under the hood, not the tailpipe" → smoke_from_under_the_hood"
Synonyms: white smoke, white exhaust, white cloud, white vapor, steam from exhaust, coolant smoke, head gasket smoke, thick white smoke, milky exhaust, sweet smoke, syrupy smoke

## smoke/blue_or_gray_smoke_from_tailpipe
Description: Bluish or grayish smoke coming out of the tailpipe, often with an oily or acrid burnt-oil smell, sometimes only on cold startup or only under hard acceleration. Caused by motor oil getting into the combustion chambers through worn valve seals (typically smoke on startup that fades), worn piston rings (smoke under load or all the time), or a failing turbocharger. The vehicle usually burns through oil between changes without obvious leaks on the ground. Distinct from white_smoke_from_tailpipe (coolant — sweet smell, not oily) and distinct from black_smoke_from_tailpipe (rich fuel — gasoline smell, not burnt-oil smell).
Positive examples:
  - "Blue smoke comes out of the tailpipe when I first start it in the morning"
  - "Cloud of blue-gray smoke every time I floor it onto the highway"
  - "Burning oil smell with grayish smoke from the exhaust"
  - "I keep having to add a quart of oil and there's no leak — there's gray smoke too"
  - "Blue smoke when I let off the gas going downhill"
Negative examples:
  - ""White smoke from the tailpipe with a sweet smell" → white_smoke_from_tailpipe"
  - ""Black smoke when I accelerate hard" → black_smoke_from_tailpipe"
  - ""Burning oil smell but I don't see smoke" → burnt_oil_smell"
  - ""Smoke coming from under the hood after a long drive" → smoke_from_under_the_hood"
  - ""Oil dripping on the ground in the driveway" → brown_or_black_puddle_engine_oil"
Synonyms: blue smoke, gray smoke, grey smoke, oil smoke, burning oil smoke, bluish exhaust, smoky exhaust, oily smoke, exhaust smoke on startup, smoke on acceleration

## smoke/black_smoke_from_tailpipe
Description: Black or dark sooty smoke from the tailpipe, often with a strong raw-fuel smell (gasoline or diesel) and frequently paired with worse fuel mileage, rough running, or a check engine light. Caused by the engine running rich — too much fuel for the air available — usually from a clogged air filter, failing oxygen or MAF sensor, leaking fuel injector, or a stuck-open fuel pressure regulator. Diesel exception: a small puff of black smoke under hard acceleration on a diesel is often normal turbo-lag and not by itself a problem; thick, persistent black smoke or black smoke at idle on a diesel is. Distinct from white_smoke_from_tailpipe (coolant — sweet smell) and blue_or_gray_smoke_from_tailpipe (oil — burnt-oil smell).
Positive examples:
  - "Black smoke pours out of the tailpipe when I stomp on the gas"
  - "Dark sooty smoke from the exhaust and it smells like raw gas"
  - "Diesel is blowing thick black smoke even at idle"
  - "Fuel mileage tanked and there's black smoke from the back"
  - "Check engine light came on and now black smoke when I accelerate"
Negative examples:
  - ""White smoke from the tailpipe, sweet smell" → white_smoke_from_tailpipe"
  - ""Blue smoke when I start it cold" → blue_or_gray_smoke_from_tailpipe"
  - ""Diesel puffs a tiny bit of black smoke only on hard acceleration, otherwise fine" → (normal — no subcategory)"
  - ""Strong gas smell but no visible smoke" → gasoline_fuel_smell"
  - ""Black smoke from under the hood" → smoke_from_under_the_hood"
Synonyms: black smoke, dark smoke, sooty smoke, soot from exhaust, rich smoke, fuel smoke, dirty exhaust, dark exhaust cloud, black puff from tailpipe, rolling coal

## smoke/smoke_from_under_the_hood
Description: Visible smoke or steam coming up from under the hood while driving or right after stopping, often with a burning smell whose character (sweet / burnt-oil / electrical-plastic) hints at the source. Typical causes: oil dripping onto the hot exhaust manifold from a leaking gasket or seal (burnt-oil smoke), coolant boiling over from overheating (sweet steam with high temp gauge), spilled fluids from a recent oil change or repair, or an electrical short / failing alternator (acrid plastic-burn smoke). The customer SEES smoke under the hood — not just a smell. Distinct from burnt_oil_smell, burning_electrical_plastic_smell, and sweet_smell_maple_syrup_antifreeze (those are smell-only with no visible smoke) and distinct from smoke_or_strong_smell_inside_the_cabin (smoke inside the passenger compartment, not the engine bay).
Positive examples:
  - "Smoke is coming out from under the hood when I pop it open"
  - "Steam pouring out of the engine bay and the temp gauge is in the red"
  - "I see smoke around the engine and it smells like burning oil"
  - "Wisps of smoke from under the hood after I drive for a while"
  - "Smoke from the engine compartment and a burning plastic smell"
Negative examples:
  - ""Burning oil smell but I don't see any smoke" → burnt_oil_smell"
  - ""Burning plastic smell but no visible smoke" → burning_electrical_plastic_smell"
  - ""White smoke from the tailpipe" → white_smoke_from_tailpipe"
  - ""Sweet smell, coolant low, no smoke" → sweet_smell_maple_syrup_antifreeze"
  - ""Smoke coming out of one wheel" → smoke_or_burning_smell_from_a_wheel"
Synonyms: engine smoke, smoke from engine, smoke under hood, hood smoke, smoking engine, engine bay smoke, steam from hood, vapor from engine, smoking under the bonnet, engine smoking

## smoke/smoke_or_burning_smell_from_a_wheel
Description: Smoke or a strong burning smell coming from one specific wheel (or all four wheels), usually after braking heavily, riding the brakes downhill, sitting in stop-and-go traffic, or driving with the parking brake partly engaged. Almost always brake-related overheating: a stuck or seized brake caliper that won't release, a dragging pad, a frozen parking brake, or pads worn down to the metal backing plate. The affected wheel feels noticeably hotter than the others. Distinct from metallic_grinding (metal-on-metal sound when braking — may co-occur but the primary symptom there is grinding noise) and distinct from burning_rubber_hot_brake_smell (smell-only with no visible smoke from the wheel — when no smoke is seen, route there).
Positive examples:
  - "Smoke coming off my front driver-side wheel after I drove home"
  - "One wheel is smoking and smells like hot metal"
  - "Burning smell from the right rear wheel and a little smoke"
  - "Smoke off all four wheels after a long downhill"
  - "I think I left the parking brake on and now there's smoke from the back wheel"
Negative examples:
  - ""Burning rubber smell but I don't see smoke from the wheels" → burning_rubber_hot_brake_smell"
  - ""Grinding noise when I brake" → metallic_grinding"
  - ""Smoke from under the hood" → smoke_from_under_the_hood"
  - ""Hot brake smell after a long downhill, no smoke" → burning_rubber_hot_brake_smell"
  - ""Car pulls when braking, no smoke" → pulling_only_when_braking"
Synonyms: smoking wheel, smoke from tire, smoking brakes, hot wheel, brake smoke, wheel on fire, smoke from rim, burning brake smoke, dragging brake smoke, stuck caliper smoke

## smoke/smoke_or_strong_smell_inside_the_cabin
Description: Visible smoke, haze, or a strong burning smell inside the passenger compartment — often coming out of the dashboard vents when the heater or AC is running, or seeping in from somewhere with no obvious vent source. Possible causes range from relatively minor (dust or leaves burning off the heater core the first time heat is used in fall) to serious safety issues (overheated blower motor wiring, melted insulation, an electrical short behind the dash, or a heater core leak putting coolant vapor into the cabin). This subcategory is for smoke-PRIMARY or strong-smell-with-likely-source-inside-the-cabin events, and is treated as urgent because of fire risk. Distinct from exhaust_fumes_inside_the_cabin (smelling exhaust fumes without visible smoke — route there if no smoke is seen and the smell is clearly exhaust) and distinct from musty_mildew_smell_from_vents / bad_smell_from_vents (musty or moldy smell, not burning).
Positive examples:
  - "I can see smoke coming out of my dashboard vents"
  - "Strong burning plastic smell inside the car and a little haze"
  - "Cabin filled up with smoke while I was driving"
  - "Burning smell from the vents got really strong, I had to pull over"
  - "Smoke coming through the dash when I turned the heat on"
Negative examples:
  - ""Exhaust fumes smell inside the car but no smoke" → exhaust_fumes_inside_the_cabin"
  - ""Burning plastic smell but no visible smoke and not sure where it's from" → burning_electrical_plastic_smell"
  - ""Musty smell from the AC vents" → musty_mildew_smell_from_vents"
  - ""Smoke coming up from under the hood" → smoke_from_under_the_hood"
  - ""Sweet smell from the vents, no smoke" → bad_smell_from_vents"
Synonyms: smoke in cabin, smoke inside car, smoke from vents, dashboard smoke, cabin smoke, smoke in the car, haze inside car, smoke from dash, vent smoke, interior smoke, smoking dashboard

## steering/hard_to_turn_heavy_steering
Description: The steering wheel takes significantly more effort to turn than it used to — often most noticeable at low speeds in parking lots and during three-point turns, where the driver has to "crank the wheel" or use both hands. Most commonly caused by a low or leaking power steering fluid level, a failing power steering pump (often accompanied by a whine or groan), a loose or worn serpentine belt, an electric power steering (EPS) motor or module fault, or low tire pressure. Distinct from loose_or_sloppy_steering (which is the opposite problem — the wheel is too easy to move and has play) and from noise_when_turning_the_steering_wheel (which focuses on the SOUND of turning rather than the EFFORT).
Positive examples:
  - "Steering wheel is really hard to turn, especially in parking lots"
  - "Have to use both hands to turn the wheel — it's gotten really stiff"
  - "Power steering feels like it quit — wheel takes way more effort now"
  - "Wheel is heavy at low speeds but feels normal on the highway"
  - "Almost lost the power steering — it went stiff overnight"
Negative examples:
  - ""Steering wheel feels loose with a lot of play" → loose_or_sloppy_steering"
  - ""Whining noise when I turn the wheel but it turns fine" → noise_when_turning_the_steering_wheel"
  - ""Steering wheel is tilted to one side when I drive straight" → steering_wheel_off_center_when_driving_straight"
  - ""Whine from under the hood, gets louder as engine revs" → noise/high_pitched_whining_under_the_hood"
  - ""Red puddle under the front of the car" → leak/red_or_pink_puddle_transmission_or_power_steering"
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
  - ""Steering wheel is hard to turn, takes a lot of effort" → hard_to_turn_heavy_steering"
  - ""Car wanders both ways even though the wheel feels tight" → pulling/wandering_or_drifting_in_both_directions"
  - ""Steering wheel is tilted off-center going straight" → steering_wheel_off_center_when_driving_straight"
  - ""Car pulls steady to the right all the time" → pulling/steady_drift_while_cruising"
  - ""Clunk when I hit bumps, felt in the wheel" → clunking_knocking_or_rough_ride_over_bumps"
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
  - ""Steering wheel is straight but car pulls to the right" → pulling/steady_drift_while_cruising"
  - ""Wheel feels loose with a lot of play" → loose_or_sloppy_steering"
  - ""Wheel shakes at highway speed" → steering_wheel_shakes_at_highway_speed"
  - ""Drifts on crowned roads, fine on flat parking lots" → pulling/drift_that_follows_the_roads_slope"
  - ""Car wanders both ways" → pulling/wandering_or_drifting_in_both_directions"
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
  - ""Clicking from the front wheels when I turn at parking-lot speed" → noise/popping_or_clicking_when_turning"
  - ""Whine under the hood all the time, gets louder with RPM" → noise/high_pitched_whining_under_the_hood"
  - ""Squeak going over bumps" → noise/squeaking_or_creaking_over_bumps"
  - ""Steering wheel is hard to turn but no noise" → hard_to_turn_heavy_steering"
  - ""Clunk when I hit a bump, felt in the wheel" → clunking_knocking_or_rough_ride_over_bumps"
Synonyms: whine when turning, groan when turning, moan when turning, growl when turning, hum when turning, creak when turning, power steering whine, power steering noise, steering pump noise, noise turning the wheel, noise turning steering wheel, whining steering, groaning steering, power steering moan, wheel noise

## steering/steering_wheel_shakes_at_highway_speed
Description: The steering wheel shakes, shimmies, or wobbles in the driver's hands at highway speed — typically starting between 50 and 70 mph, often steady at a given speed and sometimes smoothing out at higher speeds. The customer's primary framing is the WHEEL ITSELF shaking (not the seat, not the whole car). Distinct from vibration/steering_wheel_shake_at_highway_speed (which is the SAME physical symptom but framed differently by the customer — choose this STEERING subcategory when the customer says "the wheel shakes" or "shimmy in the wheel"; choose the vibration subcategory when the customer says "vibration in the wheel" or describes it as part of a broader car-vibration complaint). Also distinct from clunking_knocking_or_rough_ride_over_bumps (which is bump-triggered, not speed-triggered) and from pulling_drifting_or_wandering_on_the_road (which is a directional issue, not a shake).
Positive examples:
  - "Steering wheel shakes really bad around 60 mph"
  - "Wheel shimmies in my hands on the highway"
  - "Wheel wobbles between 55 and 65, smooths out after that"
  - "Just the steering wheel shaking, the seat feels fine"
  - "Hit a pothole and now the wheel goes into a violent shake at 50 mph — death wobble"
Negative examples:
  - ""Whole car vibrates at highway speed, not just the wheel" → vibration/steering_wheel_shake_at_highway_speed"
  - ""Vibration through the seat and floor at speed" → vibration/steering_wheel_shake_at_highway_speed"
  - ""Steering wheel shakes only when I press the brakes" → vibration/vibration_or_pulsing_when_braking"
  - ""Car shakes at idle when stopped" → vibration/shaking_at_idle_while_stopped"
  - ""Wheel feels loose but doesn't shake" → loose_or_sloppy_steering"
Synonyms: steering wheel shake, steering wheel shakes, wheel shimmy, shimmy in the wheel, wheel wobble, wheel wobbles, shaky wheel, wheel vibration at speed, wheel shudders, wheel quivers in my hands, death wobble, highway speed shake, wheel goes into a shake, front-end shimmy, balance shake, wheel weight off

## steering/pulling_drifting_or_wandering_on_the_road
Description: A pulling, drifting, or wandering complaint where the customer's primary framing mixes wheel-feel with car-direction — they describe the car not tracking straight AND the steering wheel feeling involved (drifts, wanders, has to fight the wheel) without cleanly separating the two. Most commonly caused by wheel alignment out of spec, uneven tire pressure or wear, worn tie rods / ball joints / wheel bearings, or a tire defect (conicity). Distinct from pulling/steady_drift_while_cruising (which is a clean directional-only complaint that always pulls one way), pulling/drift_that_follows_the_roads_slope (slope-dependent), pulling/wandering_or_drifting_in_both_directions (clean bi-directional wander complaint), and loose_or_sloppy_steering (where the wheel itself has play but the car tracks straight).
Positive examples:
  - "Car kind of drifts and the wheel feels weird"
  - "Wheel wants to pull to the right and I'm always correcting"
  - "Steering feels off — car wanders and I'm fighting the wheel"
  - "Pulls to one side and the wheel feels loose at the same time"
  - "Something's wrong with the steering — it won't drive straight"
Negative examples:
  - ""Pulls steady to the right on every road" → pulling/steady_drift_while_cruising"
  - ""Only pulls when I brake" → pulling/pulling_only_when_braking"
  - ""Only pulls when I accelerate" → pulling/pulling_only_during_acceleration"
  - ""Drifts on crowned roads, straight in parking lots" → pulling/drift_that_follows_the_roads_slope"
  - ""Car wanders both ways constantly" → pulling/wandering_or_drifting_in_both_directions"
  - ""Wheel is loose with play but car tracks straight" → loose_or_sloppy_steering"
  - ""Steering wheel is tilted but car drives straight" → steering_wheel_off_center_when_driving_straight"
Synonyms: car drifts, car wanders, won't drive straight, wheel pulls, steering pulls, drifts and wanders, fighting the wheel, can't drive straight, pulls and wanders, steering feels off, drifts to one side, wheel wants to go, won't track straight, hunts back and forth, weaves on the road

## steering/clunking_knocking_or_rough_ride_over_bumps
Description: A clunk, knock, jolt, or harsh impact transmitted up through the steering wheel and front end when the car goes over bumps, potholes, speed bumps, or rough pavement — the driver feels the hit IN THE WHEEL (sometimes as a kickback or shudder) and often describes the ride as "rough" or "jarring" compared to before. Frequently accompanied by continued bouncing after the bump (worn struts/shocks), excessive body lean in corners, or fluid streaks down the strut posts. Distinct from noise/clunking_over_bumps (which is the same family of components but framed as a NOISE the customer HEARS from underneath rather than an IMPACT felt in the wheel — choose this steering subcategory when the customer's primary report is "felt in the wheel" or "rough ride") and from vibration/shaking_or_bouncing_over_bumps_and_rough_roads (which is a whole-car bouncing / oscillation complaint after a bump, not a discrete clunk-felt-in-the-wheel).
Positive examples:
  - "Big clunk through the steering wheel every time I hit a bump"
  - "Wheel kicks back hard when I roll over a pothole"
  - "Front end feels really rough — every bump comes right up through the wheel"
  - "Knocking I can feel in the steering wheel going over speed bumps"
  - "Ride is jarring and I feel the impact in my hands"
Negative examples:
  - ""Clunk from underneath I can hear but don't feel in the wheel" → noise/clunking_over_bumps"
  - ""Whole car bounces three times after every bump" → vibration/shaking_or_bouncing_over_bumps_and_rough_roads"
  - ""Click only when I turn at parking-lot speed" → noise/popping_or_clicking_when_turning"
  - ""Squeak going over bumps" → noise/squeaking_or_creaking_over_bumps"
  - ""Steering wheel shakes at highway speed" → steering_wheel_shakes_at_highway_speed"
  - ""Wheel feels loose with play" → loose_or_sloppy_steering"
Synonyms: clunk through the wheel, clunk in the steering wheel, knock through the steering, felt in the wheel, kickback through the wheel, kickback from bumps, rough ride felt in the wheel, jarring ride, harsh impact through the wheel, wheel kicks over bumps, jolt through the steering, bump steer feeling, worn struts feel, bouncing through the wheel

## tires/visible_damage_nail_screw_bulge_cut
Description: Customer has visually identified physical damage to a tire — a nail or screw sticking out, a bubble or bulge on the sidewall, a cut, gash, or slash in the rubber, or another object embedded in the tread. The damage itself is the framing concern, regardless of whether the tire is currently holding air. Pick this whenever the customer names a SPECIFIC visible object or visible deformation, even if they also mention air loss. Distinct from tires/tire_going_flat_losing_air (which is air loss with NO visible cause named) and from tires/dry_rot_sidewall_cracking (where the "damage" is age-related rubber cracking and weather checking, not impact or puncture damage).
Positive examples:
  - "There's a nail sticking out of my tire"
  - "Got a screw in my tire and the head is showing"
  - "I see a bubble on the sidewall of my front tire"
  - "Hit a curb and now there's a bulge in the side of the tire"
  - "Big gash in my tire — looks like I ran over something sharp"
Negative examples:
  - ""Tire keeps going flat but I don't see anything in it" → tire_going_flat_losing_air"
  - ""Tire pressure light keeps coming on" → low_pressure_warning_light_only"
  - ""Lots of little cracks on the sidewall of my tires" → dry_rot_sidewall_cracking"
  - ""Tires are wearing on the inside edge" → uneven_tire_wear_bald_spots"
  - ""Hit a pothole hard and now the car shakes" → vibration/steering_wheel_shake_at_highway_speed"
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
  - ""There's a nail in my tire" → visible_damage_nail_screw_bulge_cut"
  - ""Bubble on the sidewall" → visible_damage_nail_screw_bulge_cut"
  - ""Just the TPMS light is on, tires look fine" → low_pressure_warning_light_only"
  - ""Sidewall is all cracked from sitting" → dry_rot_sidewall_cracking"
  - ""Tire pressure light came on after the cold snap" → warning_light/tpms_tire_pressure_light"
Synonyms: losing air, going flat, won't hold air, slow leak, tire leak, flat tire, low tire, soft tire, deflating tire, leaks down, needs air, keeps going low, tire keeps losing pressure, slow flat

## tires/low_pressure_warning_light_only
Description: The customer's ONLY framing is that a low-tire-pressure warning has appeared on the dashboard — they may or may not have confirmed any tire is actually low, and they have not named visible damage or active air loss. Common causes include cold-weather pressure drop, a tire that needs topping off, a TPMS sensor that needs to relearn after a fill-up or tire service, or a failing TPMS sensor battery. NOTE on routing: this subcategory has a parallel sibling at `warning_light/tpms_tire_pressure_light`. When the customer LEADS with warning-light language ("TPMS light came on", "yellow horseshoe symbol on my dash") the warning_light sibling is canonical and preferred. Both exist for graceful fallback. Distinct from tires/tire_going_flat_losing_air (where the customer has confirmed a tire is actually losing air, beyond just the light) and from tires/recent_tire_work_then_new_symptom (when the light is one of multiple new symptoms following recent tire work — route there instead).
Positive examples:
  - "My low tire pressure light is on"
  - "Tire pressure warning came on this morning"
  - "Tire pressure light keeps coming on and off"
  - "I added air but the light won't go off"
  - "Low pressure warning light, tires look fine to me"
Negative examples:
  - ""TPMS light came on" → warning_light/tpms_tire_pressure_light (warning-light framing)"
  - ""Tire keeps going flat" → tire_going_flat_losing_air"
  - ""Got a nail in my tire and the light is on" → visible_damage_nail_screw_bulge_cut"
  - ""Had new tires put on yesterday and now the light is on" → recent_tire_work_then_new_symptom"
  - ""Tire pressure light AND check engine light came on" → warning_light/multiple_warning_lights_at_once"
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
  - ""Sidewall has lots of small cracks" → dry_rot_sidewall_cracking"
  - ""I just want to buy new tires" → just_want_new_tires"
  - ""Steering wheel shakes at highway speed" → vibration/steering_wheel_shake_at_highway_speed"
  - ""Car pulls to the right on flat roads" → pulling/steady_drift_while_cruising"
  - ""Got a nail in the tire" → visible_damage_nail_screw_bulge_cut"
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
  - ""Big gash in the sidewall from hitting something" → visible_damage_nail_screw_bulge_cut"
  - ""Bulge on the sidewall" → visible_damage_nail_screw_bulge_cut"
  - ""Inside edge of the tread is wearing fast" → uneven_tire_wear_bald_spots"
  - ""Tire keeps losing air slowly" → tire_going_flat_losing_air"
  - ""Car has been sitting for two years, I want a full check" → other/car_has_been_sitting_unused_for_a_long_time"
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
  - ""Tires are wearing on the inside edge, probably need new ones" → uneven_tire_wear_bald_spots (diagnostic framing)"
  - ""Sidewalls are all cracked, I think I need new tires" → dry_rot_sidewall_cracking (diagnostic framing)"
  - ""Tire keeps going flat, might as well replace it" → tire_going_flat_losing_air (diagnostic framing)"
  - ""Got a nail and probably need a new tire" → visible_damage_nail_screw_bulge_cut (diagnostic framing)"
  - ""Want an alignment with my new tires" → just_want_new_tires (still the dominant request — advisor can add alignment to the quote)"
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
  - ""Started pulling to the right after new tires" → pulling/pull_that_started_after_recent_tire_or_service_work"
  - ""Had brake job done and now it makes noise" → other/after_recent_service_or_repair_work"
  - ""Tire pressure light came on this morning, no recent work" → low_pressure_warning_light_only"
  - ""Tire has been losing air for months, no recent service" → tire_going_flat_losing_air"
  - ""Sidewall has cracks, no tire work done recently" → dry_rot_sidewall_cracking"
Synonyms: new symptom after tire work, vibration after new tires, noise after tire rotation, TPMS won't clear after tire service, leak came back after patch, leak after plug, shaking after balance, comeback after tire work, post-tire-work issue, problem after tires installed, returned after tire service

## vibration/steering_wheel_shake_at_highway_speed
Description: The steering wheel shakes, shimmies, or wobbles in the driver's hands once the car reaches highway speeds — usually starting around 50-65 mph, often peaking in a narrow speed band and easing off above or below it. The customer typically describes feeling the shake THROUGH the wheel (in their hands), and the shake gets progressively worse the longer they drive at that speed. Distinct from steering/steering_wheel_shakes_at_highway_speed (which is the same physical event reported as a STEERING / wheel-feel complaint — "the wheel feels loose and wobbly," "I can't keep it steady" — this vibration/ subcategory captures the same shake reported as a VIBRATION the driver feels), and distinct from brakes/pulsating_or_vibrating_pedal (which only happens while braking — this one happens at speed without touching the brake) and from vibration/vibration_or_pulsing_when_braking (which is brake-triggered, not speed-triggered).
Positive examples:
  - "Steering wheel shakes really bad at 65 mph but smooths out if I slow down or speed up"
  - "Bad shimmy through the steering wheel once I hit highway speeds — feels like the front end is dancing"
  - "Car shakes like a washing machine on spin cycle when I'm on the freeway"
  - "Wheel vibrates in my hands from about 55 to 70, then it kind of evens out"
  - "Front end started shimmying at highway speed after I hit that big pothole last week"
  - "Steering wheel wobbles back and forth when I'm cruising — gets worse the faster I go"
Negative examples:
  - ""Steering wheel shakes ONLY when I press the brake pedal" → vibration_or_pulsing_when_braking"
  - ""Whole car shudders when I brake from highway speed" → vibration_or_pulsing_when_braking"
  - ""Wheel feels loose and sloppy, lots of play before the car turns" → steering/loose_or_sloppy_steering"
  - ""Car shakes at idle but not at speed" → shaking_at_idle_while_stopped"
  - ""Vibration only when I'm accelerating hard or going uphill" → shaking_when_speeding_up_or_going_uphill"
  - ""Constant buzz at any speed — never changes" → constant_vibration_that_doesnt_change_with_speed"
Synonyms: shake, shaking, shimmy, shimmying, wobble, wobbling, vibration, vibrates, vibrating, tremor, jitter, dancing wheel, steering wheel shake, wheel shimmy, highway vibration, freeway shake, balance shake, out of balance, wheel hop, front-end shake

## vibration/vibration_or_pulsing_when_braking
Description: The WHOLE CAR — or the steering wheel, or the driver's seat — shudders, vibrates, or pulses RHYTHMICALLY when the customer presses the brake pedal, especially when slowing down from highway speed or coming down a long hill. Pulsing typically gets worse the harder the pedal is pressed and may fade or disappear when the car comes to a complete stop. Distinct from brakes/pulsating_or_vibrating_pedal (which is the SAME physical event reported as a PEDAL-feel complaint — "the pedal pulses back at my foot." This vibration/ subcategory is for customers who describe the WHOLE-CAR shake, steering-wheel shake, or seat shake during braking rather than the pedal feel). Also distinct from steering_wheel_shake_at_highway_speed (which happens at speed even WITHOUT braking — typically wheel balance) and from shaking_or_bouncing_over_bumps_and_rough_roads (which is bump-triggered, not brake-triggered).
Positive examples:
  - "Whole car shudders when I brake from highway speed — really bad shake"
  - "Steering wheel and the seat both vibrate hard when I press the brakes"
  - "Car shakes like crazy when I slow down from 70 — feels like everything is shaking"
  - "After driving down a mountain pass, the whole car started shaking when I'd brake"
  - "Front end shudders back and forth when I'm coming to a stop"
  - "Seat of my pants is shaking when I brake — like the rotors are warped in the back"
Negative examples:
  - ""Pedal itself pulses up and down against my foot" → brakes/pulsating_or_vibrating_pedal"
  - ""Steering wheel shakes at 65 mph even when I'm not braking" → steering_wheel_shake_at_highway_speed"
  - ""Whole car bounces over every bump in the road" → shaking_or_bouncing_over_bumps_and_rough_roads"
  - ""Car shakes only when accelerating" → shaking_when_speeding_up_or_going_uphill"
  - ""Pulls to one side when I brake" → pulling/pulling_only_when_braking"
  - ""Grinding noise when I brake but no shake" → brakes/metallic_grinding"
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
  - ""Engine sounds rough and sputters at idle, RPM bounces around" → performance/rough_idle_or_shaking_at_a_stop"
  - ""Engine actually dies when I come to a stop" → performance/stalling_at_idle_or_when_stopping"
  - ""Steering wheel shakes at highway speed" → steering_wheel_shake_at_highway_speed"
  - ""Constant vibration at every speed including driving" → constant_vibration_that_doesnt_change_with_speed"
  - ""Car shakes only when I'm accelerating" → shaking_when_speeding_up_or_going_uphill"
  - ""Whole car shudders when I brake" → vibration_or_pulsing_when_braking"
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
  - ""Steering wheel shakes at 65 mph even when I'm coasting" → steering_wheel_shake_at_highway_speed"
  - ""Car shakes when I brake from highway speed" → vibration_or_pulsing_when_braking"
  - ""Shake at idle when I'm stopped" → shaking_at_idle_while_stopped"
  - ""Clicking noise only when I turn the steering wheel sharp" → noise/popping_or_clicking_when_turning"
  - ""Engine bucks and jerks like it's misfiring when I accelerate" → performance/engine_misfire_or_bucking_feeling"
  - ""Just feels like the car has no power when I press the gas" → performance/low_power_or_wont_accelerate_normally"
Synonyms: shakes when accelerating, vibration under acceleration, acceleration shake, shake on hills, shake going uphill, rumble strip feeling, CV axle vibration, driveshaft vibration, U-joint shake, torque-load shake, throttle-on vibration, shakes under load, shudders under power, shake when passing, accelerator vibration, shake under throttle

## vibration/shaking_or_bouncing_over_bumps_and_rough_roads
Description: The car shakes, bounces, jolts, or rides harshly when the customer goes over bumps, potholes, expansion joints, speed bumps, or rough/uneven pavement — and the ride feels much rougher than it used to. After a single bump, the car may keep bouncing two, three, or four times instead of settling once. Distinct from noise/clunking_over_bumps (which is the SAME trigger reported as a SOUND complaint — a hard metallic thud/clunk over bumps — this vibration/ subcategory is for customers describing RIDE QUALITY: the shake, bounce, harshness, or roughness, not the noise) and from steering/clunking_knocking_or_rough_ride_over_bumps (which is bump-feel transmitted through the STEERING WHEEL — this one is felt through the whole body / seat / chassis). Also distinct from constant_vibration_that_doesnt_change_with_speed (which is there even on smooth pavement).
Positive examples:
  - "Car bounces three or four times after every bump instead of settling — ride feels really rough"
  - "Every pothole feels like it's going through the whole car — really jarring"
  - "Ride is way harsher than it used to be, even small bumps shake the whole car"
  - "Front end keeps bouncing forever after I hit a bump — shocks have to be done"
  - "Car feels really jittery and bouncy on rough roads, like the suspension isn't doing anything"
  - "Hits every bump hard now and the back end is jumping around"
Negative examples:
  - ""Hard metallic clunk over bumps but the ride itself feels okay" → noise/clunking_over_bumps"
  - ""Clunking and rough ride over bumps, also feels it in the steering wheel" → steering/clunking_knocking_or_rough_ride_over_bumps"
  - ""Squeak or creak when I roll over bumps" → noise/squeaking_or_creaking_over_bumps"
  - ""Steering wheel shakes at highway speed on smooth pavement" → steering_wheel_shake_at_highway_speed"
  - ""Constant vibration even on perfectly smooth road" → constant_vibration_that_doesnt_change_with_speed"
  - ""Whole car shakes when I brake" → vibration_or_pulsing_when_braking"
Synonyms: bouncy, bounces, bouncing, bouncing over bumps, rough ride, harsh ride, jarring, jolts, jolty, jittery, shakes over bumps, suspension shake, suspension bounce, no damping, bouncing after bump, bottom out, bottoming out, front-end dive, nose dive, ride feels rough

## vibration/constant_vibration_that_doesnt_change_with_speed
Description: A steady, constant vibration, hum, or buzz that the customer feels at ALL speeds — parking-lot crawl, city driving, and highway cruise alike — and that does NOT change pitch or intensity with road speed, engine RPM, braking, or accelerating. Often described as feeling it through the floor or the seat as much as the steering wheel, like a constant low-frequency tremor humming through the body of the car. Distinct from steering_wheel_shake_at_highway_speed (which has a clear onset speed and goes away outside the band), from shaking_at_idle_while_stopped (which goes away once driving), and from shaking_when_speeding_up_or_going_uphill (which goes away when coasting). The defining feature here is "it's there all the time, doesn't matter what I'm doing."
Positive examples:
  - "There's a constant vibration through the floor no matter how fast or slow I'm going"
  - "Car has a steady hum and shake at 25 mph, 45 mph, 65 mph — same the whole time"
  - "Always feels like something is loose or out of round — never stops vibrating"
  - "Buzz through the seat at every speed, even crawling through a parking lot"
  - "Tremor through the whole car that's there from the moment I start driving until I stop"
  - "Vibration doesn't get worse with speed or braking — just constantly there"
Negative examples:
  - ""Shake only at 60 mph, goes away below 50 or above 70" → steering_wheel_shake_at_highway_speed"
  - ""Vibration only when I press the brake pedal" → vibration_or_pulsing_when_braking"
  - ""Only shakes when I accelerate" → shaking_when_speeding_up_or_going_uphill"
  - ""Only shakes when I'm stopped at a light" → shaking_at_idle_while_stopped"
  - ""Shakes over every bump and pothole" → shaking_or_bouncing_over_bumps_and_rough_roads"
  - ""Humming wheel bearing noise that gets louder with speed" → noise/humming_or_whirring_at_speed"
Synonyms: constant vibration, steady vibration, always vibrating, vibrating all the time, vibration at every speed, continuous shake, constant tremor, steady hum, steady buzz, low-frequency vibration, hum through the floor, vibration that doesn't change, non-speed-dependent vibration, droning vibration, persistent vibration, vibration everywhere, always shaking, doesn't matter the speed

## warning_light/check_engine_light
Description: An amber, yellow, or orange dashboard warning light shaped like the OUTLINE OF AN ENGINE BLOCK — also called the malfunction indicator lamp (MIL). It illuminates because the OBD-II computer detected an actual PROBLEM (emissions, misfire, sensor, EVAP, O2, coil) and stored a diagnostic trouble code. STEADY = persistent issue (loose gas cap, failing sensor); FLASHING = severe live misfire actively damaging the catalytic converter — reduce power and get to a shop. Distinct from service_engine_soon_or_maintenance_required_light, which is a SCHEDULED-MAINTENANCE REMINDER (oil-change due — nothing is actually wrong; uses words "SERVICE ENGINE SOON" / "MAINT REQD" / wrench icon, NOT an engine-outline icon). Distinct from multiple_warning_lights_at_once when the CEL is on alongside several unrelated lights together (usually a charging-system / alternator failure rather than a simple DTC).
Positive examples:
  - "My check engine light is on, the car runs okay but it just popped up yesterday"
  - "CEL came on and the engine feels rough at idle, kind of shaking"
  - "Yellow engine-shaped icon on my dash, flashing on and off while I drive"
  - "Check engine light is blinking and the car is shuddering really bad — feels like it's misfiring"
  - "Orange engine symbol came on right after I filled up with gas at the pump"
  - "Engine light came on, smells like rotten eggs, car is running fine otherwise"
  - "My MIL is on — pulled a code and it said P0420"
Negative examples:
  - ""Dashboard says SERVICE ENGINE SOON and it's about time for an oil change" → service_engine_soon_or_maintenance_required_light"
  - ""Got a MAINT REQD message on the dash, car drives perfectly fine" → service_engine_soon_or_maintenance_required_light"
  - ""Check engine light AND battery light AND ABS light all came on at once" → multiple_warning_lights_at_once"
  - ""Red oil can icon came on, no engine light" → oil_pressure_light"
  - ""Engine is overheating, temperature light is on" → engine_temperature_light"
Synonyms: check engine light, CEL, check engine, engine light, MIL, malfunction indicator lamp, malfunction indicator light, yellow engine light, amber engine light, orange engine light, engine icon, engine symbol, engine outline, OBD-II light, OBD light, flashing engine light, blinking engine light, code light, diagnostic light, trouble code light

## warning_light/service_engine_soon_or_maintenance_required_light
Description: A SCHEDULED-SERVICE REMINDER displayed as the words "SERVICE ENGINE SOON," "MAINT REQD," "MAINTENANCE REQUIRED," "SERVICE DUE," "SERVICE A/B" (Honda Maintenance Minder), or as a wrench / spanner icon — TRIPPED BY MILEAGE, not by any engine fault. The car drives normally; no DTC is logged. It's the vehicle's "due for an oil change / rotation / inspection" reminder at round-number mileages (5,000 / 30,000 / 60,000 / 75,000) — resets after service. Distinct from check_engine_light, which is the OBD-II MIL — an engine-outline icon (NOT words / wrench) meaning a REAL PROBLEM (emissions, misfire, sensor) is stored as a DTC. CRITICAL: customers often say "service engine soon" when they actually mean the check engine light. If the customer mentions ANY drivability symptom (rough running, misfire, smell, smoke, hard start), route to check_engine_light. Route here only when wording clearly references a reminder AND the car drives fine.
Positive examples:
  - "My dash says SERVICE ENGINE SOON, just hit 75,000 miles, car runs fine"
  - "MAINT REQD light came on, I think I'm due for an oil change"
  - "Maintenance Required light is on, came on right at 5,000 miles"
  - "There's a little wrench symbol on my dashboard, car drives perfectly"
  - "Service due reminder popped up, last oil change was a while ago"
  - "Honda Maintenance Minder is showing code A1 — what does that mean?"
  - "It says SERVICE A on my Mercedes dashboard, nothing else is wrong"
Negative examples:
  - ""Check engine light came on and the car is running rough" → check_engine_light"
  - ""Yellow engine-shape icon, no other words, engine misfiring" → check_engine_light"
  - ""CEL is flashing, car is shaking under acceleration" → check_engine_light"
  - ""Red oil can light came on" → oil_pressure_light"
  - ""Temperature gauge is in the red and the temp light is on" → engine_temperature_light"
Synonyms: service engine soon, SES light, service engine soon light, maintenance required, MAINT REQD, maintenance required soon, service due, service reminder, oil change reminder, wrench light, wrench icon, spanner light, scheduled maintenance light, Toyota maintenance light, Honda maintenance minder, service A, service B, mileage reminder, oil life light, maint reqd light

## warning_light/battery_charging_light
Description: A red or amber dashboard warning light shaped like a small BATTERY (rectangle with + and − signs), or the letters "BATT" / "ALT." Illuminates because the charging system is no longer producing enough voltage to keep the battery charged — almost always a failing alternator, broken / slipping serpentine belt, bad voltage regulator, or corroded battery terminals (less commonly an actual dead battery). The car is now running off battery power only; 20-60 minutes before it stalls and dies. Often reported alongside dimming headlights, slow / weak crank on the next start, or a squealing belt under the hood. Distinct from electrical/dim_or_flickering_lights, where the customer leads with visible brightness changes (no specific battery icon mentioned) — that's electrical/. Distinct from multiple_warning_lights_at_once when the battery light is one of MANY illuminating together (still a charging failure, but presents as a cascade).
Positive examples:
  - "Battery light just came on while I was driving, headlights are getting dim"
  - "Red battery icon lit up on my dash, car still running but it feels weak"
  - "There's a little battery symbol with a + and a − showing — what does it mean?"
  - "Charging system light is on, car barely started this morning"
  - "ALT warning light came on, hear a squealing noise from under the hood too"
  - "Yellow battery-shaped light on my dash, dim headlights, dashboard lights flicker"
  - "Battery light came on and the car died about ten minutes later, had to jump it"
Negative examples:
  - ""Dashboard lights are dim but I don't see any specific warning light" → electrical/dim_or_flickering_lights"
  - ""Car won't crank, just clicks when I turn the key" → electrical/wont_crank_just_clicks"
  - ""Many warning lights lit up at the same time" → multiple_warning_lights_at_once"
  - ""Engine temperature light is on, not the battery light" → engine_temperature_light"
  - ""Car cranks slowly when I start it cold, no warning light" → electrical/slow_crank_sluggish_start"
Synonyms: battery light, battery warning light, charging light, charging system light, alternator light, alternator warning, ALT light, BATT light, red battery icon, battery symbol, battery-shaped light, battery icon with plus minus, charging system warning, low voltage light, voltage warning light, no-charge light

## warning_light/oil_pressure_light
Description: A red dashboard warning light shaped like a small OIL CAN with a single drop / drip falling from the spout (the "genie lamp" shape). When it comes on while the engine is running, the engine has lost oil pressure — the lubricating film between metal parts is failing; continuing to drive even a minute can destroy bearings, scar the crankshaft, or seize the engine. Causes: catastrophically low oil level (leak or burning oil), a failing oil pump, a clogged oil pickup screen, or a worn engine with low idle pressure. Pull over immediately and shut the engine off. The light may also FLICKER at idle / stops (early low pressure — still serious) or come on momentarily at cold start then go off (mostly normal). Distinct from noise/deep_knocking_from_the_engine, where the customer leads with a knocking sound (low oil pressure can cause rod-knock — but if they led with the LIGHT, route here). Distinct from service_engine_soon (this is a CRITICAL damage warning, NOT an oil-change reminder).
Positive examples:
  - "Red oil can light came on while I was driving — I pulled over immediately"
  - "Oil pressure light is flickering at idle and at red lights, goes off when I drive"
  - "Little red genie-lamp-shaped icon on my dash, the one with a drop"
  - "Oil light came on and I hear ticking from the engine"
  - "Engine oil warning light is on steady, car making a tapping noise"
  - "Red light with an oil can and drip is glowing — what should I do?"
  - "Low oil pressure warning popped up, was overdue for an oil change by 3,000 miles"
Negative examples:
  - ""Dashboard says SERVICE DUE — I think I'm overdue for an oil change" → service_engine_soon_or_maintenance_required_light"
  - ""Deep knocking from the engine, no light on" → noise/deep_knocking_from_the_engine"
  - ""Engine temperature light is on, not the oil light" → engine_temperature_light"
  - ""Oil is leaking under the car, no warning light yet" → leak/black_oil_leak_under_engine"
  - ""Check engine light is on, no oil light" → check_engine_light"
Synonyms: oil pressure light, oil light, low oil pressure light, oil can light, oil can icon, oil can with drip, red oil light, oil warning light, genie lamp light, Aladdin lamp light, engine oil light, low oil pressure warning, oil pressure warning, red oil symbol, oil drop icon, oil drip icon, oil pressure indicator

## warning_light/engine_temperature_light
Description: A red (urgent — overheating now) or blue (cold start; normal) dashboard warning light shaped like a THERMOMETER SUBMERGED IN TWO WAVY WAVES of liquid. When the RED version comes on, coolant temperature is above safe range — imminent risk of warping the head, blowing a head gasket, or seizing. Causes: low coolant (leak or burning into combustion), stuck thermostat, failed water pump, clogged radiator, broken cooling fan, or head-gasket failure. Often reported alongside steam from under the hood, sweet maple-syrup smell, or the gauge needle climbing into the red. Pull over and shut off immediately. Distinct from smoke/smoke_from_under_the_hood, where the customer leads with VISIBLE STEAM/SMOKE; this is for LIGHT-FIRST reports. Distinct from smell/sweet_smell_maple_syrup_antifreeze, where customer leads with smell. Distinct from oil_pressure_light — both red, but oil is a can-with-drip and this is a thermometer-in-waves.
Positive examples:
  - "Engine temperature light just came on, gauge is in the red zone"
  - "Red thermometer-with-waves light is on, car was sitting in traffic for 20 minutes"
  - "Temp warning light on the dash, steam coming from under the hood"
  - "Coolant temperature light came on after I climbed a steep hill towing my trailer"
  - "Red thermometer icon glowing, heater inside the car is blowing cold air now"
  - "Engine overheating warning popped up — I pulled over right away"
  - "Hot light came on, I checked and the coolant reservoir is bone dry"
Negative examples:
  - ""White steam pouring out from under the hood" → smoke/smoke_from_under_the_hood"
  - ""Sweet smell like maple syrup or pancake syrup in the car" → smell/sweet_smell_maple_syrup_antifreeze"
  - ""Coolant is leaking under the car, light hasn't come on" → leak/green_or_orange_or_pink_coolant_leak"
  - ""Oil pressure light is on, not the temp light" → oil_pressure_light"
  - ""Check engine light, no temp warning" → check_engine_light"
Synonyms: engine temperature light, temperature warning light, temp light, coolant temperature light, coolant warning light, overheat light, overheating light, red thermometer light, thermometer icon, thermometer in waves, thermometer-with-waves, hot engine light, HOT warning, engine hot light, ECT light, red temp light, temperature gauge in red, overheating warning

## warning_light/tpms_tire_pressure_light
Description: An amber/yellow dashboard warning light shaped like a HORSESHOE / U-SHAPED CROSS-SECTION OF A TIRE with an EXCLAMATION POINT inside it (sometimes tread marks at the bottom). TPMS = Tire Pressure Monitoring System. Illuminates when one or more tires drops more than ~25 % below the manufacturer's recommended cold-tire pressure — most commonly cold-weather temperature drops (~1 PSI per 10 °F), a slow leak (nail, valve stem, bead), or recent tire service that hasn't relearned sensors. STEADY ON = a tire is under-inflated; check and inflate. FLASHING for ~60-90 seconds then STEADY = the TPMS SYSTEM has a fault (dead sensor, missing sensor after rotation) — not actually about pressure right now. Distinct from tires/low_pressure_warning_light_only — DUPLICATE INTENT: route here when the customer LEADS with the LIGHT; route to tires/ when they LEAD with the TIRE ("front tire looks low and light came on"). Distinct from tires/visible_low_or_flat_tire when the customer can SEE a flat.
Positive examples:
  - "TPMS light came on this morning, it's been getting cold"
  - "Yellow horseshoe-shaped light with an exclamation point on my dash"
  - "Tire pressure warning light just popped up while I was driving"
  - "Low tire pressure light is flashing for about a minute then stays on"
  - "Light shaped like a U with a ! in the middle is glowing on my dashboard"
  - "Tire pressure light came on after I had new tires put on last week"
  - "TPMS warning, all four tires look fine visually but the light won't go off"
Negative examples:
  - ""My front passenger tire looks really low and the light is on" → tires/low_pressure_warning_light_only"
  - ""Tire is completely flat on the side of the road" → tires/visible_low_or_flat_tire"
  - ""Slow leak in my tire — keeps going down every few days" → tires/slow_leak_pressure_drops_repeatedly"
  - ""Tire pressure is fine but the car pulls to one side" → pulling/pulls_to_one_side"
  - ""Red brake light, not the tire light" → brake_system_red_light"
Synonyms: TPMS light, TPMS warning, tire pressure light, tire pressure warning, low tire pressure light, low pressure light, horseshoe light, horseshoe icon, horseshoe with exclamation point, U-shape light, tire-shape light, tire icon with exclamation, yellow tire light, tire warning light, flat tire light, tire monitor light, tire monitoring light, tire pressure indicator, pressure sensor light

## warning_light/abs_anti_lock_brake_light
Description: An amber/yellow dashboard warning light containing the LETTERS "ABS" — usually inside a CIRCLE inside parentheses-shaped brackets. ABS = Anti-lock Braking System. Illuminates when the ABS computer detects a fault — usually a failed wheel-speed sensor (corroded after winter, knocked by a pothole), wiring break, bad ABS pump/module, or after deep water. CRITICAL: regular hydraulic brakes STILL WORK — drivable to a shop. Only the anti-LOCK feature (pulsing that prevents wheel lockup on slippery surfaces) is disabled. Distinct from brake_system_red_light — RED (parking brake, low fluid, hydraulic failure — SAFETY EMERGENCY, do not drive); ABS is YELLOW and not an emergency. When BOTH lights are on, route to brake_system_red_light. Distinct from traction_control_stability_light — TCS shares wheel-speed sensors so often appears together; prefer ABS if customer mentions the LETTERS, prefer traction if they describe a sliding-car icon.
Positive examples:
  - "ABS light came on, regular brakes seem to still work fine"
  - "Yellow ABS letters on my dashboard, came on after I hit a big pothole"
  - "Anti-lock brake warning light is glowing — should I drive it?"
  - "ABS warning came on, I drove through a deep puddle last night"
  - "Amber light with the letters ABS in a circle is on my dash"
  - "ABS light just came on this morning, never on before"
  - "ABS and traction control lights both on, brakes work normal otherwise"
Negative examples:
  - ""Red brake light is on, parking brake is released" → brake_system_red_light"
  - ""Red BRAKE light glowing — brake pedal feels soft" → brake_system_red_light"
  - ""Just the yellow traction-control-with-skid-lines icon, no ABS letters" → traction_control_stability_light"
  - ""Both red brake AND yellow ABS are on at the same time" → brake_system_red_light"
  - ""Several different warning lights all came on at once" → multiple_warning_lights_at_once"
Synonyms: ABS light, ABS warning light, ABS warning, anti-lock brake light, antilock brake light, anti-lock brake warning, ABS letters, ABS in circle, yellow ABS light, amber ABS light, ABS system light, ABS sensor light, wheel speed sensor light, anti-skid light

## warning_light/brake_system_red_light
Description: A RED dashboard warning light containing either the WORD "BRAKE" or a RED EXCLAMATION POINT inside a circle in parentheses-shaped brackets. The MAIN HYDRAULIC BRAKE SYSTEM warning — a true SAFETY EMERGENCY. Causes in order: (1) parking brake / e-brake still partially engaged — check first and fully release, (2) brake fluid reservoir below MIN (hydraulic leak OR worn pads dropping fluid), (3) brake hydraulic circuit has lost pressure (master cylinder bypass, ruptured line, blown caliper seal). If parking brake is released AND the light is still on, DO NOT DRIVE — call a tow. Distinct from abs_anti_lock_brake_light — that's the YELLOW/AMBER ABS-letters light; only anti-lock disabled, regular brakes work, drivable. The RED light here means MAIN brake hydraulics may fail — life-or-death difference. When BOTH lights are on, the entire braking system is compromised; route here. Distinct from brakes/spongy_or_soft_pedal (pedal-FEEL subcategories).
Positive examples:
  - "Red BRAKE light is on, parking brake is fully released"
  - "Red exclamation point in a circle came on my dashboard, brake pedal feels mushy"
  - "BRAKE warning light glowing red, fluid level looks low under the hood"
  - "Red brake light AND yellow ABS light both on — should I keep driving?"
  - "Red brake system light came on, pedal sinks to the floor when I hold it"
  - "Brake light came on, can't tell if my emergency brake is fully off"
  - "Red light with the word BRAKE in it just lit up while I was driving"
Negative examples:
  - ""Yellow ABS letters light came on, brakes still work normal" → abs_anti_lock_brake_light"
  - ""Brake pedal feels soft and spongy, no warning light" → brakes/spongy_or_soft_pedal"
  - ""Pedal sinks to the floor at red lights, no light on" → brakes/pedal_sinks_to_floor"
  - ""Brakes squealing every time I stop, no light" → brakes/high_pitched_squealing"
  - ""Multiple warning lights came on at once" → multiple_warning_lights_at_once"
Synonyms: red brake light, BRAKE light, brake warning light, brake system light, red BRAKE warning, red exclamation brake light, parking brake light, e-brake light, emergency brake light, hand brake light, brake fluid light, low brake fluid light, hydraulic brake light, brake hydraulic warning, red (!) light, red brake symbol, red brake icon

## warning_light/airbag_srs_light
Description: A red or amber dashboard warning light shaped like a SIDE PROFILE OF A PERSON IN A SEAT WITH A SEAT BELT, FACING A LARGE CIRCLE (the airbag) — or the words "SRS," "AIRBAG," "AIR BAG," or "SRS" inside a yellow triangle. SRS = Supplemental Restraint System (airbags + seatbelt pretensioners). Illuminates when the airbag computer detects a fault — usually a bad seat-belt buckle tension sensor, a faulty passenger occupancy sensor (under the front passenger seat), a clock-spring fault inside the steering wheel, a wiring problem under a seat (after seat-track service), or a stored crash code (any minor collision or hard impact, even a curb hit). NORMAL: flashes briefly on start then turns off. If it STAYS ON or flashes a pattern (e.g., 4 short, 1 long), the system is faulted — one or more airbags may not deploy in a crash. Distinct from multiple_warning_lights_at_once when SRS is one of many cascading lights (presents as charging/electrical cascade).
Positive examples:
  - "Airbag light came on after I had my seats out for cleaning"
  - "SRS light glowing on my dash, won't turn off"
  - "Red person-with-seatbelt-and-airbag icon on my dashboard"
  - "AIRBAG warning light is on, started after my battery died last week"
  - "Yellow SRS triangle on the dash, just appeared this morning"
  - "Airbag light flashing a pattern of short and long blinks"
  - "SRS light came on after a small fender bender, no airbags deployed"
Negative examples:
  - ""Check engine light is on, not the airbag light" → check_engine_light"
  - ""Red brake light, parking brake is off" → brake_system_red_light"
  - ""Multiple warning lights including airbag came on after battery died" → multiple_warning_lights_at_once"
  - ""Seat belt buzzer is going off, no warning light" → other/seat_belt_warning_only"
  - ""Several different lights came on at the same time" → multiple_warning_lights_at_once"
Synonyms: airbag light, airbag warning light, SRS light, SRS warning, supplemental restraint system light, air bag light, AIRBAG light, AIR BAG light, person and airbag icon, person seatbelt symbol, seatbelt-with-circle light, airbag malfunction light, airbag fault light, restraint system light, occupancy sensor light, SRS triangle

## warning_light/traction_control_stability_light
Description: An amber/yellow dashboard warning light shaped like a SMALL CAR WITH TWO CURVY / SQUIGGLY / WAVY SKID LINES underneath it (the car appears to be sliding sideways) — or the letters "TC," "TCS," "VSC," "ESP," "ESC," "DSC," or "VDC" by brand. Traction / Stability / Electronic Stability Program. NORMAL: briefly FLASHES while the system actively intervenes (one wheel spins on ice, car slides on wet pavement). PROBLEMATIC: STEADY ON — the system has a fault and is disabled. Causes: bad wheel-speed sensor (shared with ABS), steering-angle sensor out of calibration after alignment work, mismatched tire sizes (one new tire among three worn), or driver accidentally pressed the TCS-off button. Distinct from abs_anti_lock_brake_light — both share wheel-speed sensors and often appear together; route to ABS when customer describes the LETTERS, route here when they describe a sliding-CAR icon or a button labeled VSC/ESC. Distinct from multiple_warning_lights_at_once when TCS is one of many.
Positive examples:
  - "Traction control light came on this morning"
  - "Yellow icon shaped like a car with squiggly lines under it on my dash"
  - "TCS light is on, came on after I put one new tire on"
  - "VSC light glowing on my Toyota, no other lights"
  - "Stability control light is on, can't turn it off"
  - "Little car-skidding symbol came on after I drove through snow"
  - "ESC warning light came on after my alignment was done"
Negative examples:
  - ""Yellow ABS letters on my dash" → abs_anti_lock_brake_light"
  - ""Red brake light is on, parking brake released" → brake_system_red_light"
  - ""Tire pressure warning light came on" → tpms_tire_pressure_light"
  - ""Several lights came on at the same time" → multiple_warning_lights_at_once"
  - ""Car is actually sliding and losing grip on wet roads, no light yet" → handling/loss_of_traction_or_grip"
Synonyms: traction control light, TCS light, TC light, stability control light, ESC light, ESP light, DSC light, VSC light, VDC light, electronic stability light, stability program light, traction warning light, anti-skid light, slip indicator light, slipping car light, sliding car icon, car-with-skid-lines symbol, traction off light, TRAC OFF light, stability off light

## warning_light/power_steering_eps_light
Description: An amber, yellow, or red dashboard warning light shaped like a STEERING WHEEL with an EXCLAMATION POINT (!) next to it — or the letters "EPS" / "EPAS" / "PS" / "PSCM" next to a steering-wheel icon. EPS = Electric Power Steering (most cars built after ~2010). Illuminates when the steering computer detects a fault — common causes: weak / dying battery affecting motor voltage, torque sensor failure, steering-angle sensor out of calibration, overheated motor after prolonged maneuvering, or (older hydraulic systems) low fluid from a leak. RESULT: power assist drops out — steering becomes VERY HEAVY at low / parking-lot speeds. Drivable at highway speeds but dangerous in lots. Distinct from steering/hard_to_turn_steering_wheel, where the customer leads with the FEEL; route here only when they explicitly mention a LIGHT or icon. Distinct from multiple_warning_lights_at_once when EPS is one of many cascading lights (often a low-voltage root cause).
Positive examples:
  - "Power steering light just came on, wheel is really hard to turn"
  - "EPS warning light is glowing, steering feels heavy at low speeds"
  - "Steering wheel symbol with an exclamation point is on my dashboard"
  - "Yellow steering wheel icon came on, harder to park than usual"
  - "PSCM light on the dash, started after I replaced the battery"
  - "EPAS light came on, steering wheel feels really stiff"
  - "Power steering warning came on, wheel is hard to turn especially when parking"
Negative examples:
  - ""Steering wheel is hard to turn but I don't see any warning light" → steering/hard_to_turn_steering_wheel"
  - ""Whining noise when I turn the wheel, no warning light" → noise/whining_when_turning_the_steering_wheel"
  - ""Power steering fluid leaking, no warning light yet" → leak/red_or_pink_power_steering_fluid_leak"
  - ""Multiple warning lights came on at the same time including EPS" → multiple_warning_lights_at_once"
  - ""Check engine light is on, no steering light" → check_engine_light"
Synonyms: power steering light, power steering warning, EPS light, EPS warning, EPAS light, electric power steering light, PS light, PSCM light, steering wheel light, steering wheel icon, steering wheel with exclamation, steering wheel with !, steering assist light, power assist light, steering fault light, power steering fault, hard-steering warning

## warning_light/multiple_warning_lights_at_once
Description: THREE OR MORE warning lights illuminate on the dashboard simultaneously, OR the customer describes their dashboard as "lit up like a Christmas tree," "all the lights came on at once," or "the whole dash is glowing." Almost ALWAYS a deeper electrical-system failure cascading across modules: failing alternator producing low/erratic voltage, dying battery while engine is running, ground-strap failure, blown critical fuse, or charging wiring fault. Each module independently detects abnormal voltage and lights its own warning. Often presents alongside rough running, dim headlights, sluggish accessories, and hard cranking. CRITICAL ROUTING: if customer describes EXACTLY TWO lights that share a system (ABS + traction; red brake + ABS), prefer the more-urgent single subcategory (red brake > ABS; ABS > traction). Route HERE only when THREE OR MORE lights, OR when customer explicitly uses "all of them," "Christmas tree," or "dashboard lit up" phrasing.
Positive examples:
  - "Almost every warning light on my dash came on at the same time"
  - "Dashboard lit up like a Christmas tree while I was driving"
  - "Check engine light, battery light, ABS, and airbag light ALL on at once"
  - "Three different warning lights came on within a few seconds of each other"
  - "All the warning lights are glowing — what does that mean?"
  - "My whole dash is lit up with warnings, car is also running rough"
  - "Bunch of warning lights came on after I jump-started the car"
Negative examples:
  - ""Just the check engine light, nothing else" → check_engine_light"
  - ""Only the red brake light, parking brake released" → brake_system_red_light"
  - ""ABS light and traction control light both on" → abs_anti_lock_brake_light"
  - ""Battery light and dim headlights" → battery_charging_light"
  - ""Airbag light by itself" → airbag_srs_light"
Synonyms: multiple warning lights, multiple lights, lots of lights, many lights, all warning lights, all dashboard lights, all lights on, all lights came on, dashboard lit up, Christmas tree dashboard, lit up like a Christmas tree, every light on, every warning light, several warning lights, three lights, three warning lights, lots of warnings, dashboard going crazy, every light glowing, panel full of lights
