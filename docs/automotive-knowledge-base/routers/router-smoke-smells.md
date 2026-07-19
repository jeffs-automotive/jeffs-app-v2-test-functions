# Router: Smoke & smell — cross-system disambiguation dossier
slug: router-smoke-smells   date: 2026-07-18   wave: B (router)
owns_confusable_pairs: [taxonomy#4 white-coolant-vs-blue/gray-oil tailpipe smoke, black-rich-fuel smoke, under-hood smoke/steam, the five "burning" smells, exhaust-fumes-in-cabin]
consumes_dossiers: [engine-mechanical, cooling-system, exhaust-emissions, fuel-system-evap, engine-lubrication-oil, brakes-friction-hydraulic, hvac-climate, body-electrical-accessories]
machine_artifact: binding/smoke-smell-decision-table.md
proposals: routers/router-smoke-smells.proposals.yaml

> A per-system dossier cannot own a cross-system routing decision — a "white vs blue vs black smoke"
> utterance touches cooling, oil, fuel, and CEL at once. This router **owns** the smoke-color/source and
> smell-descriptor decision, consuming the eight Wave A dossiers above (their §5 differentials, §7
> confusable-neighbor tables, and negative-example `routes_to` edges). It is the authoritative reference
> for the charter confusions: **blue/gray (oil) vs white (coolant) vs black (rich) tailpipe smoke;
> under-hood smoke/steam; burning-electrical vs burning-rubber vs sweet vs rotten-egg vs musty smell;
> exhaust-fumes-in-cabin.**
>
> Binds ONLY to slugs/services/fact-slots in `00-current-scheduler-taxonomy.md` (2026-07-18). Diagnostic
> claims inherit their Tier-1/2 cites from the consumed Wave A dossiers (§10); customer-language cues
> carry corpus provenance. The two machine tables live in `binding/smoke-smell-decision-table.md`; this
> file is the human-facing framing, cues, and differential logic.

---

## 1. Scope & boundaries

**In scope** — the routing of any utterance whose **lead symptom is a visible smoke/haze/steam OR a
smell**, across every system that can produce one:

- **Tailpipe smoke by color:** blue/gray (oil), white (coolant), black (rich fuel), thin wispy steam
  (benign cold-morning condensation → reject).
- **Under-hood smoke/steam:** coolant boil-over (steam + overheat) vs oil-on-hot-manifold (burnt-oil,
  often no puddle) vs electrical (acrid).
- **Smoke/smell from a wheel:** dragging brake / left-on parking brake.
- **Smoke/strong smell inside the cabin:** electrical/plastic vs exhaust fumes vs heater-core sweet vs
  vent musty.
- **The smell descriptors:** sweet/maple-syrup (coolant), burnt-oil, gasoline/fuel, rotten-egg/sulfur
  (cat), burning-electrical/plastic, burning-rubber/hot-brake, musty/mildew (evaporator),
  exhaust-fumes-in-cabin.

**Out of scope (routes to, not owned here):**
- The *mechanical* diagnosis behind each smoke/smell — owned by the Wave A system dossier the route
  lands on (e.g. head-gasket confirmation is `cooling-system`; valve-seal-vs-ring split is
  `engine-lubrication-oil`).
- **Noise** without smoke/smell (tick, knock, rattle, whine, roar) → `router-nvh`.
- **Fluid puddles led-with-the-puddle** (color/location of a ground puddle) → `router-leaks`. A puddle
  and a smell can co-occur; when the **smell/smoke leads**, it is ours; when the **puddle leads**, it is
  the leaks router's. Sulfurous **gear/diff oil** is a puddle-led case (`router-leaks`), NOT M4.
- **Named dash warning lights** as the lead (CEL, temp, oil, brake) → `router-warning-lights`. A CEL that
  *accompanies* a smoke/smell keeps the smoke/smell route; a bare light with no smoke/smell is theirs.
- **Routine requests** ("state inspection", "recharge my AC", "oil change") → `router-requests-maintenance`.

---

## 2. Decision tables (the signature deliverable)

The full machine tables — routing target subcategory + customer-voice cues + confusable discriminator
for every row — live in **`binding/smoke-smell-decision-table.md`**. Summary of the two axes:

### TABLE 1 — `smoke_color` + `sound_or_smoke_location_zone` → target

| smoke_color | zone | → subcategory | → service | flips on |
|---|---|---|---|---|
| blue_or_gray | from_tailpipe | `blue_or_gray_smoke_from_tailpipe` | check_engine_light_testing¹ | burnt_oil smell; cold_start(seals) vs load(rings) |
| white | from_tailpipe | `white_smoke_from_tailpipe` | coolant_leak_testing | sweet + persists past warm-up + coolant loss |
| steam_thin_wispy | from_tailpipe | **REJECT (normal)** | — (advisor) | clears <1 min + no smell + cold weather |
| black | from_tailpipe | `black_smoke_from_tailpipe` | check_engine_light_testing¹ | raw-gas smell; mpg drop; diesel-puff caveat |
| white/steam | under_hood | `smoke_from_under_the_hood` | coolant_leak_testing | temp gauge high / coolant loss / hissing |
| blue_or_gray/unclear | under_hood | `smoke_from_under_the_hood` | oil_leak_testing | burnt_oil + no ground puddle |
| any | from_a_wheel | `smoke_or_burning_smell_from_a_wheel` | brake_inspection | from_a_wheel + parking_brake + one wheel hot |
| any | inside_cabin | `smoke_or_strong_smell_inside_the_cabin` | electrical_testing_general² | smell splits it (electrical/exhaust/sweet/musty) |
| unclear | back-of-car + **stopped running** | safety/no-start lead | situational / no_start_testing | did it stop running / won't restart |

¹ Reachability: `check_engine_light_testing.concern_categories` lacks `smoke` — Chris-gated
`catalog.service.concern_category.add` reinforced in proposals (Wave A fuel+cooling filed it). ² Cabin
smell routes by descriptor, see Table 2 M5/M7/M8.

### TABLE 2 — `smell_descriptor` → target

| smell_descriptor | → subcategory | → service | flips on |
|---|---|---|---|
| sweet_or_maple_syrup | `sweet_smell_maple_syrup_antifreeze` / `bad_smell_from_vents` | coolant_leak_testing / ac_performance_check | from_vents+heat = heater core (hvac) vs under_hood (cooling) |
| burnt_oil | `burnt_oil_smell` | oil_leak_testing | under_hood(oil) vs from_a_wheel(brake) vs tailpipe+rotten(exhaust) |
| gasoline_or_fuel | `gasoline_fuel_smell` | check_engine_light_testing | fresh/sharp vs rotten-egg vs smoky-exhaust |
| rotten_egg_or_sulfur | `rotten_egg_sulfur_smell` | exhaust_system_testing | eggy vs raw-gas; gear-oil is puddle-led |
| burning_electrical_or_plastic | `burning_electrical_plastic_smell` / `bad_smell_from_vents` | electrical_testing_general / ac_performance_check | from_vents+fan = blower (hvac) vs not-vent-tied (electrical) |
| burning_rubber_or_hot_brakes | `burning_rubber_hot_brake_smell` / `smoke_or_burning_smell_from_a_wheel` | brake_inspection | from_a_wheel + parking_brake; see-vs-smell |
| musty_or_mildew | `bad_smell_from_vents` / `musty_mildew_smell_from_vents` | ac_performance_check / (smell) | from_vents+AC (hvac) vs carpet/trunk not-vents (smell) |
| exhaust_inside_cabin | `exhaust_fumes_inside_the_cabin` | exhaust_system_testing | smoky-burnt inside, worse on heat/recirc — SAFETY/CO |

---

## 3. Customer-voice cues (linguistic authority — corpus-grounded)

Real Tekmetric fragments (ALL-CAPS preserved) + authored eval voice, mined for this router. Provenance:
`tekmetric` = real corpus id; `eval` = authored eval-cases.json (synthetic-class); `forum-paraphrase`.

**Tailpipe color (unambiguous when color + smell both stated):**
- blue/gray: "puff of blue smoke out the tailpipe when i first start it in the morning, smells like
  burning oil" (eval); "Blueish gray smoke puffs out the tailpipe when I take off from a light" (eval).
- white: "Thick white smoke pouring out of my tailpipe even after driving 20 min" (eval); "smells like
  maple syrup under the hood and the coolant tank keeps getting low" (eval).
- black: "my truck started blowing black smoke" (eval); "black smoke when i stomp on the gas and it
  smells like raw gas" (eval).
- benign steam (REJECT): "little white steam on cold mornings that goes away" (forum-paraphrase).

**Under-hood smoke — customer rarely names a color, leads with smell/place:**
- "Smoke coming out from under the hood and the temp gauge went all the way into the red" (eval) → coolant.
- "Theres gray smoke coming up from under the hood and it smells like burning oil" (eval) → oil.
- "CLIENT SAW SMOKE COMING FROM THE GRILLE" (tekmetric); "Smoke coming from engine and exhaust" (tekmetric).
- "There is a burning smell coming from my engine" (tekmetric) — **`needs-fact:smell_descriptor`**.

**Bare "burning smell" (very common → clarify, never a confident pick):**
- "CHECK FOR BURNING SMELL" (tekmetric); "CLIENT IS SMELLING A BURNING SMELL. ALSO SEEING OIL ON THE
  GROUND" (tekmetric) — the oil-on-ground pushes toward burnt_oil but the smell alone is unset.

**Descriptor-led smells:**
- sweet: "somethin smells like maple syrup around my car after i drive it" (eval).
- burnt-oil: "been noticing kind of a burnt oil smell from my car lately" (eval); "greasy burning oil
  smell from under the hood after long drives, no drips on the ground" (eval).
- rotten-egg: "smells like rotten eggs from the exhaust" (forum-paraphrase).
- burning-plastic/electrical: "Sharp burning plastic smell coming from behind the dash" (eval); "TOW IN
  … SMELLED BURNING SMELL BY FUSE BOX" (tekmetric).
- burning-rubber/hot-brake: "Theres smoke coming off my rear right wheel. I think i mightve left the
  parking brake on" (eval).
- musty: "every time i first turn the AC on theres a nasty musty smell like dirty gym socks from the
  vents" (eval); "BURNING SMELL WHEN TURNING ON THE A/C" (tekmetric — vent-tied, blower).
- exhaust-in-cabin: "theres an exhaust smell inside my car and its alot worse when the heater is
  running" (eval); "EXHAUST SMELL COMING THROUGH THE HEATER AFTER IT IS WARMED UP AND AT IDLE. HEAT
  NEEDS TO BE ON" (tekmetric).

**Safety-led (smoke + stopped running):**
- "TOW IN GOT GAS IN NJ … NOW WILL NOT START. SAW SMOKE UNDER HOOD. SMELLED BURNING SMELL BY FUSE BOX"
  (tekmetric); "WAS DRIVING AND STOPPED RUNNING. SAW SMOKE TOWARDS BACK OF CAR" (tekmetric) → route on
  the no-start/safety lead, NOT a smoke-color subcategory.

**Messiness preserved:** "freon" for refrigerant, "mildew order" for odor, part-name guesses ("might be
the alignment" for an exhaust rumble — not a smoke case but same misattribution habit), ALL-CAPS
fragments, and mixed symptom+request ("... PERF CHECK AUTH").

---

## 4. Differential logic (the load-bearing discriminators)

**A. Tailpipe smoke = color × smell, in that order of reliability.** Color alone is not enough (a
customer's "gray" can be oil-blue or benign steam). The **smell** is the tiebreaker:
`burnt_oil`→blue/oil, `sweet_or_maple_syrup`→white/coolant, `gasoline_or_fuel`→black/rich, no
smell + clears fast + cold → benign steam (reject). Then the **sub-split within blue** is `onset_timing`:
`cold_start` puff-that-clears = valve seals; `when_accelerating`/`always` = rings (engine-lubrication-oil
§5, engine-mechanical §5).

**B. Under-hood smoke resolves on smell + temperature, not color.** Customers seldom name a color under
the hood. Sweet + temp-gauge-high/coolant-loss/hissing → coolant boil-over (S5). Burnt-oil + no ground
puddle + worse after a long drive → oil on the manifold (S6). Acrid plastic → electrical (S8). The
`temperature_gauge_state` slot (cooling-proposed) is what makes the coolant split skippable.

**C. The five "burning" smells." A bare "burning smell" is `needs-fact:smell_descriptor` — the single
most important clarify in this router. The descriptor + location fan out to five different services
(oil / electrical / brake / exhaust / +coolant-sweet). See the master split in the binding table.

**D. Location is the second axis for cabin & vent smells.** `from_vents` + an HVAC mode pulls musty
(evaporator), sweet (heater core), and burning-electrical (blower) into `ac_performance_check`; the same
descriptors NOT vent-tied route to their own systems (`smell/musty_mildew…`,
`sweet_smell_maple_syrup_antifreeze`, `burning_electrical_plastic_smell`). `exhaust_inside_cabin` stays
exhaust regardless of the vents.

**E. See-vs-smell for a wheel.** Visible smoke/haze from a wheel → `smoke_or_burning_smell_from_a_wheel`
(smoke slug); smell only → `burning_rubber_hot_brake_smell` (smell slug). Both → `brake_inspection`.

**F. Safety overrides color.** When the lead is "it stopped running / won't restart / smoke then it
died", route on the **safety/no-start** lead (`safety_concern_dont_feel_safe_driving_it` or
`no_start_testing`), never a smoke-color subcategory. Exhaust-fumes-in-cabin (M8) is also safety-critical
(CO is odorless; an exhaust smell in the cabin means the CO path is open) — flag, don't downgrade.

**G. Literalness (safety-critical).** Steam ≠ smoke: "wispy vapor on a cold morning that clears" must NOT
be upgraded to `smoke_color=white` or "head gasket." A color the customer never named is never asserted.
"Burning smell" sets nothing in `smell_descriptor`. "Grinding when I brake" is not a smell case at all.

---

## 5. Confusable pairs owned (see proposals `confusable_matrix_rows`)

This router owns the machine `confusable_matrix_rows` for: white↔blue/gray tailpipe (coolant vs oil);
blue/gray↔black (oil vs rich); white↔black; white-smoke↔benign-steam (reject); under-hood coolant↔oil;
burning-electrical↔burning-rubber; burning-electrical↔burnt-oil; sweet↔burnt-oil; rotten-egg↔gasoline;
rotten-egg↔burnt-oil; burnt-oil↔burning-rubber; musty-vent↔musty-carpet; exhaust-in-cabin↔gasoline;
exhaust-in-cabin↔musty; exhaust-in-cabin↔sweet(heater-core); wheel-smoke↔wheel-smell-only. Each row
carries a discriminating fact, one discriminating question, a hedge rule, and A/B example utterances.

---

## 6. Sources

**Diagnostic authority (inherited from the consumed Wave A dossiers — cites live there, not re-derived):**
- `cooling-system` (white smoke, under-hood steam, sweet smell, benign cold-steam reject; ASE A1,
  Halderman, Gates TechZone).
- `engine-lubrication-oil` + `engine-mechanical` (blue/gray tailpipe, oil-on-manifold under-hood smoke,
  burnt-oil smell, valve-seal-vs-ring split; Halderman, SAE J2012).
- `fuel-system-evap` (black/rich smoke, gasoline smell, diesel-puff caveat; SAE J2012, Bosch, Halderman).
- `exhaust-emissions` (rotten-egg/H₂S, exhaust-fumes-in-cabin/CO safety; SAE J2012, Bosch, Halderman,
  Identifix, Cleveland Clinic).
- `brakes-friction-hydraulic` (burning-rubber/hot-brake, smoke-from-a-wheel; Bosch, Halderman).
- `hvac-climate` (musty evaporator, heater-core sweet, blower burning-electrical; ASE A7, Halderman, MACS).
- `body-electrical-accessories` (burning-electrical/plastic, cabin smoke; Tier-3 corroborated).

**Linguistic authority (never cited for diagnosis):** `real-concerns-tekmetric-labeled-v2.json` (real
ids quoted inline in §3), `eval-cases.json` (authored → synthetic-class), `real-concerns-forums.json`
(paraphrased). Verified by grep against the corpus this pass (2026-07-18).

---

## 7. Binding-readiness self-check

- [x] Binds ONLY to snapshot slugs/services/slots; every proposal isolated in the proposals file.
- [x] Two decision tables emitted in machine form (`binding/smoke-smell-decision-table.md`) with target
  subcategory + customer-voice cues + confusable discriminator per row.
- [x] Every charter confusion covered: blue/white/black tailpipe, under-hood, the 5 burning smells,
  exhaust-in-cabin.
- [x] Every `stage2.example.negative.add` names a valid `routes_to` (subcategory slug, or service key
  where the target is direct-to-service).
- [x] `stage1.hedge.add` ops name real Stage-1 service keys + a discriminating fact.
- [x] `confusable_matrix_rows` emitted for every owned pair with discriminating_fact + question +
  hedge_rule + A/B examples.
- [x] Literalness enforced: steam≠smoke reject case; bare "burning smell" = needs-fact; no color/location
  asserted unless stated; inference-trap golden cases included.
- [x] Reachability gap (CEL lacks `smoke`) reinforced as a Chris-gated catalog op, cross-referenced to
  the Wave A fuel + cooling dossiers (no duplicate — single consolidated op, marked reinforcing).
- [x] Synthetic/eval share honest: several smoke slugs (white/black/blue tailpipe, gasoline smell) have a
  real-voice corpus gap (Wave A flagged it); router cues lean on eval voice there and flag it for Wave-C
  NHTSA sourcing.
