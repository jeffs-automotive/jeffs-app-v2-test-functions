# Subcategory Descriptions — smoke

<!--
Source research (May 2026):
  - https://www.whocanfixmycar.com/advice/white-smoke-coming-from-my-car
  - https://obdguides.com/symptoms/white-smoke-from-exhaust/
  - https://www.theaa.com/breakdown-cover/advice/white-smoke-from-exhaust
  - https://www.whocanfixmycar.com/advice/blue-smoke-coming-from-my-car
  - https://lubricants.repsol.com/en/news/humo-azul-coche-causas-riesgo/
  - https://www.fenderbender.com/running-a-shop/operations/article/33027836/how-to-read-blue-smoke-signals
  - https://www.whocanfixmycar.com/advice/black-smoke-coming-from-car
  - https://www.kkrichardson.com/kwik-blog/black-smoke-coming-from-exhaust/
  - https://vfidiesel.com/diesel-black-smoke-causes-diagnosis/
  - https://carfromjapan.com/article/car-smoking-under-hood-but-not-overheating/
  - https://www.mariettaautorepairga.com/blog/smoke-under-your-car-s-hood-here-s-what-it-could-mean
  - https://crownautorepaircollision.com/blog/car-smoking-under-hood-and-burning-smell/
  - https://nrsbrakes.com/blogs/supporting-articles/why-do-my-brakes-smell-like-theyre-burning-common-causes-for-a-hot-smell
  - https://www.autobarn.net/symptoms/brakes-smoking
  - https://www.carparts.com/blog/why-are-my-brakes-smoking/amp/
  - https://www.advantagemuffler.net/blog/where-does-the-burning-smell-from-your-cars-vents-come-from
  - https://www.carparts.com/blog/what-causes-the-burning-smell-from-the-heater-in-your-car/
  - https://gogreenplumb.com/blog/why-is-there-a-burning-smell-coming-out-of-my-ac-vents/

Color × location mapping (Haiku tuning):
  - WHITE smoke from tailpipe = coolant in cylinders = sweet/syrupy smell
    EXCEPTION: thin wispy white on cold mornings that clears in 1-2 min = normal water vapor (steam), NOT this subcategory.
  - BLUE/GRAY smoke from tailpipe = oil burning = oily/acrid smell
  - BLACK smoke from tailpipe = rich fuel mixture = strong gasoline/diesel smell
    EXCEPTION: small puff under hard acceleration on a diesel = often normal turbo-lag rich event.
  - SMOKE FROM UNDER HOOD = oil-on-hot-surface, coolant boil-over, electrical short, or recent-work spillage.
    When customer ONLY smells it (no visible smoke), route to smell/* instead.
  - SMOKE FROM A WHEEL = brake overheating, almost always stuck caliper or dragging pad.
    When customer ONLY smells burning rubber/brake (no visible smoke), route to smell/burning_rubber_hot_brake_smell.
  - SMOKE INSIDE CABIN = visible smoke/haze in cabin air — more urgent than smell-only.
    When customer ONLY smells fumes inside (no visible smoke), route to smell/exhaust_fumes_inside_the_cabin or smell/burning_electrical_plastic_smell.
-->

## smoke/white_smoke_from_tailpipe
Description: Persistent white smoke coming out of the exhaust pipe at the back of the vehicle, often with a sweet or syrupy smell, frequently paired with a dropping coolant level or the temperature gauge creeping up. Typically caused by coolant leaking into the cylinders through a failed head gasket, cracked head, or bad intake gasket — the coolant gets burned along with the fuel and exits as white smoke. Distinct from normal cold-morning steam (thin wispy vapor that clears within a minute or two of warm-up, no smell — NOT this subcategory) and distinct from blue_or_gray_smoke_from_tailpipe (oil burning — oily smell, not sweet).
Positive examples:
  - "Lots of white smoke coming out of the tailpipe even after I've been driving for 20 minutes"
  - "Thick white smoke from the exhaust and it smells kind of sweet"
  - "My car is blowing white smoke and I've had to add coolant twice this week"
  - "White cloud out the back, temperature gauge is running high"
  - "Persistent white smoke from the exhaust pipe, doesn't go away when the engine warms up"
Negative examples:
  - "A little white steam from the tailpipe on cold mornings that goes away" → (normal — no subcategory)
  - "Blue smoke from the tailpipe when I start it up" → blue_or_gray_smoke_from_tailpipe
  - "Black smoke from the exhaust when I floor it" → black_smoke_from_tailpipe
  - "Sweet smell but no visible smoke" → sweet_smell_maple_syrup_antifreeze
  - "Smoke coming from under the hood, not the tailpipe" → smoke_from_under_the_hood
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
  - "White smoke from the tailpipe with a sweet smell" → white_smoke_from_tailpipe
  - "Black smoke when I accelerate hard" → black_smoke_from_tailpipe
  - "Burning oil smell but I don't see smoke" → burnt_oil_smell
  - "Smoke coming from under the hood after a long drive" → smoke_from_under_the_hood
  - "Oil dripping on the ground in the driveway" → brown_or_black_puddle_engine_oil
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
  - "White smoke from the tailpipe, sweet smell" → white_smoke_from_tailpipe
  - "Blue smoke when I start it cold" → blue_or_gray_smoke_from_tailpipe
  - "Diesel puffs a tiny bit of black smoke only on hard acceleration, otherwise fine" → (normal — no subcategory)
  - "Strong gas smell but no visible smoke" → gasoline_fuel_smell
  - "Black smoke from under the hood" → smoke_from_under_the_hood
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
  - "Burning oil smell but I don't see any smoke" → burnt_oil_smell
  - "Burning plastic smell but no visible smoke" → burning_electrical_plastic_smell
  - "White smoke from the tailpipe" → white_smoke_from_tailpipe
  - "Sweet smell, coolant low, no smoke" → sweet_smell_maple_syrup_antifreeze
  - "Smoke coming out of one wheel" → smoke_or_burning_smell_from_a_wheel
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
  - "Burning rubber smell but I don't see smoke from the wheels" → burning_rubber_hot_brake_smell
  - "Grinding noise when I brake" → metallic_grinding
  - "Smoke from under the hood" → smoke_from_under_the_hood
  - "Hot brake smell after a long downhill, no smoke" → burning_rubber_hot_brake_smell
  - "Car pulls when braking, no smoke" → pulling_only_when_braking
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
  - "Exhaust fumes smell inside the car but no smoke" → exhaust_fumes_inside_the_cabin
  - "Burning plastic smell but no visible smoke and not sure where it's from" → burning_electrical_plastic_smell
  - "Musty smell from the AC vents" → musty_mildew_smell_from_vents
  - "Smoke coming up from under the hood" → smoke_from_under_the_hood
  - "Sweet smell from the vents, no smoke" → bad_smell_from_vents
Synonyms: smoke in cabin, smoke inside car, smoke from vents, dashboard smoke, cabin smoke, smoke in the car, haze inside car, smoke from dash, vent smoke, interior smoke, smoking dashboard
