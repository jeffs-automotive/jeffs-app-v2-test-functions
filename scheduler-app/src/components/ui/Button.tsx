"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * Heritage Editorial Button.
 *
 * Three variants per the visual lock:
 *   primary   — burgundy fill, ivory text. The single primary CTA per card.
 *   secondary — ivory fill, burgundy text + burgundy hairline border.
 *               Used for back / cancel / "I'll do this later" actions.
 *   ghost     — text-only, ink-secondary. For tertiary actions inside cards
 *               (e.g. "I'm not sure" skip on clarification questions).
 *
 * Sizes:
 *   md (default) — 44px tap target. Optimized for mobile.
 *   sm           — 36px. Used in nav, footer, dense controls.
 *
 * Loading state collapses children behind an inline spinner — the button stays
 * the same width so the layout doesn't jump.
 *
 * Accessibility: aria-busy when loading; aria-disabled when disabled. Always
 * forward-refs so react-hook-form / labels can target.
 */

type Variant = "primary" | "secondary" | "ghost";
type Size = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  /** Optional leading icon — emoji or React node. Kept simple per design lock. */
  leadingIcon?: React.ReactNode;
  /** Pull-to-full-width on small screens. Default true (mobile-first). */
  fullWidthOnMobile?: boolean;
}

// active:scale-[0.98] on the two solid-press variants is the consumer-booking
// "motion is feedback" touch — a 2% press scale. The global reduced-motion
// kill-switch in globals.css neutralizes transform transitions too.
const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-brand-burgundy-700 text-paper-100 hover:bg-brand-burgundy-800 " +
    "active:bg-brand-burgundy-900 active:scale-[0.98] disabled:bg-brand-burgundy-300 " +
    "disabled:text-paper-100",
  secondary:
    "bg-paper-100 text-brand-burgundy-700 border border-brand-burgundy-700 " +
    "hover:bg-brand-burgundy-50 active:bg-brand-burgundy-100 active:scale-[0.98] " +
    "disabled:border-brand-burgundy-200 disabled:text-brand-burgundy-300",
  ghost:
    "bg-transparent text-ink-secondary hover:text-ink hover:bg-paper-200 " +
    "disabled:text-ink-tertiary",
};

const SIZE_CLASSES: Record<Size, string> = {
  md: "min-h-11 px-5 py-2.5 text-[15px]",
  sm: "min-h-9 px-3.5 py-1.5 text-[14px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leadingIcon,
    fullWidthOnMobile = true,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const widthClass = fullWidthOnMobile ? "w-full sm:w-auto" : "";
  const radius = "rounded-[var(--radius-input)]";
  // Transitions both color + transform so the active:scale press animates
  // (was transition-colors). Reduced-motion neutralizes the transform.
  const transition = "transition-[transform,background-color] duration-150 ease-out";
  const focus =
    "focus-visible:outline-2 focus-visible:outline-offset-2 " +
    "focus-visible:outline-brand-burgundy-500";

  const inner = (
    <span className="inline-flex items-center justify-center gap-2 leading-none">
      {leadingIcon ? <span aria-hidden>{leadingIcon}</span> : null}
      <span className={loading ? "invisible" : ""}>{children}</span>
    </span>
  );

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
      className={
        `inline-flex items-center justify-center font-medium ` +
        `${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ` +
        `${widthClass} ${radius} ${transition} ${focus} ` +
        `disabled:cursor-not-allowed ${className ?? ""}`
      }
      {...rest}
    >
      {loading ? (
        <span className="relative inline-flex items-center justify-center">
          {inner}
          <span
            aria-hidden
            className="absolute inset-0 inline-flex items-center justify-center"
          >
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeOpacity="0.25"
                strokeWidth="3"
              />
              <path
                d="M21 12a9 9 0 0 0-9-9"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </span>
      ) : (
        inner
      )}
    </button>
  );
});
