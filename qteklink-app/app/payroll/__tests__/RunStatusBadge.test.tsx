/**
 * RunStatusBadge — the local payroll-run status vocabulary. Pins that every
 * status renders its TEXT label (color is never the only signal) and that the
 * voided state is visually the archival grey (slate), per the design addendum.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RunStatusBadge from "../RunStatusBadge";

describe("RunStatusBadge", () => {
  it("renders a text label for every status", () => {
    const { rerender } = render(<RunStatusBadge status="open" />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    rerender(<RunStatusBadge status="completed" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
    rerender(<RunStatusBadge status="voided" />);
    expect(screen.getByText("Voided")).toBeInTheDocument();
  });

  it("voided recedes to the slate archival tint (not emerald, not red)", () => {
    render(<RunStatusBadge status="voided" />);
    const badge = screen.getByText("Voided");
    expect(badge.className).toContain("text-slate-700");
    expect(badge.className).toContain("bg-slate-100");
  });
});
