# LLM diagnostic test — batch 1 (May 2026)

**Ran:** 2026-05-20T23:50:26.563Z
**Model:** `google/gemini-2.5-flash`
**Catalog at test time:** 15 active testing services + 6 'other' subcategories = 21 entries
**Chip hint:** Other Issue (no pre-classification — the hardest classification case for the LLM)
**Endpoint:** `https://itzdasxobllfiuolmbxu.supabase.co/functions/v1/llm-testing`

## Per-step labels

- `matched 'X'` — successful step
- `LLM returned null` — LLM intentionally declined (not a failure)
- `hallucinated` — LLM returned a slug not in the catalog; post-validation dropped it
- `silently_failed` — values dropped by validation without an explicit error (e.g. question IDs not in the matched subcategory)
- `failed` — LLM call itself errored or returned malformed structured output
- `short_circuit` — pre-LLM short-circuit (desc<3 chars)
- `skipped` — upstream step's outcome made this step a no-op

## Test cases

### Test 1

```
{
concern: My car makes a loud knocking noise when I first start it in the morning but it stops after about a minute
LLM decision tree:
  step 1 (match category):       failed — LLM call errored: No object generated: could not parse the response.
  step 2 (vagueness check):      passed — description has 105 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   skipped — no LLM output
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 6476ms (wall 7236ms) · Tokens in/out: 0/0 · err: No object generated: could not parse the response.</sub>

### Test 2

```
{
concern: Brakes squeak really bad when I'm coming to a stop especially at slow speeds
LLM decision tree:
  step 1 (match category):       matched 'brake_inspection'
  step 2 (vagueness check):      passed — description has 76 chars (>=3)
  step 3 (pick subcategory):     matched 'high_pitched_squealing'
  step 4 (gap-detect questions): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's description of 'brakes squeak really bad when I'm coming to a stop especially at slow speeds' best matches the 'high_pitched_squealing' subcategory under 'brake_inspection'."
matched category key: brake_inspection
matched sub category slug: high_pitched_squealing
unanswered question ids: [624, 839, 626, 627, 628, 629]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>Latency: 4001ms (wall 4517ms) · Tokens in/out: 37737/137</sub>

### Test 3

```
{
concern: AC blows hot air on the driver side but cold on the passenger side
LLM decision tree:
  step 1 (match category):       matched 'check_ac'
  step 2 (vagueness check):      passed — description has 66 chars (>=3)
  step 3 (pick subcategory):     matched 'one_zone_works_but_another_doesnt'
  step 4 (gap-detect questions): 4 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's description 'AC blows hot air on the driver side but cold on the passenger side' directly matches the 'one_zone_works_but_another_doesnt' subcategory, which is part of the 'check_ac' testing service."
matched category key: check_ac
matched sub category slug: one_zone_works_but_another_doesnt
unanswered question ids: [975, 976, 977, 978]
testing service recommended: check_ac — A/C performance check ($89.95)
}
```

<sub>Latency: 4487ms (wall 4853ms) · Tokens in/out: 37733/138</sub>

### Test 4

```
{
concern: When I turn the steering wheel all the way left I hear a clicking noise
LLM decision tree:
  step 1 (match category):       matched 'suspension_check'
  step 2 (vagueness check):      passed — description has 71 chars (>=3)
  step 3 (pick subcategory):     matched 'popping_or_clicking_when_turning'
  step 4 (gap-detect questions): 3 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's description 'When I turn the steering wheel all the way left I hear a clicking noise' most closely matches the 'popping_or_clicking_when_turning' subcategory under 'suspension_check'."
matched category key: suspension_check
matched sub category slug: popping_or_clicking_when_turning
unanswered question ids: [116, 117, 119]
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>Latency: 4455ms (wall 4943ms) · Tokens in/out: 37734/124</sub>

### Test 5

```
{
concern: Battery keeps dying overnight even though it's only 2 years old
LLM decision tree:
  step 1 (match category):       failed — LLM call errored: No object generated: could not parse the response.
  step 2 (vagueness check):      passed — description has 63 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   skipped — no LLM output
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 5848ms (wall 6356ms) · Tokens in/out: 0/0 · err: No object generated: could not parse the response.</sub>

### Test 6

```
{
concern: There's a sweet syrupy smell coming from under the hood after driving for a while
LLM decision tree:
  step 1 (match category):       failed — LLM call errored: No object generated: could not parse the response.
  step 2 (vagueness check):      passed — description has 81 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   skipped — no LLM output
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 8163ms (wall 8676ms) · Tokens in/out: 0/0 · err: No object generated: could not parse the response.</sub>

### Test 7

```
{
concern: White smoke coming out the tailpipe when I accelerate hard
LLM decision tree:
  step 1 (match category):       matched 'coolant_leak_testing'
  step 2 (vagueness check):      passed — description has 58 chars (>=3)
  step 3 (pick subcategory):     matched 'white_smoke_from_tailpipe'
  step 4 (gap-detect questions): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer describes white smoke from the tailpipe, which aligns with the 'white_smoke_from_tailpipe' subcategory for coolant leak testing."
matched category key: coolant_leak_testing
matched sub category slug: white_smoke_from_tailpipe
unanswered question ids: [281, 282, 283, 284, 285, 286, 287]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>Latency: 5771ms (wall 6255ms) · Tokens in/out: 37730/132</sub>

### Test 8

```
{
concern: Brake pedal goes almost to the floor before the brakes engage
LLM decision tree:
  step 1 (match category):       matched 'brake_inspection'
  step 2 (vagueness check):      passed — description has 61 chars (>=3)
  step 3 (pick subcategory):     matched 'pedal_sinks_to_floor'
  step 4 (gap-detect questions): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):   "Matched to 'brake_inspection' and subcategory 'pedal_sinks_to_floor' because the customer explicitly stated 'Brake pedal goes almost to the floor'."
matched category key: brake_inspection
matched sub category slug: pedal_sinks_to_floor
unanswered question ids: [642, 643, 644, 645, 646, 647]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>Latency: 4100ms (wall 4609ms) · Tokens in/out: 37731/129</sub>

### Test 9

```
{
concern: Steering wheel pulls hard to the right whenever I let go on the highway
LLM decision tree:
  step 1 (match category):       matched 'suspension_check'
  step 2 (vagueness check):      passed — description has 71 chars (>=3)
  step 3 (pick subcategory):     matched 'pulling_drifting_or_wandering_on_the_road'
  step 4 (gap-detect questions): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's description of the steering wheel pulling hard to the right on the highway best matches the 'pulling_drifting_or_wandering_on_the_road' subcategory under the 'suspension_check' service."
matched category key: suspension_check
matched sub category slug: pulling_drifting_or_wandering_on_the_road
unanswered question ids: [697, 698, 699, 700, 701]
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>Latency: 4730ms (wall 5094ms) · Tokens in/out: 37734/145</sub>

### Test 10

```
{
concern: Tires wearing unevenly on the front passenger side, looks like cupping
LLM decision tree:
  step 1 (match category):       matched 'tpms_testing'
  step 2 (vagueness check):      passed — description has 70 chars (>=3)
  step 3 (pick subcategory):     matched 'uneven_tire_wear_bald_spots'
  step 4 (gap-detect questions): 4 unanswered IDs (all valid)
  step 5 (generate reasoning):   "Matched to 'tpms_testing' and subcategory 'uneven_tire_wear_bald_spots' because the customer explicitly mentioned 'Tires wearing unevenly on the front passenger side, looks like cupping'."
matched category key: tpms_testing
matched sub category slug: uneven_tire_wear_bald_spots
unanswered question ids: [733, 734, 735, 736]
testing service recommended: tpms_testing — Tire pressure (TPMS) light testing ($54.95)
}
```

<sub>Latency: 4385ms (wall 4749ms) · Tokens in/out: 37734/128</sub>

### Test 11

```
{
concern: Check engine light came on yesterday but car drives normal
LLM decision tree:
  step 1 (match category):       matched 'warning_light_general'
  step 2 (vagueness check):      passed — description has 58 chars (>=3)
  step 3 (pick subcategory):     matched 'check_engine_light'
  step 4 (gap-detect questions): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's description 'Check engine light came on yesterday but car drives normal' best matches the 'check_engine_light' subcategory under 'warning_light_general'."
matched category key: warning_light_general
matched sub category slug: check_engine_light
unanswered question ids: [372, 374, 375, 376, 377, 378]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>Latency: 4240ms (wall 4586ms) · Tokens in/out: 37729/128</sub>

### Test 12

```
{
concern: ABS light just turned on a few minutes ago and stayed on
LLM decision tree:
  step 1 (match category):       failed — LLM call errored: No object generated: could not parse the response.
  step 2 (vagueness check):      passed — description has 56 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   skipped — no LLM output
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 5425ms (wall 5782ms) · Tokens in/out: 0/0 · err: No object generated: could not parse the response.</sub>

### Test 13

```
{
concern: Airbag light is flashing intermittently
LLM decision tree:
  step 1 (match category):       matched 'warning_light_general'
  step 2 (vagueness check):      passed — description has 39 chars (>=3)
  step 3 (pick subcategory):     matched 'airbag_srs_light'
  step 4 (gap-detect questions): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's description 'Airbag light is flashing intermittently' best matches the 'airbag_srs_light' subcategory under the 'warning_light_general' testing service."
matched category key: warning_light_general
matched sub category slug: airbag_srs_light
unanswered question ids: [427, 428, 429, 430, 432, 433]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>Latency: 6501ms (wall 6885ms) · Tokens in/out: 37725/123</sub>

### Test 14

```
{
concern: Oil pressure light flickers when I come to a stop at idle
LLM decision tree:
  step 1 (match category):       matched 'warning_light_general'
  step 2 (vagueness check):      passed — description has 57 chars (>=3)
  step 3 (pick subcategory):     matched 'oil_pressure_light'
  step 4 (gap-detect questions): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The 'oil_pressure_light' subcategory is chosen because the customer explicitly states 'Oil pressure light flickers when I come to a stop at idle'."
matched category key: warning_light_general
matched sub category slug: oil_pressure_light
unanswered question ids: [392, 393, 394, 395, 397, 398]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>Latency: 4481ms (wall 5002ms) · Tokens in/out: 37732/123</sub>

### Test 15

```
{
concern: Car has been sitting in my driveway for 8 months, want to make sure it's road ready before driving it
LLM decision tree:
  step 1 (match category):       matched 'car_has_been_sitting_unused_for_a_long_time'
  step 2 (vagueness check):      passed — description has 101 chars (>=3)
  step 3 (pick subcategory):     matched 'car_has_been_sitting_unused_for_a_long_time'
  step 4 (gap-detect questions): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's description about their car sitting for 8 months perfectly matches the 'car_has_been_sitting_unused_for_a_long_time' subcategory."
matched category key: car_has_been_sitting_unused_for_a_long_time
matched sub category slug: car_has_been_sitting_unused_for_a_long_time
unanswered question ids: [795, 796, 797, 798, 799]
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 7182ms (wall 7681ms) · Tokens in/out: 37743/147</sub>

### Test 16

```
{
concern: Just got rear-ended last week and now the car pulls left, want to make sure suspension is OK
LLM decision tree:
  step 1 (match category):       failed — LLM call errored: No object generated: could not parse the response.
  step 2 (vagueness check):      passed — description has 92 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   skipped — no LLM output
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 6945ms (wall 7488ms) · Tokens in/out: 0/0 · err: No object generated: could not parse the response.</sub>

### Test 17

```
{
concern: Going on a 1500 mile road trip next weekend, want a complete check before I go
LLM decision tree:
  step 1 (match category):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):      passed — description has 78 chars (>=3)
  step 3 (pick subcategory):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (gap-detect questions): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's request for a 'complete check before I go' on a 'road trip' directly matches the 'general_check_up_or_pre_trip_inspection' subcategory."
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 5198ms (wall 5376ms) · Tokens in/out: 37740/148</sub>

### Test 18

```
{
concern: Just had new tires installed at Discount Tire yesterday and now I feel a vibration at 65mph
LLM decision tree:
  step 1 (match category):       matched 'tpms_testing'
  step 2 (vagueness check):      passed — description has 91 chars (>=3)
  step 3 (pick subcategory):     matched 'recent_tire_work_then_new_symptom'
  step 4 (gap-detect questions): 3 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The 'tpms_testing' category and 'recent_tire_work_then_new_symptom' subcategory are matched because the customer reported 'Just had new tires installed' and now feels 'a vibration at 65mph', directly matching the subcategory's focus on new symptoms after tire work."
matched category key: tpms_testing
matched sub category slug: recent_tire_work_then_new_symptom
unanswered question ids: [755, 756, 757]
testing service recommended: tpms_testing — Tire pressure (TPMS) light testing ($54.95)
}
```

<sub>Latency: 3806ms (wall 4176ms) · Tokens in/out: 37739/146</sub>

### Test 19

```
{
concern: Engine bay smells like burning oil after I drive for like 20 minutes
LLM decision tree:
  step 1 (match category):       matched 'oil_leak_testing'
  step 2 (vagueness check):      passed — description has 68 chars (>=3)
  step 3 (pick subcategory):     matched 'burnt_oil_smell'
  step 4 (gap-detect questions): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer described a burnt oil smell from the engine bay after driving, which directly matches the 'burnt_oil_smell' subcategory under 'oil_leak_testing'."
matched category key: oil_leak_testing
matched sub category slug: burnt_oil_smell
unanswered question ids: [234, 235, 236, 237, 238]
testing service recommended: oil_leak_testing — Oil leak testing ($179.95)
}
```

<sub>Latency: 4135ms (wall 4543ms) · Tokens in/out: 37734/122</sub>

### Test 20

```
{
concern: Squealing high-pitched noise from the front right wheel when I brake but only sometimes
LLM decision tree:
  step 1 (match category):       matched 'brake_inspection'
  step 2 (vagueness check):      passed — description has 87 chars (>=3)
  step 3 (pick subcategory):     matched 'high_pitched_squealing'
  step 4 (gap-detect questions): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):   "The customer's description 'Squealing high-pitched noise from the front right wheel when I brake' best matches the 'high_pitched_squealing' subcategory under 'brake_inspection'."
matched category key: brake_inspection
matched sub category slug: high_pitched_squealing
unanswered question ids: [623, 624, 839, 626, 627, 628]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>Latency: 5258ms (wall 5756ms) · Tokens in/out: 37737/133</sub>

### Test 21

```
{
concern: Something just feels off, can't really describe it
LLM decision tree:
  step 1 (match category):       LLM returned null — declined to categorize
  step 2 (vagueness check):      passed — description has 50 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   "The description "Something just feels off, can't really describe it" is too vague to categorize into a specific service or subcategory."
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 2501ms (wall 2860ms) · Tokens in/out: 37730/61</sub>

### Test 22

```
{
concern: Car shakes when braking at highway speeds AND the check engine light is on AND it pulls left
LLM decision tree:
  step 1 (match category):       failed — LLM call errored: No object generated: could not parse the response.
  step 2 (vagueness check):      passed — description has 92 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   skipped — no LLM output
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 5277ms (wall 5744ms) · Tokens in/out: 0/0 · err: No object generated: could not parse the response.</sub>

### Test 23

```
{
concern: It's making a weird noise
LLM decision tree:
  step 1 (match category):       LLM returned null — declined to categorize
  step 2 (vagueness check):      passed — description has 25 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   "The description 'It's making a weird noise' is too vague to categorize into a specific service or subcategory."
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 1324ms (wall 1845ms) · Tokens in/out: 37726/67</sub>

### Test 24

```
{
concern: I think my transmission is slipping but I'm not really sure
LLM decision tree:
  step 1 (match category):       failed — LLM call errored: No object generated: could not parse the response.
  step 2 (vagueness check):      passed — description has 59 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   skipped — no LLM output
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 5960ms (wall 6426ms) · Tokens in/out: 0/0 · err: No object generated: could not parse the response.</sub>

### Test 25

```
{
concern: The car just isn't right anymore
LLM decision tree:
  step 1 (match category):       LLM returned null — declined to categorize
  step 2 (vagueness check):      passed — description has 32 chars (>=3)
  step 3 (pick subcategory):     skipped — no matched category from step 1
  step 4 (gap-detect questions): skipped — no valid subcategory from step 3
  step 5 (generate reasoning):   "The description 'The car just isn't right anymore' is too vague and short to match any specific category or subcategory."
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>Latency: 1686ms (wall 2033ms) · Tokens in/out: 37727/69</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 13 |
| matched an 'other' subcategory (forward-to-advisor) | 2 |
| null match (forwarded to advisor) | 10 |
| hallucinated category (step 1) | 0 |
| hallucinated subcategory (step 3) | 0 |
| silently filtered question IDs (step 4) | 0 |
| LLM call failed (step 1 failed) | 7 |
| short-circuit triggered (step 2) | 0 |
| sum of LLM latencies | 122335 ms |
| sum of tokens (in + out) | 681395 |
