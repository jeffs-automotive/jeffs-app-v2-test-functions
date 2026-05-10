/**
 * Tool definitions for the chat agent — 1 data tool + 8 rendering tools.
 *
 * Per appointments_design.md §7.1 + §7.5 + scheduler-research/01-frontend-ai-sdk.md:
 *   - Data tool has `execute` — runs server-side during the stream
 *   - Rendering tools have NO `execute` — chat agent emits the call,
 *     UI renders the React component, customer interacts, addToolResult
 *     feeds the result back via sendAutomaticallyWhen
 *
 * The orchestrator-direct call inside consult_orchestrator's execute
 * is the only network egress from this layer (besides what AI SDK
 * does to the model provider).
 */
import { tool, type InferUITools } from "ai";
import { z } from "zod";
import {
  consultOrchestrator,
  OrchestratorError,
} from "@/lib/scheduler/orchestrator-client";

// =====================================================================
// DATA TOOL — has execute
// =====================================================================

export function makeConsultOrchestratorTool(args: {
  /** Bound at request time so the tool's execute can scope to this session. */
  session_id: string;
}) {
  return tool({
    description:
      "Consult the orchestrator with the current conversation context. " +
      "Returns structured guidance: which next UI to render, what to say, " +
      "and any flags the chat agent should branch on.",
    inputSchema: z.object({
      context: z
        .string()
        .min(1)
        .describe(
          "A plain-English summary of the conversation so far + what " +
            "the customer just said. The orchestrator uses this as the " +
            "input to its tool selection. Be specific about names, " +
            "dates, vehicles, and concerns. NEVER include made-up info.",
        ),
      hints: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Optional structured hints — e.g., { phone_e164, " +
            "customer_self_identified, picked_service_keys, ... }. The " +
            "orchestrator merges these into its session view.",
        ),
    }),
    async execute({ context, hints }) {
      try {
        const result = await consultOrchestrator({
          session_id: args.session_id,
          context,
          hints,
        });
        return result;
      } catch (e) {
        // The model sees the error structure and decides whether to ask
        // a follow-up or escalate. We don't crash the stream.
        if (e instanceof OrchestratorError) {
          return {
            directive: "tool_error",
            data: { message: e.message, status: e.status },
            flags: { tekmetric_error: true },
          };
        }
        return {
          directive: "tool_error",
          data: {
            message:
              e instanceof Error ? e.message : "Unknown orchestrator error",
          },
          flags: { tekmetric_error: true },
        };
      }
    },
  });
}

// =====================================================================
// RENDERING TOOLS — no execute; UI renders + addToolResult feeds back
// =====================================================================

export const showPhoneEntry = tool({
  description:
    "Render a phone-number entry form for the customer. Use after the " +
    "customer says they want to book and you've classified self-identified " +
    "as returning/new/unsure.",
  inputSchema: z.object({
    reason: z
      .string()
      .optional()
      .describe(
        "Optional context shown next to the phone field — e.g., " +
          "'to look up your account' or 'so we can send your confirmation'.",
      ),
  }),
  // no execute — client-side rendering
});

export const showOtpInput = tool({
  description:
    "Render a 6-digit OTP code input. Use after the orchestrator has " +
    "called send_otp and confirmed the SMS was sent.",
  inputSchema: z.object({
    phone_last_four: z
      .string()
      .regex(/^\d{4}$/)
      .describe("Last 4 digits of the phone the code was sent to."),
    ttl_seconds: z
      .number()
      .int()
      .positive()
      .describe(
        "Seconds until the OTP expires — typically 300 (5 min). The UI " +
          "shows a countdown.",
      ),
  }),
});

export const showVehiclePicker = tool({
  description:
    "Render a picker of the customer's existing vehicles, optionally with " +
    'an "Add new vehicle" option. Use after identity-match flow when the ' +
    "orchestrator returns the vehicle list for an identified customer.",
  inputSchema: z.object({
    vehicles: z
      .array(
        z.object({
          id: z.string().describe("Tekmetric vehicle ID (stringified)."),
          label: z
            .string()
            .describe("Customer-facing vehicle label, e.g., '2018 Toyota Camry'."),
        }),
      )
      .describe("Vehicles on file for this customer, in the orchestrator's order."),
    allow_add_new: z
      .boolean()
      .describe(
        "If true, shows an '+ Add new vehicle' option. True for returning " +
          "customers (they may have a new car); false in rare cases where " +
          "the orchestrator restricts to the current set.",
      ),
  }),
});

export const showServiceAndConcernPicker = tool({
  description:
    "Render the routine-service chips + concern textarea. Use as the " +
    'second turn (right after the "have you been here before?" answer) ' +
    "to capture what the customer wants done.",
  inputSchema: z.object({
    common_services: z
      .array(
        z.object({
          service_key: z
            .string()
            .describe("routine_services.service_key — e.g., 'oil_change'."),
          display_name: z
            .string()
            .describe("Customer-facing chip label — e.g., 'Oil Change'."),
        }),
      )
      .describe(
        "The 10 routine-service chips, in display order from the " +
          "routine_services table.",
      ),
  }),
});

