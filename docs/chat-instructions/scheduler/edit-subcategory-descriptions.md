# Edit subcategory descriptions — Claude Desktop guide

> **What this controls:** the 4 stage-1-classifier metadata columns on
> `concern_subcategories` — `description`, `positive_examples`,
> `negative_examples`, `synonyms`. These are read by the 3-stage diagnostic
> LLM during Stage 1 (subcategory selection from a customer utterance).
> Better descriptions + few-shot examples + synonyms → sharper classification.
>
> **Source-of-truth file:** [`./templates/subcategory-descriptions.md`](./templates/subcategory-descriptions.md)
> **Tools:** `upload_subcategory_descriptions_md` (bulk), `export_subcategory_descriptions_md`, `revert_md_upload`

## Tools you have for this task — they WORK, use them

You DO have BOTH of these. If you find yourself thinking "I can't read that
file" or "I can't call that tool" — STOP. You DO. Use them. Relay any error
verbatim. Never refuse a task because you "don't have access".

- **Filesystem MCP** — `read_file(path)`. Read `subcategory-descriptions.md`
  from the templates folder. The folder path is in `scheduler.md` (Filesystem
  MCP section). **Don't ask the user to paste the file** — read it yourself.
  Only ask for a paste if the filesystem MCP returns an explicit error.

- **Orchestrator MCP** — exposes ~50 specific typed tools. For THIS task,
  the relevant tools are:
  - `upload_subcategory_descriptions_md` — bulk upload via MD content + dry_run + expected_confirm_token
  - `export_subcategory_descriptions_md` — round-trip export current descriptions as MD
  - `revert_md_upload` — undo a recent bulk upload by audit_log_id

  Call each tool DIRECTLY by name with its typed arguments. DON'T try to
  call `run_orchestrator` — REMOVED 2026-05-20.

Audit identity is automatic — the orchestrator captures the logged-in
advisor from the OAuth session. Don't ask "who are you?".

## MD format — per-subcategory blocks

Each subcategory is a `## <category>/<slug>` block with field lines
underneath. The heading is COMPOSITE — subcategory slugs are unique only
within a category, so both halves are required, separated by `/`. Order
of fields inside a block doesn't matter. Blank lines between blocks are
encouraged.

```markdown
## brakes/high_pitched_squealing
Description: High-pitched continuous squeal from one or more wheels, usually appearing when the brake pedal is lightly pressed or released. Often caused by worn brake pad wear indicators or glazed pads/rotors.
Positive examples:
  - "Brakes squeal when I let off the pedal"
  - "Squeaking noise when I'm coming to a stop"
Negative examples:
  - "Grinding noise when I brake" → metallic_grinding
  - "Pedal vibrates when braking" → pulsating_or_vibrating_pedal
Synonyms: squeak, squeal, screech, whine, brake noise
```

### Field reference

| Field | Required | Type | Notes |
|---|---|---|---|
| `## <category>/<slug>` | yes | both halves `^[a-z0-9_]+$` | Composite heading. Both `category` and `slug` must exist in `concern_subcategories` |
| `Description` | yes | 10-1000 chars | LLM-facing. Write 2-3 natural sentences explaining what the subcategory covers and what distinguishes it from siblings |
| `Positive examples` | no | comma-list OR `- ` lines | Customer utterances that SHOULD match. Cap 10. Empty / `(none)` → no exemplars |
| `Negative examples` | no | same format | Utterances that should NOT match. You MAY append ` → other_slug` for advisor reference — stripped at parse |
| `Synonyms` | no | comma-list | Alt phrasings. Cap 20 |

**Multi-line list format:** when you write `Positive examples:` (or
`Negative examples:`) with an empty value, the next `- ` lines are
collected as list entries until a blank line or a new `Field:` line.
Each entry MAY be wrapped in double quotes for readability — the quotes
are stripped at parse.

## Diff semantics — partial uploads are SAFE

- **Rows OMITTED from the MD are LEFT ALONE.** Uploads never silently
  clear descriptions you didn't touch.
- **Rows mentioned with a populated `Description`** REPLACE the existing
  4-field metadata for that subcategory.
- **To CLEAR a list field**, write `Field: (none)` (or `Field:` with no
  `- ` continuation lines).

This means you can upload a 1-block MD to edit just one subcategory —
the other 104+ in the DB stay as-is.

## Two-step flow — always preview before applying

The `upload_subcategory_descriptions_md` tool DEFAULTS to `dry_run: true`. You will:

1. **Dry-run** the upload. The tool returns:
   - `diff_summary` — per-block deltas (`changed_fields`, description
     previews before/after)
   - `validation_errors` — blocking issues (missing Description, length
     out-of-range, examples/synonyms over cap, unknown (category, slug),
     duplicate block)
   - `validation_warnings` — soft concerns (subcategory currently inactive)
   - `confirm_token` — pass back on the apply call

2. **Show the advisor the report.** Be specific:
   > "Dry-run for subcategory-descriptions upload:
   > - **3 modified:**
   >   - `brakes/high_pitched_squealing`: description, positive_examples, synonyms
   >   - `brakes/metallic_grinding`: description
   >   - `hvac/bad_smell_from_vents`: description, negative_examples
   > - **0 unchanged**
   > - **Validation:** clean.
   >
   > Apply?"

