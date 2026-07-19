# Workstream Q - consolidated required_facts triage map (the 48%-over-ask fix)

> **Consolidates** `required-facts-map.q1.md` + `q2.md` + `q3.md` (the 349-question Workstream-Q audit)
> with every `question.required_facts.set` / `question.intentionally_empty` op emitted by the 24 Wave-A
> per-system dossiers (`systems/*.proposals.yaml`). One merged, reconciled row per previously-empty question.
> Generated 2026-07-18 (Phase C). Binds only to slugs/fact-slots in `00-current-scheduler-taxonomy.md`.

## What this map is for

**349 of 729 active concern questions (48%) ship with an EMPTY `required_facts[]`** - the deterministic
fact-mapper (`question-fact-mapper.ts`) can therefore *never* skip them, so the wizard re-asks things the
customer already said. This map classifies every one of the 349 into **SAFE** (tag now, skips today),
**BLOCKED** (would skip, but only once a proposed new slot ships), **PARTIAL** (a slot relates but a
presence-based skip would wrong-skip, leave empty), or **NEVER** (`intentionally_empty` - confirmatory /
safety / no-slot / second-round probe that must always be asked). The headline metric is at the bottom.

## The decisive constraint (why so few are SAFE)

`matchQuestionsToFacts` skips on **PRESENCE, not VALUE** - a slot counts as answered when non-null,
regardless of value. So tagging question Q with slot S causes Q to skip **whenever S has ANY value**. A tag
is SAFE only if *every* value the customer could literally state for S fully answers Q (S dimension == Q
dimension). Under the literalness discipline (wrongful-skip is worse than over-ask), most of the 349 are
second-round diagnostic probes that map to no slot and are never volunteered in opening free-text, so NEVER.

## Reconciliation rule (dossier vs q-map conflicts)

Where a dossier op AND a q-map both classified the same question, **the more conservative class wins**
(conservatism: NEVER > PARTIAL > SAFE; a SAFE that would actually skip is the least conservative). Carve-out:
a dossier SAFE tag whose fact is a *proposed new slot* becomes **BLOCKED** (cannot skip today) not SAFE.
Two conflict classes resulted and are logged below: **6** dossier SAFE proposals downgraded because the q-map
audit flagged a wrong-skip risk, and **47** q-map PARTIALs consolidated to NEVER because a per-system dossier
affirmatively marked them `intentionally_empty` (no usable slot). The related slot the q-map noted is preserved
in the derivation column so a future value-aware mapper can revisit.

## Merged triage table

`class`: SAFE = `question.required_facts.set` now - BLOCKED = SAFE once the named new slot ships -
PARTIAL = leave empty, related slot in parens - NEVER = `question.intentionally_empty`. `new slot?` = yes
when the SAFE-able or related fact is a proposed new slot. Derivation = reconciled reason; bracket = logged conflict.

### brakes  (22 - SAFE 1, PARTIAL 1, NEVER 20)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 624 | high_pitched_squealing | NEVER |  | no | Noise-vs-pedal-pressure behavior; no slot; not volunteered. |
| 628 | high_pitched_squealing | NEVER |  | no | Sit-then-clear pattern ≈ `onset_timing=cold_start` but presence-based tag wrong-skips on any onset value. |
| 630 | metallic_grinding | NEVER | (onset_timing) | no | Frequency probe; `onset_timing`/subcat already implies braking; no slot for "every time". |
| 631 | metallic_grinding | NEVER | (onset_timing) | no | Constant-vs-on-application discriminator; no slot; not volunteered. |
| 633 | metallic_grinding | NEVER |  | no | Tactile-location probe (multi); no slot. |
| 637 | spongy_or_soft_pedal | NEVER |  | no | Physical pump-test; no slot; not volunteered. |
| 639 | spongy_or_soft_pedal | NEVER |  | no | Effectiveness probe; `drivable_state` doesn't capture it; not volunteered. |
| 640 | spongy_or_soft_pedal | NEVER |  | no | Consumable-level check; no slot (see "fluid_level" finding below). |
| 642 | pedal_sinks_to_floor | NEVER |  | no | `pedal_feel` is the subcat-entry slot (≈always present here) → tagging it would auto-skip; probe is distinct from "sinks on press". |
| 643 | pedal_sinks_to_floor | NEVER |  | no | Bypass-direction probe; no slot. |
| 645 | pedal_sinks_to_floor | SAFE | warning_light_named | no | Any named dashboard light ⇒ "yes, there are warning lights." Null (incl. "no lights") ⇒ still ask. Never wrong-skips. |
| 646 | pedal_sinks_to_floor | NEVER |  | no | Return-behavior probe; no slot. |
| 649 | pulsating_or_vibrating_pedal | NEVER |  | no | Pressure-dependence probe; no slot. |
| 651 | pulsating_or_vibrating_pedal | NEVER |  | no | Thermal-fade probe; no slot; not volunteered. |
| 652 | pulsating_or_vibrating_pedal | NEVER |  | no | Onset-pattern probe; presence-based `onset_timing` wrong-skips. |
| 654 | hard_or_unresponsive_pedal | NEVER |  | no | Vacuum-reserve test; no slot; not volunteered. |
| 655 | hard_or_unresponsive_pedal | NEVER |  | no | Booster test; no slot. |
| 656 | hard_or_unresponsive_pedal | NEVER |  | no | Progressive-stiffening probe; no slot. |
| 657 | hard_or_unresponsive_pedal | PARTIAL | (noise_descriptor) | no | Left empty. A stated `noise_descriptor` needn't be brake-related; presence-based tag would wrong-skip. Discovers a NEW symptom → keep asking. |
| 658 | hard_or_unresponsive_pedal | NEVER |  | no | Booster-leak probe; `engine_running=rough_idle` presence wrong-skips + brake-press-specific. |
| 839 | high_pitched_squealing | NEVER |  | no | Cold/warm-dependence probe; presence of `onset_timing` (any value) would wrong-skip; not volunteered. |
| 864 | pulsating_or_vibrating_pedal | NEVER |  | no | Felt-location (multi); no slot. |

### electrical  (19 - PARTIAL 1, NEVER 18)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 527 | slow_crank_sluggish_start | NEVER |  | no | Cold-soak probe; presence-based `onset_timing` wrong-skips. |
| 528 | slow_crank_sluggish_start | NEVER |  | no | No `battery_age` slot (candidate below). |
| 532 | battery_drains_overnight | NEVER |  | no | Drain-rate probe; no slot. |
| 533 | battery_drains_overnight | NEVER |  | no | Charging-vs-drain discriminator; no slot. |
| 534 | battery_drains_overnight | NEVER | (recent_action) | no | Aftermarket-install probe; `recent_action` has no such value. |
| 535 | battery_drains_overnight | NEVER |  | no | Parasitic-draw probe; no slot. |
| 536 | battery_drains_overnight | NEVER |  | no | Relay-hangup probe; no slot. |
| 537 | battery_drains_overnight | NEVER |  | no | Compound (age + prior-replacement history); no slot; even `battery_age` wouldn't fully answer. |
| 553 | multiple_random_electrical_glitches | NEVER |  | no | Enumeration (multi); `accessory_affected` can't hold the full set reliably; core probe. |
| 554 | multiple_random_electrical_glitches | NEVER |  | no | Correlation probe; no slot. |
| 561 | car_died_while_driving_electrical | NEVER |  | no | Fuel-vs-electrical discriminator; `engine_running=died_while_driving` present but doesn't carry manner. |
| 565 | car_died_while_driving_electrical | NEVER |  | no | Load-at-failure probe; no slot. |
| 877 | wont_crank_just_clicks | NEVER |  | no | No `battery_age` slot (candidate below). Presence not derivable from current slots. |
| 880 | wont_crank_just_clicks | NEVER |  | no | Intermittency probe; `engine_running` is subcat-entry (present); no frequency slot. |
| 1632 | accessory_doesnt_work | NEVER |  | no | Scope/count probe; `accessory_affected` names *which*, not the count semantics. |
| 1634 | accessory_doesnt_work | PARTIAL | (recent_action) | no | Left empty. `recent_action` covers accident/car_wash but not install/spill, and presence of an *unrelated* recent action (e.g. oil_change) would wrong-skip. [+dossier body-electrical-accessories proposed SAFE `recent_action`, downgraded: q-map flagged wrong-skip] |
| 1635 | accessory_doesnt_work | NEVER | (noise_descriptor) | no | Motor-vs-dead probe; no slot. [+dossier body-electrical-accessories proposed SAFE `noise_descriptor`, downgraded: q-map flagged wrong-skip] |
| 1636 | accessory_doesnt_work | NEVER |  | no | Accessory-vs-systemic discriminator; no slot. |
| 1637 | accessory_doesnt_work | NEVER |  | no | Diagnostic-history probe; no slot. |

