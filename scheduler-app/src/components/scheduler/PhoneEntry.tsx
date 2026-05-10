"use client";

import { useState, type FormEvent } from "react";

/**
 * PhoneEntry rendering tool component.
 *
 * Per appointments_design.md §7.3 + §7.5:
 * - Input: optional `reason` string (e.g., "to look up your account")
 * - Output: { phone: string }  // E.164 format, US/Canada (+1xxxxxxxxxx)
 *
 * Customer-facing UI. Mobile-first. Brand-aware via Tailwind tokens.
 *
 * Phase 1 phone format constraint (per scheduler_project_state.md):
 *   US/Canada only. Component normalizes input to E.164.
 */

export interface PhoneEntryProps {
  reason?: string;
  /** Called with the normalized E.164 phone when the customer submits. */
  onSubmit: (output: { phone: string }) => void | Promise<void>;
  /** Disable while the orchestrator is working. */
  disabled?: boolean;
}

/** Strip everything but digits; if 10 digits, prepend +1. If 11 digits starting with 1, prepend +. */
function normalizeToE164US(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** Format digits as (xxx) xxx-xxxx for display while typing. */
function formatForDisplay(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function PhoneEntry({
  reason,
  onSubmit,
  disabled = false,
}: PhoneEntryProps) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const e164 = normalizeToE164US(raw);
    if (!e164) {
      setError("Please enter a 10-digit US or Canadian phone number.");
      return;
    }
    setError(null);
    await onSubmit({ phone: e164 });
  }

  return (
    <form
      onSubmit={(e) => {
        // The Promise from onSubmit is intentionally not awaited here at the
        // event handler level — handleSubmit awaits it internally and React
        // accepts an async event handler.
        void handleSubmit(e);
      }}
      className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
      aria-labelledby="phone-entry-heading"
    >
      <h3
        id="phone-entry-heading"
        className="mb-2 text-sm font-medium text-gray-900"
      >
        Phone number
        {reason ? <span className="font-normal text-gray-500"> — {reason}</span> : null}
      </h3>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <label className="sr-only" htmlFor="phone-input">
          Phone number
        </label>
        <input
          id="phone-input"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="(610) 555-0123"
          value={formatForDisplay(raw)}
          onChange={(e) => setRaw(e.target.value)}
          disabled={disabled}
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? "phone-error" : undefined}
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-base focus:border-brand-burgundy-700 focus:outline-none focus:ring-2 focus:ring-brand-burgundy-200"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded bg-brand-burgundy-700 px-4 py-2 text-base font-medium text-white hover:bg-brand-burgundy-800 disabled:opacity-50"
        >
          Continue
        </button>
      </div>

      {error ? (
        <p id="phone-error" role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}
