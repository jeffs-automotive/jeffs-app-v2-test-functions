# Noise, Vibration & Harshness (NVH) — cross-system router
slug: router-nvh   date: 2026-07-18
consumes: [brakes-friction-hydraulic, suspension-ride-alignment, driveline-cv-diff-awd,
  wheels-tires-tpms-bearings, steering-power-steering, engine-mechanical, exhaust-emissions, hvac-climate]
owns_confusable_pairs:
  - brake-vibration ↔ suspension/wheel-balance vibration        # taxonomy §5 #8
  - CV click-on-turn ↔ steering-column noise-on-turn ↔ wheel bearing
  - wheel-bearing hum ↔ tire hum/roar
  - valvetrain tick ↔ exhaust-manifold tick                     # taxonomy §5 #5 (tick facet)
  - diff whine ↔ wheel-bearing hum ↔ transmission whine
  - driveline take-off/torque-reversal clunk ↔ suspension bump clunk ↔ brake-apply clunk
  - engine rod-knock (load) ↔ suspension clunk (bumps)
  - exhaust rumble/roar (RPM) ↔ tire/bearing roar (road speed)
routing_signal_owned: vibration_felt_location   # handed here by binding/required-facts-map.q3.md §1

> **What this router is.** The scheduler taxonomy is symptom-organized, so a single physical noise or
> vibration is scattered across the `noise` (12), `vibration` (6), `brakes`, `steering`, and
> `warning_light` pools, reachable through several different Stage-1 testing services. No per-system
> dossier can adjudicate "is this hum a wheel bearing, a tire, or the differential?" — that is a
> *cross-system* decision. This router owns it: a **descriptor × condition → ranked candidates + the ONE
> discriminating fact** map. It is the authoritative disambiguation reference for everything a customer
> hears or feels.
>
> The machine-consumable form of §5 is [`binding/differential-table-nvh.md`](../binding/differential-table-nvh.md).
> Typed ops (hedges, routing negatives) and the confusable matrix rows are in `router-nvh.proposals.yaml`.

---

## 1. Scope & boundaries

**In scope — the "I hear a noise / I feel a shake" front door:**
- Every `noise_descriptor` value (squealing, grinding, knocking, ticking, clunking, rattling, hissing,
  humming/whirring, whining, popping/clicking, buzzing, creaking/squeaking, roaring, scraping) *when the
  customer leads with the sound*, and the routing fork it opens.
- Every `vibration` subcategory and the felt-location signal that splits them.
- The cross-system discriminator (the ONE fact) for each confusable pair listed in the header.

**Out of scope (owned elsewhere — this router only points):**
- The *within-system* diagnosis once routed — each Wave A dossier owns its own failure-mode catalog.
- Smell / smoke / fluid-color routing → `router-leaks`, `router-smoke-smells`.
- Warning-light nicknames & solid/flashing semantics → `router-warning-lights` (this router references
  light co-symptoms only where they split an NVH pair, e.g. hub-bearing ABS light).
- Non-symptom requests ("just want new tires", "state inspection", maintenance) → `router-requests-maintenance`.
- Electrical `buzzing` root-cause (relay/inverter) → `body-electrical-accessories` / `hybrid-ev`; this
  router only keeps `electrical_buzzing` from being swept into mechanical noise.

**Governing rule — LITERALNESS (methodology §5).** Every discriminating fact below fires only on what the
customer *literally states*. "Shakes when I brake" sets `onset_timing=when_braking`; it does NOT set a
`vibration_felt_location` the customer never named, and "grinding" sets no location. A descriptor the
customer did not use is never assumed. Where the deciding fact has **no slot today**, this router marks it
as a probe (ask it) and cross-references the owning slot proposal — it never fabricates a skip.

---

## 2. Router primer — the five physics that separate NVH sources

These are the levers every row in §5 pulls. All are customer-observable without tools.

