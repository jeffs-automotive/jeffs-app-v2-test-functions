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
      intent_type: z
        .enum([
          "verify_and_lookup",
          "verify_otp",
          "lookup_vehicles",
          "lookup_services",
          "diagnostic_clarify",
          "diagnostic_propose_testing",
          "appointment_eligibility",
          "hold_slot",
          "confirm_appointment",
          "customer_question",
        ])
        .optional()
        .describe(
          "Optional short-circuit hint. When present AND in the allowed " +
            "set for caller_context='customer', the orchestrator skips " +
            "the LLM router and dispatches directly to the matching " +
            "specialist. Use when you know exactly what the next step " +
            "is (e.g., 'verify_otp' after the user submits a 6-digit " +
            "code). Omit to let the router classify.",
        ),
    }),
    async execute({ context, hints, intent_type }) {
      try {
        const result = await consultOrchestrator({
          session_id: args.session_id,
          context,
          hints,
          intent_type,
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
//
// We export the raw zod schemas separately from the wrapped tool() defs.
// Why: AI SDK v5's tool() returns a value whose .inputSchema is a wrapper
// (FlexibleSchema<T>) that doesn't expose .safeParse / .parse directly.
// Tests + downstream code that need to validate inputs go through the
// raw schema. Both stay in sync because the tool() defs reference the
// raw schemas by name.

export const phoneEntrySchema = z.object({
  reason: z
    .string()
    .optional()
    .describe(
      "Optional context shown next to the phone field — e.g., " +
        "'to look up your account' or 'so we can send your confirmation'.",
    ),
});

export const otpInputSchema = z.object({
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
});

export const vehiclePickerSchema = z.object({
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
});

export const serviceAndConcernPickerSchema = z.object({
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
});

export const calendarDatePickerSchema = z.object({
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
});

export const waiterTimePickerSchema = z.object({
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
});

export const newCustomerFormSchema = z.object({
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
});

export const confirmationCardSchema = z.object({
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
});

export const escalationCardSchema = z.object({
  reason: z
    .string()
    .describe(
      "Short explanation logged for the service team (shown as italic " +
        "small text on the card). Customer-readable but not highlighted.",
    ),
  shop_phone: z
    .string()
    .describe("Shop phone number to call (E.164 or 10-digit; component formats)."),
});

// ─── Heritage Editorial schemas (Chunk 6 — 2026-05-13) ──────────────────────

export const greetingCardSchema = z.object({
  shop_name: z
    .string()
    .optional()
    .describe(
      "Optional override of the shop display name (default 'Jeff's Automotive').",
    ),
  agent_name: z
    .string()
    .optional()
    .describe("Optional override of the assistant's name (default 'Jeff')."),
});

export const phoneNameCardSchema = z.object({
  step_label: z
    .string()
    .optional()
    .describe(
      "Optional eyebrow text (default 'Step 2 · Verify it's you').",
    ),
});

export const clarificationQuestionSchema = z.object({
  question_id: z
    .number()
    .int()
    .positive()
    .describe("concern_questions.id from the catalog."),
  question_text: z.string().describe("Customer-facing question text."),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
      }),
    )
    .describe("Multiple-choice options as {label, value} pairs."),
  service_key: z
    .string()
    .optional()
    .describe("Optional service_key the question is tied to."),
  category: z
    .string()
    .optional()
    .describe("Optional concern category (noise/vibration/etc.) for eyebrow."),
});

export const testingServiceApprovalSchema = z.object({
  services: z
    .array(
      z.object({
        service_key: z.string(),
        display_name: z.string(),
        starting_price_cents: z.number().int().nonnegative(),
        notes: z.string().nullable().optional(),
      }),
    )
    .describe("Testing services to surface for approval, with starting prices."),
  category: z
    .string()
    .optional()
    .describe("Optional concern category label for eyebrow."),
});

export const appointmentTypeCardSchema = z.object({
  options: z
    .array(
      z.object({
        type: z.enum(["waiter", "dropoff"]),
        available: z.boolean(),
        unavailable_reason: z.string().optional(),
        earliest_hint: z.string().optional(),
      }),
    )
    .describe("Waiter + dropoff options with availability and earliest hints."),
});

export const customerNotesCardSchema = z.object({
  initial_text: z
    .string()
    .optional()
    .describe(
      "Optional pre-filled text when the customer is editing a prior note.",
    ),
});

export const customerQuestionCardSchema = z.object({});

export const noMatchChoosePathCardSchema = z.object({
  attempted_first_name: z
    .string()
    .nullable()
    .optional()
    .describe(
      "First name the customer typed at Step 2 (echoed back in the card).",
    ),
  attempted_phone_last_four: z
    .string()
    .nullable()
    .optional()
    .describe("Last 4 digits of the phone they entered."),
});

export const partialVerificationGateCardSchema = z.object({
  matched_axis: z
    .enum(["name", "phone"])
    .describe(
      "Which identity axis matched. 'name' = Tekmetric has a customer " +
        "with this name but a different phone. 'phone' = Tekmetric has " +
        "this number on file under a different name.",
    ),
  attempted_first_name: z.string().nullable().optional(),
  attempted_phone_last_four: z.string().nullable().optional(),
  matched_first_name: z
    .string()
    .nullable()
    .optional()
    .describe(
      "First name on the partially-matched record. Only meaningful when " +
        "matched_axis='phone' — surfaced as 'That number's on file for " +
        "<name> — is that you?'.",
    ),
});

export const multiAccountDisambiguationCardSchema = z.object({
  candidates: z
    .array(
      z.object({
        customer_id: z.number(),
        first_name: z.string(),
        last_name: z.string().nullable().optional(),
        recent_vehicle: z.string().nullable().optional(),
      }),
    )
    .min(2)
    .max(8)
    .describe(
      "Tekmetric customers sharing the entered phone. Show each with a " +
        "recent-vehicle hint so the customer can recognize themselves. " +
        "Capped at 8 — if there are more, the orchestrator escalates.",
    ),
  attempted_phone_last_four: z.string().nullable().optional(),
});

export const customerInfoEditCardSchema = z.object({
  first_name: z
    .string()
    .describe("Verified first name from Tekmetric (display-only)."),
  last_name: z
    .string()
    .describe("Verified last name from Tekmetric (display-only)."),
  initial_phones: z
    .array(
      z.object({
        phone_e164: z.string(),
        is_primary: z.boolean(),
      }),
    )
    .max(2)
    .optional()
    .describe(
      "Current phones on Tekmetric for the matched customer (max 2). " +
        "If empty, the card seeds an empty primary slot for the customer " +
        "to fill in.",
    ),
  initial_emails: z
    .array(
      z.object({
        email: z.string(),
        is_primary: z.boolean(),
      }),
    )
    .max(2)
    .optional()
    .describe(
      "Current emails on Tekmetric for the matched customer (max 2). " +
        "If empty, the card requires at least one before proceeding.",
    ),
  initial_address: z
    .object({
      address1: z.string().optional(),
      address2: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      zip: z.string().optional(),
    })
    .optional()
    .describe(
      "Current address on Tekmetric (optional). Phase 1 has no Places " +
        "autocomplete; all fields are plain inputs.",
    ),
});

export const completedCardSchema = z.object({
  first_name: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Customer's verified or entered first name for the warm greeting " +
        '("You\'re all set, <name>.").',
    ),
  appointment_label: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Human-readable date+time recap, e.g. 'Tue, May 14 at 9:00 AM'. " +
        "Optional; the card falls back to 'soon' if missing.",
    ),
  allow_schedule_another: z
    .boolean()
    .optional()
    .describe(
      "Defaults true. Pass false to hide the 'Schedule another' CTA " +
        "(e.g. terminal session that should not loop).",
    ),
});

