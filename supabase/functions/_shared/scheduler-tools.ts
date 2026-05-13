// AI SDK tool registry for the scheduler specialist.
//
// Per appointments_design.md §7.2.
//
// Wraps each pure tool function from `_shared/tools/scheduler-*.ts` into a
// Vercel AI SDK tool({ description, inputSchema, execute }) definition. The
// scheduler specialist (`_shared/specialists/scheduler.ts`, dispatched by
// `_shared/orchestrator.ts`) passes this map into
// generateText({ tools: getSchedulerTools(...) }).
//
// Chunk 2 refactor (2026-05-13): previously consumed by the now-deprecated
// `_shared/scheduler-orchestrator.ts`. Tool catalog itself is unchanged.
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
  getAppointmentEligibility,
  createNewCustomer,
  createNewVehicle,
} from "./tools/scheduler-customer.ts";
import {
  listAvailableSlots,
  getSlotCapacity,
  getEarliestAvailableSlots,
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
  listRoutineServices,
  listConcernQuestions,
  upsertTestingService,
  deactivateTestingService,
  upsertRoutineService,
  deactivateRoutineService,
} from "./tools/scheduler-pricing.ts";
import {
  uploadRoutineServicesMd,
  uploadTestingServicesMd,
  uploadConcernQuestionsMd,
  uploadAppointmentDefaultLimitsMd,
  uploadClosedDatesMd,
  exportRoutineServicesMd,
  exportTestingServicesMd,
  exportConcernQuestionsMd,
  exportAppointmentDefaultLimitsMd,
  exportClosedDatesMd,
  runAppointmentsSync,
  findOrphanCustomers,
} from "./tools/scheduler-admin.ts";

import type { ToolCallRecorder } from "./orchestrator-tools.ts";

// Re-export so consumers don't have to import from two places
export type { ToolCallRecorder } from "./orchestrator-tools.ts";

