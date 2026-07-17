export const dynamic = "force-dynamic";

import { CheckCircle2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { listSaQueue, getAdminShopId, type SaQueueIssue } from "@/lib/back-office";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SaQueueRow } from "@/components/back-office/SaQueueRow";

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
            <SaQueueRow key={i.id} issue={i} showSubmit={showSubmit} />
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
