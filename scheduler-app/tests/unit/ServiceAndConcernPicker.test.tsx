import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServiceAndConcernPicker } from "@/components/scheduler/ServiceAndConcernPicker";

const sampleServices = [
  { service_key: "oil_change", display_name: "Oil Change" },
  { service_key: "tire_rotation", display_name: "Tire Rotation" },
  { service_key: "brake_inspection", display_name: "Brake Inspection" },
];

describe("<ServiceAndConcernPicker />", () => {
  it("renders one chip per common_service", () => {
    render(
      <ServiceAndConcernPicker
        common_services={sampleServices}
        onSubmit={vi.fn()}
      />
    );

    expect(screen.getByRole("checkbox", { name: "Oil Change" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Tire Rotation" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Brake Inspection" })
    ).toBeInTheDocument();
  });

  it("toggles a chip on click and reflects aria-checked", async () => {
    render(
      <ServiceAndConcernPicker
        common_services={sampleServices}
        onSubmit={vi.fn()}
      />
    );

    const oil = screen.getByRole("checkbox", { name: "Oil Change" });
    expect(oil).toHaveAttribute("aria-checked", "false");

    await userEvent.click(oil);
    expect(oil).toHaveAttribute("aria-checked", "true");

    await userEvent.click(oil);
    expect(oil).toHaveAttribute("aria-checked", "false");
  });

  it("submits selected service keys (in chip order)", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        common_services={sampleServices}
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "Brake Inspection" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Oil Change" }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      services: ["oil_change", "brake_inspection"], // input-order, not click-order
      concern_text: undefined,
    });
  });

  it("submits a concern_text alone (no services picked)", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        common_services={sampleServices}
        onSubmit={onSubmit}
      />
    );

    await userEvent.type(
      screen.getByLabelText(/describe a concern/i),
      "grinding noise when braking"
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      services: [],
      concern_text: "grinding noise when braking",
    });
  });

  it("submits BOTH services and concern when both provided", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        common_services={sampleServices}
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("checkbox", { name: "Oil Change" }));
    await userEvent.type(
      screen.getByLabelText(/describe a concern/i),
      "and there's also a clunk on the front left"
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      services: ["oil_change"],
      concern_text: "and there's also a clunk on the front left",
    });
  });

  it("blocks submit when no service AND no concern; shows error", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        common_services={sampleServices}
        onSubmit={onSubmit}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/at least one service/i);
  });

  it("trims whitespace from concern text and treats whitespace-only as empty", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        common_services={sampleServices}
        onSubmit={onSubmit}
      />
    );

    await userEvent.type(screen.getByLabelText(/describe a concern/i), "   ");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
