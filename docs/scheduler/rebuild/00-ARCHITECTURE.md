# Scheduler rebuild — the classification foundation (from scratch)

> **Staging area for the ground-up rebuild of the scheduler + schedulerconfig modules.** Nothing here is
> wired to the live system yet. We build the base (this doc + the anchor knowledge base + the eval), get it
> right, then archive the old modules and build the new ones on top. Everything starts with how the LLM
> reads a customer's concern.
>
> Design settled 2026-07-19 with Chris + an independent Fable-5 research pass + a second research pass —
> both converged on the same core, which is the reason to trust it. This is a clean-sheet design; it does
> not inherit the current scheduler's architecture.

---

## The problem (unchanged, stated cleanly)

A customer types their car problem in their own words — vague ("weird noise") to detailed, often terse or
misspelled. The system must (1) understand + categorize it into the shop's services so the right diagnostic
gets booked, and (2) figure out what's missing and ask the right clarifying questions to end with a
complete, actionable picture. Accuracy is critical; a wrong category books the wrong service. **Safely
deferring (asking, or forwarding to an advisor) always beats confidently guessing wrong.**

## Core reframe: extraction-first

We are NOT building a classifier that emits a label. We are building a system that produces a structured
**Concern record** from the customer's words; the category is *derived* from that record. The target shape
is the auto industry's own **"Three Cs" Concern**: the symptom, when it happens, under what conditions, and
associated signals — plus safety flags.

```
ConcernRecord {
  symptom:            what the customer perceives (noise / leak / light / won't-start / feel / smell / smoke / request)
  location:           where (a wheel, under hood, underneath, cabin, a specific corner …)
  when/conditions:    when it happens (braking, turning, cold start, over bumps, at speed, always …)
  associated_signals: lights, smells, fluid, smoke, drivability
  duration/onset:     how long, sudden vs gradual
  safety_flags:       brakes/steering/fuel-smell/overheating/red-lights → hard branch
  verbatim:           the customer's exact words (always carried to the booking)
}
```

## The pipeline

```
customer text
  │
  ▼
[1] EMBED + RETRIEVE  (fast, cheap, no LLM)
  │   Embed the text; nearest-anchor search over the knowledge-seeded (+ customer-strengthened) anchor
  │   bank → a SHORTLIST of candidate categories with CALIBRATED similarity + the most-similar example
  │   anchors. Embedding similarity is a well-calibrated confidence signal (unlike an LLM's self-reported
  │   confidence), so it also feeds the decision gate.
  ▼
[2] ONE structured-output LLM call  (fast tier; Haiku-class)
  │   Given ONLY the shortlist + a few retrieved anchors (small prompt → ~1-2s, no timeout), the model:
  │   extracts the ConcernRecord, PICKS among the shortlisted candidates, and returns top-k with a
  │   confidence bucket + a verbatim EVIDENCE QUOTE per candidate + the MISSING SLOTS + the ambiguity type.
  │   Escalate the SAME prompt to a stronger model only when confidence is low (cheap p50, spend on accuracy).
  ▼
[3] DECISION LAYER — deterministic code, NOT the model
  │   confident single category + required slots filled + no safety flag        → BOOK (echo a confirm line)
  │   two-three plausible categories, or a required slot missing                → ASK (chips, ≤3 turns)
  │   REAL car concern but can't pin a category (low conf / weak retrieval /     → GENERAL TESTING — bookable,
  │       question budget spent)                                                    starts $89.95, no canned job;
  │                                                                                  advisors refine it from the emailed
  │                                                                                  concern ("we'll let you know if more
  │                                                                                  testing is needed"). See 02-SYSTEM-DESIGN §4.
  │   NOT a car-repair request (out_of_scope)                                    → advise to call the shop (not bookable)
  │   safety_flag = advise_immediately (any point)                              → short-circuit safety branch
  │   (LLMs detect ambiguity but won't reliably ASK on their own — the ask/defer decision must live here.)
  ▼
[4] QUESTION TURN (only if needed) — chip-first, slot-driven, budgeted
  │   Ask the single most-DISCRIMINATING question: between-category ambiguity → the confusable-pair
  │   question; within-category → the highest-value missing slot. Tap chips where the answer set is
  │   enumerable (faster + cleaner data than typing). Merge the answer into the ConcernRecord, re-run [1]/[2]
  │   with accumulated context. Never re-ask what the customer already said.
  ▼
[5] BOOKING PAYLOAD = category + full ConcernRecord (customer's own words) + everything logged for the loop.
```

