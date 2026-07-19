# Current scheduler classifier taxonomy — ground-truth snapshot

> **Captured:** 2026-07-18 from the LIVE test DB (`itzdasxobllfiuolmbxu`, shop 7476) + the
> scheduler-app source. This is the **binding target** for the automotive knowledge base: every
> system dossier must map its real-world knowledge back onto the slugs, services, fact slots, and
> questions defined here. Do NOT invent taxonomy — bind to what exists, and propose changes
> explicitly in `binding/`.
>
> The DB is the source of truth (the frozen `scheduler-app/scripts/catalog/*` TS files have
> diverged through months of admin edits). Re-snapshot with the queries at the bottom before a
> retraining pass.

---

## 1. The 3-stage classifier we are improving

Source: `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` (+ `load-diagnostic-catalog.ts`,
`extracted-facts.ts`, `question-fact-mapper.ts`).

A customer types free text ("what's wrong with your car?"). Then:

1. **Stage 1 — candidate categories.** Returns 0–3 RANKED category keys from the catalog (each key
   is a `testing_services.service_key` OR an `'other'` subcategory slug). Exactly ONE on a clear
   match; 2–3 when genuinely ambiguous (customer taps a clarify chip); EMPTY → advisor handoff.
   Signals it uses: each category's `description` + `concern_categories[]` tags + a per-category
   `keywords:` line (= `testing_services.example_keywords[]` ∪ that service's subcategories'
   `synonyms[]`, de-duped, capped 40). Governed by PRIORITY-ORDER situational-cue rules, a
   NON-CONCERN (work-order) rejection rule, and explicit **confusable-pair hedging** (§5).
2. **Stage 2 — subcategory pick.** Within the matched category, picks 1 subcategory using each
   subcategory's `description` + `positive_examples[]` + `negative_examples[]` + `synonyms[]`.
3. **Stage 3 — fact extraction.** Extracts the ~29 typed, nullable **fact slots** (§4) the customer
   *literally* stated (strict no-inference discipline). Then a **deterministic mapper** compares the
   extracted facts to each question's `required_facts[]` tag → answered / ambiguous / unanswered →
   the wizard only ASKS the unanswered ones.

**Key levers we can retrain (the 5 binding levers):**
- (L1) Stage-1 `example_keywords[]` per testing service.
- (L2) Subcategory `description`.
- (L3) Subcategory `positive_examples[]` + `negative_examples[]`.
- (L4) Subcategory `synonyms[]`.
- (L5) The 29 fact **slots** themselves + each question's `required_facts[]` tagging.

---

## 2. Quantified problems (the reason for this project)

| Problem | Evidence | Which lever |
|---|---|---|
| **Over-asking** — the wizard asks questions the customer already answered | **349 of 729 active questions (48%) have EMPTY `required_facts[]`** → the fact-mapper can never skip them | L5 |
| Routing confusions | Multiple "confusable pairs" hard-coded into Stage-1 rules + service descriptions (§5) | L1–L4 |
| Catalog coverage gaps | e.g. "just want new tires (worn/dry-rot)" = *no catalog fit*; transmission is ONE service under `performance`; driveline/CV/diff, fuel, EVAP/emissions, forced induction, hybrid/EV, ADAS, immobilizer/keys thin or absent | new subcats/services |
| Messy customer language | Real Tekmetric concern text is misspelled, mixes symptom + request, and ~24% of the concern channel is non-concern noise (work-order lines) | L1–L4 |

Note: Stage-2 **enrichment is fully populated** — every active subcategory already has a
description, positive & negative examples, and synonyms. The knowledge base should *improve* those
(sharper negatives on confusable pairs, more real-voice positives), not fill blanks.

---

## 3. The catalog — testing services + concern categories

### 3a. Active testing services (~24) — the customer-facing "what we'll do + fee" + Stage-1 keys

Each is a Stage-1 candidate key (`service_key`). `concern_categories[]` = which subcategory pools it
can reach. Scope/routing notes are paraphrased from the live `description` (which already encodes
several confusable-pair boundaries).

