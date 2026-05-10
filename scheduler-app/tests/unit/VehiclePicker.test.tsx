import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VehiclePicker } from "@/components/scheduler/VehiclePicker";

describe("<VehiclePicker />", () => {
  const sampleVehicles = [
    { id: "359093", label: "2018 Toyota Camry" },
    { id: "359094", label: "2021 Honda Civic" },
  ];

  it("renders one button per vehicle plus 'Add new vehicle' when allow_add_new", () => {
    render(
      <VehiclePicker
        vehicles={sampleVehicles}
        allow_add_new
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: /2018 Toyota Camry/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /2021 Honda Civic/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add new vehicle/ })
    ).toBeInTheDocument();
  });

  it("hides 'Add new vehicle' when allow_add_new is false", () => {
    render(
      <VehiclePicker
        vehicles={sampleVehicles}
        allow_add_new={false}
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.queryByRole("button", { name: /Add new vehicle/ })
    ).not.toBeInTheDocument();
  });

  it("emits the picked vehicle id on click", async () => {
    const onSubmit = vi.fn();
    render(
      <VehiclePicker
        vehicles={sampleVehicles}
        allow_add_new
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /2018 Toyota Camry/ })
    );

    expect(onSubmit).toHaveBeenCalledWith({ vehicle_id: "359093" });
  });

  it("emits 'new' when 'Add new vehicle' is clicked", async () => {
    const onSubmit = vi.fn();
    render(
      <VehiclePicker
        vehicles={sampleVehicles}
        allow_add_new
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Add new vehicle/ })
    );

    expect(onSubmit).toHaveBeenCalledWith({ vehicle_id: "new" });
  });

  it("renders fallback copy when vehicles[] is empty AND allow_add_new is false", () => {
    render(
      <VehiclePicker
        vehicles={[]}
        allow_add_new={false}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByText(/no vehicles on file/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\(610\) 253-6565/ })).toHaveAttribute(
      "href",
      "tel:6102536565"
    );
  });

  it("disables all buttons when disabled prop is set", () => {
    render(
      <VehiclePicker
        vehicles={sampleVehicles}
        allow_add_new
        onSubmit={vi.fn()}
        disabled
      />
    );

    screen.getAllByRole("button").forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it("prevents double-submit on rapid clicks (race-safety on the button)", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        })
    );
    render(
      <VehiclePicker
        vehicles={sampleVehicles}
        allow_add_new
        onSubmit={onSubmit}
      />
    );

    const button = screen.getByRole("button", { name: /2018 Toyota Camry/ });
    await userEvent.click(button);
    // Rapid second click
    await userEvent.click(button);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve();
  });
});
