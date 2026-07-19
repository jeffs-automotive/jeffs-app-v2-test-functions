# Requests & situational routing table (binding)

> Machine-form signature deliverable of `routers/router-requests-maintenance.md`. A row-level routing
> guide for **non-symptom + situational** customer language: request / maintenance / work-order phrasing
> and the six `other/*` situational buckets → the exact route. Bind ONLY to slugs that exist in
> `00-current-scheduler-taxonomy.md`. Two exit routes throughout: **`advisor_handoff`** (Stage-1 returns a
> situational `other/*` key — non-empty) vs **`null_match`** (Stage-1 `[]` — nothing fits; the tire-buying
> gap and all bare work-order/off-topic lines land here). `latent_subcategory` is a soft KB target only,
> valid on the tire-buying gap (the harness forbids a null Stage-1 with a non-null Stage-2).

## A. Route-selection order (first match wins)

| # | Trigger | Route | Stage-1 key | Notes |
|---|---|---|---|---|
| 0 | Not a vehicle concern (greeting, hours/price, hiring, reschedule, off-topic referral, gibberish, <~5 useful words, bare phone#/address/deadline) | `null_match` | `[]` | Decision rule #3 |
| 1 | Bare work-order / service-request line (names an ACTION, no symptom) | `null_match` | `[]` | NON-CONCERN rule; **exception:** a request that ALSO states a symptom → fall through to the symptom |
| 2 | Tire-buying / dry-rot request (wants new tires; aged/cracked tires as the thing to replace) | `null_match` | `[]` | latent_subcategory ∈ {`just_want_new_tires`, `dry_rot_sidewall_cracking`}; set `customer_request_type=just_get_new_tires` |
| 3 | Situational cue **causally tied** to the symptom (PRIORITY-ORDER) | `advisor_handoff` | one of the 6 buckets | §B; if a specific symptom is ALSO present + linked → bucket 1st, service 2nd (2-candidate) |
| 4 | Cue mentioned **in passing** + a specific testable symptom | `testing_service` | the symptom service | tow-in-then-symptom, "was at the dealer" backstory — route the symptom |
| 5 | Otherwise | (symptom path) | — | hand to the system dossiers / other routers |

## B. The six situational buckets (`route: advisor_handoff`)

| Bucket (Stage-1 key = subcategory slug) | Fires when (causal tie required) | Fact set | Corpus witnesses |
|---|---|---|---|
| `after_recent_service_or_repair_work` | recent shop/part work named as the STATED CAUSE / still-broken-after-work | `recent_action=general_service` + causal-blame framing | tkc-000, 013, 037, 084, 146, 196, 220, 227, 258, 260; other-postservice-1/2 |
| `after_a_recent_accident_or_impact` | accident/impact/pothole/curb named as the STATED CAUSE; collision framing | `recent_action=accident_or_impact`/`hit_pothole_or_curb` | tkc-088, 251; other-accident-1/2 |
| `safety_concern_dont_feel_safe_driving_it` | fear DOMINATES, no diagnosable symptom named; total loss of a safety system | `drivable_state=not_drivable_needs_tow`/`stranded_now` | tkc-255; other-safety-1/2 |
| `car_has_been_sitting_unused_for_a_long_time` | long storage as the framing; "make road-ready after sitting" | `recent_action=car_sat_unused` | tkc-118; other-sitting-1/2 |
| `general_check_up_or_pre_trip_inspection` | open-ended once-over: wellness / pre-trip / road-trip / peace-of-mind / just-bought | `customer_request_type=pre_trip_inspection` (if trip named) | tkc-005, 020, 029, 046, 048, 104, 242; other-checkup-1/2 |
| `multiple_symptoms_not_sure_what_category` | several co-equal problems, no single primary; "not sure what's wrong" | (varies) | tkc-034, 090, 122, 130, 151, 162, 198, 217; other-multi-1/2 |

**Override discipline (Stage-1 PRIORITY-ORDER, `diagnose-concern.ts`):** a cue overrides a symptom keyword
ONLY when the customer connects the symptom to the situation ("after X, now Y" / "since X, still Y"). A
cue in passing does NOT override a specific testable symptom → route the symptom (row A#4). When both are
present and linked, return the bucket FIRST + the service SECOND (never silently drop either).

## C. `customer_request_type` overlay (a fact, not a route)

A **named diagnosable symptom/system** keeps control at that system even when framed as a request — the
request type is metadata. Only a **bare request with no symptom** null-routes; only a **situation** wins a
bucket.

| Utterance pattern | Route | `customer_request_type` | Witness |
|---|---|---|---|
| "dealer said I need rear brakes, check them" | `brake_inspection` | `fix_a_known_problem` | tkc-003/110/156 |
| "told I need wheel bearings, want a second opinion" | `suspension_steering_check` | `second_opinion` | tkc-102 |
| "I want a new battery" (named part, no symptom) | `null_match` (work-order) | `replace_specific_part` | — |
| "Replace battery … won't start on first push" (part + symptom) | `charging_starting_testing` | `replace_specific_part` | tkc-203 |
| "oil change / 3000-mile service" | `null_match` (maintenance) | `routine_maintenance` | tkc-183/208 |
| "wellness check, driving to Boston" | `general_check_up_or_pre_trip_inspection` | `pre_trip_inspection` | tkc-005 |
| "quote for 4 new tires" | `null_match` (tire-buying gap) | `just_get_new_tires` | tkc-138 |

**Literalness guard (`extracted-facts.ts` + diagnose-concern negative examples #6–#8):** booking/contact
language NEVER sets `customer_request_type`. "do we need an appointment?", "give me a call", "contacting
you about my broken AC" → leave `customer_request_type` null.

## D. NON-CONCERN work-order null-routes (`route: null_match`, Stage-1 `[]`)

The ~24% work-order noise in the concern channel. These name an ACTION with no described symptom → no
guessed service. (These CANNOT be `stage2.example.negative.add` — no `routes_to` slug — so they are
trained as golden `null_match` cases.)

| Sub-pattern | Examples (tekmetric) |
|---|---|
| `Previously declined>` prefix | tkc-007/015/024/062/074/101/105/131/159/168/177/250 |
| Bare action line | "rack replacement" (108), "Replace front wheel hub" (017), "RESET OIL MAINT LIGHT" (011), "Have the alignment checked" (132), "Tire Rotation & Balance" (060), "valve cover removal inspect" (155) |
| Maintenance / interval | "Oil Change full syn" (183), "Need 3000-mile service" (208), "$74.95 Synthetic Oil Change … 23 Point Inspection" (142) |
| Regulatory service line | "State Inspection and Emissions" (287), "State inspection" (212), "Reinspection…" (192) |
| Logistics / off-topic | "Will pay over phone & p/u after hours" (008), "375 Keystone Ave" (026), "needs by 11am" (043), "in a meeting 10-11am" (191); authored null-01..12 |

**Exception (keep as a real concern):** a request that ALSO describes a symptom — "AC recharged a couple
months ago, now blowing hot again" (→ `ac_performance_check`). Do not let the work-order framing swallow a
stated symptom.

## E. Regulatory inspection (null) vs general/pre-trip check-up (bucket)

| Utterance | Route | Why |
|---|---|---|
| "State Inspection", "State Inspection and Emissions", "Reinspection" | `null_match` | bookable regulatory service line, no condition assessment |
| "wellness check driving to Boston", "just bought it, overall check up", "warranty expiring, make sure everything ok" | `general_check_up_or_pre_trip_inspection` | open-ended condition assessment |
| "Annual/yearly inspection" (framed as a general check) | `general_check_up_or_pre_trip_inspection` (lean) | consensus-labeled to the bucket (tkc-046/163); borderline — hedge |

Discriminator: `customer_request_type=pre_trip_inspection`/open-ended framing (bucket) vs a bare
regulatory noun-phrase (null).

## F. Tire-buying gap (taxonomy §5 #9) — `route: null_match` + `latent_subcategory`

| Utterance | Route | latent_subcategory | Facts |
|---|---|---|---|
| "quote for 4 new tires, entry level fine" | `null_match` | `just_want_new_tires` | `customer_request_type=just_get_new_tires` |
| "TIRE REPLACEMENT" / "TIRE REPLACE IF NEEDED" | `null_match` | `just_want_new_tires` | `customer_request_type=just_get_new_tires` |
| "sidewalls all cracked, old and dry-rotted, need new tires" | `null_match` | `dry_rot_sidewall_cracking` | `tire_state=sidewall_cracking` |
| "screw in my tread, still holds air" (contrast — repairable) | `testing_service` (`tire_repair`) | — | `tire_state=visible_damage` |

`tire_repair` explicitly EXCLUDES worn/aged/sidewall tires and no other service fits → the buying request
null-routes to an advisor quote. **Coordination:** `wheels-tires-tpms-bearings` owns the Chris-gated
`tire_sales_consultation` catalog proposal and taxonomy §5 #6 (tire_repair ↔ tpms ↔ suspension); this
router owns §5 #9 (the buying-vs-repair boundary + the null-route training). Once
`tire_sales_consultation` lands, the `latent_subcategory` becomes a hard Stage-2 target.

## G. Do-NOT-fire cross-refs (hand-off boundaries)

| Situation | Owner |
|---|---|
| which dash light / solid vs flashing / multiple_warning_lights_at_once | `router-warning-lights` |
| a named diagnosable light + passing "is it safe?" | the light's system (airbag dossier §7); NOT the safety bucket |
| tire *symptom* subcats (puncture/TPMS/balance/bearing) | `wheels-tires-tpms-bearings` (§5 #6) |
| won't-start branch after sitting (click/crank-no-fire/silent) | `router-no-start-power` |
| noise/vibration/fluid/smoke descriptor disambiguation | `router-nvh` / `router-leaks` / `router-smoke-smells` |

Source authority: `diagnose-concern.ts` (PRIORITY-ORDER + NON-CONCERN rules, decision rules #1–#9),
`extracted-facts.ts` (`customer_request_type`, `recent_action`, `drivable_state`),
`00-current-scheduler-taxonomy.md` §3b/§5/§6, and the Tekmetric corpus + `eval-cases.json` (linguistic).
