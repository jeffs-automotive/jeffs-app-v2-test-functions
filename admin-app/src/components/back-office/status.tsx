/**
 * Back-office status vocabulary — the SHARED badges (status pill, change-type tag, kind tag)
 * render identically to qteklink-app's copy so a status reads the same in both apps (the
 * cross-app design contract). Only the `IssueStatus` import path differs; the office-only
 * StaleBadge is not carried here. Color + icon (never color alone); tints clear WCAG AA in
 * light AND dark. Icons are aria-hidden; the visible label is the accessible name.
 */
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  ClipboardCheck,
  Receipt,
  Replace,
  RotateCcw,
  SendHorizontal,
  StickyNote,
  Undo2,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { IssueStatus } from "@/lib/back-office";

type IconType = typeof CheckCircle2;

// Lifecycle pill — the primary signal, one per row. The hue tells you whose court the
// ball is in: neutral = nobody yet, blue = advisor, amber = you (verify), green = done.
const STATUS: Record<IssueStatus, { label: string; cls: string; Icon: IconType }> = {
  open: {
    label: "Open",
    cls: "border-border bg-muted text-muted-foreground",
    Icon: Circle,
  },
  sent_to_sa: {
    label: "With advisor",
    cls: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
    Icon: SendHorizontal,
  },
  awaiting_verify: {
    label: "Awaiting verify",
    cls: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
    Icon: ClipboardCheck,
  },
  verified: {
    label: "Verified",
    cls: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
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

// Change-type tag — a lighter-weight classification (outline + body-ink label, the hue
// lives only on the icon as redundant reinforcement, so there is zero text-contrast risk).
const CHANGE_TYPE: Record<string, { label: string; Icon: IconType; iconCls: string }> = {
  unposted: { label: "Unposted", Icon: Undo2, iconCls: "text-red-600 dark:text-red-400" },
  reposted: { label: "Reposted", Icon: RotateCcw, iconCls: "text-sky-600 dark:text-sky-400" },
  date_changed: { label: "Date changed", Icon: CalendarClock, iconCls: "text-sky-600 dark:text-sky-400" },
  total_changed: { label: "Total changed", Icon: CircleDollarSign, iconCls: "text-amber-600 dark:text-amber-400" },
  date_and_total_changed: {
    label: "Date & total changed",
    Icon: Replace,
    iconCls: "text-violet-600 dark:text-violet-400",
  },
};

export function ChangeTypeBadge({ changeType }: { changeType: string | null }) {
  if (!changeType) return null;
  const c = CHANGE_TYPE[changeType] ?? { label: changeType, Icon: RotateCcw, iconCls: "text-muted-foreground" };
  return (
    <Badge variant="outline" className="gap-1 text-foreground">
      <c.Icon aria-hidden="true" className={c.iconCls} />
      {c.label}
    </Badge>
  );
}

// Kind tag — neutral (kind is not a status); shown only where kinds mix (dashboard, SA queue).
const KIND: Record<string, { label: string; Icon: IconType }> = {
  invoice_issue: { label: "Invoice", Icon: Receipt },
  open_ro: { label: "Open RO", Icon: Wrench },
  reopened_ro: { label: "Reopened", Icon: RotateCcw },
  misc: { label: "Misc", Icon: StickyNote },
};

export function IssueKindBadge({ kind }: { kind: string }) {
  const k = KIND[kind] ?? { label: kind, Icon: StickyNote };
  return (
    <Badge variant="secondary" className="gap-1">
      <k.Icon aria-hidden="true" />
      {k.label}
    </Badge>
  );
}
