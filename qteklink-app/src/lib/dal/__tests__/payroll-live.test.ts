/**
 * payroll-live.ts unit tests — the round-7 #40/#41 LIVE-snapshot substrate:
 *   - computePayrollRun read path: completed/voided runs render the FROZEN snapshot
 *     (never the live cache, never recomputed); open runs serve the fresh cache and
 *     recompute-and-store when stale/absent/unparseable/older-calc-version;
 *   - a cache-fill store failure is Sentry-captured and the computed snapshot still
 *     returns (the stale flag backstops);
 *   - extractQboTechCostMemo structural extraction (#41);
 *   - recomputeStaleOpenRuns 60s debounce (#40) + the freshQbo nightly override;
 *   - applyMirrorEventsAndRecompute: full-RO-payload gating (partial payloads are
 *     SKIPPED — never run through the delete-then-insert child sync), per-RO dedupe
 *     to the NEWEST payload (duplicate ids in one upsert = Postgres 21000 + child-PK
 *     collisions after the delete), the mirror-recency guard (an older payload never
 *     regresses the mirror), single-sourced mapper application via upsertPage,
 *     mark-stale, per-shop error isolation.
 * The Supabase admin client, Sentry, buildOpenRunSnapshot, and the mirror-ingest
 * write helpers are mocked; the RunSnapshotSchema parse runs REAL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock, from: fromMock }),
}));
vi.mock("@/lib/dal/payroll-compute", () => ({ buildOpenRunSnapshot: vi.fn() }));
vi.mock("@/lib/payroll/mirror-ingest", () => ({
  createAlertCollector: vi.fn(() => ({ checkKeys: vi.fn(), recordInsertError: vi.fn(), list: () => [] })),
  flushAlerts: vi.fn(),
  upsertPage: vi.fn(async (_db: unknown, _shopId: number, ros: unknown[]) => ({
    ros: ros.length,
    jobs: 0,
    concerns: 0,
  })),
}));

import { buildOpenRunSnapshot } from "@/lib/dal/payroll-compute";
import { flushAlerts, upsertPage } from "@/lib/payroll/mirror-ingest";
import { CALC_VERSION } from "@/lib/payroll/calc";
import type { RunSnapshot } from "@/lib/payroll/types";
import type { RunDbRow } from "@/lib/dal/payroll-shared";
import {
  applyMirrorEventsAndRecompute,
  computePayrollRun,
  extractQboTechCostMemo,
  getOrComputeLiveSnapshot,
  isFullRoPayload,
  recomputeStaleOpenRuns,
  type MirrorApplyEventRow,
} from "../payroll-live";

const SHOP_ID = 7476;
const RUN_UUID = "7f0a1b2c-3d4e-4f5a-8b9c-0d1e2f3a4b5c";

function validSnapshot(over: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    snapshot_version: 1,
    calc_version: CALC_VERSION,
    run: {
      run_id: RUN_UUID,
      shop_id: SHOP_ID,
      period_start: "2026-06-28",
      period_end: "2026-07-11",
      bonus_period: false,
      bonus_month: null,
    },
    employees: [],
    summary: [],
    derived_provenance: {
      as_of: "2026-07-11T04:00:00Z",
      period_start: "2026-06-28",
      period_end: "2026-07-11",
      bonus_month: null,
      ro_count: 0,
      source: "tekmetric_ros mirror",
    },
    spiff_categories: [],
    ...over,
  };
}

function makeRun(over: Partial<RunDbRow> = {}): RunDbRow {
  return {
    id: RUN_UUID,
    shop_id: SHOP_ID,
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
    created_at: "2026-06-28T00:00:00Z",
    updated_at: "2026-07-11T00:00:00Z",
    ...over,
  };
}

function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "not", "order", "limit", "range"]) c[m] = vi.fn(() => c);
  c.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onF, onR);
  return c;
}

function routeTables(byTable: Record<string, { data: unknown; error: unknown }>) {
  fromMock.mockImplementation((table: string) => {
    const result = byTable[table];
    if (!result) throw new Error(`unexpected table ${table}`);
    return chain(result);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockResolvedValue({ data: null, error: null });
});

// ── computePayrollRun read path ────────────────────────────────────────────────

describe("computePayrollRun (read-through, #41)", () => {
  it("completed runs render the FROZEN snapshot — the live cache is never consulted", async () => {
    const frozen = validSnapshot();
    const liveCache = validSnapshot({ calc_version: CALC_VERSION });
    routeTables({
      qteklink_payroll_runs: {
        data: [
          makeRun({
            status: "completed",
            snapshot: frozen,
            live_snapshot: liveCache,
            live_snapshot_stale: false,
            completed_at: "2026-07-11T00:00:00Z",
            completed_by_label: "chris@jeffsautomotive.com",
          }),
        ],
        error: null,
      },
    });
    const out = await computePayrollRun(SHOP_ID, RUN_UUID);
    expect(out.snapshot).toEqual(frozen);
    expect(vi.mocked(buildOpenRunSnapshot)).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("an open run with a FRESH cache serves it — no compute, no store", async () => {
    const cached = validSnapshot();
    routeTables({
      qteklink_payroll_runs: {
        data: [makeRun({ live_snapshot: cached, live_snapshot_stale: false })],
        error: null,
      },
    });
    const out = await computePayrollRun(SHOP_ID, RUN_UUID);
    expect(out.snapshot).toEqual(cached);
    expect(vi.mocked(buildOpenRunSnapshot)).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("an open STALE run computes once, stores via the RPC, and returns the computed snapshot", async () => {
    const computed = validSnapshot();
    vi.mocked(buildOpenRunSnapshot).mockResolvedValue(computed);
    routeTables({
      qteklink_payroll_runs: {
        data: [makeRun({ live_snapshot: validSnapshot(), live_snapshot_stale: true })],
        error: null,
      },
    });
    const out = await computePayrollRun(SHOP_ID, RUN_UUID);
    expect(out.snapshot).toBe(computed);
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_store_live_snapshot",
      expect.objectContaining({
        p_run_id: RUN_UUID,
        p_snapshot: computed,
        // the lost-invalidation race guard: every store carries the compute's start
        p_compute_started_at: expect.any(String),
      }),
    );
  });

  it("a fresh-flagged cache computed under an OLDER calc version is recomputed", async () => {
    const computed = validSnapshot();
    vi.mocked(buildOpenRunSnapshot).mockResolvedValue(computed);
    routeTables({
      qteklink_payroll_runs: {
        data: [
          makeRun({
            live_snapshot: validSnapshot({ calc_version: CALC_VERSION - 1 }),
            live_snapshot_stale: false,
          }),
        ],
        error: null,
      },
    });
    const out = await computePayrollRun(SHOP_ID, RUN_UUID);
    expect(out.snapshot).toBe(computed);
    expect(vi.mocked(buildOpenRunSnapshot)).toHaveBeenCalled();
  });

  it("a fresh-flagged but UNPARSEABLE cache is recomputed (schema drift never 500s the page)", async () => {
    const computed = validSnapshot();
    vi.mocked(buildOpenRunSnapshot).mockResolvedValue(computed);
    routeTables({
      qteklink_payroll_runs: {
        data: [makeRun({ live_snapshot: { garbage: true }, live_snapshot_stale: false })],
        error: null,
      },
    });
    const out = await computePayrollRun(SHOP_ID, RUN_UUID);
    expect(out.snapshot).toBe(computed);
  });

  it("a cache-fill store failure is captured and the computed snapshot STILL returns", async () => {
    const computed = validSnapshot();
    vi.mocked(buildOpenRunSnapshot).mockResolvedValue(computed);
    rpcMock.mockResolvedValue({ data: null, error: { message: "run is completed" } });
    const out = await getOrComputeLiveSnapshot(SHOP_ID, makeRun());
    expect(out).toBe(computed);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ shop_id: String(SHOP_ID) }) }),
    );
  });

  it("getOrComputeLiveSnapshot refuses non-open runs (the frozen snapshot governs)", async () => {
    await expect(getOrComputeLiveSnapshot(SHOP_ID, makeRun({ status: "completed" }))).rejects.toThrow(
      /completed run/,
    );
  });
});

// ── extractQboTechCostMemo (#41) ──────────────────────────────────────────────

describe("extractQboTechCostMemo", () => {
  const provenance = (over: Record<string, unknown> = {}) => ({
    derived_provenance: {
      bonus_month: "2026-06-01",
      month_gp_source: "qbo_tech_cost",
      month_qbo_tech_cost_cents: 4_874_072,
      month_qbo_tech_cost_account: "6010 Technicians",
      month_qbo_tech_cost_fetched_at: "2026-07-11T10:00:00Z",
      month_qbo_tech_cost_realm_id: "R123",
      ...over,
    },
  });
  const bonusRun = (liveSnapshot: unknown) =>
    makeRun({ bonus_period: true, bonus_month: "2026-06-01", live_snapshot: liveSnapshot });

  it("extracts the memo from a qbo_tech_cost live snapshot for the SAME bonus month", () => {
    expect(extractQboTechCostMemo(bonusRun(provenance()))).toEqual({
      month: "2026-06",
      valueCents: 4_874_072,
      accountLabel: "6010 Technicians",
      fetchedAt: "2026-07-11T10:00:00Z",
      realmId: "R123",
    });
  });

  it("null for non-bonus runs, computed-source snapshots, month drift, and missing keys", () => {
    expect(extractQboTechCostMemo(makeRun({ live_snapshot: provenance() }))).toBeNull();
    expect(extractQboTechCostMemo(bonusRun(provenance({ month_gp_source: "computed" })))).toBeNull();
    expect(extractQboTechCostMemo(bonusRun(provenance({ bonus_month: "2026-05-01" })))).toBeNull();
    expect(extractQboTechCostMemo(bonusRun(provenance({ month_qbo_tech_cost_fetched_at: undefined })))).toBeNull();
    expect(extractQboTechCostMemo(bonusRun(provenance({ month_qbo_tech_cost_realm_id: 42 })))).toBeNull();
    expect(extractQboTechCostMemo(bonusRun(null))).toBeNull();
  });
});

// ── recomputeStaleOpenRuns: the 60s debounce (#40) ────────────────────────────

describe("recomputeStaleOpenRuns", () => {
  const NOW = Date.parse("2026-07-11T12:00:00Z");
  const RUN_B = "8a1b2c3d-4e5f-4a6b-9c0d-1e2f3a4b5c6d";

  it("recomputes stale runs, skips fresh ones, and debounces < 60s-old snapshots", async () => {
    const computed = validSnapshot();
    vi.mocked(buildOpenRunSnapshot).mockResolvedValue(computed);
    routeTables({
      qteklink_payroll_runs: {
        data: [
          // stale + last computed 30s ago → debounced (stays stale)
          makeRun({ id: RUN_UUID, live_snapshot_stale: true, live_snapshot_at: new Date(NOW - 30_000).toISOString() }),
          // stale + last computed 2min ago → recomputed
          makeRun({ id: RUN_B, live_snapshot_stale: true, live_snapshot_at: new Date(NOW - 120_000).toISOString() }),
          // fresh → untouched
          makeRun({ id: "9b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", live_snapshot_stale: false }),
        ],
        error: null,
      },
    });
    const out = await recomputeStaleOpenRuns(SHOP_ID, { now: () => NOW });
    expect(out.debouncedRunIds).toEqual([RUN_UUID]);
    expect(out.recomputedRunIds).toEqual([RUN_B]);
    expect(vi.mocked(buildOpenRunSnapshot)).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith(
      "qteklink_payroll_store_live_snapshot",
      expect.objectContaining({ p_run_id: RUN_B }),
    );
  });

  it("a never-computed stale run (live_snapshot_at null) is never debounced", async () => {
    vi.mocked(buildOpenRunSnapshot).mockResolvedValue(validSnapshot());
    routeTables({
      qteklink_payroll_runs: { data: [makeRun({ live_snapshot_stale: true, live_snapshot_at: null })], error: null },
    });
    const out = await recomputeStaleOpenRuns(SHOP_ID, { now: () => NOW });
    expect(out.recomputedRunIds).toEqual([RUN_UUID]);
  });

  it("freshQbo (the nightly) ignores the debounce AND passes no memo", async () => {
    vi.mocked(buildOpenRunSnapshot).mockResolvedValue(validSnapshot());
    routeTables({
      qteklink_payroll_runs: {
        data: [
          makeRun({ live_snapshot_stale: true, live_snapshot_at: new Date(NOW - 10_000).toISOString() }),
        ],
        error: null,
      },
    });
    const out = await recomputeStaleOpenRuns(SHOP_ID, { freshQbo: true, now: () => NOW });
    expect(out.recomputedRunIds).toEqual([RUN_UUID]);
    expect(out.debouncedRunIds).toEqual([]);
    expect(vi.mocked(buildOpenRunSnapshot)).toHaveBeenCalledWith(
      SHOP_ID,
      expect.objectContaining({ id: RUN_UUID }),
      { qboTechCostMemo: null },
    );
  });
});

// ── The #40 apply pipeline ─────────────────────────────────────────────────────

describe("isFullRoPayload", () => {
  it("requires a safe-integer id AND a jobs array", () => {
    expect(isFullRoPayload({ id: 153886, jobs: [] })).toBe(true);
    expect(isFullRoPayload({ id: 153886, jobs: [{}] })).toBe(true);
    expect(isFullRoPayload({ id: "153886", jobs: [] })).toBe(false);
    expect(isFullRoPayload({ id: 153886 })).toBe(false); // partial payload — would wipe children
    expect(isFullRoPayload({ jobs: [] })).toBe(false);
    expect(isFullRoPayload(null)).toBe(false);
    expect(isFullRoPayload([])).toBe(false);
  });
});

describe("applyMirrorEventsAndRecompute", () => {
  const event = (over: Partial<MirrorApplyEventRow> = {}): MirrorApplyEventRow => ({
    id: "00000000-0000-4000-8000-00000000ee01",
    shop_id: SHOP_ID,
    event_kind: "ro_posted",
    tekmetric_ro_id: 153886,
    raw_body: { data: { id: 153886, shopId: SHOP_ID, jobs: [] } },
    ...over,
  });

  beforeEach(() => {
    // No open runs → the recompute loop is a no-op in these tests. The empty
    // tekmetric_ros result = "mirror has never seen these ROs" (no recency floor).
    routeTables({
      qteklink_payroll_runs: { data: [], error: null },
      tekmetric_ros: { data: [], error: null },
    });
    rpcMock.mockImplementation((fn: string) =>
      Promise.resolve(fn === "qteklink_payroll_mark_open_runs_stale" ? { data: 2, error: null } : { data: null, error: null }),
    );
  });

  it("applies FULL RO payloads through the single-sourced mappers, skips partials, marks stale", async () => {
    const results = await applyMirrorEventsAndRecompute([
      event(),
      event({ id: "00000000-0000-4000-8000-00000000ee02", raw_body: { data: { id: 153887 } } }), // partial
    ]);
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r).toMatchObject({
      shopId: SHOP_ID,
      eventsSeen: 2,
      payloadsApplied: 1,
      payloadsSkipped: 1,
      markedStale: 2,
      error: null,
    });
    expect(vi.mocked(upsertPage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upsertPage)).toHaveBeenCalledWith(
      expect.anything(),
      SHOP_ID,
      [expect.objectContaining({ id: 153886 })],
      expect.anything(),
    );
    expect(vi.mocked(flushAlerts)).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_payroll_mark_open_runs_stale", { p_shop_id: SHOP_ID });
  });

  it("still marks stale when EVERY payload was skipped (the RO data changed regardless)", async () => {
    const results = await applyMirrorEventsAndRecompute([event({ raw_body: { data: { id: 153887 } } })]);
    expect(vi.mocked(upsertPage)).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ payloadsApplied: 0, payloadsSkipped: 1, markedStale: 2 });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_payroll_mark_open_runs_stale", { p_shop_id: SHOP_ID });
  });

  it("dedupes duplicate events for the SAME RO to the newest payload — never two ids in one upsert", async () => {
    const older = { id: 153886, shopId: SHOP_ID, jobs: [], updatedDate: "2026-07-11T10:00:00Z" };
    const newer = { id: 153886, shopId: SHOP_ID, jobs: [{}], updatedDate: "2026-07-11T11:00:00Z" };
    // The newer payload arrives FIRST in received_at order; the older duplicate
    // (a replay / out-of-order delivery) lands later and must be dropped.
    const results = await applyMirrorEventsAndRecompute([
      event({ id: "00000000-0000-4000-8000-00000000ee11", raw_body: { data: newer } }),
      event({ id: "00000000-0000-4000-8000-00000000ee12", raw_body: { data: older } }),
    ]);
    expect(vi.mocked(upsertPage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(upsertPage)).toHaveBeenCalledWith(expect.anything(), SHOP_ID, [newer], expect.anything());
    expect(results[0]).toMatchObject({ eventsSeen: 2, payloadsApplied: 1, payloadsStale: 1, payloadsSkipped: 0 });
  });

  it("duplicate events without updatedDate fall to event order — the later-received payload wins", async () => {
    const first = { id: 153886, shopId: SHOP_ID, jobs: [] };
    const second = { id: 153886, shopId: SHOP_ID, jobs: [{}] };
    const results = await applyMirrorEventsAndRecompute([
      event({ id: "00000000-0000-4000-8000-00000000ee13", raw_body: { data: first } }),
      event({ id: "00000000-0000-4000-8000-00000000ee14", raw_body: { data: second } }),
    ]);
    expect(vi.mocked(upsertPage)).toHaveBeenCalledWith(expect.anything(), SHOP_ID, [second], expect.anything());
    expect(results[0]).toMatchObject({ payloadsApplied: 1, payloadsStale: 1 });
  });

  it("skips a payload OLDER than the mirror row (unordered notifies never regress it) — stale still marked", async () => {
    routeTables({
      qteklink_payroll_runs: { data: [], error: null },
      tekmetric_ros: { data: [{ id: 153886, updated_date: "2026-07-11T12:00:00Z" }], error: null },
    });
    const results = await applyMirrorEventsAndRecompute([
      event({ raw_body: { data: { id: 153886, shopId: SHOP_ID, jobs: [], updatedDate: "2026-07-11T10:00:00Z" } } }),
    ]);
    expect(vi.mocked(upsertPage)).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ payloadsApplied: 0, payloadsStale: 1, payloadsSkipped: 0, markedStale: 2 });
    expect(rpcMock).toHaveBeenCalledWith("qteklink_payroll_mark_open_runs_stale", { p_shop_id: SHOP_ID });
  });

  it("a null-updatedDate payload is older than an UPDATED mirror row (skipped)", async () => {
    routeTables({
      qteklink_payroll_runs: { data: [], error: null },
      tekmetric_ros: { data: [{ id: 153886, updated_date: "2026-07-11T12:00:00Z" }], error: null },
    });
    const results = await applyMirrorEventsAndRecompute([event()]); // the helper payload has no updatedDate
    expect(vi.mocked(upsertPage)).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ payloadsApplied: 0, payloadsStale: 1 });
  });

  it("applies a payload NEWER than the mirror row (and a never-updated mirror row is no floor)", async () => {
    routeTables({
      qteklink_payroll_runs: { data: [], error: null },
      tekmetric_ros: {
        data: [
          { id: 153886, updated_date: "2026-07-11T10:00:00Z" },
          { id: 153887, updated_date: null },
        ],
        error: null,
      },
    });
    const newer = { id: 153886, shopId: SHOP_ID, jobs: [], updatedDate: "2026-07-11T12:00:00Z" };
    const neverUpdated = { id: 153887, shopId: SHOP_ID, jobs: [] };
    const results = await applyMirrorEventsAndRecompute([
      event({ raw_body: { data: newer } }),
      event({ id: "00000000-0000-4000-8000-00000000ee15", raw_body: { data: neverUpdated } }),
    ]);
    expect(vi.mocked(upsertPage)).toHaveBeenCalledWith(
      expect.anything(),
      SHOP_ID,
      [newer, neverUpdated],
      expect.anything(),
    );
    expect(results[0]).toMatchObject({ payloadsApplied: 2, payloadsStale: 0 });
  });

  it("isolates a per-shop failure: the broken shop reports its error, the other still applies", async () => {
    vi.mocked(upsertPage)
      .mockRejectedValueOnce(new Error("mirror write exploded"))
      .mockResolvedValueOnce({ ros: 1, jobs: 0, concerns: 0 });
    const results = await applyMirrorEventsAndRecompute([
      event({ shop_id: 1111, raw_body: { data: { id: 1, shopId: 1111, jobs: [] } } }),
      event({ id: "00000000-0000-4000-8000-00000000ee03", shop_id: 2222, raw_body: { data: { id: 2, shopId: 2222, jobs: [] } } }),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ shopId: 1111, error: "mirror write exploded" });
    expect(results[1]).toMatchObject({ shopId: 2222, payloadsApplied: 1, error: null });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ shop_id: "1111" }) }),
    );
  });

  it("drops events with an unusable shop_id instead of applying them anywhere", async () => {
    const results = await applyMirrorEventsAndRecompute([
      event({ shop_id: 0 }),
      event({ shop_id: Number.NaN as unknown as number }),
    ]);
    expect(results).toEqual([]);
    expect(vi.mocked(upsertPage)).not.toHaveBeenCalled();
  });
});
