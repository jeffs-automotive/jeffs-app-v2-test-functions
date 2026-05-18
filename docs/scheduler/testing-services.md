# Testing Services

<!-- service_key: canonical lowercase + underscore identifier (e.g. "brake_inspection"). Stable across uploads. -->
<!-- display_name: customer-facing name shown on the picker chip. -->
<!-- abbreviation: shop-shorthand used in Tekmetric appointment title. -->
<!-- starting_price_cents: integer cents (4500 = $45.00). Use 0 for free services. -->
<!-- notes: short side-note shown to advisors / on internal views (NOT to the customer). -->
<!-- concern_categories: comma-separated, ONLY from the 14 valid slugs (noise, vibration, pulling, smell, smoke, leak, warning_light, performance, electrical, hvac, brakes, steering, tires, other). -->
<!-- active: true to show on the picker, false to soft-delete. -->

| service_key | display_name | abbreviation | starting_price_cents | notes | concern_categories | active |
|-------------|--------------|--------------|----------------------|-------|--------------------|--------|
| alternator_testing | Alternator testing (simple electrical) | ALT TESTING | 8995 | Starting price | electrical, warning_light | true |
| battery_test | Battery test | BATT TEST | 0 | Free | electrical, warning_light | true |
| brake_inspection | Brake inspection | BRAKE INSPECT | 3999 | Waived if brake repair is approved | brakes, noise, pulling | true |
| check_ac | A/C performance check | AC CHECK | 8995 | Waived if a repair or more testing is needed and approved | hvac | true |
| coolant_leak_testing | Coolant leak / overheating testing | COOL LEAK TEST | 10995 | Includes coolant | leak, smoke, smell, performance | true |
| coolant_leak_testing_euro | Coolant leak / overheating testing — Euro vehicle | EURO COOL LEAK TEST | 19995 | Includes coolant | leak, smoke, smell, performance | true |
| electrical_testing_general | Electrical system testing (non-alternator/battery) | ELEC TESTING | 17999 | Starting price | electrical | true |
| no_start_testing | No-start testing | NO START TEST | 17995 | Starting price | performance, electrical | true |
| oil_leak_testing | Oil leak testing | OIL LEAK TEST | 17995 | Starting price | leak, smell, smoke | true |
| suspension_check | Suspension check | SUSP CHECK | 8995 | Starting price | noise, steering | true |
| tpms_testing | Tire pressure (TPMS) light testing | TPMS TESTING | 5495 | Starting price | warning_light, tires | true |
| transmission_testing | Transmission issues testing | TRANS TESTING | 17995 | Starting price | performance | true |
| warning_light_general | Warning light testing (non-TPMS) | CEL TESTING | 17999 | Starting price; further diagnostic may be needed | warning_light, performance | true |
| window_inop_testing | Window inoperative testing | WIN INOP TEST | 12595 | Includes tear down | electrical, other | true |
| windshield_inop_testing | Windshield inoperative testing | WSHIELD INOP TEST | 17995 | Starting price | electrical, other | true |

---

## How to update

**Whole-table replace** (advisor edits multiple rows): ask Claude to upload this file via `upload_testing_services_md`. Bulk re-upload is diff-based — rows present here are upserted; rows in the DB but missing from this file are soft-deleted (active=false).

**Single-field tweak** (e.g. "change brake_inspection price to $45"): ask Claude directly:

> "Set brake_inspection price to $45."

Claude calls `patch_testing_service_fields` and only that one field changes.

**Notes & descriptions**: `notes` is the advisor-side comment (rendered on internal views). The customer-facing `description` and the LLM-routing `example_keywords` fields exist on the row but aren't in this MD table format — edit those via `patch_testing_service_fields` directly.

**Pricing convention**: `starting_price_cents` is an INTEGER number of cents. `4500` = $45.00, `19995` = $199.95. Never use decimals here.