export const summaryCardSchema = z.object({
  hold_id: z
    .string()
    .optional()
    .describe("appointment_holds.id — shown small in the footnote."),
  hold_expires_at: z
    .string()
    .optional()
    .describe(
      "ISO timestamp the 10-minute hold expires at (drives the countdown).",
    ),
  starts_at: z
    .string()
    .describe(
      "Waiter: ISO datetime. Dropoff: ISO date only (12:00 placeholder never shown).",
    ),
  customer: z.string().describe("Customer display name."),
  vehicle: z.string().describe("Vehicle label, e.g. '2018 Toyota Camry'."),
  type: z.enum(["waiter", "dropoff"]),
  services: z
    .array(
      z.object({
        display_name: z.string(),
        kind: z.enum(["routine", "concern", "testing"]),
        starting_price_cents: z.number().int().nonnegative().optional(),
        notes: z.string().optional(),
      }),
    )
    .describe("Grouped service breakdown (routine + concern + testing)."),
  reminders: z
    .array(z.string())
    .describe("Pre-appointment reminders (drop-off, state inspection, etc.)."),
});

// ─── Wrapped tool defs (consume the schemas above) ───────────────────────────

export const showPhoneEntry = tool({
  description:
    "Render a phone-number entry form for the customer. Use after the " +
    "customer says they want to book and you've classified self-identified " +
    "as returning/new/unsure.",
  inputSchema: phoneEntrySchema,
});

