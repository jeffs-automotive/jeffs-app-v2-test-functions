import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TagBadge } from "@/components/keytag/TagBadge";

/**
 * TagBadge is the pure presentational R/Y key-tag badge. These pin the
 * label/color/accessible-name contract used across the keytag surfaces.
 */
describe("TagBadge", () => {
  it("renders R<number> with the red fill + accessible label", () => {
    render(<TagBadge color="red" number={4} />);
    const el = screen.getByText("R4");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("bg-red-600");
    expect(el).toHaveAttribute("aria-label", "Red tag 4");
  });

  it("renders Y<number> with the yellow fill + accessible label", () => {
    render(<TagBadge color="yellow" number={45} />);
    const el = screen.getByText("Y45");
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass("bg-yellow-400");
    expect(el).toHaveAttribute("aria-label", "Yellow tag 45");
  });

  it("applies the small size class when size='sm'", () => {
    render(<TagBadge color="red" number={1} size="sm" />);
    expect(screen.getByText("R1")).toHaveClass("h-5");
  });
});
