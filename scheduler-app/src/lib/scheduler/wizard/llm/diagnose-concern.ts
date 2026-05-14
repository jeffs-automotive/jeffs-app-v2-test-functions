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
  const catalogLines = args.questions
    .map((q) => {
      const optionLabels = q.options.map((o) => o.label).join(" / ");
      return `  - id=${q.id}: "${q.question_text}" (options: ${optionLabels})`;
    })
    .join("\n");

  return `You are the diagnostic gap-detection helper for Jeff's Automotive.
The customer described a specific concern with their vehicle. We've already
classified the concern as: **${args.category_display_label}** (category="${args.category}").

Your single job: given the per-category guideline below AND the questionnaire
below AND the customer's free-form description, return the IDs of questions
the customer's description did NOT already answer.

# Category guideline (what matters for this kind of concern)

${args.guideline_prose}

# Questionnaire (id → question + visible option labels)

${catalogLines}

# Decision rules

1. **Skip questions the description already answers.** If the customer wrote
   "front of the car, only when braking" and a question asks "where on the car"
   AND another asks "when does it happen" — both are answered. Omit those IDs.

2. **Keep questions the description doesn't touch.** If the description is short
   and only covers symptom location, every question about timing / duration /
   recent changes is still unanswered. Include those IDs.

3. **Be generous about ambiguity.** If a question is only loosely addressed
   (the customer said "for a while" and the question asks how long), treat it
   as STILL UNANSWERED — better to confirm than assume.

4. **Never invent IDs.** Only return IDs that appear in the catalog above.

5. **When the description is empty or just a few words**, return ALL IDs.
   We'd rather ask too much than miss critical information.

6. **The reasoning is for our audit log, not the customer.** One sentence,
   no formatting. Cite the customer's literal words to justify which
   questions you skipped.`;
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

  const failSafe = (errorMessage: string): DiagnoseConcernResult => ({
    unanswered_question_ids: allIds,
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

  if (!args.customer_description || args.customer_description.trim().length < 3) {
    return {
      unanswered_question_ids: allIds,
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
