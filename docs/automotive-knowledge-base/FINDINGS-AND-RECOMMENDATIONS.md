# Findings & recommendations — automotive KB → scheduler LLM retraining

> **Read this first.** The one-page executive view of the whole knowledge base: what we found about why
> the scheduler mis-classifies and over-asks, and exactly what to change to fix it (with the expected lift
> and the honest caveats). Everything here is backed by the dossiers/binding/datasets in this folder.
> Generated 2026-07-18. **Nothing is applied** — this is the input to your retraining pass (Phase 5).

---

## TL;DR

1. **The over-ask problem is mostly NOT a tagging gap — it's a code limitation.** Of the 349 empty
   `required_facts` questions, only **2** are safely skippable by tagging today, **+18** unlock with 5 new
   fact slots, **250** are genuinely must-always-ask probes, and **79** are blocked because
   `question-fact-mapper.ts` skips on **presence, not value**. **The single biggest over-ask lever is making
   the mapper value-aware** (`required_facts: [{slot, any_of:[…]}]`) — a small code change that converts a
   large fraction of the 79 PARTIALs to skippable. More tagging alone barely moves it.
2. **Classification quality is a vocabulary + disambiguation problem, and it's addressable now.** Stage-2
   enrichment is already populated, so the wins are: **141 real-customer-voice positive examples** (pulled
   verbatim from your Tekmetric ROs), **267 confusable-pair negative examples** (every one routes somewhere),
   **115 Stage-1 hedges**, and **6 cross-system router decision tables** that own the routing collisions.
3. **There are real catalog holes** where customers say things with nowhere to land — starting with
   `grabby brakes` (a live Stage-3 enum value with **no** subcategory) and the tire-buying request.
4. **You can measure all of it.** `datasets/golden-cases.json` = **272 labeled cases** (validated: every
   category/subcategory key is real; routes match the grader) that drop straight into `npm run eval:diagnose`.

---

## Finding 1 — Over-asking (the 48% of questions with empty `required_facts`)

| Class | Count | % | What it means |
|---|--:|--:|---|
| **SAFE** (tag today) | 2 | 0.6% | q104 (`location_axle`), q645 (`warning_light_named`) — skippable now, zero new machinery |
| **BLOCKED** (needs a new slot) | 18 | 5.2% | Skippable once the 5 firmest new slots ship |
| **PARTIAL** (needs value-aware mapper) | 79 | 22.6% | A slot relates, but a presence-based skip would **wrong-skip** — blocked on code, not data |
| **NEVER** (`intentionally_empty`) | 250 | 71.6% | Confirmatory / safety / physical-test / never-volunteered second-round probes — must always ask |

**Why so few are SAFE:** `matchQuestionsToFacts` skips a question the moment its tagged slot is *non-null*,
regardless of value. So a tag is only safe if *every* value the customer could state fully answers the
question. Under "wrongful-skip is worse than over-ask," most of the 349 are second-round diagnostic probes
that map to no slot → NEVER. **This is the correct, conservative conclusion.**

**Recommendation (in order):**
1. **Ship a value-aware `question-fact-mapper.ts`** (`any_of` value matching). Biggest single win; unlocks
   most of the 79 PARTIALs. *This is a code change — sequence it before mass-tagging.*
2. Ship the 5 firmest new slots (`noise_rpm_link`, `ride_damping_symptom`, `pull_road_dependence`,
   `symptom_warmup_trend`, `transmission_behavior`) → +18 skippable.
3. Apply the 2 SAFE tags + mark the 250 NEVER questions `intentionally_empty` — so "48% empty" is no longer a
   mystery; each is documented as deliberately always-asked.

Full per-question map + derivations: [`binding/required-facts-map.md`](binding/required-facts-map.md).

## Finding 2 — Mis-classification (Stage 1 + Stage 2)

The routing hazards are concrete **confusable pairs**, now each owned by a router with a decision table:

| Router | Owns | Table |
|---|---|---|
| NVH | brake-vs-suspension vibration, CV click, bearing hum, valvetrain vs manifold tick | [`differential-table-nvh.md`](binding/differential-table-nvh.md) |
| Leaks | oil vs coolant, brake-fluid vs PS/trans/AC-condensation, gear oil | [`leak-decision-table.md`](binding/leak-decision-table.md) |
| Smoke/smell | blue(oil) vs white(coolant) vs black(rich), the 5 burning smells | [`smoke-smell-decision-table.md`](binding/smoke-smell-decision-table.md) |
| Warning lights | the 12 light subcats, CEL steady/flashing, red-brake escalation, customer nicknames | [`warning-light-master-table.md`](binding/warning-light-master-table.md) |
| No-start/power | no_start vs charging, click/crank/silent/security branches | [`no-start-decision-tree.md`](binding/no-start-decision-tree.md) |
| Requests/situational | work-order null-routes, the 6 situational buckets, tire-buying gap | [`requests-and-situational-routing.md`](binding/requests-and-situational-routing.md) |

