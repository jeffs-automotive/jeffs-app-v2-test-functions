"use client";

/**
 * DryRunButton — the round-7 #42 "check against Tekmetric" affordance at the
 * bottom of the pay-sheets tab (admin, open runs). One click runs the whole
 * server-side dance (dryRunPayrollAction → live re-fetch, fresh recompute,
 * diff); the modal then lists every difference GROUPED (per-tech billed hours /
 * month numbers / pay totals), old → new with a colored delta.
 *
 * HONESTY CONTRACT: the refreshed numbers are ALREADY COMMITTED when the modal
 * opens (the recompute stored the live snapshot) — the subtext says so, the
 * page refreshes underneath the modal, Accept only acknowledges + jumps to the
 * Summary tab (client-side switch via onAccepted), and Cancel/close keeps the
 * user on the pay sheet with the same refreshed numbers.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FlaskConical } from "lucide-react";
import { dryRunPayrollAction } from "@/actions/payroll";
import { fmtUsd } from "@/lib/format";
import type {
  DryRunDiffField,
  DryRunPtoProjection,
  PayrollDryRunResult,
} from "@/lib/payroll/dry-run-diff";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtAsOf, fmtHours, PtoBalance } from "../../payroll-ui";

// ── Value + delta formatting per field kind ────────────────────────────────────

function fmtValue(kind: DryRunDiffField["kind"], v: number | null): string {
  if (v === null) return "—";
  if (kind === "cents") return v < 0 ? `−${fmtUsd(Math.abs(v))}` : fmtUsd(v);
  if (kind === "hours") return fmtHours(v);
  return String(v);
}

function fmtDelta(kind: DryRunDiffField["kind"], delta: number): string {
  const sign = delta > 0 ? "+" : "−";
  const abs = Math.abs(delta);
  if (kind === "cents") return `${sign}${fmtUsd(abs)}`;
  if (kind === "hours") return `${sign}${fmtHours(abs)}`;
  return `${sign}${abs}`;
}

/** One "old → new (delta)" line; the delta colors green up / red down. */
function DiffRow({ field }: { field: DryRunDiffField }) {
  const delta = field.before !== null && field.after !== null ? field.after - field.before : null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-sm">
      <dt className="text-muted-foreground">{field.label}</dt>
      <dd className="text-right tabular-nums text-foreground">
        <span className="text-muted-foreground line-through decoration-1">
          {fmtValue(field.kind, field.before)}
        </span>
        <span aria-hidden="true"> → </span>
        <span className="sr-only">changed to</span>
        <span className="font-medium">{fmtValue(field.kind, field.after)}</span>
        {delta !== null && delta !== 0 && (
          <span
            className={`ml-2 text-xs ${
              delta > 0
                ? "text-emerald-800 dark:text-emerald-300"
                : "text-red-700 dark:text-red-400"
            }`}
          >
            {fmtDelta(field.kind, delta)}
          </span>
        )}
      </dd>
    </div>
  );
}

function DiffGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <dl className="mt-1 divide-y divide-border/50 rounded-lg border border-border bg-muted/30 px-3 py-1">
        {children}
      </dl>
    </section>
  );
}

// ── PTO balances (plan §4/§10.4) ────────────────────────────────────────────────

/**
 * PtoDiffSection — the "PTO balances" group, fed by the NEW OPTIONAL SIBLING
 * `result.pto` (never `diff`). Rendered OUTSIDE the `diff.changed` conditional
 * (both branches — a deficit warning can co-render with "no Tekmetric
 * differences"). Each employee shows the projected balance via the shared
 * `PtoBalance` primitive (so a projected-negative balance surfaces the deficit
 * chip identically to the employee card / completion dialog / ledger), the
 * current→projected math as a muted line, and a compact deficit line when the
 * run takes the balance negative (plan #59 intent: "will go NEGATIVE by 3.5 h").
 * The caller renders this only when `pto` is non-empty; an empty/absent list
 * means "no PTO movement this run" and the section is omitted entirely.
 */
