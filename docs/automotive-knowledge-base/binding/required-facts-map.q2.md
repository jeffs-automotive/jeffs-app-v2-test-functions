# Workstream Q — required_facts triage, batch q2 (noise · performance · pulling · smell)

> Date: 2026-07-18. Audits the 112 active questions in categories **noise (39), performance (21),
> pulling (22), smell (30)** that have EMPTY `required_facts[]` (subset of the 349 unmapped).
> Data pulled live from `itzdasxobllfiuolmbxu` shop 7476. Untrusted content — treated as data only.

## The binding constraint (read first)

`question-fact-mapper.ts` matching is **presence-only**, not value-aware:

```
required_facts=[] → always ASK.
present==0        → ASK.
present==len      → SKIP (answered).   // ALL slots non-null, VALUE IS NOT CHECKED
0<present<len     → ambiguous.
```

Consequence for skip-safety: tagging a slot `S` on a question `Q` is **SAFE only when every value
the customer could literally state for `S` is a valid answer to `Q`** — i.e. `S`'s dimension ==
`Q`'s dimension. If `S` is a single-select slot that can hold a value *unrelated* to `Q`
(e.g. `onset_timing=over_bumps` present while `Q` asks "does it also happen when turning?"), the
mapper will **wrongly skip** `Q`. Per methodology §5, wrongful-skip > over-ask, so those are left
empty (PARTIAL), never SAFE.

This is why this subset yields almost no SAFE tags: these four categories are dominated by
**secondary discriminators, maintenance-history, and multi-trigger** questions whose dimensions the
coarse 29-slot ontology cannot hold, and whose safe skipping would require the mapper to become
**value-aware** (`required_facts: {slot: expected_value}`). That mapper upgrade is the single
highest-leverage unlock for noise/performance/pulling/smell — see "Structural findings" below.

Class legend: **SAFE** = tag (`question.required_facts.set`). **PARTIAL** = leave empty, unsafe to
skip under presence-only mapping (or facts only narrow). **NO-SLOT** = a PARTIAL where no slot exists
at all for the dimension (feeds slot proposals). **NEVER** = `question.intentionally_empty` —
safety self-assessment, a test the customer must perform, or open free-text; never pre-answerable.

## Triage table

