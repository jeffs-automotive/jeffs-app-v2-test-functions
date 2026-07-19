# Driveline: CV joints, driveshaft, differential, AWD/4WD — diagnostic dossier
slug: driveline-cv-diff-awd   date: 2026-07-18   binds_services: [awd_4x4_testing, suspension_steering_check, transmission_testing, abs_traction_stability_testing]   binds_categories: [noise, vibration, leak, warning_light]

> **KNOWN UNDER-REPRESENTATION.** The scheduler taxonomy is symptom-organized and has **no driveline
> spine**: CV/bearing/diff/driveshaft symptoms are scattered across `noise`
> (`popping_or_clicking_when_turning`, `humming_or_whirring_at_speed`, `clunking_over_bumps`,
> `rattling_underneath_the_car`), `vibration`, and one `leak` slug
> (`thick_dark_brown_puddle_gear_or_differential_oil`), while the actual *system* test
> (`awd_4x4_testing`) has an **empty `example_keywords[]`** and **no subcategories**. Two real
> customer symptoms — **U-joint/driveshaft/diff "clunk-on-take-off / shift-into-gear" backlash** and
> **AWD driveline windup / bind in tight turns** — have **NO good subcategory fit** today. This
> dossier sharpens the four noise slugs + the leak slug, populates Stage-1 keywords for
> `awd_4x4_testing`, and proposes one new subcategory + one `onset_timing` value + one slot + one
> Chris-gated `catalog.category_mapping.add` (add `noise` to `awd_4x4_testing.concern_categories` so the
> new subcategory is reachable from the AWD service) to close the gap.

---

## 1. Scope & boundaries

**In scope** — the components that transmit engine torque to the wheels *after* the transmission
output, plus the on-demand torque-routing hardware:

- **CV (constant-velocity) joints & halfshafts** — outer + inner joints, CV boots (FWD, AWD, and IRS
  rear axles). The click-on-turn and grease-slung-boot failures.
- **Driveshaft(s) & U-joints / center support bearing** — RWD/4WD propeller shafts, slip yokes,
  carrier (center) bearing. Take-off clunk, vibration-with-speed, whirr.
- **Differential(s) & final drive** — ring & pinion, carrier, pinion bearing, axle/output-shaft
  seals. Diff whine, gear-oil leak, rear-end howl.
- **Transfer case & AWD couplings** — 4WD engagement (shift-on-the-fly, electronic), AWD clutch
  packs / viscous couplers / PTU (power-transfer unit). "Won't go into 4WD", "stuck in 4WD", bind in
  tight turns, `Service 4WD` / `AWD Malfunction` messages.
- **Wheel hub / wheel bearings** — the speed-tracking hum that shares a subcategory with tire noise.

**OUT of scope** (neighbor dossier owns it):

| Out-of-scope symptom | Why it's not driveline | Owning neighbor |
|---|---|---|
| Slipping/flaring shifts, delayed engagement, trans codes, shudder in a torque converter | Internal automatic/CVT transmission | `transmission` (service `transmission_testing`) |
| Squeak/whine/pop from the **steering column or PS pump while parked** or with wheel angle only | Steering, not axle torque | `steering-power-steering` (`noise_when_turning_the_steering_wheel`) |
| Clunk/creak over bumps from **sway-bar links, ball joints, struts** with no turn/torque link | Suspension ride motion | `suspension-steering-chassis` (`clunking_over_bumps`, `squeaking_or_creaking_over_bumps`) |
| Metal-on-metal grind **when braking** | Brake friction | `brakes` (`metallic_grinding`) |
| Red/pink puddle | ATF / power-steering fluid | `leak` (`red_or_pink_puddle_transmission_or_power_steering`) |

Boundary rule of thumb: **driveline symptoms track TORQUE and ROAD SPEED** (change with
accelerate/coast/turn-loading, scale with vehicle speed) — not with steering angle alone (steering),
not with bump impacts alone (suspension), not with engine RPM at a standstill (accessory/belt).

---

## 2. System primer (expert, CITED)

**Torque path.** Engine → transmission → (RWD) driveshaft + U-joints → differential ring & pinion →
axle shafts → wheels; (FWD) transaxle → CV halfshafts → wheels; (AWD/4WD) add a transfer case or PTU
that splits torque to a second axle through a prop shaft and a second differential
[Halderman, *Automotive Technology* / *Automotive Chassis Systems*, driveline & drivetrain chapters,
Tier 2]. (Note on terminology authority: SAE J1930 standardizes *electrical/electronic* diagnostic
terms and abbreviations, not mechanical driveline component nomenclature — it is deliberately NOT cited
here for the mechanical torque-path description.)

**CV joints.** A constant-velocity joint transmits uniform rotational speed through a varying angle —
essential on a steered/independently-sprung driven wheel. The outer (wheel-side) joint is a
Rzeppa-type ball joint packed in grease and sealed by a rubber CV boot; when the boot tears, grease is
flung out and grit destroys the joint, producing the classic **rhythmic click/pop that appears only
under turning load** [Halderman, CV-joint/halfshaft chapter, Tier 2]. The inner (plunge/tripod) joint
failing tends to produce a **shudder/vibration on hard acceleration** rather than a turn click
[Halderman, Tier 2].

