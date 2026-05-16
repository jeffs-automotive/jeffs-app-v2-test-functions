/**
 * diagnoseConcern — Phase 9a (2026-05-14) gap-detection LLM helper.
 *
 * Per chat-design.md "Architecture amendment — 2026-05-14" §Step 7 redesign:
 * the LLM's job has been narrowed from "classify category + pick questions
 * + recommend testing services" (Edge-Function specialists/diagnostic.ts)
 * to ONLY "given a category, guideline, questionnaire, and the customer's
 * free-form description, return the IDs of questions the description DID
 * NOT answer." The customer EXPLICITLY picked the service at Step 7.1, so
 * there's no recommendation to make and no testing services to propose —
 * the wizard already knows what to schedule.
 *
 * Inputs:
 *   - category           — pre-resolved by resolveServiceCategory()
 *   - guideline_prose    — service-advisor-authored "what to listen for"
 *                          paragraph from concern_category_guidelines
 *   - questions          — pre-loaded concern_questions rows for category
 *   - customer_description — what the customer typed on the Step 7.2 card
 *   - vehicle_notes      — optional; new_vehicle_info.notes from Step 6
 *                          (e.g., "recent oil change last week") — fed in
 *                          as additional context only (per redesign Q6).
 *
 * Output: `{ unanswered_question_ids: number[] }`. The wizard turns each
 * ID back into a card via the pre-loaded questions array (id → question_text
 * + options).
 *
 * Defensive fallback: on LLM error OR Zod parse failure OR a model that
 * returns IDs outside the supplied catalog, we return EVERY question ID
 * unanswered. Over-asking is safer than missing data — the customer can
 * "skip" any question they don't want to answer.
 *
 * Model: Haiku 4.5 (same default as the Edge-Function diagnostic specialist;
 * fast + cheap + reliable for structured output). Env override:
 * DIAGNOSE_CONCERN_MODEL.
 */
import { anthropic } from "@ai-sdk/anthropic";
import * as Sentry from "@sentry/nextjs";
import { generateObject } from "ai";
import { z } from "zod";

const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 512;

export interface ConcernQuestion {
  id: number;
  question_text: string;
  options: Array<{ label: string; value: string }>;
  /**
   * Bug fix 2026-05-16: questions are grouped by subcategory so the
   * LLM can filter the catalog to ONLY questions relevant to the
   * customer's described symptom. Example: customer says "brakes are
   * grinding" → only metallic_grinding questions are returned, not the
   * full ~37-question brake catalog spanning 6 subcategories.
   */
  subcategory_slug: string;
  subcategory_label: string;
}

export interface DiagnoseConcernArgs {
  category: string;
  guideline_prose: string;
  category_display_label: string;
  questions: ConcernQuestion[];
  customer_description: string;
  /** Optional context — new-vehicle notes from Step 6 if the customer added a vehicle this session. */
  vehicle_notes?: string | null;
}

export interface DiagnoseConcernResult {
  unanswered_question_ids: number[];
  /** True when LLM call + parse both succeeded. False when we returned the fail-safe (all IDs). */
  parsed_ok: boolean;
  model: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  /** Set when parsed_ok is false. Empty string on success. */
  error_message: string;
}

const Schema = z.object({
  unanswered_question_ids: z
    .array(z.number().int().positive())
    .describe(
      "The IDs (from the supplied catalog) of questions the customer's description did NOT answer. " +
        "Return ALL IDs from the catalog when the description is too short / too vague to evaluate. " +
        "Return [] only when the description meaningfully addresses every question.",
    ),
  reasoning: z
    .string()
    .max(280)
    .describe(
      "One-sentence rationale for the audit trail. Cite the customer's actual words.",
    ),
});

