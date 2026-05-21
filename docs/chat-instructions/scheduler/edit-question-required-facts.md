# Edit question required_facts — Claude Desktop guide

> **What this controls:** the `required_facts` column on `concern_questions` —
> the list of ExtractedFacts slot names that must be present in the Stage 1
> LLM's extracted facts for a question to count as "answered" by the
> Stage 3 question-gate. Better fact-gating → fewer redundant questions
> asked of the customer.
>
> **Source-of-truth file:** [`./templates/question-required-facts.md`](./templates/question-required-facts.md)
> **Tools:** `upload_question_required_facts_md` (bulk), `export_question_required_facts_md`, `revert_md_upload`

## When the advisor says "upload question required facts" — exact recipe

Follow these 4 steps. Don't skip, don't reorder, don't add Claude Desktop
project-knowledge attachment. The orchestrator tool IS the upload — your
job is to wire the file content into the tool argument.

```
Step 1: read_file({ path: "<templates folder>\question-required-facts.md" })
        → returns the full MD content (a ~17KB string — fine to pass)

Step 2: upload_question_required_facts_md({
          md_content: <content from step 1>,
          dry_run: true                  // DEFAULT — explicit for clarity
        })
        → returns { diff_summary, validation_errors, validation_warnings, confirm_token }

Step 3: Render the diff to the advisor in plain language. Wait for explicit "yes".
        Do NOT call step 4 without that confirmation.

Step 4: upload_question_required_facts_md({
          md_content: <SAME content from step 1, byte-for-byte>,
          dry_run: false,
          expected_confirm_token: <token from step 2>
        })
        → returns { audit_log_id, applied_changes }
        Save the audit_log_id — needed if revert is requested.
```

**The templates folder path is in `scheduler.md` (Filesystem MCP section).**
You append `question-required-facts.md` to that folder path.

**Common Haiku mistakes to avoid:**

- ❌ Treating "upload" as "attach the file to Claude Desktop's project
  knowledge". It's NOT — you call the orchestrator tool. Project files
  are routing/instructions; the database holds the data.
- ❌ Refusing because of a perceived file size limit. This file is only
  ~17KB. Even the 218KB subcategory-descriptions file is fine. Pass the
  content; the tool will tell you if it really hits a limit.
- ❌ Asking the user to paste the file content. You have Filesystem MCP —
  read it yourself.
- ❌ Skipping the dry_run step and going straight to apply. The
  `expected_confirm_token` is REQUIRED on the apply call; you only get
  it from a dry_run.

## Tools you have for this task — they WORK, use them

You DO have BOTH of these. If you find yourself thinking "I can't read that
file" or "I can't call that tool" — STOP. You DO. Use them. Relay any
error verbatim. Never refuse a task because you "don't have access".

- **Filesystem MCP** — `read_file(path)`. Read `question-required-facts.md`
  from the templates folder. The folder path is in `scheduler.md` (Filesystem
  MCP section). **Don't ask the user to paste the file** — read it yourself.
  Only ask for a paste if the filesystem MCP returns an explicit error.

- **Orchestrator MCP** — exposes ~50 specific typed tools. For THIS task,
  the relevant tools are:
  - `upload_question_required_facts_md` — bulk upload via MD content + dry_run + expected_confirm_token
  - `export_question_required_facts_md` — round-trip export current required_facts as MD
  - `revert_md_upload` — undo a recent bulk upload by audit_log_id

  Call each tool DIRECTLY by name with its typed arguments. DON'T try to
  call `run_orchestrator` — REMOVED 2026-05-20.

Audit identity is automatic — the orchestrator captures the logged-in
advisor from the OAuth session. Don't ask "who are you?".

## MD format — wide table

A single markdown table with two columns. Order of rows doesn't matter.
Blank rows and `<!-- ... -->` comments are ignored. The H1 is informational.

```markdown
| question_id | required_facts |
| --- | --- |
| 688 | speed_specific_mph |
| 691 | location_side |
| 967 | hvac_mode |
| 727 | recent_action, warning_light_behavior |
| 716 | location_side, location_axle |
| 999 |  |     ← blank cell CLEARS required_facts (falls back to free-text)
```

### Field reference

| Field | Required | Type | Notes |
|---|---|---|---|
| `question_id` | yes | positive integer | The primary key on `concern_questions`. Cross-checked at upload time |
| `required_facts` | yes (cell may be blank) | comma-list of slot names OR `(none)` OR blank | Each slot must be in the 29 canonical ExtractedFacts keys. Blank / `(none)` / `-` CLEARS the list (question falls back to free-text answer-marker) |

