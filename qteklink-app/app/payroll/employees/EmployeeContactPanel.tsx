"use client";

/**
 * EmployeeContactPanel — the "Contact & personal" + PTO tenure section of the
 * employee editor, extracted from EmployeeForm (already at the ~500-line limit,
 * plan N7). PURELY PRESENTATIONAL: it renders the profile inputs and exposes
 * their CURRENT values through `readProfilePatch`, which the parent form diffs
 * against the employee's stored values to build the minimal
 * updateEmployeeProfileAction patch (only changed fields; empty string ⇒ null to
 * clear). No data fetching, no actions, no business logic — the profile RPC owns
 * validation (emails/dates cast, unknown keys RAISE).
 *
 * The grandfather checkbox is controlled (local state) so the tenure-credit date
 * reveal works; every other field is uncontrolled with defaults from the row.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { labelCls } from "./payroll-ui";

/** The editable profile columns (plan §2a + round-12 full_time) — the shape the
 *  parent diffs. */
export interface ProfileValues {
  work_email: string;
  personal_email: string;
  personal_phone: string;
  work_phone: string;
  address: string;
  start_date: string;
  pto_grandfathered: boolean;
  pto_tenure_credit_date: string;
  /** Round-12: full-time flag (default true). Gates PTO accrual only. */
  full_time: boolean;
}

/**
 * Read the panel's current values off a FormData (the profile fields the parent
 * form submits). Grandfather + full-time are checkboxes ⇒ "on"/absent; the
 * date/text fields are plain strings (blank = the user wants it cleared).
 * termination_date is NOT here — it's captured by the Archive modal, never this
 * panel. Both checkboxes are CONTROLLED (their state carries the row default), so
 * an absent value here means the box is unchecked (full_time ⇒ part-time).
 */
export function readProfileValues(fd: FormData): ProfileValues {
  const str = (name: string) => String(fd.get(name) ?? "").trim();
  return {
    work_email: str("work_email"),
    personal_email: str("personal_email"),
    personal_phone: str("personal_phone"),
    work_phone: str("work_phone"),
    address: str("address"),
    start_date: str("start_date"),
    pto_grandfathered: fd.get("pto_grandfathered") === "on",
    pto_tenure_credit_date: str("pto_tenure_credit_date"),
    full_time: fd.get("full_time") === "on",
  };
}

/** A plain optional text/date/email field (relaxes EmployeeForm's required Field). */
function TextField({
  name,
  label,
  type = "text",
  defaultValue,
  placeholder,
  hint,
  inputMode,
  className,
  colSpan,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue: string;
  placeholder?: string;
  hint?: string;
  inputMode?: "text" | "tel" | "email" | "numeric" | "decimal";
  className?: string;
  colSpan?: boolean;
}) {
  return (
    <label className={`${labelCls}${colSpan ? " sm:col-span-2" : ""}`}>
      {label}
      <Input
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={className ? `mt-0.5 ${className}` : "mt-0.5"}
      />
      {hint ? (
        <span className="mt-0.5 block text-xs font-normal normal-case text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export default function EmployeeContactPanel({
  values,
}: {
  /** Defaults from the employee row (all optional strings; "" when unset). */
  values: ProfileValues;
}) {
  const [grandfathered, setGrandfathered] = useState(values.pto_grandfathered);
  const [fullTime, setFullTime] = useState(values.full_time);

  return (
    <>
      {/* Contact & personal */}
      <div className="rounded-lg border border-dashed border-border p-4">
        <p className="text-sm font-semibold text-foreground">Contact &amp; personal</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Used for pay summaries and alerts — the personal email is where an employee&apos;s own
          emails go.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField
            name="personal_email"
            label="Personal email"
            type="email"
            inputMode="email"
            defaultValue={values.personal_email}
            placeholder="person@email.com"
            hint="Pay summaries and PTO alerts go here."
          />
          <TextField
            name="work_email"
            label="Work email"
            type="email"
            inputMode="email"
            defaultValue={values.work_email}
            placeholder="person@jeffsautomotive.com"
            hint="Stored for later — not emailed yet."
          />
          <TextField
            name="personal_phone"
            label="Personal phone"
            type="tel"
            inputMode="tel"
            defaultValue={values.personal_phone}
            placeholder="(555) 555-5555"
          />
          <TextField
            name="work_phone"
            label="Work phone"
            type="tel"
            inputMode="tel"
            defaultValue={values.work_phone}
            placeholder="optional"
          />
          <TextField
            name="address"
            label="Address"
            defaultValue={values.address}
            placeholder="Street, City, State ZIP"
            colSpan
          />
          <TextField
            name="start_date"
            label="Start date"
            type="date"
            defaultValue={values.start_date}
            className="w-44"
            hint="Tenure anchor for PTO accrual."
          />
        </div>
      </div>

      {/* PTO tenure — grandfather toggle + optional tenure-credit date */}
      <div className="rounded-lg border border-dashed border-border p-4">
        <p className="text-sm font-semibold text-foreground">PTO tenure</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Accrual is tenure-tiered (set the rates in Settings). The balance itself is adjusted from
          the roster.
        </p>
        <div className="mt-3 space-y-3">
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              name="full_time"
              checked={fullTime}
              onChange={(e) => setFullTime(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              Full-time (accrues PTO)
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                On by default. Turn off for a part-time employee — they stop accruing PTO, but any
                paid PTO they take still draws down their balance.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              name="pto_grandfathered"
              checked={grandfathered}
              onChange={(e) => setGrandfathered(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              Grandfather in (waive the 6-period wait)
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                Turn on to waive the 6-period wait for a recent hire.
              </span>
            </span>
          </label>
          {grandfathered ? (
            <div className="animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
              <TextField
                name="pto_tenure_credit_date"
                label="Tenure-credit date (optional)"
                type="date"
                defaultValue={values.pto_tenure_credit_date}
                className="w-44"
                hint="Overrides the start date for tier lookup — use for acquired-company hires who keep their seniority."
              />
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
