// Scheduler wizard state machine.
//
// Per chat-design.md 2026-05-13 §1-§10 + scheduler_phase1_design_lock.md.
//
// Design principles:
//   - The SERVER (orchestrator-direct + customer_chat_sessions row) is the
//     source of truth for current_step. The CLIENT machine mirrors it and
//     drives which card is rendered. On resume, hydrate from the server row.
//   - Every step transition is an explicit DIRECTIVE or step-specific event
//     with guards. NEVER allow arbitrary jumps from outside (everything goes
//     through ADVANCE / DIRECTIVE / step-specific event).
//   - Terminal states (completed, escalated, abandoned) accept RESTART /
//     RESUME_FROM_ABANDONED but NOT step events — the customer has to start
//     over or reactivate.
//
// XState v5 idiom: setup({ types, actions, guards }).createMachine({ id, initial, context, states, on }).
// Compatible with @xstate/react useMachine hook for client components.

import { assign, setup } from "xstate";

import {
  initialWizardContext,
  type WizardContext,
  type WizardEvent,
  type WizardStep,
} from "./wizard-types";

// ─── Directive → step routing ───────────────────────────────────────────────
//
// When a DIRECTIVE event arrives, the machine maps it to a step. This table
// is the canonical mapping per chat-design.md. Unmapped directives fall
// through to the current step (stay where you are).

const DIRECTIVE_TO_STEP: Record<string, WizardStep> = {
  // Step 2 / 4
  show_phone_entry: "phone_name",
  send_otp_first: "otp_pending",
  identity_match_required: "multi_account_disambiguation",
  show_new_customer_form: "new_customer_info",
  // Step 5/6
  show_vehicle_picker: "vehicle_pick",
  // Step 7
  show_service_and_concern_picker: "service_concern_picker",
  show_concern_explanation: "concern_explanation",
  show_diagnostic_loading: "diagnostic_loading",
  clarify_concern_question: "clarification_question",
  propose_testing_services: "testing_service_approval",
  show_second_routine_pass: "second_routine_pass",
  // Step 8/9
  show_appointment_type: "appointment_type",
  offer_earliest_available: "appointment_type",
  show_calendar_date_picker: "date_pick",
  show_waiter_time_picker: "waiter_time_pick",
  // Step 10
  render_confirmation_card: "summary",
  show_customer_notes_card: "customer_notes",
  show_customer_question_card: "customer_question",
  appointment_booked: "completed",
  hold_expired: "date_pick", // bounce customer back to picker
  // Terminal
  escalate: "escalated",
};

// ─── Machine ────────────────────────────────────────────────────────────────

