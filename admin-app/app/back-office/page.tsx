export const dynamic = "force-dynamic";

import { Inbox } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { listSaQueue, getAdminShopId, type SaQueueIssue } from "@/lib/back-office";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackOfficeStatusBadge, ChangeTypeBadge } from "@/components/back-office/status";
import { SubmitFixDialog } from "@/components/back-office/SubmitFixDialog";

const KIND_LABEL: Record<string, string> = {
  invoice_issue: "Invoice issue",
  open_ro: "Open RO",
  reopened_ro: "Reopened RO",
  misc: "Misc",
};

function reference(i: SaQueueIssue): string {
  if (i.roNumber) return `RO #${i.roNumber}`;
  if (i.billNo) return `#${i.billNo}`;
  return i.title ?? "—";
}

function QueueTable({ issues, showSubmit }: { issues: SaQueueIssue[]; showSubmit: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>What&apos;s wrong</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="text-xs text-muted-foreground">{KIND_LABEL[i.kind] ?? i.kind}</TableCell>
              <TableCell className="font-mono text-xs">{reference(i)}</TableCell>
              <TableCell className="text-sm">{i.vendorName ?? "—"}</TableCell>
              <TableCell className="max-w-80 text-xs text-muted-foreground">
                {i.kind === "reopened_ro" ? (
                  <ChangeTypeBadge changeType={(i.context?.change_type as string) ?? null} />
                ) : (
                  i.boNotes ?? "—"
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

export default async function BackOfficeQueuePage() {
  await requireAdmin();
  const issues = await listSaQueue(getAdminShopId());
  const needsFix = issues.filter((i) => i.status === "sent_to_sa");
  const submitted = issues.filter((i) => i.status === "awaiting_verify");

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="text-2xl font-bold text-foreground">Back office</h1>
        <p className="text-sm text-muted-foreground">
          Issues the office manager sent over. Fix them, then submit so they can verify.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Needs a fix ({needsFix.length})</h2>
        {needsFix.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Inbox className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-foreground">All caught up</p>
            <p className="mt-1 text-sm text-muted-foreground">No issues waiting on a service advisor.</p>
          </div>
        ) : (
          <QueueTable issues={needsFix} showSubmit />
        )}
      </section>

      {submitted.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-foreground">Submitted — waiting to verify ({submitted.length})</h2>
          <QueueTable issues={submitted} showSubmit={false} />
        </section>
      )}
    </main>
  );
}
