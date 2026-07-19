# Air intake & forced induction (turbo / supercharger) — diagnostic dossier
slug: air-induction-forced-induction   date: 2026-07-18   binds_services: [check_engine_light_testing]   binds_categories: [noise, performance, warning_light, smoke, leak]

> **Catalog-gap system.** Forced induction and the intake-air path have **no dedicated testing service
> or subcategory** in the live catalog. Real customer symptoms (turbo whistle, boost loss, limp mode,
> a dirty MAF hesitation, a clogged air filter) currently scatter across `low_power_or_wont_accelerate_normally`,
> `hesitation_or_lag_when_accelerating`, `high_pitched_whining_under_the_hood`, `check_engine_light`, and
> the situational `after_recent_service_or_repair_work` bucket. This dossier sharpens those bindings and
> proposes the missing surface (§8) rather than inventing new top-level taxonomy.

---

## 1. Scope & boundaries

**In scope** — everything on the fresh-air / charge-air path from the atmosphere to the intake valves,
plus the sensors and controls that meter it:

- Air filter / airbox / intake ducting (the "cold side").
- Mass Air Flow (MAF) sensor and Manifold Absolute Pressure (MAP) / boost-pressure sensor.
- Throttle body (as an *air-metering* element; the electronic-throttle **fault** surface is shared with CEL).
- Turbocharger (compressor + turbine + center bearing), wastegate + actuator (vacuum, pressure, or
  electronic), boost-control solenoid.
- Supercharger (roots / twin-screw / centrifugal) + its drive belt/coupler.
- Charge-air cooler (intercooler) and all charge pipes/couplers/clamps between compressor and throttle.
- PCV / crankcase-ventilation path **where it presents as an intake/vacuum leak** (whistle, lean, rough idle).

**Out of scope** (owned by a neighbor dossier):

- Exhaust downstream of the turbine (leaks, louder exhaust, cat rattle) → `exhaust-emissions` (`exhaust_system_testing`).
- Turbo **oil leak** puddle diagnosis → shares with `engine-lubrication-oil` (`oil_leak_testing`); a turbo that
  drips oil at the housing is still logged here for the *smoke/consumption* signature but the **puddle**
  routes by fluid color (`brown_or_black`).
- **Blue/gray tailpipe smoke** (oil past turbo seals) → the smoke color decision belongs to
  `router-smoke-smells`; catalog owner is `check_engine_light_testing` per taxonomy §3a.
- Coolant loss / white smoke (some turbos are water-cooled) → `cooling-system` (`coolant_leak_testing`).
- Serpentine-belt / alternator **whine** and power-steering **whine** (the biggest confusable) →
  `starting-charging` (owns the alternator + serpentine/accessory-belt whine) and `steering-power-steering`;
  discriminated in §5/§7.
- Fuel-side lean causes (fuel pump, injectors) → `fuel-system-evap`; here we own only the **air-side** lean cause.
- General "check engine light I can't interpret" with no driveability symptom → `router-warning-lights` /
  `check_engine_light_testing`.

---

## 2. System primer (expert, CITED)

**Purpose.** The intake system delivers filtered air, meters its mass, and (on boosted engines)
compresses it so more fuel can be burned per cycle. The PCM computes fuel from measured/estimated air
mass, so **any unmetered air (a leak) or mis-metered air (a bad MAF) corrupts the air-fuel ratio** and
shows up as driveability faults and lean codes. [SAE J1930 terminology for *mass air flow sensor*,
*turbocharger*, *charge air cooler*; Bosch Automotive Handbook, hot-film MAF operating principle — Tier 1/2, accessed 2026-07-18]

**Naturally-aspirated intake path.** Air filter → MAF (hot-wire/hot-film; measures actual air mass) →
throttle body → intake manifold (MAP sensor reads manifold vacuum/pressure) → valves. A vacuum leak
downstream of the MAF admits **unmetered** air → lean mixture → rough idle, hesitation, sometimes an
audible **whistle/hiss** at idle. [Bosch Automotive Handbook, Tier 1/2; corroborated MAF-symptom
consensus — AutoZone, Firestone, CarParts, Tier 3 ×3, accessed 2026-07-18]

