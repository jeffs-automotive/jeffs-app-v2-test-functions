# Manual transmission & clutch — diagnostic dossier
slug: manual-trans-clutch   date: 2026-07-18   binds_services: [transmission_testing]   binds_categories: [performance, noise, vibration, leak]

> **Headline finding.** This system is the single largest *catalog-coverage gap* the taxonomy has for
> a drivetrain the corpus demonstrably sees (verbatim: "CLIENT STATES CLUTCH IS SLIPPING"). A manual
> transmission is served by exactly ONE service (`transmission_testing`, which has **zero**
> `example_keywords`) and its signature failures — clutch slip, engagement chatter, gear grind,
> hard/notchy shift, **three distinct pedal-position-dependent bearing noises** (release / pilot /
> input-shaft), jumps-out-of-gear, pedal-to-floor actuation loss, dual-mass-flywheel rattle, gearbox
> **and** hydraulic-clutch fluid leaks, and shifter-linkage slop — have **no dedicated Stage-2
> subcategory and no Stage-3 slot**. Every *actionable* finding below terminates in a typed op that
> closes part of that gap; the one non-actionable surface (§6 warning lights) is explicitly logged as a
> no-op backlog with its rationale. Diagnostic claims are Tier-2 (ASE study-guide + parts-maker training)
> with Tier-3 corroboration; customer voice is mined from the Tekmetric + forum corpus.

---

## 1. Scope & boundaries

**In scope** — the manual (H-pattern / stick-shift) driveline between engine and axles, driver-operated:
- **Clutch assembly:** friction disc, pressure plate (cover), flywheel friction face (incl. **dual-mass
  flywheel**), torsional damper springs. Failure modes: slip, chatter/judder on engagement, oil
  contamination, DMF rattle.
- **Clutch actuation:** pedal, cable OR hydraulic (master/slave cylinder, line), release ("throwout")
  bearing, release fork. Failure modes: won't disengage (drag), pedal-to-floor, no pressure, high/low bite,
  **hydraulic-fluid (brake-fluid) leak**.
- **Release, pilot, and input-shaft bearings** — the three clutch-pedal-position-dependent bearing noises.
- **Manual gearbox internals a customer can *feel*:** synchronizers, shift forks/rails, gear engagement,
  **external shift linkage/bushings**. Failure modes: grind on shift, hard/notchy shift, jumps/pops out of
  gear, linkage slop.
- **Manual gearbox gear-oil leak** (case seams, seals) as a *leak* symptom.

**Out of scope** (owned elsewhere):
- Automatic / CVT / DCT shift quality, torque-converter slip, "delayed engagement", solenoid/valve-body
  → the automatic side of `transmission_testing`; NVH crossover owned by `router-nvh`.
- Wheel-bearing / CV-axle / driveshaft NVH → `suspension-steering` + `router-nvh` (discriminator in §7).
- **Transfer-case / 4WD range engagement** (4-Hi/4-Lo/2-Hi) and range-dependent "slip" → `awd_4x4_testing`
  (neighbor; discriminator in §7). This dossier owns clutch slip only when it is **range-independent**.
- Differential / transfer-case gear oil & AWD engagement → `driveline-awd` (neighbor); this dossier owns
  only the **manual gearbox's own** gear-oil leak.
- Clutch **burning smell** as a smell-primary complaint → shares with `router-smoke-smells`
  (`burnt_oil` / `burning_rubber_or_hot_brakes` / `other_burning`); this dossier owns it only when slip is stated.
- Engine-side "no power / bucking" that is NOT drivetrain (misfire, fuel, limp mode) → `engine-drivability`.

---

## 2. System primer (expert, cited)

A manual driveline transmits engine torque through a **dry friction clutch** the driver modulates with a
pedal. With the pedal **up (released)**, the pressure-plate diaphragm spring clamps the friction disc
against the flywheel, locking crankshaft to gearbox input shaft. Pressing the pedal moves the **release
(throwout) bearing** against the diaphragm fingers, unclamping the disc so the input shaft can stop
relative to the engine and gears can be selected [freeasestudyguides.com/diagnose-clutch-noise.html, Tier 2,
accessed 2026-07-18]. A **pilot bearing/bushing** in the crank center supports the input-shaft nose and
lets it spin independently of the crank *while the clutch is disengaged*
[freeasestudyguides.com/diagnose-clutch-noise.html, Tier 2; onallcylinders.com Quick Guide, Tier 3,
accessed 2026-07-18]. The gearbox **input-shaft bearing** carries the input shaft inside the case and is
loaded whenever the shaft turns — i.e. in **neutral with the pedal up and the engine running**
[freeasestudyguides.com/diagnose-clutch-noise.html, Tier 2; aa1car.com/library/2004/ic20428.htm, Tier 3,
accessed 2026-07-18].

Gear selection uses **synchronizers** (blocker rings) that speed-match the next gear to the shaft before
the dog teeth engage; worn synchros or a clutch that won't fully release make the box grind or resist
[freeasestudyguides.com/hard-shifting-problems.html, Tier 2, accessed 2026-07-18]. **External shift
linkage** (cables/rods + bushings) transmits lever motion to the shift rails; worn/mis-adjusted linkage
raises shift effort and can let the box jump out of gear [onallcylinders.com Quick Guide, Tier 3;
aa1car.com, Tier 3, accessed 2026-07-18].

**Notable US-market variants** (calibrate depth to the corpus, which is majority automatic):
- **Actuation:** cable-operated (self-adjusting or manual free-play) vs **hydraulic** (master + slave/
  concentric slave cylinder). Hydraulic systems typically run **DOT brake fluid**, so a hydraulic-clutch
  leak reads on the ground as brake fluid (clear-to-light-brown) [knowyourparts.com "Clutch Failure",
  Tier 2, accessed 2026-07-18]. Hydraulic failures produce a *pedal-to-floor / no-pressure* complaint that
  cable systems present differently; both live under the same customer-facing subcat proposal (§8).
