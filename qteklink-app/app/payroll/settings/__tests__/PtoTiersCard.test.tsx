/**
 * PtoTiersCard — the PTO tenure-tier editor + rollover cap. Wiring + UX-guard
 * contract (design spec §3a/§3b, plan §2d/§10.1):
 *   - the 0-years row is PINNED (read-only min-years, no remove button);
 *   - Add a tier appends an editable draft row; other rows can be removed;
 *   - min-years re-sorts on BLUR, not on keystroke (rows don't jump mid-edit);
 *   - Save submits BOTH pto_tenure_tiers (JSON) and pto_rollover_cap_hours in ONE
 *     write (each an independent top-level key — C25); blank cap clears to null;
 *   - the client pre-check blocks a save missing the 0-tier / with a bad value.
 * The settings action + next/navigation are mocked at the module boundary.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PayrollSettings } from "@/lib/dal/payroll";

const actionMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("@/actions/payroll", () => ({
  updatePayrollSettingsAction: (...args: unknown[]) => actionMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import PtoTiersCard from "../PtoTiersCard";

const BASE_PAYROLL: PayrollSettings = {
  anchor_period_start: "2026-06-28",
  spiff_categories: [],
  alert_emails: { void_clone: [], completed: [] },
  pto_tenure_tiers: [
    { min_years: 0, hours_per_period: 4 },
    { min_years: 5, hours_per_period: 6 },
  ],
  pto_rollover_cap_hours: 80,
  pto_adjustment_alert_emails: [],
  pto_negative_alert_admin_emails: [],
};

/** The action success shape the card's useEffect reads (payroll snapshot). */
function okResult(payroll: PayrollSettings) {
  return { ok: true, data: { payroll }, timestamp: Date.now() };
}

beforeEach(() => {
  vi.clearAllMocks();
  actionMock.mockResolvedValue(okResult(BASE_PAYROLL));
});

describe("PtoTiersCard", () => {
  it("pins the 0-years row: read-only min-years, no remove button", () => {
    render(<PtoTiersCard tiers={BASE_PAYROLL.pto_tenure_tiers} rolloverCapHours={80} />);

    const zeroMin = screen.getByLabelText(/minimum years for the 0-year tier/i) as HTMLInputElement;
    expect(zeroMin).toHaveValue("0");
    expect(zeroMin).toHaveAttribute("readonly");
    // No remove control for the pinned starting tier; the 5-year tier has one.
    expect(screen.queryByRole("button", { name: /remove the 0-year tier/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove the 5-year tier/i })).toBeInTheDocument();
  });

  it("seeds a single 0-years row when no tiers exist yet", () => {
    render(<PtoTiersCard tiers={[]} rolloverCapHours={null} />);
    const zeroMin = screen.getByLabelText(/minimum years for the 0-year tier/i) as HTMLInputElement;
    expect(zeroMin).toHaveValue("0");
    expect(zeroMin).toHaveAttribute("readonly");
  });

  it("adds a tier row and removes a non-pinned row", () => {
    render(<PtoTiersCard tiers={[{ min_years: 0, hours_per_period: 4 }]} rolloverCapHours={null} />);
    fireEvent.click(screen.getByRole("button", { name: /add a tier/i }));
    // The new draft row is labeled for the "new" tier (empty min-years).
    expect(screen.getByLabelText(/minimum years for the new-year tier/i)).toBeInTheDocument();

    // Fill it, then remove it again.
    const newMin = screen.getByLabelText(/minimum years for the new-year tier/i);
    fireEvent.change(newMin, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /remove the 3-year tier/i }));
    expect(screen.queryByLabelText(/minimum years for the 3-year tier/i)).not.toBeInTheDocument();
  });

  it("re-sorts rows on blur, not on keystroke", () => {
    render(
      <PtoTiersCard
        tiers={[
          { min_years: 0, hours_per_period: 4 },
          { min_years: 5, hours_per_period: 6 },
        ]}
        rolloverCapHours={null}
      />,
    );
    // Add a row and give it a min-years of 2 — it should stay LAST while typing.
    fireEvent.click(screen.getByRole("button", { name: /add a tier/i }));
    const draft = screen.getByLabelText(/minimum years for the new-year tier/i);
    fireEvent.change(draft, { target: { value: "2" } });

    const beforeBlur = screen
      .getAllByLabelText(/minimum years for the .* tier/i)
      .map((el) => (el as HTMLInputElement).value);
    // While editing, the just-typed row (last) has NOT jumped between 0 and 5.
    expect(beforeBlur).toEqual(["0", "5", "2"]);

    fireEvent.blur(draft);
    const afterBlur = screen
      .getAllByLabelText(/minimum years for the .* tier/i)
      .map((el) => (el as HTMLInputElement).value);
    // On blur the ladder settles: 0, 2, 5.
    expect(afterBlur).toEqual(["0", "2", "5"]);
  });

  it("saves both the tiers JSON and the rollover cap in one write", async () => {
    render(<PtoTiersCard tiers={BASE_PAYROLL.pto_tenure_tiers} rolloverCapHours={80} />);
    fireEvent.click(screen.getByRole("button", { name: /save pto settings/i }));

    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const fd = actionMock.mock.calls[0]?.[1] as FormData;
    expect(JSON.parse(String(fd.get("pto_tenure_tiers")))).toEqual([
      { min_years: 0, hours_per_period: 4 },
      { min_years: 5, hours_per_period: 6 },
    ]);
    expect(fd.get("pto_rollover_cap_hours")).toBe("80");
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("clears the rollover cap to unlimited when the field is blanked", async () => {
    render(<PtoTiersCard tiers={BASE_PAYROLL.pto_tenure_tiers} rolloverCapHours={80} />);
    fireEvent.change(screen.getByLabelText(/rollover cap in hours/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save pto settings/i }));

    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(1));
    const fd = actionMock.mock.calls[0]?.[1] as FormData;
    // Empty string = the action's "clear to null (unlimited)" sentinel.
    expect(fd.get("pto_rollover_cap_hours")).toBe("");
  });

  it("blocks the save (no action call) when a tier's hours are missing", async () => {
    render(<PtoTiersCard tiers={[{ min_years: 0, hours_per_period: 4 }]} rolloverCapHours={null} />);
    fireEvent.change(screen.getByLabelText(/hours per period for the 0-year tier/i), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save pto settings/i }));

    expect(await screen.findByText(/hours per period must be a number/i)).toBeInTheDocument();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("blocks the save when two tiers share the same minimum years", async () => {
    render(<PtoTiersCard tiers={[{ min_years: 0, hours_per_period: 4 }]} rolloverCapHours={null} />);
    fireEvent.click(screen.getByRole("button", { name: /add a tier/i }));
    const draft = screen.getByLabelText(/minimum years for the new-year tier/i);
    // Give the draft a distinct label first (5-year), fill its hours, THEN collide
    // it onto 0 so the failing check is the duplicate-min_years pre-check.
    fireEvent.change(draft, { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/hours per period for the 5-year tier/i), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText(/minimum years for the 5-year tier/i), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save pto settings/i }));

    expect(await screen.findByText(/each threshold must be unique/i)).toBeInTheDocument();
    expect(actionMock).not.toHaveBeenCalled();
  });
});
