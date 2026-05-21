# Testing Services

<!--
Each `## service_key` block is one diagnostic/testing service the diagnostic LLM
can recommend from the customer's free-text concern. Edit fields inline + re-upload
via Claude Desktop. The orchestrator always shows a diff for advisor approval before
applying — bulk uploads are dry-run by default.

Required fields per service: Display name, Abbreviation, Starting price, Concern categories, Active.
Optional: Notes (advisor-side), Description (technician-procedural; what gets tested), Example keywords (LLM routing hints).

Price format: "$XX.XX" or "Free". Description: 1-2 procedural sentences (10-500 chars) — what the technician inspects/tests, NOT customer marketing copy.
Concern categories: comma-separated from the 14 canonical slugs:
  noise, vibration, pulling, smell, smoke, leak, warning_light, performance,
  electrical, hvac, brakes, steering, tires, other
Active: true/false. Soft-delete a service by setting Active: false (preserves history).

To remove a service from the catalog entirely: delete its `## service_key` block AND
re-upload — the parser will soft-delete any DB rows missing from the file.

Last refactored 2026-05-19 — sourced from docs/chat-instructions/diagnostic-descriptions.md
(now deleted). 3 services deprecated, 10 added, all descriptions rewritten in
technician-procedural voice. Catalog now covers each warning_light subcategory
with a dedicated testing_service so the diagnostic LLM can route by light type.
-->

## abs_traction_stability_testing
Display name: ABS / traction / stability light testing
Abbreviation: ABS TRAC STAB TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will scan the vehicle for ABS/traction/stability trouble codes and inspect related sensors, wiring, and components to pinpoint the fault. A road test may be performed to verify system operation and confirm the cause of the warning light(s).
Example keywords: (none)
Concern categories: warning_light, brakes
Active: true

## ac_leak_testing
Display name: A/C leak testing
Abbreviation: AC LEAK TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will connect A/C service equipment to the system and check pressures to verify if refrigerant levels are low, which may indicate a leak. A visual inspection will be performed on hoses, fittings, the condenser, evaporator, and compressor for signs of oil or dye residue. If needed, an electronic leak detector or UV dye with a black light will be used to pinpoint the exact source.
Example keywords: (none)
Concern categories: hvac, leak
Active: true

## ac_performance_check
Display name: A/C performance check
Abbreviation: AC PERF CHECK
Starting price: $54.95
Notes: A/C performance test is $54.95. Fee is waived if an evac and recharge or a/c system leak testing is needed.
Description: The technician will check A/C performance by measuring vent temperature and verifying blower, mode, and cooling fan operation, checking system pressures if needed. They will also inspect for leaks and check related belts and pulleys.
Example keywords: (none)
Concern categories: hvac
Active: true

## airbag_srs_testing
Display name: Airbag / SRS light testing
Abbreviation: AIRBAG SRS TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: Technician will check for diagnostic trouble codes, inspect wiring harnesses and yellow connectors related to the Supplemental Restraint System (SRS), inspect seat belt buckles and impact sensors for physical damage, and perform electrical resistance and circuit continuity testing.
Example keywords: (none)
Concern categories: warning_light, electrical
Active: true

## alternator_testing
Display name: Alternator testing (DEPRECATED)
Abbreviation: ALT TESTING
Starting price: $89.95
Notes: DEPRECATED 2026-05-19 — replaced by charging_starting_testing (broader scope: battery + alternator + starter + parasitic draw). Kept as inactive for past-appointment reference integrity.
Description: Tests alternator output under load and inspects related electrical components.
Example keywords: (none)
Concern categories: electrical, warning_light
Active: false

## awd_4x4_testing
Display name: AWD / 4WD system testing
Abbreviation: AWD 4X4 TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will inspect and test the 4X4/AWD/4WD system for proper engagement, checking key components and verifying related electronic controls and fluid levels as needed. A road test will then be performed to confirm smooth operation, proper power distribution, and no abnormal noises or vibrations.
Example keywords: (none)
Concern categories: performance, electrical, warning_light
Active: true

## battery_test
Display name: Battery test
Abbreviation: BATT TEST
Starting price: Free
Notes: No Charge
Description: The technician will test the battery for voltage, cold cranking amps, and overall condition using a diagnostic tester. The results will determine the battery's health and whether it's performing properly or nearing replacement.
Example keywords: (none)
Concern categories: electrical, warning_light
Active: true

