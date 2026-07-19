# R3 — Stage 2/3 + the deterministic mapper (which questions get asked)

> Segment review of the live "describe an issue" pipeline: subcategory pick (Stage 2), fact
> extraction (Stage 3), the presence-based question-fact mapper, and the confidence gate — i.e.
> everything that decides WHICH questions the customer is asked. Reviewed 2026-07-18 against the
> live code, the Workstream-Q required-facts map, and the new-fact-slots registry.
>
> Files: `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` (1831 lines),
> `llm/extracted-facts.ts`, `llm/question-fact-mapper.ts`, `wizard/confidence-gate.ts`,
> `wizard/actions/run-diagnostics.ts`, `wizard/actions/submit-concern-clarify.ts`,
> `llm/load-diagnostic-catalog.ts`. KB: `binding/required-facts-map.md`, `binding/new-fact-slots.md`,
> `FINDINGS-AND-RECOMMENDATIONS.md`, `datasets/customer-language-lexicon.md`.

**Verdict: mostly sound, with real gaps.** The three-stage split + deterministic mapper is the right
architecture and every default failure path is biased the safe way (over-ask, never silent-skip).
But two customer-facing seams bypass the safety net entirely (the clarify path skips the confidence
gate; a Stage-2 null-slug produces an ungated fee recommendation with zero questions), the fact
ontology contains "customer said nothing" enum values that defeat the presence rule, and two of the
canonical Stage-3 worked examples actively teach the model the wrong behavior.

---

## 1. What makes sense (keep this)

1. **Deterministic gap-detect.** The skip decision has no LLM in the critical path
   (`question-fact-mapper.ts:155-188`): facts × `required_facts[]` → answered / ambiguous /
   unanswered, sorted, reproducible. This is the correct place to have drawn the line — Stage 3 is
   independently evaluable and the mapper is unit-testable.
2. **Every failure degrades toward asking, not skipping.**
   - Empty `required_facts: []` → always ask (`question-fact-mapper.ts:163-167`).
   - Unknown slot name → treated always-null + deduped warn → ask (`question-fact-mapper.ts:100-117,
     140-143`). This also makes the pending new-slot rollout fail-safe if tags land before slots.
   - Partial coverage (ambiguous) → v1 treats as unanswered (`diagnose-concern.ts:1532-1557`).
   - Stage-3 transport failure → full-subcategory over-ask (`diagnose-concern.ts:1512-1528`).
   All consistent with the stated cost asymmetry: wrongful-skip > over-ask.
3. **The Stage-3 literalness discipline is fundamentally right.** The CRITICAL RULE + quote-test
   (`diagnose-concern.ts:952-1000`) and the three adjudicated negative-example classes (booking
   language ≠ request type; onset history ≠ onset timing; still-driving ≠ drivability,
   `diagnose-concern.ts:969-987, 1041-1068`) target the exact over-assertion patterns that cause the
   expensive error. Presence-based skipping is only survivable BECAUSE of this discipline.
4. **The confidence gate's direct-path semantics are correct** (`confidence-gate.ts:57-92`): Stage-2
   "low" strips a fee-bearing match to the advisor path; Stage-3 "low" keeps the match but re-queues
   the full subcategory question list (`run-diagnostics.ts:703-711` via `overAskQuestionIds`,
   `confidence-gate.ts:99-109`). Right direction, right asymmetry.
5. **Schema discipline** — constraint-light JSON schema as the on-wire truth, Zod as post-hoc
   defense (`diagnose-concern.ts:302-314`, `extracted-facts.ts:694-712`), enum+null form documented.
   The 2026-07-04 index-safe write-back and the answered-map preservation
   (`run-diagnostics.ts:802-899, 960-965`) make re-runs not re-ask answered questions.
6. **The KB's central conclusion is confirmed by the code.** `matchQuestionsToFacts` skips on
   presence, not value (`question-fact-mapper.ts:169-180`), and it is AND-only across a question's
   `required_facts` — so the 48% empty-tag over-ask is a **structural mapper ceiling**, not a tagging
   backlog. Only 2/349 empties are safely taggable today (`binding/required-facts-map.md:462-483`).
   The value-aware mapper (`{slot, any_of:[...]}`) is correctly identified as the single biggest
   over-ask lever, and it must ship BEFORE mass-tagging (FINDINGS-AND-RECOMMENDATIONS.md Finding 1).

