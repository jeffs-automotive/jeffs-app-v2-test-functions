# LLM diagnostic test — batch 7 (Haiku, Path C, warning lights/transmission/HVAC variants, May 2026)

**Ran:** 2026-05-21T02:36:40.391Z
**Architecture:** two-stage classifier (refactor 2026-05-20)
**Stage 1 model:** `anthropic/claude-haiku-4-5` (category match — brief catalog)
**Stage 2 model:** `anthropic/claude-haiku-4-5` (subcategory pick + gap-detect — single-category subtree)
**Catalog at test time:** 15 testing services + 6 'other' subcategories = 21 entries
**Chip hint:** Other Issue (no pre-classification — the hardest classification case)
**Endpoint:** `https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/llm-testing`
**Caching:** `providerOptions.gateway.caching='auto'` enabled on both stages.

## Per-step labels

- `matched 'X'` — successful step
- `LLM returned null` — LLM intentionally declined (not a failure)
- `hallucinated` — LLM returned a slug not in catalog; post-validation dropped it
- `silently_failed` — values dropped by validation without an explicit error
- `failed` — that stage's LLM call errored or returned malformed structured output
- `short_circuit` — pre-LLM short-circuit (desc<3 chars)
- `skipped` — upstream step's outcome made this step a no-op

## Test cases

### Test 1

```
{
concern: TPMS light came on and won't go off even after I checked the tire pressures
LLM decision tree:
  step 1 (match category, S1):       matched 'tpms_testing'
  step 2 (vagueness check):          passed — description has 75 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'low_pressure_warning_light_only'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "TPMS light persisting despite correct tire pressures indicates a faulty sensor requiring diagnostic testing to identify which sensor needs replacement." · S2: "Customer reports TPMS light staying on despite checking pressures; needs clarity on light behavior, timing, recent service, and whether air was added."
matched category key: tpms_testing
matched sub category slug: low_pressure_warning_light_only
unanswered question ids: [723, 724, 726, 727, 728, 729]
testing service recommended: tpms_testing — Tire pressure (TPMS) light testing ($54.95)
}
```

<sub>S1: 6398ch · 7195ms · 1962/49t · S2: 24332ch · 2357ms · 31/87t · Total: 9552ms wall 10117ms · 1993/136t</sub>

### Test 2

