# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T02:43:23.675Z
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
concern: TPMS light came on and won't go off even after I checked the tire pressures
LLM decision tree:
  step 1 (match category, S1):       matched 'tpms_testing'
  step 2 (vagueness check):          passed — description has 75 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'tpms_tire_pressure_light'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [406, 408, 409, 410, 411]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports TPMS light that persists despite checking tire pressures—a classic TPMS sensor or system fault requiring diagnostic scanning and sensor evaluation." · S2: "Customer leads with 'TPMS light came on' (positive example match) and describes it staying on despite checking pressures, indicating a potential sensor fault or persistent underinflation—core TPMS light scenario." · S3: "Customer explicitly named TPMS light and stated it remains steady on despite checking tire pressures. This suggests a system fault (dead/missing sensor) rather than low pressure. No other symptoms mentioned."
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

<sub>S1: 16280ch · 1998ms · 31/61t · S2: 13580ch · 1818ms · 4113/82t · S3: 20045ch · 3334ms · 31/268t · Total: 7153ms wall 7777ms · 4175/411t</sub>

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
  step 8 (reasoning):                S1: "Customer reports traction control light flashing randomly while driving, which directly indicates ABS/traction/stability system fault requiring diagnostic scanning and sensor inspection." · S2: "Customer describes traction control light flashing while driving, which matches the positive example 'Little car-skidding symbol came on after I drove through snow' and the description that flashing is NORMAL when the system actively intervenes on slippery surfaces." · S3: "Customer clearly stated traction control light flashes (warning_light_behavior) while driving (onset_timing, speed_band). No other symptoms or details provided; all other slots null."
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

<sub>S1: 16280ch · 1649ms · 21/62t · S2: 6990ch · 1751ms · 2303/87t · S3: 20086ch · 3369ms · 21/271t · Total: 6771ms wall 7290ms · 2345/420t</sub>

### Test 3

```
{
concern: Service engine soon light came on yesterday
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'service_engine_soon_or_maintenance_required_light'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [2220, 2221, 2222, 2223, 2224]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports 'Service engine soon light came on' — a check engine light indicator that requires diagnostic scanning for trouble codes and live data review." · S2: "Customer explicitly mentions 'Service engine soon light' — a direct match to the subcategory description and positive examples for scheduled maintenance reminders." · S3: "Customer clearly stated 'Service engine soon light came on yesterday'—a scheduled-service reminder with no drivability symptoms. Extracted warning_light_named, warning_light_behavior (steady_on), started_when (days_ago), engine_running (normal—no symptoms mentioned), and customer_request_type (diagnose_problem). All other slots null as not stated."
extracted_facts:
  started_when: "days_ago"
  warning_light_named: "service engine soon"
  warning_light_behavior: "steady_on"
  engine_running: "normal"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: service_engine_soon_or_maintenance_required_light
unanswered question ids: [2220, 2221, 2222, 2223, 2224]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1756ms · 18/59t · S2: 42816ch · 2675ms · 18/67t · S3: 20048ch · 7081ms · 18/311t · Total: 11513ms wall 11950ms · 54/437t</sub>

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
  step 8 (reasoning):                S1: "Customer reports BAS (brake assist system) and ABS lights on together—both are brake/stability system warnings that route to ABS/traction/stability diagnostic testing per the catalog." · S2: "Customer mentions 'ABS light' explicitly; BAS (Brake Assist System) is a related ABS component. Positive example match: 'ABS and traction control lights both on, brakes work normal otherwise' shows multiple lights can appear together and still route to ABS." · S3: "Customer explicitly named two dashboard warning lights (ABS and BAS) that are both on simultaneously. No other symptoms, timing, or context provided. Extracted warning_light_named and warning_light_behavior only."
extracted_facts:
  warning_light_named: "abs, bas"
  warning_light_behavior: "multiple_lights_at_once"
matched category key: abs_traction_stability_testing
matched sub category slug: abs_anti_lock_brake_light
unanswered question ids: [413, 414, 415, 416, 417, 418]
testing service recommended: abs_traction_stability_testing — ABS / traction / stability light testing ($179.95)
}
```

