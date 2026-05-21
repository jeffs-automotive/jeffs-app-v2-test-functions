# Subcategory Descriptions — electrical

<!--
Authoritative subcategory metadata for the `electrical` category. Consumed by
the stage-1 diagnostic LLM classifier (Anthropic Claude Haiku 4.5). The four
fields per block — description, positive_examples, negative_examples, synonyms
— are written from real customer language extracted from automotive service /
help-guide sources (see "Research Sources" below).

Boundary notes (read these before editing — they explain the most-common
mis-routes Haiku makes inside `electrical` and across neighboring categories):

  - `wont_crank_just_clicks` vs `slow_crank_sluggish_start`
      Clicking with NO engine rotation → wont_crank_just_clicks.
      Engine rotates but laboriously / slowly → slow_crank_sluggish_start.

  - `wont_crank_just_clicks` vs `battery_drains_overnight`
      Customers often conflate these. Key signal: was the car FINE before
      sitting / did it die WHILE in use? If "fine yesterday, dead this
      morning" + repeat-jump-needed pattern → battery_drains_overnight.

  - `dim_or_flickering_lights` vs `warning_light/battery_charging_light`
      Lights themselves visibly dim or pulse → dim_or_flickering_lights.
      A specific battery-shaped icon on the dash → battery_charging_light.

  - `dim_or_flickering_lights` vs `multiple_random_electrical_glitches`
      ONLY lights, dim/flicker, usually RPM-related → dim_or_flickering_lights.
      Lights PLUS radio resets PLUS gauge jumps PLUS doors unlocking →
      multiple_random_electrical_glitches.

  - `accessory_doesnt_work` vs `multiple_random_electrical_glitches`
      ONE specific thing dead (one window, the radio, dome light, wipers) →
      accessory_doesnt_work.
      MANY things misbehaving randomly → multiple_random_electrical_glitches.

  - `car_died_while_driving_electrical` vs `performance/stalling_while_driving_under_load`
      Lights dimmed / battery light on / dashboard went dark before stall →
      car_died_while_driving_electrical (alternator / charging-system).
      Engine sputtered, stumbled, lost power under throttle (no electrical
      symptoms) → performance/stalling_while_driving_under_load (fuel / spark).

Research sources (verbatim phrase mining):
  - https://www.firestonecompleteautocare.com/blog/maintenance/car-wont-start-clicking-noise/
  - https://www.lesschwab.com/article/batteries/car-clicking-when-trying-to-start.html
  - https://radair.com/blog/2025/04/17/my-car-wont-start-clicking-noise/
  - https://bobistheoilguy.com/forums/threads/solenoid-clicks-but-no-crank.340880/
  - https://www.seattletimes.com/news/car-slow-to-crank-dont-get-him-started/
  - https://salemboysauto.com/faqs/faq-25.htm
  - https://www.autozone.com/diy/battery/what-causes-parasitic-drain-on-your-car-battery
  - https://themotorguy.com/10-common-reasons-your-car-battery-drains-overnight/
  - https://www.batterytender.com/blogs/battery-tender-blog/parasitic-battery-drain-how-to-find-and-fix-it
  - https://www.thecarbuzz.com/car-lights-flickering-while-driving/
  - https://www.tiresplus.com/blog/maintenance/headlight-flickering-causes/
  - https://www.aamcocolorado.com/signs-your-alternator-is-going-bad/
  - https://www.powerstroke.org/threads/dome-light-power-windows-and-radio-not-working.211967/
  - https://www.fordforum.com/forum/ford-excursion-22/no-power-windows-dome-light-radio-instrument-cluster-20045/
  - https://oards.com/power-window-not-working/
  - https://www.wagamonbrothers.com/blog/can-a-bad-ground-wire-cause-random-electrical-issues
  - https://www.maticsautorepair.com/blog/how-can-i-tell-if-my-car-has-a-bad-ground-connection
  - https://bobistheoilguy.com/forums/threads/weird-electrical-problems-due-to-bad-ground.317104/
  - https://bryansgarage.com/car-electrical-system-shuts-off-while-driving/
  - https://www.tiresplus.com/blog/batteries/battery-dies-while-driving/
  - https://rnrtires.com/tips-guides/what-to-do-if-your-alternator-dies-while-driving/
  - https://www.lancerservice.com/car-wont-start-in-cold-but-battery-good
