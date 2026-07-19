# Methodology — how this knowledge base is built and used

> Informed by a Fable 5 methodology consult (2026-07-18) + deep read of the live `diagnose-concern.ts`
> pipeline. This file is the program plan. The per-agent contract is split across
> [`dossier-template.md`](dossier-template.md), [`source-policy.md`](source-policy.md), and
> [`customer-voice-style-guide.md`](customer-voice-style-guide.md).

## Governing theses

1. **Lever-backwards research.** Every dossier section must terminate in a typed change-op against one
   of the retraining levers (see [README](README.md) L1–L5, expanded to 7 ops in
   [`dossier-template.md`](dossier-template.md) §proposals). A section that can't bind to a lever is cut,
   not polished. Impressive prose is not the goal; *measurable classifier lift* is.
2. **Two authorities, never mixed.** *Professional references* are the **diagnostic** authority (what a
   symptom implies about a system). The *customer corpus* — the 500 labeled Tekmetric concerns
   (`scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json`), the 145 authored cases
   (`eval-cases.json`), the forum set (`real-concerns-forums.json`), and NHTSA ODI complaint narratives —
   is the **linguistic** authority (how people actually say it). `positive_examples`, `synonyms`, and
   lexicon entries come from the linguistic authority; differential logic comes from the diagnostic
   authority. Customer-facing artifacts written in mechanic voice = task failure.
3. **Two waves.** Every confusable pair ([taxonomy §5](00-current-scheduler-taxonomy.md)) is a *cross-system*
   routing problem, which a per-system dossier can't own. **Wave A** researches systems in parallel;
   **Wave B** builds cross-cutting "router" dossiers (NVH, leaks, smoke/smells, warning-lights,
   no-start/power, requests/maintenance) that consume Wave A and OWN the disambiguation matrices.
4. **The 349-question triage is an audit, not research — Workstream Q.** Tagging `required_facts` is the
   single largest measurable lever (48% of questions can never skip today). It runs in parallel from the
   start, classifying each empty question SAFE / PARTIAL / NEVER (see below).
5. **Literalness is the safety-critical property.** Stage-3 must extract only what the customer *literally
   stated*. A wrongly-skipped question silently loses a diagnostic signal — worse than over-asking. Every
   fact-slot proposal ships with `literal_cues` (verbatim phrasings that set it), and golden cases include
   inference traps.

## Phase plan

| Phase | What | Who | Status / scope |
|---|---|---|---|
| 0 | Ground-truth taxonomy snapshot | main loop | **Done** — [`00-current-scheduler-taxonomy.md`](00-current-scheduler-taxonomy.md) |
| — | Contract docs (this + template + source-policy + style-guide) | main loop | **Done** |
| A | **Wave A** — ~23 per-system + long-tail dossiers (dossier + lexicon + proposals), each verified & revised | research fleet | **This deliverable** |
| Q | **Workstream Q** — triage the 349 unmapped questions → `required_facts` proposals + new-slot evidence | research fleet | **This deliverable** |
| B | **Wave B** — ~6 router dossiers + confusable matrix + differential table | research fleet | **This deliverable** |
| C | Consolidation — merge all `proposals.yaml`, lint, conflicts log; assemble `datasets/golden-cases.json` | main loop + agent | **This deliverable** |
| 5 | **Apply** proposals to the DB catalog via /schedulerconfig, slice-by-slice, re-running `npm run eval:diagnose` after each | **Chris (retraining step)** | Out of scope here — business-gated (new subcats/slots/catalog + ship). This KB produces everything it needs. |
| 6 | Golden set + harness become a standing regression suite | Chris | Follows Phase 5 |

Apply order for Phase 5 (Chris) isolates causality and de-risks: (1) `required_facts` tags (pure mapper
data, zero routing risk, biggest UX win) → (2) Stage-3 slot registry → (3) Stage-2 enrichment →
(4) Stage-1 keywords/hedges → (5) catalog changes last (they change the label space; needs a golden-set v2).

## Workstream Q — skip-safety classes

For each of the 349 empty-`required_facts` questions:
- **SAFE** — an existing (or proposed) fact combination fully answers it → propose the tag + a one-line
  `derivation_note`.
- **PARTIAL** — facts narrow but don't fully answer → tag only if partial-skip is safe, else leave empty
  with a reason.
- **NEVER** — confirmatory / consent / free-text / safety questions that must always be asked → mark
  `intentionally_empty: true` with a reason (so "48% empty" never mystifies anyone again).

Q is also the primary generator of **new fact-slot proposals**: when many questions in a category can't be
tagged for lack of a slot, that's the evidence. Rule: a new slot must unlock **≥3 questions** (else extend
an existing slot's value list instead).

## Quality gates (adversarial verify)

Each Wave A dossier is checked by a *different* verifier agent (Fable, effort xhigh): (a) citation
spot-check on a sample of diagnostic claims (uncited → deleted, not "probably fine"); (b) binding-readiness
— every failure mode carries ≥1 customer-voice phrasing + ≥1 discriminating fact; (c) every negative example
has a `routes_to`; (d) customer-voice compliance. Findings are then applied by a revise pass.

## Consolidation lint (Phase C)

- Same phrase proposed as positive/keyword for two categories → rejected from both, escalated to the owning
  Wave-B router as a hedge + matrix row.
- Synonym specificity floor — bare high-frequency words ("noise", "light", "leak", "smell") are banned as
  synonyms; a synonym must be ≥2 tokens OR a domain-specific single token ("TPMS", "serpentine").
- Stage-1 keyword budget — capped per category; each keyword must show corpus occurrences or a cited misroute.
- Every `stage3.slot.propose` meets the ≥3-question rule; every `question.required_facts.set` names facts
  that exist today or in an accepted slot proposal.

## What is explicitly NOT done here

No DB writes, no catalog mutations, no prompt edits, no eval runs against production. This is research +
proposals + datasets. Chris owns the apply/measure/ship step (Phase 5+), per `.claude/rules` (human approval
at risk points; catalog fees/capacity/marketing are business decisions).
