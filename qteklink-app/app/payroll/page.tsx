/**
 * /payroll — the payroll dashboard: the active-employee pay roster (rates, billed
 * rate, 12-run hourly averages, PTO — EmployeesCard.tsx) and the last-12-runs
 * card, plus the admin "Start new payroll run" affordance (next on-cadence period
 * from the DAL-provided last run / anchor).
 *
 * Read paths only: employees + settings via the payroll DAL; per-run numbers via
 * listPayrollRunsWithSummaries (completed/voided runs read their FROZEN snapshot
 * rows — never recomputed; the one open run computes live server-side). All
 * windowing/averaging uses the pure summary.ts exports, which exclude voided and
 * open runs from every aggregate. requireQtekUser() gates the page; mutations are
 * admin-gated in the actions (the start-run affordance renders for admins only).
 */
import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import {
  getPayrollSettings,
  listPayrollEmployees,
  listPayrollRunsWithSummaries,
  type PayrollRun,
  type PayrollRunWithSummary,
} from "@/lib/dal/payroll";
import { lastCompletedRuns, type RunForAggregation } from "@/lib/payroll/summary";
import type { SummaryRow } from "@/lib/payroll/types";
import { addDaysIso, fmtUsd } from "@/lib/format";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import EmployeesCard from "./EmployeesCard";
import StartRunButton from "./StartRunButton";
import { fmtPeriodRange, nextOnCadencePeriodStart, todayIsoUtc } from "./period";
import {
  fmtHoursFixed1,
  headerCls,
  NotApplicable,
  numCell,
  periodYears,
  RunStatusBadge,
} from "./payroll-ui";

export const dynamic = "force-dynamic"; // roster, averages + run statuses must always be current

// ── Runs card ───────────────────────────────────────────────────────────────────

interface RunRowView {
  run: PayrollRun;
  regHours: number;
  regPayCents: number;
  otHours: number;
  otPayCents: number;
  billedHours: number | null;
  billedPayCents: number | null;
  ptoHours: number;
  bereavementHours: number;
  holidayHours: number;
  trainingHours: number;
  /** Σ (bonus + spiff) for bonus runs; null = "n/a" (not a bonus run). */
  bonusCents: number | null;
}

function runRowView({ run, rows }: PayrollRunWithSummary): RunRowView {
  const v: RunRowView = {
    run,
    regHours: 0,
    regPayCents: 0,
    otHours: 0,
    otPayCents: 0,
    billedHours: null,
    billedPayCents: null,
    ptoHours: 0,
    bereavementHours: 0,
    holidayHours: 0,
    trainingHours: 0,
    bonusCents: null,
  };
  let bonus = 0;
  for (const r of rows) {
    v.regHours += r.reg_hours;
    v.regPayCents += r.reg_pay_cents;
    v.otHours += r.ot_hours;
    v.otPayCents += r.ot_pay_cents;
    if (r.billed_hours !== null) v.billedHours = (v.billedHours ?? 0) + r.billed_hours;
    if (r.billed_pay_cents !== null) v.billedPayCents = (v.billedPayCents ?? 0) + r.billed_pay_cents;
    v.ptoHours += r.pto_hours;
    v.bereavementHours += r.bereavement_hours;
    v.holidayHours += r.holiday_hours;
    v.trainingHours += r.training_hours;
    bonus += (r.bonus_cents ?? 0) + (r.spiff_cents ?? 0);
  }
  v.bonusCents = run.bonusPeriod ? bonus : null;
  return v;
}

function HoursPayCell({ hours, payCents, muted }: { hours: number; payCents: number; muted: boolean }) {
  return (
    <TableCell className={numCell}>
      <div className={cn("font-medium", muted ? "text-muted-foreground" : "text-foreground")}>
        {fmtUsd(payCents)}
      </div>
      <div className="text-xs text-muted-foreground">{fmtHoursFixed1(hours)} h</div>
    </TableCell>
  );
}

function HoursOnlyCell({ hours }: { hours: number }) {
  return (
    <TableCell className={numCell}>
      {hours > 0 ? fmtHoursFixed1(hours) : <span className="text-muted-foreground">—</span>}
    </TableCell>
  );
}