export interface SchedulerToolsArgs {
  sb: SupabaseClient;
  shopId: number;
  recorder: ToolCallRecorder;
  /** The scheduler session this orchestrator run is scoped to. */
  sessionId: string;
  /** When true, exposes admin tools (block/unblock + upsert/deactivate + MD-upload + helpers). */
  includeAdminTools?: boolean;
  /** Required when includeAdminTools is true; denormalized into audit columns. */
  audit?: {
    oauth_client_id: string;
    display_name: string;
  };
  /** Required when admin tools that call other Edge Functions are exposed
   *  (e.g. run_appointments_sync hits the appointments-sync function). When
   *  omitted, those tools are skipped from the registry. */
  supabaseUrl?: string;
  serviceRoleKey?: string;
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
  const {
    sb,
    shopId,
    recorder,
    sessionId,
    includeAdminTools,
    audit,
    supabaseUrl,
    serviceRoleKey,
  } = args;
  void sessionId; // reserved for per-session admin-action tagging in future chunks

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
        "Look up customers in Tekmetric by name. Tekmetric does substring/contains " +
        "matching server-side. When `max_distance` is supplied, we ALSO filter the " +
        "candidate set by Levenshtein edit distance ≤ max_distance against the " +
        "first/last/full normalized name — this catches typos like 'Jefery' → " +
        "'Jeffrey' (distance 1) without over-matching unrelated names. Default " +
        "behavior (no max_distance): return Tekmetric's raw substring matches. " +
        "Use fuzzy mode (max_distance=2) for the §4.3 reconciliation when the " +
        "customer's phone has 0 Tekmetric hits but they self-ID as returning. " +
        "Returns: { customers: [...], count, match_distances?: number[] } where " +
        "match_distances is populated only when max_distance was set; each entry " +
        "is the best (lowest) distance to any of first/last/full.",
      inputSchema: z.object({
        name: z
          .string()
          .min(2)
          .describe("Customer's first or full name. Trimmed; min 2 chars."),
        max_distance: z
          .number()
          .int()
          .min(0)
          .max(4)
          .optional()
          .describe(
            "Optional Levenshtein edit-distance cap (default 2 if set; omit for raw substring match). " +
              "Use 2 for normal typo tolerance; 0 for exact matches; 3-4 only when explicitly searching for fuzzy variants.",
          ),
      }),
      execute: recorded(recorder, "lookup_customer_by_name", (input) =>
        lookupCustomerByName(sb, shopId, input.name, {
          max_distance: input.max_distance,
        }),
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

    get_appointment_eligibility: tool({
      description:
        "Check whether a verified customer is eligible to book a new appointment. " +
        "Counts NO_SHOW history in the past 180 days and pending upcoming bookings " +
        "in the next 30 days. Returns: { eligible: boolean, reason?: 'repeated_no_shows', " +
        "warning?: 'recent_no_show_with_pending', no_show_count_180d, upcoming_within_30d }. " +
        "Decision rules: " +
        "(a) eligible=false + reason='repeated_no_shows' when no_show_count_180d >= 3 — " +
        "use the `escalate` directive ('we'd love to help, but our records show a few " +
        "missed appointments recently — please call us so we can sort this out'); " +
        "(b) eligible=true + warning='recent_no_show_with_pending' when there's already " +
        "an upcoming appointment AND a recent no-show — surface a friendly reminder " +
        "but proceed; " +
        "(c) eligible=true with no warning — proceed normally. " +
        "Call this AFTER OTP verify completes, BEFORE offering slots. Customers with " +
        "no Tekmetric history shadowed locally trivially pass.",
      inputSchema: z.object({
        customer_id: z
          .number()
          .int()
          .positive()
          .describe("Tekmetric customer_id of the verified customer."),
      }),
      execute: recorded(recorder, "get_appointment_eligibility", (input) =>
        getAppointmentEligibility(sb, shopId, input.customer_id),
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

    get_earliest_available_slots: tool({
      description:
        "Returns the EARLIEST waiter time-slots + the EARLIEST dropoff date " +
        "in a single compact answer. Cheaper than list_available_slots when the " +
        "chat agent just wants to surface 'we can get you in as soon as <date>' " +
        "(the §8 ' soonest available' card in the wizard). Use this AFTER service " +
        "+ vehicle are confirmed AND eligibility passes — the customer hasn't yet " +
        "asked for a specific day. If the customer wants to pick a different date, " +
        "follow up with list_available_slots for the full per-date grid. " +
        "Returns: { earliest_waiter: {date, times[]} | null, earliest_dropoff: " +
        "{date} | null, searched_through: 'YYYY-MM-DD' }.",
      inputSchema: z.object({
        appointment_type: z
          .enum(["waiter", "dropoff", "any"])
          .describe(
            "Filter to one type, or 'any' to fetch both earliest waiter + earliest dropoff in one call.",
          ),
        horizon_days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe(
            "How far ahead to search. Default 30 days; max 365 (matches the design-locked booking horizon).",
          ),
        waiter_slot_limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe(
            "How many waiter time-slots to return on the earliest day. Default 5; Phase 1 only has 2 (08:00, 09:00) so 5 is effectively no cap.",
          ),
      }),
      execute: recorded(recorder, "get_earliest_available_slots", (input) =>
        getEarliestAvailableSlots(sb, shopId, input),
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

  // ─── Pricing + catalog (read) ──────────────────────────────────────────────

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

    list_routine_services: tool({
      description:
        "Returns the active routine-service chip catalog (oil change, tire " +
        "rotation, state inspection, brake inspection, …) used to populate the " +
        "§7.1 service-and-concern picker. Each row carries: service_key, " +
        "display_name, abbreviation (4-letter Tekmetric title abbreviation), " +
        "display_order, active, AND two Phase-1 design-locked flags: " +
        "wait_eligible (TRUE → can be done while customer waits; drives waiter " +
        "vs dropoff eligibility) and requires_explanation (TRUE → picking this " +
        "chip kicks off the §7.2 free-form-explanation sub-flow, e.g. 'brake " +
        "inspection' needs 'tell us what you're noticing'). " +
        "Filter options (optional): " +
        "wait_eligible_only=true returns only chips a waiter customer is allowed " +
        "to combine; requires_explanation_only=true returns only chips that " +
        "trigger the explanation flow (used by the chat agent to pre-narrow " +
        "without re-filtering client-side). " +
        "Returns: { services: [...] }.",
      inputSchema: z.object({
        wait_eligible_only: z
          .boolean()
          .optional()
          .describe(
            "Filter to wait-eligible chips only (for waiter appointment picker).",
          ),
        requires_explanation_only: z
          .boolean()
          .optional()
          .describe(
            "Filter to chips that require a free-form explanation (for §7.2 sub-flow eligibility check).",
          ),
      }),
      execute: recorded(recorder, "list_routine_services", (input) =>
        listRoutineServices(sb, shopId, input),
      ),
    }),

    list_concern_questions: tool({
      description:
        "Returns the active clarification-question catalog for a single " +
        "concern category. Categories (per Chunk 1 migration): noise, " +
        "vibration, pulling, smell, smoke, leak, warning_light, performance, " +
        "electrical, hvac, brakes, steering, tires, other. " +
        "Used by the diagnostic Q&A specialist (Chunk 4) AND directly by the " +
        "scheduler specialist when it needs to render a customer-facing " +
        "clarification card. Each row carries: id, question_text, options " +
        "(array of {label, value} for multiple-choice rendering), display_order, " +
        "active. Sorted by display_order ascending. " +
        "Returns: { questions: [...], count }.",
      inputSchema: z.object({
        category: z
          .enum([
            "noise",
            "vibration",
            "pulling",
            "smell",
            "smoke",
            "leak",
            "warning_light",
            "performance",
            "electrical",
            "hvac",
            "brakes",
            "steering",
            "tires",
            "other",
          ])
          .describe("The concern category to fetch questions for."),
      }),
      execute: recorded(recorder, "list_concern_questions", (input) =>
        listConcernQuestions(sb, shopId, input.category),
      ),
    }),
  };

  // Result accumulator. We use `Record<string, ReturnType<typeof tool<any, any>>>`
  // (vs. `Record<string, ReturnType<typeof tool>>`) because each tool() call
  // returns a Tool<TInput, TOutput> narrowed by its inputSchema. The bare
  // ReturnType<typeof tool> defaults the generics to `never`, which then
  // refuses to accept spreads of differently-narrowed tools. The `any, any`
  // form is the same as the AI SDK's own `ToolSet` (Record<string, Tool>).
  // Pre-existing typing fixed in Chunk 2 refactor (2026-05-13).
  // deno-lint-ignore no-explicit-any
  let result: Record<string, ReturnType<typeof tool<any, any>>> = {
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

      // ─── MD-upload tools (bulk edit + export) ──────────────────────────────

      upload_routine_services_md: tool({
        description:
          "Bulk-update the routine_services catalog from a markdown table. " +
          "Required columns: service_key, display_name, abbreviation, " +
          "display_order, wait_eligible, requires_explanation, active. " +
          "Diff-based: rows present in MD = upsert; rows in DB but missing " +
          "from MD = soft-delete (set active=false). Idempotent on identical " +
          "uploads (md_content_hash check). Logs to scheduler_admin_audit_log " +
          "with structured diff_summary. Returns: { ok, rows_added, " +
          "rows_modified, rows_deactivated, diff_summary, parse_errors?, " +
          "validation_errors?, error_message? }.",
        inputSchema: z.object({
          md_content: z
            .string()
            .min(1)
            .describe("Full markdown file content as a string."),
        }),
        execute: recorded(recorder, "upload_routine_services_md", (input) =>
          uploadRoutineServicesMd(sb, shopId, { md_content: input.md_content, audit }),
        ),
      }),

      upload_testing_services_md: tool({
        description:
          "Bulk-update the testing_services catalog from a markdown table. " +
          "Required columns: service_key, display_name, abbreviation, " +
          "starting_price_cents, notes, concern_categories (comma-separated), " +
          "active. Diff-based with auto-soft-delete (same shape as " +
          "upload_routine_services_md). starting_price_cents is integer cents " +
          "(4995 = $49.95). concern_categories MUST be drawn from the 14 valid " +
          "categories. Returns: { ok, rows_added, rows_modified, " +
          "rows_deactivated, diff_summary, … }.",
        inputSchema: z.object({
          md_content: z.string().min(1),
        }),
        execute: recorded(recorder, "upload_testing_services_md", (input) =>
          uploadTestingServicesMd(sb, shopId, { md_content: input.md_content, audit }),
        ),
      }),

      upload_concern_questions_md: tool({
        description:
          "Bulk-update the concern_questions catalog from a markdown table. " +
          "Required columns: category, question_text, options, display_order, " +
          "active. category must be one of the 14 valid values. options is the " +
          "JSON array (e.g. '[{\"label\":\"Front\",\"value\":\"front\"}]') OR " +
          "the shorthand 'value:label; value2:label2'. Natural-key matching " +
          "is by (category, question_text) since rows have no service_key. " +
          "Returns: { ok, rows_added, rows_modified, rows_deactivated, … }.",
        inputSchema: z.object({
          md_content: z.string().min(1),
        }),
        execute: recorded(recorder, "upload_concern_questions_md", (input) =>
          uploadConcernQuestionsMd(sb, shopId, { md_content: input.md_content, audit }),
        ),
      }),

      upload_appointment_default_limits_md: tool({
        description:
          "Bulk-update the appointment_default_limits table from a markdown " +
          "table. Required columns: day_of_week (0=Sun..6=Sat), is_closed, " +
          "waiter_8am_slots, waiter_9am_slots, dropoff_total, notes. Phase 1 " +
          "expects exactly 7 rows (one per day of week). Returns: { ok, " +
          "rows_added, rows_modified, … }.",
        inputSchema: z.object({
          md_content: z.string().min(1),
        }),
        execute: recorded(
          recorder,
          "upload_appointment_default_limits_md",
          (input) =>
            uploadAppointmentDefaultLimitsMd(sb, shopId, {
              md_content: input.md_content,
              audit,
            }),
        ),
      }),

      upload_closed_dates_md: tool({
        description:
          "Replace the FUTURE closed_dates set from a markdown table. " +
          "Required columns: closed_date (YYYY-MM-DD), reason. Past " +
          "closed_dates are NEVER touched (immutable history). Rows in DB " +
          "but missing from MD (and ≥ today) are deleted. Idempotent on " +
          "duplicate uploads. Returns: { ok, rows_added, rows_modified, " +
          "rows_deactivated, … }.",
        inputSchema: z.object({
          md_content: z.string().min(1),
        }),
        execute: recorded(recorder, "upload_closed_dates_md", (input) =>
          uploadClosedDatesMd(sb, shopId, { md_content: input.md_content, audit }),
        ),
      }),

      export_routine_services_md: tool({
        description:
          "Export the current routine_services catalog as a markdown table " +
          "(round-trippable through upload_routine_services_md). Useful for " +
          "advisors to download, edit locally, then upload back. Returns: " +
          "{ md_content, row_count }.",
        inputSchema: z.object({}),
        execute: recorded(recorder, "export_routine_services_md", () =>
          exportRoutineServicesMd(sb, shopId),
        ),
      }),

      export_testing_services_md: tool({
        description:
          "Export the current testing_services catalog as a markdown table. " +
          "Returns: { md_content, row_count }.",
        inputSchema: z.object({}),
        execute: recorded(recorder, "export_testing_services_md", () =>
          exportTestingServicesMd(sb, shopId),
        ),
      }),

      export_concern_questions_md: tool({
        description:
          "Export the current concern_questions catalog as a markdown table. " +
          "Returns: { md_content, row_count }.",
        inputSchema: z.object({}),
        execute: recorded(recorder, "export_concern_questions_md", () =>
          exportConcernQuestionsMd(sb, shopId),
        ),
      }),

      export_appointment_default_limits_md: tool({
        description:
          "Export the current appointment_default_limits as a markdown table " +
          "(one row per day of week). Returns: { md_content, row_count }.",
        inputSchema: z.object({}),
        execute: recorded(
          recorder,
          "export_appointment_default_limits_md",
          () => exportAppointmentDefaultLimitsMd(sb, shopId),
        ),
      }),

      export_closed_dates_md: tool({
        description:
          "Export FUTURE closed_dates as a markdown table (past dates are " +
          "immutable history, excluded). Returns: { md_content, row_count }.",
        inputSchema: z.object({}),
        execute: recorded(recorder, "export_closed_dates_md", () =>
          exportClosedDatesMd(sb, shopId),
        ),
      }),

      find_orphan_customers: tool({
        description:
          "Find appointments in the local shadow whose last_synced_at is " +
          "stale (>24h) AND deleted_at is null — these are likely Tekmetric " +
          "deletions our sync missed, OR sync was paused for a window. " +
          "Same shape as the keytag orphan-release flow. Returns: { orphans: " +
          "[...], count, lookback_days }. Phase 1: 30-day default lookback; " +
          "advisor verifies in Tekmetric before acting.",
        inputSchema: z.object({
          lookback_days: z
            .number()
            .int()
            .min(1)
            .max(180)
            .optional()
            .describe("How far back to scan. Default 30 days; max 180."),
        }),
        execute: recorded(recorder, "find_orphan_customers", (input) =>
          findOrphanCustomers(sb, shopId, input),
        ),
      }),
    };

    // run_appointments_sync requires the SUPABASE_URL + service-role-key to
    // invoke the appointments-sync function. Skipped from registry if those
    // aren't supplied (defense in depth — the function-internal admin path
    // always supplies them; tests may not).
    if (supabaseUrl && serviceRoleKey) {
      Object.assign(adminTools, {
        run_appointments_sync: tool({
          description:
            "Trigger an on-demand call to appointments-sync (same job the cron " +
            "runs every 5 min). Use when the advisor knows Tekmetric just changed " +
            "and wants the local shadow refreshed now. Optional full_backfill=true " +
            "re-pulls the entire rolling window from scratch rather than the " +
            "incremental delta. Returns: { ok, status, summary }.",
          inputSchema: z.object({
            full_backfill: z
              .boolean()
              .optional()
              .describe(
                "If true, re-pull the entire rolling 7-day window from Tekmetric. Default false (incremental delta).",
              ),
          }),
          execute: recorded(recorder, "run_appointments_sync", (input) =>
            runAppointmentsSync({
              supabaseUrl,
              serviceRoleKey,
              full_backfill: input.full_backfill,
            }),
          ),
        }),
      });
    }
    result = { ...result, ...adminTools };
  }

  return result;
}
