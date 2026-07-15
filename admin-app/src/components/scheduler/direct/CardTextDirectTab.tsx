"use client";

/**
 * Card Text tab — edit the "main copy" (eyebrow/title/description/footnote +
 * in-body prose) on each wizard card. Feature: card-text-editor.
 *
 * FUNCTIONAL baseline: a card picker + per-slot editable fields with merge-field
 * validation, "Reset to default", optimistic-concurrency staleness, and sonner
 * toasts — imperative save (NOT useActionState) per the /schedulerconfig SPIN
 * NOTE. The faithful "card on a workbench" Heritage preview
 * (.claude/work/design/card-text-editor-spec.md) is layered on by the
 * frontend-implementer; the wiring here is the contract it dresses.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { CardTextRow } from "@/lib/scheduler/read-dal";
import {
  renderCardTextSample,
  validateCardTextBody,
} from "@/lib/scheduler/card-merge-fields";
import {
  resetCardTextAction,
  setCardTextAction,
} from "@/actions/scheduler/direct-config-actions";

/** Friendly picker labels; falls back to the humanized card_key. */
const CARD_DISPLAY_NAMES: Record<string, string> = {
  greeting: "Greeting",
};

function cardLabel(key: string): string {
  return CARD_DISPLAY_NAMES[key] ?? key.replace(/_/g, " ");
}

export function CardTextDirectTab({ rows }: { rows: CardTextRow[] }) {
  const router = useRouter();
  const cardKeys = useMemo(
    () => Array.from(new Set(rows.map((r) => r.card_key))),
    [rows],
  );
  const [selected, setSelected] = useState<string>(cardKeys[0] ?? "");
  const slots = useMemo(
    () =>
      rows
        .filter((r) => r.card_key === selected)
        .sort((a, b) => a.sort - b.sort),
    [rows, selected],
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No editable card wording yet. It seeds with the built-in copy on first
        deploy.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="card-text-picker" className="text-sm font-medium">
          Card
        </label>
        <select
          id="card-text-picker"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {cardKeys.map((k) => (
            <option key={k} value={k}>
              {cardLabel(k)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Editing the wording customers read on the “{cardLabel(selected)}” card.
          Buttons &amp; layout don’t change.
        </p>
      </div>

      <div className="space-y-4">
        {slots.map((row) => (
          <SlotEditor key={row.id} row={row} onDone={() => router.refresh()} />
        ))}
      </div>
    </div>
  );
}

function SlotEditor({
  row,
  onDone,
}: {
  row: CardTextRow;
  onDone: () => void;
}) {
  const [value, setValue] = useState(row.body);
  const [saving, setSaving] = useState(false);

  const dirty = value !== row.body;
  const canReset = value !== row.default_body;
  const check = validateCardTextBody(value, row.allowed_merge_fields);
  const invalid = !check.ok;
  const allowed = row.allowed_merge_fields;

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      const result = await setCardTextAction({
        card_key: row.card_key,
        slot_key: row.slot_key,
        body: value,
        expected_updated_at: row.updated_at,
      });
      if (result.status === "success") {
        toast.success(`Saved ${row.label}`, {
          description: "Live on the booking wizard within ~5 minutes.",
        });
        onDone();
      } else if (result.status === "stale") {
        toast.error("This line changed since you loaded it", {
          description: result.error,
        });
        onDone();
      } else if (result.status === "validation_error" || result.status === "error") {
        toast.error(`Couldn't save ${row.label}`, { description: result.error });
      }
    } catch (e) {
      toast.error(`Couldn't save ${row.label}`, {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await resetCardTextAction({
        card_key: row.card_key,
        slot_key: row.slot_key,
        expected_updated_at: row.updated_at,
      });
      if (result.status === "success") {
        toast.success(`Reset ${row.label} to the default wording`);
        onDone();
      } else if (result.status === "stale") {
        toast.error("This line changed since you loaded it", {
          description: result.error,
        });
        onDone();
      } else if (result.status === "validation_error" || result.status === "error") {
        toast.error(`Couldn't reset ${row.label}`, { description: result.error });
      }
    } catch (e) {
      toast.error(`Couldn't reset ${row.label}`, {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`slot-${row.id}`} className="text-sm font-medium">
          {row.label}
          {dirty ? (
            <span className="ml-2 text-xs text-amber-600">• unsaved</span>
          ) : null}
        </label>
        {allowed.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            fields: {allowed.map((t) => `{{${t}}}`).join(", ")}
          </span>
        ) : null}
      </div>
      <textarea
        id={`slot-${row.id}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        aria-invalid={invalid}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
      />
      {allowed.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          As the customer sees it: {renderCardTextSample(value)}
        </p>
      ) : null}
      {invalid ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {check.error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={!dirty || invalid || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {allowed.map((t) => (
          <Button
            key={t}
            size="sm"
            variant="outline"
            type="button"
            onClick={() =>
              setValue((v) =>
                `${v}${v.length === 0 || v.endsWith(" ") ? "" : " "}{{${t}}}`,
              )
            }
          >
            {`+ {{${t}}}`}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          onClick={reset}
          disabled={!canReset || saving}
        >
          Reset to default
        </Button>
      </div>
    </div>
  );
}
