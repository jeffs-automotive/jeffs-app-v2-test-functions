# Hybrid / EV high-voltage system — diagnostic dossier
slug: hybrid-ev-high-voltage   date: 2026-07-18
binds_services: [no_start_testing, charging_starting_testing, check_engine_light_testing, battery_test, brake_inspection]
binds_categories: [performance, warning_light, electrical, brakes]

> **SAFETY FRAME (read first).** This dossier is for **routing only**. The high-voltage traction
> system (typically 200–800 V DC) is lethal and must never be probed, opened, or "DIY-tested." By
> established industry safety convention, HV cabling is colored **orange** and the pack is isolated
> behind a **manual service disconnect** to mark do-not-touch components. That orange-cable /
> service-disconnect practice is grounded in HV-wiring and EV electrical-safety conventions (e.g. SAE
> J1673 / ISO 6469) — **not** in SAE J1715, which is only a terminology glossary; it is stated here as
> convention, not a verified standard clause. Every recommendation ends in "route to a testing service
> / advisor," never in an HV repair instruction. When in doubt, the safe route is **advisor handoff**
> (customer talks to a human), not a confident self-serve pick.
>
> **CATALOG-GAP DOSSIER.** The live taxonomy has **no** hybrid/EV-specific service or subcategory.
> Hybrid/EV symptoms are today force-fit onto ICE symptom slugs, which mis-routes them. The bulk of
> this dossier's value is (a) the `vehicle_powertrain` discriminator, (b) **five** proposed hybrid/EV
> subcategories (three well-shaped — reduced-power, won't-power-on, hybrid-warning; two thin and
> advisor-gated — won't-charge, battery-degradation) + one Chris-gated HV-diagnosis service, and (c)
> hedges/negatives that stop hybrid/EV phrasings from landing on the wrong ICE slug. **Corpus
> limitation:** Jeff's is an ICE-dominant US shop; the 500-line Tekmetric
> corpus contains ~one hybrid HV line and zero BEV concerns (see §4/§10). Customer-voice artifacts here
> therefore lean on NHTSA/forum-paraphrase + flagged synthetic more than any other dossier — a
> data-collection backlog item, not a modeling preference.

---

## 1. Scope & boundaries

**In scope** — symptoms a customer reports that originate in the **electrified propulsion** side of a
hybrid (HEV/PHEV) or battery-electric (BEV) vehicle, where the correct route depends on the vehicle
being electrified:

- **12 V auxiliary-battery no-power** — hybrid/EV "won't go to READY / won't power on / dash lights up
  but nothing happens." Because the 12 V aux must wake the contactor electronics before the HV pack
  engages, a depleted 12 V blocks READY even with a healthy HV pack — so it is an **electrical (12 V)**
  problem to rule out first, not an HV one.
- **HV traction-system faults** presenting as **reduced power / "turtle" / limp mode** and/or a
  **hybrid-system master warning** ("Check Hybrid System," red-triangle, turtle icon).
- **EV/BEV reduced-power / turtle** (thermal derate, inverter/motor/BMS fault) — the confusable twin of
  ICE low-power.
- **Regenerative-braking feel changes** on a stated hybrid/EV (grabby/different pedal, especially cold).
- **EVSE / on-board-charging faults** — "won't charge / port won't lock / charging stopped." (NO catalog
  fit → §8 proposal.)
- The `vehicle_powertrain` fact as the **spine discriminator** for all of the above.

**Explicitly OUT of scope** (route to the owning dossier; a hybrid/EV still has all the ordinary ICE/
chassis systems):

- **ICE-half mechanical/driveability on a hybrid** — misfire, rough idle, oil burn, coolant leak,
  exhaust — these are the same failures as any gas car → `engine-controls-driveability`,
  `ignition-misfire`, `engine-mechanical`, `engine-lubrication-oil`, `cooling-system`, `exhaust-emissions`.
  Being a hybrid does **not** move an oil leak into this dossier.
- **12 V charging/starting on a conventional ICE** (dead 12 V, alternator, starter click) →
  `starting-charging`. This dossier owns only the hybrid/EV *presentation* of 12 V no-power (no engine
  cranks; the "start" is entering READY).
- **Ordinary friction brakes** (squeal, grind, pulsation from warped rotors) → `brakes-friction-hydraulic`.
  Only **regen-specific** feel changes on a stated hybrid/EV live here.
- **HVAC, suspension, steering, tires** — identical to ICE; owned by their dossiers.
- **The physical HV repair itself** — out of scope for the classifier entirely (advisor / HV-trained tech).

---

## 2. System primer (expert, CITED)

A hybrid or EV has **two** electrical systems that customers routinely conflate: a **high-voltage (HV)
traction system** that moves the car, and an ordinary **12 V low-voltage system** that wakes and runs
everything else.

**High-voltage traction system.** A **traction battery pack** stores energy and feeds an **electric
traction motor**; between them sits a **power-electronics controller (inverter)** that "manages the flow
of electrical energy delivered by the traction battery, controlling the speed of the electric traction
motor and the torque it produces" [US DOE AFDC, "How All-Electric Vehicles Work," Tier 1, accessed
2026-07-18]. A **thermal-management system** "maintains a proper operating temperature range of the
engine, electric motor, power electronics, and other components" [DOE AFDC, all-electric, Tier 1] — this
matters because a battery/inverter that is too hot **or** too cold is deliberately power-limited (see
§3, "turtle"). In a **hybrid**, an internal-combustion engine plus one or more motor-generators share
propulsion; the generator "generates electricity from the rotating wheels while braking, transferring
that energy back to the traction battery pack" [DOE AFDC, "How Hybrid Electric Vehicles Work," Tier 1,
accessed 2026-07-18].