### hvac  (33 - PARTIAL 5, NEVER 28)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 567 | ac_blows_warm_or_hot_air | NEVER |  | no | Cycling probe; no slot; not volunteered. |
| 568 | ac_blows_warm_or_hot_air | NEVER |  | no | Compressor-clutch probe; no slot. |
| 570 | ac_blows_warm_or_hot_air | PARTIAL |  | no | Left empty. Presence with a non-front value (e.g. `under_rear`) would wrong-skip; also a NEW-symptom (leak) discovery. |
| 573 | ac_blows_warm_or_hot_air | NEVER |  | no | Left empty. `airflow_state` describes strength, not per-vent *temperature*; presence wrong-skips. [consolidated PARTIAL->NEVER: hvac-climate marked intentionally_empty] |
| 574 | ac_is_weak_not_cold_enough | NEVER |  | no | Confirms weak-vs-warm (subcat already `ac_is_weak`); no slot. |
| 575 | ac_is_weak_not_cold_enough | NEVER |  | no | Charge-vs-airflow probe; no slot. |
| 576 | ac_is_weak_not_cold_enough | NEVER |  | no | No `cabin_filter_age` slot (candidate below). |
| 596 | foggy_or_hard_to_defog_windows | NEVER | (airflow_state) | no | Mode-routing probe; no slot. |
| 597 | foggy_or_hard_to_defog_windows | NEVER |  | no | Dehumidify probe; no slot. |
| 598 | foggy_or_hard_to_defog_windows | NEVER |  | no | Heater-core-leak sign; no slot; NEW symptom. |
| 599 | foggy_or_hard_to_defog_windows | NEVER |  | no | Heater-core sign; no slot. |
| 600 | foggy_or_hard_to_defog_windows | NEVER | (accessory_affected) | no | Separate-circuit probe; no slot. |
| 601 | foggy_or_hard_to_defog_windows | NEVER |  | no | Humidity-load probe; no slot. |
| 603 | strange_noise_from_vents | NEVER |  | no | Blower-vs-other probe; no slot; not volunteered. |
| 604 | strange_noise_from_vents | NEVER |  | no | Blower-motor probe; no slot. |
| 605 | strange_noise_from_vents | NEVER |  | no | Blend/mode-door probe; no slot. |
| 606 | strange_noise_from_vents | NEVER |  | no | Intake-door probe; no slot. |
| 607 | strange_noise_from_vents | NEVER |  | no | Debris probe; `recent_action` has no such value. |
| 937 | heat_doesnt_work | NEVER |  | no | Degree-of-heat probe; no slot. |
| 939 | heat_doesnt_work | NEVER | (temperature_gauge_state) | yes | Thermostat probe; no gauge-behavior slot. |
| 940 | heat_doesnt_work | NEVER | (coolant_level_state) | yes | Consumable-level check; no slot (see "fluid_level" finding). |
| 941 | heat_doesnt_work | PARTIAL |  | no | Left empty. Same wrong-skip risk as 570; NEW-symptom discovery. |
| 945 | vents_dont_blow_strongly | NEVER |  | no | No `cabin_filter_age` slot (candidate below). |
| 946 | vents_dont_blow_strongly | PARTIAL |  | no | Left empty. `only_one_zone_blows` partially maps, but other `airflow_state` values present would wrong-skip. |
| 947 | vents_dont_blow_strongly | NEVER |  | no | Intake-blockage probe; no slot. |
| 948 | vents_dont_blow_strongly | NEVER |  | no | Blower-bearing probe (NEW symptom); no slot. |
| 950 | vents_dont_blow_strongly | PARTIAL |  | no | Left empty. `no_airflow` maps, but a present `weak_overall`/`only_on_highest_setting` would wrong-skip. |
| 968 | bad_smell_from_vents | NEVER |  | no | Correlation probe; no slot. |
| 969 | bad_smell_from_vents | NEVER |  | no | No `cabin_filter_age` slot (candidate below). |
| 971 | bad_smell_from_vents | NEVER |  | no | Intake-source probe; no slot. |
| 975 | one_zone_works_but_another_doesnt | NEVER |  | no | Blend-actuator probe; no slot. |
| 976 | one_zone_works_but_another_doesnt | NEVER |  | no | Actuator-range probe; no slot. |
| 978 | one_zone_works_but_another_doesnt | PARTIAL |  | no | Left empty. `uneven_temperature_between_zones` is topical but presence-based tag wrong-skips; isolates temp-vs-airflow fault. |

### leak  (29 - BLOCKED 1, PARTIAL 4, NEVER 24)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 324 | brown_or_black_puddle_engine_oil | NEVER |  | no | Confirms `fluid_color=brown_or_black` (subcat-entry); no distinct slot. |
| 325 | brown_or_black_puddle_engine_oil | NEVER |  | no | Left empty. NEW-symptom discovery; presence of an unrelated smell/smoke value would wrong-skip. [consolidated PARTIAL->NEVER: engine-lubrication-oil marked intentionally_empty] |
| 327 | brown_or_black_puddle_engine_oil | NEVER | (oil_consumption_state) | yes | Consumable-level check; no slot (see "fluid_level" finding). |
| 328 | brown_or_black_puddle_engine_oil | NEVER |  | no | Leak-size probe; no slot (only 1 question → below new-slot bar). |
| 329 | brown_or_black_puddle_engine_oil | NEVER |  | no | Leak-timing probe; no slot (`leak_timing` candidate below). |
| 988 | green_orange_yellow_or_pink_puddle_coolant | NEVER | (temperature_gauge_state) | yes | Overheat probe; no gauge/overheat slot. |
| 990 | green_orange_yellow_or_pink_puddle_coolant | NEVER | (coolant_level_state) | yes | Consumable-level check; no slot. |
| 991 | green_orange_yellow_or_pink_puddle_coolant | NEVER |  | no | Left empty. `steam_thin_wispy` is topical but presence-based tag wrong-skips on other smoke values; NEW symptom. [consolidated PARTIAL->NEVER: cooling-system marked intentionally_empty] |
| 992 | green_orange_yellow_or_pink_puddle_coolant | PARTIAL |  | no | Left empty. Compound (fog AND sweet smell); `sweet_or_maple_syrup` partial only; wrong-skip risk. |
| 995 | red_or_pink_puddle_transmission_or_power_steering | BLOCKED | (new) transmission_behavior | yes | Trans-drivability (NEW symptom); no slot. [pending slot; source: automatic-transmission] |
| 997 | red_or_pink_puddle_transmission_or_power_steering | NEVER |  | no | Consumable-level check; no slot. |
| 998 | red_or_pink_puddle_transmission_or_power_steering | NEVER |  | no | Leak-timing probe; no slot (`leak_timing` candidate below). |
| 999 | red_or_pink_puddle_transmission_or_power_steering | NEVER |  | no | Leak-timing probe; no slot (`leak_timing` candidate below). |
| 1003 | clear_yellow_or_light_brown_puddle_brake_fluid | NEVER | (fluid_color) | no | Confirms `fluid_color=clear_yellow_or_light_brown` (subcat-entry); no distinct slot. [+dossier brakes-friction-hydraulic proposed SAFE `fluid_color`, downgraded: q-map flagged wrong-skip] |
| 1005 | clear_yellow_or_light_brown_puddle_brake_fluid | PARTIAL | (pull_direction) | no | Left empty. NEW-symptom (brake performance); presence-based `pull_direction` wrong-skips (e.g. a non-braking drift). |
| 1006 | clear_yellow_or_light_brown_puddle_brake_fluid | NEVER |  | no | Consumable-level check; no slot. |
| 1023 | blue_or_light_blue_puddle_washer_fluid | NEVER |  | no | Pump/line probe; no slot. |
| 1024 | blue_or_light_blue_puddle_washer_fluid | NEVER |  | no | Consumable-level check; no slot. |
| 1025 | blue_or_light_blue_puddle_washer_fluid | NEVER |  | no | Confirms `fluid_color=blue_or_light_blue` (subcat-entry); no distinct slot. |
| 1026 | blue_or_light_blue_puddle_washer_fluid | NEVER |  | no | Leak-timing probe; no slot (`leak_timing` candidate below). |
| 1736 | clear_odorless_puddle_water_or_ac_condensation | PARTIAL |  | no | Left empty. Key normal-vs-fault discriminator; compound + presence-based wrong-skip → must keep asking. |
| 1739 | clear_odorless_puddle_water_or_ac_condensation | NEVER |  | no | Confirms `fluid_color=clear_no_color` (subcat-entry); no distinct slot. |
| 1740 | clear_odorless_puddle_water_or_ac_condensation | NEVER |  | no | Heater-core-vs-condensation sign; no slot. |
| 1741 | clear_odorless_puddle_water_or_ac_condensation | NEVER |  | no | AC-condensation discriminator; no slot. |
| 1745 | thick_dark_brown_puddle_gear_or_differential_oil | NEVER |  | no | Confirms `fluid_color=thick_dark_brown` (subcat-entry); no distinct slot. |
| 1746 | thick_dark_brown_puddle_gear_or_differential_oil | NEVER |  | no | Bearing/gear NEW symptom; no slot. |
| 1747 | thick_dark_brown_puddle_gear_or_differential_oil | NEVER |  | no | Driveline NEW symptom; no slot. |
| 1748 | thick_dark_brown_puddle_gear_or_differential_oil | PARTIAL |  | no | Left empty. `under_rear` is topical but presence-based tag wrong-skips; "pumpkin housing" is more specific than the slot. |
| 1749 | thick_dark_brown_puddle_gear_or_differential_oil | NEVER |  | no | Load-history probe; `recent_action` has no such value. |

