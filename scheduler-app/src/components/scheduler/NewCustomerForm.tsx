"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Field, Input } from "@/components/ui";

/**
 * NewCustomerForm rendering tool component (Heritage Editorial refactor 2026-05-13).
 *
 * Per appointments_design.md §4.5 + §7.5:
 * - Input: { collected_so_far?, mode? }
 * - Output: { first_name, last_name, email?, vehicle: { year, make, model, ... } }
 *
 * Two modes per §4.3 reconciliation matrix:
 *   1. 'full' — NEW customer with no Tekmetric record → collect customer + vehicle
 *   2. 'vehicle-only' — RETURNING customer adding a new vehicle
 *
 * Phone is NOT collected here — already established by the preceding
 * show_phone_entry / show_phone_name_card + OTP flow.
 */

export interface NewCustomerFormProps {
  mode?: "full" | "vehicle-only";
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
      : "",
  );
  const [make, setMake] = useState(collected_so_far?.vehicle?.make ?? "");
  const [model, setModel] = useState(collected_so_far?.vehicle?.model ?? "");
  const [subModel, setSubModel] = useState(
    collected_so_far?.vehicle?.sub_model ?? "",
  );
  const [vin, setVin] = useState(collected_so_far?.vehicle?.vin ?? "");
  const [licensePlate, setLicensePlate] = useState(
    collected_so_far?.vehicle?.license_plate ?? "",
  );
  const [state, setState] = useState(collected_so_far?.vehicle?.state ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || disabled) return;
    const next: Record<string, string> = {};

    if (!isVehicleOnly) {
      if (firstName.trim().length === 0) next.firstName = "First name is required.";
      if (lastName.trim().length === 0) next.lastName = "Last name is required.";
      if (email.trim().length > 0 && !/^\S+@\S+\.\S+$/.test(email.trim())) {
        next.email = "Email doesn't look quite right.";
      }
    }

    const yearNum = Number.parseInt(year, 10);
    if (!Number.isFinite(yearNum) || yearNum < MIN_YEAR || yearNum > CURRENT_YEAR + 2) {
      next.year = `Year must be between ${MIN_YEAR} and ${CURRENT_YEAR + 2}.`;
    }
    if (make.trim().length === 0) next.make = "Make is required.";
    if (model.trim().length === 0) next.model = "Model is required.";

    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    setErrors({});
    setPending(true);
    try {
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
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="new-customer-heading">
      <Card.Eyebrow>
        {isVehicleOnly ? "Step 6 · Add a vehicle" : "Step 5 · Welcome aboard"}
      </Card.Eyebrow>
      <Card.Title id="new-customer-heading">
        {isVehicleOnly ? "Tell me about the new car 🚗" : "Tell me about you and your car 👋"}
      </Card.Title>
      {!isVehicleOnly ? (
        <Card.Description>
          Just the basics so we can build your record. We&apos;ll save
          everything when you confirm the appointment.
        </Card.Description>
      ) : null}

      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="contents">
        <Card.Body className="space-y-5">
          {!isVehicleOnly ? (
            <fieldset>
              <legend className="label-eyebrow mb-3 block">About you</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First name" required error={errors.firstName} inputId="ncf-first">
                  {({ id, ariaDescribedBy, ariaInvalid }) => (
                    <Input
                      id={id}
                      type="text"
                      autoComplete="given-name"
                      placeholder="Sarah"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      disabled={disabled || pending}
                      aria-describedby={ariaDescribedBy}
                      aria-invalid={ariaInvalid}
                    />
                  )}
                </Field>
                <Field label="Last name" required error={errors.lastName} inputId="ncf-last">
                  {({ id, ariaDescribedBy, ariaInvalid }) => (
                    <Input
                      id={id}
                      type="text"
                      autoComplete="family-name"
                      placeholder="Johnson"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      disabled={disabled || pending}
                      aria-describedby={ariaDescribedBy}
                      aria-invalid={ariaInvalid}
                    />
                  )}
                </Field>
                <div className="sm:col-span-2">
                  <Field
                    label="Email"
                    help="Optional — we'll send your appointment confirmation here."
                    error={errors.email}
                    inputId="ncf-email"
                  >
                    {({ id, ariaDescribedBy, ariaInvalid }) => (
                      <Input
                        id={id}
                        type="email"
                        autoComplete="email"
                        placeholder="sarah@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={disabled || pending}
                        aria-describedby={ariaDescribedBy}
                        aria-invalid={ariaInvalid}
                      />
                    )}
                  </Field>
                </div>
              </div>
            </fieldset>
          ) : null}

          <fieldset>
            <legend className="label-eyebrow mb-3 block">Vehicle</legend>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Year" required error={errors.year} inputId="ncf-year">
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    placeholder="2018"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    disabled={disabled || pending}
                    min={MIN_YEAR}
                    max={CURRENT_YEAR + 2}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                  />
                )}
              </Field>
              <Field label="Make" required error={errors.make} inputId="ncf-make">
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <Input
                    id={id}
                    type="text"
                    placeholder="Toyota"
                    value={make}
                    onChange={(e) => setMake(e.target.value)}
                    disabled={disabled || pending}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                  />
                )}
              </Field>
              <Field label="Model" required error={errors.model} inputId="ncf-model">
                {({ id, ariaDescribedBy, ariaInvalid }) => (
                  <Input
                    id={id}
                    type="text"
                    placeholder="Camry"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={disabled || pending}
                    aria-describedby={ariaDescribedBy}
                    aria-invalid={ariaInvalid}
                  />
                )}
              </Field>
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-[13px] text-brand-burgundy-700 hover:underline">
                Add more details (optional)
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Trim / sub-model" inputId="ncf-sub">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="text"
                      placeholder="LE / XLE / Sport"
                      value={subModel}
                      onChange={(e) => setSubModel(e.target.value)}
                      disabled={disabled || pending}
                    />
                  )}
                </Field>
                <Field label="VIN" inputId="ncf-vin">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="text"
                      placeholder="17-char VIN"
                      value={vin}
                      onChange={(e) => setVin(e.target.value.toUpperCase())}
                      disabled={disabled || pending}
                      maxLength={17}
                      className="font-mono"
                    />
                  )}
                </Field>
                <Field label="License plate" inputId="ncf-plate">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="text"
                      placeholder="ABC-1234"
                      value={licensePlate}
                      onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                      disabled={disabled || pending}
                    />
                  )}
                </Field>
                <Field label="Plate state" inputId="ncf-state">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="text"
                      placeholder="PA"
                      value={state}
                      onChange={(e) => setState(e.target.value.toUpperCase())}
                      disabled={disabled || pending}
                      maxLength={2}
                    />
                  )}
                </Field>
              </div>
            </details>
          </fieldset>
        </Card.Body>

        <Card.Actions>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={pending}
            disabled={disabled}
            fullWidthOnMobile
          >
            Continue
          </Button>
        </Card.Actions>
      </form>
    </Card>
  );
}
