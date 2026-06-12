import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * WizardSurface — failed-submit error banner (approved functional read
 * 2026-06-11, decision log #2).
 *
 * Before this change a failed Server Action surfaced NOTHING to the customer
 * (logIfFailed → Sentry only; the spinner just stopped). WizardSurface now
 * threads the already-returned `result.ok === false` outcome into local
 * client state and renders an inline role="alert" banner with a retry
 * affordance + the shop phone number, cleared on the next successful
 * transition. These tests prove the banner shows on failure, stays hidden on
 * success, and that the retry link dismisses it — at full assertion strength.
 *
 * The whole wizard action graph is "use server" + Supabase-backed, so every
 * action module the switch imports is mocked to keep the import graph loadable
 * in jsdom. Only the greeting path is exercised; its action's return is
 * controllable per-test via `state.result`.
 */

// vi.hoisted so these are initialized BEFORE the hoisted vi.mock factories run.
// `state.result` is the mutable holder for the greeting action's return value.
const { submitGreetingV2, state } = vi.hoisted(() => {
  const state: { result: { ok: boolean; next_step?: string; error?: string } } = {
    result: { ok: true, next_step: "phone_name" },
  };
  const submitGreetingV2 = vi.fn(async () => state.result);
  return { submitGreetingV2, state };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// The action under test.
vi.mock("@/lib/scheduler/wizard/actions/submit-greeting", () => ({
  submitGreetingV2,
}));

// Every other action module imported by the switch — stubbed so the import
// graph loads in jsdom without dragging in "use server" / Supabase code.
// Factories must be self-contained (vi.mock is hoisted above any top-level
// const), so each defines its own no-op export inline.
vi.mock("@/lib/scheduler/wizard/actions/resend-otp", () => ({ resendOtpV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/run-diagnostics", () => ({ runDiagnosticsV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-appointment-type", () => ({ submitAppointmentTypeV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-clarification-answer", () => ({ submitClarificationAnswerV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-customer-info-edit", () => ({ submitCustomerInfoEditV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-customer-notes", () => ({ submitCustomerNotesV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-customer-question", () => ({ submitCustomerQuestionV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-date", () => ({ submitDateV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/dismiss-escalation", () => ({ dismissEscalationV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-explanation", () => ({ submitExplanationV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-multi-account-choice", () => ({ submitMultiAccountChoiceV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-new-customer-info", () => ({ submitNewCustomerInfoV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-new-vehicle", () => ({ submitNewVehicleV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-no-match-choice", () => ({ submitNoMatchChoiceV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-otp", () => ({ submitOtpV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-partial-verification-choice", () => ({ submitPartialVerificationChoiceV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-phone-name", () => ({ submitPhoneNameV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-second-routine-pass", () => ({ submitSecondRoutinePassV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-service-and-concern-picker", () => ({ submitServiceAndConcernPickerV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-start-over", () => ({ submitStartOverV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-summary", () => ({ submitSummaryV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-testing-service-approval", () => ({ submitTestingServiceApprovalV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-vehicle-pick", () => ({ submitVehiclePickV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
vi.mock("@/lib/scheduler/wizard/actions/submit-waiter-time", () => ({ submitWaiterTimeV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));
// WizardBackBar's action.
vi.mock("@/lib/scheduler/wizard/actions/submit-back", () => ({ submitBackV2: vi.fn(async () => ({ ok: true, next_step: "greeting" })) }));

import { WizardSurface } from "@/components/scheduler/wizard/WizardSurface";

const greetingCard = { step: "greeting" as const, payload: {} };

describe("<WizardSurface /> failed-submit banner", () => {
  beforeEach(() => {
    state.result = { ok: true, next_step: "phone_name" };
    submitGreetingV2.mockClear();
  });

  it("shows no error banner before any submit", () => {
    render(<WizardSurface chatId="chat-1" card={greetingCard} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the banner hidden when the action succeeds", async () => {
    state.result = { ok: true, next_step: "phone_name" };
    render(<WizardSurface chatId="chat-1" card={greetingCard} />);

    await userEvent.click(
      screen.getByRole("button", { name: /returning customer/i }),
    );

    expect(submitGreetingV2).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a role=alert banner with retry + phone when the action fails", async () => {
    state.result = { ok: false, error: "network down" };
    render(<WizardSurface chatId="chat-1" card={greetingCard} />);

    await userEvent.click(
      screen.getByRole("button", { name: /first time/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something didn't go through/i);
    // Retry affordance is a real, focusable control.
    expect(
      screen.getByRole("button", { name: /tap to try again/i }),
    ).toBeInTheDocument();
    // Phone fallback links to the shop number.
    const tel = screen.getByRole("link", { name: /\(610\) 253-6565/ });
    expect(tel).toHaveAttribute("href", "tel:6102536565");
  });

  it("dismisses the banner when the retry affordance is tapped", async () => {
    state.result = { ok: false, error: "network down" };
    render(<WizardSurface chatId="chat-1" card={greetingCard} />);

    await userEvent.click(
      screen.getByRole("button", { name: /first time/i }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /tap to try again/i }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
