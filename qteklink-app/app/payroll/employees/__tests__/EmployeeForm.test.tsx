/**
 * EmployeeForm — the round-11 form changes (plan §2a / spec §1a). Wiring tests
 * with the upsert + profile actions mocked at the module boundary:
 *   - the legacy manual PTO inputs are GONE (balance/accrual fields);
 *   - editing an employee renders the Contact & personal panel + PTO tenure;
 *   - the grandfather checkbox reveals the optional tenure-credit date;
 *   - saving dispatches BOTH the pay_config upsert AND a profile patch carrying
 *     ONLY the changed fields (an emptied field submits null to clear; a stored
 *     pay_config value round-trips untouched);
 *   - unchanged profile fields dispatch NO profile patch.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PayrollEmployee } from "@/lib/dal/payroll";

/** jsdom does not submit a <form> on a submit-button CLICK — submit the form
 *  element the button belongs to (the button carries type="submit"). */
function submitViaSaveButton(name: RegExp) {
  const btn = screen.getByRole("button", { name });
  const form = btn.closest("form");
  if (!form) throw new Error("Save button is not inside a form");
  fireEvent.submit(form);
}

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const upsertMock = vi.fn();
const listMock = vi.fn();
vi.mock("@/actions/payroll", () => ({
  upsertPayrollEmployeeAction: (...args: unknown[]) => upsertMock(...args),
  listTekmetricEmployeesAction: (...args: unknown[]) => listMock(...args),
}));

const profileMock = vi.fn();
vi.mock("@/actions/payroll-pto", () => ({
  updateEmployeeProfileAction: (...args: unknown[]) => profileMock(...args),
}));

import EmployeeForm from "../EmployeeForm";

const baseEmployee: PayrollEmployee = {
  id: "66666666-6666-4666-8666-666666666666",
  shopId: 7476,
  displayName: "Matt Clark",
  role: "shop_support",
  tekmetricEmployeeId: null,
  tekmetricIdType: null,
  // A stored value the form must round-trip untouched now that the input is gone.
  payConfig: { config_version: 1, hourly_rate_cents: 2000, pto_balance_hours: 17 },
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  workEmail: null,
  personalEmail: null,
  personalPhone: null,
  workPhone: null,
  address: null,
  startDate: null,
  terminationDate: null,
  ptoGrandfathered: false,
  ptoTenureCreditDate: null,
  fullTime: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  upsertMock.mockResolvedValue({ ok: true, data: { employeeId: baseEmployee.id }, timestamp: 1 });
  profileMock.mockResolvedValue({ ok: true, data: { updated: true }, timestamp: 1 });
});

describe("EmployeeForm — round-11 changes", () => {
  it("no longer renders the manual PTO balance / accrual inputs", () => {
    render(<EmployeeForm employee={baseEmployee} onDone={() => {}} />);
    expect(screen.queryByText(/available balance \(hours\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/accrual \(hours per pay period\)/i)).not.toBeInTheDocument();
  });

  it("renders the Contact & personal panel + PTO tenure in edit mode", () => {
    render(<EmployeeForm employee={baseEmployee} onDone={() => {}} />);
    expect(screen.getByText("Contact & personal")).toBeInTheDocument();
    expect(screen.getByText(/^pto tenure$/i)).toBeInTheDocument();
    // The identity/personal fields exist (input's accessible name via its label).
    expect(screen.getByRole("textbox", { name: /personal email/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^start date/i)).toBeInTheDocument();
  });

  it("reveals the tenure-credit date only when Grandfather is checked", () => {
    render(<EmployeeForm employee={baseEmployee} onDone={() => {}} />);
    expect(screen.queryByText(/tenure-credit date/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /grandfather in/i }));
    expect(screen.getByText(/tenure-credit date/i)).toBeInTheDocument();
  });

  it("saves pay_config via upsert AND a profile patch of ONLY the changed fields", async () => {
    render(<EmployeeForm employee={baseEmployee} onDone={() => {}} />);

    // Change one profile field (personal email) — a diff the patch must carry.
    fireEvent.change(screen.getByRole("textbox", { name: /personal email/i }), {
      target: { value: "matt@home.com" },
    });
    submitViaSaveButton(/save changes/i);

    await waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(profileMock).toHaveBeenCalledTimes(1));

    // The upsert carries the round-tripped stored PTO value untouched.
    const upsertFd = upsertMock.mock.calls[0]?.[1] as FormData;
    const payConfig = JSON.parse(String(upsertFd.get("pay_config"))) as Record<string, unknown>;
    expect(payConfig.pto_balance_hours).toBe(17);
    expect(payConfig.hourly_rate_cents).toBe(2000);

    // The profile patch carries ONLY the changed field.
    const profileFd = profileMock.mock.calls[0]?.[1] as FormData;
    expect(profileFd.get("employee_id")).toBe(baseEmployee.id);
    const patch = JSON.parse(String(profileFd.get("patch"))) as Record<string, unknown>;
    expect(patch).toEqual({ personal_email: "matt@home.com" });
  });

  it("clears an emptied field with null and omits unchanged fields", async () => {
    render(
      <EmployeeForm
        employee={{ ...baseEmployee, personalEmail: "old@home.com" }}
        onDone={() => {}}
      />,
    );
    // Empty the previously-set personal email → the patch clears it with null.
    fireEvent.change(screen.getByRole("textbox", { name: /personal email/i }), {
      target: { value: "" },
    });
    submitViaSaveButton(/save changes/i);

    await waitFor(() => expect(profileMock).toHaveBeenCalledTimes(1));
    const profileFd = profileMock.mock.calls[0]?.[1] as FormData;
    const patch = JSON.parse(String(profileFd.get("patch"))) as Record<string, unknown>;
    expect(patch).toEqual({ personal_email: null });
  });

  it("dispatches NO profile patch when no profile field changed", async () => {
    render(<EmployeeForm employee={baseEmployee} onDone={() => {}} />);
    submitViaSaveButton(/save changes/i);
    await waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
    expect(profileMock).not.toHaveBeenCalled();
  });

  it("renders the full-time toggle checked by default and patches full_time:false when unchecked", async () => {
    render(<EmployeeForm employee={baseEmployee} onDone={() => {}} />);
    const fullTime = screen.getByRole("checkbox", { name: /full-time/i });
    expect(fullTime).toBeChecked(); // baseEmployee.fullTime === true

    // Flip a full-timer off → the patch carries ONLY full_time:false.
    fireEvent.click(fullTime);
    expect(fullTime).not.toBeChecked();
    submitViaSaveButton(/save changes/i);

    await waitFor(() => expect(profileMock).toHaveBeenCalledTimes(1));
    const profileFd = profileMock.mock.calls[0]?.[1] as FormData;
    const patch = JSON.parse(String(profileFd.get("patch"))) as Record<string, unknown>;
    expect(patch).toEqual({ full_time: false });
  });

  it("a part-time employee renders the toggle unchecked; re-checking patches full_time:true", async () => {
    render(<EmployeeForm employee={{ ...baseEmployee, fullTime: false }} onDone={() => {}} />);
    const fullTime = screen.getByRole("checkbox", { name: /full-time/i });
    expect(fullTime).not.toBeChecked();

    fireEvent.click(fullTime);
    submitViaSaveButton(/save changes/i);

    await waitFor(() => expect(profileMock).toHaveBeenCalledTimes(1));
    const profileFd = profileMock.mock.calls[0]?.[1] as FormData;
    const patch = JSON.parse(String(profileFd.get("patch"))) as Record<string, unknown>;
    expect(patch).toEqual({ full_time: true });
  });
});
