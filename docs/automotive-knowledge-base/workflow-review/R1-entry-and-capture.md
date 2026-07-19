# R1 — Entry & concern capture review

> Segment review of the LIVE "describe an issue" workflow: how the customer gets INTO diagnosis and how
> their concern text is captured, up to the handoff into `runDiagnosticsV2`. Reviewed 2026-07-18 against
> the actual code (file:line anchors below) and the KB ground truth
> (`00-current-scheduler-taxonomy.md`, `FINDINGS-AND-RECOMMENDATIONS.md`, `datasets/customer-language-lexicon.md`).
>
> Judged against Chris's goal: *ask the right questions, extract the correct information, and when we
> can't classify, ask MORE questions to establish a category/subcategory — never dead-end or guess.*

**Files reviewed**

- `scheduler-app/src/components/scheduler/ServiceAndConcernPicker.tsx` (Step 7.1 card)
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-service-and-concern-picker.ts` (Step 7.1 submit)
- `scheduler-app/src/components/scheduler/heritage/ConcernExplanationCard.tsx` (Step 7.2 card)
- `scheduler-app/src/lib/scheduler/wizard/actions/submit-explanation.ts` (Step 7.2 submit)
- `scheduler-app/src/lib/scheduler/escalation-keywords.ts`
- `scheduler-app/src/lib/scheduler/wizard/card-payloads.ts`
- Seams verified in: `run-diagnostics.ts`, `route-after-diagnostics.ts`, `get-current-card.ts`,
  `llm/diagnose-concern.ts` (chip-hint handling), migrations `20260510131752` + `20260513000200` (chip set).

**The chip set (ground truth, migration `20260510131752_scheduler_phase1_schema.sql:541-552` +
`20260513000200:207-211`):** 10 routine chips — 5 "simple" (state inspection, oil change, tire rotation,
rotate & balance, alignment) that ask NO questions, 5 `requires_explanation` (brake inspection, check
battery, warning lights, check suspension, check A/C) that open a free-text card, plus the fixed
"💬 Other Issue" pseudo-chip (`ServiceAndConcernPicker.tsx:48`, `submit-service-and-concern-picker.ts:46`).

---

## What makes sense (keep this)

1. **Service-first triage with a free-text escape hatch is the right first level.** Customers pick what
   they *want done*; symptom classification is deferred to prose + LLM. Hiding the 24 testing services
   from the picker (`card-payloads.ts:121-139`, `get-current-card.ts:262-268`) is correct — the lexicon
   confirms customers can't tell `charging_starting_testing` from `no_start_testing`.
2. **The chip is a soft prior, not a cage.** `buildChipHint` (`run-diagnostics.ts:355-388`) passes the
   chip's `concern_categories[]` to Stage 1, and the prompt says "prefer … unless the description clearly
   says otherwise" (`diagnose-concern.ts:514-519`); `other_issue` explicitly gets "classify from
   description alone" (`diagnose-concern.ts:507-513`). This is exactly right: customers routinely pick
   "Check Battery" for what is a starter or a parasitic-draw problem (see the lexicon's
   `wont_crank_just_clicks` vs `battery_drains_overnight` rows), and the pipeline can recover.
3. **Escalation scan is scoped to where prose exists.** Phase 9c deliberately moved it off the picker
   (no free text there — `submit-service-and-concern-picker.ts:23-27`) onto the explanation submit
   (`submit-explanation.ts:137-152`). Whole-word boundary matching (`escalation-keywords.ts:57-61`)
   avoids the "managerial"/"livid" substring traps. A scanner crash degrades to proceed-without-scan,
   not a blocked queue (`submit-explanation.ts:153-159`) — correct failure direction.
4. **Multi-concern capture is structurally sound.** One queue entry per picked chip, one card per entry,
   defensive first-empty-matching on submit (`submit-explanation.ts:119-121`), per-concern parallel LLM
   calls, index-safe write-back for duplicate `other_issue` keys (`run-diagnostics.ts:802-869`), and the
   hub smart-merge preserves surviving concerns' diagnostic work (`submit-service-and-concern-picker.ts:408-543`).
5. **Good defensive hygiene:** unknown picks Sentry-warned not silently dropped
   (`submit-service-and-concern-picker.ts:305-310`); picks validated against ACTIVE DB rows only
   (`:219-232`); dedup via `Set` (`:198`); stale diagnostic state reset on fresh re-picks (`:355-366`);
   `second_routine_pass` filters `requires_explanation` chips out of the add-on grid so the diagnostic
   flow can't be skipped (`get-current-card.ts:500-511`).

---

## Problems, ranked

### P1 (HIGH) — The picker copy steers an unsure customer onto a chip that asks no questions

`ServiceAndConcernPicker.tsx:176-181`:

> "If you're not sure what the issue is, **pick the service that's closest** — we'll ask you a few
> questions next to figure out exactly what's going on."

Only 6 of 11 tiles (the 5 `requires_explanation` chips + Other Issue) trigger any questions. The other 5
are `selected_simple_services` → straight to `appointment_type`
(`submit-service-and-concern-picker.ts:283-284, 341-343`) with **zero symptom capture**. A customer with
a wheel-bearing hum who follows this instruction and picks "Tire Rotation" (closest-sounding) books a
rotation; the tech gets no symptom text; the noise survives the visit. The card copy actively *promises*
questions that a simple chip will never ask. This is the single worst entry-triage outcome and it's
induced by our own copy.

**Fix [code]:** rewrite the description to route uncertainty to the escape hatch: *"If you're not sure
what's causing it, pick '💬 Other issue' and describe what you're noticing — we'll figure out the right
next step."* Note this card's copy is hard-coded in the component (it takes no `copy` prop, unlike
`ConcernExplanationCard.tsx:31`) — worth moving into the card-text editor at the same time so Chris can
tune it without a deploy.

### P2 (HIGH) — Zero-signal capture: nothing stops "idk" / "." from burning the LLM call and dead-ending at the advisor

- Client gate: ≥3 chars (`ConcernExplanationCard.tsx:58-61`). Server gate: ≥1 char after trim
  (`submit-explanation.ts:35`). No other signal check exists anywhere before the money is spent —
  `diagnoseConcern` is invoked with whatever survived (`run-diagnostics.ts:595-600`), and there is no
  pre-LLM guard inside `diagnose-concern.ts` either (verified).
- The downstream seam (verified): Stage-1 EMPTY or low Stage-2 confidence → no recommendation, no
  questions → `routeAfterDiagnostics` sends `second_routine_pass` with "I'll pass this over to our
  service advisors" (`route-after-diagnostics.ts:50-54`). The act-or-ask clarify card fires **only** on
  2–3 candidates (`run-diagnostics.ts:605-676`). So the flow asks more questions when it's *torn between
  categories*, but when it has *no idea* — the case Chris explicitly called out — it silently gives up.
  "Other Issue" + vague text is precisely the no-chip-signal + no-text-signal combination that lands here.

**Fix, entry side [code, fed by [retraining] data]:** a deterministic **no-signal nudge** in the
explanation card/submit, BEFORE the LLM call:

- Do **not** use a bare minimum length. The lexicon is full of terse-but-fully-classifiable texts
  ("no heat" → `heat_doesnt_work`; "HORN INOPERABLE"; "under vehicle leak" is 3 words and still Stage-1
  classifiable to `leak`). Length is the wrong proxy.
- Instead: if the text contains **no automotive/symptom token at all** (vocabulary sourced from the
  lexicon's phrase tables + `testing_services.example_keywords` — the data already exists in the KB) OR
  matches a short vague-only list ("not sure", "it's broken", "check it out", "something's wrong",
  "idk"), show ONE inline nudge in the card: *"What's it doing? For example — a noise, a leak, a warning
  light, won't start, a smell, a shake, or something else?"* Never hard-block; a second submit of the
  same text goes through. One nudge converts a guaranteed advisor handoff into a likely classification
  for the cost of zero LLM calls.
- Trivial hardening while there: raise the server zod min to match the client (`.min(3)`,
  `submit-explanation.ts:35`) so a bypassed client can't submit "?".

**Fix, routing side (seam note — belongs to the routing segment):** the complementary one-time bounce —
Stage-1 EMPTY **+ short text** → return to `concern_explanation` once with the same targeted nudge
instead of instant `second_routine_pass`. Entry nudge + one routing retry together close the "we never
asked" hole; flagged here because the entry nudge halves the need for it.

### P3 (MED-HIGH) — The first free-text prompt wastes its chance to elicit the discriminating facts

The card's guidance is one hard-coded template for all six chip types, `ConcernExplanationCard.tsx:87`:

```ts
help={`Examples for ${display_name.toLowerCase()}: when it happens, any noises, anything recent like new tires or a pothole.`}
```

For `check_battery` this literally renders "…anything recent like new tires or a pothole." The lead-in is
equally generic ("Got it — tell me a bit about brake inspection. What are you noticing? 🤔",
`get-current-card.ts:1290-1298`). Yet each chip has a KNOWN set of top discriminating facts (the 29
Stage-3 slots, taxonomy §6) and known confusable pairs (taxonomy §5):

| chip | what the help text SHOULD fish for | facts it pre-seeds |
|---|---|---|
| warning_lights | *which* light + steady or flashing | `warning_light_named`, `warning_light_behavior` |
| check_battery | does it click, crank slowly, or nothing / does a jump fix it | `noise_descriptor`, `engine_running` (feeds pair #2 no-start vs charging) |
| brake_inspection | noise vs pedal feel vs shake, when it happens | `noise_descriptor`, `pedal_feel` (feeds pair #1 and #8) |
| check_suspension | over bumps vs at speed, which corner | `speed_band`, `location_side` (pair #8) |
| check_ac | hot or just weak / heat or cold side / smell | `hvac_mode`, `airflow_state`, `smell_descriptor` (pair #3) |
| other_issue | noise / leak / light / won't start / smell / shake | the Stage-1 category itself |

Every fact volunteered in the FIRST message is a question the mapper never has to ask (its whole skip
mechanism keys off Stage-3 extraction) and directly reduces the 2–3-candidate clarify rate. This is the
cheapest over-ask reduction in the entire pipeline — the customer is already typing; we're just steering
the sentence.

**Fix [code + retraining]:** make the help/lead-in per-service data (a column on `routine_services` or
card-text slots) instead of a hard-coded template — code change — then author the six strings from the
KB's per-chip fact slots — retraining/data change, editable via /schedulerconfig thereafter.

### P4 (MED) — Multi-concern queue invites front-loading, which poisons per-concern classification

Pick 3 explanation chips → 3 visually identical sequential cards (eyebrow/title differ; no "issue 1 of 3"
progress anywhere in `ConcernExplanationCard.tsx`). Real customers tell the whole story in the first box
("brakes grind, also the AC is warm and there's a puddle") and then answer box #2 with "see above" /
"same as before". Consequences, verified in code: each `diagnoseConcern` call receives ONLY that entry's
text (`run-diagnostics.ts:595-600`) — concern #1's text may clarify-fan across categories (its box now
contains 3 concerns), and concern #2's "see above" has no signal → Stage-1 empty → silent advisor
handoff (P2's seam). Nothing detects or reuses cross-entry text.

**Fix [code]:** (a) add "Issue N of M" to the card chrome + one line of copy: *"Just the
{display_name} issue here — we'll ask about the others next."* (b) cheap deterministic guard: if a
submission is a near-duplicate of an earlier entry's text or matches "see above"-type referential
phrases, re-prompt inline (same one-nudge mechanic as P2). No LLM needed for either.

### P5 (MED) — Escalation list: one real false-positive trap, and escalation throws away the structured concern

- `escalation-keywords.ts:22` — `sue` with whole-word matching collides with the *name* Sue: "my wife
  Sue said the brakes grind" escalates a legit brake concern. The other legal terms are two-way safe;
  "sue" is the only common-English/name collision on the list. Also worth a calibration pass: "refund" /
  "manager" (`:22-27`) in a *narrative about another shop* ("the tire place gave me a refund but it still
  shakes") hard-terminates a bookable mechanical concern into "call us" (`submit-explanation.ts:140-151`).
  The file's stance — false positives are cheap (`escalation-keywords.ts:6-10`) — is reasonable, but the
  cost is not "one extra escalation," it's a **lost booking**: the escalated terminal has no schedule
  path, only the phone number.
- On a keyword hit the transition writes only `status/escalated_at/escalation_reason`
  (`submit-explanation.ts:142-146`); the typed description lands solely in the chat transcript as the
  user bubble (verified: `transition.ts:115-119` — bubbles go to the transcript, and
  `explanation_required_items` keeps its empty `explanation_text`). The advisor triaging the escalation
  gets `keyword:complaint:manager` and has to fish the actual concern out of the transcript.

**Fix [code/data]:** (1) drop `sue` or guard it (e.g., require it NOT be immediately followed by `'s`/
capitalized-name context — or simply rely on "lawyer/attorney/lawsuit" which cover the genuine intent);
(2) persist `explanation_text` into the queue entry *before* the escalation transition so the structured
record survives; (3) consider category-level behavior: `legal`/`profanity` → hard escalate as today;
`financial`/`complaint` → escalate but keep the description attached so an advisor can still book them.

