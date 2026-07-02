"use client";

/**
 * QuestionsDirectFields — the two reusable sub-editors for the concern
 * question form: an options list editor (label + value pairs, add/remove,
 * min 2 enforced by the parent on submit) and a chip editor for
 * required_facts. Split out of QuestionsDirectForm per the file-size policy.
 *
 * Both are controlled: parent owns the state, these render + emit changes.
 */
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export interface Option {
  label: string;
  value: string;
}

// ─── OptionsEditor ────────────────────────────────────────────────────────

export interface OptionsEditorProps {
  idPrefix: string;
  options: Option[];
  onChange: (next: Option[]) => void;
  disabled?: boolean;
}

export function OptionsEditor({
  idPrefix,
  options,
  onChange,
  disabled,
}: OptionsEditorProps) {
  function update(index: number, patch: Partial<Option>) {
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function add() {
    if (options.length >= 12) return;
    onChange([...options, { label: "", value: "" }]);
  }
  function remove(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-xs uppercase tracking-wider text-muted-foreground">
        Options (min 2, max 12)
      </legend>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label
                htmlFor={`${idPrefix}-opt-label-${i}`}
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Label {i + 1}
              </Label>
              <Input
                id={`${idPrefix}-opt-label-${i}`}
                value={opt.label}
                onChange={(e) => update(i, { label: e.target.value })}
                disabled={disabled}
                placeholder="Shown to the customer"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label
                htmlFor={`${idPrefix}-opt-value-${i}`}
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
              >
                Value {i + 1}
              </Label>
              <Input
                id={`${idPrefix}-opt-value-${i}`}
                value={opt.value}
                onChange={(e) => update(i, { value: e.target.value })}
                disabled={disabled}
                placeholder="Stored key"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => remove(i)}
              disabled={disabled || options.length <= 2}
              aria-label={`Remove option ${i + 1}`}
              title={
                options.length <= 2
                  ? "At least 2 options are required"
                  : `Remove option ${i + 1}`
              }
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled || options.length >= 12}
        className="gap-1.5"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        Add option
      </Button>
    </fieldset>
  );
}

// ─── ChipEditor ───────────────────────────────────────────────────────────

export interface ChipEditorProps {
  idPrefix: string;
  label: string;
  placeholder?: string;
  values: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function ChipEditor({
  idPrefix,
  label,
  placeholder,
  values,
  onChange,
  disabled,
}: ChipEditorProps) {
  function addFrom(input: HTMLInputElement) {
    const raw = input.value.trim();
    if (!raw) return;
    if (!values.includes(raw)) onChange([...values, raw]);
    input.value = "";
  }
  function remove(chip: string) {
    onChange(values.filter((v) => v !== chip));
  }

  const inputId = `${idPrefix}-chip-input`;

  return (
    <div className="space-y-2">
      <Label
        htmlFor={inputId}
        className="text-xs uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </Label>
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((chip) => (
            <li
              key={chip}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
            >
              <span className="font-mono">{chip}</span>
              <button
                type="button"
                onClick={() => remove(chip)}
                disabled={disabled}
                aria-label={`Remove ${chip}`}
                className="text-muted-foreground hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          placeholder={placeholder}
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addFrom(e.currentTarget);
            }
          }}
          className="max-w-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={(e) => {
            const input = e.currentTarget.previousElementSibling;
            if (input instanceof HTMLInputElement) addFrom(input);
          }}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
