# Unified customer-concern taxonomy — classifier rebuild

> The de-duplicated, reconciled category → subcategory tree synthesized from the seven domain
> anchor banks in `docs/scheduler/rebuild/anchors/`. This is the canonical namespace the rebuilt
> classifier routes into; the anchor YAMLs bind to these slugs. Companion docs:
> `confusable-matrix.md` (the clarifying-question map) and `safety-flags.md` (the
> advise-immediately hard-branch list).
>
> Synthesized 2026-07-19 from:
> `brakes-steering-suspension-tires` (45 entries) · `engine-running-performance` (17) ·
> `powertrain-transmission-driveline` (27) · `fluids-cooling-fuel-intake` (28) ·
> `electrical-charging-lights` (27) · `hvac-body-adas-safety-ev` (33) ·
> `requests-situational-maintenance` (32) — **209 domain entries → 186 canonical subcategories**
> (9 exact-slug duplicates + 14 near-duplicate merges; log in §Reconciliation).

## Totals

| | |
|---|---|
| **Categories** | **24** (20 symptom + `request` + `situational` + reserved `general_diagnostic` + reserved `out_of_scope`) |
| **Subcategories** | **186** canonical (from 209 domain entries) |
| Customer-voice anchors | 2,018 across all entries |
| Safety-flagged (`advise_immediately`) | 37 unique subcategories → `safety-flags.md` |
| Confusable pairs | 403 unique (+3 within-entry variant splits) → `confusable-matrix.md` |
| New broad categories vs live taxonomy | `adas`, `ev_hybrid` (complete catalog gaps per the KB) |

Legend: ⚠ = `advise_immediately` · **M** = merged from 2+ domain files (see §Reconciliation) · domain key: BST = brakes-steering-suspension-tires, ENG = engine-running-performance, PWT = powertrain-transmission-driveline, FLU = fluids-cooling-fuel-intake, ELE = electrical-charging-lights, HBE = hvac-body-adas-safety-ev, REQ = requests-situational-maintenance.

---

## The tree

### brakes (11)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `high_pitched_squealing` | Brakes squealing / squeaking | | BST |
| `metallic_grinding` | Grinding when braking (metal-on-metal) | ⚠ | BST |
| `pulsating_or_vibrating_pedal` | Brake pedal pulses / vibrates underfoot | | BST |
| `vibration_or_pulsing_when_braking` | Car / steering wheel shakes when braking | | BST |
| `spongy_or_soft_pedal` | Soft / spongy brake pedal | ⚠ | BST |
| `pedal_sinks_to_floor` | Brake pedal sinks to the floor | ⚠ | BST |
| `hard_or_unresponsive_pedal` | Brake pedal stiff / hard to press | ⚠ | BST |
| `grabby_or_jumpy_brakes` | Brakes grab / too touchy (NEW slug) | | BST |
| `pulling_only_when_braking` | Pulls to one side when braking | | BST |
| `brakes_failed_or_gave_out` | Brakes failed / no brakes (NEW slug; safety-path handoff) | ⚠ | BST |
| `parking_brake_stuck_or_wont_release` | Parking brake stuck / won't release (NEW slug) | | BST |

### steering_handling (8)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `hard_to_turn_heavy_steering` | Steering hard to turn / heavy | ⚠ | BST |
| `loose_or_sloppy_steering` | Steering loose / sloppy / too much play | | BST |
| `steering_wheel_off_center_when_driving_straight` | Steering wheel off-center / crooked | | BST |
| `noise_when_turning_the_steering_wheel` | Noise when turning the steering wheel | | BST |
| `steady_drift_while_cruising` | Pulls / drifts to one side while driving | | BST |
| `wandering_or_drifting_in_both_directions` | Wanders / floats both directions | | BST |
| `drift_that_follows_the_roads_slope` | Drifts with the slope of the road (reassurance-leaning) | | BST |
| `pull_that_started_after_recent_tire_or_service_work` | Pull after recent tire / service work | | BST |

### suspension_ride (5)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `clunking_over_bumps` | Clunking / knocking over bumps | | BST |
| `squeaking_or_creaking_over_bumps` | Squeaking / creaking over bumps | | BST |
| `shaking_or_bouncing_over_bumps_and_rough_roads` | Bouncy / harsh ride over bumps | | BST |
| `vehicle_sitting_low_or_leaning_one_corner` | Sitting low / sagging on one corner (NEW slug) | | BST |
| `violent_shake_after_bump_death_wobble` | Death wobble — violent shake after a bump (NEW slug) | ⚠ | BST |

