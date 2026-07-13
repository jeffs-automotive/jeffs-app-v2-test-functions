/**
 * PtoLedgerTable tests — the per-employee PTO activity ledger (design spec §2).
 * Pins: rows render in the order provided (newest-first is the DAL's job, not a
 * client sort — a later-first array stays as-is); each kind gets its human label
 * (color never carries the meaning alone); the signed-hours Change column uses
 * the U+2212 minus glyph for negatives; a row whose balance_after went negative
 * shows the PtoBalance deficit chip with its accessible name; a null reason
 * renders the muted em-dash, never blank.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { PtoLedgerEntry } from "@/lib/dal/payroll";
import { PtoLedgerTable } from "../PtoLedgerTable";

const EMP_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

function entry(overrides: Partial<PtoLedgerEntry>): PtoLedgerEntry {
  return {
    id: "row-1",
    employeeId: EMP_ID,
    runId: null,
    kind: "adjustment",
    hours: 4,
    balanceAfterHours: 12,
    reason: "Starting balance as of last pay period",
    reversesLedgerId: null,
    boundaryYear: null,
    createdAt: "2026-07-11T16:05:00Z",
    createdByLabel: "Chris",
    ...overrides,
  };
}

describe("PtoLedgerTable", () => {
  it("renders the column headers and one row per ledger entry", () => {
    render(
      <PtoLedgerTable
        entries={[
          entry({ id: "a", kind: "accrual", hours: 3.08, balanceAfterHours: 15.08, reason: null }),
          entry({ id: "b", kind: "adjustment", hours: 12, balanceAfterHours: 12 }),
        ]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "When" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Balance after" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Reason" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Who" })).toBeInTheDocument();
    // header row + two body rows.
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("preserves the array order (newest-first comes from the DAL, not a client sort)", () => {
    render(
      <PtoLedgerTable
        entries={[
          entry({ id: "newest", kind: "adjustment", reason: "Newest adjustment" }),
          entry({ id: "older", kind: "accrual", reason: null, hours: 3, balanceAfterHours: 8 }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(within(rows[0]!).getByText("Adjustment")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Accrual")).toBeInTheDocument();
  });

  it("labels each kind with a human label (color is never the only signal)", () => {
    render(
      <PtoLedgerTable
        entries={[
          entry({ id: "1", kind: "initial", reason: "Seed" }),
          entry({ id: "2", kind: "accrual", reason: null }),
          entry({ id: "3", kind: "usage", reason: null, hours: -8, balanceAfterHours: 4 }),
          entry({ id: "4", kind: "adjustment" }),
          entry({ id: "5", kind: "rollover_forfeit", reason: null, hours: -2, balanceAfterHours: 10 }),
          entry({ id: "6", kind: "void_reversal", reason: null, hours: -3, balanceAfterHours: 9 }),
        ]}
      />,
    );
    expect(screen.getByText("Initial")).toBeInTheDocument();
    expect(screen.getByText("Accrual")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText("Adjustment")).toBeInTheDocument();
    expect(screen.getByText("Rollover forfeit")).toBeInTheDocument();
    expect(screen.getByText("Reversal")).toBeInTheDocument();
  });

  it("signs the Change column: + for accrual, U+2212 minus for usage", () => {
    render(
      <PtoLedgerTable
        entries={[
          entry({ id: "acc", kind: "accrual", hours: 3.08, balanceAfterHours: 15.08, reason: null }),
          entry({ id: "use", kind: "usage", hours: -8, balanceAfterHours: 7.08, reason: null }),
        ]}
      />,
    );
    expect(screen.getByText("+3.08")).toBeInTheDocument();
    // fmtSignedHours negatives use the U+2212 minus, not a hyphen.
    expect(screen.getByText("−8.0")).toBeInTheDocument();
  });

  it("shows the deficit chip (with its accessible name) when a row went negative", () => {
    render(
      <PtoLedgerTable
        entries={[entry({ id: "neg", kind: "usage", hours: -8, balanceAfterHours: -3.5, reason: null })]}
      />,
    );
    expect(
      screen.getByLabelText("PTO balance -3.5 hours, negative — 3.5 hour deficit"),
    ).toBeInTheDocument();
  });

  it("renders a muted em-dash for a null reason, never a blank cell", () => {
    render(
      <PtoLedgerTable
        entries={[entry({ id: "acc", kind: "accrual", hours: 3, balanceAfterHours: 15, reason: null })]}
      />,
    );
    expect(screen.getByTitle("No reason for this entry")).toBeInTheDocument();
  });
});
