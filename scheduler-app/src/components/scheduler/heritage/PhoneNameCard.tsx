"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Checkbox, Field, Input } from "@/components/ui";
import {
  APPT_SMS_CONSENT_STATEMENT,
  APPT_SMS_OPT_OUT_LABEL,
  CONSENT_PRIVACY_URL,
  CONSENT_TERMS_URL,
} from "@/lib/scheduler/consent-copy";
import type { CardCopy } from "@/lib/scheduler/card-text";

/**
 * Step 2 — Phone + Name card (Heritage exemplar).
 *
 * Replaces the legacy PhoneEntry component (which was phone-only). Per Chris's
 * design lock 2026-05-13, Step 2 captures FIRST + LAST + PHONE together so the
 * orchestrator has enough data to disambiguate from the first OTP attempt.
 *
 * Phone format: US/Canada only (per Phase 1 constraint). Normalized to E.164
 * on submit; displayed as (xxx) xxx-xxxx during typing for readability.
 *
 * Names: trimmed, capitalize-first auto-applied per chat-design.md ("Sarah"
 * not "sarah") so the chat bubble greeting reads naturally.
 *
 * Heritage style: Poppins title + form fields, gold-rule card boundary,
 * 8px fade-in on mount, mobile-first 44px tap targets.
 */

export interface PhoneNameCardProps {
  /** Editable card copy (card-text-editor) — resolved slot strings. */
  copy: CardCopy<"phone_name">;
  /** Optional context for the eyebrow label (e.g. "Step 2 of 10"). */
  step_label?: string;
  /** Prefilled name fields when resuming. */
  initial_first_name?: string;
  initial_last_name?: string;
  /** Prefilled phone (E.164) when resuming. */
  initial_phone_e164?: string;
  disabled?: boolean;
  onSubmit: (output: {
    first_name: string;
    last_name: string;
    phone: string; // E.164 +1xxxxxxxxxx
    /** Opt-OUT of transactional appointment texts (2026-07-17). Default false
     *  = box left unchecked = consented. NEVER gates submit — the OTP rides
     *  its own consent basis. */
    sms_opt_out: boolean;
  }) => void | Promise<void>;
}