### noise  (39 - SAFE 1, BLOCKED 4, PARTIAL 19, NEVER 15)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 72 | engine_ticking_or_tapping | BLOCKED | (new) noise_rpm_link | yes | RPM/throttle-linkage of a noise not expressible in 29 slots. `onset_timing=when_accelerating` is "when it occurs", not "does its rate track RPM". Propose `noise_rpm_link`. [pending slot; source: engine-mechanical] |
| 73 | engine_ticking_or_tapping | NEVER |  | no | Vertical engine zone; `sound_or_smoke_location_zone=under_hood` too coarse. Rarely stated literally. [consolidated PARTIAL->NEVER: engine-mechanical marked intentionally_empty] |
| 74 | engine_ticking_or_tapping | PARTIAL |  | no | Maintenance interval bucket; `recent_action=oil_change` is an event flag, not the <3mo/3-6/>6 interval. |
| 75 | engine_ticking_or_tapping | PARTIAL | (warning_light_named) | no | Specific-light probe. `warning_light_named` is one free-text slot; presence of a *different* light (e.g. 'check engine') would wrong-skip. |
| 78 | clunking_over_bumps | NEVER |  | no | Bump-severity threshold; no slot. [consolidated PARTIAL->NEVER: suspension-ride-alignment marked intentionally_empty] |
| 81 | clunking_over_bumps | BLOCKED | (new) ride_damping_symptom | yes | Secondary shock/strut probe; no slot, must ask. [pending slot; source: suspension-ride-alignment] |
| 82 | clunking_over_bumps | NEVER | (onset_timing) | no | Additional-trigger yes/no; `onset_timing` single-select → presence unsafe. [consolidated PARTIAL->NEVER: driveline-cv-diff-awd, suspension-ride-alignment marked intentionally_empty] |
| 85 | humming_or_whirring_at_speed | NEVER |  | no | Speed-*dependence* yes/no; `speed_band` records which band, not dependence. [consolidated PARTIAL->NEVER: wheels-tires-tpms-bearings marked intentionally_empty] |
| 86 | humming_or_whirring_at_speed | NEVER |  | no | Wheel-bearing turn-load discriminator; no slot. [consolidated PARTIAL->NEVER: driveline-cv-diff-awd, wheels-tires-tpms-bearings marked intentionally_empty] |
| 87 | humming_or_whirring_at_speed | NEVER |  | no | `sound_or_smoke_location_zone` overloaded (under_hood/vents/…); presence ≠ "specific wheel". [consolidated PARTIAL->NEVER: wheels-tires-tpms-bearings marked intentionally_empty] |
| 88 | humming_or_whirring_at_speed | NEVER |  | no | Drive-vs-coast load; no slot. [consolidated PARTIAL->NEVER: wheels-tires-tpms-bearings marked intentionally_empty] |
| 89 | humming_or_whirring_at_speed | NEVER |  | no | OR-design (`recent_action=tire_*` OR `tire_state=uneven_wear`); AND-only mapper can't express an OR. [consolidated PARTIAL->NEVER: wheels-tires-tpms-bearings marked intentionally_empty] |
| 90 | humming_or_whirring_at_speed | NEVER |  | no | Multi-select; no slot. [consolidated PARTIAL->NEVER: wheels-tires-tpms-bearings marked intentionally_empty] |
| 91 | humming_or_whirring_at_speed | NEVER |  | no | Speed-dependence; no slot. [consolidated PARTIAL->NEVER: wheels-tires-tpms-bearings marked intentionally_empty] |
| 92 | high_pitched_whining_under_the_hood | BLOCKED | (new) noise_rpm_link | yes | Same RPM-linkage gap as 72. [pending slot; source: air-induction-forced-induction] |
| 93 | high_pitched_whining_under_the_hood | PARTIAL | (onset_timing) | no | PS-pump cue; no slot; `onset_timing=when_turning` overloaded/unsafe. |
| 96 | high_pitched_whining_under_the_hood | PARTIAL | (lights_state) | no | OR of specific-light + `lights_state`; unsafe + OR. |
| 97 | high_pitched_whining_under_the_hood | PARTIAL | (sound_or_smoke_location_zone) | no | `sound_or_smoke_location_zone=under_hood` is a given for this subcat; not discriminating. |
| 101 | rattling_underneath_the_car | PARTIAL |  | no | Rattle sub-quality; `noise_descriptor=rattling` (subcat) doesn't split tinny/clang. |
| 102 | rattling_underneath_the_car | BLOCKED | (new) noise_rpm_link | yes | RPM-linkage gap. [pending slot; source: q2-map] |
| 104 | rattling_underneath_the_car | SAFE | location_axle | no | Axle dimension; any stated front/rear value IS the answer. 'middle' has no slot value → only causes over-ask (safe), never wrong-skip. `location_axle` is set solely by axle statements, so no cross-dimension skip path. |
| 106 | hissing_noise | PARTIAL |  | no | "Occurs with engine off" not a slot value. |
| 108 | hissing_noise | PARTIAL |  | no | OR (`engine_running=rough_idle` OR light); unsafe. |
| 109 | hissing_noise | PARTIAL |  | no | OR; temp-gauge reading not slottable (only warning_light 'temp'). |
| 111 | hissing_noise | PARTIAL |  | no | Cross-HVAC probe; `airflow_state`/`hvac_mode` presence unsafe in a hissing subcat. |
| 112 | hissing_noise | PARTIAL |  | no | `recent_action` specific value (ac_recharge) — presence of any other event wrong-skips. |
| 113 | popping_or_clicking_when_turning | PARTIAL |  | no | Turn-severity; no slot. |
| 114 | popping_or_clicking_when_turning | PARTIAL |  | no | Turn-direction loudness; no slot. |
| 115 | popping_or_clicking_when_turning | PARTIAL |  | no | CV-joint cue; no slot. |
| 116 | popping_or_clicking_when_turning | NEVER |  | no | Drive-direction trigger; no slot. [consolidated PARTIAL->NEVER: driveline-cv-diff-awd marked intentionally_empty] |
| 117 | popping_or_clicking_when_turning | NEVER |  | no | CV-boot inspection the customer must perform; not pre-answerable. |
| 123 | deep_knocking_from_the_engine | NEVER |  | no | Fuel grade not a slot. [consolidated PARTIAL->NEVER: engine-mechanical marked intentionally_empty] |
| 125 | deep_knocking_from_the_engine | PARTIAL | (noise_descriptor) | no | `noise_descriptor` (knocking_deep vs ticking) *could* split, but customer's vague "knocking" + presence-only risks wrong-skip; keep strict. [+dossier engine-mechanical proposed SAFE `noise_descriptor`, downgraded: q-map flagged wrong-skip] |
| 126 | deep_knocking_from_the_engine | PARTIAL |  | no | Oil level/interval; no slot. |
| 129 | squeaking_or_creaking_over_bumps | NEVER |  | no | Noise sub-quality; `noise_descriptor=creaking_or_squeaking` doesn't split. [consolidated PARTIAL->NEVER: suspension-ride-alignment marked intentionally_empty] |
| 130 | squeaking_or_creaking_over_bumps | PARTIAL | (location_axle,location_side) | no | `location_axle=all`→"all around" but front/rear alone is ambiguous for "one corner"; keep strict. [+dossier suspension-ride-alignment proposed SAFE `location_side,location_axle`, downgraded: q-map flagged wrong-skip] |
| 133 | squeaking_or_creaking_over_bumps | NEVER |  | no | Load dependence; no slot. [consolidated PARTIAL->NEVER: suspension-ride-alignment marked intentionally_empty] |
| 134 | electrical_buzzing | PARTIAL |  | no | Engine-off persistence; no slot. |
| 138 | electrical_buzzing | PARTIAL |  | no | `recent_action` has no aftermarket/electrical value; specific-value presence unsafe. |

