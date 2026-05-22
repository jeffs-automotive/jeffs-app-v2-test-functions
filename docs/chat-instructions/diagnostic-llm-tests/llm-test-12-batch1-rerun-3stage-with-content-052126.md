# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T01:10:08.557Z
**Architecture:** three-stage classifier (Stage 1 category → Stage 2 subcategory → Stage 3 fact extraction → deterministic mapper) (refactor 2026-05-21)
**Stage 1 model:** `anthropic/claude-haiku-4-5` (category match — brief catalog)
**Stage 2 model:** `anthropic/claude-haiku-4-5` (subcategory pick — single-category subtree with enriched descriptions + positive/negative examples + synonyms)
**Stage 3 model:** `anthropic/claude-haiku-4-5` (fact extraction — ~29 typed slots; no question text)
**Catalog at test time:** 23 testing services + 6 'other' subcategories = 29 entries
**Chip hint:** Other Issue (no pre-classification — the hardest classification case)
**Endpoint:** `https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/llm-testing`
**Caching:** `providerOptions.gateway.caching='auto'` enabled on all three stages.

## Per-step labels

- `matched 'X'` — successful step
- `LLM returned null` — LLM intentionally declined (not a failure)
- `hallucinated` — LLM returned a slug not in catalog; post-validation dropped it
- `silently_failed` — values dropped by validation without an explicit error
- `failed` — that stage's LLM call errored or returned malformed structured output
- `short_circuit` — pre-LLM short-circuit (desc<3 chars)
- `skipped` — upstream step's outcome made this step a no-op
- step 4 (extract facts, S3): Stage 3 extracts ~29 typed slots (location_side, speed_band, noise_descriptor, etc.) from the customer's literal description. Reports the count of non-null slots extracted.
- step 5 (deterministic mapper): pure-TS mapper that partitions the matched subcategory's questions into answered / ambiguous / unanswered buckets based on each question's `required_facts[]` vs the slots extracted by S3. No LLM in the loop here.
- step 6 (gap-detect questions): the FINAL `unanswered_question_ids` the wizard will surface to the customer (= mapper unanswered ∪ ambiguous, since v1 treats ambiguous as unanswered for safe over-ask).
- step 7 (confidence per stage): self-reported `high` / `medium` / `low` per stage. 'high' = clear single fit; 'medium' = best of 2-3 plausible; 'low' = vague / forced match. Used downstream to route low-confidence picks to advisor review.
- step 8 (reasoning): one-sentence audit-log rationale from each stage (≤280 chars).
- `extracted_facts` block: lists the non-null slots Stage 3 extracted from the customer description. Null/empty slots are omitted to reduce noise.

## Test cases

### Test 1

```
{
concern: My car makes a loud knocking noise when I first start it in the morning but it stops after about a minute
LLM decision tree:
  step 1 (match category, S1):       matched 'oil_pressure_light_testing'
  step 2 (vagueness check):          passed — description has 105 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'engine_ticking_or_tapping'
  step 4 (extract facts, S3):        extracted 6 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [72, 73, 74, 75]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Loud knocking on cold start that resolves suggests possible low oil pressure or engine knock; oil_pressure_light_testing covers engine noise diagnosis and oil system verification." · S2: "Customer describes a noise at cold start that quiets after warming up, matching the lifter tick positive example. However, 'loud knocking' suggests deeper sound than typical ticking; if truly a heavy knock from the lower block, deep_knocking_from_the_engine would fit better, but that subcategory isn't available in this list." · S3: "Customer clearly stated loud knocking at cold start that resolves after ~1 minute. Extracted noise_descriptor as knocking_deep, onset_timing as cold_start, speed_band as idle, weather_condition as cold_weather, and sound_or_smoke_location_zone as under_hood (engine knock). No other facts literally stated."
extracted_facts:
  speed_band: "idle"
  onset_timing: "cold_start"
  noise_descriptor: "knocking_deep"
  weather_condition: "cold_weather"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: oil_pressure_light_testing
matched sub category slug: engine_ticking_or_tapping
unanswered question ids: [72, 73, 74, 75]
testing service recommended: oil_pressure_light_testing — Oil pressure light testing ($179.95)
}
```

