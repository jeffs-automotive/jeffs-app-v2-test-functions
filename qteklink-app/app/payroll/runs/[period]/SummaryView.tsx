/**
 * SummaryView — the per-employee totals tab + the print target (design spec
 * §3c). One row per employee from the DAL's summary rows (frozen snapshot for
 * completed/voided runs): Regular hrs, OT hrs, Incentive, PTO, Training,
 * Holiday, Bereavement — n/a (muted em-dash) where a column doesn't apply,
 * never $0.00 for a not-applicable incentive. A totals footer sums each
 * column (display-only server-side addition of the DAL's numbers).
 *
 * Print: a self-labeling header (`hidden print:block`) that CARRIES THE RUN
 * STATUS — every on-screen status banner lives in the page's print:hidden
 * chrome, so the paper itself must say whether it's the completed record,
 * a still-open draft, or a voided archival copy (never key a draft/voided
 * sheet into the external payroll system). Rows carry break-inside-avoid.
 */
import { fmtUsd } from "@/lib/format";
import type { RunStatus, SummaryRow } from "@/lib/payroll/types";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDateLong, fmtHours, NA, periodLabel, ROLE_LABEL } from "../../payroll-ui";

const numCell = "px-3 py-2 text-right tabular-nums";

function HoursCell({ hours }: { hours: number }) {
  return <TableCell className={numCell}>{hours === 0 ? <NA title="No hours" /> : fmtHours(hours)}</TableCell>;
}

export function SummaryView({
  rows,
  shopId,
  periodStart,
  periodEnd,
  status,
  completedAt,
}: {
  rows: SummaryRow[];
  shopId: number;
  periodStart: string;
  periodEnd: string;
  /** The run's status — printed in the header so the paper self-describes. */
  status: RunStatus;
  /** run.completedAt (null unless completed) — the "Completed {date}" line. */
  completedAt: string | null;
}) {
  // The printed sheet's self-description: only a COMPLETED run's numbers may be
  // keyed into the external payroll system; drafts change and voided runs are
  // archival copies (the spec sanctions printing them — labeled, never mistakable).
  const statusLine =
    status === "voided"
      ? "VOIDED — archival copy, do not key into the payroll system"
      : status === "completed"
        ? `Completed${completedAt ? ` ${fmtDateLong(completedAt)}` : ""} — for keying into the payroll system`
        : "DRAFT — run not completed; numbers may still change";
  // Display-only footer sums of the DAL's numbers (no pay math).
  const totals = rows.reduce(
    (t, r) => ({
      reg: t.reg + r.reg_hours,
      ot: t.ot + r.ot_hours,
      incentive: r.incentive_cents === null ? t.incentive : (t.incentive ?? 0) + r.incentive_cents,
      pto: t.pto + r.pto_hours,
      training: t.training + r.training_hours,
      holiday: t.holiday + r.holiday_hours,
      bereavement: t.bereavement + r.bereavement_hours,
    }),
    {
      reg: 0,
      ot: 0,
      incentive: null as number | null,
      pto: 0,
      training: 0,
      holiday: 0,
      bereavement: 0,
    },
  );

  return (
    <div>
      <div className="mb-4 hidden print:block">
        <p className="text-lg font-bold text-foreground">
          Payroll summary — {periodLabel(periodStart, periodEnd)}
        </p>
        <p className="text-sm font-semibold text-foreground">{statusLine}</p>
        <p className="text-sm text-muted-foreground">Shop {shopId}</p>
      </div>

      <div className="print-keep overflow-hidden rounded-lg border border-border shadow-xs print:rounded-none print:border-0 print:shadow-none">
        <Table>
          <TableHeader className="bg-muted text-xs uppercase tracking-wide text-muted-foreground [&_th]:h-auto [&_th]:text-muted-foreground">
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3 py-2 text-left">Employee</TableHead>
              <TableHead className="px-3 py-2 text-right">Regular hrs</TableHead>
              <TableHead className="px-3 py-2 text-right">OT hrs</TableHead>
              <TableHead className="px-3 py-2 text-right">Incentive</TableHead>
              <TableHead className="px-3 py-2 text-right">PTO</TableHead>
              <TableHead className="px-3 py-2 text-right">Training</TableHead>
              <TableHead className="px-3 py-2 text-right">Holiday</TableHead>
              <TableHead className="px-3 py-2 text-right">Bereavement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.employee_id} className="break-inside-avoid">
                <TableCell className="px-3 py-2">
                  <span className="font-medium text-foreground">{r.display_name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{ROLE_LABEL[r.role]}</span>
                </TableCell>
                <TableCell className={numCell}>{fmtHours(r.reg_hours)}</TableCell>
                <TableCell className={numCell}>
                  {r.ot_hours === 0 ? <NA title="No overtime" /> : fmtHours(r.ot_hours)}
                </TableCell>
                <TableCell className={numCell}>
                  {r.incentive_cents === null ? (
                    <NA title="No incentive entered" />
                  ) : (
                    fmtUsd(r.incentive_cents)
                  )}
                </TableCell>
                <HoursCell hours={r.pto_hours} />
                <HoursCell hours={r.training_hours} />
                <HoursCell hours={r.holiday_hours} />
                <HoursCell hours={r.bereavement_hours} />
              </TableRow>
            ))}
          </TableBody>
          <TableFooter className="bg-transparent">
            <TableRow className="border-t-2 border-border font-semibold hover:bg-transparent">
              <TableCell className="px-3 py-2">Totals</TableCell>
              <TableCell className={numCell}>{fmtHours(totals.reg)}</TableCell>
              <TableCell className={numCell}>{fmtHours(totals.ot)}</TableCell>
              <TableCell className={numCell}>
                {totals.incentive === null ? <NA title="No incentives" /> : fmtUsd(totals.incentive)}
              </TableCell>
              <TableCell className={numCell}>{fmtHours(totals.pto)}</TableCell>
              <TableCell className={numCell}>{fmtHours(totals.training)}</TableCell>
              <TableCell className={numCell}>{fmtHours(totals.holiday)}</TableCell>
              <TableCell className={numCell}>{fmtHours(totals.bereavement)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