## brake_inspection
Display name: Brake inspection
Abbreviation: BRAKE INSPECT
Starting price: $39.99
Notes: Brake inspection is $39.99. If a brake repair is needed and approved, brake inspection fee is waived.
Description: The technician will inspect the brake pads, rotors, and calipers for wear and proper operation, and check brake lines, hoses, and fluid level for leaks or damage. The system will be evaluated to ensure safe, reliable braking performance.
Example keywords: (none)
Concern categories: brakes, noise
Active: true

## brake_inspection_warning_light
Display name: Brake inspection with Warning Light
Abbreviation: BRAKE INSPECT
Starting price: $89.95
Notes: (none)
Description: The technician will inspect the brake pads, rotors, and calipers for wear and proper operation, and check brake lines, hoses, and fluid level for leaks or damage. The system will be evaluated to ensure safe, reliable braking performance.
Example keywords: Red brake light on
Concern categories: brakes, noise, warning_light
Active: true

## charging_starting_testing
Display name: Charging + starting system testing
Abbreviation: CHRG START TEST
Starting price: $89.95
Notes: Testing starts at $89.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will inspect the battery terminals and cables, then perform a battery load test to check overall condition. They'll also test alternator output, starter draw, and parasitic draw, and scan for related trouble codes to complete the diagnosis.
Example keywords: (none)
Concern categories: electrical, warning_light, performance
Active: true

## check_ac
Display name: A/C check (DEPRECATED)
Abbreviation: AC CHECK
Starting price: $89.95
Notes: DEPRECATED 2026-05-19 — split into ac_performance_check ($54.95, performance only) and ac_leak_testing ($179.95, leak diagnosis). Kept as inactive for past-appointment reference integrity.
Description: Performance check + leak check of the A/C system. (Original bundled service; now split into two discrete services.)
Example keywords: (none)
Concern categories: hvac
Active: false

## check_engine_light_testing
Display name: Check Engine Light testing
Abbreviation: CEL TESTING
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will scan the vehicle for stored check engine trouble codes, document the results, and monitor live data to verify sensor readings and system performance. They will also review applicable TSBs to check for known issues or manufacturer updates related to the codes.
Example keywords: (none)
Concern categories: warning_light, performance
Active: true

## coolant_leak_testing
Display name: Coolant leak / overheating testing
Abbreviation: COOL LEAK TEST
Starting price: $109.95
Notes: Testing starts at $109.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will inspect the cooling system and perform a pressure test to check for external leaks at hoses, clamps, radiator, water pump, and related components. They'll also verify fan operation, thermostat function, and coolant circulation, and may perform a block test to check for internal engine issues.
Example keywords: (none)
Concern categories: leak, smoke, smell, performance, warning_light
Active: true

## coolant_leak_testing_euro
Display name: Coolant leak / overheating testing — Euro vehicle
Abbreviation: EURO COOL LEAK TEST
Starting price: $199.95
Notes: Testing starts at $199.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will inspect the cooling system and perform a pressure test to check for external leaks at hoses, clamps, radiator, water pump, and related components. They'll also verify fan operation, thermostat function, and coolant circulation, and may perform a block test to check for internal engine issues.
Example keywords: (none)
Concern categories: leak, smoke, smell, performance, warning_light
Active: true

## electrical_testing_general
Display name: Electrical system testing (general)
Abbreviation: ELEC TESTING
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will review wiring diagrams and inspect all related wiring, connectors, and harnesses for damage, corrosion, or loose connections. They will then use diagnostic tools to test voltage, ground, and continuity, and check fuses, relays, and related components to pinpoint the fault.
Example keywords: (none)
Concern categories: electrical
Active: true

## no_start_testing
Display name: No-start testing
Abbreviation: NO START TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will verify the concern and confirm the engine is cranking properly by checking battery voltage and starter operation. They will then test fuel pressure and injector pulse, check for spark, scan for trouble codes, and review live data (including crank and cam sensor signals) to pinpoint the cause of the no-start condition.
Example keywords: (none)
Concern categories: performance, electrical
Active: true

## oil_leak_testing
Display name: Oil leak testing
Abbreviation: OIL LEAK TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will inspect the engine and surrounding components for oil leaks, focusing on common areas like valve covers, gaskets, seals, and the oil pan. The vehicle will be brought to operating temperature and the underside/splash shields will be rechecked for fresh oil residue or buildup.
Example keywords: (none)
Concern categories: leak, smell, smoke
Active: true