-->

## electrical/wont_crank_just_clicks
Description: When the driver turns the key or presses the start button, the engine does not rotate at all — instead there is only a click (or a rapid stream of clicks that sounds like a machine gun). The starter motor is not turning the engine over. Dash lights and headlights may or may not come on, but if they do, they often dim noticeably during the click. Most often caused by a dead / weak battery, corroded battery terminals, or a failing starter / solenoid. Distinct from slow_crank_sluggish_start — there, the engine DOES rotate, just slowly. Distinct from battery_drains_overnight — if the customer mentions the car is regularly fine all day but keeps dying when parked, that's battery_drains_overnight even though it ends in a click.
Positive examples:
  - "Turn the key and all I get is a click, click, click — it won't turn over at all"
  - "I hear one loud clunk-click and then nothing happens, the engine won't crank"
  - "Just rapid clicking like a machine gun when I try to start it, jumped it and it fired right up"
  - "Car won't start, dashboard lights come on but it just clicks when I twist the key"
  - "Push the start button and nothing, just a clicking sound under the hood"
Negative examples:
  - "Engine cranks but really slowly before it starts" → slow_crank_sluggish_start
  - "Car was fine yesterday, dead this morning, third time this week I've needed a jump" → battery_drains_overnight
  - "It cranks fine but won't catch / won't fire when it's cold" → performance/hard_to_start_when_cold
  - "Cranks normal but won't start once it's hot" → performance/hard_to_start_when_hot
  - "Was driving down the highway when the dash went dark and the engine quit" → car_died_while_driving_electrical
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
  - "Just clicks, the engine doesn't turn over at all" → wont_crank_just_clicks
  - "Engine cranks at normal speed but won't fire up when it's cold" → performance/hard_to_start_when_cold
  - "Engine cranks normal but won't start when it's hot after I stop for gas" → performance/hard_to_start_when_hot
  - "Dies overnight in the parking lot, fine all day when driving" → battery_drains_overnight
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
  - "Battery is weak and slow to crank every time I start it" → slow_crank_sluggish_start
  - "Just clicks when I turn the key right now, never started this morning" → wont_crank_just_clicks
  - "Car was running and then suddenly the dash went dark and it died on the highway" → car_died_while_driving_electrical
  - "Battery light is on but the car is still running" → warning_light/battery_charging_light
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
  - "Only the driver-side headlight is out — the other one is fine" → accessory_doesnt_work
  - "Radio resets, gauges jump around, dome light comes on by itself" → multiple_random_electrical_glitches
  - "Battery-shaped warning light came on while driving" → warning_light/battery_charging_light
  - "Headlights got dim and then the car shut off completely on the highway" → car_died_while_driving_electrical
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
  - "Radio resets AND gauges jump AND dome light flickers all together" → multiple_random_electrical_glitches
  - "All four windows AND the radio AND the wipers all stopped at the same time" → multiple_random_electrical_glitches (shared-fuse/big-circuit failure, not one accessory)
  - "Headlights are dim and flicker when I drive" → dim_or_flickering_lights
  - "Heater fan won't blow at all" → hvac/vents_dont_blow_strongly
  - "Battery-shaped warning light is on" → warning_light/battery_charging_light
Synonyms: window won't work, radio dead, radio won't turn on, dome light out, wipers don't work, power lock broken, power mirror not working, cigarette lighter not working, USB port dead, accessory not working, single circuit dead, blown fuse, one window stuck, sunroof won't open, seat heater not working, power seat not moving

