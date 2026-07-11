"use client";

/**
 * BonusToggle — the bonus-period control band (design spec §3, "Bonus-period
 * control"): an accessible labeled checkbox styled as a switch, wired to the
 * existing updatePayrollRunAction (admin, open runs — the action re-enforces).
 * When ON the band tints burgundy and names the month being paid. Includes the
 * SOFT second-run-of-month warning: bonus runs normally land in the month's
 * second pay period, so toggling ON a run that starts in the first half of its
 * month shows a non-blocking heads-up (display heuristic only — the server
 * owns the real uniqueness rule).
 */
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { updatePayrollRunAction } from "@/actions/payroll";
import { monthLabel } from "../../payroll-ui";
import { useState } from "react";

export function BonusToggle({
  runId,
  bonusPeriod,
  bonusMonth,
  periodStart,
  canEdit,
}: {
  runId: string;
  bonusPeriod: boolean;
  bonusMonth: string | null;
  periodStart: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Soft warning heuristic: a bonus run normally lands in the SECOND pay period
  // of the month; a period starting on day 1–14 is likely the first.
  const dayOfMonth = Number(periodStart.slice(8, 10));
  const likelyFirstPeriod = dayOfMonth <= 14;

  function toggle(next: boolean) {
    setErr(null);
    start(async () => {
      const fd = new FormData();
      fd.set("run_id", runId);
      fd.set("bonus_period", next ? "true" : "false");
      const res = await updatePayrollRunAction(null, fd);
      if (res.ok) router.refresh();
      else setErr(res.message);
    });
  }

  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        bonusPeriod ? "border-primary/30 bg-primary/10" : "border-border bg-muted/50"
      }`}
    >
      <label className="flex items-center gap-3 text-sm">
        <span
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            bonusPeriod ? "bg-primary" : "bg-muted-foreground/30"
          } ${canEdit && !pending ? "" : "opacity-60"}`}
        >
          <input
            type="checkbox"
            checked={bonusPeriod}
            onChange={(e) => toggle(e.target.checked)}
            disabled={!canEdit || pending}
            aria-label="Bonus run — pays last month's numbers"
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block size-4 rounded-full bg-background shadow-xs transition-transform ${
              bonusPeriod ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </span>
        <span>
          <span className={`font-medium ${bonusPeriod ? "text-primary" : "text-foreground"}`}>
            Bonus run — pays last month&apos;s numbers
          </span>
          {bonusPeriod && bonusMonth && (
            <span className="ml-2 text-muted-foreground">
              Paying <span className="font-semibold text-primary">{monthLabel(bonusMonth)}</span>{" "}
              numbers, landing in this pay period.
            </span>
          )}
          {pending && <span className="ml-2 text-muted-foreground">Saving…</span>}
        </span>
      </label>
      {bonusPeriod && likelyFirstPeriod && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Heads up: bonus runs usually land in the month&apos;s second pay period, and this run
          starts early in its month. Double-check this is the run you meant.
        </p>
      )}
      {err && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{err}</p>}
    </div>
  );
}
