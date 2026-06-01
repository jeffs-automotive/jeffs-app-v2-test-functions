// extracted-facts-schema — llm-testing module.
// Extracted from llm-testing/index.ts (file-size-refactor). Mechanical split.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { z } from "npm:zod@^4";

// ════════════════════════════════════════════════════════════════════
// EXTRACTED-FACTS — Zod + JSON Schema + key registry
// ════════════════════════════════════════════════════════════════════
//
// Inlined verbatim from scheduler-app/src/lib/scheduler/wizard/llm/
// extracted-facts.ts. Deno cannot import that file; both files must
// describe an identical contract for the eval harness and the production
// scheduler to produce comparable results. Mirror any change there
// in the SAME commit.

export const ExtractedFactsSchema = z.object({
  location_side: z
    .enum(["left", "right", "both", "varies", "unsure"])
    .nullable(),
  location_axle: z.enum(["front", "rear", "all", "unsure"]).nullable(),
  speed_band: z
    .enum([
      "stopped",
      "idle",
      "low_speed",
      "mid_speed",
      "highway",
      "specific_mph",
      "all_speeds",
    ])
    .nullable(),
  speed_specific_mph: z.number().int().nullable(),
  onset_timing: z
    .enum([
      "cold_start",
      "after_warming_up",
      "at_startup",
      "at_first_turn_on",
      "during_driving",
      "at_stop",
      "over_bumps",
      "when_braking",
      "when_accelerating",
      "when_turning",
      "when_idling",
      "always",
      "intermittent",
    ])
    .nullable(),
  started_when: z
    .enum([
      "just_now",
      "today",
      "days_ago",
      "weeks_ago",
      "months_ago",
      "a_year_plus",
      "since_purchase",
      "sudden_onset",
      "gradually",
    ])
    .nullable(),
  hvac_mode: z
    .enum(["ac", "heat", "defrost", "fan_only", "both_ac_and_heat", "none"])
    .nullable(),
  airflow_state: z
    .enum([
      "strong_normal",
      "weak_overall",
      "only_on_highest_setting",
      "only_one_zone_blows",
      "no_airflow",
      "uneven_temperature_between_zones",
    ])
    .nullable(),
  pedal_feel: z
    .enum([
      "normal",
      "soft_spongy",
      "hard_unresponsive",
      "sinks_to_floor",
      "pulsating",
      "grabby",
    ])
    .nullable(),
  smell_descriptor: z
    .enum([
      "sweet_or_maple_syrup",
      "burnt_oil",
      "gasoline_or_fuel",
      "rotten_egg_or_sulfur",
      "burning_electrical_or_plastic",
      "burning_rubber_or_hot_brakes",
      "musty_or_mildew",
      "exhaust_inside_cabin",
      "other_burning",
    ])
    .nullable(),
  noise_descriptor: z
    .enum([
      "squealing_high_pitched",
      "grinding_metallic",
      "knocking_deep",
      "ticking_or_tapping",
      "clunking",
      "rattling",
      "hissing",
      "humming_or_whirring",
      "whining",
      "popping_or_clicking",
      "buzzing",
      "creaking_or_squeaking",
      "roaring",
      "scraping",
    ])
    .nullable(),
  smoke_color: z
    .enum([
      "white",
      "blue_or_gray",
      "black",
      "steam_thin_wispy",
      "visible_but_color_unclear",
    ])
    .nullable(),
  fluid_color: z
    .enum([
      "brown_or_black",
      "green_or_orange_or_yellow_or_pink",
      "red_or_pink",
      "clear_yellow_or_light_brown",
      "clear_no_color",
      "blue_or_light_blue",
      "thick_dark_brown",
    ])
    .nullable(),
  fluid_under_car_location: z
    .enum([
      "under_engine_front",
      "under_middle",
      "under_rear",
      "under_a_wheel",
      "under_passenger_side",
      "under_driver_side",
      "unsure",
    ])
    .nullable(),
  warning_light_named: z.string().nullable(),
  warning_light_behavior: z
    .enum([
      "steady_on",
      "flashing_or_blinking",
      "comes_and_goes",
      "came_on_then_off",
      "multiple_lights_at_once",
    ])
    .nullable(),
  engine_running: z
    .enum([
      "normal",
      "rough_idle",
      "misfiring",
      "surging",
      "stalls",
      "wont_start",
      "slow_crank",
      "wont_crank_just_clicks",
      "died_while_driving",
      "no_sound_at_all",
    ])
    .nullable(),
  recent_action: z
    .enum([
      "brake_work",
      "tire_rotation_or_replacement",
      "tire_air_added",
      "oil_change",
      "battery_or_alternator_work",
      "alignment",
      "general_service",
      "jump_started",
      "ac_recharge_or_service",
      "accident_or_impact",
      "hit_pothole_or_curb",
      "car_wash_or_driven_through_water",
      "car_sat_unused",
      "fuel_fill_up",
      "none_mentioned",
    ])
    .nullable(),
  parking_brake_state: z
    .enum(["released", "engaged_or_partially_engaged", "customer_unsure"])
    .nullable(),
  tire_state: z
    .enum([
      "low_pressure",
      "flat",
      "visible_damage",
      "sidewall_cracking",
      "uneven_wear",
      "normal_or_unknown",
    ])
    .nullable(),
  steering_feel: z
    .enum([
      "normal",
      "heavy_or_hard_to_turn",
      "loose_or_sloppy",
      "wheel_off_center_while_straight",
      "stiff_one_direction_only",
    ])
    .nullable(),
  pull_direction: z
    .enum(["left", "right", "varies_or_wanders", "no_pull"])
    .nullable(),
  lights_state: z
    .enum([
      "dim_or_flickering",
      "dim_at_idle_brighten_when_revving",
      "normal",
      "completely_dead",
    ])
    .nullable(),
  accessory_affected: z.string().nullable(),
  weather_condition: z
    .enum([
      "cold_weather",
      "hot_weather",
      "rainy_or_wet",
      "humid",
      "after_snow_or_ice",
      "any_weather",
    ])
    .nullable(),
  sound_or_smoke_location_zone: z
    .enum([
      "under_hood",
      "under_car",
      "from_a_wheel",
      "behind_dashboard",
      "from_vents",
      "from_tailpipe",
      "passenger_footwell",
      "inside_cabin_general",
      "unsure",
    ])
    .nullable(),
  vehicle_powertrain: z
    .enum([
      "gasoline",
      "diesel",
      "hybrid",
      "electric",
      "turbocharged",
      "not_stated",
    ])
    .nullable(),
  drivable_state: z
    .enum([
      "drivable_normally",
      "drivable_but_concerned",
      "not_drivable_needs_tow",
      "stranded_now",
    ])
    .nullable(),
  customer_request_type: z
    .enum([
      "diagnose_problem",
      "fix_a_known_problem",
      "replace_specific_part",
      "routine_maintenance",
      "pre_trip_inspection",
      "second_opinion",
      "just_get_new_tires",
    ])
    .nullable(),
});