<sub>S1: 16280ch · 1865ms · 22/70t · S2: 6990ch · 2071ms · 2304/96t · S3: 20023ch · 3400ms · 22/273t · Total: 7337ms wall 7569ms · 2348/439t</sub>

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
  step 8 (reasoning):                S1: "Customer reports a warning light (low fuel light) that flickers intermittently despite adequate fuel level, indicating a sensor or electrical fault requiring diagnostic scanning." · S2: "Customer describes a single flickering warning light (fuel), not multiple lights. This doesn't match the 'multiple_warning_lights_at_once' subcategory, which requires THREE+ lights or 'all lights' phrasing. Stage 1 may have miscategorized; this symptom belongs in a fuel/gauge system category, not general warning light testing." · S3: "Customer clearly stated the low fuel warning light is flickering despite having half a tank. This is a literal dashboard light behavior issue; all other slots are null as no other symptoms were mentioned."
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

<sub>S1: 16280ch · 2159ms · 24/59t · S2: 4953ch · 2191ms · 1678/104t · S3: 18784ch · 3221ms · 24/268t · Total: 7571ms wall 7782ms · 1726/431t</sub>

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
  step 8 (reasoning):                S1: "Customer reports a warning light (parking brake light) that remains illuminated after releasing the brake, indicating a system fault requiring diagnostic scanning and code review." · S2: "Customer describes a single warning light (parking brake) that persists after releasing the brake. This does not match 'multiple_warning_lights_at_once' (requires THREE+ lights or 'all lights' phrasing). No other subcategory exists in this category for single-light issues." · S3: "Customer clearly stated the parking brake warning light remains illuminated after releasing the brake. This is a literal dashboard light behavior (steady_on) with no other symptoms mentioned."
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

<sub>S1: 16280ch · 1489ms · 22/58t · S2: 4953ch · 1786ms · 1676/89t · S3: 18784ch · 3121ms · 22/260t · Total: 6396ms wall 6790ms · 1720/407t</sub>

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
  step 8 (reasoning):                S1: "Customer reports transmission temperature light during highway driving, a clear transmission system warning that requires diagnostic scanning and fluid/component inspection per transmission_testing scope." · S2: "Transmission temperature warning light is a diagnostic alert, not a symptom matching any subcategory (hesitation, fluid leak, shaking, power loss, or surging). Requires mechanic inspection to determine underlying cause." · S3: "Customer explicitly stated transmission temp warning light came on during highway driving. Set speed_band=highway, onset_timing=during_driving, warning_light_named='transmission temp', and warning_light_behavior=came_on_then_off (light appeared during drive; no mention of it being off now, but 'came on' implies it wasn't on before). All other slots null as not stated."
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

<sub>S1: 16280ch · 1864ms · 22/55t · S2: 11685ch · 1752ms · 3556/71t · S3: 18784ch · 3783ms · 22/318t · Total: 7401ms wall 7866ms · 3600/444t</sub>

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
  step 8 (reasoning):                S1: "Battery warning light indicates a charging system fault; charging_starting_testing diagnoses alternator output, battery condition, and related electrical issues." · S2: "Customer reports battery/charging light illuminated while car is running normally—a direct positive example match for battery_charging_light subcategory indicating charging system failure." · S3: "Customer explicitly stated battery warning light is on and engine runs normally. No other symptoms mentioned. Inferred drivable_normally (car still running) and diagnose_problem (asking why light came on)."
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

<sub>S1: 16280ch · 2020ms · 22/56t · S2: 16833ch · 1648ms · 22/63t · S3: 20000ch · 3416ms · 22/272t · Total: 7086ms wall 7604ms · 66/391t</sub>

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
  step 8 (reasoning):                S1: "Flickering dashboard lights while engine running typically indicate a charging system fault (alternator output or voltage regulation issue), which charging_starting_testing directly diagnoses." · S2: "Customer describes dashboard lights flickering while engine running, which directly matches the positive example 'Dash lights flicker on and off while the car is running, like a strobe' and the core description of visible brightness changes tied to engine operation." · S3: "Customer explicitly stated dashboard lights are flickering while the engine is running. Set lights_state to dim_or_flickering and onset_timing to during_driving (engine running = vehicle in operation). No other facts were literally stated."
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

