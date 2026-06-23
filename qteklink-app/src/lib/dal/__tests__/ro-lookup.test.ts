/**
 * Unit tests for lookupRoMeta — repairOrderNumber + customerId per RO, two-source
 * (qteklink_events then keytag firehose), with the body-shopId guard. DB mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fromMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: fromMock }) }));
vi.mock("@/lib/events/kinds", () => ({ RO_SALE_SCAN_EVENT_KINDS: ["ro_posted", "ro_sent_to_ar"] }));

import { lookupRoMeta } from "../ro-lookup";

function chainOf(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) chain[m] = vi.fn(() => chain);
  chain.then = (onF: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(onF);
  return chain;
}

let eventRows: unknown[] = [];
let keytagRows: unknown[] = [];
let roCacheRows: unknown[] = [];
function routeFrom(table: string) {
  if (table === "qteklink_events") return chainOf(eventRows);
  if (table === "keytag_webhook_events") return chainOf(keytagRows);
  if (table === "qteklink_ros") return chainOf(roCacheRows);
  return chainOf([]);
}

describe("lookupRoMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventRows = [];
    keytagRows = [];
    roCacheRows = [];
    fromMock.mockImplementation(routeFrom);
  });

  it("resolves repairOrderNumber + customerId from qteklink_events; skips a wrong-shop body", async () => {
    eventRows = [
      { tekmetric_ro_id: 100, raw_body: { data: { repairOrderNumber: 153330, customerId: 44695835, shopId: 7476 } } },
      { tekmetric_ro_id: 200, raw_body: { data: { repairOrderNumber: 999, customerId: 1, shopId: 1111 } } }, // wrong shop
    ];
    const m = await lookupRoMeta(7476, "realm", [100, 200]);
    expect(m.get(100)).toEqual({ repairOrderNumber: "153330", customerId: 44695835 });
    expect(m.has(200)).toBe(false); // never harvest across shops
  });

  it("falls back to the keytag firehose for a field qteklink_events left null", async () => {
    eventRows = [{ tekmetric_ro_id: 100, raw_body: { data: { repairOrderNumber: 153330, shopId: 7476 } } }]; // no customerId
    keytagRows = [{ tekmetric_ro_id: 100, raw_body: { data: { customerId: 44695835, shopId: 7476 } } }];
    const m = await lookupRoMeta(7476, "realm", [100]);
    expect(m.get(100)).toEqual({ repairOrderNumber: "153330", customerId: 44695835 });
  });

  it("returns empty for no ids without a DB call", async () => {
    const m = await lookupRoMeta(7476, "realm", []);
    expect(m.size).toBe(0);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("FINAL fallback: fills repairOrderNumber from the qteklink_ros cache when both event sources miss (fleet/A-R check)", async () => {
    // Neither qteklink_events nor the keytag firehose carry the number for this fleet RO.
    roCacheRows = [{ tekmetric_ro_id: 300, repair_order_number: "152777" }];
    const m = await lookupRoMeta(7476, "realm", [300]);
    expect(m.get(300)).toEqual({ repairOrderNumber: "152777", customerId: null });
  });

  it("the cache NEVER overrides a repairOrderNumber already found in the event ledgers", async () => {
    eventRows = [{ tekmetric_ro_id: 100, raw_body: { data: { repairOrderNumber: 153330, customerId: 44695835, shopId: 7476 } } }];
    roCacheRows = [{ tekmetric_ro_id: 100, repair_order_number: "999999" }]; // stale/other — must not win
    const m = await lookupRoMeta(7476, "realm", [100]);
    expect(m.get(100)).toEqual({ repairOrderNumber: "153330", customerId: 44695835 });
  });
});
