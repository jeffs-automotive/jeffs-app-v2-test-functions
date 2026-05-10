// AI SDK tool registry for the scheduler orchestrator.
//
// Per appointments_design.md §7.2.
//
// Wraps each pure tool function from `_shared/tools/scheduler-*.ts` into a
// Vercel AI SDK tool({ description, inputSchema, execute }) definition. The
// scheduler orchestrator (`_shared/scheduler-orchestrator.ts`) passes this
// map into generateText({ tools: getSchedulerTools(...) }).
//
// Tool description guidance (read this when adding new tools):
//   - Be specific about WHEN this tool is the right answer.
//   - Mention the FUZZY phrasings the customer might use ("which slots",
//     "what times do you have", etc.).
//   - List what the tool RETURNS so the orchestrator knows whether one call
//     suffices or whether it needs a follow-up.
//
// Logging: each tool's execute logs to public.tool_calls before/after via the
// supplied recorder. If the tool throws, the error message is captured.
//
// Admin tools (block/unblock capacity, upsert/deactivate services) are
// gated by `includeAdminTools` flag — only the Claude Desktop path
// (orchestrator-mcp) sets it true. The customer-facing orchestrator-direct
// path always passes false.

// AI SDK pinned at v5 — see .claude/memory/ai_sdk_and_models.md.
// v6 has open bug vercel/ai #12020. zod must be 4.1.8+ for the v2 schema spec.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { tool } from "npm:ai@^5";
import { z } from "npm:zod@^4";

import {
  lookupCustomerByPhone,
  lookupCustomerByName,
  verifyCustomerIdentity,
  lookupVehiclesForCustomer,
  getCustomerUpcomingAppointments,
  createNewCustomer,
  createNewVehicle,
} from "./tools/scheduler-customer.ts";
import {
  listAvailableSlots,
  getSlotCapacity,
  holdAppointmentSlot,
  confirmAppointment,
  rescheduleAppointment,
  cancelAppointment,
  blockAppointmentCapacity,
  unblockAppointmentCapacity,
} from "./tools/scheduler-slots.ts";
import {
  sendOtp,
  verifyOtp,
  escalateToHuman,
} from "./tools/scheduler-otp.ts";
import {
  lookupTestingServicePricing,
  upsertTestingService,
  deactivateTestingService,
  upsertRoutineService,
  deactivateRoutineService,
} from "./tools/scheduler-pricing.ts";

import type { ToolCallRecorder } from "./orchestrator-tools.ts";

// Re-export so consumers don't have to import from two places
export type { ToolCallRecorder } from "./orchestrator-tools.ts";

export interface SchedulerToolsArgs {
  sb: SupabaseClient;
  shopId: number;
  recorder: ToolCallRecorder;
  /** The scheduler session this orchestrator run is scoped to. */
  sessionId: string;
  /** When true, exposes admin tools (block/unblock + upsert/deactivate). */
  includeAdminTools?: boolean;
  /** Required when includeAdminTools is true; denormalized into audit columns. */
  audit?: {
    oauth_client_id: string;
    display_name: string;
  };
}

// Helper: wraps tool execution with the recorder, mirroring the pattern in
// orchestrator-tools.ts.
function recorded<TInput, TOutput>(
  recorder: ToolCallRecorder,
  toolName: string,
  fn: (input: TInput) => Promise<TOutput>,
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput) => {
    const callId = await recorder.recordStart({
      toolName,
      input: input as unknown,
      stepNumber: 0,
    });
    try {
      const result = await fn(input);
      await recorder.recordEnd({ toolCallId: callId, output: result });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await recorder.recordEnd({ toolCallId: callId, error: msg });
      throw e;
    }
  };
}

