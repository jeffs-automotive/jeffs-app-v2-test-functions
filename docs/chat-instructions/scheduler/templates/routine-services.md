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
Requires explanation: true
Concern categories: (none)
Starting price: $149.95
Price waived note: (none)
Description: The technician will place the vehicle on an alignment rack and attach sensors to each wheel. Using computerized equipment, the camber, caster, and toe angles will be measured and adjusted to manufacturer specifications. Once complete, the steering wheel position and vehicle handling will be verified with a road test to ensure proper alignment.

Technician will start with an alignemnt check ($59.95). If alignemtn is needed Technician will continue with alignemnt. This price does not include European or EV vehicles.
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
Description: The technician will inspect the brake pads, rotors, and calipers for wear and proper operation, and check brake lines, hoses, and fluid level for leaks or damage. The system will be evaluated to ensure safe, reliable braking performance.
Active: true

## check_ac
Display name: Check A/C
Abbreviation: AC CHECK
Display order: 10
Wait eligible: false
Requires explanation: true
Concern categories: hvac
Starting price: $59.95
Price waived note: Fee waived if a repair or more testing is needed and approved
Description: The technician will check A/C performance by measuring vent temperature and verifying blower, mode, and cooling fan operation, checking system pressures if needed. They will also inspect for leaks and check related belts and pulleys.
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
Description: The technician will test the battery for voltage, cold cranking amps, and overall condition using a diagnostic tester. The results will determine the battery’s health and whether it’s performing properly or nearing replacement.
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
Description: The technician will inspect the steering and suspension components for wear, damage, looseness, and leaks, including joints, tie rods, control arms, bushings, and shocks/struts. Tires will be checked for uneven wear and a road test may be performed to verify ride quality, steering response, and handling.
Active: true

## oil_change
Display name: Oil Change
Abbreviation: LOF
Display order: 2
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: 
Price waived note: (none)
Description: The technician will change the engine oil and oil filter, lubricate components as needed, and inspect all applicable fluid levels and condition. Tire condition and pressures will be checked and adjusted if necessary, along with inspection of belts, hoses, and recommended maintenance items.
Active: true

## rotate_balance_tires
Display name: Rotate and Balance Front Tires
Abbreviation: ROT BAL
Display order: 4
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: $79.95
Price waived note: (none)
Description: Remove all four wheel/tire assemblies from the vehicle and computer spin balance the tires being placed on the front axle (Includes Road-Force check up). Reinstall all four tire & wheel assemblies. Road test (OK).
Active: true

## state_inspection_emissions
Display name: State Inspection and Emissions
Abbreviation: SI IM
Display order: 1
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: $83.57
Price waived note: (none)
Description: Pennsylvania Annual State Inspection and Emissions Testing
Active: true

## tire_rotation
Display name: Tire Rotation
Abbreviation: ROT
Display order: 3
Wait eligible: true
Requires explanation: false
Concern categories: (none)
Starting price: $34.95
Price waived note: Free with State Inspection and 5-pack
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
Description: Please provide a detailed explanation on the next screen or use the describe issue below.
Active: true