## The 29 ExtractedFacts slots

These are the only valid values for `required_facts`. Pulled from
`scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts` —
parallel-mirrored in the uploader. When the schema changes, the
uploader's allow-list changes in the same commit (when the schema
changes, this list needs updating too).

| Slot | Typical question shape |
|---|---|
| `location_side` | "Which side is it on?" (left / right / both / varies / unsure) |
| `location_axle` | "Front or rear?" (front / rear / all / unsure) |
| `speed_band` | "At what speed?" (stopped / idle / low / mid / highway / specific_mph / all) |
| `speed_specific_mph` | "Exactly how many mph?" (integer) |
| `onset_timing` | "When does it happen?" (cold_start / when_braking / over_bumps / ...) |
| `started_when` | "When did it start?" (today / days_ago / months_ago / sudden_onset / ...) |
| `hvac_mode` | "AC or heat?" (ac / heat / defrost / fan_only / both / none) |
| `airflow_state` | "How's the airflow?" (strong / weak / one_zone / no_airflow / ...) |
| `pedal_feel` | "How does the brake pedal feel?" (soft / hard / sinks_to_floor / pulsating / ...) |
| `smell_descriptor` | "What does it smell like?" (sweet / burnt_oil / musty / ...) |
| `noise_descriptor` | "What kind of noise?" (squealing / grinding / clunking / ...) |
| `smoke_color` | "What color is the smoke?" (white / blue / black / steam / ...) |
| `fluid_color` | "What color is the fluid?" (green / red / brown / clear / ...) |
| `fluid_under_car_location` | "Where under the car?" (engine_front / middle / rear / under_wheel / ...) |
| `warning_light_named` | "Which light?" (free text — check_engine, TPMS, ABS, ...) |
| `warning_light_behavior` | "Steady or flashing?" (steady_on / flashing / comes_and_goes / ...) |
| `engine_running` | "How's it running?" (normal / rough_idle / stalls / wont_start / ...) |
| `recent_action` | "Anything recent?" (brake_work / oil_change / hit_curb / car_sat / ...) |
| `parking_brake_state` | "Parking brake on?" (released / engaged / customer_unsure) |
| `tire_state` | "Tire condition?" (low_pressure / flat / damage / sidewall_crack / ...) |
| `steering_feel` | "How's the steering?" (heavy / loose / off_center / ...) |
| `pull_direction` | "Pulls which way?" (left / right / varies / no_pull) |
| `lights_state` | "Lights dim?" (dim / dim_at_idle / normal / dead) |
| `accessory_affected` | "Which accessory?" (free text — window, radio, ...) |
| `weather_condition` | "What weather?" (cold / hot / rain / humid / any) |
| `sound_or_smoke_location_zone` | "Where is it coming from?" (under_hood / under_car / from_a_wheel / ...) |
| `vehicle_powertrain` | "Diesel or gas?" (gasoline / diesel / hybrid / electric / turbo) |
| `drivable_state` | "Can you drive it?" (normally / concerned / needs_tow / stranded) |
| `customer_request_type` | "What do you want done?" (diagnose / fix / replace / routine / ...) |

## Diff semantics — partial uploads are SAFE

- **Rows OMITTED from the MD are LEFT ALONE.** Uploads never silently
  clear required_facts you didn't touch.
- **Rows mentioned with a NON-EMPTY cell** REPLACE the existing array
  (in MD order, de-duped).
- **Rows mentioned with a BLANK / `(none)` cell** CLEAR the existing
  required_facts (sets to `'{}'`; question falls back to free-text
  answer-marker only).

This means you can upload a 1-row MD to tag just one question — the
other ~729 in the DB stay as-is.

## Two-step flow — always preview before applying

The `upload_question_required_facts_md` tool DEFAULTS to `dry_run: true`. You will:

1. **Dry-run** the upload. The tool returns:
   - `diff_summary` — per-row deltas (`before: [...]`, `after: [...]`)
   - `validation_errors` — blocking issues (non-integer question_id,
     unknown question_id, unknown slot names, duplicate row)
   - `validation_warnings` — soft concerns (question currently inactive)
   - `confirm_token` — pass back on the apply call

2. **Show the advisor the report.** Be specific:
   > "Dry-run for question-required-facts upload:
   > - **5 modified:**
   >   - `688`: `[]` → `[speed_specific_mph]`
   >   - `691`: `[]` → `[location_side]`
   >   - `967`: `[]` → `[hvac_mode]`
   >   - `727`: `[]` → `[recent_action, warning_light_behavior]`
   >   - `716`: `[]` → `[location_side, location_axle]`
   > - **0 cleared, 0 unchanged**
   > - **Validation:** clean.
   >
   > Apply?"

