# LLM diagnostic test — batch 4 (Sonnet 4.6, two-stage, May 2026)

**Ran:** 2026-05-21T01:37:08.225Z
**Architecture:** two-stage classifier (refactor 2026-05-20)
**Stage 1 model:** `anthropic/claude-sonnet-4-6` (category match — brief catalog)
**Stage 2 model:** `anthropic/claude-sonnet-4-6` (subcategory pick + gap-detect — single-category subtree)
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
concern: My car makes a loud knocking noise when I first start it in the morning but it stops after about a minute
LLM decision tree:
  step 1 (match category, S1):       failed — stage1 LLM errored: No object generated: response did not match schema.
  step 2 (vagueness check):          passed — description has 105 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       missing — no reasoning returned by either stage
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 5115ms · 0/0t · err: No object generated: response did not match schema. · S2: skipped (no stage1 match) · Total: 5115ms wall 5857ms · 0/0t · top-err: stage1_failed: No object generated: response did not match schema.</sub>

### Test 2

```
{
concern: Brakes squeak really bad when I'm coming to a stop especially at slow speeds
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 76 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'high_pitched_squealing'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer describes squeaking brakes when stopping at slow speeds, which is a classic brake wear/noise symptom that maps directly to the brake inspection service (tagged: brakes, noise)." · S2: "The customer describes a high-pitched squeak occurring when coming to a stop at slow speeds, which maps directly to "high_pitched_squealing"; they only mention low/slow speeds and braking context but don't meaningfully answer any of the seven subcategory questions."
matched category key: brake_inspection
matched sub category slug: high_pitched_squealing
unanswered question ids: [623, 624, 839, 626, 627, 628, 629]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6804ch · 2351ms · 442/84t · S2: 25739ch · 3917ms · 442/151t · Total: 6269ms wall 6643ms · 884/235t</sub>

### Test 3

```
{
concern: AC blows hot air on the driver side but cold on the passenger side
LLM decision tree:
  step 1 (match category, S1):       matched 'check_ac'
  step 2 (vagueness check):          passed — description has 66 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "The customer describes uneven A/C output (hot driver side, cold passenger side), which points to a blend-door or zone-control issue — directly covered by the A/C performance check's blend-door operation inspection." · S2 skipped
matched category key: check_ac
matched sub category slug: null
unanswered question ids: []
testing service recommended: check_ac — A/C performance check ($89.95)
}
```

<sub>S1: 6804ch · 2509ms · 439/92t · S2: 11694ch · 3579ms · 0/0t · err: No object generated: response did not match schema. · Total: 6088ms wall 6571ms · 439/92t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 4

```
{
concern: When I turn the steering wheel all the way left I hear a clicking noise
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_check'
  step 2 (vagueness check):          passed — description has 71 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'popping_or_clicking_when_turning'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Clicking noise when turning the steering wheel to full lock is a classic symptom of a worn CV joint or other suspension/steering component, which falls under the suspension check service tags (noise, steering)." · S2: "The customer describes a clicking noise when turning the steering wheel fully to one direction, which matches "popping or clicking when turning"; question 114 is answered (louder turning left) but all other questions remain unanswered."
matched category key: suspension_check
matched sub category slug: popping_or_clicking_when_turning
unanswered question ids: [113, 115, 116, 117, 118, 119]
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>S1: 6804ch · 2490ms · 439/87t · S2: 22382ch · 3344ms · 439/143t · Total: 5834ms wall 6237ms · 878/230t</sub>

### Test 5

```
{
concern: Battery keeps dying overnight even though it's only 2 years old
LLM decision tree:
  step 1 (match category, S1):       matched 'battery_test'
  step 2 (vagueness check):          passed — description has 63 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'battery_drains_overnight'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer describes a battery that keeps dying overnight, which is a classic electrical/battery concern — the free battery test covers battery health, alternator output, and starter draw, directly matching this symptom." · S2: "The customer explicitly describes a battery draining overnight with a 2-year-old battery, matching "battery_drains_overnight"; question 537 is answered (battery is less than 2 years old / original context implied), but all other questions in that subcategory remain unanswered."
matched category key: battery_test
matched sub category slug: battery_drains_overnight
unanswered question ids: [532, 533, 534, 535, 536, 538]
testing service recommended: battery_test — Battery test ($0.00)
}
```

<sub>S1: 6804ch · 2326ms · 438/85t · S2: 26687ch · 3619ms · 438/155t · Total: 5945ms wall 6473ms · 876/240t</sub>

### Test 6

```
{
concern: There's a sweet syrupy smell coming from under the hood after driving for a while
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 81 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'sweet_smell_maple_syrup_antifreeze'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "A sweet/syrupy smell from under the hood is a classic sign of a coolant leak, mapping directly to the coolant leak/overheating testing service's smell concern tag." · S2: "The customer describes a sweet/syrupy smell from under the hood after driving, which matches the antifreeze/sweet smell subcategory; the smell location (under the hood) answers Q226, but all other questions remain unanswered."
matched category key: coolant_leak_testing
matched sub category slug: sweet_smell_maple_syrup_antifreeze
unanswered question ids: [225, 227, 228, 229, 230, 231]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 6804ch · 2158ms · 442/87t · S2: 35883ch · 3508ms · 442/149t · Total: 5667ms wall 6200ms · 884/236t</sub>

### Test 7

```
{
concern: White smoke coming out the tailpipe when I accelerate hard
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 58 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "White smoke from the tailpipe under hard acceleration is a classic sign of coolant entering the combustion chamber (e.g., blown head gasket), which maps directly to the coolant leak/overheating testing service (smoke tag)." · S2 skipped
matched category key: coolant_leak_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 6804ch · 3085ms · 437/99t · S2: 35883ch · 4181ms · 0/0t · err: No object generated: response did not match schema. · Total: 7267ms wall 7703ms · 437/99t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 8

```
{
concern: Brake pedal goes almost to the floor before the brakes engage
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 61 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "The customer describes a soft/low brake pedal that sinks near the floor before engaging, which is a classic brake system symptom (worn pads, fluid issue, or caliper problem) best diagnosed via a brake inspection." · S2 skipped
matched category key: brake_inspection
matched sub category slug: null
unanswered question ids: []
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6804ch · 3072ms · 438/92t · S2: 25739ch · 3730ms · 0/0t · err: No object generated: response did not match schema. · Total: 6802ms wall 7300ms · 438/92t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 9

```
{
concern: Steering wheel pulls hard to the right whenever I let go on the highway
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 71 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "Pulling to one side while driving is a classic symptom tagged under "pulling" in the brake inspection category, which covers caliper drag and related issues, though it can also relate to suspension — brake inspection is the primary match given the "pulling" tag." · S2 skipped
matched category key: brake_inspection
matched sub category slug: null
unanswered question ids: []
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6804ch · 3131ms · 439/98t · S2: 25739ch · 3635ms · 0/0t · err: No object generated: response did not match schema. · Total: 6767ms wall 7294ms · 439/98t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 10

```
{
concern: Tires wearing unevenly on the front passenger side, looks like cupping
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_check'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "Cupping/uneven tire wear on the front passenger side is a classic symptom of worn suspension components (struts, bushings, ball joints), making a suspension check the best fit." · S2 skipped
matched category key: suspension_check
matched sub category slug: null
unanswered question ids: []
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>S1: 6804ch · 2403ms · 441/85t · S2: 22382ch · 3720ms · 0/0t · err: No object generated: response did not match schema. · Total: 6124ms wall 6549ms · 441/85t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 11

```
{
concern: Check engine light came on yesterday but car drives normal
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 58 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "Customer reports a check engine warning light illuminated; the car drives normally, so this is a straightforward warning light diagnostic that fits the non-TPMS warning light testing service." · S2 skipped
matched category key: warning_light_general
matched sub category slug: null
unanswered question ids: []
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6804ch · 3200ms · 434/85t · S2: 26643ch · 4564ms · 0/0t · err: No object generated: response did not match schema. · Total: 7764ms wall 8133ms · 434/85t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 12

```
{
concern: ABS light just turned on a few minutes ago and stayed on
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 56 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'abs_anti_lock_brake_light'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "The customer describes an ABS warning light that has illuminated and stayed on, which maps directly to the warning_light category and the general warning light testing service (non-TPMS)." · S2: "Customer clearly describes an ABS light on steady, which maps directly to the abs_anti_lock_brake_light subcategory; the onset (just now, stayed on) is noted but none of the specific subcategory questions are meaningfully answered."
matched category key: warning_light_general
matched sub category slug: abs_anti_lock_brake_light
unanswered question ids: [413, 414, 415, 416, 417, 418, 419]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6804ch · 2316ms · 437/88t · S2: 26643ch · 3188ms · 437/150t · Total: 5506ms wall 6130ms · 874/238t</sub>

### Test 13

```
{
concern: Airbag light is flashing intermittently
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'airbag_srs_light'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "An intermittently flashing airbag warning light is a non-TPMS warning light concern, which maps to the general warning light testing service that involves scanning for diagnostic codes." · S2: "Customer clearly describes the airbag/SRS light; id=431 is answered (flashes a pattern/intermittently), all other subcategory questions are unanswered."
matched category key: warning_light_general
matched sub category slug: airbag_srs_light
unanswered question ids: [427, 428, 429, 430, 432, 433]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6804ch · 2337ms · 435/86t · S2: 26643ch · 2998ms · 435/133t · Total: 5336ms wall 5986ms · 870/219t</sub>

### Test 14

```
{
concern: Oil pressure light flickers when I come to a stop at idle
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 57 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'oil_pressure_light'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "The customer describes a warning light (oil pressure light flickering at idle), which maps to the warning_light_general testing service — a scanner/diagnostic check to read codes and identify the cause." · S2: "The customer explicitly describes an oil pressure light flickering at idle/stops, matching the oil_pressure_light subcategory; question 396 is answered (flickers on and off / only at idle), while all other questions remain unanswered."
matched category key: warning_light_general
matched sub category slug: oil_pressure_light
unanswered question ids: [392, 393, 394, 395, 397, 398]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6804ch · 2332ms · 437/87t · S2: 26643ch · 2949ms · 437/143t · Total: 5281ms wall 5608ms · 874/230t</sub>

### Test 15

```
{
concern: Car has been sitting in my driveway for 8 months, want to make sure it's road ready before driving it
LLM decision tree:
  step 1 (match category, S1):       matched 'car_has_been_sitting_unused_for_a_long_time'
  step 2 (vagueness check):          passed — description has 101 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'car_has_been_sitting_unused_for_a_long_time'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "The customer explicitly states their car has been sitting unused for 8 months and wants a road-readiness check before driving, which maps directly to the 'car has been sitting unused for a long time' subcategory." · S2: "The customer confirmed ~8 months sitting (answers Q793) and outside in driveway (answers Q794), but hasn't addressed prep steps, start attempts, vehicle type, leaks, or tow-vs-drive-in."
matched category key: car_has_been_sitting_unused_for_a_long_time
matched sub category slug: car_has_been_sitting_unused_for_a_long_time
unanswered question ids: [795, 796, 797, 798, 799]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 2662ms · 450/106t · S2: 4372ch · 3347ms · 450/149t · Total: 6009ms wall 6392ms · 900/255t</sub>

### Test 16

```
{
concern: Just got rear-ended last week and now the car pulls left, want to make sure suspension is OK
LLM decision tree:
  step 1 (match category, S1):       failed — stage1 LLM errored: No object generated: response did not match schema.
  step 2 (vagueness check):          passed — description has 92 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       missing — no reasoning returned by either stage
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 3110ms · 0/0t · err: No object generated: response did not match schema. · S2: skipped (no stage1 match) · Total: 3111ms wall 3520ms · 0/0t · top-err: stage1_failed: No object generated: response did not match schema.</sub>

### Test 17

```
{
concern: Going on a 1500 mile road trip next weekend, want a complete check before I go
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 78 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "The customer explicitly wants a complete check before a road trip, which maps directly to the 'general check-up or pre-trip inspection' other subcategory." · S2: "Customer clearly stated they are preparing for a long road trip (answers Q786), but left all other questions — last maintenance, noticed issues, mileage, service records, focus areas, and ready-by date — unanswered."
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 4276ms · 444/89t · S2: 4335ch · 3749ms · 444/147t · Total: 8025ms wall 8403ms · 888/236t</sub>

### Test 18

```
{
concern: Just had new tires installed at Discount Tire yesterday and now I feel a vibration at 65mph
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 91 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "The customer just had tires installed at another shop and is now experiencing a new vibration — this is a classic "symptom appeared after recent service/repair work" situation, pointing to the 'after_recent_service_or_repair_work' subcategory." · S2: "Customer confirms the work was done at another shop (Discount Tire, not Jeff's) and that the issue appeared right after pickup (yesterday), so Q772 and Q775 are answered; all other questions remain unaddressed."
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [773, 774, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 2573ms · 447/110t · S2: 4386ch · 3023ms · 447/142t · Total: 5596ms wall 5973ms · 894/252t</sub>

### Test 19

```
{
concern: Engine bay smells like burning oil after I drive for like 20 minutes
LLM decision tree:
  step 1 (match category, S1):       matched 'oil_leak_testing'
  step 2 (vagueness check):          passed — description has 68 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'burnt_oil_smell'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "The customer describes a burning oil smell from the engine bay after driving, which is a classic sign of an oil leak dripping onto hot engine components — directly matching the oil leak testing service (tags: leak, smell, smoke)." · S2: "Customer describes a burning oil smell from the engine bay after driving, which matches "burnt_oil_smell"; question 232 is answered (smell occurs after driving for ~20 minutes, i.e. after the engine has been running), but all other questions remain unanswered."
matched category key: oil_leak_testing
matched sub category slug: burnt_oil_smell
unanswered question ids: [233, 234, 235, 236, 237, 238]
testing service recommended: oil_leak_testing — Oil leak testing ($179.95)
}
```

<sub>S1: 6804ch · 2488ms · 440/94t · S2: 26265ch · 3372ms · 440/150t · Total: 5861ms wall 6427ms · 880/244t</sub>

### Test 20

```
{
concern: Squealing high-pitched noise from the front right wheel when I brake but only sometimes
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 87 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'high_pitched_squealing'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "A high-pitched squealing noise from a specific wheel during braking is a classic symptom of worn brake pads or rotor issues, which maps directly to the brake inspection service." · S2: "Customer describes a high-pitched squealing noise from the front right wheel when braking, which matches "high_pitched_squealing"; location (front right) answers question 629, but all other subcategory questions remain unanswered."
matched category key: brake_inspection
matched sub category slug: high_pitched_squealing
unanswered question ids: [623, 624, 839, 626, 627, 628]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6804ch · 2162ms · 442/83t · S2: 25739ch · 3354ms · 442/142t · Total: 5518ms wall 5959ms · 884/225t</sub>

### Test 21

```
{
concern: Something just feels off, can't really describe it
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 50 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "The description is too vague ("something just feels off, can't really describe it") to map to any specific symptom category or 'other' subcategory." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 2154ms · 434/78t · S2: skipped (no stage1 match) · Total: 2154ms wall 2525ms · 434/78t</sub>

### Test 22

```
{
concern: Car shakes when braking at highway speeds AND the check engine light is on AND it pulls left
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 92 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "The customer describes three distinct symptoms simultaneously — shaking under braking, a check engine light, and pulling left — spanning brakes, warning lights, and steering/suspension, so this is a multi-symptom case with no single dominant category." · S2 skipped
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 2678ms · 444/103t · S2: 4473ch · 3595ms · 0/0t · err: No object generated: response did not match schema. · Total: 6274ms wall 6741ms · 444/103t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 23

```
{
concern: It's making a weird noise
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 25 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "The description "making a weird noise" is too vague — without knowing the type of noise, when it occurs, or what system it comes from, it's impossible to map to a specific testing category." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 2297ms · 430/85t · S2: skipped (no stage1 match) · Total: 2297ms wall 2690ms · 430/85t</sub>

### Test 24

```
{
concern: I think my transmission is slipping but I'm not really sure
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'low_power_or_wont_accelerate_normally'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer suspects transmission slipping, which maps directly to the transmission issues testing service (road-test, scan for codes, inspect fluid)." · S2: "The customer suspects transmission slipping, which most closely maps to "low power or won't accelerate normally" (engine revving without corresponding speed pickup, feeling held back or stuck in gear); none of the 7 subcategory questions are answered by the vague description."
matched category key: transmission_testing
matched sub category slug: low_power_or_wont_accelerate_normally
unanswered question ids: [1182, 1183, 1184, 1185, 1186, 1187, 1188]
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6804ch · 2080ms · 437/73t · S2: 12707ch · 3731ms · 437/165t · Total: 5811ms wall 6234ms · 874/238t</sub>

### Test 25

```
{
concern: The car just isn't right anymore
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 32 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "The description "the car just isn't right anymore" is too vague to map to any specific testing service or 'other' subcategory — no symptoms, systems, or situations are identified." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 2213ms · 431/84t · S2: skipped (no stage1 match) · Total: 2213ms wall 2377ms · 431/84t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 16 |
| matched an 'other' subcategory (forward-to-advisor) | 4 |
| null match (forwarded to advisor) | 5 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 2 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** silently filtered question IDs | 0 |
| **stage 2** LLM call failed | 7 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 67518 ms |
| sum stage-2 latencies | 71103 ms |
| sum input tokens | 15827 |
| sum output tokens | 3979 |
