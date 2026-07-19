# Consolidation conflicts & lint rejects

> Generated 2026-07-18 by `binding` consolidation (Phase C) over 30 proposals files.
> Applies the methodology.md "Consolidation lint". Rejected ops are **excluded** from `merged-proposals.yaml`.

## Summary

| Lint rule | Count |
|---|---|
| 1. Phrase claimed by two categories (rejected from both → router hedge) | 2 |
| 2. Synonym specificity floor (bare / single-token rejects) | 0 |
| 3. Negative-example orphan routes_to | 1 |
| 4. slot.propose below the ≥3-question threshold | 1 |
| 5. required_facts naming an unknown fact | 0 |
| +. Question contradictions (conflicting rf / set-and-empty) | 12 |
| **Total conflict/reject entries** | **16** |

Dedup: 32 identical ops merged. Kept ops: 1232. Lint-rejected keys: 6.

## Rule 1 — same phrase proposed for two different categories

Rejected from **both** owners; escalate to the owning Wave-B router as a `stage1.hedge` + confusable-matrix row.

| Lever | Phrase | Categories | Action |
|---|---|---|---|
| keyword | `limp mode` | check_engine_light_testing vs transmission_testing | rejected both → router hedge |
| keyword | `lifter tick` | check_engine_light_testing vs oil_pressure_light_testing | rejected both → router hedge |

## Rule 2 — synonym specificity floor

A synonym must be ≥2 tokens OR a domain single-token (TPMS/serpentine/misfire/…). Bare high-frequency words banned.

_None._

## Rule 3 — negative-example orphans (routes_to)

Every `stage2.example.negative.add` must `routes_to` a slug that exists today or is a proposed subcategory.

| Subcategory | Phrase | routes_to | Reason |
|---|---|---|---|
| white_smoke_from_tailpipe | little white steam on cold mornings that clears up within a minute, no | REJECT (advisor — benign cold-start condensation, NOT white_smoke; empty Stage-1) | malformed routes_to (prose, not a clean slug — author likely intended `advisor`) |

## Rule 4 — slot.propose below the ≥3-question threshold

Counted across all proposals (`questions_unlocked` + `required_facts.set` naming the slot) plus q-map references.

| Proposed slot | Listed unlocks | q-map hits | Decision |
|---|---|---|---|
| warm_up_behavior | 1 | 0 | downgrade-or-reject — unlocks <3 questions (listed=1, qmap=0); downgrade to stage3.slot.value.add on an existing slot or reject |

## Rule 5 — required_facts naming an unknown fact

Facts must exist in the 29-slot ontology today OR in an accepted slot proposal.

_None._

## Additional — question contradictions (require human adjudication)

These are NOT auto-rejected — both variants remain in `merged-proposals.yaml`. They flag where two
dossiers disagree on the same `question_id`: either tagging it with different `required_facts`, or one
tagging it while another marks it `intentionally_empty`. Chris/verifier picks the winner at apply time.

| Question | Type | Detail |
|---|---|---|
| 168 | conflicting required_facts | [transmission_behavior] vs [clutch_or_gear_engagement] |
| 1183 | conflicting required_facts | [transmission_behavior] vs [clutch_or_gear_engagement] |
| 1186 | conflicting required_facts | [transmission_behavior] vs [clutch_or_gear_engagement] |
| 1635 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |
| 303 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |
| 82 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |
| 291 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |
| 1185 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |
| 516 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |
| 468 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |
| 463 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |
| 600 | set AND intentionally_empty | a question is both tagged with facts and marked intentionally-empty |

## Parse warnings

- Stripped stray <content> tag while parsing systems\engine-mechanical.proposals.yaml (Wave A generation artifact).

