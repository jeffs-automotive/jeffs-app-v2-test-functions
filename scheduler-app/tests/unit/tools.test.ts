import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/scheduler/orchestrator-client", () => ({
  consultOrchestrator: vi.fn(),
  OrchestratorError: class OrchestratorError extends Error {
    constructor(
      message: string,
      public readonly status?: number,
    ) {
      super(message);
      this.name = "OrchestratorError";
    }
  },
}));

import {
  makeChatAgentTools,
  phoneEntrySchema,
  otpInputSchema,
  vehiclePickerSchema,
  serviceAndConcernPickerSchema,
  calendarDatePickerSchema,
  waiterTimePickerSchema,
  newCustomerFormSchema,
  confirmationCardSchema,
  escalationCardSchema,
} from "@/lib/scheduler/tools";
import {
  consultOrchestrator,
  OrchestratorError,
} from "@/lib/scheduler/orchestrator-client";

// We test the exported zod schemas directly. Why: AI SDK v5's tool(...) wraps
// the schema in FlexibleSchema<T> which doesn't expose .safeParse on its
// public surface. The schemas are exported from tools.ts as their own consts
// alongside the tool() defs that consume them, so they stay in sync.

describe("rendering tool input schemas", () => {
  it("show_phone_entry accepts empty object", () => {
    const ok = phoneEntrySchema.safeParse({});
    expect(ok.success).toBe(true);
  });

  it("show_phone_entry accepts { reason: string }", () => {
    const ok = phoneEntrySchema.safeParse({
      reason: "to look up your account",
    });
    expect(ok.success).toBe(true);
  });

  it("show_otp_input requires phone_last_four (4 digits) + ttl_seconds", () => {
    expect(
      otpInputSchema.safeParse({ phone_last_four: "1234", ttl_seconds: 300 })
        .success,
    ).toBe(true);

    expect(
      otpInputSchema.safeParse({ phone_last_four: "12", ttl_seconds: 300 })
        .success,
    ).toBe(false);
    expect(
      otpInputSchema.safeParse({ phone_last_four: "1234" }).success,
    ).toBe(false);
    expect(
      otpInputSchema.safeParse({
        phone_last_four: "1234",
        ttl_seconds: -1,
      }).success,
    ).toBe(false);
  });

  it("show_vehicle_picker requires vehicles[] + allow_add_new", () => {
    expect(
      vehiclePickerSchema.safeParse({
        vehicles: [{ id: "1", label: "2018 Camry" }],
        allow_add_new: true,
      }).success,
    ).toBe(true);

    expect(
      vehiclePickerSchema.safeParse({
        vehicles: [{ id: "1" }],
        allow_add_new: true,
      }).success,
    ).toBe(false);
  });

  it("show_service_and_concern_picker requires array of {service_key, display_name}", () => {
    expect(
      serviceAndConcernPickerSchema.safeParse({
        common_services: [
          { service_key: "oil_change", display_name: "Oil Change" },
        ],
      }).success,
    ).toBe(true);

    expect(
      serviceAndConcernPickerSchema.safeParse({
        common_services: [{ service_key: "oil_change" }],
      }).success,
    ).toBe(false);
  });

  it("show_calendar_date_picker requires ISO YYYY-MM-DD dates and a type", () => {
    expect(
      calendarDatePickerSchema.safeParse({
        available_dates: ["2026-05-13", "2026-05-19"],
        type: "dropoff",
      }).success,
    ).toBe(true);

    expect(
      calendarDatePickerSchema.safeParse({
        available_dates: ["May 13"],
        type: "dropoff",
      }).success,
    ).toBe(false);

    expect(
      calendarDatePickerSchema.safeParse({
        available_dates: ["2026-05-13"],
        type: "invalid",
      }).success,
    ).toBe(false);
  });

  it("show_waiter_time_picker accepts only '08:00' or '09:00'", () => {
    expect(
      waiterTimePickerSchema.safeParse({
        date: "2026-05-19",
        available_times: ["08:00", "09:00"],
      }).success,
    ).toBe(true);

    expect(
      waiterTimePickerSchema.safeParse({
        date: "2026-05-19",
        available_times: ["10:00"],
      }).success,
    ).toBe(false);

    expect(
      waiterTimePickerSchema.safeParse({
        date: "2026-05-19",
        available_times: [],
      }).success,
    ).toBe(false); // min(1)
  });

  it("show_new_customer_form requires mode 'full' or 'vehicle-only'", () => {
    expect(
      newCustomerFormSchema.safeParse({ mode: "full" }).success,
    ).toBe(true);
    expect(
      newCustomerFormSchema.safeParse({ mode: "vehicle-only" }).success,
    ).toBe(true);
    expect(
      newCustomerFormSchema.safeParse({ mode: "bogus" }).success,
    ).toBe(false);
  });

  it("show_confirmation_card requires summary, starts_at, customer, vehicle, type", () => {
    expect(
      confirmationCardSchema.safeParse({
        summary: "Oil Change",
        starts_at: "2026-05-19T08:00:00Z",
        customer: "Vince Zulauf",
        vehicle: "2018 Toyota Camry",
        type: "waiter",
      }).success,
    ).toBe(true);

    expect(
      confirmationCardSchema.safeParse({
        summary: "Oil Change",
        // missing starts_at
        customer: "X",
        vehicle: "Y",
        type: "waiter",
      }).success,
    ).toBe(false);
  });

  it("show_escalation_card requires reason + shop_phone", () => {
    expect(
      escalationCardSchema.safeParse({
        reason: "manager keyword",
        shop_phone: "+16102536565",
      }).success,
    ).toBe(true);
    expect(
      escalationCardSchema.safeParse({ reason: "x" }).success,
    ).toBe(false);
  });
});

