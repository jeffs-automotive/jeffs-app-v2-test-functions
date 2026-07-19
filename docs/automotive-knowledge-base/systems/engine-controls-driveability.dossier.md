# Engine controls & driveability — diagnostic dossier
slug: engine-controls-driveability   date: 2026-07-18
binds_services: [check_engine_light_testing, no_start_testing, warning_light_general, charging_starting_testing (boundary only)]
binds_categories: [performance, warning_light]

> This dossier owns the **sensor / PCM + drive-feel** half of engine management: how the engine
> *runs and responds* (stalling, surging, hesitation, misfire-feel, low power / limp mode, rough
> idle, hard start) and the **Check Engine Light** that reports it. It deliberately does NOT own the
> component-level depth of ignition (coils/plugs) or fuel delivery (pump/injectors/pressure) — those
> are separate dossiers that route INTO the same symptom subcategories described here. See §1 and §7.

---

## 1. Scope & boundaries

**In scope (components/functions):**
- Air & load sensing: mass airflow (MAF), manifold absolute pressure (MAP), throttle position (TPS),
  intake air temp (IAT), coolant temp (ECT) sensors; electronic throttle body / idle air control (IAC).
- Engine-position sensing: crankshaft (CKP) and camshaft (CMP) position sensors.
- Feedback / emissions sensing that drives fuel trim: O2 / air-fuel-ratio sensors, catalyst-efficiency
  monitoring (as it presents to the driver as a light + drive-feel, not the exhaust hardware itself).
- **Stage-1 home for blue/gray tailpipe smoke (oil burn):** the live catalog (taxonomy §3a) assigns
  `blue_or_gray_smoke_from_tailpipe` to `check_engine_light_testing` — the service this dossier binds.
  This dossier is therefore the *routing* owner of that smoke complaint, but it does **not** carry the
  oil-consumption failure-mode depth (worn rings/valve guides/PCV/turbo seals) — that belongs to the
  `engine-lubrication-oil` / `engine-mechanical` dossiers. Boundary row in §7 #6.
- The **PCM/ECM** logic that turns those signals into a running engine — and the **driveability
  symptoms** when a signal is wrong: stalling (at idle and under load), idle surge / RPM hunting,
  hesitation / stumble, sustained low power / limp mode, rough idle, hard-start (hot and cold), misfire
  *as the driver feels it* (bucking/jerking) and the MIL (Check Engine Light) that logs it.

**Explicitly OUT of scope (neighbor dossier that owns it):**
- **Ignition components as root cause** (spark plugs, coils, plug wires, coil-on-plug) → `ignition-system`
  dossier. This dossier owns the *symptom* (`engine_misfire_or_bucking_feeling`, `rough_idle...`); the
  ignition dossier owns coil/plug failure-mode depth. Both bind the SAME symptom slugs.
- **Fuel delivery hardware** (pump, injectors, fuel-pressure regulator, filter) → `fuel-system` dossier.
  Same symptom slugs, different root-cause depth.
- **Cranking/no-crank & charging** (battery, starter, alternator, "just clicks", dead battery, dim
  lights, battery-light stall) → `electrical-charging-starting` dossier + `charging_starting_testing`
  service. The boundary is sharp and high-value — see §7 #1.
- **Overheating / coolant loss** presenting as a stall or temp light → `cooling-system` dossier +
  `coolant_leak_testing`. See §7 #4.
- **Transmission slip** ("engine revs but the car doesn't move / doesn't pick up speed") →
  `automatic-transmission` dossier + `transmission_testing`. This is the single most important
  low-power confusable, and the two dossiers share the `transmission_behavior` slot — see §5, §7 #2, §9.
- **Exhaust/emissions hardware** (physical cat rattle, exhaust leak, EVAP hose) → `exhaust-emissions`
  dossier. A stored P0420/EVAP code with no drive-feel still routes to `check_engine_light` here; the
  *physical* exhaust noise/leak routes to exhaust.

---

## 2. System primer (expert, CITED)

Modern gasoline engines run **closed-loop electronic engine management**: the PCM continuously reads
load and position sensors, calculates injector pulse width and spark timing, and trims fueling against
O2 feedback. The driver-facing behaviors this dossier classifies are the *output* of that control loop
going wrong [Halderman, *Automotive Technology: Principles, Diagnosis, and Service*, 6th ed., ch. on
computerized engine controls, Tier 2; Bosch *Automotive Handbook*, 10th ed., "Engine management",
Tier 1].

- **Load/air sensing.** A MAF (or speed-density MAP) tells the PCM how much air is entering so it can
  match fuel. A **contaminated or failing MAF** feeds wrong airflow → the mixture goes lean or rich and
  the idle/part-throttle behavior becomes unstable (hesitation, surge, stumble) [Halderman ch. air-flow
  sensors, Tier 2; AA1Car "Idle surge", aa1car.com/library/problem_idle_surge.htm, Tier 3, accessed
  2026-07-18].
- **Idle control.** Idle speed is held by an **IAC valve** (older) or the **electronic throttle body**
  (newer). Carbon fouling or a stuck IAC causes **stalling at idle, surge/hunting, and stalling when
  the A/C or accessories load the engine** [Halderman idle-control / idle-air-control section, Tier 2;
  Standard/Blue Streak (Standard Motor Products) idle-air-control technical training, parts-manufacturer
  Tier 2, accessed 2026-07-18].
