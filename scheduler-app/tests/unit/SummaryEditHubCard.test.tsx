import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SummaryEditHubCard } from "@/components/scheduler/heritage/SummaryEditHubCard";
import type { SummaryEditHubPayload } from "@/lib/scheduler/wizard/card-payloads";

// card-text-editor: SummaryEditHubCard now takes editable `copy`. Fixture
// matches CARD_TEXT_DEFAULTS.summary_edit_hub.
const HUB_COPY = {
  eyebrow: "Edit your appointment",
  title: "What would you like to change?",
  description:
    "Tap Edit on any section. Everything else stays exactly as you left it — nothing is lost.",
  body_section_contact: "Contact",
  body_section_vehicle: "Vehicle",
  body_section_services: "Services & concerns",
  body_section_time: "Appointment time",
  body_routine_label: "Routine",
  body_concerns_label: "Concerns to investigate",
  body_testing_label: "Testing",
  body_type_waiter: "Waiter ☕",
  body_type_dropoff: "Dropoff 🚗 — before 10 AM",
  body_hold_caution:
    "Editing your time releases the slot we're holding. You'll pick a fresh time and we'll hold that one.",
  footnote:
    "Changes you don't touch stay saved. Nothing here is submitted until you confirm on the summary.",
};

/**
 * SummaryEditHubCard (task EH2) — the summary "Edit something" hub.
 *
 * Interaction contract (design spec: .claude/work/design/summary-edit-hub-spec.md):
 *   - Four sectioned bands (Contact / Vehicle / Services & concerns /
 *     Appointment time), each with a ghost "Edit" button carrying a distinct
 *     aria-label so screen-reader / role-name queries disambiguate the four
 *     identical "Edit" labels.
 *   - A section tap emits that section's discriminator; "back to summary"
 *     emits "done".
 *   - The slot-release caution renders only when hold_active is true.
 *   - Empty-ish fields degrade to italic fallbacks.
 *   - While a submit is in flight, every control disables (pending guard).
 */

function makePayload(
  overrides: Partial<SummaryEditHubPayload> = {},
): SummaryEditHubPayload {
  return {
    contact: {
      name: "Sarah Johnson",
      phone_last_four: "0123",
      email: "sarah@example.com",
    },
    vehicle_label: "2018 Toyota Camry",
    services: {
      routine: ["Oil Change", "Tire Rotation"],
      concerns: [
        { display_name: "Brake noise", one_liner: "Squeaks when slowing down" },
      ],
      testing: [
        { display_name: "Brake Inspection", starting_price_cents: 4900 },
      ],
    },
    appointment: {
      type: "waiter",
      date: "2026-07-10",
      time: "09:00",
    },
    hold_active: false,
    copy: HUB_COPY,
    ...overrides,
  };
}

