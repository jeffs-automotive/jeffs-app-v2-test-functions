# No-start / no-power router — cross-system disambiguation dossier
slug: router-no-start-power   date: 2026-07-18
role: Wave B router (reduced template — §1 scope, §4 customer voice, §5 decision tree + differential, §10 sources)
owns_confusable_pairs:
  - no_start_testing ↔ charging_starting_testing            # taxonomy §5.2
  - wont_crank_just_clicks ↔ slow_crank_sluggish_start
  - dead-battery click ↔ bad-starter click (within wont_crank_just_clicks)
  - no_sound_at_all (silent) ↔ wont_crank_just_clicks (click) ↔ cranks-but-won't-fire
  - security / immobilizer no-start ↔ battery / charging no-start
  - hybrid/EV won't-go-to-READY: 12 V aux ↔ HV traction
consumes_dossiers: [starting-charging, fuel-system-evap, ignition-misfire, engine-controls-driveability, hybrid-ev-high-voltage, body-glass-water-leaks-keys, brakes-friction-hydraulic]
emits: [routers/router-no-start-power.proposals.yaml, binding/no-start-decision-tree.md]

> **Why a router owns this.** "It won't start" is the single most overloaded customer utterance in the
> corpus. The same three words route to at least **five different testing services** (`charging_starting_testing`,
> `no_start_testing`, `battery_test`, plus the immobilizer/`electrical_testing_general` and hybrid/HV paths)
> depending on ONE fact the customer may or may not have stated: **what actually happens when they turn the
> key / press start.** No per-system dossier can own that fork because the branches live in different systems.
> This router owns the fork. Its signature deliverable is the machine-form decision tree in
> [`binding/no-start-decision-tree.md`](../binding/no-start-decision-tree.md); this file is the human-readable
> rationale + the customer-voice cues + the sources.

---

## 1. Scope & boundaries

**In scope** — every customer complaint whose headline is *the car will not start, will not power on, or
died and won't restart*, and the routing fork among:

- **Charging/starting energy chain** (`charging_starting_testing`): no-crank rapid-click, no-crank single-click,
  slow crank, dead/weak battery, drains-after-sitting, dim/flickering lights with a battery light, silent
  no-crank from an energy fault (flat battery / open cable / ignition switch / safety interlock), died-while-
  driving with electrical precursors. **The energy side of no-start is owned by `starting-charging`;** this
  router only routes *to* it.
- **Fuel/spark cranks-but-won't-fire** (`no_start_testing`): engine rotates at normal speed but never
  catches — fuel pump/pressure, injectors, ignition coils/plugs, crank/cam signal, timing. Includes
  hard-start-cold and hard-start-hot (`performance` subcats) and the **bare cranks-no-fire** case that
  currently has no Stage-2 home.
- **Battery test request** (`battery_test`): "just check my battery," no symptom.
- **Security / immobilizer no-start** (delegated to `body-glass-water-leaks-keys` FM-7): a flashing
  security/anti-theft/key light with a *normally charged* battery — the ECU is refusing to start, the energy
  chain is fine.
- **Hybrid / EV won't-go-to-READY** (delegated to `hybrid-ev-high-voltage` §3.1): press start, dash lights
  up, no crank, car won't enter READY — **12 V aux first, HV pack only on evidence.**

**Out of scope (route to the owning surface, do NOT resolve here):**

- The *diagnosis* of any branch — this router picks the **service + subcategory**, not the root cause. The
  per-system dossiers own mechanism and the failure-mode catalog.
- **Engine-side stalling that is not a no-start** (sputter/stumble/hesitation while driving, no electrical
  precursor) → `engine-controls-driveability` / `stalling_while_driving_under_load`. It reaches this router
  only via the died-while-driving fork (electrical vs engine).
- **A single dead accessory / power window / scattered electrical glitches** (car starts fine) →
  `electrical_testing_general` / `window_inop_testing`. Not a no-start.
- **"Need a key made / only have one key / lost my key" REQUEST language** (not a symptom) →
  `router-requests-maintenance` (`customer_request_type`). This router owns only the *symptom* "key won't
  turn / won't recognize / car won't start."
- **HV traction-pack repair / EV charging (EVSE) work** — routing-only; ambiguous or HV-repair cases →
  advisor. See `hybrid-ev-high-voltage` §3.5/§3.6.

