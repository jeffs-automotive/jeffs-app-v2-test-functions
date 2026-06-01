// stage-schemas — llm-testing module.
// Extracted from llm-testing/index.ts (file-size-refactor). Mechanical split.

import { z } from "npm:zod@^4";
import { ExtractedFactsSchema, EXTRACTED_FACTS_JSON_SCHEMA } from "./extracted-facts-schema.ts";

// ════════════════════════════════════════════════════════════════════
// JSON SCHEMAS + ZOD SCHEMAS (mirror diagnose-concern.ts 3-stage)
// ════════════════════════════════════════════════════════════════════

export const STAGE1_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matched_category_key: {
      type: ["string", "null"],
      description:
        "Either a testing_services.service_key from the catalog above OR an " +
        "'other' subcategory slug. Return null when the description is too " +
        "vague to categorize OR doesn't fit any catalog entry.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Your confidence in the matched_category_key. Use 'high' when the " +
        "description clearly names the system or symptom that maps to one " +
        "category (e.g., 'ABS light is on' → warning_light_general; " +
        "'sweet smell under hood' → coolant_leak_testing); use 'medium' " +
        "when 2-3 categories are plausible and you picked the best of them " +
        "(e.g., a vague 'shake' that could be brakes or suspension); use " +
        "'low' when the description is vague enough that the customer might " +
        "be better served by an advisor handoff (and you'd return null in " +
        "most such cases). When matched_category_key is null, confidence " +
        "should be 'low'.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters) citing the chosen category " +
        "and the customer words that drove the match. Audit-only.",
    },
  },
  required: ["matched_category_key", "confidence", "reasoning"],
};

export const STAGE2_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matched_subcategory_slug: {
      type: ["string", "null"],
      description:
        "The subcategory slug whose meaning best matches the customer's " +
        "symptoms. MUST appear in the subcategory list above. null only if " +
        "you genuinely can't pick (rare).",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Your confidence in the matched_subcategory_slug. Use 'high' when " +
        "the description clearly maps to ONE subcategory (a clear positive " +
        "example match, or a synonym match, with no negative example " +
        "ambiguity). Use 'medium' when the subcategory is the best of 2-3 " +
        "plausible picks. Use 'low' when the description doesn't really fit " +
        "any subcategory well OR when negative examples warn against the " +
        "near-miss pick you made. Low confidence is a signal to a " +
        "downstream advisor to verify the routing.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters) citing the chosen " +
        "subcategory and which customer words drove the pick (positive " +
        "example match, synonym, etc.). Audit-only.",
    },
  },
  required: ["matched_subcategory_slug", "confidence", "reasoning"],
};

// Stage 3 wraps EXTRACTED_FACTS_JSON_SCHEMA with confidence + reasoning.
export const STAGE3_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    extracted_facts: EXTRACTED_FACTS_JSON_SCHEMA,
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description:
        "Your confidence in the FACT EXTRACTION quality. Use 'high' when " +
        "the customer's description was clear enough that every fact you " +
        "set was a literal, unambiguous statement (e.g., 'shakes at exactly " +
        "65 mph' → speed_specific_mph=65 is unambiguous). Use 'medium' when " +
        "the description was clear but some slots involved a judgment call " +
        "between adjacent enum values (e.g., 'kind of slow to start' — " +
        "slow_crank vs intermittent). Use 'low' when the description was " +
        "vague and you set most slots to null because the customer didn't " +
        "literally state much.",
    },
    reasoning: {
      type: "string",
      description:
        "One sentence (keep under 280 characters) summarizing what was and " +
        "wasn't extractable. Audit-only.",
    },
  },
  required: ["extracted_facts", "confidence", "reasoning"],
};

export const Stage1ResponseSchema = z.object({
  matched_category_key: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

export const Stage2ResponseSchema = z.object({
  matched_subcategory_slug: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

export const Stage3ResponseSchema = z.object({
  extracted_facts: ExtractedFactsSchema,
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});
