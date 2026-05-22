# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T02:48:01.688Z
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
concern: Just had brakes replaced two days ago and now there's a grinding noise
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (extract facts, S3):        extracted 7 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [772, 773, 774, 775, 776, 777, 778]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports grinding noise immediately after brake replacement two days ago—a classic post-service concern that warrants advisor review before diagnostic testing." · S2: "Customer reports grinding noise immediately after brake replacement two days ago, directly matching the 'after recent service or repair work' subcategory—a clear post-service symptom." · S3: "Customer clearly stated brake work 2 days ago and grinding noise onset. Grinding from brakes suggests front axle, but customer didn't explicitly state which wheel or speed; location_side left null. Onset timing inferred as intermittent since no specific trigger mentioned."
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

<sub>S1: 16280ch · 1539ms · 26/61t · S2: 2848ch · 1494ms · 1185/72t · S3: 19089ch · 4183ms · 26/296t · Total: 7217ms wall 7754ms · 1237/429t</sub>

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
  step 8 (reasoning):                S1: "Customer reports steering wheel off-center immediately after recent alignment service — a classic post-service issue requiring advisor review rather than a standalone diagnostic test." · S2: "Customer reports steering wheel off-center immediately after recent alignment service, directly matching the subcategory for issues arising after recent service or repair work." · S3: "Customer explicitly stated alignment work last week and steering wheel is off-center while driving straight. No other symptoms mentioned. Recent action and steering feel are literal matches; started_when inferred from 'last week' as days_ago; customer_request_type is fix_a_known_problem since they identified the issue post-service."
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

<sub>S1: 16280ch · 1607ms · 26/63t · S2: 2848ch · 1505ms · 1185/65t · S3: 19089ch · 3675ms · 26/306t · Total: 6790ms wall 7402ms · 1237/434t</sub>

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
  step 8 (reasoning):                S1: "Customer reports TPMS light on after new tire installation yesterday; TPMS testing includes sensor verification, pressure checks, and reprogramming after tire changes." · S2: "Customer reports TPMS light on after recent tire installation—a classic sensor relearn scenario. Matches positive example 'Tire pressure light came on after I had new tires put on last week' and the description's note on post-service sensor relearning." · S3: "Customer explicitly stated TPMS light is on (steady_on behavior is standard for pressure warning) and new tires were installed yesterday (recent_action). No other symptoms or conditions mentioned; all other slots null."
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

<sub>S1: 16280ch · 1706ms · 25/62t · S2: 13580ch · 1882ms · 4107/91t · S3: 20045ch · 3542ms · 25/280t · Total: 7131ms wall 7609ms · 4157/433t</sub>

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
  step 8 (reasoning):                S1: "Customer reports a coolant leak that appeared immediately after recent coolant flush service; this is a post-service concern requiring advisor evaluation before diagnostic testing." · S2: "Customer reports coolant leak occurring after recent coolant flush service (one week ago), directly matching the 'after recent service or repair work' subcategory." · S3: "Customer clearly stated coolant flush one week ago (recent_action=general_service, started_when=days_ago) and now has a leak. Coolant is green/orange/yellow/pink fluid, location under car but unspecified. No other symptoms mentioned."
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

<sub>S1: 16280ch · 2201ms · 31/64t · S2: 2848ch · 1349ms · 1190/69t · S3: 19089ch · 3948ms · 31/303t · Total: 7500ms wall 8043ms · 1252/436t</sub>

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
  step 8 (reasoning):                S1: "Customer reports worsening performance ('runs rougher') immediately after spark plug replacement work, which is a classic post-service concern requiring advisor evaluation." · S2: "Customer reports rough running immediately after spark plug replacement service, directly matching the 'after recent service or repair work' subcategory." · S3: "Customer stated spark plug replacement and rough running afterward (engine_running=rough_idle, recent_action=general_service, started_when=sudden_onset). 'Rougher than before' implies post-service onset, but customer didn't specify idle vs. load, so onset_timing is inferred as after_warming_up rather than when_idling. No location, speed, or other symptom details provided."
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

