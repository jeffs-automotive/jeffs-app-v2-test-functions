# Cooling system & overheating — diagnostic dossier
slug: cooling-system   date: 2026-07-18   binds_services: [coolant_leak_testing, coolant_leak_testing_euro, ac_performance_check]   binds_categories: [leak, smoke, smell, warning_light, performance, hvac]
<!-- Reachability (DB-verified 2026-07-18): coolant_leak_testing[_euro].concern_categories = [leak, smoke, smell, performance, warning_light]; ac_performance_check = [hvac]. The hvac subcategories this system touches (heat_doesnt_work, bad_smell_from_vents) are reached via ac_performance_check — hence it is a bound service. The 'noise' category (water-pump bearing whine) is NOT reachable from ANY current cooling service, so it is deliberately absent from binds_categories; see §8 for the Chris-gated concern_categories.amend proposal that would close that gap. -->


> Scope note on the taxonomy shape: the cooling system is **scattered across seven symptom
> categories** — there is NO single "cooling" bucket. A coolant leak lands in `leak`, its smell in
> `smell`, its steam in `smoke`, its dash light in `warning_light`, its no-heat consequence in `hvac`,
> its water-pump bearing whine in `noise`, and — critically — **there is no subcategory for "engine
> running hot / overheating" itself** unless the customer leads with a named dash light or a visible
> puddle. This dossier's biggest structural finding is that gap (§8).

---

## 1. Scope & boundaries

**In scope** (the physical cooling circuit + its customer-visible consequences):
- **Coolant containment & circulation:** radiator, radiator/heater hoses, water pump (belt- or
  timing-driven), thermostat, coolant reservoir/overflow, radiator cap, freeze/core plugs,
  water-pump gasket & shaft seal, cylinder-head gasket **as it relates to coolant** (intermix / white
  smoke / overheating).
- **Heat rejection:** cooling fan (electric or clutch), fan control, radiator core airflow.
- **Customer-facing consequences owned here:** green/orange/pink/blue coolant puddle; sweet
  maple-syrup smell; white tailpipe smoke (coolant burn); steam/smoke from under the hood; red
  engine-temperature (thermometer-in-waves) light; heater-blows-cold caused by low coolant or a stuck
  thermostat; engine overheating / temp-gauge-in-the-red.

**OUT of scope** (each with the neighbor that owns it):
- **Oil leaks / burnt-oil smell / blue-gray tailpipe smoke** → `oil-leak` / `check_engine_light_testing`
  (blue/gray smoke = oil burn). Cooling owns WHITE smoke only. Confusable pair #4 (§7).
- **A/C refrigerant performance, weak vents, musty smell** → `hvac` (`ac_performance_check`,
  `ac_leak_testing`). Cooling touches HVAC **only** through the heater side (heater core, coolant to
  the heater). Confusable pair #3 (§7).
- **Exhaust leaks / louder exhaust / exhaust fumes in cabin** → `exhaust_system_testing`.
- **Clear odorless water puddle (A/C condensation)** → `leak/clear_odorless_puddle_water_or_ac_condensation`.
- **Check-engine-light-only with no temp symptom** (e.g. P0128 coolant-temp-below-thermostat-regulating)
  → `check_engine_light_testing` unless a heat/temp complaint accompanies it.
- **Transmission cooler / trans-fluid leak (red)** → `leak/red_or_pink_puddle_transmission_or_power_steering`.

---

## 2. System primer (expert, cited)

A liquid-cooling circuit holds pressurized ethylene- or propylene-glycol coolant (~50/50 with water).
The **water pump** (impeller on a bearing-supported shaft, sealed by a spring-loaded shaft seal)
circulates coolant through the block and head; the **thermostat** (wax-pellet valve) blocks flow to
the radiator until the engine reaches operating temperature (~90–105 °C / 195–220 °F), then opens to
route coolant through the **radiator**, where the **cooling fan** and vehicle airflow reject heat. A
**pressure cap** raises the boiling point by roughly **+3 °F per psi (~+1.7 °C/psi)** — so a 16 psi cap
adds ≈ 48 °F, lifting the ~212 °F / 100 °C boil to ≈ 260 °F / **125 °C** [Halderman, *Automotive
Technology*, cooling-system pressure-cap section, Tier 2]. A branch feeds
the **heater core** (a small radiator behind the dash) — cabin heat is a by-product of engine coolant
temperature [Halderman, *Automotive Technology*, cooling-system chapter, Tier 2; SAE J1930 terminology,
Tier 1].

**Architectures / variants that change the customer story:**
- **Timing-belt/-chain-driven vs accessory-belt-driven water pump.** A timing-driven pump failing is
  often bundled with a timing service; its leak still presents as a front-center coolant puddle.
