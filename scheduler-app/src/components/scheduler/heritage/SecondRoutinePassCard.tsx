"use client";

import { useState } from "react";

import { Button, Card, Chip } from "@/components/ui";

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
 * Submit shape: { added: string[] } — only NEW picks (already_picked items
 * are excluded by the disabled state). The Server Action writes this to
 * `additional_routine_services_round2` TEXT[] on the row.
 */

export interface SecondRoutinePassCardProps {
  common_services: Array<{ service_key: string; display_name: string }>;
  /** service_keys the customer already picked at Step 7.1 / 7.2 — shown
   *  disabled with an "already added" badge. */
  already_picked: string[];
  disabled?: boolean;
  onSubmit: (output: { added: string[] }) => void | Promise<void>;
}

export function SecondRoutinePassCard({
  common_services,
  already_picked,
  disabled = false,
  onSubmit,
}: SecondRoutinePassCardProps) {
  const alreadyPickedSet = new Set(already_picked);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);

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
    try {
      await onSubmit({ added: addedKeys });
    } finally {
      setPending(false);
    }
  }

  const newPicks = Array.from(selected);
  const hasNewPicks = newPicks.length > 0;

  return (
    <Card aria-labelledby="second-routine-heading">
      <Card.Eyebrow>Anything else?</Card.Eyebrow>
      <Card.Title id="second-routine-heading">
        Want to add anything else while you&apos;re here?
      </Card.Title>
      <Card.Description>
        Tap any of these to add them on. The ones you&apos;ve already picked
        are marked.
      </Card.Description>

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
      </Card.Body>

      <Card.Actions>
        {hasNewPicks ? (
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={pending}
            disabled={disabled}
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
            loading={pending}
            disabled={disabled}
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
