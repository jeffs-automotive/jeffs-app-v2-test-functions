"use client";

/**
 * SubcategoriesChipList — a small editable string-list control used by the
 * Subcategories direct tab for positive_examples / negative_examples /
 * synonyms. Add via input + Enter (or the Add button); remove via the chip's
 * × button. Purely local state — the parent owns the value + onChange and
 * submits the whole array through the enrichment action.
 */
import { useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ChipListProps {
  id: string;
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  maxItems?: number;
}

export function SubcategoriesChipList({
  id,
  label,
  values,
  onChange,
  placeholder,
  disabled,
  maxItems = 30,
}: ChipListProps) {
  const [draft, setDraft] = useState("");

  const atMax = values.length >= maxItems;

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (atMax) return;
    // De-dupe (case-sensitive match on the exact string).
    if (values.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...values, trimmed]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  }

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-xs uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </Label>

      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${label} entries`}>
          {values.map((v, i) => (
            <li
              key={`${v}-${i}`}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs"
            >
              <span className="max-w-[22rem] truncate">{v}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={disabled}
                aria-label={`Remove ${v}`}
                className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={atMax ? `Max ${maxItems} reached` : placeholder}
          disabled={disabled || atMax}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={commit}
          disabled={disabled || atMax || draft.trim().length === 0}
          className="gap-1"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add
        </Button>
      </div>
    </div>
  );
}