**The 12 V auxiliary battery (the key to hybrid/EV no-starts).** A separate small 12 V battery runs the
computers, contactors, lights, and accessories. Crucially, "the low-voltage auxiliary battery provides
electricity to **start the car before the traction battery is engaged**; it also powers vehicle
accessories" [DOE AFDC, hybrid, Tier 1, accessed 2026-07-18]. A **DC/DC converter** steps HV down to
recharge this 12 V battery while the car is on [DOE AFDC, all-electric + hybrid, Tier 1]. Consequence:
if the 12 V battery is depleted, the car **cannot enter READY even with a perfectly healthy HV pack** —
the electronics that would close the HV contactors never wake up. This is the mechanism that makes the
**cheap 12 V battery the correct first check** on a hybrid/EV "won't start," ahead of the expensive
traction pack (a mechanism/cost-ordering point, not a frequency statistic). There is no engine cranking
sound because on an EV there is no engine, and on a hybrid the engine is not spun by a 12 V starter in the
conventional way — the "start" event is the dash entering **READY**.

**Regenerative braking.** During light-to-moderate braking "the electric motor switches to generator
mode … converting [kinetic energy] into electrical energy stored in a battery"; "when more braking
torque is required than the generator alone can provide, additional braking is accomplished by friction
brakes" [Bosch Mobility, "Regenerative Braking Systems," Tier 1/OEM-supplier, accessed 2026-07-18]. The
car continuously **blends** regen and friction braking. When regen is unavailable — a **full** or
**cold** battery cannot accept charge — the system quietly shifts more work to the friction brakes, and
the driver may perceive a **different pedal feel or deceleration curve** until the pack warms
[Bosch, regen blending, Tier 1; DOE AFDC thermal-management, Tier 1].

