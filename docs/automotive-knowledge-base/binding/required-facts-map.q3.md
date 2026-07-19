# Workstream Q — required_facts triage (Q3 batch)

> **Categories:** `smoke`, `steering`, `tires`, `vibration`, `warning_light`, `other`
> **Scope:** the 134 ACTIVE questions in these six categories whose `required_facts[]` is EMPTY (live test
> DB `itzdasxobllfiuolmbxu`, shop 7476, pulled 2026-07-18).
> **Method:** each question classed SAFE / PARTIAL / NEVER against the 29 Stage-3 fact slots
> (`scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts`), under the literalness discipline —
> a fact answers a question ONLY if the customer would have LITERALLY and COMPLETELY stated it. Wrongful
> skip > over-ask.

## Headline finding

**0 SAFE · 16 PARTIAL · 118 NEVER.** These six categories' empty questions are almost entirely the
*deep-diagnostic tail*: coolant/oil-level checks, dipstick/reservoir inspections, maintenance-history,
fuel-mileage trends, co-occurring-light checks, "where exactly do you feel it" locus questions, and
safety confirmations. This tail is **legitimately un-skippable** — the customer's opening free-text
("white smoke from my exhaust", "steering wheel shakes at 65", "nail in my tire") does not contain the
answer, and the easy pre-fillable questions (which side / when / what color) in these same subcategories
**already carry `required_facts` tags** and so are not in this empty set. The "48% empty" figure is, for
these categories, **mostly justified, not low-hanging over-asking**. The one recurring taggable pattern —
vibration felt-location — is a **wrongful-skip trap** (multi-location; a single stated location does not
rule out the others) and is therefore held at PARTIAL, not tagged SAFE. See "Proposed new slots".

---

## Triage table

Legend — class: **NEVER** = `question.intentionally_empty`; **PARTIAL** = facts narrow but partial-skip
unsafe → left empty with reason; **SAFE** = `question.required_facts.set` (none in this batch).

