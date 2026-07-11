/**
 * Run-detail component tests — keyed on the accessible names the design spec
 * defines (spec §Verification): the three RunStatusBadge states, the AutoValue
 * provenance treatment (from-Tekmetric vs overridden), the entry grid's
 * caller-composed aria-labels + changed-keys-only patch dispatch, the
 * void-and-clone dialog's required-reason gating, and the mark-complete
 * dialog's stale-mirror acknowledgment gating. Actions are mocked at the
 * module boundary — these are wiring tests, not business-math tests (the DAL
 * owns the math; calc has its own golden suite).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const updateEntryMock = vi.fn();
const completeMock = vi.fn();
const voidMock = vi.fn();
vi.mock("@/actions/payroll", () => ({
  updatePayrollEntryAction: (...args: unknown[]) => updateEntryMock(...args),
  updatePayrollRunAction: vi.fn(),
  completePayrollRunAction: (...args: unknown[]) => completeMock(...args),
  voidPayrollRunAction: (...args: unknown[]) => voidMock(...args),
  refreshPayrollTekmetricDataAction: vi.fn(),
  syncPayrollRosterAction: vi.fn(),
}));

import type { PayrollRunEntry } from "@/lib/dal/payroll";
import type {
  SheetComputation,
  SnapshotEmployee,
  SummaryRow,
  WeekComputation,
} from "@/lib/payroll/types";
import { AutoValue, RunStatusBadge } from "../../payroll-ui";
import { EntryGrid } from "../[period]/EntryGrid";
import { SummaryView } from "../[period]/SummaryView";
import { VoidCloneButton } from "../[period]/VoidCloneButton";
import { CompleteRunButton } from "../[period]/CompleteRunButton";

beforeEach(() => {
  vi.clearAllMocks();
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

// ── EntryGrid wiring ───────────────────────────────────────────────────────────

describe("EntryGrid", () => {
  it("renders caller-composed aria-labels for every entry cell", () => {
    render(<EntryGrid entries={[entry]} computed={{ [EMP_ID]: snapshotEmployee }} canEdit />);
    expect(screen.getByLabelText(/Cantrell week 1 clock hours/i)).toHaveValue("42");
    expect(screen.getByLabelText(/Cantrell week 2 pto hours/i)).toBeInTheDocument();
  });

  it("dispatches ONLY the changed keys as the entry patch, then refreshes", async () => {
    updateEntryMock.mockResolvedValue({ ok: true, data: { updated: true }, timestamp: 1 });
    render(<EntryGrid entries={[entry]} computed={{ [EMP_ID]: snapshotEmployee }} canEdit />);

    fireEvent.change(screen.getByLabelText(/Cantrell week 1 pto hours/i), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateEntryMock).toHaveBeenCalledTimes(1));
    const fd = updateEntryMock.mock.calls[0]?.[1] as FormData;
    expect(fd.get("run_employee_id")).toBe(ENTRY_ID);
    expect(JSON.parse(String(fd.get("patch")))).toEqual({ pto_w1: 8 });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("rejects out-of-range hours locally with an explicit error (no dispatch)", async () => {
    render(<EntryGrid entries={[entry]} computed={{ [EMP_ID]: snapshotEmployee }} canEdit />);
    fireEvent.change(screen.getByLabelText(/Cantrell week 1 clock hours/i), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/must be a number from 0 to 120/i)).toBeInTheDocument();
    expect(updateEntryMock).not.toHaveBeenCalled();
  });

  it("read-only (non-admin) mode renders static values, not inputs", () => {
    render(<EntryGrid entries={[entry]} computed={{ [EMP_ID]: snapshotEmployee }} canEdit={false} />);
    expect(screen.queryByLabelText(/Cantrell week 1 clock hours/i)).not.toBeInTheDocument();
    expect(screen.getByText("Cantrell")).toBeInTheDocument();
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

// ── Summary print header (the paper must self-describe its run status) ────────

const summaryRow: SummaryRow = {
  employee_id: EMP_ID,
  display_name: "Cantrell",
  role: "technician",
  family: "technician",
  reg_hours: 80,
  ot_hours: 2,
  reg_pay_cents: 216_879,
  ot_pay_cents: 7_839,
  billed_hours: 70,
  billed_pay_cents: 70_000,
  incentive_cents: 70_000,
  bonus_cents: null,
  spiff_cents: null,
  pto_hours: 0,
  pto_pay_cents: null,
  training_hours: 0,
  training_pay_cents: null,
  holiday_hours: 0,
  holiday_pay_cents: null,
  bereavement_hours: 0,
  bereavement_pay_cents: null,
  total_pay_cents: 294_718,
};

describe("SummaryView print header", () => {
  const base = {
    rows: [summaryRow],
    shopId: 7476,
    periodStart: "2026-06-28",
    periodEnd: "2026-07-11",
  };

  it("labels a completed run's sheet as the keyable record with its completion date", () => {
    render(<SummaryView {...base} status="completed" completedAt="2026-07-12T14:00:00Z" />);
    expect(
      screen.getByText(/Completed .*— for keying into the payroll system/),
    ).toBeInTheDocument();
  });

  it("labels a voided run's sheet as an archival copy — never as keyable", () => {
    render(<SummaryView {...base} status="voided" completedAt="2026-07-12T14:00:00Z" />);
    expect(
      screen.getByText(/VOIDED — archival copy, do not key into the payroll system/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/for keying into the payroll system/)).not.toBeInTheDocument();
  });

  it("labels an open run's sheet as a draft — never as keyable", () => {
    render(<SummaryView {...base} status="open" completedAt={null} />);
    expect(screen.getByText(/DRAFT — run not completed/)).toBeInTheDocument();
    expect(screen.queryByText(/for keying into the payroll system/)).not.toBeInTheDocument();
  });

  // Leave-pay DOLLARS beside the hours (extraction #31) — Marie keys the pay
  // figures from the printout, so the summary must carry both hours and pay.
  it("renders leave-pay dollars alongside hours for a paid-leave (technician) row", () => {
    const techLeave: SummaryRow = {
      ...summaryRow,
      pto_hours: 8,
      pto_pay_cents: 20_904, // 8h @ $26.13
      training_hours: 4,
      training_pay_cents: 8_400,
      holiday_hours: 0,
      holiday_pay_cents: 0,
      bereavement_hours: 0,
      bereavement_pay_cents: 0,
    };
    render(<SummaryView {...base} rows={[techLeave]} status="completed" completedAt="2026-07-12T14:00:00Z" />);
    // Hours line + dollar line both present for PTO / Training (each appears in
    // the row AND the totals footer — a single-row run, so exactly twice).
    expect(screen.getAllByText("8.0")).toHaveLength(2);
    expect(screen.getAllByText("$209.04")).toHaveLength(2);
    expect(screen.getAllByText("$84.00")).toHaveLength(2);
  });

  it("shows n/a for a salaried row's leave pay (null *_pay_cents) — never $0.00", () => {
    const salaried: SummaryRow = {
      ...summaryRow,
      family: "service_advisor",
      role: "service_manager",
      billed_hours: null,
      billed_pay_cents: null,
      pto_hours: 8,
      pto_pay_cents: null, // salaried: hours tracked, no separate leave pay
      training_hours: 0,
      training_pay_cents: null,
      holiday_hours: 0,
      holiday_pay_cents: null,
      bereavement_hours: 0,
      bereavement_pay_cents: null,
    };
    render(<SummaryView {...base} rows={[salaried]} status="completed" completedAt="2026-07-12T14:00:00Z" />);
    // The PTO hours still show (row + footer total); the leave-pay line is the
    // archival n/a, not a misleading $0.00.
    expect(screen.getAllByText("8.0")).toHaveLength(2);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(
      screen.getAllByTitle(/Paid as salary — no separate leave pay/).length,
    ).toBeGreaterThan(0);
  });
});

// ── Mark-complete dialog ───────────────────────────────────────────────────────

describe("CompleteRunButton", () => {
  const baseProps = {
    runId: RUN_ID,
    employeeCount: 9,
    totalPayCents: 1_234_500,
    totalHours: 720,
    dataAsOf: "2026-07-08T04:00:00Z",
    periodEnd: "2026-07-11",
  };

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
    expect(fd.get("run_id")).toBe(RUN_ID);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("needs no acknowledgment when the mirror is fresh", async () => {
    render(<CompleteRunButton {...baseProps} stale={false} />);
    fireEvent.click(screen.getByRole("button", { name: /mark payroll complete/i }));
    const confirm = await screen.findByRole("button", { name: /^mark complete$/i });
    expect(confirm).toBeEnabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
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
