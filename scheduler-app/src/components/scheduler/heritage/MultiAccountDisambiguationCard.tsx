"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Step 3.5c — Multi-account disambiguation per chat-design.md §3.5c.
 *
 * Renders when the phone lookup returns 2+ Tekmetric customer records.
 * Common cause: household members sharing a landline / family-plan
 * number. The customer picks which account is theirs by selecting from
 * a list, each row showing a recent vehicle so they can recognize their
 * own.
 *
 * Output: { selected_customer_id: number } or { action: "none_of_these" }
 * (the latter routes to NoMatchChoosePathCard).
 */

export interface MultiAccountCandidate {
  customer_id: number;
  first_name: string;
  last_name?: string | null;
  /** A friendly identifier — typically the customer's most-recent vehicle. */
  recent_vehicle?: string | null;
}

export interface MultiAccountDisambiguationCardProps {
  candidates: MultiAccountCandidate[];
  attempted_phone_last_four?: string | null;
  disabled?: boolean;
  onSubmit: (
    output:
      | { action: "select"; selected_customer_id: number }
      | { action: "none_of_these" },
  ) => void | Promise<void>;
}

export function MultiAccountDisambiguationCard({
  candidates,
  attempted_phone_last_four,
  disabled = false,
  onSubmit,
}: MultiAccountDisambiguationCardProps) {
  const [pending, setPending] = useState<string | null>(null);

  async function pickAccount(customer_id: number) {
    if (pending || disabled) return;
    setPending(`account-${customer_id}`);
    try {
      await onSubmit({ action: "select", selected_customer_id: customer_id });
    } finally {
      setPending(null);
    }
  }

  async function pickNone() {
    if (pending || disabled) return;
    setPending("none");
    try {
      await onSubmit({ action: "none_of_these" });
    } finally {
      setPending(null);
    }
  }

  return (
    <Card aria-labelledby="multi-account-title">
      <Card.Eyebrow>Step 3.5 · Which one are you?</Card.Eyebrow>
      <Card.Title id="multi-account-title">
        Looks like more than one account on this phone 📱
      </Card.Title>
      <Card.Description>
        {attempted_phone_last_four
          ? `The number ending in ${attempted_phone_last_four} is on file for `
          : "That number is on file for "}
        {candidates.length} folks. Which account is yours?
      </Card.Description>

      <Card.Body>
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.customer_id}>
              <button
                type="button"
                disabled={pending !== null || disabled}
                onClick={() => pickAccount(c.customer_id)}
                className={
                  "flex w-full flex-col items-start gap-1 rounded-[var(--radius-card)] " +
                  "border border-rule bg-paper-100 px-4 py-3 text-left " +
                  "transition-colors duration-150 ease-out " +
                  "hover:border-brand-burgundy-300 hover:bg-brand-burgundy-50 " +
                  "focus-visible:border-brand-burgundy-500 focus-visible:outline-2 " +
                  "focus-visible:outline-offset-2 focus-visible:outline-brand-burgundy-500 " +
                  "disabled:cursor-not-allowed disabled:opacity-60"
                }
              >
                <span className="text-[15px] font-medium text-ink">
                  {c.first_name}
                  {c.last_name ? ` ${c.last_name.charAt(0)}.` : ""}
                </span>
                {c.recent_vehicle ? (
                  <span className="text-[13px] text-ink-secondary">
                    Recent vehicle: {c.recent_vehicle}
                  </span>
                ) : (
                  <span className="text-[13px] italic text-ink-tertiary">
                    No vehicle on file
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Card.Body>

      <Card.Actions align="left">
        <Button
          variant="ghost"
          size="md"
          loading={pending === "none"}
          disabled={pending !== null || disabled}
          onClick={pickNone}
          fullWidthOnMobile
        >
          None of these are me
        </Button>
      </Card.Actions>

      <Card.Footnote>
        We&apos;ll only show your own appointments + history once we know
        which one you are. Your privacy matters.
      </Card.Footnote>
    </Card>
  );
}