**Forced induction.**
- **Turbocharger** — exhaust energy spins a turbine that drives a compressor on a shared shaft riding on
  a fluid-film or ball bearing. Boost is regulated by a **wastegate** (bypasses exhaust around the turbine)
  driven by an actuator (vacuum/pressure diaphragm or electronic) commanded by a **boost-control solenoid**.
  A **charge-air cooler (intercooler)** cools the compressed air between compressor and throttle. The
  pressurized "hot side" is a chain of pipes/couplers/clamps; any split or popped coupler is a **boost leak**.
  [Halderman, *Automotive Technology*, turbocharging & intercooling chapter — Tier 2 textbook; SAE J1930
  terminology — Tier 1, accessed 2026-07-18]
- **Supercharger** — belt-driven compressor (roots/twin-screw = positive displacement; centrifugal =
  looks like a belt-driven turbo). Characteristic rising **whine** that tracks engine RPM directly (not
  exhaust-energy-lagged like a turbo). [Halderman, *Automotive Technology*, supercharger types (roots/
  twin-screw/centrifugal) & characteristic whine — Tier 2 textbook, accessed 2026-07-18]

**Modern control note.** On most 2010+ turbo engines the PCM continuously compares **commanded vs actual
boost** and sets **P0299 (underboost)** or **P0234 (overboost)**; a persistent boost fault, an implausible
MAF, or an electronic-throttle fault forces **limp / reduced-engine-power** mode — the car caps RPM/speed
to protect itself. [SAE J2012 standardized DTC definitions: P0299 "Turbocharger/Supercharger 'A' Underboost
Condition", P0234 "…Overboost Condition", P0101–P0103 MAF, P0106–P0108 MAP, P0171/P0174 "System Too Lean";
Tier 1, corroborated obd-codes.com / AutoZone, accessed 2026-07-18]

---

## 3. Failure-mode catalog (diagnostic spine, CITED per mode)

### FM-1 Turbo/supercharger bearing wear → rising whine/"siren"
- **Sensory signature:** `noise_descriptor=whining` (proposed `whistling` when siren-like), high-pitched,
  from `sound_or_smoke_location_zone=under_hood`; **rises with RPM and gets louder under load** (`onset_timing=when_accelerating`).
- **Modifiers:** loudest climbing hills / merging; may accompany blue smoke if seals also gone.
- **Severity:** `drivable_but_concerned` early → tow-worthy if the shaft seizes.
- **Misattribution:** customers (and one shop note in the corpus) call an under-hood whine a "power steering /
  water-pump" whine. Discriminate on RPM/load tracking vs steering/electrical load (§5).
- **Cite:** bearing play → shaft-to-housing contact → whine that intensifies under load [Halderman,
  *Automotive Technology*, turbo bearing wear/noise — Tier 2 textbook; corroborated underhoodservice.com
  "Diagnosing Turbocharger Failures" — Tier 3, accessed 2026-07-18].

### FM-2 Boost leak (split charge pipe / popped coupler / loose clamp / cracked intercooler)
- **Sensory signature:** power loss under load (`low_power_or_wont_accelerate_normally`), sometimes a
  **whoosh/whistle/hiss** *only when accelerating* (`noise_descriptor=hissing|whistling`, `onset_timing=when_accelerating`);
  frequently a **P0299 underboost** CEL.
- **Severity:** `drivable_but_concerned`; car "flat/lazy" above low RPM.
- **Misattribution:** feels identical to a "weak/failing turbo," but **most underboost is a leak/hose/actuator,
  not a dead turbo** — diagnosis before replacement. [Halderman, *Automotive Technology*, turbo underboost
  diagnosis (leaks/hoses/wastegate before turbo replacement) — Tier 2 textbook; corroborated
  underhoodservice.com "Turbocharger Diagnostics" — Tier 3, accessed 2026-07-18]