<sub>S1: 16280ch · 4147ms · 26/64t · S2: 2848ch · 10589ms · 1185/63t · S3: 19089ch · 4184ms · 26/326t · Total: 18921ms wall 19500ms · 1237/453t</sub>

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
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports no-start in cold weather after recent battery replacement; could indicate a defective new battery, poor connection, or alternator/charging issue — charging_starting_testing covers battery load test and alternator output verification." · S2: "Cold-weather start difficulty with recent battery replacement suggests weak cranking speed rather than complete no-crank; however, 'won't start' could also indicate a firing issue, making this a medium-confidence pick pending clarification on whether the engine turns over slowly or not at all." · S3: "Customer clearly stated battery replacement ~1 month ago, won't start specifically in cold weather (onset_timing=cold_start, weather_condition=cold_weather), and engine doesn't fire (engine_running=wont_start). No other symptoms mentioned; all other slots null."
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

<sub>S1: 16280ch · 1890ms · 26/74t · S2: 16833ch · 2240ms · 26/94t · S3: 19875ch · 3485ms · 26/305t · Total: 7615ms wall 8067ms · 78/473t</sub>

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
  step 8 (reasoning):                S1: "Customer reports an engine sound change immediately after timing belt service completion—a classic post-service concern requiring advisor evaluation before diagnostic testing." · S2: "Customer explicitly states 'just got the timing belt done' and reports a symptom (engine sounds different) occurring after this recent service, directly matching the subcategory's scope." · S3: "Customer stated timing belt service and engine sounds different, but didn't describe the specific sound type (grinding, knocking, etc.), so noise_descriptor is null. 'Different' suggests onset after the service (at_startup as engine-related), and recent_action=general_service captures the timing belt work. Customer appears to want diagnosis of the new sound."
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

<sub>S1: 16280ch · 1530ms · 21/60t · S2: 2848ch · 2018ms · 1180/73t · S3: 19089ch · 4051ms · 21/304t · Total: 7599ms wall 8091ms · 1222/437t</sub>

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
  step 8 (reasoning):                S1: "Customer reports an oil spot appearing immediately after an oil change performed elsewhere, indicating a potential service-related issue that requires advisor evaluation rather than a standalone diagnostic test." · S2: "Customer reports an oil spot appearing after an oil change service last week—a classic post-service issue directly matching the subcategory's scope." · S3: "Customer explicitly stated oil change last week and oil spot on driveway. Inferred fluid_color as brown_or_black (engine oil) and fluid_under_car_location as under_engine_front (typical post-service leak location). Recent action and timing are literal. Request type inferred as diagnose_problem (leak cause unknown)."
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

<sub>S1: 16280ch · 1782ms · 27/66t · S2: 2848ch · 2259ms · 1186/65t · S3: 19089ch · 3659ms · 27/309t · Total: 7703ms wall 8174ms · 1240/440t</sub>

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
  step 8 (reasoning):                S1: "P0420 is a stored check engine trouble code (catalyst system efficiency below threshold); customer needs code scanning and diagnosis per check_engine_light_testing service." · S2: "Customer mentions a diagnostic trouble code (P0420) pulled from the vehicle, which is a direct match to the check_engine_light subcategory positive example 'My MIL is on — pulled a code and it said P0420'." · S3: "Customer stated they have a P0420 code (catalyst system efficiency fault), which triggers check engine light. No symptom description, location, timing, or drivability info provided; customer is asking what the code means (diagnose_problem). Warning light behavior not stated."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1713ms · 26/64t · S2: 42816ch · 5295ms · 26/82t · S3: 19941ch · 3463ms · 26/281t · Total: 10472ms wall 10989ms · 78/427t</sub>

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
  step 8 (reasoning):                S1: "Customer reports check engine light with specific misfire codes (P0301, P0302, P0303), which directly maps to check_engine_light_testing for trouble code scanning and diagnosis." · S2: "Customer explicitly reports misfires with diagnostic codes P0301/P0302/P0303 (cylinder-specific misfire DTCs), matching the engine_misfire_or_bucking_feeling description and positive example 'Check engine light is flashing and the car jerks every few seconds.'" · S3: "Customer explicitly stated check engine light is on and named misfires (P0301/P0302/P0303 are cylinder-specific misfire codes). Set warning_light_named, warning_light_behavior, and engine_running accordingly. No other symptoms or contextual details provided."
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

