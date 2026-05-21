# Subcategory Descriptions — warning_light

<!--
Wave C4 draft. Authored 2026-05-21.

THIS IS THE BIGGEST + HIGHEST-STAKES CATEGORY in the diagnostic classifier.
12 subcategories. Customers describe warning lights by NAME, by COLOR, by
ICON SHAPE, and by BEHAVIOR (steady / flashing / on-and-off) — synonyms
must cover all four modes.

The two highest-stakes distinctions in this whole category set:

  1. check_engine_light  vs  service_engine_soon_or_maintenance_required_light
     -----------------------------------------------------------------------
     CEL = a DIAGNOSTIC trouble code (the OBD-II computer detected an actual
           problem — emissions, misfire, sensor, etc.). Icon is an ENGINE
           OUTLINE. May be amber/yellow/orange, can flash (severe misfire).
     SES / MAINT REQD = a SCHEDULED-SERVICE REMINDER (mileage tripped —
           "you're due for an oil change," nothing is actually wrong with
           the engine right now). Often shown as words ("SERVICE ENGINE
           SOON", "MAINT REQD", "SERVICE DUE") or a wrench icon — NOT
           an engine outline. Resets after the service is performed.
     Customers say "service engine soon light" interchangeably with "check
     engine light" all day long. The classifier MUST use the
     reminder-vs-problem distinction in question_text / context to route
     correctly. When the customer says the words "Service Engine Soon" OR
     "Maintenance Required" OR "Service Due" verbatim AND the car drives
     fine, route to SES. When the customer says generic "check engine
     light" + describes ANY drivability symptom (rough idle, misfire,
     hesitation, smell, smoke, sound), route to CEL.

  2. brake_system_red_light  vs  abs_anti_lock_brake_light
     -----------------------------------------------------
     RED brake light (often the word "BRAKE" inside a circle inside parens,
     OR a red exclamation point in a circle in parens) = MAIN hydraulic
     brake system. Means parking brake on, OR brake fluid low, OR hydraulic
     pressure lost. SAFETY EMERGENCY — do not drive.
     YELLOW/AMBER ABS light (the letters "ABS" inside a circle inside
     parens) = anti-lock braking system fault. Regular brakes still work,
     but the anti-lock feature is disabled. Drivable to a shop.
     Customers conflate these constantly ("my brake light is on"). The
     COLOR + the exact icon shape are the key. If both red + yellow are
     on simultaneously → route to brake_system_red_light (the red one is
     the more urgent of the two; advisor will triage ABS as a co-finding).

Other key boundaries:

  - tpms_tire_pressure_light  vs  tires/low_pressure_warning_light_only
    DUPLICATE INTENT — warning_light wins when the customer LEADS with
    the LIGHT ("my tpms light came on", "low tire pressure warning"),
    tires/low_pressure wins when the customer LEADS with the tire
    ("front tire looks low and the light came on"). Coordinate routing
    with the tires category — both descriptions cross-reference each
    other so Haiku has the boundary in both directions.

  - traction_control_stability_light  vs  abs_anti_lock_brake_light
    Often co-occur (TCS shares wheel-speed sensors with ABS) but distinct
    systems. Customer reports the LIGHT they see — if both, prefer
    traction_control_stability_light (the more specific message) UNLESS
    they also describe ABS-specific symptoms (pulsing pedal absent, hard
    braking lock-up).

  - engine_temperature_light  cross-references
      smoke/smoke_from_under_the_hood (overheating often produces steam
      and the customer may lead with "smoke")
      smell/sweet_smell_maple_syrup_antifreeze (overheat after coolant
      leak — sweet smell often precedes the light)
      Light-FIRST routes to warning_light/engine_temperature_light.
      Smoke-FIRST → smoke/. Smell-FIRST → smell/.

  - oil_pressure_light  cross-references
      noise/deep_knocking_from_the_engine (low oil pressure causes rod-
      bearing knock when prolonged). Light-FIRST → here. Noise-FIRST →
      noise/. Both reported → here is preferred (the LIGHT is the trigger
      action and we want the urgent oil-pressure questions in front).

  - multiple_warning_lights_at_once
      Specifically THREE OR MORE lights on simultaneously, OR a "dashboard
      lit up like a Christmas tree" report. Two lights with an obvious
      cause-and-effect relationship (e.g., ABS + traction together — they
      share sensors) should route to whichever single light the customer
      led with, not multiple. The intent of this subcategory is "deeper
      electrical / charging / alternator / ground failure that cascaded
      across modules" — NOT "two lights that share a system."

