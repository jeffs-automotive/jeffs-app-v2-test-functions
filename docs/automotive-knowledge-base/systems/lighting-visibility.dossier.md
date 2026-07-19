# Exterior lighting, wipers/washer & defog — diagnostic dossier
slug: lighting-visibility   date: 2026-07-18
binds_services: [electrical_testing_general, charging_starting_testing, windshield_inop_testing, coolant_leak_testing, ac_performance_check]
binds_categories: [electrical, leak, hvac]
bound_subcategory_slugs: [dim_or_flickering_lights, accessory_doesnt_work, blue_or_light_blue_puddle_washer_fluid, foggy_or_hard_to_defog_windows]

> **Positioning.** This is the *visibility & illumination* surface — the parts of the car a driver uses
> to SEE and BE SEEN: exterior lamps, the wiper/washer system that keeps the glass clear, and the
> defrost/defog function that clears interior fog. It is deliberately a "lighting-and-glass" dossier,
> NOT the charging system. Where the two touch (whole-system dim/flickering lights), the
> `starting-charging` dossier owns the alternator/battery *mechanism*; this dossier owns the
> *lighting-fixture differential* — "is this actually charging, or is it a bulb / ground / wiring
> fault?" — and the single-bulb-out boundary. See §7.

---

## 1. Scope & boundaries

**In scope**
- **Exterior lighting fixtures & their circuits:** headlights (low/high beam, halogen/LED/HID), DRLs,
  taillights, brake-light *bulbs*, turn signals / blinkers, side-marker & license-plate lamps, fog
  lamps — the bulb, socket, fuse, relay, switch, ground, and lamp wiring.
- **Interior/accessory illumination as a lighting complaint:** dome/map light dead or staying on.
- **Whole-system dim / flicker / pulsing** as a *symptom surface* — the discrimination between a
  lighting/ground/wiring cause and a charging cause (mechanism deferred to `starting-charging`).
- **Wiper/washer OPERATION:** wipers won't move, move slowly, stall mid-sweep, chatter/grind/streak;
  washers won't spray; wiper arm/linkage adjustment.
- **Washer-fluid (blue, watery, soapy) leak / puddle.**
- **Defrost/defog VISIBILITY:** persistent interior windshield fog, defrost-vent airflow, rear-window
  defogger grid (the printed heating lines on the back glass).

**Explicitly OUT of scope** (each with the owner dossier)
- **The charging MECHANISM** (alternator output/diodes/regulator, battery, belt, no-start-because-dead) →
  `starting-charging`. Dim/flicker *routing* is shared (§7); the fix-side diagnosis is theirs.
- **Dash WARNING lights** (battery/charge icon, red BRAKE light, ABS, airbag, TPMS, etc.) →
  `router-warning-lights` + the `warning_light` subcats. I own only the *brightness/illumination of the
  lamps themselves*, never the dash telltale icons.
- **The RED brake dash light vs a brake-light BULB** — the dash light → `brakes-friction-hydraulic` /
  `brake_inspection_warning_light`; a burned-out rear brake *bulb* → mine. This is a hard lexical
  confusable (§7).
- **HVAC heat/cold output, blower airflow in general, A/C cooling, cabin smells** → `cooling-system` /
  the `hvac` dossier. I own only the *fog/defog visibility* slice of HVAC.
- **Coolant leaks — including the blue/green Asian-OEM coolant** → `cooling-system` /
  `green_orange_yellow_or_pink_puddle_coolant`. I own only *washer* fluid (blue, watery, soapy). The
  blue-washer-vs-blue-coolant discriminator is §5/§7.
- **Wiper-caused glass scratches / rock chips / cracked windshield** — glass replacement, no testing
  service → advisor / `router-requests-maintenance`.
- **Windshield-wiper-blade REPLACEMENT as a stated request** ("replace my wipers") — that is a
  maintenance/parts request, usually a work-order line → null-route / advisor (§8, §golden).

---

## 2. System primer (expert, CITED)

**Exterior lighting circuits.** Each exterior lamp is a load on a switched 12 V circuit: source →
fuse → switch (headlight switch, brake pedal switch, turn-signal/multifunction stalk, or the body
control module on newer cars) → bulb filament or LED module → ground. A lamp needs *both* a good
feed and a good ground to light. Because grounds are often shared and corrode, a poor ground shows up
as a *dim or oddly-behaving* lamp, while an open feed/filament shows up as a *fully dead* lamp
[CarParts.com, "Alternator Voltage Regulation 101" (charging/lamp-load context), Tier 3, accessed
2026-07-18; corroborated by the ground-load behavior in Halderman *Automotive Electricity & Electronics*
ground-circuit chapter, Tier 2]. Modern LED tail/turn assemblies fail as a *module* (you can't just
swap a bulb), which is why "I replaced the bulb and it's still out" is common — the fault is the
socket, fuse, wiring, ground, or the sealed module, not the lamp the customer changed.

**Whole-system dim/flicker is a VOLTAGE story.** When *all* the lights dim or pulse together — and
especially when brightness *rises when you rev and falls at idle* — the cause is system voltage, not
the lamps. A healthy charging system holds ~13.5–14.5 V; a failing alternator (worn brushes, a bad
rectifier diode, or a failing voltage regulator) or a slipping belt delivers unstable/low voltage, so
every lamp's brightness tracks engine speed and accessory load [Firestone Complete Auto Care, "7 Signs
of a Bad Alternator," Tier 3, accessed 2026-07-18; FCP Euro, "The Bosch Alternator — How It Works,"
Tier 3, accessed 2026-07-18 — two independent Tier-3 for a fundamental claim]. **This dossier's job at
Stage 1/2 is only to separate a *lighting-fixture* cause (one lamp, localized ground/wiring) from a
*system-voltage* cause; the charging mechanism itself is `starting-charging` §3.6.**

