# Differential table — NVH (noise / vibration / harshness)

> Machine-consumable form of `routers/router-nvh.md` §3-§5. Owned by `router-nvh`. Every row: a
> **(descriptor OR vibration) × condition** key → ranked candidate systems/subcategories → the ONE
> discriminating fact. Subcategory slugs and testing-service keys are bound to
> `00-current-scheduler-taxonomy.md`; `NO-FIT` marks a proposed subcategory. `probe` = the deciding fact
> has no slot today, so the wizard must ASK it (never skip). LITERALNESS governs every cue.
>
> Column legend: `desc` = noise_descriptor value (or `VIBRATION`); `cond` = onset_timing / speed_band /
> zone cue the customer literally stated; `rank1` = confident pick; `hedge` = other candidates to keep;
> `decide` = the single fact that resolves it; `slot` = ✅ exists / ⚠ partial / ❌ needs-proposal.

---

## A. Noise rows

| id | desc | cond | rank1 subcat (service) | hedge candidates | decide (fact = value) | slot |
|---|---|---|---|---|---|---|
| N1 | squealing_high_pitched | when_braking | high_pitched_squealing (brake_inspection) | belt whine; steering | onset_timing=when_braking → brakes | ✅ |
| N2 | squealing_high_pitched | during_driving, foot-off, quiets on brake | high_pitched_squealing (brake_inspection) | wheel bearing | quiets-when-braking → brake wear-tab (NOT bearing) | ✅ |
| N3 | squealing_high_pitched | when_turning the wheel | noise_when_turning_the_steering_wheel (suspension_steering_check) | CV click; brakes | onset_timing=when_turning → steering; when_braking → brakes | ✅ |
| N4 | grinding_metallic / scraping | when_braking | metallic_grinding (brake_inspection) | wheel bearing; driveline | grinding on-pedal-only → brakes; also off-pedal → bearing (N6) | ✅ |
| N5 | whining | RPM-linked / continuous, under hood, not turning | high_pitched_whining_under_the_hood (charging_starting_testing) | PS; turbo | RPM-linked → belt/alt; when_turning → PS (N3) | ✅ |
| N6 | humming_or_whirring / roaring | rises with road speed, louder turning one way | humming_or_whirring_at_speed (suspension_steering_check) | tire roar; diff (N7) | steering_load_effect present → bearing; absent+uneven_wear → tire | ❌ steering_load_effect → probe |
| N7 | humming_or_whirring / whining | rises with road speed, changes on-gas vs coast | humming_or_whirring_at_speed (suspension_steering_check) / awd_4x4_testing | wheel bearing (N6); transmission | throttle-phase change → diff; gear/RPM-linked → transmission_testing | ⚠ probe |
| N8 | popping_or_clicking | when_turning, moving, low_speed, one side | popping_or_clicking_when_turning (suspension_steering_check) | steering (N3); AWD bind | speed_band=low_speed (moving) → CV; stopped → steering | ✅ |
| N9 | clunking | over_bumps, no brake/throttle input | clunking_over_bumps (suspension_steering_check) | driveline (N10); brakes (N11) | onset_timing=over_bumps → suspension | ✅ |
| N10 | clunking | on shift park↔drive/reverse, take-off, on/off throttle | NO-FIT → driveline_engagement_clunk_or_bind (awd_4x4_testing / transmission_testing) | suspension (N9) | onset_timing=on_gear_engagement_or_take_off → driveline | ⚠ value proposed (driveline §5) |
| N11 | clunking / knocking (single) | the instant brake is pressed OR released | brake_inspection (loose caliper/guide pin) | suspension (N9) | fires on brake input → brakes | ✅ |
| N12 | knocking_deep | when_accelerating / under load / uphill, lower engine | deep_knocking_from_the_engine (check_engine_light_testing) | suspension clunk | when_accelerating + knocking_deep → engine; over_bumps → suspension | ✅ |
| N13 | ticking_or_tapping | cold_start, fades/gone once warm, under hood | exhaust_manifold_tick_or_puff (exhaust_system_testing) | valvetrain (N14) | warm_up_behavior=quiets_when_warm → manifold | ❌ warm_up_behavior → probe |
| N14 | ticking_or_tapping | present warm, tracks RPM, top of engine | engine_ticking_or_tapping (oil_pressure_light_testing / check_engine_light_testing) | manifold (N13); chain | persists-warm → valvetrain/chain | ❌ warm_up_behavior → probe |
| N15 | rattling | underneath, at idle / throttle-blip, "can of rocks" | rattling_underneath_the_car (exhaust_system_testing) | suspension clunk (N9); heat shield | engine-vibration-triggered → exhaust; bump-triggered → suspension | ✅ |
| N16 | roaring / rumbling | rises with engine RPM (rev in park), deep drone | exhaust_louder_or_rumbling (exhaust_system_testing) | tire/bearing roar (N6) | RPM-linked → exhaust; road-speed-linked → bearing | ⚠ probe (rumbling_or_droning proposed, exhaust §9) |
| N17 | creaking_or_squeaking | over_bumps, worse cold/wet | squeaking_or_creaking_over_bumps (suspension_steering_check) | steering (N3); brake squeal | over_bumps → suspension; when_turning → steering; when_braking → brakes | ✅ |
| N18 | buzzing | electrical, switch/relay tied, no engine-RPM link | electrical_buzzing (electrical_testing_general) | mechanical rattle (N15) | electrical/relay buzz → electrical | ✅ |
| N19 | hissing | when_braking + hard pedal | hard_or_unresponsive_pedal (brake_inspection) | coolant/vacuum hiss | hiss on-pedal + hard pedal → booster; else → hissing_noise | ✅ |

