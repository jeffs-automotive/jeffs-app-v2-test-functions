"use client";

/**
 * SettingsForm (admin-only) — edit posting + tax config and the alert-email
 * recipients via updateSettingsAction. Recipients are configured PER NAMED EMAIL
 * (Date Change Alert / Day Correction Alert), each accepting multiple
 * comma-separated addresses. auto_post is a sensitive gate (it bypasses the
 * approval step); the action enforces admin. router.refresh() on save.
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

  const inputCls = "mt-0.5 w-full rounded border border-stone-300 px-2 py-1.5 text-sm";
  const labelCls = "block text-xs font-medium uppercase tracking-wide text-stone-500";

  return (
    <form action={action} className="space-y-6">
      <section className="rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">Email alerts</h2>
        <p className="mt-1 text-sm text-stone-600">
          QTekLink sends two kinds of alert emails. Choose who gets each one — every box
          accepts several addresses, separated by commas.
        </p>

        <div className="mt-4 space-y-5">
          <div>
            <p className="text-sm font-semibold text-stone-900">Date Change Alert</p>
            <p className="text-sm text-stone-600">
              Sent when a repair order that&apos;s already in QuickBooks is re-posted in
              Tekmetric on a <span className="font-medium">different day</span>. These people
              should watch the Posting queue (usually the office manager and the service
              advisors).
            </p>
            <label className={`${labelCls} mt-2`}>Send the Date Change Alert to
              <input name="date_change_alert_emails"
                placeholder="office@yourshop.com, advisor1@yourshop.com, advisor2@yourshop.com"
                defaultValue={settings.dateChangeAlertEmails.join(", ")} className={inputCls} />
            </label>
          </div>

          <div>
            <p className="text-sm font-semibold text-stone-900">Day Correction Alert</p>
            <p className="text-sm text-stone-600">
              Sent when a day that was already posted to QuickBooks changes afterward — for
              example, a repair order unposted and re-posted on the same date with a
              different total — so someone double-checks the entry (usually the office
              manager). Fixes made the <span className="font-medium">same day</span> the
              repair order was posted in Tekmetric don&apos;t send an email.
            </p>
            <label className={`${labelCls} mt-2`}>Send the Day Correction Alert to
              <input name="day_correction_alert_emails"
                placeholder="office@yourshop.com, bookkeeper@yourshop.com"
                defaultValue={settings.dayCorrectionAlertEmails.join(", ")} className={inputCls} />
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-stone-900">Posting &amp; tax</h2>
        <p className="mt-1 text-sm text-stone-600">
          These match your state&apos;s tax rules. Leave them alone unless something changes.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className={labelCls}>Sales tax rate (basis points — 600 = 6%)
            <input name="sales_tax_rate_bps" defaultValue={settings.salesTaxRateBps} inputMode="numeric" className={inputCls} />
          </label>
          <label className={labelCls}>Tire fee (cents per tire — 100 = $1.00)
            <input name="tire_fee_cents" defaultValue={settings.tireFeeCents} inputMode="numeric" className={inputCls} />
          </label>
        </div>
        <label className={`${labelCls} mt-3`}>Shop timezone
          <input name="shop_timezone" defaultValue={settings.shopTimezone} className={inputCls} />
        </label>
        <label className="mt-4 flex items-start gap-2 text-sm text-stone-800">
          <input type="checkbox" name="auto_post" defaultChecked={settings.autoPost} className="mt-0.5" />
          <span>
            <span className="font-medium">Post automatically every night</span> — skips the
            morning approval step. Leave this OFF unless you fully trust the numbers; you can
            always approve each day yourself on the Daily approvals page.
          </span>
        </label>
      </section>

      <div>
        <button type="submit" disabled={pending}
          className="rounded bg-[#96003C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#7a0030] disabled:opacity-60">
          {pending ? "Saving…" : "Save settings"}
        </button>
        {state?.ok && <span className="ml-3 text-sm text-green-700">Saved.</span>}
        {state?.ok === false && <span className="ml-3 text-sm text-red-700">{state.message}</span>}
      </div>
    </form>
  );
}
