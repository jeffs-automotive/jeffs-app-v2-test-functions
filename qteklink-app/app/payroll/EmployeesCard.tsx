/**
 * EmployeesCard (server component, page-local to /payroll) — one row per ACTIVE
 * employee: pay basis (hourly rate OR weekly salary), billed rate (n/a for
 * non-billed roles), the two last-12-completed-runs hourly averages (without
 * bonus for everyone; with bonus only for the SA / office-manager / foreman
 * families), and the LEDGER PTO balance (the single balance truth — plan §2b/C22;
 * the tier engine owns accrual rates now, so the old "accrues X hrs/period"
 * sub-line and the pay_config pto_* reads are gone).
 * Archived employees stay out of the way behind a collapsed <details>.
 *
 * Read/display only — averages are computed by the pure summary.ts exports from
 * DAL-provided snapshot rows; nothing here mutates or recomputes frozen runs.
 */
import Link from "next/link";
import { Users } from "lucide-react";
import type { PayrollEmployee } from "@/lib/dal/payroll";
import { employeeHourlyAverages, WITH_BONUS_FAMILIES } from "@/lib/payroll/summary";
import {
  familyForRole,
  parsePayConfig,
  type Family,
  type SummaryRow,
} from "@/lib/payroll/types";
import { fmtUsd } from "@/lib/format";
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
import { headerCls, NotApplicable, numCell, PtoBalance, ROLE_LABELS } from "./payroll-ui";

interface PayView {
  kind: "hourly" | "salary";
  rateCents: number;
  billedRateCents: number | null;
}

/** Family-narrowed read of the validated pay_config (throws loud on a bad config —
 *  configs are dual-validated at write time, so this is defense, not flow). */
function payViewFor(family: Family, payConfig: Record<string, unknown>): PayView {
  switch (family) {
    case "service_advisor": {
      const c = parsePayConfig("service_advisor", payConfig);
      return { kind: "salary", rateCents: c.weekly_salary_cents, billedRateCents: null };
    }
    case "technician":
    case "shop_foreman": {
      const c = parsePayConfig(family, payConfig);
      return { kind: "hourly", rateCents: c.hourly_rate_cents, billedRateCents: c.billed_rate_cents };
    }
    case "office_manager": {
      const c = parsePayConfig("office_manager", payConfig);
      return { kind: "hourly", rateCents: c.hourly_rate_cents, billedRateCents: null };
    }
    case "support": {
      const c = parsePayConfig("support", payConfig);
      return { kind: "hourly", rateCents: c.hourly_rate_cents, billedRateCents: null };
    }
  }
}

interface EmployeeRowView {
  emp: PayrollEmployee;
  family: Family;
  pay: PayView;
  avgWithoutBonusCents: number | null;
  avgWithBonusCents: number | null;
  /** Ledger PTO balance (single balance truth); 0 when the employee is unseeded. */
  ptoBalanceHours: number;
}

function employeeRowView(
  emp: PayrollEmployee,
  rowsByEmployee: Map<string, SummaryRow[]>,
  ptoBalances: Map<string, number>,
): EmployeeRowView {
  const family = familyForRole(emp.role);
  const averages = employeeHourlyAverages(family, rowsByEmployee.get(emp.id) ?? []);
  return {
    emp,
    family,
    pay: payViewFor(family, emp.payConfig),
    avgWithoutBonusCents: averages.avg_hourly_without_bonus_cents,
    avgWithBonusCents: averages.avg_hourly_with_bonus_cents,
    ptoBalanceHours: ptoBalances.get(emp.id) ?? 0,
  };
}

function EmployeeHeaderRow() {
  return (
    <TableRow>
      <TableHead className="px-3 py-2">Employee</TableHead>
      <TableHead className="px-3 py-2">Pay basis</TableHead>
      <TableHead className="px-3 py-2 text-right">Billed rate</TableHead>
      <TableHead className="px-3 py-2 text-right">Avg hourly (no bonus)</TableHead>
      <TableHead className="px-3 py-2 text-right">Avg hourly (with bonus)</TableHead>
      <TableHead className="px-3 py-2 text-right">PTO available</TableHead>
    </TableRow>
  );
}

