/**
 * StartRunButton — the admin "Start new payroll run" affordance on /payroll.
 * Pins the two functional states: anchor unset → disabled + explanation pointing
 * at /payroll/settings; anchor set → a form that submits the computed on-cadence
 * period_start to createPayrollRunAction and shows the offered period.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The real action module pulls the whole server-only DAL graph — replace it.
vi.mock("@/actions/payroll", () => ({ createPayrollRunAction: vi.fn() }));

import StartRunButton from "../StartRunButton";

describe("StartRunButton", () => {
  it("anchor unset: disabled button + explanation linking to payroll settings", () => {
    render(<StartRunButton nextPeriodStart={null} nextPeriodLabel={null} />);
    expect(screen.getByRole("button", { name: /start new payroll run/i })).toBeDisabled();
    const link = screen.getByRole("link", { name: /payroll settings/i });
    expect(link).toHaveAttribute("href", "/payroll/settings");
    expect(screen.getByText(/set the anchor period start/i)).toBeInTheDocument();
  });

  it("anchor set: enabled submit carrying the computed period_start + visible label", () => {
    render(<StartRunButton nextPeriodStart="2026-07-12" nextPeriodLabel="7/12 – 7/25" />);
    const button = screen.getByRole("button", { name: /start new payroll run/i });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "submit");
    // The next on-cadence period is client-visible…
    expect(screen.getByText("7/12 – 7/25")).toBeInTheDocument();
    // …and exactly what the action will receive.
    const hidden = document.querySelector('input[name="period_start"]');
    expect(hidden).not.toBeNull();
    expect((hidden as HTMLInputElement).value).toBe("2026-07-12");
  });
});
