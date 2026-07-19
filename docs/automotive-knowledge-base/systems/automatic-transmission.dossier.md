# Automatic transmission & CVT — diagnostic dossier
slug: automatic-transmission   date: 2026-07-18   binds_services: [transmission_testing]   binds_categories: [performance, vibration, leak, warning_light, noise]

> Scope note for the reader: Jeff's has exactly **one** transmission-facing testing service today
> (`transmission_testing`, $179.95, `concern_categories = [performance]` only). That single service +
> the symptom-organized Stage-2 taxonomy is why transmission complaints are currently scattered across
> `performance`, `vibration`, `leak`, `warning_light`, and `noise` with **no shift-quality home**. This
> dossier maps the system, then binds every finding to a change-op that either (a) fills the empty
> `transmission_testing.example_keywords[]`, (b) sharpens the confusable performance/vibration/leak/noise
> subcats, or (c) proposes the missing shift-behavior subcategory + the missing `transmission_behavior`
> fact slot.

---

## 1. Scope & boundaries

**In scope** — the automatic gearbox (planetary stepped automatics, CVTs, dual-clutch/DCT) and the parts
that shape *how it drives*:
- Torque converter + lockup (TCC) clutch; CVT belt/chain + pulleys; DCT clutch packs.
- Clutch packs / bands / valve body / shift + TCC solenoids; transmission control module (TCM).
- Automatic transmission fluid (ATF / CVT fluid): level, condition, external leaks.
- Shift quality: slipping, delayed/no engagement, harsh (bang) shifts, flare between shifts, stuck-in-gear,
  pops-out-of-gear, won't-shift, limp mode, converter/CVT shudder, and transmission NOISE (gear/pump/CVT
  whine, reverse grind).

**Out of scope (with the neighbor dossier that owns it):**
- **Manual clutch (pedal-operated)** — the `clutch is slipping` complaint on a manual → the
  **`manual-trans-clutch`** dossier (a real sibling file under `systems/`). Automatic "clutch" here means
  internal clutch packs / TCC.
- **CV axles, driveshaft, U-joints, differential, transfer case, AWD engagement** → **`driveline-cv-diff-awd`**.
  Acceleration shudder is SHARED with CV/driveshaft (§7).
- **Differential / gear oil leak** (thick dark-brown, sulfur smell) → owned by
  `thick_dark_brown_puddle_gear_or_differential_oil`; NOT trans (§7).
- **Power-steering fluid leak / PS-pump whine** — shares the red ATF dye (leak) and the under-hood whine
  (noise), so it shares the `red_or_pink_puddle…` and `high_pitched_whining_under_the_hood` subcats; the
  discriminators live in this dossier (§5, §7) but the PS *system* is **`steering-power-steering`**.
- **Engine-side causes of slow acceleration** (clogged cat, fuel pump, MAF, misfire) →
  **`engine-controls-driveability`** (driveability/DTC side) / **`engine-mechanical`** (mechanical side).
  The trans-slip ↔ engine-low-power confusable is the #1 differential in this dossier (§5, §7).
- **Shifter/park-interlock electronics, "Shift to Park" messages, gear-selector cable** — borderline; a
  pure electrical "Shift to Park won't clear" is a body/electrical complaint (**`body-electrical-accessories`**),
  but the corpus labels the driveability version `transmission_testing`. Handled as a low-confidence edge in §7.

---

## 2. System primer (expert, CITED)

An automatic transmission multiplies engine torque and changes ratios without a driver-operated clutch.
Three dominant US-market architectures [Halderman, *Automotive Technology*, 6e, Tier 2, accessed 2026-07-18;
SAE J1930 terminology, Tier 1, accessed 2026-07-18]:

1. **Planetary stepped automatic** (most trucks/SUVs, older cars). A **torque converter** (a fluid coupling
   with a **lockup/TCC clutch**) transmits power; **planetary gearsets** provide discrete ratios; **clutch
   packs and bands**, applied hydraulically through a **valve body** and **shift solenoids**, engage each
   gear. The TCM commands solenoid pressures. Modern units lock the converter clutch as early as 10–15 mph
   in 2nd gear [Gears Magazine (ATRA), "Shudder Diagnosis," Tier 2, accessed 2026-07-18].
2. **CVT (continuously variable)** — very common on Nissan, Subaru, Honda, Toyota economy cars in Jeff's
   era mix. A steel **push-belt or chain** rides between two variable-width **pulleys**; there are no fixed
   gears. Launch is via a torque converter or a start clutch. CVT fluid is friction-critical, and degraded
   fluid is **a common** driveability complaint [Halderman 6e, Tier 2, accessed 2026-07-18].
3. **Dual-clutch (DCT)** — two clutch packs on odd/even gearsets; behaves like an automated manual. Low-speed
   creep judder and clutch wear are its signature complaints [Halderman 6e, Tier 2, accessed 2026-07-18].

