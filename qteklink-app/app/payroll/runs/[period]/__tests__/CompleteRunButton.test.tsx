/**
 * CompleteRunButton — the mark-complete dialog's gating contract (design spec
 * §3, Mark-payroll-complete; extracted from run-detail.test.tsx to keep that
 * file under the ~500-line policy):
 *   - stale mirror: Confirm stays disabled until the freshness acknowledgment
 *     checkbox is ticked; fresh mirror needs no checkbox;
 *   - UNSAVED-ENTRIES BLOCK: the completion snapshot freezes SAVED state only,
 *     so typed-but-unsaved grid cells (the #43 registry) BLOCK completion —
 *     alert + disabled Confirm at open, re-checked at confirm time;
 *   - action failures surface inside the dialog (no silent failure).
 * The Pattern S dance itself is server-side; these are wiring tests with the
 * action mocked at the module boundary.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const completeMock = vi.fn();
vi.mock("@/actions/payroll", () => ({
  completePayrollRunAction: (...args: unknown[]) => completeMock(...args),
}));

import { CompleteRunButton } from "../CompleteRunButton";
import { setUnsavedEntryCount } from "../unsaved-entries";

beforeEach(() => {
  vi.clearAllMocks();
  setUnsavedEntryCount(0); // the #43 registry is module-scoped — reset between tests
});

const baseProps = {
  runId: "33333333-3333-4333-8333-333333333333",
  employeeCount: 9,
  totalPayCents: 1_234_500,
  totalHours: 720,
  dataAsOf: "2026-07-08T04:00:00Z",
  periodEnd: "2026-07-11",
};

describe("CompleteRunButton", () => {
  it("gates Confirm behind the freshness acknowledgment when the mirror is stale", async () => {
    completeMock.mockResolvedValue({ ok: true, data: { completed: true }, timestamp: 1 });
    render(<CompleteRunButton {...baseProps} stale />);

    fireEvent.click(screen.getByRole("button", { name: /mark payroll complete/i }));
    const confirm = await screen.findByRole("button", { name: /^mark complete$/i });
    expect(confirm).toBeDisabled();
    expect(screen.getByText(/before this period ended/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(completeMock).toHaveBeenCalledTimes(1));
    const fd = completeMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("run_id")).toBe(baseProps.runId);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("needs no acknowledgment when the mirror is fresh", async () => {
    render(<CompleteRunButton {...baseProps} stale={false} />);
    fireEvent.click(screen.getByRole("button", { name: /mark payroll complete/i }));
    const confirm = await screen.findByRole("button", { name: /^mark complete$/i });
    expect(confirm).toBeEnabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("BLOCKS completion while the entry grid holds unsaved cells (alert + disabled Confirm)", async () => {
    // The completion snapshot freezes SAVED state only — typed-but-unsaved
    // hours would be silently excluded from the payroll record, so the dialog
    // reads the #43 registry at open and refuses to confirm.
    setUnsavedEntryCount(3);
    render(<CompleteRunButton {...baseProps} stale={false} />);

    fireEvent.click(screen.getByRole("button", { name: /mark payroll complete/i }));
    const confirm = await screen.findByRole("button", { name: /^mark complete$/i });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/3 unsaved changes/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/save \(or clear\)/i);

    fireEvent.click(confirm); // disabled — nothing may dispatch
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("re-checks the registry at confirm time — a grid dirtied after open still blocks", async () => {
    render(<CompleteRunButton {...baseProps} stale={false} />);
    fireEvent.click(screen.getByRole("button", { name: /mark payroll complete/i }));
    const confirm = await screen.findByRole("button", { name: /^mark complete$/i });
    expect(confirm).toBeEnabled(); // registry was clean at open
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    setUnsavedEntryCount(2); // dirtied since the dialog opened
    fireEvent.click(confirm);
    expect(completeMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/2 unsaved changes/i);
    expect(screen.getByRole("button", { name: /^mark complete$/i })).toBeDisabled();
  });

  it("surfaces an action failure inside the dialog (no silent failure)", async () => {
    completeMock.mockResolvedValue({
      ok: false,
      reason: "validation",
      message: "The run changed while you were reviewing — check the numbers and try again.",
      timestamp: 1,
    });
    render(<CompleteRunButton {...baseProps} stale={false} />);
    fireEvent.click(screen.getByRole("button", { name: /mark payroll complete/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^mark complete$/i }));
    expect(await screen.findByText(/check the numbers and try again/i)).toBeInTheDocument();
  });
});
