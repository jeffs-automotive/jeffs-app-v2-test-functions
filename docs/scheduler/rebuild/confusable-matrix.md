# Confusable matrix — customer-concern classifier (rebuild)

> The map the clarifying-question policy uses: every confusable pair collected across the seven
> domain anchor banks (`docs/scheduler/rebuild/anchors/`), de-duplicated (reciprocal A↔B rows
> collapsed, merged slugs canonicalized per `01-taxonomy.md`), grouped by ambiguity family.
> Each pair carries THE single discriminator question that separates the two concerns —
> when the shortlist contains both members of a pair, ask that question.
>
> Synthesized 2026-07-19 from the 7 domain files (209 entries → 186 canonical subcategories).

## Stats

- **403 unique confusable pairs** (from 573 raw rows across the 7 files) + 3 within-entry variant splits
- **90 cross-domain pairs** (the two sides were written by different domain agents) — marked ⇄
- 19 pairs point at a **[GAP]** target: a concern referenced as a confusable that NO domain anchored (see the gap list in `01-taxonomy.md` — these pairs are unusable until the gap entries are written)
- 9 pairs discriminate a normal-by-design / benign **variant** inside an entry (reassurance exits, not separate bookings)
- 6 rows are **routing meta-rules** rather than entry-vs-entry pairs

Legend: ⇄ = cross-domain pair · **[GAP]** = target not yet anchored · *(variant)* = within-entry benign/normal split · *(rule)* = routing meta-rule

## Noise (53 pairs)

> One sound, many systems — brake squeal vs belt vs CV click vs bearing hum vs exhaust. The load-bearing facts: WHEN it happens (braking / turning / bumps / gear engagement / engine running), and whether it tracks engine RPM or road speed.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `awd_4x4_binding_in_turns` | `clicking_when_turning` | Is it a click-click-click sound, or does the whole vehicle BIND and hop like it's fighting itself in tight turns? |
| `awd_4x4_binding_in_turns` | `driveline_clunk_on_takeoff` | A single clunk on take-off, or a bind/hop feeling through tight turns? |
| `awd_4x4_not_engaging` | `transmission_whine_or_noise` | Does the grinding only happen when you try to switch into 4WD, or during normal driving too? |
| `clicking_when_turning` ⇄ | `clunking_over_bumps` | Only when turning, or also going straight over bumps? |
| `clicking_when_turning` ⇄ | `engine_ticking_or_tapping` | Do you hear it with the engine revving even sitting still, or only when the car is rolling and turning? |
| `clicking_when_turning` | `humming_or_whining_at_speed_driveline` | Is it a repeating CLICK only in turns, or a steady HUM that rises with your speed? |
| `clicking_when_turning` ⇄ | `noise_when_turning_the_steering_wheel` | Does it click while the car is MOVING through a turn, or also when you turn the steering wheel sitting still? |
| `clunking_over_bumps` ⇄ | `deep_knocking_from_the_engine` | Does it knock with the engine revving even in park, or only when you hit bumps in the road? |
| `clunking_over_bumps` ⇄ | `driveline_clunk_on_takeoff` | Does the clunk happen when you SHIFT into gear or take off / let off the gas, or when you go over BUMPS? |
| `clunking_over_bumps` | `loose_or_sloppy_steering` | Do you mainly feel looseness in the wheel, or mainly hear clunking over bumps? |
| `clunking_over_bumps` | `metallic_grinding` | Does the noise happen when you press the brakes, or when you drive over bumps? |
| `clunking_over_bumps` | `shaking_or_bouncing_over_bumps_and_rough_roads` | Is the problem mainly how it RIDES (bouncy, harsh, keeps rocking), or a noise it makes over bumps? |
| `clunking_over_bumps` | `squeaking_or_creaking_over_bumps` | Is it a deep clunk or knock, or more of a squeak/creak? |
| `clunking_over_bumps` | `vehicle_sitting_low_or_leaning_one_corner` | Is the main issue the car visibly sitting low or leaning, or a clunking noise over bumps? |
| `clutch_or_trans_noise_pedal_linked` ⇄ | `engine_ticking_or_tapping` | Does the rattle/knock change or quiet down when you push the clutch pedal in? |
| `clutch_or_trans_noise_pedal_linked` | `humming_or_whining_at_speed_driveline` | Can you hear it sitting still in neutral, or only while rolling down the road? |
| `clutch_or_trans_noise_pedal_linked` | `transmission_whine_or_noise` | Stick shift or automatic — and does the noise change when you press the clutch pedal? |
| `clutch_pedal_problem` | `grinding_or_hard_shift_manual` | Does the clutch pedal feel normal underfoot, or has it gone soft, low, or down to the floor? |
| `deep_knocking_from_the_engine` | `engine_ticking_or_tapping` | Is it a light fast tick like a sewing machine, or a deep heavy knock from down low that gets worse when you accelerate? |
| `deep_knocking_from_the_engine` | `exhaust_louder_or_rumbling` | Is it a rhythmic metallic knock that follows engine speed, or a loud rumbling exhaust note? |
| `door_trunk_hood_latch_problem` | `power_window_not_working` | Is the problem the glass going up and down, or the door itself opening/closing? |
| `driveline_clunk_on_takeoff` | `harsh_or_jerky_shifting` | Is it a jolt with every gear change while driving, or a single clunk from under the car right when you first put it in Drive or Reverse? |
| `engine_ticking_or_tapping` | `exhaust_manifold_tick_or_puff` | Does the ticking go away completely once the engine is fully warmed up, or does it keep ticking even when warm? |
| `exhaust_louder_or_rumbling` | `exhaust_manifold_tick_or_puff` | Is it a rhythmic tick/puff up near the engine, or is the whole exhaust louder and deeper underneath and behind the car? |
| `exhaust_louder_or_rumbling` ⇄ | `humming_or_whirring_at_speed` | Is it a wheel-area hum that changes with speed and turning, or a deeper exhaust rumble that got louder overall? |
| `belt_squeal_underhood_whine` **[GAP]** | `clutch_or_trans_noise_pedal_linked` | Does the noise change when you press or release the CLUTCH pedal, or does it stay the same and just follow engine revs? |
| `belt_squeal_underhood_whine` **[GAP]** | `high_pitched_squealing` | Does it only happen when you're braking, or is the noise there any time the engine is running? |
| `belt_squeal_underhood_whine` **[GAP]** | `humming_or_whirring_at_speed` | Does the sound follow your road speed even coasting in neutral, or does it follow the engine revs? |
| `belt_squeal_underhood_whine` **[GAP]** | `noise_when_turning_the_steering_wheel` | Does the noise only happen while turning the wheel, or is it there any time the engine is running? |
| `belt_squeal_underhood_whine` **[GAP]** | `strange_noise_from_vents` | Does the noise change with the FAN speed and vent buttons, or is it a squeal from under the hood when the A/C kicks on? |
| `belt_squeal_underhood_whine` **[GAP]** | `whistle_or_hiss_under_hood` | Is it an airy whistle/hiss, or more of a squeal/chirp like a belt (especially on cold start or when turning)? |
| `rattle_underneath_heat_shield` **[GAP]** | `clunking_over_bumps` | Is it a solid clunk from one corner over bumps, or a lighter metallic rattle from underneath (like a loose heat shield)? |
| `rattle_underneath_heat_shield` **[GAP]** | `exhaust_louder_or_rumbling` | Is the exhaust sound itself louder, or is it more of a metal rattle or buzz underneath at certain engine speeds? |
| `grinding_or_hard_shift_manual` | `pops_out_of_gear` | Does it grind going INTO gear, or does it jump back OUT of gear on its own after it's in? |
| `grinding_or_hard_shift_manual` | `transmission_whine_or_noise` | Stick shift or automatic — an automatic that grinds going into reverse is a different problem? |
| `grinding_or_hard_shift_manual` | `wont_go_into_gear_manual` | Does it grind but eventually go in, or will it NOT go into gear at all with the engine running? |
| `high_pitched_squealing` | `metallic_grinding` | Is it a high-pitched squeak or squeal, or more of a rough metal-on-metal grinding? |
| `high_pitched_squealing` | `noise_when_turning_the_steering_wheel` | Does the noise happen when you press the brakes, or when you turn the steering wheel? |
| `high_pitched_squealing` | `squeaking_or_creaking_over_bumps` | Do you hear it when braking, or when going over bumps and dips? |
| `humming_or_whining_at_speed_driveline` ⇄ | `humming_or_whirring_at_speed` | Does the hum get louder when you gently swerve one way and quieter the other, or does it stay the same no matter how you steer? |
| `humming_or_whining_at_speed_driveline` | `transmission_whine_or_noise` | Does the pitch change when the transmission shifts gears, or does it only track how fast you're going regardless of gear? |
| `humming_or_whirring_at_speed` | `metallic_grinding` | Do you hear it only when braking, or does it hum/grind constantly as you drive and change with speed? |
| `humming_or_whirring_at_speed` | `uneven_tire_wear_bald_spots` | Is the concern the visible wear on the tread, or a humming noise while driving (cupped tires can cause both)? |
| `humming_or_whirring_at_speed` ⇄ | `wind_noise_at_speed` | Does it whistle like air and change if you press on the door or crack a window, or is it a hum that just grows with speed? |
| `multiple_random_electrical_glitches` | `power_window_not_working` | Is it just the window(s), or are other electrical things (radio, locks, lights) also cutting in and out? |
| `noise_when_turning_the_steering_wheel` | `squeaking_or_creaking_over_bumps` | Do you hear it when turning the wheel, or when going over bumps? |
| `noise_when_turning_the_steering_wheel` ⇄ | `transmission_whine_or_noise` | Does the whine rise and fall with your ROAD speed and stay in gear, or does it track engine revs and get worst when you turn the steering wheel? |
| `one_side_hot_one_side_cold` | `strange_noise_from_vents` | Is the clicking the whole complaint, or is one side also blowing the wrong temperature? |
| `power_locks_not_working` | `power_window_not_working` | Is it the window glass that won't move, or the door LOCK? |
| `power_window_not_working` | `single_accessory_not_working` | Is it the roll-up-down door GLASS, or something else like the sunroof, mirrors, or door locks? |
| `strange_noise_from_vents` | `weak_airflow_from_vents` | Is the main problem the amount of air, or a noise the fan makes? |
| `strange_noise_from_vents` | `wind_noise_at_speed` | Does the noise change with the FAN speed, or only with road speed? |
| `turbo_low_power_limp` | `whistle_or_hiss_under_hood` | Is the noise the main thing, or has the car also lost noticeable power or gone into reduced-power mode? |

