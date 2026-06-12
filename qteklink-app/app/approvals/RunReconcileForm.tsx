"use client";

/**
 * RunReconcileForm (C7, admin-only) — trigger runDailyReconciliationAction for a
 * business date: build + gate the day's drafts + queue anything non-postable. On
 * success it shows the roll-up summary and router.refresh()es the queue.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { runDailyReconciliationAction } from "@/actions/reconcile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RunReconcileForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(runDailyReconciliationAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle>Run a day</CardTitle>
        <p className="text-xs text-muted-foreground">
          Build + gate the day&apos;s drafts; queue anything that can&apos;t post cleanly.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex items-center gap-2">
          <Input type="date" name="business_date" required className="w-auto" />
          <Button type="submit" loading={pending} loadingText="Running…">
            <Play aria-hidden="true" />
            Run
          </Button>
        </form>
        {state?.ok === false && <p className="mt-2 text-xs text-red-700">{state.message}</p>}
        {state?.ok && (
          <dl className="mt-3 space-y-0.5 text-xs text-muted-foreground">
            <div>{state.data.saleCount} sales · {state.data.postableSales} postable</div>
            <div>{state.data.paymentCount} payments · {state.data.postablePayments} postable</div>
            <div className="font-medium text-foreground">
              {state.data.reviewCount} queued for review ({state.data.persistedReviewItems} saved)
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
