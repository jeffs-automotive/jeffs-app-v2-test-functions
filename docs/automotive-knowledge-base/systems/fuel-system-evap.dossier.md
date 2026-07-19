# Fuel & EVAP / Emissions — diagnostic dossier
slug: fuel-system-evap   date: 2026-07-18   binds_services: [no_start_testing, check_engine_light_testing]   binds_categories: [smell, performance, smoke, warning_light]

> Scope note for the classifier: this system is **symptom-scattered** across the taxonomy. Its real-world
> knowledge lands in `smell/gasoline_fuel_smell`, `smoke/black_smoke_from_tailpipe`,
> `warning_light/check_engine_light` (loose-cap / EVAP / rich / lean codes), and a large slice of the
> `performance/*` pool (hard-start, stall, low-power, rough-idle, misfire, surge). The dossier sharpens the
> existing enrichment on those slugs, adds real-voice lexicon, fixes one routing gap, and flags **EVAP
> catalog depth** — there is no subcategory for "can't put gas in / pump keeps clicking off" even though the
> corpus contains it (tka-046).

---

## 1. Scope & boundaries

**In scope** — the fuel-delivery and evaporative-emissions systems, and the drivability/smell/smoke/CEL
symptoms they produce:

- **Fuel delivery:** in-tank fuel pump + level sender, fuel filter/strainer, fuel lines, fuel rail, fuel
  pressure regulator, port or direct injectors, high-pressure pump (GDI), returnless vs return systems.
  (The fuel-**level sender** is in-scope hardware, but a gas-gauge complaint presents as an instrument-cluster
  issue — see FM-13 and §7 cross-ref.)
- **Air/fuel metering & trim:** MAF/MAP sensor, throttle body / IAC, upstream & downstream O2 (or A/F ratio)
  sensors, short- and long-term fuel trim, the ECU's closed-loop correction.
- **EVAP / evaporative emissions:** fuel cap, filler neck & check valve, fuel tank pressure sensor, charcoal
  (carbon) canister, purge valve/solenoid, vent valve/solenoid, EVAP hoses, canister-vent filter.
- **The customer-visible symptoms of the above:** raw-gasoline smell, black (rich) tailpipe smoke, hard
  starting hot & cold, cranks-but-won't-fire no-start, stalling, low power, rough idle / surge / misfire,
  bad/contaminated-fuel symptoms after a fill-up, and the check-engine light for loose-cap / EVAP / rich /
  lean / misfire codes.

**Out of scope** (each owned by a neighbor dossier — cross-ref its real `systems/` slug):

| Out-of-scope symptom | Why it's not us | Owner dossier → subcategory |
|---|---|---|
| WHITE thick tailpipe smoke + sweet smell | coolant into combustion, not fuel | `cooling-system` → `white_smoke_from_tailpipe` / `sweet_smell_maple_syrup_antifreeze` |
| BLUE/GRAY tailpipe smoke + burnt-oil smell | oil burn, not rich fuel | `engine-lubrication-oil` → `blue_or_gray_smoke_from_tailpipe` / `burnt_oil_smell` |
| **Won't crank — just clicks / no sound** | starter/battery, engine never rotates | `starting-charging` → `wont_crank_just_clicks` (we own cranks-but-**won't-fire**) |
| Slow crank / needs a jump / battery keeps dying | charging system | `starting-charging` → `slow_crank_sluggish_start`, `battery_drains_overnight` |
| ROTTEN-EGG / sulfur smell as the lead complaint | catalytic-converter H2S | `exhaust-emissions` → `rotten_egg_sulfur_smell` (we route rich→cat as a cause, but the SLUG is theirs) |
| Exhaust/tailpipe (smoky-burnt) smell in cabin | exhaust leak / manifold, CO safety | `exhaust-emissions` → `exhaust_fumes_inside_the_cabin` |
| Misfire caused by ignition (coil/plug/wire) | ignition, not fuel | shared with `ignition-misfire`; the SLUG `engine_misfire_or_bucking_feeling` is jointly fed |
| Hesitation that is actually transmission shift feel | driveline | `automatic-transmission` / `manual-trans-clutch` → `transmission_testing` |
| Gas gauge reads wrong / fuel light on with fuel | instrument-cluster surface | `body-electrical-accessories` (level-sender hardware is ours; the gauge complaint routes there — FM-13) |

The single hardest boundary calls (owned in §5/§7): **gasoline smell vs. exhaust/rotten-egg smell**, and
**black (rich) smoke vs. blue (oil) / white (coolant) smoke**.

---

## 2. System primer (expert, cited)

**Fuel delivery.** A modern port-injected gasoline engine draws fuel from an in-tank electric pump through a
filter to the fuel rail, where injectors meter it against a regulated pressure (typically ~40–60 psi port,
much higher on GDI). Most 2000s+ vehicles are *returnless* (pressure regulated at the tank or by the ECU),
so a failing pump or clogged filter shows up as fuel-pressure/volume starvation under load [SAE J1930 fuel-system
terminology, Tier 1; Bosch *Automotive Handbook* 10th ed., "Gasoline-engine fuel injection," Tier 1; Halderman,
*Automotive Technology*, "Fuel Delivery & Injection," Tier 2].

