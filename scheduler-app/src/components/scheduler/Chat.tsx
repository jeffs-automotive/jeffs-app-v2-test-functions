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

import { useState, type FormEvent } from "react";
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
import { NewCustomerForm } from "./NewCustomerForm";
import { ConfirmationCard } from "./ConfirmationCard";
import { EscalationCard } from "./EscalationCard";
// Heritage Editorial cards (Chunk 6 — 2026-05-13). New directives route here.
import {
  AppointmentTypeCard,
  ClarificationQuestionCard,
  CustomerNotesCard,
  CustomerQuestionCard,
  PhoneNameCard,
  SummaryCard,
  TestingServiceApprovalCard,
} from "./heritage";

export interface ChatProps {
  chatId: string;
  initialMessages?: UIMessage[];
}

export function Chat({ chatId, initialMessages }: ChatProps) {
  const { messages, sendMessage, addToolResult, status } = useChat({
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
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  const [draft, setDraft] = useState("");
  const isWorking = status === "submitted" || status === "streaming";

  function onSend(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isWorking) return;
    setDraft("");
    void sendMessage({ text });
  }

  return (
    <div className="flex h-full flex-col">
      <div
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 space-y-4 overflow-y-auto px-1 py-2"
      >
        {messages.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
            Type anything below to start chatting with Jeff — your AI scheduling
            assistant.
          </p>
        ) : null}

        {messages.map((m) => (
          <MessageBlock
            key={m.id}
            message={m}
            addToolResult={addToolResult}
            disabled={isWorking}
          />
        ))}
      </div>

      <form
        onSubmit={onSend}
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
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
          placeholder="Type your message..."
          disabled={isWorking}
          className="flex-1 resize-none rounded border border-gray-300 px-3 py-2 text-base focus:border-brand-burgundy-700 focus:outline-none focus:ring-2 focus:ring-brand-burgundy-200"
        />
        <button
          type="submit"
          disabled={isWorking || draft.trim().length === 0}
          className="rounded bg-brand-burgundy-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-burgundy-800 disabled:opacity-50"
        >
          {isWorking ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

// ─── Message rendering ───────────────────────────────────────────────────────

type AddToolResultFn = ReturnType<typeof useChat>["addToolResult"];

interface MessageBlockProps {
  message: UIMessage;
  addToolResult: AddToolResultFn;
  disabled: boolean;
}

function MessageBlock({ message, addToolResult, disabled }: MessageBlockProps) {
  const isUser = message.role === "user";
  return (
    <div
      className={
        isUser
          ? "ml-auto max-w-[85%] rounded-md bg-brand-burgundy-700 px-3 py-2 text-sm text-white"
          : "mr-auto max-w-full text-sm text-gray-900"
      }
    >
      {(message.parts ?? []).map((part, idx) => (
        <PartRenderer
          // eslint-disable-next-line react/no-array-index-key
          key={idx}
          part={part}
          messageRole={message.role}
          addToolResult={addToolResult}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

interface PartRendererProps {
  part: NonNullable<UIMessage["parts"]>[number];
  messageRole: UIMessage["role"];
  addToolResult: AddToolResultFn;
  disabled: boolean;
}

function PartRenderer({
  part,
  messageRole,
  addToolResult,
  disabled,
}: PartRendererProps) {
  // Plain text part — render as paragraph
  if (part.type === "text") {
    const textPart = part as { type: "text"; text: string };
    if (!textPart.text) return null;
    return (
      <p className={messageRole === "user" ? "" : "whitespace-pre-wrap py-1"}>
        {textPart.text}
      </p>
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

  // Wrap addToolResult into a stable per-tool callback the components consume
  const submit = (output: Record<string, unknown>) =>
    addToolResult({
      tool: toolName,
      toolCallId,
      output,
    });

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
      return (
        <OtpInput
          phone_last_four={phoneLastFour}
          ttl_seconds={ttlSeconds}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
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

    case "show_new_customer_form": {
      const mode =
        tp.input?.mode === "vehicle-only" ? "vehicle-only" : "full";
      const collected = (tp.input?.collected_so_far ?? undefined) as
        | Record<string, unknown>
        | undefined;
      return (
        <NewCustomerForm
          mode={mode}
          collected_so_far={collected as never}
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
      return (
        <EscalationCard
          reason={reason}
          shop_phone={shopPhone}
          disabled={disabled}
          onSubmit={(out) => submit(out)}
        />
      );
    }

    // ─── Heritage Editorial cards (Chunk 6 directives — 2026-05-13) ─────────

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
    case "show_new_customer_form": {
      const first = String((output as { first_name?: string }).first_name ?? "");
      const last = String((output as { last_name?: string }).last_name ?? "");
      text = `Customer info submitted${first ? ` (${first} ${last})` : ""}`;
      break;
    }
    case "show_confirmation_card":
      text = output.confirmed ? "Confirmed ✓" : "Cancelled";
      break;
    case "show_escalation_card":
      text = "Acknowledged";
      break;
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
    <p className="my-1 text-xs italic text-gray-500">— {text}</p>
  );
}
