# R2 — Stage 1: category candidates & the 0/1/2-3 decision

> Workflow review segment R2 (2026-07-18). Scope: the Stage-1 candidate logic + the act-or-ask
> contract — prompt + decision rules + STAGE1 schema (`diagnose-concern.ts`), the catalog build
> (`load-diagnostic-catalog.ts`), and the 0/1/2-3 + empty handling (`run-diagnostics.ts`).
> Judged against Chris's goal: *ask the right questions, extract the correct information, and when
> we can't classify, ask MORE questions to establish a category — don't dead-end or guess.*
>
> All paths relative to `scheduler-app/src/lib/scheduler/wizard/` unless noted. Findings tagged
> **[retraining]** (catalog/DB/prompt-text data fix) or **[code]** (flow/mapper/schema change).

---

## 1. What makes sense (keep it)

- **The structural candidate-count signal replacing self-reported Stage-1 confidence is right.**
  `llm/diagnose-concern.ts:321-346` (schema) + `:1666-1689` (validate → dedupe → drop hallucinated
  keys → truncate to 3). Small models are overconfident self-raters; "how many candidates did you
  emit" is a behavior, not a self-report. The eval history (flash-lite, 1-in-112 hard misroutes)
  backs the model choice.
- **The 1 = commit / 2-3 = clarify / 0 = advisor split is the right *skeleton*.** One tap resolves
  the 2-3 case deterministically from precomputed per-candidate S2+S3 chains
  (`diagnose-concern.ts:1753-1793`, `actions/run-diagnostics.ts:605-676`) — no second spinner, and
  per-candidate failures degrade per-candidate (`runStagesTwoAndThree` never throws,
  `diagnose-concern.ts:1420-1432`). The clarify card has a real "None of these / not sure" escape
  (`actions/submit-concern-clarify.ts:60-68`, `heritage/ConcernClarifyCard.tsx:97-105`) — the
  customer is never trapped into a wrong category.
- **"Hedging has a REAL COST" (rule 1, `diagnose-concern.ts:665-672`) is the correct economics.**
  Every extra candidate is an extra customer tap plus ~2 extra precomputed LLM calls. Coupled with
  rule 8's targeted hedge list it correctly biases toward single-candidate commits on clear text.
- **PRIORITY-ORDER causal-tie discipline (`diagnose-concern.ts:608-648`) matches reality.** The
  "cue must be CAUSALLY tied, not mentioned in passing" rule (tow-in-then-symptom routes the
  symptom, `:636-644`) mirrors exactly what the KB's requests/situational router independently
  derived (`docs/automotive-knowledge-base/binding/requests-and-situational-routing.md` §A#3-4,
  §B override discipline). Good seam: prompt and KB agree.
- **The NON-CONCERN rejection rule (`diagnose-concern.ts:650-661`) is well-aimed.** ~24% of the
  real concern channel is work-order noise (taxonomy §2); refusing to guess a fee-bearing test for
  "rack replacement" is the right call, and the "request that ALSO describes a symptom stays"
  exception matches router table row A#1.
- **The keyword layer is DB-owned and advisor-editable** (`example_keywords` ∪ subcategory
  synonyms, round-robin so every subcategory contributes before the 40-cap —
  `diagnose-concern.ts:469-499`). Retraining lever L1 has a real, no-deploy landing surface.
- **Downstream nets bound Stage-1's blast radius.** A wrong single-candidate commit still passes
  the Stage-2-low confidence gate (strip → advisor, `confidence-gate.ts:64-80`) and every
  recommendation is advisor-reviewed. Over-commit is recoverable; that makes rule 1's aggression
  acceptable — *on the direct path* (see problem P2 for where this net has a hole).

---

## 2. Problems, ranked

### P1 — HIGH. The empty list conflates three different situations, and the one Chris cares about gets the WORST treatment. **[code + retraining]**

Rule 3 (`diagnose-concern.ts:681-684`) returns `[]` for three unrelated reasons:

1. **Non-concern / work-order text** ("oil change", "rack replacement") — advisor handoff is
   CORRECT; there is no symptom to triage.
