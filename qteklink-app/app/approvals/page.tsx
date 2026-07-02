/**
 * /approvals — the DAILY APPROVALS dashboard: review one business day's numbers and
 * post them to QuickBooks (up to 3 journal entries: sales, payments, card fees).
 *
 * requireQtekUser() enforces session + Entra oid + allowlist + active. Viewing the page
 * re-snapshots the day on every request (force-dynamic), so the numbers reconcile on view;
 * the approve+post action (the only live QBO write) is the admin-only ApproveDayControls.
 * `?date=` is a shop-local YYYY-MM-DD (validated; defaults to the shop-local today). Blocked
 * items live at /approvals/review; date moves at /postings.
 */
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CreditCard, Info, Percent, Receipt } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { getDailySnapshot, type TypeRow } from "@/lib/dal/daily-snapshot";
import { listDailyPostingsForDay } from "@/lib/dal/daily-postings";
import { getShopSettings } from "@/lib/dal/settings";
import { deriveApprovedStamp, hasPendingCorrection } from "@/lib/approvals/day-status";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { fmtUsdSigned, isIsoDate } from "@/lib/format";
import ApproveDayControls from "./ApproveDayControls";
import AcknowledgeDayButton from "./AcknowledgeDayButton";
import DateNav from "./DateNav";
import AutoRefresh from "@/components/AutoRefresh";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ComponentType } from "react";

export const dynamic = "force-dynamic"; // a live per-request snapshot — never statically cached

function Kpi({ label, cents, icon: Icon }: { label: string; cents: number; icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }) {
  return (
    <Card className="shadow-xs">
      <CardContent className="text-center">
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="size-4" aria-hidden={true} />
          {label}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{fmtUsdSigned(cents)}</p>
      </CardContent>
    </Card>
  );
}

const num = "px-3 py-2 text-right tabular-nums";

