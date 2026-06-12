/**
 * StatusBadge — the shared status vocabulary for QTekLink (color + icon, never
 * color alone). Maps the snapshot column statuses to a tint/text/icon trio. All
 * text-on-tint pairs clear WCAG AA (ratios pinned in the redesign spec's States
 * table). Purely presentational.
 */
import { AlertTriangle, CheckCircle2, Circle, Loader } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SnapshotColumn } from "@/lib/dal/daily-snapshot";
import { cn } from "@/lib/utils";

const STATUS: Record<
  SnapshotColumn,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  needsAttention: {
    label: "Needs attention",
    cls: "border-amber-200 bg-amber-50 text-amber-800",
    Icon: AlertTriangle,
  },
  unapproved: {
    label: "Unapproved",
    cls: "border-border bg-muted text-muted-foreground",
    Icon: Circle,
  },
  inProgress: {
    label: "In progress",
    cls: "border-blue-200 bg-blue-50 text-blue-800",
    Icon: Loader,
  },
  posted: {
    label: "Posted",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Icon: CheckCircle2,
  },
};

export function StatusBadge({ status }: { status: SnapshotColumn }) {
  const s = STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1", s.cls)}>
      <s.Icon aria-hidden="true" />
      {s.label}
    </Badge>
  );
}
