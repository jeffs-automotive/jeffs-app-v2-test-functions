# Wheels, tires, TPMS & wheel bearings — diagnostic dossier
slug: wheels-tires-tpms-bearings   date: 2026-07-18   binds_services: [tire_repair, tpms_testing, suspension_steering_check]   binds_categories: [tires, warning_light, vibration, noise]

> **TWO STRUCTURAL GAPS THIS DOSSIER TARGETS.**
> **(1) All three bound services have EMPTY `example_keywords[]`** (`tire_repair` = null,
> `tpms_testing` = `[]`, `suspension_steering_check` = `[]` — verified live 2026-07-18). Stage-1 has
> *zero* lexical hooks for "nail in my tire", "TPMS light", "wheel bearing hum", or "shimmy at
> highway speed" — the single highest-leverage fix here is populating L1 keywords.
> **(2) THE TIRE-BUYING GAP.** `just_want_new_tires` and `dry_rot_sidewall_cracking` (and worn-out
> `uneven_tire_wear_bald_spots` when the answer is replacement) have **NO bookable service fit** — a
> punctured tire gets `tire_repair` ($47.68), but a customer who needs *new* tires has no test/fee
> path and falls through to an advisor quote with no structured flow. This is a catalog gap, flagged
> Chris-gated in §8.
> Stage-2 enrichment is otherwise **strong and fully populated** (rich descriptions/positives/
> negatives/synonyms) — this dossier SHARPENS (real-voice positives, confusable-pair negatives,
> missing domain synonyms). On L5 it AUDITS the `required_facts[]` gaps (esp. `humming_or_whirring_at_speed`,
> where **all 7 questions have empty `required_facts`**) and **reconciles with the same-day Workstream-Q
> triage maps** (`binding/required-facts-map.q2.md`/`q3.md`): under the presence-only mapper every
> candidate tag here is a wrongful-skip risk, so this dossier emits **zero `required_facts.set`** and
> instead documents each ID `intentionally_empty` + proposes the `steering_load_effect` slot (which
> genuinely unlocks Q86/Q1480/Q114).

---

## 1. Scope & boundaries

**In scope** — the road wheel, the tire on it, the pressure-monitoring electronics, and the hub
bearing that carries the wheel:

- **Tires** — puncture/nail/screw, slow leak / going-flat, sidewall bulge/cut/gash, **dry rot /
  sidewall cracking (age)**, uneven/bald tread wear, **the tire-buying request** (new-tire shopping),
  and post-tire-work comeback symptoms.
- **TPMS (Tire Pressure Monitoring System)** — the amber low-pressure telltale, direct sensors
  (in-wheel), sensor relearn after service, dead-sensor faults.
- **Wheel balance & runout** — the highway-speed steering-wheel shimmy (imbalance / bent wheel / flat-
  spotted tire) and the constant all-speed tremor (out-of-round tire/wheel).
- **Wheel / hub bearings** — the speed-tracking hum/growl/roar that rises with road speed and changes
  with steering load. (Shared surface with the driveline dossier — see §7.)

**OUT of scope** (neighbor dossier owns it):

| Out-of-scope symptom | Why it's not this system | Owning neighbor |
|---|---|---|
| Pull/drift on a flat straight road, uneven wear caused by **alignment** (as the fix), clunk over bumps | Suspension/steering geometry & chassis | `steering-power-steering` / suspension (`pulling/*`, `clunking_over_bumps`) |
| Vibration/shudder **only when accelerating / under load** | Inner CV / tripod, driveline | `driveline-cv-diff-awd` (`shaking_when_speeding_up_or_going_uphill`) |
| CV **click only when turning** at low speed | Constant-velocity halfshaft | `driveline-cv-diff-awd` (`popping_or_clicking_when_turning`) |
| Diff/pinion **whine that changes with throttle** | Final drive gears | `driveline-cv-diff-awd` (`humming_or_whirring_at_speed`, load modifier) |
| Steering-wheel shake **only when braking** | Brake rotor thickness variation | `brakes` (`vibration_or_pulsing_when_braking`, `pulsating_or_vibrating_pedal`) |
| TPMS light co-illuminated as one of **many** dash lights after an impact | Multi-system / ABS/wheel-speed | `abs-traction-stability` / `after_a_recent_accident_or_impact` |

Boundary rule of thumb: **this system's symptoms track the ROLLING WHEEL** — air in it, the tread/
sidewall of it, its balance/roundness, or the bearing it spins on. Symptoms that track STEERING
GEOMETRY (pull, alignment wear as the fix), TORQUE (accel-only shudder, turn-only click), or the BRAKE
PEDAL belong to neighbors.

---

## 2. System primer (expert, CITED)

