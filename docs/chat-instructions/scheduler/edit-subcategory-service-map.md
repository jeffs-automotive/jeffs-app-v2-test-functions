# Edit subcategory → testing-service mapping — Claude Desktop guide

> **What this controls:** which testing_service(s) the diagnostic LLM routes
> each concern subcategory to. The mapping column (`eligible_testing_service_keys`,
> 1:N) lives on `concern_subcategories`. When non-empty, it OVERRIDES the
> legacy `testing_services.concern_categories[]` fan-out for that subcategory.
> When empty, the subcategory falls back to legacy behavior.
>
> **Source-of-truth file:** [`./templates/subcategory-service-map.md`](./templates/subcategory-service-map.md)
> **Tools:** `upload_subcategory_service_map_md` (bulk), `export_subcategory_service_map_md`, `revert_md_upload`

## When the advisor says "upload the subcategory mappings" — exact recipe

The orchestrator fetches the template from main automatically. **You do
NOT need to read the file.** Just call the tool with no file content.

```
Step 1: upload_subcategory_service_map_md({ dry_run: true })
        → returns diff + confirm_token

Step 2: Render diff. Wait for "yes".

Step 3: upload_subcategory_service_map_md({
          dry_run: false,
          expected_confirm_token: <token>
        })
```

**Why no file content?** Orchestrator pulls `docs/chat-instructions/
scheduler/templates/subcategory-service-map.md` from main automatically.
Make sure advisor pushed edits to main first.

**Escape hatches:** `source_branch: "feature-x"` or `md_content: "..."`.

## Tools you have for this task — they WORK, use them

You DO have BOTH of these. If you find yourself thinking "I can't read that
file" or "I can't call that tool" — STOP. You DO. Use them. Relay any error
verbatim. Never refuse a task because you "don't have access".

- **Filesystem MCP** — `read_file(path)`. Read `subcategory-service-map.md`
  from the templates folder. The folder path is in `scheduler.md` (Filesystem
  MCP section). **Don't ask the user to paste the file** — read it yourself.
  Only ask for a paste if the filesystem MCP returns an explicit error.

- **Orchestrator MCP** — exposes ~50 specific typed tools. For THIS
  task, the relevant tools are:
  - `upload_subcategory_service_map_md` — bulk upload via MD content + dry_run + expected_confirm_token
  - `export_subcategory_service_map_md` — round-trip export current mapping as MD
  - `revert_md_upload` — undo a recent bulk upload by audit_log_id

  Call each tool DIRECTLY by name with its typed arguments. DON'T try to
  call `run_orchestrator` — REMOVED 2026-05-20.

Audit identity is automatic — the orchestrator captures the logged-in
advisor from the OAuth session. Don't ask "who are you?".

## MD format — wide table

A single markdown table with three columns. Order of rows doesn't matter.
Blank rows and `<!-- ... -->` comments are ignored. The H1 is informational.

```markdown
| category | subcategory_slug | testing_service_keys |
| --- | --- | --- |
| warning_light | check_engine_light | check_engine_light_testing |
| warning_light | engine_temperature_light | coolant_leak_testing, check_engine_light_testing |
| warning_light | something_unmapped |  |    ← blank cell CLEARS the mapping
```

### Field reference

| Field | Required | Type | Notes |
|---|---|---|---|
| `category` | yes | one of 14 canonical slugs | `noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other` |
| `subcategory_slug` | yes | `^[a-z0-9_]+$` | Must exist in `concern_subcategories` with the matching `category`. Cross-checked at upload time. |
| `testing_service_keys` | yes (cell may be blank) | comma-list of `^[a-z0-9_]+$` OR `(none)` OR blank | Each key MUST exist in `testing_services` AND be `Active: true`. Blank / `(none)` / `-` CLEARS the mapping (falls back to legacy concern_categories[] fan-out). |

## Diff semantics — partial uploads are SAFE

- **Rows OMITTED from the MD are LEFT ALONE.** Uploads never silently clear
  mappings you didn't touch.
- **Rows mentioned with a NON-EMPTY cell** REPLACE the existing array
  (in MD order, de-duped).
- **Rows mentioned with a BLANK / `(none)` cell** CLEAR the existing mapping
  (sets `eligible_testing_service_keys = '{}'`).

This means you can upload a 1-row MD to change just one mapping — the
other ~50 rows in the DB stay as-is.

## Two-step flow — always preview before applying

The `upload_subcategory_service_map_md` tool DEFAULTS to `dry_run: true`. You will:

