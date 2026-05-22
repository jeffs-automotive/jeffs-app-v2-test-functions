# LLM diagnostic test — batch 11 (Haiku, Path C, three-stage architecture, May 2026)

**Ran:** 2026-05-22T01:43:58.305Z
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
concern: Headlight on the passenger side goes out randomly while I'm driving
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 67 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 5 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Intermittent headlight failure suggests an electrical wiring, connector, or component issue; while not a warning light, electrical_testing_general best fits the diagnostic approach needed to trace the fault." · S2: "Customer reports a single headlight (passenger side) that is non-functional, matching the 'one specific electrical accessory' pattern; however, the 'randomly' qualifier and intermittent nature suggest possible dim_or_flickering_lights overlap, lowering confidence slightly." · S3: "Customer clearly stated passenger-side headlight goes out randomly while driving. Extracted location_side=right, onset_timing=intermittent (random), lights_state=dim_or_flickering (goes out), and accessory_affected. No other facts literally stated."
extracted_facts:
  location_side: "right"
  onset_timing: "intermittent"
  lights_state: "dim_or_flickering"
  accessory_affected: "passenger side headlight"
  customer_request_type: "diagnose_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 13675ch · 1973ms · 3858/69t · S2: 12673ch · 1920ms · 3698/90t · S3: 19968ch · 3488ms · 25/291t · Total: 7383ms wall 8082ms · 7581/450t</sub>

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
  step 8 (reasoning):                S1: "Dim and flickering interior lights suggest a charging or electrical system issue; charging_starting_testing includes battery and alternator diagnostics that would identify the root cause." · S2: "Customer explicitly reports interior lights that are dim and flickering, matching the positive example 'Dashboard lights flicker and strobe while I'm driving' and the synonym 'dash lights dim, instrument lights flicker'." · S3: "Customer clearly stated interior lights are dim and flickering. Set lights_state to dim_or_flickering. No other facts (speed, timing, location, recent actions) were mentioned, so all other slots remain null."
extracted_facts:
  lights_state: "dim_or_flickering"
matched category key: charging_starting_testing
matched sub category slug: dim_or_flickering_lights
unanswered question ids: [541, 543, 544, 545]
testing service recommended: charging_starting_testing — Charging + starting system testing ($89.95)
}
```

<sub>S1: 13675ch · 1602ms · 3853/62t · S2: 16833ch · 1730ms · 20/77t · S3: 19999ch · 5217ms · 20/271t · Total: 8551ms wall 9077ms · 3893/410t</sub>

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
  step 8 (reasoning):                S1: "Customer reports windshield wipers moving slowly on high setting, which directly indicates wiper transmission or motor malfunction covered by windshield inoperative testing." · S2: "Customer describes slow wiper movement, but the windshield_inop_testing category has no subcategories listed. The symptom doesn't match 'inoperative testing' (wipers function, just slowly). Routing verification needed." · S3: "Customer explicitly stated wipers move slowly even on high setting; this is a clear accessory malfunction. No other symptoms, timing, or context provided."
extracted_facts:
  accessory_affected: "wipers"
  customer_request_type: "diagnose_problem"
matched category key: windshield_inop_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: windshield_inop_testing — Windshield inoperative testing ($179.95)
}
```

<sub>S1: 13675ch · 1870ms · 3855/64t · S2: 2629ch · 2014ms · 1122/76t · S3: 18784ch · 2882ms · 22/255t · Total: 6768ms wall 7301ms · 4999/395t</sub>

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
  step 8 (reasoning):                S1: "Customer reports driver-side power windows stopped working, which directly matches the window_inop_testing service that diagnoses switch, motor, regulator, or wiring faults." · S2: "Stage 1 routed to 'window_inop_testing' but no subcategories are defined in the catalog for this category, making subcategory selection impossible." · S3: "Customer explicitly stated driver-side power windows stopped working. Extracted location_side=left, accessory_affected='driver window', and customer_request_type=fix_a_known_problem (they identified the issue). No other facts were literally stated."
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

