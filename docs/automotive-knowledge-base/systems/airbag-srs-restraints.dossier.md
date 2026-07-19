# Airbag / SRS & restraints — diagnostic dossier
slug: airbag-srs-restraints   date: 2026-07-18   binds_services: [airbag_srs_testing]   binds_categories: [warning_light, electrical]

> Scope note: this dossier owns the single dashboard-light subcategory `airbag_srs_light` and the
> Supplemental Restraint System behind it (airbags + seat-belt pretensioners + the sensor/wiring network
> that arms them). It is **routing-only**: SRS components are live pyrotechnic/energetic devices, so nothing
> here advises inspection, handling, or DIY on a deployed or armed system — the deliverable is *which
> subcategory a customer utterance routes to*, not a repair procedure. The hard confusables the taxonomy
> cares about are **airbag light (alone) vs a cascade of other warning lights** (`multiple_warning_lights_at_once`),
> **airbag light after a bump vs the post-collision situational bucket** (`after_a_recent_accident_or_impact`),
> and — because Stage-1's PRIORITY-ORDER rule lets a situational cue override a symptom keyword when causally
> tied (taxonomy §3b) — **airbag light the customer blames on a SHOP's recent work vs `after_recent_service_or_repair_work`**.
> Two non-symptom customer utterances also touch this system and null-route to advisor: an airbag **recall**
> inquiry (Takata-era "got a recall letter") and a "is it even safe to drive?" **safety-concern** framing.

---

## 1. Scope & boundaries

**In scope**
- The **SRS / AIRBAG dashboard telltale** — what it means (a stored fault in the restraint computer → one or
  more airbags/pretensioners may not fire), and its normal (brief bulb-check flash at start, then off) vs
  fault (steady-on, or a blink-code pattern) behavior.
- The common **fault sources behind a lone SRS light**: seat-belt buckle switch / tension sensor, passenger
  **occupancy classification sensor (OCS)** under the front passenger seat, **clockspring / spiral cable** in
  the steering column, disturbed **under-seat yellow SRS connectors / wiring** after interior work, a stored
  **crash/deployment code** after a minor impact, a **low-voltage event** (battery died / jump / disconnect)
  that latches an SRS code, and **water/flood intrusion** at the under-seat module.
- The **PASSENGER AIRBAG OFF** indicator — including the case where it is *normal by design* (light/empty seat
  disables the passenger bag) vs a stuck-off fault with an adult seated (OCS fault).
- Routing an SRS light that is **one of several** cascading lights **away** to `multiple_warning_lights_at_once`.

**Out of scope (owned elsewhere)**
- **Multiple simultaneous warning lights** (SRS as one of a charging/voltage cascade — battery + ABS + traction
  + security + airbag together) → `multiple_warning_lights_at_once` (warning-lights router). This dossier only
  consumes the multi-light case as a *route-away* discriminator (§5/§7).
- **Post-collision "get the whole car checked / insurance inspection"** framing → `after_a_recent_accident_or_impact`
  (requests/maintenance router). This dossier keeps only the *lone-SRS-light-after-a-minor-bump* case (§5/§7).
- **A single dead electrical accessory** (one power window, radio, dome light) → `accessory_doesnt_work`
  (electrical dossier). Named here only because the SRS service also reaches the `electrical` category.
- **Battery / charging** faults where a battery light + dim lights + hard cranking dominate → `battery_charging_light`
  / charging-starting dossier. This dossier keeps only the case where a **voltage dip latched an SRS code and the
  SRS light is the only one on**.
- **A seat-belt buzzer/chime with NO warning light**, and **mechanical seat-belt hardware** (belt won't retract,
  buckle won't latch, frayed webbing) — these have **no current subcategory fit** (§8); flagged as an advisor
  null-route + a Chris-gated subcategory proposal, not owned here.
- **ABS / traction / stability / EPS / brake / TPMS** telltales → their own warning-light subcategories
  (`abs-traction-stability` dossier et al.). Named only as co-illuminating lights in the cascade case.
- **SRS light the customer causally blames on a SHOP's recent work** ("they swapped my battery / worked under
  my seats and now the airbag light is on — they broke it") → `after_recent_service_or_repair_work` (situational
  bucket; Stage-1 override per taxonomy §3b). This dossier keeps only the **DIY / incidental-timing** variant
  ("*I* pulled the seats to shampoo and it came on") as `airbag_srs_light` (§5/§7).
- **Airbag RECALL inquiry** (Takata-era "got a recall letter about my airbag; is mine affected?") — a
  non-symptom request with **no diagnostic subcategory**; advisor / recall handling. Null-routed here (§7, golden set).
- **"Airbag light is on — is it even safe to drive?"** where fear dominates and no diagnosable symptom is named
  → `safety_concern_dont_feel_safe_driving_it`. A *named* airbag light plus a *passing* safety question stays
  `airbag_srs_light` (§7).

---

## 2. System primer (expert, CITED)

The **Supplemental Restraint System (SRS)** — SAE/OEM also "SIR" (Supplemental Inflatable Restraint) — is a
self-monitoring safety network managed by a dedicated **airbag control unit (ACU / "SRS module,"** usually
under the center console or front seats). It fires **airbags** (frontal, side, curtain, knee) and **seat-belt
pretensioners** in a crash, and continuously runs a self-test on every squib circuit, sensor, and connector.
Frontal-airbag deployment logic and the **advanced-airbag occupant-classification** requirement are mandated by
**FMVSS No. 208 (49 CFR 571.208)**, so every modern US-market vehicle carries this monitoring [NHTSA / FMVSS No.
208, 49 CFR 571.208 "Occupant crash protection," Tier 1, accessed 2026-07-18].