---

## 2. The spine fact — `engine_running`

One extracted fact carries almost the entire routing decision. Its live enum (verified in
`scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts`, 2026-07-18) is:

`normal · rough_idle · misfiring · surging · stalls · wont_start · slow_crank · wont_crank_just_clicks ·
died_while_driving · no_sound_at_all`

The five that matter to this router, and where each routes by default:

| `engine_running` value | Plain meaning | Default route (before modifiers) |
|---|---|---|
| `wont_start` | **cranks/turns over at normal speed but never fires** | `no_start_testing` (fuel/spark) |
| `slow_crank` | cranks but **slowly** ("rrr… rrr…") before catching | `charging_starting_testing` → `slow_crank_sluggish_start` |
| `wont_crank_just_clicks` | **no rotation, just clicking** (rapid or single) | `charging_starting_testing` → `wont_crank_just_clicks` |
| `no_sound_at_all` | turn the key / press start and **nothing at all** | `charging_starting_testing` → `wont_crank_just_clicks` (energy) — UNLESS security or hybrid modifier |
| `died_while_driving` | shut off mid-drive, now won't restart | split on precursor: electrical → `charging_starting_testing`; engine sputter → `check_engine_light_testing` |

Three **modifier facts** override or refine the default:

- **`lights_state`** (`dim_or_flickering` · `dim_at_idle_brighten_when_revving` · `normal` · `completely_dead`)
  — splits the click and silent branches (weak battery vs starter vs open cable/switch).
- **`warning_light_named`** (free text) — a **security / anti-theft / theft / key** light with a normal
  battery flips a no-start/no-sound to the **immobilizer** path; a **battery / charge / alt** light keeps it
  on the charging path; a **turtle / check hybrid system / red triangle** name flips to the HV path.
- **`vehicle_powertrain`** (`hybrid` · `electric`, **only if the customer literally says so**) — flips
  "won't power on / won't go to READY" to the hybrid 12 V-aux-first path.

Note: `engine_running` has **no value** for the hybrid/EV "pressed start, dash lit, no engine crank, won't
go to READY" case — the least-wrong current fallback is `no_sound_at_all`, and the hybrid dossier proposes a
new value `wont_power_on_no_crank`. This router's tree uses that proposed value where it applies and falls to
`no_sound_at_all` until it ships. See proposals.

---

## 3. The decision tree (human-readable; machine form in `binding/no-start-decision-tree.md`)

Read the fork top-down. The first question the wizard should resolve is **"when you turn the key / press the
button, what happens?"** — because it sets `engine_running`, which chooses the branch.

