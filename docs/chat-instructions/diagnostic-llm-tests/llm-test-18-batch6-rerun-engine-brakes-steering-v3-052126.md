# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T02:43:08.927Z
**Architecture:** three-stage classifier (Stage 1 category → Stage 2 subcategory → Stage 3 fact extraction → deterministic mapper) (refactor 2026-05-21)
**Stage 1 model:** `anthropic/claude-haiku-4-5` (category match — brief catalog)
**Stage 2 model:** `anthropic/claude-haiku-4-5` (subcategory pick — single-category subtree with enriched descriptions + positive/negative examples + synonyms)
**Stage 3 model:** `anthropic/claude-haiku-4-5` (fact extraction — ~29 typed slots; no question text)
**Catalog at test time:** 24 testing services + 6 'other' subcategories = 30 entries
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
concern: My car hesitates when I press the gas pedal especially when accelerating onto the highway
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 89 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'hesitation_or_lag_when_accelerating'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [455, 457, 458, 459, 460, 461]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Hesitation during acceleration suggests a performance/drivability issue likely related to fuel, ignition, or sensor faults that would be revealed by scanning for trouble codes and monitoring live data." · S2: "Customer describes a momentary pause when pressing the gas pedal during acceleration onto the highway, matching the positive example 'hesitates for a second when I step on it to merge onto the highway' and the core definition of a brief delay before engine response." · S3: "Customer clearly stated hesitation when pressing the gas pedal during highway acceleration. Set speed_band to highway, onset_timing to when_accelerating, and customer_request_type to diagnose_problem. All other slots null as no other details were provided."
extracted_facts:
  speed_band: "highway"
  onset_timing: "when_accelerating"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: hesitation_or_lag_when_accelerating
unanswered question ids: [455, 457, 458, 459, 460, 461]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 2219ms · 30/69t · S2: 42816ch · 2124ms · 30/89t · S3: 19731ch · 4254ms · 30/280t · Total: 8598ms wall 9204ms · 90/438t</sub>

### Test 2

```
{
concern: Loud popping sound from under the hood when I accelerate hard
LLM decision tree:
  step 1 (match category, S1):       matched 'exhaust_system_testing'
  step 2 (vagueness check):          passed — description has 61 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'exhaust_manifold_tick_or_puff'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=0 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Loud popping under hood during hard acceleration suggests exhaust manifold gasket leak or backfire; exhaust_system_testing covers manifold ticking/popping. Could also be engine knock (check_engine_light_testing), making medium confidence appropriate." · S2: "Popping from under the hood during acceleration suggests an exhaust manifold leak; however, 'popping' is not a primary synonym (tick/puff/chuff are). Medium confidence due to partial fit with engine-bay exhaust symptoms." · S3: "Customer clearly stated loud popping from under the hood during hard acceleration. Extracted noise_descriptor, location_axle (front/engine area), onset_timing, and sound_or_smoke_location_zone. All other facts not mentioned."
extracted_facts:
  location_axle: "front"
  onset_timing: "when_accelerating"
  noise_descriptor: "popping_or_clicking"
  sound_or_smoke_location_zone: "under_hood"
matched category key: exhaust_system_testing
matched sub category slug: exhaust_manifold_tick_or_puff
unanswered question ids: []
testing service recommended: exhaust_system_testing — Exhaust system evaluation ($39.99)
}
```

<sub>S1: 16280ch · 2075ms · 25/84t · S2: 10596ch · 2186ms · 3422/90t · S3: 19906ch · 3607ms · 25/281t · Total: 7868ms wall 8663ms · 3472/455t</sub>

### Test 3

