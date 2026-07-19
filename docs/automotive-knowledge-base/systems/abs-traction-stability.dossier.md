# ABS / traction / stability electronics — diagnostic dossier
slug: abs-traction-stability   date: 2026-07-18   binds_services: [abs_traction_stability_testing, brake_inspection_warning_light]   binds_categories: [warning_light, brakes]

> Scope note: this dossier owns the three dashboard-light subcategories that share the wheel-speed-sensor
> (WSS) network — `abs_anti_lock_brake_light`, `traction_control_stability_light`, `brake_system_red_light`
> — and the single confusable that the taxonomy calls out by name: **red BRAKE light = base-hydraulic
> (mechanical) vs yellow ABS/electronic**. Base-brake mechanical faults (pad squeal, grinding, spongy pedal)
> are OUT of scope and owned by the brakes-category dossier; this dossier only touches them where a dash
> light forces the discrimination.

---

## 1. Scope & boundaries

**In scope**
- The yellow/amber **ABS** telltale and its meaning (anti-lock feature only; base brakes retained).
- The yellow/amber **traction control / stability** telltale (TCS/ESC/ESP/VSC/DSC/VDC/StabiliTrak), including
  the normal *flashing-while-intervening* behavior vs the fault *steady-on* behavior.
- The **red BRAKE / red (!) telltale** as the safety-critical base-hydraulic warning, and the decision of
  whether a red-light complaint is mechanical (parking brake, low fluid, hydraulic pressure loss) or is
  co-illuminating with ABS/electronic faults.
- The shared **wheel-speed-sensor + tone-ring + steering-angle-sensor + yaw/lateral-g** input network these
  electronics depend on, insofar as it explains WHICH light lights and why several light together.
- Routing of ABS-activation *feel* complaints (unexpected pedal pulsing/kickback at a low-speed stop) that
  originate in a failing WSS.

**Out of scope (owned elsewhere)**
- Base-brake mechanical wear — squeal, metal-on-metal grinding, brake-only vibration, soft/sinking pedal
  **with no dash light** → brakes-category dossier (`high_pitched_squealing`, `metallic_grinding`,
  `spongy_or_soft_pedal`, `pedal_sinks_to_floor`, `pulsating_or_vibrating_pedal`).
- Brake-fluid **puddle identification** (color/location of a leak on the ground) → leaks-router dossier
  (`clear_yellow_or_light_brown_puddle_brake_fluid`). This dossier only consumes fluid-leak as a *cause* of
  the red light.
- **Tire pressure (TPMS)** telltale — a different sensor system entirely → `tpms_tire_pressure_light`.
- **Power-steering / EPS** telltale → `power_steering_eps_light`. (Named here only as a co-occurring light.)
- **Exterior brake LAMP (tail-light) bulb outage** — not a dash-warning-system fault at all → routes to
  `accessory_doesnt_work` (a single dead electrical item, service `electrical_testing_general`). This is the
  ONE bulb contract used consistently across all three files (dossier / lexicon / proposals): an exterior
  brake-lamp bulb → `accessory_doesnt_work`, NEVER `brake_system_red_light` and NEVER an advisor null-route.
  Called out as an inference trap in §5 because customers conflate "brake light" (dash telltale) with "brake
  lights" (rear lamps).
- **Airbag / SRS** yellow light → `airbag_srs_light` (frequently co-illuminates on a comms-bus fault; §7).

---

## 2. System primer (expert, CITED)

Modern ABS, traction control (TCS), and electronic stability control (ESC) are three layered functions on a
**single hydraulic-electronic control unit (HECU)** fed by the same sensor set. ESC has been **federally
required on all light vehicles built for sale in the US since model year 2012** under FMVSS No. 126, so
essentially every vehicle in a US shop's modern mix carries all three functions [NHTSA FMVSS 126 / 49 CFR
571.126, Tier 1, accessed 2026-07-18].

**Shared inputs.** Each wheel carries a **wheel-speed sensor (WSS)** reading a toothed **tone/reluctor ring**
(or magnetic encoder). ESC adds a **steering-angle sensor**, a **yaw-rate / lateral-acceleration sensor**,
and brake-pressure/throttle inputs. Because ABS, TCS, and ESC all consume the WSS signals, **one bad wheel
speed sensor commonly lights the ABS light AND the traction/stability light together**, while the base
hydraulic brakes are unaffected [Bosch *Automotive Handbook*, ABS/ESP chapters, Tier 2; Standard Motor
Products / Dorman wheel-speed-sensor technical training, Tier 2, accessed 2026-07-18].

**Two WSS technologies** (not customer-facing, but explains failure patterns): older **passive / variable-
reluctance** sensors generate an AC signal only above a few mph and are prone to air-gap and tone-ring-rust
faults; modern **active (Hall-effect / magnetoresistive)** sensors read down to zero mph and fail more from
connector corrosion and wiring chafe [Bosch *Automotive Handbook*, WSS section, Tier 2, accessed 2026-07-18].

