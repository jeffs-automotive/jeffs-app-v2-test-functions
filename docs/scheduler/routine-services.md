# Routine Services

<!--
Each `## service_key` block is one chip on the Step 7 picker. Edit fields inline +
re-upload via Claude Desktop. The orchestrator always shows a diff for advisor approval
before applying — bulk uploads are dry-run by default.

Required: Display name, Abbreviation, Display order, Wait eligible, Requires explanation, Active.
Optional: Concern categories (only meaningful when Requires explanation: true), Starting price,
Price waived note, Description (customer-facing 1-2 sentence chip caption).

Wait eligible: true if customer can wait in lobby (oil change, tire rotate, etc.). false = drop-off only.
Requires explanation: true if picking this chip kicks off the concern-explanation diagnostic flow.
  Currently true for the 5 diagnostic-routine chips: Brake Inspection, Check Battery,
  Warning Lights, Check Suspension, Check A/C. Each must have a Concern categories list.
Display order: integer; lower = shown first.
Starting price: "$XX.XX" / "Free" / "(none)" (omit to render no price).
Price waived note: short customer-facing caveat under the price (e.g. "Fee waived if a repair or more testing is needed and approved").
-->

## alignment
Display name: Alignment
Abbreviation: ALIGN
Display order: 5
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: $109.95
Price waived note: (none)
Description: (none)
Active: true

## brake_inspection
Display name: Brake Inspection
Abbreviation: BRAKE INSPECT
Display order: 6
Wait eligible: false
Requires explanation: true
Concern categories: brakes
Starting price: $39.99
Price waived note: Fee waived if a repair or more testing is needed and approved
Description: (none)
Active: true

## check_ac
Display name: Check A/C
Abbreviation: AC CHECK
Display order: 10
Wait eligible: false
Requires explanation: true
Concern categories: hvac
Starting price: $89.95
Price waived note: Fee waived if a repair or more testing is needed and approved
Description: (none)
Active: true

## check_battery
Display name: Check Battery
Abbreviation: BATT CHECK
Display order: 7
Wait eligible: false
Requires explanation: true
Concern categories: electrical
Starting price: Free
Price waived note: (none)
Description: (none)
Active: true

## check_suspension
Display name: Check Suspension
Abbreviation: SUSP CHECK
Display order: 9
Wait eligible: false
Requires explanation: true
Concern categories: steering
Starting price: $89.95
Price waived note: (none)
Description: (none)
Active: true

## oil_change
Display name: Oil Change
Abbreviation: LOF
Display order: 2
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: $59.95
Price waived note: (none)
Description: (none)
Active: true

## rotate_balance_tires
Display name: Rotate and Balance Tires
Abbreviation: ROT BAL
Display order: 4
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: $79.95
Price waived note: (none)
Description: (none)
Active: true

## state_inspection_emissions
Display name: State Inspection and Emissions
Abbreviation: SI IM
Display order: 1
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: $79.95
Price waived note: (none)
Description: (none)
Active: true

## tire_rotation
Display name: Tire Rotation
Abbreviation: ROT
Display order: 3
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: $29.95
Price waived note: (none)
Description: (none)
Active: true

## warning_lights
Display name: Warning Lights
Abbreviation: WARN LIGHT
Display order: 8
Wait eligible: false
Requires explanation: true
Concern categories: warning_light
Starting price: $179.99
Price waived note: (none)
Description: (none)
Active: true
