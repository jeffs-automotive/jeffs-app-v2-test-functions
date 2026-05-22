# Subcategory → Testing Service Mappings

<!--
Each row maps one (concern_category, subcategory_slug) pair to a
comma-separated list of testing_service_keys it's eligible under.
Edit cells inline + re-upload via Claude Desktop. The orchestrator
always shows a diff for advisor approval before applying — bulk uploads
are dry-run by default.

When the testing_service_keys cell is NON-EMPTY, the diagnostic LLM
routes ONLY to the listed services for that subcategory
(testing_services.concern_categories[] is IGNORED for this subcategory).

When the cell is BLANK or "(none)", the subcategory falls back to the
current concern_categories[]-based fan-out OR — for `category=other`
rows — gets elevated to a top-level advisor-handoff entry that bypasses
testing services entirely.

Rows OMITTED from this file entirely are LEFT ALONE — uploads never
silently clear mappings. To clear an existing mapping, list the row
with a blank cell.

Required columns: category, subcategory_slug, testing_service_keys.

Validation:
  - category must be one of the 14 canonical concern category slugs:
    noise, vibration, pulling, smell, smoke, leak, warning_light,
    performance, electrical, hvac, brakes, steering, tires, other
  - subcategory_slug + category must exist in concern_subcategories
    (the parser cross-checks the (category, slug) natural key against
    the current concern_subcategories table)
  - each testing_service_key must exist in testing_services AND be
    active (the parser cross-checks against testing_services)
  - duplicate (category, subcategory_slug) in the SAME upload is blocked

This MD does NOT create / modify / delete concern_subcategories or
testing_services themselves — only the eligible_testing_service_keys
column on concern_subcategories. Use:
  - testing-services.md  → for testing_service catalog edits
  - concern category MD  → for subcategory + question edits

Full 92-row mapping authored 2026-05-21 — covers every active
subcategory across the 14 concern categories, post-testing-services-
catalog refactor (24 active services after exhaust_system_testing
added 2026-05-21 evening). The 6 `category=other` rows carry (none)
because the catalog loader elevates them to top-level advisor-handoff
entries and never fans them out to a testing service.
-->

