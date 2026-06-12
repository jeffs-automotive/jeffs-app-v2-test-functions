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
import { Save } from "lucide-react";
import { updateSettingsAction } from "@/actions/settings";
import type { ShopSettings } from "@/lib/dal/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsForm({ settings }: { settings: ShopSettings }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(updateSettingsAction, null);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state?.timestamp, state?.ok, router]);

  const labelCls = "block text-xs font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <form action={action} className="space-y-6">
      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle>Email alerts</CardTitle>
          <p className="text-sm text-muted-foreground">
            QTekLink sends two kinds of alert emails. Choose who gets each one — every box
            accepts several addresses, separated by commas.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-foreground">Date Change Alert</p>
              <p className="text-sm text-muted-foreground">
                Sent when a repair order that&apos;s already in QuickBooks is re-posted in
                Tekmetric on a <span className="font-medium text-foreground">different day</span>. These people
                should watch the Posting queue (usually the office manager and the service
                advisors).
              </p>
              <label className={`${labelCls} mt-2`}>Send the Date Change Alert to
                <Input name="date_change_alert_emails"
                  placeholder="office@yourshop.com, advisor1@yourshop.com, advisor2@yourshop.com"
                  defaultValue={settings.dateChangeAlertEmails.join(", ")} className="mt-0.5" />
              </label>
            </div>

            <div>
              <p className="text-sm font-semibold text-foreground">Day Correction Alert</p>
              <p className="text-sm text-muted-foreground">
                Sent when a day that was already posted to QuickBooks changes afterward — for
                example, a repair order unposted and re-posted on the same date with a
                different total — so someone double-checks the entry (usually the office
                manager). Fixes made the <span className="font-medium text-foreground">same day</span> the
                repair order was posted in Tekmetric don&apos;t send an email.
              </p>
              <label className={`${labelCls} mt-2`}>Send the Day Correction Alert to
                <Input name="day_correction_alert_emails"
                  placeholder="office@yourshop.com, bookkeeper@yourshop.com"
                  defaultValue={settings.dayCorrectionAlertEmails.join(", ")} className="mt-0.5" />
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle>Posting &amp; tax</CardTitle>
          <p className="text-sm text-muted-foreground">
            These match your state&apos;s tax rules. Leave them alone unless something changes.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>Sales tax rate (basis points — 600 = 6%)
              <Input name="sales_tax_rate_bps" defaultValue={settings.salesTaxRateBps} inputMode="numeric" className="mt-0.5" />
            </label>
            <label className={labelCls}>Tire fee (cents per tire — 100 = $1.00)
              <Input name="tire_fee_cents" defaultValue={settings.tireFeeCents} inputMode="numeric" className="mt-0.5" />
            </label>
          </div>
          <label className={`${labelCls} mt-3`}>Shop timezone
            <Input name="shop_timezone" defaultValue={settings.shopTimezone} className="mt-0.5" />
          </label>
          <label className="mt-4 flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" name="auto_post" defaultChecked={settings.autoPost} className="mt-0.5" />
            <span>
              <span className="font-medium">Post automatically every night</span> — skips the
              morning approval step. Leave this OFF unless you fully trust the numbers; you can
              always approve each day yourself on the Daily approvals page.
            </span>
          </label>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" loading={pending} loadingText="Saving…">
          <Save aria-hidden="true" />
          Save settings
        </Button>
        {state?.ok && <span className="ml-3 text-sm text-emerald-800 dark:text-emerald-300">Saved.</span>}
        {state?.ok === false && <span className="ml-3 text-sm text-red-700 dark:text-red-400">{state.message}</span>}
      </div>
    </form>
  );
}
