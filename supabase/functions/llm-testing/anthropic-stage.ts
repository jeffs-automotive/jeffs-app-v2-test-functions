// anthropic-stage — llm-testing module.
// Extracted from llm-testing/index.ts (file-size-refactor). Mechanical split.

import Anthropic from "npm:@anthropic-ai/sdk@^0.97";
import { z } from "npm:zod@^4";
import { FALLBACK_MODEL, MAX_OUTPUT_TOKENS, anthropic } from "./config.ts";

// ════════════════════════════════════════════════════════════════════
// ANTHROPIC SDK STAGE CALLER (with retry + Zod validation)
// ════════════════════════════════════════════════════════════════════

interface StageCallResult<T> {
  raw: T | null;
  rawJsonText: string | null;
  tokensIn: number;
  tokensOut: number;
  errorMessage: string | null;
  attempts: number;
}

export async function callAnthropicStage<T>(args: {
  model: string;
  systemPrompt: Anthropic.TextBlockParam[];
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  zodSchema: z.ZodType<T>;
}): Promise<StageCallResult<T>> {
  let lastError: Error | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    attempts = attempt + 1;
    try {
      const msg = await anthropic.messages.create({
        model: args.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        // Array-form system prompt with cache_control on the static
        // portion — see buildStage{1,2,3}SystemPrompt for the split.
        // Anthropic prompt caching docs:
        // https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
        // String-form system prompts silently disable caching. We do NOT
        // also pass providerOptions.gateway.caching='auto' — picking one
        // marker (explicit cache_control) avoids double-marking.
        system: args.systemPrompt,
        messages: [{ role: "user", content: args.userPrompt }],
        // Vercel AI Gateway model-fallback extension — gateway interprets
        // this via the proxy layer; the Anthropic SDK passes through
        // untouched. caching:'auto' deliberately omitted (see above).
        // @ts-expect-error - gateway extensions not in Anthropic SDK types
        providerOptions: {
          gateway: {
            models: [args.model, FALLBACK_MODEL],
          },
        },
        // GA structured outputs (synced 2026-07-02 with the production
        // diagnose-concern.ts migration): `output_config.format` on plain
        // messages.create, no beta header. Replaces the deprecated
        // `output_format` + structured-outputs-2025-11-13 pair.
        output_config: {
          format: {
            type: "json_schema",
            schema: args.jsonSchema,
          },
        },
      });

      const textBlock = msg.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("no_text_block_in_response");
      }
      const rawJsonText = textBlock.text;
      const parsedJson = JSON.parse(rawJsonText) as unknown;
      const validated = args.zodSchema.parse(parsedJson);
      return {
        raw: validated,
        rawJsonText,
        tokensIn: msg.usage?.input_tokens ?? 0,
        tokensOut: msg.usage?.output_tokens ?? 0,
        errorMessage: null,
        attempts,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  return {
    raw: null,
    rawJsonText: null,
    tokensIn: 0,
    tokensOut: 0,
    errorMessage: lastError?.message ?? "unknown_error",
    attempts,
  };
}
