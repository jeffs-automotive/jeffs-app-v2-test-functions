# HVAC / climate control — diagnostic dossier
slug: hvac-climate   date: 2026-07-18   binds_services: [ac_performance_check, ac_leak_testing]   binds_categories: [hvac, smell, leak, noise, warning_light]

> Scope note on the taxonomy shape: HVAC is the **one physical system with a dedicated category** —
> `hvac` (8 subcategories) — plus spillover into `smell` (musty vent odor / heater-core sweet smell),
> `leak` (A/C condensation water), and `noise` (compressor squeal that is NOT vent-routed). Stage-2
> enrichment for all 8 `hvac` slugs is already strong and detailed (taxonomy §2). This dossier's job is
> to **sharpen the confusable boundaries** (AC-no-heat vs coolant, AC-weak vs AC-leak, blower-resistor
> vs blend-door), add the three failure modes an earlier draft missed (wrong-outlet mode-door
> distribution §3.11, heat-stuck-full-hot blend door §3.12, clogged-drain water slosh §3.10), close one
> literalness gap in the fact slots (a vent whistling value), document why an air-source slot is NOT
> viable under the presence-based mapper (§9.1), and surface one real weak-fit (AC water leaking INSIDE
> the cabin, §8).

---

## 1. Scope & boundaries

**In scope** (the cabin climate system + its customer-visible consequences):
- **Refrigerant (A/C) circuit:** compressor + clutch, condenser, evaporator, expansion valve/orifice
  tube, receiver-drier/accumulator, refrigerant charge (R-134a / R-1234yf), high/low pressure switches.
- **Heat side:** heater core (coolant-fed — the *cause* side is cooling, §7), heater control valve.
- **Air handling:** blower motor + blower resistor/control module, cabin air filter, evaporator/heater
  case, mode doors (dash/floor/defrost), blend door(s) + blend-door actuators, recirculate/fresh-air door.
- **Defog/defrost:** front defrost (airflow + AC dehumidify), rear-window defroster grid (electrical).
- **Customer-facing consequences owned here:** no/weak cold air; no/weak heat (HVAC owns heat
  complaints); weak vent airflow volume; foggy/won't-defog windows; musty/mildew or burning-electrical
  vent smell; vent/dash HVAC noises; one zone hot while another is cold.

**OUT of scope** (each with the neighbor that owns it):
- **Overheating / temp-gauge-in-the-red / coolant puddle / white smoke** → `cooling-system`
  (`coolant_leak_testing`). HVAC touches cooling only through the **heater side**. Confusable pair #3 (§7).
- **Sweet coolant smell / puddle NOT through the vents** → `cooling-system` (`smell/sweet_smell_…`,
  `leak/green_…coolant`). A sweet smell *through the vents with heat on* is a heater-core cue but still
  routes `hvac/bad_smell_from_vents` (§7.2).
- **Serpentine/accessory-belt or A/C-compressor-bearing squeal heard UNDER THE HOOD** →
  `noise/high_pitched_whining_under_the_hood`, which is the **NVH router's** territory (router-nvh),
  **NOT** an HVAC service: a belt/compressor-bearing squeal is not a vent complaint, so it is not owned
  by `ac_performance_check`. HVAC owns vent-routed noise only. Confusable pair (§7.4).
- **Musty smell from wet carpet / trunk NOT tied to vent airflow** → `smell/musty_mildew_smell_from_vents`.
  Vent-tied musty → `hvac/bad_smell_from_vents` (the DB routing rule; §7.6).
- **Any other power accessory (radio, locks, seats, sunroof)** → `electrical_testing_general`. The
  blower motor is the exception — it is HVAC-owned even though it is electrically driven.
- **Windshield WIPERS not clearing glass** → `windshield_inop_testing` (that is wiper mechanics, not fog).

---

## 2. System primer (expert, cited)

A mobile HVAC system does three jobs from one case behind the dash: **cool + dehumidify** (A/C),
**heat**, and **distribute/mix** air. The **A/C circuit** is a vapor-compression loop: the
belt-driven **compressor** (engaged by an electromagnetic **clutch** — the audible "click" when A/C is
requested) pumps refrigerant; the **condenser** (in front of the radiator) rejects heat; the
**expansion valve/orifice tube** meters refrigerant into the **evaporator** behind the dash, where it
boils and absorbs cabin heat — and, critically, **condenses humidity out of the air**, which drains
out a tube under the car. **Heat** is a by-product of engine coolant: a branch of the cooling circuit
feeds the **heater core**, and cabin warmth tracks engine coolant temperature. A **blower motor**
pushes air across evaporator then heater core; a **blend door** sets how much air passes the heater
core (temperature); **mode doors** select dash/floor/defrost; a **recirc/fresh door** selects cabin
vs outside air [Halderman, *Automotive Technology*, HVAC fundamentals chapter, Tier 2; ASE A7 Heating &
Air Conditioning task list, ase.com, Tier 1; SAE J1930 terminology, Tier 1].

**Architectures / variants that change the customer story:**
- **Single-zone vs dual-zone (or tri-zone).** One-zone systems have one blend door; a "driver cold,
  passenger warm" complaint is **only possible on dual-zone** and points squarely at a blend-door
  actuator on the affected side [MACS technical training, HVAC case/blend-door, Tier 2].
- **Blower speed control: resistor pack vs solid-state module.** A failed **blower resistor** produces
  the classic **"only works on the highest fan speed"** symptom (high speed bypasses the resistor)
  [Halderman, HVAC blower circuits, Tier 2; Standard/Blue Streak blower-resistor training, Tier 2].
- **Manual vs automatic (ATC) climate control.** ATC systems add actuators and a control head; a stuck
  actuator throws no dash light but clicks/ticks behind the dash.
- **AC auto-engage with defrost.** Most vehicles run the A/C compressor automatically in DEFROST mode
  to dehumidify — so a dead A/C compressor shows up in WINTER as **windows that won't defog**, not just
  as summer no-cool [MACS defrost/dehumidification training, Tier 2; ASE A7, Tier 1].
