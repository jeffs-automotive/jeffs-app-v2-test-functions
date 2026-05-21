# Subcategory Descriptions — `leak` category

<!--
Authoritative subcategory metadata for the leak category. Each ## block
carries the 4 fields the stage-1 diagnostic classifier reads when the
customer describes a fluid puddle / stain / drip under their vehicle.

The leak category is uniquely COLOR-DRIVEN — customers describe what
they see (color, texture, smell, location under the car) and the fluid
type tells us where to route. Positive examples deliberately span the
full color range customers actually report (engine oil from amber to
black; coolant green / orange / yellow / pink / blue; etc.).

Reader pairs that are most often confused (handled in description
"Distinct from" callouts + negative_examples):
  - red ATF/PSF puddle vs pink/red OAT-coolant puddle
  - clear water (AC drip) vs clear-to-yellow brake fluid (safety emergency)
  - brown/black engine oil vs thick dark gear oil (location + smell)
  - blue washer fluid vs blue Asian-formulation coolant
  - clear water under car vs heater core leak inside cabin
    (the cabin leak is HVAC, not this leak/* category)

Source URLs consulted (May 2026):
  - https://www.capitalone.com/cars/learn/managing-your-money-wisely/whats-that-puddle-under-my-car-a-guide-to-automotive-leaks/2148
  - https://www.jiffylube.com/resource-center/car-fluid-leak-colors-guide
  - https://www.chapelhilltire.com/understanding-the-different-puddles-under-your-car-and-what-they-mean
  - https://www.autozone.com/diy/fluids-chemicals/how-to-determine-leaking-fluid-by-color
  - https://carsymp.com/oil-leak-repair/oil-leak-under-car/identifying-oil-leak-puddle-color-and-smell/
  - https://nrsbrakes.com/blogs/supporting-articles/puddle-under-the-car-how-to-spot-and-address-dangerous-brake-fluid-leaks
  - https://www.firestonecompleteautocare.com/blog/maintenance/is-your-car-ac-leaking-water/
  - https://tomsautomotive.com/air-conditioning-heating/whats-puddle-under-car/
  - https://www.yourmechanic.com/article/symptoms-of-bad-or-failing-windshield-washer-reservoir
  - https://www.fridayparts.com/blog/got-a-rear-differential-leak-a-guide-to-symptoms-causes-and-fixes
  - https://www.yourmechanic.com/article/symptoms-of-bad-or-failing-differential-gear-oil
  - https://www.powersteeringrack.net/news/what-color-is-the-power-steering-fluid-when-it-leaks
  - https://engineerfix.com/what-color-is-the-liquid-from-a-power-steering-fluid-leak-2/
  - https://www.peddle.com/blog/junk/normal-leaks-vs-serious-leaks-how-to-identify-them-and-what-they-mean
-->

## leak/brown_or_black_puddle_engine_oil
Description: A slick, oily puddle that ranges from honey-amber (fresh oil) to brown or black (used oil), most often appearing under the front or middle of the car beneath the engine. The fluid feels thick and greasy between the fingers and usually smells of petroleum, sometimes burnt if it has been dripping onto hot exhaust. Distinct from the much thicker, sulfur-smelling gear oil that pools further back near an axle, and distinct from red transmission fluid which tends to drip nearer the center under the transmission.
Positive examples:
  - "Dark brown puddle under my engine when I park"
  - "Black oily stain on my driveway in the morning"
  - "Found some amber-colored drips under the front of the car after my oil change"
  - "There's a slick brown spot under the motor and the oil light came on"
  - "Greasy black puddle, smells like burning oil after I drive"
Negative examples:
  - "Thick dark fluid under the rear axle that smells like rotten eggs" → thick_dark_brown_puddle_gear_or_differential_oil
  - "Bright red fluid under the middle of the car" → red_or_pink_puddle_transmission_or_power_steering
  - "Green slimy puddle under the radiator" → green_orange_yellow_or_pink_puddle_coolant
  - "Blue smoke from the tailpipe" → smoke/blue_smoke_from_exhaust
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
  - "Bright red puddle under the middle of the car" → red_or_pink_puddle_transmission_or_power_steering
  - "Light blue watery puddle near the front wheel, no smell" → blue_or_light_blue_puddle_washer_fluid
  - "Sweet smell inside the cabin when the heat is on, no puddle outside" → smell/sweet_smell_maple_syrup_antifreeze
  - "Foggy windows and wet passenger floor" → hvac/foggy_or_hard_to_defog_windows
  - "Clear water under the car after running the AC" → clear_odorless_puddle_water_or_ac_condensation
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
  - "Bright neon pink fluid right under the radiator, smells sweet" → green_orange_yellow_or_pink_puddle_coolant
  - "Dark brown oily puddle under the engine" → brown_or_black_puddle_engine_oil
  - "Thick dark fluid that smells like sulfur" → thick_dark_brown_puddle_gear_or_differential_oil
  - "Clear yellow oily spot near a wheel" → clear_yellow_or_light_brown_puddle_brake_fluid
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
  - "Clear puddle under the front of the car after running AC, no oil to it" → clear_odorless_puddle_water_or_ac_condensation
  - "Yellow neon coolant under the radiator" → green_orange_yellow_or_pink_puddle_coolant
  - "Brown oil leak under the engine" → brown_or_black_puddle_engine_oil
  - "Hard brake pedal, no puddle anywhere" → other/brake_concern_no_leak
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
  - "Clear slippery puddle near a wheel and the brake pedal is soft" → clear_yellow_or_light_brown_puddle_brake_fluid
  - "Wet carpet on the passenger floor and the windows fog up" → hvac/foggy_or_hard_to_defog_windows
  - "Sweet smell inside the car when I run the heater" → smell/sweet_smell_maple_syrup_antifreeze
  - "Green slimy puddle, not clear water" → green_orange_yellow_or_pink_puddle_coolant
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
  - "Brown oily puddle under the engine" → brown_or_black_puddle_engine_oil
  - "Red fluid under the transmission" → red_or_pink_puddle_transmission_or_power_steering
  - "Black smoke from tailpipe" → smoke/black_smoke_from_exhaust
  - "Grinding noise from the rear with no leak" → noise/grinding_or_rumbling_from_rear
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
  - "Bright blue slimy fluid right under the radiator, smells sweet" → green_orange_yellow_or_pink_puddle_coolant
  - "Clear watery puddle, no color" → clear_odorless_puddle_water_or_ac_condensation
  - "Wipers won't move at all" → other/wiper_motor_concern
  - "Window won't roll up" → electrical/power_window_failure
Synonyms: washer fluid, windshield washer fluid, wiper fluid, washer reservoir leak, windshield cleaner, blue fluid leak, watery blue puddle, washer bottle leak

<!-- end leak/ subcategories -->
