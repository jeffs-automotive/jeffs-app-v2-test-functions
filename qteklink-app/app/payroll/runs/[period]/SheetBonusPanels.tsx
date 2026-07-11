/**
 * SheetBonusPanels — the per-family bonus panels + the run-level bonus-month
 * card (design spec §3b "Bonus panel"), split out of SheetsView for the
 * ~500-line file policy. Server components; every number is the DAL's
 * (snapshot) value — the ✓/– "beat" lines are display comparisons of two
 * server numbers, never recomputed pay. Prior-month auto figures render
 * through AutoValue with per-employee override pencils; the per-run editable
 * goals write through to the employee record via GoalsEditor (the helper text
 * says so).
 */
import { CheckCircle2, Minus } from "lucide-react";
import { fmtUsd, fmtUsdSigned } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AutoValue,
  fmtHours,
  monthLabel,
  NA,
  type MonthProvenanceView,
} from "../../payroll-ui";
import { GoalsEditor } from "./GoalsEditor";
import type { OverrideKey } from "./OverrideEditor";
import { Override, pcNum, type SheetCtx } from "./sheet-shared";

// ── Atoms ──────────────────────────────────────────────────────────────────────

/** ✓ / – comparison line inside a bonus panel (display of two server numbers). */
function BeatLine({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <p
      className={`flex items-center gap-1.5 text-xs ${met ? "text-emerald-800 dark:text-emerald-300" : "text-muted-foreground"}`}
    >
      {met ? (
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Minus className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      {children}
    </p>
  );
}

function BonusPanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-semibold text-primary">{title}</p>
      {children}
    </div>
  );
}

function AutoMoney({
  ctx,
  label,
  cents,
  overrideKey,
  source,
  allowNegative = false,
}: {
  ctx: SheetCtx;
  label: string;
  cents: number | null | undefined;
  overrideKey: OverrideKey;
  source: string;
  allowNegative?: boolean;
}) {
  const ov = ctx.e.overrides[overrideKey];
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-muted-foreground" title={label}>
        {label}
      </dt>
      <dd className="mt-0.5 inline-flex items-center gap-0.5">
        {cents == null ? (
          <NA title="Not derived — no data" />
        ) : (
          <AutoValue
            source={source}
            label={label}
            valueText={fmtUsdSigned(cents)}
            overridden={ov !== undefined}
            overrideNote={ov?.note}
            className="text-sm font-semibold"
          >
            {fmtUsdSigned(cents)}
          </AutoValue>
        )}
        <Override
          ctx={ctx}
          overrideKey={overrideKey}
          label={label}
          unit="usd"
          allowNegative={allowNegative}
          autoDisplay={cents == null ? undefined : fmtUsdSigned(cents)}
        />
      </dd>
    </div>
  );
}

