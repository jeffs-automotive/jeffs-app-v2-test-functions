# Customer-language lexicon — merged reference

> **Generated:** 2026-07-18 · Wave C consolidation deliverable. Merges every `systems/*.lexicon.yaml` (24 per-system dossiers) into one concern-area-organized customer-voice reference.
>
> **What this is.** A retraining reference for the 3-stage concern classifier (`diagnose-concern.ts`). Each row is a real-voice customer phrase → what it means → the Stage-2 subcategory slug(s) it should route to → how ambiguous it is → where the voice came from. It is the **linguistic authority** (positive_examples / synonyms / keyword source), never the diagnostic authority.
>
> **Binding.** `routes_to` slugs are the exact Stage-2 `concern_subcategories.slug` values in [`00-current-scheduler-taxonomy.md`](../00-current-scheduler-taxonomy.md) §4. Slugs marked _(proposed)_ do **not** exist in the taxonomy yet — they are Wave-A/B subcategory proposals (see the per-system `*.proposals.yaml`); the classifier must not be trained to emit them until Chris applies the proposal.
>
> **Provenance is normalized to the source-policy 4-value enum** (`tekmetric | nhtsa | forum-paraphrase | synthetic`). The dossiers used finer honest sub-labels for non-real-corpus voice; those collapse here as: `eval`/`eval-corpus`/`eval-authored`/`catalog`/`db-positive` → **synthetic** (authored, not real customer text); `nhtsa-paraphrase` → **nhtsa**. Only text verbatim/near-verbatim from the real Tekmetric 500-corpus is `tekmetric`.
>
> **Ambiguity** is `unambiguous` (route confidently) · `needs-fact:<slot>` (a Stage-3 fact must be extracted or asked before a confident pick) · `cross-system:<slug>` (a confusable neighbour owns the boundary) · `non-concern` / `null-route` (a work-order/maintenance line, not a symptom → advisor, empty Stage-1).

## How to read a row

`real-voice phrase` — *normalized meaning* — **routes_to** — ambiguity — provenance. Voice is preserved exactly as customers write it: ALL-CAPS Tekmetric fragments, misspellings ("breaks", "squeeking", "loosing air"), part-name misuse, and mixed symptom+request are all intentional training signal.

## Coverage summary

- **Total merged entries:** 709  (from 725 raw rows across 24 files; 16 exact cross-file duplicates collapsed, highest-provenance instance kept).
- **Provenance breakdown (final set):**
  - `tekmetric`: 282 (40%)
  - `nhtsa`: 21 (3%)
  - `forum-paraphrase`: 189 (27%)
  - `synthetic`: 217 (31%)
- **Entries per concern area:**
  - Brakes (`brakes`): 23
  - Electrical (`electrical`): 93
  - HVAC / climate (`hvac`): 49
  - Fluid leaks (`leak`): 41
  - Noise (NVH) (`noise`): 65
  - Performance / driveability (`performance`): 121
  - Pulling / drifting (`pulling`): 12
  - Smells (`smell`): 22
  - Smoke (`smoke`): 23
  - Steering (`steering`): 17
  - Tires / TPMS / wheels (`tires`): 24
  - Vibration (`vibration`): 20
  - Warning lights (`warning_light`): 110
  - Situational (the 6 "other" buckets) (`other`): 6
  - Non-concern / null-route (→ advisor): 53
  - No current subcategory fit (→ advisor / proposed): 30

---

## Brakes — `brakes`

### → `metallic_grinding`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| Brake Inspection (LEFT REAR BRAKE GRINDING) | metallic grinding, left rear | metallic_grinding | unambiguous | tekmetric |
| brake inspection grinding when stopping | metallic grinding when braking | metallic_grinding | unambiguous | tekmetric |
| BRAKE NOISE WHEN BACKING UP SOUNDS LIKE SLIGHT GRINDING NOISE | grinding noise, on reverse braking | metallic_grinding | unambiguous | tekmetric |
| when I brake I hear a grinding noise I think I need brakes | grinding on braking + self-diagnosis request | metallic_grinding | unambiguous | forum-paraphrase |
| sounds like metal on metal every time I press the brake pedal | metal-on-metal grinding, every application | metallic_grinding | unambiguous | synthetic |

### → `high_pitched_squealing`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| brake inspection squeek | brake squeal on application | high_pitched_squealing | needs-fact:location_axle | tekmetric |
| CHECK BRAKES SQUEALING | brake squeal | high_pitched_squealing | unambiguous | tekmetric |
| WANTS TO MAKE SURE BRAKES ARE OK (Making some noise) | unspecified brake noise, inspection request | high_pitched_squealing, metallic_grinding | needs-fact:noise_descriptor | tekmetric |
| brakes squeal every time I come to a stop, worse the first few in the morning | brake squeal, cold-first-stop pattern | high_pitched_squealing | unambiguous | forum-paraphrase |
| my breaks are squeeking when i slow down | brake squeal on deceleration (misspelled) | high_pitched_squealing | unambiguous | synthetic |

### → `pulsating_or_vibrating_pedal`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| Brake Inspection. Wobbles? | unspecified brake wobble | pulsating_or_vibrating_pedal, vibration_or_pulsing_when_braking | needs-fact:onset_timing | tekmetric |
| BRAKE PEDAL ALSO VIBRATES AT HIGHWAY SPEEDS WHEN BRAKING | pedal pulsation, highway-speed braking | pulsating_or_vibrating_pedal | unambiguous | tekmetric |
| slight pulsation at high speeds, can be felt in the steering wheel, whole vehicle jerks while braking | brake pulsation felt in wheel + body | pulsating_or_vibrating_pedal, vibration_or_pulsing_when_braking | needs-fact:pedal_feel | tekmetric |
| the brakes on my ev feel different, like they let go for a second then grab, more when its cold out | STATED EV regen handoff to friction, cold battery | pulsating_or_vibrating_pedal | unambiguous | forum-paraphrase |
| my hybrid brakes feel weird and grabby especially first thing on a cold morning | STATED hybrid regen/blending feel change, cold | pulsating_or_vibrating_pedal | unambiguous | synthetic |

### → `pedal_sinks_to_floor`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| after about ten seconds the brake pedal slowly sinks and lets the van move forward | pedal creeps down at stop | pedal_sinks_to_floor | unambiguous | forum-paraphrase |
| Brake pedal not holding, it sinks to the floor | pedal sinks under held pressure | pedal_sinks_to_floor | unambiguous | forum-paraphrase |
| pedal slowly creeps down toward the floor while im pressing on it | continuous sink under steady pressure | pedal_sinks_to_floor | unambiguous | synthetic |

### → `spongy_or_soft_pedal`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| brakes feel squishy, kind of like stepping on a sponge | spongy pedal | spongy_or_soft_pedal | unambiguous | forum-paraphrase |
| pedal goes down farther than it used to before the car starts slowing | low/long pedal travel | spongy_or_soft_pedal | needs-fact:pedal_feel | forum-paraphrase |
| brake pedal has felt really soft and mushy, I have to pump it a couple times | spongy pedal, pumps to firm | spongy_or_soft_pedal | unambiguous | synthetic |

### → `hard_or_unresponsive_pedal`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| pedal feels like wood, no give at all | hard pedal, no travel | hard_or_unresponsive_pedal | unambiguous | forum-paraphrase |
| the brake pedal is crazy stiff, feels like stepping on a rock, have to stand on it | hard/unresponsive pedal, high effort | hard_or_unresponsive_pedal | unambiguous | synthetic |

---

## Electrical — `electrical`

### → `accessory_doesnt_work`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| are you able to determine why my key fob will not activate the remote start? | fob remote-start function inoperative (car still runs) | accessory_doesnt_work | needs-fact:accessory_affected | tekmetric |
| CHECK TAIL LIGHTS | taillight(s) out | accessory_doesnt_work | needs-fact:accessory_affected | tekmetric |
| dome light stays on even after closing the door | courtesy light will not extinguish | accessory_doesnt_work | unambiguous | tekmetric |
| DRIVER HEADLIGHT OUT, CLIENT REPLACED HEADLIGHT AND BULB IS STILL OUT | headlight still dark after bulb replacement (socket/ground/wiring) | accessory_doesnt_work | needs-fact:accessory_affected | tekmetric |
| HORN INOPERABLE | horn does not work | accessory_doesnt_work | unambiguous | tekmetric |
| left plate lamp | license-plate lamp out | accessory_doesnt_work | needs-fact:accessory_affected | tekmetric |
| RIGHT REAR TURN SIGNAL NOT WORKING INTERMITTENTLY, bumped it and it worked then went out | intermittent turn-signal circuit fault | accessory_doesnt_work | needs-fact:onset_timing | tekmetric |
| RIGHT REAR TURN SIGNAL NOT WORKING INTERMITTENTLY. CHECK CONNECTIONS | turn signal intermittent, one corner | accessory_doesnt_work | unambiguous | tekmetric |
| TRUNK IS INOPERABLE | trunk will not open | accessory_doesnt_work, advisor | needs-fact:accessory_affected | tekmetric |
| TRUNK WILL NOT OPEN | trunk will not open | accessory_doesnt_work, advisor | needs-fact:accessory_affected | tekmetric |
| cigarette lighter fuse keeps blowing | accessory outlet circuit repeatedly blows fuse | accessory_doesnt_work | unambiguous | forum-paraphrase |
| power door locks quit working with the key fob | power locks / fob remote not working | accessory_doesnt_work | cross-system:body-glass-water-leaks-keys | forum-paraphrase |
| power door locks quit working with the key fob then with the switch | all power locks inoperative from fob and switch | accessory_doesnt_work | unambiguous | forum-paraphrase |
| the power window controls and radio both stopped working, checked the fuses | two loads on one circuit dead together | accessory_doesnt_work, multiple_random_electrical_glitches | needs-fact:onset_timing | forum-paraphrase |
| while the security light was on i couldnt use remote start, and if i tried it the horn would honk | security-state interlock, horn honks on remote-start attempt | accessory_doesnt_work | needs-fact:accessory_affected | forum-paraphrase |
| backup camera screen is just black | dead camera display (no assist/warning framing) | accessory_doesnt_work | cross-system:electrical | synthetic |
| car alarm wont shut off / wont disarm even with the fob | alarm will not disarm | accessory_doesnt_work | unambiguous | synthetic |
| have to be right next to the car for the remote to work now | keyless entry short range / weak | accessory_doesnt_work | unambiguous | synthetic |
| heated seat on the driver side stopped working | single heated-seat load dead | accessory_doesnt_work | unambiguous | synthetic |
| horn keeps honking on its own, i had to pull the fuse to make it stop | horn/alarm honking on its own; customer disabled it | accessory_doesnt_work | unambiguous | synthetic |
| my cruise control quit working | plain set-speed cruise inop on a car with NO adaptive/radar feature — NOT ADAS | accessory_doesnt_work | cross-system:electrical | synthetic |
| my key fob stopped locking and unlocking the doors, might be the fob battery | fob remote lock/unlock inoperative | accessory_doesnt_work | unambiguous | synthetic |
| my radio is just dead, screen wont turn on and no sound at all, everything else in the car works fine | head unit dead, other accessories fine | accessory_doesnt_work | unambiguous | synthetic |
| my sunroof wont slide closed | sunroof panel actuator inoperative | accessory_doesnt_work | cross-system:window_inop_testing | synthetic |
| one of my brake lights is out | brake-light BULB out (not the dash telltale) | accessory_doesnt_work | cross-system:brakes-friction-hydraulic | synthetic |
| one of my brake lights is out back there, need a new bulb, nothing on the dash | exterior brake LAMP bulb outage, no dash warning system involved | accessory_doesnt_work | cross-system:accessory_doesnt_work | synthetic |
| only the driver-side headlight is out, the other one is fine | single lamp out, not a brightness problem | accessory_doesnt_work | unambiguous | synthetic |
| only the passenger door lock stopped working | single power-lock actuator dead | accessory_doesnt_work | needs-fact:location_side | synthetic |
| the alarm goes off randomly in the middle of the night for no reason | anti-theft alarm sounds on its own, intermittent | accessory_doesnt_work | needs-fact:accessory_affected | synthetic |

### → `slow_crank_sluggish_start`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| battery seems to give a slow crank, check and advise | slow cranking speed | slow_crank_sluggish_start | unambiguous | tekmetric |
| client has been noticing a weak/extended crank | weak, extended cranking | slow_crank_sluggish_start | unambiguous | tekmetric |
| turns over slow like the battery is about to die, 3 mornings out of 5 | intermittent slow crank, cold | slow_crank_sluggish_start | unambiguous | forum-paraphrase |
| cranks real slow in the mornings, rrr rrr rrr, then it catches | slow crank, cold, eventually starts | slow_crank_sluggish_start | unambiguous | synthetic |

### → `car_died_while_driving_electrical`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| car dies while driving, battery and oil light come on, then it restarts and they go off | stall accompanied by battery/charging warning lights | car_died_while_driving_electrical | cross-system:electrical-charging-starting | tekmetric |
| died while driving, all warning lights came on and then the vehicle just shut off | electrical shutdown with warning-light cascade | car_died_while_driving_electrical | unambiguous | tekmetric |
| battery and brake light came on, then the car couldnt go over 5mph and finally died | charging failure, progressive power loss, death | car_died_while_driving_electrical | unambiguous | forum-paraphrase |
| keeps dying when im driving, battery is new and alternator tested good | dies while driving, prior parts already tested | car_died_while_driving_electrical, battery_drains_overnight | needs-fact:speed_band | forum-paraphrase |
| the whole car went dark and shut off while i was driving | total electrical loss in motion | car_died_while_driving_electrical | cross-system:car_died_while_driving_electrical | forum-paraphrase |
| everything went dark while i was driving, dash radio headlights, then the engine quit | total electrical failure while driving | car_died_while_driving_electrical | unambiguous | synthetic |
| headlights got dim and then the car shut off on the highway, wont restart | dim precursor then dead | car_died_while_driving_electrical | cross-system:starting-charging | synthetic |

### → `battery_drains_overnight`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| client had to jump start vehicle (sat for awhile) | dead after sitting | battery_drains_overnight | needs-fact:engine_running | tekmetric |
| car was fine yesterday, dead this morning, keep having to jump it | dies while parked, repeated jumps | battery_drains_overnight | unambiguous | forum-paraphrase |
| if you leave it sit a couple days the battery is totally dead, replaced the battery and it didnt fix it | parasitic draw, replace-once-no-fix | battery_drains_overnight | unambiguous | forum-paraphrase |
| my hybrid battery keeps dying every few days, i keep having to jump the little 12 volt to get it going | STATED hybrid, REPEATED 12V aux drain (parasitic / weak aux) -> not a one-off no-start | battery_drains_overnight | unambiguous | synthetic |
| something keeps draining my battery overnight, jump it in the morning and its dead again by next day | overnight drain, daily jumps | battery_drains_overnight | unambiguous | synthetic |

### → `window_inop_testing`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| DRIVER REAR WINDOW INOP | rear driver power window inoperative | window_inop_testing | unambiguous | tekmetric |
| Passenger Side Window won't go down | power window glass will not move | window_inop_testing | unambiguous | tekmetric |
| window motor stuck | customer reports the power window not moving ("motor stuck") | window_inop_testing | unambiguous | tekmetric |
| both back windows stopped rolling down, the switches dont do anything anymore | both rear windows dead at the switch | window_inop_testing | unambiguous | synthetic |
| drivers side window is stuck halfway down and wont go back up, makes a horrible grinding noise when i hold the switch | window stalled partway with grinding on switch hold | window_inop_testing | unambiguous | synthetic |
| power window wont roll up | power window will not raise | window_inop_testing | unambiguous | synthetic |

### → `wont_crank_just_clicks`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| Jeep does not start on initial push, only on secondary push | intermittent no-crank on push-button start | wont_crank_just_clicks | needs-fact:engine_running | tekmetric |
| every time I turn the ignition I just hear one click nothing else | single click, no crank (starter/severe-resistance cue) | wont_crank_just_clicks | needs-fact:lights_state | forum-paraphrase |
| i got a bunch of click click clicks, got a jump and it started, drove around to charge it, shut it off and right away all i got were clicks again | rapid clicking, dead-battery signature, jump recovers only briefly | wont_crank_just_clicks | unambiguous | forum-paraphrase |
| my leaf wouldnt power on, had to jump the 12v and then it was fine | model-name-only EV no-power fixed by 12V jump; powertrain NOT stated | wont_crank_just_clicks | needs-fact:vehicle_powertrain | forum-paraphrase |
| one click from the starter and nothing else, i cleaned the grounds and terminals and the battery reads 12.6 volts | single click, good battery → starter / high-resistance (§3.2) | wont_crank_just_clicks | unambiguous | forum-paraphrase |
| prius wont start this morning, jumped the little 12 volt battery in the back and it fired up | model-name-only no-power fixed by 12V jump (aux battery); powertrain NOT stated | wont_crank_just_clicks | needs-fact:vehicle_powertrain | forum-paraphrase |
| pushed the power button and nothing happens, everything lights up inside but the car is dead | press start, no power-on, dash lit, powertrain NOT stated | wont_crank_just_clicks | needs-fact:vehicle_powertrain | forum-paraphrase |
| turn the key, just clicks, dash lights go dim, had to jump it | battery no-start, clicks, dim lights, jump-started | wont_crank_just_clicks | cross-system:wont_crank_just_clicks | forum-paraphrase |
| usually only in the morning i hear a single click after i turn the key then nothing, it starts after a few tries | intermittent single-click no-crank, cold mornings | wont_crank_just_clicks | needs-fact:lights_state | forum-paraphrase |
| when i turn the key nothing happens, no clicking no cranking, interior lights dim and go off but the battery light stays on | silent no-crank, lights collapse (dead battery / open connection) | wont_crank_just_clicks | needs-fact:engine_running | forum-paraphrase |
| grinding noise when i go to start it, like the gears wont catch | starter pinion/flywheel grind on start (§3.12) | wont_crank_just_clicks | unambiguous | synthetic |
| turn the key and all i get is a click click click, wont turn over at all | no-crank, starter click (NOT our cranks-but-wont-fire) | wont_crank_just_clicks | cross-system:wont_crank_just_clicks | synthetic |
| turn the key and all i get is click click click, wont turn over | rapid clicking, engine does not rotate | wont_crank_just_clicks | unambiguous | synthetic |

