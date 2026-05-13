"use client";

/**
 * Chat — top-level client component for the scheduler conversation.
 *
 * Per appointments_design.md §2 + §7 + scheduler-research/01-frontend-ai-sdk.md:
 *   - Uses AI SDK v5 useChat from @ai-sdk/react
 *   - DefaultChatTransport with prepareSendMessagesRequest sending ONLY
 *     { id: chatId, message: <last> } per route handler contract
 *   - sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls so
 *     a rendering-tool result triggers the next assistant turn automatically
 *   - For each `tool-{name}` part, render the corresponding rendering
 *     component; on submit, call addToolResult to feed the result back
 *
 * Tool rendering is gated on state === 'input-available' so we don't
 * re-render the picker after the customer already submitted (that would
 * look broken). Once state advances to 'output-available' we render a
 * compact echo of the customer's choice for context.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";

import { PhoneEntry } from "./PhoneEntry";
import { OtpInput } from "./OtpInput";
import { VehiclePicker } from "./VehiclePicker";
import { ServiceAndConcernPicker } from "./ServiceAndConcernPicker";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { WaiterTimePicker } from "./WaiterTimePicker";
import { ConfirmationCard } from "./ConfirmationCard";
import { EscalationCard } from "./EscalationCard";
// Heritage Editorial cards (Chunk 6 — 2026-05-13). New directives route here.
import {
  AppointmentTypeCard,
  ChatBubble,
  ClarificationQuestionCard,
  CompletedCard,
  CustomerInfoEditCard,
  CustomerNotesCard,
  CustomerQuestionCard,
  GreetingCard,
  MultiAccountDisambiguationCard,
  NewCustomerInfoCard,
  NewVehicleCard,
  NoMatchChoosePathCard,
  PartialVerificationGateCard,
  PhoneNameCard,
  SummaryCard,
  TestingServiceApprovalCard,
  WizardFooter,
} from "./heritage";

// Row-as-truth Server Actions (Stage 2+3 refactor 2026-05-13). Each card's
// onSubmit calls the matching Server Action which writes columns + invokes
// orchestrator-direct as needed; the chat agent gets a structured directive
// in the tool result instead of raw customer payloads.
import {
  dismissEscalation,
  saveAssistantCardMessage,
  submitAppointmentType,
  submitClarificationAnswer,
  submitCustomerInfoEdit,
  submitCustomerNotes,
  submitCustomerQuestion,
  submitDate,
  submitEscalate,
  submitGreeting,
  submitMultiAccountChoice,
  submitNewCustomerInfo,
  submitNewVehicle,
  submitNoMatchChoice,
  submitOtp,
  submitPartialVerificationChoice,
  submitPhoneName,
  resendOtp,
  submitServiceAndConcernPicker,
  submitStartOver,
  submitSummaryConfirm,
  submitTestingApproval,
  submitVehiclePick,
  submitWaiterTime,
} from "@/lib/scheduler/actions/session-actions";
// Types + directive mapper live in a separate (non-"use server") file because
// Next.js 15 forbids non-async-function exports from a Server Actions file.
import {
  mapDirectiveToToolName,
  type SessionActionResult,
} from "@/lib/scheduler/actions/session-action-types";

/**
 * Prefix that marks a synthetic user message as a card-tap signal (NOT
 * something the customer typed). Per chat-design.md line 343 "Phase 1 has
 * zero free-text input except for the three explicit fields" — every other
 * user-event into the agent is a button tap or card submit, which we
 * model as a sentinel-prefixed message so:
 *   1. The chat agent's LLM doesn't have to pattern-match free-form English
 *   2. The visible chat-bubble log doesn't pollute with synthesized text
 *      the customer never typed
 *   3. The system prompt has an unambiguous "the customer tapped X"
 *      contract to act on
 *
 * Format: `[card-tap] <card-id>:<value>` (e.g.,
 * `[card-tap] greeting:returning`).
 *
 * Filtered out of the visible chat-bubble rendering by MessageBlock + by
 * the system prompt's FIRST_TURN_DISCLOSURE section. Persists into
 * customer_chat_messages for replay (the row already carries the
 * authoritative state).
 */
export const CARD_TAP_SENTINEL_PREFIX = "[card-tap] ";

export interface ChatProps {
  chatId: string;
  initialMessages?: UIMessage[];
  /**
   * Server-hydrated current_step from customer_chat_sessions. When null
   * OR 'greeting', show the client-side GreetingCard for Step 1. When
   * any later step, the customer is mid-flow — render persisted
   * messages + skip the greeting card. Closes GAP-1 from the codebase
   * audit (messages.length === 0 was unreliable as a fresh-session
   * signal).
   */
  initialStep?: string | null;
}

/**
 * The directive → tool-name set for which we render the next card
 * CLIENT-SIDE via setMessages instead of relying on the chat agent's
 * LLM to call the rendering tool.
 *
 * Rationale (2026-05-13 test failure): gpt-5.4-mini and
 * gemini-3.1-flash-lite (our AI Gateway chat-agent models) reliably
 * emit the bubble_copy text after a tool result but don't reliably
 * follow up with the directed tool call in the same turn. Customer
 * sees the bubble but no next card. Strengthening the prompt didn't
 * help; lite/mini models stop after text.
 *
 * Solution: for deterministic wizard transitions, synthesize an
 * assistant message client-side with the next card's tool-call part
 * (state='input-available' so the card renders + waits for customer
 * submit). The chat agent is bypassed for these transitions.
 *
 * Note: addToolResult is still called on the prior card's tool-call
 * part so AI SDK v5's tool-state tracking stays in sync. Then we
 * setMessages-append the new synthetic message. sendAutomaticallyWhen
 * sees the last assistant message has an incomplete tool call
 * (input-available, no output yet) → returns false → no LLM call.
 */
const CLIENT_RENDERED_DIRECTIVES = new Set<string>([
  "show_phone_name_card",
  "show_otp_input",
  "show_vehicle_picker",
  // Spec-aligned new-client cards (replaces show_new_customer_form):
  "show_new_customer_info_card",
  "show_new_vehicle_form",
  "show_customer_info_edit",
  "show_no_match_choose_path",
  "show_partial_verification_gate",
  "show_multi_account_disambiguation",
  "show_service_and_concern_picker",
  "show_clarification_question",
  "show_testing_service_approval",
  "show_appointment_type",
  "show_calendar_date_picker",
  "show_waiter_time_picker",
  "show_summary_card",
  "show_customer_notes_card",
  "show_customer_question_card",
  "show_completed_card",
  "show_escalation_card",
]);

