"use client";

/**
 * RunReconcileForm (C7, admin-only) — trigger runDailyReconciliationAction for a
 * business date: build + gate the day's drafts + queue anything non-postable. On
 * success it shows the roll-up summary and router.refresh()es the queue.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { runDailyReconciliationAction } from "@/actions/reconcile";

export default function RunReconcileForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(runDailyReconciliationAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-stone-900">Run a day</h2>
      <p className="mt-1 text-xs text-stone-500">
        Build + gate the day&apos;s drafts; queue anything that can&apos;t post cleanly.
      </p>
      <form action={formAction} className="mt-3 flex items-center gap-2">
        <input type="date" name="business_date" required className="rounded border border-stone-300 px-2 py-1 text-sm" />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-[#96003C] px-3 py-1 text-sm font-medium text-white transition hover:bg-[#7a0030] disabled:opacity-60"
        >
          {pending ? "Running…" : "Run"}
        </button>
      </form>
      {state?.ok === false && <p className="mt-2 text-xs text-red-700">{state.message}</p>}
      {state?.ok && (
        <dl className="mt-3 space-y-0.5 text-xs text-stone-600">
          <div>{state.data.saleCount} sales · {state.data.postableSales} postable</div>
          <div>{state.data.paymentCount} payments · {state.data.postablePayments} postable</div>
          <div className="font-medium text-stone-800">
            {state.data.reviewCount} queued for review ({state.data.persistedReviewItems} saved)
          </div>
        </dl>
      )}
    </div>
  );
}