- **Self-adjusting vs fixed free-play** clutches — free-play loss is a common "won't fully release" root
  cause [freeasestudyguides.com/hard-shifting-problems.html, Tier 2, accessed 2026-07-18].
- **Single-mass vs dual-mass flywheel (DMF).** Modern higher-torque manuals use a DMF (two masses + arc
  springs) to damp driveline rattle; a worn DMF **rattles/raps at idle and knocks under load**, and can
  destroy a freshly installed clutch [Schaeffler/LuK DMF service info (vehiclelifetimesolutions.schaeffler.com,
  LuK-PL-0104-en), Tier 2; aa1car.com, Tier 3, accessed 2026-07-18].
- **Gearbox lubricant** varies (heavy hypoid gear oil vs ATF-spec fluid) — matters for the leak color cue
  in §8/§9 (thick-dark vs red).

---

## 3. Failure-mode catalog (the diagnostic spine, cited per mode)

### FM-1 — Clutch slip
- **Sensory signature:** engine RPM rises but road speed does not follow ("revs but no go"); worst under
  load — hills, hard acceleration, higher gears; often a **burnt friction / burning smell**.
  Slot vocab: `onset_timing = when_accelerating`; a *proposed* `clutch_or_gear_engagement =
  revs_without_speed_gain` (§9). NOTE — set `speed_band` **only** if the customer names a speed (highway =
  50+ mph); "on a hill" / "under load" states LOAD, not a speed band, and must not set `speed_band`.
  `smell_descriptor` = `burnt_oil` / `burning_rubber_or_hot_brakes` when the customer names a brake/rubber-like
  burn, else `other_burning` for a vague "burning" (literalness).
