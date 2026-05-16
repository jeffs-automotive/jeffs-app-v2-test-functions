# Routine Services

<!-- service_key: canonical lowercase + underscore identifier. -->
<!-- display_name: customer-facing name shown on the picker chip. -->
<!-- abbreviation: shop-shorthand used in Tekmetric appointment title. -->
<!-- display_order: integer; lower = shown first on the picker. -->
<!-- wait_eligible: true if customer can wait in the lobby for it (oil change, tire rotate, etc.). false = drop-off only. -->
<!-- requires_explanation: true if the customer should describe their concern after picking (sends the description to the diagnostic LLM for sub-classification + question gap-detection). For most routine services this is false. The exception is the "diagnostic-routine" chips (Brake Inspection, Check Battery, Warning Lights, Check Suspension, Check A/C) which sit on the routine list but route through the diagnostic flow. -->
<!-- concern_categories: comma-separated; ONLY meaningful when requires_explanation=true. Tells the LLM which sub-category catalog to load. -->
<!-- active: true to show on the picker, false to soft-delete. -->
<!-- NOTE: routine services have NO PRICING column in Phase 1. Pricing is testing-services-only. -->

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

---

## How to update

**Whole-table replace**: ask Claude to upload this file via `upload_routine_services_md`. Diff-based — rows here are upserted; rows in DB but missing here are soft-deleted.

**Single-field tweak** (e.g. "flip check_battery requires_explanation"): ask Claude directly. Claude calls `patch_routine_service_fields`.

**No pricing**: routine services don't have a price. If a service NEEDS pricing (we'd actually quote a customer), move it to `testing-services.md` instead.

**display_order**: small integer; lower numbers appear first. If you reorder, just renumber 1, 2, 3, … (gaps are fine but contiguous is easier to read).

**The five "diagnostic-routine" chips** (Brake Inspection, Check Battery, Warning Lights, Check Suspension, Check A/C) live on this routine list BUT route through the diagnostic flow (`requires_explanation=true`). When the customer picks one, the wizard asks them to describe the concern, the LLM gap-detects against the matching `concern_categories` checklist, and the wizard asks clarifying questions. Don't move these to testing-services unless you also want them to charge a starting price.