| category | subcategory_slug | testing_service_keys |
| --- | --- | --- |
| brakes | high_pitched_squealing | brake_inspection |
| brakes | metallic_grinding | brake_inspection |
| brakes | spongy_or_soft_pedal | brake_inspection |
| brakes | pedal_sinks_to_floor | brake_inspection |
| brakes | pulsating_or_vibrating_pedal | brake_inspection |
| brakes | hard_or_unresponsive_pedal | brake_inspection |
| electrical | wont_crank_just_clicks | no_start_testing, charging_starting_testing |
| electrical | slow_crank_sluggish_start | charging_starting_testing |
| electrical | battery_drains_overnight | charging_starting_testing |
| electrical | dim_or_flickering_lights | charging_starting_testing |
| electrical | accessory_doesnt_work | electrical_testing_general |
| electrical | multiple_random_electrical_glitches | electrical_testing_general |
| electrical | car_died_while_driving_electrical | charging_starting_testing, no_start_testing |
| hvac | ac_blows_warm_or_hot_air | ac_performance_check, ac_leak_testing |
| hvac | ac_is_weak_not_cold_enough | ac_performance_check, ac_leak_testing |
| hvac | heat_doesnt_work | ac_performance_check, coolant_leak_testing |
| hvac | vents_dont_blow_strongly | ac_performance_check |
| hvac | foggy_or_hard_to_defog_windows | ac_performance_check |
| hvac | strange_noise_from_vents | ac_performance_check |
| hvac | bad_smell_from_vents | ac_performance_check |
| hvac | one_zone_works_but_another_doesnt | ac_performance_check |
| leak | brown_or_black_puddle_engine_oil | oil_leak_testing |
| leak | green_orange_yellow_or_pink_puddle_coolant | coolant_leak_testing |
| leak | red_or_pink_puddle_transmission_or_power_steering | transmission_testing, power_steering_eps_testing |
| leak | clear_yellow_or_light_brown_puddle_brake_fluid | brake_inspection |
| leak | clear_odorless_puddle_water_or_ac_condensation | ac_leak_testing |
| leak | thick_dark_brown_puddle_gear_or_differential_oil | oil_leak_testing |
| leak | blue_or_light_blue_puddle_washer_fluid | (none) |
| noise | engine_ticking_or_tapping | check_engine_light_testing, oil_pressure_light_testing |
| noise | clunking_over_bumps | suspension_steering_check |
| noise | humming_or_whirring_at_speed | suspension_steering_check |
| noise | high_pitched_whining_under_the_hood | charging_starting_testing, power_steering_eps_testing |
| noise | rattling_underneath_the_car | suspension_steering_check, exhaust_system_testing |
| noise | exhaust_louder_or_rumbling | exhaust_system_testing |
| noise | exhaust_manifold_tick_or_puff | exhaust_system_testing |
| noise | hissing_noise | check_engine_light_testing, coolant_leak_testing |
| noise | popping_or_clicking_when_turning | suspension_steering_check |
| noise | deep_knocking_from_the_engine | check_engine_light_testing |
| noise | squeaking_or_creaking_over_bumps | suspension_steering_check |
| noise | electrical_buzzing | electrical_testing_general |
| other | multiple_symptoms_not_sure_what_category | (none) |
| other | after_a_recent_accident_or_impact | (none) |
| other | after_recent_service_or_repair_work | (none) |
| other | safety_concern_dont_feel_safe_driving_it | (none) |
| other | general_check_up_or_pre_trip_inspection | (none) |
| other | car_has_been_sitting_unused_for_a_long_time | (none) |
| performance | hesitation_or_lag_when_accelerating | check_engine_light_testing, transmission_testing |
| performance | rough_idle_or_shaking_at_a_stop | check_engine_light_testing |
| performance | stalling_at_idle_or_when_stopping | check_engine_light_testing |
| performance | stalling_while_driving_under_load | check_engine_light_testing, no_start_testing |
| performance | hard_to_start_when_cold | no_start_testing, check_engine_light_testing |
| performance | hard_to_start_when_hot | no_start_testing, check_engine_light_testing |
| performance | low_power_or_wont_accelerate_normally | check_engine_light_testing, transmission_testing |
| performance | surging_or_rpms_going_up_and_down | check_engine_light_testing, transmission_testing |
| performance | engine_misfire_or_bucking_feeling | check_engine_light_testing |
| pulling | pulling_only_when_braking | brake_inspection |
| pulling | steady_drift_while_cruising | suspension_steering_check |
| pulling | pulling_only_during_acceleration | suspension_steering_check |
| pulling | drift_that_follows_the_roads_slope | suspension_steering_check |
| pulling | pull_that_started_after_recent_tire_or_service_work | suspension_steering_check |
| pulling | wandering_or_drifting_in_both_directions | suspension_steering_check |
| smell | sweet_smell_maple_syrup_antifreeze | coolant_leak_testing |
| smell | burnt_oil_smell | oil_leak_testing |
| smell | gasoline_fuel_smell | check_engine_light_testing |
| smell | rotten_egg_sulfur_smell | check_engine_light_testing |
| smell | burning_electrical_plastic_smell | electrical_testing_general |
| smell | burning_rubber_hot_brake_smell | brake_inspection |
| smell | musty_mildew_smell_from_vents | ac_performance_check |
| smell | exhaust_fumes_inside_the_cabin | check_engine_light_testing, exhaust_system_testing |
| smoke | white_smoke_from_tailpipe | coolant_leak_testing, check_engine_light_testing |
| smoke | blue_or_gray_smoke_from_tailpipe | check_engine_light_testing |
| smoke | black_smoke_from_tailpipe | check_engine_light_testing |
| smoke | smoke_from_under_the_hood | coolant_leak_testing, oil_leak_testing |
| smoke | smoke_or_burning_smell_from_a_wheel | brake_inspection |
| smoke | smoke_or_strong_smell_inside_the_cabin | electrical_testing_general |
| steering | hard_to_turn_heavy_steering | power_steering_eps_testing |
| steering | loose_or_sloppy_steering | suspension_steering_check |
| steering | steering_wheel_off_center_when_driving_straight | suspension_steering_check |
| steering | noise_when_turning_the_steering_wheel | power_steering_eps_testing, suspension_steering_check |
| steering | steering_wheel_shakes_at_highway_speed | suspension_steering_check |
| steering | pulling_drifting_or_wandering_on_the_road | suspension_steering_check |
| steering | clunking_knocking_or_rough_ride_over_bumps | suspension_steering_check |
| tires | visible_damage_nail_screw_bulge_cut | tpms_testing |
| tires | tire_going_flat_losing_air | tpms_testing |
| tires | low_pressure_warning_light_only | tpms_testing |
| tires | uneven_tire_wear_bald_spots | suspension_steering_check |
| tires | dry_rot_sidewall_cracking | (none) |
| tires | just_want_new_tires | (none) |
| tires | recent_tire_work_then_new_symptom | suspension_steering_check |
| vibration | steering_wheel_shake_at_highway_speed | suspension_steering_check |
| vibration | vibration_or_pulsing_when_braking | brake_inspection |
| vibration | shaking_at_idle_while_stopped | check_engine_light_testing |
| vibration | shaking_when_speeding_up_or_going_uphill | suspension_steering_check, transmission_testing |
| vibration | shaking_or_bouncing_over_bumps_and_rough_roads | suspension_steering_check |
| vibration | constant_vibration_that_doesnt_change_with_speed | suspension_steering_check |
| warning_light | check_engine_light | check_engine_light_testing |
| warning_light | service_engine_soon_or_maintenance_required_light | check_engine_light_testing |
| warning_light | battery_charging_light | charging_starting_testing |
| warning_light | oil_pressure_light | oil_pressure_light_testing |
| warning_light | engine_temperature_light | coolant_leak_testing, check_engine_light_testing |
| warning_light | tpms_tire_pressure_light | tpms_testing |
| warning_light | abs_anti_lock_brake_light | abs_traction_stability_testing |
| warning_light | brake_system_red_light | brake_inspection_warning_light |
| warning_light | airbag_srs_light | airbag_srs_testing |
| warning_light | traction_control_stability_light | abs_traction_stability_testing |
| warning_light | power_steering_eps_light | power_steering_eps_testing |
| warning_light | multiple_warning_lights_at_once | warning_light_general |