### → `windshield_inop_testing`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| Rear wiper starts to go and stops halfway | rear wiper parks mid-sweep | windshield_inop_testing | unambiguous | tekmetric |
| WIPERS NOT SPRAYING | washer spray not functioning | windshield_inop_testing | unambiguous | tekmetric |
| Wipers stopped working | wipers inoperative | windshield_inop_testing | unambiguous | tekmetric |
| windshield wipers totally quit working right after I went thru the car wash | wipers stopped working right after a car wash | windshield_inop_testing | unambiguous | synthetic |
| wipers barely work when its raining, they squeak dragging across the glass and the passenger side one hardly moves | weak wiper sweep, one side lagging | windshield_inop_testing | unambiguous | synthetic |

### → `multiple_random_electrical_glitches`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| the radio and clock quit working, then the power door locks quit with the fob, then more little things started acting up | several accessories dropping out over time | multiple_random_electrical_glitches | unambiguous | tekmetric |
| during damp or cold conditions the windows, wipers, door chime and dome lights all quit, then a click and they come back | several systems drop out in damp/cold weather then return after a click | multiple_random_electrical_glitches | unambiguous | forum-paraphrase |
| no run or start, intermittent dash lights, ABS traction airbag and security light also no power locks or windows | multi-module comms loss with security light, no-start | multiple_random_electrical_glitches, advisor | cross-system:multiple_warning_lights_at_once | forum-paraphrase |
| the radio and clock quit working, then the power door locks quit with the fob, then more stuff | cascading multi-accessory intermittent faults | multiple_random_electrical_glitches | unambiguous | forum-paraphrase |
| electrical stuff acts up after a car wash | intermittent electrical faults after car wash / water | multiple_random_electrical_glitches | needs-fact:recent_action | synthetic |
| one day the radio resets itself, next day the door locks click on their own, next day the gauges jump around, always worse after it rains | multiple random electrical glitches, worse after rain | multiple_random_electrical_glitches | unambiguous | synthetic |
| one day the radio resets itself, next day the door locks click on their own, next day the gauges jump around, random stuff always worse after rain | varied accessories glitch intermittently, weather-linked | multiple_random_electrical_glitches | unambiguous | synthetic |

### → `windshield_inop_testing:service`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| WASHERS NOT SPRAYING. | washers do not spray | windshield_inop_testing:service | unambiguous | tekmetric |
| WIPERS NOT SPRAYING TESTING AUTH UP TO 179 IF NEEDED | washers do not spray (operation, not a leak) | windshield_inop_testing:service | unambiguous | tekmetric |
| my wipers quit right after i went thru the car wash | wipers dead after water intrusion | windshield_inop_testing:service | needs-fact:recent_action | synthetic |
| my wipers wont shut off, they keep going after i turn the switch off | wipers won't park / won't turn off (park-switch or motor fault) | windshield_inop_testing:service | unambiguous | synthetic |
| nasty grinding noise from my wipers when i turn them on | wiper grind / drag | windshield_inop_testing:service | needs-fact:noise_descriptor | synthetic |
| windshield wipers are moving way slower than normal and sometimes stall halfway up the glass | slow wiper, stalls mid-sweep | windshield_inop_testing:service | unambiguous | synthetic |
| wipers barely work when its raining and the passenger side one hardly moves | weak wiper sweep, one side worse | windshield_inop_testing:service | needs-fact:location_side | synthetic |

### → `dim_or_flickering_lights`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| headlights & dash lights flicker almost all the time | all lights flickering together | dim_or_flickering_lights | needs-fact:lights_state | forum-paraphrase |
| headlights and dash lights flicker almost all the time while driving | flickering lights, charging instability | dim_or_flickering_lights | unambiguous | forum-paraphrase |
| headlights and interior lights start to flicker while driving and the radio cuts out sometimes | whole-system flicker with accessory dropout | dim_or_flickering_lights | needs-fact:lights_state | forum-paraphrase |
| i was driving one night and my headlights were flickering, i turned on the interior light and it was flickering too, after a while it stopped | flickering headlights + interior lights, intermittent | dim_or_flickering_lights | unambiguous | forum-paraphrase |
| interior and dash lights flicker and dim when the car idles, brighten when i rev it | RPM-linked light dimming (charging system) | dim_or_flickering_lights | cross-system:charging_starting_testing | forum-paraphrase |
| my headlights keep flickering on and off, i changed the switch and it stopped for a while but now its doing it again | recurring headlight flicker | dim_or_flickering_lights | unambiguous | forum-paraphrase |
| headlights pulse brighter and dimmer at stoplights, brighten when I rev | brightness tracks RPM (alternator cue) | dim_or_flickering_lights | cross-system:starting-charging | synthetic |
| my headlights keep going dimmer and brighter on their own, brighter when i rev and dimmer at stoplights | pulsing brightness tracking rpm (alternator cue) | dim_or_flickering_lights | unambiguous | synthetic |
| my headlights keep going dimmer and brighter on there own at night, its kinda freaky | headlight brightness pulsing | dim_or_flickering_lights | cross-system:starting-charging | synthetic |

### → `hybrid_or_ev_wont_power_on (proposed)`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| my hybrid wont start, all the dash lights come on but it wont go to ready and it wont move | STATED hybrid will not enter READY, electronics alive, no motion | hybrid_or_ev_wont_power_on _(proposed)_ | unambiguous | synthetic |

---

## HVAC / climate — `hvac`

### → `ac_blows_warm_or_hot_air`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| A/C BLOWING WARM AIR (PERF CHECK AUTH) | AC blows warm, no cooling | ac_blows_warm_or_hot_air | unambiguous | tekmetric |
| A/C not getting cold (air was warmer out of driver side) | AC not cold, warmer on one side | ac_blows_warm_or_hot_air, one_zone_works_but_another_doesnt | needs-fact:location_side | tekmetric |
| CLIENT IS REPORTING AC IS NOT BLOWING COLD | AC not blowing cold | ac_blows_warm_or_hot_air | unambiguous | tekmetric |
| put in refrigerant with dye, the AC just stopped working again | recharged with dye, failed again (symptom subcat ac_blows_warm; SERVICE is ac_leak_testing) | ac_blows_warm_or_hot_air | needs-fact:recent_action | tekmetric |
| AC blows hot air in the summer even turned all the way to cold, like the heat is stuck on | AC blows HOT with cold selected (blend door stuck full-hot, §3.12 — NOT low refrigerant) | ac_blows_warm_or_hot_air | unambiguous | forum-paraphrase |
| AC quit all of a sudden, blows straight hot air like its not even on | AC failed suddenly, hot air | ac_blows_warm_or_hot_air | needs-fact:started_when | forum-paraphrase |
| refrigerant is full, compressor is turning, but it just blows hot air | charged and running yet no cool | ac_blows_warm_or_hot_air | unambiguous | forum-paraphrase |
| compressor isnt kicking in, no click when I turn AC on | compressor clutch not engaging | ac_blows_warm_or_hot_air | unambiguous | synthetic |

### → `one_zone_works_but_another_doesnt`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| A/C not cooling out of the drivers side only | driver-zone no cool, passenger fine | one_zone_works_but_another_doesnt | needs-fact:location_side | tekmetric |
| CHECK A/C. WORKS WELL ON THE PASSENGER SIDE BUT NOT SO WELL ON DRIVER'S SIDE | cooling asymmetric between zones | one_zone_works_but_another_doesnt | unambiguous | tekmetric |
| CLIENT REPORTS PASSENGER SIDE ONLY BLOWS LUKE-COLD, A/C CHECK OK | one zone under-cools, other fine | one_zone_works_but_another_doesnt | needs-fact:location_side | tekmetric |
| passenger side vents blow warm but the driver side is ice cold, turning the passenger dial doesnt change anything | one-side temp wrong, dial dead (blend actuator) | one_zone_works_but_another_doesnt | unambiguous | synthetic |

### → `ac_is_weak_not_cold_enough`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| AC back to not working properly. We recharged system last July | cooling lost again after prior recharge (symptom subcat ac_is_weak; SERVICE is ac_leak_testing) | ac_is_weak_not_cold_enough | needs-fact:recent_action | tekmetric |
| AC isnt as cold as it used to be | cooling degraded, still partial | ac_is_weak_not_cold_enough | unambiguous | tekmetric |
| blows warm for about 20 mins, then will cool down | AC blows warm at first, then cools after ~20 min (warm->cool as literally stated; do NOT assert evaporator-freeze, whose signature is cold->warm->cold) | ac_is_weak_not_cold_enough | unambiguous | tekmetric |
| blows cold on cooler days, but hot air at 85+ degrees | cooling fails only on hot days (low charge) | ac_is_weak_not_cold_enough | needs-fact:weather_condition | forum-paraphrase |
| cools fine on the highway but barely cools at stoplights | cooling weak at idle, better moving | ac_is_weak_not_cold_enough | needs-fact:speed_band | synthetic |

### → `vents_dont_blow_strongly`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| AC Fan motor not working | blower motor inoperative | vents_dont_blow_strongly | needs-fact:airflow_state | tekmetric |
| BLOWER NOT WORKING ON ANY SPEEDS SINCE VEHICLE WAS PICKED UP AFTER STARTER & BATTERY | blower dead after unrelated service | vents_dont_blow_strongly | needs-fact:recent_action | tekmetric |
| blower only works on high & is very noisy | fan only on highest speed (resistor) + noise | vents_dont_blow_strongly | unambiguous | tekmetric |
| air gets very weak after about 20 minutes, hardly blowing even on high | airflow fades after warmup (icing/filter) | vents_dont_blow_strongly | needs-fact:started_when | forum-paraphrase |
| air only comes out the defroster no matter what setting I pick, wont switch to the dash vents | air stuck on wrong outlets, mode door not moving (§3.11); airflow volume normal | vents_dont_blow_strongly | needs-fact:airflow_state | forum-paraphrase |
| no air blowing from vents, blower motor and resistor changed with no luck | no airflow, parts already swapped | vents_dont_blow_strongly | needs-fact:airflow_state | forum-paraphrase |
| fan only blows on the highest setting, speeds 1 2 3 do nothing | blower resistor failure (only-high) | vents_dont_blow_strongly | unambiguous | synthetic |

### → `bad_smell_from_vents`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| CUSTOMER STATES THERE IS A BURNING SMELL WHEN TURNING ON THE A/C | burning vent smell on AC (blower/resistor) | bad_smell_from_vents | needs-fact:smell_descriptor | tekmetric |
| gym-bag smell with recirc on, goes away when I turn recirc off | musty evaporator odor (customer notes it tracks recirc, but there is NO air-source slot; recirc-dependence probe Q971 is intentionally_empty) | bad_smell_from_vents | unambiguous | forum-paraphrase |
| sweet smell coming from my vents when I turn on the heat, gives me a headache | sweet coolant smell through dash vents (heater core) | bad_smell_from_vents | cross-system:sweet_smell_maple_syrup_antifreeze | forum-paraphrase |
| sweet smell like maple syrup comes out when the heater is on, windows fog up | sweet vent odor with heat (heater core) | bad_smell_from_vents | cross-system:sweet_smell_maple_syrup_antifreeze | forum-paraphrase |
| when I turn on the A/C the air stinks like a mildew order | mildew vent odor with AC | bad_smell_from_vents | unambiguous | forum-paraphrase |
| nasty musty smell like dirty gym socks from the vents when I first turn the AC on | musty vent odor on AC start (evaporator) | bad_smell_from_vents | unambiguous | synthetic |

### → `heat_doesnt_work`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| HEAT BLOWING COLD AIR | heater blows cold | heat_doesnt_work | unambiguous | tekmetric |
| Heat only works when the vehicle is moving, as soon as it stops it goes cold | heat fails at idle, works at speed (low coolant/airflow) | heat_doesnt_work | needs-fact:temperature_gauge_state | tekmetric |
| Heat only works when vehicle is moving, as soon as it stops goes cold | heat present at speed, cold at idle (low coolant/flow) | heat_doesnt_work | needs-fact:temperature_gauge_state | tekmetric |
| heater just blows cold no matter how long I drive, had to top off the coolant tank twice | no heat plus repeated coolant top-offs | heat_doesnt_work | needs-fact:temperature_gauge_state | tekmetric |
| NO HEAT. GAUGE SOMETIMES GOES UP | no cabin heat with intermittently high temp gauge | heat_doesnt_work, engine_temperature_light | cross-system:engine_temperature_light | tekmetric |
| no heat but the a/c works perfectly | heat dead, AC fine (heat-side only) | heat_doesnt_work | unambiguous | forum-paraphrase |
| no hot air from heater, antifreeze level is good | no heat, coolant full (thermostat/heater core) | heat_doesnt_work | needs-fact:temperature_gauge_state | forum-paraphrase |
| takes forever to get any warm air and its never really hot | slow/insufficient heat (stuck-open thermostat) | heat_doesnt_work | needs-fact:temperature_gauge_state | forum-paraphrase |

### → `foggy_or_hard_to_defog_windows`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| inside of my windshield keeps fogging up when it rains and the defroster barely clears it | persistent interior fog, defrost ineffective | foggy_or_hard_to_defog_windows | needs-fact:weather_condition | tekmetric |
| inside of the windshield has a greasy film I cant wipe off | oily film on glass (heater core vapor) | foggy_or_hard_to_defog_windows | unambiguous | forum-paraphrase |
| Rear window defroster doesn't work, lines on the back glass dont heat up | rear defogger grid dead | foggy_or_hard_to_defog_windows | needs-fact:accessory_affected | synthetic |
| rear window defroster doesnt work, the lines on the back glass dont heat up | rear defroster grid dead (electrical) | foggy_or_hard_to_defog_windows | unambiguous | synthetic |
| windows fog up bad in the rain, defrost barely helps | interior fog in wet weather | foggy_or_hard_to_defog_windows | needs-fact:weather_condition | synthetic |

### → `strange_noise_from_vents`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| LOUD NOISE WHEN A/C ON SEEMS TO HESITATE | noise on AC engage, engine drags (compressor load?) | strange_noise_from_vents | cross-system:high_pitched_whining_under_the_hood | tekmetric |
| sounds like water sloshing around behind the dash when I turn or come to a stop | condensate slosh/gurgle behind dash (clogged evaporator drain, §3.10) | strange_noise_from_vents | unambiguous | forum-paraphrase |
| whistling sound coming out of the air vents at higher fan speeds | vent whistle at high fan (duct/filter) | strange_noise_from_vents | needs-fact:noise_descriptor | forum-paraphrase |
| clicking behind the dash when i switch from heat to ac | blend-door actuator click tied to HVAC mode | strange_noise_from_vents | cross-system:strange_noise_from_vents | synthetic |
| tick tick tick from the dash right after I start the car and when I move the temperature dial | actuator clicking on temp change | strange_noise_from_vents | needs-fact:noise_descriptor | synthetic |
| vents make a rattling sound when the fan is on, stops when I turn it off | fan-dependent rattle (debris in blower) | strange_noise_from_vents | unambiguous | synthetic |

---

## Fluid leaks — `leak`

### → `clear_yellow_or_light_brown_puddle_brake_fluid`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| ATTEMPTED TO ADD BRAKE FLUID AND LEAKS RIGHT OUT | brake fluid leak, fluid won't hold | clear_yellow_or_light_brown_puddle_brake_fluid | unambiguous | tekmetric |
| leak appears to be near lines close to brake fluid | leak at brake lines | clear_yellow_or_light_brown_puddle_brake_fluid | needs-fact:fluid_color | tekmetric |
| amber colored drips near my front tire and the brake pedal feels soft lately | amber/light-brown drip near a wheel + soft pedal (brake fluid, SAFETY) | clear_yellow_or_light_brown_puddle_brake_fluid | needs-fact:fluid_under_car_location | forum-paraphrase |
| brown liquid that looks yellow when it dries, maybe brake fluid | clear-yellow oily puddle, suspected brake fluid | clear_yellow_or_light_brown_puddle_brake_fluid | needs-fact:fluid_under_car_location | forum-paraphrase |
| thin clear fluid leaking near the clutch and the pedal is going soft | hydraulic-clutch leak - clutch master/slave runs DOT brake fluid, so reads as brake fluid | clear_yellow_or_light_brown_puddle_brake_fluid | needs-fact:fluid_under_car_location | synthetic |

### → `green_orange_yellow_or_pink_puddle_coolant`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| bright blue coolant looking stuff under my Honda | blue coolant puddle | green_orange_yellow_or_pink_puddle_coolant | cross-system:blue_or_light_blue_puddle_washer_fluid | tekmetric |
| bright green puddle right under the front by the radiator, smells sweet | green coolant puddle front-center with sweet smell | green_orange_yellow_or_pink_puddle_coolant | unambiguous | tekmetric |
| bright green puddle under the radiator and it smells sweet | coolant puddle, sweet smell | green_orange_yellow_or_pink_puddle_coolant | cross-system:coolant_leak_testing | tekmetric |
| CLIENT SEES LEAK AT LOWER LINE ON RADIATOR | coolant leaking at radiator hose/line | green_orange_yellow_or_pink_puddle_coolant | unambiguous | tekmetric |
| coolant leak, having to top off a few times | recurring coolant loss requiring top-offs | green_orange_yellow_or_pink_puddle_coolant | unambiguous | tekmetric |
| LARGE PUDDLE OF ANTIFREEZE under the car | bright coolant puddle under front of vehicle | green_orange_yellow_or_pink_puddle_coolant | unambiguous | tekmetric |
| add water into the reserve it pours out the bottom of the engine | coolant added but leaks straight out (gasket/freeze plug) | green_orange_yellow_or_pink_puddle_coolant | needs-fact:fluid_under_car_location | forum-paraphrase |
| bright blue slimy fluid right under the radiator, smells sweet | Asian-OEM coolant (NOT washer) | green_orange_yellow_or_pink_puddle_coolant | cross-system:cooling-system | synthetic |