### tires (6)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `tire_going_flat_losing_air` | Tire losing air / going flat | | BST |
| `visible_damage_nail_screw_bulge_cut` | Nail / screw / bulge / cut in tire | | BST |
| `uneven_tire_wear_bald_spots` | Uneven tire wear / bald spots | | BST |
| `dry_rot_sidewall_cracking` | Dry rot / cracked sidewalls | | BST |
| `recent_tire_work_then_new_symptom` | New problem right after tire work | | BST |
| `wheel_or_lug_concern_loose_wheel` | Wheel feels loose / lug nut worry (NEW slug) | ⚠ | BST |

### vibration (5)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `steering_wheel_shake_at_highway_speed` | Steering wheel shakes at highway speed | | BST |
| `constant_vibration_that_doesnt_change_with_speed` | Constant vibration at all speeds | | BST |
| `transmission_shudder` | Shudder when accelerating or cruising (TCC / CVT) | | PWT |
| `cv_axle_accel_shudder` | Shudder on hard acceleration (inner CV) | | PWT |
| `driveline_vibration_at_speed` | Vibration that changes with road speed (driveshaft/u-joint) | | PWT |

### noise (11)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `humming_or_whirring_at_speed` | Hum / drone / roar at speed (wheel bearing or tires) | | BST |
| `humming_or_whining_at_speed_driveline` | Hum / whine rising with speed (hub bearing or differential) | | PWT |
| `engine_ticking_or_tapping` | Ticking or tapping from the engine | | ENG |
| `deep_knocking_from_the_engine` | Deep knocking from the engine | ⚠ | ENG |
| `exhaust_manifold_tick_or_puff` | Exhaust manifold tick / puffing when cold | | ENG |
| `exhaust_louder_or_rumbling` | Exhaust louder than normal / rumbling | | ENG |
| `whistle_or_hiss_under_hood` | Whistling / hissing from the engine (vacuum/boost) | | FLU |
| `transmission_whine_or_noise` | Whining / grinding noise from the transmission | | PWT |
| `clutch_or_trans_noise_pedal_linked` | Noise that changes with the clutch pedal | | PWT |
| `clicking_when_turning` | Clicking / popping when turning (outer CV joint) | | PWT |
| `driveline_clunk_on_takeoff` | Clunk when shifting into gear or taking off | | PWT |

> Deliberate dual-home kept per the powertrain agent: `humming_or_whirring_at_speed`
> (tires/bearings side) and `humming_or_whining_at_speed_driveline` (diff/pinion side) are the SAME
> customer sound with different mechanisms — the steering-sweep and accel/coast/load questions in the
> matrix split them. Do not collapse.

### leak (10)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `clear_yellow_or_light_brown_puddle_brake_fluid` | Brake fluid leak | ⚠ **M** | BST+FLU |
| `red_or_pink_puddle_transmission_or_power_steering` | Red/pink fluid — power steering OR transmission | **M** | BST+PWT+FLU |
| `coolant_puddle_green_orange_pink` | Coolant leak (green/orange/pink/yellow puddle) | | FLU |
| `oil_puddle_brown_black` | Engine oil leak (brown/black puddle) | | FLU |
| `gear_oil_leak` | Thick dark gear-oil leak (diff / manual box) | **M** | PWT+FLU |
| `blue_puddle_washer_fluid` | Washer fluid leak (blue puddle) | | FLU |
| `clear_water_puddle_under_car` | Clear water under car (A/C condensation — normal) | **M** | FLU+HBE |
| `unknown_fluid_puddle` | Fluid leak — not sure what it is | | FLU |
| `water_inside_cabin_ac_on` | Water on the floor when the A/C runs | | HBE |
| `water_leak_into_cabin_rain` | Water leaks into the cabin when it rains | | HBE |

> The red-fluid entry is ONE canonical concern with TWO exits (steering vs transmission), resolved by
> puddle location + steering-feel/shifting symptoms — per the brakes agent's instruction ("keep one
> canonical") and the KB inference trap (a red puddle with explicitly normal steering must not be
> forced into the steering route).

