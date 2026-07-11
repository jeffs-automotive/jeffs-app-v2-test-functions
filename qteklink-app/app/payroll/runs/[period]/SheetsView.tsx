/**
 * SheetsView — the per-employee pay sheets tab (design spec §3b), rendered per
 * role family from the DAL's computed SheetComputation. Server component: for
 * OPEN runs the snapshot was computed live on this request; for COMPLETED /
 * VOIDED runs it is the frozen snapshot verbatim — nothing here recomputes pay.
 * The only client islands are the override pencils (OverrideEditor via
 * sheet-shared's Override) and the bonus-panel GoalsEditor, both rendered ONLY
 * when the run is open + the viewer is an admin.
 *
 * Provenance treatment: every Tekmetric-derived number goes through AutoValue
 * (indigo chip, source tooltip, overridden badge); hand-keyed and pay-config
 * numbers are plain ink. Bonus panels live in SheetBonusPanels.tsx (file-size
 * policy split).
 */
import { fmtUsd } from "@/lib/format";
import type { RunSnapshot, SheetComputation, SnapshotEmployee } from "@/lib/payroll/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AutoValue,
  FAMILY_LABEL,
  fmtHours,
  LEAVE_RATE_SOURCE_LABEL,
  NA,
  ProvenanceLegend,
  readLeaveRateProvenance,
  readMonthProvenance,
  ROLE_LABEL,
} from "../../payroll-ui";
import { Override, pcNum, type SheetCtx } from "./sheet-shared";
import {
  BonusMonthCard,
  ForemanBonusPanel,
  OfficeManagerBonusPanel,
  ServiceAdvisorBonusPanel,
} from "./SheetBonusPanels";

// ── Small presentational bits ──────────────────────────────────────────────────

function RollupRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function Rollup({ children, totalCents }: { children: React.ReactNode; totalCents: number }) {
  return (
    <dl className="rounded-lg border border-border bg-muted/30 p-3">
      {children}
      <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-border pt-1.5">
        <dt className="text-sm font-semibold text-foreground">Total pay</dt>
        <dd className="text-lg font-bold tabular-nums text-foreground">{fmtUsd(totalCents)}</dd>
      </div>
    </dl>
  );
}

/** "8.0 hrs · $208.00" — or hours-only for salaried families. */
function leaveCell(hours: number, payCents: number | null): React.ReactNode {
  if (hours === 0) return <NA title="No hours entered" />;
  return (
    <>
      {fmtHours(hours)} hrs{payCents !== null && <> · {fmtUsd(payCents)}</>}
    </>
  );
}

function MetricTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base font-bold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

