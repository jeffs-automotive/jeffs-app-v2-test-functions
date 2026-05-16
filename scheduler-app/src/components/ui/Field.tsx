"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Heritage Editorial form-field primitives.
 *
 * Field    — wraps a label + input + error/help text. Single source of
 *            spacing + aria wiring.
 * Input    — text/tel/email/etc. styled with Heritage palette.
 * Textarea — same shape, multiline.
 * Chip     — pill button for picker chips (services, options).
 *
 * Accessibility:
 *   - Field generates a deterministic id when one isn't supplied
 *   - aria-invalid + aria-describedby auto-wired from {error}
 *   - Required marker is a styled span, NOT a textContent asterisk (screen
 *     readers announce it via aria-required on the input)
 */

// R6-D-5 a11y fix 2026-05-16: previously a module-scope idCounter
// produced non-deterministic ids that risked SSR/CSR hydration mismatch
// when callers forgot to pass an explicit inputId. Replaced with React
// 18+ useId() inside the Field component (see usage site below).

// ─── Field wrapper ──────────────────────────────────────────────────────────

export interface FieldProps {
  /** Visible label text. Required — Heritage style never uses placeholder-only. */
  label: string;
  /** Help text shown under the field (muted). */
  help?: string;
  /** Error message — switches the input into invalid state when present. */
  error?: string;
  /** Required marker. */
  required?: boolean;
  /** Children: usually a single Input or Textarea. */
  children: (args: {
    id: string;
    ariaDescribedBy: string | undefined;
    ariaInvalid: boolean;
  }) => ReactNode;
  className?: string;
  /** Override the generated id (e.g. to align with react-hook-form). */
  inputId?: string;
}

export function Field({
  label,
  help,
  error,
  required = false,
  children,
  className,
  inputId,
}: FieldProps) {
  // useId is hydration-safe — same value server + client. Falls through
  // to the caller-provided inputId when one is supplied (e.g. for
  // react-hook-form integration).
  const generatedId = useId();
  const id = inputId ?? `fld-${generatedId}`;
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = errId ?? helpId;

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label
        htmlFor={id}
        className="text-[13px] font-medium leading-tight text-ink"
      >
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-brand-burgundy-700">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        ariaDescribedBy: describedBy,
        ariaInvalid: !!error,
      })}

      {error ? (
        <p
          id={errId}
          role="alert"
          className="text-[13px] leading-snug text-status-error-fg"
        >
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="text-[12px] leading-snug text-ink-tertiary">
          {help}
        </p>
      ) : null}
    </div>
  );
}

// ─── Input ──────────────────────────────────────────────────────────────────

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Pre-filled aria-invalid (from Field). */
  "aria-invalid"?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  const base =
    "w-full bg-paper-100 px-3.5 py-2.5 text-[15px] leading-normal " +
    "text-ink placeholder:text-ink-tertiary " +
    "rounded-[var(--radius-input)] border border-rule " +
    "focus:border-brand-burgundy-500 focus:outline-none " +
    "focus:ring-2 focus:ring-brand-burgundy-200 " +
    "aria-[invalid=true]:border-status-error-fg " +
    "aria-[invalid=true]:ring-status-error-bg " +
    "disabled:opacity-60 disabled:cursor-not-allowed " +
    "transition-colors";
  return <input ref={ref} className={`${base} ${className ?? ""}`} {...rest} />;
});

// ─── Textarea ──────────────────────────────────────────────────────────────

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  "aria-invalid"?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, rows = 4, ...rest }, ref) {
    const base =
      "w-full bg-paper-100 px-3.5 py-2.5 text-[15px] leading-normal " +
      "text-ink placeholder:text-ink-tertiary " +
      "rounded-[var(--radius-input)] border border-rule " +
      "focus:border-brand-burgundy-500 focus:outline-none " +
      "focus:ring-2 focus:ring-brand-burgundy-200 " +
      "aria-[invalid=true]:border-status-error-fg " +
      "aria-[invalid=true]:ring-status-error-bg " +
      "disabled:opacity-60 disabled:cursor-not-allowed " +
      "transition-colors resize-y min-h-24";
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={`${base} ${className ?? ""}`}
        {...rest}
      />
    );
  },
);

// ─── Chip (picker pill) ─────────────────────────────────────────────────────

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  /** Optional leading emoji/icon — keep tiny per Chris's voice directive
   *  ("light sprinkle of emoji"). */
  leadingIcon?: ReactNode;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, leadingIcon, className, children, ...rest },
  ref,
) {
  const base =
    "inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[14px] " +
    "leading-tight rounded-[var(--radius-pill)] " +
    "transition-colors duration-150 ease-out " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-brand-burgundy-500 " +
    "disabled:opacity-50 disabled:cursor-not-allowed";
  const state = selected
    ? "bg-brand-burgundy-700 text-paper-100 hover:bg-brand-burgundy-800 " +
      "border border-brand-burgundy-700"
    : "bg-paper-200 text-ink hover:bg-paper-300 " +
      "border border-rule hover:border-rule-strong";
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      className={`${base} ${state} ${className ?? ""}`}
      {...rest}
    >
      {leadingIcon ? <span aria-hidden>{leadingIcon}</span> : null}
      {children}
    </button>
  );
});
