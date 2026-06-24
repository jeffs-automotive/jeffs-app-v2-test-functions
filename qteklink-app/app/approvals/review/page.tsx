/**
 * /approvals/review — the resolution queue (approval-dashboard upgrade, plan §4). The
 * "Needs attention" cell on the daily snapshot links here. Everyone allowed READS the open
 * review items; only admins run a day's reconciliation, resolve an item, or record a manual
 * payment. The page only READS (listOpenReviewItems) — writes go through the admin forms.
 */
import Link from "next/link";
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2 } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { listOpenReviewItems, type ReviewItemRow } from "@/lib/dal/review-items";
import { isIsoDate } from "@/lib/format";
import ResolveReviewItemForm from "../ResolveReviewItemForm";
import RunReconcileForm from "../RunReconcileForm";
import RecordManualPaymentForm from "../RecordManualPaymentForm";
import DateNav from "../DateNav";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  unmapped: "Unmapped account / source",
  tax_identity: "Tax identity mismatch",
  tax_high: "Sales tax above the 6% ceiling",
  payment_corrupt: "Corrupt payment amount",
  snapshot_unparseable: "Unparseable RO snapshot",
  manual_payment_conflict: "Manual pick conflicts with a real payment",
  qbo_deposit_locked: "Already deposited in QuickBooks — can't be changed",
};

/** Actionable guidance shown under specific review kinds. */
const KIND_HELP: Record<string, string> = {
  qbo_deposit_locked:
    "This day's payment/fee entries were swept into a deposit in QuickBooks, so QuickBooks locks them — the update can't be pushed. To apply the change, open the deposit in QuickBooks and unlink (or delete) it, then re-approve this day. Or leave it as-is; the change stays recorded in QTekLink. (Repair-order/sales changes are never affected — they post automatically.)",
};

function reasonList(detail: Record<string, unknown>): string[] {
  const r = detail.reasons;
  return Array.isArray(r) ? r.map(String) : [];
}

function ReviewItemCard({ item, isAdmin }: { item: ReviewItemRow; isAdmin: boolean }) {
  const reasons = reasonList(item.detail);
  return (
    <li>
      <Card className="shadow-xs border-l-2 border-l-amber-400">
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-800">
              <AlertCircle aria-hidden="true" />
              {KIND_LABELS[item.kind] ?? item.kind}
            </Badge>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{item.subjectKind} {item.subjectRef}</span>
            <span className="ml-auto text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
          </div>
          {reasons.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {reasons.map((r) => (<li key={r}><Badge variant="secondary">{r}</Badge></li>))}
            </ul>
          )}
          {item.detail.docNumber != null && <p className="text-xs text-muted-foreground">{String(item.detail.docNumber)}</p>}
          {KIND_HELP[item.kind] && <p className="text-sm text-muted-foreground">{KIND_HELP[item.kind]}</p>}
          {isAdmin && <ResolveReviewItemForm id={item.id} />}
        </CardContent>
      </Card>
    </li>
  );
}

export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";
  const { realmId, items } = await listOpenReviewItems(shopId);
  const { date } = await searchParams;
  const backDate = date && isIsoDate(date) ? date : null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <PageHeader
        title="Fix-it list"
        description={
          <Button render={<Link href={backDate ? `/approvals?date=${backDate}` : "/approvals"} />} variant="outline" size="sm">
            <ArrowLeft aria-hidden="true" />
            Back to daily approvals
          </Button>
        }
      >
        <IdentityBlock email={email} role={role} shopId={shopId} />
      </PageHeader>

      {backDate && <DateNav date={backDate} hrefPrefix="/approvals/review?date=" />}

      <section className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
        Items land here when QTekLink can&apos;t post something on its own — usually a payment type
        or fee that isn&apos;t matched to a QuickBooks account yet, or a payment that needs you to
        say how it was paid. Fix each item below; the day then posts normally.
      </section>

      {!realmId ? (
        <section className="mt-8 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" />
          <p className="text-sm text-amber-800">QuickBooks isn&apos;t connected for this shop yet.</p>
        </section>
      ) : (
        <>
          {isAdmin && (
            <section className="mt-8 grid gap-6 md:grid-cols-2">
              <RunReconcileForm />
              <RecordManualPaymentForm />
            </section>
          )}
          <Card className="mt-8 shadow-xs">
            <CardHeader>
              <CardTitle>Open review items</CardTitle>
              <CardAction>
                <span className="text-3xl font-bold tabular-nums text-foreground">{items.length}</span>
              </CardAction>
            </CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Nothing to review" subtext="Every reconciled draft is postable." />
              ) : (
                <ul className="space-y-3">
                  {items.map((item) => (<ReviewItemCard key={item.id} item={item} isAdmin={isAdmin} />))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
