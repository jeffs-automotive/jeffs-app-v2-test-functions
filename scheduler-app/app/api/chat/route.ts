/**
 * Chat agent endpoint for scheduler-app.
 *
 * Per appointments_design.md §2 + §7.1 + scheduler-research/01-frontend-ai-sdk.md:
 *   - Runtime: nodejs (NOT edge) — AI SDK v5 + multi-provider doesn't fit
 *     in Edge runtime's 25MB / 30s limits per design §15 Q3
 *   - maxDuration = 300 (Pro plan)
 *   - Streams a UI message stream back via toUIMessageStreamResponse
 *   - Persists messages via chat-store on onFinish
 *   - A/B between gpt-5.4-mini and gemini-3.1-flash via Vercel AI Gateway
 *     (deterministic per-session; same chatId always picks the same model)
 *
 * Request shape (per design §7.1 / "send only the last message" pattern
 * from scheduler-research):
 *   POST /api/chat
 *   Body: { id: string (chatId), message: UIMessage }
 *
 * Response: a v5 UI message stream the client's useChat() consumes.
 */
import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai";
import { gateway } from "@ai-sdk/gateway";
import {
  ensureSessionExists,
  loadChat,
  saveChat,
} from "@/lib/scheduler/chat-store";
import { makeChatAgentTools } from "@/lib/scheduler/tools";
import { buildSystemPrompt } from "@/lib/scheduler/system-prompt";
import { getRoutineServicesForChips } from "@/lib/scheduler/routine-services-cache";
import { buildSessionSnapshot } from "@/lib/scheduler/session-context";

export const runtime = "nodejs";
export const maxDuration = 300;

const SHOP_PHONE_DISPLAY = "(610) 253-6565";

export async function POST(req: Request) {
  let body: { id?: string; message?: UIMessage };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const chatId = body.id;
  const lastMessage = body.message;

  if (!chatId || typeof chatId !== "string") {
    return new Response(
      JSON.stringify({ error: "Missing required `id` (chatId)" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!lastMessage || typeof lastMessage !== "object") {
    return new Response(
      JSON.stringify({ error: "Missing required `message` (UIMessage)" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Idempotent session bootstrap — Phase 1 uses client-side-generated chatIds
  // (localStorage), so the first request for a given chatId needs to insert
  // the customer_chat_sessions row before saveChat can attach messages to it.
  await ensureSessionExists({ chatId, channel: "web" });

  // Load prior history server-side; the client only sends the last message.
  // The server is the source of truth for chat state.
  //
  // MERGE BY ID, NOT APPEND (fix 2026-05-13): when the customer submits a
  // rendering-tool card (PhoneNameCard, etc.), AI SDK v5's addToolResult
  // appends a tool-output part to the EXISTING assistant message in the
  // client's local state, then sendAutomaticallyWhen auto-fires sendMessage.
  // The "last message" the client sends is the SAME assistant message —
  // same id, but now with tool output. A naive append produces TWO copies of
  // that assistant message in `allMessages` (old version without tool output
  // from DB + new version with tool output from the request), which OpenAI
  // rejects with "No tool output found for function call <id>" because it
  // sees the first copy's tool call as unanswered.
  //
  // Replacing by id keeps the conversation array well-formed: each assistant
  // message appears exactly once with the latest version of its parts.
  const previousMessages = await loadChat(chatId);
  const allMessages: UIMessage[] = (() => {
    const existingIdx = previousMessages.findIndex((m) => m.id === lastMessage.id);
    if (existingIdx >= 0) {
      const copy = [...previousMessages];
      copy[existingIdx] = lastMessage;
      return copy;
    }
    return [...previousMessages, lastMessage];
  })();

  // Pick model deterministically per session (simple A/B per design §2).
  const model = pickModelForSession(chatId);

  // Build tools + system prompt for THIS request (so consult_orchestrator
  // is bound to this session_id).
  const tools = makeChatAgentTools({ session_id: chatId });
  const routineServices = await getRoutineServicesForChips();
  const baseSystem = buildSystemPrompt({
    channel: "web",
    routine_services: routineServices,
    shop_phone_display: SHOP_PHONE_DISPLAY,
  });

  // Stage 3 (row-as-truth refactor 2026-05-13): build a compact snapshot
  // from customer_chat_sessions and append it to the system prompt. This
  // gives the agent the AUTHORITATIVE wizard state without it having to
  // parse prior message text. Locked architecture decision #1.
  const snapshot = await buildSessionSnapshot(chatId);
  const system = snapshot ? `${baseSystem}\n\n${snapshot}` : baseSystem;

  const result = streamText({
    model,
    system,
    messages: convertToModelMessages(allMessages),
    tools,
    // Stop after a reasonable number of steps to bound any runaway tool
    // chain. 8 covers: consult → render tool → consult → render tool →
    // consult → confirm path. If the chat agent legitimately needs more,
    // we can bump this in a later iteration.
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: allMessages,
    generateMessageId: () => crypto.randomUUID(),
    onFinish: async ({ messages }) => {
      await saveChat({ chatId, messages });
    },
  });
}

/**
 * Hash the chatId to a stable bucket and pick a model. Same chatId always
 * picks the same model — that way a customer's experience is consistent
 * across turns of the same conversation.
 *
 * Canonical IDs verified against https://ai-gateway.vercel.sh/v1/models on
 * 2026-05-13. Note the design lock spec'd "gemini-3.1-flash" but the
 * catalog only ships "gemini-3.1-flash-lite" (no plain -flash variant);
 * lite still has tool-use + reasoning + vision tags so it satisfies the
 * "fast + cheap + tool-capable" design intent.
 *
 * Spike TODO (per design §17): once Vercel AI Gateway's per-request
 * function-form selection is verified, swap this for the canonical
 * Gateway pattern.
 */
function pickModelForSession(chatId: string) {
  let hash = 0;
  for (let i = 0; i < chatId.length; i++) {
    hash = (hash * 31 + chatId.charCodeAt(i)) | 0;
  }
  const bucket = Math.abs(hash) % 2;
  return bucket === 0
    ? gateway("openai/gpt-5.4-mini")
    : gateway("google/gemini-3.1-flash-lite");
}