**What each light means functionally:**
- **Yellow ABS** — the anti-lock computer has set a fault and disabled anti-lock. Normal braking is retained;
  only the pump-modulated anti-lockup (the pedal pulsing you feel in a panic stop) is lost [Halderman,
  *Automotive Brake Systems*, ABS warning-lamp/operation chapter, Tier 2; Bosch *Automotive Handbook*, ABS
  section, Tier 2, accessed 2026-07-18].
- **Yellow traction/stability** — *flashes* momentarily when the system is actively cutting power / pulsing a
  brake to arrest wheel-spin or a slide (this is normal, healthy operation); stays **steady on** when a fault
  has disabled the system [Bosch *Automotive Handbook*, ESP section, Tier 2, accessed 2026-07-18].
- **Red BRAKE / red (!)** — the **base hydraulic** warning: (1) parking/e-brake still engaged, (2) brake-fluid
  reservoir below MIN (a hydraulic leak, or worn pads letting the level fall), or (3) a hydraulic
  pressure-differential / master-cylinder fault. Red = potential loss of stopping ability = do-not-drive if it
  stays on with the parking brake released [Halderman, *Automotive Brake Systems*, red brake-warning-lamp
  diagnosis, Tier 2; Erjavec, *Automotive Technology: A Systems Approach*, brake-warning-system section, Tier 2,
  accessed 2026-07-18].

**Why the red light sometimes rides with ABS.** On most vehicles the ABS module also runs **EBD** (electronic
brake-force distribution). When a wheel-speed-sensor or ABS fault disables EBD, front/rear braking balance can
no longer be electronically apportioned, so the module commands the **red** base-brake telltale (in addition
to the yellow ABS) to signal that braking *balance* — not just anti-lock — is now compromised. When both the
red and the yellow are on, the *entire* braking safety envelope is in question, so the system must always defer
to the red (safety-first) route [Halderman, *Automotive Brake Systems*, EBD + brake-warning-lamp chapter, Tier
2; Bosch *Automotive Handbook*, ABS/EBD section, Tier 2, accessed 2026-07-18].

---

## 3. Failure-mode catalog (diagnostic spine — CITED per mode)

### FM-1 — Single wheel-speed-sensor fault (corrosion / winter salt)
- **Sensory signature:** yellow ABS light `steady_on`; often traction/stability light on with it. Base brakes
  feel normal (`pedal_feel=normal`). No noise, no leak.
- **Conditions/modifiers:** onset after winter / a wet season; `warning_light_behavior` often
  `comes_and_goes` early then `steady_on`. `recent_action=car_wash_or_driven_through_water` sometimes.
- **Severity / drivability:** `drivable_but_concerned` — anti-lock/traction disabled but hydraulic braking
  intact.
- **Typical misattribution:** customers say "my brakes are going bad" — it is an electronic sensor, not the
  pads. Some assume it will fail their inspection or strand them.
- **Source:** WSS corrosion / connector contamination is a leading cause of an ABS/TCS light-on with normal
  base braking [Bosch *Automotive Handbook*, WSS section, Tier 2; Standard Motor Products / Dorman
  wheel-speed-sensor technical training (corrosion + connector failure symptoms), Tier 2, accessed 2026-07-18].
  (No source ranks it "the most cited" — an ASE A5 task list defines diagnostic scope, it does not tabulate
  cause frequency; the superlative was removed.)

### FM-2 — Wheel-speed-sensor / tone-ring damage from a pothole or curb impact
- **Sensory signature:** yellow ABS light comes on *right after* the impact; base brakes normal.
- **Conditions/modifiers:** `recent_action=hit_pothole_or_curb`; `started_when=today/just_now`;
  `warning_light_behavior=steady_on`.
- **Severity / drivability:** `drivable_but_concerned`.
- **Typical misattribution:** customer blames "the pothole messed up my brakes"; the tone ring or sensor
  air-gap changed, not the friction brakes.
- **Source:** an impact can shift a WSS air-gap or damage the tone/reluctor ring, hub, or sensor wiring — a
  change in air-gap alone corrupts the signal and sets the code [Bosch *Automotive Handbook*, WSS air-gap
  sensitivity, Tier 2; Standard Motor Products / Dorman WSS technical training (impact/tone-ring damage),
  Tier 2, accessed 2026-07-18]. The eval case `abs_traction_stability_testing-001` (yellow ABS after a big
  pothole, brakes normal) is a LINGUISTIC match only — cited for customer voice, not as diagnostic support.

### FM-3 — Unexpected ABS activation at low speed (failing WSS reading false lockup)
- **Sensory signature:** the pedal **pulses / kicks back / grinds** as the car rolls to a near-stop on dry
  pavement, as if ABS engaged on ice; may pair with an ABS light. `pedal_feel=pulsating` or `grabby`;
  `onset_timing=when_braking`; `speed_band=low_speed` (just before the stop).
- **Conditions/modifiers:** dry road (no reason for real anti-lock); intermittent early on.
- **Severity / drivability:** `drivable_but_concerned` — the car may lengthen stopping distance in that last
  few feet.
