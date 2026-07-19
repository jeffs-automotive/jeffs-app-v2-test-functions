# Catalog & subcategory gaps — consolidated triage (Chris-gated business decisions)

> **Consolidates** section 8 ("Mapping to current taxonomy") of all 24 Wave-A dossiers plus every
> `catalog.service.propose`, `stage2.subcategory.propose`, and `concern_categories`-reachability op in
> the per-system `proposals.yaml` files. **Nothing here is applied.** These are the coverage gaps where a
> customer utterance has *no good home* in the live taxonomy
> ([`00-current-scheduler-taxonomy.md`](../00-current-scheduler-taxonomy.md)) — surfaced so Chris can
> triage by **volume** (Phase 5, methodology apply-order step 5: catalog changes last, they change the
> label space and need a golden-set v2).
>
> **Three cost classes, three tables** (methodology "propose new subcategory (low cost)" vs "propose new
> testing service (fee/capacity = business decision)", plus a third bucket the dossiers surfaced —
> reachability config edits that are near-zero-cost but still change the label space):
> - **Table A — new subcategories** (Stage-2 label adds; low cost, no fee/capacity change).
> - **Table B — new / reworked testing services** (fee + capacity = a real business decision).
> - **Table C — `concern_categories` reachability edits** (config-only; no fee, but change which
>   subcategories a service can reach, so still Chris-gated).
>
> **Demand signal** cites real corpus IDs (`tk*` = `real-concerns-tekmetric-labeled-v2.json`,
> `eval *` = `eval-cases.json`) or is honestly flagged *forward-looking / thin / synthetic* where the
> corpus is silent. A NO-FIT with no demand evidence is **not** a proposal (per dossier-template §8).

---

## 0. Prioritized NO-FIT gap table (triage by volume — read this first)

Ranked by corpus demand. "Current mis-route" = where the utterance lands today (wrong home or bare
advisor). Every row terminates in a typed op in Table A/B/C.

