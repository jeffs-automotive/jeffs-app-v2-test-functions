# Warning-light / dashboard-telltale router — router dossier
slug: router-warning-lights   date: 2026-07-18   type: Wave-B cross-system router
owns_confusable_pairs: [taxonomy-#1 (brake_inspection ↔ brake_inspection_warning_light, dash-light half),
  "the 12 warning_light/* subcategories", "CEL steady vs flashing", "red-brake mechanical vs ABS escalation",
  "which testing service each light routes to", "customer light nicknames"]
consumes_wave_a: [abs-traction-stability, brakes-friction-hydraulic, cooling-system, engine-lubrication-oil,
  starting-charging, wheels-tires-tpms-bearings, airbag-srs-restraints, steering-power-steering,
  engine-controls-driveability, ignition-misfire, adas-driver-assist, hybrid-ev-high-voltage]
signature_deliverables: [binding/warning-light-master-table.md, binding/confusable-matrix.yaml (rows below)]

> A per-system dossier cannot own cross-system routing: a customer who types "a bunch of lights came on"
> or "the squiggly car light" or "red brake light AND the abs light" spans systems no single Wave-A owner
> can arbitrate. This router OWNS that arbitration. Its machine output is
> `binding/warning-light-master-table.md` (the light → subcategory → service map) plus the
> `confusable_matrix_rows` and typed ops in `router-warning-lights.proposals.yaml`.

---

## 1. Scope & boundaries

**In scope** — the routing of any DASHBOARD WARNING TELLTALE utterance to one of the 12
`warning_light/*` subcategories (or a cross-taxonomy interim route), specifically:
- Naming the light by color + label + icon, including customer NICKNAMES ("squiggly car light",
  "exclamation-point tire thing", "genie lamp", "red thermometer", "little person with a seatbelt").
- The **solid vs flashing** (and red vs amber vs blue) severity semantics per light.
- **CEL steady-vs-flashing** severity (stored code vs active catalyst-damaging misfire).
- **Red-BRAKE mechanical-vs-ABS** escalation (base hydraulic vs electronic anti-lock; both-on → red).
- Which **testing service** each light routes to.
- The **`multiple_warning_lights_at_once`** arbitration ladder (charging cascade vs sibling pair vs
  all-ADAS vs after-impact).
- The **key-on self-test** (`came_on_then_off`) non-fault case.

**Out of scope (owned elsewhere)** — the *diagnosis* behind each light. This router decides WHICH light /
subcategory / service; the Wave-A dossier owns the failure-mode depth:
- ABS/traction/stability WSS mechanism → `abs-traction-stability`.
- Red-brake hydraulic/fluid/e-brake mechanism → `brakes-friction-hydraulic`.
- Oil-pressure vs oil-life-reminder mechanism → `engine-lubrication-oil`.
- Temp light / overheating / gauge → `cooling-system`.
- Battery/charge cascade mechanism → `starting-charging`.
- TPMS sensor mechanism → `wheels-tires-tpms-bearings`.
- SRS/airbag mechanism → `airbag-srs-restraints`.
- EPS mechanism → `steering-power-steering`.
- CEL/MIL DTC families + misfire flash mechanism → `engine-controls-driveability` / `ignition-misfire`.
- ADAS message mechanism → `adas-driver-assist`. HV/hybrid master-warning/turtle → `hybrid-ev-high-voltage`.
- Exterior brake-LAMP bulb, dome light, single dead accessory → `body-electrical-accessories`
  (`accessory_doesnt_work`).

---

## 2. The decision tree (Stage-1 + Stage-2 routing)