export const showOtpInput = tool({
  description:
    "Render a 6-digit OTP code input. Use after the orchestrator has " +
    "called send_otp and confirmed the SMS was sent.",
  inputSchema: otpInputSchema,
});

export const showVehiclePicker = tool({
  description:
    "Render a picker of the customer's existing vehicles, optionally with " +
    'an "Add new vehicle" option. Use after identity-match flow when the ' +
    "orchestrator returns the vehicle list for an identified customer.",
  inputSchema: vehiclePickerSchema,
});

export const showServiceAndConcernPicker = tool({
  description:
    "Render the routine-service chips + concern textarea. Use as the " +
    'second turn (right after the "have you been here before?" answer) ' +
    "to capture what the customer wants done.",
  inputSchema: serviceAndConcernPickerSchema,
});

export const showCalendarDatePicker = tool({
  description:
    "Render a calendar date picker. Show only the dates in available_dates " +
    "as clickable. Use when the customer wants a date other than the " +
    "earliest-available offering, OR when there are multiple available " +
    "options to display visually.",
  inputSchema: calendarDatePickerSchema,
});

export const showWaiterTimePicker = tool({
  description:
    "Render the waiter time-slot picker (8 AM / 9 AM). Use after the " +
    "customer picks a date for a WAITER appointment.",
  inputSchema: waiterTimePickerSchema,
});

export const showNewCustomerForm = tool({
  description:
    "Render a form to collect new-customer info + new-vehicle info. " +
    "Two modes: 'full' (new customer to the shop) or 'vehicle-only' " +
    "(returning customer adding a vehicle that's not on file).",
  inputSchema: newCustomerFormSchema,
});

export const showConfirmationCard = tool({
  description:
    "Render the final confirmation card the customer taps Confirm/Cancel " +
    "on. Use right before the orchestrator calls confirm_appointment → " +
    "Tekmetric POST.",
  inputSchema: confirmationCardSchema,
});

export const showEscalationCard = tool({
  description:
    "Render the escalation card with apology + shop phone. Use ONLY when " +
    "an escalation trigger fires per design §10.",
  inputSchema: escalationCardSchema,
});

// ─── Heritage Editorial wrapped tools (Chunk 6 — 2026-05-13) ────────────────

export const showGreetingCard = tool({
  description:
    "STEP 1 — Render the greeting card with Yes/No/Unsure buttons. This is " +
    "the FIRST tool you call on every new session. Do NOT send the disclosure " +
    "+ opening question as plain text — render this card instead. The card " +
    "includes the recorded-conversation disclosure and the 'have you been to " +
    "our shop before?' question with three button options (returning / new / " +
    "unsure). The output { is_returning } drives the §4.3 reconciliation flow.",
  inputSchema: greetingCardSchema,
});

export const showPhoneNameCard = tool({
  description:
    "STEP 2 — Render the phone + name capture card (Heritage Editorial " +
    "replacement for show_phone_entry). Captures first name + last name + " +
    "phone (E.164 US/Canada) in one card so the orchestrator has enough data " +
    "to disambiguate from the first OTP attempt. Use this AFTER the customer " +
    "answers the greeting card.",
  inputSchema: phoneNameCardSchema,
});

export const showClarificationQuestion = tool({
  description:
    "STEP 7.4 — Render ONE clarification question from the diagnostic " +
    "specialist's queue. The customer picks one option OR taps 'I'm not sure' " +
    "to skip. After each answer, consult_orchestrator to decide whether to " +
    "ask another, propose testing services, or advance.",
  inputSchema: clarificationQuestionSchema,
});

export const showTestingServiceApproval = tool({
  description:
    "STEP 7.5 — Render the testing-service approval card with the diagnostic " +
    "specialist's recommendations. Pre-selects all by default; customer can " +
    "uncheck any to decline. Returns approved[] + declined[] (both captured " +
    "in the transcript).",
  inputSchema: testingServiceApprovalSchema,
});

export const showAppointmentType = tool({
  description:
    "STEP 8 — Render the waiter-vs-dropoff appointment type picker. Each " +
    "option carries available (boolean) and an earliest-hint date string. " +
    "Use this AFTER services/concerns are settled but BEFORE the date picker.",
  inputSchema: appointmentTypeCardSchema,
});

export const showCustomerNotesCard = tool({
  description:
    "STEP 10.2 — Render the optional notes textarea after appointment is " +
    "confirmed. Customer can submit free-form notes (≤500 chars) or skip. " +
    "2-edit cap enforced server-side.",
  inputSchema: customerNotesCardSchema,
});

export const showCustomerQuestionCard = tool({
  description:
    "STEP 10.3 — Render the optional question card after notes. Customer can " +
    "type a question (≤280 chars) for advisor follow-up, or skip.",
  inputSchema: customerQuestionCardSchema,
});

