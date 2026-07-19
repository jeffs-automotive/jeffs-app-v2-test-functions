# Requests, maintenance & situational router — Wave B router dossier
slug: router-requests-maintenance   date: 2026-07-18
owns_confusable_pairs: [taxonomy §5 #9 (tire-buying gap); the 6 `other/*` situational-override boundaries; the NON-CONCERN work-order null-route]
binds_categories: [other, tires]   binds_services: [none — this router routes AWAY from services, to situational buckets / advisor / null]
consumes: [wheels-tires-tpms-bearings, brakes-friction-hydraulic, engine-lubrication-oil, hvac-climate, body-glass-water-leaks-keys, airbag-srs-restraints, starting-charging, air-induction-forced-induction, automatic-transmission, cooling-system, adas-driver-assist]

> **What a per-system dossier cannot own.** Every Wave-A dossier classifies a *symptom*. This router owns
> the language that is **NOT a symptom** — a request, a maintenance line, a work-order fragment, or a
> *situation* the customer ties the symptom to. Three of the scheduler's hardest-measured failure modes
> live here: (1) the **six `other/*` situational buckets** and the **PRIORITY-ORDER override** that lets a
> situational cue beat a symptom keyword when causally tied (taxonomy §3b); (2) the **NON-CONCERN
> work-order rejection** — ~24% of the Tekmetric concern channel is shop-DOES-this noise, not
> customer-DESCRIBES-a-problem — which must **null-route** (empty Stage-1, no guessed service); (3) the
> **tire-buying gap** (`just_want_new_tires` / `dry_rot_sidewall_cracking` → advisor quote, no bookable
> service). It also owns the **`customer_request_type`** fact-slot discipline that colors all three.

---

## 1. Scope & boundaries

**In scope (this router owns the routing decision):**

- The **6 situational `other/*` buckets** (Stage-1 keys, route to advisor, no test/fee): `multiple_symptoms_not_sure_what_category`, `after_a_recent_accident_or_impact`, `after_recent_service_or_repair_work`, `safety_concern_dont_feel_safe_driving_it`, `general_check_up_or_pre_trip_inspection`, `car_has_been_sitting_unused_for_a_long_time`.
- The **PRIORITY-ORDER situational-cue override** (causally-tied cue beats symptom keyword) and the mirror rule — a cue *mentioned in passing* does NOT override a specific testable symptom.
- The **NON-CONCERN / work-order null-route** (empty Stage-1 → advisor handoff, no guessed service).
- The **tire-buying gap** — pure tire-replacement requests and age/dry-rot tires that have **no bookable service** (`tire_repair` explicitly excludes them).
- The **`customer_request_type`** fact slot (7 enum values) — its literal cues, and how the *request type* colors routing WITHOUT overriding a named symptom.

**OUT of scope (a neighbor owns the actual classification once we route INTO a system):**

| Once we've decided it IS a real symptom… | …the owning dossier classifies it |
|---|---|
| any named mechanical/electrical symptom | the matching Wave-A system dossier |
| noise/vibration descriptor disambiguation | `router-nvh` |
| fluid puddle color/location | `router-leaks` |
| smoke color + smell | `router-smoke-smells` |
| which dash light + solid/flashing | `router-warning-lights` |
| won't-start branch (click/crank-no-fire/silent) | `router-no-start-power` |
| the tire *symptom* subcats (puncture/TPMS/balance/bearing) | `wheels-tires-tpms-bearings` (owns taxonomy §5 #6) |

**The boundary rule of thumb:** *this router fires when the customer's utterance is dominated by a
REQUEST, a MAINTENANCE/WORK-ORDER line, or a SITUATION — not by a describable symptom the shop can test
for.* The moment a specific, testable symptom is clearly described and NOT causally pinned to a
situation, control passes back to the symptom dossiers/routers.

**The two exit routes this router produces (do not conflate them):**

- **`advisor_handoff`** — Stage-1 returns a situational `other/*` key (there IS a subcategory match: one
  of the six buckets). The customer described a *situation*; a human advisor takes it. Non-empty Stage-1.
- **`null_match`** — Stage-1 returns `[]` (nothing fits: a bare work-order line, a greeting, a
  price/hours question, an off-topic ask, or the tire-buying gap). Empty Stage-1; the system forwards to
  an advisor with **no** guessed service. The tire-buying gap is a `null_match` that also records a
  `latent_subcategory` in the `tires` pool (see §5.4).

---

## 2. The routing decision tree (the signature deliverable)

Read top-to-bottom; **first match wins**. This is the machine-form table's human mirror; the row-level
version lives in `binding/requests-and-situational-routing.md`.

```
CUSTOMER FREE TEXT
│
├─ 0. NOT A VEHICLE CONCERN? (greeting, hours/price, hiring, reschedule, off-topic referral,
│     gibberish, <~5 useful words, a bare phone#/address/name/deadline line)
│        → route: null_match   (Stage-1 = [])            [tkc-008/026/043/095/152/170/187/190/191/201; null-01..12]
│
├─ 1. BARE WORK-ORDER / SERVICE-REQUEST LINE? (names an ACTION to perform, NO described symptom:
│     "rack replacement", "replace front wheel hub", "CHECK ALIGNMENT", "recharge a/c",
│     "oil change", "reset oil maint light", "Previously declined> …", "23-pt inspection + rotation",
│     "State Inspection / Emissions", "Tire Rotation & Balance", "REPLACE … BULB")
│        → route: null_match   (Stage-1 = [])   NON-CONCERN rejection rule
│        EXCEPTION: a request that ALSO describes a symptom ("AC recharged 2 mo ago, now blowing hot
│        again") is a REAL concern → fall through to the symptom path. Do NOT let the work-order
│        framing swallow a stated symptom.
│
├─ 2. TIRE-BUYING / DRY-ROT REQUEST? (wants NEW tires, or names aged/dry-rotted/cracked-sidewall
│     tires as the thing to replace — NO repairable puncture, NO diagnostic complaint)
│        → route: null_match   (Stage-1 = [])   latent_subcategory ∈ {just_want_new_tires,
│          dry_rot_sidewall_cracking}   THE TIRE-BUYING GAP (no bookable service today; §5.4)
│        set fact: customer_request_type = just_get_new_tires  (only if literally a replacement ask)
│
├─ 3. SITUATIONAL CUE CAUSALLY TIED TO THE SYMPTOM?  (PRIORITY-ORDER rule — scan the WHOLE text FIRST;
│     the cue must be the STATED CAUSE: "after X, now Y" / "since X, still Y" / "ever since the work")
│     │
│     ├─ 3a. RECENT SERVICE/REPAIR/PART WORK as the stated cause / still-broken-after-work
│     │        → after_recent_service_or_repair_work        (route: advisor_handoff)
│     │        [tkc-000/013/037/084/146/196/220/227/258/260; other-postservice-1/2]
│     ├─ 3b. RECENT ACCIDENT / IMPACT / POTHOLE / CURB as the stated cause
│     │        → after_a_recent_accident_or_impact          (route: advisor_handoff)
│     │        [tkc-088/251; other-accident-1/2]
│     ├─ 3c. EXPLICIT SAFETY FEAR / told-not-to-drive / total loss of a safety system
│     │        → safety_concern_dont_feel_safe_driving_it   (route: advisor_handoff)
│     │        [tkc-255 "brakes gave out"; other-safety-1/2]
│     ├─ 3d. CAR HAS BEEN SITTING UNUSED (long storage as the framing)
│     │        → car_has_been_sitting_unused_for_a_long_time (route: advisor_handoff)
│     │        set fact: recent_action = car_sat_unused      [tkc-118; other-sitting-1/2]
│     ├─ 3e. GENERAL CHECK-UP / PRE-TRIP / WELLNESS / peace-of-mind / just-bought once-over
│     │        → general_check_up_or_pre_trip_inspection     (route: advisor_handoff)
│     │        set fact: customer_request_type = pre_trip_inspection (if a trip is named)
│     │        [tkc-005/020/029/046/048/104/242; other-checkup-1/2]
│     └─ 3f. MULTIPLE co-equal symptoms, no single primary / "not sure what's wrong"
│              → multiple_symptoms_not_sure_what_category    (route: advisor_handoff)
│              [tkc-034/090/130/162/198/217; other-multi-1/2]
│     │
│     └─ 3g. CUE + a SPECIFIC testable symptom BOTH clearly present, causally linked?
│              → return the situational key FIRST + the testing service SECOND (2-candidate clarify),
│                never silently drop either.
│
├─ 4. CUE MENTIONED ONLY IN PASSING + a specific testable symptom? (tow-in THEN a symptom;
│     "was at the dealer" as backstory; a prior unrelated repair)
│        → route the SYMPTOM to its service; do NOT fire the situational bucket.
│        ("tow in, does not shift" → transmission_testing;  "tow in" ALONE → advisor bucket)
│
└─ 5. Otherwise → hand to the symptom dossiers/routers (out of this router's scope).
```

### The `customer_request_type` overlay (colors, never overrides)

A **request type** is a *fact*, not a route. A customer who NAMES a system/symptom routes to that
**system's service** even when they frame it as a request — the fact just records the ask:

| Utterance | Route | `customer_request_type` |
|---|---|---|
| "dealer said I need rear brakes, want them checked" (tkc-003/110/156) | `brake_inspection` | `fix_a_known_problem` |
| "was told wheel bearings needed, want a **second opinion**" (tkc-102) | `suspension_steering_check` | `second_opinion` |
| "I want a **new battery**" (named part, no symptom) | null_match (work-order) OR `charging_starting`/`battery_test` if a symptom is present | `replace_specific_part` |
| "**oil change** / 3000-mile service" (tkc-208) | null_match (maintenance) | `routine_maintenance` |
| "wellness check, driving to Boston" (tkc-005) | `general_check_up_or_pre_trip_inspection` | `pre_trip_inspection` |
| "quote for **4 new tires**" (tkc-138) | null_match — tire-buying gap | `just_get_new_tires` |

**Rule:** a *named diagnosable symptom/system* keeps control at that system (the request type is
metadata). A *bare request with no symptom* is a work-order null-route. Only a *situation* wins the
`other/*` bucket. **Literalness** (§4) governs when the slot may be set at all — booking language
("do we need an appointment?", "give me a call") NEVER sets `customer_request_type`.

---

## 3. Situational-cue override rules (the PRIORITY-ORDER contract)

Source of truth: the live Stage-1 prompt (`diagnose-concern.ts` §"PRIORITY-ORDER rule" + §"NON-CONCERN
rejection rule"). This router documents, sharpens, and supplies training evidence for it.

1. **Causal tie is mandatory.** A cue overrides a symptom keyword ONLY when the customer connects the
   symptom to the situation: *"after X, now Y"*, *"since X it Y"*, *"ever since the work, still Y"*. A cue
   merely mentioned in passing (the car was towed in; they were at a dealer; a prior unrelated repair)
   does **not** override a specific, testable symptom. Corpus witnesses:
   - **Overrides** (cue = stated cause): tkc-037 "CLIENT STILL REPORTING BRAKE SQUEAL. WE REPLACED REAR
     BRAKES … LAST SERVICE" → `after_recent_service_or_repair_work`; tkc-196 "vehicle overheated **after**
     valve cover replacement" → same; tkc-088 "slid into a curb/sidewalk … **now** hears a rotational
     thumb" → `after_a_recent_accident_or_impact`.
   - **Does NOT override** (cue in passing): tkc-016 "ISOLATE NOISE WHEN TURNING … (Carmax already
     replaced right front strut and …)" — the fresh, testable symptom leads; the prior repair is
     backstory. tkc-119 "TOW IN. CLIENT WAS TAKING A TURN AND HEARD NOISE. NOW HEARS METAL ON METAL" — a
     specific symptom follows the tow → route the symptom.

2. **Two-candidate clarify when BOTH a cue and a symptom are clearly present and linked.** Return the
   situational key first, the testing service second — never silently drop either (Stage-1 decision rule
   #g). Example: tkc-260 "check engine light came back on **after repairs** done last month" →
   `[after_recent_service_or_repair_work, check_engine_light_testing]`.

3. **Safety fear is its own override.** An explicit "brakes gave out" / "NO BRAKE PRESSURE" / "DO NOT
   DRIVE" / "scared to drive it" is `safety_concern_dont_feel_safe_driving_it`, **not** a routine
   brake/warning-light case — a total loss of a safety system is not an inspection. BUT a *named,
   diagnosable* symptom plus a passing "is it safe to drive?" stays at the symptom (the safety question
   alone does not override a named light/symptom — see airbag dossier §7).

4. **Tow-in alone → advisor; tow-in + symptom → the symptom.** "vehicle towed in" / "tow in" with only a
   vague "won't run" routes to the advisor (`multiple_symptoms_not_sure_what_category`); "tow in, no
   brakes, brake fluid empty" routes the brake concern. The tow is *how the car arrived*, not the concern.

5. **NON-CONCERN work-order rejection (null-route).** If the text names an ACTION to perform with NO
   described symptom, return `candidates: []`. This is the single largest null-route class in the corpus
   (see §4). It is a **`null_match`**, distinct from the situational `advisor_handoff` — there is no
   subcategory, so a `stage2.example.negative.add` (which REQUIRES a `routes_to` slug) cannot express it;
   it is trained via **golden null-route cases** (`route: null_match`, empty Stage-1) instead.

6. **Regulatory inspection vs wellness check.** A bare regulatory line — "State Inspection", "State
   Inspection and Emissions", "Reinspection" (tkc-192/212/287) — is a **bookable service line →
   null_match** (the shop just books it; no diagnosis). A **general/pre-trip/wellness once-over** ("just
   want a general checkup", "wellness check … driving to Boston", "just bought it, want an overall check
   up") → `general_check_up_or_pre_trip_inspection`. The discriminator is *regulatory-service-line* (null)
   vs *open-ended condition assessment* (bucket). "Annual/yearly inspection" is borderline and consensus-
   labeled to the bucket when framed as a general check (tkc-046/163) — hedge (§5.5).

---

## 4. Customer-voice cues (the linguistic authority)

Full machine list is embedded in the proposals `lexicon`-style negatives + golden cases. Real Tekmetric
voice, grouped by the route it should take. **Provenance: `tekmetric` unless flagged.**

### 4a. NON-CONCERN work-order lines → `null_match` (the ~24% noise)
- **`Previously declined>` prefix** — the dominant machine tell: "Previously declined>Remove Replace Spark
  Plugs" (tkc-007/024/131), "Previously declined>REPLACE AIR FILTER" (tkc-015), "…REPLACE CABIN AIR
  FILTER" (tkc-062/101), "…BRAKE SYSTEM FLUSH" (tkc-074/168), "…TIRE PROTECTION PLAN" (tkc-159), "…REPLACE
  BATTERY. BATTERY TESTING BAD" (tkc-250), "…Remove & Replace Fog Lamp Bulb" (tkc-177).
- **Bare action lines:** "rack replacement" (tkc-108), "Replace front wheel hub - drivers side"
  (tkc-017), "RESET OIL MAINT LIGHT (Not due yet)" (tkc-011), "Have the alignment checked and re aligned
  if needed" (tkc-132), "Tire Rotation & Balance" (tkc-060), "valve cover removal inspect for engine
  damage" (tkc-155), "Check rear hatch operation" (tkc-185).
- **Maintenance / scheduling:** "Oil Change full syn" (tkc-183), "Need 3000-mile service" (tkc-208),
  "$74.95 Synthetic Oil Change … 23 Point Inspection … Tire Rotation" (tkc-142).
- **Regulatory-service lines:** "State Inspection and Emissions" (tkc-287), "State inspection" (tkc-212),
  "Reinspection. Already passed Emissions…" (tkc-192).
- **Pure logistics / off-topic:** "Will pay over phone & p/u after hours" (tkc-008), "375 Keystone Ave"
  (tkc-026), "needs by 11am 6/13" (tkc-043), "NEEDS BACK BY END OF DAY" (tkc-152), "in a meeting from
  10-11am" (tkc-191), contract-number blocks (tkc-095). Authored: "hi"/"help"/gibberish/hours/price/
  hiring/reschedule/body-shop-referral (null-01..12).

### 4b. Situational cues → `advisor_handoff` (the six buckets)
- **Recent-service:** "…SINCE BLOWER MOTOR REPAIR" (tkc-000), "Check engine light ON AFTER SERVICE"
  (tkc-084), "CEL ON AFTER SERVICE" (tkc-258), "multiple repairs completed still misfiring" (tkc-220),
  "A/C NOT BLOWING COLD. WE SERVICED RECENTLY" (tkc-227), "TESTING AUTH … if not related to work we just
  did" (tkc-179). Authored: "brakes done at another shop last week and now there's a grinding worse than
  before" (other-postservice-1).
- **Recent-accident:** "slid into a curb/sidewalk … hears a rotational thumb" (tkc-088), "SHE WAS IN
  ACCIDENT RECENTLY" (tkc-251). Authored: "Got rear ended last weekend … drives different now"
  (other-accident-1), "hit a really bad pothole … front end feels off" (other-accident-2).
- **Safety-fear:** "The brakes gave out on our 2011 Nissan Frontier" (tkc-255). Authored: "don't feel
  safe driving it anymore. im scared" (other-safety-1).
- **Car-sitting:** "CLIENT HAD TO JUMP START VEHICLE (Sat for awhile)" (tkc-118). Authored: "been sitting
  in his garage for about two years" (other-sitting-1), "sat outside all winter w/o being driven"
  (other-sitting-2).
- **General/pre-trip:** "'wellness check' as I'll be driving to Boston" (tkc-005), "GENERAL CHECK OVER
  TRIP" (tkc-020), "annual inspection, inspection for a road trip" (tkc-029), "FACTORY WARRANTY EXPIRING
  (Wants to make sure everything ok)" (tkc-048), "just purchased a used 2010 Ford Focus … overall check
  up" (tkc-242). Authored: "driving to Florida next month … once over" (other-checkup-1).
- **Multiple-symptoms:** "4 lights appeared this morning" (tkc-090), "entire dashboard lit up … engine,
  TPS, brakes, cruise" (tkc-130), "A/C not cooling … Also Oil change" (tkc-122), "tires and oil leak"
  (tkc-198), "Coolant leak, window motor stuck, oil change and many more" (tkc-151). Authored: "rattle
  over bumps, the heat smells funny, and the steering…" (other-multi-1).

### 4c. Request-type language (a fact overlay, route to the named system unless bare)
- **Told-by-another-shop / fix-known:** "Was told be dealer needs rear brakes" (tkc-003), "WAS TOLD BY
  DEALER BRAKES GETTING LOW" (tkc-110). → `fix_a_known_problem`, route the named system.
- **Second-opinion:** "was told wheel bearings were needed wants second opinion" (tkc-102). →
  `second_opinion`, route `suspension_steering_check`.
- **Replace-specific-part:** "Replace battery and secondary battery" (tkc-203, with a start symptom →
  charging), "I want a new battery" (bare → work-order null). → `replace_specific_part`.
- **Just-bought:** "JUST BOUGHT VEHICLE AND WANTS TO MAKE SURE COOLANT NOT LEAKING (No issues)"
  (tkc-189) — no symptom → general check-up bucket (peace-of-mind), NOT coolant_leak_testing.

### 4d. Tire-buying gap → `null_match` + `latent_subcategory`
- "4 NEW TIRES AND ALIGNMENT (would like entry level tire)" (tkc-138), "TIRE REPLACEMENT" (tka-125),
  "TIRE REPLACE IF NEEDED CHECK CONDITION OF REMAINING" (tka-169). Synthetic: "sidewalls are all cracked,
  tires are old and dry-rotted". → `latent_subcategory` = `just_want_new_tires` / `dry_rot_sidewall_cracking`.

**Messiness preserved:** all-caps work-order voice, the `Previously declined>` machine prefix,
parenthetical advisor asides "(Test fuses as courtesy)", misspellings ("ROATIONAL", "LOOSING"),
deadline/logistics fragments, and diagnosis-echo ("dealer said…"). These are exactly what the classifier
sees; they are training signal, not to be cleaned up.

---

## 5. Differential & discriminating questions (the confusable pairs this router owns)

Each row: the ONE best discriminator + the fact slot/value that resolves it. Machine form (with
`examples_a`/`examples_b`) is in the proposals `confusable_matrix_rows`.

### 5.1 Work-order line (null_match) ↔ real symptom concern
- **Discriminator:** "Is the customer *describing a problem the car is having*, or *naming a job for us to
  do*?" A described symptom (a noise, a leak, a feel, a light behaving) = concern; a bare action verb
  ("replace…", "reset…", "flush…", "rotate…", "inspect…") with no symptom = work-order → `null_match`.
- **Slot:** `customer_request_type` ∈ {`replace_specific_part`, `routine_maintenance`} with **all
  symptom slots null** → null-route. A symptom slot set (noise/smell/pedal/light-behavior/…) pulls it
  back to a concern. **Guard:** the "…ALSO a symptom" exception (tkc-227 "we serviced recently, still not
  cold") — a symptom present flips it to a real concern (here a situational one).

### 5.2 Situational bucket (advisor_handoff) ↔ the underlying symptom service
- **Discriminator:** "Is the customer pinning the symptom to a *situation as its cause* (after work /
  after impact / been sitting), or just describing a *fresh testable symptom* the situation is only
  backstory to?" Causal tie → bucket; passing mention → the service.
- **Slots:** `recent_action` (`general_service` / `accident_or_impact` / `hit_pothole_or_curb` /
  `car_sat_unused`) **plus causal-framing language**. The fact alone is not enough — the override turns on
  the customer's *causal claim*, not the mere presence of the recent action.

### 5.3 Regulatory inspection (null_match) ↔ general/pre-trip check-up (advisor_handoff)
- **Discriminator:** "Is this a *specific regulatory service line* the shop just books (state inspection,
  emissions, reinspection), or an *open-ended 'look the car over' request* (wellness / pre-trip /
  peace-of-mind / just-bought)?"
- **Slot:** `customer_request_type` = `pre_trip_inspection` (trip named) or the open-ended framing →
  bucket; a bare regulatory noun-phrase with no condition-assessment intent → `null_match`.

### 5.4 Tire-buying gap: `just_want_new_tires` / `dry_rot_sidewall_cracking` (advisor) ↔ `tire_repair` (repairable damage)
- **Discriminator:** "Do you want us to *fix/patch a specific tire* (a nail, a screw, it's losing air), or
  do you want *new tires* (they're worn out / old / dry-rotted)?"
- **Slots:** `tire_state=visible_damage`/`low_pressure`/`flat` **and** repair intent → `tire_repair`
  (owned by wheels dossier). `customer_request_type=just_get_new_tires` OR `tire_state=sidewall_cracking`
  → **the tire-buying gap: `null_match` + `latent_subcategory`** (no bookable service; `tire_repair`
  explicitly excludes worn/aged tires and sidewall damage). **Coordination:** `wheels-tires-tpms-bearings`
  owns taxonomy §5 #6 (tire_repair ↔ tpms ↔ suspension) and proposes the Chris-gated
  `tire_sales_consultation` service; this router owns §5 #9 (the buying-vs-repair boundary + the
  null-route training). The two do not overlap — do not re-propose the service here.

### 5.5 Multiple-symptoms bucket ↔ a single dominant symptom
- **Discriminator:** "Is there *one clear primary* symptom (route it) or *several co-equal* problems with
  no primary / an explicit 'not sure what's wrong'?" Multiple co-equal, or a dash "Christmas tree" the
  customer can't parse → `multiple_symptoms_not_sure_what_category`. One dominant symptom with minor
  asides → route the dominant one. (Overlaps `router-warning-lights` for the multi-light case:
  `warning_light_behavior=multiple_lights_at_once` → that router's `multiple_warning_lights_at_once`
  subcat; a *cross-category* symptom mix with no lights framing → this bucket.)

### 5.6 Safety-fear bucket ↔ a named diagnosable symptom + "is it safe?"
- **Discriminator:** "Does *fear dominate with no diagnosable symptom named* (→ safety bucket), or is
  there a *named, testable symptom* and the safety question is a passing add-on (→ route the symptom)?"
- **Slot:** `drivable_state` (`drivable_but_concerned`/`not_drivable_needs_tow`/`stranded_now`) +
  absence of a named symptom → safety bucket; a named symptom keeps control at the system. (Airbag
  dossier §7 anchors the "named light + passing safety Q stays at the light" side.)

---

## 6. Sources

This is a **routing/linguistic** router, not a diagnostic one — its authority is (a) the live scheduler
contract and (b) the customer corpus. No Tier 1/2 diagnostic claims are made here; where a diagnostic
boundary is invoked (e.g. dry-rot = replacement not repair) it is *cited to the owning Wave-A dossier*,
not re-derived.

**Contract authority (the routing rules this router documents):**
- `scheduler-app/src/lib/scheduler/wizard/llm/diagnose-concern.ts` — Stage-1 "PRIORITY-ORDER rule",
  "NON-CONCERN rejection rule", decision rules #1–#9, and the Stage-3 literalness discipline (negative
  worked examples #6–#8: booking language ≠ `customer_request_type`).
- `scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts` — the `customer_request_type` enum (7
  values), `recent_action` (incl. `car_sat_unused`, `accident_or_impact`, `general_service`), and
  `drivable_state`.
- `00-current-scheduler-taxonomy.md` §3b (the 6 situational buckets), §5 (#9 tire-buying gap; #6 owned by
  wheels), §6 (fact slots).

**Linguistic authority (never cited for diagnosis):**
- Tekmetric corpus `real-concerns-tekmetric-labeled-v2.json` — situational-bucket consensus labels
  (94 cases) + the 136 `None`-consensus work-order/null lines (tkc IDs cited inline in §4).
- `eval-cases.json` — the authored `other-*` bucket cases (12) + the `null-01..12` null-route cases +
  the tire-buying-gap authored cases.
- NHTSA ODI narrative *patterns* (paraphrased, `nhtsa`) and forum *patterns* (`forum-paraphrase`) only
  where a corpus witness was thin; synthetic flagged and ≤30%.

**Consumed Wave-A dossiers** (for the boundary cross-refs): `wheels-tires-tpms-bearings` (tire-buying
gap + §5 #6), `airbag-srs-restraints` (safety-Q-vs-named-light + accident/recent-service overrides),
`brakes-friction-hydraulic`, `engine-lubrication-oil`, `hvac-climate`, `body-glass-water-leaks-keys`,
`starting-charging` (car-sat-unused → jump/no-start boundary), `air-induction-forced-induction` +
`cooling-system` + `automatic-transmission` (their work-order/maintenance null-route ops).

---

## 7. Binding-readiness self-check

| Check | Status |
|---|---|
| Every confusable pair I own has a discriminator + fact slot | PASS (§5.1–§5.6; machine rows in proposals) |
| Every negative example names `routes_to` (subcat slug) | PASS — and null-routes (no slug) are trained via golden `null_match` cases, NOT negatives (they can't name a `routes_to`) |
| Situational overrides trace to the live PRIORITY-ORDER rule + a corpus witness | PASS (§3, tkc IDs) |
| The two exit routes (`advisor_handoff` vs `null_match`) kept distinct | PASS (§1, §2) |
| `customer_request_type` literalness respected (booking language ≠ slot) | PASS (§2 overlay, §3 rule 5; mirrors diagnose-concern negative examples #6–#8) |
| Tire-buying gap owned without re-proposing the wheels service | PASS (§5.4 coordination note) |
| ≥8 golden cases incl. ≥1 inference-trap + ≥1 null-route | PASS (16 cases in proposals: 6 situational, 4 work-order null, 2 tire-buying, 2 request-overlay, 1 inference-trap, 1 passing-cue near-miss) |
| Customer-voice, synthetic ≤30% & flagged | PASS (corpus-dominant; synthetic only where noted) |
| No catalog/service mutation authored here (Chris-gated stays in wheels) | PASS |