### smell_smoke (10) — unified from ENG's `smell` + others' `smell_smoke`

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `rotten_egg_sulfur_smell` | Rotten-egg / sulfur smell (catalytic converter) | | ENG |
| `exhaust_fumes_inside_the_cabin` | Exhaust smell inside the car (CO risk) | ⚠ | ENG |
| `gasoline_fuel_smell` | Gasoline / fuel smell | ⚠ | FLU |
| `burning_oil_smell` | Burning oil smell | | FLU |
| `sweet_antifreeze_smell` | Sweet / maple-syrup (antifreeze) smell | | FLU |
| `smoke_or_burning_smell_from_a_wheel` | Smoke or burning smell from a wheel (dragging brake) | ⚠ | BST |
| `smoke_or_steam_under_hood` | Smoke or steam from under the hood | ⚠ | FLU |
| `white_smoke_from_tailpipe` | White smoke from the exhaust (coolant in combustion) | ⚠ | FLU |
| `blue_gray_smoke_from_tailpipe` | Blue/gray smoke from the exhaust (burning oil) | | FLU |
| `black_smoke_from_tailpipe` | Black smoke from the exhaust (running rich) | | FLU |

### warning_light (18)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `check_engine_light_steady` | Check engine light (steady) | | ELE |
| `check_engine_light_flashing` | Check engine light FLASHING | ⚠ | ELE |
| `check_engine_light_gas_cap_evap` | CEL after getting gas (gas cap / EVAP) | | FLU |
| `service_or_maintenance_reminder_light` | Service due / maintenance reminder (not a fault) | | ELE |
| `battery_charging_light` | Battery / charging light | ⚠ | ELE |
| `oil_pressure_light` | Oil pressure warning light | ⚠ **M** | FLU+ELE |
| `engine_temperature_light` | Temperature / coolant warning light | ⚠ **M** | FLU+ELE |
| `transmission_overheat_warning` | Transmission hot / temp warning | ⚠ | PWT |
| `tpms_tire_pressure_light` | Tire pressure (TPMS) light | **M** | BST+ELE |
| `abs_anti_lock_brake_light` | ABS light | **M** | BST+ELE |
| `brake_system_red_light` | Red BRAKE warning light | ⚠ **M** | BST+ELE |
| `traction_control_stability_light` | Traction control / stability light | **M** | BST+ELE |
| `power_steering_eps_light` | Power steering / EPS light | **M** | BST+ELE |
| `airbag_srs_light` | Airbag / SRS light | **M** | ELE+HBE |
| `security_anti_theft_light_on` | Security / anti-theft light on (car runs fine) | | HBE |
| `hybrid_system_warning_red_triangle` | Check Hybrid System / red triangle | ⚠ | HBE |
| `multiple_warning_lights_at_once` | Several warning lights at once (charging-cascade arbitration) | ⚠ | ELE |
| `unknown_warning_light` | A light I don't recognize (nickname resolution) | | ELE |

### no_start (7)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `wont_crank_just_clicks` | Won't start — just clicks | | ELE |
| `no_sound_at_all_when_starting` | Won't start — no sound at all | | ELE |
| `slow_crank_sluggish_start` | Starts hard — cranks slowly | | ELE |
| `cranks_but_wont_fire` | Cranks fine but won't start (fuel/spark) | **M** | FLU+ELE |
| `died_while_driving_wont_restart` | Died while driving (electrical signature) | ⚠ | ELE |
| `key_not_recognized_security_no_start` | Won't start — security / key not recognized | | HBE |
| `hybrid_ev_wont_power_on` | Hybrid/EV won't power on / won't go to READY | | HBE |

### performance (11)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `engine_misfire_or_bucking_feeling` | Engine misfiring / bucking / jerking | ⚠ (flashing-CEL variant) | ENG |
| `hesitation_or_lag_when_accelerating` | Hesitates or lags when accelerating | | ENG |
| `rough_idle_or_shaking_at_a_stop` | Rough idle / shaking while stopped | | ENG |
| `stalling_at_idle_or_when_stopping` | Stalls at idle or when coming to a stop | | ENG |
| `stalling_while_driving_under_load` | Engine shuts off while driving | ⚠ | ENG |
| `surging_or_rpms_going_up_and_down` | Idle surging / RPMs hunting | | ENG |
| `low_power_or_wont_accelerate_normally` | Low power / won't accelerate / limp mode | | ENG |
| `turbo_low_power_limp` | Turbo/boost power loss / limp mode | | FLU |
| `hard_to_start_when_cold` | Hard to start cold | | ENG |
| `hard_to_start_when_hot` | Hard to start hot (heat soak) | | ENG |
| `hybrid_ev_reduced_power_turtle` | Hybrid/EV reduced power / turtle mode | ⚠ | HBE |

