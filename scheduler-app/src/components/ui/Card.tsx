"use client";

import { type HTMLAttributes, type ReactNode } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";

/**
 * Heritage Editorial Card — the universal surface for wizard steps.
 *
 * Visual language (per chat-design.md 2026-05-13 visual lock):
 *   - Ivory paper-100 fill on a paper background. The contrast is gentle.
 *   - Hairline 1px gold-ish rule top + bottom, never a heavy 4-side border.
 *   - Generous internal padding (24-32px) — editorial whitespace.
 *   - Minimal rounding (6px) — restrained, not bubbly.
 *
 * Composition slots:
 *   - <Card.Eyebrow>Step 3 · Verify phone</Card.Eyebrow>   (uppercase small)
 *   - <Card.Title>Verify your phone</Card.Title>           (serif Fraunces)
 *   - <Card.Description>...</Card.Description>             (sans muted)
 *   - <Card.Body>...input/fields here...</Card.Body>
 *   - <Card.Actions>...buttons here...</Card.Actions>      (right-aligned by default)
 *
 * Motion: each Card fade+slides in 8px on mount via LazyMotion+domAnimation —
 * keeps the wizard transitions calm but legible. Respects
 * prefers-reduced-motion via globals.css override.
 */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** When true, suppresses the on-mount fade animation. Useful when the card
   *  is part of a larger transition the parent owns. */
  noAnimate?: boolean;
  /** Optional aria-label / aria-labelledby is supported via {...rest}. */
}

export function Card({
  children,
  className,
  noAnimate = false,
  ...rest
}: CardProps) {
  const base =
    "relative bg-paper-100 px-6 py-7 sm:px-8 sm:py-8 " +
    "border-y border-rule shadow-[0_1px_0_0_rgba(0,0,0,0.02)]";

  if (noAnimate) {
    return (
      <div className={`${base} ${className ?? ""}`} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className={`${base} ${className ?? ""}`}
        {...(rest as Record<string, unknown>)}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}

// ─── Composable subcomponents ───────────────────────────────────────────────

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="label-eyebrow mb-2">{children}</p>;
}

function Title({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="font-display text-2xl leading-tight text-ink sm:text-[28px]"
    >
      {children}
    </h2>
  );
}

function Description({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">
      {children}
    </p>
  );
}

function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`mt-5 ${className ?? ""}`}>{children}</div>;
}

function Actions({
  children,
  align = "right",
  className,
}: {
  children: ReactNode;
  align?: "left" | "right" | "between";
  className?: string;
}) {
  const alignment =
    align === "left"
      ? "justify-start"
      : align === "between"
        ? "justify-between"
        : "justify-end";
  return (
    <div
      className={`mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center ${alignment} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function Footnote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 text-xs leading-relaxed text-ink-tertiary">{children}</p>
  );
}

Card.Eyebrow = Eyebrow;
Card.Title = Title;
Card.Description = Description;
Card.Body = Body;
Card.Actions = Actions;
Card.Footnote = Footnote;