| question_id | category | slug | question (abbrev) | class | required_facts | derivation_note |
|---|---|---|---|---|---|---|
| 104 | noise | rattling_underneath_the_car | front/middle/rear underside? | **SAFE** | `[location_axle]` | Axle dimension; any stated front/rear value IS the answer. 'middle' has no slot value → only causes over-ask (safe), never wrong-skip. `location_axle` is set solely by axle statements, so no cross-dimension skip path. |
| 72 | noise | engine_ticking_or_tapping | tick speed changes with the gas? | NO-SLOT | — (pending `noise_rpm_link`) | RPM/throttle-linkage of a noise not expressible in 29 slots. `onset_timing=when_accelerating` is "when it occurs", not "does its rate track RPM". Propose `noise_rpm_link`. |
| 73 | noise | engine_ticking_or_tapping | top vs lower engine? | NO-SLOT | — | Vertical engine zone; `sound_or_smoke_location_zone=under_hood` too coarse. Rarely stated literally. |
| 74 | noise | engine_ticking_or_tapping | last oil change (interval)? | NO-SLOT | — | Maintenance interval bucket; `recent_action=oil_change` is an event flag, not the <3mo/3-6/>6 interval. |
| 75 | noise | engine_ticking_or_tapping | oil-pressure light flicker? | PARTIAL | — | Specific-light probe. `warning_light_named` is one free-text slot; presence of a *different* light (e.g. 'check engine') would wrong-skip. |
| 78 | noise | clunking_over_bumps | every bump vs only big bumps? | NO-SLOT | — | Bump-severity threshold; no slot. |
| 81 | noise | clunking_over_bumps | bouncy/unsettled after bumps? | PARTIAL | — | Secondary shock/strut probe; no slot, must ask. |
| 82 | noise | clunking_over_bumps | also clunks starting/stopping from moving? | PARTIAL | — | Additional-trigger yes/no; `onset_timing` single-select → presence unsafe. |
| 85 | noise | humming_or_whirring_at_speed | louder the faster you drive? | NO-SLOT | — | Speed-*dependence* yes/no; `speed_band` records which band, not dependence. |
| 86 | noise | humming_or_whirring_at_speed | changes turning L vs R? | NO-SLOT | — | Wheel-bearing turn-load discriminator; no slot. |
| 87 | noise | humming_or_whirring_at_speed | one specific wheel vs vague? | PARTIAL | — | `sound_or_smoke_location_zone` overloaded (under_hood/vents/…); presence ≠ "specific wheel". |
| 88 | noise | humming_or_whirring_at_speed | same when coasting (foot off gas)? | NO-SLOT | — | Drive-vs-coast load; no slot. |
| 89 | noise | humming_or_whirring_at_speed | new tires recently OR uneven wear? | PARTIAL | — | OR-design (`recent_action=tire_*` OR `tire_state=uneven_wear`); AND-only mapper can't express an OR. |
| 90 | noise | humming_or_whirring_at_speed | vibration through floor/seat too? | NO-SLOT | — | Multi-select; no slot. |
| 91 | noise | humming_or_whirring_at_speed | quieter stopped at a light? | NO-SLOT | — | Speed-dependence; no slot. |
| 92 | noise | high_pitched_whining_under_the_hood | whine tracks engine speed? | NO-SLOT | — (pending `noise_rpm_link`) | Same RPM-linkage gap as 72. |
| 93 | noise | high_pitched_whining_under_the_hood | louder when turning (parking)? | PARTIAL | — | PS-pump cue; no slot; `onset_timing=when_turning` overloaded/unsafe. |
| 96 | noise | high_pitched_whining_under_the_hood | battery light OR dim headlights? | PARTIAL | — | OR of specific-light + `lights_state`; unsafe + OR. |
| 97 | noise | high_pitched_whining_under_the_hood | from the front where belts are? | PARTIAL | — | `sound_or_smoke_location_zone=under_hood` is a given for this subcat; not discriminating. |
| 101 | noise | rattling_underneath_the_car | tinny vs heavy clang? | NO-SLOT | — | Rattle sub-quality; `noise_descriptor=rattling` (subcat) doesn't split tinny/clang. |
| 102 | noise | rattling_underneath_the_car | worse when revved? | NO-SLOT | — (pending `noise_rpm_link`) | RPM-linkage gap. |
| 106 | noise | hissing_noise | engine-off after shutdown vs only running? | NO-SLOT | — | "Occurs with engine off" not a slot value. |
| 108 | noise | hissing_noise | rough idle OR warning light? | PARTIAL | — | OR (`engine_running=rough_idle` OR light); unsafe. |
| 109 | noise | hissing_noise | temp gauge high OR steam? | PARTIAL | — | OR; temp-gauge reading not slottable (only warning_light 'temp'). |
| 111 | noise | hissing_noise | AC still cold vs weaker? | PARTIAL | — | Cross-HVAC probe; `airflow_state`/`hvac_mode` presence unsafe in a hissing subcat. |
| 112 | noise | hissing_noise | topped coolant/refrigerant recently? | PARTIAL | — | `recent_action` specific value (ac_recharge) — presence of any other event wrong-skips. |
| 113 | noise | popping_or_clicking_when_turning | sharp (parking-lot) vs also gentle turns? | NO-SLOT | — | Turn-severity; no slot. |
| 114 | noise | popping_or_clicking_when_turning | louder one direction? | NO-SLOT | — | Turn-direction loudness; no slot. |
| 115 | noise | popping_or_clicking_when_turning | faster/louder the tighter you turn? | NO-SLOT | — | CV-joint cue; no slot. |
| 116 | noise | popping_or_clicking_when_turning | forward, reverse, or both? | NO-SLOT | — | Drive-direction trigger; no slot. |
| 117 | noise | popping_or_clicking_when_turning | grease on back of wheel/inside tire? | **NEVER** | — | CV-boot inspection the customer must perform; not pre-answerable. |
| 123 | noise | deep_knocking_from_the_engine | gas grade / manual recommend higher? | NO-SLOT | — | Fuel grade not a slot. |
| 125 | noise | deep_knocking_from_the_engine | deep thump vs light fast tap? | PARTIAL | — | `noise_descriptor` (knocking_deep vs ticking) *could* split, but customer's vague "knocking" + presence-only risks wrong-skip; keep strict. |
| 126 | noise | deep_knocking_from_the_engine | low on oil / long since change? | NO-SLOT | — | Oil level/interval; no slot. |
| 129 | noise | squeaking_or_creaking_over_bumps | dry rubber vs metal-on-metal? | PARTIAL | — | Noise sub-quality; `noise_descriptor=creaking_or_squeaking` doesn't split. |
| 130 | noise | squeaking_or_creaking_over_bumps | one corner vs all around? | PARTIAL | — | `location_axle=all`→"all around" but front/rear alone is ambiguous for "one corner"; keep strict. |
| 133 | noise | squeaking_or_creaking_over_bumps | worse with passengers/load? | NO-SLOT | — | Load dependence; no slot. |
| 134 | noise | electrical_buzzing | continues after engine off vs stops? | NO-SLOT | — | Engine-off persistence; no slot. |
| 138 | noise | electrical_buzzing | electrical/aftermarket installed recently? | PARTIAL | — | `recent_action` has no aftermarket/electrical value; specific-value presence unsafe. |
| 455 | performance | hesitation_or_lag_when_accelerating | first press vs only hard accel? | NO-SLOT | — | Accel sub-timing; `onset_timing=when_accelerating` can't split initial vs hard. |
| 460 | performance | hesitation_or_lag_when_accelerating | jerks/bucks/stumbles? | PARTIAL | — | `engine_running=misfiring` secondary probe; presence unsafe. |
| 461 | performance | hesitation_or_lag_when_accelerating | all the time vs sometimes? | PARTIAL | — (pending `symptom_constancy`) | `onset_timing` has always/intermittent but is overloaded (likely =when_accelerating here) → unsafe. Propose `symptom_constancy`. |
| 463 | performance | rough_idle_or_shaking_at_a_stop | better/worse in Neutral/Park? | NO-SLOT | — | Mount-vs-internal test; no slot. |
| 468 | performance | rough_idle_or_shaking_at_a_stop | last spark plugs/tune-up? | NO-SLOT | — | Maintenance interval; no slot. |
| 471 | performance | stalling_at_idle_or_when_stopping | restart right away vs wait? | NO-SLOT | — | Hot-restart behavior; no slot. |
| 477 | performance | stalling_while_driving_under_load | dies suddenly vs sputters first? | NO-SLOT | — | Failure-mode nuance; no slot. |
| 480 | performance | stalling_while_driving_under_load | fuel in the tank? | NO-SLOT | — | Fuel level; no slot. |
| 481 | performance | stalling_while_driving_under_load | temp gauge hotter? | NO-SLOT | — | Temp gauge; no slot. |
| 482 | performance | stalling_while_driving_under_load | smoke/smell/noise before it dies? | PARTIAL | — | OR multi-probe; unsafe. |
| 1172 | performance | hard_to_start_when_cold | black smoke OR gas smell on start? | PARTIAL | — | OR (`smoke_color=black` OR `smell_descriptor=gasoline`); AND-only mapper. |
| 1175 | performance | hard_to_start_when_hot | only short-errand restart (gas station)? | NO-SLOT | — | Hot-soak pattern; no slot. |
| 1176 | performance | hard_to_start_when_hot | cranks fine but long to catch? | PARTIAL | — | `engine_running` lacks a "cranks-then-eventually-catches" value. |
| 1178 | performance | hard_to_start_when_hot | starts better pressing gas partway? | NO-SLOT | — | No slot. |
| 1182 | performance | low_power_or_wont_accelerate_normally | power loss constant vs comes-and-goes? | PARTIAL | — (pending `symptom_constancy`) | Constancy; onset_timing overloaded → propose `symptom_constancy`. |
| 1183 | performance | low_power_or_wont_accelerate_normally | revs high but no speed? | NO-SLOT | — | Slipping-trans cue; no slot. |
| 1185 | performance | low_power_or_wont_accelerate_normally | mpg drop with power loss? | NO-SLOT | — | No slot. |
| 1186 | performance | low_power_or_wont_accelerate_normally | feels stuck in a lower gear? | NO-SLOT | — | No slot. |
| 1195 | performance | surging_or_rpms_going_up_and_down | lurching at low speed w/o gas? | NO-SLOT | — | No slot. |
| 513 | performance | engine_misfire_or_bucking_feeling | certain speeds / hard accel / random? | PARTIAL | — | Multi-trigger; `speed_band`/`onset_timing` overloaded → unsafe. |
| 516 | performance | engine_misfire_or_bucking_feeling | last spark plugs? | NO-SLOT | — | Maintenance interval; no slot. |
| 183 | pulling | pulling_only_when_braking | braking-only vs also cruising? | PARTIAL | — | `onset_timing=when_braking` is a given for this subcat; can't confirm "also cruising". |
| 184 | pulling | pulling_only_when_braking | harder pull the harder you brake? | NO-SLOT | — | Intensity-vs-force; no slot. |
| 186 | pulling | pulling_only_when_braking | one wheel hotter afterward? | **NEVER** | — | Active touch test the customer must perform; not pre-answerable. |
| 187 | pulling | pulling_only_when_braking | burning smell/smoke after a drive? | PARTIAL | — | Secondary smell/smoke probe; presence unsafe. |
| 188 | pulling | pulling_only_when_braking | wheel jerk immediate vs gradual? | NO-SLOT | — | No slot. |
| 196 | pulling | steady_drift_while_cruising | drifts on a flat empty lot? | **NEVER** | — | Driving experiment the customer must run; not pre-answerable. |
| 198 | pulling | pulling_only_during_acceleration | wheel tug when accelerating? | NO-SLOT | — | Torque-steer; no slot. |
| 199 | pulling | pulling_only_during_acceleration | straightens when easing off gas? | NO-SLOT | — | No slot. |
| 200 | pulling | pulling_only_during_acceleration | pulls opposite when slowing? | NO-SLOT | — | No slot. |
| 201 | pulling | pulling_only_during_acceleration | FWD + always vs recent? | PARTIAL | — | Drive-layout not a slot (`vehicle_powertrain`=fuel type); `started_when` only partial + OR-design. |
| 1224 | pulling | drift_that_follows_the_roads_slope | on flat lot, still pulls? | **NEVER** | — | Driving experiment; not pre-answerable. |
| 1225 | pulling | drift_that_follows_the_roads_slope | only certain roads/lanes? | NO-SLOT | — | Road-crown confirmation; no slot. |
| 1226 | pulling | drift_that_follows_the_roads_slope | direction changes by lane/road? | NO-SLOT | — | No slot. |
| 1227 | pulling | drift_that_follows_the_roads_slope | constant small corrections? | NO-SLOT | — | No slot. |
| 1228 | pulling | drift_that_follows_the_roads_slope | others noticed vs only you? | NO-SLOT | — | No slot. |
| 1230 | pulling | drift_that_follows_the_roads_slope | pull reverses on a tilted road? | NO-SLOT | — | Road-crown confirmation; no slot. |
| 213 | pulling | pull_that_started_after_recent_tire_or_service_work | one tire vs pair vs all? | PARTIAL | — | `recent_action=tire_rotation_or_replacement` lacks a count; can't say how many. |
| 215 | pulling | pull_that_started_after_recent_tire_or_service_work | pulling before the service too? | NO-SLOT | — | Pre-existing-vs-new; no slot. |
| 216 | pulling | pull_that_started_after_recent_tire_or_service_work | shop mention other concerns? | PARTIAL | — | History free-ish; no slot. |
| 217 | pulling | pull_that_started_after_recent_tire_or_service_work | took it back — what did they say? | **NEVER** | — | Open free-text follow-up; must always be asked. |
| 220 | pulling | wandering_or_drifting_in_both_directions | clunk/knock from front over bumps? | PARTIAL | — | Secondary noise probe; `noise_descriptor` overloaded. |
| 221 | pulling | wandering_or_drifting_in_both_directions | worse on rough/uneven road? | NO-SLOT | — | No slot. |
| 227 | smell | sweet_smell_maple_syrup_antifreeze | damp passenger floor? | PARTIAL | — | Heater-core sign; inspection/no slot. |
| 228 | smell | sweet_smell_maple_syrup_antifreeze | windshield fogs inside when dry? | NO-SLOT | — | Heater-core symptom; no slot. |
| 229 | smell | sweet_smell_maple_syrup_antifreeze | added coolant recently? | PARTIAL | — | `recent_action` has no coolant-add value; specific presence unsafe. |
| 232 | smell | burnt_oil_smell | most after hard/long drive? | NO-SLOT | — | Onset-condition; no slot. |
| 235 | smell | burnt_oil_smell | oil spots where you park? | PARTIAL | — | Leak sign; `fluid_color`/`fluid_under_car_location` are a different dimension (color/place) → presence unsafe. |
| 236 | smell | burnt_oil_smell | oil light OR topping off oil? | PARTIAL | — | OR + specific-light; unsafe. |
| 237 | smell | burnt_oil_smell | stronger right after engine off? | NO-SLOT | — | No slot. |
| 243 | smell | gasoline_fuel_smell | gas cap tight / clicks? | NO-SLOT | — | No slot. |
| 247 | smell | rotten_egg_sulfur_smell | after hard driving / traffic? | NO-SLOT | — | Onset-condition; no slot. |
| 250 | smell | rotten_egg_sulfur_smell | worse after a station/brand? | NO-SLOT | — | No slot. |
| 251 | smell | rotten_egg_sulfur_smell | exhaust/cat/emissions work done? | PARTIAL | — | `recent_action` specific value unsafe. |
| 253 | smell | burning_electrical_plastic_smell | flickering lights/blown fuses/warnings? | PARTIAL | — | OR + `lights_state`/warning; unsafe. |
| 256 | smell | burning_electrical_plastic_smell | electrical accessories installed? | PARTIAL | — | `recent_action` lacks value; unsafe. |
| 258 | smell | burning_electrical_plastic_smell | smoke/haze inside the cabin? | PARTIAL | — | `smoke_color`/`sound_or_smoke_location_zone` presence unsafe in a smell subcat. |
| 259 | smell | burning_electrical_plastic_smell | smell stays after cool down? | NO-SLOT | — | No slot. |
| 263 | smell | burning_rubber_hot_brake_smell | squeal/grind/drag from brakes? | PARTIAL | — | Secondary noise probe; unsafe. |
| 264 | smell | burning_rubber_hot_brake_smell | after highway even w/o braking? | NO-SLOT | — | No slot. |
| 265 | smell | burning_rubber_hot_brake_smell | smoke from a wheel or the hood? | PARTIAL | — | `sound_or_smoke_location_zone` overloaded (inside_cabin/vents possible) → presence unsafe. |
| 268 | smell | musty_mildew_smell_from_vents | strongest first seconds fan on? | NO-SLOT | — | Mildew onset cue; no slot. |
| 269 | smell | musty_mildew_smell_from_vents | goes away on fresh vs recirc? | NO-SLOT | — | `hvac_mode` has no fresh/recirc value. |
| 270 | smell | musty_mildew_smell_from_vents | water dripping on your feet? | PARTIAL | — | Drain-clog sign; inspection/no slot. |
| 271 | smell | musty_mildew_smell_from_vents | cabin filter last changed? | NO-SLOT | — | Maintenance interval; no slot. |
| 272 | smell | musty_mildew_smell_from_vents | parked outside / sits unused? | PARTIAL | — | `recent_action=car_sat_unused` only partial; "parked outside" not covered → OR-ish, unsafe. |
| 273 | smell | musty_mildew_smell_from_vents | carpets/seats wet recently? | PARTIAL | — | History; `car_wash_or_driven_through_water` partial, spill/rain not covered. |
| 274 | smell | exhaust_fumes_inside_the_cabin | windows up vs cracked? | NO-SLOT | — | No slot. |
| 275 | smell | exhaust_fumes_inside_the_cabin | worse stopped vs driving? | NO-SLOT | — | No slot. |
| 277 | smell | exhaust_fumes_inside_the_cabin | running louder rumble/hiss? | PARTIAL | — | Secondary noise probe (`noise_descriptor=roaring/hissing`); presence unsafe. |
| 278 | smell | exhaust_fumes_inside_the_cabin | felt lightheaded/dizzy/headache? | **NEVER** | — | SAFETY — CO-exposure self-assessment; must always be asked. |
| 279 | smell | exhaust_fumes_inside_the_cabin | recent exhaust/muffler work? | PARTIAL | — | `recent_action` specific value unsafe. |
| 280 | smell | exhaust_fumes_inside_the_cabin | hatch/trunk/seal damaged? | PARTIAL | — | Inspection sign; no slot. |