### → `brown_or_black_puddle_engine_oil`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| Find and fix oil leak | engine-oil leak, wants it found and fixed | brown_or_black_puddle_engine_oil | unambiguous | tekmetric |
| oil leaking. severe potential drain plug? | heavy engine-oil leak, suspects drain plug | brown_or_black_puddle_engine_oil | unambiguous | tekmetric |
| possible oil and coolant leaks, puddle under both turbos and the oil cooler, coolant and oil both low | oil (and coolant) leak at turbo/oil-cooler housing, low oil | brown_or_black_puddle_engine_oil | cross-system:engine-lubrication-oil | tekmetric |
| under vehicle leak | unspecified leak under the car | brown_or_black_puddle_engine_oil | needs-fact:fluid_color | tekmetric |
| car has sat for a month and i woke up to a puddle of oil under it | oil puddle after the car sat unused | brown_or_black_puddle_engine_oil | unambiguous | forum-paraphrase |
| constantly drips oil from the bottom where the engine and transmission bolt up, underneath soaked front to back | rear-main / bell-housing oil leak, heavy | brown_or_black_puddle_engine_oil | cross-system:red_or_pink_puddle_transmission_or_power_steering | forum-paraphrase |
| leaks something that looks and feels like oil but smells like nothing and my levels arent dropping | oily-looking clear drip, no odor, no level loss | brown_or_black_puddle_engine_oil, clear_odorless_puddle_water_or_ac_condensation | needs-fact:fluid_color | forum-paraphrase |
| oil dripping off a plastic cover near the front, 3-4 inch spots on the driveway | front oil drip pooling on a cover, driveway spots | brown_or_black_puddle_engine_oil | unambiguous | forum-paraphrase |

### → `thick_dark_brown_puddle_gear_or_differential_oil`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| rear axle seal leak | axle seal gear-oil leak (work-order voice) | thick_dark_brown_puddle_gear_or_differential_oil | unambiguous | tekmetric |
| rear differential leak inspect and advise | diff leak inspection request (work-order voice) | thick_dark_brown_puddle_gear_or_differential_oil | unambiguous | tekmetric |
| thick dark fluid under the rear axle and it smells like rotten eggs | gear-oil leak, sulfur smell, rear | thick_dark_brown_puddle_gear_or_differential_oil | unambiguous | tekmetric |
| sticky black greasy mess dripping from the pumpkin on the back axle | diff housing gear-oil seep | thick_dark_brown_puddle_gear_or_differential_oil | unambiguous | synthetic |
| thick dark oil under the middle of my stick shift, smells like sulfur | manual gearbox gear-oil leak, mid-car | thick_dark_brown_puddle_gear_or_differential_oil | needs-fact:fluid_under_car_location | synthetic |

### → `red_or_pink_puddle_transmission_or_power_steering`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| TOW IN POWER STEERING PUMP BADLY LEAKING FLUID | PS pump fluid leak, named part (TRUNCATED fragment) | red_or_pink_puddle_transmission_or_power_steering, car_has_been_sitting_unused_for_a_long_time | situational-override:car_has_been_sitting_unused_for_a_long_time | tekmetric |
| transmission cooler line leaking | ATF cooler line leak | red_or_pink_puddle_transmission_or_power_steering | unambiguous | tekmetric |
| bright red puddle under the front of my car, steering feels totally normal not hard at all | red/pink leak, steering explicitly normal | red_or_pink_puddle_transmission_or_power_steering | needs-fact:steering_feel | forum-paraphrase |
| drips and small puddles of power steering fluid under the front driver side | red/pink PS-fluid leak, front-driver location | red_or_pink_puddle_transmission_or_power_steering | unambiguous | forum-paraphrase |
| bright red oily fluid under the middle of the car | red fluid mid-car (trans/PS) | red_or_pink_puddle_transmission_or_power_steering | cross-system:transmission_testing | synthetic |
| bright red puddle under the middle of my car | ATF leak, mid-underbody | red_or_pink_puddle_transmission_or_power_steering | needs-fact:fluid_under_car_location | synthetic |
| pink oily fluid leaking under the front, hard to turn the wheel now | red fluid front + heavy steering (power steering, not trans) | red_or_pink_puddle_transmission_or_power_steering | cross-system:steering-power-steering | synthetic |
| red oily drip toward the back under the transmission | ATF pan/seal leak | red_or_pink_puddle_transmission_or_power_steering | unambiguous | synthetic |

### → `blue_or_light_blue_puddle_washer_fluid`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| WASHER FLUID LEAKING. TESTING AUTH | washer fluid puddle/leak | blue_or_light_blue_puddle_washer_fluid | needs-fact:fluid_color | tekmetric |
| Light blue watery puddle near my front tire, washer fluid won't spray anymore | blue watery puddle + empty washer | blue_or_light_blue_puddle_washer_fluid | unambiguous | synthetic |
| looks like windex leaking under the car | washer-fluid-colored leak | blue_or_light_blue_puddle_washer_fluid | needs-fact:fluid_color | synthetic |

### → `clear_odorless_puddle_water_or_ac_condensation`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| floor is full of water, only happens when I drive with the air conditioning on | cabin flooding on AC (evaporator drain) | clear_odorless_puddle_water_or_ac_condensation | cross-system:water_leaking_inside_cabin_ac_on (PROPOSED) | forum-paraphrase |
| slow drip onto the passenger side carpet when the a/c is on | AC water INSIDE cabin (clogged evaporator drain) | clear_odorless_puddle_water_or_ac_condensation | cross-system:water_leaking_inside_cabin_ac_on (PROPOSED) | forum-paraphrase |
| found a small puddle under the passenger side of my car, completely clear with no smell, feels just like plain water | clear odorless puddle under car | clear_odorless_puddle_water_or_ac_condensation | cross-system:clear_odorless_puddle_water_or_ac_condensation | synthetic |
| found a small puddle under the passenger side, completely clear no smell, just like plain water | clear odorless water under car (AC drain, normal) | clear_odorless_puddle_water_or_ac_condensation | unambiguous | synthetic |

---

## Noise (NVH) — `noise`

### → `squeaking_or_creaking_over_bumps`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| chassis squeaking. lube? | chassis squeak, customer asks if it needs lube | squeaking_or_creaking_over_bumps | unambiguous | tekmetric |
| CHECK CREAKING NOISE OVER BUMPS. POSSIBLE HEATSHIELD? | creak over bumps, customer suspects heat shield | squeaking_or_creaking_over_bumps | cross-system:rattling_underneath_the_car | tekmetric |
| CHECK SQUEAKING IN REAR OVER BUMPS. CAN HEAR IF PUSHING DOWN ON BUMPER | rear suspension squeak over bumps, reproducible by bouncing the bumper | squeaking_or_creaking_over_bumps | unambiguous | tekmetric |
| SQUEAKING NOISE GOING OVER BUMPS, hears it on uneven roads | squeak over bumps and on uneven roads | squeaking_or_creaking_over_bumps | unambiguous | tekmetric |

### → `popping_or_clicking_when_turning`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| clicking noise from the front only when i turn in parking lots | CV click on low-speed turns | popping_or_clicking_when_turning | unambiguous | tekmetric |
| clacking from the driver side when im backing up and turning | one-sided CV clack, reverse + turn | popping_or_clicking_when_turning | needs-fact:location_side | forum-paraphrase |
| clicking sound turning both left and right, gets louder the sharper i turn | CV click both directions, scales with angle | popping_or_clicking_when_turning | unambiguous | forum-paraphrase |
| popping when i corner but nothing when the wheels are straight | turn-only pop, absent straight | popping_or_clicking_when_turning | unambiguous | forum-paraphrase |
| there is a clicking sound when i turn | bare turn-click, no side/speed named (sparse) | popping_or_clicking_when_turning | cross-system:power_steering_eps_testing | forum-paraphrase |
| clicking axle when turning, i see grease flung on the inside of the tire | torn CV boot, grease slung, click on turn | popping_or_clicking_when_turning | unambiguous | synthetic |
| tick tick tick when i make a sharp turn, faster the tighter i go | rhythmic CV click scaling with turn angle | popping_or_clicking_when_turning | unambiguous | synthetic |

### → `humming_or_whirring_at_speed`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| dealership said wheel bearings were needed, wants a second opinion | prior-shop wheel-bearing diagnosis, second opinion | humming_or_whirring_at_speed | needs-fact:customer_request_type | tekmetric |
| front passenger side tire makes noise | noise localized to front-right wheel area | humming_or_whirring_at_speed | needs-fact:noise_descriptor | tekmetric |
| roar and clicking/tapping | roar plus clicking/tapping | humming_or_whirring_at_speed | cross-system:suspension_steering_check | tekmetric |
| ROTATIONAL NOISE HEARD IN LEFT REAR | rotational (speed-linked) noise, left rear | humming_or_whirring_at_speed | unambiguous | tekmetric |
| tires making a strange noise when driving | unspecified wheel-area driving noise | humming_or_whirring_at_speed | needs-fact:noise_descriptor | tekmetric |
| Very noticeable humming coming from the rear end, most noticeable at 30 to 40 mph | speed-dependent hum from the rear (wheel bearing) | humming_or_whirring_at_speed | cross-system:humming_or_whirring_at_speed | tekmetric |
| very noticeable humming from the rear end, most noticeable 30 to 40 mph, sounds like aggressive snow tires | road-speed hum from rear, bearing-like | humming_or_whirring_at_speed | needs-fact:steering_load_effect | tekmetric |
| very noticeable humming from the rear end, most noticeable 30 to 40 mph, sounds like snow tires | bearing/diff hum rising with road speed | humming_or_whirring_at_speed | needs-fact:location_side | tekmetric |
| abs and traction light came on and theres a growling humming from one of the front wheels | hub bearing tripping ABS/traction light + growl (one fault, not two) | humming_or_whirring_at_speed | cross-system:abs_traction_stability_testing | forum-paraphrase |
| gear whine that gets louder going up hills and doesnt match the engine rpm | diff/gear whine tracking road speed not rpm | humming_or_whirring_at_speed | cross-system:transmission_testing | forum-paraphrase |
| humming that gets louder curving left and quieter curving right, feel it in the floor | wheel-bearing hum, steering-load sensitive | humming_or_whirring_at_speed | unambiguous | forum-paraphrase |
| humming that gets louder curving left, quieter curving right, feel it in the floor | steering-load-sensitive hum (right bearing implicated) | humming_or_whirring_at_speed | unambiguous | forum-paraphrase |
| loud humming at low speed on the driver side, less at higher speed, almost like a tire bulge | bearing hum, side-specific | humming_or_whirring_at_speed | needs-fact:location_side | forum-paraphrase |
| whine when accelerating that stops when i let off the gas, they said maybe the differential | diff whine, accel/drive-side (ring & pinion mesh) | humming_or_whirring_at_speed | cross-system:transmission_testing | forum-paraphrase |
| whirring noise only when i coast or let off the gas, quiet on the throttle | coast-side diff whine (pinion bearing preload) | humming_or_whirring_at_speed | cross-system:transmission_testing | forum-paraphrase |
| rear end is whining and theres dark oil dripping back there | diff whine + gear-oil leak co-symptom | humming_or_whirring_at_speed, thick_dark_brown_puddle_gear_or_differential_oil | needs-fact:fluid_color | synthetic |
| sounds like an airplane taking off from the rear when im on the highway | roaring bearing hum at speed | humming_or_whirring_at_speed | needs-fact:location_axle | synthetic |
| sounds like an airplane taking off when I'm on the highway | loud road-speed roar (bearing) | humming_or_whirring_at_speed | needs-fact:steering_load_effect | synthetic |

### → `clunking_over_bumps`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| DRAGGING NOISE OCCURRING IN THE FRONT END | dragging/scraping noise in the front end | clunking_over_bumps | cross-system:brake_inspection | tekmetric |
| loud clunk from the front driver side every time i go over a bump or pothole | front-left clunk on every bump | clunking_over_bumps | unambiguous | tekmetric |
| Loud noises coming from front wheel well | loud noise from front wheel area | clunking_over_bumps | needs-fact:noise_descriptor | tekmetric |
| suspension noise mainly over bumps | suspension noise triggered by bumps | clunking_over_bumps | unambiguous | tekmetric |
| Vehicle has clunking in front end when driving, client thinks failing tie rod ends | front-end clunk over the road, customer guesses tie rods | clunking_over_bumps | needs-fact:onset_timing | tekmetric |
| Front pop/clunk from the passenger side front wheel, I assumed sway bar links or bushings | front-right clunk over bumps, guessed sway-bar links/bushings | clunking_over_bumps | unambiguous | forum-paraphrase |

### → `engine_ticking_or_tapping`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| engine sounds like a sewing machine when i first start it in the morning | sewing-machine tick on cold start | engine_ticking_or_tapping | needs-fact:symptom_warmup_trend | tekmetric |
| lifter tick that quiets down after about a minute of driving | lifter tick partially easing after warm-up | engine_ticking_or_tapping | needs-fact:symptom_warmup_trend | tekmetric |
| making a ticking noise when driving | engine ticking while driving | engine_ticking_or_tapping | needs-fact:sound_or_smoke_location_zone | tekmetric |
| My car has started making an intermittent tapping. It does it for a few seconds and then stops, and then does it again | intermittent engine tapping | engine_ticking_or_tapping | needs-fact:onset_timing | tekmetric |
| sounds like a typewriter up top when it idles | rapid top-end tapping at idle | engine_ticking_or_tapping | unambiguous | synthetic |

### → `exhaust_louder_or_rumbling`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| not sure but my car is rumbling. i think there's something wrong with the alignment | rumble, misattributed to alignment | exhaust_louder_or_rumbling | needs-fact:noise_descriptor | tekmetric |
| SEEMS LOUDER THAN NORMAL, SEEMS TO BE STRUGGLING TO DRIVE, CLIENT THINKS EXHAUST ISSUE | exhaust louder than normal, customer suspects exhaust | exhaust_louder_or_rumbling | unambiguous | tekmetric |
| the car makes a noise sometimes when driving. it appears to be the muffler that is loose | intermittent driving noise, loose muffler | exhaust_louder_or_rumbling | unambiguous | tekmetric |
| the client hears an exhaust leak and thinks it may be coming from one of the flanges | audible exhaust leak, suspected flange | exhaust_louder_or_rumbling, exhaust_manifold_tick_or_puff | needs-fact:onset_timing | tekmetric |
| the car got crazy loud all of a sudden, sounds like a motorcycle now. pretty sure the muffler rusted out | sudden loud exhaust, suspected rusted muffler | exhaust_louder_or_rumbling | unambiguous | synthetic |

### → `deep_knocking_from_the_engine`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| sounds like someone is hammering inside the engine and the oil light flickered | bottom-end hammer with oil-pressure light | deep_knocking_from_the_engine | unambiguous | tekmetric |
| engine is knocking, thought it was the transmission | engine knock misattributed to transmission | deep_knocking_from_the_engine | cross-system:low_power_or_wont_accelerate_normally | forum-paraphrase |
| knocking sound coming from the motor | knock from the engine | deep_knocking_from_the_engine | cross-system:wont_crank_just_clicks | forum-paraphrase |
| deep heavy banging from down low that gets worse when i accelerate | load-dependent bottom-end knock | deep_knocking_from_the_engine | unambiguous | synthetic |

### → `high_pitched_whining_under_the_hood`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| water pump pulley was wobbling | water-pump bearing play, wobbling pulley | high_pitched_whining_under_the_hood | cross-system:humming_or_whirring_at_speed | tekmetric |
| whine noise when running | under-hood whine present while running | high_pitched_whining_under_the_hood | cross-system:starting-charging | tekmetric |
| whining noise when i shut the car off, can hear it slightly while running, kind of metal on metal | whine most audible on shutdown (a bearing/water-pump cue), faint while running | high_pitched_whining_under_the_hood | cross-system:engine-mechanical | tekmetric |
| whining noise when shutting off, sounds like metal on metal, friend says water pump | water-pump bearing whine/growl | high_pitched_whining_under_the_hood | cross-system:green_orange_yellow_or_pink_puddle_coolant | tekmetric |
| cvt whines like a turbo when i speed up | CVT belt/pulley whine rising with speed | high_pitched_whining_under_the_hood | needs-fact:vehicle_powertrain | forum-paraphrase |
| i hear a whine while accelerating that gets louder going up hills | RPM/load-tied whine (belt/alternator/driveline) | high_pitched_whining_under_the_hood | cross-system:noise_when_turning_the_steering_wheel | forum-paraphrase |
| whine while accelerating that doesnt match the wheels, real loud going up hills | rising whine under load, louder uphill (does not track engine RPM cleanly) | high_pitched_whining_under_the_hood | cross-system:driveline-cv-diff-awd | forum-paraphrase |
| my supercharger whines louder the more i give it gas | supercharger whine rising with RPM/load | high_pitched_whining_under_the_hood | needs-fact:onset_timing | synthetic |
| whining noise that gets louder the faster i drive, in every gear | speed-dependent transmission/gear whine | high_pitched_whining_under_the_hood, humming_or_whirring_at_speed | cross-system:steering-power-steering | synthetic |

### → `exhaust_manifold_tick_or_puff`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| i think i have an exhaust manifold leak, it ticks at startup | suspected manifold-gasket leak, tick at startup | exhaust_manifold_tick_or_puff | unambiguous | forum-paraphrase |
| ticking from the engine bay that gets quieter when it warms up and the exhaust sounds louder | exhaust-manifold-gasket tick + louder exhaust | exhaust_manifold_tick_or_puff | cross-system:exhaust_system_testing | forum-paraphrase |
| my engine makes a fast ticking noise when i first start it cold in the morning, goes away after it warms up a few minutes | cold-start tick that fades when warm | exhaust_manifold_tick_or_puff | unambiguous | synthetic |
| ticking from the engine bay on cold mornings that goes away completely after five minutes | cold-start tick that fully clears when warm | exhaust_manifold_tick_or_puff | unambiguous | synthetic |

### → `electrical_buzzing`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| with the key turned to on it makes a buzzing or humming noise | key-on buzz/hum | electrical_buzzing | needs-fact:sound_or_smoke_location_zone | forum-paraphrase |
| buzzing coming from behind the dash | buzz localized behind dashboard | electrical_buzzing | cross-system:strange_noise_from_vents | synthetic |
| theres this weird electrical buzzing sound in my car, kinda sounds like a beehive | electrical buzz, relay/actuator cue | electrical_buzzing | unambiguous | synthetic |

