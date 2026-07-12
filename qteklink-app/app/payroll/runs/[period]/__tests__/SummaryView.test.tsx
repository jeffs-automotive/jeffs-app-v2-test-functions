/**
 * SummaryView + PayrollTotalsCard tests (extracted from ../__tests__/
 * run-detail.test.tsx for the ~500-line file policy): the self-describing print
 * header per run status, the leave hours+dollars stacked cells (extraction
 * #31), and the round-9 #46 totals card — grouped Pay/Hours/Metrics values from
 * the snapshot's server-computed block, the REMOVED table TOTAL row (an
 * APPROVED contract change, not test weakening), and the old-frozen-snapshot
 * fallback note (the card renders ONLY when the block exists; nothing is
 * summed client-side).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import type { SummaryRow } from "@/lib/payroll/types";
import { buildRunTotals } from "@/lib/payroll/summary";
import { SummaryView } from "../SummaryView";

const EMP_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

const summaryRow: SummaryRow = {
  employee_id: EMP_ID,
  display_name: "Cantrell",
  role: "technician",
  family: "technician",
  reg_hours: 80,
  ot_hours: 2,
  reg_pay_cents: 216_879,
  ot_pay_cents: 7_839,
  billed_hours: 70,
  billed_pay_cents: 70_000,
  incentive_cents: 70_000,
  bonus_cents: null,
  spiff_cents: null,
  pto_hours: 0,
  pto_pay_cents: null,
  training_hours: 0,
  training_pay_cents: null,
  holiday_hours: 0,
  holiday_pay_cents: null,
  bereavement_hours: 0,
  bereavement_pay_cents: null,
  total_pay_cents: 294_718,
};

/** Base props: totals built from the same rows (what the DAL snapshot carries). */
function baseProps(rows: SummaryRow[] = [summaryRow]) {
  return {
    rows,
    totals: buildRunTotals(rows),
    shopId: 7476,
    periodStart: "2026-06-28",
    periodEnd: "2026-07-11",
  };
}

// ── The self-describing print header ───────────────────────────────────────────

describe("SummaryView print header", () => {
  it("labels a completed run's sheet as the keyable record with its completion date", () => {
    render(<SummaryView {...baseProps()} status="completed" completedAt="2026-07-12T14:00:00Z" />);
    expect(
      screen.getByText(/Completed .*— for keying into the payroll system/),
    ).toBeInTheDocument();
  });

  it("labels a voided run's sheet as an archival copy — never as keyable", () => {
    render(<SummaryView {...baseProps()} status="voided" completedAt="2026-07-12T14:00:00Z" />);
    expect(
      screen.getByText(/VOIDED — archival copy, do not key into the payroll system/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/for keying into the payroll system/)).not.toBeInTheDocument();
  });

  it("labels an open run's sheet as a draft — never as keyable", () => {
    render(<SummaryView {...baseProps()} status="open" completedAt={null} />);
    expect(screen.getByText(/DRAFT — run not completed/)).toBeInTheDocument();
    expect(screen.queryByText(/for keying into the payroll system/)).not.toBeInTheDocument();
  });
});

// ── Leave hours + dollars (extraction #31) ─────────────────────────────────────

