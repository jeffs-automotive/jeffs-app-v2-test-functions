/**
 * StatusBadge — one consistent color+icon status vocabulary for the admin
 * dashboard (design-craft §7: status = color + icon, never color alone).
 *
 * Purely presentational: it wraps the existing <Badge variant="outline">
 * with a fixed tint + lucide icon per semantic status, and renders its
 * children as the (still tested-on) label text. It changes NO data and
 * carries no behavior. Icons are aria-hidden so they never pollute the
 * accessible name — role/text queries on the children keep working.
 *
 * Every status pair is AA-verified as text-on-tint (ratios pinned in the
 * spec §2):
 *   ok       emerald-800 on emerald-50 ≈ 6.7:1
 *   warning  amber-900 on amber-50    ≈ 8.8:1
 *   error    red-700 on red-50        ≈ 5.9:1
 *   info     sky-700 on sky-50        ≈ 5.6:1
 *   neutral  muted-foreground on muted ≈ 5.1:1
 */
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusKind = "ok" | "warning" | "error" | "info" | "neutral";

interface StatusConfig {
  icon: LucideIcon | null;
  classes: string;
}

const STATUS_CONFIG: Record<StatusKind, StatusConfig> = {
  ok: {
    icon: CheckCircle2,
    classes: "border-emerald-300 bg-emerald-50 text-emerald-800",
  },
  warning: {
    icon: AlertTriangle,
    classes: "border-amber-300 bg-amber-50 text-amber-900",
  },
  error: {
    icon: XCircle,
    classes: "border-red-300 bg-red-50 text-red-700",
  },
  info: {
    icon: Info,
    classes: "border-sky-300 bg-sky-50 text-sky-700",
  },
  neutral: {
    icon: null,
    classes: "border-border bg-muted text-muted-foreground",
  },
};

export interface StatusBadgeProps {
  status: StatusKind;
  children: ReactNode;
  /** Render the micro-label treatment (text-[10px] uppercase tracking-wider). */
  micro?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  children,
  micro = false,
  className,
}: StatusBadgeProps) {
  const { icon: Icon, classes } = STATUS_CONFIG[status];
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1",
        classes,
        micro && "text-[10px] font-medium uppercase tracking-wider",
        className,
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden="true" />}
      {children}
    </Badge>
  );
}
