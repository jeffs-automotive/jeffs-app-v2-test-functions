# Question Required Facts

<!--
Each row maps one concern_questions.id to a comma-separated list of
ExtractedFacts slot names that must be present in the Stage 1 LLM's
extracted facts for the question to count as "answered" by the
Stage 3 question-gate.

This MD does NOT create / modify / delete questions themselves — only
the required_facts column. Use upload_concern_category_md to add /
edit / remove questions; this file edits the fact-gating list ONLY.

What required_facts does
------------------------
The 3-stage diagnostic LLM extracts atomic facts (slot values) from
the customer's free-text description in Stage 1. Stage 3 then walks
the active question list for the chosen subcategory and decides
which questions are already answered by those extracted facts vs.
which still need to be asked. A question with required_facts =
['speed_specific_mph'] is treated as answered iff Stage 1's facts
object has a non-null `speed_specific_mph`. Multiple slots means ALL
must be present (logical AND).

Empty cell → no fact gating (question is only marked answered if
Stage 1's free-text answer-marker explicitly flagged it). This is
the default for every question post-migration.

Required columns: question_id, required_facts.
  - question_id: positive integer; must exist in concern_questions
    for this shop AND be active.
  - required_facts: comma-list of ExtractedFacts slot names from the
    29 canonical keys (see below), or blank / `(none)` / `-` to clear.

Diff semantics
--------------
  - Rows OMITTED from the MD are LEFT ALONE.
  - Blank cell / `(none)` / `-` CLEARS the mapping (sets to '{}').
  - Non-empty cell REPLACES the list (in MD order, de-duped).

Validation rules (BLOCKS apply)
-------------------------------
  - question_id is a positive integer
  - question_id exists in concern_questions (active=true required only
    for the question to TAKE EFFECT; inactive questions are upload-
    accepted with a warning)
  - every slot name is in the 29 canonical ExtractedFacts keys
  - duplicate question_id in same upload

WARNS (surface for confirmation; doesn't block)
-----------------------------------------------
  - Question is currently inactive (required_facts will be stored
    but won't take effect until the question is reactivated)

The 29 ExtractedFacts slots (with one-line examples)
----------------------------------------------------
  - location_side: left/right/both/varies/unsure
      ("driver side", "passenger side", "both wheels")
  - location_axle: front/rear/all/unsure
      ("front wheels", "back of the car")
  - speed_band: stopped/idle/low_speed/mid_speed/highway/specific_mph/all_speeds
      ("on the highway", "in parking lots")
  - speed_specific_mph: integer
      ("shakes at 65 mph" → 65)
  - onset_timing: cold_start/after_warming_up/at_startup/at_first_turn_on/
      during_driving/at_stop/over_bumps/when_braking/when_accelerating/
      when_turning/when_idling/always/intermittent
      ("only when cold", "when I press the gas")
  - started_when: just_now/today/days_ago/weeks_ago/months_ago/a_year_plus/
      since_purchase/sudden_onset/gradually
      ("started today", "gradually got worse")
  - hvac_mode: ac/heat/defrost/fan_only/both_ac_and_heat/none
      ("when I turn on the AC", "on defrost")
  - airflow_state: strong_normal/weak_overall/only_on_highest_setting/
      only_one_zone_blows/no_airflow/uneven_temperature_between_zones
      ("only works on max fan", "no air at all")
  - pedal_feel: normal/soft_spongy/hard_unresponsive/sinks_to_floor/
      pulsating/grabby
      ("pedal goes to the floor", "spongy brakes")
  - smell_descriptor: sweet_or_maple_syrup/burnt_oil/gasoline_or_fuel/
      rotten_egg_or_sulfur/burning_electrical_or_plastic/
      burning_rubber_or_hot_brakes/musty_or_mildew/exhaust_inside_cabin/
      other_burning
      ("sweet smell", "burning oil")
  - noise_descriptor: squealing_high_pitched/grinding_metallic/knocking_deep/
      ticking_or_tapping/clunking/rattling/hissing/humming_or_whirring/
      whining/popping_or_clicking/buzzing/creaking_or_squeaking/roaring/
      scraping
      ("metal-on-metal grinding", "clunk over bumps")
  - smoke_color: white/blue_or_gray/black/steam_thin_wispy/visible_but_color_unclear
      ("white smoke from the tailpipe")
  - fluid_color: brown_or_black/green_or_orange_or_yellow_or_pink/red_or_pink/
      clear_yellow_or_light_brown/clear_no_color/blue_or_light_blue/
      thick_dark_brown
      ("green puddle under the car")
  - fluid_under_car_location: under_engine_front/under_middle/under_rear/
      under_a_wheel/under_passenger_side/under_driver_side/unsure
      ("puddle under the front")
  - warning_light_named: free text
      ("check engine", "TPMS", "ABS")
  - warning_light_behavior: steady_on/flashing_or_blinking/comes_and_goes/
      came_on_then_off/multiple_lights_at_once
      ("CEL is blinking", "light came on then went off")
  - engine_running: normal/rough_idle/misfiring/surging/stalls/wont_start/
      slow_crank/wont_crank_just_clicks/died_while_driving/no_sound_at_all
      ("won't start, just clicks", "shakes at idle")
  - recent_action: brake_work/tire_rotation_or_replacement/tire_air_added/
      oil_change/battery_or_alternator_work/alignment/general_service/
      jump_started/ac_recharge_or_service/accident_or_impact/
      hit_pothole_or_curb/car_wash_or_driven_through_water/car_sat_unused/
      fuel_fill_up/none_mentioned
      ("just had new brakes", "after my oil change")
  - parking_brake_state: released/engaged_or_partially_engaged/customer_unsure
      ("parking brake is off")
  - tire_state: low_pressure/flat/visible_damage/sidewall_cracking/
      uneven_wear/normal_or_unknown
      ("got a nail in it", "sidewall is cracked")
  - steering_feel: normal/heavy_or_hard_to_turn/loose_or_sloppy/
      wheel_off_center_while_straight/stiff_one_direction_only
      ("hard to steer", "loose steering")
  - pull_direction: left/right/varies_or_wanders/no_pull
      ("pulls to the left", "wanders side-to-side")
  - lights_state: dim_or_flickering/dim_at_idle_brighten_when_revving/
      normal/completely_dead
      ("dim headlights", "lights brighten when I rev")
  - accessory_affected: free text
      ("driver window", "radio")
  - weather_condition: cold_weather/hot_weather/rainy_or_wet/humid/
      after_snow_or_ice/any_weather
      ("only on cold mornings")
  - sound_or_smoke_location_zone: under_hood/under_car/from_a_wheel/
      behind_dashboard/from_vents/from_tailpipe/passenger_footwell/
      inside_cabin_general/unsure
      ("from under the hood", "from the front-right wheel")
  - vehicle_powertrain: gasoline/diesel/hybrid/electric/turbocharged/not_stated
      ("it's a diesel")
  - drivable_state: drivable_normally/drivable_but_concerned/
      not_drivable_needs_tow/stranded_now
      ("can't drive it", "stuck on the road")
  - customer_request_type: diagnose_problem/fix_a_known_problem/
      replace_specific_part/routine_maintenance/pre_trip_inspection/
      second_opinion/just_get_new_tires
      ("want to diagnose the noise", "just need an oil change")

Parallel-mirror obligation
--------------------------
This list MUST stay in lock-step with EXTRACTED_FACTS_ALL_KEYS in
scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts. The
uploader's allow-list is a duplicate constant in
supabase/functions/_shared/tools/scheduler-admin-catalog.ts. When
the schema changes (slot added/removed/renamed), update all three
in the same commit.

Two-step flow: dry_run=true (default) → review diff →
dry_run=false + expected_confirm_token=<token>.

The 5 sample rows below illustrate the format — replace with the
question_ids you're actually editing. Omitted question_ids are
LEFT ALONE; you don't need to list the whole catalog.
-->

| question_id | required_facts |
| --- | --- |
| 688 | speed_specific_mph |
| 691 | location_side |
| 967 | hvac_mode |
| 727 | recent_action, warning_light_behavior |
| 716 | location_side, location_axle |