- **Electric water pumps** (many hybrids/EVs, some turbo engines) — fail electrically, may throw a
  code rather than weep.
- **Electric cooling fan vs mechanical fan clutch.** A dead electric fan overheats the car **at idle /
  in traffic** but cools fine at highway speed (airflow) — a distinctive customer pattern.
- **Cross-flow vs down-flow radiators, plastic end-tanks** — plastic tanks crack at the seam with age
  (a common modern leak point).
- **Coolant colors are brand-specific, not diagnostic of type:** green (traditional IAT), orange/red
  (Dex-Cool OAT), yellow/gold (HOAT), pink/violet (G12/G13, many Euro), even bright blue (some Asian).
  Color tells the customer "coolant," not the failure [Gates TechZone, cooling-system training, Tier 2,
  https://www.gatestechzone.com/en/problem-diagnosis/cooling-system/water-pump-failure-signs, accessed 2026-07-18].
- **Euro variant** (`coolant_leak_testing_euro`): same physics, higher diag fee — plastic thermostat
  housings, electric pumps, and G12-class coolant dominate; the corpus rarely names the brand, so
  don't over-index on Euro-only phrasings (customer-voice guide §5).

---

## 3. Failure-mode catalog (the diagnostic spine)

Each mode: sensory signature in fact-slot vocab → conditions → severity/drivability → typical
misattribution → cite.

### 3.1 External coolant leak — hose / radiator / water-pump gasket
- **Signature:** `fluid_color=green_or_orange_or_yellow_or_pink`, `fluid_under_car_location=under_engine_front`,
  `smell_descriptor=sweet_or_maple_syrup`; coolant level drops / repeated top-offs (proposed
  `coolant_level_state=topping_off_repeatedly`).
- **Conditions:** puddle where parked; may worsen warm (`onset_timing=after_warming_up`) as the system
  pressurizes.
- **Severity:** `drivable_but_concerned` early → `not_drivable_needs_tow` once level is low enough to
  overheat.
- **Misattribution:** customers call any front puddle "oil"; the sweet smell + bright color is the tell.
- **Cite:** Gates TechZone water-pump/leak training, Tier 2 [url above, accessed 2026-07-18].

### 3.2 Water-pump failure — weep-hole seep or bearing wear
- **Signature (seal):** small front-center coolant seep, `fluid_under_car_location=under_engine_front`.
  **Signature (bearing):** `noise_descriptor=whining` or `humming_or_whirring` / grinding under the
  hood, `sound_or_smoke_location_zone=under_hood`, sometimes a visibly wobbling pulley.
- **Conditions:** noise present with engine running, can persist briefly at shutdown; overheating if
  circulation is lost.
- **Belt cross-ref:** on **accessory-belt-driven** pumps, a thrown/shredded serpentine belt stops the
  pump (and the alternator + power steering) → rapid overheat with a battery light and heavy steering —
  cross-ref the charging/belt systems; the customer usually leads with the belt-loss consequences, not
  "cooling." [Halderman, *Automotive Technology*, cooling-system/belt-drive section, Tier 2.]
- **Severity:** `drivable_but_concerned` → `not_drivable` if the pump seizes/loses flow.
- **Misattribution:** bearing whine is called "belt noise" or "alternator"; a wobbling pulley is
  "the belt." Weep-hole coolant is called "a hose leak."
- **Cite:** "Worn pump bearings create a whining or grinding sound; a wobbling/loose pulley indicates
  bearing play; the weep hole seeps coolant on seal failure; a bad pump makes the engine run hotter
  than normal or overheat" — Gates TechZone, Tier 2 [url above, accessed 2026-07-18].

### 3.3 Thermostat stuck **closed** → overheating
- **Signature:** engine runs hot / temp gauge climbs (proposed `temperature_gauge_state=in_the_red`),
  `warning_light_named=temp`, possibly steam. Coolant may be full.
- **Conditions:** overheats even at steady cruise (unlike a fan-only failure).
- **Severity:** `not_drivable_needs_tow` when in the red.
- **Misattribution:** "the radiator's clogged" / "water pump" — all present identically as overheating.
- **Cite:** Halderman, *Automotive Technology*, thermostat operation, Tier 2.

### 3.4 Thermostat stuck **open** (or missing) → no/slow heat, engine runs cool
- **Signature:** `heat_doesnt_work` — heater blows cold or takes forever; temp **gauge stays low**
  (proposed `temperature_gauge_state=stays_low`), coolant level normal.
- **Conditions:** worst in cold weather (`weather_condition=cold_weather`); heat may come at highway
  speed then vanish at idle.
- **Severity:** `drivable_normally` (comfort/efficiency issue, sets P0128 over time).
- **Misattribution:** "heater core" or "blend door." The low gauge is the discriminator.
- **Cite:** Halderman, *Automotive Technology*, thermostat operation, Tier 2 (primary); MACS technical
  training, HVAC heat-side / heater-core diagnosis module, Tier 2 (corroborating).

### 3.5 Cooling-fan failure (electric fan or fan clutch)
- **Signature:** overheats **at idle / low speed / in traffic**, cools when moving.
  `speed_band=stopped`/`idle` or `low_speed`; `temperature_gauge_state` climbs then falls with speed.
- **Severity:** `drivable_but_concerned` (must keep moving) → `not_drivable` in stop-and-go.
- **Misattribution:** "thermostat" or "low coolant." The speed-dependence is the tell.
- **Cite:** Halderman, cooling-fan control, Tier 2.

### 3.6 Head-gasket failure / cracked head — coolant→combustion or coolant→oil intermix
- **Signature:** persistent **white** tailpipe smoke that does NOT clear after warm-up
  (`smoke_color=white`, `smell_descriptor=sweet_or_maple_syrup`, `sound_or_smoke_location_zone=from_tailpipe`),
  coolant loss with **no external puddle**, repeated overheating, milky/frothy oil on the cap, bubbles
  in the reservoir.
- **Conditions:** white smoke sustained under load; overheating recurs after refills.
- **Severity:** `not_drivable_needs_tow`.
- **Misattribution:** cold-morning **steam** (see 3.8) is misread as head-gasket white smoke; oil-burn
  **blue** smoke is misread as coolant.
- **Cite:** Coolant leaking into the combustion chamber burns and exits as thick white sweet-smelling
  smoke; coolant that disappears with no external puddle is consumed internally; milky oil = coolant/oil
  intermix; confirm with a combustion/block leak test (dye turns from blue to yellow-green with
  combustion gases in the coolant). [ASE A1 *Engine Repair* task list incl. combustion/block-leak-test
  procedure, ase.com, Tier 1; Halderman, *Automotive Technology*, engine-repair / head-gasket &
  cylinder-head chapter, Tier 2; CRC combustion-leak-tester guidance, Tier 3 corroboration only;
  accessed 2026-07-18.]

### 3.7 Overheating from low coolant / boil-over (any root cause)
- **Signature:** `temperature_gauge_state=in_the_red` / `warning_light_named=temp`, steam from under
  the hood (`smoke_color=steam_thin_wispy`/`white`, `sound_or_smoke_location_zone=under_hood`), hissing/
  bubbling, coolant `empty_or_bone_dry`; heater may go cold as level drops.
- **Severity:** `stranded_now` / `not_drivable_needs_tow` — pull over and shut off (head-warp risk).
- **Misattribution:** THIS is the mode with no clean subcategory home (§8) — it's neither "a puddle"
  nor "a named light" when the customer just says "it overheated."
- **Cite:** Halderman, overheating diagnosis, Tier 2; Gates TechZone (overheating = #1 water-pump/
  cooling failure sign), Tier 2 [url above, accessed 2026-07-18].

### 3.8 Normal cold-start tailpipe condensation — the NON-failure to reject
- **Signature:** thin wispy white vapor at the tailpipe on a cold morning that **clears within a
  minute** and has **no smell** — `smoke_color=steam_thin_wispy`, `onset_timing=cold_start`,
  `weather_condition=cold_weather`.
- **Severity:** `drivable_normally` — this is normal.
- **Why it's here:** it is the #1 inference trap against 3.6 white smoke (see the cold-morning-steam
  **null-route golden case** in proposals.yaml). The correct behavior is a **reject / advisor handoff**
  (empty Stage-1), NOT a mis-route into `white_smoke_from_tailpipe`. The extractor must NOT upgrade this
  to `smoke_color=white` or assert head gasket.
