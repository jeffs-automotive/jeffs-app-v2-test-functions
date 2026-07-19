# ADAS / driver-assistance electronics — diagnostic dossier
slug: adas-driver-assist   date: 2026-07-18   binds_services: [warning_light_general, electrical_testing_general]   binds_categories: [warning_light, electrical]

> **Headline finding (catalog gap):** ADAS is a *complete* coverage gap. A live catalog sweep
> (2026-07-18, shop 7476) returned **zero** subcategories whose slug or description references a
> driver-assist feature (lane-keep, AEB/forward-collision, blind-spot, adaptive cruise, parking
> sensors, 360/backup camera, or post-service **calibration**). The corpus is equally empty: across
> 500 labeled Tekmetric concerns + 145 authored cases + the forum set, **not one** utterance is about
> an ADAS feature or a calibration request. Today an ADAS complaint has nowhere correct to land — it
> is silently absorbed by `check_engine_light`, `multiple_warning_lights_at_once`, or
> `accessory_doesnt_work`, all of which mis-scope the diagnosis. This dossier binds the system onto the
> two generic services that *can* legitimately receive it (`warning_light_general`,
> `electrical_testing_general`) and proposes the one missing subcategory + a Chris-gated calibration
> service. Because there is no corpus, positive examples lean on **NHTSA ODI narrative paraphrase**
> and **flagged synthetic** — an honest departure from the "corpus-first / synthetic ≤30%" default,
> forced by the gap, and itself the demand caveat (§8).

---

## 1. Scope & boundaries

**In scope** — the sensing + warning + intervention electronics of driver-assistance:
- **Forward-facing camera** (windshield-mounted, behind the mirror): lane-departure warning (LDW),
  lane-keeping assist (LKA), traffic-sign recognition, part of forward-collision warning (FCW) / automatic
  emergency braking (AEB).
- **Front radar** (grille/bumper): adaptive cruise control (ACC), FCW, AEB.
- **Corner/rear radar** (rear bumper): blind-spot warning (BSW), rear cross-traffic warning (RCTW).
- **Ultrasonic park sensors** (front/rear fascia): parking distance warning, park assist.
- **Cameras** for backup / 360 surround view when the complaint is a *system/assist* fault (see boundary
  with dead-accessory below).
- The **dash messages** these throw ("Lane Keep Assist unavailable", "Front Radar Obstruction",
  "Pre-Collision System: service required", "Blind Spot System error") and the **post-service
  calibration** need (after windshield R&R, alignment, suspension, bumper/sensor R&R, collision).

**Out of scope** (each with the neighbor that owns it):
- A **classic named dash light** — check-engine, ABS, traction/stability, airbag/SRS, battery, oil,
  temp, TPMS, red brake — is NOT ADAS. → the matching `warning_light` subcategory (e.g.
  `check_engine_light`, `abs_anti_lock_brake_light`, `traction_control_stability_light`,
  `airbag_srs_light`). ADAS is confused with these constantly (§7).
- A **dead accessory with no ADAS/assist framing** — "backup camera screen is just black", "the display
  won't turn on" — is a single-circuit electrical dead-item. → `accessory_doesnt_work` (electrical).
  The discriminator is whether the customer describes a *lost assist function / warning message*
  (ADAS) vs *a screen/part that is simply dead* (accessory).
- **Airbag/SRS** impact sensors and yellow connectors → `airbag_srs_light` / `airbag_srs_testing`.
  ADAS "pre-collision" wording tempts a mis-route here (§7).
