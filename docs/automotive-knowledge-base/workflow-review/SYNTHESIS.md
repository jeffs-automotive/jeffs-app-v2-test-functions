# Describe-an-issue workflow review — SYNTHESIS

> Six Fable agents traced the whole "describe an issue" LLM categorization flow end-to-end against the
> live code (every finding is file:line-anchored) + the automotive KB. This is the unified verdict +
> the single prioritized action list. Detail per segment: `R1`–`R6` in this folder. 2026-07-18.
>
> Judged against Chris's goal: **ask the right questions, get the correct information out of the
> customer, and when we can't classify, ask MORE questions to establish a category/subcategory.**

## Bottom line

**Does the flow make sense? Structurally, yes** — the 3-stage split (category → subcategory → facts),
the deterministic question mapper, the safe-biased defaults (over-ask, never silent-skip), the question
*content* (R5 found it independently reproduces the expert discriminators in real customer voice), and
the escapes on the 2–3-candidate "clarify" path are all right.

**Will we get the best outcome? Not yet — because of one systemic theme:** every reviewer, independently,
found that **the "we're unsure" family of paths is exactly where the safety nets are missing.** The
pipeline handles the *confident* case well and the *torn-between-2-3* case well (the clarify chip card),
but every **other** shape of uncertainty either dead-ends silently or produces an over-confident outcome:

