# Act-or-ask on real customer concerns — evaluation report (2026-07-03)

> Chris's proposed workflow (2026-07-03): Stage 1 picks a category AND decides whether it has
> enough information; when torn it surfaces candidates and the customer disambiguates; clear cases
> skip straight through. Simulated end-to-end on REAL concern texts only (no synthetic authoring —
> Chris: "I don't want you coming up with the customer concerns"). Target: dangerous misroutes
> ≤ 1-in-50.

## 1. Data — all real, all provenance-tracked

| Corpus | Size | Source | Verification |
|---|---|---|---|
| Forum concerns | 247 | 2carpros, CarTalk community, Reddit, owner forums (12 symptom domains) | verbatim-only rules; 72/72 spot re-fetches found the quote on the page |
| Tekmetric concerns | 500 (stratified from 4,744 unique) | `tekmetric_ro*` mirror — ROs with DIAGNOSTICS-category jobs, 2024→2026 organic era | 300 customer-typed style / 200 advisor-shorthand; PII-filtered, deduped |

Ground truth: every text independently labeled by three judge families (gpt-5.4,
gemini-3.5-flash, claude-sonnet-5 — deliberately NOT the candidates under test), category +
subcategory passes; consensus = 2-of-3. No-consensus cases (28 forum / 42 Tekmetric) are graded
separately as "genuinely ambiguous". Labeler: `scripts/eval/label-real-concerns.ts`.

The Tekmetric mirror itself (148,170 ROs, 941k jobs, 31,781 concern lines, zero unknown-field
alerts) shipped the same day — `docs/tekmetric/ro-mirror-plan.md`.

## 2. The simulated contract (`scripts/eval/run-act-or-ask.ts`)

One LLM call returns 0–3 RANKED candidates: 1 → direct route; 2–3 → one choice-chip question,
customer's tap resolves deterministically (simulated tap = consensus label when present among
candidates, else "none of these" → advisor); 0 → advisor. p50 latency ~800–950 ms/call.

## 3. Results — real-concern graded pool (consensus is an actual category)

"Hard misroute" = direct single-candidate route to the wrong category where the model can't be
excused by a label dispute (it disagreed with a unanimous label, or invented an answer no judge
gave). This is the number Chris's 1-in-50 bar governs.

| Model | Forum (219 graded) | Tekmetric real concerns (345) | Combined hard-misroute rate | Friction (Tek / forum) |
|---|---|---|---|---|
| **gemini-3.1-flash-lite** | 1 hard (rest = tire-gap, below) | 4 hard → 1-in-86 | **5/558 ≈ 1-in-112** ✅ | 43% / 48% |
| claude-haiku-4-5 (current) | 2 hard | 10 hard → 1-in-35 | 12/558 ≈ 1-in-47 ⚠️ borderline | 45% / 58% |
| gpt-5.4-mini | 2 hard | 3 hard → 1-in-115 | **5/557 ≈ 1-in-111** ✅ (but 65% friction) | 65% / 74% |

- Flash-Lite and gpt-5.4-mini clear the 1-in-50 bar on real data under this contract; mini pays
  for it with ~1.5× the clarification friction. Haiku sits at the bar's edge.
- Friction efficiency: ~25% of clarifications saved a would-be misroute, ~20% correctly diverted
  no-fit texts to an advisor, the rest cost one tap where the top pick was already right
  (Flash-Lite Tekmetric: 149 clarifications = 33 saved + 31 diverted + 85 one-tap-cost).
- Ambiguous cases (no 2-of-3 consensus): on forums all three models clarified-or-handed-off
  82–93% of them (the designed behavior). On Tekmetric only ~50–70% — but most Tekmetric
  ambiguity is channel noise (below), not describable vehicle symptoms.

## 4. Findings the real data forced out (things synthetic data never showed)

1. **Catalog gap — physical tire problems.** Slow leaks, nails, flats have NO catalog home
   (`tpms_testing` is sensor testing). Judges unanimously label them "no fit"; models route them
   to tpms/suspension. 6 of Flash-Lite's 7 raw forum hard-misses were exactly this. The shop HAS
   tire-repair canned jobs (`TIRE REPAIR WITH PATCH/PLUG`). Adding a tire-repair catalog entry
   deletes the single biggest real-world error class.
2. **The Tekmetric concern channel is ~24% non-concern noise** — auto-generated
   `Previously declined>` carryovers (22/500), logistics ("Will pay over phone & p/u after
   hours"), scheduling ("needs by 11am 6/13"), advisor work orders. Models guess a category on
   ~30% of these instead of handing off. Wizard customers won't type most of this register, but
   it calibrates the "none-fit → advisor" behavior, which needs prompt/gate reinforcement.
3. **Repair-request texts** ("Replace front wheel hub", "recharge a/c system", alignment
   requests) — real customers DO know what they want sometimes; the diagnostics-only catalog has
   no landing for service requests. Worth a product decision (Chris): route to advisor, or map
   the common ones (alignment, AC recharge, tire repair) to bookable entries.
4. **Register matters.** The same models show ~48–74% friction on long forum rambles but
   35–45% (Flash-Lite/Haiku) on shop-register lines. Real wizard texts sit between; the growing
   wizard-typed corpus (`Tell us>` lines now flowing into the mirror) is the truth source to
   re-measure on.

## 5. Verdict + what production adoption needs

The act-or-ask shape does what Chris designed it to do on real data: errors either become one-tap
clarifications or advisor handoffs, and the dangerous-misroute rate lands past 1-in-50 for
**gemini-3.1-flash-lite** (1-in-112 combined) — consistent with the earlier synthetic head-to-head
(`llm-model-verification-2026-07-02.md`) that picked the same model.

Before production (decisions pending Chris):
1. Add the tire-repair catalog entry (+ decide on repair-request routing) — biggest single win.
2. Implement the candidates contract in `diagnose-concern.ts` Stage 1 (schema + prompt) + the
   chip card in the wizard + deterministic resolution; "none of these" → advisor handoff.
3. Move the production transport to gateway-generic for non-Claude stages (eval harness already
   proves the path); re-tune the confidence gate per family; Stage-3 stays OpenAI-or-Haiku per
   the Gemini 29-enum schema cap.
4. Keep re-running this eval as the wizard-typed corpus grows (real `Tell us>` lines in
   `tekmetric_ro_customer_concerns`).

Artifacts: `real-concerns-{forums,tekmetric}.json` + `-labeled` variants,
`act-or-ask{,-tekmetric}-report.json` (per-case rows), `label-real-concerns.ts`,
`run-act-or-ask.ts` — all under `scheduler-app/scripts/eval/`.
