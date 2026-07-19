# Ignition & misfire — diagnostic dossier
slug: ignition-misfire   date: 2026-07-18   binds_services: [check_engine_light_testing, warning_light_general, no_start_testing, transmission_testing]   binds_categories: [performance, warning_light]

> Scope of this dossier: the spark-ignition side of a gasoline engine's ability to fire every cylinder
> on every stroke — spark plugs, ignition coils, plug wires/boots, and the *symptoms* an ignition-side
> failure produces (active misfire, rough idle, bucking under load, hesitation, hard cold/hot start,
> flashing vs steady CEL). It does NOT own the CEL as a generic light — it owns the CEL *when a
> driveability symptom or misfire is present*, and hands the "light only, drives fine" case to the
> warning-light router.

---

## 1. Scope & boundaries

**In scope (components & functions):**
- Spark plugs (electrode wear, fouling, wrong gap/heat range), ignition coils (coil-on-plug / coil packs /
  older distributor + single coil), plug wires & boots, the secondary-ignition path generally.
- The *combustion-event* symptoms an ignition fault produces: single- or multi-cylinder **misfire**
  (bucking/jerking/"skip-a-beat"), **rough idle** from a dead/weak cylinder, **hesitation** on tip-in from
  weak spark, **hard cold/hot start** where spark breaks down with temperature, and the **flashing MIL**
  (active catalyst-damaging misfire) vs **steady MIL** (stored code, no live severe misfire).

**Out of scope (each with the owning neighbor):**
- Pure fuel-delivery no-start / injector / fuel-pump failure → **no-start / power router** (`no_start_testing`);
  a *cranks-but-won't-fire* complaint is theirs, not ours.
- RPM oscillating smoothly on its own → **`surging_or_rpms_going_up_and_down`** (idle-control / vacuum, not
  a firing fault).
- Whole-car shake at idle with the engine *sounding normal* → **`shaking_at_idle_while_stopped`** (engine/
  motor mounts, vibration category).
- Steady vibration at all speeds → **`constant_vibration_that_doesnt_change_with_speed`** (driveline/imbalance).
- Sustained power loss with no jerking → **`low_power_or_wont_accelerate_normally`** (limp mode / cat / fuel).
- The CEL as a light the customer can't tie to any symptom → **warning-light router / `check_engine_light`**.
- "SERVICE ENGINE SOON / MAINT REQD" reminder → **`service_engine_soon_or_maintenance_required_light`**
  (scheduled maintenance, nothing is wrong).
- Emissions/EVAP/O2/cat efficiency codes with no misfire feel → CEL-testing service, but *not* an
  ignition-misfire subcategory.

---

## 2. System primer (expert, CITED)

A modern US-market spark-ignition engine fires each cylinder by dumping ~15–40 kV across the spark-plug gap
at a precise crank angle. The high voltage is made by an **ignition coil** (a step-up transformer switched by
the ECU) and delivered either **coil-on-plug** (one coil per cylinder, dominant since ~2005), **coil-pack /
waste-spark** (one coil fires two cylinders), or on older vehicles a **single coil + distributor**
[Halderman, *Automotive Technology / Advanced Engine Performance*, Tier 2, accessed 2026-07-18].

A **misfire** is any combustion event that fails to occur or is incomplete. The OBD-II **misfire monitor**
detects it by watching tiny crankshaft *decelerations* — when a cylinder doesn't contribute, the crank
briefly slows, and the ECU attributes the miss to a specific cylinder
[Halderman, *Advanced Engine Performance Diagnosis*, Tier 2 — the OEM/CARB OBD-II misfire-detection method
is textbook/regulatory material, NOT specified by SAE J1979 (diagnostic services) or J2012 (DTC codes); the
P030x codes it *reports into* are defined by SAE J2012, Tier 1]. Root causes fall into three buckets:
**ignition** (worn/fouled plug, weak/dead coil, cracked boot/wire), **fuel** (clogged/leaking injector,
lean/rich), and **mechanical** (low compression, vacuum leak). The single most common and most
customer-relatable is ignition-side: plugs are a wear item and coils fail with age/heat
[Halderman, *Automotive Technology*, Tier 2].

