/**
 * /approvals/[date]/breakdown — the line-item drill-down (approval-dashboard upgrade, plan
 * §3.2): three tabs (Summary / Repair Orders / Payments) selected via `?tab=`. The RO rows
 * are native <details> (collapsible, no client JS). READ-only (`getDayBreakdown`). `[date]`
 * is a shop-local YYYY-MM-DD, validated (else 404 via notFound).
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireQtekUser } from "@/lib/auth";
import { getDayBreakdown, type RoBreakdown, type PaymentBreakdown, type SummaryRow } from "@/lib/dal/daily-breakdown";
import type { SnapshotColumn } from "@/lib/dal/daily-snapshot";
import { fmtUsd, isIsoDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Tab = "summary" | "ros" | "payments";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "ros", label: "Repair Orders" },
  { key: "payments", label: "Payments" },
];

const BADGE: Record<SnapshotColumn, { label: string; cls: string }> = {
  needsAttention: { label: "Needs attention", cls: "bg-amber-100 text-amber-800" },
  unapproved: { label: "Unapproved", cls: "bg-stone-100 text-stone-700" },
  inProgress: { label: "In progress", cls: "bg-blue-100 text-blue-800" },
  posted: { label: "Posted", cls: "bg-emerald-100 text-emerald-800" },
};
function StatusBadge({ status }: { status: SnapshotColumn }) {
  const b = BADGE[status];
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.label}</span>;
}

const numCell = "px-3 py-2 text-right tabular-nums";

function SummaryTab({ rows, totalDebitCents, totalCreditCents, balanced }: { rows: SummaryRow[]; totalDebitCents: number; totalCreditCents: number; balanced: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <p className="border-b border-stone-100 bg-stone-50 px-3 py-2 text-xs text-stone-500">
        Proposed + posted net for the day (postable rows; items in Needs attention are excluded).
      </p>
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr><th className="px-3 py-2 text-left">Account</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.accountId} className="border-t border-stone-100">
              <td className="px-3 py-2 text-stone-800">{r.acctNum ? `${r.acctNum} · ` : ""}{r.accountName ?? r.accountId}</td>
              <td className={numCell}>{r.debitCents ? fmtUsd(r.debitCents) : ""}</td>
              <td className={numCell}>{r.creditCents ? fmtUsd(r.creditCents) : ""}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-stone-200 font-semibold">
            <td className="px-3 py-2">Totals {balanced ? "✓ balanced" : "⚠ unbalanced"}</td>
            <td className={numCell}>{fmtUsd(totalDebitCents)}</td>
            <td className={numCell}>{fmtUsd(totalCreditCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RosTab({ ros }: { ros: RoBreakdown[] }) {
  if (ros.length === 0) return <p className="text-sm text-stone-500">No repair orders for this day.</p>;
  return (
    <div className="space-y-2">
      {ros.map((ro) => (
        <details key={ro.tekmetricRoId} className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm">
            <span className="font-medium text-stone-800">RO {ro.roNumber}</span>
            <StatusBadge status={ro.status} />
            {ro.changedSincePosted && <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">changed since posted</span>}
            <span className="ml-auto font-semibold tabular-nums">{fmtUsd(ro.totalCents)}</span>
          </summary>
          <div className="border-t border-stone-100 px-4 py-3">
            {ro.unmapped.length > 0 && (
              <p className="mb-2 text-xs text-amber-800">Unmapped: {ro.unmapped.join(", ")}</p>
            )}
            <table className="w-full text-sm">
              <tbody>
                {ro.lines.map((l, i) => (
                  <tr key={i} className="border-t border-stone-50">
                    <td className="py-1 text-stone-700">{l.description || (l.acctNum ? `${l.acctNum} · ${l.accountName}` : l.accountName ?? l.accountId)}</td>
                    <td className="py-1 text-right text-xs text-stone-400">{l.acctNum ? `${l.acctNum} · ${l.accountName}` : l.accountName ?? l.accountId}</td>
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
  if (payments.length === 0) return <p className="text-sm text-stone-500">No payments for this day.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th className="px-3 py-2 text-left">Payment</th><th className="px-3 py-2 text-left">Method</th>
            <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">CC fee</th>
            <th className="px-3 py-2 text-right">Net → Undeposited</th><th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.paymentId} className="border-t border-stone-100">
              <td className="px-3 py-2 text-stone-700">{p.tekmetricRoId != null ? `RO ${p.tekmetricRoId}` : p.paymentId}</td>
              <td className="px-3 py-2 text-stone-700">{p.method}</td>
              <td className={numCell}>{fmtUsd(p.amountCents)}</td>
              <td className={numCell}>{p.feeCents ? fmtUsd(p.feeCents) : ""}</td>
              <td className={numCell}>{fmtUsd(p.netCents)}</td>
              <td className="px-3 py-2"><StatusBadge status={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <header className="border-b border-stone-200 pb-4">
        <h1 className="text-2xl font-bold text-[#96003C]">Breakdown — {date}</h1>
        <p className="text-sm text-stone-600"><Link href={`/approvals?date=${date}`} className="text-[#96003C] underline">← daily approval</Link></p>
      </header>

      <nav className="mt-6 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/approvals/${date}/breakdown?tab=${t.key}`}
            className={`rounded px-4 py-2 text-sm font-medium ${tab === t.key ? "bg-[#96003C] text-white" : "border border-stone-300 text-stone-700 hover:bg-stone-50"}`}
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