### performance  (21 - BLOCKED 1, PARTIAL 12, NEVER 8)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 455 | hesitation_or_lag_when_accelerating | NEVER |  | no | Accel sub-timing; `onset_timing=when_accelerating` can't split initial vs hard. [consolidated PARTIAL->NEVER: air-induction-forced-induction, ignition-misfire marked intentionally_empty] |
| 460 | hesitation_or_lag_when_accelerating | PARTIAL | (engine_running) | no | `engine_running=misfiring` secondary probe; presence unsafe. |
| 461 | hesitation_or_lag_when_accelerating | PARTIAL | (onset_timing) | no | `onset_timing` has always/intermittent but is overloaded (likely =when_accelerating here) → unsafe. Propose `symptom_constancy`. |
| 463 | rough_idle_or_shaking_at_a_stop | NEVER | (engine_running) | no | Mount-vs-internal test; no slot. [consolidated PARTIAL->NEVER: engine-controls-driveability, ignition-misfire marked intentionally_empty] |
| 468 | rough_idle_or_shaking_at_a_stop | NEVER | (recent_action) | no | Maintenance interval; no slot. [consolidated PARTIAL->NEVER: engine-controls-driveability, ignition-misfire marked intentionally_empty] |
| 471 | stalling_at_idle_or_when_stopping | NEVER |  | no | Hot-restart behavior; no slot. [consolidated PARTIAL->NEVER: fuel-system-evap marked intentionally_empty] |
| 477 | stalling_while_driving_under_load | PARTIAL |  | no | Failure-mode nuance; no slot. |
| 480 | stalling_while_driving_under_load | NEVER |  | no | Fuel level; no slot. [consolidated PARTIAL->NEVER: engine-controls-driveability marked intentionally_empty] |
| 481 | stalling_while_driving_under_load | PARTIAL |  | no | Temp gauge; no slot. |
| 482 | stalling_while_driving_under_load | PARTIAL |  | no | OR multi-probe; unsafe. |
| 513 | engine_misfire_or_bucking_feeling | PARTIAL | (onset_timing) | no | Multi-trigger; `speed_band`/`onset_timing` overloaded → unsafe. |
| 516 | engine_misfire_or_bucking_feeling | NEVER | (recent_action) | no | Maintenance interval; no slot. [consolidated PARTIAL->NEVER: engine-controls-driveability, fuel-system-evap, ignition-misfire marked intentionally_empty] |
| 1172 | hard_to_start_when_cold | PARTIAL | (smell_descriptor,smoke_color) | no | OR (`smoke_color=black` OR `smell_descriptor=gasoline`); AND-only mapper. |
| 1175 | hard_to_start_when_hot | PARTIAL |  | no | Hot-soak pattern; no slot. |
| 1176 | hard_to_start_when_hot | PARTIAL |  | no | `engine_running` lacks a "cranks-then-eventually-catches" value. |
| 1178 | hard_to_start_when_hot | NEVER |  | no | No slot. [consolidated PARTIAL->NEVER: fuel-system-evap marked intentionally_empty] |
| 1182 | low_power_or_wont_accelerate_normally | PARTIAL | (onset_timing) | no | Constancy; onset_timing overloaded → propose `symptom_constancy`. |
| 1183 | low_power_or_wont_accelerate_normally | BLOCKED | (new) transmission_behavior/clutch_or_gear_engagement | yes | Slipping-trans cue; no slot. [pending slot; source: automatic-transmission, engine-controls-driveability, manual-trans-clutch] |
| 1185 | low_power_or_wont_accelerate_normally | NEVER | (fuel_economy_change) | yes | No slot. [consolidated PARTIAL->NEVER: air-induction-forced-induction, engine-controls-driveability, fuel-system-evap marked intentionally_empty] |
| 1186 | low_power_or_wont_accelerate_normally | PARTIAL | (clutch_or_gear_engagement,transmission_behavior) | yes | No slot. |
| 1195 | surging_or_rpms_going_up_and_down | PARTIAL |  | no | No slot. |

### pulling  (22 - BLOCKED 5, PARTIAL 11, NEVER 6)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 183 | pulling_only_when_braking | PARTIAL | (onset_timing) | no | `onset_timing=when_braking` is a given for this subcat; can't confirm "also cruising". |
| 184 | pulling_only_when_braking | PARTIAL |  | no | Intensity-vs-force; no slot. |
| 186 | pulling_only_when_braking | NEVER |  | no | Active touch test the customer must perform; not pre-answerable. |
| 187 | pulling_only_when_braking | PARTIAL |  | no | Secondary smell/smoke probe; presence unsafe. |
| 188 | pulling_only_when_braking | PARTIAL |  | no | No slot. |
| 196 | steady_drift_while_cruising | BLOCKED | (new) pull_road_dependence | yes | Driving experiment the customer must run; not pre-answerable. [pending slot; source: suspension-ride-alignment] |
| 198 | pulling_only_during_acceleration | PARTIAL |  | no | Torque-steer; no slot. |
| 199 | pulling_only_during_acceleration | PARTIAL |  | no | No slot. |
| 200 | pulling_only_during_acceleration | PARTIAL |  | no | No slot. |
| 201 | pulling_only_during_acceleration | PARTIAL |  | no | Drive-layout not a slot (`vehicle_powertrain`=fuel type); `started_when` only partial + OR-design. |
| 213 | pull_that_started_after_recent_tire_or_service_work | PARTIAL |  | no | `recent_action=tire_rotation_or_replacement` lacks a count; can't say how many. |
| 215 | pull_that_started_after_recent_tire_or_service_work | PARTIAL |  | no | Pre-existing-vs-new; no slot. |
| 216 | pull_that_started_after_recent_tire_or_service_work | PARTIAL |  | no | History free-ish; no slot. |
| 217 | pull_that_started_after_recent_tire_or_service_work | NEVER |  | no | Open free-text follow-up; must always be asked. |
| 220 | wandering_or_drifting_in_both_directions | NEVER |  | no | Secondary noise probe; `noise_descriptor` overloaded. [consolidated PARTIAL->NEVER: suspension-ride-alignment marked intentionally_empty] |
| 221 | wandering_or_drifting_in_both_directions | NEVER |  | no | No slot. [consolidated PARTIAL->NEVER: suspension-ride-alignment marked intentionally_empty] |
| 1224 | drift_that_follows_the_roads_slope | BLOCKED | (new) pull_road_dependence | yes | Driving experiment; not pre-answerable. [pending slot; source: suspension-ride-alignment] |
| 1225 | drift_that_follows_the_roads_slope | BLOCKED | (new) pull_road_dependence | yes | Road-crown confirmation; no slot. [pending slot; source: suspension-ride-alignment] |
| 1226 | drift_that_follows_the_roads_slope | BLOCKED | (new) pull_road_dependence | yes | No slot. [pending slot; source: suspension-ride-alignment] |
| 1227 | drift_that_follows_the_roads_slope | NEVER |  | no | No slot. [consolidated PARTIAL->NEVER: suspension-ride-alignment marked intentionally_empty] |
| 1228 | drift_that_follows_the_roads_slope | NEVER |  | no | No slot. [consolidated PARTIAL->NEVER: suspension-ride-alignment marked intentionally_empty] |
| 1230 | drift_that_follows_the_roads_slope | BLOCKED | (new) pull_road_dependence | yes | Road-crown confirmation; no slot. [pending slot; source: suspension-ride-alignment] |