---

## Performance / driveability — `performance`

### → `engine_misfire_or_bucking_feeling`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| 2 times the check engine light came on and caused a bad misfire, both times cold and going downhill, shut it off and it ran fine | intermittent cold misfire, self-clears on restart | engine_misfire_or_bucking_feeling | unambiguous | tekmetric |
| blinking check engine light, car is rumbling, feels like spark plugs and coils | flashing MIL with misfire feel | engine_misfire_or_bucking_feeling | unambiguous | tekmetric |
| Blinking check engine light, car is rumbling. Has had issues with spark plugs and ignition coils in the past and feels similar | flashing CEL with rough running, prior plug/coil misfire history | engine_misfire_or_bucking_feeling | needs-fact:engine_running | tekmetric |
| customer states vehicle is shaking and bucking | shaking and bucking (misfire feel) | engine_misfire_or_bucking_feeling | needs-fact:onset_timing | tekmetric |
| going up any incline the car pulls back, does a type of buck and eventually picks up | bucking under load / on hills | engine_misfire_or_bucking_feeling | unambiguous | tekmetric |
| misfire on start up | misfire at startup | engine_misfire_or_bucking_feeling | needs-fact:onset_timing | tekmetric |
| the car jerks while switching gears in the lower gears | jerk on the gear change — dual read (harsh shift OR engine buck/misfire under load) | engine_misfire_or_bucking_feeling | needs-fact:transmission_behavior | tekmetric |
| vehicle feels like it is skipping on accel, revs up then goes | misfire/skip under acceleration | engine_misfire_or_bucking_feeling | unambiguous | tekmetric |
| car runs sputters when idling, when i accelerate it sounds like backfiring in the engine compartment | rough idle + backfire/misfire under accel | engine_misfire_or_bucking_feeling, rough_idle_or_shaking_at_a_stop | needs-fact:onset_timing | forum-paraphrase |
| bucks and jerks way worse when its raining or the roads wet | wet-weather misfire (secondary ignition tracking) | engine_misfire_or_bucking_feeling | needs-fact:weather_condition | synthetic |
| check engine light flashing and the car is bucking when i accelerate | flashing-CEL active misfire under load | engine_misfire_or_bucking_feeling | unambiguous | synthetic |
| engine bucks and jerks when I press the gas like its skipping a beat | bucking misfire under load | engine_misfire_or_bucking_feeling | unambiguous | synthetic |
| feels like its running on 3 cylinders, keeps skipping a beat at speed | dead-cylinder misfire under way | engine_misfire_or_bucking_feeling | unambiguous | synthetic |

### → `low_power_or_wont_accelerate_normally`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| aaa tow in. possible transmission concern. | vague transmission concern, towed | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | tekmetric |
| car is not accelerating, the rpms only go to 3 | severe power loss, RPM ceiling | low_power_or_wont_accelerate_normally | unambiguous | tekmetric |
| clutch is slipping | slip (manual clutch OR auto internal clutch) | low_power_or_wont_accelerate_normally | cross-system:manual-trans-clutch | tekmetric |
| felt like it was in neutral | no drive after selecting gear (delayed/no engagement) | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | tekmetric |
| gets stuck in park will have to go back and forth with shifter to get into gear | won't select gear / stuck in park | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | tekmetric |
| not accelerating well and feels like it is getting stuck | sustained weak acceleration | low_power_or_wont_accelerate_normally | unambiguous | tekmetric |
| revs up and doesn't have power when accelerating, thinks the clutch failed | RPM flare without acceleration, customer blames clutch | low_power_or_wont_accelerate_normally | cross-system:automatic-transmission | tekmetric |
| sounds like a jetski out of water, in reverse or drive seems as if i am stepping on the gas | mixed noise + slip feel + prior battery | low_power_or_wont_accelerate_normally, wont_crank_just_clicks | cross-system:starting-charging | tekmetric |
| the rpms only go to 3 and it wont accelerate | rpm-capped, won't accelerate (limp/failsafe) | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | tekmetric |
| tow in does not shift client states transmission failed | no engagement / failure, not drivable | low_power_or_wont_accelerate_normally | needs-fact:drivable_state | tekmetric |
| vehicle doesnt go over a certain speed / went into limp mode. a lot of dash board lights came on | limp mode speed cap with multiple lights | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | tekmetric |
| vehicle losing power going uphills, client believes it may be high pressure fuel pump | sustained power loss on load, customer suspects HP fuel pump | low_power_or_wont_accelerate_normally | unambiguous | tekmetric |
| vehicle starts but does not shift into gear | no engagement | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | tekmetric |
| went into limp mode and doesnt go over a certain speed | limp mode speed ceiling | low_power_or_wont_accelerate_normally | needs-fact:engine_running | tekmetric |
| when driving up a hill trans slips | transmission slips under load uphill | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | tekmetric |
| when stepping on gas vehicle not accelerating (we just replaced turbo wastegate actuator last service) also hears whistling on accel (did not happen before) | power loss + whistle on acceleration, right after a turbo wastegate-actuator service | low_power_or_wont_accelerate_normally | needs-fact:onset_timing | tekmetric |
| car went into reduced power mode on the highway, could barely keep going, had to pull over | reduced-power event while driving, powertrain NOT stated (ICE cars also have limp/reduced-power) | low_power_or_wont_accelerate_normally | needs-fact:vehicle_powertrain | nhtsa |
| car pops out of gear on its own while im driving | pops/jumps out of gear while moving | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | forum-paraphrase |
| hard shift between second and third | harsh 2-3 upshift | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | forum-paraphrase |
| no power going uphill, feels gutless and bogs down | low power under load, powertrain unstated | low_power_or_wont_accelerate_normally | needs-fact:vehicle_powertrain | forum-paraphrase |
| revs but doesnt go / revs up and don't move | engine revs without moving | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | forum-paraphrase |
| revs up between gears then catches | flare on upshift | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | forum-paraphrase |
| revs up high but the car barely picks up speed | engine revs without road speed gain | low_power_or_wont_accelerate_normally | cross-system:automatic-transmission | forum-paraphrase |
| shifts hard / slams into gear | harsh (bang) shift | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | forum-paraphrase |
| stuck in gear / wont shift out of 3rd | holds one gear | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | forum-paraphrase |
| when i press down steady on the gas it barely accelerates and there is no jerking or bucking | sustained power loss on acceleration, no bucking | low_power_or_wont_accelerate_normally | cross-system:low_power_or_wont_accelerate_normally | forum-paraphrase |
| wont go into gear / car wont move | no engagement | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | forum-paraphrase |
| drives fine going forward but wont move in reverse | reverse-only no-engagement | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | synthetic |
| engine revs high but the car barely picks up speed, especially on hills | rpm outruns road speed (slip) | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | synthetic |
| feels like its slipping when i accelerate | acceleration slip | low_power_or_wont_accelerate_normally | needs-fact:transmission_behavior | synthetic |
| hear a whoosh and hissing when i floor it then it bogs | charge-air/boost leak hiss under load, power loss | low_power_or_wont_accelerate_normally | needs-fact:onset_timing | synthetic |
| reduced engine power light, wont rev past 3k | limp / reduced-power mode, RPM cap | low_power_or_wont_accelerate_normally | unambiguous | synthetic |

### → `hard_to_start_when_hot`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| after getting gas has to crank the vehicle multiple times to get started | hard hot restart after fuel stop | hard_to_start_when_hot | unambiguous | tekmetric |
| after getting gas has to crank vehicle multiple times to get started | hard restart after a short fuel stop (hot) | hard_to_start_when_hot | needs-fact:onset_timing | tekmetric |
| it hesitates to turn back on if i have turned it off while running short errands | hot restart difficulty after short stops | hard_to_start_when_hot | needs-fact:weather_condition | tekmetric |
| it wouldnt start after the final stop, about 20 minutes in the grocery store; it would turn over a couple times before finally dying, i got a jump and it fired right up | hot restart failure after driving + short stop (jump muddies vs drain) | hard_to_start_when_hot | needs-fact:weather_condition | forum-paraphrase |
| trouble starting after getting hot and resting a couple hours, takes longer to turn over | heat-soak hard hot start | hard_to_start_when_hot | unambiguous | forum-paraphrase |
| if i stop for gas after driving the car cranks and cranks but wont catch, i smell gas around the engine, starts fine after it sits | hot-restart no-catch + raw-fuel smell, recovers after cooling | hard_to_start_when_hot | unambiguous | synthetic |
| wont start back up when i stop for gas, cranks and cranks but wont fire | hot restart failure at gas stop (vapor lock) | hard_to_start_when_hot | unambiguous | synthetic |

### → `trouble_fueling_gas_wont_go_in (proposed)`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| CAN NOT FILL WITH GAS, when trying to refuel gas squirts back out | cannot fill tank, fuel spits back at pump | trouble_fueling_gas_wont_go_in _(proposed)_ | cross-system:check_engine_light | tekmetric |
| when filling up gas it comes back out after $14 | pump clicks off early / fuel backs out during fill | trouble_fueling_gas_wont_go_in _(proposed)_ | cross-system:after_recent_service | tekmetric |
| gas pump keeps clicking off when i try to fill up, takes forever to fuel | repeated early pump shutoff during fueling | trouble_fueling_gas_wont_go_in _(proposed)_ | unambiguous | synthetic |

### → `hesitation_or_lag_when_accelerating`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| car hesitates when putting in gear after sitting for awhile | delayed engagement after cold soak | hesitation_or_lag_when_accelerating | needs-fact:transmission_behavior | tekmetric |
| vehicle was hesitating at low speeds around 25mph and the check engine light came on | low-speed hesitation with CEL | hesitation_or_lag_when_accelerating | needs-fact:speed_band | tekmetric |
| when i step on the gas theres like a second delay before the car actually goes, started suddenly | tip-in hesitation, sudden onset | hesitation_or_lag_when_accelerating | unambiguous | tekmetric |
| hesitates when accelerating especially uphill | hesitation under load / uphill | hesitation_or_lag_when_accelerating | unambiguous | forum-paraphrase |
| it hesitates when accelerating, especially uphill, and not all the time | intermittent tip-in hesitation, worse under load/uphill | hesitation_or_lag_when_accelerating | needs-fact:onset_timing | forum-paraphrase |
| takes a few seconds to engage when i shift into drive or reverse | delayed engagement on selection | hesitation_or_lag_when_accelerating | needs-fact:transmission_behavior | forum-paraphrase |
| the engine hesitates when accelerating but not all the time | intermittent acceleration hesitation | hesitation_or_lag_when_accelerating | unambiguous | forum-paraphrase |
| the engine hesitates when i accelerate, not all the time, only when im giving it gas and moving | intermittent hesitation on acceleration | hesitation_or_lag_when_accelerating | needs-fact:onset_timing | forum-paraphrase |
| wont engage until i tap the gas then it drives fine | delayed engagement, engages on throttle | hesitation_or_lag_when_accelerating | needs-fact:transmission_behavior | forum-paraphrase |
| hesitates when i step on it, started after they changed my air filter | tip-in hesitation after air-filter/intake service (MAF cue) | hesitation_or_lag_when_accelerating | needs-fact:recent_action | synthetic |
| little hiccup right when I take off from a stop sign | momentary tip-in stumble off the line | hesitation_or_lag_when_accelerating | unambiguous | synthetic |
| little hiccup right when i take off from a stop, then it catches and drives fine | brief off-the-line stumble | hesitation_or_lag_when_accelerating | unambiguous | synthetic |

### → `stalling_while_driving_under_load`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| car keeps stalling while driving and at idle | stalls both while driving and at idle | stalling_while_driving_under_load, stalling_at_idle_or_when_stopping | needs-fact:speed_band | tekmetric |
| lost power while driving, will attempt to start now but has very rough idle and stalls out | power loss then rough idle + stall (proposed read; judges deadlocked to null) | stalling_while_driving_under_load | needs-fact:engine_running | tekmetric |
| stalled out while turning into the parking lot and would not restart | stalled under low-speed load, no restart | stalling_while_driving_under_load | unambiguous | tekmetric |
| was driving on the highway and the engine just shut off, had to coast to the shoulder | engine died while driving at speed | stalling_while_driving_under_load | unambiguous | synthetic |

### → `stalling_at_idle_or_when_stopping`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| cel coming on and off, vehicle stalls when idling coming to a stop, client pulled rich codes | intermittent CEL + idle stall, rich codes | stalling_at_idle_or_when_stopping | unambiguous | tekmetric |
| engine dies every time I come to a stop at a red light | engine stalls at idle when stopping | stalling_at_idle_or_when_stopping | unambiguous | tekmetric |
| IDLE IS DROPPING VERY LOW AND ALMOST STALLING | low unstable idle nearly stalling | stalling_at_idle_or_when_stopping, rough_idle_or_shaking_at_a_stop | needs-fact:engine_running | tekmetric |
| jerks really hard and turns off when i put it in drive and reverse | harsh engagement + stall on selection | stalling_at_idle_or_when_stopping | cross-system:engine-controls-driveability | forum-paraphrase |
| stalls out right as I pull up to a stop sign but starts right back up | stalls approaching a stop, restarts immediately | stalling_at_idle_or_when_stopping | unambiguous | forum-paraphrase |
| while idling my car will shut off unless I press on the gas | stalls at idle unless throttle held | stalling_at_idle_or_when_stopping | unambiguous | forum-paraphrase |

### → `rough_idle_or_shaking_at_a_stop`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| check engine light on, running rough | MIL with rough running | rough_idle_or_shaking_at_a_stop, check_engine_light | needs-fact:speed_band | tekmetric |
| engine sputters and runs rough at red lights, rpm needle bounces all over, sometimes a rotten egg smell | rough sputtering idle with cat smell | rough_idle_or_shaking_at_a_stop | unambiguous | tekmetric |
| no check engine light, idle is dropping very low and almost stalling | low unstable idle, nearly stalls | rough_idle_or_shaking_at_a_stop | needs-fact:engine_running | tekmetric |
| traction control light came on as well for a short second, struggles at low speeds/idle | brief traction/stability flicker secondary to an engine driveability symptom | rough_idle_or_shaking_at_a_stop, stalling_at_idle_or_when_stopping, engine_misfire_or_bucking_feeling | needs-fact:engine_running | tekmetric |
| car idles rough and shakes but runs down the road fine | rough idle that smooths at speed | rough_idle_or_shaking_at_a_stop | unambiguous | forum-paraphrase |
| car idles rough, shakes, seems to run fine down the road, sometimes shuts off at a stop | rough idle with occasional stall | rough_idle_or_shaking_at_a_stop | cross-system:stalling_at_idle_or_when_stopping | forum-paraphrase |
| it stalls, runs rough and hesitates on acceleration, sometimes a rotten egg smell | stall + rough idle + hesitation (lean / unmetered-air pattern), sulfur smell | rough_idle_or_shaking_at_a_stop, hesitation_or_lag_when_accelerating | needs-fact:onset_timing | forum-paraphrase |
| engine sputters and runs rough when im stopped at red lights, rpm bounces, check engine light on, sometimes a rotten egg smell | rough idle + bouncing rpm + CEL + intermittent sulfur | rough_idle_or_shaking_at_a_stop | unambiguous | synthetic |
| idles real choppy and the steering wheel trembles when im stopped, smooths out when i drive | rough idle felt through wheel, clears when moving | rough_idle_or_shaking_at_a_stop | unambiguous | synthetic |
| theres a hissing whistle at idle and it idles rough | intake/vacuum leak whistle at idle, rough idle, lean | rough_idle_or_shaking_at_a_stop | needs-fact:onset_timing | synthetic |

### → `manual_clutch_slipping (proposed)`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| CLIENT STATES CLUTCH IS SLIPPING | clutch slipping, driver-reported | manual_clutch_slipping _(proposed)_ | unambiguous | tekmetric |
| customer states the clutch has failed. revs up and doesn't have power when accelerating | clutch slip - engine revs without speed gain under acceleration | manual_clutch_slipping _(proposed)_ | unambiguous | tekmetric |
| clutch slips going up hills and i smell somthing burning | clutch slip under load with vague burning smell (other_burning, not brake/rubber) | manual_clutch_slipping _(proposed)_ | cross-system:other_burning | synthetic |
| revs but no go, feels like the clutch isnt grabbing | clutch slip - no torque transfer | manual_clutch_slipping _(proposed)_ | unambiguous | synthetic |

### → `hard_to_start_when_cold`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| weak/extended crank | long/weak crank before start | hard_to_start_when_cold, hard_to_start_when_hot | needs-fact:weather_condition | tekmetric |
| after driving a short distance then leaving it a few hours it refuses to start, long crank then no start, or a weak sputtering start then it dies | hard-start after a sit, crank-but-wont-fire; hot-soak vs cold unstated | hard_to_start_when_cold, hard_to_start_when_hot | needs-fact:weather_condition | forum-paraphrase |
| when it gets cold the engine will crank but not start | cold, cranks but wont fire | hard_to_start_when_cold | unambiguous | forum-paraphrase |
| when it gets pretty cold out i have to wait 30-60 seconds until i hear a rapid clicking, then it starts; if i dont wait it just cranks but wont start, my battery is good and the alternator is charging | cold, cranks-but-wont-fire (customer already cleared battery + alternator) | hard_to_start_when_cold | unambiguous | forum-paraphrase |
| cranks forever in the morning before it finally fires up, but starts fine once its warmed up | long cold crank, normal once warm | hard_to_start_when_cold | unambiguous | synthetic |
| cranks forever in the morning before it fires, then fine once warmed up | hard cold start, cranks-but-slow-to-fire | hard_to_start_when_cold | unambiguous | synthetic |
| hard to start when cold | cold hard-start, crank quality unstated | hard_to_start_when_cold, slow_crank_sluggish_start | needs-fact:engine_running | synthetic |
| my truck cranks for like 5-6 seconds first thing in the morning before it fires up, starts fine rest of the day | extended cold-only crank time | hard_to_start_when_cold | unambiguous | synthetic |