2. **No catalog fit** ("quote for 4 new tires") — advisor handoff is correct *today* (known
   catalog gap, router §F).
3. **Vague-but-real concern** ("car feels weird", "something's off") — advisor handoff is the
   WRONG outcome by Chris's own definition: *"sometimes we will have to ask MORE questions just to
   be able to get a category."*

The schema (`diagnose-concern.ts:321-346`) returns only `candidates: []` + free-text `reasoning`
(audit-only) — there is **no machine-readable discriminator for WHY the list is empty**, so
`run-diagnostics.ts:1683-1689` → `nullMatch` → `routeAfterDiagnostics` (`route-after-diagnostics.ts:50-54`)
cannot treat the three cases differently even if we wanted it to. The customer gets "Thanks for
the detail — I'll pass this over to our service advisors" (ironic copy for a 4-word description),
the appointment books, and the advisor inherits a phone-tag round with near-zero information.

**The asymmetry that makes this acute:** every OTHER path in the pipeline collects structured
information before handing off. A matched testing service asks its gap questions. Even the six
'other' situational buckets — the *designed* advisor-handoff path — carry their own question sets
that get queued (`run-diagnostics.ts:835-869` queues questions for `other_subcategory` matches
too). Only the Stage-1-`[]` path collects **nothing**. So the customer who is *hardest* to
classify is the one we ask the *fewest* questions. That is exactly backwards relative to the goal.

**Recommended fix, two tiers:**