### FM-3 Wastegate / actuator / boost-solenoid fault → under- or over-boost, limp mode
- **Sensory signature:** sustained low power OR surging boost; CEL **P0299/P0234**; `drivable_state`
  ranges to `not_drivable_needs_tow` in hard limp.
- **Modifiers:** may throw multiple dash lights that "came on then off" (corpus pattern).
- **Cite:** wastegate/actuator among the most common underboost/overboost causes [SAE J2012 P0234/P0299 — Tier 1;
  Halderman, *Automotive Technology*, boost-control (wastegate/actuator/solenoid) faults — Tier 2 textbook,
  accessed 2026-07-18].

### FM-4 Dirty / failing MAF sensor → hesitation, lean, rough idle, stall
- **Sensory signature:** `hesitation_or_lag_when_accelerating` (tip-in stumble), `rough_idle`, sometimes
  stall at idle; may set **P0101–P0103** and/or **P0171/P0174 lean**.
- **Modifiers:** often after an air-filter/intake service (contaminated element); worse cold.
- **Misattribution:** blamed on "the transmission" or "bad gas."
- **Cite:** dirty MAF → hesitation on acceleration, rough idle, stalling, lean running [AutoZone + Firestone +
  CarParts, Tier 3 ×3 corroborated; Bosch handbook operating principle Tier 1/2, accessed 2026-07-18].

### FM-5 Vacuum / PCV / intake-manifold-gasket leak → unmetered air, lean, idle whistle
- **Sensory signature:** rough idle / high-or-hunting idle, hesitation, **whistle/hiss at idle**
  (`noise_descriptor=hissing|whistling`, `onset_timing=when_idling`), **P0171/P0174 lean**.
- **Discriminator vs FM-2:** vacuum leak symptoms peak **at idle / light load**; boost leak peaks **under
  acceleration/boost**. [Bosch handbook + SAE lean-code semantics, Tier 1/2, accessed 2026-07-18]

### FM-6 Clogged air filter → mild power loss / reduced economy (rarely a code)
- **Sensory signature:** gradual (`started_when=gradually`) mild power/economy drop; **usually no CEL**.
- **Severity:** `drivable_normally`. Frequently surfaces as a **maintenance line**, not a symptom (§8 null-routes).
- **Cite:** restricted air filter reduces airflow → mild performance/economy loss [Halderman,
  *Automotive Technology*, air-filter restriction effects — Tier 2 textbook, accessed 2026-07-18].

### FM-7 Turbo oil-seal failure → blue smoke + oil consumption (+ oil at housing)
- **Sensory signature:** `smoke_color=blue_or_gray` from tailpipe on accel/decel; oil film in intake/turbo;
  `smell_descriptor=burnt_oil`.
- **Routing note:** smoke color owns the route (→ `check_engine_light_testing` per taxonomy §3a); logged here
  because the *cause* is forced-induction. [Halderman, *Automotive Technology*, turbo oil-seal failure →
  oil into intake/exhaust, blue smoke — Tier 2 textbook, accessed 2026-07-18]

### FM-8 Overboost / compressor surge (BOV/diverter, restricted intake) → fluttering/chuffing on lift
- **Sensory signature:** rapid **flutter/chuff** noise on throttle lift, possible **P0234**; less common in
  Jeff's US daily-driver mix.
- **Severity:** `drivable_but_concerned`. Low corpus demand — noted, not deeply enriched.
- **Cite:** compressor surge on throttle lift when charge air has nowhere to go (failed/missing
  blow-off/diverter valve or restricted intake); overboost sets P0234 [Halderman, *Automotive Technology*,
  boost control / blow-off-valve function — Tier 2 textbook; SAE J2012 P0234 — Tier 1, accessed 2026-07-18].

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Real-voice phrasings, source-ordered (Tekmetric corpus first). Full machine form in
`air-induction-forced-induction.lexicon.yaml`.