function Row({ row, date }: { row: TypeRow; date: string }) {
  const attn = row.needsAttentionCents;
  return (
    <TableRow>
      <TableCell className="px-3 py-2 font-medium text-foreground">{row.type}</TableCell>
      <TableCell className={num}>{row.count}</TableCell>
      <TableCell className={num}>
        {attn > 0 ? (
          <Link href={`/approvals/review?date=${date}`} className="font-medium text-amber-800 underline underline-offset-4 dark:text-amber-300">
            {fmtUsdSigned(attn)}
          </Link>
        ) : (
          <span className="text-muted-foreground">{fmtUsdSigned(attn)}</span>
        )}
      </TableCell>
      <TableCell className={num}>{fmtUsdSigned(row.unapprovedCents)}</TableCell>
      <TableCell className={num}>{fmtUsdSigned(row.inProgressCents)}</TableCell>
      <TableCell className={num}>{fmtUsdSigned(row.postedCents)}</TableCell>
      <TableCell className={`${num} font-semibold`}>{fmtUsdSigned(row.totalCents)}</TableCell>
    </TableRow>
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

  // Part F: who approved+posted the day (the human, never the nightly auto-correction)
  // + whether a staged correction awaits (it auto-posts tonight; the button stays for
  // an immediate manual push). The lock reads the UNIFIED attention list (Part D) —
  // the same items the fix-it page shows, so the two can never disagree.
  const approvedStamp = hasPosted ? deriveApprovedStamp(postings) : null;
  const pendingCorrection = hasPosted && hasPendingCorrection(postings);
  const blockingCount = snapshot.attention.blockingCount;
  const infoCount = snapshot.attention.items.length - blockingCount;
  const approvedStampLine = approvedStamp
    ? `Approved and posted on ${
        approvedStamp.at
          ? new Intl.DateTimeFormat("en-US", { timeZone: settings.shopTimezone, month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(approvedStamp.at))
          : date
      } by ${approvedStamp.by}`
    : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <PageHeader title="Daily approvals" description="Check a day's numbers, then post the whole day to QuickBooks">
        <IdentityBlock email={email} role={role} shopId={shopId} />
      </PageHeader>

      <section className="mt-4 flex gap-3 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Each day, check the numbers below (open the breakdown if you want the detail), then press{" "}
          <span className="font-medium text-foreground">Approve + post this day</span> — one button sends the whole
          day to QuickBooks at once (up to 3 journal entries: sales, payments, card fees). If anything
          shows in <span className="font-medium text-amber-800 dark:text-amber-300">Needs attention</span>, fix it on the
          fix-it list first; the button stays locked until the day is clean.
        </p>
      </section>

      <AutoRefresh />
      <DateNav date={date} />

      {!realmId ? (
        <section className="mt-8 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" />
          <p className="text-sm text-amber-800">QuickBooks isn&apos;t connected for this shop yet. Connect it from the home page.</p>
        </section>
      ) : (
        <>
          {isAcknowledged && (
            <section className="mt-6 flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-800" aria-hidden="true" />
              <p className="text-sm text-emerald-800">
                This day is marked <span className="font-semibold">covered by Accounting Link</span> —
                the old system posted it to QuickBooks, so QTekLink leaves it alone.
              </p>
            </section>
          )}

          <section className="mt-8 grid gap-4 sm:grid-cols-3">
            <Kpi label="Total sales (incl. tax)" cents={snapshot.kpis.salesCents} icon={Receipt} />
            <Kpi label="Total payments" cents={snapshot.kpis.paymentsCents} icon={CreditCard} />
            <Kpi label="Total card fees" cents={snapshot.kpis.ccFeesCents} icon={Percent} />
          </section>

          <section className="mt-6 overflow-hidden rounded-lg border border-border shadow-xs">
            <Table>
              <TableHeader className="bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:text-muted-foreground">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 py-2 text-left">Type</TableHead>
                  <TableHead className="px-3 py-2 text-right">Count</TableHead>
                  <TableHead className="px-3 py-2 text-right">Needs attention</TableHead>
                  <TableHead className="px-3 py-2 text-right">Waiting for approval</TableHead>
                  <TableHead className="px-3 py-2 text-right">Posting now</TableHead>
                  <TableHead className="px-3 py-2 text-right">Done</TableHead>
                  <TableHead className="px-3 py-2 text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {roRow && <Row row={roRow} date={date} />}
                {payRow && <Row row={payRow} date={date} />}
                {feeRow && <Row row={feeRow} date={date} />}
              </TableBody>
            </Table>
          </section>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {blockingCount > 0 ? (
                <Link href={`/approvals/review?date=${date}`} className="inline-flex items-center gap-1 font-medium text-amber-800 underline underline-offset-4 dark:text-amber-300">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  {blockingCount} item{blockingCount === 1 ? "" : "s"} need{blockingCount === 1 ? "s" : ""} attention — open the fix-it list
                </Link>
              ) : infoCount > 0 ? (
                <Link href={`/approvals/review?date=${date}`} className="inline-flex items-center gap-1 font-medium text-muted-foreground underline underline-offset-4">
                  <Info className="size-4" aria-hidden="true" />
                  {infoCount} item{infoCount === 1 ? "" : "s"} to know about — nothing blocks the day
                </Link>
              ) : (
                <span className="text-muted-foreground">Nothing needs attention.</span>
              )}
            </p>
            <Button render={<Link href={`/approvals/${date}/breakdown`} />} variant="outline">
              See every repair order &amp; payment
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>

          {/* Part F: a posted day says WHO approved it and WHEN — the approve button
              only returns when a staged correction awaits a manual push. */}
          {!isAcknowledged && hasPosted && approvedStampLine && (
            <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
                {approvedStampLine}
              </p>
              {pendingCorrection && (
                <p className="mt-1 pl-7 text-sm text-emerald-800/80">
                  A change was detected since posting — it posts automatically tonight, or press the button below to post it now.
                </p>
              )}
              {blockingCount > 0 && (
                <p className="mt-1 flex items-center gap-1 pl-7 text-sm text-amber-800">
                  <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                  with {blockingCount} exception{blockingCount === 1 ? "" : "s"} —{" "}
                  <Link href={`/approvals/review?date=${date}`} className="font-medium underline underline-offset-4">open the fix-it list</Link>
                </p>
              )}
            </section>
          )}

          {role === "admin" && !isAcknowledged && (!hasPosted || pendingCorrection) && (
            <ApproveDayControls date={date} blockedCount={blockingCount} />
          )}
          {role === "admin" && !isAcknowledged && !hasPosted && (
            <Card className="mt-4 shadow-xs">
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Was this day already posted to QuickBooks by the old system (Accounting Link)?
                  Mark it covered so QTekLink records it as done without posting anything.
                </p>
                <AcknowledgeDayButton date={date} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
