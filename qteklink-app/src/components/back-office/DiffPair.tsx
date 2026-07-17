/**
 * DiffPair — a Linear/GitHub-style old→new value pair for a reopened RO (a value that
 * "moved"): the before is struck through + muted, an arrow, then the after in body ink.
 * Both sides are tabular-nums so a column of them aligns. When nothing changed (before ===
 * after, or there is no after) it renders the single value as a plain fact — no arrow.
 * The money DeltaChip trails a total change with a NEUTRAL signed amount (a re-post is
 * neither a gain nor a loss, so it is never colored green/red). Purely presentational.
 */
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { centsToUsd } from "@/lib/back-office/format";

export function DiffPair({
  before,
  after,
  className,
}: {
  before: string | null | undefined;
  after: string | null | undefined;
  className?: string;
}) {
  const b = before ?? "—";
  const a = after ?? null;
  const changed = a != null && a !== b;

  if (!changed) {
    return <span className={cn("tabular-nums text-muted-foreground", className)}>{a ?? b}</span>;
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5 tabular-nums", className)}>
      <span className="text-muted-foreground line-through">{b}</span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="font-medium text-foreground">{a}</span>
    </span>
  );
}

/** Neutral signed money delta chip: (+$40.00) / (−$40.00). Hidden when there is no delta. */
export function DeltaChip({ deltaCents }: { deltaCents: number | null | undefined }) {
  if (deltaCents == null || !Number.isFinite(deltaCents) || deltaCents === 0) return null;
  const up = deltaCents > 0;
  const Arrow = up ? ArrowUp : ArrowDown;
  const sign = up ? "+" : "−"; // U+2212 minus sign
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
      <Arrow className="size-3 shrink-0" aria-hidden="true" />
      {sign}
      {centsToUsd(Math.abs(deltaCents))}
    </span>
  );
}
