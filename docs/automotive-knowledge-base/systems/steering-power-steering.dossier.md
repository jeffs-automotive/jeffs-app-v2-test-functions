# Steering & power steering (EPS / hydraulic) — diagnostic dossier
slug: steering-power-steering   date: 2026-07-18
binds_services: [power_steering_eps_testing, suspension_steering_check]
binds_categories: [steering, warning_light, pulling, leak, noise]

> Scope note: this dossier owns the **steering feel + power-assist + steering-noise + PS-fluid**
> surface. It deliberately reaches into `suspension_steering_check` for the mechanical-steering
> subcategories (loose, off-center, pull/wander) because the customer frames them as "steering," but
> the pump/rack/EPS/whine/heavy/PS-leak core is `power_steering_eps_testing`. Wheel-balance shake and
> bump clunks are named as neighbors, not owned.

---

## 1. Scope & boundaries

**In scope (components/functions):**
- Power-assist generation: hydraulic PS pump + drive belt + high-/low-pressure hoses + reservoir + PS
  fluid; **electric power steering (EPS/EPAS)**: assist motor, torque sensor, steering-angle sensor,
  PSCM (power-steering control module), voltage supply.
- Steering gear: rack-and-pinion (or recirculating-ball gearbox), inner/outer tie rod ends, steering
  shaft + U-joints/intermediate shaft, steering coupler.
- Symptoms owned: heavy/stiff steering, PS whine/groan/moan **on turn**, loose/sloppy play,
  off-center wheel, drift/wander framed as a steering complaint, red/pink PS-fluid leak, EPS/PS dash
  light.

**Explicitly OUT of scope:**
- Steering-wheel **shake at highway speed** (wheel balance / warped rotor) → owned by the vibration
  dossier (`steering_wheel_shake_at_highway_speed`) and brakes dossier (`vibration_or_pulsing_when_braking`).
- **Clunk over bumps** / rough ride → suspension dossier (`clunking_over_bumps`,
  `clunking_knocking_or_rough_ride_over_bumps`).
- **CV-joint click/pop when turning while rolling** → NVH/driveline dossier (`popping_or_clicking_when_turning`).
- **Continuous whine tied to engine RPM (belt/alternator)** → charging/belt dossier
  (`high_pitched_whining_under_the_hood`).
- **Red/pink puddle that is transmission fluid** (mid-car, shift symptoms) → the transmission surface
  under `transmission_testing`; this dossier owns only the PS half of the shared red/pink leak slug.
- **Pull only when braking** → brakes dossier (`pulling_only_when_braking`).

---

## 2. System primer (expert, cited)

Two architectures dominate the US fleet Jeff's sees, and the split is the single most important
disambiguation in this whole system.

**Hydraulic power steering (HPS)** — belt-driven vane pump pressurizes fluid to a rotary valve on the
rack/gearbox; assist force is proportional to how hard the torsion bar in the valve is twisted. Many
systems use an **ATF-type** fluid that is **red/pink** when new (darkens with age) — this is the case
that collides with transmission fluid — but dedicated PS fluids are commonly **amber/clear**, and some
European CHF-type fluids are **green**, so "red/pink" is a strong-but-not-certain cue, not a rule. (The
live DB description is deliberately narrow: "power-steering fluid that uses ATF.") Failure signatures
cluster around the pump, belt, fluid level, and hoses.
[Halderman, *Automotive Chassis Systems* (Pearson), ch. Steering Systems, Tier 2, accessed 2026-07-18;
Bosch *Automotive Handbook*, steering-systems section, Tier 2, accessed 2026-07-18]