| Phrase (as customers say it) | Failure mode | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|---|
| "hears whistling on accel … vehicle not accelerating" | FM-2/FM-3 | low_power_or_wont_accelerate_normally | needs-fact:onset_timing (recent-service cue overrides) | tekmetric |
| "vehicle doesnt go over a certain speed / went into limp mode … dash lights came on but now off" | FM-3 | multiple_warning_lights_at_once | needs-fact:warning_light_behavior | tekmetric |
| "whine noise when running" | FM-1 | high_pitched_whining_under_the_hood | cross-system:starting-charging | tekmetric |
| "puddle under both turbos, oil cooler … oil low" | FM-7 | brown_or_black_puddle_engine_oil | cross-system:engine-lubrication-oil | tekmetric |
| "replace engine air filter" (declined maintenance line) | FM-6 | — (null-route) | non-concern → advisor | tekmetric |
| "whine while accelerating, doesn't match wheel RPM, loud going up hills" | FM-1 vs driveline | high_pitched_whining_under_the_hood | cross-system:driveline (diff whine) | forum-paraphrase |
| "turbo whistling and feels down on power" | FM-2 | low_power_or_wont_accelerate_normally | needs-fact:onset_timing | synthetic |
| "sounds like a jet / turbine spooling up loud" | FM-1 | high_pitched_whining_under_the_hood | needs-fact:onset_timing | synthetic |
| "hisses at idle and idles rough, ran lean code" | FM-5 | rough_idle_or_shaking_at_a_stop | needs-fact:onset_timing | synthetic |
| "reduced engine power light, won't rev past 3k" | FM-3 | low_power_or_wont_accelerate_normally | unambiguous (limp) | synthetic |

Messiness represented: all-caps Tekmetric fragments, "turbos" (plural/loose), maintenance-line noise,
part-name looseness ("booster" for brake booster — see §7 negative), and the vague "whine noise when running."

---

## 5. Differential & discriminating questions (binds required_facts + slots)

| Confusable pair | The ONE discriminating question | Fact slot + value that answers it |
|---|---|---|
| Turbo whine (FM-1) **vs** power-steering whine | "Is the whine there whenever the engine runs, or only when you turn the wheel?" | `onset_timing`: `when_turning` → steering; `when_accelerating`/`always` → turbo/belt |
| Turbo whine (FM-1) **vs** alternator/belt whine | "Does it get louder when you turn the headlights/blower on, or when you step on the gas?" | `lights_state`/electrical-load → alternator; `onset_timing=when_accelerating` (load) → turbo |
| Boost leak (FM-2) **vs** vacuum leak (FM-5) | "Is it worse when you're accelerating hard, or when you're just sitting at idle?" | `onset_timing`: `when_accelerating` → boost leak; `when_idling` → vacuum leak |
| Boost/underboost (FM-2/3) **vs** transmission slip | "Does the engine rev up while the car barely speeds up?" | revs-without-speed is a trans-slip cue, NOT a boost cue → `low_power` q1183 is **deferred** to the `transmission_behavior` / `power_delivery_feel` slot proposed by `automatic-transmission` / `engine-controls-driveability` (see §9); this dossier does not bind it |
| Turbo whistle (FM-2) **vs** exhaust leak roar | "Is it a high whistle/hiss, or a low rumble/roar that's louder out the back?" | `noise_descriptor`: `whistling|hissing` → intake/boost; `roaring` → exhaust |
| MAF hesitation (FM-4) **vs** momentary tip-in lag from trans | "Did it start after an air-filter/intake service or a tank of gas?" | `recent_action`: `general_service`/`fuel_fill_up` |
| Whistling that sets a slot | "whistling on accel" → `noise_descriptor=whistling` + `onset_timing=when_accelerating` | **proposed value** `noise_descriptor=whistling` (§9) |

