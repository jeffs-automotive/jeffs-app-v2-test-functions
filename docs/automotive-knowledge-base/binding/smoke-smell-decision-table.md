# Smoke & smell decision tables (binding artifact)

> Owner: `routers/router-smoke-smells.md` (Wave B cross-system router). This is the machine-facing
> disambiguation reference for every **smoke-color / source** and **smell-descriptor** utterance.
> Binds ONLY to slugs/services/fact-slots that exist in `00-current-scheduler-taxonomy.md` (2026-07-18
> snapshot). Anything not in the snapshot is flagged as a proposal in
> `routers/router-smoke-smells.proposals.yaml`, never assumed.
>
> **How to read a route:** `smoke_color`/`smell_descriptor` + `sound_or_smoke_location_zone` are the
> primary keys; the **discriminator** column names the ONE fact that flips the route when the primary
> key is shared. LITERALNESS governs every cue: a fact is set only when the customer *literally* states
> it. "Burning smell" with no descriptor sets NOTHING in `smell_descriptor` → it stays a
> `needs-fact:smell_descriptor` clarify, never a confident pick. Steam ≠ smoke; a color the customer
> never named is never asserted.
>
> **Reachability caveat (verified against the snapshot, carried from Wave A):** the two tailpipe smoke
> slugs the taxonomy assigns to `check_engine_light_testing` — `black_smoke_from_tailpipe` (rich fuel)
> and `blue_or_gray_smoke_from_tailpipe` (oil burn) — sit in the `smoke` concern category, but
> `check_engine_light_testing.concern_categories = [warning_light, performance]` does **not** include
> `smoke`. Wave A (`fuel-system-evap` §8, `cooling-system` §8) filed a Chris-gated
> `catalog.service.concern_category.add {service: check_engine_light_testing, add: smoke}`. This router
> **reinforces** that op (see proposals `catalog` section) — until it lands, black/blue tailpipe smoke
> is only reachable through `oil_leak_testing` / `coolant_leak_testing`, which are the wrong diagnostics
> for rich-fuel black smoke. Engine-mechanical §8 notes CEL reaches the smoke slugs via each
> subcategory's `eligible_testing_service_keys`; the `concern_categories` add makes that explicit.

---

## Fact-slot vocabulary used by these tables

