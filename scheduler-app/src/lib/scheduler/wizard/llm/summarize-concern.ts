/**
 * summarizeConcern — 2026-05-18 LLM helper.
 *
 * Synthesizes the customer's free-text concern + their clarification Q&A
 * answers into ONE natural-English paragraph the service writer can paste
 * into the Tekmetric appointment description. Format follows Chris's
 * 2026-05-18 directive — start with "Customer states", weave the Q&A
 * facts into the description, end with a period:
 *
 *   "Customer states there is a thumping noise coming from the front
 *    right of the vehicle when going over bumps."
 *
 * Inputs (per concern):
 *   - explanation_text:  the customer's free-text description from Step 7.2
 *   - qa_pairs:          ordered list of { question, answer } strings the
 *                        customer answered during Step 7.4 clarification
 *
 * Output: { summary: string }
 *
 * Fail-safe: any LLM/Zod error returns a fallback that quotes the
 * explanation_text verbatim ("Customer states: <description>") — the
 * Tekmetric description still has the customer's words, just without
 * the synthesis.
 *
 * Model: claude-haiku-4-5 (cheap, fast — same as diagnose-concern).
 * Override via SUMMARIZE_CONCERN_MODEL env var.
 */
import { anthropic } from "@ai-sdk/anthropic";
import * as Sentry from "@sentry/nextjs";
import { generateObject } from "ai";
import { z } from "zod";

const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 256;

export interface SummarizeConcernArgs {
  /** The customer's free-text concern description from Step 7.2. May be
   *  short ("brakes are grinding") or long. */
  explanation_text: string;
  /** Ordered question/answer pairs the customer tapped through in Step
   *  7.4. Empty array → summary is just the explanation_text reworded. */
  qa_pairs: Array<{ question_text: string; answer: string }>;
  /** Optional context: the chip the customer originally picked. Helps
   *  the LLM disambiguate ("Brake Inspection" vs "Other Issue"). NOT
   *  rendered in the summary unless the description doesn't make the
   *  concern clear. */
  chip_display_name?: string;
}

export interface SummarizeConcernResult {
  summary: string;
  /** TRUE when the LLM call succeeded + parse passed. FALSE means we
   *  fell back to a deterministic "Customer states: <description>". */
  parsed_ok: boolean;
  model: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  error_message: string;
}

const Schema = z.object({
  summary: z
    .string()
    .min(8, "summary too short")
    .max(600, "summary too long"),
});

function fallbackSummary(args: SummarizeConcernArgs): string {
  const desc = args.explanation_text.trim();
  if (desc.length === 0) {
    return args.chip_display_name
      ? `Customer reported a concern related to ${args.chip_display_name}.`
      : `Customer reported a concern but did not describe it.`;
  }
  // Already starts with "Customer states"? Use as-is.
  if (/^customer\s+(states|reports|says)\b/i.test(desc)) {
    return desc.endsWith(".") ? desc : `${desc}.`;
  }
  return `Customer states: ${desc}${desc.endsWith(".") ? "" : "."}`;
}

export function buildSystemPrompt(_args: SummarizeConcernArgs): string {
  return `You are the service-writer summary helper for Jeff's Automotive. A
customer just walked through a free-text concern description plus a
short multiple-choice questionnaire. Your job is to write ONE natural-
English paragraph that the service writer will paste into the
appointment description for the technician.

# Output requirements

1. **Start with "Customer states"** (or "Customer reports" if "states"
   doesn't flow). Speak about the customer in third person.
2. **Synthesize the description AND the Q&A answers** into one sentence
   (two short ones max). Don't repeat the questions — fold the
   information into the prose. Example:
   - Description: "thump when going over bumps"
   - Q1: "Front, rear, left, right?" → "Front right"
   - Q2: "Suddenly or gradually?" → "Suddenly"
   - Q3: "Recent brake work?" → "No"
   - Summary: "Customer states there is a thumping noise coming from
     the front-right of the vehicle that started suddenly when going
     over bumps; no recent brake work."
3. **Drop "Not sure" / "Skipped" answers entirely** — those add noise.
4. **Drop the chip-level metadata** (don't say "selected the brake
   inspection chip"). The summary is about the symptom, not the routing.
5. **Stay concise** — 1-2 sentences, ≤ 400 characters total when
   possible. Service writers scan these fast.
6. **End with a period.**
7. **Don't invent facts** the customer didn't actually report. If
   something wasn't in the description or Q&A, leave it out.

# What NOT to do

- Don't write "Customer brought their car in for…" — start with the
  symptom.
- Don't write "The technician should…" — that's not your job, the
  service writer adds that.
- Don't quote the customer verbatim if the wording is awkward; rephrase
  in clean English while preserving the meaning.
- Don't speculate on cause ("this could be a wheel bearing"). Just
  report what they said + what they answered.`;
}

