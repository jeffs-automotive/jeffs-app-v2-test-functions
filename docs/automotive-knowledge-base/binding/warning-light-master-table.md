# Warning-light master table — dash telltale → subcategory + testing service

> Owned by `routers/router-warning-lights.md` (Wave B). This is the machine-referenced binding
> artifact: every dashboard telltale a US-market vehicle shows → the customer names/nicknames for it →
> the free-text `warning_light_named` value it should set → its solid-vs-flashing (and color) semantics →
> the Stage-2 subcategory slug → the Stage-1 testing service. Plus the `multiple_warning_lights_at_once`
> arbitration rule and the key-on self-test rule.
>
> Bind ONLY to the slugs/services/slots in `00-current-scheduler-taxonomy.md`. `warning_light_named` is a
> **free-text** slot (`extracted-facts.ts` line 370) — the "value" column below is the canonical lowercase
> string to normalize toward, NOT an enum. `warning_light_behavior` IS an enum: `steady_on |
> flashing_or_blinking | comes_and_goes | came_on_then_off | multiple_lights_at_once`.
>
> Consumes Wave A §6 surfaces from: abs-traction-stability, brakes-friction-hydraulic, cooling-system,
> engine-lubrication-oil, starting-charging, wheels-tires-tpms-bearings, airbag-srs-restraints,
> steering-power-steering, engine-controls-driveability, ignition-misfire, adas-driver-assist,
> hybrid-ev-high-voltage.

---

## 1. The 12 taxonomy `warning_light/*` subcategories (the binding target)