describe("SummaryView leave cells", () => {
  it("renders leave-pay dollars alongside hours for a paid-leave (technician) row", () => {
    const techLeave: SummaryRow = {
      ...summaryRow,
      pto_hours: 8,
      pto_pay_cents: 20_904, // 8h @ $26.13
      training_hours: 4,
      training_pay_cents: 8_400,
      holiday_hours: 0,
      holiday_pay_cents: 0,
      bereavement_hours: 0,
      bereavement_pay_cents: 0,
    };
    render(<SummaryView {...baseProps([techLeave])} status="completed" completedAt="2026-07-12T14:00:00Z" />);
    // Hours + dollar figures appear in the row AND the totals card (the table's
    // TOTAL footer row is gone per #46) — a single-row run, so exactly twice.
    expect(screen.getAllByText("8.0")).toHaveLength(2);
    expect(screen.getAllByText("$209.04")).toHaveLength(2);
    expect(screen.getAllByText("$84.00")).toHaveLength(2);
  });

  it("shows n/a for a salaried row's leave pay (null *_pay_cents) — never $0.00", () => {
    const salaried: SummaryRow = {
      ...summaryRow,
      family: "service_advisor",
      role: "service_manager",
      billed_hours: null,
      billed_pay_cents: null,
      pto_hours: 8,
      pto_pay_cents: null, // salaried: hours tracked, no separate leave pay
      training_hours: 0,
      training_pay_cents: null,
      holiday_hours: 0,
      holiday_pay_cents: null,
      bereavement_hours: 0,
      bereavement_pay_cents: null,
    };
    render(<SummaryView {...baseProps([salaried])} status="completed" completedAt="2026-07-12T14:00:00Z" />);
    // The PTO hours show in the row AND the totals card; every all-null pay
    // category (and billed hours) is the archival n/a, never a misleading $0.00.
    expect(screen.getAllByText("8.0")).toHaveLength(2);
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    expect(
      screen.getAllByTitle(/Paid as salary — no separate leave pay/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByTitle("No PTO pay in this run")).toBeInTheDocument();
    expect(screen.getByTitle("No billed-hours employees in this run")).toBeInTheDocument();
    // No billed hours anywhere → cost per billed hour is n/a, never $∞ or $0.00.
    expect(screen.getByTitle("No billed hours in this run")).toBeInTheDocument();
  });
});

// ── Round-10 #48: per-employee Total column ────────────────────────────────────

describe("SummaryView per-employee Total column (round-10 #48)", () => {
  it("every row shows its own grand total — Marie's payroll-system matching figure", () => {
    const second: SummaryRow = {
      ...summaryRow,
      employee_id: "8d0f7780-8536-51ef-a55c-f18fd2f01bf8",
      display_name: "Aube",
      role: "office_manager",
      family: "office_manager",
      billed_hours: null,
      billed_pay_cents: null,
      total_pay_cents: 187_501,
    };
    render(
      <SummaryView
        {...baseProps([summaryRow, second])}
        status="completed"
        completedAt="2026-07-12T14:00:00Z"
      />,
    );
    expect(screen.getByText("Total")).toBeInTheDocument();
    // Distinct per-row totals render once each in the table (the totals card
    // shows their SUM, $4,822.19 — not either individual figure).
    expect(screen.getByText("$2,947.18")).toBeInTheDocument();
    expect(screen.getByText("$1,875.01")).toBeInTheDocument();
    expect(screen.getByText("$4,822.19")).toBeInTheDocument();
  });
});

// ── Round-9 #46: the totals card replaces the table's TOTAL row ────────────────

describe("PayrollTotalsCard (round-9 #46)", () => {
  it("the summary table's TOTAL footer row is GONE (approved contract change)", () => {
    const { container } = render(
      <SummaryView {...baseProps()} status="completed" completedAt="2026-07-12T14:00:00Z" />,
    );
    expect(container.querySelector("tfoot")).toBeNull();
    expect(screen.queryByText("Totals")).not.toBeInTheDocument();
  });

  it("renders the grouped card from the snapshot block: Pay / Hours / Metrics", () => {
    render(<SummaryView {...baseProps()} status="completed" completedAt="2026-07-12T14:00:00Z" />);
    expect(screen.getByText("Run totals")).toBeInTheDocument();
    // Group headings.
    expect(screen.getByText("Pay")).toBeInTheDocument();
    expect(screen.getByText("Hours")).toBeInTheDocument();
    expect(screen.getByText("Metrics")).toBeInTheDocument();
    // Pay: grand total + components (one row → totals mirror the row; the grand
    // total also appears in the row's #48 Total column, hence exactly twice).
    expect(screen.getAllByText("$2,947.18")).toHaveLength(2); // total pay
    expect(screen.getByText("$2,168.79")).toBeInTheDocument(); // regular pay
    expect(screen.getByText("$78.39")).toBeInTheDocument(); // OT pay
    expect(screen.getAllByText("$700.00").length).toBeGreaterThanOrEqual(1); // incentive (also the row cell)
    // Hours: regular 80 + OT 2 + billed 70.
    expect(screen.getAllByText("80.0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("70.0").length).toBeGreaterThanOrEqual(1);
    // Metrics: 294,718 ÷ 82 clock hours = 3,594¢ → $35.94/hr.
    expect(screen.getByText("$35.94/hr")).toBeInTheDocument();
    // Cost per billed hour (round-9 addendum): 294,718 ÷ 70 billed = 4,210¢ → $42.10/hr.
    expect(screen.getByText("$42.10/hr")).toBeInTheDocument();
  });

  it("an all-null pay category renders n/a in the card, never $0.00", () => {
    render(<SummaryView {...baseProps()} status="completed" completedAt="2026-07-12T14:00:00Z" />);
    // summaryRow carries null PTO/Holiday/Bereavement/Training pay.
    expect(screen.getByTitle("No PTO pay in this run")).toBeInTheDocument();
    expect(screen.getByTitle("No holiday pay in this run")).toBeInTheDocument();
    expect(screen.getByTitle("No bereavement pay in this run")).toBeInTheDocument();
    expect(screen.getByTitle("No training pay in this run")).toBeInTheDocument();
  });

  it("old frozen snapshot (no totals block): the card is absent and the note shows", () => {
    render(
      <SummaryView
        {...baseProps()}
        totals={null}
        status="completed"
        completedAt="2026-07-12T14:00:00Z"
      />,
    );
    expect(screen.queryByText("Run totals")).not.toBeInTheDocument();
    expect(
      screen.getByText(/totals unavailable — this run was completed before the totals feature/i),
    ).toBeInTheDocument();
  });

  it("an open run with no block renders neither the card nor the note (recompute will backfill)", () => {
    render(<SummaryView {...baseProps()} totals={null} status="open" completedAt={null} />);
    expect(screen.queryByText("Run totals")).not.toBeInTheDocument();
    expect(screen.queryByText(/totals unavailable/i)).not.toBeInTheDocument();
  });
});