**Literalness guardrail:** "whistling on accel" sets `noise_descriptor=whistling` + `onset_timing=when_accelerating`
ONLY — it does **not** set `vehicle_powertrain=turbocharged` unless the customer literally said the car is
turbo, and it does **not** name a boost leak vs a wastegate (that is the shop's diagnosis, not the customer's fact).

---

## 6. Warning lights & DTC surface

- **Check Engine (MIL)** — the primary light for FM-2/3/4/5/7. Customer names: "check engine", "engine light",
  "the little engine symbol". → `warning_light_named=check engine`.
- **"Reduced Engine Power" / wrench / "limp mode"** — FM-3 hard boost/throttle faults. Customer names:
  "reduced power light", "wrench light", "car went into limp mode", "won't go over X mph". Behavior often
  `came_on_then_off` or `multiple_lights_at_once` (corpus). No dedicated dash-light subcategory — routes via
  `low_power_or_wont_accelerate_normally` or `multiple_warning_lights_at_once`.
- **Flashing CEL** = active misfire (a lean vacuum/boost leak can trigger this) → escalate; `warning_light_behavior=flashing_or_blinking`.
- Standardized DTCs a shop will pull: **P0299** underboost, **P0234** overboost, **P0101–P0103** MAF,
  **P0106–P0108** MAP/boost sensor, **P0171/P0174** lean, **P2263** turbo boost system performance.
  [SAE J2012, Tier 1, accessed 2026-07-18]

---

## 7. Confusable neighbors (cross-system)

1. **`high_pitched_whining_under_the_hood` (belt/alternator/PS whine)** — the dominant confusable. Turbo/
   supercharger whine tracks **engine RPM under load**; PS whine tracks **steering input**; alternator whine
   tracks **electrical load**; belt squeal is worst **cold/damp**. Discriminator: `onset_timing` +
   `lights_state`. Cross-ref: `starting-charging` (alternator + serpentine/accessory belt), `steering-power-steering`.
2. **Driveline/differential whine** — whine that rises with **road speed** and is loud **uphill** but doesn't
   match engine RPM (forum example) → driveline, NOT turbo. Cross-ref: `driveline-cv-diff-awd`.
