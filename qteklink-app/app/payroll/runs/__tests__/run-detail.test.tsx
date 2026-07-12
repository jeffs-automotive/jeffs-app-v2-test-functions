/**
 * Run-detail component tests — keyed on the accessible names the design spec
 * defines (spec §Verification): the three RunStatusBadge states, the AutoValue
 * provenance treatment (from-Tekmetric vs overridden), the entry grid's
 * caller-composed aria-labels + changed-keys-only patch dispatch, the
 * void-and-clone dialog's required-reason gating, and the entry grid's #43
 * route-leave guard wiring. Actions are mocked at the module boundary — these
 * are wiring tests, not business-math tests (the DAL owns the math; calc has
 * its own golden suite). The mark-complete dialog's suite lives in
 * [period]/__tests__/CompleteRunButton.test.tsx; the SummaryView + round-9 #46
 * totals-card suite lives in [period]/__tests__/SummaryView.test.tsx (both
 * extracted for the ~500-line file policy).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const updateEntryMock = vi.fn();
const updateEntriesMock = vi.fn();
const updateRunMock = vi.fn();
const completeMock = vi.fn();
const voidMock = vi.fn();
vi.mock("@/actions/payroll", () => ({
  updatePayrollEntryAction: (...args: unknown[]) => updateEntryMock(...args),
  updatePayrollEntriesAction: (...args: unknown[]) => updateEntriesMock(...args),
  updatePayrollRunAction: (...args: unknown[]) => updateRunMock(...args),
  completePayrollRunAction: (...args: unknown[]) => completeMock(...args),
  voidPayrollRunAction: (...args: unknown[]) => voidMock(...args),
  refreshPayrollTekmetricDataAction: vi.fn(),
  syncPayrollRosterAction: vi.fn(),
}));

import type { PayrollRunEntry } from "@/lib/dal/payroll";
import type {
  SheetComputation,
  SnapshotEmployee,
  WeekComputation,
} from "@/lib/payroll/types";
import { AutoValue, RunStatusBadge } from "../../payroll-ui";
import { BonusToggle } from "../[period]/BonusToggle";
import { EntryGrid } from "../[period]/EntryGrid";
import { VoidCloneButton } from "../[period]/VoidCloneButton";
import { getUnsavedEntryCount, setUnsavedEntryCount } from "../[period]/unsaved-entries";

beforeEach(() => {
  vi.clearAllMocks();
  setUnsavedEntryCount(0); // the #43 registry is module-scoped — reset between tests
});

// ── Fixtures ───────────────────────────────────────────────────────────────────

const week = (over: Partial<WeekComputation> = {}): WeekComputation => ({
  reg_hours: 40,
  ot_hours: 2,
  base_pay_cents: 104_520,
  ot_pay_cents: 7_839,
  billed_hours: 35,
  efficiency_hours: null,
  billed_pay_cents: 35_000,
  efficiency_pay_cents: null,
  leave_pay_cents: 0,
  total_pay_cents: 147_359,
  ...over,
});

const sheet = (over: Partial<SheetComputation> = {}): SheetComputation => ({
  family: "technician",
  week1: week(),
  week2: week({ ot_hours: 0, ot_pay_cents: 0 }),
  reg_hours: 80,
  ot_hours: 2,
  total_hours: 82,
  pto_hours: 0,
  holiday_hours: 0,
  bereavement_hours: 0,
  training_hours: 0,
  reg_total_cents: 216_879,
  billed_hours_total: 70,
  bonus_cents: null,
  shop_hour_goal: null,
  shop_hour_goal_source: null,
  spiff_cents: null,
  manual_incentive_cents: null,
  incentive_cents: 70_000,
  pto_pay_cents: 0,
  training_pay_cents: 0,
  holiday_pay_cents: 0,
  bereavement_pay_cents: 0,
  leave_rate_cents_per_hour: 2613,
  leave_rate_source: "history",
  total_pay_cents: 294_718,
  metrics: {
    pay_per_clock_hour_cents: 3594,
    cost_per_billed_hour_cents: 4210,
    productivity: 0.85,
  },
  ...over,
});

const EMP_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

const entry: PayrollRunEntry = {
  id: ENTRY_ID,
  runId: RUN_ID,
  employeeId: EMP_ID,
  displayName: "Cantrell",
  roleSnapshot: "technician",
  family: "technician",
  tekmetricEmployeeId: 42,
  tekmetricIdType: "technician",
  payConfig: {},
  entries: {
    clock_hours_w1: 42,
    clock_hours_w2: 40,
    pto_w1: null,
    pto_w2: null,
    holiday_w1: null,
    holiday_w2: null,
    bereavement_w1: null,
    bereavement_w2: null,
    training_w1: null,
    training_w2: null,
    manual_incentive_cents: null,
  },
  overrides: {},
  updatedAt: "2026-07-10T00:00:00Z",
};

// A second roster row (support family) for the cross-row batch tests.
const EMP2_ID = "44444444-4444-4444-8444-444444444444";
const ENTRY2_ID = "55555555-5555-4555-8555-555555555555";
const entry2: PayrollRunEntry = {
  ...entry,
  id: ENTRY2_ID,
  employeeId: EMP2_ID,
  displayName: "Daniele",
  roleSnapshot: "shop_support",
  family: "support",
  tekmetricEmployeeId: null,
  tekmetricIdType: null,
};

const snapshotEmployee: SnapshotEmployee = {
  employee_id: EMP_ID,
  display_name: "Cantrell",
  role: "technician",
  family: "technician",
  pay_config: {},
  entries: entry.entries,
  overrides: {},
  derived: {
    billed_hours_w1: 35,
    billed_hours_w2: 35,
    month_sales_cents: null,
    month_gp_with_fees_cents: null,
    month_gp_without_fees_cents: null,
    spiff_count: null,
    shop_hours: null,
    sales_goal_cents: null,
    leave_rate_cents_per_hour: 2613,
    leave_rate_source: "history",
  },
  sheet: sheet(),
} as SnapshotEmployee;

// ── RunStatusBadge ─────────────────────────────────────────────────────────────

describe("RunStatusBadge", () => {
  it("renders the three states with a text label (never color alone)", () => {
    const { rerender } = render(<RunStatusBadge status="open" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    rerender(<RunStatusBadge status="completed" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    rerender(<RunStatusBadge status="voided" />);
    expect(screen.getByText("Voided")).toBeInTheDocument();
  });
});

// ── AutoValue provenance ───────────────────────────────────────────────────────

describe("AutoValue", () => {
  it("carries the from-Tekmetric provenance in the accessible text", () => {
    render(<AutoValue source="From Tekmetric — labor lines">42.5</AutoValue>);
    expect(screen.getByText("42.5")).toBeInTheDocument();
    expect(screen.getByText(/from Tekmetric/i)).toBeInTheDocument();
    expect(screen.getByTitle("From Tekmetric — labor lines")).toBeInTheDocument();
  });

  it("shows the overridden badge with the note when overridden", () => {
    render(
      <AutoValue source="From Tekmetric" overridden overrideNote="Tekmetric missed a ticket">
        50.0
      </AutoValue>,
    );
    expect(screen.getByText("overridden")).toBeInTheDocument();
    expect(screen.getByTitle(/Tekmetric missed a ticket/)).toBeInTheDocument();
  });
});

// ── EntryGrid wiring (round-8 #43: ONE Save, atomic batch) ─────────────────────

describe("EntryGrid", () => {
  function renderGrid(over: Partial<Parameters<typeof EntryGrid>[0]> = {}) {
    return render(
      <EntryGrid
        runId={RUN_ID}
        entries={[entry, entry2]}
        computed={{ [EMP_ID]: snapshotEmployee }}
        canEdit
        {...over}
      />,
    );
  }

  it("renders caller-composed aria-labels for every entry cell", () => {
    renderGrid();
    expect(screen.getByLabelText(/Cantrell week 1 clock hours/i)).toHaveValue("42");
    expect(screen.getByLabelText(/Cantrell week 2 pto hours/i)).toBeInTheDocument();
  });

  it("tracks dirty cells across rows: Save counts them, the indicator + registry follow", () => {
    renderGrid();
    // Pristine: disabled plain Save, no unsaved count.
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(screen.getByTestId("unsaved-indicator")).toHaveTextContent(/no unsaved changes/i);

    fireEvent.change(screen.getByLabelText(/Cantrell week 1 pto hours/i), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/Daniele week 2 clock hours/i), { target: { value: "38" } });

    expect(screen.getByRole("button", { name: /save 2 changes/i })).toBeEnabled();
    expect(screen.getByTestId("unsaved-indicator")).toHaveTextContent("2 unsaved changes");
    expect(getUnsavedEntryCount()).toBe(2); // the RunViewTabs leave guard reads this
    expect(screen.getByLabelText(/Cantrell week 1 pto hours/i)).toHaveAttribute("data-dirty");

    // Editing a cell BACK to the server value un-dirties it.
    fireEvent.change(screen.getByLabelText(/Cantrell week 1 pto hours/i), { target: { value: "" } });
    expect(screen.getByRole("button", { name: /save 1 change$/i })).toBeEnabled();
    expect(getUnsavedEntryCount()).toBe(1);
  });

  it("guards in-app route-leaves while dirty: internal link clicks confirm, cancel stays", () => {
    // The route-leave guard (soft navs fire no beforeunload and skip the tab
    // pills' confirm) — wiring test; the hook's full matrix lives in
    // use-unsaved-nav-guard.test.tsx.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const swallow = (e: Event) => e.preventDefault(); // jsdom can't navigate
    document.addEventListener("click", swallow);
    try {
      render(
        <div>
          <a href="/payroll">Back to payroll</a>
          <EntryGrid runId={RUN_ID} entries={[entry, entry2]} computed={{ [EMP_ID]: snapshotEmployee }} canEdit />
        </div>,
      );
      const back = screen.getByText("Back to payroll");

      // Pristine: the guard is INACTIVE — no prompt.
      fireEvent.click(back);
      expect(confirmSpy).not.toHaveBeenCalled();

      // Dirty: the click prompts with the LEAVE copy; cancel blocks the nav
      // and every typed value survives.
      fireEvent.change(screen.getByLabelText(/Cantrell week 1 pto hours/i), { target: { value: "8" } });
      expect(fireEvent.click(back)).toBe(false); // default prevented = nav blocked
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(String(confirmSpy.mock.calls[0]?.[0])).toMatch(/will be LOST if you leave/);
      expect(screen.getByLabelText(/Cantrell week 1 pto hours/i)).toHaveValue("8");

      // Edited BACK to the server value: pristine again — the guard detaches.
      fireEvent.change(screen.getByLabelText(/Cantrell week 1 pto hours/i), { target: { value: "" } });
      fireEvent.click(back);
      expect(confirmSpy).toHaveBeenCalledTimes(1); // no new prompt
    } finally {
      document.removeEventListener("click", swallow);
      confirmSpy.mockRestore();
    }
  });

  it("dispatches ONE batch action carrying only the changed keys per row, then refreshes", async () => {
    updateEntriesMock.mockResolvedValue({ ok: true, data: { updated: 2 }, timestamp: 1 });
    renderGrid();

    fireEvent.change(screen.getByLabelText(/Cantrell week 1 pto hours/i), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/Daniele manual incentive dollars/i), {
      target: { value: "25.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save 2 changes/i }));

    await waitFor(() => expect(updateEntriesMock).toHaveBeenCalledTimes(1));
    const fd = updateEntriesMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("run_id")).toBe(RUN_ID);
    expect(JSON.parse(String(fd.get("patches")))).toEqual([
      { run_employee_id: ENTRY_ID, patch: { pto_w1: 8 } },
      { run_employee_id: ENTRY2_ID, patch: { manual_incentive_cents: 2500 } },
    ]);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // The per-row action is GONE from the save path (#43).
    expect(updateEntryMock).not.toHaveBeenCalled();
    // Dirty state cleared after the atomic commit (waitFor: the transition's
    // pending state may still hold the "Saving…" label for a beat).
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled());
    expect(getUnsavedEntryCount()).toBe(0);
  });

  it("keeps ALL dirty state and surfaces the error when the atomic batch fails", async () => {
    updateEntriesMock.mockResolvedValue({
      ok: false,
      reason: "validation",
      message: "run is completed — entries are locked",
      timestamp: 1,
    });
    renderGrid();

    fireEvent.change(screen.getByLabelText(/Cantrell week 1 pto hours/i), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/Daniele week 2 clock hours/i), { target: { value: "38" } });
    fireEvent.click(screen.getByRole("button", { name: /save 2 changes/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/entries are locked/i);
    // NOTHING was applied (atomic) — every dirty cell survives for a retry.
    expect(screen.getByLabelText(/Cantrell week 1 pto hours/i)).toHaveValue("8");
    expect(screen.getByLabelText(/Daniele week 2 clock hours/i)).toHaveValue("38");
    // waitFor: the alert can render a beat before the transition's pending
    // state releases the button back to its "Save 2 changes" label.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save 2 changes/i })).toBeEnabled(),
    );
    expect(getUnsavedEntryCount()).toBe(2);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("disables Save while the batch is in flight", async () => {
    let resolveAction: (v: unknown) => void = () => {};
    updateEntriesMock.mockImplementation(() => new Promise((r) => (resolveAction = r)));
    renderGrid();

    fireEvent.change(screen.getByLabelText(/Cantrell week 1 pto hours/i), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: /save 1 change$/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled(),
    );
    resolveAction({ ok: true, data: { updated: 1 }, timestamp: 1 });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("rejects out-of-range hours locally with an explicit error (no dispatch)", async () => {
    renderGrid();
    fireEvent.change(screen.getByLabelText(/Cantrell week 1 clock hours/i), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save 1 change$/i }));
    expect(await screen.findByText(/must be a number from 0 to 120/i)).toBeInTheDocument();
    expect(updateEntriesMock).not.toHaveBeenCalled();
  });

  it("read-only (non-admin / locked) mode renders static values — no inputs, no Save button", () => {
    renderGrid({ canEdit: false });
    expect(screen.queryByLabelText(/Cantrell week 1 clock hours/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
    expect(screen.getByText("Cantrell")).toBeInTheDocument();
  });
});

// ── Bonus month picker (round-5 #33) ───────────────────────────────────────────

describe("BonusToggle month picker", () => {
  const baseProps = {
    runId: RUN_ID,
    bonusPeriod: true,
    bonusMonth: "2026-06-01",
    periodStart: "2026-06-28",
    canEdit: true,
  };

  it("shows the auto month + the pay-date helper text when the slider is on", () => {
    render(<BonusToggle {...baseProps} />);
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByText(/Auto: the month before this run's pay date/)).toBeInTheDocument();
    expect(screen.getByLabelText("Bonus month")).toHaveValue("2026-06");
  });

  it("dispatches ONLY {run_id, bonus_month} when a different month is applied, then refreshes", async () => {
    updateRunMock.mockResolvedValue({ ok: true, data: { updated: true }, timestamp: 1 });
    render(<BonusToggle {...baseProps} />);

    const apply = screen.getByRole("button", { name: /change month/i });
    expect(apply).toBeDisabled(); // untouched = current month, nothing to apply

    fireEvent.change(screen.getByLabelText("Bonus month"), { target: { value: "2026-05" } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    await waitFor(() => expect(updateRunMock).toHaveBeenCalledTimes(1));
    const fd = updateRunMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("run_id")).toBe(RUN_ID);
    expect(fd.get("bonus_month")).toBe("2026-05-01"); // first-of-month date
    expect(fd.get("bonus_period")).toBeNull(); // the picker never touches the slider
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("hides the picker when the slider is off or the viewer can't edit", () => {
    const { rerender } = render(
      <BonusToggle {...baseProps} bonusPeriod={false} bonusMonth={null} />,
    );
    expect(screen.queryByLabelText("Bonus month")).not.toBeInTheDocument();
    rerender(<BonusToggle {...baseProps} canEdit={false} />);
    expect(screen.queryByLabelText("Bonus month")).not.toBeInTheDocument();
  });
});

// ── Void & clone dialog ────────────────────────────────────────────────────────

describe("VoidCloneButton", () => {
  it("keeps Confirm disabled until a reason is entered, then dispatches and navigates to the clone", async () => {
    voidMock.mockResolvedValue({
      ok: true,
      data: { voided: true, cloneRunId: "clone-1" },
      timestamp: 1,
    });
    render(<VoidCloneButton runId={RUN_ID} period="2026-06-28" />);

    fireEvent.click(screen.getByRole("button", { name: /void & clone this run/i }));
    const confirm = await screen.findByRole("button", { name: /^void & clone$/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/void reason/i), {
      target: { value: "Week 2 hours were wrong" },
    });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(voidMock).toHaveBeenCalledTimes(1));
    const fd = voidMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("run_id")).toBe(RUN_ID);
    expect(fd.get("reason")).toBe("Week 2 hours were wrong");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/payroll/runs/2026-06-28"));
  });
});

// ── Summary view + round-9 #46 totals card ─────────────────────────────────────
// Extracted to [period]/__tests__/SummaryView.test.tsx (print header, leave
// hours+dollars cells, the totals card + removed TOTAL row) — 500-line policy.

// ── Mark-complete dialog ───────────────────────────────────────────────────────
// Extracted to [period]/__tests__/CompleteRunButton.test.tsx (incl. the #43
// unsaved-entries completion block) to keep this file under the 500-line policy.