**Operating-fluid principle worth internalizing for classification:** the same fluid does the coupling, the
shifting, and the cooling. So *low or degraded fluid* produces the whole family of symptoms — slip, shudder,
delayed engagement, harsh shift — which is exactly why so many different customer phrasings all correctly
route to the one `transmission_testing` service [Halderman 6e, Tier 2, accessed 2026-07-18]. The classifier's
job is not to name the internal part; it is to (a) recognize a transmission driveability/leak/noise complaint
and (b) capture the *behavior* (slip vs shudder vs harsh vs no-engagement vs whine) so the wizard doesn't
re-ask it.

---

## 3. Failure-mode catalog  ← the diagnostic spine (CITED per mode)

> Sensory signatures written in existing fact-slot vocab where a slot exists; where the discriminating
> cue has **no slot**, it is flagged `[NO SLOT → transmission_behavior]` (the §9 proposal).
> Citation note: failure-mode fundamentals are cited to the Halderman 6e textbook (Tier 2, a standard
> curriculum reference that covers each of these modes). The Gears/ATRA "Shudder Diagnosis" article is cited
> ONLY for the claims it was verified to contain (TCC-lockup mph windows; the misfire-under-load vs
> TCC-shudder-at-cruise discriminator). Paywalled ATSG/Sonnax manuals were **not** accessed and are not
> cited (source-policy.md forbids fabricating a paywalled cite) — their standard content is carried by the
> textbook cite instead.

**M1 — Slipping (revs without speed).** Engine RPM rises but road speed doesn't follow; worst under load /
uphill / when warm. Sensory: `speed_band` any, `onset_timing = when_accelerating`, `[NO SLOT → transmission_behavior=slipping]`,
often "engine revs but car doesn't move." Drivability: `drivable_but_concerned` → `not_drivable_needs_tow`
as it worsens. Cause set: low/burnt fluid, worn clutch packs, failing pump, valve-body wear
[Halderman 6e, Tier 2, accessed 2026-07-18]. **Customer misattribution:** "the engine has no power" /
"feels like the emergency brake is on" — customers almost never say "transmission"; they describe an *engine*
weakness. This is the #1 confusable (→ §5, §7).

**M2 — Torque-converter-clutch (TCC) shudder.** A rhythmic shudder like driving over rumble strips, at
**steady light-throttle cruise ~35–45 mph in 3rd/4th gear**, that clears when you add or lift throttle.
Sensory: `onset_timing = when_accelerating` OR steady cruise, `speed_band = mid_speed/specific_mph`, felt
through floor/seat. Cause: worn TCC friction lining or contaminated fluid preventing clean lockup
[Gears Magazine (ATRA), "Shudder Diagnosis," Tier 2, accessed 2026-07-18]. **Misattribution:** customers call
this "engine misfire" or "the car shakes" — the ATRA discriminator is that **cylinder misfire worsens under
heavy load + low RPM, while TCC shudder appears at light-throttle cruise** [Gears Magazine, Tier 2, accessed
2026-07-18]. A brake tap also unlocks the TCC (the TCM commands lockup OFF on brake-pedal application), so a
shudder that vanishes the instant you tap the brake points at the converter clutch [Halderman 6e, Tier 2,
accessed 2026-07-18].

**M3 — CVT judder / belt-slip shudder.** Low-speed takeoff or mild-acceleration shudder/juddering on a CVT,
often 1000–2000 RPM; degrades with fluid age. Sensory: mirrors M2 but at lower speed / takeoff. Currently
shares M2's home. Cause: degraded/friction-spent CVT fluid and belt–pulley slip [Halderman 6e, Tier 2,
accessed 2026-07-18]. (Several makes issue fluid/software service bulletins for CVT judder; no specific
bulletin is cited here because none was accessed.) **Misattribution:** "vibrates when I take off," "feels like
clutch judder."

**M4 — Delayed engagement.** After selecting D or R, a 2–4 second pause before the transmission "catches,"
then drives normally; worst cold or after sitting. Sensory: `[NO SLOT → transmission_behavior=delayed_engagement]`,
`onset_timing = cold_start/at_startup`. Cause: internal leak-down / low fluid / worn pump / seals
[Halderman 6e, Tier 2, accessed 2026-07-18]. **Misattribution:** "it hesitates when I put it in gear," "takes a
second to go."

**M5 — Harsh / hard (bang) shift.** Shifts land hard — a clunk or jolt on the 1-2 / 2-3 change, or a bang
going into D/R. Sensory: `[NO SLOT → transmission_behavior=harsh_or_hard_shift]`, `onset_timing = when_accelerating`.
Cause: valve-body/solenoid pressure fault, TCM adaptive-learn loss, low fluid [Halderman 6e, Tier 2, accessed
2026-07-18]. **Misattribution:** "jerks when it shifts," "slams into gear."