- **Typical misattribution:** "my brakes shudder / grind when I almost stop" — read as a warped-rotor or
  worn-pad complaint, but the tell is that it happens ONLY in the final creep to a stop and often with no
  light on rotors. A false WSS signal makes the ABS modulator release pressure.
- **Source:** false low-speed ABS activation is a classic degraded-WSS signature — as a wheel-speed signal
  drops out near a stop, the ABS logic misreads it as impending lockup and cycles the modulator, felt as a
  pulse/kick in the last few feet [Bosch *Automotive Handbook*, ABS control logic, Tier 2; Halderman,
  *Automotive Brake Systems*, ABS diagnosis chapter, Tier 2, accessed 2026-07-18].

### FM-4 — Traction/stability fault after tire or alignment/suspension work
- **Sensory signature:** traction/stability (TCS/ESC/VSC) light `steady_on` shortly after new tire(s) or an
  alignment; ABS may or may not be on.
- **Conditions/modifiers:** `recent_action=tire_rotation_or_replacement` (esp. ONE new tire among worn ones →
  mismatched rolling radius) **or** `recent_action=alignment` (steering-angle sensor now out of calibration)
  **or** a suspension lift/level.
- **Severity / drivability:** `drivable_but_concerned`.
- **Typical misattribution:** "the tire shop broke something" — usually a calibration / rolling-radius issue,
  not damage.
- **Source:** mismatched tire diameters and post-alignment steering-angle miscalibration are standard ESC
  fault triggers [Bosch *Automotive Handbook*, ESP inputs, Tier 2; ASE A5 ABS/ESC diagnosis, Tier 1,
  accessed 2026-07-18]. Matches eval case `abs_traction_stability_testing-002` (TCS light after one new tire)
  and the forum pattern of a light appearing after a truck was leveled.

### FM-5 — Traction/stability system OFF by button / normal intervention mistaken for a fault
- **Sensory signature:** a **TRAC OFF / stability-off** indicator is lit (steady) because the button was
  pressed, OR the light **flashes** briefly on wet/snow and the customer thinks it is broken.
- **Conditions/modifiers:** `warning_light_behavior=flashing_or_blinking` during slippery driving = normal;
  steady "off" indicator = disabled by button.
- **Severity / drivability:** `drivable_normally`.
- **Typical misattribution:** flashing-while-working is read as a malfunction; the OFF telltale is read as a
  fault.
- **Source:** ESC intervenes by flashing the telltale; a separate steady "OFF" telltale means the system is
  switched off [Bosch *Automotive Handbook*, ESP operation, Tier 2; NHTSA ESC consumer guidance, Tier 1,
  accessed 2026-07-18].

### FM-6 — Red BRAKE light: parking brake not fully released (base-hydraulic, benign)
- **Sensory signature:** red BRAKE / red (!) light on; base brakes feel normal; `parking_brake_state`
  ambiguous or `engaged_or_partially_engaged`.
- **Conditions/modifiers:** light extinguishes when the lever/pedal is fully released.
- **Severity / drivability:** `drivable_normally` once released (a dragging e-brake can cook a rear brake —
  see burning-smell neighbor).
- **Typical misattribution:** panic that the brakes are failing; often just an incompletely released e-brake.
- **Source:** an un-released (or partially released) parking brake is the first cause to rule out for a red
  brake telltale [Halderman, *Automotive Brake Systems*, red brake-warning-lamp diagnosis, Tier 2; Erjavec,
  *Automotive Technology: A Systems Approach*, brake-warning-system section, Tier 2, accessed 2026-07-18].

### FM-7 — Red BRAKE light: low brake fluid (leak OR worn pads dropping reservoir)
- **Sensory signature:** red BRAKE light on with parking brake released; pedal may feel `soft_spongy` or
  `sinks_to_floor`; may be a `clear_yellow_or_light_brown` fluid spot `under_a_wheel`.
- **Conditions/modifiers:** worsens with use; fluid tops up then drops again.
- **Severity / drivability:** `not_drivable_needs_tow` if pedal is soft/sinking with the parking brake off —
  hydraulic safety emergency.
- **Typical misattribution:** "just needs fluid" — topping off masks a leak or badly worn pads.
- **Source:** a low fluid reservoir (from a hydraulic leak or from worn pads dropping the level) is a core
  red-brake cause [Halderman, *Automotive Brake Systems*, hydraulic warning + fluid-level chapter, Tier 2;
  Erjavec, *Automotive Technology: A Systems Approach*, brake-hydraulic section, Tier 2, accessed 2026-07-18].

### FM-8 — Red BRAKE + ABS together: ABS/WSS fault that also disables EBD
- **Sensory signature:** both red BRAKE and yellow ABS `steady_on` (or intermittently together while
  driving); base braking may still work but the safety envelope is compromised.
- **Conditions/modifiers:** `warning_light_behavior=multiple_lights_at_once`; may be intermittent at highway
  speed (a marginal WSS or modulator).
