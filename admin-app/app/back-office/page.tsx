export const dynamic = "force-dynamic";

import { CheckCircle2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { listSaQueue, getAdminShopId, type SaQueueIssue } from "@/lib/back-office";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { BackOfficeStatusBadge, ChangeTypeBadge, IssueKindBadge } from "@/components/back-office/status";
import { SubmitFixDialog } from "@/components/back-office/SubmitFixDialog";

function reference(i: SaQueueIssue): string {
  if (i.roNumber) return `RO #${i.roNumber}`;
  if (i.billNo) return `#${i.billNo}`;
  return i.title ?? "—";
}

function QueueTable({ issues, showSubmit }: { issues: SaQueueIssue[]; showSubmit: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border shadow-xs">
      <Table>
        <TableHeader className="bg-muted [&_th]:h-10 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead>Kind</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>What&apos;s wrong</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-3 [&_td]:py-2.5">
          {issues.map((i) => (
            <TableRow
              key={i.id}
              className={cn(showSubmit && "border-l-2 border-l-amber-400 dark:border-l-amber-500")}
            >
              <TableCell><IssueKindBadge kind={i.kind} /></TableCell>
              <TableCell className="font-mono text-xs tabular-nums">{reference(i)}</TableCell>
              <TableCell className="text-sm">
                <div className="max-w-[20ch] truncate" title={i.vendorName ?? undefined}>{i.vendorName ?? "—"}</div>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {i.kind === "reopened_ro" ? (
                  <ChangeTypeBadge changeType={(i.context?.change_type as string) ?? null} />
                ) : (
                  <div className="max-w-[36ch] truncate" title={i.boNotes ?? undefined}>{i.boNotes ?? "—"}</div>
                )}
              </TableCell>
              <TableCell>
                <BackOfficeStatusBadge status={i.status} />
              </TableCell>
              <TableCell className="text-right">
                {showSubmit ? (
                  <SubmitFixDialog issue={i} />
                ) : (
                  <span className="text-xs text-muted-foreground">Waiting on office</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {count > 0 && (
        <Badge variant="secondary" className="tabular-nums">
          {count}
        </Badge>
      )}
    </div>
  );
}

export default async function BackOfficeQueuePage() {
  const { email } = await requireAdmin();
  const issues = await listSaQueue(getAdminShopId());
  const needsFix = issues.filter((i) => i.status === "sent_to_sa");
  const submitted = issues.filter((i) => i.status === "awaiting_verify");

  return (
    <AppShell email={email}>
      <PageHeader
        eyebrow="Service advisor"
        title="Back office"
        description="Vendor-bill and re-post issues the office needs your help on. Fix them, then submit so they can verify."
      />

      <div className="space-y-8">
        <section className="space-y-2">
          <SectionHeading title="Needs your fix" count={needsFix.length} />
          {needsFix.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <CheckCircle2 className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-foreground">Nothing needs you right now</p>
              <p className="mt-1 text-sm text-muted-foreground">The office hasn&apos;t sent any issues your way.</p>
            </div>
          ) : (
            <QueueTable issues={needsFix} showSubmit />
          )}
        </section>

        <section className="space-y-2">
          <SectionHeading title="Submitted — waiting to verify" count={submitted.length} />
          {submitted.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center">
              <p className="text-sm text-muted-foreground">Nothing awaiting the office right now.</p>
            </div>
          ) : (
            <QueueTable issues={submitted} showSubmit={false} />
          )}
        </section>
      </div>
    </AppShell>
  );
}
