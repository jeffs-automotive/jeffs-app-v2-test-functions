"use client";

import { type HTMLAttributes, type ReactNode } from "react";
import {
  LazyMotion,
  domAnimation,
  m,
  type HTMLMotionProps,
} from "motion/react";

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
 *   - <Card.Title>Verify your phone</Card.Title>           (Poppins 600)
 *   - <Card.Description>...</Card.Description>             (sans muted)
 *   - <Card.Body>...input/fields here...</Card.Body>
 *   - <Card.Actions>...buttons here...</Card.Actions>      (right-aligned by default)
 *
 * Motion: each Card fade+slides in 8px on mount via LazyMotion+domAnimation —
 * keeps the wizard transitions calm but legible. Respects
 * prefers-reduced-motion via globals.css override.
 */

/**
 * CardProps narrowing (R6-D-2 a11y fix 2026-05-16): we accept both
 * - plain HTMLAttributes<div> shape (for the noAnimate code path which
 *   renders a <div>)
 * - motion-specific props (HTMLMotionProps<"div">) for the animated
 *   <m.div> path
 *
 * Prior shape extended HTMLAttributes<HTMLDivElement> + spread {...(rest as
 * Record<string, unknown>)} on the <m.div> — the cast bypassed TS's
 * check that aria-* attributes survive into the motion render. Now both
 * paths preserve the aria props via the union type.
 */
export type CardProps =
  & {
    /** When true, suppresses the on-mount fade animation. Useful when
     *  the card is part of a larger transition the parent owns. */
    noAnimate?: boolean;
    children?: ReactNode;
    className?: string;
  }
  & Omit<HTMLAttributes<HTMLDivElement>, "children" | "className">
  & Omit<HTMLMotionProps<"div">, "children" | "className">;

export function Card({
  children,
  className,
  noAnimate = false,
  ...rest
}: CardProps) {
  // Mobile keeps the full-bleed editorial border-y band; sm: softens to the
  // 6px contained sheet. The two-layer warm --shadow-card lifts the card off
  // paper (the prior 1px highlight dissolved on mobile). Presentational only.
  const base =
    "relative bg-paper-100 px-6 py-7 sm:px-8 sm:py-8 " +
    "border-y border-rule shadow-[var(--shadow-card)] " +
    "sm:rounded-[var(--radius-card)]";

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
        // Same curve as --ease-editorial (0.16,1,0.3,1) — tokenized for
        // consistency; motion/react needs the numeric array here.
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className={`${base} ${className ?? ""}`}
        {...(rest as HTMLMotionProps<"div">)}
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

/**
 * Section-rhythm divider — a presentational separator that replaces the
 * ad-hoc `<div className="rule-hairline">` repeated across cards so spacing
 * is consistent card-to-card. `tone="gold"` uses the decorative gold rule
 * (exempt from the contrast floor). role="separator" + aria-hidden so it's
 * announced as a separator but carries no semantic content.
 */
function Divider({
  tone = "rule",
  className,
}: {
  tone?: "rule" | "gold";
  className?: string;
}) {
  const line = tone === "gold" ? "border-brand-gold-400" : "border-rule";
  return (
    <div
      role="separator"
      aria-hidden
      className={`my-5 border-t ${line} ${className ?? ""}`}
    />
  );
}

Card.Eyebrow = Eyebrow;
Card.Title = Title;
Card.Description = Description;
Card.Body = Body;
Card.Actions = Actions;
Card.Footnote = Footnote;
Card.Divider = Divider;
