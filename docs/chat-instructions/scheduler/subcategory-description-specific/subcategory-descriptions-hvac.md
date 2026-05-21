# Subcategory Descriptions — HVAC category (draft)

<!--
Draft of stage-1 metadata for the 8 HVAC subcategories. Heading is COMPOSITE
`## hvac/<slug>` — both halves must match `^[a-z0-9_]+$`.

Field caps (from upload_subcategory_descriptions_md):
  - Description: 10..1000 chars (we write 2-3 sentences, customer-perspective)
  - Positive examples: <= 10
  - Negative examples: <= 10 (may append ` → other_slug` for advisor reference)
  - Synonyms: <= 20

KEY cross-category collisions covered below:
  - hvac/bad_smell_from_vents  vs  smell/musty_mildew_smell_from_vents
    Both exist by design — when smell is clearly through the cabin vents, this
    HVAC slug is the canonical pick (it has 7 dedicated diagnostic questions
    handling musty/sweet/burning variants). The smell/ category is the pick
    when the smell is NOT clearly tied to vent airflow (e.g., smell from under
    the hood, smell from outside the car, smell during accel).
  - hvac/bad_smell_from_vents (sweet)  vs  smell/sweet_smell_maple_syrup_antifreeze
    The sweet/maple-syrup smell entering through the vents while heat is on
    IS a heater-core coolant leak — still routes here (hvac/) because the
    customer-experience locus is vent airflow + cabin. The smell/ slug catches
    "sweet smell from under the hood / outside the car" cases.
  - hvac/strange_noise_from_vents  vs  noise/electrical_buzzing  vs  noise/hissing_noise
    Vent rattle/whistle that ONLY happens with the fan on goes here. General
    dash buzz unrelated to fan, or hiss from underhood/exhaust, goes to noise/.
  - hvac/ac_blows_warm_or_hot_air  vs  hvac/ac_is_weak_not_cold_enough
    Zero / near-zero cooling vs partial cooling. The "blows warm" slug is the
    pick when the customer says "blowing warm" or "blowing hot" — total
    absence of cool. The "weak" slug is the pick when they say "not as cold
    as it used to be" — partial cooling.
  - hvac/vents_dont_blow_strongly  vs  hvac/ac_is_weak_not_cold_enough
    Airflow VOLUME weak vs cooling QUALITY weak. Customers conflate these
    constantly; the descriptions emphasize the volume-vs-temperature split.
  - hvac/heat_doesnt_work  vs  warning_light/engine_temperature_light
    "Engine runs cool" complaints with a temperature gauge reading low and
    no cabin heat go HERE (heat_doesnt_work) — the diagnostic flow needs the
    HVAC question set. A standalone temperature warning light on the dash
    with no heater complaint goes to warning_light/.

Sources cited (urls used during research):
  - https://www.autozone.com/diy/climate-control/car-ac-blowing-hot-air
  - https://www.tiresplus.com/blog/maintenance/4-reasons-your-car-a-c-may-be-blowing-hot-air/
  - https://repairpal.com/symptoms/car-ac-not-working
  - https://www.jiffylube.com/resource-center/help-my-car-ac-isnt-blowing-cold-air
  - https://www.autozone.com/diy/symptoms/car-heater-not-working
  - https://repairpal.com/symptoms/car-heater-not-working
  - https://www.toyotanation.com/threads/weak-air-flow-from-vents.1703010/
  - https://www.laytonsgarage.com/blog/can-a-dirty-cabin-filter-make-my-a-c-blow-weak
  - https://www.napaautopro.com/en/why-your-car-defroster-or-defogger-is-not-working/
  - https://magazine.northeast.aaa.com/daily/life/cars-trucks/ultimate-guide-defog-windows-car/
  - https://www.consumerreports.org/cars/car-maintenance/get-rid-of-musty-smell-from-cars-air-conditioner-a2986616934/
  - https://www.ericthecarguy.com/leaking-heater-core/
  - https://www.carparts.com/blog/bad-blend-door-actuator-symptoms-location-replacement-faq/
  - https://blog.1aauto.com/rattling-noise-in-car-air-vent/
  - https://www.2carpros.com/articles/blower-fan-motor-works-on-high-speed-only/
  - https://www.2carpros.com/questions/intermittent-ac-cooling
  - https://www.classictoyotatyler.com/blog/why-is-my-car-ac-making-a-whistling-noise/
  - https://repairpal.com/symptoms/rear-defroster-not-working
-->