### P6 (LOW-MED) — Comment/code mismatch: a resubmitted filled entry silently drops the customer's text

`submit-explanation.ts:116-121` says a back-button resubmit of a previously-filled entry is treated "as
an overwrite," but the predicate `i.service_key === service_key && !i.explanation_text` can never match a
filled entry — `targetIdx === -1` and the action **advances without writing** (`:122-131`), discarding
whatever the customer just typed. Today that path is mostly unreachable (server-state-driven cards, the
`pending` flag blocks double-submits — `ConcernExplanationCard.tsx:55`), but the misleading comment is a
trap for the next editor, and the related product gap is real: there is **no path to edit a concern
description** — the summary-edit-hub smart merge preserves survivors verbatim
(`submit-service-and-concern-picker.ts:436-444`), so fixing a typo'd description requires
remove-chip → submit → re-add-chip → re-describe (two hub trips).

**Fix [code]:** either implement the documented overwrite (match filled entries when the incoming text is
non-empty and differs) or correct the comment + breadcrumb the drop. Longer-term, a per-concern "edit
description" affordance on the hub.

### P7 (LOW) — `category: concern_categories[0]` is a lossy, write-only field

The picker persists the FIRST element of the chip's `concern_categories[]`
(`submit-service-and-concern-picker.ts:276-281`, same for testing rows `:293-299`). Verified downstream:
`run-diagnostics.ts` re-derives the FULL array from `routine_services` for the chip hint
(`loadRoutineChipConcernCategories`, `:329-353`) and never reads `item.category`;
`ensure-concern-summaries.ts` parses it but it carries no routing weight. A multi-category chip
(check_suspension spans noise/steering/pulling/vibration) is silently truncated to one — harmless today
only because nothing load-bearing consumes it, which makes it a misleading trap for future consumers.