**Inputs the ACU watches** (each of which can set the light):
- **Crash / impact sensors** (front and satellite accelerometers) — a hard enough event stores a code even when
  no bag deploys (a curb strike or low-speed fender bender can latch one) [Bosch *Automotive Handbook*,
  occupant-protection chapter, Tier 2, accessed 2026-07-18].
- **Seat-belt buckle switch + belt-tension sensor** — the ACU knows whether each belt is latched to tailor
  deployment; a shorted buckle switch (debris in the buckle) or failed tension sensor sets the light [ASE A6
  Electrical/Electronic Systems task list — SRS/restraint electronics diagnosis, Tier 1 (ase.com), accessed
  2026-07-18].
- **Passenger Occupant Classification System (OCS)** — a weight-sensing bladder or strain-gauge mat + belt-fasten
  input in the front passenger seat that decides whether the passenger bag may fire, at reduced force, or must
  stay OFF. Roughly, a child-weight range keeps the bag disabled, a mid range enables reduced force, and an
  adult weight enables full force; the **PASSENGER AIRBAG OFF** lamp lights *by design* for a light/empty seat
  [FMVSS No. 208 advanced-airbag / OCS requirement, Tier 1; IEE occupant-classification supplier documentation +
  OEM owner-manual OCS descriptions, Tier 2, accessed 2026-07-18].
- **Clockspring / spiral cable** — a flat ribbon coiled in the steering column that carries the driver-airbag
  squib circuit (and the horn + steering-wheel control buttons) across the rotating wheel. When it cracks, the
  ACU sees an open driver-airbag circuit and lights the SRS telltale — classically **together with a dead or
  position-dependent horn and dead cruise/audio buttons**, because all three share that one path [2CarPros
  "Symptoms of a bad airbag clock spring," Tier 3, corroborated across multiple parts-vendor technical write-ups;
  Bosch *Automotive Handbook* squib-circuit description, Tier 2, accessed 2026-07-18].
- **Under-seat wiring + the yellow SRS connectors** — SRS harness connectors are colored **yellow** and carry
  shorting bars; disturbing them during seat removal, seat-track work, or carpet shampooing (or corroding them in
  a flood) opens a circuit and sets the light [ASE A6 SRS/restraint-electronics diagnosis task, Tier 1, accessed 2026-07-18].

**Normal vs fault behavior.** On key-on the SRS light **flashes briefly (a bulb check) then turns off** — that is
healthy. A light that **stays steady on**, or **flashes a repeating pattern** (some OEMs blink a fault "code" —
e.g., 4 short then 1 long), means a stored fault and that one or more restraint devices may not deploy
[NHTSA consumer air-bag-warning-light guidance, Tier 1; FreeASEStudyGuides SRS/airbag warning-light description,
Tier 3 corroboration (third-party study site, not official ase.com), accessed 2026-07-18]. **Low system voltage**
(a dying battery, a jump-start, a battery disconnect/replace)
can itself set and latch an SRS code, so an SRS light appearing right after battery work is a recognized pattern
[Bosch *Automotive Handbook*, ECU low-voltage fault behavior, Tier 2; iATN / diagnostician reports of SRS codes
after battery events, Tier 3 corroboration, accessed 2026-07-18].

