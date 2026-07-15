"use client";

import { useState } from "react";

import { Button, Card } from "@/components/ui";
import type { CardCopy } from "@/lib/scheduler/card-text";

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

/**
 * Multi-account candidate per chat-design.md spec lines 685 + 710:
 * disambiguation MUST be by VEHICLE ONLY — never by customer name —
 * to avoid disclosing other household members' identities to a
 * caller who hasn't yet verified phone ownership via OTP.
 *
 * `recent_vehicle` is the customer's most-recently-touched vehicle
 * (year/make/model). Required for the card to render; if the
 * orchestrator can't find a recent vehicle, the candidate should
 * be omitted from the picker entirely.
 */
export interface MultiAccountCandidate {
  customer_id: number;
  recent_vehicle: string;
}

export interface MultiAccountDisambiguationCardProps {
  /** Editable card copy (card-text-editor) — resolved slot strings. */
  copy: CardCopy<"multi_account_disambiguation">;
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
  copy,
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
      <Card.Eyebrow>{copy.eyebrow}</Card.Eyebrow>
      <Card.Title id="multi-account-title">{copy.title}</Card.Title>
      <Card.Description>
        {attempted_phone_last_four
          ? `The number ending in ${attempted_phone_last_four} is on file for `
          : "That number is on file for "}
        {candidates.length} folks. Which account is yours?
      </Card.Description>

      <Card.Body>
        {/* Vehicle-only picker per chat-design.md §3.5c (lines 685 + 710):
           NEVER show names — only the vehicles each account owns. The
           customer recognizes their own car; whoever they share the
           number with stays anonymous. */}
        <ul className="space-y-2">
          {candidates.map((c) => (
            <li key={c.customer_id}>
              <button
                type="button"
                disabled={pending !== null || disabled}
                onClick={() => pickAccount(c.customer_id)}
                className={
                  "flex w-full items-center gap-3 rounded-[var(--radius-card)] " +
                  "border border-rule bg-paper-100 px-4 py-4 text-left " +
                  "transition-colors duration-150 ease-out " +
                  "hover:border-brand-burgundy-300 hover:bg-brand-burgundy-50 " +
                  "focus-visible:border-brand-burgundy-500 focus-visible:outline-2 " +
                  "focus-visible:outline-offset-2 focus-visible:outline-brand-burgundy-500 " +
                  "disabled:cursor-not-allowed disabled:opacity-60"
                }
              >
                <span aria-hidden className="text-2xl">🚗</span>
                <span className="text-[15px] font-medium text-ink">
                  {c.recent_vehicle}
                </span>
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

      <Card.Footnote>{copy.footnote}</Card.Footnote>
    </Card>
  );
}
