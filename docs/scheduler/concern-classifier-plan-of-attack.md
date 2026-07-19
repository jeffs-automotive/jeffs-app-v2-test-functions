# Concern-classifier retraining — plan of attack (right model · workflow · eval · training)

> **Purpose.** Chris (2026-07-19): the prior 88.97%/95.2% scores were *self-testing* bias; we need a HIGH
> level of success measured by UNBIASED tests confirmed by GPT + Gemini, with the *right* model + workflow
> + steps + training. This doc = the measured current state + a Fable-panel-synthesized plan, to be
> independently confirmed by GPT-5.6 + Gemini before we commit.

---

## UPDATE 2026-07-19b — Tekmetric ROs DROPPED from the eval (Chris)

**Tekmetric RO "concern" text is written by a service ADVISOR, not the customer** — summarized shorthand
("TEST BATTERY", "CHECK ALIGNMENT", "testing auth $189"), often missing the very details the wizard exists
to extract from the customer. It is the WRONG distribution: the classifier serves customer free-text input,
not advisor work-order lines. Judging or training against it measures the wrong thing.

**This corrects a false signal.** On the *customer-voice* corpus (forum), the numbers across the same
changes were: 2026-07-03 **91.2%** → post-concern-triage **93.4%** → post-fix **95.6%**, hard-misroute
falling. The alarming −11pt "regression" was **entirely the Tekmetric (advisor) corpus**; on customer input
concern-triage never regressed and the fix improved things. So the regression fix stands (net-positive on
customer voice), but Tekmetric is removed from the default eval.

**Changes:** `run-eval-final.ts` default corpora → `forum,synthetic` (tekmetric opt-in only, marked
deprecated); the spot-check harness defaults to `forum`. **Customer-voice sources going forward:** `forum`
(interim proxy — real people describing problems in their words) and, as the real target, **production
wizard input** (the outcome-join flywheel). **KB caveat:** the KB's keywords/positive-examples were partly
mined from Tekmetric RO evidence (advisor language) — so the deferred enrichment is partly contaminated and
must be re-based on customer-voice phrasing before use. The success bar below now applies to customer-voice
corpora only (drop the Tekmetric row).

---

## Part A — Measured current state (2026-07-19, this environment)

