"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";

/**
 * Step 3.5b — No-match-choose-path per chat-design.md §3.5b.
 *
 * Renders when the §4.3 reconciliation matrix lands on "no match" AND
 * the customer self-identified as 'returning'. Two choices:
 *   1. "Continue as a new customer" → flips the flow to NewCustomerForm
 *   2. "Try a different phone" → bounces back to PhoneNameCard with the
 *      same name pre-filled but phone empty
 *
 * Warm Jeff-voice copy: this isn't an error, it's a fork — the customer
 * may have moved, changed numbers, or be a guest of a returning
 * customer.
 */

export interface NoMatchChoosePathCardProps {
  /** What the customer typed for their first name (so we can echo it back). */
  attempted_first_name?: string | null;
  /** Last 4 of the phone they entered, for the "didn't recognize" copy. */
  attempted_phone_last_four?: string | null;
  disabled?: boolean;
  onSubmit: (output: {
    action: "continue_as_new" | "try_different_phone";
  }) => void | Promise<void>;
}

export function NoMatchChoosePathCard({
  attempted_first_name,
  attempted_phone_last_four,
  disabled = false,
  onSubmit,
}: NoMatchChoosePathCardProps) {
  const [pending, setPending] = useState<
    "continue_as_new" | "try_different_phone" | null
  >(null);

  async function pick(action: "continue_as_new" | "try_different_phone") {
    if (pending || disabled) return;
    setPending(action);
    try {
      await onSubmit({ action });
    } finally {
      setPending(null);
    }
  }

  const echoName = attempted_first_name?.trim().length
    ? `, ${attempted_first_name.trim()}`
    : "";

  return (
    <Card aria-labelledby="no-match-title">
      <Card.Eyebrow>One quick fork</Card.Eyebrow>
      <Card.Title id="no-match-title">
        Hmm{echoName} — I&apos;m not finding you in our records 🤔
      </Card.Title>
      <Card.Description>
        We didn&apos;t find an account
        {attempted_phone_last_four
          ? ` for the number ending in ${attempted_phone_last_four}`
          : " for that phone"}
        . That&apos;s OK — happens all the time. A few possibilities:
      </Card.Description>

      <Card.Body>
        <ul className="space-y-2 text-[14px] leading-relaxed text-ink-secondary">
          <li>
            • You&apos;re new here — we&apos;ll set you up in a few quick
            steps.
          </li>
          <li>
            • You moved or changed your number — try the one we&apos;d have
            on file.
          </li>
          <li>
            • You&apos;ve been here as someone else&apos;s guest (a friend
            or family member). Continue as new and we&apos;ll sort it.
          </li>
        </ul>
      </Card.Body>

      <Card.Actions align="between">
        <Button
          variant="ghost"
          size="md"
          loading={pending === "try_different_phone"}
          disabled={pending !== null || disabled}
          onClick={() => pick("try_different_phone")}
          fullWidthOnMobile
        >
          Try a different phone
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={pending === "continue_as_new"}
          disabled={pending !== null || disabled}
          onClick={() => pick("continue_as_new")}
          fullWidthOnMobile
        >
          Continue as new customer
        </Button>
      </Card.Actions>
    </Card>
  );
}