## The anchor knowledge base (the day-one embedding seed) — `anchors/`

The embedding space is NOT built from scarce customer labels. It is seeded with **automotive diagnostic
knowledge expressed in customer language**: for each concern a customer might report, a bank of diverse
customer-voice **anchor phrasings**, mapped to the category/subcategory, with the required-slot schema, the
confusable-pair discriminators (+ the separating question), and a safety flag. Researched now (see
`anchors/` + the fan-out that built it). Every resolved real concern later becomes a new anchor that
strengthens and customer-aligns the bank — no retraining, survives catalog growth.

**Anchor schema (per concern/subcategory):**
```yaml
category: <broad customer-concern category>
subcategory: <specific service/diagnostic slug>
customer_voice_anchors: [ 8-15 diverse ways a real customer phrases this symptom ]
required_slots: [ the facts that make this bookable — the Three Cs for THIS concern ]
confusables:      # the near-misses + the question that separates them
  - vs: <other subcategory>
    discriminator_question: "..."
safety_flag: none | advise_immediately   # brakes/steering/fuel-smell/overheating/red-light etc.
notes: <boundary notes — "includes / does not include">
```

Reserved from day one: `general_diagnostic` (a legitimately vague but real concern — bookable as a diag)
and `out_of_scope` (not a car-repair request).

## Measuring accuracy honestly (non-negotiable)

- Gold labels from **real customer-voice inputs**, human-adjudicated (advisors) — NOT the LLM grading itself
  (self-preference bias is real). If LLM judges scale the labeling, use a **different model family** +
  ensemble + human review of disagreements. **Never train/eval on advisor RO shorthand — different
  distribution from customer voice.** (This is why we dropped Tekmetric ROs.)
- The ultimate label once live: the **closed repair order** — predicted category vs the service actually
  performed. Only unbiased signal.
- Per-class precision/recall + confusion matrix (not one number); **confidence intervals on everything**
  (a "94 vs 91" delta on a few hundred cases is usually noise); score the **deferral behavior** (coverage
  at a fixed selective-risk target, OOS recall, % of clarifying questions whose answer changed the outcome,
  turns-to-booking, abandonment). Freeze + version the eval set; stamp catalog-version + prompt-hash.

## The flywheel (how it gets better)

Log every interaction (input, ConcernRecord, candidates+confidence, decision, questions+answers, booking,
closed-RO). Weekly advisor triage of deferrals / corrections / low-confidence accepts → each becomes a
labeled anchor. The labeled corpus (a) grows the retrieval anchor bank, (b) recalibrates thresholds, (c)
surfaces catalog boundary fixes from the confusion matrix. Distill to a small classifier ONLY if volume
ever justifies it — at a single shop's volume the LLM path is pennies/day.

## Build order

0. **This doc + the anchor knowledge base + the eval harness** (the base — before any module code).
1. **The catalog/taxonomy + anchor bank** — customer-concern categories → subcategories, each with anchors,
   slots, confusables, safety. (Research fan-out — in progress.)
2. **Embed + retrieve** front end over the anchor bank (the fast shortlister + calibrated confidence).
3. **The single structured-output extract+pick call** + the deterministic decision layer (thresholds very
   conservative to start — defer a lot), with the advisor-forward fallback as the safety net.
4. **Question turns** — chips, slot questions, ≤3 budget, safety short-circuit.
5. **The review console + flywheel** (schedulerconfig) — the advisor triage queue = the data engine.
6. **Threshold calibration on real labels, escalation tier, confusion-driven catalog iteration.**

Then: archive the old scheduler + schedulerconfig modules, build the new ones on this base.

## One-liner

*A knowledge-seeded embedding bank does the finding, a small fast LLM does the reading, a versioned catalog
does the knowing, deterministic code does the deciding, humans do the adjudicating, and what actually fixed
the car does the teaching.*