- The **mechanical** systems ADAS calibration piggybacks on — a **wheel alignment** complaint ("pulls
  to the right") is `pulling` / `suspension_steering_check`; ADAS only enters if a *driver-assist
  warning* appears after the work. A **windshield chip/crack** as a glass-repair request is an advisor
  quote, not ADAS — unless the customer ties it to a camera/assist warning.

---

## 2. System primer (expert, CITED)

ADAS = the sensor-fusion layer that perceives the road and either **warns** the driver or **acts**
(brakes, steers, holds distance). The US-standardized feature nomenclature (adopted by NHTSA's driver-
assistance program and the SAE J3063 "Clearing the Confusion" naming convention) groups them as:
forward-collision warning, automatic emergency braking, lane-departure warning, lane-keeping assist,
blind-spot warning, rear cross-traffic warning, adaptive cruise control, and parking assistance
[NHTSA Driver Assistance Technologies program, Tier 1, accessed 2026-07-18; SAE J3063 nomenclature, Tier 1].

**Sensor set + operating principle:**
- **Mono/stereo camera** behind the windshield reads lane lines, vehicles, signs, pedestrians. It is an
  *optical* device that treats the windshield glass as part of its lens path — glass clarity, tint band,
  and the camera's aim angle through the glass are all part of the calibration
  [I-CAR RTS, "Calibration After Windshield Replacement" (rts.i-car.com/crn-801.html), Tier 2, accessed 2026-07-18].
- **Radar** (24 GHz / 77 GHz) measures range + closing speed to targets. Front radar sits behind the
  grille or bumper cover; corner radars sit inside the rear bumper. Radar sees through light rain but is
  blinded by packed snow/ice/mud on the fascia or by a bumper that is misaligned after a minor hit
  [AAA Automotive, "ADAS Sensor Calibration Increases Repair Costs" (aaa.com/autorepair/articles/adas-sensor-calibration-increases-repair-costs), Tier 2, accessed 2026-07-18].
- **Ultrasonic sensors** in the fascia handle low-speed parking distance; they false-trigger on slush,
  ice, road spray, and heavy fascia contamination [OEM owner-manual guidance — park-assist sensors may
  false-alert when covered by ice, snow, or dirt, Tier 1 OEM, accessed 2026-07-18].

**Calibration — the defining maintenance fact.** After the camera, radar, or their mounting bracket is
disturbed, the module must be re-taught its aim. Calibration is required "whenever a sensor or its
mounting bracket is removed and replaced, there is a change in tire size, a front airbag deploys and
deflects off the windshield, or repairs are made to a car roof that has a sensor bracket mounted to it",
and "as a byproduct of common car service work such as windshield replacement, suspension repair, or
wheel alignment" [AAA Automotive, "ADAS Sensor Calibration Increases Repair Costs"
(aaa.com/autorepair/articles/adas-sensor-calibration-increases-repair-costs), Tier 2, accessed
2026-07-18]. I-CAR's OEM calibration-requirements guidance lists the triggering events as "removing the
glass or replacing a camera/sensor" and stresses that OEM procedures must be followed [I-CAR RTS,
"Calibration After Windshield Replacement" (rts.i-car.com/crn-801.html), Tier 2, accessed 2026-07-18].
GM's 2026 windshield position statement makes front-camera calibration a required step after windshield
R&R [GM windshield position statement via Repairer Driven News, 2026-03-20, Tier 1 OEM, accessed
2026-07-18].

Two calibration architectures the shop must distinguish:
- **Static** — vehicle stationary, OEM targets set at measured distances on a level floor in controlled
  light; ~1 hr/system [I-CAR RTS, static vs dynamic calibration procedures, Tier 2, accessed 2026-07-18].
- **Dynamic** — a road drive under speed/lane-marking/weather conditions the OEM specifies lets the
  module self-learn. Many vehicles need **both** [I-CAR RTS, Tier 2, accessed 2026-07-18].

