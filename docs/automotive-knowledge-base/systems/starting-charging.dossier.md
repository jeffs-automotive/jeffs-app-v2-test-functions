# Starting & charging system — diagnostic dossier
slug: starting-charging   date: 2026-07-18
binds_services: [charging_starting_testing, no_start_testing, battery_test]
binds_categories: [electrical, warning_light, performance]

## 1. Scope & boundaries

**In scope** — the low-voltage energy chain that turns the engine over and keeps the electrical
system alive while it runs:
- **Battery** (state of charge, capacity/CCA, terminals & cables, hold-down, corrosion).
- **Starter motor + solenoid** (engagement, current draw, single-click vs rapid-click behavior).
- **Alternator + voltage regulator + serpentine/accessory belt** (charging output, diode/rectifier
  health, bearing/belt whine, dim-at-idle cue).
- **Charging/starting wiring & grounds** (voltage-drop faults, chewed harness at the battery).
- **Parasitic draw** (something discharging the battery while parked).
- **Symptom families:** no-crank (rapid-click, single-click, AND fully silent), slow-crank,
  dead-battery, battery-keeps-dying, dim/flickering lights, charge/battery warning light,
  overcharging (regulator overvoltage), starter-grind on start, died-while-driving with electrical
  precursors, and the cranks-but-won't-fire hard-start cases (cold and hot) that live under
  `performance`.

**Explicitly OUT of scope** (each with the owner):
- **Cranks-but-won't-fire because of FUEL or SPARK** (injectors, fuel pump, ignition coils,
  crank/cam signal) — the mechanical no-start. Owned by the `no-start-power` router / `no_start_testing`
  service. This dossier owns only the *electrical energy* side of no-start (dead battery, bad starter).
  The two share the `no_start_testing` ↔ `charging_starting_testing` confusable — see §5/§7.
- **Engine stalling that is engine-side** (sputter/stumble/hesitation, no electrical warnings) →
  neighbor `engine-controls-driveability` (`stalling_while_driving_under_load`,
  `rough_idle_or_shaking_at_a_stop`).
- **Security / immobilizer no-crank** (anti-theft light flashing, wrong/dead key or fob, PATS/immobilizer
  lockout) — the *electrical energy* chain is fine; the ECU is refusing to crank. Owned by the
  `router-no-start-power` no-start decision tree (its security/immobilizer branch). This dossier's
  silent-no-crank mode (§3.10) covers only the energy-side causes (dead battery, open cable/ground,
  ignition switch, safety interlock) and hands security/immobilizer off to that router.
- **Single dead accessory / power windows / random multi-glitch electrical** →
  `electrical_testing_general` / `window_inop_testing` (subcats `accessory_doesnt_work`,
  `multiple_random_electrical_glitches`).
- **Belt/pulley NOISE diagnosed as a noise complaint** (whine/squeal not tied to charging) → the
  `noise` router (`high_pitched_whining_under_the_hood`, `squeaking_or_creaking`), though a charging
  belt squeal WITH a battery light stays here.
- **Power-steering EPS whine / EPS light** → `power_steering_eps_testing`.
- **High-voltage hybrid/EV traction battery** — out of US-shop scope for this corpus; log as backlog.

## 2. System primer (expert, CITED)

The 12 V system has two jobs: **start** (a big, brief current pulse to spin the engine) and **charge**
(a steady voltage to run accessories and replenish the battery once running).

**Battery.** A lead-acid (or AGM) battery stores the charge that cranks the engine and buffers the
system. Health is graded by resting voltage — ~12.6 V fully charged, ~12.2 V ≈ 50%, and below ~12.0 V
discharged [Fluke, "How to Test a Battery with a Multimeter", Tier 2, accessed 2026-07-18] — and by
cold cranking amps (CCA), the amperage a battery can deliver at 0 °F for 30 s while holding ≥ 7.2 V.
Cold weather hits starting from both sides: a battery's internal resistance rises as temperature
falls, lowering available output/capacity (and CCA), while cold thickens the engine oil so the
starter meets more resistance turning the engine over — which is why weak batteries surface first on
cold mornings [NAPA Know How, "What Are Cold Cranking Amps?", Tier 2 (parts-retailer technical
training), accessed 2026-07-18].

**Starter circuit.** Turning the key/pressing start energizes the solenoid, which throws the pinion
into the flywheel and closes the high-current path so the starter motor spins the engine. The starter
draws a very large current relative to accessories; lights and radio draw only a few amps. That
asymmetry is why a battery can light the dash brightly yet be unable to spin the starter. Slow or
intermittent cranking is most often **excessive resistance in the starter circuit** — corroded or
loose terminals, damaged cables, poor grounds — measurable as voltage drop: an acceptable total drop
across the circuit is **0.2–0.5 V**, and readings above that point to corrosion, loose terminals, or
damaged cables [Fluke, "How to Check Starter Circuit Voltage Drop with a Multimeter", Tier 2,
accessed 2026-07-18].

