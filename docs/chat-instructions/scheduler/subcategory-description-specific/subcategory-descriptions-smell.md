# Subcategory Descriptions — `smell` category

<!--
Authoritative subcategory metadata for the 8 smell subcategories. Consumed by
the stage-1 diagnostic LLM classifier (Anthropic Claude Haiku 4.5). The four
fields per block — description, positive_examples, negative_examples, synonyms
— are written from real customer language extracted from automotive
service / help-guide sources (see "Research Sources" below).

The smell category is unusually SEMANTIC — customers describe smells with
rich, varied vocabulary that cascades across many synonyms for the SAME
underlying chemistry. For example, the bacteria-on-evaporator smell is
described as "musty", "moldy", "mildewy", "funky", "dirty socks", "gym
socks", "locker room", "basement", "stale", "damp" — these ALL point at the
same evaporator. Synonyms intentionally cover the full cascade.

Boundary notes (read these before editing — they explain the most-common
mis-routes Haiku makes inside `smell/` and across neighboring categories):

  - `smell/musty_mildew_smell_from_vents` vs `hvac/bad_smell_from_vents`
      DUAL ROUTING by design. When the customer is clearly tying the smell
      to vent airflow ("musty smell when I turn on the AC", "vents stink
      like dirty socks", "smell from the dash when heat is on") → ROUTE TO
      `hvac/bad_smell_from_vents` (more specific; HVAC has 7 dedicated
      diagnostic questions covering musty / sweet / burning variants).
      Use this `smell/` subcategory ONLY when the smell is mildewy / moldy
      but the customer does NOT specifically say it comes through the
      vents — e.g., "moldy smell from the carpet", "musty smell from the
      trunk after rain", "damp basement smell in the back seat", "wet-dog
      smell that won't go away". When in doubt, prefer HVAC.

  - `smell/sweet_smell_maple_syrup_antifreeze` vs `leak/green_orange_yellow_or_pink_puddle_coolant`
      Same root cause (coolant leak) — different report angle. Customer
      SEES the puddle → leak/. Customer SMELLS the sweet syrup smell with
      no visible puddle mentioned → smell/. If both ("sweet smell PLUS
      green puddle"), the visible-puddle slug usually wins because the
      mechanic needs the color/location data.

  - `smell/sweet_smell_maple_syrup_antifreeze` vs `hvac/bad_smell_from_vents` (sweet variant)
      Sweet smell coming clearly through the vents while the heat is on →
      HVAC (heater-core coolant leak, vent-routed). Sweet smell from
      OUTSIDE the car / under the hood / general "sweet smell from
      somewhere" → smell/.

  - `smell/burnt_oil_smell` vs `leak/brown_or_black_puddle_engine_oil`
      Same root cause (oil leak hitting hot exhaust) — different report
      angle. Customer SEES the dark puddle → leak/. Customer SMELLS the
      burnt-oil odor (sometimes with no puddle yet) → smell/. Customers
      frequently describe the SMELL first because it hits them after a
      drive before they see a stain.

  - `smell/gasoline_fuel_smell` vs `performance/stalling_while_driving_under_load`
      Fuel system issues can produce both, but customers report them
      DIFFERENTLY. "I smell gas inside my car / around the car" → smell/.
      "Engine sputters and stalls under throttle" → performance/. If both
      ("smell gas AND engine sputters"), smell/ wins as the lead signal
      because raw fuel is a safety-fire issue.

  - `smell/burning_electrical_plastic_smell` vs `electrical/multiple_random_electrical_glitches`
      Electrical fault often produces BOTH a burning-plastic smell AND
      glitching accessories. The SMELL is the key safety signal (potential
      fire). When customer leads with the smell ("burning electrical smell
      from the dash", "I smell melting wires") → smell/. When customer
      leads with the glitches and only mentions smell incidentally →
      electrical/.

  - `smell/burning_electrical_plastic_smell` vs `electrical/dim_or_flickering_lights`
      Same dynamic. Lights pulsing + a burning smell → smell/ leads
      because a burning smell + electrical means stop-and-inspect-now.
      Lights flickering with NO smell → electrical/dim_or_flickering_lights.

  - `smell/burning_rubber_hot_brake_smell` vs `brakes/metallic_grinding`
      Both point at brake problems but report differently. Customer
      smells hot brakes / burning rubber from a wheel after braking → smell/.
      Customer hears metal-on-metal grinding when pressing the pedal →
      brakes/. If they say both, brakes/metallic_grinding usually wins
      because the grinding is more urgent (pads worn through to backing).

  - `smell/burning_rubber_hot_brake_smell` vs `smell/burnt_oil_smell`
      Burning rubber tends to be sharper, more chemical, and smelt FROM A
      WHEEL after braking or with parking brake left on. Burnt oil tends
      to be greasier, more petroleum-y, and smelt FROM UNDER THE HOOD
      after the engine has been hot for a while. Customers do confuse
      these — the diagnostic questions sort it out.

  - `smell/rotten_egg_sulfur_smell` vs `smell/exhaust_fumes_inside_the_cabin`
      The sulfur smell is a SPECIFIC chemical descriptor — almost always
      catalytic-converter related and reported as "rotten eggs" / "sulfur".
      The exhaust slug covers general exhaust smell ("exhaust fumes", "the
      car smells like the tailpipe is in the cabin") that may or may not
      include sulfur. If they specifically say "rotten egg" or "sulfur",
      rotten-egg slug wins.

  - `smell/exhaust_fumes_inside_the_cabin` is a SAFETY EMERGENCY (CO
      poisoning risk). The slug exists separately from other smells
      precisely because the response is different — customer needs to
      ventilate immediately and tow rather than drive.

Research Sources (customer language + chemistry extracted from these
pages, May 2026):
  - https://www.autozone.com/diy/symptoms/why-does-my-car-car-smell-like-burning-oil
  - https://wiscoautomotive.com/burning-smell-from-car-after-driving-causes/
  - https://chimneyrockcarcare.com/decoding-burning-oil-smell-in-car/
  - https://www.carparts.com/blog/does-your-car-smell-like-burning-oil-heres-why/
  - https://www.firestonecompleteautocare.com/blog/maintenance/smell-of-gas-in-car/
  - https://www.autozone.com/diy/fuel/why-does-your-car-smell-like-gas
  - https://burtbrothers.com/tips/gas-smell-inside-your-car-what-it-means-how-to-fix-it/
  - https://www.laytonsgarage.com/blog/why-does-my-car-smell-like-gas-when-i-start-it-in-the-morning
  - https://www.candsautorepairllc.com/why-your-car-smells-like-gas-when-the-heat-is-on-and-what-to-do-about-it/
  - https://kingdomautocare.com/why-your-car-smells-like-rotten-eggs-and-how-to-fix-it-fast/
  - https://www.cars.com/articles/why-does-my-car-smell-like-rotten-eggs-464899/
  - https://repairpal.com/symptoms/car-smells-like-rotten-eggs
  - https://www.yourmechanic.com/article/3-reasons-your-car-smells-like-rotten-eggs
  - https://chimneyrockcarcare.com/what-if-car-smells-like-burning-plastic/
  - https://www.autotechiq.com/symptom/my-car-smells-like-burning-plastic
  - https://www.toolesgarage.com/blog/what-s-that-weird-electrical-smell-inside-my-car
  - https://bmelectric310.com/blog/electrical-burning-smell/
  - https://nrsbrakes.com/blogs/supporting-articles/why-do-my-brakes-smell-like-theyre-burning-common-causes-for-a-hot-smell
  - https://nubrakes.com/blog/burning-smell-from-your-brakes/
  - https://cluballiance.aaa.com/the-extra-mile/advice/car/my-car-smell-like-burning-rubber
  - https://www.consumerreports.org/cars/car-maintenance/get-rid-of-musty-smell-from-cars-air-conditioner-a2986616934/
  - https://www.autozone.com/diy/climate-control/why-does-my-car-ac-smell-bad
  - https://www.autoscopecarcare.com/car-repair/car-ac-smells-bad/
  - https://www.ultra-fresh.com/why-your-car-ac-smells-bad
  - https://www.carrchevrolet.com/service/information/common-reasons-car-smells-like-exhaust.htm
  - https://aamcocentralflorida.com/help-exhaust-fumes-in-my-car/
  - https://www.capitol-chevy.com/service/information/reasons-you-can-smell-exhaust-burning-inside-your-car-salem-or.htm
  - https://www.cdc.gov/carbon-monoxide/about/index.html
  - https://ranchobernardoautocare.com/sweet-smell-in-your-car-it-might-be-a-heater-core-leak/
  - https://www.platinumwrench.com/post/what-that-sweet-smell-from-your-car-could-mean
-->

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
  - "Bright green puddle under the front of the car" → leak/green_orange_yellow_or_pink_puddle_coolant
  - "Sweet smell coming through the vents when the heat is on, windows fog up" → hvac/bad_smell_from_vents
  - "Sweet smell AND wet passenger floor carpet" → hvac/bad_smell_from_vents
  - "Burning oil smell from under the hood" → burnt_oil_smell
  - "Sticky red puddle under the middle of the car" → leak/red_or_pink_puddle_transmission_or_power_steering
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
  - "Dark brown oily puddle in my driveway" → leak/brown_or_black_puddle_engine_oil
  - "Burning rubber smell from one of the wheels after braking" → burning_rubber_hot_brake_smell
  - "Sharp burning plastic smell from the dash" → burning_electrical_plastic_smell
  - "Sweet maple syrup smell from under the hood" → sweet_smell_maple_syrup_antifreeze
  - "Black smoke from the tailpipe and burning oil smell" → smoke/blue_or_gray_smoke_from_tailpipe
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
  - "Exhaust / tailpipe smell inside the car when driving" → exhaust_fumes_inside_the_cabin
  - "Rotten egg smell from the exhaust" → rotten_egg_sulfur_smell
  - "Engine sputters and stalls under throttle, no smell" → performance/stalling_while_driving_under_load
  - "Burning oil smell from the engine bay" → burnt_oil_smell
  - "Sweet syrup smell from the engine" → sweet_smell_maple_syrup_antifreeze
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
  - "General exhaust / tailpipe smell in the cabin" → exhaust_fumes_inside_the_cabin
  - "Thick dark fluid under the rear axle that smells like sulfur" → leak/thick_dark_brown_puddle_gear_or_differential_oil
  - "Burning rubber from a wheel after braking" → burning_rubber_hot_brake_smell
  - "Gas / fuel smell, not eggy" → gasoline_fuel_smell
  - "Black smoke from the tailpipe" → smoke/black_smoke_from_tailpipe
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
  - "Greasy burning oil smell from under the hood" → burnt_oil_smell
  - "Burning rubber smell from a wheel after I brake" → burning_rubber_hot_brake_smell
  - "Lights flicker but no burning smell" → electrical/dim_or_flickering_lights
  - "Multiple random electrical glitches, no smell" → electrical/multiple_random_electrical_glitches
  - "Musty / mildew smell from the carpet" → musty_mildew_smell_from_vents
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
  - "Burning oil smell from under the hood" → burnt_oil_smell
  - "Burning plastic / electrical smell from the dash" → burning_electrical_plastic_smell
  - "Grinding noise when I press the brake pedal" → brakes/metallic_grinding
  - "Visible smoke coming from a wheel" → smoke/smoke_or_burning_smell_from_a_wheel
  - "Sweet / syrupy smell from the engine area" → sweet_smell_maple_syrup_antifreeze
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
  - "Musty smell when I turn on the AC" → hvac/bad_smell_from_vents
  - "Dirty sock smell from the vents" → hvac/bad_smell_from_vents
  - "Moldy smell from the dash when heat is on" → hvac/bad_smell_from_vents
  - "Sweet syrupy smell, not musty" → sweet_smell_maple_syrup_antifreeze
  - "Burning electrical smell from the dash" → burning_electrical_plastic_smell
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
  - "Rotten egg / sulfur smell from the exhaust" → rotten_egg_sulfur_smell
  - "Raw gasoline / fuel smell inside the car" → gasoline_fuel_smell
  - "Burning oil smell from under the hood" → burnt_oil_smell
  - "Musty / moldy smell from the vents" → hvac/bad_smell_from_vents
  - "Black smoke from the tailpipe" → smoke/black_smoke_from_tailpipe
Synonyms: exhaust smell, exhaust fumes, tailpipe smell, exhaust in cabin, fumes inside car, exhaust in the car, smoky cabin smell, exhaust leak smell, manifold leak smell, CO smell, carbon monoxide leak, exhaust coming through vents, muffler smell inside, smoky burnt smell inside, exhaust gas in cabin

<!-- end smell/ subcategories -->
