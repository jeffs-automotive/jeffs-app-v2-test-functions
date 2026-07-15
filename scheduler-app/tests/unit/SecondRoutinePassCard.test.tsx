import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SecondRoutinePassCard } from "@/components/scheduler/heritage/SecondRoutinePassCard";

// card-text-editor: SecondRoutinePassCard now takes editable `copy`. Fixture
// matches CARD_TEXT_DEFAULTS.second_routine_pass.
const secondRoutineCopy = {
  eyebrow: "Anything else?",
  title: "Want to add anything else while you're here?",
  description:
    "Tap any of these to add them on. The ones you've already picked are marked.",
  body_describe_prompt:
    "Noticing something that isn't on the list — a noise, a leak, a warning light?",
};

/**
 * SecondRoutinePassCard — the last-chance add-on picker + the EH2
 * "Describe another issue" ghost path.
 *
 * The describe path (task EH2) is additive: the existing chip grid,
 * already_picked handling, and the single conditional primary CTA are
 * unchanged. The describe button submits { added, describe_issue: true }
 * preserving any chips the customer toggled, and only the pressed control
 * spins (action discriminator).
 */

const COMMON = [
  { service_key: "oil_change", display_name: "Oil Change" },
  { service_key: "tire_rotation", display_name: "Tire Rotation" },
  { service_key: "wiper_blades", display_name: "Wiper Blades" },
];

describe("<SecondRoutinePassCard /> — existing add-on behavior (unchanged)", () => {
  it("shows 'Continue without adding more' when nothing new is selected", () => {
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={COMMON}
        already_picked={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /continue without adding more/i }),
    ).toBeInTheDocument();
  });

  it("switches to 'Add and continue' and submits { added } for the toggled chip", async () => {
    const onSubmit = vi.fn();
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={COMMON}
        already_picked={[]}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /oil change/i }));
    const cta = screen.getByRole("button", { name: /add and continue/i });
    await userEvent.click(cta);
    expect(onSubmit).toHaveBeenCalledWith({ added: ["oil_change"] });
  });
});

describe("<SecondRoutinePassCard /> — describe-another-issue path (EH2)", () => {
  it("renders the describe button, enabled", () => {
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={COMMON}
        already_picked={[]}
        onSubmit={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: /describe another issue/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toBeEnabled();
  });

  it("fires { added: [], describe_issue: true } when nothing is selected", async () => {
    const onSubmit = vi.fn();
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={COMMON}
        already_picked={[]}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /describe another issue/i }),
    );
    expect(onSubmit).toHaveBeenCalledWith({
      added: [],
      describe_issue: true,
    });
  });

  it("preserves toggled chips: fires { added: [selected...], describe_issue: true }", async () => {
    const onSubmit = vi.fn();
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={COMMON}
        already_picked={[]}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /oil change/i }));
    await userEvent.click(
      screen.getByRole("button", { name: /wiper blades/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /describe another issue/i }),
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const arg = onSubmit.mock.calls[0]![0] as {
      added: string[];
      describe_issue: boolean;
    };
    expect(arg.describe_issue).toBe(true);
    expect(arg.added.sort()).toEqual(["oil_change", "wiper_blades"]);
  });

  it("shows the describe path even when common_services is empty (no chips)", () => {
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={[]}
        already_picked={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /describe another issue/i }),
    ).toBeInTheDocument();
    // No hairline divider when there are no chips (role="separator" absent).
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("renders the divider above the describe path when chips are present", () => {
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={COMMON}
        already_picked={[]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("separator", { hidden: true })).toBeInTheDocument();
  });

  it("spins ONLY the describe control while its submit is in flight (discrimination)", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={COMMON}
        already_picked={[]}
        onSubmit={onSubmit}
      />,
    );

    const describeBtn = screen.getByRole("button", {
      name: /describe another issue/i,
    });
    await userEvent.click(describeBtn);

    // The describe control shows the busy state; the primary CTA does not.
    expect(describeBtn).toHaveAttribute("aria-busy", "true");
    const primary = screen.getByRole("button", {
      name: /continue without adding more/i,
    });
    expect(primary).not.toHaveAttribute("aria-busy", "true");
    // Both are disabled while pending.
    expect(describeBtn).toBeDisabled();
    expect(primary).toBeDisabled();

    resolve();
  });

  it("spins ONLY the primary control while an add submit is in flight (discrimination)", async () => {
    let resolve!: () => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    render(
      <SecondRoutinePassCard
        copy={secondRoutineCopy}
        common_services={COMMON}
        already_picked={[]}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /oil change/i }));
    const cta = screen.getByRole("button", { name: /add and continue/i });
    await userEvent.click(cta);

    expect(cta).toHaveAttribute("aria-busy", "true");
    const describeBtn = screen.getByRole("button", {
      name: /describe another issue/i,
    });
    expect(describeBtn).not.toHaveAttribute("aria-busy", "true");

    resolve();
  });
});