- **R-134a vs R-1234yf.** Post-~2015 vehicles use R-1234yf; matters for recharge/leak service, not for
  the customer's symptom phrasing (customer-voice §5 — don't over-index).
- **Evaporator is a cold, wet, dark surface** → prime site for microbial growth → the musty
  "dirty-socks" smell, worst on first A/C start and on humid days, worsened by an overdue cabin filter
  [MACS evaporator-odor training, Tier 2].

---

## 3. Failure-mode catalog (the diagnostic spine)

Each mode: sensory signature in fact-slot vocab → conditions → severity/drivability → typical
misattribution → cite.

### 3.1 No cooling — compressor not engaging (low charge / clutch / electrical)
- **Signature:** `hvac_mode=ac`, vent air is outside-temp or warm even at max cold; a **missing "click"**
  under the hood when A/C is requested; sometimes an oily/dye residue at a fitting.
- **Conditions:** total absence of cool; may be `started_when=sudden_onset` (electrical/clutch) or after
  a prior recharge (`recent_action=ac_recharge_or_service` ⇒ a leak drained it back out).
- **Severity:** `drivable_normally` (comfort) in the ordinary charge-loss/clutch/electrical case. **CARVE-OUT
  — locked/seized compressor:** if the compressor has **mechanically seized** (bearing/pump lock), the
  belt can no longer turn it and the **serpentine belt can shred or be thrown**. On most single-belt
  layouts the serpentine also drives the water pump, alternator, and power-steering pump, so a thrown belt
  takes out **cooling, charging, and steering assist** at once — this is **NOT** comfort-only; it is
  `drivable_but_concerned` → `not_drivable_needs_tow`. Extra signature: a **loud squeal / grinding on A/C
  engage, a burning-rubber smell, or belt-off** at the same time as the no-cool (see §7.4 — the noise is
  under-hood, NOT vent-routed).
- **Misattribution:** "the AC is out of freon" — often true, but a dead clutch or blown fuse presents
  identically; the customer can't tell charge-loss from electrical. The seized-compressor case is often
  misread as "just the AC" until the belt/charging/steering symptoms appear.
- **Cite:** Halderman, A/C compressor-clutch & low-charge diagnosis, Tier 2; Halderman/Gates,
  compressor seizure & serpentine-belt interaction, Tier 2; ASE A7, Tier 1.

### 3.2 Weak / inadequate cooling — partial charge, restriction, or airflow-over-condenser loss
- **Signature:** `hvac_mode=ac`, air is *somewhat* cool but not cold; classic pattern **cold on the
  highway, warm at a stoplight** (`speed_band=stopped`/`idle` better when moving — condenser airflow),
  and **cold on cool days, useless on hot days** (`weather_condition=hot_weather`).
