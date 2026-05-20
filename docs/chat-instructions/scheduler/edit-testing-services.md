# Edit testing services — Claude Desktop guide

> **What this controls:** the 15 diagnostic services the wizard's diagnostic LLM
> can recommend from a customer's free-text concern. Each has a customer-facing
> price, description, abbreviation, and concern-category tags.
>
> **Source-of-truth file:** [`./templates/testing-services.md`](./templates/testing-services.md) (moved 2026-05-19 from `docs/scheduler/`)
> **Tools:** `upload_testing_services_md` (bulk), `patch_testing_service_fields` (single-row), `revert_md_upload`, `export_testing_services_md`

## MD format — Option B per-service blocks

Each service is a `## service_key` block with `Field: value` lines underneath. Order of fields inside a block doesn't matter. Blank lines between blocks are encouraged.

```markdown
## brake_inspection
Display name: Brake inspection
Abbreviation: BRAKE INSPECT
Starting price: $39.99
Notes: Waived if brake repair is approved
Description: We measure pad thickness, inspect rotors and calipers, check brake fluid condition, and recommend any needed work. Waived if you approve any recommended repairs.
Example keywords: (none)
Concern categories: brakes, noise, pulling
Active: true
```

### Field reference

| Field | Required | Type | Notes |
|---|---|---|---|
| `## service_key` | yes | `^[a-z0-9_]+$` | Canonical identifier. Never invent — match an existing one or pick a clean snake_case slug |
| `Display name` | yes | string | Customer-facing label (shown in chat bubbles + transcript) |
| `Abbreviation` | yes | ≤30 chars | Shop-shorthand used in Tekmetric appointment title |
| `Starting price` | yes | `$XX.XX` or `Free` | Integer cents stored as `starting_price_cents` |
| `Notes` | no | string or `(none)` | Advisor-side caveat (NOT shown to customer) |
| `Description` | no | 10-500 chars or `(none)` | Customer-facing 1-2 sentence prose |
| `Example keywords` | no | comma-list or `(none)` | LLM routing hints (e.g. `clunk, knock` for suspension) |
| `Concern categories` | yes | comma-list from 14 slugs | `noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other` |
| `Active` | yes | `true`/`false` | `false` = hidden from picker (soft-delete; preserves history) |

## Two-step flow — always preview before applying

The `upload_testing_services_md` tool DEFAULTS to `dry_run: true`. You will:

1. **Dry-run** the upload. The tool returns:
   - `diff_summary` — what would change (added / modified / deactivated counts + per-service deltas)
   - `validation_errors` — blocking issues (bad slug, invalid concern category, missing required field, etc.)
   - `validation_warnings` — soft concerns surfaced for advisor review (>50% price moves, deactivations, MD-omission soft-deletes)
   - `confirm_token` — a hash you'll pass back on the apply call

2. **Show the advisor the report.** Be specific:
   > "Dry-run for testing-services upload:
   > - **3 modified:** `brake_inspection` (starting_price_cents 3999 → 4500), `check_ac` (description changed), `tpms_testing` (concern_categories changed)
   > - **0 added, 0 deactivated**
   > - **1 warning:** `brake_inspection` price changed $39.99 → $45.00 (13% — under the 50% warn threshold, FYI not a block)
   > - **Validation:** clean.
   >
   > Apply?"

3. **Wait for explicit "yes"** before re-calling with `dry_run: false` + `expected_confirm_token: <token>`.

4. **On apply success**, surface the `audit_log_id` — needed for revert.

### What blocks vs warns

**BLOCKS apply (errors — must be fixed in the MD before re-running):**
- `service_key` doesn't match `^[a-z0-9_]+$` (e.g. uppercase, hyphens)
- Duplicate `service_key` in the same upload
- Invalid `Concern categories` slug
- `Description` < 10 chars OR > 500 chars
- `Abbreviation` > 30 chars
- `Starting price` negative

**WARNS (surface for confirmation; doesn't block):**
- Price moves >50% in either direction
- Service deactivated (`Active: true` → `Active: false`)
- Service present in DB but missing from MD (will be soft-deleted on apply)

## Single-row edits via `patch_testing_service_fields`

For one-off tweaks, skip the MD round-trip:

> "Set brake_inspection price to $45." → `patch_testing_service_fields(service_key='brake_inspection', starting_price_cents=4500)`

The same validators run (slug regex, price non-neg, concern_categories enum, description length, abbreviation length). Returns `{ action: 'updated' | 'no_changes' | 'not_found' | 'validation_error' }`.

## Revert a recent upload

If a bulk upload applied cleanly but the result is wrong on the scheduler, use `revert_md_upload(upload_id)` — see [`revert-upload.md`](./revert-upload.md).

## Workflow examples

### Example 1 — bulk update prices

> Advisor: "Bump every diagnostic price by 5%."

1. Read current file: `export_testing_services_md` → save locally
2. Manually edit each `Starting price` line (or have advisor edit)
3. Dry-run: `upload_testing_services_md(md_content=<edited>, dry_run=true)`
4. Show the diff (likely 15 warnings if all prices changed) + confirm token
5. On approval: `upload_testing_services_md(md_content=<edited>, dry_run=false, expected_confirm_token=<token>)`
6. Report: "Applied. 15 modified. Audit log id `audit_log_id`."

### Example 2 — single-field tweak

> Advisor: "Change brake_inspection notes to 'Fee waived if brake repair is approved this visit'."

→ `patch_testing_service_fields(service_key='brake_inspection', notes='Fee waived if brake repair is approved this visit')`

→ "Updated **brake_inspection** notes."

### Example 3 — soft-delete a service

> Advisor: "Stop offering windshield_inop_testing."

→ Confirm: "Soft-delete `windshield_inop_testing`? Existing appointments referencing it stay intact, but it won't appear to customers."
→ `patch_testing_service_fields(service_key='windshield_inop_testing', active=false)`

OR via bulk: remove the `## windshield_inop_testing` block from the MD + re-upload (the parser auto-deactivates missing rows; warning will surface in dry-run).

### Example 4 — bad upload caught by validation

Advisor pastes an MD with `Concern categories: brakes, transmission` (no such category).

→ Dry-run returns:
```
validation_errors: [
  { key: 'brake_inspection', field: 'concern_categories',
    message: '"transmission" is not one of the 14 canonical slugs (noise, vibration, ...)' }
]
```

→ "Validation failed — `brake_inspection` has `transmission` in Concern categories, but that isn't one of the 14 valid slugs. Edit to use one of: noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other."

## Don't

- ❌ Don't call `upload_testing_services_md` with `dry_run: false` without first running `dry_run: true` and getting advisor approval. The token won't match.
- ❌ Don't invent service_keys — match an existing one or confirm a new one with the advisor before adding.
- ❌ Don't paraphrase the validation error — relay it verbatim so the advisor can fix the exact field.
- ❌ Don't show cents to the advisor; format as dollars.
