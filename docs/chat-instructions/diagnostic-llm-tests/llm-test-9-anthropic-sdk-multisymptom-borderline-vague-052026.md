# LLM diagnostic test — batch 9 (Haiku, Path C, multi-symptom + borderline-vague, May 2026)

**Ran:** 2026-05-21T02:42:12.369Z
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
concern: Brakes squeal AND my steering wheel shakes when I stop hard
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports two distinct symptoms (brake squeal + steering wheel shake during hard stops) that could involve brakes, suspension, or both—requires advisor triage before testing." · S2: "Customer reports two symptoms (brake squeal + steering shake during hard stops) but provides no details on onset timing, pattern, urgency, recent changes, or warning lights."
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 2718ms · 1957/63t · S2: 3285ch · 2047ms · 1280/96t · Total: 4766ms wall 6165ms · 3237/159t</sub>

### Test 2

```
{
concern: Engine runs rough AND my heat is barely working
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 47 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports two unrelated symptoms (rough engine AND weak heat), requiring a service advisor to triage which testing service(s) apply." · S2: "Customer reports two distinct symptoms (rough engine, weak heat) but provides no details about onset timing, patterns, urgency, recent changes, or warning lights."
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 2226ms · 1951/56t · S2: 3285ch · 1737ms · 1274/93t · Total: 3965ms wall 4547ms · 3225/149t</sub>

### Test 3

```
{
concern: Battery dies overnight AND I hear a clicking sound when I try to start
LLM decision tree:
  step 1 (match category, S1):       matched 'battery_test'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'wont_crank_just_clicks'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Battery dying overnight with clicking on start suggests electrical drain or weak battery; battery_test includes complete electrical-system diagnosis (battery health, alternator output, starter draw)." · S2: "Clicking sound on startup matches 'won't crank' subcategory, but overnight drain suggests parasitic draw; clicking answers Q874, other startup/battery details unanswered."
matched category key: battery_test
matched sub category slug: wont_crank_just_clicks
unanswered question ids: [875, 876, 877, 878, 879, 880]
testing service recommended: battery_test — Battery test ($0.00)
}
```

<sub>S1: 6398ch · 1975ms · 1956/54t · S2: 25499ch · 7065ms · 25/96t · Total: 9041ms wall 9448ms · 1981/150t</sub>

### Test 4

```
{
concern: AC stopped working AND I smell coolant
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 38 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports two distinct symptoms (AC failure + coolant smell) that could indicate separate issues or a shared root cause; requires service advisor triage before testing." · S2: "Customer reports two symptoms (AC failure + coolant smell) but provides no details on onset timing, pattern, triggers, urgency, recent changes, or warning lights."
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1521ms · 1950/60t · S2: 3285ch · 1936ms · 1273/95t · Total: 3457ms wall 3962ms · 3223/155t</sub>

### Test 5

```
{
concern: Car pulls to the right AND the brakes feel spongy
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports two distinct issues (pulling right + spongy brakes) that require separate diagnostics; routing to service advisor for triage." · S2: "Customer reports two distinct symptoms (pulling right + spongy brakes) but provides no timing, pattern, trigger, urgency, recent service, or warning light details."
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 2113ms · 1955/57t · S2: 3285ch · 2654ms · 1278/96t · Total: 4767ms wall 5221ms · 3233/153t</sub>

### Test 6

```
{
concern: Loud thump from rear when I brake AND I see fluid spots on my driveway
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'pedal_sinks_to_floor'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Loud thump during braking suggests brake system issue (worn pads, caliper problem); fluid spots indicate potential brake fluid leak—both warrant brake inspection." · S2: "Fluid spots + braking issue suggests brake system failure; pedal_sinks_to_floor best matches. Location (rear) answered; creep, pressure sensitivity, pop-back, recent work unanswered."
matched category key: brake_inspection
matched sub category slug: pedal_sinks_to_floor
unanswered question ids: [642, 643, 645, 646, 647]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6398ch · 1686ms · 1961/53t · S2: 24551ch · 2268ms · 30/100t · Total: 3956ms wall 4449ms · 1991/153t</sub>

### Test 7

```
{
concern: Check engine light came on AND the gas mileage tanked
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 53 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Check engine light with degraded fuel economy suggests engine performance issues; warning_light_general diagnostic will scan codes and identify the root cause." · S2: "Check engine light with poor fuel economy suggests emissions/fuel system issue; flashing status, engine feel, smells, gas cap, duration, and engine sounds not mentioned."
matched category key: warning_light_general
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 377, 378]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6398ch · 2195ms · 1955/50t · S2: 25455ch · 1983ms · 24/87t · Total: 4179ms wall 4557ms · 1979/137t</sub>

### Test 8

```
{
concern: Car shakes at highway speeds AND tires look fine
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_check'
  step 2 (vagueness check):          passed — description has 48 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'steering_wheel_shakes_at_highway_speed'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Highway shaking suggests suspension or steering component wear; suspension_check includes hands-on inspection of struts, bushings, and ball joints for play or wear." · S2: "Customer reports highway-speed shaking with no tire wear issues, but hasn't specified shake onset speed, braking correlation, steering-wheel-only vs whole-car, or recent balance/weight history."
matched category key: suspension_check
matched sub category slug: steering_wheel_shakes_at_highway_speed
unanswered question ids: [688, 689, 690, 691, 692, 693]
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>S1: 6398ch · 1438ms · 1953/53t · S2: 21194ch · 2573ms · 22/101t · Total: 4012ms wall 4567ms · 1975/154t</sub>

### Test 9

```
{
concern: Hesitates on acceleration AND I hear a popping sound
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 52 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'hesitation_or_lag_when_accelerating'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Hesitation on acceleration combined with popping sounds suggests transmission or engine performance issues; transmission_testing will diagnose via road-test and fluid inspection." · S2: "Hesitation on acceleration matches the subcategory, but popping sound suggests possible misfire; description lacks specifics on timing, gear, CEL status, onset, fuel, jerking, or frequency."
matched category key: transmission_testing
matched sub category slug: hesitation_or_lag_when_accelerating
unanswered question ids: [455, 456, 457, 458, 459, 460, 461]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6398ch · 3300ms · 1955/51t · S2: 11519ch · 1941ms · 3720/104t · Total: 5241ms wall 5565ms · 5675/155t</sub>

### Test 10

```
{
concern: Idles rough AND smells like gas inside the cabin
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 48 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports two distinct symptoms (rough idle + gas smell in cabin) that could indicate fuel system, emissions, or engine issues requiring a service advisor to triage before testing." · S2: "Customer reports two symptoms (rough idle + gas smell in cabin) but provides no timing, pattern, trigger, urgency, recent changes, or warning lights."
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1647ms · 1954/63t · S2: 3285ch · 1788ms · 1277/93t · Total: 3436ms wall 3824ms · 3231/156t</sub>

### Test 11

```
{
concern: Sometimes it does this thing where it kinda jerks
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague to categorize—'jerks' could indicate transmission, suspension, engine, or brake issues; needs clarification on when/how it occurs." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1968ms · 1953/52t · S2: skipped (no stage1 match) · Total: 1968ms wall 2338ms · 1953/52t</sub>

### Test 12

```
{
concern: Acts weird in the morning before warming up
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague to categorize—'acts weird' could indicate engine performance, transmission, electrical, or other issues; needs clarification on specific symptoms." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 3771ms · 1950/50t · S2: skipped (no stage1 match) · Total: 3772ms wall 4287ms · 1950/50t</sub>

### Test 13

```
{
concern: Maintenance light is something I should probably get checked
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 60 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'service_engine_soon_or_maintenance_required_light'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports a maintenance light, which is a warning light concern. This requires diagnostic scanning to read codes and explain what service is needed." · S2: "Customer mentions a maintenance light but provides no details about the message type, mileage, car condition, or service history."
matched category key: warning_light_general
matched sub category slug: service_engine_soon_or_maintenance_required_light
unanswered question ids: [2219, 2220, 2221, 2222, 2223, 2224]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6398ch · 1434ms · 1952/49t · S2: 25455ch · 2394ms · 21/91t · Total: 3828ms wall 4168ms · 1973/140t</sub>

### Test 14

```
{
concern: I think I need an inspection
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 28 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer requested a general inspection without specifying symptoms, matching the 'general check-up or pre-trip inspection' subcategory for non-specific diagnostic needs." · S2: "Customer requests an inspection but provides no details about trip purpose, maintenance history, mileage, concerns, or timeline."
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [786, 787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 2007ms · 1948/64t · S2: 3147ch · 1664ms · 1287/87t · Total: 3672ms wall 4208ms · 3235/151t</sub>

### Test 15

```
{
concern: Im not really sure but it feels off
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 35 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague to categorize—'feels off' lacks specific symptoms (noise, warning lights, performance issues, leaks, etc.) needed to match a testing service or 'other' subcategory." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1717ms · 1950/62t · S2: skipped (no stage1 match) · Total: 1718ms wall 2206ms · 1950/62t</sub>

### Test 16

```
{
concern: Want to make sure everything is good before a road trip
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 55 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer explicitly mentioned 'before a road trip' and wants to ensure everything is in good condition — a classic pre-trip inspection scenario." · S2: "Customer is preparing for a road trip (Q786 answered), but hasn't provided maintenance history, mileage, specific concerns, focus areas, or deadline details."
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 2472ms · 1953/58t · S2: 3147ch · 2000ms · 1292/94t · Total: 4474ms wall 4891ms · 3245/152t</sub>

### Test 17

```
{
concern: I bought this car used and want a complete check
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 48 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer wants a complete check on a recently purchased used car, which matches the general check-up / pre-trip inspection category for comprehensive vehicle assessment." · S2: "Customer wants a complete check on a used car but hasn't specified trip purpose, maintenance history, mileage, specific concerns, focus areas, or timeline."
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [786, 787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1515ms · 1952/60t · S2: 3147ch · 1790ms · 1291/95t · Total: 3305ms wall 3604ms · 3243/155t</sub>

### Test 18

```
{
concern: Lights look different than they used to be
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 42 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague to categorize—'lights look different' could refer to headlights, interior lights, dashboard illumination, or warning lights, but lacks specificity about the actual problem." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1816ms · 1951/58t · S2: skipped (no stage1 match) · Total: 1817ms wall 2179ms · 1951/58t</sub>

### Test 19

```
{
concern: Car is making a noise I cant describe
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague to categorize—'noise I can't describe' lacks specificity about type, location, or conditions needed to match a testing service." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1600ms · 1950/50t · S2: skipped (no stage1 match) · Total: 1601ms wall 2115ms · 1950/50t</sub>

### Test 20

```
{
concern: I just want it looked at
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 24 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague to categorize—'looked at' provides no specific symptoms or concerns to match against testing services or 'other' subcategories." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1925ms · 1948/50t · S2: skipped (no stage1 match) · Total: 1925ms wall 2329ms · 1948/50t</sub>

### Test 21

```
{
concern: Buddy of mine said I need a head gasket
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Head gasket replacement is engine work outside our testing service catalog; customer needs a mechanic quote, not a diagnostic test." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1690ms · 1953/42t · S2: skipped (no stage1 match) · Total: 1691ms wall 2277ms · 1953/42t</sub>

### Test 22

```
{
concern: The other shop said I need brakes
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 33 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (gap-detect questions, S2): skipped — stage2 didn't produce a valid subcategory
  step 5 (generate reasoning):       S1: "Customer reports brake work recommended by another shop; brake_inspection will measure pad thickness, inspect rotors/calipers, and verify the diagnosis." · S2: "Description is too vague to match any brake subcategory; no symptoms, sounds, or specific issues described."
matched category key: brake_inspection
matched sub category slug: null
unanswered question ids: []
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6398ch · 1958ms · 1950/50t · S2: 24551ch · 1436ms · 19/53t · Total: 3394ms wall 3645ms · 1969/103t</sub>

### Test 23

```
{
concern: Want a second opinion on what my dealer told me
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 47 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague to categorize—no specific symptoms or concerns mentioned, only a request for a second opinion without details about what the dealer said." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1640ms · 1952/48t · S2: skipped (no stage1 match) · Total: 1640ms wall 1855ms · 1952/48t</sub>

### Test 24

```
{
concern: Need an oil change and tire rotation
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 36 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Oil changes and tire rotations are routine maintenance services, not diagnostic testing. This doesn't fit any testing service or 'other' diagnostic category in the catalog." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1541ms · 1949/50t · S2: skipped (no stage1 match) · Total: 1541ms wall 2011ms · 1949/50t</sub>

### Test 25

```
{
concern: Need a state inspection
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 23 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer needs a state inspection, which is a general vehicle check-up rather than a specific diagnostic test service." · S2: "State inspection is a routine check-up, but description provides no details about trip purpose, maintenance history, mileage, concerns, or timeline."
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [786, 787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6398ch · 1644ms · 1946/52t · S2: 3147ch · 1721ms · 1285/93t · Total: 3365ms wall 4015ms · 3231/145t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 7 |
| matched an 'other' subcategory (forward-to-advisor) | 9 |
| null match (forwarded to advisor) | 9 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** silently filtered question IDs | 0 |
| **stage 2** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 49517 ms |
| sum stage-2 latencies | 36997 ms |
| sum input tokens | 64202 |
| sum output tokens | 2829 |
