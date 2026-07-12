/**
 * PayrollTotalsCard — the run-level totals card at the BOTTOM of the Summary
 * page (round-9 decision #46; replaces the summary table's TOTAL row). Purely
 * presentational: every number is the snapshot's server-computed
 * `summary_totals` block (summary.ts buildRunTotals) — NO money math happens
 * here, and NOTHING is computed client-side when the block is absent.
 *
 * Backward compatibility: frozen snapshots completed before the feature lack
 * the block — those runs show a subtle "totals unavailable" note instead of
 * the card. Open runs recompute on read (CALC_VERSION drift), so an absent
 * block on an open run just renders nothing.
 *
 * Layout: the qteklink card idiom (Card + grouped dl grids), grouped
 * Pay / Hours / Metrics; tabular-nums, dollars $X,XXX.XX, hours 2dp; all-null
 * categories render "n/a" (muted em-dash with a reason), never $0.00. Prints
 * with the sheet: it lives inside SummaryView's printable region AFTER the
 * table, break-inside-avoid.
 */
import type { ReactNode } from "react";
import { fmtUsd } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RunStatus, RunTotals } from "@/lib/payroll/types";
import { fmtHours, NA } from "../../payroll-ui";

function Item({ label, emphasized = false, children }: { label: string; emphasized?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </dt>
      <dd
        className={
          emphasized
            ? "mt-0.5 text-lg font-bold tabular-nums text-foreground"
            : "mt-0.5 text-sm font-semibold tabular-nums text-foreground"
        }
      >
        {children}
      </dd>
    </div>
  );
}

/** Dollars, or the archival n/a when the whole category was null — never $0.00. */
function Money({ cents, naTitle }: { cents: number | null; naTitle: string }) {
  return cents === null ? <NA title={naTitle} /> : <>{fmtUsd(cents)}</>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={`${title} totals`}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="mt-1.5 grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</dl>
    </section>
  );
}

export function PayrollTotalsCard({
  totals,
  status,
}: {
  /** snapshot.summary_totals — null/absent on pre-#46 frozen snapshots. */
  totals: RunTotals | null;
  status: RunStatus;
}) {
  if (totals === null) {
    // Only old FROZEN runs can legitimately lack the block (open runs recompute
    // on read). Say so quietly — never compute a substitute client-side.
    if (status === "open") return null;
    return (
      <p className="mt-6 text-sm text-muted-foreground print:mt-4">
        Run totals unavailable — this run was completed before the totals feature was added.
      </p>
    );
  }
  return (
    <Card className="mt-6 break-inside-avoid shadow-xs print:mt-4 print:rounded-none print:shadow-none print:ring-0">
      <CardHeader>
        <CardTitle>Run totals</CardTitle>
        <p className="text-sm text-muted-foreground">
          Every employee summed — the grand-total view of this pay period.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Group title="Pay">
          <Item label="Total pay" emphasized>
            {fmtUsd(totals.total_pay_cents)}
          </Item>
          <Item label="Regular pay">{fmtUsd(totals.reg_pay_cents)}</Item>
          <Item label="Overtime pay">{fmtUsd(totals.ot_pay_cents)}</Item>
          <Item label="Incentive pay">
            <Money cents={totals.incentive_pay_cents} naTitle="No incentives in this run" />
          </Item>
          <Item label="PTO pay">
            <Money cents={totals.pto_pay_cents} naTitle="No PTO pay in this run" />
          </Item>
          <Item label="Holiday pay">
            <Money cents={totals.holiday_pay_cents} naTitle="No holiday pay in this run" />
          </Item>
          <Item label="Bereavement pay">
            <Money cents={totals.bereavement_pay_cents} naTitle="No bereavement pay in this run" />
          </Item>
          <Item label="Training pay">
            <Money cents={totals.training_pay_cents} naTitle="No training pay in this run" />
          </Item>
        </Group>
        <Group title="Hours">
          <Item label="Regular hours">{fmtHours(totals.reg_hours)}</Item>
          <Item label="Overtime hours">{fmtHours(totals.ot_hours)}</Item>
          <Item label="PTO hours">{fmtHours(totals.pto_hours)}</Item>
          <Item label="Holiday hours">{fmtHours(totals.holiday_hours)}</Item>
          <Item label="Bereavement hours">{fmtHours(totals.bereavement_hours)}</Item>
          <Item label="Training hours">{fmtHours(totals.training_hours)}</Item>
          <Item label="Billed hours">
            {totals.billed_hours === null ? (
              <NA title="No billed-hours employees in this run" />
            ) : (
              fmtHours(totals.billed_hours)
            )}
          </Item>
        </Group>
        <Group title="Metrics">
          <Item label="Cost per clock hour">
            {totals.cost_per_clock_hour_cents === null ? (
              <NA title="No clock hours in this run" />
            ) : (
              <>{fmtUsd(totals.cost_per_clock_hour_cents)}/hr</>
            )}
          </Item>
          <Item label="Cost per billed hour">
            {totals.cost_per_billed_hour_cents === null ? (
              <NA title="No billed hours in this run" />
            ) : (
              <>{fmtUsd(totals.cost_per_billed_hour_cents)}/hr</>
            )}
          </Item>
        </Group>
      </CardContent>
    </Card>
  );
}