1. **Dry-run** the upload. The tool returns:
   - `diff_summary` — per-row deltas (`before: [...]`, `after: [...]`)
   - `validation_errors` — blocking issues (unknown category, unknown
     subcategory slug, unknown / inactive service_key, duplicate row)
   - `validation_warnings` — soft concerns (subcategory currently inactive)
   - `confirm_token` — pass back on the apply call

2. **Show the advisor the report.** Be specific:
   > "Dry-run for subcategory-service-map upload:
   > - **2 modified:**
   >   - `warning_light / check_engine_light`: `[]` → `[check_engine_light_testing]`
   >   - `warning_light / abs_anti_lock_brake_light`: `[]` → `[abs_traction_stability_testing]`
   > - **0 cleared, 1 unchanged**
   > - **Validation:** clean.
   >
   > Apply?"

3. **Wait for explicit "yes"** before re-calling with `dry_run: false` +
   `expected_confirm_token: <token>`.

4. **On apply success**, surface the `audit_log_id` — needed for revert.

### What blocks vs warns

**BLOCKS apply (errors — must be fixed in the MD before re-running):**
- `category` not in the 14 canonical slugs
- `subcategory_slug` not present (with matching category) in
  `concern_subcategories`
- `testing_service_key` not present in `testing_services`
- `testing_service_key` exists but is `Active: false` (must reactivate
  first OR remove from the mapping)
- Duplicate `(category, subcategory_slug)` in the same upload
- Bad slug format on either column (`^[a-z0-9_]+$`)

**WARNS (surface for confirmation; doesn't block):**
- Subcategory exists but is currently `Active: false` (mapping will be
  stored but won't take effect until subcategory is reactivated)

## Workflow examples

### Example 1 — route a single warning light to a specific testing service

> Advisor: "Send ABS lights to abs_traction_stability_testing."

1. Don't re-upload the whole map. Just send one row:
   ```markdown
   | category | subcategory_slug | testing_service_keys |
   | --- | --- | --- |
   | warning_light | abs_anti_lock_brake_light | abs_traction_stability_testing |
   ```
2. Dry-run → show diff → apply on approval.

### Example 2 — route one subcategory to MULTIPLE services

> Advisor: "Engine temperature light should be eligible under both coolant_leak_testing
> AND check_engine_light_testing — let the LLM pick the right one based on
> what the customer says."

```markdown
| category | subcategory_slug | testing_service_keys |
| --- | --- | --- |
| warning_light | engine_temperature_light | coolant_leak_testing, check_engine_light_testing |
```

The diagnostic LLM's Stage 1 prompt will see this subcategory as eligible
under BOTH services and pick based on description wording.

### Example 3 — clear a mapping (revert to legacy fan-out)

> Advisor: "Stop the explicit mapping for traction_control_stability_light — let
> the legacy concern_categories[] routing handle it."

```markdown
| category | subcategory_slug | testing_service_keys |
| --- | --- | --- |
| warning_light | traction_control_stability_light |  |
```

The blank cell clears the mapping; the subcategory falls back to fan-out
via `testing_services.concern_categories[]`.

### Example 4 — bad upload caught by validation

Advisor uploads a row with `testing_service_keys: abs_testing` but the
catalog only has `abs_traction_stability_testing`.

→ Dry-run returns:
```
validation_errors: [
  { field: 'warning_light::abs_anti_lock_brake_light.testing_service_keys',
    message: '"abs_testing" does not exist in testing_services' }
]
```

→ "Validation failed — `abs_testing` isn't a real service_key. Did you mean
`abs_traction_stability_testing`? You can run `list_testing_services` to see
all valid keys."

## Round-trip — export current state to a starting MD

> Advisor: "Show me the current mappings."

→ `export_subcategory_service_map_md` returns an MD with one row per ACTIVE
subcategory (with `(none)` for unmapped ones). Save locally, edit, re-upload.

## Don't

- ❌ Don't call `upload_subcategory_service_map_md` with `dry_run: false`
  without first running `dry_run: true` and getting advisor approval. The
  token won't match.
- ❌ Don't invent subcategory_slugs or testing_service_keys — both are
  cross-checked at upload time. If you're unsure, call `export_subcategory_service_map_md`
  or look at the testing-services.md template.
- ❌ Don't paraphrase the validation error — relay it verbatim so the
  advisor can fix the exact cell.
- ❌ Don't try to add a NEW subcategory or NEW testing service via this MD —
  this file ONLY edits the `eligible_testing_service_keys` column. Use the
  concern category MD upload + the testing-services.md upload for those.