function PtoDiffSection({ pto }: { pto: DryRunPtoProjection[] }) {
  return (
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        PTO balances
      </h3>
      <div className="mt-1 divide-y divide-border/50 rounded-lg border border-border bg-muted/30 px-3 py-1">
        {pto.map((emp) => {
          const negative = emp.projectedBalanceHours < 0;
          const deficit = Math.abs(emp.projectedBalanceHours);
          return (
            <div key={emp.employeeId} className="py-1.5">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm font-medium text-foreground">{emp.displayName}</p>
                <PtoBalance hours={emp.projectedBalanceHours} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {fmtHours(emp.currentBalanceHours)} now
                {emp.accrualHours > 0 && <> · +{fmtHours(emp.accrualHours)} accrual</>}
                {emp.usageHours > 0 && <> · −{fmtHours(emp.usageHours)} used</>}
                <span aria-hidden="true"> → </span>
                {fmtHours(emp.projectedBalanceHours)} projected
              </p>
              {negative && (
                <p className="mt-0.5 text-xs text-[color:var(--color-pto-negative)]">
                  Will go negative by {fmtHours(deficit)} h.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── The button + modal ─────────────────────────────────────────────────────────

export function DryRunButton({
  runId,
  roCount,
  locked = false,
  onAccepted,
}: {
  runId: string;
  /** snapshot.derived_provenance.ro_count — the pending-state "Checking N…" figure. */
  roCount: number | null;
  /** Defensive: a locked (completed/voided) run renders the button disabled.
   *  The page only mounts this on open runs — belt and suspenders. */
  locked?: boolean;
  /** Accept → the #41 client-side tab switch to the Summary tab. */
  onAccepted: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PayrollDryRunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function runDryRun() {
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_id", runId);
      const res = await dryRunPayrollAction(null, fd);
      if (res.ok) {
        setResult(res.data);
        setOpen(true);
        // The refreshed snapshot is committed — re-render the page underneath the
        // modal so the sheets/summary already show the refreshed numbers.
        router.refresh();
      } else {
        setErr(res.message);
      }
    });
  }

  function accept() {
    setOpen(false);
    onAccepted();
  }

  const diff = result?.diff ?? null;
  const pto = result?.pto ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        loading={pending}
        loadingText={`Checking ${roCount ?? "the period's"} repair orders…`}
        disabled={pending || locked}
        title={locked ? "This run is locked — dry run applies to open runs only." : undefined}
        onClick={runDryRun}
      >
        <FlaskConical aria-hidden="true" />
        Dry run — check against Tekmetric
      </Button>
      {err && <span className="text-xs text-red-700 dark:text-red-400">{err}</span>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Dry run — what changed</DialogTitle>
            <DialogDescription>
              These numbers are already live — the refreshed Tekmetric data has been applied to
              this run. Accept jumps to the summary; closing keeps you on the pay sheet.
            </DialogDescription>
          </DialogHeader>

          {result && diff && (
            <>
              <p className="text-xs text-muted-foreground">
                Checked {result.rosChecked} repair orders · data as of{" "}
                <span className="font-medium text-foreground">{fmtAsOf(diff.afterAsOf)}</span>
                {" "}(was {fmtAsOf(diff.beforeAsOf)})
              </p>

              {!diff.changed ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  Everything is up to date — no differences.
                </p>
              ) : (
                <div className="space-y-4">
                  {diff.techHours.length > 0 && (
                    <DiffGroup title="Per-technician billed hours">
                      {diff.techHours.map((emp) => (
                        <div key={emp.employeeId} className="py-1.5">
                          <p className="text-sm font-medium text-foreground">{emp.displayName}</p>
                          {emp.fields.map((f) => (
                            <DiffRow key={f.key} field={f} />
                          ))}
                        </div>
                      ))}
                    </DiffGroup>
                  )}
                  {diff.month.length > 0 && (
                    <DiffGroup title="Month numbers">
                      {diff.month.map((f) => (
                        <DiffRow key={f.key} field={f} />
                      ))}
                    </DiffGroup>
                  )}
                  {diff.payTotals.length > 0 && (
                    <DiffGroup title="Pay totals">
                      {diff.payTotals.map((f) => (
                        <DiffRow key={f.key} field={f} />
                      ))}
                    </DiffGroup>
                  )}
                </div>
              )}

              {/* PTO balances — OUTSIDE the diff.changed branch (plan §4/C16): a
                  deficit warning can co-render with "no Tekmetric differences".
                  Fed by the optional `pto` sibling, never by `diff`; omitted
                  entirely when there is no PTO movement this run. */}
              {pto.length > 0 && <PtoDiffSection pto={pto} />}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={accept}>
              Accept
              <ArrowRight aria-hidden="true" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
