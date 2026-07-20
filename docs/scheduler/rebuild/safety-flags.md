# Safety flags — the `advise_immediately` hard-branch list

> The consolidated list of every subcategory flagged `advise_immediately` across the seven domain
> anchor banks — **37 unique concerns** (41 domain rows; 4 were duplicates merged in
> `01-taxonomy.md`). This is the hard-branch list the decision layer short-circuits on: when the
> classifier lands on any of these, the flow leads with safety advice (stop driving / tow / reduce
> load) BEFORE booking mechanics, and never routes to a routine drive-in slot without that advice.
>
> Escalation-variant rules (a normally-unflagged entry that escalates on a stated fact) are listed
> at the bottom — the decision layer needs those too.

## Braking (6)

| Subcategory | Why |
|---|---|
| `brakes/brakes_failed_or_gave_out` | Total/near-total brake loss — do-not-drive override; tow, never a drive-in appointment. |
| `brakes/spongy_or_soft_pedal` | Air or fluid loss in the hydraulics — stopping ability actively degrading. |
| `brakes/pedal_sinks_to_floor` | Master-cylinder bypass signature; a pedal that reached the floor mid-drive is an emergency. |
| `brakes/hard_or_unresponsive_pedal` | Booster/vacuum failure — stopping distance substantially increased. |
| `brakes/metallic_grinding` | Friction material gone, backing plate on rotor — braking compromised and damage accrues every stop. |
| `leak/clear_yellow_or_light_brown_puddle_brake_fluid` | Confirmed brake-fluid loss — the hydraulic pressure that stops the car is escaping; worst misroute in the leak family. |

## Steering / wheel — loss of control (4)

| Subcategory | Why |
|---|---|
| `steering_handling/hard_to_turn_heavy_steering` | Loss of power assist — full manual effort; dangerous in parking maneuvers and emergencies. |
| `suspension_ride/violent_shake_after_bump_death_wobble` | Self-sustaining violent steering oscillation at speed — genuine loss-of-control risk. |
| `tires/wheel_or_lug_concern_loose_wheel` | Suspected loose wheel/lugs — wheel separation causes crashes; stop-driving conversation, not a booking. |
| `adas/phantom_braking_or_steering` | Car brakes/steers itself with no obstacle — rear-end-collision hazard (subject of NHTSA defect investigations). |

## Fuel / fire / toxic fumes (2)

| Subcategory | Why |
|---|---|
| `smell_smoke/gasoline_fuel_smell` | Raw fuel vapor is flammable and toxic — strong persistent smell = do not keep driving; tow. |
| `smell_smoke/exhaust_fumes_inside_the_cabin` | Possible carbon monoxide in the cabin — colorless, potentially fatal; headache/dizziness reports are exposure symptoms. |

## Overheating (3)

| Subcategory | Why |
|---|---|
| `overheating/engine_overheating_running_hot` | Driving in the red risks head gasket / total engine damage; boil-over is a scald hazard. |
| `warning_light/engine_temperature_light` | Red temp light = actively overheating — stop; never open a hot radiator cap. |
| `warning_light/transmission_overheat_warning` | Continued driving cooks the fluid and clutches — pull over and let it cool / tow. |

## Red / flashing warning lights (5)

| Subcategory | Why |
|---|---|
| `warning_light/brake_system_red_light` | Core hydraulics: low fluid or pressure loss — possible active brake failure once the parking brake is ruled out. |
| `warning_light/oil_pressure_light` | Loss of oil PRESSURE — minutes of running can destroy the engine; stop the engine, tow. |
| `warning_light/battery_charging_light` | Charging system dead — the car is running on battery reserve and will die in traffic, often within a short drive. |
| `warning_light/check_engine_light_flashing` | Active misfire dumping raw fuel into the catalyst — reduce load / stop driving now. |
| `warning_light/multiple_warning_lights_at_once` | Many-lights-with-dimming = system voltage collapsing — the car may die in traffic; any red light in the set adds its own advice. |

## Smoke (3)

| Subcategory | Why |
|---|---|
| `smell_smoke/smoke_or_burning_smell_from_a_wheel` | Dragging brake overheating a wheel — can boil fluid (brake loss) or start a fire; stop and cool immediately. |
| `smell_smoke/smoke_or_steam_under_hood` | Anything visibly smoking/steaming under the hood gets stop-and-assess advice; acrid-plastic variant escalates to the electrical-fire lane. |
| `smell_smoke/white_smoke_from_tailpipe` | Thick persistent white smoke = coolant burning (head gasket) — driving on risks overheat and engine damage. |

## Engine destruction / dies while driving (4)

