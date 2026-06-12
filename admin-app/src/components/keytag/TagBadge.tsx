/**
 * TagBadge — color-coded R/Y key-tag badge.
 *
 * Red tags get a red fill + white text; yellow tags get a yellow fill +
 * dark text. Compact "R4" / "Y45" style matches what's used across
 * Tekmetric + Claude Desktop today.
 */
import { cn } from "@/lib/utils";
import type { TagColor } from "@/lib/orchestrator/types";

export interface TagBadgeProps {
  color: TagColor;
  number: number;
  size?: "sm" | "md";
  className?: string;
}

export function TagBadge({
  color,
  number,
  size = "md",
  className,
}: TagBadgeProps) {
  const sizeClasses =
    size === "sm"
      ? "h-5 min-w-8 px-1.5 text-[11px]"
      : "h-6 min-w-10 px-2 text-xs";
  const colorClasses =
    color === "red"
      ? "bg-red-600 text-white border-red-700"
      : "bg-yellow-400 text-stone-900 border-yellow-500";
  const label = (color === "red" ? "R" : "Y") + number;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border font-mono font-semibold tabular-nums shadow-xs",
        sizeClasses,
        colorClasses,
        className,
      )}
      aria-label={`${color === "red" ? "Red" : "Yellow"} tag ${number}`}
    >
      {label}
    </span>
  );
}
