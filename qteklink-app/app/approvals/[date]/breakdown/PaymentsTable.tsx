"use client";

/**
 * PaymentsTable — the sortable detail table for the breakdown page's Payments tab.
 * Sorting is purely client-side UI state (no server round-trip, no data mutation):
 * the rows + their money/status come pre-computed from `getDayBreakdown`. Two
 * sortable columns — RO# and Payment type — each a clickable header that toggles
 * asc/desc, shows a lucide indicator, and carries `aria-sort`. RO# sort is
 * numeric-aware (Intl.Collator { numeric: true }) with unresolved RO#s sorted last.
 * Default sort: RO# ascending.
 */
import { useMemo, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import type { PaymentBreakdown } from "@/lib/dal/daily-breakdown";
import { fmtUsd, fmtUsdSigned } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const numCell = "px-3 py-2 text-right tabular-nums";

type SortKey = "ro" | "method";
type SortDir = "asc" | "desc";

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

/** RO# cell: the human RO number, or an honest "—" when the RO predates QTekLink's
 *  records (NEVER the payment id — it reads like a wrong RO number). */
function RoCell({ p }: { p: PaymentBreakdown }) {
  if (p.roNumber != null) return <>RO {p.roNumber}</>;
  return (
    <span
      className="text-muted-foreground"
      title="This repair order is older than QTekLink's records, so its RO number isn't on file."
    >
      —
    </span>
  );
}

/** Sortable column header: a button that toggles its own asc/desc and exposes aria-sort. */
function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  className?: string;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-0 py-0", className)}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-1 px-3 py-2 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon className={cn("size-3.5", active ? "text-primary" : "text-muted-foreground/60")} aria-hidden="true" />
      </button>
    </TableHead>
  );
}

export function PaymentsTable({ payments }: { payments: PaymentBreakdown[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("ro");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggle(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const rows = useMemo(() => {
    const sign = sortDir === "asc" ? 1 : -1;
    return [...payments].sort((a, b) => {
      if (sortKey === "method") {
        return sign * collator.compare(a.method, b.method);
      }
      // RO#: numeric-aware on the human RO number; unresolved (null) RO#s sort last
      // regardless of direction so they don't interleave with real numbers.
      const aNull = a.roNumber == null;
      const bNull = b.roNumber == null;
      if (aNull && bNull) return collator.compare(a.paymentId, b.paymentId);
      if (aNull) return 1;
      if (bNull) return -1;
      return sign * collator.compare(a.roNumber!, b.roNumber!);
    });
  }, [payments, sortKey, sortDir]);

  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-xs">
      <Table>
        <TableHeader className="bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:font-medium [&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <SortHeader
              label="RO #"
              active={sortKey === "ro"}
              dir={sortDir}
              onClick={() => toggle("ro")}
            />
            <SortHeader
              label="Payment type"
              active={sortKey === "method"}
              dir={sortDir}
              onClick={() => toggle("method")}
            />
            <TableHead className="px-3 py-2 text-right">Amount</TableHead>
            <TableHead className="px-3 py-2 text-right">Card fees</TableHead>
            <TableHead className="px-3 py-2 text-right">Net &rarr; Undeposited</TableHead>
            <TableHead className="px-3 py-2 text-left">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.paymentId}>
              <TableCell className="px-3 py-2 font-medium text-foreground"><RoCell p={p} /></TableCell>
              <TableCell className="px-3 py-2 text-foreground">
                {p.method}
                {p.isRefund && (
                  <span className="ml-2 inline-flex items-center rounded-full border border-border bg-muted px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    refund
                  </span>
                )}
              </TableCell>
              <TableCell className={cn(numCell, p.isRefund && "text-muted-foreground")}>{fmtUsdSigned(p.amountCents)}</TableCell>
              <TableCell className={cn(numCell, !p.feeCents && "text-muted-foreground")}>{p.feeCents ? fmtUsd(p.feeCents) : "—"}</TableCell>
              <TableCell className={cn(numCell, p.isRefund && "text-muted-foreground")}>{fmtUsdSigned(p.netCents)}</TableCell>
              <TableCell className="px-3 py-2"><StatusBadge status={p.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
