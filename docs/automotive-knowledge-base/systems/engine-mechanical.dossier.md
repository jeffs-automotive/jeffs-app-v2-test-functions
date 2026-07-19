# Engine mechanical (internal) — diagnostic dossier
slug: engine-mechanical   date: 2026-07-18   binds_services: [check_engine_light_testing, oil_pressure_light_testing, exhaust_system_testing, oil_leak_testing, coolant_leak_testing]   binds_categories: [noise, smoke, smell, performance]

> System: internal reciprocating assembly + valvetrain + sealing surfaces — compression, cam/crank
> timing, valvetrain (lifter/lash/rocker), rod & main bearings, oil control (rings/seals), head-gasket
> integrity. This dossier is the source→symptom crosswalk for **engine-internal-mechanical** noise,
> smoke, smell, and drivability, and terminates every finding in a typed op in
> `engine-mechanical.proposals.yaml`.
>
> **Binding ground truth:** service→subcategory eligibility is verified against
> `scheduler-app/scripts/eval/catalog-snapshot.json` (2026-07-03), NOT inferred from a service's
> `concern_categories`. In this catalog a service reaches a subcategory because that subcategory lists
> the service in `eligible_testing_service_keys` — those links routinely CROSS concern categories.

---

## 1. Scope & boundaries

**In scope (engine-internal mechanical):**
- Valvetrain noise (hydraulic-lifter tick, lash/rocker tap, cam-follower tap) → `noise/engine_ticking_or_tapping`
- Timing-chain / tensioner cold rattle (stretched chain, low tensioner oil pressure) → `noise/engine_ticking_or_tapping` (§3.9)
- Bottom-end knock (connecting-rod-bearing "rod knock", main-bearing knock, piston slap) → `noise/deep_knocking_from_the_engine`
- Oil entering combustion (worn valve-stem seals, worn rings/cylinder, turbo shaft seal) → `smoke/blue_or_gray_smoke_from_tailpipe`
- Coolant entering combustion (head gasket / cracked head / intake gasket) → `smoke/white_smoke_from_tailpipe`
- External oil weeping onto hot metal (valve-cover / cam-cover / pan-rail gasket burning off) → `smell/burnt_oil_smell`
- Compression-loss / mechanical misfire (bent valve, low compression, VVT phaser fault) → `performance/engine_misfire_or_bucking_feeling` (boundary — see §7)

**Out of scope (route to the named neighbor):**
- Exhaust-manifold-gasket tick (a leak that quiets when warm) → `noise/exhaust_manifold_tick_or_puff` (this dossier OWNS the discriminator vs valvetrain tick — §5/§7).
- Exhaust drone / cat rattle / louder exhaust → `noise/exhaust_louder_or_rumbling`, `noise/rattling_underneath_the_car` (router-nvh / exhaust system).
- Spark knock / detonation-pinging under load on low-octane fuel → no dedicated Stage-2 home; the mechanical bench resolves it and the fuel-grade question (Q123) lives here to aid that call — see §7 and §9.
- Ignition/fuel-caused misfire (bad coil, plug, injector, fuel trim) → `performance/engine_misfire_or_bucking_feeling` owned jointly with the fuel/ignition dossier; this dossier claims only the *mechanical* subset.
- Oil **puddle on the ground** led-with-the-puddle → `leak/brown_or_black_puddle_engine_oil` (router-leaks).
- Coolant **puddle / sweet smell / overheating** led-with-that → `leak/green_orange_yellow_or_pink_puddle_coolant`, `smell/sweet_smell_maple_syrup_antifreeze`, `warning_light/engine_temperature_light` (coolant-cooling dossier).
- Timing-belt/chain **service request** or belt squeal → belt/accessory-drive dossier (`noise/high_pitched_whining_under_the_hood` for whine). NOTE: a *symptomatic* cold chain rattle stays in scope (§3.9); only a maintenance **service request** for the belt/chain leaves.
- CV-joint click when turning → `noise/popping_or_clicking_when_turning` (driveline).

---

## 2. System primer (expert, CITED)

