/**
 * payroll-completion.ts unit tests (round-11 plan §4) — the completion PTO-entry
 * assembly + the POST-RESPONSE email fan-out that completePayrollRun fires via
 * Next 15 after().
 *
 * assembleCompletionPtoEntries: builds p_pto_entries from the FROZEN snapshot's
 *   per-employee paid PTO hours + the master profile columns + rollover ledgers,
 *   through the pure computeCompletionPtoEntries engine. Zero PTO config ⇒ empty
 *   array (C14). Reads only; never writes.
 * runCompletionEmailFanout: sequential + never-throw. Sends the completed-run
 *   alert, then the pay summaries, then the negative-balance alerts (re-reading
 *   the AUTHORITATIVE post-completion balances; unseeded employees excluded).
 *
 * The pure engine (computeCompletionPtoEntries) + the send layer
 * (renderAndSendPaySummaries / sendNegativeBalanceAlerts / sendPayrollAlert) have
 * their own suites; here the DB fetchers + the send layer are mocked so THIS suite
 * targets the orchestration (entry threading + the negative-alert gating).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/dal/payroll-shared", () => ({
  fetchEmployeesByIds: vi.fn(),
  getPayrollSettings: vi.fn(),
}));
vi.mock("@/lib/dal/payroll-pto", () => ({
  getPtoBalances: vi.fn(),
  getPtoRolloverLedger: vi.fn(),
}));
vi.mock("@/lib/dal/payroll-pto-completion", () => ({
  completionInputFrom: vi.fn(),
  computeCompletionPtoEntries: vi.fn(),
  renderAndSendPaySummaries: vi.fn(),
  sendNegativeBalanceAlerts: vi.fn(),
}));
vi.mock("@/lib/dal/payroll-confirm", () => ({ sendPayrollAlert: vi.fn() }));

import { fetchEmployeesByIds, getPayrollSettings, type PayrollEmployee, type PayrollSettings } from "@/lib/dal/payroll-shared";
import { getPtoBalances, getPtoRolloverLedger } from "@/lib/dal/payroll-pto";
import {
  completionInputFrom,
  computeCompletionPtoEntries,
  renderAndSendPaySummaries,
  sendNegativeBalanceAlerts,
} from "@/lib/dal/payroll-pto-completion";
import { sendPayrollAlert } from "@/lib/dal/payroll-confirm";
import type { RunSnapshot, SnapshotEmployee } from "@/lib/payroll/types";
import { assembleCompletionPtoEntries, runCompletionEmailFanout } from "../payroll-completion";

const SHOP_ID = 7476;
const RUN_ID = "7f0a1b2c-3d4e-4f5a-8b9c-0d1e2f3a4b5c";
const EMP_A = "11111111-2222-4333-8444-555566667777";
const EMP_B = "22222222-3333-4444-8555-666677778888";

const SETTINGS: PayrollSettings = {
  anchor_period_start: "2026-06-28",
  spiff_categories: [],
  alert_emails: { void_clone: [], completed: [] },
  pto_tenure_tiers: [{ min_years: 0, hours_per_period: 4 }],
  pto_rollover_cap_hours: null,
  pto_adjustment_alert_emails: [],
  pto_negative_alert_admin_emails: ["admin@example.com"],
};

function master(id: string, over: Partial<PayrollEmployee> = {}): PayrollEmployee {
  return {
    id,
    shopId: SHOP_ID,
    displayName: id === EMP_A ? "Clark, Matt" : "Doe, Jane",
    role: "technician",
    tekmetricEmployeeId: 501,
    tekmetricIdType: "technician",
    payConfig: {},
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    workEmail: null,
    personalEmail: id === EMP_A ? "matt@example.com" : "jane@example.com",
    personalPhone: null,
    workPhone: null,
    address: null,
    startDate: "2024-01-01",
    terminationDate: null,
    ptoGrandfathered: false,
    ptoTenureCreditDate: null,
    ...over,
  };
}

function snapEmp(id: string, ptoHours: number): SnapshotEmployee {
  return {
    employee_id: id,
    display_name: id === EMP_A ? "Clark, Matt" : "Doe, Jane",
    role: "technician",
    family: "technician",
    sheet: { pto_hours: ptoHours },
  } as unknown as SnapshotEmployee;
}

function snapshot(employees: SnapshotEmployee[]): RunSnapshot {
  return {
    run: {
      run_id: RUN_ID,
      shop_id: SHOP_ID,
      period_start: "2026-06-28",
      period_end: "2026-07-11",
      bonus_period: false,
      bonus_month: null,
    },
    employees,
  } as unknown as RunSnapshot;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPayrollSettings).mockResolvedValue({ realmId: "r1", payroll: SETTINGS });
  vi.mocked(fetchEmployeesByIds).mockResolvedValue(
    new Map([
      [EMP_A, master(EMP_A)],
      [EMP_B, master(EMP_B)],
    ]),
  );
  vi.mocked(getPtoRolloverLedger).mockResolvedValue(new Map());
  vi.mocked(getPtoBalances).mockResolvedValue(new Map());
  vi.mocked(completionInputFrom).mockImplementation(
    (se) => ({ employee: { employee_id: se.employee_id }, snapshotPtoHours: 0, rolloverLedger: [] }) as never,
  );
  vi.mocked(computeCompletionPtoEntries).mockReturnValue({ entries: [], warnings: [] });
  vi.mocked(renderAndSendPaySummaries).mockResolvedValue({ attempted: 0, sent: 0, failed: 0, skipped: 0 });
  vi.mocked(sendNegativeBalanceAlerts).mockResolvedValue({ employeeEmailsSent: 0, adminAlertSent: false });
  vi.mocked(sendPayrollAlert).mockResolvedValue(undefined);
});

describe("assembleCompletionPtoEntries", () => {
  it("empty roster ⇒ empty entries, no reads (C14 fast path)", async () => {
    const out = await assembleCompletionPtoEntries(SHOP_ID, snapshot([]));
    expect(out).toEqual({ entries: [], warnings: [] });
    expect(vi.mocked(fetchEmployeesByIds)).not.toHaveBeenCalled();
    expect(vi.mocked(getPtoRolloverLedger)).not.toHaveBeenCalled();
    expect(vi.mocked(computeCompletionPtoEntries)).not.toHaveBeenCalled();
  });

  it("threads the engine's entries out, built from master + snapshot pto_hours + rollover ledger", async () => {
    const ENTRIES = [{ employee_id: EMP_A, kind: "usage", hours: -8, boundary_year: null }];
    vi.mocked(computeCompletionPtoEntries).mockReturnValue({ entries: ENTRIES as never, warnings: [] });

    const out = await assembleCompletionPtoEntries(SHOP_ID, snapshot([snapEmp(EMP_A, 8)]));

    // one input per roster employee; the pure engine got the settings slice + run period
    expect(vi.mocked(completionInputFrom)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(computeCompletionPtoEntries)).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        anchor_period_start: "2026-06-28",
        pto_tenure_tiers: SETTINGS.pto_tenure_tiers,
        pto_rollover_cap_hours: null,
      }),
      { period_start: "2026-06-28", period_end: "2026-07-11" },
    );
    expect(out.entries).toEqual(ENTRIES);
  });

  it("skips a roster employee with no master row (defensive), still assembling the rest", async () => {
    vi.mocked(fetchEmployeesByIds).mockResolvedValue(new Map([[EMP_A, master(EMP_A)]])); // EMP_B absent
    await assembleCompletionPtoEntries(SHOP_ID, snapshot([snapEmp(EMP_A, 8), snapEmp(EMP_B, 4)]));
    expect(vi.mocked(completionInputFrom)).toHaveBeenCalledTimes(1); // only EMP_A
  });
});

describe("runCompletionEmailFanout", () => {
  it("sends the completed-run alert, then the pay summaries — sequentially", async () => {
    await runCompletionEmailFanout(SHOP_ID, snapshot([snapEmp(EMP_A, 0)]), "Payroll run completed", ["line"]);
    expect(vi.mocked(sendPayrollAlert)).toHaveBeenCalledWith(SHOP_ID, "completed", "Payroll run completed", ["line"]);
    expect(vi.mocked(renderAndSendPaySummaries)).toHaveBeenCalledWith(SHOP_ID, expect.objectContaining({ run: expect.any(Object) }));
    // ordering: alert before summaries
    const alertOrder = vi.mocked(sendPayrollAlert).mock.invocationCallOrder[0]!;
    const summaryOrder = vi.mocked(renderAndSendPaySummaries).mock.invocationCallOrder[0]!;
    expect(alertOrder).toBeLessThan(summaryOrder);
  });

  it("sends a negative-balance alert ONLY for map-present, negative employees (unseeded excluded — no spam, plan §3)", async () => {
    // EMP_A negative (−4), EMP_B unseeded (absent from the balance map ⇒ excluded).
    vi.mocked(getPtoBalances).mockResolvedValue(new Map([[EMP_A, -4]]));

    await runCompletionEmailFanout(SHOP_ID, snapshot([snapEmp(EMP_A, 0), snapEmp(EMP_B, 0)]), "s", ["l"]);

    expect(vi.mocked(sendNegativeBalanceAlerts)).toHaveBeenCalledTimes(1);
    const [shop, runId, period, negatives, admins] = vi.mocked(sendNegativeBalanceAlerts).mock.calls[0]!;
    expect(shop).toBe(SHOP_ID);
    expect(runId).toBe(RUN_ID);
    expect(period).toEqual({ periodStart: "2026-06-28", periodEnd: "2026-07-11" });
    expect(negatives).toEqual([
      { employeeId: EMP_A, displayName: "Clark, Matt", personalEmail: "matt@example.com", balanceHours: -4 },
    ]);
    expect(admins).toEqual(["admin@example.com"]);
  });

  it("no negative alert when every balance is >= 0 (N11 — empty list never reaches the sender)", async () => {
    vi.mocked(getPtoBalances).mockResolvedValue(new Map([[EMP_A, 40]]));
    await runCompletionEmailFanout(SHOP_ID, snapshot([snapEmp(EMP_A, 0)]), "s", ["l"]);
    expect(vi.mocked(sendNegativeBalanceAlerts)).not.toHaveBeenCalled();
  });

  it("NEVER throws even when a pay-summary send explodes — the completion already committed", async () => {
    vi.mocked(renderAndSendPaySummaries).mockRejectedValue(new Error("resend boom"));
    await expect(
      runCompletionEmailFanout(SHOP_ID, snapshot([snapEmp(EMP_A, 0)]), "s", ["l"]),
    ).resolves.toBeUndefined();
    // the negative-balance step still ran despite the pay-summary failure
    expect(vi.mocked(getPtoBalances)).toHaveBeenCalled();
  });

  it("a negative-alert read failure is swallowed (never throws into the after() caller)", async () => {
    vi.mocked(getPtoBalances).mockRejectedValue(new Error("balance read boom"));
    await expect(
      runCompletionEmailFanout(SHOP_ID, snapshot([snapEmp(EMP_A, 0)]), "s", ["l"]),
    ).resolves.toBeUndefined();
  });
});