function RunRow({ v }: { v: RunRowView }) {
  const voided = v.run.status === "voided";
  const label = fmtPeriodRange(v.run.periodStart, v.run.periodEnd);
  // A voided run must open its OWN archival page: the plain period URL resolves
  // to the period's non-voided run (the clone), so voided rows address their
  // specific run via ?run= (the [period] route's voided-lineage param).
  const href = voided
    ? `/payroll/runs/${v.run.periodStart}?run=${v.run.id}`
    : `/payroll/runs/${v.run.periodStart}`;
  return (
    <TableRow className={voided ? "bg-[color:var(--color-voided-bg)]/50 text-muted-foreground" : undefined}>
      <TableCell className={cn("px-3 py-2", v.run.bonusPeriod && "border-l-2 border-primary")}>
        <div className="flex items-center gap-2">
          <Link
            href={href}
            className={cn(
              "font-medium underline-offset-4 hover:underline",
              voided ? "line-through decoration-[color:var(--color-voided-border)]" : "text-foreground",
            )}
          >
            {label}
          </Link>
          {v.run.bonusPeriod && (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
              bonus
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {periodYears(v.run.periodStart, v.run.periodEnd)}
          {voided && " · excluded from totals"}
        </p>
      </TableCell>
      <TableCell className="px-3 py-2">
        <RunStatusBadge status={v.run.status} />
      </TableCell>
      <HoursPayCell hours={v.regHours} payCents={v.regPayCents} muted={voided} />
      <HoursPayCell hours={v.otHours} payCents={v.otPayCents} muted={voided} />
      {v.billedHours !== null || v.billedPayCents !== null ? (
        <HoursPayCell hours={v.billedHours ?? 0} payCents={v.billedPayCents ?? 0} muted={voided} />
      ) : (
        <TableCell className={numCell}>
          <NotApplicable reason="No billed-hours roles on this run" />
        </TableCell>
      )}
      <HoursOnlyCell hours={v.ptoHours} />
      <HoursOnlyCell hours={v.bereavementHours} />
      <HoursOnlyCell hours={v.holidayHours} />
      <HoursOnlyCell hours={v.trainingHours} />
      <TableCell className={numCell}>
        {v.bonusCents !== null ? (
          <span className={cn("font-medium", voided ? "text-muted-foreground" : "text-foreground")}>
            {fmtUsd(v.bonusCents)}
          </span>
        ) : (
          <NotApplicable reason="Not a bonus run" />
        )}
      </TableCell>
      <TableCell className="px-1 py-2 text-right">
        <span className="inline-flex items-center justify-end gap-1">
          {voided && (
            // The addendum's distinct affordance: the row opens the voided
            // archival record; this link opens the clone that superseded it.
            <Link
              href={`/payroll/runs/${v.run.periodStart}`}
              aria-label={`Open the run that superseded ${label}`}
              className="whitespace-nowrap text-xs font-medium no-underline underline-offset-2 hover:underline"
            >
              superseded →
            </Link>
          )}
          <Link
            href={href}
            aria-label={`Open payroll run ${label}`}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </span>
      </TableCell>
    </TableRow>
  );
}

// ── The page ────────────────────────────────────────────────────────────────────

export default async function PayrollPage() {
  const { email, role, shopId } = await requireQtekUser();
  const [{ payroll: settings }, employees, runsWithRows] = await Promise.all([
    getPayrollSettings(shopId),
    listPayrollEmployees(shopId, { includeArchived: true }),
    // 40 > the 12-run card so the completed-runs window survives interleaved
    // open/voided rows (voided runs never count toward the 12).
    listPayrollRunsWithSummaries(shopId, { limit: 40 }),
  ]);

  const activeEmployees = employees.filter((e) => e.archivedAt === null);
  const archivedEmployees = employees.filter((e) => e.archivedAt !== null);

  // Per-employee last-12-COMPLETED-runs window (pure summary.ts exports own the
  // filtering — voided/open runs never reach an average).
  const completedWindow = lastCompletedRuns(
    runsWithRows.map(
      (r): RunForAggregation => ({
        status: r.run.status,
        period_start: r.run.periodStart,
        rows: r.rows,
      }),
    ),
    12,
  );
  const rowsByEmployee = new Map<string, SummaryRow[]>();
  for (const run of completedWindow) {
    for (const row of run.rows) {
      const list = rowsByEmployee.get(row.employee_id) ?? [];
      list.push(row);
      rowsByEmployee.set(row.employee_id, list);
    }
  }

  const runViews = runsWithRows.slice(0, 12).map(runRowView);
  const anyVoided = runViews.some((v) => v.run.status === "voided");
  const openRun = runsWithRows.find((r) => r.run.status === "open")?.run ?? null;

  // Next on-cadence period for the admin start-run affordance (newest-first list:
  // the first non-voided run is the latest; a voided run's period is re-covered by
  // its clone, which sorts first for the same period_start).
  const latestNonVoided =
    runsWithRows.find((r) => r.run.status !== "voided")?.run.periodStart ?? null;
  const nextPeriodStart = nextOnCadencePeriodStart(
    settings.anchor_period_start,
    latestNonVoided,
    todayIsoUtc(),
  );
  // period_end = period_start + 13 (the contract's bi-weekly CHECK).
  const nextPeriodLabel =
    nextPeriodStart !== null ? fmtPeriodRange(nextPeriodStart, addDaysIso(nextPeriodStart, 13)) : null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <PageHeader title="Payroll" description="Bi-weekly pay runs and employee pay setup">
        <div className="flex items-center gap-3">
          <Button render={<Link href="/payroll/employees" />} variant="outline">
            Manage employees
          </Button>
          <IdentityBlock email={email} role={role} shopId={shopId} />
        </div>
      </PageHeader>

      <section className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
        Payroll replaces the pay-period workbook: enter hours on the run, review each pay sheet,
        and mark the run complete to lock it.{" "}
        {openRun ? (
          <>
            The current open run is{" "}
            <Link
              href={`/payroll/runs/${openRun.periodStart}`}
              className="font-medium text-primary underline underline-offset-4"
            >
              {fmtPeriodRange(openRun.periodStart, openRun.periodEnd)}
            </Link>
            .{" "}
          </>
        ) : null}
        Spiff categories and alert emails live in{" "}
        <Link href="/payroll/settings" className="font-medium text-primary underline underline-offset-4">
          payroll settings
        </Link>
        .
      </section>

      <EmployeesCard
        active={activeEmployees}
        archived={archivedEmployees}
        rowsByEmployee={rowsByEmployee}
      />

      {/* ── Recent payroll runs ── */}
      <Card className="mt-8 shadow-xs">
        <CardHeader>
          <CardTitle>Recent payroll runs</CardTitle>
          {role === "admin" && (
            <CardAction>
              <StartRunButton nextPeriodStart={nextPeriodStart} nextPeriodLabel={nextPeriodLabel} />
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {runViews.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No payroll runs yet"
              subtext="The current period will appear here once you open it."
            />
          ) : (
            <>
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader className={headerCls}>
                    <TableRow>
                      <TableHead className="px-3 py-2">Period</TableHead>
                      <TableHead className="px-3 py-2">Status</TableHead>
                      <TableHead className="px-3 py-2 text-right">Regular</TableHead>
                      <TableHead className="px-3 py-2 text-right">OT</TableHead>
                      <TableHead className="px-3 py-2 text-right">Billed</TableHead>
                      <TableHead className="px-3 py-2 text-right">PTO</TableHead>
                      <TableHead className="px-3 py-2 text-right">Ber</TableHead>
                      <TableHead className="px-3 py-2 text-right">Hol</TableHead>
                      <TableHead className="px-3 py-2 text-right">Trn</TableHead>
                      <TableHead className="px-3 py-2 text-right">Total bonus</TableHead>
                      <TableHead className="px-1 py-2">
                        <span className="sr-only">Open run</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runViews.map((v) => (
                      <RunRow key={v.run.id} v={v} />
                    ))}
                  </TableBody>
                </Table>
              </div>
              {anyVoided && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Voided runs are struck through and excluded from every total and average.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
