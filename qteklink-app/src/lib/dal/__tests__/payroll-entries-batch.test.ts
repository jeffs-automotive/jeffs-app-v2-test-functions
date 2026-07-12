/**
 * updatePayrollEntriesBatch (round-8 #43) — the entry grid's ONE-Save atomic
 * batch: every patch is Zod-validated client-side (same value rules as the
 * single path), the RPC is called EXACTLY ONCE with the whole batch (the SQL
 * side is one transaction), and exactly ONE live-snapshot recompute follows
 * (the round-7 post-mutation hook). pay_config/overrides are rejected — they
 * keep their single-entry editors (the round-3 #26 write-through must never
 * silently fork into a batch path). Mocks the Supabase admin client
 * (payroll.test.ts idiom); the live substrate is mocked wholesale.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/dal/payroll-live", () => ({
  refreshLiveSnapshotAfterMutation: vi.fn(),
}));

import { refreshLiveSnapshotAfterMutation } from "@/lib/dal/payroll-live";
import { updatePayrollEntriesBatch } from "../payroll-entries-batch";

const ACTOR = { userId: "00000000-0000-4000-8000-0000000000aa", label: "marie@jeffsautomotive.com" };
const RUN_ID = "00000000-0000-4000-8000-00000000f009";
const ROW_1 = "00000000-0000-4000-8000-00000000e001";
const ROW_2 = "00000000-0000-4000-8000-00000000e002";

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "limit", "range"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
  return c;
}

function routeRunFetch() {
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
            live_snapshot: null,
            live_snapshot_at: null,
            live_snapshot_stale: true,
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
}

beforeEach(() => {
  vi.clearAllMocks();
  routeRunFetch();
  rpcMock.mockResolvedValue({ data: { updated: 2 }, error: null });
});

describe("updatePayrollEntriesBatch (round-8 #43)", () => {
  it("calls the batch RPC exactly ONCE with every row's changed-keys-only patch", async () => {
    const res = await updatePayrollEntriesBatch(
      7476,
      RUN_ID,
      [
        { runEmployeeId: ROW_1, patch: { clock_hours_w1: 41.25, pto_w2: 8 } },
        { runEmployeeId: ROW_2, patch: { manual_incentive_cents: 2500 } },
      ],
      ACTOR,
    );

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_payroll_update_entries", {
      p_run_id: RUN_ID,
      p_patches: [
        { run_employee_id: ROW_1, patch: { clock_hours_w1: 41.25, pto_w2: 8 } },
        { run_employee_id: ROW_2, patch: { manual_incentive_cents: 2500 } },
      ],
      p_actor_user_id: ACTOR.userId,
      p_actor_label: ACTOR.label,
    });
    expect(res).toEqual({ updated: 2 });
  });

  it("runs exactly ONE live-snapshot recompute for the whole batch (round-7 #41 hook)", async () => {
    await updatePayrollEntriesBatch(
      7476,
      RUN_ID,
      [
        { runEmployeeId: ROW_1, patch: { clock_hours_w1: 40 } },
        { runEmployeeId: ROW_2, patch: { training_w1: 2 } },
      ],
      ACTOR,
    );
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).toHaveBeenCalledWith(7476, RUN_ID);
  });

  it("null clears a value (hours + incentive both nullable)", async () => {
    await updatePayrollEntriesBatch(
      7476,
      RUN_ID,
      [{ runEmployeeId: ROW_1, patch: { pto_w1: null, manual_incentive_cents: null } }],
      ACTOR,
    );
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_update_entries",
      expect.objectContaining({
        p_patches: [{ run_employee_id: ROW_1, patch: { pto_w1: null, manual_incentive_cents: null } }],
      }),
    );
  });

  it("rejects an empty batch before any fetch or RPC", async () => {
    await expect(updatePayrollEntriesBatch(7476, RUN_ID, [], ACTOR)).rejects.toThrow(/Nothing to update/);
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("rejects a row with an empty patch", async () => {
    await expect(
      updatePayrollEntriesBatch(7476, RUN_ID, [{ runEmployeeId: ROW_1, patch: {} }], ACTOR),
    ).rejects.toThrow(/Nothing to update for one of the rows/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects pay_config in a batch (the #26 write-through path is single-entry only)", async () => {
    await expect(
      updatePayrollEntriesBatch(
        7476,
        RUN_ID,
        [{ runEmployeeId: ROW_1, patch: { pay_config: { config_version: 1 } } }],
        ACTOR,
      ),
    ).rejects.toThrow(/cannot be batch-saved/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects overrides in a batch (the OverrideEditor keeps the single-entry action)", async () => {
    await expect(
      updatePayrollEntriesBatch(
        7476,
        RUN_ID,
        [{ runEmployeeId: ROW_1, patch: { overrides: { billed_hours_w1: { value: 1, note: "" } } } }],
        ACTOR,
      ),
    ).rejects.toThrow(/cannot be batch-saved/);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range hour value before any RPC (same Zod rule as the single path)", async () => {
    await expect(
      updatePayrollEntriesBatch(7476, RUN_ID, [{ runEmployeeId: ROW_1, patch: { clock_hours_w1: 200 } }], ACTOR),
    ).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-integer incentive before any RPC", async () => {
    await expect(
      updatePayrollEntriesBatch(
        7476,
        RUN_ID,
        [{ runEmployeeId: ROW_1, patch: { manual_incentive_cents: 10.5 } }],
        ACTOR,
      ),
    ).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("surfaces a P0001 RAISE as a validation QboClientError and NEVER recomputes (nothing committed)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "qteklink_payroll_update_entries: run is completed — entries are locked" },
    });
    await expect(
      updatePayrollEntriesBatch(7476, RUN_ID, [{ runEmployeeId: ROW_1, patch: { clock_hours_w1: 40 } }], ACTOR),
    ).rejects.toMatchObject({
      name: "QboClientError",
      kind: "validation",
      message: expect.stringMatching(/entries are locked/),
    });
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).not.toHaveBeenCalled();
  });

  it("still refreshes the live snapshot when the committed RPC returns a malformed body", async () => {
    rpcMock.mockResolvedValue({ data: { nope: true }, error: null });
    await expect(
      updatePayrollEntriesBatch(7476, RUN_ID, [{ runEmployeeId: ROW_1, patch: { clock_hours_w1: 40 } }], ACTOR),
    ).rejects.toThrow(/returned no updated count/);
    // The batch COMMITTED (error was null) — the cache refresh must have run.
    expect(vi.mocked(refreshLiveSnapshotAfterMutation)).toHaveBeenCalledWith(7476, RUN_ID);
  });
});
