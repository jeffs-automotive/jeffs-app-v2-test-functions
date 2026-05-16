import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ServiceAndConcernPicker } from "@/components/scheduler/ServiceAndConcernPicker";

/**
 * Phase 17 (2026-05-16) — tests aligned to the Phase 9c rebuild of
 * ServiceAndConcernPicker:
 *   - Chips are toggle buttons (aria-pressed), NOT checkboxes
 *     (the older Phase 1 design used role=checkbox + aria-checked;
 *     superseded when the chip component standardised on the toggle
 *     button pattern).
 *   - onSubmit emits { picks: string[] }, NOT { services, concern_text }.
 *     The Phase 9c amendment moved the free-text concern flow out of
 *     this card — each picked "diagnostic" service now drills into its
 *     own concern_explanation step.
 *   - Empty submit surfaces a role=alert "Pick at least one service".
 */

const sampleCommon = [
  { service_key: "oil_change", display_name: "Oil Change" },
  { service_key: "tire_rotation", display_name: "Tire Rotation" },
];

const sampleDiagnostic = [
  {
    service_key: "brake_inspection",
    display_name: "Brake Inspection",
    starting_price_cents: 0,
    source: "routine" as const,
  },
  {
    service_key: "engine_noise_diagnostic",
    display_name: "Engine Noise Diagnostic",
    starting_price_cents: 8995,
    source: "testing" as const,
  },
];

describe("<ServiceAndConcernPicker />", () => {
  it("renders one toggle button per common_service", () => {
    render(
      <ServiceAndConcernPicker
        common_services={sampleCommon}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Oil Change" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tire Rotation" }),
    ).toBeInTheDocument();
  });

  it("renders diagnostic chips with their starting price", () => {
    render(
      <ServiceAndConcernPicker
        common_services={[]}
        diagnostic_services={sampleDiagnostic}
        onSubmit={vi.fn()}
      />,
    );

    // Free (cents=0) renders the literal "Free"
    expect(
      screen.getByRole("button", { name: /Brake Inspection.*Free/ }),
    ).toBeInTheDocument();
    // $89.95 renders formatted from 8995 cents
    expect(
      screen.getByRole("button", { name: /Engine Noise Diagnostic.*\$89\.95/ }),
    ).toBeInTheDocument();
  });

  it("toggles a chip on click and reflects aria-pressed", async () => {
    render(
      <ServiceAndConcernPicker
        common_services={sampleCommon}
        onSubmit={vi.fn()}
      />,
    );

    const oil = screen.getByRole("button", { name: "Oil Change" });
    expect(oil).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(oil);
    expect(oil).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(oil);
    expect(oil).toHaveAttribute("aria-pressed", "false");
  });

  it("submits the picked service keys", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        common_services={sampleCommon}
        diagnostic_services={sampleDiagnostic}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Oil Change" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Engine Noise Diagnostic/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0]![0] as { picks: string[] };
    expect(new Set(arg.picks)).toEqual(
      new Set(["oil_change", "engine_noise_diagnostic"]),
    );
  });

  it("blocks submit + shows alert when no chips are picked", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        common_services={sampleCommon}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /pick at least one service/i,
    );
  });

  it("clears the alert when a chip is picked after an empty submit", async () => {
    render(
      <ServiceAndConcernPicker
        common_services={sampleCommon}
        onSubmit={vi.fn()}
      />,
    );

    // Empty submit → alert shown
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Pick a chip → alert clears
    await userEvent.click(
      screen.getByRole("button", { name: "Oil Change" }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
