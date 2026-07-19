# Exhaust system & after-treatment — diagnostic dossier
slug: exhaust-emissions   date: 2026-07-18   binds_services: [exhaust_system_testing, check_engine_light_testing]   binds_categories: [noise, smell, warning_light, performance]

> **Scope note on citations** (`source-policy.md`). Two kinds of diagnostic cite appear below, kept
> distinct so the reader knows the epistemic status of each:
> 1. **Formal published references**, cited by title (standard academic practice, no URL): **SAE J2012**
>    *Diagnostic Trouble Code Definitions* (Tier 1 standard); **Halderman** *Automotive Technology* /
>    *Automotive Engine Performance* and **Bosch** *Automotive Handbook* (Tier 2 textbooks). These are
>    real published works; they are NOT presented as web-fetched.
> 2. **Web sources actually fetched this pass**, cited inline with **URL + `accessed 2026-07-18` + tier**.
>    Two were fetched and are cited where their claims appear: **Identifix** P0420 diagnosis guide (Tier 1)
>    and **Cleveland Clinic** *Carbon-Monoxide Poisoning* (Tier 2 medical authority).
>
> The federal **CDC / NHTSA** carbon-monoxide pages returned **HTTP 403** to automated fetch on 2026-07-18;
> the accessible Cleveland Clinic medical page substitutes for the CO safety facts in FM-5, so no
> safety-critical claim rests on an un-accessed source. Customer-language artifacts cite the linguistic
> corpus by **provenance only** (per-entry in `exhaust-emissions.lexicon.yaml`).

---

## 1. Scope & boundaries

**In scope** — everything from the exhaust manifold flange back to the tailpipe, plus the combustion
by-products that reach the customer's nose or the OBD-II monitor:
- Exhaust **manifold / header** and manifold gasket (the "cold tick that quiets when warm").
- **Downpipe, flex pipe, front pipe**, mid-pipe, resonator, **muffler**, tailpipe, and all **hangers /
  mounts** (louder-than-normal exhaust, deep rumble/drone, exhaust hanger clang).
- **Catalytic converter** — rattle from broken internal substrate, and the **rotten-egg / sulfur (H₂S)**
  smell of a failing / overloaded cat.
- **Exhaust breach → cabin**: fumes entering the passenger compartment (a carbon-monoxide safety event).
- The **emissions after-treatment sensors & controls whose codes surface as a Check Engine Light**: O₂ /
  air-fuel-ratio sensors, catalyst-efficiency monitors (P0420/P0430), EGR system (P040x), and secondary-air.

**Out of scope** (owned elsewhere):
- **Blue/gray tailpipe smoke = burning oil** → `smoke/blue_or_gray_smoke_from_tailpipe` +
  `check_engine_light_testing` (oil-burn dossier / router-smoke-smells). Exhaust *service* does not own it.
