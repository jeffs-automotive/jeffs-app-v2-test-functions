# LLM launch gate (revamp Phase A) — plan (2026-07-02)

> Executes REVAMP-PLAN-2026-06-24 §7 Phase A + §11 (the launch bar Chris conditioned the revamp on).
> Research artifact: the 2026-07-02 eval-surface survey (agent inventory, this session) + live DB counts.

## Why

The revamp's approval was conditioned on proving one LLM (three-stage Haiku 4.5 `diagnose-concern`)
carries the diagnostic job. Today nothing measures it: the eval harness computes descriptive stats only
(never reads `category_expected`), the fixture is 50 coarse-labeled cases predating the three-stage
refactor, and the harness deliberately bypasses the production Vercel AI Gateway path. The §11 launch
bar requires per-stage graded metrics under production config.

## Live baseline facts (queried 2026-07-02, test project itzdasxobllfiuolmbxu)

| Metric | Plan's audit figure | LIVE |
|---|---|---|
| concern_questions total | 729 | **1,017** |
| … with empty required_facts | 355 (49%) | **643 (63%)** |
| active concern_subcategories | 107 | **107** |
| active testing_services rows | 14 | **24** (wizard catalog surfaces a subset — dump will confirm) |

Consequence: fixture + backfill scope keys off a fresh catalog dump, not the plan's counts.

## Locked decisions (from REVAMP-PLAN §10/§11 — Chris, 2026-06-24)

- All three stages stay on Haiku 4.5; temperature 0; native constrained decoding.
- Bars: Stage-1 category accuracy ≥90% (F1 ≥0.85); Stage-2 subcategory ≥85% on Stage-1-correct;
  Stage-3 per-slot precision ≥0.85 (precision-weighted); ~100% of misroutes/failures land in
  over-ask/handoff.
- Measured **under production config** (gateway path, same client construction as diagnose-concern.ts).
- 643 empty-required_facts questions: backfill conservatively OR ratify always-ask per question.

## File-by-file changes

1. **`scheduler-app/scripts/eval/catalog-dump.ts`** (new, ungated path) — dumps the live catalog through
   `loadDiagnosticCatalog` (exactly the LLM's view) to `scheduler-app/scripts/eval/catalog-snapshot.json`:
   categories, subcategory slugs, per-question `{id, text, options, required_facts}`. Run before fixture
   authoring + before every eval (snapshot recorded in the report header for reproducibility).
2. **`scheduler-app/scripts/eval/eval-cases.json`** (new) — 150–300 labeled cases. Case schema:
   ```json
   {
     "id": "brakes-001",
     "text": "<customer description>",
     "chip_hint": null,
     "expected": {
       "stage1_category_key": "<service_key | other-subcat slug | null>",
       "stage1_acceptable": ["<optional alternates when genuinely ambiguous>"],
       "stage2_subcategory_slug": "<slug | null>",
       "stage3_facts": { "<slot>": "<expected value>" },
       "route": "testing_service | advisor_handoff | null_match"
     },
     "tags": ["near-miss", "steering", ...],
     "source": "authored-2026-07-02 | legacy-concerns-json"
   }
   ```
   Composition: every wizard-visible testing service + all 6 'other' subcats covered; steering/tires/
   HVAC/electrical (the audited holes); near-miss pairs; vague/short null-match cases; the 50 legacy
   cases relabeled. Authored via a fan-out workflow grounded in catalog-snapshot.json.
3. **`scheduler-app/scripts/eval-diagnose-concern.ts`** — rewritten:
   - **Production config**: stop stripping `AI_GATEWAY_API_KEY`/`VERCEL_*`; call `diagnoseConcern()`
     with the same gateway-routed client production uses.
   - **Auto-grading**: Stage-1 accuracy + macro-F1 (per-category P/R/F1 table); Stage-2 accuracy on the
     Stage-1-correct subset; Stage-3 per-slot precision/recall (micro + macro; precision-weighted
     headline); over-ask rate (questions asked ÷ questions a perfect run would ask); **misroute-safety**:
     for every case where Stage-1/2 output ≠ expected, classify the landing (advisor_handoff /
     over-ask-with-questions / **confident-misroute-zero-questions** — the dangerous bucket, bar ≈ 0).
     The confidence gate (`applyConfidenceGate`) is applied in-harness so the measured routing matches
     production `run-diagnostics.ts`.
   - p50/p95 latency + tokens per stage; confidence distribution + gate-fire rate.
   - Writes `docs/scheduler/diagnose-eval-<ts>.md` with a PASS/FAIL verdict against the §11 bars.
   - npm script: `"eval:diagnose": "node --experimental-strip-types scripts/eval-diagnose-concern.ts"`.
4. **`supabase/migrations/<ts>_backfill_required_facts.sql`** (gated) — conservative UPDATE per question
   id from a generated mapping (only unambiguous text→slot assignments; everything else ratified
   always-ask by leaving `'{}'`). Mapping file committed at `scheduler-app/scripts/eval/required-facts-backfill.json`
   with per-assignment rationale. Wrong-assignment risk = skipped question (expensive error) → bias to
   NOT assigning.
5. **`supabase/functions/llm-testing/*`** (gated) — sync the drifted mirror: GA `output_config.format`
   (mirrors the 2026-07-02 diagnose-concern migration) + note that the confidence gate is
   scheduler-app-side.

## Phasing

A1 dump+fixture (ungated) → A2 harness rewrite (ungated) → A3 baseline eval run #1 →
A4 required_facts backfill migration + llm-testing sync (gated, implement phase) → A5 eval run #2
(measures backfill effect on over-ask) → A6 verdict report vs bars.

## Verification

- `npm run eval:diagnose` produces a graded report; committed alongside the fixture.
- typecheck + vitest green (harness has unit tests for the graders — pure functions).
- `/code-review` gate on the gated files (migration + edge fn).
- The §11 two-part bar evaluated explicitly; if a bar FAILS, that's a reported finding for Chris
  (prompt/catalog iteration is a follow-up decision), not a silent pass.

## Open questions

- None blocking. Model escalation (async Haiku→Sonnet on the low-confidence tail) stays OUT per plan
  ("only after the gate exists and off the critical path").
