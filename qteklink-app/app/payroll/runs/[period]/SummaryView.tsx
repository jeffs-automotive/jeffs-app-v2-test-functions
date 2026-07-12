/**
 * SummaryView — the per-employee totals tab + the print target (design spec
 * §3c). One row per employee from the DAL's summary rows (frozen snapshot for
 * completed/voided runs): Regular hrs, OT hrs, Incentive, PTO, Training,
 * Holiday, Bereavement — n/a (muted em-dash) where a column doesn't apply,
 * never $0.00 for a not-applicable incentive.
 *
 * Round-9 #46: the table's TOTAL footer row is GONE — the run-level totals now
 * render as the PayrollTotalsCard at the BOTTOM of the page, fed EXCLUSIVELY
 * by the snapshot's server-computed `summary_totals` block (nothing is summed
 * client-side; old frozen snapshots without the block show a note instead).
 * The card sits inside this printable region, after the table.
 *
 * Leave columns (PTO/Training/Holiday/Bereavement) show BOTH the hours AND the
 * pay dollars (extraction requirement #31 — Marie keys the pay figures from the
 * printout). The hours read as the primary figure (`font-medium`), the pay in a
 * muted line below (the runs-card stacked-cell idiom); salaried families carry
 * null leave pay and render n/a for the dollar line. This is a presentational
 * projection of the DAL's existing *_pay_cents fields — no math added here.
 *
 * Print: a self-labeling header (`hidden print:block`) that CARRIES THE RUN
 * STATUS — every on-screen status banner lives in the page's print:hidden
 * chrome, so the paper itself must say whether it's the completed record,
 * a still-open draft, or a voided archival copy (never key a draft/voided
 * sheet into the external payroll system). Rows carry break-inside-avoid.
 */
import { fmtUsd } from "@/lib/format";
import type { RunStatus, RunTotals, SummaryRow } from "@/lib/payroll/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDateLong, fmtHours, NA, periodLabel, ROLE_LABEL } from "../../payroll-ui";
import { PayrollTotalsCard } from "./PayrollTotalsCard";

const numCell = "px-3 py-2 text-right tabular-nums";

/**
 * A leave column cell: hours as the primary figure with the pay dollars stacked
 * below (the runs-card idiom). Zero hours → a muted em-dash on the hours line;
 * null pay (salaried family — hours tracked, no leave-pay concept) → "n/a" on
 * the dollar line. break-inside-avoid keeps the two-line cell whole on paper.
 */
function LeaveCell({ hours, payCents }: { hours: number; payCents: number | null }) {
  return (
    <TableCell className={`${numCell} align-top break-inside-avoid`}>
      <div className="font-medium text-foreground">
        {hours === 0 ? <NA title="No hours" /> : fmtHours(hours)}
      </div>
      <div className="text-xs text-muted-foreground">
        {payCents === null ? (
          <NA title="Paid as salary — no separate leave pay" />
        ) : (
          fmtUsd(payCents)
        )}
      </div>
    </TableCell>
  );
}

export function SummaryView({
  rows,
  totals,
  shopId,
  periodStart,
  periodEnd,
  status,
  completedAt,
}: {
  rows: SummaryRow[];
  /** snapshot.summary_totals (round-9 #46) — null on pre-#46 frozen snapshots;
   *  the totals card renders only when present (no client-side substitute). */
  totals: RunTotals | null;
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
              <TableHead className="px-3 py-2 text-right">
                PTO
                <span className="block text-[10px] font-normal normal-case tracking-normal">
                  hrs / pay
                </span>
              </TableHead>
              <TableHead className="px-3 py-2 text-right">
                Training
                <span className="block text-[10px] font-normal normal-case tracking-normal">
                  hrs / pay
                </span>
              </TableHead>
              <TableHead className="px-3 py-2 text-right">
                Holiday
                <span className="block text-[10px] font-normal normal-case tracking-normal">
                  hrs / pay
                </span>
              </TableHead>
              <TableHead className="px-3 py-2 text-right">
                Bereavement
                <span className="block text-[10px] font-normal normal-case tracking-normal">
                  hrs / pay
                </span>
              </TableHead>
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
                <LeaveCell hours={r.pto_hours} payCents={r.pto_pay_cents} />
                <LeaveCell hours={r.training_hours} payCents={r.training_pay_cents} />
                <LeaveCell hours={r.holiday_hours} payCents={r.holiday_pay_cents} />
                <LeaveCell hours={r.bereavement_hours} payCents={r.bereavement_pay_cents} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Round-9 #46: the run-level totals card — server-computed numbers only,
          printed with the sheet (after the table, inside the printable region). */}
      <PayrollTotalsCard totals={totals} status={status} />
    </div>
  );
}
