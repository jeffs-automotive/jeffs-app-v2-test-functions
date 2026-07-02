"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

/**
 * Checkbox — Heritage Editorial hand-rolled checkbox primitive.
 *
 * Design spec: .claude/work/design/scheduler-comms-consent-spec.md §3.
 * Native <input type="checkbox" class="peer sr-only"> wrapped by a <label>;
 * the visible 20px box is a sibling <span aria-hidden> painted via
 * peer-checked / peer-focus-visible variants — free keyboard toggle + real
 * checkbox semantics, Heritage burgundy-ink-hairline styling. The check
 * glyph's 150ms scale transition is pure CSS, so the global
 * prefers-reduced-motion kill-switch flattens it with no JS gate.
 *
 * Presentational only — no business logic. The label row (not the 20px box)
 * is the hit target (≥44px with multi-line labels).
 */

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Visible label content — string or rich node (links allowed). */
  children: ReactNode;
  /** Optional helper/disclosure block rendered under the label (muted). */
  description?: ReactNode;
  /** Error/required styling hook — reserved; unused (consent is optional). */
  invalid?: boolean;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ children, description, invalid: _invalid, className, ...rest }, ref) {
    return (
      <label className={`group flex cursor-pointer items-start gap-3 py-1 ${className ?? ""}`}>
        <input ref={ref} type="checkbox" className="peer sr-only" {...rest} />
        <span
          aria-hidden
          className={
            "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center " +
            "rounded-[var(--radius-input)] border bg-paper-100 " +
            "border-[var(--color-rule-input)] " +
            "transition-[background-color,border-color] duration-150 ease-out " +
            "peer-hover:border-rule-strong " +
            "peer-checked:border-brand-burgundy-700 peer-checked:bg-brand-burgundy-700 " +
            "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 " +
            "peer-focus-visible:outline-brand-burgundy-500 " +
            "peer-disabled:opacity-60 peer-disabled:cursor-not-allowed " +
            // The glyph lives inside this span; scale it via the box's
            // peer-checked state (group-level peer works from the input).
            "[&>svg]:scale-0 peer-checked:[&>svg]:scale-100"
          }
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden
            className="h-3.5 w-3.5 text-paper-100 transition-transform duration-150 ease-out"
          >
            <path
              d="M13 4.5 6.5 11 3 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="min-w-0">
          {children}
          {description ? (
            <span className="mt-1 block text-[12px] leading-relaxed text-ink-secondary">
              {description}
            </span>
          ) : null}
        </span>
      </label>
    );
  },
);
