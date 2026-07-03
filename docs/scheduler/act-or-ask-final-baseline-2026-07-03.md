# act-or-ask full-chain re-baseline (AO5) — 2026-07-03

> Full production-chain eval driving the SHIPPED `diagnoseConcern` (Stage-1
> candidates → per-candidate Stage-2/Stage-3 precompute → deterministic mapper
> → confidence gate). Env model defaults: **S1/S2 `google/gemini-3.1-flash-lite`**,
> **S3 `anthropic/claude-haiku-4-5`** (baseline). Catalog: 31 categories
> (tire_repair now present). Grading labels = the v2 consensus files (re-labeled
> against the tire_repair catalog); graded pool excludes `ambiguous`/`unjudged`.
> Runner: `scripts/eval/run-eval-final.ts`. Ran 2026-07-03T14-27-31.

## Verdict at a glance

- **Hard-misroute bar (1-in-50):** combined real corpora = **16 hard / 690 graded → 1-in-43** ❌ FAIL — driven ENTIRELY by forum (1-in-33); tekmetric passes (1-in-51) and synthetic passes (1-in-73). Of the 16, only **9 are testing-service↔testing-service confusions** (the truly-dangerous class → 1-in-77); 6 are "consensus was an advisor-situation, model picked a testing service" (the raw concern still reaches the advisor), and 1 is tire-gap residue. See the forensic breakdown below.
- **Stage-3 model (A/B):** recommend `DIAGNOSE_CONCERN_STAGE3_MODEL=openai/gpt-5.4-mini`. NEITHER arm clears the 0.85 bar (haiku 0.724 / gpt-5.4-mini **0.782** adjudicated), but gpt-5.4-mini is the clear winner and both are a large jump over the old 0.606/0.434 baselines. Slot precision still needs prompt iteration to reach 0.85.
- **Tire-gap closure:** 12/12 forum + 2/2 tekmetric `tire_repair`-consensus cases now surface `tire_repair` as a candidate; **10/12 forum + 2/2 tekmetric land correctly** (2 forum residue: text leads with "tire pressure warning" → routed TPMS). The single biggest real-world error class from the prior eval is largely eliminated.
- **Parse failures:** 0 across all 892 baseline chains (247 forum + 500 tekmetric + 145 synthetic). No anomalies.
- **Caveat vs the earlier simulator (1-in-112):** that number came from `run-act-or-ask.ts` (a single-call SIMULATION with a slimmer prompt). This is the FULL production chain (per-candidate S2+S3 precompute, the real Stage-1 prompt, the confidence gate) — the honest production number, and forum's long-ramble register is harder than the simulator suggested (consistent with the prior eval's register finding #4).

## Per-corpus metrics

### forum

| Metric | Value |
|---|---|
| Final-landing accuracy | 91.2% (208/228) |
| Dangerous direct misroutes (all) | 8 → 1-in-29 |
| **Hard misroutes (vs unanimous / no-judge)** | **7 → 1-in-33** ❌ (bar 1-in-50) |
| Clarification friction | 40.8% (resolved 84 + none-of-these 9) |
| Advisor-handoff rate | 5.3% |
| Confidence-gate fires | advisor_handoff 3 · over_ask 1 |
| S2 subcategory accuracy | 82.6% (128/155) |
| S3 slot precision (raw / adjudicated) | — (no expected_facts) |
| Chain latency p50 / p95 / max | 6673 / 9800 / 15018 ms |
| Parse failures | 0 |
| Ambiguous (handled safely) | 19 (14 clarified/handed off) |
| Errors | 0 |

### tekmetric

| Metric | Value |
|---|---|
| Final-landing accuracy | 80.3% (371/462) |
| Dangerous direct misroutes (all) | 16 → 1-in-29 |
| **Hard misroutes (vs unanimous / no-judge)** | **9 → 1-in-51** ✅ (bar 1-in-50) |
| Clarification friction | 31.8% (resolved 104 + none-of-these 43) |
| Advisor-handoff rate | 34.0% |
| Confidence-gate fires | advisor_handoff 24 · over_ask 37 |
| S2 subcategory accuracy | 90.4% (151/167) |
| S3 slot precision (raw / adjudicated) | — (no expected_facts) |
| Chain latency p50 / p95 / max | 6101 / 9455 / 14485 ms |
| Parse failures | 0 |
| Ambiguous (handled safely) | 38 (26 clarified/handed off) |
| Errors | 0 |

### synthetic (145 authored fixture — the only corpus with expected_facts)

| Metric | Value |
|---|---|
| Final-landing accuracy | 95.9% (139/145) |
| Dangerous direct misroutes (all) | 2 → 1-in-73 |
| **Hard misroutes (vs unanimous / no-judge)** | **2 → 1-in-73** ✅ (bar 1-in-50) |
| Clarification friction | 35.9% (resolved 52 + none-of-these 0) |
| Advisor-handoff rate | 11.0% |
| Confidence-gate fires | advisor_handoff 4 · over_ask 1 |
| S2 subcategory accuracy | 97.0% (96/99) |
| S3 slot precision (raw / adjudicated) | 0.549 / 0.724 |
| Chain latency p50 / p95 / max | 6570 / 12397 / 18993 ms |
| Parse failures | 0 |
| Ambiguous (handled safely) | 0 (0 clarified/handed off) |
| Errors | 0 |

## Step 1 — v2 re-label deltas (tire_repair now in the catalog)

Both real corpora were re-labeled by the same 3 judge families (`label-real-concerns.ts`)
against the catalog that now contains `tire_repair`. Consensus distribution deltas vs v1:

