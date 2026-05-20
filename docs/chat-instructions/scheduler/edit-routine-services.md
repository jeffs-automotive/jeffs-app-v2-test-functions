# Edit routine services — Claude Desktop guide

> **What this controls:** the 10 chip-style entries on the Step 7 picker that
> customers tap to declare what they want done. Some chips are pure-routine
> (oil change, alignment); five are "diagnostic-routine" — they kick off the
> concern-explanation flow when picked.
>
> **Source-of-truth file:** [`./templates/routine-services.md`](./templates/routine-services.md) (moved 2026-05-19 from `docs/scheduler/`)
> **Tools:** `upload_routine_services_md` (bulk), `patch_routine_service_fields` (single-row), `revert_md_upload`, `export_routine_services_md`

## MD format — Option B per-service blocks

```markdown
## brake_inspection
Display name: Brake Inspection
Abbreviation: BRAKE INSPECT
Display order: 6
Wait eligible: false
Requires explanation: true
Concern categories: brakes
Starting price: $39.99
Price waived note: Fee waived if a repair or more testing is needed and approved
Description: Quick pad-thickness + caliper + rotor + brake-fluid check. Customer-facing chip caption (added 2026-05-19).
Active: true
```

### Field reference

| Field | Required | Type | Notes |
|---|---|---|---|
| `## service_key` | yes | `^[a-z0-9_]+$` | Canonical identifier |
| `Display name` | yes | string | Customer-facing chip label |
| `Abbreviation` | yes | ≤30 chars | Tekmetric appointment-title fragment |
| `Display order` | yes | non-neg int | Lower = shown first on the picker |
| `Wait eligible` | yes | `true`/`false` | Customer can wait in lobby (oil, rotate, etc.) vs drop-off only |
| `Requires explanation` | yes | `true`/`false` | `true` = picking this chip routes to the concern-explanation diagnostic flow. Currently true for the 5 diagnostic-routine chips: Brake Inspection, Check Battery, Warning Lights, Check Suspension, Check A/C |
| `Concern categories` | no | comma-list or `(none)` | ONLY meaningful when Requires explanation: true. Tells the diagnostic LLM which concern catalog to load |
| `Starting price` | no | `$XX.XX` / `Free` / `(none)` | `(none)` renders no price on the chip |
| `Price waived note` | no | string or `(none)` | Short customer-facing caveat under the price |
| `Description` | no | 10-500 chars or `(none)` | **NEW 2026-05-19** — customer-facing 1-2 sentence chip caption |
| `Active` | yes | `true`/`false` | `false` = hidden from picker (soft-delete) |

## Two-step flow — preview before apply

Same as testing-services (see [`edit-testing-services.md`](./edit-testing-services.md) for the full mechanic). Tool defaults `dry_run: true`. You:

1. Dry-run → show advisor `diff_summary` + `validation_errors` + `validation_warnings` + `confirm_token`
2. On explicit approval, apply with `dry_run: false` + `expected_confirm_token`

## Validation rules

Same as testing-services PLUS:

- `Display order` must be non-negative integer
- `Wait eligible` and `Requires explanation` must be booleans
- If `Requires explanation: true`, advisor SHOULD include `Concern categories` (the diagnostic flow needs it). Not a hard block, but flag in dry-run if missing.

## Single-row edits via `patch_routine_service_fields`

> "Set oil_change price to $69.95." → `patch_routine_service_fields(service_key='oil_change', starting_price_cents=6995)`

> "Add a description to check_battery: 'Free battery, alternator, and starter test.'" → `patch_routine_service_fields(service_key='check_battery', description='Free battery, alternator, and starter test.')`

> "Pass null to clear price." → `patch_routine_service_fields(service_key='oil_change', starting_price_cents=null)`

The patch tool runs the SAME validators as the bulk uploader (slug regex, price non-neg, concern_categories enum, description length, abbreviation length). Returns `{ action: 'updated' | 'no_changes' | 'not_found' | 'validation_error' }`.

## Diagnostic-routine chips — special handling

The 5 chips where `Requires explanation: true` (Brake Inspection, Check Battery, Warning Lights, Check Suspension, Check A/C) sit on the routine picker but route through the diagnostic flow. When the customer picks one:

1. Wizard asks them to describe the concern
2. Diagnostic LLM gap-detects against the matching `Concern categories` checklist (read from `concern_questions` table — separate from this file)
3. Wizard asks clarifying questions
4. Continues to testing-service approval if applicable

So when editing these chips:

- Don't flip `Requires explanation` to `false` without thinking — that turns the chip into a pure-routine submission with no diagnostic Q&A.
- Don't change `Concern categories` casually — it routes the LLM to a specific concern catalog.

## Revert a recent upload

See [`revert-upload.md`](./revert-upload.md).

## Workflow examples

### Example 1 — fill in missing descriptions

routine_services descriptions are currently all `(none)` (column added 2026-05-19; advisor to populate).

> Advisor: "Add a one-sentence description to each routine chip."

1. `export_routine_services_md` → save locally
2. Edit `Description:` line for each block
3. Dry-run upload → verify modifications count = 10
4. Approve → apply

### Example 2 — single-row description set

> Advisor: "Add description to oil_change: 'Synthetic-blend or full-synthetic oil change with filter and visual inspection.'"

→ `patch_routine_service_fields(service_key='oil_change', description='Synthetic-blend or full-synthetic oil change with filter and visual inspection.')`

→ "Updated **oil_change** description."

### Example 3 — re-order picker chips

> Advisor: "Put Alignment first."

→ Currently Alignment is `Display order: 5`. State Inspection is `Display order: 1`. The advisor wants Alignment to be first.

→ Confirm with advisor: should others shift down by 1, or just swap with whatever's currently at 1?

→ If just swap: `patch_routine_service_fields(service_key='alignment', display_order=1)` AND `patch_routine_service_fields(service_key='state_inspection_emissions', display_order=5)` (two separate calls)

→ If shift: edit the MD, dry-run, approve, apply.

## Don't

- ❌ Don't paste price as `$45.99.5` or "around forty bucks" — require a clean dollar amount.
- ❌ Don't flip `Requires explanation` without confirming — it changes the customer flow shape.
- ❌ Don't drop `Concern categories` on a `Requires explanation: true` chip — the LLM needs it to route.