| service_key | display / fee | concern_categories | scope & routing notes |
|---|---|---|---|
| `brake_inspection` | Brake inspection ($39.99) | brakes, noise | pads/rotors/calipers/lines/fluid. Brake-only vibration lives here (NOT suspension). |
| `brake_inspection_warning_light` | Brake inspection w/ warning light ($89.95) | brakes, noise, warning_light | mechanical brake symptom **+** a red BRAKE/ABS dash light. kw: "Red brake light on". |
| `abs_traction_stability_testing` | ABS/traction/stability light ($179.95) | warning_light, brakes | scan ABS/traction/stability codes + sensors. |
| `airbag_srs_testing` | Airbag/SRS light ($179.95) | warning_light, electrical | SRS codes, yellow connectors, impact sensors, seatbelt buckles. |
| `charging_starting_testing` | Charging + starting ($89.95) | electrical, warning_light, performance | battery load, alternator output, starter draw, parasitic draw. |
| `battery_test` | Battery test (FREE) | electrical, warning_light | voltage / CCA / condition only. |
| `no_start_testing` | No-start testing ($179.95) | performance, electrical | cranks-but-won't-fire / fuel / spark / crank-cam signal. |
| `check_engine_light_testing` | Check Engine Light ($179.95) | warning_light, performance | scan CEL codes, live data, TSBs. Also owns **blue/gray tailpipe smoke** (oil burn). |
| `warning_light_general` | Warning light — general/unspecified ($179.95) | warning_light, performance | any dash light the customer can't name. |
| `coolant_leak_testing` | Coolant leak / overheating ($109.95) | leak, smoke, smell, performance, warning_light | coolant puddle, sweet smell, overheating, steam, **WHITE tailpipe smoke**, heater-blows-cold from low coolant. |
| `coolant_leak_testing_euro` | Coolant leak — Euro ($199.95) | leak, smoke, smell, performance, warning_light | Euro-vehicle variant of the above. |
| `oil_leak_testing` | Oil leak testing ($179.95) | leak, smell, smoke | valve covers/gaskets/seals/oil pan; burnt-oil smell from bay. NOT exhaust, NOT coolant. |
| `oil_pressure_light_testing` | Oil pressure light ($179.95) | warning_light, leak, performance | verify oil level, mechanical oil-pressure test. |
| `ac_performance_check` | A/C performance check ($54.95) | hvac | AC cooling + blower/mode + **heater complaints (no/weak/cold heat)** + musty-from-vents. kw list rich. |
| `ac_leak_testing` | A/C leak testing ($179.95) | hvac, leak | pressure/dye/electronic leak detection on the refrigerant circuit. |
| `exhaust_system_testing` | Exhaust evaluation ($39.99) | noise, smell, performance | manifold→tailpipe leaks, cat rattle, louder exhaust, exhaust fumes in cabin. NOT oil-burn smoke. |
| `transmission_testing` | Transmission issues ($179.95) | performance | shift/drivability, fluid, external controls, trans codes. **Only trans service.** |
| `suspension_steering_check` | Suspension + steering ($89.95) | noise, steering, pulling, vibration | shakes/pulls/drifts/clunks + uneven tire wear. NOT brake-only vibration, NOT tire puncture, NOT HVAC blower shake. |
| `power_steering_eps_testing` | Power steering / EPS ($179.95) | warning_light, steering, electrical | PS fluid/leak/noise + EPS codes/wiring. |
| `awd_4x4_testing` | AWD/4WD system ($179.95) | performance, electrical, warning_light | engagement, power distribution, related electronics/fluids. |
| `tire_repair` | Tire repair patch & plug ($47.68) | tires | **physical tire damage** — nail/screw/puncture/keeps-losing-air. NOT TPMS-light-only, NOT vibration/pull, NOT worn/dry-rot/new-tire requests (no fit → advisor quote). |
| `tpms_testing` | TPMS light testing ($39.99) | warning_light, tires | TPMS light + sensor scan/pressures. NOT physical tire damage. |
| `electrical_testing_general` | Electrical system — general ($179.95) | electrical | wiring/connectors/fuses/relays/voltage/ground/continuity. Catch-all for accessories that aren't windows. |
| `window_inop_testing` | Window inoperative ($179.95) | electrical, other | power-window **glass motion only**. NOT seats/sunroof/mirrors/locks (→ electrical_testing_general). |
| `windshield_inop_testing` | Windshield/wiper inoperative ($179.95) | electrical, other | wiper operation / arm / transmission linkage. |

**Deprecated / inactive** (classifiable-historically, not bookable): `check_ac` (split into
performance + leak), `alternator_testing` (→ charging_starting), `suspension_check` (→
suspension_steering_check).

### 3b. The 6 `'other'` situational buckets (Stage-1 keys; route to advisor, no test/fee)

