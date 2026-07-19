# R6 — Vague-to-category TRIAGE design (ask more questions when we cannot classify)

> **Segment:** DESIGN: ask broad-to-narrow questions to establish a category/subcategory when the
> classifier cannot — instead of silently handing off to a service advisor.
> **Reviewed:** 2026-07-18, against the live code + the automotive KB. Every claim is file:line-anchored.
> **Chris's goal this serves:** "Sometimes we will have to ask MORE questions just to be able to get a
> category and subcategories." Today the pipeline NEVER does this — the two cannot-classify paths both
> route straight to `second_routine_pass` with a "we'll forward this to a service advisor" bubble and
> zero narrowing questions.

---

## 1. Ground truth — what the cannot-classify path does today

Three distinct "cannot classify" situations exist in the code, and **all three collapse into the same
silent advisor handoff**:

| # | Situation | Where it happens | What the customer experiences |
|---|---|---|---|
| A | **Stage 1 returns 0 candidates** ("too vague", "no catalog fit", OR "non-concern work-order line" — indistinguishable) | `diagnose-concern.ts:681-685` (decision rule 3: *"An EMPTY list when nothing fits… too vague to produce candidates ('car feels weird'… < ~5 useful words)"*) → `stage1_candidates: []`, `matched_kind: null` | No question asked. Falls through `run-diagnostics.ts:908-914` → `routeAfterDiagnostics` → `second_routine_pass` with the advisor bubble (`route-after-diagnostics.ts:50-54`) |
| B | **Stage 2 self-reports low confidence** on a subcategory pick | `confidence-gate.ts:64-79` — the match is STRIPPED (`matched_category_key: null`, `unanswered_question_ids: []`) so the concern "takes the exact null-match path" | Same as A. The category Stage 1 correctly identified is **discarded**, and nothing is asked |
| C | **Customer taps "None of these"** on the clarify card | `submit-concern-clarify.ts:404-409` — "no recommendation, no questions" | Same handoff (this one is defensible — the customer actively opted out of 2-3 concrete options) |

Contrast with the one path that DOES ask: when Stage 1 returns **2-3** candidates,
`run-diagnostics.ts:605-676` builds `ConcernClarifyEntry` rows with precomputed per-candidate S2/S3
payloads, routes to the `concern_clarify` chip card (`session-state.ts:40`), and
`submit-concern-clarify.ts` resolves the tap deterministically. **The machinery for "ask a chip
question, resolve, merge back into the pipeline" exists and works — it just never fires for the
0-candidate or low-confidence cases**, which are exactly the cases Chris is asking about.