/**
 * Custom sendAutomaticallyWhen predicate.
 *
 * Default behavior (`lastAssistantMessageIsCompleteWithToolCalls`) auto-fires
 * the chat agent whenever the last assistant message has all tool calls
 * complete. That's correct for the normal LLM-driven flow — but it fights
 * our client-side card injection for wizard transitions.
 *
 * Problem: after addToolResult marks the prior card's tool call complete,
 * AI SDK evaluates this predicate synchronously and fires a chat-agent
 * fetch before our setMessages-append of the synthesized next-card
 * assistant message lands. The chat agent then produces its own (often
 * duplicate) bubble + tool call which streams INTO the same assistant
 * message slot we just injected — leaving two text bubbles + two tool
 * call parts in one assistant message.
 *
 * Fix: inspect the LAST tool call's output. If its `directive` lives in
 * CLIENT_RENDERED_DIRECTIVES, we know our dispatchCardSubmit will
 * immediately synthesize the next card client-side — so the chat agent
 * has nothing to do. Return false to skip the auto-fetch.
 *
 * For all OTHER directives (e.g., orchestrator emitting natural-language
 * follow-ups, or tools whose next state we don't determine), fall back
 * to the default predicate.
 */
function shouldAutoSend({
  messages,
}: { messages: UIMessage[] }): boolean {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && Array.isArray(last.parts)) {
    // Walk backwards looking for the most recent tool part.
    for (let i = last.parts.length - 1; i >= 0; i--) {
      const part = last.parts[i] as
        | { type?: string; state?: string; output?: { directive?: unknown } }
        | undefined;
      if (
        part &&
        typeof part.type === "string" &&
        part.type.startsWith("tool-")
      ) {
        if (part.state === "output-available") {
          const directive = part.output?.directive;
          if (
            typeof directive === "string" &&
            CLIENT_RENDERED_DIRECTIVES.has(directive)
          ) {
            return false;
          }
        }
        break; // only inspect the most recent tool part
      }
    }
  }
  return lastAssistantMessageIsCompleteWithToolCalls({ messages });
}