export const wizardMachine = setup({
  types: {
    context: {} as WizardContext,
    events: {} as WizardEvent,
  },
  actions: {
    /** Merge HYDRATE payload into context (used on resume from server). */
    applyHydrate: assign(({ event }) => {
      if (event.type !== "HYDRATE") return {};
      return event.context;
    }),

    /** Record the most recent directive verbatim so views can read flags etc. */
    storeDirective: assign(({ event }) => {
      if (event.type !== "DIRECTIVE") return {};
      return {
        lastDirective: {
          directive: event.directive,
          data: event.data,
          flags: event.flags,
        },
      };
    }),

    setGreeting: assign(({ event }) => {
      if (event.type !== "SET_GREETING") return {};
      return { isReturningCustomer: event.isReturning };
    }),

    storePhoneName: assign(({ event }) => {
      if (event.type !== "SUBMIT_PHONE_NAME") return {};
      return {
        enteredFirstName: event.firstName,
        enteredLastName: event.lastName,
        enteredPhoneE164: event.phoneE164,
      };
    }),

    markOtpSent: assign(() => ({ otpSentAt: new Date().toISOString() })),

    storeOtpVerify: assign(({ event }) => {
      if (event.type !== "OTP_VERIFY") return {};
      return { otpAttempts: event.attempts, otpVerified: event.verified };
    }),

    storeIdentity: assign(({ event }) => {
      if (event.type !== "SET_IDENTITY") return {};
      return {
        identityVerificationLevel: event.level,
        verifiedCustomerId: event.customerId,
        verifiedFirstName: event.firstName,
        verifiedLastName: event.lastName,
      };
    }),

    selectVehicle: assign(({ event }) => {
      if (event.type !== "SELECT_VEHICLE") return {};
      return { selectedVehicleId: event.vehicleId, newVehicleDraft: null };
    }),

    setVehicleDraft: assign(({ event }) => {
      if (event.type !== "ADD_VEHICLE") return {};
      return { newVehicleDraft: event.draft, selectedVehicleId: null };
    }),

    storeSimpleServices: assign(({ event }) => {
      if (event.type !== "SUBMIT_SIMPLE_SERVICES") return {};
      return { selectedSimpleServices: event.services };
    }),

    storeExplanation: assign(({ context, event }) => {
      if (event.type !== "SUBMIT_EXPLANATION") return {};
      const existing = context.explanationRequiredItems.filter(
        (i) => i.serviceKey !== event.serviceKey,
      );
      return {
        explanationRequiredItems: [
          ...existing,
          { serviceKey: event.serviceKey, explanationText: event.explanationText },
        ],
      };
    }),

    queueClarifications: assign(({ event }) => {
      if (event.type !== "QUEUE_CLARIFICATIONS") return {};
      return { pendingClarificationQuestions: event.questions };
    }),

    answerClarification: assign(({ context, event }) => {
      if (event.type !== "ANSWER_CLARIFICATION") return {};
      // Drop the answered question from the pending queue; the orchestrator
      // is the authority on which to ask next.
      const remaining = context.pendingClarificationQuestions.filter(
        (q) => q.id !== event.questionId,
      );
      return { pendingClarificationQuestions: remaining };
    }),

    setTestingRecommendations: assign(({ event }) => {
      if (event.type !== "SET_TESTING_RECOMMENDATIONS") return {};
      return { recommendedTestingServices: event.services };
    }),

    approveTesting: assign(({ event }) => {
      if (event.type !== "APPROVE_TESTING") return {};
      return {
        approvedTestingServices: event.serviceKeys,
        declinedTestingServices: event.declinedKeys,
      };
    }),

    storeRoutineRound2: assign(({ event }) => {
      if (event.type !== "SUBMIT_ROUTINE_ROUND2") return {};
      return { additionalRoutineServicesRound2: event.services };
    }),

    storeAppointmentType: assign(({ event }) => {
      if (event.type !== "SELECT_APPOINTMENT_TYPE") return {};
      // Drop-off has no time (hardcoded server-side); waiter requires one.
      return {
        appointmentType: event.appointmentType,
        appointmentTime: event.appointmentType === "dropoff" ? null : null,
      };
    }),

    storeDate: assign(({ event }) => {
      if (event.type !== "SELECT_DATE") return {};
      return { appointmentDate: event.date };
    }),

    storeTime: assign(({ event }) => {
      if (event.type !== "SELECT_TIME") return {};
      return { appointmentTime: event.time };
    }),

    storeHoldPlaced: assign(({ event }) => {
      if (event.type !== "HOLD_PLACED") return {};
      return { holdToken: event.holdToken, holdExpiresAt: event.expiresAt };
    }),

    clearHold: assign(() => ({ holdToken: null, holdExpiresAt: null })),

    confirmAppointment: assign(({ event }) => {
      if (event.type !== "CONFIRM_APPOINTMENT") return {};
      return {
        appointmentId: event.appointmentId,
        appointmentConfirmedAt: event.confirmedAt,
      };
    }),

    submitNotes: assign(({ context, event }) => {
      if (event.type !== "SUBMIT_CUSTOMER_NOTES") return {};
      return {
        customerNotesText: event.text,
        customerNotesApproved: event.approved,
        customerNotesEditAttempts: context.customerNotesEditAttempts,
      };
    }),

    incNotesEditAttempt: assign(({ context }) => ({
      customerNotesEditAttempts: context.customerNotesEditAttempts + 1,
    })),

    submitQuestion: assign(({ event }) => {
      if (event.type !== "SUBMIT_CUSTOMER_QUESTION") return {};
      return { customerQuestion: event.text };
    }),

    escalate: assign(({ event }) => {
      if (event.type !== "ESCALATE") return {};
      return {
        escalatedAt: new Date().toISOString(),
        escalationReason: event.reason,
      };
    }),

    setError: assign(({ event }) => {
      if (event.type !== "SET_ERROR") return {};
      return { errorMessage: event.message };
    }),

    resetContext: assign(() => initialWizardContext),
  },
  guards: {
    /** OTP verified → can advance past OTP step. */
    isOtpVerified: ({ context }) => context.otpVerified === true,

    /** Customer notes have hit the 2-edit cap → escalate. */
    notesEditCapHit: ({ context }) =>
      context.customerNotesEditAttempts >= 2,

    /** Hold is still live (used to gate confirm). */
    holdStillValid: ({ context }) => {
      if (!context.holdExpiresAt) return false;
      return new Date(context.holdExpiresAt).getTime() > Date.now();
    },
  },
}).createMachine({
  id: "scheduler-wizard",
  initial: "greeting",
  context: initialWizardContext,
  on: {
    // Global event handlers — work from ANY step.
    HYDRATE: { actions: "applyHydrate" },
    SET_ERROR: { actions: "setError" },
    ESCALATE: { actions: "escalate", target: ".escalated" },
    ABANDON: { target: ".abandoned" },
    RESTART: { actions: "resetContext", target: ".greeting" },
    DIRECTIVE: {
      actions: "storeDirective",
      // The directive table drives the target step. Unmapped directives stay
      // put (XState semantics: a target outside the state map throws, so we
      // guard via the param.directive in DIRECTIVE_TO_STEP).
      target: "#scheduler-wizard.routingByDirective",
    },
  },
  states: {
    // ─── Step 1 ─────────────────────────────────────────────────────────────
    greeting: {
      on: {
        SET_GREETING: { actions: "setGreeting", target: "phone_name" },
        ADVANCE: { target: "phone_name", guard: ({ event }) => event.step === "phone_name" },
      },
    },

    // ─── Step 2 ─────────────────────────────────────────────────────────────
    phone_name: {
      on: {
        SUBMIT_PHONE_NAME: {
          actions: "storePhoneName",
          target: "otp_pending",
        },
      },
    },

    // ─── Step 3 ─────────────────────────────────────────────────────────────
    otp_pending: {
      entry: "markOtpSent",
      on: {
        OTP_VERIFY: [
          {
            actions: "storeOtpVerify",
            guard: "isOtpVerified",
            target: "customer_info_edit",
          },
          { actions: "storeOtpVerify" }, // stay; not yet verified
        ],
      },
    },

    // ─── Step 4 (verification reconciliation sub-flows) ─────────────────────
    partial_verification_gate: {
      on: { ADVANCE: { target: "customer_info_edit" } },
    },
    multi_account_disambiguation: {
      on: {
        SET_IDENTITY: {
          actions: "storeIdentity",
          target: "customer_info_edit",
        },
      },
    },
    no_match_choose_path: {
      on: {
        ADVANCE: [
          {
            target: "new_customer_info",
            guard: ({ event }) => event.step === "new_customer_info",
          },
          { target: "customer_info_edit" },
        ],
      },
    },

    // ─── Step 5 ─────────────────────────────────────────────────────────────
    customer_info_edit: {
      on: {
        ADVANCE: { target: "vehicle_pick" },
        SET_IDENTITY: { actions: "storeIdentity" },
      },
    },
    new_customer_info: {
      on: { ADVANCE: { target: "vehicle_pick" } },
    },

    // ─── Step 6 ─────────────────────────────────────────────────────────────
    vehicle_pick: {
      on: {
        SELECT_VEHICLE: {
          actions: "selectVehicle",
          target: "service_concern_picker",
        },
        ADD_VEHICLE: {
          actions: "setVehicleDraft",
          target: "new_vehicle_form",
        },
      },
    },
    new_vehicle_form: {
      on: {
        ADVANCE: { target: "service_concern_picker" },
        SELECT_VEHICLE: {
          actions: "selectVehicle",
          target: "service_concern_picker",
        },
      },
    },

    // ─── Step 7 ─────────────────────────────────────────────────────────────
    service_concern_picker: {
      on: {
        SUBMIT_SIMPLE_SERVICES: {
          actions: "storeSimpleServices",
          target: "concern_explanation",
        },
      },
    },
    concern_explanation: {
      on: {
        SUBMIT_EXPLANATION: {
          actions: "storeExplanation",
          target: "diagnostic_loading",
        },
      },
    },
    diagnostic_loading: {
      on: {
        QUEUE_CLARIFICATIONS: {
          actions: "queueClarifications",
          target: "clarification_question",
        },
        SET_TESTING_RECOMMENDATIONS: {
          actions: "setTestingRecommendations",
          target: "testing_service_approval",
        },
        ADVANCE: { target: "second_routine_pass" },
      },
    },
    clarification_question: {
      on: {
        ANSWER_CLARIFICATION: {
          actions: "answerClarification",
          // After answering, the chat agent will either queue more, surface
          // testing recommendations, or advance. We stay here until a new
          // directive moves us — answer mutates context but doesn't advance.
        },
        QUEUE_CLARIFICATIONS: { actions: "queueClarifications" },
        SET_TESTING_RECOMMENDATIONS: {
          actions: "setTestingRecommendations",
          target: "testing_service_approval",
        },
      },
    },
    testing_service_approval: {
      on: {
        APPROVE_TESTING: {
          actions: "approveTesting",
          target: "second_routine_pass",
        },
      },
    },
    second_routine_pass: {
      on: {
        SUBMIT_ROUTINE_ROUND2: {
          actions: "storeRoutineRound2",
          target: "appointment_type",
        },
        ADVANCE: { target: "appointment_type" },
      },
    },

    // ─── Step 8 ─────────────────────────────────────────────────────────────
    appointment_type: {
      on: {
        SELECT_APPOINTMENT_TYPE: {
          actions: "storeAppointmentType",
          target: "date_pick",
        },
      },
    },

    // ─── Step 9 ─────────────────────────────────────────────────────────────
    date_pick: {
      on: {
        SELECT_DATE: [
          {
            actions: "storeDate",
            target: "waiter_time_pick",
            guard: ({ context }) => context.appointmentType === "waiter",
          },
          { actions: "storeDate", target: "summary" },
        ],
      },
    },
    waiter_time_pick: {
      on: {
        SELECT_TIME: {
          actions: "storeTime",
          target: "summary",
        },
      },
    },

    // ─── Step 10 ────────────────────────────────────────────────────────────
    summary: {
      on: {
        HOLD_PLACED: { actions: "storeHoldPlaced" },
        HOLD_EXPIRED: { actions: "clearHold", target: "date_pick" },
        CONFIRM_APPOINTMENT: {
          actions: "confirmAppointment",
          target: "customer_notes",
          guard: "holdStillValid",
        },
      },
    },
    customer_notes: {
      on: {
        SUBMIT_CUSTOMER_NOTES: { actions: "submitNotes", target: "customer_question" },
        EDIT_NOTES: [
          { guard: "notesEditCapHit", actions: ["incNotesEditAttempt", "escalate"], target: "escalated" },
          { actions: "incNotesEditAttempt" },
        ],
        ADVANCE: { target: "customer_question" },
      },
    },
    customer_question: {
      on: {
        SUBMIT_CUSTOMER_QUESTION: { actions: "submitQuestion", target: "completed" },
        ADVANCE: { target: "completed" },
      },
    },

    // ─── Terminal states ────────────────────────────────────────────────────
    completed: { type: "final" },
    escalated: {
      // Allow RESTART to return to greeting (already global). Otherwise final-ish.
      on: { ADVANCE: "greeting" },
    },
    abandoned: {
      on: {
        RESUME_FROM_ABANDONED: { target: "greeting" },
      },
    },

    // ─── Internal routing target for the DIRECTIVE event ────────────────────
    // The DIRECTIVE handler at the top targets this state, which immediately
    // self-routes based on the directive→step table. Acts as a switchboard.
    routingByDirective: {
      always: [
        // Map each known directive to its target step. We list them here so
        // XState can verify the targets at machine-compile time (string
        // targets in `target` must reference declared states).
        { target: "phone_name", guard: ({ context }) => context.lastDirective?.directive === "show_phone_entry" },
        { target: "otp_pending", guard: ({ context }) => context.lastDirective?.directive === "send_otp_first" },
        { target: "multi_account_disambiguation", guard: ({ context }) => context.lastDirective?.directive === "identity_match_required" },
        { target: "new_customer_info", guard: ({ context }) => context.lastDirective?.directive === "show_new_customer_form" },
        { target: "vehicle_pick", guard: ({ context }) => context.lastDirective?.directive === "show_vehicle_picker" },
        { target: "service_concern_picker", guard: ({ context }) => context.lastDirective?.directive === "show_service_and_concern_picker" },
        { target: "concern_explanation", guard: ({ context }) => context.lastDirective?.directive === "show_concern_explanation" },
        { target: "diagnostic_loading", guard: ({ context }) => context.lastDirective?.directive === "show_diagnostic_loading" },
        { target: "clarification_question", guard: ({ context }) => context.lastDirective?.directive === "clarify_concern_question" },
        { target: "testing_service_approval", guard: ({ context }) => context.lastDirective?.directive === "propose_testing_services" },
        { target: "second_routine_pass", guard: ({ context }) => context.lastDirective?.directive === "show_second_routine_pass" },
        { target: "appointment_type", guard: ({ context }) => context.lastDirective?.directive === "show_appointment_type" || context.lastDirective?.directive === "offer_earliest_available" },
        { target: "date_pick", guard: ({ context }) => context.lastDirective?.directive === "show_calendar_date_picker" || context.lastDirective?.directive === "hold_expired" },
        { target: "waiter_time_pick", guard: ({ context }) => context.lastDirective?.directive === "show_waiter_time_picker" },
        { target: "summary", guard: ({ context }) => context.lastDirective?.directive === "render_confirmation_card" },
        { target: "customer_notes", guard: ({ context }) => context.lastDirective?.directive === "show_customer_notes_card" },
        { target: "customer_question", guard: ({ context }) => context.lastDirective?.directive === "show_customer_question_card" },
        { target: "completed", guard: ({ context }) => context.lastDirective?.directive === "appointment_booked" },
        { target: "escalated", guard: ({ context }) => context.lastDirective?.directive === "escalate" },
        // Default: bounce to greeting if the directive is totally unknown.
        // (continue / tool_error / slot_just_taken etc. fall through here —
        // the consumer reads lastDirective.flags directly without changing step.)
        { target: "greeting" },
      ],
    },
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Look up which step a directive routes to. Useful for the chat-bubble layer
 * to render an "advancing to step X..." hint while the machine transitions.
 */
export function directiveToStep(directive: string): WizardStep | null {
  return DIRECTIVE_TO_STEP[directive] ?? null;
}

/**
 * Resolve the current step name from a state value. XState states have
 * string or object value shape; for the flat machine here the value is
 * always a string.
 */
export function stepFromValue(value: unknown): WizardStep | null {
  if (typeof value === "string") {
    return (value as WizardStep) ?? null;
  }
  return null;
}