```
Q0. "When you turn the key / push the button, what happens?"
│
├─ A. Engine TURNS OVER at normal speed but never catches/fires   → engine_running = wont_start
│     └─ Q_sec: security/anti-theft/key light flashing AND battery is fine (lights bright, no jump)?
│         ├─ YES → SECURITY / IMMOBILIZER no-start
│         │        route: no_start_testing  (Stage-2: body-glass FM-7 →
│         │        proposed key_or_fob_not_recognized_wont_start; interim = null subcat)
│         └─ NO  → FUEL / SPARK cranks-no-fire
│             ├─ cold engine after sitting overnight, cranks a few times, fine once warm
│             │      → performance / hard_to_start_when_cold   (service: no_start_testing)
│             ├─ right after driving + a short stop, fine after cooling 20-30 min
│             │      → performance / hard_to_start_when_hot    (service: no_start_testing)
│             ├─ started right after a fill-up, now chugging / won't start
│             │      → fuel-system-evap FM-12 (no clean slug; service no_start_testing) → advisor-lean
│             └─ otherwise BARE cranks-no-fire
│                    → no_start_testing, null subcat today (PROPOSE cranks_but_wont_fire)
│
├─ B. Engine cranks SLOWLY ("rrr… rrr…") before it catches        → engine_running = slow_crank
│     → charging_starting_testing / slow_crank_sluggish_start
│       (worse cold + dim-while-cranking reinforce; do NOT set onset_timing unless "after sitting
│        overnight / first thing in the morning" is literally stated)
│
├─ C. NO crank — just CLICKING                                    → engine_running = wont_crank_just_clicks
│     ├─ RAPID click + dash lights DIM (lights_state = dim_or_flickering) → dead/weak battery
│     ├─ ONE click + lights stay BRIGHT (lights_state = normal)          → bad starter / severe resistance
│     ├─ fine all day, dead only AFTER SITTING, needs a jump repeatedly  → battery_drains_overnight
│     └─ all of the above route to charging_starting_testing (subcat splits on lights_state / sit-pattern)
│
├─ D. NO SOUND AT ALL — key turns / button press, nothing         → engine_running = no_sound_at_all
│     ├─ lights COMPLETELY DEAD (lights_state = completely_dead)  → flat battery / open main cable
│     │      → charging_starting_testing / wont_crank_just_clicks
│     ├─ lights BRIGHT/normal, no starter response                → ignition switch / safety interlock /
│     │      open control wire → charging_starting_testing / wont_crank_just_clicks
│     ├─ security/anti-theft/key light on, battery fine           → IMMOBILIZER (starter-cut design)
│     │      → no_start_testing (Stage-2 body-glass FM-7 / proposed key_or_fob_not_recognized_wont_start)
│     └─ HYBRID/EV: dash lights up, "won't go to READY", no crank → engine_running = wont_power_on_no_crank
│            (PROPOSED; falls to no_sound_at_all today), vehicle_powertrain = hybrid/electric
│            → 12 V FIRST: charging_starting_testing / battery_test
│              UNLESS a turtle / Check-Hybrid-System / red-triangle warning is named → HV path
│              (hybrid-ev §3.1/§3.3 → proposed hybrid_or_ev_wont_power_on / hybrid_system_warning_light)
│
└─ E. It DIED WHILE DRIVING and now won't restart                 → engine_running = died_while_driving
      ├─ lights/dash DIMMED or a BATTERY light came on FIRST      → electrical
      │      → charging_starting_testing / car_died_while_driving_electrical
      └─ engine SPUTTERED / stumbled / lost power first, no electrical warning → engine-side
             → check_engine_light_testing / stalling_while_driving_under_load
```

**Cross-cutting overrides (evaluate before finalizing any branch):**

1. **Security light + normal battery ⇒ immobilizer**, no matter whether the engine cranks-no-fire (branch A)
   or is silent (branch D). A named security/anti-theft/theft/key light with bright lights and no jump needed
   is *never* a battery no-start.
2. **Stated hybrid/electric + "won't power on / won't go to READY" ⇒ 12 V aux first.** Never encode
   "hybrid + won't start ⇒ HV battery." A jump of the little 12 V that brought it back
   (`recent_action=jump_started`) is the strongest 12-V confirmation; a turtle/hybrid warning is the only
   thing that flips it to HV.
3. **A request with no symptom ⇒ `battery_test` / advisor.** "Just test my battery before a road trip"
   (`customer_request_type`) is not a no-start.
4. **A staff work-order line ⇒ null-route / advisor.** "NO START TESTING AUTH 179", "STARTING AND CHARGING
   SYSTEM TESTING AUTH 89" is shop text, not a customer concern — empty Stage-1.

---

## 4. Customer-voice cues (linguistic authority — never used for diagnosis)

Real Tekmetric lines (provenance `tekmetric`, near-verbatim from
`scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json`) grouped by branch. Note how few carry
the crank-quality detail the fork needs — that is exactly why the wizard must ask Q0.

**Branch A — cranks-but-won't-fire (`wont_start` → no_start_testing):**
- "TOW IN. CRANKS BUT WILL NOT START. AAA DRIVER TOLD CLIENT MAY BE TIMING BELT" — tekmetric (bare crank-no-fire)
- "TOW IN NO START TESTING AUTH 179 … AAA Driver stated battery seems ok" — tekmetric (battery OK ⇒ not charging side)
- "intermitent no start testing auth 179" — tekmetric (crank quality unstated → needs-fact:engine_running)
- "CHECK ENGINE LIGHT ON. AFTER GETTING GAS HAS TO CRANK VEHICLE MULTIPLE TIMES TO GET STARTED" — tekmetric (hot/fuel hard-start)

