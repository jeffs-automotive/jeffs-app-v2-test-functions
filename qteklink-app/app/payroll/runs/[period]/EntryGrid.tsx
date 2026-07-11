"use client";

/**
 * EntryGrid — the office manager's fast-entry surface for an OPEN run (design
 * spec §3a): one wide semantic table, sticky header + sticky-left name column,
 * a two-row (W1/W2) group per employee. Editable cells (clock, PTO, Holiday,
 * Bereavement, Training per week; manual incentive $ for support roles) are
 * plain inputs; auto cells (OT >40 derived, billed hours from Tekmetric) render
 * through AutoValue — read-only, with the billed-hours override pencil.
 *
 * NO client-side business math: every derived/total cell shows the SERVER'S
 * number (the snapshot computed on this request); a row save dispatches the
 * existing updatePayrollEntryAction with only the changed keys, then
 * router.refresh() re-renders the recomputed run. Rows are keyed on
 * entry.updatedAt so a refresh remounts them with fresh values.
 */
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { updatePayrollEntryAction } from "@/actions/payroll";
import type { PayrollRunEntry } from "@/lib/dal/payroll";
import type { SnapshotEmployee } from "@/lib/payroll/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoValue, fmtHours, NA, ProvenanceLegend, ROLE_LABEL } from "../../payroll-ui";
import { OverrideEditor } from "./OverrideEditor";

const HOUR_FIELDS = [
  { field: "clock", label: "Clock" },
  { field: "pto", label: "PTO" },
  { field: "holiday", label: "Holiday" },
  { field: "bereavement", label: "Bereave." },
  { field: "training", label: "Training" },
] as const;
type HourField = (typeof HOUR_FIELDS)[number]["field"];

type Week = 1 | 2;

function entryKeyFor(field: HourField, wk: Week): string {
  return field === "clock" ? `clock_hours_w${wk}` : `${field}_w${wk}`;
}

function hourValue(entry: PayrollRunEntry, field: HourField, wk: Week): number | null {
  const v = (entry.entries as Record<string, number | null | undefined>)[entryKeyFor(field, wk)];
  return v ?? null;
}

const TECH_FAMILIES = ["technician", "shop_foreman"] as const;
const thCls = "px-2 py-2 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap";
const numTh = `${thCls} text-right`;