- **Cite:** Halderman, exhaust-vapor vs coolant-smoke distinction, Tier 2.

### 3.9 Heater core leak (cooling fluid entering the cabin)
- **Signature:** sweet smell **from the vents** with heat on, foggy/greasy film on the inside of the
  windshield, wet passenger-side carpet, coolant level slowly dropping with no ground puddle.
- **Note:** the *smell* routes to `hvac/bad_smell_from_vents`; a *no-heat* consequence routes to
  `heat_doesnt_work`; but the *cause* is cooling-system. Cross-owned (§7).
- **Cite:** Halderman, *Automotive Technology*, heater-core diagnosis, Tier 2 (primary); MACS technical
  training, heater-core coolant-leak module, Tier 2 (corroborating).

### 3.10 Pressure- / radiator-cap failure → boil-over & coolant loss
- **Signature:** a cap that no longer holds rated pressure lowers the boiling point → the system
  boils over and pushes coolant out through the overflow: `temperature_gauge_state=reading_high_or_hot`/
  `in_the_red`, steam from under the hood after a hot shutdown, `coolant_level_state=low`/
  `topping_off_repeatedly` — coolant "disappears" into the overflow bottle or onto the ground at the
  reservoir, often with **no** obvious hose/radiator leak.
- **Conditions:** worst under load and during heat-soak just after shutdown; a weak cap may also fail
  to draw coolant back on cooldown (reservoir overfills).
