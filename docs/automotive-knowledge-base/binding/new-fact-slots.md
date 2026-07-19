# Consolidated Stage-3 fact-slot changes

> **Phase C consolidation.** Merges every `stage3.slot.propose` and `stage3.slot.value.add` op across
> `systems/*.proposals.yaml` + `routers/*.proposals.yaml` and the "Proposed new slots" sections of
> `binding/required-facts-map.q{1,2,3}.md` into one deduplicated registry. Slots proposed by multiple
> systems for the same semantics are collapsed into ONE shared slot. Bind targets are the live 29-slot
> ontology in `scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts`.
>
> **Rules applied.** A NEW slot must unlock **≥3 existing questions** (methodology §Workstream Q). Value
> additions to the existing 29 slots have no ≥3 gate. **Literalness governs every cue** — a cue only sets
> a slot when the customer *literally states* it; no inference from make/model/year. Contested / duplicate
> proposals are reconciled to a single canonical owner below.
>
> Nothing here is applied. Chris owns the apply/measure/ship step (Phase 5); catalog-contingent and
> policy-changing items are flagged **Chris-gated**.

---

## Table 1 — RECOMMENDED new slots

Each meets the ≥3-question rule across its **merged** question set. Question IDs are existing live
questions with empty `required_facts[]` unless noted.

| # | Slot (canonical) | Type | Enum values | Literal cues (representative) | Questions unlocked (exact) | # | Proposed by / merged from |
|---|---|---|---|---|---|---|---|
| 1 | **`transmission_behavior`** | enum, nullable | `slipping`, `delayed_engagement`, `no_engagement`, `harsh_or_hard_shift`, `shudder_or_judder`, `flaring_between_shifts`, `stuck_in_gear`, `pops_out_of_gear`, `grinds_when_shifting`¹, `shifts_erratically`, `normal` | "trans slips", "engine revs but the car doesn't move", "slams into gear", "shudders when i give it gas", "stuck in gear / limp mode", "pops out of gear", "grinds going into gear"¹, "no reverse" | `995`, `168`, `1183`, `1186` | 4 | **automatic-transmission** (owner) + **manual-trans-clutch** (`clutch_or_gear_engagement`) + **engine-controls-driveability** (`power_delivery_feel`, withdrawn) — **3-way dedup**, see §Dedup A |
| 2 | **`temperature_gauge_state`** | enum, nullable | `normal`, `reading_high_or_hot`, `in_the_red`, `stays_low`, `fluctuating`, `gauge_dead_or_no_reading` | "temp gauge is in the red", "gauge went all the way up", "gauge stays low, never warms up", "gauge fluctuates" (must name the GAUGE/reading — "feels like it's running hot" sets **nothing**) | `399`, `285`, `988`, `303`, `939` | 5 | **cooling-system** (owner) + **hvac-climate** (shares Q939 for `heat_doesnt_work` hedge) |
| 3 | **`coolant_level_state`** | enum, nullable | `normal_or_full`, `low`, `empty_or_bone_dry`, `topping_off_repeatedly`, `unknown` | "coolant reservoir is bone dry", "had to top off coolant twice this week", "keeps needing antifreeze", "lost all my coolant" | `990`, `940`, `229`, `284`, `401` | 5 | **cooling-system** (owner) + **hvac-climate** (shares Q940 for the no-heat hedge) |
| 4 | **`steering_load_effect`** | enum, nullable | `louder_turning_left`, `louder_turning_right`, `no_change_with_steering`, `unsure` | "louder when I turn left", "gets louder curving one way, quieter the other", "changes when I steer", "same no matter how I steer" | `86`, `1480`, `114` | 3 | **wheels-tires-tpms-bearings** (owner) + **driveline-cv-diff-awd** (backlogged as <3, superseded) — the **wheel-bearing steering-load** slot |
| 5 | **`symptom_warmup_trend`** | enum, nullable | `quiets_when_warm`, `worsens_when_warm`, `no_change` | "goes away after it warms up", "quiets down once the engine is warm", "still ticking after fifteen minutes", "gets worse as it heats up" | `76`, `122`, `281`, `282` | 4 | **engine-mechanical** (owner) + **exhaust-emissions** (`warm_up_behavior`, 1-question, folded) + **router-nvh** (uses it as discriminator) — **dedup**, see §Dedup B |
| 6 | **`oil_consumption_state`** | enum, nullable | `adding_frequently`, `topped_off_recently`, `dipstick_low_or_empty`, `not_adding_normal`, `unsure` | "adding a quart every few weeks", "keep having to add oil", "dipstick was empty", "haven't had to add any" | `291`, `327`, `393`, `394` | 4 | **engine-lubrication-oil** |
| 7 | **`fuel_economy_change`** | enum, nullable | `dropped`, `normal_or_better`, `not_mentioned` | "gas mileage tanked", "using more gas than usual", "mpg dropped", "burning through fuel" (do NOT infer from "running rich") | `297`, `1185`, `376`² | 3 | **fuel-system-evap** (owner) + **engine-controls-driveability** (references) |
| 8 | **`ride_damping_symptom`** | enum, nullable, multi-select | `continued_bounce_after_bump`, `nose_dive_under_braking`, `rear_squat_under_accel`, `excessive_body_roll`, `bottoming_out` | "keeps bouncing two or three times after a bump", "front dives down hard when I brake", "leans a lot in corners", "bottoms out over bumps" (NOT a bare "rough ride"/"bouncy") | `703`, `704`, `705`, `169`, `174`, `81` | 6 | **suspension-ride-alignment** |
| 9 | **`pull_road_dependence`** | enum, nullable | `persists_on_flat_ground`, `only_on_certain_roads`, `reverses_with_road_tilt` | "still pulls in a flat empty parking lot", "only pulls on certain roads", "pulls the other way in the other lane" (literal only; not a generic "it pulls") | `1224`, `1225`, `1226`, `1230`, `196` | 5 | **suspension-ride-alignment** |
| 10 | **`noise_rpm_link`** | enum, nullable | `tracks_engine_rpm`, `independent_of_rpm` | "ticking speeds up when I rev", "the whine rises with the engine", "gets louder when I rev it in park" | `72`, `92`, `102` | 3 | **Workstream Q** (q2 triage) — belt/accessory/valvetrain-vs-road-speed discriminator; safe by construction |
| 11 | **`leak_timing`** *(borderline)* | enum, nullable | `after_driving_only`, `also_when_parked_cold`, `unsure` | "only drips after I drive", "fresh drops in the morning after it sits", "puddle even when parked overnight" | `329`, `998`, `999` | 3 | **Workstream Q** (q1 triage) — 3 clean after excluding Q1026 (washer-fluid axis mismatch). Weak-recommend: presence-based yield is modest |