<sub>S1: 16280ch · 5106ms · 34/71t · S2: 42816ch · 2045ms · 34/103t · S3: 19781ch · 3566ms · 34/290t · Total: 10718ms wall 11359ms · 102/464t</sub>

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
  step 8 (reasoning):                S1: "P0171 is a stored check engine trouble code (system too lean); the technician will scan for codes, monitor live data, and review TSBs to diagnose the root cause." · S2: "Customer reports a diagnostic trouble code (P0171 lean condition) detected by scanner, which is the hallmark of check_engine_light — a stored DTC from the OBD-II system indicating an actual engine problem requiring diagnosis." · S3: "Customer stated a diagnostic trouble code (P0171 lean condition) was found by a scanner, which implies a check engine light triggered the scan. Set warning_light_named to 'check engine' and customer_request_type to 'diagnose_problem' since they're reporting a code without stating symptoms. All other slots null as no symptom details were provided."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 2109ms · 19/70t · S2: 42816ch · 1868ms · 19/80t · S3: 19941ch · 3557ms · 19/302t · Total: 7536ms wall 8088ms · 57/452t</sub>

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
  step 8 (reasoning):                S1: "Customer reports two specific diagnostic trouble codes (P0128 thermostat, P0440 evap) requiring code scan and diagnosis — directly matching check_engine_light_testing scope." · S2: "Customer reports multiple diagnostic trouble codes (P0128, P0440) stored in the OBD-II system—the defining characteristic of check_engine_light subcategory, which covers actual problems detected and coded by the engine computer." · S3: "Customer named two specific diagnostic trouble codes (P0128 thermostat, P0440 EVAP) indicating a known problem requiring diagnosis/repair. No symptom details, timing, location, or driving conditions were described."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "fix_a_known_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1834ms · 28/70t · S2: 42816ch · 1738ms · 28/80t · S3: 19941ch · 3193ms · 28/275t · Total: 6767ms wall 7126ms · 84/425t</sub>

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
  step 8 (reasoning):                S1: "P0455 is a specific diagnostic trouble code for a large EVAP system leak; check_engine_light_testing includes scanning for stored codes and monitoring live data to verify sensor readings and system performance." · S2: "Customer reports a diagnostic trouble code (P0455) indicating a large EVAP leak — a classic OBD-II DTC that triggers the check engine light. This matches the check_engine_light subcategory's description of stored diagnostic trouble codes and the positive example 'My MIL is on — pulled a code and it said P0420'." · S3: "Customer stated a specific OBD-II code (P0455 = large EVAP leak), which triggers the check-engine light. No other symptoms, timing, or vehicle state details were provided. Set warning_light_named to 'check engine' (implied by the DTC) and customer_request_type to 'diagnose_problem' (they're reporting a detected fault). All other slots null."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 2000ms · 20/73t · S2: 42816ch · 2508ms · 20/106t · S3: 19941ch · 3812ms · 20/313t · Total: 8320ms wall 8690ms · 60/492t</sub>

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