3. **Wait for explicit "yes"** before re-calling with `dry_run: false` +
   `expected_confirm_token: <token>`.

4. **On apply success**, surface the `audit_log_id` — needed for revert.

### What blocks vs warns

**BLOCKS apply (errors — must be fixed in the MD before re-running):**
- Heading missing the `/` (e.g., `## high_pitched_squealing` without a category)
- `category` or `slug` not matching `^[a-z0-9_]+$`
- (category, slug) not found in `concern_subcategories`
- `Description` missing, < 10 chars, or > 1000 chars
- `Positive examples` count > 10
- `Negative examples` count > 10
- `Synonyms` count > 20
- Duplicate `(category, slug)` block in the same upload
- Unknown field name (catches typos like `Descripton`)

**WARNS (surface for confirmation; doesn't block):**
- Subcategory exists but is currently `Active: false` (metadata stored
  but won't take effect until reactivated)

## Workflow examples

### Example 1 — tighten one subcategory's description + add synonyms

> Advisor: "The classifier is mis-routing 'squeaking when I let off the
> pedal' as suspension instead of brakes. Tighten up the
> high_pitched_squealing description and add 'squeaky brakes' as a synonym."

1. Don't re-upload all 105 subcategories. Just send the one block:
   ```markdown
   ## brakes/high_pitched_squealing
   Description: High-pitched continuous squeal from one or more wheels, usually when the brake pedal is lightly pressed or released. Caused by worn pad wear indicators or glazed pads/rotors. Always brake-related — NOT a suspension noise (which is clunking_over_bumps or squeaking_or_creaking_over_bumps).
   Synonyms: squeak, squeal, screech, whine, brake noise, squeaky brakes, squealing brakes
   ```
2. Dry-run → show diff → apply on approval.

Note: Positive/Negative examples are OMITTED → left alone. Only the
two fields you wrote are updated.

### Example 2 — add few-shot examples to sharpen boundary

> Advisor: "Add boundary examples to hvac/bad_smell_from_vents so the LLM
> doesn't route exhaust-smell-in-cabin there."

```markdown
## hvac/bad_smell_from_vents
Description: Unpleasant odor from the dashboard vents when HVAC is running. Often musty/mildew from evaporator microbial growth; can also be burning electrical from a failed blower motor.
Negative examples:
  - "Exhaust smell in the cabin" → exhaust_fumes_inside_the_cabin
  - "Burning smell from outside" → burnt_oil_smell
  - "AC blows warm" → ac_blows_warm_or_hot_air
```

The arrow + target are advisor-only — they're stripped at parse. The
LLM only sees the utterance.

### Example 3 — clear all synonyms on one subcategory

> Advisor: "Stop using synonym-matching for noise/clunking_over_bumps —
> the synonyms list is hurting precision."

```markdown
## noise/clunking_over_bumps
Description: Single, hard, dull thud from the suspension when the vehicle goes over a bump or pothole. Distinct from a metallic rattle (rattling_underneath_the_car) or a continuous creak (squeaking_or_creaking_over_bumps).
Synonyms: (none)
```

### Example 4 — bad upload caught by validation

Advisor uploads a block with `## brakes/squealing` but the actual slug
is `high_pitched_squealing`.

→ Dry-run returns:
```
validation_errors: [
  { field: 'brakes/squealing.slug',
    message: 'no row in concern_subcategories for (category=brakes, slug=squealing)' }
]
```

→ "Validation failed — `brakes/squealing` isn't a real subcategory. Did
you mean `brakes/high_pitched_squealing`? Run `export_subcategory_descriptions_md`
to see all valid slugs."

## Round-trip — export current state to a starting MD

> Advisor: "Show me the current brake-subcategory descriptions."

→ `export_subcategory_descriptions_md` returns an MD with one block per
ACTIVE subcategory across all 14 concern categories, grouped by category
+ display_order. Save locally, edit only the blocks you want to change,
re-upload.

## Revert a recent upload

If a bulk upload applied cleanly but the result is wrong on the scheduler,
use `revert_md_upload(upload_id)` — see [`revert-upload.md`](./revert-upload.md).

## Don't

- ❌ Don't call `upload_subcategory_descriptions_md` with `dry_run: false`
  without first running `dry_run: true` and getting advisor approval. The
  token won't match.
- ❌ Don't invent (category, slug) pairs — both are cross-checked at
  upload time. If unsure, call `export_subcategory_descriptions_md`.
- ❌ Don't omit the `/` in the heading — both halves are required.
- ❌ Don't paraphrase the validation error — relay it verbatim so the
  advisor can fix the exact block.
- ❌ Don't try to add a NEW subcategory or NEW question via this MD — this
  file ONLY edits the 4 metadata columns. Use `upload_concern_category_md`
  for subcategory + question edits.
- ❌ Don't try to add or edit `eligible_testing_service_keys` here — that's
  a separate tool (`upload_subcategory_service_map_md`).