function buildSystemPrompt(args: DiagnoseConcernArgs): string {
  // Group the questionnaire by subcategory so the LLM can filter by
  // symptom match first, then gap-detect within the matching subcategories.
  // (Bug fix 2026-05-16: previously the catalog was a flat list and the
  // LLM returned all IDs for short descriptions like "brakes are
  // grinding". The customer ended up answering questions about pulsating
  // pedals, soft pedals, etc. — irrelevant to their stated symptom.)
  const bySubcategory = new Map<
    string,
    { label: string; questions: typeof args.questions }
  >();
  for (const q of args.questions) {
    const slug = q.subcategory_slug;
    if (!bySubcategory.has(slug)) {
      bySubcategory.set(slug, {
        label: q.subcategory_label,
        questions: [],
      });
    }
    bySubcategory.get(slug)!.questions.push(q);
  }

  const catalogSections = Array.from(bySubcategory.entries())
    .map(([slug, group]) => {
      const lines = group.questions
        .map((q) => {
          const optionLabels = q.options.map((o) => o.label).join(" / ");
          return `    - id=${q.id}: "${q.question_text}" (options: ${optionLabels})`;
        })
        .join("\n");
      return `  ## subcategory="${slug}" — ${group.label}\n${lines}`;
    })
    .join("\n\n");

  return `You are the diagnostic gap-detection helper for Jeff's Automotive.
The customer described a specific concern with their vehicle. We've already
classified the concern as: **${args.category_display_label}** (category="${args.category}").

Your job, in two stages:

  **Stage 1 — Subcategory filter:** identify which SUBCATEGORIES the
  customer's description maps to (one or more). Sub-category labels +
  slugs are listed below. Only consider questions from the matching
  subcategories.

  **Stage 2 — Gap detection within the matching subcategories:** from
  the chosen subcategories' questions, drop ones the description has
  already answered. Return the remaining IDs.

# Category guideline (what matters for this kind of concern)

${args.guideline_prose}

# Questionnaire (grouped by subcategory)

${catalogSections}

# Decision rules

1. **Filter by subcategory match (load-bearing).** Each subcategory
   represents a distinct symptom pattern. Only return IDs from
   subcategories whose label/slug matches the customer's words.
   Examples:
     - "brakes are grinding" → only "metallic_grinding"
     - "pedal is soft" / "pedal goes to the floor" → only "spongy_or_soft_pedal" or "pedal_sinks_to_floor"
     - "high pitched squeal when stopping" → only "high_pitched_squealing"
     - "vibrates when braking" → only "pulsating_or_vibrating_pedal"
   The customer should NEVER be asked questions from a subcategory their
   symptoms don't match — that's the whole point of the diagnostic narrowing.

2. **Multi-symptom descriptions can match multiple subcategories.**
   If the customer wrote "pedal is soft and the car vibrates when I
   brake", return IDs from BOTH spongy_or_soft_pedal AND
   pulsating_or_vibrating_pedal. Cap at 3 subcategories for sanity.

3. **Ambiguous descriptions: pick the MOST LIKELY subcategory.** If
   "brakes feel weird" with no specific symptom: pick the most-common
   guess (typically the first subcategory in the list); do NOT return
   all subcategories. Better to ask 5 wrong questions than 37 mostly-
   irrelevant ones.

4. **Empty descriptions (0-3 trimmed words like "idk", "?", "hmm")**:
   return [] — let the system re-prompt the customer for more detail.

5. **Within the chosen subcategories, skip questions the description
   already answers.** If the customer's description directly addresses
   a question's content, omit that ID. Be generous about ambiguity —
   if a question is only loosely addressed, KEEP IT (better to confirm
   than assume).

6. **Never invent IDs.** Only return IDs that appear in the catalog above.

7. **The reasoning is for our audit log, not the customer.** One sentence
   citing (a) which subcategory/subcategories you matched and (b) any
   specific words the customer used that drove the match. No formatting.`;
}

function buildUserPrompt(args: DiagnoseConcernArgs): string {
  const parts: string[] = [
    `# Customer's description\n${args.customer_description}`,
  ];
  if (args.vehicle_notes && args.vehicle_notes.trim().length > 0) {
    parts.push(
      `# Optional context — vehicle notes the customer added at Step 6\n${args.vehicle_notes}`,
    );
  }
  return parts.join("\n\n");
}

export async function diagnoseConcern(
  args: DiagnoseConcernArgs,
): Promise<DiagnoseConcernResult> {
  const model = process.env.DIAGNOSE_CONCERN_MODEL || DEFAULT_MODEL;
  const startedAt = Date.now();

  const allIds = args.questions.map((q) => q.id);
  void allIds; // retained for future fail-safe variants; intentionally
               // unused now (Bug fix 2026-05-16 — fail-safe no longer
               // returns all IDs because that overwhelms the customer
               // with off-topic questions).

  // Fail-safe on LLM error / Zod parse failure: return []. The customer's
  // free-form description is still saved on the row (explanation_text)
  // for the technician to review, and the wizard advances past
  // clarification without asking anything. Acceptable degradation —
  // better than throwing 37 brake questions at a customer who said
  // "brakes are grinding."
  const failSafe = (errorMessage: string): DiagnoseConcernResult => ({
    unanswered_question_ids: [],
    parsed_ok: false,
    model,
    latency_ms: Date.now() - startedAt,
    tokens_in: 0,
    tokens_out: 0,
    error_message: errorMessage,
  });

  if (args.questions.length === 0) {
    return {
      unanswered_question_ids: [],
      parsed_ok: true,
      model,
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      error_message: "",
    };
  }

  // Bug fix 2026-05-16: empty / very-short descriptions used to return
  // ALL IDs (rule "ask too much rather than miss critical information").
  // That was the wrong instinct — when the customer types nothing useful,
  // we shouldn't bombard them with 37 questions for the brake category.
  // Return [] so the system advances past clarification without asking
  // anything; the customer's original concern_text is still saved for
  // the technician to review. Subcategory-narrowing prompt (above) is
  // the load-bearing fix; this is the safety net for the zero-info case.
  if (!args.customer_description || args.customer_description.trim().length < 3) {
    return {
      unanswered_question_ids: [],
      parsed_ok: true,
      model,
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      error_message: "",
    };
  }

  let parsed: z.infer<typeof Schema>;
  let tokensIn = 0;
  let tokensOut = 0;
  try {
    const result = await generateObject({
      model: anthropic(model),
      system: buildSystemPrompt(args),
      prompt: buildUserPrompt(args),
      schema: Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    parsed = result.object;
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    tokensIn = Number(usage.inputTokens ?? 0);
    tokensOut = Number(usage.outputTokens ?? 0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: {
        surface: "diagnose_concern_llm",
        category: args.category,
      },
      level: "warning",
      extra: {
        question_count: args.questions.length,
        description_len: args.customer_description.length,
      },
    });
    return failSafe(`llm_call_failed: ${msg.slice(0, 200)}`);
  }

  const validIdSet = new Set(allIds);
  const filtered = parsed.unanswered_question_ids.filter((id) =>
    validIdSet.has(id),
  );
  const dedup = Array.from(new Set(filtered));

  return {
    unanswered_question_ids: dedup,
    parsed_ok: true,
    model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: "",
  };
}
