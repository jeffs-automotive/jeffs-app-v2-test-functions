/**
 * Unit tests for the date-move queue DAL — detection (moved / back-on-day / unposted),
 * the upsert-changed → notify contract, the Date Change Alert recipients, and the
 * page-load `refreshDateMoves` wrapper. Supabase admin mocked (rpc by name, `from`
 * by queued result sets); notify + settings mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromResults: unknown[][] = [];
const sendMock = vi.fn();
const settingsMock = vi.fn();

function chainResolving(rows: unknown[]) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "gte"]) q[m] = vi.fn(() => q);
  (q as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    rpc: rpcMock,
    from: vi.fn(() => chainResolving(fromResults.shift() ?? [])),
  }),
}));
vi.mock("@/lib/dal/notify", () => ({ sendQteklinkEmail: (...a: unknown[]) => sendMock(...a) }));
vi.mock("@/lib/dal/settings", () => ({ getShopSettings: (...a: unknown[]) => settingsMock(...a) }));

import { detectDateMoves, notifyDateMoves, refreshDateMoves, type DateMoveRow } from "../date-moves";

const REALM = "9341455608740708";
const TZ = "America/New_York";

/** A posted sales daily row containing the given RO ids. */
const postedSales = (date: string, roIds: number[]) => ({
  business_date: date, posting_version: 1, action: "create", constituents: { ro_ids: roIds },
});
/** A sale-scan event row (newest-first ordering is the mock array order). */
const ev = (ro: number, kind: string, postedDate: string | null, num = String(ro)) => ({
  tekmetric_ro_id: ro, event_kind: kind,
  raw_body: { data: { id: ro, repairOrderNumber: num, postedDate, totalSales: 5000 } },
});

beforeEach(() => {
  vi.clearAllMocks();
  fromResults.length = 0;
  rpcMock.mockImplementation((fn: string) => {
    if (fn === "qbo_resolve_realm_for_shop") return Promise.resolve({ data: REALM, error: null });
    if (fn === "qteklink_upsert_date_move") return Promise.resolve({ data: [{ id: "mv-1", changed: true }], error: null });
    if (fn === "qteklink_resolve_date_move") return Promise.resolve({ data: true, error: null });
    return Promise.resolve({ data: null, error: null });
  });
  settingsMock.mockResolvedValue({
    realmId: REALM,
    settings: {
      dateChangeAlertEmails: ["om@shop.com", "sa1@shop.com", "sa2@shop.com"],
      dayCorrectionAlertEmails: ["om@shop.com"],
      shopTimezone: TZ,
    },
  });
});

describe("detectDateMoves", () => {
  it("an RO in a posted JE whose newest event is on a DIFFERENT day → upserts a pending move", async () => {
    fromResults.push([postedSales("2026-06-08", [101])]); // posted sales days
    fromResults.push([ev(101, "ro_posted", "2026-06-09T18:00:00Z")]); // newest event: June 9 (≠ 8)
    fromResults.push([]); // open moves
    const r = await detectDateMoves(7476, REALM, TZ);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_upsert_date_move", expect.objectContaining({
      p_tekmetric_ro_id: 101, p_original_business_date: "2026-06-08", p_new_business_date: "2026-06-09",
    }));
    expect(r.newOrChangedMoves).toHaveLength(1);
    expect(r.newOrChangedMoves[0]).toMatchObject({ originalBusinessDate: "2026-06-08", newBusinessDate: "2026-06-09" });
  });

  it("the RPC's changed=false (unchanged nightly re-detect) is NOT re-notified", async () => {
    rpcMock.mockImplementation((fn: string) =>
      fn === "qteklink_upsert_date_move"
        ? Promise.resolve({ data: [{ id: "mv-1", changed: false }], error: null })
        : Promise.resolve({ data: null, error: null }));
    fromResults.push([postedSales("2026-06-08", [101])]);
    fromResults.push([ev(101, "ro_posted", "2026-06-09T18:00:00Z")]);
    fromResults.push([]);
    const r = await detectDateMoves(7476, REALM, TZ);
    expect(r.newOrChangedMoves).toHaveLength(0);
  });

  it("an RO back ON its original day auto-RESOLVES the open move (the 'Check again' path)", async () => {
    fromResults.push([postedSales("2026-06-08", [101])]);
    fromResults.push([ev(101, "ro_posted", "2026-06-08T20:00:00Z")]); // back on June 8
    fromResults.push([{
      id: "mv-1", tekmetric_ro_id: 101, ro_number: "101", original_business_date: "2026-06-08",
      new_business_date: "2026-06-09", original_total_cents: null, new_total_cents: 5000,
      status: "pending", detected_at: "2026-06-10T01:00:00Z", approved_by: null, approved_at: null, resolved_at: null,
    }]);
    const r = await detectDateMoves(7476, REALM, TZ);
    expect(rpcMock).toHaveBeenCalledWith("qteklink_resolve_date_move", expect.objectContaining({ p_id: "mv-1" }));
    expect(r.autoResolved).toBe(1);
    expect(r.newOrChangedMoves).toHaveLength(0);
  });

  it("an UNPOSTED (not re-posted) RO is NOT a move — the correction sweep owns removals", async () => {
    fromResults.push([postedSales("2026-06-08", [101])]);
    fromResults.push([ev(101, "ro_unposted", "2026-06-08T20:00:00Z")]);
    fromResults.push([]);
    const r = await detectDateMoves(7476, REALM, TZ);
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_upsert_date_move", expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith("qteklink_resolve_date_move", expect.anything());
    expect(r.newOrChangedMoves).toHaveLength(0);
  });

  it("no posted sales days → nothing scanned", async () => {
    fromResults.push([]);
    const r = await detectDateMoves(7476, REALM, TZ);
    expect(r).toEqual({ scannedRos: 0, newOrChangedMoves: [], autoResolved: 0 });
  });
});