| # | What customers say (real voice) | Current mis-route | Proposed fix | Demand signal (corpus) | Class |
|---|---|---|---|---|---|
| 1 | **"4 new tires and alignment" / "tire replacement" / "dry rot, need new tires"** | `tire_repair` (excludes worn/aged/new) → bare advisor | **`tire_sales_consultation`** service + route `just_want_new_tires` + `dry_rot_sidewall_cracking` to it | tkc-138, tka-125, tka-169, tka-112, tkc-159 (**5+ recurring**) | B |
| 2 | **"does not shift into gear" / "gets stuck in park" / "slams hard into gear" / "went into limp mode"** | force-fit into `low_power` / `hesitation` (whose descriptions explicitly exclude shift behavior) | **`harsh_delayed_or_no_shift`** subcat + expand `transmission_testing` reach | **≥8 distinct lines**: "vehicle starts but does not shift into gear", "gets stuck in park", "tow in does not shift", "went into limp mode", "jerks while switching gears" | A + C |
| 3 | **"driver headlight out, replaced bulb still out" / "one tail light is out" / "blinker not working"** | `accessory_doesnt_work` (enrichment is windows/radio/locks) | **`exterior_light_out`** subcat (+ interim enrich `accessory_doesnt_work`) | 4 concern lines (headlight, tail, turn signal, plate lamp) + 3 declined/work-order lamp lines = **7** | A |
| 4 | **"it overheated on the way home" / "running hot" / "lost all my coolant"** (no light, no puddle named) | force-fit onto `warning_light/engine_temperature_light` (a light-first slug) → mislabels lead symptom | **`engine_overheating_running_hot`** subcat (perf); interim `engine_temperature_light` desc revise | **~4 clean**: "VEHICLE OVERHEATED AND LOST ALL COOLANT", "CHECK FOR OVERHEATING. HAS NOT ADDED ANY COOLANT", "drop box overheating", "gauge fluctuate high/low… STAT stuck" | A |
| 5 | **"clunk when I shift into drive / take off from a stop / get on and off the gas"** (driveline, not bumps) | `clunking_over_bumps` (wrong: bump-triggered) or null | **ONE driveline take-off/shift-clunk subcat** (see conflict B) + `awd_4x4_testing` +noise + a driveline diagnosis service | tkc-269 ("jerking in driveline backing up / tight turns"), tkc-275 ("clunking… park→drive/turning left"), + forum | A + B + C |
| 6 | **"water leaking into the driver's side, floor is full of water"** (rain/car-wash, body intrusion) | mislabeled `ac_performance_check` / ambiguous AC-leak (it's body water, not AC) | **`water_leaking_inside_the_car`** subcat (leak) + `body_water_leak_testing` service | 2 real misrouted Tekmetric lines ("floor is full of water!", "front floor board, passenger side, water standing") | A + B |
| 7 | **"water drips on the passenger floor whenever the AC is on"** (clogged evaporator drain) | `clear_odorless_puddle…` = *under-car* normal condensation → treated harmless | **`water_leaking_inside_cabin_ac_on`** subcat (hvac); interim desc revise | ≥3 forum utterances (dossier §8). *Distinct from #6 — sharp negatives required* | A |
| 8 | **"can't fill with gas, pump keeps clicking off / gas spits back out"** | `check_engine_light_testing` + NULL subcat, or masked under `after_recent_service` | **`trouble_fueling_gas_wont_go_in`** subcat (perf) | tka-046 (clean null), tka-137 (fill-failure masked under recent-service) | A |
| 9 | **"clutch is slipping, revs up and no power" / "grinds into first" / "clutch pedal to the floor"** | `low_power` (engine bucket) or NO FIT (advisor) | **3 manual-clutch subcats** (`manual_clutch_slipping`, `grinding_or_hard_shift_gears`, `clutch_pedal_or_engagement_feel`) + trans-leak reach | 2 tekmetric slip lines + forum grind/hard-shift/pops-out patterns | A + C |
| 10 | **"State Inspection and Emissions… just need the inspection" / "make sure no exhaust leaks"** | null-route to advisor (it's not the $39.99 diagnostic eval) | **State Safety / Emissions Inspection** bookable service | v2:4440, v2:10701 (2 explicit inspection requests) | B |
| 11 | **"my brakes grab really hard, jumpy even with light pedal"** | `brake_inspection` at Stage-1; signal lives ONLY in Stage-3 `pedal_feel=grabby`, no Stage-2 home | **`grabby_or_jumpy_brakes`** subcat | `pedal_feel=grabby` is a LIVE enum with no matching subcat; corpus thin (fact-level attested) | A |
| 12 | **"tires wearing on the inside edge, check the alignment"** | unreachable — `uneven_tire_wear_bald_spots` is in `tires`, not reachable from `suspension_steering_check`; routes via `tire_repair` | `suspension_steering_check` **+tires** reachability | 3 tekmetric: "uneven wear inside edge… alignment", "alignment check (rear tires worn on edges)", "alignment (uneven wear)" | C |
| 13 | **"turbo whistles and no power under boost / went into limp mode, won't build boost"** | splits 3 ways (`low_power`/`hesitation`/`whining`); no clean boost home | **`turbo_or_boost_power_problem`** subcat + Forced-induction test service | modest current volume; README-named coverage gap | A + B |
| 14 | **"a lifter tick that turned into a knock"** (oil-starvation, noise-led) | dead-ends — `oil_pressure_light_testing` can't reach `noise` subcats; no service reaches engine knock/tick | `oil_pressure_light_testing` **+noise** reachability | §3.7/§3.8 oil-starvation; knock-led utterance dead-ends at Stage-2 | C |
| 15 | **"noise coming from the water pump, metal on metal"** (bearing, not a leak) | dead-ends — cooling services can't reach `noise` | `coolant_leak_testing[_euro]` **+noise** reachability | "water pump pulley was wobbling", "noise… from water pump… metal on metal" | C |
| 16 | **"my truck started blowing black smoke"** (rich fuel) | reachable only via coolant/oil leak testing (wrong diagnostics); CEL can't reach `smoke` | `check_engine_light_testing` **+smoke** reachability | eval CEL-007; taxonomy line 77 already *claims* CEL owns blue/gray smoke but DB omits `smoke` | C |
| 17 | **"security light flashing and the car won't start" / "key not detected"** (immobilizer) | split between `no_start_testing` / `electrical`, no Stage-2 home → confused with battery no-start | **`security_or_anti_theft_light`** + **`key_or_fob_not_recognized_wont_start`** subcats + immobilizer service | **0 real** in Jeff's corpus (synthetic-only; NHTSA ODI anchoring REQUIRED before ship) | A + B |
| 18 | **"reduced power / turtle light" / "check hybrid system" / "won't go to READY" / "won't charge" / "range dropped"** | `low_power` / generic CEL / `wont_crank_just_clicks` (mis-describes an EV) | **5 hybrid/EV subcats** + `hybrid_ev_high_voltage_testing` service | **2 lines total** ("service high voltage charging system" + a Tesla work-order), 0 BEV concerns — forward-looking, "be-ready" | A + B |
| 19 | **"message says front radar obstruction / lane keep assist unavailable"** (ADAS) | `warning_light_general` generic scan (doesn't scope/price calibration) | **`adas_driver_assist_warning_or_malfunction`** subcat + ADAS calibration diagnostic service | **0 current** corpus traffic — forward-looking (growing-fleet, not a mandate); FMVSS 127 effective ~2029 | A + B |
| 20 | **"seat belt won't latch / stuck / chime with no light"** (mechanical restraint) | neither `airbag_srs_light` (needs a light) nor `accessory_doesnt_work` (powered) → advisor | **`seat_belt_or_restraint_hardware`** subcat (propose-only) | **thin** — seat belt appears only as an SRS-light *trigger*, never standalone | A |
| 21 | **"parking brake doesn't hold, car rolls on my driveway"** (no friction symptom) | no clean brakes subcat (all 6 assume friction/hydraulic) → advisor | **`parking_brake_wont_hold`** subcat (propose-only) | **thin** — parking brake appears only *paired* with hydraulic symptoms (tka-192, eval brake_inspection-003) | A |
| 22 | **"trans slips uphill, rpms climb but barely speeds up"** (auto) | `low_power` (conflates with engine weakness) | **`transmission_slipping`** subcat (lower priority; the `transmission_behavior` slot may suffice) | folded into #2's demand; optional split | A |

**Documented gaps deliberately NOT proposed** (below the bar — logged so future verifiers don't re-flag):
- **Broken/collapsed spring** ("LEFT FRONT WHEEL SITTING LOWER THAN REST") — 1 confirmed line, routes to
  `suspension_steering_check` Stage-1 with null Stage-2; below the new-subcategory bar (suspension §3k).
- **Shared-circuit simultaneous-dead vs random-over-time** (body-electrical FM-8) — a **slot** expressibility
  gap, not a subcategory gap (§9 slot proposal).
- **Aftermarket "make-it-loud / delete" exhaust request** — DROPPED: the corpus contains **no** such
  request, so no demand evidence and no op (exhaust §8).
- **`tpms_tire_pressure_light` description references a non-existent sibling slug** (`tires/visible_low_or_flat_tire`)
  — a copy-edit flagged for Chris, NOT auto-revised (wheels §8).

---

## Table A — new subcategories (low cost: Stage-2 label adds, no fee/capacity change)

Cost is authoring a description + question set + enrichment; no pricing or capacity decision. Still
Chris-gated because a new subcategory changes the Stage-2 label space (needs golden-set v2).

| Subcategory (proposed) | Category | Owning dossier | Demand | Notes |
|---|---|---|---|---|
| `harsh_delayed_or_no_shift` | performance | automatic-transmission | **HIGH** (≥8 lines) | Shift-quality: harsh/delayed/no-engagement/stuck/pops-out/flare. **See conflict A.** |
| `exterior_light_out` | electrical | lighting-visibility | MED (7 lines) | Headlight/tail/turn/fog/plate bulb-out; distinct fix family from interior circuits |
| `engine_overheating_running_hot` | performance | cooling-system | MED (~4 clean) | Overheat/running-hot as PRIMARY symptom, no light/puddle led. Routes to `coolant_leak_testing` |
| `driveline_engagement_clunk_or_bind` | noise | driveline-cv-diff-awd | MED (tkc-269, tkc-275) | Torque/shift/take-off clunk + AWD bind. **See conflict B** (duplicate of the suspension proposal) |
| `driveline_clunk_on_shift_or_acceleration` | noise | suspension-ride-alignment | MED (same corpus) | **Duplicate of the above — conflict B; collapse to one slug** |
| `water_leaking_inside_the_car` | leak | body-glass-water-leaks-keys | MED (2 real misrouted) | Rain/car-wash body intrusion; distinct from #7 (AC drain) |
| `water_leaking_inside_cabin_ac_on` | hvac | hvac-climate | MED (≥3 forum) | Clogged evaporator drain; distinct from #6 (body). Needs sharp mutual negatives |
| `trouble_fueling_gas_wont_go_in` | performance | fuel-system-evap | LOW-MED (tka-046, tka-137) | Pump clicks off / gas spits back; EVAP vent/canister/filler |
| `manual_clutch_slipping` | performance | manual-trans-clutch | LOW-MED (2 tk + forum) | Under `performance` so `transmission_testing` reaches it |
| `grinding_or_hard_shift_gears` | performance | manual-trans-clutch | LOW-MED (forum) | Grind/notchy/pops-out/linkage slop. **Overlaps conflict A** but manual-specific (synchro/clutch) |
| `clutch_pedal_or_engagement_feel` | performance | manual-trans-clutch | LOW-MED (FM-2/5/6/7/9/10) | Pedal feel + all 3 pedal-phase bearing noises + DMF rattle |
| `grabby_or_jumpy_brakes` | brakes | brakes-friction-hydraulic | LOW (fact-attested) | Fills the `pedal_feel=grabby` live-enum-with-no-subcat gap |
| `transmission_slipping` | performance | automatic-transmission | LOW (optional) | Split slip out of `low_power`; the `transmission_behavior` slot may make it unnecessary |
| `turbo_or_boost_power_problem` | performance | air-induction-forced-induction | LOW (modest) | Boost-specific; README-named growth gap |
| `security_or_anti_theft_light` | warning_light | body-glass-water-leaks-keys | THIN (0 real / synthetic) | **Fills a 12→13 warning-light gap. Synthetic-heavy — NHTSA anchoring required before ship** |
| `key_or_fob_not_recognized_wont_start` | electrical | body-glass-water-leaks-keys | THIN (0 real / synthetic) | Immobilizer no-start; **100% synthetic — NHTSA anchoring required before ship** |
| `hybrid_or_ev_reduced_power_or_limp_mode` | performance | hybrid-ev-high-voltage | THIN (fwd-looking) | Turtle/derate on a stated hybrid/EV |
| `hybrid_or_ev_wont_power_on` | electrical | hybrid-ev-high-voltage | THIN (fwd-looking) | Won't-go-to-READY; check 12V aux FIRST (low-cost cause) |
| `hybrid_system_warning_light` | warning_light | hybrid-ev-high-voltage | THIN (fwd-looking) | "Check hybrid system" / red triangle |
| `hybrid_or_ev_wont_charge` | electrical | hybrid-ev-high-voltage | THIN (advisor-gated) | EVSE/on-board-charge; advisor unless HV service ships |
| `hybrid_or_ev_battery_degradation_range_loss` | performance | hybrid-ev-high-voltage | THIN (advisor-gated) | Range/economy fade; category placement imperfect (no range/EV category) |
| `adas_driver_assist_warning_or_malfunction` | warning_light | adas-driver-assist | THIN (fwd-looking) | Routes to `warning_light_general`; flag calibration triggers |
| `seat_belt_or_restraint_hardware` | electrical | airbag-srs-restraints | THIN (propose-only) | Do NOT author questions until Chris confirms volume |
| `parking_brake_wont_hold` | brakes | brakes-friction-hydraulic | THIN (propose-only) | Do NOT author questions until Chris confirms volume |

Plus one Stage-1-only proposal from ignition-misfire — `jerks_or_hard_shifts_between_gears` (performance,
`transmission_testing`) — which is **the same shift-quality gap as `harsh_delayed_or_no_shift`** (conflict A).

**Subcategory count: 24 distinct proposals + 1 conflicting duplicate name (25 raw ops).** After collapsing
the two conflicts (A: 3 overlapping shift-quality → keep the auto/general + the manual-specific; B: 2
driveline-clunk → 1), the net-new subcategory count Chris would approve is **~22**.

---

## Table B — new / reworked testing services (fee + capacity = business decision)

These add a bookable line item and/or a fee — a real pricing/capacity/policy call, not just a label.

| Service (proposed) | Owning dossier | Fee posture | Demand | Business decision |
|---|---|---|---|---|
| **`tire_sales_consultation`** | wheels-tires-tpms-bearings | $0 advisor-quote OR fold into a quote flow | **HIGH** (tkc-138, tka-125, tka-169, tka-112, tkc-159) | THE tire-buying gap. Structured size/style/budget flow vs bare advisor hand-off |
| **State Safety / Emissions Inspection** | exhaust-emissions | State/shop flat fee (not diagnostic hourly) | MED (v2:4440, v2:10701) | Only if Jeff's is a licensed inspection station |
| **Driveline / CV / diff / U-joint / mount diagnosis** | suspension-ride-alignment | Between $89.95 and $179.95 (road-test + lift) | MED (tkc-269/275 + forum) | Pairs with the driveline-clunk subcat (conflict B) |
| **`body_water_leak_testing`** | body-glass-water-leaks-keys | ~$109–$149 (hose/leak-trace labor) | MED (2 real + forum) | Pairs with `water_leaking_inside_the_car` |
| **Forced-induction / boost system test** | air-induction-forced-induction | CEL parity ($179.95) OR just route to CEL | LOW (modest) | Faults already scan under CEL; may not need its own line |
| **`key_immobilizer_antitheft_testing`** (OR widen `electrical_testing_general` scope) | body-glass-water-leaks-keys | $179.95 no-start/electrical tier | THIN (0 real) | Alternative is a scope-text widen, no new service |
| **Oil change / routine-maintenance booking** (non-diagnostic) | engine-lubrication-oil | Per Jeff's oil-change menu (no diagnostic fee) | HIGH volume, but maintenance not a fault (tkc-011/054/285/246) | A booking path so oil-change lines stop competing with `oil_leak_testing` |
| **ADAS calibration diagnostic** | adas-driver-assist | $179.95 tier + calibration sublet/in-house | THIN (0 current, fwd-looking) | Growing-fleet bet; calibration policy (in-house vs sublet) |
| **`hybrid_ev_high_voltage_testing`** | hybrid-ev-high-voltage | $179.95 tier (HV-trained-tech only); 12V test stays FREE/$89.95 | THIN (2 lines, fwd-looking) | **First decide whether the shop services HV vehicles at all**; else the 5 hybrid subcats route to advisor |

**New-service count: 9** (2 of which — Forced-induction, key/immobilizer — have a "no new service, just
fold/widen" alternative).

---

## Table C — `concern_categories` reachability edits (config-only, no fee, Chris-gated)

Near-zero cost — a service-row edit — but Chris-gated because it changes which Stage-2 subcategories a
service can reach (label-space reach). Several §8 NO-FITs are **structural unreachability**, not missing
labels: the right subcategory exists but no semantically-correct service can reach it.

| Edit | Owning dossier | Why (what dead-ends today) |
|---|---|---|
| `transmission_testing.concern_categories` **[performance] → +vibration +leak +warning_light +noise** (+ populate empty `example_keywords[]`) | automatic-transmission | Correctly-worded trans shudder (vibration), red ATF puddle (leak), trans-temp/limp light (warning_light), gear/CVT whine + reverse grind (noise) all **cannot reach** `transmission_testing` at Stage-1 today. No fee change. Also fixes manual-trans FM-11/FM-12 leak reach |
| `check_engine_light_testing` **+smoke** | cooling-system **and** fuel-system-evap (both propose it) | Taxonomy line 77 says CEL "owns blue/gray smoke," but DB omits `smoke` → `black_/blue_or_gray_smoke_from_tailpipe` unreachable from CEL; only reachable via coolant/oil leak testing (wrong diagnostics). eval CEL-007 |
| `coolant_leak_testing[_euro]` **+noise** | cooling-system | Water-pump **bearing** noise subcats (`high_pitched_whining_under_the_hood`, `humming_or_whirring_at_speed`) unreachable from any cooling service |
| `oil_pressure_light_testing` **+noise** | engine-lubrication-oil | Knock/tick-led oil-starvation dead-ends — no service reaches engine knock/tick noise |
| `awd_4x4_testing` **+noise** | driveline-cv-diff-awd | The AWD-windup/bind half of the driveline-clunk subcat is genuine AWD work but `awd_4x4_testing` can't reach any `noise` subcat |
| `suspension_steering_check` **+tires** | suspension-ride-alignment | Uneven/cupped wear (the *evidence* alignment diagnoses) lives in `tires`, unreachable from the alignment service → forced through `tire_repair` today |

**Reachability-edit count: 6** (CEL +smoke is proposed by two dossiers — counted once).

> **Note for the taxonomy snapshot** (brakes §8): several brakes subcategories are reachable from
> `brake_inspection` via `concern_subcategories.eligible_testing_service_keys`, **not** via
> `testing_services.concern_categories`. The snapshot doc only documents the `concern_categories` path;
> adding an `eligible_testing_service_keys` column would stop future verifiers from flagging these as
> "unreachable." Engine-mechanical §8 confirms the same: the explicit eligibility list — not
> `concern_categories` — is the true Stage-2 gate. **Verify each Table C edit against
> `eligible_testing_service_keys` before applying** — some "unreachable" claims may already be covered by
> an eligibility link the dossier didn't check.

---

## Conflicts & overlaps to resolve before apply (Phase-C lint)

**Conflict A — three dossiers propose a shift-quality subcategory under `performance`:**
- `harsh_delayed_or_no_shift` (automatic-transmission) — broad: harsh/delayed/no-shift/stuck/pops-out/flare.
- `jerks_or_hard_shifts_between_gears` (ignition-misfire) — essentially a subset of the above (jerk on shift).
- `grinding_or_hard_shift_gears` (manual-trans-clutch) — manual-specific (synchro grind, clutch-won't-release).

  **Recommendation:** adopt **`harsh_delayed_or_no_shift`** as the auto/general shift-quality slug and fold
  the ignition proposal into it; keep the manual `grinding_or_hard_shift_gears` **distinct** (its causes —
  synchro/clutch-drag — differ and drive different questions). Both live under `performance` so
  `transmission_testing` reaches them once Table C lands. Chris decides.

**Conflict B — two dossiers propose the same driveline take-off/shift-clunk subcat under `noise`:**
- `driveline_engagement_clunk_or_bind` (driveline-cv-diff-awd) — includes AWD windup/bind.
- `driveline_clunk_on_shift_or_acceleration` (suspension-ride-alignment) — U-joint/diff/CV/mount.

  **Recommendation:** collapse to **one** slug (the driveline dossier's `driveline_engagement_clunk_or_bind`
  is the superset — it names the AWD-bind half). It pairs with both the `awd_4x4_testing +noise` reachability
  edit (Table C) and the Driveline diagnosis service (Table B).

**Adjacency (NOT a conflict) — two water-inside-cabin subcats:** `water_leaking_inside_the_car` (leak, body
intrusion — rain/car-wash) vs `water_leaking_inside_cabin_ac_on` (hvac, evaporator drain — AC-on). Genuinely
distinct causes/diagnostics; **keep both** but author **sharp mutual negative examples** so "wet passenger
carpet" disambiguates on the *AC-on* vs *rain* cue. Flagged so Wave-C lint doesn't reject the shared phrasing.

**Synthetic-share flags (source-policy cap ~30%):** `security_or_anti_theft_light` (67% synthetic),
`key_or_fob_not_recognized_wont_start` (100% synthetic) both **exceed the cap** and carry a REQUIRED NHTSA
ODI real-voice backlog note before ship. Do not ship these two on synthetic examples alone.

---

## Cross-reference index (dossier §8 → op file)

| Dossier | §8 outcome |
|---|---|
| abs-traction-stability | No NO-FIT; enrichment only (empty `example_keywords`) |
| adas-driver-assist | 1 subcat + 1 service (both fwd-looking) |
| air-induction-forced-induction | 1 subcat + 1 service (or fold into CEL) |
| airbag-srs-restraints | 1 subcat (thin, propose-only) |
| automatic-transmission | 2 subcats + 1 service revision (concern_categories expand) |
| body-electrical-accessories | No new service/subcat; 1 slot gap (FM-8) |
| body-glass-water-leaks-keys | 3 subcats + 2 services |
| brakes-friction-hydraulic | 2 subcats (both thin/propose-only); duplicate-subcat + reachability notes |
| cooling-system | 1 subcat + 2 reachability edits |
| driveline-cv-diff-awd | 1 subcat + 1 reachability edit (awd +noise) |
| engine-controls-driveability | No subcat NO-FIT; keyword + slot gaps only |
| engine-lubrication-oil | 2 services (oil_pressure +noise reachability; oil-change booking) |
| engine-mechanical | No NO-FIT (eligibility list already reaches noise/smoke) |
| exhaust-emissions | 1 service (state inspection) |
| fuel-system-evap | 1 subcat + 1 reachability edit (CEL +smoke) + 1 request-value |
| hvac-climate | 1 subcat (AC evaporator-drain) |
| hybrid-ev-high-voltage | 5 subcats + 1 service |
| ignition-misfire | 1 subcat (shift-jerk — conflict A) |
| lighting-visibility | 1 subcat (exterior_light_out) |
| manual-trans-clutch | 3 subcats + 1 service (trans-leak reach) |
| starting-charging | No new service/subcat; keyword + hedge + slot gaps |
| steering-power-steering | No new subcat; pool complete; one narrow desc revise |
| suspension-ride-alignment | 2 subcats + 1 reachability edit (+tires) + 1 service |
| wheels-tires-tpms-bearings | THE tire-buying service; no new subcat |
