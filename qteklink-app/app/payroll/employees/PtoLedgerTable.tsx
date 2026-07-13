/**
 * PtoLedgerTable — the per-employee PTO activity ledger, NEWEST FIRST (design
 * spec §2). Purely presentational: it renders the DAL's ledger rows in the order
 * provided (the DAL orders newest-first — plan §2b: "the ledger IS the
 * per-employee activity page"); no client sort, no math. Reuses the SummaryView
 * table idiom verbatim — the shadcn Table, the bg-muted uppercase header, the
 * `overflow-hidden rounded-lg border border-border shadow-xs` wrapper,
 * break-inside-avoid rows, and the print-friendly treatment — so an employee's
 * activity prints cleanly with the deficit tint intact (the global
 * print-color-adjust: exact block covers the PTO-negative pair via PtoBalance).
 *
 * Columns: When (fmtAsOf), Type (a per-kind Badge), Change (signed hours, +
 * emerald / − deficit / 0 plain), Balance after (PtoBalance so a row that took
 * the balance negative shows the deficit chip inline), Reason (— when null), Who.
 *
 * Server-safe (no "use client"): it takes plain data props, so the activity page
 * stays a server component.
 */
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PtoLedgerEntry, PtoLedgerKind } from "@/lib/dal/payroll";
import { cn } from "@/lib/utils";
import { fmtAsOf, fmtSignedHours, NA, numCell, PtoBalance } from "../payroll-ui";

/**
 * The per-kind Type badge. `accrual` uses the --color-auto indigo (it IS
 * system-derived, like the AutoValue provenance chip); `adjustment` is
 * primary-tinted (a human keyed it); `rollover_forfeit` uses the --color-voided
 * slate (archival); the rest are neutral outline. Color never carries the
 * meaning alone — the human label rides alongside.
 */
const KIND_META: Record<PtoLedgerKind, { label: string; cls: string }> = {
  initial: { label: "Initial", cls: "border-border" },
  accrual: {
    label: "Accrual",
    cls: "border-[color:var(--color-auto-border)] bg-[color:var(--color-auto-bg)] text-[color:var(--color-auto)]",
  },
  usage: { label: "Usage", cls: "border-border" },
  adjustment: {
    label: "Adjustment",
    cls: "border-primary/30 bg-primary/10 text-primary",
  },
  rollover_forfeit: {
    label: "Rollover forfeit",
    cls: "border-[color:var(--color-voided-border)] bg-[color:var(--color-voided-bg)] text-[color:var(--color-voided)]",
  },
  void_reversal: { label: "Reversal", cls: "border-border" },
};

function KindBadge({ kind }: { kind: PtoLedgerKind }) {
  const meta = KIND_META[kind];
  return (
    <Badge variant="outline" className={meta.cls}>
      {meta.label}
    </Badge>
  );
}

/** The signed-hours change cell: positive emerald, negative in the PTO-negative
 *  hue, zero plain — the U+2212 minus glyph via fmtSignedHours. */
function ChangeCell({ hours }: { hours: number }) {
  const cls =
    hours > 0
      ? "text-emerald-800 dark:text-emerald-300"
      : hours < 0
        ? "text-[color:var(--color-pto-negative)]"
        : "text-muted-foreground";
  return <TableCell className={cn(numCell, cls, "font-medium")}>{fmtSignedHours(hours)}</TableCell>;
}

export function PtoLedgerTable({ entries }: { entries: PtoLedgerEntry[] }) {
  return (
    <div className="print-keep overflow-hidden rounded-lg border border-border shadow-xs print:rounded-none print:border-0 print:shadow-none">
      <Table>
        <TableHeader className="bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 py-2 text-left">When</TableHead>
            <TableHead className="px-3 py-2 text-left">Type</TableHead>
            <TableHead className="px-3 py-2 text-right">Change</TableHead>
            <TableHead className="px-3 py-2 text-right">Balance after</TableHead>
            <TableHead className="px-3 py-2 text-left">Reason</TableHead>
            <TableHead className="px-3 py-2 text-left">Who</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id} className="break-inside-avoid">
              <TableCell className="px-3 py-2 text-muted-foreground">{fmtAsOf(e.createdAt)}</TableCell>
              <TableCell className="px-3 py-2">
                <KindBadge kind={e.kind} />
              </TableCell>
              <ChangeCell hours={e.hours} />
              <TableCell className={numCell}>
                <PtoBalance hours={e.balanceAfterHours} />
              </TableCell>
              <TableCell className="max-w-xs px-3 py-2 text-sm text-muted-foreground">
                {e.reason ? (
                  <span className="block truncate" title={e.reason}>
                    {e.reason}
                  </span>
                ) : (
                  <NA title="No reason for this entry" />
                )}
              </TableCell>
              <TableCell className="px-3 py-2 text-xs text-muted-foreground">{e.createdByLabel}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
