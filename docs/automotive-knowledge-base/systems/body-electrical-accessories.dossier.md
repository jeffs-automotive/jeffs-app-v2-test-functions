# Body electrical & power accessories — diagnostic dossier
slug: body-electrical-accessories   date: 2026-07-18
binds_services: [window_inop_testing, windshield_inop_testing, electrical_testing_general]
binds_categories: [electrical, noise]
bound_subcategories: [accessory_doesnt_work, multiple_random_electrical_glitches, electrical_buzzing]

> **Read-me for the binder:** two of the three bound services (`window_inop_testing`,
> `windshield_inop_testing`) are **direct-to-service** — the eval harness expects
> `stage2_subcategory_slug: null` for them (they own their whole category pool, so the wizard books
> the service without a Stage-2 pick; see `eval-cases.json` `window_inop_testing-001..004`,
> `windshield_inop_testing-001..004`). Only `electrical_testing_general` performs a Stage-2 pick among
> `accessory_doesnt_work` / `multiple_random_electrical_glitches` / `electrical_buzzing`. That asymmetry
> is the spine of the whole disambiguation: **glass-window motion is its own service; every other body
> accessory is "general electrical."** Where a `negative_example` must route to a direct-service target,
> its `routes_to` names the **service key** (window_inop_testing / windshield_inop_testing), because
> those services have no subcategory slug to name — flagged inline each time.

---

## 1. Scope & boundaries

**In scope** — customer-operated body/comfort/convenience electrical loads and the low-voltage logic that
drives them, when the complaint is *"this accessory doesn't do what it should"* or *"the car makes an
electrical buzz/glitches":*

- Power windows (glass regulators/motors/switches) — **owned by `window_inop_testing`**.
- Windshield & rear wipers + washer spray (motor, linkage, park switch, pump, nozzles) — **owned by
  `windshield_inop_testing`**.
- All other body accessories → **`electrical_testing_general`**: power door locks / central locking / key
  fob, power/heated/folding mirrors, power & heated seats, sunroof/moonroof & power liftgate/sliding door
  actuators, horn, radio/infotainment head unit & speakers, dome/courtesy/map lights, 12V outlets &
  cigarette-lighter sockets, USB ports, rear defroster grid, door chimes, blower-independent accessory
  circuits, exterior signal/marker bulbs when the complaint is *function* (not a dash warning light).
- Multiplex/body-control-module (BCM) faults, shared-fuse/shared-ground cascades, water-intrusion harness
  faults, and audible electrical buzz/relay chatter.

**Out of scope** (each with the owning neighbor):

| Out-of-scope complaint | Owner |
|---|---|
| Battery keeps dying overnight; had to jump it; slow crank | `charging-starting` → `charging_starting_testing` (subcats `battery_drains_overnight`, `slow_crank_sluggish_start`, `wont_crank_just_clicks`) |
| Headlights/dash lights dim or flicker, brighten when revving | `charging-starting` → `charging_starting_testing` (subcat `dim_or_flickering_lights`) — alternator/charging, NOT body accessory |
| Whole car went dark & died while moving | electrical cat `car_died_while_driving_electrical` (charging/main-power) |
| A named dash warning light (airbag/SRS, ABS, TPMS, CEL, battery, brake) | the light-specific service (`airbag_srs_testing`, `abs_traction_stability_testing`, `tpms_testing`, `check_engine_light_testing`, `warning_light_general`) |
| Key fob won't unlock **and the car won't start** / flashing security or anti-theft light / phantom alarm | `body-glass-water-leaks-keys` — the keys/immobilizer lane. Fob *electronics* (lock/unlock with the car still starting) are the **shared** `accessory_doesnt_work` surface; a **no-start** immobilizer complaint is theirs. Discriminator = **car starts vs. won't start** (their D6). Cross-ref §7. |
| Clicking/tapping/whirr behind dash tied to changing temperature or airflow (blend-door actuator) | `hvac` → `strange_noise_from_vents` |
| Blower fan itself won't blow / weak airflow | `hvac` → `ac_performance_check` (subcats `vents_dont_blow_strongly`, etc.) |
| Foggy windows the defroster can't clear | `hvac` → `foggy_or_hard_to_defog_windows` |
| Whining under the hood (belt/alternator/PS pump) | `noise` → `high_pitched_whining_under_the_hood` / `power_steering_eps_testing` |
| "Replace this bulb / wiper blade / turn signal" as a task order with no fault described | **null route → advisor** (work-order line, §8) |

---

## 2. System primer (expert, CITED)

