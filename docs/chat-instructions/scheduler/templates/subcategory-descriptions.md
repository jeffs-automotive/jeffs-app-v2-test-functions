# Subcategory Descriptions

<!--
Each `## <category>/<slug>` block carries the stage-1 metadata the
3-stage diagnostic LLM classifier uses to pick the right subcategory
from a customer's free-text concern.

This MD does NOT create / modify / delete subcategories themselves —
only the 4 metadata columns (description, positive_examples,
negative_examples, synonyms). Use upload_concern_category_md to add
or rename subcategories.

Heading format
--------------
The heading is COMPOSITE: `## <category>/<slug>`. The slash matters —
subcategory slugs are unique only within a category, so the parser
needs both halves. Both halves must match `^[a-z0-9_]+$`. Example:

  ## brakes/high_pitched_squealing

Fields per block (4)
--------------------
  - Description: 2-3 sentence subcategory description.
    Required. 10-1000 chars. LLM-facing — write naturally; the LLM
    reads it verbatim during stage-1 classification. When empty in
    the DB, the classifier degrades to slug + parent category for
    context (degraded but functional).

  - Positive examples: customer utterances that SHOULD match this
    subcategory. Used as few-shot exemplars in the stage-1 prompt.
    Format: comma-list on one line OR multi-line with `- ` prefix
    per entry (each entry may be wrapped in double quotes for
    readability). Cap 10. Empty cell or `(none)` → no exemplars
    (zero-shot for this subcategory).

  - Negative examples: customer utterances that should NOT match this
    subcategory. Boundary cases (e.g., a brake-noise subcategory
    might list suspension-noise utterances here to prevent the LLM
    from cross-matching). Same format as positive_examples. Cap 10.
    You MAY append ` → <other_slug>` for advisor reference — the
    arrow + target are stripped at parse time and are not stored.

  - Synonyms: alt phrasings the customer might use ("AC", "air con",
    "climate control"). Comma-list. Cap 20. Used for embedding-
    similarity boosts and keyword pre-filtering before the stage-1
    LLM call.

Diff semantics
--------------
  - Rows OMITTED from the MD are LEFT ALONE (uploads never silently
    clear). Upload a 1-block MD to edit just one subcategory.
  - To CLEAR a list field, write `Field: (none)` (or `Field:` with
    no `- ` continuation lines below).
  - To CHANGE a list, list its new entries (the existing list is
    REPLACED, not appended to).

Validation rules (BLOCKS apply)
-------------------------------
  - (category, slug) must exist in concern_subcategories
  - Description length 10..1000
  - positive_examples / negative_examples count <= 10 each
  - synonyms count <= 20
  - duplicate (category, slug) in same upload

WARNS (surface for confirmation; doesn't block)
-----------------------------------------------
  - Subcategory exists but is currently Active: false (description
    will be stored but won't take effect until reactivated)

Two-step flow
-------------
The orchestrator always shows a diff for advisor approval before
applying — bulk uploads are dry-run by default. After the dry-run,
pass back the returned `confirm_token` on the apply call.

Three real samples follow. Replace the contents with the subcategory
descriptions you're editing — you don't need a block for every
subcategory in the catalog, only the ones you're changing.
-->

## brakes/high_pitched_squealing
Description: High-pitched continuous squeal from one or more wheels, usually appearing when the brake pedal is lightly pressed or released. Often caused by worn brake pad wear indicators, glazed pads, or rotor surface contamination. Distinct from grinding (metallic_grinding) and dull thumps (clunking_over_bumps).
Positive examples:
  - "Brakes squeal when I let off the pedal"
  - "Squeaking noise when I'm coming to a stop"
  - "High-pitched squeal from the front wheels when I brake"
  - "Annoying screech every time I slow down"
Negative examples:
  - "Grinding noise when I brake" → metallic_grinding
  - "Pedal vibrates when braking" → pulsating_or_vibrating_pedal
  - "Clunk over bumps" → clunking_over_bumps
Synonyms: squeak, squeal, screech, whine, brake noise, squealing brakes, squeaky brakes

## brakes/metallic_grinding
Description: Loud metal-on-metal grinding from one or more wheels when the brake pedal is pressed. Indicates brake pads are worn through to the backing plate and the metal is contacting the rotor — typically a safety issue requiring same-day inspection. Distinct from squealing (high_pitched_squealing), which is the warning step before grinding.
Positive examples:
  - "Loud grinding noise when I brake"
  - "Sounds like metal scraping when I slow down"
  - "Grinding from the front wheels"
  - "Awful grinding noise — getting worse"
Negative examples:
  - "Squealing or screeching" → high_pitched_squealing
  - "Grinding noise only when turning" → popping_or_clicking_when_turning
  - "Grinding under the car at speed" → humming_or_whirring_at_speed
Synonyms: grind, grinding, metal scraping, rotor on metal, brake grinding

## hvac/bad_smell_from_vents
Description: Unpleasant odor coming from the dashboard vents when the HVAC system is running. Most often a musty or mildew smell from microbial growth on the evaporator coil, but can also be burning electrical smells from a failed blower motor or chemical smells from a coolant leak into the heater core. The classifier should pick this subcategory only when the smell is clearly tied to vent airflow.
Positive examples:
  - "Musty smell when I turn on the AC"
  - "Vents smell like dirty socks"
  - "Burning smell coming from the dash"
  - "Sweet smell when the heat is on"
Negative examples:
  - "Burning smell from outside the car" → burnt_oil_smell
  - "Exhaust smell in the cabin" → exhaust_fumes_inside_the_cabin
  - "AC blows warm" → ac_blows_warm_or_hot_air
Synonyms: musty smell, mildew smell, dirty sock smell, vent odor, AC smell, foul vent air
