"use client";

/**
 * EntryGrid — the office manager's fast-entry surface for an OPEN run (design
 * spec §3a): one wide semantic table, sticky header + sticky-left name column,
 * a two-row (W1/W2) group per employee. Editable cells (clock, PTO, Holiday,
 * Bereavement, Training per week; manual incentive $ for support roles) are
 * plain inputs; auto cells (OT >40 derived, billed hours from Tekmetric) render
 * through AutoValue — read-only, with the billed-hours override pencil.
 *
 * ROUND-8 #43 — ONE SAVE BUTTON: cells edit LOCAL state; the grid tracks dirty
 * cells (edited value ≠ the server's) and a single sticky footer Save submits
 * ALL of them as ONE ATOMIC batch (updatePayrollEntriesAction →
 * qteklink_payroll_update_entries: one transaction, changed-keys-only patches
 * per row). On success the dirty state clears and router.refresh() re-renders
 * the recomputed run (ONE recompute server-side). On failure NOTHING was
 * applied (atomic), so ALL dirty state is kept and the error shows in the
 * footer bar. Dirty cells get an amber ring + the footer counts them; three
 * leave guards cover unsaved edits: a beforeunload guard (hard unloads), the
 * RunViewTabs tab-switch confirm (via the unsaved-entries registry), and
 * useUnsavedNavGuard (in-app next/link soft navigations, which fire NEITHER
 * of the other two).
 *
 * NO client-side business math: every derived/total cell shows the SERVER'S
 * number (the snapshot computed on this request); only the per-cell RANGE
 * validation (0–120 hours; $0–50,000 incentive) runs locally, at save time.
 */
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { updatePayrollEntriesAction } from "@/actions/payroll";
import type { PayrollRunEntry } from "@/lib/dal/payroll";
import type { SnapshotEmployee } from "@/lib/payroll/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoValue, fmtHours, NA, ProvenanceLegend, ROLE_LABEL } from "../../payroll-ui";
import { OverrideEditor } from "./OverrideEditor";
import { setUnsavedEntryCount } from "./unsaved-entries";
import { useUnsavedNavGuard } from "./use-unsaved-nav-guard";

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

/** Grid-wide cell address: entry id + patch key (a space appears in neither). */
function cellKey(entryId: string, key: string): string {
  return `${entryId} ${key}`;
}

const TECH_FAMILIES = ["technician", "shop_foreman"] as const;
const thCls = "px-2 py-2 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground whitespace-nowrap";
const numTh = `${thCls} text-right`;
const dirtyCls =
  "border-amber-500 bg-amber-50 ring-1 ring-amber-500/60 dark:border-amber-400 dark:bg-amber-950/40";

