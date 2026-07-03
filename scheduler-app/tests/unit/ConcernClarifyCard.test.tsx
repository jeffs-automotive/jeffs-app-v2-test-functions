import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  ConcernClarifyCard,
  type ConcernClarifyCandidate,
} from "@/components/scheduler/heritage/ConcernClarifyCard";

/**
 * Act-or-ask AO4 (2026-07-03) — ConcernClarifyCard.
 *
 * Interaction contract (design spec §2, §6, §7):
 *   - Candidate rows are ACTION buttons; a tap emits
 *     { action: "select", candidate_key }.
 *   - The ghost escape emits { action: "none_of_these" }.
 *   - While a submit is in flight, all controls disable.
 *   - Priced candidate shows "From $X"; a null-price candidate shows the
 *     "We'll take a look" pill.
 *   - The echoed concern_text is present in the DOM (full string).
 */

const CANDIDATES: ConcernClarifyCandidate[] = [
  {
    candidate_key: "brake_inspection",
    display_name: "Brake inspection",
    starting_price_cents: 4900,
    description: "We inspect your brakes and tell you what's worn.",
  },
  {
    candidate_key: "advisor_handoff",
    display_name: "Have an advisor look",
    starting_price_cents: null,
    description: "One of our advisors reads your note and follows up.",
  },
];

describe("<ConcernClarifyCard />", () => {
  it("renders the heading, the echoed concern text, and one button per candidate", () => {
    render(
      <ConcernClarifyCard
        concern_text="My brakes squeak when I slow down"
        candidates={CANDIDATES}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: /which of these sounds closest/i }),
    ).toBeInTheDocument();
    // The full concern text reaches the DOM (CSS clamps visually, not JS).
    expect(
      screen.getByText("My brakes squeak when I slow down"),
    ).toBeInTheDocument();
    // A row per candidate + the escape = 3 buttons.
    expect(
      screen.getByRole("button", { name: /brake inspection/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /have an advisor look/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /none of these/i }),
    ).toBeInTheDocument();
  });

  it("emits { action: 'select', candidate_key } when a candidate row is tapped", async () => {
    const onSubmit = vi.fn();
    render(
      <ConcernClarifyCard
        concern_text="squeak"
        candidates={CANDIDATES}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /brake inspection/i }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      action: "select",
      candidate_key: "brake_inspection",
    });
  });

  it("emits { action: 'none_of_these' } when the escape is tapped", async () => {
    const onSubmit = vi.fn();
    render(
      <ConcernClarifyCard
        concern_text="squeak"
        candidates={CANDIDATES}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: /none of these/i }),
    );
    expect(onSubmit).toHaveBeenCalledWith({ action: "none_of_these" });
  });

  it("renders 'From $49' for a priced candidate and the 'We'll take a look' pill for a null-price one", () => {
    render(
      <ConcernClarifyCard
        concern_text="squeak"
        candidates={CANDIDATES}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("From $49")).toBeInTheDocument();
    expect(screen.getByText(/we'll take a look/i)).toBeInTheDocument();
  });

  it("disables all controls while a candidate submit is in flight", async () => {
    // A never-resolving onSubmit keeps the card in the pending state.
    let resolve!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(
      <ConcernClarifyCard
        concern_text="squeak"
        candidates={CANDIDATES}
        onSubmit={onSubmit}
      />,
    );

    const brakeRow = screen.getByRole("button", { name: /brake inspection/i });
    await userEvent.click(brakeRow);

    // Every candidate row + the escape become disabled while pending.
    expect(brakeRow).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /have an advisor look/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /none of these/i }),
    ).toBeDisabled();

    resolve();
  });

  it("disables all controls when the disabled prop is set", () => {
    render(
      <ConcernClarifyCard
        concern_text="squeak"
        candidates={CANDIDATES}
        onSubmit={vi.fn()}
        disabled
      />,
    );

    expect(
      screen.getByRole("button", { name: /brake inspection/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /none of these/i }),
    ).toBeDisabled();
  });

  it("hides the quote block when concern_text is empty/whitespace but still renders the escape", () => {
    render(
      <ConcernClarifyCard
        concern_text="   "
        candidates={CANDIDATES}
        onSubmit={vi.fn()}
      />,
    );

    // No caption when there's no concern text.
    expect(
      screen.queryByText(/here's what you told me/i),
    ).not.toBeInTheDocument();
    // The advisor escape is always present.
    expect(
      screen.getByRole("button", { name: /none of these/i }),
    ).toBeInTheDocument();
  });
});
