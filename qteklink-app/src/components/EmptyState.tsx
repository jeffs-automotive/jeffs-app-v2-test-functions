/**
 * EmptyState — the designed empty-surface pattern for QTekLink (dashed-border
 * centered box + lucide glyph + headline + subtext). Mirrors admin-app's empty
 * states. Purely presentational.
 */
import type { ComponentType, ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  subtext,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: ReactNode;
  subtext?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" aria-hidden={true} />
      <p className="mt-3 text-sm font-medium text-foreground">{title}</p>
      {subtext ? (
        <p className="mt-1 text-sm text-muted-foreground">{subtext}</p>
      ) : null}
    </div>
  );
}
