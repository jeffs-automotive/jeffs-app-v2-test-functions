/**
 * QBO P&L technician-cost tests (round-5 decision #38): the PURE parser over
 * synthetic ProfitAndLoss JSON (6010 row present / absent / renamed / ambiguous,
 * id- vs label-matching, amount parsing) + the thin fetcher's wiring (realm
 * gate, mirror-fed account id, query params, NO silent fallback — every
 * surprise throws; the payroll DAL owns the single sanctioned catch).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { requestMock, clientCtorSpy, resolveRealmMock, adminQueryMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  clientCtorSpy: vi.fn(),
  resolveRealmMock: vi.fn(),
  adminQueryMock: vi.fn(),
}));

vi.mock("@/lib/qbo/client", () => ({
  QboClient: class {
    constructor(opts: unknown) {
      clientCtorSpy(opts);
    }
    request(...args: unknown[]) {
      return requestMock(...args);
    }
  },
}));
vi.mock("@/lib/dal/realm", () => ({
  resolveRealmForShop: (...args: unknown[]) => resolveRealmMock(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
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
  }),
}));

import {
  parsePnlTechnicianCostCents,
  qboMonthTechnicianCostCents,
  type PnlReport,
  type PnlRow,
} from "@/lib/qbo/reports";

// ── Synthetic report builders (the wire tree nests account rows under Sections) ──

const dataRow = (label: string, amount: string | null, id?: string): PnlRow => ({
  type: "Data",
  ColData: [{ value: label, ...(id ? { id } : {}) }, ...(amount === null ? [] : [{ value: amount }])],
});

const section = (title: string, group: string, children: PnlRow[], total: string): PnlRow => ({
  type: "Section",
  group,
  Header: { ColData: [{ value: title }] },
  Rows: { Row: children },
  Summary: { ColData: [{ value: `Total ${title}` }, { value: total }] },
});

const report = (rows: PnlRow[]): PnlReport => ({ Rows: { Row: rows } });

/** June-2026-shaped fixture: income + COGS (with the 6010 row) + GrossProfit. */
const juneReport = report([
  section(
    "Income",
    "Income",
    [dataRow("400 Sales", "274049.43", "40"), dataRow("409 Shop Supplies", "12802.82", "41")],
    "286852.25",
  ),
  section(
    "Cost of Goods Sold",
    "COGS",
    [dataRow("5010 Parts", "65248.16", "80"), dataRow("6010 Technicians", "48740.72", "85")],
    "113988.88",
  ),
  { type: "Data", group: "GrossProfit", ColData: [{ value: "Gross Profit" }, { value: "172863.37" }] },
]);

