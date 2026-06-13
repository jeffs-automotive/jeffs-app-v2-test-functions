"use client";

import { useState } from "react";

import { Card } from "@/components/ui";

/**
 * VehiclePicker component (Heritage Editorial refactor 2026-05-13).
 *
 * Contract:
 * - Props: { vehicles: Array<{id, label}>, allow_add_new: boolean }
 * - Emits: { vehicle_id: string | 'new' }
 *
 * If the customer picks "Add new vehicle", we emit `vehicle_id: 'new'` and
 * the wizard advances to the new_vehicle_form card.
 */

export interface VehicleOption {
  id: string;
  label: string;
}

export interface VehiclePickerProps {
  vehicles: VehicleOption[];
  allow_add_new: boolean;
  onSubmit: (output: { vehicle_id: string | "new" }) => void | Promise<void>;
  disabled?: boolean;
}

export function VehiclePicker({
  vehicles,
  allow_add_new,
  onSubmit,
  disabled = false,
}: VehiclePickerProps) {
  const [submitting, setSubmitting] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  async function pick(vehicle_id: string | "new") {
    if (disabled || submitting) return;
    setSubmitting(true);
    setPicked(vehicle_id);
    try {
      await onSubmit({ vehicle_id });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card aria-labelledby="vehicle-picker-heading">
      <Card.Eyebrow>Step 6 · Which vehicle?</Card.Eyebrow>
      <Card.Title id="vehicle-picker-heading">
        Which one are we taking care of? 🚗
      </Card.Title>
      <Card.Description>
        Tap the vehicle this appointment is for. Adding a new one? Tap
        &quot;Add a vehicle&quot; — we&apos;ll grab the year/make/model next.
      </Card.Description>

      <Card.Body>
        <ul className="flex flex-col gap-2">
          {vehicles.map((v) => {
            const isPicked = picked === v.id;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => void pick(v.id)}
                  disabled={disabled || submitting}
                  aria-pressed={isPicked}
                  className={
                    "flex w-full items-center justify-between rounded-[var(--radius-card)] " +
                    "border px-5 py-4 text-left text-[15px] " +
                    "transition-colors duration-150 ease-out " +
                    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
                    "focus-visible:outline-brand-burgundy-500 " +
                    "disabled:opacity-60 disabled:cursor-not-allowed " +
                    (isPicked
                      ? "border-brand-burgundy-700 bg-brand-burgundy-50"
                      : "border-rule bg-paper-100 hover:border-rule-strong hover:bg-paper-200")
                  }
                >
                  <span className="font-medium text-ink">{v.label}</span>
                  <span
                    aria-hidden="true"
                    className="text-ink-tertiary transition-transform duration-150 group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </button>
              </li>
            );
          })}

          {allow_add_new ? (
            <li>
              <button
                type="button"
                onClick={() => void pick("new")}
                disabled={disabled || submitting}
                aria-pressed={picked === "new"}
                className={
                  "flex w-full items-center justify-between rounded-[var(--radius-card)] " +
                  "border border-dashed px-5 py-4 text-left text-[15px] " +
                  "text-brand-burgundy-700 transition-colors duration-150 ease-out " +
                  "focus-visible:outline-2 focus-visible:outline-offset-2 " +
                  "focus-visible:outline-brand-burgundy-500 " +
                  "disabled:opacity-60 disabled:cursor-not-allowed " +
                  (picked === "new"
                    ? "border-brand-burgundy-700 bg-brand-burgundy-50"
                    : "border-brand-gold-400 bg-paper-100 hover:border-brand-burgundy-500 hover:bg-brand-gold-50")
                }
              >
                <span className="font-medium">+ Add a vehicle</span>
                <span aria-hidden="true" className="text-ink-tertiary">
                  →
                </span>
              </button>
            </li>
          ) : null}
        </ul>

        {vehicles.length === 0 && !allow_add_new ? (
          <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">
            I don&apos;t see any vehicles on file. Please call us at{" "}
            <a
              className="font-medium text-brand-burgundy-700 hover:underline"
              href="tel:6102536565"
            >
              (610) 253-6565
            </a>{" "}
            to get set up.
          </p>
        ) : null}
      </Card.Body>
    </Card>
  );
}