describe("makeChatAgentTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all 10 tools (1 data + 9 rendering)", () => {
    const tools = makeChatAgentTools({ session_id: "sess-1" });
    expect(Object.keys(tools).sort()).toEqual(
      [
        "consult_orchestrator",
        "show_calendar_date_picker",
        "show_confirmation_card",
        "show_escalation_card",
        "show_new_customer_form",
        "show_otp_input",
        "show_phone_entry",
        "show_service_and_concern_picker",
        "show_vehicle_picker",
        "show_waiter_time_picker",
      ].sort(),
    );
  });

  it("consult_orchestrator passes session_id through to the underlying call", async () => {
    vi.mocked(consultOrchestrator).mockResolvedValue({
      directive: "show_phone_entry",
    });

    const tools = makeChatAgentTools({ session_id: "sess-abc" });
    const consult = tools.consult_orchestrator;
    expect(consult.execute).toBeDefined();

    const result = await consult.execute!(
      { context: "Customer wants oil change" },
      // The AI SDK passes a 2nd arg with toolCallId/messages — provide a minimal stub.
      { toolCallId: "tc-1", messages: [] } as unknown as Parameters<
        NonNullable<typeof consult.execute>
      >[1],
    );

    expect(consultOrchestrator).toHaveBeenCalledWith({
      session_id: "sess-abc",
      context: "Customer wants oil change",
      hints: undefined,
    });
    expect(result).toEqual({ directive: "show_phone_entry" });
  });

  it("consult_orchestrator returns directive='tool_error' on OrchestratorError instead of crashing", async () => {
    vi.mocked(consultOrchestrator).mockRejectedValue(
      new OrchestratorError("orchestrator-direct returned 503", 503),
    );

    const tools = makeChatAgentTools({ session_id: "sess-1" });
    const result = await tools.consult_orchestrator.execute!(
      { context: "x" },
      { toolCallId: "t", messages: [] } as unknown as Parameters<
        NonNullable<typeof tools.consult_orchestrator.execute>
      >[1],
    );

    expect(result).toMatchObject({
      directive: "tool_error",
      flags: { tekmetric_error: true },
    });
  });

  it("consult_orchestrator handles plain Error (not OrchestratorError)", async () => {
    vi.mocked(consultOrchestrator).mockRejectedValue(
      new Error("unexpected"),
    );

    const tools = makeChatAgentTools({ session_id: "sess-1" });
    const result = await tools.consult_orchestrator.execute!(
      { context: "x" },
      { toolCallId: "t", messages: [] } as unknown as Parameters<
        NonNullable<typeof tools.consult_orchestrator.execute>
      >[1],
    );

    expect(result).toMatchObject({
      directive: "tool_error",
      flags: { tekmetric_error: true },
    });
  });
});