> Known embedding collision: `turbo_low_power_limp` and `low_power_or_wont_accelerate_normally`
> share near-identical anchors ("wont go over 40", "reduced engine power"). The is-it-turbocharged
> question is the split; on a non-turbo car the turbo entry collapses into the generic one.

### transmission_driveline (14)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `auto_trans_slipping` | Transmission slipping (revs but doesn't pull) | | PWT |
| `harsh_or_jerky_shifting` | Shifts hard / jerks between gears | | PWT |
| `delayed_engagement` | Delay going into Drive or Reverse | | PWT |
| `wont_move_or_no_gear` | Starts but won't move / won't go into gear | ⚠ | PWT |
| `stuck_in_gear_limp_mode` | Stuck in gear / limp mode / speed-capped | ⚠ | PWT |
| `pops_out_of_gear` | Pops / jumps out of gear on its own | ⚠ | PWT |
| `clutch_slipping` | Clutch slipping (manual) | | PWT |
| `grinding_or_hard_shift_manual` | Grinds / hard to shift gears (manual) | | PWT |
| `wont_go_into_gear_manual` | Won't go into gear (manual) | ⚠ | PWT |
| `clutch_chatter_on_takeoff` | Shudders when letting the clutch out | | PWT |
| `clutch_pedal_problem` | Clutch pedal soft / to the floor / stuck | ⚠ | PWT |
| `awd_4x4_not_engaging` | 4WD / AWD won't engage or fault message | | PWT |
| `awd_4x4_binding_in_turns` | Binds / hops in tight turns (stuck in 4WD; posi-chatter look-alike) | | PWT |
| `axle_broke_wont_move` | Loud bang, now it revs but won't move | ⚠ | PWT |

### overheating (1)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `engine_overheating_running_hot` | Engine overheating / running hot (gauge-confirmed) | ⚠ | FLU |

### fluids (2)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `coolant_loss_low_coolant` | Losing coolant / keeps needing top-offs (no puddle) | | FLU |
| `oil_consumption_burning_oil` | Burning / losing oil between changes | | FLU |

### fuel (2)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `trouble_fueling_gas_wont_go_in` | Can't fill the tank / pump keeps clicking off | | FLU |
| `hard_start_after_fueling` | Hard to start right after getting gas (EVAP purge) | | FLU |

> Overlap resolved: ENG's `hard_to_start_when_hot` also carried "after getting gas" anchors. Ruling:
> a fueling-linked hard start (only after fill-ups) routes HERE; heat-soak hard starts with no
> fueling link stay in `performance/hard_to_start_when_hot`. The only-after-fueling question is the split.

### electrical (10)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `battery_drains_overnight` | Battery keeps dying / needs jumps | | ELE |
| `dim_or_flickering_lights` | Lights dim or flicker (charging clue) | | ELE |
| `exterior_light_out` | Headlight / taillight / blinker out | | ELE |
| `power_window_not_working` | Power window won't work | **M** | ELE+HBE |
| `power_locks_not_working` | Power door locks not working | | HBE |
| `wipers_or_washers_not_working` | Wipers or washer not working | | ELE |
| `single_accessory_not_working` | Radio / horn / accessory dead | | ELE |
| `multiple_random_electrical_glitches` | Random electrical gremlins | | ELE |
| `key_fob_remote_not_working` | Key fob / remote not working (car still starts) | | HBE |
| `alarm_going_off_on_its_own` | Alarm goes off by itself / won't disarm | | HBE |

> Dead-fob double-home resolved: the dedicated `key_fob_remote_not_working` entry wins for fob
> complaints where the car still starts; `single_accessory_not_working` keeps non-fob accessories
> only. A dead fob WITH a no-start is `no_start/key_not_recognized_security_no_start`.

