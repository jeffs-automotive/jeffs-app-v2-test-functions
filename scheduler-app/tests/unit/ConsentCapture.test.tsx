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

// card-text-editor: PhoneNameCard now takes editable `copy`. Fixture matches
// CARD_TEXT_DEFAULTS.phone_name (title/description/footnote).
const phoneNameCopy = {
  title: "Let's grab a few quick details.",
  description:
    "We'll send a one-time code to your phone to verify it's really you. 📲",
  footnote:
    "By continuing, you agree this conversation may be recorded and reviewed by our team to help us serve you better.",
};

describe("PhoneNameCard appointment-SMS opt-out", () => {
  const OPT_OUT_LABEL = /don't send me text messages about my appointment/i;

  it("renders the opt-OUT checkbox UNCHECKED by default with the consent disclosure", () => {
    render(<PhoneNameCard copy={phoneNameCopy} onSubmit={vi.fn()} />);
    const box = screen.getByRole("checkbox", { name: OPT_OUT_LABEL });
    expect(box).not.toBeChecked();
    // Leaving it unchecked = consent — the disclosure states so.
    expect(
      screen.getByText(/by not checking this box, you consent/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/reply stop to opt out/i)).toBeInTheDocument();
    expect(screen.getByText(/msg & data rates may apply/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /privacy policy/i }),
    ).toBeInTheDocument();
  });

  it("submit stays ENABLED regardless of the opt-out box (never gates)", () => {
    render(<PhoneNameCard copy={phoneNameCopy} onSubmit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /send my code/i }),
    ).toBeEnabled();
  });

  it("threads sms_opt_out=false by default (unchecked = consented) through onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PhoneNameCard copy={phoneNameCopy} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/first name/i), "pat");
    await user.type(screen.getByLabelText(/last name/i), "tester");
    await user.type(screen.getByLabelText(/phone number/i), "6105551234");
    await user.click(screen.getByRole("button", { name: /send my code/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+16105551234",
        sms_opt_out: false,
      }),
    );
  });

  it("threads sms_opt_out=true when the customer checks the opt-out box", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<PhoneNameCard copy={phoneNameCopy} onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/first name/i), "pat");
    await user.type(screen.getByLabelText(/last name/i), "tester");
    await user.type(screen.getByLabelText(/phone number/i), "6105551234");
    await user.click(screen.getByRole("checkbox", { name: OPT_OUT_LABEL }));
    await user.click(screen.getByRole("button", { name: /send my code/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ sms_opt_out: true }),
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
