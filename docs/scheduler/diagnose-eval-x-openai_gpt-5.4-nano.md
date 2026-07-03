# CROSS-PROVIDER eval — openai/gpt-5.4-nano — 2026-07-03T00:48:30

Same prompts/schemas/validation/mapper/graders as the Haiku 4.5 baseline; transport = AI SDK
generateObject via Vercel AI Gateway (structured outputs translated per provider). 145 cases,
concurrency 6, wall 87s. Tokens: in 1868101 / out 39442.

| Metric | openai/gpt-5.4-nano | Haiku 4.5 baseline |
|---|---|---|
| Stage-1 accuracy | 80.7% (117/145) | 89.0% |
| Stage-1 macro-F1 | 0.781 | 0.886 |
| Stage-2 accuracy (S1-correct) | 95.0% (96/101) | 98.1% |
| Stage-3 slot precision (vs as-authored labels) | 0.706 (tp 207 / fp 86) | 0.434 |
| Stage-3 recall | 0.908 | 0.954 |
| Confident misroutes (zero questions) | 2 | 0 |
| Landings | correct:108 · handoff:29 · over_ask:6 · confident_misroute_no_questions:2 | correct:127 · handoff:12 · over_ask:6 |
| p50 / p95 chain latency | 4146ms / 5837ms | 6986ms / 8888ms |
| Stage-1 parse failures | 0 | 0 |

## Stage-1 mismatches

- ac_leak_testing-006: expected ac_leak_testing → got null
- ac_leak_testing-005: expected ac_leak_testing → got null
- ac_performance_check-007: expected ac_performance_check → got null
- abs_traction_stability_testing-002: expected abs_traction_stability_testing → got multiple_symptoms_not_sure_what_category
- airbag_srs_testing-001: expected airbag_srs_testing → got after_a_recent_accident_or_impact
- abs_traction_stability_testing-004: expected abs_traction_stability_testing → got warning_light_general
- battery_test-003: expected battery_test → got car_has_been_sitting_unused_for_a_long_time
- brake_inspection-008: expected brake_inspection → got brake_inspection_warning_light
- brake_inspection_warning_light-003: expected brake_inspection_warning_light → got abs_traction_stability_testing
- charging_starting_testing-002: expected charging_starting_testing → got no_start_testing
- charging_starting_testing-005: expected charging_starting_testing → got electrical_testing_general
- check_engine_light_testing-006: expected check_engine_light_testing → got no_start_testing
- electrical_testing_general-006: expected electrical_testing_general → got null
- oil_leak_testing-005: expected oil_leak_testing → got check_engine_light_testing
- power_steering_eps_testing-001: expected power_steering_eps_testing → got null
- transmission_testing-002: expected transmission_testing → got null
- transmission_testing-004: expected transmission_testing → got multiple_symptoms_not_sure_what_category
- warning_light_general-004: expected warning_light_general → got multiple_symptoms_not_sure_what_category
- windshield_inop_testing-002: expected windshield_inop_testing → got window_inop_testing
- other-sitting-1: expected car_has_been_sitting_unused_for_a_long_time → got general_check_up_or_pre_trip_inspection
- other-sitting-2: expected car_has_been_sitting_unused_for_a_long_time → got general_check_up_or_pre_trip_inspection
- null-07-hours-question: expected null → got general_check_up_or_pre_trip_inspection
- null-09-hiring-inquiry: expected null → got general_check_up_or_pre_trip_inspection
- null-10-loaner-question: expected null → got general_check_up_or_pre_trip_inspection
- null-12-offtopic-referral: expected null → got multiple_symptoms_not_sure_what_category
- null-11-reschedule-request: expected null → got general_check_up_or_pre_trip_inspection
- other-accident-2: expected after_a_recent_accident_or_impact → got suspension_steering_check
- nearmiss-009: expected warning_light_general → got multiple_symptoms_not_sure_what_category