```
{
concern: Engine sounds like a sewing machine when idling
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 47 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'engine_ticking_or_tapping'
  step 4 (extract facts, S3):        extracted 7 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [72, 73, 74, 75]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Engine noise at idle ('sewing machine' sound) suggests a performance or sensor issue; check_engine_light_testing will scan for codes and monitor live data to identify the cause." · S2: "Customer's 'sewing machine' sound is a direct positive example match for engine_ticking_or_tapping, describing light rapid tapping from the upper engine tied to camshaft speed." · S3: "Customer explicitly described a sewing-machine sound (classic ticking_or_tapping descriptor) occurring at idle under the hood. Set engine_running to rough_idle since the noise indicates abnormal idle behavior. All other slots null as no other details were stated."
extracted_facts:
  location_axle: "front"
  speed_band: "idle"
  onset_timing: "when_idling"
  noise_descriptor: "ticking_or_tapping"
  engine_running: "rough_idle"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: engine_ticking_or_tapping
unanswered question ids: [72, 73, 74, 75]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1520ms · 21/68t · S2: 42816ch · 1741ms · 21/76t · S3: 19668ch · 3698ms · 21/291t · Total: 6959ms wall 7416ms · 63/435t</sub>

### Test 4

```
{
concern: Car shudders and stalls at red lights
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'stalling_at_idle_or_when_stopping'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [470, 471, 473, 475]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Stalling and shuddering suggest engine performance issues (fuel, spark, or idle control), which check_engine_light_testing diagnoses via codes and live data; suspension/brake issues are less likely given the red-light stalling pattern." · S2: "Customer reports engine dying at red lights (stalling at idle), which matches the subcategory description. The shuddering suggests rough running before stall, but the primary complaint is the stall itself, not just roughness." · S3: "Customer clearly stated the car shudders and stalls when stopped at red lights. Extracted speed_band=stopped, onset_timing=at_stop, and engine_running=stalls as literal matches. No other details provided."
extracted_facts:
  speed_band: "stopped"
  onset_timing: "at_stop"
  engine_running: "stalls"
matched category key: check_engine_light_testing
matched sub category slug: stalling_at_idle_or_when_stopping
unanswered question ids: [470, 471, 473, 475]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1808ms · 21/82t · S2: 42816ch · 1935ms · 21/84t · S3: 19727ch · 3417ms · 21/272t · Total: 7161ms wall 7557ms · 63/438t</sub>

### Test 5

```
{
concern: Engine makes a ticking noise that gets faster when I rev
LLM decision tree:
  step 1 (match category, S1):       matched 'exhaust_system_testing'
  step 2 (vagueness check):          passed — description has 56 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'exhaust_manifold_tick_or_puff'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=0 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Ticking noise that increases with engine speed suggests exhaust manifold gasket leak (classic symptom), though valve train noise is also possible; exhaust_system_testing covers manifold gasket ticking specifically." · S2: "Customer describes a rhythmic ticking that follows engine RPM (gets faster when revved), matching the exhaust_manifold_tick_or_puff positive example 'Sharp chuff-chuff-chuff from under the hood' and core description of RPM-dependent tick." · S3: "Customer clearly stated a ticking noise from the engine that increases with acceleration (RPM). Extracted noise_descriptor, onset_timing, and sound_or_smoke_location_zone. No other facts literally stated."
extracted_facts:
  onset_timing: "when_accelerating"
  noise_descriptor: "ticking_or_tapping"
  sound_or_smoke_location_zone: "under_hood"
matched category key: exhaust_system_testing
matched sub category slug: exhaust_manifold_tick_or_puff
unanswered question ids: []
testing service recommended: exhaust_system_testing — Exhaust system evaluation ($39.99)
}
```

<sub>S1: 16280ch · 2021ms · 23/74t · S2: 10596ch · 1937ms · 3420/98t · S3: 19906ch · 3893ms · 23/276t · Total: 7852ms wall 8328ms · 3466/448t</sub>

### Test 6

```
{
concern: Squealing belt noise when I first start the car in the morning
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 62 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'high_pitched_whining_under_the_hood'
  step 4 (extract facts, S3):        extracted 8 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [92, 93, 96, 97, 98]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Squealing belt noise on cold start suggests a serpentine belt issue, often related to alternator/charging system tension or wear; charging_starting_testing includes belt inspection as part of the diagnostic scope." · S2: "Customer describes 'squealing belt noise' from engine startup, matching the positive example 'Belt squealing first thing in the morning when it's cold' and the synonym 'belt squeal' in the high-pitched whining subcategory." · S3: "Customer clearly stated squealing noise at cold start (morning), under the hood, at idle. Inferred front axle (engine bay) and cold_weather from 'morning start' context. All other slots null as not mentioned."
extracted_facts:
  location_axle: "front"
  speed_band: "idle"
  onset_timing: "cold_start"
  noise_descriptor: "squealing_high_pitched"
  engine_running: "normal"
  weather_condition: "cold_weather"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: charging_starting_testing
matched sub category slug: high_pitched_whining_under_the_hood
unanswered question ids: [92, 93, 96, 97, 98]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 16280ch · 1755ms · 25/71t · S2: 16833ch · 1839ms · 25/89t · S3: 19900ch · 3919ms · 25/283t · Total: 7514ms wall 7992ms · 75/443t</sub>

### Test 7

```
{
concern: Coolant leaking out from underneath my engine bay
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'green_orange_yellow_or_pink_puddle_coolant'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [987, 988, 990, 991, 992]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports coolant leaking from underneath engine bay—a clear cooling-system concern matching coolant_leak_testing scope (puddles of coolant under the car)." · S2: "Customer reports coolant leaking from underneath the engine bay, which directly matches the positive example 'Bright green puddle right under the front of my car' and the core description of a brightly colored puddle under the radiator area." · S3: "Customer explicitly stated coolant leaking from underneath engine bay. Set fluid_color to green_or_orange_or_yellow_or_pink (coolant), location_axle to front (engine area), fluid_under_car_location to under_engine_front, and sound_or_smoke_location_zone to under_hood. No other details provided; remaining slots null."
extracted_facts:
  location_axle: "front"
  fluid_color: "green_or_orange_or_yellow_or_pink"
  fluid_under_car_location: "under_engine_front"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: coolant_leak_testing
matched sub category slug: green_orange_yellow_or_pink_puddle_coolant
unanswered question ids: [987, 988, 990, 991, 992]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 16280ch · 1548ms · 22/64t · S2: 16745ch · 1805ms · 22/90t · S3: 19742ch · 3514ms · 22/323t · Total: 6868ms wall 7282ms · 66/477t</sub>

### Test 8

```
{
concern: Engine overheats when sitting in traffic for too long
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'engine_temperature_light'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [399, 400, 401, 402, 403, 404, 405]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports engine overheating in traffic, a classic cooling-system concern that maps directly to coolant_leak_testing (overheating, fan operation, thermostat function verification)." · S2: "Customer reports engine overheating in traffic, a classic symptom of coolant system failure. While 'engine_temperature_light' best captures the overheating scenario, the description lacks mention of a visible warning light or smoke, making 'medium' confidence appropriate for downstream verification." · S3: "Customer clearly stated overheating occurs when stopped in traffic (speed_band=stopped, onset_timing=at_stop). No other symptoms, timing, or contextual details were mentioned; all other slots remain null."
extracted_facts:
  speed_band: "stopped"
  onset_timing: "at_stop"
  customer_request_type: "diagnose_problem"
matched category key: coolant_leak_testing
matched sub category slug: engine_temperature_light
unanswered question ids: [399, 400, 401, 402, 403, 404, 405]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 16280ch · 1817ms · 22/68t · S2: 16745ch · 1952ms · 22/89t · S3: 19993ch · 3437ms · 22/270t · Total: 7208ms wall 7700ms · 66/427t</sub>

### Test 9

```
{
concern: Brake pedal pulses when I'm slowing down from highway speeds
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'pulsating_or_vibrating_pedal'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [649, 651, 652, 653, 864]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer describes brake pedal pulsing during highway deceleration, a classic symptom of ABS activation or rotor issues—both inspected under brake_inspection service." · S2: "Customer describes brake pedal pulsing when slowing from highway speed, which is a verbatim positive example and core symptom of warped rotors (DTV) — matches pulsating_or_vibrating_pedal description exactly." · S3: "Customer clearly stated brake pedal pulses during braking from highway speeds. Extracted pedal_feel=pulsating, onset_timing=when_braking, speed_band=highway. No other details provided; all other slots null."
extracted_facts:
  speed_band: "highway"
  onset_timing: "when_braking"
  pedal_feel: "pulsating"
matched category key: brake_inspection
matched sub category slug: pulsating_or_vibrating_pedal
unanswered question ids: [649, 651, 652, 653, 864]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 16280ch · 1763ms · 26/62t · S2: 22200ch · 1663ms · 26/88t · S3: 19853ch · 3404ms · 26/276t · Total: 6831ms wall 7401ms · 78/426t</sub>

### Test 10

```
{
concern: My brakes are grinding really bad now
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'metallic_grinding'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [630, 631, 632, 633, 634, 635, 636]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports 'grinding' brakes, a clear sign of worn brake pads or rotor damage; brake_inspection directly addresses this concern." · S2: "Customer's phrase "grinding really bad now" is a direct match to the metallic_grinding positive example "Loud grinding noise every time I push the brake pedal" and the synonym "grinding."" · S3: "Customer clearly stated 'grinding' noise when braking, so noise_descriptor and onset_timing are solid. Inferred sound_or_smoke_location_zone as 'from_a_wheel' (grinding brakes originate at wheels) and customer_request_type as 'diagnose_problem' (implied by 'really bad now'). Side, axle, and severity details not stated, so left null."
extracted_facts:
  onset_timing: "when_braking"
  noise_descriptor: "grinding_metallic"
  sound_or_smoke_location_zone: "from_a_wheel"
  customer_request_type: "diagnose_problem"
matched category key: brake_inspection
matched sub category slug: metallic_grinding
unanswered question ids: [630, 631, 632, 633, 634, 635, 636]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 16280ch · 1405ms · 19/56t · S2: 22200ch · 1998ms · 19/71t · S3: 19836ch · 3621ms · 19/325t · Total: 7025ms wall 7479ms · 57/452t</sub>

### Test 11

```
{
concern: I can feel a vibration in the steering wheel only when I brake at highway speeds
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 80 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'vibration_or_pulsing_when_braking'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [149, 151, 152, 153, 154]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports vibration in steering wheel only when braking at highway speeds, which is a classic brake-rotor or caliper issue — not suspension. Matches brake_inspection scope directly." · S2: "Customer describes steering wheel vibration triggered by braking at highway speeds, matching the positive example 'Steering wheel and the seat both vibrate hard when I press the brakes' and the synonym 'steering wheel shake when braking,' indicating warped rotors or uneven rotor thickness." · S3: "Customer clearly stated vibration in steering wheel (sound_or_smoke_location_zone=behind_dashboard) triggered only when braking (onset_timing=when_braking) at highway speeds (speed_band=highway). No other facts literally stated."
extracted_facts:
  speed_band: "highway"
  onset_timing: "when_braking"
  sound_or_smoke_location_zone: "behind_dashboard"
matched category key: brake_inspection
matched sub category slug: vibration_or_pulsing_when_braking
unanswered question ids: [149, 151, 152, 153, 154]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 16280ch · 1696ms · 28/65t · S2: 22200ch · 2103ms · 28/99t · S3: 19956ch · 3190ms · 28/279t · Total: 6990ms wall 7379ms · 84/443t</sub>

### Test 12

```
{
concern: Car bounces a lot over bumps now and the steering feels loose
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 61 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'shaking_or_bouncing_over_bumps_and_rough_roads'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [169, 170, 171, 172, 173, 174, 175]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports bouncing over bumps and loose steering—classic suspension and steering symptoms that map directly to suspension_steering_check inspection of joints, tie rods, control arms, and steering response." · S2: "Customer reports bouncing over bumps (primary symptom matching 'bounces' and 'rough ride'), but also mentions loose steering feel, which could suggest wandering_or_drifting_in_both_directions. Chose bouncing subcategory as the lead complaint, though loose steering warrants verification." · S3: "Customer clearly stated bouncing over bumps (onset_timing) and loose steering feel. No other specifics (location, speed, timing of onset, recent work) were mentioned, so remaining slots are null."
extracted_facts:
  onset_timing: "over_bumps"
  steering_feel: "loose_or_sloppy"
matched category key: suspension_steering_check
matched sub category slug: shaking_or_bouncing_over_bumps_and_rough_roads
unanswered question ids: [169, 170, 171, 172, 173, 174, 175]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 16280ch · 1803ms · 25/68t · S2: 44059ch · 2702ms · 25/110t · S3: 19962ch · 9594ms · 25/272t · Total: 14102ms wall 14598ms · 75/450t</sub>

### Test 13

```
{
concern: There's a clunking sound from the front end going over bumps
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'clunking_over_bumps'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [78, 80, 81, 82, 83, 84]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports 'clunking sound from the front end going over bumps,' which directly indicates suspension component wear or looseness — a core suspension_steering_check concern." · S2: "Customer describes 'clunking sound from the front end going over bumps' — a direct match to the positive example 'Big clunk from the front whenever I hit a pothole' and the core definition of metallic impact triggered by bumps." · S3: "Customer clearly stated a clunking noise from the front end triggered by bumps. No other details provided (side, speed, duration, etc.), so remaining slots are null."
extracted_facts:
  location_axle: "front"
  onset_timing: "over_bumps"
  noise_descriptor: "clunking"
  sound_or_smoke_location_zone: "under_car"
matched category key: suspension_steering_check
matched sub category slug: clunking_over_bumps
unanswered question ids: [78, 80, 81, 82, 83, 84]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 16280ch · 1552ms · 26/64t · S2: 44059ch · 1823ms · 26/86t · S3: 19852ch · 3715ms · 26/263t · Total: 7091ms wall 7619ms · 78/413t</sub>

### Test 14

```
{
concern: Power steering pump is making a whining noise especially when I turn
LLM decision tree:
  step 1 (match category, S1):       matched 'power_steering_eps_testing'
  step 2 (vagueness check):          passed — description has 68 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'noise_when_turning_the_steering_wheel'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [682, 683, 684, 686, 687]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports whining noise from power steering pump during turns, which directly indicates power steering system diagnosis per the EPS testing service scope." · S2: "Customer explicitly describes a whining noise from the power steering pump that occurs when turning—a direct match to the positive example 'Loud whine when I turn the wheel' and the synonym 'power steering whine.'" · S3: "Customer explicitly stated power steering pump whining noise when turning. Extracted onset_timing=when_turning, noise_descriptor=whining, sound_or_smoke_location_zone=under_hood (pump location). No other details provided; remaining slots null."
extracted_facts:
  onset_timing: "when_turning"
  noise_descriptor: "whining"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: power_steering_eps_testing
matched sub category slug: noise_when_turning_the_steering_wheel
unanswered question ids: [682, 683, 684, 686, 687]
testing service recommended: power_steering_eps_testing — Power steering / EPS testing ($179.95)
}
```

<sub>S1: 16280ch · 1472ms · 24/57t · S2: 11921ch · 2078ms · 3548/82t · S3: 19912ch · 3288ms · 24/283t · Total: 6838ms wall 7328ms · 3596/422t</sub>

### Test 15

```
{
concern: Car has a slight pull to the left when accelerating but not braking
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 67 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'pulling_only_during_acceleration'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [198, 199, 200, 201, 202, 203]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Pull to the left during acceleration suggests suspension/steering alignment or component wear rather than brakes; suspension_steering_check covers pulling concerns and related diagnostics." · S2: "Customer describes pull to one side ONLY when accelerating, which matches the positive example 'Pulls hard to the right when I step on the gas' and the core definition of torque steer during throttle application." · S3: "Customer clearly stated pull occurs only during acceleration (when_accelerating) and pulls left (pull_direction). No speed, location, or other details provided; all other slots null."
extracted_facts:
  onset_timing: "when_accelerating"
  pull_direction: "left"
matched category key: suspension_steering_check
matched sub category slug: pulling_only_during_acceleration
unanswered question ids: [198, 199, 200, 201, 202, 203]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 16280ch · 1600ms · 26/60t · S2: 44059ch · 2189ms · 26/78t · S3: 19723ch · 3340ms · 26/260t · Total: 7131ms wall 7631ms · 78/398t</sub>

### Test 16

```
{
concern: Rumbling noise from under the car that gets louder as I speed up
LLM decision tree:
  step 1 (match category, S1):       matched 'exhaust_system_testing'
  step 2 (vagueness check):          passed — description has 64 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'exhaust_louder_or_rumbling'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=0 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Rumbling noise from under the car that increases with speed suggests exhaust system issue (loose muffler, catalytic converter rattle, or exhaust leak), though suspension/drivetrain concerns are also possible." · S2: "Customer describes a rumbling noise from under the car that increases with speed, matching the positive example 'Deep rumble underneath, way louder than it used to be' and the core description of exhaust rumble/drone." · S3: "Customer clearly stated a rumbling noise from under the car that increases with speed. Extracted: noise_descriptor=roaring (deep rumble from underneath), sound_or_smoke_location_zone=under_car, onset_timing=during_driving, speed_band=all_speeds (occurs as speed increases). No side, axle, or other details provided."
extracted_facts:
  speed_band: "all_speeds"
  onset_timing: "during_driving"
  noise_descriptor: "roaring"
  sound_or_smoke_location_zone: "under_car"
matched category key: exhaust_system_testing
matched sub category slug: exhaust_louder_or_rumbling
unanswered question ids: []
testing service recommended: exhaust_system_testing — Exhaust system evaluation ($39.99)
}
```

<sub>S1: 16280ch · 1970ms · 27/74t · S2: 10596ch · 1843ms · 3424/82t · S3: 19829ch · 3484ms · 27/305t · Total: 7298ms wall 7782ms · 3478/461t</sub>

### Test 17

```
{
concern: Steering wheel is slightly off center when driving straight
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'steering_wheel_off_center_when_driving_straight'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [675, 676, 677, 678, 679, 680]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports steering wheel off-center when driving straight, a classic alignment or suspension/steering component wear issue that suspension_steering_check directly addresses via inspection and road test." · S2: "Customer's description matches the subcategory definition exactly: steering wheel is visibly tilted/off-center while the car drives straight, a cosmetic wheel-position issue distinct from pulling or loose steering feel." · S3: "Customer explicitly stated steering wheel is off-center while driving straight, matching the subcategory definition. No other facts were literally stated; onset_timing inferred as 'during_driving' since off-center wheel is observed while driving."
extracted_facts:
  onset_timing: "during_driving"
  steering_feel: "wheel_off_center_while_straight"
matched category key: suspension_steering_check
matched sub category slug: steering_wheel_off_center_when_driving_straight
unanswered question ids: [675, 676, 677, 678, 679, 680]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 16280ch · 1696ms · 21/63t · S2: 44059ch · 1770ms · 21/81t · S3: 19878ch · 3606ms · 21/279t · Total: 7073ms wall 7484ms · 63/423t</sub>

### Test 18

```
{
concern: Front passenger tire keeps losing pressure but I cant find a hole
LLM decision tree:
  step 1 (match category, S1):       matched 'tpms_testing'
  step 2 (vagueness check):          passed — description has 65 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'tire_going_flat_losing_air'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [717, 718, 719, 720, 722]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports tire losing pressure without visible damage; TPMS testing will check sensor function, battery status, and pressure readings to diagnose the leak source or sensor fault." · S2: "Customer describes a tire losing pressure over time with no visible damage identified—matches 'tire going flat / losing air' positive example 'One of my tires is slowly losing air' and the core air-loss framing without named visible cause." · S3: "Customer explicitly stated front passenger tire (right, front) is losing pressure repeatedly with no visible damage found. Matches tire_going_flat_losing_air subcategory. All other facts not mentioned."
extracted_facts:
  location_side: "right"
  location_axle: "front"
  tire_state: "low_pressure"
  customer_request_type: "diagnose_problem"
matched category key: tpms_testing
matched sub category slug: tire_going_flat_losing_air
unanswered question ids: [717, 718, 719, 720, 722]
testing service recommended: tpms_testing — Tire pressure (TPMS) light testing ($39.99)
}
```

<sub>S1: 16280ch · 3259ms · 23/63t · S2: 13580ch · 2017ms · 4105/85t · S3: 19865ch · 3527ms · 23/267t · Total: 8805ms wall 9236ms · 4151/415t</sub>

### Test 19

```
{
concern: Burning rubber smell after a long drive
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Burning rubber smell is too vague to categorize—could indicate brake overheating, tire friction, belt slippage, or exhaust contact; needs advisor handoff for clarification." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1511ms · 19/63t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1511ms wall 2037ms · 19/63t</sub>

### Test 20

```
{
concern: Strange chemical smell coming through the vents
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 47 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'bad_smell_from_vents'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [966, 967, 968, 969, 970, 971]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports 'strange chemical smell coming through the vents,' which maps to HVAC vent-side concerns; ac_performance_check includes inspection for musty/unusual smells from vents, though 'chemical' is less typical than musty and could warrant advisor clarification." · S2: "Customer reports a chemical smell from the vents, which matches the 'bad_smell_from_vents' description of unpleasant odor tied to vent airflow; chemical odors (burning electrical, plastic, or antifreeze) are explicitly covered as vent-routed smell causes." · S3: "Customer clearly stated smell comes through vents (from_vents) and described it as 'chemical' (not musty, sweet, or burning oil—mapped to other_burning as closest fit). No HVAC mode, timing, or other context provided; hvac_mode left null since customer didn't specify AC vs heat."
extracted_facts:
  smell_descriptor: "other_burning"
  sound_or_smoke_location_zone: "from_vents"
matched category key: ac_performance_check
matched sub category slug: bad_smell_from_vents
unanswered question ids: [966, 967, 968, 969, 970, 971]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 16280ch · 2696ms · 19/89t · S2: 19980ch · 2086ms · 19/98t · S3: 20014ch · 3760ms · 19/295t · Total: 8542ms wall 9020ms · 57/482t</sub>

### Test 21

```
{
concern: Air conditioning takes forever to get cold after starting the car
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 65 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'ac_is_weak_not_cold_enough'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [574, 575, 576, 577, 578, 579, 580]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports A/C cooling performance issue ('takes forever to get cold'), which directly maps to ac_performance_check scope of AC cooling and vent-side HVAC complaints." · S2: "Customer reports AC cooling delay ('takes forever to get cold'), which aligns with weak/partial cooling and slow-to-cool patterns. However, the description doesn't clarify if cooling eventually reaches acceptable levels or remains inadequate, creating ambiguity between weak cooling and a potential compressor engagement issue." · S3: "Customer clearly stated AC is on at startup and takes a long time to reach cold temperature. Set hvac_mode=ac, onset_timing=at_startup, and customer_request_type=diagnose_problem. No other facts literally stated."
extracted_facts:
  onset_timing: "at_startup"
  hvac_mode: "ac"
  customer_request_type: "diagnose_problem"
matched category key: ac_performance_check
matched sub category slug: ac_is_weak_not_cold_enough
unanswered question ids: [574, 575, 576, 577, 578, 579, 580]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 16280ch · 1847ms · 22/66t · S2: 19980ch · 2604ms · 22/98t · S3: 19938ch · 3921ms · 22/277t · Total: 8372ms wall 8870ms · 66/441t</sub>

### Test 22

```
{
concern: Heater blows cold air on the highway but warms up at stoplights
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 63 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'heat_doesnt_work'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [937, 939, 940, 941, 943]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: high
  step 8 (reasoning):                S1: "Heater blowing cold air suggests low coolant or thermostat issue; behavior changes with engine load/RPM, classic coolant-system concern per catalog scope." · S2: "Customer reports heater producing cold air (matching 'heater blows cold'), though the conditional behavior (cold on highway, warm at stoplights) suggests a thermostat or blend-door issue rather than complete heater failure, making this a medium-confidence match to heat_doesnt_work." · S3: "Customer clearly stated heater blows cold at highway speeds but warms up at stoplights (idle). This is a classic thermostat or blend-door issue tied to engine load/RPM. Extracted hvac_mode=heat, speed_band=highway, onset_timing=during_driving, and airflow_state=strong_normal (air comes out, just cold). No other facts literally stated."
extracted_facts:
  speed_band: "highway"
  onset_timing: "during_driving"
  hvac_mode: "heat"
  airflow_state: "strong_normal"
  customer_request_type: "diagnose_problem"
matched category key: coolant_leak_testing
matched sub category slug: heat_doesnt_work
unanswered question ids: [937, 939, 940, 941, 943]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 16280ch · 1641ms · 29/65t · S2: 16745ch · 1985ms · 29/95t · S3: 19999ch · 3899ms · 29/315t · Total: 7526ms wall 7984ms · 87/475t</sub>

### Test 23

```
{
concern: Defroster doesn't really work anymore
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'foggy_or_hard_to_defog_windows'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [595, 596, 597, 598, 599, 600, 601]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: medium
  step 8 (reasoning):                S1: "Defroster is part of the HVAC system's heating/cooling function; AC performance check covers blower, mode, and vent-side HVAC complaints including weak airflow and heating issues." · S2: "Customer reports defroster not working effectively, matching the positive example 'Defrost vents don't blow much air on the windshield' and the core description of defroster failing to clear windows." · S3: "Customer clearly stated defrost mode is not working ('doesn't really work anymore'), so hvac_mode=defrost and customer_request_type=diagnose_problem are solid. However, no details on airflow strength, fog persistence, location, or onset timing—all left null to avoid inference."
extracted_facts:
  hvac_mode: "defrost"
  customer_request_type: "diagnose_problem"
matched category key: ac_performance_check
matched sub category slug: foggy_or_hard_to_defog_windows
unanswered question ids: [595, 596, 597, 598, 599, 600, 601]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 16280ch · 1975ms · 20/67t · S2: 19980ch · 1866ms · 20/82t · S3: 20046ch · 3542ms · 20/287t · Total: 7384ms wall 7832ms · 60/436t</sub>

### Test 24

```
{
concern: Exhaust sounds louder than normal lately
LLM decision tree:
  step 1 (match category, S1):       matched 'exhaust_system_testing'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'exhaust_louder_or_rumbling'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=0 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports 'exhaust sounds louder than normal,' which directly matches exhaust_system_testing scope for louder-than-normal exhaust sound diagnosis." · S2: "Customer's "exhaust sounds louder than normal" directly matches the positive example "My exhaust got really loud all of a sudden" and the subcategory's core description of a louder-than-it-used-to-be exhaust note." · S3: "Customer stated exhaust is louder than normal, which maps to roaring noise from tailpipe. However, no details on speed, timing, onset duration, or whether accompanied by smell/smoke—most slots remain null. Inferred diagnose_problem as implicit request type."
extracted_facts:
  noise_descriptor: "roaring"
  sound_or_smoke_location_zone: "from_tailpipe"
  customer_request_type: "diagnose_problem"
matched category key: exhaust_system_testing
matched sub category slug: exhaust_louder_or_rumbling
unanswered question ids: []
testing service recommended: exhaust_system_testing — Exhaust system evaluation ($39.99)
}
```

<sub>S1: 16280ch · 1549ms · 20/63t · S2: 10596ch · 1985ms · 3417/89t · S3: 19829ch · 3774ms · 20/286t · Total: 7309ms wall 7835ms · 3457/438t</sub>

### Test 25

```
{
concern: Hood is hard to close and there's a squeaking when I drive
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 58 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description mentions hood closure difficulty and squeaking while driving, but these symptoms don't clearly map to any single testing service—hood latch is mechanical/body work, and squeaking could be suspension, belts, brakes, or HVAC. Advisor handoff recommended." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 3135ms · 25/80t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 3135ms wall 3714ms · 25/80t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 23 |
| matched an 'other' subcategory (forward-to-advisor) | 0 |
| null match (forwarded to advisor) | 2 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 47333 ms |
| sum stage-2 latencies | 46231 ms |
| sum stage-3 latencies | 89404 ms |
| sum input tokens | 22870 |
| sum output tokens | 10279 |
| **stage 1** confidence: high / medium / low / missing | 12 / 11 / 2 / 0 |
| **stage 2** confidence: high / medium / low / missing | 17 / 6 / 0 / 2 |
| **stage 3** confidence: high / medium / low / missing | 19 / 4 / 0 / 2 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 24 / 108 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.61 (n=23) |