### smell  (30 - PARTIAL 19, NEVER 11)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 227 | sweet_smell_maple_syrup_antifreeze | PARTIAL |  | no | Heater-core sign; inspection/no slot. |
| 228 | sweet_smell_maple_syrup_antifreeze | PARTIAL |  | no | Heater-core symptom; no slot. |
| 229 | sweet_smell_maple_syrup_antifreeze | PARTIAL | (coolant_level_state) | yes | `recent_action` has no coolant-add value; specific presence unsafe. |
| 232 | burnt_oil_smell | NEVER |  | no | Onset-condition; no slot. [consolidated PARTIAL->NEVER: engine-lubrication-oil marked intentionally_empty] |
| 235 | burnt_oil_smell | NEVER |  | no | Leak sign; `fluid_color`/`fluid_under_car_location` are a different dimension (color/place) → presence unsafe. [consolidated PARTIAL->NEVER: engine-lubrication-oil marked intentionally_empty] |
| 236 | burnt_oil_smell | NEVER |  | no | OR + specific-light; unsafe. [consolidated PARTIAL->NEVER: engine-lubrication-oil marked intentionally_empty] |
| 237 | burnt_oil_smell | NEVER |  | no | No slot. [consolidated PARTIAL->NEVER: engine-lubrication-oil marked intentionally_empty] |
| 243 | gasoline_fuel_smell | NEVER |  | no | No slot. [consolidated PARTIAL->NEVER: fuel-system-evap marked intentionally_empty] |
| 247 | rotten_egg_sulfur_smell | NEVER |  | no | Onset-condition; no slot. [consolidated PARTIAL->NEVER: exhaust-emissions marked intentionally_empty] |
| 250 | rotten_egg_sulfur_smell | PARTIAL | (recent_action) | no | No slot. |
| 251 | rotten_egg_sulfur_smell | NEVER |  | no | `recent_action` specific value unsafe. [consolidated PARTIAL->NEVER: exhaust-emissions marked intentionally_empty] |
| 253 | burning_electrical_plastic_smell | PARTIAL |  | no | OR + `lights_state`/warning; unsafe. |
| 256 | burning_electrical_plastic_smell | PARTIAL |  | no | `recent_action` lacks value; unsafe. |
| 258 | burning_electrical_plastic_smell | PARTIAL |  | no | `smoke_color`/`sound_or_smoke_location_zone` presence unsafe in a smell subcat. |
| 259 | burning_electrical_plastic_smell | PARTIAL |  | no | No slot. |
| 263 | burning_rubber_hot_brake_smell | PARTIAL | (noise_descriptor) | no | Secondary noise probe; unsafe. |
| 264 | burning_rubber_hot_brake_smell | PARTIAL |  | no | No slot. |
| 265 | burning_rubber_hot_brake_smell | PARTIAL | (sound_or_smoke_location_zone) | no | `sound_or_smoke_location_zone` overloaded (inside_cabin/vents possible) → presence unsafe. |
| 268 | musty_mildew_smell_from_vents | PARTIAL |  | no | Mildew onset cue; no slot. |
| 269 | musty_mildew_smell_from_vents | NEVER |  | no | `hvac_mode` has no fresh/recirc value. [consolidated PARTIAL->NEVER: hvac-climate marked intentionally_empty] |
| 270 | musty_mildew_smell_from_vents | PARTIAL |  | no | Drain-clog sign; inspection/no slot. |
| 271 | musty_mildew_smell_from_vents | PARTIAL |  | no | Maintenance interval; no slot. |
| 272 | musty_mildew_smell_from_vents | PARTIAL |  | no | `recent_action=car_sat_unused` only partial; "parked outside" not covered → OR-ish, unsafe. |
| 273 | musty_mildew_smell_from_vents | PARTIAL |  | no | History; `car_wash_or_driven_through_water` partial, spill/rain not covered. |
| 274 | exhaust_fumes_inside_the_cabin | NEVER |  | no | No slot. [consolidated PARTIAL->NEVER: exhaust-emissions marked intentionally_empty] |
| 275 | exhaust_fumes_inside_the_cabin | PARTIAL | (speed_band) | no | No slot. |
| 277 | exhaust_fumes_inside_the_cabin | PARTIAL | (noise_descriptor) | no | Secondary noise probe (`noise_descriptor=roaring/hissing`); presence unsafe. |
| 278 | exhaust_fumes_inside_the_cabin | NEVER |  | no | SAFETY — CO-exposure self-assessment; must always be asked. |
| 279 | exhaust_fumes_inside_the_cabin | PARTIAL | (recent_action) | no | `recent_action` specific value unsafe. |
| 280 | exhaust_fumes_inside_the_cabin | NEVER |  | no | Inspection sign; no slot. [consolidated PARTIAL->NEVER: exhaust-emissions marked intentionally_empty] |

### smoke  (17 - BLOCKED 1, NEVER 16)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 282 | white_smoke_from_tailpipe | BLOCKED | (new) symptom_warmup_trend | yes | Persistence distinguishes condensation from head-gasket coolant burn. `smoke_color=steam_thin_wispy` hints transient but doesn't confirm persistence-when-warm; no slot holds "persists after warmup". Ask. [pending slot; source: engine-mechanical] |
| 284 | white_smoke_from_tailpipe | NEVER | (coolant_level_state) | yes | Coolant-top-off history; `recent_action` has no coolant value and this is chronic, not a stated event. |
| 285 | white_smoke_from_tailpipe | NEVER | (temperature_gauge_state) | yes | Gauge-trend observation, not a named dash light; no slot. |
| 287 | white_smoke_from_tailpipe | NEVER |  | no | Inspection prompt; never in opening text. |
| 290 | blue_or_gray_smoke_from_tailpipe | NEVER |  | no | Deceleration-smoke cue (valve seals); `onset_timing` has no "when_decelerating" value. |
| 291 | blue_or_gray_smoke_from_tailpipe | NEVER | (oil_consumption_state) | yes | Oil-consumption history; no slot. |
| 294 | blue_or_gray_smoke_from_tailpipe | NEVER |  | no | Inspection prompt. |
| 297 | black_smoke_from_tailpipe | NEVER | (fuel_economy_change) | yes | Economy-trend history; no slot. |
| 299 | black_smoke_from_tailpipe | NEVER |  | no | Maintenance history; no slot. |
| 303 | smoke_from_under_the_hood | NEVER | (temperature_gauge_state) | yes | Compound gauge+light sequence; safety-diagnostic, always ask. |
| 305 | smoke_from_under_the_hood | NEVER |  | no | Under-hood localization; no slot (`sound_or_smoke_location_zone` is coarse — under_hood only). |
| 308 | smoke_from_under_the_hood | NEVER |  | no | Compound noise+smoke diagnostic; `noise_descriptor` alone can't answer. |
| 311 | smoke_or_burning_smell_from_a_wheel | NEVER |  | no | Hands-on inspection prompt. |
| 315 | smoke_or_burning_smell_from_a_wheel | NEVER |  | no | Situational precursor; no slot. |
| 318 | smoke_or_strong_smell_inside_the_cabin | NEVER |  | no | Seasonal-first-use cue (dust burn-off); no slot combines hvac_mode+seasonal-first. |
| 319 | smoke_or_strong_smell_inside_the_cabin | NEVER |  | no | Compound electrical safety screen; always ask. |
| 321 | smoke_or_strong_smell_inside_the_cabin | NEVER |  | no | HVAC-source confirmation; no slot. |

