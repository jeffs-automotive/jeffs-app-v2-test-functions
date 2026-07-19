# Per-system dossier template + proposals schema

> Every Wave A agent produces THREE files under `systems/`:
> `{slug}.dossier.md` (human), `{slug}.lexicon.yaml`, `{slug}.proposals.yaml` (typed ops).
> Wave B routers use the reduced template (§ Router variant).

## `{slug}.dossier.md` — section order (sections 3,4,5,8,9 are load-bearing)

```markdown
# {System name} — diagnostic dossier
slug: {stable-kebab-slug}   date: 2026-07-18   binds_services: [...]   binds_categories: [...]

## 1. Scope & boundaries
In-scope components/functions. Explicitly OUT of scope, each with the neighbor dossier slug that owns it.

## 2. System primer (expert, ~1 page, CITED)
Components, operating principle, common architectures + notable variants (EPS vs hydraulic steering; CVT
vs stepped auto; drum vs disc; port vs direct injection; ICE vs hybrid/EV where relevant).

## 3. Failure-mode catalog  ← the diagnostic spine (CITED per mode)
One entry per failure mode:
- Sensory signature in FACT-SLOT vocabulary where possible (noise_descriptor=grinding_metallic, etc.)
- Conditions & modifiers (speed_band, onset_timing, temperature, weather, engine on/off) in slot vocab
- Severity / drivability (map to drivable_state)
- Typical customer misattribution ("customers call this X, it's actually Y")
- Source cite (tier)

## 4. Customer-language lexicon  ← binds synonyms / keywords / positive_examples
Real-voice phrasings per failure mode. Source order: Tekmetric corpus first, NHTSA narratives second,
synthetic last (flagged). Include misspellings ("breaks squeeking"), part-name misuse ("rotors" for pads),
slang ("bucking", "death wobble"), mixed symptom+request ("brakes grinding need them checked asap"), and
vague forms ("weird noise up front"). Each: phrase → target subcategory slug → ambiguity (unambiguous /
needs-fact-X / cross-system).

## 5. Differential & discriminating questions  ← binds required_facts + slots
For each pair of confusable failure modes (within-system AND vs neighbor systems): the ONE best
discriminating question + the FACT SLOT + value that answers it. If no current slot can hold the answer →
that is a slot proposal. This is Wave B's raw material.

## 6. Warning lights & DTC surface
Dash lights this system triggers; solid vs flashing semantics; customer names ("squiggly car light",
"exclamation-point tire thing"). Feeds warning_light_named / warning_light_behavior values.

## 7. Confusable neighbors (cross-system)
Other systems this gets confused with + the discriminator. Cross-reference neighbor dossier slugs.

## 8. Mapping to current taxonomy  ← binds catalog + subcategory proposals
Table: failure mode → current testing service(s) → current category → current subcategory slug →
fit (good / weak / NO FIT). Every NO FIT becomes a subcategory or catalog proposal with demand evidence.

## 9. Fact-slot audit
Which of the 29 slots this system uses; values customers actually state (corpus evidence); missing values;
proposed new slots (≥3-question rule).

## 10. Sources
Per-claim citation list, tiered (see source-policy.md). Diagnostic claims cite Tier 1/2; language cites corpus.

## 11. Binding-readiness self-check
Self-score the Gate-G2 checklist so the verifier diffs rather than re-derives.
```

## `{slug}.proposals.yaml` — typed change-ops (bind to snapshot IDs/slugs)

```yaml
system: {slug}
ops:
  - op: stage1.keyword.add          # {category_key, phrase, rationale, evidence}
  - op: stage1.hedge.add            # {category_a, category_b, rule, discriminating_fact}
  - op: stage2.description.revise   # {subcat_slug, text, why}
  - op: stage2.example.positive.add # {subcat_slug, phrase, provenance: tekmetric|nhtsa|forum-paraphrase|synthetic}
  - op: stage2.example.negative.add # {subcat_slug, phrase, routes_to: <subcat_slug>}   # routes_to REQUIRED
  - op: stage2.synonym.add          # {subcat_slug, term}   # ≥2 tokens or domain-specific single token
  - op: stage2.subcategory.propose  # {category, name, description, examples, why_existing_insufficient}
  - op: stage3.slot.value.add       # {slot, value, literal_cues: [verbatim phrasings]}
  - op: stage3.slot.propose         # {name, type, values, literal_cues, questions_unlocked: [ids]}  # ≥3
  - op: question.required_facts.set # {question_id, facts, skip_class: SAFE|PARTIAL, derivation_note}
  - op: question.intentionally_empty# {question_id, reason}
  - op: catalog.service.propose     # {name, demand_evidence, fee_rationale}   # Chris-gated
```

## `{slug}.lexicon.yaml`

```yaml
system: {slug}
entries:
  - phrase: "my breaks are squeeking when i stop"
    normalized: brake squeal on application
    routes_to: [high_pitched_squealing]          # subcategory slug(s)
    ambiguity: unambiguous                        # unambiguous | needs-fact:<slot> | cross-system:<slug>
    provenance: tekmetric
```

## Golden cases (each Wave A agent contributes ≥8; match the eval harness schema)

Emit inside `proposals.yaml` under `golden_cases:` (Wave C aggregates into `datasets/golden-cases.json`).
Schema mirrors `scheduler-app/scripts/eval/eval-cases.json`:

```yaml
golden_cases:
  - text: "loud grinding from the front right when i brake, feels like metal on metal"
    tags: [fact_rich]
    expected:
      stage1_category_key: brake_inspection
      stage1_acceptable: [brake_inspection, brake_inspection_warning_light]
      stage2_subcategory_slug: metallic_grinding
      stage3_facts: { noise_descriptor: grinding_metallic, location_side: right, location_axle: front, onset_timing: when_braking }
      route: testing_service
```

Include ≥1 inference-trap case per dossier (a description that tempts an over-assertion the extractor must
NOT make) and, where relevant, ≥1 null-route case (a work-order line that is NOT a concern → `route: advisor`,
empty stage1).

## Router variant (Wave B)

Sections 1, 4, 5, 10 + the signature deliverable in machine form:
- `router-nvh` → `binding/differential-table.md` rows (noise/vibration descriptor × condition → ranked systems)
- `router-leaks` → fluid color/location/smell decision table
- `router-smoke-smells` → smoke color/source + smell decision table
- `router-warning-lights` → master light list + customer nicknames + solid/flashing semantics
- `router-no-start-power` → won't-start decision tree (click / crank-no-fire / silent / security light)
- `router-requests-maintenance` → non-symptom language ("need brakes", "oil change", "road-trip check",
  "check before I buy it"), the 6 situational buckets, `customer_request_type`, null-routes, tire-buying gap

Each router also emits `proposals.yaml` ops (especially `stage1.hedge.add` + `stage2.example.negative.add`)
and OWNS the `binding/confusable-matrix.yaml` rows for its assigned confusable pairs.