### → `surging_or_rpms_going_up_and_down`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| when in park something seems to rev up | engine revs on its own in park | surging_or_rpms_going_up_and_down | needs-fact:engine_running | tekmetric |
| runs too high of an idle and idle searching | high hunting idle | surging_or_rpms_going_up_and_down | unambiguous | forum-paraphrase |
| RPMs go up and down on their own when I'm sitting at a red light | idle RPM oscillates without throttle input | surging_or_rpms_going_up_and_down | unambiguous | synthetic |
| the rpms go up and down on their own at idle without me touching the gas | smooth idle surge (not misfire) | surging_or_rpms_going_up_and_down | cross-system:surging_or_rpms_going_up_and_down | synthetic |

### → `hybrid_or_ev_reduced_power_or_limp_mode (proposed)`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| driving my electric car and it suddenly lost power, a turtle light came on and it wont go over like 40 | STATED EV reduced-power / turtle derate | hybrid_or_ev_reduced_power_or_limp_mode _(proposed)_ | unambiguous | nhtsa |
| my ev is crawling, dashboard shows a turtle icon, feels like theres no power at all | STATED EV turtle, severe power limit | hybrid_or_ev_reduced_power_or_limp_mode _(proposed)_ | unambiguous | forum-paraphrase |
| hybrid has no power going up hills all of a sudden and theres a warning light | STATED hybrid low-power + warning | hybrid_or_ev_reduced_power_or_limp_mode _(proposed)_ | unambiguous | synthetic |

### → `grinding_or_hard_shift_gears (proposed)`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| grinds every time i put it in first | grind into gear - clutch drag or synchro | grinding_or_hard_shift_gears _(proposed)_ | needs-fact:clutch_or_gear_engagement | forum-paraphrase |
| grinds going into 2nd on quick shifts | single-gear synchro grind on fast shift | grinding_or_hard_shift_gears _(proposed)_ | needs-fact:clutch_or_gear_engagement | forum-paraphrase |
| hard to get it into gear when its cold, have to force it | hard/notchy cold shift - synchro | grinding_or_hard_shift_gears _(proposed)_ | needs-fact:weather_condition | forum-paraphrase |
| pops out of 3rd gear on the highway | jumps out of gear under load | grinding_or_hard_shift_gears _(proposed)_ | unambiguous | forum-paraphrase |
| wont go into gear with the engine running but its fine when its off | clutch not disengaging (drag), engine-on only | grinding_or_hard_shift_gears _(proposed)_ | unambiguous | forum-paraphrase |
| shifter feels really sloppy and notchy, hard to find gears | external shift-linkage/bushing slop - vague/notchy shifter | grinding_or_hard_shift_gears _(proposed)_ | needs-fact:clutch_or_gear_engagement | synthetic |

### → `awd_4x4_testing`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| manual transmission started slipping in 4-high and first gear, fine in 4-low and 2-high | RANGE-DEPENDENT slip (only in one 4WD range) - transfer-case/4WD signature, NOT a clutch | awd_4x4_testing | cross-system:awd_4x4_testing | forum-paraphrase |

### → `clutch_pedal_or_engagement_feel (proposed)`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| car judders and shakes as the clutch catches when i take off | clutch judder at engagement point | clutch_pedal_or_engagement_feel _(proposed)_ | needs-fact:onset_timing | synthetic |
| chirping when i push the clutch pedal down | release/throwout-bearing chirp APPEARS as the pedal is pressed to the engagement point (bearing contacts pressure-plate fingers); quiet with pedal up | clutch_pedal_or_engagement_feel _(proposed)_ | needs-fact:clutch_pedal_feel | synthetic |
| clutch pedal has no pressure, feels soft and drops to the floor | clutch actuation loss - no pedal pressure | clutch_pedal_or_engagement_feel _(proposed)_ | needs-fact:clutch_pedal_feel | synthetic |
| clutch pedal went to the floor and stays there, cant get in gear | clutch hydraulic/cable failure - pedal to floor, no engagement | clutch_pedal_or_engagement_feel _(proposed)_ | unambiguous | synthetic |
| rattles and raps at idle, sounds like a diesel, quiets when i push the clutch in | DMF idle rattle/rap, clutch-pedal-linked; not an engine knock | clutch_pedal_or_engagement_feel _(proposed)_ | needs-fact:noise_descriptor | synthetic |
| shudders when i let the clutch out pulling away from a stop | clutch chatter on engagement from standstill | clutch_pedal_or_engagement_feel _(proposed)_ | needs-fact:onset_timing | synthetic |
| squealing that goes away when i push the clutch pedal in | input-shaft-bearing noise - present in neutral with the pedal UP, STOPS when the clutch is pressed (disengaged). NOT the release/throwout bearing (that appears ON depression) and NOT a belt. | clutch_pedal_or_engagement_feel _(proposed)_ | cross-system:high_pitched_whining_under_the_hood | synthetic |
| whirring only when i hold the clutch down in gear | pilot-bearing whirr, pedal-fully-pressed-in-gear only | clutch_pedal_or_engagement_feel _(proposed)_ | cross-system:humming_or_whirring_at_speed | synthetic |

---

## Pulling / drifting — `pulling`

### → `wandering_or_drifting_in_both_directions`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| PLAY IN STEERING WHEEL AND CLUNKING IN SUSPENSION | steering play plus suspension clunk | wandering_or_drifting_in_both_directions, loose_or_sloppy_steering | cross-system:loose_or_sloppy_steering | tekmetric |
| it began to wander badly, especially at highway speeds, and now Im uncomfortable driving it | two-way wander worse at highway speed, feels unsafe | wandering_or_drifting_in_both_directions | needs-fact:drivable_state | forum-paraphrase |
| the car began to wander badly especially at highway speeds | bi-directional wander at speed (not a single-direction pull) | wandering_or_drifting_in_both_directions | needs-fact:pull_direction | forum-paraphrase |

### → `pull_that_started_after_recent_tire_or_service_work`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| RE CHECK ALIGNMENT (if you hold the steering wheel straight the car will go to the right). Just had alignment performed last service. | right pull that showed up right after a recent alignment | pull_that_started_after_recent_tire_or_service_work | needs-fact:recent_action | tekmetric |
| got new tires and an alignment, it still pulls to the left afterwards | pull whose onset is tied to recent tire/alignment work | pull_that_started_after_recent_tire_or_service_work | needs-fact:recent_action | forum-paraphrase |

### → `steady_drift_while_cruising`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| the car is pulling, I've taken it to the dealership over 6 times, and when I'm driving the car is shaking | steady pull with a shake, unresolved after multiple visits | steady_drift_while_cruising | needs-fact:pull_road_dependence | nhtsa |
| my Accord pulls ever so slightly to the right and slowly drifts right going down the highway | mild steady right pull/drift on the highway | steady_drift_while_cruising | needs-fact:pull_road_dependence | forum-paraphrase |

### → `drift_that_follows_the_roads_slope`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| it only seems to pull on some roads and drives fine on others | pull that appears only on certain roads | drift_that_follows_the_roads_slope | needs-fact:pull_road_dependence | forum-paraphrase |
| on a calm straight road you can take your hands off and it tracks fine, but it drifts on the highway | drift shows up on the road, not on a calm straight stretch | drift_that_follows_the_roads_slope | needs-fact:pull_road_dependence | forum-paraphrase |

### → `pulling_only_when_braking`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| pulls to the left when i brake too hard, drives straight the rest of the time | pull only under braking | pulling_only_when_braking | cross-system:pulling_drifting_or_wandering_on_the_road | forum-paraphrase |
| pulls to the left when I have to suddenly brake, a shop said a caliper locked on the front right | brake pull, suspected stuck caliper | pulling_only_when_braking | unambiguous | forum-paraphrase |
| car pulls hard to the left every time i hit the brakes, drives straight otherwise | directional pull only under braking | pulling_only_when_braking | unambiguous | synthetic |

---

## Smells — `smell`

### → `exhaust_fumes_inside_the_cabin`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| CUSTOMER STATES THERE IS AN EXHAUST SMELL COMING THROUGH THE HEATER AFTER IT IS WARMED UP AND AT IDLE. HEAT NEEDS TO BE ON. | exhaust smell in cabin, worse warm + heat on + idle | exhaust_fumes_inside_the_cabin | unambiguous | tekmetric |
| i smell exhaust fumes inside the car when im driving, smoky burnt smell | exhaust/tailpipe smell in cabin (NOT raw gas) | exhaust_fumes_inside_the_cabin | cross-system:exhaust_fumes_inside_the_cabin | synthetic |

### → `burnt_oil_smell`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| greasy burning oil smell from under the hood after long drives. no drips on the ground that ive seen | burnt-oil smell under hood, no visible puddle | burnt_oil_smell | unambiguous | tekmetric |
| smells like hot oil under the hood, kind of greasy and burnt when i idle for a while | hot-oil smell at idle | burnt_oil_smell | unambiguous | tekmetric |
| burning oil smell every time i get out of the car, like somethings cooking on the engine | burnt-oil odor at rest after driving | burnt_oil_smell | unambiguous | forum-paraphrase |
| hot oily smell under the hood after ive been on the highway a while, aint seen smoke though | burnt-oil odor under hood, no visible smoke | burnt_oil_smell | unambiguous | forum-paraphrase |
| smell burnt oil when i stop at lights, worse in the summer | burnt-oil odor at stops, heat-related | burnt_oil_smell | unambiguous | forum-paraphrase |
| burning smell from under the hood, kinda greasy | greasy burning odor under hood | burnt_oil_smell | needs-fact:smell_descriptor | synthetic |

### → `rotten_egg_sulfur_smell`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| getting a rotten egg smell from the catalytic converter | rotten-egg/sulfur smell attributed to the cat | rotten_egg_sulfur_smell | unambiguous | forum-paraphrase |
| my car smells like rotten eggs from the exhaust | rotten-egg sulfur smell from exhaust | rotten_egg_sulfur_smell | unambiguous | forum-paraphrase |
| my car smells like rotten eggs from the exhaust, worse under acceleration | sulfur/H2S smell (cat), NOT raw gasoline | rotten_egg_sulfur_smell | cross-system:rotten_egg_sulfur_smell | synthetic |
| strong sulfur smell when i drive, especially under acceleration | sulfur smell under load | rotten_egg_sulfur_smell | unambiguous | synthetic |

### → `musty_mildew_smell_from_vents`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| musty smell from the back seat carpet, especially when it rains | mildew from carpet, not vents | musty_mildew_smell_from_vents | cross-system:bad_smell_from_vents | forum-paraphrase |
| moldy smell from the trunk after I had water back there | mildew from wet trunk, not vents | musty_mildew_smell_from_vents | unambiguous | synthetic |

### → `burning_rubber_hot_brake_smell`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| burning rubber smell coming from one of the wheels after i braked a lot downhill | hot-brake/rubber smell at a wheel | burning_rubber_hot_brake_smell | cross-system:brake_inspection | synthetic |
| burning rubber smell from one of my wheels after I drove down a hill | hot-brake smell from a wheel, no visible smoke | burning_rubber_hot_brake_smell | needs-fact:sound_or_smoke_location_zone | synthetic |

### → `gasoline_fuel_smell`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| gas fumes when i start the car cold in the morning | raw-fuel fumes on cold start | gasoline_fuel_smell | needs-fact:onset_timing | synthetic |
| i smell gas inside my car when im driving | raw gasoline odor in cabin while driving | gasoline_fuel_smell | unambiguous | synthetic |
| i smell raw gas inside the car when the heater is running and it makes me lightheaded | fuel odor with HVAC on, lightheadedness (confusable w/ exhaust-in-cabin) | gasoline_fuel_smell | cross-system:exhaust_fumes_inside_the_cabin | synthetic |
| whole garage smells like gasoline when i park | strong raw-fuel odor around parked car | gasoline_fuel_smell | unambiguous | synthetic |

### → `sweet_smell_maple_syrup_antifreeze`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| somethin smells like maple syrup around my car after i drive it, cant find any leak | sweet coolant odor, no visible leak | sweet_smell_maple_syrup_antifreeze | unambiguous | synthetic |
| sweet pancake-syrup smell when I park, temp gauge been running a little hot too | sweet smell with mildly high temp | sweet_smell_maple_syrup_antifreeze | unambiguous | synthetic |

---

## Smoke — `smoke`

### → `blue_or_gray_smoke_from_tailpipe`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| blue-gray smoke when I first start it in the morning, smells like burning oil | oil-burn startup smoke | blue_or_gray_smoke_from_tailpipe | cross-system:white_smoke_from_tailpipe | tekmetric |
| Blueish gray smoke puffs out the tailpipe when I take off from a light, and it smells like burning oil | blue-gray smoke under acceleration, burnt-oil smell | blue_or_gray_smoke_from_tailpipe | unambiguous | tekmetric |
| cloud of blue-gray smoke every time i floor it, car has a turbo | blue smoke under boost on a turbo | blue_or_gray_smoke_from_tailpipe | unambiguous | tekmetric |
| puff of blue smoke out the tailpipe when i first start it in the morning, smells like burning oil, been adding a quart every few weeks | startup blue smoke, burnt-oil smell, oil consumption | blue_or_gray_smoke_from_tailpipe | cross-system:check_engine_light_testing | tekmetric |
| puff of blue smoke out the tailpipe when i first start it in the morning, smells like burning oil. been adding a quart every few weeks too | cold-start blue smoke with oil consumption | blue_or_gray_smoke_from_tailpipe | unambiguous | tekmetric |
| blue smoke out the back and burning oil smell, its a turbo car | turbo seal oil burn, blue tailpipe smoke | blue_or_gray_smoke_from_tailpipe | cross-system:exhaust-emissions | synthetic |
| puff of blue smoke when i first start it in the morning, smells like burning oil | oil-burn blue smoke (NOT rich black) | blue_or_gray_smoke_from_tailpipe | cross-system:blue_or_gray_smoke_from_tailpipe | synthetic |

### → `smoke_from_under_the_hood`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| burns a lot of oil and has to fill up the oil about every few months | high oil consumption, no stated smoke location | smoke_from_under_the_hood, blue_or_gray_smoke_from_tailpipe | needs-fact:sound_or_smoke_location_zone | tekmetric |
| Started driving 20 mins vehicle started smoking, was just at another shop for overheat | smoke under hood after prior overheat repair | smoke_from_under_the_hood | cross-system:after_recent_service_or_repair_work | tekmetric |
| smoke coming out from underneath the hood, a message came up that the coolant was overheating | steam/smoke from under hood with a coolant-overheat message | smoke_from_under_the_hood | unambiguous | nhtsa |
| hissing sound and smoke/steam coming from under my hood, radiator full, not overheating | coolant hiss/steam from a spray leak on hot parts | smoke_from_under_the_hood | needs-fact:smell_descriptor | forum-paraphrase |
| oil pooling right under the exhaust manifold at the back of the engine, wisps of smoke at idle | oil leak onto manifold, light under-hood smoke | smoke_from_under_the_hood, burnt_oil_smell | unambiguous | forum-paraphrase |

### → `white_smoke_from_tailpipe`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| thick white smoke from the exhaust even after driving twenty minutes and it smells sweet | persistent sweet white smoke | white_smoke_from_tailpipe | unambiguous | tekmetric |
| thick white smoke pouring from the tailpipe, smells sweet | white tailpipe smoke, sweet (coolant) | white_smoke_from_tailpipe | cross-system:coolant_leak_testing | tekmetric |
| blowing white smoke and ive had to add coolant twice this week, temp gauge running high | white smoke with coolant loss and overheating | white_smoke_from_tailpipe | unambiguous | forum-paraphrase |
| thick white smoke from the tailpipe and it smells sweet like syrup | coolant-in-combustion white smoke (NOT rich black) | white_smoke_from_tailpipe | cross-system:white_smoke_from_tailpipe | synthetic |
| thick white smoke pouring out of my tailpipe even after driving 20 min, smells kinda sweet, been topping off coolant | persistent white sweet exhaust smoke with coolant loss | white_smoke_from_tailpipe | unambiguous | synthetic |
| white cloud out the back and the temperature gauge is running high | white exhaust smoke plus high temp | white_smoke_from_tailpipe | unambiguous | synthetic |

### → `black_smoke_from_tailpipe`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| black smoke pours out when i stomp on the gas and it smells like raw gas | black smoke under acceleration + raw-fuel smell (rich) | black_smoke_from_tailpipe | unambiguous | synthetic |
| diesel is blowing thick black smoke even at idle | persistent diesel black smoke at idle (fault, not turbo puff) | black_smoke_from_tailpipe | needs-fact:vehicle_powertrain | synthetic |
| fuel mileage tanked and theres black smoke from the back | dropping mileage + black smoke (rich) | black_smoke_from_tailpipe | unambiguous | synthetic |
| my truck started blowing black smoke, not sure whats going on | black tailpipe smoke, vague | black_smoke_from_tailpipe | needs-fact:onset_timing | synthetic |

### → `smoke_or_burning_smell_from_a_wheel`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| smoke coming off my rear right wheel, I think I left the parking brake on | smoke from a wheel, dragging parking brake | smoke_or_burning_smell_from_a_wheel | unambiguous | synthetic |

---

## Steering — `steering`

### → `noise_when_turning_the_steering_wheel`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| HEARS A LOUD SQUEAL WHEN TURNING | squeal on steering input, not braking | noise_when_turning_the_steering_wheel | cross-system:noise_when_turning_the_steering_wheel | tekmetric |
| creak from the steering column every time i turn the wheel while parked | creak on turn at standstill (dry bearing / u-joint) | noise_when_turning_the_steering_wheel | unambiguous | forum-paraphrase |
| steering wheel groans when i turn it in the parking lot | groan on low-speed turn | noise_when_turning_the_steering_wheel | unambiguous | forum-paraphrase |
| theres a whining noise whenever i turn the steering wheel, goes away when the wheel is straight | whine on turn, absent when straight | noise_when_turning_the_steering_wheel | cross-system:high_pitched_whining_under_the_hood | synthetic |

