# Testing Services

<!--
Each `## service_key` block is one diagnostic/testing service the diagnostic LLM
can recommend from the customer's free-text concern. Edit fields inline + re-upload
via Claude Desktop. The orchestrator always shows a diff for advisor approval before
applying — bulk uploads are dry-run by default.

Required fields per service: Display name, Abbreviation, Starting price, Concern categories, Active.
Optional: Notes (advisor-side), Description (customer-facing), Example keywords (LLM routing hints).

Price format: "$XX.XX" or "Free". Description: 1-2 customer-facing sentences (10-500 chars).
Concern categories: comma-separated from the 14 canonical slugs:
  noise, vibration, pulling, smell, smoke, leak, warning_light, performance,
  electrical, hvac, brakes, steering, tires, other
Active: true/false. Soft-delete a service by setting Active: false (preserves history).

To remove a service from the catalog entirely: delete its `## service_key` block AND
re-upload — the parser will soft-delete any DB rows missing from the file.
-->

## alternator_testing
Display name: Alternator testing (simple electrical)
Abbreviation: ALT TESTING
Starting price: $89.95
Notes: Starting price
Description: Tests alternator output under load and inspects related electrical components.
Example keywords: (none)
Concern categories: electrical, warning_light
Active: true

## battery_test
Display name: Battery test
Abbreviation: BATT TEST
Starting price: Free
Notes: Free
Description: A complete electrical-system test: battery health, alternator output, starter draw. Free of charge.
Example keywords: (none)
Concern categories: electrical, warning_light
Active: true

## brake_inspection
Display name: Brake inspection
Abbreviation: BRAKE INSPECT
Starting price: $39.99
Notes: Waived if brake repair is approved
Description: We measure pad thickness, inspect rotors and calipers, check brake fluid condition, and recommend any needed work. Waived if you approve any recommended repairs.
Example keywords: (none)
Concern categories: brakes, noise, pulling
Active: true

## check_ac
Display name: A/C performance check
Abbreviation: AC CHECK
Starting price: $89.95
Notes: Waived if a repair or more testing is needed and approved
Description: Our technician will run the A/C system through a performance check — pressure on both the high and low sides, condenser airflow, blend-door operation, refrigerant level, and compressor cycling. We'll identify whether it's low refrigerant, a compressor or clutch issue, a blend-door failure, or a condenser problem, and quote any needed work. Fee waived if you approve any recommended repair or further testing.
Example keywords: (none)
Concern categories: hvac
Active: true

## coolant_leak_testing
Display name: Coolant leak / overheating testing
Abbreviation: COOL LEAK TEST
Starting price: $109.95
Notes: Includes coolant
Description: Pressure-test the cooling system, find the leak source, and check related components. Includes top-off coolant.
Example keywords: (none)
Concern categories: leak, smoke, smell, performance
Active: true

## coolant_leak_testing_euro
Display name: Coolant leak / overheating testing — Euro vehicle
Abbreviation: EURO COOL LEAK TEST
Starting price: $199.95
Notes: Includes coolant
Description: Same as standard coolant leak testing but covers European vehicles which have more complex cooling systems and require specialized coolant.
Example keywords: (none)
Concern categories: leak, smoke, smell, performance
Active: true

## electrical_testing_general
Display name: Electrical system testing (non-alternator/battery)
Abbreviation: ELEC TESTING
Starting price: $179.99
Notes: Starting price
Description: A general electrical-system diagnostic. We'll trace the issue and explain what we found.
Example keywords: (none)
Concern categories: electrical
Active: true

## no_start_testing
Display name: No-start testing
Abbreviation: NO START TEST
Starting price: $179.95
Notes: Starting price
Description: We'll diagnose why your vehicle won't start — battery, starter, ignition, fuel, or electrical — and give you an estimate.
Example keywords: (none)
Concern categories: performance, electrical
Active: true

## oil_leak_testing
Display name: Oil leak testing
Abbreviation: OIL LEAK TEST
Starting price: $179.95
Notes: Starting price
Description: We pressurize the engine, use dye or UV light if needed, and identify the exact source of the leak.
Example keywords: (none)
Concern categories: leak, smell, smoke
Active: true

## suspension_check
Display name: Suspension check
Abbreviation: SUSP CHECK
Starting price: $89.95
Notes: Starting price
Description: A hands-on inspection of struts, bushings, ball joints, and CV components for play or wear. Free unless we recommend any repairs.
Example keywords: (none)
Concern categories: noise, steering
Active: true

## tpms_testing
Display name: Tire pressure (TPMS) light testing
Abbreviation: TPMS TESTING
Starting price: $54.95
Notes: Starting price
Description: We'll inspect the tire pressure sensors, check tire pressures, and identify which sensor (if any) is faulty.
Example keywords: (none)
Concern categories: warning_light, tires
Active: true

## transmission_testing
Display name: Transmission issues testing
Abbreviation: TRANS TESTING
Starting price: $179.95
Notes: Starting price
Description: We'll road-test the vehicle, scan for transmission codes, and inspect transmission fluid for any signs of internal issues.
Example keywords: (none)
Concern categories: performance
Active: true

## warning_light_general
Display name: Warning light testing (non-TPMS)
Abbreviation: CEL TESTING
Starting price: $179.99
Notes: Starting price; further diagnostic may be needed
Description: Our technician will hook up a scanner, read the diagnostic codes, and explain what they mean. We'll give you an estimate for any needed repairs.
Example keywords: (none)
Concern categories: warning_light, performance
Active: true

## window_inop_testing
Display name: Window inoperative testing
Abbreviation: WIN INOP TEST
Starting price: $125.95
Notes: Includes tear down
Description: Diagnose why your window isn't working — switch, motor, regulator, or wiring. Includes tear-down for inspection.
Example keywords: (none)
Concern categories: electrical, other
Active: true

## windshield_inop_testing
Display name: Windshield inoperative testing
Abbreviation: WSHIELD INOP TEST
Starting price: $179.95
Notes: Starting price
Description: Diagnose windshield-related electrical issues (wipers, washer, rain sensor, HUD).
Example keywords: (none)
Concern categories: electrical, other
Active: true
