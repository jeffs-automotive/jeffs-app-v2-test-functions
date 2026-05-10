import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmationCard } from "@/components/scheduler/ConfirmationCard";

describe("<ConfirmationCard />", () => {
  it("renders waiter appointment with date + time", () => {
    render(
      <ConfirmationCard
        summary="Oil Change"
        starts_at="2026-05-19T08:00:00Z"
        customer="Vince Zulauf"
        vehicle="2018 Toyota Camry"
        type="waiter"
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText(/Vince Zulauf/)).toBeInTheDocument();
    expect(screen.getByText(/2018 Toyota Camry/)).toBeInTheDocument();
    expect(screen.getByText(/Oil Change/)).toBeInTheDocument();
    // Tuesday May 19 + a time
    expect(screen.getByText(/Tuesday, May 19/)).toBeInTheDocument();
  });

  it("renders DROP-OFF without showing the time (per design §5)", () => {
    render(
      <ConfirmationCard
        summary="Oil Change"
        starts_at="2026-05-13"
        customer="Anna Lee"
        vehicle="2022 Subaru Outback"
        type="dropoff"
        onSubmit={vi.fn()}
      />
    );

    // Heading uses "Drop off:" instead of "Appointment:"
    expect(screen.getByText("Drop off:")).toBeInTheDocument();
    // Date renders, NO time
    expect(screen.getByText(/Wednesday, May 13/)).toBeInTheDocument();
    expect(screen.queryByText(/AM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PM/)).not.toBeInTheDocument();
    expect(screen.queryByText(/12:00/)).not.toBeInTheDocument();
  });

  it("renders reminders block when provided", () => {
    render(
      <ConfirmationCard
        summary="State Inspection"
        starts_at="2026-05-13"
        customer="Bob Smith"
        vehicle="2019 Honda Civic"
        type="dropoff"
        reminders={[
          "Please drop off your vehicle before 10 AM on the day of your appointment.",
          "Please bring up-to-date copies of your insurance and registration cards.",
        ]}
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.getByText(/before 10 AM/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/insurance and registration cards/i)
    ).toBeInTheDocument();
  });

  it("emits { confirmed: true } when Confirm clicked", async () => {
    const onSubmit = vi.fn();
    render(
      <ConfirmationCard
        summary="Oil Change"
        starts_at="2026-05-19T08:00:00Z"
        customer="Vince Zulauf"
        vehicle="2018 Toyota Camry"
        type="waiter"
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /confirm appointment/i }));
    expect(onSubmit).toHaveBeenCalledWith({ confirmed: true });
  });

  it("emits { confirmed: false } when Cancel clicked", async () => {
    const onSubmit = vi.fn();
    render(
      <ConfirmationCard
        summary="Oil Change"
        starts_at="2026-05-19T08:00:00Z"
        customer="Vince Zulauf"
        vehicle="2018 Toyota Camry"
        type="waiter"
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onSubmit).toHaveBeenCalledWith({ confirmed: false });
  });

  it("prevents double-submit on rapid Confirm clicks", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    render(
      <ConfirmationCard
        summary="Oil Change"
        starts_at="2026-05-19T08:00:00Z"
        customer="Vince Zulauf"
        vehicle="2018 Toyota Camry"
        type="waiter"
        onSubmit={onSubmit}
      />
    );

    const confirm = screen.getByRole("button", { name: /confirm appointment/i });
    await userEvent.click(confirm);
    await userEvent.click(confirm);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve();
  });
});
