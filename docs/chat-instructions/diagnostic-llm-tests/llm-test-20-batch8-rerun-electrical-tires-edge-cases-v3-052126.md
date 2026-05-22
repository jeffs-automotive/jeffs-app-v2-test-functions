# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T02:43:16.879Z
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
concern: Headlight on the passenger side goes out randomly while I'm driving
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 67 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_random_electrical_glitches'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [553, 554, 556, 557, 558, 559]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Intermittent headlight failure suggests an electrical wiring, connector, or component issue rather than a simple bulb replacement; electrical_testing_general covers wiring, connectors, and continuity testing to pinpoint the fault." · S2: "Customer reports a single headlight failing intermittently ('goes out randomly while driving'), which could fit accessory_doesnt_work, but the random/intermittent nature and single-component instability aligns better with multiple_random_electrical_glitches pattern of unpredictable electrical behavior." · S3: "Customer clearly stated passenger-side headlight goes out randomly while driving. Extracted location_side=right, lights_state=dim_or_flickering (intermittent on/off), onset_timing=intermittent, and accessory_affected. No other facts literally stated."
extracted_facts:
  location_side: "right"
  onset_timing: "intermittent"
  lights_state: "dim_or_flickering"
  accessory_affected: "passenger side headlight"
  customer_request_type: "diagnose_problem"
matched category key: electrical_testing_general
matched sub category slug: multiple_random_electrical_glitches
unanswered question ids: [553, 554, 556, 557, 558, 559]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 16280ch · 1571ms · 25/76t · S2: 12673ch · 2177ms · 3698/98t · S3: 20038ch · 3951ms · 25/293t · Total: 7700ms wall 8305ms · 3748/467t</sub>

### Test 2