/** W1/W2 hours mini-table (clock always; billed/efficiency for tech families). */
function WeekTable({ ctx, tech }: { ctx: SheetCtx; tech: boolean }) {
  const { e } = ctx;
  const s = e.sheet;
  const rows: {
    label: string;
    render: (wk: 1 | 2) => React.ReactNode;
  }[] = [
    {
      label: "Clock hours",
      render: (wk) => {
        const v = wk === 1 ? e.entries.clock_hours_w1 : e.entries.clock_hours_w2;
        return <span className="tabular-nums">{v == null ? "—" : fmtHours(v)}</span>;
      },
    },
    {
      label: "OT hours (auto)",
      render: (wk) => (
        <AutoValue
          source="Auto: clock hours over 40 this week"
          label={`${e.display_name} week ${wk} overtime hours`}
          valueText={fmtHours((wk === 1 ? s.week1 : s.week2).ot_hours)}
        >
          {fmtHours((wk === 1 ? s.week1 : s.week2).ot_hours)}
        </AutoValue>
      ),
    },
  ];
  if (tech) {
    rows.push(
      {
        label: "Billed hours",
        render: (wk) => {
          const billed = wk === 1 ? e.derived.billed_hours_w1 : e.derived.billed_hours_w2;
          const ov = wk === 1 ? e.overrides.billed_hours_w1 : e.overrides.billed_hours_w2;
          return (
            <span className="inline-flex items-center gap-0.5">
              {billed == null ? (
                <NA title="No Tekmetric technician id linked" />
              ) : (
                <AutoValue
                  source={`From Tekmetric — labor lines posted week ${wk} of this period`}
                  label={`${e.display_name} week ${wk} billed hours`}
                  valueText={fmtHours(billed)}
                  overridden={ov !== undefined}
                  overrideNote={ov?.note}
                >
                  {fmtHours(billed)}
                </AutoValue>
              )}
              <Override
                ctx={ctx}
                overrideKey={wk === 1 ? "billed_hours_w1" : "billed_hours_w2"}
                label={`billed hours, week ${wk}`}
                unit="hours"
                autoDisplay={billed == null ? undefined : fmtHours(billed)}
              />
            </span>
          );
        },
      },
      {
        label: "Efficiency hours",
        render: (wk) => {
          const v = (wk === 1 ? s.week1 : s.week2).efficiency_hours;
          return v == null ? (
            <NA title="No efficiency component for this week" />
          ) : (
            <AutoValue
              source="Derived — billed hours beyond clocked hours"
              label={`${e.display_name} week ${wk} efficiency hours`}
              valueText={fmtHours(v)}
            >
              {fmtHours(v)}
            </AutoValue>
          );
        },
      },
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
          <th scope="col" className="py-1.5 text-left font-medium">&nbsp;</th>
          <th scope="col" className="py-1.5 text-right font-medium">Week 1</th>
          <th scope="col" className="py-1.5 text-right font-medium">Week 2</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-border/50 last:border-0">
            <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">
              {r.label}
            </th>
            <td className="py-1.5 text-right">{r.render(1)}</td>
            <td className="py-1.5 text-right">{r.render(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Leave pay rows shared by every rollup (hours-only when pay is null/salaried). */
function LeaveRows({ s }: { s: SheetComputation }) {
  return (
    <>
      <RollupRow label="PTO">{leaveCell(s.pto_hours, s.pto_pay_cents)}</RollupRow>
      <RollupRow label="Training">{leaveCell(s.training_hours, s.training_pay_cents)}</RollupRow>
      <RollupRow label="Holiday">{leaveCell(s.holiday_hours, s.holiday_pay_cents)}</RollupRow>
      <RollupRow label="Bereavement">{leaveCell(s.bereavement_hours, s.bereavement_pay_cents)}</RollupRow>
    </>
  );
}

function LeaveRateLine({ ctx }: { ctx: SheetCtx }) {
  const s = ctx.e.sheet;
  if (s.leave_rate_cents_per_hour === null || s.leave_rate_source === null) return null;
  const ov = ctx.e.overrides.leave_rate_cents_per_hour;
  const windowNote =
    ctx.leaveProv && s.leave_rate_source === "history"
      ? ` (${ctx.leaveProv.windowRuns ?? "?"} runs${ctx.leaveProv.seededEntries ? `, ${ctx.leaveProv.seededEntries} seeded` : ""})`
      : "";
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      PTO/Holiday/Bereavement paid at
      <AutoValue
        source={`Leave rate basis: ${LEAVE_RATE_SOURCE_LABEL[s.leave_rate_source]}${windowNote}`}
        label={`${ctx.e.display_name} leave rate`}
        valueText={`${fmtUsd(s.leave_rate_cents_per_hour)} per hour`}
        overridden={ov !== undefined}
        overrideNote={ov?.note}
      >
        {fmtUsd(s.leave_rate_cents_per_hour)}/hr
      </AutoValue>
      <span>
        — {LEAVE_RATE_SOURCE_LABEL[s.leave_rate_source]}
        {windowNote}. Training pays the base rate.
      </span>
      <Override
        ctx={ctx}
        overrideKey="leave_rate_cents_per_hour"
        label="leave rate ($/hr)"
        unit="usd"
        autoDisplay={`${fmtUsd(s.leave_rate_cents_per_hour)}/hr`}
      />
    </p>
  );
}

// ── Per-family sheet cards ─────────────────────────────────────────────────────

function TechnicianSheet({ ctx }: { ctx: SheetCtx }) {
  const s = ctx.e.sheet;
  const billedPay =
    s.week1.billed_pay_cents === null && s.week2.billed_pay_cents === null
      ? null
      : (s.week1.billed_pay_cents ?? 0) + (s.week2.billed_pay_cents ?? 0);
  const effPay =
    s.week1.efficiency_pay_cents === null && s.week2.efficiency_pay_cents === null
      ? null
      : (s.week1.efficiency_pay_cents ?? 0) + (s.week2.efficiency_pay_cents ?? 0);
  const m = s.metrics;
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
      <div>
        <WeekTable ctx={ctx} tech />
        <LeaveRateLine ctx={ctx} />
        {(m.pay_per_clock_hour_cents !== null ||
          m.cost_per_billed_hour_cents !== null ||
          m.productivity !== null) && (
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <MetricTile
              label="Pay / clock hr"
              value={m.pay_per_clock_hour_cents === null ? "—" : fmtUsd(m.pay_per_clock_hour_cents)}
            />
            <MetricTile
              label="Cost / billed hr"
              value={m.cost_per_billed_hour_cents === null ? "—" : fmtUsd(m.cost_per_billed_hour_cents)}
            />
            <MetricTile
              label="Productivity"
              value={m.productivity === null ? "—" : `${Math.round(m.productivity * 100)}%`}
            />
          </dl>
        )}
      </div>
      <Rollup totalCents={s.total_pay_cents}>
        <RollupRow label={`Reg pay (${fmtHours(s.reg_hours)} hrs)`}>
          {fmtUsd(s.week1.base_pay_cents + s.week2.base_pay_cents)}
        </RollupRow>
        <RollupRow label={`OT pay (${fmtHours(s.ot_hours)} hrs)`}>
          {fmtUsd(s.week1.ot_pay_cents + s.week2.ot_pay_cents)}
        </RollupRow>
        <RollupRow
          label={`Billed pay${s.billed_hours_total !== null ? ` (${fmtHours(s.billed_hours_total)} hrs)` : ""}`}
        >
          {billedPay === null ? <NA /> : fmtUsd(billedPay)}
        </RollupRow>
        <RollupRow label="Efficiency pay">{effPay === null ? <NA /> : fmtUsd(effPay)}</RollupRow>
        <LeaveRows s={s} />
        {ctx.e.family === "shop_foreman" && s.bonus_cents !== null && (
          <RollupRow label="Shop-hours bonus">{fmtUsd(s.bonus_cents)}</RollupRow>
        )}
      </Rollup>
    </div>
  );
}

function ServiceAdvisorSheet({ ctx }: { ctx: SheetCtx }) {
  const s = ctx.e.sheet;
  const weeklySalary = pcNum(ctx.e.pay_config, "weekly_salary_cents");
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
      <div>
        <WeekTable ctx={ctx} tech={false} />
        <p className="mt-2 text-xs text-muted-foreground">
          Salaried — clock and leave hours are tracked; PTO/Holiday/Bereavement are hours-only.
        </p>
      </div>
      <Rollup totalCents={s.total_pay_cents}>
        <RollupRow label={`Salary (2 weeks${weeklySalary !== null ? ` × ${fmtUsd(weeklySalary)}` : ""})`}>
          {fmtUsd(s.reg_total_cents)}
        </RollupRow>
        <LeaveRows s={s} />
        {s.bonus_cents !== null && <RollupRow label="GP-tier bonus">{fmtUsd(s.bonus_cents)}</RollupRow>}
        {s.spiff_cents !== null && <RollupRow label="Spiffs">{fmtUsd(s.spiff_cents)}</RollupRow>}
      </Rollup>
    </div>
  );
}

function HourlySheet({ ctx }: { ctx: SheetCtx }) {
  const s = ctx.e.sheet;
  const isSupport = ctx.e.family === "support";
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_18rem]">
      <div>
        <WeekTable ctx={ctx} tech={false} />
      </div>
      <Rollup totalCents={s.total_pay_cents}>
        <RollupRow label={`Reg pay (${fmtHours(s.reg_hours)} hrs)`}>
          {fmtUsd(s.week1.base_pay_cents + s.week2.base_pay_cents)}
        </RollupRow>
        <RollupRow label={`OT pay (${fmtHours(s.ot_hours)} hrs)`}>
          {fmtUsd(s.week1.ot_pay_cents + s.week2.ot_pay_cents)}
        </RollupRow>
        <LeaveRows s={s} />
        {isSupport && (
          <RollupRow label="Manual incentive">
            {s.manual_incentive_cents === null ? (
              <NA title="No incentive entered" />
            ) : (
              fmtUsd(s.manual_incentive_cents)
            )}
          </RollupRow>
        )}
        {!isSupport && s.bonus_cents !== null && (
          <RollupRow label="Sales bonus">{fmtUsd(s.bonus_cents)}</RollupRow>
        )}
      </Rollup>
    </div>
  );
}