**Electric power steering (EPS/EPAS)** — an electric motor (column-, pinion-, or rack-mounted) adds
torque based on a **torque sensor** reading; a **PSCM** controls it using vehicle speed and
steering-angle input. No pump, no belt, and on most designs **no fluid**. Dominant on vehicles built
after ~2010. Because the motor pulls high current when turning, EPS is **voltage-sensitive**: a weak
battery or corroded ground can drop assist and set the EPS light.
[Bosch *Automotive Handbook*, electric-steering section, Tier 2, accessed 2026-07-18; ASE A4
Suspension & Steering task list, ase.com, Tier 1, accessed 2026-07-18; corroborated by AutoNation /
JB Tools EPS-light explainers, Tier 3, accessed 2026-07-18,
https://www.autonationmobileservice.com/i/blog/service-power-steering/]

**Steering gear + linkage (shared by both).** Rack-and-pinion or recirculating-ball; tie rods
transmit rack motion to the wheels. Wear here produces **play/looseness** and **alignment/off-center**
symptoms regardless of assist type. Tie-rod, ball-joint, and rack wear are the classic "loose
steering" causes; alignment spec and tire condition drive **pull/drift/off-center**.
[Moog steering & suspension technical training (Problem Solver), Tier 2, accessed 2026-07-18; ASE A4
task list, Tier 1, accessed 2026-07-18]

Practical consequence for the classifier: **feel + noise + fluid + light** point at the power-assist
system (`power_steering_eps_testing`); **play + position + directional pull** point at mechanical
steering/alignment (`suspension_steering_check`). The taxonomy shares the `steering` subcategory pool
between both services, so Stage-1 must pick the service from the *symptom family*, not the word
"steering."

---

## 3. Failure-mode catalog (diagnostic spine)

### FM-1 — Low / leaking PS fluid (hydraulic)
- Sensory: `noise_descriptor=whining` or groan **on turn**, worst at low speed / lock-to-lock;
  `steering_feel=heavy_or_hard_to_turn` as it worsens; `fluid_color=red_or_pink`,
  `fluid_under_car_location=under_engine_front`.
- Leak sources (all HPS): the **pump shaft seal**, high-/low-pressure **hose** fittings, the reservoir,
  and — distinctly — the **rack-and-pinion input-shaft seal** and a torn **inner-tie-rod boot** (a
  leaking rack often shows up as fluid weeping from the boot, not a puddle up front). The DB's own
  red/pink synonyms include "steering rack leak" for exactly this.
- Conditions: `onset_timing=when_turning`; worse `weather_condition=cold_weather` (thick fluid, more
  cavitation on cold starts). `speed_band=low_speed`.
- Severity: `drivable_but_concerned` early; assist can drop suddenly if fluid runs out → `drivable_but_concerned`/`not_drivable`.
- Misattribution: customers call the whine "the belt" or "the alternator"; call the heavy wheel "the
  EPS" even on hydraulic cars; and a common NON-PS misattribution runs the other way — **low tire
  pressure** (or a soft/flat front tire) makes the wheel feel heavy at parking speed with no assist
  fault at all (check `tire_state` before chasing the pump).
- Source: [Halderman ch. Power Steering, Tier 2; corroborated AutoZone "what causes power steering
  whine" — cavitation from low fluid/air, Tier 3, accessed 2026-07-18,
  https://www.autozone.com/diy/power-steering/what-causes-power-steering-whine]

### FM-2 — Air in the hydraulic system (aeration/cavitation)
- Sensory: `noise_descriptor=whining`/groan, often *after* a recent PS service or a low-fluid episode;
  foamy fluid in reservoir.
- Conditions: `onset_timing=when_turning`; may self-improve as air bleeds out.
- Misattribution: mistaken for a failing pump.
- Source: [Gates power-steering belt/hydraulic training, Tier 2, accessed 2026-07-18; AutoZone whine
  explainer, Tier 3, accessed 2026-07-18]

### FM-3 — Failing hydraulic PS pump
- Sensory: `noise_descriptor=whining`/groan that persists even topped-off; growl on turn;
  intermittently `steering_feel=heavy_or_hard_to_turn`.
- Conditions: `onset_timing=when_turning` (worst at lock); can also whine at idle.
- Severity: `drivable_but_concerned`.
- Source: [Halderman ch. Power Steering, Tier 2, accessed 2026-07-18]

### FM-4 — Loose/worn/glazed serpentine (drive) belt — HPS only
- Sensory: squeal/whine that can rise with RPM AND on turn (belt slips under pump load); brief heavy
  steering on hard turns.
- Conditions: worse `weather_condition=cold_weather`/rain (wet belt slip), `onset_timing=when_turning`
  under load.
- Misattribution: **confusable with FM-1 pump whine and with alternator/idler whine** — see §7.
- Source: [Gates belt-diagnosis training, Tier 2, accessed 2026-07-18]

### FM-5 — EPS assist reduced / dropped (motor, torque sensor, PSCM, or low voltage)
- Sensory: `steering_feel=heavy_or_hard_to_turn`, worst `speed_band=low_speed`/parking, near-normal on
  highway; `warning_light_named` ≈ "power steering"/"EPS"/"EPAS"; `warning_light_behavior=steady_on`.
- Conditions: often `recent_action=battery_or_alternator_work` (voltage disturbance), or after an
  impact to the front wheel loading the torque sensor; can be `started_when=sudden_onset` ("stiff
  overnight").
- Severity: `drivable_but_concerned` (dangerous in parking lots, OK at speed).
- Misattribution: customers describe it exactly like hydraulic heavy-steering; the discriminator is
  the **light** + a fluid-free system.
- Source: [Bosch *Automotive Handbook*, EPS, Tier 2; ASE A4, Tier 1, accessed 2026-07-18; corroborated
  AutoNation/JB Tools EPS-light explainers on low-voltage + torque-sensor causes, Tier 3, accessed
  2026-07-18]

### FM-6 — Worn tie rod ends / ball joints / rack (mechanical play)
- Sensory: `steering_feel=loose_or_sloppy` — play/deadband at center, constant correcting, "car lags
  the wheel"; can add a clunk over bumps.
- Conditions: `speed_band=highway` makes wander more noticeable; gradual `started_when=gradually`.
- Severity: `drivable_but_concerned`; safety item.
- Misattribution: customers say "the steering is going out" / blame alignment.
- Source: [Moog Problem Solver — tie-rod & ball-joint wear signatures, Tier 2; ASE A4, Tier 1, accessed 2026-07-18]

### FM-7 — Alignment out of spec / off-center wheel
- Sensory: `steering_feel=wheel_off_center_while_straight` with the car tracking straight; or with a
  `pull_direction`.
- Conditions: `recent_action=alignment`/`tire_rotation_or_replacement`/`hit_pothole_or_curb`.
- Severity: `drivable_normally`/`drivable_but_concerned`.
- Misattribution: "the alignment shop didn't fix it."
- Source: [Moog alignment training, Tier 2; ASE A4, Tier 1, accessed 2026-07-18]

### FM-8 — Directional pull / wander (alignment, tire conicity, uneven pressure/wear, worn front end)
- Sensory: `pull_direction=left|right` (steady) or `varies_or_wanders`; customer "fights the wheel."
- Conditions: steady on flat road (alignment/tire) vs slope-following (road crown, not a fault);
  `recent_action=tire_rotation_or_replacement` a common trigger.
- Severity: `drivable_but_concerned` when wander is bad at highway speed.
- Misattribution: pull-on-braking (a brake fault) gets lumped in — see §7.
- Source: [Moog Problem Solver — pull/lead diagnosis, Tier 2; ASE A4, Tier 1, accessed 2026-07-18]

### FM-9 — Dry strut bearing / steering-shaft U-joint (noise on turn, no assist fault)
- Sensory: `noise_descriptor=creaking_or_squeaking` or a groan/clunk **only when turning**, felt in
  the column; assist normal.
- Conditions: `onset_timing=when_turning`, often worse `weather_condition=cold_weather`.
- Misattribution: mistaken for PS pump.
- Source: [Halderman ch. Steering/Front Suspension, Tier 2; ASE A4, Tier 1, accessed 2026-07-18]

### FM-10 — Unbalanced steering gear / rotary-valve wear (memory steer, stiff one direction)
- Sensory: `steering_feel=stiff_one_direction_only` — noticeably harder (or lighter) turning one way
  than the other; on some cars a **steady lead/pull** that "remembers" the last turn direction
  ("memory steer"). On EPS, a **torque-sensor bias** or a mis-calibrated pull-drift compensation
  produces the same one-sided effort / lead.
- Conditions: present at `speed_band=low_speed` for effort asymmetry; the lead shows up cruising.
- Severity: `drivable_but_concerned`.
- Why it matters for routing: this is the documented case where a **power-assist fault CAN cause a
  steady directional pull** — so a pull is not proof-of-alignment. It stays a *deprioritization*
  (alignment-first when effort is normal + no whine + no light), never an absolute exclusion of PS.
- Source: [Halderman ch. Power Steering — pull/lead diagnosis tables (unbalanced rotary-valve/gear
  leakage), Tier 2; Moog "Problem Solver" memory-steer/lead, Tier 2; ASE A4, Tier 1, accessed 2026-07-18]

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Real-voice phrasings per failure mode. Full machine list in `steering-power-steering.lexicon.yaml`.
Highlights (provenance in the yaml):

- Heavy/stiff (FM-1/3/5): "steering wheel feels tight" (tekmetric tka-000, verbatim of "STEERING WHEEL
  FEELS TIGHT  TESTING AUTH 89 TO START"), "have to use both hands to turn," "hard to turn in parking
  lots but fine on the highway," "power steering feels like it quit," "went stiff overnight." →
  `hard_to_turn_heavy_steering` (or `power_steering_eps_light` if a light is named; or
  `steering_feel=stiff_one_direction_only` for one-sided effort, FM-10).
- Whine/groan on turn (FM-1/2/3/9): "whining when I turn the wheel, goes away when straight," "groans
  when I turn in the parking lot," "loud squeal when turning" (tekmetric tka-157). →
  `noise_when_turning_the_steering_wheel`.
- PS-fluid leak (FM-1): "power steering pump badly leaking fluid" (tekmetric tka-118 — but note this RO
  is TRUNCATED; its full text "...HAD NOT BEEN DRIVEN FOR A FEW MONTHS..." carries the consensus label
  `car_has_been_sitting_unused_for_a_long_time`, a Stage-1 situational override, so it is cited for
  phrasing only), "drips and small puddles of power steering fluid under the front driver side"
  (forum-paraphrase), "bright red puddle under the front." →
  `red_or_pink_puddle_transmission_or_power_steering`.
- EPS light (FM-5): "power steering light came on and the wheel is hard to turn," "EPS/EPAS light,"
  "steering wheel symbol with an exclamation point," "PSCM light after I replaced the battery." →
  `power_steering_eps_light`.
- Loose play (FM-6): "I can wiggle the wheel before the car turns," "lots of play, dead zone in the
  middle," "car lags behind the wheel," "sloppy and disconnected." → `loose_or_sloppy_steering`.
- Off-center (FM-7): "steering wheel is crooked going straight," "just had an alignment and now the
  wheel isn't centered," "hit a curb and the wheel sits off to the left." → `steering_wheel_off_center_when_driving_straight`.
- Pull/wander (FM-8): route to the MOST specific pulling slug (see §8). "still pulls after the
  alignment" → `pull_that_started_after_recent_tire_or_service_work`; "wanders badly at highway speeds
  / both ways" → `wandering_or_drifting_in_both_directions`; only the vague "steering feels off, car
  wanders, fighting the wheel" (no distinguishing cue) → the generic
  `pulling_drifting_or_wandering_on_the_road`.
- Mixed symptom+request (real Tekmetric shape): "steering wheel feels tight testing auth 89 to
  start," "rack replacement" (bare work order — see §8 null-route).

Messiness observed & preserved: all-caps fragments ("STEERING WHEEL FEELS TIGHT"), part-name shorthand
("rack"), "power steering" used as a catch-all on EPS cars that have no pump, "squeal" used for what is
usually a whine/groan.

---

## 5. Differential & discriminating questions (binds required_facts + slots)

| Confusable pair | ONE best question | Slot + value that decides |
|---|---|---|
| Heavy steering: hydraulic (FM-1/3) vs EPS (FM-5) | "Is a steering/EPS warning light on the dash?" | `warning_light_named` present ("power steering"/"EPS") → EPS light path; absent → `hard_to_turn_heavy_steering` |
| Heavy steering vs whine-only on turn | "Is the wheel actually harder to turn, or does it turn fine but make noise?" | `steering_feel=heavy_or_hard_to_turn` → heavy; `noise_descriptor` set + feel normal → `noise_when_turning_the_steering_wheel` |
| PS whine on turn (FM-1/2/3) vs belt/alternator whine (neighbor) | "Does the noise happen mainly when you turn the wheel, or all the time and it rises with engine RPM?" | `onset_timing=when_turning` → PS; RPM-tied/continuous → `high_pitched_whining_under_the_hood` |
| PS whine/groan on turn vs CV click on turn | "Is it a whine/groan, or a rhythmic click-click only while the car is rolling through the turn?" | `noise_descriptor=whining` → PS; `noise_descriptor=popping_or_clicking` → `popping_or_clicking_when_turning` |
| Loose play (FM-6) vs pull/wander (FM-8) | "Does the WHEEL itself have play you can wiggle, or does the CAR wander while the wheel feels tight?" | `steering_feel=loose_or_sloppy` → loose; `pull_direction` set with tight wheel → pulling |
| Off-center (FM-7) vs pull (FM-8) | "Does the car track straight with just a crooked wheel, or does it also drift to a side?" | `steering_feel=wheel_off_center_while_straight` + `pull_direction=no_pull` → off-center; `pull_direction=left/right` → pulling |
| Red/pink leak: PS vs transmission | "When you turn the wheel does it feel heavy or whine, or do you notice slipping/hesitation shifting gears?" | `steering_feel=heavy_or_hard_to_turn`/`fluid_under_car_location=under_engine_front` → PS; shift symptoms / `under_middle` → transmission |
| Pink leak: PS/ATF vs pink COOLANT | "Is the temperature gauge running hot, or does it smell sweet — or is the wheel heavy / whining?" | overheating / sweet smell + `under_engine_front` → `green_orange_yellow_or_pink_puddle_coolant` (coolant_leak_testing); heavy/whine → PS. Many long-life coolants (Toyota SLLC / some OAT) are pink, so color alone does NOT settle it |
| Heavy at low speed vs everywhere | "Is it harder in parking lots, or just as hard at highway speed?" | `speed_band=low_speed` → power-assist fault; `all_speeds`/mechanical bind → gear/linkage |
| EPS light: isolated vs cascade | "Is only the steering light on, or several lights at once?" | `warning_light_behavior=multiple_lights_at_once` → `multiple_warning_lights_at_once` (low-voltage root); single → `power_steering_eps_light` |

**Slot-expressibility gaps** (candidate slot signals; see §9): road-crown/slope dependence of a pull
("only on roads that lean") and lock-to-lock loudness ("louder held full-turn") are asked but have **no
slot** — currently `question.intentionally_empty`.

---

## 6. Warning lights & DTC surface

- **Power-steering / EPS / EPAS light** — steering-wheel icon with an exclamation point (!), amber
  (reduced assist) or red (assist lost); some brands spell "EPS", "EPAS", "PS", or "PSCM". Customer
  names: "steering wheel light," "steering wheel with an exclamation point," "the power steering
  warning." Feeds `warning_light_named` ≈ "power steering"/"eps". Solid = fault stored; some blink on
  active low-voltage. [ASE A4, Tier 1; Bosch Handbook EPS, Tier 2, accessed 2026-07-18]
- **Cascade pattern:** a weak battery frequently lights EPS **with** ABS/traction/airbag together →
  route `multiple_warning_lights_at_once`, not this slug, when the customer lists several.
  [Corroborated AutoNation EPS-light explainer, Tier 3, accessed 2026-07-18]
- DTC families (context, not customer-facing): steering-torque-sensor and steering-angle-sensor codes,
  PSCM communication/voltage codes. Customers rarely quote these; do not rely on DTC text for routing.

---

## 7. Confusable neighbors (cross-system)

1. **PS whine-on-turn vs turbo/alternator/belt whine (`high_pitched_whining_under_the_hood`).** The
   real corpus shows the ambiguous end: "WHINE NOISE WHEN RUNNING" (tka-013) — a bare fragment with no
   RPM or turning cue, which the labelers left with **no consensus**; contrast a customer who says
   "whine when I turn the wheel" (→ PS). The discriminator is `onset_timing=when_turning` (→ PS) vs a
   continuous / RPM-linked whine present when not turning (→ belt/alternator). Do **not** read tka-013
   as proof of the belt side — it is genuinely under-specified.
   [Gates belt training, Tier 2; observed corpus id tka-013 (bare "WHINE NOISE WHEN RUNNING"), accessed 2026-07-18]
2. **Steering pull vs alignment pull.** Customers frame alignment pull as a "steering problem." A
   steady directional pull is **usually** alignment/tire/brake, and the right *default* is to
   deprioritize PS: a pull with **normal effort + no whine + no light** → route to
   `suspension_steering_check` (alignment) first. This is a heuristic, **not an absolute** — a
   power-assist fault CAN produce a steady pull/lead (unbalanced steering-gear or rotary-valve leakage
   = "memory steer"; an EPS torque-sensor or pull-drift-compensation fault — see FM-10). So when the
   pull comes **with** heavy/uneven effort, a whine, or a steering light, keep `power_steering_eps_testing`
   in play rather than excluding it.
   [Halderman ch. Power Steering pull/lead tables (rotary-valve/gear imbalance), Tier 2; Moog pull/lead
   & memory-steer training, Tier 2; ASE A4, Tier 1, accessed 2026-07-18]
3. **Pull-when-braking (`pulling_only_when_braking`).** "Pulls left when I brake hard" is a brake
   caliper/hose fault, not steering. Discriminator `onset_timing=when_braking`.
4. **Highway-speed wheel shake (`steering_wheel_shake_at_highway_speed`).** Balance/warped-rotor
   vibration, not a power-steering fault. Discriminator `speed_band=highway`/`specific_mph` + shake,
   no effort/noise-on-turn.
5. **Clunk/creak on turn from suspension vs PS.** A clunk when turning over a bump is
   strut/CV/linkage; a groan/whine when turning at a standstill is PS. Discriminator `onset_timing`
   (over_bumps vs when_turning while parked).
6. **Pink PS/ATF puddle vs pink COOLANT (`green_orange_yellow_or_pink_puddle_coolant`).** Color is a
   trap here: many long-life coolants (Toyota SLLC, some OAT) are **pink**, and both PS fluid and
   coolant can pool `under_engine_front`. Discriminator = the accompanying symptom — overheating /
   temp-gauge-hot / sweet smell → coolant (`coolant_leak_testing`); heavy steering or whine-on-turn →
   PS. With neither, it is a genuine multi-way leak and belongs to whichever surface the customer's
   other symptom names. [ASE A4 / A5, Tier 1; Bosch Handbook coolant & steering sections, Tier 2,
   accessed 2026-07-18]

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| FM-1/2/3 heavy + whine + PS leak | power_steering_eps_testing | steering / leak | hard_to_turn_heavy_steering; noise_when_turning_the_steering_wheel; red_or_pink_puddle_transmission_or_power_steering | good |
| FM-4 belt whine on turn | charging_starting_testing / power_steering_eps_testing | noise | high_pitched_whining_under_the_hood (or noise_when_turning if turn-only) | good (hedge) |
| FM-5 EPS reduced + light | power_steering_eps_testing | warning_light | power_steering_eps_light | good |
| FM-5 EPS heavy, NO light named | power_steering_eps_testing | steering | hard_to_turn_heavy_steering | good |
| FM-6 loose play | suspension_steering_check | steering | loose_or_sloppy_steering | good |
| FM-7 off-center | suspension_steering_check | steering | steering_wheel_off_center_when_driving_straight | good |
| FM-8 pull/wander (steering-framed, generic) | suspension_steering_check | steering / pulling | pulling_drifting_or_wandering_on_the_road | good (generic; use a more specific pulling slug when the cue fits — see below) |
| FM-9 dry strut bearing / U-joint creak on turn | suspension_steering_check | steering / noise | noise_when_turning_the_steering_wheel | good (DB description already admits dry strut bearings; we add the "squeal" phrasing) |
| FM-10 stiff one direction / memory steer | power_steering_eps_testing | steering | hard_to_turn_heavy_steering (`steering_feel=stiff_one_direction_only`) | good |
| Bare "rack replacement" work order | — | (none) | — | **NO FIT** → advisor/null-route (`customer_request_type=replace_specific_part`) |

**Pulling-category neighbor slugs (the boundary that binds `binds_categories: pulling`).** The `pulling`
category is a FAMILY of live subcategories that already draw sharp lines. This dossier binds the
*generic* one but must route to the MOST specific match — collapsing everything into
`pulling_drifting_or_wandering_on_the_road` collides with these neighbors' existing enrichment:

| Cue in the concern | Correct subcategory (service = suspension_steering_check) |
|---|---|
| Onset tied to recent tire/alignment/service ("pulls ever since new tires / the alignment") | `pull_that_started_after_recent_tire_or_service_work` |
| Steady one-direction pull on every road, no recent-service anchor | `steady_drift_while_cruising` |
| Bi-directional wander, "both ways", "all over the lane" | `wandering_or_drifting_in_both_directions` |
| Pull only on sloped/crowned roads, straight on flat | `drift_that_follows_the_roads_slope` |
| Vague "steering feels off + wanders" with no distinguishing cue | `pulling_drifting_or_wandering_on_the_road` (the generic bucket) |

Because of this, the earlier draft's "still pulls after alignment" and "wander badly at highway speeds"
positives/synonyms on the generic slug were **removed** (they belonged to the recent-service and
both-ways slugs respectively). No enrichment op in this dossier writes to the four specific pulling
slugs — their DB enrichment is already strong; the golden case set exercises the boundary instead.

No new subcategory is required — the steering pool is complete and well-enriched. The only real delta
on `noise_when_turning_the_steering_wheel` is small: its live description ALREADY lists
whine/groan/moan/hum/growl/creak/pop and names dry strut bearings + column sources, so this dossier
only adds the missing **"squeal"** phrasing (real corpus: tka-157 "HEARS A LOUD SQUEAL WHEN TURNING")
and the explicit "normal steering effort" tell that separates a dry-bearing squeal from a pump fault.
Handled with one narrow `stage2.description.revise` + `stage2.synonym.add "squeal when turning"` +
`stage2.example.positive.add`, not a new slug.

---

## 9. Fact-slot audit

**Slots this system uses (of the 29):** `steering_feel`, `noise_descriptor`, `pull_direction`,
`fluid_color`, `fluid_under_car_location`, `warning_light_named`, `warning_light_behavior`,
`speed_band`, `onset_timing`, `started_when`, `recent_action`, `weather_condition`,
`sound_or_smoke_location_zone`, `drivable_state`.

**Values customers actually state (corpus evidence):**
- `steering_feel`: heavy_or_hard_to_turn ("tight", "hard to turn in lots"), loose_or_sloppy ("wiggle
  the wheel"), wheel_off_center_while_straight ("crooked going straight"), and
  `stiff_one_direction_only` ("harder to turn left than right") — **corpus-thin** but now carried by a
  failure mode (FM-10, memory steer / unbalanced valve) and a golden case, so kept.
- `noise_descriptor`: whining, and (corpus) squealing_high_pitched on turn; groan/moan map to whining.
- `pull_direction`: left/right (steady), varies_or_wanders ("wanders badly").
- `fluid_color=red_or_pink`, `fluid_under_car_location=under_engine_front`/`under_driver_side`.
- `recent_action=battery_or_alternator_work` (EPS trigger), `alignment`, `hit_pothole_or_curb`.

**Missing values / gaps:**
- No enum captures **road-crown/slope dependence** of a pull (asked by q697 and by
  `drift_that_follows_the_roads_slope`). Only **2** questions need it → below the ≥3 threshold, so **no
  slot proposed**; logged as a watch item (a third consumer would justify a `pull_road_dependence`
  slot: {slope_following, all_roads}).
- No enum for **lock-to-lock loudness** ("louder held at full lock") — single question → no slot.
- `noise_descriptor` has no "groan/moan" member; these are correctly folded into `whining` (the slot
  description already lists power-steering under `whining`). No change.

**Proposed new slots:** none (nothing clears the ≥3-question rule).
**Proposed slot-value adds:** none required — existing enums cover every literal cue found.

---

## 10. Sources

Diagnostic (Tier 1/2, corroborated by Tier 3 where noted; accessed 2026-07-18):
- ASE A4 Suspension & Steering task list, ase.com — Tier 1 (task taxonomy, EPS/HPS scope).
- Bosch *Automotive Handbook* — steering-systems & electric-steering sections — Tier 2.
- Halderman, *Automotive Chassis Systems* (Pearson) — Power Steering & Steering Systems chapters — Tier 2.
- Moog "Problem Solver" steering & suspension technical training — tie-rod/ball-joint wear, pull/lead,
  alignment — Tier 2.
- Gates power-steering belt & hydraulic training — belt slip / whine — Tier 2.
- AutoZone DIY "What causes power steering whine" (cavitation/low fluid) — Tier 3 corroboration,
  https://www.autozone.com/diy/power-steering/what-causes-power-steering-whine
- AutoNation Mobile Service "Service Power Steering light" (low-voltage + torque sensor) — Tier 3
  corroboration, https://www.autonationmobileservice.com/i/blog/service-power-steering/

Linguistic (corpus, never cited for diagnosis; ids re-verified against the corpus id scheme
tka-NNN/tkc-NNN — earlier draft had cited file LINE NUMBERS by mistake):
`real-concerns-tekmetric-labeled-v2.json`:
- `tka-000` = "STEERING WHEEL FEELS TIGHT  TESTING AUTH 89 TO START" (was mis-cited "6891");
- `tka-118` = "TOW IN POWER STEERING PUMP BADLY LEAKING FLUID, HAD NOT BEEN DRIVEN FOR A FEW
  MONTHS..." — consensus `car_has_been_sitting_unused_for_a_long_time` (was mis-cited "9665");
- `tka-013` = "WHINE NOISE WHEN RUNNING 89 OK" — NO labeler consensus (was mis-cited "7192");
- `tka-157` = "HEARS A LOUD SQUEAL WHEN TURNING. 89.99 AUTH" — consensus `power_steering_eps_testing`.
  (The earlier "2527" and "tka-158"-as-whine references were errors — tka-158 is "CUSTOMER STATES
  ALTERNATOR BELT BROKE.", not a whine complaint — and are removed.)
`eval-cases.json` (referenced for boundary contrast, NOT copied into golden cases):
power_steering_eps_testing-001/002/003, suspension_steering_check-005/007/008, transmission_testing-002
(the red-puddle-middle transmission case), brake_inspection-008 (pull-only-when-braking).
`real-concerns-forums.json` (ids at lines 626/634 PS-leak, 1162 pull-after-alignment, 1194/1210 wander).

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode (FM-1…FM-10) carries a Tier 1/2 cite (Tier 3 only as corroboration).
- [x] Every negative_example proposed in `proposals.yaml` names a `routes_to` that differs from its own
      slug (the prior self-referential red/pink negative was converted to a stage1.hedge.add).
- [x] No bare-word synonyms; the two surviving synonym adds ("squeal when turning", "wheel feels
      tight") are ≥2 tokens and are NOT already live synonyms (dup adds EPAS/PSCM/"still pulls after
      alignment" removed).
- [x] Every op was DIFFED against the live subcategory enrichment (catalog-snapshot.json); ~10 duplicate
      example/synonym ops from the first draft were removed.
- [x] Positive examples lead with real corpus phrasings; synthetic flagged and ≤30% per subcategory
      (eps_light group rebalanced to 1/4 = 25%; pulling group has no synthetic after re-pointing).
- [x] Fact cues are literal — heavy-steering text does not set fluid/light slots; red-puddle text with
      "steering normal" sets `steering_feel=normal`, not heavy (inference-trap golden case).
- [x] 9 golden cases, all DISTINCT from `eval-cases.json` (the 4 near-verbatim copies were replaced),
      incl. 3 inference-traps + 1 null-route (`route: advisor`, empty stage1).
- [x] Pulling boundary made structurally visible (§8): the four specific pulling slugs
      (recent-service / steady-drift / both-ways-wander / road-slope) are mapped, and colliding generic-slug
      ops were removed. No op writes to those four neighbor slugs (their enrichment is already strong).
- [x] Confusable pairs addressed with `stage1.hedge.add` ops: PS whine vs belt/alternator; steering
      pull vs alignment pull (as a DEPRIORITIZATION, not an absolute — FM-10 documents PS-side pull);
      PS/ATF vs transmission (fluid location); pull-when-braking (brakes).
- [x] Corpus ids re-verified to the tka-NNN scheme (tka-000/013/118/157); mis-cited line-numbers and
      the fabricated ids (2527, 7192, tka-158-as-whine) corrected in §7/§10.
- [x] Bound only to existing slugs; the one gap ("rack replacement" work order) is a null-route, not a
      new subcategory. No new slots proposed (≥3-question rule respected).
