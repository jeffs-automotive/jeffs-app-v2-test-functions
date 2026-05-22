# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T01:51:13.427Z
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
concern: Just had brakes replaced two days ago and now there's a grinding noise
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (extract facts, S3):        extracted 7 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [772, 773, 774, 775, 776, 777, 778]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports grinding noise immediately after brake replacement two days ago, indicating a post-service issue that requires advisor evaluation rather than a standalone diagnostic test." · S2: "Customer reports grinding noise immediately after brake replacement two days ago, directly matching the 'after recent service or repair work' subcategory—a clear post-service symptom." · S3: "Customer clearly stated brake work 2 days ago and grinding noise onset. Grinding from brakes suggests front axle, but location_side not stated. Onset timing inferred as intermittent (no frequency detail given). No speed/pedal/smell details provided."
extracted_facts:
  location_axle: "front"
  onset_timing: "intermittent"
  started_when: "days_ago"
  noise_descriptor: "grinding_metallic"
  recent_action: "brake_work"
  sound_or_smoke_location_zone: "from_a_wheel"
  customer_request_type: "fix_a_known_problem"
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [772, 773, 774, 775, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1881ms · 3859/58t · S2: 2848ch · 1452ms · 1185/72t · S3: 19089ch · 4069ms · 26/296t · Total: 7405ms wall 8092ms · 5070/426t</sub>

### Test 2

```
{
concern: Got an alignment done last week and now the steering wheel is off-center
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 72 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [772, 773, 774, 775, 776, 777, 778]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports steering wheel off-center immediately after recent alignment service—a classic post-service issue requiring advisor review rather than a standalone diagnostic test." · S2: "Customer reports steering wheel off-center immediately after recent alignment service, directly matching the subcategory for issues arising after recent service or repair work." · S3: "Customer explicitly stated alignment work last week and steering wheel is off-center while driving straight. No other symptoms mentioned. Recent action and steering feel are literal matches; started_when inferred from 'last week' as days_ago; customer_request_type is fix_a_known_problem since they identified the issue post-service."
extracted_facts:
  started_when: "days_ago"
  recent_action: "alignment"
  steering_feel: "wheel_off_center_while_straight"
  customer_request_type: "fix_a_known_problem"
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [772, 773, 774, 775, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1657ms · 3859/63t · S2: 2848ch · 1561ms · 1185/65t · S3: 19089ch · 3809ms · 26/306t · Total: 7027ms wall 7762ms · 5070/434t</sub>

### Test 3

```
{
concern: New tires installed yesterday and my TPMS light is on
LLM decision tree:
  step 1 (match category, S1):       matched 'tpms_testing'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'tpms_tire_pressure_light'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=4 unanswered=3 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     3 unanswered IDs: [406, 408, 409]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports TPMS light on after new tire installation yesterday; TPMS testing includes sensor verification, pressure checks, and reprogramming—standard post-tire-install diagnostics." · S2: "Customer leads with TPMS light activation following recent tire installation; matches positive example 'Tire pressure light came on after I had new tires put on last week' and common post-service relearn scenario." · S3: "Customer explicitly stated TPMS light is on (steady_on behavior is standard for pressure warning) and new tires were installed yesterday (recent_action). No other symptoms or conditions mentioned; all other slots null."
extracted_facts:
  started_when: "just_now"
  warning_light_named: "tpms"
  warning_light_behavior: "steady_on"
  recent_action: "tire_rotation_or_replacement"
  customer_request_type: "diagnose_problem"
matched category key: tpms_testing
matched sub category slug: tpms_tire_pressure_light
unanswered question ids: [406, 408, 409]
testing service recommended: tpms_testing — Tire pressure (TPMS) light testing ($39.99)
}
```

<sub>S1: 13675ch · 2096ms · 3858/68t · S2: 13580ch · 1887ms · 4107/79t · S3: 20045ch · 3557ms · 25/280t · Total: 7541ms wall 7991ms · 7990/427t</sub>

### Test 4

```
{
concern: Mechanic flushed my coolant a week ago and now it's leaking from somewhere
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 74 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (extract facts, S3):        extracted 6 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [772, 773, 774, 775, 776, 777, 778]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports a coolant leak that appeared immediately after recent coolant flush service; this is a post-service concern best routed to an advisor rather than a standalone leak test." · S2: "Customer reports coolant leak occurring after recent coolant flush service (one week ago), directly matching the 'after recent service or repair work' subcategory." · S3: "Customer clearly stated coolant flush one week ago (recent_action=general_service, started_when=days_ago) and now has a leak. Coolant is green/orange/yellow/pink fluid, location under car but unspecified. No other symptoms mentioned."
extracted_facts:
  started_when: "days_ago"
  fluid_color: "green_or_orange_or_yellow_or_pink"
  fluid_under_car_location: "unsure"
  recent_action: "general_service"
  sound_or_smoke_location_zone: "under_car"
  customer_request_type: "fix_a_known_problem"
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [772, 773, 774, 775, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1632ms · 3864/70t · S2: 2848ch · 1663ms · 1190/69t · S3: 19089ch · 3752ms · 31/303t · Total: 7049ms wall 7606ms · 5085/442t</sub>

### Test 5

```
{
concern: I had spark plugs replaced and now my car runs rougher than before
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 66 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [772, 773, 774, 775, 776, 777, 778]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports rough running immediately after spark plug replacement elsewhere, a classic post-service concern requiring advisor evaluation rather than a specific diagnostic test." · S2: "Customer explicitly states 'spark plugs replaced' (recent service) followed by a new symptom ('runs rougher'), which directly matches the subcategory for issues arising after recent service or repair work." · S3: "Customer stated spark plug replacement and rougher running (engine_running=rough_idle, recent_action=general_service, sudden_onset). 'Rougher' most likely means idle roughness, but could also mean misfiring under load; set to rough_idle as the most literal interpretation. No location, speed, or other specifics provided."
extracted_facts:
  onset_timing: "after_warming_up"
  started_when: "sudden_onset"
  engine_running: "rough_idle"
  recent_action: "general_service"
  customer_request_type: "fix_a_known_problem"
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [772, 773, 774, 775, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1799ms · 3859/61t · S2: 2848ch · 3366ms · 1185/78t · S3: 19089ch · 3915ms · 26/311t · Total: 9082ms wall 9506ms · 5070/450t</sub>

### Test 6

```
{
concern: Replaced battery last month and now my car won't start in cold weather
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'slow_crank_sluggish_start'
  step 4 (extract facts, S3):        extracted 7 non-null slots
  step 5 (deterministic mapper):     answered=4 unanswered=3 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     3 unanswered IDs: [527, 528, 530]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports no-start in cold weather after recent battery replacement; charging/starting system testing will verify alternator output, starter draw, and battery condition to diagnose the cold-start issue." · S2: "Customer reports difficulty starting in cold weather after recent battery replacement, matching the slow/sluggish crank pattern that's 'frequently worse in cold weather' per the description, though the exact cranking behavior (clicks vs. slow rotation) isn't explicitly stated." · S3: "Customer clearly stated battery replacement ~1 month ago, won't start symptom triggered by cold weather at startup. No details on cranking speed, sounds, or lights—those remain null per extraction rules."
extracted_facts:
  onset_timing: "cold_start"
  started_when: "months_ago"
  engine_running: "wont_start"
  recent_action: "battery_or_alternator_work"
  weather_condition: "cold_weather"
  drivable_state: "drivable_but_concerned"
  customer_request_type: "diagnose_problem"
matched category key: charging_starting_testing
matched sub category slug: slow_crank_sluggish_start
unanswered question ids: [527, 528, 530]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 13675ch · 2380ms · 3859/67t · S2: 16833ch · 2561ms · 26/89t · S3: 19875ch · 3569ms · 26/287t · Total: 8510ms wall 8887ms · 3911/443t</sub>

### Test 7

```
{
concern: Just got the timing belt done and engine sounds different
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 57 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (extract facts, S3):        extracted 6 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [772, 773, 774, 775, 776, 777, 778]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports engine sound change immediately after timing belt service completion, which is a classic 'after recent service' situation requiring advisor review before diagnostic testing." · S2: "Customer explicitly states 'just got the timing belt done' and reports a symptom (engine sounds different) occurring after this recent service, directly matching the subcategory's scope." · S3: "Customer stated timing belt service and engine sounds different, but didn't describe the specific sound type (grinding, knocking, etc.), speed context, or severity. Set recent_action=general_service and onset_timing=at_startup as reasonable inference post-service, but engine_running=normal is conservative since 'different' doesn't clearly map to rough_idle or misfiring without more detail."
extracted_facts:
  onset_timing: "at_startup"
  started_when: "today"
  engine_running: "normal"
  recent_action: "general_service"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [772, 773, 774, 775, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1514ms · 3854/59t · S2: 2848ch · 2067ms · 1180/73t · S3: 19089ch · 4216ms · 21/313t · Total: 7797ms wall 8243ms · 5055/445t</sub>

### Test 8

```
{
concern: Oil change last week and now there's an oil spot on the driveway
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 64 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [772, 773, 774, 775, 776, 777, 778]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports an oil spot appearing immediately after an oil change performed elsewhere last week, indicating a potential service-related issue requiring advisor evaluation." · S2: "Customer reports an oil spot appearing after an oil change service last week—a classic post-service issue directly matching the subcategory's scope." · S3: "Customer explicitly stated oil change last week and oil spot on driveway. Inferred fluid_color as brown_or_black (engine oil) and fluid_under_car_location as under_engine_front (typical post-service leak location). Recent action and timing are literal. No other symptoms mentioned."
extracted_facts:
  started_when: "days_ago"
  fluid_color: "brown_or_black"
  fluid_under_car_location: "under_engine_front"
  recent_action: "oil_change"
  customer_request_type: "diagnose_problem"
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [772, 773, 774, 775, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1530ms · 3860/61t · S2: 2848ch · 2045ms · 1186/65t · S3: 19089ch · 3573ms · 27/300t · Total: 7148ms wall 7654ms · 5073/426t</sub>

### Test 9

```
{
concern: Got a P0420 code at autozone, what does that mean
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [372, 373, 374, 375, 376, 377, 378]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "P0420 is a specific check engine trouble code (catalyst system efficiency below threshold); customer needs code diagnosis and verification via scan tool and live data monitoring." · S2: "Customer mentions pulling a P0420 diagnostic trouble code, which is a direct positive example match for check_engine_light subcategory ("pulled a code and it said P0420")." · S3: "Customer stated a P0420 DTC code (catalyst system efficiency) which triggers check engine light, so warning_light_named='check engine' and customer_request_type='diagnose_problem'. No other symptoms, timing, or vehicle state details provided."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1630ms · 3859/62t · S2: 42816ch · 1610ms · 26/71t · S3: 19941ch · 3422ms · 26/279t · Total: 6664ms wall 7173ms · 3911/412t</sub>

### Test 10

```
{
concern: Check engine light on with P0301 P0302 P0303 - they said misfires
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 65 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'engine_misfire_or_bucking_feeling'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [513, 514, 515, 516, 517]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports check engine light with specific misfire codes (P0301, P0302, P0303), which directly maps to check engine light testing that includes scanning for trouble codes and monitoring live data." · S2: "Customer explicitly reports misfires with diagnostic codes P0301/P0302/P0303 (cylinder-specific misfire DTCs), matching the 'engine misfire or bucking feeling' description and positive example 'Check engine light is flashing and the car jerks every few seconds.'" · S3: "Customer explicitly stated check engine light is on and named misfires (P0301/P0302/P0303 are cylinder-specific misfire codes). Set engine_running=misfiring and warning_light_named=check engine. No other symptoms, timing, location, or conditions were described."
extracted_facts:
  warning_light_named: "check engine"
  warning_light_behavior: "steady_on"
  engine_running: "misfiring"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: engine_misfire_or_bucking_feeling
unanswered question ids: [513, 514, 515, 516, 517]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1642ms · 3867/72t · S2: 42816ch · 2348ms · 34/99t · S3: 19781ch · 3606ms · 34/293t · Total: 7596ms wall 7974ms · 3935/464t</sub>

### Test 11

```
{
concern: Scanner showed P0171 lean condition
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 35 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [372, 373, 374, 375, 376, 377, 378]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "P0171 is a specific check engine trouble code (system too lean); the customer has already scanned it and needs diagnostic testing to identify the root cause." · S2: "Customer reports a diagnostic trouble code (P0171 lean condition) detected by scanner, which is the hallmark of check_engine_light subcategory—OBD-II system storing a DTC indicating an actual engine problem." · S3: "Customer stated a diagnostic trouble code (P0171 lean condition) was found by a scanner, which implies a check engine light triggered the scan. Set warning_light_named to 'check engine' and customer_request_type to 'diagnose_problem' since they're reporting a code without stating symptoms. No other facts were literally stated."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1771ms · 3852/63t · S2: 42816ch · 1870ms · 19/79t · S3: 19941ch · 3523ms · 19/297t · Total: 7164ms wall 7564ms · 3890/439t</sub>

### Test 12

```
{
concern: Multiple codes - P0128 thermostat and P0440 evap
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 48 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [372, 373, 374, 375, 376, 377, 378]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports two specific check engine codes (P0128 thermostat, P0440 evap), which directly maps to check engine light testing that scans for and documents trouble codes." · S2: "Customer reports multiple diagnostic trouble codes (P0128 thermostat, P0440 EVAP) stored by OBD-II system—classic check engine light scenario with actual DTCs logged, matching positive example 'pulled a code and it said P0420'." · S3: "Customer named two specific diagnostic trouble codes (P0128 thermostat, P0440 EVAP) indicating a known problem requiring diagnosis/repair. No symptom details (timing, location, speed, noise, smell) were provided—only the codes themselves."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "fix_a_known_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1679ms · 3861/70t · S2: 42816ch · 2046ms · 28/88t · S3: 19941ch · 3389ms · 28/283t · Total: 7116ms wall 7630ms · 3917/441t</sub>

### Test 13

```
{
concern: P0455 large evap leak detected
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 30 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [372, 373, 374, 375, 376, 377, 378]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "P0455 is a specific check engine trouble code for a large EVAP system leak; the technician will scan for this code, monitor live data, and diagnose the fault." · S2: "Customer reports a diagnostic trouble code (P0455 — large EVAP leak) that triggered the check engine light. This is a classic OBD-II DTC scenario matching the check_engine_light subcategory description and positive example 'pulled a code and it said P0420'." · S3: "Customer stated a diagnostic trouble code (P0455 = large EVAP leak) which implies a check engine light triggered the code read. No other symptoms, timing, or conditions were described; most slots remain null. Request type inferred as diagnose_problem since they're reporting a detected fault."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 3693ms · 3853/69t · S2: 42816ch · 2155ms · 20/93t · S3: 19941ch · 3680ms · 20/286t · Total: 9528ms wall 9859ms · 3893/448t</sub>

### Test 14

```
{
concern: Got code P0700 transmission control system
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 42 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     35 unanswered IDs: [162, 163, 164, 165, 166, 167, 168, 455, 456, 457, 458, 459, 460, 461, 993, 994, 995, 996, 997, 998, 999, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195]
  step 7 (confidence per stage):     S1: high · S2: low · S3: medium
  step 8 (reasoning):                S1: "Customer reports code P0700, which is a transmission control system fault code; transmission_testing includes scanning for transmission-related faults and trouble codes." · S2: "P0700 is a generic transmission fault code that doesn't map to any specific symptom subcategory (hesitation, fluid leak, shaking, power loss, or surging). Stage 3 will need the actual symptom description to route correctly." · S3: "Customer stated a diagnostic trouble code (P0700) which maps to transmission control system warning light. Set warning_light_named and customer_request_type (diagnose_problem), but no other symptoms or contextual details were provided."
extracted_facts:
  warning_light_named: "transmission control system"
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: [162, 163, 164, 165, 166, 167, 168, 455, 456, 457, 458, 459, 460, 461, 993, 994, 995, 996, 997, 998, 999, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 13675ch · 2508ms · 3853/57t · S2: 11685ch · 1760ms · 3554/79t · S3: 18784ch · 3315ms · 20/274t · Total: 7586ms wall 8133ms · 7427/410t</sub>

### Test 15

```
{
concern: Reader says U0100 lost communication with ECM
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 45 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [372, 373, 374, 375, 376, 377, 378]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: medium
  step 8 (reasoning):                S1: "U0100 is a diagnostic trouble code indicating lost communication with the Engine Control Module (ECM); check_engine_light_testing includes scanning for trouble codes and monitoring live data to verify sensor readings and system performance." · S2: "U0100 is a diagnostic trouble code (DTC) indicating lost ECM communication, which triggers the check engine light / MIL. Customer's code-based report maps to CEL, though the description emphasizes the code itself rather than visible symptoms like rough running or flashing light." · S3: "Customer stated a diagnostic trouble code (U0100 = lost ECM communication), which implies a check engine light is present. Set warning_light_named to 'check engine' and customer_request_type to 'diagnose_problem' since they're reporting a code. No other symptoms or contextual details provided; all other slots null."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 2057ms · 3855/75t · S2: 42816ch · 6071ms · 22/91t · S3: 19941ch · 4002ms · 22/297t · Total: 12131ms wall 12637ms · 3899/463t</sub>

### Test 16

```
{
concern: I think my catalytic converter is shot, the car is sluggish
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'low_power_or_wont_accelerate_normally'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer reports sluggish performance and suspects catalytic converter failure; check engine light testing will scan for converter-related codes and verify sensor/system performance." · S2: "Customer reports sustained sluggishness and suspects catalytic converter failure; clogged catalytic converter is listed as a cause of low_power_or_wont_accelerate_normally. However, no check engine light or performance details provided, so confidence is medium rather than high." · S3: "Customer stated the car is 'sluggish' (low power during driving) and suspects a bad catalytic converter, but provided no specific speed, timing, or other diagnostic details. Set onset_timing to during_driving and customer_request_type to diagnose_problem; all other slots null as no literal facts were stated."
extracted_facts:
  onset_timing: "during_driving"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: low_power_or_wont_accelerate_normally
unanswered question ids: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1709ms · 3859/61t · S2: 42816ch · 1934ms · 26/97t · S3: 19789ch · 3862ms · 26/294t · Total: 7506ms wall 7996ms · 3911/452t</sub>

### Test 17

```
{
concern: Pretty sure it's the alternator going bad
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 41 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'battery_charging_light'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [385, 386, 387, 388, 389, 390, 391]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: low
  step 8 (reasoning):                S1: "Customer suspects alternator failure; charging_starting_testing includes alternator output testing and is the direct diagnostic service for this concern." · S2: "Customer suspects alternator failure, which is the primary cause of battery/charging light illumination and dim/flickering lights; without specific symptom details (light on vs. dimming), charging light is the most direct alternator-failure subcategory." · S3: "Customer stated a suspected diagnosis (alternator) but provided no literal symptom details—no mention of warning lights, dimming, noise, timing, or when the problem started. Only customer_request_type is extractable."
extracted_facts:
  customer_request_type: "fix_a_known_problem"
matched category key: charging_starting_testing
matched sub category slug: battery_charging_light
unanswered question ids: [385, 386, 387, 388, 389, 390, 391]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 13675ch · 5234ms · 3853/54t · S2: 16833ch · 2597ms · 20/82t · S3: 20000ch · 3754ms · 20/272t · Total: 11587ms wall 12093ms · 3893/408t</sub>

### Test 18

```
{
concern: Might be the throttle position sensor
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     153 unanswered IDs: [71, 72, 73, 74, 75, 76, 77, 106, 107, 108, 109, 110, 111, 112, 120, 121, 122, 123, 124, 125, 126, 155, 156, 157, 158, 159, 160, 161, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 372, 373, 374, 375, 376, 377, 378, 399, 400, 401, 402, 403, 404, 405, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 511, 512, 513, 514, 515, 516, 517, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 2219, 2220, 2221, 2222, 2223, 2224]
  step 7 (confidence per stage):     S1: medium · S2: low · S3: low
  step 8 (reasoning):                S1: "Customer suspects throttle position sensor fault, which typically triggers check engine codes; testing will scan for TPS-related trouble codes and verify sensor operation." · S2: "Customer suspects a component (throttle position sensor) rather than describing a symptom. Stage 1 routed to check_engine_light_testing, but no actual drivability symptom, light status, or code is mentioned—insufficient data to match a subcategory." · S3: "Customer named a suspected part (throttle position sensor) but provided no symptom details—no description of what the car is actually doing, when it happens, or how it feels. Only customer_request_type is extractable."
extracted_facts:
  customer_request_type: "fix_a_known_problem"
matched category key: check_engine_light_testing
matched sub category slug: null
unanswered question ids: [71, 72, 73, 74, 75, 76, 77, 106, 107, 108, 109, 110, 111, 112, 120, 121, 122, 123, 124, 125, 126, 155, 156, 157, 158, 159, 160, 161, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 372, 373, 374, 375, 376, 377, 378, 399, 400, 401, 402, 403, 404, 405, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 511, 512, 513, 514, 515, 516, 517, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 2219, 2220, 2221, 2222, 2223, 2224]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1726ms · 3852/60t · S2: 42816ch · 1933ms · 19/83t · S3: 18784ch · 3054ms · 19/273t · Total: 6717ms wall 7400ms · 3890/416t</sub>

### Test 19

```
{
concern: I read online it could be the mass air flow sensor
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 50 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     153 unanswered IDs: [71, 72, 73, 74, 75, 76, 77, 106, 107, 108, 109, 110, 111, 112, 120, 121, 122, 123, 124, 125, 126, 155, 156, 157, 158, 159, 160, 161, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 372, 373, 374, 375, 376, 377, 378, 399, 400, 401, 402, 403, 404, 405, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 511, 512, 513, 514, 515, 516, 517, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 2219, 2220, 2221, 2222, 2223, 2224]
  step 7 (confidence per stage):     S1: medium · S2: low · S3: low
  step 8 (reasoning):                S1: "Customer suspects a mass air flow (MAF) sensor issue, which typically triggers a check engine light and requires diagnostic scanning to confirm the fault code and sensor performance." · S2: "Customer mentions a potential cause (MAF sensor) but provides no actual symptom description (no noise, smell, performance issue, or light). Cannot match to a subcategory without knowing what the car is actually doing." · S3: "Customer only stated they read online that a mass air flow sensor might be the problem. No actual symptoms, timing, location, or vehicle behavior described. Only extractable fact is that they want a known problem fixed."
extracted_facts:
  customer_request_type: "fix_a_known_problem"
matched category key: check_engine_light_testing
matched sub category slug: null
unanswered question ids: [71, 72, 73, 74, 75, 76, 77, 106, 107, 108, 109, 110, 111, 112, 120, 121, 122, 123, 124, 125, 126, 155, 156, 157, 158, 159, 160, 161, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 372, 373, 374, 375, 376, 377, 378, 399, 400, 401, 402, 403, 404, 405, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 511, 512, 513, 514, 515, 516, 517, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 2219, 2220, 2221, 2222, 2223, 2224]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1593ms · 3855/63t · S2: 42816ch · 1797ms · 22/70t · S3: 18784ch · 3231ms · 22/269t · Total: 6623ms wall 7179ms · 3899/402t</sub>

### Test 20

```
{
concern: Mechanic friend said it sounds like the harmonic balancer
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 57 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Customer reports a mechanic friend's opinion about a harmonic balancer issue, but provides no actual symptom description (noise, vibration, performance problem). Too vague to categorize without knowing the underlying concern." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1760ms · 3857/67t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1760ms wall 2311ms · 3857/67t</sub>

### Test 21

```
{
concern: I think the wheel bearings are bad on the front passenger
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 57 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'humming_or_whirring_at_speed'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [85, 86, 87, 88, 89, 90, 91]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports suspected bad wheel bearings on front passenger side; suspension_steering_check includes inspection of suspension components and a road test to verify ride quality and handling, which would diagnose bearing wear." · S2: "Customer suspects worn wheel bearings, which is a classic cause of humming/whirring at speed. However, they haven't described the actual symptom (noise, vibration, etc.), only the suspected cause—making this a medium-confidence match pending symptom confirmation." · S3: "Customer explicitly identified location (front passenger = right front) and suspected cause (wheel bearings). No speed, timing, or symptom details provided; customer is stating a diagnosis, not describing symptoms."
extracted_facts:
  location_side: "right"
  location_axle: "front"
  sound_or_smoke_location_zone: "from_a_wheel"
  customer_request_type: "fix_a_known_problem"
matched category key: suspension_steering_check
matched sub category slug: humming_or_whirring_at_speed
unanswered question ids: [85, 86, 87, 88, 89, 90, 91]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 2169ms · 3856/63t · S2: 44059ch · 2230ms · 23/94t · S3: 19762ch · 3435ms · 23/270t · Total: 7834ms wall 8124ms · 3902/427t</sub>

### Test 22

```
{
concern: Sounds like exhaust manifold gasket leak
LLM decision tree:
  step 1 (match category, S1):       matched 'oil_leak_testing'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'burnt_oil_smell'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [232, 234, 235, 236, 237, 238]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer suspects exhaust manifold gasket leak (exhaust system issue), but catalog lacks exhaust-specific testing; oil_leak_testing is closest match for leak diagnosis involving gaskets and engine seals." · S2: "Customer mentions exhaust manifold gasket leak, which is a classic cause of burnt oil smell (oil dripping onto hot manifold). However, they describe the problem rather than the symptom (smell or puddle), so confidence is medium pending symptom clarification." · S3: "Customer identified exhaust manifold gasket leak (front, under-hood location, burnt-oil smell typical of this failure). However, they stated a diagnosis rather than describing symptoms, so speed/timing/onset details are absent. Set smell_descriptor to burnt_oil as that's the canonical symptom of this leak type."
extracted_facts:
  location_axle: "front"
  smell_descriptor: "burnt_oil"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: oil_leak_testing
matched sub category slug: burnt_oil_smell
unanswered question ids: [232, 234, 235, 236, 237, 238]
testing service recommended: oil_leak_testing — Oil leak testing ($179.95)
}
```

<sub>S1: 13675ch · 1712ms · 3854/66t · S2: 10670ch · 1982ms · 3246/85t · S3: 19904ch · 3738ms · 21/294t · Total: 7434ms wall 7926ms · 7121/445t</sub>

### Test 23

```
{
concern: Probably the IAC valve based on idle behavior
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 45 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Customer self-diagnosed a specific component (IAC valve) but provided no observable symptoms or concerns; this requires advisor handoff to verify the actual problem and recommend appropriate testing." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1613ms · 3854/58t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1613ms wall 2102ms · 3854/58t</sub>

### Test 24

```
{
concern: Might need a new fuel pump - cranks but won't start sometimes
LLM decision tree:
  step 1 (match category, S1):       matched 'no_start_testing'
  step 2 (vagueness check):          passed — description has 61 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'hard_to_start_when_cold'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [1170, 1171, 1172, 1173, 1174]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer reports intermittent no-start with cranking, suggesting fuel system issue; no_start_testing includes fuel pressure and injector pulse checks to diagnose the root cause." · S2: "Customer reports cranks but won't start sometimes; fuel pump failure can cause hard starts. However, no explicit cold/hot trigger mentioned, so medium confidence—could also fit hard_to_start_when_hot or stalling_while_driving_under_load depending on timing." · S3: "Customer stated engine cranks but won't start sometimes (intermittent no-start with cranking), suggesting fuel pump issue. Set engine_running=wont_start and onset_timing=at_startup. Customer named a suspected part (fuel pump) so customer_request_type=fix_a_known_problem. Intermittent nature and lack of cold/hot specificity leave started_when and weather_condition null."
extracted_facts:
  onset_timing: "at_startup"
  engine_running: "wont_start"
  customer_request_type: "fix_a_known_problem"
matched category key: no_start_testing
matched sub category slug: hard_to_start_when_cold
unanswered question ids: [1170, 1171, 1172, 1173, 1174]
testing service recommended: no_start_testing — No-start testing ($179.95)
}
```

<sub>S1: 13675ch · 1684ms · 3859/65t · S2: 11965ch · 1993ms · 3493/93t · S3: 19807ch · 3823ms · 26/322t · Total: 7501ms wall 8054ms · 7378/480t</sub>

### Test 25

```
{
concern: Could be a vacuum leak somewhere in the intake
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 46 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague and speculative ('could be') to confidently match a testing service; a vacuum leak diagnosis requires a full performance/drivability assessment best handled by an advisor." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1608ms · 3853/62t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1608ms wall 2135ms · 3853/62t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 16 |
| matched an 'other' subcategory (forward-to-advisor) | 6 |
| null match (forwarded to advisor) | 3 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 50277 ms |
| sum stage-2 latencies | 48928 ms |
| sum stage-3 latencies | 80294 ms |
| sum input tokens | 118754 |
| sum output tokens | 9787 |
| **stage 1** confidence: high / medium / low / missing | 18 / 4 / 3 / 0 |
| **stage 2** confidence: high / medium / low / missing | 12 / 7 / 3 / 3 |
| **stage 3** confidence: high / medium / low / missing | 8 / 11 / 3 / 3 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 13 / 120 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.50 (n=22) |