The internal combustion engine converts fuel energy to crankshaft rotation through a reciprocating
assembly (pistons, connecting rods, crankshaft on plain hydrodynamic bearings) sealed by piston rings
against the cylinder wall, with a valvetrain (camshaft(s) driving valves via lifters/tappets, and on
OHV engines pushrods + rocker arms) that times intake and exhaust events to crank rotation via a timing
belt or chain [Halderman, *Automotive Engine Repair & Rebuilding*, Pearson, Tier 2; SAE J1930 terminology, Tier 1].

Load-bearing sub-systems for symptom diagnosis:
- **Bearings are pressure-fed and clearance-critical.** Rod and main bearings ride on a hydrodynamic oil
  film; the design clearance is on the order of thousandths of an inch. Wear or oil starvation collapses
  the film and lets the rod hammer the journal — the classic **rod knock** [Halderman, *Engine Repair &
  Rebuilding*, Tier 2].
- **Hydraulic lifters use oil pressure to zero out valve lash.** Low/aerated/dirty oil, a stuck lifter,
  or excess lash lets a valvetrain component tap — the **lifter/valvetrain tick**, at the top of the
  engine, tied to **camshaft speed (½ crank RPM)** [Halderman, *Automotive Engine Performance*, Tier 2].
- **Rings + valve-stem seals control oil.** Worn valve-stem seals leak oil down the valve guides while
  the engine sits, producing a **blue puff on cold startup** that clears; worn compression/oil-control
  rings (or cylinder-wall wear) let oil past on every stroke, producing **blue smoke under load / all the
  time** plus measurable oil consumption and crankcase blow-by [Halderman, *Engine Repair & Rebuilding*, Tier 2].
- **Turbocharged engines add a third oil-in-exhaust path:** a failing turbo center-section seal passes
  oil into the intake/exhaust, blue smoke under boost or on decel, often with a bearing whine
  [Halderman, *Automotive Engine Performance* (forced induction), Tier 2].
- **The head gasket seals combustion, oil, and coolant between block and head.** A breach to a coolant
  jacket lets coolant burn in the cylinder → **persistent white, sweet-smelling smoke**, dropping coolant,
  and often overheating or milky oil [Halderman, *Engine Repair & Rebuilding*, Tier 2].
- **Notable variants (US corpus mix):** OHV pushrod V8s (GM LS, Chrysler HEMI — the "HEMI tick" is a
  known cold-start valvetrain/exhaust-manifold overlap), OHC I4/V6 with hydraulic lash adjusters, and
  turbo-GDI 4-cylinders (elevated oil-consumption + carbon-related mechanical misfire) dominate; diesel
  and EV are rare in this shop's corpus and get light treatment per the style guide.

Distinguishing the **failure family from sound + condition alone** is the whole diagnostic game, and it
maps cleanly onto the classifier's fact slots (§3/§9).

---

## 3. Failure-mode catalog (the diagnostic spine, CITED per mode)

### 3.1 Hydraulic-lifter / valvetrain tick
- Sensory: `noise_descriptor=ticking_or_tapping`; light, fast, "sewing machine / typewriter", from the
  **top** of the engine, rate tracks RPM.
- Conditions: often loudest at `onset_timing=cold_start` and/or `when_idling`; **may quiet a little but
  usually never fully disappears** as oil pressure builds; unchanged by cutting spark to a cylinder.
- Severity: usually `drivable_but_concerned` early (low-oil-pressure lifter tick can precede worse wear).
- Misattribution: customers call any engine tap "the lifters" or "needs an oil change"; some confuse it
  with an exhaust-manifold tick (the true discriminator is warm-up behavior — §5).
- Source: [Halderman, *Automotive Engine Performance*, Tier 2].

### 3.2 Connecting-rod-bearing knock (rod knock) / main-bearing knock / piston slap
- Sensory: `noise_descriptor=knocking_deep`; deep, heavy, rhythmic "hammer / banging from inside", from
  the **lower block**.
- Conditions: `onset_timing=when_accelerating` (louder under load / uphill); rod knock often **lessens
  when the offending cylinder's spark is cut**; frequently paired with `warning_light_named=oil pressure`.
  Piston slap is a cold knock that fades as pistons expand.
- Severity: `not_drivable_needs_tow` / `drivable_but_concerned` — do-not-drive; can grenade the engine.
- Misattribution: customers say "transmission" or "it's knocking, needs a tune-up"; some confuse a
  bottom-end knock with a suspension clunk (the discriminator is load- vs bump-triggered — §5).
