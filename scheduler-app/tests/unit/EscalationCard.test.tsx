import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EscalationCard } from "@/components/scheduler/EscalationCard";

describe("<EscalationCard />", () => {
  it("renders the standard apology copy + the formatted shop phone", () => {
    render(
      <EscalationCard
        reason="customer asked for a manager"
        shop_phone="+16102536565"
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.getByText(/I'm not able to handle that here/i)
    ).toBeInTheDocument();
    const phoneLink = screen.getByRole("link", { name: /\(610\) 253-6565/ });
    expect(phoneLink).toHaveAttribute("href", "tel:6102536565");
  });

  it("emits { acknowledged: true } when 'Got it' clicked", async () => {
    const onSubmit = vi.fn();
    render(
      <EscalationCard
        reason="hostile sentiment"
        shop_phone="+16102536565"
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(onSubmit).toHaveBeenCalledWith({ acknowledged: true });
  });

  it("renders the reason as audit info", () => {
    render(
      <EscalationCard
        reason="tekmetric error after 3 retries"
        shop_phone="+16102536565"
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.getByText(/tekmetric error after 3 retries/)
    ).toBeInTheDocument();
  });

  it("hides the reason block when reason is empty", () => {
    render(
      <EscalationCard
        reason=""
        shop_phone="+16102536565"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.queryByText(/Reason logged for our team/)).not.toBeInTheDocument();
  });

  it("formats a 10-digit phone (no country code) for display", () => {
    render(
      <EscalationCard
        reason="x"
        shop_phone="6102536565"
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.getByRole("link", { name: /\(610\) 253-6565/ })
    ).toBeInTheDocument();
  });

  it("disables button while disabled or pending submit", () => {
    render(
      <EscalationCard
        reason="x"
        shop_phone="+16102536565"
        onSubmit={vi.fn()}
        disabled
      />
    );

    expect(screen.getByRole("button", { name: /got it/i })).toBeDisabled();
  });
});
