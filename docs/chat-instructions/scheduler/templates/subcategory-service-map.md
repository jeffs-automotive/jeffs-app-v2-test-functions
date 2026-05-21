# Subcategory → Testing Service Mappings

<!--
Each row maps one (concern_category, subcategory_slug) pair to a
comma-separated list of testing_service_keys it's eligible under.
Edit cells inline + re-upload via Claude Desktop. The orchestrator
always shows a diff for advisor approval before applying — bulk uploads
are dry-run by default.

When the testing_service_keys cell is NON-EMPTY, the diagnostic LLM
routes ONLY to the listed services for that subcategory
(testing_services.concern_categories[] is IGNORED for this subcategory).

When the cell is BLANK or "(none)", the subcategory falls back to the
current concern_categories[]-based fan-out (this is the legacy behavior
— eligible under every testing_service whose concern_categories[]
contains this subcategory's parent category).

Rows OMITTED from this file entirely are LEFT ALONE — uploads never
silently clear mappings. To clear an existing mapping, list the row
with a blank cell.

Required columns: category, subcategory_slug, testing_service_keys.

Validation:
  - category must be one of the 14 canonical concern category slugs:
    noise, vibration, pulling, smell, smoke, leak, warning_light,
    performance, electrical, hvac, brakes, steering, tires, other
  - subcategory_slug + category must exist in concern_subcategories
    (the parser cross-checks the (category, slug) natural key against
    the current concern_subcategories table)
  - each testing_service_key must exist in testing_services AND be
    active (the parser cross-checks against testing_services)
  - duplicate (category, subcategory_slug) in the SAME upload is blocked

This MD does NOT create / modify / delete concern_subcategories or
testing_services themselves — only the eligible_testing_service_keys
column on concern_subcategories. Use:
  - testing-services.md  → for testing_service catalog edits
  - concern category MD  → for subcategory + question edits

Initial mapping authored 2026-05-20 — covers the 12 warning_light
subcategories that now route to specific testing services post-
2026-05-19 catalog refactor (CEL / ABS / traction / SES / SRS / EPS /
oil-pressure / engine-temp light each get a dedicated diagnostic).
-->

| category | subcategory_slug | testing_service_keys |
| --- | --- | --- |
| warning_light | check_engine_light | check_engine_light_testing |
| warning_light | service_engine_soon_or_maintenance_required_light | check_engine_light_testing |
| warning_light | battery_charging_light | charging_starting_testing |
| warning_light | oil_pressure_light | oil_pressure_light_testing |
| warning_light | engine_temperature_light | coolant_leak_testing, check_engine_light_testing |
| warning_light | tpms_tire_pressure_light | tpms_testing |
| warning_light | abs_anti_lock_brake_light | abs_traction_stability_testing |
| warning_light | brake_system_red_light | brake_inspection_warning_light |
| warning_light | airbag_srs_light | airbag_srs_testing |
| warning_light | traction_control_stability_light | abs_traction_stability_testing |
| warning_light | power_steering_eps_light | power_steering_eps_testing |
| warning_light | multiple_warning_lights_at_once | warning_light_general |