describe("<SummaryEditHubCard />", () => {
  it("renders the four Edit buttons with distinct aria-labels + the back-to-summary CTA", () => {
    render(<SummaryEditHubCard copy={HUB_COPY} payload={makePayload()} onSelect={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: /edit contact info/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^edit vehicle$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit services and concerns/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit appointment time/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /looks good — back to summary/i }),
    ).toBeInTheDocument();
  });

  it("shows the current values per band", () => {
    render(<SummaryEditHubCard copy={HUB_COPY} payload={makePayload()} onSelect={vi.fn()} />);

    expect(screen.getByText("Sarah Johnson")).toBeInTheDocument();
    expect(screen.getByText(/ending in 0123/i)).toBeInTheDocument();
    expect(screen.getByText("sarah@example.com")).toBeInTheDocument();
    expect(screen.getByText("2018 Toyota Camry")).toBeInTheDocument();
    expect(screen.getByText("Oil Change, Tire Rotation")).toBeInTheDocument();
    expect(screen.getByText("Brake noise")).toBeInTheDocument();
    expect(screen.getByText("$49.00+")).toBeInTheDocument();
  });

  it.each([
    ["edit contact info", "contact"],
    ["edit vehicle", "vehicle"],
    ["edit services and concerns", "services"],
    ["edit appointment time", "time"],
  ] as const)(
    "fires onSelect(%s) with the correct section arg",
    async (label, section) => {
      const onSelect = vi.fn();
      render(
        <SummaryEditHubCard copy={HUB_COPY} payload={makePayload()} onSelect={onSelect} />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") }),
      );
      expect(onSelect).toHaveBeenCalledWith(section);
    },
  );

  it("fires onSelect('done') from the back-to-summary CTA", async () => {
    const onSelect = vi.fn();
    render(<SummaryEditHubCard copy={HUB_COPY} payload={makePayload()} onSelect={onSelect} />);
    await userEvent.click(
      screen.getByRole("button", { name: /looks good — back to summary/i }),
    );
    expect(onSelect).toHaveBeenCalledWith("done");
  });

  it("renders the slot-release caution ONLY when hold_active is true", () => {
    const { rerender } = render(
      <SummaryEditHubCard
        copy={HUB_COPY}
        payload={makePayload({ hold_active: false })}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.queryByText(/releases the slot we're holding/i),
    ).not.toBeInTheDocument();

    rerender(
      <SummaryEditHubCard
        copy={HUB_COPY}
        payload={makePayload({ hold_active: true })}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/releases the slot we're holding/i),
    ).toBeInTheDocument();
  });

  it("renders italic empty-ish fallbacks when fields are absent", () => {
    render(
      <SummaryEditHubCard
        copy={HUB_COPY}
        payload={makePayload({
          contact: { name: "" },
          vehicle_label: null,
          services: { routine: [], concerns: [], testing: [] },
          appointment: { type: "dropoff", date: "", time: "" },
        })}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/tap edit to add your contact info/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no vehicle selected yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no services picked yet — tap edit to add one/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/no time held yet/i)).toBeInTheDocument();
  });

  it("caps concern + testing rows at 4 with a '+N more' line", () => {
    render(
      <SummaryEditHubCard
        copy={HUB_COPY}
        payload={makePayload({
          services: {
            routine: [],
            concerns: Array.from({ length: 6 }, (_, i) => ({
              display_name: `Concern ${i + 1}`,
              one_liner: "",
            })),
            testing: Array.from({ length: 5 }, (_, i) => ({
              display_name: `Testing ${i + 1}`,
              starting_price_cents: 1000 * (i + 1),
            })),
          },
        })}
        onSelect={vi.fn()}
      />,
    );

    // Concerns: first 4 shown, 5th/6th hidden, "+2 more".
    expect(screen.getByText("Concern 1")).toBeInTheDocument();
    expect(screen.getByText("Concern 4")).toBeInTheDocument();
    expect(screen.queryByText("Concern 5")).not.toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    // Testing: first 4 shown, 5th hidden, "+1 more".
    expect(screen.getByText("Testing 4")).toBeInTheDocument();
    expect(screen.queryByText("Testing 5")).not.toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
  });

  it("disables every control while a section submit is in flight", async () => {
    // A never-resolving onSelect keeps the card in the pending state.
    let resolve!: () => void;
    const onSelect = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(<SummaryEditHubCard copy={HUB_COPY} payload={makePayload()} onSelect={onSelect} />);

    await userEvent.click(
      screen.getByRole("button", { name: /edit contact info/i }),
    );

    expect(
      screen.getByRole("button", { name: /edit contact info/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^edit vehicle$/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /edit services and concerns/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /edit appointment time/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /looks good — back to summary/i }),
    ).toBeDisabled();

    resolve();
  });

  it("disables every control when the disabled prop is set", () => {
    render(
      <SummaryEditHubCard copy={HUB_COPY} payload={makePayload()} onSelect={vi.fn()} disabled />,
    );
    expect(
      screen.getByRole("button", { name: /edit contact info/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /looks good — back to summary/i }),
    ).toBeDisabled();
  });
});
