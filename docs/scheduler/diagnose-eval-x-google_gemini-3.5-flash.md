# CROSS-PROVIDER eval — google/gemini-3.5-flash — 2026-07-03T01:00:23

Same prompts/schemas/validation/mapper/graders as the Haiku 4.5 baseline; transport = AI SDK
generateObject via Vercel AI Gateway (structured outputs translated per provider). 145 cases,
concurrency 6, wall 152s. Tokens: in 1104541 / out 17898.

| Metric | google/gemini-3.5-flash | Haiku 4.5 baseline |
|---|---|---|
| Stage-1 accuracy | 95.2% (138/145) | 89.0% |
| Stage-1 macro-F1 | 0.966 | 0.886 |
| Stage-2 accuracy (S1-correct) | 99.1% (113/114) | 98.1% |
| Stage-3 slot precision (vs as-authored labels) | 1.000 (tp 0 / fp 0) | 0.434 |
| Stage-3 recall | 1.000 | 0.954 |
| Confident misroutes (zero questions) | 0 | 0 |
| Landings | correct:137 · handoff:7 · over_ask:1 · confident_misroute_no_questions:0 | correct:127 · handoff:12 · over_ask:6 |
| p50 / p95 chain latency | 6386ms / 9843ms | 6986ms / 8888ms |
| Stage-1 parse failures | 0 | 0 |

## Stage-1 mismatches

- ac_leak_testing-006: expected ac_leak_testing → got null
- ac_leak_testing-005: expected ac_leak_testing → got null
- brake_inspection_warning_light-003: expected brake_inspection_warning_light → got abs_traction_stability_testing
- no_start_testing-003: expected no_start_testing → got charging_starting_testing
- oil_leak_testing-006: expected oil_leak_testing → got null
- tpms_testing-001: expected tpms_testing → got null
- tpms_testing-002: expected tpms_testing → got null
