"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * EscalationCard component (Heritage Editorial refactor 2026-05-13).
 *
 * Contract:
 * - Props: { reason: string, shop_phone: string }
 * - Emits: { acknowledged: boolean }
 *
 * Shown when the wizard escalates (manager keyword, hostile sentiment,
 * identity unverifiable after 2 tries, tool failure after retry,
 * refund/dispute/warranty/complaint, etc.).
 */

export interface EscalationCardProps {
  reason: string;
  shop_phone: string;
  /**
   * When true (default), show the "Back to scheduling" CTA per
   * chat-design.md §A lines 2873-2898. Some escalation contexts (terminal
   * abandons, post-confirm complaints) hide it — pass false in those.
   */
  allow_back_to_scheduling?: boolean;
  onSubmit: (
    output:
      | { acknowledged: boolean }
      | { action: "back_to_scheduling" },
  ) => void | Promise<void>;
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
  allow_back_to_scheduling = true,
  onSubmit,
  disabled = false,
}: EscalationCardProps) {
  const [submitting, setSubmitting] = useState<"ack" | "back" | null>(null);

  async function ack() {
    if (disabled || submitting !== null) return;
    setSubmitting("ack");
    try {
      await onSubmit({ acknowledged: true });
    } finally {
      setSubmitting(null);
    }
  }

  async function backToScheduling() {
    if (disabled || submitting !== null) return;
    setSubmitting("back");
    try {
      await onSubmit({ action: "back_to_scheduling" });
    } finally {
      setSubmitting(null);
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
          aria-label={`Call Jeff's Automotive at ${displayPhone}`}
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

      <Card.Actions align="between">
        <Button
          variant="ghost"
          size="md"
          disabled={disabled || submitting !== null}
          loading={submitting === "ack"}
          onClick={() => void ack()}
          fullWidthOnMobile={false}
        >
          I&apos;ll call — close this chat
        </Button>
        {allow_back_to_scheduling ? (
          <Button
            variant="primary"
            size="md"
            disabled={disabled || submitting !== null}
            loading={submitting === "back"}
            onClick={() => void backToScheduling()}
            fullWidthOnMobile={false}
          >
            Back to scheduling
          </Button>
        ) : null}
      </Card.Actions>
    </Card>
  );
}
