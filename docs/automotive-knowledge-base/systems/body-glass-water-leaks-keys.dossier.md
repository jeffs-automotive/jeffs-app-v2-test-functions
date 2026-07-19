# Body, glass, water leaks & keys/security — diagnostic dossier
slug: body-glass-water-leaks-keys   date: 2026-07-18   binds_services: [electrical_testing_general, window_inop_testing, windshield_inop_testing, no_start_testing, charging_starting_testing, ac_leak_testing, coolant_leak_testing]   binds_categories: [electrical, leak, warning_light, noise, other]

> **Orientation for the reader.** This is the taxonomy's largest *no-catalog-fit* cluster. Jeff's sells
> symptom-diagnostic *tests* (brakes, HVAC, no-start, leaks…). Bodywork, glass, weatherseals, latches,
> and mechanical key/lock cylinders are **not** things this shop's booking catalog has a test/fee for —
> they are body-shop / locksmith / glass-vendor work. So the dominant correct behavior for a big slice of
> this system is **route to advisor** (empty Stage-1), NOT force-fit a test. The narrower slice that DOES
> fit is the *electrical* half: power locks, keyless-entry/fob electronics, security/immobilizer no-start,
> and water-intrusion electrical gremlins — those route to `electrical_testing_general` (and its no-start
> neighbors). This dossier's job is to (a) keep the electrical half routing correctly, (b) stop the body
> half from being mis-routed into a paid test, and (c) surface the two catalog gaps (interior water-leak
> diagnosis; key/immobilizer) with demand evidence for Chris.

---

## 1. Scope & boundaries

**In scope**
- **Water intrusion into the cabin** (wet carpet/headliner/footwell after rain or a car wash; clear,
  odorless): plugged sunroof drains, cowl/plenum drains, door weatherstrip/vapor-barrier, windshield &
  body-seam seals, door-glass run channels.
- **Wind noise / air whistle** at speed from door seals, glass fitment, mirror/trim.
- **Body rattles & squeaks** originating in doors, trim, headliner, or trunk/cargo area (NOT driveline,
  NOT exhaust/heat-shield, NOT suspension).
- **Doors / latches / trunk / liftgate / hood** mechanical (won't open/close/latch, pops open, handle broken)
  and their **electrical** actuators (power-lock actuator, trunk-release solenoid, keyless entry).
- **Keys & security**: key fob remote functions (lock/unlock/remote-start), keyless/proximity start,
  transponder/immobilizer "won't recognize key," anti-theft/security dash light, key won't turn in cylinder,
  **key stuck in the ignition / won't come out**, and the **anti-theft ALARM sounding / horn honking on its
  own / alarm won't disarm** (the audible-security-fault side, distinct from the immobilizer no-start).
- **Glass** condition (chip/crack/delamination) as a *no-fit / advisor* concern.

**Out of scope (owned elsewhere)**
- Power-**window glass motion** (stuck, slow, off-track, grinding regulator) → `window-inop` surface,
  service `window_inop_testing`. This dossier owns locks/latches/security; the *glass going up/down* is theirs.
- Wiper operation / wiper arm / linkage → `windshield_inop_testing` (that service is **wipers**, not the
  windshield *glass itself*). A cracked windshield is body/glass (this dossier, no-fit).
- Fogged/hard-to-defog glass, musty A/C smell, evaporator condensation *management* → HVAC dossier
  (`ac_performance_check`; subcats `foggy_or_hard_to_defog_windows`, `musty_mildew_smell_from_vents`).
- Fluid puddles that are actually coolant/oil/trans/PS/brake → the **leaks** router + leak dossiers.
- No-start where the cause is battery/charging/starter (not security) → no-start / charging-starting dossiers.
- Airbag/SRS "little person" light, ABS/traction lights → their warning-light dossiers.
- General electrical accessories that are NOT lock/latch/security (radio, gauges, dome light) → the
  **`body-electrical-accessories` dossier is the canonical OWNER of `accessory_doesnt_work` and
  `multiple_random_electrical_glitches`** (and of the `key fob` / `power door locks` Stage-1 keywords +
  synonyms). This dossier does **not** re-emit those shared ops — it defers to the sibling's canonical
  revisions and contributes only the *delta* it uniquely owns: the immobilizer/security **no-start** fence,
  the electric **trunk/liftgate release** surface, the **anti-theft alarm sounding** mode, and the
  **water↔electrical** overlap. Where an op would touch a shared slug, it is marked `defer_to:
  body-electrical-accessories` in `.proposals.yaml` so Wave C dedups rather than applies two conflicting texts.
- **Lost-key / key-cutting / "need a new key made" / "only have one key" REQUEST language** (a service
  request, not a symptom) → `router-requests-maintenance` owns it (`customer_request_type`). This dossier
  owns only the *symptom* side (key won't turn, key stuck, immobilizer won't recognize the key).

---

## 2. System primer (expert, CITED)

**Body sealing & water management.** A modern unibody is *not* watertight by its outer skin; it relies on
a managed-drainage system. Rain that enters a door cavity is designed to exit through **door drain holes**;
a torn plastic/foam **vapor barrier (door membrane)** lets that water cross into the cabin instead. A
**sunroof** is intentionally not sealed — it drains through four corner tubes to the rocker/quarter; a
**clogged sunroof drain** backs water up and dumps it down the A-/C-pillar onto the carpet. The **cowl/plenum**
at the base of the windshield collects leaves and, when its drains block, overflows into the HVAC intake or
the passenger footwell. **Windshield/body-seam urethane** that is cracked, shrunk, or set improperly (often
after a glass R&R) leaks along the header. The discriminating rule is *source-by-correlation*: leaks that
appear only after rain or car washes are body/drainage; a wet **headliner/A-pillar** points to
sunroof/windshield, a wet **front passenger footwell that tracks A/C use** points to the evaporator/HVAC
drain, not the body [Duffy, *Auto Body Repair Technology* — "Water Leaks & Wind Noise" chapter, Tier 2;
trade-reference corroboration: Haynes Manuals, "How to Trace Interior Water Leaks in Your Car," accessed
2026-07-18].

**Weatherstrip & wind noise.** Door/window weatherstrip that has dried out, shrunk, or torn — and glass
that sits proud of or below its seal after a poor R&R — both admit water and open air paths that whistle at
highway speed; wind noise changes with **door/window fitment**, not engine load [Duffy, *Auto Body Repair
Technology* — "Trim, Hardware & Weatherstrip" / "Water Leaks & Wind Noise" chapters, Tier 2].

**Keys, transponders & the immobilizer.** Since the late-1990s most US vehicles carry a factory
immobilizer. A **transponder chip** in the key/fob is inductively energized by a coil (antenna ring) around
the ignition lock or, on push-button cars, by the proximity antenna; the chip returns a coded ID to the
immobilizer/BCM, which authorizes the ECM/PCM. Only on a valid match does the ECM enable fuel injection and
ignition; on a mismatch it withholds fuel and/or spark and the engine cranks but will not fire
[Halderman, *Automotive Electricity and Electronics* — "Immobilizer & Anti-Theft Systems" chapter, Tier 2].
In field terms the same mechanism reads as: "Without that authorization… the ECM simply refuses to deliver
fuel or spark," "the engine will crank but not start. In other designs, the starter won't even engage," and
"when the car anti-theft system fails, you'll often see a **flashing security light**" as the "first clue
that the immobilizer is blocking engine operation." Common causes: "dead key fob battery (on proximity
systems)," "damaged or water-soaked transponder key," "weak antenna ring around ignition cylinder," and
"aftermarket remote start installation errors"; scan tools report "Key Not Recognized" or "Immobilizer
Active" [Rick's Free Auto Repair Advice, "How an Auto Immobilizer Anti-theft System Works," Tier 3, accessed
2026-07-18]. **Architecture split that matters for routing:** *keyless/passive-entry & push-button-start*
cars fail differently from *bladed-key transponder* cars (dead-fob "won't wake up" vs. "won't recognize"),
and *aftermarket remote-start/alarm* installs are a frequent culprit for both no-start and phantom
lock/gremlin behavior.

