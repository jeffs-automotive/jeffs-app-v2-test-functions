# Routine Services

<!-- service_key: canonical lowercase + underscore identifier. -->
<!-- display_name: customer-facing name shown on the picker chip. -->
<!-- abbreviation: shop-shorthand used in Tekmetric appointment title. -->
<!-- display_order: integer; lower = shown first on the picker. -->
<!-- wait_eligible: true if customer can wait in the lobby for it (oil change, tire rotate, etc.). false = drop-off only. -->
<!-- requires_explanation: true if the customer should describe their concern after picking (sends the description to the diagnostic LLM for sub-classification + question gap-detection). For most routine services this is false. The exception is the "diagnostic-routine" chips (Brake Inspection, Check Battery, Warning Lights, Check Suspension, Check A/C) which sit on the routine list but route through the diagnostic flow. -->
<!-- concern_categories: comma-separated; ONLY meaningful when requires_explanation=true. Tells the LLM which sub-category catalog to load. -->
<!-- active: true to show on the picker, false to soft-delete. -->

| service_key | display_name | abbreviation | display_order | wait_eligible | requires_explanation | concern_categories | active |
|-------------|--------------|--------------|---------------|---------------|----------------------|--------------------|--------|
| state_inspection_emissions | State Inspection and Emissions | SI IM | 1 | true | false |  | true |
| oil_change | Oil Change | LOF | 2 | true | false |  | true |
| tire_rotation | Tire Rotation | ROT | 3 | true | false |  | true |
| rotate_balance_tires | Rotate and Balance Tires | ROT BAL | 4 | true | false |  | true |
| alignment | Alignment | ALIGN | 5 | true | false |  | true |
| brake_inspection | Brake Inspection | BRAKE INSPECT | 6 | false | true | brakes | true |
| check_battery | Check Battery | BATT CHECK | 7 | false | true | electrical | true |
| warning_lights | Warning Lights | WARN LIGHT | 8 | false | true | warning_light | true |
| check_suspension | Check Suspension | SUSP CHECK | 9 | false | true | steering | true |
| check_ac | Check A/C | AC CHECK | 10 | false | true | hvac | true |

## Pricing (added 2026-05-17)

Routine services NOW carry a `starting_price_cents` and `price_waived_note` column. Migration `20260518010416_scheduler_routine_services_pricing.sql` adds the columns + seeds the values below. **The `upload_routine_services_md` tool doesn't yet parse these columns** — bulk MD upload still operates on the metadata table above. Edit pricing one row at a time via `patch_routine_service_fields` until a follow-up extends the MD parser.

| service_key | starting_price_cents | starting_price_display | price_waived_note |
|-------------|----------------------|------------------------|-------------------|
| state_inspection_emissions | 7995 | $79.95 |  |
| oil_change | 5995 | $59.95 |  |
| tire_rotation | 2995 | $29.95 |  |
| rotate_balance_tires | 7995 | $79.95 |  |
| alignment | 10995 | $109.95 |  |
| brake_inspection | 3999 | $39.99 | Fee waived if a repair or more testing is needed and approved |
| check_battery | 0 | Free |  |
| warning_lights | 17999 | $179.99 |  |
| check_suspension | 8995 | $89.95 |  |
| check_ac | 8995 | $89.95 | Fee waived if a repair or more testing is needed and approved |

### How to change a price

Ask Claude:

> "Set oil_change price to $69.95."

Claude calls `patch_routine_service_fields(service_key='oil_change', starting_price_cents=6995)`. Same shape as `patch_testing_service_fields`. Pass `null` to clear (no price shown).

### How to set / clear the waived-fee note

> "Add the waived-fee note to check_battery."

Claude calls `patch_routine_service_fields(service_key='check_battery', price_waived_note='Fee waived if a repair or more testing is needed and approved')`.

Pass `null` to clear.

---

## How to update

**Whole-table replace**: ask Claude to upload this file via `upload_routine_services_md`. Diff-based — rows here are upserted; rows in DB but missing here are soft-deleted. NOTE: the upload tool parses the metadata table only; pricing fields are NOT bulk-loaded from the MD yet (see Pricing section above).

**Single-field tweak** (e.g. "flip check_battery requires_explanation", "set oil_change price to $65"): ask Claude directly. Claude calls `patch_routine_service_fields`.

**display_order**: small integer; lower numbers appear first. If you reorder, just renumber 1, 2, 3, … (gaps are fine but contiguous is easier to read).

**The five "diagnostic-routine" chips** (Brake Inspection, Check Battery, Warning Lights, Check Suspension, Check A/C) live on this routine list with `requires_explanation=true`. When the customer picks one, the wizard asks them to describe the concern, the LLM gap-detects against the matching `concern_categories` checklist, and the wizard asks clarifying questions. They keep their routine-list pricing and the picker chip looks identical to the rest of the routine list — only the post-submit flow differs.

**Customer-facing picker layout (2026-05-17 reshape).** The Step 7 picker shows ALL 10 routine services in a single chip section with starting prices + waived-fee notes inline. The legacy two-section design with a separate "Diagnostic services" chip section (testing_services) was retired because the testing-service list was long, jargon-heavy, and confusing to non-mechanic customers. The diagnostic LLM picks the right test from `testing-services.md` based on the customer's free-text concern explanation in Step 7.2 — testing services are no longer customer-pickable on the entry card.