- **Conditions:** the **cools-then-warms cycling** ("cold for 15-20 min then blows warm, then cold
  again") is a low-charge **evaporator-freeze** signature — the coil ices over, then thaws.
- **Severity:** `drivable_normally`.
- **Misattribution:** customers say "needs a recharge"; may equally be a clogged cabin filter, dirty
  condenser, or weak cooling fan.
- **Cite:** Halderman, low-refrigerant & evaporator-icing symptoms, Tier 2; MACS charge-level
  diagnosis, Tier 2.

### 3.3 AC refrigerant LEAK (the ac_leak_testing pull)
- **Signature:** same *symptom* as 3.1/3.2 (warm or weak) but with a **history of losing charge** —
  "recharged in May, already warm again," "keeps needing freon," "put dye in and it quit again"
  (`recent_action=ac_recharge_or_service` + recurrence).
- **Conditions:** recurrence over weeks/months; sometimes a visible oily-dye stain.
- **Severity:** `drivable_normally`.
- **Misattribution:** customer frames it as "recharge it again"; the *service* is leak detection
  (pressure/dye/electronic), the *symptom subcategory* is still warm/weak. Confusable pair #2 (§7).
- **Cite:** ASE A7 refrigerant leak-detection task, Tier 1; MACS leak-detection (dye/electronic), Tier 2.

### 3.4 No / weak heat (HVAC-owned; cause may be cooling)
- **Signature:** `hvac_mode=heat`, heater blows cold or room-temp, or takes forever to warm, or
  **warm while moving then cold at idle** (low coolant/flow).
- **Conditions:** worst in `weather_condition=cold_weather`. **Discriminator = the temp GAUGE**:
  stays low ⇒ stuck-open thermostat/low coolant (cooling); gauge normal but cabin cold ⇒ heater core
  clog or **blend-door actuator**.
- **Severity:** `drivable_normally`.
- **Misattribution:** "heater core" when it's a stuck-open thermostat; "thermostat" when it's a blend
  door. Confusable pair #3 (§7).
- **Cite:** Halderman, heater-performance diagnosis, Tier 2; MACS heater-side training, Tier 2.

### 3.5 Weak airflow VOLUME — blower motor / blower resistor / clogged filter
> (Air *distribution* to the wrong outlets is a distinct mode-door failure — see §3.11, not here.)
- **Signature:** `airflow_state=weak_overall` or **`only_on_highest_setting`** (resistor cue) or
  `no_airflow`; temperature may be correct. `sound_or_smoke_location_zone=behind_dashboard`/`passenger_footwell`.
- **Conditions:** resistor failure = fan works ONLY on high (speeds 1-3 dead); clogged cabin filter =
  weak everywhere; debris (leaves, mouse nest) in blower housing.
- **Severity:** `drivable_normally`.
- **Misattribution:** "the AC is weak" when the AC is cold but the **volume** is low — an airflow
  problem, not a cooling problem. Confusable within HVAC (§5).
- **Cite:** Halderman, blower-motor & resistor circuits, Tier 2; Standard/Blue Streak blower-resistor
  training ("only-high-speed" symptom), Tier 2.

### 3.6 One zone wrong — blend-door actuator (dual-zone) or stuck blend door
- **Signature:** **asymmetry** — `location_side` one side, `airflow_state=uneven_temperature_between_zones`
  ("driver ice cold, passenger warm," heat OR AC, dial does nothing); often a **click/tick behind the
  dash when the temp dial moves** (`noise_descriptor=popping_or_clicking`, stripped actuator gears).
- **Conditions:** temperature wrong on one side while **airflow volume is normal**.
- **Severity:** `drivable_normally`.
- **Misattribution:** called "the AC is going out" (it isn't — one side is fine) or confused with weak
  airflow. Confusable within HVAC (§5) and with 3.5.
- **Cite:** MACS blend-door-actuator training (stripped-gear click, one-zone asymmetry), Tier 2;
  Halderman, ATC blend-door operation, Tier 2.

### 3.7 Vent odor — musty/mildew (evaporator), sweet (heater core), burning (blower)
- **Signature:** smell tied to vent airflow (`sound_or_smoke_location_zone=from_vents`).
  **Musty/dirty-socks** `smell_descriptor=musty_or_mildew`, peaks `onset_timing=at_first_turn_on`,
  worse `weather_condition=humid`, `hvac_mode=ac` (evaporator microbial growth). **Sweet/maple-syrup**
  with `hvac_mode=heat` + foggy glass + wet carpet = **leaking heater core** (cause = cooling, §7.2).
  **Burning electrical/plastic** = failing blower motor/resistor.
- **Severity:** `drivable_normally` (heater-core coolant fumes can cause headaches → `drivable_but_concerned`).
- **Misattribution:** musty vent smell filed under `smell/musty_mildew…` instead of `hvac/bad_smell_from_vents`;
  sweet vent smell chased as an external coolant leak.
- **Cite:** MACS evaporator-odor & heater-core training, Tier 2; Halderman, HVAC odor diagnosis, Tier 2.

### 3.8 Foggy / won't-defog windows
- **Signature:** persistent interior fog, defroster won't clear (`weather_condition=rainy_or_wet`/
  `cold_weather`); **greasy/oily film on the inside glass** + **wet passenger carpet** = heater-core
  leak; **won't clear even with defrost** = A/C compressor not engaging (no dehumidify) or clogged
  evaporator drain flooding the cabin; rear-glass grid not heating = **electrical** (defroster grid).
- **Conditions:** worse with more passengers (humidity load).
- **Severity:** `drivable_but_concerned` (visibility/safety).
- **Misattribution:** "wipers are bad" (that's exterior); "heater is broken" (customer leads with FOG,
  not cabin temp).
- **Cite:** MACS defrost/dehumidification training, Tier 2; ASE A7 (AC-in-defrost), Tier 1.

### 3.9 A/C condensation water — normal drain vs clogged drain flooding the cabin
- **Signature:** **clear, odorless** water (`fluid_color=clear_no_color`); a puddle **under** the car
  mid/passenger side after A/C use is **normal evaporator drainage**; water **inside on the passenger
  floor / soaked carpet when the A/C runs** = a **clogged/misrouted evaporator drain** dumping into the
  cabin.
- **Severity:** `drivable_normally` (normal drip) → `drivable_but_concerned` (interior flooding/mold).
- **Misattribution:** panic that it is a coolant leak — discriminator is **clear+odorless+watery** vs
  bright+sweet coolant. Confusable pair #5 (§7). Also the **weak-fit** of §8 (inside-cabin water).
- **Cite:** MACS evaporator-drain training, Tier 2; ASE A7, Tier 1.

### 3.10 Vent noise — clicking (actuator), rattle (debris), whistle (duct/filter), grind (blower bearing), water slosh (clogged drain)
- **Signature:** noise that **follows the HVAC controls** — changes with fan speed, vent mode, or
  recirc; `sound_or_smoke_location_zone=behind_dashboard`/`from_vents`/`passenger_footwell`.
  Clicking/ticking at start or on dial change = blend-door actuator; **whistling** at high fan = duct
  leak / clogged filter / small refrigerant chirp; rattle = debris in the blower/cowl; grind/whir =
  blower-motor bearing; **sloshing / gurgling / "water sloshing behind the dash"** (often on turns,
  accel/decel, or when the A/C runs) = **condensate backed up in a clogged/misrouted evaporator drain**
  — the classic drain-clog cue, and the audible sibling of the §8 inside-cabin water weak-fit.
- **Severity:** `drivable_normally` (the sloshing itself is benign, but the clog can progress to
  cabin flooding, §3.9/§8 — then `drivable_but_concerned`).
- **Misattribution:** compressor squeal (under-hood belt/bearing) miscalled a "vent noise" — that is
  NOT HVAC-vent-owned (§7.4); the sloshing is often dismissed as "something rolling around" when it is a
  drain clog.
- **Cite:** Halderman, HVAC noise diagnosis (blower/actuator), Tier 2; MACS evaporator-drain training
  (condensate slosh/gurgle from a plugged drain), Tier 2.

### 3.11 Air comes out the WRONG outlets — mode-door / vacuum-actuator failure
- **Signature:** airflow **VOLUME is normal**, temperature may be fine, but the air comes out the
  **wrong outlets** and **won't move when the customer changes the setting** — "stuck blowing on the
  floor," "only comes out the defrost no matter what I pick," "won't come out the dash vents." Slot:
  `airflow_state=only_one_zone_blows` (the enum's "only dash, not floor" case) with
  `sound_or_smoke_location_zone=behind_dashboard`; sometimes a **thunk/click behind the dash** when the
  mode knob is turned. On many older/European vehicles the mode doors are **vacuum-actuated**, so the
  distribution defaults to **defrost** (fail-safe) when a vacuum line cracks or the engine is under load.
- **Conditions:** distribution wrong while the fan blows normally; vacuum systems often **snap to defrost
  under hard acceleration** (a vacuum-loss tell).
- **Severity:** `drivable_normally` (defrost-stuck can become a visibility nuisance in some conditions).
- **Misattribution:** called "the vents are weak" (it's distribution, not volume — §3.5) or "the heater/AC
  is broken" (temperature is often fine).
- **Cite:** Halderman, HVAC air-distribution / mode-door (electric + vacuum actuators), Tier 2; MACS
  mode-door actuator training, Tier 2.

### 3.12 Heat stuck ON / can't turn the heat off — blend door stuck full-hot
- **Signature:** in **summer with the A/C on**, the vents blow **HOT** (or the temperature won't come
  down no matter where the dial is set) — `hvac_mode=ac` but air is hot — because the **blend door is
  stuck in the full-HOT position** (routing all air across the heater core), NOT because the refrigerant
  is low. Distinct from §3.6 (that is ONE zone wrong on a dual-zone system); this is the **temperature
  control stuck hot across the board**. Often a **click/tick behind the dash** when the temp dial is
  moved (stripped blend-actuator gears) or no movement at all.
- **Conditions:** hot air with A/C selected; dial does nothing; a single-zone or both-zones-hot pattern.
- **Severity:** `drivable_normally` (comfort).
- **Misattribution:** the big one — customer (and sometimes the counter) reads "AC blows hot" as **low
  refrigerant and buys a recharge**, when the charge is fine and the fault is a blend door/actuator. This
  is a real misattribution-and-mis-spend risk that §5 must catch.
- **Cite:** Halderman, blend-door / air-mix (temperature-blend) diagnosis, Tier 2; MACS blend-door
  actuator training, Tier 2.

---

## 4. Customer-language lexicon (binds synonyms / positives)

Real-voice phrasings, source-ordered (Tekmetric corpus → forum-paraphrase → synthetic ≤30%). Full
machine form in `hvac-climate.lexicon.yaml`. Highlights (Tekmetric unless noted):

| Phrase (verbatim/near) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "A/C BLOWING WARM AIR (PERF CHECK AUTH)" | ac_blows_warm_or_hot_air | unambiguous | tekmetric |
| "CLIENT IS REPORTING AC IS NOT BLOWING COLD" | ac_blows_warm_or_hot_air | unambiguous | tekmetric |
| "AC quit all of a sudden — blows straight hot air, we just had it recharged in may" | ac_blows_warm_or_hot_air | needs-fact:recent_action (leak?) | eval/forum |
| "blows warm for about 20 mins, then will cool down" (warm→cool as stated) | ac_is_weak_not_cold_enough | unambiguous (a warm-first-then-cool pattern; the cycling probe Q567 is intentionally_empty — no slot) | tekmetric |
| "AC back to not working properly. We recharged system last July" | ac_is_weak_not_cold_enough (SERVICE routes to ac_leak_testing) | needs-fact:recent_action (recharge-recurrence = leak service) | tekmetric |
| "put in refrigerant with dye. The AC just stopped working again" | ac_blows_warm_or_hot_air (SERVICE routes to ac_leak_testing) | needs-fact:recent_action (recharge-recurrence = leak service) | tekmetric |
| "blows cold on cooler days, but hot air at 85+ degrees" | ac_is_weak_not_cold_enough | needs-fact:weather_condition | forum-paraphrase |
| "HEAT BLOWING COLD AIR" | heat_doesnt_work | unambiguous | tekmetric |
| "Heat only works when vehicle is moving, as soon as it stops goes cold" | heat_doesnt_work | needs-fact:temperature_gauge_state | tekmetric |
| "NO HEAT. GAUGE SOMETIMES GOES UP" | heat_doesnt_work / engine_temperature_light | cross-system:engine_temperature_light | tekmetric |
| "no hot air from heater antifreeze level is good" | heat_doesnt_work | needs-fact:temperature_gauge_state | forum-paraphrase |
| "blower only works on high & is very noisy" | vents_dont_blow_strongly | unambiguous | tekmetric |
| "fan only blows on the highest setting, speeds 1 2 3 do nothing" | vents_dont_blow_strongly | unambiguous | eval |
| "No air blowing from vents. Blower motor and resistor changed with no luck" | vents_dont_blow_strongly | needs-fact:airflow_state | forum-paraphrase |
| "air gets very weak after 20 min, hardly blowing even on high" | vents_dont_blow_strongly | needs-fact:started_when | forum-paraphrase |
| "nasty musty smell like dirty gym socks from the vents when I first turn the AC on" | bad_smell_from_vents | unambiguous | eval |
| "when I turn on the A/C the air stinks like a mildew order" | bad_smell_from_vents | unambiguous | forum-paraphrase |
| "BURNING SMELL WHEN TURNING ON THE A/C" | bad_smell_from_vents | needs-fact:smell_descriptor | tekmetric |
| "gym-bag smell, goes away when I turn AC off recirc" | bad_smell_from_vents | unambiguous (musty/evaporator; the recirc-dependence probe Q971 is intentionally_empty — no slot) | forum-paraphrase |
| "musty smell from the back seat carpet, especially when it rains" | musty_mildew_smell_from_vents (NOT vents) | cross-system:bad_smell_from_vents | forum-paraphrase |
| "passenger side vents blow warm but driver side is ice cold" | one_zone_works_but_another_doesnt | unambiguous | eval |
| "WORKS WELL ON THE PASSENGER SIDE BUT NOT SO WELL ON DRIVER'S SIDE" | one_zone_works_but_another_doesnt | unambiguous | tekmetric |
| "PASSENGER SIDE ONLY BLOWS LUKE-COLD, A/C CHECK OK" | one_zone_works_but_another_doesnt | needs-fact:location_side | tekmetric |
| "tick tick tick from the dash when I move the temp dial" | strange_noise_from_vents | needs-fact:noise_descriptor | eval/synthetic |
| "whistling sound coming out of the air vents at higher fan speeds" | strange_noise_from_vents | needs-fact:noise_descriptor (whistling gap) | forum-paraphrase |
| "LOUD NOISE WHEN A/C ON SEEMS TO HESITATE" | strange_noise_from_vents / compressor | cross-system:high_pitched_whining_under_the_hood | tekmetric |
| "inside of my windshield keeps fogging up when it rains, defroster barely clears it" | foggy_or_hard_to_defog_windows | needs-fact:weather_condition | eval |
| "slow drip onto the passenger side carpet when the A/C is on" | clear_odorless_puddle_water_or_ac_condensation (weak-fit §8) | cross-system:water_leaking_inside_cabin_ac_on (PROPOSED — Chris-gated, §8) | forum-paraphrase |
| "recharge a/c system" | (work-order — advisor) | null-route | tekmetric |
| "REPLACE CABIN AIR FILTER (due for service)" | (work-order — advisor) | null-route | tekmetric |

Messiness observed and preserved: ALL-CAPS Tekmetric style ("AC NOT COLD," "NO HEAT"), "freon" for
refrigerant, "recharge/recharged" as both symptom-history and request, "luke-cold," "mildew order"
(odor), gauge-vs-light conflation, mixed symptom+request ("... PERF CHECK AUTH," "... testing auth$59.99").

---

## 5. Differential & discriminating questions (binds required_facts + slots)

For each confusable pair (within-HVAC AND vs neighbors): the ONE best question + the fact slot + value.

| Pair | Best discriminating question | Slot → value |
|---|---|---|
| AC warm (zero cool) vs AC weak (partial) | "Is the air totally warm/outside-temp, or still somewhat cool just not cold enough?" | (no slot — Stage-2 description boundary; ambiguity resolved by phrasing) |
| AC weak (performance) vs AC leak (service) | "Has it been recharged before and lost its cold again, or is this the first time?" | `recent_action` → ac_recharge_or_service (+ recurrence language) |
| Weak COOLING vs weak AIRFLOW | "Is the air cold but there's barely any of it, or is plenty of air coming out but it's warm?" | `airflow_state` → weak_overall/only_on_highest_setting (airflow) vs normal (cooling) |
| Blower resistor vs blend door | "Does the fan only blow on the HIGHEST speed, or is one SIDE the wrong temperature?" | `airflow_state` → only_on_highest_setting (resistor) vs uneven_temperature_between_zones (blend door) |
| No-heat: thermostat/cooling vs heater-core/blend-door | "Does the temperature GAUGE reach its normal spot, or stay cold?" | **`temperature_gauge_state`** (cooling-proposed) → stays_low (thermostat) vs normal (heater core/actuator) |
| No-heat HVAC vs overheating (cooling) | "Is the temp gauge/light HIGH, or is it just no warm air with a normal gauge?" | **`temperature_gauge_state`** in_the_red/reading_high (cooling) vs normal (HVAC no-heat) |
| Musty smell: vent-routed vs carpet/trunk | "Does the smell come through the DASH VENTS with the fan on, or from the seats/carpet/trunk?" | `sound_or_smoke_location_zone` → from_vents (hvac) vs inside_cabin_general (smell/musty) |
| Sweet vent smell (heater core) vs external coolant | "Is the sweet smell blowing through the vents with the HEAT on, or strongest under the hood/outside?" | `sound_or_smoke_location_zone` → from_vents vs under_hood; `hvac_mode=heat` |
| Odor: does recirc change it? | "Does the smell go away when you switch to outside-air / recirculate?" | **no slot** — the air-source *dependence* is un-slottable under the presence-based mapper (§9.1); Q971/Q269 stay `intentionally_empty`, so this stays a probe |
| Wrong-outlets (mode door) vs weak airflow (volume) | "Is plenty of air coming out but the WRONG vents (stuck on defrost/floor, won't change), or is there barely any air at all?" | `airflow_state` → only_one_zone_blows (mode door, §3.11) vs weak_overall/no_airflow (volume, §3.5) |
| Heat-stuck-hot (blend door) vs low refrigerant | "With the A/C on in summer, is it blowing genuinely HOT like the heat is stuck on, or just not cold enough?" | **no clean slot** — `hvac_mode=ac` + "blows hot" phrasing (blend-door-stuck-hot, §3.12) vs partial-cool (low charge, §3.2); catches the recharge-mis-spend |
| Sloshing water behind dash (drain clog) vs other vent noise | "Is it a sloshing/gurgling WATER sound behind the dash, or a click / rattle / whistle / grind?" | `noise_descriptor` splits click/rattle/whistle/grind; **sloshing/gurgling has NO `noise_descriptor` value** (single-question, below the ≥3 bar — §9), so it stays a probe |
| Foggy-window water vs coolant | "Is the water on your floor clear and odorless like plain water, or bright and sweet?" | `fluid_color` → clear_no_color (AC drain) vs green_…pink (coolant) |
| Vent noise vs under-hood compressor squeal | "Does the noise change with the FAN speed / vent buttons, or is it a squeal from under the hood?" | `sound_or_smoke_location_zone` → behind_dashboard/from_vents (hvac) vs under_hood (belt/compressor) |
| Vent whistle (currently unnameable) | "What's the noise — clicking, rattling, GRINDING, or a WHISTLE?" | **`noise_descriptor=whistling`** (proposed value add) |

**Questions currently un-answerable in the 29 slots → §9:**
1. "Does it change when you switch to recirculate / outside air?" (asked in **five** questions — Q575,
   Q606, Q947, Q971, Q269 — across smell, weak-cool, airflow, vent-noise) — **NO slot is proposed.** A
   "current air-source mode" slot does not answer a *change-on-switch* question, and a generic
   "air-source dependence" slot would **cross-dimension wrong-skip** under the presence-based mapper (a
   customer stating a *smell* dependence would silently skip the *cooling* and *airflow* questions). Per
   `binding/required-facts-map.q1/q2`, these five stay `intentionally_empty` (§9.1).
2. "Is it a WHISTLE from the vents?" — `noise_descriptor` has squealing/hissing/buzzing but **no
   whistling** value; Q602 literally offers "whistling" as a choice → **`noise_descriptor += whistling`**
   (a value-add on the existing noise dimension — SAFE, since any noise word answers Q602).
3. Gauge-vs-heat and coolant-level questions (Q939, Q940) resolve on **`temperature_gauge_state`** and
   **`coolant_level_state`** — both proposed by the **cooling-system dossier**; this dossier references
   them (does NOT re-propose) to keep the cross-dossier registry consistent.

---

## 6. Warning lights & DTC surface

HVAC triggers **no dedicated dashboard telltale** on most vehicles — it is a comfort system, not a
monitored safety system. Consequences:
- The **A/C / snowflake button indicator light BLINKING** is a **system-fault / compressor-protection
  cue**, NOT a dash warning telltale — and it is **make-specific**: on some vehicles it signals a
  low-refrigerant lockout, but on others (e.g. Honda) a blinking A/C LED signals a **compressor
  lock / clutch fault or a general HVAC system fault**, not specifically low charge. So do **not**
  read it as "low on refrigerant" — treat it generically as an **A/C-not-engaging cue** for
  `ac_blows_warm_or_hot_air`. It is a **button LED**, so per literalness it must **NOT** be coerced into
  `warning_light_named`. [Halderman, A/C clutch-cycling & compressor-protection logic, Tier 2.] (The
  Tekmetric phrasing "the AC light and/or the recirc light will blink, but no cold air" is **linguistic
  authority only** — per source-policy.md it never supports the diagnostic reading.)
- A **no-heat complaint that co-occurs with the red engine-TEMP light** is a cooling/overheat crossover
  (`warning_light_named=temp` → `engine_temperature_light`), not an HVAC light (§7.3).
- Automatic climate control heads may show a fault/flash on the display, but customers describe the
  *symptom* (no cold, one side wrong), not a code — no reliable `warning_light_named` value here.
- Rare crossover: overheat-protection logic can **auto-shut-off the A/C/heat** ("recently my vehicle
  shut off the heat/AC automatically due to the engine getting hot" — Tekmetric); lead symptom is the
  engine heat → route cooling, not HVAC.

Net: HVAC feeds `warning_light_named` essentially **never**; do not invent one.

---

## 7. Confusable neighbors (cross-system)

1. **`ac_performance_check` (no-heat) ↔ `cooling-system` (overheat/coolant)** — **Taxonomy pair #3.**
   "No/weak heat" defaults to **HVAC**. Pull to `coolant_leak_testing` ONLY if a coolant symptom is
   also present (temp gauge abnormal, low/topped-off coolant, front puddle, sweet smell). Discriminator:
   **`temperature_gauge_state`** (stays_low ⇒ thermostat/cooling) + **`coolant_level_state`** — both
   cooling-proposed. This dossier and `cooling-system` state the **same** hedge (consistency check).
2. **`hvac/bad_smell_from_vents` (sweet, heater core) ↔ `cooling-system` (coolant smell/leak)** — the
   heater core is a cooling component, but a sweet smell **through the vents with heat on** routes HVAC;
   a sweet smell/puddle **under the hood or on the ground** routes cooling. Discriminator:
   `sound_or_smoke_location_zone` from_vents vs under_hood; `hvac_mode=heat`.
3. **`leak/clear_odorless_puddle_water_or_ac_condensation` (AC drain) ↔ `cooling-system` (coolant)** —
   **Taxonomy-adjacent.** Clear+odorless+watery = AC condensation (normal, or clogged drain = §8
   weak-fit); bright+sweet = coolant. Discriminator: `fluid_color` clear_no_color vs green_…pink +
   `smell_descriptor` null vs sweet.
4. **`hvac/strange_noise_from_vents` ↔ `noise/high_pitched_whining_under_the_hood`** — a compressor/belt
   **squeal under the hood when A/C engages** is NOT a vent noise. Discriminator: does the noise follow
   the FAN/vent controls (HVAC) or come from under the hood on A/C engagement (belt/compressor →
   `noise`). Cross-ref the NVH router.
5. **`hvac/vents_dont_blow_strongly` (blower) ↔ `electrical/accessory_doesnt_work`** — the blower motor
   is electrically driven but is **HVAC-owned**; only route electrical if the customer names a
   *non-HVAC* accessory. Blower-only → HVAC.
6. **`hvac/bad_smell_from_vents` ↔ `smell/musty_mildew_smell_from_vents`** — DB routing rule: **vent-tied
   musty → HVAC** (7 dedicated vent-odor questions); carpet/trunk/upholstery musty NOT tied to vents →
   `smell/`. Discriminator: `sound_or_smoke_location_zone` from_vents vs inside_cabin_general.
7. **`hvac/bad_smell_from_vents` (burning electrical) ↔ `smell/burning_electrical_plastic_smell`** —
   burning smell **through the vents** (blower motor/resistor) → HVAC; burning-electrical smell not
   vent-routed → `smell/`.
8. **`hvac/foggy_or_hard_to_defog_windows` ↔ `windshield_inop_testing`** — fog/defrost (HVAC) vs wiper
   mechanics (windshield service). Discriminator: fog/visibility+defroster vs wiper blade/arm/linkage.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode (§3) | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| 3.1 No cooling (compressor) | ac_performance_check | hvac | ac_blows_warm_or_hot_air | **good** |
| 3.2 Weak cooling | ac_performance_check | hvac | ac_is_weak_not_cold_enough | **good** |
| 3.3 AC refrigerant leak | ac_leak_testing (service) | hvac | ac_blows_warm_or_hot_air / ac_is_weak_not_cold_enough | good (service split; §7.2 hedge) |
| 3.4 No/weak heat | ac_performance_check | hvac | heat_doesnt_work | **good** |
| 3.5 Weak airflow (blower/resistor) | ac_performance_check | hvac | vents_dont_blow_strongly | **good** |
| 3.6 One zone wrong (blend door) | ac_performance_check | hvac | one_zone_works_but_another_doesnt | **good** |
| 3.11 Air to WRONG outlets (mode door) | ac_performance_check | hvac | vents_dont_blow_strongly | **weak** (distribution, not volume — folded via `airflow_state=only_one_zone_blows`; Q573/Q946/Q596 span it; candidate future subcat if volume grows) |
| 3.12 Heat stuck ON / AC blows hot (blend door full-hot) | ac_performance_check | hvac | ac_blows_warm_or_hot_air | good (symptom slug right; CAUSE is blend door, not refrigerant — §5 hedge prevents the recharge mis-spend) |
| 3.10 Sloshing/gurgling water behind dash (drain clog) | ac_performance_check | hvac | strange_noise_from_vents | good (noise slug right; `noise_descriptor` has no sloshing value — single-question, §9) |
| 3.7 Musty vent smell | ac_performance_check | hvac | bad_smell_from_vents | **good** |
| 3.7 Sweet vent smell (heater core) | ac_performance_check / coolant_leak_testing | hvac | bad_smell_from_vents | good (cross-owned) |
| 3.7 Burning vent smell (blower) | ac_performance_check | hvac | bad_smell_from_vents | good |
| 3.8 Foggy / won't defog | ac_performance_check | hvac | foggy_or_hard_to_defog_windows | **good** |
| 3.8 Rear-defroster grid dead (electrical) | ac_performance_check | hvac | foggy_or_hard_to_defog_windows | **weak** (electrical grid, not airflow — folded in) |
| 3.9 AC condensation (normal under-car) | ac_leak_testing | leak | clear_odorless_puddle_water_or_ac_condensation | good |
| 3.9 AC water INSIDE cabin (clogged drain) | ac_leak_testing / ac_performance_check | leak | clear_odorless_puddle_water_or_ac_condensation | **weak / NO FIT** (see below) |
| 3.10 Vent noise | ac_performance_check | hvac | strange_noise_from_vents | **good** |
| 3.10 Compressor/belt squeal (under hood) | (not HVAC) | noise | high_pitched_whining_under_the_hood | good (as rejection, §7.4) |

**The weak-fit (subcategory proposal, Chris-gated): AC water leaking INSIDE the cabin.** A customer
whose lead is **"water is pooling on my passenger floor / my carpet is soaked when the A/C runs"** has
no clean home. `clear_odorless_puddle_water_or_ac_condensation` is described as a puddle **UNDER** the
car (normal drainage) and lives in `leak`; it does not naturally receive an *interior-flooding* report,
and the `fluid_under_car_location` slot only models **under-vehicle** positions. This is a real,
recurring, and diagnostically distinct complaint (a **clogged/misrouted evaporator drain** — a genuine
repair, not "normal condensation").

→ **Proposal `stage2.subcategory.propose`: `hvac/water_leaking_inside_cabin_ac_on`** — "Clear, odorless
water pooling INSIDE the cabin (passenger/driver floor, soaked carpet), appearing when the A/C runs —
a clogged or misrouted evaporator drain, distinct from the normal clear puddle UNDER the car." Demand
evidence (real forum/linguistic authority): "slow drip onto the passenger side carpet when the A/C is
on," "floor is full of water, only when I drive with the AC on," "front passenger floorboard, water
standing under the floor mat." Until/unless Chris approves it, the **interim** binding is a
`stage2.description.revise` on `clear_odorless_puddle_water_or_ac_condensation` to explicitly claim the
inside-cabin AC-water case (see proposals.yaml), so nothing regresses.

**The rear-defroster weak-fit (noted, NOT proposed):** the rear-glass defroster grid is *electrical*
(a printed heating element), folded into `foggy_or_hard_to_defog_windows`. Low corpus volume; not worth
a new subcategory, but flagged so the router knows it is electrical, not airflow.

---

## 9. Fact-slot audit

**Slots this system uses today (existing):** `hvac_mode` (ac, heat, defrost, both_ac_and_heat, none),
`airflow_state` (weak_overall, only_on_highest_setting, only_one_zone_blows, no_airflow,
uneven_temperature_between_zones), `smell_descriptor` (musty_or_mildew, burning_electrical_or_plastic,
sweet_or_maple_syrup), `noise_descriptor` (popping_or_clicking, rattling, grinding_metallic,
humming_or_whirring), `onset_timing` (at_first_turn_on — HVAC-specific), `weather_condition`
(hot_weather, cold_weather, rainy_or_wet, humid), `speed_band` (stopped/idle for the highway-vs-stoplight
cooling cue), `recent_action` (ac_recharge_or_service), `location_side` (zone), `started_when`,
`sound_or_smoke_location_zone` (from_vents, behind_dashboard, passenger_footwell), `fluid_color`
(clear_no_color for condensation), `customer_request_type` (routine_maintenance for null-routes).

**Values customers actually state, well-covered:** "AC not cold/blows warm/hot"; "no heat/blows cold";
"only on high"; "one side cold one side warm"; "musty/dirty-socks/mildew"; "click when I change the
temp"; "foggy windows/defrost barely helps."

**Gaps → ONE value-add (existing-slot extension); the air-source slot is deliberately NOT proposed;
two slots are cross-referenced (owned by cooling):**

### 9.1 NOT proposed: an air-source slot (the presence-based mapper defeats it)
An earlier draft proposed a `hvac_air_source` slot to skip the five "does it change when you switch
recirc / fresh-air / max-AC?" questions — **Q575** (colder on recirc/max AC), **Q606** (vent noise
change fresh vs recirc), **Q947** (air stronger on recirc), **Q971** (smell go away on recirc), **Q269**
(smell fresh vs recirc). That slot is **withdrawn**. Two independent reasons, both grounded in the
`question-fact-mapper.ts` **presence-based** skip semantics (a slot skips its question whenever it holds
*any* value — no value matching):
1. **A "current air-source mode" value cannot answer a *change-on-switch* question.** Knowing the mode
   the customer is in (recirc / fresh / max-AC) says nothing about whether the symptom *changes* when
   they switch — which is exactly what all five questions ask.
2. **A generic "air-source dependence" value would cross-dimension wrong-skip.** These five questions
   span four different symptom dimensions (smell, cooling, airflow, vent-noise). Under presence-only
   matching, a customer who states a *smell* dependence ("smell goes away on recirc") would set the slot
   non-null and thereby **silently skip the cooling (Q575) and airflow (Q947) questions they never
   addressed** — a wrong-skip, which the methodology ranks strictly worse than over-asking. This is the
   same structural limiter the required-facts triage documents for the generic "fluid level" slot.

So there is **no air-source slot**, and per `binding/required-facts-map.q1` (Q575, Q606, Q947, Q971 =
NEVER) and `.q2` (Q269 = NO-SLOT) these five stay `question.intentionally_empty` (see proposals.yaml).
(Note: **Q597 is NOT one of these** — it is "clears if you add A/C to defrost?", a dehumidify probe,
itself `intentionally_empty`; the earlier "six questions incl. Q597?" list was an error.)

### 9.2 VALUE-ADD `noise_descriptor += whistling` (extend existing enum — the one live slot change)
Q602 literally offers "whistling" as a choice, and vent whistle (duct leak / clogged filter / refrigerant
chirp) is a distinct HVAC cue not covered by squealing_high_pitched (brake/belt) or hissing (vacuum/
coolant). Corpus: "whistling sound coming out of the air vents at higher fan speeds." Literal cues:
"whistling from the vents," "high-pitched whistle from the dash," "whistling noise on high fan." A
value-add on an existing *noise* dimension — **SAFE** for skipping Q602 ("what's the noise?"), since any
stated noise word answers it. (No ≥3 rule applies to a value-add.)

### 9.3 Cross-referenced (owned by cooling — this dossier neither re-proposes the slots NOR emits the question ops)
`temperature_gauge_state` + `coolant_level_state` are proposed by the `cooling-system` dossier. HVAC's
**Q939** ("does the temp gauge reach normal or stay cold") and **Q940** ("added coolant recently / tank
low") bind to them — but the `question.required_facts.set` ops for Q939/Q940 are **emitted by
`cooling-system.proposals.yaml`, which owns the slots**. To avoid Wave-C receiving duplicate ops for the
same question IDs from two dossiers, **this dossier does not emit the Q939/Q940 ops** — it only records
the dependence here.

**Deliberately NOT proposed** (fails ≥3 or not literal-cue-expressible): compressor "click"
present/absent (Q568 — binary probe, no clean slot); vent-outlet group dash/floor/defrost (Q573, Q946,
Q596 — probe-style, customers rarely state which outlet); cabin-filter service history (Q576, Q945,
Q969, Q271 — maintenance confirmatory, `recent_action` is single-select and this is rarely volunteered);
AC cools-then-warms cycling pattern (Q567 — <3 questions, not an airflow value).

---

## 10. Sources (tiered)

- **Tier 1:** ASE **A7 Heating & Air Conditioning** task list (ase.com) — refrigerant leak detection,
  AC-in-defrost dehumidification, blower/blend operation; SAE J1930 standardized HVAC terminology.
  Accessed 2026-07-18.
- **Tier 2:** Halderman, *Automotive Technology* — HVAC fundamentals, A/C compressor-clutch & low-charge
  diagnosis, A/C clutch-cycling & compressor-protection logic (blinking-indicator reading, §6),
  compressor seizure & serpentine-belt interaction (§3.1 carve-out, corroborated by Gates belt training),
  blower-motor & resistor circuits ("only-high-speed" symptom), heater-performance, air-distribution /
  mode-door operation (electric + vacuum actuators, §3.11), blend-door / air-mix temperature diagnosis
  (§3.12), HVAC odor & noise chapters. **MACS** (Mobile Air Climate Systems) technical training —
  evaporator microbial odor, blend-door-actuator (stripped-gear click / one-zone asymmetry), mode-door
  actuator, heater-core diagnosis, defrost/dehumidification, evaporator-drain (incl. condensate
  slosh/gurgle from a plugged drain, §3.10). Standard/Blue Streak blower-resistor training. Gates
  serpentine-belt / accessory-drive training. Accessed 2026-07-18.
- **Tier 3 (corroboration only):** none required — all §3 claims rest on Tier 1/2.
- **Linguistic (never cited for diagnosis):** Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json`
  (primary — 40+ HVAC utterances incl. consensus-labeled `bad_smell_from_vents`, `strange_noise_from_vents`);
  authored `eval-cases.json` ac_performance_check-001…007 + ac_leak_testing-001…006 (with the
  required_facts question IDs); `real-concerns-forums.json` "ac-heat" domain (cartalk / 2carpros /
  YourMechanic — pattern paraphrase only, no verbatim copy).

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode carries a Tier-1/2 cite (ASE A7 / Halderman / MACS / Standard).
- [x] Every lexicon/positive artifact is in customer voice with provenance; synthetic share ≤30% (the 8
  bound slugs are already enriched — I add confusable negatives, a few real positives, and slot binding,
  not bulk fills).
- [x] No over-broad synonyms (all additions ≥2 tokens or domain tokens: "blows cold then warm," "blower
  resistor," "blend door actuator," "recirculate button," "greasy film on windshield").
- [x] Every negative_example op names `routes_to`.
- [x] Fact cues are literal; the click-noise inference trap (§golden) forbids asserting a zone the
  customer never named; the button-LED is kept out of `warning_light_named` (§6).
- [x] NO air-source slot is proposed — under the presence-based mapper a mode value can't answer a
  change-on-switch question and a generic dependence slot cross-dimension wrong-skips; the five affected
  questions (Q575/Q606/Q947/Q971/Q269) stay `intentionally_empty` per required-facts-map.q1/q2 (§9.1).
  The only live slot change is the `noise_descriptor += whistling` value-add (makes Q602 answerable).
  `temperature_gauge_state` + `coolant_level_state` are cross-referenced to the cooling dossier — and the
  Q939/Q940 question ops are emitted by cooling, NOT here, so Wave-C gets no duplicates (§9.3).
- [x] Confusable pairs this system owns are addressed with a discriminating slot: AC-no-heat vs coolant
  (§7.1, temperature_gauge_state), AC-weak vs AC-leak (§7 pair #2, recent_action), blower-resistor vs
  blend-door (§5, airflow_state), plus the AC-condensation-vs-coolant and vent-noise-vs-compressor pairs.
- [x] The inside-cabin AC-water weak-fit is a Chris-gated subcategory proposal with ≥3 real utterances +
  an interim description-revise so nothing regresses.
- [x] ≥8 golden cases incl. 1 inference-trap (clicking noise → do not assert zone) and 1 null-route
  (cabin-filter work-order), plus a cross-system water-inside case and the AC-weak-vs-leak hedge case.