`multiple_symptoms_not_sure_what_category`, `after_a_recent_accident_or_impact`,
`after_recent_service_or_repair_work`, `safety_concern_dont_feel_safe_driving_it`,
`general_check_up_or_pre_trip_inspection`, `car_has_been_sitting_unused_for_a_long_time`.

These fire on **situational cues** that OVERRIDE symptom keywords when causally tied to the symptom
(Stage-1 PRIORITY-ORDER rule).

---

## 4. Concern categories → subcategory slugs (Stage-2 target)

14 concern categories → 107 active subcategories (105 carry questions). These are the exact Stage-2
`slug` values. **Bind dossier findings to these slugs; propose new/renamed ones in `binding/`.**

- **brakes** (6): `high_pitched_squealing`, `metallic_grinding`, `spongy_or_soft_pedal`, `pedal_sinks_to_floor`, `pulsating_or_vibrating_pedal`, `hard_or_unresponsive_pedal`
- **electrical** (7): `wont_crank_just_clicks`, `slow_crank_sluggish_start`, `battery_drains_overnight`, `dim_or_flickering_lights`, `accessory_doesnt_work`, `multiple_random_electrical_glitches`, `car_died_while_driving_electrical`
- **hvac** (8): `ac_blows_warm_or_hot_air`, `ac_is_weak_not_cold_enough`, `heat_doesnt_work`, `vents_dont_blow_strongly`, `foggy_or_hard_to_defog_windows`, `strange_noise_from_vents`, `bad_smell_from_vents`, `one_zone_works_but_another_doesnt`
- **leak** (7): `brown_or_black_puddle_engine_oil`, `green_orange_yellow_or_pink_puddle_coolant`, `red_or_pink_puddle_transmission_or_power_steering`, `clear_yellow_or_light_brown_puddle_brake_fluid`, `clear_odorless_puddle_water_or_ac_condensation`, `thick_dark_brown_puddle_gear_or_differential_oil`, `blue_or_light_blue_puddle_washer_fluid`
- **noise** (12): `engine_ticking_or_tapping`, `clunking_over_bumps`, `humming_or_whirring_at_speed`, `high_pitched_whining_under_the_hood`, `rattling_underneath_the_car`, `hissing_noise`, `popping_or_clicking_when_turning`, `deep_knocking_from_the_engine`, `squeaking_or_creaking_over_bumps`, `electrical_buzzing`, `exhaust_louder_or_rumbling`, `exhaust_manifold_tick_or_puff`
- **other** (6): the 6 situational buckets in §3b
- **performance** (9): `hesitation_or_lag_when_accelerating`, `rough_idle_or_shaking_at_a_stop`, `stalling_at_idle_or_when_stopping`, `stalling_while_driving_under_load`, `hard_to_start_when_cold`, `hard_to_start_when_hot`, `low_power_or_wont_accelerate_normally`, `surging_or_rpms_going_up_and_down`, `engine_misfire_or_bucking_feeling`
- **pulling** (6): `pulling_only_when_braking`, `steady_drift_while_cruising`, `pulling_only_during_acceleration`, `drift_that_follows_the_roads_slope`, `pull_that_started_after_recent_tire_or_service_work`, `wandering_or_drifting_in_both_directions`
- **smell** (8): `sweet_smell_maple_syrup_antifreeze`, `burnt_oil_smell`, `gasoline_fuel_smell`, `rotten_egg_sulfur_smell`, `burning_electrical_plastic_smell`, `burning_rubber_hot_brake_smell`, `musty_mildew_smell_from_vents`, `exhaust_fumes_inside_the_cabin`
- **smoke** (6): `white_smoke_from_tailpipe`, `blue_or_gray_smoke_from_tailpipe`, `black_smoke_from_tailpipe`, `smoke_from_under_the_hood`, `smoke_or_burning_smell_from_a_wheel`, `smoke_or_strong_smell_inside_the_cabin`
- **steering** (7): `hard_to_turn_heavy_steering`, `loose_or_sloppy_steering`, `steering_wheel_off_center_when_driving_straight`, `noise_when_turning_the_steering_wheel`, `steering_wheel_shakes_at_highway_speed`, `pulling_drifting_or_wandering_on_the_road`, `clunking_knocking_or_rough_ride_over_bumps`
- **tires** (7): `visible_damage_nail_screw_bulge_cut`, `tire_going_flat_losing_air`, `low_pressure_warning_light_only`, `uneven_tire_wear_bald_spots`, `dry_rot_sidewall_cracking`, `just_want_new_tires`, `recent_tire_work_then_new_symptom`
- **vibration** (6): `steering_wheel_shake_at_highway_speed`, `vibration_or_pulsing_when_braking`, `shaking_at_idle_while_stopped`, `shaking_when_speeding_up_or_going_uphill`, `shaking_or_bouncing_over_bumps_and_rough_roads`, `constant_vibration_that_doesnt_change_with_speed`
- **warning_light** (12): `check_engine_light`, `service_engine_soon_or_maintenance_required_light`, `battery_charging_light`, `oil_pressure_light`, `engine_temperature_light`, `tpms_tire_pressure_light`, `abs_anti_lock_brake_light`, `brake_system_red_light`, `airbag_srs_light`, `traction_control_stability_light`, `power_steering_eps_light`, `multiple_warning_lights_at_once`