```
{
concern: Traction control light flashes randomly while driving
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'traction_control_stability_light'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Flashing traction control light indicates a warning code that requires diagnostic scanning to identify the underlying issue (brake, ABS, or stability control system problem)." · S2: "Customer reports flashing traction control light during driving; answered Q434 (flashes on slippery roads pattern), but missing details on ABS co-illumination, grip loss, trigger conditions, tire changes, button status, and steering feel."
matched category key: warning_light_general
matched sub category slug: traction_control_stability_light
unanswered question ids: [435, 436, 437, 438, 439, 440]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6398ch · 5041ms · 1952/54t · S2: 25455ch · 2248ms · 21/107t · Total: 7289ms wall 7635ms · 1973/161t</sub>

### Test 3

```
{
concern: Service engine soon light came on yesterday
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'service_engine_soon_or_maintenance_required_light'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Service engine soon light is a check-engine warning that requires diagnostic scanning to read codes and identify the underlying issue." · S2: "Customer reports Service Engine Soon light came on yesterday but hasn't provided details about mileage since last service, car condition, or recent maintenance history."
matched category key: warning_light_general
matched sub category slug: service_engine_soon_or_maintenance_required_light
unanswered question ids: [2220, 2221, 2222, 2223, 2224]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6398ch · 3099ms · 1949/45t · S2: 25455ch · 2061ms · 18/92t · Total: 5160ms wall 5686ms · 1967/137t</sub>

### Test 4

```
{
concern: BAS light is on along with the ABS light
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'abs_anti_lock_brake_light'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "BAS and ABS warning lights indicate brake system issues requiring diagnostic code scanning to identify the underlying problem." · S2: "Customer reports ABS light on; BAS (brake assist) typically falls under ABS/brake diagnostics. All ABS subcategory questions remain unanswered."
matched category key: warning_light_general
matched sub category slug: abs_anti_lock_brake_light
unanswered question ids: [413, 414, 415, 416, 417, 418, 419]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6398ch · 2523ms · 1953/43t · S2: 25455ch · 1822ms · 22/95t · Total: 4346ms wall 4774ms · 1975/138t</sub>

### Test 5

```
{
concern: Low fuel light keeps flickering even when I have half a tank
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (gap-detect questions, S2): skipped — stage2 didn't produce a valid subcategory
  step 5 (generate reasoning):       S1: "Low fuel warning light flickering despite adequate fuel level suggests a faulty fuel sender or electrical issue requiring diagnostic code scanning." · S2: "Low fuel light flickering is not a warning light category covered in this service key; it's a fuel gauge/sender issue, not a diagnostic warning light."
matched category key: warning_light_general
matched sub category slug: null
unanswered question ids: []
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6398ch · 1889ms · 1955/46t · S2: 25455ch · 2284ms · 24/62t · Total: 4174ms wall 4621ms · 1979/108t</sub>

### Test 6

```
{
concern: Parking brake light stays on after I release the brake
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 54 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'brake_system_red_light'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Parking brake warning light staying on after release indicates a warning light issue requiring diagnostic scanning to identify the underlying electrical or brake system fault." · S2: "Customer reports parking brake light staying on after release, directly answering Q420. Remaining questions about pedal feel, fluid level, ABS status, stopping ability, leaks, and onset pattern are unanswered."
matched category key: warning_light_general
matched sub category slug: brake_system_red_light
unanswered question ids: [421, 422, 423, 424, 425, 426]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6398ch · 1858ms · 1953/49t · S2: 25455ch · 2132ms · 22/100t · Total: 3991ms wall 4419ms · 1975/149t</sub>

### Test 7

```
{
concern: Transmission temp light came on during a long highway drive
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (gap-detect questions, S2): skipped — stage2 didn't produce a valid subcategory
  step 5 (generate reasoning):       S1: "Transmission temperature warning light during highway driving indicates potential transmission fluid or cooling issue; transmission_testing will diagnose via road-test, codes, and fluid inspection." · S2: "Transmission temperature warning light is a fluid/cooling system issue, not an engine performance or drivability problem covered by these transmission testing subcategories."
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6398ch · 2679ms · 1953/53t · S2: 11519ch · 2723ms · 3718/61t · Total: 5403ms wall 5878ms · 5671/114t</sub>

### Test 8

```
{
concern: Battery light came on but the car is still running fine
LLM decision tree:
  step 1 (match category, S1):       matched 'battery_test'
  step 2 (vagueness check):          passed — description has 55 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'battery_charging_light'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Battery light indicates potential electrical system issue; free battery test checks battery health, alternator output, and starter draw to diagnose the warning." · S2: "Battery/charging light is on; customer reports car runs fine but hasn't answered questions about onset, electrical symptoms, recent service, or light behavior."
matched category key: battery_test
matched sub category slug: battery_charging_light
unanswered question ids: [385, 386, 387, 388, 389, 390, 391]
testing service recommended: battery_test — Battery test ($0.00)
}
```

<sub>S1: 6398ch · 2077ms · 1953/48t · S2: 25499ch · 1956ms · 22/85t · Total: 4035ms wall 4507ms · 1975/133t</sub>

### Test 9

```
{
concern: All my dash lights are flickering when the engine is running
LLM decision tree:
  step 1 (match category, S1):       matched 'battery_test'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'dim_or_flickering_lights'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Flickering dash lights while engine running typically indicate a charging system issue; battery test includes alternator output and electrical system diagnosis." · S2: "Customer reports flickering dashboard lights while engine running; matches dim/flickering subcategory but hasn't answered about engine revving response, interior lights, burning smell, belt noise, or recent electrical work."
matched category key: battery_test
matched sub category slug: dim_or_flickering_lights
unanswered question ids: [540, 542, 543, 544, 545]
testing service recommended: battery_test — Battery test ($0.00)
}
```

<sub>S1: 6398ch · 1583ms · 1954/46t · S2: 25499ch · 3096ms · 23/94t · Total: 4680ms wall 5183ms · 1977/140t</sub>

### Test 10

```
{
concern: Transmission slips between 2nd and 3rd gear when warm
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (gap-detect questions, S2): skipped — stage2 didn't produce a valid subcategory
  step 5 (generate reasoning):       S1: "Transmission slips between 2nd and 3rd gear when warm — a clear transmission performance issue requiring road-test and fluid inspection to diagnose internal problems." · S2: "Customer describes transmission slipping (gear engagement issue), which falls under transmission_testing category but no subcategory in the list addresses transmission slip/gear engagement problems."
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6398ch · 1852ms · 1957/54t · S2: 11519ch · 1681ms · 3722/63t · Total: 3533ms wall 3982ms · 5679/117t</sub>

### Test 11

```
{
concern: Reverse gear works but feels delayed by a couple seconds
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 56 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (gap-detect questions, S2): skipped — stage2 didn't produce a valid subcategory
  step 5 (generate reasoning):       S1: "Delayed reverse gear engagement suggests transmission fluid or internal transmission issues; transmission_testing will road-test and scan for codes to diagnose the delay." · S2: "Reverse gear delay is a transmission mechanical/hydraulic issue, not an engine performance problem. No subcategory in this transmission_testing category matches this symptom."
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6398ch · 2107ms · 1953/50t · S2: 11519ch · 1904ms · 3718/62t · Total: 4012ms wall 4554ms · 5671/112t</sub>

### Test 12

```
{
concern: Car kicks hard into gear when accelerating from a stop
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 54 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'hesitation_or_lag_when_accelerating'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Hard gear engagement during acceleration suggests transmission issues; transmission_testing will road-test, scan codes, and inspect fluid to diagnose the problem." · S2: "Customer describes hard gear engagement during acceleration from stop; matches hesitation/lag subcategory. Missing details on gear range, check engine light, onset timing, fuel history, and frequency."
matched category key: transmission_testing
matched sub category slug: hesitation_or_lag_when_accelerating
unanswered question ids: [456, 457, 458, 459, 461]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6398ch · 1540ms · 1953/49t · S2: 11519ch · 1766ms · 3718/93t · Total: 3307ms wall 4388ms · 5671/142t</sub>

### Test 13

```
{
concern: Manual transmission grinds when shifting into 3rd
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (gap-detect questions, S2): skipped — stage2 didn't produce a valid subcategory
  step 5 (generate reasoning):       S1: "Manual transmission grinding during gear shifts indicates internal transmission issues; transmission_testing will road-test, scan codes, and inspect fluid to diagnose the grinding problem." · S2: "Customer describes a manual transmission grinding issue during gear shifts, which falls outside the engine/fuel system subcategories available in this transmission_testing category."
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6398ch · 1918ms · 1953/52t · S2: 11519ch · 2848ms · 3718/58t · Total: 4767ms wall 5168ms · 5671/110t</sub>

### Test 14

```
{
concern: My CVT transmission feels like its slipping or hunting for gears
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 64 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'surging_or_rpms_going_up_and_down'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports CVT transmission slipping/hunting behavior, which directly matches transmission_testing service that includes road-test and fluid inspection for internal issues." · S2: "CVT slipping/hunting suggests RPM fluctuation; all 7 questions about surging behavior, engine state, recent work, and driving conditions remain unanswered."
matched category key: transmission_testing
matched sub category slug: surging_or_rpms_going_up_and_down
unanswered question ids: [1189, 1190, 1191, 1192, 1193, 1194, 1195]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6398ch · 1722ms · 1956/50t · S2: 11519ch · 2032ms · 3721/100t · Total: 3754ms wall 4095ms · 5677/150t</sub>

### Test 15

```
{
concern: Exhaust is rattling somewhere under the car
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Exhaust rattle is a mechanical/structural issue not covered by our testing service catalog; requires hands-on inspection by service advisor." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1982ms · 1952/45t · S2: skipped (no stage1 match) · Total: 1982ms wall 2500ms · 1952/45t</sub>

### Test 16

```
{
concern: Black smoke from the tailpipe when I floor it
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 45 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'black_smoke_from_tailpipe'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Black smoke from tailpipe suggests engine overheating or coolant leak; coolant_leak_testing includes smoke diagnosis and cooling system pressure testing." · S2: "Customer reports black smoke when accelerating hard (flooring it), matching the subcategory. Trigger is answered; fuel type, mileage, engine behavior, air filter age, check engine light status, and fuel smell are not mentioned."
matched category key: coolant_leak_testing
matched sub category slug: black_smoke_from_tailpipe
unanswered question ids: [296, 297, 298, 299, 300, 301]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 6398ch · 2249ms · 1953/54t · S2: 34695ch · 2388ms · 22/106t · Total: 4638ms wall 5494ms · 1975/160t</sub>

### Test 17

```
{
concern: Blue smoke from the tailpipe at startup
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'blue_or_gray_smoke_from_tailpipe'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Blue smoke at startup typically indicates burning oil, which can stem from coolant system issues, overheating, or internal engine problems; coolant leak testing will diagnose cooling-system failures that may cause this symptom." · S2: "Customer reports blue smoke at startup, matching the blue/gray smoke subcategory. Questions about hard acceleration, coasting, oil-adding frequency, turbo presence, and tailpipe buildup remain unanswered."
matched category key: coolant_leak_testing
matched sub category slug: blue_or_gray_smoke_from_tailpipe
unanswered question ids: [289, 290, 291, 293, 294]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 6398ch · 2117ms · 1951/68t · S2: 34695ch · 2176ms · 20/103t · Total: 4293ms wall 4655ms · 1971/171t</sub>

### Test 18

```
{
concern: Engine is louder than usual and sounds raspier
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 46 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description lacks specificity about the noise source (exhaust, internal knock, belt, etc.) and doesn't clearly map to a single testing service; needs Stage 2 clarification." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 2334ms · 1952/55t · S2: skipped (no stage1 match) · Total: 2335ms wall 2773ms · 1952/55t</sub>

### Test 19

```
{
concern: Catalytic converter rattle when accelerating uphill
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 51 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Catalytic converter rattle is a mechanical/exhaust issue not covered by our testing service catalog; recommend service advisor consultation." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1744ms · 1953/43t · S2: skipped (no stage1 match) · Total: 1744ms wall 1978ms · 1953/43t</sub>

### Test 20

```
{
concern: AC compressor cycles on and off rapidly
LLM decision tree:
  step 1 (match category, S1):       matched 'check_ac'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'ac_blows_warm_or_hot_air'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "AC compressor cycling on and off rapidly indicates a refrigerant or compressor issue that requires the full A/C performance check including pressure testing and compressor cycling diagnosis." · S2: "Rapid compressor cycling suggests AC malfunction but description lacks detail on temperature output, onset, maintenance history, and leak signs needed to diagnose."
matched category key: check_ac
matched sub category slug: ac_blows_warm_or_hot_air
unanswered question ids: [567, 568, 569, 570, 571, 572, 573]
testing service recommended: check_ac — A/C performance check ($89.95)
}
```

<sub>S1: 6398ch · 1924ms · 1950/55t · S2: 10506ch · 2033ms · 3395/92t · Total: 3958ms wall 4462ms · 5345/147t</sub>

### Test 21

```
{
concern: Vents shake when blower is on high
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_check'
  step 2 (vagueness check):          passed — description has 34 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'electrical_buzzing'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Vibration when blower runs high suggests a mechanical issue with the HVAC blower motor or mounting, which requires hands-on inspection similar to suspension diagnostics for play and wear." · S2: "Vents shaking on high blower suggests electrical/mechanical vibration, but description lacks detail on timing, location, electrical symptoms, or recent work."
matched category key: suspension_check
matched sub category slug: electrical_buzzing
unanswered question ids: [134, 135, 136, 137, 138, 139, 140]
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>S1: 6398ch · 1815ms · 1952/59t · S2: 21194ch · 1936ms · 21/77t · Total: 3752ms wall 4146ms · 1973/136t</sub>

### Test 22

```
{
concern: Fan only works on highest setting now
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Fan speed control failure suggests an electrical issue with the HVAC blower motor circuit; matches 'electrical' concern category for non-alternator/battery diagnostics." · S2: "Fan (blower motor) is functioning but only at max speed; matches accessory malfunction. Missing details on onset, prior incidents, electrical sounds, and fuse status."
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (non-alternator/battery) ($179.99)
}
```

<sub>S1: 6398ch · 2221ms · 1949/57t · S2: 11621ch · 2052ms · 3596/85t · Total: 4273ms wall 4681ms · 5545/142t</sub>

### Test 23

```
{
concern: Heater core smells musty when I run the heat
LLM decision tree:
  step 1 (match category, S1):       matched 'check_ac'
  step 2 (vagueness check):          passed — description has 44 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'bad_smell_from_vents'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Musty smell from heater suggests blend-door or HVAC system issue; A/C performance check includes blend-door operation and system diagnostics." · S2: "Musty smell from vents during heat operation matches bad_smell_from_vents; description confirms musty odor and heat-on trigger but lacks details on timing, windows, filter history, onset, and recirculate behavior."
matched category key: check_ac
matched sub category slug: bad_smell_from_vents
unanswered question ids: [966, 967, 968, 969, 970, 971]
testing service recommended: check_ac — A/C performance check ($89.95)
}
```

<sub>S1: 6398ch · 1838ms · 1955/53t · S2: 10506ch · 2268ms · 3400/105t · Total: 4106ms wall 4442ms · 5355/158t</sub>

### Test 24

```
{
concern: AC works but smells like dirty socks when I first turn it on
LLM decision tree:
  step 1 (match category, S1):       matched 'check_ac'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'bad_smell_from_vents'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports A/C odor issue ('smells like dirty socks'), which indicates potential mold/mildew in the A/C system; check_ac includes blend-door and system inspection to identify the source." · S2: "Customer reports musty/moldy smell (dirty socks) when AC first turns on; onset timing answered but AC-vs-heat mode, filter history, fogging, recent service, and recirculate behavior not mentioned."
matched category key: check_ac
matched sub category slug: bad_smell_from_vents
unanswered question ids: [967, 968, 969, 970, 971]
testing service recommended: check_ac — A/C performance check ($89.95)
}
```

<sub>S1: 6398ch · 1812ms · 1957/67t · S2: 10506ch · 3543ms · 3402/99t · Total: 5356ms wall 5715ms · 5359/166t</sub>

### Test 25

```
{
concern: Climate control buttons stopped lighting up on the dash
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 55 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Climate control button illumination is an electrical issue unrelated to A/C performance; general electrical testing will diagnose the dashboard lighting circuit failure." · S2: "Climate control buttons not lighting up is an accessory/dashboard lighting issue; specific component identified but onset, trigger, and electrical diagnostics remain unclear."
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (non-alternator/battery) ($179.99)
}
```

<sub>S1: 6398ch · 1711ms · 1951/51t · S2: 11621ch · 1732ms · 3598/90t · Total: 3443ms wall 3947ms · 5549/141t</sub>

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
| **stage 2** silently filtered question IDs | 0 |
| **stage 2** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 58830 ms |
| sum stage-2 latencies | 49038 ms |
| sum input tokens | 88783 |
| sum output tokens | 3211 |