**The tire.** A modern passenger/LT tire is a rubber-over-steel-and-fabric pressure vessel: bead
(seals to the wheel), sidewall (flexes, carries the DOT date code), and tread over steel belts. It is
the air, not the rubber, that carries the load — correct **cold** inflation pressure (the placard in
the driver's door jamb) is what keeps the casing cool and the contact patch correct
[USTMA tire-care & maintenance guidance, Tier 2, accessed 2026-07-18; Halderman, *Automotive Chassis
Systems* (tire/wheel), Tier 2, accessed 2026-07-18].

- **Puncture vs. non-repairable damage.** A tread-area puncture up to 1/4 in (6 mm) can be repaired
  with a combination patch-plug from **inside** the tire; punctures in the **sidewall or shoulder**,
  cuts/gashes, bulges (broken internal cords from an impact), and overlapping/large holes are
  **NOT repairable** — the sidewall flexes continuously and tears any repair apart
  [USTMA *Puncture Repair Procedures for Passenger and Light Truck Tires*, Tier 2, accessed
  2026-07-18]. This is why `tire_repair` explicitly excludes sidewall damage and worn/aged tires.
- **Tire aging / dry rot.** Rubber oxidizes and loses plasticizers with time and UV/ozone exposure —
  independent of tread depth. Early evidence is fine parallel "crazing" cracks on the sidewall; deeper
  cracks (roughly >1/16 in) into the casing mean replacement. **Vehicle and tire manufacturers** commonly
  advise removing tires from service by **6–10 years** from the DOT date regardless of remaining tread
  (USTMA itself declines to set a fixed service-life number; the 6–10-yr window is the manufacturer
  guidance NHTSA summarizes in its tire-aging discussion); cars that **sit unused** and cars parked
  outdoors in sun age fastest [NHTSA tire-aging consumer guidance (URL below), Tier 1; USTMA tire-care &
  aging guidance (ustires.org), Tier 2; accessed 2026-07-18]. Dry rot is **never** a `tire_repair` job —
  it is a replacement (tire-buying) event.
- **Uneven wear** is a *readout* of another system: inside/outside-edge wear ⇒ toe/camber alignment;
  center wear ⇒ chronic over-inflation; both-edges ⇒ under-inflation; cupping/scalloping ⇒ worn
  shocks/struts or imbalance [Halderman chassis, Tier 2; Michelin/Bridgestone tire-care technical
  info, Tier 2, accessed 2026-07-18]. The tire is the evidence; the fix lives in alignment/suspension
  or replacement.

**TPMS.** Since model-year 2008 all US light vehicles carry TPMS under **FMVSS No. 138**, which
requires the dashboard low-pressure telltale to illuminate within 20 minutes when one or more tires is
**25% or more below the placard cold pressure** (or a specified floor, whichever is higher)
[NHTSA/49 CFR 571.138 (FMVSS 138), Tier 1, accessed 2026-07-18]. Two architectures:
**direct** (a battery-powered pressure sensor in each wheel, transmitting to the body module — the
common case; sensor batteries last ~5–10 years and then the light comes on as a *system fault*) and
**indirect** (infers a low tire from wheel-speed differences via the ABS sensors; must be reset after
inflation) [NHTSA FMVSS 138 preamble, Tier 1; Schrader/Continental TPMS technical training, Tier 2,
accessed 2026-07-18]. **Telltale behavior is diagnostic:** *steady on* = a tire is genuinely low
(cold-weather drop of ~1 PSI per 10 °F is the #1 seasonal cause); *flash ~60–90 s then steady* = a
TPMS **system** fault (dead/missing sensor, e.g. after a rotation without relearn), not a live
pressure problem [Schrader/Bartec TPMS training, Tier 2, accessed 2026-07-18]. `tpms_testing` ($39.99)
scans sensors and pressures; it is NOT a tire-repair.

**Wheel balance & runout.** A wheel/tire assembly spun at highway speed amplifies any static/dynamic
**imbalance** or **radial runout** (bent wheel, flat-spotted or out-of-round tire, a thrown balance
weight) into a periodic force felt as a **steering-wheel shimmy in a narrow speed band** (~55–70 mph).
The shimmy is **speed-dependent** (it appears in that band and eases above/below it), not
duration-dependent. An **out-of-round** tire or a broken belt instead produces a
tremor that is present at **all** speeds and does not narrow to a band [Hunter Engineering
balancing/road-force technical training, Tier 2, accessed 2026-07-18; Halderman chassis, Tier 2].
Distinguish from **brake** pulsation, which appears only under pedal application (rotor thickness
variation).

**Wheel / hub bearing.** The hub bearing carries the wheel's radial and cornering loads. As it wears
(pitting, brinelling, loss of preload, water intrusion) it produces a **hum / growl / roar that rises
with ROAD speed** (not engine RPM), typically becoming audible around **30–40 mph**, and — the
signature test — **changes with steering load**: it gets louder when weight shifts *onto* the bad
bearing in a corner. Because cornering loads the *outer* wheel, a hum that grows when turning **left**
usually indicts the **right** bearing and vice-versa [Timken *Symptoms of a Worn Wheel Hub Bearing*,
Tier 2, accessed 2026-07-18; SKF/NSK wheel-bearing diagnosis training, Tier 2, accessed 2026-07-18].
A badly failed bearing can develop play (wheel wobble) or seize.

**US-market calibration (from the corpus vehicle mix):** trucks, crossovers, Subarus, and
economy/commuter FWD cars. Weight the lexicon toward slow leaks, cold-snap TPMS lights, highway
balance shimmy, and the "sounds like snow tires / airplane taking off" bearing hum — all of which
appear verbatim in the Tekmetric corpus.

---

## 3. Failure-mode catalog (the diagnostic spine — CITED per mode)

### 3.1 Tread-area puncture (nail / screw / object) — repairable
- **Sensory signature:** `tire_state = visible_damage`; a nail/screw head visible in the tread, or a
  slow hiss + repeated topping-up traced to an object.
- **Conditions:** `onset_timing` n/a; may be `drivable_normally` (holding air) or
  `not_drivable_needs_tow` (flat); `started_when` often `today`/`days_ago`.
- **Severity / drivability:** repairable if in the tread crown and <1/4 in; drive gently or tow if flat.
- **Typical misattribution:** customers lead with the *air loss* ("keeps going flat") and don't
  mention the object → lands in `tire_going_flat_losing_air`; OR they see the **TPMS light** first and
  call it a TPMS problem → mis-routes to `tpms_testing` (the eval corpus literally does this, case
  `tpms_testing-001`). A *named* nail/screw/bulge/cut should win to `tire_repair`.
- **Source:** USTMA puncture-repair procedures, Tier 2 [accessed 2026-07-18].

### 3.2 Slow leak / tire going flat, no visible cause named
- **Sensory signature:** `tire_state = low_pressure`/`flat`; "have to add air every week", "flat this
  morning, fine yesterday".
- **Conditions:** `started_when` `gradually` (valve-stem/bead seep) or `sudden_onset`; the customer
  frames **air loss**, names no object.
- **Severity:** `drivable_but_concerned`; a sudden flat = `not_drivable_needs_tow`.
- **Misattribution:** may be a hidden tread puncture (→ still `tire_repair` work) or a corroded valve
  stem / bad TPMS sensor seal; customer can't see it, so it stays here not in `visible_damage`.
- **Source:** USTMA puncture-repair procedures, Tier 2 [accessed 2026-07-18]; Halderman chassis, Tier 2.

### 3.3 Sidewall bulge / cut / gash — NON-repairable damage
- **Sensory signature:** `tire_state = visible_damage`; a **bubble/bulge** on the sidewall (impact-
  broken cords) or a cut/slash.
- **Conditions:** frequently after `recent_action = hit_pothole_or_curb`.
- **Severity:** replacement, not repair — a bulge can blow out; `drivable_but_concerned` at best.
- **Misattribution:** customers call a bulge a "bubble" or "blister" and expect a patch; it is a
  replacement. Routes to `visible_damage_nail_screw_bulge_cut` (classification), but the *work* is a
  tire sale, not a plug — a facet of the tire-buying gap (§8).
- **Source:** USTMA (sidewall non-repairable), Tier 2 [accessed 2026-07-18].

### 3.4 Dry rot / sidewall cracking (age & UV) — replacement
- **Sensory signature:** `tire_state = sidewall_cracking`; fine hairline "crazing" cracks, chalky/
  brittle rubber, on the sidewall and sometimes tread grooves.
- **Conditions:** age (6–10 yr), sun/ozone exposure, and cars that **sit** (`recent_action =
  car_sat_unused`); often on **all** tires at once.
- **Severity:** deep cracks = unsafe → replace. No repair path.
- **Misattribution:** framed as a long-storage problem (`car_has_been_sitting_unused_for_a_long_time`)
  — when the customer NAMES the cracking, it stays `dry_rot_sidewall_cracking`. THE TIRE-BUYING GAP: no
  bookable service (§8).
- **Source:** USTMA tire-aging guidance, Tier 2 [accessed 2026-07-18].

### 3.5 Uneven / bald tread wear
- **Sensory signature:** `tire_state = uneven_wear`; inside-edge, outside-edge, center, or cupped/
  scalloped patterns; often flagged by a prior shop.
- **Conditions:** alignment out of spec (edge wear), chronic mis-inflation (center/both-edge), missed
  rotations, worn struts (cupping).
- **Severity:** the *tire* may need replacement AND the *cause* (alignment/suspension) needs
  correction — a two-part answer that crosses into `suspension_steering_check` / the tire-buying gap.
- **Misattribution:** customer may lead with a downstream symptom (shimmy, pull) and mention wear only
  as evidence → route to the symptom; or say "I just need new tires" → `just_want_new_tires`.
- **Source:** Halderman chassis (wear-pattern diagnosis), Tier 2; Michelin/Bridgestone tire-care, Tier
  2 [accessed 2026-07-18].

### 3.6 Tire-buying request (no diagnostic complaint) — THE GAP
- **Sensory signature:** none — buying language dominates ("quote for 4 new tires", "want to put new
  tires on", "TIRE REPLACEMENT"). `customer_request_type = just_get_new_tires`.
- **Conditions:** n/a (a sales request, not a symptom).
- **Severity:** n/a.
- **Misattribution:** if the customer ALSO names a symptom (low, dry rot, wear), the *symptom*
  subcategory wins; pure buying → `just_want_new_tires`. No bookable service today → advisor.
- **Source:** none (non-diagnostic); demand evidence is linguistic (§8).

### 3.7 TPMS light — pressure-genuine (steady)
- **Sensory signature:** `warning_light_named = "TPMS"`; `warning_light_behavior = steady_on`; amber
  horseshoe-with-exclamation.
- **Conditions:** cold-snap pressure drop (`weather_condition = cold_weather`, ~1 PSI/10 °F), a real
  slow leak, or a tire that needs topping. FMVSS 138 trips at 25% below placard.
- **Severity:** `drivable_but_concerned`.
- **Misattribution:** customer treats it as "a light problem" when a tire is genuinely low; or adds air
  and the light stays (needs a drive cycle / relearn) → `low_pressure_warning_light_only`.
- **Source:** NHTSA FMVSS 138, Tier 1; Schrader/Continental TPMS training, Tier 2 [accessed 2026-07-18].

### 3.8 TPMS light — system fault (flash-then-steady / won't clear)
- **Sensory signature:** `warning_light_behavior = flashing_or_blinking` for ~60–90 s **then**
  `steady_on`, OR steady-on that **won't clear after inflating** — a dead/missing sensor (post-rotation
  no-relearn, dead sensor battery).
- **Conditions:** often `recent_action = tire_rotation_or_replacement` or `tire_air_added`; sensors are
  ~5–10 yr life.
- **Severity:** `drivable_normally` (electronics, not a flat).
- **Misattribution:** read as "still low" when tires are fine ("added air, light won't go off, tires
  look fine").
- **Source:** Schrader/Bartec TPMS training, Tier 2 [accessed 2026-07-18]; FMVSS 138 malfunction-
  telltale requirement, Tier 1.

### 3.9 Wheel imbalance / bent wheel / flat-spot → highway shimmy
- **Sensory signature:** steering-wheel **shimmy/shake felt through the hands** in a **narrow band**
  (~55–70 mph) that eases above/below the band (speed-dependent, not duration-dependent);
  `speed_band = highway`/`specific_mph`.
- **Conditions:** after `recent_action = tire_rotation_or_replacement` (thrown/forgotten weight) or
  `hit_pothole_or_curb` (bent wheel), or a tire flat-spotted from sitting.
- **Severity:** `drivable_but_concerned`.
- **Misattribution:** blamed on the brakes ("shakes at highway speed" — but it is NOT brake-triggered);
  the corpus even files it under "CHECK BRAKES" (tkc-290). If it only shakes *when braking*, it is
  brakes, not this.
- **Source:** Hunter balancing/road-force training, Tier 2; Halderman chassis, Tier 2 [accessed
  2026-07-18].

### 3.10 Out-of-round tire / broken belt → constant all-speed tremor
- **Sensory signature:** steady vibration/hum at **every** speed that does NOT narrow to a band or
  change with brake/accelerate; `speed_band = all_speeds`; felt through floor/seat.
- **Conditions:** a broken tire belt, a badly out-of-round tire, or a flat-spotted tire; sometimes a
  seized/dragging component.
- **Severity:** `drivable_but_concerned`.
- **Misattribution:** conflated with balance shimmy (which is band-limited) — the discriminator is
  band vs. all-speeds.
- **Source:** Halderman chassis, Tier 2; Hunter road-force, Tier 2 [accessed 2026-07-18].

### 3.11 Wheel / hub bearing hum
- **Sensory signature:** `noise_descriptor = humming_or_whirring`/`roaring`; steady **hum rising with
  ROAD speed** from ~30–40 mph, that **changes with steering load** (louder cornering one way).
- **Conditions:** `speed_band` tracks road speed, not engine RPM; often nameable side (louder-turning-
  which-way). Water/off-road use accelerates it.
- **Severity:** `drivable_but_concerned`; a seizing bearing → severe, can develop wheel play.
- **Misattribution:** "sounds like snow/aggressive tires", "airplane taking off", "wheel bearings
  needed" (told by another shop, `second_opinion`); confused with tire road-roar (constant, no steering-
  load change) and with diff whine (throttle-dependent, see driveline dossier).
- **Source:** Timken *Symptoms of a Worn Wheel Hub Bearing*, Tier 2; SKF wheel-bearing training, Tier 2
  [accessed 2026-07-18].

### 3.12 Post-tire-work comeback (non-pull)
- **Sensory signature:** a NEW non-pull symptom right after tire work — vibration, a noise, a TPMS
  light that won't clear, the patched tire going flat again, **or a wheel that feels loose/wobbly** (a
  clunking or shimmy that worsens, "the wheel feels wobbly after the tire shop"). `recent_action =
  tire_rotation_or_replacement`.
- **Conditions:** framing trigger is the recent tire work; symptom is vibration/noise/TPMS/leak/**loose
  wheel** (a PULL after tire work routes to `pull_that_started_after_recent_tire_or_service_work`, not here).
- **Severity:** varies — **the loose/improperly-torqued lug-nut (loose-wheel) case is safety-weighted:
  under-torqued or over-torqued/missed lugs can let the wheel shift or, worst case, separate → treat as
  `drivable_but_concerned` trending to `not_drivable_needs_tow`.** Distinct from a balance/TPMS/leak
  comeback (which are not immediate separation risks).
- **Misattribution:** overlaps balance-shimmy, TPMS-fault, and leak modes; a wobble is often read as a
  "bad balance job" when it is actually loose lug nuts. The *recent tire work* framing is what pins it to
  `recent_tire_work_then_new_symptom`.
- **Source:** Halderman chassis (wheel installation / lug torque, loose-wheel consequences), Tier 2;
  Hunter balancing training, Tier 2; Schrader TPMS relearn, Tier 2 [accessed 2026-07-18];
  existing subcategory description.

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Source order: Tekmetric corpus (labeled) → NHTSA/USTMA-paraphrase → synthetic (flagged, ≤30%). Full
machine list in `wheels-tires-tpms-bearings.lexicon.yaml`. Representative rows:

| Phrase (customer voice) | Target subcategory | Ambiguity | Provenance |
|---|---|---|---|
| "Lf tire slow leak" | tire_going_flat_losing_air | unambiguous (work-order voice) | tekmetric (tkc-010) |
| "LEFT REAR TIRE LOOSING AIR PSI" | tire_going_flat_losing_air | unambiguous | tekmetric (tka-056) |
| "Front left tire needs looses air pressure. Need to add air about every 1000 miles" | tire_going_flat_losing_air | unambiguous (location literally stated) | tekmetric (tkc-217) |
| "found a screw sticking out of my rear left tire, still holds air, drives fine" | visible_damage_nail_screw_bulge_cut | unambiguous | eval (tpms_testing-001) |
| "bubble on the sidewall after I smacked a curb" | visible_damage_nail_screw_bulge_cut | unambiguous (non-repairable) | forum-paraphrase |
| "TPMS LIGHT ON (Testing auth)" | tpms_tire_pressure_light | unambiguous | tekmetric (tkc-018) |
| "TPMS LIGHT COMES ON & OFF" | tpms_tire_pressure_light | needs-fact:warning_light_behavior | tekmetric (tka-088) |
| "Tire Pressure Monitor warning light on even after checking tire pressure" | tpms_tire_pressure_light | unambiguous (system fault) | tekmetric (tkc-137) |
| "TPMS light will flash then go solid, seems to come on going over bumps" | tpms_tire_pressure_light | needs-fact:warning_light_behavior | tekmetric (tka-021) |
| "put air in all 4 tires yesterday but the light still won't go off, tires look fine" | low_pressure_warning_light_only | unambiguous (relearn/fault) | eval (tpms_testing-003) |
| "Front Driver-side tire pressure sensor not reading/offline. No low tire pressure observed" | tpms_tire_pressure_light | unambiguous (sensor fault) | tekmetric (tkc-076) |
| "quote replacing 4 tpms sensors" | (null-route / work-order) | null-route (replace-intent work-order line) | tekmetric (tkc-263) |
| "SHIMMY AT HIGHWAY SPEEDS" | steering_wheel_shake_at_highway_speed | unambiguous | tekmetric (tkc-052) |
| "WHEEL SHAKES AT HIGHWAY SPEEDS" | steering_wheel_shake_at_highway_speed | unambiguous | tekmetric (tka-196) |
| "CHECK BRAKES (Steering wheel shakes at highway speeds)" | steering_wheel_shake_at_highway_speed | cross-system:brakes (customer guessed brakes) | tekmetric (tkc-290) |
| "VEHICLE SHAKING AT ALL SPEEDS ( like a 2000lbs vibrator )" | constant_vibration_that_doesnt_change_with_speed | unambiguous | tekmetric (tkc-032) |
| "Very noticeable humming from the rear end, most noticeable 30 to 40 mph, sounds like aggressive/snow tires" | humming_or_whirring_at_speed | needs-fact:steering_load_effect (bearing-vs-roar; axle already stated) | tekmetric (tkc-113) |
| "Tires making a strange noise when driving" | humming_or_whirring_at_speed | needs-fact:noise_descriptor | tekmetric (tkc-081) |
| "ROTATIONAL NOISE HEARD IN LEFT REAR" | humming_or_whirring_at_speed | unambiguous | tekmetric (tka-149) |
| "dealership said wheel bearings were needed, wants second opinion" | humming_or_whirring_at_speed | needs-fact:customer_request_type | tekmetric (tkc-102) |
| "humming that gets louder curving left, quieter curving right" | humming_or_whirring_at_speed | unambiguous (bearing) | forum-paraphrase |
| "uneven wear on inside edge of front tires" | uneven_tire_wear_bald_spots | unambiguous | tekmetric (tkc-278) |
| "rear tires were worn on edges" | uneven_tire_wear_bald_spots | unambiguous | tekmetric (tkc-239) |
| "sidewalls are all cracked, tires are old and dry-rotted" | dry_rot_sidewall_cracking | unambiguous (→ tire-buying gap) | synthetic |
| "4 NEW TIRES AND ALIGNMENT (would like entry level tire)" | just_want_new_tires | unambiguous (→ tire-buying gap) | tekmetric (tkc-138) |
| "TIRE REPLACEMENT" | just_want_new_tires | unambiguous (work-order voice) | tekmetric (tka-125) |
| "CLIENT REPORTED REAR END SWAYING AFTER TIRE REPLACEMENT" | recent_tire_work_then_new_symptom | needs-fact:speed_band | tekmetric (tka-057) |
| "Tire Rotation & Balance" | (null-route / maintenance) | null-route | tekmetric (tkc-060) |
| "ROTATE IF NEEDED" | (null-route / maintenance) | null-route | tekmetric (tka-026) |

Messiness observed & preserved: all-caps work-order voice ("TIRE REPLACEMENT", "ROTATE IF NEEDED"),
misspellings ("LOOSING AIR", "looses air"), shorthand ("Lf tire", "R/R tire"), customer-guessed
misattribution ("CHECK BRAKES" for a balance shimmy), diagnosis-echo ("dealership said wheel
bearings"), and vagueness ("tires making a strange noise").

---

## 5. Differential & discriminating questions (binds required_facts + slots)

For each confusable pair, the ONE best discriminator + the fact slot/value that resolves it:

| Pair | Discriminating question | Slot + value that answers it |
|---|---|---|
| **Physical tire damage** (tire_repair) vs **TPMS-light-only** (tpms_testing) | "Do you SEE something wrong with the tire — a nail, a bulge, or it's low — or is your only clue the dashboard light?" | `tire_state` = visible_damage/flat/low_pressure → tire_repair; `warning_light_named=TPMS` with `tire_state=normal_or_unknown` → tpms_testing. |
| **Named object** (visible_damage) vs **air-loss only** (tire_going_flat) | "Can you see a nail, screw, bulge, or cut, or is it just losing air with nothing visible?" | `tire_state`: `visible_damage` vs `low_pressure`/`flat`. Visible object always wins. |
| **TPMS steady** (real low) vs **TPMS flash/won't-clear** (system fault) | "Is the light steady, or does it flash for about a minute then go solid — and did adding air clear it?" | `warning_light_behavior`: `steady_on` (+ low tire) vs `flashing_or_blinking`-then-steady / stays after `recent_action=tire_air_added` (fault). |
| **Balance shimmy** (highway band) vs **brake pulsation** | "Does it shake at a steady highway speed with your foot OFF the brake, or only when you press the brake?" | `onset_timing=when_braking` → brakes; `speed_band=highway`/`specific_mph` with no brake → balance. |
| **Balance shimmy** (narrow band) vs **out-of-round constant tremor** | "Does the shake come in around one speed and ease off above/below it, or is it there the whole time at every speed?" | `speed_band`: `highway`/`specific_mph` (band) vs `all_speeds` (constant). |
| **Wheel-bearing hum** vs **tire road-roar** | "Does the hum get louder turning ONE way and quieter the other, or stay the same no matter how you steer?" | **Gap:** no slot for steering-load sensitivity → **propose `steering_load_effect`** (§9). Bearing = changes with steering load; tire roar = constant + `tire_state=uneven_wear`. |
| **Wheel-bearing hum** vs **diff whine** (driveline) | "Does the sound track how FAST you're going, or does it change when you get ON the gas vs COAST?" | `noise_descriptor=humming_or_whirring` + pure speed-tracking → bearing; throttle-load change → driveline diff (cross-ref driveline dossier). |
| **Wheel-bearing hum** vs **engine-bay whine** | "Does it change with how fast the WHEELS turn (road speed) or with engine RPM (revving in neutral)?" | Road-speed → bearing (`humming_or_whirring`); RPM-linked → `high_pitched_whining_under_the_hood`. |
| **Uneven wear as a symptom** vs **tire-buying request** | "Are you asking us to figure out WHY a tire is wearing, or do you just want a price on new tires?" | `customer_request_type`: symptom framing → `uneven_tire_wear_bald_spots`; `just_get_new_tires` → `just_want_new_tires`. |
| **Post-tire-work vibration** vs **new balance issue** | "Did this start right AFTER recent tire work, or has it been there without any recent service?" | `recent_action=tire_rotation_or_replacement` present → `recent_tire_work_then_new_symptom`; absent → the plain symptom subcat. |
| **Bearing/imbalance side** | "Which wheel does it seem to come from — or which way do you turn to make it louder?" | `location_side`/`location_axle`; steering-load side is inverse of the bad bearing (Timken) — needs `steering_load_effect` (§9). |

---

## 6. Warning lights & DTC surface

| Light / message | Customer names it | Solid vs flashing | Feeds |
|---|---|---|---|
| **TPMS low-pressure telltale** (amber horseshoe + "!") | "the horseshoe light", "exclamation-point tire thing", "low tire light", "tire pressure light" | **steady** = a tire is ≥25% low (FMVSS 138); **flash ~60–90 s then steady** = TPMS system fault (dead/missing sensor) | `warning_light_named=TPMS`, `warning_light_behavior=steady_on`/`flashing_or_blinking` |
| TPMS after a rotation/replacement | "light won't go off since I got tires" | steady, won't clear after inflating | `warning_light_behavior`, `recent_action=tire_rotation_or_replacement` |
| Co-illuminated with ABS/traction after an impact (e.g. tkc-027: wheel wobble + ABS + traction + brake blinking) | "a bunch of lights came on" | multiple | `warning_light_behavior=multiple_lights_at_once` → routes to `after_a_recent_accident_or_impact` / abs, NOT tpms alone |

DTCs are largely on the TPMS module (C-codes for individual sensor IDs / "no signal"); the customer
never states these — they state the telltale. `warning_light_named` is free-text; the canonical value
here is `"TPMS"` (also "tire pressure").

---

## 7. Confusable neighbors (cross-system)

1. **Brakes (`vibration_or_pulsing_when_braking`, `pulsating_or_vibrating_pedal`)** — brake pulsation
   is pedal/brake-triggered; balance shimmy is speed-triggered with the foot off the brake.
   Discriminator: `onset_timing=when_braking`. The corpus mis-files balance shimmy under "CHECK BRAKES"
   (tkc-290) — Stage-1 must hedge. Cross-ref: `brakes-friction-hydraulic` dossier (owns the pair from
   the brake side; this dossier reinforces from the vibration side).
2. **Driveline (`driveline-cv-diff-awd`)** — **wheel-bearing hum is a SHARED surface**: both this
   dossier and the driveline dossier map hub-bearing hum to `humming_or_whirring_at_speed`. Split from
   diff whine (throttle-load-dependent) and CV click (turn-only, low speed). The bearing itself is
   physically a wheel/hub component (this dossier's §3.11); the driveline dossier reaches it as the
   end of the torque path. **Coordination is asymmetric, not "one coordinated proposal":** the driveline
   dossier (§9 item 3) BACKLOGS steering-load sensitivity as `<3 questions` (it counts only Q86); THIS
   dossier OWNS and PROPOSES the `steering_load_effect` slot (§9), clearing the ≥3-question rule on its
   own three witnesses (Q86, Q1480, Q114 — none of them the driveline's). The driveline dossier should
   reference this slug rather than re-propose.
3. **Suspension / steering (`pulling/*`, `clunking_over_bumps`, `uneven_tire_wear` cause)** — uneven
   wear is *evidence* whose fix is alignment/suspension; a pull after tire work routes to
   `pull_that_started_after_recent_tire_or_service_work`. Discriminator: is the customer's framing the
   tire (here) or the pull/geometry (suspension)? Cross-ref: `steering-power-steering` dossier.
4. **After-impact / accident (`after_a_recent_accident_or_impact`)** — a wheel wobble + multiple dash
   lights after hitting something is a situational override, not a plain TPMS/tire case (tkc-027).
   `recent_action=accident_or_impact` + `warning_light_behavior=multiple_lights_at_once` wins.
5. **ABS / traction / stability (`abs-traction-stability`)** — a **far-gone wheel bearing commonly lights
   the ABS/traction telltale**: the wheel-speed sensor is hub-integrated and reads a tone ring pressed
   onto/into the bearing, so excessive bearing play or a damaged tone ring corrupts the wheel-speed
   signal → an ABS/traction code. The customer's presentation is a **"hum + ABS light"** pair — the hum
   is this dossier's bearing mode (§3.11), the sensor/tone-ring side is owned by the
   `abs-traction-stability` dossier (its §3 pothole/tone-ring mode). Discriminator: a speed-rising,
   steering-load-sensitive hum PRESENT with a lone ABS/traction light points at the bearing (route the
   noise here, cross-check ABS there); a lone light with no hum is the sensor/wiring (theirs). Distinct
   from the after-impact MULTI-light case in item 4. [Timken/SKF hub-bearing-with-integrated-sensor
   diagnosis, Tier 2, accessed 2026-07-18.]

This dossier OWNS the confusable-matrix rows: *tire_repair vs tpms_testing vs suspension_steering_check*
(the required triple), *balance shimmy vs constant tremor*, and *bearing hum vs tire roar* (see
proposals `stage1.hedge.add` + negatives).

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode (§3) | Current testing service | Current category | Current subcategory slug | Fit |
|---|---|---|---|---|
| 3.1 Tread puncture (repairable) | `tire_repair` | tires | `visible_damage_nail_screw_bulge_cut` | **good** (but Stage-1 keyword-blind) |
| 3.2 Slow leak / going flat | `tire_repair` | tires | `tire_going_flat_losing_air` | **good** |
| 3.3 Sidewall bulge/cut (non-repairable) | `tire_repair` (classify) → advisor (replace) | tires | `visible_damage_nail_screw_bulge_cut` | **weak** — classifies right, but the WORK is a tire sale, no service fits |
| 3.4 Dry rot / sidewall cracking | — (no test) | tires | `dry_rot_sidewall_cracking` | **NO FIT** (tire-buying gap) |
| 3.5 Uneven / bald wear | `suspension_steering_check` (cause) / advisor (replace) | tires | `uneven_tire_wear_bald_spots` | **weak** — cause fits suspension, tire itself has no bookable path |
| 3.6 Tire-buying request | — (no test) | tires | `just_want_new_tires` | **NO FIT** (tire-buying gap) |
| 3.7 TPMS steady (real low) | `tpms_testing` | warning_light / tires | `tpms_tire_pressure_light` / `low_pressure_warning_light_only` | **good** |
| 3.8 TPMS system fault | `tpms_testing` | warning_light / tires | `tpms_tire_pressure_light` / `low_pressure_warning_light_only` | **good** |
| 3.9 Balance shimmy (highway band) | `suspension_steering_check` | vibration | `steering_wheel_shake_at_highway_speed` | **good** (Stage-1 keyword-blind) |
| 3.10 Out-of-round constant tremor | `suspension_steering_check` | vibration | `constant_vibration_that_doesnt_change_with_speed` | **good** |
| 3.11 Wheel-bearing hum | `suspension_steering_check` | noise | `humming_or_whirring_at_speed` | **good** (all 7 questions L5-empty) |
| 3.12 Post-tire-work comeback | `suspension_steering_check` / `tpms_testing` | tires | `recent_tire_work_then_new_symptom` | **good** |

**NO-FIT → proposals (demand evidence from corpus):**

- **THE TIRE-BUYING GAP → `catalog.service.propose` (Chris-gated).** `dry_rot_sidewall_cracking`,
  `just_want_new_tires`, non-repairable bulges/cuts (§3.3), and worn-out tires (§3.5) have **no
  bookable service** — `tire_repair` explicitly excludes them, `tpms_testing` is a sensor scan. Demand
  is real and recurring in the corpus: tkc-138 ("4 NEW TIRES AND ALIGNMENT"), tka-125 ("TIRE
  REPLACEMENT"), tka-169 ("TIRE REPLACE IF NEEDED CHECK CONDITION OF REMAINING"), tka-112 ("CHECK
  CONDITION OF WINTER TIRES … MOUNT AND BALANCE"), tkc-159 (tire protection plan). Proposal: a
  **`tire_sales_consultation`** advisor route (gather size/driving-style/budget → tire quote; no
  diagnostic fee), so `just_want_new_tires` + `dry_rot_sidewall_cracking` route to a *structured tire-
  quote flow* instead of a bare advisor hand-off. **Chris-gated** (pricing/flow is a business decision).
- **`stage1.keyword.add` for all three empty services** — the single highest-leverage routing fix;
  see proposals L1.

**No new subcategory proposed.** The `tires` category (7 subcats) already covers every tire failure
mode cleanly; the gap is *service/routing + Stage-1 keywords*, not a missing symptom bucket.

**Description note (not a revise op):** the live `tpms_tire_pressure_light` description references a
sibling slug `tires/visible_low_or_flat_tire` that does **not exist** in the active taxonomy (the real
siblings are `visible_damage_nail_screw_bulge_cut` and `tire_going_flat_losing_air`). Flagged for Chris
as a copy-edit; NOT auto-revised here to avoid Stage-2 regression (the reference-dossier discipline —
descriptions are otherwise strong and left untouched).

---

## 9. Fact-slot audit

**Slots this system uses (of the 29):** `tire_state`, `warning_light_named`, `warning_light_behavior`,
`speed_band`, `speed_specific_mph`, `noise_descriptor`, `location_side`, `location_axle`,
`onset_timing`, `started_when`, `recent_action`, `pull_direction`, `weather_condition`,
`drivable_state`, `customer_request_type`, `sound_or_smoke_location_zone`.

**Values customers actually state (corpus evidence):**
- `tire_state`: `low_pressure` ("LOOSING AIR PSI", tka-056), `visible_damage` ("screw sticking out",
  eval), `sidewall_cracking` (dry rot), `uneven_wear` ("inside edge", tkc-278), `flat`.
- `warning_light_named`: free-text `"TPMS"` / `"tire pressure"` (tkc-018, tka-088, tkc-137).
- `warning_light_behavior`: `steady_on`, `flashing_or_blinking` ("flash then solid", tka-021),
  `comes_and_goes` ("COMES ON & OFF", tka-088).
- `speed_band`: `highway`/`specific_mph` ("at highway speeds", "30 to 40 mph"), `all_speeds` ("SHAKING
  AT ALL SPEEDS", tkc-032).
- `noise_descriptor`: `humming_or_whirring`/`roaring` ("humming", "rotational noise", "snow tires").
- `recent_action`: `tire_rotation_or_replacement` (tka-057), `tire_air_added` (eval), `car_sat_unused`
  (dry rot), `hit_pothole_or_curb` (bulge/bent wheel).
- `customer_request_type`: `just_get_new_tires` (tkc-138, tka-125), `second_opinion` ("wants second
  opinion", tkc-102).

**Missing values / proposed slots:**
1. **New slot `steering_load_effect`** (`stage3.slot.propose`) — values
   `[louder_turning_left, louder_turning_right, no_change_with_steering, unsure]`. This is THE
   wheel-bearing discriminator (hum changes with cornering load; the *opposite* side to the louder-turn
   is the bad bearing — Timken) and separates a bearing hum from constant tire road-roar. **≥3-question
   rule met on THREE genuine, distinct questions within THIS dossier's scope** (no double-counting, no
   dependence on the driveline dossier):
   - `humming_or_whirring_at_speed` **Q86** — "does the noise change when you turn left versus right?" (map q2 line 49, NO-SLOT)
   - `constant_vibration_that_doesnt_change_with_speed` **Q1480** — "does the vibration change when you turn the wheel?" (map q3 line 111, NEVER/NO-SLOT)
   - `popping_or_clicking_when_turning` **Q114** — "louder one direction?" (map q2 line 67, NO-SLOT) — a turn-direction-loudness question the same slot answers.
   All three currently carry empty `required_facts`. **Coordination note:** the driveline dossier (§9 item
   3) BACKLOGS this dimension as `<3` (it saw only Q86); this proposal supersedes that backlog by supplying
   Q1480 + Q114 as the additional witnesses. It is **one slot, owned here** — land it unconditionally; the
   driveline dossier should reference the slug, not re-propose.
2. **No new `tire_state` values needed** — the enum (`low_pressure`, `flat`, `visible_damage`,
   `sidewall_cracking`, `uneven_wear`, `normal_or_unknown`) already covers every §3 tire mode.
3. **`customer_request_type=just_get_new_tires` already exists** — the tire-buying *fact* is captured;
   the gap is the *service/route* (§8), not a slot.
4. **Backlog (no slot, <3 questions):** *location-of-wear on the tire* (inside/outside/center/patchy —
   `uneven_tire_wear` Q730) — richer than `tire_state=uneven_wear` but only one question needs it;
   logged, not forced. *Tire-age in years* (dry_rot Q739) — no slot, single question; logged.

**Spanish-language phrasings:** none mined here; logged as a backlog note for Chris per style guide
(do not improvise).

---

## 10. Sources

Diagnostic/differential claims (Tier per source-policy; each with the specific document + URL/domain +
access date; accessed 2026-07-18):
- **NHTSA / 49 CFR 571.138 — FMVSS No. 138 (TPMS):** 25%-below-placard illumination threshold, 20-min
  requirement, MY2008 phase-in, direct vs. indirect systems, malfunction (flash-then-steady) telltale.
  **Tier 1.** URL: https://www.law.cornell.edu/cfr/text/49/571.138 (LII mirror of the FMVSS-138 final rule).
- **NHTSA — consumer tire information / tire-aging guidance** (the 6–10-year manufacturer replacement
  window, DOT date code, storage/UV aging). **Tier 1.** URL: https://www.nhtsa.gov/equipment/tires
  (and the NHTSA "Tire Safety: Everything Rides on It" consumer brochure).
- **USTMA (U.S. Tire Manufacturers Association)** — *Puncture Repair Procedures for Passenger and Light
  Truck Tires* (tread-crown only, ≤1/4 in / 6 mm, sidewall & shoulder non-repairable, combination
  patch-plug from inside) + USTMA tire-care/aging consumer guidance. **Tier 2.** URLs:
  https://www.ustires.org/tire-repair-do-it-right and https://www.ustires.org/tire-care-safety .
- **Halderman, *Automotive Chassis Systems* (Pearson)** — tire construction & DOT date code (ch. Tires
  & Wheels), wear-pattern diagnosis (edge/center/cupping table), wheel balance & radial/lateral runout,
  hub-bearing load/wear, wheel installation & lug-nut torque (loose-wheel consequence). **Tier 2.**
- **Hunter Engineering — Road Force® balancing / GSP9700 operation & technical training materials**
  (band-limited imbalance/runout shimmy vs. constant out-of-round road-force). **Tier 2.** Domain:
  hunter.com (GSP9700 / Road Force Measurement product & training literature).
- **Timken — *Symptoms of a Worn Wheel Hub Bearing*** (road-speed-rising hum, steering-load sensitivity,
  the opposite-side-to-the-louder-turn rule, integrated wheel-speed-sensor/tone-ring → ABS light).
  **Tier 2.** Domain: timken.com (Timken automotive knowledge/tech tips).
- **SKF Vehicle Aftermarket — wheel-hub-bearing failure-mode & diagnosis guidance** (noise onset ~30–40
  mph, play, water-intrusion/brinelling; hub units with integrated ABS sensor). **Tier 2.** Domain:
  vehicleaftermarket.skf.com.
- **Bartec USA + Schrader (Sensata) — TPMS relearn / sensor technical guidance** (direct vs. indirect,
  ~5–10-yr sensor-battery life, post-rotation relearn, dead/missing-sensor flash-then-steady fault).
  **Tier 2.** Domains: bartecusa.com, schradertpms.com. (Malfunction-telltale semantics anchored to
  FMVSS 138, Tier 1, above.)
- **Michelin & Bridgestone — consumer tire-care technical info** (cold-inflation placard, wear causes,
  aging/cracking). **Tier 2.** Domains: michelinman.com/tire-care, bridgestonetire.com/tire-care-maintenance.

Linguistic (never cited for diagnosis): Tekmetric corpus
`real-concerns-tekmetric-labeled-v2.json` (tkc-010, tkc-018, tkc-032, tkc-052, tkc-060, tkc-075/076,
tkc-081, tkc-102, tkc-113, tkc-137, tkc-138, tkc-217, tkc-239, tkc-263, tkc-278, tkc-290, tka-021,
tka-026, tka-056, tka-057, tka-088, tka-112, tka-125, tka-149, tka-169, tka-196) +
`eval-cases.json` (`tpms_testing-001…004`, `suspension_steering_check-001/006`, `nearmiss-012`); NHTSA
ODI narrative patterns (tire / TPMS component) paraphrased to first person; 2carpros / community
phrasing **patterns** (paraphrased, `forum-paraphrase`, never verbatim — copyright).

---

## 11. Binding-readiness self-check (Gate-G2)

| Check | Status |
|---|---|
| Every §3 failure mode cites Tier 1/2 (Tier 3 only paired) | PASS |
| Sensory signatures written in fact-slot vocabulary | PASS |
| Lexicon phrasings in customer voice, synthetic ≤30% & flagged | PASS (synthetic ~28% — now correctly counts the 7 eval-suite/DB-authored fixtures previously mislabeled `tekmetric`; under the 30% cap; real Tekmetric ~58%, forum-paraphrase ~14%) |
| Every negative_example names `routes_to` | PASS (see proposals) |
| Synonyms ≥2 tokens or domain single-token | PASS (e.g. "wheel bearing hum", "TPMS light", "slow leak", "shimmy") |
| Literalness: fact cues literally stated (no object/side/rotor inference) | PASS (see §5 + golden inference-trap; ambiguity tags corrected where location was literally stated) |
| Required confusable triple (tire_repair vs tpms_testing vs suspension_steering_check) owned + discriminators | PASS |
| Tire-buying gap addressed with demand evidence | PASS (catalog proposal, Chris-gated; golden cases route empty-Stage-1 → advisor_handoff with a latent_subcategory annotation) |
| Empty-`example_keywords` on all 3 services attacked | PASS (L1 keyword ops; dropped the shop-voice "patch and plug") |
| L5 required_facts gaps reconciled with Workstream-Q maps (q2/q3), no wrongful-skip tags | PASS (0 `required_facts.set`; all deferred to `intentionally_empty` with map cites) |
| Slot proposal meets ≥3-question rule (own witnesses) | PASS (`steering_load_effect` on Q86 + Q1480 + Q114; driveline backlog superseded, not counted) |
| ≥8 golden cases incl. ≥1 inference-trap + ≥1 null-route | PASS (13 cases; routes use the harness enum testing_service/advisor_handoff/null_match) |
| Catalog/service change → Chris-gated proposal only | PASS |