**Common architectures / US variants.** Toyota/Lexus power-split hybrids (Prius, RAV4/Highlander/Camry
Hybrid), Honda two-motor hybrids, Ford hybrids, and plug-in hybrids (PHEV — which add an on-board charger
+ charge port) are common US hybrids; BEVs (Tesla, Leaf, Bolt, ID.4, Ioniq/EV6, Mach-E) add on-board
charging and have **no engine at all**. (The Tekmetric corpus is ICE-dominant — ~1 hybrid line, 0 BEV —
so it **cannot** confirm the local hybrid/EV mix; treat any vehicle-share statement as unverified for this
shop.) Customer dash cues vary by make: a "READY" state on power-up; a **turtle / reduced-power** icon on
some EVs/hybrids (e.g. Nissan LEAF [Nissan LEAF Owner's Manual, Tier 1]); and on Toyota/Lexus more often a
**red-triangle master warning** or "Check Hybrid System" message rather than a turtle.

---

## 3. Failure-mode catalog (the diagnostic spine, CITED per mode)

### 3.1 Depleted 12 V auxiliary battery — "won't go to READY / won't power on" (hybrid & EV)
- **Sensory signature:** press START and the car will **not enter READY**; interior/dash lights may come
  on (often a **scatter of warning icons**) but there is **no engine crank sound** and the car will not
  move. `engine_running` ≈ `wont_power_on_no_crank` (PROPOSED value; today falls to `no_sound_at_all`);
  `vehicle_powertrain` = `hybrid`/`electric` **only if the customer says so**. (Note: "the lights come
  on" is a warning-icon scatter, **not** a statement that brightness is `normal` — do not over-set
  `lights_state`.)
- **Conditions/modifiers:** worse after the car **sat** several days; worse in cold; often a **jump of
  the little 12 V battery** brings it right back (`recent_action=jump_started`), which is itself the
  strongest discriminator vs an HV fault.
- **Mechanism:** the 12 V battery wakes the computers that close the HV contactors; if it is flat, READY
  is unreachable even with a healthy HV pack [DOE AFDC, hybrid, Tier 1: aux battery "provides electricity
  to start the car before the traction battery is engaged," accessed 2026-07-18]. Because of this
  ordering, the 12 V is the correct **FIRST check**, ahead of the expensive traction pack.
- **Drivability:** `not_drivable_needs_tow` until the 12 V is jumped/charged.
- **Misattribution (critical):** customers fear the **traction ("hybrid") battery** died — a four-figure
  worry — when a depleted 12 V aux is a routine, low-cost cause the shop must **rule out first**. The
  classifier must **NOT** encode "hybrid + won't start → HV battery." Route to a 12 V/charging test first;
  do not assert the HV pack. (This is a mechanism-and-cost-ordering point, **not** a frequency statistic.)

### 3.2 HV traction-system fault — reduced power / "turtle" / limp mode (hybrid & EV)
- **Sensory signature:** car suddenly **loses power / won't accelerate normally**, capped to a crawl;
  a **turtle** icon and/or reduced-power / master-warning light. `engine_running` may be `normal` (it
  still moves, just weakly) — the lead symptom is **power**, not running quality;
  `drivable_state=drivable_but_concerned` → `not_drivable_needs_tow` if it drops to walking pace.
- **Conditions/modifiers:** commonly a **safety derate** — HV battery/inverter/motor too hot or too cold,
  very low state of charge, or a detected internal fault; can be intermittent then permanent.
- **Mechanism:** the vehicle deliberately **limits traction-motor power** to protect the battery/inverter/
  motor when the HV thermal envelope or a fault threshold is exceeded. An OEM owner's manual documents the
  derate literally: the LEAF power-limitation ("turtle") indicator illuminates "when the Li-ion battery
  available charge is extremely low," "when the Li-ion battery temperature is very low," or "when the
  temperature of the electric vehicle system is high (motor, inverter, coolant system, Li-ion battery
  etc.)," and in that mode "the power provided to the traction motor is reduced … Power limitation mode
  results in reduced power and vehicle speed" [Nissan LEAF Owner's Manual, "Power limitation indicator
  light," Tier 1 (OEM), accessed 2026-07-18]. This is consistent with the DOE AFDC description of the
  power-electronics controller managing motor torque and the thermal-management system holding a proper
  operating-temperature range [DOE AFDC, all-electric, Tier 1, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned` / `not_drivable_needs_tow` / `stranded_now`.
- **Misattribution:** identical *words* to an ICE "no power going uphill" (clogged cat, weak fuel pump,
  bad turbo) — the **only** cheap discriminator in text is `vehicle_powertrain` + a turtle/hybrid icon
  (see §5/§7).

### 3.3 Hybrid-system master warning — "Check Hybrid System" / red triangle (hybrid)
- **Sensory signature:** a dash message ("Check Hybrid System," "Hybrid System Malfunction") and/or a
  **red-triangle** master-warning; the car may **still drive** or may go to §3.2 turtle. Real corpus
  line: "CHECK ENGINE LIGHT ON, message **service high voltage charging system**" [Tekmetric corpus].
  `warning_light_named` = free text ("check hybrid system," "red triangle," "hybrid system," "turtle");
  `warning_light_behavior=steady_on`.
- **Mechanism:** the hybrid master indicator lights when a fault sets in one of the **HV subsystems** —
  the traction battery, power-electronics/inverter, thermal-management (HV coolant), motor-generator(s),
  or DC/DC converter (the HV components enumerated by DOE AFDC [Tier 1, accessed 2026-07-18]). Because
  these are HV-side subsystems distinct from the engine, a hybrid master warning points at **HV-aware
  diagnosis** rather than a generic engine-only code scan — a **routing** distinction, not an HV-repair
  claim.
- **Drivability:** `drivable_but_concerned` (message only) → `not_drivable_needs_tow` (with turtle).
- **Misattribution:** filed by customers as "check engine light" — but a hybrid master warning routes to
  HV-capable diagnosis, not a plain P-code CEL scan (see §8 service proposal).

### 3.4 Regenerative-braking feel change (hybrid & EV)
- **Sensory signature:** brakes feel **grabby / different / "like they let go then grab"**, often worse
  when **cold** or when the battery is **full** (e.g., downhill right after a full charge); `pedal_feel`
  ≈ `grabby` (or customer says "different," which no slot cleanly holds); `weather_condition=cold_weather`
  common; `vehicle_powertrain=hybrid`/`electric` if stated.
- **Mechanism:** when regen is reduced (cold or full battery cannot accept charge), the system blends in
  more **friction** braking, changing pedal travel/deceleration feel until the pack warms [Bosch, regen
  blending, Tier 1; DOE AFDC thermal-management, Tier 1].
- **Drivability:** usually `drivable_but_concerned`.
- **Misattribution:** reported as "warped rotors / bad brakes"; but a **regen/blending** feel change on a
  stated hybrid/EV (temperature-linked, no grinding/squeal) is distinct from friction-brake pulsation
  (see §7).

### 3.5 EVSE / on-board-charging fault (PHEV & BEV) — "won't charge"
- **Sensory signature:** "car **won't charge** / charger won't lock / charging **stopped** / charge-port
  light is red / only charges to X%." No engine, no drivability complaint — a **charging** complaint.
  Today there is **no fact slot and no catalog fit** for this (`charging_starting_testing` is 12 V
  start/charge only).
- **Mechanism:** on-board charger, charge-port/EVSE handshake, HV contactor, or BMS fault [DOE AFDC:
  "an onboard charger converts incoming AC electricity to DC power for battery charging," Tier 1].
- **Drivability:** ranges from `drivable_normally` (still has charge) to `not_drivable_needs_tow` (flat).
- **Routing today:** NO FIT → **advisor** (or the proposed HV-diagnosis service, §8). Many US ICE-focused
  shops decline EV charging work outright; surface to a human, do not force-fit a testing service.
  PROPOSE the thin, advisor-gated subcat `hybrid_or_ev_wont_charge` (§8) as its landing spot IF the HV
  service ships.

### 3.6 HV battery degradation / range or economy loss (hybrid & EV)
- **Sensory signature:** "**range** dropped a lot / **mpg** way down on my hybrid / battery doesn't hold
  a charge like it used to." No acute fault light necessarily; a slow complaint.
- **Mechanism:** gradual traction-pack **capacity fade** (a known aging characteristic of lithium-ion
  traction batteries) and/or cell-block imbalance; range/economy fall over the pack's life [DOE AFDC,
  Tier 1 — lithium-ion traction batteries lose capacity with age/use, accessed 2026-07-18]. No acute
  fault light is required.
- **Routing today:** NO FIT → **advisor / quote** (capacity test is an HV-shop job); PROPOSE the thin,
  advisor-gated subcat `hybrid_or_ev_battery_degradation_range_loss` (§8). `customer_request_type` often
  `second_opinion` or `diagnose_problem`.

---

## 4. Customer-language lexicon (binds synonyms / positives)

Provenance: `tekmetric` = this shop's corpus (near-verbatim OK); `nhtsa` = paraphrased to first person
from ODI complaint patterns (public domain); `forum-paraphrase` = pattern paraphrased (copyright);
`synthetic` = invented (flagged). **Corpus caveat:** direct hybrid/EV utterances in the Tekmetric corpus
are ~1; the elevated `nhtsa`/`forum-paraphrase`/`synthetic` share here is a **data gap**, flagged for
Chris, not a style choice.

**12 V no-power / won't go to READY (§3.1):**
- "my hybrid wont start, all the dash lights come on but it wont go to ready and it wont move" — synthetic
- "pushed the power button and nothing happens, everything lights up inside but the car is dead" — forum-paraphrase — needs-fact:vehicle_powertrain
- "prius wont start this morning, i think its the little 12 volt battery in the back, jumped it and it fired up" — forum-paraphrase — (note: "prius" alone must NOT set powertrain — see §9)
- "my leaf wouldnt power on, had to jump the 12v and then it was fine" — forum-paraphrase

**Reduced power / turtle / limp (§3.2):**
- "driving my electric car and it suddenly lost power, a turtle light came on and it wont go over like 40" — nhtsa
- "car went into reduced power mode on the highway, could barely keep going, had to pull over" — nhtsa
- "my ev is crawling, dashboard shows a turtle icon, feels like theres no power at all" — forum-paraphrase
- "hybrid has no power going up hills all of a sudden and theres a warning light" — synthetic — needs-fact:vehicle_powertrain

**Hybrid master warning (§3.3):**
- "CHECK ENGINE LIGHT ON, message service high voltage charging system" — tekmetric
- "red triangle light came on and it says check hybrid system, is it safe to drive?" — forum-paraphrase
- "big red triangle with an exclamation point lit up on my prius dash" — forum-paraphrase

**Regen brake feel (§3.4):**
- "my hybrid brakes feel weird and grabby especially first thing on a cold morning" — synthetic
- "the brakes on my ev feel different, like they let go for a second then grab, more when its cold out" — forum-paraphrase — needs-fact:vehicle_powertrain

**EVSE / won't charge (§3.5):**
- "my ev wont charge at home anymore, the charger clicks but nothing happens and the port light is red" — nhtsa
- "plug in my plug-in hybrid overnight and it didnt charge, wont lock onto the charger" — forum-paraphrase

**Range / degradation (§3.6):**
- "my hybrid battery isnt holding a charge, gas mileage tanked over the last few months" — forum-paraphrase
- "electric range dropped from 200 to like 130, is the battery going bad?" — nhtsa

**Mixed symptom+request / work-order (route carefully — see null-route in §8):**
- "Previously declined>LUBRICATE AND SERVICE BRAKE CALIPERS REAR AXLE [TESLA]" — **tekmetric** (real
  corpus line, an EV maintenance work-order, NOT a customer concern) → null-route / advisor.
- "hybrid system testing auth 179" — **synthetic** staff-authorization illustration (flagged; NOT a real
  corpus line) → null-route / advisor. (An earlier draft labeled invented staff lines "REPLACE HYBRID
  BATTERY" / "HYBRID SYSTEM TESTING AUTH 179" as `tekmetric`; neither exists in the corpus — corrected.
  The only real hybrid/EV Tekmetric lines are the CEL "service high voltage charging system" concern in
  §3.3 and this Tesla caliper work-order.)

---

## 5. Differential & discriminating questions (binds required_facts + slots)

The spine slot for this entire system is **`vehicle_powertrain`** — one literal fact flips most routes
from an ICE slug to the hybrid/EV path. The second spine is the **kind of no-power** (won't-enter-READY
vs reduced-power-while-moving vs a warning message).

| Confusable pair | ONE best question | Slot + value that decides |
|---|---|---|
| EV/hybrid reduced power (§3.2) vs **ICE** low power (`low_power_or_wont_accelerate_normally`) | "Is the vehicle a **hybrid or fully electric**, and is there a **turtle / reduced-power / hybrid** warning?" | `vehicle_powertrain` = `hybrid`/`electric` (+ `warning_light_named`≈turtle/hybrid) → HV path; `gasoline`/`not_stated` + no HV icon → ICE `low_power_or_wont_accelerate_normally` |
| Hybrid/EV won't-go-to-READY (§3.1) vs **ICE** crank/no-start (`wont_crank_just_clicks`/`no_start_testing`) | "When you press start, does an **engine crank/turn over**, or does the car just **fail to power on / not go to READY** with no cranking?" | `engine_running` = `wont_crank_just_clicks`/`slow_crank`/`wont_start` (ICE) vs `wont_power_on_no_crank` (PROPOSED) / `no_sound_at_all` on a stated hybrid/EV |
| 12 V-aux no-power (§3.1) vs **HV** fault (§3.2/§3.3) on a hybrid | "Did **jump-starting the small 12 V battery** make it start, or is there a **turtle / Check-Hybrid-System / red-triangle** warning?" | `recent_action=jump_started` + it started → 12 V (charging/battery path); `warning_light_named`≈hybrid/turtle + still no power → HV path |
| Regen feel change (§3.4) vs **friction-brake** pulsation (`pulsating_or_vibrating_pedal`) | "Is it a **hybrid/EV** and does the odd feel track with **cold / a full battery** (no grinding/squeal), or is it a **shudder/pulsing** while braking at speed?" | `vehicle_powertrain` set + `weather_condition=cold_weather` + `pedal_feel=grabby` → regen; `pedal_feel=pulsating` + speed → friction brakes |
| EVSE won't-charge (§3.5) vs 12 V charging (`battery_charging_light`/`charging_starting_testing`) | "Is the problem **plugging in / charging the car at a charger**, or the **12 V battery / battery-light** while driving?" | "won't charge / charge port / EVSE" → HV charging (NO FIT → advisor/§8); "battery light / dead 12 V" → `charging_starting_testing` |

**Slot gaps surfaced here (see §9):**
- `vehicle_powertrain` exists (values `hybrid`/`electric`) but is **under-wired**: the ICE low-power /
  no-start / brake questions do not require it, so the mapper can't use it to split HV from ICE. →
  `question.required_facts` guidance (must be resolved against live DB question-ids by Wave C).
- `engine_running` has **no value for "electric/hybrid pressed start, no engine crank, won't power on."**
  → `stage3.slot.value.add engine_running=wont_power_on_no_crank`.
- **No slot** holds "won't charge / charge-port / EVSE state" or "reduced-power/turtle indicator" as a
  first-class fact. Deferred (the ≥3-question rule is unmet until the proposed hybrid/EV subcategories +
  their questions exist); noted as a future slot, not proposed now.

---

## 6. Warning lights & DTC surface

- **Turtle / "reduced power" icon** — a reduced-power indicator used on a number of EVs/hybrids (e.g. the
  Nissan LEAF power-limitation "turtle") [Nissan LEAF Owner's Manual, Tier 1]; **not** universal — many
  Toyota/Lexus hybrids instead surface a red-triangle master warning (below), not a turtle. Customer
  nicknames: "turtle light," "the turtle," "reduced power light," "car with a turtle." →
  `warning_light_named` = "turtle" / "reduced power"; behavior usually `steady_on`.
- **Hybrid master warning / "Check Hybrid System" / red-triangle-with-!** (Toyota/Lexus classic "red
  triangle of death"). Nicknames: "red triangle," "exclamation triangle," "check hybrid system,"
  "hybrid warning." → `warning_light_named` free text; `warning_light_behavior=steady_on` or
  `multiple_lights_at_once` when it cascades.
- **"Service high voltage charging system" / HV-charging message** (seen verbatim in corpus) — HV/charging
  DTC surfaced as a plain-language message, sometimes **alongside** the ordinary CEL. Keep to
  `warning_light_named` free text; do **not** collapse it into the generic check-engine flow (§3.3/§8).
- **READY indicator absent** — not a "warning light" per se but the customer's headline cue for §3.1
  ("won't go to ready"). Holds in `engine_running` (proposed value), not `warning_light_named`.
- **Plug / charging-fault icon** (PHEV/BEV) — "charge port light is red," "plug with a line through it."
  No slot today (§5/§9) → advisor route.
- Not owned here: a plain check-engine light with an ICE driveability symptom on a hybrid routes on the
  **symptom** to the ICE dossiers, not to this one, unless a hybrid/HV message accompanies it.

---

## 7. Confusable neighbors (cross-system)

- **`low_power_or_wont_accelerate_normally` (performance / engine-controls-driveability)** — THE primary
  confusable. Word-for-word identical ("no power, won't accelerate, bogs going uphill"). Discriminator:
  `vehicle_powertrain=hybrid`/`electric` **and/or** a turtle/hybrid warning → HV reduced-power path; a
  gasoline/unstated car with no HV icon stays ICE. Both route to `check_engine_light_testing` at Stage-1,
  so this is a **Stage-2** split (handled by `stage2.description.revise` + negatives on
  `low_power_or_wont_accelerate_normally`), not a Stage-1 hedge.
- **`starting-charging` (`wont_crank_just_clicks` / `slow_crank_sluggish_start` / `no_start_testing`)** —
  an ICE that cranks/clicks vs a hybrid/EV that simply won't power on. Discriminator: is there an
  **engine crank** at all? EVs have none; hybrids enter READY rather than crank. Note the *overlap*: the
  hybrid 12 V-aux fix (§3.1) **is** a charging/battery job — so a stated-hybrid won't-power-on legitimately
  routes to `charging_starting_testing`/`battery_test` (12 V), just via a different subcategory than an
  ICE crank.
- **`check_engine_light` / `multiple_warning_lights_at_once` (warning_light)** — a hybrid master warning
  or "service high voltage charging system" message is filed by customers as a check-engine light, but
  needs HV-capable diagnosis, not a generic P-code scan (§8).
- **`pulsating_or_vibrating_pedal` / `brakes-friction-hydraulic`** — friction-brake pulsation (warped
  rotors, speed-linked shudder, grinding/squeal) vs regen/blending feel change on a stated hybrid/EV
  (temperature-linked, no grind). Discriminator: `vehicle_powertrain` + `weather_condition` + absence of
  noise.
- **`car_died_while_driving_electrical` (electrical)** — an EV that drops to turtle then stops mid-drive
  can look like an electrical stall; discriminator is the **turtle/reduced-power** precursor + `vehicle_powertrain`.
- **`battery_drains_overnight` (electrical)** — a hybrid/EV whose **12 V keeps dying every few days**
  (repeated jumps) is the existing electrical **parasitic-drain / weak-aux** case, NOT a one-off no-start;
  it routes to `battery_drains_overnight` (interim). Discriminator vs §3.1: the **repeat** pattern +
  `recent_action=jump_started`.
- **`surging_or_rpms_going_up_and_down` / engine-noise slugs (performance / noise)** — "my hybrid's engine
  **runs constantly / revs high / is louder than it used to**" is USUALLY **normal** hybrid behavior (the
  ICE cycles on to charge/heat), and when abnormal is an **ICE driveability or exhaust-noise** concern
  owned by the engine/exhaust dossiers — **NOT** an HV-routing win. Do not route it here; left unguarded it
  collides with performance/noise slugs the same way §3.2 collides with ICE low-power.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service (today) | Category | Subcategory slug (today) | Fit |
|---|---|---|---|---|
| 12 V-aux no-power / won't-go-to-READY (§3.1) | charging_starting_testing / battery_test | electrical | `wont_crank_just_clicks` | **weak** — no engine cranks/clicks; slug wording contradicts the symptom → PROPOSE `hybrid_or_ev_wont_power_on` |
| HV reduced power / turtle (§3.2) | check_engine_light_testing | performance | `low_power_or_wont_accelerate_normally` | **weak** — conflates ICE fuel/turbo causes with HV derate; no HV route → PROPOSE `hybrid_or_ev_reduced_power_or_limp_mode` |
| Hybrid master warning / red-triangle (§3.3) | check_engine_light_testing | warning_light | `check_engine_light` / `multiple_warning_lights_at_once` | **weak** — generic CEL scan ≠ HV diagnosis → PROPOSE `hybrid_system_warning_light` |
| Regen brake feel change (§3.4) | brake_inspection | brakes | `pulsating_or_vibrating_pedal` | **weak** — not a friction fault; keep in brakes but add negatives/note |
| EVSE / won't charge (§3.5) | — | electrical | — | **NO FIT** → advisor now; PROPOSE thin subcat `hybrid_or_ev_wont_charge` + Chris-gated `hybrid_ev_high_voltage_testing` service |
| HV battery degradation / range loss (§3.6) | — | performance | — | **NO FIT** → advisor / quote now; PROPOSE thin subcat `hybrid_or_ev_battery_degradation_range_loss` |

**Proposals (all typed in `.proposals.yaml`):**
1. `stage2.subcategory.propose` **performance / `hybrid_or_ev_reduced_power_or_limp_mode`** — reduced
   power / turtle / limp on a stated hybrid/EV.
2. `stage2.subcategory.propose` **electrical / `hybrid_or_ev_wont_power_on`** — won't-go-to-READY / won't
   power on (splits 12 V-aux from HV; the low-cost, rule-out-first case).
3. `stage2.subcategory.propose` **warning_light / `hybrid_system_warning_light`** — Check-Hybrid-System /
   red-triangle / turtle master warning.
4. `stage2.subcategory.propose` **electrical / `hybrid_or_ev_wont_charge`** (THIN, advisor-gated) — EVSE /
   on-board-charge fault (§3.5); the landing spot IF the HV service ships, else advisor.
5. `stage2.subcategory.propose` **performance / `hybrid_or_ev_battery_degradation_range_loss`** (THIN,
   advisor-gated) — traction-pack capacity/range/economy loss (§3.6). (Category placement is best-fit
   among imperfect options — the taxonomy has no economy/range or hybrid/EV category; Chris may prefer a
   dedicated one.)
6. `catalog.service.propose` **`hybrid_ev_high_voltage_testing`** (Chris-gated) — HV-capable diagnosis the
   five subcats route to; **explicitly notes** the shop may decline EV/HV work, in which case these
   subcats route to **advisor**. Demand evidence is thin (§10) — this is a "be-ready" proposal, not a
   "build-now" mandate.

EVSE (§3.5) and degradation (§3.6) remain **advisor** routes until/unless the HV service ships; their thin
subcats (4, 5) give them a Stage-2 home so the §8 "every NO FIT → a proposal" contract is fully met.

---

## 9. Fact-slot audit

**Slots this system uses (of 29):** `vehicle_powertrain` (**spine**), `engine_running`, `warning_light_named`,
`warning_light_behavior`, `lights_state`, `recent_action`, `drivable_state`, `speed_band`, `onset_timing`,
`weather_condition`, `pedal_feel`, `customer_request_type`.

**Values customers actually state (evidence in §4):**
- `vehicle_powertrain`: `hybrid` ("my hybrid," "plug-in hybrid"), `electric` ("my EV," "electric car,"
  "my Leaf/Tesla … electric"). Values already exist — the gap is **wiring** (below), not new values.
- `warning_light_named` (free text): "turtle," "reduced power," "check hybrid system," "red triangle,"
  "service high voltage charging system."
- `engine_running`: today customers' "won't go to ready / won't power on" has **no clean value** →
  `no_sound_at_all` is the least-wrong fallback.
- `recent_action`: `jump_started` ("jumped the 12 V and it started") — the key 12 V-vs-HV discriminator.
- `pedal_feel`: `grabby` (regen feel); `weather_condition=cold_weather` co-occurs.

**Missing / proposed:**
1. **`engine_running` value `wont_power_on_no_crank`** (`stage3.slot.value.add`). Literal cues only:
   "won't go to ready," "won't power on," "pushed the button and nothing," "everything lights up but it
   won't start / won't go." Distinct from `wont_crank_just_clicks` (which asserts a crank/click that an
   EV cannot make) and from `no_sound_at_all` (which under-describes a dash that *does* light up).
2. **`vehicle_powertrain` LITERALNESS tension (rule proposal, not a value add).** The slot rule says
   "DO NOT infer from year/make/model," yet a very common customer phrasing is a **model name**
   ("Prius," "Leaf," "Tesla," "Volt") with no explicit "hybrid"/"electric" word. Under the current rule
   these must **NOT** set the slot — so a bare "my Prius won't start" leaves `vehicle_powertrain=null` and
   the HV route can't fire. Two options for Chris (surfaced, not decided): (a) a curated allowlist of
   **single-powertrain** models (Prius→hybrid, Leaf/Bolt/Model 3→electric) that MAY set the slot; or (b)
   keep the rule and rely on explicit "hybrid"/"electric" mentions + the Stage-2 description/negatives and
   the Stage-1 hedge. **This dossier's golden cases + lexicon respect option (b)** — every model-name-only
   line (Prius, Leaf) routes to the interim ICE slug with `vehicle_powertrain=null`, and the Prius no-start
   is an inference-trap where the slot stays null.
3. **Deferred slots (do not propose yet — ≥3-question rule unmet):** an `hv_system_state`
   (ready/reduced-power/turtle/hv-warning) and an `ev_charging_state` (won't-charge/port-fault/charge-limit)
   would each need ≥3 questions, which only exist once the proposed subcategories are built. Logged as
   future slots so Wave C revisits them when the subcats ship.

**Question `required_facts` wiring (guidance — IDs must be resolved against the live DB).** The live
Supabase project requires interactive OAuth, unavailable in this run, so exact `concern_questions.id`
values could not be pulled. Wave C should: (a) on `low_power_or_wont_accelerate_normally` questions that
ask "gas or diesel / what kind of vehicle," set `required_facts=[vehicle_powertrain]` (`skip_class: SAFE`);
(b) on the proposed hybrid/EV subcategories' questions, tag `vehicle_powertrain` + `warning_light_named` +
`engine_running`/`drivable_state` as `required_facts` so a fact-rich hybrid/EV description skips the
obvious re-asks. No numeric-id `question.required_facts.set` ops are emitted here to avoid guessing IDs
(never-guess rule).

---

## 10. Sources

**Diagnostic authority (Tier 1/2):**
- US DOE Alternative Fuels Data Center (AFDC), "How Hybrid Electric Vehicles Work" — Tier 1 (US
  government). Regenerative-braking energy recovery; HV traction battery + motor + controller; the 12 V
  auxiliary battery "provides electricity to start the car before the traction battery is engaged";
  DC/DC converter. https://afdc.energy.gov/vehicles/how-do-hybrid-electric-cars-work — accessed 2026-07-18.
- US DOE AFDC, "How All-Electric Vehicles Work" — Tier 1 (US government). Power-electronics controller
  "manages the flow of electrical energy … controlling the speed of the electric traction motor and the
  torque it produces"; thermal-management "maintains a proper operating temperature range of the …
  electric motor, power electronics"; on-board charger AC→DC; DC/DC converter for accessories.
  https://afdc.energy.gov/vehicles/how-do-all-electric-cars-work — accessed 2026-07-18.
- Bosch Mobility, "Regenerative Braking Systems" — Tier 1 (OEM braking supplier). Motor→generator mode
  during braking; "when more braking torque is required than the generator alone can provide, additional
  braking is accomplished by friction brakes" (regen/friction blending → feel change when regen is
  limited). https://www.bosch-mobility.com/en/solutions/driving-safety/regenerative-braking-systems/ —
  accessed 2026-07-18.
- SAE J1715, "Hybrid Electric Vehicle (HEV) and Electric Vehicle (EV) Terminology" — Tier 1 (SAE
  standard). Used here ONLY for standardized HEV/PHEV/EV terminology.
  https://www.sae.org/standards/content/j1715_202105/ — accessed 2026-07-18. NOTE: the orange-HV-cable /
  manual-service-disconnect marking referenced in the safety frame is an established industry **convention**
  associated with HV-wiring / EV electrical-safety standards (e.g. SAE J1673, ISO 6469) — NOT J1715, and
  stated as convention rather than a verified clause. (Earlier draft misattributed the orange-cable
  convention to J1715; corrected. No ASE-xEV PDF was machine-readable this run, so none is cited.)
- Nissan LEAF Owner's Manual, "Power limitation indicator light" — Tier 1 (OEM owner information).
  Literally documents the reduced-power ("turtle") derate (§3.2/§6): the indicator illuminates "when the
  Li-ion battery available charge is extremely low," "when the Li-ion battery temperature is very low," or
  "when the temperature of the electric vehicle system is high (motor, inverter, coolant system, Li-ion
  battery etc.)," and in that mode "the power provided to the traction motor is reduced … Power limitation
  mode results in reduced power and vehicle speed."
  https://www.nissan.co.uk/owners/car-repair/car-owner-manual/manuals/iom/leaf/0ze1/e0/2023/power-limitation-indicator-light-1.shtml
  — accessed 2026-07-18.

**Linguistic authority (customer voice — never cited for diagnosis):**
- Tekmetric corpus `scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json` — one hybrid HV
  line ("message service high voltage charging system") + a Tesla brake-caliper maintenance work-order;
  **zero BEV concerns**. Provenance `tekmetric`. This near-absence is the §-flagged data gap.
- NHTSA ODI complaint-narrative **patterns** for EV/hybrid turtle/reduced-power/no-charge (public
  domain), paraphrased to first person — provenance `nhtsa`.
- Forum/Reddit **patterns** (Prius/Leaf/Tesla owner communities) paraphrased, never verbatim — provenance
  `forum-paraphrase`.
- Synthetic phrasings flagged `synthetic`. **Elevated share acknowledged** (corpus gap); backlog: collect
  real hybrid/EV concern text before treating these examples as settled.

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode has a Tier 1/2 diagnostic cite (DOE AFDC ×2, Bosch, **Nissan LEAF OM** for
  the §3.2 turtle/reduced-power derate). No claim rests on memory. The §3.1 "check the 12 V first" guidance
  is grounded in the DOE AFDC **mechanism** (the 12 V aux wakes the contactor electronics before the HV
  pack engages) and cost ordering — **no** "#1 cause", "most common", "almost always", or "$180" frequency/
  price claim remains (all removed).
- [x] Every §4 lexicon entry carries provenance; synthetic is flagged. **No `tekmetric` label on any line
  that is not in the corpus** — the only real hybrid/EV corpus lines are the §3.3 CEL "service high voltage
  charging system" concern and the Tesla brake-caliper work-order; the two invented staff lines were
  relabeled `synthetic` / replaced with the real Tesla line. **Deviation acknowledged:** synthetic/forum/
  nhtsa share exceeds the ~30% cap because the corpus has ~1 hybrid line — a data-gap backlog item, not hidden.
- [x] Every §8 row maps mode → service → category → slug with a fit verdict; every **NO FIT / weak** becomes
  a typed subcategory or catalog proposal — including thin, advisor-gated subcats for EVSE (§3.5) and
  degradation (§3.6) so each NO-FIT mode has a Stage-2 landing spot.
- [x] Both mandated confusable pairs addressed: **EV reduced-power vs ICE low-power** is a **Stage-2**
  disambiguation inside `check_engine_light_testing` (handled by `stage2.description.revise` +
  `stage2.example.negative.add`, NOT a Stage-1 hedge — the earlier `stage1.hedge` used an invalid
  subcategory as a Stage-1 key and was removed); **hybrid no-start 12 V vs HV** is a real Stage-1 service
  collision addressed by `stage1.hedge.add` (`charging_starting_testing` ↔ `check_engine_light_testing`,
  discriminating on `recent_action`/`warning_light_named`).
- [x] Fact-cue literalness respected — "my Prius won't start" does **NOT** set `vehicle_powertrain` (model
  ≠ literal powertrain), does **NOT** set `engine_running=wont_power_on_no_crank` (no press-start/no-crank
  stated), does **NOT** route to a stated-hybrid-only proposed slug (it uses the interim existing
  `wont_crank_just_clicks`), and does **NOT** assert the HV battery. Model-name-only 12 V-jump lines all
  route identically to the interim ICE slug; **stated** hybrid/EV lines route to the proposed slugs.
- [x] All Stage-1 keyword proposals are ≥2 tokens or domain tokens ("turtle mode," "check hybrid system,"
  "won't go to ready," "12 volt battery"); the OEM-voice "auxiliary battery" keyword was dropped. Every
  negative example names `routes_to` and uses the `propose:` prefix for not-yet-shipped slugs.
- [x] No `stage3.slot.propose` emitted (≥3-question rule unmet for a catalog-gap system); the additive
  `engine_running` value + deferred-slot notes are used instead. Question-`required_facts` numeric IDs are
  intentionally **not** guessed (DB was inaccessible) — wiring guidance is descriptive for Wave C.
- [x] ≥8 golden cases incl. 1 inference-trap + 1 null-route (work-order) + 1 ICE-control case — in
  `.proposals.yaml`.
- [x] SAFETY: routing-only throughout; no HV DIY instruction anywhere; ambiguous/HV-repair cases route to
  advisor.
