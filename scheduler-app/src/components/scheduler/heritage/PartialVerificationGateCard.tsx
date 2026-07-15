"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";
import { interpolate } from "@/lib/scheduler/wizard/card-copy";
import type { CardCopy } from "@/lib/scheduler/card-text";

/**
 * Step 3.5 — Partial-verification gate per chat-design.md §3.5
 * (lines 712-757).
 *
 * Renders when the §4.3 reconciliation matrix lands on a row that hits
 * phone OR name (not both). Two paths:
 *   1. Name matched but phone didn't → ask the customer to confirm a
 *      different phone OR proceed as a new customer (data quality
 *      flag for the service team).
 *   2. Phone matched but name didn't → ask the customer if they're
 *      maybe using a guest's phone OR proceed via the existing match.
 *
 * The card surfaces the partial-verification reason and lets the
 * customer pick a path. The Server Action then routes per the choice.
 */

export interface PartialVerificationGateCardProps {
  /** Editable card copy (card-text-editor) — resolved slot strings. */
  copy: CardCopy<"partial_verification_gate">;
  /** Which axis matched — drives the explanatory copy. */
  matched_axis: "name" | "phone";
  /** Customer's typed first name (echoed for warmth). */
  attempted_first_name?: string | null;
  /** Last 4 of the phone they typed (for confirmation copy). */
  attempted_phone_last_four?: string | null;
  disabled?: boolean;
  onSubmit: (output: {
    action:
      | "use_different_phone"
      | "proceed_as_partial"
      | "continue_as_new"
      | "escalate";
  }) => void | Promise<void>;
}

export function PartialVerificationGateCard({
  copy,
  matched_axis,
  attempted_first_name,
  attempted_phone_last_four,
  disabled = false,
  onSubmit,
}: PartialVerificationGateCardProps) {
  const [pending, setPending] = useState<string | null>(null);

  async function pick(
    action:
      | "use_different_phone"
      | "proceed_as_partial"
      | "continue_as_new"
      | "escalate",
  ) {
    if (pending || disabled) return;
    setPending(action);
    try {
      await onSubmit({ action });
    } finally {
      setPending(null);
    }
  }

  const echoName = attempted_first_name?.trim().length
    ? attempted_first_name.trim()
    : null;

  // Two distinct UX flavors based on which axis matched.
  if (matched_axis === "name") {
    return (
      <Card aria-labelledby="partial-verify-title">
        <Card.Eyebrow>{copy.eyebrow}</Card.Eyebrow>
        <Card.Title id="partial-verify-title">
          {interpolate(copy.title_name, {
            first_name: echoName ? `, ${echoName}` : "",
          })}
        </Card.Title>
        <Card.Description>{copy.description_name}</Card.Description>

        <Card.Body>
          <p className="text-[13px] italic text-ink-tertiary">
            {copy.body_name_note}
          </p>
        </Card.Body>

        <Card.Actions align="between">
          <Button
            variant="ghost"
            size="md"
            loading={pending === "use_different_phone"}
            disabled={pending !== null || disabled}
            onClick={() => pick("use_different_phone")}
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
            Continue with this number
          </Button>
        </Card.Actions>
      </Card>
    );
  }

  // matched_axis === 'phone' — Per chat-design.md spec, this branch
  // shouldn't reach the card anymore (scheduler-step2-direct now sends
  // OTP for any phone hit; name-mismatch is verified by OTP, not by
  // surfacing a partial gate). Leaving the branch as a safety net in
  // case orchestrator-side logic ever surfaces matched_axis='phone'.
  return (
    <Card aria-labelledby="partial-verify-title">
      <Card.Eyebrow>{copy.eyebrow}</Card.Eyebrow>
      <Card.Title id="partial-verify-title">{copy.title_phone}</Card.Title>
      <Card.Description>
        {echoName ? `You said your name's ${echoName}. ` : ""}
        To protect everyone&apos;s information, we&apos;ll need a different
        phone or to call us directly.
      </Card.Description>

      <Card.Body>
        {attempted_phone_last_four ? (
          <p className="text-[13px] italic text-ink-tertiary">
            Phone ending in {attempted_phone_last_four}
          </p>
        ) : null}
      </Card.Body>

      <Card.Actions align="between">
        <Button
          variant="ghost"
          size="md"
          loading={pending === "continue_as_new"}
          disabled={pending !== null || disabled}
          onClick={() => pick("continue_as_new")}
          fullWidthOnMobile
        >
          Set me up as new
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={pending === "proceed_as_partial"}
          disabled={pending !== null || disabled}
          onClick={() => pick("proceed_as_partial")}
          fullWidthOnMobile
        >
          Yes, that&apos;s me
        </Button>
      </Card.Actions>
    </Card>
  );
}
