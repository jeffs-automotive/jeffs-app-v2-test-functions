/**
 * Payroll PTO DAL tests (plan §7). The admin client is module-mocked at the
 * boundary exactly like payroll-compute.test.ts — a chainable `from()` builder
 * resolving to adminQueryMock(table), plus an `rpc()` resolving to rpcMock(fn,
 * args). The pure pto.ts engine + pay-summary-email.ts renderer run REAL, so the
 * assertions exercise the real accrual/usage math + the §5 binding safety.
 * Covers: ledger reads (balance / 0-unseeded), projection wiring, adjust
 * (non-zero + reason) / seed, profile patch semantics + archive/unarchive,
 * completion entries (archived-usage-no-accrual, zero-config empty), and the §5
 * send safety (mismatch refusal, one-log-per-employee, sequential, N11 skip).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";

const { adminQueryMock, rpcMock } = vi.hoisted(() => ({
  adminQueryMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "eq", "neq", "in", "not", "order", "range", "limit", "lte", "gte"]) {
        builder[m] = vi.fn(() => builder);
      }
      builder.then = (
        onFulfilled: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve(adminQueryMock(table)).then(onFulfilled, onRejected);
      return builder;
    },
    rpc: (fn: string, args: unknown) => Promise.resolve(rpcMock(fn, args)),
  })),
}));

// sendQteklinkEmail is module-mocked so we can assert the transport payload + order.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@/lib/dal/notify", () => ({ sendQteklinkEmail: sendMock }));

import { QboClientError } from "@/lib/qbo/errors";
import type { PayrollEmployee } from "@/lib/dal/payroll-shared";
import type { RunSnapshot, SnapshotEmployee } from "@/lib/payroll/types";
import {
  getPtoBalance,
  getPtoBalances,
  getPtoLedger,
  projectRunPto,
  ptoFieldsFromEmployee,
  adjustPto,
  seedInitialBalance,
  updateEmployeeProfile,
  archiveEmployee,
  unarchiveEmployee,
  type PtoProjectionInput,
} from "@/lib/dal/payroll-pto";
import {
  computeCompletionPtoEntries,
  detectMissingPersonalEmails,
  renderAndSendPaySummaries,
  resendFailedPaySummaries,
  sendNegativeBalanceAlerts,
  type CompletionPtoInput,
} from "@/lib/dal/payroll-pto-completion";
import type { PtoEmployeeFields, PtoSettingsSlice } from "@/lib/payroll/pto";

const SHOP_ID = 7476;
const ACTOR = { userId: "11111111-1111-1111-1111-111111111111", label: "Chris" };
const EMP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  vi.clearAllMocks();
  adminQueryMock.mockResolvedValue({ data: [], error: null });
  rpcMock.mockResolvedValue({ data: null, error: null });
  sendMock.mockResolvedValue(true);
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TIERS: PtoSettingsSlice = {
  anchor_period_start: "2026-06-28",
  pto_tenure_tiers: [
    { min_years: 0, hours_per_period: 4 },
    { min_years: 5, hours_per_period: 6 },
  ],
  pto_rollover_cap_hours: null,
};

function empFields(over: Partial<PtoEmployeeFields> = {}): PtoEmployeeFields {
  return {
    employee_id: EMP_A,
    display_name: "Matt Clark",
    archived: false,
    start_date: "2020-01-01", // long-tenured ⇒ eligible + tier match
    termination_date: null,
    pto_grandfathered: false,
    pto_tenure_credit_date: null,
    ...over,
  };
}

// A minimal-but-valid SheetComputation for the summary renderer.
function makeSheet(over: Partial<SnapshotEmployee["sheet"]> = {}): SnapshotEmployee["sheet"] {
  const week = {
    base_pay_cents: 100_000,
    ot_pay_cents: 0,
    billed_pay_cents: null,
    total_pay_cents: 100_000,
  };
  return {
    family: "support",
    week1: { ...week },
    week2: { ...week },
    reg_hours: 80,
    ot_hours: 0,
    total_hours: 80,
    pto_hours: 0,
    holiday_hours: 0,
    bereavement_hours: 0,
    training_hours: 0,
    reg_total_cents: 200_000,
    billed_hours_total: null,
    bonus_cents: null,
    shop_hour_goal: null,
    shop_hour_goal_source: null,
    spiff_cents: null,
    manual_incentive_cents: null,
    incentive_cents: 0,
    pto_pay_cents: null,
    training_pay_cents: null,
    holiday_pay_cents: null,
    bereavement_pay_cents: null,
    leave_rate_cents_per_hour: null,
    leave_rate_source: null,
    total_pay_cents: 200_000,
    metrics: { pay_per_clock_hour_cents: null, cost_per_billed_hour_cents: null, productivity: null },
    ...over,
  } as SnapshotEmployee["sheet"];
}

function snapEmp(id: string, name: string, over: Partial<SnapshotEmployee["sheet"]> = {}): SnapshotEmployee {
  return {
    employee_id: id,
    display_name: name,
    role: "shop_support",
    family: "support",
    pay_config: {},
    entries: {} as never,
    overrides: {},
    derived: {} as never,
    sheet: makeSheet(over),
  } as SnapshotEmployee;
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
  } as RunSnapshot;
}

// ── Ledger reads ─────────────────────────────────────────────────────────────

describe("getPtoBalance — last balance_after_hours, 0 when unseeded", () => {
  it("returns the most recent row's balance", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: [{ balance_after_hours: "37.50" }], error: null });
    expect(await getPtoBalance(SHOP_ID, EMP_A)).toBe(37.5);
  });

  it("returns 0 when the employee has no ledger rows", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: [], error: null });
    expect(await getPtoBalance(SHOP_ID, EMP_A)).toBe(0);
  });

  it("throws (never silent) when the read errors", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(getPtoBalance(SHOP_ID, EMP_A)).rejects.toThrow(/balance fetch failed/);
  });
});

describe("getPtoBalances — newest per employee wins (created_at asc reduce)", () => {
  it("keeps the last row per employee and omits unseeded ones", async () => {
    adminQueryMock.mockResolvedValueOnce({
      data: [
        { employee_id: EMP_A, balance_after_hours: "4.00" },
        { employee_id: EMP_A, balance_after_hours: "8.00" }, // later ⇒ wins
        { employee_id: EMP_B, balance_after_hours: "2.00" },
      ],
      error: null,
    });
    const map = await getPtoBalances(SHOP_ID, [EMP_A, EMP_B]);
    expect(map.get(EMP_A)).toBe(8);
    expect(map.get(EMP_B)).toBe(2);
    expect(map.has("zzzz")).toBe(false);
  });

  it("short-circuits (no query) on an empty id list", async () => {
    const map = await getPtoBalances(SHOP_ID, []);
    expect(map.size).toBe(0);
    expect(adminQueryMock).not.toHaveBeenCalled();
  });
});

describe("getPtoLedger — newest first, kinds validated", () => {
  it("maps rows and rejects an unknown kind", async () => {
    adminQueryMock.mockResolvedValueOnce({
      data: [
        {
          id: "l1", shop_id: SHOP_ID, employee_id: EMP_A, run_id: RUN_ID, kind: "accrual",
          hours: "4.00", balance_after_hours: "12.00", reason: null, reverses_ledger_id: null,
          boundary_year: null, created_at: "2026-07-11T00:00:00Z", created_by_label: "Chris",
        },
      ],
      error: null,
    });
    const rows = await getPtoLedger(SHOP_ID, EMP_A);
    expect(rows[0]?.kind).toBe("accrual");
    expect(rows[0]?.hours).toBe(4);
    expect(rows[0]?.balanceAfterHours).toBe(12);

    adminQueryMock.mockResolvedValueOnce({
      data: [{ id: "x", shop_id: SHOP_ID, employee_id: EMP_A, run_id: null, kind: "bogus",
        hours: "1", balance_after_hours: "1", reason: null, reverses_ledger_id: null,
        boundary_year: null, created_at: "2026-07-11T00:00:00Z", created_by_label: "Chris" }],
      error: null,
    });
    await expect(getPtoLedger(SHOP_ID, EMP_A)).rejects.toThrow(/unexpected ledger kind/);
  });
});

// ── Projection math wiring ───────────────────────────────────────────────────

describe("projectRunPto — current + accrual − usage through the real engine", () => {
  it("long-tenured employee accrues the tier rate and decrements usage", () => {
    const inputs: PtoProjectionInput[] = [
      {
        employee: empFields(), // start 2020, 5+ yrs ⇒ 6 hrs/period tier
        displayName: "Matt Clark",
        snapshotPtoHours: 3,
        currentBalanceHours: 10,
        rolloverLedger: [],
      },
    ];
    const { projections, warnings } = projectRunPto(inputs, TIERS, {
      period_start: "2026-06-28",
      period_end: "2026-07-11",
    });
    const p = projections[0]!;
    expect(p.accrualHours).toBe(6);
    expect(p.usageHours).toBe(3);
    // 10 + 6 − 3 = 13
    expect(p.projectedBalanceHours).toBe(13);
    expect(warnings).toHaveLength(0);
  });

  it("archived employee: NO accrual but usage still decrements (C37)", () => {
    const inputs: PtoProjectionInput[] = [
      {
        employee: empFields({ archived: true }),
        displayName: "Matt Clark",
        snapshotPtoHours: 8,
        currentBalanceHours: 20,
        rolloverLedger: [],
      },
    ];
    const { projections } = projectRunPto(inputs, TIERS, {
      period_start: "2026-06-28",
      period_end: "2026-07-11",
    });
    const p = projections[0]!;
    expect(p.accrualHours).toBe(0);
    expect(p.usageHours).toBe(8);
    expect(p.projectedBalanceHours).toBe(12); // 20 − 8
  });

  it("surfaces the grandfathered-no-dates warning (never throws)", () => {
    const inputs: PtoProjectionInput[] = [
      {
        employee: empFields({ start_date: null, pto_grandfathered: true, pto_tenure_credit_date: null }),
        displayName: "Ghost",
        snapshotPtoHours: 0,
        currentBalanceHours: 0,
        rolloverLedger: [],
      },
    ];
    const { warnings } = projectRunPto(inputs, TIERS, {
      period_start: "2026-06-28",
      period_end: "2026-07-11",
    });
    expect(warnings[0]?.code).toBe("grandfathered_no_dates");
  });
});

describe("ptoFieldsFromEmployee — read-surface → engine shape", () => {
  it("maps archivedAt→archived and the profile date columns", () => {
    const f = ptoFieldsFromEmployee({
      id: EMP_A, displayName: "Matt", archivedAt: "2026-01-01T00:00:00Z",
      startDate: "2020-01-01", terminationDate: "2026-01-01", ptoGrandfathered: true,
      ptoTenureCreditDate: "2018-01-01",
    } as PayrollEmployee);
    expect(f).toMatchObject({
      archived: true, start_date: "2020-01-01", termination_date: "2026-01-01",
      pto_grandfathered: true, pto_tenure_credit_date: "2018-01-01",
    });
  });
});

// ── adjust / seed writes ─────────────────────────────────────────────────────

describe("adjustPto — non-zero + REQUIRED reason", () => {
  it("rejects a blank reason before any RPC", async () => {
    await expect(adjustPto(SHOP_ID, EMP_A, 4, "   ", ACTOR)).rejects.toBeInstanceOf(QboClientError);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a zero amount before any RPC", async () => {
    await expect(adjustPto(SHOP_ID, EMP_A, 0, "fix", ACTOR)).rejects.toBeInstanceOf(QboClientError);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls the RPC with kind=adjustment + trimmed reason and returns the balance", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ledger_id: "led1", balance_after_hours: "14.00" }, error: null });
    const res = await adjustPto(SHOP_ID, EMP_A, -2, "  correction  ", ACTOR);
    expect(res.ledgerId).toBe("led1");
    expect(res.balanceAfterHours).toBe(14);
    const [fn, args] = rpcMock.mock.calls[0]!;
    expect(fn).toBe("qteklink_payroll_adjust_pto");
    expect(args).toMatchObject({ p_kind: "adjustment", p_hours: -2, p_reason: "correction", p_actor: "Chris" });
  });

  it("surfaces a P0001 RAISE as a QboClientError (validation)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "employee not found" } });
    await expect(adjustPto(SHOP_ID, EMP_A, 4, "seed", ACTOR)).rejects.toBeInstanceOf(QboClientError);
  });
});

describe("seedInitialBalance — kind=initial, reason optional", () => {
  it("passes kind=initial with a null reason when none given", async () => {
    rpcMock.mockResolvedValueOnce({ data: { ledger_id: "led2", balance_after_hours: "40" }, error: null });
    const res = await seedInitialBalance(SHOP_ID, EMP_A, 40, ACTOR);
    expect(res.balanceAfterHours).toBe(40);
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({ p_kind: "initial", p_hours: 40, p_reason: null });
  });

  it("rejects a zero seed", async () => {
    await expect(seedInitialBalance(SHOP_ID, EMP_A, 0, ACTOR)).rejects.toBeInstanceOf(QboClientError);
  });
});

// ── employee profile writes ──────────────────────────────────────────────────

describe("updateEmployeeProfile — patch semantics (absent omit, null clears)", () => {
  it("omits absent keys and keeps an explicit JSON null in the patch", async () => {
    await updateEmployeeProfile(
      SHOP_ID,
      EMP_A,
      { personal_email: "matt@example.com", work_phone: null },
      ACTOR,
    );
    const args = rpcMock.mock.calls[0]![1] as { p_patch: Record<string, unknown>; p_archived: unknown };
    expect(args.p_patch).toEqual({ personal_email: "matt@example.com", work_phone: null });
    expect("start_date" in args.p_patch).toBe(false); // absent ⇒ omitted (keep)
    expect(args.p_archived).toBeNull();
  });

  it("rejects an empty patch with no archived flag before any RPC", async () => {
    await expect(updateEmployeeProfile(SHOP_ID, EMP_A, {}, ACTOR)).rejects.toBeInstanceOf(QboClientError);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("archiveEmployee sends the termination patch + p_archived true (one call)", async () => {
    await archiveEmployee(SHOP_ID, EMP_A, "2026-07-01", ACTOR);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({
      p_patch: { termination_date: "2026-07-01" },
      p_archived: true,
    });
  });

  it("unarchiveEmployee sends p_archived false with an empty patch (RPC clears termination)", async () => {
    await unarchiveEmployee(SHOP_ID, EMP_A, ACTOR);
    expect(rpcMock.mock.calls[0]![1]).toMatchObject({ p_patch: {}, p_archived: false });
  });
});

// ── completion entries ───────────────────────────────────────────────────────

describe("computeCompletionPtoEntries", () => {
  it("archived-with-hours: usage decrements, NO accrual row (C37)", () => {
    const inputs: CompletionPtoInput[] = [
      { employee: empFields({ archived: true }), snapshotPtoHours: 8, rolloverLedger: [] },
    ];
    const { entries } = computeCompletionPtoEntries(inputs, TIERS, {
      period_start: "2026-06-28",
      period_end: "2026-07-11",
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "usage", hours: -8, boundary_year: null });
    expect(entries.some((e) => e.kind === "accrual")).toBe(false);
  });

  it("zero-PTO-config (empty tiers, no hours) ⇒ empty entries (completion behaves as today)", () => {
    const inputs: CompletionPtoInput[] = [
      { employee: empFields(), snapshotPtoHours: 0, rolloverLedger: [] },
    ];
    const unconfigured: PtoSettingsSlice = {
      anchor_period_start: "2026-06-28",
      pto_tenure_tiers: [],
      pto_rollover_cap_hours: null,
    };
    const { entries, warnings } = computeCompletionPtoEntries(inputs, unconfigured, {
      period_start: "2026-06-28",
      period_end: "2026-07-11",
    });
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("configured active employee: accrual + usage rows in write order", () => {
    const inputs: CompletionPtoInput[] = [
      { employee: empFields(), snapshotPtoHours: 3, rolloverLedger: [] },
    ];
    const { entries } = computeCompletionPtoEntries(inputs, TIERS, {
      period_start: "2026-06-28",
      period_end: "2026-07-11",
    });
    expect(entries.map((e) => e.kind)).toEqual(["accrual", "usage"]);
    expect(entries[0]).toMatchObject({ kind: "accrual", hours: 6 });
    expect(entries[1]).toMatchObject({ kind: "usage", hours: -3 });
  });
});

// ── missing-email detection (N11 skip list) ──────────────────────────────────

describe("detectMissingPersonalEmails", () => {
  it("flags null and whitespace-only personal emails only", () => {
    const missing = detectMissingPersonalEmails([
      { id: EMP_A, displayName: "Has Email", personalEmail: "a@b.com" },
      { id: EMP_B, displayName: "No Email", personalEmail: null },
      { id: "ccc", displayName: "Blank", personalEmail: "   " },
    ]);
    expect(missing.map((m) => m.employeeId)).toEqual([EMP_B, "ccc"]);
  });
});

// ── §5 pay-summary send safety ───────────────────────────────────────────────

describe("renderAndSendPaySummaries", () => {
  function logRow(over: Partial<{ id: string; employee_id: string; recipient: string; status: string }> = {}) {
    return { id: "log1", employee_id: EMP_A, recipient: "matt@example.com", status: "pending", ...over };
  }

  it("sends one isolated message per pending row and finalizes pending→sent with subject", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: [logRow()], error: null }); // fetchPaySummaryLog
    const snap = snapshot([snapEmp(EMP_A, "Matt Clark")]);

    const res = await renderAndSendPaySummaries(SHOP_ID, snap);
    expect(res).toMatchObject({ attempted: 1, sent: 1, failed: 0, skipped: 0 });

    // the send carried html + text + the name-led subject.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0]![0] as { to: string[]; subject: string; text: string; html: string };
    expect(sent.to).toEqual(["matt@example.com"]);
    expect(sent.subject).toContain("Matt Clark");
    expect(sent.text.length).toBeGreaterThan(0);
    expect(sent.html.length).toBeGreaterThan(0);

    // one transition, pending→sent, with the subject.
    const transitions = rpcMock.mock.calls.filter((c) => c[0] === "qteklink_payroll_transition_email");
    expect(transitions).toHaveLength(1);
    expect(transitions[0]![1]).toMatchObject({ p_email_id: "log1", p_to_status: "sent" });
  });

  it("a binding mismatch (recipient row employee ≠ snapshot employee) is impossible via id — but a snapshot-absent employee logs failed", async () => {
    adminQueryMock.mockResolvedValueOnce({
      data: [logRow({ id: "logX", employee_id: "no-such-employee" })],
      error: null,
    });
    const snap = snapshot([snapEmp(EMP_A, "Matt Clark")]);

    const res = await renderAndSendPaySummaries(SHOP_ID, snap);
    expect(res.failed).toBe(1);
    expect(res.sent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled(); // send REFUSED
    const transitions = rpcMock.mock.calls.filter((c) => c[0] === "qteklink_payroll_transition_email");
    expect(transitions).toHaveLength(1);
    expect(transitions[0]![1]).toMatchObject({ p_email_id: "logX", p_to_status: "failed" });
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalled();
  });

  it("EXACTLY one transition per employee (never double-finalizes)", async () => {
    adminQueryMock.mockResolvedValueOnce({
      data: [logRow({ id: "l1", employee_id: EMP_A }), logRow({ id: "l2", employee_id: EMP_B, recipient: "b@x.com" })],
      error: null,
    });
    const snap = snapshot([snapEmp(EMP_A, "Matt Clark"), snapEmp(EMP_B, "Ana Diaz")]);

    await renderAndSendPaySummaries(SHOP_ID, snap);
    const transitions = rpcMock.mock.calls.filter((c) => c[0] === "qteklink_payroll_transition_email");
    expect(transitions).toHaveLength(2);
    expect(new Set(transitions.map((t) => (t[1] as { p_email_id: string }).p_email_id))).toEqual(
      new Set(["l1", "l2"]),
    );
  });

  it("sends SEQUENTIALLY (no overlap) — the shared Resend limit rule", async () => {
    adminQueryMock.mockResolvedValueOnce({
      data: [logRow({ id: "l1", employee_id: EMP_A }), logRow({ id: "l2", employee_id: EMP_B, recipient: "b@x.com" })],
      error: null,
    });
    const snap = snapshot([snapEmp(EMP_A, "Matt Clark"), snapEmp(EMP_B, "Ana Diaz")]);

    let inFlight = 0;
    let maxConcurrent = 0;
    sendMock.mockImplementation(async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return true;
    });

    await renderAndSendPaySummaries(SHOP_ID, snap);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1); // never two sends at once
  });

  it("skipped_no_email rows are counted but NEVER sent (N11)", async () => {
    adminQueryMock.mockResolvedValueOnce({
      data: [logRow({ id: "skip1", employee_id: EMP_A, recipient: "", status: "skipped_no_email" })],
      error: null,
    });
    const snap = snapshot([snapEmp(EMP_A, "Matt Clark")]);

    const res = await renderAndSendPaySummaries(SHOP_ID, snap);
    expect(res).toMatchObject({ attempted: 0, sent: 0, failed: 0, skipped: 1 });
    expect(sendMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled(); // no transition on a skip row
  });

  it("a non-2xx send finalizes pending→failed (retryable, audited)", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: [logRow()], error: null });
    sendMock.mockResolvedValueOnce(false);
    const snap = snapshot([snapEmp(EMP_A, "Matt Clark")]);

    const res = await renderAndSendPaySummaries(SHOP_ID, snap);
    expect(res.failed).toBe(1);
    const transitions = rpcMock.mock.calls.filter((c) => c[0] === "qteklink_payroll_transition_email");
    expect(transitions[0]![1]).toMatchObject({ p_to_status: "failed" });
  });
});

// ── resend failed pay summaries (the failed→pending retry path — C27) ─────────

describe("resendFailedPaySummaries", () => {
  const RUN_COMPLETED = {
    id: RUN_ID,
    shop_id: SHOP_ID,
    status: "completed",
    period_start: "2026-06-28",
    period_end: "2026-07-11",
    snapshot: { not: "a valid snapshot" }, // only parsed when there IS something to resend
  };

  it("throws (never a silent no-op) when the run is not completed", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: [{ ...RUN_COMPLETED, status: "open" }], error: null }); // fetchRunGuarded
    await expect(resendFailedPaySummaries(SHOP_ID, RUN_ID)).rejects.toBeInstanceOf(QboClientError);
    // never reached the email-log fetch nor any transition
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("throws not_found when the run is not the caller's (shop-scoped guard)", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: [], error: null }); // fetchRunGuarded → no row
    await expect(resendFailedPaySummaries(SHOP_ID, RUN_ID)).rejects.toBeInstanceOf(QboClientError);
  });

  it("clean no-op (no snapshot parse) when nothing is in a failed state", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: [RUN_COMPLETED], error: null }); // fetchRunGuarded
    adminQueryMock.mockResolvedValueOnce({
      data: [
        { id: "s1", employee_id: EMP_A, recipient: "a@x.com", status: "sent" }, // terminal
        { id: "p1", employee_id: EMP_B, recipient: "b@x.com", status: "pending" }, // untouched
      ],
      error: null,
    }); // fetchPaySummaryLog
    const res = await resendFailedPaySummaries(SHOP_ID, RUN_ID);
    expect(res).toEqual({ attempted: 0, sent: 0, failed: 0, skipped: 0 });
    // no failed rows ⇒ zero transitions, and the (invalid) snapshot was NEVER parsed
    expect(rpcMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reclaims each failed row failed→pending BEFORE re-sending", async () => {
    adminQueryMock.mockResolvedValueOnce({ data: [RUN_COMPLETED], error: null }); // fetchRunGuarded
    adminQueryMock.mockResolvedValueOnce({
      data: [{ id: "f1", employee_id: EMP_A, recipient: "a@x.com", status: "failed" }],
      error: null,
    }); // fetchPaySummaryLog
    // The reclaim runs; the loose test snapshot then fails RunSnapshotSchema.parse
    // (proving the reclaim happened first — the parse is only reached with work to do).
    await expect(resendFailedPaySummaries(SHOP_ID, RUN_ID)).rejects.toBeTruthy();
    const reclaim = rpcMock.mock.calls.filter((c) => c[0] === "qteklink_payroll_transition_email");
    expect(reclaim).toHaveLength(1);
    expect(reclaim[0]![1]).toMatchObject({ p_email_id: "f1", p_to_status: "pending" });
  });
});

// ── negative-balance alerts ──────────────────────────────────────────────────

describe("sendNegativeBalanceAlerts", () => {
  const period = { periodStart: "2026-06-28", periodEnd: "2026-07-11" };

  it("emails each employee's personal address + one admin roll-up, logging pto_negative rows", async () => {
    const res = await sendNegativeBalanceAlerts(
      SHOP_ID,
      RUN_ID,
      period,
      [{ employeeId: EMP_A, displayName: "Matt", personalEmail: "matt@example.com", balanceHours: -4 }],
      ["admin@example.com"],
    );
    expect(res.employeeEmailsSent).toBe(1);
    expect(res.adminAlertSent).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2); // employee + admin
    const logs = rpcMock.mock.calls.filter((c) => c[0] === "qteklink_payroll_log_email");
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => (l[1] as { p_kind: string }).p_kind === "pto_negative")).toBe(true);
  });

  it("no admin list ⇒ never calls send for the admin roll-up and logs nothing extra (N11)", async () => {
    const res = await sendNegativeBalanceAlerts(
      SHOP_ID,
      RUN_ID,
      period,
      [{ employeeId: EMP_A, displayName: "Matt", personalEmail: null, balanceHours: -4 }],
      [],
    );
    // employee has no personal email → skipped; no admin list → no admin send.
    expect(res.employeeEmailsSent).toBe(0);
    expect(res.adminAlertSent).toBe(false);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("empty employee list is a no-op", async () => {
    const res = await sendNegativeBalanceAlerts(SHOP_ID, RUN_ID, period, [], ["admin@x.com"]);
    expect(res).toEqual({ employeeEmailsSent: 0, adminAlertSent: false });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