¹ `grinds_when_shifting` is the manual-transmission-specific value folded in from `clutch_or_gear_engagement`; the rest are shared auto/manual semantics.
² Q376 is a compound question already carrying `required_facts=[smoke_color]`; the op ADDs `fuel_economy_change` (both facts must be present to skip).

**Recommended new slots: 11. Total distinct existing questions unlocked: 45.**

---

## Table 2 — RECOMMENDED value-adds to the existing 29 slots

New enum values (or, for the two free-text slots, recognized-value + cue bindings) on slots that already
exist. No ≥3 gate applies.

| Slot | New value | Literal cues | Questions / purpose | Proposed by |
|---|---|---|---|---|
| `engine_running` | `low_power_or_limp` | "no power", "limp mode", "reduced engine power", "won't rev past 3000", "feels weak and dragging" | Engine low-power vs trans-slip discriminator (pairs with `transmission_behavior`) | engine-controls-driveability (referenced by air-induction, trans hedges) |
| `engine_running` | `wont_power_on_no_crank` | "won't go to ready", "won't power on", "pushed the button and nothing", "everything lights up but it won't start" | Hybrid/EV press-start-no-crank; distinct from `wont_crank_just_clicks` / `no_sound_at_all`. Set only on stated EV/hybrid or explicit no-crank press-start | hybrid-ev-high-voltage (owner) + router-no-start-power (consumer) — **dedup**, one copy |
| `noise_descriptor` | `whistling` | "whistling", "high pitched whistle", "whistling on accel", "whistling from the vents" ('whoosh' excluded → `hissing`) | Boost/induction whistle + HVAC vent whistle | air-induction-forced-induction + hvac-climate — **dedup**, one value |
| `noise_descriptor` | `rumbling_or_droning` | "deep rumble", "drone", "sounds like a Harley/muscle car" | Separates RPM/exhaust deep-rumble from `roaring` (kept for speed-linked bearing/tire roar) — fixes the exhaust-vs-bearing conflation | exhaust-emissions |
| `onset_timing` | `on_gear_engagement_or_take_off` | "when i put it in drive", "into reverse", "when i take off from a stop", "backing up" | Driveline backlash clunk vs `over_bumps` suspension clunk (Q82 + proposed driveline subcat) | driveline-cv-diff-awd |
| `onset_timing` | `from_a_stop_pulling_away` | "when i take off from a stop", "pulling away from a light", "when i let the clutch out" | Clutch-engagement chatter timing | manual-trans-clutch |
| `recent_action` | `suspension_lift_or_leveling` | "got my truck leveled", "after my leveling kit", "installed a lift kit" | Ride-height change → ESC/ABS calibration light (Q438); distinct from `alignment` | abs-traction-stability |
| `recent_action` | `windshield_or_glass_replacement` | "after my windshield was replaced", "the glass shop put in new glass" | #1 ADAS calibration trigger; `general_service`/`accident_or_impact` mis-frame it (NEW:adas-q3) | adas-driver-assist |
| `recent_action` | `aftermarket_electrical_install` | "put in a dash cam", "installed a remote starter", "hardwired a dash cam" | Parasitic-draw follow-up (q534) | starting-charging |
| `vehicle_powertrain` | `supercharged` | "supercharged", "supercharger" ('the blower' excluded → HVAC collision) | Complements existing `turbocharged`; forced-induction context | air-induction-forced-induction |
| `customer_request_type` | `emissions_or_smog_check` | "need to pass smog", "failed emissions test", "monitors aren't ready", "need a drive cycle for the retest" | Keeps emissions-readiness requests off drivability slugs (tkc-127, tkc-002) | fuel-system-evap |
| `warning_light_named` *(free-text)* | recognize `"transmission"`, `"transmission temp"` | "transmission light", "trans light", "transmission hot", "AT oil temp" | Cue binding on the free-text slot — no enum change | automatic-transmission |
| `warning_light_named` *(free-text)* | recognize security/immobilizer nicknames | "security light", "theft light", "anti-theft light", "key light", "car with a key symbol" | Cue binding (guidance op) — no enum change | body-glass-water-leaks-keys |
| `accessory_affected` *(free-text)* | recognize exterior-lamp names | "driver headlight", "left taillight", "right turn signal", "blinker", "fog light", "license plate light" | Cue binding — brake-light bulb only when clearly the bulb, not the dash telltale | lighting-visibility |
| `accessory_affected` *(free-text)* | recognize key/lock/entry names | "key fob", "keyless entry", "remote start"³, "power door locks", "trunk release", "alarm", "horn" | Cue binding | body-glass-water-leaks-keys |