**Fix [code]:** store the full array (rename `categories`) or drop the field; document either way.

---

## Best-outcome gaps (Chris's frame)

1. **We tell the unsure customer to do the thing that skips all questions** (P1). Worst possible capture
   outcome, self-inflicted by copy.
2. **When we have no idea, we don't ask — we hand off.** The clarify chip card covers "torn between 2–3";
   nothing covers "0 candidates" except silent advisor forwarding (P2). The customer never sees the
   one question ("noise? leak? light? won't start?") that would have produced a category.
3. **The first prompt doesn't fish for the facts we already know we'll need** (P3), so Stage 3 extracts
   less, the mapper skips less, and the question queue is longer than necessary — over-asking that entry
   design could have prevented for free.
4. **Multi-concern capture assumes disciplined customers** (P4); front-loading degrades every concern
   after the first into P2's dead-end.
5. **A handful of escalation words turn a bookable customer into a phone call** and strip the structured
   concern on the way out (P5).

## Prioritized recommendations

| # | Fix | Lever | Effort |
|---|---|---|---|
| 1 | Rewrite picker "not sure" copy to route to Other Issue; move picker copy into card-text | [code] | XS |
| 2 | No-signal nudge (vocab from lexicon/keywords) + server `.min(3)`; one nudge max, never block | [code] (+[retraining] supplies the vocab) | S |
| 3 | Per-chip help/lead-in strings authored from each chip's top fact slots; make them data-driven | [code] + [retraining] | S/M |
| 4 | "Issue N of M" + "just this issue here" copy; near-duplicate/"see above" re-prompt | [code] | S |
| 5 | Routing seam (hand to routing segment): one-time bounce to `concern_explanation` on Stage-1 empty + short text | [code] | M |
| 6 | Escalation: drop/guard `sue`; persist explanation_text before escalating; per-category booking-preserving handling | [code] | S |
| 7 | Fix or truthfully document the filled-entry resubmit drop; hub "edit description" affordance later | [code] | XS (comment) / M (edit path) |
| 8 | Fix or drop the lossy `category` field | [code] | XS |

Nothing in this segment needs new Stage-1/2 catalog work beyond what the KB already proposes — the
entry-side wins here are copy, one deterministic guard, and making existing per-chip data reach the
customer at the moment they type.