**M6 — No engagement / won't move.** Selector goes to D or R but the car won't move (or moves only in the
wrong range — e.g. **drives forward but won't reverse**); revs freely; may need to rock the shifter to engage.
Sensory: `[NO SLOT → transmission_behavior=no_engagement]`, `drivable_state = not_drivable_needs_tow`, often
`warning_light_behavior = multiple_lights_at_once`. Cause: severe internal failure, broken pump, snapped input,
catastrophic fluid loss [Halderman 6e, Tier 2, accessed 2026-07-18]. **Misattribution:** "transmission failed,"
"won't go into gear," "car won't move."

**M7 — Stuck in gear / won't shift / pops out of gear.** Transmission holds one gear (limp mode) or won't
leave a gear; RPM climbs high before an eventual shift. The inverse also occurs — it **pops/jumps out of gear**
on its own while moving. Sensory: `[NO SLOT → transmission_behavior=stuck_in_gear | pops_out_of_gear]`, often
"a lot of dashboard lights," `warning_light_named = check engine/transmission`, `warning_light_behavior = came_on_then_off`.
Cause: TCM limp/failsafe from a stored fault, speed-sensor / solenoid fault, worn detent/linkage (pop-out)
[SAE J2012 DTC definitions P0700/P0730-range, Tier 1, accessed 2026-07-18; Halderman 6e, Tier 2, accessed
2026-07-18]. **Misattribution:** "went into limp mode," "stuck in 3rd," "pops out of gear."

**M8 — Flare between shifts.** RPM briefly spikes/hangs during an upshift before the next gear grabs.
Sensory: `[NO SLOT → transmission_behavior=flaring_between_shifts]`, `onset_timing = when_accelerating`.
Cause: worn clutch/band, low line pressure [Halderman 6e, Tier 2, accessed 2026-07-18]. **Misattribution:**
looks like M1 slip to the customer ("revs up between gears").

**M9 — External ATF leak.** Red/pink oily puddle, thinner than engine oil, faint sweet-burnt smell; toward
mid/rear under the pan. Sensory: `fluid_color = red_or_pink`, `fluid_under_car_location = under_middle/under_rear`.
Cause: pan gasket, cooler line, seals [Halderman 6e, Tier 2, accessed 2026-07-18]. **Misattribution:** confused
with power-steering fluid (identical dye, front of bay) — see §5/§7.

**M10 — Overheat / trans-temp warning.** "Transmission hot," burnt smell, sometimes limp mode. Sensory:
`warning_light_named = transmission temp` (no dedicated dash-light subcat exists — §6 gap), `smell_descriptor`
often reported as burnt (not modeled well). Cause: low/old fluid, cooler restriction, towing overload
[Halderman 6e, Tier 2, accessed 2026-07-18]. **Misattribution:** "engine is overheating" (customers conflate
temp warnings).

**M11 — Transmission noise (gear/pump/CVT whine, reverse grind).** A whine or whir that **rises and falls with
road speed** (present in gear, changes with mph — worn planetary gears / output bearings), a whine that tracks
the pump, a CVT that "whines like a turbo" as it speeds up, or a **grind when selecting reverse**. Sensory:
`noise_descriptor = whine/grinding`, `speed_band` tracks the noise; `[NO SLOT → transmission_behavior]` does
NOT cover noise (noise is its own descriptor). Cause: worn gears/bearings, pump wear, CVT belt/pulley wear
[Halderman 6e, Tier 2, accessed 2026-07-18]. **Misattribution:** a road-speed whine is blamed on "the tires"
or "a wheel bearing," and an under-hood whine is confused with the **power-steering pump** (§5 D8) — the trans
whine tracks ROAD SPEED and is present in gear; the PS-pump whine tracks ENGINE RPM and is worst on turns.

> Every M-entry above terminates in a change-op: M1/M4/M5/M6/M7/M8 drive the `transmission_behavior` slot
> proposal (§9) + the `harsh_delayed_or_no_shift` subcategory proposal (§8); M2/M3 sharpen
> `shaking_when_speeding_up_or_going_uphill`; M9 sharpens `red_or_pink_puddle…`; M10 is a warning-light gap;
> M11 adds the `noise` category to the P3 service-config op + the D8 whine confusable.

---

## 4. Customer-language lexicon  ← binds synonyms / positive_examples / keywords

Source order: Tekmetric corpus → forums (paraphrased) → NHTSA → synthetic (flagged) → catalog (existing DB
enrichment text, flagged). Full machine list in `automatic-transmission.lexicon.yaml`. Highlights by failure
mode (■ = verbatim-style corpus; ◧ = existing catalog enrichment text, honestly labeled — NOT raw corpus):

- **M1 slip** — ■ "when driving up a hill trans slips" (tekmetric); ◧ "engine revs high but the car barely
  picks up speed, especially on hills" (existing `low_power` catalog example); "slips in gear," "revs but
  doesn't go," "feels like it's slipping when I accelerate."
- **M2 TCC / M3 CVT shudder** — ■ "car shudders pretty bad whenever i give it gas going uphill, smooths right
  out as soon as i let off" (tekmetric); "shudders around 40 like rumble strips," "judder when I take off"
  (forum-paraphrase), ■ "EPC LIGHT AND SHUTTERING TRANSMISSION ISSUE" (tekmetric); ◧ "car shudders when the
  transmission is working hard on hills" (existing `shaking…` catalog example).
- **M4 delayed engagement** — "takes a few seconds to engage when I put it in drive" (forum-paraphrase); ■
  "CAR HESITATES WHEN PUTTING IN GEAR AFTER SITTING FOR AWHILE" (tekmetric); ■ "felt like it was in neutral"
  (tekmetric).
- **M5 harsh shift** — ■ "The car jerks while switching gears in the lower gears" (tekmetric — **dual-read**:
  harsh shift OR engine buck under load; the lexicon routes it to `engine_misfire_or_bucking_feeling` with
  `needs-fact:transmission_behavior`, and the `jerks when shifting` keyword op does NOT treat it as clean
  trans evidence); "shifts hard," "slams into gear," "hard shift between 2nd and 3rd" (forum-paraphrase).
- **M6 no engagement** — ■ "VEHICLE STARTS BUT DOES NOT SHIFT INTO GEAR" (tekmetric); ■ "TOW IN DOES NOT SHIFT
  CLIENT STATES TRANSMISSION FAILED" (tekmetric); ■ "GETS STUCK IN PARK WILL HAVE TO GO BACK AND FORTH WITH
  SHIFTER TO GET INTO GEAR" (tekmetric); "won't go into gear," "car won't move," "drives forward but won't
  reverse" (synthetic).
- **M7 stuck / limp / pops out** — ■ "VEHICLE DOESNT GO OVER A CERTAIN SPEED / WENT INTO LIMP MODE. A LOT OF
  DASH BOARD LIGHTS CAME ON" (tekmetric); "stuck in gear," "won't shift out of 3rd," "pops out of gear on its
  own" (forum-paraphrase).
- **M8 flare** — "revs up between gears then catches" (forum-paraphrase).
- **M9 ATF leak** — ◧ "bright red puddle under the middle of my car" (existing catalog example; also an
  authored `eval-cases.json` line → provenance `eval-corpus`); ■ "TRANSMISSION COOLER LINE LEAKING"
  (tekmetric); "red oily drip toward the back" (synthetic).
- **M10 overheat** — ■ "TRANSMISSION HOT IDLE ENGINE LIGHT WAS COMING ON" (tekmetric).
- **M11 noise** — "whining noise that gets louder the faster i drive, in every gear" (synthetic), "grinding
  sound when i put it in reverse" (forum-paraphrase), "cvt whines like a turbo when i speed up"
  (forum-paraphrase).
- **Vague/mixed (route to needs-fact or multi)** — ■ "AAA TOW IN. POSSIBLE TRANSMISSION CONCERN." (tekmetric,
  vague → needs-fact); ■ "Car is not accelerating. The rpms only go to 3." (tekmetric); ■ "sounds like a jetski
  out of water… in reverse or drive… seems as if i am stepping on the gas" (tekmetric, mixed → `starting-charging`
  cross-system for the prior-battery thread).