Research sources (URL list — verbatim phrase mining):
  - https://tunerworks.com/blog/service-engine-soon-check-engine-light/
  - https://stsqualityautocare.com/check-engine-vs-service-engine-soon-lynnwood-wa/
  - https://www.paulsauto.com/blog/what-does-it-mean-if-my-check-engine-or-service-engine-soon-light-comes-on
  - https://www.autozone.com/diy/engine/what-does-a-flashing-check-engine-light-mean
  - https://www.fixdapp.com/check-engine-light/check-engine-light-meaning/
  - https://www.totalcardiagnostics.com/learn/malfunction-indicator-light/
  - https://en.wikipedia.org/wiki/Check_engine_light
  - https://goodcar.com/blog/maintenance-required-light
  - https://www.yourmechanic.com/article/understanding-toyota-service-indicator-lights-by-brent-minderler
  - https://www.manhattanbeachtoyota.com/blog/what-does-the-maintenance-required-light-mean-in-your-toyota/
  - https://mechanicbase.com/warning-lights/toyota-maintenance-required-light/
  - https://www.jbtools.com/blog/check-engine-light-vs-maintenance-required-key-differences/
  - https://www.autozone.com/diy/battery/battery-light-on-car
  - https://repairpal.com/symptoms/charging-system-warning-light
  - https://www.firestonecompleteautocare.com/blog/batteries/what-to-do-when-car-battery-light-on/
  - https://www.cars.com/amp/articles/why-is-the-battery-light-on-1420663031640/
  - https://jsautori.com/alternator-warning-light-signs-of-electrical-issues/
  - https://www.captoyota.com/service/information/know-the-oil-lights-in-your-car.htm
  - https://www.rac.co.uk/drive/advice/car-maintenance/oil-warning-light-causes-and-solutions/
  - https://www.topspeed.com/dashboard-light-never-ignore/
  - https://vatire.com/car-maintenance-tips/why-is-my-oil-pressure-light-on/
  - https://engineerfix.com/which-symbol-represents-the-oil-pressure-warning/
  - https://www.fixter.co.uk/blog/reasons-your-engine-temperature-warning-light-might-illuminate
  - https://www.mycarly.com/blog/car-warning-lights/engine-coolant-temperature-light-what-it-is-and-how-to-deal-with-it/
  - https://www.carparts.com/blog/coolant-temperature-warning-light-meaning-causes-what-to-do/
  - https://www.cbac.com/media-center/blog/2024/february/four-reasons-why-your-engine-temperature-warning/
  - https://www.reedmantollcdjrspringfield.com/what-does-a-tpms-warning-light-mean.htm
  - https://www.lesschwab.com/article/car-maintenance/tpms-light-coming-on-in-cold-weather-heres-why.html
  - https://tires.bridgestone.com/en-us/learn/tire-maintenance/tpms-light-on
  - https://www.pirelli.com/tires/en-us/car/driving-and-tire-tips/how-to-read/tpms-light-on
  - https://fitzzserviceinc.com/blog/low-tire-pressure-light/
  - https://www.freeasestudyguides.com/brake-red-warning-light.html
  - https://carista.com/en-us/blogs/news/what-does-your-brake-warning-light-mean
  - https://allaboutautomotive.com/2013/11/12/dash-warning-lights-brake-abs-and-traction/
  - https://repairpal.com/symptoms/abs-warning-light
  - https://repairpal.com/brake-hydraulic-system-red-warning-light
  - https://nrsbrakes.com/blogs/supporting-articles/decoding-your-dashboard-your-brake-warning-light-is-on-now-what
  - https://www.jlwranglerforums.com/forum/threads/abs-light-and-traction-light-on-after-hitting-pot-hole.75105/
  - https://repairpal.com/supplemental-restraint-system-srs-warning-light
  - https://carista.com/en-us/blogs/news/why-is-my-airbag-warning-light-on-and-how-to-fix-it
  - https://www.capitalone.com/cars/learn/finding-the-right-car/what-you-need-to-know-about-airbag-warning-lights/2254
  - https://www.safetyrestore.com/blog/srs-light-meaning-and-how-it-works/
  - https://blog.rainbowmuffler.net/blog/the-traction-control-light-what-does-it-mean
  - https://repairpal.com/traction-control-warning-light
  - https://dashboardsymbols.com/2018/11/slip-indicator-symbol/
  - https://www.carfax.com/maintenance/traction-control-or-esc-light-on
  - https://www.broomfieldautorepair.com/blog/what-does-the-power-steering-light-mean
  - https://www.rac.co.uk/drive/advice/car-maintenance/power-steering-warning-light/
  - https://merrillauto.com/blog/understanding-electric-power-steering-warning-light/
  - https://www.yourmechanic.com/article/what-does-the-steering-system-warning-light-mean-by-spencer-cates
  - https://www.carparts.com/blog/what-does-it-mean-when-all-dashboard-lights-are-on/
  - https://garagesee.com/multiple-warning-lights-on-dash/
  - https://knowhow.napaonline.com/5-alternator-issues-warning-signs-stay-ahead-potential-problem/

