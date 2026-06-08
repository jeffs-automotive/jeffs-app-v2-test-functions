"use client";

/**
 * SettingsForm (C8c, admin-only) — edit the auto_post gate + tz/tax/tire config via
 * updateSettingsAction. auto_post is a sensitive gate (it bypasses the approval queue);
 * the action enforces admin. router.refresh() on save.
 */
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateSettingsAction } from "@/actions/settings";
import type { ShopSettings } from "@/lib/dal/settings";

export default function SettingsForm({ settings }: { settings: ShopSettings }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateSettingsAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  const inputCls = "mt-0.5 w-full rounded border border-stone-300 px-2 py-1 text-sm";

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-stone-900">Settings</h2>
      <form action={action} className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-sm text-stone-800">
          <input type="checkbox" name="auto_post" defaultChecked={settings.autoPost} />
          <span>Auto-post (skip the approval queue)</span>
        </label>
        <div className="grid grid-cols-2 gap-2 text-xs text-stone-600">
          <label className="block">Sales tax (bps)
            <input name="sales_tax_rate_bps" defaultValue={settings.salesTaxRateBps} inputMode="numeric" className={inputCls} />
          </label>
          <label className="block">Tire fee (cents)
            <input name="tire_fee_cents" defaultValue={settings.tireFeeCents} inputMode="numeric" className={inputCls} />
          </label>
        </div>
        <label className="block text-xs text-stone-600">Timezone
          <input name="shop_timezone" defaultValue={settings.shopTimezone} className={inputCls} />
        </label>
        <button type="submit" disabled={pending} className="rounded bg-[#96003C] px-3 py-1 text-sm font-medium text-white transition hover:bg-[#7a0030] disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      {state?.ok && <p className="mt-2 text-xs text-green-700">Saved.</p>}
      {state?.ok === false && <p className="mt-2 text-xs text-red-700">{state.message}</p>}
    </div>
  );
}