<sub>S1: 13675ch · 1574ms · 3852/66t · S2: 2621ch · 1755ms · 1114/62t · S3: 18784ch · 3441ms · 19/281t · Total: 6771ms wall 7265ms · 4985/409t</sub>

### Test 5

```
{
concern: Key fob remote won't unlock the doors anymore
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 45 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Key fob malfunction doesn't fit any testing service in the catalog; this is a remote/lock system issue requiring service advisor evaluation for potential replacement or reprogramming." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1820ms · 3854/58t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1820ms wall 2313ms · 3854/58t</sub>

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
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Backup camera showing static suggests an electrical or wiring fault in the camera system; electrical_testing_general covers wiring, connectors, and diagnostic testing to pinpoint such faults." · S2: "Backup camera is a specific electrical accessory that has stopped working (showing static instead of video), matching the positive example pattern of 'one specific electrical accessory has stopped working while the rest of the car is operating normally.'" · S3: "Customer clearly stated the backup camera is not displaying the video feed (showing static instead). Extracted accessory_affected='backup camera' and customer_request_type='diagnose_problem' as they're reporting a malfunction without stating a known cause."
extracted_facts:
  accessory_affected: "backup camera"
  customer_request_type: "diagnose_problem"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 13675ch · 1691ms · 3853/67t · S2: 12673ch · 1725ms · 3693/78t · S3: 19968ch · 5980ms · 20/276t · Total: 9397ms wall 9749ms · 7566/421t</sub>

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
  step 8 (reasoning):                S1: "Cruise control malfunction doesn't clearly map to any testing service in the catalog; this likely requires a service advisor to assess whether it's electrical, transmission-related, or a specific system issue." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1933ms · 3855/63t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1933ms wall 2408ms · 3855/63t</sub>

### Test 8

```
{
concern: Radio shuts off intermittently
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 30 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'multiple_random_electrical_glitches'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [553, 554, 556, 557, 558, 559]
  step 7 (confidence per stage):     S1: medium · S2: medium · S3: high
  step 8 (reasoning):                S1: "Intermittent radio shutdown suggests an electrical fault (power loss, loose connection, or wiring issue); electrical_testing_general covers wiring, connectors, voltage, and continuity diagnosis." · S2: "Radio shutting off intermittently suggests an electrical gremlin affecting one accessory, but the intermittent/random nature and lack of mention of other symptoms leans toward multiple_random_electrical_glitches rather than a stable dead accessory." · S3: "Customer explicitly stated the radio shuts off intermittently. Extracted accessory_affected='radio' and onset_timing='intermittent'. No other facts were literally stated."
extracted_facts:
  onset_timing: "intermittent"
  accessory_affected: "radio"
matched category key: electrical_testing_general
matched sub category slug: multiple_random_electrical_glitches
unanswered question ids: [553, 554, 556, 557, 558, 559]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 13675ch · 1933ms · 3851/69t · S2: 12673ch · 1809ms · 3691/87t · S3: 20038ch · 3106ms · 18/259t · Total: 6848ms wall 7217ms · 7560/415t</sub>

### Test 9

```
{
concern: Sunroof won't fully close anymore
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 33 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Sunroof malfunction doesn't fit the testing service catalog; it's a mechanical/electrical component issue best handled by a service advisor who can assess the specific cause." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1631ms · 3853/58t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1632ms wall 2011ms · 3853/58t</sub>

### Test 10

```
{
concern: Heated seats stopped working on one side
LLM decision tree:
  step 1 (match category, S1):       matched 'electrical_testing_general'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'accessory_doesnt_work'
  step 4 (extract facts, S3):        extracted 2 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [1632, 1633, 1634, 1635, 1636, 1637]
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "Heated seat malfunction is an electrical component issue; the technician will inspect wiring, connectors, and related electrical circuits to diagnose why one side stopped working." · S2: "Customer describes one specific electrical accessory (heated seat on one side) that has stopped working while the rest of the car operates normally—a direct match to the positive example 'seat heater not working' and the core definition of a single-circuit failure." · S3: "Customer stated heated seats stopped working on one side; set accessory_affected='heated seat' and location_side='right' (passenger side is the default for 'one side' in absence of explicit 'driver side' statement). No other facts literally stated."
extracted_facts:
  location_side: "right"
  accessory_affected: "heated seat"
matched category key: electrical_testing_general
matched sub category slug: accessory_doesnt_work
unanswered question ids: [1632, 1633, 1634, 1635, 1636, 1637]
testing service recommended: electrical_testing_general — Electrical system testing (general) ($179.95)
}
```

<sub>S1: 13675ch · 1713ms · 3852/63t · S2: 12673ch · 2153ms · 3692/85t · S3: 19968ch · 3668ms · 19/276t · Total: 7535ms wall 7991ms · 7563/424t</sub>

### Test 11

```
{
concern: Driver seat won't adjust forward or back
LLM decision tree:
  step 1 (match category, S1):       matched 'window_inop_testing'
  step 2 (vagueness check):          passed — description has 40 chars (>=3)
  step 3 (pick subcategory, S2):     LLM returned null — stage2 declined to pick a subcategory
  step 4 (extract facts, S3):        extracted 4 non-null slots
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     0 unanswered — every question covered (or no questions on matched subcategory)
  step 7 (confidence per stage):     S1: medium · S2: low · S3: high
  step 8 (reasoning):                S1: "Seat adjustment is an electrical/mechanical component issue similar in scope to window or windshield inoperative testing; the diagnostic approach (switch, motor, wiring inspection) parallels the catalog's electrical troubleshooting services." · S2: "Customer describes a seat adjustment issue, but the category 'window_inop_testing' (Window inoperative testing) has no subcategories listed. This symptom does not belong in the window category and requires rerouting to the correct service category." · S3: "Customer explicitly stated the driver seat won't adjust forward/back; this is a clear electrical accessory failure on the left (driver) side. No other symptoms mentioned."
extracted_facts:
  location_side: "left"
  accessory_affected: "driver seat adjustment"
  drivable_state: "drivable_normally"
  customer_request_type: "fix_a_known_problem"
matched category key: window_inop_testing
matched sub category slug: null
unanswered question ids: []
testing service recommended: window_inop_testing — Window inoperative testing ($179.95)
}
```

<sub>S1: 13675ch · 2568ms · 3852/77t · S2: 2621ch · 1810ms · 1114/79t · S3: 18784ch · 3035ms · 19/266t · Total: 7416ms wall 7914ms · 4985/422t</sub>

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
  step 8 (reasoning):                S1: "Mirror defrosters are electrical components; general electrical testing will diagnose wiring, connectors, switches, relays, and related circuits to pinpoint the fault." · S2: "Mirror defrosters are a specific electrical accessory that has stopped working; matches the positive example pattern of 'power mirror not working' and the description of 'one specific electrical accessory has stopped working.'" · S3: "Customer explicitly stated mirror defrosters are not working. Set hvac_mode to defrost (the mode they're used in) and accessory_affected to 'mirror defrosters'. Set customer_request_type to fix_a_known_problem since they identified the issue. All other slots null as no other details were provided."
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

<sub>S1: 13675ch · 1704ms · 3850/57t · S2: 12673ch · 1934ms · 3690/75t · S3: 19968ch · 3352ms · 17/301t · Total: 6991ms wall 7471ms · 7557/433t</sub>

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
  step 8 (reasoning):                S1: "Customer reports low tire pressure on rear driver side after recent fill, indicating a potential slow leak or sensor issue that requires TPMS diagnostic testing to identify the root cause." · S2: "Customer reports a tire losing air between fill-ups (filled last week, now low again), matching the 'slow leak' / 'keeps going low' pattern with no visible damage named." · S3: "Customer explicitly stated low tire pressure on rear driver side (left) and recent tire air fill-up. No visible damage named, so tire_state is low_pressure per subcategory. All other slots null as not mentioned."
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

<sub>S1: 13675ch · 1672ms · 3861/63t · S2: 13580ch · 1832ms · 4110/74t · S3: 19865ch · 3388ms · 28/273t · Total: 6894ms wall 7398ms · 7999/410t</sub>

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
  step 8 (reasoning):                S1: "Customer reports a hard pothole impact followed by abnormal wheel feel, which is a safety concern requiring advisor assessment rather than a single diagnostic test." · S2: "Customer describes hitting a pothole hard with resulting wheel issues, which directly matches the 'after a recent accident or impact' subcategory—pothole impact is a clear physical collision event." · S3: "Customer stated a pothole impact and vague wheel feeling but did not specify which wheel, what 'weird' means (noise/vibration/handling), or severity. Set recent_action and onset_timing only; most other slots remain null pending clarification."
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

<sub>S1: 13675ch · 1626ms · 3856/63t · S2: 2840ch · 1456ms · 1182/75t · S3: 19081ch · 3953ms · 23/290t · Total: 7036ms wall 7656ms · 5061/428t</sub>

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
  step 8 (reasoning):                S1: "Inner tire wear is a classic suspension/alignment symptom; the suspension_steering_check includes inspection for uneven wear and alignment issues." · S2: "Customer explicitly describes inside-edge tire wear, which is a direct positive example match for uneven tire wear patterns caused by alignment or suspension issues." · S3: "Customer explicitly stated front tires wearing on inside edge, which is uneven_wear. No other facts were literally stated in the description."
extracted_facts:
  location_axle: "front"
  tire_state: "uneven_wear"
matched category key: suspension_steering_check
matched sub category slug: uneven_tire_wear_bald_spots
unanswered question ids: [730, 732, 733, 734, 735, 736]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 2518ms · 3853/56t · S2: 44059ch · 1624ms · 20/65t · S3: 19973ch · 3623ms · 20/251t · Total: 7768ms wall 8263ms · 3893/372t</sub>

### Test 16

```
{
concern: Steering wheel shakes at exactly 65 mph
LLM decision tree:
  step 1 (match category, S1):       matched 'suspension_steering_check'
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     matched 'steering_wheel_shake_at_highway_speed'
  step 4 (extract facts, S3):        extracted 3 non-null slots
  step 5 (deterministic mapper):     answered=1 unanswered=6 ambiguous=0 (from mapper)
  step 6 (gap-detect questions):     6 unanswered IDs: [142, 143, 144, 145, 146, 147]
  step 7 (confidence per stage):     S1: medium · S2: high · S3: high
  step 8 (reasoning):                S1: "Steering wheel shake at a specific speed (65 mph) suggests suspension/steering component wear or imbalance; could also be tire-related, but suspension_steering_check includes vibration diagnosis and road testing." · S2: "Customer describes steering wheel shaking at a specific highway speed (65 mph), matching the positive example 'Steering wheel shakes really bad at 65 mph but smooths out if I slow down or speed up' and the core definition of speed-triggered wheel shake." · S3: "Customer explicitly stated steering wheel shakes at exactly 65 mph. Set speed_band=specific_mph, speed_specific_mph=65, and sound_or_smoke_location_zone=behind_dashboard (steering wheel area). All other slots null as customer provided no other details."
extracted_facts:
  speed_band: "specific_mph"
  speed_specific_mph: 65
  sound_or_smoke_location_zone: "behind_dashboard"
matched category key: suspension_steering_check
matched sub category slug: steering_wheel_shake_at_highway_speed
unanswered question ids: [142, 143, 144, 145, 146, 147]
testing service recommended: suspension_steering_check — Suspension + steering check ($89.95)
}
```

<sub>S1: 13675ch · 1718ms · 3855/73t · S2: 44059ch · 1858ms · 22/93t · S3: 20010ch · 3194ms · 22/285t · Total: 6773ms wall 7243ms · 3899/451t</sub>

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
  step 8 (reasoning):                S1: "Customer reports bounciness after tire installation, which could indicate suspension issues, improper tire balance, or alignment problems; suspension_steering_check covers these concerns with inspection and road test." · S2: "Customer reports a new symptom (bounciness/vibration) that appeared immediately after recent tire installation, matching the 'recent tire work then new symptom' positive example 'Got new tires last week and now the car vibrates.'" · S3: "Customer clearly stated new tires were installed and a new symptom (bouncy feel) appeared right after. Onset is during driving; started_when is sudden_onset (post-service). No specific location, speed, or other details provided; bouncy sensation suggests suspension/ride quality but no literal descriptor matched perfectly."
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

<sub>S1: 13675ch · 1795ms · 3858/61t · S2: 44059ch · 1961ms · 25/88t · S3: 20000ch · 4072ms · 25/299t · Total: 7831ms wall 8261ms · 3908/448t</sub>

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
  step 8 (reasoning):                S1: "Tire sidewall bulge is a safety defect requiring immediate tire replacement, not a diagnostic test; customer should see a service advisor or tire shop." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 3122ms · 3857/50t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 3123ms wall 3744ms · 3857/50t</sub>

### Test 19

```
{
concern: Spare tire compartment is full of water
LLM decision tree:
  step 1 (match category, S1):       LLM returned null — stage1 declined to categorize
  step 2 (vagueness check):          passed — description has 39 chars (>=3)
  step 3 (pick subcategory, S2):     skipped — stage1 didn't produce a valid category match
  step 4 (extract facts, S3):        skipped — no S2 match (stage3 didn't run)
  step 5 (deterministic mapper):     skipped — no mapper output (no S2 match or stage3 failed)
  step 6 (gap-detect questions):     skipped — no subcategory matched
  step 7 (confidence per stage):     S1: low · S2 skipped · S3 skipped
  step 8 (reasoning):                S1: "Water in spare tire compartment suggests a leak or drainage issue, but doesn't clearly map to any testing service; this warrants advisor assessment to determine root cause (body leak, drain blockage, etc.)." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1596ms · 3853/65t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1597ms wall 2074ms · 3853/65t</sub>

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
  step 8 (reasoning):                S1: "Customer reports 'wheel bearing growling on left side'—a classic bearing noise symptom that falls under suspension inspection, which includes checking for abnormal noises and component wear." · S2: "Customer describes a growling sound from the wheel area (left side), which matches the positive example 'Drone or growl from underneath, louder when I turn right' and the synonym 'growl, growling' — classic worn wheel bearing presentation." · S3: "Customer explicitly stated 'growling' (humming_or_whirring category) on 'left side' from a wheel bearing. No speed, timing, or other contextual details provided; all other slots null."
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

<sub>S1: 13675ch · 1861ms · 3852/65t · S2: 44059ch · 1960ms · 19/91t · S3: 19762ch · 3862ms · 19/281t · Total: 7683ms wall 8078ms · 3890/437t</sub>

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
  step 8 (reasoning):                S1: "Description is too vague ('something is wrong') to identify a specific system or symptom; customer should speak with an advisor for proper triage." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1570ms · 3853/53t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1571ms wall 2070ms · 3853/53t</sub>

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
  step 8 (reasoning):                S1: "Description 'doesn't drive right' is too vague to pinpoint a specific system; customer would benefit from advisor guidance to clarify the actual symptom." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 2100ms · 3850/56t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 2100ms wall 2465ms · 3850/56t</sub>

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
  step 8 (reasoning):                S1: ""Tune up" is too vague and outdated; it could mean engine performance, spark plugs, filters, or general maintenance—none of which map to a specific testing service in the catalog." · S2 skipped · S3 skipped
extracted_facts: (none — S3 did not run, failed, or extracted zero slots)
matched category key: null
matched sub category slug: null
unanswered question ids: []
testing service recommended: none (forwarded to advisor)
}
```

<sub>S1: 13675ch · 1527ms · 3854/65t · S2: skipped (no stage1 match) · S3: skipped (no stage2 match) · Total: 1528ms wall 2064ms · 3854/65t</sub>

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
  step 8 (reasoning):                S1: "Customer reports check engine light that reset itself but wants to verify if underlying problem persists; check engine light testing will scan for stored/pending codes and monitor live data to confirm system health." · S2: "Customer reports check engine light (CEL) as the primary concern. While the light reset, they're asking about underlying problems, which aligns with CEL's diagnostic purpose—detecting stored trouble codes. However, 'reset itself' is unusual and suggests possible intermittent fault or cleared code, warranting verification." · S3: "Customer explicitly stated the check engine light came on and then reset itself (came_on_then_off). They're asking for diagnosis to determine if an underlying problem still exists. No other symptoms or conditions were described."
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

<sub>S1: 13675ch · 6733ms · 3859/68t · S2: 42816ch · 2302ms · 26/95t · S3: 19941ch · 3294ms · 26/274t · Total: 12330ms wall 12750ms · 3911/437t</sub>

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
  step 7 (confidence per stage):     S1: high · S2: high · S3: medium
  step 8 (reasoning):                S1: "P0420 is a stored check engine trouble code (catalyst system efficiency below threshold); customer needs code scanning and live data review per check_engine_light_testing service." · S2: "Customer pulled a diagnostic trouble code (P0420 — catalytic converter efficiency) using an OBD-II reader, which is a direct positive example match for check_engine_light subcategory." · S3: "Customer stated they have a P0420 code (catalyst system efficiency below threshold), which confirms a check engine light exists. No other symptoms, timing, or drivability details were provided. Set warning_light_named to 'check engine' and customer_request_type to 'diagnose_problem' since they're seeking diagnosis via code reading."
extracted_facts:
  warning_light_named: "check engine"
  customer_request_type: "diagnose_problem"
matched category key: check_engine_light_testing
matched sub category slug: check_engine_light
unanswered question ids: [372, 373, 374, 375, 376, 377, 378]
testing service recommended: check_engine_light_testing — Check Engine Light testing ($179.95)
}
```

<sub>S1: 13675ch · 1742ms · 3855/66t · S2: 42816ch · 1917ms · 22/73t · S3: 19941ch · 4261ms · 22/298t · Total: 7921ms wall 8217ms · 3899/437t</sub>

## Batch summary

| metric | value |
|---|---|
| total concerns | 25 |
| matched a testing service | 16 |
| matched an 'other' subcategory (forward-to-advisor) | 1 |
| null match (forwarded to advisor) | 8 |
| **stage 1** hallucinated category | 0 |
| **stage 1** LLM call failed | 0 |
| **stage 2** hallucinated subcategory | 0 |
| **stage 2** LLM call failed | 0 |
| **stage 3** LLM call failed | 0 |
| short-circuit triggered | 0 |
| sum stage-1 latencies | 51592 ms |
| sum stage-2 latencies | 31760 ms |
| sum stage-3 latencies | 63816 ms |
| sum input tokens | 123978 |
| sum output tokens | 7667 |
| **stage 1** confidence: high / medium / low / missing | 9 / 8 / 8 / 0 |
| **stage 2** confidence: high / medium / low / missing | 11 / 3 / 3 / 8 |
| **stage 3** confidence: high / medium / low / missing | 13 / 3 / 1 / 8 |
| mapper totals: answered / unanswered / ambiguous (sum across all tests) | 17 / 81 / 0 |
| stage 3 avg non-null slots extracted (per successful S3 run) | 2.94 (n=17) |