The classic isolation test is the **coil / plug swap**: move the suspect coil (or plug) to an adjacent
cylinder; if the misfire *follows* the part, that part is bad — one of the cleanest field confirmations of a
coil vs. a cylinder-mechanical problem [Halderman, *Advanced Engine Performance Diagnosis*, Tier 2]. Spark
plugs are a scheduled wear item whose replacement interval varies by plug type and OEM spec [Halderman,
Tier 2]; Jeff's real corpus shows the *shop* setting its own intervals ("due every 40k/50k") on the RO
lines (`real-concerns-tekmetric-labeled-v2.json` — linguistic evidence of shop/customer voice, NOT a
maintenance-fact source).

**Notable variants the classifier must not over-fit to:** turbocharged/GDI engines misfire more readily
under boost and carbon-foul intake valves; diesels have *no spark system* (a "diesel misfire" is
compression/injector, never a plug/coil) — so `vehicle_powertrain=diesel` should suppress spark-plug
language.

---

## 3. Failure-mode catalog (the diagnostic spine, CITED per mode)

**FM-1 — Worn/fouled spark plug(s) (single or all cylinders).**
- Sensory signature: `engine_running=misfiring` or `rough_idle`; sometimes `smell_descriptor=gasoline_or_fuel`
  (raw fuel from the dead cylinder). NOTE: exhaust "popping" is a technician-facing cue and is **not** bound
  to `noise_descriptor` — that slot's `popping_or_clicking` value is reserved for the CV-joint-on-turns cue
  (see `extracted-facts.ts`), so binding it to a misfire signature would mistrain the extractor.
- Modifiers: worsens under load (`onset_timing=when_accelerating`), can be worse when cold before plugs heat.
- Severity/drivability: usually `drivable_but_concerned`; not an emergency unless CEL flashes.
- Misattribution: customers say "needs a tune-up" or blame "bad gas."
- Source: [Halderman, *Automotive Technology* / *Advanced Engine Performance Diagnosis*, Tier 2].

**FM-2 — Failing ignition coil (coil-on-plug or coil pack).**
- Sensory signature: sudden single-cylinder `engine_running=misfiring`, `warning_light_behavior=
  flashing_or_blinking` when severe; distinct hard buck/jerk under load.
- Modifiers: **heat-sensitive** — appears when hot / under load and clears on cool-down
  (`weather_condition=hot_weather`, comes-and-goes); confirmed by the coil-swap test.
