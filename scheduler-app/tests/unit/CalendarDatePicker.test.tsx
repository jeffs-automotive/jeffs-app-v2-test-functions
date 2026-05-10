import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarDatePicker } from "@/components/scheduler/CalendarDatePicker";

describe("<CalendarDatePicker />", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin "today" to 2026-05-10 (a Sunday) for deterministic tests
    vi.setSystemTime(new Date(2026, 4, 10, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the current month and weekday headers", () => {
    render(
      <CalendarDatePicker
        available_dates={["2026-05-13", "2026-05-19"]}
        type="dropoff"
        onSubmit={vi.fn()}
      />
    );

    // Month label "May 2026"
    expect(screen.getByText(/May 2026/)).toBeInTheDocument();
    // Weekday headers
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((label) => {
      expect(screen.getByRole("columnheader", { name: label })).toBeInTheDocument();
    });
  });

  it("makes only available_dates clickable; others disabled", async () => {
    const onSubmit = vi.fn();
    render(
      <CalendarDatePicker
        available_dates={["2026-05-13"]}
        type="dropoff"
        onSubmit={onSubmit}
      />
    );

    // 13 is in available_dates → clickable
    const may13 = screen.getByRole("gridcell", {
      name: /Wednesday, May 13/,
    });
    expect(may13).not.toBeDisabled();
    expect(may13).toHaveAttribute("aria-disabled", "false");

    // 14 is in range but NOT in available_dates → disabled
    const may14 = screen.getByRole("gridcell", {
      name: /Thursday, May 14.*unavailable/,
    });
    expect(may14).toBeDisabled();
    expect(may14).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(may13);
    expect(onSubmit).toHaveBeenCalledWith({ selected_date: "2026-05-13" });
  });

  it("emits the picked ISO date on click", async () => {
    const onSubmit = vi.fn();
    render(
      <CalendarDatePicker
        available_dates={["2026-05-19"]}
        type="waiter"
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(
      screen.getByRole("gridcell", { name: /Tuesday, May 19/ })
    );
    expect(onSubmit).toHaveBeenCalledWith({ selected_date: "2026-05-19" });
  });

  it("ignores clicks on past dates (before today)", async () => {
    const onSubmit = vi.fn();
    render(
      <CalendarDatePicker
        // include a past date in available_dates — should still be unclickable
        available_dates={["2026-05-08"]}
        type="dropoff"
        onSubmit={onSubmit}
      />
    );

    // 2026-05-08 is before today (2026-05-10)
    const may8 = screen.getByRole("gridcell", { name: /Friday, May 8/ });
    expect(may8).toBeDisabled();

    await userEvent.click(may8);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders no-openings fallback with shop phone when available_dates is empty", () => {
    render(
      <CalendarDatePicker
        available_dates={[]}
        type="waiter"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText(/no openings in this window/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\(610\) 253-6565/ })).toHaveAttribute(
      "href",
      "tel:6102536565"
    );
  });

  it("Next-month navigation shows the next month", async () => {
    render(
      <CalendarDatePicker
        available_dates={["2026-06-15"]}
        type="dropoff"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText(/May 2026/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /next month/i }));
    expect(screen.getByText(/June 2026/)).toBeInTheDocument();

    // June 15 is now visible + clickable
    expect(
      screen.getByRole("gridcell", { name: /Monday, June 15/ })
    ).not.toBeDisabled();
  });

  it("Previous-month nav is disabled when viewing the current month", () => {
    render(
      <CalendarDatePicker
        available_dates={["2026-05-13"]}
        type="dropoff"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /previous month/i })).toBeDisabled();
  });

  it("respects type prop in heading copy", () => {
    const { rerender } = render(
      <CalendarDatePicker
        available_dates={["2026-05-13"]}
        type="dropoff"
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/drop off/)).toBeInTheDocument();

    rerender(
      <CalendarDatePicker
        available_dates={["2026-05-19"]}
        type="waiter"
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/wait while we work on it/)).toBeInTheDocument();
  });
});
