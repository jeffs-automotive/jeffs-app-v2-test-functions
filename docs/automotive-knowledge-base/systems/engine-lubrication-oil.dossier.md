# Engine lubrication / oil system & oil leaks — diagnostic dossier
slug: engine-lubrication-oil   date: 2026-07-18   binds_services: [oil_leak_testing, oil_pressure_light_testing, check_engine_light_testing, exhaust_system_testing, coolant_leak_testing]   binds_categories: [leak, warning_light, smell, smoke]

> Scope note for the reader: the scheduler taxonomy is **symptom-organized, not system-organized**. This
> one physical system (the engine oiling circuit + its external seals) scatters across FOUR concern
> categories we can bind today: a puddle is `leak/`, the dash light is `warning_light/`, the odor is
> `smell/`, and the haze is `smoke/`. Oil-starvation **noise** (a knock/tick led with sound) is *also* a
> symptom of this system, but the `noise/` subcategories are NOT reachable from either oil service at
> Stage 2 (neither `oil_pressure_light_testing` nor `oil_leak_testing` carries `noise` in its
> `concern_categories`) — so that path is a **catalog gap**, tracked as a Chris-gated proposal in §8, not
> a live binding. The value of this dossier is the crosswalk that routes
> any oil utterance to the right symptom slug — and, crucially, keeps a routine **oil-change request**
> (maintenance) OUT of the oil-**leak** diagnostic service.

---

## 1. Scope & boundaries

**In scope** — the engine lubrication circuit and everything that leaks, burns, smells, or warns from it:
- External oil leaks: valve-cover gaskets, oil-pan gasket / drain plug, front timing-cover / crank seal,
  rear main seal, oil-filter housing / oil-cooler gaskets, oil-pressure-sensor seal, cam/camshaft-position
  sensor O-rings.
- Oil consumption / burning: worn valve-stem seals, worn piston rings / cylinder walls, PCV faults, failing
  turbo seals (blue-gray tailpipe smoke, adding oil between changes).
- Oil on hot exhaust → burnt-oil smell + thin under-hood smoke (no ground puddle required).
- Oil-pressure warning: low level (leak/burn), failing oil pump, clogged pickup screen, worn bearings →
  the red oil-can-with-drip light, lifter tick, or rod knock.

**Out of scope** (route to the named neighbor slug/dossier):
- **Coolant** puddle / sweet smell / white tailpipe smoke / overheating → `coolant_leak_testing`
  (`green_orange_yellow_or_pink_puddle_coolant`, `white_smoke_from_tailpipe`, `sweet_smell_maple_syrup_antifreeze`).
- **Transmission / power-steering** red fluid → `red_or_pink_puddle_transmission_or_power_steering`.
- **Gear / differential** oil (thick, sulfur, near an axle) → `thick_dark_brown_puddle_gear_or_differential_oil`.
- **Exhaust** manifold-gasket tick / louder exhaust / cabin fumes → `exhaust_system_testing`
  (`exhaust_manifold_tick_or_puff`, `exhaust_fumes_inside_the_cabin`). The confusable is oil-**on** the
  manifold (ours) vs an exhaust **breach** at the manifold (theirs) — §7.
- **Black** tailpipe smoke (rich fuel, gasoline smell) → `check_engine_light_testing` / `black_smoke_from_tailpipe`.
- **SERVICE DUE / maintenance-required** oil-change reminder (a service interval, NOT a damage warning) →
  `service_engine_soon_or_maintenance_required_light`; a routine oil-change **request** → advisor/booking
  (null concern), not `oil_leak_testing`.
- **Hot-brake / dragging-caliper** burning smell from a wheel → `burning_rubber_hot_brake_smell` /
  `smoke_or_burning_smell_from_a_wheel`.

---

## 2. System primer (expert, cited)

The engine lubrication system is a pressurized recirculating circuit. Oil is drawn from the sump (oil pan)
through a **pickup screen** by a positive-displacement **oil pump** (gerotor or crescent-gear, crank- or
cam-driven), forced through the **oil filter**, then up galleries drilled in the block to the crankshaft
main and rod bearings, camshaft(s), lifters/lash adjusters, and (on many engines) the timing chain
tensioner and turbo. A **pressure-relief valve** caps peak pressure; oil drains back to the pan by gravity.
The dash **oil-pressure light** is driven by a simple pressure *switch* (on/off at a threshold, typically
~4–7 psi) — it warns of pressure loss, NOT low level directly, and it is NOT a gauge of oil quantity
[Halderman, *Automotive Technology* (Engine Oiling/Lubrication Systems), Tier 2, accessed 2026-07-18;
Bosch *Automotive Handbook* (engine lubrication), Tier 2].