- Severity: flashing MIL = active catalyst damage, escalate to `drivable_but_concerned`/tow.
- Misattribution: "my spark plugs are bad" (often it's the coil, not the plug).
- Source: [Halderman, *Advanced Engine Performance Diagnosis*, Tier 2] (heat-sensitive coil breakdown; the
  coil-swap isolation test).

**FM-3 — Cracked plug boot / plug wire (secondary-ignition tracking).**
- Sensory signature: misfire that appears or worsens in **rain / humidity / after a car wash**
  (`weather_condition=rainy_or_wet` or `humid`, `recent_action=car_wash_or_driven_through_water`).
- Mechanism: high-voltage arcs to ground through moisture/cracks instead of jumping the gap.
- Severity: `drivable_but_concerned`.
- Misattribution: "only does it when it's wet out, must be electrical."
- Source: [Halderman, *Advanced Engine Performance Diagnosis*, Tier 2].

**FM-4 — Cold-start misfire (weak spark + cold, fouling-prone).**
- Sensory signature: `engine_running=misfiring`/`rough_idle`, `onset_timing=cold_start`,
  `weather_condition=cold_weather`; runs rough for the first minute, smooths as it warms.
- Overlaps `hard_to_start_when_cold` when it also cranks-long before firing.
- Source: [Halderman, Tier 2, accessed 2026-07-18].

**FM-5 — Hot-start / heat-soak ignition breakdown.**
- Sensory signature: hard restart right after driving; a coil breaking down with heat can present as
  `hard_to_start_when_hot` and/or a warm-engine misfire.
- Source: [Halderman, Tier 2, accessed 2026-07-18].

**FM-6 — Active severe misfire → catalytic-converter overheat (the safety mode).**
- Sensory signature: **flashing CEL** (`warning_light_behavior=flashing_or_blinking`) with hard bucking,
  loss of power, sometimes `smell_descriptor=rotten_egg_or_sulfur` (cat) or raw fuel.
- Mechanism: raw unburned fuel passes into and ignites in the catalytic converter; the ceramic substrate
  overheats and can melt down — which is why a flashing MIL means *reduce power and stop driving*
  [Halderman, *Advanced Engine Performance Diagnosis*, Tier 2]. (No specific peak-temperature figure is
  asserted; the earlier "~2,000 °F" number had no named source and is removed per `source-policy.md`.)
- Severity: highest — `drivable_but_concerned` → tow.
- Source: [Halderman, *Advanced Engine Performance Diagnosis*, Tier 2] (flashing MIL = active
  catalyst-damaging misfire); the MIL itself is defined by SAE J1930, Tier 1.

**FM-7 — Misfire secondary to a NON-ignition cause (differential awareness, not our fix).**
- Vacuum leak, dirty injector, low compression, EGR/PCV fault can all set misfire codes with an
  ignition-like feel. The classifier still routes these to CEL testing (correct); the dossier only needs the
  discriminators so it doesn't *promise* a plug/coil.
- Source: [Halderman, *Advanced Engine Performance Diagnosis*, Tier 2].

**FM-8 — Oil-fouled plugs from a valve-cover-gasket / plug-tube-seal leak into the spark-plug wells.**
- Mechanism: a failed valve-cover gasket or plug-tube seal lets engine oil seep down into the spark-plug
  wells, soaking the plug and boot so the spark leaks to ground instead of jumping the gap — a misfire whose
  *root cause* actually lives in the oil-leak system (this is the classic misfire ↔ oil-leak confuser).
- Sensory signature: `engine_running=misfiring`/`rough_idle` (usually one or two cylinders, gradual onset);
  frequently a `smell_descriptor=burnt_oil` from oil cooking on hot components, and often a co-reported oil
  spot / leak.
- Routing (chief-complaint driven): misfire/CEL feel → `check_engine_light_testing` (engine_misfire);
  visible oil leak or burnt-oil smell → `oil_leak_testing`; a customer who names **both** should hedge (§7).
- Source: [Halderman, *Automotive Technology*, Tier 2].

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Real-voice phrasings, corpus-first. (Full machine form in `ignition-misfire.lexicon.yaml`.) Provenance:
`tekmetric` = verbatim-style from `real-concerns-tekmetric-labeled-v2.json`; `synthetic` flagged, ≤30%.

| phrase | target subcat | ambiguity | provenance |
|---|---|---|---|
| "Blinking check engine light, car is rumbling. Has had issues with spark plugs and ignition coils in the past and feels similar" | engine_misfire_or_bucking_feeling | needs-fact:engine_running | tekmetric |
| "misfire on start up" | engine_misfire_or_bucking_feeling | needs-fact:onset_timing | tekmetric |
| "check engine light gave 3 codes, misfire, misfire cylinder 1, misfire cylinder 4" | check_engine_light | reported-vs-felt: routes to engine_misfire ONLY if a felt buck/skip is ALSO described; a scan-reported code alone is a CEL/light case | tekmetric |
| "customer states vehicle is shaking and bucking" | engine_misfire_or_bucking_feeling | needs-fact:onset_timing | tekmetric |
| "going up any incline the car pulls back, does a type of buck and eventually picks up" | engine_misfire_or_bucking_feeling | unambiguous | tekmetric |
| "check engine light on. running rough" | rough_idle_or_shaking_at_a_stop | needs-fact:speed_band | tekmetric |
| "no check engine light, idle is dropping very low and almost stalling" | rough_idle_or_shaking_at_a_stop | needs-fact:engine_running | tekmetric |
| "engine sputters and runs rough at red lights, rpm needle bounces all over, rotten egg smell" | rough_idle_or_shaking_at_a_stop | unambiguous | tekmetric |
| "when i step on the gas theres like a second delay before the car goes, started suddenly" | hesitation_or_lag_when_accelerating | unambiguous | tekmetric |
| "check engine light on, no driveability concerns, just the light being on" | check_engine_light | cross-system:performance | tekmetric |
| "spark plugs or poss cel testing" | (null-route / advisor) | cross-system:non-concern | tekmetric |
| "runs on 3 cylinders / feels like its skipping a beat" | engine_misfire_or_bucking_feeling | unambiguous | synthetic |
| "bucks and jerks worse when its wet out" | engine_misfire_or_bucking_feeling | needs-fact:weather_condition | synthetic |

Messiness present in-corpus and preserved: all-caps fragments ("RUNNING ROUGH"), misspellings, part-name
misuse ("coil pack" used loosely), and mixed symptom+request ("CALL TO QUOTE BEFORE WORK PLEASE" attached to
a misfire line 1357).

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: the ONE best discriminator + the fact slot that answers it.

| Pair (A vs B) | Discriminating question | Slot + value → A / → B |
|---|---|---|
| engine_misfire vs **surging** | "Does it jerk/buck violently, or do the RPMs smoothly rise & fall on their own?" | `engine_running` = `misfiring` (A) vs `surging` (B) |
| engine_misfire vs **hesitation** | "Is it a repeated jerk/skip, or one smooth pause then it goes?" | `engine_running=misfiring` + `onset_timing=when_accelerating` (A) vs hesitation has the pause but not `misfiring` (B) |
| rough_idle (engine) vs **shaking_at_idle_while_stopped** (mounts) | "Does the ENGINE sound rough/sputtery, or does the whole car shake while the engine sounds normal?" | `engine_running=rough_idle`/`misfiring` present (A) vs `engine_running=normal` (B) |
| engine_misfire vs **low_power** | "Does it buck/skip, or is it just weak with no jerking?" | `engine_running=misfiring` (A) vs absent, sustained weakness (B) |
| flashing vs steady CEL (severity) | "Is the check-engine light flashing/blinking or steady on?" | `warning_light_behavior=flashing_or_blinking` (active/severe) vs `steady_on` (stored) |
| cold misfire vs **hard_to_start_when_cold** | "Does it start fine but run rough cold, or crank a long time before it fires?" | `engine_running=misfiring`/`rough_idle` + `onset_timing=cold_start` vs `engine_running=wont_start` |
| ignition misfire vs **no-start** | "Does it start and then misfire, or crank and never fire at all?" | `engine_running=misfiring`/`rough_idle` (ours) vs `wont_start` (no_start_testing) |
| misfire vs **stalling** | "Does it buck/skip but keep running, or does the engine actually shut OFF / die?" | `engine_running=misfiring` (ours) vs `stalls` → `stalling_at_idle_or_when_stopping` (dies at a stop) / `stalling_while_driving_under_load` (dies under load) |
| wet-only misfire (boot/wire) | "Does it only act up in rain/humidity or after a car wash?" | `weather_condition=rainy_or_wet`/`humid` (+`recent_action=car_wash_or_driven_through_water`) |
| felt misfire vs **reported code / light only** | "Do YOU feel it running rough, or did a scan just report a misfire / is the light simply on?" | felt → `engine_running=misfiring` + engine_misfire; reported/scan → `check_engine_light` with `engine_running` NULL and `customer_request_type=fix_a_known_problem`/`second_opinion`. A light merely being **on** is *existence, not behavior* — `warning_light_behavior` stays NULL unless the customer says it **blinks** or **comes and goes**. — **inference trap** |

Every discriminator above is expressible in the **existing 29 slots** — no new slot is required for
ignition/misfire (see §9).

---

## 6. Warning lights & DTC surface

- **Malfunction Indicator Lamp (MIL) = the amber engine-outline "check engine" light** [SAE J1930, Tier 1].
  - **Steady on** → a stored code, no *live* severe misfire → often routes to `check_engine_light`
    (warning-light) when no driveability symptom.
  - **Flashing/blinking** → *active severe misfire, catalyst-damaging* → routes to a driveability
    subcategory (engine_misfire) with high urgency [Halderman, Tier 2; MIL defined by SAE J1930, Tier 1].
- **Customer names for it** (feed `warning_light_named`): "check engine", "CEL", "engine light", "engine
  symbol", "yellow/orange engine light", "MIL", "the light that looks like an engine".
- **DTC families a misfire sets** (technician-facing, informative only): `P0300` random/multiple misfire;
  `P0301`–`P0308` cylinder-specific; `P0350`–`P0362` coil-circuit; `P2300`+ coil-driver faults
  [SAE J2012, Tier 1 (DTC definitions); Halderman, Tier 2]. Corpus shows customers relaying these verbatim
  ("gave back 3 codes: 1 misfire, one misfire cylinder 1, one cylinder 4") — but a *relayed code with no
  felt symptom* routes to `check_engine_light`, not engine_misfire (§5 felt-vs-reported row).
- **Do NOT** treat "SERVICE ENGINE SOON" / "MAINT REQD" / wrench icon as a MIL — that is the maintenance
  reminder subcategory.

**→ Emitted ops (this section terminates in ops):** `stage1.keyword.add: flashing engine light` (the
safety-critical active-misfire signal) + `stage1.hedge.add (check_engine_light_testing ↔ warning_light_general)`
in `proposals.yaml`. `warning_light_named` is a **free-text** slot, so no `stage3.slot.value.add` op is
emitted for the customer light-name list above — it feeds extraction verbatim; and `warning_light_behavior`
is only set when the customer describes *blinking / coming-and-going*, never from a light merely being "on".

---

## 7. Confusable neighbors (cross-system)

1. **Misfire shake vs mount/imbalance shake** (the required pair). A misfire rough-idle is the *engine*
   running unevenly (`engine_running=rough_idle`/`misfiring`, choppy exhaust note, usually a CEL). A
   motor-mount shake is the *whole car* trembling while the engine itself sounds fine
   (`engine_running=normal`, no CEL) → `shaking_at_idle_while_stopped` (vibration). Constant vibration at
   *all* speeds that doesn't change is driveline/imbalance → `constant_vibration_that_doesnt_change_with_speed`.
   Discriminator: is the ENGINE rough, or is the CAR shaking with a smooth engine?
2. **Flashing vs steady CEL** (the required pair). Same light, opposite urgency and often opposite routing:
   flashing + felt symptom → engine_misfire (performance); steady + drives fine → check_engine_light
   (warning_light). Discriminator: `warning_light_behavior`.
3. **Misfire vs transmission "jerk."** "Jerks when it shifts gears" is a transmission complaint
   (`transmission_testing`); "bucks/skips under acceleration with a flashing light" is a misfire. Both are
   acceptable Stage-1 hedges (`transmission_testing` ↔ `check_engine_light_testing`). **Coverage gap:** the
   `performance` subcategory pool has **no transmission shift-quality subcategory**, so a pure shift-jerk
   complaint (corpus `tkc-262`: "jerks while switching gears in the lower gears… gets jerky when easing off
   the pedal", consensus `transmission_testing`) has no Stage-2 home. It is held by the Stage-1 hedge and
   surfaced as a **Chris-gated `stage2.subcategory.propose`** in `proposals.yaml` — it is NOT silently
   rebound into a misfire/hesitation subcategory (that would fight the Stage-1 hedge and the corpus label).
4. **Misfire vs no-start.** Starts-then-misfires (ours) vs cranks-and-never-fires (`no_start_testing`).
5. **Misfire vs oil-leak (valve-cover oil into the plug wells).** Oil-fouled plugs (FM-8) genuinely misfire,
   but the root cause is an oil leak. Chief-complaint routing: misfire/CEL feel → `check_engine_light_testing`;
   visible oil leak or `burnt_oil` smell → `oil_leak_testing`; both named → hedge across the two.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| FM-1 worn/fouled plugs (under load) | check_engine_light_testing | performance | engine_misfire_or_bucking_feeling | good |
| FM-1 worn plugs (at idle) | check_engine_light_testing | performance | rough_idle_or_shaking_at_a_stop | good |
| FM-2 failing coil | check_engine_light_testing | performance | engine_misfire_or_bucking_feeling | good |
| FM-3 wet-weather boot/wire | check_engine_light_testing | performance | engine_misfire_or_bucking_feeling | good |
| FM-4 cold-start misfire | check_engine_light_testing | performance | engine_misfire_or_bucking_feeling / hard_to_start_when_cold | good (dual) |
| FM-5 hot-start breakdown | no_start_testing / check_engine_light_testing | performance | hard_to_start_when_hot | good |
| FM-6 flashing-MIL severe misfire | check_engine_light_testing | performance / warning_light | engine_misfire_or_bucking_feeling (+ check_engine_light) | good |
| weak-spark tip-in stumble | check_engine_light_testing | performance | hesitation_or_lag_when_accelerating | good |
| CEL on, drives fine / misfire code only (no felt symptom) | check_engine_light_testing | warning_light | check_engine_light | good |
| FM-8 oil-fouled plugs (valve-cover leak into wells) | check_engine_light_testing / oil_leak_testing | performance / leak | engine_misfire_or_bucking_feeling / burnt_oil_smell | good (dual, chief-complaint routed) |
| severe misfire that STALLS the engine | check_engine_light_testing | performance | engine_misfire_or_bucking_feeling (bucks then feels like it'll die) / stalling_at_idle_or_when_stopping / stalling_while_driving_under_load (if it actually shuts off) | good |
| shift-tied jerk (customer names gears/shifting) | transmission_testing | performance | — no shift-quality Stage-2 subcategory — | **NO-FIT** → Chris-gated subcategory proposal |

**One NO-FIT row.** The ignition/misfire symptom space *itself* is fully covered by existing performance +
warning_light subcategories and the `check_engine_light_testing` service — this is primarily a *sharpening*
target. The single genuine gap sits at the misfire ↔ transmission seam: a customer who ties the jerk to
**shifting/gears** belongs at Stage-1 `transmission_testing`, but the `performance` pool has **no
shift-quality Stage-2 subcategory** to land in (corpus `tkc-262`, consensus `transmission_testing`). That is
surfaced as a Chris-gated `stage2.subcategory.propose` in `proposals.yaml`, not force-fit into a misfire
subcategory. (Compare the tire-buying gap in §5 of the taxonomy doc, also genuinely NO-FIT.)

---

## 9. Fact-slot audit

**Slots this system uses (all in the current 29):**
- `engine_running` — the workhorse: `misfiring`, `rough_idle`, `surging`, `stalls`, `wont_start`, `normal`.
  Corpus states all of these.
- `warning_light_behavior` — `flashing_or_blinking` vs `comes_and_goes` vs `came_on_then_off`;
  safety-critical discriminator, set **only** when the customer describes the behavior ("Blinking check
  engine light", "keeps coming on and off"). A light merely being "on" is *existence* → leave NULL; do NOT
  default to `steady_on`. `came_on_then_off` = appeared ONCE and is now off; two-or-more occurrences =
  `comes_and_goes`.
- `warning_light_named` — "check engine" dominant.
- `onset_timing` — `when_accelerating` (load), `when_idling`/`at_stop`, `cold_start`, `intermittent`, `always`.
- `weather_condition` — `rainy_or_wet`/`humid` (secondary-ignition tracking), `cold_weather` (cold misfire).
- `smell_descriptor` — `gasoline_or_fuel` (raw fuel), `rotten_egg_or_sulfur` (cat, corpus-attested),
  `burnt_oil` (FM-8 oil-fouled plugs).
- `recent_action` — `fuel_fill_up` ("after I got gas"), `general_service` ("spark plugs were just done").
- `speed_band` — for hesitation vs load-dependent misfire.
- `started_when` — `sudden_onset` (coil) vs `gradually` (plug wear).
- `drivable_state` — escalates on flashing MIL.
- `vehicle_powertrain` — `turbocharged` (boost misfire), `diesel` (suppress spark language).
- `customer_request_type` — `second_opinion`/`fix_a_known_problem` (relaying a prior misfire diagnosis),
  `replace_specific_part` ("just put new plugs in it").

**Missing values customers state but no slot holds:** none that change question-skipping. Self-reported
cylinder number ("cylinder 1 and 4") and "going downhill" load context are technician/edge detail — they do
NOT gate any of the 105 subcategories' questions, so **no new slot is proposed** (respecting the ≥3-question
rule). The finding is a *positive*: the ontology is sufficient for ignition/misfire, and the real lever here
is **`required_facts` tagging** (many misfire/idle/hesitation questions have empty `required_facts[]` and
force re-asking — see the `question.required_facts.set` ops in `proposals.yaml`).

---

## 10. Sources

- Halderman, *Automotive Technology* & *Advanced Engine Performance Diagnosis* (standard automotive
  textbooks) — Tier 2. Load-bearing for: the OBD-II crankshaft-deceleration misfire-detection method; misfire
  root-cause buckets (ignition/fuel/mechanical); coil variants (COP / waste-spark / distributor);
  heat-sensitive coil breakdown and the coil/plug-swap isolation test; cold-start, hot-start/heat-soak, and
  wet-weather secondary-ignition-tracking misfires; oil-fouled plugs from valve-cover/plug-well oil leakage;
  flashing MIL = active catalyst-damaging misfire (reduce power, stop driving). Textbooks are cited by
  author/title per `source-policy.md` Tier 2 — no URL/access-date applies.
- SAE J1930 (diagnostic terminology; MIL definition) & SAE J2012 (DTC code definitions, the P030x/P035x
  families) — Tier 1. Cited ONLY for terminology and DTC definitions — NOT for the misfire-detection
  algorithm, which is OEM/CARB OBD-II / textbook material (see §2).
- No web primary is cited: the parts-manufacturer training page originally referenced (NGK) blocks automated
  fetch, so per `source-policy.md` ("never fabricate a paywalled/unfetched cite; fall to Tier 2") the
  textbook Tier-2 source above carries these standard, uncontroversial claims instead.
- Linguistic authority (customer voice, NOT diagnosis): `scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json`
  (lines incl. 320, 450, 931, 1357, 2899, 5135, 6009, 9849, 9870, 10655, 11574; ids `tkc-262`, `tka-060`) +
  `eval-cases.json` + `real-concerns-forums.json` (paraphrased, `forum-paraphrase`).

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode carries a Tier 1/2 cite (no memory-only diagnostic claims).
- [x] Every synonym proposed is ≥2 tokens or a domain single-token (misfire/coil/CEL) — no bare words.
- [x] Positive examples are corpus-first, real-voice; synthetic flagged and ≤30% per subcategory (the
      previously over-synthetic `hesitation_or_lag_when_accelerating` lexicon set is diluted with real
      `tekmetric`/`forum-paraphrase` entries → now 25%). The only synthetic-by-necessity artifacts are two
      cross-system boundary **negatives** (motor-mount idle-shake; self-clearing idle RPM surge) for which
      the linguistic corpus holds **no** clean customer utterance (verified by search) — flagged `synthetic`,
      and NOT positive examples so they don't count against the per-subcategory positive cap.
- [x] Every negative_example op names `routes_to` a real subcategory slug; the one shift-jerk case that had
      no valid Stage-2 home is NOT a negative (it would fight the Stage-1 hedge) — it is a Chris-gated
      `stage2.subcategory.propose` instead.
- [x] Fact cues are literal: a reported/scan misfire does NOT set `engine_running=misfiring` (inference-trap
      cases 2 & 8); a light being "on" does NOT set `warning_light_behavior=steady_on` (existence ≠ behavior);
      two-occurrence lights are `comes_and_goes`, not `came_on_then_off`; shift-tied jerks are not rebound to
      a misfire subcategory.
- [x] 10 golden cases incl. 2 inference-traps, 1 null-route, 1 boundary (see `proposals.yaml`).
- [x] All discriminators expressible in the existing 29 slots; no slot proposed. ONE NO-FIT catalog seam
      (transmission shift-quality) is surfaced as a Chris-gated subcategory proposal, not force-fit.
- [x] Confusable pairs required by the taxonomy (misfire-shake vs mount-shake; flashing vs steady CEL) plus
      misfire ↔ transmission-shift and misfire ↔ oil-leak (FM-8) addressed in §5/§7 and emitted as
      `stage1.hedge.add` + `stage2.example.negative.add` + `stage2.subcategory.propose` ops.