**Wiper/washer.** A single reversing (or rack-driven) wiper motor drives a linkage/transmission that
converts rotation into the wipe sweep; a park switch returns the blades to rest. The washer system is
independent: a small electric pump in the reservoir pushes fluid through hoses to the nozzles. Symptom
→ subsystem: *won't move at all* = motor / linkage / park-switch / fuse / stalk switch; *moves slowly
or stalls mid-glass* = motor or binding linkage; *chatter / grind / streak* = worn blades, bent arm,
or a seized linkage joint; *won't spray* = empty reservoir, failed pump, split/clogged hose, blocked
or frozen nozzle. A *leak* is the reservoir or a hose — mechanically harmless. Diagnostic tell for the
"won't spray": if you can HEAR the pump hum/whine when the switch is pressed but nothing reaches the
glass, the pump has power and the fault is downstream (clogged nozzle / split hose); silence points at
the pump, fuse, or switch [Erjavec, *Automotive Technology*, body-electrical wiper/washer chapter,
Tier 2 (standard textbook; not quoted); corroborated by AA1Car, "Windshield Wiper System" (blown fuse
vs. open circuit vs. failed motor; worn linkage bushings; blade spring-tension chatter), Tier 3,
accessed 2026-07-18, https://www.aa1car.com/library/replace_windshield_wiper_blades.htm].

**Defrost / defog.** Interior fog is condensation: warm, humid cabin air meeting cold glass. Defrost
mode routes airflow to the windshield **and engages the A/C compressor to dehumidify** even in winter —
air passes over the cold evaporator, moisture condenses on the coil and drains out, and the resulting
bone-dry air clears the glass [cold-evaporator condensation dehumidification is refrigeration
psychrometrics — a Tier-1-equivalent physical mechanism; corroborated by MACS (Mobile Air Conditioning
Society) defrost-mode guidance, Tier 2 (HVAC trade authority), and independently stated by the live DB
subcategory description for `foggy_or_hard_to_defog_windows`; accessed 2026-07-18]. So a defog complaint can be an *A/C* fault (compressor won't engage → no dehumidification),
a *clogged evaporator drain* (water dumped into the cabin → chronic humidity, wet carpet), a *leaking
heater core* (coolant vapor → sweet-smelling oily film on the glass), a *blocked defrost vent / stuck
recirculation door*, or simply too many passengers exhaling. The **rear-window defogger** is a different
animal: a printed resistive grid on the glass that heats by Joule's law (P = I²R) when 12 V is applied;
a scratched or broken grid line breaks continuity and leaves one horizontal stripe permanently fogged
[Frost Fighter Technical Bulletin 118, "Measuring Defroster Health," Tier 2 (manufacturer technical
doc), accessed 2026-07-18; Joule-heating principle, Tier 1 physics].

---

## 3. Failure-mode catalog (the diagnostic spine, CITED per mode)

### 3.1 Single exterior bulb / lamp out
- **Sensory signature:** `accessory_affected` = a named lamp ("driver headlight", "left taillight",
  "right turn signal", "fog light"); `lights_state` = null/`normal` (the *other* lamps are fine — this
  is NOT a brightness complaint). Often stated as a work-order imperative.
- **Conditions:** none required; frequently `location_side` given ("driver side low beam").
- **Severity / drivability:** `drivable_normally` (a safety/legal issue at night, not a breakdown).
- **Customer misattribution:** replaces the bulb, still dark → the fault was the socket, fuse, ground,
  wiring, or (LED) the sealed module [corpus: "DRIVER HEADLIGHT OUT, CLIENT REPLACED HEADLIGHT AND BULB
  IS STILL OUT" → consensus `electrical_testing_general`]. Confirms the route is the general electrical
  test, not a warning-light service.
- **Route:** `electrical_testing_general` → subcat `accessory_doesnt_work` (weak fit; see §8 proposal).

### 3.2 Turn-signal not working / intermittent / hyperflash
- **Sensory signature:** `accessory_affected` = "turn signal"/"blinker"; `onset_timing`
  =`intermittent`; sometimes "flashes fast." **Hyperflash mechanism (corrected):** a dead bulb makes
  that branch an open, so the circuit draws *less* current. An **electronic** flasher module reads the
  reduced load as a bulb-out and *speeds up* (hyperflash) as a deliberate warning; a classic **thermal
  (bimetallic)** flasher does the opposite — it *slows down or stops*. So "flashes fast" is an
  electronic-flasher bulb-out cue, NOT a universal one [J.W. Speaker, "How to Fix Hyper Flashing with
  LED Lights," Tier 3, accessed 2026-07-18,
  https://www.jwspeaker.com/blog/education-center/how-to-fix-hyper-flashing-with-led-lights/;
  Super Bright LEDs, "LED Turn Signals Blinking Too Fast (Hyperflashing)," Tier 3, accessed 2026-07-18,
  https://www.superbrightleds.com/blog/led-turn-signals-blinking-too-fast-hyperflashing.html — two
  independent Tier-3].
- **Severity:** `drivable_normally`.
- **Route:** `electrical_testing_general` → `accessory_doesnt_work` [corpus: "RIGHT REAR TURN SIGNAL
  NOT WORKING INTERMITTENTLY. ELECTRICAL TESTING AUTH $179" → consensus `electrical_testing_general`,
  confirmed]. Bulb/socket/ground/connector per §2.

### 3.3 Whole-system dim/flicker that tracks engine RPM  ← the alternator cue
- **Sensory signature:** `lights_state` = `dim_at_idle_brighten_when_revving`; all lamps + dash + radio
  dim together; may dip when AC/defroster/brakes load the system.
- **Conditions:** worst at idle/stoplights; improves on rev.
- **Severity:** `drivable_but_concerned` (a charging failure can strand the car).
- **Customer misattribution:** "my headlights are bad" — it's the alternator, not the lamps [Firestone,
  Tier 3; FCP Euro, Tier 3, accessed 2026-07-18].
- **Route:** `dim_or_flickering_lights` (electrical). **The mechanism (alternator/regulator/diode) is
  `starting-charging` §3.6** — this dossier only ensures the RPM cue is captured so the pick is right.

### 3.4 Whole-system dim/flicker NOT tied to RPM (steady dim / random flicker)
- **Sensory signature:** `lights_state` = `dim_or_flickering`; brightness does *not* change with revs;
  may correlate with a specific ground/connector (dims on bumps, when a door is touched, headlight
  switch heat).
- **Cause space:** corroded battery/ground cable, bad chassis ground, failing headlight switch, high
  resistance in lamp wiring — a *lighting-fixture/wiring* fault, not necessarily charging.
- **Route:** `dim_or_flickering_lights` (electrical); this is the mode where THIS dossier's
  fixture/ground knowledge, not `starting-charging`, carries the diagnosis [Halderman ground/voltage-
  drop chapter, Tier 2].

### 3.5 Dim/flicker then the car DIED (electrical precursor to a stall/no-restart)
- **Sensory signature:** `lights_state` = `dim_or_flickering` **plus** `engine_running`
  =`died_while_driving`, often `drivable_state`=`not_drivable_needs_tow`/`stranded_now`.
- **Route — NOT this dossier's dim subcat:** → `car_died_while_driving_electrical` /
  `charging_starting_testing`. The dimming is a *precursor*, and the load-bearing fact is the death.
  This is the §golden inference-trap. [corpus: "TOW IN LOST ACCELERATION ON HIGHWAY LIGHTS WERE
  FLICKERING … WOULD NOT TURN OVER" → consensus `charging_starting_testing`.]

### 3.6 Wipers won't move at all
- **Sensory signature:** `accessory_affected` = "wipers"; `recent_action` =
  `car_wash_or_driven_through_water` common (water intrusion into the motor/linkage/switch).
- **Severity:** `drivable_but_concerned` in rain.
- **Route:** `windshield_inop_testing` [corpus: "Wipers stopped working" → consensus
  `windshield_inop_testing`; eval `windshield_inop_testing-002`: "quit right after the car wash"].

### 3.7 Wipers move slowly / stall mid-sweep
- **Sensory signature:** slow sweep, stalls halfway up the glass; sometimes one blade lags
  (`location_side`). Motor weak or linkage binding.
- **Route:** `windshield_inop_testing` [eval `windshield_inop_testing-004`: "moving way slower than
  normal and sometimes stall halfway up the glass"].

### 3.8 Wiper grinding / squeaking / chatter / streak
- **Sensory signature:** `noise_descriptor` = `grinding_metallic` or `creaking_or_squeaking`; blades
  drag/chatter; streaking. Worn blades, bent arm, or seized linkage.
- **Route:** `windshield_inop_testing` [eval `windshield_inop_testing-001`/`-003`]. NB: "just replace my
  blades" with no operation fault is a maintenance request (§8, null-route).

### 3.9 Washers won't spray
- **Sensory signature:** `accessory_affected` = "washers"; wipers themselves may work fine. Empty
  reservoir, dead pump, split/clogged hose, blocked/frozen nozzle.
- **Route:** `windshield_inop_testing` — NOTE: a spray failure is a *wiper/washer operation* fault,
  **not** the washer-fluid *leak* subcat [corpus: "WASHERS NOT SPRAYING." and "WIPERS NOT SPRAYING
  TESTING AUTH UP TO 179 IF NEEDED" → consensus `windshield_inop_testing`].

### 3.10 Washer-fluid leak / puddle (blue, watery, soapy)
- **Sensory signature:** `fluid_color` = `blue_or_light_blue`; `fluid_under_car_location` =
  `under_engine_front`/off to one side near a front wheel; thin/watery; faint soapy/alcohol smell (NOT
  sweet); reservoir keeps going empty.
- **Cause:** cracked washer reservoir or a split feed hose; a cold-weather freeze can crack the bottle.
- **Severity:** `drivable_normally` — harmless to the car.
- **Route:** `blue_or_light_blue_puddle_washer_fluid` (leak) [corpus: "WASHER FLUID LEAKING. TESTING
  AUTH" — labeled *ambiguous* by the judges, which is exactly the washer-leak vs washer-spray-vs-service
  tension this dossier resolves in §5].

### 3.11 Windshield fogs on the inside / defrost won't clear it
- **Sensory signature:** interior fog that persists; `weather_condition` = `rainy_or_wet` /
  `cold_weather` / `humid`; `hvac_mode` = `defrost`; fog worse with more passengers.
- **Cause space (per §2):** A/C compressor not engaging in defrost (no dehumidification), clogged
  evaporator drain, blocked defrost vents, stuck recirculation door.
- **Customer misattribution:** blames the glass or the wipers; it's the HVAC dehumidification path
  [defrost-mode A/C dehumidification — refrigeration psychrometrics (Tier-1-equivalent) + MACS Tier-2,
  per §2; accessed 2026-07-18].
- **Route:** `foggy_or_hard_to_defog_windows` (hvac) [eval `ac_performance_check-007`: "inside of my
  windshield keeps fogging up when it rains and the defroster barely clears it"].

### 3.12 Rear-window defogger grid dead (lines don't heat)
- **Sensory signature:** `accessory_affected` = "rear defroster"/"rear defogger"; back glass won't
  clear, sometimes one horizontal stripe stays fogged (a single broken grid line).
- **Cause:** broken/scratched grid line, failed tab/contact, blown fuse, dead switch — *electrical*, by
  Joule heating [Frost Fighter Tech Bulletin 118, Tier 2, accessed 2026-07-18].
- **Route:** `foggy_or_hard_to_defog_windows` — the live DB description **explicitly bins the rear
  defogger grid here** ("Rear-window defroster … not heating is also covered here — that's electrical,
  not airflow"), NOT under `accessory_doesnt_work`. Reinforce this so the electrical wording doesn't
  pull it to the electrical bucket (§5).

### 3.13 Oily/greasy film on the inside of the glass + persistent fog
- **Sensory signature:** greasy film you can't wipe clear; often `smell_descriptor` =
  `sweet_or_maple_syrup`; sometimes wet passenger carpet.
- **Cause:** leaking heater core seeping coolant vapor onto the glass — a *cooling-system* fault
  surfacing as a visibility complaint.
- **Route (smell/leak-led):** if the customer leads with a **sweet smell**, route
  `sweet_smell_maple_syrup_antifreeze` (smell) / `cooling-system`; if they lead with **fog + film only**,
  `foggy_or_hard_to_defog_windows` and the questionnaire surfaces the heater-core clue (Q599 oily film,
  Q598 wet carpet). Cross-referenced with `cooling-system` §heater-core.

### 3.14 Interior/exterior lamp STUCK ON (won't shut off → battery drain)
- **Sensory signature:** `accessory_affected` = "dome light"/"map light"/"headlights" that **won't turn
  off**; the customer may instead lead with the *downstream* symptom — a battery that keeps going dead
  overnight. A stuck-on lamp is a continuous load; left on, it is a classic parasitic draw that flattens
  the battery [Halderman, *Automotive Electricity & Electronics*, parasitic-draw / body-electrical
  chapter, Tier 2 (standard textbook; not quoted)].
- **Cause:** stuck door-jamb switch, mis-adjusted dome-light switch, shorted lamp circuit, or a
  body-control-module fault holding the output on.
- **Severity:** `drivable_normally` (until the battery dies → then `not_drivable_needs_tow`).
- **Route:** `accessory_doesnt_work` / `electrical_testing_general`. **Honesty note:** the one corpus
  line describing a stuck-on dome light rode a *multi-symptom* concern and the judges routed the whole
  thing to `multiple_symptoms_not_sure_what_category` — so if the stuck lamp is stated ALONGSIDE other
  glitches, expect `multiple_random_electrical_glitches` / the multi-symptom bucket, not this subcat.

### 3.15 Cloudy / oxidized headlight lenses (OPTICAL dimness — not electrical)
- **Sensory signature:** "my headlights are so dim at night," but the customer also describes the lenses
  as **cloudy / hazy / yellowed**; brightness does NOT change with RPM, load, or flicker. This is a
  *physical* problem: oxidized/UV-hazed polycarbonate scatters and absorbs the beam, cutting output
  [light-scatter through a degraded polycarbonate lens — established optical principle, Tier-1-equivalent;
  treated as a cleaning/restoration maintenance item, NOT an electrical fault].
- **Severity:** `drivable_normally`.
- **Route:** advisor / lens restoration (`router-requests-maintenance`) — a **direct confusable** with
  `dim_or_flickering_lights`; the discriminator is "electrical dim/flicker (varies, all lamps)" vs
  "steady optical dimness + visibly cloudy lenses." Negative example encoded in §proposals (§5, §7).

### 3.16 Both headlights out at once (shared circuit, not two dead bulbs)
- **Sensory signature:** `accessory_affected` = "both headlights"/"headlights" out **together**. Two
  bulbs almost never fail at the same instant — simultaneous loss points at a *shared* element: the
  headlight switch, a common relay, the multifunction (dimmer) stalk, a shared ground, or a BCM output,
  per the shared feed→switch→ground circuit of §2 [per §2 circuit description; Halderman ground/shared-
  circuit chapter, Tier 2].
- **Severity:** `drivable_but_concerned` at night.
- **Route:** `electrical_testing_general` (→ `accessory_doesnt_work`, or `exterior_light_out` if
  proposed). Distinguish from §3.1 single-bulb-out (one named lamp; the other side fine).

### 3.17 Wipers won't turn OFF / won't park
- **Sensory signature:** `accessory_affected` = "wipers" that **keep running after the switch is off**
  or **stop mid-glass instead of returning to rest**. The park switch — the contact that tells the motor
  where "rest" is and cuts power there — has failed, or the motor's park circuit is shorted [park-switch
  function per §2; AA1Car wiper diagnosis, Tier 3, accessed 2026-07-18,
  https://www.aa1car.com/library/replace_windshield_wiper_blades.htm].
- **Severity:** `drivable_but_concerned` (blades block vision when parked mid-glass).
- **Route:** `windshield_inop_testing` (service-level; no stage-2 subcat) — same service as won't-move.

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Real-voice phrasings, source-ordered (Tekmetric corpus → forums → eval → synthetic-flagged). Full
machine form in `lighting-visibility.lexicon.yaml`.

**Exterior bulb out (→ accessory_doesnt_work / electrical_testing_general):**
- "DRIVER HEADLIGHT OUT, CLIENT REPLACED HEADLIGHT AND BULB IS STILL OUT" — tekmetric
- "CHECK TAIL LIGHTS" — tekmetric (imperative but consensus-routed to electrical)
- "RIGHT REAR TURN SIGNAL NOT WORKING INTERMITTENTLY … CHECK CONNECTIONS" — tekmetric
- "my blinker isnt working on the drivers side" — synthetic (customer voice)
- "one of my brake lights is out" — synthetic (NB: the BULB, not the dash light)

**Whole-system dim / flicker (→ dim_or_flickering_lights):**
- "headlights & dash lights flicker almost all the time … voltage at battery … 14.2 VDC" —
  forum-paraphrase
- "my headlights keep going dimmer and brighter on there own at night, its kinda freaky" — eval
  (`dim_or_flickering_lights`)
- "The headlights and interior lights of my camry started to flicker while driving and sometimes loses
  the power to the radio, a/c and the lights shut off" — forum-paraphrase
- "lights dim every time i turn on the AC or hit the brakes" — synthetic (load cue)

**Wipers/washers (→ windshield_inop_testing):**
- "Wipers stopped working" — tekmetric
- "WIPERS NOT SPRAYING TESTING AUTH UP TO 179 IF NEEDED" / "WASHERS NOT SPRAYING." — tekmetric
- "wipers barely work when its raining … the passenger side one hardly moves" — eval
- "windshield wipers are moving way slower than normal and sometimes stall halfway up the glass" — eval
- "my wipers quit right after i went thru the car wash" — eval

**Washer-fluid leak (→ blue_or_light_blue_puddle_washer_fluid):**
- "WASHER FLUID LEAKING. TESTING AUTH" — tekmetric
- "Light blue watery puddle near my front tire, washer fluid won't spray anymore" — DB positive
- "looks like windex leaking under the car" — DB positive (great real-voice)

**Defog / fog (→ foggy_or_hard_to_defog_windows):**
- "inside of my windshield keeps fogging up when it rains and the defroster barely clears it" — eval
- "windows fog up bad in the rain, defrost barely helps" — DB positive
- "Rear window defroster doesn't work — lines on the back glass don't heat up" — DB positive
- "inside of the windshield has a greasy film i cant wipe off" — DB positive (heater-core clue)

**Null-route work-order lines (NOT a concern → advisor / empty stage1):**
- "REPLACE DRIVERS SIDE LOW BEAM" — tekmetric (ambiguous/imperative)
- "Previously declined>Remove & Replace Fog Lamp Bulb" — tekmetric (null consensus)
- "REPLACE WIPERS IF NEEDED." / "do not top off washer fluid" — tekmetric (null consensus)

---

## 5. Differential & discriminating questions (binds required_facts + slots)

Each row: the ONE best discriminating question + the fact slot + value that resolves it.

| Confusable pair | Discriminating question | Fact slot → value |
|---|---|---|
| **Dim/flicker: alternator (charging) vs lamp/ground/wiring** | "Do the lights get **brighter when you rev** and dimmer at idle?" | `lights_state` = `dim_at_idle_brighten_when_revving` (→ charging, §3.3) vs `dim_or_flickering` with no RPM link (→ fixture/ground, §3.4) |
| **Single bulb out vs whole-system dim** | "Is it **just one light** that's out, or are **all** your lights dim/flickering together?" | `accessory_affected` = one named lamp (§3.1) vs `lights_state` = `dim_or_flickering`/`dim_at_idle…` (§3.3–3.4) |
| **Both headlights out vs one bulb** | "Are **both** headlights out at once, or **just one** (the other still works)?" | both together → shared switch/relay/stalk/ground/BCM, `electrical_testing_general` (§3.16); one named lamp → single-bulb (§3.1) |
| **Electrical dim/flicker vs cloudy-lens (optical) dim** | "Do the lights **flicker or change brightness**, or are they **steady but the lenses look cloudy/yellowed**?" | flicker/varies → `dim_or_flickering_lights` (electrical, §3.3–3.4); steady + hazy lenses → advisor/lens restoration (§3.15), NOT an electrical test |
| **Dim-only vs dim-then-DIED** | "Are the lights just dim, or did the **car actually shut off / won't restart**?" | `engine_running` = `died_while_driving` + `drivable_state` = `not_drivable_needs_tow` → `car_died_while_driving_electrical` (§3.5), NOT the dim subcat |
| **Washer LEAK vs washer WON'T-SPRAY** | "Is fluid **puddling under the car**, or does it just **not spray** on the glass?" | `fluid_color`=`blue_or_light_blue` + `fluid_under_car_location` present → leak subcat (§3.10); absent + "won't spray" → `windshield_inop_testing` (§3.9) |
| **Blue washer fluid vs blue/green COOLANT** | "Is it **thin and watery with a soapy/chemical smell**, or **slimy and sweet**, and is it under the **radiator** or off to the **side/front wheel**?" | soapy + watery + off-side → washer (§3.10); `smell_descriptor`=`sweet_or_maple_syrup` + slimy + under radiator → `green_orange_yellow_or_pink_puddle_coolant` |
| **Front-glass fog (HVAC) vs rear-defogger grid (electrical, but binned in fog subcat)** | "Is it the **front windshield fogging up**, or the **lines on the back glass** not clearing?" | `accessory_affected`=`rear defroster` → still `foggy_or_hard_to_defog_windows` (§3.12); front persistent fog → same subcat, HVAC path (§3.11) |
| **Defog vs heat-doesn't-work** | "Is your main problem **fog/visibility on the glass**, or that the **cabin won't get warm**?" | `hvac_mode`=`defrost` + fog-led → `foggy_or_hard_to_defog_windows`; temperature-led → `heat_doesnt_work` |
| **Interior fog vs outside rain (wipers)** | "Is the moisture on the **inside** of the glass (won't wipe off), or **outside** (rain the wipers should clear)?" | inside/greasy film → `foggy_or_hard_to_defog_windows`; outside rain + wiper complaint → `windshield_inop_testing`. **No current slot captures inside-vs-outside glass surface** → §9 slot gap |
| **Defog-fog vs heater-core (sweet film)** | "When it fogs, is there a **sweet smell** or a **greasy film** you can't wipe off?" | `smell_descriptor`=`sweet_or_maple_syrup` → `sweet_smell_maple_syrup_antifreeze` / heater core; plain fog → `foggy_or_hard_to_defog_windows` |
| **Brake-light BULB vs red BRAKE dash light** | "Is a **bulb** at the back of the car out, or is a **red BRAKE warning light** on your dashboard?" | bulb → `accessory_affected`='brake light', `electrical_testing_general`; dash telltale → `warning_light_named`='brake' → `brake_inspection_warning_light` |

---

## 6. Warning lights & DTC surface

This system is mostly **telltale-free** — a burned-out headlight or a dead washer pump throws no dash
light on most US vehicles. The exceptions the classifier should know:

- **Bulb-out / "check lamp" telltale** (common on Euro & some domestic): a little lamp-with-an-
  exclamation icon. Customer nicknames: "light bulb symbol," "the little lamp light," "bulb warning."
  → `warning_light_named` = "bulb out"/"lamp". Still routes to the *lighting* fixture path, not a
  dedicated warning-light service.
- **Battery / CHARGE light co-occurring with dim/flicker** — belongs to `starting-charging` /
  `battery_charging_light`; its *presence* is the discriminator that says "this dim is charging, not a
  bulb." `warning_light_named` = "battery"/"charge".
- **Turn-signal hyperflash** is a *behavior* (fast blink), not a dash light — captured via
  `accessory_affected`='turn signal' + the customer's "flashes fast" wording, not `warning_light_*`.
  Fast blink is the bulb-out response of **electronic** flasher modules (they sense the reduced load);
  classic **thermal** flashers slow down or stop instead, so treat "flashes fast" as a bulb-out cue only
  on electronic-flasher vehicles (§3.2, cited).

No customer-facing DTCs are central here; body-electrical B-codes exist but are shop-scan-only and never
appear in customer voice. Feeds `warning_light_named` values: "bulb out", "lamp".

---

## 7. Confusable neighbors (cross-system)

- **`starting-charging`** — **co-owns `dim_or_flickering_lights`.** Division of labor: they own the
  charging *mechanism* (alternator ripple, regulator, diode, belt, battery cable) and the dim-then-died
  no-restart; this dossier owns the *lighting-fixture* side (single bulb out, localized ground/wiring
  dim, exterior lamp functions) and provides the "is this even charging?" first cut. Their §9 note asks
  that `dim_or_flickering_lights` q540 keep `required_facts=[lights_state]` — this dossier **agrees and
  does not alter q540** (no conflict). Discriminator: `lights_state=dim_at_idle_brighten_when_revving`
  or a battery light present → charging; one dead lamp or bump-sensitive dim → fixture/wiring.
- **`cooling-system`** — blue/green coolant vs blue washer fluid (§5); heater-core sweet-film fog
  (§3.13). Discriminator: soapy-watery-off-side (washer) vs sweet-slimy-under-radiator (coolant).
- **hvac / `cooling-system`** — defog vs heat-doesn't-work vs weak-airflow. Discriminator: fog/
  visibility-led (`hvac_mode=defrost`) vs temperature-led vs `airflow_state=weak_overall`.
- **`brakes-friction-hydraulic`** — the word **"brake light"**: a rear brake *bulb* (mine) vs the red
  BRAKE dash *telltale* (theirs). Highest-risk lexical collision in this dossier.
- **`router-warning-lights`** — owns every dash telltale; this dossier hands off anything that is a dash
  icon rather than a physical lamp/glass complaint.
- **`electrical_testing_general` general electrical** — a *single* dead accessory that is NOT a
  lamp/wiper/washer (radio, power lock, seat heater) is `accessory_doesnt_work` proper; this dossier
  only claims the *lighting/wiper/washer/defog* slice of that catch-all.
- **`accessory_doesnt_work` ↔ `windshield_inop_testing` (live-DB collision — must counter-weight).**
  The live `accessory_doesnt_work` enrichment ALREADY carries the synonym "wipers don't work" and the
  positive "Rear windshield wiper doesn't move," which pull WIPER complaints into the electrical
  accessory bucket — directly against this dossier's `windshield_inop_testing` routing for wiper
  operation. The fix (§8, §proposals): a `negative_example` on `accessory_doesnt_work` routing "my
  wipers don't move" → `windshield_inop_testing`, plus a description clause excluding wipers. Without
  it, Stage-2 keeps mis-binding wipers to electrical.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Testing service | Category | Subcategory slug | Fit |
|---|---|---|---|---|
| 3.1 single bulb out | electrical_testing_general | electrical | `accessory_doesnt_work` | **weak** — subcat's examples/synonyms are windows/radio/locks, not exterior lamps → proposal |
| 3.2 turn-signal intermittent | electrical_testing_general | electrical | `accessory_doesnt_work` | weak (same) |
| 3.3 dim/flicker RPM-linked | charging_starting_testing / electrical_testing_general | electrical | `dim_or_flickering_lights` | good |
| 3.4 dim/flicker not RPM | electrical_testing_general | electrical | `dim_or_flickering_lights` | good |
| 3.5 dim then died | charging_starting_testing | electrical | `car_died_while_driving_electrical` | good (route away from dim subcat) |
| 3.6 wipers won't move | windshield_inop_testing | (service-level, no subcat) | — (stage2 null) | good |
| 3.7 wipers slow/stall | windshield_inop_testing | — | — (stage2 null) | good |
| 3.8 wiper grind/squeak/streak | windshield_inop_testing | — | — (stage2 null) | good |
| 3.9 washers won't spray | windshield_inop_testing | — | — (stage2 null) | good |
| 3.10 washer-fluid leak | **coolant_leak_testing** (its `concern_categories` include `leak`) | leak | `blue_or_light_blue_puddle_washer_fluid` | good — NB `windshield_inop_testing`'s categories are [electrical, other] and CANNOT reach the leak pool; the leak subcat is reachable via coolant_leak_testing (see golden case #8) |
| 3.11 windshield fog | ac_performance_check | hvac | `foggy_or_hard_to_defog_windows` | good |
| 3.12 rear defogger grid | ac_performance_check | hvac | `foggy_or_hard_to_defog_windows` | good (per DB description) |
| 3.13 sweet-film fog (heater core) | coolant_leak_testing / ac_performance_check | smell/hvac | `sweet_smell_maple_syrup_antifreeze` / `foggy_or_hard_to_defog_windows` | good (smell-led vs fog-led) |
| 3.14 lamp stuck ON (drain) | electrical_testing_general | electrical | `accessory_doesnt_work` (or `multiple_random_electrical_glitches` if multi-symptom) | weak → same proposal as 3.1 |
| 3.15 cloudy/oxidized lens | — (optical restoration) | (none) | NO FIT → advisor/`router-requests-maintenance` | negative for dim (§5/§7) |
| 3.16 both headlights out | electrical_testing_general | electrical | `accessory_doesnt_work` (or `exterior_light_out` if proposed) | weak → same proposal as 3.1 |
| 3.17 wipers won't turn off/park | windshield_inop_testing | (service-level, no subcat) | — (stage2 null) | good |
| "replace my bulb/wipers" request | — | (none) | NO FIT → null-route/advisor | see proposal |

**NO-FIT / weak-fit → proposals:**
1. **Exterior-lighting-out has only a weak home** (`accessory_doesnt_work`, whose enrichment is
   windows/radio/locks). **Demand evidence (honest recount of the 500-line corpus):** 4 genuine
   exterior-lamp CONCERN lines — a headlight, a tail light, a turn signal, and one terse "left plate
   lamp" — all consensus-routed to `electrical_testing_general`/`accessory_doesnt_work`, PLUS 3
   declined/work-order lamp lines ("REPLACE DRIVERS SIDE LOW BEAM", "Remove & Replace Fog Lamp Bulb",
   "REPLACE THE RIGHT FRONT TURN SIGNAL"). It is a recurring but *modest* fix family (bulb/socket/ground
   vs an interior circuit); license-plate coverage is thin (one line). → **`stage2.subcategory.propose`
   `exterior_light_out`** (Chris-gated — a judgment call, not a slam-dunk) AND, as the interim,
   **enrich `accessory_doesnt_work`** with exterior-lamp positives/synonyms so today's routing improves
   immediately.
2. **"Replace my wipers / bulb" pure requests** = maintenance/parts, no diagnostic testing → null-route
   (`customer_request_type`=`replace_specific_part`). Covered by `router-requests-maintenance`; this
   dossier contributes the null-route golden cases.

---

## 9. Fact-slot audit

**Slots this system uses (with corpus-attested values):**
- `lights_state` — `dim_or_flickering`, `dim_at_idle_brighten_when_revving` ("brighten when I rev"),
  `completely_dead`. **The RPM value is the single most important discriminator here** and already
  exists — no new slot needed.
- `accessory_affected` (free-text) — "wipers", "washers", "rear defroster", and (proposed literal_cues)
  "driver headlight", "left taillight", "turn signal", "brake light", "fog light", "license plate
  light", "dome light".
- `warning_light_named` — "battery"/"charge" (charging co-occurrence), "bulb out"/"lamp".
- `fluid_color` = `blue_or_light_blue`; `fluid_under_car_location` = `under_engine_front`.
- `weather_condition` = `rainy_or_wet`, `cold_weather`, `humid`, `after_snow_or_ice` (defog + frozen
  washer lines).
- `hvac_mode` = `defrost`; `airflow_state` = `no_airflow`/`weak_overall` (defrost-vent airflow).
- `noise_descriptor` = `grinding_metallic`, `creaking_or_squeaking` (wiper drag).
- `recent_action` = `car_wash_or_driven_through_water` (wipers/washers dead after wash), plus the
  `accessory_doesnt_work` history question (fender bender / stereo install / spilled drink).
- `smell_descriptor` = `sweet_or_maple_syrup` (heater-core film), soapy/chemical (washer — no enum
  value; captured in prose, not a slot).
- `onset_timing` = `intermittent` — the turn-signal "works sometimes / random" cue (§3.2). **NB:
  `intermittent` is an `onset_timing` value, NOT a `started_when` value** (extracted-facts.ts:
  `started_when` = just_now/today/days_ago/weeks_ago/months_ago/a_year_plus/since_purchase/sudden_onset/
  gradually). Don't put "intermittent" in `started_when`.
- `started_when` (duration/onset descriptors above), `location_side`, `drivable_state`, `engine_running`,
  `customer_request_type` — as above.

**Missing values / slot gaps:**
- **Inside-vs-outside glass surface has NO slot.** It's the crisp discriminator for defog (inside fog)
  vs wipers (outside rain) vs greasy film (inside, heater core). Candidate `glass_surface_side`
  {inside, outside, both}. **Verdict: does NOT meet the ≥3-question rule** as its own slot today (it
  informs at most the fog-vs-wiper boundary, and the existing questionnaires resolve it in prose) →
  **backlog note, not a slot proposal.**
- **Washer fluid's soapy/chemical smell** has no `smell_descriptor` enum value (the enum is failure-
  smells: coolant/oil/fuel/etc.). Adding "soapy_or_chemical" would help only the washer-vs-coolant
  boundary (1 pair) → **not worth an enum value; the `fluid_color`+location+texture cues already
  resolve it.** Backlog note.
- **Exterior-lamp position** is fully expressible via `accessory_affected` free-text — a structured
  enum would duplicate it. **No new slot.**

Net: **zero new fact slots proposed** — this system is well-covered by the existing 29, and its power
comes from *tagging the right existing slots on the over-asking questions* (§proposals) rather than new
ontology.

---

## 10. Sources

Diagnostic (tiered; access date 2026-07-18):
- Firestone Complete Auto Care, "7 Signs of a Bad Alternator" — Tier 3 (shop blog), used only as one of
  two independent corroborations for the fundamental RPM-linked-dim claim.
  https://www.firestonecompleteautocare.com/blog/maintenance/signs-of-a-bad-alternator/
- FCP Euro, "The Bosch Alternator — How It Works" — Tier 3 (technical explainer), second corroboration.
  https://blog.fcpeuro.com/the-bosch-alternator-how-it-works
- CarParts.com, "Alternator Voltage Regulation 101" — Tier 3, lamp-load/voltage context.
  https://www.carparts.com/blog/alternator-voltage-regulation-101-with-wiring-diagrams/
- Frost Fighter, "Technical Bulletin 118 — Measuring Defroster Health" — Tier 2 (manufacturer technical
  document) for the rear-defogger resistive-grid / Joule-heating claim.
  https://frostfighter.com/wp-content/uploads/2017/10/Tech_118_Measuring_Defroster_Health_Ver2a.pdf
- Defrost-mode A/C dehumidification (§2, §3.11) — the mechanism (cold evaporator condenses cabin
  humidity → dry air clears the glass) is refrigeration **psychrometrics, Tier-1-equivalent physics**
  (self-supporting); corroborated by **MACS (Mobile Air Conditioning Society)** defrost-mode guidance,
  Tier 2 (HVAC trade authority), and independently by the live DB `foggy_or_hard_to_defog_windows`
  description. (Replaces the earlier Car Talk / HVAC-Talk cite — neither is on the Tier-3 allowlist.)
- Wiper/washer subsystem symptom→cause map (§2, §3.6–3.9, §3.17 park switch) — Erjavec, *Automotive
  Technology* (body-electrical wiper/washer chapter), Tier 2 (standard textbook; not quoted);
  corroborated by AA1Car, "Windshield Wiper System / blade replacement & diagnosis," Tier 3, accessed
  2026-07-18, https://www.aa1car.com/library/replace_windshield_wiper_blades.htm. (Replaces the earlier
  unURLed "Gates/Dorman" cite — Gates makes belts/hoses, not wiper systems.)
- Turn-signal hyperflash mechanism (§3.2, §6) — electronic-flasher bulb-out behavior (fast blink) vs
  thermal-flasher (slows/stops): J.W. Speaker, "How to Fix Hyper Flashing with LED Lights," Tier 3,
  accessed 2026-07-18, https://www.jwspeaker.com/blog/education-center/how-to-fix-hyper-flashing-with-led-lights/;
  Super Bright LEDs, "LED Turn Signals Blinking Too Fast (Hyperflashing)," Tier 3, accessed 2026-07-18,
  https://www.superbrightleds.com/blog/led-turn-signals-blinking-too-fast-hyperflashing.html (two independent Tier-3).
- Halderman, *Automotive Electricity & Electronics* — Tier 2, cited for ground/shared-circuit &
  voltage-drop behavior of lamps (§2, §3.4, §3.16) and parasitic draw from a stuck-on lamp (§3.14)
  (standard textbook; not quoted).
- Oxidized/hazy headlight-lens light scatter (§3.15) — degraded-polycarbonate optical scatter, Tier-1-
  equivalent physics; framed as a cleaning/restoration item, not an electrical fault.
- Joule heating (P = I²R) for the defogger grid — Tier 1 physics.

Linguistic (provenance, not diagnosis; labels used: `tekmetric` = verbatim corpus line, `tekmetric-paraphrase`
= customer-voice paraphrase of a corpus line, `eval` = authored eval case, `forum-paraphrase`, `db-positive`
= live-DB positive_example, `synthetic`):
- Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json` (consensus labels cited inline).
- `eval-cases.json` authored cases (`windshield_inop_testing-001..004`, `ac_performance_check-007`,
  `charging_starting_testing-005`) — used as GOLDEN targets / labeled `eval` in the lexicon; **never
  injected into live enrichment** (train-on-test hygiene).
- `real-concerns-forums.json` (2carpros flicker threads — paraphrased).
- Live DB enrichment for the 4 bound subcategories (queried 2026-07-18, shop 7476) — its positive_examples
  are labeled `db-positive`, not `tekmetric`.

---

## 11. Binding-readiness self-check (Gate-G2)

| Check | Status |
|---|---|
| Every failure mode (§3) has a source cite of the right tier | ✅ (Tier 2/3 corroborated; no fabricated paywalled cites) |
| Every customer artifact (§4/lexicon) is corpus-first, synthetic flagged & ≤~30% | ✅ — measured per POSITIVE pool after the trim: `accessory_doesnt_work` positives ~20% synthetic (1 of 5: brake-bulb confusable), `dim_or_flickering_lights` ~25% (1 of 4: RPM cue). Cross-system NEGATIVE probes are synthesized by design and excluded from the positive-voice cap. Proposals-file positive.adds are 20% synthetic (1 of 5). |
| Every negative_example op names `routes_to` | ✅ (washer-spray → `windshield_inop_testing`; wiper-collision → `windshield_inop_testing`; oxidized lens → advisor bucket) |
| Every synonym is ≥2 tokens or a domain token | ✅ (no bare "light/leak/fog"; cause-diagnosis phrasings replaced with symptom voice — §14 fixes) |
| Fact cues are literal (no inference) | ✅ — inference-trap #1 guards §3.5 (dim-then-died); inference-trap #2 (golden #9) now sets `fluid_color=blue_or_light_blue` (LITERAL "bright blue") and lets STAGE 2 carry coolant routing from slimy+sweet+under-radiator, not a counter-literal fluid_color |
| Every §8 NO-FIT terminates in a proposal | ✅ (exterior_light_out subcat + null-route) |
| Slot proposals meet the ≥3-question rule | ✅ (zero proposed; gaps logged as backlog with rationale) |
| Confusable pairs from taxonomy §5 covered | ✅ (dim bulb-vs-alternator #, defog HVAC-vs-electrical #; plus brake-bulb-vs-dash, washer-leak-vs-spray, blue-washer-vs-coolant) |
| ≥8 golden cases incl. ≥1 inference-trap + ≥1 null-route | ✅ (13 cases; 2 inference-traps, 2 null-routes). Stage-1 keys all valid service_keys — dim golden cases route stage1 to `charging_starting_testing` (per eval precedent -005), NOT the `dim_or_flickering_lights` subcategory |
| Binding validity (stage1 keys, slot enums, service→category reachability) | ✅ — `started_when` vs `onset_timing` corrected (intermittent = onset_timing); washer-leak binds `coolant_leak_testing` (windshield_inop can't reach the leak pool); `binds_services` header lists all 5 reached services |
| Coordinated with neighbor dossier (no duplication) | ✅ (`starting-charging` co-ownership documented; q540 untouched; `accessory_doesnt_work`↔`windshield_inop_testing` wiper collision counter-weighted §7) |
