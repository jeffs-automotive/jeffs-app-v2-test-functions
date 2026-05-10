"use client";

import { useState } from "react";

/**
 * EscalationCard rendering tool component.
 *
 * Per appointments_design.md §10 (escalation triggers) + §7.5:
 * - Input: { reason: string, shop_phone: string }
 * - Output: { acknowledged: boolean }
 *
 * Shown when the chat agent escalates per §10 triggers (manager keyword,
 * hostile sentiment, identity unverifiable, tool failure, refund/dispute/
 * warranty/complaint, etc.). Customer sees a clear apology + the shop
 * phone number; tapping "Got it" acknowledges and the conversation ends
 * with `outcome = 'escalation'`.
 *
 * On SMS the chat agent emits a plain-text equivalent instead of this card.
 */

export interface EscalationCardProps {
  reason: string;
  shop_phone: string;
  onSubmit: (output: { acknowledged: boolean }) => void | Promise<void>;
  disabled?: boolean;
}

/** Format E.164 +16102536565 → "(610) 253-6565" for display. */
function formatPhoneForDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  // Handle "+1XXXXXXXXXX" or "1XXXXXXXXXX" or "XXXXXXXXXX"
  const tenDigit = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits.length === 10
      ? digits
      : digits;
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
  const telHref = `tel:${shop_phone.replace(/\D/g, "")}`;

  return (
    <div
      role="group"
      aria-labelledby="escalation-heading"
      className="rounded-md border border-brand-gold-300 bg-brand-gold-50 p-4 shadow-sm"
    >
      <h3
        id="escalation-heading"
        className="mb-2 text-base font-semibold text-brand-burgundy-800"
      >
        Let's get you to a real person
      </h3>

      <p className="mb-3 text-sm text-gray-800">
        I'm sorry — I'm not able to handle that here. Please call us at{" "}
        <a
          className="font-semibold text-brand-burgundy-700 underline"
          href={telHref}
        >
          {displayPhone}
        </a>{" "}
        and we'll take care of you right away.
      </p>

      {reason ? (
        <p className="mb-3 text-xs italic text-gray-500">
          (Reason logged for our team: {reason})
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void ack()}
        disabled={disabled || submitting}
        className="rounded border border-gray-300 bg-white px-4 py-2 text-base font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        Got it, thanks
      </button>
    </div>
  );
}