function GoalsList({
  ctx,
  items,
}: {
  ctx: SheetCtx;
  items: { label: string; value: React.ReactNode }[];
}) {
  return (
    <div className="mt-3 border-t border-primary/20 pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Goals (editable this run — saved back to the employee record)
      </p>
      <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {items.map((g) => (
          <div key={g.label} className="flex items-baseline gap-1.5">
            <dt className="text-muted-foreground">{g.label}</dt>
            <dd className="font-medium tabular-nums text-foreground">{g.value}</dd>
          </div>
        ))}
      </dl>
      {ctx.editable && ctx.entryId !== null && (
        <div className="mt-2">
          <GoalsEditor
            entryId={ctx.entryId}
            displayName={ctx.e.display_name}
            family={ctx.e.family}
            payConfig={ctx.e.pay_config}
          />
        </div>
      )}
    </div>
  );
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 10000) / 100}%`;
}

/** Round-5 #36: the month-sales definition wording (after fees). */
const MONTH_SALES_SOURCE =
  "From Tekmetric — repair orders posted in the bonus month, totals minus taxes and fees";

/** Round-5 #38: GP-with-fees provenance per composition source (pre-#38
 *  snapshots have no source label and keep the legacy prorated-labor wording). */
function gpWithFeesSource(gpSource: string | null): string {
  if (gpSource === "qbo_tech_cost") {
    return "Derived — Tekmetric − QuickBooks tech cost: month sales (incl. fees) − parts cost − QuickBooks 6010 technician cost";
  }
  if (gpSource === "computed") {
    return "Derived — computed fallback (QuickBooks was unavailable): month sales (incl. fees) − parts cost − prorated labor pay";
  }
  return "Derived — month sales − parts cost − prorated labor pay";
}

function ResultLine({ items }: { items: { label: string; cents: number | null }[] }) {
  return (
    <p className="mt-3 border-t border-primary/20 pt-3 text-sm">
      {items.map((i, idx) => (
        <span key={i.label} className={idx > 0 ? "ml-4" : undefined}>
          <span className="text-muted-foreground">{i.label}</span>{" "}
          <span className="text-lg font-bold tabular-nums text-foreground">
            {i.cents === null ? "—" : fmtUsd(i.cents)}
          </span>
        </span>
      ))}
    </p>
  );
}

// ── Run-level bonus-month card ─────────────────────────────────────────────────

export function BonusMonthCard({ month, prov }: { month: string; prov: MonthProvenanceView }) {
  const rows: { label: string; cents?: number | null; hours?: number | null; source: string }[] = [
    { label: "Month sales (less tax & fees)", cents: prov.salesCents, source: "From Tekmetric — repair orders posted in the month, totals minus taxes and fees" },
    { label: "GP with fees", cents: prov.gpWithFeesCents, source: gpWithFeesSource(prov.gpSource) },
    { label: "GP without fees", cents: prov.gpWithoutFeesCents, source: "Derived — GP with fees − shop fees" },
    { label: "Parts cost", cents: prov.partsCostCents, source: "From Tekmetric — authorized-job parts cost for the month (cost × qty, rounded per line) + sublets" },
    // #38: the tech-cost line itemizes with provenance when the QBO composition
    // ran; the prorated-labor line renders only for the computed path (incl.
    // pre-#38 snapshots, whose GP really was labor-prorated).
    ...(prov.gpSource === "qbo_tech_cost"
      ? [
          {
            label: "Technician cost (QBO 6010)",
            cents: prov.qboTechCostCents,
            source: `From QuickBooks — the P&L cost-of-goods row for account ${prov.qboTechCostAccount ?? "6010 Technicians"} over the bonus month`,
          },
        ]
      : [
          {
            label: "Labor pay (prorated)",
            cents: prov.laborPayProratedCents,
            source:
              "Derived — shop labor pay prorated across runs overlapping the month (the computed GP fallback)",
          },
        ]),
    { label: "Shop billed hours", hours: prov.shopHours, source: "From Tekmetric — all technician labor hours posted in the month" },
  ];
  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle className="text-primary">Bonus month — {monthLabel(month)}</CardTitle>
        <p className="text-sm text-muted-foreground">
          The month-level numbers every bonus below draws from
          {prov.roCount !== null && <> · {prov.roCount} repair orders</>}. Per-person overrides live
          on each pay sheet.
        </p>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rows.map((r) => (
            <div key={r.label} className="min-w-0">
              <dt className="truncate text-xs text-muted-foreground" title={r.label}>
                {r.label}
              </dt>
              <dd className="mt-0.5">
                {r.cents !== undefined ? (
                  r.cents !== null ? (
                    <AutoValue
                      source={r.source}
                      label={r.label}
                      valueText={fmtUsdSigned(r.cents)}
                      className="text-sm font-semibold"
                    >
                      {fmtUsdSigned(r.cents)}
                    </AutoValue>
                  ) : (
                    <NA title="Not derived for this run" />
                  )
                ) : r.hours != null ? (
                  <AutoValue
                    source={r.source}
                    label={r.label}
                    valueText={fmtHours(r.hours)}
                    className="text-sm font-semibold"
                  >
                    {fmtHours(r.hours)}
                  </AutoValue>
                ) : (
                  <NA title="Not derived for this run" />
                )}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Per-family panels ──────────────────────────────────────────────────────────

export function ServiceAdvisorBonusPanel({ ctx }: { ctx: SheetCtx }) {
  const { e, monthProv } = ctx;
  const s = e.sheet;
  const pc = e.pay_config;
  const salesGoal = e.derived.sales_goal_cents ?? pcNum(pc, "sales_goal_cents");
  const salesGoalSource =
    e.overrides.sales_goal_cents !== undefined
      ? "Manual override"
      : monthProv.salesGoalSource === "prior_year_subtotal"
        ? "Auto — prior-year same-month sales (less tax & fees)"
        : "From pay config — no prior-year Tekmetric data for the month";
  const sales = e.derived.month_sales_cents;
  const gpWith = e.derived.month_gp_with_fees_cents;
  const gpGoal1 = pcNum(pc, "gp_goal_1_cents");
  const gpGoal2 = pcNum(pc, "gp_goal_2_cents");
  const spiffAmount = pcNum(pc, "spiff_amount_cents");
  return (
    <BonusPanelShell
      title={`Bonus — ${ctx.bonusMonth ? `${monthLabel(ctx.bonusMonth)} numbers` : "prior-month numbers"}`}
    >
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <AutoMoney
          ctx={ctx}
          label="Month sales"
          cents={sales}
          overrideKey="month_sales_cents"
          source={MONTH_SALES_SOURCE}
        />
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">Sales goal</dt>
          <dd className="mt-0.5 inline-flex items-center gap-0.5">
            {salesGoal == null ? (
              <NA title="No sales goal available" />
            ) : (
              <AutoValue
                source={salesGoalSource}
                label={`${e.display_name} sales goal`}
                valueText={fmtUsd(salesGoal)}
                overridden={e.overrides.sales_goal_cents !== undefined}
                overrideNote={e.overrides.sales_goal_cents?.note}
                className="text-sm font-semibold"
              >
                {fmtUsd(salesGoal)}
              </AutoValue>
            )}
            <Override
              ctx={ctx}
              overrideKey="sales_goal_cents"
              label="sales goal"
              unit="usd"
              autoDisplay={salesGoal == null ? undefined : fmtUsd(salesGoal)}
            />
          </dd>
        </div>
        <AutoMoney
          ctx={ctx}
          label="GP with fees"
          cents={gpWith}
          overrideKey="month_gp_with_fees_cents"
          source={gpWithFeesSource(monthProv.gpSource)}
          allowNegative
        />
        <AutoMoney
          ctx={ctx}
          label="GP without fees"
          cents={e.derived.month_gp_without_fees_cents}
          overrideKey="month_gp_without_fees_cents"
          source="Derived — GP with fees − shop fees"
          allowNegative
        />
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">Spiffs (counted jobs)</dt>
          <dd className="mt-0.5 inline-flex items-center gap-0.5">
            {e.derived.spiff_count == null ? (
              <NA title="No Tekmetric service-writer id linked" />
            ) : (
              <AutoValue
                source="From Tekmetric — counted spiff-category jobs on this writer's ROs in the bonus month"
                label={`${e.display_name} counted spiff jobs`}
                valueText={String(e.derived.spiff_count)}
                overridden={e.overrides.spiff_count !== undefined}
                overrideNote={e.overrides.spiff_count?.note}
                className="text-sm font-semibold"
              >
                {e.derived.spiff_count}
              </AutoValue>
            )}
            <Override
              ctx={ctx}
              overrideKey="spiff_count"
              label="spiff count"
              unit="count"
              autoDisplay={e.derived.spiff_count == null ? undefined : String(e.derived.spiff_count)}
            />
            {spiffAmount !== null && (
              <span className="ml-1 text-xs text-muted-foreground">× {fmtUsd(spiffAmount)}</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-1">
        {sales != null && salesGoal != null && (
          <BeatLine met={sales > salesGoal}>
            Sales {fmtUsdSigned(sales)} vs goal {fmtUsd(salesGoal)}{" "}
            {sales > salesGoal ? "— beat" : "— not beat"}
          </BeatLine>
        )}
        {gpWith != null && gpGoal1 !== null && gpGoal2 !== null && (
          <BeatLine met={gpWith >= gpGoal1}>
            GP with fees {fmtUsdSigned(gpWith)} vs Goal 1 {fmtUsd(gpGoal1)} / Goal 2 {fmtUsd(gpGoal2)}
          </BeatLine>
        )}
      </div>

      <GoalsList
        ctx={ctx}
        items={[
          { label: "GP Goal 1", value: gpGoal1 === null ? "—" : fmtUsd(gpGoal1) },
          { label: "GP Goal 2", value: gpGoal2 === null ? "—" : fmtUsd(gpGoal2) },
          { label: "Tier 1", value: pct(pcNum(pc, "tier1_pct")) },
          { label: "Tier 2", value: pct(pcNum(pc, "tier2_pct")) },
          { label: "Tier 3", value: pct(pcNum(pc, "tier3_pct")) },
          { label: "Spiff amount", value: spiffAmount === null ? "—" : fmtUsd(spiffAmount) },
        ]}
      />

      <ResultLine
        items={[
          { label: "Bonus", cents: s.bonus_cents },
          { label: "Spiff", cents: s.spiff_cents },
        ]}
      />
    </BonusPanelShell>
  );
}

export function OfficeManagerBonusPanel({ ctx }: { ctx: SheetCtx }) {
  const { e } = ctx;
  const pc = e.pay_config;
  const salesGoal = pcNum(pc, "sales_goal_cents");
  const sales = e.derived.month_sales_cents;
  return (
    <BonusPanelShell title="Bonus — monthly sales over goal">
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <AutoMoney
          ctx={ctx}
          label="Month sales"
          cents={sales}
          overrideKey="month_sales_cents"
          source={MONTH_SALES_SOURCE}
        />
      </dl>
      {sales != null && salesGoal !== null && (
        <div className="mt-2">
          <BeatLine met={sales > salesGoal}>
            Sales {fmtUsdSigned(sales)} vs goal {fmtUsd(salesGoal)}
          </BeatLine>
        </div>
      )}
      <GoalsList
        ctx={ctx}
        items={[
          { label: "Sales goal", value: salesGoal === null ? "—" : fmtUsd(salesGoal) },
          { label: "Bonus %", value: pct(pcNum(pc, "bonus_pct")) },
        ]}
      />
      <ResultLine items={[{ label: "Bonus", cents: e.sheet.bonus_cents }]} />
    </BonusPanelShell>
  );
}

export function ForemanBonusPanel({ ctx }: { ctx: SheetCtx }) {
  const { e } = ctx;
  const pc = e.pay_config;
  const fallbackGoal = pcNum(pc, "shop_hour_goal");
  // Round-5 #32: the goal auto-derives from prior-year same-month shop hours
  // (override → prior-year → legacy pay_config fallback — the DAL resolved it;
  // this is display of the effective server number, never recomputed pay).
  const goal = e.derived.shop_hour_goal ?? e.sheet.shop_hour_goal ?? fallbackGoal;
  const goalOv = e.overrides.shop_hour_goal;
  const goalSource =
    e.derived.shop_hour_goal != null
      ? "Auto — total shop billed hours for the same month LAST YEAR (beat last year to earn the bonus)"
      : "From pay config — no prior-year Tekmetric data for the month";
  const perHour = pcNum(pc, "shop_hour_bonus_cents_per_hour");
  const shopHours = e.derived.shop_hours;
  const ov = e.overrides.shop_hours;
  return (
    <BonusPanelShell title="Bonus — shop hours over goal">
      <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">Shop billed hours</dt>
          <dd className="mt-0.5 inline-flex items-center gap-0.5">
            {shopHours == null ? (
              <NA title="Not derived — no data" />
            ) : (
              <AutoValue
                source="From Tekmetric — all technician labor hours posted in the bonus month"
                label={`${e.display_name} shop billed hours`}
                valueText={fmtHours(shopHours)}
                overridden={ov !== undefined}
                overrideNote={ov?.note}
                className="text-sm font-semibold"
              >
                {fmtHours(shopHours)}
              </AutoValue>
            )}
            <Override
              ctx={ctx}
              overrideKey="shop_hours"
              label="shop hours"
              unit="hours"
              autoDisplay={shopHours == null ? undefined : fmtHours(shopHours)}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted-foreground">Shop-hour goal (last year)</dt>
          <dd className="mt-0.5 inline-flex items-center gap-0.5">
            {goal == null ? (
              <NA title="No shop-hour goal available" />
            ) : (
              <AutoValue
                source={goalSource}
                label={`${e.display_name} shop-hour goal`}
                valueText={fmtHours(goal)}
                overridden={goalOv !== undefined}
                overrideNote={goalOv?.note}
                className="text-sm font-semibold"
              >
                {fmtHours(goal)}
              </AutoValue>
            )}
            <Override
              ctx={ctx}
              overrideKey="shop_hour_goal"
              label="shop-hour goal"
              unit="hours"
              autoDisplay={goal == null ? undefined : fmtHours(goal)}
            />
          </dd>
        </div>
      </dl>
      {shopHours != null && goal != null && (
        <div className="mt-2">
          <BeatLine met={shopHours > goal}>
            {fmtHours(shopHours)} hrs vs goal {fmtHours(goal)} hrs{" "}
            {shopHours > goal ? "— beat" : "— not beat"}
          </BeatLine>
        </div>
      )}
      <GoalsList
        ctx={ctx}
        items={[
          {
            label: "Fallback goal (pay config)",
            value: fallbackGoal === null ? "—" : `${fmtHours(fallbackGoal)} hrs`,
          },
          { label: "Per hour over goal", value: perHour === null ? "—" : `${fmtUsd(perHour)}/hr` },
        ]}
      />
      <ResultLine items={[{ label: "Bonus", cents: e.sheet.bonus_cents }]} />
    </BonusPanelShell>
  );
}