## Leak / fluid on the ground (22 pairs)

> Never settle a fluid by color alone — the color table collides (amber oil vs brake fluid; pink coolant vs ATF; blue coolant vs washer fluid; clear water vs brake fluid). Resolve color → location → texture/smell → paired symptom (pedal, steering, shifting). Brake-fluid misses are the worst misroute in the family.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `bad_smell_from_vents` | `water_leak_into_cabin_rain` | Does the smell come through the dash VENTS with the fan on, or from wet carpet/seats/trunk? |
| `blue_puddle_washer_fluid` | `coolant_puddle_green_orange_pink` | Does the blue fluid smell sweet like antifreeze, or soapy/like nothing (washer fluid)? |
| `blue_puddle_washer_fluid` ⇄ | `wipers_or_washers_not_working` | Is the washer not SPRAYING, or is washer fluid leaking/puddling under the car? |
| `clear_water_puddle_under_car` | `coolant_puddle_green_orange_pink` | Is the puddle clear and odorless like plain water, or bright green/orange/pink or sweet-smelling? |
| `clear_water_puddle_under_car` | `water_inside_cabin_ac_on` | Is the water UNDER the car, or inside on the carpet? |
| `coolant_loss_low_coolant` | `coolant_puddle_green_orange_pink` | Do you ever see a puddle or drips under the car, or does the coolant just disappear with nothing on the ground? |
| `coolant_puddle_green_orange_pink` | `no_heat` | Have you had to add coolant/antifreeze, or seen a bright green/orange puddle or a sweet smell? |
| `coolant_puddle_green_orange_pink` | `red_or_pink_puddle_transmission_or_power_steering` | Is the fluid slick and oily between your fingers, or watery and sweet-smelling like syrup? |
| `coolant_puddle_green_orange_pink` | `sweet_antifreeze_smell` | Is there a colored puddle on the ground, or just the smell with nothing underneath? |
| `coolant_puddle_green_orange_pink` | `unknown_fluid_puddle` | Any color to it — green, orange, or pink — or a sweet smell? |
| `foggy_windows_wont_defog` | `water_leak_into_cabin_rain` | Is the carpet actually wet after rain, or are the windows just fogging? |
| `gear_oil_leak` | `oil_puddle_brown_black` | Is the puddle under the BACK of the car with a rotten-egg smell, or up front under the engine with a regular oil smell? |
| `gear_oil_leak` | `red_or_pink_puddle_transmission_or_power_steering` | Is it red and fairly thin, or dark brown almost black, thick, and rotten-egg smelling? |
| `gear_oil_leak` ⇄ | `rotten_egg_sulfur_smell` | Is the rotten-egg smell coming from a leaking puddle/wet axle, or from the exhaust while driving? |
| `hard_to_turn_heavy_steering` | `red_or_pink_puddle_transmission_or_power_steering` | Have you seen any red or pink fluid under the front of the car, or had to top off power steering fluid? |
| `oil_consumption_burning_oil` | `oil_puddle_brown_black` | Are there oil spots or a puddle where you park, or does the level just drop with a clean driveway? |
| `oil_puddle_brown_black` | `red_or_pink_puddle_transmission_or_power_steering` | Is it dark brown/black, or does it look red/pink when fresh? |
| `oil_puddle_brown_black` | `unknown_fluid_puddle` | If you can check: is the spot dark brown/black and greasy? |
| `strange_noise_from_vents` | `water_inside_cabin_ac_on` | Is it just the sloshing sound, or is water actually showing up on the floor? |
| `sweet_antifreeze_smell` ⇄ | `water_inside_cabin_ac_on` | Is the liquid clear and odorless like plain water, or does it feel greasy or smell sweet? |
| `sweet_antifreeze_smell` ⇄ | `water_leak_into_cabin_rain` | Is it plain clear water, or greasy/sweet-smelling? |
| `water_inside_cabin_ac_on` | `water_leak_into_cabin_rain` | Does the floor get wet after running the A/C on dry days, or after rain or a car wash? |

## Warning light (77 pairs)