**Air/fuel metering & trim.** The ECU targets stoichiometric ~14.7:1 in closed loop, using MAF/MAP + O2
feedback and adjusting **fuel trim**. Short-term fuel trim (STFT) is the instantaneous correction; long-term
(LTFT) is the learned offset. A large positive trim means the ECU is *adding* fuel (sensed lean); large
negative means *pulling* fuel (sensed rich). Rich/lean DTCs (P0171/P0174 lean, P0172/P0175 rich) and misfire
codes (P0300–P030x) are the diagnostic surface [SAE J2012 DTC definitions, Tier 1; Halderman, "Fuel Trim
Diagnosis," Tier 2; Standard Motor Products / Blue Streak fuel-trim & MAF training, Tier 2].

**EVAP / evaporative emissions.** Regulation (US EPA / CARB, 40 CFR Part 86) requires that fuel-tank vapors
never vent to atmosphere. The system seals the tank, routes vapor to a **charcoal canister** for storage, and
later the ECU opens the **purge valve** so intake vacuum draws stored vapor into the engine to be burned; a
**vent valve** lets the canister breathe and seals it for leak self-tests. Five core parts: fuel tank,
**fuel cap**, vent valve, purge valve, charcoal canister [SAE J1930 EVAP terminology, Tier 1; Bosch
*Automotive Handbook*, evaporative-emissions control, Tier 1]. Because the system is a sealed pressure/vacuum
volume, the OBD-II monitor runs a leak self-test; the most common failure is simply a
**loose/missing/cracked gas cap**, which the customer notices only as a check-engine light [SAE J2012: P0455
gross leak, P0442 small leak, P0446 vent control, P0457 loose fuel cap, Tier 1].

**Notable variants (US-market calibration).** Port fuel injection (PFI) dominates the shop's older mix;
gasoline direct injection (GDI) and turbo-GDI are increasingly common and add a high-pressure pump and
carbon-intake concerns; flex-fuel and returnless systems are common. Diesel is rare in this shop's corpus but
matters for the **black-smoke** differential (a small puff of black under hard acceleration on a diesel is
often normal turbo enrichment; thick/at-idle black smoke is not) [Bosch *Automotive Handbook*, diesel
combustion, Tier 1]. Hybrids run the same EVAP/fuel-injection principles with additional sealed-tank designs;
don't over-index on them — the corpus rarely states powertrain.

---

## 3. Failure-mode catalog (the diagnostic spine — cited per mode)

Slot vocabulary in `code`. "Misattribution" = how customers mislabel it.

### FM-1 — Loose / cracked / missing fuel cap → EVAP gross-leak CEL
- **Signature:** `warning_light_named=check engine`, `warning_light_behavior=steady_on`, `recent_action=fuel_fill_up`. Car drives normally.
- **Modifiers:** onset right after a fill-up; may clear itself after several drive cycles once the cap seals.
- **Severity:** `drivable_state=drivable_normally`. Emissions only.
- **Misattribution:** "the light means my engine is broken" — usually just the cap [SAE J2012 P0455/P0457, Tier 1].

### FM-2 — EVAP leak elsewhere (purge/vent valve, canister, hose, tank) → CEL, sometimes gas smell
- **Signature:** `warning_light_named=check engine` `steady_on`; may add `smell_descriptor=gasoline_or_fuel` (leaking vapor). Small leaks (P0442/P0456) need a smoke machine to find.
- **Severity:** drivable; a stuck-open purge can cause rough idle/stall (below).
- **Misattribution:** confused with a fuel-*liquid* leak; EVAP is a *vapor* leak [SAE J2012 P0442/P0446/P0455/P0456, Tier 1; Halderman, EVAP diagnosis, Tier 2].

### FM-3 — Raw fuel leak (line, injector o-ring, rail, filler/tank) → gasoline smell, possible puddle
- **Signature:** `smell_descriptor=gasoline_or_fuel`; zone `sound_or_smoke_location_zone=under_hood` or `inside_cabin_general`; sometimes a `fluid` puddle under the car. Sharp/fresh pump-like smell (unburned hydrocarbon), NOT smoky.
- **Severity:** fire-and-fumes hazard → `drivable_state=drivable_but_concerned` at minimum.
- **Misattribution:** "exhaust smell" — but raw gas is fresh/sharp, exhaust is smoky/burnt [Halderman, fuel-line service & fire safety, Tier 2; SAE J1930 terminology, Tier 1].

### FM-4 — Stuck-open purge valve → vacuum leak: rough idle / surge / stall / hard-start
- **Signature:** `engine_running=rough_idle|surging|stalls`; often `onset_timing=at_stop|when_idling`; may pair with a faint gas smell or an EVAP code.
- **Severity:** drivable but annoying; can stall at idle.
- **Misattribution:** "vacuum leak" generically; the purge solenoid is a common specific cause [Halderman, EVAP purge diagnosis, Tier 2; SAE J2012 P0441/P0496 purge-flow, Tier 1].

### FM-5 — Trouble fueling: pump clicks off early / gas spits back
- **Signature:** customer literally can't fill the tank — "gas squirts back out", "pump keeps shutting off". Cause is a blocked EVAP vent path, saturated/failed charcoal canister, or a fuel-filler/rollover check-valve fault. **No current subcategory holds this** (see §8, subcategory proposal).
- **Severity:** drivable, inconvenient; may set an EVAP code.
- **Misattribution:** "bad gas pump at the station" — it's the car's vent/canister [SAE J1930 EVAP/canister terminology, Tier 1; Halderman, EVAP canister & fill-control diagnosis, Tier 2]. **Corpus demand:** tka-046 ("CAN NOT FILL WITH GAS. WHEN TRYING TO REFUEL GAS SQUIRTS BACK OUT") was judged `check_engine_light_testing` with a **null subcategory**. tka-137 ("NOW WHEN FILLING UP GAS IT COMES BACK OUT AFTER $14") is linguistically the same fill-failure but was judged `after_recent_service_or_repair_work` **because its text leads with "WE REPLACED FUEL PUMP LAST SERVICE"** — the judges keyed on the recent-repair context, not the fueling symptom. So the honest demand signal for the missing slug is **one clean null-subcategory case (tka-046)** plus a second case (tka-137) whose fill-failure symptom is currently masked by a recent-service label.

### FM-6 — Running rich → BLACK tailpipe smoke, raw-fuel smell, worse mileage
- **Signature:** `smoke_color=black`, often `onset_timing=when_accelerating`, `smell_descriptor=gasoline_or_fuel`, dropping fuel economy, possible `warning_light` (P0172 rich). Rich = too much fuel for the air.
- **Causes:** dirty/over-reading MAF, a leaking/dribbling injector, **high fuel-rail pressure from a regulator stuck CLOSED or a restricted return line**, a **ruptured fuel-pressure-regulator diaphragm leaking fuel into the intake through its vacuum reference line**, a clogged air filter, or a lazy/failing O2 sensor. (Note: a regulator stuck **OPEN** *drops* rail pressure and drives the mixture **LEAN** — that presentation is FM-7, not here.)
- **Severity:** drivable_but_concerned; prolonged rich fouls the cat.
- **Misattribution:** panic "engine blowing up"; also mis-sorted against oil-blue / coolant-white smoke [SAE J2012 P0172 "system too rich," Tier 1; Halderman, rich-mixture diagnosis & fuel trim, Tier 2; Standard Motor Products fuel-pressure-regulator training, Tier 2].

### FM-7 — Running lean → misfire / rough idle / hesitation / stall (vacuum leak, weak pump, dirty MAF, clogged injector, regulator stuck open)
- **Signature:** `engine_running=rough_idle|misfiring|surging`; `onset_timing=when_accelerating|when_idling`; positive fuel trim / P0171 lean; may hesitate or stumble. Usually **no** visible smoke.
- **Severity:** drivable to stalling.
- **Misattribution:** "transmission slipping" for the hesitation; "spark plugs" for the misfire (can be either) [SAE J2012 P0171/P0300, Tier 1; Halderman lean-mixture & misfire diagnosis, Tier 2].

### FM-8 — Failing fuel pump / clogged filter → low power, stall under load, cranks-but-won't-start
- **Signature:** `engine_running=stalls|wont_start|died_while_driving`; `speed_band=highway` or `onset_timing=when_accelerating`; `low_power`. Classic pattern: sputter → lose power → dies at speed; then cranks-but-won't-fire.
- **Severity:** `not_drivable_needs_tow` / `stranded_now` at the extreme.
- **Misattribution:** "the car just died, must be electrical/battery" — but it cranks fine, just won't fire [SAE J2012 P0087 fuel-rail pressure too low, Tier 1; Halderman, fuel-pump & pressure diagnosis, Tier 2].

### FM-9 — Hard-start COLD (fuel bleed-down, cold-start enrichment, weak pump check-valve)
- **Signature:** `onset_timing=cold_start`, `engine_running=slow to fire / wont_start on first try`, `weather_condition=cold_weather` sometimes; cranks many seconds, may run rough for the first minute, fine once warm. Distinct from battery slow-crank (engine *does* spin normally here).
- **Severity:** drivable, worsening.
- **Misattribution:** "battery" — but the crank speed is normal [Halderman, cold-start & residual-pressure diagnosis, Tier 2; SAE J1930, Tier 1].

### FM-10 — Hard-start HOT / vapor lock / heat soak (fuel boiling near hot components, weak regulator, hot injector/coil)
- **Signature:** `onset_timing=after_warming_up`, hard restart after a short stop (gas station, drive-through), `weather_condition=hot_weather`; cranks fine, slow to catch; fine again after cooling 20–30 min. When it literally follows a fuel stop, `recent_action=fuel_fill_up` (e.g. tka-020).
- **Severity:** drivable, intermittent.
- **Misattribution:** "starter going bad" — but it cranks; it's fuel/heat [Halderman, hot-restart / vapor lock, Tier 2; SAE J1930, Tier 1].

### FM-11 — Failed emissions test / readiness monitors not set
- **Signature:** customer request framing — "won't pass smog/inspection", "monitors not ready", "need a drive cycle". Often a *recent* CEL repair; the ECU hasn't re-run its self-tests. Not a live drivability fault.
- **Severity:** drivable_normally.
- **Misattribution:** "the shop didn't fix it" — monitors just need drive cycles [SAE J1979 OBD-II readiness-monitor definitions, Tier 1; US EPA / CARB I/M program requirement (40 CFR Part 85/86), Tier 1 regulatory reference]. **Corpus demand:** tkc-127 ("Evap and Cat monitors still not set … bring it back for the retest"), and tkc-002 ("believe it is an EVAP issue").

### FM-12 — Contaminated / bad fuel / misfueling (water or debris in tank, wrong grade, diesel-in-gas)
- **Signature:** onset shortly after a fill-up — `recent_action=fuel_fill_up`; `engine_running=rough_idle|misfiring|stalls|wont_start`; chugging/sputter; sometimes CEL; the customer often names the station.
- **Severity:** `drivable_but_concerned` to `not_drivable_needs_tow` (a tank drain may be required).
- **Misattribution:** "bad gas from the station" — and here that folk-diagnosis is **sometimes literally correct** (unlike FM-5, where the vent/canister is the real cause). Still needs diagnosis to rule out a coincidental pump/ignition failure [Halderman, fuel quality & contamination diagnosis, Tier 2; SAE J1930, Tier 1]. **Corpus demand:** tkc-098 ("GOT GAS IN NJ ON SUNDAY. NEXT DAY VEHICLE WAS CHUGGING … NOW WILL NOT START"), judged `no_start_testing` (null subcategory).

### FM-13 — Fuel-level sender / gas-gauge fault (in-tank sender, gauge reads wrong / stuck)
- **Signature:** `accessory_affected=fuel gauge`; gauge stuck full/empty, reads wrong, or the low-fuel light is on with fuel in the tank. No drivability symptom.
- **Severity:** `drivable_normally`.
- **Misattribution:** "running out of gas" vs a lying gauge. The level sender is fuel-system hardware, but the *customer complaint* is an instrument-cluster / gauge issue → primarily routed to the body-electrical / gauge surface, NOT a fuel-drivability slug (see §7 / §8 cross-ref) [Halderman, fuel-level sender & instrumentation, Tier 2; SAE J1930, Tier 1].

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Real-voice phrasings per failure mode. Provenance uses the template's four values only —
`tekmetric` (verbatim/near-verbatim from a real corpus id, noted), `nhtsa`, `forum-paraphrase`, `synthetic`
(invented OR adapted from an eval-cases.json authored case OR from a DB `positive_examples` seed — none of
those are Tekmetric-corpus verbatim, so they are honestly `synthetic`, flagged, and the per-group share is
reported in §11). Full machine list in `fuel-system-evap.lexicon.yaml`.

| Phrase (customer voice) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "check engine light, believe it is an EVAP issue" | `check_engine_light` | unambiguous | tekmetric (tkc-002) |
| "Recently got gas. The check engine light is steady." | `check_engine_light` | needs-fact:recent_action | tekmetric (tkc-116) |
| "check engine light came on right after i filled up gas, tightened the cap but its still on" | `check_engine_light` | unambiguous | synthetic (eval-authored) |
| "p0446 evap code keeps setting, can not isolate leak" | `check_engine_light` | unambiguous | tekmetric (tkc-148) |
| "CAN NOT FILL WITH GAS. WHEN TRYING TO REFUEL GAS SQUIRTS BACK OUT" | **NO FIT** → propose `trouble_fueling_gas_wont_go_in` | cross-system:check_engine_light | tekmetric (tka-046) |
| "when filling up gas it comes back out after $14" | **NO FIT** → propose `trouble_fueling_gas_wont_go_in` | cross-system:after_recent_service | tekmetric (tka-137) |
| "monitors still not set, will drive it and bring back for retest" | **null-route** (shop note) → advisor | null | tekmetric (tkc-127) |
| "I smell gas inside my car when I'm driving" | `gasoline_fuel_smell` | unambiguous | synthetic (no corpus verbatim) |
| "whole garage smells like gasoline when I park" | `gasoline_fuel_smell` | unambiguous | synthetic (no corpus verbatim) |
| "gas fumes when I start the car cold in the morning" | `gasoline_fuel_smell` | needs-fact:onset_timing | synthetic (no corpus verbatim) |
| "my truck started blowing black smoke" | `black_smoke_from_tailpipe` | needs-fact:onset_timing | synthetic (eval-authored CEL-007) |
| "black smoke when i stomp on the gas and it smells like raw gas" | `black_smoke_from_tailpipe` | unambiguous | synthetic (no corpus verbatim) |
| "fuel mileage tanked and there's black smoke from the back" | `black_smoke_from_tailpipe` | unambiguous | synthetic (no corpus verbatim) |
| "AFTER GETTING GAS HAS TO CRANK VEHICLE MULTIPLE TIMES TO GET STARTED" | `hard_to_start_when_hot` | needs-fact:onset_timing | tekmetric (tka-020) |
| "if i stop for gas the car cranks and cranks but wont catch, i smell gas around the engine" | `hard_to_start_when_hot` | unambiguous | synthetic (eval-authored) |
| "cranks forever in the morning before it finally fires up, fine once warmed up" | `hard_to_start_when_cold` | unambiguous | synthetic (no corpus verbatim) |
| "intermitent no start" | **NO FIT** (no_start_testing, null subcategory) | needs-fact:onset_timing | tekmetric (tkc-172) |
| "TOW IN. CRANKS BUT WILL NOT START" | **NO FIT** (no_start_testing, null subcategory) | needs-fact:engine_running | tekmetric (tka-170) |
| "lost power while driving, very rough idle and stalls out" | `stalling_while_driving_under_load` (proposed read; judges deadlocked null) | needs-fact:engine_running | tekmetric (tka-114) |
| "vehicle losing power going uphills, client believes high pressure fuel pump" | `low_power_or_wont_accelerate_normally` | unambiguous | tekmetric (tkc-133) |
| "CEL coming on/off, stalls when idling, client pulled rich codes" | `stalling_at_idle_or_when_stopping` | unambiguous | tekmetric (tka-084) |
| "engine sputters and runs rough at red lights, rpm bounces, sometimes a rotten egg smell" | `rough_idle_or_shaking_at_a_stop` | unambiguous | synthetic (eval-authored CEL-004) |
| "misfire on start up" | `engine_misfire_or_bucking_feeling` | needs-fact:onset_timing | tekmetric (tkc-124) |
| "runs sputters when idling, sounds like backfiring in the engine compartment" | `engine_misfire_or_bucking_feeling` | unambiguous | forum-paraphrase |

Messiness to preserve: misspellings ("intermitent", "squirts back", all-caps Tekmetric fragments
"NO CRANK NO START", "TESTING AUTH 179"), part-name guesses ("high pressure fuel pump", "valve canister" =
purge canister), and mixed symptom+request ("oil change, also check engine light believe it is EVAP, will
need a loaner" — tkc-002).

**Crank-no-fire is a genuine NO-FIT** (see §7/§8): a bare "cranks but won't start" / "intermittent no start"
(tka-170, tkc-172, tka-061 "NO CRANK NO START", tkc-276) is a Stage-1 `no_start_testing` concern with **no
clean subcategory** — the judges left all four at null subcategory. Do NOT shoehorn these into
`stalling_*` or `hard_to_start_*`. The Stage-1 `no_start_testing` keyword covers them; the subcategory is
legitimately empty until the taxonomy grows a crank-no-fire slug (flagged, not proposed here — insufficient
discriminating detail in these texts).

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: confusable pair → the ONE best discriminating question → the fact slot + value that resolves it.

| Pair | Discriminating question | Slot → value |
|---|---|---|
| **Gasoline smell vs. exhaust-fumes-in-cabin** | "Is it a fresh, sharp smell like standing at the gas pump, or a smoky/burnt tailpipe smell?" | `smell_descriptor` → `gasoline_or_fuel` (us) vs `exhaust_inside_cabin` (exhaust) |
| **Gasoline smell vs. rotten-egg/sulfur** | "Is it raw gasoline, or more like rotten eggs / sulfur?" | `smell_descriptor` → `gasoline_or_fuel` vs `rotten_egg_or_sulfur` |
| **Black (rich) smoke vs. blue (oil) smoke** | "What color is the smoke, and does it smell like raw gas or like burning oil?" | `smoke_color` → `black` + `smell_descriptor=gasoline_or_fuel` (us) vs `blue_or_gray` + `burnt_oil` (oil dossier) |
| **Black (rich) smoke vs. white (coolant) smoke** | "Is the smoke black/sooty with a gas smell, or thick white with a sweet smell?" | `smoke_color` → `black` vs `white` + `smell_descriptor=sweet_or_maple_syrup` |
| **Black smoke: diesel-normal vs. fault** | "Is it a diesel, and does the smoke only puff under hard acceleration or is it there at idle too?" | `vehicle_powertrain` → `diesel` + `onset_timing` (only `when_accelerating` puff on a diesel = often normal) |
| **Hard-start COLD vs. HOT** | "Does it only happen first thing after sitting overnight, or right after you've been driving and stop briefly?" | `onset_timing` → `cold_start` vs `after_warming_up` |
| **Cranks-but-won't-fire (us) vs. won't-crank-just-clicks (charging)** | "When you turn the key does the engine spin/turn over normally but not catch, or do you just get a click with no spinning?" | `engine_running` → `wont_start` (us) vs `wont_crank_just_clicks` (starting-charging dossier) |
| **Stall at idle vs. stall while driving (under load)** | "Does it die only when you slow to a stop, or does it cut out while you're moving at speed?" | `speed_band`/`onset_timing` → `at_stop`/`when_idling` vs `highway`/`during_driving` |
| **Low-power (weak, sustained) vs. hesitation (momentary) vs. misfire (jerky)** | "Is it constant weakness, a brief pause then it catches, or repeated jerking/bucking?" | `engine_running` → sustained weak (low_power) vs `misfiring` (bucking) ; `onset_timing=when_accelerating` shared |
| **Rich-smoke CEL vs. loose-cap CEL** | "Any black smoke or gas smell, or did the light just come on after a fill-up with no other symptoms?" | `smoke_color=black`/`smell=gasoline_or_fuel` (rich) vs `recent_action=fuel_fill_up` alone (cap) |
| **Bad-fuel-after-fill (FM-12) vs. loose-cap (FM-1)** | "Right after that fill-up did the car start running rough / chugging, or did just the light come on with no change in how it drives?" | `engine_running=rough_idle/stalls/wont_start` (contamination) vs `drivable_normally` + `recent_action=fuel_fill_up` (cap) |
| **Trouble-fueling vs. gas-smell** | "Is the problem that gas won't go IN (pump clicks off / spits back), or that you SMELL gas?" | (needs new state; see §9 slot note) vs `smell_descriptor=gasoline_or_fuel` |

**Slot-expressibility check:** every discriminator above lands on an existing slot EXCEPT
"trouble-fueling / gas won't go in" — the fact "customer cannot fill the tank / pump clicks off" is not
expressible in any of the 29 slots. That is the one genuine slot gap this system surfaces (§9), and it does
**not** meet the ≥3-question bar for a standalone slot (see §9).

---

## 6. Warning lights & DTC surface

The fuel/EVAP system's dashboard surface is the **Check Engine Light / MIL** (amber engine-block outline).
Customer nicknames: "check engine light", "CEL", "engine light", "yellow/amber/orange engine light", "engine
symbol/icon", "the little engine thing", "code light". Feeds `warning_light_named='check engine'`.

- **STEADY** (`warning_light_behavior=steady_on`) — a stored fault (loose cap, EVAP leak, sensor, rich/lean). Drive with care.
- **FLASHING** (`flashing_or_blinking`) — active severe misfire dumping raw fuel into the cat → reduce power, get in now. (Misfire can be fuel OR ignition.)
- **CAME ON THEN OFF / COMES AND GOES** — intermittent; classic for a cap that re-sealed, or a marginal EVAP/fuel-trim fault.

DTC families (SAE J2012, Tier 1) the shop will actually pull, for §10 grounding — NOT customer language:
- EVAP: P0440–P0459 (P0455 gross leak/cap, P0442 small leak, P0446 vent, P0457 loose cap, P0441/P0496 purge flow).
- Rich/lean: P0171/P0174 lean, P0172/P0175 rich; MAF P0101–P0103; O2 P013x/P014x.
- Fuel pressure/delivery: P0087 rail pressure low, P0230–P0233 pump circuit.
- Misfire: P0300 random, P0301–P030x per-cylinder.

Note: the customer almost never states a code. When they DO ("p0446", "P0420", "pulled rich codes"), treat it
as a strong unambiguous cue but keep routing on the *symptom* — the classifier reads customer text, and the
DTC is a bonus, not the primary signal.

---

## 7. Confusable neighbors (cross-system)

1. **`exhaust-emissions` / `exhaust_fumes_inside_the_cabin`** — smoky/burnt vs our fresh/sharp raw-gas smell.
   Discriminator: `smell_descriptor` (`exhaust_inside_cabin` vs `gasoline_or_fuel`). CO-safety: if the
   customer says fumes + headache/lightheaded, that leans exhaust, not raw fuel.
2. **`exhaust-emissions` / `rotten_egg_sulfur_smell`** — sulfur/eggy vs raw gas. A rich-running fuel fault is
   a *cause* of the cat overworking (H2S), but when the LEAD complaint is "rotten eggs" the SLUG is theirs;
   when it's "smells like gas / the pump", it's ours.
3. **`engine-lubrication-oil` / `blue_or_gray_smoke_from_tailpipe`** — blue + burnt-oil vs black + raw-gas.
   Discriminator: `smoke_color` + `smell_descriptor`.
4. **`cooling-system` / `white_smoke_from_tailpipe`** — white + sweet vs black + gas. `smoke_color` + smell.
5. **`starting-charging` / `wont_crank_just_clicks`, `slow_crank_sluggish_start`, `battery_drains_overnight`** —
   engine never spins (click) or spins slowly, vs our cranks-normally-but-won't-fire / hard-start.
   Discriminator: `engine_running` (`wont_crank_just_clicks`/`slow_crank` vs `wont_start`) and whether a jump
   fixed it (charging) vs cranks fine (fuel). **Note the shared NO-FIT:** a bare crank-no-fire (tka-170,
   tkc-172, tka-061, tkc-276) is `no_start_testing` at Stage-1 with no subcategory in EITHER dossier.
6. **`ignition-misfire` (shared slug `engine_misfire_or_bucking_feeling`)** — a misfire can be fuel (injector,
   lean) or ignition (coil, plug). The subcategory is jointly fed; §5 doesn't try to split fuel-vs-spark from
   customer text (they can't tell) — both route to the same slug + diagnostic service.
7. **`automatic-transmission` / `manual-trans-clutch` (`hesitation_or_lag_when_accelerating`)** — a fuel
   hesitation vs a shift-feel. Customers can't distinguish; keep `stage1_acceptable` including
   `transmission_testing` for bare "hesitates when I give it gas" (matches eval CEL-003).
8. **`body-electrical-accessories` (gas-gauge / fuel-level readout)** — the fuel-level *sender* is our
   hardware, but a "gas gauge is wrong / stuck / fuel light won't go off" complaint (FM-13) presents as an
   instrument-cluster issue and routes to the body-electrical surface. Discriminator: is the complaint about
   *reading* the fuel level (them) vs *smelling/running/starting* on fuel (us)?

Owned confusable-matrix rows (for `binding/confusable-matrix.yaml`): the black-rich-vs-blue/white-smoke row
and the gas-smell-vs-exhaust/rotten-egg triad — emitted as `stage1.hedge.add` / `stage2.example.negative.add`
ops in the proposals file.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| FM-1 loose cap CEL | check_engine_light_testing | warning_light | `check_engine_light` | good |
| FM-2 EVAP leak (valve/canister) | check_engine_light_testing | warning_light (+smell) | `check_engine_light` (+`gasoline_fuel_smell` if smell-led) | good |
| FM-3 raw fuel leak / smell | check_engine_light_testing (via smell) | smell | `gasoline_fuel_smell` | good |
| FM-4 stuck purge → idle/stall | check_engine_light_testing | performance | `rough_idle_or_shaking_at_a_stop` / `stalling_at_idle_or_when_stopping` / `surging_or_rpms_going_up_and_down` | good |
| **FM-5 trouble fueling / gas spits back** | check_engine_light_testing (labeled so) | — | **NO FIT** (tka-046 = CEL + NULL sub; tka-137 = after_recent_service + NULL sub) | **NO FIT → propose** |
| FM-6 rich → black smoke | check_engine_light_testing | smoke | `black_smoke_from_tailpipe` | good, but **routing gap** (see below) |
| FM-7 lean → misfire/idle/hesitation | check_engine_light_testing | performance | `engine_misfire_or_bucking_feeling` / `rough_idle_or_shaking_at_a_stop` / `hesitation_or_lag_when_accelerating` | good |
| FM-8 weak pump/filter → stall/low power/no-start | no_start_testing / check_engine_light_testing | performance / electrical | `stalling_while_driving_under_load` / `low_power_or_wont_accelerate_normally` | good |
| FM-9 hard-start cold | no_start_testing / check_engine_light_testing | performance | `hard_to_start_when_cold` | good |
| FM-10 hard-start hot / vapor lock | no_start_testing / check_engine_light_testing | performance | `hard_to_start_when_hot` | good |
| **FM-11 failed emissions / monitors not ready** | check_engine_light_testing | warning_light | `check_engine_light` (weak — it's a request, not a symptom) | **weak → propose request value** |
| **FM-12 contaminated / bad fuel after fill-up** | no_start_testing / check_engine_light_testing | performance | `stalling_while_driving_under_load` / `hard_to_start_when_cold` (or after_recent_service if "shop just…") | weak — chugging-after-fill has no clean slug |
| **FM-13 fuel-level sender / gas gauge** | (body-electrical surface) | — | cross-ref `body-electrical-accessories` | out-of-fuel-slug |
| **Bare crank-no-fire** (tka-170/tkc-172/tka-061/tkc-276) | no_start_testing | performance/electrical | **NO FIT** (judges left null subcategory) | **NO FIT (flag, not proposed)** |

**Routing gap (flag + typed op).** The DB `testing_services.concern_categories` for
`check_engine_light_testing` = `[warning_light, performance]` — it does **not** include `smoke`. Yet
taxonomy `00-current-scheduler-taxonomy.md` line 77 says CEL "owns blue/gray tailpipe smoke," and the eval
expects black smoke → `check_engine_light_testing` → `black_smoke_from_tailpipe`
(eval `check_engine_light_testing-007`). As it stands, a `smoke`-category subcategory is only reachable via
`coolant_leak_testing` / `oil_leak_testing`, which are the WRONG diagnostics for rich-fuel black smoke. This
is a **verified real gap** and it now terminates in its own Chris-gated typed op —
`catalog.service.concern_category.add { service: check_engine_light_testing, add: smoke }` in the proposals
file — paired with the `stage1.hedge.add` smoke-color retraining lever. (Previously this durable fix lived
only as prose inside the hedge rule; it is now an actionable op for Wave C.)

**Subcategory proposal (NO FIT, real demand):** `performance/trouble_fueling_gas_wont_go_in` — "can't put
gas in / pump keeps clicking off / gas spits back out at the pump." Demand: one clean null-subcategory case
(tka-046) + tka-137's fill-failure symptom (currently masked under an `after_recent_service` label). See
proposals.

**Request-value proposal (weak fit):** add `customer_request_type=emissions_or_smog_check` for "need to pass
smog/inspection / monitors not ready." Evidence: tkc-127, tkc-002. Keeps these off the drivability slugs.

---

## 9. Fact-slot audit

**Slots this system uses (all exist):** `smell_descriptor` (gasoline_or_fuel, rotten_egg_or_sulfur,
exhaust_inside_cabin), `smoke_color` (black), `warning_light_named` ('check engine'), `warning_light_behavior`
(steady/flashing/comes_and_goes), `recent_action` (fuel_fill_up), `engine_running`
(rough_idle/misfiring/surging/stalls/wont_start/died_while_driving), `onset_timing`
(cold_start/after_warming_up/when_accelerating/when_idling/at_stop), `weather_condition`
(cold/hot), `speed_band` (highway/idle/stopped), `vehicle_powertrain` (diesel/gasoline/turbocharged),
`sound_or_smoke_location_zone` (from_tailpipe/under_hood), `accessory_affected` (fuel gauge — FM-13),
`drivable_state`, `customer_request_type`.

**Values customers actually state (corpus evidence):** `recent_action=fuel_fill_up` ("recently got gas" tkc-116,
"after getting gas" tka-020), `smoke_color=black` (synthetic — no corpus verbatim), `engine_running=wont_start`
("cranks but will not start" tka-170), `onset_timing=after_warming_up` ("after getting gas has to crank" tka-020),
`smell_descriptor=gasoline_or_fuel` (synthetic — no corpus verbatim; smell subcategory has zero Tekmetric rows).
All extract cleanly when literally stated.

**Missing / proposed:**

- **NEW SLOT proposal — `fuel_economy_change`** (values: `dropped`, `normal_or_better`, `not_mentioned`).
  Justification (≥3-question rule): three existing questions ask about mileage. Per the catalog snapshot,
  `q297` (black_smoke: "noticed the fuel mileage dropping recently?") and `q1185` (low_power: "sudden drop in
  your gas mileage?") **currently have EMPTY `required_facts[]`**, so the mapper can never skip them. `q376`
  (check_engine_light: "using more gas than usual, or any black smoke?") is **compound and already has
  `required_facts=["smoke_color"]`** — it asks about mileage AND black smoke. Rather than invent a
  question-split op (no such op type exists), we bind all three by **adding** `fuel_economy_change` to each:
  `q297`→`[fuel_economy_change]`, `q1185`→`[fuel_economy_change]`, and `q376`→`[smoke_color, fuel_economy_change]`
  (a compound question legitimately requires both facts to be skippable). That gives the slot the three real
  question bindings via emitted `question.required_facts.set` ops. `literal_cues`: "gas mileage tanked",
  "using more gas than usual", "bad gas mileage", "mpg dropped", "getting terrible mileage".
  **Extraction discipline:** only set when the customer literally states a mileage change; do NOT infer
  "dropped" from "running rich."

- **NO new slot for the fueling gap.** If `trouble_fueling_gas_wont_go_in` is approved, its discriminating
  question ("does gas refuse to go in / pump click off / spit back?") has no slot. Only ~1–2 questions would
  need it today, so it does **not** meet the ≥3-question bar for a standalone enum slot — recommend a
  free-text/observation capture bundled with the subcategory rather than a new slot. Flagged for Wave B.

- **No other new slots.** Rich/lean, injector, pump, EVAP-valve distinctions are diagnostician-side (codes +
  live data), not customer-observable — correctly kept OUT of the extraction ontology.

---

## 10. Sources

Diagnostic/failure-mode claims (Tier 1/2 only — no Tier-3 web corroboration is used; every mode is fully
supported by a Tier-1 standard and/or a Tier-2 textbook/manufacturer training):
- **SAE J1930** — Diagnostic terminology / acronyms (EVAP, MIL, fuel-injection terms). Tier 1.
- **SAE J2012** — DTC definitions (P0171/P0172 lean/rich, P0300 misfire, P0087 fuel-rail pressure,
  P0440–P0459 EVAP incl. P0455 gross leak, P0442 small leak, P0446 vent, P0457 loose cap, P0441/P0496 purge).
  Tier 1.
- **SAE J1979** — OBD-II diagnostic services incl. readiness-monitor definitions (FM-11). Tier 1.
- **Bosch, *Automotive Handbook* (10th ed.)** — gasoline-engine fuel injection; evaporative-emissions control
  principle; diesel combustion / black-smoke normal-vs-fault. Tier 1.
- **US EPA / CARB regulation (40 CFR Part 85/86)** — the legal basis for sealed-tank EVAP and I/M readiness.
  Tier 1 regulatory reference (statute/CFR citation, not a fetched web page).
- **Halderman, *Automotive Technology*** — fuel delivery & injection, fuel-trim diagnosis, rich/lean mixture,
  cold-/hot-start & vapor-lock diagnosis, EVAP diagnosis, fuel contamination/quality, fuel-level sender. Tier 2.
- **Standard Motor Products / Blue Streak technical training** — MAF, fuel-trim, fuel-pressure-regulator
  symptom signatures. Tier 2 (parts-manufacturer training).

Linguistic authority (never cited for diagnosis): the Tekmetric corpus
`scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json` (real ids cited inline: tkc-002, tkc-116,
tkc-124, tkc-127, tkc-133, tkc-148, tkc-172, tkc-276, tka-020, tka-046, tka-060, tka-061, tka-084, tka-114,
tka-170, tkc-098) + `eval-cases.json` (authored cases → provenance `synthetic`) + `real-concerns-forums.json`
(patterns → `forum-paraphrase`). Synthetic-share reported honestly per group in §11.

---

## 11. Binding-readiness self-check (Gate-G2)

| Check | Status |
|---|---|
| Every failure mode has a Tier-1/2 cite | ✅ (no Tier-3 web sources used) |
| Every cited corpus id verified to exist with matching text | ✅ (re-verified against the 300 tkc- / 200 tka- cases; no fabricated ids) |
| Every proposed synonym ≥2 tokens or a domain token | ✅ (e.g. "gas spits back", "vapor lock", "evap code"; single tokens only for domain terms EVAP/MIL/P0446) |
| Every negative_example names `routes_to` | ✅ (see proposals; the trouble_fueling one is marked conditional on its subcategory proposal) |
| Customer artifacts in customer voice; synthetic honestly labeled | ✅ — see per-group share below (NOT ≤30% everywhere; reported truthfully) |
| Fact cues literal (no inference) | ✅ (§9 discipline; golden case 4 fixed to NOT assert recent_action from a habitual "if I stop for gas"; inference-trap golden cases included) |
| Confusable pairs covered (§5/§7) incl. black-vs-blue/white smoke + gas/exhaust/sulfur triad | ✅ |
| Every NO-FIT → a proposal OR an explicit flag | ✅ (FM-5 subcategory proposal; FM-11 request value; smoke routing gap = typed op; crank-no-fire flagged, deliberately not proposed) |
| New slot obeys ≥3-question rule via EMITTED ops | ✅ (`fuel_economy_change` binds q297+q1185+q376 through three `question.required_facts.set` ops; fueling-state deliberately NOT promoted) |
| ≥8 golden cases incl. ≥1 inference-trap + ≥1 null-route | ✅ (10 cases; 2 inference-traps; 1 null-route) |
| Catalog/service edits marked Chris-gated | ✅ (subcategory, request value, and the smoke concern_category service edit) |

**Synthetic share, reported honestly per lexicon group** (the ~30% cap is a target, not a guarantee; where a
subcategory has **zero** Tekmetric-corpus rows, synthetic is unavoidable and flagged for Wave C NHTSA
sourcing):
- `check_engine_light` group: 6 entries, 1 synthetic (~17%) — under cap.
- `trouble_fueling_gas_wont_go_in` group: 3 entries, 1 synthetic (~33%) — slightly over; two real corpus rows
  (tka-046, tka-137) anchor it.
- `gasoline_fuel_smell` group: 4 entries, **all synthetic** (0 corpus rows exist for this subcategory) — over
  cap by necessity; flagged for NHTSA sourcing.
- `black_smoke_from_tailpipe` group: 4 entries, **all synthetic** (0 corpus rows) — over cap by necessity; flagged.
- `hard_to_start_when_cold` group: 2 entries, **all synthetic** (0 corpus rows) — over cap by necessity; flagged.
- `hard_to_start_when_hot` group: 2 entries, 1 real (tka-020) + 1 synthetic (~50%) — over cap; one real anchor.
- no-start / stall / low-power / misfire / idle groups: predominantly real Tekmetric rows (tka-170, tkc-172,
  tka-114, tkc-133, tka-084, tkc-124) + 1 forum-paraphrase; under cap.
