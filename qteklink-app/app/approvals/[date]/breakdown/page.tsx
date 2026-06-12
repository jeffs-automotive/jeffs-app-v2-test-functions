/**
 * /approvals/[date]/breakdown — the line-item drill-down (approval-dashboard upgrade, plan
 * §3.2): three tabs (Summary / Repair Orders / Payments) selected via `?tab=`. The RO rows
 * are native <details> (collapsible, no client JS). READ-only (`getDayBreakdown`). `[date]`
 * is a shop-local YYYY-MM-DD, validated (else 404 via notFound).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, History, Inbox } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { getDayBreakdown, type RoBreakdown, type PaymentBreakdown, type SummaryRow } from "@/lib/dal/daily-breakdown";
import { fmtUsd, isIsoDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type Tab = "summary" | "ros" | "payments";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "ros", label: "Repair Orders" },
  { key: "payments", label: "Payments" },
];

const numCell = "px-3 py-2 text-right tabular-nums";

function Stat({ label, cents }: { label: string; cents: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{fmtUsd(cents)}</dd>
    </div>
  );
}

function SummaryTab({ rows, totalDebitCents, totalCreditCents, balanced, paymentsTotalCents, feesTotalCents, depositToUndepositedCents, nonCashCents }: { rows: SummaryRow[]; totalDebitCents: number; totalCreditCents: number; balanced: boolean; paymentsTotalCents: number; feesTotalCents: number; depositToUndepositedCents: number; nonCashCents: number }) {
  return (
    <div className="space-y-4">
      <Card className="shadow-xs">
        <CardContent>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payments summary</p>
          <dl className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total payments" cents={paymentsTotalCents} />
            <Stat label="Total CC fees" cents={feesTotalCents} />
            <Stat label="To Undeposited (net of fees)" cents={depositToUndepositedCents} />
            <Stat label="Non-cash (contra)" cents={nonCashCents} />
          </dl>
        </CardContent>
      </Card>
      <div className="overflow-hidden rounded-lg border border-border shadow-xs">
        <p className="border-b border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Proposed + posted net for the day (postable rows; items in Needs attention are excluded).
        </p>
        <Table>
          <TableHeader className="bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:text-muted-foreground">
            <TableRow className="hover:bg-transparent"><TableHead className="px-3 py-2 text-left">Account</TableHead><TableHead className="px-3 py-2 text-right">Debit</TableHead><TableHead className="px-3 py-2 text-right">Credit</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.accountId}>
                <TableCell className="px-3 py-2 text-foreground">{r.acctNum ? `${r.acctNum} · ` : ""}{r.accountName ?? r.accountId}</TableCell>
                <TableCell className={numCell}>{r.debitCents ? fmtUsd(r.debitCents) : ""}</TableCell>
                <TableCell className={numCell}>{r.creditCents ? fmtUsd(r.creditCents) : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-transparent">
            <TableRow className="border-t-2 border-border font-semibold hover:bg-transparent">
              <TableCell className="flex items-center gap-1.5 px-3 py-2">
                Totals
                {balanced ? (
                  <span className="inline-flex items-center gap-1 text-emerald-800"><CheckCircle2 className="size-4" aria-hidden="true" /> balanced</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle className="size-4" aria-hidden="true" /> unbalanced</span>
                )}
              </TableCell>
              <TableCell className={numCell}>{fmtUsd(totalDebitCents)}</TableCell>
              <TableCell className={numCell}>{fmtUsd(totalCreditCents)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

function RosTab({ ros }: { ros: RoBreakdown[] }) {
  if (ros.length === 0) return <EmptyState icon={Inbox} title="No repair orders for this day" />;
  return (
    <div className="space-y-2">
      {ros.map((ro) => (
        <details key={ro.tekmetricRoId} className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
          <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50">
            <span className="font-medium text-foreground">RO {ro.roNumber}</span>
            <StatusBadge status={ro.status} />
            {ro.changedSincePosted && (
              <Badge variant="outline" className="gap-1 border-purple-200 bg-purple-50 text-purple-800">
                <History aria-hidden="true" />
                changed since posted
              </Badge>
            )}
            <span className="ml-auto font-semibold tabular-nums">{fmtUsd(ro.totalCents)}</span>
          </summary>
          <div className="border-t border-border px-4 py-3">
            {ro.unmapped.length > 0 && (
              <p className="mb-2 text-xs text-amber-800">Unmapped: {ro.unmapped.join(", ")}</p>
            )}
            <table className="w-full text-sm">
              <tbody>
                {ro.lines.map((l, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="py-1 text-foreground">{l.description || (l.acctNum ? `${l.acctNum} · ${l.accountName}` : l.accountName ?? l.accountId)}</td>
                    <td className="py-1 text-right text-xs text-muted-foreground">{l.acctNum ? `${l.acctNum} · ${l.accountName}` : l.accountName ?? l.accountId}</td>
                    <td className={`${numCell} w-28`}>{l.debitCents ? fmtUsd(l.debitCents) : ""}</td>
                    <td className={`${numCell} w-28`}>{l.creditCents ? fmtUsd(l.creditCents) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

function PaymentsTab({ payments }: { payments: PaymentBreakdown[] }) {
  if (payments.length === 0) return <EmptyState icon={Inbox} title="No payments for this day" />;
  return (
    <div className="overflow-hidden rounded-lg border border-border shadow-xs">
      <Table>
        <TableHeader className="bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:text-muted-foreground">
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3 py-2 text-left">Payment</TableHead><TableHead className="px-3 py-2 text-left">Method</TableHead>
            <TableHead className="px-3 py-2 text-right">Amount</TableHead><TableHead className="px-3 py-2 text-right">CC fee</TableHead>
            <TableHead className="px-3 py-2 text-right">Net → Undeposited</TableHead><TableHead className="px-3 py-2 text-left">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.paymentId}>
              <TableCell className="px-3 py-2 text-foreground">{p.tekmetricRoId != null ? `RO ${p.tekmetricRoId}` : p.paymentId}</TableCell>
              <TableCell className="px-3 py-2 text-foreground">{p.method}</TableCell>
              <TableCell className={numCell}>{fmtUsd(p.amountCents)}</TableCell>
              <TableCell className={numCell}>{p.feeCents ? fmtUsd(p.feeCents) : ""}</TableCell>
              <TableCell className={numCell}>{fmtUsd(p.netCents)}</TableCell>
              <TableCell className="px-3 py-2"><StatusBadge status={p.status} /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function BreakdownPage({ params, searchParams }: { params: Promise<{ date: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { shopId } = await requireQtekUser();
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const { tab: tabParam } = await searchParams;
  const tab: Tab = tabParam === "ros" || tabParam === "payments" ? tabParam : "summary";

  const b = await getDayBreakdown(shopId, date);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <PageHeader
        title={`Day detail — ${date}`}
        description={
          <Link href={`/approvals?date=${date}`} className="text-primary underline underline-offset-4">← back to daily approvals</Link>
        }
      />

      <section className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
        Everything that makes up this day&apos;s numbers. <span className="font-medium text-foreground">Summary</span> shows
        what hits each QuickBooks account; <span className="font-medium text-foreground">Repair orders</span> and{" "}
        <span className="font-medium text-foreground">Payments</span> list every single item with its status.
      </section>

      <nav className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/approvals/${date}/breakdown?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? "bg-primary/10 text-primary font-semibold" : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <section className="mt-6">
        {tab === "summary" && <SummaryTab {...b.summary} />}
        {tab === "ros" && <RosTab ros={b.ros} />}
        {tab === "payments" && <PaymentsTab payments={b.payments} />}
      </section>
    </main>
  );
}