```
{
concern: All my interior lights are dim and flickering
LLM decision tree:
  step 1 (match category, S1):       matched 'charging_starting_testing'
  step 2 (vagueness check):          passed — description has 45 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'dim_or_flickering_lights'
  step 4 (extract facts, S3):        extracted 1 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [541, 543, 544, 545]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Dim and flickering interior lights suggest a charging or electrical system issue; charging_starting_testing includes battery and alternator diagnostics that would identify low voltage or parasitic draw causing this symptom." · S2: "Customer reports interior lights dim and flickering, matching the positive example 'Dashboard lights flicker and strobe while I'm driving' and the synonym 'dash lights dim, instrument lights flicker'." · S3: "Customer clearly stated interior lights are dim and flickering. Set lights_state to dim_or_flickering. No other facts (speed, timing, location, recent actions) were mentioned, so all other slots are null."
extracted_facts:
  lights_state: "dim_or_flickering"
matched category key: charging_starting_testing
matched sub category slug: dim_or_flickering_lights
unanswered question ids: [541, 543, 544, 545]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 16280ch · 4509ms · 20/69t · S2: 16833ch · 1762ms · 20/74t · S3: 19999ch · 3368ms · 20/271t · Total: 9641ms wall 10109ms · 60/414t</sub>

### Test 3

```
{
concern: Windshield wipers move slowly even on high
LLM decision tree:
  step 1 (match category, S1):       matched 'windshield_inop_testing'
  step 2 (vagueness check):          passed — description has 42 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: high · S2: low · S3: high
  step 8 (reasoning):                S1: "Customer reports windshield wipers moving slowly on high setting, which directly indicates wiper transmission or motor dysfunction—the core scope of windshield_inop_testing." · S2: "Customer describes slow wiper movement, but the windshield_inop_testing category has no subcategories listed. The symptom doesn't match 'inoperative testing' (wipers do move). Routing verification needed." · S3: "Customer explicitly stated wipers move slowly even on high setting. Set accessory_affected='wipers' and customer_request_type='diagnose_problem' (they're reporting a malfunction without naming a cause). All other slots null—no timing, location, or contextual details provided."
extracted_facts:
  accessory_affected: "wipers"
  customer_request_type: "diagnose_problem"
matched category key: windshield_inop_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: windshield_inop_testing — Windshield inoperative testing ($179.95)
}
```

<sub>S1: 16280ch · 1699ms · 22/67t · S2: 2629ch · 1640ms · 1122/74t · S3: 18784ch · 3597ms · 22/285t · Total: 6937ms wall 7372ms · 1166/426t</sub>

### Test 4

```
{
concern: Power windows on the driver side stopped working
LLM decision tree:
  step 1 (match category, S1):       matched 'window_inop_testing'
  step 2 (vagueness check):          passed — description has 48 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: high · S2: low · S3: high
  step 8 (reasoning):                S1: "Customer reports power windows on driver side stopped working, which directly matches window_inop_testing scope (power-window glass motion — window won't go up/down)." · S2: "Stage 1 routed to 'window_inop_testing' but no subcategories are defined in the catalog for this category, making subcategory selection impossible." · S3: "Customer explicitly stated driver-side power windows stopped working. Extracted location_side as 'left' (driver side), accessory_affected as 'driver window', and customer_request_type as 'fix_a_known_problem' (they identified the issue). All other slots null as no other details provided."
extracted_facts:
  location_side: "left"
  accessory_affected: "driver window"
  customer_request_type: "fix_a_known_problem"
matched category key: window_inop_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: window_inop_testing — Window inoperative testing ($179.95)
}
```

<sub>S1: 16280ch · 1473ms · 19/64t · S2: 2621ch · 1411ms · 1114/62t · S3: 18784ch · 3252ms · 19/295t · Total: 6137ms wall 6729ms · 1152/421t</sub>

### Test 5

```
{
concern: Key fob remote won't unlock the doors anymore
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 45 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Key fob failure is an electrical/wiring issue, but it's not a power-window or windshield-specific electrical problem; general electrical testing covers wiring, connectors, and related components for door-lock systems." · S2: "Key fob remote is a single electrical accessory that has stopped working; matches positive example 'Driver door lock won't lock or unlock from the switch, the other three doors are fine' and synonym 'power lock broken'." · S3: "Customer clearly stated one specific electrical accessory (key fob remote) has stopped working (won't unlock doors). No other details provided about timing, weather, or recent actions."
extracted_facts:
  accessory_affected: "key fob remote"
  customer_request_type: "diagnose_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 16280ch · 1728ms · 21/76t · S2: 12673ch · 1908ms · 3694/79t · S3: 19968ch · 2911ms · 21/262t · Total: 6547ms wall 6906ms · 3736/417t</sub>

### Test 6

```
{
concern: Backup camera shows static instead of the picture
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 49 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Backup camera displaying static instead of video feed indicates an electrical/wiring issue with the camera system, requiring diagnostic testing of wiring, connectors, and camera circuitry." · S2: "Backup camera is a specific electrical accessory that has stopped functioning (showing static instead of video), matching the positive example pattern of 'one specific electrical accessory has stopped working while the rest of the car is operating normally.'" · S3: "Customer clearly stated the backup camera is not displaying the video feed (showing static instead). Accessory_affected is 'backup camera' and customer_request_type is 'diagnose_problem' since they haven't identified the cause. All other slots are null as no other symptoms or context were provided."
extracted_facts:
  accessory_affected: "backup camera"
  customer_request_type: "diagnose_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 16280ch · 1763ms · 20/65t · S2: 12673ch · 1795ms · 3693/78t · S3: 19968ch · 3725ms · 20/288t · Total: 7286ms wall 7711ms · 3733/431t</sub>

### Test 7

```
{
concern: Cruise control disengages by itself on long drives
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 50 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Cruise control self-disengagement is not covered by any testing service in the catalog; this electrical/control issue requires advisor handoff for proper diagnosis." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1583ms · 22/55t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1583ms wall 2513ms · 22/55t</sub>

### Test 8

```
{
concern: Radio shuts off intermittently
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 30 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_random_electrical_glitches'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [553, 554, 556, 557, 558, 559]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Intermittent radio shutdown suggests an electrical fault (power loss, loose connection, or wiring issue) rather than a specific system like battery or alternator; electrical_testing_general covers wiring, connectors, and voltage diagnostics." · S2: "Radio shutting off intermittently suggests an electrical gremlin affecting one accessory, but the intermittent/random nature and lack of mention of other symptoms makes this a borderline match between accessory_doesnt_work and multiple_random_electrical_glitches; the latter better captures the unpredictable behavior pattern." · S3: "Customer explicitly stated the radio shuts off intermittently. Extracted accessory_affected='radio', onset_timing='intermittent', and inferred customer_request_type='diagnose_problem' (no known cause stated). All other slots null as not mentioned."
extracted_facts:
  onset_timing: "intermittent"
  accessory_affected: "radio"
  customer_request_type: "diagnose_problem"
matched category key: electrical_testing_general
matched sub category slug: multiple_random_electrical_glitches
unanswered question ids: [553, 554, 556, 557, 558, 559]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 16280ch · 1665ms · 18/78t · S2: 12673ch · 2022ms · 3691/104t · S3: 20038ch · 3545ms · 18/282t · Total: 7232ms wall 7620ms · 3727/464t</sub>

### Test 9

```
{
concern: Sunroof won't fully close anymore
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 33 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Sunroof inoperability is a power accessory electrical issue; while not explicitly listed, it falls under electrical_testing_general rather than window_inop_testing (which covers power windows only) or the other subcategories." · S2: "Sunroof is a named electrical accessory that has stopped working (won't fully close); matches the positive example 'sunroof won't open' and the synonym 'sunroof won't open'." · S3: "Customer clearly stated one electrical accessory (sunroof) is malfunctioning (won't fully close). No other details about timing, location, or recent actions were provided, so all other slots are null."
extracted_facts:
  accessory_affected: "sunroof"
  customer_request_type: "fix_a_known_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 16280ch · 1862ms · 20/78t · S2: 12673ch · 1743ms · 3693/77t · S3: 19968ch · 3274ms · 20/272t · Total: 6880ms wall 7393ms · 3733/427t</sub>

### Test 10

```
{
concern: Heated seats stopped working on one side
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Heated seats are a power accessory controlled by electrical circuits; one-side failure suggests wiring, switch, or heating element fault requiring electrical diagnosis." · S2: "Customer describes one specific electrical accessory (heated seat on one side) that has stopped working while the rest of the car operates normally—a direct match to the positive example 'seat heater not working' and the core definition of a single circuit failure." · S3: "Customer explicitly stated heated seats stopped working on one side. Set accessory_affected='heated seat', location_side='right' (passenger side is the default 'one side' interpretation), and customer_request_type='fix_a_known_problem' (they identified the issue). All other slots null as not stated."
extracted_facts:
  location_side: "right"
  accessory_affected: "heated seat"
  customer_request_type: "fix_a_known_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 16280ch · 1861ms · 19/59t · S2: 12673ch · 1675ms · 3692/84t · S3: 19968ch · 3322ms · 19/295t · Total: 6860ms wall 7383ms · 3730/438t</sub>

### Test 11

```
{
concern: Driver seat won't adjust forward or back
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Power seat adjustment is an electrical accessory issue; while window_inop_testing explicitly excludes power seats, electrical_testing_general covers unspecified electrical components including seat motors and controls." · S2: "Customer describes a single electrical accessory (power seat) that is unresponsive, matching the positive example 'seat heater not working' and the synonym 'power seat not moving' in the accessory_doesnt_work subcategory." · S3: "Customer explicitly stated the driver seat won't adjust forward or back. Driver seat is left-side, and the accessory is clearly named. No other facts were stated."
extracted_facts:
  location_side: "left"
  accessory_affected: "driver seat"
  customer_request_type: "fix_a_known_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 16280ch · 1793ms · 19/68t · S2: 12673ch · 4275ms · 3692/85t · S3: 19968ch · 21520ms · 19/261t · Total: 27590ms wall 28056ms · 3730/414t</sub>

### Test 12

```
{
concern: Mirror defrosters not working
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 29 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Mirror defrosters are a power accessory controlled by electrical switches and wiring; not covered by window_inop_testing (which is power-window glass only) or other specific services, so electrical_testing_general is the best fit for diagnosing the fault." · S2: "Mirror defrosters are a specific electrical accessory that has stopped working; matches the positive example pattern of 'power mirror not working' and the description of 'one specific electrical accessory has stopped working.'" · S3: "Customer explicitly stated mirror defrosters are not working. Set hvac_mode to 'defrost' (the mode they're using), accessory_affected to 'mirror defrosters' (the specific item), and customer_request_type to 'fix_a_known_problem' (they identified the issue). All other slots null as no other details were provided."
extracted_facts:
  hvac_mode: "defrost"
  accessory_affected: "mirror defrosters"
  customer_request_type: "fix_a_known_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 16280ch · 1815ms · 17/85t · S2: 12673ch · 1803ms · 3690/75t · S3: 19968ch · 3337ms · 17/310t · Total: 6956ms wall 7418ms · 3724/470t</sub>

### Test 13

```
{
concern: Tire pressure is low on the rear driver side and I just filled it last week
LLM decision tree:
  step 1 (match category, S1):       matched 'tpms_testing'
  step 2 (vagueness check):          passed — description has 75 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'tire_going_flat_losing_air'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=3 unanswered=4 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     4 unanswered IDs: [717, 718, 719, 722]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports low tire pressure on a specific tire (rear driver side) that was recently filled, indicating a potential slow leak or sensor issue requiring TPMS diagnosis." · S2: "Customer reports a tire losing air between fill-ups (filled last week, now low again), matching the 'slow leak' / 'keeps going low' pattern with no visible damage named." · S3: "Customer explicitly stated rear driver-side tire is low pressure and filled it last week (tire_air_added). No visible damage named, no speed/timing/other symptoms mentioned."
extracted_facts:
  location_side: "left"
  location_axle: "rear"
  recent_action: "tire_air_added"
  tire_state: "low_pressure"
matched category key: tpms_testing
matched sub category slug: tire_going_flat_losing_air
unanswered question ids: [717, 718, 719, 722]
testing service recommended: tpms_testing — Tire pressure (TPMS) light testing ($39.99)
}
```

<sub>S1: 16280ch · 1418ms · 28/62t · S2: 13580ch · 2006ms · 4110/74t · S3: 19865ch · 3279ms · 28/263t · Total: 6706ms wall 7160ms · 4166/399t</sub>

### Test 14

```
{
concern: I hit a pothole hard and now the wheel feels weird
LLM decision tree:
  step 1 (match category, S1):       matched 'after_a_recent_accident_or_impact'
  step 2 (vagueness check):          passed — description has 50 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'after_a_recent_accident_or_impact'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [765, 767, 768, 769, 770, 771]
  step 7 (confidence per stage):     S1: high · S2: high · S3: low
  step 8 (reasoning):                S1: "Customer reports a hard pothole impact followed by abnormal wheel feel, which is a safety concern requiring advisor assessment rather than a single diagnostic test." · S2: "Customer describes hitting a pothole (impact event) followed by wheel handling issues, directly matching the 'after a recent accident or impact' subcategory." · S3: "Customer stated a pothole impact and vague wheel feeling but did not specify which wheel, what 'weird' means (noise/vibration/handling), or which axle. Set recent_action and onset_timing only; most other slots remain null pending clarification."
extracted_facts:
  onset_timing: "over_bumps"
  started_when: "sudden_onset"
  recent_action: "hit_pothole_or_curb"
  customer_request_type: "diagnose_problem"
matched category key: after_a_recent_accident_or_impact
matched sub category slug: after_a_recent_accident_or_impact
unanswered question ids: [765, 767, 768, 769, 770, 771]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1611ms · 23/63t · S2: 2840ch · 1309ms · 1182/68t · S3: 19081ch · 3691ms · 23/292t · Total: 6613ms wall 7139ms · 1228/423t</sub>

### Test 15

```
{
concern: Front tires are wearing on the inside edge
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 42 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'uneven_tire_wear_bald_spots'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [730, 732, 733, 734, 735, 736]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Inside-edge tire wear is a classic suspension/alignment symptom; the suspension_steering_check includes uneven tire wear inspection and alignment-related diagnostics." · S2: "Customer explicitly describes inside-edge tire wear, which is a direct positive example match for uneven tire wear patterns caused by alignment or suspension issues." · S3: "Customer explicitly stated front tires wearing on inside edge, which is uneven_wear. No other facts were literally stated in the description."
extracted_facts:
  location_axle: "front"
  tire_state: "uneven_wear"
matched category key: suspension_steering_check
matched sub category slug: uneven_tire_wear_bald_spots
unanswered question ids: [730, 732, 733, 734, 735, 736]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 16280ch · 1606ms · 20/61t · S2: 44059ch · 1503ms · 20/65t · S3: 19973ch · 2968ms · 20/251t · Total: 6078ms wall 6537ms · 60/377t</sub>

### Test 16

```
{
concern: Steering wheel shakes at exactly 65 mph
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'steering_wheel_shake_at_highway_speed'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [142, 143, 144, 145, 146, 147]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports steering wheel shake at a specific speed (65 mph), which is a classic suspension/steering/tire balance issue; matches suspension_steering_check scope for vibration concerns." · S2: "Customer describes steering wheel shaking at a specific highway speed (65 mph), which directly matches the positive example 'Steering wheel shakes really bad at 65 mph but smooths out if I slow down or speed up' and the core description of wheel shake onset in the 50-70 mph band." · S3: "Customer explicitly stated steering wheel shakes at exactly 65 mph. Set speed_band=specific_mph, speed_specific_mph=65, onset_timing=during_driving (shake occurs while driving), and sound_or_smoke_location_zone=behind_dashboard (steering wheel area). All other slots null as not stated."
extracted_facts:
  speed_band: "specific_mph"
  speed_specific_mph: 65
  onset_timing: "during_driving"
  sound_or_smoke_location_zone: "behind_dashboard"
matched category key: suspension_steering_check
matched sub category slug: steering_wheel_shake_at_highway_speed
unanswered question ids: [142, 143, 144, 145, 146, 147]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 16280ch · 1796ms · 22/66t · S2: 44059ch · 1772ms · 22/102t · S3: 20010ch · 3341ms · 22/297t · Total: 6911ms wall 7365ms · 66/465t</sub>

### Test 17

```
{
concern: My car feels really bouncy after I had new tires put on
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 55 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'recent_tire_work_then_new_symptom'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [752, 753, 754, 755, 756, 757]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: medium
  step 8 (reasoning):                S1: "Customer reports bounciness after tire replacement, which suggests suspension or steering concern; new tires can expose underlying suspension wear, making this a suspension_steering_check candidate rather than a tire-specific issue." · S2: "Customer reports a new symptom (bouncy ride) that appeared right after recent tire installation, matching the 'recent tire work then new symptom' positive example 'Got new tires last week and now the car vibrates at highway speed.'" · S3: "Customer clearly stated new tires were installed and a new symptom (bouncy feel) appeared right after. Onset is during driving; started_when is sudden_onset (post-service). No location, speed, or other specifics were stated, so those remain null. Judgment: 'bouncy' suggests suspension/ride quality but doesn't map to a specific noise or pedal descriptor."
extracted_facts:
  onset_timing: "during_driving"
  started_when: "sudden_onset"
  recent_action: "tire_rotation_or_replacement"
  customer_request_type: "diagnose_problem"
matched category key: suspension_steering_check
matched sub category slug: recent_tire_work_then_new_symptom
unanswered question ids: [752, 753, 754, 755, 756, 757]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 16280ch · 1691ms · 25/65t · S2: 44059ch · 1993ms · 25/88t · S3: 20000ch · 4065ms · 25/316t · Total: 7751ms wall 8209ms · 75/469t</sub>

### Test 18

```
{
concern: One of my tires has a bulge in the sidewall
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 43 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "A tire sidewall bulge is a safety issue requiring immediate tire replacement/inspection, not a diagnostic test; this should route to a service advisor for safety assessment and tire service recommendation." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1586ms · 24/60t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1587ms wall 2142ms · 24/60t</sub>

### Test 19

```
{
concern: Spare tire compartment is full of water
LLM decision tree:
  step 1 (match category, S1):       matched 'multiple_symptoms_not_sure_what_category'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_symptoms_not_sure_what_category'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [758, 759, 760, 761, 762, 763, 764]
  step 7 (confidence per stage):     S1: medium · S2: low · S3: high
  step 8 (reasoning):                S1: "Water in spare tire compartment suggests a leak (coolant, AC, or general water intrusion) but the root cause is unclear without more symptoms; routing to advisor for proper diagnosis." · S2: "Water in spare tire compartment suggests a leak/drainage issue, but this subcategory is the only available option in the 'multiple_symptoms' category; downstream advisor should verify if this maps to a leak/water intrusion category instead." · S3: "Customer literally stated water in the spare tire compartment (rear location). Fluid is clear/colorless (water). No other symptoms or context provided; all other slots null."
extracted_facts:
  location_axle: "rear"
  fluid_color: "clear_no_color"
  fluid_under_car_location: "under_rear"
  customer_request_type: "diagnose_problem"
matched category key: multiple_symptoms_not_sure_what_category
matched sub category slug: multiple_symptoms_not_sure_what_category
unanswered question ids: [758, 759, 760, 761, 762, 763, 764]
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1557ms · 20/72t · S2: 2872ch · 3929ms · 1181/86t · S3: 19113ch · 3730ms · 20/265t · Total: 9217ms wall 9713ms · 1221/423t</sub>

### Test 20

```
{
concern: Wheel bearing growling on left side
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 35 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'humming_or_whirring_at_speed'
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [85, 86, 87, 88, 89, 90, 91]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "Customer reports 'wheel bearing growling on left side'—a classic suspension noise symptom that maps directly to suspension_steering_check, which includes inspection of suspension components and bearing-related noises." · S2: "Customer describes a growling sound from the wheel area (left side), which matches the positive example 'Drone or growl from underneath, louder when I turn right' and the synonym 'growl, growling' in the humming_or_whirring_at_speed subcategory description." · S3: "Customer explicitly stated 'growling' (humming_or_whirring category) on 'left side' from a wheel bearing. No speed, timing, or other contextual details provided; all other slots null."
extracted_facts:
  location_side: "left"
  noise_descriptor: "humming_or_whirring"
  sound_or_smoke_location_zone: "from_a_wheel"
  customer_request_type: "diagnose_problem"
matched category key: suspension_steering_check
matched sub category slug: humming_or_whirring_at_speed
unanswered question ids: [85, 86, 87, 88, 89, 90, 91]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 16280ch · 1598ms · 19/70t · S2: 44059ch · 2790ms · 19/103t · S3: 19762ch · 3304ms · 19/281t · Total: 7695ms wall 8203ms · 57/454t</sub>

### Test 21

```
{
concern: Hmm something is wrong with my car
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 34 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description is too vague ('something is wrong') to identify a specific system or symptom; customer should speak with an advisor to clarify the actual concern." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1729ms · 20/55t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1729ms wall 2058ms · 20/55t</sub>

### Test 22

```
{
concern: It just doesnt drive right
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 26 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Description 'doesn't drive right' is too vague to pinpoint a specific system—could indicate suspension, brakes, transmission, steering, or multiple issues; needs advisor clarification." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 1500ms · 17/62t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1500ms wall 1887ms · 17/62t</sub>

### Test 23

```
{
concern: My mechanic neighbor said I need a tune up
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 42 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: ""Tune up" is vague and outdated; it doesn't map to a specific testing service. A service advisor should clarify what symptoms or maintenance the customer is experiencing." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 16280ch · 3980ms · 21/60t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 3981ms wall 4358ms · 21/60t</sub>

### Test 24

```
{
concern: Engine light reset itself but I want to know if there's still a problem
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 71 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=2 unanswered=5 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     5 unanswered IDs: [373, 374, 375, 376, 378]
  step 7 (confidence per stage):     S1: high · S2: medium · S3: high
  step 8 (reasoning):                S1: "Customer reports check engine light that reset itself but wants to verify if underlying problem persists; check_engine_light_testing scans for stored/pending codes and monitors live data to confirm system status." · S2: "Customer reports check engine light (CEL) as the primary concern. While the light reset, they're asking about underlying diagnostics—a common follow-up to CEL events. Matches 'check engine light' subcategory description of OBD-II detection and DTC storage, though the self-reset is atypical and warrants advisor verification." · S3: "Customer explicitly stated the check engine light came on and then reset itself (came_on_then_off). They're asking for diagnosis to determine if an underlying problem still exists. No other symptoms or conditions were described."
extracted_facts:
  warning_light_named: "check engine"
  warning_light_behavior: "came_on_then_off"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [373, 374, 375, 376, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 1653ms · 26/71t · S2: 42816ch · 2289ms · 26/106t · S3: 19941ch · 3486ms · 26/274t · Total: 7429ms wall 7958ms · 78/451t</sub>

### Test 25

```
{
concern: Got a P0420 code from autozone reader
LLM decision tree:
  step 1 (match category, S1):       matched 'check_engine_light_testing'
  step 2 (vagueness check):          passed — description has 37 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'check_engine_light'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=0 unanswered=7 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     7 unanswered IDs: [372, 373, 374, 375, 376, 377, 378]
  step 7 (confidence per stage):     S1: high · S2: high · S3: high
  step 8 (reasoning):                S1: "P0420 is a catalytic converter efficiency code that triggers the check engine light; customer has the code and needs diagnostic scanning to verify sensor readings and review TSBs per the check_engine_light_testing service scope." · S2: "Customer pulled a diagnostic trouble code (P0420 — catalytic converter efficiency) using an OBD-II reader, which is a direct positive example match for check_engine_light subcategory." · S3: "Customer stated they have a P0420 code (catalyst system efficiency fault), which triggers the check engine light. No other symptoms, timing, or vehicle behavior described; only the diagnostic code is present."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 16280ch · 2267ms · 22/77t · S2: 42816ch · 1597ms · 22/73t · S3: 19941ch · 3289ms · 22/265t · Total: 7155ms wall 7550ms · 66/415t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 18 |
| matched an 'other' subcategory (forward-to-advisor) | 2 |
| null match (forwarded to advisor) | 5 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 47314 ms |
| sum stage-2 latencies | 41399 ms |
| sum stage-3 latencies | 86955 ms |
| sum input tokens | 39360 |
| sum output tokens | 8957 |
| **stage 1** confidence: high / medium / low / missing | 11 / 9 / 5 / 0 |
| **stage 2** confidence: high / medium / low / missing | 14 / 3 / 3 / 5 |
| **stage 3** confidence: high / medium / low / missing | 18 / 1 / 1 / 5 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 20 / 106 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 3.00 (n=20) |