```
Customer utterance mentions a dashboard light / telltale?
│
├─ NO named light, but a drive-feel/leak/noise symptom → route on the SYMPTOM (leave warning-light router).
│
├─ Light lit then went OUT within seconds at start-up, car normal
│     → came_on_then_off (self-test, NOT a fault) → reassurance; keep the named subcategory.
│
├─ SEVERAL different lights? → run the multiple_warning_lights_at_once ladder (§3):
│     1. sibling pair (ABS+traction, or its own "no AWD" message) → the NAMED light
│     2. red BRAKE + yellow ABS → brake_system_red_light (safety-first)
│     3. cascade WITH dimming / hard crank / rough run / died → multiple_warning_lights_at_once (charging)
│     4. all-ADAS message set (no electrical distress) → ADAS subcategory
│     5. after an impact → after_a_recent_accident_or_impact
│     6. "a bunch of lights", none named → multiple_warning_lights_at_once
│
└─ ONE light named → identify it by COLOR + LABEL + ICON (master table), then:
      ├─ engine outline ................ check engine → steady vs FLASHING (§4) → check_engine_light /
      │                                   (flashing+felt symptom → engine_misfire, performance)
      ├─ wrench / "service due" / oil-life → service_engine_soon_or_maintenance_required_light (reminder)
      ├─ battery / plus-minus / ALT .... battery_charging_light → charging_starting_testing
      ├─ oil can / genie lamp .......... oil_pressure_light → oil_pressure_light_testing
      │                                   (NOT the oil-life reminder → that's the wrench)
      ├─ thermometer in waves .......... RED=engine_temperature_light (cooling); BLUE=normal cold, no fault
      ├─ horseshoe + (!) / tire ........ tpms_tire_pressure_light → tpms_testing
      ├─ "ABS" letters (amber) ......... abs_anti_lock_brake_light → abs_traction_stability_testing
      ├─ RED word BRAKE / red (!) ...... brake_system_red_light → brake_inspection_warning_light
      │                                   (if a rear BULB is out & nothing on dash → accessory_doesnt_work)
      ├─ person + seatbelt / SRS ....... airbag_srs_light → airbag_srs_testing
      ├─ skidding car / "squiggly car" . traction_control_stability_light → abs_traction_stability_testing
      │                                   (FLASH = normal intervention; STEADY = fault)
      ├─ steering wheel + (!) .......... power_steering_eps_light → power_steering_eps_testing
      └─ turtle / red triangle / "check hybrid" / ADAS message → cross-taxonomy interim (master table §5)
```

The full light → names → value → semantics → subcategory → service grid is
`binding/warning-light-master-table.md` (§1). The `multiple_*` ladder and both inference traps live there
too; this dossier is the human-readable narration of it.

---

## 3. `multiple_warning_lights_at_once` — the arbitration this router owns

The subcategory's DB description is scoped to a **charging/alternator voltage cascade** — so "≥2 lights"
alone must NOT route there. The ladder (first match wins) is in the master table §2; the load-bearing
distinctions:

- **A sibling pair is ONE concern, not "multiple."** ABS + traction/stability share the wheel-speed-sensor
  network and routinely light together; a red BRAKE co-lights with ABS via EBD. Route to the primary named
  light (safety-first when a red brake is in the set), not `multiple_*`.
- **The cascade tell is ELECTRICAL DISTRESS.** Dimming lights + hard/slow cranking + rough running + "then
  it died" + "whole dash lit up" = charging/voltage root → `multiple_warning_lights_at_once`
  (`charging_starting_testing` / `warning_light_general`). Fact: `lights_state=dim_or_flickering`.
- **An all-ADAS message set is a DIFFERENT root cause** (shared camera/radar/bus) → the ADAS subcategory,
  NOT `multiple_*` (whose charging-cascade scope would lose the diagnosis).
- **After an impact** the situational bucket `after_a_recent_accident_or_impact` overrides.

---

## 4. CEL steady-vs-flashing severity (owned)

The single most safety-loaded warning-light distinction:

