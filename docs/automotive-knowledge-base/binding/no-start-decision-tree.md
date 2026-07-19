# No-start / no-power decision tree (binding artifact)
owner: router-no-start-power   date: 2026-07-18
spine_fact: engine_running
modifier_facts: [lights_state, warning_light_named, warning_light_behavior, vehicle_powertrain, recent_action]
consumed_by: Stage-1 hedging rules + Stage-2 subcategory selection + Stage-3 required_facts wiring

> Machine-consumable form of the wont-start fork owned by `routers/router-no-start-power.md`. Keyed on the
> LITERAL `engine_running` value (what the customer said happens when they turn the key / press start), then
> refined by `lights_state`, a named `warning_light_named`, and `vehicle_powertrain`. Every leaf names a
> service + a Stage-2 subcategory slug (or `null` + a proposal) + a route. All slugs/services/enum values are
> verified against the live taxonomy snapshot (`00-current-scheduler-taxonomy.md`) and `extracted-facts.ts`
> (2026-07-18). `[PROPOSED]` marks a slug/value that does not exist yet (see `.proposals.yaml`).

---

## Enum values used (verified against extracted-facts.ts)

- `engine_running`: `wont_start` · `slow_crank` · `wont_crank_just_clicks` · `no_sound_at_all` ·
  `died_while_driving` (+ `wont_power_on_no_crank` `[PROPOSED]` by hybrid-ev).
- `lights_state`: `dim_or_flickering` · `dim_at_idle_brighten_when_revving` · `normal` · `completely_dead`.
- `warning_light_named`: FREE TEXT — match on substrings the customer states: `security`/`anti-theft`/`theft`/
  `key` (immobilizer); `battery`/`charge`/`alt` (charging); `turtle`/`reduced power`/`check hybrid system`/
  `red triangle`/`hybrid` (HV).
- `warning_light_behavior`: `flashing_or_blinking` (immobilizer active during crank) · `steady_on`.
- `vehicle_powertrain`: `hybrid` · `electric` (set ONLY on a literal "hybrid"/"electric"/"EV" statement —
  never from make/model).
- `recent_action`: `jump_started` · `battery_or_alternator_work`.

---

## Root

```
Q0 = "When you turn the key / push the start button, what actually happens?"
  → sets engine_running. If unstated, engine_running = null → ASK Q0 before routing (needs-fact:engine_running).
```

The tree is evaluated as: pick the branch by `engine_running`, then apply the branch's refinements, then
apply the two **global overrides** (OV-1 security, OV-2 hybrid) which can pull a leaf onto a delegated path.

---

## Branch A — `engine_running = wont_start`  (engine turns over normally, never fires)

Default service: **`no_start_testing`** (fuel / spark / crank-cam — the mechanical no-start).

```
A. wont_start
├─ A.sec  IF warning_light_named ∈ {security, anti-theft, theft, key}
│         AND warning_light_behavior = flashing_or_blinking (or stated flashing)
│         AND battery normal (lights_state = normal, no recent_action = jump_started)
│     → SECURITY / IMMOBILIZER no-start
│       service: no_start_testing
│       category: electrical
│       subcat: key_or_fob_not_recognized_wont_start [PROPOSED — body-glass FM-7]; interim = null
│       route: testing_service   (advisor if the shop declines key/immobilizer work)
│
├─ A.cold IF (onset cold-start: "after sitting overnight / first thing in the morning")
│         AND weather_condition = cold_weather (optional), cranks a few times, fine once warm
│     → service: no_start_testing | category: performance | subcat: hard_to_start_when_cold | route: testing_service
│
├─ A.hot  IF "right after driving + a short stop; fine after cooling 20-30 min"
│         weather_condition = hot_weather (optional), recent_action = fuel_fill_up (optional)
│     → service: no_start_testing | category: performance | subcat: hard_to_start_when_hot | route: testing_service
│
├─ A.fuel IF onset immediately after a fill-up + chugging/rough then won't start
│     → service: no_start_testing | category: performance | subcat: (no clean slug; fuel-evap FM-12)
│       route: testing_service (advisor-lean — flag for advisor if only "bad gas" is stated)
│
└─ A.bare ELSE (bare "cranks but won't start", no timing/security detail)
      → service: no_start_testing | category: performance
        subcat: cranks_but_wont_fire [PROPOSED — this router]; interim = null
        route: testing_service
```

Discriminator to LEAVE branch A: if the customer says the engine **does not turn over / turns over slowly /
just clicks / makes no sound**, `engine_running` is not `wont_start` → go to B/C/D.

---

## Branch B — `engine_running = slow_crank`  (cranks slowly, then catches)

```
B. slow_crank
   → service: charging_starting_testing | category: electrical | subcat: slow_crank_sluggish_start
     route: testing_service
   refinements (reinforce, do NOT re-route):
     - lights_state = dim_or_flickering while cranking → reinforces weak battery / high resistance
     - weather_condition = cold_weather → reinforces (cold CCA loss + thick oil)
   LITERALNESS: do NOT set onset_timing = cold_start unless "morning / after sitting overnight" is stated;
   "when it's cold out" = weather_condition only.
```

---

## Branch C — `engine_running = wont_crank_just_clicks`  (no rotation, clicking)