## electrical/multiple_random_electrical_glitches
Description: Multiple unrelated electrical things in the car are misbehaving at the same time — and the pattern feels random, intermittent, or weather-related. Customers describe "electrical gremlins": the radio resets itself, the gauges jump or sweep, warning lights flash on and off for no reason, the dome light comes on by itself, the door locks cycle, the wipers turn on randomly. Often worse over bumps, after a car wash, in humid weather, or after recent electrical / aftermarket work. Most common root causes are a bad ground / corroded ground strap, water intrusion into a module, low battery voltage, or a failing body control module (BCM). Distinct from accessory_doesnt_work — that's ONE thing dead and stable; this is MANY things misbehaving. Distinct from dim_or_flickering_lights — that's purely a brightness symptom; this is a broad mix of symptoms across unrelated circuits. Distinct from warning_light/multiple_warning_lights_at_once — that one is specifically about dashboard warning icons being lit; THIS subcategory covers a wider grab-bag of weirdness (resets, gauge sweeps, accessories cycling).
Positive examples:
  - "Bunch of weird stuff happening — radio resets, gauges jump around, dome light comes on by itself"
  - "Electrical gremlins all over the place — locks cycle on their own, wipers turn on randomly, dash lights flicker"
  - "It's always something different — one day the radio cuts out, next day the windows act up, next day a warning light flashes"
  - "Multiple things acting up at once — gets worse over bumpy roads and after rain"
  - "Random electrical issues started after I had a stereo installed, ever since the car has been glitchy"
Negative examples:
  - "Only my driver window doesn't work, everything else is fine" → accessory_doesnt_work
  - "Headlights dim and brighten with the engine RPM" → dim_or_flickering_lights
  - "Three warning lights came on at the same time — ABS, traction, and check engine" → warning_light/multiple_warning_lights_at_once
  - "Buzzing sound from the dash when the headlights are on" → noise/electrical_buzzing
Synonyms: electrical gremlins, random electrical issues, weird electrical problems, intermittent electrical, multiple things glitching, electrical bugs, ghost in the machine, things acting up, glitchy car, multiple weird symptoms, random resets, gauge sweep, gauges jumping, locks cycling, bad ground symptoms, after car wash electrical, after rain electrical

## electrical/car_died_while_driving_electrical
Description: The car was running and then died / shut off while in motion — and the failure pattern points to the ELECTRICAL / charging system rather than the engine itself. Telltale signs customers describe: the headlights and dash got progressively dim before the shutdown, the battery / CHARGE warning light came on shortly before, the radio cut out, the power steering went heavy, and finally everything just went dark "like flipping a switch." After it dies, it often won't crank back over or only gives a click. Most common cause is a failing alternator that drained the battery while driving until the car ran out of stored electricity; also possible are a broken main battery cable, a failed serpentine belt that turns the alternator, or a fusible link blowing. Distinct from performance/stalling_while_driving_under_load — that one is engine-side (sputtering, hesitation, stumbling under throttle) with no electrical warnings; here the FIRST signs are electrical (dimming lights, battery light, dashboard going dark). Distinct from battery_drains_overnight — that's a car that dies WHILE SITTING; this one died WHILE DRIVING.
Positive examples:
  - "Lights went dim, battery light came on, then the car just shut off on the highway"
  - "Everything went dark while I was driving — dash, radio, headlights — then the engine quit"
  - "Car died at a stoplight, won't restart now, only clicks when I try"
  - "Was driving and suddenly lost all power like flipping a switch, dashboard went black"
  - "Battery light came on a few miles back and then the car coasted to a stop and won't start again"
Negative examples:
  - "Engine sputtered and stumbled and lost power going uphill, no warning lights" → performance/stalling_while_driving_under_load
  - "Car kept dying in the parking lot overnight" → battery_drains_overnight
  - "Battery light came on but the car is still running fine" → warning_light/battery_charging_light
  - "Just clicks when I try to start it this morning, never moved from the driveway" → wont_crank_just_clicks
  - "Engine stalls at stoplights but restarts immediately" → performance/stalling_at_idle_or_when_stopping
Synonyms: car died while driving, shut off while driving, lost power while driving, dashboard went dark, everything shut off, alternator died on the road, car quit driving, lost all electrical power, total electrical failure, charging system failed, battery died while driving, coasted to a stop, car stranded me on the road