Cost calibration for the US mix (Jeff's market): AAA's 2023 study priced ADAS-equipped component repairs
**including calibration** at front-radar **$500–$1,300**, front-camera **$600–$800**, and
ultrasonic/park-assist **$300–$1,000**; a windshield replacement that required front-camera calibration
averaged **$1,439.78**, of which the calibration step itself was **~$360 (about 25%)** [AAA, *Cost of
Advanced Driver Assistance Systems (ADAS) Repairs*, Dec 2023, Tier 2, accessed 2026-07-18].

---

## 3. Failure-mode catalog (the diagnostic spine, CITED per mode)

> All ADAS faults surface to the customer as **either** a dash message/light (`warning_light`) **or** a
> lost/mis-behaving assist function (`electrical`/behavioral). None of the 29 fact slots holds "which
> assist feature" or "false-activation vs disabled" cleanly — see §9.

**FM-1 — Sensor obstruction / temporary blockage (most common, benign).**
- Signature: dash message `warning_light_named` ≈ "front radar obstruction" / "sensor blocked" /
  "driving aids unavailable"; `weather_condition = after_snow_or_ice | rainy_or_wet`;
  `warning_light_behavior = comes_and_goes | came_on_then_off`.
- Modifiers: appears after snow/ice/mud pack on grille or after road spray; often self-clears once the
  fascia is cleaned/thawed.
- Drivability: `drivable_but_concerned` — base braking/steering unaffected; only the *assist* is paused.
- Misattribution: customers read "collision system problem" as *the brakes are failing*. They are not.
- Cite: OEM owner-manual guidance that radar "may not function correctly if covered with snow, ice, or
  dirt" [Toyota/Ford owner documentation, Tier 1 OEM, accessed 2026-07-18]; **Nissan** bulletin
  NTB23-011C, "2022 Rogue — Forward Driving Aids Temporarily Disabled" (front-sensor-blocked message
  after winter driving, DTC C2582-97), NHTSA-hosted as MC-11004973 [Nissan TSB NTB23-011C /
  static.nhtsa.gov/odi/tsbs/2024/MC-11004973-0001.pdf, Tier 1 OEM, accessed 2026-07-18].

**FM-2 — Calibration / relearn lost after service, repair, or power loss.**
- Signature: `warning_light_named` names a specific feature ("lane keep assist", "adaptive cruise",
  "pre-collision"); `recent_action` = windshield/glass replacement, alignment, suspension work,
  bumper/sensor R&R, collision, **or `battery_or_alternator_work`** (a battery replacement / dead-battery
  power loss can drop the steering-angle sensor and camera relearn on many platforms, throwing a
  lane-assist/ADAS message until the relearn runs); light typically `steady_on`.
- Modifiers: onset immediately follows the service or the battery event; feature may work erratically
  rather than fully die.
- Drivability: `drivable_but_concerned`.
- Misattribution: "the glass shop broke my lane assist" — usually just an un-performed calibration, not
  a broken part. "New battery and now the lane-keep light is on" — usually a steering-angle/camera
  relearn, not a failed camera.
- Cite: [AAA Automotive "ADAS Sensor Calibration Increases Repair Costs", Tier 2; I-CAR RTS
  (windshield/relearn procedures), Tier 2; GM windshield position statement, Tier 1 OEM — all accessed
  2026-07-18].

**FM-3 — Sensor/module electrical fault (real defect).**
- Signature: `warning_light_named` = a driver-assist feature or "service required"; persists after
  cleaning; often a stored chassis-network DTC (e.g. the Nissan forward-radar/driving-aids C2582 code
  family). `warning_light_behavior = steady_on`.
- Drivability: `drivable_but_concerned`; base vehicle fine.
- Misattribution: mistaken for check-engine because "a light is on and it mentions the engine/collision".
- Cite: SAE J2012 defines the chassis-DTC framework these codes live in [SAE J2012 DTC standard, Tier 1,
  accessed 2026-07-18]; a documented worked example is the Nissan forward-driving-aids DTC C2582-97 in
  bulletin NTB23-011C [Nissan TSB NTB23-011C, Tier 1 OEM, accessed 2026-07-18].

**FM-4 — False activation / "phantom" intervention.**
- Signature: no fault light required — the *behavior* is the complaint: "car braked itself for no
  reason", "collision warning goes off when nothing's there", "lane assist tugs the wheel randomly".
  `speed_band = highway | mid_speed`; `onset_timing = intermittent`.
- Drivability: `drivable_but_concerned` → can escalate to a safety complaint (`safety_concern...`
  situational bucket) when the customer feels endangered.
- Misattribution: phantom **braking** reads as a *brake* fault ("brakes grab on their own") → mis-routes
  to brakes; phantom **steering** ("lane assist tugs the wheel") reads as a mechanical *pull* → mis-routes
  to pulling/steering (§5 covers both discriminators).
- Cite (diagnostic authority): inadvertent/phantom AEB activation is the subject of formal **NHTSA ODI
  defect investigations** — PE22-003 into 2019–2023 Honda Passport/Insight for AEB activating with no
  obstruction (escalated to engineering analysis), and EA22-002 into 2021–2022 Tesla Model 3/Y phantom
  braking while adaptive cruise is engaged [NHTSA ODI investigations PE22-003 & EA22-002,
  static.nhtsa.gov/odi/inv/2022/, Tier 1 regulatory, accessed 2026-07-18]. (Individual ODI *complaint
  narratives* are used only for customer voice in §4/§10 — never as the diagnostic cite.)

**FM-5 — Multiple assist systems down together (bus / camera-supply fault).**
- Signature: several assist messages at once — "adaptive cruise problem" + "collision mitigation
  problem" + "road/lane departure problem" — from one shared camera/radar or communication fault.
  `warning_light_behavior = multiple_lights_at_once`.
- Drivability: `drivable_but_concerned`.
- Misattribution: looks like `multiple_warning_lights_at_once`, but that subcategory is scoped to a
  *charging/alternator voltage cascade* — a wrong diagnosis here (§7).
- Cite (diagnostic authority): Honda Sensing OEM documentation describes a **single** windshield-mounted
  front camera that feeds CMBS (collision braking), LKAS (lane keep), and RDM (road-departure) — so one
  camera or shared-network fault disables several features at once and throws their messages together
  [Honda Sensing owner documentation — Quick Reference Guide, owners.honda.com, Tier 1 OEM, accessed
  2026-07-18]. (ODI complaint narratives of "three Honda Sensing messages at once" are used only for
  customer voice in §4, not as the diagnostic cite.)

**FM-6 — Aim disturbed by minor impact (no calibration ordered).**
- Signature: `recent_action = accident_or_impact | hit_pothole_or_curb`; assist warning or degraded
  behavior after a low-speed bumper tap that moved the radar behind the fascia.
- Drivability: `drivable_but_concerned`.
- Cite: [AAA, radar-behind-bumper calibration after minor front collision, Tier 2, accessed 2026-07-18].

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

> Provenance reality: **no Tekmetric/authored/forum corpus exists** for ADAS (the gap). Real voice
> below is **NHTSA ODI paraphrase** (public domain, first-person) + **flagged synthetic**. This inverts
> the usual "corpus-first, synthetic ≤30%" rule *of necessity*; every synthetic line is marked so Chris
> and the verifier can see the provenance mix and down-weight if desired.

| phrase | normalized | target slug | ambiguity | provenance |
|---|---|---|---|---|
| "lane departure warning keeps flashing even when i'm in my lane" | LDW false/steady alert | (proposed) adas_driver_assist_warning_or_malfunction | needs-fact:warning_light_behavior | nhtsa |
| "message says front radar obstruction, driving aids unavailable" | radar blocked message | proposed adas subcat | needs-fact:weather_condition | nhtsa |
| "pre-collision system problem, car slammed the brakes for no reason" | AEB phantom braking + fault msg | proposed adas subcat | cross-system:brakes(feel) | nhtsa |
| "adaptive cruise control stopped working and there's a warning about it" | ACC disabled + message | proposed adas subcat | unambiguous | nhtsa |
| "collision mitigation problem AND road departure problem both on" | multi-assist message set | proposed adas subcat | needs-fact:warning_light_behavior | nhtsa |
| "just got a new windshield and now my lane assist light is on" | post-glass calibration need | proposed adas subcat | needs-fact:recent_action | nhtsa-paraphrase |
| "blind spot light on the mirror stays lit all the time now" | BSW indicator stuck on | proposed adas subcat | needs-fact:warning_light_behavior | synthetic |
| "backup camera screen is just black" | dead camera display | accessory_doesnt_work | cross-system:electrical | synthetic |
| "little car with sensor beams light on my dash" | unnamed ADAS icon | proposed adas subcat | needs-fact:warning_light_named | synthetic |
| "car brakes by itself sometimes, kinda scary" | phantom-brake (nothing named) | proposed adas subcat / safety bucket | needs-fact:warning_light_named | nhtsa-paraphrase |
| "parking sensors beep nonstop even in an empty lot" | ultrasonic false alarm | proposed adas subcat | speed_band:low_speed (lot) | synthetic |
| "lane assist keeps yanking the wheel on the highway" | phantom lane-keep steer intervention | proposed adas subcat | cross-system:pulling/steering | nhtsa-paraphrase |
| "put in a new battery and now the lane keep light is on" | ADAS relearn after power loss | proposed adas subcat | needs-fact:recent_action(battery) | synthetic |
| "my cruise control quit working" (older car, no radar/adaptive) | plain cruise inop — NOT ADAS | accessory_doesnt_work / electrical_testing_general | cross-system:electrical | synthetic |
| "auto brake light came on and the self-braking is acting up" | messy AEB wording | proposed adas subcat | needs-fact:warning_light_behavior | nhtsa-paraphrase |
| "back up camera warning and the blindspot thing lit up" | messy BSW/camera wording | proposed adas subcat | needs-fact:warning_light_named | synthetic |
| "PERFORM FORWARD CAMERA CALIBRATION" (all-caps work-order line) | tech work order, NOT a concern | null-route → advisor | non-concern | synthetic (work-order style) |

Messiness operationalized (US customer voice): the slang/misspelled variants below are now bound as
synonyms/keywords + lexicon entries (not just observed) — "back up camera", "backup camera warning",
"blindspot"/"blind spot", "auto brake", "self braking"/"the self-braking", "lane assist", "lane keep",
"collision thing", plus part-name vagueness ("the sensor thingy") and the recurring pattern of reading a
*feature* message as an *engine* problem. See `.lexicon.yaml` and `proposals.yaml` ops (B)/(E).

---

## 5. Differential & discriminating questions (binds required_facts + slots)

| confusable pair | the ONE discriminating question | slot + value that answers it |
|---|---|---|
| ADAS warning **vs** generic/other named light | "Does the light or message name a driver-assist feature — lane, collision, blind spot, cruise, parking — or is it a classic engine/brake/battery light?" | `warning_light_named` = a feature name ("lane keep","pre-collision","blind spot","adaptive cruise") → ADAS; = "check engine"/"ABS"/"battery"/"oil"/"temp" → the matching existing subcat |
| ADAS multi-message **vs** `multiple_warning_lights_at_once` | "Are the messages all about driving-assist features, or is the whole dash lit (engine+battery+ABS+airbag) with rough running / dim lights?" | `warning_light_named` (all ADAS features) + `warning_light_behavior=multiple_lights_at_once` → ADAS; engine/charging spread → existing |
| ADAS obstruction **vs** real ADAS fault | "Did it appear right after snow/ice/mud/car-wash, and does it clear when the sensor area is cleaned?" | `weather_condition=after_snow_or_ice\|rainy_or_wet` + `warning_light_behavior=came_on_then_off` → obstruction (FM-1) |
| ADAS calibration-need **vs** ADAS defect | "Did it start right after a windshield replacement, alignment, suspension work, or bumper repair?" | `recent_action` = windshield/glass (proposed value), `alignment`, `accident_or_impact`, `hit_pothole_or_curb` → calibration (FM-2/FM-6) |
| ADAS phantom-braking **vs** a brake fault | "Does the car brake *itself* when nothing is in front, or does the brake pedal feel wrong when *you* press it?" | ADAS = intervention with `pedal_feel=null` + no braking complaint on driver application; brake fault = `pedal_feel` set (grabby/soft/pulsating) → brakes |
| ADAS phantom-**steer** **vs** a mechanical pull | "Does a *driving-assist* system tug/steer the wheel on its own (with a lane/collision message), or does the car steadily *pull* to one side even with your hands relaxed and no assist involved?" | ADAS = self-initiated steering tied to a named assist (`warning_light_named` = lane/road-departure) + `steering_feel=null`/`pull_direction=null` → ADAS; steady mechanical pull = `pull_direction` set (left/right) / `steering_feel` set, no assist named → `pulling_drifting_or_wandering_on_the_road` (steering) |
| ADAS **adaptive** cruise **vs** plain cruise control | "Is it *adaptive/radar* cruise that keeps distance from cars ahead (or a message about it), or basic set-speed cruise on an older car that just won't hold speed?" | adaptive/radar cruise fault or message → ADAS; a plain set-speed cruise that stopped working on a car with **no** radar/adaptive feature, no assist message = a control/electrical inop → `accessory_doesnt_work` (electrical_testing_general). If unstated which, ASK — do not assume ADAS from the bare word "cruise" |
| ADAS **vs** `accessory_doesnt_work` (dead camera) | "Is an assist *feature/warning* involved, or is a screen/part simply dead with no warning?" | ADAS = `warning_light_named` set / assist function named; dead item = `accessory_affected` set, no assist framing → accessory_doesnt_work |
| ADAS pre-collision **vs** `airbag_srs_light` | "Is it about the airbag/SRS light, or about the collision-avoidance/pre-collision assist?" | `warning_light_named`="airbag/SRS" → airbag_srs_light; ="pre-collision/collision mitigation/AEB" → ADAS |

**Slot-expressibility note:** the "which assist feature" answer rides on the free-text
`warning_light_named` (works). The "false-activation vs disabled vs warning-only" answer has **no**
current slot — candidate new slot flagged in §9 (does NOT yet meet the ≥3-question bar, so deferred).

---

## 6. Warning lights & DTC surface

ADAS rarely uses a single iconic tell-tale; it mostly throws **text messages** + soft amber icons:
- **Icons:** a small car with a sensor/beam arc in front (FCW/AEB); a car with wavy lane lines and a
  steering wheel (LKA); a car with radiating side beams (BSW); "P" with sensor waves (park assist).
  Customer nicknames: "the sensor light", "the collision thing", "car with waves light", "the assist
  light", "lane thingy".
- **Text messages (feed `warning_light_named` verbatim):** "Front Radar Obstruction", "Sensor Blocked",
  "Driving Aids Unavailable", "Lane Keep Assist Unavailable", "Pre-Collision System: Service Required",
  "Adaptive Cruise Control Unavailable", "Blind Spot System Error".
- **Behavior semantics (`warning_light_behavior`):** obstruction messages `come_and_go` / `came_on_then_off`
  (self-clearing); calibration/defect messages sit `steady_on`; a shared-sensor fault presents
  `multiple_lights_at_once` **but only ADAS features** (distinguishes from FM-5 vs charging cascade).
- **DTCs:** SAE J2012-framed manufacturer codes for forward-radar-sensor and camera faults; obtained by
  the `warning_light_general` scan [SAE J2012 framework, Tier 1; OEM TSBs, Tier 1/2, accessed 2026-07-18].

---

## 7. Confusable neighbors (cross-system)

- **`check_engine_light`** — a "collision system problem" or "service required" ADAS message reads as an
  engine light to customers. Discriminator: engine-outline icon / "check engine" wording → CEL; a named
  *assist feature* → ADAS. (Adds a negative example to `check_engine_light`.)
- **`multiple_warning_lights_at_once`** — that subcategory is explicitly scoped to a **charging/alternator
  voltage cascade** (its description: dim headlights, hard cranking, rough running). An all-ADAS message
  set is a *different* root cause (shared camera/radar/bus). Mis-routing loses the diagnosis. (Adds a
  negative example there.)
- **`accessory_doesnt_work`** — a genuinely dead backup-camera screen belongs here; an *assist warning*
  does not. Boundary lives on whether a warning/feature is named.
- **`airbag_srs_light`** — "collision"/"impact" wording overlaps; SRS is passive restraint, ADAS is active
  avoidance. Discriminator: airbag/SRS icon vs pre-collision/AEB feature name.
- **`traction_control_stability_light`** — "car with skid lines" (stability) vs "car with sensor beams"
  (ADAS). Different icons; customers conflate them as "the car light".
- **brakes (feel)** — phantom AEB reads as "brakes grab on their own"; discriminator is *self-initiated
  intervention* vs *pedal feel on driver application* (§5).
- **`pulling` / `suspension_steering_check` / `pulling_drifting_or_wandering_on_the_road`** — an
  alignment pull is mechanical; ADAS only enters if a driver-assist warning follows the alignment.
  **Phantom lane-keep steer** ("the wheel tugs itself") reads as a mechanical pull but is a
  self-initiated ADAS intervention tied to a lane/road-departure message — discriminator is
  self-initiated-with-assist-named vs steady `pull_direction` with no assist (§5). (Adds a negative
  example to `pulling_drifting_or_wandering_on_the_road`.)
- **plain cruise control (`accessory_doesnt_work` / `electrical_testing_general`)** — "cruise control
  stopped working" on an older car with **no** radar/adaptive feature and no assist message is a
  set-speed control/electrical inop, NOT ADAS. Only *adaptive/radar* cruise (or a message naming it)
  routes to the ADAS subcategory. The bare word "cruise" must not pull a plain-cruise complaint into
  ADAS — the subcategory description and a negative example hedge this both ways. (Adds a negative
  example to the proposed ADAS subcat routing plain cruise back to `accessory_doesnt_work`.)

Cross-reference neighbor dossiers: `router-warning-lights` (owns the master light list + this pair in
`binding/confusable-matrix.yaml`), `router-no-start-power` (n/a), brakes dossier (phantom-brake vs pedal).

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| failure mode | current service(s) | current category | current subcategory | fit |
|---|---|---|---|---|
| FM-1 obstruction message | `warning_light_general` | warning_light | — (none) | **NO FIT** → propose `adas_driver_assist_warning_or_malfunction` |
| FM-2 calibration lost after service | `warning_light_general` (+ situational `after_recent_service_or_repair_work`) | warning_light | — | **NO FIT** → same proposed subcat; `recent_action` cue |
| FM-3 sensor/module defect | `warning_light_general` | warning_light | — | **NO FIT** → same proposed subcat |
| FM-4 phantom activation | `warning_light_general` / safety bucket | warning_light / other | — | **NO FIT** → same proposed subcat |
| FM-5 multi-assist down | `warning_light_general` | warning_light | `multiple_warning_lights_at_once` | **WEAK / WRONG** (that subcat = charging cascade) → proposed subcat |
| FM-6 aim after minor impact | `warning_light_general` (+ `after_a_recent_accident_or_impact`) | warning_light / other | — | **NO FIT** → proposed subcat; `recent_action` cue |
| dead camera screen (boundary) | `electrical_testing_general` | electrical | `accessory_doesnt_work` | **GOOD** (stays put) |

**Every NO FIT → the single proposed subcategory** `adas_driver_assist_warning_or_malfunction`
(category `warning_light`, routed to `warning_light_general` for the scan). Demand evidence is
**forward-looking, not volume-proven**: the corpus shows *zero* current ADAS traffic, so this is a
coverage-completeness + future-mix proposal, not a "we're losing bookings today" claim — stated honestly
so Chris can weight it. As Jeff's inbound vehicle mix modernizes, ADAS density rises sharply — but note
the evidence is a **growing-fleet** argument, not a current mandate: 20 automakers made a **voluntary
commitment** in 2016 to equip virtually all new US light vehicles with AEB by ~Sept 2022 (voluntary, not
a rule), and NHTSA's binding AEB mandate (**FMVSS 127**, finalized April 2024) does **not take effect
until ~Sept 2029**. Either way the on-road ADAS-equipped fleet is climbing fast, so the mis-routes above
will grow; today they are rare [NHTSA FMVSS 127 final rule (April 2024) + 2016 voluntary 20-automaker AEB
commitment, Tier 1, accessed 2026-07-18].

**Catalog-service proposal (Chris-gated):** `warning_light_general` is a generic code-scan; it does not
scope ADAS **calibration** (targets, static/dynamic road drive, per-feature aim) or price it. A dedicated
`adas_calibration_diagnostic` service is proposed (scan + calibration-status verification; calibration
itself quoted/sublet). Fee anchored to the existing diagnostic tier ($179.95) with calibration separate
[AAA cost data, Tier 2, accessed 2026-07-18]. **Propose, do not assume** — Chris decides catalog + fee.

---

## 9. Fact-slot audit

**Slots this system uses (all existing):**
- `warning_light_named` (free text) — holds the ADAS feature/message verbatim. **Primary discriminator.**
  **Scope-extension note:** the extractor scopes this slot to *dashboard* indicators, but the blind-spot
  warning (BSW) telltale is commonly **mirror-mounted**, not on the dash. We fill `warning_light_named`
  from a named BSW indicator regardless of physical location (it is still the customer-named warning
  indicator). This is a deliberate, disclosed extension of the slot's "dashboard warning indicators only"
  wording — flagged here so the aggregator can decide whether to formally broaden the slot description.
- `warning_light_behavior` — steady_on (defect/calibration) vs came_on_then_off/comes_and_goes (obstruction)
  vs multiple_lights_at_once (shared-sensor).
- `recent_action` — windshield/glass R&R, alignment, accident_or_impact, hit_pothole_or_curb,
  general_service, and **`battery_or_alternator_work`** (battery replacement / dead-battery power loss →
  steering-angle/camera relearn; FM-2 cue).
- `weather_condition` — after_snow_or_ice / rainy_or_wet (obstruction cue).
- `speed_band`, `onset_timing` — phantom-activation context; `speed_band=low_speed` is literally set by
  "in a parking lot" per the slot description (park-sensor cases).
- `drivable_state` — set ONLY when the customer literally states drivability/concern (e.g. "kinda scary");
  never inferred just because an assist message is present.
- `customer_request_type` — a *replacement* or *known-fix* request maps cleanly; but a bare
  service-need **inquiry** ("do I still need the camera calibrated?") has **no expressible enum value**
  (the customer named no known problem and is not requesting a specific part) — leave it **null** per the
  slot's "symptom-only → null" guidance. See the slot-expressibility gap below.
- `accessory_affected` — only for the dead-camera boundary case (routes away to accessory_doesnt_work).

**Missing value (proposed — `stage3.slot.value.add`):** `recent_action` has no **windshield / glass
replacement** value — the single most common ADAS calibration trigger. Closest current values
(`general_service`, `accident_or_impact`) both mis-frame it. Literal cues: "after my windshield was
replaced", "new windshield", "the glass shop put in new glass". Adds discriminating power to FM-2 without
inference. (The battery-relearn trigger, by contrast, reuses the **existing** `battery_or_alternator_work`
value — no new value needed; literal cues "new battery", "after the battery died".)

**Slot-expressibility gap — `customer_request_type` (logged, not a proposed op):** the service-need
*inquiry* "do I still need the camera calibrated?" is neither `fix_a_known_problem` (no known problem —
the enum value requires the customer or a prior shop to have identified an issue), `replace_specific_part`,
nor `diagnose_problem`. The 7-value enum cannot express a "should I do this maintenance step?" question, so
the slot stays **null** for such phrasings (correct per the slot's symptom-only→null rule). Logged as an
ontology gap for Chris; not worth a new enum value on one subcategory.

**Candidate new slot — DEFERRED (does NOT meet the ≥3-question rule).** An `adas_behavior`
{false_activation, disabled_or_unavailable, warning_only, intermittent} slot would cleanly separate FM-4
(phantom braking) from FM-1/FM-3 (disabled/unavailable). But only the one proposed subcategory would use
it (≤2 questions), below the ≥3-question threshold for a new slot. **Logged, not proposed** — revisit if
ADAS is later split into multiple subcategories (e.g. separate phantom-activation vs obstruction subcats).

**No-inference guard specific to ADAS:** "car brakes by itself" sets *no* `warning_light_named` unless a
light/message is named; "collision system problem message" sets `warning_light_named` but does **not**
set `pedal_feel` or any brake fact; an obstruction message does **not** set
`drivable_state=not_drivable_needs_tow` (the base vehicle still drives — only the assist is paused).

---

## 10. Sources

Diagnostic (system/failure-mode) claims:
- NHTSA Driver Assistance Technologies program — standardized feature nomenclature. Tier 1. Accessed 2026-07-18.
- SAE J3063 "Clearing the Confusion" ADAS naming; SAE J2012 DTC framework. Tier 1. Accessed 2026-07-18.
- AAA, *Cost of Advanced Driver Assistance Systems (ADAS) Repairs*, Dec 2023 (newsroom.aaa.com) — the
  repair-cost figures (front-radar $500–$1,300, front-camera $600–$800, ultrasonic $300–$1,000;
  windshield+calibration $1,439.78 avg, ~$360 calibration portion). Tier 2 (research org). Accessed 2026-07-18.
- AAA Automotive, "ADAS Sensor Calibration Increases Repair Costs"
  (aaa.com/autorepair/articles/adas-sensor-calibration-increases-repair-costs) — the calibration-trigger
  quotes. Tier 2. Accessed 2026-07-18.
- I-CAR RTS, "Calibration After Windshield Replacement" (rts.i-car.com/crn-801.html) — OEM calibration-
  requirement guidance + static vs dynamic procedures. Tier 2. Accessed 2026-07-18.
- GM windshield position statement (via Repairer Driven News, 2026-03-20) — post-windshield front-camera
  calibration required. Tier 1 OEM (via trade press; precisely dated, not independently re-verified). Accessed 2026-07-18.
- Nissan TSB NTB23-011C, "2022 Rogue — Forward Driving Aids Temporarily Disabled" (DTC C2582-97),
  NHTSA-hosted as MC-11004973 (static.nhtsa.gov/odi/tsbs/2024/MC-11004973-0001.pdf) — sensor-blocked /
  forward-radar cue (FM-1, FM-3). Tier 1 OEM. Accessed 2026-07-18.
- Toyota/Ford owner documentation — radar "may not function if covered with snow, ice, or dirt"; OEM
  owner-manual guidance on park-assist ultrasonic false-alerts. Tier 1 OEM. Accessed 2026-07-18.
- Honda Sensing owner documentation (Quick Reference Guide, owners.honda.com) — single front camera feeds
  CMBS/LKAS/RDM; one fault throws multiple messages (FM-5 diagnostic authority). Tier 1 OEM. Accessed 2026-07-18.
- NHTSA ODI **defect investigations** PE22-003 (2019–2023 Honda Passport/Insight inadvertent AEB) and
  EA22-002 (2021–2022 Tesla Model 3/Y phantom braking with adaptive cruise), static.nhtsa.gov/odi/inv/2022/
  — the phantom-activation diagnostic authority (FM-4), distinct from complaint narratives. Tier 1 regulatory. Accessed 2026-07-18.
- NHTSA FMVSS 127 AEB final rule (finalized April 2024, effective ~Sept 2029) + the 2016 20-automaker
  voluntary AEB commitment (target Sept 2022) — fleet-growth demand framing (§8). Tier 1. Accessed 2026-07-18.

Linguistic (customer-voice) sources — used ONLY for phrasing, never as a diagnostic cite:
- NHTSA ODI complaint narratives (public domain) — phantom-braking, multi-message Honda Sensing, LDW
  false alerts, phantom lane-keep steer. Provenance `nhtsa` / `nhtsa-paraphrase`.
- Tekmetric corpus / authored / forum sets: **searched, zero ADAS hits** — recorded as gap evidence.
- Synthetic phrasings flagged `synthetic` (elevated share this dossier — forced by the corpus gap; see §4).

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every failure mode (FM-1…FM-6) carries a **named diagnostic-authority** cite (OEM docs / OEM TSB /
      SAE standard / NHTSA ODI defect *investigation*). ODI complaint *narratives* are used for voice only —
      the two authorities are no longer mixed (FM-4/FM-5 re-cited to OEM docs + ODI investigations).
- [x] Every NO-FIT in §8 terminates in a typed op (subcategory propose + catalog propose + keyword/hedge/
      negative/ slot-value ops in `proposals.yaml`).
- [x] Every negative example names `routes_to`.
- [x] Synonyms are ≥2 tokens or domain tokens (ADAS, LKA, AEB, TPMS-style) — no bare "light"/"sensor";
      shop-jargon "ADAS calibration" removed from Stage-1 keywords/synonyms in favor of customer-voice
      phrasings ("camera calibration", "get the camera calibrated", "calibrate the sensors").
- [x] Fact cues are literal; the phantom-brake trap and obstruction case are covered as inference guards;
      the `not_drivable_needs_tow` enum value is now used verbatim (vocab slip fixed).
- [x] Confusable coverage now includes conventional-vs-adaptive cruise (§5/§7 + negative example) and
      phantom-steer-vs-mechanical-pull (§5/§7 + negative example on `pulling_drifting_or_wandering_on_the_road`).
- [x] Catalog/service change is **proposed, Chris-gated**, with honest (forward-looking, low-volume) demand
      framing — reworded to the 2016 voluntary AEB commitment + FMVSS 127 (2029) mandate reality (not "mandated" today).
- [x] ≥8 golden cases incl. 1 inference-trap + ≥1 null-route (work-order line) in `proposals.yaml`;
      golden-case over-assertions removed (case 3 drivable_state, case 9 customer_request_type, case 10 onset_timing).
- [x] New-slot discipline honored: `recent_action` value add (justified); the battery-relearn trigger
      reuses the existing `battery_or_alternator_work` value; `adas_behavior` slot **deferred**
      for failing the ≥3-question rule (logged, not proposed).
- [~] Corpus-first / synthetic-≤30% **intentionally departed** — no ADAS corpus exists. Synthetic share of
      the substantive lexicon is ~⅓ (disclosed per line); several real-voice `nhtsa-paraphrase` entries were
      added (phantom-steer, messy AEB wording) to dilute it, but it remains above the ~30% cap by necessity.
      The aggregator should **down-weight** this system's synthetic lines accordingly.
