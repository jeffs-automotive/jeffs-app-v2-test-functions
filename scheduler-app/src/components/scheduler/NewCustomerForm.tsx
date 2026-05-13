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
    address?: {
      address1?: string;
      address2?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
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
    /** Required in full mode per chat-design.md §New Client Step 4. */
    email: string;
    /** Required street + city + state + zip in full mode. */
    address?: {
      address1: string;
      address2?: string;
      city: string;
      state: string;
      zip: string;
    };
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

  // Address — required in 'full' mode per chat-design.md §New Client
  // Step 4 lines 2588-2620 (address1, city, state, zip required;
  // address2 optional). PA pre-selected since the shop is in PA.
  const [address1, setAddress1] = useState(
    collected_so_far?.address?.address1 ?? "",
  );
  const [address2, setAddress2] = useState(
    collected_so_far?.address?.address2 ?? "",
  );
  const [city, setCity] = useState(collected_so_far?.address?.city ?? "");
  const [addrState, setAddrState] = useState(
    collected_so_far?.address?.state ?? "PA",
  );
  const [zip, setZip] = useState(collected_so_far?.address?.zip ?? "");

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
      // Email REQUIRED per chat-design.md §New Client Step 4 (used for
      // appointment confirmation + Tekmetric appointment.description).
      const emailTrim = email.trim();
      if (emailTrim.length === 0) {
        next.email = "Email is required for the appointment confirmation.";
      } else if (!/^\S+@\S+\.\S+$/.test(emailTrim)) {
        next.email = "Email doesn't look quite right.";
      }
      // Address fields REQUIRED per spec.
      if (address1.trim().length === 0)
        next.address1 = "Street address is required.";
      if (city.trim().length === 0) next.city = "City is required.";
      if (addrState.trim().length !== 2) next.addrState = "State (2 letters).";
      if (!/^\d{5}$/.test(zip.trim()))
        next.zip = "ZIP must be 5 digits.";
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
        email: email.trim(),
        address: isVehicleOnly
          ? undefined
          : {
              address1: address1.trim(),
              address2: address2.trim() || undefined,
              city: city.trim(),
              state: addrState.trim(),
              zip: zip.trim(),
            },
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
                    required
                    help="We'll send your appointment confirmation here."
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

          {!isVehicleOnly ? (
            <fieldset>
              <legend className="label-eyebrow mb-3 block">
                Where do you live?
              </legend>
              <div className="grid grid-cols-1 gap-3">
                <Field
                  label="Street address"
                  required
                  error={errors.address1}
                  inputId="ncf-addr1"
                >
                  {({ id, ariaDescribedBy, ariaInvalid }) => (
                    <Input
                      id={id}
                      type="text"
                      autoComplete="address-line1"
                      placeholder="123 Main Street"
                      value={address1}
                      onChange={(e) => setAddress1(e.target.value)}
                      disabled={disabled || pending}
                      aria-describedby={ariaDescribedBy}
                      aria-invalid={ariaInvalid}
                    />
                  )}
                </Field>
                <Field
                  label="Apt / suite (optional)"
                  inputId="ncf-addr2"
                >
                  {({ id, ariaDescribedBy, ariaInvalid }) => (
                    <Input
                      id={id}
                      type="text"
                      autoComplete="address-line2"
                      value={address2}
                      onChange={(e) => setAddress2(e.target.value)}
                      disabled={disabled || pending}
                      aria-describedby={ariaDescribedBy}
                      aria-invalid={ariaInvalid}
                    />
                  )}
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_5rem_6rem]">
                  <Field
                    label="City"
                    required
                    error={errors.city}
                    inputId="ncf-city"
                  >
                    {({ id, ariaDescribedBy, ariaInvalid }) => (
                      <Input
                        id={id}
                        type="text"
                        autoComplete="address-level2"
                        placeholder="Norristown"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        disabled={disabled || pending}
                        aria-describedby={ariaDescribedBy}
                        aria-invalid={ariaInvalid}
                      />
                    )}
                  </Field>
                  <Field
                    label="State"
                    required
                    error={errors.addrState}
                    inputId="ncf-addr-state"
                  >
                    {({ id, ariaDescribedBy, ariaInvalid }) => (
                      <Input
                        id={id}
                        type="text"
                        autoComplete="address-level1"
                        maxLength={2}
                        value={addrState}
                        onChange={(e) =>
                          setAddrState(
                            e.target.value.toUpperCase().slice(0, 2),
                          )
                        }
                        disabled={disabled || pending}
                        aria-describedby={ariaDescribedBy}
                        aria-invalid={ariaInvalid}
                      />
                    )}
                  </Field>
                  <Field
                    label="ZIP"
                    required
                    error={errors.zip}
                    inputId="ncf-addr-zip"
                  >
                    {({ id, ariaDescribedBy, ariaInvalid }) => (
                      <Input
                        id={id}
                        inputMode="numeric"
                        autoComplete="postal-code"
                        maxLength={5}
                        placeholder="19401"
                        value={zip}
                        onChange={(e) =>
                          setZip(
                            e.target.value.replace(/\D/g, "").slice(0, 5),
                          )
                        }
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