export function EntryGrid({
  runId,
  entries,
  computed,
  canEdit,
}: {
  runId: string;
  entries: PayrollRunEntry[];
  /** snapshot.employees keyed by employee_id — the server-computed numbers. */
  computed: Record<string, SnapshotEmployee>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // ONLY the touched cells live here (raw input strings); everything else
  // renders the server value. A cell edited BACK to the server value stops
  // counting as dirty (the comparison below), so no reset bookkeeping.
  const [edits, setEdits] = useState<Record<string, string>>({});

  // The server truth per editable cell, as the input strings the cells render.
  const serverValues = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of entries) {
      for (const f of HOUR_FIELDS) {
        for (const wk of [1, 2] as const) {
          const v = hourValue(entry, f.field, wk);
          map[cellKey(entry.id, entryKeyFor(f.field, wk))] = v === null ? "" : String(v);
        }
      }
      map[cellKey(entry.id, "manual_incentive_cents")] =
        entry.entries.manual_incentive_cents == null
          ? ""
          : (entry.entries.manual_incentive_cents / 100).toFixed(2);
    }
    return map;
  }, [entries]);

  const dirtyKeys = useMemo(
    () => Object.keys(edits).filter((k) => (edits[k] ?? "") !== (serverValues[k] ?? "")),
    [edits, serverValues],
  );
  const dirtyCount = dirtyKeys.length;
  const dirtySet = useMemo(() => new Set(dirtyKeys), [dirtyKeys]);

  // ── Leave guards (#43): the tab-switch registry + beforeunload + soft-nav ──
  useEffect(() => {
    setUnsavedEntryCount(dirtyCount);
    return () => setUnsavedEntryCount(0);
  }, [dirtyCount]);
  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // legacy engines need a non-undefined returnValue
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);
  // In-app next/link navigations are App Router SOFT navs — no beforeunload,
  // no cancelable route event — so a dirty grid would unmount and silently
  // drop typed hours without this click-capture guard.
  useUnsavedNavGuard(dirtyCount > 0);

  function valueFor(entryId: string, key: string): string {
    const k = cellKey(entryId, key);
    return edits[k] ?? serverValues[k] ?? "";
  }
  function isDirty(entryId: string, key: string): boolean {
    return dirtySet.has(cellKey(entryId, key));
  }
  function setField(entryId: string, key: string, v: string) {
    setEdits((prev) => ({ ...prev, [cellKey(entryId, key)]: v }));
  }

  /** Build the changed-keys-only batch; null = a local validation error was shown. */
  function buildPatches(): { run_employee_id: string; patch: Record<string, number | null> }[] | null {
    const patches: { run_employee_id: string; patch: Record<string, number | null> }[] = [];
    for (const entry of entries) {
      const patch: Record<string, number | null> = {};
      for (const f of HOUR_FIELDS) {
        for (const wk of [1, 2] as const) {
          const key = entryKeyFor(f.field, wk);
          if (!isDirty(entry.id, key)) continue;
          const cur = valueFor(entry.id, key);
          if (cur.trim() === "") {
            patch[key] = null;
            continue;
          }
          const n = Number(cur);
          if (!Number.isFinite(n) || n < 0 || n > 120) {
            setMsg({
              kind: "err",
              text: `${entry.displayName} — ${f.label} hours must be a number from 0 to 120.`,
            });
            return null;
          }
          patch[key] = Math.round(n * 100) / 100;
        }
      }
      if (isDirty(entry.id, "manual_incentive_cents")) {
        const incCur = valueFor(entry.id, "manual_incentive_cents");
        if (incCur.trim() === "") {
          patch.manual_incentive_cents = null;
        } else {
          const n = Number(incCur);
          if (!Number.isFinite(n) || n < 0 || n > 50_000) {
            setMsg({
              kind: "err",
              text: `${entry.displayName} — Incentive must be a dollar amount from 0 to 50,000.`,
            });
            return null;
          }
          patch.manual_incentive_cents = Math.round(n * 100);
        }
      }
      if (Object.keys(patch).length > 0) {
        patches.push({ run_employee_id: entry.id, patch });
      }
    }
    return patches;
  }

  function save() {
    const patches = buildPatches();
    if (patches === null) return; // a local range error is already showing
    if (patches.length === 0) return; // pristine (button is disabled anyway)
    const savedCount = dirtyCount;

    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_id", runId);
      fd.set("patches", JSON.stringify(patches));
      const res = await updatePayrollEntriesAction(null, fd);
      if (res.ok) {
        // The batch committed atomically — clear ALL dirty state and re-render
        // the recomputed run (the server ran ONE recompute for the whole batch).
        setEdits({});
        setMsg({ kind: "ok", text: `Saved ${savedCount} ${savedCount === 1 ? "change" : "changes"}.` });
        router.refresh();
      } else {
        // Atomic: NOTHING was applied — keep every dirty cell so nothing is
        // lost, and surface the error prominently in the footer bar.
        setMsg({ kind: "err", text: res.message });
      }
    });
  }

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
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <EntryRowGroup
                key={entry.id}
                entry={entry}
                sheet={computed[entry.employeeId]}
                canEdit={canEdit}
                pending={pending}
                valueFor={valueFor}
                isDirty={isDirty}
                setField={setField}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ── The ONE Save bar (#43): sticky under the grid, disabled when pristine ── */}
      {canEdit && (
        <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-xs backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <span className="text-sm text-muted-foreground" data-testid="unsaved-indicator">
            {dirtyCount > 0 ? (
              <span className="font-medium text-amber-700 dark:text-amber-400">
                {dirtyCount} unsaved {dirtyCount === 1 ? "change" : "changes"}
              </span>
            ) : (
              "No unsaved changes"
            )}
          </span>
          <div className="flex items-center gap-3">
            {msg && (
              <span
                role={msg.kind === "err" ? "alert" : "status"}
                className={`max-w-96 text-sm ${msg.kind === "ok" ? "text-emerald-800 dark:text-emerald-300" : "font-medium text-red-700 dark:text-red-400"}`}
              >
                {msg.text}
              </span>
            )}
            <Button
              type="button"
              variant={dirtyCount > 0 ? "default" : "outline"}
              disabled={dirtyCount === 0 || pending}
              loading={pending}
              loadingText="Saving…"
              onClick={save}
            >
              <Save aria-hidden="true" />
              {dirtyCount > 0
                ? `Save ${dirtyCount} ${dirtyCount === 1 ? "change" : "changes"}`
                : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EntryRowGroup({
  entry,
  sheet,
  canEdit,
  pending,
  valueFor,
  isDirty,
  setField,
}: {
  entry: PayrollRunEntry;
  sheet: SnapshotEmployee | undefined;
  canEdit: boolean;
  pending: boolean;
  valueFor: (entryId: string, key: string) => string;
  isDirty: (entryId: string, key: string) => boolean;
  setField: (entryId: string, key: string, v: string) => void;
}) {
  const isSupport = entry.family === "support";
  const isTech = (TECH_FAMILIES as readonly string[]).includes(entry.family);

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
            const dirty = isDirty(entry.id, key);
            return (
              <td key={key} className="px-2 py-2 text-right">
                {canEdit ? (
                  <Input
                    value={valueFor(entry.id, key)}
                    onChange={(e) => setField(entry.id, key, e.target.value)}
                    inputMode="decimal"
                    placeholder="0.0"
                    className={`h-8 w-16 text-right tabular-nums ${dirty ? dirtyCls : ""}`}
                    aria-label={`${entry.displayName} week ${wk} ${f.label.toLowerCase().replace(".", "")} hours`}
                    data-dirty={dirty || undefined}
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
                    value={valueFor(entry.id, "manual_incentive_cents")}
                    onChange={(e) => setField(entry.id, "manual_incentive_cents", e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className={`h-8 w-20 text-right tabular-nums ${isDirty(entry.id, "manual_incentive_cents") ? dirtyCls : ""}`}
                    aria-label={`${entry.displayName} manual incentive dollars`}
                    data-dirty={isDirty(entry.id, "manual_incentive_cents") || undefined}
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
        </tr>
      ))}
    </>
  );
}
