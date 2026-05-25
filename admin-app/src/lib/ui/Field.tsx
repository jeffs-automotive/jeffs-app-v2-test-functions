"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Admin-app form primitives — self-contained, no design-token deps.
 *
 *   Field    — wraps label + input + error/help
 *   Input    — text/tel/email/number
 *   Textarea — multiline
 *   Select   — dropdown
 *
 * Accessibility:
 *   - useId() — hydration-safe deterministic id
 *   - aria-invalid + aria-describedby auto-wired from error
 *   - Required marker styled (not textContent asterisk for screen readers)
 */

// ─── Field wrapper ──────────────────────────────────────────────────────────

export interface FieldProps {
  label: string;
  help?: string;
  error?: string;
  required?: boolean;
  children: (args: {
    id: string;
    ariaDescribedBy: string | undefined;
    ariaInvalid: boolean;
  }) => ReactNode;
  className?: string;
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
  const generatedId = useId();
  const id = inputId ?? `fld-${generatedId}`;
  const helpId = help ? `${id}-help` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = errId ?? helpId;

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label
        htmlFor={id}
        className="text-sm font-medium leading-tight text-stone-700"
      >
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-[#96003c]">
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
        <p id={errId} role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="text-xs text-stone-500">
          {help}
        </p>
      ) : null}
    </div>
  );
}

// ─── Input ──────────────────────────────────────────────────────────────────

const INPUT_BASE =
  "w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm " +
  "text-stone-900 placeholder:text-stone-400 " +
  "focus:border-[#96003c] focus:outline-none focus:ring-2 focus:ring-[#96003c]/20 " +
  "aria-[invalid=true]:border-red-600 aria-[invalid=true]:ring-red-100 " +
  "disabled:cursor-not-allowed disabled:opacity-60 transition-colors";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  "aria-invalid"?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={`${INPUT_BASE} ${className ?? ""}`} {...rest} />;
});

// ─── Textarea ──────────────────────────────────────────────────────────────

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  "aria-invalid"?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={`${INPUT_BASE} min-h-24 resize-y ${className ?? ""}`}
        {...rest}
      />
    );
  },
);

// ─── Select ────────────────────────────────────────────────────────────────

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  "aria-invalid"?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={`${INPUT_BASE} ${className ?? ""}`} {...rest}>
      {children}
    </select>
  );
});
