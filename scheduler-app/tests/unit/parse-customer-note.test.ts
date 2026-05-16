import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Phase 17 (2026-05-16) — canonical V2 LLM-helper test.
 *
 * parseCustomerNote wraps the @ai-sdk Anthropic `generateObject` call
 * with: input validation, prompt assembly, an attempt-1-vs-attempt-2
 * wording cue, a Zod schema gate, a hard 150-char trim, and a fail-safe
 * that returns the raw text unchanged on any LLM error.
 *
 * The mock target is `generateObject` from "ai" — we hijack it so we
 * never make a real API call. The Anthropic provider import is left
 * intact (it's just a model factory; safe to import).
 */

const generateObjectMock = vi.fn();
vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
}));

// Sentry capture — silence the warning path so test logs stay clean.
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { parseCustomerNote } from "@/lib/scheduler/wizard/llm/parse-customer-note";

beforeEach(() => {
  generateObjectMock.mockReset();
});

describe("parseCustomerNote", () => {
  it("returns the parsed text + reasoning on a successful LLM call", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: {
        parsed_text: "Please don't move my driver seat — set just right.",
        reasoning: "Trimmed greeting; kept the seat-position constraint.",
      },
      usage: { inputTokens: 120, outputTokens: 40 },
    });

    const result = await parseCustomerNote({
      raw_text:
        "Hey guys, please don't move the driver seat — I have it set just right!",
      attempt: 1,
    });

    expect(result.parsed_ok).toBe(true);
    expect(result.parsed_text).toBe(
      "Please don't move my driver seat — set just right.",
    );
    expect(result.error_message).toBe("");
    expect(result.tokens_in).toBe(120);
    expect(result.tokens_out).toBe(40);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("hard-trims parsed_text to ≤150 chars (defensive belt-and-suspenders)", async () => {
    const overlong = "a".repeat(200);
    generateObjectMock.mockResolvedValueOnce({
      object: { parsed_text: overlong, reasoning: "ok" },
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    const result = await parseCustomerNote({
      raw_text: "anything",
      attempt: 1,
    });
    expect(result.parsed_text.length).toBeLessThanOrEqual(150);
    expect(result.parsed_ok).toBe(true);
  });

  it("returns fail-safe (raw text unchanged + parsed_ok=false) on LLM error", async () => {
    generateObjectMock.mockRejectedValueOnce(new Error("anthropic timeout"));

    const raw = "the brakes are squeaking";
    const result = await parseCustomerNote({ raw_text: raw, attempt: 1 });

    expect(result.parsed_ok).toBe(false);
    expect(result.parsed_text).toBe(raw);
    expect(result.error_message).toContain("anthropic timeout");
  });

  it("short-circuits to empty when raw_text is empty (no LLM call)", async () => {
    const result = await parseCustomerNote({ raw_text: "", attempt: 1 });

    expect(result.parsed_ok).toBe(true);
    expect(result.parsed_text).toBe("");
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("includes the ALTERNATE-wording cue in the system prompt on attempt=2", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { parsed_text: "rewritten differently", reasoning: "ok" },
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    await parseCustomerNote({ raw_text: "something", attempt: 2 });

    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    const callArg = generateObjectMock.mock.calls[0]![0] as { system: string };
    // The attempt-2 prompt is keyed off the phrase "ALTERNATE wording"
    // per parse-customer-note.ts buildSystemPrompt; this is the
    // canonical marker that a re-parse uses different wording.
    expect(callArg.system).toMatch(/ALTERNATE wording/);
  });

  it("uses the DEFAULT-wording cue on attempt=1 (not the alternate cue)", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { parsed_text: "first version", reasoning: "ok" },
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    await parseCustomerNote({ raw_text: "anything", attempt: 1 });

    const callArg = generateObjectMock.mock.calls[0]![0] as { system: string };
    expect(callArg.system).toMatch(/Default wording/);
    expect(callArg.system).not.toMatch(/ALTERNATE wording/);
  });

  it("passes the customer first name into the user prompt as voice context", async () => {
    generateObjectMock.mockResolvedValueOnce({
      object: { parsed_text: "ok", reasoning: "ok" },
      usage: { inputTokens: 10, outputTokens: 10 },
    });

    await parseCustomerNote({
      raw_text: "i would like the tires checked",
      attempt: 1,
      customer_first_name: "Sarah",
    });

    const callArg = generateObjectMock.mock.calls[0]![0] as { prompt: string };
    // Name should appear in the user prompt under the tone-context heading.
    expect(callArg.prompt).toMatch(/Sarah/);
  });
});
