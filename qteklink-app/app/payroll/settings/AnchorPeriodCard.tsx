"use client";

/**
 * AnchorPeriodCard — the Sunday the bi-weekly payroll cadence anchors on
 * (settings.payroll.anchor_period_start). Creating a run validates against it
 * server-side ((period_start − anchor) % 14 = 0), so this field must be set
 * before the first run. Client-side we only pre-check the "must be a Sunday"
 * rule for a friendly inline message; the action/DAL re-validate the date.
 */
import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { updatePayrollSettingsAction } from "@/actions/payroll";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

function weekdayUtc(iso: string): string | null {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export default function AnchorPeriodCard({ anchor }: { anchor: string | null }) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(updatePayrollSettingsAction, null);
  const [, start] = useTransition();
  const [value, setValue] = useState(anchor ?? "");

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  const weekday = value ? weekdayUtc(value) : null;
  const notSunday = value.length > 0 && weekday !== null && weekday !== "Sunday";

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!value || notSunday) return;
    const fd = new FormData();
    fd.set("anchor_period_start", value);
    start(() => dispatch(fd));
  }

  return (
    <Card className="mt-6 shadow-xs">
      <CardHeader>
        <CardTitle>Pay-period anchor</CardTitle>
        <CardDescription>
          The Sunday the bi-weekly cadence counts from — new pay runs can only start a whole number
          of two-week periods after this date.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {anchor === null && (
          <p className="mb-3 text-sm text-amber-800 dark:text-amber-300">
            Not set yet — payroll runs can&apos;t be created until the anchor is saved.
          </p>
        )}
        <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>
            Anchor period start (a Sunday)
            <Input
              type="date"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              className="mt-0.5 w-44"
              aria-invalid={notSunday || undefined}
            />
          </label>
          <Button
            type="submit"
            loading={pending}
            loadingText="Saving…"
            disabled={pending || value.length === 0 || notSunday}
          >
            <Save aria-hidden="true" />
            Save anchor
          </Button>
          {state?.ok && <span className="text-sm text-emerald-800 dark:text-emerald-300">Saved.</span>}
          {state?.ok === false && (
            <span className="text-sm text-red-700 dark:text-red-400">{state.message}</span>
          )}
        </form>
        {notSunday && (
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">
            {value} is a {weekday} — the anchor must be a Sunday (pay periods run Sunday to Saturday).
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Changing the anchor changes which start dates future runs may use; existing runs are
          unaffected.
        </p>
      </CardContent>
    </Card>
  );
}