- **Severity / drivability:** treat as `drivable_but_concerned` at best; route to the safety (red) service.
- **Typical misattribution:** "just the ABS thing" — the red light elevates this beyond an anti-lock nuisance.
- **Source:** on most vehicles the ABS module also performs EBD (electronic brake-force distribution); an ABS
  or wheel-speed-sensor fault that disables EBD compromises front/rear braking balance, so the module commands
  the **red** base-brake telltale alongside the yellow ABS — the standard mechanism for concurrent ABS+BRAKE
  illumination [Halderman, *Automotive Brake Systems*, EBD + brake-warning-lamp chapter, Tier 2; Bosch
  *Automotive Handbook*, ABS/EBD section, Tier 2, accessed 2026-07-18].

### FM-9 — Multi-light comms/electrical event (ABS + TCS + airbag + others together)
- **Sensory signature:** ABS, traction, airbag, and sometimes security/dash lights all light, often with
  flicker or intermittent electrical behavior; may accompany a low-voltage / bad-ground condition.
- **Conditions/modifiers:** `warning_light_behavior=multiple_lights_at_once`; intermittent; can follow battery
  work or a weak battery.
- **Severity / drivability:** varies; may become `not_drivable` if it locks the shifter or kills accessories.
- **Typical misattribution:** customer lists many lights and assumes many separate failures; usually one bus /
  power / ground fault.
- **Source:** modern chassis modules share a CAN bus and a common power/ground; a bus fault or low system
  voltage can drop a module off the network or brown-out several at once, setting multiple chassis telltales
  together with U-codes [Bosch *Automotive Handbook*, vehicle-networking / CAN + on-board-diagnostics chapters,
  Tier 2; Halderman, *Automotive Technology*, electrical/network diagnosis chapter, Tier 2, accessed
  2026-07-18]. This mode is primarily a **triage/route-away** entry, not a diagnosis this dossier owns: when
  many DIFFERENT lights are named → route to `multiple_warning_lights_at_once`, not this system (§7). (The
  forum cluster patterns are cited for customer voice only in §4, never as diagnostic corroboration.)

### FM-10 — Normal key-on lamp-check (self-test) misread as a fault
- **Sensory signature:** the ABS (or traction/stability) telltale illuminates at ignition-on and then
  **extinguishes within a few seconds** once the module completes its self-test; the vehicle is otherwise
  normal. `warning_light_behavior=came_on_then_off`; base brakes normal.
- **Conditions/modifiers:** happens every start; never stays on while driving. Distinct from `comes_and_goes`
  (an intermittent fault that returns while driving) — here the light only appears during the start-up bulb
  check.
- **Severity / drivability:** `drivable_normally` — this is designed behavior, not a fault.
- **Typical misattribution:** the customer thinks the light "came on" and something is wrong; it is the normal
  power-on lamp check. Only a light that **stays on** (or returns while driving) indicates a fault.
- **Source:** instrument-cluster / chassis modules run a power-on lamp-check self-test at ignition-on; a
  telltale that lights then clears after the self-test is normal [Bosch *Automotive Handbook*, instrument
  cluster / self-diagnosis section, Tier 2; Halderman, *Automotive Technology*, warning-lamp/self-test
  chapter, Tier 2, accessed 2026-07-18]. Enrichment cue only (no new subcategory): the `came_on_then_off`
  value on `warning_light_behavior` captures it; resolution is reassurance, not service.

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Source order: Tekmetric corpus first, forum-paraphrase second, synthetic last (flagged). Full machine form in
`abs-traction-stability.lexicon.yaml`.

| Phrase (as customers say it) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "abs / trac / no AWD message" | abs_anti_lock_brake_light | needs-fact:warning_light_named (both share WSS) | tekmetric (tkc-120) |
| "ABS & TRAC LIGHTS COMING ON ... also TPMS and airbag" | multiple_warning_lights_at_once | cross-system:multiple_warning_lights_at_once | tekmetric |
| "SERVICE STABILTRAC LIGHT ON. No other warning lights" | traction_control_stability_light | unambiguous | tekmetric |
| "TRACTION CONTROL LIGHT STAYING ON" | traction_control_stability_light | unambiguous | tekmetric |
| "ABS LIGHT ON ... STEERING FEELS MORE DIFFICULT" | abs_anti_lock_brake_light | needs-fact:warning_light_named (EPS may share) | tekmetric |
| "transmission light and esc off" | traction_control_stability_light | needs-fact:warning_light_named | tekmetric |
| "traction control light, the ABS light, and the brake light ... was blinking" (wheel wobbling) | brake_system_red_light | cross-system (red present → route red) | tekmetric |
| "RED BRAKE LIGHT WAS COMING ON AND OFF ... fluid was low, topped off, light back on" | brake_system_red_light | unambiguous | tekmetric |
| "yellow ABS light came on after I hit a big pothole, brakes still feel normal" | abs_anti_lock_brake_light | unambiguous | synthetic (eval-001, authored) |
| "little car with squiggly wavy lines under it" | traction_control_stability_light | unambiguous (icon description) | synthetic (eval-004, authored) |
| "the ABS and traction control light stays on ... after I got my truck leveled" | traction_control_stability_light | needs-fact:warning_light_named | forum-paraphrase |
| "ABS & brake light come on only between 65 and 75 on the interstate" | brake_system_red_light | cross-system:abs_anti_lock_brake_light (red present → route red) | forum-paraphrase |
| "brake lamp light on my dash lit up — but the brake lights out back are working fine" | brake_system_red_light | INFERENCE TRAP (dash BRAKE ≠ tail lamps) | forum-paraphrase |
| "one of my brake lights is out back there, need a new bulb, nothing on the dash" | accessory_doesnt_work | cross-system:accessory_doesnt_work (NOT this system) | synthetic |
| "esc off light popped on, car drives fine" | traction_control_stability_light | unambiguous | synthetic |
| "anti-skid light keeps flashing when it rains" | traction_control_stability_light | needs-fact:warning_light_behavior (flashing = normal) | synthetic |