export function buildUserPrompt(args: SummarizeConcernArgs): string {
  const lines: string[] = [];
  lines.push("# Customer's description");
  lines.push(args.explanation_text.trim() || "(no description provided)");
  if (args.chip_display_name) {
    lines.push("");
    lines.push("# Picker chip (context only — do not quote)");
    lines.push(args.chip_display_name);
  }
  if (args.qa_pairs.length > 0) {
    lines.push("");
    lines.push("# Clarification questions and answers");
    for (const qa of args.qa_pairs) {
      lines.push(`Q: ${qa.question_text}`);
      lines.push(`A: ${qa.answer}`);
    }
  } else {
    lines.push("");
    lines.push("# Clarification questions and answers");
    lines.push("(none — customer was not asked follow-up questions)");
  }
  return lines.join("\n");
}

export async function summarizeConcern(
  args: SummarizeConcernArgs,
): Promise<SummarizeConcernResult> {
  const model = process.env.SUMMARIZE_CONCERN_MODEL || DEFAULT_MODEL;
  const startedAt = Date.now();
  const failSafe = (errorMessage: string): SummarizeConcernResult => ({
    summary: fallbackSummary(args),
    parsed_ok: false,
    model,
    latency_ms: Date.now() - startedAt,
    tokens_in: 0,
    tokens_out: 0,
    error_message: errorMessage,
  });

  // Skip the LLM call for empty/very-short descriptions — no synthesis to
  // do; the fallback covers it.
  const desc = args.explanation_text.trim();
  if (desc.length < 3 && args.qa_pairs.length === 0) {
    return {
      summary: fallbackSummary(args),
      parsed_ok: true,
      model,
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      error_message: "",
    };
  }

  try {
    const result = await generateObject({
      model: anthropic(model),
      system: buildSystemPrompt(args),
      prompt: buildUserPrompt(args),
      schema: Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // OBS-5: emit Vercel AI SDK telemetry. See diagnose-concern.ts for
      // the recordInputs/recordOutputs rationale (customer-stated concern
      // text is PII).
      experimental_telemetry: {
        isEnabled: true,
        functionId: "summarize-concern",
        recordInputs: false,
        recordOutputs: false,
      },
    });
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    return {
      summary: result.object.summary.trim(),
      parsed_ok: true,
      model,
      latency_ms: Date.now() - startedAt,
      tokens_in: Number(usage.inputTokens ?? 0),
      tokens_out: Number(usage.outputTokens ?? 0),
      error_message: "",
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Defensive Sentry wrap — same pattern as diagnose-concern.ts. In
    // production Sentry is alive; in CLI/eval contexts the namespace is
    // frozen + uninitialised so `captureException` itself throws.
    try {
      Sentry.captureException(e, {
        tags: { surface: "summarize_concern_llm" },
        level: "warning",
        extra: {
          description_len: desc.length,
          qa_pair_count: args.qa_pairs.length,
        },
      });
    } catch {
      // Sentry unavailable — proceed with fallback.
    }
    return failSafe(`llm_call_failed: ${msg.slice(0, 200)}`);
  }
}