1. **What triggers it (`onset_timing`).** `when_braking` = brakes; `over_bumps` = suspension; `when_turning`
   = CV/steering; `when_accelerating`/on-gear-engagement = engine-load or driveline; `cold_start` +
   fades-warm = exhaust manifold; `when_idling` = engine/mounts.
2. **What it scales with — road speed vs engine RPM (`speed_band` vs "rev in park").** A hum/roar/rumble
   that rises with **road speed** is a wheel bearing or tire; one that rises with **engine RPM even parked
   in neutral** is exhaust or a belt/accessory. This single split resolves the most NVH mis-routes in the
   corpus [Halderman *Automotive Technology*, NVH/road-test chapter, Tier 2, ref 2026-07-18].
3. **Load phase — on-gas vs coast (`onset_timing=when_accelerating` vs coast).** A whine/hum that *changes
   when you get on or off the throttle* is a differential (drive-side ring-and-pinion mesh on accel; pinion
   bearings on coast); one that just tracks speed regardless of throttle is a wheel bearing
   [West Coast Differentials, "Diagnosing Differential Problems", https://differentials.com/diagnosing-differential-problems/, Tier 2, ref 2026-07-18].
4. **Steering-load sensitivity.** A hum that gets **louder turning one way and quieter the other** is a
   wheel/hub bearing (cornering shifts weight onto the bad bearing); a constant roar that ignores steering
   is a tire [Timken *Symptoms of a Worn Wheel Hub Bearing*, Tier 2, ref 2026-07-18]. No fact slot today →
   wheels-tires dossier proposes `steering_load_effect`.
5. **Where it is felt (`vibration_felt_location`).** A shake felt only in the **steering wheel** points
   front/steering/balance; felt in the **seat** points rear/driveline; in the **brake pedal** points brake
   rotor pulsation; **whole-car at idle** points engine mounts / rough idle. Multi-location (wheel *and*
   seat) is itself the signal (§6). This slot is a **routing signal, not a skip key** (§6, q3 map §1).

---

## 3. Decision table A — NOISE descriptor × condition → ranked candidates + the ONE discriminating fact

Read: match the customer's `noise_descriptor` + condition; the **first** candidate is the confident pick,
the rest are the hedge set; the last column is the single fact that decides. Subcategory slugs are Stage-2
targets; the parenthetical is the Stage-1 testing service that reaches them.

| # | noise_descriptor | Condition (onset/speed/zone) | Ranked candidate → subcategory (service) | THE discriminating fact |
|---|---|---|---|---|
| N1 | squealing_high_pitched | `when_braking` | brakes → high_pitched_squealing (brake_inspection) | `onset_timing=when_braking` → brakes |
| N2 | squealing_high_pitched | `during_driving`, foot OFF pedal, **quiets when you brake** | brakes wear-tab → high_pitched_squealing (brake_inspection) | quiets-on-application → brake wear indicator, **NOT** a bearing (do not apply the off-pedal bearing rule to a squeal) |
| N3 | squealing_high_pitched | `when_turning` the wheel | steering → noise_when_turning_the_steering_wheel (suspension_steering_check) | `onset_timing=when_turning` (dry strut bearing / column) vs `when_braking` (brakes) |
| N4 | grinding_metallic / scraping | `when_braking` | brakes → metallic_grinding (brake_inspection) | grinding ONLY on-pedal → brakes; also off-pedal → bearing/driveline (N9) |
| N5 | whining | RPM-linked / continuous, under hood, present when not turning | belt-alt-PS → high_pitched_whining_under_the_hood (charging_starting_testing) | RPM-linked/continuous → belt/alt; `when_turning` → PS (N3) |
| N6 | humming_or_whirring / roaring | rises with **road speed** (~30-40+ mph), **louder turning one way** | wheel bearing → humming_or_whirring_at_speed (suspension_steering_check) | steering-load-sensitive → bearing; constant, ignores steering → tire roar (same subcat, note); on-gas-vs-coast change → diff (N7) |
| N7 | humming_or_whirring / whining | rises with road speed BUT **changes on-gas vs coast** | differential → humming_or_whirring_at_speed (suspension_steering_check) / awd_4x4_testing | throttle-phase change → diff; pure speed-tracking → bearing (N6); changes with **gear/RPM** → transmission_testing |
| N8 | popping_or_clicking | `when_turning`, **while rolling** (low_speed, parking lots), rhythmic, one side | CV joint → popping_or_clicking_when_turning (suspension_steering_check) | happens **moving** through a turn → CV; only turning wheel **parked/at a stop** → steering noise_when_turning (N3) |
| N9 | clunking | `over_bumps` / rough road, no brake or throttle input | suspension → clunking_over_bumps (suspension_steering_check) | `over_bumps` → suspension; on shift/take-off → driveline (N10); on brake apply/release → brakes (N11) |
| N10 | clunking | on shift park→drive/reverse, on take-off, snapping on/off throttle | driveline U-joint/diff → **NO clean subcat** (propose `driveline_engagement_clunk_or_bind`) → awd_4x4_testing / transmission_testing | torque-reversal/gear-engagement → driveline; `over_bumps` → suspension |
| N11 | clunking / knocking (single) | the instant you press OR release the brake | brakes (loose caliper/guide pin) → brake_inspection (`pedal_feel` context) | fires on brake input → brakes; over bumps → suspension |
| N12 | knocking_deep | `when_accelerating` / under load / uphill, from lower engine | engine bottom-end → deep_knocking_from_the_engine (check_engine_light_testing) | engine load → engine; `over_bumps` → suspension |
| N13 | ticking_or_tapping | `cold_start`, **fades/disappears once warm**, under hood | exhaust manifold → exhaust_manifold_tick_or_puff (exhaust_system_testing) | **fades-when-warm → manifold**; persists warm → valvetrain (N14). No slot holds "fades warm" → probe (`warm_up_behavior` proposed, engine-mechanical §9) |
| N14 | ticking_or_tapping | present warm too, tracks RPM, top of engine, "sewing machine" | engine valvetrain/chain → engine_ticking_or_tapping (oil_pressure_light_testing / check_engine_light_testing) | still ticking fully warm → valvetrain/chain, NOT manifold |
| N15 | rattling | underneath, at idle / on throttle blip, "can of rocks" | exhaust cat/heat-shield → rattling_underneath_the_car (exhaust_system_testing) | engine-vibration-triggered rattle → exhaust; bump-triggered thump → suspension clunk (N9) |
| N16 | roaring / rumbling | rises with **engine RPM** (rev in park), deep drone | exhaust → exhaust_louder_or_rumbling (exhaust_system_testing) | RPM-linked → exhaust; road-speed-linked → tire/bearing (N6). "rumble/drone" has no exact `noise_descriptor` value → `roaring` is nearest (exhaust §9 proposes `rumbling_or_droning`) |
| N17 | creaking_or_squeaking | `over_bumps`, worse cold/wet, "dry porch step" | suspension bushings → squeaking_or_creaking_over_bumps (suspension_steering_check) | `over_bumps` → suspension; `when_turning` wheel → steering; `when_braking` → brake squeal |
| N18 | buzzing | electrical, tied to a switch/accessory/relay, no engine-RPM link | electrical → electrical_buzzing (electrical_testing_general) | electrical/relay buzz → electrical; a mechanical rattle → N15 |
| N19 | hissing | `when_braking` (+ hard pedal) | brakes vacuum booster → hard_or_unresponsive_pedal (brake_inspection) | hiss on-pedal + hard pedal → booster; hiss under hood not brake-tied → coolant/vacuum (router-leaks/hissing_noise) |

**Vague-noise safety valve.** "weird noise up front", "strange noise when driving", "makes a noise"
(corpus: tkc-081 "Tires making a strange noise", tkc-047 "Making some noise") carry **no** descriptor and
**no** condition → this router returns a *hedge set*, never a confident pick, and the wizard asks
`noise_descriptor` + `onset_timing` first. Do not let a bare location ("up front") force a system.

---

## 4. Decision table B — VIBRATION × condition/felt-location → ranked candidates + the ONE discriminating fact

| # | Vibration presentation | Condition | Ranked candidate → subcategory (service) | THE discriminating fact |
|---|---|---|---|---|
| V1 | shudder/pulse **only when braking** | `when_braking`, worse from highway | brakes rotor → vibration_or_pulsing_when_braking; if felt in pedal → pulsating_or_vibrating_pedal (brake_inspection) | `onset_timing=when_braking` → brakes |
| V2 | steering-wheel shimmy in a **narrow highway band** (~55-70), foot OFF brake | `speed_band=highway`/`specific_mph` | wheel balance / bent wheel → steering_wheel_shake_at_highway_speed (suspension_steering_check) | highway band + **no brake** → balance; only `when_braking` → brake pulsation (V1) |
| V3 | shake/bounce/harshness **over bumps & rough roads** | `over_bumps` | suspension (worn dampers/springs) → shaking_or_bouncing_over_bumps_and_rough_roads (suspension_steering_check) | `over_bumps` → suspension; steady highway band → balance (V2) |
| V4 | shudder **when speeding up / uphill / on take-off** | `when_accelerating` | driveline inner-CV/U-joint OR engine → shaking_when_speeding_up_or_going_uphill (suspension_steering_check) | at launch/accel, straight-line → driveline; with flashing CEL/bucking → engine misfire (performance) |
| V5 | shake **only at idle / stopped**, engine running, smooths when moving | `at_stop`/`when_idling` | engine rough idle / mounts → shaking_at_idle_while_stopped (transmission_testing reaches performance; check_engine for CEL) | present at idle, gone in motion → engine/mounts; present in motion → V2/V3 |
| V6 | **constant** tremor at **every** speed, doesn't narrow to a band, unaffected by brake/throttle | `all_speeds` | out-of-round tire / broken belt / bent driveshaft → constant_vibration_that_doesnt_change_with_speed (suspension_steering_check) | present at ALL speeds, no band, no brake/throttle change → out-of-round; narrows to a band → balance (V2) |

**Felt-through-the-pedal caveat.** "brake pedal vibrates/shudders" (corpus tka-002) is BOTH a
`noise/vibration` cue and `pedal_feel=pulsating`. When the customer ties the shake to the **pedal** and to
**braking**, it is V1 (brakes), not V2 — `onset_timing=when_braking` wins over a bare "shakes at highway
speed".

---

## 5. The differential — the ONE discriminating fact per confusable pair (the charter)

The eight pairs this router owns, each reduced to its single best question + the fact slot/value that
resolves it. This is the human-readable source for `binding/differential-table-nvh.md` and the
`confusable_matrix_rows` in the proposals file.

| Pair | ONE discriminating question | Slot = value that decides | Slot today? |
|---|---|---|---|
| **P1 brake vibration ↔ suspension / wheel-balance vibration** | "Does it shake **only when you press the brake**, or at a steady highway speed / over bumps with your foot off the brake?" | `onset_timing=when_braking` → brakes; `speed_band=highway`+no-brake → balance; `over_bumps` → suspension | ✅ |
| **P2 CV click-on-turn ↔ steering-column noise-on-turn** | "Does the click happen **while the car is moving** through a turn, or also when you turn the wheel while **parked/stopped**?" | `onset_timing=when_turning` + `speed_band=low_speed` (moving) → CV; + `speed_band=stopped` → steering noise_when_turning | ✅ (`stopped` exists) |
| **P2b CV click ↔ wheel-bearing hum** | "Is it a repeating **click** only when turning, or a steady **hum** that rises with speed?" | `noise_descriptor=popping_or_clicking` → CV; `humming_or_whirring` → bearing | ✅ |
| **P3 wheel-bearing hum ↔ tire hum/roar** | "Does the hum get **louder turning one way and quieter the other**, or stay the same no matter how you steer?" | steering-load-sensitive → bearing; constant + `tire_state=uneven_wear` → tire | ❌ needs `steering_load_effect` (wheels-tires §9) — **probe** until then |
| **P4 valvetrain tick ↔ exhaust-manifold tick** | "Does the ticking **go away once the engine is fully warmed up**, or is it still there warm?" | fades-warm → manifold (exhaust_manifold_tick_or_puff); persists-warm → valvetrain (engine_ticking_or_tapping) | ❌ needs `warm_up_behavior` (engine-mechanical §9) — **probe**; `onset_timing=cold_start` only says WHEN it starts |
| **P5 differential whine ↔ wheel-bearing hum** | "Does the sound **change when you get on the gas vs coast**, or does it just track how fast you're going?" | throttle-phase change → diff; pure speed-tracking → bearing | ⚠ partial — `onset_timing=when_accelerating` present leans diff; no coast value → **probe** |
| **P5b diff/bearing whine ↔ transmission whine** | "Does the whine track **road speed** (same at a given mph in every gear) or **engine RPM** (changes when it shifts)?" | road-speed → driveline; RPM/gear-linked → transmission_testing | ⚠ `speed_band` can't hold road-vs-RPM → **probe** |
| **P6 driveline take-off/torque-reversal clunk ↔ suspension bump clunk ↔ brake-apply clunk** | "Does the clunk happen when you **shift into gear / take off / lift off the gas**, over **bumps**, or the instant you **touch the brake**?" | shift/throttle-reversal → driveline (propose `onset_timing=on_gear_engagement_or_take_off`); `over_bumps` → suspension; `when_braking` → brakes | ⚠ driveline value proposed (driveline §5) |
| **P7 engine rod-knock ↔ suspension clunk** | "Does the deep knock happen with **engine load** (accelerating/uphill), or with **road bumps**?" | `onset_timing=when_accelerating` + `noise_descriptor=knocking_deep` → engine; `over_bumps` + `clunking` → suspension | ✅ |
| **P8 exhaust rumble/roar ↔ tire/bearing roar** | "Does the sound rise with **engine RPM** (rev it in park) or only with **road speed**?" | RPM-linked → exhaust (exhaust_louder_or_rumbling); road-speed-linked → bearing/tire (humming_or_whirring_at_speed) | ⚠ no "rises-with-RPM-in-park" slot → **probe** |

**Two rules that keep P4/P2 from mis-firing (do NOT regress):**
- The **off-pedal grinding** rule (brakes §5) is scoped to `grinding_metallic` ONLY. A brake **wear-tab
  squeal** is loudest with the foot OFF the pedal and quiets on application yet is still brakes (N2) — do
  not route it to a bearing.
- P2's moving-vs-parked split is the CV/steering fork; the `stopped` value already exists, so it is
  expressible today without a new slot.

---

## 6. `vibration_felt_location` — the router's owned routing signal

Handed to this router by [`binding/required-facts-map.q3.md` §1](../binding/required-facts-map.q3.md): a
proposed enum `{ steering_wheel, seat, brake_pedal, floor, whole_car }` (**multi-value**). It is
**DEFERRED as a skip-key** — 7 questions (144, 151, 167, 1478, 734, 755, 691) ask it multi-select, so a
customer stating ONE location has not denied the others, and skipping on a single stated location is a
*wrongful skip* (methodology §5 ranks that worse than over-asking). But as a **routing signal** it is
sharp:

| felt location (literal) | Points toward | Ranked subcategory | Why |
|---|---|---|---|
| steering wheel only | front-end / steering / front-wheel balance | steering_wheel_shake_at_highway_speed (V2) | front imbalance & steering-linkage vibration transmit up the column |
| seat / rear / back of car | rear-wheel balance / driveline | constant_vibration… or shaking_when_speeding_up (V4/V6) | rear-axle & driveshaft vibration is felt in the seat, not the wheel |
| brake pedal | brake rotor pulsation | vibration_or_pulsing_when_braking (V1) | overlaps `pedal_feel=pulsating`; pair with `onset_timing=when_braking` |
| whole car, at idle | engine mounts / rough idle | shaking_at_idle_while_stopped (V5) | mount/idle shake couples the whole body |
| through the floor, at speed | driveline / exhaust contact | shaking_when_speeding_up or constant_vibration (V4/V6) | driveshaft/U-joint & a dragging exhaust telegraph through the floor |
| **wheel AND seat (both stated)** | **front + rear or a whole-vehicle source** | escalate to advisor / broaden | the multi-location statement is itself diagnostic — do NOT collapse to one |

**Contract for the mapper:** `vibration_felt_location` **must not** be used to skip any of the 7 multi-select
questions (they stay `intentionally_empty` per q3 map). It feeds Stage-1/Stage-2 *ranking* only. When the
customer names it, use it to break V-table ties; when they don't, ask it as a probe.

---

## 7. Customer-voice cues (linguistic authority — corpus first)

Real phrasings that anchor the tables above. Provenance: `tekmetric` (verbatim corpus), `forum-paraphrase`
(pattern reworded), `synthetic` (flagged). Full machine set feeds the `stage2.example.*` ops in the
proposals file. Diagnostic claims here are NONE — these are language only (source-policy.md).

**Hum / roar / bearing (N6/N7/P3/P5):**
- "Very noticeable humming type sound seemingly coming from rear end, most noticeable at 30 to 40 mph.
  Sounds like aggressive / snow tires on the back." (tekmetric — the canonical bearing-vs-tire line)
- "Clunk/scrape wheel well … hears it at various speeds but mostly while decelerating. sounds like a wheel
  bearing." (tekmetric)
- "Was at dealership and was told wheel bearings were needed wants second opinion" (tekmetric — second-opinion framing)
- "ROTATIONAL NOISE HEARD IN LEFT REAR" (tekmetric); "humming that gets louder curving left, quieter
  curving right" (forum-paraphrase — steering-load tell)
- "roar and clicking/tapping" (tekmetric — the **roar dominates → suspension_steering_check**, NOT engine tick)

**Click / clunk / turn (N8/N9/N10/P2/P6):**
- "skipping feeling when turning and driving. Feels like when a pick-up truck is stuck in 4X4" (tekmetric → awd_4x4_testing)
- "Vehicle has clunking in front end when driving … client thinks failing tie rod ends" (tekmetric → clunking_over_bumps)
- "clunking noise when putting the car into drive from park / turning left" (tekmetric → driveline engagement, NO clean subcat)
- "tick-tick-tick when I make a sharp turn, faster the tighter I go" (synthetic → popping_or_clicking_when_turning)
- "steering column seems to be making a grinding noise when turning, mostly when backing out of parking
  spaces" (tekmetric → noise_when_turning_the_steering_wheel — steering, turning the wheel at low speed)

**Tick / tap / rattle (N13/N14/N15/P4):**
- "My car has started making an intermittent tapping. It does it for a few seconds and then stops" (tekmetric — ambiguous, needs onset)
- "making a ticking noise when driving" (tekmetric — needs onset/zone: manifold vs valvetrain)
- "engine sounds like a sewing machine when I first start it" (catalog/tekmetric → engine_ticking_or_tapping)
- "fast ticking … first start it cold … goes away after it warms up" (synthetic authored → exhaust_manifold_tick_or_puff)
- "RATTLE APPEARS TO BE HEATSHIELD RATTLE" / "RE CHECK HEATSHIELD RATTLE" (tekmetric → rattling_underneath_the_car)
- "ISOLATE RATTLE NOISE UNDER HOOD WHEN GOING ABOVE 60MPH" (tekmetric — needs descriptor/zone)

**Shake / vibration / shimmy / wobble (V1-V6/P1):**
- "SHIMMY AT HIGHWAY SPEEDS" ; "WHEEL SHAKES AT HIGHWAY SPEEDS" (tekmetric → steering_wheel_shake_at_highway_speed)
- "CHECK BRAKES (Steering wheel shakes at highway speeds)" (tekmetric — **customer guessed brakes; it's a highway shimmy** → hedge)
- "BRAKE PEDAL ALSO VIBRATES AT HIGHWAY SPEEDS WHEN BRAKING" (tekmetric → vibration_or_pulsing_when_braking, pedal-tied)
- "VEHICLE SHAKING AT ALL SPEEDS ( like a 2000lbs vibrator )" (tekmetric → constant_vibration_that_doesnt_change_with_speed)
- "the right rear wheel started wobbling, and … The traction control light, the ABS light, and the brake
  light … blinking" (tekmetric — wheel wobble + multi-light **after** an event → after_a_recent_accident_or_impact, NOT a plain shimmy)
- "WHEN HITTING A BUMP AT HIGHWAY SPEEDS, CLIENT GETS A VIOLENT SHAKE" (tekmetric → shaking_or_bouncing_over_bumps_and_rough_roads)

**Messiness preserved:** all-caps work-order fragments, part-name guesses ("track bar", "tie rod ends",
"lifters", "wheel bearings"), customer misattribution ("shakes at highway = CHECK BRAKES"; "rumbling = I
think it's the alignment"), diagnosis-echo ("dealership said…"), and vague forms ("makes a noise",
"strange noise") that must return a hedge, not a pick.

---

## 8. Sources

Diagnostic/differential authority (the physics in §2 and the discriminators in §5) — tiered per
`source-policy.md`; language in §7 is corpus/linguistic and cites no diagnostic authority:

- Halderman, *Automotive Technology* / *Automotive Brake Systems* / *Automotive Engine Repair & Rebuilding*
  / *Automotive Engine Performance* — NVH road-test method, brake noise & pulsation, valvetrain vs manifold
  tick, bottom-end knock, wheel bearings, driveshaft/U-joint, exhaust. Tier 2, print, ref 2026-07-18.
- Bosch, *Automotive Handbook* 10e — brake booster/friction, exhaust after-treatment. Tier 1, print, ref 2026-07-18.
- West Coast Differentials, "Diagnosing Differential Problems",
  https://differentials.com/diagnosing-differential-problems/ — accel = ring-and-pinion mesh; coast-only =
  pinion bearings; take-off clunk = backlash; corner chatter = LSD clutches. Tier 2, ref 2026-07-18.
- Timken, *Symptoms of a Worn Wheel Hub Bearing*; SKF wheel-bearing training — speed-rising,
  steering-load-sensitive hum; integral ABS tone ring. Tier 2, ref 2026-07-18.
- Tomorrow's Technician (Babcox), "ABS Light On? It Might Be a Wheel Bearing, Not the Sensor",
  https://www.tomorrowstechnician.com/abs-light-on-it-might-be-a-wheel-bearing-not-the-sensor/ — Tier 2, ref 2026-07-18.
- Moog (moogparts.com) — sway-bar/ball-joint/tie-rod clunk & wander signatures. Tier 2, ref 2026-07-18.
- Monroe / KYB — worn-damper ride signatures (continued bounce, nose-dive). Tier 2, ref 2026-07-18.

Consumed Wave A dossiers (each owns its within-system detail; this router owns the fork between them):
`brakes-friction-hydraulic`, `suspension-ride-alignment`, `driveline-cv-diff-awd`,
`wheels-tires-tpms-bearings`, `steering-power-steering`, `engine-mechanical`, `exhaust-emissions`,
`hvac-climate` (blower/compressor vent-noise boundary).

Linguistic authority (§7): `real-concerns-tekmetric-labeled-v2.json`, `eval-cases.json` — mined
2026-07-18. Synthetic phrasings flagged inline.