export function Chat({ chatId, initialMessages, initialStep }: ChatProps) {
  const { messages, setMessages, sendMessage, addToolResult, status } = useChat({
    id: chatId,
    messages: initialMessages ?? [],
    transport: new DefaultChatTransport({
      api: "/api/chat",
      // Per appointments_design.md §2, the route handler is the source of
      // truth for chat state — we send only the last message + chatId.
      prepareSendMessagesRequest: ({ messages, id }) => ({
        body: { id, message: messages[messages.length - 1] },
      }),
    }),
    sendAutomaticallyWhen: shouldAutoSend,
  });

  const [draft, setDraft] = useState("");
  const isWorking = status === "submitted" || status === "streaming";

  // Offline detection per chat-design.md §D (Error states). When the
  // browser reports navigator.onLine === false, surface a banner so the
  // customer knows their last action didn't go through. The chat itself
  // doesn't retry — that's Phase 1.1; for now we just warn.
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    // Initial sync (navigator.onLine is only available in browser).
    if (typeof navigator !== "undefined" && "onLine" in navigator) {
      setIsOnline(navigator.onLine);
    }
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Slow-specialist timers per chat-design.md §D.2 (lines 3013-3036). When
  // the orchestrator-direct call exceeds 15s, show a reassurance bubble;
  // at 45s, offer escalation. Triggered off `isWorking` (covers Server
  // Action latency PLUS the chat agent's streaming response).
  const [workingElapsedMs, setWorkingElapsedMs] = useState(0);
  useEffect(() => {
    if (!isWorking) {
      setWorkingElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setWorkingElapsedMs(Date.now() - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [isWorking]);
  const slowStage: "fast" | "slow" | "very_slow" =
    workingElapsedMs >= 45_000
      ? "very_slow"
      : workingElapsedMs >= 15_000
        ? "slow"
        : "fast";

  // Phase 1 wizard-first + row-as-truth (Stage 2+3 refactor 2026-05-13).
  //
  // Step 1 (greeting) is rendered CLIENT-SIDE. When the customer taps a button,
  // we call submitGreeting() — the Server Action writes is_returning_customer
  // to the row, transitions current_step, and returns a directive (typically
  // show_phone_name_card). We then dispatch that directive through the chat
  // agent via sendMessage with a thin user-event so the agent renders the next
  // card. (Stage 3 will eliminate the chat-agent round-trip entirely; for now
  // the agent serves as a deterministic renderer reading the structured tool
  // output it receives.)
  async function handleGreetingPick(out: {
    is_returning: "returning" | "new" | "unsure";
  }) {
    if (isWorking) return;
    const result = await submitGreeting({
      chatId,
      is_returning: out.is_returning,
    });
    if (!result.ok) {
      // Surface error via a synthetic user message — agent will likely escalate.
      void sendMessage({
        text: `[client-error] greeting submit failed: ${result.error ?? "unknown"}`,
      });
      return;
    }

    // CLIENT-SIDE RENDER of the next card (PhoneNameCard) — bypass the chat
    // agent entirely per the 2026-05-13 fix (lite/mini models don't
    // reliably emit tool-call after text). The row is already written by
    // submitGreeting; the directive is 'show_phone_name_card'; just
    // synthesize the assistant message + persist async.
    const mapped = mapDirectiveToToolName(result.directive);
    if (mapped && CLIENT_RENDERED_DIRECTIVES.has(mapped)) {
      const newMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          ...(result.bubble_copy?.trim()
            ? [{ type: "text" as const, text: result.bubble_copy }]
            : []),
          {
            type: `tool-${mapped}` as const,
            toolCallId: crypto.randomUUID(),
            state: "input-available" as const,
            input: (result.data ?? {}) as Record<string, unknown>,
          } as unknown as NonNullable<UIMessage["parts"]>[number],
        ],
      } as UIMessage;
      setMessages((prev) => [...prev, newMessage]);
      void saveAssistantCardMessage({
        chatId,
        message: newMessage as unknown as Record<string, unknown>,
      });
    }
  }

  // Generic card-submit dispatcher (Stage 2 refactor 2026-05-13).
  // Each AI-SDK rendering tool's onSubmit funnels here. We:
  //   1. Call the matching Server Action (writes row columns + orchestrator)
  //   2. Pass the structured directive back through addToolResult so the chat
  //      agent emits the next card.
  // Cards that don't need a Server Action (e.g. show_escalation_card → just
  // acknowledged) still go through the original `submit` path.
  async function dispatchCardSubmit(
    toolName: string,
    toolCallId: string,
    cardOutput: Record<string, unknown>,
  ): Promise<void> {
    let result: SessionActionResult | null = null;
    try {
      switch (toolName) {
        case "show_phone_name_card":
          result = await submitPhoneName({
            chatId,
            first_name: String(cardOutput.first_name ?? ""),
            last_name: String(cardOutput.last_name ?? ""),
            phone_e164: String(cardOutput.phone ?? ""),
          });
          break;
        case "show_phone_entry":
          // Legacy phone-only entry — call submitPhoneName with a placeholder
          // name; the orchestrator's existing matrix handles it.
          result = await submitPhoneName({
            chatId,
            first_name: "",
            last_name: "",
            phone_e164: String(cardOutput.phone ?? ""),
          });
          break;
        case "show_otp_input": {
          // Two card outputs: { code: "123456" } for submit, or
          // { action: "resend" } for resend. Per chat-design.md §Step 3
          // (lines 645-651) the resend has a 30s client-side cooldown
          // enforced by the card; here we just thread the action through.
          if (cardOutput.action === "resend") {
            result = await resendOtp({ chatId });
          } else {
            result = await submitOtp({
              chatId,
              code: String(cardOutput.code ?? ""),
            });
          }
          break;
        }
        case "show_vehicle_picker":
          result = await submitVehiclePick({
            chatId,
            vehicle_id: String(cardOutput.vehicle_id ?? ""),
          });
          break;
        case "show_new_customer_info_card": {
          // Step 4 new client per chat-design.md §2595-2683. Output shape
          // matches submitNewCustomerInfo: edited_phones, edited_emails,
          // edited_address, primary_email_for_description.
          result = await submitNewCustomerInfo({
            chatId,
            edited_phones: (cardOutput.edited_phones as Array<{
              phone_e164: string;
              is_primary: boolean;
            }>) ?? [],
            edited_emails: (cardOutput.edited_emails as Array<{
              email: string;
              is_primary: boolean;
            }>) ?? [],
            edited_address: cardOutput.edited_address as {
              address1: string;
              address2?: string;
              city: string;
              state: string;
              zip: string;
            },
            primary_email_for_description: String(
              cardOutput.primary_email_for_description ?? "",
            ),
          });
          break;
        }
        case "show_new_vehicle_form": {
          // Step 5 new client (§2684-2753) AND Step 6 returning add-new
          // drill-down (§1248-1306). Both use the same payload shape.
          result = await submitNewVehicle({
            chatId,
            vehicle: {
              year: Number(cardOutput.year ?? 0),
              make: String(cardOutput.make ?? ""),
              model: String(cardOutput.model ?? ""),
              license_plate: cardOutput.license_plate
                ? String(cardOutput.license_plate)
                : undefined,
              notes: cardOutput.notes ? String(cardOutput.notes) : undefined,
            },
          });
          break;
        }
        case "show_service_and_concern_picker":
          result = await submitServiceAndConcernPicker({
            chatId,
            services: Array.isArray(cardOutput.services)
              ? (cardOutput.services as string[])
              : [],
            concern_text: cardOutput.concern_text
              ? String(cardOutput.concern_text)
              : undefined,
          });
          break;
        case "show_clarification_question":
          result = await submitClarificationAnswer({
            chatId,
            question_id: Number(cardOutput.question_id ?? 0),
            answer: String(cardOutput.answer ?? "skipped"),
          });
          break;
        case "show_testing_service_approval":
          result = await submitTestingApproval({
            chatId,
            approved: Array.isArray(cardOutput.approved)
              ? (cardOutput.approved as string[])
              : [],
            declined: Array.isArray(cardOutput.declined)
              ? (cardOutput.declined as string[])
              : [],
          });
          break;
        case "show_appointment_type":
          result = await submitAppointmentType({
            chatId,
            appointment_type:
              cardOutput.appointment_type === "waiter" ? "waiter" : "dropoff",
          });
          break;
        case "show_calendar_date_picker":
          result = await submitDate({
            chatId,
            selected_date: String(cardOutput.selected_date ?? ""),
          });
          break;
        case "show_waiter_time_picker":
          result = await submitWaiterTime({
            chatId,
            selected_time: String(cardOutput.selected_time ?? ""),
          });
          break;
        case "show_summary_card":
        case "show_confirmation_card":
          result = await submitSummaryConfirm({
            chatId,
            confirmed: !!cardOutput.confirmed,
            edit_target: cardOutput.edit_target as never,
          });
          break;
        case "show_customer_notes_card":
          result = await submitCustomerNotes({
            chatId,
            text: cardOutput.text ? String(cardOutput.text) : null,
            approved: !!cardOutput.approved,
          });
          break;
        case "show_customer_question_card":
          result = await submitCustomerQuestion({
            chatId,
            question: cardOutput.question
              ? String(cardOutput.question)
              : null,
          });
          break;
        case "show_no_match_choose_path":
          result = await submitNoMatchChoice({
            chatId,
            action:
              cardOutput.action === "try_different_phone"
                ? "try_different_phone"
                : "continue_as_new",
          });
          break;
        case "show_partial_verification_gate":
          result = await submitPartialVerificationChoice({
            chatId,
            action: cardOutput.action as
              | "use_different_phone"
              | "proceed_as_partial"
              | "continue_as_new"
              | "escalate",
          });
          break;
        case "show_multi_account_disambiguation": {
          const isSelect = cardOutput.action === "select";
          result = await submitMultiAccountChoice({
            chatId,
            action: isSelect ? "select" : "none_of_these",
            selected_customer_id: isSelect
              ? Number(cardOutput.selected_customer_id ?? 0)
              : undefined,
          });
          break;
        }
        case "show_customer_info_edit":
          result = await submitCustomerInfoEdit({
            chatId,
            edited_phones: Array.isArray(cardOutput.edited_phones)
              ? (cardOutput.edited_phones as Array<{
                  phone_e164: string;
                  is_primary: boolean;
                }>)
              : [],
            edited_emails: Array.isArray(cardOutput.edited_emails)
              ? (cardOutput.edited_emails as Array<{
                  email: string;
                  is_primary: boolean;
                }>)
              : [],
            edited_address:
              (cardOutput.edited_address as Record<string, string> | null) ??
              null,
            primary_email_for_description:
              typeof cardOutput.primary_email_for_description === "string"
                ? cardOutput.primary_email_for_description
                : null,
          });
          break;
        case "show_completed_card": {
          // Terminal state — two actions: "schedule_another" (restart via
          // submitStartOver, which clears the row + reloads) or "close"
          // (no-op acknowledgement; the customer typically just closes the
          // tab). No orchestrator call needed.
          if (cardOutput.action === "schedule_another") {
            result = await submitStartOver({ chatId });
          } else {
            result = {
              ok: true,
              directive: "continue",
              data: { action: cardOutput.action ?? "close" },
            };
          }
          break;
        }
        case "show_escalation_card":
          if (cardOutput.action === "back_to_scheduling") {
            // Customer chose to dismiss the escalation and continue
            // scheduling. The Server Action clears escalated_at +
            // escalation_reason + sets status=active + restores
            // current_step from the audit log. After the row write the
            // page state needs to catch up — easiest is a reload so the
            // server hydration picks up the restored step.
            result = await dismissEscalation({ chatId });
            if (result.ok) {
              // Defer the reload to the next microtask so addToolResult
              // can fire first (the agent's snapshot will reflect the new
              // current_step on the next turn).
              setTimeout(() => {
                window.location.reload();
              }, 50);
            }
            break;
          }
          // Passive acknowledgement — customer chose "I'll call".
          result = {
            ok: true,
            directive: "continue",
            data: { acknowledged: !!cardOutput.acknowledged },
          };
          break;
        default:
          // Unknown tool — just pass the raw output through.
          result = {
            ok: true,
            directive: "continue",
            data: cardOutput,
          };
      }
    } catch (e) {
      result = {
        ok: false,
        directive: "tool_error",
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // Translate the orchestrator's SEMANTIC directive (e.g. "send_otp_first",
    // "render_confirmation_card") into the chat agent's TOOL NAME (e.g.
    // "show_otp_input", "show_summary_card") before threading back. Without
    // this the agent has no matching tool for the directive and re-renders
    // the prior card → customer is stuck on the same step. The mapper is a
    // pure pass-through for directives that are already tool names.
    const normalizedResult: SessionActionResult = {
      ...result,
      directive: mapDirectiveToToolName(result.directive),
    };

    // Pass the Server Action's structured result back to the chat agent as
    // the tool output. The agent's system prompt is updated to expect this
    // shape: {ok, directive, data, bubble_copy?} — much easier for it to
    // route than parsing raw card payloads.
    addToolResult({
      tool: toolName,
      toolCallId,
      output: normalizedResult as unknown as Record<string, unknown>,
    });

    // ─── CLIENT-SIDE NEXT-CARD INJECTION (2026-05-13 bug fix) ──────────────
    //
    // The chat agent (gpt-5.4-mini / gemini-3.1-flash-lite) reliably emits
    // the bubble_copy text after a tool result but DOES NOT reliably call
    // the directed rendering tool in the same turn — it stops after text.
    // Customer sees the bubble but no next card. Strengthening the prompt
    // doesn't help with lite/mini models.
    //
    // Fix: for deterministic wizard transitions (CLIENT_RENDERED_DIRECTIVES
    // set), synthesize the next assistant message client-side via
    // setMessages — no chat-agent round-trip. The card renders immediately;
    // sendAutomaticallyWhen sees the new last message has an incomplete
    // tool call (state='input-available', no output) → returns false → no
    // LLM call. The chat agent is bypassed for wizard transitions.
    //
    // Persistence: setMessages updates client state; the saveAssistantCardMessage
    // Server Action upserts the synthetic message into customer_chat_messages
    // so resume/refresh works. Best-effort — don't block UI on the persist.
    const nextDirective = normalizedResult.directive;
    if (
      nextDirective &&
      CLIENT_RENDERED_DIRECTIVES.has(nextDirective) &&
      normalizedResult.ok !== false
    ) {
      const nextToolCallId = crypto.randomUUID();
      const nextMessageId = crypto.randomUUID();
      const bubble = normalizedResult.bubble_copy?.trim();
      const inputData =
        (normalizedResult.data as Record<string, unknown> | undefined) ?? {};
      const newMessage: UIMessage = {
        id: nextMessageId,
        role: "assistant",
        parts: [
          ...(bubble
            ? [{ type: "text" as const, text: bubble }]
            : []),
          {
            type: `tool-${nextDirective}` as const,
            toolCallId: nextToolCallId,
            state: "input-available" as const,
            input: inputData,
          } as unknown as NonNullable<UIMessage["parts"]>[number],
        ],
      } as UIMessage;

      setMessages((prev) => [...prev, newMessage]);

      // Persist async; don't await. saveAssistantCardMessage is a Server
      // Action that upserts a single row in customer_chat_messages so a
      // page refresh during this turn doesn't lose the card.
      void saveAssistantCardMessage({
        chatId,
        message: newMessage as unknown as Record<string, unknown>,
      });
    }
  }

  function onSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isWorking) return;
    setDraft("");
    void sendMessage({ text });
  }

  // Phase 1: wizard-first. Hide the free-form chat input by default — the
  // customer interacts via cards. Set NEXT_PUBLIC_SCHEDULER_SHOW_CHAT_INPUT=1
  // in Vercel env to surface it for debug / future Phase 2 work.
  const showChatInput =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_SCHEDULER_SHOW_CHAT_INPUT === "1";

  // ─── WizardFooter handlers (Stage 2 refactor 2026-05-13) ─────────────────
  // Both buttons now call dedicated Server Actions that write the row directly
  // (intent_type='session_restarted' / 'escalation_triggered'). No more
  // free-form English text through sendMessage — the previous pattern violated
  // the design's "wizard-first; no free-form input" rule.
  async function handleStartOver() {
    if (isWorking) return;
    const result = await submitStartOver({ chatId });
    if (result.ok) {
      // Surface a "starting over" bubble + re-render greeting client-side.
      // The page-reload approach is simplest: localStorage chatId stays, but
      // the row state is wiped. On next render, messages.length === 0 triggers
      // the client-side GreetingCard.
      window.location.reload();
    }
  }

  async function handleEscalate() {
    if (isWorking) return;
    const result = await submitEscalate({
      chatId,
      reason: "footer_button",
    });
    if (result.ok && result.directive === "show_escalation_card") {
      // Client-side render of the escalation card (2026-05-13 — same
      // pattern as the other wizard transitions). Chat agent stays out
      // of the loop; setMessages append + persist async.
      const newMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: [
          ...(result.bubble_copy?.trim()
            ? [{ type: "text" as const, text: result.bubble_copy }]
            : []),
          {
            type: "tool-show_escalation_card" as const,
            toolCallId: crypto.randomUUID(),
            state: "input-available" as const,
            input: (result.data ?? {}) as Record<string, unknown>,
          } as unknown as NonNullable<UIMessage["parts"]>[number],
        ],
      } as UIMessage;
      setMessages((prev) => [...prev, newMessage]);
      void saveAssistantCardMessage({
        chatId,
        message: newMessage as unknown as Record<string, unknown>,
      });
    }
  }

  // First-turn check: when there are zero messages, render the GreetingCard
  // client-side. As soon as the customer taps a button, handleGreetingPick
  // pushes their answer to the agent via sendMessage — from that point the
  // chat agent owns the flow.
  // Show GreetingCard client-side ONLY when the customer is genuinely on
  // Step 1. Per codebase audit GAP-1: relying solely on messages.length===0
  // breaks for customers who tap-refresh mid-flow (their messages array
  // is empty for one render until useChat hydrates, but their row already
  // has current_step='phone_name' or later). The cookie-resume flow's
  // SSR hydration passes initialStep so we can gate on the authoritative
  // row state instead of fragile message-array length.
  const stepIsGreetingOrUnknown = !initialStep || initialStep === "greeting";
  const showClientGreeting =
    messages.length === 0 && stepIsGreetingOrUnknown && !isWorking;

  return (
    <div className="flex h-full flex-col">
      {!isOnline ? (
        <div
          role="alert"
          aria-live="assertive"
          className="mb-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          You&apos;re offline. Your last action might not have gone through —
          we&apos;ll pick up where you left off when the connection comes back.
        </div>
      ) : null}
      <div
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 space-y-4 overflow-y-auto px-1 py-3"
      >
        {showClientGreeting ? (
          <GreetingCard
            disabled={isWorking}
            onSubmit={(out) => void handleGreetingPick(out)}
          />
        ) : null}

        {messages.map((m) => (
          <MessageBlock
            key={m.id}
            message={m}
            onCardSubmit={dispatchCardSubmit}
            disabled={isWorking}
          />
        ))}

        {isWorking ? (
          <ChatBubble role="assistant">
            <p className="m-0 italic text-ink-secondary">
              {slowStage === "very_slow"
                ? "This is taking longer than usual — hang tight. If it doesn't come through in a few seconds, tap 'Talk to a person' below and we'll get you scheduled directly. 📞"
                : slowStage === "slow"
                  ? "Still pulling things together for you…"
                  : "Jeff is typing…"}
            </p>
          </ChatBubble>
        ) : null}
      </div>

      {showChatInput ? (
        <form
          onSubmit={onSend}
          className="mt-4 flex flex-col gap-2 border-t border-rule pt-3 sm:flex-row sm:items-end"
        >
          <label className="sr-only" htmlFor="chat-input">
            Message
          </label>
          <textarea
            id="chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend(e as unknown as FormEvent);
              }
            }}
            rows={2}
            placeholder="Type a message…"
            disabled={isWorking}
            className={
              "flex-1 resize-none rounded-[var(--radius-input)] border border-rule " +
              "bg-paper-100 px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-tertiary " +
              "focus:border-brand-burgundy-500 focus:outline-none " +
              "focus:ring-2 focus:ring-brand-burgundy-200 " +
              "disabled:opacity-60 transition-colors"
            }
          />
          <button
            type="submit"
            disabled={isWorking || draft.trim().length === 0}
            className={
              "min-h-11 rounded-[var(--radius-input)] bg-brand-burgundy-700 " +
              "px-5 py-2.5 text-[15px] font-medium text-paper-100 " +
              "transition-colors duration-150 ease-out " +
              "hover:bg-brand-burgundy-800 disabled:opacity-50 disabled:cursor-not-allowed " +
              "focus-visible:outline-2 focus-visible:outline-offset-2 " +
              "focus-visible:outline-brand-burgundy-500"
            }
          >
            {isWorking ? "…" : "Send"}
          </button>
        </form>
      ) : null}

      <WizardFooter
        onStartOver={handleStartOver}
        onEscalate={handleEscalate}
        disabled={isWorking}
      />
    </div>
  );
}

