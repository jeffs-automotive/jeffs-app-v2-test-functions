# R4 — Clarify card + question loop + routing + multi-concern (post-diagnosis flow)

> Segment review, 2026-07-18. Scope: everything AFTER `diagnoseConcern` returns — the
> `concern_clarify` chip card, the one-question-at-a-time loop, `routeAfterDiagnostics`,
> multi-concern aggregation, the "describe another issue" loop, and summary building for the
> advisor. Judged against Chris's goal: *ask the right questions, extract the correct
> information, and when we can't classify, ask MORE to establish a category/subcategory.*
>
> All routing facts below are grounded in code (file:line). Severity ordering is mine;
> each recommendation is tagged **[code]** (flow/mapper/routing change) or **[retraining]**
> (catalog/keywords/examples/required_facts data change).

---

## 1. What makes sense (keep this)

- **Deterministic tap resolution.** The clarify card resolves from precomputed per-candidate
  Stage-2/3 payloads — no second LLM call, no second spinner
  (`run-diagnostics.ts:602-676`, `submit-concern-clarify.ts:1-40`). The customer's tap is
  cheap, instant, and auditable (`scheduler_audit_log` insert at
  `submit-concern-clarify.ts:569-591`).
- **The routing rule is one function, used at every terminus.** `route-after-diagnostics.ts:33-55`
  (pending → questions; recs → approval; neither → advisor pass) is invoked identically from
  `run-diagnostics.ts:908-914`, `submit-concern-clarify.ts:510-516`, and
  `submit-clarification-answer.ts:283-287`, and the clarify queue is given top priority both on
  the fresh pass (`run-diagnostics.ts:908-910`) and on the idempotent re-entry
  (`run-diagnostics.ts:466-488`). The seams line up.
- **The question loop's shape is right.** One card per question (Chris's directive), skip is a
  first-class valid answer, multi-select is validated server-side (shape, empty, unknown values,
  duplicates — `submit-clarification-answer.ts:212-239`), stale double-taps are rejected via the
  queue-head check (`:192-206`), and the chosen labels echo into the transcript as the user
  bubble (`:269-276`).
- **The clarify card asks a good category-level question.** "Which of these sounds closest?" +
  the customer's own words echoed as a pull-quote + ranked candidates with price/"We'll take a
  look" pills + an always-present "None of these — pass it to an advisor" escape
  (`ConcernClarifyCard.tsx:110-224`, copy defaults `card-text.ts:245-259`). The customer can
  never be trapped: even the malformed/empty-queue stub renders the escape-only card
  (`get-current-card.ts:451-461`).
- **The describe-another-issue loop is carefully engineered.** Selective re-diagnosis skips
  already-diagnosed concerns, never wipes the answered map, and excludes already-answered
  question ids from the rebuilt queue (`run-diagnostics.ts:507-549`, `:813-833`, `:960-965`);
  the write-back of per-concern question ids is index-keyed to survive duplicate `other_issue`
  service_keys (`run-diagnostics.ts:802-869`, `submit-concern-clarify.ts:481-496`).
- **Advisor capture is mostly real.** The Tekmetric description gets the deterministic
  "Customer states …" paragraph WITH the Q&A follow-up clauses (`concern-summary.ts:23-45`,
  `build-service-summary.ts:138-148`), skipped/"not sure" answers are dropped per Chris's
  directive (`ensure-concern-summaries.ts:248-260`), and the transcript email carries approved
  AND declined testing services (`transcript-dispatcher/index.ts:561-575`).

---

## 2. Concrete problems, ranked

### P1 — HIGH [code] — Duplicate `other_issue` concerns clobber each other's summaries

`ensure-concern-summaries.ts:280-284` maps generated summaries back onto items **by
`service_key`**:

```ts
const match = summaries.find((s) => s.item.service_key === it.service_key);
```

