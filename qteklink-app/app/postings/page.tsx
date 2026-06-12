/**
 * /postings — the POSTING QUEUE: repair orders that were unposted in Tekmetric and
 * posted again on a DIFFERENT day, while their original day's journal entry is
 * already in QuickBooks. Nothing changes in QuickBooks until the office manager
 * decides here (or the RO is re-posted back to its original day in Tekmetric).
 *
 * EVERY page load re-scans (refreshDateMoves: detect + auto-resolve fixed items +
 * send Date Change Alerts for new ones), so the list is always current without
 * pressing anything. A re-scan failure never blocks the page — it's captured to
 * Sentry and flagged in a banner. Everyone signed in can READ; only admins act
 * (enforced in the actions).
 */
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, CheckCircle2, Clock, Inbox } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { listDateMoves, refreshDateMoves, type DateMoveRow } from "@/lib/dal/date-moves";
import { fmtUsd } from "@/lib/format";
import { ApproveMoveButton, UnapproveMoveButton, RefreshQueueButton } from "./DateMoveControls";
import AutoRefresh from "@/components/AutoRefresh";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic"; // the load-time re-scan must run every visit

function MoveCard({ m, isAdmin }: { m: DateMoveRow; isAdmin: boolean }) {
  const ro = m.roNumber ?? String(m.tekmetricRoId);
  const approved = m.status === "approved";
  return (
    <li>
      <Card className={`shadow-xs border-l-2 ${approved ? "border-l-emerald-500" : "border-l-primary"}`}>
        <CardContent className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="font-mono tabular-nums">RO {ro}</Badge>
            {approved ? (
              <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-800">
                <CheckCircle2 aria-hidden="true" />
                Approved
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <Clock aria-hidden="true" />
                Pending
              </Badge>
            )}
            <span className="text-sm text-muted-foreground">
              moved from <span className="font-medium text-foreground">{m.originalBusinessDate}</span> to{" "}
              <span className="font-medium text-foreground">{m.newBusinessDate}</span>
            </span>
            {m.newTotalCents != null && (
              <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">{fmtUsd(m.newTotalCents)}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Found {new Date(m.detectedAt).toLocaleString()}.{" "}
            {approved
              ? `Date change approved by ${m.approvedBy ?? "an admin"} — QuickBooks has been updated.`
              : `The original day's journal entry in QuickBooks still includes this repair order.`}
          </p>
          {isAdmin && (m.status === "pending" || approved) && (
            <div className="flex flex-wrap items-center gap-2 pt-2">
              {m.status === "pending" && (
                <ApproveMoveButton id={m.id} roNumber={ro} fromDate={m.originalBusinessDate} toDate={m.newBusinessDate} />
              )}
              {approved && <UnapproveMoveButton id={m.id} roNumber={ro} />}
            </div>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export default async function PostingQueuePage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";

  // Re-scan on every load so fixed items clear themselves. Never block the page on it.
  let rescanFailed = false;
  try {
    await refreshDateMoves(shopId);
  } catch (e) {
    rescanFailed = true;
    Sentry.captureException(e, { tags: { qteklink_page: "postings", shop_id: String(shopId) } });
  }
  const { realmId, open, recentlyResolved } = await listDateMoves(shopId);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <PageHeader title="Posting queue" description="Repair orders that moved to a different day">
        <IdentityBlock email={email} role={role} shopId={shopId} />
      </PageHeader>
      {/* The re-scan runs per request, so the timer makes the queue self-clearing
          while the office manager watches (60s — the scan is heavier than a day view). */}
      <AutoRefresh intervalMs={60_000} />

      {rescanFailed && (
        <section className="mt-4 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" />
          <p className="text-sm text-amber-800">
            The automatic re-check didn&apos;t finish, so this list may be slightly out of date.
            Press <span className="font-medium">Check again</span> or reload the page.
          </p>
        </section>
      )}

      <section className="mt-6 rounded-lg border border-border bg-muted p-5 text-sm text-muted-foreground">
        <h2 className="font-semibold text-foreground">What this page is for</h2>
        <p className="mt-1">
          An item shows up here when a repair order was <span className="font-medium text-foreground">unposted in
          Tekmetric and posted again on a different day</span>, but the original day&apos;s journal
          entry is already in QuickBooks. Nothing changes in QuickBooks until you decide. The list
          re-checks itself every time this page opens.
        </p>
        <p className="mt-2 font-medium text-foreground">For each item, do ONE of these:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>
            <span className="font-medium text-foreground">Usually:</span> ask the service advisor to re-post the
            repair order on the <span className="font-medium text-foreground">original day</span> in Tekmetric. The
            item clears itself the next time this page opens (or press{" "}
            <span className="font-medium text-foreground">Check again</span>).
          </li>
          <li>
            <span className="font-medium text-foreground">Only if the new date is really correct:</span> press{" "}
            <span className="font-medium text-foreground">Approve the date change</span>. QTekLink moves the repair
            order between the two days&apos; journal entries in QuickBooks.
          </li>
        </ul>
        <p className="mt-2">
          Approved something by mistake? Use <span className="font-medium text-foreground">Undo approval</span> on
          the item to put everything back.
        </p>
      </section>

      {!realmId ? (
        <section className="mt-8 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" />
          <p className="text-sm text-amber-800">QuickBooks isn&apos;t connected for this shop yet.</p>
        </section>
      ) : (
        <>
          <section className="mt-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                Waiting on you {open.length > 0 && <Badge variant="secondary" className="tabular-nums">{open.length}</Badge>}
              </h2>
              {isAdmin && <RefreshQueueButton />}
            </div>
            {open.length === 0 ? (
              <div className="mt-3">
                <EmptyState icon={Inbox} title="Nothing in the queue" subtext="No repair orders have moved days." />
              </div>
            ) : (
              <ul className="mt-3 space-y-3">
                {open.map((m) => <MoveCard key={m.id} m={m} isAdmin={isAdmin} />)}
              </ul>
            )}
          </section>

          {recentlyResolved.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Cleared in the last two weeks
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {recentlyResolved.map((m) => (
                  <li key={m.id}>
                    RO {m.roNumber ?? m.tekmetricRoId} — re-posted back to {m.originalBusinessDate}
                    {m.resolvedAt ? ` (${new Date(m.resolvedAt).toLocaleDateString()})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