- Source: [Halderman, *Automotive Engine Repair & Rebuilding*, Tier 2].

### 3.3 Oil past valve-stem seals → blue smoke on startup
- Sensory: `smoke_color=blue_or_gray`, `smell_descriptor=burnt_oil`, `sound_or_smoke_location_zone=from_tailpipe`.
- Conditions: `onset_timing=cold_start` — a puff after sitting overnight that clears within a minute;
  also on decel (oil pulled down guides under high intake vacuum).
- Severity: `drivable_normally` / `drivable_but_concerned`; oil consumption present.
- Misattribution: "burning oil" — customers can't tell seal-smoke from ring-smoke; the *when* separates them.
- Source: [Halderman, *Automotive Engine Repair & Rebuilding*, Tier 2].

### 3.4 Oil past worn rings / cylinder wear → blue smoke under load
- Sensory: `smoke_color=blue_or_gray`, `smell_descriptor=burnt_oil`.
- Conditions: `onset_timing=when_accelerating` or `always`; heavy oil consumption, blow-by from the oil-fill.
- Severity: `drivable_but_concerned`; progressive.
- Misattribution: same "burning oil" umbrella as 3.3; distinguished by load vs cold-start timing.
- Source: [Halderman, *Automotive Engine Repair & Rebuilding*, Tier 2].

### 3.5 Turbo center-seal oil leak → blue smoke under boost
- Sensory: `smoke_color=blue_or_gray`; `vehicle_powertrain=turbocharged`; often a `noise_descriptor=whining` from the turbo.
- Conditions: `onset_timing=when_accelerating` (boost) or on decel.
- Severity: `drivable_but_concerned`.
- Misattribution: blamed on rings; turbo whine + oil use is the tell.
- Source: [Halderman, *Automotive Engine Performance* (forced induction), Tier 2].

### 3.6 Head-gasket / cracked-head coolant breach → white smoke
- Sensory: `smoke_color=white` (thick, persistent), `smell_descriptor=sweet_or_maple_syrup`; milky oil-cap film.
- Conditions: `onset_timing=always` — persists past warm-up (unlike benign cold-morning
  `smoke_color=steam_thin_wispy`); coolant loss; temp gauge climbing.
- Severity: `drivable_but_concerned` → `not_drivable_needs_tow` if overheating.
- Misattribution: confused with harmless cold-morning steam; persistence + sweet smell + coolant loss separate them.
- Source: [Halderman, *Automotive Engine Repair & Rebuilding*, Tier 2].

### 3.7 External oil-on-hot-metal → burnt-oil smell (no tailpipe smoke)
- Sensory: `smell_descriptor=burnt_oil`, `sound_or_smoke_location_zone=under_hood`; sometimes faint
  smoke from under the hood after a hard/long drive; **no** dripping led-with.
- Conditions: strongest after a long/hard drive and just after shutdown.
- Severity: `drivable_normally` early.
- Misattribution: confused with hot-brake smell (from a wheel, rubbery) and electrical burn (sharp/acrid) — §7.
- Source: [Halderman, *Automotive Engine Repair & Rebuilding* (gasket sealing), Tier 2].

### 3.8 Mechanical misfire (compression loss / bent valve / VVT phaser) → bucking + flashing CEL
- Sensory: `engine_running=misfiring`, `warning_light_named=check engine`,
  `warning_light_behavior=flashing_or_blinking`, `onset_timing=when_accelerating`.
- Conditions: **a flashing MIL = active misfire dumping raw fuel into the catalytic converter → stop
  driving.** The flash/steady MIL convention is an OBD-II / owner's-manual behavior documented in the
  standard literature [Halderman, *Automotive Engine Performance*, Tier 2]; the underlying **P0300–P0308
  DTC numbering** is defined by [SAE J2012, Tier 1] (J2012 assigns the codes; it does NOT define MIL flash
  semantics).
- Severity: `drivable_but_concerned` → do-not-drive when flashing.
- Misattribution: customers say "sputtering / bucking / jerking"; mechanical vs ignition/fuel cause is a
  shop-bench call, not a chat call (§7) — the classifier routes the symptom, the tech finds the cause.
