/**
 * Payroll DAL unit tests — the round-3 decision #26 WRITE-THROUGH: an
 * updatePayrollEntry patch that carries pay_config ALSO merges the keys the edit
 * CHANGED (diffed against the entry's previous pay_config; the run-scoped rates_w2
 * never propagates) onto the employee master's CURRENT config via a SEPARATE
 * qteklink_payroll_upsert_employee call, so both audit trails exist and master
 * fields edited independently since the run was created are never reverted.
 * A write-through failure surfaces as "entry saved, but the copy failed" — the
 * committed entry edit is never misreported as failed.
 * Mocks the Supabase admin client (settings.test.ts idiom); the heavy compute/ingest
 * modules are mocked out — this file targets the RPC orchestration only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/dal/notify", () => ({ sendQteklinkEmail: vi.fn() }));
vi.mock("@/lib/payroll/mirror-ingest", () => ({ runMirrorIngest: vi.fn() }));
vi.mock("@/lib/dal/payroll-compute", () => ({ buildOpenRunSnapshot: vi.fn() }));
// Round-11 (plan §4): the completion PTO-entry assembly + the post-response email
// fan-out live in payroll-completion.ts (their own tests cover the internals) —
// mocked at the boundary so THIS suite targets completePayrollRun's RPC
// orchestration: that the confirm call carries the assembled p_pto_entries, the
// DRY-RUN call carries NONE, and the fan-out fires via after().
vi.mock("@/lib/dal/payroll-completion", () => ({
  assembleCompletionPtoEntries: vi.fn(),
  runCompletionEmailFanout: vi.fn(),
}));
// Next 15 after(): run the post-response callback synchronously so the test can
// assert the fan-out fired (the real runtime defers it past the response).
vi.mock("next/server", () => ({
  after: (cb: () => unknown | Promise<unknown>) => {
    void Promise.resolve().then(cb);
  },
}));
// The round-7 #40/#41 live-snapshot substrate — mocked wholesale: THIS file targets
// the RPC orchestration in payroll.ts (the substrate has its own payroll-live.test.ts).
vi.mock("@/lib/dal/payroll-live", () => ({
  computePayrollRun: vi.fn(),
  getOrComputeLiveSnapshot: vi.fn(),
  markPayrollOpenRunsStale: vi.fn(),
  recomputeAndStoreLiveSnapshot: vi.fn(),
  refreshLiveSnapshotAfterMutation: vi.fn(),
}));
vi.mock("@/lib/payroll/derive", () => ({ discoverNewCategories: vi.fn(), monthDateRange: vi.fn() }));

import * as Sentry from "@sentry/nextjs";
import { buildOpenRunSnapshot } from "@/lib/dal/payroll-compute";
import { refreshLiveSnapshotAfterMutation } from "@/lib/dal/payroll-live";
import {
  assembleCompletionPtoEntries,
  runCompletionEmailFanout,
} from "@/lib/dal/payroll-completion";
import { completePayrollRun, updatePayrollEntry, updatePayrollRun } from "../payroll";

const ACTOR = { userId: "00000000-0000-4000-8000-0000000000aa", label: "chris@jeffsautomotive.com" };
const ENTRY_ID = "00000000-0000-4000-8000-00000000e001";
const EMP_ID = "00000000-0000-4000-8000-00000000a001";
const RUN_ID_FOR_ENTRY = "00000000-0000-4000-8000-00000000f009";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit", "range"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}

const employeeRow = {
  id: EMP_ID,
  shop_id: 7476,
  display_name: "Cantrell, Jeff",
  role: "technician",
  tekmetric_employee_id: 501,
  tekmetric_id_type: "technician",
  pay_config: {
    config_version: 1,
    pto_balance_hours: 0,
    pto_accrual_hours_per_period: 0,
    hourly_rate_cents: 2300,
    billed_rate_cents: 1000,
  },
  archived_at: null,
  created_at: "2026-07-10T00:00:00Z",
  updated_at: "2026-07-10T00:00:00Z",
};

function routeTables(
  over: {
    role?: string;
    role_snapshot?: string;
    archived_at?: string | null;
    /** The entry row's PREVIOUS pay_config (the diff baseline). Defaults to the run-creation clone. */
    entryPayConfig?: Record<string, unknown>;
    /** The employee master's CURRENT pay_config (the merge target). */
    masterPayConfig?: Record<string, unknown>;
    /** Simulate the employee fetch failing (a SYSTEM error inside the write-through). */
    employeesError?: { message: string };
  } = {},
) {
  fromMock.mockImplementation((table: string) => {
    if (table === "qteklink_payroll_run_employees") {
      return chain({
        data: [
          {
            id: ENTRY_ID,
            run_id: RUN_ID_FOR_ENTRY,
            shop_id: 7476,
            employee_id: EMP_ID,
            role_snapshot: over.role_snapshot ?? "technician",
            pay_config: over.entryPayConfig ?? employeeRow.pay_config,
          },
        ],
        error: null,
      });
    }
    if (table === "qteklink_payroll_employees") {
      if (over.employeesError) return chain({ data: null, error: over.employeesError });
      return chain({
        data: [
          {
            ...employeeRow,
            role: over.role ?? "technician",
            archived_at: over.archived_at ?? null,
            pay_config: over.masterPayConfig ?? employeeRow.pay_config,
          },
        ],
        error: null,
      });
    }
    throw new Error(`unexpected table ${table}`);
  });
}

