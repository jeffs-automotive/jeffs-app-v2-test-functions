/**
 * PtoAdjustDialog — the roster's Adjust affordance (plan §6 / spec §1c). Wiring
 * tests with the actions mocked at the module boundary:
 *   - Save is gated until a non-zero hours amount AND a non-blank reason;
 *   - the live preview shows the resulting balance, and a result that goes
 *     negative renders the DeficitNotice alert;
 *   - a valid save dispatches adjustPtoAction with the signed hours + reason;
 *   - the seed variant (no ledger yet) uses seedInitialBalanceAction, keeps the
 *     reason optional, and SETS the balance to the entered value.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const adjustMock = vi.fn();
const seedMock = vi.fn();
vi.mock("@/actions/payroll-pto", () => ({
  adjustPtoAction: (...args: unknown[]) => adjustMock(...args),
  seedInitialBalanceAction: (...args: unknown[]) => seedMock(...args),
}));

import PtoAdjustDialog from "../PtoAdjustDialog";

const employeeId = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  adjustMock.mockResolvedValue({ ok: true, data: { balanceAfterHours: 10 }, timestamp: 1 });
  seedMock.mockResolvedValue({ ok: true, data: { balanceAfterHours: 40 }, timestamp: 1 });
});

function openAdjust(currentBalanceHours = 12) {
  render(
    <PtoAdjustDialog
      employeeId={employeeId}
      employeeName="Matt Clark"
      currentBalanceHours={currentBalanceHours}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^adjust$/i }));
}

describe("PtoAdjustDialog (adjustment)", () => {
  it("keeps Save disabled until a non-zero amount AND a reason are entered", async () => {
    openAdjust();
    const save = await screen.findByRole("button", { name: /save adjustment/i });
    expect(save).toBeDisabled();

    // Hours only — still blocked (reason required for an adjustment).
    fireEvent.change(screen.getByLabelText(/adjustment in hours/i), { target: { value: "3.5" } });
    expect(save).toBeDisabled();

    // Reason added — now enabled.
    fireEvent.change(screen.getByLabelText(/adjustment reason/i), {
      target: { value: "Starting balance" },
    });
    expect(save).toBeEnabled();

    // A zero amount re-disables even with a reason.
    fireEvent.change(screen.getByLabelText(/adjustment in hours/i), { target: { value: "0" } });
    expect(save).toBeDisabled();
  });

  it("shows a DeficitNotice when the resulting balance goes negative", async () => {
    openAdjust(2);
    fireEvent.change(screen.getByLabelText(/adjustment in hours/i), { target: { value: "-5" } });
    // The preview alert names the deficit; it is announced (role=alert). fmtHours
    // is min-1 decimal, so |−3| renders "3.0".
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/3\.0-hour deficit/i);
    expect(alert).toHaveTextContent(/negative balances are allowed/i);
  });

  it("dispatches adjustPtoAction with the signed hours + reason on save", async () => {
    openAdjust(12);
    fireEvent.change(screen.getByLabelText(/adjustment in hours/i), { target: { value: "-1.25" } });
    fireEvent.change(screen.getByLabelText(/adjustment reason/i), {
      target: { value: "Correcting an over-grant" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save adjustment/i }));

    await waitFor(() => expect(adjustMock).toHaveBeenCalledTimes(1));
    const fd = adjustMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("employee_id")).toBe(employeeId);
    expect(fd.get("hours")).toBe("-1.25");
    expect(fd.get("reason")).toBe("Correcting an over-grant");
    expect(seedMock).not.toHaveBeenCalled();
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces an action failure inside the dialog (no silent failure)", async () => {
    adjustMock.mockResolvedValue({
      ok: false,
      reason: "validation",
      message: "A reason is required for a PTO adjustment.",
      timestamp: 1,
    });
    openAdjust();
    fireEvent.change(screen.getByLabelText(/adjustment in hours/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/adjustment reason/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /save adjustment/i }));
    expect(await screen.findByText(/a reason is required/i)).toBeInTheDocument();
  });
});

describe("PtoAdjustDialog (seed — no ledger yet)", () => {
  it("uses seedInitialBalanceAction, keeps the reason optional, and sets the balance", async () => {
    render(
      <PtoAdjustDialog
        employeeId={employeeId}
        employeeName="Matt Clark"
        currentBalanceHours={0}
        needsSeed
      />,
    );
    // Trigger button (roster) reads "Set balance"; the footer confirm is "Save balance".
    fireEvent.click(screen.getByRole("button", { name: /^set balance$/i }));

    const save = await screen.findByRole("button", { name: /^save balance$/i });
    // Reason is optional for a seed → hours alone enables Save.
    fireEvent.change(screen.getByLabelText(/starting balance in hours/i), { target: { value: "40" } });
    expect(save).toBeEnabled();

    // The preview reflects the SET value (not current + delta): 40.0 hrs.
    expect(screen.getByText("40.0", { exact: false })).toBeInTheDocument();

    fireEvent.click(save);
    await waitFor(() => expect(seedMock).toHaveBeenCalledTimes(1));
    const fd = seedMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("hours")).toBe("40");
    expect(fd.get("reason")).toBeNull(); // omitted when blank
    expect(adjustMock).not.toHaveBeenCalled();
  });
});
