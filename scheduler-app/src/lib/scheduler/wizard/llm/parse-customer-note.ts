/**
 * parseCustomerNote — Phase 13 (2026-05-16) customer-note rewriter.
 *
 * Per chat-design.md §Step 10.3 (lines 2667-2714) + the 2026-05-16
 * amendment §10.3-10.5: when a customer's post-confirm note is ≤150 chars
 * the chat agent parses + trims + rewrites it as a clean, advisor-
 * readable instruction that preserves the customer's meaning + voice.
 * The customer then approves or rejects.
 *
 * SECOND real use of the LLM in the new server-state-driven architecture
 * (after Step 7 diagnostic gap-detection). Same model + adapter pattern
 * as diagnose-concern.ts.
 *
 * Inputs:
 *   - raw_text          — the customer's typed note (≤150 chars per caller)
 *   - attempt           — 1 = first parse; 2 = "re-parse with different
 *                         wording" after the customer rejected attempt 1.
 *                         The prompt nudges the model toward an alternate
 *                         phrasing on attempt 2 so the second preview
 *                         doesn't read the same as the first.
 *   - customer_first_name — optional, threaded into voice cues only (we
 *                         do NOT prefix the parsed text with the name).
 *
 * Output: `{ parsed_text: string, reasoning: string }`.
 *   parsed_text is guaranteed to be ≤150 chars (post-process trim is the
 *   final safety net; the prompt asks for ≤140 to leave headroom).
 *
 * Defensive fallback: on LLM error OR Zod parse failure we return the
 * raw_text unchanged + parsed_ok:false. The caller (submit-customer-notes)
 * may decide to escalate after repeated fallbacks, OR just present the
 * raw text as the preview (better than a stuck approval loop).
 *
 * Model: Haiku 4.5 — fast + cheap + reliable for short structured
 * rewrites. Env override: PARSE_CUSTOMER_NOTE_MODEL.
 */
import { anthropic } from "@ai-sdk/anthropic";
import * as Sentry from "@sentry/nextjs";
import { generateObject } from "ai";
import { z } from "zod";

const DEFAULT_MODEL = "claude-haiku-4-5";
const MAX_OUTPUT_TOKENS = 256;
const TARGET_MAX_CHARS = 150;

export interface ParseCustomerNoteArgs {
  raw_text: string;
  attempt: 1 | 2;
  customer_first_name?: string | null;
}

export interface ParseCustomerNoteResult {
  parsed_text: string;
  reasoning: string;
  parsed_ok: boolean;
  model: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  /** Set when parsed_ok is false. Empty string on success. */
  error_message: string;
}

const Schema = z.object({
  parsed_text: z
    .string()
    .min(1)
    .max(TARGET_MAX_CHARS)
    .describe(
      "The cleaned-up note, ≤140 chars. First-person customer voice. " +
        "Preserves meaning + concrete facts. Fixes typos + grammar. " +
        "Drop greetings + filler (\"hey\", \"just wanted to mention\"). " +
        "Keep specific landmarks (seat position, plate location, " +
        "after-hours pickup) verbatim — they're load-bearing for techs.",
    ),
  reasoning: z
    .string()
    .max(240)
    .describe(
      "One-sentence rationale for the audit trail. Cite which parts of " +
        "the customer's literal words you kept or trimmed.",
    ),
});

function buildSystemPrompt(attempt: 1 | 2): string {
  const variationCue =
    attempt === 1
      ? "Default wording — direct + concise."
      : "ALTERNATE wording — the customer rejected the first version. " +
        "Vary sentence structure, word choice, or emphasis. The MEANING " +
        "must stay identical; only the surface phrasing changes.";

  return `You are the customer-note rewriter for Jeff's Automotive's online
scheduler. The customer just confirmed an appointment and is leaving a
short note for the service team. Your job is to rewrite that note as a
clean, advisor-readable instruction the technician will see on the
appointment card.

# Rules

1. **Preserve meaning.** Never drop a concrete fact. If the customer
   said "front passenger door handle is loose," the parsed version must
   still mention the front passenger door handle and "loose".
2. **First-person customer voice.** The note is FROM the customer, so
   write as the customer would: "My car has..." / "Please don't move..."
   NOT "Customer reports..." / "Vehicle has...".
3. **Trim filler.** Drop greetings ("hey", "hi guys"), apologies ("sorry
   to bother"), and meta-commentary ("just wanted to let you know").
4. **Fix typos + grammar** without changing word choice the customer
   clearly intended (slang, brand names, model years).
5. **≤140 characters.** Hard cap. Tighten where you can; never invent
   to fill space.
6. **${variationCue}**
7. **No formatting** — plain text, no quotes, no bullet points, no
   prefix like "Customer note:" (the system adds that downstream).
8. **The reasoning is for our audit log.** One sentence, no formatting.
   Cite the customer's literal words to justify what you kept or
   trimmed.`;
}

function buildUserPrompt(args: ParseCustomerNoteArgs): string {
  const lines: string[] = [`# Customer's raw note\n${args.raw_text.trim()}`];
  if (args.customer_first_name && args.customer_first_name.trim().length > 0) {
    lines.push(
      `# Customer (for tone context only — do NOT prefix the parsed text with the name)\n${args.customer_first_name.trim()}`,
    );
  }
  return lines.join("\n\n");
}

export async function parseCustomerNote(
  args: ParseCustomerNoteArgs,
): Promise<ParseCustomerNoteResult> {
  const model = process.env.PARSE_CUSTOMER_NOTE_MODEL || DEFAULT_MODEL;
  const startedAt = Date.now();

  const failSafe = (errorMessage: string): ParseCustomerNoteResult => ({
    parsed_text: args.raw_text.trim().slice(0, TARGET_MAX_CHARS),
    reasoning: "fail-safe: returning raw text unchanged due to LLM error",
    parsed_ok: false,
    model,
    latency_ms: Date.now() - startedAt,
    tokens_in: 0,
    tokens_out: 0,
    error_message: errorMessage,
  });

  const raw = (args.raw_text ?? "").trim();
  if (!raw) {
    return {
      parsed_text: "",
      reasoning: "empty input",
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
      system: buildSystemPrompt(args.attempt),
      prompt: buildUserPrompt(args),
      schema: Schema,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // OBS-5: emit Vercel AI SDK telemetry. See diagnose-concern.ts for
      // the recordInputs/recordOutputs rationale (post-booking customer
      // notes are PII).
      experimental_telemetry: {
        isEnabled: true,
        functionId: "parse-customer-note",
        recordInputs: false,
        recordOutputs: false,
      },
    });
    parsed = result.object;
    const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
    tokensIn = Number(usage.inputTokens ?? 0);
    tokensOut = Number(usage.outputTokens ?? 0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    Sentry.captureException(e, {
      tags: {
        surface: "parse_customer_note_llm",
        attempt: String(args.attempt),
      },
      level: "warning",
      extra: { raw_length: raw.length },
    });
    return failSafe(`llm_call_failed: ${msg.slice(0, 200)}`);
  }

  // Belt-and-suspenders: hard-trim to TARGET_MAX_CHARS in case the model
  // ignored the Zod max. (Zod max above blocks the model from returning
  // > 150 chars, but model fallbacks / retries are unpredictable.)
  const trimmed = parsed.parsed_text.trim().slice(0, TARGET_MAX_CHARS);

  return {
    parsed_text: trimmed,
    reasoning: parsed.reasoning,
    parsed_ok: true,
    model,
    latency_ms: Date.now() - startedAt,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    error_message: "",
  };
}
