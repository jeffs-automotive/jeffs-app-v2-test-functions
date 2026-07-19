# Workstream Q — required_facts triage (Q1: brakes, electrical, hvac, leak)

> Audit of the empty-`required_facts` diagnostic questions for concern categories
> **brakes, electrical, hvac, leak**. Pulled 2026-07-18 from the live test DB
> (`itzdasxobllfiuolmbxu`, shop 7476): `concern_questions` joined to
> `concern_subcategories`, active rows only, `array_length(required_facts,1)=0`.
> **103 questions triaged.**
>
> Classification is grounded in the 29 fact slots
> (`scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts`) and, critically, in the
> **mapper semantics** (`question-fact-mapper.ts`).

## The decisive constraint: the mapper skips on PRESENCE, not VALUE

`matchQuestionsToFacts` / `isFactPresent` count a slot as "answered" when it is **non-null**
(any value) — there is **no value-level matching**. Consequence:

> Tagging question Q with slot S causes Q to be skipped **whenever S has ANY value**.
> So a tag is SAFE only if *every* value the customer could literally state for S *fully answers Q*.

This is a high bar. Most of these 103 questions are **second-round diagnostic probes** —
conditional-behavior questions ("does it get worse when you press harder?", "does the pedal creep
down at a light?", "does the noise change when you switch to recirculate?") that (a) map to no slot
and (b) a customer essentially never volunteers in the opening free-text description. Under the
literalness rule (wrongful-skip is worse than over-asking), the overwhelmingly correct class for
these is **NEVER** (intentionally_empty), documenting *why* they can't skip so the "48% empty"
figure stops being a mystery.

**A slot's mere topical relevance is NOT enough** — e.g. `fluid_under_car_location` is topically
related to "any wet spots under the *front*?", but a customer who stated `under_rear` would trigger
a wrong-skip. Those are marked **PARTIAL** and left **untagged** (recorded, not set), because a
presence-based tag would wrong-skip.

## Class distribution

| Class | Count | Meaning |
|---|---:|---|
| SAFE | 1 | Any value of the tagged slot fully answers the question → `question.required_facts.set` |
| PARTIAL | 14 | A slot is genuinely related and narrows the answer, but presence-based skip would wrong-skip on some values → **left empty**, related slot recorded |
| NEVER | 88 | No slot expresses it AND customers don't volunteer it (2nd-round probe), or it's confirmatory of the subcategory-entry symptom → `question.intentionally_empty` |

---

## Triage table

question_id | category | slug | question | class | required_facts | derivation_note

### brakes

| qid | slug | question (abbrev) | class | required_facts | note |
|---|---|---|---|---|---|
| 624 | high_pitched_squealing | quieter/louder when pressing harder? | NEVER | — | Noise-vs-pedal-pressure behavior; no slot; not volunteered. |
| 839 | high_pitched_squealing | worse first morning stops vs louder longer you drive? | NEVER | — | Cold/warm-dependence probe; presence of `onset_timing` (any value) would wrong-skip; not volunteered. |
| 628 | high_pitched_squealing | happens after sitting then goes away? | NEVER | — | Sit-then-clear pattern ≈ `onset_timing=cold_start` but presence-based tag wrong-skips on any onset value. |
| 630 | metallic_grinding | grinding every single time you brake? | NEVER | — | Frequency probe; `onset_timing`/subcat already implies braking; no slot for "every time". |
| 631 | metallic_grinding | scraping even with foot off pedal? | NEVER | — | Constant-vs-on-application discriminator; no slot; not volunteered. |
| 633 | metallic_grinding | grinding felt through floor or pedal? | NEVER | — | Tactile-location probe (multi); no slot. |
| 637 | spongy_or_soft_pedal | pedal firmer if you pump 3×? | NEVER | — | Physical pump-test; no slot; not volunteered. |
| 639 | spongy_or_soft_pedal | takes longer to slow than it used to? | NEVER | — | Effectiveness probe; `drivable_state` doesn't capture it; not volunteered. |
| 640 | spongy_or_soft_pedal | brake-fluid reservoir dropping? | NEVER | — | Consumable-level check; no slot (see "fluid_level" finding below). |
| 642 | pedal_sinks_to_floor | pedal creeps down while holding at a light? | NEVER | — | `pedal_feel` is the subcat-entry slot (≈always present here) → tagging it would auto-skip; probe is distinct from "sinks on press". |
| 643 | pedal_sinks_to_floor | sinks faster pressing lightly or firmly? | NEVER | — | Bypass-direction probe; no slot. |
| 645 | pedal_sinks_to_floor | any warning lights on the dash? | **SAFE** | `warning_light_named` | Any named dashboard light ⇒ "yes, there are warning lights." Null (incl. "no lights") ⇒ still ask. Never wrong-skips. |
| 646 | pedal_sinks_to_floor | pedal pop right back up on release? | NEVER | — | Return-behavior probe; no slot. |
| 649 | pulsating_or_vibrating_pedal | pulsation worse the harder you press? | NEVER | — | Pressure-dependence probe; no slot. |
| 864 | pulsating_or_vibrating_pedal | vibration in steering wheel or seat? | NEVER | — | Felt-location (multi); no slot. |
| 651 | pulsating_or_vibrating_pedal | worse after a long hill/mountain? | NEVER | — | Thermal-fade probe; no slot; not volunteered. |
| 652 | pulsating_or_vibrating_pedal | vibration all the time / first / after a while? | NEVER | — | Onset-pattern probe; presence-based `onset_timing` wrong-skips. |
| 654 | hard_or_unresponsive_pedal | pedal stiff before key-on in the morning? | NEVER | — | Vacuum-reserve test; no slot; not volunteered. |
| 655 | hard_or_unresponsive_pedal | pedal drops when you crank the engine? | NEVER | — | Booster test; no slot. |
| 656 | hard_or_unresponsive_pedal | harder to press the longer you drive? | NEVER | — | Progressive-stiffening probe; no slot. |
| 657 | hard_or_unresponsive_pedal | hear any noises while braking? | PARTIAL | (`noise_descriptor`) | Left empty. A stated `noise_descriptor` needn't be brake-related; presence-based tag would wrong-skip. Discovers a NEW symptom → keep asking. |
| 658 | hard_or_unresponsive_pedal | engine idle rough/stumble when you press brakes? | NEVER | — | Booster-leak probe; `engine_running=rough_idle` presence wrong-skips + brake-press-specific. |

### electrical

| qid | slug | question (abbrev) | class | required_facts | note |
|---|---|---|---|---|---|
| 877 | wont_crank_just_clicks | how old is the battery? | NEVER | — | No `battery_age` slot (candidate below). Presence not derivable from current slots. |
| 880 | wont_crank_just_clicks | every time, or sometimes starts on retry? | NEVER | — | Intermittency probe; `engine_running` is subcat-entry (present); no frequency slot. |
| 527 | slow_crank_sluggish_start | worse in morning vs after a few hours? | NEVER | — | Cold-soak probe; presence-based `onset_timing` wrong-skips. |
| 528 | slow_crank_sluggish_start | how old is the battery? | NEVER | — | No `battery_age` slot (candidate below). |
| 532 | battery_drains_overnight | how long can it sit before it dies? | NEVER | — | Drain-rate probe; no slot. |
| 533 | battery_drains_overnight | after a jump, runs normal all day? | NEVER | — | Charging-vs-drain discriminator; no slot. |
| 534 | battery_drains_overnight | added dashcam/stereo/remote-start/alarm/trailer wiring? | NEVER | — | Aftermarket-install probe; `recent_action` has no such value. |
| 535 | battery_drains_overnight | interior/glovebox/trunk light left on? | NEVER | — | Parasitic-draw probe; no slot. |
| 536 | battery_drains_overnight | radio/lights/wipers stay on after key-off? | NEVER | — | Relay-hangup probe; no slot. |
| 537 | battery_drains_overnight | battery age + already replaced for this? | NEVER | — | Compound (age + prior-replacement history); no slot; even `battery_age` wouldn't fully answer. |
| 1632 | accessory_doesnt_work | one, or several/all not working? | NEVER | — | Scope/count probe; `accessory_affected` names *which*, not the count semantics. |
| 1634 | accessory_doesnt_work | did anything happen right before (wreck/wash/install/spill)? | PARTIAL | (`recent_action`) | Left empty. `recent_action` covers accident/car_wash but not install/spill, and presence of an *unrelated* recent action (e.g. oil_change) would wrong-skip. |
| 1635 | accessory_doesnt_work | any sound (click/hum/buzz) or silent? | NEVER | — | Motor-vs-dead probe; no slot. |
| 1636 | accessory_doesnt_work | anything else electrical acting up? | NEVER | — | Accessory-vs-systemic discriminator; no slot. |
| 1637 | accessory_doesnt_work | fuses checked — blown or okay? | NEVER | — | Diagnostic-history probe; no slot. |
| 553 | multiple_random_electrical_glitches | list everything acting up | NEVER | — | Enumeration (multi); `accessory_affected` can't hold the full set reliably; core probe. |
| 554 | multiple_random_electrical_glitches | glitches at the same time or different times? | NEVER | — | Correlation probe; no slot. |
| 561 | car_died_while_driving_electrical | sputtered gradually vs shut off all at once? | NEVER | — | Fuel-vs-electrical discriminator; `engine_running=died_while_driving` present but doesn't carry manner. |
| 565 | car_died_while_driving_electrical | lots of accessories on at the time? | NEVER | — | Load-at-failure probe; no slot. |

### hvac

| qid | slug | question (abbrev) | class | required_facts | note |
|---|---|---|---|---|---|
| 567 | ac_blows_warm_or_hot_air | warm all the time vs cools then warms? | NEVER | — | Cycling probe; no slot; not volunteered. |
| 568 | ac_blows_warm_or_hot_air | click under the hood when AC turns on? | NEVER | — | Compressor-clutch probe; no slot. |
| 570 | ac_blows_warm_or_hot_air | oily/wet spots under the front? | PARTIAL | (`fluid_under_car_location`,`fluid_color`) | Left empty. Presence with a non-front value (e.g. `under_rear`) would wrong-skip; also a NEW-symptom (leak) discovery. |
| 573 | ac_blows_warm_or_hot_air | warm from every vent or just some? | PARTIAL | (`airflow_state`) | Left empty. `airflow_state` describes strength, not per-vent *temperature*; presence wrong-skips. |
| 574 | ac_is_weak_not_cold_enough | at least somewhat cool, just not as cold? | NEVER | — | Confirms weak-vs-warm (subcat already `ac_is_weak`); no slot. |
| 575 | ac_is_weak_not_cold_enough | colder on recirculate/max AC? | NEVER | — | Charge-vs-airflow probe; no slot. |
| 576 | ac_is_weak_not_cold_enough | cabin air filter changed in last 1–2 yrs? | NEVER | — | No `cabin_filter_age` slot (candidate below). |
| 937 | heat_doesnt_work | blows cold / room-temp / a little warm? | NEVER | — | Degree-of-heat probe; no slot. |
| 939 | heat_doesnt_work | temp gauge reaches normal or stays cold? | NEVER | — | Thermostat probe; no gauge-behavior slot. |
| 940 | heat_doesnt_work | added coolant recently / tank low? | NEVER | — | Consumable-level check; no slot (see "fluid_level" finding). |
| 941 | heat_doesnt_work | puddles/wet spots under the front? | PARTIAL | (`fluid_under_car_location`) | Left empty. Same wrong-skip risk as 570; NEW-symptom discovery. |
| 945 | vents_dont_blow_strongly | cabin air filter last replaced when? | NEVER | — | No `cabin_filter_age` slot (candidate below). |
| 946 | vents_dont_blow_strongly | weak from every vent or dash/floor/defrost? | PARTIAL | (`airflow_state`) | Left empty. `only_one_zone_blows` partially maps, but other `airflow_state` values present would wrong-skip. |
| 947 | vents_dont_blow_strongly | stronger on recirculate? | NEVER | — | Intake-blockage probe; no slot. |
| 948 | vents_dont_blow_strongly | squeak/grind/rattle behind the dash? | NEVER | — | Blower-bearing probe (NEW symptom); no slot. |
| 950 | vents_dont_blow_strongly | fan come on at all at lowest speed? | PARTIAL | (`airflow_state`) | Left empty. `no_airflow` maps, but a present `weak_overall`/`only_on_highest_setting` would wrong-skip. |
| 596 | foggy_or_hard_to_defog_windows | does defrost air reach the windshield? | NEVER | — | Mode-routing probe; no slot. |
| 597 | foggy_or_hard_to_defog_windows | clears if you add AC to defrost? | NEVER | — | Dehumidify probe; no slot. |
| 598 | foggy_or_hard_to_defog_windows | wet carpet passenger-side floor? | NEVER | — | Heater-core-leak sign; no slot; NEW symptom. |
| 599 | foggy_or_hard_to_defog_windows | inside of windows greasy/oily? | NEVER | — | Heater-core sign; no slot. |
| 600 | foggy_or_hard_to_defog_windows | rear defroster (lines) work? | NEVER | — | Separate-circuit probe; no slot. |
| 601 | foggy_or_hard_to_defog_windows | worse with more passengers? | NEVER | — | Humidity-load probe; no slot. |
| 603 | strange_noise_from_vents | noise only when fan on, or fan off too? | NEVER | — | Blower-vs-other probe; no slot; not volunteered. |
| 604 | strange_noise_from_vents | noise change with fan speed? | NEVER | — | Blower-motor probe; no slot. |
| 605 | strange_noise_from_vents | noise change switching dash/floor/defrost? | NEVER | — | Blend/mode-door probe; no slot. |
| 606 | strange_noise_from_vents | noise change fresh-air vs recirculate? | NEVER | — | Intake-door probe; no slot. |
| 607 | strange_noise_from_vents | started after leaves/debris near the cowl? | NEVER | — | Debris probe; `recent_action` has no such value. |
| 968 | bad_smell_from_vents | windows fogging when the smell shows up? | NEVER | — | Correlation probe; no slot. |
| 969 | bad_smell_from_vents | cabin air filter changed in last 1–2 yrs? | NEVER | — | No `cabin_filter_age` slot (candidate below). |
| 971 | bad_smell_from_vents | smell go away or worsen on recirculate? | NEVER | — | Intake-source probe; no slot. |
| 975 | one_zone_works_but_another_doesnt | clicking/tapping behind dash on temp change? | NEVER | — | Blend-actuator probe; no slot. |
| 976 | one_zone_works_but_another_doesnt | bad-side temp changes at all or stuck? | NEVER | — | Actuator-range probe; no slot. |
| 978 | one_zone_works_but_another_doesnt | airflow strength normal on the bad side? | PARTIAL | (`airflow_state`) | Left empty. `uneven_temperature_between_zones` is topical but presence-based tag wrong-skips; isolates temp-vs-airflow fault. |

### leak

| qid | slug | question (abbrev) | class | required_facts | note |
|---|---|---|---|---|---|
| 324 | brown_or_black_puddle_engine_oil | thick/slippery like cooking oil? | NEVER | — | Confirms `fluid_color=brown_or_black` (subcat-entry); no distinct slot. |
| 325 | brown_or_black_puddle_engine_oil | burning smell or smoke under hood while driving? | PARTIAL | (`smell_descriptor`,`smoke_color`) | Left empty. NEW-symptom discovery; presence of an unrelated smell/smoke value would wrong-skip. |
| 327 | brown_or_black_puddle_engine_oil | adding oil between changes / dipstick low? | NEVER | — | Consumable-level check; no slot (see "fluid_level" finding). |
| 328 | brown_or_black_puddle_engine_oil | how big is the spot? | NEVER | — | Leak-size probe; no slot (only 1 question → below new-slot bar). |
| 329 | brown_or_black_puddle_engine_oil | only after driving vs fresh drops after sitting? | NEVER | — | Leak-timing probe; no slot (`leak_timing` candidate below). |
| 988 | green_orange_yellow_or_pink_puddle_coolant | temp gauge creeping hot / overheated? | NEVER | — | Overheat probe; no gauge/overheat slot. |
| 990 | green_orange_yellow_or_pink_puddle_coolant | adding antifreeze / level dropped? | NEVER | — | Consumable-level check; no slot. |
| 991 | green_orange_yellow_or_pink_puddle_coolant | steam from under the hood when you stop? | PARTIAL | (`smoke_color`) | Left empty. `steam_thin_wispy` is topical but presence-based tag wrong-skips on other smoke values; NEW symptom. |
| 992 | green_orange_yellow_or_pink_puddle_coolant | fog + sweet smell from vents on heat? | PARTIAL | (`smell_descriptor`) | Left empty. Compound (fog AND sweet smell); `sweet_or_maple_syrup` partial only; wrong-skip risk. |
| 995 | red_or_pink_puddle_transmission_or_power_steering | shift into D/R hesitate/slip/rough? | NEVER | — | Trans-drivability (NEW symptom); no slot. |
| 997 | red_or_pink_puddle_transmission_or_power_steering | topping off power-steering reservoir? | NEVER | — | Consumable-level check; no slot. |
| 998 | red_or_pink_puddle_transmission_or_power_steering | more after driving vs also when sitting a day? | NEVER | — | Leak-timing probe; no slot (`leak_timing` candidate below). |
| 999 | red_or_pink_puddle_transmission_or_power_steering | after running vs first thing in the morning? | NEVER | — | Leak-timing probe; no slot (`leak_timing` candidate below). |
| 1003 | clear_yellow_or_light_brown_puddle_brake_fluid | slick/oily clear-yellow, fishy/oily smell? | NEVER | — | Confirms `fluid_color=clear_yellow_or_light_brown` (subcat-entry); no distinct slot. |
| 1005 | clear_yellow_or_light_brown_puddle_brake_fluid | pulls to one side braking / stops longer? | PARTIAL | (`pull_direction`) | Left empty. NEW-symptom (brake performance); presence-based `pull_direction` wrong-skips (e.g. a non-braking drift). |
| 1006 | clear_yellow_or_light_brown_puddle_brake_fluid | brake-fluid reservoir low? | NEVER | — | Consumable-level check; no slot. |
| 1736 | clear_odorless_puddle_water_or_ac_condensation | only after running AC on a warm/humid day? | PARTIAL | (`weather_condition`,`hvac_mode`) | Left empty. Key normal-vs-fault discriminator; compound + presence-based wrong-skip → must keep asking. |
| 1739 | clear_odorless_puddle_water_or_ac_condensation | dries quickly, no stain/residue? | NEVER | — | Confirms `fluid_color=clear_no_color` (subcat-entry); no distinct slot. |
| 1740 | clear_odorless_puddle_water_or_ac_condensation | wet carpet passenger-side floor? | NEVER | — | Heater-core-vs-condensation sign; no slot. |
| 1741 | clear_odorless_puddle_water_or_ac_condensation | leak when AC off, or only after AC? | NEVER | — | AC-condensation discriminator; no slot. |
| 1745 | thick_dark_brown_puddle_gear_or_differential_oil | thicker/darker than engine oil? | NEVER | — | Confirms `fluid_color=thick_dark_brown` (subcat-entry); no distinct slot. |
| 1746 | thick_dark_brown_puddle_gear_or_differential_oil | whine/hum/grind from the back, louder with speed? | NEVER | — | Bearing/gear NEW symptom; no slot. |
| 1747 | thick_dark_brown_puddle_gear_or_differential_oil | vibration/clunk on turns or accelerating? | NEVER | — | Driveline NEW symptom; no slot. |
| 1748 | thick_dark_brown_puddle_gear_or_differential_oil | leak from the pumpkin-shaped rear-axle housing? | PARTIAL | (`fluid_under_car_location`) | Left empty. `under_rear` is topical but presence-based tag wrong-skips; "pumpkin housing" is more specific than the slot. |
| 1749 | thick_dark_brown_puddle_gear_or_differential_oil | recent towing/off-roading/hauling? | NEVER | — | Load-history probe; `recent_action` has no such value. |
| 1023 | blue_or_light_blue_puddle_washer_fluid | washer spray reach the windshield / weakened? | NEVER | — | Pump/line probe; no slot. |
| 1024 | blue_or_light_blue_puddle_washer_fluid | refilling washer fluid more than usual? | NEVER | — | Consumable-level check; no slot. |
| 1025 | blue_or_light_blue_puddle_washer_fluid | watery/thin rather than oily? | NEVER | — | Confirms `fluid_color=blue_or_light_blue` (subcat-entry); no distinct slot. |
| 1026 | blue_or_light_blue_puddle_washer_fluid | only after using washers vs drips all the time? | NEVER | — | Leak-timing probe; no slot (`leak_timing` candidate below). |

---

## Proposed new slots

Rule: a new slot must unlock **≥3 questions** (else extend an existing slot). Even when the ≥3
letter is met, note that under the **presence-based mapper** a slot only helps if a customer would
*literally volunteer* it in the opening description (otherwise the slot is null and the question is
asked anyway — no skip). All three candidates below meet ≥3 by count but have **modest real-world
skip yield** because customers rarely state these upfront. Recommend Chris weigh yield before adding.

### 1. `battery_age` (candidate — borderline)
- **Questions:** 877, 528, 537 (3; but 537 is compound — age **and** prior-replacement history, so `battery_age` alone only *fully* answers 877 + 528 = 2 clean).
- **Type/values:** enum `lt_2` / `2_to_4` / `gt_4` / `unsure` (mirrors the question options).
- **Literal cues:** "battery is 5 years old", "3-year-old battery", "brand new battery", "original battery from when I bought it".
- **Overlap:** `recent_action=battery_or_alternator_work` already captures "new battery" as a recent event; a dedicated age slot adds the >2 / >4 gradient.
- **Verdict:** 2 clean unlocks → **below the 3-clean bar**. Recommend **defer** unless Chris wants the gradient; do not add on 537's compound alone.

### 2. `cabin_filter_age` (candidate — low yield)
- **Questions:** 576, 945, 969 (3 — meets the letter).
- **Type/values:** enum `lt_1_year` / `1_to_3` / `gt_3` / `never_or_unsure`.
- **Literal cues:** "just replaced the cabin air filter", "never changed the cabin filter", "changed the cabin filter last year".
- **Verdict:** Meets ≥3, but customers almost never volunteer filter age in a symptom description → **very low skip yield**. Recommend **defer**.

### 3. `leak_timing` (candidate — best of the three)
- **Questions:** 329, 998, 999, 1026 (4 — comfortably meets ≥3).
- **Type/values:** enum `after_driving_only` / `also_when_parked_cold` / `unsure`.
- **Literal cues:** "only drips after I drive", "fresh drops in the morning after it sits", "puddle even when it's been parked overnight", "leaks all the time".
- **Verdict:** More plausibly volunteered than the other two ("only leaks after driving" is common phrasing). **Weak recommend** if any slot is added. NOTE: still presence-based — a stated `also_when_parked_cold` must fully answer each of the 4 questions' framings; the option sets differ slightly (329/998/999 are two-way after-driving-vs-sitting; 1026 is after-washers-vs-always for washer fluid), so verify per-question the value maps cleanly before tagging. 1026 (washer) is a poor fit — its "after using washers" axis is not a driving/sitting axis; **exclude 1026**, leaving 3 clean.

### Slots deliberately NOT proposed
- **`leak_size`** (328) — 1 question, below bar.
- **`vent_noise_change_with_control`** (603, 604, 605, 606) — 4 questions, but these are pure
  second-round probes a customer never volunteers → a slot would sit null and skip nothing.
- **Vacuum/booster pedal tests** (637, 654, 655) — physical in-bay tests, never in customer text.

### Key finding — the presence-based mapper blocks a generic "fluid level" slot
Seven questions ask a **consumable-level** question — "have you had to add / top off / refill X, or
is the reservoir low?": **640** (brake), **940** & **990** (coolant), **327** (oil), **997** (PS),
**1006** (brake), **1024** (washer). A single generic `fluid_level_dropping` slot would meet ≥3
easily and IS often volunteered ("I keep having to add oil"). **But** the mapper matches on
*presence*, not *value* — a customer topping off *oil* would set the slot non-null and thereby
wrong-skip the *coolant* level question. A per-fluid slot family (`level_low_oil`, `level_low_coolant`, …)
would avoid that but is too many slots. **Recommendation:** this is the single biggest structural
limiter for skip yield in the leak/hvac/brakes categories — surface to Chris as a **mapper
enhancement** (value-aware matching in `question-fact-mapper.ts`) rather than a slot change. With
value-aware matching, `fluid_color` + a value-conditional level slot could safely skip several of
these. Out of scope for a pure `required_facts` tag; flagged for Phase 5 sequencing.

---

## How to read the classes as ops (per dossier-template.md §proposals)
- **SAFE** → `op: question.required_facts.set { question_id, facts:[...], skip_class: SAFE, derivation_note }`
- **PARTIAL** → recorded here, **no op emitted** (left empty) — the related slot is noted in parentheses; a presence-based tag would wrong-skip. Revisit if/when the mapper becomes value-aware.
- **NEVER** → `op: question.intentionally_empty { question_id, reason }` (the note column is the reason).