3. **Wait for explicit "yes"** before re-calling with `dry_run: false` +
   `expected_confirm_token: <token>`.

4. **On apply success**, surface the `audit_log_id` — needed for revert.

### What blocks vs warns

**BLOCKS apply (errors — must be fixed in the MD before re-running):**
- `question_id` not a positive integer (negative, zero, non-numeric)
- `question_id` not present in `concern_questions` for this shop
- Any `required_facts` slot name not in the 29 canonical
  ExtractedFacts keys
- Duplicate `question_id` in the same upload

**WARNS (surface for confirmation; doesn't block):**
- Question exists but is currently `Active: false` (required_facts
  stored but won't take effect until question is reactivated)

## Workflow examples

### Example 1 — tag a single speed-related question

> Advisor: "Question 688 asks 'At what speed does it shake?' — tag it
> with speed_specific_mph so Stage 3 stops asking the customer when
> they've already said '65 mph' upfront."

1. Don't re-upload all 729 questions. Just send the one row:
   ```markdown
   | question_id | required_facts |
   | --- | --- |
   | 688 | speed_specific_mph |
   ```
2. Dry-run → show diff → apply on approval.

### Example 2 — tag a multi-slot question

> Advisor: "Question 727 asks 'When did the warning light come on, and
> is it steady or flashing?' — needs both warning_light_named AND
> warning_light_behavior."

```markdown
| question_id | required_facts |
| --- | --- |
| 727 | warning_light_named, warning_light_behavior |
```

When BOTH slots are non-null in Stage 1's extracted facts, the question
counts as answered. If only one is present, the question still gets
asked.

### Example 3 — clear required_facts (revert to free-text)

> Advisor: "Question 1234 is getting incorrectly skipped — drop its
> required_facts so it always gets asked."

```markdown
| question_id | required_facts |
| --- | --- |
| 1234 |  |
```

The blank cell clears the mapping; the question falls back to the
free-text answer-marker (Stage 3 only counts it answered if the LLM
explicitly flagged it from the customer's text).

### Example 4 — bad upload caught by validation

Advisor uploads a row with `required_facts: speed_mph` (not a real slot).

→ Dry-run returns:
```
validation_errors: [
  { field: 'qid_688.required_facts',
    message: 'unknown ExtractedFacts slot(s): speed_mph — must be one of: location_side, location_axle, speed_band, speed_specific_mph, ...' }
]
```

→ "Validation failed — `speed_mph` isn't a real ExtractedFacts slot. Did
you mean `speed_specific_mph` (exact mph) or `speed_band` (categorical)?
See the 29 valid slots in the template comment."

### Example 5 — bulk-tag every question in a category

> Advisor: "Tag every brake-pedal-feel question with pedal_feel."

1. Run `export_question_required_facts_md` to get the current list.
2. Filter to brake-pedal questions (advisor identifies the IDs from
   their question text).
3. Build a multi-row MD:
   ```markdown
   | question_id | required_facts |
   | --- | --- |
   | 412 | pedal_feel |
   | 413 | pedal_feel |
   | 414 | pedal_feel |
   | 415 | pedal_feel |
   ```
4. Dry-run → show diff → apply.

## Round-trip — export current state to a starting MD

> Advisor: "Show me everything currently tagged with required_facts."

→ `export_question_required_facts_md` returns an MD with one row per
ACTIVE question (`(none)` for unmapped ones). Save locally, edit, re-upload.

## Revert a recent upload

If a bulk upload applied cleanly but the result is wrong, use
`revert_md_upload(upload_id)` — see [`revert-upload.md`](./revert-upload.md).

## Don't

- ❌ Don't call `upload_question_required_facts_md` with `dry_run: false`
  without first running `dry_run: true` and getting advisor approval.
  The token won't match.
- ❌ Don't invent question_ids — they're cross-checked at upload time.
  If unsure, call `export_question_required_facts_md`.
- ❌ Don't invent slot names — only the 29 canonical ExtractedFacts keys
  are valid (see the table above + the template comment).
- ❌ Don't paraphrase the validation error — relay it verbatim so the
  advisor can fix the exact cell.
- ❌ Don't try to add a NEW question or edit question text via this MD —
  this file ONLY edits `required_facts`. Use `upload_concern_category_md`
  for question text edits.
