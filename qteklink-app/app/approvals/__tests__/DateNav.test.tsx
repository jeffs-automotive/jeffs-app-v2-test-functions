/**
 * DateNav — verifies the date-picker fix (the two reported symptoms):
 *   (1) the box didn't update when the ◀/▶ arrows changed the day, and
 *   (2) nothing happened when the date was changed.
 * The fix: a CONTROLLED input (value={date}) that NAVIGATES on change. Loading /approvals
 * itself needs Entra auth, so this component test is the rigorous proof of the actual fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

import DateNav from "../DateNav";

describe("DateNav (date-picker fix)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the input is CONTROLLED — its value reflects the current date", () => {
    render(<DateNav date="2026-06-06" />);
    expect((screen.getByLabelText("Pick a date") as HTMLInputElement).value).toBe("2026-06-06");
  });

  it("SYMPTOM 1 fixed: re-rendering with a new date updates the box (arrow nav now moves the box)", () => {
    const { rerender } = render(<DateNav date="2026-06-06" />);
    rerender(<DateNav date="2026-06-08" />); // what an ◀/▶ navigation does (new prop from the server page)
    expect((screen.getByLabelText("Pick a date") as HTMLInputElement).value).toBe("2026-06-08");
  });

  it("the ◀ / ▶ arrows navigate to the prev / next day", () => {
    render(<DateNav date="2026-06-06" />);
    fireEvent.click(screen.getByLabelText("Previous day"));
    expect(pushMock).toHaveBeenCalledWith("/approvals?date=2026-06-05");
    fireEvent.click(screen.getByLabelText("Next day"));
    expect(pushMock).toHaveBeenCalledWith("/approvals?date=2026-06-07");
  });

  it("SYMPTOM 2 fixed: picking a date navigates immediately (no 'Go' button, no dead change)", () => {
    render(<DateNav date="2026-06-06" />);
    fireEvent.change(screen.getByLabelText("Pick a date"), { target: { value: "2026-06-10" } });
    expect(pushMock).toHaveBeenCalledWith("/approvals?date=2026-06-10");
  });

  it("a cleared date doesn't navigate (no empty ?date=)", () => {
    render(<DateNav date="2026-06-06" />);
    fireEvent.change(screen.getByLabelText("Pick a date"), { target: { value: "" } });
    expect(pushMock).not.toHaveBeenCalled();
  });
});