Scale of the gap (from the KB): the golden set carries **37 null_match + 4 advisor_handoff cases of
272** (`FINDINGS-AND-RECOMMENDATIONS.md` §How to measure), the lexicon's "Highest-value ambiguous
phrases" table (`datasets/customer-language-lexicon.md:1378-1408`) lists ~30 real-voice utterances
where "a confident single pick is a misroute risk," and each of the 6 routers ends in an explicit
ask-first rule (e.g. `routers/router-nvh.md:109-112`, the *vague-noise safety valve*: "the wizard asks
`noise_descriptor` + `onset_timing` first").

### What makes sense in the current code (keep all of this)

- **The clarify-card pattern is the right primitive** — one-tap chips, queue-head idiom
  (`get-current-card.ts:438-471`), deterministic resolution with no second spinner
  (`submit-concern-clarify.ts:18-39`), stale-tap guards (`:356-391`), audit insert (`:569-591`).
  The triage step below is deliberately a sibling of this card, not a new invention.
- **Routing priority layering already exists**: clarify entries route BEFORE `routeAfterDiagnostics`
  (`run-diagnostics.ts:908-914`). Triage slots into the same priority chain.
- **Selective re-diagnosis** (`run-diagnostics.ts:507-549`) already supports re-invoking the pipeline
  without re-diagnosing settled concerns or re-asking answered questions — the exact substrate a
  triage re-entry needs.
- **The over-ask machinery** (`confidence-gate.ts:99-109` `overAskQuestionIds`) gives a deterministic
  "queue every question for a subcategory" path — reusable as the resolution for a subcategory-level
  triage tap with **zero** LLM calls.
- **`eligible_testing_service_keys`** (`load-diagnostic-catalog.ts:75-86`) already provides an exact
  subcategory→service mapping (built 2026-05-20 for warning-light routing) — a deterministic bridge a
  second-level triage can exploit.
- **The soft handoff is not a hard dead-end** — the customer still books, and the concern text reaches
  advisors via the summary. The design must preserve that floor; triage is an attach-rate and
  right-first-time improvement, not a rescue from a broken flow.

---

## 2. Concrete problems (ranked by severity)

**P1 — HIGH. The 0-candidate path asks nothing before handing off.** `run-diagnostics.ts:908-914` +
`route-after-diagnostics.ts:50-54`. A customer who typed "car feels weird" or "makes a noise
sometimes" gets "I'll pass this over to our service advisors" — when ONE chip question ("what kind of
trouble is it?") would, per the lexicon rows at `customer-language-lexicon.md:1398-1401`, usually
resolve to a category. Outcome cost: no testing service attached at booking (lost fee + an advisor
phone-tag round), and the shop schedules blind. This is the core of Chris's ask. *(Fix: flow/code —
the triage step, §3.)*

**P2 — HIGH. The Stage-2-low gate throws away a CORRECT category and asks nothing.**
`confidence-gate.ts:64-79` strips `matched_category_key` to null. The gate comment says the raw
concern still reaches the advisor — true, but the customer gave a category-level signal that Stage 1
successfully decoded, and we discard it rather than asking one subcategory-level question. The
pre-gate key is still in scope at the call site (`run-diagnostics.ts:737`,
`pre_gate_matched_category_key`), so run-diagnostics has everything needed to ask instead of drop.
*(Fix: flow/code — Tier B triage, §3.4.)*

**P3 — HIGH (blocks P1 from being safe). Stage 1's empty result conflates three different meanings.**
The NON-CONCERN rejection rule (`diagnose-concern.ts:651-661`: "oil change", "CHECK ALIGNMENT",
"rack replacement" → `[]`) and the too-vague rule (`:681-685`) both produce `candidates: []`, and the
result carries no reason. ~24% of the concern channel is non-concern work-order noise (taxonomy
§2). If triage fires on every empty result, a customer who typed "oil change" into Other Issue gets
asked "what kind of problem is it?" — worse than today. The Stage-1 schema
(`STAGE1_JSON_SCHEMA`, `diagnose-concern.ts:321-346`) must be extended with a `no_match_reason` enum
(`non_concern_request | too_vague | no_catalog_fit`) so triage fires ONLY on `too_vague` /
`no_catalog_fit`. *(Fix: code — schema + result plumbing; retraining — prompt rule text defining the
three reasons, with lexicon `null-route` rows as calibration examples.)*

**P4 — MEDIUM (seam trap for any re-entry design). A null-matched concern is annotated as "already
diagnosed".** After the empty-candidates pass, the write-back at `run-diagnostics.ts:889-893` stamps
the entry with `unanswered_question_ids: []`, and `isAlreadyDiagnosed` (`:547-549`) tests
**presence** of that array + non-empty text. So a naive "reset `diagnostic_processing_complete`
and re-run" (the describe-another-issue idiom, `submit-second-routine-pass.ts:204-230`) would SKIP
the very concern triage is trying to re-diagnose. The triage submit must strip the target entry's
annotation (delete the property) so exactly that one entry re-enters diagnosis — which then composes
perfectly with selective re-diagnosis for everything else. *(Fix: code, small.)*

