"use client";

/**
 * PtoTiersCard — the PTO tenure-tier accrual editor + the calendar-year rollover
 * cap. Two sections, one atomic Save (the settings action treats pto_tenure_tiers
 * and pto_rollover_cap_hours as INDEPENDENT top-level whole-replace keys — plan
 * §2d/§10.1/C25 — so carrying both in one FormData is fine and never touches the
 * spiff/anchor/alert-email keys).
 *
 * Tiers = rows of { min_years, hours_per_period }. The 0-years row is PINNED —
 * its min-years input is read-only 0 and it has no remove button (the ladder
 * MUST include a 0 tier when non-empty; the SQL validator + assertPtoTenureTiers
 * are the source of truth, this is the friendly UX guard). Rows sort ascending by
 * min_years on BLUR / Save, never on keystroke, so a row never jumps out from
 * under the cursor mid-edit (the SpiffCategoriesCard "rows don't jump" lesson).
 * A first-run empty state seeds a single 0-years row so the required baseline is
 * always present to fill in.
 */
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus, Save, X } from "lucide-react";
import { updatePayrollSettingsAction } from "@/actions/payroll";
import type { PtoTenureTier } from "@/lib/payroll/pto";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

/** A draft row: strings while editing so a half-typed value isn't clobbered. */
type DraftRow = { min_years: string; hours_per_period: string; key: string };

let ROW_SEQ = 0;
function newKey(): string {
  ROW_SEQ += 1;
  return `tier-${ROW_SEQ}`;
}

function toDrafts(tiers: PtoTenureTier[]): DraftRow[] {
  const seed = tiers.length === 0 ? [{ min_years: 0, hours_per_period: 0 }] : tiers;
  return seed.map((t) => ({
    min_years: String(t.min_years),
    hours_per_period: String(t.hours_per_period),
    key: newKey(),
  }));
}

/** Sort ascending by parsed min_years; the 0-row naturally lands first. Draft
 *  rows with an unparseable min_years sort to the end so they stay visible. */
function sortDrafts(rows: DraftRow[]): DraftRow[] {
  return [...rows].sort((a, b) => {
    const na = Number(a.min_years);
    const nb = Number(b.min_years);
    const va = Number.isFinite(na) ? na : Number.POSITIVE_INFINITY;
    const vb = Number.isFinite(nb) ? nb : Number.POSITIVE_INFINITY;
    return va - vb;
  });
}