**The unbiased eval already exists** (built 2026-07-03 on Chris's instruction "I don't want you coming up
with the customer concerns"): `scheduler-app/scripts/eval/`:
- `real-concerns-tekmetric-labeled-v2.json` — **500 real Tekmetric customer RO concern texts**, each
  labeled by **3 independent judge families** (`openai/gpt-5.4` + `google/gemini-3.5-flash` +
  `anthropic/claude-sonnet-5` — deliberately NOT the tested candidates) → consensus + confirmed(3/3)/majority(2/3).
- `real-concerns-labeled-v2.json` — a forum-harvest corpus, same 3-family consensus.
- `run-eval-final.ts` grades the shipped `diagnoseConcern` against those labels (final-landing, hard-misroute
  1-in-N, advisor rate, S2 accuracy, latency). `label-real-concerns.ts` generates the labels.

**Current honest numbers vs the committed 2026-07-03 baseline (identical models — gemini-3.1-flash-lite
S1/S2 + haiku-4-5 S3 — identical 31-category catalog):**

| Corpus | Metric | 2026-07-03 | 2026-07-19 (now) | Δ |
|---|---|---|---|---|
| Forum (247) | final-landing | 0.9123 | **0.9342** | +2.2 ✅ |
| Tekmetric (500) | final-landing | 0.803 | **0.6926** | **−11 ❌** |
| Tekmetric | advisor-handoff rate | 0.340 | **0.485** | +14.5 |
| Tekmetric | safe-misses (real answer existed, punted) | 75 | **133** | +58 |
| Tekmetric | hard-misroute rate | 0.0195 | 0.013 | −0.6 (safer) |

**Regression pinned — with row-level evidence (tekmetric, current vs 2026-07-03):**

| | 2026-07-03 | Now |
|---|---|---|
| Stage-1 returns **zero candidates** (→ punt) | 96 | **191** (≈2×) |
| `direct_correct` routes | 185 | **134** (−51) |
| `handoff_miss` (safe miss) | 32 | **98** (+66) |
| `direct_wrong` (actual misroutes) | 28 | 21 (fewer — *safer*) |

The classifier didn't get *wrong* — Stage-1 started **declaring "no match" ~2× more often**, punting ~95
routable concerns. Root cause: the **`no_match_reason` rubric added in the concern-triage commits shipped
earlier today** (`011d8eb` INV-6 + `b10b9c1` INV-14 — the only post-7/3 changes to `diagnose-concern.ts`).
On `last-run.json` (golden-272) the fingerprint is identical: 131/272 rows have an empty Stage-1 candidate
list, 112 land handoff, and the confidence gate fired only 16× — **the emptiness comes from the model, not
the gate.** Caveat: in production those extra zero-candidate cases now show **triage chips**, not a raw
dead-end, so the eval *overstates* the customer-facing hit — but the rubric is genuinely too aggressive on
terse RO text and needs tuning.

**This validates the whole exercise: the unbiased eval caught a real regression the self-authored set masked.**

Also verified: the enrichment migration `supabase/migrations/20260719130000_kb_retrain_enrichment.sql`
exists but is **untracked + never applied** (correctly held — applying it now would destroy causal
attribution). `KEYWORD_LINE_MAX = 40` (`diagnose-concern.ts:506`) silently truncates the Stage-1 keyword
line — a real caveat before the 207 keyword adds.

---

## Part B — Plan of attack (Fable-panel synthesis of 4 specialist angles)

### Answers to the five questions

| Q | Answer |
|---|---|
| **Regression first?** | **YES — Phase 0, blocking.** The drop is a code regression from today's concern-triage commits, not catalog growth, not a model limit. Cheapest win (~½ day). |
| **Eval unbiased + bar?** | Skeleton is sound (real texts, 3 judge families disjoint from candidates); needs cheap hardening + a locked holdout + Chris's human spot-check. Bar below (Chris signs off). |
| **Right model?** | Keep S1/S2 `gemini-3.1-flash-lite`, S3 `haiku-4-5` for now; a post-fix per-stage **sweep** decides. `gpt-5.4-mini` is the presumptive S3 successor; Sonnet-5 a candidate. Bigger model is NOT the S1 fix (gemini-3.5-flash scored an identical 95.2% S1). |
| **Right workflow?** | **Keep the 3-stage act-or-ask skeleton** — it converted this week's regression into *safe handoffs* instead of misroutes. Harden Stage 1 (split reject-from-rank; parallel S2∥S3; optional gated vote; retrieval guardrail). Reject hierarchical + single-shot-primary. |
| **Right training?** | **Catalog enrichment (the KB) + embedding-assisted grounding. Fine-tuning DEFERRED** — infeasible on the exact production models today, and 500 labels is too few. |

### Phases + gates

- **Phase 0 — Regression recovery (BLOCKING, ~½ day).** Instrument `run-eval.ts` to emit `no_match_reason`
  + candidates; read the 131 empty rows; 4-point bisect (`d2e0fff^`→`d2e0fff`→`011d8eb`→`b10b9c1`) on
  `eval-cases.json`, pinned models. Fix if confirmed: make `no_match_reason` schema-optional, restore the
  terse empty rule, add "when in doubt, return your best 2-3 candidates — the clarify path absorbs doubt"
  (keep the field for triage telemetry). **Gate G0:** synthetic S1 ≥ 93% AND empty-candidate ≤ 12% → re-run
  `run-eval-final.ts` → cut a NEW pinned real-data baseline. Add a committed 60-case smoke tripwire.
- **Phase 1 — Eval hardening + success bar (~1-2 days + ~2h Chris).** Human stratified spot-check (~130
  cases tagged model_wrong/label_wrong/ambiguous — bounds correlated judge error); Wilson 95% CIs + paired
  McNemar; split tekmetric 500 → **DEV 250 / LOCKED 250**; fresh-harvest ~300 Tekmetric ROs dated AFTER the
  KB was authored (uncontaminated enrichment test set); confirmed-only (3/3) headline; catalog-hash every
  report; start the production outcome-join flywheel (free labels at scale).
- **Phase 2 — KB enrichment in measured slices (~3-5 days, after G0 + new baseline).** Order: value-aware
  mapper → new fact slots → Stage-2 pos/neg/synonyms → Stage-1 keywords/hedges → routers as DB hedge rules →
  structural last. One slice = one variable; McNemar on DEV; LOCKED + fresh-300 at ship. Raise
  `KEYWORD_LINE_MAX` before the 207 keyword adds. Re-slice the held `20260719130000` migration. **Gate G2:**
  CI-positive landing delta, no friction/hard-misroute regression.
- **Phase 3 — Model sweep (~2-3 days, only after G0).** Per-stage marginals through the shipped pipeline on
  the real corpora, catalog frozen, **≥2 replicates** + paired stats (identical-config tekmetric swung
  0.72-0.80 across re-runs — <4-pt single-run deltas are noise). S1: flash-lite/3.5-flash/haiku/sonnet-5/
  gpt-5.4-mini + one Opus-4.8 ceiling probe (if Opus ≈ Sonnet, taxonomy is the bottleneck → spend on
  enrichment). S3 primary metric = slot precision + underAsk. Judge-family models (sonnet-5, 3.5-flash) get
  a judge-exclusion regrade. Bump stale `FALLBACK_MODEL claude-sonnet-4-6 → claude-sonnet-5`.
- **Phase 4 — Architecture hardening (~3-5 days, overlaps P3).** A/B each arm on the unbiased eval: (1)
  split reject-from-rank (makes this regression structurally unrepeatable); (2) parallelize S2∥S3 (~2-3s p50
  back); (3) S1 self-consistency vote k=3 — ONLY if the FREE offline simulation on existing `last-run-x-*`
  rows shows the vote ceiling clearly above the best single model; (4) pgvector retrieval guardrail (confident
  S1 answer not in embedding top-8 → downgrade to clarify; becomes a prefilter past ~50 categories).
- **Phase 5 — Training (deferred).** Enrichment + hybrid kNN few-shot from the 500 labeled concerns.
  Fine-tuning revisited ONLY if P2-4 plateau below bar AND the flywheel reaches ≥2-3k outcome-verified labels.

### Proposed success bar (LOCKED set, CI-aware; **Chris picks**)

| Metric | Ship | Stretch | 7/3 baseline |
|---|---|---|---|
| Hard misroutes (vs unanimous labels) | **≤ 1-in-100** | 1-in-200 | 1-in-51 tek |
| Final landing | **≥ 85% tek / ≥ 92% forum** | 90/95 | 80.3 / 91.2 |
| Advisor handoff (tek) | ≤ 25% | ≤ 15% | 34% |
| S2 accuracy | ≥ 90% | ≥ 93% | 90.4 tek |
| Chain p95 | ≤ 10s (12s hard) | ≤ 8s | ~9.5s |

Reading: per 100 bookings — ~85 route untouched, ~14 one-tap/safe-handoff, **≤1 wrong diagnostic**.

### Decisions that are Chris's
1. The bar (1-in-100 vs the 1-in-50 documented in code; landing 85/92 vs 90/95; advisor ≤25%).
2. ~2h human label spot-check (only bound on correlated judge error).
3. Hold + re-slice the uncommitted enrichment migration (don't apply wholesale).
4. Latency budget (p95 ≤ 10s / 12s hard).
5. Approve the fresh 300-RO Tekmetric harvest (uncontaminated test set; needs a data pull).
6. Approve building the production outcome-join flywheel now.

*Full per-angle specialist reports: `.claude/work/` scratch (eval-rigor, model-selection, workflow-architecture, training-strategy).*