### → `hard_to_turn_heavy_steering`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| STEERING WHEEL FEELS TIGHT | steering effort high / heavy wheel | hard_to_turn_heavy_steering | needs-fact:warning_light_named | tekmetric |
| have to use both hands to turn the wheel, its gotten really stiff | heavy steering effort | hard_to_turn_heavy_steering | unambiguous | forum-paraphrase |
| power steering feels like it quit, wheel takes way more effort now | loss of power assist, heavy steering | hard_to_turn_heavy_steering | needs-fact:warning_light_named | forum-paraphrase |
| steering went stiff overnight, hard to crank in parking lots but fine on the highway | sudden heavy steering, low-speed dominant | hard_to_turn_heavy_steering | unambiguous | synthetic |

### → `clunking_knocking_or_rough_ride_over_bumps`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| clunking noise, very noticeable when going over a speed bump and turning the steering | clunk over speed bumps, felt/heard while steering | clunking_knocking_or_rough_ride_over_bumps | cross-system:clunking_over_bumps | nhtsa |
| clunk/thump/pop from the front passenger side over a rough patched road with the wheels straight ahead | front-right clunk/thump over rough road surfaces, wheels straight | clunking_knocking_or_rough_ride_over_bumps | cross-system:clunking_over_bumps | forum-paraphrase |
| there is a loud clunking sound when driving over street bumps or ditches | loud clunk over street bumps and ditches | clunking_knocking_or_rough_ride_over_bumps | cross-system:clunking_over_bumps | forum-paraphrase |

### → `steering_wheel_off_center_when_driving_straight`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| just had an alignment and now the steering wheel isnt centered | off-center after alignment | steering_wheel_off_center_when_driving_straight | unambiguous | forum-paraphrase |
| steering wheel is crooked when im driving straight, drives me crazy | wheel off-center, car tracks straight | steering_wheel_off_center_when_driving_straight | unambiguous | forum-paraphrase |

### → `loose_or_sloppy_steering`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| lots of play in the wheel, like theres a dead zone in the middle | excessive free play | loose_or_sloppy_steering | unambiguous | forum-paraphrase |
| steering wheel feels super loose, i can wiggle it before the car actually turns | play/deadband at center | loose_or_sloppy_steering | unambiguous | forum-paraphrase |
| the car kind of lags behind the steering wheel, i turn and it turns a second later | vague/disconnected steering | loose_or_sloppy_steering | unambiguous | forum-paraphrase |

### → `pulling_drifting_or_wandering_on_the_road`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| steering feels off, car wanders and im fighting the wheel | vague steering + wander, no direction stated | pulling_drifting_or_wandering_on_the_road | needs-fact:pull_direction | forum-paraphrase |

---

## Tires / TPMS / wheels — `tires`

### → `just_want_new_tires`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| 4 NEW TIRES AND ALIGNMENT (would like entry level tire) | buying 4 tires + alignment, budget tier | just_want_new_tires | unambiguous | tekmetric |
| TIRE REPLACEMENT | tire-replacement request (work-order voice) | just_want_new_tires | unambiguous | tekmetric |
| my tires are shot, need new rubber before winter | worn-out tires, replacement intent | just_want_new_tires | unambiguous | synthetic |

### → `uneven_tire_wear_bald_spots`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| Alignment, tires have been having uneven wear | alignment request due to uneven tire wear | uneven_tire_wear_bald_spots | unambiguous | tekmetric |
| rear tires were worn on edges | edge wear, rear tires | uneven_tire_wear_bald_spots | unambiguous | tekmetric |
| uneven wear on inside edge of front tires | inside-edge front tire wear (alignment cue) | uneven_tire_wear_bald_spots | unambiguous | tekmetric |
| uneven wear on inside edge of front tires, alignment okay if needed | inner-edge front tire wear, wants alignment if needed | uneven_tire_wear_bald_spots | unambiguous | tekmetric |
| WHEEL ALIGNMENT CHECK, rear tires were worn on edges | alignment check prompted by edge-worn rear tires | uneven_tire_wear_bald_spots | unambiguous | tekmetric |
| shop told me my tires are cupping | scalloped/cupped wear (strut/balance cue) | uneven_tire_wear_bald_spots | unambiguous | synthetic |

### → `recent_tire_work_then_new_symptom`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| CLIENT REPORTED REAR END SWAYING AFTER TIRE REPLACEMENT | new symptom (sway) after tire replacement | recent_tire_work_then_new_symptom | needs-fact:speed_band | tekmetric |
| got new tires last week and now it vibrates at highway speed | post-tire-work highway vibration | recent_tire_work_then_new_symptom | unambiguous | forum-paraphrase |

### → `tire_going_flat_losing_air`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| front left tire needs looses air pressure, have to add air about every 1000 miles | front-left tire slow leak, repeated topping up | tire_going_flat_losing_air | unambiguous | tekmetric |
| LEFT REAR TIRE LOOSING AIR PSI | left-rear tire losing air pressure | tire_going_flat_losing_air | unambiguous | tekmetric |
| Lf tire slow leak | left-front tire slow air leak | tire_going_flat_losing_air | unambiguous | tekmetric |
| tire was soft this morning, fine yesterday, heard a hiss pulling in | sudden slow leak with hiss | tire_going_flat_losing_air | unambiguous | forum-paraphrase |
| my tire keeps going flat | tire repeatedly loses air, no cause named | tire_going_flat_losing_air | needs-fact:tire_state | synthetic |

### → `visible_damage_nail_screw_bulge_cut`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| bubble on the sidewall after I smacked a curb | impact sidewall bulge (non-repairable) | visible_damage_nail_screw_bulge_cut | unambiguous | forum-paraphrase |
| big gash in my tire, looks like I ran over something sharp | sidewall/tread cut | visible_damage_nail_screw_bulge_cut | unambiguous | synthetic |
| found a screw sticking out of my rear left tire, its still holding air and drives fine | screw in rear-left tread, tire holding air | visible_damage_nail_screw_bulge_cut | unambiguous | synthetic |
| there's a nail in my tire | nail embedded in tread | visible_damage_nail_screw_bulge_cut | unambiguous | synthetic |

### → `dry_rot_sidewall_cracking`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| car's been sitting a couple years and now the rubber is all cracked | storage-aged dry rot | dry_rot_sidewall_cracking | cross-system:car_has_been_sitting_unused_for_a_long_time | forum-paraphrase |
| sidewalls are all cracked, tires are old and dry-rotted | age/UV sidewall crazing on all tires | dry_rot_sidewall_cracking | unambiguous | synthetic |

### → `low_pressure_warning_light_only`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| put air in all 4 tires yesterday but the light still won't go off, tires look fine to me | low-pressure light won't clear after inflating (relearn/fault) | low_pressure_warning_light_only | unambiguous | synthetic |
| tire pressure light keeps coming back on even tho I put air in all four | recurring low-pressure light after top-up | low_pressure_warning_light_only, tpms_tire_pressure_light | needs-fact:warning_light_behavior | synthetic |

---

## Vibration — `vibration`

### → `shaking_when_speeding_up_or_going_uphill`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| car shudders pretty bad whenever i give it gas going uphill, smooths right out as soon as i let off | load-dependent shudder that clears off-throttle | shaking_when_speeding_up_or_going_uphill | needs-fact:transmission_behavior | tekmetric |
| shuttering transmission issue | transmission shudder | shaking_when_speeding_up_or_going_uphill | needs-fact:transmission_behavior | tekmetric |
| judder when i take off from a stop | CVT/DCT low-speed takeoff judder | shaking_when_speeding_up_or_going_uphill | cross-system:driveline-cv-diff-awd | forum-paraphrase |
| shudders around 40 like driving over rumble strips | TCC lockup shudder at cruise | shaking_when_speeding_up_or_going_uphill | needs-fact:speed_band | forum-paraphrase |
| car shudders when the transmission is working hard on hills | shudder under transmission load | shaking_when_speeding_up_or_going_uphill | unambiguous | synthetic |
| whole car shudders when i punch it from a stop, smooths out once rolling | tripod CV shudder on hard acceleration | shaking_when_speeding_up_or_going_uphill | cross-system:transmission_testing | synthetic |

### → `steering_wheel_shake_at_highway_speed`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| CHECK BRAKES (Steering wheel shakes at highway speeds) | highway shimmy that the customer guessed was brakes | steering_wheel_shake_at_highway_speed | cross-system:vibration_or_pulsing_when_braking | tekmetric |
| SHIMMY AT HIGHWAY SPEEDS | steering-wheel shimmy at highway speed | steering_wheel_shake_at_highway_speed | unambiguous | tekmetric |
| WHEEL SHAKES AT HIGHWAY SPEEDS | steering-wheel shake at highway speed | steering_wheel_shake_at_highway_speed | unambiguous | tekmetric |
| steering wheel shakes really bad at 65 but not when braking | speed-triggered steering shake, no brake | steering_wheel_shake_at_highway_speed | cross-system:steering_wheel_shake_at_highway_speed | forum-paraphrase |
| steering wheel shakes really bad at 65, smooths out if I slow down, started after a pothole | band-limited highway shimmy after impact (bent wheel) | steering_wheel_shake_at_highway_speed | unambiguous | synthetic |

### → `vibration_or_pulsing_when_braking`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| client is reporting shaking when applying brakes | whole-car shake, brake-triggered | vibration_or_pulsing_when_braking | unambiguous | tekmetric |
| violently shakes and shudders when I apply the brakes, regardless of how fast | severe brake shudder, all speeds | vibration_or_pulsing_when_braking | unambiguous | forum-paraphrase |
| when I hit the brake at or over 65 mph the steering wheel starts to vibrate | steering shake, brake-triggered at highway speed | vibration_or_pulsing_when_braking | unambiguous | forum-paraphrase |

### → `constant_vibration_that_doesnt_change_with_speed`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| VEHICLE SHAKING AT ALL SPEEDS ( like a 2000lbs vibrator ) | constant vibration at every speed | constant_vibration_that_doesnt_change_with_speed | unambiguous | tekmetric |
| buzz through the seat at every speed, even crawling through a parking lot, never changes | speed-independent tremor (out-of-round/broken belt) | constant_vibration_that_doesnt_change_with_speed | unambiguous | forum-paraphrase |

### → `shaking_or_bouncing_over_bumps_and_rough_roads`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| WHEN HITTING A BUMP AT HIGHWAY SPEEDS, CLIENT GETS A VIOLENT SHAKE, thinks it may be the track bar | violent shake when hitting a bump at highway speed | shaking_or_bouncing_over_bumps_and_rough_roads | needs-fact:ride_damping_symptom | tekmetric |
| the day after the shop work we noticed how bouncy the car was and how bad every little bump felt | newly bouncy ride, every small bump exaggerated | shaking_or_bouncing_over_bumps_and_rough_roads | needs-fact:ride_damping_symptom | forum-paraphrase |
| the ride was more bouncy and floaty than before, I feel every bump and road crack now | ride became bouncy/floaty, feels every bump | shaking_or_bouncing_over_bumps_and_rough_roads | needs-fact:ride_damping_symptom | forum-paraphrase |

### → `shaking_at_idle_while_stopped`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| whole car shakes at a stop light but the engine sounds smooth, i think its a motor mount | whole-car idle shake, engine normal (mounts) | shaking_at_idle_while_stopped | cross-system:shaking_at_idle_while_stopped | synthetic |

---

## Warning lights — `warning_light`

### → `multiple_warning_lights_at_once`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| ABS & TRAC LIGHTS COMING ON, client also reported TPMS and airbag | many different chassis telltales together | multiple_warning_lights_at_once | cross-system:multiple_warning_lights_at_once | tekmetric |
| four lights came on that look like steering and electrical issues, steering indicator is one | EPS among multiple simultaneous lights (low-voltage cascade) | multiple_warning_lights_at_once | cross-system:power_steering_eps_light | tekmetric |
| vehicle doesnt go over a certain speed / went into limp mode a lot of dash lights came on but are now off | limp mode, speed cap, multiple lights came on then off | multiple_warning_lights_at_once, low_power_or_wont_accelerate_normally | needs-fact:warning_light_behavior | tekmetric |
| car wont start and a bunch of dash lights are flickering, the ABS, traction, airbag and security lights, plus my power locks and windows are dead too | airbag inside an electrical/voltage cascade (no-start) | multiple_warning_lights_at_once | cross-system:multiple_warning_lights_at_once | forum-paraphrase |
| intermittent dash lights, ABS, traction control, airbag and security also, no power locks or windows | ABS+traction+airbag+security cluster with electrical dropout (bus/low-voltage event) | multiple_warning_lights_at_once | cross-system:multiple_warning_lights_at_once | forum-paraphrase |

### → `abs_anti_lock_brake_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| abs / trac / no AWD message | ABS + traction telltales with an AWD-disabled message | abs_anti_lock_brake_light, traction_control_stability_light | needs-fact:warning_light_named | tekmetric |
| ABS LIGHT ON TESTING. STEERING FEELS MORE DIFFICULT AUTH 179 | ABS telltale on plus heavy steering | abs_anti_lock_brake_light | needs-fact:warning_light_named | tekmetric |
| yellow ABS light came on right after I hit a big pothole, brakes still feel normal | ABS light after pothole, brakes normal | abs_anti_lock_brake_light | cross-system:abs_anti_lock_brake_light | tekmetric |
| my abs light comes on for a second when i start the car then goes right back off, is that bad? | ABS telltale key-on self-test (lamp check), extinguishes after start | abs_anti_lock_brake_light | needs-fact:warning_light_behavior | synthetic |
| yellow ABS light came on after I hit a pothole, brakes still stop fine | ABS light only, brakes normal | abs_anti_lock_brake_light | cross-system:abs_anti_lock_brake_light | synthetic |

### → `oil_pressure_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| AFTER VEHICLE IS WARMED UP AND SITTING AT IDLE low engine oil pressure light comes on | oil-pressure light on when warm at idle | oil_pressure_light | unambiguous | tekmetric |
| oil light came on when driving to shop check oil level prior to doing oil change | oil-pressure light on while driving, wants level checked | oil_pressure_light | unambiguous | tekmetric |
| oil light comes on at idle and goes out when i speed up, only after its warm | oil-pressure light flickers at warm idle, clears with RPM | oil_pressure_light | unambiguous | forum-paraphrase |
| oil pressure light flickers when the rpms drop at a stoplight | intermittent oil-pressure light at low RPM | oil_pressure_light | unambiguous | forum-paraphrase |

### → `airbag_srs_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| air bag code pass seat sensor | airbag code, passenger occupancy (seat) sensor | airbag_srs_light | cross-system:multiple_warning_lights_at_once | tekmetric |
| AIR BAG LIGHT ON | airbag/SRS telltale on | airbag_srs_light | unambiguous | tekmetric |
| airbag light always on in my dashboard | SRS telltale steady on | airbag_srs_light | unambiguous | nhtsa |
| SRS light went on and stayed on, the dealer said the SRS computer malfunctioned and needs replacing | SRS telltale steady on, module fault | airbag_srs_light | unambiguous | nhtsa |
| airbag light and my horn quit working at the same time | SRS light with dead horn (clockspring signature) | airbag_srs_light | unambiguous | synthetic |
| airbag light came on after i drove through a flooded street last night | SRS light after flood / water intrusion | airbag_srs_light | unambiguous | synthetic |
| airbag light is on, is it safe to drive with it like this?? | SRS light + passing safety question | airbag_srs_light | cross-system:safety_concern_dont_feel_safe_driving_it | synthetic |
| Airbag light popped on a few days ago right after a lil fender bender, no airbags went off, stays on steady the whole time i drive | SRS steady after minor impact, no deployment | airbag_srs_light | cross-system:after_a_recent_accident_or_impact | synthetic |
| my SRS light is flashing some weird pattern of blinks ever since the battery died and i had to jump start the car | SRS blink-pattern after battery/jump, isolated | airbag_srs_light | unambiguous | synthetic |
| red person-with-seatbelt-and-a-ball icon lit up on the dash | SRS person+airbag icon description | airbag_srs_light | unambiguous | synthetic |
| srs light on and the cruise control and volume buttons on the wheel stopped working | SRS light with dead steering-wheel controls (clockspring) | airbag_srs_light | unambiguous | synthetic |
| started after i pulled the seats out to shampoo the carpets | SRS light after DIY seat removal / interior work | airbag_srs_light | unambiguous | synthetic |
| the little airbag person light on my dash has been glowing for a couple weeks now | airbag person-icon telltale on, weeks | airbag_srs_light | unambiguous | synthetic |
| the PASSENGER AIRBAG OFF light stays on even when my husband is sitting there | passenger-airbag-off stuck with adult seated (OCS fault) | airbag_srs_light | unambiguous | synthetic |
| theres a yellow SRS triangle showing on my dash, no clue what that even means | SRS-triangle icon, customer cannot name it | airbag_srs_light | unambiguous | synthetic |

