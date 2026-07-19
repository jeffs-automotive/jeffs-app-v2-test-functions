# Automotive Knowledge Base (for scheduler LLM retraining)

> **Purpose.** A thorough, expert-level reference on **every system in a car**, researched from
> trusted automotive-diagnosis sources and structured so it can be used to **retrain the scheduler's
> concern-classification LLM** (`scheduler-app/.../llm/diagnose-concern.ts`). It is BOTH (a) a
> human-readable car-repair encyclopedia an advisor/engineer can learn from, and (b) a machine-
> ingestible dataset (few-shot banks + a golden eval set + disambiguation matrices) that plugs into
> the existing eval harness.
>
> **Started:** 2026-07-18. Owner: Chris. Not a code change — pure research + docs.
>
> **▶ START HERE:** [`FINDINGS-AND-RECOMMENDATIONS.md`](FINDINGS-AND-RECOMMENDATIONS.md) — the one-page
> executive view (what's wrong, exactly what to change, expected lift, honest caveats).

---

## Why this exists (the problem)

The scheduler runs a 3-stage LLM over a customer's free-text description → (1) candidate service
categories, (2) subcategory, (3) extracted facts that decide which clarifying questions to ask. It
mis-classifies some descriptions and over-asks questions. Measured pain points (see
[`00-current-scheduler-taxonomy.md`](00-current-scheduler-taxonomy.md) §2):

- **48% of the 729 diagnostic questions have no `required_facts`** → can never be skipped → over-ask.
- Several **confusable-pair misroutes** (AC-heat vs coolant, oil vs coolant smoke, tire_repair vs
  TPMS vs suspension, …).
- **Catalog coverage gaps** (worn-tire replacement, transmission depth, driveline, fuel, EVAP,
  forced induction, hybrid/EV, ADAS, immobilizer/keys).

The fix is better domain grounding: sharper subcategory descriptions + real-voice positive/negative
examples + synonyms + keyword lines + `required_facts` tags + (where needed) new fact slots and new
subcategories. This knowledge base produces exactly those, grounded in real automotive knowledge and
real customer language.

## The 5 retraining levers each dossier feeds

| Lever | DB field | Stage |
|---|---|---|
| L1 Keywords | `testing_services.example_keywords[]` | 1 |
| L2 Subcategory meaning | `concern_subcategories.description` | 2 |
| L3 Anchor phrases | `concern_subcategories.positive_examples[]` / `negative_examples[]` | 2 |
| L4 Vocabulary | `concern_subcategories.synonyms[]` | 2 |
| L5 Fact gating | the 29 `ExtractedFacts` slots + `concern_questions.required_facts[]` | 3 + mapper |

## Folder map

```
docs/automotive-knowledge-base/
├── README.md                     ← this file (index + how to use)
├── 00-current-scheduler-taxonomy.md  ← GROUND TRUTH: live services, 107 subcats, 29 fact slots, confusable pairs
├── methodology.md                ← how the research was run + the per-system dossier template (Fable-5-informed)
├── systems/                      ← ONE expert dossier per vehicle system (the research output)
│   └── NN-<system>.md
├── binding/                      ← domain knowledge → scheduler taxonomy mapping + concrete change proposals
│   ├── system-to-subcategory-crosswalk.md
│   ├── confusable-pairs-matrix.md
│   ├── required-facts-coverage.md   ← proposed required_facts for the 349 unmapped questions
│   ├── new-fact-slots.md
│   └── catalog-gaps-and-new-subcategories.md
└── datasets/                     ← machine-ingestible (match scheduler-app/scripts/eval/ schema)
    ├── golden-cases.json          ← {text, tags, expected:{stage1_category_key, stage1_acceptable[], stage2_subcategory_slug, stage3_facts, route}}
    ├── customer-language-lexicon.md ← real-voice phrasing → canonical symptom/slot
    └── symptom-differential-table.md
```

## How to use it for retraining

1. Read `00-current-scheduler-taxonomy.md` to know the exact binding target.
2. Read the relevant `systems/` dossier(s) for expert domain grounding.
3. Apply `binding/` change proposals to the DB catalog via **/schedulerconfig** (the webform admin
   surface — this is the sanctioned edit path; never hand-edit the frozen `scripts/catalog/*` files).
4. Add `datasets/golden-cases.json` entries to the eval harness and re-run `npm run eval:diagnose`
   to measure the classification lift before/after.

## Sources & trust

Every factual claim in a dossier cites a trusted automotive source (ASE/pro-tech references,
manufacturer service info, SAE, established repair-education material) — never unsourced SEO
content. See `methodology.md` for the source policy.

## Status

- [x] Ground-truth taxonomy snapshot (`00-current-scheduler-taxonomy.md`)
- [x] Methodology / Fable-5 consult + contract docs (`methodology.md`, `dossier-template.md`, `source-policy.md`, `customer-voice-style-guide.md`)
- [x] **Wave A** — 24 per-system dossiers (write→fact-check→revise) + Workstream Q (349 questions triaged) → `systems/` (24 dossiers + 24 proposals + 24 lexicons) + `binding/required-facts-map.q{1,2,3}.md`
- [x] **Wave B** — 6 router dossiers (`routers/`) + 6 decision tables + consolidation → `binding/` + `datasets/`
- [x] **Consolidation + validation** — `binding/merged-proposals.yaml` (~1,232 lint-clean ops), `new-fact-slots.md` (11 new slots), `catalog-gaps-and-new-subcategories.md`, merged `required-facts-map.md`; `datasets/golden-cases.json` (272 cases, validated against the eval schema + live taxonomy)
- [x] **Executive summary** — [`FINDINGS-AND-RECOMMENDATIONS.md`](FINDINGS-AND-RECOMMENDATIONS.md)

**Complete.** Next step is Chris's retraining pass (Phase 5): baseline the golden set, then apply proposals slice-by-slice via /schedulerconfig, re-running `npm run eval:diagnose` after each. Lead with the value-aware `question-fact-mapper.ts` change (biggest over-ask lever).

### Workflow review (2026-07-18) — `workflow-review/`

Six Fable agents traced the whole describe-an-issue flow end-to-end (read [`workflow-review/SYNTHESIS.md`](workflow-review/SYNTHESIS.md) first). Verdict: architecturally sound + good question content, but the **"we're unsure" paths lack safety nets** — the vague→category triage you asked about does NOT exist today (silent advisor handoff), and there are 4 live bugs in the unsure paths (incl. declined tests silently re-approved, clarify path bypassing the confidence gate). Includes the concrete `concern_triage` design (`R6`) and a single deduplicated, sequenced action list.
