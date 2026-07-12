/**
 * dry-run-diff.ts unit tests (round-7 #42) — the pure before→after diff builder,
 * fed synthetic snapshot views:
 *   - identical snapshots → changed=false, every group empty, as-of stamps carried;
 *   - per-tech billed hours: only tech-family employees, only the CHANGED weeks,
 *     null→number counts as a change, non-tech families never appear;
 *   - month derivations from the loose provenance + per-SA spiff counts;
 *   - per-employee total-pay deltas, matched by employee_id with a missing side
 *     reporting null (roster drift never crashes);
 *   - unchanged fields are OMITTED everywhere (the "only fields that changed" rule).
 */
import { describe, expect, it } from "vitest";
import { buildDryRunDiff, type DryRunSnapshotView } from "../dry-run-diff";

const TECH_ID = "11111111-1111-4111-8111-111111111111";
const SA_ID = "22222222-2222-4222-8222-222222222222";
const SUPPORT_ID = "33333333-3333-4333-8333-333333333333";

type EmployeeView = DryRunSnapshotView["employees"][number];
type SummaryRowView = DryRunSnapshotView["summary"][number];

function employee(over: Partial<EmployeeView> = {}): EmployeeView {
  return {
    employee_id: TECH_ID,
    display_name: "Nick Trilli",
    family: "technician",
    derived: { billed_hours_w1: 40, billed_hours_w2: 55.05, spiff_count: null },
    ...over,
  };
}

function summaryRow(over: Partial<SummaryRowView> = {}): SummaryRowView {
  return {
    employee_id: TECH_ID,
    display_name: "Nick Trilli",
    total_pay_cents: 250_000,
    ...over,
  };
}

function snap(over: Partial<DryRunSnapshotView> = {}): DryRunSnapshotView {
  return {
    employees: [employee()],
    summary: [summaryRow()],
    derived_provenance: {
      as_of: "2026-07-11T04:00:00Z",
      month_sales_cents: 27_306_113,
      month_fees_cents: 1_322_963,
      month_parts_cost_cents: 6_937_090,
      month_gp_with_fees_cents: 16_817_914,
      month_gp_without_fees_cents: 15_494_951,
      month_qbo_tech_cost_cents: 4_874_072,
      month_shop_billed_hours: 1_100.5,
    },
    ...over,
  };
}

describe("buildDryRunDiff", () => {
  it("identical snapshots → changed=false, empty groups, as-of stamps carried", () => {
    const diff = buildDryRunDiff(snap(), snap({
      derived_provenance: { ...snap().derived_provenance, as_of: "2026-07-11T16:00:00Z" },
    }));
    expect(diff.changed).toBe(false);
    expect(diff.techHours).toEqual([]);
    expect(diff.month).toEqual([]);
    expect(diff.payTotals).toEqual([]);
    expect(diff.beforeAsOf).toBe("2026-07-11T04:00:00Z");
    expect(diff.afterAsOf).toBe("2026-07-11T16:00:00Z");
  });

  it("per-tech billed hours: only the changed week, tech families only, null→number counts", () => {
    const before = snap({
      employees: [
        employee(), // tech: w2 changes below
        employee({
          employee_id: SUPPORT_ID,
          display_name: "Sam Bream",
          family: "support",
          derived: { billed_hours_w1: null, billed_hours_w2: null, spiff_count: null },
        }),
      ],
    });
    const after = snap({
      employees: [
        employee({ derived: { billed_hours_w1: 40, billed_hours_w2: 57.2, spiff_count: null } }),
        employee({
          employee_id: SUPPORT_ID,
          display_name: "Sam Bream",
          family: "support",
          // even if a support row somehow carried hours, the family gate excludes it
          derived: { billed_hours_w1: 5, billed_hours_w2: null, spiff_count: null },
        }),
      ],
    });
    const diff = buildDryRunDiff(before, after);
    expect(diff.changed).toBe(true);
    expect(diff.techHours).toEqual([
      {
        employeeId: TECH_ID,
        displayName: "Nick Trilli",
        fields: [
          { key: "billed_hours_w2", label: "Billed hours W2", kind: "hours", before: 55.05, after: 57.2 },
        ],
      },
    ]);

    // null → number is a change (a tech's Tekmetric id linked mid-period)
    const nullBefore = snap({
      employees: [employee({ derived: { billed_hours_w1: null, billed_hours_w2: null, spiff_count: null } })],
    });
    const d2 = buildDryRunDiff(nullBefore, snap());
    expect(d2.techHours[0]?.fields).toEqual([
      { key: "billed_hours_w1", label: "Billed hours W1", kind: "hours", before: null, after: 40 },
      { key: "billed_hours_w2", label: "Billed hours W2", kind: "hours", before: null, after: 55.05 },
    ]);
  });

  it("month derivations diff out of the loose provenance — only changed keys, labeled", () => {
    const after = snap({
      derived_provenance: {
        ...snap().derived_provenance,
        as_of: "2026-07-11T16:00:00Z",
        month_sales_cents: 27_400_000,
        month_gp_with_fees_cents: 16_900_000,
        month_qbo_tech_cost_cents: null, // number → null (QBO fell to the computed fallback)
      },
    });
    const diff = buildDryRunDiff(snap(), after);
    expect(diff.month).toEqual([
      { key: "month_sales_cents", label: "Month sales", kind: "cents", before: 27_306_113, after: 27_400_000 },
      { key: "month_gp_with_fees_cents", label: "GP with fees", kind: "cents", before: 16_817_914, after: 16_900_000 },
      { key: "month_qbo_tech_cost_cents", label: "QBO technician cost", kind: "cents", before: 4_874_072, after: null },
    ]);
  });

  it("per-SA spiff counts join the month group with a named label", () => {
    const sa = (count: number | null) =>
      employee({
        employee_id: SA_ID,
        display_name: "Katie Aube",
        family: "service_advisor",
        derived: { billed_hours_w1: null, billed_hours_w2: null, spiff_count: count },
      });
    const diff = buildDryRunDiff(
      snap({ employees: [sa(12)] }),
      snap({ employees: [sa(14)] }),
    );
    expect(diff.month).toEqual([
      { key: `spiff_count:${SA_ID}`, label: "Spiffs — Katie Aube", kind: "count", before: 12, after: 14 },
    ]);
  });

  it("pay totals: per-employee deltas keyed by employee_id; a missing side reads null", () => {
    const before = snap({
      summary: [summaryRow(), summaryRow({ employee_id: SA_ID, display_name: "Katie Aube", total_pay_cents: 300_000 })],
    });
    const after = snap({
      employees: [employee(), employee({ employee_id: SA_ID, display_name: "Katie Aube", family: "service_advisor" })],
      summary: [summaryRow({ total_pay_cents: 262_400 })], // Katie dropped off the after roster
    });
    const diff = buildDryRunDiff(before, after);
    expect(diff.payTotals).toEqual([
      { key: TECH_ID, label: "Nick Trilli", kind: "cents", before: 250_000, after: 262_400 },
      { key: SA_ID, label: "Katie Aube", kind: "cents", before: 300_000, after: null },
    ]);
    expect(diff.changed).toBe(true);
  });
});