1. **Too-vague / no category → asks nothing, hands off.** (Chris's exact concern.) The customer we most
   need to interrogate is the one we interrogate *least*. (R6, R2-P1, R1-P2, R4-P8)
2. **The clarify path has no confidence gate.** The one path built for uncertainty is the one path with
   no net — a low-confidence subcategory becomes a fee-bearing recommendation the instant the customer
   taps. (R3-P1, R4-P5, R2-P2)
3. **"Stage 2 can't pick" → ungated fee rec with ZERO questions.** The most-unsure Stage-2 outcome gets
   the *least* scrutiny. (R3-P3)
4. **The right questions get silently skipped.** The presence-not-value mapper drops marquee
   discriminators (battery-vs-starter, spongy-vs-sinking-pedal *safety* check, condensation-vs-head-
   gasket) exactly in the flow they were written for. (R5-P1, R3, FINDINGS Finding 1)

So the direct answer to your question — *"if the description is too vague, do we ask the right questions
to at least get a category?"* — is **no, not today.** We ask more only when torn between 2–3 categories;
when we have *no* idea, we silently forward to an advisor. That behavior is designed and ready to build
(R6). And on the way, the review found **4 live bugs** where the unsure paths produce a wrong or
over-confident result that should be fixed regardless of the retraining.

---

## The single prioritized action list (deduplicated across all 6 reviews)

`[code]` = flow/mapper/routing/schema change (feature workflow). `[retraining]` = catalog/prompt/DB data
(the KB's Phase 5). Severity is the merged view.

### Tier 0 — live defects to fix regardless of retraining (flows that already run)

| # | Fix | Sev | Lever | Source |
|---|---|---|---|---|
| 1 | **Declined test comes back pre-ticked and gets silently re-approved** — a fee the customer said NO to gets booked after "describe another issue". Present only undecided recs; make declines a merge not overwrite. | **HIGH (trust)** | code | R4-P2 |
| 2 | **Duplicate `other_issue` summaries clobber each other** — concern A's advisor paragraph overwritten by B's. Match by index/identity. | HIGH | code (1 line) | R4-P1 |
| 3 | **Clarify path bypasses the confidence gate** — persist per-candidate S2/S3 confidence in `precomputed`; at tap: S2-low → advisor branch, S3-low → over-ask. | HIGH | code | R3-P1, R4-P5, R2-P2 |
| 4 | **Stage-2 null/"can't pick" slug → ungated fee rec, zero questions** — route to advisor handoff (same strip as S2-low); delete the dead full-category fallback. | HIGH | code | R3-P3 |
| 5 | **Clarify tap on an "other"/situational candidate asks no follow-ups** (asymmetric with the direct path) — hydrate the precomputed ids (already persisted). | MED-HIGH | code | R4-P3 |
| 6 | **Clarify-tap hydration skips the answered/dedupe guards** → duplicate + re-asked questions. Apply the same guards run-diagnostics uses. | MED-HIGH | code | R4-P4 |
| 7 | **`submit-clarification-answer` has no step guard; drained branch can orphan the clarify queue** → a concern never gets classified. Add the guard; make drained branch clarify-aware. | MED | code | R4-P6 |
| 8 | **Null-alias enum sentinels** (`none_mentioned`, `not_stated`, `normal_or_unknown`) silently wrong-skip — a landmine under Phase-5 tagging. Drop them (null already means it) or make `isFactPresent` sentinel-aware. | MED (blocker) | code/retraining | R3-P2 |
| 9 | **Back from the question loop wipes the customer's typed work** (only mid-loop escape is destructive). Run the smart-merge on every picker resubmit; add a "previous question" affordance. | MED | code | R4-P7 |
| 10 | **Picker "not sure → pick the closest service" copy routes unsure customers to a no-questions simple chip.** Rewrite to route to "Other Issue"; move copy into the card-text editor. | HIGH (self-inflicted) | code (XS) | R1-P1 |

### Tier 1 — Chris's core ask: ask more to establish a category when we can't classify

| # | Fix | Lever | Source |
|---|---|---|---|
| 11 | **Add `no_match_reason` to Stage 1** (`non_concern` \| `too_vague` \| `no_catalog_fit`) so triage fires ONLY on the genuinely-vague slice, never on work-order lines. The enabler + an immediate observability win. | code + retraining (prompt) | R2-P1, R6-P3 |
| 12 | **Build the `concern_triage` step (R6 design):** Tier A = broad category chips ("what kind of trouble is it?") → constrained re-diagnosis → re-enters the graph (1→direct, 2-3→clarify, 0→advisor), one-round cap so it never loops; Tier B = subcategory chips when Stage-2 is low (zero LLM, reuses `overAskQuestionIds`). Escape hatch "not sure" → advisor. Worst case +2 taps, now with a category attached. | code (+ retraining: chip labels/subsets are DB-owned) | **R6** |
| 13 | **Entry-side no-signal nudge** BEFORE the LLM call — if the text has no automotive/symptom token (vocab from the lexicon/keywords) or is vague-only ("idk", "something's wrong"), one inline nudge: *"What's it doing? A noise, a leak, a warning light, won't start, a smell, a shake?"* Never a bare min-length. | code (+ retraining vocab) | R1-P2 |
| 14 | **Short-term partial (retraining-only, ships now):** broaden `multiple_symptoms_not_sure_what_category` (label/description/synonyms + rule-3 wording) to own vague concerns so its question set does the triage — *verify its first question actually establishes a system/category.* | retraining | R2-#1 |
| 15 | **P6 safety check for the chip→service map:** `concern_categories[]` tags are NOT a complete routing partition (brake *vibration* isn't tagged `vibration`). The triage chip subsets must be a hand-audited table, not a live tag filter, or triage can route WORSE than today. | retraining (audit) | R6-P6 |

### Tier 2 — over-ask + question quality (confirms + extends the KB's Phase 5, now from the flow side)

| # | Fix | Lever | Source |
|---|---|---|---|
| 16 | **Value-aware mapper** (`required_facts: [{slot, any_of:[…]}]` + or-groups) — the single biggest over-ask lever; ship BEFORE mass-tagging. Confirmed from the mapper code by 3 reviewers. | code | R3-P1(list), R5-P1, FINDINGS |
| 17 | **Interim (ships now):** blank `required_facts` on 6 high-stakes discriminators (q874 battery-vs-starter, q638 pedal safety, q286 head-gasket, q564, q320, q531) so they're always asked until #16. | retraining | R5-#2 |
| 18 | **Stage-3 prompt surgery** (one mirror commit): drop worked-example-1's forbidden `sound_or_smoke_location_zone` inference; rewrite example 7 to show wrong-slot AND right-slots; sync Zod↔JSON descriptions; delete the `trigger_conditions` ghost. | retraining | R3-P4/P6/P7, R5-P4 |
| 19 | **Repoint the Stage-3 confidence rubric** at judgment-call rate (not null-rate) so the over-ask gate isn't vacuous; add gate hit-rate + 3-bucket counts to the eval. | retraining + code | R3-P5 |
| 20 | **Rewrite double-barreled Yes/No questions** (q943, q376, q377, q666, q992) using the q375 branch-options pattern; add missing discriminators (EPS-light, heat gurgle, heard-vs-felt clunk); rewrite q762 to capture WHICH symptom. | retraining | R5-P3/P5/P7 |
| 21 | **Per-chip help/lead-in text** that fishes for each chip's top fact slots (warning_lights → which light + steady/flashing; check_battery → clicks vs cranks vs jump-fixes) — the cheapest over-ask reduction (customer's already typing). Make it DB-owned. | code + retraining | R1-P3 |
| 22 | **DB-owned `confusable_with` hedge surface** rendered into the Stage-1 catalog → land the KB's 115 hedge ops as data (today only 3 of 9 pairs are hard-coded in the prompt). | code enabler → retraining | R2-P3 |
| 23 | **Carry 'other'-bucket enrichment through the loader** (they DO have description/examples/synonyms; the loader discards them) + fix the keyword fan-out that dilutes the NVH confusable trio. | code + retraining | R2-P4/P5 |
| 24 | **Audit the ~380 already-tagged questions** with the same SAFE/PARTIAL/NEVER wrong-skip lens (they predate it) — fold into the value-aware migration. | retraining/audit | R3-P8 |
| 25 | Catalog lint (forbid option value `"skipped"`; customer-worthy category display labels; no routing-jargon in clarify descriptions); escalation `sue` false-positive + preserve concern text on escalate; `display_order` so §5 discriminators are cards 1–3; optional per-concern card cap (~4). | retraining + small code | R4-P10/P11, R1-P5, R5-P2/P6 |

---

## Recommended build sequence

1. **Tier 0 defects (#1–#10)** — independent of retraining; they fix flows that already run and several
   are 1-line/XS. #3–#7 are the clarify-path cluster (do together). #8 is a hard blocker before any
   `required_facts` tagging.
2. **`no_match_reason` (#11)** — small, and it immediately improves observability of today's handoffs.
3. **Value-aware mapper (#16)** — before mass-tagging.
4. **`concern_triage` step (#12) + entry nudge (#13)** — Chris's core ask. Design spec first
   (`frontend-design-director`) since it adds a card; then the feature workflow.
5. **Retraining Phase 5** (the KB's ~1,232 ops) + the Tier-2 question/prompt fixes — re-baseline
   `npm run eval:diagnose` on the 272-case golden set BEFORE, then measure each slice. The golden set's
   37 `null_match` cases will move once vague text re-homes (via #14/#12) — re-label them in that slice.

**Measurement:** `run_diagnostics_v2_outcome` Sentry log already carries `pending_question_count` +
`next_step` + per-concern gate/candidate data — use it as the live over-ask + handoff-rate meter
before/after each slice. Add gate-hit-rate + the 3 mapper-bucket counts (#19).

## The honest caveat

Retraining (the KB) makes the classifier *better* — it shrinks how often we land in the unsure paths.
But the unsure paths themselves (Tier 0 + Tier 1) are **flow/code**, not data — retraining lowers their
frequency, it does not fix what happens when we get there. Both halves are needed for "the best outcome."