**Charging system.** The alternator, driven by the serpentine belt, produces AC that its internal
rectifier diodes convert to ~**14 V DC** to run the car and recharge the battery; the voltage
regulator holds output in band. A healthy alternator's output ripple is **≤ 50 mV AC** at idle under
load; a failed rectifier diode or damaged stator winding pushes ripple into the **0.30–0.50 V AC**
fault range and produces **flickering lights, battery-drain complaints, and erratic engine behavior**
[Fluke, "How to Test Alternator Ripple Voltage with a Multimeter", Tier 2, accessed 2026-07-18]. A
slipping or broken belt, or a worn alternator bearing, adds a whine/squeal and (belt broken) a dead
charging system.

**Common architectures / variants (US corpus):** conventional lead-acid + belt-driven alternator
dominates. Push-button start (customers say "push the button and nothing / it clicks"). Start-stop
systems use AGM/EFB batteries and sometimes a secondary/aux battery ("secondary battery", "aux
battery", "battery in back" — seen verbatim in the corpus). Hard-start-when-hot is a fuel/heat issue
(vapor lock / heat soak — see §3) more than an electrical one, but customers file it under "won't
start."

## 3. Failure-mode catalog (the diagnostic spine, CITED per mode)

### 3.1 Dead / weak battery — no crank, rapid clicking
- **Sensory signature:** `engine_running=wont_crank_just_clicks`; `lights_state=dim_or_flickering`
  (dash lights dim during the click) or `completely_dead`. Customer: "just clicks, click-click-click,
  won't turn over"; "jumped it and it fired right up."
- **Conditions:** worse cold; often follows lights-left-on or an aging battery.
- **Mechanism:** the solenoid partially pulls in, battery voltage collapses under the starter's huge
  current demand, the solenoid drops out and immediately retries — dozens of times a second = rapid
  clicking. Accessories still light because they draw little current. Grounded in the resistance/
  voltage-drop model [Fluke, starter voltage-drop, Tier 2, accessed 2026-07-18].
- **Drivability:** `not_drivable_needs_tow` until jumped/charged.
- **Misattribution:** customers say "my starter is bad" — but a rapid click with dimming lights is a
  **battery/connection** signature, not a starter. Route to test, don't assume the part.

### 3.2 Bad starter / severe connection — single click, no crank
- **Sensory signature:** `engine_running=wont_crank_just_clicks` but customer says "**one** loud
  click / clunk then nothing," with `lights_state=normal` (lights stay bright).
- **Mechanism:** the solenoid pulls in (one click) but the motor does not rotate — a failed starter,
  a fully dead battery, or severe circuit resistance; bright lights + single click points away from a
  merely weak battery toward starter/high-resistance [Fluke, starter voltage-drop, Tier 2, accessed
  2026-07-18].
- **Discriminator vs 3.1:** click **cadence** (single vs rapid) and **whether the lights dim** — the
  single best in-taxonomy cue lives in `lights_state`.

### 3.3 Slow / labored crank
- **Sensory signature:** `engine_running=slow_crank` ("rrr… rrr… rrr," "sounds tired," "cranks slow
  before it catches"); often `weather_condition=cold_weather`, `onset_timing=cold_start`;
  `lights_state=dim_or_flickering` while cranking.
- **Mechanism:** weak battery / low CCA, parasitic draw pulling it down, corroded terminals, or a
  starter drawing excess current — all raise circuit resistance or lower available capacity [Fluke,
  starter voltage-drop, Tier 2, accessed 2026-07-18].
- **Drivability:** usually `drivable_but_concerned` — it still starts.
- **Discriminator:** the engine **rotates** (just slowly) — separates it from 3.1/3.2 (no rotation)
  and from 3.7 (rotates at normal speed but won't fire).

### 3.4 Parasitic draw — battery drains while parked
- **Sensory signature:** car runs fine when driven, but is **dead after sitting** (overnight / a
  couple days); after a jump it runs all day. `recent_action=jump_started` (repeatedly); battery
  often already replaced once with no fix.
- **Conditions/modifiers:** correlated with sit duration; sometimes an aftermarket dash cam, remote
  starter, alarm, or stereo that keeps a module awake; occasionally a dome/trunk light that won't go
  out.
- **Mechanism:** a circuit continues drawing current after key-off (stuck relay, module not sleeping,
  aftermarket accessory). A failing alternator diode can also back-drain the battery, tying this mode
  to §3.6 [Fluke, alternator ripple, Tier 2, accessed 2026-07-18: bad diode → "battery-drain
  complaints"].
- **Misattribution:** "I need another new battery" — replacing the battery does not fix a draw.

### 3.5 Charge / battery warning light
- **Sensory signature:** `warning_light_named` includes "battery"/"charge"/"ALT";
  `warning_light_behavior=steady_on`; frequently with `lights_state=dim_or_flickering` and/or a belt
  `noise_descriptor=squealing_high_pitched`.
- **Mechanism:** charging voltage has fallen below the battery — failing alternator/regulator, a
  slipping/broken belt, or badly corroded terminals — so the car is now running on the battery alone
  and will eventually stall once it is exhausted (a dead/failing alternator no longer replenishes it)
  [NAPA Know How, "5 Alternator Issues and Warning Signs", Tier 2 (parts-retailer technical training),
  accessed 2026-07-18]. Time-to-stall varies widely with battery state and electrical load, so give no
  fixed number.
- **Drivability:** `drivable_but_concerned` → deteriorates to stranded.
- **Note:** the light is the *charging-side* icon (battery-shaped with + / −), distinct from the
  brightness complaint of §3.6.

### 3.6 Alternator failing — dim / flickering lights
- **Sensory signature:** `lights_state=dim_at_idle_brighten_when_revving` (the alternator cue) or
  `dim_or_flickering`; lights dip when a heavy load (AC, defroster, brake lamps) kicks on; sometimes
  a whine (`noise_descriptor=whining`) from a worn alternator bearing.
- **Mechanism:** low/erratic charging output from a failing regulator, worn bearing, slipping belt,
  or bad rectifier diode; ripple climbs with RPM/load and drives visible flicker [Fluke, alternator
  ripple, Tier 2, accessed 2026-07-18].
- **Discriminator:** the customer leads with **brightness changes**, not with a named icon (§3.5) and
  not with a single dead accessory (`accessory_doesnt_work`).

### 3.7 Died while driving — electrical
- **Sensory signature:** dim lights / dashboard going dark / battery light **before** the shutdown,
  radio cut out, steering went heavy, then "everything went dark like flipping a switch"; after it
  dies, `engine_running=wont_crank_just_clicks` or `no_sound_at_all`.
- **Mechanism:** total charging failure (dead alternator/broken belt) — with no charging output the
  engine runs on the battery until it is exhausted, then ignition/fuel/dash all quit at once [Fluke,
  "How to Test Alternator Ripple Voltage with a Multimeter", Tier 2, accessed 2026-07-18: charging
  failure → battery drain + erratic behavior; NAPA Know How, "5 Alternator Issues and Warning Signs",
  Tier 2, accessed 2026-07-18: a failed alternator leaves the car running on the battery until it dies].
- **Discriminator vs engine-side stall:** the **first** signs are electrical (dimming, battery light)
  — an engine-side stall sputters/stumbles under throttle with no electrical precursors.

### 3.8 Hard start when COLD (cranks, won't catch) — `performance`
- **Sensory signature:** after sitting overnight the engine **cranks at normal speed** but takes many
  seconds / several tries to fire, may run rough for the first minute. `engine_running=wont_start`
  (cranks but doesn't fire), `weather_condition=cold_weather`, `onset_timing=cold_start`.
- **Mechanism (our side, CITED):** the electrical overlap is a weak battery losing cold CCA while cold
  oil raises cranking load — a battery marginal at 60 °F can still spin the engine yet not carry a hard
  cold start [NAPA Know How, "What Are Cold Cranking Amps?", Tier 2, accessed 2026-07-18].
- **Mechanism (fuel/spark side — DELEGATED, not asserted here):** the cold-start fuel/spark causes
  (cold-enrichment fault, overnight fuel-pressure leak-down, coolant-temp-sensor, worn plugs) are owned
  by the `engine-controls-driveability` and `ignition-misfire` neighbors (and `fuel-system-evap` for
  pressure leak-down) — see §7. This dossier does not carry diagnostic claims for them; it only flags
  the Stage-1 service ambiguity (§8).
- **CRITICAL discriminator (inference trap):** "hard to start when cold" does NOT by itself mean slow
  crank or a weak battery. Only `engine_running=slow_crank` (customer said cranking is *slow*) routes
  to §3.3; a **normal-speed crank that won't catch** is this mode. If the customer states neither,
  the crank quality is **unknown** — ask, don't assume.

### 3.9 Hard start when HOT (cranks, won't catch after a short stop) — `performance`
- **Sensory signature:** cranks fine but won't fire right after driving and a brief stop (gas station,
  drive-through); fine again after cooling 20–30 min. `engine_running=wont_start`,
  `weather_condition=hot_weather`.
- **Mechanism:** **vapor lock / heat soak** — with the engine off and hot, fuel in the rail/lines
  near hot components vaporizes; the vapor must be re-pressurized to liquid for a clean hot restart
  [US Patent 4,635,606, "Fuel supply control system … capable of preventing vapor lock", Tier 1
  primary, accessed 2026-07-18; US Patent 5,775,281, "Determination of heat soak conditions", Tier 1
  primary, accessed 2026-07-18]. Also failing crank-position sensor or fuel-pressure regulator that
  break down with heat.
- **Discriminator:** trigger is **after driving / hot**, not after sitting overnight (§3.8), and the
  car dies on a *restart attempt*, not while driving (§3.7).

### 3.10 Silent no-crank — key turns, absolutely nothing
- **Sensory signature:** `engine_running=no_sound_at_all` ("turn the key and nothing, no click, no
  crank"); `lights_state` either `completely_dead` (fully flat battery) or `normal` (lights fine but no
  starter response — points away from the battery). Customer: "totally dead, no lights at all"; or
  "everything lights up but it does absolutely nothing when I turn the key."
- **Mechanism (energy-side, CITED):** no current reaches the starter at all — a fully dead battery, an
  open or badly corroded main cable / ground, a failed ignition switch, or an open safety interlock
  (neutral-safety switch on autos, clutch-pedal switch on manuals). All present as an open high-current
  path: excessive/​infinite resistance in the starter circuit measured as voltage drop [Fluke, "How to
  Check Starter Circuit Voltage Drop with a Multimeter", Tier 2, accessed 2026-07-18].
- **Security / immobilizer (DELEGATED):** a flashing anti-theft light or a wrong/dead key/fob producing
  a silent no-crank is an ECU crank-inhibit, NOT an energy fault → `router-no-start-power` security
  branch (see §1, §7). Ask whether the security light is on before assuming the energy side.
- **Drivability:** `not_drivable_needs_tow`.
- **Discriminator vs §3.1/§3.2:** total silence (no click at all) vs a click (rapid or single). Silence
  with **bright** lights points to the ignition switch / interlock / open control wire; silence with
  **dead** lights points to a flat battery or open main cable.

### 3.11 Overcharging — regulator overvoltage
- **Sensory signature:** `warning_light_named` = "battery"/"charge" or (corpus-seen) a plain-language
  dash message like **"service high voltage charging system"**, often with a lit `check engine`;
  sometimes a swollen/hot battery or a `smell_descriptor=rotten_egg_sulfur` (boiling electrolyte).
  `warning_light_behavior=steady_on`.
- **Mechanism:** the voltage regulator fails high, so the alternator pushes charging voltage above the
  normal ~12.3–14.4 V band and overcharges the battery — "cooking" it (boiling the electrolyte) and, in
  the extreme, burning wiring [NAPA Know How, "5 Alternator Issues and Warning Signs", Tier 2
  (parts-retailer technical training), accessed 2026-07-18: a bad regulator can drive too much voltage
  and cook/boil the battery; normal running output 12.3–14.4 V].
- **Drivability:** `drivable_but_concerned` — but the battery is being damaged and a rotten-egg smell /
  swollen case means stop soon.
- **Discriminator vs §3.5:** §3.5 is the common **under**-voltage charge-failure (running ON the
  battery); a "high voltage" message or a boiling/​swollen battery flips it to **over**-voltage. Both
  still route to `charging_starting_testing` — the tech tests charging output either way.

### 3.12 Starter pinion / flywheel grind on start
- **Sensory signature:** `noise_descriptor=grinding_metallic` **during a start attempt** ("horrible
  grinding when I go to start it, like the gears aren't catching"); the engine may fail to spin, spin
  intermittently, or grind then catch after a couple tries.
- **Mechanism:** worn starter pinion teeth or worn flywheel/ring-gear teeth fail to mesh, so the pinion
  grinds instead of turning the flywheel; repeated cranking rapidly worsens the tooth damage [NAPA Know
  How, "Why Do Good Starters Go Bad?", Tier 2 (parts-retailer technical training), accessed 2026-07-18:
  grinding/whirring on start = worn pinion/flywheel teeth not meshing; continued cranking worsens it].
- **Drivability:** `drivable_but_concerned` if it still catches; `not_drivable_needs_tow` if it won't.
- **Routing note (MIS-ROUTE RISK):** reported purely as an under-hood **noise** ("grinding sound") with
  no start context, this drifts to the noise router (`high_pitched_whining_under_the_hood` /
  grinding-underneath). A grinding tied to **the act of starting** is ours (`charging_starting_testing`)
  — the discriminator is "does the grinding happen only when you turn the key to start?" See §7 + the
  golden case. There is no dedicated subcategory; it maps to `wont_crank_just_clicks` (§8).

## 4. Customer-language lexicon (binds synonyms / positives)

Real-voice phrasings by mode. Provenance: `tekmetric` = this shop's corpus (near-verbatim OK);
`forum-paraphrase` = pattern paraphrased (copyright); `synthetic` = invented (flagged, capped ~30%).

**No-crank / just clicks (`wont_crank_just_clicks`):**
- "when i turn the key nothing happens no clicking, no cranking and all the interior lights dim and go off but the battery light stays on" — forum-paraphrase — needs-fact:engine_running (this one is `no_sound_at_all`/dead, not clicking)
- "every time I turn the ignition I just hear one click nothing else" — forum-paraphrase — single-click (§3.2)
- "Jeep does not start on initial push. Only on secondary push" — tekmetric — intermittent no-crank
- "just rapid clicking like a machine gun, jumped it and it fired right up" — synthetic

**Slow crank (`slow_crank_sluggish_start`):**
- "BATTERY SEEMS TO GIVE A SLOW CRANK, CHECK AND ADVISE" — tekmetric
- "CLIENT HAS BEEN NOTICING A WEAK/EXTENDED CRANK" — tekmetric
- "cranks very slow at startup … cranking amp @ 650 … concerned with the slow cranking" — forum-paraphrase
- "turn over slow as if the battery is about to die … 3 mornings out of 5" — forum-paraphrase (cold + intermittent)

**Battery drains overnight (`battery_drains_overnight`):**
- "CLIENT HAD TO JUMP START VEHICLE (Sat for awhile)" — tekmetric
- "every time we have cold weather my car battery will be dead in the mornings … jump the car … next morning the battery is dead again" — forum-paraphrase
- "if you leave it sit … 48 hours, the battery is totally dead … Replaced the battery but this did not fix" — forum-paraphrase (replaced-once-no-fix = draw)
- "3 times in the last 2 days, my car has needed a jumpstart … new battery later, my car wouldn't start again" — forum-paraphrase

**Charge / battery light (`battery_charging_light`):**
- "dash battery light came on" — tekmetric
- "BATTERY LIGHT IS ON" / "BATTERY LIGHT ON. TESTING AUTH $89" — tekmetric
- "CHECK ENGINE LIGHT ON, message service high voltage charging system" — tekmetric
- "quick blink of the battery light … now coming on a lot and staying on longer" — forum-paraphrase

**Dim / flickering (`dim_or_flickering_lights`):**
- "headlights & dash lights flicker almost all the time … voltage at battery with lights flickering 14.2 VDC" — forum-paraphrase
- "headlights pulse brighter and dimmer at stoplights, brighten when I rev" — synthetic (alternator cue)

**Died while driving — electrical (`car_died_while_driving_electrical`):**
- "DIED WHILE DRIVING. ALL WARNING LIGHTS CAME ON AND THEN VEHICLE JUST SHUT OFF" — tekmetric
- "battery and brake light came on … car can no longer travel faster than 5mph … Finally it died" — forum-paraphrase
- "keeps dying when Im driving … Battery is new and alternator tested good" — forum-paraphrase (overlaps §3.4/3.7)

**Hard start cold (`hard_to_start_when_cold`):**
- "AFTER GETTING GAS HAS TO CRANK VEHICLE MULTIPLE TIMES TO GET STARTED" (note: this one is post-fuel-fill, hot-ish; see §3.9) — tekmetric
- "just started having an issue with the ignition when it gets pretty cold … engine will crank but not start" — forum-paraphrase (cranks, won't fire)

**Hard start hot (`hard_to_start_when_hot`):**
- "It hesitates to turn back on if I have turned it off while running short errands" — tekmetric
- "won't start after the final stop … 20 minutes in the store … it would turn over a couple of times before finally dying … got a jump" — forum-paraphrase (mixed — has a jump, watch overlap)

**Starter / belt noise on start (grind/screech — watch the noise-router boundary, §3.12):**
- "MAKING SCREACHING NOISE WHEN STARTING (had alternator, tensioner pulley replaced, still hears
  noise)" — tekmetric — belt/tensioner screech during start (charging-belt side)
- "grinding noise when i go to start it, like the gears arent catching" — synthetic — starter
  pinion/flywheel grind (§3.12)

**Mixed symptom+request / work-order (route carefully):**
- "TEST BATTERY (JUST WANT TO MAKE SURE IT IS OK)" — tekmetric — request-type → `battery_test`
- "staring and charging system" / "STARTING AND CHARGING SYSTEM TESTING AUTH 89" — tekmetric — staff work-order line → **advisor / null-route**

## 5. Differential & discriminating questions (binds required_facts + slots)

The spine slot for this whole system is **`engine_running`** — one question separates most modes:

| Confusable pair | ONE best question | Slot + value that decides |
|---|---|---|
| no-crank/clicks (§3.1/3.2) vs slow-crank (§3.3) | "When you turn the key, does the engine **turn over at all**, or do you just hear clicking/nothing?" | `engine_running` = `wont_crank_just_clicks` vs `slow_crank` |
| dead-battery click (§3.1) vs bad-starter click (§3.2) | "Is it **rapid** clicking with the dash lights **dimming**, or **one** click with the lights staying **bright**?" | `lights_state` = `dim_or_flickering` (battery) vs `normal` (starter) |
| slow-crank (§3.3) vs hard-start-cold (§3.8) | "Does it crank **slowly** (rrr-rrr), or crank at **normal speed** but not catch/fire?" | `engine_running` = `slow_crank` vs `wont_start` |
| charging-side no-start (§3.1/3.3) vs FUEL/SPARK no-start (`no_start_testing`) | "Does the engine **crank normally** but not fire, or does it barely/not crank?" | `engine_running` = `wont_start` (→ no_start_testing) vs `wont_crank_just_clicks`/`slow_crank` (→ charging_starting_testing) |
| drains-overnight (§3.4) vs no-crank-today (§3.1) | "Is the car **fine all day** and only dead **after sitting**, or dead **right now** with no pattern?" | `recent_action=jump_started` + "dies when parked" narrative vs one-off `engine_running=wont_crank_just_clicks` |
| died-driving electrical (§3.7) vs engine stall (`stalling_while_driving_under_load`) | "**Before** it died, did the **lights/dash dim** or the **battery light** come on, or did the engine **sputter/stumble** first?" | `lights_state`/`warning_light_named` present → electrical; absent + `engine_running=stalls` → performance |
| hard-start-cold (§3.8) vs hard-start-hot (§3.9) | "Is it hard to start **after sitting overnight** (cold), or **right after driving** and a short stop (hot)?" | `weather_condition` = `cold_weather` vs `hot_weather` |
| battery-light (§3.5) vs dim-lights (§3.6) | "Is there a **battery-shaped warning light** on the dash, or are the **headlights just getting dim** with no specific light?" | `warning_light_named` present → `battery_charging_light`; brightness-only → `dim_or_flickering_lights` |

**Slot gaps surfaced here** (see §9):
- `battery_age` — 3 questions (q528, q537, q877) literally ask "how old is the battery — less than 2
  years, 2 to 4 years, more than 4 years, or not sure." Customers DO state this ("battery is new," "few
  months old," "replaced it last year"). No current slot holds it → **new-slot proposal** (still meets
  the ≥3-question rule). NOTE: q389 ("jump-started recently, or replaced the battery in the last couple
  of years?") already carries `required_facts=[recent_action]` and is only partly a battery-age
  question, so it is EXCLUDED from the battery_age unlock set.
- `recent_action` has no value for an **aftermarket electrical install** (dash cam / remote starter /
  alarm / added stereo) — the key parasitic-draw follow-up (q534) — → **slot-value proposal**.

## 6. Warning lights & DTC surface

- **Battery / charge light** — red or amber battery icon (rectangle with + / −), or letters
  "BATT" / "ALT" / "CHARGE." Solid = charging failure in progress. Customer nicknames: "battery
  light," "little battery symbol," "battery thing with the plus and minus," "charge light," "ALT
  light." → `warning_light_named` = "battery" / "charge" / "alt"; `warning_light_behavior=steady_on`.
- **Battery light appearing WITH many others** (all lights flare then car dies) — still a charging
  failure but presents as a cascade → `multiple_warning_lights_at_once`;
  `warning_light_behavior=multiple_lights_at_once`.
- **"high voltage charging system" message** (seen in corpus) — overcharge/regulator side; some
  vehicles show a CEL for charging DTCs (P0562 low system voltage / P0620 generator control) — but
  customers only report the plain-language dash message; keep to `warning_light_named`.
- Not a light this system owns: check-engine for fuel/spark hard-starts routes on the symptom, not
  the CEL.

## 7. Confusable neighbors (cross-system)

- **`no_start_testing` (fuel/spark no-start)** — THE primary confusable (see §5). Discriminator:
  `engine_running=wont_start` (cranks normal, won't fire) is *their* signature; ours is no-crank /
  slow-crank / dead / charging failure. When the customer says only "won't start" with no crank
  detail → genuinely ambiguous, hedge both (§ proposals `stage1.hedge.add`).
- **`stalling_while_driving_under_load` (engine performance)** — vs our §3.7 died-while-driving.
  Discriminator: electrical precursors (dimming/battery light) vs engine sputter.
- **`accessory_doesnt_work` / `multiple_random_electrical_glitches` (electrical general)** — a single
  dead accessory or scattered glitches, NOT battery/charging. Ours leads with cranking or charging.
- **`power_steering_eps_testing`** — a whine under the hood can be EPS pump, not alternator; if the
  customer ties the whine to a **battery light** or **dim lights**, it's ours; if to **heavy
  steering**, it's EPS. (Corpus case cs-004 is acceptable to either.)
- **`high_pitched_whining_under_the_hood` (noise)** — belt/alternator-bearing whine reported purely
  as a noise with no charging symptom routes to noise; with a battery light it's ours.
- **Noise router (grinding/whirring) vs starter grind on start (§3.12)** — a `grinding_metallic` under
  the hood reported as a free-standing noise drifts to the noise router; a grind that happens **only
  when turning the key to start** is a starter pinion/flywheel fault and is ours
  (`charging_starting_testing`). Discriminator: "does it grind ONLY when you try to start it?"
- **`engine-controls-driveability` / `ignition-misfire` / `fuel-system-evap` (cold hard-start
  fuel/spark)** — the cold-start enrichment / fuel-pressure-leak-down / worn-plug side of §3.8 is
  theirs; our side is only the weak-battery/cold-CCA overlap. Genuinely ambiguous Stage-1 service
  (§8) → hedge.

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| Dead/weak battery, rapid click (§3.1) | charging_starting_testing | electrical | `wont_crank_just_clicks` | good |
| Bad starter, single click (§3.2) | charging_starting_testing | electrical | `wont_crank_just_clicks` | good (one slug covers both click patterns; `lights_state` splits them) |
| Slow crank (§3.3) | charging_starting_testing | electrical | `slow_crank_sluggish_start` | good |
| Parasitic draw (§3.4) | charging_starting_testing | electrical | `battery_drains_overnight` | good |
| Charge/battery light (§3.5) | charging_starting_testing | warning_light | `battery_charging_light` | good |
| Alternator dim/flicker (§3.6) | charging_starting_testing | electrical | `dim_or_flickering_lights` | good |
| Died driving, electrical (§3.7) | charging_starting_testing | electrical | `car_died_while_driving_electrical` | good |
| Hard start cold (§3.8) | no_start_testing / charging_starting_testing | performance | `hard_to_start_when_cold` | weak — cause spans fuel/spark AND weak battery; Stage-1 service genuinely ambiguous |
| Hard start hot (§3.9) | no_start_testing | performance | `hard_to_start_when_hot` | good (fuel/heat) |
| Silent no-crank (§3.10) | charging_starting_testing | electrical | `wont_crank_just_clicks` | good — `engine_running=no_sound_at_all` variant (same slug as the click modes; `lights_state` splits battery vs switch/interlock). Security/immobilizer no-crank is delegated to `router-no-start-power`. |
| Overcharge / regulator overvoltage (§3.11) | charging_starting_testing | warning_light | `battery_charging_light` | good — the over-voltage side of the same charge-light slug ("high voltage charging system" message is corpus-attested) |
| Starter grind on start (§3.12) | charging_starting_testing | electrical | `wont_crank_just_clicks` | weak — no dedicated slug; primary risk is MIS-ROUTE to the noise router. Discriminator: grinding tied to the START attempt (see §7 + golden case + hedge). |
| "Just test my battery" request | battery_test | electrical/warning_light | (no subcat; service-direct) | good — `customer_request_type` |

**No NEW subcategory needed** — the eight symptom slugs cover this system well; the three modes added
in this pass (silent no-crank §3.10, overcharge §3.11, starter grind §3.12) all fold onto existing
slugs (`wont_crank_just_clicks`, `battery_charging_light`) rather than needing new ones. Stage-2
enrichment is already populated and strong. The gaps are Stage-1 (empty `example_keywords`), a hedge
for the no_start ↔ charging boundary + the grind ↔ noise-router boundary, and two fact-slot gaps (§9).
No catalog/service proposal.

## 9. Fact-slot audit

**Slots this system uses (of 29):** `engine_running` (spine), `lights_state`, `recent_action`,
`warning_light_named`, `warning_light_behavior`, `weather_condition`, `started_when`,
`noise_descriptor`, `smell_descriptor` (burning-electrical on a dead alternator), `speed_band`,
`drivable_state`, `accessory_affected`.

**Values customers actually state (corpus evidence):**
- `engine_running`: `wont_crank_just_clicks` ("just clicks"), `slow_crank` ("slow crank," "weak/
  extended crank"), `wont_start` ("crank but not start"), `died_while_driving` ("died while driving"),
  `no_sound_at_all` ("nothing happens, no clicking no cranking").
- `lights_state`: `dim_or_flickering`, `dim_at_idle_brighten_when_revving` ("brighten when I rev"),
  `completely_dead`.
- `recent_action`: `jump_started` ("had to jump it"), `battery_or_alternator_work` ("since alternator
  replacement," "AAA installed battery").

**Missing / proposed:**
1. **NEW SLOT `battery_age`** (≥3-question rule met — q528, q537, q877 all literally ask it; q389 is
   excluded because it already carries `recent_action`). Values:
   `new_under_2yr`, `2_to_4yr`, `over_4yr`, `just_replaced`, `unsure`. Literal cues only: "battery is
   new," "battery is X years old," "just put a new battery in," "replaced the battery last year,"
   "few months old." Distinct from `recent_action=battery_or_alternator_work` (that is *work just
   done*; `battery_age` is the customer stating the battery's age/recency even with no shop work).
2. **`recent_action` value `aftermarket_electrical_install`** — dash cam / remote starter / alarm /
   added stereo. Unlocks the parasitic-draw follow-up q534. Literal cues: "put in a dash cam,"
   "installed a remote starter," "added an alarm," "aftermarket stereo."
3. `lights_state=dim_at_idle_brighten_when_revving` already exists and is the crisp alternator cue —
   ensure `dim_or_flickering_lights` questions (q540) keep `required_facts=[lights_state]`.

**Over-asking note (L5):** `battery_drains_overnight` has 6 of 7 questions with empty `required_facts`
(q532, q533, q534, q535, q536, q537). Most are genuine observational follow-ups that can't be
pre-answered from free text (interior-light-still-on, sit-duration, accessories-staying-on-after-key-off)
→ mark `question.intentionally_empty`. q534 becomes skippable once `aftermarket_electrical_install`
exists; q536 ("radio/headlights/wipers staying on after key-off?") stays intentionally-empty (no slot
holds it). Every one of the six empty questions is now terminated by an op in proposals.yaml.

## 10. Sources

**Diagnostic authority (Tier 1/2):**
- Fluke, "How to Check Starter Circuit Voltage Drop with a Multimeter" — Tier 2 (test-equipment mfr
  technical training). Acceptable total starter-circuit drop 0.2–0.5 V; above = corrosion/loose/
  damaged cables → slow/no crank. https://www.fluke.com/en-us/learn/blog/digital-multimeters/how-to-check-starter-circuit-voltage-drop-with-a-multimeter — accessed 2026-07-18.
- Fluke, "How to Test Alternator Ripple Voltage with a Multimeter" — Tier 2. ~14 V DC charging;
  ripple ≤ 50 mV AC healthy; 0.30–0.50 V AC = bad diode/stator → flickering lights, battery drain,
  erratic behavior. https://www.fluke.com/en-us/learn/blog/digital-multimeters/how-to-test-alternator-ripple-voltage-with-a-multimeter — accessed 2026-07-18.
- Fluke, "How to Test a Battery with a Multimeter" — Tier 2. Resting-voltage / CCA grading; cold
  weather effect. https://www.fluke.com/en-us/learn/blog/digital-multimeters/how-to-test-a-battery-with-a-multimeter — accessed 2026-07-18.
- US Patent 4,635,606, "Fuel supply control system for internal combustion engines, capable of
  preventing vapor lock" — Tier 1 primary. Hot-restart vapor-lock mechanism + fuel-pressure re-
  condensing. https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4635606 — accessed 2026-07-18.
- US Patent 5,775,281, "Determination of heat soak conditions" — Tier 1 primary. Post-shutdown
  fuel-rail heat soak → vapor. https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5775281 — accessed 2026-07-18.
- NAPA Know How, "What Are Cold Cranking Amps?" — Tier 2 (parts-retailer technical training). CCA =
  amps at 0 °F for 30 s ≥ 7.2 V; cold raises battery internal resistance (lower output/capacity) and
  thickens oil (more starter load). https://knowhow.napaonline.com/what-are-cold-cranking-amps/ —
  accessed 2026-07-18 (content via WebSearch summary; the site returns 403 to direct WebFetch).
- NAPA Know How, "5 Alternator Issues and Warning Signs" — Tier 2. Normal running output 12.3–14.4 V;
  a bad voltage regulator can overcharge and "cook"/boil the battery; a dead alternator leaves the car
  running on the battery until it dies. https://knowhow.napaonline.com/5-alternator-issues-warning-signs-stay-ahead-potential-problem/
  — accessed 2026-07-18 (content via WebSearch summary; 403 to direct WebFetch).
- NAPA Know How, "Why Do Good Starters Go Bad?" — Tier 2. Grinding/whirring on start = worn pinion or
  flywheel/ring-gear teeth not meshing; repeated cranking worsens the damage. https://knowhow.napaonline.com/why-do-good-starters-go-bad/
  — accessed 2026-07-18 (content via WebSearch summary; 403 to direct WebFetch).

**Tier-classification note (policy annotation, not a diagnostic claim):** `source-policy.md`'s Tier-2
list names "parts-manufacturer technical training"; Fluke (test-equipment maker) and NAPA (parts
retailer/distributor) technical content are treated here as **Tier-2-equivalent** (free, symptom-rigorous
vendor technical training). The two USPTO patents (4,635,606; 5,775,281) are primary engineering
disclosures, not in source-policy's explicit Tier-1 enumeration (OEM SI / SAE / ASE / Bosch / Mitchell);
they are treated as **Tier-1-equivalent primary sources**. Both patents were verified real with matching
titles/mechanisms; all Fluke/NAPA numeric claims were verified against the source text. This is a
classification annotation for Wave C — no fabricated authority.

**Linguistic authority (customer voice — never cited for diagnosis):**
- Tekmetric corpus `scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json` (this shop,
  500 labeled) — provenance `tekmetric`.
- `scheduler-app/scripts/eval/real-concerns-forums.json` — paraphrased patterns only, provenance
  `forum-paraphrase`.
- Live DB enrichment (subcategory descriptions/positives/negatives/synonyms + questions) pulled
  2026-07-18 to sharpen rather than duplicate.

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode (3.1–3.12, incl. the three added this pass) has a Tier 1/2 diagnostic cite
  (Fluke ×3, NAPA ×3, USPTO ×2); §3.8's fuel/spark causes are DELEGATED to neighbors, not asserted here.
- [x] Every §4 prose entry and every lexicon.yaml entry carries provenance. Synthetic share: §4 prose
  = 3 synthetic of ~26 (well under cap); lexicon.yaml = 10 of 41 overall (~24%) and ≤ 25% in every one
  of the 9 subcategory groups (verified per-group after the 2026-07-18 revision — no group over ~30%).
- [x] Every §8 row maps mode → service → category → slug with a fit verdict; no NO-FIT (no subcat/
  catalog proposal needed).
- [x] Confusable pair `no_start_testing` ↔ `charging_starting_testing` addressed in §5 + §7 + a
  `stage1.hedge.add` op, keyed on `engine_running`.
- [x] Fact-cue literalness respected — "hard to start when cold" does NOT set crank-speed or battery
  facts (inference-trap golden case included).
- [x] All Stage-1 keyword proposals ≥ 2 tokens or domain tokens; all negative examples name
  `routes_to`.
- [x] Slot proposals meet the ≥3-question rule (`battery_age`: 3 literal questions q528/q537/q877;
  q389 excluded — already carries `recent_action`) or are value-adds to an existing slot (`recent_action`).
- [x] ≥ 8 golden cases incl. 1 inference-trap + 1 null-route + 1 request-type — in proposals.yaml.