**Anti-theft ALARM (audible) vs. immobilizer (no-start) — two different faults.** The *immobilizer* silently
blocks starting; the *alarm* is the audible perimeter system. An alarm that sounds on its own, honks the
horn, or won't disarm is almost always a **flaky normally-closed ajar switch** (door, hood, trunk/hatch) or
a worn courtesy-light switch feeding the security module a false "opened" signal; aftermarket alarm/remote-
start wiring spliced into the ignition is a frequent additional culprit
[Halderman, *Automotive Electricity and Electronics* — "Anti-Theft Systems" chapter, Tier 2; corroborated
by Free ASE Study Guides, "Components and Symptoms of Automotive Antitheft Systems," Tier 3, accessed
2026-07-18]. A **key stuck in the ignition / won't come out** is typically an interlock (shifter-not-in-Park
or a brake/ignition interlock solenoid) or a worn lock cylinder — mechanical/electrical, not the transponder
[Halderman, *Automotive Electricity and Electronics* — "Steering-Column & Ignition-Lock" material, Tier 2].

**Body electrical actuators.** Power locks (one actuator per door), trunk/liftgate release solenoids,
and keyless-entry receivers are ordinary body-electrical loads driven by the BCM: they fail individually
(one dead lock actuator) or en masse via a shared fuse/relay/BCM or ground [Halderman, *Automotive
Electricity and Electronics* — "Body Control Modules & Accessory Circuits" chapter, Tier 2]. **Water
intrusion into a door cavity, connector, or the passenger-footwell BCM** corrodes contacts and raises
circuit resistance, producing the classic "works intermittently, worse after rain/car wash" gremlin — the
water-and-electrical overlap unique to this system; door-lock actuators and their harness connectors are
specifically validated against salt-spray and temperature/corrosion cycling for exactly this reason
[Dorman Products, "Integrated Door Lock Actuators" engineering/testing page,
dormanproducts.com, Tier 2, accessed 2026-07-18].

---

## 3. Failure-mode catalog (the diagnostic spine, CITED per mode)

### FM-1 Interior water leak — clean rainwater intrusion
- Signature (slots): `sound_or_smoke_location_zone=passenger_footwell` / `inside_cabin_general` (the primary
  *inside*-cabin cue), `weather_condition=rainy_or_wet`,
  `recent_action=car_wash_or_driven_through_water`, `smell_descriptor=musty_or_mildew` (secondary, after it
  sits). **Do NOT set `fluid_color`** here: `fluid_color` is defined as the color of fluid seen *under the
  vehicle* (extracted-facts.ts), so it belongs to the under-car boundary case, not to water on the interior
  carpet. Interior water rarely comes with a stated color at all — the literal cue is *where* (inside) + *when*
  (rain/wash), not a color.
