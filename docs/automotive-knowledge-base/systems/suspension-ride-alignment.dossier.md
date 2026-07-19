# Suspension, ride control & alignment — diagnostic dossier
slug: suspension-ride-alignment   date: 2026-07-18
binds_services: [suspension_steering_check]
binds_categories: [noise, vibration, pulling, steering]
# NOTE: `suspension_steering_check.concern_categories` = [noise, steering, pulling, vibration] in the live DB —
# it CANNOT reach the `tires` pool (incl. `uneven_tire_wear_bald_spots`). Uneven-wear-as-evidence is therefore
# a taxonomy gap, tracked as the concern_categories-extension proposal in §8 / `.proposals.yaml`, NOT a live binding.

> Scope note: this dossier owns the **chassis/ride** half of `suspension_steering_check` — springs,
> dampers (shocks/struts), locating linkage (control arms, ball joints, tie rods, sway bar + end links,
> bushings), wheel bearings **as a confusable neighbor only**, and **wheel alignment** (camber/caster/toe
> + road-crown physics). The **steering-effort/assist** half of the same service (EPS, rack, pump, hard/
> heavy/loose steering *feel*) is a sibling dossier (`power-steering-eps`). Brake-only vibration and
> tire-condition damage are neighbor dossiers (see §1, §7).

---

## 1. Scope & boundaries

**In scope (components/functions):**
- **Ride control / damping:** shocks, MacPherson struts, strut mounts/bearings, coil & leaf springs, air
  springs (electronic suspension), jounce bumpers. Function: damp and control body motion over road inputs.
- **Locating linkage / "front end":** upper & lower control arms + bushings, ball joints, inner/outer tie
  rod ends, stabilizer (sway) bar + bushings + **end links**, strut rods, subframe bushings. Function:
  hold the wheels at their designed angles and let them move only in the intended arc.
- **Wheel alignment:** camber, caster, toe — the geometry that decides whether a car tracks straight and
  wears its tires evenly.
- **Symptom families:** clunk/creak/squeak over bumps; harsh/bouncy/floaty ride; body roll, nose-dive,
  rear-squat; steady pull, road-crown drift, two-way wander; uneven/cupped tire wear as *evidence* of the
  above.

**Out of scope (neighbor dossier that owns it):**
- Steering **effort/assist** & the PS warning light — *power-steering-eps* (`power_steering_eps_testing`).
- **Brake-induced** vibration/pulsation (felt in the pedal, `onset_timing=when_braking`) — *brakes* dossier
  (`brake_inspection`, subcategory `vibration_or_pulsing_when_braking`).
- **Tire physical damage / age / buying** (nail, bulge, dry-rot, "just want new tires") — *tires* dossier
  (`tire_repair`, subcategories `visible_damage_nail_screw_bulge_cut`, `dry_rot_sidewall_cracking`,
  `just_want_new_tires`). Uneven **tread-wear pattern** is shared: this dossier owns it when the wear is
  the downstream *evidence*; the tires dossier owns `uneven_tire_wear_bald_spots` when the wear pattern is
  the customer's framing.
- **Wheel bearing / CV / driveline / diff** noise (hum at speed, click-when-turning, clunk-on-shift) —
  a **catalog gap** today (partly `awd_4x4_testing`; mostly no home). Called out as the key confusable
  neighbor in §7 and as a catalog proposal in §8.
- **TPMS / tire-pressure light** — *warning-lights / tires* (`tpms_testing`).

---

## 2. System primer (expert, cited)

