import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EscalationCard } from "@/components/scheduler/EscalationCard";

/**
 * Phase 17 (2026-05-16) — tests aligned to the current EscalationCard copy
 * + the back-to-scheduling output shape that landed in Phase 14.
 *
 * The card's two CTAs are:
 *   - "I'll call — close this chat"  → emits { acknowledged: true }
 *   - "Back to scheduling"           → emits { action: "back_to_scheduling" }
 *
 * Reason text is rendered as italic audit info `(Logged for our team: <reason>)`.
 */
describe("<EscalationCard />", () => {
  it("renders the apology copy + the formatted shop phone", () => {
    render(
      <EscalationCard
        reason="customer asked for a manager"
        shop_phone="+16102536565"
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/outside what I can handle from here/i),
    ).toBeInTheDocument();
    const phoneLink = screen.getByRole("link", { name: /\(610\) 253-6565/ });
    expect(phoneLink).toHaveAttribute("href", "tel:6102536565");
  });

  it("emits { acknowledged: true } when 'I'll call' is clicked", async () => {
    const onSubmit = vi.fn();
    render(
      <EscalationCard
        reason="hostile sentiment"
        shop_phone="+16102536565"
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /i'll call/i }),
    );
    expect(onSubmit).toHaveBeenCalledWith({ acknowledged: true });
  });

  it("emits { action: 'back_to_scheduling' } when 'Back to scheduling' is clicked", async () => {
    const onSubmit = vi.fn();
    render(
      <EscalationCard
        reason="keyword:legal:lawyer"
        shop_phone="+16102536565"
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /back to scheduling/i }),
    );
    expect(onSubmit).toHaveBeenCalledWith({ action: "back_to_scheduling" });
  });

  it("hides the back-to-scheduling CTA when allow_back_to_scheduling is false", () => {
    render(
      <EscalationCard
        reason="x"
        shop_phone="+16102536565"
        allow_back_to_scheduling={false}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /back to scheduling/i }),
    ).not.toBeInTheDocument();
    // The "I'll call" CTA is still present.
    expect(
      screen.getByRole("button", { name: /i'll call/i }),
    ).toBeInTheDocument();
  });

  it("renders the reason as italic audit info when provided", () => {
    render(
      <EscalationCard
        reason="tekmetric error after 3 retries"
        shop_phone="+16102536565"
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Logged for our team: tekmetric error after 3 retries/),
    ).toBeInTheDocument();
  });

  it("hides the reason block when reason is empty", () => {
    render(
      <EscalationCard
        reason=""
        shop_phone="+16102536565"
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/Logged for our team/),
    ).not.toBeInTheDocument();
  });

  it("formats a 10-digit phone (no country code) for display", () => {
    render(
      <EscalationCard
        reason="x"
        shop_phone="6102536565"
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("link", { name: /\(610\) 253-6565/ }),
    ).toBeInTheDocument();
  });

  it("disables both CTAs when disabled prop is set", () => {
    render(
      <EscalationCard
        reason="x"
        shop_phone="+16102536565"
        onSubmit={vi.fn()}
        disabled
      />,
    );

    expect(
      screen.getByRole("button", { name: /i'll call/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /back to scheduling/i }),
    ).toBeDisabled();
  });
});