> Note the taxonomy is **symptom-organized, not system-organized** — the same physical system (e.g.
> brakes) is scattered across `brakes`, `noise`, `vibration`, `pulling`, `warning_light`, `smell`,
> `leak`. A big value of the knowledge base is the **system→symptom crosswalk** (§ binding) so a
> customer utterance about any system routes to the right symptom subcategory.

---

## 5. Known confusable pairs (hard-coded in Stage-1 rules + service descriptions)

The disambiguation matrix in `datasets/` must cover at least these, plus any new ones the dossiers find:

1. `brake_inspection` ↔ `brake_inspection_warning_light` — mechanical brake symptom vs a dash BRAKE/ABS light.
2. `no_start_testing` ↔ `charging_starting_testing` — "won't crank / just clicks / dead" vs "slow crank / hard to start / battery keeps dying / had it jumped".
3. `coolant_leak_testing` ↔ `ac_performance_check` for HEAT — "no/weak heat" is HVAC (ac_performance_check); only route coolant if a coolant symptom is also present.
4. `coolant_leak_testing` (WHITE smoke) ↔ `check_engine_light_testing` (BLUE/GRAY smoke = oil burn).
5. `exhaust_system_testing` ↔ `oil_leak_testing` — exhaust manifold/leak/louder-exhaust vs oil drip/burnt-oil.
6. `tire_repair` ↔ `tpms_testing` ↔ `suspension_steering_check` — physical puncture vs TPMS-light-only vs vibration/pull.
7. `window_inop_testing` ↔ `electrical_testing_general` — power-window glass vs any other power accessory.
8. brake-only vibration (`brake_inspection`) ↔ suspension vibration (`suspension_steering_check`).
9. `just_want_new_tires` / `dry_rot_sidewall_cracking` — worn/old tires have NO catalog fit → advisor quote.

---

## 6. The 29 fact slots (Stage-3 extraction ontology)

`location_side`, `location_axle`, `speed_band`, `speed_specific_mph`, `onset_timing`,
`started_when`, `hvac_mode`, `airflow_state`, `pedal_feel`, `smell_descriptor`, `noise_descriptor`,
`smoke_color`, `fluid_color`, `fluid_under_car_location`, `warning_light_named`,
`warning_light_behavior`, `engine_running`, `recent_action`, `parking_brake_state`, `tire_state`,
`steering_feel`, `pull_direction`, `lights_state`, `accessory_affected`, `weather_condition`,
`sound_or_smoke_location_zone`, `vehicle_powertrain`, `drivable_state`, `customer_request_type`.

Full enum values + extraction discipline: `scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts`
(mirror also inlined in `supabase/functions/llm-testing/index.ts` — keep in sync). Dossiers should
flag any symptom whose discriminating question is NOT expressible in these 29 slots → candidate NEW slot.

---

## 7. Re-snapshot queries

```sql
-- testing services
select service_key, display_name, description, concern_categories, example_keywords,
       starting_price_cents, active from testing_services order by display_name;
-- subcategory slugs by category
select category, string_agg(slug, ', ' order by display_order) as slugs
  from concern_subcategories where active group by category order by category;
-- required_facts coverage
select count(*) total, count(*) filter (where coalesce(array_length(required_facts,1),0)=0) empty_rf
  from concern_questions where active;
-- one subcategory's full enrichment + questions
select s.slug, s.description, s.positive_examples, s.negative_examples, s.synonyms,
       json_agg(json_build_object('q', q.question_text, 'rf', q.required_facts) order by q.display_order)
  from concern_subcategories s join concern_questions q on q.subcategory_id = s.id
 where s.slug = :slug and s.active and q.active group by s.slug, s.description,
       s.positive_examples, s.negative_examples, s.synonyms;
```