A car's suspension does two jobs at once: it **isolates** the body from road inputs (springs + dampers)
and it **locates** each wheel so the tire contact patch stays where the engineer intended (control arms,
ball joints, tie rods, sway bar). When ride-control parts wear, the car stops *controlling* body motion —
it floats, bounces, dives and rolls. When locating parts wear, the wheels gain unwanted freedom of motion —
producing clunks over bumps, wander, and uneven tire wear
[Monroe, Signs of Bad Shocks & Struts, Tier 2, accessed 2026-07-18 — https://www.monroe.com/technical-resources/shocks-101/symptoms-worn-shock-struts.html]
[Moog, Symptoms of Bad Ball Joints, Tier 2, accessed 2026-07-18 — https://www.moogparts.com/parts-matter/symptoms-of-bad-ball-joints.html].

**Common architectures & variants (US market mix):**
- **MacPherson strut** (most FWD cars/crossovers): the strut is a structural member combining the damper,
  the coil spring, and the upper steering pivot. Its **upper strut mount/bearing** can bind or clunk, and
  its **strut post** is where leaking damper fluid shows. Because the strut *is* a steering pivot, worn
  strut mounts can also produce turn-related noise
  [KYB, Diagnose Your Shocks, Tier 2, accessed 2026-07-18 — https://www.kyb.com/resources/shocks-struts-101/for-diyers/diagnose-your-shocks/].
- **Double-wishbone / short-long-arm (SLA)** (trucks, RWD, performance): separate upper & lower control
  arms with discrete ball joints; more individual joints/bushings to wear.
- **Solid-axle / leaf-spring** (trucks, older SUVs): track bar ("panhard"), U-bolts, shackle bushings; a
  worn track bar produces the classic pickup-truck "death wobble" over bumps at speed.
- **Electronic / air suspension** (luxury, some SUVs/trucks): air springs + a compressor + ride-height
  sensors; failures throw a **"suspension service" dash message** and cause audible compressor cycling —
  a symptom family the current catalog has no clean home for (§8).

**Damper wear is a gradual wear-out, not a sudden failure.** As the valving loses control the ride
degrades slowly, so customers describe it as "rougher / bouncier / floatier than it *used to be*"
[Monroe, Signs of Bad Shocks & Struts, Tier 2, accessed 2026-07-18]; [KYB, Diagnose Your Shocks, Tier 2,
accessed 2026-07-18]. That comparative phrasing is a ride-control cue, but it is **NOT** by itself a
literal `started_when=gradually` statement — the extractor reserves `gradually` for "got worse little by
little," and a "rougher than it used to be" baseline could equally describe a sudden change last month.
Do not bind that phrasing to `started_when`.

**Alignment.** Three angles decide tracking and wear
[Les Schwab, Understanding Camber, Caster & Toe, Tier 3, accessed 2026-07-18 — https://www.lesschwab.com/article/alignment/understanding-camber-caster-and-toe.html]
[Tire Rack, Alignment Settings, Tier 3, accessed 2026-07-18 — https://www.tirerack.com/upgrade-garage/what-are-the-different-alignment-settings]:
- **Camber** (top-of-tire tilt): unequal side-to-side camber pulls toward the **more-positive** side; too
  much negative/positive wears one tread edge.
- **Caster** (steering-axis tilt, side view): unequal caster pulls toward the **less-positive** side;
  caster mostly affects straight-line stability, not tire wear.
- **Toe** (direction the tires point from above): the biggest tire-wear angle; wrong toe feathers/scrubs
  tread and can make the car dart/wander.
- **Road crown is physics, not a fault.** US roads are built with a **1–2% drainage slope**; that slope,
  together with the **tire ply-steer lateral force** the TSB describes, produces a mild road-dependent pull
  (typically toward the shoulder) on a correctly aligned car. This crown/ply-steer drift **cannot be aligned
  out** and is the reason the flat-parking-lot test is the single best pull discriminator
  [NHTSA-hosted OEM TSB, "Vehicle Pull, Steering Wheel Off Center, and Alignment," Tier 1, accessed
  2026-07-18 — https://static.nhtsa.gov/odi/tsbs/2020/MC-10177781-9999.pdf]. (The TSB attributes the crown
  compensation to ply-steer, not to a factory alignment bias; no fixed degree figure is claimed here.)

---

## 3. Failure-mode catalog (the diagnostic spine)

Each mode gives the customer-observable **sensory signature in fact-slot vocabulary**, conditions,
drivability, the typical misattribution, and a cite. All map back to `suspension_steering_check`.

### 3a. Worn shocks / struts (dampers)
- **Signature:** `noise_descriptor=clunking` (metallic knock over bumps) is possible but the *defining*
  cue is ride quality: the body keeps bouncing after a single bump, `onset_timing=over_bumps`, and the
  customer says the ride is **rougher/bouncier/floatier than it used to be** (a comparative baseline — a
  ride-control cue, but it does **NOT** literally set `started_when=gradually`; see §2).
  Secondary tells: **nose-dive under braking**, **rear-squat under acceleration**, **body roll/sway in
  corners**, **fluid streaks down the strut post**, and **cupped/scalloped tire wear**
  (`tire_state=uneven_wear`) [Monroe, Tier 2, accessed 2026-07-18].
- **Conditions/modifiers:** any speed; worse on rough pavement and at highway speed after bumps; worse
  fully loaded. **None of these damping tells (continued-bounce, nose-dive, rear-squat, body-roll) has a
  fact slot today** → the core §9 slot proposal (`ride_damping_symptom`).
- **Drivability:** `drivable_but_concerned` (degraded control, longer stopping, poor bump absorption); rarely
  a tow.
- **Misattribution:** customers blame "bad tires" or "the road"; some name "**struts**" as a catch-all for
  any front-end complaint (part-name misuse — do NOT extract a part).
- Cite: [Monroe, Signs of Bad Shocks & Struts, Tier 2, accessed 2026-07-18]; [KYB, Diagnose Your Shocks,
  Tier 2, accessed 2026-07-18].

### 3b. Worn sway-bar end links / stabilizer-bar bushings
- **Signature:** a **metallic `noise_descriptor=clunking`/knocking** "when going over bumps or traveling at
  higher speeds" (`onset_timing=over_bumps`; also at speed), **excessive body roll** (the bar is less able to
  resist lean), an **unstable feeling especially when turning or changing lanes**, `steering_feel=loose_or_
  sloppy` ("looseness while turning"), and **uneven tire wear** [Moog, Symptoms of Bad Sway Bar Links, Tier 2,
  accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned`; noise-dominant, low safety risk on its own.
- **Misattribution:** "something's loose underneath"; often blamed on the exhaust/heat-shield rattle.
- Cite: [Moog, Symptoms of Bad Sway Bar Links, Tier 2, accessed 2026-07-18 —
  https://www.moogparts.com/parts-matter/Symptoms-of-Bad-Sway-Bar-Links.html]; corroborated by
  [Moog, Symptoms of Bad Ball Joints, Tier 2, accessed 2026-07-18] on the general "metallic clunk-over-bumps
  from a corner" family.

### 3c. Worn ball joints
- **Signature:** "faint, intermittent **clunking** from a corner, **more pronounced over a bump or dip or
  when going around a corner**" (`noise_descriptor=clunking`, `onset_timing=over_bumps`/`when_turning`);
  steering feels **sloppy or stiff**; **vibration felt in the steering wheel on a level straight road**; the
  car may **drift left/right when going over bumps**; **inner or outer front-tire-edge wear**
  (`tire_state=uneven_wear`) [Moog, Symptoms of Bad Ball Joints, Tier 2, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned` → `not_drivable_needs_tow` if severely worn (a separated ball
  joint drops the wheel — a genuine safety item). Elevate `drivable_state` only if the customer literally
  says it feels unsafe.
- **Misattribution:** blamed on tie rods, wheel bearing, or "alignment."
- Cite: [Moog, Symptoms of Bad Ball Joints, Tier 2, accessed 2026-07-18].

### 3d. Worn tie-rod ends (inner/outer)
- **Signature:** **loose/wandering steering** (`steering_feel=loose_or_sloppy`, `pull_direction=
  varies_or_wanders`), a **front-end clunk especially when turning** (`onset_timing=when_turning`),
  steering-wheel vibration, **uneven/feathered tire wear**, and a steering wheel that can sit **off-center**
  (`steering_feel=wheel_off_center_while_straight`).
- **Drivability:** `drivable_but_concerned`; a failed outer tie rod is a loss-of-steering safety item.
- **Misattribution:** blamed on alignment or ball joints; symptoms overlap heavily — a screening cue, not a
  final diagnosis.
- Cite: [Moog, Symptoms of Bad Tie Rods, Tier 2, accessed 2026-07-18 —
  https://www.moogparts.com/parts-matter/symptoms-of-bad-tie-rods.html] (steering wheel shakes/vibrates
  worse as you accelerate or turn; looseness/excessive play; uneven one-side tire wear; front-end
  misalignment; knocking/clunking from the front when turning at low speeds; steering wanders).

### 3e. Worn control-arm / subframe bushings
- **Signature:** a **"clunk" as the arm moves in its bracket** (`noise_descriptor=clunking`,
  `onset_timing=over_bumps`, sometimes `when_braking`/`when_accelerating` as the arm loads/unloads); can
  add wander and toe-change-under-load. Dry/perished bushings give a **rubbery squeak/creak**
  (`noise_descriptor=creaking_or_squeaking`), worse **cold/wet** (`weather_condition=cold_weather`/
  `rainy_or_wet`).
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** blamed on ball joints, sway bar, or "the whole front end."
- Cite: [Moog, Symptoms of Bad Ball Joints (bushing "clunk in the bracket"), Tier 2, accessed 2026-07-18];
  [Suspension.com, Failing Control Arm, Tier 3, accessed 2026-07-18 — https://www.suspension.com/blog/symptoms-of-a-failing-control-arm/].

### 3f. Dry/perished bushings & ball joints — squeak/creak family
- **Signature:** `noise_descriptor=creaking_or_squeaking`, `onset_timing=over_bumps`, **worse on cold
  mornings / after sitting in wet weather / under load** (`weather_condition`, load). Sounds like "an old
  porch step / dry rubber twisting," NOT a metallic impact. Reproducible by **bouncing the bumper** by hand.
- **Drivability:** `drivable_normally`/`drivable_but_concerned`; noise-dominant.
- **Misattribution:** confused with brake squeal (but brake squeal is `when_braking`, from the wheel) and
  with a turn-only steering creak (which is `noise_when_turning_the_steering_wheel`).
- Cite: [Moog, Bad Ball Joints (greaseless joint creak), Tier 2, accessed 2026-07-18].

### 3g. Alignment out of spec — steady one-side pull
- **Signature:** `pull_direction=left|right` that is **the same direction on every road including a flat
  empty parking lot** (persists when briefly releasing the wheel); `steering_feel=wheel_off_center_while_
  straight`; often follows a curb/pothole strike (`recent_action=hit_pothole_or_curb`) or new-tire/service
  work. Camber-unequal pulls to the more-positive side; caster-unequal pulls to the less-positive side
  [NHTSA-hosted OEM TSB, Tier 1, accessed 2026-07-18]; [Les Schwab, Tier 3, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned`; constant correction is fatiguing.
- **Misattribution:** blamed on tires (and often IS a tire — see 3i); blamed on "the road" (that's 3h).
- Cite: [NHTSA-hosted OEM TSB, Vehicle Pull & Alignment, Tier 1, accessed 2026-07-18].

### 3h. Road-crown drift (largely normal physics)
- **Signature:** `pull_direction=right` (usually) that is **road-dependent** — present on a crowned road,
  **gone on a flat parking lot**, and it **reverses** when the road tilts the other way (crossing a
  differently-crowned bridge/lane). This is the drainage-slope effect, not a fault
  [NHTSA-hosted OEM TSB, Tier 1, accessed 2026-07-18].
- **Drivability:** `drivable_normally`.
- **Misattribution:** customers demand an alignment for what is normal crown behavior; the discriminator is
  the flat-lot / reverse-on-tilt test (no fact slot today → §9 `pull_road_dependence` proposal).
- Cite: [NHTSA-hosted OEM TSB, Tier 1, accessed 2026-07-18].

### 3i. Tire-caused pull (conicity / uneven pressure)
- **Signature:** a steady one-side pull that **started right after new tires / a rotation**
  (`recent_action=tire_rotation_or_replacement`) or with one **low tire** (`tire_state=low_pressure`).
  Swapping the front tires side-to-side reverses a conicity pull. Belongs to the pulling family but its
  cause is the tire, not the chassis.
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** blamed on alignment; the "recent tire work" cue is the tell (routes to
  `pull_that_started_after_recent_tire_or_service_work`).
- Cite: [Tire Rack, Alignment Settings (tire conicity/pull), Tier 3, accessed 2026-07-18];
  [NHTSA-hosted OEM TSB, Tier 1, accessed 2026-07-18].

### 3j. Two-way wander / loose front end
- **Signature:** the car **wanders both ways** (`pull_direction=varies_or_wanders`), `steering_feel=
  loose_or_sloppy` with play before the wheels respond, worse at highway speed and over bumps. Caused by
  worn tie rods, ball joints, idler/pitman or a loose steering rack, or a loose wheel bearing — parts that
  let the wheels move independently of steering input.
- **Drivability:** `drivable_but_concerned` → `not_drivable_needs_tow` at "death-wobble" severity on solid
  axles.
- **Misattribution:** blamed on alignment (an alignment won't fix worn parts); confused with pure
  steering-feel looseness (`loose_or_sloppy_steering`) — pick the pulling subcategory when the **car's path**
  is the complaint, the steering subcategory when the **wheel's feel** is.
- Cite: [Moog, Bad Ball Joints (sloppy steering + wander), Tier 2, accessed 2026-07-18];
  [Moog, Symptoms of Bad Tie Rods (loose/wandering steering), Tier 2, accessed 2026-07-18].

### 3k. Broken / collapsed / sagging coil or leaf spring
- **Signature:** the defining customer-observable is **one corner sitting visibly lower than the rest**
  (`location_side` + `location_axle` when the customer localizes it) after a spring cracks or collapses,
  often with a **`noise_descriptor=clunking`/bang over bumps or deep potholes** as the broken coil shifts,
  and a **harsher ride**. A collapsed spring also **throws the alignment angles off**, so it can present
  downstream as a pull or uneven wear. This is a **conventional-spring** failure — NOT the air-ride
  "service suspension" dash message of §6/§8 (a sitting-low corner on a non-air-suspension car is classically
  a broken/collapsed spring, not an air-suspension light).
- **Conditions/modifiers:** appears suddenly after a pothole/curb strike or road-salt corrosion fatigue;
  the low corner is constant (not speed- or bump-dependent), the clunk is `over_bumps`.
- **Drivability:** `drivable_but_concerned` (rougher ride, degraded emergency control); escalate to
  `not_drivable_needs_tow` only if the body is resting on the tire (unsafe) and the customer says so.
- **Misattribution:** customers say "my car is leaning," "sitting low on one side," or blame a "flat tire"
  or "bad shocks"; some guess "air suspension" even on a coil-sprung car.
- Cite: [Moog, "Can you drive a car with broken suspension?", Tier 2, accessed 2026-07-18 —
  https://www.moogparts.com/en-eu/support/the-problem-solver/technical-support/educational-articles/drive-car-with-broken-suspension.html]
  ("one corner … lower than the others … a good chance you have a worn or damaged spring … a clunking noise
  as you drive over bumps or a deep pothole … sagging and noise and affect alignment angles").

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Real-voice phrasings per failure mode. Source order: Tekmetric corpus first, then forum-paraphrase, then
flagged synthetic (kept < 30%/subcategory). Full machine form in `suspension-ride-alignment.lexicon.yaml`.

- **clunk/knock over bumps (noise) → `clunking_over_bumps`:**
  "Vehicle has clunking in front end when driving … client thinks failing tie rod ends" *(tekmetric)*;
  "suspension noise mainly over bumps" *(tekmetric)*; "Loud noises coming from front wheel well"
  *(tekmetric)*; "Front pop/clunk coming from passenger side/front right wheel area … assumed it was
  sway bar links or bushings" *(forum-paraphrase)*; "DRAGGING NOISE OCCURRING IN THE FRONT END"
  *(tekmetric, scraping variant)*.
- **squeak/creak over bumps (noise) → `squeaking_or_creaking_over_bumps`:**
  "chassis squeaking. lube?" *(tekmetric)*; "CHECK SQUEAKING IN REAR OVER BUMPS. CAN HEAR IF PUSHING DOWN
  ON BUMPER" *(tekmetric)*; "SQUEAKING NOISE GOING OVER BUMPS … hears it on uneven roads" *(tekmetric)*;
  "CHECK CREAKING NOISE OVER BUMPS. POSSIBLE HEATSHIELD?" *(tekmetric, has a cross-system trap)*.
- **harsh/bouncy ride (vibration) → `shaking_or_bouncing_over_bumps_and_rough_roads`:**
  "WHEN HITTING A BUMP AT HIGHWAY SPEEDS, CLIENT GETS A VIOLENT SHAKE. THINKS IT MAY BE THE TRACK BAR"
  *(tekmetric)*; "the ride was more bouncy and floaty than before … I feel every bump and road crack"
  *(forum-paraphrase)*; "car feels really jittery and bouncy on rough roads" *(synthetic)*.
- **bump-hit felt in the wheel (steering) → `clunking_knocking_or_rough_ride_over_bumps`:**
  "front end feels really rough — every bump comes right up through the wheel" *(synthetic)*; "wheel kicks
  back hard when I roll over a pothole" *(synthetic)*.
- **steady one-side pull (pulling) → `steady_drift_while_cruising`:**
  "RE CHECK ALIGNMENT (If you hold steering wheel straight car will go to the right)" *(tekmetric)*;
  "car constantly pulls to the right on the highway, even in a flat parking lot" *(synthetic)*.
- **road-crown drift (pulling) → `drift_that_follows_the_roads_slope`:**
  "drifts right on the highway but goes straight in an empty parking lot" *(synthetic)*; "only pulls on
  certain roads, drives fine on others" *(synthetic)*.
- **two-way wander (pulling) → `wandering_or_drifting_in_both_directions`:**
  "it began to wander badly, especially at highway speeds … I am uncomfortable driving it"
  *(forum-paraphrase)*; "PLAY IN STEERING WHEEL AND CLUNKING IN SUSPENSION" *(tekmetric, cross-cue)*.
- **uneven tire wear as framing (tires) → `uneven_tire_wear_bald_spots`:**
  "uneven wear on inside edge of front tires, alignment okay if needed" *(tekmetric)*; "WHEEL ALIGNMENT
  CHECK (rear tires were worn on edges)" *(tekmetric)*; "Alignment (Tires have been having uneven wear)"
  *(tekmetric)*. **Routing caveat:** these are *tires*-pool phrasings; `suspension_steering_check` cannot
  reach that pool today (§8 caveat + concern_categories-extension proposal).
- **car sitting low on one corner / broken spring (Stage-1 only) → `suspension_steering_check`:**
  "LEFT FRONT WHEEL SITTING LOWER THAN REST SUSPENSION INSPECTION AUTH 89" *(tekmetric — consensus-labeled
  `suspension_steering_check`, subcategory null)*. There is **no clean Stage-2 subcategory** for a collapsed
  spring in the reachable pools (noise/steering/pulling/vibration), so this lands at Stage-1 with a null
  Stage-2 (§8 spring row) — a subcategory gap, not an air-suspension warning-light complaint.

Messiness observed & preserved: misspellings are light in this corpus but part-name misuse is heavy
("**struts**"/"**track bar**"/"**tie rod ends**" guessed by customers), mixed symptom+request
("clunking … testing auth 89 to start"), all-caps Tekmetric fragments, and shop-internal work-order lines
that are **not** customer concerns (§8 null-route).

---

## 5. Differential & discriminating questions (binds required_facts + slots)

For each confusable pair, the ONE best discriminating question, the fact slot + value that answers it, and
whether a slot exists.

| Confusable pair | Best discriminating question | Slot + value | Slot exists? |
|---|---|---|---|
| suspension bounce/rough-ride ↔ **brake** vibration | "Does it happen going over bumps, or only when you press the brake pedal?" | `onset_timing` = `over_bumps` (suspension) vs `when_braking` (brakes) | ✅ yes |
| suspension clunk-over-bumps ↔ **driveline** clunk | "Does the clunk happen over bumps, or when you shift into gear / take off / let off the gas?" | `onset_timing` = `over_bumps` (suspension) vs `when_accelerating`/`at_stop` (driveline) | ✅ yes (slot); ❌ no driveline **subcategory** (§8) |
| noise clunk-over-bumps ↔ steering **felt-in-the-wheel** | "Do you HEAR it from underneath, or FEEL the hit come up through the steering wheel?" | perception modality (heard vs felt) | ❌ **no slot** — see note below |
| worn-damper bounce ↔ tire/wheel **balance** shake | "Does it bounce after bumps, or shake steadily at a set highway speed on smooth road?" | `onset_timing`=`over_bumps` + damping tell vs `speed_band=highway`/`specific_mph` steady shake | ⚠ partial — needs `ride_damping_symptom` (§9) |
| steady pull ↔ **road-crown** drift | "On a flat empty parking lot with no slope, does it still pull or go straight?" | pull persists on flat vs road-dependent | ❌ **no slot** — `pull_road_dependence` (§9) |
| steady pull ↔ **tire-caused** pull | "Did the pull start right after new tires or a rotation?" | `recent_action` = `tire_rotation_or_replacement` | ✅ yes |
| two-way wander ↔ steering-**feel** looseness | "Is your complaint the CAR wandering in its lane, or the WHEEL feeling loose/sloppy?" | `pull_direction=varies_or_wanders` (path) vs `steering_feel=loose_or_sloppy` (feel) | ✅ yes (both) |
| metallic clunk ↔ rubbery creak (within suspension) | "Is it a hard metallic knock, or a dry rubbery squeak/creak?" | `noise_descriptor` = `clunking` vs `creaking_or_squeaking` | ✅ yes |

**Perception-modality note (heard-vs-felt):** the noise `clunking_over_bumps` and the steering
`clunking_knocking_or_rough_ride_over_bumps` are the SAME components framed as a NOISE vs an IMPACT FELT IN
THE WHEEL. This distinction has **no fact slot** and would unlock only these two subcategories' routing — it
**fails the ≥3-question rule**, so it is handled at Stage-2 (sharpened descriptions/negatives), NOT proposed
as a new slot. Documented so Wave B doesn't re-derive it.

---

## 6. Warning lights & DTC surface

Mechanical suspension has **no dedicated dash light** — a bad ball joint or worn strut illuminates nothing.
Two adjacent light surfaces exist and must NOT be pulled into this system by keyword:
- **ABS / traction / stability** can trip after a **pothole/curb strike** (a wheel-speed or steering-angle
  sensor knocked out of range). Corpus: "yellow ABS light came on right after I hit a big pothole … brakes
  still feel normal." That is `abs_anti_lock_brake_light` / `abs_traction_stability_testing`, **not**
  suspension — the pothole cue (`recent_action=hit_pothole_or_curb`) tempts a suspension route it must not
  take. Feeds `warning_light_named=abs` + `warning_light_behavior=steady_on`.
- **Electronic/air-suspension "SERVICE SUSPENSION" message** (air-ride vehicles): corpus has **2 strong
  air-ride lines** ("SUSPENSION FAULT/SERVICE messages … air compressor coming on and airing up at random,"
  "POPPING NOISE … from the air suspension"). Customer nicknames: "suspension light," "air ride light,"
  "service suspension message." **No catalog home today** → §8 subcategory + service note; reached via
  `warning_light_general` until a dedicated service exists. Would feed `warning_light_named=suspension` /
  `air suspension`. **Do NOT fold the "sitting low on one corner" line into this bucket** — on a conventional
  coil/leaf car that is a broken spring (§3k), a mechanical `suspension_steering_check` concern with no dash
  light, not an air-ride message.

No standard SAE/J2012 P-code lands in mechanical suspension; air-suspension DTCs are chassis "C" codes,
manufacturer-specific — out of scope for keyword mining (customers quote the dash *message*, not a code).

---

## 7. Confusable neighbors (cross-system)

- **Brakes (`brake_inspection` / `vibration_or_pulsing_when_braking`).** Discriminator: `onset_timing`.
  Brake vibration is felt in the **pedal** while **braking**; suspension shake/bounce is triggered by
  **bumps** and happens whether or not you brake. This is confusable pair #8 in the taxonomy. (See §5 row 1.)
- **Driveline / CV / wheel bearing / diff / mounts.** The big neighbor with **no clean catalog home**.
  Discriminators: a **hum/whir that rises with road speed** (`noise_descriptor=humming_or_whirring`,
  `speed_band` scaling) = wheel bearing; a **click/pop only when turning** (`popping_or_clicking`,
  `when_turning`) = CV joint; a **clunk on shift-into-gear / on-off throttle** (`onset_timing=
  when_accelerating`/`at_stop`, NOT `over_bumps`) = U-joint / diff / motor-or-trans mount. Corpus proof of
  demand: "Clunking noise when putting car into drive from park/turning left"; "roar and clicking/tapping";
  "sounds like a wheel bearing"; "Diff carrier bushing torn." Cross-reference the future `driveline` /
  `wheel-bearings` dossiers; today several of these mis-route into `suspension_steering_check` (the corpus
  shows the labelers themselves splitting `clunking_over_bumps` vs `humming_or_whirring_at_speed`).
- **Tires (`tire_repair`, `dry_rot_sidewall_cracking`, `just_want_new_tires`, `uneven_tire_wear_bald_
  spots`).** Uneven wear is shared evidence; **worn-tire replacement has no catalog fit** (taxonomy §5 #9).
  Discriminator: does the customer lead with a **symptom** (shake/pull → suspension) or with the **tire's
  condition/a buying request** (→ tires)?
- **Steering-effort/EPS (`power_steering_eps_testing`, `hard_to_turn_heavy_steering`,
  `noise_when_turning_the_steering_wheel`).** A creak/whine **only when turning the wheel** (not over bumps)
  is steering, not suspension. Discriminator: `onset_timing=when_turning` vs `over_bumps`.
- **Recent-impact situational override (`after_a_recent_accident_or_impact`).** When the customer ties the
  symptom to a fresh curb/pothole/collision and asks "make sure nothing is bent," the **situational bucket
  wins** over the symptom keyword (taxonomy §3b PRIORITY-ORDER rule) — a Stage-1 hedge, not a suspension pick.

Owned confusable-matrix rows (for Wave B `binding/confusable-matrix.yaml`): suspension↔brake vibration;
suspension clunk↔driveline clunk; steady-pull↔crown-drift; suspension shake↔wheel-balance shake.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode (§3) | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| Worn shocks/struts — bounce/rough ride (body) | `suspension_steering_check` | vibration | `shaking_or_bouncing_over_bumps_and_rough_roads` | **good** |
| Worn shocks/struts — harsh hit felt in wheel | `suspension_steering_check` | steering | `clunking_knocking_or_rough_ride_over_bumps` | **good** |
| Sway-bar links / control-arm bushings — metallic clunk | `suspension_steering_check` | noise | `clunking_over_bumps` | **good** |
| Ball joints — clunk from a corner over bumps/turns | `suspension_steering_check` | noise | `clunking_over_bumps` | good (turn overlap) |
| Dry bushings/joints — squeak/creak | `suspension_steering_check` | noise | `squeaking_or_creaking_over_bumps` | **good** |
| Alignment — steady one-side pull | `suspension_steering_check` | pulling | `steady_drift_while_cruising` | **good** |
| Road-crown drift (normal) | `suspension_steering_check` | pulling | `drift_that_follows_the_roads_slope` | good (needs slot §9) |
| Tire-caused pull (new tires/rotation) | `suspension_steering_check` | pulling | `pull_that_started_after_recent_tire_or_service_work` | good |
| Two-way wander / loose front end | `suspension_steering_check` | pulling | `wandering_or_drifting_in_both_directions` | **good** |
| Worn strut/shock or alignment — uneven/cupped wear as framing | `suspension_steering_check` | tires | `uneven_tire_wear_bald_spots` | **NO FIT (unreachable)** → propose (see NO-FIT #3) |
| **Broken / collapsed spring — one corner sitting low** | `suspension_steering_check` | *(none in reachable pool)* | *(NO Stage-2 fit — null)* | Stage-1 only; subcategory gap |
| **Driveline clunk on shift/throttle (U-joint, diff, mount)** | *(none — partly `awd_4x4_testing`)* | noise | *(NO FIT)* | **NO FIT** → propose |
| **Wheel-bearing hum / CV click at speed** | *(none)* | noise | `humming_or_whirring_at_speed` (borrowed) | weak — no dedicated service |
| **Air / electronic suspension "service suspension" message** | *(none)* | warning_light | *(NO FIT)* | **NO FIT** → propose |

**NO-FIT #1 — Driveline clunk (demand-backed).** Corpus lines: "Clunking noise when putting car into drive
from park/turning left"; forum "transmission made a loud CLUNK … as I accelerated"; "roar and
clicking/tapping." → `stage2.subcategory.propose` noise/`driveline_clunk_on_shift_or_acceleration` **and**
`catalog.service.propose` a driveline/CV/differential/U-joint/mount diagnosis service (Chris-gated). This is
the highest-value gap: without it, throttle/shift clunks contaminate `clunking_over_bumps`.

**NO-FIT #2 — Electronic/air-suspension service message.** Air-ride dash message on air-suspension vehicles,
corroborated by 2 strong air-ride corpus lines ("SUSPENSION FAULT/SERVICE messages … air compressor coming
on and airing up at random"; "POPPING NOISE … from the air suspension"). Low-but-real volume →
`stage2.subcategory.propose` warning_light/`suspension_service_message`. **Because
`suspension_steering_check` carries no `warning_light` category, this new subcategory is reached today only
via `warning_light_general` ($179.95, "any dash light the customer can't name") — the proposal names that
service explicitly** (a dedicated air-suspension diagnosis service is a separate Chris-gated catalog idea).
Note: a **sitting-low corner on a conventional (coil/leaf) car is a broken spring (§3k), routed to
`suspension_steering_check`, NOT this air-ride message** — do not conflate the two.

**NO-FIT #3 — Uneven-wear-as-evidence is unreachable from suspension today.** `uneven_tire_wear_bald_spots`
lives in the `tires` pool, and `suspension_steering_check.concern_categories` = `[noise, steering, pulling,
vibration]` in the live DB — so a customer who leads with "tires wearing on the inside edge, check the
alignment" **cannot** reach that subcategory through the alignment service. Two honest resolutions, both in
`.proposals.yaml`: (a) **`catalog.service.concern_categories.extend`** — add `tires` to
`suspension_steering_check` so the alignment service can own uneven-wear-as-evidence (Chris-gated, the
recommended fix); until then, (b) the utterance routes through **`tire_repair`** (which *does* reach the
`tires` pool) with `suspension_steering_check` as an acceptable co-candidate. Golden case 8 is anchored to
(b) so it passes against the current taxonomy, and flags (a) as the target state.

**Spring gap (§3k).** A broken/collapsed spring is a real `suspension_steering_check` Stage-1 concern
(corpus: "LEFT FRONT WHEEL SITTING LOWER THAN REST", consensus `suspension_steering_check`, subcategory
null) with **no clean Stage-2 subcategory** in the reachable pools. Left as a documented subcategory gap
rather than a speculative proposal — the volume is one confirmed line, below the bar for a new subcategory.

---

## 9. Fact-slot audit

**Slots this system already uses well:** `noise_descriptor` (clunking, creaking_or_squeaking, rattling,
humming_or_whirring, scraping), `onset_timing` (over_bumps, when_turning, when_braking, when_accelerating),
`location_side`, `location_axle`, `pull_direction`, `steering_feel`, `tire_state` (uneven_wear),
`recent_action` (hit_pothole_or_curb, tire_rotation_or_replacement, alignment), `started_when` (only when
literally stated — `weeks_ago`/`days_ago`/`sudden_onset`; NOT set by "rougher than it used to be", which is
a comparative baseline, and `gradually` only for "got worse little by little"),
`speed_band`/`speed_specific_mph`, `weather_condition` (cold/wet for bushing creak), `drivable_state`.

**Values customers actually state that are covered:** "clunk," "creak/squeak," "bouncy/floaty," "pulls
right/left," "wanders," "loose front end," "over bumps," "at highway speed," "worse in the cold," "after I
hit a pothole," "since I got new tires," "inside-edge wear."

**Missing / proposed:**

1. **`ride_damping_symptom` (NEW slot).** No slot captures the worn-damper tells that customers *literally
   state*: continued bounce after a bump, nose-dive under braking, rear-squat under acceleration, excessive
   body roll, bottoming out. **Unlocks ≥3 questions** (passes the rule): #703, #704, #705
   (clunking_knocking), #169, #174 (shaking_or_bouncing), #81 (clunking_over_bumps). Values:
   `continued_bounce_after_bump | nose_dive_under_braking | rear_squat_under_accel | excessive_body_roll |
   bottoming_out`. Literal cues only (e.g., "keeps bouncing three times after a bump," "nose dives when I
   brake," "squats when I hit the gas," "leans hard in corners," "bottoms out over bumps"). Must NOT be set
   from a bare "rough ride."
2. **`pull_road_dependence` (NEW slot).** No slot captures the flat-lot / reverse-on-tilt test that separates
   crown drift from a real pull. **Unlocks ≥3 questions:** #1224, #1225, #1226, #1230
   (drift_that_follows_the_roads_slope), #196 (steady_drift_while_cruising). Values:
   `persists_on_flat_ground | only_on_certain_roads | reverses_with_road_tilt`. Literal cues: "still pulls
   in an empty flat parking lot," "only pulls on certain roads," "goes straight on flat ground," "the pull
   reverses when the road tilts the other way."
3. **Extend `recent_action`?** Not needed — `hit_pothole_or_curb`, `tire_rotation_or_replacement`,
   `alignment` already cover the suspension-relevant history cues.
4. **Rejected slot (discipline):** perception-modality "heard vs felt" (§5) — only 2 questions/subcategories,
   fails the ≥3 rule; handle at Stage-2.

**Workstream-Q contribution (the 349-empty triage, this system's questions):** SAFE tags that become live
only if the two proposed slots are accepted (#703/#704/#705/#169/#174/#81 → `ride_damping_symptom`;
#1224/#1225/#1226/#1230/#196 → `pull_road_dependence`; #130 → `[location_side, location_axle]`).
Confirmatory/severity/co-occurrence probes that must **always be asked** are marked
`intentionally_empty` (#78, #82, #702, #707, #708, #129, #133, #170, #172, #173, #220, #221, #1227, #1228)
with reasons — so "48% empty" stops mystifying anyone here. Full ops in `.proposals.yaml`.

---

## 10. Sources

Diagnostic (Tier 1/2 lead, Tier 3 corroboration only):
- Monroe, "Signs of Bad Shocks & Struts," Tier 2 — https://www.monroe.com/technical-resources/shocks-101/symptoms-worn-shock-struts.html (accessed 2026-07-18). §2, §3a.
- KYB, "Diagnose Your Shocks," Tier 2 — https://www.kyb.com/resources/shocks-struts-101/for-diyers/diagnose-your-shocks/ (accessed 2026-07-18). §2, §3a.
- Moog, "Symptoms of Bad Ball Joints," Tier 2 — https://www.moogparts.com/parts-matter/symptoms-of-bad-ball-joints.html (accessed 2026-07-18). §3c, §3e, §3f, §3j.
- Moog, "Symptoms of Bad Sway Bar Links," Tier 2 — https://www.moogparts.com/parts-matter/Symptoms-of-Bad-Sway-Bar-Links.html (accessed 2026-07-18). §3b.
- Moog, "Symptoms of Bad Tie Rods," Tier 2 — https://www.moogparts.com/parts-matter/symptoms-of-bad-tie-rods.html (accessed 2026-07-18). §3d, §3j.
- Moog, "Can you drive a car with broken suspension?", Tier 2 — https://www.moogparts.com/en-eu/support/the-problem-solver/technical-support/educational-articles/drive-car-with-broken-suspension.html (accessed 2026-07-18). §3k (broken/collapsed spring — corner sits low, clunk over bumps, affects alignment).
- NHTSA-hosted OEM TSB, "Vehicle Pull, Steering Wheel Off Center, and Alignment," Tier 1 — https://static.nhtsa.gov/odi/tsbs/2020/MC-10177781-9999.pdf (accessed 2026-07-18). §2, §3g, §3h, §3i. (Verifies: 1–2% drainage slope; camber pulls toward the more-positive/larger value; caster pulls toward the less-positive/smaller value; crown/ply-steer pull cannot be aligned out. Does NOT support a factory ¼° bias — claim removed.)
- Les Schwab, "Understanding Camber, Caster & Toe," Tier 3 (corroboration) — https://www.lesschwab.com/article/alignment/understanding-camber-caster-and-toe.html (accessed 2026-07-18). §2, §3g.
- Tire Rack, "Alignment Settings," Tier 3 (corroboration) — https://www.tirerack.com/upgrade-garage/what-are-the-different-alignment-settings (accessed 2026-07-18). §2, §3i.
- Suspension.com, "Symptoms of a Failing Control Arm," Tier 3 (corroboration, paired with Moog Tier-2) — https://www.suspension.com/blog/symptoms-of-a-failing-control-arm/ (accessed 2026-07-18). §3e.

Linguistic (never cited for diagnosis): Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json`
(suspension-labeled lines mined, incl. the "SITTING LOWER" broken-spring line #tka-123 and the full
"RE CHECK ALIGNMENT … JUST HAD ALIGNMENT PERFORMED LAST SERVICE" line #tkc-199) + `eval-cases.json`
(pothole/clunk cases) + `real-concerns-forums.json` (wander/bouncy/clunk paraphrases) + **NHTSA ODI
complaint narratives** (2 verbatim-sourced lines: ODI 11307206 steady pull+shake; ODI 11296920 clunk over a
speed bump while steering). Synthetic entries were removed from the lexicon (0% share). Provenance tagged per
lexicon entry.

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode carries ≥1 customer-voice phrasing (§4/lexicon) **and** ≥1 discriminating fact (§5).
- [x] Every diagnostic/differential claim cites Tier 1/2 (all suspension-part signatures now on Moog Tier-2
      manufacturer pages; no denylist-shaped sources; the unsupported damper mileage/cycle numbers and the
      factory-¼°-bias claim were removed, not re-cited). No uncited claims.
- [x] Every `negative_example` in `.proposals.yaml` names `routes_to` a real (or explicitly-proposed) slug.
- [x] Synonyms are ≥2 tokens or domain tokens (no bare "noise/clunk/pull/leak"); banned bare words excluded.
- [x] Customer artifacts in customer voice; synthetic **flagged and now 0%** in every subcategory (the four
      previously-synthetic-heavy subcats were re-mined from the Tekmetric corpus, forum-paraphrase, and 2
      genuine NHTSA ODI narratives — well under the ~30% cap).
- [x] Literalness respected: `ride_damping_symptom` / `pull_road_dependence` `literal_cues` are literal and
      internally consistent (the "goes straight on flat ground" cue maps to `only_on_certain_roads`, not the
      opposite); golden cases assert NO over-extraction — no `started_when` from "rougher than it used to be"
      (case 3), no `steering_feel` from holding the wheel straight (case 5), `reverses_with_road_tilt` from a
      literal reversal (case 6), `days_ago` not `today` from "yesterday" (case 9).
- [x] ≥8 golden cases incl. ≥1 inference-trap and ≥1 null-route (`.proposals.yaml` → `golden_cases`).
- [x] Two new-slot proposals each meet the ≥3-question rule; every `required_facts.set` names an existing or
      accepted-proposed slot; presence-only mapper semantics respected (no unsafe presence-skips).
- [x] Confusable-matrix rows enumerated for Wave B (§7).
