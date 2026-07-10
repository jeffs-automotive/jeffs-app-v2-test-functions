/**
 * Unit tests for the payroll RO-mirror ingest (the sync-ros.mjs port).
 *
 * - Pure transforms: payload → row mapping (mapRo/mapJob/mapLabor/mapPart), with a sample RO
 *   payload built from the script's per-level whitelists.
 * - Whitelist diffing: unknown keys → deduped alerts with level/keys/sample/occurrences.
 * - runMirrorIngest: one incremental happy path (watermark → two passes → parents-before-
 *   children upserts) + one unknown-key alert path (alert persisted via the RPC), plus the
 *   range mode contract (posted-date window; NO watermark read, watermark stays null).
 *
 * The Tekmetric pager + DB are injected via deps — no network, no admin client.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import {
  createAlertCollector,
  mapRo,
  mapJob,
  mapLabor,
  mapPart,
  runMirrorIngest,
  type MirrorDb,
  type IngestAlert,
} from "../mirror-ingest";
import type { TekmetricRoPage } from "@/lib/tekmetric/client";

const SHOP = 7476;

// ─── a sample RO payload lifted from the script's whitelists (every level present) ──────────

function sampleRo(): Record<string, unknown> {
  return {
    id: 153886,
    repairOrderNumber: 60123,
    shopId: SHOP,
    repairOrderStatus: { id: 5, code: "POSTED", name: "Posted", postedOrAccrecv: true },
    repairOrderLabel: { id: 9, code: "PU", name: "Picked Up", status: { id: 5, code: "POSTED", name: "Posted", postedOrAccrecv: true } },
    repairOrderCustomLabel: { name: "WAITER" },
    color: "#ff0000",
    appointmentId: 7001,
    customerId: 88001,
    technicianId: 501,
    serviceWriterId: 601,
    vehicleId: 99001,
    milesIn: 120000,
    milesOut: 120004,
    keytag: "A12",
    completedDate: "2026-07-03T18:00:00Z",
    postedDate: "2026-07-03T19:00:00Z",
    laborSales: 21380,
    partsSales: 10000,
    subletSales: 0,
    discountTotal: 500,
    feeTotal: 1234,
    taxes: 1890,
    amountPaid: 34004,
    totalSales: 34004,
    jobs: [
      {
        id: 700001,
        repairOrderId: 153886,
        vehicleId: 99001,
        customerId: 88001,
        name: "FLUID FLUSH 2",
        authorized: true,
        authorizedDate: "2026-07-03T15:00:00Z",
        selected: true,
        technicianId: 501,
        note: null,
        cannedJobId: 42,
        jobCategoryName: "FLUID FLUSHES",
        partsTotal: 10000,
        laborTotal: 21380,
        discountTotal: 500,
        feeTotal: 234,
        subtotal: 31380,
        archived: false,
        createdDate: "2026-07-03T14:00:00Z",
        completedDate: "2026-07-03T18:00:00Z",
        updatedDate: "2026-07-03T18:30:00Z",
        labor: [{ id: 800001, name: "Flush", rate: 18900, hours: 1.2, complete: true, technicianId: 501 }],
        parts: [
          {
            id: 900001, quantity: 1, brand: "ACME", name: "Coolant", partNumber: "C-1",
            description: "Premix", cost: 2500, retail: 5000, model: null, width: null, ratio: null,
            diameter: null, constructionType: null, loadIndex: null, loadRange: null,
            speedRating: null, mileageWarranty: null, runFlat: false, sideWallStyle: null,
            temperature: null, tireCategory: null, tireType: null, traction: null, treadwear: null,
            partType: { id: 1, code: "P", name: "Part" }, partStatus: { id: 2, code: "R", name: "Received" },
            dotNumbers: [],
          },
        ],
        fees: [{ id: 910001, name: "Shop Supplies", total: 234 }],
        discounts: [{ id: 920001, name: "Coupon", total: 500 }],
        laborHours: 1.2,
        loggedHours: 1.1,
        sort: 0,
      },
    ],
    sublets: [
      {
        id: 930001, name: "Alignment", vendor: { id: 10, name: "AlignCo", nickname: null, website: null, phone: null },
        authorized: true, authorizedDate: "2026-07-03T15:10:00Z", selected: true, note: null,
        items: [{ id: 940001, name: "4-wheel", cost: 4000, price: 8000, complete: true }],
        price: 8000, cost: 4000, repairOrderId: 153886, sort: 0, feeable: false, taxSublet: false,
        accountsPayable: { id: 11, amount: 4000, amountPaid: 4000, paymentDetails: null, paymentType: null },
      },
    ],
    fees: [{ id: 950001, name: "Haz Mat", total: 1000 }],
    discounts: [{ id: 960001, name: "Loyalty", total: 0 }],
    customerConcerns: [{ id: 970001, concern: "Coolant smell", techComment: "Flushed" }],
    createdDate: "2026-07-03T14:00:00Z",
    updatedDate: "2026-07-03T19:00:00Z",
    deletedDate: null,
    estimateShareDate: null,
    inspectionShareDate: null,
    invoiceShareDate: "2026-07-03T18:45:00Z",
    customerTimeOut: "2026-07-03T19:05:00Z",
    estimateUrl: "https://e", inspectionUrl: "https://i", invoiceUrl: "https://v",
    leadSource: "Repeat",
  };
}

// ─── pure transforms ─────────────────────────────────────────────────────────────────────────

describe("mapRo (payload → tekmetric_ros row)", () => {
  it("maps every level: cents columns, flattened status/label/customLabel, dates, raw passthrough", () => {
    const alerts = createAlertCollector();
    const ro = sampleRo();
    const row = mapRo(ro, SHOP, alerts);
    expect(row).toMatchObject({
      id: 153886,
      shop_id: SHOP,
      repair_order_number: 60123,
      customer_id: 88001,
      technician_id: 501,
      service_writer_id: 601,
      status_id: 5,
      status_code: "POSTED",
      status_posted_or_accrecv: true,
      label_id: 9,
      label_status_id: 5,
      custom_label_name: "WAITER",
      labor_sales_cents: 21380,
      parts_sales_cents: 10000,
      fee_total_cents: 1234,
      taxes_cents: 1890,
      total_sales_cents: 34004,
      created_date: "2026-07-03T14:00:00Z",
      updated_date: "2026-07-03T19:00:00Z",
      posted_date: "2026-07-03T19:00:00Z",
      deleted_date: null,
      lead_source: "Repeat",
    });
    expect(row.raw).toBe(ro); // untouched payload stored — nothing is ever lost
    expect(typeof row.synced_at).toBe("string");
    expect(alerts.list()).toEqual([]); // a fully-whitelisted payload raises NO alerts
  });

  it("missing fields → null, missing shopId → caller's shopId", () => {
    const alerts = createAlertCollector();
    const row = mapRo({ id: 1 }, SHOP, alerts);
    expect(row).toMatchObject({ id: 1, shop_id: SHOP, status_id: null, total_sales_cents: null, posted_date: null });
  });
});

describe("mapJob / mapLabor / mapPart", () => {
  it("maps the authorized flag, category, hours, and per-line technician attribution", () => {
    const alerts = createAlertCollector();
    const ro = sampleRo();
    const job = (ro.jobs as Record<string, unknown>[])[0]!;
    const jobRow = mapJob(job, 153886, SHOP, alerts);
    expect(jobRow).toMatchObject({
      id: 700001, ro_id: 153886, shop_id: SHOP,
      authorized: true, job_category_name: "FLUID FLUSHES", technician_id: 501,
      labor_hours: 1.2, logged_hours: 1.1,
      parts_total_cents: 10000, labor_total_cents: 21380, subtotal_cents: 31380,
    });
    const laborRow = mapLabor((job.labor as Record<string, unknown>[])[0]!, 700001, 153886, alerts);
    expect(laborRow).toEqual({
      id: 800001, job_id: 700001, ro_id: 153886,
      name: "Flush", rate_cents: 18900, hours: 1.2, complete: true, technician_id: 501,
    });
    const partRow = mapPart((job.parts as Record<string, unknown>[])[0]!, 700001, 153886, alerts);
    expect(partRow).toMatchObject({
      id: 900001, job_id: 700001, ro_id: 153886,
      cost_cents: 2500, retail_cents: 5000,
      part_type_id: 1, part_status_code: "R",
      dot_numbers: null, // empty array normalizes to null
    });
    expect(alerts.list()).toEqual([]);
  });
});

describe("whitelist diffing (createAlertCollector)", () => {
  it("flags unknown keys with level + sorted keys + first-seen sample, dedupes by occurrence", () => {
    const alerts = createAlertCollector();
    alerts.checkKeys("ro", { id: 1, zNewField: "x", aNewField: 2 }, 1);
    alerts.checkKeys("ro", { id: 2, zNewField: "y", aNewField: 3 }, 2); // same shape → occurrence bump
    alerts.checkKeys("labor", { id: 3, surprise: true }, 2);
    const list = alerts.list();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      level: "ro",
      keys: ["aNewField", "zNewField"], // sorted
      ro_id: 1, // first RO seen
      sample: { aNewField: 2, zNewField: "x" }, // first-seen values
      occurrences: 2,
    });
    expect(list[1]).toMatchObject({ level: "labor", keys: ["surprise"], ro_id: 2, occurrences: 1 });
  });

  it("null/undefined objects and fully-known objects raise nothing", () => {
    const alerts = createAlertCollector();
    alerts.checkKeys("status", null, 1);
    alerts.checkKeys("status", undefined, 1);
    alerts.checkKeys("status", { id: 5, code: "P", name: "Posted", postedOrAccrecv: true }, 1);
    expect(alerts.list()).toEqual([]);
  });
});

// ─── db + pager mocks for runMirrorIngest ────────────────────────────────────────────────────

interface DbCall { op: string; table: string; rows?: Record<string, unknown>[]; }

function makeDbMock(watermark: { created: string | null; updated: string | null }) {
  const calls: DbCall[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const writeErrors = new Map<string, { message: string }>(); // table → error to return on insert/upsert

  const db: MirrorDb = {
    from(table: string) {
      return {
        upsert(rows: Record<string, unknown>[]) {
          calls.push({ op: "upsert", table, rows });
          return Promise.resolve({ error: writeErrors.get(table) ?? null });
        },
        insert(rows: Record<string, unknown>[]) {
          calls.push({ op: "insert", table, rows });
          return Promise.resolve({ error: writeErrors.get(table) ?? null });
        },
        delete() {
          return {
            in() {
              calls.push({ op: "delete", table });
              return Promise.resolve({ error: null });
            },
          };
        },
        select(col: string) {
          return {
            eq() {
              return {
                not() {
                  return {
                    order() {
                      return {
                        limit() {
                          calls.push({ op: "select", table: `${table}.${col}` });
                          const v = col === "created_date" ? watermark.created : watermark.updated;
                          return Promise.resolve({ data: v ? [{ [col]: v }] : [], error: null });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ error: null });
    },
  };
  return { db, calls, rpcCalls, writeErrors };
}

function onePagePager(ros: Record<string, unknown>[]) {
  const queries: Record<string, string | number>[] = [];
  async function* pager(_shopId: number, query: Record<string, string | number>): AsyncGenerator<TekmetricRoPage> {
    queries.push(query);
    // Only the FIRST pass yields content (the updated-since pass is empty) — keeps counts crisp.
    if (queries.length === 1) yield { page: 0, content: ros, totalPages: 1, last: true };
  }
  return { pager, queries };
}

// ─── runMirrorIngest ─────────────────────────────────────────────────────────────────────────

describe("runMirrorIngest (incremental)", () => {
  it("happy path: watermark −24h since-date, created+updated passes, parents before children, counts", async () => {
    const { db, calls, rpcCalls } = makeDbMock({ created: "2026-07-08T12:00:00Z", updated: "2026-07-09T09:30:00Z" });
    const { pager, queries } = onePagePager([sampleRo()]);

    const r = await runMirrorIngest({ shopId: SHOP, db, pageRos: pager }, { mode: "incremental" });

    // watermark: newest of created/updated (2026-07-09) minus 24h → 2026-07-08
    expect(r.watermark).toBe("2026-07-08");
    // two passes with the script's exact query params
    // (Tekmetric requires ZonedDateTime for date filters — live-verified 2026-07-10)
    expect(queries).toEqual([
      { start: "2026-07-08T00:00:00Z" },
      { updatedDateStart: "2026-07-08T00:00:00Z" },
    ]);
    expect(r).toMatchObject({ rosUpserted: 1, pagesFetched: 1, alerts: [] });
    expect(rpcCalls).toEqual([]); // clean run → nothing to persist

    // upsert order: parent tekmetric_ros UPSERT first, then child deletes, then child inserts
    const writes = calls.filter((c) => c.op !== "select");
    expect(writes[0]).toMatchObject({ op: "upsert", table: "tekmetric_ros" });
    const deleteTables = writes.filter((c) => c.op === "delete").map((c) => c.table);
    expect(deleteTables).toEqual([
      "tekmetric_ro_jobs", "tekmetric_ro_fees", "tekmetric_ro_discounts",
      "tekmetric_ro_customer_concerns", "tekmetric_ro_sublets",
    ]);
    const firstInsertIdx = writes.findIndex((c) => c.op === "insert");
    const lastDeleteIdx = writes.map((c) => c.op).lastIndexOf("delete");
    expect(lastDeleteIdx).toBeLessThan(firstInsertIdx); // delete-then-insert
    // every child level landed
    const insertTables = writes.filter((c) => c.op === "insert").map((c) => c.table);
    expect(insertTables).toEqual(expect.arrayContaining([
      "tekmetric_ro_jobs", "tekmetric_ro_job_labor", "tekmetric_ro_job_parts",
      "tekmetric_ro_job_fees", "tekmetric_ro_job_discounts", "tekmetric_ro_fees",
      "tekmetric_ro_discounts", "tekmetric_ro_customer_concerns", "tekmetric_ro_sublets",
      "tekmetric_ro_sublet_items",
    ]));
  });

  it("unknown-key alert path: alert returned AND persisted via record_tekmetric_ingest_alert", async () => {
    const { db, rpcCalls } = makeDbMock({ created: "2026-07-08T12:00:00Z", updated: null });
    const ro = sampleRo();
    (ro as Record<string, unknown>).brandNewTekmetricField = { surprise: 1 }; // not in the ro whitelist
    const { pager } = onePagePager([ro]);

    const r = await runMirrorIngest({ shopId: SHOP, db, pageRos: pager }, { mode: "incremental" });

    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({
      level: "ro",
      keys: ["brandNewTekmetricField"],
      ro_id: 153886,
      sample: { brandNewTekmetricField: { surprise: 1 } },
      occurrences: 1,
    });
    expect(rpcCalls).toEqual([
      {
        fn: "record_tekmetric_ingest_alert",
        args: {
          p_level: "ro",
          p_unknown_keys: ["brandNewTekmetricField"],
          p_ro_id: 153886,
          p_sample: { brandNewTekmetricField: { surprise: 1 } },
        },
      },
    ]);
    expect(r.rosUpserted).toBe(1); // the row still lands — alerting never drops data
  });

  it("insert error (type surprise) → insert_error alert; the run continues and reports it", async () => {
    const { db, writeErrors } = makeDbMock({ created: "2026-07-08T12:00:00Z", updated: null });
    writeErrors.set("tekmetric_ro_job_labor", { message: 'invalid input syntax for type numeric: "abc"' });
    const { pager } = onePagePager([sampleRo()]);

    const r = await runMirrorIngest({ shopId: SHOP, db, pageRos: pager }, { mode: "incremental" });

    const alert = r.alerts.find((a: IngestAlert) => a.level === "insert_error");
    expect(alert).toMatchObject({ keys: ["tekmetric_ro_job_labor"], ro_id: 153886 });
    expect((alert!.sample.error as string)).toContain("invalid input syntax");
    expect(r.rosUpserted).toBe(1); // parent + other children still landed
  });

  it("empty mirror → throws (a backfill must seed it; never a silent no-op)", async () => {
    const { db } = makeDbMock({ created: null, updated: null });
    const { pager } = onePagePager([]);
    await expect(runMirrorIngest({ shopId: SHOP, db, pageRos: pager }, { mode: "incremental" }))
      .rejects.toThrow(/empty tekmetric_ros mirror/);
  });
});

describe("runMirrorIngest (range — the per-run refresh action)", () => {
  it("pages by posted-date window only; NO watermark read; watermark stays null", async () => {
    const { db, calls } = makeDbMock({ created: "2026-07-08T12:00:00Z", updated: null });
    const { pager, queries } = onePagePager([sampleRo()]);

    const r = await runMirrorIngest(
      { shopId: SHOP, db, pageRos: pager },
      { mode: "range", postedDateStart: "2026-06-28", postedDateEnd: "2026-07-11" },
    );

    expect(queries).toEqual([
      { postedDateStart: "2026-06-28T00:00:00Z", postedDateEnd: "2026-07-11T23:59:59Z" },
    ]);
    expect(r.watermark).toBeNull(); // range mode never touches the incremental watermark
    expect(calls.filter((c) => c.op === "select")).toEqual([]); // no watermark query at all
    expect(r).toMatchObject({ rosUpserted: 1, pagesFetched: 1 });
  });

  it("rejects non-ISO range bounds (they go straight into the Tekmetric query string)", async () => {
    const { db } = makeDbMock({ created: null, updated: null });
    const { pager } = onePagePager([]);
    await expect(
      runMirrorIngest({ shopId: SHOP, db, pageRos: pager }, { mode: "range", postedDateStart: "junk", postedDateEnd: "2026-07-11" }),
    ).rejects.toThrow(/ISO YYYY-MM-DD/);
  });
});
