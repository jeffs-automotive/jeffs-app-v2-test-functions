"use client";

import { useState } from "react";

/**
 * VehiclePicker rendering tool component.
 *
 * Per appointments_design.md §7.5:
 * - Input: { vehicles: Array<{id, label}>, allow_add_new: boolean }
 * - Output: { vehicle_id: string | 'new' }
 *
 * If the customer picks "Add new vehicle", we emit `vehicle_id: 'new'` and
 * the orchestrator's next directive renders show_new_customer_form (vehicle
 * subset). This component is just the picker — it doesn't collect new-vehicle
 * fields itself.
 */

export interface VehicleOption {
  id: string;
  label: string;        // e.g. "2018 Toyota Camry"
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

  async function pick(vehicle_id: string | "new") {
    if (disabled || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ vehicle_id });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="group"
      aria-labelledby="vehicle-picker-heading"
      className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
    >
      <h3
        id="vehicle-picker-heading"
        className="mb-3 text-sm font-medium text-gray-900"
      >
        Which vehicle is this for?
      </h3>

      <ul className="flex flex-col gap-2">
        {vehicles.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => void pick(v.id)}
              disabled={disabled || submitting}
              className="flex w-full items-center justify-between rounded border border-gray-300 px-4 py-3 text-left text-base hover:border-brand-burgundy-700 hover:bg-brand-burgundy-50 disabled:opacity-50"
            >
              <span>{v.label}</span>
              <span aria-hidden="true" className="text-gray-400">
                →
              </span>
            </button>
          </li>
        ))}

        {allow_add_new ? (
          <li>
            <button
              type="button"
              onClick={() => void pick("new")}
              disabled={disabled || submitting}
              className="flex w-full items-center justify-between rounded border border-dashed border-brand-gold-300 px-4 py-3 text-left text-base text-brand-burgundy-700 hover:border-brand-burgundy-700 hover:bg-brand-gold-50 disabled:opacity-50"
            >
              <span>+ Add new vehicle</span>
              <span aria-hidden="true" className="text-gray-400">
                →
              </span>
            </button>
          </li>
        ) : null}
      </ul>

      {vehicles.length === 0 && !allow_add_new ? (
        <p className="mt-2 text-sm text-gray-500">
          No vehicles on file. Please call us at{" "}
          <a
            className="font-medium text-brand-burgundy-700 underline"
            href="tel:6102536565"
          >
            (610) 253-6565
          </a>{" "}
          to get set up.
        </p>
      ) : null}
    </div>
  );
}
