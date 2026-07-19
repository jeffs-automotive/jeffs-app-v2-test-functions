# Fluid-leak router — cross-system disambiguation dossier
slug: router-leaks   date: 2026-07-18   wave: B
owns_confusable_pairs: [oil↔coolant puddle, engine-oil↔gear/diff-oil, red-ATF/PS↔pink-coolant, brake-fluid↔trans/PS(red), brake-fluid↔AC-condensation(clear), engine-oil↔brake-fluid(amber, SAFETY), blue-washer↔blue-coolant, oil-drip↔exhaust(cross-ref router-smoke-smells)]
consumes_dossiers: [engine-lubrication-oil, cooling-system, automatic-transmission, steering-power-steering, brakes-friction-hydraulic, hvac-climate, driveline-cv-diff-awd]
signature_deliverable: binding/leak-decision-table.md

> **What this router owns.** A puddle is the one symptom where SEVEN different physical systems land in
> ONE Stage-2 category (`leak/`, 7 subcategory slugs) and a single wrong color read misroutes the whole
> ticket. Per-system dossiers each describe their own fluid; none can own the *cross-fluid* decision.
> This router is the authoritative reference for "which fluid, therefore which system," keyed on the
> three facts a customer can literally state about a puddle: **`fluid_color` + `fluid_under_car_location`
> + `smell_descriptor`**. Its machine form is [`binding/leak-decision-table.md`](../binding/leak-decision-table.md).

---

## 1. Scope & boundaries

**In scope:** any customer utterance whose lead symptom is a **puddle / drip / "leaking fluid"** under
the vehicle, and the disambiguation of WHICH fluid → which `leak/*` subcategory → which system/service.
The seven fluids and their bound subcategories/systems (all slugs verified against
`00-current-scheduler-taxonomy.md` §4; enum values against `extracted-facts.ts`):

| Fluid | `leak/*` subcategory slug | System dossier · service |
|---|---|---|
| Engine oil | `brown_or_black_puddle_engine_oil` | engine-lubrication-oil · `oil_leak_testing` |
| Coolant | `green_orange_yellow_or_pink_puddle_coolant` | cooling-system · `coolant_leak_testing`[`_euro`] |
| Transmission / power-steering | `red_or_pink_puddle_transmission_or_power_steering` | automatic-transmission · `transmission_testing` / steering-power-steering · `power_steering_eps_testing` |
| Brake fluid ⚠ | `clear_yellow_or_light_brown_puddle_brake_fluid` | brakes-friction-hydraulic · `brake_inspection` |
| Water / A/C condensation | `clear_odorless_puddle_water_or_ac_condensation` | hvac-climate · `ac_leak_testing` / `ac_performance_check` |
| Gear / differential oil | `thick_dark_brown_puddle_gear_or_differential_oil` | driveline-cv-diff-awd · `oil_leak_testing` |
| Washer fluid | `blue_or_light_blue_puddle_washer_fluid` | body/washer (no diagnostic service) |

**OUT of scope (routes elsewhere — named so nothing dead-ends):**
- **Smoke / smell WITHOUT a ground puddle** (oil sizzling on the manifold → burnt-oil smell + under-hood
  smoke; coolant → sweet smell / white tailpipe smoke; exhaust breach) → **`router-smoke-smells`**. The
  oil-drip↔exhaust confusion listed in this router's owned pairs is a *smoke/smell* case that we
  cross-reference but the smoke/smell router makes the final call (§5, pair P7).
- **A leak causally tied to recent work** ("had the diff serviced elsewhere and now it leaks everywhere",
  tka-034; "after service leak ck") → Stage-1 **situational override** `after_recent_service_or_repair_work`
  → advisor. This override fires BEFORE the color table.
- **Consumable-level/top-off requests with no visible puddle** ("having to top off coolant a few times")
  → the owning system's `warning_light`/level path, not a leak subcategory, unless a puddle is named.
- **Refrigerant leak felt as weak/warm A/C** (no puddle) → `hvac` (`ac_leak_testing` via warm-air
  subcats), owned by hvac-climate — refrigerant leaves no liquid puddle.

---

## 4. Customer-language cues (the color words the classifier sees)

Real-voice color/description strings mined from the Tekmetric corpus + forum-paraphrase (provenance in
`router-leaks.proposals.yaml`). These are the lexical hooks that set `fluid_color`; each is paired with
the location/smell that CONFIRMS the fluid, because color alone is not decisive (§5).

- **Engine oil** — "dark brown", "black oily stain", "brown slick spot", "oil under the motor", "black
  spots on the driveway", misspellings "oyl"/"oil leek". Corpus: "oil leaking. severe potential drain
  plug?", "Find and fix oil leak", "OIL LEAK FOUND NEAR THE REAR MAIN SEAL", "CHECK FLUID LEAK (Believes
  may be oil)".
