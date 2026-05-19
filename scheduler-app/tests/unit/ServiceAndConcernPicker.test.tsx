import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ServiceAndConcernPicker } from "@/components/scheduler/ServiceAndConcernPicker";

/**
 * 2026-05-17 reshape — single-section picker tests.
 *
 * The Phase 9c two-section design (routine + diagnostic) was retired
 * because the diagnostic chip list was long, jargon-heavy, and confusing
 * to non-mechanic customers. The picker now shows all 10 routine services
 * with starting prices + optional waived-fee notes; the diagnostic LLM
 * picks the right testing_service from the customer's free-text concern
 * description in Step 7.3.
 */

const sampleRoutine = [
  {
    service_key: "oil_change",
    display_name: "Oil Change",
    starting_price_cents: 5995,
    price_waived_note: null,
    description: null,
  },
  {
    service_key: "tire_rotation",
    display_name: "Tire Rotation",
    starting_price_cents: 2995,
    price_waived_note: null,
    description:
      "Standard tire rotation — front to back, in 30 minutes or less.",
  },
  {
    service_key: "brake_inspection",
    display_name: "Brake Inspection",
    starting_price_cents: 3999,
    price_waived_note:
      "Fee waived if a repair or more testing is needed and approved",
    description: null,
  },
  {
    service_key: "check_battery",
    display_name: "Check Battery",
    starting_price_cents: 0,
    price_waived_note: null,
    description: null,
  },
];

describe("<ServiceAndConcernPicker />", () => {
  it("renders one toggle button per routine_service with its price", () => {
    render(
      <ServiceAndConcernPicker
        routine_services={sampleRoutine}
        onSubmit={vi.fn()}
      />,
    );

    // Each chip combines name + price in its accessible name.
    expect(
      screen.getByRole("button", { name: /Oil Change.*\$59\.95/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Tire Rotation.*\$29\.95/ }),
    ).toBeInTheDocument();
    // Brake inspection — price + waived note.
    expect(
      screen.getByRole("button", {
        name: /Brake Inspection.*\$39\.99.*Fee waived/,
      }),
    ).toBeInTheDocument();
    // Free renders as "Free".
    expect(
      screen.getByRole("button", { name: /Check Battery.*Free/ }),
    ).toBeInTheDocument();
  });

  it("toggles a chip on click and reflects aria-pressed", async () => {
    render(
      <ServiceAndConcernPicker
        routine_services={sampleRoutine}
        onSubmit={vi.fn()}
      />,
    );

    const oil = screen.getByRole("button", { name: /Oil Change/ });
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
        routine_services={sampleRoutine}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /Oil Change/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Brake Inspection/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0]![0] as { picks: string[] };
    expect(new Set(arg.picks)).toEqual(
      new Set(["oil_change", "brake_inspection"]),
    );
  });

  it("blocks submit + shows alert when no chips are picked", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        routine_services={sampleRoutine}
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
        routine_services={sampleRoutine}
        onSubmit={vi.fn()}
      />,
    );

    // Empty submit → alert shown
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Pick a chip → alert clears
    await userEvent.click(
      screen.getByRole("button", { name: /Oil Change/ }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("omits the price chip suffix when starting_price_cents is null", () => {
    render(
      <ServiceAndConcernPicker
        routine_services={[
          {
            service_key: "custom_service",
            display_name: "Custom Service",
            starting_price_cents: null,
            price_waived_note: null,
            description: null,
          },
        ]}
        onSubmit={vi.fn()}
      />,
    );
    // Button accessible name should be just the display name — no price token.
    const btn = screen.getByRole("button", { name: "Custom Service" });
    expect(btn).toBeInTheDocument();
  });

  it("renders the description under the title when present", () => {
    render(
      <ServiceAndConcernPicker
        routine_services={sampleRoutine}
        onSubmit={vi.fn()}
      />,
    );
    // Tire Rotation is the fixture row with a description.
    expect(
      screen.getByRole("button", {
        name: /Tire Rotation.*\$29\.95.*Standard tire rotation/,
      }),
    ).toBeInTheDocument();
  });

  it("renders the Other Issue pseudo-chip below the routine grid", () => {
    render(
      <ServiceAndConcernPicker
        routine_services={sampleRoutine}
        onSubmit={vi.fn()}
      />,
    );
    // Other Issue is always present regardless of routine_services contents.
    expect(
      screen.getByRole("button", { name: /Other issue/i }),
    ).toBeInTheDocument();
  });

  it("submits 'other_issue' when the Other Issue pseudo-chip is picked", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        routine_services={sampleRoutine}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Other issue/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0]![0] as { picks: string[] };
    expect(arg.picks).toContain("other_issue");
  });

  it("allows picking Other Issue alongside routine chips", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        routine_services={sampleRoutine}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Oil Change/ }));
    await userEvent.click(screen.getByRole("button", { name: /Other issue/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    const arg = onSubmit.mock.calls[0]![0] as { picks: string[] };
    expect(new Set(arg.picks)).toEqual(new Set(["oil_change", "other_issue"]));
  });

  it("Other Issue picked alone satisfies the 'pick at least one' guard", async () => {
    const onSubmit = vi.fn();
    render(
      <ServiceAndConcernPicker
        routine_services={sampleRoutine}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Other issue/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