| Behavior | Meaning | Route |
|---|---|---|
| **Steady** check-engine | a stored fault code; drive to a shop soon | `check_engine_light` (warning_light) via `check_engine_light_testing`; a relayed CODE with no felt symptom stays here |
| **Flashing / blinking** check-engine | an ACTIVE severe misfire dumping raw fuel into the catalyst — reduce load NOW, catalyst-damaging | with a FELT symptom (bucking/stumble) → `engine_misfire_or_bucking_feeling` (performance); the flash is the urgency signal |

Discriminator: `warning_light_behavior` = `steady_on` vs `flashing_or_blinking`. Owns the
`stage1.keyword.add: flashing engine light` op (the active-misfire signal) and the CEL↔misfire hedge.
Do NOT confuse the amber MIL with the "service engine soon"/wrench maintenance reminder (a different
subcategory, no fault) — that trap is in §5 and the master table.

---

## 5. Customer-voice cues (nicknames → light)

Icon-only and nickname descriptions are how customers who can't read the label actually talk. This router
must resolve them. (Source order: Tekmetric corpus first, then forum-paraphrase, then synthetic — full
provenance in the proposals/lexicon; ids below are from `real-concerns-tekmetric-labeled-v2.json` /
`-forums.json` / `eval-cases.json`.)

| Customer says (nickname / icon) | Resolves to light | `warning_light_named` | Provenance |
|---|---|---|---|
| "the squiggly car", "little car with squiggly wavy lines under it", "car with skid lines", "anti-skid" | traction/stability | `traction control` | eval-004 (authored → synthetic); forum-paraphrase |
| "exclamation-point tire thing", "the horseshoe light", "low tire light" | TPMS | `TPMS` | forum-paraphrase / synthetic |
| "genie lamp", "Aladdin lamp", "oil can light", "red teapot light" (misread) | oil pressure | `oil pressure` | synthetic (icon nickname) |
| "red thermometer thing", "wavy thermometer", "hot light" | engine temp (red) | `temp` | cooling §6; synthetic |
| "little person with a seatbelt", "person and a ball", "SRS triangle" | airbag/SRS | `airbag` / `srs` | airbag §6; synthetic |
| "steering wheel with an exclamation point", "steering wheel light" | EPS | `power steering` | steering §6; synthetic |
| "battery thing with the plus and minus", "little battery symbol" | battery/charge | `battery` | starting-charging §6; synthetic |
| "the little engine symbol", "orange engine light" | check engine | `check engine` | engine-controls §6; synthetic |
| "red triangle of death", "check hybrid system", "the turtle" | hybrid HV master / reduced-power | free text | hybrid §6; synthetic |
| "SERVICE STABILTRAC LIGHT ON" (misspelled brand) | traction/stability | `stabilitrak` | tekmetric (verbatim) |
| "TRACTION CONTROL LIGHT STAYING ON" | traction/stability (steady=fault) | `traction control` | tekmetric |
| "ABS LIGHT ON TESTING. STEERING FEELS MORE DIFFICULT" | ABS (steering is a co-symptom, not the light) | `ABS` | tekmetric |
| "transmission light and esc off" | traction/stability (esc) | `esc` | tekmetric |
| "RED BRAKE LIGHT WAS COMING ON AND OFF ... topped off fluid, back on" | red brake | `brake` | tekmetric |
| "oil light came on when driving ... check oil level" | oil pressure | `oil pressure` | tekmetric |
| "TPMS LIGHT ON" | TPMS | `TPMS` | tekmetric |
| "AIR BAG LIGHT ON ... was in accident recently" | airbag/SRS (+ situational) | `airbag` | tekmetric |
| "ABS & TRAC LIGHTS ... ALSO REPORTED TPMS AND AIRBAG" | multiple | (all four) | tekmetric |
| "CUSTOMER STATES ALL THE LIGHTS ON HER INSTRUMENT CLUSTER CAME ON WHILE SHE WAS DRIVING" | multiple (cascade) | (unnamed) | tekmetric |
| "the entire dashboard lit up… engine, TPS, brakes, cruise" | multiple (cascade → head gasket per dealer) | (several) | tekmetric |
| "This brake lamp light on my dash lit up today.. the brake lights are working" | **INFERENCE TRAP** — dash BRAKE telltale (red), NOT the working rear bulbs | `brake` | tekmetric |