## Class totals

| class | count |
|---|---|
| SAFE (tag) | 1 |
| PARTIAL (incl. NO-SLOT, leave empty) | 105 |
| NEVER (`intentionally_empty`) | 6 |
| **total** | **112** |

NEVER ids: 117, 186, 196, 217, 278, 1224.
SAFE ids: 104 → `question.required_facts.set {question_id:104, facts:["location_axle"], skip_class:SAFE}`.

## Proposed new slots

### 1. `noise_rpm_link` — FIRM (unlocks ≥3: q72, q92, q102)
- **op:** `stage3.slot.propose`
- **type:** enum `["tracks_engine_rpm", "independent_of_rpm"]`, nullable.
- **meaning:** does the *rate/pitch of a noise* rise and fall with engine RPM (throttle), independent
  of road speed — the classic "belt/accessory/valvetrain vs road-speed" discriminator.
- **literal_cues:** "ticking speeds up when I rev", "the whine rises with the engine", "gets louder
  when I rev it in park", "hum/rattle is worse when I give it gas but not tied to speed".
- **questions_unlocked:** 72 (tick vs gas), 92 (whine vs engine speed), 102 (rattle worse revved).
- **safe by construction:** dedicated dimension; set only on an RPM-linkage statement, so
  presence-only skipping cannot wrong-skip.