<sub>S1: 16280ch · 2997ms · 23/56t · S2: 16833ch · 2764ms · 23/83t · S3: 19999ch · 3362ms · 23/275t · Total: 9124ms wall 9511ms · 69/414t</sub>

### Test 10

```
{
concern: Transmission slips between 2nd and 3rd gear when warm
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     35 unanswered IDs: [162, 163, 164, 165, 166, 167, 168, 455, 456, 457, 458, 459, 460, 461, 993, 994, 995, 996, 997, 998, 999, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195]
  step 7 (confidence per stage):     S1: high · S2: low · S3: medium
  step 8 (reasoning):                S1: "Customer describes a specific transmission symptom (slipping between 2nd and 3rd gear when warm), which directly maps to transmission_testing service that includes road test and fluid/fault diagnosis." · S2: "Customer describes transmission slipping (engine revs without proportional speed gain), a clear transmission malfunction symptom, but none of the five subcategories in this transmission_testing category directly address gear slipping—they cover hesitation, fluid leaks, acceleration shake, low power, and RPM surging instead. Downstream advisor should verify routing or escalate to transmission specialist." · S3: "Customer clearly stated transmission slips between 2nd and 3rd gear when warm (onset_timing=after_warming_up) and implicitly requests diagnosis. No location, speed, smell, noise, or fluid details provided; most slots remain null per extraction rules."
extracted_facts:
  onset_timing: "after_warming_up"
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: [162, 163, 164, 165, 166, 167, 168, 455, 456, 457, 458, 459, 460, 461, 993, 994, 995, 996, 997, 998, 999, 1182, 1183, 1184, 1185, 1186, 1187, 1188, 1189, 1190, 1191, 1192, 1193, 1194, 1195]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 16280ch · 1559ms · 26/66t · S2: 11685ch · 3138ms · 3560/103t · S3: 18784ch · 4009ms · 26/283t · Total: 8707ms wall 9272ms · 3612/452t</sub>

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
  step 8 (reasoning):                S1: "Customer reports delayed engagement in reverse gear, a transmission drivability concern that maps directly to transmission_testing's scope of shift/engagement issues." · S2: "Customer describes a delay in reverse gear engagement, matching the 'lag' and 'delay' synonyms in hesitation_or_lag_when_accelerating, though this subcategory typically covers forward acceleration; transmission shift delay is listed as a common cause." · S3: "Customer clearly stated reverse gear has a 2-second delay before engaging. Mapped to stopped (reverse is used at low/no speed) and when_accelerating (gear engagement is a throttle response). engine_running=normal since gear works. drivable_normally since reverse functions. Judgment call: onset_timing could be 'at_startup' but 'when_accelerating' better captures the delay-on-engagement symptom."
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

<sub>S1: 16280ch · 1599ms · 22/55t · S2: 11685ch · 1849ms · 3556/91t · S3: 19726ch · 4348ms · 22/325t · Total: 7796ms wall 7991ms · 3600/471t</sub>

### Test 12

```
{
concern: Car kicks hard into gear when accelerating from a stop
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 54 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'shaking_when_speeding_up_or_going_uphill'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [163, 164, 165, 167, 168]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer describes hard gear engagement during acceleration from a stop, a classic transmission shift-quality concern that requires road test and fluid/code diagnostics per transmission_testing scope." · S2: "Customer describes a hard kick/jolt during acceleration from a stop, which aligns with shaking/shuddering under acceleration load; however, 'kicks hard into gear' could also suggest transmission engagement harshness, making this a medium-confidence match requiring advisor verification." · S3: "Customer clearly stated the symptom occurs when accelerating from a stop (onset_timing=when_accelerating, speed_band=low_speed). 'Kicks hard into gear' suggests transmission engagement but no specific noise/feel descriptor was literally named, so those remain null."
extracted_facts:
  speed_band: "low_speed"
  onset_timing: "when_accelerating"
matched category key: transmission_testing
matched sub category slug: shaking_when_speeding_up_or_going_uphill
unanswered question ids: [163, 164, 165, 167, 168]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 16280ch · 1804ms · 22/60t · S2: 11685ch · 2235ms · 3556/98t · S3: 20017ch · 3299ms · 22/283t · Total: 7339ms wall 7714ms · 3600/441t</sub>

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
  step 8 (reasoning):                S1: "Customer reports grinding noise specifically during gear shifts (3rd gear), a classic transmission symptom that maps directly to transmission_testing's scope of drivability/shift concerns and internal inspection." · S2: "Customer reports grinding during gear shifts, which is a transmission mechanical issue but does not match any of the five subcategories listed (hesitation, fluid leak, acceleration shake, low power, or RPM surging). This symptom requires a different subcategory not present in the transmission_testing category." · S3: "Customer clearly stated a grinding noise during gear shifting (3rd gear). Grinding is metallic, shifting is a form of acceleration/drivetrain engagement, and the sound originates from the transmission (under hood). No other details provided."
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

<sub>S1: 16280ch · 1901ms · 22/64t · S2: 11685ch · 1887ms · 3556/87t · S3: 18784ch · 3680ms · 22/280t · Total: 7468ms wall 7971ms · 3600/431t</sub>

### Test 14

```
{
concern: My CVT transmission feels like its slipping or hunting for gears
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 64 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'low_power_or_wont_accelerate_normally'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: low
  step 8 (reasoning):                S1: "Customer describes CVT transmission slipping/hunting for gears—classic transmission drivability concern that maps directly to transmission_testing, which includes road test and fluid/fault diagnosis." · S2: "CVT slipping typically manifests as sustained loss of power (engine revs but car doesn't move), matching the low_power description; however, 'hunting for gears' suggests RPM oscillation, which could also fit surging_or_rpms_going_up_and_down—picked low_power as the primary transmission symptom." · S3: "Customer described a transmission symptom (slipping/hunting) but provided no details about speed, timing, onset, or driving conditions. Most diagnostic slots remain null pending follow-up questions."
extracted_facts:
  customer_request_type: "diagnose_problem"
matched category key: transmission_testing
matched sub category slug: low_power_or_wont_accelerate_normally
unanswered question ids: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 16280ch · 1731ms · 25/63t · S2: 11685ch · 2188ms · 3559/113t · S3: 19784ch · 3202ms · 25/261t · Total: 7121ms wall 7648ms · 3609/437t</sub>

### Test 15

```
{
concern: Exhaust is rattling somewhere under the car
LLM decision tree:
  step 1 (match category, S1):       matched 'exhaust_system_testing'
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'rattling_underneath_the_car'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [99, 100, 101, 102, 103, 104, 105]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports 'exhaust is rattling somewhere under the car' — a classic exhaust rattle symptom that maps directly to exhaust_system_testing, which covers rattle from catalytic converter and exhaust hangers." · S2: "Customer explicitly describes 'rattling...under the car,' which directly matches the positive example 'Something is rattling underneath — heat shield or exhaust maybe' and the core description of loose-metal rattle from beneath the vehicle." · S3: "Customer clearly stated a rattling noise from under the car related to the exhaust system. Only noise_descriptor and sound_or_smoke_location_zone are extractable; all other contextual details (speed, timing, side, axle) were not mentioned."
extracted_facts:
  noise_descriptor: "rattling"
  sound_or_smoke_location_zone: "under_car"
matched category key: exhaust_system_testing
matched sub category slug: rattling_underneath_the_car
unanswered question ids: [99, 100, 101, 102, 103, 104, 105]
testing service recommended: exhaust_system_testing — Exhaust system evaluation ($39.99)
}
```

<sub>S1: 16280ch · 1652ms · 21/77t · S2: 10596ch · 1913ms · 3418/81t · S3: 19853ch · 3469ms · 21/278t · Total: 7037ms wall 7585ms · 3460/436t</sub>

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
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Black smoke from tailpipe indicates excessive fuel burning (rich condition), which is an engine performance issue requiring diagnostic scanning for fuel system and sensor faults." · S2: "Customer's description 'Black smoke from the tailpipe when I floor it' directly matches the positive example 'Black smoke pours out of the tailpipe when I stomp on the gas' and the subcategory's core description of black/sooty smoke under hard acceleration caused by running rich." · S3: "Customer clearly stated black smoke from tailpipe triggered by hard acceleration ('floor it'). Set smoke_color=black, onset_timing=when_accelerating, sound_or_smoke_location_zone=from_tailpipe. No other facts literally stated."
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

<sub>S1: 16280ch · 1668ms · 22/56t · S2: 42816ch · 2929ms · 22/98t · S3: 19784ch · 3877ms · 22/285t · Total: 8475ms wall 9007ms · 66/439t</sub>

### Test 17

```
{
concern: Blue smoke from the tailpipe at startup
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'blue_or_gray_smoke_from_tailpipe'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [290, 291, 292, 293, 294]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Blue smoke from tailpipe indicates oil burning in the engine; per catalog, blue/gray tailpipe smoke routes to check_engine_light_testing, not coolant_leak_testing." · S2: "Customer describes blue smoke from tailpipe at startup, which matches the positive example 'Blue smoke comes out of the tailpipe when I first start it in the morning' and the subcategory's description of oil burning through worn valve seals typically visible on cold startup." · S3: "Customer clearly stated blue smoke from tailpipe at startup (cold_start). Smoke color is blue_or_gray (oil burning cue). Location is from_tailpipe. Speed is stopped (startup condition). No other details provided."
extracted_facts:
  speed_band: "stopped"
  onset_timing: "cold_start"
  smoke_color: "blue_or_gray"
  sound_or_smoke_location_zone: "from_tailpipe"
matched category key: check_engine_light_testing
matched sub category slug: blue_or_gray_smoke_from_tailpipe
unanswered question ids: [290, 291, 292, 293, 294]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 3002ms · 20/71t · S2: 42816ch · 1825ms · 20/95t · S3: 19700ch · 4626ms · 20/281t · Total: 9453ms wall 9888ms · 60/447t</sub>

### Test 18

```
{
concern: Engine is louder than usual and sounds raspier
LLM decision tree:
  step 1 (match category, S1):       matched 'exhaust_system_testing'
  step 2 (vagueness check):          passed — description has 46 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'exhaust_louder_or_rumbling'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=0 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: medium · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports engine louder than usual with a raspy sound, which suggests an exhaust leak or damaged component; however, could also indicate engine knock or performance issue, making exhaust_system_testing the best initial match." · S2: "Customer describes "louder than usual" exhaust sound, which directly matches the positive example "My exhaust got really loud all of a sudden" and the synonym "louder exhaust"; raspier tone suggests a muffler or exhaust leak." · S3: "Customer described engine noise as 'louder than usual' and 'raspier,' which maps to roaring (exhaust-like deeper sound). Location inferred as under_hood since engine noise originates there. No speed, timing, or other contextual details provided."
extracted_facts:
  noise_descriptor: "roaring"
  sound_or_smoke_location_zone: "under_hood"
matched category key: exhaust_system_testing
matched sub category slug: exhaust_louder_or_rumbling
unanswered question ids: []
testing service recommended: exhaust_system_testing — Exhaust system evaluation ($39.99)
}
```

<sub>S1: 16280ch · 1777ms · 21/75t · S2: 10596ch · 1934ms · 3418/88t · S3: 19829ch · 3401ms · 21/280t · Total: 7114ms wall 7650ms · 3460/443t</sub>

### Test 19

```
{
concern: Catalytic converter rattle when accelerating uphill
LLM decision tree:
  step 1 (match category, S1):       matched 'exhaust_system_testing'
  step 2 (vagueness check):          passed — description has 51 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'rattling_underneath_the_car'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [101, 102, 103, 104, 105]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer describes a rattle from the catalytic converter during acceleration uphill, which directly matches exhaust_system_testing scope: 'rattle from catalytic converter' and 'broken internals (rattle)'." · S2: "Customer describes a rattle triggered by acceleration/load (uphill), consistent with a failing catalytic converter with broken internals — a positive example match for rattling_underneath_the_car." · S3: "Customer explicitly stated a rattling noise from the catalytic converter (under_car location) triggered by acceleration uphill (when_accelerating). No other facts were literally stated; all other slots remain null."
extracted_facts:
  onset_timing: "when_accelerating"
  noise_descriptor: "rattling"
  sound_or_smoke_location_zone: "under_car"
  customer_request_type: "diagnose_problem"
matched category key: exhaust_system_testing
matched sub category slug: rattling_underneath_the_car
unanswered question ids: [101, 102, 103, 104, 105]
testing service recommended: exhaust_system_testing — Exhaust system evaluation ($39.99)
}
```

<sub>S1: 16280ch · 1636ms · 22/75t · S2: 10596ch · 2005ms · 3419/73t · S3: 19853ch · 4106ms · 22/271t · Total: 7749ms wall 8302ms · 3463/419t</sub>

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
  step 8 (reasoning):                S1: "Rapid AC compressor cycling is a classic sign of low refrigerant or system pressure issue; ac_performance_check includes pressure verification and leak inspection to diagnose this concern." · S2: "Rapid compressor cycling is a classic symptom of low refrigerant charge causing evaporator freeze-thaw cycles, matching the 'AC cools for 15 minutes then warms up' positive example and partial cooling pattern described in this subcategory." · S3: "Customer clearly stated AC is on and compressor cycles rapidly, indicating a malfunction. hvac_mode=ac and customer_request_type=diagnose_problem are literal. No speed, location, timing, or other contextual details provided; left null per extraction rules."
extracted_facts:
  hvac_mode: "ac"
  customer_request_type: "diagnose_problem"
matched category key: ac_performance_check
matched sub category slug: ac_is_weak_not_cold_enough
unanswered question ids: [574, 575, 576, 577, 578, 579, 580]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 16280ch · 1707ms · 19/65t · S2: 19980ch · 2333ms · 19/92t · S3: 19938ch · 4118ms · 19/280t · Total: 8158ms wall 8554ms · 57/437t</sub>

### Test 21

```
{
concern: Vents shake when blower is on high
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 34 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'strange_noise_from_vents'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [603, 604, 605, 606, 607]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: medium
  step 8 (reasoning):                S1: "Customer reports vents shaking when blower is on high, which is a blower/HVAC operation issue; per catalog, vents/dashboard physically shaking from blower airflow routes to ac_performance_check, not suspension." · S2: "Customer reports a physical vibration/shaking from vents tied to blower speed, which aligns with 'strange_noise_from_vents' (rattling debris, failing motor bearings). However, 'shaking' is less explicitly covered than 'rattling' or 'grinding', creating slight ambiguity with 'vents_dont_blow_strongly' if airflow is also weak." · S3: "Customer clearly reported a rattling noise from the vents tied to blower fan speed (high setting). Onset timing inferred as 'when_idling' since blower operation is typically tested at idle, though customer didn't explicitly state vehicle speed. All other slots null as not mentioned."
extracted_facts:
  onset_timing: "when_idling"
  airflow_state: "strong_normal"
  noise_descriptor: "rattling"
  sound_or_smoke_location_zone: "from_vents"
  customer_request_type: "diagnose_problem"
matched category key: ac_performance_check
matched sub category slug: strange_noise_from_vents
unanswered question ids: [603, 604, 605, 606, 607]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 16280ch · 1812ms · 21/74t · S2: 19980ch · 2292ms · 21/122t · S3: 19991ch · 3731ms · 21/293t · Total: 7836ms wall 8315ms · 63/489t</sub>

### Test 22

```
{
concern: Fan only works on highest setting now
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'vents_dont_blow_strongly'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [945, 946, 947, 948, 949, 950]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports blower fan only works on highest setting, indicating a blower/mode operation issue within HVAC scope covered by A/C performance check." · S2: "Customer reports fan only works on highest speed setting, a classic positive example of blower motor resistor failure or fan speed control malfunction affecting airflow volume." · S3: "Customer clearly stated the blower fan only works on the highest setting, a classic blower motor resistor failure symptom. No other details provided; all other slots null."
extracted_facts:
  airflow_state: "only_on_highest_setting"
  customer_request_type: "diagnose_problem"
matched category key: ac_performance_check
matched sub category slug: vents_dont_blow_strongly
unanswered question ids: [945, 946, 947, 948, 949, 950]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 16280ch · 1448ms · 18/60t · S2: 19980ch · 1726ms · 18/65t · S3: 20043ch · 3218ms · 18/264t · Total: 6394ms wall 6983ms · 54/389t</sub>

### Test 23

```
{
concern: Heater core smells musty when I run the heat
LLM decision tree:
  step 1 (match category, S1):       matched 'ac_performance_check'
  step 2 (vagueness check):          passed — description has 44 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'bad_smell_from_vents'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [968, 969, 970, 971]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Musty smell from vents when running heat suggests HVAC system issue (mold/mildew in evaporator or ducts); ac_performance_check includes vent-side HVAC complaints like musty smell, though this is technically heat-side rather than cooling-side." · S2: "Customer reports musty smell tied to heat operation (vent-routed odor), matching the canonical 'bad_smell_from_vents' description for vent-delivered odors including musty/mildew from evaporator or heater core issues." · S3: "Customer explicitly stated musty smell when heat is on; interpreted 'when I run the heat' as onset at first turn-on (HVAC-specific trigger); smell comes through vents per subcategory context."
extracted_facts:
  onset_timing: "at_first_turn_on"
  hvac_mode: "heat"
  smell_descriptor: "musty_or_mildew"
  sound_or_smoke_location_zone: "from_vents"
matched category key: ac_performance_check
matched sub category slug: bad_smell_from_vents
unanswered question ids: [968, 969, 970, 971]
testing service recommended: ac_performance_check — A/C performance check ($54.95)
}
```

<sub>S1: 16280ch · 1856ms · 24/86t · S2: 19980ch · 1880ms · 24/90t · S3: 20014ch · 3140ms · 24/282t · Total: 6877ms wall 7321ms · 72/458t</sub>

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
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports musty/dirty-sock smell from AC vents when first turned on, which is a classic HVAC vent-side complaint that ac_performance_check explicitly covers in its scope." · S2: "Customer reports musty/dirty-socks smell tied to AC vent airflow on startup—a classic evaporator microbial growth symptom matching the positive example 'Vents smell like dirty socks when I turn on the AC'." · S3: "Customer explicitly stated AC mode, musty/dirty-socks smell (canonical musty_or_mildew), and timing of first AC turn-on. Smell clearly from vents per subcategory context. All other facts not mentioned."
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

<sub>S1: 16280ch · 1655ms · 26/70t · S2: 19980ch · 1874ms · 26/85t · S3: 20014ch · 3514ms · 26/288t · Total: 7043ms wall 7252ms · 78/443t</sub>

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

<sub>S1: 16280ch · 1618ms · 20/68t · S2: 12673ch · 1742ms · 3693/73t · S3: 19968ch · 3234ms · 20/272t · Total: 6595ms wall 7092ms · 3733/413t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 25 |
| matched an 'other' subcategory (forward-to-advisor) | 0 |
| null match (forwarded to advisor) | 0 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 46222 ms |
| sum stage-2 latencies | 52206 ms |
| sum stage-3 latencies | 93059 ms |
| sum input tokens | 48690 |
| sum output tokens | 10839 |
| **stage 1** confidence: high / medium / low / missing | 22 / 3 / 0 / 0 |
| **stage 2** confidence: high / medium / low / missing | 15 / 5 / 5 / 0 |
| **stage 3** confidence: high / medium / low / missing | 18 / 6 / 1 / 0 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 27 / 105 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.32 (n=25) |
