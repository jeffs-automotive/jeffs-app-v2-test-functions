# R5 — Question quality: are these the RIGHT questions?

> Workflow-review segment R5 · 2026-07-18 · reviewed against the live test DB (729 active questions,
> 105 subcategories with questions, uniform ~7 per subcategory) and the system dossiers' §5
> "Differential & discriminating questions." Sampled 16 subcategories (~112 questions) in depth across
> 13 of 14 categories; ran structural audits across all 729. Judged against Chris's goal: *ask the
> RIGHT questions, get the CORRECT information out of the customer.*

---

## Verdict in one paragraph

The question CONTENT is genuinely good — the sampled sets independently reproduce most of the expert
discriminators the dossiers call out, in real customer language, with clean option hygiene. The
dominant quality problem is not what the questions say but **when they are (not) asked**: 15 of the 21
questions tagged with their own subcategory's "signature" fact slot are silently skipped in exactly
the scenario they were written for (the presence-not-value mapper defect,
`scheduler-app/src/lib/scheduler/wizard/llm/question-fact-mapper.ts:39-47`), and several of those are
the dossiers' #1 discriminators (battery-vs-starter, spongy-vs-sinking-pedal safety check,
steam-vs-head-gasket). Second problem: volume — no cap, ambiguous→ask, 48% empty `required_facts`,
and a uniform 7-question template mean a typical concern generates 5–7 sequential cards (× N concerns;
× full re-queue on a low Stage-3 gate). Third: a small set of malformed questions — double-barreled
"A or B?" texts with Yes/No options whose answers are uninterpretable, and one question (q762) that
asks *whether* a symptom worries the customer most instead of *which one*.

---

## 1. What makes sense (keep this)

**1a. The sampled sets match the dossiers' expert differentials remarkably well.**

| Subcategory | Dossier §5 discriminator | DB question | Match |
|---|---|---|---|
| `electrical/wont_crank_just_clicks` | rapid-click+dim = battery vs one-click+bright = starter (`systems/starting-charging.dossier.md:312`) | q874 (single/rapid/no sound) + q875 (lights normal/dim/none) | exact |
| `noise/humming_or_whirring_at_speed` | steering-load, coast-vs-throttle, speed-tracking (`systems/wheels-tires-tpms-bearings.dossier.md:326-328`) | q86 (turn L/R), q88 (coast), q85 (louder faster) | exact |
| `smoke/white_smoke_from_tailpipe` | persists-10-15-min vs clears; sweet vs oily; milky oil cap (`systems/cooling-system.dossier.md:252-253`) | q282, q283, q287 | exact |
| `hvac/heat_doesnt_work` | temp GAUGE reaches normal vs stays cold = thermostat vs heater core (`systems/hvac-climate.dossier.md:298`) | q939 | exact |
| `brakes/spongy_or_soft_pedal` | pump-test (air) vs steady-pressure creep (master cyl) (`systems/brakes-friction-hydraulic.dossier.md:285`) | q637 (pump test) + q638 (reaches carpet) | present (but see §2.1) |
| `pulling/steady_drift_while_cruising` | flat-empty-lot probe = road-crown discriminator (`systems/suspension-ride-alignment.dossier.md:305`) | q196 | exact |

**1b. Customer language is strong.** "Rapid clicking like a machine gun" (q874), "sweet smell, kind
of like maple syrup or pancake syrup" (q987), "milky or frothy stuff on the underside of the oil
filler cap" (q287), "bumpy and scalloped when you run your hand across the tread" (q732). This
matches the real-voice register in `datasets/customer-language-lexicon.md` (misspelled, non-technical).

**1c. Option hygiene is structurally clean.** All 729 questions have options; ~718 include an
escape option ("Not sure" / "Haven't checked" / "Haven't tried" / "Neither"); only ~11 lack one and
most of those are legitimately closed spaces (safety triage q1848/q1849, binary q786/q713). 549/729
are 3-option, 136 4-option — appropriately small for chip cards. Duplicate question texts across
subcategories (4 texts, e.g. "Have you had brake work done recently?" q653/q873/q636) are consistent
reuse, not accidents. `required_facts` references zero unknown slot names (authoring is clean against
`extracted-facts.ts:1104-1134`).