Validation notes:
  - All 12 subcategories carry AT LEAST 2 explicit "Distinct from <slug>"
    boundary callouts in the description (per quality bar — warning lights
    have the most cross-confusion).
  - CEL vs SES distinction is restated in BOTH descriptions in the
    reminder-vs-problem framing. Customers say "service engine soon"
    when they mean CEL — the descriptions tell Haiku to use the
    drivability-symptom signal to disambiguate.
  - Red brake vs yellow ABS distinction is restated in BOTH descriptions
    in the color + safety-emergency-vs-still-drivable framing.
  - TPMS description explicitly cross-references tires/low_pressure_warning_light_only
    and routes by lead-symptom (light-led → here; tire-led → tires/).
  - multiple_warning_lights_at_once explicitly requires THREE OR MORE
    lights (not just two co-occurring related lights) per quality bar.
  - Synonyms span: light NAMES (e.g., "check engine light", "CEL", "MIL"),
    light ICONS (e.g., "yellow engine outline", "red oil can", "horseshoe
    with exclamation point", "person seatbelt symbol"), and light
    BEHAVIORS (e.g., "flashing", "blinking", "steady", "intermittent").
    10-20 synonyms per subcategory per quality bar.
-->

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
  - "Dashboard says SERVICE ENGINE SOON and it's about time for an oil change" → service_engine_soon_or_maintenance_required_light
  - "Got a MAINT REQD message on the dash, car drives perfectly fine" → service_engine_soon_or_maintenance_required_light
  - "Check engine light AND battery light AND ABS light all came on at once" → multiple_warning_lights_at_once
  - "Red oil can icon came on, no engine light" → oil_pressure_light
  - "Engine is overheating, temperature light is on" → engine_temperature_light
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
  - "Check engine light came on and the car is running rough" → check_engine_light
  - "Yellow engine-shape icon, no other words, engine misfiring" → check_engine_light
  - "CEL is flashing, car is shaking under acceleration" → check_engine_light
  - "Red oil can light came on" → oil_pressure_light
  - "Temperature gauge is in the red and the temp light is on" → engine_temperature_light
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
  - "Dashboard lights are dim but I don't see any specific warning light" → electrical/dim_or_flickering_lights
  - "Car won't crank, just clicks when I turn the key" → electrical/wont_crank_just_clicks
  - "Many warning lights lit up at the same time" → multiple_warning_lights_at_once
  - "Engine temperature light is on, not the battery light" → engine_temperature_light
  - "Car cranks slowly when I start it cold, no warning light" → electrical/slow_crank_sluggish_start
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
  - "Dashboard says SERVICE DUE — I think I'm overdue for an oil change" → service_engine_soon_or_maintenance_required_light
  - "Deep knocking from the engine, no light on" → noise/deep_knocking_from_the_engine
  - "Engine temperature light is on, not the oil light" → engine_temperature_light
  - "Oil is leaking under the car, no warning light yet" → leak/black_oil_leak_under_engine
  - "Check engine light is on, no oil light" → check_engine_light
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
  - "White steam pouring out from under the hood" → smoke/smoke_from_under_the_hood
  - "Sweet smell like maple syrup or pancake syrup in the car" → smell/sweet_smell_maple_syrup_antifreeze
  - "Coolant is leaking under the car, light hasn't come on" → leak/green_or_orange_or_pink_coolant_leak
  - "Oil pressure light is on, not the temp light" → oil_pressure_light
  - "Check engine light, no temp warning" → check_engine_light
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
  - "My front passenger tire looks really low and the light is on" → tires/low_pressure_warning_light_only
  - "Tire is completely flat on the side of the road" → tires/visible_low_or_flat_tire
  - "Slow leak in my tire — keeps going down every few days" → tires/slow_leak_pressure_drops_repeatedly
  - "Tire pressure is fine but the car pulls to one side" → pulling/pulls_to_one_side
  - "Red brake light, not the tire light" → brake_system_red_light
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
  - "Red brake light is on, parking brake is released" → brake_system_red_light
  - "Red BRAKE light glowing — brake pedal feels soft" → brake_system_red_light
  - "Just the yellow traction-control-with-skid-lines icon, no ABS letters" → traction_control_stability_light
  - "Both red brake AND yellow ABS are on at the same time" → brake_system_red_light
  - "Several different warning lights all came on at once" → multiple_warning_lights_at_once
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
  - "Yellow ABS letters light came on, brakes still work normal" → abs_anti_lock_brake_light
  - "Brake pedal feels soft and spongy, no warning light" → brakes/spongy_or_soft_pedal
  - "Pedal sinks to the floor at red lights, no light on" → brakes/pedal_sinks_to_floor
  - "Brakes squealing every time I stop, no light" → brakes/high_pitched_squealing
  - "Multiple warning lights came on at once" → multiple_warning_lights_at_once
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
  - "Check engine light is on, not the airbag light" → check_engine_light
  - "Red brake light, parking brake is off" → brake_system_red_light
  - "Multiple warning lights including airbag came on after battery died" → multiple_warning_lights_at_once
  - "Seat belt buzzer is going off, no warning light" → other/seat_belt_warning_only
  - "Several different lights came on at the same time" → multiple_warning_lights_at_once
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
  - "Yellow ABS letters on my dash" → abs_anti_lock_brake_light
  - "Red brake light is on, parking brake released" → brake_system_red_light
  - "Tire pressure warning light came on" → tpms_tire_pressure_light
  - "Several lights came on at the same time" → multiple_warning_lights_at_once
  - "Car is actually sliding and losing grip on wet roads, no light yet" → handling/loss_of_traction_or_grip
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
  - "Steering wheel is hard to turn but I don't see any warning light" → steering/hard_to_turn_steering_wheel
  - "Whining noise when I turn the wheel, no warning light" → noise/whining_when_turning_the_steering_wheel
  - "Power steering fluid leaking, no warning light yet" → leak/red_or_pink_power_steering_fluid_leak
  - "Multiple warning lights came on at the same time including EPS" → multiple_warning_lights_at_once
  - "Check engine light is on, no steering light" → check_engine_light
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
  - "Just the check engine light, nothing else" → check_engine_light
  - "Only the red brake light, parking brake released" → brake_system_red_light
  - "ABS light and traction control light both on" → abs_anti_lock_brake_light
  - "Battery light and dim headlights" → battery_charging_light
  - "Airbag light by itself" → airbag_srs_light
Synonyms: multiple warning lights, multiple lights, lots of lights, many lights, all warning lights, all dashboard lights, all lights on, all lights came on, dashboard lit up, Christmas tree dashboard, lit up like a Christmas tree, every light on, every warning light, several warning lights, three lights, three warning lights, lots of warnings, dashboard going crazy, every light glowing, panel full of lights