**DTC surface (technician-facing only).** SRS faults are **B-codes** (body) under SAE J2012 nomenclature — e.g.,
squib/short/open and occupant-sensor codes — plus **U-codes** when the ACU drops off the communication bus
[SAE J2012 DTC nomenclature / J1930 terminology, Tier 1, accessed 2026-07-18]. Customers **rarely** state these,
and when a code does appear in the concern channel it is usually **advisor-pasted text** — e.g. the one Tekmetric
RO that pastes a whole multi-system code dump (`tkc-165`: "Codes B1317 B1318 system voltage … air bag code pass
seat sensor"), which in full would route multi-symptom, not to a lone SRS light. Scope context only — do **not**
build customer keywords on B-codes, and treat a fragment lifted from such a dump as multi-symptom in context (§8).

---

## 3. Failure-mode catalog (diagnostic spine — CITED per mode)

### FM-1 — Seat-belt buckle switch / tension-sensor fault (debris or corrosion in the buckle)
- **Sensory signature:** SRS/AIRBAG telltale `warning_light_behavior=steady_on`; no crash, no other light, car
  drives normally.
- **Conditions/modifiers:** often gradual; a coin/crumb/plastic bit jammed in a buckle shorting the switch, or a
  worn/corroded buckle tension sensor. `started_when` days_ago/weeks_ago.
- **Severity / drivability:** `drivable_but_concerned` — belt-tailored deployment compromised.
- **Typical misattribution:** "my seat belt is broken" or "it's probably nothing" — it is the ACU flagging a
  restraint circuit, not the belt webbing.
- **Source:** buckle switch / tension-sensor faults are a leading benign SRS-light cause [ASE A6 SRS diagnosis
  task, Tier 1; Bosch occupant-protection chapter, Tier 2, accessed 2026-07-18]. Question 429 ("anything stuck
  in a buckle?") targets exactly this.

### FM-2 — Passenger occupancy sensor (OCS) fault / PASSENGER AIRBAG OFF stuck on
- **Sensory signature:** SRS light steady, OR a **PASSENGER AIRBAG OFF** indicator that stays on with an adult
  properly seated (a fault), vs. the *normal* case where it lights for a light/empty seat (by design — NOT a
  fault).
- **Conditions/modifiers:** after a spill onto the seat, an aftermarket seat cover, a seat R&R, or a failed
  weight-bladder/strain mat. `recent_action=general_service` sometimes; often no trigger.
- **Severity / drivability:** `drivable_but_concerned`.
- **Typical misattribution:** "the airbag-off light won't go away" read as a fault when a child/empty seat makes
  it *correct*; or an adult-seated stuck-off read as normal when it is an OCS fault. Phrasing decides (§5).
- **Source:** OCS enable/disable behavior and the OFF lamp are FMVSS-208 advanced-airbag features [FMVSS No. 208,
  Tier 1; IEE OCS supplier docs + OEM manuals, Tier 2, accessed 2026-07-18].
  Question 430 (car seat / occupancy-area use) targets this.

### FM-3 — Clockspring / spiral-cable fault (steering-column ribbon)
- **Sensory signature:** SRS light steady, **together with** a dead or position-dependent **horn** and/or dead
  **steering-wheel cruise/audio buttons**; sometimes a `noise_descriptor=popping_or_clicking` from the column
  `onset_timing=when_turning`.
- **Conditions/modifiers:** high mileage, or after steering-wheel / airbag / column service; early on the
  symptoms cut in/out with wheel position.
- **Severity / drivability:** `drivable_but_concerned`.
- **Typical misattribution:** "my horn quit" or "cruise stopped working" treated as *separate* problems — the
  clockspring is the shared path, so they fail together.
- **Source:** clockspring failure lights the SRS telltale and simultaneously kills horn + steering-wheel controls
  via the shared ribbon [2CarPros clock-spring symptoms, Tier 3, corroborated across multiple parts-vendor
  technical write-ups; Bosch squib-circuit / rotating-connector description, Tier 2, accessed 2026-07-18].

### FM-4 — Stored crash/deployment code after a MINOR impact (no deployment)
- **Sensory signature:** SRS light `steady_on` that appeared **right after** a curb hit or a low-speed fender
  bender, with **no airbags deployed** and the car still drivable.
- **Conditions/modifiers:** `recent_action=accident_or_impact` or `hit_pothole_or_curb`; `started_when=today/days_ago`.
- **Severity / drivability:** `drivable_but_concerned`.
- **Typical misattribution:** customer thinks the airbags are "used up," or conversely that a minor bump "couldn't
  have done anything." The ACU latched a code.
- **Source:** minor impacts can store crash codes without deploying [Bosch occupant-protection / crash-sensor
  chapter, Tier 2; ASE A6, Tier 1, accessed 2026-07-18]. Matches eval `airbag_srs_testing-001` (fender bender,
  no deployment, steady light). **This is the key confusable vs `after_a_recent_accident_or_impact`** (§5/§7).

### FM-5 — Disturbed under-seat SRS wiring / yellow connectors after interior work
- **Sensory signature:** SRS light steady that appeared **after** seat removal, seat-track service, or carpet
  shampoo/detailing.
- **Conditions/modifiers:** `recent_action=general_service`; an under-seat SRS connector left unseated or a wire
  pinched.
- **Severity / drivability:** `drivable_but_concerned`.
- **Typical misattribution:** "the detailer/shop broke my airbag" — usually a connector to reseat, not a
  destroyed component.
- **Source:** disturbing the yellow SRS connectors opens a monitored circuit [ASE A6 SRS/restraint-electronics
  diagnosis task, Tier 1, accessed 2026-07-18]. Matches eval `airbag_srs_testing-003` (light after pulling seats
  to shampoo carpets). *Boundary:* DIY interior work stays here; a SHOP the customer blames → the recent-service
  bucket (§5/§7).

### FM-6 — Low-voltage / battery-event latched SRS code (ISOLATED light)
- **Sensory signature:** SRS light steady **or a flashing/blink pattern** that appeared right after the battery
  died, a jump-start, or a battery disconnect/replacement — and the SRS light is the **only** one on.
- **Conditions/modifiers:** `recent_action=battery_or_alternator_work` / `jump_started`; `warning_light_behavior`
  `steady_on` or `flashing_or_blinking`.
- **Severity / drivability:** `drivable_but_concerned`.
- **Typical misattribution:** "the jump start fried my airbag." A voltage dip set and latched a code that needs a
  scan-tool clear, not necessarily a part.
- **Source:** low system voltage sets SRS codes; the ACU latches until cleared [Bosch low-voltage ECU behavior,
  Tier 2; iATN/diagnostician SRS-after-battery reports, Tier 3, accessed 2026-07-18]. Matches eval
  `airbag_srs_testing-002` (SRS flashing a pattern after the battery died and a jump). **Distinguish from FM-8**:
  isolated SRS = here; battery + many lights = cascade (§5/§7).

### FM-7 — Water / flood intrusion at the under-seat SRS module or connectors
- **Sensory signature:** SRS light steady that came on after driving through a **flooded area** or getting the
  interior soaked; sometimes with a `musty_or_mildew` smell (a neighbor cue, not required).
- **Conditions/modifiers:** `recent_action=car_wash_or_driven_through_water`.
- **Severity / drivability:** `drivable_but_concerned`.
- **Typical misattribution:** "the car wash / puddle set off a warning" — water reached a low-mounted SRS
  connector or module.
- **Source:** water intrusion corrodes/shorts under-seat SRS wiring [ASE A6 SRS/restraint-electronics diagnosis,
  Tier 1, accessed 2026-07-18]. Question 433 (flooded area / wet interior) targets this.

### FM-8 — SRS as one of a CASCADE of lights (route away)
- **Sensory signature:** SRS light `steady_on` **alongside** battery/charging, ABS, traction, and/or security
  lights — often with rough running, dim headlights, sluggish accessories, hard cranking.
  `warning_light_behavior=multiple_lights_at_once`.
- **Conditions/modifiers:** a failing alternator / dying battery while running / bad ground lighting every module
  at once.
- **Severity / drivability:** varies; can become `not_drivable`.
- **Typical misattribution:** customer lists many lights (incl. airbag) and assumes many separate failures — it is
  usually one voltage/charging fault.
- **Source:** low/erratic system voltage disturbs multiple networked ECUs at once, so several independent
  telltales illuminate together [Bosch *Automotive Handbook*, vehicle electrical system / networked-ECU
  supply-voltage behavior, Tier 2, accessed 2026-07-18; corroborated by corpus + 2CarPros U-code no-start
  patterns of airbag+ABS+traction+security lighting together, Tier 3, accessed 2026-07-18]. When 3+ lights or
  "all of them" → `multiple_warning_lights_at_once`, **not** this system (§7).

### FM-9 — Mechanical seat-belt / restraint-hardware complaint (NO dash light) — **NO CURRENT FIT**
- **Sensory signature:** a seat belt that **won't retract**, **won't latch / buckle won't click**, is **stuck
  extended**, or has **frayed webbing** — a physical restraint-hardware complaint with **no SRS warning light**.
  (Adjacent: a seat-belt **chime/buzzer** with no light — an occupancy/unbuckled nuisance.)
- **Conditions/modifiers:** mechanical; no ACU fault, no telltale.
- **Severity / drivability:** `drivable_but_concerned` (a non-latching belt is a safety concern).
- **Typical misattribution:** none for the classifier — the problem is there is **nowhere for it to route**: it is
  not a warning light and not a dead electrical accessory.
- **Source:** restraint-hardware (retractor/buckle/webbing) is a distinct mechanical service item [ASE A6 restraint
  systems, Tier 1, accessed 2026-07-18]. **No subcategory holds it today** → advisor null-route + Chris-gated
  subcategory proposal (§8). Corpus demand is thin, so propose-only.

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Source order: Tekmetric corpus first, NHTSA ODI real voice second, synthetic last (flagged). **Provenance is
exact:** only genuine `real-concerns-tekmetric` lines are `tekmetric`; NHTSA ODI narratives (paraphrased) are
`nhtsa`; phrasings lifted from `eval-cases.json` (authored test data, source `authored-2026-07-02-workflow`)
are **not** real corpus voice — the strict enum has no "authored" value, so they are labeled `synthetic` (eval
id noted). Full machine form in `airbag-srs-restraints.lexicon.yaml`.

| Phrase (as customers say it) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "AIR BAG LIGHT ON" | airbag_srs_light | unambiguous | tekmetric (line ~5758 opening fragment) |
| "airbag light always on in my dashboard" | airbag_srs_light | unambiguous | nhtsa (ODI, paraphrased) |
| "SRS light went on and stayed on, dealer said the SRS computer malfunctioned and needs replacing" | airbag_srs_light | unambiguous | nhtsa (ODI, paraphrased) |
| "Airbag light popped on after a lil fender bender, no airbags went off, stays on steady" | airbag_srs_light | cross-system:after_a_recent_accident_or_impact (minor impact + lone light + want-light-checked → SRS) | synthetic (eval -001) |
| "my SRS light is flashing some weird pattern of blinks ever since the battery died and i had to jump start" | airbag_srs_light | unambiguous (behavior + trigger both literally stated; isolated) | synthetic (eval -002) |
| "the little airbag person light on my dash has been glowing for a couple weeks, started after i pulled the seats out to shampoo the carpets" | airbag_srs_light | unambiguous (DIY interior work) | synthetic (eval -003) |
| "theres a yellow SRS triangle showing on my dash, no clue what that even means" | airbag_srs_light | unambiguous (icon description) | synthetic (eval -004) |
| "air bag code pass seat sensor" | airbag_srs_light | cross-system:multiple_warning_lights_at_once (FRAGMENT of a multi-system code dump, tkc-165; occupancy fragment alone → airbag) | tekmetric |
| "AIR BAG LIGHT ON ... SHE WAS IN ACCIDENT RECENTLY AND WANTS TO TALK TO BODY SHOP 1st" | after_a_recent_accident_or_impact | cross-system (accident framing + body-shop dominates) | tekmetric |
| "the shop replaced my battery yesterday and now the airbag light is on, i think they messed something up" | after_recent_service_or_repair_work | cross-system:after_recent_service_or_repair_work (SHOP-work causally blamed → §3b override) | synthetic |
| "ABS & TRAC LIGHTS COMING ON. CLIENT ALSO REPORTED TPMS AND AIRBAG" | multiple_warning_lights_at_once | cross-system:multiple_warning_lights_at_once | tekmetric |
| "car wont start and a bunch of dash lights are flickering — ABS, traction, airbag and security, power locks/windows dead too" | multiple_warning_lights_at_once | cross-system:multiple_warning_lights_at_once | forum-paraphrase (paraphrased, NOT verbatim) |
| "airbag light and my horn quit working at the same time" | airbag_srs_light | unambiguous (clockspring signature) | synthetic (no corpus/forum source; represents a Tier-3-cited pattern) |
| "red person-with-seatbelt-and-a-ball icon lit up on the dash" | airbag_srs_light | unambiguous (icon description) | synthetic |
| "the PASSENGER AIRBAG OFF light stays on even when my husband is sitting there" | airbag_srs_light | unambiguous (light named + adult literally stated as seated = OCS fault) | synthetic |
| "airbag light is on, is it safe to drive with it like this??" | airbag_srs_light | cross-system:safety_concern_dont_feel_safe_driving_it (passing safety Q does NOT override a named light) | synthetic |
| "there've been so many airbag recalls, got a notice, is my car one of them?" | (advisor / recall handling) | null-route (recall inquiry, no diagnostic subcategory) | nhtsa (ODI recall-mention voice, paraphrased) |
| "passenger airbag off light comes on when my little kid sits up front" | (advisor / normal-by-design) | null-route — INFERENCE TRAP (normal OCS behavior, not a fault) | synthetic |
| "seat belt won't pull out / stays stuck, no dash light" | (advisor / restraint hardware) | null-route (NOT this system) | synthetic |

Messiness represented: all-caps Tekmetric fragments ("AIR BAG LIGHT ON"), real NHTSA module-failure voice,
spelled two ways (airbag / air bag), icon-only descriptions ("person with a ball," "SRS triangle"), the
clockspring multi-symptom bundle, the accident-framing collision, the SHOP-blame service override, the
multi-light cascade, the recall inquiry, the safety-concern framing, and the normal-OCS trap. Because the
Tekmetric 500-corpus holds only four airbag utterances (two route away), real in-subcategory voice comes mostly
from NHTSA ODI; synthetic entries are individually flagged.

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: the single best question, the fact slot + value that resolves it.

| Confusion | Best discriminating question | Slot → value that answers |
|---|---|---|
| Is it actually the SRS light | "Is the light the **airbag/SRS** one — a person with a seat belt facing a round airbag, or the letters SRS/AIRBAG — not the check-engine or brake light?" | `warning_light_named` verbatim contains "airbag"/"srs" |
| Fault vs normal bulb-check | "Does it **stay on** (or flash a repeating pattern) while you drive, or does it just flash for a second at startup and go off?" | `warning_light_behavior` → `steady_on` / `flashing_or_blinking` (fault) vs a brief startup flash (normal) |
| **SRS-light-after-minor-bump vs the accident bucket** | "Is the airbag light the **specific thing** you want checked (minor bump, **no airbags went off**, car drives fine), or do you mainly want the **whole car / collision** looked at (airbags deployed, real damage, insurance)?" | `drivable_state` + `customer_request_type`: lone SRS light + `diagnose_problem` + drivable → `airbag_srs_light`; collision framing / deployment / `not_drivable` → `after_a_recent_accident_or_impact` |
| **SRS-light-after-SHOP-work vs the recent-service bucket** | "Did a **shop** just do the work, and do you think **they** caused the light and should fix it — or did the light just happen to come on around some work **you** did, and you want the light itself diagnosed?" | `recent_action=general_service` + causal-blame framing → `after_recent_service_or_repair_work` (§3b situational override); DIY / incidental timing + "diagnose the light" → `airbag_srs_light` |
| **SRS alone vs a cascade** | "Is it **only** the airbag light, or did **several** lights (battery, ABS, traction, security) come on together?" | `warning_light_behavior` → `multiple_lights_at_once` routes to `multiple_warning_lights_at_once`; SRS-only stays here |
| Battery-event SRS vs charging fault | "After the battery/jump, is the airbag light the **only** one on, or is a **battery light** on with dim lights / hard starting?" | `warning_light_named` (isolated "airbag" → here) vs a `battery`-named light + `lights_state=dim_or_flickering` → charging |
| Clockspring cue | "Did your **horn** or the **steering-wheel buttons** (cruise/volume) stop working around the same time?" | `accessory_affected` = "horn" / "cruise buttons" → clockspring (still `airbag_srs_light`) |
| Crash-code trigger | "Did it come on **right after** a bump, curb, or fender bender?" | `recent_action` → `accident_or_impact` / `hit_pothole_or_curb` |
| Interior-work trigger | "Did it start **after** work on the seats, dash, steering wheel, or seat belts?" | `recent_action` → `general_service` |
| Flood trigger | "Did it come on **after** driving through deep water or getting the inside wet?" | `recent_action` → `car_wash_or_driven_through_water` |
| **OCS normal vs fault** | "Is the **PASSENGER AIRBAG OFF** light on with a **normal-size adult** properly seated (fault), or only with a **child / empty seat** (that is by design)?" | `warning_light_named` = "passenger airbag off" + who is seated; adult → OCS fault (`airbag_srs_light`); child/empty → normal (advisor/reassure) |
| **NULL-ROUTE** — mechanical seat belt vs SRS light | "Is there a **warning light on the dash**, or is the issue the **seat belt itself** (won't latch/retract), with no light?" | `warning_light_named` present → this system; belt-hardware with **no light** → advisor (no subcategory holds it, §8) |

> Literalness guard: "airbag light on after a fender bender, no airbags went off" sets **only**
> `warning_light_named=airbag`, `warning_light_behavior=steady_on` (if stated), and
> `recent_action=accident_or_impact` — it does **not** set `drivable_state` unless the customer says the car is
> fine/undrivable, and "no airbags went off" is a literal deployment fact, not a severity rating. "My horn quit
> too" sets `accessory_affected=horn` — it does **not** by itself confirm a clockspring (that is the diagnostic
> inference the technician makes, not a fact slot).

---

## 6. Warning lights & DTC surface

| Telltale | Color | Solid vs flashing | Customer nicknames |
|---|---|---|---|
| SRS / AIRBAG | **red or amber** (OEM-dependent) | brief flash at start = normal; **steady on** = fault; **repeating blink pattern** = fault (some OEMs blink a code) | "airbag light", "SRS light", "air bag light", "the little person with a seatbelt", "person and a ball/circle", "SRS triangle", "restraint light", "airbag person light" |
| PASSENGER AIRBAG OFF (OCS indicator) | amber | **on = passenger bag disabled**; normal for a light/empty seat, a fault if stuck with an adult seated | "passenger airbag off", "airbag off light", "off light for the front seat" |

DTC surface (technician-facing only): **Bxxxx** body codes (squib open/short, buckle, occupant-sensor) and
**Uxxxx** communication codes if the ACU drops off the bus [SAE J2012 / J1930, Tier 1, accessed 2026-07-18].
Customers **rarely** state these, and when a code shows up it is typically advisor-pasted (see §2, `tkc-165`
multi-system dump) — do not build keywords on codes, and treat a code fragment as multi-symptom in context.

Feeds slot values: `warning_light_named` verbatim strings ("airbag", "srs", "air bag", "passenger airbag off",
"restraint"); `warning_light_behavior` = `steady_on` | `flashing_or_blinking` | `came_on_then_off` |
`multiple_lights_at_once`.

---

## 7. Confusable neighbors (cross-system)

| Neighbor system / subcategory | Why confused | Discriminator |
|---|---|---|
| `multiple_warning_lights_at_once` | SRS very often co-illuminates in a charging/voltage cascade | **count/behavior**: SRS + 2 or more others, or "all of them / Christmas tree" → multiple; **SRS the only light** → `airbag_srs_light`. (`warning_light_behavior=multiple_lights_at_once`.) |
| `after_a_recent_accident_or_impact` | the light often follows an impact | **framing + severity**: a **minor** bump, **no deployment**, drivable, and the customer wants **the light** diagnosed → `airbag_srs_light`; a **collision** framing (deployed bags, damage, insurance, "check the whole car") → the accident bucket. (`drivable_state` + `customer_request_type`.) |
| `after_recent_service_or_repair_work` | the light often follows recent work under/around the seats or a battery swap | **who did it + blame**: a **SHOP** the customer causally blames and wants to make it right ("they broke it") → the service bucket (§3b situational override); **DIY** or incidental timing with "diagnose the light" → `airbag_srs_light`. (`recent_action=general_service` + causal-blame framing.) |
| `safety_concern_dont_feel_safe_driving_it` | a safety-system light invites "is it even safe to drive?" | a **named**, diagnosable airbag/SRS light + a **passing** safety question → `airbag_srs_light`; **fear dominates** with no diagnosable symptom named → the safety-concern bucket. A safety question alone does **not** override a named light. |
| airbag **recall** inquiry (Takata-era) | "recall letter about my airbag" mentions the airbag but reports no symptom | a **recall/eligibility** question ("is my car affected?") has **no diagnostic subcategory** → advisor / recall handling (null-route); a customer describing the **light on** → `airbag_srs_light`. |
| `battery_charging_light` / charging-starting | SRS code can be set by a battery/jump event | isolated SRS light after voltage event → here; a **battery** telltale + dim lights + hard cranking → charging |
| `accessory_doesnt_work` (electrical) | clockspring failure also kills the horn / SWC buttons | if the customer names the **airbag/SRS light**, route here even when the horn is also dead (clockspring); a dead accessory with **no SRS light** → `accessory_doesnt_work` |
| seat-belt **chime/buzzer** (no light) & mechanical belt hardware | "seat belt" wording, restraint-adjacent | a **belt that won't latch/retract** or a **nuisance chime with no telltale** → advisor / proposed `seat_belt_or_restraint_hardware` (§8), **not** `airbag_srs_light` |
| `abs_anti_lock_brake_light` / `traction_control_stability_light` / `power_steering_eps_light` | other amber chassis lights that ride with SRS on a bus fault | if SRS is one of **several**, route `multiple_warning_lights_at_once`; if SRS is the **only** light, this system |

Cross-reference: warning-lights router owns the master telltale list + `multiple_warning_lights_at_once`
disambiguation; requests/maintenance router owns `after_a_recent_accident_or_impact` framing; the
`abs-traction-stability` dossier logs the same shared-bus cascade from the ABS side.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| FM-1 buckle switch / tension sensor | airbag_srs_testing | warning_light | airbag_srs_light | good |
| FM-2 OCS / passenger-airbag-off | airbag_srs_testing | warning_light | airbag_srs_light | good |
| FM-3 clockspring | airbag_srs_testing | warning_light | airbag_srs_light | good |
| FM-4 minor-impact crash code | airbag_srs_testing | warning_light | airbag_srs_light | good (guard vs accident bucket via §5) |
| FM-5 under-seat wiring after interior work | airbag_srs_testing | warning_light | airbag_srs_light | good |
| FM-6 low-voltage latched code (isolated) | airbag_srs_testing | warning_light | airbag_srs_light | good |
| FM-7 flood / water intrusion | airbag_srs_testing | warning_light | airbag_srs_light | good |
| FM-8 SRS in a cascade | (charging_starting / warning_light_general) | warning_light | multiple_warning_lights_at_once | good (route away) |
| FM-9 mechanical seat belt / restraint hardware (no light) | (none) | electrical / — | **NO FIT** | **NO FIT → advisor null-route + Chris-gated subcategory proposal** |

**One NO-FIT (FM-9).** A physical restraint-hardware complaint (belt won't latch/retract, frayed webbing, buckle
won't release) and the seat-belt-chime-with-no-light nuisance have no home: they are not a warning light and not a
dead electrical accessory. Demand in the corpus is **thin** (seat-belt appears only as an SRS-light *trigger*, not
as a standalone hardware complaint), so this is **propose-only** — a Chris-gated `seat_belt_or_restraint_hardware`
subcategory under the `electrical` category (the SRS service already reaches it), plus an advisor null-route in the
golden set for the meantime. Do **not** author a question set speculatively.

**Catalog note (non-blocking, high-value lever):** `airbag_srs_testing.example_keywords` is **empty** in the live
DB — a Stage-1 lever left entirely on the table. All `stage1.keyword.add` ops target it and are **multi-token /
domain-token** only, but their **attestation varies** (the proposals file names the true source per keyword, and
they are NOT all Tekmetric-corpus-attested):
- **Tekmetric corpus:** "airbag light on", "air bag light" (line ~5758).
- **NHTSA ODI:** "airbag warning light", "SRS light" ("SRS Warning Light ON").
- **Authored eval / DB synonym (not corpus):** "srs triangle" (eval -004), "airbag person light" (eval -003),
  "airbag light flashing" (eval -002).
- **Domain phrase (no corpus occurrence):** "passenger airbag off" — kept as an unambiguous ≥2-token OCS
  telltale, flagged as domain-attested rather than corpus-attested.

---

## 9. Fact-slot audit

**Slots this system uses (with real corpus values):**
- `warning_light_named` — "airbag", "air bag", "srs", "srs triangle", "person with seatbelt", "passenger airbag
  off", "restraint". The primary router into and out of this subcategory.
- `warning_light_behavior` — `steady_on` (fault), `flashing_or_blinking` (blink-code pattern, still a fault),
  `came_on_then_off`, `multiple_lights_at_once` (route away to the cascade subcat).
- `recent_action` — `accident_or_impact` / `hit_pothole_or_curb` (crash code), `general_service` (seat/interior
  work), `battery_or_alternator_work` / `jump_started` (voltage event), `car_wash_or_driven_through_water`
  (flood), `car_sat_unused`. Every one of these is a live SRS-light trigger.
- `started_when` — `today` / `days_ago` / `weeks_ago`.
- `accessory_affected` — "horn", "cruise buttons", "steering wheel controls" (the clockspring bundle).
- `drivable_state` — `drivable_but_concerned` (a lone SRS light) — and the discriminator vs the accident bucket.
- `customer_request_type` — `diagnose_problem` (want the light checked) vs a collision/insurance framing that
  pushes to `after_a_recent_accident_or_impact`.

**Missing values / limitations found:**
1. **`recent_action` single-value collision — the dominant structural limitation for this system.** FOUR of the
   seven `airbag_srs_light` questions gate on `recent_action`: **427** (accident?), **428** (seat/dash/steering/
   belt work?), **432** (sitting / battery disconnected-replaced?), **433** (flood/wet?). Because the extractor
   stores only ONE `recent_action`, a customer who states a single trigger (e.g., "fender bender" →
   `accident_or_impact`) causes the mapper to treat **all four** as answered, silently skipping the
   seat-work / battery / flood questions that were never actually addressed. This is a **multi-value
   `recent_action[]`** need, not a per-system op — flagged for Workstream-Q / a future array slot. It is the
   single highest-value structural fix touching this system.
2. **No slot distinguishes a dashboard telltale from a seat-belt CHIME/buzzer or mechanical belt hardware.** The
   null-route trap (§5) has no clean fact cue. This is the **same** sub-threshold `warning_indicator_kind` idea
   the `abs-traction-stability` dossier logged (dash telltale vs exterior lamp) — it is a **single-question** need
   here, so it does **not** meet the ≥3-question bar; handled with a negative example + advisor null-route.
   Logged for the warning-lights router: if ≥3 systems hit it, a `warning_indicator_kind` slot becomes justified.
3. **No slot captures "who/what is in the seat" for the OCS normal-vs-fault call.** Questions 429 (buckle
   obstruction) and 430 (occupancy-area use) are physical-inspection confirmations with no holding slot — a
   single-question need each, below the bar. Handled as `intentionally_empty` (Workstream Q), not a new slot.

**Proposed new slots: NONE.** Every discriminating question this system needs is expressible in the current 29
slots, and each gap above is either a **cross-slot cardinality** problem (`recent_action[]`, owned by Workstream
Q) or a sub-threshold single-question need. Proposing a slot here would fail the ≥3-question rule.

**Workstream-Q contribution (empty `required_facts` on this subcategory):**
- **429** ("anything stuck in a seat-belt buckle?") → `intentionally_empty` — physical-inspection yes/no; no slot
  captures buckle obstruction; must always be asked.
- **430** ("car seat installed / passenger occupancy area used differently?") → `intentionally_empty` — no slot
  captures occupancy-area usage; a NEVER-skip confirmatory question.

---

## 10. Sources (tiered, per-claim)

> Citation-format note (fleet-wide convention gap): inline cites below carry source + tier + access date but
> **omit URLs** for the print/standards references (Bosch handbook, SAE, ASE task lists), matching the sibling
> dossiers. URLs are given where a stable canonical page exists. Bringing full URL+date+tier to every inline
> cite is a shared cross-dossier convention item, flagged here at pattern level.

**Diagnostic authority**
- NHTSA / FMVSS No. 208 (49 CFR 571.208) — occupant crash protection; advanced-airbag occupant classification
  (OCS enable/disable) mandated. **Tier 1.** <https://www.ecfr.gov/current/title-49/section-571.208>; consumer
  air-bag warning-light guidance <https://www.nhtsa.gov/>. accessed 2026-07-18.
- SAE J2012 (DTC nomenclature; SRS = Bxxxx body codes) / J1930 (terminology; SRS/SIR). **Tier 1.**
  <https://www.sae.org/standards/content/j2012_201612/>. accessed 2026-07-18.
- ASE A6 (Electrical/Electronic Systems) task list — SRS / airbag warning-light & restraint-electronics diagnosis.
  **Tier 1** (official ase.com). <https://www.ase.com/>. accessed 2026-07-18.
- Bosch *Automotive Handbook* — occupant-protection chapter (crash sensors, squib circuits, clockspring/rotating
  connector, occupant classification, ECU low-voltage behavior) **and** the vehicle-electrical-system chapter
  (networked-ECU supply-voltage behavior → multi-telltale illumination, the FM-8 anchor). **Tier 2.** accessed 2026-07-18.
- IEE (occupant-classification supplier) + OEM owner-manual OCS descriptions (weight thresholds, PASSENGER AIRBAG
  OFF lamp). **Tier 2.** accessed 2026-07-18.
- FreeASEStudyGuides — SRS / airbag warning-light meaning (normal bulb-check vs steady/blink-pattern fault).
  **Tier 3** (third-party study site, **not** official ase.com; corroboration only — the claim stands on the NHTSA
  Tier-1 co-cite). accessed 2026-07-18.
- 2CarPros "Symptoms of a bad airbag clock spring" + corroborating parts-vendor technical write-ups (SRS light +
  horn + steering-wheel controls fail together; position-dependent early); iATN / diagnostician reports of SRS
  codes after battery/jump events. **Tier 3 (corroboration only).** accessed 2026-07-18.

**Linguistic authority (voice only, never cited for diagnosis)**
- Tekmetric corpus: `real-concerns-tekmetric-labeled-v2.json` — the **only four** airbag/SRS utterances: "AIR BAG
  LIGHT ON ... SHE WAS IN ACCIDENT RECENTLY AND WANTS TO TALK TO BODY SHOP 1st" (line ~5758, routes to the accident
  bucket); "ABS & TRAC LIGHTS COMING ON ... ALSO TPMS AND AIRBAG" (line ~7079, routes to the cascade); and the
  `tkc-165` multi-system code dump containing "air bag code pass seat sensor" (line ~3820). Only these carry
  `tekmetric` provenance.
- **NHTSA ODI complaint narratives** (public domain, real consumer voice; paraphrased to first person, provenance
  `nhtsa`): recurrent "airbag light always on", "SRS warning light on", SRS-module-failure ("the SRS computer
  malfunctioned / needs replacing"), and airbag-**recall** mentions. These are the primary source of real
  in-subcategory voice given the corpus scarcity above.
- Authored eval cases: `eval-cases.json` (`airbag_srs_testing-001..004`). These are **authored test data, not real
  corpus voice** — in the machine files they are labeled `synthetic` (the enum has no "authored" value) with the
  eval id noted, so they do not inflate the real-voice count.
- Forums (paraphrased patterns only, never verbatim): `real-concerns-forums.json` — the **U-code no-start cascade**
  (ABS+traction+airbag+security, line ~1450); paraphrased for the lexicon. **Correction:** this file does **not**
  contain a clockspring horn-and-airbag pattern (its only horn line is an unrelated remote-start entry, line ~818);
  the clockspring customer phrasings are therefore flagged `synthetic`, representing the Tier-3-cited diagnostic
  pattern (§3 FM-3), not a forum quote.

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every failure mode (FM-1..FM-9) carries ≥1 customer-voice phrasing (§4/lexicon) and ≥1 discriminating fact (§5).
- [x] Every diagnostic claim in §2/§3 carries a **nameable** Tier 1/2 cite (Tier 3 only as corroboration, never
  sole). Filler non-sources ("general SRS service practice", "general vehicle-network principle") removed; FM-8 now
  anchored to the Bosch vehicle-electrical-system chapter (Tier 2); FreeASEStudyGuides relabeled Tier 3.
- [x] Every negative example in the proposals names a `routes_to`.
- [x] Synonyms are ≥2 tokens OR domain tokens (SRS, OCS, clockspring, "passenger airbag off") — no bare "light"/"airbag" alone; no synonym duplicates the DB's existing 16 (dropped redundant "SRS light on").
- [x] Stage-1 keyword ops target the empty `airbag_srs_testing.example_keywords`; all are multi-token/domain-token,
  and each op's `evidence` names its **true** attestation (Tekmetric corpus / NHTSA / authored eval / domain) — NOT
  claimed to be corpus-attested where it is not (§8).
- [x] Provenance is exact: only genuine `real-concerns-tekmetric` lines are `tekmetric`; NHTSA ODI voice is `nhtsa`;
  authored eval text and the sourceless clockspring phrasings are `synthetic` (flagged); the forum entry is
  paraphrased, not verbatim. No false "clockspring in forums" attribution.
- [x] Literalness respected — fact cues set a slot only when literally stated (§5 guard; inference-trap golden case
  included). Golden case for the DIY seat-shampoo case sets **no** `recent_action` (matches eval -003); the OCS-fault
  lexicon entry is `unambiguous` because the phrase literally names the light AND states an adult is seated.
- [x] ≥8 golden cases (13) incl. ≥1 inference-trap (normal OCS "passenger airbag off" for a child; `stage1_acceptable: []`)
  and null-routes (mechanical seat belt, recall inquiry, work-order noise).
- [x] Confusables owned: airbag-vs-cascade (`warning_light_behavior=multiple_lights_at_once`),
  airbag-vs-accident-bucket (`drivable_state` + `customer_request_type`), airbag-vs-recent-service-bucket
  (`recent_action=general_service` + causal-blame; §3b override), airbag-vs-charging, and airbag-vs-safety-concern
  (a named light + passing safety Q stays here). Recall inquiry null-routes to advisor.
- [x] No new subcategory or slot proposed where existing taxonomy fits; the one NO-FIT (mechanical restraint
  hardware, FM-9) is Chris-gated propose-only; the cross-system `warning_indicator_kind` idea and the
  `recent_action[]` cardinality fix are logged as out-of-scope-here, not proposed as per-system ops.
- [x] Two empty-`required_facts` questions on this subcategory (429, 430) triaged as `intentionally_empty` (Workstream Q).
- [x] Lexicon `ambiguity` uses only sanctioned values (`unambiguous` / `needs-fact:<slot>` / `cross-system:<slug>` /
  `null-route`); null-routes carry empty `routes_to []` and `null-route` (no "advisor" pseudo-slug).
