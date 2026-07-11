/**
 * EntryGridReadOnly — the entry grid's archival presentation for COMPLETED /
 * VOIDED runs (design spec §Locked state): the same columns as the live grid
 * but every value is a static span rendered FROM THE FROZEN SNAPSHOT (never
 * the live entry rows, never recomputed). No inputs, no pencils — the
 * provenance chips stay (informational), the affordances are gone.
 */
import type { RunSnapshot } from "@/lib/payroll/types";
import { Badge } from "@/components/ui/badge";
import { AutoValue, fmtHours, NA, ProvenanceLegend, ROLE_LABEL } from "../../payroll-ui";
import { fmtUsd } from "@/lib/format";

const thCls =
  "px-2 py-2 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap";
const numTh = `${thCls} text-right`;
const numTd = "px-2 py-2 text-right tabular-nums";

const HOUR_COLS = [
  { label: "Clock", keys: ["clock_hours_w1", "clock_hours_w2"] },
  { label: "PTO", keys: ["pto_w1", "pto_w2"] },
  { label: "Holiday", keys: ["holiday_w1", "holiday_w2"] },
  { label: "Bereave.", keys: ["bereavement_w1", "bereavement_w2"] },
  { label: "Training", keys: ["training_w1", "training_w2"] },
] as const;

export function EntryGridReadOnly({ snapshot }: { snapshot: RunSnapshot }) {
  return (
    <div className="space-y-2">
      <ProvenanceLegend />
      <div className="overflow-x-auto rounded-lg border border-border shadow-xs">
        <table className="w-full caption-bottom text-sm">
        <thead className="bg-muted">
          <tr className="border-b border-border">
            <th scope="col" className={`${thCls} sticky left-0 z-10 bg-muted shadow-[1px_0_0_var(--border)]`}>
              Employee
            </th>
            <th scope="col" className={thCls}>Wk</th>
            {HOUR_COLS.map((c) => (
              <th key={c.label} scope="col" className={numTh}>{c.label}</th>
            ))}
            <th scope="col" className={numTh}>OT (auto)</th>
            <th scope="col" className={numTh}>Billed (auto)</th>
            <th scope="col" className={numTh}>Incentive $</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.employees.map((e) => {
            const entries = e.entries as Record<string, number | null | undefined>;
            const isTech = e.family === "technician" || e.family === "shop_foreman";
            return ([1, 2] as const).map((wk) => {
              const week = wk === 1 ? e.sheet.week1 : e.sheet.week2;
              const billed = wk === 1 ? e.derived.billed_hours_w1 : e.derived.billed_hours_w2;
              const billedOv = wk === 1 ? e.overrides.billed_hours_w1 : e.overrides.billed_hours_w2;
              return (
                <tr
                  key={`${e.employee_id}-${wk}`}
                  className={wk === 1 ? "border-t-2 border-border" : "border-b border-border/50"}
                >
                  {wk === 1 && (
                    <th
                      scope="row"
                      rowSpan={2}
                      className="sticky left-0 z-10 bg-card px-3 py-2 text-left align-top shadow-[1px_0_0_var(--border)]"
                    >
                      <span className="block text-sm font-medium text-foreground">{e.display_name}</span>
                      <Badge variant="outline" className="mt-1 text-muted-foreground">
                        {ROLE_LABEL[e.role]}
                      </Badge>
                    </th>
                  )}
                  <td className="px-2 py-2 text-xs text-muted-foreground">W{wk}</td>
                  {HOUR_COLS.map((c) => {
                    const v = entries[c.keys[wk - 1] ?? ""] ?? null;
                    return (
                      <td key={c.label} className={numTd}>
                        {v === null ? <NA title="No hours entered" /> : fmtHours(v)}
                      </td>
                    );
                  })}
                  <td className={numTd}>
                    <AutoValue
                      source="Auto: clock hours over 40 this week"
                      label={`${e.display_name} week ${wk} overtime hours`}
                      valueText={fmtHours(week.ot_hours)}
                    >
                      {fmtHours(week.ot_hours)}
                    </AutoValue>
                  </td>
                  <td className={numTd}>
                    {isTech ? (
                      billed == null ? (
                        <NA title="No Tekmetric technician id linked" />
                      ) : (
                        <AutoValue
                          source={`From Tekmetric — labor lines posted week ${wk} of this period`}
                          label={`${e.display_name} week ${wk} billed hours`}
                          valueText={fmtHours(billed)}
                          overridden={billedOv !== undefined}
                          overrideNote={billedOv?.note}
                        >
                          {fmtHours(billed)}
                        </AutoValue>
                      )
                    ) : (
                      <NA />
                    )}
                  </td>
                  {wk === 1 && (
                    <td rowSpan={2} className={`${numTd} align-middle`}>
                      {e.family === "support" ? (
                        e.entries.manual_incentive_cents == null ? (
                          <NA title="No incentive entered" />
                        ) : (
                          fmtUsd(e.entries.manual_incentive_cents)
                        )
                      ) : (
                        <NA title="Manual incentive applies to support roles only" />
                      )}
                    </td>
                  )}
                </tr>
              );
            });
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
}