- **Unmetered air (vacuum leak).** Any air that enters *after* the MAF is unaccounted for; the PCM
  over-corrects in an endless cycle that the driver feels as **idle surge / RPM hunting** and, at part
  throttle, **hesitation** [Bosch *Automotive Handbook* mixture-formation section, Tier 1; Halderman
  driveability / vacuum-leak diagnosis, Tier 2].
- **Engine-position sensing.** The **CKP sensor** is the primary signal that lets the PCM fire spark
  and injectors at all. CKP sensors commonly fail with **heat soak**: the car runs fine cold, then
  **stalls once fully warmed / while driving and won't restart until it cools 20-30 min**, or is
  **hard to start when hot** — a classic intermittent, heat-dependent pattern [Halderman crankshaft
  position sensor / intermittent heat-related no-start diagnosis, Tier 2; Standard/Blue Streak (Standard
  Motor Products) crankshaft/camshaft position sensor technical training, parts-manufacturer Tier 2,
  accessed 2026-07-18].
- **Misfire & the MIL.** When one or more cylinders don't burn their charge, the PCM sets a misfire
  code and, on an *active, damaging* misfire, **flashes** the Check Engine Light. A flashing MIL means
  raw fuel is reaching the catalytic converter and can overheat/destroy it within minutes — the
  correct guidance is reduce load and get it inspected [artsautomotiveinc.com "How an engine misfire
  can destroy your catalytic converter", Tier 3, accessed 2026-07-18; SAE J2012 DTC framework +
  Halderman OBD-II misfire monitor, Tier 2]. Misfire ROOT CAUSE (coil vs plug vs injector vs
  compression) belongs to the ignition/fuel dossiers; the **feel** (bucking/jerking) and the **light**
  are classified here.
- **Limp mode.** On a fault the PCM judges unsafe (throttle, boost, transmission, several sensor
  faults), it enters a **fail-safe / "reduced engine power" state** — the car won't rev past a ceiling
  or exceed a low speed. Drivers describe "no power," "won't go over 40," "stuck in limp mode"
  [Halderman fail-safe/limp-in section, Tier 2].
- **Reminder vs fault light — an OEM-legend ambiguity, NOT a clean split.** Two different things get
  called "service" lights and customers conflate them:
  - A true **mileage/maintenance reminder** — the **wrench icon**, **"MAINT REQD"** (Toyota),
    **"Maintenance Minder" A/B codes** (Honda), oil-life % (GM) — is time/mileage-driven, sets no DTC,
    and clears with the service. This is what `service_engine_soon_or_maintenance_required_light` is
    *supposed* to catch.
  - But the exact phrase **"SERVICE ENGINE SOON"** is, on a large slice of the US fleet, **the MIL
    legend itself** — i.e. a stored-DTC fault light, not a reminder. On **GM** and **Nissan/Infiniti**
    (and **older Ford**) the amber MIL literally reads "SERVICE ENGINE SOON" rather than "Check Engine."
    SAE J1930 standardizes the term *malfunction indicator lamp (MIL)* and lists "Service Engine Soon"
    among the **permitted MIL legends** — it does **not** define those words as a maintenance reminder
    [SAE J1930 terminology (MIL / acceptable telltale text), Tier 2, accessed 2026-07-18; Halderman
    OBD-II / MIL section, Tier 2]. **Consequence for routing:** the words "service engine soon" alone
    (even with "drives fine") do NOT prove a reminder — on a GM/Nissan car they are the fault light.
    Disambiguate by vehicle make and/or icon (engine-outline vs wrench), and when unknown, prefer a
    scan (`check_engine_light`) over assuming a benign reminder. See §3.11 and the §5 CEL↔SES row.

---

## 3. Failure-mode catalog  (the diagnostic spine)

Each mode is written in fact-slot vocabulary. Root-cause lists are illustrative and CITED; exact
component diagnosis is the test's job, not the classifier's.

### 3.1 Stall at idle / when stopping
- **Sensory signature:** `engine_running=stalls`, `onset_timing=at_stop|when_idling`, `speed_band=idle|stopped`.
  Restarts on next crank. Often `hvac_mode=ac` (A/C load) makes it worse.
- **Modifiers:** worse warm or in `weather_condition=hot_weather`; may follow a `rough_idle` lead-in.
- **Severity / drivability:** usually `drivable_but_concerned` (restarts), occasionally `stranded_now`.
- **Typical root causes:** IAC/throttle-body carbon, vacuum leak, weak fuel pressure, failing CKP,
  bad ECT signal [Halderman idle-control, Tier 2; Standard/Blue Streak IAC training, parts-mfr Tier 2].
- **Misattribution:** customers say "transmission" because it dies coming to a stop in gear; it's engine
  idle control, not the trans.

### 3.2 Stall while driving under load
- **Sensory signature:** `engine_running=died_while_driving`, `speed_band=highway|low_speed`,
  `onset_timing=during_driving|when_accelerating`. May `sputter and lose power first` or cut with no
  warning; steering/brakes go heavy because the engine quit.
- **Severity:** `not_drivable_needs_tow` / `stranded_now` common; a safety event.
- **Typical root causes:** failing **CKP sensor** (heat soak), fuel-pump failure, ignition
  module/coil, clogged cat [Halderman no-start/stall + CKP diagnosis, Tier 2; Standard/Blue Streak
  CKP/CMP sensor training, parts-mfr Tier 2].
