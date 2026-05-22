# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T01:40:32.704Z
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
concern: TPMS light came on and won't go off even after I checked the tire pressures
LLM decision tree:
  step 1 (match category, S1):       matched 'tpms_testing'
  step 2 (vagueness check):          passed — description has 75 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'tpms_tire_pressure_light'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [406, 408, 409, 410, 411]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports TPMS light that persists despite checking tire pressures—a classic TPMS sensor/system fault requiring diagnostic scanning and sensor inspection." · S2: "Customer leads with 'TPMS light came on' (positive example match) and describes it staying on despite checking pressures, indicating a potential sensor fault or persistent underinflation—core TPMS light scenario." · S3: "Customer explicitly named TPMS light and stated it remains steady on despite checking tire pressures. This suggests a system fault (dead/missing sensor) rather than actual low pressure. No other symptoms mentioned."
extracted_facts:
  warning_light_named: "tpms"
  warning_light_behavior: "steady_on"
  customer_request_type: "diagnose_problem"
matched category key: tpms_testing
matched sub category slug: tpms_tire_pressure_light
unanswered question ids: [406, 408, 409, 410, 411]
testing service recommended: tpms_testing — Tire pressure (TPMS) light testing ($39.99)
}
```

<sub>S1: 13675ch · 1822ms · 3864/61t · S2: 13580ch · 1958ms · 4113/82t · S3: 20045ch · 3419ms · 31/269t · Total: 7201ms wall 7744ms · 8008/412t</sub>

### Test 2

```
{
concern: Traction control light flashes randomly while driving
LLM decision tree:
  step 1 (match category, S1):       matched 'abs_traction_stability_testing'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'traction_control_stability_light'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [435, 436, 437, 438, 439, 440]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports traction control light flashing randomly while driving, which directly indicates ABS/traction/stability system fault requiring diagnostic scanning and sensor inspection." · S2: "Customer describes traction control light flashing while driving, which matches the positive example 'Little car-skidding symbol came on after I drove through snow' and the description that flashing is NORMAL when the system actively intervenes." · S3: "Customer clearly stated traction control light flashes (warning_light_behavior) while driving (onset_timing, speed_band). No other symptoms or details provided; all other slots null per extraction rules."
extracted_facts:
  speed_band: "all_speeds"
  onset_timing: "during_driving"
  warning_light_named: "traction control"
  warning_light_behavior: "flashing_or_blinking"
matched category key: abs_traction_stability_testing
matched sub category slug: traction_control_stability_light
unanswered question ids: [435, 436, 437, 438, 439, 440]
testing service recommended: abs_traction_stability_testing — ABS / traction / stability light testing ($179.95)
}
```

<sub>S1: 13675ch · 1543ms · 3854/62t · S2: 6990ch · 1674ms · 2303/82t · S3: 20086ch · 6661ms · 21/274t · Total: 9879ms wall 10259ms · 6178/418t</sub>

### Test 3

```
{
concern: Service engine soon light came on yesterday
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'service_engine_soon_or_maintenance_required_light'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [2220, 2221, 2222, 2223, 2224]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports 'Service engine soon light came on' — a check engine light symptom that directly maps to check_engine_light_testing service for trouble code scanning and diagnosis." · S2: "Customer explicitly states 'Service engine soon light came on' — a verbatim match to the subcategory description and positive examples for scheduled maintenance reminders." · S3: "Customer stated 'Service engine soon light came on yesterday' — a clear scheduled-service reminder with no drivability symptoms. Extracted warning_light_named, warning_light_behavior (steady_on), started_when (days_ago), and engine_running (normal). All other slots null as no symptoms were described."
extracted_facts:
  started_when: "days_ago"
  warning_light_named: "service engine soon"
  warning_light_behavior: "steady_on"
  engine_running: "normal"
matched category key: check_engine_light_testing
matched sub category slug: service_engine_soon_or_maintenance_required_light
unanswered question ids: [2220, 2221, 2222, 2223, 2224]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1577ms · 3851/67t · S2: 42816ch · 2241ms · 18/71t · S3: 20048ch · 3836ms · 18/295t · Total: 7655ms wall 8010ms · 3887/433t</sub>

### Test 4

```
{
concern: BAS light is on along with the ABS light
LLM decision tree:
  step 1 (match category, S1):       matched 'abs_traction_stability_testing'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'abs_anti_lock_brake_light'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [413, 414, 415, 416, 417, 418]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports both BAS (Brake Assist System) and ABS lights on, which are brake/stability system warning indicators that require ABS/traction/stability diagnostic testing to scan codes and inspect related sensors." · S2: "Customer mentions ABS light explicitly; BAS (Brake Assist System) is a related ABS component. Positive example match: 'ABS and traction control lights both on, brakes work normal otherwise' shows multiple lights can appear together with ABS as the primary concern." · S3: "Customer explicitly named two dashboard warning lights (ABS and BAS) that are both on simultaneously. No other symptoms, timing, or contextual details were provided."
extracted_facts:
  warning_light_named: "abs, bas"
  warning_light_behavior: "multiple_lights_at_once"
matched category key: abs_traction_stability_testing
matched sub category slug: abs_anti_lock_brake_light
unanswered question ids: [413, 414, 415, 416, 417, 418]
testing service recommended: abs_traction_stability_testing — ABS / traction / stability light testing ($179.95)
}
```

<sub>S1: 13675ch · 1873ms · 3855/76t · S2: 6990ch · 2411ms · 2304/94t · S3: 20023ch · 3838ms · 22/261t · Total: 8123ms wall 8711ms · 6181/431t</sub>

### Test 5

```
{
concern: Low fuel light keeps flickering even when I have half a tank
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     7 unanswered IDs: [448, 449, 450, 451, 452, 453, 454]
  step 7 (confidence per stage):     S1: high · S2: low · S3: high
  step 8 (reasoning):                S1: "Customer reports a warning light (low fuel light) that flickers intermittently despite adequate fuel level, indicating a sensor or electrical fault requiring diagnostic scanning." · S2: "Customer describes a single warning light (fuel light) flickering intermittently, not multiple lights simultaneously. This does not match the 'multiple_warning_lights_at_once' subcategory, which requires THREE+ lights or explicit 'all lights' phrasing." · S3: "Customer clearly stated the low fuel warning light is flickering despite having half a tank. This is a literal dashboard light behavior issue; no other symptoms or conditions were mentioned."
extracted_facts:
  warning_light_named: "low fuel"
  warning_light_behavior: "flashing_or_blinking"
  customer_request_type: "diagnose_problem"
matched category key: warning_light_general
matched sub category slug: null
unanswered question ids: [448, 449, 450, 451, 452, 453, 454]
testing service recommended: warning_light_general — Warning light testing (general / unspecified light) ($179.95)
}
```

<sub>S1: 13675ch · 1770ms · 3857/59t · S2: 4953ch · 1925ms · 1678/83t · S3: 18784ch · 3401ms · 24/264t · Total: 7100ms wall 7545ms · 5559/406t</sub>

### Test 6

```
{
concern: Parking brake light stays on after I release the brake
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 54 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     7 unanswered IDs: [448, 449, 450, 451, 452, 453, 454]
  step 7 (confidence per stage):     S1: high · S2: low · S3: high
  step 8 (reasoning):                S1: "Customer reports a parking brake warning light that remains illuminated after releasing the brake, a clear warning light symptom requiring diagnostic scanning and trouble code review." · S2: "Customer describes a single warning light (parking brake) that persists after releasing the brake. This does not match 'multiple_warning_lights_at_once' (requires THREE+ lights or 'all lights' phrasing). No other subcategory exists in this category for single-light issues." · S3: "Customer clearly stated the parking brake warning light remains illuminated after releasing the brake. This is a literal dashboard light behavior (steady_on) with no other symptoms mentioned."
extracted_facts:
  warning_light_named: "parking brake"
  warning_light_behavior: "steady_on"
  customer_request_type: "diagnose_problem"
matched category key: warning_light_general
matched sub category slug: null
unanswered question ids: [448, 449, 450, 451, 452, 453, 454]
testing service recommended: warning_light_general — Warning light testing (general / unspecified light) ($179.95)
}
```

<sub>S1: 13675ch · 1768ms · 3855/58t · S2: 4953ch · 4121ms · 1676/89t · S3: 18784ch · 3232ms · 22/260t · Total: 9123ms wall 9619ms · 5553/407t</sub>

### Test 7

```
{
concern: Transmission temp light came on during a long highway drive
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     35 unanswered IDs: [162, 163, 164, 165, 166, 167, 168, 455, 456, 457, 458, 459, 460, 461, 993, 994, 995, 996, 997, 998, 999, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195]
  step 7 (confidence per stage):     S1: high · S2: low · S3: high
  step 8 (reasoning):                S1: "Customer reports transmission temperature light during highway driving, which directly indicates a transmission system concern requiring diagnostic testing and fluid/component inspection." · S2: "Transmission temperature warning light is a diagnostic alert, not a symptom matching any subcategory (hesitation, fluid leak, shaking, power loss, or RPM surge). Requires mechanic inspection to determine underlying cause." · S3: "Customer explicitly stated transmission temp warning light came on during highway driving. Set speed_band=highway, onset_timing=during_driving, warning_light_named='transmission temp', and warning_light_behavior=came_on_then_off (light appeared during drive). All other slots null as no other symptoms described."
extracted_facts:
  speed_band: "highway"
  onset_timing: "during_driving"
  warning_light_named: "transmission temp"
  warning_light_behavior: "came_on_then_off"
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: [162, 163, 164, 165, 166, 167, 168, 455, 456, 457, 458, 459, 460, 461, 993, 994, 995, 996, 997, 998, 999, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 13675ch · 1779ms · 3855/51t · S2: 11685ch · 2349ms · 3556/72t · S3: 18784ch · 3629ms · 22/299t · Total: 7757ms wall 8374ms · 7433/422t</sub>

### Test 8

```
{
concern: Battery light came on but the car is still running fine
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 55 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'battery_charging_light'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [385, 387, 388, 389, 390, 391]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Battery warning light indicates a charging system issue; 'charging_starting_testing' includes battery load test and alternator output verification to diagnose the fault." · S2: "Customer explicitly mentions battery light coming on while car is running—a direct positive example match for battery_charging_light subcategory." · S3: "Customer explicitly stated battery warning light is on and engine runs normally. No other symptoms mentioned. Set warning_light_named='battery', warning_light_behavior='steady_on' (light came on, implying continuous), engine_running='normal', drivable_state='drivable_normally', and customer_request_type='diagnose_problem' (seeking cause)."
extracted_facts:
  warning_light_named: "battery"
  warning_light_behavior: "steady_on"
  engine_running: "normal"
  drivable_state: "drivable_normally"
  customer_request_type: "diagnose_problem"
matched category key: charging_starting_testing
matched sub category slug: battery_charging_light
unanswered question ids: [385, 387, 388, 389, 390, 391]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 13675ch · 1619ms · 3855/60t · S2: 16833ch · 1469ms · 22/57t · S3: 20000ch · 4179ms · 22/309t · Total: 7267ms wall 7800ms · 3899/426t</sub>

### Test 9

```
{
concern: All my dash lights are flickering when the engine is running
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'dim_or_flickering_lights'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [541, 543, 544, 545]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Flickering dash lights while engine running typically indicates a charging system fault; alternator output testing is the primary diagnostic for this symptom." · S2: "Customer reports dash lights flickering while engine running, which directly matches the positive example 'Dash lights flicker on and off while the car is running, like a strobe' and the core description of visible brightness changes." · S3: "Customer explicitly stated dashboard lights are flickering while the engine is running. Set lights_state to dim_or_flickering and onset_timing to during_driving (engine running = vehicle in operation). No other facts were literally stated."
extracted_facts:
  onset_timing: "during_driving"
  engine_running: "normal"
  lights_state: "dim_or_flickering"
matched category key: charging_starting_testing
matched sub category slug: dim_or_flickering_lights
unanswered question ids: [541, 543, 544, 545]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 13675ch · 2219ms · 3856/51t · S2: 16833ch · 2198ms · 23/79t · S3: 19999ch · 3764ms · 23/275t · Total: 8183ms wall 8705ms · 3902/405t</sub>

### Test 10

```
{
concern: Transmission slips between 2nd and 3rd gear when warm
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'low_power_or_wont_accelerate_normally'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer describes a specific transmission symptom (slipping between 2nd and 3rd gear when warm), which directly maps to transmission_testing service that includes road test and fluid/fault diagnosis." · S2: "Transmission slipping (engine revs without proportional speed gain) is a classic cause of sustained power loss; however, no subcategory explicitly covers slipping gears, making this a medium-confidence best-fit to the power-loss category." · S3: "Customer explicitly stated transmission slips between 2nd and 3rd gear when warm (after_warming_up). No other literal facts about location, speed, sounds, smells, or drivability were mentioned."
extracted_facts:
  onset_timing: "after_warming_up"
matched category key: transmission_testing
matched sub category slug: low_power_or_wont_accelerate_normally
unanswered question ids: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 13675ch · 1763ms · 3859/66t · S2: 11685ch · 6807ms · 3560/90t · S3: 19784ch · 3570ms · 26/269t · Total: 12142ms wall 12703ms · 7445/425t</sub>

### Test 11

```
{
concern: Reverse gear works but feels delayed by a couple seconds
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 56 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'hesitation_or_lag_when_accelerating'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [455, 457, 458, 459, 460, 461]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer reports delayed engagement in reverse gear, a transmission drivability concern that maps directly to transmission_testing, which includes road test and shift concern inspection." · S2: "Customer describes a delay in reverse gear engagement, matching the 'lag' and 'delay' synonyms in hesitation_or_lag_when_accelerating, though this typically applies to forward acceleration rather than gear selection specifically." · S3: "Customer clearly stated reverse gear has a 2-second delay before engaging. Mapped to stopped (reverse is used at low/no speed) and when_accelerating (gear engagement is a throttle response). engine_running=normal since reverse itself works. drivable_normally inferred from 'works' language. Most other slots null as no other symptoms mentioned."
extracted_facts:
  speed_band: "stopped"
  onset_timing: "when_accelerating"
  engine_running: "normal"
  drivable_state: "drivable_normally"
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: hesitation_or_lag_when_accelerating
unanswered question ids: [455, 457, 458, 459, 460, 461]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 13675ch · 1909ms · 3855/57t · S2: 11685ch · 1799ms · 3556/84t · S3: 19726ch · 4264ms · 22/307t · Total: 7974ms wall 8564ms · 7433/448t</sub>

### Test 12

```
{
concern: Car kicks hard into gear when accelerating from a stop
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 54 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'shaking_when_speeding_up_or_going_uphill'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [163, 164, 165, 167, 168]
  step 7 (confidence per stage):     S1: high · S2: low · S3: medium
  step 8 (reasoning):                S1: "Customer describes hard gear engagement during acceleration from stop, a classic transmission shift quality concern that requires road test and fluid/code diagnosis per transmission_testing service." · S2: "Customer describes a hard kick into gear during acceleration from a stop, which suggests transmission engagement under load. This partially aligns with shaking/shuddering under acceleration, but the description lacks the vibration/shaking detail that defines the matched subcategory. None of the five subcategories perfectly capture harsh transmission engagement without vibration." · S3: "Customer clearly stated hard engagement when accelerating from a stop (low_speed, when_accelerating). 'Kicks hard' suggests a transmission engagement issue but doesn't specify shaking/vibration vs. harsh shift feel; interpreted as transmission behavior during acceleration onset rather than vibration-specific."
extracted_facts:
  speed_band: "low_speed"
  onset_timing: "when_accelerating"
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: shaking_when_speeding_up_or_going_uphill
unanswered question ids: [163, 164, 165, 167, 168]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 13675ch · 1838ms · 3855/57t · S2: 11685ch · 3394ms · 3556/110t · S3: 20017ch · 3946ms · 22/289t · Total: 9180ms wall 9664ms · 7433/456t</sub>

### Test 13

```
{
concern: Manual transmission grinds when shifting into 3rd
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     35 unanswered IDs: [162, 163, 164, 165, 166, 167, 168, 455, 456, 457, 458, 459, 460, 461, 993, 994, 995, 996, 997, 998, 999, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195]
  step 7 (confidence per stage):     S1: high · S2: low · S3: high
  step 8 (reasoning):                S1: "Customer reports grinding noise during 3rd gear shift, a clear transmission symptom that maps directly to transmission_testing service for diagnosis of shift concerns and mechanical issues." · S2: "Customer describes manual transmission grinding during gear shifts, which does not match any subcategory in the transmission_testing category. The available subcategories cover hesitation, fluid leaks, shaking under load, low power, and RPM surging—none address grinding noises during manual shifts." · S3: "Customer clearly stated a grinding noise during manual transmission shifting into 3rd gear. Grinding is metallic, occurs during gear engagement (when_accelerating best fits the shift action), and originates from under the hood (transmission area). No other facts were literally stated."
extracted_facts:
  onset_timing: "when_accelerating"
  noise_descriptor: "grinding_metallic"
  sound_or_smoke_location_zone: "under_hood"
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: [162, 163, 164, 165, 166, 167, 168, 455, 456, 457, 458, 459, 460, 461, 993, 994, 995, 996, 997, 998, 999, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 13675ch · 1731ms · 3855/59t · S2: 11685ch · 2108ms · 3556/85t · S3: 18784ch · 4066ms · 22/286t · Total: 7909ms wall 8311ms · 7433/430t</sub>

### Test 14

```
{
concern: My CVT transmission feels like its slipping or hunting for gears
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 64 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'surging_or_rpms_going_up_and_down'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [1189, 1190, 1191, 1192, 1193, 1194, 1195]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: low
  step 8 (reasoning):                S1: "Customer describes CVT transmission slipping/hunting for gears, which directly indicates transmission performance issues requiring diagnostic testing and road test evaluation." · S2: "Customer's 'hunting for gears' and transmission behavior maps to RPM hunting/oscillation; CVT slipping suggests engine revving without proportional speed gain, but no subcategory explicitly covers CVT slip—surging best captures the hunting/unstable behavior pattern." · S3: "Customer described a CVT transmission symptom (slipping/hunting) but provided no details about speed, timing, onset, or driving conditions. Most diagnostic slots remain null pending clarification questions."
extracted_facts:
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: surging_or_rpms_going_up_and_down
unanswered question ids: [1189, 1190, 1191, 1192, 1193, 1194, 1195]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 13675ch · 1438ms · 3858/53t · S2: 11685ch · 2216ms · 3559/93t · S3: 19821ch · 3008ms · 25/262t · Total: 6665ms wall 7180ms · 7442/408t</sub>

### Test 15

```
{
concern: Exhaust is rattling somewhere under the car
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Exhaust rattle is a mechanical noise issue that doesn't fit any testing service category; customer should speak with an advisor to determine if it's a loose heat shield, exhaust component, or suspension-related concern." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1669ms · 3854/68t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1670ms wall 2208ms · 3854/68t</sub>

### Test 16

```
{
concern: Black smoke from the tailpipe when I floor it
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 45 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'black_smoke_from_tailpipe'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [296, 297, 298, 299, 300, 301]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Black smoke from tailpipe suggests rich fuel mixture or combustion issue; check engine light testing will scan for performance/fuel system codes that cause this symptom." · S2: "Customer's description 'black smoke from the tailpipe when I floor it' directly matches the positive example 'Black smoke pours out of the tailpipe when I stomp on the gas' and the subcategory's core symptom of dark sooty smoke under hard acceleration caused by running rich." · S3: "Customer clearly stated black smoke from tailpipe triggered by hard acceleration ('floor it'). Set smoke_color=black, onset_timing=when_accelerating, sound_or_smoke_location_zone=from_tailpipe. No other facts literally stated; speed_band left null because 'flooring it' doesn't specify an exact mph range."
extracted_facts:
  speed_band: "specific_mph"
  onset_timing: "when_accelerating"
  smoke_color: "black"
  sound_or_smoke_location_zone: "from_tailpipe"
matched category key: check_engine_light_testing
matched sub category slug: black_smoke_from_tailpipe
unanswered question ids: [296, 297, 298, 299, 300, 301]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 2471ms · 3855/63t · S2: 42816ch · 2228ms · 22/98t · S3: 19784ch · 3977ms · 22/305t · Total: 8677ms wall 9220ms · 3899/466t</sub>

### Test 17

```
{
concern: Blue smoke from the tailpipe at startup
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'blue_or_light_blue_puddle_washer_fluid'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [1021, 1022, 1023, 1024, 1025, 1026, 1027]
  step 7 (confidence per stage):     S1: medium · S2: low · S3: high
  step 8 (reasoning):                S1: "Blue smoke at startup typically indicates burning oil, but can also signal coolant issues; coolant_leak_testing covers overheating/smoke concerns and includes block testing for internal engine problems." · S2: "Customer reports blue smoke from tailpipe (oil burning), but no matching subcategory exists in this coolant-leak category; washer fluid is a poor fit. Stage 1 may have miscategorized—this belongs in engine/oil diagnostics, not coolant testing." · S3: "Customer clearly stated blue smoke from tailpipe at startup—a classic oil-burning symptom. Extracted smoke_color, onset_timing, sound_or_smoke_location_zone, and speed_band (stopped at startup). All other slots null as not mentioned."
extracted_facts:
  speed_band: "stopped"
  onset_timing: "at_startup"
  smoke_color: "blue_or_gray"
  sound_or_smoke_location_zone: "from_tailpipe"
matched category key: coolant_leak_testing
matched sub category slug: blue_or_light_blue_puddle_washer_fluid
unanswered question ids: [1021, 1022, 1023, 1024, 1025, 1026, 1027]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 13675ch · 1647ms · 3853/68t · S2: 16745ch · 1915ms · 20/99t · S3: 19768ch · 3532ms · 20/287t · Total: 7094ms wall 7554ms · 3893/454t</sub>

### Test 18

```
{
concern: Engine is louder than usual and sounds raspier
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 46 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Engine noise is too vague to categorize without knowing if it's a knock, rattle, grinding, or exhaust issue; customer should speak with an advisor to narrow down the specific sound and location." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1814ms · 3854/65t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1814ms wall 2196ms · 3854/65t</sub>

### Test 19

```
{
concern: Catalytic converter rattle when accelerating uphill
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 51 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Catalytic converter rattle is a specific mechanical issue not covered by the testing service catalog; requires direct inspection/repair rather than diagnostic testing." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1472ms · 3855/52t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1473ms wall 1989ms · 3855/52t</sub>

### Test 20

```
{
concern: AC compressor cycles on and off rapidly
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'ac_is_weak_not_cold_enough'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [574, 575, 576, 577, 578, 579, 580]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Rapid A/C compressor cycling indicates a performance issue with the cooling system; the performance check includes blower, mode, cooling fan operation, and system pressure verification to diagnose the cause." · S2: "Rapid compressor cycling is a classic symptom of low refrigerant charge causing evaporator freeze-thaw cycles, matching the 'cycles cold then warm' pattern described in ac_is_weak_not_cold_enough positive examples." · S3: "Customer stated AC is on and compressor cycles rapidly, which is a technical observation fitting the weak-AC category (low charge symptom). However, no speed, timing, temperature, or location details were provided; rapid cycling is inferred as the symptom but onset_timing and speed_band remain null per literal extraction rules."
extracted_facts:
  hvac_mode: "ac"
  customer_request_type: "diagnose_problem"
matched category key: ac_performance_check
matched sub category slug: ac_is_weak_not_cold_enough
unanswered question ids: [574, 575, 576, 577, 578, 579, 580]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 13675ch · 1762ms · 3852/68t · S2: 19980ch · 2280ms · 19/88t · S3: 19938ch · 4183ms · 19/290t · Total: 8225ms wall 8655ms · 3890/446t</sub>

### Test 21

```
{
concern: Vents shake when blower is on high
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 34 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     154 unanswered IDs: [78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 99, 100, 101, 102, 103, 104, 105, 113, 114, 115, 116, 117, 118, 119, 127, 128, 129, 130, 131, 132, 133, 141, 142, 143, 144, 145, 146, 147, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 667, 668, 669, 670, 671, 672, 673, 674, 675, 676, 677, 678, 679, 680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690, 691, 692, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706, 707, 708, 730, 731, 732, 733, 734, 735, 736, 751, 752, 753, 754, 755, 756, 757, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1476, 1477, 1478, 1479, 1480, 1481, 1482]
  step 7 (confidence per stage):     S1: medium · S2: low · S3: medium
  step 8 (reasoning):                S1: "Customer reports vents shaking on high blower, which could indicate loose vent components or a suspension/vibration issue; suspension_steering_check covers vibration diagnosis, though an HVAC-specific concern is also plausible." · S2: "Customer describes a dashboard/vent vibration tied to blower speed, which falls outside suspension/steering subcategories. This symptom belongs to HVAC or electrical, not suspension/steering diagnostics." · S3: "Customer clearly stated vents shake (rattling noise) when blower is on high. Mapped onset_timing to 'at_first_turn_on' as a judgment call—could also be 'when_idling' or just a fan-speed trigger, but 'at_first_turn_on' best captures 'when blower turned to high.' hvac_mode left null since customer didn't specify AC vs heat."
extracted_facts:
  onset_timing: "at_first_turn_on"
  noise_descriptor: "rattling"
  sound_or_smoke_location_zone: "from_vents"
matched category key: suspension_steering_check
matched sub category slug: null
unanswered question ids: [78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 99, 100, 101, 102, 103, 104, 105, 113, 114, 115, 116, 117, 118, 119, 127, 128, 129, 130, 131, 132, 133, 141, 142, 143, 144, 145, 146, 147, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 667, 668, 669, 670, 671, 672, 673, 674, 675, 676, 677, 678, 679, 680, 681, 682, 683, 684, 685, 686, 687, 688, 689, 690, 691, 692, 693, 694, 695, 696, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706, 707, 708, 730, 731, 732, 733, 734, 735, 736, 751, 752, 753, 754, 755, 756, 757, 1224, 1225, 1226, 1227, 1228, 1229, 1230, 1476, 1477, 1478, 1479, 1480, 1481, 1482]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 2034ms · 3854/73t · S2: 44059ch · 10623ms · 21/68t · S3: 18784ch · 3762ms · 21/324t · Total: 16421ms wall 16909ms · 3896/465t</sub>

### Test 22

```
{
concern: Fan only works on highest setting now
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports fan only works on highest setting, suggesting a blower motor control or resistor issue; electrical_testing_general covers wiring, connectors, and component diagnostics for such HVAC electrical faults." · S2: "Fan (blower motor) is a single electrical accessory that is malfunctioning; however, it's partially working (high setting only) rather than completely dead, which creates some ambiguity versus a fully non-functional accessory." · S3: "Customer clearly stated HVAC fan only works on max setting, a classic blower resistor failure symptom. Set airflow_state and accessory_affected accordingly. No other facts literally stated."
extracted_facts:
  airflow_state: "only_on_highest_setting"
  accessory_affected: "hvac fan"
  customer_request_type: "diagnose_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 13675ch · 2332ms · 3851/68t · S2: 12673ch · 1832ms · 3691/82t · S3: 19968ch · 3367ms · 18/272t · Total: 7533ms wall 7989ms · 7560/422t</sub>

### Test 23

```
{
concern: Heater core smells musty when I run the heat
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 44 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'heat_doesnt_work'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [937, 939, 940, 941, 942, 943]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Musty smell from heater suggests potential coolant system issue or internal contamination; coolant_leak_testing includes cooling system inspection and may identify heater core problems." · S2: "Musty smell from heater suggests a clogged or failing heater core, which is listed as a cause under heat_doesnt_work; however, the customer hasn't explicitly reported lack of heat output, only odor, making this a medium-confidence match." · S3: "Customer explicitly stated musty smell when heat is turned on. Interpreted 'when I run the heat' as at_first_turn_on (HVAC-specific onset) and smell originates from vents. All other slots null as not mentioned."
extracted_facts:
  onset_timing: "at_first_turn_on"
  hvac_mode: "heat"
  smell_descriptor: "musty_or_mildew"
  sound_or_smoke_location_zone: "from_vents"
matched category key: coolant_leak_testing
matched sub category slug: heat_doesnt_work
unanswered question ids: [937, 939, 940, 941, 942, 943]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 13675ch · 2890ms · 3857/65t · S2: 16745ch · 1873ms · 24/88t · S3: 19999ch · 3529ms · 24/290t · Total: 8293ms wall 8816ms · 3905/443t</sub>

### Test 24

```
{
concern: AC works but smells like dirty socks when I first turn it on
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'bad_smell_from_vents'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [968, 969, 970, 971]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports AC functioning but with an odor issue ('smells like dirty socks'), which suggests mold/mildew in the evaporator—a common AC concern checked during performance evaluation." · S2: "Customer reports musty/dirty-socks smell tied to AC vent airflow on startup—a classic evaporator microbial growth symptom matching the positive example 'Vents smell like dirty socks when I turn on the AC'." · S3: "Customer explicitly stated AC mode, musty smell ('dirty socks' is canonical musty), and timing (first turn on). All other facts not mentioned; left null."
extracted_facts:
  onset_timing: "at_first_turn_on"
  hvac_mode: "ac"
  smell_descriptor: "musty_or_mildew"
  sound_or_smoke_location_zone: "from_vents"
matched category key: ac_performance_check
matched sub category slug: bad_smell_from_vents
unanswered question ids: [968, 969, 970, 971]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 13675ch · 1688ms · 3859/69t · S2: 19980ch · 1841ms · 26/85t · S3: 20014ch · 2973ms · 26/271t · Total: 6503ms wall 6942ms · 3911/425t</sub>

### Test 25

```
{
concern: Climate control buttons stopped lighting up on the dash
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 55 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Climate control buttons not lighting up suggests an electrical issue with dashboard illumination or button backlighting; electrical_testing_general covers wiring, connectors, and electrical diagnostics for such concerns." · S2: "Climate control buttons are a specific electrical accessory that has stopped working; matches the positive example pattern of 'one specific electrical accessory has stopped working, while the rest of the car is operating normally.'" · S3: "Customer clearly stated that climate control buttons stopped lighting up on the dash. This is a specific electrical accessory (dashboard illumination for HVAC controls) with a clear location (behind dashboard). No other facts were mentioned."
extracted_facts:
  accessory_affected: "climate control buttons"
  sound_or_smoke_location_zone: "behind_dashboard"
  customer_request_type: "diagnose_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 13675ch · 1587ms · 3853/68t · S2: 12673ch · 2666ms · 3693/73t · S3: 19968ch · 3219ms · 20/272t · Total: 7473ms wall 7865ms · 7566/413t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 22 |
| matched an 'other' subcategory (forward-to-advisor) | 0 |
| null match (forwarded to advisor) | 3 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 46015 ms |
| sum stage-2 latencies | 61928 ms |
| sum stage-3 latencies | 83355 ms |
| sum input tokens | 137869 |
| sum output tokens | 9646 |
| **stage 1** confidence: high / medium / low / missing | 15 / 7 / 3 / 0 |
| **stage 2** confidence: high / medium / low / missing | 9 / 6 / 7 / 3 |
| **stage 3** confidence: high / medium / low / missing | 17 / 4 / 1 / 3 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 19 / 99 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.32 (n=22) |
