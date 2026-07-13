/**
 * PtoBalance / DeficitNotice / fmtSignedHours — the shared PTO deficit
 * vocabulary. Pins the one-to-one meaning of the PTO-negative state: a
 * positive/zero balance is plain ink, a negative balance gets the amber-red
 * deficit chip (--color-pto-negative*) AND says "deficit" in its accessible
 * name (color never carries the meaning alone), and the DeficitNotice announces
 * as an alert. fmtSignedHours uses the U+2212 minus glyph, matching fmtDelta.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeficitNotice, PtoBalance, fmtSignedHours } from "../payroll-ui";

describe("PtoBalance", () => {
  it("renders a positive balance as plain foreground hours (no deficit styling)", () => {
    render(<PtoBalance hours={12.5} />);
    // fmtHours is min-1/max-2 decimals, so 12.5 → "12.5".
    const el = screen.getByText("12.5 hrs");
    expect(el).toBeInTheDocument();
    expect(el.className).toContain("text-foreground");
    expect(el.className).not.toContain("--color-pto-negative");
  });

  it("renders a zero balance as plain foreground hours", () => {
    render(<PtoBalance hours={0} />);
    const el = screen.getByText("0.0 hrs");
    expect(el.className).toContain("text-foreground");
    expect(el.className).not.toContain("--color-pto-negative");
  });

  it("renders a negative balance with the PTO-negative deficit chip + accessible name", () => {
    render(<PtoBalance hours={-3.5} />);
    // Accessible name names the deficit — color is not the only signal. The
    // label uses fmtHours (min-1 decimal; its own locale minus on the signed
    // value), so -3.5 → "-3.5 hours" / "3.5 hour deficit".
    const el = screen.getByLabelText(
      "PTO balance -3.5 hours, negative — 3.5 hour deficit",
    );
    expect(el).toBeInTheDocument();
    // The amber-red deficit tokens (not --destructive, not --color-auto/voided).
    expect(el.className).toContain("text-[color:var(--color-pto-negative)]");
    expect(el.className).toContain("bg-[color:var(--color-pto-negative-bg)]");
    expect(el.className).toContain("ring-[color:var(--color-pto-negative-border)]");
    // The visible sign glyph is the U+2212 minus, not a hyphen.
    expect(el.textContent).toContain("−");
  });
});

describe("DeficitNotice", () => {
  it("announces its contents as an alert in the PTO-negative palette", () => {
    render(<DeficitNotice>Will go negative by 3.5 h</DeficitNotice>);
    const box = screen.getByRole("alert");
    expect(box).toHaveTextContent("Will go negative by 3.5 h");
    expect(box.className).toContain("text-[color:var(--color-pto-negative)]");
    expect(box.className).toContain("bg-[color:var(--color-pto-negative-bg)]");
  });
});

describe("fmtSignedHours", () => {
  it("signs positive, negative (U+2212), and zero (fmtHours is min-1/max-2 dp)", () => {
    expect(fmtSignedHours(3.5)).toBe("+3.5");
    expect(fmtSignedHours(1.25)).toBe("+1.25");
    expect(fmtSignedHours(-1.25)).toBe("−1.25");
    expect(fmtSignedHours(0)).toBe("0.0");
  });
});
