/**
 * Consent-capture tests (revamp Phase 2, design spec
 * scheduler-comms-consent-spec.md §9):
 *   - PhoneNameCard: checkbox exists, unchecked by default, toggles, NEVER
 *     gates the submit button, and threads sms_consent through onSubmit.
 *   - CompletedCard: consent-aware what-happens-next variants.
 *   - Checkbox primitive: native checkbox semantics + description wiring.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PhoneNameCard } from "@/components/scheduler/heritage/PhoneNameCard";
import { CompletedCard } from "@/components/scheduler/heritage/CompletedCard";
import { Checkbox } from "@/components/ui";

describe("PhoneNameCard consent capture", () => {
  it("renders the opt-in checkbox UNCHECKED by default with the disclosure copy", () => {
    render(<PhoneNameCard onSubmit={vi.fn()} />);
    const box = screen.getByRole("checkbox", {
      name: /text me appointment updates/i,
    });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/reply stop to opt out/i)).toBeInTheDocument();
    expect(screen.getByText(/msg & data rates may apply/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /privacy policy/i }),
    ).toBeInTheDocument();
    // The old non-compliant footnote is gone.
    expect(
      screen.queryByText(/standard texting rates apply/i),
    ).not.toBeInTheDocument();
  });

  it("submit stays ENABLED while the checkbox is unchecked (never gates)", () => {
    render(<PhoneNameCard onSubmit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /send my code/i }),
    ).toBeEnabled();
  });

  it("threads sms_consent=false by default through onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PhoneNameCard onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/first name/i), "pat");
    await user.type(screen.getByLabelText(/last name/i), "tester");
    await user.type(screen.getByLabelText(/phone number/i), "6105551234");
    await user.click(screen.getByRole("button", { name: /send my code/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+16105551234",
        sms_consent: false,
      }),
    );
  });

  it("threads sms_consent=true when checked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PhoneNameCard onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/first name/i), "pat");
    await user.type(screen.getByLabelText(/last name/i), "tester");
    await user.type(screen.getByLabelText(/phone number/i), "6105551234");
    await user.click(
      screen.getByRole("checkbox", { name: /text me appointment updates/i }),
    );
    await user.click(screen.getByRole("button", { name: /send my code/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ sms_consent: true }),
    );
  });
});

const completedCopy = {
  eyebrow: "All done",
  title_named: "You're all set, {{first_name}}.",
  title_anon: "You're all set.",
  description:
    "We'll see you {{appointment_label}}. If anything comes up, text or call us at {{shop_phone}} and someone on our team will help you out.",
  next_label: "What happens next",
  next_booked: "We've booked it in our system",
  next_reminders_consent:
    "We'll text and email your confirmation and a reminder before your visit.",
  next_reminders_noconsent:
    "Your confirmation and summary are saved right here in this chat. Want text + email reminders? Just tell us at your visit and we'll turn them on.",
  next_keys: "Bring your keys and we'll take it from here",
  thanks:
    "Thanks for choosing {{shop_name}} — we appreciate it. A confirmation summary stays in this chat for your reference.",
  footnote: "Family-owned since 1976 · Questions? {{shop_phone}}",
};

describe("CompletedCard consent-aware copy", () => {
  it("consented: promises text + email confirmation and reminder", () => {
    render(<CompletedCard copy={completedCopy} sms_consent={true} />);
    expect(
      screen.getByText(/we'll text and email your confirmation/i),
    ).toBeInTheDocument();
  });

  it("not consented (default): promises nothing by text or email", () => {
    render(<CompletedCard copy={completedCopy} />);
    expect(
      screen.getByText(/saved right here in this chat/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/we'll text and email your confirmation/i),
    ).not.toBeInTheDocument();
  });
});

describe("Checkbox primitive", () => {
  it("is a real native checkbox with label + description association", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Checkbox
        id="t-check"
        checked={false}
        onChange={onChange}
        aria-describedby="t-note"
        description={<span id="t-note">helper text</span>}
      >
        Accept the thing
      </Checkbox>,
    );
    const box = screen.getByRole("checkbox", { name: /accept the thing/i });
    expect(box).toHaveAttribute("aria-describedby", "t-note");
    await user.click(box);
    expect(onChange).toHaveBeenCalled();
  });
});
