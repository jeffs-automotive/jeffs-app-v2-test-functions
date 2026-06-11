/**
 * /approvals — the DAILY APPROVALS dashboard: review one business day's numbers and
 * post them to QuickBooks (up to 3 journal entries: sales, payments, card fees).
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. The page only
 * READS; the approve+post action (a live QBO write) is the admin-only
 * ApproveDayControls. `?date=` is a shop-local YYYY-MM-DD (validated; defaults to the
 * shop-local today). Blocked items live at /approvals/review; date moves at /postings.
 */
import Link from "next/link";
import { requireQtekUser } from "@/lib/auth";
import { getDailySnapshot, type TypeRow } from "@/lib/dal/daily-snapshot";
import { listDailyPostingsForDay } from "@/lib/dal/daily-postings";
import { getShopSettings } from "@/lib/dal/settings";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { fmtUsd, isIsoDate } from "@/lib/format";
import ApproveDayControls from "./ApproveDayControls";
import AcknowledgeDayButton from "./AcknowledgeDayButton";
import DateNav from "./DateNav";

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

  // The day's overall state for the controls/banner: posted by QTekLink, covered by
  // Accounting Link (acknowledged), or still open.
  const { postings } = realmId ? await listDailyPostingsForDay(shopId, date) : { postings: [] };
  const hasPosted = postings.some((p) => p.status === "posted" || p.status === "posting" || p.status === "approved");
  const isAcknowledged = !hasPosted && postings.length > 0 && postings.every((p) => p.status === "acknowledged" || p.status === "rejected");

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">Daily approvals</h1>
          <p className="text-sm text-stone-600">
            <Link href="/dashboard" className="text-[#96003C] underline">home</Link>
            {" · "}
            <Link href={`/approvals/review?date=${date}`} className="text-[#96003C] underline">fix-it list</Link>
            {" · "}
            <Link href="/postings" className="text-[#96003C] underline">posting queue</Link>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-stone-900">{email}</p>
          <p className="text-xs uppercase tracking-wide text-stone-500">{role} · shop {shopId}</p>
        </div>
      </header>

      <section className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
        Each day, check the numbers below, open the breakdown if you want the detail, then press{" "}
        <span className="font-medium">Approve + post</span> to send the day to QuickBooks (up to 3
        journal entries: sales, payments, card fees). Anything in{" "}
        <span className="font-medium text-amber-700">Needs attention</span> is blocked until you fix
        it on the fix-it list — everything else still posts.
      </section>

      <DateNav date={date} />

      {!realmId ? (
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-800">QuickBooks isn&apos;t connected for this shop yet. Connect it from the home page.</p>
        </section>
      ) : (
        <>
          {isAcknowledged && (
            <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-800">
                ✓ This day is marked <span className="font-semibold">covered by Accounting Link</span> —
                the old system posted it to QuickBooks, so QTekLink leaves it alone.
              </p>
            </section>
          )}

          <section className="mt-8 grid gap-4 sm:grid-cols-3">
            <Kpi label="Total sales (incl. tax)" cents={snapshot.kpis.salesCents} />
            <Kpi label="Total payments" cents={snapshot.kpis.paymentsCents} />
            <Kpi label="Total card fees" cents={snapshot.kpis.ccFeesCents} />
          </section>

          <section className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Count</th>
                  <th className="px-3 py-2 text-right">Needs attention</th>
                  <th className="px-3 py-2 text-right">Waiting for approval</th>
                  <th className="px-3 py-2 text-right">Posting now</th>
                  <th className="px-3 py-2 text-right">Done</th>
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
                  ⚠ {snapshot.needsAttentionCount} item{snapshot.needsAttentionCount === 1 ? "" : "s"} need attention — open the fix-it list
                </Link>
              ) : (
                <span className="text-stone-400">Nothing needs attention.</span>
              )}
            </p>
            <Link href={`/approvals/${date}/breakdown`} className="rounded border border-[#96003C] px-4 py-2 text-sm font-medium text-[#96003C] hover:bg-[#96003C]/5">
              See every repair order &amp; payment →
            </Link>
          </div>

          {role === "admin" && !isAcknowledged && <ApproveDayControls date={date} />}
          {role === "admin" && !isAcknowledged && !hasPosted && (
            <div className="mt-4 rounded-lg border border-stone-200 bg-white p-5">
              <p className="text-sm text-stone-600">
                Was this day already posted to QuickBooks by the old system (Accounting Link)?
                Mark it covered so QTekLink records it as done without posting anything.
              </p>
              <div className="mt-3">
                <AcknowledgeDayButton date={date} />
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
