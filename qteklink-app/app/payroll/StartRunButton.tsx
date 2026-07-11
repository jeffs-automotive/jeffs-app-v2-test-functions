"use client";

/**
 * StartRunButton (admin-only affordance, rendered by the /payroll dashboard) —
 * offers the NEXT on-cadence bi-weekly period (computed server-side from the
 * DAL-provided last run / anchor and passed in as props), submits
 * createPayrollRunAction, then navigates to the new run. When payroll settings
 * have no anchor_period_start the button is disabled with an explanation that
 * points at /payroll/settings. Every failure surfaces inline (state.message).
 */
import { useActionState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { createPayrollRunAction } from "@/actions/payroll";
import { Button } from "@/components/ui/button";

export default function StartRunButton({
  nextPeriodStart,
  nextPeriodLabel,
}: {
  /** ISO period start to create, or null when the anchor is unset. */
  nextPeriodStart: string | null;
  /** Human label for the same period ("7/12 – 7/25"), null with the above. */
  nextPeriodLabel: string | null;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createPayrollRunAction, null);

  // On success, go straight to the new run (the runs route is period-keyed).
  useEffect(() => {
    if (state?.ok && nextPeriodStart !== null) {
      router.push(`/payroll/runs/${nextPeriodStart}`);
    }
  }, [state?.ok, state?.timestamp, router, nextPeriodStart]);

  if (nextPeriodStart === null) {
    return (
      <div className="text-right">
        <Button disabled>
          <CalendarPlus aria-hidden="true" />
          Start new payroll run
        </Button>
        <p className="mt-1 max-w-56 text-xs text-muted-foreground">
          Set the anchor period start in{" "}
          <Link
            href="/payroll/settings"
            className="font-medium text-primary underline underline-offset-4"
          >
            payroll settings
          </Link>{" "}
          before starting a run.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="text-right">
      <input type="hidden" name="period_start" value={nextPeriodStart} />
      <Button
        type="submit"
        loading={pending || state?.ok === true}
        loadingText={state?.ok ? "Opening…" : "Starting…"}
      >
        <CalendarPlus aria-hidden="true" />
        Start new payroll run
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">
        Next period:{" "}
        <span className="font-medium tabular-nums text-foreground">{nextPeriodLabel}</span>
      </p>
      {state?.ok === false && (
        <p role="alert" className="mt-1 max-w-64 text-sm text-red-700 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
