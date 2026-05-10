import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaiterTimePicker } from "@/components/scheduler/WaiterTimePicker";

describe("<WaiterTimePicker />", () => {
  it("renders one button per available time", () => {
    render(
      <WaiterTimePicker
        date="2026-05-19"
        available_times={["08:00", "09:00"]}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /8 AM/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /9 AM/ })).toBeInTheDocument();
  });

  it("formats the date for display", () => {
    render(
      <WaiterTimePicker
        date="2026-05-19"
        available_times={["08:00"]}
        onSubmit={vi.fn()}
      />
    );

    // 2026-05-19 is a Tuesday
    expect(
      screen.getByText(/Tuesday, May 19/)
    ).toBeInTheDocument();
  });

  it("emits the picked time on click", async () => {
    const onSubmit = vi.fn();
    render(
      <WaiterTimePicker
        date="2026-05-19"
        available_times={["08:00", "09:00"]}
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /8 AM/ }));
    expect(onSubmit).toHaveBeenCalledWith({ selected_time: "08:00" });
  });

  it("renders only the available times (one missing → one button)", () => {
    render(
      <WaiterTimePicker
        date="2026-05-19"
        available_times={["09:00"]}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /8 AM/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /9 AM/ })).toBeInTheDocument();
  });

  it("renders fallback copy + shop phone when available_times is empty", () => {
    render(
      <WaiterTimePicker
        date="2026-05-19"
        available_times={[]}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText(/no waiter slots open that day/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\(610\) 253-6565/ })).toHaveAttribute(
      "href",
      "tel:6102536565"
    );
  });

  it("disables all buttons when disabled prop set", () => {
    render(
      <WaiterTimePicker
        date="2026-05-19"
        available_times={["08:00", "09:00"]}
        onSubmit={vi.fn()}
        disabled
      />
    );

    screen.getAllByRole("button").forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("prevents double-submit on rapid clicks", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    render(
      <WaiterTimePicker
        date="2026-05-19"
        available_times={["08:00"]}
        onSubmit={onSubmit}
      />
    );

    const btn = screen.getByRole("button", { name: /8 AM/ });
    await userEvent.click(btn);
    await userEvent.click(btn);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve();
  });
});