### steering  (21 - BLOCKED 3, PARTIAL 1, NEVER 17)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 665 | hard_to_turn_heavy_steering | NEVER |  | no | `started_when=since_purchase`→"always" is fairly safe, but "quit recently" needs a prior-good-state the slot can't assert (gradually vs sudden). Ask. [consolidated PARTIAL->NEVER: steering-power-steering marked intentionally_empty] |
| 666 | hard_to_turn_heavy_steering | NEVER | (warning_light_named) | no | Compound electrical screen (EPS-vs-charging cross-check); always ask. |
| 667 | loose_or_sloppy_steering | NEVER | (steering_feel) | no | Free-play confirmation; `steering_feel=loose_or_sloppy` routes here but doesn't literally confirm on-center play. [+dossier steering-power-steering proposed SAFE `steering_feel`, downgraded: q-map flagged wrong-skip] |
| 668 | loose_or_sloppy_steering | NEVER |  | no | Symptom-refinement of looseness; not literally stated. |
| 669 | loose_or_sloppy_steering | NEVER | (steering_feel) | no | Symptom-refinement; not literally stated. |
| 671 | loose_or_sloppy_steering | NEVER | (tire_state) | no | Inspection prompt. |
| 673 | loose_or_sloppy_steering | NEVER |  | no | Mileage + service history; no slot. |
| 679 | steering_wheel_off_center_when_driving_straight | NEVER |  | no | Tire-set inventory; no slot. |
| 680 | steering_wheel_off_center_when_driving_straight | NEVER |  | no | Maintenance history; no slot. |
| 683 | noise_when_turning_the_steering_wheel | NEVER |  | no | Diagnostic maneuver (PS pump vs CV); no slot. |
| 684 | noise_when_turning_the_steering_wheel | NEVER |  | no | Stationary-vs-rolling split; `speed_band=stopped`+`when_turning` not literally stated for a noise. |
| 686 | noise_when_turning_the_steering_wheel | NEVER |  | no | Inspection prompt. |
| 690 | steering_wheel_shakes_at_highway_speed | NEVER |  | no | Diagnostic maneuver; no slot. |
| 691 | steering_wheel_shakes_at_highway_speed | PARTIAL |  | no | Vibration-locus (see new-slots). Multi-location: "steering wheel shakes" doesn't rule out whole-car. Wrongful-skip → ask. |
| 697 | pulling_drifting_or_wandering_on_the_road | NEVER |  | no | Road-crown vs true pull. `pull_direction` gives direction, not crown-dependence; no slot for road-slope. Ask. [consolidated PARTIAL->NEVER: steering-power-steering marked intentionally_empty] |
| 702 | clunking_knocking_or_rough_ride_over_bumps | NEVER |  | no | Severity-threshold refinement; no slot. |
| 703 | clunking_knocking_or_rough_ride_over_bumps | BLOCKED | (new) ride_damping_symptom | yes | Shock bounce-test; no slot. [pending slot; source: suspension-ride-alignment] |
| 704 | clunking_knocking_or_rough_ride_over_bumps | BLOCKED | (new) ride_damping_symptom | yes | Weight-transfer diagnostic; no slot. [pending slot; source: suspension-ride-alignment] |
| 705 | clunking_knocking_or_rough_ride_over_bumps | BLOCKED | (new) ride_damping_symptom | yes | Body-roll diagnostic; no slot. [pending slot; source: suspension-ride-alignment] |
| 707 | clunking_knocking_or_rough_ride_over_bumps | NEVER |  | no | Inspection prompt. |
| 708 | clunking_knocking_or_rough_ride_over_bumps | NEVER |  | no | Mileage + service history; no slot. |