> Route on the light the customer NAMES; resolve nicknames and symbols first. Red = urgent, amber = soon. Sibling co-illumination (ABS+traction; battery cascade) is ONE problem. Reported-code-only ≠ felt symptom.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `abs_anti_lock_brake_light` | `brake_system_red_light` | Is it the yellow letters A-B-S, or a RED light that says BRAKE / a red exclamation circle — or are BOTH on? |
| `abs_anti_lock_brake_light` ⇄ | `humming_or_whining_at_speed_driveline` | Is there a humming or growling wheel noise ALONG with the ABS/traction light, or just the light by itself? |
| `abs_anti_lock_brake_light` | `metallic_grinding` | Any grinding/squealing or change in how the brakes feel, or is it just the light? |
| `abs_anti_lock_brake_light` | `multiple_warning_lights_at_once` | Is it specifically ABS + traction together (that's ONE shared problem — book the named light), or a wider mix of lights? |
| `abs_anti_lock_brake_light` | `power_steering_eps_light` | Which light exactly — a steering wheel with an exclamation point, or the letters ABS? |
| `abs_anti_lock_brake_light` | `traction_control_stability_light` | Is it the ABS letters, or the little skidding-car symbol? (They often come on together off the same wheel sensors — that's one problem, not two.) |
| `airbag_srs_light` | `multiple_warning_lights_at_once` | Is the airbag light the only one on, or are several lights (battery, ABS, traction) on together? |
| `airbag_srs_light` | `seat_belt_wont_latch_or_retract` | Is a warning light on the dash involved, or is it purely the belt hardware sticking? |
| `alarm_going_off_on_its_own` | `security_anti_theft_light_on` | Is the alarm actually sounding, or is it just the security light staying on? |
| `awd_4x4_not_engaging` ⇄ | `check_engine_light_steady` | Is the message specifically about 4WD or AWD, or just the regular check-engine light? |
| `awd_4x4_not_engaging` ⇄ | `traction_control_stability_light` | Is it the traction/skid light, or an AWD / 4x4 / four-wheel-drive system message? |
| `battery_charging_light` | `battery_drains_overnight` | Does a battery/charging light come on while you're DRIVING, or is the problem only after it sits? |
| `battery_charging_light` | `dim_or_flickering_lights` | Has the battery/charging warning light come on along with the flickering? |
| `battery_charging_light` ⇄ | `ev_wont_charge` | Is this about plugging the car in to charge, or a battery warning light while driving? |
| `battery_charging_light` | `multiple_warning_lights_at_once` | Is the battery light in the mix with things dimming? (Then it's a charging cascade — the battery/alternator is the root.) |
| `battery_charging_light` | `power_steering_eps_light` | Is it the steering wheel icon, or the battery light — or did several lights come on together? |
| `battery_degradation_range_loss` | `hybrid_system_warning_red_triangle` | Is a hybrid warning light on, or is it just gradual range/mileage loss with no light? |
| `brake_system_red_light` | `brakes_failed_or_gave_out` | Are the brakes actually failing to stop the car, or is it a red BRAKE warning light with the brakes still working? |
| `brake_system_red_light` | `clear_yellow_or_light_brown_puddle_brake_fluid` | Have you had to add brake fluid, or seen a clear-to-brown puddle near a wheel or under the driver's side? |
| `brake_system_red_light` | `exterior_light_out` | Is it a bulb at the back of the car that's out, or a red BRAKE warning light on your dash? |
| `brake_system_red_light` | `parking_brake_stuck_or_wont_release` | Is the parking brake physically stuck, or is it just the red brake light staying on with the parking brake released? |
| `brake_system_red_light` | `single_accessory_not_working` | Is this a warning light on your dashboard, or a brake light bulb out on the back of the car? |
| `check_engine_light_flashing` | `check_engine_light_steady` | Is it truly blinking on and off, or just steadily lit? |
| `check_engine_light_flashing` ⇄ | `engine_misfire_or_bucking_feeling` | Is the shaking/bucking the main event with the flashing light confirming it? (Same urgent problem — book the misfire diagnosis.) |
| `check_engine_light_gas_cap_evap` ⇄ | `check_engine_light_steady` | Did the light come on around a fill-up or gas-cap event, or with no connection to fueling? |
| `check_engine_light_gas_cap_evap` | `engine_temperature_light` | Is it a thermometer/coolant symbol, or the orange engine-shaped check-engine light? |
| `check_engine_light_gas_cap_evap` | `gasoline_fuel_smell` | Any actual gas smell along with the light? (A smell means a real vapor/fuel leak, not just the cap.) |
| `check_engine_light_gas_cap_evap` | `hard_start_after_fueling` | Is the main thing the hard starting, or a warning light after fueling? |
| `check_engine_light_gas_cap_evap` | `oil_pressure_light` | Is it the oil-can symbol, or the orange engine-shaped check-engine light? |
| `check_engine_light_gas_cap_evap` | `trouble_fueling_gas_wont_go_in` | Is the problem physically getting gas INTO the tank, or a warning light that came on after fueling? |
| `check_engine_light_steady` ⇄ | `driver_assist_warning_or_malfunction` | Does the message name a driver-assist feature (lane, collision, cruise, blind spot), or is it the check-engine light? |
| `check_engine_light_steady` ⇄ | `engine_misfire_or_bucking_feeling` | Can you actually feel it running badly, or is the light the only thing you've noticed? |
| `check_engine_light_steady` ⇄ | `hybrid_system_warning_red_triangle` | Does the message mention the hybrid system or high voltage, or is it just the check-engine light? |
| `check_engine_light_steady` | `service_or_maintenance_reminder_light` | Is it a wrench or a text message about service — or the engine-shaped warning light? |
| `check_engine_light_steady` ⇄ | `stuck_in_gear_limp_mode` | Is the main problem the warning light itself, or that the car physically won't shift / won't go past a certain speed? |
| `check_engine_light_steady` | `traction_control_stability_light` | Is the check-engine light on at the same time? (Engine faults turn traction control off — the engine light is the root.) |
| `check_engine_light_steady` ⇄ | `transmission_overheat_warning` | Is it a specific transmission-temperature warning, or just the regular check-engine light? |
| `clear_water_puddle_under_car` | `clear_yellow_or_light_brown_puddle_brake_fluid` | Is the clear fluid slick/oily near a wheel, or thin plain water under the passenger side after running the A/C? |
| `clear_yellow_or_light_brown_puddle_brake_fluid` ⇄ | `clutch_pedal_problem` | Is it the CLUTCH pedal or the BRAKE pedal that's gone soft — and which reservoir is dropping? |
| `clear_yellow_or_light_brown_puddle_brake_fluid` | `gear_oil_leak` | Is it thick, dark and stinky, or thin, clear-to-light-brown and slippery near a wheel? |
| `clear_yellow_or_light_brown_puddle_brake_fluid` | `oil_puddle_brown_black` | Is the amber/light-brown drip near a wheel with any change in the brake pedal, or up front under the engine with the pedal feeling normal? |
| `clear_yellow_or_light_brown_puddle_brake_fluid` | `pedal_sinks_to_floor` | Is the brake fluid level dropping or is there any wet spot under the car or inside a wheel? |
| `clear_yellow_or_light_brown_puddle_brake_fluid` | `red_or_pink_puddle_transmission_or_power_steering` | Is it clearly red, or more clear-to-light-brown near a wheel with any change in the brake pedal? |
| `clear_yellow_or_light_brown_puddle_brake_fluid` | `spongy_or_soft_pedal` | Have you actually seen fluid on the ground or dropping in the reservoir, or does the pedal just feel soft? |
| `clear_yellow_or_light_brown_puddle_brake_fluid` | `unknown_fluid_puddle` | Has the brake pedal felt soft, low, or different at all since you noticed the leak? |
| `deep_knocking_from_the_engine` ⇄ | `oil_pressure_light` | Is there a knocking/ticking noise with the light on? |
| `dim_or_flickering_lights` | `exterior_light_out` | Is it the brightness changing on lights that work, or is one light just dead/out? |
| `dim_or_flickering_lights` | `multiple_random_electrical_glitches` | Is it just lights dimming/flickering, or are other things (radio, locks, gauges) also acting up randomly? |
| `driver_assist_warning_or_malfunction` ⇄ | `multiple_warning_lights_at_once` | Are the messages all about driving-assist features, or is the whole dash lit up (battery, ABS, airbag) with the car running rough? |
| `engine_overheating_running_hot` | `engine_temperature_light` | Is the temperature gauge itself reading hot, or is it a warning light/message on the dash that got your attention? |
| `engine_overheating_running_hot` ⇄ | `transmission_overheat_warning` | Does the message or gauge say TRANSMISSION temp, or engine temperature / coolant? |
| `engine_temperature_light` | `multiple_warning_lights_at_once` | Is it only the temperature light, or part of a bunch of lights at once? |
| `belt_squeal_underhood_whine` **[GAP]** | `battery_charging_light` | Is there a loud squeal with the light? (Mention it — a slipping or broken belt can be the cause.) |
| `cloudy_headlight_lenses` **[GAP]** | `dim_or_flickering_lights` | Do the lights actually change brightness, or are they just always dull/yellowed looking (hazy lenses)? |
| `cloudy_headlight_lenses` **[GAP]** | `exterior_light_out` | Is the bulb out, or do the lights work but look dull/yellowed through hazy lenses? |
| `hard_to_turn_heavy_steering` | `power_steering_eps_light` | Is the wheel actually hard to turn right now (book the steering symptom), or is it just the light? |
| `hybrid_ev_reduced_power_turtle` | `hybrid_system_warning_red_triangle` | Is the car actually slowed to a crawl, or is it mainly the warning message with normal driving? |
| `multiple_random_electrical_glitches` | `multiple_warning_lights_at_once` | Are dashboard WARNING lights coming on, or are accessories (radio, locks, gauges) misbehaving? |
| `multiple_warning_lights_at_once` | `power_steering_eps_light` | Is the steering light the only one on, or did a bunch of warning lights appear at once? |
| `multiple_warning_lights_at_once` ⇄ | `security_anti_theft_light_on` | Is the security light the only one on, or are several dash lights lit at once? |
| `multiple_warning_lights_at_once` | `traction_control_stability_light` | Is it just the traction light, or did several warning lights come on at the same time? |
| `multiple_warning_lights_at_once` ⇄ | `turbo_low_power_limp` | Did the dash lights come with the car physically losing power/capping its speed, or on their own? |
| `oil_consumption_burning_oil` | `oil_pressure_light` | Did an actual warning light come on, or have you just been finding the oil level low? |
| `oil_pressure_light` | `oil_puddle_brown_black` | Any puddle under the car or burning-oil smell along with the light? |
| `oil_pressure_light` | `service_or_maintenance_reminder_light` | Is it the red dripping-oil-can light, or an 'oil life / service due' message? |
| `oil_pressure_light` | `unknown_warning_light` | Does it look like a little oil can or genie lamp with a drip? |
| `power_steering_eps_light` | `red_or_pink_puddle_transmission_or_power_steering` | Any whining noise when turning or a reddish fluid puddle (hydraulic system), or is it an electric-assist warning light? |
| `tire_going_flat_losing_air` | `tpms_tire_pressure_light` | Is one tire actually going low or flat when you check it, or is it just the light with the tires holding normal pressure? |
| `tpms_tire_pressure_light` | `unknown_warning_light` | Is it the horseshoe-with-exclamation tire symbol, or a different light you can't identify? |
| `tpms_tire_pressure_light` | `visible_damage_nail_screw_bulge_cut` | Have you seen anything in the tire, like a nail or screw, or is it only the light? |
| `traction_control_stability_light` | `unknown_warning_light` | Is it a little car with wavy squiggly lines under it? |
| *blue_cold_engine_light* (variant) | `engine_temperature_light` | Is the thermometer light RED, or BLUE when the engine is cold (blue just means not warmed up yet)? |
| *normal_traction_flash_on_slip* (variant) | `traction_control_stability_light` | Does it only flicker when the wheels slip in rain/snow (that's it working normally), or does it stay on steady? |
| *passenger_airbag_off_indicator* (variant) | `airbag_srs_light` | Is it specifically the 'passenger airbag OFF' indicator misreading who's in the seat? |
| *seatbelt_reminder_light* (variant) | `airbag_srs_light` | Is it the airbag/SRS person-with-ball light, or the seatbelt reminder (person with a belt across their chest) that chimes? |
| *startup_bulb_self_test* (variant) | `unknown_warning_light` | Did it just light up briefly with all the others when you started the car, then go out? |
| *tpms_flash_then_steady_sensor_fault* (variant) | `tpms_tire_pressure_light` | Does the light blink for about a minute after startup before staying on (sensor fault), or is it just steadily on (low pressure)? |

## No-start (31 pairs)

> The single most valuable fact: what happens at the key — click / silence / slow crank / normal crank without firing. "Won't turn over" means all of them; always ask. Hybrid/EV READY-failures and security/immobilizer no-starts fork before the battery lane.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `airbag_srs_light` | `key_not_recognized_security_no_start` | Is it the airbag light with the car running fine, or a security light with the car not starting? |
| `alarm_going_off_on_its_own` | `key_not_recognized_security_no_start` | Does the car start and run fine but the alarm/horn goes off on its own, or does the car NOT start? |
| `axle_broke_wont_move` ⇄ | `wont_crank_just_clicks` | Does the engine run fine and the car just won't move, or won't the engine start at all? |
| `battery_charging_light` | `died_while_driving_wont_restart` | Did the car actually shut off, or is the battery light on but it's still running? |
| `battery_drains_overnight` | `died_while_driving_wont_restart` | Does it die while actually driving, or only refuse to start after it's been parked a while? |
| `battery_drains_overnight` | `no_sound_at_all_when_starting` | Was it fine yesterday and dead only after sitting, or did it die and stay dead regardless of jumps? |
| `battery_drains_overnight` | `wont_crank_just_clicks` | Is it only dead after sitting overnight or a few days (fine once jumped), or did it fail out of nowhere and stay failed? |
| `cranks_but_wont_fire` | `hard_start_after_fueling` | Does it always start eventually, or has it ever cranked and never started at all? |
| `cranks_but_wont_fire` ⇄ | `hard_to_start_when_cold` | Does it always eventually start, or are there times it cranks and never fires at all? |
| `cranks_but_wont_fire` ⇄ | `hard_to_start_when_hot` | Does this only happen restarting right after driving (like at a gas stop), and start fine after it cools 20-30 minutes? |
| `cranks_but_wont_fire` ⇄ | `key_not_recognized_security_no_start` | Is the security/anti-theft light flashing while it cranks? |
| `cranks_but_wont_fire` | `slow_crank_sluggish_start` | Does it spin at normal speed but take a long time to fire, or does it physically spin SLOWER than normal? |
| `cranks_but_wont_fire` | `wont_crank_just_clicks` | When you turn the key, does the engine actually spin over and crank, or do you just hear a click or nothing at all? |
| `died_while_driving_wont_restart` ⇄ | `stalling_at_idle_or_when_stopping` | When it dies, do the battery or oil lights come on first, or do the dash lights flicker/go dark? |
| `died_while_driving_wont_restart` ⇄ | `stalling_while_driving_under_load` | Right before it died, did the lights/dash dim or a battery light come on — or did the engine sputter and stumble first with no electrical warning? |
| `ev_wont_charge` | `hybrid_ev_wont_power_on` | Does the car not power ON, or does it power on fine but won't CHARGE when plugged in? |
| `shifter_interlock_stuck_in_park` **[GAP]** | `wont_move_or_no_gear` | Will the shift lever physically not come OUT of Park, or does it move to Drive and the car still doesn't go? |
| `hard_to_start_when_cold` ⇄ | `slow_crank_sluggish_start` | When it struggles, is the cranking itself slow and labored (rrr... rrr...), or does it spin over at normal speed and just take a long time to catch? |
| `hard_to_start_when_hot` ⇄ | `slow_crank_sluggish_start` | When it's hot, does the starter crank slow and labored, or does it spin normally and just not catch? |
| `hybrid_ev_reduced_power_turtle` | `hybrid_ev_wont_power_on` | Does it still drive (just weak), or won't it power on at all? |
| `hybrid_ev_wont_power_on` | `hybrid_system_warning_red_triangle` | Did jumping the small 12-volt battery bring it back, or is there a red triangle / check-hybrid-system warning that stays on? |
| `hybrid_ev_wont_power_on` ⇄ | `no_sound_at_all_when_starting` | Is the car a hybrid or electric — does the dash light up but it never goes to READY / ready-to-drive? |
| `hybrid_ev_wont_power_on` ⇄ | `wont_crank_just_clicks` | Is it a hybrid or electric — does it fail to reach READY with no cranking, or is it a gas car that clicks or cranks slowly? |
| `key_fob_remote_not_working` | `key_not_recognized_security_no_start` | Does the car not START, or does it start fine and only the remote functions are broken? |
| `key_not_recognized_security_no_start` ⇄ | `no_sound_at_all_when_starting` | Is a security or key-shaped light on/flashing while the battery seems fine? |
| `key_not_recognized_security_no_start` | `security_anti_theft_light_on` | Does the car start and drive fine with the light on, or does it not start? |
| `key_not_recognized_security_no_start` ⇄ | `single_accessory_not_working` | Does the car still start fine — or is the dead fob paired with the car not starting / a flashing security light? |
| `key_not_recognized_security_no_start` ⇄ | `wont_crank_just_clicks` | Are the dash lights bright and the battery fine with a security/key light flashing, or are the lights dim/dead and it clicks or needed a jump? |
| `no_sound_at_all_when_starting` | `wont_crank_just_clicks` | When you turn the key do you hear at least a click, or absolutely nothing at all? |
| `slow_crank_sluggish_start` | `wont_crank_just_clicks` | Does the engine actually spin over (just slowly), or does it ONLY click without ever turning? |
| `wont_crank_just_clicks` ⇄ | `wont_move_or_no_gear` | Does the engine start and run fine and the car just won't MOVE — or will the engine itself not start? |

## Vibration / shake / shudder (27 pairs)

> Discriminate on trigger: brake-applied vs cruise speed-band vs bump-triggered vs throttle-load vs RPM-tied vs clutch-engagement. WHERE it is felt (pedal / wheel / seat) localizes the axle or system.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `shaking_at_idle_motor_mounts` **[GAP]** | `rough_idle_or_shaking_at_a_stop` | Does the engine itself sound like it's struggling or sputtering, or does the engine sound normal and the car just vibrates (worn engine mount)? |
| `clutch_chatter_on_takeoff` | `cv_axle_accel_shudder` | Does it shake ONLY as the clutch comes up, or any time you accelerate hard from a stop even with the clutch fully out? |
| `clutch_chatter_on_takeoff` ⇄ | `engine_misfire_or_bucking_feeling` | Does it only shake during the moment the clutch is engaging from a stop, or does it also buck while driving at speed? |
| `clutch_chatter_on_takeoff` | `transmission_shudder` | Stick shift or automatic — does it only shake right as you let the clutch pedal out from a stop? |
| `constant_vibration_that_doesnt_change_with_speed` | `shaking_or_bouncing_over_bumps_and_rough_roads` | Is it triggered by bumps, or is it a constant vibration on smooth roads too? |
| `constant_vibration_that_doesnt_change_with_speed` | `steering_wheel_shake_at_highway_speed` | Does it come and go with speed (worst around 60-70), or is it constant at every speed? |
| `cv_axle_accel_shudder` | `driveline_vibration_at_speed` | Is it tied to how hard you're pressing the gas, or to how FAST you're going regardless of throttle? |
| `cv_axle_accel_shudder` ⇄ | `steering_wheel_shake_at_highway_speed` | Does it happen mostly under hard acceleration and clear when you lift, or is it constant at highway speed and felt in the steering wheel? |
| `cv_axle_accel_shudder` | `transmission_shudder` | Does it shake any time you accelerate hard from a stop, or only at light-throttle cruise around 35-45 that clears if you tap the brake? |
| `driveline_vibration_at_speed` | `humming_or_whining_at_speed_driveline` | Is it mainly something you FEEL (shaking), or a NOISE that rises with speed? |
| `driveline_vibration_at_speed` ⇄ | `steering_wheel_shake_at_highway_speed` | Did it start after new tires or a rotation, and do you feel it mostly in the steering WHEEL — or in the seat and floor? |
| `driveline_vibration_at_speed` | `transmission_shudder` | Does it only shake under gas at certain speeds and clear off-throttle, or is it there constantly once you're above a certain speed no matter what your foot does? |
| `engine_misfire_or_bucking_feeling` ⇄ | `steering_wheel_shake_at_highway_speed` | Is the shake tied to road speed no matter the gear, or does it change with engine RPM / feel like the engine stumbling? |
| `engine_misfire_or_bucking_feeling` ⇄ | `transmission_shudder` | Does the shudder show up at steady light-throttle cruise around 40 and clear when you change throttle or tap the brake — or does it get WORSE under hard load, maybe with a flashing check-engine light? |
| `shaking_at_idle_motor_mounts` **[GAP]** | `constant_vibration_that_doesnt_change_with_speed` | Does it also shake while sitting still in Park or at a light, or only when moving? |
| `grabby_or_jumpy_brakes` | `pulsating_or_vibrating_pedal` | Do the brakes bite too hard, or do you feel a pulsing/vibration through the pedal? |
| `humming_or_whirring_at_speed` | `steering_wheel_shake_at_highway_speed` | Is the concern mainly a humming NOISE, or a shake you feel in the steering wheel? |
| `pulsating_or_vibrating_pedal` | `steering_wheel_shake_at_highway_speed` | Does the shaking only happen while you're pressing the brakes, or does it happen just cruising at speed? |
| `pulsating_or_vibrating_pedal` | `vibration_or_pulsing_when_braking` | Is the shake mostly in the steering wheel or whole car, or mostly a pulsing you feel in the brake pedal itself? |
| `recent_tire_work_then_new_symptom` | `steering_wheel_shake_at_highway_speed` | Did the shaking start right after tire work, or on its own with no recent service? |
| `shaking_or_bouncing_over_bumps_and_rough_roads` | `steering_wheel_shake_at_highway_speed` | Does it happen going over bumps and rough roads, or does the steering wheel shake on smooth highway at speed? |
| `shaking_or_bouncing_over_bumps_and_rough_roads` | `vibration_or_pulsing_when_braking` | Does it happen when braking on smooth roads too, or only over bumps and rough pavement? |
| `shaking_or_bouncing_over_bumps_and_rough_roads` | `violent_shake_after_bump_death_wobble` | Does the steering wheel itself whip violently side to side, or is it more the whole car riding rough over bumps? |
| `steering_wheel_shake_at_highway_speed` | `vibration_or_pulsing_when_braking` | Does it shake only when you're braking, or also when just driving at highway speed without touching the brakes? |
| `steering_wheel_shake_at_highway_speed` | `violent_shake_after_bump_death_wobble` | Is it a steady buzz/shimmy at certain speeds, or a violent shake that starts when you hit a bump and only stops when you slow way down? |
| `steering_wheel_shake_at_highway_speed` | `wheel_or_lug_concern_loose_wheel` | Is it a steady vibration at certain speeds, or a wobble/clunk that keeps getting worse as you drive? |
| *limited_slip_posi_chatter* (variant) | `awd_4x4_binding_in_turns` | Does your vehicle have 4WD/AWD, or is it rear-wheel drive with a limited-slip (posi) rear end — and is there any 4WD/AWD warning message? |

## Smell / smoke (29 pairs)

> A bare "burning smell" sets nothing — the descriptor question is mandatory (oily / plastic-electrical / rubber-brake / sweet-coolant / sulfur / raw gas). Smoke adds the where (wheel / hood / tailpipe) and tailpipe color (white / blue / black).

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `bad_smell_from_vents` ⇄ | `burning_oil_smell` | Does the burning smell come through the vents when the fan runs, or from under the hood regardless of the fan? |
| `bad_smell_from_vents` | `foggy_windows_wont_defog` | Is there a sweet smell with the fog, or just fog? |
| `bad_smell_from_vents` ⇄ | `sweet_antifreeze_smell` | Is the sweet smell blowing through the vents with the heat on, or strongest under the hood or outside the car? |
| `black_smoke_from_tailpipe` | `blue_gray_smoke_from_tailpipe` | Is it sooty black with a gas smell, or blue-gray with a burning-oil smell? |
| `black_smoke_from_tailpipe` | `gasoline_fuel_smell` | Just the smell, or is there also black smoke from the exhaust when you accelerate? |
| `black_smoke_from_tailpipe` ⇄ | `rotten_egg_sulfur_smell` | Do you see actual black smoke, or is it mainly a rotten-egg smell from the exhaust? |
| `black_smoke_from_tailpipe` | `white_smoke_from_tailpipe` | Is it white, or dark/sooty black? |
| `blue_gray_smoke_from_tailpipe` | `oil_consumption_burning_oil` | Is the thing you're noticing the low oil level, or visible blue/gray smoke from the exhaust? |
| `blue_gray_smoke_from_tailpipe` | `white_smoke_from_tailpipe` | Does the smoke smell like burning oil, or sweet like syrup — and is it blue-gray or pure white? |
| `burning_oil_smell` ⇄ | `smoke_or_burning_smell_from_a_wheel` | Is the smell coming from under the hood, or from one of the wheels (especially after braking a lot)? |
| `burning_oil_smell` | `smoke_or_steam_under_hood` | Can you actually see smoke or steam, or is it just the smell? |
| `burning_oil_smell` | `sweet_antifreeze_smell` | Does it smell oily and burnt, or sweet like syrup? |
| `clutch_slipping` ⇄ | `smoke_or_burning_smell_from_a_wheel` | Does the burning smell show up when you're working the clutch hard (hills, takeoffs, traffic), or after braking — maybe from one wheel? |
| `coolant_loss_low_coolant` | `white_smoke_from_tailpipe` | Any thick white smoke from the exhaust, especially once the engine is warmed up? |
| `engine_overheating_running_hot` | `smoke_or_steam_under_hood` | Is the main thing the hot gauge reading, or smoke/steam you can actually see coming from the hood? |
| `exhaust_fumes_inside_the_cabin` | `exhaust_louder_or_rumbling` | Is the exhaust also louder than normal, or is it just the smell inside? |
| `exhaust_fumes_inside_the_cabin` | `exhaust_manifold_tick_or_puff` | Do you ever smell exhaust inside the car while driving, or is it just the noise outside? |
| `exhaust_fumes_inside_the_cabin` ⇄ | `gasoline_fuel_smell` | Is it a raw gasoline smell, or a smoky burnt exhaust smell inside the car? |
| `exhaust_fumes_inside_the_cabin` | `rotten_egg_sulfur_smell` | Do you smell it inside the car with the windows up, or mainly outside/behind the car? |
| `battery_overcharging_smell` **[GAP]** | `rotten_egg_sulfur_smell` | Is the smell strongest at the tailpipe while driving, or under the hood near the battery? |
| `burning_electrical_plastic_smell` **[GAP]** | `burning_oil_smell` | Is it a greasy/oily burnt smell, or a sharp plastic/electrical burning smell? |
| `burning_electrical_plastic_smell` **[GAP]** | `single_accessory_not_working` | Was there any burning/melting-plastic smell when it quit? |
| `burning_electrical_plastic_smell` **[GAP]** | `smoke_or_steam_under_hood` | Does it smell sweet or oily, or like sharp burning plastic/wiring? |
| `gasoline_fuel_smell` ⇄ | `rotten_egg_sulfur_smell` | Fresh sharp gas smell, or more like rotten eggs/sulfur? |
| `no_heat` | `sweet_antifreeze_smell` | Is the heat still working normally? (A leaking heater core often kills the heat too.) |
| `parking_brake_stuck_or_wont_release` | `smoke_or_burning_smell_from_a_wheel` | Is the parking brake stuck on right now, or did the wheel just get hot and smoky after driving? |
| `smoke_or_burning_smell_from_a_wheel` ⇄ | `smoke_or_steam_under_hood` | Is the smoke coming from a wheel, or from under the hood? |
| `smoke_or_steam_under_hood` | `whistle_or_hiss_under_hood` | Is it just the sound, or is there also steam/hissing WITH visible vapor from under the hood (coolant escaping)? |
| *normal_cold_start_steam* (variant) | `white_smoke_from_tailpipe` | Does it clear up within a minute or two on cold mornings, or does it keep smoking even once the engine is fully warm? |

## Stall / power loss / start-quality (24 pairs)

> Separates engine driveability from transmission slip from protective limp modes from charging-system death. Key facts: revs-vs-speed relationship, did it fully shut off, electrical precursor, turbo/hybrid context.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `auto_trans_slipping` | `axle_broke_wont_move` | Does it still move (just weakly), or did it suddenly stop moving at all — maybe with a loud bang? |
| `auto_trans_slipping` | `clutch_slipping` | Is your car an automatic or a stick shift? |
| `auto_trans_slipping` ⇄ | `low_power_or_wont_accelerate_normally` | When it feels weak, does the engine rev up HIGHER than normal while the car doesn't speed up — or do the revs stay low and it just feels gutless? |
| `auto_trans_slipping` | `pops_out_of_gear` | Does the shifter physically move back to neutral, or does it stay in gear while the engine revs without pulling? |
| `auto_trans_slipping` | `stuck_in_gear_limp_mode` | Does it move but rev high without pulling, or is it capped at a certain speed / stuck in one gear with warning lights on? |
| `clutch_slipping` ⇄ | `low_power_or_wont_accelerate_normally` | Do the revs shoot UP without the car speeding up, or do the revs stay low and it just feels weak? |
| `delayed_engagement` ⇄ | `hesitation_or_lag_when_accelerating` | Does the delay happen when you first shift into Drive or Reverse, or while you're already moving and press the gas? |
| `engine_misfire_or_bucking_feeling` ⇄ | `harsh_or_jerky_shifting` | Does the jerk happen exactly WHEN the transmission changes gears, or does it buck and stumble while you're cruising at a steady speed? |
| `engine_misfire_or_bucking_feeling` | `hesitation_or_lag_when_accelerating` | Is it one brief pause and then it pulls normally, or does it keep jerking/stumbling the whole time you accelerate? |
| `engine_misfire_or_bucking_feeling` | `low_power_or_wont_accelerate_normally` | Is it smooth but weak when you accelerate, or does it jerk and stumble? |
| `engine_misfire_or_bucking_feeling` | `rough_idle_or_shaking_at_a_stop` | Do you feel it jerking while you're driving and giving it gas, or is it only rough/shaky while stopped at idle? |
| `engine_misfire_or_bucking_feeling` | `surging_or_rpms_going_up_and_down` | Does the RPM needle swing smoothly, or does the whole car shake and jerk with it? |
| `transmission_gear_hunting_at_cruise` **[GAP]** | `surging_or_rpms_going_up_and_down` | Do the RPMs swing while you're cruising at a steady speed on the highway (like it can't pick a gear), or while you're stopped? |
| `hard_to_start_when_cold` | `hard_to_start_when_hot` | Is it hardest after the engine is fully warmed up and parked briefly, or on cold mornings after sitting overnight? |
| `hard_to_start_when_hot` | `stalling_at_idle_or_when_stopping` | Does it start and then die right away, or does it crank without firing in the first place? |
| `hesitation_or_lag_when_accelerating` | `low_power_or_wont_accelerate_normally` | Once it catches, does it accelerate normally, or is it weak the entire time you're on the gas? |
| `hybrid_ev_reduced_power_turtle` ⇄ | `low_power_or_wont_accelerate_normally` | Is the vehicle a hybrid or fully electric, and is there a turtle / reduced-power / hybrid warning showing? |
| `hybrid_ev_reduced_power_turtle` | `regen_brake_feel_change` | Is it the braking feel, or the car's power/acceleration that changed? |
| `low_power_or_wont_accelerate_normally` | `stalling_while_driving_under_load` | Did the engine completely shut off, or did it stay running but with barely any power? |
| `low_power_or_wont_accelerate_normally` ⇄ | `stuck_in_gear_limp_mode` | Is it stuck at high revs in one gear with warning lights, or just generally weak everywhere with normal shifting? |
| `low_power_or_wont_accelerate_normally` ⇄ | `turbo_low_power_limp` | Is the car turbocharged, and did the power loss come with a whoosh/whistle or a reduced-power message? |
| `rough_idle_or_shaking_at_a_stop` | `stalling_at_idle_or_when_stopping` | Does the engine actually shut off on you, or does it shake and run rough but keep running? |
| `rough_idle_or_shaking_at_a_stop` | `surging_or_rpms_going_up_and_down` | Is the engine smoothly revving up and down on its own, or is it stumbling and sputtering rough? |
| `stalling_at_idle_or_when_stopping` | `stalling_while_driving_under_load` | Does it only die when you're stopped or slowing down, or has it shut off while you were actually driving at speed? |

## Transmission & driveline behavior (7 pairs)

> Gear-engagement mechanics: harsh vs delayed vs won't-move vs pops-out; manual-vs-automatic is often the first question. Sudden-with-a-bang vs gradual separates snapped axle from internal failure.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `awd_4x4_binding_in_turns` | `awd_4x4_not_engaging` | Is the problem that it WON'T go into 4WD, or that it acts like it's stuck IN 4WD and binds when you turn? |
| `awd_4x4_binding_in_turns` ⇄ | `grabby_or_jumpy_brakes` | Does it only happen in tight turns (parking lots, U-turns), or also braking in a straight line? |
| `axle_broke_wont_move` | `wont_move_or_no_gear` | Did it stop moving suddenly with a loud bang or pop, or did it just quietly stop going into gear? |
| `clutch_pedal_problem` | `wont_go_into_gear_manual` | Is the pedal itself misbehaving (soft/floor/stuck), or does the pedal feel normal and the shifter just won't go in? |
| `delayed_engagement` | `harsh_or_jerky_shifting` | Does it shift too HARD, or does it pause a few seconds before it engages at all? |
| `delayed_engagement` | `wont_move_or_no_gear` | Does it eventually catch and drive normally, or does it never move no matter how long you wait? |
| `wont_go_into_gear_manual` | `wont_move_or_no_gear` | Stick shift or automatic? |

## Brake pedal & braking behavior (9 pairs)

> Pedal-feel triage: soft/spongy vs sinking-under-hold vs rock-hard vs grabby vs total failure. Each maps to a different hydraulic subsystem and a different urgency.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `brakes_failed_or_gave_out` | `hard_or_unresponsive_pedal` | Can you still stop the car if you push very hard, or did the brakes stop working entirely? |
| `brakes_failed_or_gave_out` | `pedal_sinks_to_floor` | Did the brakes completely stop working, or do they still stop the car but the pedal sinks while you hold it? |
| `grabby_or_jumpy_brakes` ⇄ | `phantom_braking_or_steering` | Does the car brake ITSELF when nothing is in front, or does the pedal feel wrong when YOU press it? |
| `grabby_or_jumpy_brakes` | `pulling_only_when_braking` | When the brakes grab, does the car stay straight (just stops too hard), or does it pull to one side? |
| `hard_or_unresponsive_pedal` | `spongy_or_soft_pedal` | Does the pedal feel soft and squishy, or stiff and hard to push down? |
| `pedal_sinks_to_floor` | `spongy_or_soft_pedal` | If you press and HOLD the pedal at a stop, does it slowly keep sinking toward the floor, or does it stay where it is (just feels soft)? |
| `pull_that_started_after_recent_tire_or_service_work` | `pulling_only_when_braking` | Did the pulling start right after tire, alignment, or brake work was done? |
| `pulling_only_when_braking` | `steady_drift_while_cruising` | Does it pull only while you're pressing the brakes, or does it drift to one side even when just cruising? |
| `regen_brake_feel_change` ⇄ | `spongy_or_soft_pedal` | Does the odd feel only show up cold or with a full battery on your hybrid/EV, or is it there all the time / with grinding or squealing? |

## Pull / drift / steering feel (10 pairs)

> Constant vs brake-only vs road-crown-dependent vs after-recent-work; one-direction pull vs bi-directional wander; car drifts vs wheel just crooked; heavy vs loose.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `drift_that_follows_the_roads_slope` | `steady_drift_while_cruising` | Does it pull on every road, or only on certain roads (fine on flat side streets)? |
| `driver_assist_warning_or_malfunction` | `phantom_braking_or_steering` | Is the system actually braking/steering on its own, or just showing a warning? |
| `hard_to_turn_heavy_steering` | `loose_or_sloppy_steering` | Is the wheel hard to physically turn, or easy to turn but loose and sloppy feeling? |
| `loose_or_sloppy_steering` | `wandering_or_drifting_in_both_directions` | Is it the wheel itself that feels loose with a dead spot, or does the car drift side to side even though the wheel feels normal? |
| `phantom_braking_or_steering` ⇄ | `steady_drift_while_cruising` | Does a driving-assist system tug the wheel now and then (sometimes with a lane message), or does the car steadily pull to one side all the time? |
| `pull_that_started_after_recent_tire_or_service_work` | `recent_tire_work_then_new_symptom` | Is the new problem a pull to one side, or something else like a vibration or noise since the work? |
| `pull_that_started_after_recent_tire_or_service_work` | `steady_drift_while_cruising` | Did the pull start right after tire or alignment work, or has it developed on its own over time? |
| `pull_that_started_after_recent_tire_or_service_work` | `steering_wheel_off_center_when_driving_straight` | Since the recent work, is the problem a crooked wheel while driving straight, or the car actually pulling to a side? |
| `steady_drift_while_cruising` | `steering_wheel_off_center_when_driving_straight` | Does the car itself drift to one side, or does it drive straight while the wheel just sits crooked? |
| `steady_drift_while_cruising` | `wandering_or_drifting_in_both_directions` | Does it always pull toward the same side, or wander back and forth in both directions? |

## HVAC & comfort (15 pairs)

> Three orthogonal axes: temperature (warm vs cold), volume (airflow), distribution (which vents / which side). One working side proves the refrigerant charge; the temp gauge separates comfort from cooling-system trouble.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `air_from_wrong_vents` | `foggy_windows_wont_defog` | Is the complaint where the air comes out, or that the windows won't clear? |
| `foggy_windows_wont_defog` ⇄ | `wipers_or_washers_not_working` | Is this about the wipers/washers, or the defroster not clearing fog on the INSIDE of the glass? |
| `ac_blows_warm_or_hot_air` | `ac_keeps_losing_refrigerant` | Has it been recharged before and lost its cold again, or is this the first time it stopped cooling? |
| `ac_blows_warm_or_hot_air` | `ac_weak_not_cold_enough` | Is the air totally warm like outside air, or still somewhat cool just not cold enough? |
| `ac_blows_warm_or_hot_air` | `one_side_hot_one_side_cold` | Is it warm on BOTH sides, or is one side cold and the other side warm? |
| `ac_blows_warm_or_hot_air` | `weak_airflow_from_vents` | Is plenty of air coming out but it's warm, or is the air cold but there's barely any of it? |
| `ac_keeps_losing_refrigerant` | `ac_weak_not_cold_enough` | Did the cooling fade weeks/months after a recharge, or has it just always been weak? |
| `ac_weak_not_cold_enough` | `weak_airflow_from_vents` | Is the air cold but there's barely any of it, or is plenty of air coming out that just isn't cold? |
| `air_from_wrong_vents` | `weak_airflow_from_vents` | Is there barely any air anywhere, or is plenty of air coming out — just from the wrong vents? |
| `coolant_loss_low_coolant` | `engine_overheating_running_hot` | Has the temperature gauge actually gone hot, or has it stayed normal while the level drops? |
| `coolant_loss_low_coolant` | `no_heat` | Have you had to add coolant lately or seen the level drop? |
| `engine_overheating_running_hot` | `no_heat` | Is the temperature gauge or a red temp light reading HIGH, or is it just no warm air with a normal gauge? |
| `no_heat` | `one_side_hot_one_side_cold` | Is there no heat on BOTH sides, or does one side blow warm while the other is cold? |
| `no_heat` | `weak_airflow_from_vents` | Is air coming out of the vents but it's cold, or is no air blowing out at all? |
| `single_accessory_not_working` ⇄ | `weak_airflow_from_vents` | Is it the heater/AC FAN not blowing (climate system), or a different accessory? |

## ADAS (3 pairs)

> Self-initiated intervention vs warning-only vs post-service calibration. Assist-feature messages are NOT the charging-cascade "all lights on" pattern.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `adas_calibration_after_windshield_or_service` | `driver_assist_warning_or_malfunction` | Did the warning start right after a windshield replacement, alignment, bumper repair, or battery change? |
| `adas_calibration_after_windshield_or_service` ⇄ | `steady_drift_while_cruising` | Is it the lane-assist system steering you (with an assist light/message, after the work), or does the car pull even with all the assists off? |
| `driver_assist_warning_or_malfunction` ⇄ | `single_accessory_not_working` | Is a warning or assist feature involved, or is a screen/camera display simply dead with no message? |

## EV / hybrid (1 pair)

> The 12V-first rule: a flat 12V blocks READY on a healthy pack. Won't-power-on vs won't-charge vs range-fade vs derate are four different bookings.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `battery_degradation_range_loss` | `ev_wont_charge` | Does it charge fine but not go as far, or is the problem charging itself? |

## Keys / security / locks (2 pairs)

> Fob-dead-but-starts vs fob-dead-and-no-start vs lock actuator vs latch mechanics vs new-key request.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `door_trunk_hood_latch_problem` | `key_fob_remote_not_working` | Does the trunk open fine from inside the car but not from the remote, or does nothing open it at all? |
| `key_fob_remote_not_working` | `power_locks_not_working` | Do the locks work from the switch inside the car, and it's only the remote that fails? |

## Electrical accessories (6 pairs)

> One dead thing vs many glitching things vs battery also dying — accessory fault vs gremlin pattern vs parasitic-draw triage.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `battery_drains_overnight` | `multiple_random_electrical_glitches` | Is the battery also going dead between drives? |
| `battery_drains_overnight` | `single_accessory_not_working` | Is something like the dome light visibly staying on after you lock it? |
| `door_trunk_hood_latch_problem` | `power_locks_not_working` | Is it the LOCK that won't lock/unlock, or the latch/handle that won't physically open or close? |
| `multiple_random_electrical_glitches` ⇄ | `power_locks_not_working` | Is it just the locks, or are several random electrical things acting up (worse after rain)? |
| `multiple_random_electrical_glitches` | `single_accessory_not_working` | Is it one specific thing that's dead, or different things misbehaving at different times? |
| *wiper_blades_streaking* (variant) | `wipers_or_washers_not_working` | Do the wipers move fine but smear/streak (worn rubber blades), or do they not move/spray correctly? |

## Tires & suspension state (5 pairs)

> Visible-condition splits: puncture vs bulge vs age-cracking vs wear pattern; tire-flat vs body-sagging.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `dry_rot_sidewall_cracking` | `uneven_tire_wear_bald_spots` | Is the tread wearing unevenly, or is the rubber cracking from age? |
| `dry_rot_sidewall_cracking` | `visible_damage_nail_screw_bulge_cut` | Is it one bulge, cut, or object in the tire, or lots of small cracks all over the rubber? |
| `recent_tire_work_then_new_symptom` | `wheel_or_lug_concern_loose_wheel` | Do you specifically suspect the wheel or lug nuts are loose, or is it a general new symptom since the tire work? |
| `tire_going_flat_losing_air` | `vehicle_sitting_low_or_leaning_one_corner` | Is the tire itself low or flat, or is the tire fine and the car body sitting lower on that corner? |
| `tire_going_flat_losing_air` | `visible_damage_nail_screw_bulge_cut` | Have you spotted anything in the tire like a nail or screw, or is it losing air with no visible cause? |

## Request vs symptom (47 pairs)

> Named symptom beats request framing — the request becomes metadata. A bare request books directly with NO diagnostic interview (over-asking direct requests is the #1 measured UX failure). These questions are one-shot symptom screens, not interviews.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `ac_blows_warm_or_hot_air` ⇄ | `ac_recharge_request` | Is the A/C actually blowing warm right now, or is this a just-in-case top-off before the season? |
| `ac_keeps_losing_refrigerant` ⇄ | `ac_recharge_request` | Has it been recharged before and gone warm again? That points to a leak that needs finding, not another top-off. |
| `alignment_request` | `new_tires_request` | Just the tires, or an alignment with them (recommended if they wore unevenly)? |
| `alignment_request` | `steady_drift_while_cruising` | Is the car actively pulling or drifting on its own, or is this a preventive/after-new-tires alignment? |
| `alignment_request` | `uneven_tire_wear_bald_spots` | Is the alignment request driven by visible uneven tire wear we should document? |
| `approve_recommended_work` | `brake_service_request` | Work we recommended, or a brake job you're asking about fresh? |
| `approve_recommended_work` | `replace_specific_part` | Is this work we already recommended to you, or something new? |
| `approve_recommended_work` | `second_opinion` | Was it our recommendation you're acting on, or another shop's you want checked? |
| `auto_trans_slipping` | `transmission_fluid_service` | Are you noticing any slipping, hard shifts, or hesitation right now, or is this just routine maintenance? |
| `awd_4x4_binding_in_turns` | `differential_transfer_case_service` | Is the vehicle doing anything odd in turns, or is this routine service? |
| `battery_charging_light` | `battery_test_or_replacement` | Is the red battery light coming on while you drive? |
| `battery_drains_overnight` | `battery_test_or_replacement` | Does the new-ish battery keep going dead? Then something is draining or not charging it — that needs testing, not just a battery. |
| `battery_test_or_replacement` | `slow_crank_sluggish_start` | Have you noticed it starting slower than normal? |
| `battery_test_or_replacement` | `wont_crank_just_clicks` | Is the car failing to start right now, or are you replacing the battery before it becomes a problem? |
| `brake_service_request` | `fluid_flush_service` | Brake pads/rotors, or the brake-fluid flush service? |
| `brake_service_request` | `high_pitched_squealing` | Are the brakes making any noise or feeling different, or is this just a checkup? |
| `brake_service_request` | `metallic_grinding` | Are the brakes making a noise or feeling different when you stop, or is this replacement someone recommended without a symptom? |
| `brake_service_request` | `second_opinion` | Do you want us to do the brake job, or double-check whether you really need it? |
| `check_engine_light_steady` ⇄ | `diagnostic_scan_request` | Is the check engine light on right now? Then let's book it as a check-engine diagnosis. |
| `check_engine_light_steady` ⇄ | `failed_emissions_test` | Did the car actually fail an emissions test or inspection, or is the light on and you haven't been tested yet? |
| `check_engine_light_steady` ⇄ | `state_inspection_emissions` | Is the check engine light on? It usually has to be fixed before the car can pass emissions. |
| `coolant_puddle_green_orange_pink` ⇄ | `fluid_flush_service` | Routine coolant service, or are you losing coolant / seeing puddles or an overheat? |
| `diagnostic_scan_request` | `recall_or_warranty_question` | Do you want us to diagnose the problem itself, or mainly to sort out who pays for it? |
| `differential_transfer_case_service` | `gear_oil_leak` | Any leak or noise from the axle right now, or just due for the fluid? |
| `dry_rot_sidewall_cracking` | `new_tires_request` | Do you want the tires checked to see if they're safe, or are you ready to price replacements? |
| `engine_misfire_or_bucking_feeling` | `tune_up_request` | Is the car running badly right now, or is this maintenance you'd like done? |
| `estimate_quote_request` | `second_opinion` | Just the price, or do you also want us to confirm the repair is really needed? |
| `failed_emissions_test` ⇄ | `state_inspection_emissions` | Do you need a failed test diagnosed and fixed, or are you just booking a routine inspection? |
| `failed_emissions_test` | `tune_up_request` | Are you doing this to pass an emissions test or inspection, or just as routine maintenance? |
| `fluid_flush_service` ⇄ | `harsh_or_jerky_shifting` | Mileage-based fluid service, or is the transmission acting differently when it shifts? |
| `fluid_flush_service` | `oil_change` | Engine oil, or one of the other fluids (coolant, brake, transmission)? |
| `key_fob_remote_not_working` | `key_replacement_or_programming` | Is an existing fob misbehaving, or do you need a new/spare key made or programmed? |
| `key_not_recognized_security_no_start` | `key_replacement_or_programming` | Is this a request for a new/spare key, or is the car refusing to start with the key you have? |
| `new_tires_request` | `tire_rotation_or_balance` | New tires, or rotating/balancing the ones you have? |
| `new_tires_request` | `uneven_tire_wear_bald_spots` | Do you want the cause of the wear diagnosed (alignment/suspension), or do you just need replacement tires? |
| `new_tires_request` | `visible_damage_nail_screw_bulge_cut` | Do you want one tire fixed or patched (a nail, a screw, it's losing air), or new tires because they're worn out or old? |
| `oil_change` | `oil_consumption_burning_oil` | Is the car using oil between changes, or is this just the regular service coming due? |
| `oil_change` | `oil_pressure_light` | Is a RED oil-can light coming on while you drive, or is it a maintenance/oil-life reminder saying you're due for service? |
| `oil_change` | `oil_puddle_brown_black` | Are you just due for an oil change, or are you seeing oil spots or drips under the car? |
| `oil_change` | `scheduled_maintenance_service` | Just the oil change, or the full mileage service your manual calls for? |
| `red_or_pink_puddle_transmission_or_power_steering` | `transmission_fluid_service` | Have you seen any red fluid under the car, or is the fluid level fine and you just want it changed? |
| `replace_specific_part` | `second_opinion` | Do you want us to verify the diagnosis first, or go ahead and do the repair they recommended? |
| `replace_specific_part` ⇄ | `single_accessory_not_working` | Is something not working that you believe this part will fix — or is this a simple replace-it request (bulb, blade, filter)? |
| `rough_idle_or_shaking_at_a_stop` | `tune_up_request` | Is the car actually running rough, shaking, or losing power right now — or do you just want the scheduled plugs-and-filters maintenance? |
| `scheduled_maintenance_service` | `tune_up_request` | Do you want what the factory schedule calls for at your mileage, or specifically plugs/ignition parts? |
| `steering_wheel_shake_at_highway_speed` | `tire_rotation_or_balance` | Is there a noticeable shake at highway speed (worth diagnosing), or is this just routine rotation/balance? |
| `tire_rotation_or_balance` | `uneven_tire_wear_bald_spots` | Just keeping up on rotation, or have you noticed the tires wearing unevenly or on one edge? |

## Situational & triage (29 pairs)

> Situational cue overrides only on a causal tie ("after X, now Y"). Checkup ≠ vague concern (nothing wrong vs something unnameable wrong). Tow-in/safety-fear escalate to human contact.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| `after_accident_or_impact` ⇄ | `airbag_srs_light` | Do you want the airbag LIGHT diagnosed, or a whole-car check after the accident (insurance/body shop involved)? |
| `after_accident_or_impact` | `alignment_request` | Did this start after hitting a pothole, curb, or something else? If so we should check the whole front end, not just align it. |
| `after_accident_or_impact` ⇄ | `clunking_over_bumps` | Is the noise something that started with the impact, or an older problem you'd been hearing before? |
| `after_accident_or_impact` ⇄ | `multiple_warning_lights_at_once` | Did all of this start right after a crash or hitting something? |
| `after_accident_or_impact` | `services_not_offered` | Is it about how the car looks (body shop), or how it drives since the accident (that's us)? |
| `approve_recommended_work` | `booking_logistics` | Booking approved work we already quoted, or a question about an existing appointment? |
| `approve_recommended_work` | `symptom_after_recent_service` | Is something wrong after the recent work, or are you booking work we recommended? |
| `booking_logistics` | `estimate_quote_request` | A price for a specific job on your car, or general questions about hours and how we work? |
| `booking_logistics` | `non_repair_business` | A question about your car or an appointment, or about the business itself? |
| `breakdown_tow_in` ⇄ | `died_while_driving_wont_restart` | Can you describe what happened when it quit (lights, noises, smoke)? If so we can book that specific diagnosis. |
| `breakdown_tow_in` | `safety_concern_not_safe_to_drive` | Has it already quit, or is it running but you're afraid to drive it? |
| `breakdown_tow_in` ⇄ | `wont_crank_just_clicks` | Did it quit while driving, or is it at home and just won't start? |
| `car_sat_unused` | `general_checkup` | Has it been parked a long time, or in regular use and just due for a look-over? |
| `car_sat_unused` | `new_tires_request` | Are the tires cracked or dry-rotted from sitting? Those need replacement, which we can quote as part of the check. |
| `car_sat_unused` ⇄ | `wont_crank_just_clicks` | Is the main problem that it won't start right now, or do you want the whole car gone through before using it again? |
| `diagnostic_scan_request` | `vague_concern_needs_triage` | Is there a symptom you're chasing, or do you just want the computer checked? |
| `estimate_quote_request` | `pre_purchase_inspection` | An inspection of the whole car before you buy, or pricing for a specific repair? |
| `general_checkup` | `pre_purchase_inspection` | A car you're thinking of buying, or one you already own? |
| `general_checkup` | `pre_trip_inspection` | Is there a specific trip coming up, or just a general look-over? |
| `general_checkup` | `scheduled_maintenance_service` | Whatever the factory schedule says is due, or a condition assessment of the whole car? |
| `general_checkup` | `state_inspection_emissions` | The official state inspection sticker, or an open-ended look-over to see what the car needs? |
| `general_checkup` | `vague_concern_needs_triage` | Is something actually wrong (even if hard to describe), or is nothing wrong and you want it looked over? |
| `intermittent_issue_cant_reproduce` | `vague_concern_needs_triage` | When it happens, can you describe it — or is it vague even in the moment? |
| `multiple_symptoms` ⇄ | `multiple_warning_lights_at_once` | Is it mainly a bunch of dashboard lights at once, or several different problems you can feel and hear? |
| `multiple_symptoms` | `vague_concern_needs_triage` | Can you name the problems (even several), or is it more that something feels wrong and you can't pin it down? |
| `not_a_vehicle_issue` | `vague_concern_needs_triage` | (none — a vague concern still references the car; this entry has no vehicle content at all) |
| `pre_trip_inspection` | `state_inspection_emissions` | The state-required inspection, or a check-up before a trip? |
| `recall_or_warranty_question` | `services_not_offered` | A safety recall (free at the manufacturer's dealer), or repair work you'd like us to handle here? |
| `replace_specific_part` | `services_not_offered` | Cosmetic/appearance work, or a mechanical part you need replaced? |

## Routing meta-rules (6 pairs)

> Not entry-vs-entry pairs — these encode the standing routing rules the question policy applies before/after any category pick.

| Concern A | Concern B | Discriminator question |
|---|---|---|
| *every_symptom_domain* (rule) | `vague_concern_needs_triage` | Would you say it's more a sound, a feeling, a smell, or something you see? (first chip of the triage flow) |
| *named_symptom_domain* (rule) | `pre_trip_inspection` | Is something already acting up that worries you for the trip? Let's book that specifically — the trip makes it more worth fixing right. |
| *named_symptom_plus_safety_question* (rule) | `safety_concern_not_safe_to_drive` | Is there one specific thing (a light, a noise, the brakes) you want checked and you're mostly asking if it's OK to drive — or do you genuinely not feel safe in this car? |
| *single_dominant_symptom* (rule) | `multiple_symptoms` | Is there one main thing you'd want fixed first if you had to pick? |
| *underlying_symptom_domain* (rule) | `intermittent_issue_cant_reproduce` | When it does act up, what exactly does it do? (the answer routes it — intermittency is a fact, not a category) |
| *underlying_symptom_domain* (rule) | `symptom_after_recent_service` | Do you think the recent work caused this, or is it a separate new problem you want diagnosed on its own? |

## Within-entry variant splits (3)

> Produced by the taxonomy merges — the discriminator now resolves a variant INSIDE one canonical entry
> (it still shapes the booking note / which system gets named, but not the category pick).

| Entry | Variant split | Discriminator question |
|---|---|---|
| `red_or_pink_puddle_transmission_or_power_steering` | power-steering exit vs transmission exit (three domain entries merged into one canonical red-fluid entry) | Is the red puddle toward the middle or back of the car, or up FRONT by the engine — and has the steering gotten heavy or noisy? |
| `smoke_or_burning_smell_from_a_wheel` | visible smoke vs smell-only (`burning_rubber_hot_brake_smell` folded here) | Do you see actual smoke coming from the wheel, or is it just the burning smell? |
| `clunking_over_bumps` | hear-only clunk vs clunk FELT through the wheel mid-turn (live-taxonomy sibling `clunking_knocking_or_rough_ride_over_bumps` folded here) | Do you mostly HEAR the clunk, or do you also FEEL it through the steering wheel when hitting bumps mid-turn? |