The circuit is sealed to the outside world by **gaskets** (valve cover, oil pan, timing cover, filter
housing) and **radial lip seals** (front crank, rear main, cam). These are the leak points. Gasket
materials have shifted from cork/rubber to molded silicone and rubber-coated steel; the common failure is
age/heat hardening and, on many modern engines, a plastic valve-cover warping [Halderman, *Automotive
Technology* (gasket & seal materials / oil-leak diagnosis), Tier 2, accessed 2026-07-18; corroborated by
Fel-Pro gasket technical training (free parts-manufacturer material), Tier 2].

**Notable architecture variants that change the customer story:**
- **Wet-sump vs dry-sump** — nearly all of Jeff's US fleet is wet-sump; dry-sump is exotic, ignore.
- **Cartridge vs spin-on filter** — cartridge housings (common on modern Euro + many domestic) are a
  frequent leak/over-torque source, and a cracked plastic housing can weep onto the exhaust
  (corpus tkc-244: "oil filter housing is leaking oil onto the exhaust").
- **Turbocharged** engines add turbo center-seal oil leaks → blue smoke + oil consumption; a whistling
  turbo with blue smoke is a distinct signature [Halderman, Tier 2; corroborated by search consensus
  2026-07-18].
- **Oil-life-monitor cars** display "SERVICE DUE / OIL LIFE 5%" — a *maintenance* reminder that customers
  routinely confuse with the red oil-pressure light. Different icon, different urgency (§6).

---

## 3. Failure-mode catalog (the diagnostic spine)

Sensory signatures given in fact-slot vocabulary. Every mode cites Tier 1/2.

### 3.1 Valve-cover gasket leak → burnt-oil smell + under-hood smoke (often NO ground puddle)
- Signature: `smell_descriptor=burnt_oil`, `sound_or_smoke_location_zone=under_hood`, optionally
  `smoke_color=blue_or_gray`/`visible_but_color_unclear`; `onset_timing=after_warming_up` (smell/smoke
  appear once hot, strongest at a stoplight or right after shutdown).
- Mechanism: the valve cover sits high on the engine; a leak runs DOWN onto the hot exhaust manifold/up-pipe
  and sizzles off — so the customer smells/sees smoke but frequently finds **little or nothing on the
  ground**. Oil in the spark-plug tube seals can cause misfires [Halderman, *Automotive Technology*
  (oil-leak diagnosis; valve-cover & spark-plug-tube seals), Tier 2, accessed 2026-07-18].
- Drivability: `drivable_but_concerned` (fire risk if severe, but usually a slow burn).
- Misattribution: customers call this "burning smell, might be electrical" or fear the car is "about to
  catch fire"; some assume it's the exhaust. It is oil on hot metal.

### 3.2 Oil-pan gasket / drain-plug / rear-main leak → puddle under front-to-middle
- Signature: `fluid_color=brown_or_black`, `fluid_under_car_location=under_engine_front` (pan/timing) or
  `under_middle` (rear main / bell-housing area); slick/greasy, petroleum smell.