### hvac (10)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `ac_blows_warm_or_hot_air` | A/C blows warm or hot air (no cooling) | | HBE |
| `ac_weak_not_cold_enough` | A/C is weak / not cold enough | | HBE |
| `ac_keeps_losing_refrigerant` | A/C keeps losing refrigerant (books a LEAK TEST, not a recharge) | | HBE |
| `no_heat` | Heater blows cold / no heat | **M** | FLU+HBE |
| `weak_airflow_from_vents` | Weak or no airflow (blower/fan) | | HBE |
| `air_from_wrong_vents` | Air comes out the wrong vents / won't switch | | HBE |
| `one_side_hot_one_side_cold` | One side hot, one side cold (dual-zone blend door) | | HBE |
| `bad_smell_from_vents` | Bad smell from the vents | | HBE |
| `foggy_windows_wont_defog` | Windows fog up / defroster won't clear | | HBE |
| `strange_noise_from_vents` | Strange noise from the vents / behind the dash | | HBE |

> `no_heat` ownership resolved per the HBE agent: HVAC owns the complaint; the CAUSE may be
> cooling-side (thermostat, low coolant) — the temp-gauge and coolant-level questions hand off to
> `overheating`/`fluids` when they fire.

### body (3)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `wind_noise_at_speed` | Wind noise / whistle at highway speed | | HBE |
| `door_trunk_hood_latch_problem` | Door / trunk / hood won't open, close, or latch | | HBE |
| `seat_belt_wont_latch_or_retract` | Seat belt won't latch, retract, or release | | HBE |

### adas (3) — NEW category

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `driver_assist_warning_or_malfunction` | Driver-assist warning / feature not working | | HBE |
| `phantom_braking_or_steering` | Car brakes or steers by itself (false activation) | ⚠ | HBE |
| `adas_calibration_after_windshield_or_service` | Calibration after windshield / alignment / repair | | HBE |

### ev_hybrid (3) — NEW category

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `ev_wont_charge` | EV / plug-in won't charge | | HBE |
| `battery_degradation_range_loss` | Hybrid/EV battery losing range or capacity | | HBE |
| `regen_brake_feel_change` | Hybrid/EV brakes feel different (regen handoff — often normal) | | HBE |

> Hybrid/EV concerns that are symptom-shaped live in their symptom categories
> (`no_start/hybrid_ev_wont_power_on`, `performance/hybrid_ev_reduced_power_turtle`,
> `warning_light/hybrid_system_warning_red_triangle`); `ev_hybrid` holds the EV-native concerns
> that have no ICE analog.

### request (21)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `oil_change` | Oil change | **M** | FLU+REQ |
| `scheduled_maintenance_service` | Factory scheduled maintenance | | REQ |
| `tune_up_request` | Tune-up / spark plug replacement | **M** | ENG+REQ |
| `brake_service_request` | Brake check / brake job | **M** | BST+REQ |
| `new_tires_request` | New tires / replacement quote | **M** | BST+REQ |
| `tire_rotation_or_balance` | Tire rotation / wheel balance | **M** | BST+REQ |
| `alignment_request` | Wheel alignment | **M** | BST+REQ |
| `state_inspection_emissions` | State inspection / emissions (regulatory) | | REQ |
| `failed_emissions_test` | Failed emissions — diagnose-and-fix-to-pass (NEW slug) | | ENG |
| `ac_recharge_request` | A/C recharge (surface the leak-vs-recharge question) | | REQ |
| `battery_test_or_replacement` | Battery test / replacement (no symptom) | **M** | ELE+REQ |
| `replace_specific_part` | Replace a specific part | | REQ |
| `fluid_flush_service` | Fluid flush / exchange (generic) | | REQ |
| `transmission_fluid_service` | Transmission fluid service / flush | | PWT |
| `differential_transfer_case_service` | Differential / transfer case fluid service | | PWT |
| `diagnostic_scan_request` | Diagnostic scan / read codes | | REQ |
| `second_opinion` | Second opinion on another shop's diagnosis | | REQ |
| `approve_recommended_work` | Approve previously recommended work | | REQ |
| `estimate_quote_request` | Price quote for a named job | | REQ |
| `recall_or_warranty_question` | Recall / warranty coverage question | | REQ |
| `key_replacement_or_programming` | Need a key / fob made or programmed | | HBE |

> Flush-service overlap resolved: a NAMED fluid routes to the specific service where one exists
> (transmission → `transmission_fluid_service`, diff/transfer case →
> `differential_transfer_case_service`); coolant/brake/unspecified → generic `fluid_flush_service`.
>
> Standing rule (encoded by REQ, restated by every domain): **a named symptom beats request
> framing** — "brakes grinding, need a brake job" routes to the SYMPTOM; the request becomes
> metadata. Bare requests book directly with no diagnostic interview.