- **Severity:** `drivable_but_concerned` → `not_drivable_needs_tow` once it boils over.
- **Misattribution:** blamed on "the radiator," "the water pump," or "head gasket" — a ~$15 cap is the
  cheap first check and a classic overlooked overheat/coolant-loss root cause.
- **Cite:** Halderman, *Automotive Technology*, cooling-system pressure-cap operation, Tier 2; Gates
  TechZone cooling-system training, Tier 2 [url in §10, accessed 2026-07-18].

### 3.11 ECT-sensor / temperature-gauge-sender false reading (gauge lies; engine is fine — or vice versa)
- **Signature:** the gauge behaves oddly **without** a real overheat — it pegs hot, drops to cold, or
  swings erratically while there is **no** steam, **no** coolant loss, and **no** boil:
  `temperature_gauge_state=fluctuating` or `gauge_dead_or_no_reading`; a failing engine-coolant-temp
  (ECT) sensor commonly trips a CEL (P0115-range codes). A dead sender can also **mask** a genuine
  overheat (needle never rises).
- **Conditions:** reading jumps independent of load/speed; frequently intermittent (connector/wiring).
- **Severity:** `drivable_normally` — **but** a real overheat must be ruled out first (steam, coolant
  loss, boil all absent before you trust "it's just the sensor").
- **Misattribution:** the customer panics ("it's overheating!") when the gauge is lying; conversely a
  stuck-low/dead gauge lulls them past a real overheat.
- **Backs slot values:** `temperature_gauge_state=fluctuating` and `=gauge_dead_or_no_reading` (§9).
- **Cite:** Halderman, *Automotive Technology*, ECT sensor & temperature-gauge/sender operation and
  diagnosis, Tier 2.

---

## 4. Customer-language lexicon (binds synonyms / positives)

Real-voice phrasings, source-ordered (Tekmetric corpus → forum-paraphrase → synthetic ≤30%). Full
machine form in `cooling-system.lexicon.yaml`. Highlights:

| Phrase (verbatim/near) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "LARGE PUDDLE OF ANTIFREEZE" | green_orange_yellow_or_pink_puddle_coolant | unambiguous | tekmetric |
| "CLIENT SEES LEAK AT LOWER LINE ON RADIATOR" | green…coolant | unambiguous | tekmetric |
| "COOLANT LEAK, having to top off … a few times" | green…coolant | needs-fact:coolant_level_state | tekmetric |
| "COOLANT MESSAGE ON DASH CEL ON" | engine_temperature_light | cross-system:check_engine_light | tekmetric |
| "HIGH TEMPERATURE, UNSAFE TO DRIVE … had it towed" | engine_temperature_light | unambiguous | tekmetric |
| "temp gauge goes all the way up, steam coming from behind the fan" | engine_temperature_light | needs-fact:temperature_gauge_state | forum-paraphrase |
| "CHECK FOR OVERHEATING. HAS NOT ADDED ANY COOLANT" | engine_temperature_light (NO-FIT for plain overheat, §8) | needs-fact:temperature_gauge_state | tekmetric |
| "VEHICLE OVERHEATED AND LOST ALL COOLANT" | engine_temperature_light (NO-FIT, §8) | needs-fact:coolant_level_state | tekmetric |
| "gauge fluctuate high and low as if the STAT is getting stuck" | engine_temperature_light | needs-fact:temperature_gauge_state | tekmetric |
| "Thick white smoke … even after driving 20 min, smells kinda sweet" | white_smoke_from_tailpipe | unambiguous | synthetic (authored eval case — real-voice gap, §11) |
| "somethin smells like maple syrup around my car, cant find any leak" | sweet_smell_maple_syrup_antifreeze | unambiguous | synthetic (authored eval case — real-voice gap, §11) |
| "sweet smell coming from my vents when I turn on the heat … headache" | hvac/bad_smell_from_vents (heater core) | cross-system:bad_smell_from_vents | forum-paraphrase |
| "Heat only works when moving, as soon as it stops goes cold" | heat_doesnt_work | needs-fact:temperature_gauge_state | tekmetric |
| "NO HEAT. GAUGE SOMETIMES GOES UP" | heat_doesnt_work / engine_temperature_light | cross-system | tekmetric |
| "water pump pulley was wobbling" | noise/high_pitched_whining_under_the_hood | cross-system:noise | tekmetric |
| "whining noise when shutting off … sounds like metal on metal … water pump" | noise/high_pitched_whining_under_the_hood | cross-system:noise | tekmetric |
| "smoke coming out from underneath the hood, a message came up that the coolant was overheating" | smoke_from_under_the_hood | unambiguous | nhtsa |
| "hissing sound and smoke/steam coming from under my hood" | smoke_from_under_the_hood | needs-fact:smell_descriptor | forum-paraphrase |
| "little white steam on cold mornings that goes away" | (reject — normal, §3.8) | inference-trap | forum-paraphrase |

