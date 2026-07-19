# `datasets/` — the machine golden set

> Assembled in Phase C (Wave-C consolidation) from every `golden_cases:` block in
> `../systems/*.proposals.yaml`. This is the **evaluation** corpus for the diagnose-concern
> classifier retraining program (see [`../methodology.md`](../methodology.md)).

## `golden-cases.json`

A **JSON array** of 272 labeled cases. Each element matches the per-case schema of the shipped
harness fixture `scheduler-app/scripts/eval/eval-cases.json` exactly:

```jsonc
{
  "id": "brakes-friction-hydraulic-001",   // stable, unique: "<system-slug>-NNN"
  "text": "loud grinding from the front right when i brake, feels like metal on metal",
  "tags": ["fact_rich"],
  "expected": {
    "stage1_category_key": "brake_inspection",            // service_key | 'other' bucket slug | null
    "stage1_acceptable": ["brake_inspection", "brake_inspection_warning_light"],
    "stage2_subcategory_slug": "metallic_grinding",        // subcategory slug | null
    "stage2_acceptable": ["..."],                          // OPTIONAL — only present on a few cases
    "stage3_facts": { "noise_descriptor": "grinding_metallic", "location_axle": "front", "location_side": "right", "onset_timing": "when_braking" },
    "route": "testing_service"                             // testing_service | advisor_handoff | null_match
  },
  "source": "auto-kb-wave-a:brakes-friction-hydraulic"
}
```

### ⚠️ Train/test wall

**These cases are for EVAL ONLY. Never use any of them as a few-shot / prompt example** in
`diagnose-concern.ts`, the edge mirror, or any retraining prompt. Contaminating the prompt with a
golden case invalidates the measurement. Prompt exemplars must be authored separately.

### Label semantics (how they were validated)

Every label was validated against the ground-truth snapshot
[`../00-current-scheduler-taxonomy.md`](../00-current-scheduler-taxonomy.md):

- `stage1_category_key` and every `stage1_acceptable` entry is one of the 25 active
  `testing_services.service_key` values, one of the 6 `'other'` situational buckets, **or `null`**.
- `stage2_subcategory_slug` is one of the 107 active subcategory slugs **or `null`**.
- Every `stage3_facts` key is one of the 29 fact slots and every value is in that slot's enum
  (`extracted-facts.ts`); `"*"` means "any non-null value is correct".
- `route` is derived from `stage1_category_key` so it is always consistent with the grader:
  service key → `testing_service`; `'other'` bucket → `advisor_handoff` (stage2 forced `null`);
  `null` → `null_match` (stage2 forced `null`). Stage-2 is only graded on `testing_service` cases.

### Coverage (deliberately built in)

| Slice | How to find it | Count |
|---|---|---|
| Fact-rich | tag `fact_rich` | 109 |
| Inference-traps (extractor must NOT over-assert) | tag `inference_trap` | 49 |
| Null-routes (work-order lines / non-concern) | `route: null_match` (tags `null_route`, `work_order`) | 37 |
| Advisor handoff (situational buckets) | `route: advisor_handoff` | 4 |
| Confusable near-misses | tags `confusable`, `near_miss`, `cross_system`, `discriminator` | 45 |

### Gated cases (target proposals that don't exist in the catalog **yet**)

Some Wave-A cases deliberately probe a proposed subcategory, a proposed fact slot, or a proposed
enum value from `../systems/*.proposals.yaml`. So they **pass today** and only become fully
discriminating **after Chris applies the proposal in Phase 5**, they are gated:

| Tag | Meaning | What was neutralised so it validates today |
|---|---|---|
| `gated_subcat:<slug>` | expected subcategory is a *proposed* one | `stage2_subcategory_slug` set to `null` (stage-1 label kept, so it still tests routing to the service) |
| `gated_slot:<name>` | a *proposed* fact slot | that fact removed from `stage3_facts` |
| `gated_fact:<slot>=<value>` | a *proposed* enum value on an existing slot | that fact removed from `stage3_facts` |

22 `gated_subcat`, 18 `gated_slot`, 9 `gated_fact`. When Phase 5 builds a proposal, re-point the
matching gated cases (restore the real slug/slot/value, drop the gate tag) and re-run — that is how
you measure the lift the proposal bought.

### `cross_category_unverified` (9 cases — read before first run)

The live catalog attaches several subcategories to a testing service **across** category lines
(e.g. `check_engine_light_testing` → `blue_or_gray_smoke_from_tailpipe`; `brake_inspection` →
`pulling_only_when_braking`). Most such pairs in this set are confirmed by the shipped
`eval-cases.json`; **9 are supported only by the taxonomy prose** and tagged
`cross_category_unverified`. If the harness's pre-flight label validation (below) rejects one, it
means that attachment isn't in the live catalog — null its `stage2_subcategory_slug` and add a
`gated_subcat:` tag, or delete the case. The 9: see `id`s tagged `cross_category_unverified`.

## How to run it through the eval harness

The runner (`scheduler-app/scripts/eval/run-eval.ts`, invoked by `npm run eval:diagnose`) reads a
fixture shaped `{ "cases": [ ... ] }` from `scripts/eval/eval-cases.json`. `golden-cases.json` here
is the **bare array**, so wrap it (or merge it) first. It also validates every label against the
**live catalog** before spending any tokens and `exit(2)`s (listing the offending labels) if any
label is stale — so a run either grades cleanly or tells you exactly which label to fix.

```bash
cd scheduler-app

# Option A — run ONLY the golden set (wrap the array into the fixture shape):
node -e "const a=require('../docs/automotive-knowledge-base/datasets/golden-cases.json');\
require('fs').writeFileSync('scripts/eval/golden-run.json',JSON.stringify({cases:a},null,2))"
# then point the runner at it (copy over eval-cases.json, or add a --fixture flag):
cp scripts/eval/golden-run.json scripts/eval/eval-cases.json   # (back up the original first)

# Option B — append the golden set to the existing 145 authored cases:
node -e "const cur=require('./scripts/eval/eval-cases.json');\
const add=require('../docs/automotive-knowledge-base/datasets/golden-cases.json');\
cur.cases=cur.cases.concat(add);require('fs').writeFileSync('scripts/eval/eval-cases.json',JSON.stringify(cur,null,2))"

# needs .env.local with AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) — production gateway config
npm run eval:diagnose
npm run eval:diagnose -- --filter brakes-friction   # subset by id/tag substring
npm run eval:diagnose -- --limit 30 --concurrency 2
npm run eval:diagnose -- --strict                   # exit 1 when a §11 launch bar fails
```

Report lands at `docs/scheduler/diagnose-eval-<ts>.md` + `scripts/eval/last-run.json`. The §11 bars
graded: Stage-1 accuracy ≥ 90% & macro-F1 ≥ 0.85, Stage-2 accuracy ≥ 85% (on Stage-1-correct),
Stage-3 slot precision ≥ 0.85, and zero confident-misroute-with-no-questions landings.

> Keep a backup of the original `eval-cases.json` before overwriting; the 145 authored cases are the
> shipped baseline fixture.

## Provenance

Every case's `source` is `auto-kb-wave-a:<system-slug>`, pointing back to the dossier + proposals
trio under `../systems/`. Regenerate this file by re-reading those `golden_cases:` blocks; do not
hand-edit `golden-cases.json` (edit the owning `*.proposals.yaml` and re-assemble).