export default function PtoTiersCard({
  tiers,
  rolloverCapHours,
}: {
  tiers: PtoTenureTier[];
  rolloverCapHours: number | null;
}) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(updatePayrollSettingsAction, null);
  const [, start] = useTransition();
  const [rows, setRows] = useState<DraftRow[]>(() => toDrafts(tiers));
  const [cap, setCap] = useState<string>(rolloverCapHours === null ? "" : String(rolloverCapHours));
  const [clientError, setClientError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      // Server values take over after the refresh (normalized/sorted server-side).
      setRows(toDrafts(state.data.payroll.pto_tenure_tiers));
      setCap(
        state.data.payroll.pto_rollover_cap_hours === null
          ? ""
          : String(state.data.payroll.pto_rollover_cap_hours),
      );
      setClientError(null);
      router.refresh();
    }
  }, [state?.timestamp, state?.ok, router]);

  const zeroRowKey = useMemo(() => {
    // The pinned 0-years row = the draft whose min_years parses to exactly 0.
    // (Only one may exist — the uniqueness pre-check below blocks a second.)
    return rows.find((r) => Number(r.min_years) === 0 && r.min_years.trim() !== "")?.key ?? null;
  }, [rows]);

  function setRow(key: string, patch: Partial<Pick<DraftRow, "min_years" | "hours_per_period">>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setClientError(null);
    setRows((prev) => [...prev, { min_years: "", hours_per_period: "", key: newKey() }]);
  }

  function removeRow(key: string) {
    setClientError(null);
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  /** Re-sort on blur so the ladder settles once the user leaves a field — not on
   *  every keystroke (avoids rows jumping under the cursor). */
  function resort() {
    setRows((prev) => sortDrafts(prev));
  }

  /** Parse + validate the draft ladder client-side (the action + SQL validator
   *  re-check; this is the friendly pre-flight). Returns the numeric tiers or null. */
  function readTiers(): PtoTenureTier[] | null {
    const parsed: PtoTenureTier[] = [];
    for (const r of rows) {
      const my = Number(r.min_years);
      const hp = Number(r.hours_per_period);
      if (r.min_years.trim() === "" || !Number.isInteger(my) || my < 0) {
        setClientError("Each tier's minimum years must be a whole number 0 or greater.");
        return null;
      }
      if (r.hours_per_period.trim() === "" || !Number.isFinite(hp) || hp < 0) {
        setClientError("Each tier's hours per period must be a number 0 or greater.");
        return null;
      }
      parsed.push({ min_years: my, hours_per_period: hp });
    }
    const years = parsed.map((t) => t.min_years);
    if (new Set(years).size !== years.length) {
      setClientError("Two tiers can't share the same minimum years — each threshold must be unique.");
      return null;
    }
    if (parsed.length > 0 && !years.includes(0)) {
      setClientError("Add a starting tier at 0 years — every plan needs one.");
      return null;
    }
    return parsed.sort((a, b) => a.min_years - b.min_years);
  }

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const tierList = readTiers();
    if (tierList === null) return;

    const capStr = cap.trim();
    if (capStr.length > 0) {
      const capNum = Number(capStr);
      if (!Number.isFinite(capNum) || capNum < 0) {
        setClientError("The rollover cap must be a number 0 or greater (or blank for unlimited).");
        return;
      }
    }
    setClientError(null);
    // Re-sort the visible rows to match what we're saving.
    setRows(toDrafts(tierList));

    const fd = new FormData();
    fd.set("pto_tenure_tiers", JSON.stringify(tierList));
    // "" clears the cap to null (unlimited) — the action reads an empty string as null.
    fd.set("pto_rollover_cap_hours", capStr);
    start(() => dispatch(fd));
  }

  return (
    <Card className="mt-6 shadow-xs">
      <CardHeader>
        <CardTitle>PTO accrual tiers</CardTitle>
        <CardDescription>
          How many PTO hours each person earns per pay period, by years of service. Sick days are
          folded into these numbers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave}>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className={`${labelCls} w-24`}>Years of service</span>
              <span className={`${labelCls} w-28`}>Hours / period</span>
            </div>
            {rows.map((r) => {
              const isZero = r.key === zeroRowKey;
              return (
                <div
                  key={r.key}
                  className="flex items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none"
                >
                  <Input
                    inputMode="numeric"
                    value={isZero ? "0" : r.min_years}
                    readOnly={isZero}
                    disabled={pending}
                    onChange={(e) => setRow(r.key, { min_years: e.target.value })}
                    onBlur={resort}
                    aria-label={`Minimum years for the ${r.min_years || "new"}-year tier`}
                    className={`w-24 text-right tabular-nums ${isZero ? "bg-muted text-muted-foreground" : ""}`}
                  />
                  <Input
                    inputMode="decimal"
                    value={r.hours_per_period}
                    disabled={pending}
                    onChange={(e) => setRow(r.key, { hours_per_period: e.target.value })}
                    placeholder="0"
                    aria-label={`Hours per period for the ${r.min_years || "new"}-year tier`}
                    className="w-28 text-right tabular-nums"
                  />
                  {isZero ? (
                    <span className="text-xs text-muted-foreground">starting tier — always kept</span>
                  ) : (
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove the ${r.min_years || "new"}-year tier`}
                      disabled={pending}
                      onClick={() => removeRow(r.key)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Every plan needs a starting (0 years) tier. The rate for someone lands on the first pay
            period after they cross each threshold.
          </p>

          <div className="mt-3">
            <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={pending}>
              <Plus aria-hidden="true" />
              Add a tier
            </Button>
          </div>

          {/* ── Rollover cap (a second top-level key, saved in the same write) ── */}
          <div className="mt-6 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-semibold text-foreground">Calendar-year rollover cap</p>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className={labelCls}>
                Rollover cap (hours) — blank = unlimited
                <Input
                  inputMode="decimal"
                  value={cap}
                  disabled={pending}
                  onChange={(e) => setCap(e.target.value)}
                  placeholder="unlimited"
                  aria-label="Rollover cap in hours"
                  className="mt-0.5 w-32 text-right tabular-nums"
                />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              On the first payroll of each new year, anything above this is forfeited. Leave blank to
              let it all carry over.
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" loading={pending} loadingText="Saving…">
              <Save aria-hidden="true" />
              Save PTO settings
            </Button>
            {clientError && <span className="text-sm text-red-700 dark:text-red-400">{clientError}</span>}
            {!clientError && state?.ok === false && (
              <span className="text-sm text-red-700 dark:text-red-400">{state.message}</span>
            )}
            {!clientError && state?.ok && (
              <span className="text-sm text-emerald-800 dark:text-emerald-300">Saved.</span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