## B. Vibration rows

| id | VIBRATION presentation | cond | rank1 subcat (service) | hedge candidates | decide (fact = value) | slot |
|---|---|---|---|---|---|---|
| V1 | shudder/pulse only when braking | when_braking | vibration_or_pulsing_when_braking / pulsating_or_vibrating_pedal (brake_inspection) | balance (V2) | onset_timing=when_braking → brakes | ✅ |
| V2 | steering-wheel shimmy, narrow highway band, foot off brake | speed_band=highway / specific_mph | steering_wheel_shake_at_highway_speed (suspension_steering_check) | brakes (V1); out-of-round (V6) | highway band + no brake → balance | ✅ |
| V3 | shake/bounce/harshness over bumps & rough roads | over_bumps | shaking_or_bouncing_over_bumps_and_rough_roads (suspension_steering_check) | balance (V2) | over_bumps → suspension | ✅ |
| V4 | shudder when speeding up / uphill / take-off | when_accelerating | shaking_when_speeding_up_or_going_uphill (suspension_steering_check) | engine misfire (performance); driveline | when_accelerating straight-line → driveline; flashing CEL/bucking → engine | ✅ |
| V5 | shake only at idle / stopped, engine running, smooths moving | at_stop / when_idling | shaking_at_idle_while_stopped (check_engine_light_testing / transmission_testing) | balance (V2) | present at idle, gone in motion → engine/mounts | ✅ |
| V6 | constant tremor at every speed, no band, ignores brake/throttle | all_speeds | constant_vibration_that_doesnt_change_with_speed (suspension_steering_check) | balance (V2) | all_speeds + no band + no brake/throttle change → out-of-round | ✅ |

## C. `vibration_felt_location` routing signal (multi-value; routing-only, NEVER a skip key)

| felt location (literal) | rank1 subcat | rationale |
|---|---|---|
| steering_wheel only | steering_wheel_shake_at_highway_speed (V2) | front/steering/front-balance transmits up the column |
| seat | constant_vibration_that_doesnt_change_with_speed / shaking_when_speeding_up (V6/V4) | rear-axle/driveshaft felt in the seat |
| brake_pedal | vibration_or_pulsing_when_braking (V1) | rotor pulsation; pair with onset_timing=when_braking + pedal_feel=pulsating |
| whole_car (at idle) | shaking_at_idle_while_stopped (V5) | engine mount / rough idle couples the body |
| floor (at speed) | shaking_when_speeding_up / constant_vibration (V4/V6) | driveline/exhaust telegraphs through the floor |
| wheel AND seat (multi-stated) | advisor / broaden | multi-location is itself the signal — DO NOT collapse |

## D. Owned confusable pairs → discriminator (the charter, condensed)

| pair | discriminator fact = value | slot |
|---|---|---|
| P1 brake-vibration ↔ suspension/balance | onset_timing=when_braking vs speed_band=highway(+no brake) / over_bumps | ✅ |
| P2 CV click ↔ steering-column noise-on-turn | when_turning + speed_band=low_speed(moving) vs stopped | ✅ |
| P2b CV click ↔ wheel-bearing hum | noise_descriptor=popping_or_clicking vs humming_or_whirring | ✅ |
| P3 wheel-bearing hum ↔ tire hum/roar | steering_load_effect present (bearing) vs absent+tire_state=uneven_wear (tire) | ❌ probe |
| P4 valvetrain tick ↔ exhaust-manifold tick | warm_up_behavior=quiets_when_warm (manifold) vs persists (valvetrain) | ❌ probe |
| P5 diff whine ↔ wheel-bearing hum | onset_timing on-gas/coast change (diff) vs pure speed-tracking (bearing) | ⚠ probe |
| P5b diff/bearing ↔ transmission whine | road-speed-tracking (driveline) vs RPM/gear-linked (transmission) | ⚠ probe |
| P6 driveline take-off clunk ↔ suspension bump clunk ↔ brake-apply clunk | on_gear_engagement_or_take_off vs over_bumps vs when_braking | ⚠ driveline value proposed |
| P7 engine rod-knock ↔ suspension clunk | when_accelerating+knocking_deep (engine) vs over_bumps+clunking (suspension) | ✅ |
| P8 exhaust rumble/roar ↔ tire/bearing roar | rises-with-RPM-in-park (exhaust) vs rises-with-road-speed (bearing) | ⚠ probe |

## E. Slot dependencies (referenced, NOT re-proposed here)

| slot | owner dossier | status | used by NVH rows |
|---|---|---|---|
| steering_load_effect | wheels-tires-tpms-bearings §9 | proposed (clears ≥3) | N6, P3 |
| warm_up_behavior / symptom_warmup_trend | engine-mechanical §9 (exhaust §9 refs) | proposed (clears ≥3, 4 warm-up Qs) | N13, N14, P4 |
| onset_timing += on_gear_engagement_or_take_off | driveline-cv-diff-awd §5 | value.add proposed | N10, P6 |
| noise_descriptor += rumbling_or_droning | exhaust-emissions §9 | value.add proposed | N16, P8 |
| driveline_behavior=binds_or_hops_in_turns | driveline-cv-diff-awd §5 | proposed | AWD bind vs CV |
| vibration_felt_location | this router (from q3 map §1) | routing signal only, NOT a skip key | §C, all V rows |
