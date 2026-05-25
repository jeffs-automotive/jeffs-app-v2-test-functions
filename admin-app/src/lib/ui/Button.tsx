"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * Admin-app Button — self-contained variant of scheduler-app's Heritage
 * Editorial Button. Same visual family (burgundy/ivory), but doesn't
 * depend on scheduler-app's full design-token CSS system.
 *
 * Three variants:
 *   primary   — burgundy fill, white text (default)
 *   secondary — white fill, burgundy text + border
 *   ghost     — text-only
 *   destructive — red fill for "Release" / "Delete" actions
 */
type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "md" | "sm";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leadingIcon?: ReactNode;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-[#96003c] text-white hover:bg-[#7e0033] active:bg-[#660029] disabled:bg-[#96003c]/50",
  secondary:
    "bg-white text-[#96003c] border border-[#96003c] hover:bg-[#96003c]/5 disabled:opacity-50",
  ghost:
    "bg-transparent text-stone-700 hover:bg-stone-100 disabled:text-stone-400",
  destructive:
    "bg-red-700 text-white hover:bg-red-800 active:bg-red-900 disabled:bg-red-700/50",
};

const SIZE_CLASSES: Record<Size, string> = {
  md: "min-h-10 px-4 py-2 text-sm",
  sm: "min-h-8 px-3 py-1 text-xs",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leadingIcon,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={
        `inline-flex items-center justify-center gap-2 rounded font-medium ` +
        `transition-colors duration-150 ease-out ` +
        `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#96003c] ` +
        `disabled:cursor-not-allowed ` +
        `${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ` +
        `${className ?? ""}`
      }
      {...rest}
    >
      {loading ? (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
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
      ) : leadingIcon ? (
        <span aria-hidden>{leadingIcon}</span>
      ) : null}
      <span>{children}</span>
    </button>
  );
});