**Branch B — slow crank (`slow_crank` → slow_crank_sluggish_start):**
- "BATTERY SEEMS TO GIVE A SLOW CRANK, CHECK AND ADVISE" — tekmetric
- "CLIENT HAS BEEN NOTICING A WEAK/EXTENDED CRANK" — tekmetric

**Branch C — no crank / clicking + drains (`wont_crank_just_clicks` / `battery_drains_overnight`):**
- "NO CRANK NO START TESTING AUTH 89 TO START" — tekmetric
- "Had to jump start, test batt" — tekmetric
- "CLIENT HAD TO JUMP START VEHICLE (Sat for awhile)" — tekmetric (drains-after-sitting)
- "I believe the battery must be replaced. Sometimes the car starts fine and sometimes I need a jump. It may
  start fine and then 10 min later it won't!" — tekmetric (intermittent — drain/weak battery)
- "CLIENT HAD TO JUMP START TWICE SINCE ALTERNATOR REPLACEMENT RECHECK" — tekmetric (post-charging-work)
- "just rapid clicking like a machine gun, jumped it and it fired right up" — synthetic (rapid-click cue)
- "one loud click and then nothing, but the headlights stay bright" — synthetic (single-click/starter cue)

**Branch D — silent + hybrid won't-power-on:**
- "NO START OCCURRED HAD TO PRESS THE BUTTON SEVERAL TIMES, CLIENT DOES NOT BELIVE BATTERY IS CHARGING CEL
  CAME ON" — tekmetric (push-button intermittent no-start + CEL)
- "turn the key and absolutely nothing, no lights, totally dead" — synthetic (completely_dead)
- "everything lights up on the dash but it does nothing when i turn the key" — synthetic (lights normal, no starter)
- "my hybrid wont start, all the dash lights come on but it wont go to ready and it wont move" — synthetic
- "prius wont start this morning, jumped the little 12 volt battery in the back and it fired up" — forum-paraphrase
  (note: "prius" alone must NOT set `vehicle_powertrain` — see hybrid-ev §9)

**Branch E — died while driving:**
- "DIED WHILE DRIVING. ALL WARNING LIGHTS CAME ON AND THEN VEHICLE JUST SHUT OFF" — tekmetric (electrical)
- "engine sputtered and stumbled and lost power going uphill, no warning lights, then it quit" — synthetic (engine-side)

**Security / immobilizer (no real corpus utterance — data-collection backlog, see body-glass §11):**
- "car cranks but won't start and the little security light is flashing" — synthetic (flagged)
- "won't start, key won't turn in the ignition" — synthetic (worn cylinder / interlock cousin)

**Request / null-route:**
- "TEST BATTERY (JUST WANT TO MAKE SURE IT IS OK)" — tekmetric → `battery_test`
- "STARTING AND CHARGING SYSTEM TESTING AUTH 89" — tekmetric staff work-order → advisor / null-route

---

## 5. Differential quick-reference

The full pairwise matrix (with hedge rules + examples) is machine-form in
[`binding/confusable-matrix.yaml`](../binding/confusable-matrix.yaml) rows contributed by this router (also
inlined under `confusable_matrix_rows:` in the proposals file). Summary:

| Pair | ONE discriminating question | Deciding fact |
|---|---|---|
| cranks-no-fire vs no-crank/slow/dead | "Engine **turn over normally** but not fire, or **barely/not** turn over?" | `engine_running` = `wont_start` vs `wont_crank_just_clicks`/`slow_crank`/`no_sound_at_all` |
| rapid-click(battery) vs single-click(starter) | "**Rapid** clicking with lights **dimming**, or **one** click with lights **bright**?" | `lights_state` = `dim_or_flickering` vs `normal` |
| clicking vs slow-crank | "Does it **spin/turn over** at all (just slowly), or just **click** with no spin?" | `engine_running` = `slow_crank` vs `wont_crank_just_clicks` |
| silent vs clicking | "Turn the key — **one/any click**, or **absolutely no sound**?" | `engine_running` = `wont_crank_just_clicks` vs `no_sound_at_all` |
| one-off no-crank vs drains-overnight | "Fine all day and dead only **after sitting**, or dead **right now** one-off?" | `recent_action=jump_started` + "dead after sitting" pattern |
| security/immobilizer vs battery no-start | "Is a **security/anti-theft/key light** on and the battery **otherwise fine** (bright, no jump)?" | `warning_light_named=security` + `engine_running=wont_start`/`no_sound_at_all`, battery normal |
| hybrid 12 V vs HV | "Did **jumping the small 12 V** start it, or is there a **turtle / Check-Hybrid-System** warning?" | `recent_action=jump_started` (12 V) vs `warning_light_named`≈turtle/hybrid (HV) |
| hybrid won't-power-on vs ICE no-crank | "Is it **hybrid/electric**, and does an **engine crank** at all, or does it just **not power on**?" | `vehicle_powertrain=hybrid/electric` + `wont_power_on_no_crank` vs `wont_crank_just_clicks` |
| died-driving electrical vs engine stall | "**Before** it died: lights/dash **dim** or a **battery light**, or engine **sputter/stumble**?" | `lights_state`/`warning_light_named` present → electrical; engine sputter → performance |