> This §4 table is an **illustrative selection**; `abs-traction-stability.lexicon.yaml` is the authoritative
> machine form (and holds the real:synthetic balance). Provenance uses ONLY the source-policy enum
> `tekmetric | nhtsa | forum-paraphrase | synthetic` — eval-cases.json phrasings are AUTHORED and
> catalog-snapshot positive_examples are pre-existing DB enrichment, so both are labeled `synthetic`, never
> `tekmetric`.

Messiness represented: all-caps Tekmetric fragments, brand acronyms (STABILTRAC/ESC/VSC), icon-only
descriptions ("squiggly wavy lines"), misspelling ("STABILTRAC"), mixed light-lists, and the dash-vs-tail-lamp
conflation.

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: the single best question, the fact slot + value that resolves it.

| Confusion | Best discriminating question | Slot → value that answers |
|---|---|---|
| Yellow ABS vs Red BRAKE (the named pair) | "Is the light **red** with the word BRAKE / a red (!) — or **yellow/amber** with the letters ABS?" | `warning_light_named` (color+label verbatim); a **red** naming routes to `brake_system_red_light` |
| Red BRAKE: benign (e-brake) vs emergency (hydraulic) | "Is the parking/e-brake **fully released** — and does the light stay on with it off?" | `parking_brake_state` → `released` (still on = emergency) |
| Red BRAKE: is stopping compromised | "Does the pedal feel soft, spongy, or sink toward the floor?" | `pedal_feel` → `soft_spongy` / `sinks_to_floor` |
| ABS-electronic vs base-brake mechanical | "When you press the brake normally, does the car stop **like usual** with a normal pedal?" | `pedal_feel` → `normal` (normal pedal + ABS light = electronic) |
| ABS light: sensor cause cue | "Did it come on **right after** a pothole/curb, a car wash, or deep water?" | `recent_action` → `hit_pothole_or_curb` / `car_wash_or_driven_through_water` |
| Traction/stability: fault vs normal intervention | "Is it **steady on all the time**, or does it only **flash briefly** on slippery roads?" | `warning_light_behavior` → `steady_on` (fault) vs `flashing_or_blinking` (normal) |
| Traction/stability: post-service trigger | "Did it start right after **new tires** or an **alignment/leveling**?" | `recent_action` → `tire_rotation_or_replacement` / `alignment` |
| One chassis light vs a whole cluster | "Is it **just this one** light, or did **several** light up together?" | `warning_light_behavior` → `multiple_lights_at_once` (→ route to multiple_warning_lights_at_once) |
| ABS-activation FEEL vs warped-rotor vibration | "Does the pulsing happen **only in the last few feet** as you creep to a stop (not at speed)?" | `speed_band` → `low_speed` + `onset_timing` → `when_braking` (WSS/ABS, not rotor) |
| **INFERENCE TRAP** — dash BRAKE warning vs exterior brake LAMP bulb | "Is this a **warning light on your dashboard**, or a **brake bulb** at the back of the car?" | a dash telltale (`warning_light_named` present) → `brake_system_red_light`; an exterior brake-LAMP bulb out (a single dead electrical item, nothing on the dash) → `accessory_doesnt_work`. **No current slot cleanly flags "exterior lamp"** — see §9. |

> Literalness guard: "brakes still feel normal" sets **only** `pedal_feel=normal`. It does NOT set
> `location_axle`, does NOT confirm the red light is off, and does NOT imply a WSS location. "Came on after a
> pothole" sets `recent_action=hit_pothole_or_curb` and `started_when` if a time is stated — nothing about
> which wheel.

---

## 6. Warning lights & DTC surface

| Telltale | Color | Solid vs flashing | Customer nicknames |
|---|---|---|---|
| ABS | amber/yellow | solid = fault (anti-lock disabled); on-then-off at start = normal self-test (came_on_then_off) | "ABS light", "ABS letters in a circle", "anti-lock light" |
| Traction control / stability (TCS/ESC/ESP/VSC/DSC/VDC/StabiliTrak) | amber/yellow | **flash = actively intervening (normal)**; solid = fault/disabled | "traction control light", "the squiggly car", "car with skid lines", "slip indicator", "VSC light", "StabiliTrak", "anti-skid", "TRAC OFF" |
| Traction/stability OFF | amber | solid = system switched off by button | "traction off light", "TRAC OFF" |
| Red BRAKE / red (!) | **red** | solid with e-brake released = emergency; may flash on some vehicles | "red brake light", "brake warning", "red exclamation", "parking brake light", "brake fluid light" |