describe("parsePnlTechnicianCostCents — the pure parser", () => {
  it("finds the 6010 row under COGS and returns integer cents (June: 48740.72 → 4,874,072)", () => {
    const m = parsePnlTechnicianCostCents(juneReport);
    expect(m.cents).toBe(4_874_072);
    expect(m.label).toBe("6010 Technicians");
    expect(m.matchedBy).toBe("label");
  });

  it("prefers the mirror-fed account id when supplied (matchedBy 'account_id')", () => {
    const m = parsePnlTechnicianCostCents(juneReport, { accountId: "85" });
    expect(m.cents).toBe(4_874_072);
    expect(m.matchedBy).toBe("account_id");
  });

  it("a RENAMED account still matches by the mirror id (the re-mapped-chart case)", () => {
    const renamed = report([
      section("Cost of Goods Sold", "COGS", [dataRow("Wrenching Crew", "100.00", "85")], "100.00"),
    ]);
    const m = parsePnlTechnicianCostCents(renamed, { accountId: "85" });
    expect(m.cents).toBe(10_000);
    expect(m.label).toBe("Wrenching Crew");
    expect(m.matchedBy).toBe("account_id");
  });

  it("matches the bare NAME variant (no account number in the label)", () => {
    const r = report([section("Cost of Goods Sold", "COGS", [dataRow("Technicians", "1.00")], "1.00")]);
    expect(parsePnlTechnicianCostCents(r).cents).toBe(100);
  });

  it("the number match is word-bounded — '6010-1 Subcontract' does NOT match", () => {
    const r = report([
      section("Cost of Goods Sold", "COGS", [dataRow("6010-1 Subcontract", "1.00")], "1.00"),
    ]);
    expect(() => parsePnlTechnicianCostCents(r)).toThrow(/no row matching account 6010/);
  });

  it("finds the row nested under sub-account Sections (depth-first walk)", () => {
    const nested = report([
      section(
        "Cost of Goods Sold",
        "COGS",
        [section("Labor Costs", "", [dataRow("6010 Technicians", "48740.72", "85")], "48740.72")],
        "113988.88",
      ),
    ]);
    expect(parsePnlTechnicianCostCents(nested).cents).toBe(4_874_072);
  });

  it("THROWS when the row is absent (no silent fallback)", () => {
    const r = report([section("Cost of Goods Sold", "COGS", [dataRow("5010 Parts", "1.00")], "1.00")]);
    expect(() => parsePnlTechnicianCostCents(r)).toThrow(/no row matching account 6010 "Technicians"/);
  });

  it("THROWS on an empty/shape-surprising report", () => {
    expect(() => parsePnlTechnicianCostCents({} as PnlReport)).toThrow(/no account rows/);
    expect(() => parsePnlTechnicianCostCents(report([]))).toThrow(/no account rows/);
  });

  it("THROWS on an ambiguous label match — refuses to guess", () => {
    const r = report([
      section(
        "Cost of Goods Sold",
        "COGS",
        [dataRow("6010 Technicians", "1.00"), dataRow("6015 Technicians Overtime", "2.00")],
        "3.00",
      ),
    ]);
    expect(() => parsePnlTechnicianCostCents(r)).toThrow(/refusing to guess/);
  });

  it("THROWS when the mirror id and the label match point at DIFFERENT rows", () => {
    const r = report([
      section(
        "Cost of Goods Sold",
        "COGS",
        [dataRow("Renamed Cost", "1.00", "99"), dataRow("6010 Technicians", "2.00", "85")],
        "3.00",
      ),
    ]);
    expect(() => parsePnlTechnicianCostCents(r, { accountId: "99" })).toThrow(/changed shape/);
  });

  it("parses comma-grouped and negative amounts", () => {
    const commas = report([
      section("Cost of Goods Sold", "COGS", [dataRow("6010 Technicians", "48,740.72")], "x"),
    ]);
    expect(parsePnlTechnicianCostCents(commas).cents).toBe(4_874_072);
    const negative = report([
      section("Cost of Goods Sold", "COGS", [dataRow("6010 Technicians", "-10.50")], "x"),
    ]);
    expect(parsePnlTechnicianCostCents(negative).cents).toBe(-1_050);
  });

  it("THROWS on a missing or non-numeric amount cell", () => {
    const noAmount = report([
      section("Cost of Goods Sold", "COGS", [dataRow("6010 Technicians", null)], "x"),
    ]);
    expect(() => parsePnlTechnicianCostCents(noAmount)).toThrow(/no amount column/);
    const junk = report([
      section("Cost of Goods Sold", "COGS", [dataRow("6010 Technicians", "N/A")], "x"),
    ]);
    expect(() => parsePnlTechnicianCostCents(junk)).toThrow(/not numeric/);
  });
});

describe("qboMonthTechnicianCostCents — the thin fetcher", () => {
  beforeEach(() => {
    requestMock.mockReset();
    clientCtorSpy.mockReset();
    resolveRealmMock.mockReset();
    adminQueryMock.mockReset();
    resolveRealmMock.mockResolvedValue("R123");
    adminQueryMock.mockResolvedValue({ data: [{ qbo_account_id: "85" }], error: null });
    requestMock.mockResolvedValue(juneReport);
  });

  it("resolves the realm, feeds the mirror id, requests the month's Accrual P&L, returns cents", async () => {
    const res = await qboMonthTechnicianCostCents(7476, "2026-06");
    expect(res).toEqual({
      valueCents: 4_874_072,
      accountLabel: "6010 Technicians",
      matchedBy: "account_id",
      realmId: "R123",
    });
    expect(clientCtorSpy).toHaveBeenCalledWith({ realmId: "R123" });
    expect(requestMock).toHaveBeenCalledWith("GET", "reports/ProfitAndLoss", {
      query: { start_date: "2026-06-01", end_date: "2026-06-30", accounting_method: "Accrual" },
    });
  });

  it("throws when the shop has no QBO connection", async () => {
    resolveRealmMock.mockResolvedValue(null);
    await expect(qboMonthTechnicianCostCents(7476, "2026-06")).rejects.toThrow(/not connected/);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("throws on a qbo_accounts lookup DB error (never silently degrades to label-only)", async () => {
    adminQueryMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(qboMonthTechnicianCostCents(7476, "2026-06")).rejects.toThrow(
      /qbo_accounts lookup failed: boom/,
    );
  });

  it("an empty mirror degrades to the label match (matchedBy 'label')", async () => {
    adminQueryMock.mockResolvedValue({ data: [], error: null });
    const res = await qboMonthTechnicianCostCents(7476, "2026-06");
    expect(res.matchedBy).toBe("label");
    expect(res.valueCents).toBe(4_874_072);
  });

  it("bubbles the parse error when the report has no 6010 row (no silent fallback here)", async () => {
    requestMock.mockResolvedValue(report([section("Income", "Income", [dataRow("400 Sales", "1.00")], "1.00")]));
    await expect(qboMonthTechnicianCostCents(7476, "2026-06")).rejects.toThrow(/no row matching/);
  });

  it("rejects a malformed month before touching the network", async () => {
    await expect(qboMonthTechnicianCostCents(7476, "June 2026")).rejects.toThrow(/YYYY-MM/);
    expect(resolveRealmMock).not.toHaveBeenCalled();
  });
});
