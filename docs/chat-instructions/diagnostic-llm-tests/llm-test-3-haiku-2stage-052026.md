# LLM diagnostic test — batch 3 (Haiku, two-stage, May 2026)

**Ran:** 2026-05-21T01:28:08.711Z
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
concern: My car makes a loud knocking noise when I first start it in the morning but it stops after about a minute
LLM decision tree:
  step 1 (match category, S1):       matched 'no_start_testing'
  step 2 (vagueness check):          passed — description has 105 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'hard_to_start_when_cold'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Loud knocking on cold start suggests a starting/ignition system issue or valve train problem during startup; no-start testing covers diagnostics for starting-related concerns including electrical and fuel system components that could cause abnormal startup behavior." · S2: "Customer reports morning-specific loud knocking noise at startup that resolves after ~1 minute—classic cold-start symptom. While not explicitly about cranking difficulty, this timing and behavior aligns best with cold-start issues in the no-start category."
matched category key: no_start_testing
matched sub category slug: hard_to_start_when_cold
unanswered question ids: [1168, 1169, 1170, 1171, 1172, 1173, 1174]
testing service recommended: no_start_testing — No-start testing ($179.95)
}
```

<sub>S1: 6804ch · 1616ms · 2558/95t · S2: 22361ch · 2573ms · 447/158t · Total: 4190ms wall 4807ms · 3005/253t</sub>

### Test 2

```
{
concern: Brakes squeak really bad when I'm coming to a stop especially at slow speeds
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 76 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "Customer reports brake squeak during low-speed stops, a classic brake noise symptom. Brake inspection will measure pad thickness, inspect rotors and calipers, and identify the cause." · S2 skipped
matched category key: brake_inspection
matched sub category slug: null
unanswered question ids: []
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6804ch · 1289ms · 2553/84t · S2: 25739ch · 2070ms · 0/0t · err: No object generated: response did not match schema. · Total: 3360ms wall 3888ms · 2553/84t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 3

```
{
concern: AC blows hot air on the driver side but cold on the passenger side
LLM decision tree:
  step 1 (match category, S1):       matched 'check_ac'
  step 2 (vagueness check):          passed — description has 66 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'one_zone_works_but_another_doesnt'
  step 4 (gap-detect questions, S2): 4 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Asymmetric A/C performance (hot on one side, cold on the other) typically indicates a blend-door failure or similar HVAC distribution issue; check_ac includes blend-door operation diagnosis." · S2: "Customer reports temperature differential between driver and passenger sides—a clear zone mismatch. This matches the "one zone works but another doesn't" subcategory better than any other."
matched category key: check_ac
matched sub category slug: one_zone_works_but_another_doesnt
unanswered question ids: [975, 976, 977, 978]
testing service recommended: check_ac — A/C performance check ($89.95)
}
```

<sub>S1: 6804ch · 8813ms · 2550/89t · S2: 11694ch · 1666ms · 4184/128t · Total: 10479ms wall 11052ms · 6734/217t</sub>

### Test 4

```
{
concern: When I turn the steering wheel all the way left I hear a clicking noise
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_check'
  step 2 (vagueness check):          passed — description has 71 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'popping_or_clicking_when_turning'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Clicking noise when turning the steering wheel is a classic sign of a worn CV joint, which falls under suspension/steering components inspected during a suspension check." · S2: "Customer hears clicking during sharp steering input (turning wheel all the way), which directly matches the popping/clicking when turning subcategory."
matched category key: suspension_check
matched sub category slug: popping_or_clicking_when_turning
unanswered question ids: [113, 115, 116, 117, 118, 119]
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>S1: 6804ch · 1268ms · 2550/77t · S2: 22382ch · 1637ms · 439/124t · Total: 2905ms wall 3404ms · 2989/201t</sub>

### Test 5

```
{
concern: Battery keeps dying overnight even though it's only 2 years old
LLM decision tree:
  step 1 (match category, S1):       matched 'battery_test'
  step 2 (vagueness check):          passed — description has 63 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'battery_drains_overnight'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports battery dying overnight despite being relatively new, indicating a potential charging or draw issue. Battery test includes full electrical system check (battery health, alternator output, starter draw) to diagnose the root cause." · S2: "Customer reports battery dying overnight despite being only 2 years old — classic overnight drain symptom matching "battery_drains_overnight" subcategory."
matched category key: battery_test
matched sub category slug: battery_drains_overnight
unanswered question ids: [532, 533, 534, 535, 536, 537, 538]
testing service recommended: battery_test — Battery test ($0.00)
}
```

<sub>S1: 6804ch · 1282ms · 2549/88t · S2: 26687ch · 6199ms · 438/126t · Total: 7482ms wall 7912ms · 2987/214t</sub>

### Test 6

```
{
concern: There's a sweet syrupy smell coming from under the hood after driving for a while
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 81 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'sweet_smell_maple_syrup_antifreeze'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Sweet syrupy smell under the hood after driving is a classic sign of coolant leak; this matches the coolant_leak_testing service description and its tagged concerns (leak, smell, performance)." · S2: "Sweet syrupy smell under the hood after driving is characteristic of coolant/antifreeze leak. Subcategory "sweet_smell_maple_syrup_antifreeze" directly matches this symptom."
matched category key: coolant_leak_testing
matched sub category slug: sweet_smell_maple_syrup_antifreeze
unanswered question ids: [225, 226, 227, 228, 229, 230, 231]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 6804ch · 1197ms · 2553/90t · S2: 35883ch · 1693ms · 442/145t · Total: 2890ms wall 3398ms · 2995/235t</sub>

### Test 7

```
{
concern: White smoke coming out the tailpipe when I accelerate hard
LLM decision tree:
  step 1 (match category, S1):       matched 'coolant_leak_testing'
  step 2 (vagueness check):          passed — description has 58 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'white_smoke_from_tailpipe'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "White smoke from the tailpipe during hard acceleration typically indicates coolant entering the combustion chamber (blown head gasket, cracked head, or failed cylinder), which requires coolant system pressurization testing to diagnose." · S2: "Customer reports white smoke from tailpipe during hard acceleration, which matches the "white_smoke_from_tailpipe" subcategory and suggests potential coolant or water burning in the combustion chamber."
matched category key: coolant_leak_testing
matched sub category slug: white_smoke_from_tailpipe
unanswered question ids: [281, 282, 283, 284, 285, 286, 287]
testing service recommended: coolant_leak_testing — Coolant leak / overheating testing ($109.95)
}
```

<sub>S1: 6804ch · 1244ms · 2548/94t · S2: 35883ch · 1869ms · 437/140t · Total: 3113ms wall 3645ms · 2985/234t</sub>

### Test 8

```
{
concern: Brake pedal goes almost to the floor before the brakes engage
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 61 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'pedal_sinks_to_floor'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Soft/low brake pedal that requires excessive travel before engagement is a classic brake system issue — likely low brake fluid, air in the lines, worn pads, or caliper problems. The brake inspection service directly diagnoses these concerns." · S2: "Customer describes brake pedal traveling nearly to the floor before engagement, which is the core symptom of pedal sinking to floor rather than soft/spongy pedal behavior."
matched category key: brake_inspection
matched sub category slug: pedal_sinks_to_floor
unanswered question ids: [642, 643, 644, 645, 646, 647]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6804ch · 1473ms · 2549/94t · S2: 25739ch · 2328ms · 438/131t · Total: 3802ms wall 4300ms · 2987/225t</sub>

### Test 9

```
{
concern: Steering wheel pulls hard to the right whenever I let go on the highway
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_check'
  step 2 (vagueness check):          passed — description has 71 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'pulling_drifting_or_wandering_on_the_road'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Hard pulling to one side when hands are released is a classic alignment and suspension symptom—uneven tire wear, ball joints, or suspension wear cause steering drift. Suspension check covers these components." · S2: "Customer reports steering wheel pulling steadily to the right at highway speed, which directly matches pulling/drifting symptoms. This is a classic suspension alignment or tire issue presentation."
matched category key: suspension_check
matched sub category slug: pulling_drifting_or_wandering_on_the_road
unanswered question ids: [695, 697, 698, 699, 700, 701]
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>S1: 6804ch · 1306ms · 2550/85t · S2: 22382ch · 1713ms · 439/136t · Total: 3020ms wall 3561ms · 2989/221t</sub>

### Test 10

```
{
concern: Tires wearing unevenly on the front passenger side, looks like cupping
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_check'
  step 2 (vagueness check):          passed — description has 70 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'steering_wheel_shakes_at_highway_speed'
  step 4 (gap-detect questions, S2): 5 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Uneven tire wear and cupping on the front passenger side typically indicate suspension issues (struts, bushings, alignment) rather than tire pressure; suspension inspection will identify worn components causing premature wear." · S2: "Uneven/cupped tire wear on front passenger side is a classic symptom of tire imbalance or suspension wear that causes steering wheel vibration at highway speeds."
matched category key: suspension_check
matched sub category slug: steering_wheel_shakes_at_highway_speed
unanswered question ids: [688, 689, 690, 691, 693]
testing service recommended: suspension_check — Suspension check ($89.95)
}
```

<sub>S1: 6804ch · 1253ms · 2552/87t · S2: 22382ch · 1651ms · 441/129t · Total: 2905ms wall 3520ms · 2993/216t</sub>

### Test 11

```
{
concern: Check engine light came on yesterday but car drives normal
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 58 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Check engine light is a warning light not related to TPMS; the customer needs diagnostic code reading to identify the underlying issue." · S2: "Customer reports check engine light came on yesterday with no drivability issues—classic check engine light scenario requiring diagnosis of flashing vs. steady state and engine performance clues."
matched category key: warning_light_general
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6804ch · 1187ms · 2545/74t · S2: 26643ch · 3781ms · 434/128t · Total: 4969ms wall 5453ms · 2979/202t</sub>

### Test 12

```
{
concern: ABS light just turned on a few minutes ago and stayed on
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 56 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'abs_anti_lock_brake_light'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "ABS warning light is a dashboard warning that requires diagnostic scanning to identify the underlying cause; this fits the general warning light testing service." · S2: "Customer reports ABS light turning on suddenly and staying on, which is a clear match for the ABS subcategory. No mention of regular brake issues, other warning lights, or recent service history."
matched category key: warning_light_general
matched sub category slug: abs_anti_lock_brake_light
unanswered question ids: [413, 414, 415, 416, 417, 418, 419]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6804ch · 1199ms · 2548/74t · S2: 26643ch · 1693ms · 437/138t · Total: 2892ms wall 3397ms · 2985/212t</sub>

### Test 13

```
{
concern: Airbag light is flashing intermittently
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     failed — stage2 LLM errored: No object generated: response did not match schema.
  step 4 (gap-detect questions, S2): skipped — stage2 didn't complete
  step 5 (generate reasoning):       S1: "Airbag light is a warning light (safety-critical) that requires diagnostic scanning to read codes; matches the general warning light testing service, not a pre-categorized specialty test." · S2 skipped
matched category key: warning_light_general
matched sub category slug: null
unanswered question ids: []
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6804ch · 1530ms · 2546/86t · S2: 26643ch · 2099ms · 0/0t · err: No object generated: response did not match schema. · Total: 3630ms wall 4000ms · 2546/86t · top-err: stage2_failed: No object generated: response did not match schema.</sub>

### Test 14

```
{
concern: Oil pressure light flickers when I come to a stop at idle
LLM decision tree:
  step 1 (match category, S1):       matched 'warning_light_general'
  step 2 (vagueness check):          passed — description has 57 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'oil_pressure_light'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Oil pressure warning light flickering at idle indicates an electrical or engine-system issue that requires diagnostic scanning; this is a warning-light problem best addressed with general warning-light testing and code reading." · S2: "Customer reports oil pressure light that flickers specifically at idle/stopping, which is a classic oil pressure warning symptom. This matches the "oil_pressure_light" subcategory directly."
matched category key: warning_light_general
matched sub category slug: oil_pressure_light
unanswered question ids: [392, 393, 394, 395, 397, 398]
testing service recommended: warning_light_general — Warning light testing (non-TPMS) ($179.99)
}
```

<sub>S1: 6804ch · 1528ms · 2548/87t · S2: 26643ch · 1567ms · 437/129t · Total: 3096ms wall 3503ms · 2985/216t</sub>

### Test 15

```
{
concern: Car has been sitting in my driveway for 8 months, want to make sure it's road ready before driving it
LLM decision tree:
  step 1 (match category, S1):       matched 'car_has_been_sitting_unused_for_a_long_time'
  step 2 (vagueness check):          passed — description has 101 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'car_has_been_sitting_unused_for_a_long_time'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer wants to verify road-readiness after 8 months of inactivity; this is a classic "car has been sitting" scenario requiring a comprehensive safety/readiness check by a service advisor." · S2: "Customer explicitly states the car has been sitting for 8 months and wants to ensure it's road-ready, confirming the "sitting unused" subcategory. Multiple diagnostic details remain unspecified."
matched category key: car_has_been_sitting_unused_for_a_long_time
matched sub category slug: car_has_been_sitting_unused_for_a_long_time
unanswered question ids: [794, 795, 796, 797, 798, 799]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 1206ms · 2561/101t · S2: 4372ch · 2693ms · 2077/144t · Total: 3900ms wall 4419ms · 4638/245t</sub>

### Test 16

```
{
concern: Just got rear-ended last week and now the car pulls left, want to make sure suspension is OK
LLM decision tree:
  step 1 (match category, S1):       matched 'after_a_recent_accident_or_impact'
  step 2 (vagueness check):          passed — description has 92 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_a_recent_accident_or_impact'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Recent rear-end collision with emerging pulling symptom suggests accident-related damage assessment needed before testing individual components; this is a safety/post-accident evaluation scenario." · S2: "Customer mentioned a rear-end collision within the last week and reported steering pulling left. Q765 (timing) is answered—"last week." Q769 (steering feel) is answered—"pulls left." All other accident-context questions remain unanswered."
matched category key: after_a_recent_accident_or_impact
matched sub category slug: after_a_recent_accident_or_impact
unanswered question ids: [765, 766, 767, 768, 770, 771]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 1156ms · 2556/86t · S2: 4493ch · 1828ms · 2085/152t · Total: 2985ms wall 3446ms · 4641/238t</sub>

### Test 17

```
{
concern: Going on a 1500 mile road trip next weekend, want a complete check before I go
LLM decision tree:
  step 1 (match category, S1):       matched 'general_check_up_or_pre_trip_inspection'
  step 2 (vagueness check):          passed — description has 78 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'general_check_up_or_pre_trip_inspection'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer is requesting a comprehensive pre-trip inspection before a 1500-mile road trip — this is a planned preventive check, not a specific symptom, and matches the general check-up / pre-trip inspection category." · S2: "Customer is explicitly preparing for a 1500-mile road trip and requesting a complete check, matching the pre-trip inspection intent of this subcategory."
matched category key: general_check_up_or_pre_trip_inspection
matched sub category slug: general_check_up_or_pre_trip_inspection
unanswered question ids: [787, 788, 789, 790, 791, 792]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 1569ms · 2555/102t · S2: 4335ch · 2046ms · 2083/130t · Total: 3616ms wall 3987ms · 4638/232t</sub>

### Test 18

```
{
concern: Just had new tires installed at Discount Tire yesterday and now I feel a vibration at 65mph
LLM decision tree:
  step 1 (match category, S1):       matched 'after_recent_service_or_repair_work'
  step 2 (vagueness check):          passed — description has 91 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_recent_service_or_repair_work'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Customer reports vibration immediately after tire installation at another shop — this is a post-service concern that requires a service advisor to inspect the work done and diagnose whether it's an alignment, balancing, or installation issue." · S2: "Customer reported vibration immediately after tire installation at an external shop yesterday, which directly matches the "after recent service" category. Most questions remain unanswered."
matched category key: after_recent_service_or_repair_work
matched sub category slug: after_recent_service_or_repair_work
unanswered question ids: [772, 773, 774, 776, 777, 778]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 1681ms · 2558/98t · S2: 4386ch · 1525ms · 2054/129t · Total: 3208ms wall 3608ms · 4612/227t</sub>

### Test 19

```
{
concern: Engine bay smells like burning oil after I drive for like 20 minutes
LLM decision tree:
  step 1 (match category, S1):       matched 'oil_leak_testing'
  step 2 (vagueness check):          passed — description has 68 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'burnt_oil_smell'
  step 4 (gap-detect questions, S2): 7 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Burning oil smell after driving suggests an oil leak—likely pooling on hot engine surfaces. Oil leak testing with pressure/dye detection is the right fit to pinpoint the source." · S2: "Customer reports a burning oil smell in the engine bay after driving for 20 minutes, which directly matches the burnt_oil_smell subcategory. The timing (after extended driving) and location (engine bay) are characteristic of this category."
matched category key: oil_leak_testing
matched sub category slug: burnt_oil_smell
unanswered question ids: [232, 233, 234, 235, 236, 237, 238]
testing service recommended: oil_leak_testing — Oil leak testing ($179.95)
}
```

<sub>S1: 6804ch · 5515ms · 2551/85t · S2: 26265ch · 1697ms · 440/143t · Total: 7213ms wall 7825ms · 2991/228t</sub>

### Test 20

```
{
concern: Squealing high-pitched noise from the front right wheel when I brake but only sometimes
LLM decision tree:
  step 1 (match category, S1):       matched 'brake_inspection'
  step 2 (vagueness check):          passed — description has 87 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'high_pitched_squealing'
  step 4 (gap-detect questions, S2): 6 unanswered IDs (all valid)
  step 5 (generate reasoning):       S1: "Squealing noise during braking is a classic brake-system concern — typically worn brake pads, glazed rotors, or caliper issues. A brake inspection will measure pad thickness, inspect rotors and calipers, and identify the source." · S2: "Customer reports high-pitched squealing noise during braking from a specific location (front right), matching the "high_pitched_squealing" subcategory. Location and brake trigger are answered; remaining symptom details are missing."
matched category key: brake_inspection
matched sub category slug: high_pitched_squealing
unanswered question ids: [623, 624, 839, 626, 627, 628]
testing service recommended: brake_inspection — Brake inspection ($39.99)
}
```

<sub>S1: 6804ch · 1677ms · 2553/97t · S2: 25739ch · 1834ms · 442/138t · Total: 3513ms wall 3900ms · 2995/235t</sub>

### Test 21

```
{
concern: Something just feels off, can't really describe it
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 50 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague and lacks specific symptoms (no mention of noise, warning lights, performance issues, or other concrete details) to match any testing service category." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 1107ms · 2545/76t · S2: skipped (no stage1 match) · Total: 1107ms wall 1667ms · 2545/76t</sub>

### Test 22

```
{
concern: Car shakes when braking at highway speeds AND the check engine light is on AND it pulls left
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

<sub>S1: 6804ch · 1700ms · 0/0t · err: No object generated: response did not match schema. · S2: skipped (no stage1 match) · Total: 1700ms wall 2225ms · 0/0t · top-err: stage1_failed: No object generated: response did not match schema.</sub>

### Test 23

```
{
concern: It's making a weird noise
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 25 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague — "weird noise" lacks detail about type, location, or conditions. A service advisor should gather more information before routing to a specific test." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 1205ms · 2541/77t · S2: skipped (no stage1 match) · Total: 1205ms wall 1502ms · 2541/77t</sub>

### Test 24

```
{
concern: I think my transmission is slipping but I'm not really sure
LLM decision tree:
  step 1 (match category, S1):       matched 'transmission_testing'
  step 2 (vagueness check):          passed — description has 59 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (gap-detect questions, S2): skipped — stage2 didn't produce a valid subcategory
  step 5 (generate reasoning):       S1: "Customer reports suspected transmission slipping, a performance issue that requires road-testing, code scanning, and fluid inspection to diagnose accurately." · S2: "Description is too vague ("I think" and "not really sure") to match any subcategory with confidence; transmission slipping doesn't clearly map to hesitation, rough idle, stalling, hard starts, low power, surging, or misfire patterns."
matched category key: transmission_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: transmission_testing — Transmission issues testing ($179.95)
}
```

<sub>S1: 6804ch · 1213ms · 2548/72t · S2: 12707ch · 6628ms · 4502/124t · Total: 7841ms wall 8282ms · 7050/196t</sub>

### Test 25

```
{
concern: The car just isn't right anymore
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 32 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (gap-detect questions, S2): skipped — stage1 didn't produce a valid category match
  step 5 (generate reasoning):       S1: "Description is too vague to categorize — "isn't right anymore" lacks specific symptoms (noise, warning light, performance issue, leak, etc.) needed to match a testing service or 'other' subcategory." · S2 skipped
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 6804ch · 1495ms · 2542/89t · S2: skipped (no stage1 match) · Total: 1495ms wall 1922ms · 2542/89t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 17 |
| matched an 'other' subcategory (forward-to-advisor) | 4 |
| null match (forwarded to advisor) | 4 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 1 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** silently filtered question IDs | 0 |
| **stage 2** LLM call failed | 2 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 45709 ms |
| sum stage-2 latencies | 50790 ms |
| sum input tokens | 83905 |
| sum output tokens | 4659 |