Messiness observed and preserved: ALL-CAPS Tekmetric style, "antifreeze/coolant" used
interchangeably, "the STAT" (thermostat), "reserve/resivor" (reservoir), gauge-vs-light conflation,
mixed symptom+request ("… testing auth 179").

---

## 5. Differential & discriminating questions (binds required_facts + slots)

For each confusable pair: the ONE best question, the fact slot + value that resolves it.

| Pair | Best discriminating question | Slot → value |
|---|---|---|
| Coolant puddle vs oil puddle (leak) | "What color is the puddle — bright green/orange/pink, or dark brown/black?" | `fluid_color` → green_or_orange…_pink vs brown_or_black |
| Coolant leak vs sweet-smell-only | "Do you actually SEE a puddle, or just smell it?" | `fluid_color` present ⇒ leak; null + `smell_descriptor=sweet` ⇒ smell slug |
| Sweet smell under hood vs from vents (heater core) | "Is the sweet smell strongest under the hood, or blowing through the dash vents with the heat on?" | `sound_or_smoke_location_zone` → under_hood vs from_vents |
| White (coolant) vs blue-gray (oil) smoke | "Does the smoke smell sweet/syrupy, or oily like burning oil?" | `smell_descriptor` → sweet_or_maple_syrup vs burnt_oil; `smoke_color` white vs blue_or_gray |
| Real white smoke vs cold-morning steam | "Does it keep smoking after 10–15 min of driving, or clear up within a minute?" | `smoke_color` white (persistent) vs steam_thin_wispy; `onset_timing=cold_start` |
| No-heat from thermostat vs from heater core | "Does the temperature GAUGE reach its normal spot, or stay cold?" | **proposed `temperature_gauge_state`** → stays_low (thermostat) vs normal (heater core/actuator) |
| Overheating: fan vs thermostat/pump | "Does it overheat mainly in traffic/at idle, or also at steady highway speed?" | `speed_band` → stopped/idle (fan) vs all_speeds (thermostat/pump/coolant) |
| Overheat vs no real problem (gauge normal) | "Is the temp GAUGE actually high/in the red, or is it a warning light with a normal gauge?" | **proposed `temperature_gauge_state`** → in_the_red vs normal |
| Coolant loss: external leak vs internal (head gasket) | "Do you see a puddle where you park, or is the coolant just disappearing with none on the ground?" | `fluid_under_car_location` present (external) vs null + `coolant_level_state=topping_off_repeatedly` + white smoke (internal) |
| Overheat now vs history | "Is the temp light/gauge on RIGHT NOW, or did it happen and you stopped?" | `warning_light_behavior` steady_on; `drivable_state` |

**Two questions currently un-answerable in the 29 slots → slot proposals (§9):**
1. "Is the temperature GAUGE high/in the red / stays low?" — a gauge needle is NOT a named dash LIGHT,
   so `warning_light_named` must not be (mis)used. → **`temperature_gauge_state`**.
2. "Have you had to add/top off coolant / is the reservoir low or bone dry?" — coolant *level* has no
   slot today; these questions carry EMPTY `required_facts` and drive over-asking. → **`coolant_level_state`**.

---

## 6. Warning lights & DTC surface

- **Engine temperature light** — thermometer submerged in two wavy lines. **RED = overheating now**
  (urgent), **BLUE = cold engine** (normal, not a fault). Customer nicknames: "the temp light," "the
  red thermometer thing," "the wavy thermometer," "hot light," "HOT warning," "overheat light." Solid
  red = act now. Feeds `warning_light_named=temp`, `warning_light_behavior`.
- **A digital temperature MESSAGE** ("HIGH TEMPERATURE, UNSAFE TO DRIVE," "ENGINE HOT — STOP SAFELY,"
  "COOLANT TEMP") — treat as the temp light; `warning_light_named=temp` (corpus evidence: multiple
  ALL-CAPS message reports).
- **The temperature GAUGE needle** (not a light) — customers say "gauge went into the red / all the
  way up / creeping toward H." This is NOT a warning-light indicator and has **no current slot** →
  `temperature_gauge_state` proposal (§9). Do NOT coerce it into `warning_light_named`.