**Change payload** (all in [`binding/merged-proposals.yaml`](binding/merged-proposals.yaml), lint-clean):

| Lever | Ops | | Lever | Ops |
|---|--:|---|---|--:|
| `stage2.example.negative.add` (routes_to) | 267 | | `question.intentionally_empty` | 130 |
| `stage1.keyword.add` | 207 | | `stage1.hedge.add` | 115 |
| `stage2.synonym.add` | 164 | | `question.required_facts.set` | 88 |
| `stage2.example.positive.add` | 141 | | `stage2.description.revise` | 35 |
| `stage2.subcategory.propose` | 27 | | `stage3.slot.value.add` | 18 |
| `stage3.slot.propose` | 15 | | `catalog.service.propose` (Chris-gated) | 12 |

~1,232 kept ops after dedup + lint. **12 questions have conflicting proposals flagged for you to adjudicate**
([`binding/conflicts.md`](binding/conflicts.md)) — mostly transmission-vs-clutch slot naming on shared questions.

## Finding 3 — Catalog / subcategory gaps (Chris-gated business decisions)

Customers say these; today they mis-route or dead-end. Prioritized in
[`binding/catalog-gaps-and-new-subcategories.md`](binding/catalog-gaps-and-new-subcategories.md):

- **`grabby_or_jumpy_brakes`** — `pedal_feel=grabby` is a *live* Stage-3 enum with **no** Stage-2 subcategory. Cheap subcat add.
- **Tire buying** (`just_want_new_tires` / `dry_rot`) — no catalog fit; routes to advisor quote. Confirm the intended flow.
- **Transmission depth** — one service under `performance`; propose auto/CVT/manual subcats.
- **Driveline** (CV/diff/AWD), **hybrid/EV**, **ADAS** (post-windshield calibration), **forced induction**, **immobilizer/keys**, **parking-brake-won't-hold** — thin/absent; proposals attached with corpus-demand signals so you can triage by volume.

## Finding 4 — Fact ontology (Stage 3)

**11 recommended new slots** (45 existing questions unlocked) + **11 value-adds to existing slots** + 6
cross-system dedups resolved (e.g. one canonical `transmission_behavior` folding in three competing
proposals). Full registry incl. deferred/rejected with reasons:
[`binding/new-fact-slots.md`](binding/new-fact-slots.md). **Policy note:** the `vehicle_powertrain`
"don't-infer-from-make/model" rule is intentional — any make/model allowlist to auto-skip powertrain
questions is a literalness departure and needs your sign-off.

---

## Recommended apply sequence (Phase 5 — yours to run)

Isolate causality; re-run `npm run eval:diagnose` after each slice:

1. **Value-aware `question-fact-mapper.ts`** (code) → then the SAFE tags + BLOCKED slots. *Biggest over-ask win.*
2. **New fact slots** (11) + value-adds → re-audit PARTIALs against the new mapper.
3. **Stage-2 enrichment** — positives (141) + negatives (267) + synonyms (164) + description revisions (35).
4. **Stage-1 keywords (207) + hedges (115)** + wire the 6 router decision tables.
5. **Catalog changes last** (new subcats/services) — they change the label space; regenerate the golden set (v2) alongside.

Apply catalog edits via **/schedulerconfig** (the sanctioned admin write path) — never hand-edit the frozen
`scheduler-app/scripts/catalog/*` files.

## How to measure

`datasets/golden-cases.json` (272 cases; 231 testing_service / 37 null_match / 4 advisor_handoff; 49
inference-traps, 28 null-routes, 44 gated-subcat) is schema-compatible with `scheduler-app/scripts/eval`.
See [`datasets/README.md`](datasets/README.md). Baseline it BEFORE applying anything, then measure each slice.

## Deliverable index

- **Contract:** `00-current-scheduler-taxonomy.md`, `methodology.md`, `dossier-template.md`, `source-policy.md`, `customer-voice-style-guide.md`
- **24 system dossiers:** `systems/*.dossier.md` (+ `.proposals.yaml` + `.lexicon.yaml`)
- **6 router dossiers:** `routers/*.md` (+ `.proposals.yaml`)
- **Binding:** `binding/merged-proposals.yaml`, `conflicts.md`, `required-facts-map.md` (+ `q1/q2/q3`), `new-fact-slots.md`, `catalog-gaps-and-new-subcategories.md`, 6 router decision tables
- **Datasets:** `datasets/golden-cases.json`, `customer-language-lexicon.md`, `README.md`
