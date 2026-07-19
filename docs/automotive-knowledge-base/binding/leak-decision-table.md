# Fluid-leak decision table (binding artifact)

> Owner: `routers/router-leaks.md` (Wave B). This is the machine-facing lookup the leak router
> produces: **one row per fluid**, keyed on the three fact slots that a customer can literally state
> about a puddle — `fluid_color` + `fluid_under_car_location` + `smell_descriptor` — resolving to the
> Stage-2 `leak/*` subcategory slug and the owning system/service. Column values are the EXACT enum
> values from `scheduler-app/src/lib/scheduler/wizard/llm/extracted-facts.ts` (verified 2026-07-18);
> customer-voice color words are the strings the classifier actually sees.
>
> **Literalness rule (governs every row):** a row fires only on facts the customer LITERALLY stated. A
> bare color with no location/smell is `needs-fact`, never a confident pick — see the two amber/clear
> collisions below, which are SAFETY-critical. A leak that is *causally tied to recent work* is a
> Stage-1 **situational override** (`after_recent_service_or_repair_work`) and routes to advisor BEFORE
> this table is consulted (corpus tka-034 "had rear differential serviced elsewhere and now sees fluid
> leaking everywhere").

---

## Primary table — one row per fluid

| # | Fluid | `fluid_color` (enum) | Customer-voice color words | Typical `fluid_under_car_location` | `smell_descriptor` | → Stage-2 subcategory slug | → System / service | Severity |
|---|---|---|---|---|---|---|---|---|
| 1 | Engine oil | `brown_or_black` | "dark brown", "black oily stain", "brown slick spot", "oil under the motor", "black spots on the driveway" | `under_engine_front`, `under_middle` (rear main) | `burnt_oil` / none | `brown_or_black_puddle_engine_oil` | engine-lubrication-oil · `oil_leak_testing` | drivable_but_concerned |
| 2 | Coolant / antifreeze | `green_or_orange_or_yellow_or_pink` | "bright green", "green stuff", "antifreeze", "orange", "neon yellow", "pink coolant" | `under_engine_front` (radiator/front-center) | `sweet_or_maple_syrup` / none | `green_orange_yellow_or_pink_puddle_coolant` | cooling-system · `coolant_leak_testing`[`_euro`] | concerned → tow if overheating |
| 3 | Transmission / power-steering | `red_or_pink` | "bright red", "red oily", "reddish", "pink fluid", "red drip" | trans: `under_middle`/`under_rear`; PS: `under_engine_front` | none / faint burnt | `red_or_pink_puddle_transmission_or_power_steering` | automatic-transmission · `transmission_testing` **OR** steering-power-steering · `power_steering_eps_testing` (split on §pair below) | drivable_but_concerned |
| 4 | Brake fluid ⚠ SAFETY | `clear_yellow_or_light_brown` | "amber", "clear-ish", "brownish-yellow", "light brown", "looks yellow when it dries" | `under_a_wheel`, `under_driver_side` (master cyl. area) | none | `clear_yellow_or_light_brown_puddle_brake_fluid` | brakes-friction-hydraulic · `brake_inspection` | **not_drivable_needs_tow if pedal compromised** |
| 5 | Water / A/C condensation | `clear_no_color` | "clear water", "just water", "wet spot after the AC runs", "looks like plain water" | `under_middle`, `under_passenger_side` | none (**odorless**) | `clear_odorless_puddle_water_or_ac_condensation` | hvac-climate · `ac_leak_testing` / `ac_performance_check` (usually **normal** — reject unless inside cabin) | drivable_normally |
| 6 | Gear / differential oil | `thick_dark_brown` | "thick dark oil", "gooey black", "gear oil", "stinks like rotten eggs", "sticky dark stuff by the axle" | `under_rear`, `under_middle` (4WD PTU/transfer case) | `rotten_egg_or_sulfur` | `thick_dark_brown_puddle_gear_or_differential_oil` | driveline-cv-diff-awd · `oil_leak_testing` (leak subcat is reachable from `oil_leak_testing`, NOT `awd_4x4_testing`) | drivable_but_concerned |
| 7 | Washer fluid | `blue_or_light_blue` | "blue", "bright blue", "windshield fluid", "washer fluid" | `under_engine_front` (reservoir), `under_passenger_side` | none / soapy | `blue_or_light_blue_puddle_washer_fluid` | body/washer (no dedicated diagnostic service — low-severity; advisor/booking) | drivable_normally |

---

## Discriminator sub-rules (where a single fluid_color is not decisive)

These are the SAFETY-critical and color-collision cases. Each names the deciding slot; **color alone
never decides them.**

1. **Amber collision — engine oil vs brake fluid (rows 1↔4, SAFETY).** Fresh clean engine oil AND brake
   fluid are both amber/light-brown; the DB already carries "Amber-colored drips…" as a brake-fluid
   positive. A bare "amber"/"light-brown" is `needs-fact`, NEVER a confident `brown_or_black`.
   **Decide on:** `fluid_under_car_location=under_a_wheel` **+** `pedal_feel` soft/sinking → brake fluid
   (row 4); `under_engine_front` + no pedal change → engine oil (row 1).
2. **Clear collision — brake fluid vs A/C condensation (rows 4↔5).** "Clear-ish" can be dried brake
   fluid or plain water. **Decide on:** slick/oily + `under_a_wheel` + any pedal change → brake fluid
   (row 4, SAFETY); truly `clear_no_color`, watery, odorless, `under_passenger_side` after A/C → row 5.
3. **Red vs pink — trans/PS vs OAT coolant (rows 3↔2).** Many long-life coolants (Dex-Cool, Toyota
   SLLC) are pink/red. **Decide on:** oily/slick + trans-shift or heavy-steering symptom → row 3;
   watery + bright-neon + `sweet_or_maple_syrup` + overheating → row 2 (coolant).
4. **Trans vs PS within row 3.** `fluid_under_car_location`: `under_middle`/`under_rear` → transmission
   (`transmission_testing`); `under_engine_front` + `steering_feel=heavy_or_hard_to_turn` / whine-on-turn
   → power steering (`power_steering_eps_testing`).
5. **Blue coolant vs washer fluid (rows 2↔7).** Some Asian-market coolant is bright blue; `fluid_color`
   has no coolant-blue value. **Decide on smell, not color:** `sweet_or_maple_syrup` / slimy → coolant
   (row 2); soapy/odorless watery → washer (row 7).
6. **Engine oil vs gear/diff oil (rows 1↔6).** Both dark. **Decide on:** `under_rear` +
   `rotten_egg_or_sulfur` + thick/sticky → gear oil (row 6); `under_engine_front` + petroleum/`burnt_oil`
   → engine oil (row 1).
7. **Oil drip vs exhaust (cross-ref `router-smoke-smells`).** Oil ON the hot manifold sizzles to a
   burnt-oil smell/under-hood smoke with often NO ground puddle → row 1 (`burnt_oil` + oil residue). An
   exhaust breach is a `noise_descriptor=ticking_or_tapping` + louder exhaust with no fluid →
   `exhaust_system_testing`. This is a smoke/smell case; the smoke/smell router owns the final call.

---

## Vague-leak fallback (very common in the corpus)

A leak with **no color, location, or smell stated** — "under vehicle leak" (tkc), "I have a leak under
the front of the vehicle, I am not sure what the cause is", "CLIENTS FATHER NOTICED LARGE FLUID LEAK IN
DRIVEWAY … EVIDENCE IS WASHED AWAY" — is `needs-fact:fluid_color` (then `fluid_under_car_location`,
`smell_descriptor`). It must NOT be force-picked to oil just because oil is the modal leak. The wizard
asks the color/location/smell question first.
