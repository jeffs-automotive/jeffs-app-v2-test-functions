"use client";

import { useState } from "react";

import { Button, Card, Chip } from "@/components/ui";
import type { CardCopy } from "@/lib/scheduler/card-text";

/**
 * SecondRoutinePassCard — Step 7.6 add-on picker.
 *
 * Per chat-design.md §Step 7.6 (lines 1826-1868): one last chance to add
 * routine services before the customer picks an appointment type. Services
 * the customer already picked at Step 7.1 / 7.2 render disabled with an
 * "already added" affordance so they can see what they've got without
 * being able to double-pick.
 *
 * Two CTAs per spec:
 *   - [ Add and continue ] (primary)         when at least one new pick
 *   - [ Continue without adding more ] (ghost) when nothing new selected
 *
 * Submit shape (task EH2, 2026-07-04): a discriminated union.
 *   - { added: string[] } (or describe_issue:false) — the normal add-on
 *     path; the Server Action writes `added` to
 *     `additional_routine_services_round2` TEXT[] on the row.
 *   - { added: string[], describe_issue: true } — the "Describe another
 *     issue" path: the action persists `added` exactly as above THEN appends
 *     a fresh `other_issue` concern entry and routes into the diagnostic
 *     flow. `added` is the CURRENT chip selection so the customer never loses
 *     chips they toggled before deciding to also describe a symptom.
 */

export interface SecondRoutinePassCardProps {
  /** Editable card copy (card-text-editor) — resolved slot strings. */
  copy: CardCopy<"second_routine_pass">;
  common_services: Array<{ service_key: string; display_name: string }>;
  /** service_keys the customer already picked at Step 7.1 / 7.2 — shown
   *  disabled with an "already added" badge. */
  already_picked: string[];
  disabled?: boolean;
  onSubmit: (
    output:
      | { added: string[]; describe_issue?: false }
      | { added: string[]; describe_issue: true },
  ) => void | Promise<void>;
}

export function SecondRoutinePassCard({
  copy,
  common_services,
  already_picked,
  disabled = false,
  onSubmit,
}: SecondRoutinePassCardProps) {
  const alreadyPickedSet = new Set(already_picked);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  // Discriminator so only the pressed control spins: "add" = the primary
  // CTA, "describe" = the describe-another-issue ghost.
  const [action, setAction] = useState<"add" | "describe" | null>(null);

  function toggle(service_key: string) {
    if (alreadyPickedSet.has(service_key)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(service_key)) next.delete(service_key);
      else next.add(service_key);
      return next;
    });
  }

  async function submit(addedKeys: string[]) {
    if (pending || disabled) return;
    setPending(true);
    setAction("add");
    try {
      await onSubmit({ added: addedKeys });
    } finally {
      setPending(false);
      setAction(null);
    }
  }

  async function describe() {
    if (pending || disabled) return;
    setPending(true);
    setAction("describe");
    try {
      // Preserve any chips the customer toggled before deciding to describe
      // a symptom — the action persists them before appending the concern.
      await onSubmit({ added: Array.from(selected), describe_issue: true });
    } finally {
      setPending(false);
      setAction(null);
    }
  }

  const newPicks = Array.from(selected);
  const hasNewPicks = newPicks.length > 0;

  return (
    <Card aria-labelledby="second-routine-heading">
      <Card.Eyebrow>{copy.eyebrow}</Card.Eyebrow>
      <Card.Title id="second-routine-heading">{copy.title}</Card.Title>
      <Card.Description>{copy.description}</Card.Description>

      <Card.Body>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Routine add-ons">
          {common_services.map((s) => {
            const isAlreadyPicked = alreadyPickedSet.has(s.service_key);
            const isSelected = selected.has(s.service_key);
            return (
              <Chip
                key={s.service_key}
                type="button"
                selected={isSelected || isAlreadyPicked}
                disabled={isAlreadyPicked || pending || disabled}
                onClick={() => toggle(s.service_key)}
              >
                <span className="flex items-center gap-1.5">
                  <span>{s.display_name}</span>
                  {isAlreadyPicked ? (
                    <span
                      aria-label="already added"
                      className="text-[11px] font-medium text-ink-tertiary"
                    >
                      ✓ added
                    </span>
                  ) : null}
                </span>
              </Chip>
            );
          })}
        </div>

        {/* Describe-another-issue path (task EH2). A quiet ghost door beneath
            the chips, separated by a hairline, so a customer with a second
            symptom can type it in. Placed so it never competes with the
            primary continue CTA. The divider is guarded so it never leaves a
            lonely rule above an empty chip group. */}
        {common_services.length > 0 ? <Card.Divider /> : null}
        <div>
          <p className="text-[14px] text-ink-secondary">
            {copy.body_describe_prompt}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon="💬"
            loading={action === "describe" && pending}
            disabled={disabled || pending}
            fullWidthOnMobile={false}
            onClick={() => void describe()}
            className="mt-2"
          >
            Describe another issue
          </Button>
        </div>
      </Card.Body>

      <Card.Actions>
        {hasNewPicks ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={action === "add" && pending}
            disabled={disabled || pending}
            onClick={() => void submit(newPicks)}
            fullWidthOnMobile
          >
            Add and continue
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={action === "add" && pending}
            disabled={disabled || pending}
            onClick={() => void submit([])}
            fullWidthOnMobile
          >
            Continue without adding more
          </Button>
        )}
      </Card.Actions>
    </Card>
  );
}