**Driveshaft & U-joints.** A Cardan (universal) joint is NOT constant-velocity — it accommodates angle
but introduces a small speed fluctuation twice per revolution, so a worn U-joint produces a
**vibration that rises with driveshaft speed** and a **clunk on torque reversal** (park→drive,
drive→reverse, throttle on/off) as worn needle bearings take up backlash — "clunking only when starting
to move or getting on and off the gas might be loose yokes, bad u-joints or worn transfer case or
transmission parts" [West Coast Differentials, "Diagnosing Differential Problems",
https://differentials.com/diagnosing-differential-problems/, Tier 2, accessed 2026-07-18]. A failing
**center support bearing** adds a **hum/whirr with speed** and a launch shudder [Halderman, driveshaft
chapter, Tier 2].

**Differential / final drive.** The hypoid ring-and-pinion runs in thick GL-5 **gear oil** (sulfur/
phosphorus extreme-pressure additives — the source of its rotten-egg smell). The load phase discriminates
the failing part: **a howl/whine on ACCELERATION (drive side)** points to worn ring-and-pinion gears or
an improper gear set-up, while **a whirr/whine only on DECELERATION/COAST (coast side)** points to worn
pinion bearings or loose pinion-bearing preload and "almost never" to the ring & pinion; worn
ring-and-pinion or spider gears also produce **clunk on take-off** from excess backlash
[West Coast Differentials, Tier 2, accessed 2026-07-18; Halderman, axle/differential chapter, Tier 2].
Axle/pinion **seals** leak thick dark gear oil at the rear cover, pinion nose, or axle-tube ends
[Halderman, Tier 2].

**AWD/4WD torque routing.** Part-time 4WD (trucks) uses a transfer case with a locked front/rear
coupling — turning tightly on dry pavement causes **driveline windup / "crow-hop" / bind** because the
front and rear axles must travel different distances; this is normal for part-time 4WD on pavement but
is a *fault* in AWD/full-time systems where a center diff/coupler should absorb it
[Halderman, transfer-case/4WD chapter, Tier 2]. Electronic AWD (clutch-pack "on-demand", viscous, or
Haldex-type) can throw a **`Service 4WD` / `AWD System Malfunction`** message and drop to 2WD.
Mismatched or unevenly-worn tires are a recognized cause of AWD-coupler strain because the system reads
the rotational-speed difference across axles as slip [Halderman, AWD chapter, Tier 2].

**Architectures that matter for US calibration** (from the corpus vehicle mix — trucks, Subarus,
crossovers): part-time 4WD pickups (F-150, Silverado, Tacoma), full-time AWD crossovers/Subaru
(symmetrical AWD), and FWD cars with CV halfshafts. Rare here: RWD sports-car IRS, so weight the
lexicon toward truck 4WD + Subaru AWD + FWD CV.

---

## 3. Failure-mode catalog (the diagnostic spine — CITED per mode)

### 3.1 Outer CV joint worn / torn boot
- **Sensory signature:** `noise_descriptor = popping_or_clicking`; rhythmic tick/click/clack that
  **speeds up the tighter the turn** and is usually **one-sided**.
- **Conditions:** `onset_timing = when_turning`; `speed_band = low_speed` (parking lots, U-turns);
  worse under simultaneous turn + light acceleration; grease often slung on the inside of the wheel/
  tire.
- **Severity / drivability:** `drivable_but_concerned` early; a fully failed outer joint can separate
  → `not_drivable_needs_tow`.
- **Typical misattribution:** customers call it a "clicking axle", blame a "bad wheel bearing", or
  think it's the brakes; some call it a "ticking" that they confuse with engine tick.
- **Source:** Halderman, CV-joint/halfshaft chapter, Tier 2.

### 3.2 Inner CV / tripod joint worn (plunge joint)
- **Sensory signature:** `noise_descriptor = clunking` on gear engagement AND a **shudder/vibration on
  hard acceleration** from a stop (`vibration`, `shaking_when_speeding_up_or_going_uphill`).
- **Conditions:** `onset_timing` = take-off / hard acceleration; straight-line, not turn-dependent
  (this is the CV mode that does NOT click on turns).
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** blamed on the transmission ("trans shudders when I punch it") or on motor mounts.
- **Source:** Halderman, CV-joint/driveline chapter, Tier 2.

### 3.3 Worn U-joint (driveshaft universal joint)
- **Sensory signature:** `noise_descriptor = clunking`; a **single hard clunk on torque reversal**
  (park→drive, into reverse, snapping on/off the throttle) + a **vibration that rises with speed**.
- **Conditions:** `onset_timing` = on gear engagement / take-off; vibration `speed_band = mid_speed`→
  `highway`; a dry/rusty U-joint may also **squeak** rotating slowly.
- **Drivability:** `drivable_but_concerned`; a failed U-joint can drop the driveshaft → severe.
- **Misattribution:** "transmission clunks when I shift"; "rear end is loose".
- **Source:** West Coast Differentials (clunk on/off gas → loose yokes / bad U-joints), Tier 2, accessed
  2026-07-18; Halderman, driveshaft chapter, Tier 2.

### 3.4 Center support (carrier) bearing failing
- **Sensory signature:** `noise_descriptor = humming_or_whirring`/`roaring`; hum with speed + a
  **launch vibration/shudder** from a stop; can be felt through the floor mid-vehicle.
- **Conditions:** `speed_band` rises with road speed; `sound_or_smoke_location_zone = under_car`
  (middle).
- **Source:** Halderman, driveshaft/center-bearing chapter, Tier 2.