- **Coolant** — "bright green", "green stuff", "antifreeze", "orange", "neon", "pink coolant", "sweet
  smell". Corpus: "LARGE PUDDLE OF ANTIFREEZE", "CLIENT SEES LEAK AT LOWER LINE ON RADIATOR", "leaking
  coolant pressure test auth", "VEHICLE LEAKING COOLANT FROM THE PASSENGER SIDE".
- **Transmission / PS** — "bright red", "red oily", "reddish", "pink fluid". Corpus: "TRANSMISSION COOLER
  LINE LEAKING", "POWER STEERING PUMP BADLY LEAKING FLUID" (note: tka-118 full text is a
  `car_has_been_sitting…` situational override — cited for phrasing only).
- **Brake fluid ⚠** — "amber", "brownish-yellow", "light brown", "looks yellow when it dries". Corpus:
  "ATTEMPTED TO ADD BRAKE FLUID AND LEAKS RIGHT OUT", "leak appears to be near lines close to brake
  fluid", "cust stated may be oil of brake fluid … leak … near lines close to brake fluid", "TOW IN NO
  BRAKES FOUND BRAKE FLUID EMPTY".
- **Water / A/C** — "clear water", "just water", "wet spot after the AC runs", "looks like plain water".
- **Gear / diff oil** — "thick dark oil", "gooey black", "gear oil", "rotten eggs", "sticky dark stuff by
  the axle". Corpus: "rear axle seal leak", "REAR DIFFERENTIAL LEAK INSPECT AND ADVISE".
- **Washer** — "blue", "bright blue", "windshield fluid". Corpus: "WASHER FLUID LEAKING. TESTING AUTH".
- **Vague (very common → `needs-fact:fluid_color`)** — "under vehicle leak", "I have a leak under the
  front of the vehicle. I am not sure what the cause of the leak is", "CLIENTS FATHER NOTICED LARGE FLUID
  LEAK IN DRIVEWAY … EVIDENCE IS WASHED AWAY", "CHECK FLUIDS & tire pressures". These are NOT force-picked
  to oil; the wizard asks color/location/smell first.