Messiness represented: all-caps Tekmetric fragments, brand acronyms (STABILTRAC/ESC/VSC), icon-only
descriptions, misspellings, mixed light-lists, co-symptoms reported as the light, and the
dash-telltale-vs-exterior-bulb conflation.

---

## 6. Differential & discriminating questions (feeds the confusable matrix + proposals)

Each row: the ONE best question + the fact slot/value that resolves it. Machine form (with `examples_a` /
`examples_b`) is `confusable_matrix_rows` in `router-warning-lights.proposals.yaml`; those rows are the
router's contribution to `binding/confusable-matrix.yaml`.

| Confusion (pair) | Best discriminating question | Slot → value |
|---|---|---|
| red BRAKE (mechanical) ↔ ABS (electronic) | "Is it **red** with the word BRAKE / a red (!), or **yellow** with the letters ABS?" | `warning_light_named` (color+label); both on → route red |
| CEL steady ↔ CEL flashing | "Is the engine light **steady**, or **blinking/flashing**?" | `warning_light_behavior` steady_on vs flashing_or_blinking |
| check engine (MIL) ↔ service-engine-soon/wrench (reminder) | "Is it the **engine outline**, or a **wrench / 'service due'** message?" | `warning_light_named` `check engine` vs `maintenance required` |
| oil-PRESSURE light ↔ oil-LIFE reminder | "Is it a **red oil-can**, or a **'oil life %/service due'** message?" | `warning_light_named` `oil pressure` vs `maintenance required` |
| temp light RED ↔ BLUE | "Is the thermometer light **red** (hot) or **blue** (cold)?" | `warning_light_named=temp`; blue = normal, no route |
| traction/stability FLASH ↔ STEADY | "Does it **flash briefly** on slippery roads, or stay **steady on** all the time?" | `warning_light_behavior` flashing (normal) vs steady_on (fault) |
| TPMS steady ↔ TPMS flashing | "Is the tire light **steady**, or does it **blink ~a minute then stay on**?" | `warning_light_behavior` steady_on (low tire) vs flashing_or_blinking (sensor fault) |
| one light ↔ multiple (cascade) | "Is it **just this one** light, or did **several** light up together?" | `warning_light_behavior=multiple_lights_at_once` + `lights_state=dim_or_flickering` |
| multiple (charging cascade) ↔ all-ADAS set | "Are the lights **dimming / car cranking hard**, or are they all **driver-assist** messages?" | `lights_state=dim_or_flickering` (charging) vs ADAS feature names |
| dash BRAKE telltale ↔ exterior brake LAMP bulb | "Is it a **warning light on your dash**, or a **brake bulb** at the back of the car?" | dash telltale (`warning_light_named` set) → red; rear bulb, nothing on dash → `accessory_doesnt_work` |
| EPS light ↔ ABS light (heavy-steering co-report) | "Which **light** is on — a **steering wheel** icon, or the letters **ABS**?" | `warning_light_named` power steering vs ABS |
| hybrid master / turtle ↔ plain check-engine | "Is it a **red triangle / 'check hybrid' / turtle**, or the plain **engine** light?" | `warning_light_named` + `vehicle_powertrain=hybrid/electric` |

**Literalness guard.** Naming ONE light never asserts a sibling is OFF ("ABS light on" does NOT set the
red brake light absent) — so "is the OTHER light also on?" questions stay always-ask (see the
`intentionally_empty` ops the ABS/brake Wave-A owners already emitted for Q414/Q423/Q435). "Steering feels
harder" with an ABS light sets `steering_feel`, NOT `warning_light_named=power steering` — the light named
is still ABS.

---

## 10. Sources