- `smoke_color`: `white`, `blue_or_gray`, `black`, `steam_thin_wispy` (benign vapor), plus the
  color-unclear reality of under-hood smoke (customer often can't name a color).
- `smell_descriptor`: `sweet_or_maple_syrup`, `burnt_oil`, `gasoline_or_fuel`, `rotten_egg_or_sulfur`,
  `burning_electrical_or_plastic`, `burning_rubber_or_hot_brakes`, `musty_or_mildew`,
  `exhaust_inside_cabin`.
- `sound_or_smoke_location_zone`: `from_tailpipe`, `under_hood`, `under_car`, `from_vents`,
  `from_a_wheel`, `behind_dashboard`, `passenger_footwell`, `inside_cabin_general`.
- modifiers: `onset_timing` (`cold_start`, `after_warming_up`, `when_accelerating`, `when_idling`,
  `always`), `hvac_mode` (`heat`, `ac`), `warning_light_named`/`warning_light_behavior`,
  `recent_action` (`fuel_fill_up`, `ac_recharge_or_service`, `brake_work`), `parking_brake_state`.

---

## TABLE 1 — smoke_color + location → system / service / subcategory

| # | smoke_color | location (zone) | Routing target (subcategory → service) | Customer-voice cues | Confusable discriminator (the ONE fact that flips it) |
|---|---|---|---|---|---|
| S1 | `blue_or_gray` | `from_tailpipe` | `blue_or_gray_smoke_from_tailpipe` → `check_engine_light_testing` (oil burn) | "puff of blue smoke out the tailpipe when i first start it, smells like burning oil"; "blueish gray smoke when I take off from a light"; "burns oil, adding a quart every few weeks" | `smell_descriptor=burnt_oil` (oily) vs `sweet_or_maple_syrup` (→ white/coolant) vs `gasoline_or_fuel` (→ black/rich). Sub-split: `onset_timing=cold_start` (valve seals, puff-then-clears) vs `when_accelerating`/`always` (rings, under load) — engine-lubrication-oil §5 |
| S2 | `white` | `from_tailpipe` | `white_smoke_from_tailpipe` → `coolant_leak_testing` (head gasket / coolant in combustion) | "thick white smoke pouring out my tailpipe even after driving 20 min, smells kinda sweet"; "coolant tank keeps getting low, white smoke" | **Persistence + sweet smell + coolant loss.** `smell_descriptor=sweet_or_maple_syrup` + does NOT clear after warm-up. vs S3 (clears in a minute, no smell = benign steam) vs S1 (oily) |
| S3 | `steam_thin_wispy` | `from_tailpipe` | **REJECT / advisor** (normal cold-morning condensation — NOT a fault; empty Stage-1) | "little white steam on cold mornings that goes away"; "puff of vapor when its cold out, clears right up" | **Clears within ~1 min + no smell + cold weather.** `weather_condition=cold_weather` + `onset_timing=cold_start` + no coolant loss. The extractor must NOT upgrade this to `smoke_color=white` or assert head gasket (inference trap — cooling-system §3.8) |
| S4 | `black` | `from_tailpipe` | `black_smoke_from_tailpipe` → `check_engine_light_testing` (running rich) | "my truck started blowing black smoke"; "black smoke when i stomp on the gas and it smells like raw gas"; "fuel mileage tanked and theres black smoke from the back" | `smoke_color=black` + `smell_descriptor=gasoline_or_fuel` (raw gas) vs `burnt_oil` (→ blue) vs `sweet` (→ white). Diesel caveat: a small puff only `when_accelerating` on a `vehicle_powertrain=diesel` is often normal — fuel-system-evap §5 |
| S5 | `white`/`steam_thin_wispy` | `under_hood` | `smoke_from_under_the_hood` → `coolant_leak_testing` (overheat / boil-over) | "smoke coming out from under the hood and the temp gauge went all the way into the red"; "hissing sound and steam from under my hood"; "smoke under hood, coolant overheating message" | **Temp gauge high / coolant loss / hissing.** proposed `temperature_gauge_state=in_the_red` (cooling-owned) + steam + sweet. vs S6 (oily smell, no overheat) |
| S6 | `blue_or_gray`/color-unclear | `under_hood` | `smoke_from_under_the_hood` → `oil_leak_testing` (oil dripping onto hot manifold) | "theres gray smoke coming up from under the hood and it smells like burning oil"; "wisps of smoke at idle, oil pooling under the exhaust manifold, no drips on the ground"; "smoke coming from the grille, burns a lot of oil" | `smell_descriptor=burnt_oil` + often NO ground puddle + worse `after_warming_up`/after a long drive. vs S5 (sweet + temp-gauge/coolant) vs electrical (acrid plastic → S8) |
| S7 | any / color-unclear | `from_a_wheel` | `smoke_or_burning_smell_from_a_wheel` → `brake_inspection` (dragging brake / parking brake) | "theres smoke coming off my rear right wheel, i think i left the parking brake on"; "smoke and burning smell from one wheel after a long downhill" | `sound_or_smoke_location_zone=from_a_wheel` + `smell_descriptor=burning_rubber_or_hot_brakes` + `parking_brake_state=engaged_or_partially_engaged`; one wheel much hotter. vs under-hood (belt/oil) |
| S8 | any / color-unclear | `inside_cabin_general` / `behind_dashboard` / `passenger_footwell` | `smoke_or_strong_smell_inside_the_cabin` → `electrical_testing_general` (wiring/plastic) **UNLESS** smell splits it (see discriminator) | "smoke coming from behind the dash"; "sharp burning plastic smell and a little haze inside the car" | **The smell splits the cabin:** `burning_electrical_or_plastic` acrid → this slug / `electrical_testing_general`; `exhaust_inside_cabin` smoky-burnt → `exhaust_fumes_inside_the_cabin` / `exhaust_system_testing`; `sweet_or_maple_syrup` through vents on heat → heater core (`bad_smell_from_vents` / `ac_performance_check`); `musty_or_mildew` → `musty_mildew_smell_from_vents` |
| S9 | color-unclear | `under_car` / "toward the back" while driving, esp. car **stopped running / won't restart** | **SAFETY-led → situational** `safety_concern_dont_feel_safe_driving_it` (or `no_start_testing` if cranks-no-fire) — `needs-fact:sound_or_smoke_location_zone` | "was driving and it stopped running, saw smoke towards the back of the car"; "smoke under hood then it died, smelled burning by the fuse box" | Lead is a **drivability/safety event**, not a color report. Do NOT force a smoke-color subcategory; route on the safety/no-start lead. Discriminator: did it **stop running / won't restart** (→ safety/no-start) vs a steady visible smoke with the car running (→ S5/S6/S8) |

**Under-hood color-unclear rule.** Customers rarely name a color for under-hood smoke. Resolve on
**smell + temp**: sweet + temp-gauge-high/coolant-loss → S5 (coolant); burnt-oil, no overheat → S6
(oil); acrid plastic → S8 (electrical). Absent any of those, it is `needs-fact:smell_descriptor` (and
`temperature_gauge_state` once that slot lands), not a guess.

---

## TABLE 2 — smell_descriptor → system / service / subcategory

| # | smell_descriptor | Routing target (subcategory → service) | Customer-voice cues | Confusable discriminator (the ONE fact that flips it) |
|---|---|---|---|---|
| M1 | `sweet_or_maple_syrup` | `sweet_smell_maple_syrup_antifreeze` → `coolant_leak_testing` **|** if **through the vents with heat on** → `bad_smell_from_vents` → `ac_performance_check` (leaking heater core) | "somethin smells like maple syrup around my car"; "smells like maple syrup under the hood and the coolant tank keeps getting low"; "sweet smell from my vents when I turn on the heat + foggy glass" | `sound_or_smoke_location_zone=from_vents` + `hvac_mode=heat` (→ heater core / hvac) vs `under_hood`/`under_car` (→ cooling). vs `burnt_oil` (greasy, not sweet → M2) |
| M2 | `burnt_oil` | `burnt_oil_smell` → `oil_leak_testing` (oil on hot metal) | "been noticing a burnt oil smell from my car lately"; "greasy burning oil smell from under the hood after long drives, no drips on the ground"; "smell burnt oil when i stop at lights" | `sound_or_smoke_location_zone=under_hood` (oil) vs `from_a_wheel` (→ M6 hot brake) vs `from_tailpipe`+rotten (→ M4). vs `burning_electrical_or_plastic` (acrid, not greasy → M5) |
| M3 | `gasoline_or_fuel` | `gasoline_fuel_smell` → `check_engine_light_testing` (via smell) — fuel/EVAP leak | "i smell gas inside my car when im driving"; "whole garage smells like gasoline when i park"; "gas fumes when i start it cold" | **Fresh/sharp pump smell** vs `rotten_egg_or_sulfur` (eggy/sewer → M4) vs `exhaust_inside_cabin` (smoky-burnt → M8). Often `recent_action=fuel_fill_up`. Raw gas = unburned; exhaust = burnt |
| M4 | `rotten_egg_or_sulfur` | `rotten_egg_sulfur_smell` → `exhaust_system_testing` (catalytic-converter H₂S) | "smells like rotten eggs from the exhaust"; "sulfur/sewer smell under acceleration, worse after warm-up" | `smell_descriptor=rotten_egg_or_sulfur` vs `gasoline_or_fuel` (raw gas → M3). NOTE gear/diff oil is also sulfurous — but that is **puddle-led** (`thick_dark_brown_puddle_gear_or_differential_oil`), not smell-led |
| M5 | `burning_electrical_or_plastic` | `burning_electrical_plastic_smell` → `electrical_testing_general` **|** if **through the vents with the fan on** → `bad_smell_from_vents` → `ac_performance_check` (blower motor/resistor) | "sharp burning plastic smell coming from behind the dash"; "burning electrical smell like hot wires"; "burning smell when i turn on the A/C" (blower) | **Acrid/sharp** (not greasy). `sound_or_smoke_location_zone=from_vents` + fan/`hvac_mode` set → blower (hvac) vs `behind_dashboard`/`inside_cabin_general` not vent-tied → electrical. vs `burnt_oil` greasy (→ M2), vs `burning_rubber` (→ M6) |
| M6 | `burning_rubber_or_hot_brakes` | `burning_rubber_hot_brake_smell` → `brake_inspection` (dragging brake / parking brake); if visible haze → `smoke_or_burning_smell_from_a_wheel` | "burning rubber smell from one of my wheels after i drove down a hill"; "hot brake smell, i think i left the e-brake on" | `sound_or_smoke_location_zone=from_a_wheel` + `parking_brake_state` (→ brake) vs `under_hood` (belt slip / oil → M2). SEE-vs-SMELL: visible smoke → `smoke_or_burning_smell_from_a_wheel`; smell only → `burning_rubber_hot_brake_smell` |
| M7 | `musty_or_mildew` | **vent-tied** → `bad_smell_from_vents` → `ac_performance_check` (evaporator microbial) **|** **carpet/trunk, NOT through vents** → `musty_mildew_smell_from_vents` (`smell`) | "nasty musty smell like dirty gym socks from the vents when i first turn the AC on"; "mildew smell, goes away when i turn AC off recirc"; "musty smell from the back seat carpet when it rains" (→ smell/musty) | `sound_or_smoke_location_zone=from_vents` + `hvac_mode=ac` + `onset_timing=at_first_turn_on` (→ hvac) vs `inside_cabin_general` from carpet/trunk not vents (→ smell/musty). Wet carpet + electronics acting up → water-intrusion (`body-glass-water-leaks-keys`) |
| M8 | `exhaust_inside_cabin` | `exhaust_fumes_inside_the_cabin` → `exhaust_system_testing` — **SAFETY / CO** | "theres an exhaust smell inside my car, worse when the heater is running"; "EXHAUST SMELL COMING THROUGH THE HEATER AFTER IT IS WARMED UP AND AT IDLE" | **Smoky/burnt tailpipe smell inside**, worse `hvac_mode=heat`/recirculate, at idle, `after_warming_up`. vs `gasoline_or_fuel` (fresh raw gas → M3) vs `sweet` (heater core → M1) vs `musty` (mold → M7). CO is odorless — an exhaust smell in the cabin means the CO path is open; treat as safety-critical |

**The five "burning" smells — the master split (M2/M4/M5/M6/M8 + sweet M1).** When a customer just says
"burning smell" (very common — corpus: "There is a burning smell coming from my engine", "CHECK FOR
BURNING SMELL"), `smell_descriptor` is **unset** → `needs-fact:smell_descriptor`, and the ONE clarify
question is *"what does it smell like and where is it coming from?"*:
- **greasy / hot-oil, under the hood** → `burnt_oil` → M2 (oil_leak_testing)
- **sharp / acrid / melting-plastic** → `burning_electrical_or_plastic` → M5 (electrical, or hvac blower if vents)
- **rubbery / hot-brake, from a wheel** → `burning_rubber_or_hot_brakes` → M6 (brake_inspection)
- **rotten-egg / sulfur, from the exhaust** → `rotten_egg_or_sulfur` → M4 (exhaust_system_testing)
- **smoky exhaust fumes inside the cabin** → `exhaust_inside_cabin` → M8 (exhaust, SAFETY)
- **sweet / maple-syrup** (not a "burning" smell but co-confused) → `sweet_or_maple_syrup` → M1 (coolant/heater core)

**Location is the second axis for cabin/vent smells.** `from_vents` + an HVAC mode set pulls musty
(M7), sweet (M1 heater core), and burning-electrical (M5 blower) into the **HVAC** service; the same
smells NOT vent-tied route to their own systems. `exhaust_inside_cabin` (M8) stays exhaust regardless of
vents — the vent path is just where the customer notices it.
