/**
 * /payroll/runs/[period] — THE payroll run detail screen (design spec §3 +
 * addendum §2/§3). `[period]` is the run's period_start ISO date; the route
 * resolves the period's NON-VOIDED run by default and a specific (voided)
 * lineage run via `?run=<uuid>`. Three `?view=` tabs: Entry grid / Pay sheets /
 * Summary (print target).
 *
 * Read-path rule (hard): OPEN runs compute live server-side on every request
 * (force-dynamic — save then re-render, no client business math); COMPLETED and
 * VOIDED runs render exclusively from the frozen snapshot via the DAL. The
 * Pattern S complete/void dances run server-side inside their actions; the
 * dialogs here are the human confirmation surfaces.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, GitBranch, Inbox, Lock, Users } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { computePayrollRun, getPayrollRun, listPayrollRuns } from "@/lib/dal/payroll";
import { getShopSettings } from "@/lib/dal/settings";
import { toShopLocalDate } from "@/lib/sales/sale-builder";
import { isIsoDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { BonusToggle } from "./BonusToggle";
import { CompleteRunButton } from "./CompleteRunButton";
import { EntryGrid } from "./EntryGrid";
import { EntryGridReadOnly } from "./EntryGridReadOnly";
import { PrintButton } from "./PrintButton";
import { RefreshTekmetricButton } from "./RefreshTekmetricButton";
import { SheetsView } from "./SheetsView";
import { SummaryView } from "./SummaryView";
import { SyncRosterButton } from "./SyncRosterButton";
import { VoidCloneButton } from "./VoidCloneButton";
import { fmtAsOf, fmtDateLong, monthLabel, periodLabel, RunStatusBadge } from "./run-ui";

export const dynamic = "force-dynamic"; // open runs recompute on every view

type View = "entry" | "sheets" | "summary";
const TABS: { key: View; label: string }[] = [
  { key: "entry", label: "Entry grid" },
  { key: "sheets", label: "Pay sheets" },
  { key: "summary", label: "Summary" },
];

export default async function RunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ period: string }>;
  searchParams: Promise<{ view?: string | string[]; run?: string | string[] }>;
}) {
  const { role, shopId } = await requireQtekUser();
  const { period } = await params;
  if (!isIsoDate(period)) notFound();
  const sp = await searchParams;
  const view: View = sp.view === "sheets" || sp.view === "summary" ? sp.view : "entry";
  const runParam = typeof sp.run === "string" ? sp.run : undefined;

  // All runs sharing this period: at most one non-voided (the DB's partial
  // unique) plus any voided lineage. Default to the non-voided run; ?run=
  // addresses a specific (voided) one so the lineage links resolve.
  const allRuns = await listPayrollRuns(shopId, { limit: 260 });
  const periodRuns = allRuns.filter((r) => r.periodStart === period);
  if (periodRuns.length === 0) notFound();
  const current =
    (runParam ? periodRuns.find((r) => r.id === runParam) : undefined) ??
    periodRuns.find((r) => r.status !== "voided") ??
    periodRuns[0];
  if (!current) notFound();

  const [detail, computation, { settings: shopSettings }] = await Promise.all([
    getPayrollRun(shopId, current.id),
    computePayrollRun(shopId, current.id),
    getShopSettings(shopId), // shopTimezone for the freshness gate below
  ]);
  const run = computation.run;
  const snapshot = computation.snapshot;

  const isAdmin = role === "admin";
  const isOpen = run.status === "open";
  const isCompleted = run.status === "completed";
  const isVoided = run.status === "voided";
  const canEdit = isAdmin && isOpen;

  const entryIdByEmployee = Object.fromEntries(detail.entries.map((e) => [e.employeeId, e.id]));
  const computedByEmployee = Object.fromEntries(snapshot.employees.map((e) => [e.employee_id, e]));

  const totalPayCents = snapshot.summary.reduce((s, r) => s + r.total_pay_cents, 0);
  const totalHours = snapshot.summary.reduce((s, r) => s + r.reg_hours + r.ot_hours, 0);
  const asOf = snapshot.derived_provenance.as_of;
  // Stale = the mirror was refreshed before the END of the period-end day,
  // SHOP-LOCAL. Two subtleties: a refresh any time ON the last day can still
  // miss work posted later that day (so <=, not <), and as_of is a UTC instant
  // whose UTC calendar date can run a day ahead of the shop's (Fri 8 PM shop
  // is already Sat UTC) — compare its shop-local date, never the UTC slice.
  const staleMirror = toShopLocalDate(asOf, shopSettings.shopTimezone) <= run.periodEnd;

  // Lineage targets (all runs of a period share the [period] route).
  const supersededBy = isVoided
    ? (periodRuns.find((r) => r.clonedFromRunId === run.id) ??
      periodRuns.find((r) => r.status !== "voided"))
    : undefined;
  const clonedFrom = run.clonedFromRunId
    ? allRuns.find((r) => r.id === run.clonedFromRunId)
    : undefined;

  const hrefFor = (v: View) =>
    `/payroll/runs/${period}?view=${v}${runParam ? `&run=${runParam}` : ""}`;

  const label = periodLabel(run.periodStart, run.periodEnd);

  return (
    <main
      className={cn(
        "mx-auto max-w-6xl px-6 py-8",
        isCompleted && "bg-muted/20",
        isVoided && "bg-slate-50/40 dark:bg-slate-900/30",
      )}
    >
      <div className="print:hidden">
        <PageHeader
          title={
            <span className={isVoided ? "line-through decoration-1 decoration-slate-400" : undefined}>
              Payroll · {label}
            </span>
          }
          description={
            <Button render={<Link href="/payroll" />} variant="outline" size="sm">
              <ArrowLeft aria-hidden="true" />
              Back to payroll
            </Button>
          }
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <RunStatusBadge status={run.status} />
            <PrintButton />
            {canEdit && snapshot.employees.length > 0 && (
              <CompleteRunButton
                runId={run.id}
                employeeCount={snapshot.employees.length}
                totalPayCents={totalPayCents}
                totalHours={totalHours}
                dataAsOf={asOf}
                periodEnd={run.periodEnd}
                stale={staleMirror}
              />
            )}
          </div>
        </PageHeader>

        {/* ── Status banners ── */}
        {isCompleted && (
          <section className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Lock className="size-4 shrink-0" aria-hidden="true" />
              <p>
                <span className="font-semibold">
                  Completed and locked on {run.completedAt ? fmtDateLong(run.completedAt) : "—"} by{" "}
                  {run.completedByLabel ?? "—"}.
                </span>{" "}
                This run is the archival record and can&apos;t be edited. Everyone on the
                completed-alert list was emailed.
              </p>
            </div>
            {isAdmin && <VoidCloneButton runId={run.id} period={period} />}
          </section>
        )}

        {isVoided && (
          <section className="mt-4 space-y-1">
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <Ban className="size-4 shrink-0" aria-hidden="true" />
              <p>
                <span className="font-semibold">
                  Voided on {run.voidedAt ? fmtDateLong(run.voidedAt) : "—"} by{" "}
                  {run.voidedByLabel ?? "—"}
                </span>
                {supersededBy && (
                  <>
                    {" "}
                    — superseded by{" "}
                    <Link
                      href={`/payroll/runs/${period}`}
                      className="font-semibold underline underline-offset-2"
                    >
                      Run {label} →
                    </Link>
                  </>
                )}
                . Everyone on the void-alert list was emailed.
              </p>
            </div>
            {run.voidReason && (
              <p className="text-sm text-muted-foreground">Reason: {run.voidReason}</p>
            )}
          </section>
        )}

        {clonedFrom && (
          <section className="mt-4 flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300">
            <GitBranch className="size-4 shrink-0" aria-hidden="true" />
            <p>
              Cloned from a voided run{" "}
              <Link
                href={`/payroll/runs/${clonedFrom.periodStart}?run=${clonedFrom.id}`}
                className="font-semibold underline underline-offset-2"
              >
                Run {periodLabel(clonedFrom.periodStart, clonedFrom.periodEnd)} →
              </Link>
              {isOpen && <>. Re-enter and mark complete when ready.</>}
            </p>
          </section>
        )}

        {/* ── Tekmetric freshness (open runs) ── */}
        {isOpen && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              Tekmetric data as of{" "}
              <span className="font-medium text-foreground">{fmtAsOf(asOf)}</span>
              {snapshot.derived_provenance.ro_count !== null && (
                <> · {snapshot.derived_provenance.ro_count} repair orders in period</>
              )}
            </span>
            {isAdmin && <RefreshTekmetricButton runId={run.id} />}
            {isAdmin && <SyncRosterButton runId={run.id} />}
          </div>
        )}

        {/* ── Bonus-period control ── */}
        <div className="mt-4">
          {isOpen ? (
            <BonusToggle
              runId={run.id}
              bonusPeriod={run.bonusPeriod}
              bonusMonth={run.bonusMonth}
              periodStart={run.periodStart}
              canEdit={isAdmin}
            />
          ) : (
            run.bonusPeriod &&
            run.bonusMonth && (
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
                <span className="font-medium text-primary">Bonus run</span>{" "}
                <span className="text-muted-foreground">
                  — paid {monthLabel(run.bonusMonth)} numbers.
                </span>
              </div>
            )
          )}
        </div>

        {/* ── Tabs ── */}
        <nav className="mt-6 flex gap-2" aria-label="Run views">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={hrefFor(t.key)}
              aria-current={view === t.key ? "page" : undefined}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                view === t.key
                  ? "border border-transparent bg-primary/10 font-semibold text-primary"
                  : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {/* ── Tab content (summary renders below, outside print:hidden) ── */}
        <section className="mt-6">
          {view === "entry" &&
            (snapshot.employees.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No active employees to pay"
                subtext={
                  <span className="inline-flex flex-col items-center gap-2">
                    <span>
                      Add people on the{" "}
                      <Link href="/payroll/employees" className="font-medium text-primary underline underline-offset-2">
                        employees page
                      </Link>
                      , then pull them into this run.
                    </span>
                    {canEdit && <SyncRosterButton runId={run.id} />}
                  </span>
                }
              />
            ) : isOpen ? (
              <EntryGrid entries={detail.entries} computed={computedByEmployee} canEdit={canEdit} />
            ) : (
              <EntryGridReadOnly snapshot={snapshot} />
            ))}

          {view === "sheets" &&
            (snapshot.employees.length === 0 ? (
              <EmptyState icon={Inbox} title="Nothing to show yet" subtext="This run has no employees." />
            ) : (
              <SheetsView
                snapshot={snapshot}
                entryIdByEmployee={entryIdByEmployee}
                editable={canEdit}
              />
            ))}
        </section>
      </div>

      {/* Summary: on-screen as its tab; ALWAYS in the DOM for print (the print
          header inside SummaryView labels the sheet). */}
      <section className={view === "summary" ? "mt-6" : "hidden print:block"}>
        {snapshot.summary.length === 0 ? (
          view === "summary" ? (
            <EmptyState icon={Inbox} title="Nothing to summarize yet" subtext="This run has no employees." />
          ) : null
        ) : (
          <SummaryView
            rows={snapshot.summary}
            shopId={shopId}
            periodStart={run.periodStart}
            periodEnd={run.periodEnd}
            status={run.status}
            completedAt={run.completedAt}
          />
        )}
      </section>
    </main>
  );
}