function EmployeeRow({ v, archived }: { v: EmployeeRowView; archived: boolean }) {
  const noBonusFamily = !(WITH_BONUS_FAMILIES as readonly Family[]).includes(v.family);
  return (
    <TableRow className={archived ? "opacity-70" : undefined}>
      <TableCell className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{v.emp.displayName}</span>
          {archived && <Badge variant="secondary">Archived</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{ROLE_LABELS[v.emp.role]}</p>
      </TableCell>
      <TableCell className="px-3 py-2.5">
        <span className="text-muted-foreground">{v.pay.kind === "salary" ? "Salary" : "Hourly"}</span>{" "}
        <span className="font-medium tabular-nums text-foreground">
          {fmtUsd(v.pay.rateCents)}
          {v.pay.kind === "salary" ? "/wk" : "/hr"}
        </span>
      </TableCell>
      <TableCell className={numCell}>
        {v.pay.billedRateCents !== null ? (
          `${fmtUsd(v.pay.billedRateCents)}/hr`
        ) : (
          <NotApplicable reason="Not a billed-hours role" />
        )}
      </TableCell>
      <TableCell
        className={numCell}
        title="Last 12 completed runs — pay excluding bonuses, spiffs and manual incentives ÷ clock hours"
      >
        {v.avgWithoutBonusCents !== null ? (
          `${fmtUsd(v.avgWithoutBonusCents)}/hr`
        ) : (
          <NotApplicable reason="No completed payroll runs yet" />
        )}
      </TableCell>
      <TableCell
        className={numCell}
        title="Last 12 completed runs — total pay including bonuses and spiffs ÷ clock hours"
      >
        {v.avgWithBonusCents !== null ? (
          `${fmtUsd(v.avgWithBonusCents)}/hr`
        ) : (
          <NotApplicable
            reason={noBonusFamily ? "Role has no bonus" : "No completed payroll runs yet"}
          />
        )}
      </TableCell>
      <TableCell className={numCell}>
        <span className="font-medium">
          <PtoBalance hours={v.ptoBalanceHours} />
        </span>
      </TableCell>
    </TableRow>
  );
}

export default function EmployeesCard({
  active,
  archived,
  rowsByEmployee,
  ptoBalances,
}: {
  active: PayrollEmployee[];
  archived: PayrollEmployee[];
  /** Per-employee SummaryRows from the last-12-COMPLETED-runs window. */
  rowsByEmployee: Map<string, SummaryRow[]>;
  /** Per-employee LEDGER PTO balance (the single balance truth — plan §2b);
   *  an unseeded employee is absent from the map and renders 0. */
  ptoBalances: Map<string, number>;
}) {
  const activeViews = active.map((e) => employeeRowView(e, rowsByEmployee, ptoBalances));
  const archivedViews = archived.map((e) => employeeRowView(e, rowsByEmployee, ptoBalances));

  return (
    <Card className="mt-8 shadow-xs">
      <CardHeader>
        <CardTitle>Employees</CardTitle>
        <CardAction>
          <Badge variant="secondary">{active.length} active</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <div>
            <EmptyState
              icon={Users}
              title="No employees yet"
              subtext="Add your first employee to start running payroll."
            />
            <div className="mt-3 text-center">
              <Button render={<Link href="/payroll/employees" />}>
                <Users aria-hidden="true" />
                Add employees
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader className={headerCls}>
                <EmployeeHeaderRow />
              </TableHeader>
              <TableBody>
                {activeViews.map((v) => (
                  <EmployeeRow key={v.emp.id} v={v} archived={false} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {archived.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              Show {archived.length} archived employee{archived.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-2 overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader className={headerCls}>
                  <EmployeeHeaderRow />
                </TableHeader>
                <TableBody>
                  {archivedViews.map((v) => (
                    <EmployeeRow key={v.emp.id} v={v} archived={true} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