- **Check-engine light co-occurrence:** overheating often trips CEL codes (P0128 coolant-temp-below-
  regulating from a stuck-open thermostat; P0125 insufficient-coolant-temp; misfire codes when
  head-gasket intermix fouls a cylinder — corpus: "misfire … coolant temp overheat message … CEL").
  When the customer leads with the temp/heat symptom, keep it in cooling; a bare CEL with no temp
  complaint goes to `check_engine_light_testing`.

---

## 7. Confusable neighbors (cross-system)

1. **`hvac/ac_performance_check` (heat) ↔ cooling** — "no/weak heat" defaults to HVAC. Only pull to
   `coolant_leak_testing` when a **coolant symptom is also present** (low coolant, puddle, temp gauge
   abnormal, sweet smell). Discriminator: `temperature_gauge_state` (stays_low ⇒ thermostat/cooling) +
   `coolant_level_state`. (Taxonomy confusable pair #3.) See `oil-leak`/`hvac` dossiers.
2. **`smoke/blue_or_gray_smoke_from_tailpipe` (oil) ↔ `white_smoke_from_tailpipe` (coolant)** —
   discriminator `smell_descriptor` (burnt_oil vs sweet) + `smoke_color`. (Taxonomy pair #4.)
   Cross-ref `oil-leak` and the smoke/smell router.
3. **`leak/red_or_pink_puddle_transmission_or_power_steering` ↔ coolant** — pink coolant vs pink ATF/PS.
   Discriminator: location (front-center radiator vs mid/under-engine) + oily-vs-watery + sweet-vs-none.
4. **`leak/blue_or_light_blue_puddle_washer_fluid` ↔ blue coolant** — some coolant is bright blue.
   Discriminator: **smell** (sweet/slimy coolant vs soapy-odorless watery washer). Note `fluid_color`
   has no coolant-blue value (§9) — this pair resolves on smell, not color.
5. **`noise/high_pitched_whining_under_the_hood` & `noise/humming_or_whirring_at_speed` ↔ cooling** —
   water-pump bearing whine/growl. Cross-ref the NVH router; cooling contributes the "water pump"
   positive. **Reachability caveat:** these are `noise`-category subcategories, and NO current cooling
   service reaches `noise` (DB-verified) — so a water-pump-noise utterance cannot land on them via a
   cooling service today. That gap is a Chris-gated `concern_categories.amend` proposal (§8). (Note:
   `humming_or_whirring` — no `_at_speed` — is **not** a subcategory slug; it is only a valid
   `noise_descriptor` fact value.)
6. **`exhaust_system_testing` ↔ cooling** — "smoke from the back/exhaust smell" — exhaust leak vs
   coolant white smoke. Discriminator: `smell_descriptor` (rotten_egg/exhaust vs sweet) + color.
7. **`check_engine_light_testing` ↔ cooling** — CEL-only vs CEL-with-temp-symptom (§6).

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode (§3) | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| 3.1 External coolant leak | coolant_leak_testing | leak | green_orange_yellow_or_pink_puddle_coolant | **good** |
| 3.2 Water-pump weep (leak) | coolant_leak_testing | leak | green…coolant | good |
| 3.2 Water-pump bearing (noise) | **none (unreachable)** | noise | high_pitched_whining_under_the_hood / humming_or_whirring_at_speed | **NO FIT (structurally unreachable)** — coolant_leak_testing.concern_categories = [leak, smoke, smell, performance, warning_light]; it CANNOT reach `noise`, so no cooling service can land these slugs. → Chris-gated `concern_categories.amend` (add `noise` to coolant_leak_testing) OR route via the NVH path. |
| 3.3 Thermostat stuck closed → overheat | coolant_leak_testing | warning_light / performance | engine_temperature_light (if light) / **NO FIT if plain "overheating"** | **weak / NO FIT** |
| 3.4 Thermostat stuck open → no heat | ac_performance_check | hvac | heat_doesnt_work | good |
| 3.5 Fan failure → overheat at idle | coolant_leak_testing | warning_light / performance | engine_temperature_light / **NO FIT** | **weak / NO FIT** |
| 3.6 Head gasket → white smoke | coolant_leak_testing | smoke | white_smoke_from_tailpipe | good |
| 3.7 Overheating / boil-over (plain) | coolant_leak_testing | (none) | **NO FIT** — only lands if a light or puddle is named | **NO FIT** |
| 3.7 Overheating w/ visible steam | coolant_leak_testing | smoke | smoke_from_under_the_hood | good |
| 3.8 Cold-morning steam (normal) | — | smoke | (reject; not white_smoke) | good (as rejection) |
| 3.9 Heater core leak | ac_performance_check / coolant_leak_testing | hvac / smell | bad_smell_from_vents / heat_doesnt_work | good |
| Sweet smell, no puddle | coolant_leak_testing | smell | sweet_smell_maple_syrup_antifreeze | good |

**The NO-FIT (subcategory proposal, Chris-gated):** a customer who says only **"my car is
overheating"** / **"it ran hot and I had to pull over"** / **"lost all my coolant, check for
overheating"** — with **no named dash light and no visible puddle** — has no natural Stage-2 home.
Today the corpus consensus force-fits these onto `warning_light/engine_temperature_light`, which is
strictly a *light-first* slug (its own description says so). This mislabels the customer's actual lead
symptom and pollutes the light's training set.

→ **Proposal `stage2.subcategory.propose`: `performance/engine_overheating_running_hot`** — "Customer
reports the engine running hot / overheating / temp gauge in the red as the PRIMARY symptom, without
leading with a specific dash light or a visible puddle." Demand evidence — **~4 genuinely clean no-fit
utterances** (Tekmetric, real): "VEHICLE OVERHEATED AND LOST ALL COOLANT," "CHECK FOR OVERHEATING. HAS
NOT ADDED ANY COOLANT," "drop box overheating," and "gauge fluctuate high and low as if the STAT is
getting stuck." **Two utterances that earlier padded this list were removed because they already have
homes:** "HIGH TEMPERATURE, UNSAFE TO DRIVE" is a **digital dash message** that §6 routes to
`engine_temperature_light`; and "vehicle overheated **after valve cover replacement**" is a
situational cue that the Stage-1 priority-order rule routes to the `after_recent_service_or_repair_work`
bucket. So the honest clean-no-fit count is **~4, not ≥6**. Even at ~4 the gap is real and recurring.
Until/unless Chris approves the new subcategory, the **interim** binding is a `stage2.description.revise`
on `engine_temperature_light` to explicitly claim gauge-in-the-red / "overheated" reports (see
proposals.yaml).

**Reachability constraints this section surfaces (both terminate in Chris-gated change-ops in
proposals.yaml):**
- **Water-pump bearing noise** (§3.2) → `noise` subcategories are unreachable from any cooling service
  → `catalog.service.concern_categories.amend` (add `noise` to coolant_leak_testing[_euro]).
- **Blue/gray oil tailpipe smoke** (confusable #4, §7.2) → the taxonomy doc names
  `check_engine_light_testing`, but its `concern_categories = [warning_light, performance]` exclude
  `smoke`, so `blue_or_gray_smoke_from_tailpipe` is unreachable from CEL; the only reachable homes are
  the two `smoke`-bearing services (`oil_leak_testing`, `coolant_leak_testing`) →
  `catalog.service.concern_categories.amend` (add `smoke` to check_engine_light_testing) so its own
  description's claim to own blue/gray smoke becomes reachable.

---

## 9. Fact-slot audit

**Slots this system uses today (existing):** `fluid_color`, `fluid_under_car_location`,
`smell_descriptor` (sweet_or_maple_syrup), `smoke_color` (white, steam_thin_wispy),
`warning_light_named` ('temp'), `warning_light_behavior`, `onset_timing` (cold_start, after_warming_up),
`weather_condition` (cold_weather), `sound_or_smoke_location_zone` (under_hood, from_tailpipe,
from_vents), `noise_descriptor` (whining, humming_or_whirring, hissing), `speed_band` (idle/stopped
for fan cases), `drivable_state`, `recent_action` (general_service / oil_change — "after valve cover
replacement"), `hvac_mode` (heat).

**Values customers actually state (corpus-grounded), well-covered:** sweet/maple-syrup smell; green/
orange/pink/blue coolant color; white persistent vs thin-wispy steam; "temp" light/message; steam
from under hood; towed/stranded drivability.

**Gaps → two NEW slot proposals (each clears the ≥3-question rule):**

1. **`temperature_gauge_state`** (enum: `normal`, `reading_high_or_hot`, `in_the_red`, `stays_low`,
   `fluctuating`, `gauge_dead_or_no_reading` — the last two backed by failure mode §3.11 ECT-sensor /
   gauge-sender false readings). *Why a new slot, not `warning_light_named`:* a gauge needle is not a
   dash indicator light; literalness (customer-voice §4) forbids coercing "gauge in the red" into a
   named light. Literal cues (each must literally name the **gauge / temperature reading**): "gauge is
   in the red," "temp gauge went all the way up," "gauge reads high," "gauge stays low / never warms
   up," "gauge fluctuates high and low." (Non-literal feels like "running hotter than normal" set
   NOTHING here — no gauge is named.)
   **Questions unlocked (≥3):** q399 (temp-light gauge high/normal), q285 (white-smoke engine hotter/
   gauge crept up), q988 (green-puddle gauge creeping toward hot), q303 (smoke-under-hood gauge into
   red), q939 (no-heat gauge reaches normal or stays cold). **5 questions.**

2. **`coolant_level_state`** (enum: `normal_or_full`, `low`, `empty_or_bone_dry`,
   `topping_off_repeatedly`, `unknown`). Literal cues: "reservoir is bone dry," "had to top off twice
   this week," "coolant low," "lost all coolant," "keeps needing antifreeze," "have not added any
   coolant." **Questions unlocked (≥3):** q990 (green-puddle add antifreeze/level dropped), q940
   (no-heat add coolant/tank low), q229 (sweet-smell add coolant recently), q284 (white-smoke top-off/
   level dropping), q401 (temp-light reservoir full/low/empty). **5 questions** — all currently EMPTY
   `required_facts`, i.e. direct over-asking wins.

**Deliberately NOT proposed** (fails ≥3 or unresolvable by literal cue): "milky oil on the cap"
(head-gasket cue, ~1 question q287); "wet passenger carpet / foggy windows" (heater-core cue, ~2
questions, and heater-core is cross-owned); a coolant-blue `fluid_color` value (would collide with
washer fluid — resolve on smell, not color, per §7.4).

---

## 10. Sources (tiered)

- **Tier 1:** SAE J1930 standardized terminology (cooling nomenclature); ASE A1 *Engine Repair* task
  list incl. cooling-system & combustion/block leak test procedure (ase.com), accessed 2026-07-18.
- **Tier 2:** Halderman, *Automotive Technology* — cooling-system, thermostat, cooling-fan, overheating,
  and exhaust-vapor-vs-coolant-smoke chapters. Gates TechZone cooling-system / water-pump technical
  training (weep hole, bearing whine/wobble, overheating as #1 sign), https://www.gatestechzone.com/en/problem-diagnosis/cooling-system/water-pump-failure-signs,
  accessed 2026-07-18. MACS heater-core / HVAC-heat-side training.
- **Tier 3 (corroboration only):** CRC combustion-leak-test guidance (dye blue→yellow-green with
  combustion gases) — corroborates the ASE A1 block-test procedure, not sole source; accessed 2026-07-18.
- **Linguistic (never cited for diagnosis):** Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json`
  (primary); authored `eval-cases.json` coolant_leak_testing-001…006; forum-paraphrase from
  cartalk.com / 2carpros.com overheating threads (pattern only, no verbatim copy).

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode carries a Tier-1/2 cite (Tier-3 only corroborates the block test); §3.6
  head-gasket cite names ASE A1 (Tier 1) + Halderman (Tier 2) — the earlier unnamed "parts-technical"
  corroborator was dropped. §2 pressure-cap figure corrected to **~3 °F/psi** (was a °C/psi units error).
- [~] Customer-voice + provenance: **honest note** — `white_smoke_from_tailpipe` and
  `sweet_smell_maple_syrup_antifreeze` have a genuine **real-voice data gap**: the local corpus contains
  **no real Tekmetric tickets** for persistent white tailpipe smoke or a maple-syrup coolant smell, so
  their lexicon positives are **authored eval cases (flagged `synthetic`)** — the ≤30% cap is NOT met at
  those two slugs. Mitigation: every `positive.add` op in proposals.yaml is real corpus/forum/NHTSA
  voice, and a real NHTSA under-hood-smoke entry was added. **Backlog for Chris:** mine NHTSA/forums for
  real white-tailpipe-smoke + coolant-sweet-smell utterances next pass. All other slugs are ≤30%.
- [x] No over-broad synonyms proposed (all additions ≥2 tokens or domain tokens: "water pump," "temp
  gauge in the red," "coolant reservoir empty," "head gasket white smoke").
- [x] Every negative_example op names a **valid** `routes_to` (the earlier cold-morning-steam negative
  that carried a knowingly-false route was dropped; it is now a **null-route golden case** instead).
- [x] Fact cues are literal; gauge-vs-light and level-vs-smell distinctions preserved; golden labels
  no longer over-assert (case 3 drops an un-named gauge fact; case 5 drops an un-stated tow).
- [x] Both slot proposals clear the ≥3-question rule (5 each) with named question IDs.
- [x] The NO-FIT overheating gap is a Chris-gated subcategory proposal with **~4 clean real utterances**
  (two earlier padders had existing homes — the digital-message → engine_temperature_light and the
  after-service → situational bucket), plus an interim description-revise so nothing regresses.
- [x] Reachability audited against live `concern_categories`: two structural gaps (water-pump `noise`;
  blue/gray-smoke on CEL) each terminate in a Chris-gated `concern_categories.amend` op; `binds_services`
  now includes `ac_performance_check` (reaches the hvac subcats); `binds_categories` no longer lists the
  unreachable `noise`.
- [x] Confusable pairs #3 and #4 (the two this system owns) are addressed with a discriminating slot.
- [x] 10 golden cases incl. an inference-trap (temp-gauge-in-traffic — literalness) and **two
  null/reject routes** (coolant-flush work-order; cold-morning tailpipe steam = normal condensation).