- **Multi-fluid (route to the system the customer's OTHER symptom names, or advisor)** — "POSSIBLE OIL AND
  COOLANT LEAKS. PUDDLE UNDER BOTH TURBOS, OIL COOLER … COOLANT IS LOW AS WELL AS OIL"; "Coolant leak,
  window motor stuck, oil change and many more" (→ `multiple_symptoms_not_sure_what_category`).

Messiness preserved: ALL-CAPS Tekmetric work-order voice, "of" for "or" ("oil of brake fluid"), color
omitted entirely, and mixed symptom+request ("Find and fix oil leak", "TESTING AUTH 89").

---

## 5. Differential & discriminating questions (the confusable matrix, prose form)

Every row: the ONE best discriminating question + the fact slot(s)/value that resolves it. Machine form
(with `examples_a`/`examples_b`) is `confusable_matrix_rows:` in `router-leaks.proposals.yaml`.

| Pair | Discriminating question | Slot → value that decides |
|---|---|---|
| **P1 · oil ↔ coolant** | "Is the puddle dark brown/black and greasy, or bright green/orange/pink and does it smell sweet?" | `fluid_color` brown_or_black (oil) vs green_or_orange_or_yellow_or_pink (coolant); `smell_descriptor` burnt_oil vs sweet_or_maple_syrup |
| **P2 · engine-oil ↔ gear/diff-oil** | "Is the dark oil under the ENGINE up front, or under the REAR axle and does it smell like rotten eggs?" | `fluid_under_car_location` under_engine_front vs under_rear; `smell_descriptor` (rotten_egg_or_sulfur → gear); `fluid_color` brown_or_black vs thick_dark_brown |
| **P3 · red ATF/PS ↔ pink coolant** | "Is it thin/oily and slick, or watery and bright-neon smelling sweet like syrup?" | `fluid_color` red_or_pink (oily) vs green_or_orange_or_yellow_or_pink (watery); `smell_descriptor` sweet → coolant |
| **P4 · brake-fluid ↔ trans/PS (red)** | "Is the drip near a WHEEL and has the pedal gone soft, or is it bright red toward the middle/front?" | `fluid_color` clear_yellow_or_light_brown + `fluid_under_car_location` under_a_wheel + `pedal_feel` soft → brake; red_or_pink + under_middle → trans/PS |
| **P5 · brake-fluid ↔ A/C-condensation (both "clear")** ⚠ | "Is it slick/oily near a wheel with any pedal change, or thin plain water under the passenger side after the A/C ran?" | `fluid_color` clear_yellow_or_light_brown + under_a_wheel + `pedal_feel` → brake (SAFETY); clear_no_color + under_passenger_side + odorless → AC condensation |
| **P6 · engine-oil ↔ brake-fluid (amber collision)** ⚠ SAFETY | "Is the amber drip up front by the engine, or near a wheel with the pedal gone low/soft?" | amber ALONE = `needs-fact`; under_engine_front + no pedal change → oil; under_a_wheel + `pedal_feel` soft/sinking → brake fluid |
| **P7 · oil drip ↔ exhaust (cross-ref router-smoke-smells)** | "Is there liquid oil on the ground / oil residue, or is the exhaust louder with a ticking and no puddle?" | `fluid_color`/oil residue → oil; `noise_descriptor` ticking_or_tapping + louder exhaust + no fluid → exhaust_system_testing (smoke/smell router decides) |
| **P8 · blue washer ↔ blue coolant** | "Does the blue fluid smell soapy/odorless like washer, or sweet/slimy like antifreeze?" | resolve on `smell_descriptor` (sweet → coolant); `fluid_color` has NO coolant-blue value, so color can't settle it |
| **P9 · trans ↔ PS (within red slug)** | "Is the red puddle toward the middle/back, or up front with heavy/whining steering?" | `fluid_under_car_location` under_middle/under_rear → transmission; under_engine_front + `steering_feel=heavy_or_hard_to_turn` → power steering |
| **P10 · water/AC ↔ coolant** | "Is it clear plain water with no smell, or bright colored and sweet-smelling?" | `fluid_color` clear_no_color + odorless → AC condensation (usually normal); green_or_orange_or_yellow_or_pink + sweet → coolant |

**Literalness (safety-critical here).** The two ⚠ pairs (P5, P6) hinge on brake fluid, whose miss is a
`not_drivable_needs_tow`. A bare "amber" or bare "clear" NEVER confidently sets `fluid_color`; it stays
`needs-fact:fluid_under_car_location`+`pedal_feel`. This is enforced by inference-trap golden cases.

**Situational override precedence.** Any leak "right after service/an accident" is `after_recent_service_
or_repair_work` / `after_recent_accident_or_impact` at Stage-1 BEFORE this matrix runs.

---

## 10. Sources

**Diagnostic authority** — this router does not re-derive failure-mode claims; it consumes the CITED
differentials in the seven Wave-A dossiers it reads (each carries Tier-1/2 cites): engine-lubrication-oil
(§5/§7 oil↔coolant↔trans↔brake-fluid amber collision), cooling-system (§5/§7 pairs #3/#4 pink/blue),
automatic-transmission (§5 D4/D5 ATF↔PS↔coolant↔diff), steering-power-steering (§5/§7 #6 pink PS↔coolant),
brakes-friction-hydraulic (§5 brake-fluid↔AC-condensation, FM-6 glycol-ether composition), hvac-climate
(§3.9 clear odorless condensation), driveline-cv-diff-awd (§3.7/§5 gear-oil rotten-egg). Enum values from
`scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts` (`fluid_color`, `fluid_under_car_location`,
`smell_descriptor`), verified 2026-07-18.

**Linguistic authority** — `scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json` (leak
lines quoted verbatim in §4: antifreeze puddle, radiator lower-line, rear-main oil, rear axle seal, brake
fluid empty, washer fluid leaking, "not sure what the cause" vague leak) + `eval-cases.json` +
`real-concerns-forums.json` (paraphrased). Provenance tags in `router-leaks.proposals.yaml`.

---

## 11. Binding-readiness self-check

- [x] Signature deliverable emitted: `binding/leak-decision-table.md`, one row per fluid, keyed on
      `fluid_color` + `fluid_under_car_location` + `smell_descriptor` → `leak/*` subcategory + system.
- [x] Every owned confusable pair has a discriminating question + fact slot (§5, P1–P10) and a
      `confusable_matrix_rows` entry with `examples_a`/`examples_b` (proposals.yaml).
- [x] Every `stage2.example.negative.add` names a `routes_to` that is a real `leak/*` sibling slug.
- [x] Every `stage1.hedge.add` names two real testing-service keys + a `discriminating_fact` in enum vocab.
- [x] SAFETY: the amber (P6) and clear (P5) brake-fluid collisions are explicit `needs-fact` unless
      location+pedal confirm; no bare color sets `fluid_color`; guarded by inference-trap golden cases.
- [x] Bound ONLY to existing slugs/services/slots; no new subcategory or slot invented (the washer-fluid
      no-service gap is noted, not fabricated). Blue-coolant `fluid_color` gap resolved on smell (P8),
      consistent with cooling-system §7.4 (no coolant-blue value proposed).
- [x] Situational override precedence stated; vague-leak `needs-fact` fallback stated; cross-ref to
      `router-smoke-smells` for the no-puddle oil↔exhaust case (P7).