| question_id | category | slug | question (abbrev) | class | required_facts | derivation_note / reason |
|---|---|---|---|---|---|---|
| 282 | smoke | white_smoke_from_tailpipe | keeps happening after 10-15 min driving? | PARTIAL | — | Persistence distinguishes condensation from head-gasket coolant burn. `smoke_color=steam_thin_wispy` hints transient but doesn't confirm persistence-when-warm; no slot holds "persists after warmup". Ask. |
| 284 | smoke | white_smoke_from_tailpipe | had to add coolant / level dropping? | NEVER | — | Coolant-top-off history; `recent_action` has no coolant value and this is chronic, not a stated event. |
| 285 | smoke | white_smoke_from_tailpipe | running hotter / temp gauge crept up? | NEVER | — | Gauge-trend observation, not a named dash light; no slot. |
| 287 | smoke | white_smoke_from_tailpipe | milky film on oil filler cap? | NEVER | — | Inspection prompt; never in opening text. |
| 290 | smoke | blue_or_gray_smoke_from_tailpipe | appears when coasting / foot off gas? | NEVER | — | Deceleration-smoke cue (valve seals); `onset_timing` has no "when_decelerating" value. |
| 291 | smoke | blue_or_gray_smoke_from_tailpipe | adding oil between changes, how often? | NEVER | — | Oil-consumption history; no slot. |
| 294 | smoke | blue_or_gray_smoke_from_tailpipe | oily film around tailpipe tip? | NEVER | — | Inspection prompt. |
| 297 | smoke | black_smoke_from_tailpipe | fuel mileage dropping? | NEVER | — | Economy-trend history; no slot. |
| 299 | smoke | black_smoke_from_tailpipe | when was air filter last changed? | NEVER | — | Maintenance history; no slot. |
| 303 | smoke | smoke_from_under_the_hood | temp gauge red / hot-engine warning before smoke? | NEVER | — | Compound gauge+light sequence; safety-diagnostic, always ask. |
| 305 | smoke | smoke_from_under_the_hood | smoke from one spot or all around engine? | NEVER | — | Under-hood localization; no slot (`sound_or_smoke_location_zone` is coarse — under_hood only). |
| 308 | smoke | smoke_from_under_the_hood | popping/hissing/boiling sounds with smoke? | NEVER | — | Compound noise+smoke diagnostic; `noise_descriptor` alone can't answer. |
| 311 | smoke | smoke_or_burning_smell_from_a_wheel | one wheel much hotter than others? | NEVER | — | Hands-on inspection prompt. |
| 315 | smoke | smoke_or_burning_smell_from_a_wheel | just came off long downhill / stop-and-go? | NEVER | — | Situational precursor; no slot. |
| 318 | smoke | smoke_or_strong_smell_inside_the_cabin | first heat use of the season? | NEVER | — | Seasonal-first-use cue (dust burn-off); no slot combines hvac_mode+seasonal-first. |
| 319 | smoke | smoke_or_strong_smell_inside_the_cabin | any warning lights / electrical acting up? | NEVER | — | Compound electrical safety screen; always ask. |
| 321 | smoke | smoke_or_strong_smell_inside_the_cabin | smell stronger when fan speed up? | NEVER | — | HVAC-source confirmation; no slot. |
| 665 | steering | hard_to_turn_heavy_steering | power steering quit recently, or always this stiff? | PARTIAL | — | `started_when=since_purchase`→"always" is fairly safe, but "quit recently" needs a prior-good-state the slot can't assert (gradually vs sudden). Ask. |
| 666 | steering | hard_to_turn_heavy_steering | battery dying / warning lights on? | NEVER | — | Compound electrical screen (EPS-vs-charging cross-check); always ask. |
| 667 | steering | loose_or_sloppy_steering | can you wiggle wheel before car turns? | NEVER | — | Free-play confirmation; `steering_feel=loose_or_sloppy` routes here but doesn't literally confirm on-center play. |
| 668 | steering | loose_or_sloppy_steering | constantly correcting to stay straight? | NEVER | — | Symptom-refinement of looseness; not literally stated. |
| 669 | steering | loose_or_sloppy_steering | floaty / disconnected / not tracking? | NEVER | — | Symptom-refinement; not literally stated. |
| 671 | steering | loose_or_sloppy_steering | tires wearing inside/outside edges? | NEVER | — | Inspection prompt. |
| 673 | steering | loose_or_sloppy_steering | mileage / when front-end last looked at? | NEVER | — | Mileage + service history; no slot. |
| 679 | steering | steering_wheel_off_center_when_driving_straight | all four tires same brand/model/age? | NEVER | — | Tire-set inventory; no slot. |
| 680 | steering | steering_wheel_off_center_when_driving_straight | when were pressures last checked? | NEVER | — | Maintenance history; no slot. |
| 683 | steering | noise_when_turning_the_steering_wheel | louder at full lock held? | NEVER | — | Diagnostic maneuver (PS pump vs CV); no slot. |
| 684 | steering | noise_when_turning_the_steering_wheel | happens turning wheel while parked? | NEVER | — | Stationary-vs-rolling split; `speed_band=stopped`+`when_turning` not literally stated for a noise. |
| 686 | steering | noise_when_turning_the_steering_wheel | checked PS fluid level? | NEVER | — | Inspection prompt. |
| 690 | steering | steering_wheel_shakes_at_highway_speed | let go of wheel — shake continue or quiet? | NEVER | — | Diagnostic maneuver; no slot. |
| 691 | steering | steering_wheel_shakes_at_highway_speed | whole car shaking or just the wheel? | PARTIAL | — | Vibration-locus (see new-slots). Multi-location: "steering wheel shakes" doesn't rule out whole-car. Wrongful-skip → ask. |
| 697 | steering | pulling_drifting_or_wandering_on_the_road | pulls on flat roads too, or mostly sloped? | PARTIAL | — | Road-crown vs true pull. `pull_direction` gives direction, not crown-dependence; no slot for road-slope. Ask. |
| 702 | steering | clunking_knocking_or_rough_ride_over_bumps | every bump or only bigger ones? | NEVER | — | Severity-threshold refinement; no slot. |
| 703 | steering | clunking_knocking_or_rough_ride_over_bumps | front keeps bouncing after a bump? | NEVER | — | Shock bounce-test; no slot. |
| 704 | steering | clunking_knocking_or_rough_ride_over_bumps | front dips braking / rear squats accelerating? | NEVER | — | Weight-transfer diagnostic; no slot. |
| 705 | steering | clunking_knocking_or_rough_ride_over_bumps | leans/sways in corners or lane changes? | NEVER | — | Body-roll diagnostic; no slot. |
| 707 | steering | clunking_knocking_or_rough_ride_over_bumps | oily streaks on struts behind front wheels? | NEVER | — | Inspection prompt. |
| 708 | steering | clunking_knocking_or_rough_ride_over_bumps | mileage / shocks ever replaced? | NEVER | — | Mileage + service history; no slot. |
| 711 | tires | visible_damage_nail_screw_bulge_cut | damage on tread or sidewall? | NEVER | — | Repairability split (sidewall = not repairable). `tire_state=visible_damage` doesn't localize; no tire-zone slot (only 1 Q — extend not warranted). |
| 714 | tires | visible_damage_nail_screw_bulge_cut | spare on vehicle, or damaged tire mounted? | NEVER | — | Logistics; no slot. |
| 718 | tires | tire_going_flat_losing_air | how often adding air — day/week/month? | NEVER | — | Leak-rate history; no slot. |
| 719 | tires | tire_going_flat_losing_air | heard hissing, or just noticed low? | NEVER | — | Leak-onset detail; `noise_descriptor=hissing` rarely literal for a tire, compound. |
| 730 | tires | uneven_tire_wear_bald_spots | wear inside/outside/center/patchy? | NEVER | — | Wear-pattern localization (alignment vs pressure vs balance); no slot. |
| 732 | tires | uneven_tire_wear_bald_spots | bumpy/scalloped to the touch? | NEVER | — | Hands-on inspection prompt. |
| 734 | tires | uneven_tire_wear_bald_spots | any vibration in steering wheel or seat? | PARTIAL | — | Vibration-locus (see new-slots). Multi-location wrongful-skip → ask. |
| 736 | tires | uneven_tire_wear_bald_spots | miles on this set of tires? | NEVER | — | Mileage history; no slot. |
| 738 | tires | dry_rot_sidewall_cracking | cracks surface-only or deep (fingernail)? | NEVER | — | Severity inspection; no slot. |
| 739 | tires | dry_rot_sidewall_cracking | how old are the tires? | NEVER | — | Age history; no slot. |
| 740 | tires | dry_rot_sidewall_cracking | sits parked for long stretches? | NEVER | — | Chronic-parking; `recent_action=car_sat_unused` is a stated event, not this chronic pattern. |
| 741 | tires | dry_rot_sidewall_cracking | one tire or all of them? | NEVER | — | Set-scope; no slot (`location_side`/`_axle` don't cover "all tires cracking"). |
| 743 | tires | dry_rot_sidewall_cracking | parked in sun or garaged? | NEVER | — | Storage-environment; no slot. |
| 745 | tires | just_want_new_tires | know current brand/model, or want a rec? | NEVER | — | Sales-intake; advisor-routed bucket, no test. |
| 746 | tires | just_want_new_tires | low-cost, mid, or premium tier? | NEVER | — | Sales-intake preference; no slot. |
| 750 | tires | just_want_new_tires | keeping vehicle several years or 1-2? | NEVER | — | Sales-intake horizon; no slot. |
| 752 | tires | recent_tire_work_then_new_symptom | when was the work — days/week/longer? | PARTIAL | — | `started_when` (days_ago/weeks_ago) tracks SYMPTOM onset, not the work date; near-equal here but not identical. Ask. |
| 753 | tires | recent_tire_work_then_new_symptom | new symptom — vibration/noise/pull/light/leak? | NEVER | — | Core router question across 5 symptom families; too broad for any single slot. |
| 755 | tires | recent_tire_work_then_new_symptom | vibration felt in steering wheel or seat? | PARTIAL | — | Vibration-locus (see new-slots). Multi-location wrongful-skip → ask. |
| 756 | tires | recent_tire_work_then_new_symptom | same shop look again, or first check? | NEVER | — | Logistics; no slot. |
| 757 | tires | recent_tire_work_then_new_symptom | TPMS sensor disturbed / light keeps returning? | NEVER | — | Post-service TPMS diagnostic; no slot. |
| 142 | vibration | steering_wheel_shake_at_highway_speed | better/goes away if you speed up past it? | NEVER | — | Speed-window diagnostic (balance); no slot. |
| 143 | vibration | steering_wheel_shake_at_highway_speed | let off gas & coast — shake stay same? | NEVER | — | Load-vs-speed diagnostic; no slot. |
| 144 | vibration | steering_wheel_shake_at_highway_speed | mostly steering wheel, or also seat? | PARTIAL | — | Vibration-locus (see new-slots). Multi-location wrongful-skip → ask. |
| 151 | vibration | vibration_or_pulsing_when_braking | shake in wheel, seat, brake pedal, or all? | PARTIAL | — | Vibration-locus. `pedal_feel=pulsating` covers the pedal option only; other locations unstated → ask. |
| 152 | vibration | vibration_or_pulsing_when_braking | worse after long downhill / towing? | NEVER | — | Thermal-warp precursor; no slot. |
| 156 | vibration | shaking_at_idle_while_stopped | smooths out in Park/Neutral? | NEVER | — | Mount-vs-internal diagnostic; no slot. |
| 157 | vibration | shaking_at_idle_while_stopped | worse when AC on? | NEVER | — | Load-at-idle diagnostic; no slot. |
| 161 | vibration | shaking_at_idle_while_stopped | drop in gas mileage recently? | NEVER | — | Economy-trend; no slot. |
| 163 | vibration | shaking_when_speeding_up_or_going_uphill | worse under heavy load / passing / hill? | NEVER | — | Load confirmation; no slot. |
| 164 | vibration | shaking_when_speeding_up_or_going_uphill | clicking/popping when turning tight? | NEVER | — | CV-joint cross-check; compound. |
| 165 | vibration | shaking_when_speeding_up_or_going_uphill | grease/oil splatter inside wheels? | NEVER | — | Inspection prompt. |
| 167 | vibration | shaking_when_speeding_up_or_going_uphill | more in floor/seat than steering wheel? | PARTIAL | — | Vibration-locus. Multi-location wrongful-skip → ask. |
| 168 | vibration | shaking_when_speeding_up_or_going_uphill | transmission slipping/shifting strange too? | NEVER | — | Compound driveline screen; no slot. |
| 169 | vibration | shaking_or_bouncing_over_bumps_and_rough_roads | keeps bouncing after a bump? | NEVER | — | Shock bounce-test; no slot. |
| 170 | vibration | shaking_or_bouncing_over_bumps_and_rough_roads | clunk/knock when hitting bumps? | NEVER | — | `noise_descriptor=clunking` compound with the bump-ride complaint; add-on diagnostic. |
| 172 | vibration | shaking_or_bouncing_over_bumps_and_rough_roads | ride rougher than it used to be? | NEVER | — | Baseline-change judgment; no slot. |
| 173 | vibration | shaking_or_bouncing_over_bumps_and_rough_roads | oily fluid near shocks? | NEVER | — | Inspection prompt. |
| 174 | vibration | shaking_or_bouncing_over_bumps_and_rough_roads | front dives more than usual when braking? | NEVER | — | Shock diagnostic; no slot. |
| 1478 | vibration | constant_vibration_that_doesnt_change_with_speed | more in floor, seat, or all over? | PARTIAL | — | Vibration-locus. Multi-location wrongful-skip → ask. |
| 1480 | vibration | constant_vibration_that_doesnt_change_with_speed | changes when you turn the wheel? | NEVER | — | Steer-load diagnostic; no slot. |
| 1482 | vibration | constant_vibration_that_doesnt_change_with_speed | feels like something loose/flopping underneath? | NEVER | — | Symptom-refinement; not literally stated. |
| 2220 | warning_light | service_engine_soon_or_maintenance_required_light | miles since last oil change/service? | NEVER | — | Maintenance-interval history; no slot. |
| 2222 | warning_light | service_engine_soon_or_maintenance_required_light | came on at round-number mileage? | NEVER | — | Maintenance-reminder cue; no slot. |
| 2223 | warning_light | service_engine_soon_or_maintenance_required_light | is check-engine ALSO on, or only this? | PARTIAL | — | Co-occurring-light. `warning_light_named` set to one light does NOT confirm the OTHER is absent → wrongful-skip. Ask. |
| 391 | warning_light | battery_charging_light | goes off when revving, or stays on? | NEVER | — | Alternator-output diagnostic maneuver; no slot. |
| 393 | warning_light | oil_pressure_light | dipstick level — low/empty/normal? | NEVER | — | Inspection prompt. |
| 397 | warning_light | oil_pressure_light | oil spots on driveway? | NEVER | — | Inspection prompt. |
| 399 | warning_light | engine_temperature_light | gauge high/red, or gauge normal but light on? | NEVER | — | Gauge-vs-light split (sensor vs real overheat); no slot. |
| 401 | warning_light | engine_temperature_light | coolant reservoir full/low/empty? | NEVER | — | Inspection prompt. |
| 403 | warning_light | engine_temperature_light | heater still blows hot, or cold now? | NEVER | — | Low-coolant cue; no slot maps heat-loss to a temp light. |
| 404 | warning_light | engine_temperature_light | came on after traffic / hill / towing? | NEVER | — | Load precursor; no slot. |
| 409 | warning_light | tpms_tire_pressure_light | pulling / rougher ride / slow to respond? | NEVER | — | Compound handling screen; no single slot. |
| 413 | warning_light | abs_anti_lock_brake_light | regular brakes still stopping normally? | NEVER | — | Safety confirmation; always ask. |
| 414 | warning_light | abs_anti_lock_brake_light | red BRAKE light on too, or just yellow ABS? | PARTIAL | — | Co-occurring-light; single `warning_light_named` can't confirm the other's absence → wrongful-skip. Ask. |
| 422 | warning_light | brake_system_red_light | brake-fluid reservoir near/below MIN? | NEVER | — | Inspection prompt (safety). |
| 423 | warning_light | brake_system_red_light | yellow ABS on at same time, or just red brake? | PARTIAL | — | Co-occurring-light; wrongful-skip as above. Ask. |
| 424 | warning_light | brake_system_red_light | still stops normally, or takes longer? | NEVER | — | Safety confirmation; always ask. |
| 429 | warning_light | airbag_srs_light | anything stuck in a seat-belt buckle? | NEVER | — | Inspection prompt. |
| 430 | warning_light | airbag_srs_light | recent car-seat install / occupancy change? | NEVER | — | Occupancy-sensor precursor; no slot. |
| 435 | warning_light | traction_control_stability_light | ABS on at same time, or just traction? | PARTIAL | — | Co-occurring-light; wrongful-skip as above. Ask. |
| 436 | warning_light | traction_control_stability_light | felt slippery / lost grip / wheels spinning? | NEVER | — | Symptom screen; no slot. |
| 439 | warning_light | traction_control_stability_light | accidentally pressed the TC-off button? | NEVER | — | User-action check; no slot. |
| 440 | warning_light | traction_control_stability_light | steering heavier / other lights joining? | NEVER | — | Compound screen; no single slot. |
| 442 | warning_light | power_steering_eps_light | steering heavy all the time, or only when light on? | PARTIAL | — | `steering_feel=heavy_or_hard_to_turn` confirms heaviness but not the light-correlated timing → ask. |
| 450 | warning_light | multiple_warning_lights_at_once | running rough / losing power / dim lights? | NEVER | — | Compound charging-vs-CEL screen; no single slot. |
| 758 | other | multiple_symptoms_not_sure_what_category | which problem first, or all at once? | NEVER | — | Multi-symptom sequencing; advisor-routed elicitation. |
| 759 | other | multiple_symptoms_not_sure_what_category | together every time, or each on its own? | NEVER | — | Correlation elicitation; no slot. |
| 760 | other | multiple_symptoms_not_sure_what_category | all started same time, or staggered? | NEVER | — | Onset-correlation elicitation; no slot. |
| 761 | other | multiple_symptoms_not_sure_what_category | pattern — rain/cold/turning/speeds? | NEVER | — | Multi-axis elicitation across weather/onset/speed; too broad for one slot, and this bucket exists to elicit. |
| 762 | other | multiple_symptoms_not_sure_what_category | one symptom worries you most? | NEVER | — | Prioritization intake; no slot. |
| 764 | other | multiple_symptoms_not_sure_what_category | any dash lights, even briefly? | NEVER | — | Screening prompt; `warning_light_*` may be null yet the answer matters — always ask. |
| 765 | other | after_a_recent_accident_or_impact | when did it happen, driven since? | NEVER | — | Recency + driven-since (safety); compound, always ask. |
| 767 | other | after_a_recent_accident_or_impact | airbags deploy / lights after impact? | NEVER | — | Safety screen; always ask. |
| 768 | other | after_a_recent_accident_or_impact | filing insurance, or self-pay? | NEVER | — | Billing intake; no slot. |
| 770 | other | after_a_recent_accident_or_impact | new fluid drips where you park? | NEVER | — | Inspection prompt. |
| 771 | other | after_a_recent_accident_or_impact | sitting level, or one corner lower? | NEVER | — | Damage inspection; no slot. |
| 772 | other | after_recent_service_or_repair_work | where was the work — our shop/dealer/other? | NEVER | — | Provenance intake; no slot. |
| 773 | other | after_recent_service_or_repair_work | how long ago, receipt handy? | NEVER | — | Recency + records intake; no slot. |
| 774 | other | after_recent_service_or_repair_work | original reason — same problem back or new? | NEVER | — | Comeback elicitation; no slot. |
| 775 | other | after_recent_service_or_repair_work | right after pickup, or days/weeks later? | NEVER | — | Onset-vs-service elicitation; no slot. |
| 776 | other | after_recent_service_or_repair_work | parts/labor still under warranty? | NEVER | — | Warranty intake; no slot. |
| 777 | other | after_recent_service_or_repair_work | driven much since the work? | NEVER | — | Usage intake; no slot. |
| 778 | other | after_recent_service_or_repair_work | other shop recommend anything undone? | NEVER | — | Prior-rec elicitation; no slot. |
| 1850 | other | safety_concern_dont_feel_safe_driving_it | smoke, steam, or burning smell? | NEVER | — | **SAFETY** confirmation — must always be asked regardless of prior text. |
| 1853 | other | safety_concern_dont_feel_safe_driving_it | flashing warning light right now? | NEVER | — | **SAFETY** confirmation — always ask. |
| 787 | other | general_check_up_or_pre_trip_inspection | when was the last maintenance? | NEVER | — | Maintenance history; no slot. |
| 788 | other | general_check_up_or_pre_trip_inspection | small things noticed but not worried about? | NEVER | — | Open elicitation; no slot. |
| 789 | other | general_check_up_or_pre_trip_inspection | how many miles on the car? | NEVER | — | Mileage; no slot. |
| 790 | other | general_check_up_or_pre_trip_inspection | service records / manufacturer schedule? | NEVER | — | Records intake; no slot. |
| 791 | other | general_check_up_or_pre_trip_inspection | areas to focus — brakes/tires/fluids? | NEVER | — | Scope preference intake; no slot. |
| 792 | other | general_check_up_or_pre_trip_inspection | date you need it ready by? | NEVER | — | Scheduling intake; no slot. |
| 793 | other | car_has_been_sitting_unused_for_a_long_time | how long has it been sitting? | NEVER | — | Sit-duration; `recent_action=car_sat_unused` flags the event but not duration; advisor-routed. |
| 794 | other | car_has_been_sitting_unused_for_a_long_time | garaged, covered, or outside? | NEVER | — | Storage-environment; no slot. |
| 795 | other | car_has_been_sitting_unused_for_a_long_time | fuel stabilizer / battery disconnect before parking? | NEVER | — | Prep-step intake; no slot. |
| 798 | other | car_has_been_sitting_unused_for_a_long_time | leaks/stains/puddles where parked? | NEVER | — | Inspection prompt. |

---

## Class tally

| category | total empty | SAFE | PARTIAL | NEVER |
|---|---|---|---|---|
| smoke | 17 | 0 | 1 | 16 |
| steering | 21 | 0 | 3 | 18 |
| tires | 21 | 0 | 3 | 18 |
| vibration | 21 | 0 | 4 | 17 |
| warning_light | 24 | 0 | 5 | 19 |
| other | 30 | 0 | 0 | 30 |
| **total** | **134** | **0** | **16** | **118** |

PARTIAL ids: smoke 282; steering 665, 691, 697; tires 734, 752, 755; vibration 144, 151, 167, 1478;
warning_light 2223, 414, 423, 435, 442.

---

## Proposed new slots

Under the program rule, a new slot must unlock **≥3 questions for a SAFE skip** (else extend an existing
slot's value list). This batch surfaces **one strong-evidence candidate that nonetheless does NOT clear
the bar for a skip-slot**, plus two that fail the count outright. All are recorded for Wave-B routing use.

### 1. `vibration_felt_location` — evidence-rich, but DEFERRED (do not use for skipping)

- **Proposed type/values:** enum `{ steering_wheel, seat, brake_pedal, floor, whole_car }` (multi-value).
- **Literal cues:** "steering wheel shakes / vibrates", "feel it in the seat", "seat vibrates", "brake
  pedal pulses / shudders" (overlaps `pedal_feel=pulsating`), "whole car shakes", "feel it through the
  floor".
- **Questions it touches (7):** 144, 151, 167, 1478 (vibration); 734, 755 (tires); 691 (steering,
  whole-car-vs-wheel phrasing).
- **Why DEFERRED, not tagged SAFE:** every one of these questions is **multi-location** ("wheel *or also*
  seat", "wheel/seat/pedal/*all three*"). A customer who literally says "steering wheel shakes" has NOT
  stated whether it is *also* in the seat — and the seat signal is precisely the diagnostic value
  (front-wheel imbalance vs driveline/rear). Skipping on a single stated location is a **wrongful skip**,
  which the methodology ranks worse than over-asking. So the slot cannot drive a hard skip here.
- **Recommendation:** hand this slot to **Wave B `router-nvh`** as a *routing / disambiguation* signal
  (NVH descriptor × felt-location → ranked systems), NOT to the question-fact-mapper as a skip key. If a
  future skip is wanted, it would require splitting each multi-select question into single-location
  confirmations — a catalog change (Chris-gated), out of scope here.

### 2. `smoke_persistence_when_warm` — REJECTED (1 question)

Only Q282 needs it. Below the ≥3 bar; do not add. Leave Q282 always-asked.

### 3. `tire_damage_zone` (tread vs sidewall) — REJECTED (1 question)

Only Q711. Repairability-critical but single-question; below the bar. Leave always-asked. (If a future
tire dossier finds tread/sidewall language is common in opening text, revisit as a `tire_state`
value-list extension rather than a new slot.)

### Co-occurring-warning-light observation (no slot proposed)

Five questions (2223, 414, 423, 435, plus the spirit of 450) ask "is light X *also* on?". `warning_light_named`
is comma-separated multi, but a customer naming ONE light does not assert the others are OFF — so it can
never SAFELY skip an "is Y also on" question. This is a structural limit, not a missing slot. Correct
handling stays NEVER/PARTIAL (always ask). Flag for **Wave B `router-warning-lights`** to own the
light-cluster semantics.

---

## Notes for Phase C consolidation

- **No `question.required_facts.set` ops emitted from this batch** — 0 SAFE. The corresponding
  `question.intentionally_empty` ops (118) and PARTIAL "leave empty with reason" (16) are the entire
  proposal payload; ids + reasons are the table above.
- **Key audit takeaway:** for smoke / steering / tires / vibration / warning_light / other, the empty
  `required_facts` set is dominated by the un-pre-fillable diagnostic tail. The "48% empty" lever is
  **much smaller than headline** in these categories — the reducible over-asking lives in the categories
  whose opening-text-answerable questions were left untagged (check those in the other Q batches), not
  here. The win here is documentation (`intentionally_empty` reasons) so the 48% stops mystifying, plus
  the `vibration_felt_location` routing signal for Wave B.