---

## 6. Literalness guardrails (safety-critical — Stage-3 must not over-assert)

- **"hard to start when cold" does NOT set `slow_crank`.** It sets nothing about crank speed. Unless the
  customer literally says the engine turns over *slowly* ("rrr rrr"), crank quality is **unknown** — ask, do
  not assume a weak battery. (starting-charging §3.8 inference trap.)
- **"when it's cold out" is `weather_condition=cold_weather`, NOT `onset_timing=cold_start`.** `cold_start`
  literally means "first thing in the morning / after sitting overnight." Do not upgrade a weather mention to
  a timing fact.
- **A model name is NOT a powertrain.** "my Prius won't start" must leave `vehicle_powertrain=null` (the slot
  rule forbids inferring from make/model) — so a bare Prius no-start uses the interim ICE slug, not the
  hybrid path, until the customer says "hybrid"/"electric" or the 12 V-jump/turtle cue appears. (hybrid-ev §9.)
- **"the dash lights come on" is a warning-icon scatter, NOT `lights_state=normal`.** Do not set brightness
  from "lights came on." (hybrid-ev §3.1.)
- **Do not name a light the customer never named.** "battery is dead" ≠ `warning_light_named="battery"`
  (that's a battery *state*, not a *dash light*). "message service high voltage charging system" is a named
  message, but the customer did not say "battery light" — keep `warning_light_named` to what was said.

---

## 7. Mapping to current taxonomy (routing targets)

| Branch | Service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| A. cranks-no-fire, bare | no_start_testing | performance | **(none)** | **NO FIT** → PROPOSE `cranks_but_wont_fire` |
| A. cranks-no-fire, cold | no_start_testing | performance | `hard_to_start_when_cold` | good |
| A. cranks-no-fire, hot | no_start_testing | performance | `hard_to_start_when_hot` | good |
| A. cranks-no-fire, after fill-up | no_start_testing | performance | (no clean slug — fuel-evap FM-12) | weak |
| A/D. security/immobilizer | no_start_testing | electrical | **(none)** → body-glass proposes `key_or_fob_not_recognized_wont_start` | NO FIT (delegated) |
| B. slow crank | charging_starting_testing | electrical | `slow_crank_sluggish_start` | good |
| C. clicking (battery/starter) | charging_starting_testing | electrical | `wont_crank_just_clicks` | good (`lights_state` splits) |
| C. drains after sitting | charging_starting_testing | electrical | `battery_drains_overnight` | good |
| D. silent, energy fault | charging_starting_testing | electrical | `wont_crank_just_clicks` | good (`no_sound_at_all` variant) |
| D. hybrid won't-power-on (12 V) | charging_starting_testing / battery_test | electrical | `wont_crank_just_clicks` (interim) → hybrid-ev proposes `hybrid_or_ev_wont_power_on` | weak (delegated) |
| D. hybrid, HV warning | check_engine_light_testing | warning_light | hybrid-ev proposes `hybrid_system_warning_light` | NO FIT (delegated) |
| E. died-driving electrical | charging_starting_testing | electrical | `car_died_while_driving_electrical` | good |
| E. died-driving engine | check_engine_light_testing | performance | `stalling_while_driving_under_load` | good |
| Request-only | battery_test | — | (service-direct) | good |

The **one new proposal this router originates** is `cranks_but_wont_fire` (performance) — the Stage-2 landing
spot for the bare cranks-no-fire concern that `no_start_testing` currently drops into a null subcategory.
Both `fuel-system-evap` (§7/§8) and `engine-controls-driveability` flagged this NO-FIT but deliberately did
**not** propose it, judging it premature per-system; as the cross-system no-start owner, this router surfaces
it with the aggregated corpus demand (tka-170, tkc-172, tka-061, tkc-276, plus the "battery seems ok" tow-in)
so Chris can decide. It is Chris-gated. All hybrid/security subcats are **delegated** to their Wave A
dossiers — this router references, never re-proposes, them (Wave C dedups).

---

## 8. Sources

This router makes **no new diagnostic claims** — every mechanism it routes on is cited in the Wave A
dossiers it consumes. Citations are inherited, not re-derived:

- **Charging/starting energy chain, click cadence, slow-crank, silent-no-crank, died-driving-electrical,
  starter grind** — `systems/starting-charging.dossier.md` §2–§3 (Fluke starter voltage-drop / alternator
  ripple / battery testing, Tier 2; NAPA CCA / alternator / starter, Tier 2; USPTO 4,635,606 & 5,775,281
  vapor-lock/heat-soak, Tier 1-equivalent).
- **Cranks-but-won't-fire fuel/spark, hard-start cold/hot, contaminated-fuel-after-fill, bare crank-no-fire
  NO-FIT** — `systems/fuel-system-evap.dossier.md` §3/§7/§8 + `systems/ignition-misfire.dossier.md` §5 +
  `systems/engine-controls-driveability.dossier.md` §5/§8 (Halderman, Tier 2; SAE J1930/J2012, Tier 1;
  Standard/Blue Streak CKP/CMP training, Tier 2).
- **Security / immobilizer no-start, key-won't-turn, starter-cut designs, security light semantics** —
  `systems/body-glass-water-leaks-keys.dossier.md` §2/§3 FM-7 + §6 (Halderman immobilizer/anti-theft, Tier 2;
  Rick's Free Auto Repair Advice, Tier 3).
- **Hybrid/EV 12 V-aux won't-go-to-READY, HV reduced-power/turtle, hybrid master warning, 12-V-first
  ordering** — `systems/hybrid-ev-high-voltage.dossier.md` §2/§3.1/§3.3 (US DOE AFDC hybrid + all-electric,
  Tier 1; Bosch regen, Tier 1; Nissan LEAF OM, Tier 1).
- **Fact-slot enums** — `scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts` (`engine_running`,
  `lights_state`, `warning_light_named`, `warning_light_behavior`, `vehicle_powertrain`, `recent_action`,
  `drivable_state`) verified against source 2026-07-18.
- **Linguistic authority (customer voice, never diagnostic)** — `real-concerns-tekmetric-labeled-v2.json`
  (Jeff's 500 labeled), `eval-cases.json`, `real-concerns-forums.json` (paraphrased patterns).

---

## 9. Router self-check (Gate-G2, reduced)

- [x] Every owned confusable pair (taxonomy §5.2 + the four in the brief) is in the decision tree AND has a
  `confusable_matrix_rows` entry with a discriminating fact, question, hedge rule, and A/B examples.
- [x] Decision tree is keyed on `engine_running` with `lights_state` / `warning_light_named` /
  `vehicle_powertrain` modifiers, and covers the click / crank-no-fire / silent / security-light / hybrid
  branches the brief mandates. Machine form emitted to `binding/no-start-decision-tree.md`.
- [x] Every negative example in the proposals file names a `routes_to`; proposed-slug routes are flagged.
- [x] Every hedge names its `discriminating_fact`; hedges that consolidate a Wave A per-system hedge are
  marked so Wave C dedups rather than double-applies.
- [x] Literalness guardrails (§6) restate the four inference traps the consumed dossiers flagged; golden
  cases in proposals include ≥1 inference-trap + ≥1 null-route.
- [x] Only ONE new subcategory originated here (`cranks_but_wont_fire`, Chris-gated); hybrid/security subcats
  are delegated/referenced, not re-proposed.
- [x] Customer-voice cues are real-corpus-first; synthetic (security branch especially) flagged, with the
  data-collection backlog noted.