---

## 2. Problems, ranked

### P1 — HIGH [code] — The clarify path bypasses the confidence gate entirely

When Stage 1 returns 2-3 candidates, `runStagesTwoAndThree` is precomputed per candidate and the
result carries per-candidate `stage2_confidence` / `stage3_confidence`
(`diagnose-concern.ts:236-250, 1778-1793`). But:

- `run-diagnostics.ts:605-676` routes clarify concerns with `gate: "pass"` and persists
  `ClarifyCandidateOption.precomputed` as ONLY `{matched_subcategory_slug,
  unanswered_question_ids}` (`run-diagnostics.ts:131-145, 637-641`) — **the confidences are
  dropped on persist**.
- `submit-concern-clarify.ts` never imports or applies `applyConfidenceGate`; the tapped
  testing-service candidate becomes a fee-bearing recommendation + its precomputed question list
  verbatim (`submit-concern-clarify.ts:415-474`).

Consequence: a candidate whose Stage-2 self-report was "low" (the forced/bad-fit pick the gate
exists to strip) becomes a paid recommendation with the wrong subcategory's questions the moment the
customer taps it — and a Stage-3-"low" candidate keeps the distrusted mapper skips instead of the
over-ask expansion. The clarify path is exactly where confidence is most suspect (Stage 1 already
declared ambiguity), yet it is the only path with no net. The customer's tap confirms the CATEGORY,
not the subcategory pick or the extraction quality — it is not a substitute for the gate.

**Fix:** persist `stage2_confidence` / `stage3_confidence` into `precomputed` (they already exist on
`CandidateDiagnosis`) and apply the same gate semantics at tap-resolution: stage2-low → resolve as
the soft advisor path (same branch as none-of-these, `submit-concern-clarify.ts:404-409`);
stage3-low → expand to `overAskQuestionIds` before hydrating pending.

### P2 — HIGH [code + retraining] — Null-alias enum values defeat the presence rule

Three slots contain values that MEAN "customer said nothing", yet `isFactPresent` counts any
non-null value as answered (`question-fact-mapper.ts:136-149`):

- `recent_action = "none_mentioned"` (`extracted-facts.ts:452, 972`) — no description text tells the
  model when (not) to use it; the name invites setting it when nothing was mentioned.
- `vehicle_powertrain = "not_stated"` (`extracted-facts.ts:629, 1065`) — the same description says
  "Only set if the customer explicitly stated it" AND offers a value literally named `not_stated`.
  Internal contradiction.
- `tire_state = "normal_or_unknown"` (`extracted-facts.ts:495, 990`) — defined as "customer didn't
  describe a tire issue" while the slot rubric says "Only set when the customer DIRECTLY described
  tire condition". Same contradiction.

If Stage 3 ever emits one of these (the schema actively invites it), every question tagged with that
slot silently wrong-skips — the expensive error class, invisible in production. This is a landmine
under Phase 5's 88 pending `question.required_facts.set` ops. Note the distinction: `unsure`
values (`location_side`, `fluid_under_car_location`, etc.) are NOT in this class — "not sure which
side" is a real customer statement and skipping the which-side question is arguably correct.

**Fix (pick one, before mass-tagging):** (a) [code] add a per-slot sentinel list to `isFactPresent`
treating these three values as absent; or (b) [retraining] delete the three values from the enums
(null already carries the meaning) — a 3-file mirror change (`extracted-facts.ts` Zod + JSON schema
+ `supabase/functions/llm-testing/index.ts` per the mirror rule at `extracted-facts.ts:32-39`).
(b) is cleaner; (a) is safer for historical persisted facts.

### P3 — MEDIUM-HIGH [code] — Stage-2 null/invalid slug = ungated fee recommendation with ZERO questions