### → `check_engine_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| autozone said its a misfire but the car drives totally fine to me, engine light is on | second-hand misfire code, customer feels nothing | check_engine_light | cross-system:engine_misfire_or_bucking_feeling | tekmetric |
| cel came on, client changed out a valve canister and it came back on | EVAP purge-canister replaced, CEL returned | check_engine_light | unambiguous | tekmetric |
| check engine light keeps turning on and going off, not blinking | intermittent steady MIL (comes and goes) | check_engine_light | unambiguous | tekmetric |
| check engine light on | MIL illuminated, no other detail | check_engine_light | needs-fact:warning_light_behavior | tekmetric |
| check engine light on, no driveability concerns, just the light being on | steady CEL, no felt symptom | check_engine_light | cross-system:performance | tekmetric |
| check engine light on, recently got gas, the light is steady | steady CEL shortly after a fill-up (loose-cap suspicion) | check_engine_light | needs-fact:recent_action | tekmetric |
| check engine light on. was told needed a booster by dealer | check engine light + dealer said 'booster' (BRAKE booster, NOT turbo boost) | check_engine_light | cross-system:brakes-friction-hydraulic | tekmetric |
| check engine light, ran the codes it gave 3 codes: 1 misfire, one misfire cylinder 1, one misfire cylinder 4 | reported misfire codes, NO felt driveability symptom stated (reported != felt) | check_engine_light | cross-system:engine_misfire_or_bucking_feeling | tekmetric |
| da - check engine light on for a couple days, no unusual sounds, smells, or performance issues, recently filled up with fuel, steady light | steady CEL, no drivability symptom (cat/O2 code candidate) | check_engine_light | cross-system:router-warning-lights | tekmetric |
| oil change, also check engine light, believe it is an EVAP issue, will need a loaner | CEL customer suspects EVAP, mixed with maintenance request | check_engine_light | unambiguous | tekmetric |
| p0446 evap code keeps setting in vehicle, can not isolate leak | recurring EVAP vent code | check_engine_light | unambiguous | tekmetric |
| the check engine light is on and has been coming on and off for a week or two, no change in how it drives | intermittent CEL, no driveability change | check_engine_light | cross-system:performance | tekmetric |
| transmission hot idle engine light was coming on | trans overheat + intermittent CEL | check_engine_light | needs-fact:warning_light_behavior | tekmetric |
| big red triangle with an exclamation point lit up on my prius dash | bare red-triangle master warning + MODEL name only (no "hybrid"/HV words) | check_engine_light | needs-fact:vehicle_powertrain | forum-paraphrase |
| check engine light came on right after I filled up with gas | MIL after fuel fill-up (EVAP/gas-cap cue) | check_engine_light | unambiguous | forum-paraphrase |
| auto parts store said my catalytic converter code P0420, want a second opinion | reported P0420, second-opinion request | check_engine_light | cross-system:router-warning-lights | synthetic |
| check engine light came on right after i filled up gas, tightened the cap but its still on solid | steady CEL post-fill-up, cap already tightened | check_engine_light | unambiguous | synthetic |
| check engine light is on and the car runs rough | classic CEL — not ADAS | check_engine_light | unambiguous | synthetic |
| dash says service engine soon, just hit 75k, car runs fine | SES telltale, drives fine, make unknown | check_engine_light, service_engine_soon_or_maintenance_required_light | oem-legend: on GM/Nissan/older Ford 'SERVICE ENGINE SOON' IS the MIL (a fault), not a reminder -- needs vehicle make to disambiguate; when unknown, lean check_engine_light (scan). See dossier §2/§3.11. | synthetic |
| engine sputters and runs rough when im stopped at red lights, rpm needle bounces all over. check engine light is on and sometimes i get a rotten egg smell | rough idle + CEL LEAD, secondary rotten-egg smell | check_engine_light | cross-system:router-warning-lights | synthetic |
| orange engine symbol came on right after i filled up at the pump | amber CEL immediately post-fuel-fill | check_engine_light | unambiguous | synthetic |

### → `battery_charging_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| battery light on, testing auth $89 | battery light (staff appended auth price) | battery_charging_light | unambiguous | tekmetric |
| check engine light on and a message says service high voltage charging system | overcharge / regulator overvoltage message (§3.11) | battery_charging_light | cross-system:check_engine_light_testing | tekmetric |
| dash battery light came on | battery/charge warning light on | battery_charging_light | needs-fact:warning_light_behavior | tekmetric |
| over the last couple years a quick blink of the battery light, now its coming on a lot and staying on longer | intermittent charge light progressing to steady | battery_charging_light | needs-fact:warning_light_behavior | forum-paraphrase |
| red battery light is on and i hear a squealing sound, ok to keep driving? | charge light + belt squeal | battery_charging_light | unambiguous | synthetic |

### → `brake_system_red_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| BRAKE INSPECTION (Warning light coming on dash) | brake symptom + unspecified dash light | brake_system_red_light | needs-fact:warning_light_named | tekmetric |
| RED BRAKE LIGHT COMING ON AND OFF, found fluid low and topped off, light back on | red brake light + low fluid, recurring | brake_system_red_light | unambiguous | tekmetric |
| RED BRAKE LIGHT WAS COMING ON AND OFF FOR A FEW DAYS, CLIENT FOUND FLUID WAS LOW AND TOPPED OFF, WAS GOOD FOR A FEW DAYS LIGHT BACK ON NOW | red base-brake telltale, low fluid recurring (leak/pad-wear cue) | brake_system_red_light | unambiguous | tekmetric |
| the traction control light, the ABS light, and the brake light for the parking brake was blinking, right rear wheel started wobbling | red brake + ABS + traction all lit with a wobbling wheel (red present -> route red) | brake_system_red_light | cross-system:abs_anti_lock_brake_light | tekmetric |
| brake lamp light on my dash lit up today, but the brake lights out back are working fine | dashboard BRAKE telltale (NOT an exterior tail-lamp outage) | brake_system_red_light | needs-fact:warning_light_named | forum-paraphrase |
| changed my master cylinder and the brake light stays on, fluid was a little low so i filled it but i keep having to top it off | red brake light with recurring low fluid after master-cylinder work (leak) | brake_system_red_light | unambiguous | forum-paraphrase |
| cruising on the interstate between 65 and 75 the ABS and brake light both come on, never in local traffic | intermittent ABS + red brake at highway speed | brake_system_red_light | cross-system:abs_anti_lock_brake_light | forum-paraphrase |
| Brakes have been squeaking for a couple weeks and now the red BRAKE light just came on, e-brake is off | squeal escalating to red brake light | brake_system_red_light | unambiguous | synthetic |
| red exclamation point in a circle came on my dashboard and the brake pedal feels mushy | red (!) base-brake telltale with spongy pedal | brake_system_red_light | unambiguous | synthetic |

### → `hybrid_system_warning_light (proposed)`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| CHECK ENGINE LIGHT ON, message service high voltage charging system | HV/charging message alongside CEL (real corpus line, near-verbatim) | hybrid_system_warning_light _(proposed)_ | cross-system:check_engine_light | tekmetric |
| red triangle light came on and it says check hybrid system, is it safe to drive? | hybrid master warning; "check hybrid system" literally states the HV system | hybrid_system_warning_light _(proposed)_ | unambiguous | forum-paraphrase |

### → `engine_temperature_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| CHECK FOR OVERHEATING. HAS NOT ADDED ANY COOLANT | engine running hot, no coolant added (plain overheat) | engine_temperature_light | needs-fact:temperature_gauge_state | tekmetric |
| COOLANT MESSAGE ON DASH CEL ON | coolant/temp dash message with check-engine light | engine_temperature_light | cross-system:check_engine_light | tekmetric |
| gauge fluctuate high and low as if the STAT is getting stuck | temp gauge fluctuating, suspected thermostat | engine_temperature_light | unambiguous | tekmetric |
| HIGH TEMPERATURE, UNSAFE TO DRIVE message, had it towed here | overheating warning message, not drivable | engine_temperature_light | unambiguous | tekmetric |
| VEHICLE OVERHEATED AND LOST ALL COOLANT | overheat with total coolant loss | engine_temperature_light | needs-fact:fluid_under_car_location | tekmetric |
| temp gauge goes all the way up, steam coming from behind the fan | gauge in the red plus steam | engine_temperature_light, smoke_from_under_the_hood | unambiguous | forum-paraphrase |
| coolant reservoir is bone dry, hot light came on | empty coolant plus overheat light | engine_temperature_light | unambiguous | synthetic |

### → `tpms_tire_pressure_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| front driver-side tire pressure sensor not reading / offline, no low tire observed | dead/offline TPMS sensor, pressures normal | tpms_tire_pressure_light | unambiguous | tekmetric |
| Tire Pressure Monitor warning light on even after checking tire pressure | TPMS light stays on, pressures checked (system fault) | tpms_tire_pressure_light | unambiguous | tekmetric |
| TPMS LIGHT COMES ON & OFF | TPMS telltale intermittent | tpms_tire_pressure_light | needs-fact:warning_light_behavior | tekmetric |
| TPMS LIGHT ON (Testing auth) | TPMS telltale illuminated | tpms_tire_pressure_light | unambiguous | tekmetric |
| TPMS light will flash when coming on and then solid, seems to go on going over bumps | TPMS flash-then-steady (system fault) | tpms_tire_pressure_light | needs-fact:warning_light_behavior | tekmetric |
| yellow horseshoe light with an exclamation point on my dash | TPMS telltale by shape description | tpms_tire_pressure_light | unambiguous | synthetic |

### → `service_engine_soon_or_maintenance_required_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| RESET OIL MAINT LIGHT (Not due yet) | reset the oil-life / maintenance reminder | service_engine_soon_or_maintenance_required_light | cross-system:service_engine_soon_or_maintenance_required_light | tekmetric |
| little wrench light on the dash, car drives perfectly | wrench/maintenance reminder | service_engine_soon_or_maintenance_required_light | unambiguous | synthetic |

### → `traction_control_stability_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| SERVICE STABILTRAC LIGHT ON. No other warning lights are present | stability (StabiliTrak) telltale steady on, isolated | traction_control_stability_light | unambiguous | tekmetric |
| TRACTION CONTROL LIGHT STAYING ON | traction telltale steady on | traction_control_stability_light | unambiguous | tekmetric |
| transmission light and esc off | ESC-off indicator plus another telltale | traction_control_stability_light | needs-fact:warning_light_named | tekmetric |
| sometimes while driving the traction control, ABS, and hill assist lights all light up, car still drives fine | traction + ABS + hill-assist co-illumination (shared WSS) | traction_control_stability_light | needs-fact:warning_light_named | forum-paraphrase |
| when I turn left the ABS and traction control light stays on for 20 seconds then goes away, started after I got my truck leveled | ABS+traction intermittent after suspension leveling | traction_control_stability_light | needs-fact:warning_light_named | forum-paraphrase |
| anti-skid light keeps flashing when it rains | stability telltale flashing during wet driving (normal intervention) | traction_control_stability_light | needs-fact:warning_light_behavior | synthetic |
| theres a little yellow car with squiggly wavy lines under it on my dash, no clue what it means | stability skid-car icon, customer cannot name it | traction_control_stability_light | unambiguous | synthetic |
| yellow car with squiggly skid lines light came on | stability/traction icon — not ADAS | traction_control_stability_light | unambiguous | synthetic |

### → `adas_driver_assist_warning_or_malfunction (proposed)`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| adaptive cruise control stopped working and there's a warning about it | ACC disabled with dash message | adas_driver_assist_warning_or_malfunction _(proposed)_ | unambiguous | nhtsa |
| after the snowstorm it said forward driving aids temporarily disabled | driving-aids disabled after snow/ice (self-clearing) | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:weather_condition | nhtsa |
| car brakes by itself sometimes, kinda scary | phantom braking, no light/system named | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:warning_light_named | nhtsa |
| collision mitigation problem and road departure problem both showed up at once | multi-assist message set (shared camera/radar/bus) | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:warning_light_behavior | nhtsa |
| collision warning keeps going off when nothing is in front of me | FCW false alert | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:warning_light_behavior | nhtsa |
| just got a new windshield and now my lane assist light is on | lane-keep warning after windshield replacement (calibration need) | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:recent_action | nhtsa |
| lane assist keeps yanking the steering wheel on the highway | phantom lane-keep steer intervention (NOT a mechanical pull) | adas_driver_assist_warning_or_malfunction _(proposed)_ | cross-system:pulling/steering | nhtsa |
| lane departure warning keeps flashing even when i'm in my lane | LDW false/steady alert | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:warning_light_behavior | nhtsa |
| message says front radar obstruction, driving aids unavailable | front radar blocked message | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:weather_condition | nhtsa |
| pre-collision system problem, car slammed the brakes for no reason on the highway | AEB phantom braking + fault message | adas_driver_assist_warning_or_malfunction _(proposed)_ | cross-system:brakes | nhtsa |
| the auto brake is acting up and the self-braking freaks out for no reason | messy-voice phantom AEB (customer slang for AEB/self-braking) | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:warning_light_behavior | nhtsa |
| blind spot light on the mirror stays lit all the time now | BSW indicator stuck on (system fault) | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:warning_light_behavior | synthetic |
| had my alignment done and the lane keep warning popped up right after | LKA warning after alignment (steering-angle recalibration) | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:recent_action | synthetic |
| little car with sensor beams light on my dash | unnamed ADAS icon lit | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:warning_light_named | synthetic |
| parking sensors beep nonstop even in an empty lot | ultrasonic park-sensor false alarm / fascia contamination | adas_driver_assist_warning_or_malfunction _(proposed)_ | speed_band:low_speed | synthetic |
| put in a new battery and now the lane keep assist light is on | ADAS relearn after battery/power loss (recent_action=battery_or_alternator_work) | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:recent_action | synthetic |
| tapped a curb and now the collision system says service required | radar aim disturbed after minor impact | adas_driver_assist_warning_or_malfunction _(proposed)_ | needs-fact:recent_action | synthetic |

### → `power_steering_eps_light`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| power steering light just came on and the wheel is really hard to turn | PS/EPS warning light + heavy steering | power_steering_eps_light | unambiguous | forum-paraphrase |
| steering wheel symbol with an exclamation point is on my dash | EPS icon named, no feel stated | power_steering_eps_light | needs-fact:steering_feel | forum-paraphrase |
| yellow steering wheel light came on and its harder to park than usual | amber PS/EPS light + low-speed heavy assist | power_steering_eps_light | unambiguous | forum-paraphrase |
| EPS light came on right after they put a new battery in, steering feels heavy now | EPS light post battery service, heavy assist | power_steering_eps_light | unambiguous | synthetic |

---

## Situational (the 6 "other" buckets) — `other`

### → `after_a_recent_accident_or_impact`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| AIR BAG LIGHT ON. WILL LET US KNOW IF WE ARE GOING TO DO TESTING. SHE WAS IN ACCIDENT RECENTLY AND WANTS TO TALK TO BODY SHOP 1st | airbag light but collision + body-shop framing dominates | after_a_recent_accident_or_impact | cross-system:after_a_recent_accident_or_impact | tekmetric |
| hit a bad pothole yesterday and now the front end feels off, want to make sure nothing got bent | post-impact check request, no discrete symptom | after_a_recent_accident_or_impact | cross-system:after_a_recent_accident_or_impact | tekmetric |
| got rear-ended hard on the highway, airbags went off, want the whole car checked and insurance is sending me | deployment + collision + insurance framing | after_a_recent_accident_or_impact | cross-system:after_a_recent_accident_or_impact | synthetic |

### → `safety_concern_dont_feel_safe_driving_it`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| NO BRAKE PRESSURE. DO NOT DRIVE. | total brake failure, not drivable | safety_concern_dont_feel_safe_driving_it | cross-system:safety_concern_dont_feel_safe_driving_it | tekmetric |
| the brakes gave out | reported brake loss (vague severity) | safety_concern_dont_feel_safe_driving_it | needs-fact:drivable_state | tekmetric |

### → `after_recent_service_or_repair_work`

| phrase (customer voice) | normalized meaning | routes_to | ambiguity | prov |
|---|---|---|---|---|
| the shop replaced my battery yesterday and now the airbag light is on, i think they messed something up and they need to fix it | SRS light right after SHOP work, customer blames the service | after_recent_service_or_repair_work | cross-system:after_recent_service_or_repair_work | synthetic |

---

## Non-concern / null-route (→ advisor, empty Stage-1)

Work-order lines, maintenance/parts requests, promos, and internal shop notes. These are NOT customer symptom concerns — Stage-1 must return EMPTY and hand off to an advisor. ~24% of the concern channel is this noise.