3. **Vacuum leak (intake-side) vs boost leak (charge-side)** — same customer words ("whistle", "hiss", "low
   power"); split by `onset_timing` idle vs accel (§5).
4. **Exhaust leak / louder exhaust** — `roaring`/rumble louder out the back → `exhaust_system_testing`.
5. **Brake "booster"** — corpus 7910 "CHECK ENGINE LIGHT ON. WAS TOLD NEEDED A BOOSTER BY DEALER": 'booster'
   is a **brake booster**, not turbo boost. The routable symptom is the STATED check engine light → route
   `check_engine_light` (CEL scan); `brake_inspection` is NOT acceptable (it cannot reach the CEL subcategory,
   and no brake symptom was stated). Stage-1 hedge + negative example added (§ proposals). Cross-ref:
   `brakes-friction-hydraulic`.
6. **Transmission slip** — "revs but won't go" overlaps `low_power`; trans slip owns `transmission_testing`.

Owns confusable-matrix rows (Wave B): *turbo-whine ↔ ps/alternator-whine*, *boost-leak ↔ vacuum-leak*.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Current testing service | Current category | Current subcategory slug | Fit |
|---|---|---|---|---|
| FM-1 turbo/SC whine | (none ideal) → check_engine_light_testing for cause | noise | high_pitched_whining_under_the_hood | **weak** (framed for belt/PS; no boost-load cue) |
| FM-2 boost leak, power loss | check_engine_light_testing | performance | low_power_or_wont_accelerate_normally | good ("limp mode"/"reduced engine power" already in live synonyms) |
| FM-3 wastegate/limp | check_engine_light_testing | performance / warning_light | low_power_or_wont_accelerate_normally / multiple_warning_lights_at_once | good |
| FM-4 dirty MAF | check_engine_light_testing | performance | hesitation_or_lag_when_accelerating | good |
| FM-5 vacuum/PCV leak | check_engine_light_testing | performance | rough_idle_or_shaking_at_a_stop (+ hesitation) | good |
| FM-6 clogged air filter | (maintenance) | — | — | **NO FIT** → advisor / maintenance null-route |
| FM-7 turbo oil-seal blue smoke | check_engine_light_testing | smoke | blue_or_gray_smoke_from_tailpipe | good (color owns route) |
| FM-8 overboost/surge flutter | check_engine_light_testing | performance / warning_light | low_power / multiple_warning_lights | weak (rare) |

**Gaps → proposals (see `.proposals.yaml`):**
- **NO dedicated forced-induction/boost subcategory.** Boost-specific symptoms (turbo whistle that changes
  with boost, boost leak, wastegate/limp) are diagnostically distinct from a generic "low power" or "belt
  whine," yet have no home that a customer's boost language routes to cleanly. → `stage2.subcategory.propose`
  under `performance`: `turbo_or_boost_power_problem` (demand-flagged; low current corpus volume but a named
  growth gap in README §Catalog coverage).
- **NO `whistling` noise value** — turbo/boost/vacuum whistle collapses to `whining` or `hissing`, losing the
  best forced-induction cue. → `stage3.slot.value.add noise_descriptor=whistling`.
- **NO `supercharged` powertrain value** — customers do say "it's supercharged / the supercharger". →
  `stage3.slot.value.add vehicle_powertrain=supercharged`.
- **Air-filter maintenance lines** have no null-route anchor. → handled via the **golden null-route cases**
  (`route: advisor`, empty Stage-1) keyed on the non-concern work-order pattern and
  `customer_request_type=replace_specific_part`. NOT a `stage2.example.negative.add` — that op REQUIRES a
  `routes_to` subcategory slug, which an advisor null-route (no subcategory) cannot name.
- **Chris-gated:** a dedicated *Forced-induction / boost system test* service (§ `catalog.service.propose`) —
  or fold under `check_engine_light_testing`; decision is Chris's.

---

## 9. Fact-slot audit

**Slots this system uses (existing):** `noise_descriptor` (whining/hissing/roaring), `onset_timing`
(when_accelerating/when_idling/when_turning), `started_when` (gradually/sudden_onset — note: "got worse
little by little" → `started_when=gradually`, NOT `onset_timing`; FM-6 uses `started_when=gradually`),
`speed_band`, `sound_or_smoke_location_zone=under_hood`, `smoke_color=blue_or_gray`, `smell_descriptor=burnt_oil`,
`warning_light_named`, `warning_light_behavior` (came_on_then_off/multiple_lights_at_once/flashing_or_blinking),
`engine_running` (rough_idle/misfiring/surging), `recent_action` (general_service/fuel_fill_up), `drivable_state`,
`vehicle_powertrain=turbocharged`, `lights_state`, `customer_request_type` (replace_specific_part/routine_maintenance).

**New VALUES on existing slots (proposed — a value-add, NOT a new slot; the ≥3-question rule governs new
SLOTS only):**
- `noise_descriptor=whistling` — enum currently holds `whining`/`hissing`/`roaring`/`squealing_high_pitched`
  but no `whistling`, so a turbo/boost/vacuum whistle collapses to `whining`/`hissing` and loses the best
  forced-induction/vacuum cue. Corpus evidence: 6774 "HEARS WHISTLING ON ACCEL". **Consumers already exist:**
  `noise_descriptor` already tags the `required_facts` of **q1187** (low_power, rf=[noise_descriptor]) and
  **q378** (check_engine_light, rf=[noise_descriptor]) — so adding the value lets those existing questions be
  answered/skipped when a customer literally says "whistle", and sharpens Stage-2 routing. No new
  `required_facts.set` op is needed (the slot is already bound on those questions).
- `vehicle_powertrain=supercharged` — enum holds `turbocharged` but not `supercharged`; literal
  "it's supercharged / the supercharger". Value-add for literal capture + Stage-2 routing parity with
  `turbocharged`. (Not currently gated by any question's `required_facts`; value is Stage-2/routing, not skip.)

**New SLOT considered and REJECTED (≥3-question rule not met):** a `boost_behavior`
(builds_normally / never_builds / surges) slot would help FM-2/3/8, but only ~2 current questions could
consume it and customers rarely state it literally (it's shop-measured). Logged as a backlog note, not proposed.

**Un-slottable discriminators — `intentionally_empty` (genuinely no slot AND no peer proposal):** "drop in
gas mileage" (q1185) and "whine speeds up/slows down with engine speed" (q92) map to no current slot without
inference, and no peer dossier proposes a slot for them → keep asking.

**DEFERRED (a peer dossier already PROPOSES a slot — this system does NOT mark them empty, to avoid a Wave C
conflict):** "revs but car doesn't pick up speed" (q1183) and "stuck in a lower gear / held back" (q1186) are
trans-slip / power-delivery cues, NOT forced-induction discriminators. `automatic-transmission` binds both to
its proposed `transmission_behavior` slot and `engine-controls-driveability` to its proposed
`power_delivery_feel` slot; this dossier defers to those rather than asserting `intentionally_empty` (which
would directly contradict them).

---

## 10. Sources

Diagnostic / failure-mode claims (diagnostic authority):
- **Halderman, *Automotive Technology: Principles, Diagnosis, and Service*** (Pearson) — turbocharging,
  supercharging (roots/twin-screw/centrifugal + characteristic whine), intercooling, boost control
  (wastegate/actuator/solenoid, blow-off/diverter), turbo bearing-wear noise, turbo oil-seal → blue smoke,
  underboost-diagnose-before-replace, air-filter restriction, MAF hesitation/lean. **Tier 2** (standard
  textbook — the primary diagnostic backbone for this dossier; no URL, print/e-text reference).
- **Bosch, *Automotive Handbook*** (SAE International) — hot-film MAF operating principle; air-metering →
  fuel-trim relationship. **Tier 1** (reference).
- **SAE J1930** standardized terminology (mass air flow sensor, turbocharger, charge air cooler, throttle
  body). **Tier 1**. Accessed 2026-07-18.
- **SAE J2012** DTC definitions: P0299 "Turbocharger/Supercharger 'A' Underboost Condition", P0234
  "…Overboost Condition", P0101–P0103 (MAF), P0106–P0108 (MAP/boost), P0171/P0174 ("System Too Lean"),
  P2263 (boost system performance). **Tier 1**.
  Corroborated: obd-codes.com "P0299 Turbocharger/Supercharger Underboost" (https://www.obd-codes.com/p0299,
  accessed 2026-07-18) — **Tier 3**.
- **underhoodservice.com** (Babcox trade publication) — "Turbocharger Diagnostics" / P0234–P0299
  wastegate-actuator-boost-leak workflow (https://www.underhoodservice.com, accessed 2026-07-18). **Tier 3**,
  each use paired with Halderman above (never sole source).
- **MAF dirty-sensor symptom signature** (hesitation, rough idle, stall, lean) — autozone.com "Symptoms of a
  bad mass air flow sensor" (https://www.autozone.com, accessed 2026-07-18) + carparts.com "Bad MAF sensor
  symptoms" (https://www.carparts.com, accessed 2026-07-18). **Two independent Tier 3**, paired with Bosch +
  Halderman for the operating principle.
- **Garrett Motion** turbo material was consulted but the direct article 404'd at fetch time — per
  source-policy an inaccessible source is NOT cited; its claims are carried entirely by the accessible
  Halderman (Tier 2) + underhoodservice (Tier 3) above.

Linguistic authority (customer-voice artifacts — never cited for diagnosis):
- Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json` (500 labeled) — primary (lines 6774, 7409, 7192,
  697, 9757, 2460, 7910 quoted/paraphrased here).
- `real-concerns-forums.json` — paraphrased patterns (lines 490, 1650, 1690, 1770), provenance `forum-paraphrase`.
- Synthetic phrasings flagged `synthetic`; forced-induction-specific rows are corpus-gapped (see lexicon header + §11).

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every failure mode has a sensory signature in fact-slot vocab where possible (§3).
- [x] Every diagnostic/differential claim carries a tiered cite; no memory-only claims; Halderman (Tier 2)
      is the diagnostic backbone, the 404'd Garrett source is NOT cited (§2, §3, §10).
- [~] Customer artifacts in customer voice; **synthetic share is OVER the ~30% target and this is DISCLOSED,
      not hidden.** Honest counts: **lexicon = 7/17 synthetic (~41%)** — forced induction is a documented
      corpus gap (only 4 real forced-induction utterances exist), so the boost/turbo/supercharger-specific
      rows are irreducibly synthetic; real voice (tekmetric + forum-paraphrase) is used everywhere it exists.
      Per-subcategory synthetic in the lexicon: low_power 2/4, whine 1/4, hesitation 1/2, rough_idle 1/2,
      smoke 1/2, null-routes 1/2. **Subcategory positive_example SETS remain well under cap** because the
      live DB positives are all real: adding 1–2 synthetic examples to a 5-real base keeps each subcategory
      ≤ ~30% (low_power 1 synth add on 5 real; whine 1 synth on 5 real; hesitation 1 synth + 1 forum on 5 real).
- [x] Every negative example names `routes_to` (see `.proposals.yaml`).
- [x] No over-broad synonyms — proposed synonyms are ≥2 tokens or domain tokens (`turbo whistle`,
      `boost leak`, `wont build boost`, `turbo whine`, `supercharger whine`); `underboost` was REMOVED as
      DTC/mechanic vocab with no corpus evidence.
- [x] Literalness respected — `whistling` set only from literal whistle cues (`whoosh` EXCLUDED — see golden
      case 4 → `hissing`); `supercharged` excludes `the blower` (HVAC collision); the inference-trap golden
      cases guard `vehicle_powertrain` (vague whine) and the 'booster' word (brake booster, not turbo boost).
- [x] Stage-1 hedges bind Stage-1 candidate KEYS (`check_engine_light_testing` ↔ `charging_starting_testing`;
      `check_engine_light_testing` ↔ `brake_inspection`), not Stage-2 subcategory slugs.
- [x] Catalog/subcategory/service changes are **proposals**, Chris-gated, with demand evidence (§8).
- [x] ≥8 golden cases (10) incl. inference-traps (vague whine clarify-chip; 'booster') and null-routes
      (2 air-filter cases); the clarify-chip case lists 3 ranked Stage-1 candidates (`.proposals.yaml`).
- [x] `noise_descriptor`/`vehicle_powertrain` value-adds framed as VALUE adds (not new slots); whistling's
      real consumers are q1187 + q378 (already `required_facts=[noise_descriptor]`).
- [x] Cross-dossier collisions NOTED: q1182 skip_class (SAFE in engine-controls vs PARTIAL here/auto-trans);
      q1183/q1186 DEFERRED to peer proposed slots (not marked `intentionally_empty`).
- [x] Cross-system references use real dossier slugs (`starting-charging`, `steering-power-steering`,
      `driveline-cv-diff-awd`, `engine-lubrication-oil`, `fuel-system-evap`, `brakes-friction-hydraulic`).
- [ ] **Open for Chris:** approve the new subcategory + the forced-induction service (or fold into CEL);
      approve the two new fact-slot VALUES before the eval re-run.