DTC surface (feeds the technician, not the customer): WSS/circuit codes **C0035–C0050** family (GM) and
**Uxxxx** communication codes when the module drops off the bus; steering-angle and yaw-sensor calibration
codes on ESC faults [SAE J2012 DTC nomenclature, Tier 1; GM chassis WSS code ranges, Tier 2, accessed
2026-07-18]. Customers never state DTCs here — this is scope context; do not build customer keywords on codes.

Feeds slot values: `warning_light_named` verbatim strings ("abs", "traction control", "stability", "esc",
"vsc", "stabilitrak", "brake", "slip"); `warning_light_behavior` = `steady_on` | `flashing_or_blinking` |
`comes_and_goes` | `came_on_then_off` | `multiple_lights_at_once`.

---

## 7. Confusable neighbors (cross-system)

| Neighbor system / subcategory | Why confused | Discriminator |
|---|---|---|
| `brake_system_red_light` ↔ `abs_anti_lock_brake_light` | both "brake" lights; share the modulator | **color + label**: red word BRAKE / red (!) → red subcat; yellow "ABS" letters → ABS subcat. When **both** are on → route red (safety-first). |
| brakes-category mechanical (`pulsating_or_vibrating_pedal`, `metallic_grinding`, `spongy_or_soft_pedal`) | pedal-feel complaints vs an electronic light | presence of a **dash light** (`warning_light_named` set) → this dossier; a feel complaint with **no light** → brakes dossier |
| `tpms_tire_pressure_light` | another yellow chassis light, tire-related | TPMS names tire **pressure** / a "low tire" icon; not ABS/skid |
| `power_steering_eps_light` | "steering feels harder" often co-reported with ABS/ESC on a shared fault | if the customer names steering/EPS as the **light**, route EPS; a heavy-steering *feel* with an ABS light is still an ABS-light complaint |
| `airbag_srs_light` | frequently co-illuminates on a bus/low-voltage event | if airbag is one of *several* → `multiple_warning_lights_at_once`; if airbag is the *only* light → SRS dossier |
| `multiple_warning_lights_at_once` | our subcats routinely appear paired | when the customer emphasizes **several different** lights (not just ABS+its sibling traction light) → route multiple |
| `awd_4x4_testing` (AWD/4WD system testing) | an 'AWD disabled' / 'no AWD' / 'hill-assist unavailable' MESSAGE rides along with an ABS/traction/stability fault (shared WSS), so it looks like an AWD complaint | if an ABS/traction/stability **telltale is lit** and the AWD text is just a co-message → **this dossier** (the message corroborates the WSS fault). Route `awd_4x4_testing` ONLY for a genuine AWD/4WD **driveline** complaint — "AWD won't engage", "4WD light on", "4x4 won't kick in" — with **no** ABS/traction/stability light named. Discriminating fact: `warning_light_named`. (Stage-1 hedge added in proposals.) |
| exterior brake **lamp** bulb (tail light) | "brake light" wording collision | a **rear bulb** that is out (nothing on the dash) → `accessory_doesnt_work` (single dead electrical item, `electrical_testing_general`), NOT `brake_system_red_light` — one consistent bulb contract (inference trap, §5; §1) |

Cross-reference: leaks-router owns `clear_yellow_or_light_brown_puddle_brake_fluid`; warning-lights-router owns
the master telltale list and `multiple_warning_lights_at_once` disambiguation; no-start/power router owns the
low-voltage-event angle of FM-9.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| FM-1 WSS corrosion | abs_traction_stability_testing | warning_light | abs_anti_lock_brake_light | good |
| FM-2 WSS/tone-ring pothole | abs_traction_stability_testing | warning_light | abs_anti_lock_brake_light | good |
| FM-3 false low-speed ABS activation | abs_traction_stability_testing (feel originates in WSS) | warning_light / brakes | abs_anti_lock_brake_light | **weak** — feel-only, no-light phrasing may misroute to brakes `pulsating_or_vibrating_pedal`; handled via §5 discriminator + a negative example, not a new subcat |
| FM-4 tire/alignment-triggered ESC | abs_traction_stability_testing | warning_light | traction_control_stability_light | good |
| FM-5 flashing-normal / button-off | abs_traction_stability_testing | warning_light | traction_control_stability_light | good |
| FM-6 red light: e-brake | brake_inspection_warning_light | warning_light | brake_system_red_light | good |
| FM-7 red light: low fluid | brake_inspection_warning_light | warning_light | brake_system_red_light | good |
| FM-8 red+ABS: EBD disabled | brake_inspection_warning_light | warning_light | brake_system_red_light | good |
| FM-9 multi-light comms/voltage | (warning_light_general / charging_starting) | warning_light | multiple_warning_lights_at_once | good (route away from us) |
| FM-10 normal key-on self-test | (no service — reassurance) | warning_light | abs_anti_lock_brake_light / traction_control_stability_light with `warning_light_behavior=came_on_then_off` | good (non-fault; enrichment cue only, no new subcat) |