// ─── Message rendering ───────────────────────────────────────────────────────

/**
 * Card-submit dispatcher signature (Stage 2 refactor 2026-05-13). Replaces
 * the AI SDK's `addToolResult` direct exposure. Cards still produce a raw
 * card payload from their `onSubmit`, but this function:
 *   1. Calls the matching Server Action (writes row + invokes orchestrator)
 *   2. Threads the structured `SessionActionResult` back via addToolResult
 *      so the chat agent receives a directive instead of raw form values.
 */
type CardSubmitFn = (
  toolName: string,
  toolCallId: string,
  cardOutput: Record<string, unknown>,
) => Promise<void>;

interface MessageBlockProps {
  message: UIMessage;
  onCardSubmit: CardSubmitFn;
  disabled: boolean;
}

function MessageBlock({ message, onCardSubmit, disabled }: MessageBlockProps) {
  const isUser = message.role === "user";
  const parts = message.parts ?? [];

  // Split parts: text parts get wrapped in a single ChatBubble; tool-call
  // parts get rendered as full-width cards (they bring their own surface).
  const textParts: NonNullable<UIMessage["parts"]> = [];
  const toolParts: NonNullable<UIMessage["parts"]> = [];
  for (const part of parts) {
    const t = part as { type?: string; text?: string };
    if (t.type === "text") {
      // Strip card-tap sentinels (`[card-tap] greeting:returning` etc.) from
      // the visible log. The sentinel is structural — the customer tapped
      // a button, not typed a phrase. The agent's system prompt + the row
      // snapshot already carry the bucket info; rendering the sentinel
      // text would pollute the chat-bubble surface.
      if (
        typeof t.text === "string" &&
        t.text.startsWith(CARD_TAP_SENTINEL_PREFIX)
      ) {
        continue;
      }
      textParts.push(part);
    } else {
      toolParts.push(part);
    }
  }

  // If a user message contained ONLY a sentinel (no tool parts either),
  // skip rendering the entire block — otherwise we get an empty
  // user-bubble shell.
  if (isUser && textParts.length === 0 && toolParts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {textParts.length > 0 ? (
        <ChatBubble role={isUser ? "user" : "assistant"}>
          {textParts.map((part, idx) => (
            <PartRenderer
              // eslint-disable-next-line react/no-array-index-key
              key={`text-${idx}`}
              part={part}
              messageRole={message.role}
              onCardSubmit={onCardSubmit}
              disabled={disabled}
            />
          ))}
        </ChatBubble>
      ) : null}
      {toolParts.map((part, idx) => (
        <PartRenderer
          // eslint-disable-next-line react/no-array-index-key
          key={`tool-${idx}`}
          part={part}
          messageRole={message.role}
          onCardSubmit={onCardSubmit}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

interface PartRendererProps {
  part: NonNullable<UIMessage["parts"]>[number];
  messageRole: UIMessage["role"];
  onCardSubmit: CardSubmitFn;
  disabled: boolean;
}

function PartRenderer({
  part,
  messageRole,
  onCardSubmit,
  disabled,
}: PartRendererProps) {
  // Plain text part — render as paragraph. Parent (MessageBlock) wraps these
  // in a single ChatBubble per message so multiple text parts flow together.
  if (part.type === "text") {
    const textPart = part as { type: "text"; text: string };
    if (!textPart.text) return null;
    void messageRole;
    return (
      <p className="m-0 whitespace-pre-wrap">{textPart.text}</p>
    );
  }

  // Generic tool-call part — render the matching component
  // (We type-cast since TypeScript can't narrow on dynamic `tool-${name}` strings.)
  const tp = part as {
    type: string;
    toolCallId?: string;
    state?: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
  };
  if (!tp.type.startsWith("tool-")) return null;

  const toolName = tp.type.slice("tool-".length);
  const inputAvailable =
    tp.state === "input-available" || tp.state === "input-streaming";
  const outputAvailable = tp.state === "output-available";

  // Already-submitted: render a compact echo so the customer has context
  if (outputAvailable) {
    return <SubmittedEcho toolName={toolName} output={tp.output ?? {}} />;
  }

  if (!inputAvailable || !tp.toolCallId) return null;

  const toolCallId = tp.toolCallId;

  // Wrap the card-submit dispatcher into a stable per-tool callback.
  // The dispatcher (Chat-level) calls the matching Server Action FIRST
  // (writes columns + invokes orchestrator), then threads the structured
  // result through addToolResult so the chat agent receives a directive
  // instead of raw card payloads. Stage 2 refactor 2026-05-13.
  const submit = (output: Record<string, unknown>) =>
    void onCardSubmit(toolName, toolCallId, output);

  switch (toolName) {
    case "show_phone_entry": {
      const reason =
        typeof tp.input?.reason === "string" ? tp.input.reason : undefined;
      return (
        <PhoneEntry
          reason={reason}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_otp_input": {
      const phoneLastFour = String(tp.input?.phone_last_four ?? "");
      const ttlSeconds = Number(tp.input?.ttl_seconds ?? 300);
      const attemptsRemaining =
        typeof tp.input?.attempts_remaining === "number"
          ? (tp.input.attempts_remaining as number)
          : undefined;
      return (
        <OtpInput
          phone_last_four={phoneLastFour}
          ttl_seconds={ttlSeconds}
          attempts_remaining={attemptsRemaining}
          disabled={disabled}
          onSubmit={(out) => submit(out as Record<string, unknown>)}
        />
      );
    }

    case "show_vehicle_picker": {
      const vehicles = Array.isArray(tp.input?.vehicles)
        ? (tp.input.vehicles as Array<{ id: string; label: string }>)
        : [];
      const allowAddNew = tp.input?.allow_add_new !== false;
      return (
        <VehiclePicker
          vehicles={vehicles}
          allow_add_new={allowAddNew}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_service_and_concern_picker": {
      const common = Array.isArray(tp.input?.common_services)
        ? (tp.input.common_services as Array<{
            service_key: string;
            display_name: string;
          }>)
        : [];
      return (
        <ServiceAndConcernPicker
          common_services={common}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_calendar_date_picker": {
      const dates = Array.isArray(tp.input?.available_dates)
        ? (tp.input.available_dates as string[])
        : [];
      const type = tp.input?.type === "waiter" ? "waiter" : "dropoff";
      const initialFocus =
        typeof tp.input?.initial_focus_date === "string"
          ? tp.input.initial_focus_date
          : undefined;
      const rangeEnd =
        typeof tp.input?.range_end === "string"
          ? tp.input.range_end
          : undefined;
      return (
        <CalendarDatePicker
          available_dates={dates}
          type={type}
          initial_focus_date={initialFocus}
          range_end={rangeEnd}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_waiter_time_picker": {
      const date = String(tp.input?.date ?? "");
      const times = Array.isArray(tp.input?.available_times)
        ? (tp.input.available_times as string[])
        : [];
      return (
        <WaiterTimePicker
          date={date}
          available_times={times}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_new_customer_info_card": {
      // Step 4 new client per chat-design.md §2595-2683.
      // Inputs: first_name, last_name, verified_phone_e164.
      const fn = String(tp.input?.first_name ?? "");
      const ln = String(tp.input?.last_name ?? "");
      const verifiedPhone = String(tp.input?.verified_phone_e164 ?? "");
      if (!verifiedPhone) return null;
      return (
        <NewCustomerInfoCard
          first_name={fn}
          last_name={ln}
          verified_phone_e164={verifiedPhone}
          disabled={disabled}
          onSubmit={(out) => submit(out as Record<string, unknown>)}
        />
      );
    }

    case "show_new_vehicle_form": {
      // Step 5 new client (§2684-2753) OR Step 6 add-new drill-down
      // (§1248-1306). Optional inputs: step_label, title, server_error.
      const stepLabel =
        typeof tp.input?.step_label === "string"
          ? tp.input.step_label
          : undefined;
      const titleProp =
        typeof tp.input?.title === "string" ? tp.input.title : undefined;
      const serverError =
        typeof tp.input?.server_error === "string"
          ? tp.input.server_error
          : undefined;
      return (
        <NewVehicleCard
          step_label={stepLabel}
          title={titleProp}
          server_error={serverError}
          disabled={disabled}
          onSubmit={(out) => submit(out as Record<string, unknown>)}
        />
      );
    }

    case "show_confirmation_card": {
      const summary = String(tp.input?.summary ?? "");
      const startsAt = String(tp.input?.starts_at ?? "");
      const customer = String(tp.input?.customer ?? "");
      const vehicle = String(tp.input?.vehicle ?? "");
      const type = tp.input?.type === "waiter" ? "waiter" : "dropoff";
      const reminders = Array.isArray(tp.input?.reminders)
        ? (tp.input.reminders as string[])
        : [];
      return (
        <ConfirmationCard
          summary={summary}
          starts_at={startsAt}
          customer={customer}
          vehicle={vehicle}
          type={type}
          reminders={reminders}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_escalation_card": {
      const reason = String(tp.input?.reason ?? "");
      const shopPhone = String(tp.input?.shop_phone ?? "6102536565");
      // Default true (per chat-design.md §A); orchestrator may set false
      // for terminal escalations.
      const allowBack =
        tp.input?.allow_back_to_scheduling === false ? false : true;
      return (
        <EscalationCard
          reason={reason}
          shop_phone={shopPhone}
          allow_back_to_scheduling={allowBack}
          disabled={disabled}
          onSubmit={(out) => submit(out as Record<string, unknown>)}
        />
      );
    }

    // ─── Heritage Editorial cards (Chunk 6 directives — 2026-05-13) ─────────

    case "show_greeting_card": {
      const shopName = typeof tp.input?.shop_name === "string"
        ? tp.input.shop_name
        : undefined;
      const agentName = typeof tp.input?.agent_name === "string"
        ? tp.input.agent_name
        : undefined;
      return (
        <GreetingCard
          shop_name={shopName}
          agent_name={agentName}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_phone_name_card": {
      const stepLabel = typeof tp.input?.step_label === "string"
        ? tp.input.step_label
        : undefined;
      return (
        <PhoneNameCard
          step_label={stepLabel}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_clarification_question": {
      const id = Number(tp.input?.question_id ?? 0);
      const questionText = String(tp.input?.question_text ?? "");
      const opts = Array.isArray(tp.input?.options)
        ? (tp.input.options as Array<{ label: string; value: string }>)
        : [];
      const serviceKey = typeof tp.input?.service_key === "string"
        ? tp.input.service_key
        : undefined;
      const category = typeof tp.input?.category === "string"
        ? tp.input.category
        : undefined;
      if (id <= 0 || !questionText || opts.length === 0) return null;
      return (
        <ClarificationQuestionCard
          question_id={id}
          question_text={questionText}
          options={opts}
          service_key={serviceKey}
          category={category}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_testing_service_approval": {
      const services = Array.isArray(tp.input?.services)
        ? (tp.input.services as Array<{
            service_key: string;
            display_name: string;
            starting_price_cents: number;
            notes?: string | null;
          }>)
        : [];
      const category = typeof tp.input?.category === "string"
        ? tp.input.category
        : undefined;
      return (
        <TestingServiceApprovalCard
          services={services}
          category={category}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_appointment_type": {
      const options = Array.isArray(tp.input?.options)
        ? (tp.input.options as Array<{
            type: "waiter" | "dropoff";
            available: boolean;
            unavailable_reason?: string;
            earliest_hint?: string;
          }>)
        : [
            { type: "waiter" as const, available: true },
            { type: "dropoff" as const, available: true },
          ];
      return (
        <AppointmentTypeCard
          options={options}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_customer_notes_card": {
      const initial = typeof tp.input?.initial_text === "string"
        ? tp.input.initial_text
        : undefined;
      return (
        <CustomerNotesCard
          initial_text={initial}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_customer_question_card": {
      return (
        <CustomerQuestionCard
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "show_no_match_choose_path": {
      const attemptedFirst =
        typeof tp.input?.attempted_first_name === "string"
          ? tp.input.attempted_first_name
          : null;
      const attemptedLast4 =
        typeof tp.input?.attempted_phone_last_four === "string"
          ? tp.input.attempted_phone_last_four
          : null;
      return (
        <NoMatchChoosePathCard
          attempted_first_name={attemptedFirst}
          attempted_phone_last_four={attemptedLast4}
          disabled={disabled}
          onSubmit={(out) => submit(out as Record<string, unknown>)}
        />
      );
    }

    case "show_partial_verification_gate": {
      const matchedAxis: "name" | "phone" =
        tp.input?.matched_axis === "phone" ? "phone" : "name";
      const attemptedFirst =
        typeof tp.input?.attempted_first_name === "string"
          ? tp.input.attempted_first_name
          : null;
      const attemptedLast4 =
        typeof tp.input?.attempted_phone_last_four === "string"
          ? tp.input.attempted_phone_last_four
          : null;
      const matchedFirst =
        typeof tp.input?.matched_first_name === "string"
          ? tp.input.matched_first_name
          : null;
      return (
        <PartialVerificationGateCard
          matched_axis={matchedAxis}
          attempted_first_name={attemptedFirst}
          attempted_phone_last_four={attemptedLast4}
          matched_first_name={matchedFirst}
          disabled={disabled}
          onSubmit={(out) => submit(out as Record<string, unknown>)}
        />
      );
    }

    case "show_multi_account_disambiguation": {
      // Vehicle-only per chat-design.md §3.5c — drop any candidate that
      // lacks a recent_vehicle (the card has nothing to render for them).
      const candidates = Array.isArray(tp.input?.candidates)
        ? (tp.input.candidates as Array<{
            customer_id: number;
            recent_vehicle: string;
          }>).filter(
            (c) =>
              typeof c.recent_vehicle === "string" &&
              c.recent_vehicle.trim().length > 0,
          )
        : [];
      const attemptedLast4 =
        typeof tp.input?.attempted_phone_last_four === "string"
          ? tp.input.attempted_phone_last_four
          : null;
      return (
        <MultiAccountDisambiguationCard
          candidates={candidates}
          attempted_phone_last_four={attemptedLast4}
          disabled={disabled}
          onSubmit={(out) => submit(out as Record<string, unknown>)}
        />
      );
    }

    case "show_customer_info_edit": {
      const firstName = String(tp.input?.first_name ?? "");
      const lastName = String(tp.input?.last_name ?? "");
      const initialPhones = Array.isArray(tp.input?.initial_phones)
        ? (tp.input.initial_phones as Array<{
            phone_e164: string;
            is_primary: boolean;
          }>)
        : [];
      const initialEmails = Array.isArray(tp.input?.initial_emails)
        ? (tp.input.initial_emails as Array<{
            email: string;
            is_primary: boolean;
          }>)
        : [];
      const initialAddress =
        (tp.input?.initial_address as Record<string, string> | undefined) ??
        undefined;
      return (
        <CustomerInfoEditCard
          first_name={firstName}
          last_name={lastName}
          initial_phones={initialPhones}
          initial_emails={initialEmails}
          initial_address={initialAddress}
          disabled={disabled}
          onSubmit={(out) => submit(out as Record<string, unknown>)}
        />
      );
    }

    case "show_completed_card": {
      const firstName =
        typeof tp.input?.first_name === "string"
          ? tp.input.first_name
          : tp.input?.first_name === null
            ? null
            : undefined;
      const apptLabel =
        typeof tp.input?.appointment_label === "string"
          ? tp.input.appointment_label
          : tp.input?.appointment_label === null
            ? null
            : undefined;
      const allowAnother =
        tp.input?.allow_schedule_another === false ? false : true;
      return (
        <CompletedCard
          first_name={firstName}
          appointment_label={apptLabel}
          allow_schedule_another={allowAnother}
          disabled={disabled}
          onScheduleAnother={() =>
            submit({ action: "schedule_another" } as Record<string, unknown>)
          }
          onClose={() =>
            submit({ action: "close" } as Record<string, unknown>)
          }
        />
      );
    }

    case "show_summary_card": {
      const holdId = typeof tp.input?.hold_id === "string"
        ? tp.input.hold_id
        : undefined;
      const holdExpiresAt = typeof tp.input?.hold_expires_at === "string"
        ? tp.input.hold_expires_at
        : undefined;
      const startsAt = String(tp.input?.starts_at ?? "");
      const customer = String(tp.input?.customer ?? "");
      const vehicle = String(tp.input?.vehicle ?? "");
      const aType = tp.input?.type === "waiter" ? "waiter" : "dropoff";
      const services = Array.isArray(tp.input?.services)
        ? (tp.input.services as Array<{
            display_name: string;
            kind: "routine" | "concern" | "testing";
            starting_price_cents?: number;
            notes?: string;
          }>)
        : [];
      const reminders = Array.isArray(tp.input?.reminders)
        ? (tp.input.reminders as string[])
        : [];
      return (
        <SummaryCard
          hold_id={holdId}
          hold_expires_at={holdExpiresAt}
          starts_at={startsAt}
          customer={customer}
          vehicle={vehicle}
          type={aType}
          services={services}
          reminders={reminders}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    case "consult_orchestrator":
      // Server-side data tool — never rendered. Logged invisibly.
      return null;

    default:
      // Unknown tool — render a debug placeholder so we notice in dev
      return (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          [unhandled tool: {toolName}]
        </p>
      );
  }
}

// ─── Compact "you submitted" echoes ──────────────────────────────────────────

function SubmittedEcho({
  toolName,
  output,
}: {
  toolName: string;
  output: Record<string, unknown>;
}) {
  let text = "";
  switch (toolName) {
    case "show_phone_entry":
      text = `Phone: ${String(output.phone ?? "")}`;
      break;
    case "show_otp_input":
      text = "Code submitted";
      break;
    case "show_vehicle_picker":
      text =
        output.vehicle_id === "new"
          ? "Adding a new vehicle"
          : `Vehicle: #${String(output.vehicle_id ?? "")}`;
      break;
    case "show_service_and_concern_picker": {
      const services = Array.isArray(output.services)
        ? (output.services as string[]).join(", ")
        : "";
      const concern =
        typeof output.concern_text === "string" && output.concern_text
          ? ` · "${output.concern_text}"`
          : "";
      text = `Selected: ${services}${concern}`;
      break;
    }
    case "show_calendar_date_picker":
      text = `Date: ${String(output.selected_date ?? "")}`;
      break;
    case "show_waiter_time_picker":
      text = `Time: ${String(output.selected_time ?? "")}`;
      break;
    case "show_new_customer_info_card": {
      text = "Account info submitted";
      break;
    }
    case "show_new_vehicle_form": {
      const year = output.year ? String(output.year) : "";
      const make = String(output.make ?? "");
      const model = String(output.model ?? "");
      const label = [year, make, model].filter(Boolean).join(" ");
      text = label ? `Vehicle added: ${label}` : "Vehicle added";
      break;
    }
    case "show_confirmation_card":
      text = output.confirmed ? "Confirmed ✓" : "Cancelled";
      break;
    case "show_escalation_card":
      text = "Acknowledged";
      break;
    case "show_greeting_card": {
      const v = String((output as { is_returning?: string }).is_returning ?? "");
      text =
        v === "returning"
          ? "Returning customer"
          : v === "new"
            ? "First-time visitor"
            : v === "unsure"
              ? "Not sure"
              : "Greeting answered";
      break;
    }
    case "show_phone_name_card": {
      const fn = String((output as { first_name?: string }).first_name ?? "");
      const ln = String((output as { last_name?: string }).last_name ?? "");
      text = `${fn} ${ln}`.trim();
      break;
    }
    case "show_clarification_question":
      text = output.answer === "skipped"
        ? "Skipped"
        : `Answered: ${String(output.answer ?? "")}`;
      break;
    case "show_testing_service_approval": {
      const approved = Array.isArray(output.approved)
        ? (output.approved as string[])
        : [];
      const declined = Array.isArray(output.declined)
        ? (output.declined as string[])
        : [];
      text =
        approved.length > 0
          ? `Approved ${approved.length} of ${approved.length + declined.length} testing services`
          : "No testing services for now";
      break;
    }
    case "show_appointment_type":
      text = `Appointment type: ${String(output.appointment_type ?? "")}`;
      break;
    case "show_customer_notes_card":
      text = output.text ? "Notes submitted" : "Skipped notes";
      break;
    case "show_customer_question_card":
      text = output.question ? "Question sent" : "No questions";
      break;
    case "show_summary_card":
      text = output.confirmed ? "Appointment confirmed ✓" : "Editing…";
      break;
    default:
      text = "Submitted";
  }
  return (
    <p
      className="my-1 pl-3 text-[12px] italic leading-relaxed text-ink-tertiary border-l border-rule"
      aria-label="Submitted"
    >
      — {text}
    </p>
  );
}