describe("notifyDateMoves", () => {
  const move: DateMoveRow = {
    id: "mv-1", tekmetricRoId: 101, roNumber: "152419",
    originalBusinessDate: "2026-06-08", newBusinessDate: "2026-06-09",
    originalTotalCents: null, newTotalCents: 5000, status: "pending",
    detectedAt: "2026-06-10T01:00:00Z", approvedBy: null, approvedAt: null, resolvedAt: null,
  };

  it("emails the Date Change Alert list with RO#, original date, new date", async () => {
    await notifyDateMoves(7476, [move]);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const arg = sendMock.mock.calls[0]![0] as { to: string[]; subject: string; text: string };
    expect(arg.to).toEqual(["om@shop.com", "sa1@shop.com", "sa2@shop.com"]);
    expect(arg.subject).toContain("Date Change Alert");
    expect(arg.subject).toContain("RO 152419");
    expect(arg.subject).toContain("2026-06-08");
    expect(arg.subject).toContain("2026-06-09");
    expect(arg.text).toContain("Originally posted on: 2026-06-08");
    expect(arg.text).toContain("Now posted on:        2026-06-09");
  });

  it("consolidates MULTIPLE moves into ONE email (count subject, every RO listed)", async () => {
    const moveB: DateMoveRow = {
      id: "mv-2", tekmetricRoId: 102, roNumber: "152420",
      originalBusinessDate: "2026-06-05", newBusinessDate: "2026-06-08",
      originalTotalCents: null, newTotalCents: 12800, status: "pending",
      detectedAt: "2026-06-10T01:00:00Z", approvedBy: null, approvedAt: null, resolvedAt: null,
    };
    await notifyDateMoves(7476, [move, moveB]);
    expect(sendMock).toHaveBeenCalledTimes(1); // ONE email for all moves, not one per RO
    const arg = sendMock.mock.calls[0]![0] as { subject: string; text: string };
    expect(arg.subject).toContain("2 repair orders changed dates");
    expect(arg.text).toContain("RO 152419");
    expect(arg.text).toContain("RO 152420");
    expect(arg.text).toContain("Now posted on:        2026-06-09");
    expect(arg.text).toContain("Now posted on:        2026-06-08");
  });

  it("no moves → no email", async () => {
    await notifyDateMoves(7476, []);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("refreshDateMoves (the page-load / Check-again path)", () => {
  it("resolves the realm, detects, and sends the Date Change Alert in one call", async () => {
    fromResults.push([postedSales("2026-06-08", [101])]); // posted sales days
    fromResults.push([ev(101, "ro_posted", "2026-06-09T18:00:00Z")]); // moved to June 9
    fromResults.push([]); // open moves
    const r = await refreshDateMoves(7476);
    expect(r?.newOrChangedMoves).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("returns null (no scan, no email) when QuickBooks isn't connected", async () => {
    rpcMock.mockImplementation(() => Promise.resolve({ data: null, error: null })); // realm resolves null
    expect(await refreshDateMoves(7476)).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });
});
