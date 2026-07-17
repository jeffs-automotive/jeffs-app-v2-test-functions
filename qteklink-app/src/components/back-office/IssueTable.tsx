/**
 * IssueTable — the office-manager list for one issue kind. Server component (its only
 * client leaf is <RowActions>). Kind-specific columns; a shared status pill + a stale
 * overlay + the before→after diff for reopened ROs. Empty state included.
 */
import { Inbox } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { BackOfficeStatusBadge, StaleBadge, ChangeTypeBadge } from "./status";
import { RowActions } from "./RowActions";
import { centsToUsd, isStale } from "@/lib/back-office/format";
import type { BackOfficeIssue, IssueKind } from "@/lib/dal/back-office";

function ctx(i: BackOfficeIssue, k: string): string | null {
  const v = i.context?.[k];
  return v == null ? null : String(v);
}

function StatusCell({ issue, staleHours }: { issue: BackOfficeIssue; staleHours: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <BackOfficeStatusBadge status={issue.status} />
      {isStale(issue.lastActivityAt, staleHours) && (
        <StaleBadge days={Math.max(1, Math.floor((Date.now() - new Date(issue.createdAt).getTime()) / 86_400_000))} />
      )}
    </div>
  );
}

const HEADERS: Record<IssueKind, string[]> = {
  invoice_issue: ["Vendor", "Bill / Exp #", "RO #", "Bill date", "Amount", "Back-office note", "SA fix", "Status", ""],
  open_ro: ["Vendor", "Bill #", "RO #", "Bill date", "Amount", "RO state", "Status", ""],
  reopened_ro: ["RO #", "What changed", "Posted date", "Total", "Unposted by", "Status", ""],
  misc: ["Title", "RO #", "Note", "Status", ""],
};

export function IssueTable({ issues, kind, staleHours }: { issues: BackOfficeIssue[]; kind: IssueKind; staleHours: number }) {
  if (issues.length === 0) {
    return <EmptyState icon={Inbox} title="No open issues" subtext="Nothing in this tab right now." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {HEADERS[kind].map((h, idx) => (
              <TableHead key={idx}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((i) => (
            <TableRow key={i.id}>
              {kind === "invoice_issue" && (
                <>
                  <TableCell>{i.vendorName ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{i.billNo ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{i.roNumber ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{i.billDate ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{centsToUsd(i.totalCents)}</TableCell>
                  <TableCell className="max-w-56 text-xs text-muted-foreground">{i.boNotes ?? "—"}</TableCell>
                  <TableCell className="max-w-56 text-xs text-muted-foreground">{i.saNotes ?? "—"}</TableCell>
                </>
              )}
              {kind === "open_ro" && (
                <>
                  <TableCell>{i.vendorName ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{i.billNo ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{i.roNumber ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{i.billDate ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{centsToUsd(i.totalCents)}</TableCell>
                  <TableCell className="text-xs">{ctx(i, "ro_status") === "ro_closed" ? "RO closed" : "RO open"}</TableCell>
                </>
              )}
              {kind === "reopened_ro" && (
                <>
                  <TableCell className="font-mono text-xs">{i.roNumber ?? "—"}</TableCell>
                  <TableCell>
                    <ChangeTypeBadge changeType={ctx(i, "change_type")} />
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    <span className="text-muted-foreground line-through">{ctx(i, "original_posted_date") ?? "—"}</span>{" "}
                    <span className="font-semibold">{ctx(i, "new_posted_date") ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    <span className="text-muted-foreground line-through">{centsToUsd(i.context?.original_total_cents as number | null)}</span>{" "}
                    <span className="font-semibold">{centsToUsd(i.context?.new_total_cents as number | null)}</span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ctx(i, "unposted_by") ?? "—"}</TableCell>
                </>
              )}
              {kind === "misc" && (
                <>
                  <TableCell className="font-medium">{i.title ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{i.roNumber ?? "—"}</TableCell>
                  <TableCell className="max-w-72 text-xs text-muted-foreground">{i.boNotes ?? "—"}</TableCell>
                </>
              )}
              <TableCell>
                <StatusCell issue={i} staleHours={staleHours} />
              </TableCell>
              <TableCell className="text-right">
                <RowActions issue={i} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
