# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T01:47:12.051Z
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
concern: Brakes squeal AND my steering wheel shakes when I stop hard
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [758, 759, 760, 761, 762, 763, 764]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports two distinct symptoms (brake squeal + steering wheel shake during hard stops) that could involve brakes, suspension, or alignment; multiple symptoms warrant advisor handoff rather than a single test." · S2: "Customer reports two distinct symptoms (brake squeal + steering wheel shake during hard stops) that don't map to a single focused subcategory; matches the 'multiple symptoms' catch-all." · S3: "Customer clearly stated brake squeal (squealing_high_pitched) and steering wheel shake (behind_dashboard) both triggered by hard braking (when_braking). Front axle inferred from brake context. Steering shake location is judgment call between 'behind_dashboard' and 'from_a_wheel'—chose behind_dashboard as primary symptom location."
extracted_facts:
  location_axle: "front"
  onset_timing: "when_braking"
  noise_descriptor: "squealing_high_pitched"
  sound_or_smoke_location_zone: "from_a_wheel"
  customer_request_type: "diagnose_problem"
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1678ms · 3859/69t · S2: 2872ch · 1812ms · 1187/76t · S3: 19113ch · 3543ms · 26/313t · Total: 7034ms wall 7692ms · 5072/458t</sub>

### Test 2