| phrase (customer voice) | normalized meaning | routes_to / intended | ambiguity | prov |
|---|---|---|---|---|
| $35 Off AC Service of $200 or More | promo/marketing line (not a concern) | — | null-route | tekmetric |
| all wheel / 4wd drive system service, rear differential fluid and transfer case fluid | declined-service upsell line (maintenance, no symptom) | — | unambiguous | tekmetric |
| check body control module per tech, testing auth 179 | internal work-order line, no customer symptom | advisor | unambiguous | tekmetric |
| do not top off washer fluid | advisor instruction, not a concern | — | unambiguous | tekmetric |
| i am in need of an oil change | routine oil-change request | — | unambiguous | tekmetric |
| Inspection and Oil Change | routine oil-change + inspection request | — | unambiguous | tekmetric |
| install customer supplied clutch kit | work-order instruction, not a customer symptom | — | null-route | tekmetric |
| MAKE SURE NO EXHAUST LEAKS | inspection ask (check for exhaust leaks), NOT a symptom report | — | cross-system:router-requests-maintenance | tekmetric |
| my 4 wheel drive wont engage, the 4wd light just flashes and i hear grinding | 4WD engagement failure + warning light | — (→svc:awd_4x4_testing) | unambiguous | tekmetric |
| Previously declined>LUBRICATE AND SERVICE BRAKE CALIPERS REAR AXLE [TESLA] | declined EV maintenance work-order line (real corpus), NOT a customer concern | — | unambiguous | tekmetric |
| Previously declined>Remove & Replace Fog Lamp Bulb | declined work-order line | — | unambiguous | tekmetric |
| Previously declined>Remove & Replace Spark Plugs (Replacement due every 40k miles.) | declined maintenance line item, not a customer concern | — | cross-system:non-concern-advisor | tekmetric |
| previously declined>replace engine air filter | maintenance work-order line, not a customer concern | — | non-concern | tekmetric |
| quote replacing 4 tpms sensors | internal quote line for TPMS sensor replacement | — | null-route | tekmetric |
| rear diff service | scheduled differential fluid service (maintenance) | — | unambiguous | tekmetric |
| recharge a/c system | AC recharge work-order (no symptom) | — | null-route | tekmetric |
| recs from dealer: transmission flush, brake fluid, front brake pads and rotors | dealer recommendation list (work order, not a concern) | — | null-route | tekmetric |
| REPLACE CABIN AIR FILTER (Replacement due every 2 years 20k miles) | cabin filter maintenance work-order | — | null-route | tekmetric |
| REPLACE DRIVERS SIDE LOW BEAM | work-order: replace a bulb (not a diagnostic concern) | — | unambiguous | tekmetric |
| REPLACE THE RIGHT FRONT TURN SIGNAL. CHECK LIGHTS | task order to replace a signal, no fault described | — | cross-system:advisor | tekmetric |
| REPLACE WIPERS IF NEEDED | conditional wiper-blade replacement task | — | cross-system:advisor | tekmetric |
| ROTATE IF NEEDED | conditional rotation work-order note | — | null-route | tekmetric |
| skipping feeling when turning and driving, feels like a truck stuck in 4x4 | AWD driveline windup / bind in turns | — (→svc:awd_4x4_testing) | unambiguous | tekmetric |
| somethings off with my four wheel drive, it doesnt kick in when i switch to 4hi | vague 4WD non-engagement | — (→svc:awd_4x4_testing) | unambiguous | tekmetric |
| spark plugs or poss cel testing | internal service note, no symptom | — | cross-system:non-concern-advisor | tekmetric |
| starting and charging system testing auth 89 | staff work-order line (service name + auth price), not a customer concern | — | unambiguous | tekmetric |
| State Inspection and Emissions Already have a current emissions sticker. Just need the inspection. | state safety/emissions inspection request (no symptom) | — | cross-system:router-requests-maintenance | tekmetric |
| Tire Rotation & Balance | routine rotation & balance line item | — | null-route | tekmetric |
| transmission fluid was flushed and i was told it would need to be done again | transmission flush maintenance note (no active symptom) | — | null-route | tekmetric |
| truck feels stuck in 4 wheel drive and binds up when im turning | stuck-in-4WD bind | — (→svc:awd_4x4_testing) | unambiguous | tekmetric |
| TRUNK POPS OPEN WHEN CLOSING (Has to close very lightly or it pops back open) | trunk latch will not hold closed | advisor | unambiguous | tekmetric |
| valve cover removal inspect for engine damage | shop work-order line (valve cover R&R for inspection) | — | cross-system:advisor-null-route | tekmetric |
| vehicle driven twice to get monitors to set, evap and cat monitors still not set, will drive it and bring back for retest | readiness-monitor drive-cycle note (internal) | — | null-route | tekmetric |
| electric range dropped from 200 to like 130, is the battery going bad? | BEV range loss / degradation | — | unambiguous | nhtsa |
| my ev wont charge at home anymore, the charger clicks but nothing happens and the port light is red | EVSE / on-board-charge fault | — | unambiguous | nhtsa |
| theres been so many airbag recalls, i got a notice in the mail, want to know if my car is one of them | airbag recall inquiry, not a symptom | — | null-route | nhtsa |
| my hybrid battery isnt holding a charge, gas mileage tanked over the last few months | HV pack capacity fade (hybrid) | — | unambiguous | forum-paraphrase |
| plug in my plug-in hybrid overnight and it didnt charge, wont lock onto the charger | PHEV charge-port handshake fault | — | unambiguous | forum-paraphrase |
| shuddering chatter feeling only in tight turns, its a rear wheel drive with a posi rear end | LSD/posi clutch chatter on corners (no 4WD hardware) | — (driveline_engagement_clunk_or_bind _(proposed)_, →svc:suspension_steering_check) | unambiguous | forum-paraphrase |
| drivers door wont latch shut, have to slam it | door latch will not hold | advisor | unambiguous | synthetic |
| hybrid system testing auth 179 | staff testing-authorization illustration, NOT a customer concern | — | unambiguous | synthetic |
| i just need a new engine air filter please | explicit part-replacement request (air filter) | — | non-concern | synthetic |
| I just want my spark plugs replaced, they're probably due | maintenance/parts request, no drivability symptom | — | cross-system:advisor-maintenance-request | synthetic |
| my headlights look really cloudy and yellowed and seem dim at night | oxidized/hazy headlight LENSES (optical dimness) -- NOT an electrical fault | — | cross-system:router-requests-maintenance | synthetic |
| my key is stuck in the ignition and wont come out | key stuck in ignition (interlock / worn cylinder) | advisor | unambiguous | synthetic |
| passenger airbag off light comes on when my little kid sits up front | passenger-airbag-off for a child (NORMAL by design) | — | null-route | synthetic |
| PERFORM FORWARD CAMERA CALIBRATION AFTER ALIGNMENT | technician/advisor work-order note | — | non-concern | synthetic |
| seat belt won't pull out, its stuck and wont come across me, no warning light on the dash | seat-belt retractor jammed, no telltale (restraint hardware) | — | null-route | synthetic |
| smoke test evap system, verify repair, testing auth 179 | shop work-order line, not a symptom | — | null-route | synthetic |
| the seat belt buckle wont click / latch anymore, no dash light | buckle won't latch, no telltale (restraint hardware) | — | null-route | synthetic |
| theres a wind noise around the windshield that got worse after the glass was replaced | wind noise near windshield after glass R&R | advisor | unambiguous | synthetic |
| water pours in by my feet when it rains hard | water enters passenger footwell in rain | advisor | unambiguous | synthetic |
| wont start, key wont turn in the ignition | key will not turn / no-start | advisor | unambiguous | synthetic |

---

## No current subcategory fit (→ advisor / proposed subcategory)

Real symptoms with NO correct Stage-2 home in today's taxonomy (catalog coverage gaps: interior water leaks, immobilizer/key no-start, EV charging/range, driveline engagement clunk, manual-clutch, collapsed spring, grabby brakes). routes_to is left to `advisor`/`—`; the intended landing spot is the _(proposed)_ slug in the owning system's proposals.yaml.

| phrase (customer voice) | normalized meaning | routes_to / intended | ambiguity | prov |
|---|---|---|---|---|
| awd system malfunction message came up and it dropped into 2wd | AWD electronic fault, 2WD limp | — (→svc:awd_4x4_testing) | cross-system:check_engine_light_testing | tekmetric |
| client just had rear differential serviced elsewhere and now sees fluid leaking everywhere | gear-oil leak APPEARING right after a rear-diff service (situational override) | — (→svc:after_recent_service_or_repair_work) | cross-system:after_recent_service_or_repair_work | tekmetric |
| Clunking noise when putting car into drive from park / turning left | clunk on shift-into-gear (driveline), not over bumps | — | cross-system:PROPOSED:driveline_clunk_on_shift_or_acceleration | tekmetric |
| clunking noise when putting the car into drive from park or turning left | driveline backlash clunk on gear engagement | — (driveline_engagement_clunk_or_bind _(proposed)_, →svc:suspension_steering_check) | needs-fact:onset_timing | tekmetric |
| front floor board, passenger side, under floor mat, you can visibly see water standing | clear water standing inside on the passenger floor | advisor | cross-system:clear_odorless_puddle_water_or_ac_condensation | tekmetric |
| got gas sunday, next day the car was chugging and now it wont start, saw smoke under the hood | no-start + rough running shortly after a fill-up (bad-fuel suspicion) | — | needs-fact:recent_action | tekmetric |
| intermitent no start | intermittent crank-no-fire — no subcategory fit | — | needs-fact:onset_timing | tekmetric |
| intermitent no start testing auth 179 | terse no-start line; crank detail absent -> no_start vs charging boundary | — | cross-system:no_start_testing | tekmetric |
| jerking in the driveline when backing up or on tight turns | driveline jerk/bind on engagement + tight turns | — (driveline_engagement_clunk_or_bind _(proposed)_, →svc:awd_4x4_testing) | cross-system:awd_4x4_testing | tekmetric |
| LEFT FRONT WHEEL SITTING LOWER THAN REST SUSPENSION INSPECTION AUTH 89 | left-front corner sitting low (broken/collapsed spring), inspection requested | — | needs-fact:location_side | tekmetric |
| NOISE IN REAR OF VEHICLE ONLY HAPPENS DURING WINTER SEEMS TO GO AWAY DURING SUMMER SOUNDS LIKE SOMETHING AROUND IN TRUNK | rattle/loose item in trunk, seasonal | advisor | cross-system:rattling_underneath_the_car | tekmetric |
| rack replacement | bare part-replacement work order, no symptom | — | needs-fact:customer_request_type | tekmetric |
| test battery (just want to make sure it is ok) | customer requests a battery test, no symptom | — | cross-system:battery_test | tekmetric |
| tow in, cranks but will not start | engine cranks normally, no fire (fuel/spark/crank-signal) — no subcategory fit | — | needs-fact:engine_running | tekmetric |
| Water is leaking into the driver's side of my car. The floor is full of water! | water intrusion flooding interior floor | advisor | cross-system:ac_performance_check | tekmetric |
| carpet is soaked on the driver side every time it rains | interior carpet wet, rain-correlated | advisor | needs-fact:weather_condition | forum-paraphrase |
| felt like the driveshaft slips when i take off fast, and it jerks when shifting | driveshaft/U-joint slip + shift jerk | — (driveline_engagement_clunk_or_bind _(proposed)_, →svc:suspension_steering_check) | cross-system:transmission_testing | forum-paraphrase |
| grinding sound when i put it in reverse | internal transmission grind in reverse | — | needs-fact:noise_descriptor | forum-paraphrase |
| heard a loud bang and now it wont move, engine revs but the car goes nowhere | snapped axle shaft, engine free-revs, no motion | — (→svc:suspension_steering_check) | needs-fact:drivable_state | forum-paraphrase |
| little white steam on cold mornings that goes away after a minute, no smell | normal cold-start tailpipe condensation | — | inference-trap | forum-paraphrase |
| rattle from the dash or door panel over bumps | interior trim rattle over bumps | advisor | cross-system:rattling_underneath_the_car | forum-paraphrase |
| windshield cracked from a rock on the highway | windshield glass cracked (chip spreading) | advisor | cross-system:windshield_inop_testing | forum-paraphrase |
| car cranks but wont start and the little security light is flashing | immobilizer no-start, security light flashing, engine cranks | advisor | needs-fact:warning_light_named | synthetic |
| cranks strong and turns over fine but it just wont fire up | normal crank, no fire (fuel/spark no-start) | — | cross-system:no_start_testing | synthetic |
| just need a coolant flush, car runs fine, no problems | routine coolant-flush maintenance request, no symptom | — | cross-system:general_check_up_or_pre_trip_inspection | synthetic |
| loud clunk from the driveline every time i shift into reverse and when i take off | U-joint/backlash clunk on torque reversal | — (driveline_engagement_clunk_or_bind _(proposed)_, →svc:suspension_steering_check) | needs-fact:onset_timing | synthetic |
| loud whistling air noise from the driver door at highway speed | wind whistle from door at speed | advisor | needs-fact:sound_or_smoke_location_zone | synthetic |
| my brakes grab really hard and jerk the car even when i barely touch the pedal | grabby/over-sensitive brake bite | — | needs-fact:pedal_feel | synthetic |
| my hybrid engine runs all the time now and revs up loud, it used to shut off at lights and be quiet | hybrid engine-on-constantly / high-rev — OFTEN NORMAL hybrid behavior; if abnormal it is an ICE driveability/exhaust-noise concern, NOT an HV-routing win (§7) | — | needs-fact:vehicle_powertrain | synthetic |
| smells musty inside and the headliner is damp after storms | damp headliner + musty smell after rain | advisor | cross-system:musty_mildew_smell_from_vents | synthetic |

---

## Highest-value ambiguous phrases (trigger a clarify, not a confident pick)

These are the vague / multi-route utterances where a confident single pick is a **misroute risk**. The classifier should return 2–3 ranked candidates (a clarify chip) OR ask the one discriminating Stage-3 fact named below — never guess. This is the anti-over-confidence set.

| phrase (customer voice) | why it's ambiguous | candidate routes | ask / discriminate on | prov |
|---|---|---|---|---|
| loud clunk from the driveline every time i shift into reverse and when i take off | vague/underspecified | — (driveline_engagement_clunk_or_bind _(proposed)_, →svc:suspension_steering_check) | fact: `onset_timing` | synthetic |
| Brake Inspection. Wobbles? | multi-candidate | pulsating_or_vibrating_pedal, vibration_or_pulsing_when_braking | fact: `onset_timing` | tekmetric |
| slight pulsation at high speeds, can be felt in the steering wheel, whole vehicle jerks while braking | multi-candidate | pulsating_or_vibrating_pedal, vibration_or_pulsing_when_braking | fact: `pedal_feel` | tekmetric |
| WANTS TO MAKE SURE BRAKES ARE OK (Making some noise) | multi-candidate | high_pitched_squealing, metallic_grinding | fact: `noise_descriptor` | tekmetric |
| TRUNK IS INOPERABLE | multi-candidate | accessory_doesnt_work, advisor | fact: `accessory_affected` | tekmetric |
| TRUNK WILL NOT OPEN | multi-candidate | accessory_doesnt_work, advisor | fact: `accessory_affected` | tekmetric |
| keeps dying when im driving, battery is new and alternator tested good | multi-candidate | car_died_while_driving_electrical, battery_drains_overnight | fact: `speed_band` | forum-paraphrase |
| the power window controls and radio both stopped working, checked the fuses | multi-candidate | accessory_doesnt_work, multiple_random_electrical_glitches | fact: `onset_timing` | forum-paraphrase |
| the alarm goes off randomly in the middle of the night for no reason | vague/underspecified | accessory_doesnt_work | fact: `accessory_affected` | synthetic |
| A/C not getting cold (air was warmer out of driver side) | multi-candidate | ac_blows_warm_or_hot_air, one_zone_works_but_another_doesnt | fact: `location_side` | tekmetric |
| CLIENT REPORTS PASSENGER SIDE ONLY BLOWS LUKE-COLD, A/C CHECK OK | vague/underspecified | one_zone_works_but_another_doesnt | fact: `location_side` | tekmetric |
| heater just blows cold no matter how long I drive, had to top off the coolant tank twice | vague/underspecified | heat_doesnt_work | fact: `temperature_gauge_state` | tekmetric |
| leaks something that looks and feels like oil but smells like nothing and my levels arent dropping | multi-candidate | brown_or_black_puddle_engine_oil, clear_odorless_puddle_water_or_ac_condensation | fact: `fluid_color` | forum-paraphrase |
| the client hears an exhaust leak and thinks it may be coming from one of the flanges | multi-candidate | exhaust_louder_or_rumbling, exhaust_manifold_tick_or_puff | fact: `onset_timing` | tekmetric |
| front passenger side tire makes noise | vague/underspecified | humming_or_whirring_at_speed | fact: `noise_descriptor` | tekmetric |
| not sure but my car is rumbling. i think there's something wrong with the alignment | vague/underspecified | exhaust_louder_or_rumbling | fact: `noise_descriptor` | tekmetric |
| tires making a strange noise when driving | vague/underspecified | humming_or_whirring_at_speed | fact: `noise_descriptor` | tekmetric |
| with the key turned to on it makes a buzzing or humming noise | vague/underspecified | electrical_buzzing | fact: `sound_or_smoke_location_zone` | forum-paraphrase |
| rear end is whining and theres dark oil dripping back there | multi-candidate | humming_or_whirring_at_speed, thick_dark_brown_puddle_gear_or_differential_oil | fact: `fluid_color` | synthetic |
| traction control light came on as well for a short second, struggles at low speeds/idle | multi-candidate | rough_idle_or_shaking_at_a_stop, stalling_at_idle_or_when_stopping, engine_misfire_or_bucking_feeling | fact: `engine_running` | tekmetric |
| car keeps stalling while driving and at idle | multi-candidate | stalling_while_driving_under_load, stalling_at_idle_or_when_stopping | fact: `speed_band` | tekmetric |
| check engine light on, running rough | multi-candidate | rough_idle_or_shaking_at_a_stop, check_engine_light | fact: `speed_band` | tekmetric |
| IDLE IS DROPPING VERY LOW AND ALMOST STALLING | multi-candidate | stalling_at_idle_or_when_stopping, rough_idle_or_shaking_at_a_stop | fact: `engine_running` | tekmetric |
| weak/extended crank | multi-candidate | hard_to_start_when_cold, hard_to_start_when_hot | fact: `weather_condition` | tekmetric |
| aaa tow in. possible transmission concern. | vague/underspecified | low_power_or_wont_accelerate_normally | fact: `transmission_behavior` | tekmetric |
| burns a lot of oil and has to fill up the oil about every few months | multi-candidate | smoke_from_under_the_hood, blue_or_gray_smoke_from_tailpipe | fact: `sound_or_smoke_location_zone` | tekmetric |
| my truck started blowing black smoke, not sure whats going on | vague/underspecified | black_smoke_from_tailpipe | fact: `onset_timing` | synthetic |
| steering feels off, car wanders and im fighting the wheel | vague/underspecified | pulling_drifting_or_wandering_on_the_road | fact: `pull_direction` | forum-paraphrase |
| tire pressure light keeps coming back on even tho I put air in all four | multi-candidate | low_pressure_warning_light_only, tpms_tire_pressure_light | fact: `warning_light_behavior` | synthetic |
| abs / trac / no AWD message | multi-candidate | abs_anti_lock_brake_light, traction_control_stability_light | fact: `warning_light_named` | tekmetric |
| vehicle doesnt go over a certain speed / went into limp mode a lot of dash lights came on but are now off | multi-candidate | multiple_warning_lights_at_once, low_power_or_wont_accelerate_normally | fact: `warning_light_behavior` | tekmetric |
| TPMS LIGHT COMES ON & OFF | vague/underspecified | tpms_tire_pressure_light | fact: `warning_light_behavior` | tekmetric |
| transmission light and esc off | vague/underspecified | traction_control_stability_light | fact: `warning_light_named` | tekmetric |
| collision warning keeps going off when nothing is in front of me | vague/underspecified | adas_driver_assist_warning_or_malfunction _(proposed)_ | fact: `warning_light_behavior` | nhtsa |
| the auto brake is acting up and the self-braking freaks out for no reason | vague/underspecified | adas_driver_assist_warning_or_malfunction _(proposed)_ | fact: `warning_light_behavior` | nhtsa |

_35 curated ambiguous phrases shown (of 44 flagged needs-fact/multi-route rows in the corpus)._

---

## Appendix — provenance normalization audit

Raw dossier provenance labels and how they map into the 4-value enum used above:

| raw label (as written in dossiers) | raw count | → normalized |
|---|---|---|
| `tekmetric` | 296 | tekmetric |
| `forum-paraphrase` | 189 | forum-paraphrase |
| `synthetic` | 184 | synthetic |
| `nhtsa` | 17 | nhtsa |
| `eval` | 11 | synthetic |
| `eval-corpus` | 9 | synthetic |
| `eval-authored` | 7 | synthetic |
| `db-positive` | 5 | synthetic |
| `nhtsa-paraphrase` | 4 | nhtsa |
| `catalog` | 3 | synthetic |

_Counts are pre-dedup raw rows. `synthetic`-class includes all authored-but-not-real-corpus voice (eval fixtures, live-DB positive_examples, invented) — kept honest so the real-Tekmetric share is not inflated._