- **Conditions/modifiers:** load-dependent; worsens gradually (`started_when = gradually`); accelerated by
  **oil contamination** of the disc — a contaminated clutch must have the source leak sealed or the new
  disc re-glazes/re-slips [knowyourparts.com "Clutch Failure", Tier 2; freeasestudyguides.com/diagnose-clutch-noise.html,
  Tier 2, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned` → `not_drivable_needs_tow` in severe slip.
- **Misattribution:** customers call it "transmission slipping" / "trans is going out" (they don't
  separate clutch from gearbox); also confused with engine "low power". Actually clutch friction, not
  gearbox or engine [onallcylinders.com Quick Guide, Tier 3; freeasestudyguides.com/diagnose-clutch-noise.html,
  Tier 2, accessed 2026-07-18].

### FM-2 — Clutch chatter / judder on engagement
- **Sensory signature:** rapid shudder/vibration felt **just as the pedal is released and the clutch first
  begins to engage**, pulling away from a stop, then gone once fully engaged
  [freeasestudyguides.com/diagnose-clutch-noise.html, Tier 2, accessed 2026-07-18]. Slot vocab: a *proposed*
  `onset_timing = from_a_stop_pulling_away` (§9); felt "through the floor and seat".
- **Conditions/modifiers:** causes include glazed or oil-contaminated disc facings and misaligned engine/
  transmission mounts (which also damage the disc's torsion springs)
  [freeasestudyguides.com/diagnose-clutch-noise.html, Tier 2, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** called "shakes when I take off", easily confused with a **motor mount** or **CV
  axle** shudder — the discriminator is that chatter is *engagement-phase only*, not throttle-load at
  speed (§7).

### FM-3 — Clutch won't fully disengage (clutch drag)
- **Sensory signature:** **grinding when shifting into gear**, hard to select gears (especially 1st and
  reverse from a stop), or won't go into gear at all with the engine running — but shifts fine with the
  engine off. Slot vocab: proposed `clutch_or_gear_engagement = grinds_when_shifting / wont_go_into_gear`;
  `noise_descriptor = grinding_metallic`.
- **Conditions/modifiers:** lost pedal free-play [freeasestudyguides.com/hard-shifting-problems.html, Tier 2],
  a leaky/worn hydraulic master or slave cylinder or fluid that has leaked out (clutch won't release)
  [knowyourparts.com "Clutch Failure", Tier 2; us.haynes.com clutch troubleshooting, Tier 2], or a worn/dry
  pilot bearing dragging the disc [onallcylinders.com Quick Guide, Tier 3, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned` → `not_drivable` if it won't go into gear.
- **Misattribution:** "transmission grinds" (blamed on the gearbox; often a *clutch/actuation* problem).

### FM-4 — Synchronizer wear / hard-notchy shift
- **Sensory signature:** grind or resistance selecting a **specific gear first** (commonly 2nd, or 3rd),
  worse on **quick** shifts; notchy/balky feel. Slot vocab: proposed
  `clutch_or_gear_engagement = hard_or_notchy_shift`; `noise_descriptor = grinding_metallic`.
- **Conditions/modifiers:** worn synchro blocker-ring points / worn disc / lost free-play
  [freeasestudyguides.com/hard-shifting-problems.html, Tier 2, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** blamed on "needing a clutch"; may actually be gearbox-internal.

### FM-5 — Release (throwout) bearing noise
- **Sensory signature:** a **squeal/chirp that appears (or gets louder) as you PRESS the clutch pedal
  down** to the engagement point — where the release bearing first contacts the pressure-plate fingers —
  and is quiet with the pedal fully up [freeasestudyguides.com/diagnose-clutch-noise.html, Tier 2, accessed
  2026-07-18]. Slot vocab: `noise_descriptor = squealing_high_pitched`; the discriminator is
  *pedal-dependence* (noise ON depression), not currently a slot (§9 proposal).
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** mistaken for a **belt/serpentine squeal** (`high_pitched_whining_under_the_hood`) —
  discriminator: belt squeal tracks engine RPM regardless of the clutch pedal; throwout appears **when you
  press the pedal** (§7).

### FM-6 — Pilot bearing/bushing noise
- **Sensory signature:** **whirring/growling ONLY with the clutch pedal FULLY pressed and the trans in
  gear** (input-shaft nose spinning in a dry pilot) [freeasestudyguides.com/diagnose-clutch-noise.html,
  Tier 2; onallcylinders.com Quick Guide, Tier 3, accessed 2026-07-18]. Slot vocab:
  `noise_descriptor = humming_or_whirring`; pedal-dependence (noise only pedal-fully-down) the key cue.
- **Drivability:** `drivable_but_concerned`; a dry pilot can also cause drag (→ FM-3).
- **Misattribution:** confused with a **wheel bearing** hum (`humming_or_whirring_at_speed`) — but wheel
  bearing tracks **road speed** and is present in neutral coasting; pilot tracks the **clutch pedal** and
  is heard while stationary (§7).

### FM-7 — Input-shaft bearing noise (noise in neutral) — NEW
- **Sensory signature:** a **growl/whine/squeal present in NEUTRAL with the engine running and the clutch
  pedal UP, that goes AWAY the moment you press the clutch pedal in** (disengaging stops the input shaft).
  This is the exact inverse of FM-5/FM-6 pedal-dependence [freeasestudyguides.com/diagnose-clutch-noise.html,
  Tier 2, "if a transmission makes noise in neutral it is usually a worn input shaft bearing";
  aa1car.com/library/2004/ic20428.htm, Tier 3, "growling or grinding … when the clutch is engaged … input
  shaft bearing", accessed 2026-07-18]. Slot vocab: `noise_descriptor = humming_or_whirring` /
  `squealing_high_pitched`; the discriminator is *noise-with-pedal-up-in-neutral, gone on depression* (§9).
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** confused with FM-5 throwout (opposite pedal phase) and with a belt/engine noise; the
  neutral + pedal-up-then-quiet-on-press signature is unique.

### FM-8 — Jumps / pops out of gear
- **Sensory signature:** the shifter pops back to neutral on its own under power or over bumps.
  Slot vocab: proposed `clutch_or_gear_engagement = pops_out_of_gear`; `onset_timing = when_accelerating`
  / `over_bumps`.
- **Conditions/modifiers:** worn synchro sleeve splines / worn tapered gear teeth, weak detent spring,
  loose or worn shift fork/rails, a stiff shifter boot, engine/trans misalignment, broken input-shaft
  retainer, or bent/binding/loose shift linkage [onallcylinders.com Quick Guide, Tier 3; aa1car.com/library/2004/ic20428.htm,
  Tier 3 — two independent Tier-3, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned`.

### FM-9 — Clutch actuation loss (pedal-to-floor / no pressure / stuck)
- **Sensory signature:** clutch pedal goes soft, **sinks to the floor and stays**, or has no resistance;
  cannot get the car into gear. Slot vocab: proposed `clutch_pedal_feel = soft_or_no_pressure /
  stays_on_floor_wont_return` (§9).
- **Conditions/modifiers:** hydraulic clutch fluid loss / failed master or slave cylinder / leaking line
  (loss of hydraulic pressure) [knowyourparts.com "Clutch Failure", Tier 2; us.haynes.com clutch
  troubleshooting, Tier 2, accessed 2026-07-18]; or a broken/stretched cable on cable systems.
- **Drivability:** `not_drivable_needs_tow` / `stranded_now`.
- **Misattribution:** "clutch went out"; a customer may also call a **brake** pedal-to-floor the same way —
  literalness matters (do NOT set the brake `pedal_feel` slot on a stated *clutch* pedal; §9).

### FM-10 — Dual-mass-flywheel (DMF) rattle — NEW
- **Sensory signature:** a **rattle/rapping at idle** (car stationary, in neutral, foot off the clutch)
  and/or a **knock under load**, often described as a diesel-like clatter that comes and goes with the
  clutch; sometimes worst on start-up/shut-down. Slot vocab: `noise_descriptor = rattling`;
  `speed_band = idle` / `stopped`; `engine_running = running`.
- **Conditions/modifiers:** worn DMF arc springs / secondary-mass knock; the harmonic torsional
  oscillation the DMF exists to damp resurfaces as it wears; a worn DMF can also damage a new clutch
  [Schaeffler/LuK DMF service info (vehiclelifetimesolutions.schaeffler.com, LuK-PL-0104-en), Tier 2;
  aa1car.com/library/2004/ic20428.htm, Tier 3 ("dual mass flywheel … sounds like transmission noise at
  idle"), accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** mistaken for an engine `engine_ticking_or_tapping` / rod knock, or generic
  "transmission noise at idle"; the clutch-/idle-linked rattle that changes when the pedal is pressed is
  the cue.

### FM-11 — Manual gearbox gear-oil leak
- **Sensory signature:** thick, dark, sticky oil under the **middle** of the car; heavy sulfur/rotten-egg
  smell if hypoid gear oil (some manuals use ATF-spec, which reads red). Slot vocab:
  `fluid_color = thick_dark_brown` (or `red_or_pink` for ATF-spec boxes);
  `fluid_under_car_location = under_middle`; `smell_descriptor = rotten_egg_or_sulfur`.
- **Conditions/modifiers:** failed case gaskets/seals, wrong or overfilled lubricant (foaming/weeping)
  [onallcylinders.com Quick Guide, Tier 3; aa1car.com/library/2004/ic20428.htm, Tier 3 — two independent
  Tier-3, accessed 2026-07-18].
- **Drivability:** `drivable_normally` unless run low → whine/grind.
- **Misattribution:** confused with engine oil (thinner, further forward) or differential oil (further
  rear) [DB enrichment of `thick_dark_brown_puddle_gear_or_differential_oil`, corroborating shape only].

### FM-12 — Clutch hydraulic-fluid (brake-fluid) leak — NEW
- **Sensory signature:** a **thin, clear-to-light-brown, watery-oily** puddle or a dropping reservoir near
  the clutch master/slave, usually paired with a softening/sinking clutch pedal (→ FM-9). Slot vocab:
  `fluid_color` reads as **brake fluid** (clear/light-brown) → routes to
  `clear_yellow_or_light_brown_puddle_brake_fluid`; `fluid_under_car_location = under_middle` /
  `under_the_engine` depending on slave location.
- **Conditions/modifiers:** hydraulic clutch systems run **DOT brake fluid**; a leaking master/slave seal
  or line drops fluid and pressure [knowyourparts.com "Clutch Failure", Tier 2; us.haynes.com clutch
  troubleshooting, Tier 2, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned` → `not_drivable` as pressure is lost.
- **Misattribution:** the fluid looks like a **brake-fluid** leak (it is, chemically) — so the leak-color
  cue alone routes to the brake-fluid subcat; the clutch-pedal symptom is what pulls it into this system.

### FM-13 — Shifter linkage / bushing slop — NEW
- **Sensory signature:** **vague, sloppy, or notchy shifter**, extra effort to find a gear, the lever
  "flops" or rattles, sometimes contributes to popping out of gear (→ FM-8). Slot vocab: proposed
  `clutch_or_gear_engagement = hard_or_notchy_shift`; `noise_descriptor = rattling` when the lever rattles.
- **Conditions/modifiers:** worn/mis-adjusted external linkage, cables/rods, worn bushings
  [onallcylinders.com Quick Guide, Tier 3 ("improperly adjusted linkage … increases the force required to
  shift"); aa1car.com/library/2004/ic20428.htm, Tier 3 ("bent, binding or loose shift linkage") — two
  independent Tier-3, accessed 2026-07-18].
- **Drivability:** `drivable_but_concerned`.
- **Misattribution:** blamed on synchros or "the transmission"; linkage is external and often the cheaper fix.

---

## 4. Customer-language lexicon (binds synonyms / keywords / positive_examples)

Full machine form in `manual-trans-clutch.lexicon.yaml`. Highlights, source-ordered (Tekmetric first).
`routes_to` below is the **corrected destination** — for NO-FIT modes that is the *proposed* subcat
(Chris-gated), never the current wrong subcat:

| Phrase (as customers say it) | Failure mode | routes_to (proposed unless current fits) | Ambiguity | Provenance |
|---|---|---|---|---|
| "CLIENT STATES CLUTCH IS SLIPPING" | FM-1 | manual_clutch_slipping (proposed) | unambiguous | tekmetric |
| "clutch has failed … revs up and doesn't have power when accelerating" | FM-1 | manual_clutch_slipping (proposed) | unambiguous | tekmetric |
| "manual transmission … started slipping in 4-high and first gear (fine in 4-low/2-high)" | 4WD range | awd_4x4_testing | cross-system:awd_4x4_testing | forum-paraphrase |
| "clutch slips going up hills and i smell somthing burning" | FM-1 | manual_clutch_slipping (proposed) | cross-system:other_burning | synthetic |
| "shudders when i let the clutch out pulling away from a stop" | FM-2 | clutch_pedal_or_engagement_feel (proposed) | needs-fact:onset_timing | synthetic |
| "grinds every time i put it in first" | FM-3/4 | grinding_or_hard_shift_gears (proposed) | needs-fact:clutch_or_gear_engagement | forum-paraphrase |
| "hard to get it into gear when its cold, have to force it" | FM-4 | grinding_or_hard_shift_gears (proposed) | needs-fact:weather_condition | forum-paraphrase |
| "squealing that goes away when i push the clutch pedal in" | **FM-7 input-shaft** | clutch_pedal_or_engagement_feel (proposed) | cross-system:high_pitched_whining_under_the_hood | synthetic |
| "chirping when i push the clutch pedal down" | FM-5 throwout | clutch_pedal_or_engagement_feel (proposed) | needs-fact:clutch_pedal_feel | synthetic |
| "whirring only when i hold the clutch down in gear" | FM-6 pilot | clutch_pedal_or_engagement_feel (proposed) | cross-system:humming_or_whirring_at_speed | synthetic |
| "rattles/raps at idle, sounds like a diesel, quiets when i push the clutch in" | FM-10 DMF | clutch_pedal_or_engagement_feel (proposed) | needs-fact:noise_descriptor | synthetic |
| "pops out of 3rd gear on the highway" | FM-8 | grinding_or_hard_shift_gears (proposed) | unambiguous | forum-paraphrase |
| "clutch pedal went to the floor and stays there, cant get in gear" | FM-9 | clutch_pedal_or_engagement_feel (proposed) | unambiguous | synthetic |
| "shifter feels really sloppy and notchy, hard to find gears" | FM-13 | grinding_or_hard_shift_gears (proposed) | needs-fact:clutch_or_gear_engagement | synthetic |
| "thin clear fluid leaking near the clutch and the pedal is going soft" | FM-12 | clear_yellow_or_light_brown_puddle_brake_fluid | needs-fact:fluid_under_car_location | synthetic |
| "thick dark oil under the middle of my stick shift, smells like sulfur" | FM-11 | thick_dark_brown_puddle_gear_or_differential_oil | needs-fact:fluid_under_car_location | synthetic |

Messiness represented: misspelling ("somthing"), part-name loose use ("transmission" for the clutch),
slang ("revs but no go", "clutch went out", "sounds like a diesel"), mixed symptom+request, vague
("shudders when i take off"). Synthetic share is flagged and held under the ~30% guidance per target (real
tekmetric/forum lines carry FM-1/3/4/8 and the 4WD-range line).

---

## 5. Differential & discriminating questions (binds required_facts + slots)

| Confusable pair | ONE best discriminating question | Fact slot + value that answers it | Terminal op |
|---|---|---|---|
| FM-1 clutch slip **vs** engine low-power/misfire | "Does the **engine rev up** but the car **doesn't pick up speed**?" | *proposed* `clutch_or_gear_engagement = revs_without_speed_gain` (yes) vs `engine_running = misfiring/normal` | stage3.slot.propose:clutch_or_gear_engagement |
| FM-1 manual clutch slip **vs** automatic torque-converter slip | "Does the car have a **clutch pedal** you have to press to shift?" | presence of a manual-specific `clutch_pedal_feel` value (any) ⇒ manual reading; auto flare has no clutch pedal | stage1.hedge.add (manual vs automatic reading) |
| FM-1 clutch slip **vs** 4WD range slip | "Does it slip in **every** gear/range, or only in a **particular 4WD range** (like 4-High)?" | range-independent ⇒ this system; range-specific ⇒ `awd_4x4_testing` | stage2.example.negative.add → awd_4x4_testing |
| FM-5 throwout **vs** FM-7 input-shaft **vs** FM-6 pilot bearing | "Does the noise happen when you **press the pedal down**, only when it's **held fully down in gear**, or in **neutral with your foot OFF the clutch** (gone when you press it)?" | throwout = on-depression (`squealing_high_pitched`); pilot = pedal-fully-down (`humming_or_whirring`); input-shaft = neutral/pedal-up, gone on press — pedal-phase is **not a current slot** → §9 | stage3.slot.propose (pedal-phase captured via clutch_pedal_or_engagement_feel subcat) |
| FM-5/6/7 clutch bearing **vs** wheel bearing hum | "Does the noise change with the **clutch pedal**, or with **how fast you're driving**?" | clutch-pedal-dependent → this system; road-speed → `speed_band` + `suspension-steering` | stage2.example.negative.add → humming_or_whirring_at_speed |
| FM-5 throwout squeal **vs** serpentine-belt squeal | "Does it change when you **press the clutch**, or is it there anytime the **engine runs**?" | clutch-pedal → this system; engine-RPM-only → `high_pitched_whining_under_the_hood` | stage2.example.negative.add → high_pitched_whining_under_the_hood |
| FM-2 clutch chatter **vs** CV-axle/motor-mount shudder | "Does it shudder **only as you let the clutch out from a stop**, or when you're **accelerating at speed**?" | *proposed* `onset_timing = from_a_stop_pulling_away` (clutch) vs `onset_timing=when_accelerating`+ a stated speed (CV/mount) | stage3.slot.value.add:onset_timing=from_a_stop_pulling_away |
| FM-3 clutch drag grind **vs** FM-4 synchro grind | "Does it grind going into **every** gear (incl. reverse) with the engine running, or only into **one particular gear** on quick shifts?" | *proposed* `clutch_or_gear_engagement = grinds_when_shifting` (all/reverse = drag) vs `hard_or_notchy_shift` (one gear = synchro) | stage3.slot.propose:clutch_or_gear_engagement |
| FM-9 clutch pedal-to-floor **vs** brake pedal-to-floor | "Which pedal — the **clutch** (far left) or the **brake**?" | *proposed* `clutch_pedal_feel` (clutch) — do NOT set brake `pedal_feel` (literalness) | stage3.slot.propose:clutch_pedal_feel |
| FM-10 DMF rattle at idle **vs** engine tick/knock | "Does the rattle **change when you press the clutch pedal**, or does it track engine RPM even in park with the clutch untouched?" | clutch-linked ⇒ DMF/this system; RPM-only ⇒ `engine_ticking_or_tapping`/engine | stage2.example.negative.add → engine_ticking_or_tapping |

The highlighted discriminators (pedal-**phase** of noise; revs-without-speed; engagement-phase-vs-speed
shudder) are **not expressible in the current 29 slots** → they are the raw material for the §9 slot
proposals and are owned at the cross-system level by `router-nvh` + `router-no-start-power`.

---

## 6. Warning lights & DTC surface

Manual clutch/gearbox failures are **largely light-free** — most are mechanical and set no dash light.
Exceptions worth capturing for `warning_light_named` (free-text) rather than a new light:
- Drive-by-wire / clutch-position-switch cars can set a **Check Engine Light** (CEL) or a generic
  "transmission" / "service transmission" message on a clutch-switch or input/output-speed-sensor fault
  (P-codes surfaced by `check_engine_light_testing`, not this service) — low corpus frequency.
- **Hill-start-assist / clutch-warning** telltales exist on some models; customers rarely name them and
  the corpus shows none.

**Terminal disposition (explicit no-op backlog):** this surface feeds the **existing** `warning_light_named`
free-text slot only. It proposes **no** new `warning_light_named` value, **no** new `warning_light_behavior`
value, and **no** subcategory — corpus frequency is zero and any DTC belongs to `check_engine_light_testing`.
Logged as a Wave-B backlog item for `router-warning-lights`; deliberately terminates in **no change-op**.

---

## 7. Confusable neighbors (cross-system)

- **`suspension-steering` (wheel bearing hum / CV-axle click/shudder)** — discriminator: **pedal-
  dependence & phase**. Clutch bearing noise tracks the *clutch pedal*; wheel-bearing hum tracks *road
  speed* (`humming_or_whirring_at_speed`), CV click tracks *turning* (`popping_or_clicking_when_turning`),
  CV/mount shudder tracks *throttle load at speed* (`shaking_when_speeding_up_or_going_uphill`). Owned by
  `router-nvh`.
- **`engine-drivability` (misfire / low power / limp mode)** — discriminator: clutch slip = **RPM rises
  without speed**; misfire = **bucking/jerking** (`engine_misfire_or_bucking_feeling`); limp mode =
  steady weakness + CEL (`low_power_or_wont_accelerate_normally`). Owned by `router-no-start-power` +
  `engine-drivability`. DMF rattle (FM-10) is also confusable with engine tick/knock — clutch-linkage of
  the noise is the cue.
- **Automatic transmission** (same `transmission_testing` service) — discriminator: **presence of a
  clutch pedal / driver-operated engagement**. Auto "slip" = flare/delayed engagement between gears with
  no clutch pedal. Both book the same test, but the Stage-2 subcat and questions should differ — hence
  the manual-specific subcat + slot proposals AND the `stage1.hedge.add` op in §8/proposals.
- **`awd_4x4_testing` (transfer-case / 4WD range engagement)** — discriminator: **range-dependence**. A
  clutch slip is range-independent (slips in any forward gear under load); a complaint that slips/misbehaves
  **only in a specific 4WD range** (e.g. the verbatim forum line "started slipping in 4-high and first gear …
  in 4-low or 2-high there are no problems") is a **transfer-case/4WD** signature, NOT a clutch — route to
  `awd_4x4_testing`. Flagged `cross-system:awd_4x4_testing` in the lexicon.
- **`router-smoke-smells` (burning smell)** — a slip burning smell overlaps `burnt_oil` /
  `burning_rubber_or_hot_brakes` / `other_burning`; route to this system only when slip is stated, else the
  smell router owns it.
- **`driveline-awd` (differential / transfer-case gear oil)** — discriminator: **location**. Manual
  gearbox leak = `under_middle`; diff/axle = `under_rear`/`under_a_wheel`. Shared color/smell cue.
- **Brake hydraulics (`clear_yellow_or_light_brown_puddle_brake_fluid`)** — FM-12 clutch hydraulic fluid
  IS brake fluid; the leak-color cue alone routes to the brake-fluid subcat, and only the **clutch-pedal**
  symptom pulls it into this system. Owned by `router-leaks`.

`router-nvh` and `router-no-start-power` OWN the `binding/confusable-matrix.yaml` rows for the three-bearing
pedal-phase set and the clutch-slip-vs-auto-slip / clutch-slip-vs-4WD-range rows; this dossier supplies the
discriminators.

---

## 8. Mapping to current taxonomy (binds catalog + subcategory proposals)

| Failure mode | Current service | Current category | Current subcategory | Fit |
|---|---|---|---|---|
| FM-1 clutch slip | transmission_testing | performance | low_power_or_wont_accelerate_normally | **weak** — desc mentions "transmission slipping (engine revs without speed)" but nothing clutch/manual-specific; slip has no clutch-pedal question |
| FM-2 chatter/judder | transmission_testing | vibration | shaking_when_speeding_up_or_going_uphill | **weak** — that subcat is throttle-load/CV-axle and "fades when you coast"; chatter is engagement-phase (takeoff) |
| FM-3 clutch drag grind | transmission_testing | — | (none) | **NO FIT** |
| FM-4 synchro hard/notchy shift | transmission_testing | — | (none) | **NO FIT** |
| FM-5 throwout bearing noise | transmission_testing | noise | (nearest: high_pitched_whining_under_the_hood) | **NO FIT** — that subcat is belt/alt/PS and explicitly engine-RPM, not pedal |
| FM-6 pilot bearing noise | transmission_testing | noise | (nearest: humming_or_whirring_at_speed) | **NO FIT** — that subcat is road-speed wheel bearing, not clutch-pedal |
| FM-7 input-shaft bearing noise | transmission_testing | noise | (nearest: humming_or_whirring_at_speed) | **NO FIT** — road-speed subcat; this is neutral/pedal-up |
| FM-8 pops out of gear | transmission_testing | — | (none) | **NO FIT** |
| FM-9 clutch pedal-to-floor | transmission_testing | — | (none) | **NO FIT** — brake `pedal_sinks_to_floor` exists but is brakes; must NOT reuse |
| FM-10 DMF rattle | transmission_testing | noise | (nearest: engine_ticking_or_tapping / rattling) | **NO FIT** — engine-noise subcats; clutch-linked rattle has no home |
| FM-11 manual gearbox gear-oil leak | (none / oil_leak path?) | leak | thick_dark_brown_puddle_gear_or_differential_oil | **good** subcat, but `leak` is **unreachable by `transmission_testing`** (concern_categories=['performance']) |
| FM-12 clutch hydraulic-fluid leak | (none) | leak | clear_yellow_or_light_brown_puddle_brake_fluid | **good** subcat (it IS brake fluid), but same `leak`-unreachable problem for booking under trans |
| FM-13 shifter linkage slop | transmission_testing | — | (none) | **NO FIT** |

**Proposals (Chris-gated), all under `performance` so `transmission_testing` can reach them:**
1. `manual_clutch_slipping` — dedicated slip subcat (splits the clutch-slip signal out of the generic
   low-power bucket). Demand: 2 verbatim tekmetric lines + forum lines.
2. `grinding_or_hard_shift_gears` — grind-on-shift / hard-notchy / won't-go-in / pops-out / linkage slop.
   Demand: forum corpus (grind into 1st/reverse; hard shift 2↔3; pops out of gear).
3. `clutch_pedal_or_engagement_feel` — pedal-to-floor / no-pressure / high-or-low bite / chatter on
   release / **pedal-phase-dependent bearing noise (throwout / pilot / input-shaft)** / DMF idle rattle.
   Demand: FM-2/5/6/7/9/10.

**Stage-1 hedge op:** `stage1.hedge.add` between the manual-clutch reading and the automatic reading of
`transmission_testing` — clutch-pedal / "stick" / "manual" language selects manual; flare-between-shifts /
no-clutch-pedal selects automatic. This is the terminal op for the §5 manual-vs-auto row.

**Catalog-scope op:** extend `transmission_testing.concern_categories` to include `leak` (so a manual-
trans fluid leak — FM-11 gear oil OR FM-12 hydraulic brake fluid — can route to a fluid-inspecting path)
**or** add a bookable trans-fluid-leak path — Chris-gated; today FM-11/FM-12 are routing orphans.

---

## 9. Fact-slot audit

**Slots this system already uses** (values customers actually state in the corpus/forums):
- `onset_timing`: `when_accelerating` (slip on accel), `over_bumps` (pops out), `cold_start` (hard cold
  shift). **Missing value:** an *engagement-from-a-stop* value → §value.add below.
- `speed_band`: `idle`/`stopped` (DMF rattle at idle), `low_speed` (chatter takeoff). Set **only** when a
  speed is stated; `highway` needs a named 50+ mph. "On a hill / under load" is NOT a speed band.
- `noise_descriptor`: `squealing_high_pitched` (throwout / input-shaft), `humming_or_whirring` (pilot /
  input-shaft), `grinding_metallic` (gear grind), `rattling` (DMF / linkage).
- `smell_descriptor`: `burnt_oil` / `burning_rubber_or_hot_brakes` when named, else `other_burning` for a
  vague burn (slip); `rotten_egg_or_sulfur` (gear oil).
- `fluid_color`: `thick_dark_brown` (hypoid) or `red_or_pink` (ATF-spec box); brake-fluid clear/light-brown
  (FM-12 hydraulic). `fluid_under_car_location`: `under_middle`.
- `recent_action`: `general_service` (post-clutch-job complaint); `customer_request_type`:
  `replace_specific_part` ("new clutch"); `drivable_state`: `not_drivable_needs_tow` (won't go in gear);
  `weather_condition`: `cold_weather` (cold hard shift); `started_when`: `gradually` (slip);
  `engine_running`: `running` (DMF idle rattle).

**Discriminating facts with NO current slot → proposals (each meets the ≥3-question rule):**

- **`clutch_or_gear_engagement`** (proposed) — what the drivetrain does when you try to put power down or
  change gear. Values + literal cues in `proposals.yaml`. **Unlocks ≥3 questions:** it fills the currently
  EMPTY `required_facts` on three *existing active* questions — Q1183 ("engine revs up high but the car
  doesn't pick up speed"), Q1186 ("stuck in a lower gear or held back"), Q168 ("transmission slipping or
  shifting strangely") — plus new grind/hard-shift/pops-out questions. **CONTESTED (see §Workstream-Q
  reconciliation):** these three question IDs are ALSO claimed by `automatic-transmission.proposals.yaml`
  (proposed slot `transmission_behavior`), `engine-controls-driveability.proposals.yaml` (proposed slot
  `power_delivery_feel`), and `air-induction-forced-induction.proposals.yaml` (marks 1183/1186
  `intentionally_empty`). All three competing proposed slots encode the same `revs_without_speed_gain`
  semantics — Wave-C MUST merge them into ONE canonical slot before any of these `required_facts.set` ops
  apply. This dossier's ops are marked `contested_with` and `conditional_on` that reconciliation.
- **`clutch_pedal_feel`** (proposed, manual-specific) — clutch pedal behavior: slips_high_bite /
  engages_low / soft_or_no_pressure / stays_on_floor / stiff / chatters_on_release / normal. Distinct
  from the brake-only `pedal_feel` slot (whose enum + description are explicitly *brake* — reusing it
  would misroute a clutch complaint to brake questions). **Unlocks ≥3 questions:** three NEW proposed
  questions authored under the `clutch_pedal_or_engagement_feel` subcat (Q-CPF-BITE bite-point, Q-CPF-RETURN
  pedal-return/floor, Q-CPF-NOISE pedal-phase noise) — see the `stage2.question.propose` ops in
  `proposals.yaml`; `questions_unlocked` lists those three proposed IDs.
- **`onset_timing` value add** — `from_a_stop_pulling_away` (existing slot, low-risk value.add) — literal
  cues "when i take off from a stop", "pulling away from a light", "when i let the clutch out". Sharpens
  the FM-2 chatter vs FM-1/CV shudder discriminator; used by chatter + jumps-out questions.

No proposal to overload `engine_running` with a "revs-no-power" value — that fact is a *driveline* state,
not an engine-run state, and belongs in `clutch_or_gear_engagement`. **No proposal to add a "manual" value
to `vehicle_powertrain`** — that enum is fuel type (gasoline/diesel/hybrid/electric/turbocharged/not_stated)
and manual-vs-auto is handled by the `stage1.hedge.add` op + the presence of a `clutch_pedal_feel` value,
NOT by `vehicle_powertrain`.

**Snapshot dependency (revalidate at apply):** the claims that `transmission_testing` has zero
`example_keywords` and that Q168/Q1182/Q1183/Q1186 currently have EMPTY `required_facts` come from a live
Supabase MCP read on 2026-07-18, not from `00-current-scheduler-taxonomy.md`. The keyword and
`required_facts.set` ops depend on that snapshot and MUST be re-read against the live DB at Phase-5 apply.

---

## Workstream-Q — cross-dossier question reconciliation (CONTESTED IDs)

| Question ID | This dossier proposes | Also claimed by | Recommended Wave-C reconciliation |
|---|---|---|---|
| Q1183 "revs up high but car doesn't pick up speed" | `clutch_or_gear_engagement=revs_without_speed_gain` | automatic-transmission (`transmission_behavior`); engine-controls-driveability (`power_delivery_feel`); air-induction-forced-induction (`intentionally_empty`) | Merge the three proposed slots into ONE canonical driveline slot; then set that one slot on Q1183 |
| Q1186 "stuck in a lower gear / held back" | `clutch_or_gear_engagement` (PARTIAL) | automatic-transmission; engine-controls-driveability; air-induction (`intentionally_empty`) | Same canonical slot; keep PARTIAL skip |
| Q168 "transmission slipping or shifting strangely along with shaking" | `clutch_or_gear_engagement` (PARTIAL) | (per collision report) sibling driveline dossiers | Same canonical slot; keep PARTIAL skip |
| Q1182 "loss of power constant or comes and goes" | `onset_timing` | engine-controls-driveability (same `onset_timing`) | **Harmless duplicate** — identical fact; either dossier's op is idempotent |

All four `question.required_facts.set` ops in `proposals.yaml` carry a `contested_with` list and are
`conditional_on` the Wave-C slot merge. This dossier does **not** unilaterally claim the IDs.

---

## 10. Sources

Diagnostic (Tier-anchored; two-independent rule honored where Tier-3 is the sole tier for a claim):
- freeasestudyguides.com — *Diagnose Clutch Noise* (https://www.freeasestudyguides.com/diagnose-clutch-noise.html)
  — release bearing squeal APPEARS on pedal depression (bearing contacts pressure-plate fingers); input-shaft
  bearing = noise in neutral; pilot bearing = whirl only pedal-fully-down; chatter = engagement-phase, causes
  glazed/oil-contaminated facings + misaligned mounts. Tier 2 (ASE study-guide material). Accessed 2026-07-18.
- freeasestudyguides.com — *Manual Transmission Hard Shifting Problems*
  (https://www.freeasestudyguides.com/hard-shifting-problems.html) — worn disc / lost free-play / worn
  synchro. Tier 2. Accessed 2026-07-18. (Does NOT cover gear-oil "dry shift", hydraulics, or pops-out — those
  claims are cited elsewhere, not here.)
- onallcylinders.com (Summit Racing) — *Manual M.D.: Quick Guide to Diagnosing Manual Transmission Troubles*
  (2016-04-15, https://www.onallcylinders.com/2016/04/15/quick-guide-diagnosing-manual-transmission-troubles/)
  — clutch drag from worn/dry pilot bearing; difficult shifting from mis-adjusted linkage; jumping out of gear;
  oil leaking (seals/gaskets/overfill); noise types. Tier 3. Accessed 2026-07-18.
- aa1car.com — *How to Diagnose Manual Transmission Problems*
  (https://www.aa1car.com/library/2004/ic20428.htm) — jumps-out-of-gear cause list; input-shaft bearing =
  growl/grind with clutch engaged; dual-mass-flywheel idle noise (BMW M3); oil leak. Tier 3. Accessed 2026-07-18.
- knowyourparts.com (Standard Motor Products / MEMA) — *Clutch Failure: Common Causes and Replacement Advice*
  (https://www.knowyourparts.com/technical-resources/drive-train/clutch-failure-common-causes-and-replacement-advice/)
  — failed/leaking master-slave hydraulic → sudden clutch failure / won't release; oil-contaminated facings →
  slip/chatter. Tier 2 (parts-manufacturer technical training). Accessed 2026-07-18.
- us.haynes.com — *Troubleshooting: Common Clutch Issues and Causes*
  (https://us.haynes.com/blogs/tips-tutorials/troubleshooting-common-clutch-issues-and-causes) — hydraulic
  clutch loss / pedal-to-floor / no disengagement. Tier 2 (repair-manual publisher). Accessed 2026-07-18.
- Schaeffler / LuK — *Noises of the dual mass flywheel* (vehiclelifetimesolutions.schaeffler.com, LuK-PL-0104-en)
  — DMF rap at idle / rattle under load from arc-spring/secondary-mass wear; worn DMF damages a new clutch.
  Tier 2 (parts-manufacturer technical training). Accessed 2026-07-18.

**Removed / corrected since the prior draft:** the Schaeffler/LuK **RepXpert** clutch-training page returned
403 to direct fetch and is dropped entirely (source-policy: never cite an inaccessible source); the specific
"re-fails within 10,000–20,000 mi" oil-contamination mileage figure that rested on it alone is **deleted**.
FM-5's "quiets when the pedal is fully up or fully down" directionality is deleted (unsupported; the source
says the squeal APPEARS on depression). FM-4's "dry gear oil" and FM-3/FM-9 hydraulic sub-claims are now
cited to knowyourparts/Haynes, not to the hard-shifting page (which covers none of them).

Linguistic (customer voice):
- `scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json` (verbatim clutch-slip lines).
- `scheduler-app/scripts/eval/real-concerns-forums.json` (manual-trans slip, grind, hard-shift, pops-out,
  the verbatim 4-Runner 4-high/4-low range line).
- DB enrichment snapshot of bound subcategories (via Supabase MCP read, 2026-07-18) — used to *sharpen*,
  not duplicate; treated as untrusted data.

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every failure mode (FM-1…FM-13) carries ≥1 customer-voice phrasing (§4/lexicon) **and** ≥1
  discriminating fact (§5).
- [x] Every diagnostic claim in §2/§3/§5/§7 carries an inline Tier cite; **no claim rests solely on a single
  Tier-3** (pops-out, gear-oil-leak, and linkage each pair onallcylinders + aa1car; DMF pairs Schaeffler/LuK
  Tier-2 + aa1car Tier-3). The inaccessible RepXpert 403 cite and the mileage figure that depended on it are
  deleted.
- [x] Every `stage2.example.negative.add` in `proposals.yaml` names a `routes_to` and carries a real
  `conditional_on:` **field** (not a YAML comment) where it targets a proposed subcat.
- [x] Customer artifacts in customer voice; synthetic phrasings flagged and held ≈ ≤30% per target; no
  shop-only vocabulary ("bellhousing", "throwout bearing") in customer-voice artifacts.
- [x] Literalness respected — FM-2/FM-9 inference traps encoded as golden cases; "shakes on takeoff" sets
  ONLY `onset_timing`, and NOT any clutch slot or a non-existent `vehicle_powertrain=manual`; a vague
  "burning" sets `other_burning`, not `burning_rubber_or_hot_brakes`; "up hills" sets no `speed_band`.
- [x] Each `stage3.slot.propose` meets the ≥3-question rule: `clutch_or_gear_engagement` cites 3 existing
  question IDs (contested — see Workstream-Q); `clutch_pedal_feel` cites 3 NEW proposed question IDs authored
  as `stage2.question.propose` ops.
- [x] Each `question.required_facts.set` names facts that exist today (`onset_timing`) or in an accepted slot
  proposal (flagged `conditional_on`); the four contested IDs carry `contested_with`.
- [x] The `vehicle_powertrain` enum is NOT extended (fuel-type slot); manual-vs-auto is a `stage1.hedge.add`.
- [x] §6 warning-light surface deliberately terminates in **no op** (documented no-op backlog), consistent
  with the headline's "every *actionable* finding terminates in an op".
- [x] Catalog/subcategory proposals marked Chris-gated; no DB writes performed. Snapshot-dependent ops
  (empty `example_keywords` / empty `required_facts`) flagged for revalidation at apply.
- [~] Open for Wave B/C: the three-bearing pedal-phase, clutch-slip-vs-auto-slip, and clutch-slip-vs-4WD-range
  confusable-matrix rows are supplied here but OWNED by `router-nvh` / `router-no-start-power`; and the
  contested Q168/Q1183/Q1186 slot merge is owned by Wave-C aggregation.