- **Misspellings/idiom seen:** "trans," "tranny," "shuttering"/"shuddering," "jerks," "clunk into gear,"
  "limp mode."

Discipline note: "transmission" as a customer word is often **loose** — the style guide flags "transmission
for any drivetrain feel." So the lexicon marks bare-"transmission" phrasings that are really CV/diff/driveline
as `cross-system:driveline-cv-diff-awd` rather than letting them anchor a confident trans pick. Provenance is
labeled honestly: three highlighted examples above (◧) are existing DB catalog enrichment, not real corpus
voice, and are tagged `provenance: catalog` in the yaml.

---

## 5. Differential & discriminating questions  ← binds required_facts + the new slot

| # | Confusable pair | ONE best discriminating question | Answer → slot+value |
|---|---|---|---|
| D1 | **M1 trans slip ↔ engine low-power** (both → `performance`) | "When it's weak, does the **engine rev up higher than normal while the car doesn't speed up**?" | yes → `transmission_behavior=slipping`; no (revs stay low, just gutless) → engine-side (`low_power…`, no trans behavior) |
| D2 | **M2/M3 converter/CVT shudder ↔ M5 engine misfire** | "Does the shudder show up at **steady light-throttle cruise (~40 mph)** and clear when you change throttle (or tap the brake) — or does it get **worse under hard load / low RPM**?" [Gears/ATRA, Tier 2; brake-tap unlock per Halderman 6e, Tier 2] | cruise + clears on throttle/brake → trans (`shaking_when_speeding_up…`, `transmission_behavior=shudder_or_judder`); worse under load → `engine_misfire_or_bucking_feeling` |
| D3 | **M4 delayed engagement ↔ hesitation on tip-in** | "Is the delay **when you first put it in Drive/Reverse from Park**, or **while already moving when you press the gas**?" | in-gear-selection → `transmission_behavior=delayed_engagement`; while-moving → `hesitation_or_lag_when_accelerating` |
| D4 | **M9 ATF leak ↔ power-steering leak** (shared subcat) | "Is the red puddle **toward the middle/back under the car**, or **up front by the engine, with heavy/whining steering**?" | middle/rear → ATF (`fluid_under_car_location=under_middle/under_rear`); front + `steering_feel=heavy_or_hard_to_turn` → power steering (`steering-power-steering`) |
| D5 | **M9 red ATF ↔ neon-pink OAT coolant** | "Is it **thin/oily and slick** or **watery and bright neon, smelling sweet like syrup**?" | oily → `fluid_color=red_or_pink` (trans/PS); neon watery sweet → `green_orange_yellow_or_pink_puddle_coolant` |
| D6 | **M6/M7 no-shift/limp ↔ M1 slip** | "Does it **not move / not go over a set speed at all**, or does it move but **rev high without pulling**?" | won't move/capped → `transmission_behavior=no_engagement/stuck_in_gear` + `drivable_state`; moves but revs → `slipping` |
| D7 | **M2 shudder ↔ CV-axle acceleration shake** (cross-system) | "Any **grease on the inside of a front tire** or **clicking when turning tight**?" (CV cue) vs "does it track with **RPM/converter lockup at cruise**?" | CV cues → `driveline-cv-diff-awd` (`shaking…` already lists CV); no CV cues, cruise-locked → trans |
| D8 | **M11 transmission whine ↔ PS-pump whine** (cross-system, shared `high_pitched_whining_under_the_hood`) | "Does the whine **rise and fall with your road speed and stay there in gear**, or does it track **engine RPM and get worst when you turn the wheel**?" | road-speed / in-gear → trans (`noise_descriptor=whine`); engine-RPM / worst-on-turns → PS pump (`steering-power-steering`) |