### 3.5 Differential pinion-bearing whine (load-phase dependent)
- **Sensory signature:** `noise_descriptor = whining`/`humming_or_whirring`; a gear **whine whose
  presence depends on which load phase you're in.** The mechanism is NOT one generic "whine that
  changes with load" — the phase names the part: a **howl/whine on ACCELERATION** implicates
  ring-and-pinion **mesh** wear or set-up (drive side), while a **whirr/whine only on COAST/DECEL**
  implicates worn **pinion bearings / loose pinion-bearing preload** (coast side) and "almost never"
  the ring & pinion. (Routing outcome is the same subcategory either way — this refinement is for the
  discriminator prose, not a new route.)
- **Conditions:** `speed_band` = mid→highway; `location_axle = rear` (RWD/AWD) or front (AWD front
  diff/PTU); `onset_timing = when_accelerating` vs coast is the key modifier customers can report.
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** "transmission is whining"; "sounds like the tires"; customers rarely say
  "differential" unless a prior shop told them.
- **Source:** West Coast Differentials (accel = ring & pinion; decel-only = pinion bearings/preload),
  Tier 2, accessed 2026-07-18; Halderman, axle/differential chapter, Tier 2.

### 3.6 Ring-and-pinion / spider-gear wear → take-off clunk & howl
- **Sensory signature:** `noise_descriptor = clunking` on take-off and throttle reversal (excess
  backlash) progressing to a `roaring`/howl `humming_or_whirring` with speed.
- **Conditions:** `onset_timing` = on gear engagement / take-off; worsens over time (`started_when =
  gradually`).
- **Drivability:** `drivable_but_concerned` → `not_drivable_needs_tow` if catastrophic.
- **Source:** West Coast Differentials, Tier 2, accessed 2026-07-18; Halderman, differential chapter,
  Tier 2.

### 3.7 Differential / axle / pinion seal leak (gear-oil leak)
- **Sensory signature:** `fluid_color = thick_dark_brown`; thick, sticky, dust-caked dark oil; a
  **strong sulfur/rotten-egg smell** (`smell_descriptor = rotten_egg_or_sulfur`).
- **Conditions:** `fluid_under_car_location = under_rear` (or under_middle for a 4WD/AWD PTU/transfer
  case); from a round "pumpkin" housing, pinion nose, or axle-tube ends.
- **Severity:** slow seep = `drivable_but_concerned`; run-dry risks diff failure.
- **Misattribution:** confused with engine oil (thinner, further forward, petroleum smell) or ATF
  (red, thinner).
- **Source:** Halderman, axle-seal service, Tier 2 (mechanically: a leaking pinion/axle seal loses the
  GL-5 gear oil the ring-and-pinion runs in).

### 3.8 Wheel/hub bearing hum (shares the tire-noise subcategory) — AND can trip the ABS/traction light
- **Sensory signature:** `noise_descriptor = humming_or_whirring`/`roaring`; steady **hum rising with
  road speed**, typically from ~30-40 mph, that **changes with steering load** (louder turning one
  direction, quieter the other — because cornering shifts weight onto/off the bearing).
- **Conditions:** `speed_band` tracks road speed (not engine RPM); `location_side` often nameable by
  which-way-it-quiets.
- **Electrical co-symptom:** on modern vehicles the **wheel-speed (ABS) sensor is integral to the hub
  bearing assembly** (tone ring built into the bearing). A worn bearing develops play, which changes
  the sensor air gap, which "changes the signal pattern" — so a failing hub bearing can **set an ABS
  and/or traction-control light** with no separate sensor fault. A `humming/growling wheel noise`, an
  ABS light, and a traction light can be **one fault, not two** (`warning_light_named = "abs"/
  "traction"`). This is the driveline entry point into `abs_traction_stability_testing` (see §7).
- **Drivability:** `drivable_but_concerned`; a badly failed bearing can seize → severe.
- **Misattribution:** "sounds like off-road/snow tires", "tire noise", "airplane taking off"; or the
  customer leads with the ABS/traction light and never mentions the hum.
- **Source:** Halderman, wheel-bearing chapter, Tier 2; Tomorrow's Technician (Babcox), "ABS Light On?
  It Might Be a Wheel Bearing, Not the Sensor",
  https://www.tomorrowstechnician.com/abs-light-on-it-might-be-a-wheel-bearing-not-the-sensor/, Tier 2,
  accessed 2026-07-18.