- Source: [Halderman, *Automotive Engine Performance*, Tier 2; SAE J2012 (DTC numbering), Tier 1].

### 3.9 Timing-chain / tensioner cold rattle
- Sensory: `noise_descriptor=ticking_or_tapping` (a rapid top-end rattle/tick, harsher than a lifter tick
  but still upper-engine, not a deep bottom-end knock).
- Conditions: `onset_timing=cold_start` — loudest in the first seconds after a cold start, often quieting
  as oil pressure fills the hydraulic chain tensioner; a stretched chain can throw crank/cam-correlation
  codes. Routes to `noise/engine_ticking_or_tapping` (nearest Stage-2 home for an upper-engine tick/rattle);
  the bench separates chain vs lifter.
- Severity: `drivable_but_concerned` — a jumped chain can bend valves.
- Misattribution: heard as "lifters"; also confused with a cold-start exhaust-manifold tick (warm-up
  behavior overlaps — the tensioner-quieting rattle mimics a manifold tick that quiets when warm; §5).
- Source: [Halderman, *Automotive Engine Repair & Rebuilding* (timing drives), Tier 2; SAE J2012
  P0016–P0019 crank/cam correlation, Tier 1 (DTC numbering)].

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Real-voice phrasings, source-ordered (Tekmetric corpus → NHTSA/forum-paraphrase → synthetic-flagged).
Full machine form in `engine-mechanical.lexicon.yaml`. **Corpus-consensus caveats are disclosed inline**
where a real case's consensus label differs from this dossier's routing.