- Modifiers: worse after rain / car wash / on a slope (sunroof); wet **carpet/headliner INSIDE**, not a
  puddle under the car.
- Severity/drivability: `drivable_normally`; comfort/mold/electrical-risk, not a road hazard.
- Misattribution: customers call it "AC leaking inside" or blame the heater. True AC condensation drains
  *outside*; heater-core leak is *coolant* (sweet, greasy film) [Duffy, *Auto Body Repair Technology* —
  "Water Leaks & Wind Noise" chapter, Tier 2].
- **No catalog fit** — see §8 (proposal). Real-corpus proof it is currently misrouted: *"Water is leaking
  into the driver's side of my car. The floor is full of water!"* was consensus-labeled `ac_performance_check`,
  and *"front floor board, passenger side… you can visibly see water standing"* came back ambiguous between
  `ac_leak_testing` and `multiple_symptoms` (Jeff's corpus).

### FM-2 Wind noise / air whistle at speed
- Signature: `noise_descriptor` has no "whistle" value (gap; closest customer word is "whistling"/"air
  noise"); `speed_band=highway`, `onset_timing=during_driving`, `sound_or_smoke_location_zone` near a
  door/`inside_cabin_general`.
- Misattribution: confused with a tire hum or a wheel bearing (those are `humming_or_whirring`, speed-linked
  but not wind); wind noise changes with **window/door** state, not load [Duffy, *Auto Body Repair
  Technology* — "Water Leaks & Wind Noise" chapter, Tier 2].
- **No catalog fit** → advisor.

### FM-3 Body / cabin rattle or squeak (doors, trim, headliner, trunk/cargo)
- Signature: `noise_descriptor=rattling` or `creaking_or_squeaking`; `sound_or_smoke_location_zone=inside_cabin_general`
  or "in the trunk"; `onset_timing=over_bumps`.
- Mechanism/attribution: loose or shrunken interior trim, headliner, door-panel clips, and unsecured
  cargo produce bump-triggered rattles/squeaks that originate *inside the cabin*, as opposed to underbody
  heat-shield/exhaust rattles [Duffy, *Auto Body Repair Technology* — "Trim & Hardware" chapter, Tier 2].
- Misattribution: overlaps `rattling_underneath_the_car` (that slug is *underneath* — exhaust heat-shield,
  loose bracket) and suspension `clunking_over_bumps`. A **loose item in the trunk / interior trim** is body.
  (Corpus is used here only as *language* evidence — e.g., "something around in trunk" — never as the
  diagnostic basis.)
- **No catalog fit** → advisor (or the situational buckets when tied to recent work/accident).

### FM-4 Door / trunk / liftgate / hood latch — mechanical
- Signature: "won't open," "won't latch/close," "pops open," "handle broke." No fluid/noise slot fits;
  `customer_request_type=fix_a_known_problem` common.
- Severity: usually `drivable_normally`; a trunk/hood that won't latch can be a safety issue.
- Misattribution: an **electric** trunk-release failure (solenoid/switch) looks identical to a **mechanical**
  latch jam from the customer's chair — the discriminator is "does it click/hum when you press the button?"
  (electrical → `electrical_testing_general`) vs. "cable/handle does nothing mechanically" (body → advisor).
  The electric release is a BCM-driven solenoid on the same accessory-circuit family as the power locks
  [Halderman, *Automotive Electricity and Electronics* — "Body Control Modules & Accessory Circuits"
  chapter, Tier 2].
- Fit: **electrical actuator** → `electrical_testing_general`; **mechanical latch/cable** → advisor.

### FM-5 Power lock(s) inoperative — electrical
- Signature: `accessory_affected="power locks"` / `"door lock"`; one door or all; `location_side` if one.
- Mechanism: each door has its own actuator; a **single** dead lock is that actuator/its harness, while
  **all** locks dead points upstream to a shared fuse/relay/BCM or ground; salt/water corrosion of the
  in-door connector is a common single-door cause [Halderman, *Automotive Electricity and Electronics* —
  "Body Control Modules & Accessory Circuits" chapter, Tier 2; corroborated by Dorman Products,
  "Integrated Door Lock Actuators" testing page, dormanproducts.com, Tier 2, accessed 2026-07-18].
- Fit: **good** → service `electrical_testing_general`, subcat `accessory_doesnt_work`.
- Note: a single dead actuator vs. all-locks-dead (fuse/relay/BCM) vs. worse-after-rain (→ FM-8).

### FM-6 Key fob / keyless entry / remote-start electronics
- Signature: `accessory_affected="key fob"/"keyless entry"`; "fob won't lock/unlock," "remote
  start quit," "have to be right next to the car." (Note: *aftermarket* "remote start" is a distinct
  installed system, not the OE fob — do not collapse it into the fob at extraction.)
- Cause set: dead fob battery, keyless-entry receiver/antenna, or lost programming/pairing [Halderman,
  *Automotive Electricity and Electronics* — "Keyless Entry & Anti-Theft Systems" chapter, Tier 2;
  corroborated by Rick's Free Auto Repair Advice, Tier 3, accessed 2026-07-18].
- Fit: **electrical** → `electrical_testing_general` / `accessory_doesnt_work`. **Boundary:** if the fob
  problem is that the car **won't start** → FM-7, not FM-6.

### FM-7 Security / immobilizer NO-START ("won't recognize key")
- Signature (slots): `warning_light_named="security"/"anti-theft"/"theft"/"key"`,
  `warning_light_behavior=flashing_or_blinking`, `engine_running=wont_start` (cranks, no fire) **or**
  `no_sound_at_all`/`wont_crank_just_clicks` on starter-cut designs; **battery/charging is normal**
  (lights bright, no jump needed).
- Mechanism: the immobilizer/ECM denies fuel and/or spark when the transponder code is absent or
  unrecognized; the engine cranks at normal speed but will not fire, or on starter-cut designs the starter
  won't engage [Halderman, *Automotive Electricity and Electronics* — "Immobilizer & Anti-Theft Systems"
  chapter, Tier 2; corroborated by Rick's Free Auto Repair Advice, Tier 3, accessed 2026-07-18].
- Severity: `not_drivable_needs_tow`/`stranded_now` common.
- Misattribution: **the #1 confusable of this whole system** — customer says "won't start / dead," which
  sounds like a battery no-start. Discriminator is the **security light + normal battery** (see §5, §7).
- **Adjacent symptoms owned here:** *key won't turn* and *key stuck in the ignition / won't come out* are
  the mechanical/interlock cousins (worn cylinder or shifter/brake-ignition interlock), not transponder
  faults — same subcategory home, different mechanism. A **lost-key / "need a new key made" / "only have one
  key" REQUEST** is NOT a symptom and routes to `router-requests-maintenance`, not here (see §1).
- **No dedicated catalog fit** — currently lands on `no_start_testing` or `electrical_testing_general`
  (§8 proposal for a key/immobilizer subcategory).

### FM-8 Water-intrusion electrical gremlins (the water↔electrical overlap)
- Signature: `onset_timing=intermittent`, `weather_condition=rainy_or_wet`,
  `recent_action=car_wash_or_driven_through_water`; "random stuff, worse after it rains," multiple
  unrelated accessories acting up (locks click on their own, gauges jump, radio resets).
- Cause: water into a door harness / BCM / ground / connector corrodes contacts and raises resistance,
  intermittently browning-out several unrelated accessories at once [Halderman, *Automotive Electricity
  and Electronics* — "Body Control Modules & Accessory Circuits" chapter, Tier 2; corroborated by Dorman
  Products, "Integrated Door Lock Actuators" testing page, dormanproducts.com, Tier 2, accessed 2026-07-18].
- Fit: **good** → `electrical_testing_general`, subcat `multiple_random_electrical_glitches` (or
  `accessory_doesnt_work` if a single accessory). This is where "body water" and "electrical" *legitimately*
  both fire — route electrical because that's the bookable test.

### FM-9 Glass — chip / crack / delamination
- Signature: "crack from a rock," "chip spreading," "windshield cracked."
- Misattribution: tempts a route to `windshield_inop_testing` — WRONG, that service is **wipers**.
- **No catalog fit** → advisor (glass vendor) [Duffy, *Auto Body Repair Technology* — "Glass & Hardware"
  chapter, Tier 2]. (Diagnostic content here is minimal — glass damage is a self-evident, advisor-routed
  no-fit; the cite establishes it as body/glass work, not a testable electrical/wiper concern.)

### FM-10 Anti-theft ALARM sounds on its own / horn honking / won't disarm
- Signature: "alarm goes off randomly at night," "horn keeps honking, had to pull a fuse," "alarm won't
  disarm / won't shut off"; often `accessory_affected="alarm"/"horn"/"anti-theft"`, sometimes
  `onset_timing=intermittent`. This is the **audible** security fault — distinct from the silent
  immobilizer no-start (FM-7). It does NOT set `engine_running` (the car usually starts fine).
- Mechanism: a flaky **normally-closed ajar switch** (door, hood, trunk/hatch) or a worn courtesy-light
  switch feeds the security module a false "opened" signal; aftermarket alarm/remote-start wiring spliced
  into the ignition is a frequent additional culprit [Halderman, *Automotive Electricity and Electronics* —
  "Anti-Theft Systems" chapter, Tier 2; corroborated by Free ASE Study Guides, "Components and Symptoms of
  Automotive Antitheft Systems," Tier 3, accessed 2026-07-18].
- Severity: usually `drivable_normally` (nuisance), but a customer who "pulled the horn fuse" has disabled
  a safety device.
- Fit: **electrical** → `electrical_testing_general` / `accessory_doesnt_work` (shared slug owned by
  `body-electrical-accessories`; see §1). The alarm-sounding *language* is the delta this dossier
  contributes to that slug — flagged `defer_to: body-electrical-accessories` in `.proposals.yaml`.

---

## 4. Customer-language lexicon (binds synonyms / examples)

Real-voice phrasings, corpus first. `provenance` marks each. (Full machine list in the `.lexicon.yaml`.)

**Water inside (FM-1)**
- "found a small puddle under the passenger side of my car, completely clear with no smell, feels just like
  plain water" — the *AC-condensation/under-car* boundary case → `clear_odorless_puddle_water_or_ac_condensation`
  (authored **eval** case, `eval-cases.json`; mapped to `synthetic` in the machine files since the provenance
  enum has no `eval` value). Contrast with the genuine interior-water real-corpus cases:
- "Water is leaking into the driver's side of my car. The floor is full of water!" — water *inside* → FM-1,
  no fit; **currently mislabeled `ac_performance_check` in the corpus** (tekmetric).
- "front floor board, passenger side, under floor mat, you can visibly see water standing" — water *inside*
  → FM-1, no fit; **came back ambiguous `ac_leak_testing`/`multiple_symptoms`** (tekmetric).
- "carpet is soaked on the driver side every time it rains" (forum-paraphrase).
- "smells musty inside and the headliner is damp after storms" (synthetic, flagged).

**Wind noise / rattle (FM-2, FM-3)**
- "NOISE IN REAR OF VEHICLE ONLY HAPPENS DURING WINTER… SOUNDS LIKE SOMETHING AROUND IN TRUNK" (tekmetric).
- "loud whistling air noise from the driver door at highway speed" (synthetic, flagged).
- "rattle from the dash/door panel over bumps" (forum-paraphrase).

**Doors / trunk / latch (FM-4)**
- "TRUNK DOES NOT OPEN" / "TRUNK IS INOPERABLE" / "TRUNK WILL NOT OPEN" (tekmetric).
- "TRUNK POPS OPEN WHEN CLOSING (Has to close very lightly or it pops back open)" (tekmetric).

**Power locks / fob (FM-5, FM-6)**
- "the door locks click on their own" (eval — note: appears in a *multi-glitch* context → FM-8).
- "power door locks quit working with the key fob… then with the door lock/unlock switch" (forum-paraphrase).
- "my key fob will not activate the remote start" (tekmetric).

**Security / immobilizer no-start (FM-7)**
- "why my key fob will not activate the remote start" (tekmetric — fob/remote, not no-start; boundary marker).
- "no run or start, intermittent dash lights, ABS, traction control, airbag and **security light** also no
  power locks or windows" (forum-paraphrase — multi-module comms/security).
- "car cranks but won't start and the little security light is flashing" (synthetic, flagged).
- "won't start, key won't turn in the ignition" (synthetic, flagged).

**Security / immobilizer no-start (FM-7) — key cylinder cousins**
- "wont start, key wont turn in the ignition" (synthetic, flagged — worn cylinder / interlock, not transponder).
- "my key is stuck in the ignition and wont come out" (synthetic, flagged — shifter/brake-ignition interlock).

**Anti-theft ALARM sounding (FM-10)**
- "While the light was on, I could not use my remote start. If I tried remote start, the horn would honk"
  (forum-paraphrase — remote-start/horn interlock; the honk cue lands here, not FM-6).
- "the alarm goes off randomly in the middle of the night for no reason" (synthetic, flagged).
- "horn keeps honking on its own, i had to pull the fuse to make it stop" (synthetic, flagged).
- "car alarm wont shut off / wont disarm even with the fob" (synthetic, flagged).

**Glass (FM-9)**
- "windshield cracked from a rock on the highway" (forum-paraphrase).

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: confusable pair → the ONE best question → the fact slot + value that resolves it.

| # | Pair | Discriminating question | Slot → value |
|---|---|---|---|
| D1 | **FM-7 security no-start** vs **battery/charging no-start** | "Is a SECURITY / anti-theft / key light on, and is the battery otherwise fine (lights bright, no jump)?" | `warning_light_named=security` **+** `engine_running=wont_start` (cranks) vs battery: `engine_running=wont_crank_just_clicks`/`slow_crank`, `lights_state=dim_or_flickering`, `recent_action=jump_started`, **no** security light |
| D2 | **FM-1 water inside** vs **AC condensation UNDER car** | "Is the water *inside on the carpet/headliner*, or a puddle *under* the car?" | `sound_or_smoke_location_zone=passenger_footwell`/`inside_cabin_general` (inside) vs `fluid_under_car_location=under_*` (outside) |
| D3 | **FM-1 water inside** vs **coolant / heater-core leak** | "Clear & odorless, or sweet-smelling / greenish / foggy windshield film?" | water inside: `sound_or_smoke_location_zone=passenger_footwell/inside_cabin_general` + `smell_descriptor=null/musty_or_mildew` (NOT `fluid_color` — that slot is under-car only) vs coolant: `smell_descriptor=sweet_or_maple_syrup` (+ `fluid_color=green_or_orange_or_yellow_or_pink` only if an under-car puddle was actually seen) |
| D4 | **FM-1 water inside** correlated with **rain/car-wash** vs **A/C use** | "Does it get wet after rain / a car wash, or after running the A/C?" | `weather_condition=rainy_or_wet` / `recent_action=car_wash_or_driven_through_water` (body leak) vs A/C-only (HVAC evaporator) [Haynes, Tier 2] |
| D5 | **FM-4 electric trunk/lock actuator** vs **mechanical latch/cable** | "When you press the button, does it click/hum (just doesn't move), or is it totally mechanical/dead?" | `accessory_affected="trunk release"/"power locks"` (electrical → test) vs no electrical cue (mechanical → advisor) |
| D6 | **FM-6 fob remote** vs **FM-7 immobilizer no-start** | "Does the car START but the fob won't lock/unlock, or does the car NOT START?" | `accessory_affected="key fob"` + car runs (FM-6) vs `engine_running=wont_start`/`no_sound_at_all` (FM-7) |
| D7 | **FM-8 water gremlin** vs **single dead accessory (FM-5)** | "One thing dead all the time, or several random things worse after rain?" | `onset_timing=intermittent` + `weather_condition=rainy_or_wet` → `multiple_random_electrical_glitches`; steady single → `accessory_doesnt_work` |
| D8 | **FM-9 cracked windshield** vs **wiper inop** | "Is the GLASS chipped/cracked, or do the WIPERS not work?" | glass condition (no slot; advisor) vs `accessory_affected="wipers"` → `windshield_inop_testing` |
| D9 | **FM-2 wind noise** vs **wheel-bearing/tire hum** | "Does it whistle/change with the WINDOWS/doors, or hum with SPEED regardless?" | wind: door/window-linked, `sound_or_smoke_location_zone` at a door vs `noise_descriptor=humming_or_whirring` + `speed_band` (bearing → suspension dossier) |
| D10 | **FM-10 alarm SOUNDING** vs **FM-7 immobilizer NO-START** | "Does the car start and run fine but the ALARM/HORN goes off on its own, or does the car NOT START?" | alarm: `accessory_affected=alarm/horn`, **no** `engine_running` set (car runs) → `accessory_doesnt_work` vs `engine_running=wont_start` + security light (FM-7) |

**Slot sufficiency finding:** D1–D9 are all resolvable with **existing** slots (chiefly `warning_light_named`,
`engine_running`, `lights_state`, `sound_or_smoke_location_zone`, `fluid_color`, `smell_descriptor`,
`weather_condition`, `recent_action`, `accessory_affected`). No new slot is required *to disambiguate*. A new
slot is proposed in §9 only to support the *fuller question set* of a would-be key/immobilizer subcategory.

---

## 6. Warning lights & DTC surface

- **Security / anti-theft / immobilizer light.** Customer nicknames: "security light," "theft light,"
  "the little car-with-a-key symbol," "the key light," "a lock/car outline blinking." **Solid** =
  system armed / info; **flashing during crank** = immobilizer actively blocking start (FM-7)
  [Rick's, Tier 3, accessed 2026-07-18]. → feeds `warning_light_named` values `security`, `anti-theft`,
  `theft`, `key`, and `warning_light_behavior=flashing_or_blinking`.
- **No dedicated subcategory** exists in `warning_light` (12) for this light — gap (§8).
- DTC surface (scan-tool, not customer-stated; do NOT extract from customer text): B-codes "Key Not
  Recognized" / "Immobilizer Active"; network **U-codes** — the module-appropriate examples are **U0140
  "Lost Communication with Body Control Module"** and **U0146 "Lost Communication with Gateway Module"**
  (SAE J2012 network-comm range) — set when a BCM/gateway soaked by water drops off the bus and drags
  multiple lights on at once [Halderman, *Automotive Electricity and Electronics* — "Network Communication
  & U-codes" chapter, Tier 2; immobilizer B-codes corroborated by Rick's, Tier 3, accessed 2026-07-18].
  (Earlier drafts cited U0109/U0102 — those are the fuel-pump-control and transfer-case lost-comm codes,
  the wrong modules; corrected here.)

---

## 7. Confusable neighbors (cross-system)

- **no-start-power router / `no_start_testing` / `charging_starting_testing`** — FM-7 vs battery no-start
  (D1). This is the single most important boundary; owned jointly with the no-start router. Rule of thumb
  for Stage-1 hedging: *a named security/theft/key light with a normally-charged battery is immobilizer,
  not battery.*
- **leaks router / `clear_odorless_puddle_water_or_ac_condensation` / coolant / HVAC evaporator** — FM-1
  vs under-car water vs coolant vs A/C condensation (D2–D4). The word "water" alone is ambiguous; location
  (inside vs under) is the pivot.
- **`ac_performance_check` (`foggy_or_hard_to_defog_windows`, `musty_mildew_smell_from_vents`)** — a musty
  cabin from a *body water leak* (FM-1) vs from *A/C evaporator mold*. Discriminator: is the carpet actually
  **wet** (body) or just smelly on A/C (HVAC)?
- **`window_inop_testing`** — locks/latches (this dossier) vs the **glass motor** going up/down (theirs).
  Adjacent but cleanly split by "does the *glass move*?"
- **`windshield_inop_testing`** — cracked **glass** (this dossier, advisor) vs **wipers** (theirs). D8.
- **electrical dossier (`accessory_doesnt_work`, `multiple_random_electrical_glitches`, `electrical_buzzing`)**
  — shared surface; we contribute lock/fob/security wording, they own the general electrical.
- **exhaust/suspension** — a *cabin/trunk* rattle (FM-3) vs *underneath* heat-shield rattle (exhaust) vs
  suspension clunk. D-note in §3 FM-3.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Current service | Current category | Current subcategory | Fit |
|---|---|---|---|---|
| FM-1 water inside cabin | *(none)* | leak | *(none — `clear_odorless…` is UNDER-car)* | **NO FIT** → advisor + propose |
| FM-2 wind noise | *(none)* | noise | *(none)* | **NO FIT** → advisor |
| FM-3 cabin/trunk rattle | *(none)* | noise | `rattling_underneath_the_car` (mislabel) | **WEAK** → advisor; sharpen negative |
| FM-4a electric latch/trunk actuator | `electrical_testing_general` | electrical | `accessory_doesnt_work` | good |
| FM-4b mechanical latch/cable | *(none)* | — | *(none)* | **NO FIT** → advisor |
| FM-5 power locks | `electrical_testing_general` | electrical | `accessory_doesnt_work` | good |
| FM-6 fob / keyless entry electronics | `electrical_testing_general` | electrical | `accessory_doesnt_work` | good (weak wording) |
| FM-7 security/immobilizer no-start | `no_start_testing` / `electrical_testing_general` | performance / electrical | *(none)* | **WEAK / NO FIT** → propose |
| FM-8 water electrical gremlin | `electrical_testing_general` | electrical | `multiple_random_electrical_glitches` | good |
| FM-9 cracked glass | *(none)* | — | *(none)* | **NO FIT** → advisor |
| FM-10 anti-theft alarm sounding / horn honking | `electrical_testing_general` | electrical | `accessory_doesnt_work` (owned by `body-electrical-accessories`) | good (delta wording only; `defer_to` sibling) |

**Proposals arising (see `.proposals.yaml`):**
- `stage2.subcategory.propose` — **`water_leaking_inside_the_car`** (category `leak`): wet carpet/headliner
  from rain/car wash, clear & odorless. Demand: eval + forum wet-carpet cases; distinct from the *under-car*
  puddle slug. Routes to advisor unless the paired service below is approved.
- `stage2.subcategory.propose` — **`security_or_anti_theft_light`** (category `warning_light`): the security/
  theft/immobilizer dash light. Demand: corpus multi-symptom + FM-7 no-starts. Fills a 12→13 warning-light gap.
- `stage2.subcategory.propose` — **`key_or_fob_not_recognized_wont_start`** (category `electrical`):
  immobilizer/transponder no-start & "key won't turn." Demand: FM-7; separates the security no-start from a
  battery no-start at Stage-2.
- `catalog.service.propose` — **`body_water_leak_testing`** (hose/leak-trace diagnostic + fee). Chris-gated.
- `catalog.service.propose` — **`key_immobilizer_antitheft_testing`** OR explicitly widen
  `electrical_testing_general` scope to name immobilizer/keys. Chris-gated.
- Sharpen existing negatives so the body half stops mis-routing into `clear_odorless_puddle_water_or_ac_condensation`,
  `rattling_underneath_the_car`, `windshield_inop_testing`, and the battery no-start slugs.

---

## 9. Fact-slot audit

**Slots this system uses (existing, no change needed to disambiguate):** `warning_light_named`,
`warning_light_behavior`, `engine_running`, `lights_state`, `accessory_affected`, `fluid_color`,
`smell_descriptor`, `sound_or_smoke_location_zone`, `weather_condition`, `recent_action`, `onset_timing`,
`speed_band`, `location_side`, `noise_descriptor`, `drivable_state`, `customer_request_type`.

**Extraction-guidance for existing FREE-TEXT slots (these are `z.string()`, NOT enums — there is no value
list to extend, so the ops are `describe`-text guidance additions, emitted as `stage3.slot.guidance.add`,
never `stage3.slot.value.add`):**
- `warning_light_named` (free text): steer the model to capture the immobilizer light under the customer's
  own words — literal cues "security light," "theft light," "anti-theft light," "key light,"
  "car-with-a-key symbol." No enum value is created; the guidance just tells the extractor these dashboard
  nicknames are valid `warning_light_named` text.
- `accessory_affected` (free text): steer capture of **"power door locks," "key fob," "keyless entry,"
  "trunk release / liftgate," "alarm," "horn."** Keep **aftermarket "remote start" as its own phrase**, not
  folded into "key fob" — an aftermarket remote-start fault is a distinct installed system (see §2, FM-6).
- `recent_action=car_wash_or_driven_through_water` — an existing ENUM value; bind for FM-1 & FM-8 (ensure the
  water-leak/gremlin questions tag it). This one legitimately is a value-level binding.
- `sound_or_smoke_location_zone=passenger_footwell` / `inside_cabin_general` — an existing ENUM value; the
  interior-wet **location** cue (this slot, not `fluid_under_car_location` and not `fluid_color`, holds
  "inside on the carpet").

**Missing values (gaps, logged, not force-fixed):**
- `noise_descriptor` has no **`whistling`/`wind_noise`** value → FM-2 has no clean descriptor. Logged as a
  low-priority slot-value proposal; wind noise is thin in the corpus, so advisor-routing suffices for now.

**New-slot proposal (≥3-question rule) — CONTINGENT on `key_or_fob_not_recognized_wont_start` approval:**
- `security_or_key_state` (see `.proposals.yaml`). Unlocks ≥3 questions the immobilizer subcategory needs:
  (1) "Is a security/theft light on and flashing?" (2) "Does a **spare key** start it?" (3) "Does the engine
  **crank** or make no sound?" (4) "Is this a push-button/keyless car and did the fob battery die?" The
  discriminator vs battery (D1) does NOT need this slot; this slot is for the deeper triage only. Flagged
  contingent so it is not created unless the subcategory lands.

---

## 10. Sources

- Halderman, James D. — *Automotive Electricity and Electronics* (standard textbook). **Tier 2** (explicitly
  enumerated in `source-policy.md`). Chapters: Body Control Modules & Accessory Circuits; Keyless Entry;
  Immobilizer & Anti-Theft Systems; Network Communication & U-codes; Steering-Column & Ignition-Lock.
  → §2, §3 FM-4/FM-5/FM-6/FM-7/FM-8/FM-10, §6. (Cited at chapter granularity; no fabricated page/edition.)
- Duffy, Owen C. — *Auto Body Repair Technology* (standard textbook). **Tier 2** (Duffy is enumerated in
  `source-policy.md`). Chapters: Water Leaks & Wind Noise; Trim, Hardware & Weatherstrip; Glass & Hardware.
  → §2, §3 FM-1/FM-2/FM-3/FM-9, §5 D4.
- Dorman Products — "Integrated Door Lock Actuators" engineering/testing page (dormanproducts.com).
  **Tier 2** (parts-manufacturer technical material; Dorman is enumerated). Salt-spray/temperature/corrosion
  validation → the water-intrusion corrosion failure path. Accessed 2026-07-18. → §2, §3 FM-5/FM-8.
- Rick's Free Auto Repair Advice — "How an Auto Immobilizer Anti-theft System Works"
  (ricksfreeautorepairadvice.com). **Tier 3** (established diagnostician; corroboration only). Accessed
  2026-07-18. → §2, §3 FM-6/FM-7, §6.
- Free ASE Study Guides — "Components and Symptoms of Automotive Antitheft Systems"
  (freeasestudyguides.com). **Tier 3** (ASE-aligned diagnostic-education content; corroboration only).
  Accessed 2026-07-18. → §2, §3 FM-10.
- Haynes Manuals — "How to Trace Interior Water Leaks in Your Car" (us.haynes.com). **Trade-reference
  corroboration only** (a repair-manual publisher, NOT one of the enumerated Tier-2 categories, so it never
  carries a claim alone). Accessed 2026-07-18. → §2, §3 FM-1 corroboration.
- **Linguistic authority (not diagnostic):** `real-concerns-tekmetric-labeled-v2.json` (+ its report
  derivatives), `eval-cases.json` (authored — mapped to `synthetic` in machine files), `real-concerns-forums.json`
  (Jeff's corpus). → §4 lexicon.

*No paywalled Mitchell1/ALLDATA cites were fabricated; where OEM detail was unavailable each claim rests on
a Tier-2 textbook (Halderman/Duffy) or Tier-2 parts-manufacturer material (Dorman), with Tier-3 web
corroboration where noted. Per `source-policy.md`, a Tier-2 source is sufficient alone; Tier-3 never is.*

---

## 11. Binding-readiness self-check (Gate-G2)

Self-scored honestly (the verifier diffs this; do not inflate). Corroboration rule per `source-policy.md`:
a claim needs **Tier 1/2 alone**, OR **one Tier-3 + one Tier-2**, OR **two independent Tier-3** — there is
no "reference-grade" tier and no "Tier-3 + Wikipedia" shortcut.

| Check | Status |
|---|---|
| Every failure mode cites Tier 1/2 (or 1× Tier-3 + 1× Tier-2, or 2× independent Tier-3) | PASS — every mode now rests on a Tier-2 textbook (Halderman *Automotive Electricity and Electronics* for FM-4/5/6/7/8/10; Duffy *Auto Body Repair Technology* for FM-1/2/3/9), several with Tier-2/Tier-3 web corroboration (Dorman T2; Rick's, Free ASE Study Guides T3). Wikipedia removed as a load-bearing cite. Corpus is used only as *language*, never diagnosis. |
| Sensory signatures expressed in fact-slot vocab | PASS (§3, §5) |
| Every negative_example names `routes_to` (valid subcat slug or `advisor`) | PASS — `.proposals.yaml` negatives now route only to real subcat slugs or `advisor`; the earlier `no_start_testing`/`wont_crank_just_clicks` misroutes are fixed |
| Synonyms ≥2 tokens or domain single-token; no over-broad condition phrases | PASS — bare-word and the over-broad `worse after rain` / `after the car wash` condition synonyms removed; shared `key fob`/`power door locks` deferred to `body-electrical-accessories` |
| Positives real-voice; synthetic ≤~30%/subcat & flagged | **PARTIAL** — water (`water_leaking_inside_the_car`) and `multiple_random_electrical_glitches` now carry real-corpus positives (2 tekmetric interior-water + 1 real multi-glitch); but `security_or_anti_theft_light`, `key_or_fob_not_recognized_wont_start`, and the FM-10 alarm language remain synthetic-heavy because the corpus contains **no** real immobilizer-no-start / alarm-honking utterances. Logged as a real-voice-collection backlog (NHTSA ODI mining) on those three proposed subcats; all synthetics flagged. |
| Literalness for fact cues (no over-assertion) | PASS — GC-01 no longer asserts `fluid_color`/`water` the customer never stated; FM-1 signature drops the under-car-only `fluid_color`; inference-trap cases GC-03/GC-09 intact |
| Confusable pairs from §5 taxonomy covered | PASS (security-vs-battery D1; body-water-vs-coolant/AC D2–D4; alarm-sound vs immobilizer-no-start added) |
| Catalog/subcategory items are *proposals*, Chris-gated | PASS (§8, `catalog.service.propose`) |
| Scope overlap with `body-electrical-accessories` resolved | PASS — shared `accessory_doesnt_work` / `multiple_random_electrical_glitches` / `key fob` / `power door locks` ops marked `defer_to: body-electrical-accessories`; this file emits only its delta (immobilizer fence, trunk release, alarm sounding, water↔electrical) |
| ≥8 golden cases incl. ≥1 inference-trap + ≥1 null-route | PASS (11 cases; GC-03/GC-09 traps; GC-10 null-route; GC-11 alarm-sound) |
| Slot proposals honor ≥3-question rule + literal_cues; free-text slots use `guidance` not `value.add` | PASS (§9; `security_or_key_state` contingent; free-text `warning_light_named`/`accessory_affected` reframed as `stage3.slot.guidance.add`) |
| US-market calibration | PASS (US immobilizer/keyless norms; corpus vehicle mix) |
