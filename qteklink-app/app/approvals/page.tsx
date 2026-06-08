/**
 * /approvals — the daily-snapshot approval dashboard (approval-dashboard upgrade, plan §3.1).
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. The page only READS
 * (`getDailySnapshot`) — the approve+post action (a live QBO write) is the admin-only
 * ApproveDayControls (P4), never on render. `?date=` is a shop-local YYYY-MM-DD (validated;
 * defaults to the shop-local today). The resolution queue lives at /approvals/review.
 */
import Link from "next/link";
import { requireQtekUser } from "@/lib/auth";
import { getDailySnapshot, type TypeRow } from "@/lib/dal/daily-snapshot";
import { getShopSettings } from "@/lib/dal/settings";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { fmtUsd, isIsoDate, addDaysIso } from "@/lib/format";
import ApproveDayControls from "./ApproveDayControls";

export const dynamic = "force-dynamic"; // a live per-request snapshot — never statically cached

function Kpi({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-stone-900">{fmtUsd(cents)}</p>
    </div>
  );
}

const num = "px-3 py-2 text-right tabular-nums";

function Row({ row, date }: { row: TypeRow; date: string }) {
  const attn = row.needsAttentionCents;
  return (
    <tr className="border-t border-stone-100">
      <td className="px-3 py-2 font-medium text-stone-800">{row.type}</td>
      <td className={num}>{row.count}</td>
      <td className={num}>
        {attn > 0 ? (
          <Link href={`/approvals/review?date=${date}`} className="font-medium text-amber-700 underline">
            {fmtUsd(attn)}
          </Link>
        ) : (
          <span className="text-stone-400">{fmtUsd(attn)}</span>
        )}
      </td>
      <td className={num}>{fmtUsd(row.unapprovedCents)}</td>
      <td className={num}>{fmtUsd(row.inProgressCents)}</td>
      <td className={num}>{fmtUsd(row.postedCents)}</td>
      <td className={`${num} font-semibold`}>{fmtUsd(row.totalCents)}</td>
    </tr>
  );
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { email, role, shopId } = await requireQtekUser();
  const { realmId, settings } = await getShopSettings(shopId);

  const { date: dateParam } = await searchParams;
  const today = toShopLocalDate(new Date().toISOString(), settings.shopTimezone);
  const date = dateParam && isIsoDate(dateParam) ? dateParam : today;

  const snapshot = await getDailySnapshot(shopId, date);
  const [roRow, payRow, feeRow] = snapshot.rows;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">Daily approval</h1>
          <p className="text-sm text-stone-600">
            <Link href="/dashboard" className="text-[#96003C] underline">dashboard</Link>
            {" · "}
            <Link href={`/approvals/review?date=${date}`} className="text-[#96003C] underline">resolution queue</Link>
            {role === "admin" && (<>{" · "}<Link href="/postings" className="text-[#96003C] underline">posting queue</Link></>)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-stone-900">{email}</p>
          <p className="text-xs uppercase tracking-wide text-stone-500">{role} · shop {shopId}</p>
        </div>
      </header>

      {/* date nav */}
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link href={`/approvals?date=${addDaysIso(date, -1)}`} className="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">◀</Link>
        <form className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} className="rounded border border-stone-300 px-3 py-1.5 text-sm" />
          <button type="submit" className="rounded bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700">Go</button>
        </form>
        <Link href={`/approvals?date=${addDaysIso(date, 1)}`} className="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-50">▶</Link>
      </div>

      {!realmId ? (
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-800">QuickBooks isn&apos;t connected for this shop yet. Connect it from the dashboard.</p>
        </section>
      ) : (
        <>
          <section className="mt-8 grid gap-4 sm:grid-cols-3">
            <Kpi label="Total sales (incl. tax)" cents={snapshot.kpis.salesCents} />
            <Kpi label="Total payments" cents={snapshot.kpis.paymentsCents} />
            <Kpi label="Total CC fees" cents={snapshot.kpis.ccFeesCents} />
          </section>

          <section className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-right">Needs attn</th>
                  <th className="px-3 py-2 text-right">Unapproved</th>
                  <th className="px-3 py-2 text-right">In progress</th>
                  <th className="px-3 py-2 text-right">Posted</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {roRow && <Row row={roRow} date={date} />}
                {payRow && <Row row={payRow} date={date} />}
                {feeRow && <Row row={feeRow} date={date} />}
              </tbody>
            </table>
          </section>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-stone-600">
              {snapshot.needsAttentionCount > 0 ? (
                <Link href={`/approvals/review?date=${date}`} className="font-medium text-amber-700 underline">
                  ⚠ {snapshot.needsAttentionCount} item{snapshot.needsAttentionCount === 1 ? "" : "s"} need attention
                </Link>
              ) : (
                <span className="text-stone-400">Nothing needs attention.</span>
              )}
            </p>
            <Link href={`/approvals/${date}/breakdown`} className="rounded border border-[#96003C] px-4 py-2 text-sm font-medium text-[#96003C] hover:bg-[#96003C]/5">
              Open breakdown →
            </Link>
          </div>

          {role === "admin" && <ApproveDayControls date={date} />}
        </>
      )}
    </main>
  );
}