- **Misattribution — CRITICAL:** if a **battery/charging light** comes on with the stall and lights
  dim, this is a **charging-system (alternator) failure**, NOT engine controls → route electrical
  (§7 #1).

### 3.3 Idle surge / RPM hunting
- **Sensory signature:** `engine_running=surging`, `onset_timing=when_idling`, `speed_band=idle`. RPM
  needle oscillates smoothly up and down with the driver's foot still; at cruise the car "lurches"
  forward/back.
- **Modifiers:** often worse warm; A/C on may change it.
- **Typical root causes:** vacuum leak (most common), dirty IAC, TPS/MAF fault, fuel-pressure
  instability forcing PCM over-correction [Bosch handbook mixture formation, Tier 1; Halderman
  idle-control / driveability, Tier 2].
- **Steady HIGH idle (not hunting) — coverage note:** a *constant* high idle that sits stuck up (e.g.
  1500 rpm and holds) without oscillating is a different mode (throttle-plate/IAC stuck open, big
  vacuum leak, stuck-open purge) from the smooth up-and-down of surge. **No documented subcategory
  fits it cleanly** — `surging_or_rpms_going_up_and_down` signifies *oscillation*, not a steady offset.
  Nearest-fit routing today is `surging_or_rpms_going_up_and_down` (same service, `check_engine_light_testing`);
  logged as a coverage gap in §9 rather than force-fit silently.
- **Misattribution:** confused with rough idle (roughness, not smooth cycling) and with misfire
  (jerky/violent, not smooth). See §5.

### 3.4 Hesitation / stumble on tip-in
- **Sensory signature:** momentary pause between pressing the gas and the engine responding;
  `onset_timing=when_accelerating`. Short (a second), most noticeable off a stop / merging / passing.
- **Severity:** `drivable_normally`/`drivable_but_concerned`.
- **Typical root causes:** dirty MAF, weak ignition, vacuum leak, throttle response fault
  [Halderman driveability diagnosis, Tier 2; corroborated aa1car idle/driveability, Tier 3].
- **Misattribution:** confused with sustained low power (a *pause* vs constant weakness) and with
  misfire (smooth delay vs repeated jerks). See §5.

### 3.5 Sustained low power / limp mode
- **Sensory signature:** constant weakness; "no power," "feels like the e-brake is on," "won't rev
  past ~3000," "won't go over 40," often with a **sudden MPG drop**. `speed_band=specific_mph|all_speeds`.
- **Severity:** `drivable_but_concerned` → `not_drivable_needs_tow`.
- **Typical root causes:** PCM fail-safe/limp (throttle, boost/turbo, sensor fault), clogged cat,
  failing fuel pump, bad MAF [Halderman fail-safe + airflow-sensor sections, Tier 2].
- **Misattribution — CRITICAL:** "engine revs high but the car doesn't pick up speed" is
  **transmission slip**, not engine power loss → route transmission (§5, §7 #2). The discriminator is
  whether engine RPM rises *without* road speed.
- **Fact-slot gap:** none of the 29 slots can hold "low power / limp" today — see §9 (proposal
  `stage3.slot.value.add engine_running=low_power_or_limp`). The low-power↔transmission-slip split is
  handled by the sibling `automatic-transmission` dossier's `transmission_behavior=slipping`, NOT a new
  slot here (§9 reconciliation).

### 3.6 Rough idle (engine runs rough but stays alive)
- **Sensory signature:** `engine_running=rough_idle`, `onset_timing=when_idling`, `speed_band=idle`;
  choppy/sputtering engine note, RPM low/uneven, shudder felt through wheel/seat that smooths when moving.
- **Typical root causes:** misfiring plug/coil, vacuum leak, dirty injectors, carboned throttle body
  [Halderman driveability, Tier 2].
- **Misattribution:** vs `vibration/shaking_at_idle_while_stopped` (WHOLE CAR shakes but engine *sounds
  fine* = engine mount) and vs stall-at-idle (engine actually dies). See §5.

### 3.7 Misfire / bucking (as felt by the driver)
- **Sensory signature:** `engine_running=misfiring`, `onset_timing=when_accelerating`; repeated
  jerk-catch-jerk, "skipping a beat," worse under load/uphill, sometimes worse in
  `weather_condition=rainy_or_wet|humid`. Often `warning_light_behavior=flashing_or_blinking`.
- **Severity:** flashing MIL = active cat-damaging misfire → `drivable_but_concerned`, advise reduce
  load [artsautomotive misfire-cat, Tier 3; SAE J2012 + Halderman misfire monitor, Tier 2].
- **Root cause depth → ignition/fuel dossiers.** Classified here by feel + light.

### 3.8 Hard to start when cold
- **Sensory signature:** after sitting overnight, `engine_running=wont_start` (cranks fine, takes many
  seconds to fire), `onset_timing=cold_start`, `weather_condition=cold_weather`; may run rough the first
  minute.
- **Typical root causes:** weak battery in cold, cold-start enrichment/injector, overnight fuel-pressure
  bleed-down, ECT sensor, worn plugs [Halderman cold-start/driveability, Tier 2].

### 3.9 Hard to start when hot
- **Sensory signature:** cranks fine but slow to catch **right after driving** / a short stop;
  `onset_timing=after_warming_up`, `weather_condition=hot_weather`, often `recent_action=fuel_fill_up`
  (won't restart at the gas station). Normalizes after 20-30 min cooling.
- **Typical root causes:** heat-soaked **CKP sensor**, vapor lock / fuel-pressure regulator, leaking
  injector, heat-sensitive coil, **and a stuck-open EVAP purge (canister purge) valve** — the classic
  modern cause of the exact corpus complaint ("AFTER GETTING GAS HAS TO CRANK VEHICLE MULTIPLE TIMES").
  A purge valve that hangs open lets raw fuel vapor flood the intake during/after refueling, so the
  warm engine is flooded and cranks a long time before it catches; it typically clears once started and
  is fine cold. **Root-cause depth for this mechanism lives in the `fuel-system-evap` dossier** — this
  dossier routes the *hard-hot-start-after-fueling* symptom; EVAP owns the purge-valve failure detail
  [Halderman EVAP system / canister-purge control, Tier 2; hot-restart/CKP, Tier 2; Standard/Blue Streak
  CKP + purge-solenoid training, parts-mfr Tier 2]. Cross-ref: `fuel-system-evap` dossier.

### 3.10 Check Engine Light (MIL) as the primary complaint
- **Sensory signature:** `warning_light_named="check engine"`; behavior one of steady / flashing /
  comes-and-goes / came-on-then-off. May or may not carry a drive-feel.
- **Severity:** steady + drives fine = `drivable_normally` (still scan); flashing = severe (see 3.7).
- **Common benign trigger:** loose gas cap after `recent_action=fuel_fill_up` (EVAP) [Halderman EVAP
  monitor, Tier 2].
- **Discipline:** if the customer states NO drive symptom, do NOT infer one (see §9 inference rule).

### 3.11 "Maint Reqd" / wrench maintenance reminder (NOT a fault) — and the SES trap
- **Sensory signature (true reminder):** `warning_light_named="maintenance required"|"wrench"|"maintenance minder"`,
  `drivable_state=drivable_normally`, round-number mileage. No DTC.
- **Misattribution — CRITICAL, two directions:**
  1. Customers say "service engine soon" when they mean the MIL (any drive symptom → CEL, §5).
  2. **The phrase "SERVICE ENGINE SOON" is itself ambiguous by make** (§2): on **GM / Nissan/Infiniti /
     older Ford** it IS the MIL legend (a stored fault), not a reminder. So "SERVICE ENGINE SOON +
     drives fine" is **not** sufficient to route here — on those makes it is a real fault light.
- **Routing discipline:** route to `service_engine_soon_or_maintenance_required_light` only when EITHER
  the icon/wording is an unambiguous reminder (**wrench**, **MAINT REQD**, **Honda Maintenance Minder**,
  oil-life %) AND the car drives fine, OR the customer explicitly confirms it is a mileage/service
  reminder. When the words are the bare "service engine soon" on an unknown or GM/Nissan vehicle,
  **prefer `check_engine_light` (scan)** — do not assume benign. Any rough-run/misfire/stall/smell → CEL.

---

## 4. Customer-language lexicon (real-voice, corpus-sourced)

Source order: Tekmetric corpus → NHTSA/forum → synthetic (flagged). Full machine list in the
companion `engine-controls-driveability.lexicon.yaml`. Highlights per mode:

- **Stall (idle):** "engine dies every time I come to a stop at a red light"; "stalls out right as I
  pull up to a stop sign"; "IDLE IS DROPPING VERY LOW AND ALMOST STALLING" (Tekmetric, all-caps);
  "shut off unless I press on the gas" (forum). → `stalling_at_idle_or_when_stopping`.
- **Stall (driving):** "Car keeps stalling while driving and at idle" (Tekmetric); "VEHICLE STALLED
  OUT WHILE TURNING INTO PARKING LOT AND WOULD NOT RESTART" (Tekmetric); "the car looses power, as if
  it ran out of gas" then recovers (forum). → `stalling_while_driving_under_load`.
- **Surge:** "when in park something seems to rev up" (Tekmetric); "runs too high of an idle and idle
  searching" (forum, slang "idle searching"). → `surging_or_rpms_going_up_and_down`.
- **Hesitation:** "The engine hesitates when accelerating, but not all the time" (forum); "hesitates
  when accelerating, especially uphill" (forum); "Hesitation upon acceleration, 'sputtering' spells"
  (forum). → `hesitation_or_lag_when_accelerating`.
- **Low power / limp:** "CUSTOMER STATES THE VEHICLE DOESNT GO OVER A CERTAIN SPEED / WENT INTO LIMP
  MODE" (Tekmetric); "Car is not accelerating. The rpms only go to 3" (Tekmetric); "tow in does not
  want to accelerate" (Tekmetric); "Rogue not accelerating well and feels like it is getting stuck"
  (Tekmetric). → `low_power_or_wont_accelerate_normally`.
- **Misfire/bucking:** "Blinking check engine light, car is rumbling. Has had issues with spark plugs
  and ignition coils" (Tekmetric); "VEHICLE FEELS LIKE IT IS SKIPPING ON ACCEL (Revs up then goes)"
  (Tekmetric); "misfire on start up" (Tekmetric); "started abruptly to misfire badly at idle with poor
  gas mileage" (forum). → `engine_misfire_or_bucking_feeling`.
- **Rough idle:** "CHECK ENGINE LIGHT ON. RUNNING ROUGH" (Tekmetric); "Car idles rough shakes but
  seems to run down the road fine" (forum). → `rough_idle_or_shaking_at_a_stop`.
- **Hard cold start:** "trouble starting occasionally where it'll take a few minutes to get it going...
  hold down the accelerator" (forum); "Car had trouble turning over until given fuel while starting"
  (Tekmetric). → `hard_to_start_when_cold`.
- **Hard hot start:** "trouble starting after getting hot and being allowed to rest for 2-3 hours...
  takes longer to turn over" (forum); "AFTER GETTING GAS HAS TO CRANK VEHICLE MULTIPLE TIMES TO GET
  STARTED" (Tekmetric). → `hard_to_start_when_hot`.
- **CEL:** "Check engine light on" (Tekmetric, ubiquitous); "My check engine light keeps turning on
  and going off... not blinking" (Tekmetric, comes-and-goes); "check engine light came on right after
  I filled up with gas" (paraphrase). → `check_engine_light`.
- **Maintenance reminder:** "little wrench light on, car drives perfectly"; "MAINT REQD light just came
  on"; "Honda Maintenance Minder is showing code A1" (DB positives; unambiguous reminders). →
  `service_engine_soon_or_maintenance_required_light`. **Caveat:** bare "SERVICE ENGINE SOON, runs fine"
  is make-ambiguous — on GM/Nissan/older Ford it is the MIL, so it does NOT route here on wording alone
  (§2, §3.11).

Messiness observed and preserved in the lexicon: misspellings ("looses" power, "yo accelerate"),
all-caps Tekmetric style, part-name misuse ("clutch has failed" for a slipping automatic), mixed
symptom+request ("CHECK ENGINE LIGHT ON... TESTING AUTH $179"), and vague forms ("something seems to
rev up").

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: the ONE best discriminator, the fact slot + value that answers it.

| Confusable pair | Discriminating question | Slot + value |
|---|---|---|
| surge vs rough_idle | "Does the RPM smoothly swing up and down on its own, or is it just rough/choppy at a steady RPM?" | `engine_running` = `surging` vs `rough_idle` |
| surge vs misfire | "Is it a smooth rise-and-fall, or a violent jerk/skip?" | `engine_running` = `surging` vs `misfiring` |
| hesitation vs low_power | "A brief pause that then catches up, or constant weakness that never goes away?" | `onset_timing` = `when_accelerating` (+brief) vs sustained + `engine_running=low_power_or_limp` (proposed §9) |
| hesitation vs misfire | "A smooth momentary delay, or repeated bucking/jerking?" | `engine_running` = `misfiring` (if bucking) else null |
| low_power (engine) vs **transmission slip** | "Does the engine rev *up higher* while the car does NOT pick up speed?" | `transmission_behavior=slipping` (rev/speed split → trans) vs `engine_running=low_power_or_limp` (engine bogs / won't rev). **Slot owned by the `automatic-transmission` dossier** — see §9 reconciliation |
| stall_at_idle vs stall_under_load | "Does it die only when stopped/idling, or while you're moving?" | `engine_running=stalls`+`onset_timing=at_stop` vs `engine_running=died_while_driving`+`speed_band=highway` |
| stall_under_load vs **electrical die** | "Do the battery/charging lights come on and the dash dim right before it dies?" | `warning_light_named` contains `battery` + `lights_state=dim_or_flickering` → electrical |
| stall_at_idle vs rough_idle | "Does the engine actually shut off, or just run rough but keep running?" | `engine_running` = `stalls` vs `rough_idle` |
| rough_idle vs **engine-mount shake** | "Does the ENGINE sound rough, or does the engine sound fine but the whole car shakes?" | `engine_running=rough_idle` vs null (→ `shaking_at_idle_while_stopped`); **no slot holds "engine sounds fine, car shakes"** (candidate, §9) |
| hard_start_cold vs hard_start_hot | "After sitting overnight (cold), or right after driving (hot)?" | `onset_timing=cold_start`+`weather=cold_weather` vs `after_warming_up`+`hot_weather` |
| hard_start (cranks) vs **no-crank/click** | "Does it crank/turn over but not fire, or just click / nothing?" | `engine_running=wont_start` vs `wont_crank_just_clicks`/`no_sound_at_all` (→ electrical) |
| CEL vs SES reminder | "Engine-outline icon (a fault), or the words SERVICE ENGINE SOON / a wrench (a reminder)?" | `warning_light_named` = `check engine` vs `service engine soon`; + `drivable_state` |
| CEL+overheat vs **coolant** | "Is the temperature gauge high or a temp light on with the CEL?" | `warning_light_named` contains `temp` → cooling-system |

The low-power↔transmission-slip discrimination is currently unexpressible in the 29 slots. **This
dossier does NOT propose its own slot for it** — the sibling `automatic-transmission` dossier already
proposes `transmission_behavior` (value `slipping` = rev/speed split), which is the richer, canonical
home. This dossier reconciles to that slot and contributes only the **engine-side** value
`engine_running=low_power_or_limp` (the engine bogs / won't rev, no rev-speed split). See §9.

---

## 6. Warning lights & DTC surface

Lights this system triggers / customers name:
- **Check Engine Light / MIL** — amber engine-block outline. **Steady** = stored fault (drive to a
  shop soon); **flashing/blinking** = active misfire dumping raw fuel to the cat, reduce load NOW
  [artsautomotive misfire-cat, Tier 3; SAE J2012, Tier 2]. Customer names: "check engine light",
  "CEL", "engine light", "the little engine symbol", "orange/yellow engine light", "MIL".
- **Service Engine Soon / Maint Reqd / wrench** — a *reminder*, not a fault (§3.11). Names: "service
  engine soon", "maintenance required", "MAINT REQD", "wrench light", "service due", "Maintenance
  Minder".
- **Reduced power / limp-mode telltale** — some vehicles show a "reduced engine power" message or a
  car-with-wrench icon when the PCM limps (§3.5).
- **Traction-control / stability light flicker** — frequently comes on *briefly during a misfire*. The
  mechanism is real and citable: OBD-II misfire detection works by measuring **crankshaft-speed
  variation** (the crank momentarily decelerates on a dead cylinder), and the traction/stability system
  reads that same crank/wheel-speed irregularity as a torque/traction event, so it flickers its telltale
  during an active misfire [Halderman OBD-II misfire monitor — crankshaft-speed-fluctuation detection,
  Tier 2; SAE J2012 misfire-monitor framework, Tier 2]. Linguistic evidence (corpus, NOT a diagnostic
  cite): "TRACTION CONTROL LIGHT CAME ON AS WELL FOR A SHORT SECOND." Do not treat as a stability-system
  fault when it accompanies a misfire/stumble — see the §7 #6-adjacent note and the negative example in
  proposals.yaml.

Feeds `warning_light_named` values: `check engine`, `service engine soon`, `maintenance required`,
`reduced power`, `traction control` (secondary). Feeds `warning_light_behavior`: `steady_on`,
`flashing_or_blinking`, `comes_and_goes`, `came_on_then_off`.

Common DTC families that present as these symptoms (for the tech, not the classifier): P0100-P0104
(MAF), P0106-P0108 (MAP), P0120-P0124 (TPS), P0300-P030x (misfire), P0335-P0339 (CKP), P0340-P0344
(CMP), P0171/P0174 (lean), P0420/P0430 (catalyst), P050x (idle control) [SAE J2012 DTC framework,
Tier 2].

---

## 7. Confusable neighbors (cross-system) + discriminator

1. **`electrical-charging-starting`** — engine *dies while driving with a battery/charging light and
   dimming lights* is an **alternator/charging** failure, not engine controls. Discriminator:
   `warning_light_named` contains `battery`/`charging` + `lights_state=dim_or_flickering`. Also owns
   **no-crank/just-clicks/no-sound** (starter/battery) vs our **cranks-but-won't-fire** hard-starts.
   → routes `car_died_while_driving_electrical`, `wont_crank_just_clicks`, `slow_crank`;
   service `charging_starting_testing`.
2. **`automatic-transmission`** — "engine revs but the car doesn't move / doesn't pick up speed / RPM
   flares on a shift" is **transmission slip**. Discriminator: engine RPM rises WITHOUT road speed →
   `transmission_behavior=slipping` (the slot is proposed and OWNED by the `automatic-transmission`
   dossier; this dossier reconciles to it — §9). The engine-side counterpart, `engine_running=low_power_or_limp`,
   is the engine bogging / not being able to rev with NO rev-speed split. Customers mislabel slip as
   "clutch has failed" or "low power." → service `transmission_testing`.
3. **`ignition-system`** and **`fuel-system`** — own the *root-cause depth* of misfire, rough idle,
   hard start, stall (coil/plug vs pump/injector/pressure). They bind the SAME symptom slugs this
   dossier defines; the classifier picks the symptom, the test finds the component. No competing
   subcategory — a cross-reference, not a fork.
4. **`cooling-system`** — a stall/rough-run with a **temperature gauge high or temp light** (corpus:
   "coolant temp overheat message... then misfire") is overheating protection, route coolant.
   Discriminator: `warning_light_named` contains `temp` / customer says overheating.
5. **`exhaust-emissions`** — a stored EVAP/catalyst code or physical exhaust rattle. A code with NO
   drive-feel stays as `check_engine_light` here; a *physical* louder-exhaust/rattle routes exhaust; a
   **rotten-egg/sulfur smell** with no drive-feel routes exhaust-emissions (`rotten_egg_sulfur_smell`).
   The confusable-matrix rows for exhaust/EVAP smell are owned by the `exhaust-emissions` dossier — this
   dossier does not carry a smell negative example for them.
6. **`engine-lubrication-oil` / `engine-mechanical`** (smoke boundary) — the live catalog assigns
   **blue/gray tailpipe smoke (oil burn)** to `check_engine_light_testing`, the service THIS dossier
   binds, so a blue/gray-smoke complaint is a Stage-1 hit here. Discriminator:
   `smoke_color=blue_gray` → `check_engine_light_testing` via the `blue_or_gray_smoke_from_tailpipe`
   subcategory. But the **failure-mode depth** (worn rings/valve seals/PCV/turbo seals, oil consumption)
   is owned by `engine-lubrication-oil` / `engine-mechanical` — this dossier routes the smoke, those
   dossiers carry the mechanism. (WHITE smoke = coolant → `cooling-system`; BLACK smoke = rich fuel →
   this dossier's fuel-trim modes / `fuel-system-evap`.)

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| Stall at idle | check_engine_light_testing (acc: no_start_testing) | performance | `stalling_at_idle_or_when_stopping` | good |
| Stall under load | check_engine_light_testing / no_start_testing | performance | `stalling_while_driving_under_load` | good |
| Idle surge / hunting | check_engine_light_testing | performance | `surging_or_rpms_going_up_and_down` | good |
| Hesitation / stumble | check_engine_light_testing | performance | `hesitation_or_lag_when_accelerating` | good |
| Sustained low power / limp | check_engine_light_testing | performance | `low_power_or_wont_accelerate_normally` | good (routing) / **weak fact coverage** |
| Rough idle | check_engine_light_testing | performance | `rough_idle_or_shaking_at_a_stop` | good |
| Misfire / bucking | check_engine_light_testing | performance | `engine_misfire_or_bucking_feeling` | good |
| Hard start cold | no_start_testing (acc: check_engine_light_testing) | performance | `hard_to_start_when_cold` | good |
| Hard start hot | no_start_testing (acc: check_engine_light_testing) | performance | `hard_to_start_when_hot` | good |
| MIL primary | check_engine_light_testing | warning_light | `check_engine_light` | good |
| SES reminder | (maintenance / advisor) | warning_light | `service_engine_soon_or_maintenance_required_light` | good, but **route nuance** (no fault → maintenance/advisor, not a diagnostic fee) |
| "Revs but no speed" | transmission_testing | performance | (none here) → transmission dossier | NO FIT here (neighbor owns) |

**Catalog observations (Chris-gated — proposals, not assumptions):**
- **No subcategory NO-FITs** originate in this system — the performance + warning_light pools cover the
  driveability symptom space well. The gaps are **fact-slot coverage** (§9), not missing subcategories.
- **Stage-1 keyword gap (high value):** `check_engine_light_testing` and `no_start_testing` both have
  **EMPTY `example_keywords[]`** in the live catalog. Stage-1 leans on subcategory synonyms alone for
  these services. Proposals add real-voice keys (see proposals.yaml `stage1.keyword.add`).
- **SES routing nuance** logged for Chris: `service_engine_soon_...` binds to a warning_light testing
  service, but a pure mileage reminder needs no diagnostic test. Not changed here — flagged as a
  routing question, not a catalog op.

---

## 9. Fact-slot audit

**Slots this system uses:** `engine_running` (primary), `warning_light_named`, `warning_light_behavior`,
`onset_timing`, `speed_band`, `speed_specific_mph`, `weather_condition`, `recent_action`, `started_when`,
`hvac_mode`, `smell_descriptor`, `smoke_color`, `drivable_state`, `customer_request_type`,
`vehicle_powertrain`, `lights_state` (boundary, for the electrical discriminator).

**Values customers actually state (corpus-evidenced):**
- `engine_running`: `stalls`, `died_while_driving`, `surging`, `misfiring`, `rough_idle`, `wont_start`
  — all present in corpus.
- `onset_timing`: `at_stop`, `when_idling`, `when_accelerating`, `during_driving`, `cold_start`,
  `after_warming_up`, `intermittent`.
- `warning_light_behavior`: `steady_on`, `flashing_or_blinking`, `comes_and_goes`, `came_on_then_off`
  ("keeps turning on and going off... not blinking").

**Missing values / gaps → proposals:**
1. **`engine_running += low_power_or_limp`** (`stage3.slot.value.add`). Today NO value holds sustained
   low power / limp mode — the corpus is full of it ("went into limp mode," "rpms only go to 3,"
   "doesnt go over a certain speed," "feels like it is getting stuck"). Unlocks
   `low_power_or_wont_accelerate_normally` fact-mapping. Literal cues only (no inference).
2. **Low-power ↔ transmission-slip discriminator — reconciled to the sibling dossier's slot, NOT a new
   slot here.** An earlier draft of this dossier proposed a competing `power_delivery_feel` slot; that
   is **withdrawn**. The `automatic-transmission` dossier already proposes **`transmission_behavior`**
   (10 values incl. `slipping` = explicit rev/speed split; unlocks q995/q168/q1183/q1186 + the
   `harsh_delayed_or_no_shift` subcategory) — a richer slot that clearly clears the ≥3-question bar and
   owns the shift-quality space. Proposing a second, narrower slot for the same questions (q1183/q1186)
   would collide: Wave C / Chris cannot apply two competing slots to the same questions. **Reconciliation:**
   - The **rev/speed split** (engine revs climb, car doesn't gain speed → transmission) is expressed by
     `transmission_behavior=slipping` — canonical author is the `automatic-transmission` dossier. This
     dossier's q1183/q1186 `required_facts` ops therefore bind to `transmission_behavior` (matching the
     sibling dossier's ops exactly, so they agree rather than compete).
   - The **engine-side** counterpart (engine bogs / can't rev / hard ceiling with NO rev-speed split)
     is expressed by proposal #1's `engine_running=low_power_or_limp` — that is this dossier's real
     contribution to the discriminator. Literal cues for the engine side: "won't rev," "bogs down and
     won't climb," "no power to rev," "won't go over 40," "rpms only go to 3."

**Backlog notes (NOT formal proposals — under the ≥3 bar):**
- `fuel_economy_change` (sudden MPG drop): diagnostically real (limp/cat/fuel-trim) and corpus-present
  ("poor gas mileage," "gas mileage tanked"), but only ~2 questions (`q1185`, CEL `q376`) would use it
  — below the ≥3 slot bar. Logged for Chris.
- "engine sounds fine but the whole car shakes at idle" (engine-mount vs rough-idle discriminator,
  rough_idle `q463`): no slot holds it; single-question, below bar. Logged.
- **Steady HIGH idle (stuck high, not hunting)** (§3.3): a constant elevated idle with no oscillation
  has no matching subcategory — `surging_or_rpms_going_up_and_down` connotes oscillation, not a steady
  offset. Nearest-fit routing is `surging_or_rpms_going_up_and_down` (same service); a dedicated
  `idle_too_high_steady` subcategory or an `engine_running=high_idle` value would be a candidate, but
  corpus volume is thin — logged for Chris, not proposed.
- **`symptom_constancy` candidate slot** (touches q1182/q461): the binding maps hold q1182 as PARTIAL
  *pending* a `symptom_constancy` slot because `onset_timing` is overloaded (for a low-power complaint
  it is likely `when_accelerating`, which does not answer constant-vs-intermittent). Not proposed here —
  cross-referenced so this dossier's q1182 op stays PARTIAL, consistent with `required-facts-map.q2.md`.
- Spanish-language driveability phrasings (per style guide §5): backlog for Chris, not improvised here.

---

## 10. Sources (tiered)

Diagnostic / failure-mode claims:
- Halderman, *Automotive Technology: Principles, Diagnosis, and Service* (Pearson) — computerized
  engine controls, air-flow sensors, idle control, CKP/CMP diagnosis, misfire monitor
  (crankshaft-speed-variation detection), fail-safe/limp, EVAP canister-purge control, cold/hot-start
  diagnosis, MIL/OBD-II. **Tier 2** (standard textbook). Primary/sole-sufficient source for most
  failure-mode claims here.
- Bosch, *Automotive Handbook* (SAE International) — engine management, mixture formation. **Tier 1**
  (reference).
- SAE J1930 (terminology, incl. MIL legend text) & J2012 (DTC definitions, misfire monitor) — light
  naming, misfire/monitor framework. **Tier 2**.
- Standard Motor Products / Standard–Blue Streak — parts-manufacturer technical training on
  idle-air-control valves and crankshaft/camshaft position sensors + purge solenoids (accessed
  2026-07-18). **Tier 2** (parts-manufacturer technical training, per source-policy Tier-2 list),
  corroborating Halderman on IAC and CKP heat-soak symptom signatures.
- artsautomotiveinc.com "How an engine misfire can destroy your catalytic converter" (accessed
  2026-07-18) — flashing-MIL severity. **Tier 3**, paired with SAE J2012 + Halderman.
- aa1car.com "Idle surge problem" (accessed 2026-07-18) — **Tier 3** corroborator (paired with
  Halderman/Bosch, never sole).

Removed in the 2026-07-18 revision (source-policy denylist / not policy-recognized): thecarbuzz.com and
vehicleruns.com (listicle / content-farm shaped, no named author) and autozone.com (parts retailer
content marketing) + identifix.com free blog (not the policy's Tier-1 accessible Identifix nor an
enumerated Tier-3). The claims they had carried now rest on Halderman (Tier 2) ± Bosch (Tier 1) ±
Standard/Blue Streak (Tier 2).

Customer-language artifacts (linguistic authority, never cited for diagnosis):
- Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json` (500 labeled) — primary.
- `real-concerns-forums.json` (engine-performance / warning-lights / no-start-battery domains) —
  paraphrased patterns, provenance `forum-paraphrase`.
- Synthetic phrasings flagged `synthetic`, kept under ~30% per subcategory.

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every failure mode in §3 carries a Tier 1/2 cite (or two independent Tier 3). Uncited diagnostic
  claims: none.
- [x] Every §4/lexicon customer phrasing carries provenance; synthetic share held < 30% per subcategory
  (majority are tekmetric/forum-paraphrase).
- [x] Every negative-example op in proposals.yaml names `routes_to`.
- [x] Every synonym op is ≥2 tokens or a domain single-token (MAF, MIL, CEL, limp mode); no bare
  "noise/light/problem".
- [x] Fact cues are LITERAL — the low_power "feels like the e-brake is on" case is an inference-trap
  golden case (parking_brake_state MUST stay null).
- [x] Bound only to existing slugs/services; SES routing nuance + fuel_economy slot logged, not assumed.
- [x] ≥8 golden cases (11 total) incl. 3 inference-traps (e-brake simile → parking_brake_state null;
  CEL-drives-fine → no inferred engine_running; **bare-SES → MIL not reminder**), 1 null-route
  (spark-plug maintenance request), 1 cross-system confusable (battery/oil-light stall → electrical),
  and a clean unambiguous-reminder case (wrench/MAINT REQD → SES subcategory).
- [x] Slot proposals: 1 value-add (`engine_running=low_power_or_limp`) meets the literal-cue rule. The
  low-power↔trans-slip discriminator is **reconciled to the `automatic-transmission` dossier's
  `transmission_behavior` slot** (no competing slot proposed here — the earlier `power_delivery_feel`
  draft is withdrawn to resolve the cross-dossier collision).
- [x] Cross-dossier collision check: q1183/q1186 `required_facts` and the trans-slip Stage-1 hedge bind
  to `transmission_behavior` (dependency-annotated, since it is a proposed slot), matching the sibling
  dossier's ops rather than competing with them.
- [x] SES/MIL OEM-legend ambiguity (GM/Nissan/older Ford "SERVICE ENGINE SOON" = MIL) stated in §2 +
  §3.11 + the SES↔CEL §5 row; golden cases reflect it (no route to the reminder subcategory on bare-SES
  wording alone).
