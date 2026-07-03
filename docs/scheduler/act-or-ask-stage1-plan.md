# act-or-ask Stage 1 — implementation plan (2026-07-03)

> Chris (2026-07-03): approved after the real-data eval (`act-or-ask-real-data-eval-2026-07-03.md`).
> Decisions: tire-repair catalog entry recommending the PATCH/PLUG job (advisors adjust on the RO);
> cascade question settled separately; "go".

## Why

Real-data evidence: candidates-then-clarify converts Stage-1 misroutes into one-tap questions or
advisor handoffs — flash-lite lands at 1-in-112 hard misroutes vs the 1-in-50 bar. The largest
remaining error class (physical tire problems) is a catalog gap, not a model failure.

## Locked decisions

1. **Stage-1 contract:** 0–3 RANKED category candidates (schema replaces single
   `matched_category_key`). 1 candidate → same flow as today. 2–3 → `concern_clarify` chip card.
   0 → advisor path. "None of these / not sure" chip → the SOFT advisor path (booking continues;
   same semantics as today's confidence-gate `advisor_handoff` → `second_routine_pass`).
2. **Instant tap:** when 2–3 candidates, Stages 2+3 are precomputed for EVERY candidate in
   parallel during `diagnostic_loading`; the tap resolves deterministically from persisted
   per-candidate results — no second spinner.
3. **Models:** S1+S2 default `google/gemini-3.1-flash-lite`; S3 default decided by the AO5
   re-baseline (haiku vs `openai/gpt-5.4-mini` after the literal-only prompt tightening).
   `DIAGNOSE_CONCERN_STAGE{N}_MODEL` env overrides stay authoritative.
4. **Transport:** hybrid switch by model prefix — `anthropic/*` keeps the existing
   Anthropic-SDK-at-gateway-baseURL path (structured outputs `output_config.format`, caching
   markers); all other prefixes go through `@ai-sdk/gateway` `createGateway` + `generateObject`
   (the path our eval validated with ~2,200 zero-parse-failure calls). Pre-flight: re-check
   vercel/ai #13460 #13355 #14342 relevance to `generateObject` (the avoided path was chosen when
   the file was Anthropic-only).
5. **Confidence gate rework:** Stage-1 "low"-confidence branch is REPLACED by the structural
   signal (candidate count); Stage-2/3 branches unchanged.
6. **Tire repair:** new `testing_services` row — `service_key 'tire_repair'`,
   display "Tire repair (patch & plug)", abbreviation `'TIRE RPR'`, `starting_price_cents 4768`
   (canned job 417342052 TIRE REPAIR WITH PATCH/PLUG), `concern_categories ARRAY['tires']`,
   description with `Scope:` + `NOT for` callouts (exhaust template). Explicit
   `eligible_testing_service_keys` append on existing tires subcategories
   `visible_damage_nail_screw_bulge_cut` + `tire_going_flat_losing_air`; boundary callouts added
   to `tpms_testing` + `suspension_steering_check` descriptions (guarded `NOT LIKE '%Scope:%'`).
   `low_pressure_warning_light_only` stays TPMS; wear/dry-rot/new-tires slugs stay as-is.

## File-by-file (anchors from the 3 research maps, in `artifacts.research`)

**DB (2 migrations):**
- `scheduler_tire_repair_service.sql` — insert + subcategory fan-out + sibling callouts.
- `scheduler_concern_clarify_column.sql` — `customer_chat_sessions.concern_clarify_candidates JSONB`
  + recreate `apply_wizard_transition` RPC with its CASE arm (allowlist).

**LLM layer (scheduler-app/src/lib/scheduler/wizard/):**
- `llm/diagnose-concern.ts` — `STAGE1_JSON_SCHEMA` → `{candidates: [{key, }] ranked, reasoning}`;
  `Stage1ResponseSchema`; `DiagnoseConcernResult.stage1_candidates`; generic `callModelStage`
  (prefix-switched transport); orchestration runs S2+S3 per candidate (parallel) when 2–3;
  Stage-3 system prompt literal-only tightening (AO3).
- `confidence-gate.ts` — Stage-1 branch → structural; keep S2/S3.
- `actions/run-diagnostics.ts` — per-concern: multi-candidate → persist
  `concern_clarify_candidates` (with per-candidate precomputed S2/S3 payloads) + route.
- `route-after-diagnostics.ts` — clarify pending → `concern_clarify` (top priority).
- `actions/submit-concern-clarify.ts` (NEW) — validates tap; chosen candidate's precomputed
  results merge into the normal pipeline outputs; none-of-these → advisor path; audit events.

**Wizard UI (scheduler-app/src/):**
- `lib/scheduler/session-state.ts` `WIZARD_STEPS` + `wizard/card-payloads.ts` union +
  `wizard/get-current-card.ts` case + `components/scheduler/wizard/WizardSurface.tsx` arm.
- `components/scheduler/heritage/ConcernClarifyCard.tsx` (NEW) — per design spec
  (`.claude/work/design/act-or-ask-stage1-spec.md`); models: ClarificationQuestionCard chips +
  MultiAccountDisambiguationCard none-branch.
- `actions/submit-back.ts` backTargetFor + `WizardBackBar.tsx` + `WizardProgress.tsx` (phase 2).
- Transcript: chip-shown jeffBubble + tapped userBubble via `applyWizardTransition`;
  structured `scheduler_audit_log` events `concern_clarify_shown` / `concern_clarify_choice`.

**Eval/verify:** regen `database.types.ts` + `catalog-snapshot.json`; re-run
`eval:diagnose` + `run-act-or-ask` (real corpora) full-chain; unit tests (schema/gate/resolution);
pgTAP (column + RPC arm + tire seed).

## Phasing (tasks AO1–AO5)

AO1 tire seed → AO2 contract+transport → AO3 stage-3 tightening → AO4 chip card UI → AO5
full-chain re-baseline + gate + deploy. Backend before UI per feature-implement ordering;
design spec dispatched at plan time (mandatory for UI).

## Verification

- Unit: Stage-1 candidates parsing/validation, gate rework, clarify resolution merge, none-branch.
- pgTAP: new column + RPC arm; tire_repair row + eligibility.
- Eval bars: full-chain on 145 synthetic + 747 real cases — hard misroutes ≤1-in-50, S2 ≥85%,
  S3 precision ≥0.85 post-tightening, misroute-safety ~100%.
- `/code-review` gate; typecheck+vitest+build; deploy + Vercel READY.

## Open questions

None blocking — S3 model choice deliberately deferred to AO5 measurement.
