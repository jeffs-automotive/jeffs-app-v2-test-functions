export const dynamic = "force-dynamic";

import { AlarmClock, CheckCircle2, Inbox } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { getBackOfficeSettings, getDashboardCounts, listAllActiveIssues, type BackOfficeIssue } from "@/lib/dal/back-office";
import { getShopSettings } from "@/lib/dal/settings";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { BackOfficeStatusBadge, IssueKindBadge } from "@/components/back-office/status";
import { cn } from "@/lib/utils";
import { monthStartYmd, isStale, daysSince } from "@/lib/back-office/format";
import AutoRefresh from "@/components/AutoRefresh";

function issueRef(i: BackOfficeIssue): string {
  if (i.roNumber) return `RO #${i.roNumber}`;
  if (i.billNo) return `#${i.billNo}`;
  return i.title ?? "—";
}

function Metric({
  value,
  label,
  Icon,
  accent,
}: {
  value: number;
  label: string;
  Icon: typeof Inbox;
  accent?: boolean;
}) {
  const flagged = Boolean(accent) && value > 0;
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 p-5 text-center">
        <div
          className={cn(
            "text-3xl font-bold leading-none tabular-nums",
            flagged ? "text-red-700 dark:text-red-300" : "text-foreground",
          )}
        >
          {value}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <Icon className="size-3.5" aria-hidden="true" />
          {label}
        </div>
        {flagged && (
          <Badge
            variant="outline"
            className="border-red-300 bg-red-50 text-[10px] uppercase tracking-wider text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            Needs review
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

export default async function BackOfficeDashboardPage() {
  const { shopId } = await requireQtekUser();
  const [{ settings }, shop] = await Promise.all([getBackOfficeSettings(shopId), getShopSettings(shopId)]);
  const tz = shop.settings.shopTimezone;
  const [counts, active] = await Promise.all([
    getDashboardCounts(shopId, monthStartYmd(tz), settings.staleHours),
    listAllActiveIssues(shopId),
  ]);
  const stale = active
    .filter((i) => isStale(i.lastActivityAt, settings.staleHours))
    .sort((a, b) => daysSince(b.createdAt) - daysSince(a.createdAt));

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-12">
      <AutoRefresh />
      <PageHeader title="Back office" description="Open issues, what's closed this month, and anything gone stale." />

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <Metric value={counts.openCount} label="Open" Icon={Inbox} />
        <Metric value={counts.closedThisMonth} label="Closed this month" Icon={CheckCircle2} />
        <Metric value={counts.staleCount} label="Stale" Icon={AlarmClock} accent />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Stale — over {settings.staleHours}h</h2>
        {stale.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing's gone stale" subtext="Every open issue has had activity recently." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border shadow-xs">
            <Table>
              <TableHeader className="bg-muted [&_th]:h-10 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead>Kind</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Days open</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_td]:px-3 [&_td]:py-2.5">
                {stale.map((i) => (
                  <TableRow key={i.id} className="border-l-2 border-l-red-400 dark:border-l-red-500">
                    <TableCell><IssueKindBadge kind={i.kind} /></TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{issueRef(i)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-red-700 dark:text-red-300">{daysSince(i.createdAt)}d</TableCell>
                    <TableCell>
                      <BackOfficeStatusBadge status={i.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </main>
  );
}
