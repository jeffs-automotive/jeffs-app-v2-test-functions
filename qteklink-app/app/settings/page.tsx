/**
 * /settings — shop configuration: who receives each named alert email (Date Change
 * Alert / Day Correction Alert — comma-separated lists), tax/timezone, the nightly
 * auto-post switch, and (admin-only) WHO CAN SIGN IN — the Microsoft-account
 * allowlist that gates the whole app. Everyone signed in can READ the config;
 * only admins can save or manage access (enforced in the actions).
 */
import { AlertTriangle } from "lucide-react";
import { requireQtekUser } from "@/lib/auth";
import { getShopSettings } from "@/lib/dal/settings";
import { listAllowedUsers } from "@/lib/dal/allowed-users";
import SettingsForm from "./SettingsForm";
import AllowedUsersManager from "./AllowedUsersManager";
import { PageHeader, IdentityBlock } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic"; // settings + the access list must always be current

export default async function SettingsPage() {
  const { email, role, shopId } = await requireQtekUser();
  const { realmId, settings } = await getShopSettings(shopId);
  const allowedUsers = role === "admin" ? await listAllowedUsers(shopId) : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <PageHeader title="Settings" description="Who gets each alert email, tax rates, and posting options">
        <IdentityBlock email={email} role={role} shopId={shopId} />
      </PageHeader>

      {!realmId ? (
        <section className="mt-8 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-800" aria-hidden="true" />
          <p className="text-sm text-amber-800">
            QuickBooks isn&apos;t connected for this shop yet. Connect it from the home page first.
          </p>
        </section>
      ) : role !== "admin" ? (
        <Card className="mt-8 shadow-xs">
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Settings can only be changed by an admin. You can see the current values below.
            </p>
            <dl className="mt-4 space-y-1 text-sm text-foreground">
              <div><dt className="inline font-medium">Date Change Alert goes to:</dt> <dd className="inline">{settings.dateChangeAlertEmails.join(", ") || "not set"}</dd></div>
              <div><dt className="inline font-medium">Day Correction Alert goes to:</dt> <dd className="inline">{settings.dayCorrectionAlertEmails.join(", ") || "not set"}</dd></div>
              <div><dt className="inline font-medium">Auto-post:</dt> <dd className="inline">{settings.autoPost ? "on" : "off"}</dd></div>
            </dl>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8">
          <SettingsForm settings={settings} />

          <Card className="mt-6 shadow-xs">
            <CardHeader>
              <CardTitle>Who can sign in</CardTitle>
              <p className="text-sm text-muted-foreground">
                QTekLink only lets in the Microsoft accounts on this list. Add someone&apos;s work
                email to give them access; turn access off to lock them out. You can never turn off
                the last admin — so you can&apos;t lock yourself out of the shop.
              </p>
            </CardHeader>
            <CardContent>
              <AllowedUsersManager users={allowedUsers} selfEmail={email} />
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}
