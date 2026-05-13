"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "@/components/ui";

/**
 * Step 4 (new client) — New customer info card per chat-design.md §2595-2683.
 *
 * Collects the contact info we need to create the Tekmetric customer
 * record IMMEDIATELY on submit (per spec — no deferred POST).
 *
 *   Name      READ-ONLY from Step 2 (verified_first_name + verified_last_name)
 *   Phone     READ-ONLY ("primary — verified"): the OTP-verified channel.
 *             Customer can ADD an additional phone (max 1 more).
 *             New phone defaults to primary per §2629 symmetry rule.
 *   Emails    Primary required + optional 2nd (max 2 total).
 *   Address   Required: line1 + city + state + zip (line2 optional).
 *
 * On submit the parent Server Action calls Tekmetric POST /customers.
 * If 409 fires the parent routes back to the returning-customer flow.
 */

const PHONE_DISPLAY_REGEX = /^(\d{0,3})(\d{0,3})(\d{0,4})$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatPhoneForDisplay(input: string): string {
  const d = input.replace(/\D/g, "").slice(0, 10);
  const m = d.match(PHONE_DISPLAY_REGEX);
  if (!m) return d;
  const [, a, b, c] = m;
  if (!a) return "";
  if (!b) return a;
  if (!c) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function normalizePhoneE164(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

function e164ToDisplay(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return formatPhoneForDisplay(d);
}

export interface NewCustomerInfoCardProps {
  /** Pulled from Step 2's PhoneName submission — display-only. */
  first_name: string;
  last_name: string;
  /** The OTP-verified phone in E.164 — display-only. */
  verified_phone_e164: string;
  disabled?: boolean;
  onSubmit: (output: {
    /** Always includes the verified phone (primary by default). */
    edited_phones: Array<{ phone_e164: string; is_primary: boolean }>;
    /** At least one required; first becomes primary if no flag set. */
    edited_emails: Array<{ email: string; is_primary: boolean }>;
    /** All four fields required (address1, city, state, zip). */
    edited_address: {
      address1: string;
      address2?: string;
      city: string;
      state: string;
      zip: string;
    };
    primary_email_for_description: string;
  }) => void | Promise<void>;
}

interface PhoneDraft {
  display: string;
  is_primary: boolean;
  is_verified: boolean;
}

interface EmailDraft {
  value: string;
  is_primary: boolean;
}

const US_STATES = [
  "PA", "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA",
  "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY", "DC",
];

export function NewCustomerInfoCard({
  first_name,
  last_name,
  verified_phone_e164,
  disabled = false,
  onSubmit,
}: NewCustomerInfoCardProps) {
  const [phones, setPhones] = useState<PhoneDraft[]>(() => [
    {
      display: e164ToDisplay(verified_phone_e164),
      is_primary: true,
      is_verified: true,
    },
  ]);
  const [emails, setEmails] = useState<EmailDraft[]>(() => [
    { value: "", is_primary: true },
  ]);
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("PA");
  const [zip, setZip] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const canAddPhone = phones.length < 2;
  const canAddEmail = emails.length < 2;

  function updatePhoneDisplay(idx: number, display: string) {
    setPhones((prev) => {
      const next = [...prev];
      const cur = next[idx];
      if (!cur || cur.is_verified) return prev;
      next[idx] = { ...cur, display: formatPhoneForDisplay(display) };
      return next;
    });
  }

  function setPrimaryPhone(idx: number) {
    setPhones((prev) => prev.map((p, i) => ({ ...p, is_primary: i === idx })));
  }

  function addPhone() {
    if (!canAddPhone) return;
    // Per spec §2629: new phone defaults to primary (symmetry rule).
    setPhones((prev) => [
      ...prev.map((p) => ({ ...p, is_primary: false })),
      { display: "", is_primary: true, is_verified: false },
    ]);
  }

  function removePhone(idx: number) {
    setPhones((prev) => {
      const cur = prev[idx];
      if (!cur || cur.is_verified) return prev;
      const next = prev.filter((_, i) => i !== idx);
      if (cur.is_primary && next.length > 0) {
        next[0] = { ...next[0]!, is_primary: true };
      }
      return next;
    });
  }

  function updateEmailValue(idx: number, value: string) {
    setEmails((prev) => {
      const next = [...prev];
      const cur = next[idx];
      if (!cur) return prev;
      next[idx] = { ...cur, value };
      return next;
    });
  }

  function setPrimaryEmail(idx: number) {
    setEmails((prev) => prev.map((e, i) => ({ ...e, is_primary: i === idx })));
  }

  function addEmail() {
    if (!canAddEmail) return;
    setEmails((prev) => [...prev, { value: "", is_primary: false }]);
  }

  function removeEmail(idx: number) {
    setEmails((prev) => {
      if (prev.length === 1) return prev;
      const wasPrimary = prev[idx]?.is_primary ?? false;
      const next = prev.filter((_, i) => i !== idx);
      if (wasPrimary && next.length > 0) {
        next[0] = { ...next[0]!, is_primary: true };
      }
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || disabled) return;

    const nextErrors: Record<string, string> = {};

    // ── Phones ────────────────────────────────────────────────────────
    const editedPhones: Array<{ phone_e164: string; is_primary: boolean }> = [];
    for (let i = 0; i < phones.length; i++) {
      const p = phones[i]!;
      if (p.is_verified) {
        editedPhones.push({
          phone_e164: verified_phone_e164,
          is_primary: p.is_primary,
        });
        continue;
      }
      if (!p.display.trim()) continue;
      const e164 = normalizePhoneE164(p.display);
      if (!e164) {
        nextErrors[`phone_${i}`] =
          "Please enter a 10-digit US or Canadian phone number.";
        continue;
      }
      if (editedPhones.some((ep) => ep.phone_e164 === e164)) {
        nextErrors[`phone_${i}`] = "Duplicate phone number.";
        continue;
      }
      editedPhones.push({ phone_e164: e164, is_primary: p.is_primary });
    }
    if (!editedPhones.some((p) => p.is_primary) && editedPhones[0]) {
      editedPhones[0].is_primary = true;
    }

    // ── Emails ────────────────────────────────────────────────────────
    const editedEmails: Array<{ email: string; is_primary: boolean }> = [];
    for (let i = 0; i < emails.length; i++) {
      const e = emails[i]!;
      const v = e.value.trim();
      if (!v) continue;
      if (!EMAIL_REGEX.test(v)) {
        nextErrors[`email_${i}`] = "Invalid email address.";
        continue;
      }
      if (editedEmails.some((ee) => ee.email === v)) {
        nextErrors[`email_${i}`] = "Duplicate email.";
        continue;
      }
      editedEmails.push({ email: v, is_primary: e.is_primary });
    }
    if (editedEmails.length === 0) {
      nextErrors.email_0 =
        "We need at least one email for the appointment confirmation.";
    } else if (!editedEmails.some((e) => e.is_primary)) {
      editedEmails[0]!.is_primary = true;
    }

    // ── Address (all required except line2) ───────────────────────────
    const a1 = address1.trim();
    const c = city.trim();
    const s = stateField.trim();
    const z = zip.trim();
    if (!a1) nextErrors.address1 = "Street address required.";
    if (!c) nextErrors.city = "City required.";
    if (!s) nextErrors.state = "State required.";
    if (!z) {
      nextErrors.zip = "ZIP required.";
    } else if (!/^\d{5}(-\d{4})?$/.test(z)) {
      nextErrors.zip = "ZIP must be 5 digits (or ZIP+4).";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setPending(true);
    try {
      await onSubmit({
        edited_phones: editedPhones,
        edited_emails: editedEmails,
        edited_address: {
          address1: a1,
          address2: address2.trim() || undefined,
          city: c,
          state: s,
          zip: z,
        },
        primary_email_for_description:
          editedEmails.find((e) => e.is_primary)?.email ?? "",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="new-customer-info-title">
      <Card.Eyebrow>Step 4 · Set up your account</Card.Eyebrow>
      <Card.Title id="new-customer-info-title">
        Welcome to Jeff&apos;s, {first_name}! 👋
      </Card.Title>
      <Card.Description>
        Just a few details so we can build your record. We&apos;ll save
        everything when you confirm the appointment.
      </Card.Description>

      <Card.Body>
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {/* Name banner — read-only */}
          <div className="rounded-md border border-ink-tertiary/20 bg-paper-100 px-3 py-2 text-sm text-ink-secondary">
            <span className="font-medium text-ink">
              {first_name} {last_name}
            </span>
            <span className="block text-xs text-ink-tertiary">
              Name on file — based on what you entered earlier.
            </span>
          </div>

          {/* Phones */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">
              Phone {phones.length > 1 ? "numbers" : "number"}
            </legend>
            {phones.map((p, idx) => (
              <div key={`phone-${idx}`} className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field
                      label={
                        idx === 0 ? "Primary phone" : `Additional phone ${idx + 1}`
                      }
                      help={p.is_verified ? "Verified ✓" : undefined}
                      error={errors[`phone_${idx}`]}
                      inputId={`ncic-phone-${idx}`}
                    >
                      {({ id, ariaDescribedBy, ariaInvalid }) => (
                        <Input
                          id={id}
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={p.display}
                          onChange={(e) =>
                            updatePhoneDisplay(idx, e.target.value)
                          }
                          placeholder="(610) 555-0123"
                          disabled={disabled || pending || p.is_verified}
                          aria-describedby={ariaDescribedBy}
                          aria-invalid={ariaInvalid}
                        />
                      )}
                    </Field>
                  </div>
                  {!p.is_verified && phones.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || pending}
                      onClick={() => removePhone(idx)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                {phones.length > 1 ? (
                  <label className="flex items-center gap-2 text-xs text-ink-secondary">
                    <input
                      type="radio"
                      name="primary-phone"
                      checked={p.is_primary}
                      onChange={() => setPrimaryPhone(idx)}
                      disabled={disabled || pending}
                    />
                    Use as primary
                  </label>
                ) : null}
              </div>
            ))}
            {canAddPhone ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || pending}
                onClick={addPhone}
              >
                + Add another phone
              </Button>
            ) : null}
          </fieldset>

          {/* Emails */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">
              Email {emails.length > 1 ? "addresses" : "address"}
            </legend>
            {emails.map((em, idx) => (
              <div key={`email-${idx}`} className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field
                      label={
                        idx === 0
                          ? "Primary email (confirmation goes here)"
                          : `Additional email ${idx + 1}`
                      }
                      required={idx === 0}
                      error={errors[`email_${idx}`]}
                      inputId={`ncic-email-${idx}`}
                    >
                      {({ id, ariaDescribedBy, ariaInvalid }) => (
                        <Input
                          id={id}
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={em.value}
                          onChange={(e) =>
                            updateEmailValue(idx, e.target.value)
                          }
                          placeholder="you@example.com"
                          disabled={disabled || pending}
                          aria-describedby={ariaDescribedBy}
                          aria-invalid={ariaInvalid}
                        />
                      )}
                    </Field>
                  </div>
                  {emails.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={disabled || pending}
                      onClick={() => removeEmail(idx)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
                {emails.length > 1 ? (
                  <label className="flex items-center gap-2 text-xs text-ink-secondary">
                    <input
                      type="radio"
                      name="primary-email"
                      checked={em.is_primary}
                      onChange={() => setPrimaryEmail(idx)}
                      disabled={disabled || pending}
                    />
                    Use as primary
                  </label>
                ) : null}
              </div>
            ))}
            {canAddEmail ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || pending}
                onClick={addEmail}
              >
                + Add another email
              </Button>
            ) : null}
          </fieldset>

          {/* Address */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink">Address</legend>

            <Field
              label="Street address"
              required
              error={errors.address1}
              inputId="ncic-addr1"
            >
              {({ id, ariaDescribedBy, ariaInvalid }) => (
                <Input
                  id={id}
                  type="text"
                  autoComplete="address-line1"
                  value={address1}
                  onChange={(e) => setAddress1(e.target.value)}
                  placeholder="123 Main Street"
                  disabled={disabled || pending}
                  aria-describedby={ariaDescribedBy}
                  aria-invalid={ariaInvalid}
                />
              )}
            </Field>

            <Field
              label="Apt / suite"
              help="Optional"
              inputId="ncic-addr2"
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="text"
                  autoComplete="address-line2"
                  value={address2}
                  onChange={(e) => setAddress2(e.target.value)}
                  disabled={disabled || pending}
                />
              )}
            </Field>

            <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
              <Field
                label="City"
                required
                error={errors.city}
                inputId="ncic-city"
              >
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <Input
                    id={id}
                    type="text"
                    autoComplete="address-level2"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Norristown"
                    disabled={disabled || pending}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                  />
                )}
              </Field>

              <Field
                label="State"
                required
                error={errors.state}
                inputId="ncic-state"
              >
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <select
                    id={id}
                    value={stateField}
                    onChange={(e) => setStateField(e.target.value)}
                    disabled={disabled || pending}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                    className="h-10 w-full rounded-[var(--radius-card)] border border-rule bg-paper-100 px-2 text-[15px]"
                  >
                    {US_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field
                label="ZIP"
                required
                error={errors.zip}
                inputId="ncic-zip"
              >
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <Input
                    id={id}
                    type="text"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    placeholder="19401"
                    disabled={disabled || pending}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                  />
                )}
              </Field>
            </div>
          </fieldset>

          <Button type="submit" disabled={disabled || pending} className="w-full">
            {pending ? "Saving…" : "Save and continue"}
          </Button>
        </form>
      </Card.Body>
    </Card>
  );
}
