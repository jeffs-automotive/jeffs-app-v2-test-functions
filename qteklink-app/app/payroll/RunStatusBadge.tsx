/**
 * RunStatusBadge — payroll-run status vocabulary (open / completed / voided),
 * color + icon + text (never color alone). Deliberately a LOCAL badge in the
 * payroll folder: the shared StatusBadge's type is SnapshotColumn (design spec
 * §1b) — this mirrors its tint idiom without widening that type. Purely
 * presentational.
 */
import { Ban, Lock, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/payroll/types";

const STATUS: Record<RunStatus, { label: string; cls: string; Icon: typeof Lock }> = {
  open: {
    label: "Open",
    cls: "border-blue-200 bg-blue-50 text-blue-800",
    Icon: PenLine,
  },
  completed: {
    label: "Completed",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Icon: Lock,
  },
  voided: {
    label: "Voided",
    cls: "border-slate-300 bg-slate-100 text-slate-700",
    Icon: Ban,
  },
};

export default function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return (
    <Badge variant="outline" className={cn("gap-1", s.cls)}>
      <s.Icon aria-hidden="true" />
      {s.label}
    </Badge>
  );
}