**No NO-FIT rows → no new subcategory proposal.** The three existing subcategories cover this system fully;
FM-3's weakness is a routing/enrichment problem (add a negative example on brakes `pulsating_or_vibrating_pedal`
that routes to `abs_anti_lock_brake_light`, plus the §5 low-speed discriminator), not a coverage gap. This is
deliberately conservative per the "improve enrichment, don't invent taxonomy" rule.

Catalog note (non-blocking): `abs_traction_stability_testing.example_keywords` is **empty** in the live DB — a
large Stage-1 lever left on the table. All keyword ops in the proposals target it.

---

## 9. Fact-slot audit

**Slots this system uses (with real corpus values):**
- `warning_light_named` — "abs", "traction control", "stabilitrak/esc/vsc", "brake", "slip", "no AWD message".
  (Free-text; the primary router between the three subcats.)
- `warning_light_behavior` — `steady_on` (fault), `flashing_or_blinking` (normal TCS intervention),
  `comes_and_goes` / `came_on_then_off` (intermittent WSS), `multiple_lights_at_once` (route away).
- `pedal_feel` — `normal` (electronic-only, base brakes fine), `soft_spongy` / `sinks_to_floor` (red-light
  hydraulic emergency), `pulsating` / `grabby` (FM-3 low-speed ABS activation).
- `parking_brake_state` — `released` is the pivotal red-light discriminator.
- `recent_action` — `hit_pothole_or_curb`, `car_wash_or_driven_through_water`, `tire_rotation_or_replacement`,
  `alignment` are all live cues.
- `fluid_under_car_location` — `under_a_wheel` for a red-light brake-fluid leak.
- `pull_direction` — a WSS/anti-lock fault can pull under braking.
- `weather_condition` — `after_snow_or_ice` / `rainy_or_wet` (normal TCS flashing context).
- `speed_band` + `onset_timing` — `low_speed` + `when_braking` isolates FM-3 from a warped-rotor vibration.
- `drivable_state` — `drivable_but_concerned` (yellow) vs `not_drivable_needs_tow` (red hydraulic).

**Missing values / limitations found:**
1. **`recent_action` single-value collision (limitation, not a fix here).** Questions Q417 and Q418 both gate
   on `recent_action`; because the extractor stores only ONE value, a customer who says "hit a pothole" makes
   BOTH questions skip even though the "recent brake/tire work?" question was not truly answered. Flag for the
   Workstream-Q owner / a future multi-value `recent_action[]`; no per-system op.
2. **No slot distinguishes a dashboard telltale from an exterior brake LAMP bulb.** The dash-vs-tail-lamp
   inference trap (§5) currently has no clean fact cue. This is a **single-question** need (one disambiguation),
   so it does **NOT** meet the ≥3-question bar for a new slot — handled instead with a negative example
   (routing the exterior bulb to `accessory_doesnt_work`) + the exterior-bulb contract golden case. Logged for
   the warning-lights router to watch across systems (if ≥3 systems hit it, a `warning_indicator_kind` slot
   becomes justified).
3. **No slot for "the system audibly/physically intervened" (ABS pump kick / TCS power cut).** FM-3/FM-5 lean
   on `pedal_feel=pulsating` + `speed_band`/`weather` instead. Again <3 questions → no new slot; extend by
   value cues on existing slots.

**Proposed new slots: NONE** — every discriminating question this system needs is expressible in the current
29 slots. (Discipline check: proposing a slot here would fail the ≥3-question rule.) The only
`stage3.slot.value.add` proposed is `recent_action = suspension_lift_or_leveling` (FM-4; a value genuinely
absent today). The red-vs-yellow color signal is NOT a slot op: `warning_light_named` is a **free-text**
string (`extracted-facts.ts`), so no `slot.value.add` can apply to it — the red/yellow routing lives in the
Stage-1 hedge + the Stage-2 descriptions instead.

---

## 10. Sources (tiered, per-claim)

**Diagnostic authority**
- NHTSA / FMVSS No. 126 (49 CFR 571.126) — ESC mandatory on light vehicles MY2012+. **Tier 1.** accessed 2026-07-18.
- SAE J2012 (DTC nomenclature) / J1930 (terminology). **Tier 1.** accessed 2026-07-18.
- ASE A5 (Brakes) task list — ABS/TCS/ESC electronic diagnosis **scope** (defines task coverage; NOT used to
  rank cause frequency). **Tier 1** (ase.com). accessed 2026-07-18.
- Bosch *Automotive Handbook* — ABS / ESP / EBD / wheel-speed-sensor + vehicle-networking (CAN) + instrument-
  cluster self-test chapters (active vs passive WSS, ESP inputs, intervention behavior, EBD, bus faults,
  power-on lamp check). **Tier 2.** accessed 2026-07-18.
- Halderman, *Automotive Brake Systems* — ABS/EBD operation, red-vs-yellow brake-warning-lamp diagnosis,
  hydraulic/fluid-level warnings (carries the primary weight for FM-6/FM-7/FM-8 and the light-meaning
  semantics). **Tier 2** (standard textbook). accessed 2026-07-18.