function normalizeToE164US(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

function formatForDisplay(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function capitalizeFirst(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  return trimmed[0]!.toUpperCase() + trimmed.slice(1);
}

function e164ToDisplay(e164: string): string {
  // +1 6105557777 → (610) 555-7777
  const digits = e164.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  return formatForDisplay(last10);
}

export function PhoneNameCard({
  copy,
  step_label = "Verify it's you",
  initial_first_name = "",
  initial_last_name = "",
  initial_phone_e164 = "",
  disabled = false,
  onSubmit,
}: PhoneNameCardProps) {
  const [firstName, setFirstName] = useState(initial_first_name);
  const [lastName, setLastName] = useState(initial_last_name);
  const [phoneDisplay, setPhoneDisplay] = useState(
    initial_phone_e164 ? e164ToDisplay(initial_phone_e164) : "",
  );
  const [errors, setErrors] = useState<{
    firstName?: string;
    lastName?: string;
    phone?: string;
  }>({});
  const [pending, setPending] = useState(false);
  // Appointment-SMS OPT-OUT — unchecked by default (2026-07-17): appointment
  // texts are transactional, so leaving this unchecked = consent. NEVER
  // appears in any disabled=/validation branch: the OTP has its own basis.
  const [smsOptOut, setSmsOptOut] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || disabled) return;

    const fn = firstName.trim();
    const ln = lastName.trim();
    const e164 = normalizeToE164US(phoneDisplay);

    const nextErrors: typeof errors = {};
    // Spec (chat-design.md line 488-489): 1-50 chars after trim. Two-letter
    // names (Bo, Al, Jo, Mo, Ed, Ty, many South + East Asian names) are
    // valid. Empty-only rejection.
    if (fn.length === 0) nextErrors.firstName = "Please enter your first name.";
    if (ln.length === 0) nextErrors.lastName = "Please enter your last name.";
    if (!e164) {
      nextErrors.phone = "Please enter a 10-digit US or Canadian phone number.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setPending(true);
    try {
      await onSubmit({
        first_name: capitalizeFirst(fn),
        last_name: capitalizeFirst(ln),
        phone: e164!,
        sms_opt_out: smsOptOut,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="phone-name-title">
      <Card.Eyebrow>{step_label}</Card.Eyebrow>
      <Card.Title id="phone-name-title">{copy.title}</Card.Title>
      <Card.Description>{copy.description}</Card.Description>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
        className="contents"
      >
        <Card.Body className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="First name" required error={errors.firstName} inputId="pn-first">
              {({ id, ariaDescribedBy, ariaInvalid }) => (
                <Input
                  id={id}
                  type="text"
                  autoComplete="given-name"
                  placeholder="Sarah"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={pending || disabled}
                  aria-describedby={ariaDescribedBy}
                  aria-invalid={ariaInvalid}
                  required
                />
              )}
            </Field>

            <Field label="Last name" required error={errors.lastName} inputId="pn-last">
              {({ id, ariaDescribedBy, ariaInvalid }) => (
                <Input
                  id={id}
                  type="text"
                  autoComplete="family-name"
                  placeholder="Johnson"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={pending || disabled}
                  aria-describedby={ariaDescribedBy}
                  aria-invalid={ariaInvalid}
                  required
                />
              )}
            </Field>
          </div>

          <Field
            label="Phone number"
            required
            help="US or Canada — we'll text the code right away."
            error={errors.phone}
            inputId="pn-phone"
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <Input
                id={id}
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="(610) 555-0123"
                value={phoneDisplay}
                onChange={(e) => setPhoneDisplay(formatForDisplay(e.target.value))}
                disabled={pending || disabled}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
                required
              />
            )}
          </Field>
        </Card.Body>

        {/* SMS-consent panel (revamp Phase 2; design spec
            scheduler-comms-consent-spec.md §4). OPTIONAL by design — the
            checkbox never gates the submit button; the OTP text rides its
            own consent basis (the customer requests the code). Checked =
            confirmation/reminder texts allowed; the exact disclosure copy
            is versioned in consent-copy.ts and persisted server-side on
            grant (TCPA proof-of-consent). */}
        <Card.Body className="mt-5">
          <div className="rounded-[var(--radius-input)] border border-rule bg-paper-200 px-4 py-3.5">
            <p className="label-eyebrow mb-2">Appointment texts</p>
            <Checkbox
              id="pn-sms-opt-out"
              name="sms_opt_out"
              checked={smsOptOut}
              onChange={(e) => setSmsOptOut(e.target.checked)}
              disabled={pending || disabled}
              aria-describedby="pn-sms-opt-out-note"
              description={
                <span id="pn-sms-opt-out-note">{APPT_SMS_CONSENT_STATEMENT}</span>
              }
            >
              <span className="text-[14px] font-medium leading-snug text-ink">
                {APPT_SMS_OPT_OUT_LABEL}
              </span>
              {/* Fine print stays ink-secondary on paper-200 — ink-tertiary
                  fails AA here (design spec §2 contrast trap). */}
              <span className="mt-1 block text-[12px] leading-relaxed text-ink-secondary">
                Appointment confirmations &amp; reminders, up to ~4 messages
                per appointment. Msg &amp; data rates may apply. Reply STOP to
                opt out, HELP for help. See our{" "}
                <a
                  href={CONSENT_TERMS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-burgundy-700 underline underline-offset-2 hover:text-brand-burgundy-800"
                >
                  Terms<span className="sr-only"> (opens in a new tab)</span>
                </a>{" "}
                and{" "}
                <a
                  href={CONSENT_PRIVACY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand-burgundy-700 underline underline-offset-2 hover:text-brand-burgundy-800"
                >
                  Privacy Policy
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
                .
              </span>
            </Checkbox>
          </div>
        </Card.Body>

        {/* While pending, surface a "sending your code" reassurance line
            above the button. The full chain takes ~4-5s end-to-end
            (Tekmetric lookup + LLM specialist + Telnyx send) and silent
            spinners feel broken to customers per chat-design.md §D.2. */}
        {pending ? (
          <p
            role="status"
            aria-live="polite"
            className="-mb-2 mt-3 flex items-center gap-2 text-[13px] text-ink-secondary"
          >
            <span
              aria-hidden
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-burgundy-300 border-t-brand-burgundy-700"
            />
            Texting your security code now…
          </p>
        ) : null}

        <Card.Actions>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={pending}
            disabled={disabled}
            fullWidthOnMobile
          >
            {pending ? "Sending code…" : "Send my code"}
          </Button>
        </Card.Actions>
      </form>

      <Card.Footnote>{copy.footnote}</Card.Footnote>
    </Card>
  );
}