- **Short-term [retraining, zero code]:** there is already a catalog entry built for "I don't know
  what's wrong" — `multiple_symptoms_not_sure_what_category` — with its own question set. Broaden
  its display label/description/synonyms to also own *vague single-complaint* text ("something
  feels off", "car is acting weird", "not driving right"), and adjust rule 3 so genuinely-vague
  **vehicle-concern** text routes there as ONE candidate instead of `[]`. The bucket's questions
  then do the triage. Reserve `[]` for non-concern + no-catalog-fit. ⚠️ Verify first (taxonomy §7
  snapshot query) that this bucket's questions actually establish a *system/category* ("Is it a
  noise, a warning light, a leak, how it drives…?"); if they don't, add/adjust that first question
  — that single question IS the broad triage step Chris asked about.
- **Durable [code]:** add `empty_reason: "non_concern" | "too_vague" | "no_catalog_fit"` to
  `STAGE1_JSON_SCHEMA` (enum keyword is supported — Stage-2/3 schemas already use `enum`,
  `diagnose-concern.ts:359-361`), thread it through `nullMatch`, and in `run-diagnostics.ts` route
  `too_vague` to a deterministic triage chip card (the `concern_clarify` machinery already renders
  chip cards; a triage variant lists the ~9 top-level symptom areas). Non-concern and
  no-catalog-fit keep today's direct advisor handoff. This also fixes the telemetry blind spot:
  today a genuine "nothing fits" and a hallucinated-keys-only response both surface as the same
  null-match (`:1683-1689` sets `invalid_category_key:` in `error_message` but nothing consumes it).

**Answer to Chris's key question:** straight-to-advisor is the best outcome ONLY for the
non-concern and no-catalog-fit slices of empty. For the too-vague slice it is a dead-end that
wastes the one moment the customer is engaged and typing. Ask one broad triage question first —
via the existing multiple-symptoms bucket now, via an `empty_reason`-gated triage card properly.

### P2 — HIGH. The clarify path silently bypasses the confidence gate — the seam between Stage 1 and the gate does not line up. **[code]**

On the **direct** path (1 candidate), a testing-service match with Stage-2 confidence "low" is
stripped to advisor handoff, and Stage-3 "low" triggers full over-ask
(`run-diagnostics.ts:683-711`, `confidence-gate.ts:57-92`). On the **clarify** path (2-3
candidates) the raw result short-circuits *before* the gate (`run-diagnostics.ts:605-676`, gate
hardcoded `"pass"` at `:673`), and the persisted `ClarifyCandidateOption.precomputed` keeps ONLY
`matched_subcategory_slug` + `unanswered_question_ids` (`run-diagnostics.ts:131-145`, built
`:637-641`) — the per-candidate `stage2_confidence`/`stage3_confidence` that
`CandidateDiagnosis` carries (`diagnose-concern.ts:248-249`) are **dropped at persist**. So
`submit-concern-clarify.ts:415-474` merges the tapped candidate into a fee-bearing recommendation
with no gate and no ability to gate.

Failure scenario: text that would have been advisor-routed on the direct path (S2 self-rated
"low" — forced subcategory pick) instead produces a $179.95 recommendation *just because Stage 1
hedged first*. The customer's tap confirms the CATEGORY, which is fair extra signal — but S2-low
means the *subcategory* pick inside that category is suspect (wrong question set follows), and
S3-low means the answered-question mapping is suspect (questions wrongly skipped). Neither is
cured by the category tap.

**Fix:** persist the two confidences in `precomputed` and apply the same two rules at tap time in
`submit-concern-clarify.ts`: S2-low → treat the tap as the soft advisor path (same branch as
none-of-these, `:404-409`); S3-low → expand to the full subcategory question list
(`overAskQuestionIds` equivalent — the catalog is already loaded there, `:418`). Small, contained.

### P3 — MEDIUM-HIGH. Hedge rules are hard-coded prose covering 3 of the 9 documented confusable pairs — and the KB's 115 hedge ops have no landing surface. **[code enabler, then retraining]**

Rule 8 (`diagnose-concern.ts:707-725`) enumerates exactly three pairs: brake vs brake-warning-
light, no-start vs charging-starting, coolant vs AC-heat. Taxonomy §5 documents nine, and the
missing six are real Stage-1 traps (white vs blue/gray smoke; exhaust vs oil leak; tire_repair vs
tpms vs suspension; window vs electrical-general; brake-vibration vs suspension-vibration;
tire-buying null-route). Some are partially encoded in service `description` text, but rule 8 is
the only surface with "return BOTH, don't guess" force. Meanwhile
`FINDINGS-AND-RECOMMENDATIONS.md` has **115 `stage1.hedge.add` ops** queued — and the only place
they can land today is this hard-coded prompt string, i.e. a code deploy per hedge iteration,
while every other Stage-1 signal (keywords, descriptions, tags) is DB-owned and /schedulerconfig-
editable.

**Fix:** add a DB-owned hedge surface — e.g. a `confusable_with:` line per testing service (new
column or a small `confusable_pairs` table) rendered into the catalog block the same way
`buildCategoryKeywordLine` renders keywords (`diagnose-concern.ts:564-570`). Then apply the 115
ops as data. Keep rule 8 as the generic instruction ("when a `confusable_with` pair is plausible,
return both") and delete the hard-coded pair prose.

### P4 — MEDIUM. Keyword-line synonym fan-out makes keywords NON-discriminative across exactly the services that are confusable. **[retraining, verify against DB]**

`buildCategoryKeywordLine` (`diagnose-concern.ts:469-499`) unions a service's subcategories'
synonyms into its keyword line — but subcategories with no explicit
`eligible_testing_service_keys` fan out to EVERY service tagging their parent category
(`load-diagnostic-catalog.ts:344-353`). All 12 `noise` subcategories fan into `brake_inspection`,
`suspension_steering_check`, AND `exhaust_system_testing` (all three tag `noise`, taxonomy §3a) —
so "clunk over bumps" synonyms appear in *brake_inspection's* keyword line, and rule 7
(`diagnose-concern.ts:700-704`) tells the model a keyword hit is "a strong signal for that
category". Best case that manufactures an unnecessary 2-candidate hedge (extra customer tap);
worst case a wrong single pick. The dilution hits precisely the NVH confusable set the KB's
router table exists to separate.

**Fix (data-first):** give shared-pool subcategories explicit `eligible_testing_service_keys`
mappings where the KB's decision tables assign a home (the loader already prefers explicit
mappings, `load-diagnostic-catalog.ts:307-315`). Alternatively **[code]**: exclude fanned-in
shared subcategories from the keyword line (only render synonyms of subs exclusive to the
service), keeping `example_keywords` as the per-service discriminator. Verify current fan-out
with the taxonomy §7 snapshot query before choosing.

### P5 — MEDIUM. The six 'other' situational buckets compete with one line of text each — their DB enrichment is thrown away. **[code]**

Stage 1 renders testing services with display name + price + "What we'd do" + tags + up to 40
keywords (`diagnose-concern.ts:557-573`), but each 'other' bucket gets ONE line:
`subcategory_slug — display_label` (`:575-580`). The loader is why:
`OtherSubcategoryCategory` keeps only slug/label/questions
(`load-diagnostic-catalog.ts:135-143`, `:369-377`) even though the 'other' rows in
`concern_subcategories` carry description/positive_examples/negative_examples/synonyms like every
other active subcategory (taxonomy §2: "enrichment is fully populated"). The Stage-2 comment at
`diagnose-concern.ts:764-767` ("carries no enrichment metadata because the 'other' path doesn't
go through concern_subcategories") is factually wrong — they DO come from that table; the loader
just discards the columns. Consequence: the situational buckets — which the PRIORITY-ORDER rule
wants to WIN in their scenarios — are the least-described options in the catalog, and the
customer phrases the KB collected for them ("been parked six months", "just want it road-ready")
have no keyword surface. **Fix:** carry the enrichment through the loader and render a
description + synonyms line for the 'other' block (also fixes Stage 2's empty singleton,
`diagnose-concern.ts:765-779`).

### P6 — MEDIUM. The "< ~5 useful words" vagueness cue risks false empties on the terse real-corpus voice. **[retraining/prompt text]**

Rule 3's parenthetical (`diagnose-concern.ts:682-684`) lists `< ~5 useful words` alongside "car
feels weird" as an emptiness signal, and the KB router codified it (router table row A#0). But the
real Tekmetric voice is DOMINATED by terse, fully-classifiable fragments — the lexicon routes
"WIPERS NOT SPRAYING" (3 words), "HORN INOPERABLE" (2), "HEAT BLOWING COLD AIR" (4), "CHECK
BRAKES SQUEALING" (3) as unambiguous (`datasets/customer-language-lexicon.md`, electrical/HVAC/
brakes sections). Everything hangs on the model reading "useful" charitably. A length heuristic is
the wrong feature; content is the feature. **Fix:** reword rule 3 to "contains no identifiable
system, component, or symptom content (e.g. 'car feels weird', 'something's off', 'it's broken')"
and drop the word-count clause; mirror the fix in the router doc so prompt and KB stay agreed.
Add 2-3 terse-but-clear positives to rule 1's examples ("WIPERS NOT SPRAYING" →
windshield_inop_testing) so the boundary is taught by contrast.