| Subcategory | Why |
|---|---|
| `noise/deep_knocking_from_the_engine` | Probable rod/bottom-end failure — continued driving risks total engine loss. |
| `performance/engine_misfire_or_bucking_feeling` | Flagged for the flashing-CEL variant: raw fuel destroys the catalytic converter within minutes. |
| `performance/stalling_while_driving_under_load` | Engine shutoff at speed kills power steering and brake assist — do not keep driving. |
| `no_start/died_while_driving_wont_restart` | Died in traffic (electrical/charging signature) — hazard regardless of cause; jump-then-dies-again confirms charging failure. |

## Loss of propulsion / stranding — powertrain (6)

| Subcategory | Why |
|---|---|
| `transmission_driveline/wont_move_or_no_gear` | Not drivable — severe internal failure; offer tow guidance instead of a drive-in slot. |
| `transmission_driveline/stuck_in_gear_limp_mode` | Failsafe mode protecting the trans from a stored fault — speed-capped in traffic. |
| `transmission_driveline/pops_out_of_gear` | Unexpected drop to neutral at highway speed — loss-of-propulsion event. |
| `transmission_driveline/wont_go_into_gear_manual` | Typically strands the driver mid-traffic (clutch drag / hydraulic failure) — tow. |
| `transmission_driveline/clutch_pedal_problem` | Pedal to the floor = hydraulic failure — strands the driver; advise immediately, likely tow. |
| `transmission_driveline/axle_broke_wont_move` | Snapped axle — zero drive to the wheel; driving risks hub, ABS wiring, brake hose. Always tow. |

## Hybrid / EV high-voltage (2)

| Subcategory | Why |
|---|---|
| `performance/hybrid_ev_reduced_power_turtle` | Protective derate capping the car at crawl speed — a live hazard on the highway; needs HV-aware diagnosis. |
| `warning_light/hybrid_system_warning_red_triangle` | Hybrid master warning (traction battery / inverter / HV cooling) — some faults shut the car down shortly after; red-light rule applies. |

## Situational overrides (2)

| Subcategory | Why |
|---|---|
| `situational/safety_concern_not_safe_to_drive` | Fear dominating or outright safety-system failure — do not drive; arrange tow. Mirror rule: a NAMED symptom with a passing "is it safe?" stays in its own domain. |
| `situational/breakdown_tow_in` | Customer stranded NOW — human contact beats a wizard flow; never guess a service from a bare tow-in. |

---

## Escalation variants (flag = none, but escalate on a stated fact)

The decision layer must also short-circuit when an unflagged entry arrives WITH the escalating fact:

| Base entry | Escalates when… | Escalate to / advice |
|---|---|---|
| `tires/visible_damage_nail_screw_bulge_cut` | a sidewall BULGE is described | blowout risk — advise minimizing driving (treat as urgent) |
| `warning_light/abs_anti_lock_brake_light` | red BRAKE light is on with it | `brake_system_red_light` — do not drive |
| `warning_light/power_steering_eps_light` | assist actually cut out / wheel is heavy | `hard_to_turn_heavy_steering` |
| `brakes/parking_brake_stuck_or_wont_release` | already driven — wheel hot/smoking | `smoke_or_burning_smell_from_a_wheel` |
| `fluids/coolant_loss_low_coolant` | hot gauge or white smoke also present | overheating / head-gasket path |
| `leak/unknown_fluid_puddle` | any brake cue (pedal change, red light, near-wheel drip) | brake-fluid entry — do not drive |
| `electrical/dim_or_flickering_lights` | battery light on / engine stumbling too | in-progress charging failure — may die while driving |
| `performance/stalling_at_idle_or_when_stopping` | stall strands the customer or hits live traffic | urgent advice in booking copy |
| `noise/clicking_when_turning` | worsening fast + vibration | outer CV can separate — prompt advice |
| `steering_handling`/any pull or wander | customer describes losing their lane / feeling unsafe | `safety_concern_not_safe_to_drive` |
| `hvac`/`bad_smell_from_vents` or `sweet_antifreeze_smell` | sweet smell + fogging glass + damp carpet | heater-core coolant vapor in cabin — headaches; get it in soon |
| any leak/smoke entry | appeared right after recent service | `situational/symptom_after_recent_service` overrides, advisor flags rework |

**Notes for the decision layer.** (1) The four merged warning-light duplicates carried the flag in
both source files — flag survives the merge. (2) `brakes_failed_or_gave_out` and
`safety_concern_not_safe_to_drive` intentionally overlap: the brakes entry exists so embeddings
catch "brakes went out" phrasing and hand it to the safety path rather than a $39.99 inspection.
(3) The GAP entry `burning_electrical_plastic_smell` (see `01-taxonomy.md`) will belong on this
list when written — electrical-fire lane, "get away from the vehicle if it worsens."
