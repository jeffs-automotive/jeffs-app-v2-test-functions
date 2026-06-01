import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationDialog } from "@/components/keytag/ConfirmationDialog";

/**
 * ConfirmationDialog is the Pattern A second-step gate (pattern-a-two-step-confirmation):
 * it shows the orchestrator's scope_summary so the actor sees the EXACT mutation before
 * confirming, and it must refuse a confirm once the 5-minute token has expired. These RTL
 * tests pin that behavior (it's the UI half of the keytag confirmation security model).
 */
const iso = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000).toISOString();

function baseProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    scopeSummary: "Release R4 from RO 12345 (posted_ar → released)",
    expiresAt: iso(300),
    actionLabel: "Release tag",
    isPending: false,
    onConfirm: vi.fn(),
  };
}

describe("ConfirmationDialog (Pattern A second-step gate)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the orchestrator scope_summary + action label so the actor sees the exact mutation", async () => {
    render(<ConfirmationDialog {...baseProps()} />);
    expect(await screen.findByText(/Release R4 from RO 12345/)).toBeInTheDocument();
    expect(screen.getByText(/Confirm: Release tag/)).toBeInTheDocument();
  });

  it("calls onConfirm when Confirm is clicked", async () => {
    const props = baseProps();
    render(<ConfirmationDialog {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: /confirm release tag/i }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange(false) when Cancel is clicked", async () => {
    const props = baseProps();
    render(<ConfirmationDialog {...props} />);
    await userEvent.click(await screen.findByRole("button", { name: /^cancel$/i }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables Confirm + shows the expired notice once the token has expired", async () => {
    render(<ConfirmationDialog {...baseProps()} expiresAt={iso(-10)} />);
    expect(await screen.findByText(/has expired/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm release tag/i })).toBeDisabled();
  });

  it("disables Cancel while the Pattern A round-trip is pending", async () => {
    render(<ConfirmationDialog {...baseProps()} isPending />);
    expect(await screen.findByRole("button", { name: /^cancel$/i })).toBeDisabled();
  });
});