### P7 — LOW-MEDIUM. The situational-cue + symptom 2-candidate clarify asks the customer to choose between two things that are BOTH true. **[design decision for Chris]**

Rule at `diagnose-concern.ts:646-648`: cue + clear symptom → "return the situation key first and
the testing service second (a 2-candidate clarify)". The clarify card then asks "Which of these
sounds closest?" — but for "brake job last week, still squeals", *both* chips are true
simultaneously; they're not alternatives. Tap the service → the after-recent-work context stops
driving routing (it survives only in the summary text); tap the situation → no test gets
recommended for a testable symptom. Either tap discards half the truth. Options: (a) route the
situational key and ATTACH the symptom (advisor sees both; today's summary partially does this);
(b) keep the clarify but with copy acknowledging both ("Was this after recent work, or would you
like us to test the squeal directly?"). Which is the better *business* outcome (advisor-first vs
test-first for came-back-after-work cars) is Chris's call — flagging that the current UX quietly
makes that call via whichever chip the customer taps.

### P8 — LOW. Chip-hint vs empty tension is unspecified. **[retraining/prompt text]**

If the customer tapped a specific concern chip (a category statement!) and then typed vague text,
rule 3 says empty while rule 4 says the chip is "a prior, not a constraint"
(`diagnose-concern.ts:686-689`, `:514-519`) — the prompt never says which wins. Best outcome: the
chip should rescue borderline-vague text (return the chip-mapped category as the single
candidate; the S2-low gate still catches a genuinely hopeless description downstream). One
sentence in the chip-hint block fixes it: "If the description alone is too vague but the chip
names a category, prefer the chip-mapped candidate over an empty list."

### P9 — LOW. Sub-3-char short-circuit is invisible in telemetry, and the UI allows it. **[code, tiny]**

`diagnose-concern.ts:1628-1631` returns `nullMatch("")` for `desc.length < 3` — same shape,
`error_message: ""`, as a genuine LLM-decided empty; `submit-explanation.ts:35` allows
`min(1)` char explanations, so "ok" / "?" reach diagnosis and silently advisor-route. Set a
distinct `error_message` (`"description_too_short"`) and consider `min(3)`–`min(5)` + UI hint at
the explanation card ("a few words about what it's doing helps us help you").

### P10 — LOW (note only). Hallucinated-keys-only responses become advisor handoffs without retry.

`diagnose-concern.ts:1666-1689`: if every returned key fails catalog validation, the result is a
null match (`parsed_ok: true`, `error_message: invalid_category_key:…`). Acceptable degradation
given constrained decoding makes this rare; the Sentry log surface exists. No action needed
beyond P1's `empty_reason` making it distinguishable.

---

## 3. Best-outcome gaps (Chris's framing)

1. **Vague-but-real concerns are the only path where we ask ZERO questions** — the customer we
   most need to interrogate is the one we interrogate least (P1).
2. **Identical text can produce a fee recommendation or an advisor handoff depending on whether
   Stage 1 hedged** — the S2-low safety net has a clarify-path hole (P2).
3. **Confusable-pair hedging can't be iterated without a deploy** — the KB's 115 hedges are
   stranded (P3).
4. **The keyword signal is weakest exactly where routing is hardest** (NVH trio dilution, P4).
5. **The situational buckets the priority rules champion are the worst-described options in the
   catalog** (P5), and **the terse real-world voice is at false-empty risk** (P6).

## 4. Prioritized recommendations

| # | Action | Lever | Size |
|---|---|---|---|
| 1 | Broaden `multiple_symptoms_not_sure_what_category` (label/description/synonyms + rule-3 wording) to own vague-unsure concerns; verify/fix its first question does broad-triage | [retraining] | S |
| 2 | Add `empty_reason` enum to STAGE1 schema; route `too_vague` → triage chip card, others → advisor | [code] | M |
| 3 | Persist per-candidate S2/S3 confidences in `precomputed`; apply the confidence gate at clarify-tap resolution | [code] | S |
| 4 | DB-owned `confusable_with` surface rendered into the Stage-1 catalog; then apply the 115 KB hedge ops as data | [code enabler → retraining] | M |
| 5 | Explicit `eligible_testing_service_keys` for shared noise/vibration subcategories per the KB router tables (or exclude fanned-in subs from keyword lines) | [retraining] (alt [code]) | S-M |
| 6 | Carry 'other'-bucket enrichment through the loader; render description+synonyms in Stage-1 & the Stage-2 singleton | [code] | S |
| 7 | Reword rule 3 (content-based vagueness, drop word-count); add terse-but-clear positives; sync router doc row A#0 | [retraining] | S |
| 8 | Chip-hint-rescues-vague sentence in the chip-hint block | [retraining] | XS |
| 9 | `description_too_short` error_message + raise explanation `min()` | [code] | XS |

Sequencing note: #1 and #7-8 are prompt/DB-only and safe to ship with the KB's Phase-5 retraining
pass (re-baseline `npm run eval:diagnose` first — the golden set's 37 null_match cases will move
if #1 re-homes vague text, so re-label those cases in the same slice). #2-4 are code and should
ride the normal feature workflow.
