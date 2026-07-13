/**
 * AlertEmailsCard — four alert-email chip lists. Wiring contract (plan §2d/§10.1,
 * C25):
 *   - the two LEGACY lists (void_clone / completed) travel together — an add to
 *     either submits BOTH FormData fields;
 *   - the two PTO lists (adjustment / negative-admin) are INDEPENDENT top-level
 *     keys — an add to one submits ONLY that field (no legacy fields, no sibling
 *     PTO field);
 *   - remove works the same way per list.
 * The settings action + next/navigation are mocked at the module boundary.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PayrollAlertEmails } from "@/lib/dal/payroll";

const actionMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("@/actions/payroll", () => ({
  updatePayrollSettingsAction: (...args: unknown[]) => actionMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import AlertEmailsCard from "../AlertEmailsCard";

const LEGACY: PayrollAlertEmails = { void_clone: ["void@x.com"], completed: ["done@x.com"] };

beforeEach(() => {
  vi.clearAllMocks();
  actionMock.mockResolvedValue({ ok: true, data: { payroll: {} }, timestamp: Date.now() });
});

function renderCard(over: Partial<Parameters<typeof AlertEmailsCard>[0]> = {}) {
  render(
    <AlertEmailsCard
      alertEmails={LEGACY}
      ptoAdjustmentEmails={[]}
      ptoNegativeEmails={[]}
      {...over}
    />,
  );
}

describe("AlertEmailsCard", () => {
  it("renders all four lists, including the two PTO lists", () => {
    renderCard({ ptoAdjustmentEmails: ["adj@x.com"], ptoNegativeEmails: ["neg@x.com"] });
    expect(screen.getByText(/void & clone alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/payroll completed alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/pto adjustment alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/negative pto balance alerts/i)).toBeInTheDocument();
    expect(screen.getByText("adj@x.com")).toBeInTheDocument();
    expect(screen.getByText("neg@x.com")).toBeInTheDocument();
  });

  it("shows the empty copy for a PTO list with no recipients", () => {
    renderCard();
    // Four lists, two legacy populated + two PTO empty → two "No one" lines.
    expect(screen.getAllByText(/no one gets this alert yet/i)).toHaveLength(2);
  });

  /** Add a recipient to a given list section and submit its add-form. */
  function addTo(sectionTitle: RegExp, email: string) {
    const heading = screen.getByText(sectionTitle);
    const form = heading.closest("div")!.querySelector("form")!;
    const input = form.querySelector("input")!;
    fireEvent.change(input, { target: { value: email } });
    fireEvent.submit(form);
  }

  it("submits the PTO adjustment list as an INDEPENDENT single-key patch", async () => {
    renderCard();
    addTo(/pto adjustment alerts/i, "new-adj@x.com");

    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const fd = actionMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("pto_adjustment_alert_emails")).toBe("new-adj@x.com");
    // Independence: no legacy fields, no sibling PTO field travel along.
    expect(fd.get("void_clone_alert_emails")).toBeNull();
    expect(fd.get("completed_alert_emails")).toBeNull();
    expect(fd.get("pto_negative_alert_admin_emails")).toBeNull();
  });

  it("submits the negative-admin list as an INDEPENDENT single-key patch", async () => {
    renderCard();
    addTo(/negative pto balance alerts/i, "new-neg@x.com");

    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const fd = actionMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("pto_negative_alert_admin_emails")).toBe("new-neg@x.com");
    expect(fd.get("pto_adjustment_alert_emails")).toBeNull();
    expect(fd.get("void_clone_alert_emails")).toBeNull();
    expect(fd.get("completed_alert_emails")).toBeNull();
  });

  it("keeps the two legacy lists traveling together on an add", async () => {
    renderCard();
    addTo(/void & clone alerts/i, "extra@x.com");

    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const fd = actionMock.mock.calls[0]?.[1] as FormData;
    // Both legacy fields present; the new address joins void_clone.
    expect(fd.get("void_clone_alert_emails")).toBe("void@x.com, extra@x.com");
    expect(fd.get("completed_alert_emails")).toBe("done@x.com");
    // No PTO field on a legacy-list save.
    expect(fd.get("pto_adjustment_alert_emails")).toBeNull();
    expect(fd.get("pto_negative_alert_admin_emails")).toBeNull();
  });

  it("removes a PTO recipient via an independent single-key patch", async () => {
    renderCard({ ptoAdjustmentEmails: ["adj@x.com", "keep@x.com"] });
    fireEvent.click(screen.getByRole("button", { name: /remove adj@x\.com/i }));

    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const fd = actionMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("pto_adjustment_alert_emails")).toBe("keep@x.com");
    expect(fd.get("void_clone_alert_emails")).toBeNull();
  });
});