³ Keep `remote start` DISTINCT from `key fob` (aftermarket-system risk); do not collapse.

**Also cue-binding-only (no enum change; already-existing values — recorded so Wave-C attaches the cues):**
- `onset_timing=always` ← "all the time even off the brake", "there whether I brake or not" (brakes; literal-continuity only).
- `onset_timing=during_driving` ← "even when I'm not braking", "with my foot off the pedal" (brakes; states off-brake presence, NOT continuity).
- `customer_request_type=just_get_new_tires` ← "quote for 4 new tires", "TIRE REPLACEMENT", "need new rubber on it" (tire-buying gap).

**New enum values across existing slots: 11 (on 6 slots) + 4 free-text cue-binding groups + 3 already-existing-value cue bindings.**

---

## Table 3 — DEFERRED / REJECTED

| Slot idea | Verdict | Reason | Source |
|---|---|---|---|
| **`vibration_felt_location`** (`steering_wheel`/`seat`/`brake_pedal`/`floor`/`whole_car`) | **DEFERRED → router signal, not a mapper key** | Evidence-rich (7 questions: 144,151,167,1478,734,755,691) but every question is **multi-location** ("wheel *or also* seat"). A customer stating one location has NOT stated the others → skipping is a **wrongful skip** (worse than over-asking). Hand to Wave-B `router-nvh` as an NVH×felt-location routing signal. A hard skip would need splitting each multi-select question (catalog change, **Chris-gated**). | required-facts-map.q3 |
| **`battery_age`** | **DEFERRED** | starting-charging counts 3 (528, 537, 877) but q1 triage downgrades to **2 clean** — Q537 is compound (age AND prior-replacement). Below the 3-clean bar; also low presence yield (rarely volunteered). Conflict noted; Chris to weigh the >2yr/>4yr gradient. | starting-charging vs q1 (conflict) |
| **`symptom_constancy`** (`constant`/`intermittent`) | **DEFERRED** | Only 2 confirmed questions (461, 1182); needs ≥3 corroboration. engine-controls uses it only as a PARTIAL note. Promote if the electrical/warning-light/vibration batches confirm ≥3. | q2 + engine-controls |
| **`cabin_filter_age`** | **DEFERRED** | Meets the letter (576, 945, 969) but customers almost never volunteer filter age in a symptom description → near-zero skip yield. | q1 |
| **`accessory_failure_scope`** | **DEFERRED (Chris-gated)** | Meets ≥3 (q1632, q554, + exclusion) but the FM-5/7/8 split is currently inferred from `accessory_affected` count + `onset_timing=intermittent`; author flags it fragile → Chris + Wave-C decide. | body-electrical-accessories |
| **`security_or_key_state`** | **DEFERRED (Chris-gated)** | Contingent — create ONLY if the proposed `key_or_fob_not_recognized_wont_start` subcategory lands. Its 4 questions are proposed, not existing. The security-vs-battery discriminator does not need it (`warning_light_named`+`engine_running`+`lights_state` suffice). | body-glass-water-leaks-keys |
| **`clutch_pedal_feel`** | **DEFERRED (Chris-gated)** | Manual-specific pedal-feel slot; genuinely distinct from the brake-only `pedal_feel`, but its 3 questions are **proposed** (conditional on the `clutch_pedal_or_engagement_feel` subcategory being accepted). No existing-question unlock. | manual-trans-clutch |
| **`driveline_behavior`** | **DEFERRED (Chris-gated)** | **0 existing questions** — fails ≥3 standalone. Valid only after the proposed `driveline_engagement_clunk_or_bind` subcategory + its ≥3 questions are authored. Q82 is answered by `onset_timing=on_gear_engagement_or_take_off` (Table 2), not by this slot. | driveline-cv-diff-awd |
| **`clutch_or_gear_engagement`** | **REJECTED (folded)** | Same shift/engagement semantics as `transmission_behavior` on the exact same IDs (168, 1183, 1186). Merged into canonical `transmission_behavior` (Table 1 #1); manual-only value `grinds_when_shifting` folded in. | manual-trans-clutch |
| **`power_delivery_feel`** | **REJECTED (withdrawn)** | Author withdrew it; collided with `transmission_behavior` and reconciled its hedges/tags to it. | engine-controls-driveability |
| **`warm_up_behavior`** | **REJECTED (folded)** | 1-question (Q76), narrower duplicate of `symptom_warmup_trend`; two candidate values duplicated `onset_timing`. Folded into `symptom_warmup_trend` (Table 1 #5). | exhaust-emissions |
| **`whistling_wind`** (noise value) | **REJECTED (folded)** | Wind/weatherstrip whistle; low corpus volume, author marks LOW PRIORITY. Folded into the single `whistling` `noise_descriptor` value (Table 2). | body-glass-water-leaks-keys |
| **`smoke_persistence_when_warm`** | **REJECTED** | 1 question (Q282). Below bar. | q3 |
| **`tire_damage_zone`** (tread vs sidewall) | **REJECTED** | 1 question (Q711). Repairability-critical but single-question; revisit as a `tire_state` value-list extension if opening-text language grows. | q3 |
| **`fluid_level_dropping`** (generic) | **REJECTED → mapper enhancement** | Would meet ≥3 easily (640, 940, 990, 327, 997, 1006, 1024) and is often volunteered, but the **presence-based** mapper would wrong-skip: a customer topping off *oil* would non-null the slot and skip the *coolant* level question. Needs value-aware matching (see Policy §1) or a per-fluid slot family (too many slots). | q1 |
| `maintenance_recency`, `noise_speed_link` (2q), `temp_gauge_high` (2q)⁴, `fuel_grade`, `fuel_level`, `leak_size`, `vent_noise_change_with_control`, vacuum/booster pedal-test slots | **REJECTED** | Singletons/2-question ideas below bar, pure in-bay tests never in customer text, or null-yield second-round probes. Documented so they are not re-proposed. | q1, q2 |

⁴ `temp_gauge_high` (q109, q481) is subsumed by the recommended `temperature_gauge_state` (Table 1 #2) — those questions can bind to it rather than a new 2-question slot.

---

## Dedup log (how the shared slots were merged)

- **§Dedup A — the revs/shift "power-delivery" cluster (IDs 168, 1183, 1186, +995).** Three dossiers
  proposed competing slots for the same customer semantics ("revs but doesn't move" / shift-behavior):
  `transmission_behavior` (automatic-transmission), `clutch_or_gear_engagement` (manual-trans-clutch),
  `power_delivery_feel` (engine-controls, since withdrawn). Consolidated to **one canonical
  `transmission_behavior`**, owned by automatic-transmission, with the manual-only value
  `grinds_when_shifting` folded in. engine-controls already reconciled its hedges + `required_facts.set`
  ops to it. The distinct **manual pedal-feel** concept (`clutch_pedal_feel`) is NOT merged — it stays a
  separate deferred/Chris-gated slot (Table 3).
- **§Dedup B — warm-up trend.** `symptom_warmup_trend` (engine-mechanical, 4 questions, meets bar) and
  `warm_up_behavior` (exhaust-emissions, 1 question, deferred) are the same concept; router-nvh uses it as
  a manifold-tick-vs-valvetrain discriminator and explicitly notes the alias. Canonical =
  **`symptom_warmup_trend`**.
- **§Shared cooling/HVAC.** `temperature_gauge_state` + `coolant_level_state` are owned by cooling-system
  and shared by hvac-climate (Q939/Q940 power the no-heat-vs-cooling hedge). One copy each.
- **§Shared wheel-bearing.** `steering_load_effect` owned by wheels-tires; driveline had backlogged the
  same steering-load dimension as "<3 questions" (it saw only Q86). wheels-tires supplies the 3rd/4th
  witnesses (Q1480, Q114) and owns the single slot; driveline references the slug.
- **§Shared `whistling`.** air-induction + hvac both add the `whistling` `noise_descriptor` value → one
  value; body-glass `whistling_wind` folded in.
- **§Shared `wont_power_on_no_crank`.** Owned by hybrid-ev; router-no-start-power re-listed it only to name
  its decision-tree branch target. One copy.

---

## Policy-change callouts (Chris-gated)

1. **Value-aware `required_facts` mapper (biggest lever, NOT a slot).** The q1/q2 triage identifies the
   **presence-based mapper** as the structural ceiling: the majority of PARTIAL questions are
   *specific-value* discriminators ("does it ALSO happen when turning?", "constant vs sometimes?") that can
   only skip safely if the mapper checks the *value*, not just presence
   (`required_facts:[{slot:"onset_timing", any_of:["when_turning"]}]`). This unlocks `fluid_level_dropping`
   and converts a large PARTIAL→SAFE fraction across all categories. It is a `question-fact-mapper.ts`
   change — sequence it in Phase 5 **before** mass-tagging.
2. **Catalog-contingent slots.** `driveline_behavior`, `security_or_key_state`, `clutch_pedal_feel`, and
   the manual-question expansion of `transmission_behavior` only reach ≥3 once their proposed **new
   subcategories + questions** are authored. Adding subcategories/questions is a catalog change (Chris-gated
   per methodology Phase 5). Do not add these slots before the questions exist.
3. **`vehicle_powertrain` inference is intentionally forbidden.** The live slot description says "DO NOT
   infer from year/make/model", and the `supercharged` value-add + `wont_power_on_no_crank` both honor
   literalness. If a future optimization wants to auto-skip powertrain questions via a make/model allowlist
   (e.g. infer `electric` for a known-BEV VIN), that is a **policy departure from literalness** and must be
   Chris-approved — it is not proposed here.
4. **Multi-location split for `vibration_felt_location`.** Turning it into a skip-key (rather than a
   router signal) requires splitting each multi-select vibration/tire/steering question into
   single-location confirmations — a catalog change, Chris-gated.

---

## Summary counts (for key_stats)

- **Recommended new slots: 11** (Table 1) — `transmission_behavior`, `temperature_gauge_state`,
  `coolant_level_state`, `steering_load_effect`, `symptom_warmup_trend`, `oil_consumption_state`,
  `fuel_economy_change`, `ride_damping_symptom`, `pull_road_dependence`, `noise_rpm_link`, `leak_timing`.
- **Total distinct existing questions unlocked by the 11 slots: 45.**
- **Recommended value-adds:** 11 new enum values across 6 existing slots + 4 free-text cue-binding groups +
  3 already-existing-value cue bindings (Table 2).
- **Deferred/rejected slot ideas: 18+** (Table 3), including 3 folded dedups, 1 withdrawn, and the
  `fluid_level_dropping` → value-aware-mapper redirect.
- **Cross-system dedups resolved: 6** (§Dedup log).