**1d. Multi-select is used where the answer space is genuinely multi** (q629 axle+side, q986 colors,
q761 patterns), and display_order generally puts a top discriminator first (q874 #1, q623 #1, q937 #1).

---

## 2. Problems, ranked

### P1 — HIGH: the auto-skip trap kills marquee discriminators (15 questions confirmed)

The mapper skips a question when its tagged slot is non-null — PRESENCE, not VALUE
(`question-fact-mapper.ts:39-47`, `:162-181`). 21 questions are tagged with the very slot their own
subcategory selection implies, so Stage 3 fills the slot from the customer's *original complaint* and
the question is skipped **exactly when the customer is in the flow it was written for**. Per-question
audit of all 21:

**Confirmed wrong-skips (the question asks for VALUE-level detail the slot can't hold):**

| qid | Subcat | What is lost when skipped | Trigger |
|---|---|---|---|
| **874** | wont_crank_just_clicks | single-vs-rapid click = **the** battery-vs-starter split (`starting-charging.dossier.md:312`) | tagged `[engine_running]`; saying "won't crank, just clicks" fills it |
| **638** | spongy_or_soft_pedal | pedal-reaches-carpet = spongy→sinking **safety escalation** (`brakes-friction-hydraulic.dossier.md:285`) | tagged `[pedal_feel]`; saying "mushy/spongy" fills it |
| **286** | white_smoke_from_tailpipe | thin-wispy vs thick = harmless condensation vs **head gasket** (`cooling-system.dossier.md:253`) | tagged `[smoke_color]`; saying "white smoke" fills it |
| **564** | car_died_while_driving_electrical | cranks-after-dying vs nothing = alternator-vs-fuel split (`starting-charging.dossier.md:316`) | tagged `[engine_running]`; "died while driving" fills it |
| **320** | smoke_or_strong_smell_inside_the_cabin | visible smoke vs smell-only — the boundary to the smell subcats (`brakes-friction-hydraulic.dossier.md:290` same pattern) | tagged `[smoke_color]`; "smoke in the car" → `visible_but_color_unclear` |
| **531** | slow_crank_sluggish_start | runs-normal-after-start probe (battery vs deeper) | tagged `[engine_running]`; "cranks slow" fills it |
| 155, 160 | shaking_at_idle_while_stopped | in-gear-vs-Park shake (mounts vs misfire); cold-vs-warm | tagged `[onset_timing]`; "shakes at idle" fills it |
| 162, 166 | shaking_when_speeding_up... | only-on-throttle confirm; every-time-vs-intermittent | tagged `[onset_timing]`; "shakes when accelerating" fills it |
| 148 | vibration_or_pulsing_when_braking | braking-only confirmation (vs bump-triggered) | tagged `[onset_timing]`; partial — skip is right when value = `when_braking`, wrong when a co-mentioned trigger won |
| 189, 190, 218 | pulling/* | direction-CONSISTENCY (steady vs varies) — the steady-drift↔wandering boundary | tagged `[pull_direction]`; "pulls left" fills it without answering consistency |
| 996 | red_or_pink_puddle... | bright vs darkened-brownish (fluid age/condition) | tagged `[fluid_color]`; "red fluid" fills it |

**Correct tags (presence-skip is right — the slot value IS the answer; keep these):** q986, q1021,
q1737 (leak color verifications), q525 (slow-crank confirm), q448 + q2219 (`warning_light_named` —
asked only when the customer did NOT name the light; exactly right).

Why this matters for Chris's goal: these are the questions that "get the correct information out of
the customer" — and the flow silently discards them for the customers who most need them. The fix is
the value-aware mapper (`FINDINGS-AND-RECOMMENDATIONS.md` Finding 1 — a **[code]** change, correctly
sequenced first there). **R5 adds an interim [retraining] fix:** until value-aware ships, blank the
`required_facts` on the 6 boldfaced high-stakes rows above (874, 638, 286, 564, 320, 531) so they are
always asked — a pure DB edit, zero code, restores the safety/differential questions today at the cost
of a little re-asking.

### P2 — HIGH: volume over-ask — no cap, ambiguous→ask, uniform 7-question template

- The pending queue takes EVERY unanswered id with no cap
  (`scheduler-app/src/lib/scheduler/wizard/actions/run-diagnostics.ts:809-869`).
- Ambiguous (partially-covered) questions are asked, not skipped
  (`scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts:1554-1556` — "v1: ambiguous is
  treated as unanswered").
- 349/729 questions (48%) have empty `required_facts` → can never be skipped; every sampled
  subcategory has exactly 7 questions (729 ≈ 105×7 — a template artifact: two have 6, one has 5).
- A low Stage-3 confidence re-queues **all 7** regardless of what was answered
  (`scheduler-app/src/lib/scheduler/wizard/confidence-gate.ts:82-88`, `overAskQuestionIds`
  `:99-109`).

Net: a typical one-concern flow asks 5–7 sequential cards; three concerns can exceed 15–20 cards
(flat queue across concerns, `run-diagnostics.ts:22`). Chris explicitly accepts asking MORE questions
— but only to establish category/subcategory. These extra cards fire AFTER classification is settled
and mostly feed the advisor note, so each marginal card is abandonment risk with shrinking payoff.
The dossiers' §5 tables show each subcategory has 1–3 genuinely load-bearing discriminators; the rest
are context probes. Fix: (a) **[retraining]** reorder `display_order` so the §5 discriminators are
always the first 2–3 cards (mostly true today, not audited everywhere); (b) **[code]** consider a
per-concern cap (~4) with the remainder summarized as "anything else worth telling us?" free text —
Chris's call on the tradeoff; (c) **[retraining]** the 250 documented-NEVER probes are fine to keep
but they are exactly where a cap should trim.

### P3 — MEDIUM: double-barreled questions with Yes/No options — the answer is uninterpretable

The recorded answer cannot distinguish which half the customer meant; this pollutes the answered map
and the advisor summary:

- **q943** (heat_doesnt_work): "Did the heat problem start after the car sat for a while, **or**
  after any recent service?" → options `Yes | No | Not sure`. "Yes" = which one?
- **q376** (check_engine_light): "Is the car using more gas than usual, **or** is there any black
  smoke...?" → `Yes | No | Not sure`. Also tagged `[smoke_color]`, so a customer who mentioned WHITE
  smoke skips the fuel-economy probe entirely (P1-class side effect).
- **q377** (check_engine_light): "About how long has the light been on, **and** does it ever turn
  itself off...?" — merges duration + behavior; overlaps q372 (both tagged
  `[warning_light_behavior]`, so both skip together and neither captures duration; `started_when`
  would be the honest second tag).
- **q666** (hard_to_turn_heavy_steering): "Has the battery been dying **or** have any warning
  lights been on?" → `Yes | No | Not sure` (both halves point at EPS/low-voltage so the conclusion
  survives, but the data recorded is mush).
- **q992** (coolant puddle): fog-up **or** sweet-vents → `Yes | No` (same conclusion either way —
  lowest priority).

Fix **[retraining]**: reword to one dimension per question, or make the options enumerate the
branches (the way q375's options do it well: "Yes — gas cap tightened, light still on | Yes — gas cap
was loose | No relation | Not sure" — that is the correct pattern; q375 is the in-catalog proof it
works).

### P4 — MEDIUM: single-value slots make honest tags into cross-topic wrong-skips

`recent_action` holds ONE value — "Pick the SINGLE most-emphasized recent event"
(`extracted-facts.ts:470-472`); `onset_timing` likewise picks one trigger (`:160-162`). Any question
tagged with these skips whenever ANY value is present, even an unrelated one: a customer who mentions
an oil change skips the brake-work question (q627), the jump-test question (q876), the pothole
question (q145), and the tire-work question (q146) in their respective flows. This is the 79-question
PARTIAL class from `binding/required-facts-map.md` — flagged here because the sampled hits are the
highest-value history questions in their sets. Blocked on the value-aware mapper **[code]**; do not
"fix" by un-tagging (that trades wrong-skip for guaranteed over-ask on the customers who DID state
the right value). Side nit: the Zod description of `onset_timing` still references a nonexistent
`trigger_conditions` slot ("the mapper will dispatch the rest from trigger_conditions,"
`extracted-facts.ts:160-162`) — stale text, not on the wire (the JSON-schema copy at `:796` omits
it), but it will confuse the next author **[code, trivial]**.

### P5 — MEDIUM: missing discriminators vs dossier §5 (sampled sets)

- **`steering/hard_to_turn_heavy_steering`**: the dossier's #1 discriminator is a direct "Is a
  steering/EPS warning light on?" (`steering-power-steering.dossier.md:227`). The set only has the
  fused q666 (battery OR lights, Yes/No). Add the direct EPS-light question (option values: Yes —
  steering light | Yes — other light | No | Not sure; tag `[warning_light_named]` — the q448 pattern)
  **[retraining]**.
- **`hvac/heat_doesnt_work`**: no gurgling/sloshing-behind-dash probe (low-coolant air pocket in the
  heater core; `hvac-climate.dossier.md:305` documents the sound cue). Cheap, high-value add
  **[retraining]**.
- **`noise/clunking_over_bumps`**: no heard-vs-felt-in-the-wheel probe — the documented Stage-2
  boundary to `steering/clunking_knocking_or_rough_ride_over_bumps`
  (`suspension-ride-alignment.dossier.md:303,310-314`). A question here would let the flow correct a
  Stage-2 near-miss mid-stream **[retraining]**.
- **`noise/humming_or_whirring_at_speed`**: q87's options ("Specific wheel | Hard to pin down") never
  capture WHICH wheel — the dossier wants side/axle (`wheels-tires-tpms-bearings.dossier.md:331`).
  Upgrade options to FL/FR/RL/RR/Not-sure and tag `[location_side, location_axle]` **[retraining]**.
  Also: all 7 questions in this subcategory have empty `required_facts` — q89 ("new tires put on
  recently...") is cleanly `[recent_action]`-taggable once the mapper is value-aware.

### P6 — LOW: option-space gaps

- q84 (clunking speed): `Any speed | Only at low speeds` — no high-speed-only branch.
- q141 (shake at specific speed): Yes/No where the options could capture the actual band
  (Under 40 / 45–60 / 65+ / Any) and feed `speed_band` — currently collects less than the slot holds.
- q158 / q465 (near-identical CEL-status questions in two vibration/performance subcats):
  `Flashing | Solid on | Off | Came on recently` — no "Not sure"; also neither is tagged
  (`[warning_light_named, warning_light_behavior]` would fit once value-aware lands).

### P7 — LOW (flow seam, noted for the routing segments): questions on advisor-bound paths can't change the outcome

The 6 situational `other/*` buckets ask their 7 questions and then always route
`second_routine_pass` (`run-diagnostics.ts` matched-'other' → no recommendation;
`route-after-diagnostics.ts:50-54`); answers only enrich the advisor note and never re-enter
classification. That is defensible — but then **q762** ("Is there one symptom that worries you the
most?" → `Yes | No | Not sure`, `other/multiple_symptoms_not_sure_what_category`) is a wasted card:
the *payload* (WHICH symptom) is never captured, which is precisely the answer that could have
re-established a category. Reword so the options name the symptom families (Brakes / Noise / Warning
light / Leak / ... / Not sure — the q791 pattern) **[retraining]**; feeding that answer back into a
re-classification pass is a **[code]** flow question for the R-segment that owns routing.

---

## 3. Best-outcome gaps (Chris's framing)

1. **We wrote the right questions and then don't ask them** — the P1 traps mean the wizard's best
   differentials (battery-vs-starter, spongy-vs-sinking, condensation-vs-head-gasket) reach neither
   the customer nor the advisor in the very flows they target.
2. **We ask too many of the wrong extra questions** — 5–7 cards per concern after classification is
   settled, worst-case full 7-card re-queue on a shaky Stage 3, across concerns with no cap.
3. **Some recorded answers are meaningless** — the P3 double-barreled Yes/No answers land in
   `clarification_questions_answered` as data nobody can interpret.
4. **One question throws away the single most valuable answer on the hardest path** (q762).
5. Fact-slot gaps documented by the dossiers keep good questions permanently unanswerable/untaggable
   (`battery_age` — q528/q537/q877 all ask it; `temperature_gauge_state`, `coolant_level_state` —
   q939/q940/q284/q285/q401; `steering_load_effect` — q86). Already in
   `binding/new-fact-slots.md`; R5 confirms the question side of the evidence.

## 4. Prioritized recommendations

| # | Fix | Lever | Anchor |
|---|---|---|---|
| 1 | Ship the value-aware mapper (endorses FINDINGS Finding 1; it is the precondition for most tag fixes here) | **[code]** | `question-fact-mapper.ts:39-47` |
| 2 | Interim: blank `required_facts` on q874, q638, q286, q564, q320, q531 so the high-stakes discriminators are always asked until #1 ships; leave q986/q1021/q1737/q525/q448/q2219 tagged (correct skips) | **[retraining]** | §2 P1 table |
| 3 | Reword the double-barreled five (q943, q376, q377, q666, q992) using the q375 branch-options pattern; retag q377 `[started_when]` for its duration half | **[retraining]** | §2 P3 |
| 4 | Reword q762 to capture WHICH symptom (q791-style options); consider feeding it back into classification | **[retraining]** + optional **[code]** | §2 P7 |
| 5 | Add the missing dossier discriminators: direct EPS-light q (hard_to_turn), gurgle probe (heat_doesnt_work), heard-vs-felt (clunking_over_bumps); upgrade q87 options to name the wheel | **[retraining]** | §2 P5 |
| 6 | Reorder `display_order` so each subcategory's §5 discriminators are cards 1–3; then decide with Chris on a per-concern card cap (~4) with free-text remainder | **[retraining]** then **[code]** | §2 P2 |
| 7 | Option gaps: add "Not sure" to q158/q465; high-speed branch to q84; band options to q141 | **[retraining]** | §2 P6 |
| 8 | Delete the stale `trigger_conditions` sentence in `extracted-facts.ts:160-162` | **[code, trivial]** | §2 P4 |

**Measurement:** re-run `npm run eval:diagnose` (272 golden cases) after slices #1/#2, and track
`pending_question_count` in the `run_diagnostics_v2_outcome` Sentry log
(`run-diagnostics.ts:923-948`) as the live over-ask metric before/after #6.
