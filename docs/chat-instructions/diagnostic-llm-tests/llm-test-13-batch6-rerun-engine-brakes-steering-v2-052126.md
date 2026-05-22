# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T01:36:17.823Z
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
concern: My car hesitates when I press the gas pedal especially when accelerating onto the highway
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 89 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'hesitation_or_lag_when_accelerating'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [455, 457, 458, 459, 460, 461]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Hesitation during acceleration suggests a performance issue that could stem from engine management faults; check engine light testing will scan for trouble codes and verify sensor/system performance to diagnose the root cause." · S2: "Customer describes a delay between pressing gas and engine response during acceleration onto highway, matching the positive example 'hesitates for a second when I step on it to merge onto the highway' and the core definition of momentary pause before catching." · S3: "Customer clearly stated hesitation when pressing the gas pedal during highway acceleration. Set speed_band to highway, onset_timing to when_accelerating, and customer_request_type to diagnose_problem. All other slots null as no other details were provided."
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

<sub>S1: 13675ch · 2101ms · 3863/70t · S2: 42816ch · 5153ms · 30/85t · S3: 19731ch · 3641ms · 30/280t · Total: 10898ms wall 11973ms · 3923/435t</sub>

### Test 2

```
{
concern: Loud popping sound from under the hood when I accelerate hard
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 61 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     153 unanswered IDs: [71, 72, 73, 74, 75, 76, 77, 106, 107, 108, 109, 110, 111, 112, 120, 121, 122, 123, 124, 125, 126, 155, 156, 157, 158, 159, 160, 161, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 372, 373, 374, 375, 376, 377, 378, 399, 400, 401, 402, 403, 404, 405, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 511, 512, 513, 514, 515, 516, 517, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 2219, 2220, 2221, 2222, 2223, 2224]
  step 7 (confidence per stage):     S1: medium · S2: low · S3: high
  step 8 (reasoning):                S1: "Loud popping under hood during hard acceleration suggests engine performance issue (backfire, detonation, or ignition fault); check engine light testing will scan for related codes and verify sensor/system performance." · S2: "Customer reports loud popping under hood during hard acceleration—not a clear match for any listed subcategory. Popping could indicate backfire, exhaust leak, or ignition issue, but none of the 30 subcategories specifically cover this symptom. Recommend Stage 3 advisor review." · S3: "Customer clearly stated loud popping from under the hood when accelerating hard. Extracted noise_descriptor, location_axle (front/engine area), onset_timing, and sound_or_smoke_location_zone. No other details provided."
extracted_facts:
  location_axle: "front"
  onset_timing: "when_accelerating"
  noise_descriptor: "popping_or_clicking"
  sound_or_smoke_location_zone: "under_hood"
matched category key: check_engine_light_testing
matched sub category slug: null
unanswered question ids: [71, 72, 73, 74, 75, 76, 77, 106, 107, 108, 109, 110, 111, 112, 120, 121, 122, 123, 124, 125, 126, 155, 156, 157, 158, 159, 160, 161, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 372, 373, 374, 375, 376, 377, 378, 399, 400, 401, 402, 403, 404, 405, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 511, 512, 513, 514, 515, 516, 517, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 2219, 2220, 2221, 2222, 2223, 2224]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1831ms · 3858/72t · S2: 42816ch · 5084ms · 25/89t · S3: 18784ch · 3728ms · 25/281t · Total: 10643ms wall 11215ms · 3908/442t</sub>

### Test 3

```
{
concern: Engine sounds like a sewing machine when idling
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 47 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'engine_ticking_or_tapping'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [72, 73, 74, 75]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Engine noise at idle ('sounds like a sewing machine') suggests a performance or sensor issue; check engine light testing covers diagnostic scanning and live data review to identify the root cause." · S2: "Customer's "sewing machine" sound at idle is a direct positive example match for engine_ticking_or_tapping, which explicitly lists "Engine sounds like a sewing machine when I first start it in the morning" as a key indicator." · S3: "Customer clearly described a sewing-machine sound (canonical ticking_or_tapping) occurring at idle. No other facts were literally stated; all other slots null."
extracted_facts:
  speed_band: "idle"
  onset_timing: "when_idling"
  noise_descriptor: "ticking_or_tapping"
  sound_or_smoke_location_zone: "under_hood"
matched category key: check_engine_light_testing
matched sub category slug: engine_ticking_or_tapping
unanswered question ids: [72, 73, 74, 75]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1621ms · 3854/66t · S2: 42816ch · 1705ms · 21/86t · S3: 19668ch · 3883ms · 21/266t · Total: 7212ms wall 7780ms · 3896/418t</sub>

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
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Shuddering and stalling at idle suggests engine performance issues (fuel, ignition, or sensor faults) best diagnosed via check engine light testing and trouble code scan." · S2: "Customer reports engine dying at red lights (stalls at idle/when stopping), matching positive example 'Engine dies every time I come to a stop at a red light' and core description of engine shutting off while stopped." · S3: "Customer clearly stated the car shudders and stalls when stopped at red lights. Extracted speed_band=stopped, onset_timing=at_stop, and engine_running=stalls as literal matches. No other details provided."
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

<sub>S1: 13675ch · 1633ms · 3854/66t · S2: 42816ch · 1904ms · 21/83t · S3: 19727ch · 3266ms · 21/272t · Total: 6804ms wall 7281ms · 3896/421t</sub>

### Test 5

```
{
concern: Engine makes a ticking noise that gets faster when I rev
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 56 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'engine_ticking_or_tapping'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [72, 73, 74, 75]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Engine ticking that increases with RPM suggests potential internal engine issues (valve train, knock sensor, carbon buildup) best diagnosed via code scan and live data monitoring, though a general noise inspection could also apply." · S2: "Customer describes a ticking noise that speeds up with engine RPM—a classic match for valvetrain/lifter tick. Positive example 'Light ticking from the top of the engine that speeds up when I press the gas' directly parallels the symptom." · S3: "Customer clearly described a ticking noise from the engine that increases with throttle input. Extracted noise_descriptor, onset_timing (when accelerating/revving), and sound_or_smoke_location_zone (under hood). No other facts literally stated."
extracted_facts:
  onset_timing: "when_accelerating"
  noise_descriptor: "ticking_or_tapping"
  sound_or_smoke_location_zone: "under_hood"
matched category key: check_engine_light_testing
matched sub category slug: engine_ticking_or_tapping
unanswered question ids: [72, 73, 74, 75]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 2796ms · 3856/73t · S2: 42816ch · 4475ms · 23/90t · S3: 19668ch · 3461ms · 23/285t · Total: 10734ms wall 11316ms · 3902/448t</sub>

### Test 6

```
{
concern: Squealing belt noise when I first start the car in the morning
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 62 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'high_pitched_whining_under_the_hood'
  step 4 (extract facts, S3):        extracted 7 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [92, 93, 96, 97, 98]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Squealing belt noise on cold start suggests a serpentine belt issue, often related to alternator/charging system tension or wear; charging_starting_testing includes belt inspection and alternator diagnostics." · S2: "Customer describes 'squealing belt noise' from engine startup, matching the positive example 'Belt squealing first thing in the morning when it's cold' and the synonym 'belt squeal'." · S3: "Customer clearly stated squealing noise at cold start (morning), under the hood, at idle. Belt squeal is a literal match to squealing_high_pitched. Cold morning implies cold_weather. No other symptoms mentioned."
extracted_facts:
  location_axle: "front"
  speed_band: "idle"
  onset_timing: "cold_start"
  noise_descriptor: "squealing_high_pitched"
  engine_running: "normal"
  weather_condition: "cold_weather"
  sound_or_smoke_location_zone: "under_hood"
matched category key: charging_starting_testing
matched sub category slug: high_pitched_whining_under_the_hood
unanswered question ids: [92, 93, 96, 97, 98]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 13675ch · 2588ms · 3858/70t · S2: 16833ch · 1792ms · 25/78t · S3: 19900ch · 3774ms · 25/277t · Total: 8154ms wall 8597ms · 3908/425t</sub>

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
  step 8 (reasoning):                S1: "Customer reports coolant leaking from underneath engine bay, which directly matches coolant leak testing service that includes pressure testing and inspection of hoses, radiator, water pump, and related components." · S2: "Customer reports coolant leaking from underneath the engine bay, which directly matches the positive example 'Bright green puddle right under the front of my car' and the core description of a brightly colored puddle under the radiator area." · S3: "Customer explicitly stated coolant leaking from underneath engine bay. Inferred fluid_color as green_or_orange_or_yellow_or_pink (coolant standard) and location as under_engine_front and under_hood based on 'engine bay' phrasing. No other symptoms or timing details provided."
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

<sub>S1: 13675ch · 1520ms · 3855/68t · S2: 16745ch · 1962ms · 22/90t · S3: 19742ch · 3691ms · 22/309t · Total: 7175ms wall 7656ms · 3899/467t</sub>

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
  step 8 (reasoning):                S1: "Customer reports engine overheating in traffic, a classic symptom of cooling system failure; coolant_leak_testing includes thermostat, fan operation, and circulation checks." · S2: "Customer reports engine overheating in traffic, a classic symptom of coolant system failure. While 'engine_temperature_light' best captures the overheating scenario, the description lacks mention of a visible warning light or smoke, making 'medium' confidence appropriate for downstream verification." · S3: "Customer clearly stated overheating occurs when stopped in traffic (speed_band=stopped, onset_timing=at_stop). No other symptoms, timing, or details provided; all other slots null."
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

<sub>S1: 13675ch · 1670ms · 3855/65t · S2: 16745ch · 5149ms · 22/89t · S3: 19993ch · 3261ms · 22/266t · Total: 10082ms wall 10523ms · 3899/420t</sub>

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
  step 8 (reasoning):                S1: "Customer describes brake pedal pulsing during highway deceleration, a classic ABS or brake system symptom requiring inspection of pads, rotors, calipers, and brake lines." · S2: "Customer describes brake pedal pulsing when slowing from highway speed, which is a direct positive example match for pulsating_or_vibrating_pedal (warped rotors/DTV)." · S3: "Customer clearly stated brake pedal pulses during braking from highway speeds. Extracted pedal_feel=pulsating, onset_timing=when_braking, speed_band=highway. No other details provided; all other slots null."
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

<sub>S1: 13675ch · 2929ms · 3859/66t · S2: 22200ch · 1596ms · 26/79t · S3: 19853ch · 3585ms · 26/276t · Total: 8111ms wall 8602ms · 3911/421t</sub>

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
  step 8 (reasoning):                S1: "Customer reports 'grinding' brakes, a clear symptom of worn brake pads or damaged rotors that requires brake inspection to diagnose and assess safety." · S2: "Customer's phrase "grinding really bad now" is a direct positive example match for metallic_grinding, indicating worn pads contacting the rotor." · S3: "Customer clearly stated 'grinding' noise when braking, so noise_descriptor and onset_timing are solid. Inferred sound_or_smoke_location_zone as 'from_a_wheel' (grinding brakes originate at wheels) and customer_request_type as 'diagnose_problem' (implied by 'really bad now'). Side, axle, and severity details not stated, so left null."
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

<sub>S1: 13675ch · 1508ms · 3852/59t · S2: 22200ch · 1517ms · 19/60t · S3: 19836ch · 6409ms · 19/325t · Total: 9437ms wall 9835ms · 3890/444t</sub>

### Test 11

```
{
concern: I can feel a vibration in the steering wheel only when I brake at highway speeds
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 80 chars (>=3)
  step 3 (pick subcategory, S2):     hallucinated — stage2 returned subcategory 'vibration_or_pulsing_when_braking' which is NOT in the matched category's eligible set
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     154 unanswered IDs: [78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 99, 100, 101, 102, 103, 104, 105, 113, 114, 115, 116, 117, 118, 119, 127, 128, 129, 130, 131, 132, 133, 141, 142, 143, 144, 145, 146, 147, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 667, 668, 669, 670, 671, 672, 673, 674, 675, 676, 677, 678, 679, 680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690, 691, 692, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706, 707, 708, 730, 731, 732, 733, 734, 735, 736, 751, 752, 753, 754, 755, 756, 757, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1476, 1477, 1478, 1479, 1480, 1481, 1482]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Vibration in steering wheel during highway braking suggests suspension/steering wear or brake rotor issues; suspension_steering_check covers steering/vibration concerns and includes road testing to verify handling." · S2: "Customer describes vibration in steering wheel triggered by braking at highway speed, which matches the brake-triggered vibration pattern. However, this subcategory is not in the suspension_steering_check category list provided. The closest match within the available subcategories is steering_wheel_shakes_at_highway_speed, but the negative example explicitly excludes 'Steering wheel shakes ONLY when I press the brake pedal,' making this a poor fit. No ideal match exists in this category." · S3: "Customer clearly stated vibration in steering wheel (behind_dashboard location) triggered only when braking at highway speeds. No other facts literally stated; all other slots null."
extracted_facts:
  speed_band: "highway"
  onset_timing: "when_braking"
  sound_or_smoke_location_zone: "behind_dashboard"
matched category key: suspension_steering_check
matched sub category slug: null
unanswered question ids: [78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 99, 100, 101, 102, 103, 104, 105, 113, 114, 115, 116, 117, 118, 119, 127, 128, 129, 130, 131, 132, 133, 141, 142, 143, 144, 145, 146, 147, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 667, 668, 669, 670, 671, 672, 673, 674, 675, 676, 677, 678, 679, 680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690, 691, 692, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706, 707, 708, 730, 731, 732, 733, 734, 735, 736, 751, 752, 753, 754, 755, 756, 757, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1476, 1477, 1478, 1479, 1480, 1481, 1482]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 9245ms · 3861/68t · S2: 44059ch · 2646ms · 28/143t · S3: 18784ch · 3227ms · 28/259t · Total: 15121ms wall 15503ms · 3917/470t</sub>

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
  step 7 (confidence per stage):     S1: high · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer reports bouncing over bumps and loose steering, which directly indicate suspension and steering component wear or damage—the core concerns addressed by suspension_steering_check." · S2: "Customer reports bouncing over bumps (positive example match: 'bounces three or four times after every bump'), but also mentions loose steering. Primary symptom is the bounce/ride harshness; loose steering is secondary context suggesting worn suspension components." · S3: "Customer clearly stated bouncing over bumps (onset_timing) and loose steering feel. No speed, location, timing of onset, or other contextual details provided; judgment call between 'loose_or_sloppy' vs other steering options was straightforward."
extracted_facts:
  onset_timing: "over_bumps"
  steering_feel: "loose_or_sloppy"
matched category key: suspension_steering_check
matched sub category slug: shaking_or_bouncing_over_bumps_and_rough_roads
unanswered question ids: [169, 170, 171, 172, 173, 174, 175]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 1542ms · 3858/61t · S2: 44059ch · 2246ms · 25/95t · S3: 19962ch · 3560ms · 25/284t · Total: 7350ms wall 7852ms · 3908/440t</sub>

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
  step 8 (reasoning):                S1: "Customer reports 'clunking sound from the front end going over bumps,' which directly indicates suspension component wear or looseness—a core concern for suspension_steering_check inspection." · S2: "Customer describes 'clunking sound from the front end going over bumps' — a direct match to the positive example 'Big clunk from the front whenever I hit a pothole' and the core description of metallic clunk triggered by bumps." · S3: "Customer clearly stated a clunking noise from the front end triggered by bumps. No other details provided (side, speed, duration, etc.), so remaining slots are null."
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

<sub>S1: 13675ch · 2124ms · 3859/66t · S2: 44059ch · 1837ms · 26/87t · S3: 19852ch · 3312ms · 26/263t · Total: 7274ms wall 7754ms · 3911/416t</sub>

### Test 14

```
{
concern: Power steering pump is making a whining noise especially when I turn
LLM decision tree:
  step 1 (match category, S1):       matched 'power_steering_eps_testing'
  step 2 (vagueness check):          passed — description has 68 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'noise_when_turning_the_steering_wheel'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [682, 683, 684, 686, 687]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports whining noise from power steering pump during turns, which directly indicates power steering system diagnosis per the EPS testing service scope." · S2: "Customer explicitly describes a whining noise from the power steering pump that occurs when turning—a direct match to the positive example 'Loud whine when I turn the wheel' and the synonym 'power steering whine.'" · S3: "Customer explicitly stated whining noise from power steering pump when turning. Onset timing is clearly 'when_turning' and sound location is 'under_hood' (engine bay). No other facts were literally stated."
extracted_facts:
  onset_timing: "when_turning"
  noise_descriptor: "whining"
  sound_or_smoke_location_zone: "under_hood"
matched category key: power_steering_eps_testing
matched sub category slug: noise_when_turning_the_steering_wheel
unanswered question ids: [682, 683, 684, 686, 687]
testing service recommended: power_steering_eps_testing — Power steering / EPS testing ($179.95)
}
```

<sub>S1: 13675ch · 1458ms · 3857/57t · S2: 11921ch · 2129ms · 3548/82t · S3: 19912ch · 3480ms · 24/270t · Total: 7070ms wall 7654ms · 7429/409t</sub>

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
  step 8 (reasoning):                S1: "Pull to the left during acceleration suggests suspension, steering alignment, or tire wear issues; suspension_steering_check includes inspection for pulling and uneven tire wear via road test." · S2: "Customer describes pull to one side ONLY when accelerating ("when accelerating but not braking"), matching the classic torque steer pattern in pulling_only_during_acceleration positive examples like "Pulls hard to the right when I step on the gas."" · S3: "Customer clearly stated pull direction (left) and onset timing (when accelerating, not braking). All other facts were not mentioned and remain null."
extracted_facts:
  onset_timing: "when_accelerating"
  pull_direction: "left"
matched category key: suspension_steering_check
matched sub category slug: pulling_only_during_acceleration
unanswered question ids: [198, 199, 200, 201, 202, 203]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 1708ms · 3859/63t · S2: 44059ch · 2063ms · 26/88t · S3: 19723ch · 2994ms · 26/253t · Total: 6769ms wall 7235ms · 3911/404t</sub>

### Test 16

```
{
concern: Rumbling noise from under the car that gets louder as I speed up
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 64 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'humming_or_whirring_at_speed'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [85, 86, 87, 88, 89, 90, 91]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Rumbling noise that increases with speed suggests suspension, steering, or drivetrain wear; suspension_steering_check includes noise inspection and road testing to diagnose such concerns." · S2: "Customer describes a rumbling noise that increases with speed, matching the speed-dependent sound pattern of humming_or_whirring_at_speed (wheel bearing or tire wear). However, 'rumbling' is less typical than the listed synonyms (hum, whir, drone, growl), creating medium confidence." · S3: "Customer clearly stated a rumbling noise from under the car that increases with speed. Extracted noise_descriptor as roaring (rumbling/droning from underneath), sound_or_smoke_location_zone as under_car, onset_timing as during_driving, and speed_band as all_speeds (gets louder as speed increases). No other details provided."
extracted_facts:
  speed_band: "all_speeds"
  onset_timing: "during_driving"
  noise_descriptor: "roaring"
  sound_or_smoke_location_zone: "under_car"
matched category key: suspension_steering_check
matched sub category slug: humming_or_whirring_at_speed
unanswered question ids: [85, 86, 87, 88, 89, 90, 91]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 2040ms · 3860/64t · S2: 44059ch · 2159ms · 27/106t · S3: 19762ch · 5291ms · 27/303t · Total: 9491ms wall 10025ms · 3914/473t</sub>

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
  step 8 (reasoning):                S1: "Off-center steering wheel when driving straight indicates a steering/suspension alignment or component issue; suspension_steering_check includes inspection of steering components, tie rods, and alignment verification via road test." · S2: "Customer's description matches the subcategory definition exactly: steering wheel is visibly tilted off-center while the vehicle tracks correctly, a cosmetic wheel-position issue distinct from pulling or loose steering feel." · S3: "Customer explicitly stated steering wheel is off-center while driving straight, matching the subcategory definition. No other facts were literally stated; onset_timing inferred as during_driving since off-center wheel is observed while driving."
extracted_facts:
  onset_timing: "during_driving"
  steering_feel: "wheel_off_center_while_straight"
matched category key: suspension_steering_check
matched sub category slug: steering_wheel_off_center_when_driving_straight
unanswered question ids: [675, 676, 677, 678, 679, 680]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 1628ms · 3854/68t · S2: 44059ch · 2170ms · 21/80t · S3: 19878ch · 3387ms · 21/276t · Total: 7188ms wall 7580ms · 3896/424t</sub>

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
  step 8 (reasoning):                S1: "Customer reports tire pressure loss without visible damage; TPMS testing will check sensor function, tire pressures, and identify slow leaks or sensor faults that aren't visually apparent." · S2: "Customer describes a tire losing pressure over time with no visible damage identified—matches 'tire keeps going flat' and 'slow leak' positive examples and core description of air loss without named visible cause." · S3: "Customer explicitly stated front passenger tire (right, front) is losing pressure with no visible hole found. Matches tire_going_flat_losing_air subcategory. All other facts not mentioned."
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

<sub>S1: 13675ch · 2686ms · 3856/67t · S2: 13580ch · 2460ms · 4105/75t · S3: 19865ch · 3650ms · 23/266t · Total: 8799ms wall 9281ms · 7984/408t</sub>

### Test 19

```
{
concern: Burning rubber smell after a long drive
LLM decision tree:
  step 1 (match category, S1):       matched 'oil_leak_testing'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     35 unanswered IDs: [232, 233, 234, 235, 236, 237, 238, 302, 303, 304, 305, 306, 307, 308, 323, 324, 325, 326, 327, 328, 329, 1021, 1022, 1023, 1024, 1025, 1026, 1027, 1743, 1744, 1745, 1746, 1747, 1748, 1749]
  step 7 (confidence per stage):     S1: medium · S2: low · S3: medium
  step 8 (reasoning):                S1: "Burning rubber smell after extended driving suggests possible oil leak or overheating; oil_leak_testing covers smell concerns, though coolant_leak_testing is also plausible if overheating is the cause." · S2: "'Burning rubber smell' is a classic brake overheating symptom, not an engine oil leak. Stage 1 routed to oil_leak_testing, but this description doesn't match any subcategory here (burnt_oil_smell is greasy petroleum, not rubber; smoke_from_under_the_hood requires visible smoke). Verify routing." · S3: "Customer clearly stated burning rubber smell (smell_descriptor) occurring after a long drive (onset_timing=after_warming_up). Location, speed, and other details not specified; sound_or_smoke_location_zone left null per CRITICAL RULE since customer didn't state where the smell originates."
extracted_facts:
  onset_timing: "after_warming_up"
  smell_descriptor: "burning_rubber_or_hot_brakes"
matched category key: oil_leak_testing
matched sub category slug: null
unanswered question ids: [232, 233, 234, 235, 236, 237, 238, 302, 303, 304, 305, 306, 307, 308, 323, 324, 325, 326, 327, 328, 329, 1021, 1022, 1023, 1024, 1025, 1026, 1027, 1743, 1744, 1745, 1746, 1747, 1748, 1749]
testing service recommended: oil_leak_testing — Oil leak testing ($179.95)
}
```

<sub>S1: 13675ch · 1689ms · 3852/73t · S2: 10670ch · 2672ms · 3244/98t · S3: 18784ch · 3668ms · 19/297t · Total: 8031ms wall 8494ms · 7115/468t</sub>

### Test 20

```
{
concern: Strange chemical smell coming through the vents
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 47 chars (>=3)
  step 3 (pick subcategory, S2):     hallucinated — stage2 returned subcategory 'hvac/bad_smell_from_vents' which is NOT in the matched category's eligible set
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     56 unanswered IDs: [106, 107, 108, 109, 110, 111, 112, 225, 226, 227, 228, 229, 230, 231, 281, 282, 283, 284, 285, 286, 287, 302, 303, 304, 305, 306, 307, 308, 399, 400, 401, 402, 403, 404, 405, 937, 938, 939, 940, 941, 942, 943, 986, 987, 988, 989, 990, 991, 992, 1021, 1022, 1023, 1024, 1025, 1026, 1027]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports 'strange chemical smell coming through the vents,' which could indicate coolant leak (sweet smell) or A/C refrigerant issue; coolant_leak_testing covers both leak detection and smell concerns via pressure testing and system inspection." · S2: "Customer reports sweet chemical smell arriving through dashboard vents, which matches the heater-core leak scenario described in the sweet_smell subcategory's negative example and the HVAC category's distinct routing instruction." · S3: "Customer clearly stated a chemical smell from vents (smell_descriptor='other_burning', sound_or_smoke_location_zone='from_vents'). Inferred onset_timing='at_first_turn_on' because vents typically emit odors when HVAC first activates, though customer didn't explicitly state this timing. hvac_mode left null since customer didn't specify AC vs heat."
extracted_facts:
  onset_timing: "at_first_turn_on"
  smell_descriptor: "other_burning"
  sound_or_smoke_location_zone: "from_vents"
matched category key: coolant_leak_testing
matched sub category slug: null
unanswered question ids: [106, 107, 108, 109, 110, 111, 112, 225, 226, 227, 228, 229, 230, 231, 281, 282, 283, 284, 285, 286, 287, 302, 303, 304, 305, 306, 307, 308, 399, 400, 401, 402, 403, 404, 405, 937, 938, 939, 940, 941, 942, 943, 986, 987, 988, 989, 990, 991, 992, 1021, 1022, 1023, 1024, 1025, 1026, 1027]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 13675ch · 1747ms · 3852/76t · S2: 16745ch · 4580ms · 19/74t · S3: 18784ch · 3622ms · 19/319t · Total: 9950ms wall 10360ms · 3890/469t</sub>

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
  step 8 (reasoning):                S1: "Customer reports A/C takes a long time to cool after starting, which directly maps to ac_performance_check (measures vent temperature, blower, cooling fan operation, and system pressures)." · S2: "Customer reports AC cooling delay ('takes forever to get cold'), which aligns with weak/partial cooling and slow-to-cool patterns. However, the description doesn't clarify if cooling eventually reaches acceptable levels or remains inadequate, creating ambiguity between weak cooling and a potential compressor engagement issue." · S3: "Customer clearly stated AC is on and takes a long time to cool after starting the car. Set hvac_mode=ac, onset_timing=at_startup, and customer_request_type=diagnose_problem. No other facts literally stated."
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

<sub>S1: 13675ch · 3248ms · 3855/71t · S2: 19980ch · 2227ms · 22/98t · S3: 19938ch · 3437ms · 22/277t · Total: 8912ms wall 9346ms · 3899/446t</sub>

### Test 22

```
{
concern: Heater blows cold air on the highway but warms up at stoplights
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 63 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'ac_is_weak_not_cold_enough'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [574, 575, 576, 578, 579, 580]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports heater malfunction (cold air on highway, warm at stoplights), suggesting possible cooling system or blend door issue; AC performance check includes blower and system operation verification." · S2: "Customer describes heating that cycles between cold and warm depending on driving conditions ('cools on highway but warms at stoplights'), matching the evaporator-freeze symptom of low refrigerant charge described in ac_is_weak_not_cold_enough, though the complaint is about heat rather than AC cooling." · S3: "Customer clearly stated heater mode, temperature behavior at highway speed vs. idle (stoplights), and that airflow is present (not weak). No other symptoms mentioned; all other slots null."
extracted_facts:
  speed_band: "highway"
  onset_timing: "during_driving"
  hvac_mode: "heat"
  airflow_state: "strong_normal"
matched category key: ac_performance_check
matched sub category slug: ac_is_weak_not_cold_enough
unanswered question ids: [574, 575, 576, 578, 579, 580]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 13675ch · 4823ms · 3862/66t · S2: 19980ch · 2146ms · 29/102t · S3: 19938ch · 4470ms · 29/264t · Total: 11443ms wall 12050ms · 3920/432t</sub>

### Test 23

```
{
concern: Defroster doesn't really work anymore
LLM decision tree:
  step 1 (match category, S1):       matched 'window_inop_testing'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: medium · S2: low · S3: medium
  step 8 (reasoning):                S1: "Defroster malfunction suggests electrical/motor issue with windshield defrost system; window_inop_testing covers electrical diagnosis of inoperative vehicle systems including wiper/defrost circuits." · S2: "Defroster malfunction is a climate/thermal control issue, not a window operability problem. Stage 1 category (window_inop_testing) has no subcategories listed, and defroster doesn't match window inoperative symptoms." · S3: "Customer stated defrost mode isn't working well ('doesn't really work anymore'), which maps to hvac_mode=defrost and weak airflow. Interpreted 'doesn't really work' as weak_overall rather than no_airflow since they said 'doesn't really work' not 'doesn't work at all.' No timing, location, or other details provided."
extracted_facts:
  hvac_mode: "defrost"
  airflow_state: "weak_overall"
  customer_request_type: "diagnose_problem"
matched category key: window_inop_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: window_inop_testing — Window inoperative testing ($179.95)
}
```

<sub>S1: 13675ch · 1968ms · 3853/71t · S2: 2621ch · 1950ms · 1115/79t · S3: 18784ch · 4098ms · 20/305t · Total: 8017ms wall 8560ms · 4988/455t</sub>

### Test 24

```
{
concern: Exhaust sounds louder than normal lately
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Louder exhaust could indicate a leak, performance issue, or normal wear, but the description lacks specificity (no smell, smoke, or performance change noted) to confidently match a single testing service." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1901ms · 3853/66t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1902ms wall 2442ms · 3853/66t</sub>

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
  step 8 (reasoning):                S1: "Description mentions hood closure difficulty and squeaking noise, but doesn't clearly map to a single testing service; could involve latch, hinges, belts, or suspension—requires advisor clarification." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1680ms · 3858/63t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1681ms wall 2247ms · 3858/63t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 23 |
| matched an 'other' subcategory (forward-to-advisor) | 0 |
| null match (forwarded to advisor) | 2 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 2 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 59684 ms |
| sum stage-2 latencies | 61622 ms |
| sum stage-3 latencies | 86895 ms |
| sum input tokens | 109425 |
| sum output tokens | 10184 |
| **stage 1** confidence: high / medium / low / missing | 9 / 14 / 2 / 0 |
| **stage 2** confidence: high / medium / low / missing | 15 / 5 / 3 / 2 |
| **stage 3** confidence: high / medium / low / missing | 18 / 5 / 0 / 2 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 23 / 102 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.39 (n=23) |