export function getSchedulerTools(args: SchedulerToolsArgs) {
  const { sb, shopId, recorder, sessionId, includeAdminTools, audit } = args;

  if (includeAdminTools && !audit) {
    throw new Error(
      "getSchedulerTools: audit is required when includeAdminTools is true",
    );
  }

  // ─── Customer + vehicle (read) ─────────────────────────────────────────────

  const customerReadTools = {
    lookup_customer_by_phone: tool({
      description:
        "Look up customers in Tekmetric by their phone number. Returns 0, 1, or " +
        "2+ matching customer records (the same phone can be on multiple records " +
        "in shared-phone scenarios). Use this for ANY booking/identity flow that " +
        "starts with a phone number; it's the FIRST step after the customer " +
        "submits their phone. Combine the returned count with the self-identified " +
        "status ('returning'/'new'/'unsure' from the opening question) to drive " +
        "the §4.3 reconciliation matrix. Returns: { customers: [...], count }.",
      inputSchema: z.object({
        phone_e164: z
          .string()
          .regex(/^\+1\d{10}$/)
          .describe("E.164 format, e.g., '+16105557777'"),
      }),
      execute: recorded(recorder, "lookup_customer_by_phone", (input) =>
        lookupCustomerByPhone(sb, shopId, input.phone_e164),
      ),
    }),

    lookup_customer_by_name: tool({
      description:
        "Look up customers in Tekmetric by name (case-insensitive substring). " +
        "Use this for the §4.3 reconciliation when phone search returns 2+ hits " +
        "(narrow by name) or when the customer self-IDs as 'returning' but " +
        "phone has 0 hits (try by name as fallback). Also used by the " +
        "shared-phone case where customer self-IDs as 'new' but phone matches: " +
        "we ask for their name to figure out if they're a different person than " +
        "the matched record. Returns: { customers: [...], count }.",
      inputSchema: z.object({
        name: z
          .string()
          .min(2)
          .describe("Customer's first or full name. Trimmed; min 2 chars."),
      }),
      execute: recorded(recorder, "lookup_customer_by_name", (input) =>
        lookupCustomerByName(sb, shopId, input.name),
      ),
    }),

    verify_customer_identity: tool({
      description:
        "Verify a self-asserted customer identity matches a Tekmetric record by " +
        "lenient name compare and/or vehicle match. Use this for any flow that " +
        "requires identity match per §4.6 ladder (reschedule, cancel, full " +
        "account-info disclosure). Booking a NEW appointment only needs phone- " +
        "verify, NOT identity match. Returns: { verified, name_match?, " +
        "vehicle_match?, mismatch_reason? }.",
      inputSchema: z.object({
        customer_id: z.number().int().positive(),
        name: z.string().optional(),
        vehicle_id: z.number().int().positive().optional(),
        vehicle_label: z
          .string()
          .optional()
          .describe(
            "e.g., '2018 Toyota Camry'; used when the chat agent has a label string but not the vehicle id.",
          ),
      }),
      execute: recorded(recorder, "verify_customer_identity", (input) =>
        verifyCustomerIdentity(sb, shopId, input),
      ),
    }),

    lookup_vehicles_for_customer: tool({
      description:
        "List a customer's vehicles from Tekmetric. Use this AFTER the customer " +
        "is matched to a Tekmetric customer_id, before rendering " +
        "show_vehicle_picker. Excludes deleted vehicles. Returns: { vehicles: " +
        "[...], count }.",
      inputSchema: z.object({
        customer_id: z.number().int().positive(),
      }),
      execute: recorded(recorder, "lookup_vehicles_for_customer", (input) =>
        lookupVehiclesForCustomer(sb, shopId, input.customer_id),
      ),
    }),

    get_customer_upcoming_appointments: tool({
      description:
        "Get a customer's UPCOMING appointments from the local 7-day shadow. " +
        "Phase 1 = forward-only 7-day window; NO historical appointments. " +
        "If a customer asks about an appointment more than 7 days out OR in " +
        "the past, fall back to 'I don't have that handy; please call us at " +
        "6102536565.' Use this when the customer says 'when's my next " +
        "appointment?' or 'do I have anything scheduled?', NOT to display " +
        "history. Returns: { appointments: [...], count }.",
      inputSchema: z.object({
        customer_id: z.number().int().positive(),
      }),
      execute: recorded(
        recorder,
        "get_customer_upcoming_appointments",
        (input) =>
          getCustomerUpcomingAppointments(sb, shopId, input.customer_id),
      ),
    }),
  };

  // ─── Slots / capacity (read) ───────────────────────────────────────────────

  const slotReadTools = {
    list_available_slots: tool({
      description:
        "Returns the available slots for a date range. PRIMARY tool for the " +
        "booking flow; use this immediately after customer + vehicle are " +
        "established, BEFORE asking the customer to pick a date. Reads from " +
        "the local 7-day shadow for fast response (millisec) within today.. " +
        "today+7d, falls through to Tekmetric for far-future dates. Returns: " +
        "{ available: { 'YYYY-MM-DD': { waiter_times, dropoff_available } }, " +
        "earliest: { waiter?: {date, times}, dropoff?: {date} } }. The chat " +
        "agent uses `earliest` for the proactive 'I can get you in as soon as " +
        "<date>' offering and the per-date map for show_calendar_date_picker.",
      inputSchema: z.object({
        type: z
          .enum(["waiter", "dropoff", "any"])
          .optional()
          .describe("Default 'any'. Filter to one type if customer was specific."),
        date_range_start: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("ISO YYYY-MM-DD. Default = today."),
        date_range_end: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("ISO YYYY-MM-DD (exclusive). Default = today + 30 days."),
        limit: z.number().int().positive().max(60).optional(),
      }),
      execute: recorded(recorder, "list_available_slots", (input) =>
        listAvailableSlots(sb, shopId, input),
      ),
    }),

    get_slot_capacity: tool({
      description:
        "Detailed capacity status for a single date: waiter_remaining (per " +
        "time), dropoff_remaining, total_remaining, blocks. Less heavily used " +
        "in customer flow (list_available_slots is primary); use this for " +
        "admin/debugging or when the customer asks something specific like " +
        "'is the morning still open Friday?'. Returns: { date, waiter_remaining, " +
        "dropoff_remaining, total_remaining, blocks }.",
      inputSchema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
      execute: recorded(recorder, "get_slot_capacity", (input) =>
        getSlotCapacity(sb, shopId, input.date),
      ),
    }),
  };

  // ─── Booking writes ────────────────────────────────────────────────────────

  const bookingTools = {
    hold_appointment_slot: tool({
      description:
        "Reserve a 30-minute hold on a slot. Use this AFTER the customer picks " +
        "a date+time (waiter) or just a date (drop-off), BEFORE rendering the " +
        "confirmation card. Race-safe via advisory lock for waiter, daily-cap " +
        "check for drop-off. If another customer just took the slot, throws " +
        "with message 'slot_just_taken'; orchestrator catches it, returns " +
        "directive 'show_slot_taken_redirect', chat agent re-fetches slots. " +
        "For waiter, `time` is REQUIRED ('08:00' or '09:00'). For drop-off, " +
        "`time` is IGNORED (orchestrator hard-codes 12:00). Returns: { hold_id, " +
        "expires_at }.",
      inputSchema: z.object({
        customer_id: z.number().int().positive().optional(),
        vehicle_id: z.number().int().positive().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.enum(["08:00", "09:00"]).optional(),
        type: z.enum(["waiter", "dropoff"]),
        service_summary: z
          .string()
          .min(2)
          .describe(
            "Brief prose summary of what's being booked, e.g., 'Oil change' or " +
              "'Brake inspection: front grinding noise'. Goes into hold record " +
              "for context.",
          ),
      }),
      execute: recorded(recorder, "hold_appointment_slot", (input) =>
        holdAppointmentSlot(sb, shopId, {
          session_id: sessionId,
          customer_id: input.customer_id,
          vehicle_id: input.vehicle_id,
          date: input.date,
          time: input.time,
          type: input.type,
          service_summary: input.service_summary,
        }),
      ),
    }),

    confirm_appointment: tool({
      description:
        "Finalize a held slot: POST /appointments to Tekmetric, mark hold " +
        "consumed, write-through to local shadow, set appointment_id on the " +
        "session. Use this AFTER the customer taps Confirm on " +
        "show_confirmation_card. Builds the Tekmetric title as " +
        "'<customer> <year> <make> <model> <abbreviation>' per §12.1.1. " +
        "Throws 'hold_expired', 'hold_already_released', or " +
        "'tekmetric_post_failed'. Returns: { appointment_id, status, " +
        "start_time }.",
      inputSchema: z.object({
        hold_id: z.string().uuid(),
        customer_id: z.number().int().positive(),
        vehicle_id: z.number().int().positive(),
        title: z
          .string()
          .min(5)
          .describe(
            "Pre-built Tekmetric title: '<customer> <year> <make> <model> " +
              "<abbreviation>' per §12.1.1, e.g., 'Vince Zulauf 2018 Toyota Camry LOF'.",
          ),
        description: z
          .string()
          .min(2)
          .describe(
            "Prose summary that goes into Tekmetric appointment.description. " +
              "For routine: just the service name. For concern: the prose pattern " +
              "from §7.1, e.g., 'Customer states a clunking noise from the front " +
              "driver's side, especially over bumps and worse under heavy braking.'",
          ),
        appointment_option: z
          .enum(["WAITER", "PICKUP_DROPOFF", "TOWED", "NONE"])
          .optional(),
      }),
      execute: recorded(recorder, "confirm_appointment", (input) =>
        confirmAppointment(sb, shopId, input),
      ),
    }),

    reschedule_appointment: tool({
      description:
        "Reschedule an existing appointment to a new date / time. REQUIRES " +
        "identity match per §4.6 ladder (caller must have already verified " +
        "name + vehicle, NOT just phone). PATCH /appointments/<id> on " +
        "Tekmetric + update local shadow. Returns: { success: true, " +
        "new_start_time }.",
      inputSchema: z.object({
        appointment_id: z.number().int().positive(),
        new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        new_time: z.enum(["08:00", "09:00"]).optional(),
        appointment_type: z.enum(["waiter", "dropoff"]),
      }),
      execute: recorded(recorder, "reschedule_appointment", (input) =>
        rescheduleAppointment(sb, shopId, input),
      ),
    }),

    cancel_appointment: tool({
      description:
        "Cancel an existing appointment. REQUIRES identity match per §4.6. " +
        "DELETE /appointments/<id> on Tekmetric (idempotent: 404 is fine). " +
        "Soft-deletes the local shadow row. Returns: { success: true }.",
      inputSchema: z.object({
        appointment_id: z.number().int().positive(),
      }),
      execute: recorded(recorder, "cancel_appointment", (input) =>
        cancelAppointment(sb, shopId, input),
      ),
    }),

    create_new_customer: tool({
      description:
        "Create a new customer in Tekmetric. NOT idempotent; orchestrator " +
        "MUST first call lookup_customer_by_phone to dedup (especially in " +
        "the §4.3 'self-IDs new but phone matches' shared-phone scenario). " +
        "Used after show_new_customer_form submission. Returns: { customer_id }.",
      inputSchema: z.object({
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        phone_e164: z.string().regex(/^\+1\d{10}$/),
        email: z.string().email().optional(),
        address: z
          .object({
            streetAddress: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            zip: z.string().optional(),
          })
          .optional(),
      }),
      execute: recorded(recorder, "create_new_customer", (input) =>
        createNewCustomer(sb, shopId, input),
      ),
    }),

    create_new_vehicle: tool({
      description:
        "Create a new vehicle for a customer in Tekmetric. NOT idempotent. " +
        "Used after show_vehicle_picker -> 'Add new vehicle' OR as part of the " +
        "new-customer onboarding (where new-customer-form includes a vehicle " +
        "subset). Returns: { vehicle_id }.",
      inputSchema: z.object({
        customer_id: z.number().int().positive(),
        year: z.number().int().min(1900).max(2100),
        make: z.string().min(1),
        model: z.string().min(1),
        sub_model: z.string().optional(),
        vin: z.string().optional(),
        license_plate: z.string().optional(),
        color: z.string().optional(),
      }),
      execute: recorded(recorder, "create_new_vehicle", (input) =>
        createNewVehicle(sb, shopId, input),
      ),
    }),
  };

  // ─── OTP + escalation ──────────────────────────────────────────────────────

  const otpEscalationTools = {
    send_otp: tool({
      description:
        "Send a 6-digit OTP code to the customer's phone via SMS. Used on web " +
        "channel only; SMS channel is carrier-verified and skips OTP entirely " +
        "(per §4.1). Phase 1 STUB: the SMS-send call is currently stubbed " +
        "pending Chris's SMS-provider decision. The code IS persisted and " +
        "verifiable; the customer just won't receive a real SMS until the " +
        "provider is wired. Rate-limit: 3 active codes per phone per hour. " +
        "Returns: { ok, ttl_seconds, phone_last_four } or { ok: false, " +
        "error: 'rate_limited' | 'send_failed' }.",
      inputSchema: z.object({
        phone_e164: z.string().regex(/^\+1\d{10}$/),
        ip_addr: z.string().optional(),
      }),
      execute: recorded(recorder, "send_otp", (input) =>
        sendOtp(sb, shopId, input),
      ),
    }),

    verify_otp: tool({
      description:
        "Verify a customer-entered OTP code. Single-use; max 3 attempts per " +
        "code, then auto-consumed (force resend). Returns: { verified: true } " +
        "or { verified: false, error: 'no_active_code' | 'invalid_code' | " +
        "'too_many_attempts' | 'expired' }.",
      inputSchema: z.object({
        phone_e164: z.string().regex(/^\+1\d{10}$/),
        code: z.string().regex(/^\d{6}$/),
      }),
      execute: recorded(recorder, "verify_otp", (input) =>
        verifyOtp(sb, shopId, input),
      ),
    }),

    escalate_to_human: tool({
      description:
        "Return the shop phone + a stock escalation message. Caller renders " +
        "show_escalation_card on web or plain text on SMS, then sets the " +
        "session status to 'escalated'. Use whenever any §10 escalation " +
        "trigger fires. Returns: { shop_phone, message, reason }.",
      inputSchema: z.object({
        reason: z
          .string()
          .describe(
            "Short description of why we're escalating, e.g., 'manager keyword' or " +
              "'tekmetric_error_after_retry'. Goes into logs.",
          ),
      }),
      execute: recorded(recorder, "escalate_to_human", async (input) =>
        escalateToHuman(input),
      ),
    }),
  };

  // ─── Pricing (read) ────────────────────────────────────────────────────────

  const pricingReadTools = {
    lookup_testing_service_pricing: tool({
      description:
        "Look up starting prices for testing/diagnostic services. Match by " +
        "service_key (exact) OR concern_category (categorical). May return " +
        "multiple services for a single category (e.g., 'electrical' returns " +
        "alternator + battery + general electrical testing). Empty result is " +
        "the 'I don't have pricing for that' fallback signal; chat agent " +
        "tells the customer to call the shop. ALWAYS include 'starting price; " +
        "more testing may be needed' caveat when quoting. Returns: { services: " +
        "[...], count }.",
      inputSchema: z.object({
        service_key: z.string().optional(),
        concern_category: z.string().optional(),
      }),
      execute: recorded(recorder, "lookup_testing_service_pricing", (input) =>
        lookupTestingServicePricing(sb, shopId, input),
      ),
    }),
  };

  let result: Record<string, ReturnType<typeof tool>> = {
    ...customerReadTools,
    ...slotReadTools,
    ...bookingTools,
    ...otpEscalationTools,
    ...pricingReadTools,
  };

  // ─── Admin tools (gated) ───────────────────────────────────────────────────

  if (includeAdminTools && audit) {
    const adminTools = {
      block_appointment_capacity: tool({
        description:
          "Block capacity for a day, type, or specific waiter time. " +
          "Granularity: { date } blocks entire day; { date, type } blocks all " +
          "of that type; { date, type: 'waiter', time: '08:00' } blocks just " +
          "the 8 AM slot. Audit fields denormalized for clear historical logs. " +
          "Returns: { block_id }.",
        inputSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          type: z.enum(["waiter", "dropoff"]).optional(),
          time: z.enum(["08:00", "09:00"]).optional(),
          reason: z.string().optional(),
        }),
        execute: recorded(recorder, "block_appointment_capacity", (input) =>
          blockAppointmentCapacity(sb, shopId, {
            ...input,
            created_by_oauth_client_id: audit.oauth_client_id,
            created_by_name: audit.display_name,
          }),
        ),
      }),

      unblock_appointment_capacity: tool({
        description:
          "Remove blocks matching the criteria. Match must be EXACT: to " +
          "remove a full-day block, omit type and time; to remove a specific " +
          "8 AM block, pass type='waiter' and time='08:00'. Returns: { removed }.",
        inputSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          type: z.enum(["waiter", "dropoff"]).optional(),
          time: z.enum(["08:00", "09:00"]).optional(),
        }),
        execute: recorded(recorder, "unblock_appointment_capacity", (input) =>
          unblockAppointmentCapacity(sb, shopId, input),
        ),
      }),

      upsert_testing_service: tool({
        description:
          "Add or update a testing-service row (price, abbreviation, notes, " +
          "concern_categories, active). Match by (shop_id, service_key): " +
          "INSERT if new, UPDATE if existing. Returns: { service_id, action }.",
        inputSchema: z.object({
          service_key: z.string().min(1),
          display_name: z.string().min(1),
          abbreviation: z.string().min(1),
          starting_price_cents: z.number().int().nonnegative(),
          notes: z.string().optional(),
          concern_categories: z.array(z.string()).optional(),
          active: z.boolean().optional(),
        }),
        execute: recorded(recorder, "upsert_testing_service", (input) =>
          upsertTestingService(sb, shopId, {
            ...input,
            updated_by_oauth_client_id: audit.oauth_client_id,
            updated_by_name: audit.display_name,
          }),
        ),
      }),

      deactivate_testing_service: tool({
        description:
          "Soft-delete a testing-service row by setting active=false. " +
          "Preserves transcript references. Returns: { success: true }.",
        inputSchema: z.object({
          service_key: z.string().min(1),
        }),
        execute: recorded(recorder, "deactivate_testing_service", (input) =>
          deactivateTestingService(sb, shopId, input),
        ),
      }),

      upsert_routine_service: tool({
        description:
          "Add or update a routine-service chip (one of the 10 picker chips). " +
          "Match by (shop_id, service_key). Display order controls picker " +
          "ordering. Returns: { service_id, action }.",
        inputSchema: z.object({
          service_key: z.string().min(1),
          display_name: z.string().min(1),
          abbreviation: z.string().min(1),
          display_order: z.number().int().positive(),
          active: z.boolean().optional(),
        }),
        execute: recorded(recorder, "upsert_routine_service", (input) =>
          upsertRoutineService(sb, shopId, {
            ...input,
            updated_by_oauth_client_id: audit.oauth_client_id,
            updated_by_name: audit.display_name,
          }),
        ),
      }),

      deactivate_routine_service: tool({
        description:
          "Soft-delete a routine-service chip. Hides from picker but preserves " +
          "history. Returns: { success: true }.",
        inputSchema: z.object({
          service_key: z.string().min(1),
        }),
        execute: recorded(recorder, "deactivate_routine_service", (input) =>
          deactivateRoutineService(sb, shopId, input),
        ),
      }),
    };
    result = { ...result, ...adminTools };
  }

  return result;
}
