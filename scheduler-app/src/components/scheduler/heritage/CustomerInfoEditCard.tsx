"use client";

import { useMemo, useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "@/components/ui";

/**
 * Step 5 (returning customer) — Customer info edit per chat-design.md
 * §Step 5 lines 940-1075.
 *
 * The Tekmetric §4.3 reconciliation found a match. Before letting the
 * customer proceed to vehicle pick we surface the current
 * phones/emails/address from Tekmetric and let them confirm/edit. This is
 * the ONLY chance to update Tekmetric values for a returning customer
 * within the wizard.
 *
 * Spec rules enforced:
 *   - Phones: max 2, exactly one primary. Customer can add a second OR
 *     replace primary OR keep as-is.
 *   - Emails: max 2, primary required for appointment.description. If
 *     Tekmetric has no email on file, this card MUST collect one before
 *     proceeding.
 *   - Address: optional in Phase 1 (no Places autocomplete yet);
 *     pre-filled from Tekmetric if present. Customer can edit any field.
 *
 * Output is consumed by submitCustomerInfoEdit which writes JSON arrays
 * to `customer_chat_sessions.edited_phones` + `edited_emails` +
 * `edited_address` + `primary_email_for_description`.
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

export interface PhoneEntry {
  phone_e164: string;
  is_primary: boolean;
}

export interface EmailEntry {
  email: string;
  is_primary: boolean;
}

export interface AddressEntry {
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface CustomerInfoEditCardProps {
  /** Name read from Tekmetric — display-only. Use verified_*. */
  first_name: string;
  last_name: string;
  /** Current Tekmetric phones (max 2). */
  initial_phones?: PhoneEntry[];
  /** Current Tekmetric emails (max 2). */
  initial_emails?: EmailEntry[];
  /** Current Tekmetric address. */
  initial_address?: AddressEntry;
  disabled?: boolean;
  onSubmit: (output: {
    edited_phones: PhoneEntry[];
    edited_emails: EmailEntry[];
    edited_address: AddressEntry | null;
    primary_email_for_description: string | null;
  }) => void | Promise<void>;
}

interface PhoneDraft {
  display: string;
  is_primary: boolean;
}

interface EmailDraft {
  value: string;
  is_primary: boolean;
}

