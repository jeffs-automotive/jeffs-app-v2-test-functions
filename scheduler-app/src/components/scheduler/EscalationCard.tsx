"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * EscalationCard rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Per appointments_design.md §10:
 * - Input: { reason: string, shop_phone: string }
 * - Output: { acknowledged: boolean }
 *
 * Shown when the chat agent escalates per §10 triggers (manager keyword,
 * hostile sentiment, identity unverifiable after 2 tries, tool failure
 * after retry, refund/dispute/warranty/complaint, etc.).
 *
 * On SMS the chat agent emits plain text instead of this card.
 */

export interface EscalationCardProps {
  reason: string;
  shop_phone: string;
  onSubmit: (output: { acknowledged: boolean }) => void | Promise<void>;
  disabled?: boolean;
}

function toTenDigit(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function formatPhoneForDisplay(phone: string): string {
  const tenDigit = toTenDigit(phone);
  if (tenDigit.length !== 10) return phone;
  return `(${tenDigit.slice(0, 3)}) ${tenDigit.slice(3, 6)}-${tenDigit.slice(6)}`;
}

export function EscalationCard({
  reason,
  shop_phone,
  onSubmit,
  disabled = false,
}: EscalationCardProps) {
  const [submitting, setSubmitting] = useState(false);

  async function ack() {
    if (disabled || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ acknowledged: true });
    } finally {
      setSubmitting(false);
    }
  }

  const displayPhone = formatPhoneForDisplay(shop_phone);
  const telDigits = toTenDigit(shop_phone);
  const telHref = `tel:${telDigits.length === 10 ? telDigits : shop_phone.replace(/\D/g, "")}`;

  return (
    <Card aria-labelledby="escalation-heading">
      <Card.Eyebrow>A real person can take it from here</Card.Eyebrow>
      <Card.Title id="escalation-heading">
        Let me get you over to the team 📞
      </Card.Title>
      <Card.Description>
        I&apos;m sorry — that&apos;s outside what I can handle from here.
        Please give us a call and we&apos;ll take care of you right away.
      </Card.Description>

      <Card.Body>
        <a
          href={telHref}
          className={
            "flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] " +
            "border border-brand-burgundy-700 bg-brand-burgundy-50 px-5 py-4 " +
            "text-[18px] font-medium text-brand-burgundy-700 " +
            "transition-colors duration-150 ease-out " +
            "hover:bg-brand-burgundy-100 " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 " +
            "focus-visible:outline-brand-burgundy-500"
          }
        >
          <span aria-hidden>📞</span>
          {displayPhone}
        </a>

        {reason ? (
          <p className="mt-3 text-[12px] italic text-ink-tertiary">
            (Logged for our team: {reason})
          </p>
        ) : null}
      </Card.Body>

      <Card.Actions align="left">
        <Button
          variant="ghost"
          size="md"
          disabled={disabled || submitting}
          loading={submitting}
          onClick={() => void ack()}
          fullWidthOnMobile={false}
        >
          Got it, thanks
        </Button>
      </Card.Actions>
    </Card>
  );
}