- Halderman, *Automotive Technology* — electrical/network diagnosis + warning-lamp self-test (FM-9, FM-10).
  **Tier 2** (standard textbook). accessed 2026-07-18.
- Erjavec, *Automotive Technology: A Systems Approach* — brake-warning-system + hydraulic sections
  (independent corroboration for FM-6/FM-7). **Tier 2** (standard textbook). accessed 2026-07-18.
- Standard Motor Products / Dorman wheel-speed-sensor technical training — WSS corrosion, connector
  contamination, impact/tone-ring damage symptom signatures (FM-1/FM-2). **Tier 2** (parts-manufacturer
  technical training). accessed 2026-07-18.
- AA1Car — ABS/wheel-speed-sensor diagnostics articles. **Tier 3 (corroboration only, never sole).** accessed 2026-07-18.

> Removed from the prior draft: **FreeASEStudyGuides** (not ase.com and not in the Tier-1/2/3 enumerations —
> replaced by Halderman/Erjavec for the red-vs-yellow semantics and FM-6/7/8) and **RepairPal** (a
> cost-estimator page — explicitly denylisted for diagnosis by source-policy). Generic "community/forum
> diagnostic reports" were also removed as a corroboration tier: source-policy scopes forums to LINGUISTIC
> authority only, and Tier 3 is limited to iATN / ScannerDanner / South Main Auto / Pine Hollow / AA1Car.

**Linguistic authority (voice only, never cited for diagnosis)**
- Tekmetric corpus: `real-concerns-tekmetric-labeled-v2.json` (tkc-120 "abs / trac / no AWD message"; STABILTRAC
  light; TRACTION CONTROL STAYING ON; ABS+steering; "transmission light and esc off"; RED BRAKE coming on/off
  after topping fluid; wheel-wobble multi-light tow-in).
- Authored eval cases: `eval-cases.json` (`abs_traction_stability_testing-001..004`,
  `brake_inspection_warning_light-001..004`).
- Forums (paraphrased patterns only): `real-concerns-forums.json` (post-leveling ABS+traction; 65–75 mph
  ABS+brake; dash BRAKE lamp vs working tail lamps; ABS+traction+airbag+security cluster).

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every failure mode (FM-1..FM-10) carries ≥1 customer-voice phrasing (see §4/lexicon) and ≥1 discriminating
  fact (§5). FM-10 (normal key-on self-test, `came_on_then_off`) added per verifier.
- [x] Every diagnostic claim in §2/§3 carries a Tier 1/2 cite; Tier 3 (AA1Car only) is corroboration, never
  sole. FreeASEStudyGuides + RepairPal + generic "forum diagnostic reports" removed (off the authority list /
  denylisted / linguistic-only) and replaced with Halderman / Erjavec / Bosch / parts-mfr WSS training (§10).
- [x] Every negative example in the proposals names a `routes_to`.
- [x] Synonyms are ≥2 tokens OR domain tokens (StabiliTrak, VSA/VSC light, slip indicator light, hill assist
  light) — no bare "light"/"brake"; removed 'no AWD message' (ambiguous vs awd_4x4) and 'ABS module light'
  (mechanic voice).
- [x] Stage-1 keyword ops target the empty `abs_traction_stability_testing.example_keywords`; every remaining
  keyword has a verbatim corpus occurrence (removed 'VSC light' / 'anti-lock brake light' / 'slip indicator
  light' / 'red exclamation brake light' — none had corpus support; VSC/slip survive as synonyms).
- [x] Literalness respected both ways — fact cues set a slot only when literally stated, AND literally-stated
  cues are not suppressed (golden case 1 realigned to eval-001's pedal-feel wording; inference-trap #2 now
  extracts `noise_descriptor=grinding_metallic` and defends the misroute at Stage 1/2, not by dropping facts).
- [x] 11 golden cases incl. 2 inference-traps + the exterior-bulb contract case (dash telltale → red vs
  exterior bulb → `accessory_doesnt_work`).
- [x] No new subcategory or slot proposed where existing taxonomy fits; the sole `stage3.slot.value.add` is
  `recent_action=suspension_lift_or_leveling`. `warning_light_named` is free-text so no slot.value.add applies
  to it (§9 corrected). The cross-system slot idea (`warning_indicator_kind`) is logged sub-threshold.
- [x] Confusable pairs owned: "red brake (base hydraulic) vs ABS/electronic" via `warning_light_named`
  color+label + `parking_brake_state` + `pedal_feel`; AND `awd_4x4_testing` (AWD-message-corroboration vs
  genuine AWD-driveline) via a Stage-1 hedge on `warning_light_named` (§7).
- [x] One bulb contract across all three files: exterior brake-lamp bulb → `accessory_doesnt_work`
  (`electrical_testing_general`), never `brake_system_red_light`, never advisor null-route.
- [x] Provenance uses only the source-policy enum (`tekmetric|nhtsa|forum-paraphrase|synthetic`); eval-cases +
  catalog positive_examples relabeled `synthetic`; synthetic share held ≤~30% per routed subcategory in the
  lexicon.