function routeRpc(overrides: Record<string, { data: unknown; error: unknown }> = {}) {
  rpcMock.mockImplementation((fn: string) => {
    if (fn in overrides) return Promise.resolve(overrides[fn]);
    if (fn === "qteklink_payroll_upsert_employee") return Promise.resolve({ data: EMP_ID, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

/** A full run-level technician pay_config incl. the run-scoped rates_w2. */
const runConfig = {
  config_version: 1,
  pto_balance_hours: 12,
  pto_accrual_hours_per_period: 1.85,
  hourly_rate_cents: 2500,
  billed_rate_cents: 1100,
  rates_w2: { hourly_rate_cents: 2600 },
};

beforeEach(() => {
  vi.clearAllMocks();
  routeTables();
  routeRpc();
});

describe("updatePayrollEntry pay_config write-through (round-3 #26)", () => {
  it("mirrors the pay_config to the employee master WITHOUT rates_w2, via a separate upsert call", async () => {
    await updatePayrollEntry(7476, ENTRY_ID, { pay_config: runConfig }, ACTOR);

    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_update_entry",
      expect.objectContaining({ p_run_employee_id: ENTRY_ID, p_actor_label: ACTOR.label }),
    );
    expect(rpcMock).toHaveBeenCalledWith("qteklink_payroll_upsert_employee", {
      p_shop_id: 7476,
      p_employee_id: EMP_ID,
      p_display_name: "Cantrell, Jeff",
      p_role: "technician",
      p_tekmetric_employee_id: 501,
      p_pay_config: {
        config_version: 1,
        pto_balance_hours: 12,
        pto_accrual_hours_per_period: 1.85,
        hourly_rate_cents: 2500,
        billed_rate_cents: 1100,
        // NO rates_w2 — run-scoped only, never written through.
      },
      p_archived: false,
      p_actor_user_id: ACTOR.userId,
      p_actor_label: ACTOR.label,
    });
    // The entry patch itself still carries rates_w2 (mid-period change stays run-level).
    const entryCall = rpcMock.mock.calls.find(([fn]) => fn === "qteklink_payroll_update_entry");
    expect(entryCall?.[1]?.p_patch?.pay_config?.rates_w2).toEqual({ hourly_rate_cents: 2600 });
  });

  it("merges ONLY the keys the edit changed — a master field updated since the run was created survives", async () => {
    // (a) run created: pay_config cloned at hourly 2300; (b) master hourly raised to
    // 2800 via upsertPayrollEmployee; (c) the run entry is patched for an UNRELATED
    // field (billed rate) from the run's stale clone. The stale hourly 2300 must NOT
    // revert the master's 2800 (the lost-update scenario).
    routeTables({ masterPayConfig: { ...employeeRow.pay_config, hourly_rate_cents: 2800 } });
    await updatePayrollEntry(
      7476,
      ENTRY_ID,
      { pay_config: { ...employeeRow.pay_config, billed_rate_cents: 1200 } },
      ACTOR,
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_upsert_employee",
      expect.objectContaining({
        p_pay_config: {
          config_version: 1,
          pto_balance_hours: 0,
          pto_accrual_hours_per_period: 0,
          hourly_rate_cents: 2800, // the independent master edit — NOT the run's stale 2300
          billed_rate_cents: 1200, // the key this edit actually changed
        },
      }),
    );
  });

  it("skips the master upsert entirely when only the run-scoped rates_w2 changed (no-op diff)", async () => {
    await updatePayrollEntry(
      7476,
      ENTRY_ID,
      { pay_config: { ...employeeRow.pay_config, rates_w2: { hourly_rate_cents: 2600 } } },
      ACTOR,
    );
    expect(rpcMock).toHaveBeenCalledWith("qteklink_payroll_update_entry", expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_payroll_upsert_employee", expect.anything());
  });

  it("surfaces a write-through failure as 'entry saved, copy failed' with the business cause", async () => {
    routeRpc({
      qteklink_payroll_upsert_employee: {
        data: null,
        error: { code: "P0001", message: "pay_config invalid for role" },
      },
    });
    await expect(updatePayrollEntry(7476, ENTRY_ID, { pay_config: runConfig }, ACTOR)).rejects.toMatchObject({
      name: "QboClientError",
      kind: "validation",
      message: expect.stringMatching(
        /entry was saved.*copying the pay config to the employee record failed.*re-save the same pay config to retry.*pay_config invalid for role/is,
      ),
    });
    // Half-applies are always visible to Chris, not just the caller.
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it("states the half-apply WITHOUT leaking internals when the write-through fails on a system error", async () => {
    routeTables({ employeesError: { message: "boom-internal-table-detail" } });
    const err = await updatePayrollEntry(7476, ENTRY_ID, { pay_config: runConfig }, ACTOR).then(
      () => {
        throw new Error("expected updatePayrollEntry to reject");
      },
      (e: unknown) => e as Error,
    );
    expect(err).toMatchObject({ name: "QboClientError", kind: "validation" });
    expect(err.message).toMatch(/entry was saved.*re-save the same pay config to retry/is);
    expect(err.message).not.toContain("boom-internal-table-detail");
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalled();
  });

  it("preserves the master's archived flag (an archived employee stays archived)", async () => {
    routeTables({ archived_at: "2026-07-01T00:00:00Z" });
    await updatePayrollEntry(7476, ENTRY_ID, { pay_config: runConfig }, ACTOR);
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_upsert_employee",
      expect.objectContaining({ p_archived: true }),
    );
  });

  it("writes through across a SAME-family role change (shop_support run → office_support master)", async () => {
    routeTables({ role: "office_support", role_snapshot: "shop_support" });
    const supportConfig = {
      config_version: 1,
      pto_balance_hours: 4,
      pto_accrual_hours_per_period: 1,
      hourly_rate_cents: 1700,
    };
    await updatePayrollEntry(7476, ENTRY_ID, { pay_config: supportConfig }, ACTOR);
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_upsert_employee",
      expect.objectContaining({ p_role: "office_support", p_pay_config: supportConfig }),
    );
  });

  it("SKIPS the write-through (Sentry warning, no upsert) when the role FAMILY diverged", async () => {
    routeTables({ role: "office_manager" }); // run row is technician-family
    await updatePayrollEntry(7476, ENTRY_ID, { pay_config: runConfig }, ACTOR);
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_payroll_upsert_employee", expect.anything());
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      expect.stringContaining("write-through skipped"),
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("never DELETES the round-4 seed keys from the master when the run edit merely omits them", async () => {
    // Run created AFTER seeding: the entry snapshot carries the seed fields. A
    // caller then submits a full-replacement pay_config rebuilt from the rate
    // fields WITHOUT round-tripping the seed keys (plus a real rate change). The
    // omission must not propagate as a delete — the master keeps its seeds.
    const seedHistory = [{ period_start: "2026-05-17", avg_hourly_pay_cents: 2885 }];
    const seededConfig = {
      ...employeeRow.pay_config,
      leave_rate_seed_history: seedHistory,
      leave_rate_seed_cents_per_hour: 3406,
    };
    routeTables({ entryPayConfig: seededConfig, masterPayConfig: seededConfig });
    await updatePayrollEntry(
      7476,
      ENTRY_ID,
      { pay_config: { ...employeeRow.pay_config, billed_rate_cents: 1200 } }, // no seed keys
      ACTOR,
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_upsert_employee",
      expect.objectContaining({
        p_pay_config: {
          ...seededConfig, // seeds survive
          billed_rate_cents: 1200, // the key this edit actually changed
        },
      }),
    );
  });

  it("skips the master upsert entirely when the only diff is the omitted seed keys", async () => {
    const seededConfig = {
      ...employeeRow.pay_config,
      leave_rate_seed_cents_per_hour: 3406,
    };
    routeTables({ entryPayConfig: seededConfig, masterPayConfig: seededConfig });
    await updatePayrollEntry(7476, ENTRY_ID, { pay_config: { ...employeeRow.pay_config } }, ACTOR);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_payroll_update_entry", expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_payroll_upsert_employee", expect.anything());
  });

  it("still writes a seed-key VALUE change through to the master", async () => {
    const seededConfig = {
      ...employeeRow.pay_config,
      leave_rate_seed_cents_per_hour: 3406,
    };
    routeTables({ entryPayConfig: seededConfig, masterPayConfig: seededConfig });
    await updatePayrollEntry(
      7476,
      ENTRY_ID,
      { pay_config: { ...seededConfig, leave_rate_seed_cents_per_hour: 3500 } },
      ACTOR,
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_upsert_employee",
      expect.objectContaining({
        p_pay_config: { ...seededConfig, leave_rate_seed_cents_per_hour: 3500 },
      }),
    );
  });

  it("does NOT touch the employee master on a patch without pay_config", async () => {
    await updatePayrollEntry(7476, ENTRY_ID, { clock_hours_w1: 41.5 }, ACTOR);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_payroll_update_entry", expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_payroll_upsert_employee", expect.anything());
  });

  it("a failed entry update NEVER writes through (fail closed)", async () => {
    routeRpc({ qteklink_payroll_update_entry: { data: null, error: { code: "P0001", message: "run is completed" } } });
    await expect(updatePayrollEntry(7476, ENTRY_ID, { pay_config: runConfig }, ACTOR)).rejects.toThrow(
      /run is completed/,
    );
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_payroll_upsert_employee", expect.anything());
  });

  // ── round-7 #41: the inline live-snapshot recompute hook ──
  it("refreshes the run's live snapshot after a committed entry patch (round-7 #41)", async () => {
    await updatePayrollEntry(7476, ENTRY_ID, { clock_hours_w1: 41.5 }, ACTOR);
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).toHaveBeenCalledWith(7476, RUN_ID_FOR_ENTRY);
  });

  it("the recompute hook runs BEFORE the write-through — a half-apply still refreshed the cache", async () => {
    routeRpc({
      qteklink_payroll_upsert_employee: {
        data: null,
        error: { code: "P0001", message: "pay_config invalid for role" },
      },
    });
    await expect(updatePayrollEntry(7476, ENTRY_ID, { pay_config: runConfig }, ACTOR)).rejects.toThrow(
      /entry was saved/,
    );
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).toHaveBeenCalledWith(7476, RUN_ID_FOR_ENTRY);
  });

  it("a FAILED entry RPC never triggers the recompute hook (nothing committed)", async () => {
    routeRpc({ qteklink_payroll_update_entry: { data: null, error: { code: "P0001", message: "run is completed" } } });
    await expect(updatePayrollEntry(7476, ENTRY_ID, { clock_hours_w1: 1 }, ACTOR)).rejects.toThrow();
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).not.toHaveBeenCalled();
  });
});

// ── updatePayrollRun patch shaping (round-5 #33: bonus_period + explicit bonus_month) ──

describe("updatePayrollRun patch shaping (round-5 #33)", () => {
  const RUN_ID = "00000000-0000-4000-8000-00000000f001";

  beforeEach(() => {
    fromMock.mockImplementation((table: string) => {
      if (table === "qteklink_payroll_runs") {
        return chain({
          data: [
            {
              id: RUN_ID,
              shop_id: 7476,
              period_start: "2026-06-28",
              period_end: "2026-07-11",
              status: "open",
              bonus_period: false,
              bonus_month: null,
              snapshot: null,
              completed_at: null,
              completed_by_label: null,
              voided_at: null,
              voided_by_label: null,
              void_reason: null,
              cloned_from_run_id: null,
              created_at: "2026-07-10T00:00:00Z",
              updated_at: "2026-07-10T00:00:00Z",
            },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    });
  });

  function runPatchSentToRpc(): Record<string, unknown> | undefined {
    const call = rpcMock.mock.calls.find(([fn]) => fn === "qteklink_payroll_update_run");
    return call?.[1]?.p_patch as Record<string, unknown> | undefined;
  }

  it("an explicit month pick sends ONLY bonus_month (never an implied bonus_period=false)", async () => {
    await updatePayrollRun(7476, RUN_ID, { bonusMonth: "2026-06-01" }, ACTOR);
    expect(runPatchSentToRpc()).toEqual({ bonus_month: "2026-06-01" });
  });

  it("the slider toggle sends ONLY bonus_period", async () => {
    await updatePayrollRun(7476, RUN_ID, { bonusPeriod: true }, ACTOR);
    expect(runPatchSentToRpc()).toEqual({ bonus_period: true });
  });

  it("both keys travel together when both are provided", async () => {
    await updatePayrollRun(7476, RUN_ID, { bonusPeriod: true, bonusMonth: "2026-05-01" }, ACTOR);
    expect(runPatchSentToRpc()).toEqual({ bonus_period: true, bonus_month: "2026-05-01" });
  });

  it("rejects a non-first-of-month bonus month BEFORE any fetch or RPC", async () => {
    await expect(
      updatePayrollRun(7476, RUN_ID, { bonusMonth: "2026-06-15" }, ACTOR),
    ).rejects.toMatchObject({
      name: "QboClientError",
      message: expect.stringMatching(/first day of a month/),
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed bonus month (not a real date)", async () => {
    await expect(updatePayrollRun(7476, RUN_ID, { bonusMonth: "2026-13-01" }, ACTOR)).rejects.toThrow(
      /first day of a month/,
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an empty patch", async () => {
    await expect(updatePayrollRun(7476, RUN_ID, {}, ACTOR)).rejects.toThrow(/Nothing to update/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refreshes the live snapshot after a committed run patch (round-7 #41)", async () => {
    await updatePayrollRun(7476, RUN_ID, { bonusPeriod: true }, ACTOR);
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).toHaveBeenCalledWith(7476, RUN_ID);
  });

  it("a FAILED run RPC never triggers the recompute hook", async () => {
    routeRpc({ qteklink_payroll_update_run: { data: null, error: { code: "P0001", message: "run is completed" } } });
    await expect(updatePayrollRun(7476, RUN_ID, { bonusPeriod: true }, ACTOR)).rejects.toThrow(/run is completed/);
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).not.toHaveBeenCalled();
  });
});

// ── completePayrollRun: the round-7 #40 invariant — completion NEVER reads the
//    live snapshot; the frozen snapshot is always a fresh no-memo compute. ──

describe("completePayrollRun never reads the live snapshot (round-7 #40)", () => {
  const RUN_ID = "00000000-0000-4000-8000-00000000f002";
  const LIVE_CACHE = { snapshot_version: 1, note: "STALE-DISPLAY-CACHE" };
  const FRESH = { snapshot_version: 1, note: "FRESH-COMPLETION-COMPUTE" };
  // Round-11 §4: the engine's ledger payloads the DAL threads into the confirm RPC.
  const PTO_ENTRIES = [
    { employee_id: EMP_ID, kind: "accrual", hours: 3.08, boundary_year: null },
    { employee_id: EMP_ID, kind: "usage", hours: -8, boundary_year: null },
  ];

  beforeEach(() => {
    fromMock.mockImplementation((table: string) => {
      if (table === "qteklink_payroll_runs") {
        return chain({
          data: [
            {
              id: RUN_ID,
              shop_id: 7476,
              period_start: "2026-06-28",
              period_end: "2026-07-11",
              status: "open",
              bonus_period: false,
              bonus_month: null,
              snapshot: null,
              // A fresh-looking live snapshot sits RIGHT THERE — completion must ignore it.
              live_snapshot: LIVE_CACHE,
              live_snapshot_at: new Date().toISOString(),
              live_snapshot_stale: false,
              completed_at: null,
              completed_by_label: null,
              voided_at: null,
              voided_by_label: null,
              void_reason: null,
              cloned_from_run_id: null,
              created_at: "2026-07-10T00:00:00Z",
              updated_at: "2026-07-10T00:00:00Z",
            },
          ],
          error: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    });
    rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "qteklink_payroll_complete_run") {
        return Promise.resolve(
          args.p_dry_run === true
            ? { data: { state_hash: "hash-1" }, error: null }
            : { data: { completed: true }, error: null },
        );
      }
      if (fn === "qteklink_payroll_issue_confirm_token") {
        return Promise.resolve({
          data: [{ token_id: "00000000-0000-4000-8000-00000000c001", expires_at: "2026-07-11T00:05:00Z" }],
          error: null,
        });
      }
      // qbo_resolve_realm_for_shop (the alert's settings read) and anything else.
      return Promise.resolve({ data: null, error: null });
    });
    vi.mocked(buildOpenRunSnapshot).mockResolvedValue(FRESH as never);
    // The completion PTO-entry assembly is boundary-mocked; its internals have their
    // own tests. Default: return the two payloads the confirm call must carry.
    vi.mocked(assembleCompletionPtoEntries).mockResolvedValue({
      entries: PTO_ENTRIES as never,
      warnings: [],
    });
    vi.mocked(runCompletionEmailFanout).mockResolvedValue(undefined as never);
  });

  it("freezes the FRESH no-memo compute, never the stored live snapshot", async () => {
    await completePayrollRun(7476, RUN_ID, ACTOR);

    // Fresh compute, NO memo third argument (exactly two args = no cached QBO reuse).
    expect(vi.mocked(buildOpenRunSnapshot)).toHaveBeenCalledWith(
      7476,
      expect.objectContaining({ id: RUN_ID, status: "open" }),
    );

    const confirm = rpcMock.mock.calls.find(
      ([fn, args]) => fn === "qteklink_payroll_complete_run" && args?.p_dry_run === false,
    );
    expect(confirm?.[1]?.p_snapshot).toBe(FRESH); // the fresh compute is what freezes
    expect(confirm?.[1]?.p_snapshot).not.toEqual(LIVE_CACHE);

    // And the completion path never touches the live-snapshot substrate.
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_payroll_store_live_snapshot", expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_payroll_mark_open_runs_stale", expect.anything());
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).not.toHaveBeenCalled();
  });

  // ── Round-11 (plan §4): p_pto_entries threading + the DRY-RUN byte-identity. ──

  it("passes the assembled p_pto_entries into the CONFIRM call (built from the fresh snapshot)", async () => {
    await completePayrollRun(7476, RUN_ID, ACTOR);

    // The assembly ran against the FRESH completion snapshot (single-source, §4).
    expect(vi.mocked(assembleCompletionPtoEntries)).toHaveBeenCalledWith(7476, FRESH);

    const confirm = rpcMock.mock.calls.find(
      ([fn, args]) => fn === "qteklink_payroll_complete_run" && args?.p_dry_run === false,
    );
    // Exactly the engine's payloads ride into the ONE completion transaction.
    expect(confirm?.[1]?.p_pto_entries).toEqual(PTO_ENTRIES);
  });

  it("the DRY-RUN call carries NO p_pto_entries — the Pattern-S hash/token flow stays byte-identical (C5/C12/C32)", async () => {
    await completePayrollRun(7476, RUN_ID, ACTOR);

    const dry = rpcMock.mock.calls.find(
      ([fn, args]) => fn === "qteklink_payroll_complete_run" && args?.p_dry_run === true,
    );
    expect(dry).toBeDefined();
    // No PTO key on the preview — PTO is advisory-display only + NOT in the state hash.
    expect(dry?.[1]).not.toHaveProperty("p_pto_entries");
  });

  it("assembles the entries BEFORE issuing the single-use token (a build failure wastes no token)", async () => {
    await completePayrollRun(7476, RUN_ID, ACTOR);
    const assembleOrder = vi.mocked(assembleCompletionPtoEntries).mock.invocationCallOrder[0]!;
    const tokenCall = rpcMock.mock.calls.findIndex(([fn]) => fn === "qteklink_payroll_issue_confirm_token");
    // The token RPC is invoked; assembly's call order precedes the confirm/token RPCs.
    expect(tokenCall).toBeGreaterThanOrEqual(0);
    const tokenOrder = rpcMock.mock.invocationCallOrder[tokenCall]!;
    expect(assembleOrder).toBeLessThan(tokenOrder);
  });

  it("returns { completed: true } as soon as the confirm RPC commits", async () => {
    await expect(completePayrollRun(7476, RUN_ID, ACTOR)).resolves.toEqual({ completed: true });
  });

  it("fires the email fan-out POST-RESPONSE via after() with the fresh snapshot (never synchronously into the money path)", async () => {
    await completePayrollRun(7476, RUN_ID, ACTOR);
    // after() is mocked to microtask-defer; flush the queue.
    await Promise.resolve();
    await Promise.resolve();
    expect(vi.mocked(runCompletionEmailFanout)).toHaveBeenCalledWith(
      7476,
      FRESH,
      expect.stringContaining("Payroll run completed"),
      expect.arrayContaining([expect.stringContaining("Pay period: 2026-06-28 to 2026-07-11")]),
    );
    // The completed-run alert is no longer sent synchronously here — it rides the
    // fan-out (sendPayrollAlert is invoked INSIDE runCompletionEmailFanout, which
    // is mocked), so the synchronous path issues no alert settings read/send.
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_payroll_log_email", expect.anything());
  });

  it("a FAILED confirm RPC never assembles a completion + never fires the fan-out", async () => {
    rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "qteklink_payroll_complete_run") {
        return Promise.resolve(
          args.p_dry_run === true
            ? { data: { state_hash: "hash-1" }, error: null }
            : { data: null, error: { code: "P0001", message: "stale state hash" } },
        );
      }
      if (fn === "qteklink_payroll_issue_confirm_token") {
        return Promise.resolve({
          data: [{ token_id: "00000000-0000-4000-8000-00000000c001", expires_at: "2026-07-11T00:05:00Z" }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    await expect(completePayrollRun(7476, RUN_ID, ACTOR)).rejects.toThrow(/stale state hash/);
    await Promise.resolve();
    expect(vi.mocked(runCompletionEmailFanout)).not.toHaveBeenCalled();
  });
});