export function EntryGrid({
  entries,
  computed,
  canEdit,
}: {
  entries: PayrollRunEntry[];
  /** snapshot.employees keyed by employee_id — the server-computed numbers. */
  computed: Record<string, SnapshotEmployee>;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-2">
      <ProvenanceLegend />
      <div className="overflow-x-auto rounded-lg border border-border shadow-xs">
        <table className="w-full caption-bottom text-sm">
          <thead className="sticky top-0 z-20 bg-muted">
            <tr className="border-b border-border">
              <th scope="col" className={`${thCls} sticky left-0 z-10 bg-muted shadow-[1px_0_0_var(--border)]`}>
                Employee
              </th>
              <th scope="col" className={thCls}>Wk</th>
              {HOUR_FIELDS.map((f) => (
                <th key={f.field} scope="col" className={numTh}>{f.label}</th>
              ))}
              <th scope="col" className={numTh}>OT (auto)</th>
              <th scope="col" className={numTh}>Billed (auto)</th>
              <th scope="col" className={numTh}>Week hrs</th>
              <th scope="col" className={numTh}>Incentive $</th>
              <th scope="col" className={thCls}>
                <span className="sr-only">Save</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <EntryRowGroup
                key={`${entry.id}:${entry.updatedAt}`}
                entry={entry}
                sheet={computed[entry.employeeId]}
                canEdit={canEdit}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntryRowGroup({
  entry,
  sheet,
  canEdit,
}: {
  entry: PayrollRunEntry;
  sheet: SnapshotEmployee | undefined;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const isSupport = entry.family === "support";
  const isTech = (TECH_FAMILIES as readonly string[]).includes(entry.family);

  // Local edit state (strings) initialized from the SERVER values; the row is
  // remounted (updatedAt key) after every save, so initial === server truth.
  const initial = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of HOUR_FIELDS) {
      for (const wk of [1, 2] as const) {
        const v = hourValue(entry, f.field, wk);
        map[entryKeyFor(f.field, wk)] = v === null ? "" : String(v);
      }
    }
    map.manual_incentive_cents =
      entry.entries.manual_incentive_cents == null
        ? ""
        : (entry.entries.manual_incentive_cents / 100).toFixed(2);
    return map;
  }, [entry]);
  const [values, setValues] = useState<Record<string, string>>(initial);

  const dirty = Object.keys(initial).some((k) => (values[k] ?? "") !== (initial[k] ?? ""));

  function setField(key: string, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function save() {
    const patch: Record<string, number | null> = {};
    for (const f of HOUR_FIELDS) {
      for (const wk of [1, 2] as const) {
        const key = entryKeyFor(f.field, wk);
        const cur = values[key] ?? "";
        if (cur === (initial[key] ?? "")) continue;
        if (cur.trim() === "") {
          patch[key] = null;
          continue;
        }
        const n = Number(cur);
        if (!Number.isFinite(n) || n < 0 || n > 120) {
          setMsg({ kind: "err", text: `${f.label} hours must be a number from 0 to 120.` });
          return;
        }
        patch[key] = Math.round(n * 100) / 100;
      }
    }
    const incCur = values.manual_incentive_cents ?? "";
    if (incCur !== (initial.manual_incentive_cents ?? "")) {
      if (incCur.trim() === "") {
        patch.manual_incentive_cents = null;
      } else {
        const n = Number(incCur);
        if (!Number.isFinite(n) || n < 0 || n > 50_000) {
          setMsg({ kind: "err", text: "Incentive must be a dollar amount from 0 to 50,000." });
          return;
        }
        patch.manual_incentive_cents = Math.round(n * 100);
      }
    }
    if (Object.keys(patch).length === 0) return;

    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_employee_id", entry.id);
      fd.set("patch", JSON.stringify(patch));
      const res = await updatePayrollEntryAction(null, fd);
      if (res.ok) {
        setMsg({ kind: "ok", text: "Saved." });
        router.refresh(); // server recomputes OT / totals; the row remounts fresh
      } else {
        setMsg({ kind: "err", text: res.message });
      }
    });
  }

  const weekRows = ([1, 2] as const).map((wk) => {
    const week = wk === 1 ? sheet?.sheet.week1 : sheet?.sheet.week2;
    const billed = wk === 1 ? sheet?.derived.billed_hours_w1 : sheet?.derived.billed_hours_w2;
    const billedOverride = wk === 1 ? entry.overrides.billed_hours_w1 : entry.overrides.billed_hours_w2;
    // Week total hrs = the SERVER-known entered hours for the week (clock + leave).
    const weekTotal = HOUR_FIELDS.reduce((sum, f) => sum + (hourValue(entry, f.field, wk) ?? 0), 0);
    return { wk, week, billed: billed ?? null, billedOverride, weekTotal };
  });

  return (
    <>
      {weekRows.map(({ wk, week, billed, billedOverride, weekTotal }) => (
        <tr
          key={wk}
          className={`transition-colors hover:bg-muted/50 ${wk === 1 ? "border-t-2 border-border" : "border-b border-border/50"}`}
        >
          {wk === 1 && (
            <th
              scope="row"
              rowSpan={2}
              className="sticky left-0 z-10 bg-card px-3 py-2 text-left align-top shadow-[1px_0_0_var(--border)]"
            >
              <span className="block text-sm font-medium text-foreground">{entry.displayName}</span>
              <Badge variant="outline" className="mt-1 text-muted-foreground">
                {ROLE_LABEL[entry.roleSnapshot]}
              </Badge>
            </th>
          )}
          <td className="px-2 py-2 text-xs text-muted-foreground">W{wk}</td>
          {HOUR_FIELDS.map((f) => {
            const key = entryKeyFor(f.field, wk);
            return (
              <td key={key} className="px-2 py-2 text-right">
                {canEdit ? (
                  <Input
                    value={values[key] ?? ""}
                    onChange={(e) => setField(key, e.target.value)}
                    inputMode="decimal"
                    placeholder="0.0"
                    className="h-8 w-16 text-right tabular-nums"
                    aria-label={`${entry.displayName} week ${wk} ${f.label.toLowerCase().replace(".", "")} hours`}
                    disabled={pending}
                  />
                ) : (
                  <span className="tabular-nums">{fmtHours(hourValue(entry, f.field, wk) ?? 0)}</span>
                )}
              </td>
            );
          })}
          <td className="px-2 py-2 text-right">
            {week ? (
              <AutoValue
                source="Auto: clock hours over 40 this week"
                label={`${entry.displayName} week ${wk} overtime hours`}
                valueText={fmtHours(week.ot_hours)}
              >
                {fmtHours(week.ot_hours)}
              </AutoValue>
            ) : (
              <NA title="Computed after save" />
            )}
          </td>
          <td className="px-2 py-2 text-right">
            {isTech ? (
              <span className="inline-flex items-center gap-0.5">
                {billed !== null ? (
                  <AutoValue
                    source={`From Tekmetric — labor lines posted week ${wk} of this period`}
                    label={`${entry.displayName} week ${wk} billed hours`}
                    valueText={fmtHours(billed)}
                    overridden={billedOverride !== undefined}
                    overrideNote={billedOverride?.note}
                  >
                    {fmtHours(billed)}
                  </AutoValue>
                ) : (
                  <NA title="No Tekmetric technician id linked" />
                )}
                {canEdit && (
                  <OverrideEditor
                    entryId={entry.id}
                    overrides={entry.overrides}
                    overrideKey={wk === 1 ? "billed_hours_w1" : "billed_hours_w2"}
                    label={`${entry.displayName} billed hours, week ${wk}`}
                    unit="hours"
                    autoDisplay={billed !== null ? fmtHours(billed) : undefined}
                  />
                )}
              </span>
            ) : (
              <NA />
            )}
          </td>
          <td className="px-2 py-2 text-right font-semibold tabular-nums">{fmtHours(weekTotal)}</td>
          {wk === 1 && (
            <td rowSpan={2} className="px-2 py-2 text-right align-middle">
              {isSupport ? (
                canEdit ? (
                  <Input
                    value={values.manual_incentive_cents ?? ""}
                    onChange={(e) => setField("manual_incentive_cents", e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="h-8 w-20 text-right tabular-nums"
                    aria-label={`${entry.displayName} manual incentive dollars`}
                    disabled={pending}
                  />
                ) : entry.entries.manual_incentive_cents == null ? (
                  <NA title="No incentive entered" />
                ) : (
                  <span className="tabular-nums">
                    ${(entry.entries.manual_incentive_cents / 100).toFixed(2)}
                  </span>
                )
              ) : (
                <NA title="Manual incentive applies to support roles only" />
              )}
            </td>
          )}
          {wk === 1 && (
            <td rowSpan={2} className="px-2 py-2 align-middle">
              {canEdit && (
                <div className="flex flex-col items-start gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={dirty ? "default" : "outline"}
                    disabled={!dirty || pending}
                    loading={pending}
                    loadingText="Saving…"
                    onClick={save}
                  >
                    <Save aria-hidden="true" />
                    Save
                  </Button>
                  {msg && (
                    <span
                      className={`max-w-40 text-xs ${msg.kind === "ok" ? "text-emerald-800 dark:text-emerald-300" : "text-red-700 dark:text-red-400"}`}
                    >
                      {msg.text}
                    </span>
                  )}
                </div>
              )}
            </td>
          )}
        </tr>
      ))}
    </>
  );
}
