/**
 * Unit tests for the nightly qteklink-sync (C8 Part 1): refresh the payment-state projection
 * BEFORE reconciling (isolated so a corrupt payment can't block sales); reconcile always;
 * auto-post ONLY when the shop's auto_post is on (reusing the dashboard's plan→execute);
 * no-connection no-op; the shop-local prior-day default; listConnectedShops filtering.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const reconMock = vi.fn();
const settingsMock = vi.fn();
const planMock = vi.fn();
const executeMock = vi.fn();
const fromMock = vi.fn();
const safetyNetMock = vi.fn();
const sweepMock = vi.fn();
const reduceMock = vi.fn();
const warmMock = vi.fn();
const warmRoMock = vi.fn();

vi.mock("@/lib/dal/daily-reconcile", () => ({ runDailyReconciliation: (...a: unknown[]) => reconMock(...a) }));
vi.mock("@/lib/dal/settings", () => ({ getShopSettings: (...a: unknown[]) => settingsMock(...a) }));
vi.mock("@/lib/dal/payment-state", () => ({ reduceShopPaymentState: (...a: unknown[]) => reduceMock(...a) }));
vi.mock("@/lib/dal/customers", () => ({ warmCustomerNamesForRecentDays: (...a: unknown[]) => warmMock(...a) }));
vi.mock("@/lib/dal/ro-numbers", () => ({ warmRoNumbers: (...a: unknown[]) => warmRoMock(...a) }));
vi.mock("@/lib/dal/approve-post-day", () => ({
  planApproveDay: (...a: unknown[]) => planMock(...a),
  executeApproveDay: (...a: unknown[]) => executeMock(...a),
}));
vi.mock("@/lib/dal/safety-net", () => ({ runSafetyNet: (...a: unknown[]) => safetyNetMock(...a) }));
vi.mock("@/lib/dal/posted-day-sweep", () => ({ sweepPostedDays: (...a: unknown[]) => sweepMock(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: fromMock }) }));

import { runNightlySync, listConnectedShops } from "../nightly-sync";

const REALM = "9341455608740708";

beforeEach(() => {
  vi.clearAllMocks();
  settingsMock.mockResolvedValue({ realmId: REALM, settings: { shopTimezone: "America/New_York", autoPost: false } });
  reconMock.mockResolvedValue({ realmId: REALM, enqueuedPostings: 5, reviewCount: 2 });
  safetyNetMock.mockResolvedValue({ tekmetricChecked: 3, tekmetricGaps: 0, qboChecked: 2, qboGaps: 0 });
  reduceMock.mockResolvedValue({ realmId: REALM, events: 10, payments: 8 });
  warmMock.mockResolvedValue({ customers: 4 });
  warmRoMock.mockResolvedValue({ ros: 3 });
});

describe("runNightlySync", () => {
  it("refreshes the payment-state projection BEFORE reconciling (payments read the projection)", async () => {
    const r = await runNightlySync(7476, { businessDate: "2026-06-06" });
    // FULL reduce — the nightly is the verification net behind the incremental
    // page-view reduces (it recomputes everything + re-anchors the watermark).
    expect(reduceMock).toHaveBeenCalledWith(7476, { full: true });
    // Reduce MUST run before reconcile — else the day's payment drafts read a stale/empty projection.
    expect(Math.min(...reduceMock.mock.invocationCallOrder)).toBeLessThan(Math.min(...reconMock.mock.invocationCallOrder));
    expect(r.paymentStateReduced).toEqual({ events: 10, payments: 8 });
  });

  it("ISOLATES a reducer error — non-fatal; the SALE reconcile STILL runs (sales not blocked)", async () => {
    reduceMock.mockRejectedValueOnce(new Error("corrupt payment event"));
    const r = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(reconMock).toHaveBeenCalledWith(7476, "2026-06-06"); // sales NOT blocked by a bad payment
    expect(r.enqueued).toBe(5); // reconcile result preserved
    expect(r.paymentStateReduced).toBeNull(); // captured to Sentry, payment side degraded ALONE
  });

  it("reconciles + does NOT auto-post when auto_post is off", async () => {
    const r = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(reconMock).toHaveBeenCalledWith(7476, "2026-06-06");
    expect(planMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
    expect(r).toMatchObject({ connected: true, enqueued: 5, reviewItems: 2, autoPostEnabled: false, autoPosted: 0 });
  });

  it("auto-posts when auto_post is on (reuses plan → execute, hash-bound)", async () => {
    settingsMock.mockResolvedValue({ realmId: REALM, settings: { shopTimezone: "America/New_York", autoPost: true } });
    planMock.mockResolvedValue({ realmId: REALM, scopeHash: "H", summary: { jeCount: 5, totalCents: 1000, perType: [] } });
    executeMock.mockResolvedValue({ ok: true, posted: 5, failed: 0, skipped: 0, scopeHash: "H" });
    const r = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(planMock).toHaveBeenCalledWith(7476, "2026-06-06", "day");
    expect(executeMock).toHaveBeenCalledWith(7476, "2026-06-06", "day", "H", "cron@qteklink", {}, { client: undefined });
    expect(r).toMatchObject({ autoPostEnabled: true, autoPosted: 5, autoPostFailed: 0 });
  });

  it("auto_post on but nothing postable → no execute (no empty live write)", async () => {
    settingsMock.mockResolvedValue({ realmId: REALM, settings: { shopTimezone: "America/New_York", autoPost: true } });
    planMock.mockResolvedValue({ realmId: REALM, scopeHash: "H", summary: { jeCount: 0, totalCents: 0, perType: [] } });
    await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("no connection → reconcile no-op, never auto-posts", async () => {
    reconMock.mockResolvedValue({ realmId: null, enqueuedPostings: 0, reviewCount: 0 });
    const r = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(r.connected).toBe(false);
    expect(planMock).not.toHaveBeenCalled();
  });

  it("defaults businessDate to a shop-local YYYY-MM-DD prior day", async () => {
    await runNightlySync(7476);
    expect(reconMock).toHaveBeenCalledWith(7476, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("runs the 2-API safety-net, and a safety-net error is NON-FATAL (reconcile result kept)", async () => {
    const r = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(safetyNetMock).toHaveBeenCalledWith(7476, REALM, "2026-06-06", "America/New_York");
    expect(r.safetyNet).toMatchObject({ tekmetricChecked: 3, qboChecked: 2 });

    safetyNetMock.mockRejectedValueOnce(new Error("tekmetric down"));
    const r2 = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(r2.safetyNet).toBeNull(); // captured to Sentry, not thrown
    expect(r2.enqueued).toBe(5); // reconcile result preserved
  });

  it("warms the customer-name cache (nightly), BEFORE the posted-day sweep; a warming error is NON-FATAL", async () => {
    const r = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(warmMock).toHaveBeenCalledWith(7476, REALM);
    expect(r.customersWarmed).toBe(4);
    // warm runs before the sweep (so the sweep sees the names → posted days show as changed)
    expect(Math.min(...warmMock.mock.invocationCallOrder)).toBeLessThan(Math.min(...sweepMock.mock.invocationCallOrder));

    warmMock.mockRejectedValueOnce(new Error("tekmetric down"));
    const r2 = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(r2.customersWarmed).toBeNull(); // captured to Sentry, not thrown
    expect(r2.enqueued).toBe(5); // reconcile/sweep result preserved
  });

  it("warms the RO-number cache (nightly) so fleet/A-R check payments resolve their RO#; an error is NON-FATAL", async () => {
    const r = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(warmRoMock).toHaveBeenCalledWith(7476, REALM);
    expect(r.roNumbersWarmed).toBe(3);

    warmRoMock.mockRejectedValueOnce(new Error("tekmetric down"));
    const r2 = await runNightlySync(7476, { businessDate: "2026-06-06" });
    expect(r2.roNumbersWarmed).toBeNull(); // captured to Sentry, not thrown
    expect(r2.enqueued).toBe(5); // reconcile result preserved
  });
});

describe("listConnectedShops", () => {
  function chain(result: { data: unknown; error: unknown }) {
    const c: Record<string, unknown> = {};
    c.select = vi.fn(() => c);
    c.gt = vi.fn(() => c);
    c.then = (onF: (v: unknown) => unknown) => Promise.resolve(result).then(onF);
    return c;
  }
  it("returns DISTINCT shop ids with a non-expired connection", async () => {
    fromMock.mockReturnValue(chain({ data: [{ shop_id: 7476 }, { shop_id: 7476 }, { shop_id: 9000 }], error: null }));
    expect(await listConnectedShops()).toEqual([7476, 9000]);
    expect(fromMock).toHaveBeenCalledWith("qbo_connections");
  });

  it("throws (fail closed) on a DB error", async () => {
    fromMock.mockReturnValue(chain({ data: null, error: { message: "boom" } }));
    await expect(listConnectedShops()).rejects.toThrow(/listConnectedShops failed/);
  });
});
