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
import { recordManualPaymentAction } from "@/actions/payments";

const METHODS = ["Credit Card", "Cash", "Check", "Other"];

export default function RecordManualPaymentForm() {
  const router = useRouter();
  const [method, setMethod] = useState("Credit Card");
  const [state, formAction, pending] = useActionState(recordManualPaymentAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  const inputCls = "w-full rounded border border-stone-300 px-2 py-1 text-sm";

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-stone-900">Record a manual payment</h2>
      <p className="mt-1 text-xs text-stone-500">
        For a paid RO with no payment event — the amount comes from the RO; pick how it was paid.
      </p>
      <form action={formAction} className="mt-3 space-y-2">
        <input name="repair_order_id" inputMode="numeric" required placeholder="Repair order id" className={inputCls} />
        <select name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {method === "Other" && (
          <input name="other_payment_type" required placeholder="Non-cash type (e.g. Tire Protection Plan)" className={inputCls} />
        )}
        {method === "Credit Card" && (
          <input name="cc_fee_cents" inputMode="numeric" placeholder="CC processing fee (cents, optional)" className={inputCls} />
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[#96003C] px-3 py-1 text-sm font-medium text-white transition hover:bg-[#7a0030] disabled:opacity-60"
        >
          {pending ? "Recording…" : "Record"}
        </button>
      </form>
      {state?.ok === false && <p className="mt-2 text-xs text-red-700">{state.message}</p>}
      {state?.ok && <p className="mt-2 text-xs text-green-700">Recorded — it will reconcile on the next run.</p>}
    </div>
  );
}
