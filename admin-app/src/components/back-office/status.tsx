/**
 * Back-office status vocabulary — mirrored byte-for-byte from qteklink-app so a status
 * reads identically in both apps (the cross-app design contract). Color + icon, WCAG-AA
 * tints. Purely presentational.
 */
import { AlertTriangle, CheckCircle2, Circle, Clock, RotateCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/lib/back-office";

const STATUS: Record<IssueStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  open: { label: "Open", cls: "border-border bg-muted text-muted-foreground", Icon: Circle },
  sent_to_sa: { label: "With advisor", cls: "border-sky-200 bg-sky-50 text-sky-800", Icon: Send },
  awaiting_verify: { label: "Awaiting verify", cls: "border-amber-200 bg-amber-50 text-amber-800", Icon: Clock },
  verified: { label: "Verified", cls: "border-emerald-200 bg-emerald-50 text-emerald-800", Icon: CheckCircle2 },
};

export function BackOfficeStatusBadge({ status }: { status: IssueStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1", s.cls)}>
      <s.Icon aria-hidden="true" />
      {s.label}
    </Badge>
  );
}

export function StaleBadge({ days }: { days: number }) {
  return (
    <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-700">
      <AlertTriangle aria-hidden="true" />
      Stale · {days}d
    </Badge>
  );
}

const CHANGE_TYPE: Record<string, { label: string; Icon: typeof RotateCcw }> = {
  unposted: { label: "Unposted", Icon: RotateCcw },
  reposted: { label: "Reposted", Icon: RotateCcw },
  date_changed: { label: "Date changed", Icon: RotateCcw },
  total_changed: { label: "Total changed", Icon: RotateCcw },
  date_and_total_changed: { label: "Date & total changed", Icon: RotateCcw },
};

export function ChangeTypeBadge({ changeType }: { changeType: string | null }) {
  if (!changeType) return null;
  const c = CHANGE_TYPE[changeType] ?? { label: changeType, Icon: RotateCcw };
  return (
    <Badge variant="outline" className="gap-1 text-foreground">
      <c.Icon aria-hidden="true" />
      {c.label}
    </Badge>
  );
}