### tires  (21 - PARTIAL 2, NEVER 19)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 711 | visible_damage_nail_screw_bulge_cut | NEVER |  | no | Repairability split (sidewall = not repairable). `tire_state=visible_damage` doesn't localize; no tire-zone slot (only 1 Q — extend not warranted). |
| 714 | visible_damage_nail_screw_bulge_cut | NEVER |  | no | Logistics; no slot. |
| 718 | tire_going_flat_losing_air | NEVER |  | no | Leak-rate history; no slot. |
| 719 | tire_going_flat_losing_air | NEVER |  | no | Leak-onset detail; `noise_descriptor=hissing` rarely literal for a tire, compound. |
| 730 | uneven_tire_wear_bald_spots | NEVER |  | no | Wear-pattern localization (alignment vs pressure vs balance); no slot. |
| 732 | uneven_tire_wear_bald_spots | NEVER |  | no | Hands-on inspection prompt. |
| 734 | uneven_tire_wear_bald_spots | PARTIAL |  | no | Vibration-locus (see new-slots). Multi-location wrongful-skip → ask. |
| 736 | uneven_tire_wear_bald_spots | NEVER |  | no | Mileage history; no slot. |
| 738 | dry_rot_sidewall_cracking | NEVER |  | no | Severity inspection; no slot. |
| 739 | dry_rot_sidewall_cracking | NEVER |  | no | Age history; no slot. |
| 740 | dry_rot_sidewall_cracking | NEVER |  | no | Chronic-parking; `recent_action=car_sat_unused` is a stated event, not this chronic pattern. |
| 741 | dry_rot_sidewall_cracking | NEVER |  | no | Set-scope; no slot (`location_side`/`_axle` don't cover "all tires cracking"). |
| 743 | dry_rot_sidewall_cracking | NEVER |  | no | Storage-environment; no slot. |
| 745 | just_want_new_tires | NEVER |  | no | Sales-intake; advisor-routed bucket, no test. |
| 746 | just_want_new_tires | NEVER |  | no | Sales-intake preference; no slot. |
| 750 | just_want_new_tires | NEVER |  | no | Sales-intake horizon; no slot. |
| 752 | recent_tire_work_then_new_symptom | NEVER |  | no | `started_when` (days_ago/weeks_ago) tracks SYMPTOM onset, not the work date; near-equal here but not identical. Ask. [consolidated PARTIAL->NEVER: wheels-tires-tpms-bearings marked intentionally_empty] |
| 753 | recent_tire_work_then_new_symptom | NEVER |  | no | Core router question across 5 symptom families; too broad for any single slot. |
| 755 | recent_tire_work_then_new_symptom | PARTIAL |  | no | Vibration-locus (see new-slots). Multi-location wrongful-skip → ask. |
| 756 | recent_tire_work_then_new_symptom | NEVER |  | no | Logistics; no slot. |
| 757 | recent_tire_work_then_new_symptom | NEVER |  | no | Post-service TPMS diagnostic; no slot. |

### vibration  (21 - BLOCKED 3, PARTIAL 3, NEVER 15)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 142 | steering_wheel_shake_at_highway_speed | NEVER |  | no | Speed-window diagnostic (balance); no slot. |
| 143 | steering_wheel_shake_at_highway_speed | NEVER |  | no | Load-vs-speed diagnostic; no slot. |
| 144 | steering_wheel_shake_at_highway_speed | PARTIAL |  | no | Vibration-locus (see new-slots). Multi-location wrongful-skip → ask. |
| 151 | vibration_or_pulsing_when_braking | PARTIAL |  | no | Vibration-locus. `pedal_feel=pulsating` covers the pedal option only; other locations unstated → ask. |
| 152 | vibration_or_pulsing_when_braking | NEVER |  | no | Thermal-warp precursor; no slot. |
| 156 | shaking_at_idle_while_stopped | NEVER |  | no | Mount-vs-internal diagnostic; no slot. |
| 157 | shaking_at_idle_while_stopped | NEVER |  | no | Load-at-idle diagnostic; no slot. |
| 161 | shaking_at_idle_while_stopped | NEVER |  | no | Economy-trend; no slot. |
| 163 | shaking_when_speeding_up_or_going_uphill | NEVER |  | no | Load confirmation; no slot. |
| 164 | shaking_when_speeding_up_or_going_uphill | NEVER |  | no | CV-joint cross-check; compound. |
| 165 | shaking_when_speeding_up_or_going_uphill | NEVER |  | no | Inspection prompt. |
| 167 | shaking_when_speeding_up_or_going_uphill | PARTIAL |  | no | Vibration-locus. Multi-location wrongful-skip → ask. |
| 168 | shaking_when_speeding_up_or_going_uphill | BLOCKED | (new) transmission_behavior/clutch_or_gear_engagement | yes | Compound driveline screen; no slot. [pending slot; source: automatic-transmission, manual-trans-clutch] |
| 169 | shaking_or_bouncing_over_bumps_and_rough_roads | BLOCKED | (new) ride_damping_symptom | yes | Shock bounce-test; no slot. [pending slot; source: suspension-ride-alignment] |
| 170 | shaking_or_bouncing_over_bumps_and_rough_roads | NEVER |  | no | `noise_descriptor=clunking` compound with the bump-ride complaint; add-on diagnostic. |
| 172 | shaking_or_bouncing_over_bumps_and_rough_roads | NEVER |  | no | Baseline-change judgment; no slot. |
| 173 | shaking_or_bouncing_over_bumps_and_rough_roads | NEVER |  | no | Inspection prompt. |
| 174 | shaking_or_bouncing_over_bumps_and_rough_roads | BLOCKED | (new) ride_damping_symptom | yes | Shock diagnostic; no slot. [pending slot; source: suspension-ride-alignment] |
| 1478 | constant_vibration_that_doesnt_change_with_speed | NEVER |  | no | Vibration-locus. Multi-location wrongful-skip → ask. [consolidated PARTIAL->NEVER: wheels-tires-tpms-bearings marked intentionally_empty] |
| 1480 | constant_vibration_that_doesnt_change_with_speed | NEVER |  | no | Steer-load diagnostic; no slot. |
| 1482 | constant_vibration_that_doesnt_change_with_speed | NEVER |  | no | Symptom-refinement; not literally stated. |

### warning_light  (24 - PARTIAL 1, NEVER 23)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 391 | battery_charging_light | NEVER |  | no | Alternator-output diagnostic maneuver; no slot. |
| 393 | oil_pressure_light | NEVER | (oil_consumption_state) | yes | Inspection prompt. |
| 397 | oil_pressure_light | NEVER |  | no | Inspection prompt. |
| 399 | engine_temperature_light | NEVER | (temperature_gauge_state) | yes | Gauge-vs-light split (sensor vs real overheat); no slot. |
| 401 | engine_temperature_light | NEVER | (coolant_level_state) | yes | Inspection prompt. |
| 403 | engine_temperature_light | NEVER |  | no | Low-coolant cue; no slot maps heat-loss to a temp light. |
| 404 | engine_temperature_light | NEVER |  | no | Load precursor; no slot. |
| 409 | tpms_tire_pressure_light | NEVER |  | no | Compound handling screen; no single slot. |
| 413 | abs_anti_lock_brake_light | NEVER |  | no | Safety confirmation; always ask. |
| 414 | abs_anti_lock_brake_light | NEVER |  | no | Co-occurring-light; single `warning_light_named` can't confirm the other's absence → wrongful-skip. Ask. [consolidated PARTIAL->NEVER: abs-traction-stability marked intentionally_empty] |
| 422 | brake_system_red_light | NEVER |  | no | Inspection prompt (safety). |
| 423 | brake_system_red_light | NEVER |  | no | Co-occurring-light; wrongful-skip as above. Ask. [consolidated PARTIAL->NEVER: abs-traction-stability marked intentionally_empty] |
| 424 | brake_system_red_light | NEVER |  | no | Safety confirmation; always ask. |
| 429 | airbag_srs_light | NEVER |  | no | Inspection prompt. |
| 430 | airbag_srs_light | NEVER |  | no | Occupancy-sensor precursor; no slot. |
| 435 | traction_control_stability_light | NEVER |  | no | Co-occurring-light; wrongful-skip as above. Ask. [consolidated PARTIAL->NEVER: abs-traction-stability marked intentionally_empty] |
| 436 | traction_control_stability_light | NEVER |  | no | Symptom screen; no slot. |
| 439 | traction_control_stability_light | NEVER |  | no | User-action check; no slot. |
| 440 | traction_control_stability_light | NEVER |  | no | Compound screen; no single slot. |
| 442 | power_steering_eps_light | NEVER |  | no | `steering_feel=heavy_or_hard_to_turn` confirms heaviness but not the light-correlated timing → ask. [consolidated PARTIAL->NEVER: steering-power-steering marked intentionally_empty] |
| 450 | multiple_warning_lights_at_once | NEVER |  | no | Compound charging-vs-CEL screen; no single slot. |
| 2220 | service_engine_soon_or_maintenance_required_light | NEVER |  | no | Maintenance-interval history; no slot. |
| 2222 | service_engine_soon_or_maintenance_required_light | NEVER |  | no | Maintenance-reminder cue; no slot. |
| 2223 | service_engine_soon_or_maintenance_required_light | PARTIAL |  | no | Co-occurring-light. `warning_light_named` set to one light does NOT confirm the OTHER is absent → wrongful-skip. Ask. |

### other  (30 - NEVER 30)

| qid | subcategory | class | proposed required_facts | new slot? | derivation_note |
|---|---|---|---|---|---|
| 758 | multiple_symptoms_not_sure_what_category | NEVER |  | no | Multi-symptom sequencing; advisor-routed elicitation. |
| 759 | multiple_symptoms_not_sure_what_category | NEVER |  | no | Correlation elicitation; no slot. |
| 760 | multiple_symptoms_not_sure_what_category | NEVER |  | no | Onset-correlation elicitation; no slot. |
| 761 | multiple_symptoms_not_sure_what_category | NEVER |  | no | Multi-axis elicitation across weather/onset/speed; too broad for one slot, and this bucket exists to elicit. |
| 762 | multiple_symptoms_not_sure_what_category | NEVER |  | no | Prioritization intake; no slot. |
| 764 | multiple_symptoms_not_sure_what_category | NEVER |  | no | Screening prompt; `warning_light_*` may be null yet the answer matters — always ask. |
| 765 | after_a_recent_accident_or_impact | NEVER |  | no | Recency + driven-since (safety); compound, always ask. |
| 767 | after_a_recent_accident_or_impact | NEVER |  | no | Safety screen; always ask. |
| 768 | after_a_recent_accident_or_impact | NEVER |  | no | Billing intake; no slot. |
| 770 | after_a_recent_accident_or_impact | NEVER |  | no | Inspection prompt. |
| 771 | after_a_recent_accident_or_impact | NEVER |  | no | Damage inspection; no slot. |
| 772 | after_recent_service_or_repair_work | NEVER |  | no | Provenance intake; no slot. |
| 773 | after_recent_service_or_repair_work | NEVER |  | no | Recency + records intake; no slot. |
| 774 | after_recent_service_or_repair_work | NEVER |  | no | Comeback elicitation; no slot. |
| 775 | after_recent_service_or_repair_work | NEVER |  | no | Onset-vs-service elicitation; no slot. |
| 776 | after_recent_service_or_repair_work | NEVER |  | no | Warranty intake; no slot. |
| 777 | after_recent_service_or_repair_work | NEVER |  | no | Usage intake; no slot. |
| 778 | after_recent_service_or_repair_work | NEVER |  | no | Prior-rec elicitation; no slot. |
| 787 | general_check_up_or_pre_trip_inspection | NEVER |  | no | Maintenance history; no slot. |
| 788 | general_check_up_or_pre_trip_inspection | NEVER |  | no | Open elicitation; no slot. |
| 789 | general_check_up_or_pre_trip_inspection | NEVER |  | no | Mileage; no slot. |
| 790 | general_check_up_or_pre_trip_inspection | NEVER |  | no | Records intake; no slot. |
| 791 | general_check_up_or_pre_trip_inspection | NEVER |  | no | Scope preference intake; no slot. |
| 792 | general_check_up_or_pre_trip_inspection | NEVER |  | no | Scheduling intake; no slot. |
| 793 | car_has_been_sitting_unused_for_a_long_time | NEVER |  | no | Sit-duration; `recent_action=car_sat_unused` flags the event but not duration; advisor-routed. |
| 794 | car_has_been_sitting_unused_for_a_long_time | NEVER |  | no | Storage-environment; no slot. |
| 795 | car_has_been_sitting_unused_for_a_long_time | NEVER |  | no | Prep-step intake; no slot. |
| 798 | car_has_been_sitting_unused_for_a_long_time | NEVER |  | no | Inspection prompt. |
| 1850 | safety_concern_dont_feel_safe_driving_it | NEVER |  | no | **SAFETY** confirmation — must always be asked regardless of prior text. |
| 1853 | safety_concern_dont_feel_safe_driving_it | NEVER |  | no | **SAFETY** confirmation — always ask. |

---

## Coverage stats - the over-ask headline

Of the **349** previously-empty questions:

| class | count | % | meaning |
|---|---:|---:|---|
| **SAFE** (skippable now) | 2 | 0.6% | tag `required_facts` today; every slot value fully answers, mapper skips |
| **BLOCKED** (pending a new slot) | 18 | 5.2% | would skip once a proposed slot ships (noise_rpm_link, ride_damping_symptom, pull_road_dependence, symptom_warmup_trend, transmission_behavior/clutch_or_gear_engagement) |
| **PARTIAL** (leave empty) | 79 | 22.6% | a slot relates but presence-based skip would wrong-skip; revisit under a value-aware mapper |
| **NEVER** (`intentionally_empty`) | 250 | 71.6% | confirmatory / safety / no-slot / never-volunteered second-round probe - must always be asked |
| **total** | 349 | 100% | |

**new slot? = yes** on **34** questions (18 BLOCKED + 16 PARTIALs whose only related slot is a proposed one).

### Immediate over-ask win vs. structural ceiling

- **Skippable today with zero new machinery: 2** (q104 `location_axle`, q645 `warning_light_named`).
- **Unlockable by shipping the 5 firmest proposed slots: +18** (BLOCKED), so **20 total** once slots land.
- The remaining **329** stay always-asked: 79 PARTIAL (blocked on the *presence-vs-value mapper*, not on data)
  and 250 NEVER. **The single biggest lever is not more slots - it is making
  `question-fact-mapper.ts` value-aware** (`required_facts: [{slot, any_of:[...]}]`), which would convert a
  large fraction of the 79 PARTIALs to SAFE. Flagged for Chris / Phase 5 sequencing.

### Per-category breakdown

| category | total | SAFE | BLOCKED | PARTIAL | NEVER |
|---|---:|---:|---:|---:|---:|
| brakes | 22 | 1 | 0 | 1 | 20 |
| electrical | 19 | 0 | 0 | 1 | 18 |
| hvac | 33 | 0 | 0 | 5 | 28 |
| leak | 29 | 0 | 1 | 4 | 24 |
| noise | 39 | 1 | 4 | 19 | 15 |
| performance | 21 | 0 | 1 | 12 | 8 |
| pulling | 22 | 0 | 5 | 11 | 6 |
| smell | 30 | 0 | 0 | 19 | 11 |
| smoke | 17 | 0 | 1 | 0 | 16 |
| steering | 21 | 0 | 3 | 1 | 17 |
| tires | 21 | 0 | 0 | 2 | 19 |
| vibration | 21 | 0 | 3 | 3 | 15 |
| warning_light | 24 | 0 | 0 | 1 | 23 |
| other | 30 | 0 | 0 | 0 | 30 |
| **total** | **349** | **2** | **18** | **79** | **250** |

## Conflicts log (dossier vs q-map)

### A. Dossier SAFE proposals downgraded (6) - q-map audit flagged a wrong-skip

| qid | subcategory | dossier proposed | q-map class | final | why downgraded |
|---|---|---|---|---|---|
| 125 | deep_knocking_from_the_engine | SAFE `noise_descriptor` | PARTIAL | PARTIAL | noise_descriptor can be set by a non-brake/non-engine noise in the same utterance |
| 130 | squeaking_or_creaking_over_bumps | SAFE `location_side,location_axle` | PARTIAL | PARTIAL | a single location_side/axle does not confirm one-corner vs all-around |
| 667 | loose_or_sloppy_steering | SAFE `steering_feel` | NEVER | NEVER | steering_feel=loose routes here but does not literally confirm on-center free-play |
| 1003 | clear_yellow_or_light_brown_puddle_brake_fluid | SAFE `fluid_color` | NEVER | NEVER | fluid_color is the subcategory-entry slot (always set here), tag would auto-skip a confirmation |
| 1634 | accessory_doesnt_work | SAFE `recent_action` | PARTIAL | PARTIAL | recent_action covers accident/car-wash but not install/spill, and an unrelated recent action wrong-skips |
| 1635 | accessory_doesnt_work | SAFE `noise_descriptor` | NEVER | NEVER | no slot captures click/hum/buzz-vs-silent; noise_descriptor presence would wrong-skip |

### B. q-map PARTIAL consolidated to NEVER (47) - a per-system dossier marked `intentionally_empty`

These q-map rows noted a topically-related slot, but a per-system dossier affirmatively judged them un-taggable
(no usable slot / pure second-round probe). Conservative resolution = NEVER; the related slot is retained in
the table derivation column for a future value-aware pass. qids:

73, 78, 82, 85, 86, 87, 88, 89, 90, 91, 116, 123, 129, 133, 220, 221, 232, 235, 236, 237, 243, 247, 251, 269, 274, 280, 325, 414, 423, 435, 442, 455, 463, 468, 471, 480, 516, 573, 665, 697, 752, 991, 1178, 1185, 1227, 1228, 1478

## New-slot dependency summary (BLOCKED unlock map)

| proposed slot | firmness | BLOCKED qids it unlocks | source |
|---|---|---|---|
| `noise_rpm_link` | FIRM (q2-map) | 72, 92, 102 | Workstream-Q q2 |
| `ride_damping_symptom` | dossier-proposed | 81, 169, 174, 703, 704, 705 | suspension-ride-alignment |
| `pull_road_dependence` | dossier-proposed | 196, 1224, 1225, 1226, 1230 | suspension-ride-alignment |
| `symptom_warmup_trend` | dossier-proposed | 282 | engine-mechanical |
| `transmission_behavior` / `clutch_or_gear_engagement` | dossier-proposed | 168, 995, 1183 | automatic-transmission / manual-trans-clutch |

> Each slot must clear the program >=3-question rule and, critically, be a fact a customer would
> *literally volunteer* in opening text (else it sits null under the presence-mapper and skips nothing).
> `noise_rpm_link` is safe-by-construction (dedicated RPM-linkage dimension). The transmission/suspension
> slots are dedicated single-dimension slots, so presence-based skipping cannot wrong-skip once they exist.

## Not counted here (out of scope for the 349)

13 dossier question-ops target qids that already carry `required_facts` (not in the empty 349) or propose
NEW questions (`NEW:adas-q1..q5` on a proposed ADAS subcategory): 76, 122, 135, 276, 281, 376, 394, 514, 556,
602, 648, 1631, 1633. These are catalog-enrichment proposals, tracked in their dossiers, not over-ask fixes.