**Diagnostic authority** (all consumed from the Wave-A dossiers' cited §2/§3/§6 — this router re-uses their
citations rather than re-deriving; see each dossier's §10 for the full tiered list):
- ESC federally required MY2012+ — NHTSA / FMVSS No. 126 (49 CFR 571.126). **Tier 1.** (abs-traction-stability §2)
- DTC / telltale nomenclature — SAE J2012 (DTC), J1930 (terminology). **Tier 1.** (multiple dossiers)
- ABS/EBD red-vs-yellow semantics, brake-warning-lamp diagnosis — Bosch *Automotive Handbook* (Tier 1) +
  Halderman *Automotive Brake Systems* (Tier 2). (abs-traction-stability §2, brakes-friction-hydraulic §6)
- CEL steady-vs-flashing / active-misfire catalyst damage — Halderman OBD-II misfire monitor
  (crankshaft-speed-fluctuation), SAE J2012 misfire framework. **Tier 2.** (engine-controls §6, ignition-misfire §6)
- TPMS ≥25%-low threshold — FMVSS 138. **Tier 1.** (wheels-tires-tpms-bearings §6)
- Oil-pressure light vs oil-life reminder; temp red-vs-blue; battery/charge cascade; SRS red/amber;
  EPS amber/red — the respective Wave-A §6 surfaces (Bosch Tier 2 / ASE Tier 1 / parts-mfr Tier 2 as cited there).
- Instrument-cluster key-on self-test — Bosch *Automotive Handbook*, instrument-cluster/self-diagnosis. **Tier 2.**

**Linguistic authority** (voice only, never cited for diagnosis):
- Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json` (STABILTRAC; TRACTION CONTROL STAYING ON;
  ABS+steering; "transmission light and esc off"; RED BRAKE on/off after topping fluid; "oil light came on";
  "TPMS LIGHT ON"; "AIR BAG LIGHT ON … accident"; "ABS & TRAC … ALSO TPMS AND AIRBAG"; "ALL THE LIGHTS ON
  HER INSTRUMENT CLUSTER CAME ON"; "entire dashboard lit up… engine, TPS, brakes, cruise"; "brake lamp light
  on my dash … brake lights are working").
- `eval-cases.json` authored cases (abs/brake_inspection_warning_light/tpms/oil_pressure series) — labeled
  `synthetic` per source-policy (authored, not real corpus).
- `real-concerns-forums.json` — paraphrased patterns only (post-leveling ABS+traction; icon-only nicknames).

---

## 11. Binding-readiness self-check

- [x] Master table covers all 12 `warning_light/*` subcategories → subcategory + testing service + names +
  value + solid/flashing semantics; plus cross-taxonomy interim routes (hybrid/ADAS/exterior-bulb).
- [x] `multiple_warning_lights_at_once` arbitration ladder written (charging cascade vs sibling pair vs
  all-ADAS vs after-impact vs unnamed) with the discriminating fact set.
- [x] CEL steady-vs-flashing severity owned; `flashing engine light` keyword + CEL↔misfire hedge emitted.
- [x] Red-brake mechanical-vs-ABS escalation owned; both-on → red (safety-first).
- [x] Customer nickname → light table (squiggly car, horseshoe/exclamation tire, genie lamp, red
  thermometer, person+seatbelt, steering-wheel+!, turtle/red-triangle), corpus-first provenance.
- [x] Every negative example in proposals names `routes_to`; every confusable_matrix_row has
  discriminating_fact + discriminating_question + examples_a/examples_b.
- [x] Both standing inference traps carried (dash BRAKE telltale ≠ exterior bulb; temp GAUGE needle ≠ light).
- [x] No new subcategory/slot invented; hedges + negatives + master table only. `warning_light_named` is
  free-text so no `slot.value.add` op is emitted for it. Sibling-light "is Y also on?" questions kept
  always-ask (literalness) — defers to the Wave-A `intentionally_empty` ops, not re-proposed here.
- [x] ≥8 golden cases incl. inference traps + a null-route (exterior bulb) + a self-test non-fault case.
