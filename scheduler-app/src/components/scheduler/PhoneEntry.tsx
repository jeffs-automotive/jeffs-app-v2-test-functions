"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "@/components/ui";

/**
 * PhoneEntry rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Legacy phone-only entry. The richer Step 2 phone+name capture lives in
 * `heritage/PhoneNameCard.tsx` and is rendered via the new
 * `show_phone_name_card` directive. This card stays for any orchestrator
 * paths still emitting the legacy `show_phone_entry` directive.
 *
 * Per appointments_design.md §7.3 + §7.5:
 * - Input: optional `reason` string
 * - Output: { phone: string }   // E.164 US/Canada (+1xxxxxxxxxx)
 */

export interface PhoneEntryProps {
  reason?: string;
  onSubmit: (output: { phone: string }) => void | Promise<void>;
  disabled?: boolean;
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

export function PhoneEntry({
  reason,
  onSubmit,
  disabled = false,
}: PhoneEntryProps) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || disabled) return;
    const e164 = normalizeToE164US(raw);
    if (!e164) {
      setError("Please enter a 10-digit US or Canadian phone number.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({ phone: e164 });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="phone-entry-heading">
      <Card.Eyebrow>Step 2 · Phone number</Card.Eyebrow>
      <Card.Title id="phone-entry-heading">What&apos;s a good number? 📱</Card.Title>
      {reason ? (
        <Card.Description>{reason}</Card.Description>
      ) : (
        <Card.Description>
          I&apos;ll send a one-time code to verify it&apos;s really you.
        </Card.Description>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="contents">
        <Card.Body>
          <Field
            label="Phone number"
            required
            help="US or Canada — standard texting rates apply."
            error={error ?? undefined}
            inputId="phone-entry-input"
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <Input
                id={id}
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                placeholder="(610) 555-0123"
                value={formatForDisplay(raw)}
                onChange={(e) => setRaw(e.target.value)}
                disabled={pending || disabled}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
                required
              />
            )}
          </Field>
        </Card.Body>

        <Card.Actions>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={pending}
            disabled={disabled}
            fullWidthOnMobile
          >
            Send my code
          </Button>
        </Card.Actions>
      </form>
    </Card>
  );
}