### 2. `symptom_constancy` — CANDIDATE (2 in this subset: q461, q1182; needs ≥3 corroboration)
- **type:** enum `["constant", "intermittent"]`, nullable.
- **meaning:** is the symptom continuous vs comes-and-goes — the "all the time / constant" vs
  "sometimes / comes and goes / random" split that `onset_timing`'s always/intermittent values can't
  serve because `onset_timing` is single-select and usually already consumed by a trigger value.
- **literal_cues:** "it does it all the time", "constant", "only sometimes", "comes and goes",
  "randomly", "on and off".
- **questions_unlocked (this subset):** 461, 1182. **Hold** until the electrical / warning_light /
  vibration triage batches confirm the ≥3 threshold (the "comes and goes" pattern is common there).
  If confirmed, promote to FIRM; otherwise drop.

### Rejected slot ideas (documented so they aren't re-proposed)
- **`maintenance_recency`** (q74, q468, q516, q271) — each targets a *different* component; one
  recency value can't say WHICH service, and presence-only can't bind it to the asked component.
  Better handled by a value-aware mapper reading `recent_action` for the matching component only.
- **`noise_speed_link`** (q85, q91) — only 2 in this subset; under threshold. Revisit if
  humming/vibration batches add more.
- **`temp_gauge_high`** (q109, q481) — only 2; under threshold.
- **`fuel_grade`** (q123), **`fuel_level`** (q480) — singletons.

