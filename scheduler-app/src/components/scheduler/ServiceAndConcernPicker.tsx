"use client";

import { useState, type FormEvent } from "react";

/**
 * ServiceAndConcernPicker rendering tool component.
 *
 * Per appointments_design.md §7.5 + scheduler_project_state.md "describe a
 * concern" section:
 * - Input: { common_services: ServiceChip[] }  (see type below)
 * - Output: { services: string[], concern_text?: string }
 *
 * The customer can:
 *   1. Pick one or more service chips
 *   2. Type a concern in the textarea
 *   3. Both — chip(s) AND a concern
 *   4. Neither — but they must do at least one to submit
 *
 * The chips come from the `routine_services` table at request time so the
 * shop can re-order / disable / rename without redeploying.
 */

export interface ServiceChip {
  service_key: string;       // matches routine_services.service_key
  display_name: string;      // chip label
}

export interface ServiceAndConcernPickerProps {
  common_services: ServiceChip[];
  onSubmit: (output: {
    services: string[];      // service_keys, in chip order
    concern_text?: string;   // trimmed; undefined if empty
  }) => void | Promise<void>;
  disabled?: boolean;
}

export function ServiceAndConcernPicker({
  common_services,
  onSubmit,
  disabled = false,
}: ServiceAndConcernPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [concern, setConcern] = useState("");
  const [error, setError] = useState<string | null>(null);

  function toggle(service_key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(service_key)) {
        next.delete(service_key);
      } else {
        next.add(service_key);
      }
      return next;
    });
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedConcern = concern.trim();
    const services = common_services
      .map((s) => s.service_key)
      .filter((k) => selected.has(k));

    if (services.length === 0 && !trimmedConcern) {
      setError(
        "Please pick at least one service or describe what's going on."
      );
      return;
    }
    setError(null);
    await onSubmit({
      services,
      concern_text: trimmedConcern || undefined,
    });
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
      aria-labelledby="service-concern-heading"
    >
      <h3
        id="service-concern-heading"
        className="mb-3 text-sm font-medium text-gray-900"
      >
        What can I help you with today?
      </h3>

      <fieldset className="mb-4">
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          Pick a routine service
        </legend>
        <div className="flex flex-wrap gap-2" role="group">
          {common_services.map((s) => {
            const checked = selected.has(s.service_key);
            return (
              <button
                key={s.service_key}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => toggle(s.service_key)}
                disabled={disabled}
                className={[
                  "rounded-full border px-3 py-1.5 text-sm",
                  checked
                    ? "border-brand-burgundy-700 bg-brand-burgundy-700 text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-brand-burgundy-700",
                  disabled ? "opacity-50" : "",
                ].join(" ")}
              >
                {s.display_name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mb-4">
        <label
          htmlFor="concern-textarea"
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500"
        >
          Or describe a concern
        </label>
        <textarea
          id="concern-textarea"
          rows={3}
          value={concern}
          onChange={(e) => {
            setConcern(e.target.value);
            setError(null);
          }}
          disabled={disabled}
          placeholder="e.g., grinding noise when I brake, AC not blowing cold, check engine light..."
          className="w-full rounded border border-gray-300 px-3 py-2 text-base focus:border-brand-burgundy-700 focus:outline-none focus:ring-2 focus:ring-brand-burgundy-200"
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="mb-3 text-sm text-red-600"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={disabled}
        className="rounded bg-brand-burgundy-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-burgundy-800 disabled:opacity-50"
      >
        Continue
      </button>
    </form>
  );
}
