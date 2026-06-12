"use client";

/**
 * RecordManualPaymentForm (C7, admin-only) — the method-pick UI (plan §5). For a
 * paid RO with no payment event, classify HOW it was paid. The GROSS amount + date
 * are server-derived from the RO snapshot (not entered here); the user supplies the
 * method, the non-cash sub-type (when "Other"), and the CC fee (cards). Submits to
 * recordManualPaymentAction; on success router.refresh()es.
 */
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { recordManualPaymentAction } from "@/actions/payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const METHODS = ["Credit Card", "Cash", "Check", "Other"];

export default function RecordManualPaymentForm() {
  const router = useRouter();
  const [method, setMethod] = useState("Credit Card");
  const [state, formAction, pending] = useActionState(recordManualPaymentAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  const selectCls = "h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle>Record a manual payment</CardTitle>
        <p className="text-xs text-muted-foreground">
          For a paid RO with no payment event — the amount comes from the RO; pick how it was paid.
        </p>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-2">
          <Input name="repair_order_id" inputMode="numeric" required placeholder="Repair order id" />
          <select name="method" aria-label="How it was paid" value={method} onChange={(e) => setMethod(e.target.value)} className={selectCls}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {method === "Other" && (
            <Input name="other_payment_type" required placeholder="Non-cash type (e.g. Tire Protection Plan)" />
          )}
          {method === "Credit Card" && (
            <Input name="cc_fee_cents" inputMode="numeric" placeholder="CC processing fee (cents, optional)" />
          )}
          <Button type="submit" loading={pending} loadingText="Recording…">
            <Plus aria-hidden="true" />
            Record
          </Button>
        </form>
        {state?.ok === false && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{state.message}</p>}
        {state?.ok && <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-300">Recorded — it will reconcile on the next run.</p>}
      </CardContent>
    </Card>
  );
}
