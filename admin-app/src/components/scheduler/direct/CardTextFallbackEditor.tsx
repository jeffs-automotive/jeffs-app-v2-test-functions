"use client";

/**
 * Fallback per-slot editor for Card-Text cards without a CARD_PREVIEW_MANIFEST
 * entry yet — the original imperative-save field, unchanged wiring: it runs
 * setCardTextAction / resetCardTextAction with a plain `saving` flag (NOT
 * useActionState), per-row expected_updated_at staleness, and sonner toasts.
 * Keeps follow-on cards fully editable the moment their rows seed, before
 * their manifest lands.
 */
import { useState } from "react";
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

export function CardTextFallbackEditor({
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
      } else if (
        result.status === "validation_error" ||
        result.status === "error"
      ) {
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
      } else if (
        result.status === "validation_error" ||
        result.status === "error"
      ) {
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
