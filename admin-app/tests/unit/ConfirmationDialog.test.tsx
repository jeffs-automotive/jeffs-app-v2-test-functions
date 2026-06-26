import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationDialog } from "@/components/keytag/ConfirmationDialog";

/**
 * ConfirmationDialog is the Pattern A second-step gate (pattern-a-two-step-confirmation):
 * it shows the orchestrator's scope_summary so the actor sees the EXACT mutation before
 * confirming. It shows an advisory expiry countdown, but a fast client clock must NOT
 * dead-disable Confirm (L1) — the server's atomic consume is the real expiry gate. These
 * RTL tests pin that behavior (it's the UI half of the keytag confirmation security model).
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

  it("shows the expired notice but keeps Confirm CLICKABLE (L1: server gates expiry, not the client clock)", async () => {
    const props = baseProps();
    render(<ConfirmationDialog {...props} expiresAt={iso(-10)} />);
    // The advisory notice still renders…
    expect(await screen.findByText(/has expired/i)).toBeInTheDocument();
    // …but Confirm is NOT disabled. A fast client clock would otherwise dead-disable
    // it even when the server-side token is still valid (the L1 bug). The server's
    // atomic consume rejects a truly-expired token → a re-submit toast.
    const confirm = screen.getByRole("button", { name: /confirm release tag/i });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables Cancel while the Pattern A round-trip is pending", async () => {
    render(<ConfirmationDialog {...baseProps()} isPending />);
    expect(await screen.findByRole("button", { name: /^cancel$/i })).toBeDisabled();
  });
});