export const showCalendarDatePicker = tool({
  description:
    "Render a calendar date picker. Show only the dates in available_dates " +
    "as clickable. Use when the customer wants a date other than the " +
    "earliest-available offering, OR when there are multiple available " +
    "options to display visually.",
  inputSchema: z.object({
    available_dates: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .describe(
        "ISO YYYY-MM-DD dates that have capacity. Only these are clickable.",
      ),
    type: z
      .enum(["waiter", "dropoff"])
      .describe(
        "If 'waiter', the customer's date pick will be followed by a " +
          "show_waiter_time_picker turn. If 'dropoff', the date pick " +
          "is final and we proceed to confirmation.",
      ),
    initial_focus_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe(
        "Optional date to focus the calendar on initially (default: " +
          "first available).",
      ),
    range_end: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Optional ISO date the calendar should not show past (default: today + 60d)."),
  }),
});

export const showWaiterTimePicker = tool({
  description:
    "Render the waiter time-slot picker (8 AM / 9 AM). Use after the " +
    "customer picks a date for a WAITER appointment.",
  inputSchema: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("ISO date the customer picked."),
    available_times: z
      .array(z.enum(["08:00", "09:00"]))
      .min(1)
      .describe(
        "Open times for that date. Only the entries here are " +
          "clickable; pass [] if both are full (then re-render the " +
          "calendar so the customer can pick another date).",
      ),
  }),
});

export const showNewCustomerForm = tool({
  description:
    "Render a form to collect new-customer info + new-vehicle info. " +
    "Two modes: 'full' (new customer to the shop) or 'vehicle-only' " +
    "(returning customer adding a vehicle that's not on file).",
  inputSchema: z.object({
    mode: z
      .enum(["full", "vehicle-only"])
      .describe(
        "'full' for new customer; 'vehicle-only' when the customer is " +
          "matched in Tekmetric but their vehicle isn't on file.",
      ),
    collected_so_far: z
      .object({
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        email: z.string().optional(),
        vehicle: z
          .object({
            year: z.number().int().optional(),
            make: z.string().optional(),
            model: z.string().optional(),
            sub_model: z.string().optional(),
            vin: z.string().optional(),
            license_plate: z.string().optional(),
            state: z.string().optional(),
          })
          .optional(),
      })
      .optional()
      .describe(
        "Pre-fill values from earlier turns (e.g., name the orchestrator " +
          "already captured, or vehicle year the customer mentioned).",
      ),
  }),
});

export const showConfirmationCard = tool({
  description:
    "Render the final confirmation card the customer taps Confirm/Cancel " +
    "on. Use right before the orchestrator calls confirm_appointment → " +
    "Tekmetric POST.",
  inputSchema: z.object({
    summary: z
      .string()
      .describe(
        "Customer-facing service summary — e.g., 'Oil Change' or " +
          "'State Inspection + Brake Inspection'.",
      ),
    starts_at: z
      .string()
      .describe(
        "For waiter: ISO datetime '2026-05-19T08:00:00Z'. For dropoff: " +
          "ISO date only '2026-05-13' (drop-offs never show a time).",
      ),
    customer: z.string().describe("Customer display name, e.g., 'Vince Zulauf'."),
    vehicle: z.string().describe("Vehicle label, e.g., '2018 Toyota Camry'."),
    type: z
      .enum(["waiter", "dropoff"])
      .describe(
        "Drives whether the card displays a time (waiter) or just a " +
          "date (dropoff per design §5).",
      ),
    reminders: z
      .array(z.string())
      .optional()
      .describe(
        "Service-specific reminders to surface above the confirm button. " +
          "Drop-off → 'Please drop off your vehicle before 10 AM…'; " +
          "State Inspection → 'Please bring up-to-date insurance and " +
          "registration cards.' Both apply for state-inspection drop-offs.",
      ),
  }),
});

export const showEscalationCard = tool({
  description:
    "Render the escalation card with apology + shop phone. Use ONLY when " +
    "an escalation trigger fires per design §10.",
  inputSchema: z.object({
    reason: z
      .string()
      .describe(
        "Short explanation logged for the service team (shown as italic " +
          "small text on the card). Customer-readable but not highlighted.",
      ),
    shop_phone: z
      .string()
      .describe("Shop phone number to call (E.164 or 10-digit; component formats)."),
  }),
});

// =====================================================================
// Bundle the tools as a registry the route handler passes to streamText
// =====================================================================

export function makeChatAgentTools(args: { session_id: string }) {
  return {
    consult_orchestrator: makeConsultOrchestratorTool(args),
    show_phone_entry: showPhoneEntry,
    show_otp_input: showOtpInput,
    show_vehicle_picker: showVehiclePicker,
    show_service_and_concern_picker: showServiceAndConcernPicker,
    show_calendar_date_picker: showCalendarDatePicker,
    show_waiter_time_picker: showWaiterTimePicker,
    show_new_customer_form: showNewCustomerForm,
    show_confirmation_card: showConfirmationCard,
    show_escalation_card: showEscalationCard,
  } as const;
}

export type ChatAgentTools = ReturnType<typeof makeChatAgentTools>;
export type ChatAgentUITools = InferUITools<ChatAgentTools>;
