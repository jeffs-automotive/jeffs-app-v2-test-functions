/**
 * /approvals/review — the FIX-IT LIST (resolution-workflow Parts D+E).
 *
 * With ?date= (how the approvals page links here) it renders the DAY-SCOPED unified
 * attention list — the exact same items (and count) that lock the day's approve
 * button, each carrying its REAL action: retry/accept a failed posting, jump to the
 * mapping picker prefilled, delete a conflicting manual pick, or the late-payment
 * redate guidance. The lock and this list can never disagree (incident 2026-06-29:
 * the day said "2 issues — fix them on the fix-it list" while this list was empty).
 *
 * Without a date it lists every OPEN review item across all days (the audit trail /
 * catch-all view), with plain-language labels + help for every kind.
 */
import Link from "next/link";
import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { listOpenReviewItems, type ReviewItemRow } from "@/lib/dal/review-items";
import { getDailySnapshot } from "@/lib/dal/daily-snapshot";
import { KIND_LABELS, KIND_HELP, type DayAttentionItem } from "@/lib/reconcile/day-attention";
import { fmtUsdSigned, isIsoDate } from "@/lib/format";
import ResolveReviewItemForm from "../ResolveReviewItemForm";
import RunReconcileForm from "../RunReconcileForm";
import RecordManualPaymentForm from "../RecordManualPaymentForm";
import FailedPostingControls from "../FailedPostingControls";
import RedateApproveButton from "../RedateApproveButton";
import DeleteManualPaymentButton from "../DeleteManualPaymentButton";
import DateNav from "../DateNav";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

function AttentionCard({ item, isAdmin }: { item: DayAttentionItem; isAdmin: boolean }) {
  return (
    <li>
      <Card className={`shadow-xs border-l-2 ${item.blocking ? "border-l-amber-400" : "border-l-border"}`}>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={item.blocking ? "gap-1 border-amber-200 bg-amber-50 text-amber-800" : "gap-1"}
            >
              <AlertCircle aria-hidden="true" />
              {item.title}
            </Badge>
            {item.subjectLabel && (
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{item.subjectLabel}</span>
            )}
            {item.cents != null && (
              <span className="ml-auto text-sm font-medium tabular-nums text-foreground">{fmtUsdSigned(item.cents)}</span>
            )}
          </div>
          {item.summary && <p className="text-sm text-muted-foreground">{item.summary}</p>}
          {item.reasons.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {item.reasons.map((r) => (<li key={r}><Badge variant="secondary">{r}</Badge></li>))}
            </ul>
          )}
          {isAdmin && (
            <div className="space-y-2">
              {item.actions.includes("retry_or_accept") && item.postingId && (
                <FailedPostingControls postingId={item.postingId} />
              )}
              {item.actions.includes("fix_mapping") && item.mappingTokens.length > 0 && (
                <Button size="sm" render={<Link href={`/mappings?focus=${encodeURIComponent(item.mappingTokens[0]!)}`} />}>
                  <ExternalLink aria-hidden="true" />
                  Fix the account match
                </Button>
              )}
              {item.actions.includes("delete_manual_payment") && item.manualPaymentId && (
                <DeleteManualPaymentButton manualPaymentId={item.manualPaymentId} />
              )}
              {item.actions.includes("redate_approve") && item.redateId && (
                <RedateApproveButton redateId={item.redateId} />
              )}
              {item.actions.includes("resolve_note") && item.reviewItemId && (
                <ResolveReviewItemForm id={item.reviewItemId} />
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

function ReviewItemCard({ item, isAdmin }: { item: ReviewItemRow; isAdmin: boolean }) {
  const reasons = Array.isArray(item.detail.reasons) ? item.detail.reasons.map(String) : [];
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
  const { date } = await searchParams;
  const backDate = date && isIsoDate(date) ? date : null;

  // Day-scoped: the SAME attention list that locks the approve button.
  const snapshot = backDate ? await getDailySnapshot(shopId, backDate) : null;
  // All-days: the raw open review queue (the catch-all / audit view).
  const global = backDate ? null : await listOpenReviewItems(shopId);
  const realmId = snapshot ? snapshot.realmId : global!.realmId;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <PageHeader
        title={backDate ? `Fix-it list — ${backDate}` : "Fix-it list"}
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
        {backDate ? (
          <>Everything on this day that needs a person, with the button that actually fixes it. Items clear
          themselves as soon as the underlying cause is fixed — in Tekmetric, on the Mappings page, or right here.</>
        ) : (
          <>Every open item across all days. Open a specific day from Daily approvals for the actionable,
          day-scoped view.</>
        )}
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
              <CardTitle>{backDate ? "Needs a person" : "Open review items"}</CardTitle>
              <CardAction>
                <span className="text-3xl font-bold tabular-nums text-foreground">
                  {snapshot ? snapshot.attention.items.length : global!.items.length}
                </span>
              </CardAction>
            </CardHeader>
            <CardContent>
              {snapshot ? (
                snapshot.attention.items.length === 0 ? (
                  <EmptyState icon={CheckCircle2} title="Nothing to fix on this day" subtext="Every entry is postable or already posted." />
                ) : (
                  <ul className="space-y-3">
                    {snapshot.attention.items.map((item) => (<AttentionCard key={item.key} item={item} isAdmin={isAdmin} />))}
                  </ul>
                )
              ) : global!.items.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="Nothing to review" subtext="Every reconciled draft is postable." />
              ) : (
                <ul className="space-y-3">
                  {global!.items.map((item) => (<ReviewItemCard key={item.id} item={item} isAdmin={isAdmin} />))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
