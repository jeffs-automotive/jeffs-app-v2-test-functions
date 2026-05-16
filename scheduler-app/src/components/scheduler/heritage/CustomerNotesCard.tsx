"use client";

import { useState } from "react";

import { Button, Card, Field, Textarea } from "@/components/ui";

/**
 * Step 10.3 — Customer notes (optional).
 *
 * Per chat-design.md §Step 10.3 (lines 2667-2714): after appointment
 * confirmation, the customer can leave an optional note for the service
 * team. Examples:
 *   - "Please don't move the seats — I have them set just right"
 *   - "Front passenger door handle is loose, FYI"
 *
 * Two render modes (Phase 13 2026-05-16):
 *
 *   1. **Input mode** — when `parsed_preview` is null/undefined. The card
 *      renders the textarea + Skip + Send buttons. `onSubmit` fires with
 *      `{ text, approved }` (Skip → text=null+approved=false; Send →
 *      text=typed+approved=true). The Server Action decides whether to
 *      LLM-parse the typed text (≤150 chars) or punt to the raw-append
 *      path (>150 chars).
 *
 *   2. **Approval mode** — when `parsed_preview` is set. The card swaps
 *      to a read-only preview of the LLM-rewritten note + Save + Edit
 *      buttons. Save fires `onApprove({ parsed_text })`. Edit fires
 *      `onReject()`. On a 2nd reject the action auto-punts to raw-append.
 *      `edit_attempts === 1` triggers the "last try" hint so the customer
 *      knows the next Edit will send their original note as-is.
 *
 * Backward compat: input-mode props (`initial_text`, `disabled`,
 * `onSubmit`) are unchanged from the Phase 12 shape so the legacy
 * /book route's Chat.tsx callsite continues to compile.
 */

export interface CustomerNotesCardProps {
  /** Pre-filled text when the customer is editing a prior note (resume). */
  initial_text?: string | null | undefined;
  disabled?: boolean;
  /** Phase 13 approval-mode trigger: when set, the card flips to preview UI. */
  parsed_preview?: string | null;
  /** Phase 13 retry hint: 0 = first preview; 1 = alternate wording (last try). */
  edit_attempts?: number;
  /** Fires in input mode (Skip / Send). */
  onSubmit: (output: {
    text: string | null;
    approved: boolean;
  }) => void | Promise<void>;
  /** Fires in approval mode when the customer hits Save. */
  onApprove?: (output: { parsed_text: string }) => void | Promise<void>;
  /** Fires in approval mode when the customer hits Edit. */
  onReject?: () => void | Promise<void>;
}

const MAX_LENGTH = 500;

export function CustomerNotesCard({
  initial_text = "",
  disabled = false,
  parsed_preview = null,
  edit_attempts = 0,
  onSubmit,
  onApprove,
  onReject,
}: CustomerNotesCardProps) {
  // Approval mode short-circuits the input-mode rendering entirely.
  if (parsed_preview !== null && parsed_preview !== undefined && parsed_preview.trim().length > 0) {
    return (
      <CustomerNotesApprovalCard
        parsed_preview={parsed_preview}
        edit_attempts={edit_attempts}
        disabled={disabled}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
  }

  return (
    <CustomerNotesInputCard
      initial_text={initial_text ?? ""}
      disabled={disabled}
      onSubmit={onSubmit}
    />
  );
}

// ─── Input mode ─────────────────────────────────────────────────────────────

function CustomerNotesInputCard({
  initial_text,
  disabled,
  onSubmit,
}: {
  initial_text: string;
  disabled: boolean;
  onSubmit: CustomerNotesCardProps["onSubmit"];
}) {
  const [text, setText] = useState(initial_text);
  const [pending, setPending] = useState(false);

  async function submit(approved: boolean) {
    if (pending || disabled) return;
    setPending(true);
    try {
      const value = text.trim();
      await onSubmit({
        text: value.length === 0 ? null : value.slice(0, MAX_LENGTH),
        approved,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="customer-notes-title">
      <Card.Eyebrow>Step 10.3 · One more thing (optional)</Card.Eyebrow>
      <Card.Title id="customer-notes-title">
        Anything else our team should know? 🛠️
      </Card.Title>
      <Card.Description>
        Quirks, preferences, that one weird thing — whatever helps us take
        good care of your car. Or skip — it&apos;s up to you.
      </Card.Description>

      <Card.Body>
        <Field
          label="Notes for the team"
          help={`${text.trim().length}/${MAX_LENGTH} characters · optional`}
          inputId="customer-notes-textarea"
        >
          {({ id, ariaDescribedBy, ariaInvalid }) => (
            <Textarea
              id={id}
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Example: please don't move the driver seat — I have it set just right."
              disabled={pending || disabled}
              maxLength={MAX_LENGTH}
              aria-describedby={ariaDescribedBy}
              aria-invalid={ariaInvalid}
            />
          )}
        </Field>
      </Card.Body>

      <Card.Actions align="between">
        <Button
          variant="ghost"
          size="md"
          disabled={pending || disabled}
          onClick={() => submit(false)}
          fullWidthOnMobile
        >
          Skip
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={pending}
          disabled={disabled || text.trim().length === 0}
          onClick={() => submit(true)}
          fullWidthOnMobile
        >
          Send note
        </Button>
      </Card.Actions>
    </Card>
  );
}

// ─── Approval mode ──────────────────────────────────────────────────────────

function CustomerNotesApprovalCard({
  parsed_preview,
  edit_attempts,
  disabled,
  onApprove,
  onReject,
}: {
  parsed_preview: string;
  edit_attempts: number;
  disabled: boolean;
  onApprove: CustomerNotesCardProps["onApprove"];
  onReject: CustomerNotesCardProps["onReject"];
}) {
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);

  async function approve() {
    if (pending || disabled || !onApprove) return;
    setPending("approve");
    try {
      await onApprove({ parsed_text: parsed_preview });
    } finally {
      setPending(null);
    }
  }

  async function reject() {
    if (pending || disabled || !onReject) return;
    setPending("reject");
    try {
      await onReject();
    } finally {
      setPending(null);
    }
  }

  const lastTry = edit_attempts >= 1;

  return (
    <Card aria-labelledby="customer-notes-approval-title">
      <Card.Eyebrow>Step 10.3 · Sound right?</Card.Eyebrow>
      <Card.Title id="customer-notes-approval-title">
        I&apos;ll write this down 📝
      </Card.Title>
      <Card.Description>
        Here&apos;s the cleaned-up version of your note. Save it if it
        captures what you meant, or hit Edit to send your original wording.
      </Card.Description>

      <Card.Body>
        <blockquote className="rounded-[var(--radius-card)] border-l-4 border-brand-burgundy-700 bg-paper-100 px-4 py-3 text-[15px] leading-relaxed text-ink">
          {parsed_preview}
        </blockquote>
        {lastTry ? (
          <p className="mt-3 text-[13px] leading-snug text-ink-secondary">
            Last try — if this still isn&apos;t quite right, hit Edit and
            we&apos;ll pass your original note straight to the team.
          </p>
        ) : null}
      </Card.Body>

      <Card.Actions align="between">
        <Button
          variant="ghost"
          size="md"
          loading={pending === "reject"}
          disabled={pending !== null || disabled}
          onClick={reject}
          fullWidthOnMobile
        >
          Edit
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={pending === "approve"}
          disabled={pending !== null || disabled}
          onClick={approve}
          fullWidthOnMobile
        >
          Save
        </Button>
      </Card.Actions>
    </Card>
  );
}