### 3.9 AWD/4WD driveline windup / bind + engagement faults
- **Sensory signature:** a **bind, hop, skip, or shudder in tight low-speed turns** ("feels like it's
  fighting itself" / "like a truck stuck in 4x4"); OR **won't engage / stuck in 4WD**; often with a
  **`Service 4WD` / `AWD System Malfunction` message** and a drop to 2WD.
- **Conditions:** low-speed tight turns (parking lots, U-turns), dry pavement; frequently after
  mismatched/worn tires or an impact; `warning_light_named` = "4wd"/"awd".
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** "transmission slips in turns"; "brakes are grabbing when I turn".
- **False-positive to rule out:** **limited-slip differential chatter** (§3.11) mimics this
  bind-in-turns signature on a RWD one-axle vehicle with no 4WD/AWD hardware — see the discriminator in
  §3.11 and §5.
- **Source:** Halderman, transfer-case/AWD chapter, Tier 2 (part-time-4WD pavement windup; AWD coupler
  strain from tire-diameter mismatch).

### 3.10 Broken / snapped axle shaft or halfshaft (total-failure → tow)
- **Sensory signature:** a **loud bang / crack under load, then no forward motion** — the engine revs
  freely and RPM climbs but the vehicle doesn't move (or a wheel free-spins). Often **no dash warning
  light and no prior clicking** if the shaft fractured suddenly (rust-belt corrosion fracture, or a
  bent/worn joint finally letting go).
- **Conditions:** typically on take-off / under load (`onset_timing = on_gear_engagement_or_take_off`,
  proposed); the axle shaft is the **sole** torque member to that wheel, so a fracture transmits zero
  torque.
- **Severity / drivability:** `drivable_state = not_drivable_needs_tow` — do NOT drive (risks the
  transmission, hub bearing, ABS wiring, brake hose). **This is the driveline mode most likely to need
  tow routing**; the customer's lead phrasing is usually about the car "not moving" or "revving but
  going nowhere", not a noise.
- **Misattribution:** "transmission went out" / "it's slipping" (engine revs, no motion reads as a
  slipping trans to a layperson).
- **Source:** Halderman, drive-axle/halfshaft chapter, Tier 2 (the axle shaft is the sole drive member;
  a fractured shaft transmits no torque → loss of motion, engine free-revs).

### 3.11 Limited-slip / posi differential chatter in tight turns
- **Sensory signature:** a **shudder, chatter, or clunk that occurs only when CORNERING** (parking-lot
  turns, driveway maneuvers) on a RWD/limited-slip axle — "banging, clunking or chattering only on
  corners." Distinct from a discrete CV click and from full-driveline windup: it is a
  **friction/clutch-pack chatter** as the LSD clutches grab-and-release through the turn.
- **Conditions:** tight low-speed turns; classically caused by **worn positraction/LSD clutches, broken
  spider gears, or the wrong / depleted friction-modifier (posi) additive** in the gear oil; NO
  4WD/AWD hardware and NO `Service 4WD`/`AWD` message involved.
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** read as an AWD/4WD bind (§3.9) — but there is no transfer case/coupler; the tell
  is that it is a **single-axle** vehicle and the chatter often quiets after a gear-oil / friction-
  modifier service.
- **Source:** West Coast Differentials ("banging, clunking or chattering only on corners can be caused
  by broken spider gears, lack of sufficient positraction lubrication, or worn positraction clutches"),
  https://differentials.com/diagnosing-differential-problems/, Tier 2, accessed 2026-07-18.

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Source order: Tekmetric corpus (labeled) → NHTSA/forum-paraphrase → synthetic (flagged, ≤30%). Full
machine list in `driveline-cv-diff-awd.lexicon.yaml`. Representative rows:

| Phrase (customer voice) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "clicking noise from the front only when I turn in parking lots" | popping_or_clicking_when_turning | unambiguous | tekmetric-pattern |
| "tick-tick-tick when I make a sharp turn, faster the tighter I go" | popping_or_clicking_when_turning | unambiguous | synthetic |
| "very noticeable humming from the rear end, most noticeable 30 to 40 mph, sounds like snow tires" | humming_or_whirring_at_speed | needs-fact:location_side | tekmetric (tkc-113) |
| "humming that gets louder curving left, quieter curving right, feel it in the floor" | humming_or_whirring_at_speed | unambiguous (bearing) | forum-paraphrase |
| "whine when accelerating that stops when I let off the gas, they said maybe the differential" | humming_or_whirring_at_speed | cross-system:transmission_testing | forum-paraphrase |
| "jerking in the driveline when backing up or on tight turns" | (NO FIT → propose driveline_engagement_clunk_or_bind) | cross-system:awd_4x4_testing | tekmetric (tkc-269) |
| "clunking noise when putting the car into drive from park / turning left" | (NO FIT → propose driveline_engagement_clunk_or_bind) | needs-fact:onset_timing | tekmetric (tkc-275) |
| "skipping feeling when turning and driving, feels like a truck stuck in 4x4" | awd_4x4_testing (route, no subcat) | unambiguous | tekmetric (tkc-086) |
| "my 4 wheel drive won't engage, the 4wd light just flashes and I hear grinding" | awd_4x4_testing (route, no subcat) | unambiguous | eval (awd_4x4_testing-001) |
| "truck feels stuck in 4 wheel drive and binds up when turning" | awd_4x4_testing (route, no subcat) | unambiguous | eval (awd_4x4_testing-002) |
| "thick dark fluid under the rear axle, smells like rotten eggs" | thick_dark_brown_puddle_gear_or_differential_oil | unambiguous | existing positive |
| "rear axle seal leak" | thick_dark_brown_puddle_gear_or_differential_oil | unambiguous (work-order voice) | tekmetric |
| "REAR DIFFERENTIAL LEAK INSPECT AND ADVISE" | thick_dark_brown_puddle_gear_or_differential_oil | unambiguous (work-order voice) | tekmetric |
| "REAR DIFF SERVICE" | (null-route / maintenance) | null-route | tekmetric |

Messiness observed & preserved: all-caps work-order voice ("REAR DIFF SERVICE"), part-name misuse
("transmission" for any drivetrain feel), vagueness ("something's off with my four wheel drive"),
diagnosis-echo ("they said maybe the differential"), and truck idiom ("stuck in 4x4", "crow-hop").

---

## 5. Differential & discriminating questions (binds required_facts + slots)

For each confusable pair, the ONE best discriminator + the fact slot/value that resolves it:

| Pair | Discriminating question | Slot + value that answers it |
|---|---|---|
| **CV click (turning)** vs **steering-column creak/pop** | "Does it happen while the car is MOVING through a turn, or also when you turn the wheel while parked/stopped?" | **No slot gap** — `speed_band` already carries this: moving-turn → `onset_timing=when_turning` + `speed_band=low_speed`; turning the wheel while parked/at a light → `onset_timing=when_turning` + `speed_band=stopped`, which routes to steering (`noise_when_turning_the_steering_wheel`). The `stopped` value exists in `extracted-facts.ts`, so the moving-vs-stationary distinction is expressible today. |
| **CV click** vs **wheel-bearing hum** | "Is it a repeating CLICK that only shows up when turning, or a steady HUM that rises with speed?" | `noise_descriptor`: `popping_or_clicking` vs `humming_or_whirring`. |
| **Wheel-bearing hum** vs **tire hum** | "Does the hum get louder turning ONE direction and quieter the other, or stay the same no matter how you steer?" | **Gap:** no slot for steering-load sensitivity → §9 backlog. Bearing = changes with steering load; tire = constant + correlates with `tire_state=uneven_wear`. |
| **Diff whine** vs **wheel-bearing hum** | "Does the sound change when you get ON the gas vs COAST, or does it just track how fast you're going?" | **Gap:** load-vs-speed distinction. `onset_timing=when_accelerating` present → leans diff; pure speed-tracking → leans bearing. |
| **Diff whine** vs **transmission whine** | "Does the whine track ROAD speed (same in every gear at a given mph) or ENGINE rpm (changes when the trans shifts)?" | Road-speed → driveline; rpm-linked → `transmission_testing`. `speed_band` alone can't hold this. |
| **U-joint/diff take-off clunk** vs **suspension bump clunk** | "Does the clunk happen when you SHIFT into gear or take off from a stop, or when you go over BUMPS?" | `onset_timing`: **propose `on_gear_engagement_or_take_off`** (new value) vs existing `over_bumps`. |
| **AWD bind in turns** vs **CV click** | "Does it CLICK, or does the whole car BIND/HOP/shudder like it's fighting itself in tight turns?" | `noise_descriptor=popping_or_clicking` (CV) vs **propose slot `driveline_behavior=binds_or_hops_in_turns`** (AWD). |
| **AWD windup bind** vs **limited-slip (posi) chatter** | "Does your vehicle have 4WD/AWD, or is it a rear-wheel-drive with a limited-slip/posi rear end — and is there any 4WD/AWD warning message?" | AWD windup: 4WD/AWD hardware present, may set `warning_light_named="4wd"/"awd"` → awd_4x4_testing. LSD chatter: single-axle RWD, NO 4WD/AWD message, often eased by a friction-modifier gear-oil service → suspension_steering_check. `vehicle_powertrain` + `warning_light_named` split them (§3.11). |
| **Hub-bearing hum + ABS/traction light** vs **standalone ABS fault** | "Is there a humming/growling wheel noise along with the ABS or traction light, or just the light?" | Integral wheel-speed sensor: a worn hub bearing can set the light AND hum. Hum present → surface `suspension_steering_check` alongside `abs_traction_stability_testing`; light-only → `abs_traction_stability_testing`. `noise_descriptor=humming_or_whirring` + `warning_light_named="abs"/"traction"` (§3.8, §7). |
| **AWD/4WD fault** vs **generic performance** | "Is there a 4WD/AWD warning message, or does it only act up when 4WD/AWD is engaged?" | `warning_light_named` = "4wd"/"awd"; `recent_action` (tire replacement/impact). |
| **Gear-oil leak** vs **engine-oil leak** | "Is the puddle under the REAR axle and does it smell like rotten eggs, or under the ENGINE with a petroleum smell?" | `fluid_under_car_location=under_rear` + `smell_descriptor=rotten_egg_or_sulfur` → gear oil; `under_engine_front` + `burnt_oil` → engine oil. |

**Situational-cue OVERRIDE (taxonomy §3b PRIORITY-ORDER rule).** When a driveline symptom is
*causally tied to recent work* — e.g. corpus **tka-034** "CLIENT JUST HAD REAR DIFFERENTIAL SERVICED
ELSEWHERE AND NOW SEES FLUID LEAKING EVERYWHERE" — the `after_recent_service_or_repair_work` situational
bucket **overrides** the symptom keyword (here the gear-oil leak) and Stage-1 routes to that 'other'
bucket → advisor, NOT to `thick_dark_brown_puddle_gear_or_differential_oil` / `oil_leak_testing`. The
same override applies to an AWD bind that appeared right after a tire replacement or an impact
(`after_recent_accident_or_impact`). The leak/AWD routing rules in §8 are subordinate to this override.
All three judges confirmed tka-034 as `after_recent_service_or_repair_work` — this is the canonical
pattern, not an edge case.

---

## 6. Warning lights & DTC surface

Driveline itself has few dedicated dash lights, but AWD/4WD electronics do:

| Light / message | Customer names it | Solid vs flashing | Feeds |
|---|---|---|---|
| `Service 4WD` / `4WD` indicator | "the 4 wheel drive light", "4wd light flashing at me" | flashing during a failed engagement; solid = fault stored | `warning_light_named=4wd`, `warning_light_behavior` |
| `AWD System Malfunction` / `AWD` | "AWD malfunction message", "it said 2WD mode engaged" | message on the driver-info screen | `warning_light_named=awd` |
| ABS / traction-control light (**from a hub bearing**) | "abs light", "traction light", "sliding-car light" | steady or flashing | `warning_light_named="abs"/"traction"` — see below |
| Traction/stability (secondary to AWD) | "the sliding-car light came on too" | often co-illuminates with AWD faults | routes to `traction_control_stability_light` if primary |

**Two distinct co-illumination paths (do not collapse them):**
- **AWD/4WD fault** co-illuminates the traction/stability light (torque-routing electronics share the
  stability system) — routes to `awd_4x4_testing`.
- **Failing hub bearing** trips the **ABS and/or traction light on its own** because the wheel-speed
  sensor is integral to the bearing (§3.8): bearing play changes the sensor air gap → the ABS module
  sees signal dropouts → sets a code and light, with a humming/growling wheel as the companion symptom.
  This is the cluster in corpus **tkc-120** ("abs / trac / no AWD message", judged
  `abs_traction_stability_testing` / `abs_anti_lock_brake_light`) — note the customer explicitly says
  **no AWD message**, which rules out the AWD path and points at the bearing/ABS-sensor path. Cross-ref
  §7 and the `abs-traction-stability` dossier.

Note the other corpus overlap: `"AWD System Malfunction 2WD Mode Engaged"` co-occurs with a
**check-engine light** — when a CEL is the customer's lead symptom, Stage-1 must still surface
`awd_4x4_testing` as an acceptable candidate alongside `check_engine_light_testing` (hedge in §7 /
proposals).

---

## 7. Confusable neighbors (cross-system)

1. **Steering (`noise_when_turning_the_steering_wheel`)** — CV click is torque/motion-dependent (only
   while driving through a turn); steering-column/PS noise happens with wheel angle even while parked.
   Discriminator: moving vs stationary. Cross-ref: `steering-power-steering` dossier.
2. **Suspension (`clunking_over_bumps`, `squeaking_or_creaking_over_bumps`)** — bump-triggered ride
   clunks vs torque-reversal/take-off driveline clunks. The corpus shows heavy overlap
   ("clunking...turning left" gets voted suspension). Discriminator: bumps vs gear engagement.
   Cross-ref: `suspension-steering-chassis` dossier.
3. **Transmission (`transmission_testing`)** — whine/clunk/shudder that is rpm-linked or shift-linked
   is transmission; road-speed-linked is driveline. Customers conflate the two under "transmission".
   Cross-ref: `powertrain-engine-performance` / transmission router.
4. **Tires (`suspension_steering_check` / tire noise)** — bearing hum vs tire roar both land in
   `humming_or_whirring_at_speed`; steering-load sensitivity + `tire_state` split them (both route to
   the same service, so this is a within-subcategory diagnostic note, not a routing fork).
5. **Brakes (`metallic_grinding`)** — a dragging/failed bearing or CV can grind; but grind **only when
   braking** is brakes. Discriminator: `onset_timing=when_braking`.
6. **ABS / traction / stability (`abs_traction_stability_testing`)** — a failing **hub bearing** trips
   the ABS/traction light because the wheel-speed sensor is integral to the bearing (§3.8). When the
   customer leads with the light and mentions **no AWD message** (corpus tkc-120), it is the bearing/ABS
   path, not the AWD path. Discriminator: is there a companion humming/growling wheel noise
   (`noise_descriptor=humming_or_whirring`) → surface `suspension_steering_check` alongside
   `abs_traction_stability_testing`; light-only → `abs_traction_stability_testing`. Cross-ref:
   `abs-traction-stability` dossier.
7. **Limited-slip / posi differential (within `suspension_steering_check`)** — LSD clutch chatter in
   tight turns (§3.11) mimics AWD windup but has no 4WD/AWD hardware or message. Discriminator:
   single-axle RWD + no AWD message + friction-modifier service eases it. Same owning service as the CV
   click; a within-service diagnostic note.

This dossier OWNS the confusable-matrix rows: *CV click vs other turning noise*, *bearing hum vs
tire hum*, and *hub-bearing ABS/traction light vs AWD-fault traction light* (see proposals
`stage1.hedge.add` + negatives).

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode (§3) | Current testing service | Current category | Current subcategory slug | Fit |
|---|---|---|---|---|
| 3.1 Outer CV click | suspension_steering_check | noise | `popping_or_clicking_when_turning` | **good** |
| 3.2 Inner/tripod CV shudder | suspension_steering_check | vibration | `shaking_when_speeding_up_or_going_uphill` | **weak** (accel shudder fits, but "CV" cue lost) |
| 3.3 Worn U-joint clunk + vibration | suspension_steering_check | noise / vibration | `clunking_over_bumps` (mis-fit) | **NO FIT** for take-off/shift clunk |
| 3.4 Center support bearing hum | suspension_steering_check | noise | `humming_or_whirring_at_speed` | **good** |
| 3.5 Diff pinion whine | suspension_steering_check | noise | `humming_or_whirring_at_speed` | **weak** (whine≠hum; load-phase cue lost). NB: the `noise` subcat is reachable from `suspension_steering_check`, **not** from `awd_4x4_testing` (whose `concern_categories` = performance/electrical/warning_light). |
| 3.6 Ring-pinion take-off clunk/howl | suspension_steering_check (today) | noise | (take-off clunk) | **NO FIT** → proposed `driveline_engagement_clunk_or_bind` |
| 3.7 Gear-oil / axle-seal leak | oil_leak_testing | leak | `thick_dark_brown_puddle_gear_or_differential_oil` | **good** (leak subcat is reachable from `oil_leak_testing`/`coolant_leak_testing`, **not** from `awd_4x4_testing`) |
| 3.8 Wheel-bearing hum (+ ABS/traction light) | suspension_steering_check (+ abs_traction_stability_testing when a light is present) | noise (+ warning_light) | `humming_or_whirring_at_speed` (+ `abs_anti_lock_brake_light`/`traction_control_stability_light`) | **good** |
| 3.9 AWD bind / engagement fault | awd_4x4_testing | performance/electrical/warning_light | (routes to service, **no subcat**) | **good (service)**, but keyword-blind (empty `example_keywords`) |
| 3.10 Broken axle shaft (tow) | suspension_steering_check | vibration/noise | (no total-failure subcat; `drivable_state=not_drivable_needs_tow` drives the tow flag) | **weak** — modeled by `drivable_state`, not a subcat |
| 3.11 LSD / posi chatter in turns | suspension_steering_check | noise | (take-off/turn chatter) | **NO FIT** → proposed `driveline_engagement_clunk_or_bind`; discriminate from AWD windup per §3.11 |

**NO-FIT → proposals (demand evidence from corpus):**
- **`driveline_engagement_clunk_or_bind`** (new subcategory under category `noise`): covers U-joint/diff
  take-off clunk (§3.3, §3.6), LSD chatter (§3.11), and AWD windup/bind (§3.9). Evidence: tkc-269
  ("jerking in driveline when backing up or tight turns"), tkc-275 ("clunking...putting car into drive
  from park/turning left"), forum-paraphrase driveshaft-slip-on-take-off + reverse-clunk patterns.
  Today these split ambiguously between suspension and null. **Chris-gated.**
  - **Reachability caveat (must be stated to land it):** a `noise` subcategory is reachable from
    `suspension_steering_check` (whose `concern_categories` include `noise`) but **NOT** from
    `awd_4x4_testing` (`concern_categories` = performance/electrical/warning_light — verified in
    `catalog-snapshot.json`). The U-joint/diff/LSD clunk half of this subcategory routes fine via
    `suspension_steering_check`, but the **AWD-windup half genuinely belongs to `awd_4x4_testing`**. To
    make the subcategory reachable from `awd_4x4_testing`, its `concern_categories` must gain `noise` —
    emitted as an explicit, **Chris-gated `catalog.category_mapping.add`** op in `proposals.yaml`. Until
    that lands, the subcategory is reachable only through `suspension_steering_check`.
- **`awd_4x4_testing` keyword population** (`stage1.keyword.add`): the service has an EMPTY
  `example_keywords[]`, so Stage-1 has no lexical hook for "4wd won't engage / stuck in 4x4 / AWD
  malfunction / binds in tight turns / driveline". This is the single highest-leverage fix.

No new **catalog service** proposed — `awd_4x4_testing` + `suspension_steering_check` +
`transmission_testing` already cover the test work; the gap is *routing signal* (keywords + one
subcategory + one `concern_categories` mapping), not *bookable work*.

---

## 9. Fact-slot audit

**Slots this system uses (of the 29):** `noise_descriptor`, `location_side`, `location_axle`,
`speed_band`, `speed_specific_mph`, `onset_timing`, `started_when`, `fluid_color`,
`fluid_under_car_location`, `smell_descriptor`, `warning_light_named`, `warning_light_behavior`,
`recent_action`, `sound_or_smoke_location_zone`, `vehicle_powertrain`, `drivable_state`,
`tire_state`, `customer_request_type`.

**Values customers actually state (corpus evidence):**
- `noise_descriptor`: `popping_or_clicking` (CV), `humming_or_whirring`/`roaring` (bearing/diff),
  `whining` (diff pinion), `clunking` (U-joint/backlash).
- `onset_timing`: `when_turning` (CV), `when_accelerating` (diff whine, tripod shudder), and — **not
  currently expressible** — "when I put it in drive / take off from a stop" (backlash clunk).
- `speed_band`: `low_speed` (CV click in parking lots) and — key for the CV-vs-steering split —
  **`stopped`** ("turning the wheel while parked / at a light"). The `stopped` value already exists in
  `extracted-facts.ts`, so the moving-through-a-turn vs turning-the-wheel-while-parked distinction is
  **fully expressible today — it is NOT a slot gap** (this is why §5 row 1 no longer defers to a
  proposed slot).
- `smell_descriptor=rotten_egg_or_sulfur` + `fluid_color=thick_dark_brown` + `fluid_under_car_location
  =under_rear` (gear-oil leak — well covered).
- `warning_light_named` free-text "4wd"/"awd" (AWD faults) and "abs"/"traction" (hub-bearing-induced
  light, §3.8/§6) — corpus + eval cases.
- `drivable_state=not_drivable_needs_tow` carries the **broken-axle total-failure** mode (§3.10) — no
  dedicated subcategory needed; the tow flag rides on this slot.

**Missing values / proposed slots:**
1. **`onset_timing` new value `on_gear_engagement_or_take_off`** (`stage3.slot.value.add`) — literal
   cues: "when I put it in drive", "shifting into gear", "into reverse", "taking off from a stop",
   "putting car into drive from park", "when I hit the gas from a stop", "backing up". Distinguishes
   U-joint/diff backlash clunk (§3.3/§3.6) from suspension `over_bumps` clunk. Backed by ≥3 questions
   (proposed subcategory Q's + existing clunking Q82 "when you start moving from a stop").
2. **New slot `driveline_behavior`** (`stage3.slot.propose`) — values
   `[binds_or_hops_in_turns, clunk_on_engagement, wont_engage_4wd, stuck_in_4wd, jerking_or_skipping,
   whine_changes_with_load]`. Unlocks the AWD-bind and engagement discriminators that no current slot
   holds. Guarded by the ≥3-question rule: it is proposed **conditional on** the
   `driveline_engagement_clunk_or_bind` subcategory landing (which supplies its questions) + the two
   existing `awd_4x4_testing`-adjacent needs; flagged for Chris.
3. **Backlog (no slot yet, <3 questions):** steering-load sensitivity of a hum ("louder turning one
   way") — the bearing-vs-tire and bearing-vs-diff discriminator. Currently only Q86 asks it with an
   empty `required_facts`. Logged as a backlog note rather than a forced slot; revisit if the NVH
   router accumulates ≥3 questions needing it.

**Spanish-language phrasings:** none mined here; logged as a backlog note for Chris per style guide
(do not improvise).

---

## 10. Sources

Diagnostic/differential claims (Tier per source-policy). Textbook cites are books (no URL/access date);
web cites carry URL + access date + tier per source-policy.

- **Halderman, *Automotive Technology* / *Automotive Chassis Systems*** — driveline, driveshaft, CV,
  axle/differential, transfer-case/4WD, and wheel-bearing chapters. **Tier 2** (standard textbook,
  explicitly named in source-policy Tier 2; a book, so no access date). Backbone for the general
  mechanical/failure-mode claims (§2, §3.1–3.4, §3.6–3.10).
- **West Coast Differentials — "Diagnosing Differential Problems"** —
  https://differentials.com/diagnosing-differential-problems/ — specialist differential-rebuilder
  technical page. **Tier 2, accessed 2026-07-18.** Source for the drive-side (accel) vs coast-side
  (decel) whine distinction and pinion-bearing-preload mechanism (§3.5), the take-off/on-off-gas clunk =
  loose yokes/U-joints (§3.3/§3.6), and the LSD/posi corner-chatter mechanism (§3.11).
- **Tomorrow's Technician (Babcox) — "ABS Light On? It Might Be a Wheel Bearing, Not the Sensor"** —
  https://www.tomorrowstechnician.com/abs-light-on-it-might-be-a-wheel-bearing-not-the-sensor/ —
  professional trade-tech publication. **Tier 2, accessed 2026-07-18.** Source for the integral
  hub-bearing wheel-speed sensor → ABS/traction light claim (§3.8, §6).

**Removed in this revision (per source-policy: unciteable diagnostic claims are deleted, not assumed):**
the previous generic vendor-training cites (GKN/Dorman, Moog, Dana/Spicer, AAM/Timken, Timken/SKF) named
no specific accessible document and implied a fetch that did not occur — their claims are now carried by
the named Halderman textbook and the two fetched web sources above. **SAE J1930 was also removed** as an
authority for mechanical driveline nomenclature — J1930 standardizes electrical/electronic diagnostic
terms, not mechanical component names, so it was the wrong authority for the §2 torque-path claim.

Linguistic (never cited for diagnosis): Tekmetric corpus
`real-concerns-tekmetric-labeled-v2.json` (tkc-086, tkc-113, tkc-120, tkc-269, tkc-275, tka-034,
tkc-072 declined-service line, rear-diff-leak & rear-diff-service work-order lines) + `eval-cases.json`
(awd_4x4_testing-001…004); NHTSA ODI narrative patterns (powertrain/driveline component) paraphrased to
first person; 2carpros / cartalk community phrasing **patterns** (paraphrased, `forum-paraphrase`,
never verbatim — copyright).

---

## 11. Binding-readiness self-check (Gate-G2)

| Check | Status |
|---|---|
| Every §3 failure mode cites Tier 2 (Halderman textbook + 2 fetched web sources w/ URL+access date); no unciteable/Tier-1-misattributed claims | PASS (revised — J1930 + generic vendor cites removed) |
| Sensory signatures written in fact-slot vocabulary | PASS |
| Lexicon phrasings in customer voice, synthetic ≤30% **per subcategory** & flagged | PASS — per-subcat: `popping_or_clicking_when_turning` 2/7 ≈ 29%; `humming_or_whirring_at_speed` 1/6; leak 1/5; overall ~22% |
| Every negative_example names `routes_to` (non-null) | PASS — AWD-bind negative now routes to `driveline_engagement_clunk_or_bind` with `target_status: proposed`, no null |
| Synonyms ≥2 tokens or domain single-token; no unattested mechanic-voice terms | PASS — removed "pinion seal leak" (no corpus attestation); kept "axle seal leak" (corpus) |
| Literalness: fact cues literally stated | PASS — removed `customer_request_type: second_opinion` over-assertion from the "another shop said" case (not literally requested) |
| Confusable pairs owned (CV-vs-turning-noise, bearing-vs-tire, hub-bearing-ABS-light-vs-AWD-fault) + discriminators | PASS |
| Missing modes added (broken axle → tow; LSD chatter; hub-bearing ABS light; situational override) | PASS (§3.10, §3.11, §3.8/§6, §5) |
| NO-FIT modes → subcategory/keyword proposals + reachability caveat + Chris-gated `catalog.category_mapping.add` | PASS |
| Slot proposals meet ≥3-question rule or flagged conditional; Q82↔onset_timing conflict resolved | PASS — `driveline_behavior` fully gated on the new subcategory (0 current questions; Q82 removed from its unlock list) |
| ≥8 golden cases incl. ≥1 inference-trap + ≥1 null-route; proposed-slug cases gated | PASS (12 cases; case 8 + situational case carry current/proposed gating) |
| Catalog change → only the Chris-gated `catalog.category_mapping.add` (noise→awd_4x4_testing); no new service | PASS |