```
C. wont_crank_just_clicks
   service: charging_starting_testing | category: electrical
├─ C.batt  rapid clicking AND lights_state = dim_or_flickering (dash dims on the click)
│     → dead/weak battery or connection | subcat: wont_crank_just_clicks | route: testing_service
├─ C.start single/one click AND lights_state = normal (lights stay bright)
│     → bad starter / severe circuit resistance | subcat: wont_crank_just_clicks | route: testing_service
├─ C.grind grinding tied to the START attempt ("grinds like the gears aren't catching")
│     → starter pinion/flywheel | subcat: wont_crank_just_clicks | route: testing_service
│       (do NOT let this drift to the noise router — the grind is only during starting)
└─ C.drain fine all day, dead only AFTER SITTING, needs a jump repeatedly (recent_action = jump_started)
      → subcat: battery_drains_overnight | route: testing_service
```

---

## Branch D — `engine_running = no_sound_at_all`  (nothing at all on key turn)

```
D. no_sound_at_all
├─ D.dead  lights_state = completely_dead
│     → flat battery / open main cable-ground
│       service: charging_starting_testing | category: electrical | subcat: wont_crank_just_clicks
│       route: testing_service
├─ D.sw    lights BRIGHT/normal, no starter response
│     → ignition switch / safety interlock (neutral-safety / clutch switch) / open control wire
│       service: charging_starting_testing | category: electrical | subcat: wont_crank_just_clicks
│       route: testing_service
├─ D.sec   OV-1 applies (see below) → SECURITY / IMMOBILIZER starter-cut
│       service: no_start_testing | category: electrical
│       subcat: key_or_fob_not_recognized_wont_start [PROPOSED]; interim = null | route: testing_service/advisor
└─ D.hyb   OV-2 applies (see below) → HYBRID/EV won't-go-to-READY
      engine_running = wont_power_on_no_crank [PROPOSED] (falls to no_sound_at_all today)
      vehicle_powertrain = hybrid/electric
      → 12 V FIRST: service: charging_starting_testing / battery_test | category: electrical
        subcat: wont_crank_just_clicks (interim) → hybrid_or_ev_wont_power_on [PROPOSED — hybrid-ev]
        route: testing_service
      → UNLESS warning_light_named ≈ turtle/check hybrid system/red triangle: HV path
        service: check_engine_light_testing | subcat: hybrid_system_warning_light [PROPOSED] | route: testing_service/advisor
```

---

## Branch E — `engine_running = died_while_driving`  (shut off mid-drive, won't restart)

```
E. died_while_driving
├─ E.elec  lights/dash DIMMED or a battery/charge light came on BEFORE it died
│          (lights_state = dim_or_flickering OR warning_light_named ∈ {battery, charge, alt})
│     → service: charging_starting_testing | category: electrical | subcat: car_died_while_driving_electrical
│       route: testing_service
└─ E.eng   engine SPUTTERED / stumbled / lost power first, NO electrical warning
      → service: check_engine_light_testing | category: performance | subcat: stalling_while_driving_under_load
        route: testing_service
```

---

## Global overrides (apply AFTER branch selection, BEFORE finalizing)

```
OV-1  SECURITY / IMMOBILIZER
      IF warning_light_named ∈ {security, anti-theft, theft, key}
      AND battery is normal (lights_state = normal AND NOT recent_action = jump_started)
      THEN route → no_start_testing, subcat key_or_fob_not_recognized_wont_start [PROPOSED] (interim null),
      REGARDLESS of whether engine_running = wont_start (branch A) or no_sound_at_all (branch D).
      Rationale: the energy chain is fine; the ECU is inhibiting start. body-glass FM-7 / §5 D1.

OV-2  HYBRID / EV WON'T-POWER-ON
      IF vehicle_powertrain ∈ {hybrid, electric} (LITERALLY stated)
      AND the complaint is "won't power on / won't go to READY" (no engine crank)
      THEN 12 V AUX FIRST → charging_starting_testing / battery_test
      UNLESS warning_light_named ≈ {turtle, reduced power, check hybrid system, red triangle, hybrid}
             OR recent_action shows a 12 V jump did NOT fix it → HV path (check_engine_light_testing;
             hybrid_or_ev_wont_power_on / hybrid_system_warning_light [PROPOSED]).
      NEVER encode "hybrid + won't start ⇒ HV battery." hybrid-ev §3.1.
```

---

## Non-symptom / null routes (not a no-start)

```
REQ   customer_request_type present, no symptom ("just test my battery before a road trip")
      → service: battery_test | subcat: null | route: testing_service
NULL  staff work-order line ("NO START TESTING AUTH 179", "STARTING AND CHARGING SYSTEM TESTING AUTH 89")
      → stage1 empty | subcat: null | route: advisor
```

---

## Ambiguity / hedge points (when to offer clarify chips instead of a confident pick)

| Condition | Offer as clarify chips |
|---|---|
| "won't start" with `engine_running = null` (crank quality unstated) | `charging_starting_testing` + `no_start_testing` |
| bare "no start / dead", no light/crank/hybrid detail | `charging_starting_testing` + `no_start_testing` |
| "won't start" + a security/theft/key light named | `no_start_testing` (immobilizer) — but keep `charging_starting_testing` if battery state unstated |
| stated hybrid/EV "won't power on", no jump/turtle detail | `charging_starting_testing`/`battery_test` (12 V) — HV only on a named turtle/hybrid warning |
| "died while driving", precursor unstated | `charging_starting_testing` + `check_engine_light_testing` |

Each hedge is emitted as a `stage1.hedge.add` op in `routers/router-no-start-power.proposals.yaml`.
