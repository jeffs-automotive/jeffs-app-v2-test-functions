/**
 * ArchiveEmployeeDialog — the archive-with-termination-date modal (plan §6 /
 * spec §1d). Wiring tests with archiveEmployeeAction mocked at the boundary:
 *   - the termination date defaults to today (one-click common case);
 *   - Archive dispatches archiveEmployeeAction with the employee id + the
 *     captured termination_date;
 *   - a chosen date rides through unchanged;
 *   - a failure surfaces inside the dialog.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const archiveMock = vi.fn();
vi.mock("@/actions/payroll-pto", () => ({
  archiveEmployeeAction: (...args: unknown[]) => archiveMock(...args),
}));

import ArchiveEmployeeDialog from "../ArchiveEmployeeDialog";

const employeeId = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  vi.clearAllMocks();
  archiveMock.mockResolvedValue({ ok: true, data: { archived: true }, timestamp: 1 });
});

function renderOpen() {
  render(
    <ArchiveEmployeeDialog
      open
      onOpenChange={() => {}}
      employeeId={employeeId}
      employeeName="Matt Clark"
    />,
  );
}

describe("ArchiveEmployeeDialog", () => {
  it("defaults the termination date to today", () => {
    renderOpen();
    const today = new Date().toISOString().slice(0, 10);
    expect(screen.getByLabelText(/termination date/i)).toHaveValue(today);
  });

  it("dispatches archiveEmployeeAction with the captured termination date", async () => {
    renderOpen();
    fireEvent.change(screen.getByLabelText(/termination date/i), {
      target: { value: "2026-07-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));

    await waitFor(() => expect(archiveMock).toHaveBeenCalledTimes(1));
    const fd = archiveMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("employee_id")).toBe(employeeId);
    expect(fd.get("termination_date")).toBe("2026-07-01");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces an action failure inside the dialog (no silent failure)", async () => {
    archiveMock.mockResolvedValue({
      ok: false,
      reason: "validation",
      message: "A termination date is required to archive.",
      timestamp: 1,
    });
    renderOpen();
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    expect(await screen.findByText(/a termination date is required/i)).toBeInTheDocument();
  });
});
