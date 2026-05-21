# Subcategory Descriptions — brakes

<!--
Wave A1 draft. Authored 2026-05-21.

Sources (customer language and symptom phrasings extracted from these pages):
  - https://www.cars.com/articles/why-are-my-brakes-squealing-1420684417093/
  - https://nubrakes.com/blog/6-reasons-your-brakes-are-squeaking/
  - https://nrsbrakes.com/blogs/supporting-articles/why-are-my-brakes-squealing-a-guide-to-causes-and-fixes
  - https://www.brakeandfrontend.com/diagnosing-your-customers-brake-noise-complaints/
  - https://www.raybestos.com/resources/common-brake-noises-and-what-they-mean/
  - https://www.firestonecompleteautocare.com/blog/brakes/why-are-brakes-grinding/
  - https://nubrakes.com/blog/brake-grinding/
  - https://www.toyotadalton.com/blogs/3762/7-times-a-grinding-sound-when-braking-means-your-toyota-needs-service
  - https://www.qualitybrakes.net/faq/brakes-grinding-groaning-are-my-brakes-going-bad/
  - https://www.powerstop.com/resources/diagnose-brake-issue-soft-spongey-pedal/
  - https://www.wagnerbrake.com/technical/technical-tips/why-are-my-brakes-spongy.html
  - https://www.kbb.com/car-advice/why-do-my-brakes-feel-spongy/
  - https://nubrakes.com/blog/spongy-brakes/
  - https://www.carparts.com/blog/why-your-brake-pedal-goes-to-the-floor/
  - https://www.sunautoservice.com/blog/what-causes-my-brake-pedal-to-sink
  - https://teamcardoctors.com/why-is-my-brake-pedal-sinking-to-the-floor/
  - https://www.thecarbuzz.com/symptoms-of-a-bad-brake-master-cylinder/
  - https://www.cars.com/articles/why-does-the-pedal-vibrate-when-i-hit-the-brakes-1420684416551/
  - https://coventrymotorsny.com/blog/causes-of-brake-pedal-vibration/
  - https://nrsbrakes.com/blogs/supporting-articles/diagnosing-warped-rotors-symptoms-and-repair-options
  - https://www.sundevilauto.com/blog/brake-shudder-why-your-car-vibrates-when-you-brake
  - https://www.firestonecompleteautocare.com/blog/brakes/why-is-my-brake-pedal-hard/
  - https://www.autozone.com/diy/brakes/why-is-my-brake-pedal-hard-to-push
  - https://mpbrakes.com/diagnose-and-fix-hard-brake-pedal/
  - https://nrsbrakes.com/blogs/supporting-articles/troubleshooting-a-hard-brake-pedal-causes-and-solutions-for-stiff-brakes

Validation notes:
  - All 6 subcategories carry at least one explicit "Distinct from <slug>" boundary
    callout in the description.
  - Negative examples target the most common cross-collision risks: pedal-feel
    subcategories distinguish themselves from each other; noise subcategories
    distinguish themselves from suspension noise and rotor-related vibration.
  - Synonyms span casual ("squeaky", "spongy"), neutral ("squeal", "pulsates"),
    and technical ("wear indicator", "brake booster", "DTV", "master cylinder").
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
  - "Grinding or scraping like metal on metal when I brake" → metallic_grinding
  - "Squeaking sound when I go over bumps in the road" → noise/squeaking_or_creaking_over_bumps
  - "Whining noise from under the hood, not the wheels" → noise/high_pitched_whining_under_the_hood
  - "Squealing only when I turn the steering wheel, not when braking" → steering/noise_when_turning_the_steering_wheel
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
  - "High-pitched squealing when I brake, not really grinding" → high_pitched_squealing
  - "Grinding noise even when I'm not pressing the brakes" → noise/humming_or_whirring_at_speed
  - "Grinding sound only when turning, not braking" → noise/popping_or_clicking_when_turning
  - "Pedal vibrates and shakes when I brake, no grinding" → pulsating_or_vibrating_pedal
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
  - "Pedal slowly sinks all the way to the floor when I hold pressure" → pedal_sinks_to_floor
  - "Pedal is really stiff and hard to push down" → hard_or_unresponsive_pedal
  - "Pedal pulsates and vibrates when I brake hard" → pulsating_or_vibrating_pedal
  - "Brake warning light is on but pedal feels fine" → warning_light/brake_system_red_light
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
  - "Pedal feels spongy and soft but doesn't keep sinking" → spongy_or_soft_pedal
  - "Pedal is rock hard, won't go down at all" → hard_or_unresponsive_pedal
  - "Brake fluid is leaking onto my driveway" → leak/clear_yellow_or_light_brown_puddle_brake_fluid
  - "Red brake light came on but pedal still feels normal" → warning_light/brake_system_red_light
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
  - "Steering wheel shakes at 70 mph even when I'm not braking" → vibration/steering_wheel_shake_at_highway_speed
  - "Whole car shakes over bumps and rough roads" → vibration/shaking_or_bouncing_over_bumps_and_rough_roads
  - "Pedal feels soft and mushy, no vibration" → spongy_or_soft_pedal
  - "Grinding noise when I brake but pedal feels normal" → metallic_grinding
Synonyms: pulsating, pulsing, pulses, vibrates, vibration, vibrating, shudder, shudders, shuddering, shake, shakes, judder, juddering, throbbing pedal, thumping pedal, brake shimmy, brake shake, warped rotors, DTV, rotor thickness variation, rhythmic pedal feel

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
  - "Brake pedal feels soft and spongy" → spongy_or_soft_pedal
  - "Pedal slowly sinks to the floor when I hold pressure" → pedal_sinks_to_floor
  - "Pedal vibrates and pulses when I brake hard" → pulsating_or_vibrating_pedal
  - "Hissing under the dash but pedal feels normal" → noise/hissing_noise
Synonyms: hard pedal, stiff pedal, hard to push, won't push down, rock-hard pedal, pedal like wood, unresponsive pedal, no power assist, brake booster failure, vacuum leak, hard brakes, stiff brakes, frozen pedal, locked pedal, pedal won't depress