<sub>S1: 13675ch · 1840ms · 3867/65t · S2: 8043ch · 2749ms · 2575/108t · S3: 19668ch · 3858ms · 34/307t · Total: 8448ms wall 9253ms · 6476/480t</sub>

### Test 2

```
{
concern: Brakes squeak really bad when I'm coming to a stop especially at slow speeds
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 76 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'high_pitched_squealing'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [624, 626, 627, 628, 629, 839]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports brake squeaking at slow speeds during stops, a classic brake pad wear symptom that requires inspection of pads, rotors, and calipers per brake_inspection service." · S2: "Customer describes "brakes squeak really bad when coming to a stop especially at slow speeds" — a direct match to the positive example "Screeching noise when I press the brake pedal, especially at low speeds" and the synonym "squeaking."" · S3: "Customer clearly stated brake squeak (squealing_high_pitched) occurring at slow speeds (low_speed) when coming to a stop (at_stop). No other details provided; all other slots null."
extracted_facts:
  speed_band: "low_speed"
  onset_timing: "at_stop"
  noise_descriptor: "squealing_high_pitched"
matched category key: brake_inspection
matched sub category slug: high_pitched_squealing
unanswered question ids: [624, 626, 627, 628, 629, 839]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 13675ch · 1629ms · 3862/64t · S2: 22200ch · 4767ms · 29/85t · S3: 19765ch · 4247ms · 29/272t · Total: 10644ms wall 11102ms · 3920/421t</sub>

### Test 3

```
{
concern: AC blows hot air on the driver side but cold on the passenger side
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 66 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'one_zone_works_but_another_doesnt'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [975, 976, 977, 978]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports AC blows hot on driver side but cold on passenger side, indicating uneven cooling performance; ac_performance_check includes blower, mode, and cooling fan operation verification." · S2: "Customer reports asymmetric temperature across zones: driver side hot, passenger side cold. This is a textbook dual-zone blend door actuator failure, matching the positive example 'Driver side blows cold, passenger side blows warm' (inverted polarity, same root cause)." · S3: "Customer explicitly stated AC mode with asymmetric temperature between driver (hot) and passenger (cold) sides—a classic dual-zone blend door actuator failure pattern. No other details provided."
extracted_facts:
  location_side: "both"
  hvac_mode: "ac"
  airflow_state: "uneven_temperature_between_zones"
matched category key: ac_performance_check
matched sub category slug: one_zone_works_but_another_doesnt
unanswered question ids: [975, 976, 977, 978]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 13675ch · 1544ms · 3859/66t · S2: 19980ch · 3271ms · 26/96t · S3: 20047ch · 3290ms · 26/266t · Total: 8106ms wall 8616ms · 3911/428t</sub>

### Test 4

```
{
concern: When I turn the steering wheel all the way left I hear a clicking noise
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 71 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'popping_or_clicking_when_turning'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [113, 114, 115, 116, 117, 119]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Clicking noise when turning the wheel fully left suggests a CV joint or steering component issue; suspension_steering_check covers steering inspection and abnormal noises." · S2: "Customer describes a clicking noise that occurs only when turning the steering wheel (all the way left), matching the positive example 'Clicking noise from the front wheels only when I turn in parking lots' and the synonym 'click, clicking' tied to turn-triggered CV joint symptoms." · S3: "Customer clearly stated clicking noise occurs when turning steering wheel all the way left. Set onset_timing='when_turning' and noise_descriptor='popping_or_clicking'. No other facts literally stated; left all other slots null."
extracted_facts:
  onset_timing: "when_turning"
  noise_descriptor: "popping_or_clicking"
matched category key: suspension_steering_check
matched sub category slug: popping_or_clicking_when_turning
unanswered question ids: [113, 114, 115, 116, 117, 119]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 1648ms · 3859/60t · S2: 44059ch · 2026ms · 26/93t · S3: 19792ch · 3208ms · 26/275t · Total: 6882ms wall 7265ms · 3911/428t</sub>

### Test 5

```
{
concern: Battery keeps dying overnight even though it's only 2 years old
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 63 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'battery_drains_overnight'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [532, 533, 534, 535, 536, 537, 538]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports battery dying overnight despite being relatively new, indicating a charging or parasitic drain issue; charging_starting_testing includes alternator output and parasitic draw diagnosis." · S2: "Customer describes battery dying when car sits overnight despite recent replacement—classic parasitic drain pattern matching 'battery keeps dying when the car sits, even though I just replaced it' positive example." · S3: "Customer clearly stated battery dies overnight (parasitic drain pattern) and is 2 years old. Set drivable_normally (car runs fine when driven) and diagnose_problem (they want to know why). onset_timing set to when_idling as a proxy for 'when parked/engine off,' though customer didn't explicitly state this timing detail."
extracted_facts:
  onset_timing: "when_idling"
  drivable_state: "drivable_normally"
  customer_request_type: "diagnose_problem"
matched category key: charging_starting_testing
matched sub category slug: battery_drains_overnight
unanswered question ids: [532, 533, 534, 535, 536, 537, 538]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 13675ch · 1711ms · 3858/62t · S2: 16833ch · 1954ms · 25/69t · S3: 19979ch · 3956ms · 25/307t · Total: 7622ms wall 8061ms · 3908/438t</sub>

### Test 6

```
{
concern: There's a sweet syrupy smell coming from under the hood after driving for a while
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 81 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'sweet_smell_maple_syrup_antifreeze'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [225, 227, 228, 229, 231]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Sweet syrupy smell under hood is a classic indicator of coolant leak; matches coolant_leak_testing service which includes leak detection and overheating diagnosis." · S2: "Customer reports sweet syrupy smell from under the hood after driving — a direct match to the positive example 'Sweet smell coming from under the hood after I drive' and the core description of ethylene-glycol vapor from coolant leak." · S3: "Customer clearly stated sweet syrupy smell (coolant) from under the hood after driving (engine warm). No other details provided; all other slots null."
extracted_facts:
  location_axle: "front"
  onset_timing: "after_warming_up"
  smell_descriptor: "sweet_or_maple_syrup"
  sound_or_smoke_location_zone: "under_hood"
matched category key: coolant_leak_testing
matched sub category slug: sweet_smell_maple_syrup_antifreeze
unanswered question ids: [225, 227, 228, 229, 231]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 13675ch · 2104ms · 3862/63t · S2: 16745ch · 1605ms · 29/87t · S3: 19895ch · 3162ms · 29/265t · Total: 6872ms wall 7475ms · 3920/415t</sub>

### Test 7

```
{
concern: White smoke coming out the tailpipe when I accelerate hard
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 58 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'white_smoke_from_tailpipe'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [282, 283, 284, 285, 287]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "White smoke from tailpipe during acceleration typically indicates coolant burning in the engine (head gasket, intake valve seal, or internal leak), which the coolant leak/overheating test directly diagnoses via pressure test and block test." · S2: "Customer reports white smoke from tailpipe during acceleration, matching the positive example 'Lots of white smoke coming out of the tailpipe' and the core description of coolant burning in cylinders from head gasket or similar failure." · S3: "Customer clearly stated white smoke from tailpipe triggered by hard acceleration. Set smoke_color=white, onset_timing=when_accelerating, sound_or_smoke_location_zone=from_tailpipe. No other facts literally stated; all other slots null."
extracted_facts:
  onset_timing: "when_accelerating"
  smoke_color: "white"
  sound_or_smoke_location_zone: "from_tailpipe"
matched category key: coolant_leak_testing
matched sub category slug: white_smoke_from_tailpipe
unanswered question ids: [282, 283, 284, 285, 287]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 13675ch · 1879ms · 3857/78t · S2: 16745ch · 2034ms · 24/83t · S3: 19687ch · 3652ms · 24/284t · Total: 7566ms wall 8118ms · 3905/445t</sub>

### Test 8

```
{
concern: Brake pedal goes almost to the floor before the brakes engage
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 61 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'pedal_sinks_to_floor'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [642, 643, 644, 645, 646, 647]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer describes brake pedal sinking to floor before engagement, a classic brake system concern requiring inspection of pads, rotors, fluid level, and lines per brake_inspection service." · S2: "Customer describes pedal dropping toward the floor before brakes engage, matching the positive example 'Brake pedal goes straight to the floorboard, almost no resistance' and the core symptom of master cylinder bypass or hydraulic leak." · S3: "Customer clearly stated the brake pedal sinks almost to the floor before engagement, matching the 'sinks_to_floor' pedal_feel enum. No other facts were literally stated in the description."
extracted_facts:
  pedal_feel: "sinks_to_floor"
matched category key: brake_inspection
matched sub category slug: pedal_sinks_to_floor
unanswered question ids: [642, 643, 644, 645, 646, 647]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 13675ch · 1927ms · 3858/63t · S2: 22200ch · 2921ms · 25/83t · S3: 19720ch · 3068ms · 25/268t · Total: 7918ms wall 8621ms · 3908/414t</sub>

### Test 9

```
{
concern: Steering wheel pulls hard to the right whenever I let go on the highway
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 71 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'steady_drift_while_cruising'
  step 4 (extract facts, S3):        extracted 6 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [190, 191, 192, 194, 195, 196]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports steering wheel pulling hard to the right on highway, a classic alignment/suspension/steering symptom that maps directly to suspension_steering_check inspection." · S2: "Customer describes car pulling consistently to one side (right) while driving straight on highway, matching the steady directional pull pattern and requiring steering correction—a classic steady_drift_while_cruising symptom." · S3: "Customer clearly stated the vehicle pulls hard to the right on the highway when hands are off the wheel. Extracted pull_direction=right, speed_band=highway, onset_timing=during_driving, and steering_feel=heavy_or_hard_to_turn (the pull requires correction). All other slots null as not mentioned."
extracted_facts:
  speed_band: "highway"
  onset_timing: "during_driving"
  steering_feel: "heavy_or_hard_to_turn"
  pull_direction: "right"
  drivable_state: "drivable_but_concerned"
  customer_request_type: "diagnose_problem"
matched category key: suspension_steering_check
matched sub category slug: steady_drift_while_cruising
unanswered question ids: [190, 191, 192, 194, 195, 196]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 1523ms · 3859/60t · S2: 44059ch · 5310ms · 26/75t · S3: 19833ch · 3895ms · 26/309t · Total: 10728ms wall 11219ms · 3911/444t</sub>

### Test 10

```
{
concern: Tires wearing unevenly on the front passenger side, looks like cupping
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'uneven_tire_wear_bald_spots'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [730, 732, 733, 734, 735, 736]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Uneven tire wear and cupping are classic suspension/steering symptoms; the technician will inspect alignment, suspension components, and perform a road test to diagnose the cause." · S2: "Customer explicitly describes uneven tire wear with cupping pattern on the front passenger side, matching the positive example 'Shop told me my tires are cupping' and the core description of tread wear patterns." · S3: "Customer explicitly stated front passenger-side tire with cupping wear pattern. location_side=right (passenger), location_axle=front, tire_state=uneven_wear (cupping is a classic uneven wear pattern). No other symptoms or timing details mentioned."
extracted_facts:
  location_side: "right"
  location_axle: "front"
  tire_state: "uneven_wear"
matched category key: suspension_steering_check
matched sub category slug: uneven_tire_wear_bald_spots
unanswered question ids: [730, 732, 733, 734, 735, 736]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 1646ms · 3861/64t · S2: 44059ch · 1736ms · 28/79t · S3: 19973ch · 4009ms · 28/279t · Total: 7393ms wall 7822ms · 3917/422t</sub>

### Test 11

```
{
concern: Check engine light came on yesterday but car drives normal
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 58 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 7 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [374, 375, 376, 378]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports check engine light activation; this directly maps to check_engine_light_testing service which scans for trouble codes and verifies sensor/system performance." · S2: "Customer reports check engine light came on; positive example match: 'My check engine light is on, the car runs okay but it just popped up yesterday' directly parallels the description." · S3: "Customer explicitly stated check engine light came on yesterday (started_when=today), car drives normally (engine_running=normal, drivable_state=drivable_normally). No other symptoms described; all other slots null."
extracted_facts:
  onset_timing: "at_startup"
  started_when: "today"
  warning_light_named: "check engine"
  warning_light_behavior: "steady_on"
  engine_running: "normal"
  drivable_state: "drivable_normally"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [374, 375, 376, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1629ms · 3854/63t · S2: 42816ch · 1650ms · 21/69t · S3: 19941ch · 3486ms · 21/280t · Total: 6766ms wall 7347ms · 3896/412t</sub>

### Test 12

```
{
concern: ABS light just turned on a few minutes ago and stayed on
LLM decision tree:
  step 1 (match category, S1):       matched 'abs_traction_stability_testing'
  step 2 (vagueness check):          passed — description has 56 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'abs_anti_lock_brake_light'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [413, 414, 415, 416, 417, 418]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports ABS light is on and staying on, which directly maps to ABS/traction/stability light testing service that scans for trouble codes and inspects related sensors and components." · S2: "Customer explicitly mentions 'ABS light' turning on and staying on, which is a verbatim match to positive example 'ABS light just came on this morning, never on before' and the core description of the ABS subcategory." · S3: "Customer clearly stated ABS light turned on a few minutes ago and stayed on continuously. Extracted warning_light_named='abs', warning_light_behavior='steady_on', started_when='just_now', onset_timing='at_startup', and customer_request_type='diagnose_problem'. No other symptoms or details provided."
extracted_facts:
  onset_timing: "at_startup"
  started_when: "just_now"
  warning_light_named: "abs"
  warning_light_behavior: "steady_on"
  customer_request_type: "diagnose_problem"
matched category key: abs_traction_stability_testing
matched sub category slug: abs_anti_lock_brake_light
unanswered question ids: [413, 414, 415, 416, 417, 418]
testing service recommended: abs_traction_stability_testing — ABS / traction / stability light testing ($179.95)
}
```

<sub>S1: 13675ch · 1419ms · 3857/70t · S2: 6990ch · 2687ms · 2306/86t · S3: 20023ch · 3389ms · 24/301t · Total: 7499ms wall 8089ms · 6187/457t</sub>

### Test 13

```
{
concern: Airbag light is flashing intermittently
LLM decision tree:
  step 1 (match category, S1):       matched 'airbag_srs_testing'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'airbag_srs_light'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [427, 428, 429, 430, 432, 433]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports 'airbag light is flashing intermittently,' which directly indicates a Supplemental Restraint System (SRS) fault requiring diagnostic scanning and component inspection per airbag_srs_testing service." · S2: "Customer describes airbag light flashing intermittently, which directly matches the positive example 'Airbag light flashing a pattern of short and long blinks' and the subcategory description of a flashing pattern indicating a system fault." · S3: "Customer explicitly stated the airbag warning light is flashing intermittently. Set warning_light_named='airbag', warning_light_behavior='flashing_or_blinking', onset_timing='intermittent', and inferred customer_request_type='diagnose_problem' (no known cause stated). All other slots null as not mentioned."
extracted_facts:
  onset_timing: "intermittent"
  warning_light_named: "airbag"
  warning_light_behavior: "flashing_or_blinking"
  customer_request_type: "diagnose_problem"
matched category key: airbag_srs_testing
matched sub category slug: airbag_srs_light
unanswered question ids: [427, 428, 429, 430, 432, 433]
testing service recommended: airbag_srs_testing — Airbag / SRS light testing ($179.95)
}
```

<sub>S1: 13675ch · 2993ms · 3855/79t · S2: 4840ch · 2936ms · 1765/85t · S3: 19995ch · 3561ms · 22/310t · Total: 9491ms wall 10121ms · 5642/474t</sub>

### Test 14

```
{
concern: Oil pressure light flickers when I come to a stop at idle
LLM decision tree:
  step 1 (match category, S1):       matched 'oil_pressure_light_testing'
  step 2 (vagueness check):          passed — description has 57 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'oil_pressure_light'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [392, 393, 394, 395, 397]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports oil pressure light flickering at idle/stop, which directly indicates oil pressure system fault requiring diagnostic scanning, sensor inspection, and mechanical pressure testing per the oil_pressure_light_testing service." · S2: "Customer describes oil pressure light flickering at idle/stops, which is a direct positive example match: 'Oil pressure light is flickering at idle and at red lights, goes off when I drive'." · S3: "Customer clearly stated oil pressure light flickers (flashing_or_blinking) when coming to a stop at idle. No other symptoms or contextual details provided; all other slots remain null."
extracted_facts:
  speed_band: "idle"
  onset_timing: "at_stop"
  warning_light_named: "oil pressure"
  warning_light_behavior: "flashing_or_blinking"
matched category key: oil_pressure_light_testing
matched sub category slug: oil_pressure_light
unanswered question ids: [392, 393, 394, 395, 397]
testing service recommended: oil_pressure_light_testing — Oil pressure light testing ($179.95)
}
```

<sub>S1: 13675ch · 1704ms · 3857/71t · S2: 8043ch · 1721ms · 2565/71t · S3: 20039ch · 3469ms · 24/269t · Total: 6896ms wall 7564ms · 6446/411t</sub>

### Test 15

```
{
concern: Car has been sitting in my driveway for 8 months, want to make sure it's road ready before driving it
LLM decision tree:
  step 1 (match category, S1):       matched 'car_has_been_sitting_unused_for_a_long_time'
  step 2 (vagueness check):          passed — description has 101 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'car_has_been_sitting_unused_for_a_long_time'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [793, 794, 795, 796, 797, 798, 799]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer explicitly states car has been sitting for 8 months and wants to ensure it's road-ready, which directly matches the 'car has been sitting unused for a long time' subcategory." · S2: "Customer explicitly states car has been sitting for 8 months and wants to verify it's road-ready, which directly matches the subcategory description of a car unused for a long time." · S3: "Customer stated car sat unused for 8 months and wants pre-trip inspection before driving. No specific symptoms described, only the recent action (car_sat_unused) and request type (pre_trip_inspection). All symptom slots correctly left null."
extracted_facts:
  started_when: "months_ago"
  recent_action: "car_sat_unused"
  customer_request_type: "pre_trip_inspection"
matched category key: car_has_been_sitting_unused_for_a_long_time
matched sub category slug: car_has_been_sitting_unused_for_a_long_time
unanswered question ids: [793, 794, 795, 796, 797, 798, 799]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1423ms · 3870/82t · S2: 2880ch · 1384ms · 1214/81t · S3: 19121ch · 4006ms · 37/283t · Total: 6814ms wall 7221ms · 5121/446t</sub>

### Test 16

```
{
concern: Just got rear-ended last week and now the car pulls left, want to make sure suspension is OK
LLM decision tree:
  step 1 (match category, S1):       matched 'after_a_recent_accident_or_impact'
  step 2 (vagueness check):          passed — description has 92 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_a_recent_accident_or_impact'
  step 4 (extract facts, S3):        extracted 6 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [765, 767, 768, 769, 770, 771]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer describes a recent rear-end accident followed by a pulling concern; this is a post-accident situation requiring advisor evaluation before targeted testing." · S2: "Customer explicitly states 'rear-ended last week' and reports pulling/handling issue post-accident, directly matching the 'after a recent accident or impact' subcategory." · S3: "Customer clearly stated rear-end accident last week (recent_action), car pulls left (pull_direction), and wants suspension checked (diagnose_problem). No other symptoms mentioned; all other slots null."
extracted_facts:
  onset_timing: "after_warming_up"
  started_when: "days_ago"
  recent_action: "accident_or_impact"
  pull_direction: "left"
  drivable_state: "drivable_but_concerned"
  customer_request_type: "diagnose_problem"
matched category key: after_a_recent_accident_or_impact
matched sub category slug: after_a_recent_accident_or_impact
unanswered question ids: [765, 767, 768, 769, 770, 771]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1570ms · 3865/62t · S2: 2840ch · 1562ms · 1191/73t · S3: 19081ch · 3335ms · 32/281t · Total: 6469ms wall 6947ms · 5088/416t</sub>

### Test 17

```
{
concern: Going on a 1500 mile road trip next weekend, want a complete check before I go
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 78 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [787, 788, 789, 790, 791, 792]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer explicitly states they want 'a complete check before' a 1500-mile road trip, which directly matches the pre-trip inspection subcategory." · S2: "Customer explicitly states 'road trip' and wants 'complete check before I go'—a textbook pre-trip inspection request matching the subcategory's core purpose." · S3: "Customer explicitly stated they want a complete check before a 1500-mile road trip; this is a clear pre_trip_inspection request. No symptoms or specific issues were described, so all diagnostic slots remain null."
extracted_facts:
  customer_request_type: "pre_trip_inspection"
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1857ms · 3864/69t · S2: 2864ch · 1629ms · 1200/74t · S3: 19105ch · 7006ms · 31/268t · Total: 10492ms wall 10877ms · 5095/411t</sub>

### Test 18

```
{
concern: Just had new tires installed at Discount Tire yesterday and now I feel a vibration at 65mph
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 91 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (extract facts, S3):        extracted 8 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [772, 773, 774, 775, 776, 777, 778]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports vibration at 65mph immediately after tire installation yesterday; this is a post-service concern that requires advisor evaluation before diagnostic testing." · S2: "Customer reports vibration immediately after tire installation yesterday, a classic post-service symptom matching the 'after recent service or repair work' subcategory." · S3: "Customer clearly stated new tires installed yesterday (recent_action), vibration at exactly 65 mph (speed_specific_mph=65), and symptom started today (started_when). Vibration perceived from steering area (behind_dashboard). No other symptoms mentioned; all other slots null."
extracted_facts:
  speed_band: "specific_mph"
  speed_specific_mph: 65
  onset_timing: "during_driving"
  started_when: "today"
  recent_action: "tire_rotation_or_replacement"
  sound_or_smoke_location_zone: "behind_dashboard"
  drivable_state: "drivable_but_concerned"
  customer_request_type: "diagnose_problem"
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [772, 773, 774, 775, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1630ms · 3867/63t · S2: 2848ch · 1483ms · 1193/68t · S3: 19089ch · 3807ms · 34/303t · Total: 6922ms wall 7343ms · 5094/434t</sub>

### Test 19

```
{
concern: Engine bay smells like burning oil after I drive for like 20 minutes
LLM decision tree:
  step 1 (match category, S1):       matched 'oil_leak_testing'
  step 2 (vagueness check):          passed — description has 68 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'burnt_oil_smell'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [232, 234, 235, 236, 237, 238]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports burning oil smell in engine bay after driving, which directly indicates an oil leak; matches oil_leak_testing service that inspects for leaks and checks for oil residue." · S2: "Customer describes a greasy, hot-petroleum smell from the engine bay after driving, which directly matches the positive example 'Burning oil smell after I drive' and the core definition of burnt oil smell from a leaking gasket onto hot exhaust." · S3: "Customer clearly stated burnt oil smell from under the hood after ~20 minutes of driving (after_warming_up). No other facts were literally stated; all other slots null."
extracted_facts:
  onset_timing: "after_warming_up"
  smell_descriptor: "burnt_oil"
  sound_or_smoke_location_zone: "under_hood"
matched category key: oil_leak_testing
matched sub category slug: burnt_oil_smell
unanswered question ids: [232, 234, 235, 236, 237, 238]
testing service recommended: oil_leak_testing — Oil leak testing ($179.95)
}
```

<sub>S1: 13675ch · 1856ms · 3860/66t · S2: 10670ch · 2166ms · 3252/82t · S3: 19904ch · 3424ms · 27/264t · Total: 7447ms wall 8031ms · 7139/412t</sub>

### Test 20

```
{
concern: Squealing high-pitched noise from the front right wheel when I brake but only sometimes
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 87 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'high_pitched_squealing'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [623, 624, 626, 627, 628, 839]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports squealing noise from front right wheel during braking, a classic brake system symptom; brake_inspection will check pads, rotors, calipers, and lines for wear or damage causing the noise." · S2: "Customer describes 'squealing high-pitched noise' from wheel 'when I brake' — direct match to positive example 'high-pitched squeak from the front wheels when I slow down' and synonym 'high-pitched brake noise.'" · S3: "Customer clearly stated high-pitched squealing from front right wheel when braking, with intermittent occurrence. All other diagnostic factors were not mentioned, so slots remain null."
extracted_facts:
  location_side: "right"
  location_axle: "front"
  onset_timing: "when_braking"
  noise_descriptor: "squealing_high_pitched"
  sound_or_smoke_location_zone: "from_a_wheel"
matched category key: brake_inspection
matched sub category slug: high_pitched_squealing
unanswered question ids: [623, 624, 626, 627, 628, 839]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 13675ch · 1865ms · 3862/71t · S2: 22200ch · 1853ms · 29/82t · S3: 19765ch · 3422ms · 29/267t · Total: 7141ms wall 7584ms · 3920/420t</sub>

### Test 21

```
{
concern: Something just feels off, can't really describe it
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 50 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague ('feels off, can't really describe it') to map to any specific testing service or situation category; advisor handoff recommended." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1476ms · 3854/54t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1476ms wall 1914ms · 3854/54t</sub>

### Test 22

```
{
concern: Car shakes when braking at highway speeds AND the check engine light is on AND it pulls left
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 92 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (extract facts, S3):        extracted 6 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [758, 759, 760, 761, 762, 763, 764]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports three distinct symptoms (brake shaking at highway speeds, check engine light, pulling left) that span multiple systems (brakes, engine, steering/suspension), requiring advisor triage before testing." · S2: "Customer reports three distinct symptoms (shaking while braking, check engine light, pulling left) across different systems—a classic multiple-symptom scenario that matches the 'not sure what category' subcategory." · S3: "Customer stated three clear facts: shaking occurs at highway speeds when braking (speed_band=highway, onset_timing=when_braking), check engine light is on (warning_light_named='check engine', behavior=steady_on), and vehicle pulls left (pull_direction=left). No other details provided; remaining slots null."
extracted_facts:
  speed_band: "highway"
  onset_timing: "when_braking"
  warning_light_named: "check engine"
  warning_light_behavior: "steady_on"
  pull_direction: "left"
  customer_request_type: "diagnose_problem"
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1680ms · 3864/75t · S2: 2872ch · 3052ms · 1192/80t · S3: 19113ch · 3641ms · 31/301t · Total: 8375ms wall 8802ms · 5087/456t</sub>

### Test 23

```
{
concern: It's making a weird noise
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 25 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description 'making a weird noise' is too vague to categorize; could indicate brakes, suspension, engine, or other systems. Needs advisor clarification on noise type, location, and conditions." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1527ms · 3850/66t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1528ms wall 2018ms · 3850/66t</sub>

### Test 24

```
{
concern: I think my transmission is slipping but I'm not really sure
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'low_power_or_wont_accelerate_normally'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: low
  step 8 (reasoning):                S1: "Customer reports suspected transmission slipping, which is a performance concern that maps to transmission_testing; however, 'not really sure' indicates some uncertainty about the actual symptom." · S2: "Transmission slipping typically manifests as sustained loss of power—engine revs high but car barely accelerates—matching the low_power description. However, customer's uncertainty warrants medium confidence pending advisor verification." · S3: "Customer suspects transmission slipping but explicitly stated uncertainty ('not really sure'). No concrete symptoms, speeds, timing, or observable signs were described. Only extractable fact is the request type (diagnose_problem)."
extracted_facts:
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: low_power_or_wont_accelerate_normally
unanswered question ids: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 13675ch · 2663ms · 3857/62t · S2: 11685ch · 2030ms · 3558/76t · S3: 19784ch · 3331ms · 24/266t · Total: 8024ms wall 8533ms · 7439/404t</sub>

### Test 25

```
{
concern: The car just isn't right anymore
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 32 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague ('isn't right anymore') to identify a specific system or symptom; customer would benefit from advisor consultation to clarify the actual concern." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1629ms · 3851/56t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1629ms wall 2117ms · 3851/56t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 17 |
| matched an 'other' subcategory (forward-to-advisor) | 5 |
| null match (forwarded to advisor) | 3 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 44372 ms |
| sum stage-2 latencies | 52526 ms |
| sum stage-3 latencies | 82222 ms |
| sum input tokens | 119396 |
| sum output tokens | 9664 |
| **stage 1** confidence: high / medium / low / missing | 19 / 3 / 3 / 0 |
| **stage 2** confidence: high / medium / low / missing | 20 / 2 / 0 / 3 |
| **stage 3** confidence: high / medium / low / missing | 20 / 1 / 1 / 3 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 25 / 128 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.95 (n=22) |
