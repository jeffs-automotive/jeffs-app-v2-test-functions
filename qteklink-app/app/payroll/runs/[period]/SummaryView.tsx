/**
 * SummaryView — the per-employee totals tab + the print target (design spec
 * §3c). One row per employee from the DAL's summary rows (frozen snapshot for
 * completed/voided runs): Regular hrs, OT hrs, Incentive, PTO, Training,
 * Holiday, Bereavement — n/a (muted em-dash) where a column doesn't apply,
 * never $0.00 for a not-applicable incentive. A totals footer sums each
 * column (display-only server-side addition of the DAL's numbers).
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

/**
 * The footer twin of {@link LeaveCell}: the column's hours total always shows
 * (it's a sum), and the pay total shows dollars, or n/a when every row in the
 * column carried null leave pay (all-salaried — never a misleading $0.00).
 */
function LeaveTotalCell({ hours, payCents }: { hours: number; payCents: number | null }) {
  return (
    <TableCell className={`${numCell} align-top break-inside-avoid`}>
      <div>{fmtHours(hours)}</div>
      <div className="text-xs font-normal text-muted-foreground">
        {payCents === null ? <NA title="No leave pay" /> : fmtUsd(payCents)}
      </div>
    </TableCell>
  );
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
  // Display-only footer sums of the DAL's numbers (no pay math). Leave-pay totals
  // sum only the non-null contributions (salaried families carry null leave pay);
  // a column whose every row is null stays null → renders n/a, never $0.00.
  const totals = rows.reduce(
    (t, r) => ({
      reg: t.reg + r.reg_hours,
      ot: t.ot + r.ot_hours,
      incentive: r.incentive_cents === null ? t.incentive : (t.incentive ?? 0) + r.incentive_cents,
      pto: t.pto + r.pto_hours,
      ptoPay: r.pto_pay_cents === null ? t.ptoPay : (t.ptoPay ?? 0) + r.pto_pay_cents,
      training: t.training + r.training_hours,
      trainingPay:
        r.training_pay_cents === null ? t.trainingPay : (t.trainingPay ?? 0) + r.training_pay_cents,
      holiday: t.holiday + r.holiday_hours,
      holidayPay:
        r.holiday_pay_cents === null ? t.holidayPay : (t.holidayPay ?? 0) + r.holiday_pay_cents,
      bereavement: t.bereavement + r.bereavement_hours,
      bereavementPay:
        r.bereavement_pay_cents === null
          ? t.bereavementPay
          : (t.bereavementPay ?? 0) + r.bereavement_pay_cents,
    }),
    {
      reg: 0,
      ot: 0,
      incentive: null as number | null,
      pto: 0,
      ptoPay: null as number | null,
      training: 0,
      trainingPay: null as number | null,
      holiday: 0,
      holidayPay: null as number | null,
      bereavement: 0,
      bereavementPay: null as number | null,
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
          <TableFooter className="bg-transparent">
            <TableRow className="border-t-2 border-border font-semibold hover:bg-transparent">
              <TableCell className="px-3 py-2">Totals</TableCell>
              <TableCell className={numCell}>{fmtHours(totals.reg)}</TableCell>
              <TableCell className={numCell}>{fmtHours(totals.ot)}</TableCell>
              <TableCell className={numCell}>
                {totals.incentive === null ? <NA title="No incentives" /> : fmtUsd(totals.incentive)}
              </TableCell>
              <LeaveTotalCell hours={totals.pto} payCents={totals.ptoPay} />
              <LeaveTotalCell hours={totals.training} payCents={totals.trainingPay} />
              <LeaveTotalCell hours={totals.holiday} payCents={totals.holidayPay} />
              <LeaveTotalCell hours={totals.bereavement} payCents={totals.bereavementPay} />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