Modern body-electrical accessories are **switch → logic → actuator** circuits. In vehicles roughly pre-2000
each accessory had a dedicated feed (switch → relay/fuse → motor → ground). Beginning in the late 1990s
automakers progressively moved body accessories onto a **multiplexed architecture**: a **Body Control
Module (BCM)** reads low-current switch inputs and commands the loads over a shared **serial data bus**
(CAN/LIN), so a single module controls windows, locks, lighting, wipers, chimes and more instead of
point-to-point wiring (GM's '97–'98 BCMs are an early, well-documented example)
[BodyShop Business, "Electrical Troubleshooting," collision-repair trade press, Tier 3 — GM '97–'98
BCM-specific, corroboration only, accessed 2026-07-18;
https://www.bodyshopbusiness.com/electrical-troubleshooting/]. This matters diagnostically, and the
diagnostically load-bearing conclusion is corroborated by a second independent source: **when several
loads that share a fuse, ground, connector, or BCM misbehave together, the fault is usually one shared node
(a corroded connector, a soft-failing fuse, a bad ground, or the module) — not each accessory
independently** [BodyShop Business, Tier 3, accessed 2026-07-18] [Advance Auto Parts, "How to Diagnose a
Broken Wiring Harness," retailer-technical, Tier 3, accessed 2026-07-18;
https://shop.advanceautoparts.com/r/car-projects/how-to-diagnose-a-broken-wiring-harness]. *(No Tier-1/2
OEM or textbook source was accessible for this consumer-accessory domain; trade-press + retailer-technical
how-tos are treated as Tier-3 and every mechanism claim below rests on two independent Tier-3 sources or is
reduced to a literal-only routing note — see §10.)*

**Power windows.** A reversible DC motor drives a **regulator** (scissor-type, or cable-and-pulley "sash"
type) that raises/lowers the glass. The customer-visible failure signatures are well-characterized:
complete no-response (seized regulator, dead motor, failed switch, blown fuse); **grinding/clicking while
holding the switch** (frayed regulator cable or stripped gear teeth); glass that **stalls partway** or is
**slow**; and glass that **drops into the door** and won't come up (broken cable/stripped drive). These
failure signatures are corroborated across two independent Tier-3 sources
[O'Reilly Auto Parts how-to hub, retailer-technical, Tier 3, accessed 2026-07-18;
https://www.oreillyauto.com/how-to-hub/what-are-the-symptoms-of-bad-power-windows] [AutoZone DIY,
retailer-technical, Tier 3, accessed 2026-07-18; https://www.autozone.com/diy/glass/car-window-not-working].
(A "hum with no glass movement vs. dead silence" tell is diagnostically useful but rests on a single
unverifiable retailer page, so it is **not** asserted here — the customer rarely states it anyway, and the
service performs that split.)

**Wipers & washers.** A wiper motor drives a **linkage/transmission** that converts rotation to the arms'
sweep; an internal **park switch** ensures the motor completes its cycle and returns the blades to rest.
Characteristic failures: no movement at all (motor/fuse/switch); **stops/parks mid-glass** (failed park
switch); **one arm lags the other** (loose/bent linkage joint); slow/weak sweep (worn motor, corrosion,
low voltage); and **grinding under the cowl** (worn motor gears or seized linkage). **Washer-not-spraying**
is a separate sub-circuit — washer pump, hose, or clogged nozzles — even though the customer calls the
whole thing "wipers" [PartCatalog, "Signs Your Wiper Motor Is Failing," retailer-technical, Tier 3,
accessed 2026-07-18;
https://www.partcatalog.com/blogs/wiper-and-washer/signs-your-wiper-motor-is-failing-symptoms-to-watch]
[YourMechanic, "Bad or Failing Windshield Wiper Motor," practitioner, Tier 3, accessed 2026-07-18;
https://www.yourmechanic.com/article/symptoms-of-a-bad-or-failing-windshield-wiper-motor]. **Seized or
binding linkage** — from rust, debris, or misalignment — forces the motor to work harder and can burn it
out (two independent Tier-3 sources: PartCatalog "seized or binding linkage," YourMechanic "no movement /
slow-weak sweep"). *(An earlier draft added "ice jams the arms and blows the fuse"; neither cited source
states the fuse-blow, so that specific has been dropped.)*

**Shared-node & water-intrusion cascades.** Because door circuits flex thousands of times, the **door-jamb
harness** is a classic wear point — chafed/broken conductors produce **intermittent** window/lock/mirror/
speaker faults. Water reaching connectors (via a **clogged sunroof drain**, windshield/cowl seal leak, or
door-membrane failure) corrodes pins (green/white oxidation → high resistance) and produces "gremlins"
that **track with damp/rainy weather** and often hit **multiple accessories that share a fuse or ground**
[Advance Auto Parts, "How to Diagnose a Broken Wiring Harness," retailer-technical, Tier 3, accessed
2026-07-18; https://shop.advanceautoparts.com/r/car-projects/how-to-diagnose-a-broken-wiring-harness]
[BodyShop Business, Tier 3 (trade press), accessed 2026-07-18]. **This water-intrusion path is the shared
seam with `body-glass-water-leaks-keys`** (§7): when the customer leads with *water* ("wet carpet, and now
the electrics act up") the leak dossier owns it; when they lead with the *electrical* malfunction it stays
here. An audible **electrical buzz/hum with the key on** is a recognized body-electrical symptom, but no
independent Tier-2/3 source in this pass supports a specific buzz *cause* — so this dossier treats the buzz
as a **literal symptom only** (routing to `electrical_buzzing`) and asserts no mechanism; the live
`electrical_buzzing` subcategory already records the shop-side hypotheses (a stuck relay rapidly cycling, a
solenoid/actuator, or a module) for the diagnostic service to confirm.

**US-market calibration.** Jeff's corpus is dominated by mainstream US windows/wipers/horn/locks/radio/
signal complaints; there is no meaningful Euro-only accessory volume, so this dossier does not spend depth
on Euro comfort-module quirks.

---

## 3. Failure-mode catalog  ← diagnostic spine (CITED)

> Sensory signatures use fact-slot vocabulary where the customer literally supplies it. **Nothing here
> tells the extractor to *infer* a mechanism** — the mechanism column is for the human reader; the
> classifier only ever sees the customer's literal words.

### FM-1 — Power-window regulator/motor: complete no-response
- **Signature:** `accessory_affected` = "<x> window"; customer says "won't go up/down", "nothing happens".
  Often `location_side` (driver/passenger → left/right) and/or `location_axle` (rear → rear).
- **Modifiers:** may be `started_when` = today/days_ago; `onset_timing` = intermittent if "once in a while".
- **Drivability:** `drivable_normally` (glass stuck **down** in weather → `drivable_but_concerned`).
- **Misattribution:** customers say "window switch is broken" — could be switch, motor, regulator, or fuse;
  the *service* diagnoses which. [O'Reilly Tier 3; AutoZone Tier 3, accessed 2026-07-18]
- **Routes:** `window_inop_testing` (direct, null subcat).

### FM-2 — Power-window regulator cable/gear failure: grinding, stalls partway, glass drops
- **Signature:** `noise_descriptor` = grinding_metallic ("horrible grinding noise when i hold the switch");
  glass "stuck halfway", "falls into the door". [O'Reilly Tier 3; AutoZone Tier 3, accessed 2026-07-18 —
  both cover grinding/cable-fray and glass dropping into the door]
- **Literalness note (reader):** "grinding when I hold the switch" sets `noise_descriptor=grinding_metallic`
  and nothing more — do NOT infer regulator-vs-motor. (An earlier draft carried a single-source "hum + no
  motion = regulator" tell; dropped — one unverifiable retailer page cannot carry it.)
- **Routes:** `window_inop_testing` (direct, null subcat). Corpus: `window_inop_testing-001`.

### FM-3 — Wiper motor / linkage / park-switch fault
- **Signature:** `accessory_affected` = "wipers"; "stopped working", "moving slower than normal", "stall
  halfway", "one side hardly moves", "rear wiper goes then stops". `noise_descriptor` = grinding_metallic
  if "grinding when i turn them on".
- **Modifiers:** `recent_action` = car_wash_or_driven_through_water ("quit right after the car wash");
  `weather_condition` = rainy_or_wet / after_snow_or_ice (ice-jammed linkage); `started_when`.
- **Misattribution:** "wiper motor" blamed when it's often the **linkage/park switch**; the service sorts it.
  [PartCatalog Tier 3; YourMechanic Tier 3, accessed 2026-07-18]
- **Routes:** `windshield_inop_testing` (direct, null subcat). Corpus: `windshield_inop_testing-001..004`,
  tkc-107, tka-111.

### FM-4 — Washer-spray fault (pump / hose / nozzle)
- **Signature:** "wipers not spraying", "washer doesn't come out"; `accessory_affected` = "washer/wipers".
- **Note:** same service as FM-3 (`windshield_inop_testing`), different sub-circuit; no routing split, but a
  distinct customer phrasing cluster. Corpus: tka-111 "WIPERS NOT SPRAYING".
- **Routes:** `windshield_inop_testing` (direct, null subcat).

### FM-5 — Single non-window accessory dead (horn, radio, one light, one lock, outlet, mirror, seat)
- **Signature:** `accessory_affected` names ONE non-window load ("horn", "radio", "dome light", "power
  locks", "cigarette lighter", "heated seat", "turn signal"); "doesn't work", "is just dead", "inoperable".
- **Modifiers:** `location_side` for a lateral accessory ("driver side mirror"); `onset_timing` = intermittent.
- **Mechanism (reader):** blown fuse, dead actuator/motor, failed switch, broken feed/ground.
  [Advance Auto Parts Tier 3 (wiring / broken feed / ground) + BodyShop Business Tier 3 (switch-input →
  BCM → load logic), accessed 2026-07-18 — two independent Tier-3]
- **Routes:** `electrical_testing_general` → **`accessory_doesnt_work`**. Corpus: tkc-153/tka-166 (horn),
  tka-035 (turn signal), tka-018 (dome light), `electrical_testing_general-002` (radio).

### FM-6 — Blown-fuse-on-load (accessory keeps popping its fuse)
- **Signature:** "cigarette lighter fuse keeps blowing", "replaced the 15A fuse and it blew again".
- **Literal-only (reader):** the customer states one literal fact — *the fuse keeps failing.* A single
  Tier-3 page (Advance Auto) attributes repeat-blow to a short, but one Tier-3 alone cannot carry a
  mechanism claim, so **no cause is asserted here**; the routing rests entirely on the literal words and the
  diagnostic service locates the short. `accessory_affected` = the named load; do NOT infer where the short
  is.
- **Routes:** `electrical_testing_general` → **`accessory_doesnt_work`**. Corpus: forum lighter-fuse cluster.

### FM-7 — Multiple unrelated accessories glitch randomly over time (multiplex/BCM/ground/water)
- **Signature:** several *different* systems act up on *different* days, **intermittently**; "radio resets,
  then the locks click on their own, then the gauges jump"; `onset_timing` = intermittent; frequently
  `weather_condition` = rainy_or_wet / humid ("worse after rain", "during damp conditions").
- **Mechanism (reader):** shared ground/connector corrosion, door-harness chafe, water intrusion, or a
  failing BCM. [BodyShop Business Tier 3 (BCM/shared-node) + Advance Auto Parts Tier 3 (harness/water/
  shared-fuse), accessed 2026-07-18 — two independent Tier-3]
- **Drivability:** usually `drivable_normally`.
- **Routes:** `electrical_testing_general` → **`multiple_random_electrical_glitches`**. Corpus:
  `electrical_testing_general-004`, forum "radio/clock/door-locks/fob" cluster, tkc (multi-symptom).

### FM-8 — Multiple accessories on ONE circuit die *together and stay dead* (shared fuse/ground)
- **Signature:** two-plus loads fail **simultaneously and persistently** (not random over time): "power
  window controls **and** the radio stopped working at the same time"; `accessory_affected` lists both.
- **Boundary (reader):** *simultaneous + persistent* → shared-fuse/ground → treat as
  **`accessory_doesnt_work`** (one circuit); *random + intermittent + different systems over time* →
  **`multiple_random_electrical_glitches`**. Genuinely ambiguous cases hedge across both (§5).
  [BodyShop Business Tier 3 (BCM cascade) + Advance Auto Parts Tier 3 (loads on a shared fuse/ground fail
  together), accessed 2026-07-18 — two independent Tier-3]
- **Routes:** `electrical_testing_general` → **`accessory_doesnt_work`** (hedge: multiple_random). Corpus:
  forum "power window controls and radio stopped" (fuse checked).

### FM-9 — Audible electrical buzz / hum with key on
- **Signature:** `noise_descriptor` = buzzing; "weird electrical buzzing, like a beehive"; "with the key
  on it makes a buzzing/humming noise"; `sound_or_smoke_location_zone` = behind_dashboard if located.
- **Literal-only (reader):** routing rests on the literal buzz/hum words alone. **No mechanism is asserted**
  — the cited sources in an earlier draft (BodyShop Business / O'Reilly) do not actually discuss relay
  chatter, so that claim was removed rather than left uncited. The live `electrical_buzzing` subcategory
  description already carries the shop-side hypotheses (stuck relay cycling, solenoid/actuator, module) for
  the diagnostic service; the classifier only ever sees the customer's literal "buzz/hum."
- **Routes:** `electrical_testing_general` → **`electrical_buzzing`**. Corpus:
  `electrical_testing_general-006`, forum "key-on buzzing/humming".

### FM-10 — Interior/dash light stays ON when it should be off (dome/courtesy)
- **Signature:** "dome light stays on even after closing the door"; `accessory_affected` = "dome light".
- **Trap (reader):** this is a **courtesy light**, NOT a dashboard **warning** light — `warning_light_named`
  MUST stay null (§9). (Cause hypotheses — door-jamb switch, dimmer/BCM logic — are omitted: uncited, and
  not needed for routing.)
- **Routes:** `electrical_testing_general` → **`accessory_doesnt_work`**. Corpus: tka-018 — **isolated from a
  two-concern RO line**; the real text pairs "DOME LIGHT STAYS ON EVEN AFTER CLOSING DOOR" with "TRACTION
  CONTROL LIGHT STAYING ON," and that traction-control half belongs to the warning-light lane, not here.

---

## 4. Customer-language lexicon  ← binds synonyms / keywords / positive_examples

Real-voice phrasings (Tekmetric corpus first, NHTSA/forum paraphrase second, synthetic flagged & capped
~30%). Full machine form in `body-electrical-accessories.lexicon.yaml`.

**Windows → `window_inop_testing` (direct):** "Passenger Side Window won't go down" (tekmetric tkc-067),
"DRIVER REAR WINDOW INOP" (tekmetric tka-194), "window motor stuck" (tekmetric tkc-151), "drivers side
window is stuck halfway down… grinding noise when i hold the switch" (eval), "both back windows stopped
rolling down, the switches dont do anything" (eval), "power window won't roll up" (synthetic).

**Wipers/washer → `windshield_inop_testing` (direct):** "Wipers stopped working" (tekmetric tkc-107),
"WIPERS NOT SPRAYING" (tekmetric tka-111), "Rear wiper starts to go and stops halfway" (tekmetric tkc-281),
"wipers barely work when its raining… passenger side one hardly moves" (eval), "windshield wipers totally
quit right after the car wash" (eval), "wipers moving way slower than normal and stall halfway" (eval).

**Single accessory → `accessory_doesnt_work`:** "HORN INOPERABLE" / "HORN INOP" (tekmetric tkc-153,
tka-166), "my radio is just dead, screen wont turn on and no sound at all, everything else works fine"
(eval), "RIGHT REAR TURN SIGNAL NOT WORKING INTERMITTENTLY… bumped it and it worked then went out"
(tekmetric tka-035), "dome light stays on even after closing door" (tekmetric tka-018 — dome-light fragment
isolated from a two-concern line whose other half is a traction-control warning light), "cigarette lighter
fuse keeps blowing" (forum-paraphrase), "power door locks quit working with the key fob" (forum-paraphrase —
routes here **only if the car still starts**; a fob-and-no-start complaint is the `body-glass-water-leaks-keys`
immobilizer lane, §7), "heated seat on the driver side stopped working" (synthetic).

**Random gremlins → `multiple_random_electrical_glitches`:** "one day the radio resets itself, next day the
door locks click on their own, next day the gauges jump around… always worse after rain" (eval), "the radio
and clock quit, then the power door locks quit with the fob, then…" (forum-paraphrase), "during damp or cold
conditions the windows, wipers, door chime and dome lights all quit, then a click and they come back"
(forum-paraphrase).

**Buzz → `electrical_buzzing`:** "weird electrical buzzing sound in my car, kinda sounds like a beehive"
(eval), "with the key turned to on it makes a buzzing or humming noise" (forum-paraphrase), "buzzing coming
from behind the dash" (synthetic).

Messiness observed & kept: ALL-CAPS Tekmetric fragments ("HORN INOP TESTING AUTH 179"), mixed
symptom+request ("… can you figure out whats wrong with it?"), part-name vagueness ("switches dont do
anything"), intermittent hedges ("once in a while", "then it went back out").

---

## 5. Differential & discriminating questions  ← binds required_facts + slots

Each row: confusable pair → the ONE best discriminator → the fact slot + value that answers it.

| Pair | Discriminating question | Slot → value |
|---|---|---|
| **`window_inop_testing` ↔ `electrical_testing_general`/accessory_doesnt_work** (THE pair) | "Is it the **glass window** that won't move, or a different accessory (lock/mirror/seat/sunroof/radio/horn)?" | `accessory_affected` contains "window" (glass) → window_inop; any other load → accessory_doesnt_work |
| **`windshield_inop_testing` ↔ accessory_doesnt_work** | "Is it the **wipers/washer**, or another accessory?" | `accessory_affected` = "wipers"/"washer" → windshield_inop; else accessory_doesnt_work |
| **accessory_doesnt_work ↔ multiple_random_electrical_glitches** | "Is it **one specific thing that's always dead**, or **several different things acting up at random**?" | one load in `accessory_affected` + steady → accessory_doesnt_work; `onset_timing`=intermittent + multiple/varied → multiple_random |
| **accessory_doesnt_work (shared circuit, FM-8) ↔ multiple_random** | "Did they die **at the same moment and stay dead**, or come and go on **different days**?" | simultaneous+persistent → accessory_doesnt_work; intermittent-over-time → multiple_random. *No current slot captures "simultaneous-persistent vs random-over-time" cleanly → see slot proposal §9.* |
| **electrical_buzzing ↔ `high_pitched_whining_under_the_hood`** | "Is it a **buzz/hum** (relay-ish) or a **whine** that rises with engine RPM?" | `noise_descriptor` buzzing → electrical_buzzing; whining → whining subcat |
| **electrical_buzzing ↔ `strange_noise_from_vents`** (HVAC) | "Does the buzz change with **HVAC/temperature/airflow**, or is it just electrical with the key on?" | `sound_or_smoke_location_zone`=from_vents / `hvac_mode` set → HVAC; behind_dashboard + no HVAC tie → electrical_buzzing |
| **multiple_random_electrical_glitches ↔ `dim_or_flickering_lights`** (charging) | "Do the **lights dim/flicker and brighten when you rev**, or is it **random accessories** unrelated to RPM?" | `lights_state`=dim_at_idle_brighten_when_revving / dim_or_flickering → charging; varied accessories intermittent → multiple_random |
| **multiple_random_electrical_glitches ↔ `car_died_while_driving_electrical`** | "Did the **whole car go dark and shut off**, or do individual accessories glitch while it keeps running?" | `engine_running`=died_while_driving / `drivable_state`=not_drivable_needs_tow → car_died; accessories-only, still runs → multiple_random |
| **accessory_doesnt_work ↔ `airbag_srs_light` / other named lights** | "Is a **dashboard warning light** on, or is an accessory not functioning?" | `warning_light_named` set → the light-specific service; else accessory_doesnt_work |
| **window_inop_testing ↔ sunroof/moonroof (accessory_doesnt_work)** (trap) | "Is it a **side glass window**, or the **sunroof/moonroof panel**?" | `accessory_affected`="sunroof"/"moonroof" → accessory_doesnt_work (NOT window_inop) |

**Literalness guardrails.** "won't go up" sets `accessory_affected` + optionally `location_side`, NOT a
mechanism (regulator vs motor). "worse after rain" sets `weather_condition=rainy_or_wet`, not a root cause.
"grinding when I hold the switch" sets `noise_descriptor=grinding_metallic`; it does NOT set `location_side`
unless a side is named.

---

## 6. Warning lights & DTC surface

Body-electrical accessory faults **rarely** light a dedicated dash warning lamp — this system is mostly
"function doesn't work," not "a light came on." The important surface is the **inverse trap**:

- **Interior courtesy/dome lights** ("dome light stays on", "map light won't turn off") are **loads**, not
  warning indicators → `accessory_affected`, `warning_light_named` = **null** (FM-10, §9).
- **Door-ajar / seatbelt / washer-fluid-low chimes & telltales** are informational, not this system's
  concern unless the customer reports the accessory itself failing.
- If the customer DOES name a real warning light (airbag/SRS, ABS, TPMS, CEL, battery, brake, traction,
  power-steering) alongside an accessory complaint, the **named light wins routing** to its light-specific
  service (§5, §7). Customer nicknames feed `warning_light_named` verbatim ("the airbag light", "the little
  battery symbol") — but those belong to the router-warning-lights dossier, not here.

No accessory-specific DTC family is asserted here (BCM `U`-codes/`B`-codes exist but the customer never
states them; the diagnostic *service* pulls them). No uncited DTC claims.

---

## 7. Confusable neighbors (cross-system)

| Neighbor system / slug | Confusion | Discriminator (slot) | Cross-ref dossier |
|---|---|---|---|
| `charging_starting_testing` → `dim_or_flickering_lights` | flickering interior/dash lights read as "electrical glitch" | dims at idle / brightens on rev (`lights_state=dim_at_idle_brighten_when_revving`) → charging, not body | charging-starting |
| electrical cat `car_died_while_driving_electrical` | "everything went dark" reads as accessory failure | whole-car shutoff + not drivable (`engine_running=died_while_driving`) → car_died | router-no-start-power |
| electrical cat `battery_drains_overnight` / `slow_crank_sluggish_start` | "battery dies", "had to jump it" | battery/crank complaint, no specific accessory named → charging | charging-starting |
| `hvac` → `strange_noise_from_vents` | click/buzz behind dash tied to temperature/airflow (blend-door actuator) | `hvac_mode` set / `sound_or_smoke_location_zone=from_vents` → HVAC | router-nvh / hvac |
| `hvac` → `vents_dont_blow_strongly` / `foggy_or_hard_to_defog_windows` | "blower/defroster doesn't work" reads as accessory | airflow/defog complaint → HVAC (`airflow_state`, defrost) | hvac |
| `noise` → `high_pitched_whining_under_the_hood` / `power_steering_eps_testing` | buzz vs whine | `noise_descriptor` buzzing vs whining; under_hood + RPM-linked → whine | router-nvh |
| warning-light services (airbag/ABS/TPMS/CEL/battery/brake) | accessory complaint co-stated with a dash light | `warning_light_named` set → light service wins | router-warning-lights |
| `body-glass-water-leaks-keys` → keys/immobilizer lane | "key fob quit" / "power locks won't work with the remote" — is it a lock accessory, or a security no-start? | **car STARTS** (fob = lock/unlock accessory) → `accessory_doesnt_work` here (shared surface); **car WON'T START** / flashing security or anti-theft light → their immobilizer lane. Their **D6** discriminator: *does the car start or not?* | body-glass-water-leaks-keys |
| `body-glass-water-leaks-keys` → water-intrusion overlap | "water in my floorboard and now the electrical stuff acts up" — leak or electrical? | customer **leads with water** (wet carpet, sunroof-drain, leak) → the leak dossier owns it; customer **leads with the electrical malfunction** (accessories glitching, weather-linked) → `multiple_random_electrical_glitches` here. Same shared node, two front doors. | body-glass-water-leaks-keys |
| situational `after_recent_service_or_repair_work` | "cesar replaced the motor and it still does it" (tkc-281) | prior-repair cue can override symptom (Stage-1 PRIORITY-ORDER) | router-requests-maintenance |

---

## 8. Mapping to current taxonomy  ← binds catalog + subcategory proposals

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| FM-1 window no-response | window_inop_testing | electrical/other | *(direct — null subcat)* | good |
| FM-2 window grinding/stall/drop | window_inop_testing | electrical/other | *(direct — null subcat)* | good |
| FM-3 wiper motor/linkage/park | windshield_inop_testing | electrical/other | *(direct — null subcat)* | good |
| FM-4 washer spray | windshield_inop_testing | electrical/other | *(direct — null subcat)* | good (distinct phrasing cluster) |
| FM-5 single accessory dead | electrical_testing_general | electrical | accessory_doesnt_work | good |
| FM-6 keeps blowing a fuse | electrical_testing_general | electrical | accessory_doesnt_work | good |
| FM-7 random gremlins over time | electrical_testing_general | electrical | multiple_random_electrical_glitches | good |
| FM-8 shared-circuit simultaneous dead | electrical_testing_general | electrical | accessory_doesnt_work (hedge multiple_random) | **weak** — no slot separates simultaneous-persistent from random-over-time (§9 slot proposal) |
| FM-9 electrical buzz | electrical_testing_general | noise | electrical_buzzing | good |
| FM-10 dome light stays on | electrical_testing_general | electrical | accessory_doesnt_work | good |
| Work-order "replace bulb/wiper/signal" | — | — | **NO FIT → advisor null-route** | expected (non-concern; §golden) |

**No catalog gaps requiring a new *service*** for this system — the three services + three subcategories
cover the observed demand. The one structural weakness is **FM-8's slot expressibility** (below), and a
**Chris-gated** thought: because `window_inop_testing` and `windshield_inop_testing` are direct-to-service,
there is no Stage-2 subcategory to enrich for them — all their lift comes from L1 keywords + the lexicon.
No subcategory proposal is raised (existing pool is sufficient); see `proposals.yaml` for the deferred
slot proposal and one Chris-gated note.

---

## 9. Fact-slot audit

**Slots this system actively uses (with corpus-attested values):**

- `accessory_affected` (free text) — **the primary slot.** Attested: "driver window", "passenger window",
  "rear window", "wipers", "washer", "horn", "radio", "dome light", "power door locks", "key fob",
  "turn signal", "cigarette lighter", "heated seat", "sunroof". Drives the entire window-vs-general split.
- `noise_descriptor` — buzzing (FM-9), grinding_metallic (FM-2/FM-3).
- `location_side` — left/right from "driver side"/"passenger side" ("DRIVER REAR WINDOW").
- `location_axle` — rear ("rear window", "both back windows").
- `onset_timing` — intermittent ("not working intermittently", "once in a while", "comes and goes").
- `started_when` — today/days_ago/months_ago.
- `weather_condition` — rainy_or_wet / humid ("worse after rain", "during damp conditions") — the water-
  intrusion tell for FM-7.
- `recent_action` — car_wash_or_driven_through_water (wipers quit after car wash — FM-3).
- `sound_or_smoke_location_zone` — behind_dashboard (buzz location).
- `customer_request_type` — diagnose_problem / fix_a_known_problem; a `replace_specific_part` cue ("replace
  the right front turn signal") drives the null-route work-order detection.
- `drivable_state` — mostly drivable_normally (accessories don't strand); drivable_but_concerned when glass
  is stuck down or wipers dead in rain.
- `lights_state` — used as an **exclusion** cue (dim_or_flickering / dim_at_idle_brighten_when_revving →
  route AWAY to charging, §5/§7), not as an in-system positive.

**Missing values customers actually state:** none requiring an enum extension on existing slots —
`accessory_affected` is free-text and already absorbs new accessory names.

**Proposed new slot (deferred, ≥3-question rule met):** `accessory_failure_scope` —
values `single_accessory` | `multiple_accessories_at_once` | `random_intermittent_glitches` |
`whole_zone_dead`. **Why:** the FM-5 vs FM-7 vs FM-8 routing hinges on a "how many / how patterned" axis
that no current slot expresses; today it is inferred from counting `accessory_affected` entries plus
`onset_timing=intermittent`, which is fragile. **Literal cues (verbatim):** "just the radio" / "only my
driver window" → single_accessory; "the windows and radio both quit at the same time" →
multiple_accessories_at_once; "random different stuff every day", "worse after rain, then it comes back" →
random_intermittent_glitches; "the whole dash went dead" → whole_zone_dead. **Questions unlocked (≥3, and
these already exist LIVE with `required_facts=[]`, confirmed against the 2026-07-18 DB snapshot):**
`accessory_doesnt_work` **q1632** ("If it's a window or lock, does only one of them not work, or do several
of them… not work?"); `multiple_random_electrical_glitches` **q554** ("Do the glitches happen at the same
time… or do different things act up at different times?"); and (as an exclusion) the "did the whole car go
dark?" split from `car_died_while_driving_electrical`. Those two live questions are the natural binding
home for the slot once approved. Deferred to Wave B/C + Chris — do NOT auto-add.

---

## 10. Sources

**Tiering note (honest):** no Tier-1 (OEM/SAE/ASE) or Tier-2 (textbook/OER/parts-manufacturer technical
training) source was accessible for this consumer-facing body-accessory domain in this pass. Per
`source-policy.md`, **trade press does NOT qualify as Tier-2** — so BodyShop Business is treated as **Tier 3**,
and retailer-technical how-to hubs are Tier 3. The rule then requires **two independent Tier-3 sources**
(or Tier-3 + Tier-2) for any mechanism claim; where two could not be assembled, the claim was **reduced to a
literal-only routing note** (FM-6, FM-9) that asserts no mechanism and therefore needs no cite.

Diagnostic/differential claims (§2/§3):
- BodyShop Business, "Electrical Troubleshooting" — collision-repair **trade press (Tier 3)**; the fetched
  article is specifically about GM '97–'98 BCMs. Used only to corroborate the BCM/multiplex + shared-node
  cascade claims, **never as a sole source**. Accessed 2026-07-18.
  https://www.bodyshopbusiness.com/electrical-troubleshooting/
- O'Reilly Auto Parts how-to hub, "Symptoms of Bad Power Windows" — retailer-technical (Tier 3) — window
  no-response, grinding/cable fray, glass dropping into the door. *(The page 403s to re-fetch; the "hum with
  no motion" tell it was cited for is unverifiable, so that specific tell has been dropped from §2/§3.)*
  Accessed 2026-07-18. https://www.oreillyauto.com/how-to-hub/what-are-the-symptoms-of-bad-power-windows
- AutoZone DIY, "Car Window Not Working" — retailer-technical (Tier 3) — window motor/regulator failure
  modes incl. glass dropping. Pairs with O'Reilly as the second independent Tier-3 for the window
  signatures. Accessed 2026-07-18. https://www.autozone.com/diy/glass/car-window-not-working
- PartCatalog, "Signs Your Wiper Motor Is Failing" — retailer-technical (Tier 3) — **verified 2026-07-18**:
  six symptoms (slow/inconsistent, stop mid-stroke, one blade faster, no movement, grinding/chattering/
  squeak, intermittent) + **"seized or binding linkage"** from rust/debris forcing the motor to work
  harder. *(Corrected URL — the prior `…-symptoms` link 404s; the live article is `…-symptoms-to-watch`.
  The article does NOT state ice jams "blow the fuse," so that claim was removed.)* Accessed 2026-07-18.
  https://www.partcatalog.com/blogs/wiper-and-washer/signs-your-wiper-motor-is-failing-symptoms-to-watch
- YourMechanic, "Bad or Failing Windshield Wiper Motor" — practitioner (Tier 3) — **verified 2026-07-18**:
  slow/weak sweep, no movement, single-speed-only, wrong park position. *(It does NOT describe a
  "hum-with-no-movement" tell — the earlier attribution was wrong and has been corrected.)* Second
  independent Tier-3 for the wiper signatures alongside PartCatalog. Accessed 2026-07-18.
  https://www.yourmechanic.com/article/symptoms-of-a-bad-or-failing-windshield-wiper-motor
- Advance Auto Parts, "How to Diagnose a Broken Wiring Harness" — retailer-technical (Tier 3) — door-harness
  chafe, water intrusion, shared-fuse/ground cascades, shorts. Second independent Tier-3 alongside BodyShop
  for the shared-node claims. Accessed 2026-07-18.
  https://shop.advanceautoparts.com/r/car-projects/how-to-diagnose-a-broken-wiring-harness

**Corroboration ledger (per §3 mechanism claim):** FM-1 O'Reilly + AutoZone (2×T3); FM-2 O'Reilly + AutoZone
(2×T3); FM-3 PartCatalog + YourMechanic (2×T3); FM-4 sub-circuit note (no mechanism asserted); FM-5 Advance
Auto + BodyShop (2×T3); FM-6 **literal-only, no mechanism asserted**; FM-7 BodyShop + Advance Auto (2×T3);
FM-8 BodyShop + Advance Auto (2×T3); FM-9 **literal-only, no mechanism asserted**; FM-10 no mechanism
(cause hypotheses omitted as uncited). Denylisted listicle/AI-blog/cost-estimator hits were excluded.

Language artifacts (§4, lexicon, examples): Tekmetric corpus
`real-concerns-tekmetric-labeled-v2.json` (tkc-067, tkc-107, tkc-151, tkc-153, tkc-281, tka-018, tka-035,
tka-166, tka-194, tka-111) + `eval-cases.json`
(`window_inop_testing-001..004`, `windshield_inop_testing-001..004`, `electrical_testing_general-002/004/006`)
+ `real-concerns-forums.json` (radio/clock/door-lock cascade; lighter-fuse; key-on buzz; damp-condition
multi-accessory) — provenance tagged per lexicon entry.

**Provenance honesty (flag, not hidden):** the lexicon separates **real** customer ROs (`tekmetric`) from
**authored eval fixtures** (`eval-authored`) — the latter come from `eval-cases.json`, which
`source-policy.md` bundles under "the Tekmetric corpus" but which are *not* real customer utterances. Of the
~30 lexicon entries, real Tekmetric ROs are ~9, forum-paraphrase ~9, `eval-authored` 7, and `synthetic` 5.
Counting `eval-authored` + `synthetic` as non-real, the **non-real share is ~12/30 ≈ 40%, which exceeds the
~30% target** — flagged here per the customer-voice rule. Remediation (backlog, Chris/Wave-C): mine more
real Tekmetric ROs for these subcats to dilute the authored/synthetic share; an earlier draft masked the
overage by tagging `eval-authored` entries as `tekmetric`.

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Binds ONLY to existing slugs/services (window_inop_testing, windshield_inop_testing,
  electrical_testing_general; accessory_doesnt_work, multiple_random_electrical_glitches, electrical_buzzing;
  categories electrical + noise). No invented taxonomy bound; proposals isolated in `proposals.yaml`.
- [x] Every §3 **mechanism** claim rests on **two independent Tier-3 sources** OR is reduced to a
  literal-only routing note with no mechanism asserted (FM-6, FM-9); **no diagnostic claim from memory and
  no single-Tier-3 mechanism claim remains**. BodyShop Business is reclassified **Tier 3** (trade press —
  Tier-2 per `source-policy.md` is textbooks/OER/parts-manufacturer training only, not trade press); no
  Tier-1/2 source was accessible for this domain (see §10 tiering note + corroboration ledger). *(This box
  was previously checked with a false "Tier-2 + Tier-3" claim; corrected 2026-07-18 revision pass.)*
- [x] The mandated confusable pair (window_inop_testing ↔ electrical_testing_general) resolved in §5/§7 with
  the `accessory_affected` discriminator, plus 8 additional cross-system discriminators.
- [x] Every negative_example in `proposals.yaml` names a `routes_to` (subcat slug, or service key where the
  target is direct-to-service, flagged).
- [x] Synonyms are ≥2 tokens or domain tokens (TPMS-style); no bare "noise/light/leak/problem".
- [x] Fact cues are literal (accessory_affected/noise_descriptor/weather_condition only when stated).
- [x] ≥8 golden cases incl. 1 inference-trap (FM-10 dome light → warning_light_named MUST be null) and 1
  null-route (work-order "replace turn signal").
- [x] New slot proposal (`accessory_failure_scope`) meets ≥3-question rule (two of its three questions —
  q1632, q554 — already exist live) and is deferred/Chris-gated, not auto-applied.
- [x] Binding validity: `question.required_facts.set` ops carry RESOLVED live question_ids (1631/1633/1634/
  1635/556/135) with verbatim question_text; the invalid `stage2_acceptable` golden-case field was removed
  (hedge moved to prose); `drivable_state` value corrected to the real enum `not_drivable_needs_tow`;
  `customer_request_type` cue uses the real enum `replace_specific_part`.
- [~] **Provenance overage FLAGGED (not clean):** real-voice share is below target — non-real
  (`eval-authored` + `synthetic`) ≈ 40% vs ~30% goal (§10 provenance-honesty note). `eval-authored`
  relabeled from a prior over-broad `tekmetric` tag; remediation deferred to Chris/Wave-C (mine more real
  ROs).
- [x] Neighbor coordination two-way: `body-glass-water-leaks-keys` cross-referenced for the fob/immobilizer
  boundary (their D6: car starts vs. won't start) and the water-intrusion overlap (§1, §4, §7, lexicon).
- [x] US-market calibration; Spanish-language phrasings not improvised (backlog note deferred to Chris).