export function CustomerInfoEditCard({
  first_name,
  last_name,
  initial_phones = [],
  initial_emails = [],
  initial_address = {},
  disabled = false,
  onSubmit,
}: CustomerInfoEditCardProps) {
  const [phones, setPhones] = useState<PhoneDraft[]>(() => {
    const seed = initial_phones.slice(0, 2).map((p) => ({
      display: e164ToDisplay(p.phone_e164),
      is_primary: p.is_primary,
    }));
    if (seed.length === 0) {
      return [{ display: "", is_primary: true }];
    }
    if (!seed.some((p) => p.is_primary)) {
      seed[0]!.is_primary = true;
    }
    return seed;
  });

  const [emails, setEmails] = useState<EmailDraft[]>(() => {
    const seed = initial_emails.slice(0, 2).map((e) => ({
      value: e.email,
      is_primary: e.is_primary,
    }));
    if (seed.length === 0) {
      return [{ value: "", is_primary: true }];
    }
    if (!seed.some((e) => e.is_primary)) {
      seed[0]!.is_primary = true;
    }
    return seed;
  });

  const [address1, setAddress1] = useState(initial_address.address1 ?? "");
  const [address2, setAddress2] = useState(initial_address.address2 ?? "");
  const [city, setCity] = useState(initial_address.city ?? "");
  const [stateField, setStateField] = useState(initial_address.state ?? "PA");
  const [zip, setZip] = useState(initial_address.zip ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const canAddPhone = phones.length < 2;
  const canAddEmail = emails.length < 2;

  const primaryEmail = useMemo(() => {
    const found = emails.find((e) => e.is_primary && e.value.trim());
    return found?.value.trim() ?? null;
  }, [emails]);

  function updatePhone(idx: number, patch: Partial<PhoneDraft>) {
    setPhones((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      // Ensure exactly one primary if marking one
      if (patch.is_primary === true) {
        for (let i = 0; i < next.length; i++) {
          if (i !== idx) next[i] = { ...next[i]!, is_primary: false };
        }
      }
      return next;
    });
  }

  function addPhone() {
    if (!canAddPhone) return;
    setPhones((prev) => [...prev, { display: "", is_primary: false }]);
  }

  function removePhone(idx: number) {
    setPhones((prev) => {
      if (prev.length === 1) return prev;
      const wasPrimary = prev[idx]?.is_primary ?? false;
      const next = prev.filter((_, i) => i !== idx);
      if (wasPrimary && next.length > 0) {
        next[0] = { ...next[0]!, is_primary: true };
      }
      return next;
    });
  }

  function updateEmail(idx: number, patch: Partial<EmailDraft>) {
    setEmails((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx]!, ...patch };
      if (patch.is_primary === true) {
        for (let i = 0; i < next.length; i++) {
          if (i !== idx) next[i] = { ...next[i]!, is_primary: false };
        }
      }
      return next;
    });
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

    // Validate phones — must have at least one valid + exactly one primary
    const editedPhones: PhoneEntry[] = [];
    for (let i = 0; i < phones.length; i++) {
      const p = phones[i]!;
      if (!p.display.trim()) {
        if (i === 0) nextErrors[`phone_${i}`] = "Phone number required.";
        continue;
      }
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
    if (editedPhones.length === 0) {
      nextErrors.phone_0 = nextErrors.phone_0 ?? "At least one phone required.";
    } else if (!editedPhones.some((p) => p.is_primary)) {
      editedPhones[0]!.is_primary = true;
    }

    // Validate emails — primary required if any provided; primary required overall
    const editedEmails: EmailEntry[] = [];
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

    // Address: optional in Phase 1. Validate zip format only if provided.
    if (zip.trim() && !/^\d{5}$/.test(zip.trim())) {
      nextErrors.zip = "ZIP must be 5 digits.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setPending(true);
    try {
      const addressOut: AddressEntry | null =
        address1.trim() || city.trim() || zip.trim()
          ? {
              address1: address1.trim() || undefined,
              address2: address2.trim() || undefined,
              city: city.trim() || undefined,
              state: stateField.trim() || undefined,
              zip: zip.trim() || undefined,
            }
          : null;

      await onSubmit({
        edited_phones: editedPhones,
        edited_emails: editedEmails,
        edited_address: addressOut,
        primary_email_for_description:
          editedEmails.find((e) => e.is_primary)?.email ?? null,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="customer-info-edit-title">
      <Card.Eyebrow>Confirm your info</Card.Eyebrow>
      <Card.Title id="customer-info-edit-title">
        Welcome back, {first_name}.
      </Card.Title>
      <Card.Description>
        Quick check that we&apos;ve got your contact info right. Update
        anything that&apos;s changed.
      </Card.Description>

      <Card.Body>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Read-only name banner */}
          <div className="rounded-md border border-ink-tertiary/20 bg-paper-100 px-3 py-2 text-sm text-ink-secondary">
            <span className="font-medium text-ink-primary">
              {first_name} {last_name}
            </span>
            <span className="block text-xs text-ink-tertiary">
              Name on file — contact us if this needs updating.
            </span>
          </div>

          {/* Phones */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink-primary">
              Phone {phones.length > 1 ? "numbers" : "number"}
            </legend>
            {phones.map((p, idx) => (
              <div key={`phone-${idx}`} className="space-y-2">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field
                      label={idx === 0 ? "Primary phone" : `Phone ${idx + 1}`}
                      error={errors[`phone_${idx}`]}
                      inputId={`phone-${idx}`}
                    >
                      {({ id, ariaDescribedBy, ariaInvalid }) => (
                        <Input
                          id={id}
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="(610) 555-0123"
                          value={p.display}
                          onChange={(e) =>
                            updatePhone(idx, {
                              display: formatPhoneForDisplay(e.target.value),
                            })
                          }
                          disabled={pending || disabled}
                          aria-describedby={ariaDescribedBy}
                          aria-invalid={ariaInvalid}
                        />
                      )}
                    </Field>
                  </div>
                  {phones.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending || disabled}
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
                      onChange={() => updatePhone(idx, { is_primary: true })}
                      disabled={pending || disabled}
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
                disabled={pending || disabled}
                onClick={addPhone}
              >
                + Add another phone
              </Button>
            ) : null}
          </fieldset>

          {/* Emails */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink-primary">
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
                          : `Email ${idx + 1}`
                      }
                      error={errors[`email_${idx}`]}
                      inputId={`email-${idx}`}
                    >
                      {({ id, ariaDescribedBy, ariaInvalid }) => (
                        <Input
                          id={id}
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          value={em.value}
                          onChange={(e) =>
                            updateEmail(idx, { value: e.target.value })
                          }
                          disabled={pending || disabled}
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
                      disabled={pending || disabled}
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
                      onChange={() => updateEmail(idx, { is_primary: true })}
                      disabled={pending || disabled}
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
                disabled={pending || disabled}
                onClick={addEmail}
              >
                + Add another email
              </Button>
            ) : null}
          </fieldset>

          {/* Address */}
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium text-ink-primary">
              Address (optional)
            </legend>
            <Field label="Street address" inputId="addr1">
              {({ id, ariaDescribedBy, ariaInvalid }) => (
                <Input
                  id={id}
                  autoComplete="address-line1"
                  placeholder="123 Main St"
                  value={address1}
                  onChange={(e) => setAddress1(e.target.value)}
                  disabled={pending || disabled}
                  aria-describedby={ariaDescribedBy}
                  aria-invalid={ariaInvalid}
                />
              )}
            </Field>
            <Field label="Apt / suite (optional)" inputId="addr2">
              {({ id, ariaDescribedBy, ariaInvalid }) => (
                <Input
                  id={id}
                  autoComplete="address-line2"
                  value={address2}
                  onChange={(e) => setAddress2(e.target.value)}
                  disabled={pending || disabled}
                  aria-describedby={ariaDescribedBy}
                  aria-invalid={ariaInvalid}
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_5rem_6rem]">
              <Field label="City" inputId="addr-city">
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <Input
                    id={id}
                    autoComplete="address-level2"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={pending || disabled}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                  />
                )}
              </Field>
              <Field label="State" inputId="addr-state">
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <Input
                    id={id}
                    autoComplete="address-level1"
                    maxLength={2}
                    value={stateField}
                    onChange={(e) =>
                      setStateField(e.target.value.toUpperCase().slice(0, 2))
                    }
                    disabled={pending || disabled}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                  />
                )}
              </Field>
              <Field
                label="ZIP"
                error={errors.zip}
                inputId="addr-zip"
              >
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    placeholder="19401"
                    value={zip}
                    onChange={(e) =>
                      setZip(e.target.value.replace(/\D/g, "").slice(0, 5))
                    }
                    disabled={pending || disabled}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                  />
                )}
              </Field>
            </div>
          </fieldset>

          <Card.Actions align="right">
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={pending}
              disabled={disabled}
              fullWidthOnMobile
            >
              Looks good
            </Button>
          </Card.Actions>

          {primaryEmail ? (
            <p className="text-xs text-ink-tertiary">
              Confirmation will go to{" "}
              <strong className="text-ink-secondary">{primaryEmail}</strong>.
            </p>
          ) : null}
        </form>
      </Card.Body>
    </Card>
  );
}
