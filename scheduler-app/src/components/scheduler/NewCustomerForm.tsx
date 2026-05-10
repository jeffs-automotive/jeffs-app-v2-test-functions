"use client";

import { useState, type FormEvent } from "react";

/**
 * NewCustomerForm rendering tool component.
 *
 * Per appointments_design.md §4.5 + §7.5:
 * - Input: { collected_so_far?: { first_name?, last_name?, ... } }
 * - Output: { first_name, last_name, email?, vehicle: { year, make, model, ... } }
 *
 * Used in two scenarios per §4.3 reconciliation matrix:
 *   1. NEW customer with no Tekmetric record → collect customer + vehicle
 *   2. RETURNING customer adding a new vehicle → only the vehicle fields
 *      are needed; the orchestrator passes `mode: 'vehicle-only'` and we
 *      hide the customer fields
 *
 * Phone number is NOT collected here — it's already established by the
 * preceding show_phone_entry + OTP flow per §4.3.
 */

export interface NewCustomerFormProps {
  /** When 'vehicle-only', hides the customer fields (returning customer + new vehicle). */
  mode?: "full" | "vehicle-only";
  /** Optional pre-filled values from the orchestrator (e.g., customer name from earlier turn). */
  collected_so_far?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    vehicle?: {
      year?: number;
      make?: string;
      model?: string;
      sub_model?: string;
      vin?: string;
      license_plate?: string;
      state?: string;
    };
  };
  onSubmit: (output: {
    first_name: string;
    last_name: string;
    email?: string;
    vehicle: {
      year: number;
      make: string;
      model: string;
      sub_model?: string;
      vin?: string;
      license_plate?: string;
      state?: string;
    };
  }) => void | Promise<void>;
  disabled?: boolean;
}

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1980;

export function NewCustomerForm({
  mode = "full",
  collected_so_far,
  onSubmit,
  disabled = false,
}: NewCustomerFormProps) {
  const isVehicleOnly = mode === "vehicle-only";

  const [firstName, setFirstName] = useState(collected_so_far?.first_name ?? "");
  const [lastName, setLastName] = useState(collected_so_far?.last_name ?? "");
  const [email, setEmail] = useState(collected_so_far?.email ?? "");

  const [year, setYear] = useState<string>(
    collected_so_far?.vehicle?.year !== undefined
      ? String(collected_so_far.vehicle.year)
      : ""
  );
  const [make, setMake] = useState(collected_so_far?.vehicle?.make ?? "");
  const [model, setModel] = useState(collected_so_far?.vehicle?.model ?? "");
  const [subModel, setSubModel] = useState(
    collected_so_far?.vehicle?.sub_model ?? ""
  );
  const [vin, setVin] = useState(collected_so_far?.vehicle?.vin ?? "");
  const [licensePlate, setLicensePlate] = useState(
    collected_so_far?.vehicle?.license_plate ?? ""
  );
  const [state, setState] = useState(collected_so_far?.vehicle?.state ?? "");

  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errors: string[] = [];

    if (!isVehicleOnly) {
      if (firstName.trim().length === 0) errors.push("First name is required.");
      if (lastName.trim().length === 0) errors.push("Last name is required.");
      // Email is optional; if provided, basic shape check.
      if (email.trim().length > 0 && !/^\S+@\S+\.\S+$/.test(email.trim())) {
        errors.push("Email doesn't look right.");
      }
    }

    const yearNum = Number.parseInt(year, 10);
    if (!Number.isFinite(yearNum) || yearNum < MIN_YEAR || yearNum > CURRENT_YEAR + 2) {
      errors.push(
        `Year must be between ${MIN_YEAR} and ${CURRENT_YEAR + 2}.`
      );
    }
    if (make.trim().length === 0) errors.push("Make is required.");
    if (model.trim().length === 0) errors.push("Model is required.");

    if (errors.length > 0) {
      setError(errors.join(" "));
      return;
    }

    setError(null);
    await onSubmit({
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim() ? email.trim() : undefined,
      vehicle: {
        year: yearNum,
        make: make.trim(),
        model: model.trim(),
        sub_model: subModel.trim() || undefined,
        vin: vin.trim() || undefined,
        license_plate: licensePlate.trim() || undefined,
        state: state.trim() || undefined,
      },
    });
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      // noValidate so the JS validation in handleSubmit always runs;
      // without it, native HTML5 validation (e.g., year input min/max) can
      // suppress the submit event and the customer never sees a clear error.
      noValidate
      className="rounded-md border border-gray-200 bg-white p-4 shadow-sm"
      aria-labelledby="new-customer-heading"
    >
      <h3
        id="new-customer-heading"
        className="mb-3 text-sm font-medium text-gray-900"
      >
        {isVehicleOnly ? "Add a vehicle" : "Tell me about you and the vehicle"}
      </h3>

      {!isVehicleOnly ? (
        <fieldset className="mb-3">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            About you
          </legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="first-name" className="sr-only">First name</label>
              <input
                id="first-name"
                type="text"
                autoComplete="given-name"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={disabled}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base"
              />
            </div>
            <div>
              <label htmlFor="last-name" className="sr-only">Last name</label>
              <input
                id="last-name"
                type="text"
                autoComplete="family-name"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={disabled}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="email" className="sr-only">Email (optional)</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="Email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={disabled}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base"
              />
            </div>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="mb-3">
        <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          Vehicle
        </legend>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor="year" className="sr-only">Year</label>
            <input
              id="year"
              type="number"
              inputMode="numeric"
              placeholder="Year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              disabled={disabled}
              min={MIN_YEAR}
              max={CURRENT_YEAR + 2}
              className="w-full rounded border border-gray-300 px-3 py-2 text-base"
            />
          </div>
          <div>
            <label htmlFor="make" className="sr-only">Make</label>
            <input
              id="make"
              type="text"
              placeholder="Make"
              value={make}
              onChange={(e) => setMake(e.target.value)}
              disabled={disabled}
              className="w-full rounded border border-gray-300 px-3 py-2 text-base"
            />
          </div>
          <div>
            <label htmlFor="model" className="sr-only">Model</label>
            <input
              id="model"
              type="text"
              placeholder="Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={disabled}
              className="w-full rounded border border-gray-300 px-3 py-2 text-base"
            />
          </div>
        </div>

        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-brand-burgundy-700 hover:underline">
            More details (optional)
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="sub-model" className="sr-only">Sub-model / trim</label>
              <input
                id="sub-model"
                type="text"
                placeholder="Trim / sub-model"
                value={subModel}
                onChange={(e) => setSubModel(e.target.value)}
                disabled={disabled}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base"
              />
            </div>
            <div>
              <label htmlFor="vin" className="sr-only">VIN</label>
              <input
                id="vin"
                type="text"
                placeholder="VIN"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                disabled={disabled}
                maxLength={17}
                className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-base"
              />
            </div>
            <div>
              <label htmlFor="license-plate" className="sr-only">License plate</label>
              <input
                id="license-plate"
                type="text"
                placeholder="License plate"
                value={licensePlate}
                onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                disabled={disabled}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base"
              />
            </div>
            <div>
              <label htmlFor="plate-state" className="sr-only">Plate state</label>
              <input
                id="plate-state"
                type="text"
                placeholder="State"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                disabled={disabled}
                maxLength={2}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base"
              />
            </div>
          </div>
        </details>
      </fieldset>

      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-600">
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