## hvac/ac_blows_warm_or_hot_air
Description: Customer says the AC produces NO meaningful cooling — vent air feels the same as outside temperature, or actually warm/hot, even with AC set to max cold. A missing "click" from under the hood when AC is requested is a key tell that the compressor isn't engaging. Common causes: very low refrigerant from a leak, a failed compressor or compressor clutch, or an electrical fault stopping the compressor. Distinct from `ac_is_weak_not_cold_enough` — that is PARTIAL cooling (cool but not cold), whereas this is TOTAL absence of cooling. Distinct from `vents_dont_blow_strongly` — there the airflow VOLUME is weak; here plenty of air comes out but it isn't cold. If customer reports "warm AC plus a sweet smell", route smell first only if smell is the primary complaint; otherwise route here.
Positive examples:
  - "My AC is blowing warm air"
  - "Air conditioner is blowing hot air, basically just outside air"
  - "AC stopped working, feels like it's not on at all"
  - "Turn the AC to max cold and I just get warm air out of the vents"
  - "Compressor isn't kicking in — no click when I turn AC on"
Negative examples:
  - "AC is on but it's just not as cold as last summer" → ac_is_weak_not_cold_enough
  - "AC blows cold but the airflow is really weak" → vents_dont_blow_strongly
  - "Heater blows cold air" → heat_doesnt_work
  - "Driver side is cold but passenger side is warm" → one_zone_works_but_another_doesnt
  - "AC blows cold for 5 minutes then turns warm, then cold again" → ac_is_weak_not_cold_enough
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
  - "AC is blowing warm air, no cooling at all" → ac_blows_warm_or_hot_air
  - "AC is cold but the airflow is really weak out of the vents" → vents_dont_blow_strongly
  - "Heater doesn't get warm — heat doesn't work" → heat_doesnt_work
  - "One side blows cold, other side blows warm" → one_zone_works_but_another_doesnt
  - "Musty smell from the vents along with weak cooling" → bad_smell_from_vents
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
  - "AC blows warm in the summer" → ac_blows_warm_or_hot_air
  - "Heat is hot but the airflow from the vents is really weak" → vents_dont_blow_strongly
  - "Heat is fine on the driver side but cold on the passenger side" → one_zone_works_but_another_doesnt
  - "Engine temp warning light is on" → engine_temperature_light
  - "Windows fog up even with heat on" → foggy_or_hard_to_defog_windows
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
  - "AC isn't cold enough" → ac_is_weak_not_cold_enough
  - "AC blows warm air" → ac_blows_warm_or_hot_air
  - "Rattling noise from the dash when fan is on" → strange_noise_from_vents
  - "Driver side has no air but passenger side is fine" → one_zone_works_but_another_doesnt
  - "Defrost vents don't blow air on the windshield" → foggy_or_hard_to_defog_windows
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
  - "Heater blows cold air" → heat_doesnt_work
  - "AC is weak" → ac_is_weak_not_cold_enough
  - "Wipers don't clear the windshield" → (out of HVAC scope; would be vibration/visibility category)
  - "Sweet smell from the vents" → bad_smell_from_vents
  - "Weak airflow from all vents including defrost" → vents_dont_blow_strongly
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
  - "Buzzing noise from the dash all the time, fan-independent" → electrical_buzzing
  - "Hissing under the hood after I shut the car off" → hissing_noise
  - "Vents barely blow any air" → vents_dont_blow_strongly
  - "AC compressor squeals" → high_pitched_whining_under_the_hood
  - "Rattling underneath the car" → rattling_underneath_the_car
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
  - "Burning smell from under the hood" → burnt_oil_smell
  - "Exhaust smell in the cabin while driving" → exhaust_fumes_inside_the_cabin
  - "Rotten egg smell" → rotten_egg_sulfur_smell
  - "Gas smell outside the car, not through the vents" → gasoline_fuel_smell
  - "AC blows warm" → ac_blows_warm_or_hot_air
  - "Sweet smell from the engine bay, not through the vents" → sweet_smell_maple_syrup_antifreeze
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
  - "AC blows warm from every vent" → ac_blows_warm_or_hot_air
  - "Heater doesn't work at all" → heat_doesnt_work
  - "Vents are weak on every side" → vents_dont_blow_strongly
  - "Clicking from the dash, both sides work fine" → strange_noise_from_vents
  - "Defroster doesn't work" → foggy_or_hard_to_defog_windows
Synonyms: dual zone, dual climate, two zone, zone problem, driver side hot passenger cold, passenger side warm driver cold, one side cold one side hot, left vent right vent different, rear climate not working, blend door actuator, blend door, climate door, temperature door, asymmetric temperature, uneven temperature