| # | Telltale | Color | Customer names / nicknames | `warning_light_named` value | Solid vs flashing meaning | Stage-2 subcategory slug | Stage-1 testing service |
|---|---|---|---|---|---|---|---|
| 1 | Check Engine / MIL | amber | "check engine light", "CEL", "engine light", "the little engine symbol", "orange/yellow engine light", "MIL", "light that looks like an engine" | `check engine` | **steady** = stored fault, drive to a shop soon; **flashing/blinking** = ACTIVE severe misfire dumping raw fuel to the cat — reduce load NOW (safety-critical) | `check_engine_light` | `check_engine_light_testing` ($179.95) |
| 2 | Service Engine Soon / Maint Reqd / wrench | amber | "service engine soon", "maintenance required", "MAINT REQD", "wrench light", "service due", "Maintenance Minder", "oil life", "service light" | `service engine soon` / `maintenance required` | steady = mileage/oil-life REMINDER, **not a fault** (reassurance, no code). NOTE: on some older/import vehicles "Service Engine Soon" IS the MIL — if the customer ties it to a drive-feel symptom, treat as CEL (#1) | `service_engine_soon_or_maintenance_required_light` | `warning_light_general` ($179.95) — a true reminder needs no test (advisor reassurance); scan only if it behaves like a MIL |
| 3 | Battery / Charging | red or amber | "battery light", "little battery symbol", "battery thing with the plus and minus", "charge light", "ALT light" | `battery` / `charge` / `alt` | **steady** = charging-system failure in progress (alternator/belt/regulator) — battery is now running the car down | `battery_charging_light` | `charging_starting_testing` ($89.95) |
| 4 | Oil Pressure | red | "oil light", "oil can light", "genie lamp light", "Aladdin lamp", "red teapot light" (misread), "oil drop icon" | `oil pressure` | **steady** = lost oil pressure NOW, STOP driving (engine-damage risk); **flicker at idle / when warm** = early low pressure. NOT the oil-life reminder (→ #2) | `oil_pressure_light` | `oil_pressure_light_testing` ($179.95) |
| 5 | Engine Temperature | **red = hot / blue = cold** | "temp light", "red thermometer thing", "wavy thermometer", "hot light", "HOT warning", "overheat light" | `temp` | **RED = overheating NOW** (urgent, pull over); **BLUE = cold engine** (normal, not a fault). A digital "ENGINE HOT — STOP SAFELY" / "COOLANT TEMP" MESSAGE counts as this light | `engine_temperature_light` | `coolant_leak_testing` ($109.95) / `coolant_leak_testing_euro` ($199.95) |
| 6 | TPMS / Low Tire Pressure | amber | "the horseshoe light", "exclamation-point tire thing", "low tire light", "tire pressure light", "the tire with the exclamation" | `TPMS` / `tire pressure` | **steady** = a tire is ≥25% low (FMVSS 138); **flash ~60–90 s then steady** = TPMS SYSTEM fault (dead/missing sensor, common after tire work) | `tpms_tire_pressure_light` | `tpms_testing` ($39.99) |
| 7 | ABS (anti-lock) | amber | "ABS light", "ABS letters in a circle", "anti-lock light" | `ABS` | **steady** = anti-lock disabled, base brakes retained (drivable); on-then-off at start = normal self-test | `abs_anti_lock_brake_light` | `abs_traction_stability_testing` ($179.95) |
| 8 | Red BRAKE / red (!) | **red** | "red brake light", "brake warning", "red exclamation", "the word BRAKE", "parking brake light", "brake fluid light", "(!) light" | `brake` | **steady with e-brake released** = base-hydraulic EMERGENCY (low fluid / pressure loss); extinguishes when e-brake fully released = benign | `brake_system_red_light` | `brake_inspection_warning_light` ($89.95) |
| 9 | Airbag / SRS | red or amber | "airbag light", "SRS light", "air bag light", "the little person with a seatbelt", "person and a ball/circle", "SRS triangle", "restraint light" | `airbag` / `srs` | brief flash at start = normal; **steady on** = SRS fault (a crash may not deploy); a repeating blink pattern = blinked fault code (some OEMs) | `airbag_srs_light` | `airbag_srs_testing` ($179.95) |
| 10 | Traction Control / Stability (TCS/ESC/ESP/VSC/DSC/VDC/StabiliTrak) | amber | "traction control light", "the squiggly car", "car with skid lines", "slip indicator", "VSC light", "StabiliTrak", "anti-skid", "TRAC OFF" | `traction control` / `stability` / `stabilitrak` / `esc` / `vsc` / `slip` | **flash = actively intervening (NORMAL, healthy)**; **steady = fault or disabled**; a steady "OFF" telltale = switched off by the button | `traction_control_stability_light` | `abs_traction_stability_testing` ($179.95) |
| 11 | Power Steering / EPS | amber (reduced) / red (lost) | "steering wheel light", "steering wheel with an exclamation point", "the power steering warning", "EPS light", "PS light" | `power steering` / `eps` | **steady** = assist fault stored; some blink on active low-voltage. Amber = reduced assist, red = assist lost | `power_steering_eps_light` | `power_steering_eps_testing` ($179.95) |
| 12 | Multiple lights at once | mixed | "a bunch of lights came on", "all the lights lit up", "the whole dash lit up", "Christmas tree", "every light on the cluster" | (list all named, comma-separated) | `warning_light_behavior=multiple_lights_at_once`. See §2 arbitration rule | `multiple_warning_lights_at_once` | `warning_light_general` ($179.95) — or `charging_starting_testing` when the cascade is a charging/voltage event (dimming + hard crank + died) |

---

## 2. The `multiple_warning_lights_at_once` arbitration rule

`multiple_warning_lights_at_once` is **not** "≥2 lights are on." Its DB description is scoped to a
**charging/alternator voltage cascade** (dim headlights, hard cranking, rough running, car dies). Route by
this ladder (first match wins):

1. **Named single safety light is the concern, siblings are corroboration.** ABS + its sibling
   traction/stability light (they share the wheel-speed-sensor network) → route to the **named light**
   (`abs_anti_lock_brake_light` or `traction_control_stability_light`), NOT multiple. Likewise a red BRAKE
   + yellow ABS pair → `brake_system_red_light` (safety-first, §3). One light naming its own downstream
   message ("no AWD", "hill assist unavailable" riding with a traction light) is still that one light.
2. **Charging/voltage cascade** — several DIFFERENT lights flare together **with electrical distress signs**
   (dimming lights, hard/slow cranking, rough running, stalled/died, "whole dash lit up then it died") →
   `multiple_warning_lights_at_once` (root cause is charging/voltage; service `charging_starting_testing`
   or `warning_light_general`). Corpus: "CUSTOMER STATES ALL THE LIGHTS ON HER INSTRUMENT CLUSTER CAME ON
   WHILE SHE WAS DRIVING", "the entire dashboard lit up… engine, TPS, brakes, cruise".
3. **Many unrelated lights, no single concern named** ("a bunch of lights", "Christmas tree", customer
   can't list them) → `multiple_warning_lights_at_once`.
4. **All-ADAS message set** (several driver-assist messages: "Lane Keep Unavailable" + "Pre-Collision
   Service Required" + "Blind Spot Error") is a SHARED-SENSOR/camera/radar fault, a DIFFERENT root cause
   than the charging cascade → route to the ADAS subcategory (proposed, see adas-driver-assist), **NOT**
   `multiple_warning_lights_at_once`. Discriminator: are the several items all named ADAS features, with no
   dimming/cranking distress?
5. **After an impact/accident** — a wheel wobble + several lights after hitting something is the situational
   bucket `after_a_recent_accident_or_impact`, not a plain multi-light electrical case.
   (`recent_action=accident_or_impact` + `warning_light_behavior=multiple_lights_at_once`.)

Discriminating fact set: `warning_light_named` (how many DISTINCT systems), `warning_light_behavior`
(`multiple_lights_at_once`), `lights_state` (`dim_or_flickering` = charging cascade), `recent_action`
(`accident_or_impact`).

---

## 3. Red-BRAKE mechanical-vs-ABS escalation rule

- A **red** light with the word BRAKE or a red (!) → base-hydraulic system → `brake_system_red_light`
  (`brake_inspection_warning_light`). Do NOT confuse with the exterior brake-LAMP bulb (§4 trap).
- A **yellow/amber** ABS light or a sliding-car/skid icon → electronic anti-lock/stability →
  `abs_anti_lock_brake_light` / `traction_control_stability_light` (`abs_traction_stability_testing`).
- **BOTH red BRAKE and yellow ABS on at once → ALWAYS route `brake_system_red_light` (safety-first).** On
  most vehicles the ABS module also runs EBD; an ABS/WSS fault that disables EBD compromises braking
  *balance*, so the module commands the red base-brake telltale too — the whole braking envelope is suspect.

---

## 4. Key-on self-test rule + the two standing inference traps

- **Self-test (`came_on_then_off`).** Every telltale illuminates at ignition-on and extinguishes within a
  few seconds once its module finishes a power-on lamp check. A light that lights then clears at start is
  NORMAL — only a light that **stays on** (or returns while driving) is a fault. Set
  `warning_light_behavior=came_on_then_off`; resolution is reassurance, not a test.
- **Trap A — dash telltale vs exterior brake LAMP bulb.** "Brake light" is ambiguous: the on-DASH red BRAKE
  telltale (`brake_system_red_light`) vs a rear brake-LAMP bulb that is burned out. A dead exterior brake
  bulb with **nothing on the dash** is a single dead electrical item → `accessory_doesnt_work`
  (`electrical_testing_general`), NEVER `brake_system_red_light` and never an advisor null-route. Corpus:
  "This brake lamp light on my dash lit up today.. any ideas? The brake lights are working."
- **Trap B — "temperature GAUGE needle" is not a warning light.** "gauge went into the red / creeping
  toward H" is a gauge reading, not a telltale; there is no current slot for it (cooling-system §9 proposes
  `temperature_gauge_state`). Still routes to the cooling service on the overheating symptom, but do NOT
  coerce it into `warning_light_named`.

---

## 5. Cross-taxonomy lights the 12 slugs do not natively cover (route notes)

| Light / message | Customer names | Routes to | Why |
|---|---|---|---|
| Hybrid master / "Check Hybrid System" / red-triangle | "red triangle of death", "exclamation triangle", "check hybrid system" | `check_engine_light` (interim) — needs HV-capable diagnosis, flag for advisor | No HV subcategory today (hybrid-ev-high-voltage §8) |
| EV "turtle" / reduced-power icon | "turtle light", "the turtle", "reduced power light" | `low_power_or_wont_accelerate_normally` (interim, Stage-2 split on `vehicle_powertrain`) | No HV subcategory today |
| "Service high voltage charging system" message | verbatim | `check_engine_light` / `battery_charging_light` — flag HV | Plain-language HV/charging DTC surfaced as a message |
| ADAS feature messages ("Lane Keep Unavailable", "Front Radar Obstruction") | "the sensor light", "collision thing", "car with waves light" | proposed ADAS subcategory (adas-driver-assist) | Not a CEL, not `multiple_*` (§2 rule 4) |
| Exterior brake-LAMP bulb out (no dash light) | "brake light is out", "need a new bulb" | `accessory_doesnt_work` (`electrical_testing_general`) | Single dead electrical item (§4 Trap A) |
| Dome/interior light stuck on | "dome light stays on" | `accessory_doesnt_work` | Single accessory, not a warning telltale |