- Mechanism: gravity leaks pool low. A stripped/loose **drain plug** or a double-gasketed filter after a
  sloppy oil change dumps fast (corpus tkc-070 "severe potential drain plug?"). A **rear main seal** weeps
  where "engine and transmission bolt up" and can soak the underbody front-to-back (forum: "constantly
  drips oil… where they bolt up… soaked from front to back") — this is the one most often mistaken for a
  transmission leak [Halderman, *Automotive Technology* (oil-leak diagnosis; rear-main-seal vs
  transmission-leak discrimination), Tier 2, accessed 2026-07-18].
- Drivability: `drivable_but_concerned`; `not_drivable_needs_tow` only if it dumps and the light comes on.
- Misattribution: rear-main → "transmission is leaking"; front timing-cover seep → "water pump" (that's
  coolant). Color + smell + location disambiguate (§7).

### 3.3 Oil-filter-housing / oil-cooler gasket leak → oil onto exhaust, possible oil/coolant intermix
- Signature: `fluid_under_car_location=under_engine_front`/`under_passenger_side`, `smell_descriptor=burnt_oil`
  if it hits the manifold; on integrated oil-cooler designs, oil and coolant can intermix internally.
- Mechanism: plastic cartridge housings crack/warp; the gasket weeps. Common on modern engines
  (corpus tkc-244) [Halderman, *Automotive Technology* (oil-filter-housing / oil-cooler gasket leaks),
  Tier 2, accessed 2026-07-18].
- Drivability: `drivable_but_concerned`. Misattribution: intermix reads as a coolant problem → still start
  at oil_leak_testing when the customer LEADS with oil.

### 3.4 Oil consumption — worn valve-stem seals (STARTUP blue smoke)
- Signature: `smoke_color=blue_or_gray`, `onset_timing=cold_start`/`at_startup`, smell `burnt_oil`, oil
  added between changes; smoke puffs on start then **clears within a minute or two**.
- Mechanism: oil seeps past hardened valve-stem seals while parked and pools on the valves; it burns off on
  the first combustion cycles [Halderman engine repair (oil burning), Tier 2; valve-seal-vs-ring signature
  is textbook/SAE-standard, corroborated by search consensus 2026-07-18].
- Drivability: `drivable_normally`→`drivable_but_concerned`. Misattribution: "my exhaust smokes on
  startup" (thinks exhaust); it's the top end.

### 3.5 Oil consumption — worn piston rings / cylinder walls (LOAD blue smoke)
- Signature: `smoke_color=blue_or_gray`, `onset_timing=when_accelerating` (or `always` when severe),
  adding oil, possible low power. Continuous blue haze under load.
- Mechanism: worn compression/oil-control rings let oil into the chamber every stroke; confirmed by a
  wet-vs-dry compression test [Halderman engine repair, Tier 2; corroborated by search consensus
  2026-07-18].
- Drivability: `drivable_but_concerned`. Misattribution: "burning oil AND check-engine light" — routes to
  `check_engine_light_testing` (owns blue/gray smoke per taxonomy §5.4), NOT oil_leak_testing.

### 3.6 Failing turbo center seal → blue smoke + oil use + whistle
- Signature: `smoke_color=blue_or_gray`, `vehicle_powertrain=turbocharged`, `noise_descriptor=whining`
  (turbo whistle), adding oil.
- Mechanism: worn turbo shaft seals pass oil into intake/exhaust [Halderman forced-induction, Tier 2].
- Drivability: `drivable_but_concerned`. Misattribution: belt/PS whine.

### 3.7 Loss of oil pressure — low level (leak or burn)
- Signature: `warning_light_named="oil pressure"`, `warning_light_behavior=steady_on` (severe) or
  `comes_and_goes` (flickers at idle / when RPM drops at stops), often `after_warming_up`; may hear
  `noise_descriptor=ticking_or_tapping` (starved lifters) → `knocking_deep` (rod knock) as it worsens.
- Mechanism: not enough oil to maintain the film; thin hot oil at idle drops below the switch threshold
  first, so flicker-at-idle-when-warm is the classic early warning (forum: "oil light comes on at idle,
  goes out when accelerating, only after warm") [Halderman lubrication + oil-pressure diagnosis, Tier 2;
  Bosch handbook, Tier 2, accessed 2026-07-18].
- Drivability: **`not_drivable_needs_tow`** if steady-on — continuing to drive can seize the engine within
  minutes. This is the highest-severity item in this dossier.
- Misattribution: "SERVICE DUE / oil-change light" (a maintenance reminder) — completely different (§6).

### 3.8 Oil pump / pickup / bearing wear → oil pressure light + noise
- Signature: as 3.7 but with adequate oil level; `noise_descriptor=knocking_deep` or `ticking_or_tapping`.
- Mechanism: failing pump, clogged pickup screen (sludge), or worn bearings drop pressure even at full
  level [Halderman, Tier 2].
- Drivability: `not_drivable_needs_tow`. Misattribution: customer led with a **knock** → that's
  `deep_knocking_from_the_engine`; led with the **light** → `oil_pressure_light` (§7).

### 3.9 Oil-pressure SENSOR / SWITCH failure → false oil light with NORMAL pressure
- Signature: `warning_light_named="oil pressure"`, `warning_light_behavior=steady_on` or `comes_and_goes`,
  but with a **healthy oil level and no engine noise** — the light is lying. Often intermittent, sometimes
  triggered by an over-torqued or leaking sensor (which can ALSO weep oil, §3.1-style).
- Mechanism: the pressure switch/sender (or its wiring/connector/ground) fails and reports low pressure
  when the mechanical pressure is fine. This is the failure the DTC surface below (P0520-P0523) actually
  describes — a *circuit/performance* fault of the sensing element, not a lubrication fault
  [Halderman, *Automotive Technology* (oil-pressure warning-circuit diagnosis), Tier 2; SAE J2012 P0520-
  P0523 circuit definitions, Tier 1, accessed 2026-07-18].
- Drivability: **treat as `not_drivable_needs_tow` until verified** — the customer cannot tell a lying
  sensor from real pressure loss (§3.7), so the safe default is "stop and get it checked." Confirmed only
  by a mechanical oil-pressure test (exactly what `oil_pressure_light_testing` performs).
- Misattribution: customers assume the worst ("engine's shot") OR dismiss it ("sensor's just bad") — both
  unsafe to assume. Bind: `oil_pressure_light` (same subcategory as 3.7/3.8; the mechanical test
  disambiguates real vs false).

### 3.10 PCV system failure → crankcase pressure drives seal leaks + oil consumption
- Signature: no single dash cue; presents as a **combination** — fresh external leaks at multiple seals
  (`fluid_color=brown_or_black`, valve-cover/rear-main), OR blue-smoke oil consumption
  (`smoke_color=blue_or_gray`) as oil is pulled into the intake, sometimes a whistle/whistling from a stuck
  PCV valve.
- Mechanism: a clogged/stuck PCV valve or blocked breather lets crankcase pressure build; the pressure
  pushes oil past otherwise-serviceable seals (a "why does it leak from everywhere at once" complaint) and
  can draw oil vapor into the intake to burn [Halderman, *Automotive Technology* (PCV system / crankcase
  ventilation and its effect on seals & oil consumption), Tier 2, accessed 2026-07-18].
- Drivability: `drivable_but_concerned`. Misattribution: customer reports "it started leaking from three
  places at once after nothing for years" — the shared cause (crankcase pressure) is invisible to them.
  Bind: routes by whichever symptom the customer LEADS with — puddle → `brown_or_black_puddle_engine_oil`;
  blue smoke → `blue_or_gray_smoke_from_tailpipe`; under-hood smoke/smell → `smoke_from_under_the_hood` /
  `burnt_oil_smell`.

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Source order per policy: Tekmetric corpus first, NHTSA/forum second (paraphrased), synthetic last (flagged).
Full machine form in `engine-lubrication-oil.lexicon.yaml`. Highlights:

**Oil puddle (`brown_or_black_puddle_engine_oil`)** — corpus is terse and mixes symptom+request:
- "oil leaking. severe potential drain plug?" (tekmetric tkc-070) — unambiguous.
- "Find and fix oil leak" / "under vehicle leak" (tekmetric tkc-243, tkc-061) — request+symptom; tkc-061
  is vague ("leak") → `needs-fact:fluid_color`.
- "Dark brown puddle under my engine when I park" / "black oily stain on my driveway in the morning" (DB
  positives — keep).
- forum-paraphrase: "oil dripping off a plastic cover near the front, three-to-four-inch spots on the
  driveway"; "constantly drips oil from the bottom where the engine and transmission bolt up, underneath is
  soaked front to back."
- Misspelling/slang forms to add: "oil leek", "oyl leak", "leaking oil bad", "puddle of oil under the
  motor".

**Oil pressure light (`oil_pressure_light`)** — customers describe the ICON, not the words:
- "oil light came on when driving to shop, check oil level" (tekmetric tkc-039).
- "AFTER VEHICLE IS WARMED UP AND SITTING AT IDLE (Low engine oil pressure light comes on)" (tekmetric
  tkc-283, all-caps Tekmetric style) — `after_warming_up` + `when_idling`.
- forum-paraphrase: "oil light comes on at idle and goes out when I speed up, only after it's warm";
  "oil pressure light flickers when the RPMs drop at a stoplight."
- Icon nicknames to add: "genie lamp light", "Aladdin lamp light", "oil can with a drip", "red teapot
  light" (common misread).

**Burnt-oil smell (`burnt_oil_smell`)**:
- NOTE: the corpus has NO clean burnt-oil-smell line — `tkc-049` ("Selected special for synthetic oil
  change, 23 point inspection, and tire rotation… left side tire pressure readings…") is an oil-change +
  TPMS work-order whose consensus label is `multiple_symptoms_not_sure_what_category`; it contains **no
  burnt-oil-smell language** and does NOT belong here. Real burnt-oil voice therefore comes from the
  existing DB `positive_examples` (already enrichment — not re-added as new evidence) plus forum-paraphrase.
- DB `positive_examples` already cover this subcategory well ("Burning oil smell after I drive, especially
  in parking lots"; "I keep smelling oil burning — like a drip on the exhaust manifold").
- forum-paraphrase (new voice): "burning oil smell every time i get out of the car, like somethings cooking
  on the engine"; "smell burnt oil when i stop at lights, worse in the summer."

**Blue smoke (`blue_or_gray_smoke_from_tailpipe`)**:
- "puff of blue smoke out the tailpipe when i first start it in the morning, smells like burning oil. been
  adding a quart every few weeks too" (eval check_engine_light_testing-005) — the canonical startup-seal case.
- The LOAD/ring signature ("blue-gray smoke every time I floor it") is already a DB `positive_example` for
  this subcategory, so it is NOT re-added as new evidence — the marginal value is the startup-vs-load
  discriminator captured in §5, not another near-duplicate example.

**Smoke under hood (`smoke_from_under_the_hood`)**:
- "I see smoke around the engine and it smells like burning oil" (DB positive — keep).
- forum-paraphrase: "oil leaking up higher, pooling right under the exhaust manifold at the back of the
  engine, wisps of smoke at idle."

**Maintenance / null (must NOT hit oil_leak_testing)** — very high frequency in the corpus. Exact corpus
texts (verified against `real-concerns-tekmetric-labeled-v2.json`):
- "Inspection and Oil Change" (tkc-054), "Inspection, emission and oil change 15 off web coup" (tkc-285),
  "I am in need of an oil change." (tkc-246), "RESET OIL MAINT LIGHT (Not due yet)" (tkc-011). These are
  `customer_request_type=routine_maintenance` — NOT an oil-leak concern.

Lexicon binds: see §8 for the exact `stage2.example.*` and `stage1.keyword.add` ops.

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: confusable pair → the ONE best discriminating question → the fact slot + value that resolves it.

| Confusion | Discriminating question | Slot → value that decides |
|---|---|---|
| Oil puddle vs **coolant** puddle | "What color is the puddle, and does it smell sweet or like petroleum?" | `fluid_color` = brown_or_black (oil) vs green_or_orange_or_yellow_or_pink (coolant); `smell_descriptor` = burnt_oil vs sweet_or_maple_syrup |
| Oil puddle vs **transmission** (rear-main confusion) | "Is the fluid dark brown/black or bright red, and is it toward the front or the middle?" | `fluid_color` brown_or_black vs red_or_pink; `fluid_under_car_location` under_engine_front vs under_middle |
| Oil puddle vs **gear/diff** oil | "Is it near an axle and does it smell like rotten eggs / sulfur?" | `fluid_under_car_location` under_rear + `smell_descriptor` rotten_egg_or_sulfur → gear oil, not engine oil |
| Oil puddle vs **brake fluid** (⚠ amber/light-brown collision, SAFETY) | "Is the drip near a WHEEL / behind a tire, and has the brake pedal gone soft or low?" | `fluid_under_car_location` near a wheel + `pedal_feel` soft/sinking → `clear_yellow_or_light_brown_puddle_brake_fluid` (brake fluid — SAFETY), NOT engine oil. "Amber/light-brown" ALONE does not decide: fresh clean oil and brake fluid are both amber, so amber is `needs-fact:fluid_under_car_location`+`pedal_feel`, never a confident `fluid_color=brown_or_black` |
| Burnt-oil smell vs **hot-brake/rubber** smell | "Is the smell from under the hood or from a wheel?" | `sound_or_smoke_location_zone` under_hood (oil) vs from_a_wheel (brake); `smell_descriptor` burnt_oil vs burning_rubber_or_hot_brakes |
| Burnt-oil smell vs **electrical/plastic** smell | "Is it greasy/petroleum, or sharp and acrid like burning plastic?" | `smell_descriptor` burnt_oil vs burning_electrical_or_plastic |
| **Blue** smoke (oil) vs **white** smoke (coolant) vs **black** (fuel) | "What color, and does it smell oily, sweet, or like raw gas?" | `smoke_color` blue_or_gray vs white vs black; `smell_descriptor` burnt_oil vs sweet vs gasoline_or_fuel |
| Blue smoke: **valve seals** vs **rings** | "Does it puff only on cold startup and clear up, or when you accelerate/under load?" | `onset_timing` cold_start (seals) vs when_accelerating (rings) |
| Oil-**on-manifold** smoke vs **exhaust breach** | "Do you smell burning oil / see oil residue, or is the exhaust louder with a ticking?" | `smell_descriptor` burnt_oil + oil residue (ours) vs `noise_descriptor` ticking_or_tapping + louder exhaust (exhaust_system_testing) |
| Oil-pressure light vs **oil-change reminder** | "Is it a red oil-can-with-a-drip that came on while driving, or a SERVICE DUE / oil-life message?" | `warning_light_named` "oil pressure" + `warning_light_behavior` steady_on (damage) vs "service"/"maintenance required" (reminder → service_engine_soon slug) |
| Oil-pressure light: **severe** vs **early flicker** | "Is it steady-on, or does it flicker at idle/when you slow down and go off when you drive?" | `warning_light_behavior` steady_on (tow) vs comes_and_goes (early low pressure) |
| Oil-pressure **light** vs engine **knock** lead | "Did you notice the LIGHT first, or a knocking/ticking NOISE first?" | led with light → oil_pressure_light; led with `noise_descriptor` knocking_deep → deep_knocking_from_the_engine |

**Slot-gap flagged:** the recurring cue **"have you been adding oil between changes / is the dipstick low?"**
(asked in blue-smoke q291, oil-puddle q327, dipstick q393, oil-light q394) discriminates a slow leak/burn
from an incidental drip AND grades severity — but no current slot can hold it. The committed binding maps
(`binding/required-facts-map.q1/q2/q3.md`) class each of these questions **NEVER / no-slot TODAY** for
exactly this reason ("Oil-consumption history; no slot"; "Consumable-level check; no slot — see fluid_level
finding"; "Inspection prompt"). → **new slot proposal `oil_consumption_state`** (§9, ≥3-question rule
satisfied: 4 questions) is the reconciliation; the corresponding `required_facts.set` ops in proposals are
**explicitly conditional on that slot being adopted**, with `fallback: intentionally_empty` if Chris
rejects it (so the two committed artifacts never silently disagree).
Note the burnt-smell **q236** ("oil light OR topping off oil?") is deliberately NOT included: it is a
compound OR whose oil-light half is unmodeled here, so it stays **always-ask** (binding map: PARTIAL,
"unsafe") — adopting `oil_consumption_state` does not make it skippable.

---

## 6. Warning lights & DTC surface

- **Red oil-can with a single drip** (the "genie lamp" / "Aladdin lamp") — the oil-**pressure** warning.
  Solid = lost pressure NOW, stop driving; flicker at idle/when-warm = early low pressure. Customer names:
  "oil light", "oil can light", "genie lamp light", "red teapot light" (misread), "oil drop icon".
  Feeds `warning_light_named="oil pressure"`, `warning_light_behavior` steady_on / comes_and_goes.
- **SERVICE DUE / OIL LIFE % / MAINT REQD** — a *maintenance* reminder (oil-life monitor), NOT this
  system's damage light. Routes to `service_engine_soon_or_maintenance_required_light`. Corpus "RESET OIL
  MAINT LIGHT (Not due yet)" (tkc-011) is this, not oil pressure.
- **Check-engine (MIL)** — oil burning (rings/seals) can set catalyst/misfire codes and illuminate the
  CEL; when the customer leads with the CEL + blue smoke, taxonomy routes to `check_engine_light_testing`.
- DTC surface (for advisor context, not customer-facing): P0520-P0524 (oil-pressure sensor/switch
  circuit/performance), P052x low/high pressure; P0011/P0014 + oil-pressure-fed VVT codes when pressure is
  low [SAE J2012 DTC definitions, Tier 1, accessed 2026-07-18].

Binds: `stage3.slot.value` confirmations for `warning_light_named` ("oil pressure") and the icon-nickname
synonyms in §8.

---

## 7. Confusable neighbors (cross-system)

1. **coolant_leak_testing** — WHITE tailpipe smoke, sweet smell, bright green/orange puddle, overheating.
   Discriminator: `smoke_color`/`fluid_color`/`smell_descriptor`. Cross-ref dossier `coolant-cooling`.
2. **check_engine_light_testing** — owns BLUE/GRAY tailpipe smoke (oil burn) per taxonomy §5.4 and BLACK
   smoke (fuel). Our `blue_or_gray_smoke_from_tailpipe` slug lives under `smoke/` but the STAGE-1 service
   for tailpipe oil-burn is check_engine_light_testing. Cross-ref `engine-performance-driveability`.
3. **exhaust_system_testing** — manifold-gasket TICK (quiets when warm), louder exhaust, cabin fumes.
   Discriminator: `noise_descriptor=ticking_or_tapping` + louder exhaust vs our `smell_descriptor=burnt_oil`
   + oil residue. Cross-ref `exhaust-emissions`.
4. **transmission / power-steering leak** — red fluid, under_middle. Discriminator: `fluid_color` red_or_pink.
5. **burning_rubber_hot_brake_smell / smoke_or_burning_smell_from_a_wheel** — from_a_wheel, rubbery.
   Discriminator: `sound_or_smoke_location_zone=from_a_wheel` + `parking_brake_state`.
6. **clear_yellow_or_light_brown_puddle_brake_fluid** (⚠ SAFETY) — the **amber/light-brown collision**:
   fresh clean engine oil and brake fluid are both amber, and the DB already carries "Amber-colored drips…"
   as a brake-fluid positive. Discriminator: `fluid_under_car_location` near a WHEEL/behind a tire +
   `pedal_feel` soft/sinking → brake fluid, not engine oil. Never let a bare "amber" set
   `fluid_color=brown_or_black`. Cross-ref dossier `brake-hydraulics`.

Owns these `binding/confusable-matrix.yaml` rows (proposed in §8): oil↔coolant puddle, oil↔exhaust,
blue↔white smoke, burnt-oil↔hot-brake smell, oil-pressure-light↔service-reminder, oil↔brake-fluid (amber).

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Current testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| Valve-cover leak → burnt-oil smell/under-hood smoke | oil_leak_testing | smell / smoke | `burnt_oil_smell`, `smoke_from_under_the_hood` | good |
| Oil-pan / drain-plug / rear-main puddle | oil_leak_testing | leak | `brown_or_black_puddle_engine_oil` | good |
| Oil-filter-housing / cooler gasket | oil_leak_testing | leak / smell | `brown_or_black_puddle_engine_oil` / `burnt_oil_smell` | good |
| Blue smoke — valve seals (startup) | check_engine_light_testing | smoke | `blue_or_gray_smoke_from_tailpipe` | good |
| Blue smoke — rings (load) | check_engine_light_testing | smoke | `blue_or_gray_smoke_from_tailpipe` | good |
| Turbo seal — blue smoke + whistle | check_engine_light_testing | smoke | `blue_or_gray_smoke_from_tailpipe` | weak (no turbo-specific cue captured beyond `vehicle_powertrain`) |
| Oil-pressure loss (low level / pump / bearing) | oil_pressure_light_testing | warning_light | `oil_pressure_light` | good |
| Oil-starvation ticking/knock (led with NOISE) | oil_pressure_light_testing | noise | `engine_ticking_or_tapping` / `deep_knocking_from_the_engine` | **NO FIT** — `oil_pressure_light_testing.concern_categories` = `[warning_light, leak, performance]` (DB-verified); the `noise/` subcategories are unreachable from this service at Stage 2, and NO current service reaches engine knock/tick noise. → **service-scope proposal in `proposals.yaml`** (Chris-gated: add `noise` to `oil_pressure_light_testing.concern_categories`). A knock-led oil-starvation utterance currently dead-ends. |
| **Routine oil-change request (maintenance)** | — (advisor/booking, NON-CONCERN rejection rule) | — | none (null concern) | **NO FIT — intended**; see below |

**No NEW subcategory proposed.** Enrichment is already fully populated for every oil slug and the physical
failure modes all map cleanly onto existing slugs. The real gaps are (a) the `noise/`-unreachable
oil-starvation path (NO-FIT row above → Chris-gated service-scope proposal); (b) the oil-change-vs-oil-leak
collision, handled by the NON-CONCERN rejection rule + negative examples + the null-route golden case
(NOT a Stage-1 hedge — there is no positive Stage-1 key for "routine maintenance"); (c) required_facts
gaps on oil questions, reconciled against the committed binding maps → L5 set (conditional) / intentionally_
empty ops; (d) one new fact slot (§9). Note the two oil services' `example_keywords[]` are empty in the DB,
but their Stage-1 keyword line is already populated via the **subcategory `synonyms[]` union** (taxonomy
§1, 40-cap) — so per taxonomy §2 ("improve, don't refill") only genuinely-NEW domain tokens are proposed,
not the many oil phrasings already present as synonyms. All emitted as ops in
`engine-lubrication-oil.proposals.yaml`. Catalog note (Chris-gated, NOT assumed): consider a lightweight
non-diagnostic **oil-change / routine-maintenance** booking path so the high-frequency "oil change" lines
stop competing with oil_leak_testing — demand evidence: tkc-011 ("RESET OIL MAINT LIGHT (Not due yet)"),
tkc-054 ("Inspection and Oil Change"), tkc-285 ("Inspection, emission and oil change 15 off web coup"),
tkc-246 ("I am in need of an oil change.") and many more.

---

## 9. Fact-slot audit

**Slots this system uses (of the 29):** `fluid_color`, `fluid_under_car_location`, `smell_descriptor`,
`smoke_color`, `sound_or_smoke_location_zone`, `onset_timing`, `warning_light_named`,
`warning_light_behavior`, `noise_descriptor`, `recent_action`, `drivable_state`, `vehicle_powertrain`,
`customer_request_type`.

**Values customers actually state (corpus-grounded):**
- `fluid_color=brown_or_black` ("dark brown", "black oily stain", "slick brown spot"). ⚠ **"amber" /
  "light-brown" is NOT a `brown_or_black` cue** — fresh clean oil AND brake fluid are both amber, and the
  DB already carries "Amber-colored drips…" as a `clear_yellow_or_light_brown_puddle_brake_fluid` (brake
  fluid, SAFETY) positive. Amber alone → `needs-fact:fluid_under_car_location`+`pedal_feel` (§5/§7), never
  a confident `fluid_color`.
- `fluid_under_car_location` under_engine_front / under_middle (rear-main) — customers say "under the
  motor", "front", "where engine and trans bolt up".
- `smell_descriptor=burnt_oil`; `smoke_color=blue_or_gray`; `sound_or_smoke_location_zone` under_hood /
  from_tailpipe.
- `onset_timing` cold_start (startup blue smoke) / after_warming_up (oil-light-at-idle-when-warm) /
  when_accelerating (ring smoke) / when_idling (light flickers at stops).
- `warning_light_named="oil pressure"`; `warning_light_behavior` steady_on / comes_and_goes.

**Missing values / no new value needed:** existing enums cover the observed voice. One nuance:
"when I let off the gas / coasting downhill" (blue smoke on decel — a valve-seal cue) has NO clean
`onset_timing` enum value; it is left unmapped (question q290 stays intentionally empty) rather than
stretched — do not shoehorn it into `during_driving`.

**Proposed NEW slot (≥3-question rule satisfied):**
- `oil_consumption_state` — enum: `adding_frequently`, `topped_off_recently`, `dipstick_low_or_empty`,
  `not_adding_normal`, `unsure`. Literal cues (must be literally stated): "adding a quart every few weeks",
  "keep having to add oil", "topping off between changes", "dipstick was low/empty", "haven't had to add
  any". Unlocks/answers questions: blue-smoke q291, oil-puddle q327, dipstick q393, oil-light q394 (**4
  ≥ 3**). Diagnostic value: separates a slow seep from active consumption AND grades oil-pressure-light
  severity. Emitted as `stage3.slot.propose` in proposals; the four `required_facts.set` ops that reference
  it are **conditional** on adoption (`fallback: intentionally_empty`). Burnt-smell q236 is intentionally
  EXCLUDED (compound OR, unsafe to skip — stays always-ask).

---

## 10. Sources

Diagnostic (Tier 1/2), accessed 2026-07-18:
- Halderman, *Automotive Technology* — Engine Oiling/Lubrication Systems; Oil-Leak Diagnosis; Engine Repair
  (oil burning; valve-seal vs ring signatures; gasket & seal materials; oil-filter-housing/cooler gaskets;
  oil-pressure warning-circuit diagnosis; PCV/crankcase ventilation and its effect on seals & consumption)
  [Tier 2]. Primary diagnostic anchor for this dossier.
- Bosch, *Automotive Handbook* — engine lubrication, oil-pressure warning [Tier 2].
- Fel-Pro gasket technical training (free parts-manufacturer material) — valve-cover / cartridge
  oil-filter-housing gasket failure modes [Tier 2, corroboration only]. (Prior drafts merged "MAHLE/Fel-Pro"
  into one cite and referenced an unverifiable "rear-main technical bulletin" — both removed; the rear-main
  and gasket-material claims stand on Halderman.)
- SAE J2012 — oil-pressure DTC definitions (P0520-P0524 sensor/switch circuit & performance) [Tier 1].
- Blue-smoke valve-seal-vs-ring + wet/dry compression discriminator: standard textbook (Halderman) claim,
  corroborated by web-search consensus 2026-07-18 (content-farm result URLs intentionally NOT cited per
  source-policy denylist; used only as corroboration of a textbook-standard claim).

Linguistic (provenance tags in lexicon/proposals): Tekmetric corpus / eval — tkc-011/039/054/061/070/243/
246/283/285 + eval cases check_engine_light_testing-005, coolant_leak_testing-001 (NOTE: tkc-049 is an
oil-change/TPMS work-order labeled `multiple_symptoms_not_sure_what_category` — it is NOT burnt-oil
evidence and is not cited as such); forum-paraphrase (2carpros.com, community.cartalk.com — patterns
paraphrased, never verbatim); synthetic (flagged, capped <30%/subcategory). Existing DB `positive_examples`
are treated as pre-existing enrichment, NOT re-labeled as new tekmetric/synthetic evidence, and are not
re-added to the lexicon.

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode cites Tier 1/2; no memory-only diagnostic claims. Failure-mode catalog now
      includes 3.9 oil-pressure sensor/switch (false light, normal pressure — the P0520-P0523 mode) and
      3.10 PCV-driven seal leaks/consumption.
- [x] Sensory signatures expressed in fact-slot vocabulary.
- [x] Customer artifacts in customer voice; synthetic flagged and **audited < 30%/subcategory**. Per-subcat
      lexicon counts (NEW-voice entries only; DB positives excluded): brown_or_black_puddle_engine_oil 7
      (0 synthetic), oil_pressure_light 4 (0 synthetic), burnt_oil_smell 5 (1 synthetic = 20%),
      blue_or_gray_smoke_from_tailpipe 1 (0), smoke_from_under_the_hood 1 (0), brake-fluid-collision 1
      (0 synthetic, forum-paraphrase). Cross-system negative-route entries (burning-rubber, transmission)
      are single flagged synthetic lines, not owned-subcategory training voice. No entry re-labels an
      existing DB positive as tekmetric/synthetic.
- [x] Every negative_example op names `routes_to`.
- [x] Every synonym is ≥2 tokens or a domain token (no bare "oil"/"leak"/"smoke"/"light").
- [x] Literalness respected — inference-trap golden cases guard over-assertion (no smoke_color unless
      smoke stated; no fluid_color unless a color named; no warning_light_behavior/drivable_state unless
      the customer literally described them).
- [x] ≥8 golden cases incl. ≥2 inference-trap + ≥1 null-route (oil-change maintenance line); golden texts
      rewritten to NOT mirror DB positive_examples (generalization, not memorization).
- [x] New-slot proposal meets ≥3-question rule (`oil_consumption_state`, 4 questions: q291/327/393/394);
      the referencing `required_facts.set` ops are conditional on adoption with `fallback: intentionally_
      empty`, reconciled against the committed binding maps (q236 excluded as unsafe OR).
- [x] required_facts ops reconciled with `binding/required-facts-map.q1/q2/q3.md`: q303/q308 (NEVER,
      safety/compound) + q325 (wrong-skip trap) + q232 (NO-SLOT) are `intentionally_empty`, not set.
- [x] Confusable pairs oil↔coolant, oil↔exhaust, blue↔white↔black smoke, burnt-oil↔hot-brake,
      oil-pressure-light↔service-reminder, **oil↔brake-fluid (amber, SAFETY)** all addressed (§5/§7) + own
      confusable-matrix rows.
- [x] Catalog/scope changes proposed, never assumed: oil-change booking path AND the `noise`-unreachable
      oil-starvation path (add `noise` to `oil_pressure_light_testing.concern_categories`) are both
      Chris-gated proposals. `binds_categories` no longer claims `noise` (it is a gap, not a live binding).