**Slot consequence:** D1, D3, D6 (and M4/M5/M7/M8) cannot be answered by any of the 29 existing slots — none
encodes *how the transmission behaves*. `engine_running` covers misfire/surge/stall but has **no slip / no
delayed-engagement / no harsh-shift / no no-engagement** value, and mixing them in would corrupt an
engine-state slot. → This is the **`transmission_behavior` slot proposal (§9)**, which unlocks 4 existing
questions. D8's whine discriminator uses the existing `noise_descriptor` + `speed_band` slots (no new slot).

---

## 6. Warning lights & DTC surface

- **Check Engine / MIL** — a stored transmission DTC (P0700 informs the PCM; P0730/P0741/P0748/P0868-range,
  etc.) lights the generic CEL on most vehicles [SAE J2012, Tier 1, accessed 2026-07-18]. Customer names:
  "check engine light," "CEL." → existing `check_engine_light` warning-light subcat + `warning_light_named`.
- **Dedicated transmission-temp / "TRANS HOT" / "AT OIL TEMP" / red gear / gear-with-!** — some makes show a
  distinct trans-temp or transmission-fault telltale. Customer names: "transmission hot," "trans temp light,"
  "gear light." **GAP:** none of the 12 `warning_light` subcategories is a transmission light, and
  `warning_light_named` is free-text so it *can* capture "transmission" — but Stage-1 has no service that owns
  a trans warning light (transmission_testing's `concern_categories` excludes `warning_light`). → §8 P3 config op.
- **Limp mode = "a lot of dashboard lights on"** — corpus M7. Customer names it as multiple lights → maps to
  `warning_light_behavior = multiple_lights_at_once` and/or the `multiple_warning_lights_at_once` subcat.
  Solid/flashing semantics: a flashing CEL is a **misfire** severity cue, not trans — reinforces D2 (don't let
  a flashing CEL pull a shudder toward trans).
- **EPC light** (VW/Audi) — corpus "EPC LIGHT AND SHUTTERING" — electronic power control; customer-named as
  "EPC light" → `warning_light_named` free-text.

Feeds: `warning_light_named` value examples ("transmission," "trans temp," "EPC," "AT oil temp"),
`warning_light_behavior = came_on_then_off / multiple_lights_at_once`.

---

## 7. Confusable neighbors (cross-system)

1. **engine driveability (trans slip ↔ engine low-power)** — the dominant one (D1). Slip = engine revs
   *outrun* road speed; engine low-power = gutless *without* a rev/speed split. Both live in `performance`
   and both legitimately route to their own subcat; the fix is a Stage-1 hedge + the `transmission_behavior`
   slot so Stage-3 records the split. Neighbor dossier: **`engine-controls-driveability`**
   (`low_power_or_wont_accelerate_normally`). Emitted as `stage1.hedge.add` (transmission_testing ↔
   check_engine_light_testing).
2. **engine misfire (TCC/CVT shudder ↔ misfire)** — D2, ATRA discriminator. Neighbor dossier:
   **`engine-controls-driveability`** (`engine_misfire_or_bucking_feeling`). Emitted as
   `stage2.example.negative.add` on `shaking_when_speeding_up_or_going_uphill` (→ misfire).
3. **driveline / CV / driveshaft (acceleration shudder)** — D7. `shaking_when_speeding_up_or_going_uphill`
   *already* lists CV axle, driveshaft, U-joint AND torque converter as causes — so this subcat is a shared
   home; the discriminator is CV grease/clicking-on-turn vs cruise-locked converter shudder. Neighbor dossier:
   **`driveline-cv-diff-awd`**.
4. **steering-power-steering (red fluid)** — D4. Shared `red_or_pink_puddle…` subcat; discriminator is
   location + `steering_feel`. Emitted as `stage1.hedge.add` (transmission_testing ↔ power_steering_eps_testing).
5. **coolant (neon-pink OAT ↔ red ATF)** — D5. `fluid_color` bright-neon-watery-sweet vs oily-slick. Emitted
   as `stage2.example.negative.add` on `red_or_pink_puddle…` (→ `green_orange_yellow_or_pink_puddle_coolant`).
6. **differential/gear-oil (thick dark-brown, sulfur)** — a "leak under the middle/rear" can be diff, not
   trans; `thick_dark_brown_puddle_gear_or_differential_oil` owns the sulfur/near-black case; ATF is red and
   thinner. Emitted as `stage2.example.negative.add` on `red_or_pink_puddle…` (→ diff oil). Neighbor dossier:
   **`driveline-cv-diff-awd`**.
7. **steering-power-steering (whine)** — D8, M11. Trans gear/pump/CVT whine shares
   `high_pitched_whining_under_the_hood` with the PS pump; discriminator is road-speed/in-gear (trans) vs
   engine-RPM/worst-on-turns (PS). Neighbor dossier: **`steering-power-steering`**.
8. **body/electrical ("Shift to Park" message, gear-selector interlock)** — low-confidence edge; a pure
   "Shift to Park won't clear, engine off but electronics stay on" is body-electrical
   (**`body-electrical-accessories`**), but a driveability version labels `transmission_testing`. Route to
   `needs-fact` / multi rather than a confident trans pick.

`automatic-transmission.lexicon.yaml` marks each cross-system phrase `ambiguity: cross-system:<neighbor-dossier-slug>`.
Emitted-op summary (so the reader can diff §7 against `proposals.yaml`): pairs **#1 and #4** become
`stage1.hedge.add` ops; pairs **#2, #5, #6** become `stage2.example.negative.add` ops (D2 misfire, D5 coolant,
D6 diff-oil); pair **#3/#7/#8** are Stage-1 hedges-in-prose + lexicon cross-system tags (no dedicated op — the
shared subcats already list the neighbor cause). The whine reach (#7/M11) is carried by the P3 `noise` config
add.

---

## 8. Mapping to current taxonomy  ← binds catalog + subcategory proposals

| Failure mode | Current service | Current category | Current subcategory slug | Fit |
|---|---|---|---|---|
| M1 slipping | transmission_testing | performance | `low_power_or_wont_accelerate_normally` | **weak** — conflated with engine low-power; needs slot + hedge |
| M2 TCC shudder | transmission_testing | vibration | `shaking_when_speeding_up_or_going_uphill` | good (already lists converter) — sharpen; but service excludes `vibration` (P3) |
| M3 CVT judder | transmission_testing | vibration | `shaking_when_speeding_up_or_going_uphill` | weak — low-speed takeoff judder is off-description; sharpen; service excludes `vibration` (P3) |
| M4 delayed engagement | transmission_testing | performance | `hesitation_or_lag_when_accelerating` | **NO FIT** — that subcat is explicitly engine tip-in, not in-gear-selection delay |
| M5 harsh shift | transmission_testing | performance | — | **NO FIT** — no shift-quality subcat |
| M6 no engagement | transmission_testing | performance | — (falls to `low_power`) | **NO FIT** — "won't move / won't shift into gear / no reverse" has no home |
| M7 stuck/limp/pop-out | transmission_testing | performance | — (falls to `low_power`) | **NO FIT** |
| M8 flare | transmission_testing | performance | — | **NO FIT** |
| M9 ATF leak | (none owns leak) | leak | `red_or_pink_puddle_transmission_or_power_steering` | good — but transmission_testing's `concern_categories` excludes `leak`, so Stage-1 can't reach the trans service from a leak (P3) |
| M10 overheat/temp light | transmission_testing | warning_light | — | **NO FIT** + service excludes `warning_light` (P3) |
| M11 whine / reverse grind | transmission_testing | noise | `high_pitched_whining_under_the_hood` (whine); reverse-grind = no clean subcat | **weak/NO FIT** + service excludes `noise` (P3) |

**Proposals (Chris-gated where noted):**
- **P1 — NEW subcategory `harsh_delayed_or_no_shift`** (category `performance`). Covers M4/M5/M6/M7/M8: harsh/
  bang shifts, delayed engagement, no engagement / won't move / no reverse, stuck-in-gear / won't-shift /
  pops-out-of-gear, flare. Demand: ≥8 distinct corpus lines ("DOES NOT SHIFT INTO GEAR," "GETS STUCK IN PARK,"
  "TOW IN DOES NOT SHIFT," "jerks while switching gears," "went into limp mode," etc.). Why existing
  insufficient: `low_power` (sustained weakness) and `hesitation` (engine tip-in) both explicitly exclude
  shift-selection/harsh-shift behavior in their own descriptions — these lines are being force-fit today.
- **P2 — NEW subcategory `transmission_slipping`** (category `performance`) *(lower priority / Chris-gated)*.
  Split M1 out of `low_power`. Interim: if not split, the `transmission_behavior` slot + D1 hedge already
  disambiguate within `low_power`.
- **P3 — CONFIG: expand `transmission_testing.concern_categories`** from `[performance]` to
  `[performance, vibration, leak, warning_light, noise]` *(Chris-gated service-config change)*. Without this,
  even a correctly-worded transmission shudder (vibration), leak (leak), trans-temp-light (warning_light), or
  gear/CVT whine (noise) complaint cannot reach the trans service at Stage-1. (Service-row edit, not a new
  service — filed as a `catalog.service.propose` revision.)
- **P4 — Fill `transmission_testing.example_keywords[]`** (currently EMPTY) — the single highest-leverage
  Stage-1 fix; see `proposals.yaml` `stage1.keyword.add` ops.

---

## 9. Fact-slot audit

**Slots this system uses today (of the 29):** `speed_band`, `speed_specific_mph`, `onset_timing`,
`started_when`, `fluid_color`, `fluid_under_car_location`, `steering_feel`, `warning_light_named`,
`warning_light_behavior`, `drivable_state`, `customer_request_type`, `recent_action`, `noise_descriptor`
(M11). `engine_running` touches the edge (surge/stall) but does **not** hold transmission behavior.

**Values customers actually state (corpus evidence):**
- `onset_timing`: `when_accelerating` ("when I give it gas"), `cold_start`/`at_startup` ("after sitting"),
  `intermittent`/`always`.
- `speed_band`: `low_speed` (takeoff judder, delayed engagement), `mid_speed`/`specific_mph` (~40 shudder,
  "won't go over a certain speed").
- `fluid_color = red_or_pink`; `fluid_under_car_location = under_middle/under_rear`.
- `drivable_state = not_drivable_needs_tow` ("TOW IN," "won't move").
- `warning_light_behavior = came_on_then_off` ("light was coming on, not on now"),
  `multiple_lights_at_once` ("a lot of dashboard lights on").
- `noise_descriptor = whine/grinding` (M11).

**Missing (the gap):** no slot encodes **transmission behavior**. Four existing questions ask for it and
carry EMPTY `required_facts` (verified in `catalog-snapshot.json` 2026-07-18, so the wizard always re-asks):
**q995** (shift into D/R hesitate/slip/rough), **q168** (trans slipping/shifting strangely with the shake),
**q1183** (engine revs high but car doesn't speed up), **q1186** (stuck in a lower gear / held back). Any
questions the *proposed* `harsh_delayed_or_no_shift` subcat would carry are additional but are NOT counted
toward the threshold (that subcat is not yet approved).

**PROPOSED NEW SLOT — `transmission_behavior`** (≥3-question rule satisfied by the **4 existing** questions
above): values `slipping`, `delayed_engagement`, `no_engagement`, `harsh_or_hard_shift`, `shudder_or_judder`,
`flaring_between_shifts`, `stuck_in_gear`, `pops_out_of_gear`, `shifts_erratically`, `normal`.
> Boundary fix (verifier issue 7): the earlier draft had both `stuck_in_gear` and `wont_shift_out_of_gear`,
> whose cues collided ("won't shift out of 3rd" vs "won't shift out of gear" are the same complaint). They are
> **merged into `stuck_in_gear`**; `pops_out_of_gear` is the OPPOSITE failure (won't stay in gear) and never
> shares a cue. A bare speed cap ("won't go over a certain speed") is **removed** from `stuck_in_gear` cues —
> it is not a literal transmission behavior (could be engine limp / fuel starvation / clogged cat); it sets
> `stuck_in_gear` only when paired with a named mode ("went into limp mode").

Literalness guarded — each value has verbatim `literal_cues` (see `proposals.yaml`); e.g. `slipping` fires
only on an explicit rev/speed-split ("revs but doesn't go," "revs high but doesn't speed up," "slips in
gear"), NOT on a bare "no power." Also proposes 2 `warning_light_named` example values ("transmission,"
"trans temp / AT oil temp").

**Also flagged (backlog, not proposed):** a `fluid_condition` slot (burnt-smell / dark ATF) would help M10
but only ~1–2 questions need it today → below the ≥3 threshold; log for Chris.

---

## 10. Sources

Diagnostic (Tier 1/2 — only sources actually relied on; paywalled ATSG/Sonnax manuals were NOT accessed and
are deliberately not cited, per source-policy.md):
- **Halderman, *Automotive Technology* (6e)** — architectures; slip / flare / delayed-engagement / harsh-shift
  / no-engagement / leak / CVT-judder / transmission-noise fundamentals; TCC releases on brake application.
  Standard curriculum textbook. Tier 2, accessed 2026-07-18.
- **Gears Magazine (ATRA), "Shudder Diagnosis"** — TCC lockup windows (35–45 mph 3rd/4th; 10–15 mph 2nd) and
  the misfire-worse-under-load vs TCC-shudder-at-light-throttle-cruise discriminator ONLY.
  https://gearsmagazine.com/magazine/shudder-diagnosis/ — Tier 2, accessed 2026-07-18.
- **SAE J1930** — standardized terminology (torque converter clutch, TCM). Tier 1, accessed 2026-07-18.
- **SAE J2012** — DTC definitions (P0700 PCM-informing; P0730/P0741/P0748/P0868 transmission-range).
  Tier 1, accessed 2026-07-18.

Linguistic (corpus, never cited for diagnosis):
- `scheduler-app/scripts/eval/real-concerns-tekmetric-labeled-v2.json` (500 labeled) — provenance `tekmetric`.
- `eval-cases.json` (145 authored) — provenance `eval-corpus`.
- `real-concerns-forums.json` — paraphrased only, provenance `forum-paraphrase`.
- Existing DB subcategory enrichment (`positive_examples`) — provenance `catalog` (authored, live; not raw corpus).

---

## 11. Binding-readiness self-check (Gate-G2)

- [x] Every §3 failure mode cites Tier 1/2 (Halderman / Gears-ATRA / SAE), with access dates. Paywalled
      ATSG/Sonnax cites removed (not accessed); the brake-tap-unlocks-TCC claim is attributed to Halderman
      (TCC control), and the Gears/ATRA cite is limited to the mph windows + misfire-vs-shudder discriminator
      it was verified to contain.
- [x] Every §5 differential names the exact fact slot + value; slot gaps escalated to a single, ≥3-question
      slot proposal (`transmission_behavior`, satisfied by 4 existing questions — not overstated).
- [x] Positive examples are corpus-first; the three corpus+synthetic COMPOSITES are now flagged
      `provenance: synthetic` in the yaml (not `tekmetric`), and existing catalog enrichment is flagged
      `provenance: catalog` — so the synthetic/authored share is honestly represented and stays well under
      30% real-voice-per-subcat.
- [x] Every negative example in `proposals.yaml` names `routes_to`; negatives that target the PROPOSED
      `harsh_delayed_or_no_shift` slug are marked `gated: true` + `depends_on` so they don't dangle if P1 is
      rejected.
- [x] Synonyms are ≥2 tokens or domain tokens (CVT, ATF, TCC, limp mode); no bare "noise/leak/light."
- [x] Literalness respected — `slipping` needs an explicit rev/speed split, not "no power"; the bare speed-cap
      cue was removed from `stuck_in_gear`; the golden inference-traps leave `drivable_state`/`engine_running`
      NULL when the customer didn't state them.
- [x] Catalog/subcategory changes (P1/P2/P3) marked Chris-gated; no assumed additions. Stage-1 hedges whose
      `discriminating_fact` is the proposed slot carry `depends_on`.
- [x] ≥8 golden cases incl. 2 inference-traps + 1 null-route; each config-dependent case carries an explicit
      `config_dependency` marker (L5/P1/P3) so Wave C excludes it from the current-config eval until the
      referenced op lands (the eval harness validates stage2-under-primary-stage1 and fact-slot existence).
- [x] US-market calibration; Euro-only (DSG software specifics) not over-weighted.
- Residual gaps logged: trans-temp warning-light home (P3/§6), reverse-gear-grind has no clean `noise` subcat
  (P3 `noise` add is the reach fix; a dedicated subcat is a possible future proposal), `fluid_condition` slot
  (below threshold). The manual-clutch neighbor **is** built (`manual-trans-clutch` under `systems/`) — no gap.
