// prompts — llm-testing module.
// Extracted from llm-testing/index.ts (file-size-refactor). Mechanical split.

import Anthropic from "npm:@anthropic-ai/sdk@^0.97";
import { isTestingService, isOtherSubcategory, type CatalogSubcategory, type CatalogCategory, type DiagnosticCatalog } from "./catalog.ts";
import { EXTRACTED_FACTS_JSON_SCHEMA, type ExtractedFacts } from "./extracted-facts-schema.ts";

// ════════════════════════════════════════════════════════════════════
// PROMPT BUILDERS (mirror diagnose-concern.ts)
// ════════════════════════════════════════════════════════════════════

export interface ChipHint {
  chip_service_key: string;
  chip_display_name: string;
  chip_concern_categories: string[];
}

function fmtPriceForLLM(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function buildChipHintLine(chipHint: ChipHint | null): string {
  if (!chipHint) return "No chip hint — classify from description alone.";
  if (chipHint.chip_service_key === "other_issue") {
    return `The customer picked the "💬 Other Issue" pseudo-chip — no pre-classification; classify from description alone, considering all categories.`;
  }
  return `The customer picked the "${chipHint.chip_display_name}" chip (related concern_categories: ${chipHint.chip_concern_categories.join(", ") || "none"}). Use this as a soft prior — prefer categories tagged with one of those concern_categories unless the description clearly says otherwise.`;
}

// Stage 1 system prompt returned as an Anthropic content-block array with
// cache_control on the STATIC portion. Mirrors scheduler-app's
// buildStage1SystemPrompt — see diagnose-concern.ts for the full
// cache_control rationale (5-min ephemeral TTL, Haiku 2048-token write
// threshold, fact that string-form silently disables caching).
export function buildStage1SystemPrompt(
  catalog: DiagnosticCatalog,
  chipHint: ChipHint | null,
): Anthropic.TextBlockParam[] {
  const testingServices = catalog.categories.filter(isTestingService);
  const otherSubcategories = catalog.categories.filter(isOtherSubcategory);

  const testingServicesBlock = testingServices
    .map((t, i) => {
      return [
        `${i + 1}. service_key="${t.service_key}" — ${t.display_name} (${fmtPriceForLLM(t.starting_price_cents)})`,
        `   What we'd do: ${t.description ?? "—"}`,
        `   Concern categories tagged: ${t.concern_categories.join(", ") || "(none)"}`,
      ].join("\n");
    })
    .join("\n\n");

  const otherSubcategoriesBlock = otherSubcategories
    .map(
      (o, i) =>
        `${testingServices.length + i + 1}. subcategory_slug="${o.subcategory_slug}" — ${o.display_label}`,
    )
    .join("\n");

  const staticText = `You are the diagnostic categorisation helper for Jeff's Automotive
(Stage 1: category match). A customer typed a description of what's wrong
with their car. Your job: pick ONE category from the catalog below.

If the description is too vague or doesn't fit any category clearly, return
matched_category_key=null. Empty/very-short descriptions count as "doesn't fit."

You will NOT be asked to pick a subcategory or generate clarification
questions in this stage — that's Stage 2's job, which only runs if you pick
a testing service. Just classify the description into a single category.

# Category catalog

## Testing services — these drive a recommendation + fee

${testingServicesBlock}

## 'Other' situations — these route to a service advisor (no testing service, no fee)

These elevated subcategories cover concerns that don't map to a specific test:
multiple symptoms at once, recent accidents, work just done elsewhere, safety
worries, general inspections, cars that have been sitting.

${otherSubcategoriesBlock}

# Decision rules

1. **Match category to the customer's actual symptoms.** Read the description
   carefully and pick the category whose name + "What we'd do" + tags best fit
   the described issue. The chip hint is a prior, not a constraint.

2. **'Other' subcategory matches are valid AND useful.** If the customer's
   description is about a situation (recent accident, car has been sitting,
   pre-trip check, multiple symptoms at once with no primary), match the
   appropriate 'other' subcategory_slug. Don't try to force a testing service
   when the situation truly doesn't fit one.

3. **Couldn't categorize is a valid answer.** When the description is too
   vague ("car feels weird", "something's off", < ~5 useful words), return
   matched_category_key=null. The system will forward to a service advisor.

4. **Never invent IDs or slugs.** Only return values that appear above.

5. **Reasoning is for the audit log.** One sentence under 280 characters.

6. **Confidence is self-reported.** Pick one of high/medium/low:
   - **high** — the description clearly names the system or symptom that
     maps to ONE category (e.g., "ABS light is on" → warning_light_general;
     "sweet smell under hood" → coolant_leak_testing; "brake pedal sinks to
     the floor" → brake_inspection). No realistic alternative reading.
   - **medium** — the matched category is the best of 2-3 plausible picks
     (e.g., a vague "shake" that could be brakes or suspension; a generic
     "noise from the engine" that could be performance or noise).
   - **low** — the description is vague enough that you're not really
     sure (e.g., "the car feels weird", "something's off"). If you're
     this unsure, prefer matched_category_key=null. When you DO return
     null, confidence MUST be 'low'.`;

  const dynamicText = `# Customer's pre-selection (context)

${buildChipHintLine(chipHint)}`;

  return [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
}

// Stage 2 system prompt returned as a content-block array with cache_control
// on the static portion. Anthropic caches per exact-content match, so a
// repeat of the same matched-category subtree within the 5-min ephemeral
// window hits the cache.
export function buildStage2SystemPrompt(
  matchedCategory: CatalogCategory,
  chipHint: ChipHint | null,
): Anthropic.TextBlockParam[] {
  // For 'other' matches, synthesize a singleton list so the LLM still
  // picks-from-N (N=1 here). No enrichment metadata on 'other' since the
  // path doesn't go through concern_subcategories.
  const subcategories: CatalogSubcategory[] = isOtherSubcategory(matchedCategory)
    ? [
        {
          slug: matchedCategory.subcategory_slug,
          display_label: matchedCategory.display_label,
          concern_category: "other",
          eligible_testing_service_keys: [],
          description: "",
          positive_examples: [],
          negative_examples: [],
          synonyms: [],
          questions: matchedCategory.questions,
        },
      ]
    : matchedCategory.subcategories;

  const matchedHeader = isTestingService(matchedCategory)
    ? `service_key="${matchedCategory.service_key}" — ${matchedCategory.display_name}`
    : `subcategory_slug="${matchedCategory.subcategory_slug}" — ${matchedCategory.display_label}`;

  const subcategoryBlock = subcategories
    .map((s) => {
      const lines: string[] = [
        `## subcategory_slug="${s.slug}" — ${s.display_label}`,
        `Description: ${s.description?.trim() ? s.description.trim() : "(none yet — falls back to slug)"}`,
      ];
      if (s.positive_examples.length > 0) {
        lines.push("Positive examples:");
        for (const ex of s.positive_examples) {
          lines.push(`  - "${ex}"`);
        }
      }
      if (s.negative_examples.length > 0) {
        lines.push("Negative examples (do NOT match):");
        for (const ex of s.negative_examples) {
          lines.push(`  - "${ex}"`);
        }
      }
      if (s.synonyms.length > 0) {
        lines.push(`Synonyms: ${s.synonyms.join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const staticText = `You are the diagnostic categorisation helper for Jeff's Automotive
(Stage 2: subcategory pick). Stage 1 already matched the customer's
description to a category:

  ${matchedHeader}

Your job: pick the ONE subcategory below whose meaning best matches the
customer's symptoms. The subcategory MUST be one of the slugs listed below.
${subcategories.length === 1 ? "(For 'other' matches there is only ONE choice — pick it.)" : ""}

NOTE: You do NOT see the per-question text here, and you are NOT being asked
to figure out which questions the customer already answered. That's
Stage 3's job (deterministic mapper). All you need to do here is pick the
RIGHT subcategory for downstream Stage-3 fact extraction + mapping to use.

# Subcategory catalog (this category only)

${subcategoryBlock}

# Decision rules

1. **Subcategory must appear in the list above.** Don't invent slugs.

2. **Use the description as the primary signal.** Each subcategory has an
   authoritative description in advisor-facing language. The customer's
   wording maps to the subcategory whose description best matches what they
   said. Synonyms widen the matchable surface; positive examples are
   anchor phrases that SHOULD match; negative examples are near-miss phrases
   that should NOT match (they look similar but belong elsewhere).

3. **When in doubt between near-miss subcategories, lean on negative
   examples.** If a subcategory has a negative example that resembles the
   customer's wording, that subcategory is the WRONG pick.

4. **Never invent IDs or slugs.** Only return values that appear above.

5. **Reasoning is for the audit log.** One sentence under 280 characters,
   citing which positive example / synonym / description sentence drove
   the pick.

6. **Confidence is self-reported.** Pick one of high/medium/low:
   - **high** — the description clearly maps to ONE subcategory (e.g.,
     a clear positive example match, a verbatim synonym, or a description
     that unambiguously matches the customer's wording).
   - **medium** — the subcategory is the best of 2-3 plausible picks
     (e.g., the description partially matches two subcategories'
     positive examples, and you picked the closer one).
   - **low** — the description doesn't really fit any subcategory in
     the list above, OR you're forcing a match because Stage 1 picked
     a category but the symptom doesn't quite fit any subcategory's
     description. Low is a signal to a downstream advisor to verify the
     routing.`;

  const dynamicText = `# Customer's pre-selection (context from Stage 1)

${buildChipHintLine(chipHint)}`;

  return [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
}

/**
 * Render a human-readable bulleted version of the ExtractedFacts slot
 * registry for the Stage 3 system prompt. JSON Schema constrains the
 * API; this is the authoring-facing reference paraphrasing slot
 * name + type + enum + description.
 */
function renderExtractedFactsSlotList(): string {
  const properties = EXTRACTED_FACTS_JSON_SCHEMA.properties as Record<
    string,
    {
      type?: readonly string[];
      enum?: readonly (string | null)[];
      description: string;
    }
  >;
  const lines: string[] = [];
  for (const [slot, def] of Object.entries(properties)) {
    const enumValues = def.enum
      ? def.enum.filter((v): v is string => v !== null)
      : null;
    const typeLabel = enumValues
      ? `enum(${enumValues.join("|")}) | null`
      : def.type
      ? `${def.type.filter((t) => t !== "null").join("|")} | null`
      : "unknown | null";
    lines.push(`- \`${slot}\` (${typeLabel})`);
    lines.push(`  ${def.description}`);
  }
  return lines.join("\n");
}

export function categoryHeaderForStage3(cat: CatalogCategory): string {
  return isTestingService(cat)
    ? `service_key="${cat.service_key}" — ${cat.display_name}`
    : `subcategory_slug="${cat.subcategory_slug}" — ${cat.display_label}`;
}

// Stage 3 system prompt returned as a content-block array with cache_control
// on the static portion. The fact-extraction prompt is the most cache-
// effective of the three stages: header + CRITICAL RULE + 29-slot reference
// + worked examples are fully static across every call. Only the Stage 1/2
// result context block varies per call.
export function buildStage3SystemPrompt(
  matchedSubcategory: CatalogSubcategory | null,
  matchedCategoryHeader: string,
): Anthropic.TextBlockParam[] {
  const subcategoryContextLine = matchedSubcategory
    ? `The customer's description has been matched to category:
  ${matchedCategoryHeader}
…and within that, to subcategory:
  subcategory_slug="${matchedSubcategory.slug}" — ${matchedSubcategory.display_label}${matchedSubcategory.description?.trim() ? `\n  Description: ${matchedSubcategory.description.trim()}` : ""}

This is context only — it tells you what KIND of facts will matter
downstream, but you should still extract only what the customer literally
stated regardless.`
    : `Subcategory context: not available (Stage 2 produced no slug). Extract
facts from the description anyway; downstream may still use them.`;

  const staticText = `You are the diagnostic FACT EXTRACTION helper for Jeff's Automotive
(Stage 3: fact extraction). A customer typed a free-text description of what's
wrong with their car. Your job: extract atomic facts from that description
into a typed object with ~29 nullable slots.

# CRITICAL RULE — only extract what the customer LITERALLY stated

You MUST NEVER invent, infer, or "fill in" facts beyond what the customer
literally wrote. If a slot's value is not clearly present in the customer's
description, the slot MUST be null. The downstream deterministic mapper
treats null as "not stated; still need to ask," which is the SAFE behavior —
asking a question is cheap; assuming a fact the customer didn't state and
SKIPPING the question is expensive (we miss a diagnostic signal).

Examples of WHAT NOT TO DO:
  - Customer says "my brakes squeal." DO NOT infer location_side or
    location_axle. Set noise_descriptor="squealing_high_pitched" and leave
    location_side / location_axle null.
  - Customer says "the car runs rough." DO NOT infer engine_running=
    "rough_idle" unless they specifically said the roughness was at idle.
    Leave engine_running null or set to a more general/honest value.
  - Customer says "shakes at highway speed." DO NOT set
    speed_specific_mph to a guessed number. Set speed_band="highway"
    and leave speed_specific_mph null.

When in doubt: leave the slot null. The mapper will surface that question
to the customer.

# Slot reference

Every slot below is nullable. \`null\` = "customer did not state this."
Slot names map to the JSON Schema property names; enums are the only valid
non-null values for enum-typed slots; free-text slots accept any string
the customer named.

${renderExtractedFactsSlotList()}

# Worked examples (description → expected extraction)

1. Customer: "Steering wheel shakes at exactly 65 mph."
   - speed_band: "specific_mph"
   - speed_specific_mph: 65
   - sound_or_smoke_location_zone: "behind_dashboard"   (steering wheel area)
   - onset_timing: null  (customer didn't say WHEN — just speed)
   - All other slots: null

2. Customer: "Heater core smells musty when I run the heat."
   - hvac_mode: "heat"
   - smell_descriptor: "musty_or_mildew"
   - All other slots: null

3. Customer: "AC works but smells like dirty socks when I first turn it on."
   - hvac_mode: "ac"
   - smell_descriptor: "musty_or_mildew"   ('dirty socks' is canonical musty)
   - onset_timing: "at_first_turn_on"
   - All other slots: null

4. Customer: "Loud grinding from the front right when I brake."
   - noise_descriptor: "grinding_metallic"
   - location_side: "right"
   - location_axle: "front"
   - onset_timing: "when_braking"
   - All other slots: null

5. Customer: "Car feels weird."
   - All slots: null. Description too vague to literally extract anything.

# Output

Return ALL ~29 slots (the JSON Schema requires them). For slots not
addressed by the description, return null.

Also return:
  - confidence: high/medium/low — how confident you are in the EXTRACTION
    QUALITY:
      * high — the description was clear enough that every fact you set is
        a literal unambiguous match.
      * medium — the description was clear but a couple of slots required a
        small judgment call between adjacent enum values.
      * low — the description was vague and you set most slots to null
        because the customer didn't literally state much.
  - reasoning: one sentence (keep under 280 characters) summarizing what
    you extracted and any judgment calls. Audit-only.`;

  const dynamicText = `# Stage 1/2 result context

${subcategoryContextLine}`;

  return [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicText },
  ];
}

export function buildUserPrompt(
  customerDescription: string,
  vehicleNotes: string | null,
): string {
  const parts: string[] = [
    `# Customer's description\n${customerDescription.trim()}`,
  ];
  if (vehicleNotes && vehicleNotes.trim().length > 0) {
    parts.push(
      `# Vehicle notes (from Step 6, may not be relevant)\n${vehicleNotes.trim()}`,
    );
  }
  return parts.join("\n\n");
}

/**
 * Total character count across all `text` fields of a content-block array.
 * Used to populate `system_prompt_chars` on stage observability blocks
 * (which previously read `.length` off a string prompt; the array shape
 * makes `.length` the block count instead of chars).
 */
export function totalPromptChars(blocks: Anthropic.TextBlockParam[]): number {
  return blocks.reduce((sum, b) => sum + b.text.length, 0);
}
