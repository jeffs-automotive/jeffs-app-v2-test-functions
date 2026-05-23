/**
 * Shared Anthropic SDK mock factory for diagnoseConcern + future LLM unit tests.
 *
 * Why: `diagnose-concern.ts` instantiates `new Anthropic(...)` at module top,
 * so tests need to swap the SDK constructor BEFORE the module-under-test is
 * imported. Vitest's `vi.mock("@anthropic-ai/sdk", () => ({ default: ... }))`
 * does that via automatic hoisting. This factory shapes the fake client +
 * exposes the underlying `create` spy for prompt-inspection assertions.
 *
 * Shape: `client.messages.create(...)` is what the production module calls.
 * The Anthropic SDK's `Message` type expects:
 *   - content: Array<ContentBlock>   // we yield a single text block
 *   - usage:   { input_tokens, output_tokens, ... }
 *   - stop_reason: 'end_turn' | …
 *   - role:    'assistant'
 *   - id, model, type:'message'
 * We populate the minimum the module reads (textBlock.text, usage tokens).
 *
 * Patterns supported:
 *   - Sequential canned responses via `addStageResponse(json)` / `addStageError(err)`
 *   - Per-call throw-then-resolve via the queue (push errors in front of success)
 */
import { vi, type Mock } from "vitest";

export interface MockedAnthropicMessage {
  content: Array<{ type: "text"; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
  };
  stop_reason: "end_turn";
  id: string;
  model: string;
  role: "assistant";
  type: "message";
  stop_sequence: null;
  container: null;
  stop_details: null;
}

export type QueueEntry =
  | { kind: "resolve"; value: MockedAnthropicMessage }
  | { kind: "throw"; error: Error };

export interface MockAnthropicHandle {
  /** The fake `messages.create` mock — assert calls, args, callCount on this. */
  create: Mock;
  /** Append a canned JSON-encoded text response to the queue. */
  addStageResponse: (
    json: unknown,
    opts?: { tokens_in?: number; tokens_out?: number; model?: string },
  ) => void;
  /** Append a thrown error to the queue (consumed on next call). */
  addStageError: (message: string) => void;
  /** Clear the queue between tests. */
  reset: () => void;
}

/**
 * Build a fake Anthropic client with a queue-backed `messages.create`. Each
 * call dequeues ONE entry (FIFO):
 *   - resolve → returns the canned Message
 *   - throw   → throws the canned Error (simulates gateway 5xx)
 * If the queue is empty, subsequent calls reject with an explicit message so
 * tests fail loudly rather than silently calling production code.
 */
export function createMockAnthropicClient(): MockAnthropicHandle {
  const queue: QueueEntry[] = [];

  const create = vi.fn(async () => {
    const entry = queue.shift();
    if (!entry) {
      throw new Error(
        "[mock-anthropic] queue exhausted — unexpected extra call to messages.create",
      );
    }
    if (entry.kind === "throw") {
      throw entry.error;
    }
    return entry.value;
  });

  function buildMessage(
    json: unknown,
    tokens_in: number,
    tokens_out: number,
    model: string,
  ): MockedAnthropicMessage {
    return {
      content: [{ type: "text", text: JSON.stringify(json) }],
      usage: {
        input_tokens: tokens_in,
        output_tokens: tokens_out,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
      stop_reason: "end_turn",
      id: "msg_mock_" + Math.random().toString(36).slice(2, 10),
      model,
      role: "assistant",
      type: "message",
      stop_sequence: null,
      container: null,
      stop_details: null,
    };
  }

  return {
    create,
    addStageResponse(json, opts) {
      queue.push({
        kind: "resolve",
        value: buildMessage(
          json,
          opts?.tokens_in ?? 100,
          opts?.tokens_out ?? 50,
          opts?.model ?? "anthropic/claude-haiku-4-5",
        ),
      });
    },
    addStageError(message) {
      queue.push({ kind: "throw", error: new Error(message) });
    },
    reset() {
      queue.length = 0;
      create.mockClear();
    },
  };
}

/**
 * Singleton handle the test file consumes after `vi.mock(...)` hoists. Tests
 * import this, then drive `queueResponse(...)` / `queueError(...)` to set up
 * each test's per-stage expectations.
 *
 * The `vi.mock("@anthropic-ai/sdk", ...)` factory in the test file returns a
 * default export that's the `Anthropic` class — our fake constructor closes
 * over this singleton so every `new Anthropic({...})` shares the same queue.
 */
export const sharedMockAnthropic = createMockAnthropicClient();

/**
 * Returned by the `default` export of the mocked module — must be a CLASS
 * (or function called via `new`) because `diagnose-concern.ts` does
 * `new Anthropic(...)`. A plain arrow-fn factory would throw
 * "X is not a constructor."
 */
export class MockAnthropicConstructor {
  messages: { create: Mock };

  constructor() {
    this.messages = { create: sharedMockAnthropic.create };
  }
}