function EmployeeSheetCard({ ctx }: { ctx: SheetCtx }) {
  const { e, bonusOn } = ctx;
  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {e.display_name}
          <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
            {ROLE_LABEL[e.role]}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{FAMILY_LABEL[e.family]}</p>
      </CardHeader>
      <CardContent>
        {(e.family === "technician" || e.family === "shop_foreman") && <TechnicianSheet ctx={ctx} />}
        {e.family === "service_advisor" && <ServiceAdvisorSheet ctx={ctx} />}
        {(e.family === "office_manager" || e.family === "support") && <HourlySheet ctx={ctx} />}

        {bonusOn && e.family === "service_advisor" && <ServiceAdvisorBonusPanel ctx={ctx} />}
        {bonusOn && e.family === "office_manager" && <OfficeManagerBonusPanel ctx={ctx} />}
        {bonusOn && e.family === "shop_foreman" && <ForemanBonusPanel ctx={ctx} />}
      </CardContent>
    </Card>
  );
}

// ── The tab ────────────────────────────────────────────────────────────────────

export function SheetsView({
  snapshot,
  entryIdByEmployee,
  editable,
}: {
  snapshot: RunSnapshot;
  /** run_employee row id per employee_id — the override/goal write target. */
  entryIdByEmployee: Record<string, string>;
  /** Open run + admin viewer. */
  editable: boolean;
}) {
  const monthProv = readMonthProvenance(snapshot.derived_provenance);
  const bonusOn = snapshot.run.bonus_period;
  return (
    <div className="space-y-6">
      <ProvenanceLegend />
      {bonusOn && snapshot.run.bonus_month && (
        <BonusMonthCard month={snapshot.run.bonus_month} prov={monthProv} />
      )}
      {snapshot.employees.map((e: SnapshotEmployee) => (
        <EmployeeSheetCard
          key={e.employee_id}
          ctx={{
            e,
            entryId: entryIdByEmployee[e.employee_id] ?? null,
            editable,
            bonusOn,
            bonusMonth: snapshot.run.bonus_month,
            monthProv,
            leaveProv: readLeaveRateProvenance(snapshot.derived_provenance, e.employee_id),
          }}
        />
      ))}
    </div>
  );
}