**P5 — MEDIUM. There is no way to constrain diagnosis to a category subset.** The chip hint is an
explicit soft prior ("prefer categories tagged with one of those concern_categories unless the
description clearly says otherwise" — `diagnose-concern.ts:501-520`). After a customer ANSWERS a
triage question, their answer is ground truth, not a prior; re-running the full 30-key Stage-1
catalog and letting the model re-guess across all of it wastes the answer. `diagnoseConcern` needs an
optional constraint arg that filters the Stage-1 catalog to the chip's service subset (§3.3).
*(Fix: code.)*

**P6 — MEDIUM (data). `concern_categories[]` tags are NOT a complete routing partition — a hard
filter would wrong-exclude.** Concretely: `brake_inspection` is tagged `brakes, noise` only
(taxonomy §3a), but confusable pair #8 (taxonomy §5) says brake-only **vibration** belongs to it. A
"Shaking / vibration" triage chip hard-filtered to `vibration`-tagged services would offer ONLY
`suspension_steering_check` and exclude the brake candidate. Same class of hole: `smell` doesn't
reach `ac_performance_check` (musty-vents is tagged only `hvac`), `exhaust_system_testing` isn't
tagged `smoke` despite owning exhaust-smoke adjacency. The chip→services map must be an editable
table seeded from the tags but hand-audited, not a live tag filter. *(Fix: retraining/data — audit
the tag sets against the routers' confusable matrix; plus the mapping-table design in §3.2.)*

**P7 — LOW. No persisted reason for the handoff.** The Sentry breadcrumb records
`stage1_candidates` (`run-diagnostics.ts:733`) but the session row keeps nothing that says WHY a
concern went to advisor (vague vs non-concern vs gated vs none-of-these). Advisors and the eval
harness can't distinguish them post-hoc. *(Fix: code — persist `handoff_reason` on the explanation
item; carried into the Tekmetric description by `ensureConcernSummaries`.)*

---

## 3. THE DESIGN — `concern_triage`: a broad-to-narrow chip step before any handoff

### 3.0 Step diagram (new pieces marked ★)

```
concern_explanation ──▶ diagnostic_loading (runDiagnosticsV2)
                              │
              ┌───────────────┼──────────────────────────────┐
              │               │                              │
      1 candidate      2-3 candidates                 0 candidates
     (direct path)   (requires_clarification)             │
              │               │                 ┌─────────┴──────────┐
       confidence gate   concern_clarify        │ no_match_reason ★  │
              │           (existing card)       │                    │
     ┌────────┤               │           non_concern_request   too_vague /
     │        │          tap resolves           │              no_catalog_fit
   pass   stage2 low     deterministically      ▼                    │
     │        │               │          second_routine_pass   ┌─────┴─────┐
     │        ▼               │          (advisor, as today)   │ triage    │
     │  ★ TIER B triage       │                                │ round     │
     │  "which of these       │                                │ already   │
     │   sounds closest?"     │                                │ used?     │
     │  (subcategory chips,   │                                └─┬───────┬─┘
     │   deterministic —      │                                 no      yes
     │   no LLM)              │                                  │        │
     │        │               │                                  ▼        ▼
     │   tap → slug set +     │                    ★ TIER A concern_triage card
     │   over-ask questions   │                    "What kind of trouble is it?"
     │        │               │                    13 category chips + "Not sure /
     │        │               │                     something else"
     │        │               │                                  │
     │        │               │                   tap → ★ constrained re-diagnosis
     │        │               │                   (Stage 1 over the chip's service
     │        │               │                    subset; re-enters this SAME graph:
     │        │               │                    1 → direct, 2-3 → clarify,
     │        │               │                    0 → advisor. Round counter = 1,
     │        │               │                    so it can never triage twice)
     │        │               │                                  │
     ▼        ▼               ▼                                  ▼
  routeAfterDiagnostics (unchanged: questions → recommendations → advisor)
```

Escape hatches (hard bounds — we never loop):
- Every triage card carries **"Not sure / something else"** → immediate advisor path (exact
  none-of-these semantics from `submit-concern-clarify.ts:404-409`).
- **One Tier-A round per concern**, enforced by a `triage_round` counter on the explanation item; a
  post-triage 0-candidate result goes to advisor, never to a second triage.
- Tier B is deterministic (no LLM) and single-shot by construction.
- Worst case added to the flow: **2 taps** (one Tier-A chip + one clarify chip) before the customer
  is exactly where they'd be today — but now with a category attached.

### 3.1 Trigger condition (precise)

In `run-diagnostics.ts`, in the per-concern result handling (after `applyConfidenceGate`,
`:683-753`), a concern becomes a **triage entry** instead of falling through when:

- **T1 (Tier A):** `raw.stage1_candidates.length === 0` AND `raw.no_match_reason ∈ {too_vague,
  no_catalog_fit}` (new field, P3) AND `item.triage_round === 0` AND `parsed_ok` (an LLM FAILURE
  keeps today's safe-null handoff — never triage on an error, the customer did nothing wrong).
- **T2 (Tier B):** `gated.gate === "advisor_handoff"` (Stage-2 low, `confidence-gate.ts:67-79`) —
  build the Tier-B entry from `raw.matched_category_key` (still in scope; the gate result keeps the
  stripped copy for the fall-through).
- **Never triaged:** `no_match_reason === "non_concern_request"` (work-order lines — advisor as
  today), none-of-these taps, LLM failures, and any concern with `triage_round >= 1`.

Routing priority in `run-diagnostics.ts:908-914` becomes: `triageEntries > clarifyEntries >
routeAfterDiagnostics` — triage first because its resolution can PRODUCE a clarify entry; the
reverse can't happen.

### 3.2 Tier A — the first-level triage card (category chips)

**Question (Jeff-voice, editable via `scheduler_card_text` like every card):** *"Got it — I couldn't
quite match that to one of our tests. Which of these is closest to what's going on?"* with the
customer's own text echoed above the chips (same eyebrow idiom as `ConcernClarifyPayload.concern_text`,
`card-payloads.ts:207-221`).

**Chip set = the 13 non-`other` concern categories** (taxonomy §4), phrased in customer voice, one
chip per row of a new editable mapping table (seeded as below; the `candidate service subset` column
is seeded FROM `testing_services.concern_categories[]` then hand-audited per P6):

| # | Chip label (customer voice) | maps_to categories | candidate service subset (audited seed) |
|---|---|---|---|
| 1 | A noise it shouldn't be making | noise | brake_inspection, brake_inspection_warning_light, exhaust_system_testing, suspension_steering_check |
| 2 | Shaking or vibration | vibration | suspension_steering_check, **+ brake_inspection** (P6 fix — confusable #8) |
| 3 | A warning light on the dash | warning_light | the 13 warning_light-tagged services |
| 4 | Leaking or a puddle under the car | leak | coolant_leak_testing(+euro), oil_leak_testing, oil_pressure_light_testing, ac_leak_testing |
| 5 | A strange smell | smell | coolant_leak_testing(+euro), oil_leak_testing, exhaust_system_testing, **+ ac_performance_check** (P6 fix — musty vents) |
| 6 | Smoke or steam | smoke | coolant_leak_testing(+euro), oil_leak_testing, **+ check_engine_light_testing** (blue/gray smoke, taxonomy §3a), **+ exhaust_system_testing** |
| 7 | The brakes | brakes | brake_inspection, brake_inspection_warning_light, abs_traction_stability_testing |
| 8 | Steering, pulling, or drifting | steering + pulling | suspension_steering_check, power_steering_eps_testing |
| 9 | Heat or A/C | hvac | ac_performance_check, ac_leak_testing |
| 10 | Battery, electrical, or something won't turn on | electrical | the 9 electrical-tagged services |
| 11 | How it runs or drives (power, stalling, shifting) | performance | the 10 performance-tagged services |
| 12 | Tires or wheels | tires | tire_repair, tpms_testing, **+ suspension_steering_check** (confusable #6) |
| 13 | Something else / not sure | — | → advisor (escape hatch) |

13 chips + escape is within the Heritage card's proven range (the `noise` Stage-2 pool already
renders 12 subcategory options as question chips). The mapping table also gives Chris a no-code
tuning surface: merge rows (e.g. 2+8 into "Steering / handling / shaking") by editing
`maps_to`/`active`, reorder, re-label — all `/schedulerconfig`-editable, mirroring how
`example_keywords`/`synonyms` are already DB-owned (`diagnose-concern.ts:465-468`).

**Persistence:** a `concern_triage_state` JSONB queue column on `customer_chat_sessions` — same
queue-head idiom as `concern_clarify_candidates` (one entry per triaged concern:
`{concern_index, service_key, display_name, concern_text, tier: "category" | "subcategory",
chips: [...]}`). `get-current-card.ts` reads the head defensively exactly like `:438-471`.

### 3.3 Re-entry — how a Tier-A answer re-enters diagnosis

New action `submit-concern-triage.ts` (mirrors `submit-concern-clarify.ts`'s guards: current_step
check, head-entry validation, invalid-key Sentry warning, audit insert):

1. Record the answer on the source explanation item: `triage_answers: [{chip_key, label}]`,
   `triage_round: 1`. **Strip the item's `unanswered_question_ids` annotation** (P4) so
   `isAlreadyDiagnosed` (`run-diagnostics.ts:547-549`) returns false for exactly this concern.
2. Pop the triage queue head; set `diagnostic_processing_complete: false`; `nextStep:
   "diagnostic_loading"` with a userBubble of the tapped chip label (transcript honesty, same as
   clarify's `:519-520`).
3. `runDiagnosticsV2` re-fires (the card already invokes it on mount; idempotency + selective
   re-diagnosis handle the rest — settled concerns skip per `:572-593`, answered questions are
   excluded per `:526-539`).
4. For the triage-target concern, `run-diagnostics` sees `triage_answers` and calls
   `diagnoseConcern` with a new optional arg:
   ```ts
   category_constraint?: {
     allowed_service_keys: string[];   // the chip row's audited subset
     customer_answer_label: string;    // e.g. "Shaking or vibration"
   }
   ```
   Effect inside `diagnoseConcern`: (a) `buildStage1SystemPrompt` renders ONLY the allowed testing
   services (the 6 situational `'other'` buckets stay — the PRIORITY-ORDER situational cues at
   `diagnose-concern.ts:608-648` must keep working); (b) the user prompt gains a structured line:
   `# Follow-up answer\nAsked "Which of these is closest…" → customer chose: "{label}"`. This is a
   **hard catalog constraint**, not a chip-hint prior (P5). Subset of size 1 short-circuits Stage 1
   entirely → straight to that service's Stage 2 (relevant for a merged pulling/vibration-style
   chip whose audited subset is a singleton).
5. The re-run result flows through the UNCHANGED downstream graph: 1 candidate → gate → questions/
   recommendation; 2-3 → the existing clarify card (this IS the second-level narrowing — now over
   concrete services with prices, precomputed S2/S3, one tap); 0 → advisor handoff (round counter
   blocks a second triage).

Cost: one extra `diagnostic_loading` spinner pass for one concern — the established UX idiom; no new
loading surface. Only the triage-target concern pays LLM tokens (Stage 1 over a ~4-13-entry catalog
is cheaper than the original 30-entry pass).

### 3.4 Tier B — Stage-2-low triage (subcategory chips, zero LLM)

When T2 fires, the category is KNOWN (`raw.matched_category_key`) — only the subcategory is
uncertain. Push a `tier: "subcategory"` triage entry whose chips are the matched Stage-2 pool's
`display_label`s (e.g. for a low-confidence `noise` pick under `suspension_steering_check`: "Clunking
over bumps", "Humming or whirring at speed", …) + "Not sure". This is the wizard-native form of what
every router prescribes — the subcategory labels ARE descriptor×condition bundles, so one tap
answers the router's "ONE discriminating fact" (`router-nvh.md:87-107`; the lexicon's
`ask / discriminate on` column at `customer-language-lexicon.md:1382-1408`).

Resolution is **fully deterministic** — `submit-concern-triage.ts` on a `tier: "subcategory"` tap:
set `matched_subcategory_slug` = tapped slug; queue that subcategory's FULL question list via the
existing `overAskQuestionIds` (`confidence-gate.ts:99-109`) — Stage 3 was low-trust anyway, and
over-ask is the sanctioned degradation (`confidence-gate.ts:30-33`: "re-asking is cheap"); dedupe
the recommendation exactly as `submit-concern-clarify.ts:415-461` does; route via
`routeAfterDiagnostics`. No LLM call, no spinner, no round-counter concern.

"Not sure" → advisor handoff with `handoff_reason: "stage2_low_customer_unsure"` (P7).

### 3.5 What is deliberately NOT in v1

- **No free-text second round.** The narrowing is chips-only; free text re-enters only via the
  existing describe-another-issue branch. Keeps the loop bounded and the transcript clean.
- **No Tier-A triage for `non_concern_request`** — those need a booking-path nudge (a different
  segment's problem), not a symptom question.
- **No category-specific scripted question trees** (e.g. warning_light → "which light?" chips using
  `eligible_testing_service_keys` for deterministic service resolution). The constrained re-run +
  clarify card covers it in v1 with less machinery; the mapping table reserves an optional
  `second_level: "llm_rerun" | "subcategory_chips"` column so warning_light/leak (whose subcategory
  labels are perfect discriminators: light names, fluid colors) can be upgraded to the deterministic
  path later without schema churn.
- **No change to `routeAfterDiagnostics`** — triage is layered ABOVE it, like clarify.

### 3.6 File-change list (each tagged code vs retraining)

| File | Change | Lever |
|---|---|---|
| `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` | `no_match_reason` in `STAGE1_JSON_SCHEMA` + `Stage1ResponseSchema` + `DiagnoseConcernResult`; optional `category_constraint` arg; constrained catalog rendering in `buildStage1SystemPrompt`; follow-up-answer line in `buildUserPrompt` | **[code]** + **[retraining]** (prompt rules defining the 3 reasons; calibrate with lexicon null-route rows) |
| `run-diagnostics.ts` | T1/T2 trigger branches → build `concern_triage_state` entries; routing priority `triage > clarify > routeAfterDiagnostics` (`:908-914`); pass `category_constraint` for triage-answered items; persist `handoff_reason`; telemetry fields (`triage_concern_count`, `no_match_reason`, `triage_round`) in the `Sentry.logger.info` payload (`:923-948`) | **[code]** |
| NEW `actions/submit-concern-triage.ts` | Tier-A: record answer, strip annotation (P4), reset `diagnostic_processing_complete`, route `diagnostic_loading`. Tier-B: deterministic slug set + over-ask queue + rec dedupe. Guards + audit mirror `submit-concern-clarify.ts` | **[code]** |
| `session-state.ts` | Add `"concern_triage"` to `WIZARD_STEPS` (step-7 cluster, next to `concern_clarify` `:40`) | **[code]** |
| `card-payloads.ts`, `get-current-card.ts`, `WizardSurface.tsx`, `submit-back.ts`, `WizardProgress.tsx` | `ConcernTriagePayload` + union arm + head-of-queue parser + card arm + back handling | **[code]** |
| NEW `ConcernTriageCard.tsx` | Heritage chip card, mirrors `ConcernClarifyCard.tsx` (escape-only fallback for empty chips). UI change ⇒ needs a `frontend-design-director` spec in the plan phase per `orchestration.md` | **[code]** |
| NEW migration `concern_triage.sql` | `customer_chat_sessions.concern_triage_state JSONB DEFAULT '[]'`; new shop-scoped `concern_triage_chips` table (`chip_key, display_label, maps_to_categories TEXT[], extra_service_keys TEXT[], display_order, active`) seeded per §3.2; `scheduler_card_text` seed row for the new card | **[code]** (schema) + **[retraining]** (chip labels/audited subsets are data Chris tunes) |
| `/schedulerconfig` | Editor tab (or table-grid reuse) for `concern_triage_chips` | **[code]**, small |
| `testing_services.concern_categories[]` audit | Add `vibration` to brake_inspection; `smell` reach for ac_performance_check; `smoke` for exhaust/CEL — align tags with taxonomy §5 confusables (P6). Apply via /schedulerconfig | **[retraining]** |
| `scheduler-app/scripts/eval` + `datasets/golden-cases.json` | New expected label `triage` for the 28 null-route vague cases that should now triage (non-concern lines KEEP `null_match`); add chip-answer → final-route assertions | **[retraining]** (dataset) + **[code]** (grader support) |
| pgTAP + Vitest + Playwright | Unit: trigger matrix (T1/T2/never-triage), P4 annotation-strip, round bound; E2E: vague text → chip → constrained result; the multi-concern ordering (triage before clarify) | **[code]** (TDD per `build-orchestration.md`) |

### 3.7 How we'll know it worked

- Sentry Logs (`run_diagnostics_v2_outcome`): `second_routine_pass` share attributable to
  `too_vague` should fall; new `triage → testing_service_approval` conversions counted per session.
- Eval: baseline `npm run eval:diagnose` on the 272-case golden set BEFORE, then the triage slice —
  the 37 null_match cases split into (non-concern stays null) vs (vague → triage → correct category
  after simulated chip answer).
- Booking-level: testing-service attach rate on sessions whose first pass returned 0 candidates.

---

## 4. Best-outcome gaps this closes (and one it exposes)

1. **Customer**: vague describers currently get zero help narrowing ("we'll forward this…") — with
   triage they get one familiar chip tap and usually land on a concrete recommendation with a price,
   the same experience clear describers already get.
2. **Shop**: every un-triaged vague concern is an advisor callback + an unattached diagnostic fee;
   triage converts a measurable share at the cost of ≤2 taps.
3. **Stage-2-low concerns**: currently the pipeline's most wasteful path (a correct category
   discarded); Tier B recovers it with zero LLM spend.
4. **Exposed gap (follow-on, out of scope here):** `no_match_reason === "non_concern_request"` still
   deserves better than the generic advisor bubble — "sounds like you're after {service} — want me
   to add it?" would route work-order lines back into the routine-service picker. Noted for the
   requests/situational router segment (`routers/router-requests-maintenance` owns it).

## 5. Prioritized recommendations

1. **[code]** Build the `concern_triage` step per §3 (Tier A + Tier B, new column + card + action +
   trigger branches). P1/P2. Biggest single alignment with Chris's stated goal.
2. **[code + retraining]** Add `no_match_reason` to Stage 1 FIRST — it gates safe triage (P3). Ship
   it even before the card: it immediately improves observability of today's handoffs (P7).
3. **[retraining]** Audit `testing_services.concern_categories[]` against the taxonomy §5 confusable
   matrix before seeding the chip subsets (P6) — a wrong-exclusion in a hard-filtered subset is the
   one way this design can make routing WORSE than today.
4. **[code]** Strip-annotation re-entry fix (P4) — tiny, but without it the triage answer silently
   does nothing (the concern re-run skips), which would be a worse dead-end than the current one.
5. **[retraining]** Seed the chip labels/copy from the customer-voice style guide + lexicon; keep
   them DB-owned so Chris iterates without deploys (matches the existing keyword/synonym ownership
   model, `diagnose-concern.ts:465-468`).
6. **[retraining]** Extend the golden set with triage-path cases and re-baseline before/after — the
   KB's apply-sequence discipline (`FINDINGS-AND-RECOMMENDATIONS.md` §Recommended apply sequence)
   applies to this flow change too.