Every entry the describe-another-issue loop appends has `service_key = "other_issue"`
(`submit-second-routine-pass.ts:53`, `:208-214`). Concrete failure: concern A ("brakes
grinding", typed via Other Issue) gets its summary at pass-1 queue-drain. The customer
describes concern B ("AC blows warm"). At pass-2 drain, `itemsToProcess` = [B] (A already has
`summary`), and the write-back loop matches **both** A and B to B's summary — **concern A's
paragraph (including its Q&A follow-ups) is overwritten by concern B's**, and the Tekmetric RO
description prints B's paragraph twice. The same cross-assignment corrupts the both-fresh case
(B receives A's summary). This is the *same duplicate-key clobber class* the 2026-07-04 fixes
eliminated in run-diagnostics (`run-diagnostics.ts:802-810`) and submit-concern-clarify
(`submit-concern-clarify.ts:481-491`) — this third site was missed.

**Fix:** match by object identity (`s.item === it` — `itemsToProcess` filters the same
references) or carry the item index. One line.

### P2 — HIGH [code] — Declined tests come back pre-ticked and get silently re-approved

Sequence: pass 1 recommends an expensive test (e.g. $179.95); the customer **declines** it on
the approval card; then taps "describe another issue" at `second_routine_pass`. The second
diagnostic pass seeds recommendations from the existing row
(`run-diagnostics.ts:761-777` — the declined rec is still in
`recommended_testing_services`; declining never removes it,
`submit-testing-service-approval.ts:120-127`). When routing returns to
`testing_service_approval`, `get-current-card.ts:473-494` renders **all** recommendations with
no approved/declined state, and `TestingServiceApprovalCard.tsx:53-57` **pre-selects every
row** ("the friction-free path is yes"). If the customer just hits continue:
`submit-testing-service-approval.ts:111-113` unions it into `approved_testing_services` and
**overwrites `declined_testing_services` with `[]`** — the earlier explicit decline is erased
and a fee-bearing test the customer said NO to is booked. Even in the benign re-approval case,
the customer is re-asked a question they already answered (against the segment's own goal).

**Fix:** filter the approval-card payload to recommendations not yet decided
(`recommended − approved − declined`), or pass prior state down and pre-tick from it; and make
the declined write a merge, not an overwrite. Anchors: `get-current-card.ts:484-494`,
`TestingServiceApprovalCard.tsx:53-57`, `submit-testing-service-approval.ts:94-127`.

### P3 — HIGH [code] — Clarify tap on an "other"/situational candidate asks NO follow-up questions (asymmetric with the direct path)

`submit-concern-clarify.ts:404-415`: only a `testing_service` candidate hydrates questions;
an `other_subcategory` choice (and none-of-these) is "no recommendation, no questions". But the
**direct-match path asks the other-bucket's questions**: `run-diagnostics.ts:835-869` queues
questions for ANY matched category, and `findQuestionInCatalog` explicitly handles
`other_subcategory` kinds (`run-diagnostics.ts:395-408`). The six situational buckets carry
questions (taxonomy §3b/§4 — "105 of 107 subcategories carry questions"), and the precomputed
payload for other-kind candidates **already contains** `unanswered_question_ids`
(`run-diagnostics.ts:622-641` persists `cr.unanswered_question_ids` regardless of kind) — the
resolution path just ignores them. So the customer who says "started after my accident, now it
clunks" and taps "After a recent accident or impact" is asked *nothing* (when was the accident?
where was the impact?), while the customer whose text matched that bucket directly IS asked.
The ambiguous cases — exactly the ones where the shop needs more info — get less extraction.
This contradicts the header's own "mirrors run-diagnostics aggregation EXACTLY" claim
(`submit-concern-clarify.ts:18`) and Chris's "ask more to establish category/subcategory" goal.

**Fix:** hydrate the chosen other-candidate's precomputed ids the same way the
testing-service branch does (the catalog lookup + PendingQuestionEntry build already exist in
the file). Advisor handoff and question-asking are not mutually exclusive — the answers land in
the concern summary the advisor reads.

### P4 — MEDIUM-HIGH [code] — Clarify-tap hydration skips the answered/dedupe guards → duplicate and re-asked questions

`run-diagnostics.ts:813-833` guards the pending queue with `answeredIds` (never re-ask an
answered question) and `queuedIds` (never queue the same id twice).
`submit-concern-clarify.ts:444-460` has **neither**: it pushes the chosen candidate's
precomputed ids straight onto `nextPending` without checking `clarification_questions_answered`
(the column isn't even selected — `:343-349`) or the ids already in `existingPending`.
Concrete failures: (a) two concerns whose resolutions share a question (both land on the same
subcategory) → the identical question card is shown twice back-to-back, the second answer
overwriting the first in the answered map; (b) in the describe-another-issue loop, a clarify
tap re-queues questions the customer already answered in pass 1 → the exact over-ask the
selective-re-diagnosis machinery was built to prevent.

**Fix:** read the answered map in the select, and apply the same
`answeredIds`/`queuedIds` guards as `run-diagnostics.ts:815-820` before pushing.

### P5 — MEDIUM [code] — Confidence gate is never applied on the clarify path

The direct path gates every result: Stage-2 "low" strips the match to advisor handoff, Stage-3
"low" over-asks the full subcategory question list (`run-diagnostics.ts:683-711`,
`confidence-gate.ts:57-108`). `CandidateDiagnosis` carries per-candidate
`stage2_confidence`/`stage3_confidence` (`diagnose-concern.ts:236-250`), but the persisted
`precomputed` payload drops both (`run-diagnostics.ts:637-640`), so the tap resolution can't
gate. Result: a candidate whose *subcategory* pick was self-rated low (the tap confirms the
CATEGORY, not the subcategory) and whose fact extraction was self-rated low still produces a
fee-bearing recommendation with the distrusted fact-mapper skip set — the "wrongly asserted
fact SKIPS a question" failure the gate exists to prevent, on precisely the ambiguous concerns.
(Stage-3 *failure* is safe — it already degrades to the full list inside
`diagnose-concern.ts:1512-1527`; only the ran-but-low case leaks.)

**Fix:** persist the two confidences into `precomputed` and, at tap time, expand to the full
subcategory question list when either is "low" (over-ask; do NOT strip the category — the
customer just confirmed it). Anchors: `run-diagnostics.ts:637-640`,
`submit-concern-clarify.ts:437-461`.

### P6 — MEDIUM [code] — `submit-clarification-answer` has no step guard; its drained-branch performs a transition that can orphan the clarify queue

`submit-concern-clarify` validates `current_step === "concern_clarify"`
(`submit-concern-clarify.ts:355-365`). `submit-clarification-answer` never checks
`current_step`, and its drained-queue branch doesn't no-op — it **routes**
(`submit-clarification-answer.ts:180-190`), ignoring `concern_clarify_candidates`. Concrete
failure: the wizard is on `concern_clarify` (pending=[] because clarify resolves before
questions are queued); a stale tab / back-forward-cached clarification card submits; the
drained branch fires `routeAfterDiagnostics({0, recsCount})` → the wizard jumps to
`testing_service_approval`/`second_routine_pass`, the clarify queue is left populated but
unreachable (nothing re-runs diagnostics), and that concern is never classified — no questions,
no rec, advisor gets raw text only. The mid-queue path has the same hole when clarify and
pending coexist (multi-concern: concern A resolved with questions, concern B awaiting a tap).
Even benignly, the drained branch re-emits a duplicate Jeff bubble on every stale replay.

**Fix:** validate `current_step === "clarification_question"` up front (mirror the sibling);
make the drained branch return `ok:false` (or at minimum route clarify-first the way
`run-diagnostics.ts:471-476` does).

### P7 — MEDIUM [code] — Back from the loop dumps to the picker, and a non-hub re-submit wholesale-wipes the customer's work

`submit-back.ts:193-202`: Back from `concern_explanation`, `clarification_question`,
`concern_clarify`, `testing_service_approval`, AND `second_routine_pass` all target
`service_concern_picker`. A fresh picker submit then **resets everything** — explanation
texts, answered map, recommendations, declines (`submit-service-and-concern-picker.ts:349-370`).
So the customer three questions into the loop who backs up to add one more service and
re-submits the same picks loses every word they typed and every answer they gave, and re-runs
the LLM from scratch. The repo already has the fix — `applyMerge`
(`submit-service-and-concern-picker.ts:408-543`) preserves surviving concerns' work — but it's
gated to `fromHub` only (`:216-217`, `:319-339`). There is also no "back one question"
affordance inside the loop (the answered map supports re-answering; the most-recent-wins
comment at `ensure-concern-summaries.ts:20-22` even anticipates it, and its `force` param has
no caller — dead code today).

**Fix:** run the smart merge on EVERY picker resubmit (Start Over already has its own reset
path), and/or give the question loop a local "previous question" that pops the last answered id
back onto pending.

### P8 — MEDIUM [code, frequency reduced by retraining] — The give-up paths never ask anything

Chris's stated goal: *"sometimes we will have to ask MORE questions just to be able to get a
category."* The flow does this in exactly one situation — Stage-1 returned 2-3 candidates. The
other two failure shapes give up silently:

- **0 candidates (null match / gate-stripped):** `route-after-diagnostics.ts:50-54` — straight
  to "I'll pass this over to our service advisors", zero follow-up. The customer is never told
  classification failed and never given a chance to add the one detail (color of the puddle,
  when it happens) that would have classified it.
- **"None of these" on the clarify card:** `submit-concern-clarify.ts:407-409` — same: no
  "which area feels closest?" fallback (a deterministic 14-category chip card needs no LLM), no
  one-shot "anything else you've noticed — sounds, smells, lights, when it happens?" free-text
  that would at least enrich the advisor summary.

The KB corpus says this path is common: ~30 no-catalog-fit phrases + 53 non-concern lines in
the lexicon, 37 null_match + 4 advisor_handoff golden cases. Retraining (L1-L4) shrinks the
0-candidate rate; the missing *second attempt* is a flow gap only code can close. Note the
plumbing already exists: the clarify chip card + the situational buckets ARE the "ask a
category-level question" machinery — a none-of-these/null-match fallback card is a re-skin,
not a new subsystem.

### P9 — LOW-MEDIUM [code] — The empty-queue clarification stub is a soft dead-end

If `current_step` is `clarification_question` with an empty queue (inconsistent state),
`get-current-card.ts:410-423` renders a stub with `question_id: 0`. Every control on that card
submits `question_id: 0`, which fails `z.number().int().positive()`
(`submit-clarification-answer.ts:37`) **before** reaching the drained-branch recovery re-route
— so the one branch built to heal this state is unreachable from the card it renders for. The
customer sees the failure banner in a loop; the only exit is Back (which triggers P7's wipe).
Fix: have get-current-card route away instead of rendering the stub (it has the row —
`routeAfterDiagnostics` is pure), or let the stub submit a sentinel the action accepts.

### P10 — LOW [retraining/data hygiene] — `"skipped"` sentinel collides with option values

`WizardSurface.tsx:443-446` maps the literal answer string `"skipped"` to `{kind:"skip"}`. Any
catalog option whose `value` is `"skipped"` becomes un-answerable (silently converted to a
skip). Add a catalog lint: no `concern_questions.options[].value` may equal `skipped`
(and never introduce one).

### P11 — LOW [code + retraining] — Raw internal slugs are shown to customers

The clarification card eyebrow falls back to the raw `service_key` when `category` is null
(`ClarificationQuestionCard.tsx:108-112`) — a customer can see "A few details · other_issue".
When category IS present it's the raw concern-category slug ("… · other", "… · warning_light"
uncapitalized, underscored for multiword). Map slugs to display labels (code), and keep
category display names customer-worthy in the catalog (retraining).

### P12 — LOW [code hygiene] — Dead/drifting metadata across the loop's writers

- `service_display_name` is built into the clarify payload (`get-current-card.ts:462-470`) but
  never forwarded — `WizardSurface.tsx:459-468` doesn't pass it and `ConcernClarifyCardProps`
  has no such prop. Dead field (the pull-quote carries the context today).
- `PendingQuestionEntry` in `submit-clarification-answer.ts:55-65` lacks `subcategory_slug`, so
  the first answer re-persists the remaining queue with that field stripped — the queue's shape
  depends on which action last wrote it (run-diagnostics/submit-concern-clarify keep it).
  Currently no reader depends on it; still a drift trap.
- `ensureConcernSummaries`' `force` param has no caller (`ensure-concern-summaries.ts:171-177`).
- A picker fresh-submit doesn't clear `concern_clarify_candidates`
  (`submit-service-and-concern-picker.ts:349-367`) — harmless today only because a subsequent
  full diagnostic run overwrites it (`run-diagnostics.ts:966-970`); the simple-services-only
  resubmit path leaves stale clarify rows behind.
- `key={card.payload.concern_text}` (`WizardSurface.tsx:460`) collides when two clarify
  entries carry identical text; key on `concern_index` instead.

---

## 3. Best-outcome gaps (Chris's lens)

1. **When we can't classify, we don't ask more — we quit.** The clarify card is the only
   "ask to establish category" moment; 0-candidate and none-of-these both skip straight to
   advisor with no second attempt (P8). The machinery to fix this already exists on-screen.
2. **The ambiguous cases extract the least.** Precisely when Stage 1 was unsure, the resolved
   concern loses its follow-up questions (other-bucket taps, P3), loses its over-ask safety
   (P5), and can re-ask/duplicate what it does ask (P4).
3. **The advisor can receive corrupted or thinner-than-collected info.** Summary clobbering on
   the multi-concern loop (P1); the clarify choice itself (which candidate the customer
   confirmed, or that they rejected all of them) never reaches the Tekmetric RO description —
   it lives only in the transcript bubbles and audit log (`build-service-summary.ts:138-148`
   emits only summary/raw text).
4. **A declined test can silently become an approved one** (P2) — the single worst
   customer-trust outcome in this segment.
5. **Backing up is punished** (P7): the flow's only mid-loop escape wipes the customer's typed
   work, which in practice teaches customers to abandon rather than correct.

## 4. Prioritized recommendations

| # | Fix | Lever | Effort |
|---|-----|-------|--------|
| 1 | Match summaries back by item identity/index in `ensureConcernSummaries` (P1) | [code] | 1 line + test |
| 2 | Approval card: present only undecided recs; merge (don't overwrite) declines (P2) | [code] | small |
| 3 | Hydrate questions for chosen `other_subcategory` candidates (P3) | [code] | small — data already persisted |
| 4 | Add answered/queued guards to the clarify-tap hydration (P4) | [code] | small |
| 5 | Persist per-candidate S2/S3 confidences; over-ask on low at tap time (P5) | [code] | small |
| 6 | Step-guard `submit-clarification-answer`; make drained branch clarify-aware / no-op (P6) | [code] | small |
| 7 | None-of-these + null-match fallback: one category-chip card and/or one "tell me more" free-text before advisor handoff (P8) | [code] | medium — highest best-outcome value |
| 8 | Run the picker smart merge on all resubmits; consider a "previous question" affordance (P7) | [code] | medium |
| 9 | Append the clarify choice (confirmed candidate / "no candidate fit") to the concern summary line for the RO description | [code] | small |
| 10 | Route away from (or make submittable) the empty-queue stubs (P9) | [code] | small |
| 11 | Catalog lint: forbid option value `"skipped"`; customer-worthy category display labels; audit clarify-card first-sentence descriptions for routing-jargon ("NOT suspension…") leaking to customers | [retraining] | small |
| 12 | Hygiene batch: dead `service_display_name`/`force`, `subcategory_slug` drift, stale `concern_clarify_candidates` on simple-only resubmit, clarify card key (P12) | [code] | small |

**Sequencing note:** items 1-6 are shippable independently of the KB retraining pass and fix
live defects in flows that already run (EH2 describe-another-issue shipped 2026-07-04; act-or-ask
shipped 2026-07-03). Item 7 is the one flow addition that directly serves Chris's stated goal and
should be designed alongside the Stage-1 retraining slice (retraining lowers how often it fires;
it does not replace it).
