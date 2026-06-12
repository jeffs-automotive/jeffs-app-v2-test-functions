import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { WizardProgress } from "@/components/scheduler/wizard/WizardProgress";

/**
 * WizardProgress — the 4-phase booking ribbon (added 2026-06-11).
 *
 * Purely presentational: maps card.step → one of four fixed, branch-
 * independent phases (You / Your car / The work / When) and highlights the
 * current one. These tests assert the accessible-name contract + that
 * aria-current="step" lands on the correct phase for a representative sample
 * of steps, and that terminal/off-path steps hide the ribbon.
 */
describe("<WizardProgress />", () => {
  it("renders a navigation landmark named 'Booking progress'", () => {
    render(<WizardProgress step="greeting" />);
    expect(
      screen.getByRole("navigation", { name: /booking progress/i }),
    ).toBeInTheDocument();
  });

  it("renders the four phase labels", () => {
    render(<WizardProgress step="greeting" />);
    const nav = screen.getByRole("navigation", { name: /booking progress/i });
    // Labels appear once as visible text; the sr-only suffix repeats them with
    // a state word, so use the list items as the anchor.
    const items = within(nav).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(nav).getByText("You")).toBeInTheDocument();
    expect(within(nav).getByText("Your car")).toBeInTheDocument();
    expect(within(nav).getByText("The work")).toBeInTheDocument();
    expect(within(nav).getByText("When")).toBeInTheDocument();
  });

  // step → expected current phase label. One representative step per phase
  // plus boundary steps that exercise the phase map's grouping.
  const CASES: Array<[step: Parameters<typeof WizardProgress>[0]["step"], label: string]> = [
    ["greeting", "You"],
    ["otp_pending", "You"],
    ["customer_info_edit", "You"],
    ["vehicle_pick", "Your car"],
    ["new_vehicle_form", "Your car"],
    ["service_concern_picker", "The work"],
    ["diagnostic_loading", "The work"],
    ["second_routine_pass", "The work"],
    ["appointment_type", "When"],
    ["summary", "When"],
    ["completed", "When"],
  ];

  it.each(CASES)(
    "marks the right phase aria-current=step for %s",
    (step, label) => {
      render(<WizardProgress step={step} />);
      const current = screen.getByRole("listitem", { current: "step" });
      expect(within(current).getByText(label)).toBeInTheDocument();
    },
  );

  it("conveys phase state with text, not color alone (sr-only state words)", () => {
    render(<WizardProgress step="vehicle_pick" />);
    // 'You' is completed, 'Your car' is current, the rest upcoming.
    expect(screen.getByText("You: completed")).toBeInTheDocument();
    expect(screen.getByText("Your car: current step")).toBeInTheDocument();
    expect(screen.getByText("The work: upcoming")).toBeInTheDocument();
    expect(screen.getByText("When: upcoming")).toBeInTheDocument();
  });

  it("hides the ribbon on terminal / off-path steps", () => {
    const { container: escalated } = render(<WizardProgress step="escalated" />);
    expect(escalated.firstChild).toBeNull();

    const { container: abandoned } = render(<WizardProgress step="abandoned" />);
    expect(abandoned.firstChild).toBeNull();
  });
});