```
{
concern: Engine runs rough AND my heat is barely working
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 47 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [758, 759, 760, 761, 762, 763, 764]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports two distinct symptoms (rough engine + weak heat) that don't map to a single testing service; this is a classic multiple-symptom situation requiring advisor triage." · S2: "Customer reports two distinct symptoms (rough engine AND weak heat), which directly matches the 'multiple symptoms / not sure what category' subcategory designed for cases where the issue spans multiple systems." · S3: "Customer stated two clear symptoms: rough engine running (interpreted as rough_idle since no speed context given) and weak heat output (hvac_mode=heat, airflow_state=weak_overall). No timing, location, or recent-action details provided; request_type inferred as diagnose_problem since customer didn't name a specific fix."
extracted_facts:
  hvac_mode: "heat"
  airflow_state: "weak_overall"
  engine_running: "rough_idle"
  customer_request_type: "diagnose_problem"
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1589ms · 3853/70t · S2: 2872ch · 1944ms · 1181/75t · S3: 19113ch · 3664ms · 20/300t · Total: 7198ms wall 7752ms · 5054/445t</sub>

### Test 3

```
{
concern: Battery dies overnight AND I hear a clicking sound when I try to start
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'battery_drains_overnight'
  step 4 (extract facts, S3):        extracted 6 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [532, 533, 534, 535, 536, 537, 538]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Battery dies overnight (parasitic drain) + clicking sound on start (weak battery or starter) clearly indicates charging/starting system fault requiring load test, alternator output, and starter draw testing." · S2: "Customer reports battery dying overnight (classic parasitic drain pattern) with clicking on restart attempt; battery_drains_overnight's positive example 'Car was fine yesterday, totally dead this morning' and description match the overnight drain scenario." · S3: "Customer clearly stated battery dies overnight (parasitic drain pattern) and clicking sound at startup attempt. Set engine_running to wont_crank_just_clicks, onset_timing to cold_start, and drivable_state to not_drivable_needs_tow. No other details provided."
extracted_facts:
  onset_timing: "cold_start"
  noise_descriptor: "whining"
  engine_running: "wont_crank_just_clicks"
  sound_or_smoke_location_zone: "under_hood"
  drivable_state: "not_drivable_needs_tow"
  customer_request_type: "diagnose_problem"
matched category key: charging_starting_testing
matched sub category slug: battery_drains_overnight
unanswered question ids: [532, 533, 534, 535, 536, 537, 538]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 13675ch · 1850ms · 3858/67t · S2: 16833ch · 1863ms · 25/78t · S3: 19979ch · 3659ms · 25/311t · Total: 7374ms wall 7900ms · 3908/456t</sub>

### Test 4

```
{
concern: AC stopped working AND I smell coolant
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 38 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [758, 759, 760, 761, 762, 763, 764]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports two distinct symptoms (AC failure + coolant smell) that could involve separate systems (HVAC and cooling); this warrants advisor triage before testing." · S2: "Customer reports two distinct symptoms (AC failure + coolant smell) that don't map to a single subcategory, matching the 'multiple symptoms' classification exactly." · S3: "Customer stated AC stopped working (no_airflow) and smells coolant (sweet_or_maple_syrup). No other specifics about timing, location, or severity were provided. Request is diagnostic."
extracted_facts:
  hvac_mode: "ac"
  airflow_state: "no_airflow"
  smell_descriptor: "sweet_or_maple_syrup"
  customer_request_type: "diagnose_problem"
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1985ms · 3852/63t · S2: 2872ch · 1829ms · 1180/70t · S3: 19113ch · 3392ms · 19/277t · Total: 7208ms wall 7685ms · 5051/410t</sub>

### Test 5

```
{
concern: Car pulls to the right AND the brakes feel spongy
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [758, 759, 760, 761, 762, 763, 764]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports two distinct symptoms (pulling right + spongy brakes) that could indicate suspension/steering issues, brake system problems, or both; multiple symptoms warrant advisor handoff rather than a single test." · S2: "Customer reports two distinct symptoms (pulls to the right + spongy brakes) without clarity on which is primary; matches the 'multiple symptoms / not sure what category' definition exactly." · S3: "Customer stated two clear symptoms: steering pulls right (pull_direction=right) and brake pedal feels spongy (pedal_feel=soft_spongy). No other details provided; all other slots null."
extracted_facts:
  pedal_feel: "soft_spongy"
  pull_direction: "right"
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1868ms · 3857/71t · S2: 2872ch · 1564ms · 1185/75t · S3: 19113ch · 3214ms · 24/270t · Total: 6647ms wall 7113ms · 5066/416t</sub>

### Test 6

```
{
concern: Loud thump from rear when I brake AND I see fluid spots on my driveway
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection_warning_light'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'brake_system_red_light'
  step 4 (extract facts, S3):        extracted 6 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [420, 421, 422, 423, 424, 426]
  step 7 (confidence per stage):     S1: high · S2: low · S3: high
  step 8 (reasoning):                S1: "Customer reports loud thump when braking plus fluid spots, indicating brake system issue with possible leak; brake_inspection_warning_light covers brake component inspection and leak detection." · S2: "Customer reports brake-related symptoms (loud thump + fluid leak) but does NOT mention a red dashboard warning light, which is the defining feature of brake_system_red_light. Symptoms suggest hydraulic failure risk, but absence of the red light warning contradicts the subcategory's core definition." · S3: "Customer clearly stated a loud thump (clunking) from the rear when braking and fluid spots on driveway (rear location). No other details provided; all other slots null."
extracted_facts:
  location_axle: "rear"
  onset_timing: "when_braking"
  noise_descriptor: "clunking"
  fluid_under_car_location: "under_rear"
  sound_or_smoke_location_zone: "under_car"
  customer_request_type: "diagnose_problem"
matched category key: brake_inspection_warning_light
matched sub category slug: brake_system_red_light
unanswered question ids: [420, 421, 422, 423, 424, 426]
testing service recommended: brake_inspection_warning_light — Brake inspection with Warning Light ($89.95)
}
```

<sub>S1: 13675ch · 2496ms · 3863/60t · S2: 4946ch · 2305ms · 1748/95t · S3: 20025ch · 3360ms · 30/271t · Total: 8164ms wall 8598ms · 5641/426t</sub>

### Test 7

```
{
concern: Check engine light came on AND the gas mileage tanked
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [373, 374, 375, 376, 378]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports check engine light with poor fuel economy—both classic indicators of engine performance issues that require diagnostic scanning for trouble codes and live data review." · S2: "Customer reports check engine light (primary symptom) paired with tanked fuel mileage; CEL is the lead complaint and matches positive example 'Check engine light came on and the car is running fine otherwise' — mileage drop is a common secondary indicator of OBD-II fault codes." · S3: "Customer clearly stated check engine light came on (warning_light_named='check engine', behavior='steady_on') and fuel economy declined. No other specific symptoms, timing, or conditions mentioned. Request is implicit diagnosis."
extracted_facts:
  warning_light_named: "check engine"
  warning_light_behavior: "steady_on"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [373, 374, 375, 376, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1657ms · 3857/59t · S2: 42816ch · 2195ms · 24/93t · S3: 19941ch · 3788ms · 24/271t · Total: 7640ms wall 7953ms · 3905/423t</sub>

### Test 8

```
{
concern: Car shakes at highway speeds AND tires look fine
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 48 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'steering_wheel_shake_at_highway_speed'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [142, 143, 144, 145, 146, 147]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer reports shaking at highway speeds with tires ruled out; suspension/steering check includes vibration diagnosis via inspection and road test." · S2: "Customer reports shaking at highway speeds; 'steering wheel shake at highway speed' is the best match. However, 'tires look fine' creates ambiguity—could also suggest vibration/steering_wheel_shake_at_highway_speed if the shake is felt as vibration rather than wheel movement. Routing to steering subcategory as primary, but advisor should clarify whether shake is in the wheel itself or felt through the seat/floor." · S3: "Customer clearly stated shake at highway speeds and that tires look fine. Onset timing inferred as 'during_driving' (shake occurs while in motion at speed). Tire state set to 'normal_or_unknown' because customer explicitly said tires look fine, ruling out visible damage/wear. No specific mph, side, axle, or other details provided; most slots remain null."
extracted_facts:
  speed_band: "highway"
  onset_timing: "during_driving"
  tire_state: "normal_or_unknown"
  customer_request_type: "diagnose_problem"
matched category key: suspension_steering_check
matched sub category slug: steering_wheel_shake_at_highway_speed
unanswered question ids: [142, 143, 144, 145, 146, 147]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 5217ms · 3855/50t · S2: 44059ch · 2595ms · 22/132t · S3: 20010ch · 3967ms · 22/312t · Total: 11782ms wall 12150ms · 3899/494t</sub>

### Test 9

```
{
concern: Hesitates on acceleration AND I hear a popping sound
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 52 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'engine_misfire_or_bucking_feeling'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [512, 513, 514, 516]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Hesitation on acceleration with popping sound suggests engine performance issues; check engine light testing will scan for trouble codes and monitor live data to diagnose the root cause." · S2: "Customer reports hesitation on acceleration paired with popping sound; popping suggests misfiring cylinders rather than smooth lag. Misfire's jerky/bucking feel with check-engine light fits better than hesitation_or_lag's momentary pause description." · S3: "Customer clearly stated hesitation during acceleration and a popping sound, both triggered by acceleration. Set onset_timing='when_accelerating', engine_running='misfiring' (hesitation + popping suggests cylinder misfire), and noise_descriptor='popping_or_clicking'. No location, speed, or other contextual details provided; left those null."
extracted_facts:
  onset_timing: "when_accelerating"
  noise_descriptor: "popping_or_clicking"
  engine_running: "misfiring"
matched category key: check_engine_light_testing
matched sub category slug: engine_misfire_or_bucking_feeling
unanswered question ids: [512, 513, 514, 516]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 5351ms · 3857/64t · S2: 42816ch · 1652ms · 24/91t · S3: 19781ch · 3572ms · 24/305t · Total: 10578ms wall 10929ms · 3905/460t</sub>

### Test 10

```
{
concern: Idles rough AND smells like gas inside the cabin
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 48 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'rough_idle_or_shaking_at_a_stop'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [463, 464, 465, 468]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports rough idle and gas smell in cabin, suggesting fuel system or engine performance issue; check engine light testing will scan for codes and verify sensor/system performance." · S2: "Customer reports rough idle (engine runs choppy at stop), which matches rough_idle_or_shaking_at_a_stop. Gas smell is secondary; gasoline_fuel_smell is a separate subcategory, but rough idle is the primary drivability complaint here." · S3: "Customer clearly stated rough idle (engine_running=rough_idle, onset_timing=when_idling, speed_band=idle) and gasoline smell inside the cabin (smell_descriptor=gasoline_or_fuel, sound_or_smoke_location_zone=inside_cabin_general). No other details provided."
extracted_facts:
  speed_band: "idle"
  onset_timing: "when_idling"
  smell_descriptor: "gasoline_or_fuel"
  engine_running: "rough_idle"
  sound_or_smoke_location_zone: "inside_cabin_general"
matched category key: check_engine_light_testing
matched sub category slug: rough_idle_or_shaking_at_a_stop
unanswered question ids: [463, 464, 465, 468]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1764ms · 3856/58t · S2: 42816ch · 2322ms · 23/98t · S3: 19772ch · 4136ms · 23/303t · Total: 8225ms wall 8672ms · 3902/459t</sub>

### Test 11

```
{
concern: Sometimes it does this thing where it kinda jerks
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description 'kinda jerks' is too vague to categorize—could indicate transmission, suspension, brakes, or engine issues; customer needs advisor clarification." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1694ms · 3855/58t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1694ms wall 2160ms · 3855/58t</sub>

### Test 12

```
{
concern: Acts weird in the morning before warming up
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague to categorize; 'acts weird' could indicate cold-start performance, fuel system, electrical, or engine issues, but lacks specific symptoms needed for accurate routing." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 8773ms · 3852/62t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 8775ms wall 9292ms · 3852/62t</sub>

### Test 13

```
{
concern: Maintenance light is something I should probably get checked
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     7 unanswered IDs: [448, 449, 450, 451, 452, 453, 454]
  step 7 (confidence per stage):     S1: high · S2: low · S3: medium
  step 8 (reasoning):                S1: "Customer reports a maintenance light, which is a warning indicator that requires diagnostic scanning to identify the underlying issue and determine necessary service." · S2: "Customer describes a maintenance light, which does not match the 'multiple_warning_lights_at_once' subcategory (requires 3+ lights or 'Christmas tree' phrasing). Stage 1 category mismatch suggests rerouting needed." · S3: "Customer named a dashboard warning light ('maintenance light' / 'maintenance required') and expressed intent to have it checked, indicating a diagnostic request. No other symptoms or details were provided."
extracted_facts:
  warning_light_named: "maintenance required"
  customer_request_type: "diagnose_problem"
matched category key: warning_light_general
matched sub category slug: null
unanswered question ids: [448, 449, 450, 451, 452, 453, 454]
testing service recommended: warning_light_general — Warning light testing (general / unspecified light) ($179.95)
}
```

<sub>S1: 13675ch · 1440ms · 3854/53t · S2: 4953ch · 1624ms · 1675/81t · S3: 18784ch · 2998ms · 21/261t · Total: 6062ms wall 6832ms · 5550/395t</sub>

### Test 14

```
{
concern: I think I need an inspection
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 28 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague to categorize; 'inspection' alone doesn't indicate which system or concern needs diagnosis." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1313ms · 3850/47t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1314ms wall 1838ms · 3850/47t</sub>

### Test 15

```
{
concern: Im not really sure but it feels off
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 35 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague ('feels off') to map to any specific testing service or situation category; customer would benefit from advisor consultation." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1492ms · 3852/50t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1493ms wall 1880ms · 3852/50t</sub>

### Test 16

```
{
concern: Want to make sure everything is good before a road trip
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 55 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [787, 788, 789, 790, 791, 792]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer explicitly states they want to ensure everything is good before a road trip, which directly matches the pre-trip inspection subcategory." · S2: "Customer explicitly mentions 'before a road trip' and wanting to ensure everything is good, which directly matches the pre-trip inspection purpose of the subcategory." · S3: "Customer explicitly requested a pre-trip inspection before a road trip. No specific symptoms, complaints, or vehicle conditions were described, so all diagnostic slots remain null."
extracted_facts:
  customer_request_type: "pre_trip_inspection"
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1284ms · 3855/58t · S2: 2864ch · 1825ms · 1191/71t · S3: 19105ch · 3997ms · 22/256t · Total: 7108ms wall 7619ms · 5068/385t</sub>

### Test 17

```
{
concern: I bought this car used and want a complete check
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 48 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [787, 788, 789, 790, 791, 792]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer explicitly states they bought a used car and want a 'complete check,' which directly matches the general check-up / pre-trip inspection 'other' subcategory." · S2: "Customer explicitly requests a 'complete check' on a used car purchase, which directly matches the general check-up subcategory purpose of comprehensive vehicle inspection." · S3: "Customer explicitly requested a complete check on a recently purchased used vehicle. Only customer_request_type is extractable as 'pre_trip_inspection'; no symptoms or specific concerns were described."
extracted_facts:
  customer_request_type: "pre_trip_inspection"
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 2282ms · 3854/73t · S2: 2864ch · 2383ms · 1190/70t · S3: 19105ch · 3146ms · 21/263t · Total: 7811ms wall 8304ms · 5065/406t</sub>

### Test 18

```
{
concern: Lights look different than they used to be
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 42 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague to categorize; 'lights look different' could refer to headlights, interior lights, dashboard lights, or warning lights, but lacks specificity about the actual concern (dimness, color change, malfunction, warning light activation)." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 3021ms · 3853/77t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 3021ms wall 3488ms · 3853/77t</sub>

### Test 19

```
{
concern: Car is making a noise I cant describe
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague to categorize; 'noise I can't describe' lacks specifics about location, type, or system affected, requiring advisor handoff for clarification." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1785ms · 3852/60t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1786ms wall 2337ms · 3852/60t</sub>

### Test 20

```
{
concern: I just want it looked at
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 24 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague ('just want it looked at') to identify a specific symptom or system; customer would benefit from an advisor conversation to clarify the concern." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 2063ms · 3850/57t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 2064ms wall 2591ms · 3850/57t</sub>

### Test 21

```
{
concern: Buddy of mine said I need a head gasket
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Customer reports secondhand advice about a head gasket but provides no symptoms or context; too vague to categorize without knowing the actual concern (overheating, leak, performance, etc.)." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1582ms · 3855/62t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1582ms wall 2030ms · 3855/62t</sub>

### Test 22

```
{
concern: The other shop said I need brakes
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 33 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     72 unanswered IDs: [148, 149, 150, 151, 152, 153, 154, 183, 184, 185, 186, 187, 188, 189, 260, 261, 262, 263, 264, 265, 266, 309, 310, 311, 312, 313, 314, 315, 623, 624, 626, 627, 628, 629, 630, 631, 632, 633, 634, 635, 636, 637, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, 651, 652, 653, 654, 655, 656, 657, 658, 839, 864, 873, 1000, 1001, 1002, 1003, 1004, 1005, 1006]
  step 7 (confidence per stage):     S1: high · S2: low · S3: medium
  step 8 (reasoning):                S1: "Customer reports being told they need brakes by another shop; brake_inspection directly addresses brake system evaluation for wear and safety." · S2: "Customer statement 'need brakes' is too vague to match any specific subcategory—no symptom details (noise, feel, pull, smell, leak) provided to distinguish between brake pad wear, fluid issues, or performance problems." · S3: "Customer stated another shop diagnosed a brake issue and is seeking repair. No symptom details (noise, feel, location, timing) were provided, so only customer_request_type is extractable."
extracted_facts:
  customer_request_type: "fix_a_known_problem"
matched category key: brake_inspection
matched sub category slug: null
unanswered question ids: [148, 149, 150, 151, 152, 153, 154, 183, 184, 185, 186, 187, 188, 189, 260, 261, 262, 263, 264, 265, 266, 309, 310, 311, 312, 313, 314, 315, 623, 624, 626, 627, 628, 629, 630, 631, 632, 633, 634, 635, 636, 637, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, 651, 652, 653, 654, 655, 656, 657, 658, 839, 864, 873, 1000, 1001, 1002, 1003, 1004, 1005, 1006]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 13675ch · 1412ms · 3852/51t · S2: 22200ch · 1891ms · 19/75t · S3: 18784ch · 3287ms · 19/266t · Total: 6591ms wall 6962ms · 3890/392t</sub>

### Test 23

```
{
concern: Want a second opinion on what my dealer told me
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 47 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague to categorize—customer mentions wanting a second opinion but provides no details about the actual vehicle concern, symptoms, or what the dealer said." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1903ms · 3854/56t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1905ms wall 2331ms · 3854/56t</sub>

### Test 24

```
{
concern: Need an oil change and tire rotation
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 36 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Routine maintenance (oil change and tire rotation) does not fit any diagnostic testing service or 'other' elevated situation category in the catalog." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1466ms · 3851/52t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1466ms wall 1971ms · 3851/52t</sub>

### Test 25

```
{
concern: Need a state inspection
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 23 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [787, 788, 789, 790, 791, 792]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer explicitly requests a state inspection, which is a general check-up/compliance inspection rather than a specific symptom-based diagnostic test." · S2: "State inspection is a routine vehicle check-up requirement that aligns with the general check-up or pre-trip inspection subcategory's purpose of comprehensive vehicle assessment." · S3: "Customer explicitly requested a state inspection, which maps to pre_trip_inspection. No symptoms or vehicle issues were described, so all diagnostic slots remain null."
extracted_facts:
  customer_request_type: "pre_trip_inspection"
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1830ms · 3848/64t · S2: 2864ch · 1504ms · 1184/72t · S3: 19105ch · 2867ms · 15/255t · Total: 6201ms wall 6656ms · 5047/391t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 8 |
| matched an 'other' subcategory (forward-to-advisor) | 7 |
| null match (forwarded to advisor) | 10 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 58795 ms |
| sum stage-2 latencies | 29308 ms |
| sum stage-3 latencies | 52590 ms |
| sum input tokens | 108547 |
| sum output tokens | 6997 |
| **stage 1** confidence: high / medium / low / missing | 10 / 5 / 10 / 0 |
| **stage 2** confidence: high / medium / low / missing | 9 / 3 / 3 / 10 |
| **stage 3** confidence: high / medium / low / missing | 9 / 6 / 0 / 10 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 13 / 78 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.20 (n=15) |
