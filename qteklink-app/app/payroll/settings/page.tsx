/**
 * /payroll/settings — payroll configuration: spiff categories (which Tekmetric
 * job categories count toward the service-writer spiff + per-job multiplier),
 * the two payroll alert-email lists, and the bi-weekly pay-period anchor that
 * run creation validates against. Chrome + admin fork mirror /settings:
 * everyone signed in can READ the values; only admins see the editors
 * (mutations are re-gated in the action).
 */
import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { getPayrollSettings } from "@/lib/dal/payroll";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import SpiffCategoriesCard from "./SpiffCategoriesCard";
import PtoTiersCard from "./PtoTiersCard";
import AlertEmailsCard from "./AlertEmailsCard";
import AnchorPeriodCard from "./AnchorPeriodCard";

export const dynamic = "force-dynamic"; // category list must be current after a nightly ingest

export default async function PayrollSettingsPage() {
  const { email, role, shopId } = await requireQtekUser();
  const isAdmin = role === "admin";
  const { realmId, payroll } = await getPayrollSettings(shopId);
  const countedCount = payroll.spiff_categories.filter((c) => c.counted).length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <PageHeader
        title="Payroll settings"
        description="Spiff categories, alert emails, and the pay-period anchor"
      >
        <IdentityBlock email={email} role={role} shopId={shopId} />
      </PageHeader>

      <div className="mt-4">
        <Button render={<Link href="/payroll" />} variant="link" className="h-auto px-0">
          <ArrowLeft aria-hidden="true" />
          Back to payroll
        </Button>
      </div>

      {!realmId ? (
        <section className="mt-8 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" />
          <p className="text-sm text-amber-800">
            QuickBooks isn&apos;t connected for this shop yet. Connect it from the home page first —
            payroll settings are stored with the shop&apos;s connection.
          </p>
        </section>
      ) : !isAdmin ? (
        <Card className="mt-8 shadow-xs">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Payroll settings can only be changed by an admin. You can see the current values below.
            </p>
            <dl className="mt-4 space-y-1 text-sm text-foreground">
              <div>
                <dt className="inline font-medium">Pay-period anchor:</dt>{" "}
                <dd className="inline">{payroll.anchor_period_start ?? "not set"}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Spiff categories counted:</dt>{" "}
                <dd className="inline">
                  {countedCount} of {payroll.spiff_categories.length}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">Void &amp; clone alerts go to:</dt>{" "}
                <dd className="inline">{payroll.alert_emails.void_clone.join(", ") || "not set"}</dd>
              </div>
              <div>
                <dt className="inline font-medium">Payroll completed alerts go to:</dt>{" "}
                <dd className="inline">{payroll.alert_emails.completed.join(", ") || "not set"}</dd>
              </div>
              <div>
                <dt className="inline font-medium">PTO adjustment alerts go to:</dt>{" "}
                <dd className="inline">{payroll.pto_adjustment_alert_emails.join(", ") || "not set"}</dd>
              </div>
              <div>
                <dt className="inline font-medium">PTO negative-balance alerts go to:</dt>{" "}
                <dd className="inline">{payroll.pto_negative_alert_admin_emails.join(", ") || "not set"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="mt-4 rounded-lg border border-border bg-muted p-4 text-sm text-muted-foreground">
            Spiff categories are discovered automatically from Tekmetric. New ones show up here
            marked <span className="font-medium text-foreground">new</span> and start turned off
            until you decide whether they count.
          </section>

          <SpiffCategoriesCard categories={payroll.spiff_categories} />
          <PtoTiersCard
            tiers={payroll.pto_tenure_tiers}
            rolloverCapHours={payroll.pto_rollover_cap_hours}
          />
          <AlertEmailsCard
            alertEmails={payroll.alert_emails}
            ptoAdjustmentEmails={payroll.pto_adjustment_alert_emails}
            ptoNegativeEmails={payroll.pto_negative_alert_admin_emails}
          />
          <AnchorPeriodCard anchor={payroll.anchor_period_start} />
        </>
      )}
    </main>
  );
}