export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

export const EXTRACTED_FACTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "location_side",
    "location_axle",
    "speed_band",
    "speed_specific_mph",
    "onset_timing",
    "started_when",
    "hvac_mode",
    "airflow_state",
    "pedal_feel",
    "smell_descriptor",
    "noise_descriptor",
    "smoke_color",
    "fluid_color",
    "fluid_under_car_location",
    "warning_light_named",
    "warning_light_behavior",
    "engine_running",
    "recent_action",
    "parking_brake_state",
    "tire_state",
    "steering_feel",
    "pull_direction",
    "lights_state",
    "accessory_affected",
    "weather_condition",
    "sound_or_smoke_location_zone",
    "vehicle_powertrain",
    "drivable_state",
    "customer_request_type",
  ],
  properties: {
    location_side: {
      enum: ["left", "right", "both", "varies", "unsure", null],
      description:
        "Which side of the vehicle the symptom is on. Customer phrasings: 'driver side' → left; 'passenger side' → right; 'both sides' → both; 'sometimes one side then the other' → varies; 'not sure which side' → unsure. DO NOT confuse with steering pull direction (use pull_direction). DO NOT infer from 'driver complains' — that's the human, not the car side.",
    },
    location_axle: {
      enum: ["front", "rear", "all", "unsure", null],
      description:
        "Front or rear of the vehicle. Customer phrasings: 'front wheels', 'up front', 'engine area' → front; 'rear wheels', 'back of the car' → rear; 'all four corners' → all. DO NOT confuse with under-the-hood location (use sound_or_smoke_location_zone).",
    },
    speed_band: {
      enum: [
        "stopped",
        "idle",
        "low_speed",
        "mid_speed",
        "highway",
        "specific_mph",
        "all_speeds",
        null,
      ],
      description:
        "Speed range when the symptom occurs. stopped = parked or at a red light; idle = engine running but not moving; low_speed = parking lots, under ~25 mph; mid_speed = city driving 25-50; highway = 50+; specific_mph = customer named an exact number (set speed_specific_mph too); all_speeds = customer said 'at any speed' or 'all the time when driving'. Customer phrasings: 'at 65', 'around 50', 'on the highway', 'in parking lots', 'when I'm stopped at a light'.",
    },
    speed_specific_mph: {
      type: ["integer", "null"],
      description:
        "Exact mph the customer named (e.g., 'shakes at 65 mph' → 65). Only set if customer explicitly stated a number. Range expressions like 'between 50 and 60' → use the lower bound (50). DO NOT estimate or infer from 'highway speed' alone.",
    },
    onset_timing: {
      enum: [
        "cold_start",
        "after_warming_up",
        "at_startup",
        "at_first_turn_on",
        "during_driving",
        "at_stop",
        "over_bumps",
        "when_braking",
        "when_accelerating",
        "when_turning",
        "when_idling",
        "always",
        "intermittent",
        null,
      ],
      description:
        "WHEN the symptom occurs relative to vehicle operation. cold_start = only first thing in the morning / after sitting overnight; after_warming_up = only once the engine is warm; at_startup = the moment the key is turned (any temp); at_first_turn_on = first seconds after AC/heater turned on (HVAC-specific); during_driving = while in motion (no other specific trigger); at_stop = while stopped / coming to a stop; over_bumps = triggered by bumps / potholes / rough road; when_braking = only while pressing the brake pedal; when_accelerating = only when pressing the gas; when_turning = only when turning the steering wheel; when_idling = while idling at a stop (engine-specific); always = continuous; intermittent = random, no pattern.",
    },
    started_when: {
      enum: [
        "just_now",
        "today",
        "days_ago",
        "weeks_ago",
        "months_ago",
        "a_year_plus",
        "since_purchase",
        "sudden_onset",
        "gradually",
        null,
      ],
      description:
        "How long the customer has been experiencing the symptom OR how it began. Customer phrasings: 'started today' → today; 'a few days' → days_ago; 'a couple weeks' → weeks_ago; 'has been doing this for months' → months_ago; 'over a year' → a_year_plus; 'always done this since I bought it' → since_purchase; 'suddenly started' → sudden_onset; 'got worse little by little' → gradually.",
    },
    hvac_mode: {
      enum: ["ac", "heat", "defrost", "fan_only", "both_ac_and_heat", "none", null],
      description:
        "Which HVAC mode the symptom occurs in. ac = only air conditioning; heat = only heater; defrost = only defrost; fan_only = fan running with no temperature mode active; both_ac_and_heat = symptom occurs with either heat or AC; none = HVAC is off when symptom occurs. Customer phrasings: 'when I run the AC', 'when the heater is on', 'on defrost', 'whether AC or heat'.",
    },
    airflow_state: {
      enum: [
        "strong_normal",
        "weak_overall",
        "only_on_highest_setting",
        "only_one_zone_blows",
        "no_airflow",
        "uneven_temperature_between_zones",
        null,
      ],
      description:
        "Description of vent airflow. strong_normal = airflow feels normal; weak_overall = weak on every fan speed; only_on_highest_setting = works only on max fan (resistor issue cue); only_one_zone_blows = e.g., only dash, not floor; no_airflow = fan doesn't blow at all; uneven_temperature_between_zones = driver side warm but passenger side cold, or similar. DO NOT use for vent-NOISE complaints (use noise_descriptor).",
    },
    pedal_feel: {
      enum: [
        "normal",
        "soft_spongy",
        "hard_unresponsive",
        "sinks_to_floor",
        "pulsating",
        "grabby",
        null,
      ],
      description:
        "How the brake pedal feels to the customer. Customer phrasings: 'spongy' / 'mushy' / 'goes too far' → soft_spongy; 'rock hard' / 'won't push down' / 'stiff' → hard_unresponsive; 'goes to the floor' / 'sinks to the carpet' → sinks_to_floor; 'shakes the pedal' / 'pulses' / 'shudders' → pulsating; 'grabs hard' / 'jumpy' → grabby.",
    },
    smell_descriptor: {
      enum: [
        "sweet_or_maple_syrup",
        "burnt_oil",
        "gasoline_or_fuel",
        "rotten_egg_or_sulfur",
        "burning_electrical_or_plastic",
        "burning_rubber_or_hot_brakes",
        "musty_or_mildew",
        "exhaust_inside_cabin",
        "other_burning",
        null,
      ],
      description:
        "Type of smell the customer described. sweet_or_maple_syrup = coolant; burnt_oil = oil burning; gasoline_or_fuel = raw fuel; rotten_egg_or_sulfur = exhaust/cat converter cue; burning_electrical_or_plastic = wire / circuit cue; burning_rubber_or_hot_brakes = brake / belt / dragging tire; musty_or_mildew = AC mold / 'dirty socks' / 'wet basement'; exhaust_inside_cabin = exhaust fumes the customer is breathing; other_burning = burning smell that doesn't fit the above. DO NOT use for visible smoke without smell (use smoke_color).",
    },
    noise_descriptor: {
      enum: [
        "squealing_high_pitched",
        "grinding_metallic",
        "knocking_deep",
        "ticking_or_tapping",
        "clunking",
        "rattling",
        "hissing",
        "humming_or_whirring",
        "whining",
        "popping_or_clicking",
        "buzzing",
        "creaking_or_squeaking",
        "roaring",
        "scraping",
        null,
      ],
      description:
        "Type of noise the customer described. squealing_high_pitched = brake squeal / belt squeal; grinding_metallic = metal-on-metal; knocking_deep = heavy engine knock; ticking_or_tapping = lighter, faster tap from valvetrain area; clunking = single hard thump (suspension cue); rattling = tinny / loose parts; hissing = vacuum / coolant escape; humming_or_whirring = bearing / tire cue; whining = power-steering / accessory belt / alternator; popping_or_clicking = CV joint cue when turning; buzzing = electrical buzz / relay; creaking_or_squeaking = suspension over bumps; roaring = exhaust leak / wheel bearing at speed; scraping = brake-pad-on-rotor / heat shield rub.",
    },
    smoke_color: {
      enum: [
        "white",
        "blue_or_gray",
        "black",
        "steam_thin_wispy",
        "visible_but_color_unclear",
        null,
      ],
      description:
        "Color of visible smoke or vapor. white = thick white (coolant cue); blue_or_gray = oil burning cue; black = unburned fuel / soot; steam_thin_wispy = thin white that disappears (often just condensation on cold mornings); visible_but_color_unclear = customer saw smoke but didn't say what color.",
    },
    fluid_color: {
      enum: [
        "brown_or_black",
        "green_or_orange_or_yellow_or_pink",
        "red_or_pink",
        "clear_yellow_or_light_brown",
        "clear_no_color",
        "blue_or_light_blue",
        "thick_dark_brown",
        null,
      ],
      description:
        "Color of fluid the customer saw under the vehicle. brown_or_black = engine oil; green_or_orange_or_yellow_or_pink = coolant/antifreeze (bright/neon); red_or_pink = transmission or power steering; clear_yellow_or_light_brown = brake fluid (SAFETY); clear_no_color = water / AC condensation; blue_or_light_blue = washer fluid; thick_dark_brown = gear / differential oil. DO NOT confuse with smoke_color.",
    },
    fluid_under_car_location: {
      enum: [
        "under_engine_front",
        "under_middle",
        "under_rear",
        "under_a_wheel",
        "under_passenger_side",
        "under_driver_side",
        "unsure",
        null,
      ],
      description:
        "Where under the vehicle the customer sees the puddle/drip. under_engine_front = front of the car, engine area; under_middle = mid-floor / transmission area; under_rear = back of the car; under_a_wheel = at one wheel (brake / hub cue); under_passenger_side / under_driver_side = lateral but not specified front or rear; unsure = customer saw fluid but didn't say where.",
    },
    warning_light_named: {
      type: ["string", "null"],
      description:
        "Verbatim name(s) of dashboard warning light(s) the customer named. Free text because there are too many vendor-specific labels to enumerate. Example values: 'check engine', 'TPMS', 'ABS', 'battery', 'oil pressure', 'temp', 'service engine soon', 'maintenance required', 'airbag', 'traction control', 'power steering', 'brake'. Lowercase, comma-separated if multiple. Leave null if customer did not name a specific dashboard light.",
    },
    warning_light_behavior: {
      enum: [
        "steady_on",
        "flashing_or_blinking",
        "comes_and_goes",
        "came_on_then_off",
        "multiple_lights_at_once",
        null,
      ],
      description:
        "How the warning light is behaving. steady_on = on continuously; flashing_or_blinking = blinking (more serious for check-engine); comes_and_goes = appears and disappears intermittently; came_on_then_off = appeared once and is now off; multiple_lights_at_once = customer reported several lights together. Set only if customer described the behavior, not just the light's existence.",
    },
    engine_running: {
      enum: [
        "normal",
        "rough_idle",
        "misfiring",
        "surging",
        "stalls",
        "wont_start",
        "slow_crank",
        "wont_crank_just_clicks",
        "died_while_driving",
        "no_sound_at_all",
        null,
      ],
      description:
        "How the engine is running / cranking. normal = runs fine; rough_idle = shakes / sputters at idle; misfiring = bucking / skipping / jerking under load; surging = RPMs go up and down on their own; stalls = dies after running; wont_start = cranks but doesn't fire; slow_crank = cranks slowly before catching; wont_crank_just_clicks = no crank, just clicking; died_while_driving = shut off mid-drive; no_sound_at_all = key turn produces no sound at all.",
    },
    recent_action: {
      enum: [
        "brake_work",
        "tire_rotation_or_replacement",
        "tire_air_added",
        "oil_change",
        "battery_or_alternator_work",
        "alignment",
        "general_service",
        "jump_started",
        "ac_recharge_or_service",
        "accident_or_impact",
        "hit_pothole_or_curb",
        "car_wash_or_driven_through_water",
        "car_sat_unused",
        "fuel_fill_up",
        "none_mentioned",
        null,
      ],
      description:
        "A recent action / event the customer mentioned that might be relevant. Customer phrasings: 'just had new brakes' → brake_work; 'recently got new tires' → tire_rotation_or_replacement; 'I added air last week' → tire_air_added; 'after my last oil change' → oil_change; 'new battery' → battery_or_alternator_work; 'after alignment' → alignment; 'had it serviced' → general_service; 'had to jump it' → jump_started; 'after AC recharge' → ac_recharge_or_service; 'hit a curb' / 'fender bender' → accident_or_impact / hit_pothole_or_curb; 'after going through a car wash' / 'drove through deep water' → car_wash_or_driven_through_water; 'sat for a while' → car_sat_unused; 'right after I filled up' → fuel_fill_up. Pick the SINGLE most-emphasized recent event.",
    },
    parking_brake_state: {
      enum: ["released", "engaged_or_partially_engaged", "customer_unsure", null],
      description:
        "Whether the parking / emergency brake is engaged. Relevant when the customer reports burning brake smell / dragging / one wheel hot. Customer phrasings: 'parking brake is off' → released; 'I might have left it on' → engaged_or_partially_engaged; 'not sure' → customer_unsure. Leave null if not mentioned.",
    },
    tire_state: {
      enum: [
        "low_pressure",
        "flat",
        "visible_damage",
        "sidewall_cracking",
        "uneven_wear",
        "normal_or_unknown",
        null,
      ],
      description:
        "State of a tire if the customer described one. low_pressure = customer said a tire is low; flat = completely flat; visible_damage = nail, screw, bulge, cut, gash visible; sidewall_cracking = dry rot / cracks in rubber; uneven_wear = bald spots / scalloped tread / one edge worn; normal_or_unknown = customer didn't describe a tire issue. Only set when the customer DIRECTLY described tire condition.",
    },
    steering_feel: {
      enum: [
        "normal",
        "heavy_or_hard_to_turn",
        "loose_or_sloppy",
        "wheel_off_center_while_straight",
        "stiff_one_direction_only",
        null,
      ],
      description:
        "How the steering feels to the customer. heavy_or_hard_to_turn = wheel resists / hard to park; loose_or_sloppy = play / wandery / disconnected feel; wheel_off_center_while_straight = steering wheel cocked when driving straight; stiff_one_direction_only = harder turning one way than the other.",
    },
    pull_direction: {
      enum: ["left", "right", "varies_or_wanders", "no_pull", null],
      description:
        "Direction the vehicle pulls or drifts. varies_or_wanders = wanders side-to-side / changes direction; no_pull = customer explicitly said it goes straight. Leave null if the customer did not mention pulling at all. DO NOT confuse with location_side.",
    },
    lights_state: {
      enum: [
        "dim_or_flickering",
        "dim_at_idle_brighten_when_revving",
        "normal",
        "completely_dead",
        null,
      ],
      description:
        "State of headlights / dashboard lights as reported by the customer. dim_or_flickering = visibly dim or flickering brightness; dim_at_idle_brighten_when_revving = brightness varies with engine RPM (alternator cue); completely_dead = no lights at all. Leave null if not mentioned.",
    },
    accessory_affected: {
      type: ["string", "null"],
      description:
        "Free-text name of a specific electrical accessory the customer said stopped working. Examples: 'driver window', 'radio', 'dome light', 'wipers', 'power locks', 'rear defroster', 'heated seat'. Lowercase, comma-separated if multiple. Leave null if the issue isn't accessory-specific.",
    },
    weather_condition: {
      enum: [
        "cold_weather",
        "hot_weather",
        "rainy_or_wet",
        "humid",
        "after_snow_or_ice",
        "any_weather",
        null,
      ],
      description:
        "Environmental condition the customer associated with the symptom. Customer phrasings: 'first cold morning' / 'when it's cold out' → cold_weather; 'on hot days' → hot_weather; 'in the rain' / 'after a car wash' → rainy_or_wet; 'humid days' → humid; 'after a snowstorm' → after_snow_or_ice; 'doesn't matter what weather' → any_weather.",
    },
    sound_or_smoke_location_zone: {
      enum: [
        "under_hood",
        "under_car",
        "from_a_wheel",
        "behind_dashboard",
        "from_vents",
        "from_tailpipe",
        "passenger_footwell",
        "inside_cabin_general",
        "unsure",
        null,
      ],
      description:
        "Where the customer perceives a noise OR smoke is coming from. Customer phrasings: 'from under the hood' → under_hood; 'under the car' / 'underneath' → under_car; 'from the front-right wheel' → from_a_wheel; 'behind the dash' → behind_dashboard; 'out of the vents' → from_vents; 'tailpipe' / 'exhaust' → from_tailpipe; 'passenger floor' → passenger_footwell; 'inside the cabin' → inside_cabin_general.",
    },
    vehicle_powertrain: {
      enum: [
        "gasoline",
        "diesel",
        "hybrid",
        "electric",
        "turbocharged",
        "not_stated",
        null,
      ],
      description:
        "Powertrain type if the customer stated it. Relevant for black-smoke questions (diesel vs gasoline) and start questions (hybrid/EV vs ICE). Only set if the customer explicitly stated it. DO NOT infer from year/make/model.",
    },
    drivable_state: {
      enum: [
        "drivable_normally",
        "drivable_but_concerned",
        "not_drivable_needs_tow",
        "stranded_now",
        null,
      ],
      description:
        "Whether the customer can drive the vehicle. drivable_normally = no concerns about driving it; drivable_but_concerned = driving it but doesn't feel safe; not_drivable_needs_tow = vehicle physically can't be driven (e.g., flat tire, won't start, severe damage); stranded_now = customer is currently stuck on the side of the road. Most descriptions don't mention this — leave null.",
    },
    customer_request_type: {
      enum: [
        "diagnose_problem",
        "fix_a_known_problem",
        "replace_specific_part",
        "routine_maintenance",
        "pre_trip_inspection",
        "second_opinion",
        "just_get_new_tires",
        null,
      ],
      description:
        "What the customer is asking the shop to do. diagnose_problem = they don't know the cause; fix_a_known_problem = they (or a prior shop) identified the issue; replace_specific_part = they named a part to swap (e.g., 'I want a new battery'); routine_maintenance = oil change / service interval; pre_trip_inspection = checking before a road trip; second_opinion = they want us to verify another shop's diagnosis; just_get_new_tires = explicit tire-replacement request. If the customer's description is purely symptom-only, leave null.",
    },
  },
} as const;

export const EXTRACTED_FACTS_ALL_KEYS = [
  "location_side",
  "location_axle",
  "speed_band",
  "speed_specific_mph",
  "onset_timing",
  "started_when",
  "hvac_mode",
  "airflow_state",
  "pedal_feel",
  "smell_descriptor",
  "noise_descriptor",
  "smoke_color",
  "fluid_color",
  "fluid_under_car_location",
  "warning_light_named",
  "warning_light_behavior",
  "engine_running",
  "recent_action",
  "parking_brake_state",
  "tire_state",
  "steering_feel",
  "pull_direction",
  "lights_state",
  "accessory_affected",
  "weather_condition",
  "sound_or_smoke_location_zone",
  "vehicle_powertrain",
  "drivable_state",
  "customer_request_type",
] as const;
