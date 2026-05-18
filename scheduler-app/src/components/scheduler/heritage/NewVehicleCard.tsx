"use client";

import { useState, type FormEvent } from "react";

import { Button, Card, Field, Input, Textarea } from "@/components/ui";

/**
 * New vehicle form per chat-design.md:
 *   §2684-2753 — new client Step 5 (after Step 4 new customer info)
 *   §1248-1306 — returning client Step 6 "Add a vehicle" drill-down
 *
 * Both use the SAME card and shape. The parent Server Action either
 * creates the vehicle attached to a NEW customer (Step 5 new client) or
 * attached to an EXISTING customer (Step 6 add-new drill-down).
 *
 * Fields (all required except plate + notes):
 *   Year (dropdown 1980 → current_year + 1)
 *   Make (1-50 chars trimmed)
 *   Model (1-50 chars trimmed)
 *   License plate (optional, 1-15 chars uppercase normalized)
 *   Notes (optional, max 200 chars; Phase 1 stored verbatim, no AI parsing)
 *
 * Submit calls Tekmetric POST /vehicles IMMEDIATELY (per spec).
 */

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1980;
const MAX_YEAR = CURRENT_YEAR + 1;
const YEAR_OPTIONS = (() => {
  const arr: number[] = [];
  for (let y = MAX_YEAR; y >= MIN_YEAR; y--) arr.push(y);
  return arr;
})();

const PLATE_REGEX = /^[A-Z0-9-]{1,15}$/;

export interface NewVehicleCardProps {
  /** Eyebrow label — defaults to "Step 5 · Add your vehicle". */
  step_label?: string;
  /** Title — defaults to "Now tell me about your ride! 🚗". */
  title?: string;
  /** Tekmetric error from the parent's response (inline alert). */
  server_error?: string;
  disabled?: boolean;
  onSubmit: (output: {
    year: number;
    make: string;
    model: string;
    license_plate?: string;
    notes?: string;
  }) => void | Promise<void>;
}

export function NewVehicleCard({
  step_label = "Add your vehicle",
  title = "Now tell me about your ride! 🚗",
  server_error,
  disabled = false,
  onSubmit,
}: NewVehicleCardProps) {
  const [year, setYear] = useState<string>("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending || disabled) return;

    const nextErrors: Record<string, string> = {};
    const yearNum = Number.parseInt(year, 10);
    if (
      !Number.isFinite(yearNum) ||
      yearNum < MIN_YEAR ||
      yearNum > MAX_YEAR
    ) {
      nextErrors.year = "Year required.";
    }
    const trimmedMake = make.trim();
    if (!trimmedMake) {
      nextErrors.make = "Make required.";
    } else if (trimmedMake.length > 50) {
      nextErrors.make = "Make is too long (max 50 chars).";
    }
    const trimmedModel = model.trim();
    if (!trimmedModel) {
      nextErrors.model = "Model required.";
    } else if (trimmedModel.length > 50) {
      nextErrors.model = "Model is too long (max 50 chars).";
    }
    const upperPlate = plate.trim().toUpperCase();
    if (upperPlate && !PLATE_REGEX.test(upperPlate)) {
      nextErrors.plate = "Plate must be 1-15 letters / numbers / dashes.";
    }
    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > 200) {
      nextErrors.notes = "Notes too long (max 200 characters).";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setPending(true);
    try {
      await onSubmit({
        year: yearNum,
        make: trimmedMake,
        model: trimmedModel,
        license_plate: upperPlate || undefined,
        notes: trimmedNotes || undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="new-vehicle-title">
      <Card.Eyebrow>{step_label}</Card.Eyebrow>
      <Card.Title id="new-vehicle-title">{title}</Card.Title>
      <Card.Description>
        Just the basics — we&apos;ll add it to your account.
      </Card.Description>

      <Card.Body>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field
            label="Year"
            required
            error={errors.year}
            inputId="nvc-year"
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <select
                id={id}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                disabled={disabled || pending}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
                className="h-10 w-full rounded-[var(--radius-card)] border border-rule bg-paper-100 px-3 text-[15px]"
              >
                <option value="">Select a year…</option>
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Make"
            required
            error={errors.make}
            inputId="nvc-make"
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <Input
                id={id}
                type="text"
                value={make}
                onChange={(e) => setMake(e.target.value)}
                placeholder="Toyota"
                maxLength={50}
                disabled={disabled || pending}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
              />
            )}
          </Field>

          <Field
            label="Model"
            required
            error={errors.model}
            inputId="nvc-model"
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <Input
                id={id}
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Camry"
                maxLength={50}
                disabled={disabled || pending}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
              />
            )}
          </Field>

          <Field
            label="License plate"
            help="Optional"
            error={errors.plate}
            inputId="nvc-plate"
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <Input
                id={id}
                type="text"
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                placeholder="ABC1234"
                maxLength={15}
                disabled={disabled || pending}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
              />
            )}
          </Field>

          <Field
            label="Anything I should know about this vehicle?"
            help={`Optional — ${notes.length} / 200 characters`}
            error={errors.notes}
            inputId="nvc-notes"
          >
            {({ id, ariaDescribedBy, ariaInvalid }) => (
              <Textarea
                id={id}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. runs rough cold, recently changed oil"
                maxLength={200}
                rows={3}
                disabled={disabled || pending}
                aria-describedby={ariaDescribedBy}
                aria-invalid={ariaInvalid}
              />
            )}
          </Field>

          {server_error ? (
            <div
              role="alert"
              className="rounded-[var(--radius-card)] border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] text-rose-800"
            >
              {server_error}
            </div>
          ) : null}

          <Button type="submit" disabled={disabled || pending} className="w-full">
            {pending ? "Adding…" : "Add vehicle"}
          </Button>
        </form>
      </Card.Body>
    </Card>
  );
}
