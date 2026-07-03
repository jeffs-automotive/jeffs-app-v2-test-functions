# Unbiased model verification — cross-family judging + head-to-head (2026-07-02)

> Follow-up to `llm-model-research-2026-07-02.md`, per Chris: "I really need unbiased research…
> did you verify the results of the 145 Haiku responses or are you relying on self-reporting?"
> Target: Stage-1 error rate ≤ 1-in-50 (98%).

## 1. Was the original eval self-reported? Honest answer

Grading was always deterministic code (model output vs stored label — no model grades itself).
The WEAKNESS was the truth-chain: the 145 labels were authored by Claude agents, blind-verified by
Claude agents, and Stage-3 disputes were adjudicated by Claude agents — a single-family circularity.
The texts are synthetic (the DB holds only 10 real customer concern texts so far — they closely
resemble the synthetic style, but they're a spot-check, not an eval).

**Fix applied:** every one of the 145 labels was independently re-derived by TWO non-Claude judges
(OpenAI `gpt-5.4` + Google `gemini-3.5-flash`, temperature 0, JSON-schema-constrained, via the
Vercel AI Gateway). Result: **128/145 labels confirmed by both**, 7 label-suspect (both judges
agree on a different answer — includes 2 outright label errors where Haiku had been marked wrong
for correctly calling a clear-water puddle a non-issue), 10 split (genuinely ambiguous catalog
boundaries, e.g. screw-in-tire ↔ advisor-handoff).

**Haiku 4.5 rescored against 3-family consensus: 88.3%** (vs 89.0% on as-authored labels) — the
measurement is robust; label errors did not inflate or deflate it materially. 13 of its 16 misses
are unanimous across all three families.

## 2. Head-to-head — same prompts, same schemas, same validation, same graders

Four candidates ran the FULL production pipeline (Stage 1 → 2 → 3 → deterministic mapper →
confidence gate) on all 145 cases via the AI Gateway (`scripts/eval/run-eval-x.ts`).

### The decision table — CLEAN-case Stage-1 accuracy
(the 128 cases where both non-Claude judges independently confirmed the label; no ambiguity,
no label error)

| Model | Clean-case Stage-1 | Error rate | Stage-2 | Confident misroutes | p50 chain | Judge-bias note |
|---|---|---|---|---|---|---|
| **google/gemini-3.1-flash-lite** | **97.7% (3/128 wrong)** | **1-in-43** | 96.6% | **0** | **3.9 s** | **Unbiased — was NOT a judge** |
| google/gemini-3.5-flash | 98.4% (2/128) | 1-in-64 | 99.1% | 0 | 6.4 s | ⚠️ WAS a judge — helped define the clean set; treat its score as an upper bound |
| openai/gpt-5.4-mini | 96.1% (5/128) | 1-in-26 | 97.3% | **1** ⚠️ | 3.8 s | clean |
| anthropic/claude-haiku-4-5 (current) | 93.0% (9/128) | 1-in-14 | 98.1% | 0 | 7.0 s | n/a |
| openai/gpt-5.4-nano | 83.6% (21/128) | 1-in-6 | 95.0% | **2** ⚠️ | 4.1 s | eliminated on accuracy + safety |

Stage-3 literal-extraction precision (vs as-authored labels; Haiku 0.434): gpt-5.4-nano **0.706**,
gpt-5.4-mini 0.588 — the OpenAI models follow "extract only literally stated facts" markedly
better with the SAME prompt. **Gemini could not run Stage 3 at all** (below).

### Empirically discovered integration limits (things no research could tell us)

- **Gemini rejects our 29-slot Stage-3 schema** ("Request contains an invalid argument").
  Bisection: ≤25 enum-bearing properties pass, 29 fail, 29 WITHOUT enums pass → a total
  enum-complexity cap. Gemini can serve Stage 3 only if the extraction splits into two sub-calls
  (or the pipeline mixes providers per stage). This empirically settles the research's refuted
  "all Gemini models support full JSON Schema" claim.
- Gateway pass-through of JSON-schema structured outputs to OpenAI and Google **works** for our
  Stage-1/2 schemas (the research had flagged this unverified). Zero parse failures anywhere.
- OpenAI-model confidence self-reports differ from Haiku's: gpt-5.4-mini/nano produced 1–2
  "confident misroutes with zero questions" (the dangerous bucket both Haiku and Gemini kept at 0)
  — the confidence gate would need per-family re-tuning before any OpenAI swap.
- Token accounting: the AI-SDK-measured input volume (~12.9K tokens/diagnosis on OpenAI, ~7.6K on
  Gemini's tokenizer) is ~5–8× the figure the Anthropic-path usage reported for Haiku (~1.6K/diag).
  The earlier research's absolute $/1k figures inherited that understatement — corrected estimates:
  Gemini 3.1 Flash-Lite ≈ $2.1/1k diagnoses, gpt-5.4-mini ≈ $9.9/1k, Haiku ≈ $9–14/1k (its true
  token volume is between the two measures). Relative ranking unchanged; at 20–60 diagnoses/day
  ALL of these are under ~$1/day — cost remains a non-factor.

## 3. Independent verification of the research report's claims

Re-fetched from official pages (2026-07-02): OpenAI prices exact-match ✅; Gemini prices
exact-match ✅ (incl. thinking-token billing note); Anthropic prices + Sonnet-5 intro window +
30%-tokenizer note exact-match ✅; Gemini 2.5 Flash-Lite deprecation confirmed ✅ — **plus a
correction: Gemini 2.5 Flash AND 2.5 Pro also shut down 2026-10-16**, so the entire 2.5 generation
is a dead end (the research listed 2.5 Flash as a viable candidate; it is not). Gemini
3.1 Flash-Lite has a published 2027-05-07 shutdown — ~10 months of runway before a forced hop to
the 3.5 tier.

## 4. Recommendation (evidence-only)

Chris's bar is 1-in-50. On unbiased clean-set evidence:

1. **Gemini 3.1 Flash-Lite for Stages 1+2** is the strongest verified candidate: 97.7%
   (1-in-43, statistically at the bar's edge on n=128), zero dangerous landings, ~2× faster chain,
   ~$2/1k. Its 3 remaining errors are boundary cases. Haiku at 93.0% clean (1-in-14) is
   meaningfully behind **with identical prompts** — this gap is model capability, not prompting.
2. **Stage 3: gpt-5.4-nano or gpt-5.4-mini** (0.706 / 0.588 literal precision vs Haiku's 0.434)
   — Gemini can't run it unsplit. A mixed-provider pipeline is cheap to wire: per-stage model
   overrides already exist (`DIAGNOSE_CONCERN_STAGE{1,2,3}_MODEL`), but the production transport
   must move from the Anthropic SDK to the gateway-generic path for non-Claude stages
   (`run-eval-x.ts` is ~80% of that code).
3. **Before any production swap:** re-tune the confidence gate per family (the OpenAI misroute
   safety signal), re-run the eval after the Stage-3 literal-only prompt tightening (it may lift
   every model), and re-validate on real customer texts as they accumulate (10 today).
4. Statistical honesty: at n=128, the 97.7% vs 98.4% vs 96.1% differences are 1–3 cases —
   Gemini's lead over Haiku (9 vs 3 errors) is solid; the ordering WITHIN the top three is not.

Artifacts: `scripts/eval/cross-judge.ts` + `cross-judge-report.json` (all 145 verdicts),
`scripts/eval/run-eval-x.ts` + `docs/scheduler/diagnose-eval-x-*.md` (per-model reports),
`scripts/eval/last-run-x-*.json` (per-case dumps).