export const showSummaryCard = tool({
  description:
    "STEP 10.1 — Render the Heritage Editorial summary card (richer than " +
    "show_confirmation_card). Shows appointment time, customer, vehicle, " +
    "service breakdown grouped by routine/concern/testing, reminders, and a " +
    "10-minute hold countdown. Use as the pre-confirm review surface after " +
    "hold_appointment_slot succeeds.",
  inputSchema: summaryCardSchema,
});

export const showNoMatchChoosePath = tool({
  description:
    "STEP 3.5b — Render when §4.3 reconciliation lands on 0 phone matches " +
    "AND the customer said they were a returning customer. Two paths: " +
    "continue_as_new (fork to NewCustomerForm) or try_different_phone " +
    "(bounce back to PhoneNameCard). Per chat-design.md §3.5b.",
  inputSchema: noMatchChoosePathCardSchema,
});

export const showPartialVerificationGate = tool({
  description:
    "STEP 3.5 — Render when §4.3 reconciliation lands on a partial match " +
    "(name OR phone, not both). The card lets the customer pick whether " +
    "to use a different phone, proceed under the partial match, or set up " +
    "a new account. Per chat-design.md §3.5.",
  inputSchema: partialVerificationGateCardSchema,
});

export const showMultiAccountDisambiguation = tool({
  description:
    "STEP 3.5c — Render when phone hits 2+ Tekmetric customer records. " +
    "Customer picks which account is theirs from a list (each row shows " +
    "a recent vehicle for recognition). 'None of these' falls through to " +
    "show_no_match_choose_path. Per chat-design.md §3.5c.",
  inputSchema: multiAccountDisambiguationCardSchema,
});

export const showCustomerInfoEdit = tool({
  description:
    "STEP 5 (returning customer) — Render the customer info edit card after " +
    "OTP verification succeeds. Surfaces current Tekmetric phones/emails/" +
    "address and lets the customer confirm or update before vehicle pick. " +
    "Required for spec compliance per chat-design.md §Step 5 (returning " +
    "customer happy path was previously broken — customers skipped Step 5 " +
    "entirely and went directly to vehicle pick).",
  inputSchema: customerInfoEditCardSchema,
});

export const showCompletedCard = tool({
  description:
    "STEP 10.5 — Render the final 'all done' card after Step 10.3 question " +
    "submit. Warm Jeff-voice thanks + appointment recap + 'Schedule another' " +
    "CTA per chat-design.md §10.5. Terminal state — DO NOT render again on " +
    "the same session.",
  inputSchema: completedCardSchema,
});

// =====================================================================
// Bundle the tools as a registry the route handler passes to streamText
// =====================================================================

export function makeChatAgentTools(args: { session_id: string }) {
  return {
    consult_orchestrator: makeConsultOrchestratorTool(args),
    // Heritage Editorial cards (canonical per chat-design.md §4 + Chunk 6
    // 2026-05-13). The legacy `show_phone_entry` (phone-only, no name) and
    // `show_confirmation_card` (pre-Heritage summary) are DELIBERATELY not
    // registered — they're superseded by `show_phone_name_card` and
    // `show_summary_card`. Keeping them exposed lets the chat agent pick
    // the wrong tool (the system prompt prefers the new ones but model
    // drift can still surface the legacy variants → broken happy path).
    show_greeting_card: showGreetingCard,
    show_phone_name_card: showPhoneNameCard,
    show_otp_input: showOtpInput,
    show_vehicle_picker: showVehiclePicker,
    show_new_customer_form: showNewCustomerForm,
    show_service_and_concern_picker: showServiceAndConcernPicker,
    show_clarification_question: showClarificationQuestion,
    show_testing_service_approval: showTestingServiceApproval,
    show_appointment_type: showAppointmentType,
    show_calendar_date_picker: showCalendarDatePicker,
    show_waiter_time_picker: showWaiterTimePicker,
    show_no_match_choose_path: showNoMatchChoosePath,
    show_partial_verification_gate: showPartialVerificationGate,
    show_multi_account_disambiguation: showMultiAccountDisambiguation,
    show_customer_info_edit: showCustomerInfoEdit,
    show_summary_card: showSummaryCard,
    show_customer_notes_card: showCustomerNotesCard,
    show_customer_question_card: showCustomerQuestionCard,
    show_completed_card: showCompletedCard,
    show_escalation_card: showEscalationCard,
  } as const;
}

export type ChatAgentTools = ReturnType<typeof makeChatAgentTools>;
export type ChatAgentUITools = InferUITools<ChatAgentTools>;