<sub>S1: 16280ch · 1474ms · 20/57t · S2: 11685ch · 6437ms · 3554/79t · S3: 18784ch · 3586ms · 20/274t · Total: 11500ms wall 12372ms · 3594/410t</sub>

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
  step 8 (reasoning):                S1: "U0100 is a diagnostic trouble code indicating lost communication with the Engine Control Module (ECM); check_engine_light_testing scans for codes and monitors live data to verify sensor readings and system performance." · S2: "U0100 is a diagnostic trouble code (DTC) stored by the OBD-II system, indicating a communication fault with the engine control module. While this is a real problem triggering the check engine light, the customer's lead complaint is a specific code rather than a drivability symptom, making the match less direct than a typical CEL report." · S3: "Customer stated a diagnostic trouble code (U0100 = lost ECM communication), which implies a check engine light is present. Set warning_light_named to 'check engine' and customer_request_type to 'diagnose_problem' since they're reporting a fault code. No other symptoms or contextual details provided."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1549ms · 22/74t · S2: 42816ch · 2190ms · 22/106t · S3: 19941ch · 3350ms · 22/293t · Total: 7091ms wall 7501ms · 66/473t</sub>

### Test 16

```
{
concern: I think my catalytic converter is shot, the car is sluggish
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'low_power_or_wont_accelerate_normally'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer suspects catalytic converter failure ('shot') and reports sluggish performance; catalytic converter issues typically trigger check engine codes and performance loss, routing to check_engine_light_testing for diagnosis." · S2: "Customer reports 'sluggish' car, which matches sustained loss of power; clogged catalytic converter is listed as a common cause. However, 'sluggish' alone is less specific than positive examples like 'no power' or 'won't pick up speed,' warranting medium confidence." · S3: "Customer stated the car is 'sluggish' (low power symptom matching the subcategory) and suspects a bad catalytic converter. However, they provided no details on speed, timing, location, or other diagnostic signals—only a symptom and a hypothesis. Set customer_request_type to 'fix_a_known_problem' since they identified the suspected issue."
extracted_facts:
  customer_request_type: "fix_a_known_problem"
matched category key: check_engine_light_testing
matched sub category slug: low_power_or_wont_accelerate_normally
unanswered question ids: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1671ms · 26/71t · S2: 42816ch · 2302ms · 26/103t · S3: 19789ch · 3612ms · 26/306t · Total: 7588ms wall 8142ms · 78/480t</sub>

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
  step 8 (reasoning):                S1: "Customer suspects alternator failure; charging_starting_testing includes alternator output testing and is the appropriate diagnostic for this electrical charging system concern." · S2: "Customer suspects alternator failure, which is the primary cause of battery/charging light illumination and dim lights. However, they haven't described specific symptoms (light on, dimming, etc.), so confidence is medium pending symptom confirmation." · S3: "Customer stated a suspected diagnosis (alternator) but provided no literal symptom details—no mention of warning lights, dimming, noise, timing, or when the problem started. Only customer_request_type is extractable."
extracted_facts:
  customer_request_type: "fix_a_known_problem"
matched category key: charging_starting_testing
matched sub category slug: battery_charging_light
unanswered question ids: [385, 386, 387, 388, 389, 390, 391]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 16280ch · 3615ms · 20/56t · S2: 16833ch · 2053ms · 20/78t · S3: 20000ch · 3509ms · 20/272t · Total: 9178ms wall 9640ms · 60/406t</sub>

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
  step 8 (reasoning):                S1: "Customer suspects throttle position sensor fault, which is an engine control sensor issue typically diagnosed via trouble codes and live data monitoring—core to check engine light testing." · S2: "Customer suspects a component (throttle position sensor) rather than describing a symptom. Stage 1 routed to check_engine_light_testing, but no drivability symptom, light status, or code is mentioned—insufficient data to match a subcategory." · S3: "Customer named a suspected part (throttle position sensor) but provided no symptom details—no description of what the car is actually doing, when it happens, or how it feels. Only customer_request_type is extractable."
extracted_facts:
  customer_request_type: "fix_a_known_problem"
matched category key: check_engine_light_testing
matched sub category slug: null
unanswered question ids: [71, 72, 73, 74, 75, 76, 77, 106, 107, 108, 109, 110, 111, 112, 120, 121, 122, 123, 124, 125, 126, 155, 156, 157, 158, 159, 160, 161, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 372, 373, 374, 375, 376, 377, 378, 399, 400, 401, 402, 403, 404, 405, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 511, 512, 513, 514, 515, 516, 517, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 2219, 2220, 2221, 2222, 2223, 2224]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1837ms · 19/62t · S2: 42816ch · 2018ms · 19/82t · S3: 18784ch · 3056ms · 19/273t · Total: 6913ms wall 7271ms · 57/417t</sub>

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
  step 8 (reasoning):                S1: "Customer suspects a mass air flow (MAF) sensor issue, which typically triggers a check engine light and requires diagnostic scanning to confirm; however, no actual symptom (light, performance issue) was described, so medium confidence." · S2: "Customer mentions a potential cause (MAF sensor) but provides no actual symptom description (no smoke, noise, performance issue, light, or smell). Stage 3 needs the actual complaint to route correctly." · S3: "Customer only stated they read online that a mass air flow sensor might be the problem. No actual symptoms, timing, location, or vehicle behavior described. Only extractable fact is that they want a known problem fixed."
extracted_facts:
  customer_request_type: "fix_a_known_problem"
matched category key: check_engine_light_testing
matched sub category slug: null
unanswered question ids: [71, 72, 73, 74, 75, 76, 77, 106, 107, 108, 109, 110, 111, 112, 120, 121, 122, 123, 124, 125, 126, 155, 156, 157, 158, 159, 160, 161, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 372, 373, 374, 375, 376, 377, 378, 399, 400, 401, 402, 403, 404, 405, 455, 456, 457, 458, 459, 460, 461, 462, 463, 464, 465, 466, 467, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477, 478, 479, 480, 481, 482, 511, 512, 513, 514, 515, 516, 517, 1168, 1169, 1170, 1171, 1172, 1173, 1174, 1175, 1176, 1177, 1178, 1179, 1180, 1181, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195, 2219, 2220, 2221, 2222, 2223, 2224]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 2003ms · 22/76t · S2: 42816ch · 2346ms · 22/68t · S3: 18784ch · 3222ms · 22/269t · Total: 7573ms wall 8067ms · 66/413t</sub>

### Test 20

```
{
concern: Mechanic friend said it sounds like the harmonic balancer
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 57 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'deep_knocking_from_the_engine'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [120, 121, 122, 123, 124, 125, 126]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: low
  step 8 (reasoning):                S1: "Harmonic balancer issues typically manifest as engine noise/vibration and may trigger check engine codes; without additional symptoms (warning light, specific noise description), check_engine_light_testing is the best diagnostic entry point." · S2: "Harmonic balancer failure typically produces a deep knocking/thumping from the lower engine block, matching the deep_knocking description; however, the customer is reporting a mechanic's diagnosis rather than describing the actual symptom they hear, creating some ambiguity about the precise noise character." · S3: "Customer only stated a mechanic friend's diagnosis (harmonic balancer) without describing the actual symptom. Inferred knocking_deep (typical harmonic balancer failure), front location, under_hood zone, and diagnose_problem intent, but most timing/speed/onset details are absent."
extracted_facts:
  location_axle: "front"
  noise_descriptor: "knocking_deep"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: deep_knocking_from_the_engine
unanswered question ids: [120, 121, 122, 123, 124, 125, 126]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1753ms · 24/76t · S2: 42816ch · 2183ms · 24/97t · S3: 19723ch · 3655ms · 24/291t · Total: 7592ms wall 7985ms · 72/464t</sub>

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
  step 8 (reasoning):                S1: "Customer reports suspected bad front passenger wheel bearings, which is a suspension component inspection covered under suspension_steering_check ($89.95) that includes joint and bearing wear assessment." · S2: "Customer suspects worn wheel bearings, which is the classic cause of humming/whirring at speed; however, they haven't described the actual symptom (hum, whir, noise level change with speed/steering), only the suspected component, so confidence is medium pending symptom confirmation." · S3: "Customer explicitly stated suspected wheel bearing issue on front passenger side (right, front). Set location_side=right, location_axle=front, sound_or_smoke_location_zone=from_a_wheel, and customer_request_type=fix_a_known_problem. No speed, timing, or symptom details provided; all other slots null."
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

<sub>S1: 16280ch · 1782ms · 23/64t · S2: 44059ch · 2432ms · 23/98t · S3: 19762ch · 3379ms · 23/307t · Total: 7596ms wall 8022ms · 69/469t</sub>

### Test 22

```
{
concern: Sounds like exhaust manifold gasket leak
LLM decision tree:
  step 1 (match category, S1):       matched 'exhaust_system_testing'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'exhaust_manifold_tick_or_puff'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=0 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer explicitly describes 'exhaust manifold gasket leak,' which is a core exhaust system concern covered by exhaust_system_testing (manifold gasket leaks produce ticking sounds from engine bay)." · S2: "Customer explicitly mentions 'exhaust manifold gasket leak,' which is the classic symptom described for exhaust_manifold_tick_or_puff and appears verbatim in positive examples and synonyms." · S3: "Customer identified the problem (exhaust manifold gasket leak) rather than describing symptoms. Inferred location_axle=front and noise_descriptor=ticking_or_tapping from the subcategory context, and sound_or_smoke_location_zone=under_hood as typical for manifold leaks. Set customer_request_type=diagnose_problem since they're asking us to confirm/evaluate their diagnosis. Most other slots remain null as no specific symptom details were provided."
extracted_facts:
  location_axle: "front"
  noise_descriptor: "ticking_or_tapping"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: exhaust_system_testing
matched sub category slug: exhaust_manifold_tick_or_puff
unanswered question ids: []
testing service recommended: exhaust_system_testing — Exhaust system evaluation ($39.99)
}
```

<sub>S1: 16280ch · 1583ms · 21/73t · S2: 10596ch · 1716ms · 3418/82t · S3: 19906ch · 4140ms · 21/336t · Total: 7443ms wall 7962ms · 3460/491t</sub>

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
  step 8 (reasoning):                S1: "Customer self-diagnosed an IAC valve issue based on idle behavior, but this is a symptom description (idle problem) without enough detail to confirm the root cause or route to a specific test; advisor handoff recommended." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1741ms · 21/68t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1741ms wall 2274ms · 21/68t</sub>

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
  step 8 (reasoning):                S1: "Customer reports intermittent no-start with cranking, suggesting fuel system issue; no_start_testing includes fuel pressure and injector pulse checks to diagnose the cause." · S2: "Customer reports cranks but won't start sometimes; fuel pump failure can cause hard starts. However, no explicit cold/hot trigger mentioned, so confidence is medium rather than high." · S3: "Customer stated engine cranks but won't start sometimes (intermittent no-start at startup), and suspects fuel pump. Set engine_running=wont_start and onset_timing=at_startup; customer_request_type=fix_a_known_problem because they named a suspected part. Intermittent nature not explicitly captured in onset_timing enum, so onset_timing is best-fit rather than perfect."
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

<sub>S1: 16280ch · 1806ms · 26/64t · S2: 11965ch · 3920ms · 3493/70t · S3: 19807ch · 4083ms · 26/320t · Total: 9810ms wall 10338ms · 3545/454t</sub>

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
  step 8 (reasoning):                S1: "Description is too vague and speculative ('could be') to confidently route to a specific test; vacuum-leak diagnosis typically emerges during check_engine_light_testing or general electrical/performance work, not as a standalone service." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1886ms · 20/72t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1887ms wall 2381ms · 20/72t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 17 |
| matched an 'other' subcategory (forward-to-advisor) | 6 |
| null match (forwarded to advisor) | 2 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 51864 ms |
| sum stage-2 latencies | 64387 ms |
| sum stage-3 latencies | 83910 ms |
| sum input tokens | 23149 |
| sum output tokens | 10412 |
| **stage 1** confidence: high / medium / low / missing | 18 / 5 / 2 / 0 |
| **stage 2** confidence: high / medium / low / missing | 13 / 7 / 3 / 2 |
| **stage 3** confidence: high / medium / low / missing | 8 / 11 / 4 / 2 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 12 / 121 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.48 (n=23) |
