import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/scheduler/system-prompt";

const sampleRoutineServices = [
  { service_key: "oil_change", display_name: "Oil Change" },
  { service_key: "state_inspection_emissions", display_name: "State Inspection and Emissions" },
  { service_key: "brake_inspection", display_name: "Brake Inspection" },
];

describe("buildSystemPrompt", () => {
  it("includes the agent name 'Jeff' as the persona", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(/I'm Jeff/);
    expect(prompt).toMatch(/Your name is "Jeff"/);
  });

  it("includes the first-turn disclosure verbatim with the opening question", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(
      /Hi, I'm Jeff — your AI scheduling assistant for Jeff's Automotive/,
    );
    expect(prompt).toMatch(/have you been to our shop before\?/);
  });

  it("includes the routine-service chips list interpolated from the input", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(/oil_change.*"Oil Change"/);
    expect(prompt).toMatch(/state_inspection_emissions.*"State Inspection/);
    expect(prompt).toMatch(/brake_inspection.*"Brake Inspection"/);
  });

  it("interpolates {SHOP_PHONE} placeholders with shop_phone_display", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(555) 123-4567",
    });
    expect(prompt).toMatch(/\(555\) 123-4567/);
    expect(prompt).not.toMatch(/\{SHOP_PHONE\}/);
  });

  it("web variant includes the rendering-tools list", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(/show_phone_entry/);
    expect(prompt).toMatch(/show_otp_input/);
    expect(prompt).toMatch(/show_calendar_date_picker/);
    expect(prompt).toMatch(/show_waiter_time_picker/);
    expect(prompt).toMatch(/show_confirmation_card/);
    expect(prompt).toMatch(/show_escalation_card/);
  });

  it("SMS variant does NOT include rendering-tools list and DOES include 'TWO-WAY CONVERSATION'", () => {
    const prompt = buildSystemPrompt({
      channel: "sms",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).not.toMatch(/show_phone_entry/);
    expect(prompt).not.toMatch(/show_calendar_date_picker/);
    expect(prompt).toMatch(/TWO-WAY CONVERSATION, not a menu/);
    expect(prompt).toMatch(/Reply 1 for X.*NEVER/i);
  });

  it("includes the minimum-turn principle section in both channels", () => {
    for (const channel of ["web", "sms"] as const) {
      const prompt = buildSystemPrompt({
        channel,
        routine_services: sampleRoutineServices,
        shop_phone_display: "(610) 253-6565",
      });
      expect(prompt).toMatch(/Minimum-turn principle/);
      expect(prompt).toMatch(/in as FEW TURNS as possible/);
    }
  });

  it("includes the off-topic redirect ladder in both channels", () => {
    for (const channel of ["web", "sms"] as const) {
      const prompt = buildSystemPrompt({
        channel,
        routine_services: sampleRoutineServices,
        shop_phone_display: "(610) 253-6565",
      });
      expect(prompt).toMatch(/Off-topic.*chatty/);
      expect(prompt).toMatch(/Three-step redirect ladder/);
    }
  });

  it("includes the post-confirmation reminders section (drop-off + state inspection)", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(
      /drop off your vehicle before 10 AM/i,
    );
    expect(prompt).toMatch(
      /up-to-date copies of your insurance and registration cards/i,
    );
  });

  it("includes the pricing rules — testing prices OK, parts/labor NOT OK", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(/CAN quote starting prices for diagnostic/i);
    expect(prompt).toMatch(/CANNOT quote prices for/i);
    expect(prompt).toMatch(/starting price.*more is needed/i);
  });

  it("includes the escalation triggers with all 6 categories", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(/manager/);
    expect(prompt).toMatch(/Hostile sentiment/);
    expect(prompt).toMatch(/Identity unverifiable/);
    expect(prompt).toMatch(/Refund.*dispute.*warranty.*complaint/i);
  });

  it("includes the phone-search reconciliation matrix", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    // Headers
    expect(prompt).toMatch(/Self-ID/);
    expect(prompt).toMatch(/Phone match/);
    // Specific cells
    expect(prompt).toMatch(/returning.*1 hit.*Confirm name/);
    expect(prompt).toMatch(/new.*1\+ hits.*records/);
  });

  it("forbids inventing slots / customer IDs / appointment IDs", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(/Never invent a slot time/);
    expect(prompt).toMatch(/Never disclose another customer/);
  });

  it("forbids revealing drop-off times to the customer", () => {
    const prompt = buildSystemPrompt({
      channel: "web",
      routine_services: sampleRoutineServices,
      shop_phone_display: "(610) 253-6565",
    });
    expect(prompt).toMatch(/Never show or reveal a time for a DROP-OFF/);
  });
});
