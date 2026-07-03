# CROSS-PROVIDER eval — openai/gpt-5.4-mini — 2026-07-03T00:49:57

Same prompts/schemas/validation/mapper/graders as the Haiku 4.5 baseline; transport = AI SDK
generateObject via Vercel AI Gateway (structured outputs translated per provider). 145 cases,
concurrency 6, wall 86s. Tokens: in 1938531 / out 40448.

| Metric | openai/gpt-5.4-mini | Haiku 4.5 baseline |
|---|---|---|
| Stage-1 accuracy | 93.8% (136/145) | 89.0% |
| Stage-1 macro-F1 | 0.913 | 0.886 |
| Stage-2 accuracy (S1-correct) | 97.3% (110/113) | 98.1% |
| Stage-3 slot precision (vs as-authored labels) | 0.588 (tp 231 / fp 162) | 0.434 |
| Stage-3 recall | 0.955 | 0.954 |
| Confident misroutes (zero questions) | 1 | 0 |
| Landings | correct:131 · handoff:9 · over_ask:4 · confident_misroute_no_questions:1 | correct:127 · handoff:12 · over_ask:6 |
| p50 / p95 chain latency | 3781ms / 6000ms | 6986ms / 8888ms |
| Stage-1 parse failures | 0 | 0 |

## Stage-1 mismatches

- ac_leak_testing-005: expected ac_leak_testing → got null
- abs_traction_stability_testing-004: expected abs_traction_stability_testing → got warning_light_general
- charging_starting_testing-001: expected charging_starting_testing → got battery_test
- check_engine_light_testing-006: expected check_engine_light_testing → got transmission_testing
- check_engine_light_testing-005: expected check_engine_light_testing → got oil_leak_testing
- warning_light_general-004: expected warning_light_general → got multiple_symptoms_not_sure_what_category
- transmission_testing-002: expected transmission_testing → got coolant_leak_testing
- other-postservice-2: expected after_recent_service_or_repair_work → got charging_starting_testing
- nearmiss-009: expected warning_light_general → got multiple_symptoms_not_sure_what_category
