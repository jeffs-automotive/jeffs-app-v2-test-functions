export const dynamic = "force-dynamic";

import { CheckCircle2 } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { getBackOfficeSettings, getDashboardCounts, listAllActiveIssues, type BackOfficeIssue } from "@/lib/dal/back-office";
import { getShopSettings } from "@/lib/dal/settings";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { BackOfficeStatusBadge } from "@/components/back-office/status";
import { monthStartYmd, isStale, daysSince } from "@/lib/back-office/format";
import AutoRefresh from "@/components/AutoRefresh";

const KIND_LABEL: Record<string, string> = {
  invoice_issue: "Invoice issue",
  open_ro: "Open RO",
  reopened_ro: "Reopened RO",
  misc: "Misc",
};

function issueRef(i: BackOfficeIssue): string {
  if (i.roNumber) return `RO #${i.roNumber}`;
  if (i.billNo) return `#${i.billNo}`;
  return i.title ?? "—";
}

function Metric({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5 text-center">
        <div className={`text-3xl font-bold leading-none ${accent ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>{value}</div>
        <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
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
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <AutoRefresh />
      <PageHeader title="Back office" description="Open issues, what's closed this month, and anything gone stale." />

      <div className="grid grid-cols-3 gap-3">
        <Metric value={counts.openCount} label="Open" />
        <Metric value={counts.closedThisMonth} label="Closed this month" />
        <Metric value={counts.staleCount} label="Stale" accent />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Stale — over {settings.staleHours}h</h2>
        {stale.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing stale" subtext="Everything open is moving." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Days open</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stale.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">{issueRef(i)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{KIND_LABEL[i.kind] ?? i.kind}</TableCell>
                    <TableCell className="tabular-nums font-semibold text-red-600 dark:text-red-400">{daysSince(i.createdAt)}d</TableCell>
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