- **White tailpipe smoke + sweet smell = coolant** → `smoke/white_smoke_from_tailpipe` + `coolant_leak_testing`.
- **Black tailpipe smoke = rich fuel** → `smoke/black_smoke_from_tailpipe` (fuel/air-metering, router-smoke-smells).
- **Burnt-oil smell / oil drip onto exhaust** → `smell/burnt_oil_smell` + `oil_leak_testing` (see §7 — the
  #1 exhaust-vs-oil confusion).
- **Raw gasoline / fuel / EVAP smell** → `smell/gasoline_fuel_smell` (fuel-system dossier).
- **Tinny loose-metal rattle underneath** that is a heat-shield / non-exhaust part → shares
  `noise/rattling_underneath_the_car` (cat-rattle also lives there; see §7).
- **Valvetrain / top-end engine tick that does NOT quiet when warm** → `noise/engine_ticking_or_tapping`
  (engine-mechanical dossier — the confusable-pair #1 in this dossier's charter).
- **General / un-emissions CEL triage** (any dash light the customer can't tie to a symptom) →
  `router-warning-lights` owns `warning_light/check_engine_light` framing; this dossier only claims the
  emissions-after-treatment codes.

---

## 2. System primer (expert, CITED)

A modern spark-ignition exhaust system does three jobs: **collect** combustion gas at the head, **quiet**
it, and **clean** it. Gas exits each cylinder into the **exhaust manifold** (cast iron) or a tubular
**header**, sealed to the head by a manifold gasket that must survive repeated thermal cycling from ambient
to ~1,200–1,600 °F. Downstream, the **catalytic converter** houses a ceramic or metallic honeycomb washcoated
with platinum/palladium/rhodium that oxidizes CO and unburned HC to CO₂/H₂O and reduces NOₓ to N₂; a
**muffler** (and often a **resonator**) uses baffles / absorptive packing to cancel pressure pulses; the whole
train hangs from rubber **isolator hangers** [Halderman, *Automotive Technology*, exhaust-system chapter, Tier 2;
Bosch *Automotive Handbook*, exhaust after-treatment, Tier 2].

**Closed-loop emissions control.** Upstream (pre-cat) **oxygen / air-fuel-ratio sensors** feed the PCM a
rich/lean signal; the PCM trims injector pulse width to hold the mixture near stoichiometric (~14.7:1 for
gasoline) so the cat can work. A **downstream O₂ sensor** watches the gas *after* the cat — if the downstream
signal starts mirroring the upstream one, the cat has lost storage capacity and the PCM sets **P0420 (Bank 1)
/ P0430 (Bank 2), "Catalyst System Efficiency Below Threshold"** [SAE J2012 DTC definitions, Tier 1]. Crucially,
the same downstream-mirroring pattern can be produced by an exhaust leak, a misfire, a fuel problem, or a weak
sensor — so a P0420 does **not** by itself prove the cat is bad; diagnosis needs live upstream/downstream O₂
data [Identifix, *P0420 Code — The Guide to Diagnosis and Fast Fixes*,
https://www.identifix.com/blogs/p0420-code-the-guide-to-diagnosis-and-fast-fixes/, accessed 2026-07-18, Tier 1].
The **EGR** system routes a metered slug of inert exhaust back into the intake to lower peak combustion
temperature and NOₓ; sticking/clogged EGR sets P0400-series codes and can cause rough idle or a surge
[Halderman, *Automotive Engine Performance*, emissions chapter, Tier 2].

**Notable variants that change the customer's words.**
- **Cast manifold vs tubular header**: cast manifolds crack and warp (→ cold-start tick/puff); the crack
  seals as the iron expands, which is *why* the tick fades when warm (elementary cast-iron thermal expansion)
  [Halderman, *Automotive Technology*, exhaust-system chapter, Tier 2].
- **Pre-cat close-coupled converters** (bolted right to the manifold) vs under-floor cats: affects where the
  customer localizes a rattle ("under the hood" vs "underneath").
- **Dual exhaust / V-engines** have two banks → two upstream + two downstream sensors → P0420 *and* P0430 can
  differ by bank.
- **Diesel after-treatment** (DPF/DEF/SCR) is a different world; Jeff's corpus is overwhelmingly gasoline
  (US light-duty), so this dossier calibrates to gasoline and flags diesel only where a customer states it.
- **Straight-pipe / delete / aftermarket exhaust**: a customer may report "loud" that is *intentional* — a
  request-type nuance, not a fault (no corpus demand observed; see §8).

---

## 3. Failure-mode catalog (the diagnostic spine)

Each mode gives the sensory signature in **fact-slot vocabulary**, conditions, drivability, the typical
customer misattribution, and a cite.

### FM-1 — Exhaust manifold / manifold-gasket leak ("cold tick")
- **Signature:** `noise_descriptor=ticking_or_tapping` (sharp, rhythmic, follows RPM); `sound_or_smoke_location_zone=under_hood`.
- **Modifiers:** `onset_timing=cold_start`; **quiets or disappears** once warm as the cast iron
  expands and reseals; louder under acceleration.
- **Drivability:** `drivable_normally` (usually) → `drivable_but_concerned`; can leak fumes over time.
- **Misattribution:** customers call it a "lifter tick" or "valve tick" — i.e. they route it toward
  `engine_ticking_or_tapping`. The tell is the *warm-up behavior*: a manifold tick fades warm; a valvetrain
  tick does not. [Halderman *Automotive Technology*, exhaust-system chapter, Tier 2]

### FM-2 — Louder-than-normal exhaust / deep rumble / drone (muffler or pipe breach)
- **Signature:** deep throaty rumble/drone; proposed slot value `noise_descriptor=rumbling_or_droning`
  (distinct from `roaring` — see §9 slot value.add). `sound_or_smoke_location_zone=under_car` (or `from_tailpipe`).
- **Modifiers:** loudest at idle and under throttle; `started_when=sudden_onset` when a rusted section
  finally blows through, or `gradually` as rust progresses.
- **Drivability:** `drivable_normally`; a dragging/detached pipe can become `drivable_but_concerned`.
- **Misattribution:** "sounds like a Harley / muscle car"; also mis-attributed to unrelated systems — a real
  Tekmetric customer said *"my car is rumbling. I think there's something wrong with the alignment."*
  (rumble is exhaust, alignment is a guess). [Halderman *Automotive Technology*, exhaust-system chapter, Tier 2]

### FM-3 — Catalytic-converter rattle (broken substrate)
- **Signature:** `noise_descriptor=rattling` — "can of rocks / loose change"; `sound_or_smoke_location_zone=under_car`.
- **Modifiers:** triggered by engine vibration (idle, blip the throttle) and bumps; may quiet at steady cruise.
- **Drivability:** `drivable_but_concerned` — loose substrate can migrate and choke flow → low power.
- **Misattribution:** blamed on "heat shield" (often correct-adjacent) or a generic underside rattle. Currently
  routes to `noise/rattling_underneath_the_car`, whose live description already names a failing cat as a cause.
  [Halderman *Automotive Technology*, exhaust/after-treatment, Tier 2]

### FM-4 — Catalytic-converter / rich-mixture rotten-egg (H₂S) smell
- **Signature:** `smell_descriptor=rotten_egg_or_sulfur`; "rotten eggs / sewer / swamp" from the tailpipe or bay.
- **Modifiers:** worse under load / after sustained traffic and often after warm-up (`onset_timing=after_warming_up`);
  fuel sulfur content can amplify it. Trace H₂S is normal; a *failing or overloaded* cat (or a rich condition,
  or a venting/overcharging battery) makes it break through. Often paired with a CEL (P0420) if the cat is the cause.
- **Drivability:** `drivable_normally` unless a rich/misfire condition co-exists.
- **Misattribution:** customers fear a "gas leak" (raw fuel) — but rotten-egg ≠ raw gasoline; and gear-oil
  smells sulfurous too (that is a *puddle-led* report → `leak/thick_dark_brown_puddle...`). [Bosch *Automotive
  Handbook*, exhaust after-treatment / catalytic-converter chemistry (H₂S → SO₂ oxidation), Tier 2]

### FM-5 — Exhaust fumes entering the cabin (CO safety event)
- **Signature:** `smell_descriptor=exhaust_inside_cabin`; `sound_or_smoke_location_zone=inside_cabin_general`
  or `passenger_footwell`. Often paired with an audible leak (`noise_descriptor=roaring`/hissing).
- **Modifiers:** worse `hvac_mode=heat`/on **recirculate**, at idle / stoplights, and after warm-up; a real
  Tekmetric line: *"EXHAUST SMELL COMING THROUGH THE HEATER AFTER IT IS WARMED UP AND AT IDLE. HEAT NEEDS TO
  BE ON."* Root cause is an upstream breach (cracked manifold, holed pipe, bad gasket) or a worn body/hatch seal.
- **Drivability / severity:** **SAFETY-CRITICAL.** Carbon monoxide is **colorless and odorless**, so the
  *smell* the customer notices is the other exhaust constituents — an exhaust smell in the cabin means the CO
  path is open. CO exposure symptoms — **headache, dizziness, weakness, nausea, mental confusion** — can appear
  or worsen while in the car and ease in fresh air [Cleveland Clinic, *Carbon Monoxide Poisoning*,
  https://my.clevelandclinic.org/health/diseases/15663-carbon-monoxide-poisoning, accessed 2026-07-18, Tier 2].
  Treat as `drivable_but_concerned` at minimum; advise windows-open / prompt service. The always-ask
  CO-symptom question (Q278) is deliberately **not** modeled as a fact slot (§9).

### FM-6 — Catalyst-efficiency codes P0420 / P0430 (CEL, emissions)
- **Signature:** `warning_light_named='check engine'`; `warning_light_behavior=steady_on`. Often *no* driver
  symptom — the customer just has a light (a real Tekmetric line: CEL steady, "no unusual sounds, smells, or
  performance issues").
- **Cause spread:** genuinely worn cat, OR upstream/downstream O₂ sensor drift, OR an unrepaired exhaust leak
  fooling the downstream sensor, OR a prior rich/misfire event that cooked the cat. Diagnosis needs a scan +
  live O₂ data — hence `check_engine_light_testing`, not the mechanical exhaust eval. [SAE J2012 (P0420/P0430
  definitions), Tier 1; upstream/downstream mirroring + "a leak/misfire/sensor can set the same code":
  Identifix, https://www.identifix.com/blogs/p0420-code-the-guide-to-diagnosis-and-fast-fixes/,
  accessed 2026-07-18, Tier 1]
- **Drivability:** `drivable_normally`; fails an emissions/state inspection.
- **Misattribution:** "my catalytic converter is bad" stated as fact from an auto-parts code reader — a
  `second_opinion` / `fix_a_known_problem` request-type nuance.

### FM-7 — O₂ / air-fuel sensor & EGR codes (CEL, emissions performance)
- **Signature:** CEL steady/flashing; may pair with `engine_running=rough_idle`/`surging`, hesitation, or a
  rotten-egg smell. EGR sticking → rough idle / stumble; O₂ heater fault → CEL with no drivability change.
- **Drivability:** `drivable_normally` → `drivable_but_concerned` if misfiring.
- **Misattribution:** conflated with general "engine trouble"; the discriminator is whether a **named light**
  leads the complaint (→ CEL testing) vs a pure drivability feel (→ performance). [Halderman *Automotive
  Engine Performance*, O₂ & EGR emissions chapter, Tier 2; SAE J2012 P013x–P016x / P040x definitions, Tier 1]

> **Flashing vs steady CEL:** a **flashing** check-engine light = an **active misfire dumping raw fuel into
> the cat** (how cats get destroyed) → advise reduce-power / immediate service; a **steady** light = a stored
> fault (typical for a cat/O₂/EGR code). [SAE J2012, Tier 1 — this is standard OBD-II MIL convention.]

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Real-voice phrasings. **Source order:** real Tekmetric corpus first, then real forum (paraphrased), then
synthetic (which now INCLUDES authored eval-cases.json content — see the provenance rule below). Synthetic
is flagged; per-subcat share is reported in §11. Full machine list in `exhaust-emissions.lexicon.yaml`.

> **Provenance rule (this table matches the lexicon exactly).** The provenance enum has no `eval` value.
> Authored eval-cases.json lines are hand-written eval gold, not real customer utterances, so they are
> labelled `synthetic (authored eval)`. Only real-customer Tekmetric lines are `tekmetric`; real forum
> lines paraphrased to first person are `forum-paraphrase`.

| Phrase (as customers write it) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "SEEMS LOUDER THAN NORMAL … CLIENT THINKS EXHAUST ISSUE" | exhaust_louder_or_rumbling | unambiguous | tekmetric |
| "the muffler that is loose" | exhaust_louder_or_rumbling | unambiguous | tekmetric |
| "my car is rumbling. I think there's something wrong with the alignment" | exhaust_louder_or_rumbling | needs-fact:noise_descriptor | tekmetric |
| "THE CLIENT HEARS AN EXHAUST LEAK … FROM ONE OF THE FLANGES" | exhaust_louder_or_rumbling / exhaust_manifold_tick_or_puff | needs-fact:onset_timing | tekmetric |
| "sounds like a motorcycle now … muffler rusted out" | exhaust_louder_or_rumbling | unambiguous | synthetic (authored eval; flagged) |
| "making a ticking noise when driving" | exhaust_manifold_tick_or_puff / engine_ticking_or_tapping | needs-fact:onset_timing | tekmetric |
| "exhaust manifold leak, it ticks at startup" | exhaust_manifold_tick_or_puff | unambiguous | forum-paraphrase |
| "fast ticking … first start it cold … goes away after it warms up" | exhaust_manifold_tick_or_puff | unambiguous | synthetic (authored eval; flagged) |
| "smells like rotten eggs from the exhaust" | rotten_egg_sulfur_smell | unambiguous | forum-paraphrase |
| "rotten egg smell coming from the catalytic converter" | rotten_egg_sulfur_smell | unambiguous | forum-paraphrase (real forum) |
| "sulfur smell … under acceleration" | rotten_egg_sulfur_smell | unambiguous | synthetic (flagged) |
| "engine sputters … CEL … rotten egg smell" (rough-run LEAD) | check_engine_light → check_engine_light_testing | cross-system:router-warning-lights | synthetic (authored eval; flagged) |
| "EXHAUST SMELL COMING THROUGH THE HEATER … AT IDLE. HEAT NEEDS TO BE ON" | exhaust_fumes_inside_the_cabin | unambiguous | tekmetric |
| "check engine light on … no unusual sounds … steady" | check_engine_light → check_engine_light_testing | cross-system:router-warning-lights | tekmetric |
| "State Inspection and Emissions … just need the inspection" | NULL / advisor | cross-system:router-requests-maintenance | tekmetric |
| "MAKE SURE NO EXHAUST LEAKS" | NULL / advisor (inspection ask) | cross-system:router-requests-maintenance | tekmetric |

**Messiness observed & preserved:** ALL-CAPS Tekmetric style ("SEEMS LOUDER THAN NORMAL"); part-name misuse
("muffler" for any exhaust section, "manifold" for any leak); slang ("sounds like a Harley/motorcycle");
misattribution ("rumbling … I think it's the alignment"); and pure work-order lines ("MAKE SURE NO EXHAUST
LEAKS", "State Inspection and Emissions") that are **inspection asks, not symptoms** → null-route to advisor.

---

## 5. Differential & discriminating questions (binds required_facts + slots)

For each confusable pair: the ONE best discriminating question, the **fact slot + value** that answers it, and
whether a current slot can hold it.

| Pair | Best discriminating question | Answering slot = value | Slot exists? |
|---|---|---|---|
| **Manifold tick (FM-1) vs valvetrain tick** (`engine_ticking_or_tapping`) | "Does the tick **go away once the engine warms up**, or is it there all the time?" | `onset_timing=cold_start` (starts cold) ⇒ manifold cue; the *fades-warm* resolution is the discriminator | PARTIAL — `onset_timing=cold_start` says WHEN it starts, not THAT it clears warm; the fades-warm concept is the deferred `warm_up_behavior` slot (§9) |
| **Louder/rumble (FM-2) vs cat rattle (FM-3)** (`rattling_underneath_the_car`) | "Is it a **deep steady rumble/drone**, or a **tinny rattle like a can of rocks**?" | `noise_descriptor=rumbling_or_droning`(rumble) vs `rattling` | PARTIAL — `rumbling_or_droning` is a proposed value.add (§9); `roaring` is the nearest live value |
| **Rumble (FM-2) vs tire/bearing roar** (`suspension_steering_check`) | "Does it change **with engine RPM (rev in park)** or **only with road speed**?" | rev-linked ⇒ exhaust; speed-linked ⇒ bearing (`speed_band=highway`) | PARTIAL — no "rises with RPM in park" slot |
| **Rotten-egg smell (FM-4) vs raw-gas smell** (`gasoline_fuel_smell`) | "Is it a **rotten-egg / sulfur** smell or a **fresh gasoline / pump** smell?" | `smell_descriptor=rotten_egg_or_sulfur` vs `gasoline_or_fuel` | YES |
| **Exhaust-in-cabin (FM-5) vs rotten-egg (FM-4)** | "Is the smell **inside the cabin while you drive**, or mostly **outside/at the tailpipe**?" | `sound_or_smoke_location_zone=inside_cabin_general`/`passenger_footwell` vs `from_tailpipe` | YES |
| **Exhaust smell (FM-4/5) vs burnt-oil smell** (`burnt_oil_smell`/`oil_leak_testing`) | "**Rotten-egg/smoky exhaust** smell, or a **greasy hot-oil** smell from under the hood?" | `smell_descriptor=rotten_egg_or_sulfur`/`exhaust_inside_cabin` vs `burnt_oil` | YES |
| **Cat code (FM-6) vs mechanical exhaust (FM-1/2/3)** | "Is your main concern a **dash light**, or a **sound/smell** you hear/notice?" | `warning_light_named` present ⇒ CEL testing; noise/smell lead ⇒ exhaust eval | YES (warning_light_named) |
| **Exhaust-in-cabin worse on heat (FM-5)** | "Is it worse when the **heater/fan is on**, especially recirculate?" | `hvac_mode=heat` | YES (already tagged on Q276) |

The `noise_descriptor` "rumble/drone" gap and the "fades when warm" / "rises with RPM in park" concepts are
the raw material for §9. All other discriminators are expressible today.

---

## 6. Warning lights & DTC surface

- **Check Engine Light (MIL)** — amber engine-block outline. This system's codes that light it: **P0420/P0430**
  (catalyst efficiency), **P0130–P0167** (O₂/AFR sensor circuit/response), **P0171/P0174** (system-too-lean,
  common cat-overheat precursor), **P0401/P0402/P0404/P0405** (EGR flow/position). Customer names:
  "check engine light", "CEL", "engine light", "the little engine picture". `warning_light_named='check engine'`.
  [SAE J2012, Tier 1]
- **Solid vs flashing:** `warning_light_behavior=steady_on` = stored fault (typical for a cat/O2/EGR code);
  `flashing_or_blinking` = **active misfire dumping raw fuel into the cat** — this is how cats get destroyed;
  advise reduce-power / immediate service [SAE J2012, Tier 1 — standard OBD-II MIL convention].
- **No dedicated "emissions" light** on US light-duty gasoline (unlike an "SES/MAINT REQD" reminder, which is
  scheduled maintenance and NOT this system — see `warning_light/check_engine_light` vs
  `service_engine_soon_or_maintenance_required_light`). Feeds `warning_light_named` / `warning_light_behavior`.
  Master light nicknames are owned by `router-warning-lights`; this dossier only asserts the emissions codes.

---

## 7. Confusable neighbors (cross-system)

1. **Valvetrain tick** (`noise/engine_ticking_or_tapping`, engine-mechanical) — **THE** exhaust-manifold-tick
   confusion. Discriminator: manifold tick is `onset_timing=cold_start` and **fades when warm**; valvetrain
   tick persists warm and often pairs with oil-pressure worry. (Charter confusable pair #1.)
2. **Oil leak / burnt-oil smell** (`smell/burnt_oil_smell`, `oil_leak_testing`) — oil dripping onto a hot
   manifold *smells* like it's coming from the exhaust and even smokes off it. Discriminator:
   `smell_descriptor=burnt_oil` + a visible dark drip ⇒ oil; `rotten_egg_or_sulfur`/`exhaust_inside_cabin`
   ⇒ exhaust. (Charter pair — exhaust vs oil leak.)
3. **Blue/gray tailpipe smoke** (`smoke/blue_or_gray_smoke_from_tailpipe` → `check_engine_light_testing`) —
   oil burn, not an exhaust-service item. Discriminator: `smoke_color=blue_or_gray` + `burnt_oil` smell.
4. **Underside rattle / heat shield** (`noise/rattling_underneath_the_car`) — cat rattle already *lives* here;
   keep it there. Discriminator between a *cat* rattle and a *hanger/deep-rumble* is `rattling` vs a deep
   rumble note (FM-2/§9 gap).
5. **Tire / wheel-bearing roar** (`suspension_steering_check`, `noise/humming_or_whirring_at_speed`) — a "roar"
   that rises with **road speed** (not RPM) is a bearing, not exhaust. Discriminator: RPM-linked vs speed-linked.
6. **Raw fuel / EVAP smell** (`smell/gasoline_fuel_smell`) — fresh/sharp vs smoky/sulfur. (Charter pair — rotten
   egg cat smell vs fuel.)
7. **HVAC musty smell** (`smell/musty_mildew_smell_from_vents`) — "smell from vents" that is mold, not exhaust;
   discriminator `smell_descriptor=musty_or_mildew` vs `exhaust_inside_cabin`.

Cross-reference neighbor dossiers: `engine-mechanical` (FM-1 tick), `oil-leaks`/router-smoke-smells (FM smoke &
burnt-oil), `fuel-system` (gasoline smell), `router-nvh` (rumble/rattle/roar descriptor table),
`router-warning-lights` (CEL master list).

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| FM-1 manifold tick | exhaust_system_testing | noise | `exhaust_manifold_tick_or_puff` | **good** (but 0 questions — see gap) |
| FM-2 louder / rumble | exhaust_system_testing | noise | `exhaust_louder_or_rumbling` | **good** (but 0 questions; no rumble slot value) |
| FM-3 cat rattle | exhaust_system_testing | noise | `rattling_underneath_the_car` | **good** (shared; cat named in desc) |
| FM-4 rotten-egg / sulfur | exhaust_system_testing | smell | `rotten_egg_sulfur_smell` | **good** |
| FM-5 fumes in cabin | exhaust_system_testing | smell | `exhaust_fumes_inside_the_cabin` | **good** (safety; over-asking on 6/7 Qs) |
| FM-6 P0420/P0430 cat code | check_engine_light_testing | warning_light | `check_engine_light` | **good** (router-warning-lights owns framing) |
| FM-7 O₂ / EGR code | check_engine_light_testing | warning_light / performance | `check_engine_light` (+ perf slugs if drivability leads) | **good** |
| **State safety / emissions INSPECTION request** | — | — | — | **NO FIT** → null-route today; catalog proposal below |

**NO-FIT demand evidence:** the Tekmetric corpus contains explicit state-inspection/emissions requests
("State Inspection and Emissions Already have a current emissions sticker…. Just need the inspection.",
"MAKE SURE NO EXHAUST LEAKS") that are **not** the $39.99 diagnostic exhaust eval and not a symptom concern.
Today they must null-route to an advisor. Logged as `catalog.service.propose` (Chris-gated) in proposals.yaml.

> **Dropped this revision:** the earlier "aftermarket make-it-loud/quiet/delete request → NO FIT" row. The
> corpus contains **no** such request, so there is no demand evidence and no terminating op — per
> dossier-template §8 a NO-FIT must carry demand evidence to become a proposal. Straight-pipe/delete "loud on
> purpose" remains a §2 variant note only, not a catalog proposal.

---

## 9. Fact-slot audit

**Slots this system uses today:** `noise_descriptor`, `smell_descriptor`, `sound_or_smoke_location_zone`,
`onset_timing`, `hvac_mode`, `warning_light_named`, `warning_light_behavior`, `engine_running`, `speed_band`,
`recent_action`, `started_when`, `drivable_state`, `customer_request_type`.

**Values customers actually state (corpus-grounded):**
- `smell_descriptor=rotten_egg_or_sulfur` ("rotten eggs", "sulfur", "sewer/swamp") — present, good.
- `smell_descriptor=exhaust_inside_cabin` ("exhaust smell through the heater", "fumes inside") — present, good.
- `noise_descriptor=ticking_or_tapping` (manifold tick) — present.
- `noise_descriptor=rattling` (cat rattle) — present.
- `noise_descriptor=roaring`/rumble ("deep rumble", "drone", "louder", "like a Harley") — **partial**: `roaring`
  is the nearest live value but customers overwhelmingly say **rumble/drone**, a distinct percept.
- `onset_timing=cold_start` (tick at cold start) / `after_warming_up` (fumes/sulfur worse warm) — present.
- `hvac_mode=heat` (fumes worse on heater) — present.

**Missing values / concepts:**
1. `noise_descriptor` lacks a **`rumbling_or_droning`** value (deep exhaust drone) distinct from `roaring`.
   Proposed as a **slot.value.add** (value add, not a new slot). NOTE the live `roaring` description already
   reads "exhaust leak / wheel bearing at speed" — so `roaring` TODAY conflates the exhaust deep-rumble with
   the bearing roar; the new value disambiguates them (see the value.add rationale in proposals.yaml).
2. **"Symptom present cold, then RESOLVES once warm"** — the single most valuable exhaust-vs-valvetrain
   discriminator. `onset_timing=cold_start` says *when it starts*, not *that it clears warm*, so this compound
   is genuinely inexpressible today.
3. **"Noise rises with engine RPM when revved in park"** vs road-speed-linked — separates exhaust from wheel
   bearings; no slot holds it.
4. **CO-exposure human symptoms** ("lightheaded / headaches while driving") — no slot; intentionally kept as an
   always-ask safety question (Q278), not modeled.

**Proposed slot — DEFERRED (does NOT yet meet the ≥3-question rule):** `warm_up_behavior`, **narrowed** to the
two values existing slots cannot express: `worse_cold_fades_warm` (present cold, resolves warm) and
`no_change_with_temperature`. (The originally-drafted `only_when_cold` and `worse_when_warm` were **dropped** —
they duplicate `onset_timing=cold_start` and `onset_timing=after_warming_up`.) As bound it serves exactly **one**
existing question: **Q76** on `engine_ticking_or_tapping` ("Does the ticking get quieter or go away once the
engine warms up?"), which is currently mis-tagged `required_facts=[onset_timing]` and cannot hold fades-warm.
It does **not** reach ≥3 today because Q252 on `rotten_egg_sulfur_smell` is already satisfied by `onset_timing`
(`at_startup`/`after_warming_up`), and the two exhaust *noise* subcats that would use it
(`exhaust_manifold_tick_or_puff`, `exhaust_louder_or_rumbling`) have **zero** questions in the live DB. It is
therefore filed as a **deferred candidate** (`stage3.slot.propose`, `status: deferred`) — it reaches ≥3 only
once questions are authored on those two zero-question noise subcats. Full spec + deferral note in proposals.yaml.

**Over-asking finding (L5):** `exhaust_fumes_inside_the_cabin` has 7 questions, **only 1** (Q276, `hvac_mode`)
carries `required_facts`; the other 6 are empty. Several are safely tag-able (Q275→`speed_band`,
Q277→`noise_descriptor`, Q279→`recent_action`), two are genuinely un-modelable safety/seal questions (Q278 CO
symptoms, Q280 body-seal) → mark `question.intentionally_empty`. Same pattern on `rotten_egg_sulfur_smell` Q247/
Q250/Q251. Both exhaust *noise* subcats have **zero** questions at all — flagged as a catalog gap (no
`question.required_facts.set` possible until questions exist; noted for Chris — and it is exactly this gap that
keeps `warm_up_behavior` under the ≥3 threshold).

---

## 10. Sources

**A. Formal published references (cited by title; real published works, NOT web-fetched):**
- **SAE J2012** — *Diagnostic Trouble Code Definitions* (P0420/P0430 catalyst efficiency; P013x–P016x O₂;
  P040x EGR; MIL solid-vs-flash convention). Tier 1 standard.
- **Halderman**, *Automotive Technology* (exhaust system, manifold, catalytic converter) & *Automotive Engine
  Performance* (O₂, EGR, catalyst monitors). Tier 2 textbooks.
- **Bosch**, *Automotive Handbook* — exhaust after-treatment & catalytic-converter chemistry (H₂S → SO₂). Tier 2.

**B. Web sources actually fetched this pass (URL + access date + tier):**
- **Identifix**, *P0420 Code — The Guide to Diagnosis and Fast Fixes* —
  https://www.identifix.com/blogs/p0420-code-the-guide-to-diagnosis-and-fast-fixes/ — accessed 2026-07-18,
  Tier 1. (P0420 = upstream/downstream O₂-sensor mirroring; a leak / misfire / weak sensor can set the same
  code, so P0420 ≠ automatic cat replacement.)
- **Cleveland Clinic**, *Carbon Monoxide Poisoning* —
  https://my.clevelandclinic.org/health/diseases/15663-carbon-monoxide-poisoning — accessed 2026-07-18,
  Tier 2 (medical authority). (CO is colorless/odorless; symptoms headache, nausea, dizziness/weakness,
  mental confusion.) Substitutes for the CDC/NHTSA CO pages, which returned HTTP 403 on 2026-07-18.

**Removed this revision:** the earlier NGK/NTK, Denso, and Walker/AP-Emissions/Tenneco "technical training"
citations. They were named manufacturer references with no evidence of actual access (a training-data-recall
pattern `never-guess.md` forbids); their diagnostic claims are now carried by the accessible Identifix source
and the formal Halderman/Bosch/SAE references above.

**Linguistic (provenance only, never cited for diagnosis):** real Tekmetric corpus
(`real-concerns-tekmetric-labeled-v2.json`), real forums (`real-concerns-forums.json`, paraphrased), and
authored eval cases (`eval-cases.json`, labelled **synthetic**-class). Per-entry provenance in
`exhaust-emissions.lexicon.yaml`.

---

## 11. Binding-readiness self-check (Gate-G2)

| Check | Status |
|---|---|
| Binds only to slugs/services that exist in the snapshot | ✅ (all 4 subcats + 2 services verified live) |
| Every diagnostic/differential claim cited | ✅ — formal refs by title (SAE/Halderman/Bosch) + 2 real fetched web cites (Identifix, Cleveland Clinic) with access dates; no un-accessed "training" refs remain |
| Safety-critical CO claim rests on an accessed source | ✅ (Cleveland Clinic, fetched 2026-07-18; CDC/NHTSA 403 disclosed & substituted) |
| Customer artifacts in customer voice; synthetic flagged | ✅ — **5** synthetic entries flagged; per-subcat synthetic share: louder **20%**, manifold-tick **33%** (n=3), rotten-egg **33%** (n=3, down from 67%), cabin-fumes **0%** (only ONE real cabin-fumes line exists in the corpus). Authored eval-cases are labelled synthetic-class (no `eval` provenance value). |
| §4 table provenance matches the lexicon exactly | ✅ (rebuilt to agree; headaches/lightheaded rows removed) |
| No fabricated-provenance examples | ✅ — the "making a ticking noise, worse when cold, goes away warm" example was fabricated tekmetric; the cold/warm clauses are now labelled synthetic (authored eval); the bare real line is used only as the inference-trap golden case |
| Every negative_example names `routes_to` | ✅ (see proposals.yaml) |
| Keyword `evidence` is linguistic, not diagnostic | ✅ — "oxygen sensor" now cites the corpus (was NGK/NTK); "EGR" removed (zero corpus usage); "cat rattle" removed (mechanic shorthand); P0420 tagged domain-token |
| No over-broad synonyms (≥2 tokens or domain token) | ✅ ("loud exhaust", "oxygen sensor", "P0420") |
| Literalness respected for fact cues | ✅ — golden case 2 no longer asserts `under_hood`; bare "ticking" sets no `onset_timing`; rumble≠location |
| Confusable pairs in charter addressed (§5/§7) | ✅ (manifold-vs-valvetrain, exhaust-vs-oil, rotten-egg-vs-fuel) |
| Slot proposal meets ≥3-question rule | ⚠️ **DEFERRED** — `warm_up_behavior` serves 1 existing question (Q76) today; narrowed to the 2 inexpressible values; reaches ≥3 only after the two zero-question exhaust-noise subcats get questions. Filed as deferred, NOT asserted as ≥3 |
| Golden cases use only live 29-slot facts (proposed slots/values gated) | ✅ — `warm_up_behavior` removed from all cases; `rumbling_or_droning` (value.add) carries a `depends_on_proposed` marker on the 2 cases that use it |
| ≥8 golden cases incl ≥1 inference-trap + ≥1 null-route | ✅ (10 cases; 2 traps, 1 null-route; null-route leaves stage3 empty — no `routine_maintenance` stretch) |
| Catalog NO-FIT carries demand evidence, Chris-gated | ✅ (state inspection/emissions request; aftermarket-delete row dropped for lack of demand evidence) |