## Structural findings (highest-leverage, for Chris / Phase 5)

1. **Presence-only mapper is the ceiling.** The overwhelming majority of these 112 (105 PARTIAL) are
   *specific-value* discriminators ("does it ALSO happen when turning?", "constant vs sometimes?",
   "black smoke OR gas smell?"). They can be safely skipped ONLY if the mapper checks the *value*,
   not just presence — e.g. `required_facts: [{slot:"onset_timing", any_of:["when_turning"]}]`. A
   value-aware mapper would convert a large fraction of PARTIAL→SAFE across ALL categories and is a
   bigger lever than any single slot. Recommend prioritizing it before mass-tagging.
2. **`onset_timing` single-select + phantom `trigger_conditions`.** `extracted-facts.ts` line ~160
   tells the model "the mapper will dispatch the rest from `trigger_conditions`" — **but no
   `trigger_conditions` slot exists.** Multi-trigger questions (82, 455, 513, 183, …) are unskippable
   until (a) a multi-value `trigger_conditions` slot is added AND (b) the mapper becomes value-aware
   (a multi-value slot still wrong-skips under presence-only). Fix both together.
3. **OR-design questions can't be expressed.** Several questions bundle two independent facts with OR
   ("new tires OR uneven wear", "black smoke OR gas smell", "battery light OR dim headlights"). The
   AND-only mapper cannot represent them. Either split them into two questions in the catalog, or add
   `any_of` semantics to `required_facts`.
4. **`warning_light_named` / `recent_action` are single slots asked about specific values.** Any
   specific-light or specific-event question is unsafe to tag under presence-only. Value-aware
   matching (or per-value derived booleans) is required to skip these.