Stage 2 may legitimately return `matched_subcategory_slug: null` ("null only if you genuinely can't
pick", `diagnose-concern.ts:352-358`) or a hallucinated slug. Then:

- `runStagesTwoAndThree` keeps the category and computes `unanswered_question_ids =`
  **every question in the whole category** (`diagnose-concern.ts:1539-1560`, via
  `collectAllCategoryQuestionIds:1166-1175`) — the intended "safe over-ask".
- But `run-diagnostics.ts:837` skips pending-queue hydration whenever
  `!r.result.matched_subcategory_slug` — so those ids are **silently dropped** and the customer gets
  the testing-service recommendation with NO clarifying questions at all.
- And the Stage-2-low gate can't catch it: `stage2Low` requires a NON-null slug
  (`confidence-gate.ts:64-67`), on the documented-but-wrong premise that a null slug only happens on
  transport failure (`confidence-gate.ts:36-39`). A ran-but-couldn't-pick Stage 2 is not a transport
  failure.

Net: the single most-unsure Stage-2 outcome ("nothing fits this category") produces the LEAST
scrutiny — a fee-bearing recommendation, zero questions, no advisor-handoff flag. That is precisely
the "cannot confidently classify → ask more or hand off" case Chris cares about, and it currently
dead-ends into a confident-looking recommendation. The full-category over-ask in diagnose-concern is
effectively dead code (its consumer refuses to hydrate slug-less ids) — an intent/consumption
mismatch between the two files.

**Fix:** for testing-service matches with a null/unresolvable slug, route advisor handoff (same
strip as stage2-low) — a subcategory-less match can't drive the question catalog anyway. Then delete
or repurpose the `collectAllCategoryQuestionIds` fallback so the code says what actually happens.

### P4 — MEDIUM [retraining] — Worked example 1 teaches a forbidden inference into `sound_or_smoke_location_zone`

`diagnose-concern.ts:1013-1018`: "Steering wheel shakes at exactly 65 mph" →
`sound_or_smoke_location_zone: "behind_dashboard"   (steering wheel area)`. A steering-wheel
VIBRATION is neither a sound nor smoke, and "behind the dashboard" was never stated — this is
exactly the "mechanical interpretation of what the customer described" the CRITICAL RULE forbids
five paragraphs earlier (`diagnose-concern.ts:961-967`). The KB independently established that
vibration felt-location has NO slot and deferred `vibration_felt_location` precisely because
presence-skipping on it wrong-skips (`binding/new-fact-slots.md` Table 3). Example 1 is the model's
strongest signal (first worked example) and it pollutes a slot that IS used in tagged questions.
**Fix:** drop the `sound_or_smoke_location_zone` line from example 1 (leave it null); everything
else in the example is correct.

### P5 — MEDIUM [retraining] — Stage-3 confidence rubric measures sparseness, not extraction risk, making the over-ask gate nearly vacuous

The rubric defines low as "the description was vague and you set most slots to null"
(`diagnose-concern.ts:396-406, 1076-1084`). But an honest mostly-null extraction already makes the
mapper mark nearly everything unanswered — so when `over_ask` fires (`confidence-gate.ts:82-89`) it
barely changes the question set. Meanwhile the gate's actual target — a wrongly ASSERTED fact that
skips a question — comes from confident extractions on rich descriptions, which self-rate
medium/high and pass. The gate catches the harmless case and misses the harmful one.
**Fix:** repoint the rubric: low = "I made judgment calls / mapped paraphrases to enum values /
non-verbatim interpretations", explicitly NOT "sparse but clean" (sparse+clean = high). Add gate
hit-rate + skipped-question-count-delta to `npm run eval:diagnose` so the change is measured.

### P6 — MEDIUM [retraining] — Negative example 7 teaches "extract nothing" where the registry itself defines the literal mapping

`diagnose-concern.ts:1053-1058` forbids `onset_timing="when_idling"` for "AC is fine on the highway
but useless sitting at a stoplight" — defensible — but shows NO correct positives, although the slot
registry itself maps this very phrase: `speed_band` docs say "stopped = parked or at a red light …
'when I'm stopped at a light'" (`extracted-facts.ts:110-117, 770-771`), and `hvac_mode="ac"` is
verbatim. The example as written teaches "rich sentence → all nulls", i.e. under-extraction → the
mapper re-asks things the customer already said — the over-ask failure mode, on a pipeline whose S3
eval already sits at 0.606 FAIL. It also exposes a real ontology overlap the model has to gamble on:
"at a stoplight" plausibly maps to `onset_timing=at_stop`, `onset_timing=when_idling`,
`speed_band=stopped`, or `speed_band=idle` — four near-synonymous homes for one phrase.
**Fix:** rewrite example 7 to show the wrong slot AND the right ones (`hvac_mode="ac"`,
`speed_band="stopped"`), so the lesson is "wrong slot ≠ no slot". Longer term, sharpen the
`at_stop`/`when_idling` vs `speed_band` boundary text in both slot descriptions (the KB q-map calls
`onset_timing` "overloaded" in 8+ rows; this overlap is why).

### P7 — MEDIUM [retraining] — Zod↔JSON-schema description drift: the tie-break rules never reach the LLM, and one references a slot that doesn't exist

The Zod descriptions carry two behavioral rules that the on-wire schema and the Stage-3 prompt slot
list (built from `EXTRACTED_FACTS_JSON_SCHEMA` via `renderExtractedFactsSlotList`,
`diagnose-concern.ts:889-915`) omit:

- `onset_timing`: "If multiple apply … pick the most-emphasized one — the mapper will dispatch the
  rest from **trigger_conditions**" (`extracted-facts.ts:159-162`) — absent from the JSON description
  (`extracted-facts.ts:795-796`), and `trigger_conditions` is not one of the 29 slots. Ghost
  reference; the "dispatch the rest" promise is false.
- `started_when`: "If both a duration AND a sudden/gradual descriptor are given, prefer the
  sudden/gradual descriptor" (`extracted-facts.ts:182-185`) — absent from the JSON description
  (`extracted-facts.ts:811-812`).

So on "clunks over bumps and when turning" or "been doing it for months, suddenly got worse", the
model has no stated tie-break and single-select enums silently drop a diagnostic signal.
**Fix:** sync the JSON-schema descriptions to carry both rules (minus the ghost), delete the
`trigger_conditions` sentence, mirror to the edge copy in the same commit. Note the multi-trigger
information loss itself (single-select `onset_timing`) is a known KB theme — the value-aware mapper
plus the Table-2 value-adds are the structural answer; this fix just stops the drift.

### P8 — MEDIUM [retraining/audit] — The ~380 already-tagged questions were never triaged for wrong-skip

Workstream Q triaged the 349 EMPTY-tag questions and, in doing so, proved its wrong-skip classes are
real — 6 dossier SAFE proposals were downgraded for subcat-entry auto-skip and dimension mismatch
(`binding/required-facts-map.md:505-517`, e.g. q1003: `fluid_color` is the subcategory-entry slot,
always present → tag would auto-skip a confirmation; q642 same pattern for `pedal_feel`). The ~380
questions that ALREADY carry `required_facts` (loaded verbatim from `concern_questions.required_facts`,
`load-diagnostic-catalog.ts:223-259`) were tagged before this lens existed and were only touched by
13 incidental ops ("Not counted here", `required-facts-map.md:541-545`). Any live tag with the same
patterns wrong-skips TODAY, silently. **Fix:** run the identical SAFE/PARTIAL/NEVER triage over the
live 380 (one SQL snapshot + the same audit prompt), ideally as part of the value-aware mapper
migration since tags will be rewritten into `{slot, any_of}` form anyway.

### P9 — LOW-MEDIUM [code] — AND-only mapper cannot express OR; bake OR into the value-aware design

Several KB rows are OR-designs the current mapper can't encode (q89 `recent_action=tire_* OR
tire_state=uneven_wear`; q1172 `smoke_color=black OR smell_descriptor=gasoline` —
`required-facts-map.md:179, 224`). `matchQuestionsToFacts` requires ALL listed facts present
(`question-fact-mapper.ts:169-180`). When the value-aware mapper ships, the schema should support
both `any_of` within a slot AND or-groups across slots, or those questions stay permanently
over-asked and the triage will re-litigate them.

### P10 — LOW [code] — No telemetry separates ambiguous from unanswered

The buckets are unioned before anything observes them (`diagnose-concern.ts:1554-1557`) and the
Sentry breadcrumb records only `unanswered_count` (`run-diagnostics.ts:731`). You cannot currently
measure how much the v1 ambiguous-as-unanswered policy costs, which is exactly the number that
justifies (and later validates) the value-aware mapper. Log the three bucket counts per concern.

### P11 — LOW [code] — Stage-2 runs a pointless LLM call for 'other' singletons

For 'other'-subcategory matches Stage 2 is a pick-from-ONE (`diagnose-concern.ts:765-779`, prompt
even says "(For 'other' matches there is only ONE choice — pick it.)" at :820). Latency + tokens for
a deterministic outcome on the advisor-bound path. Short-circuit in code; keep Stage 3 (its facts
still feed the 'other' questions, which DO hydrate — `run-diagnostics.ts:401-408`).

---

## 3. Best-outcome gaps (Chris's frame: right questions, correct info, ask-more-when-unsure)

1. **A customer who taps a clarify chip has no safety net** — the one flow designed for "we're not
   sure" is the one flow where low Stage-2/3 confidence changes nothing (P1).
2. **The most-unsure Stage-2 outcome produces a confident paid recommendation with zero follow-up
   questions** instead of more questions or a handoff (P3) — the direct inversion of "when we can't
   classify, ask more."
3. **Over-ask stays at ~48% until the mapper is value-aware.** No amount of Stage-3 prompt tuning or
   tagging moves the 79 PARTIALs; the KB's sequencing (mapper first, then slots, then tags) is
   correct and this review confirms it from the mapper code.
4. **Under-extraction is being trained in** by example 7 and the description drift (P6, P7): facts
   the customer DID state get nulled → re-asked. Given S3's 0.606 adjudicated eval, the
   literalness-tightening iteration should distinguish "don't invent" from "don't extract".
5. **Silent wrong-skip vectors exist** — sentinel enums (P2), example-1's slot pollution (P4),
   unaudited legacy tags (P8). Wrong-skips never surface to anyone: the customer isn't asked, the
   advisor doesn't know a question existed. These deserve priority over any over-ask work because
   the system's own cost model says so.

## 4. Prioritized recommendations

| # | Fix | Lever |
|---|---|---|
| 1 | Value-aware mapper (`required_facts: [{slot, any_of}]` + or-groups), sequenced before the 88 pending tag ops; migrate existing tags into the new form | **[code]** |
| 2 | Persist per-candidate confidences into `ClarifyCandidateOption.precomputed`; apply gate semantics (stage2-low→advisor branch, stage3-low→overAsk) in `submit-concern-clarify` | **[code]** |
| 3 | Null/invalid Stage-2 slug on a testing-service match → advisor handoff; remove the dead full-category fallback | **[code]** |
| 4 | Neutralize `none_mentioned` / `not_stated` / `normal_or_unknown` (sentinel-aware `isFactPresent` OR drop from enums + edge mirror) — decide before mass-tagging | **[code or retraining]** |
| 5 | Stage-3 prompt surgery: drop example 1's `sound_or_smoke_location_zone` line; rewrite example 7 with the correct positive slots; sync Zod↔JSON descriptions and delete the `trigger_conditions` ghost (3-file mirror commit) | **[retraining]** |
| 6 | Repoint the Stage-3 confidence rubric at judgment-call rate (not null-rate); add gate hit-rate + bucket counts to the eval and breadcrumbs | **[retraining + small code]** |
| 7 | Triage the ~380 live `required_facts` tags with the q-map wrong-skip classes | **[retraining/audit]** |
| 8 | Short-circuit Stage 2 for 'other' singletons | **[code, minor]** |

Items 2-4 are pre-Phase-5 blockers in spirit: they are the places where today's pipeline can
already produce the expensive outcome (wrong-skip / ungated fee rec) rather than merely the cheap
one (extra questions).