| Corpus | v1 (conf/maj/amb) | v2 (conf/maj/amb) | `tire_repair` consensus (v2) | null→category | category→null | null-consensus total |
|---|---|---|---|---|---|---|
| forum (247) | 119 / 100 / 28 | 120 / 108 / **19** | **12** (11 from null, 1 from tpms_testing) | 22 | 5 | — |
| tekmetric (500) | 172 / 286 / 42 | 189 / 273 / **38** | **2** (both from null) | 32 | 18 | 150 → 136 |

- **12 previously-unlabelable forum tire concerns now have a catalog home** (11 were `(null)`,
  1 was rescued from a `tpms_testing` misroute) — exactly the largest error class the prior eval
  flagged. Tekmetric shows only 2 (its ambiguity is channel noise, not describable tire symptoms —
  consistent with the prior eval's finding #2).
- Ambiguity dropped on both (forum 28→19, tekmetric 42→38): the fuller catalog let more torn cases
  reach a 2-of-3 consensus.

Files: `scripts/eval/real-concerns-labeled-v2.json`, `scripts/eval/real-concerns-tekmetric-labeled-v2.json`.

## Hard-misroute forensics (the 16 combined real hard misroutes)

"Hard" = a confident single-candidate route to the wrong category that can't be excused by a label
dispute: it disagreed with a UNANIMOUS (3/3) consensus, OR it routed to a key NO judge family voted.

| Class | Count | 1-in-N | Danger |
|---|---|---|---|
| Testing-service ↔ testing-service (or → null) | 9 | 1-in-77 | HIGH — wrong fee-bearing rec, wrong questions |
| Consensus = advisor-situation, model routed a testing service | 6 | 1-in-115 | LOW-MED — raw concern still reaches the advisor via the concern summary |
| Tire-gap residue (`tire_repair` consensus → tpms) | 1 | 1-in-690 | LOW — tire language, near-miss |

The 9 high-danger cases: forum real-024/real-027 (AC vs coolant / AC-leak), real-031 (interior water
→ ac_leak); tekmetric tkc-011/tkc-017/tkc-285 (null → guessed a test), tkc-289 (warning_light_general
→ check_engine), tka-109 (charging → no_start), tka-181 (brake_inspection → brake_inspection_warning_light).
Forum's long-ramble register produces most of the residual error; the growing wizard-typed corpus
(`Tell us>` lines) is the truth source to re-measure on before shipping.

## Stage-3 model A/B (synthetic fixture only — has `expected_facts`)

Both arms run the SAME tightened Stage-3 literal-only prompt; only
`DIAGNOSE_CONCERN_STAGE3_MODEL` differs. Slot precision is the expensive-error
metric (a wrongly asserted fact SKIPS a question). Old baselines for reference:
0.606 (as-labeled) / 0.434 pre-tightening → adjudicated is the fair number
(fixture under-labels reclassified as TP via `stage3-adjudication.json`).

| Arm | S3 model | Slot precision (raw) | Slot precision (adjudicated) | Recall (adj) | vs 0.85 bar |
|---|---|---|---|---|---|
| A | anthropic/claude-haiku-4-5 | 0.549 | 0.724 | 0.959 | ❌ |
| B | openai/gpt-5.4-mini | 0.627 | 0.782 | 0.977 | ❌ |

**Recommendation:** set `DIAGNOSE_CONCERN_STAGE3_MODEL=openai/gpt-5.4-mini`. It is the more precise of the two arms on the expensive-error metric (adjudicated slot precision 0.782 vs haiku 0.724) at LOWER latency (p50 4.4s vs 6.6s). NEITHER arm clears the 0.85 bar yet — so gpt-5.4-mini ships as the interim default while the Stage-3 literal-only prompt gets a further iteration pass to close the remaining gap. (Note: the Gemini 29-enum schema cap still rules Stage-3 out for flash-lite, so the choice is genuinely haiku-vs-mini.)

> Note: the "Step 1" and "Hard-misroute forensics" sections above are hand-authored analysis on top of
> the auto-generated tables; re-running `summarize-final.ts` regenerates the tables + verdict lines but
> not those two narrative sections.

## Reproduce

```bash
cd scheduler-app
vercel env pull --environment=production .env.eval-prod --yes
export VERCEL_OIDC_TOKEN=$(grep '^VERCEL_OIDC_TOKEN=' .env.eval-prod | cut -d= -f2- | tr -d '"')

# Step 1 — re-label the two real corpora against the tire_repair catalog
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/label-real-concerns.ts \
  --input scripts/eval/real-concerns-forums.json    --output scripts/eval/real-concerns-labeled-v2.json
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/label-real-concerns.ts \
  --input scripts/eval/real-concerns-tekmetric.json --output scripts/eval/real-concerns-tekmetric-labeled-v2.json

# Step 2 — full-chain baseline (all 3 corpora, default models)
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/run-eval-final.ts \
  --concurrency 6 --output scripts/eval/final-baseline-report.json

# Step 3 — Stage-3 A/B (synthetic only): gpt-5.4-mini arm (haiku arm = baseline synthetic)
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/run-eval-final.ts \
  --corpora synthetic --s3-model openai/gpt-5.4-mini --output scripts/eval/final-s3-gpt54mini-report.json

# Render this summary
node --experimental-strip-types --import ./scripts/eval/register-alias.mjs scripts/eval/summarize-final.ts
```

Per-case rows + full metrics: `scripts/eval/final-baseline-report.json`,
`scripts/eval/final-s3-gpt54mini-report.json`.