## oil_pressure_light_testing
Display name: Oil pressure light testing
Abbreviation: OIL PRESS LT TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue. Mechanical oil pressure test may incur additional cost depending on sensor location.
Description: Technician will verify the engine oil level and inspect the vehicle for external leaks or abnormal engine noises, check for trouble codes, inspect wiring and sensors related to the system and perform a mechanical oil pressure test (oil pressure test may incur additional testing depending on the location of the oil pressure sensor).
Example keywords: (none)
Concern categories: warning_light, leak, performance
Active: true

## power_steering_eps_testing
Display name: Power steering / EPS testing
Abbreviation: PWR STEER EPS TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: Technician will check power steering fluid level (if applicable) and inspect for external leaks or abnormal steering noises, check for diagnostic trouble codes, inspect wiring and sensors related to the Electric Power Steering (EPS) system, and perform an electrical voltage, ground, and communication network test.
Example keywords: (none)
Concern categories: warning_light, steering, electrical
Active: true

## suspension_check
Display name: Suspension check (DEPRECATED)
Abbreviation: SUSP CHECK
Starting price: $89.95
Notes: DEPRECATED 2026-05-19 — renamed to suspension_steering_check (broader scope: steering components + tire wear + road test). Kept as inactive for past-appointment reference integrity.
Description: A hands-on inspection of struts, bushings, ball joints, and CV components for play or wear.
Example keywords: (none)
Concern categories: noise, steering
Active: false

## suspension_steering_check
Display name: Suspension + steering check
Abbreviation: SUSP STEER CHECK
Starting price: $89.95
Notes: Testing starts at $89.95. If additional testing is needed you will be contacted before we continue.
Description: The technician will inspect the steering and suspension components for wear, damage, looseness, and leaks, including joints, tie rods, control arms, bushings, and shocks/struts. Tires will be checked for uneven wear and a road test may be performed to verify ride quality, steering response, and handling.
Example keywords: (none)
Concern categories: noise, steering, pulling, vibration
Active: true

## tpms_testing
Display name: Tire pressure (TPMS) light testing
Abbreviation: TPMS TESTING
Starting price: $39.99
Notes: Testing starts at $39.99. If additional testing is needed you will be contacted before we continue.
Description: The technician will verify the TPMS warning light and check tire pressures against specifications. A TPMS scan tool will be used to communicate with each sensor, confirming battery status, pressure readings, and signal strength. If any faults are found, the technician will document the issue and recommend sensor replacement, reprogramming, or further repairs as needed.
Example keywords: (none)
Concern categories: warning_light, tires
Active: true

## transmission_testing
Display name: Transmission issues testing
Abbreviation: TRANS TESTING
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: Road test (if possible) to inspect for drivability/shift concerns. Inspect transmission fluid level and condition. Visual inspection of external transmission controls. Scan computer system for transmission-related faults. Review wiring diagrams and inspect related wires, leads, relays, and circuits.
Example keywords: (none)
Concern categories: performance
Active: true

## warning_light_general
Display name: Warning light testing (general / unspecified light)
Abbreviation: WARN LT GEN
Starting price: $179.95
Notes: Testing starts at $179.95. Use only when the specific light isn't identified — most warning lights now route to a dedicated testing_service (check_engine_light_testing, abs_traction_stability_testing, charging_starting_testing, oil_pressure_light_testing, airbag_srs_testing, power_steering_eps_testing, tpms_testing, coolant_leak_testing for engine temperature, brake_inspection for brake-system red light). If additional testing is needed you will be contacted before we continue.
Description: The technician will scan the vehicle for stored trouble codes, document the results, and monitor live data to verify sensor readings and system performance. They will also review applicable TSBs to check for known issues or manufacturer updates related to the codes.
Example keywords: (none)
Concern categories: warning_light, performance
Active: true

## window_inop_testing
Display name: Window inoperative testing
Abbreviation: WIN INOP TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue. Includes tear-down for inspection.
Description: Window diagnosis: switch, motor, regulator, or wiring. Includes tear-down for inspection.
Example keywords: (none)
Concern categories: electrical, other
Active: true

## windshield_inop_testing
Display name: Windshield inoperative testing
Abbreviation: WSHIELD INOP TEST
Starting price: $179.95
Notes: Testing starts at $179.95. If additional testing is needed you will be contacted before we continue.
Description: Check to verify poor wiper operation. Check for proper installation of the wiper arms where they attach to the wiper pivot portion of the transmission and make sure the securing nut is tightened to spec. Disassemble a portion of the windshield wiper cowl to inspect condition of the wiper transmission assembly.
Example keywords: (none)
Concern categories: electrical, other
Active: true