### situational (9)

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `after_accident_or_impact` | After an accident / impact (inspect, don't just align) | | REQ |
| `symptom_after_recent_service` | Problem right after recent service / repair | | REQ |
| `car_sat_unused` | Car has been sitting unused | | REQ |
| `pre_trip_inspection` | Pre-trip check | | REQ |
| `pre_purchase_inspection` | Pre-purchase inspection | | REQ |
| `general_checkup` | General check-up / once-over (nothing wrong) | | REQ |
| `multiple_symptoms` | Multiple problems / not sure where to start | | REQ |
| `safety_concern_not_safe_to_drive` | Doesn't feel safe to drive (override) | ⚠ | REQ |
| `breakdown_tow_in` | Broke down / being towed in | ⚠ | REQ |

> Situational cue overrides a symptom route only on a causal tie ("after X, now Y"). A trip/accident
> mentioned as backstory does NOT fire these — the symptom domain wins with the situation as context.

### general_diagnostic (2) — RESERVED

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `vague_concern_needs_triage` | Something's wrong — needs triage | | REQ |
| `intermittent_issue_cant_reproduce` | Intermittent problem — comes and goes | | REQ |

> Doubles as the classifier FALLBACK: any input where no category clears the confidence threshold
> lands in `vague_concern_needs_triage` rather than a low-confidence guess. Triage chips
> (sound / feeling / smell / light / when) take over; the moment a channel is named, the matching
> symptom domain wins.

### out_of_scope (4) — RESERVED

| Subcategory | Display | Flags | Source |
|---|---|---|---|
| `booking_logistics` | Appointment / logistics question | | REQ |
| `non_repair_business` | Business inquiry (hiring, vendors, buy/sell) | | REQ |
| `services_not_offered` | Service this shop doesn't offer (body/paint/glass — shop-configurable referral list) | | REQ |
| `not_a_vehicle_issue` | Not about a vehicle (greetings, tests, spam) | | REQ |

> Never routes to a guessed service. Mixed messages split: refer the cosmetic half, book the
> mechanical half.

---

## Concerns that legitimately span domains (kept as pairs, not merged)

| Concern surface | The two homes | Split fact |
|---|---|---|
| Hum at speed | `noise/humming_or_whirring_at_speed` (bearing/tires) ↔ `noise/humming_or_whining_at_speed_driveline` (diff/pinion) | steering-sweep load change vs accel/coast character |
| Dies while driving | `performance/stalling_while_driving_under_load` (engine sputter) ↔ `no_start/died_while_driving_wont_restart` (electrical/charging) | lights-dimmed/battery-light first vs sputter first |
| Hard start hot | `performance/hard_to_start_when_hot` (heat soak) ↔ `fuel/hard_start_after_fueling` (EVAP purge) | only-after-fueling |
| Low power | `performance/low_power_or_wont_accelerate_normally` ↔ `performance/turbo_low_power_limp` ↔ `transmission_driveline/auto_trans_slipping` | revs-vs-speed relationship; turbo context |
| Emissions | `request/state_inspection_emissions` (routine, regulatory) ↔ `request/failed_emissions_test` (failed, deadline-driven diagnose-to-pass) | already failed vs not yet tested |
| Red fluid | one merged entry, two exits (PS vs trans) | puddle location + steering/shifting symptom |
| Idle shake | `performance/rough_idle_or_shaking_at_a_stop` (engine struggling) ↔ motor-mount shake (**GAP**, below) | engine sounds rough vs sounds normal |
| No heat | `hvac/no_heat` (owner) → hands off to `overheating`/`fluids` | temp gauge high / coolant dropping |
| Brake-fluid-colored clutch leak | `leak/clear_yellow_or_light_brown_puddle_brake_fluid` ↔ `transmission_driveline/clutch_pedal_problem` | which pedal changed + which reservoir drops |
| Wheel-speed-sensor lights | `warning_light/abs_anti_lock_brake_light` + `traction_control_stability_light` co-illumination; hub-bearing hum can set both | one shared sensor fault = ONE booking |

## Reconciliation log (what was merged / resolved)

**Exact-slug duplicates (9)** — two domains each wrote the same slug; merged, confusables unioned:
`tpms_tire_pressure_light`, `abs_anti_lock_brake_light`, `brake_system_red_light`,
`traction_control_stability_light`, `power_steering_eps_light` (all BST+ELE);
`airbag_srs_light`, `power_window_not_working` (ELE+HBE); `oil_pressure_light`,
`engine_temperature_light` (FLU+ELE).

**Near-duplicate merges (14 entries removed, canonical slug in parentheses):**

1. `clear_yellow_light_brown_puddle_brake_fluid` (FLU) → `clear_yellow_or_light_brown_puddle_brake_fluid`
2. `red_pink_puddle_transmission_power_steering` (FLU) → `red_or_pink_puddle_transmission_or_power_steering`
3. `transmission_fluid_leak` (PWT) → same red-fluid canonical (one entry, two exits)
4. `thick_dark_puddle_gear_diff_oil` (FLU) → `gear_oil_leak`
5. `no_heat_from_vents` (FLU) → `no_heat`
6. `clear_water_puddle_ac_condensation` (FLU) → `clear_water_puddle_under_car`
7. `cranks_but_wont_start` (FLU) → `cranks_but_wont_fire`
8. `oil_change_request` (FLU) → `oil_change`
9. `battery_replacement_request` (REQ) → `battery_test_or_replacement`
10. `tune_up_or_spark_plug_replacement` (ENG) → `tune_up_request`
11. `wheel_alignment_request` (BST) → `alignment_request`
12. `tire_rotation_or_balance_request` (BST) → `tire_rotation_or_balance`
13. `brake_check_or_service_request` (BST) → `brake_service_request`
14. `just_want_new_tires` (BST) → `new_tires_request`

**Other conflicts resolved:** ENG's category `smell` folded into `smell_smoke`; dead-fob double-home
(dedicated entry wins over `single_accessory_not_working`); `no_heat` ownership to HVAC with
cooling handoffs; after-fueling hard-start ownership to `fuel`; flush-service specificity rule;
live-taxonomy sibling `clunking_knocking_or_rough_ride_over_bumps` folded into `clunking_over_bumps`
as a hear-vs-feel variant.

## Coverage GAPS — concerns referenced but anchored by NO domain

Referenced as confusable targets (so the question policy depends on them) or excluded by notes, but
no entry exists. Ordered by blast radius; the top three are pre-wired into 24 matrix pairs.

1. **`belt_squeal_underhood_whine`** (engine-accessory belt/pulley squeal & whine, incl. A/C-compressor engage squeal) — referenced by FIVE domains under five different names (`belt_squeal_under_hood`, `squealing_belt_noise`, `belt_squeal_or_whine`, `belt_or_underhood_squeal`, `high_pitched_whining_under_the_hood`). 7 matrix pairs point at it. The single biggest gap.
2. **`shaking_at_idle_while_stopped`** (motor/trans mounts — engine sounds normal, body shakes; incl. "shakes when A/C is on") — named by ENG as the "vibration-domain twin" and referenced by BST; nobody wrote it.
3. **`burning_electrical_plastic_smell`** (electrical fire / melting-wiring escalation lane) — referenced by FLU and ELE; safety-relevant with no anchor home.
4. **`rattling_underneath_the_car`** (exhaust heat-shield / loose-component rattle) — referenced by BST and ENG.
5. **`torque_steer_pull_on_acceleration`** (`pulling_only_during_acceleration`) — excluded by BST's pull entries as "performance/driveline domain"; neither wrote it.
6. **`transmission_gear_hunting_at_cruise`** — referenced by ENG's surging entry ("can't pick a gear on the highway"); PWT has no hunting entry.
7. **`shifter_interlock_stuck_in_park`** (brake-shift interlock, body-electrical) — referenced by PWT's won't-move entry.
8. **`battery_overcharging_smell`** (sulfur under hood at the battery) — referenced by ENG's rotten-egg entry.
9. **`cloudy_headlight_lenses`** (always-dim yellowed lenses → restoration/advisor) — referenced twice by ELE.
10. Minor / advisor-lane: non-ADAS cruise control dead (ELE notes say ask, no anchor), aftermarket remote-start quit, instrument-cluster/gauges dead (partially under gremlins), milky oil / "chocolate milk" dipstick (head-gasket presentation — white-smoke entry covers the exhaust side only).
