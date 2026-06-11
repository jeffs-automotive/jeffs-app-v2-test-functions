/**
 * /settings — shop configuration: who receives each named alert email (Date Change
 * Alert / Day Correction Alert — comma-separated lists), tax/timezone, and the
 * nightly auto-post switch. Everyone signed in can READ; only admins can save
 * (enforced in the action).
 */
import { requireQtekUser } from "@/lib/auth";
import { getShopSettings } from "@/lib/dal/settings";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage() {
  const { email, role, shopId } = await requireQtekUser();
  const { realmId, settings } = await getShopSettings(shopId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-center justify-between border-b border-stone-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#96003C]">Settings</h1>
          <p className="text-sm text-stone-600">Who gets each alert email, tax rates, and posting options</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-stone-900">{email}</p>
          <p className="text-xs uppercase tracking-wide text-stone-500">{role} &middot; shop {shopId}</p>
        </div>
      </header>

      {!realmId ? (
        <section className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-800">
            QuickBooks isn&apos;t connected for this shop yet. Connect it from the home page first.
          </p>
        </section>
      ) : role !== "admin" ? (
        <section className="mt-8 rounded-lg border border-stone-200 bg-white p-6">
          <p className="text-sm text-stone-600">
            Settings can only be changed by an admin. You can see the current values below.
          </p>
          <dl className="mt-4 space-y-1 text-sm text-stone-800">
            <div><dt className="inline font-medium">Date Change Alert goes to:</dt> <dd className="inline">{settings.dateChangeAlertEmails.join(", ") || "not set"}</dd></div>
            <div><dt className="inline font-medium">Day Correction Alert goes to:</dt> <dd className="inline">{settings.dayCorrectionAlertEmails.join(", ") || "not set"}</dd></div>
            <div><dt className="inline font-medium">Auto-post:</dt> <dd className="inline">{settings.autoPost ? "on" : "off"}</dd></div>
          </dl>
        </section>
      ) : (
        <div className="mt-8">
          <SettingsForm settings={settings} />
        </div>
      )}
    </main>
  );
}
