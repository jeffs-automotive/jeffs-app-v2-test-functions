/**
 * IssueTable — the office-manager list for one issue kind. Server component; each row is a
 * <ClickableRow> that opens the full-detail modal (all fields + actions + parts-invoice
 * image). Kind-specific summary columns; a shared status pill + a stale overlay + the
 * before→after diff for reopened ROs. Dense ledger treatment: mono/tabular numerics,
 * right-aligned money, truncated free text (full value lives in the modal). Kind-aware empty.
 */
import { CheckCircle2, ChevronRight, DoorClosed, DoorOpen, Inbox } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { BackOfficeStatusBadge, StaleBadge, ChangeTypeBadge } from "./status";
import { DiffPair, DeltaChip } from "./DiffPair";
import { ClickableRow } from "./ClickableRow";
import { centsToUsd, isStale } from "@/lib/back-office/format";
import type { BackOfficeIssue, IssueKind } from "@/lib/dal/back-office";

function ctx(i: BackOfficeIssue, k: string): string | null {
  const v = i.context?.[k];
  return v == null ? null : String(v);
}

function ctxNum(i: BackOfficeIssue, k: string): number | null {
  const v = i.context?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Truncated free-text cell content: clamps to a max width, full value on hover/focus. */
function Truncate({ text, max, className }: { text: string | null; max: string; className?: string }) {
  return (
    <div className={cn("truncate", max, className)} title={text ?? undefined}>
      {text ?? "—"}
    </div>
  );
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

// Header labels per kind. A trailing `~` marks a right-aligned (numeric) column; the empty
// string is the actions column.
const HEADERS: Record<IssueKind, string[]> = {
  invoice_issue: ["Vendor", "Bill / Exp #", "RO #", "Bill date", "Amount~", "Back-office note", "SA fix", "Status", ""],
  open_ro: ["Vendor", "Bill #", "RO #", "Bill date", "Amount~", "RO state", "Status", ""],
  reopened_ro: ["RO #", "What changed", "Posted date", "Total~", "Reopened by", "Status", ""],
  misc: ["Title", "RO #", "Note", "Status", ""],
};

const EMPTY: Record<IssueKind, { icon: typeof CheckCircle2; title: string; subtext: string }> = {
  invoice_issue: { icon: CheckCircle2, title: "No open invoice issues", subtext: "You're all caught up — add one with the button above." },
  open_ro: { icon: CheckCircle2, title: "No open-RO issues", subtext: "Nothing is waiting on a repair order to close." },
  reopened_ro: { icon: Inbox, title: "Nothing reopened", subtext: "No posted repair orders have been unposted or re-posted." },
  misc: { icon: CheckCircle2, title: "No misc items", subtext: "One-off issues you send to the advisors will show up here." },
};

export function IssueTable({ issues, kind, staleHours }: { issues: BackOfficeIssue[]; kind: IssueKind; staleHours: number }) {
  if (issues.length === 0) {
    const e = EMPTY[kind];
    return <EmptyState icon={e.icon} title={e.title} subtext={e.subtext} />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border shadow-xs">
      <Table>
        <TableHeader className="bg-muted [&_th]:h-10 [&_th]:px-3 [&_th]:text-xs [&_th]:font-medium [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            {HEADERS[kind].map((h, idx) => {
              const right = h.endsWith("~");
              return (
                <TableHead key={idx} className={cn(right && "text-right")}>
                  {right ? h.slice(0, -1) : h}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody className="[&_td]:px-3 [&_td]:py-2.5">
          {issues.map((i) => {
            const stale = isStale(i.lastActivityAt, staleHours);
            const rowCls = cn(stale && "border-l-2 border-l-red-400 dark:border-l-red-500");
            return (
              <ClickableRow key={i.id} issue={i} staleHours={staleHours} rowClassName={rowCls}>
                {kind === "invoice_issue" && (
                  <>
                    <TableCell><Truncate text={i.vendorName} max="max-w-[20ch]" className="font-medium" /></TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{i.billNo ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{i.roNumber ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{i.billDate ?? "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{centsToUsd(i.totalCents)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground"><Truncate text={i.boNotes} max="max-w-[28ch]" /></TableCell>
                    <TableCell className="text-xs text-muted-foreground"><Truncate text={i.saNotes} max="max-w-[28ch]" /></TableCell>
                  </>
                )}
                {kind === "open_ro" && (
                  <>
                    <TableCell><Truncate text={i.vendorName} max="max-w-[20ch]" className="font-medium" /></TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{i.billNo ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{i.roNumber ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{i.billDate ?? "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{centsToUsd(i.totalCents)}</TableCell>
                    <TableCell>
                      {ctx(i, "ro_status") === "ro_closed" ? (
                        <Badge variant="outline" className="gap-1">
                          <DoorClosed aria-hidden="true" />
                          Closed
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <DoorOpen aria-hidden="true" />
                          Open
                        </Badge>
                      )}
                    </TableCell>
                  </>
                )}
                {kind === "reopened_ro" && (
                  <>
                    <TableCell className="font-mono text-xs tabular-nums">{i.roNumber ?? "—"}</TableCell>
                    <TableCell>
                      <ChangeTypeBadge changeType={ctx(i, "change_type")} />
                    </TableCell>
                    <TableCell className="text-xs">
                      <DiffPair before={ctx(i, "baseline_posted_date")} after={ctx(i, "final_posted_date")} />
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <DiffPair
                          before={centsToUsd(ctxNum(i, "baseline_total_cents"))}
                          after={ctxNum(i, "final_total_cents") == null ? null : centsToUsd(ctxNum(i, "final_total_cents"))}
                        />
                        {ctxNum(i, "baseline_total_cents") != null && ctxNum(i, "final_total_cents") != null && (
                          <DeltaChip deltaCents={(ctxNum(i, "final_total_cents") ?? 0) - (ctxNum(i, "baseline_total_cents") ?? 0)} />
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground"><Truncate text={ctx(i, "reopened_by")} max="max-w-[18ch]" /></TableCell>
                  </>
                )}
                {kind === "misc" && (
                  <>
                    <TableCell><Truncate text={i.title} max="max-w-[24ch]" className="font-medium" /></TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{i.roNumber ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground"><Truncate text={i.boNotes} max="max-w-[40ch]" /></TableCell>
                  </>
                )}
                <TableCell>
                  <StatusCell issue={i} staleHours={staleHours} />
                </TableCell>
                <TableCell className="text-right">
                  <ChevronRight aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
                </TableCell>
              </ClickableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