| Phrase (as customers write it) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "My car has started making an intermittent tapping. It does it for a few seconds and then stops" | engine_ticking_or_tapping | needs-fact:onset_timing (tkc-117 corpus consensus = ambiguous) | tekmetric (tkc-117) |
| "making a ticking noise when driving" | engine_ticking_or_tapping | needs-fact:sound_or_smoke_location_zone (tkc-268 consensus = category-only, subcat unresolved) | tekmetric (tkc-268) |
| "roar and clicking/tapping" | (CROSS-SYSTEM) suspension_steering_check | cross-system: tkc-218 corpus consensus = suspension_steering_check (the "roar" dominates) — NOT engine-internal | tekmetric (tkc-218) |
| "engine sounds like a sewing machine when I first start it" | engine_ticking_or_tapping | unambiguous (already a live catalog positive_example) | catalog/tekmetric |
| "puff of blue smoke out the tailpipe when i first start it in the morning, smells like burning oil" | blue_or_gray_smoke_from_tailpipe | unambiguous | tekmetric (eval CEL-005) |
| "Blueish gray smoke puffs out the tailpipe when I take off from a light, and it smells like burning oil" | blue_or_gray_smoke_from_tailpipe | unambiguous | tekmetric (eval nearmiss-008) |
| "burns a lot of oil and has to fill up the oil about every few months" | smoke_from_under_the_hood / blue_or_gray_smoke_from_tailpipe | needs-fact:sound_or_smoke_location_zone — **tka-019 corpus consensus = oil_leak_testing / smoke_from_under_the_hood** (the smoke was from the GRILLE, not the tailpipe) | tekmetric (tka-019) |
| "greasy burning oil smell from under the hood after long drives, no drips on the ground" | burnt_oil_smell | unambiguous | tekmetric (eval oil_leak-003) |
| "knocking sound coming from the motor" (won't-start, slow crank) | deep_knocking_from_the_engine | cross-system:wont_crank_just_clicks | forum-paraphrase |
| "car idles rough, shakes, seems to run fine down the road, sometimes shuts off at a stop" | rough_idle_or_shaking_at_a_stop | cross-system:stalling_at_idle_or_when_stopping | forum-paraphrase |
| "misfire on start up" / "check engine light, codes for misfire cylinder 1 and 4" | engine_misfire_or_bucking_feeling | needs-fact:warning_light_behavior | tekmetric (tkc-124, tkc-224) |
| "valve cover removal inspect for engine damage" | (NONE — work-order line) | null-route → advisor | tekmetric (tkc-155) |

**Corpus-consensus discipline:** tka-019 and tkc-218 are RETAINED as language exemplars but routed to
match their real corpus consensus (oil_leak/smoke_from_under_the_hood and suspension_steering_check
respectively), NOT force-fit to engine-internal buckets. tkc-117/tkc-268/tka-044 are corpus-ambiguous
(no confirmed subcategory) and are used only as evidence that *engine-tick language exists*, not as
confident engine-tick labels.

Messiness observed and encoded: misspell/idiom ("sewing machine", "sputtering", "bucking", "chugging"),
part-name-as-guess ("lifters", "needs a tune-up"), all-caps fragments ("RATTLE AT IDLE"), and mixed
symptom+request ("burns oil, need it looked at").

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: the ONE best discriminator, the fact slot + value that answers it.

| Confusable pair | Best discriminating question | Slot + value that resolves |
|---|---|---|
| **Valvetrain tick (3.1) / chain rattle (3.9) vs exhaust-manifold tick** | "Does the ticking go away completely once the engine is fully warmed up, or is it still there?" | **NO CURRENT SLOT cleanly holds this** → propose `symptom_warmup_trend`: `quiets_when_warm`→manifold; `no_change`/persists→valvetrain. (See the necessity note below — `onset_timing` approximates but conflates warm-up with time-of-day and cannot encode *partial* quieting.) |
| Valvetrain tick (3.1) vs rod knock (3.2) | "Is it a light fast tap, or a deep heavy hammering?" | `noise_descriptor`: `ticking_or_tapping` vs `knocking_deep` |
| Rod knock (3.2) vs suspension clunk | "Does it happen with engine load (accelerating/uphill) or with road bumps?" | `onset_timing`: `when_accelerating`→engine vs `over_bumps`→suspension |
| Blue-smoke seal (3.3) vs ring (3.4) | "Is the blue smoke a puff only on cold startup, or does it show under acceleration/all the time?" | `onset_timing`: `cold_start`→seals vs `when_accelerating`/`always`→rings |
| Blue smoke (oil) vs white smoke (coolant) | "Does the exhaust smoke smell oily/burnt, or sweet and syrupy?" | `smell_descriptor`: `burnt_oil` vs `sweet_or_maple_syrup` (secondary: `smoke_color` `blue_or_gray` vs `white`) |
| White smoke (3.6) vs benign cold steam | "Does it keep smoking after 10–15 minutes of driving, or clear up once warm?" | `smoke_color`: `white` (persists) vs `steam_thin_wispy`; **also** `symptom_warmup_trend` (proposed) |
| Burnt-oil smell (3.7) vs hot-brake smell | "Is the smell from under the hood, or from a wheel?" | `sound_or_smoke_location_zone`: `under_hood` vs `from_a_wheel` |
| Mechanical misfire severity (3.8) | "Is the check-engine light steady, or flashing/blinking?" | `warning_light_behavior`: `flashing_or_blinking`→do-not-drive |

**Necessity note for `symptom_warmup_trend` (honest form).** `onset_timing` *approximates* a warm-up
trend at the extremes — `cold_start` ("only first thing in the morning / after sitting overnight"),
`after_warming_up` ("only once the engine is warm"), and `always` ("continuous") loosely map to
quiets/worsens/no-change. But it does not *cleanly* discriminate the tick pair for two reasons:
(1) `cold_start` bundles a warm-up trend together with a time-of-day/overnight condition, so a tick that
is loudest cold **and still present warm** is `always`, not `cold_start`; and (2) the single most common
real utterance — "loud cold, quieter but never fully gone once warm" (§3.1, golden case 1) — is *partial*
quieting that neither `cold_start` nor `always` captures. `symptom_warmup_trend` names the trend directly.
It is therefore proposed as a sharpening slot, not because `onset_timing` is empty. Four active warm-up
questions (§9) literally ask a warm-up-trend yes/no, satisfying the ≥3-question rule.

---

## 6. Warning lights & DTC surface

Engine-mechanical faults surface on:
- **Oil-pressure light** (red oil-can + drip). Customer nicknames: "oil can light", "little drip light",
  "genie lamp". `warning_light_named=oil pressure`. A steady oil light with a knock or tick = do-not-drive.
  When the customer LEADS with the oil light, Stage-1 is `oil_pressure_light_testing` (which reaches both
  `oil_pressure_light` and `engine_ticking_or_tapping`); when they lead with a deep knock, Stage-1 is
  `check_engine_light_testing` (the only service reaching `deep_knocking_from_the_engine`). See §8.
- **Check Engine Light (MIL).** Steady = stored fault; **flashing = active misfire, catalyst at risk,
  stop driving**. `warning_light_named=check engine`; `warning_light_behavior=steady_on` vs
  `flashing_or_blinking`. The flash/steady convention is an OBD-II / owner's-manual behavior, not an SAE
  J2012 definition [Halderman, *Automotive Engine Performance*, Tier 2].
- **Engine-temperature light / gauge** (paired with head-gasket white smoke). Note: the temp **gauge** is
  not a "light" — customers say "temp is creeping up"; that is NOT a `warning_light_named` value unless
  they name a light.
- **DTC families (tech-facing, Tier 1 SAE J2012 numbering):** P0300–P0308 (random/cylinder-specific
  misfire); P0016–P0019 (crank/cam correlation → timing chain, §3.9); P0011/P0014/P0021 (camshaft timing
  over-advanced, VVT); P052x (oil-pressure/VVT-solenoid). These feed the tech, not the chat — the
  classifier routes on the customer's plain words, not the code.

---

## 7. Confusable neighbors (cross-system)

1. **`noise/exhaust_manifold_tick_or_puff`** — a tick that **quiets/disappears as the manifold heats and
   expands to seal** [Halderman, *Automotive Engine Repair & Rebuilding* (exhaust manifolds/gaskets),
   Tier 2]. Valvetrain tick (3.1) and, ambiguously, a tensioner chain rattle (3.9) can also quiet as oil
   pressure builds — so warm-up trend alone is not perfectly separating, but a tick that goes away
   COMPLETELY once fully warm is the manifold. Discriminator: `symptom_warmup_trend` (proposed). This
   dossier OWNS this confusable-pair boundary.
2. **`noise/clunking_over_bumps` / suspension** — bottom-end knock is *engine-load*-triggered
   (`when_accelerating`); a suspension clunk is *bump*-triggered (`over_bumps`).
3. **Spark knock / detonation-pinging** — a light metallic rattle/ping under hard acceleration, worse on
   low-octane fuel or with carbon buildup. It is NOT a bottom-end knock; the live
   `deep_knocking_from_the_engine` negatives explicitly push "pinging/rattling on cheap gas" out. There is
   **no dedicated Stage-2 subcategory** for spark knock in the current taxonomy: if the customer also
   reports a check-engine light it routes to `check_engine_light_testing`; a bare pinging complaint has no
   clean home and is a noted backlog gap (§9). The fuel-grade question (Q123) lives under
   `deep_knocking_from_the_engine` to help the bench distinguish detonation from a real knock, not to route.
4. **`leak/brown_or_black_puddle_engine_oil`** — same root oil leak, but if the customer leads with a
   **puddle** it's the leak slug; if they lead with the **burnt smell/under-hood smoke** it's `burnt_oil_smell`.
5. **`smell/sweet_smell_maple_syrup_antifreeze` + `warning_light/engine_temperature_light`** — coolant
   symptoms owned by the coolant/cooling dossier; only white *tailpipe* smoke is claimed here.
6. **`performance/engine_misfire_or_bucking_feeling`** — jointly owned with the fuel/ignition dossier.
   Chat cannot tell mechanical (compression/valve/VVT) from ignition/fuel misfire, and MUST NOT try — it
   routes the symptom + severity (`warning_light_behavior`); the bench finds the cause.
7. **`noise/high_pitched_whining_under_the_hood`** — accessory-belt/alternator/PS whine, NOT engine
   internal; a turbo whine (3.5) is the exception that pairs with blue smoke.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

Service→subcategory eligibility is **verified against `catalog-snapshot.json` (2026-07-03)** via each
subcategory's `eligible_testing_service_keys`. These links cross the service's `concern_categories` — e.g.
`check_engine_light_testing` (concern_categories `[warning_light, performance]`) nonetheless reaches
`engine_ticking_or_tapping`, `deep_knocking_from_the_engine`, `white_smoke_from_tailpipe`,
`blue_or_gray_smoke_from_tailpipe`, `gasoline_fuel_smell`, and `hissing_noise`. So the service's own
concern categories are **not** the gate; the explicit eligibility list is.

| Failure mode | Eligible testing service(s) (Stage-1) | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| Valvetrain tick (3.1) / chain rattle (3.9) | check_engine_light_testing, oil_pressure_light_testing | noise | engine_ticking_or_tapping | good |
| Rod/main knock (3.2) | check_engine_light_testing | noise | deep_knocking_from_the_engine | good |
| Blue smoke seals/rings/turbo (3.3/3.4/3.5) | check_engine_light_testing | smoke | blue_or_gray_smoke_from_tailpipe | good |
| Head-gasket white smoke (3.6) | coolant_leak_testing, check_engine_light_testing | smoke | white_smoke_from_tailpipe | good |
| External burnt-oil (3.7) | oil_leak_testing | smell | burnt_oil_smell | good |
| Mechanical misfire (3.8) | check_engine_light_testing | performance | engine_misfire_or_bucking_feeling | good (symptom-level) |
| Rough-idle mechanical subset | check_engine_light_testing | performance | rough_idle_or_shaking_at_a_stop | good |

**No NO-FIT.** Every engine-internal symptom has a good subcategory home AND at least one eligible
Stage-1 testing service. The earlier draft's claim that engine-internal tick/knock had "no Stage-1 home"
was **false** — `check_engine_light_testing` already reaches `engine_ticking_or_tapping` AND
`deep_knocking_from_the_engine`, and `oil_pressure_light_testing` reaches `engine_ticking_or_tapping`
(verified in `catalog-snapshot.json`). No catalog or subcategory proposal is filed.

**Residual (soft, non-op observation — NOT a gated proposal):** the eligible service *names*
("Check engine light testing", "Oil pressure light testing", "Exhaust evaluation") do not obviously
signal "engine noise" to a customer with a bare knock/tick and no dash light. This is a labeling
discoverability nuance addressed by the Stage-1 **keyword** adds in `proposals.yaml` (engine-noise cues
routed onto the services that already reach the noise subcategories) — not by a new service. If Chris
later wants a customer-facing "Engine mechanical evaluation" label, that is a business/UX decision, not a
routing gap.

---

## 9. Fact-slot audit

**Slots this system uses (with corpus-attested values):**
- `noise_descriptor`: `ticking_or_tapping` (tkc-117/268; chain rattle 3.9), `knocking_deep` (forum rod-knock).
- `smoke_color`: `blue_or_gray` (CEL-005, nearmiss-008), `white`, `steam_thin_wispy` (benign).
- `smell_descriptor`: `burnt_oil` (oil_leak-003, CEL-005), `sweet_or_maple_syrup` (white smoke).
- `onset_timing`: `cold_start`, `when_accelerating`, `when_idling`, `always`.
- `sound_or_smoke_location_zone`: `under_hood`, `from_tailpipe`.
- `warning_light_named`: `oil pressure`, `check engine`; `warning_light_behavior`: `flashing_or_blinking`, `steady_on`, `came_on_then_off`.
- `engine_running`: `rough_idle`, `misfiring`.
- `vehicle_powertrain`: `turbocharged` (turbo blue smoke).
- `recent_action`: `oil_change` (recent-oil-change-then-tick).
- `drivable_state`: `drivable_but_concerned` / `not_drivable_needs_tow` (rod knock, overheat).
- `customer_request_type`: `diagnose_problem`, `second_opinion` (inspection / work-order-adjacent lines).

**Missing values / proposed:**
- **NEW SLOT `symptom_warmup_trend`** (values: `quiets_when_warm`, `worsens_when_warm`, `no_change`).
  Literal cues: "goes away after it warms up", "still ticking after 15 minutes", "quiets down once it's
  warm", "gets worse as it heats up". Unlocks skipping the warm-up questions on `engine_ticking_or_tapping`
  (Q76), `deep_knocking_from_the_engine` (Q122), and `white_smoke_from_tailpipe` (Q281, Q282) — four
  questions, ≥3 rule met. Rationale (§5 necessity note): `onset_timing` only approximates the trend and
  cannot encode partial quieting. See `stage3.slot.propose` in `proposals.yaml`.
- **Sub-threshold gaps (noted, NOT proposed — <3 questions each):**
  - *Engine vertical zone* ("top of engine vs lower block", Q73) — partially covered by `noise_descriptor`
    (tick=top, knock=bottom); only 1 question explicitly asks it → left `intentionally_empty`.
  - *Spark-knock / detonation-pinging* — no dedicated subcategory (§7.3); backlog if pinging complaints accrue.
  - *Oil consumption between changes* ("adding a quart", Q291) — 1 question → not a slot yet; watch.
  - *Deceleration onset* ("blue smoke when coasting/foot off gas", Q290) — `onset_timing` has no
    `when_decelerating` value; 1 question → not proposed; note as backlog if more accrue.
  - *Fuel-octane grade* (Q123, pre-ignition) — out of ontology scope; `intentionally_empty`.

---

## 10. Sources

Diagnostic (Tier 1/2 only — all URL-less vendor-training and non-named Tier-3 blogs removed per
`source-policy.md`; failure-mode claims rest on the Tier-2 standard textbook + Tier-1 SAE standards):
- Halderman, *Automotive Engine Repair & Rebuilding* (Pearson) — Tier 2 — bearing clearance/rod knock,
  valvetrain lash/lifter tick, timing-drive/chain rattle, ring vs valve-seal oil control, head-gasket
  coolant breach, exhaust-manifold-gasket cold tick, gasket sealing.
- Halderman, *Automotive Engine Performance* (Pearson) — Tier 2 — hydraulic-lifter operation, forced-induction
  turbo oil-seal pass-through, misfire→catalyst / MIL flash-vs-steady behavior.
- SAE J1930 (terminology) — Tier 1 — component naming.
- SAE J2012 (DTC definitions/numbering) — Tier 1 — misfire P030x, timing P0016–P0019, VVT P001x, oil-pressure/VVT P052x.
  (Cited ONLY for code numbering; MIL flash semantics are attributed to Halderman, not J2012.)

Linguistic (customer voice, never cited for diagnosis):
- Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json` (tkc-117 [consensus ambiguous], tkc-124,
  tkc-155, tkc-218 [consensus suspension_steering_check], tkc-224, tkc-268 [consensus category-only],
  tka-019 [consensus oil_leak_testing/smoke_from_under_the_hood], tka-044 [consensus ambiguous]) +
  `eval-cases.json` (check_engine_light_testing-005, oil_leak_testing-003, oil_pressure_light_testing-001,
  exhaust_system_testing-003, nearmiss-008). Provenance `tekmetric`.
- `real-concerns-forums.json` rod-knock/rough-idle/misfire narratives → paraphrased, provenance `forum-paraphrase`.

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode carries a Tier 1/2 cite (Halderman Tier 2 and/or SAE Tier 1). No URL-less or
      non-named-Tier-3 sources remain; no fabricated URLs. Uncited claims: none.
- [x] Sensory signatures expressed in fact-slot vocabulary; literalness respected (no rotor/location inference).
- [x] Every confusable pair (§5/§7) has ONE discriminator + the resolving slot/value; the two mandated
      pairs (valvetrain vs manifold tick; blue vs white smoke) are covered with SINGLE questions.
- [x] Every negative_example in `proposals.yaml` names `routes_to` and is diffed against the live
      snapshot enrichment (no duplicate of an existing negative).
- [x] Synonyms are ≥2 tokens or domain tokens (no bare "noise/smoke/oil/light"); no mechanic-voice/near-dup adds.
- [x] Positive examples corpus-first; synthetic flagged and ≤~30% per subcategory (lexicon rebalanced — §4/lexicon).
- [x] Slot proposal `symptom_warmup_trend` satisfies the ≥3-question rule (4 questions) with an honest
      necessity argument (does not claim `onset_timing` is empty).
- [x] Binding verified against `catalog-snapshot.json`: all stage1→stage2 golden pairs are reachable; no
      false catalog gap; the earlier engine-noise catalog proposal is withdrawn.
- [x] ≥8 golden cases incl. ≥1 inference-trap + ≥1 null-route; no unreachable stage1→stage2 pair.
- [x] Corpus-consensus conflicts (tka-019, tkc-218) disclosed, not force-fit.
- [x] US-market calibration; diesel/EV kept light per corpus.
</content>
</invoke>
