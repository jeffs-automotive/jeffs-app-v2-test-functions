# CROSS-PROVIDER eval — google/gemini-3.1-flash-lite — 2026-07-03T00:51:26

Same prompts/schemas/validation/mapper/graders as the Haiku 4.5 baseline; transport = AI SDK
generateObject via Vercel AI Gateway (structured outputs translated per provider). 145 cases,
concurrency 6, wall 89s. Tokens: in 1107826 / out 17792.

| Metric | google/gemini-3.1-flash-lite | Haiku 4.5 baseline |
|---|---|---|
| Stage-1 accuracy | 95.2% (138/145) | 89.0% |
| Stage-1 macro-F1 | 0.949 | 0.886 |
| Stage-2 accuracy (S1-correct) | 96.6% (112/116) | 98.1% |
| Stage-3 slot precision (vs as-authored labels) | 1.000 (tp 0 / fp 0) | 0.434 |
| Stage-3 recall | 1.000 | 0.954 |
| Confident misroutes (zero questions) | 0 | 0 |
| Landings | correct:134 · handoff:6 · over_ask:5 · confident_misroute_no_questions:0 | correct:127 · handoff:12 · over_ask:6 |
| p50 / p95 chain latency | 3869ms / 4915ms | 6986ms / 8888ms |
| Stage-1 parse failures | 0 | 0 |

## Stage-1 mismatches

- ac_leak_testing-006: expected ac_leak_testing → got coolant_leak_testing
- ac_leak_testing-005: expected ac_leak_testing → got ac_performance_check
- brake_inspection_warning_light-003: expected brake_inspection_warning_light → got abs_traction_stability_testing
- check_engine_light_testing-005: expected check_engine_light_testing → got oil_leak_testing
- transmission_testing-002: expected transmission_testing → got coolant_leak_testing
- other-postservice-1: expected after_recent_service_or_repair_work → got null
- other-accident-2: expected after_a_recent_accident_or_impact → got suspension_steering_check
