export const dynamic = "force-dynamic";

import { requireQtekUser } from "@/lib/auth";
import { getBackOfficeSettings } from "@/lib/dal/back-office";
import { PageHeader } from "@/components/PageHeader";
import { SettingsForm } from "@/components/back-office/SettingsForm";

export default async function BackOfficeSettingsPage() {
  const { shopId, role } = await requireQtekUser();
  const { settings } = await getBackOfficeSettings(shopId);

  return (
    <main className="w-full space-y-4 px-6 py-12">
      <PageHeader title="Back office settings" description="Who gets which alert, and when an issue counts as stale." />
      {/* Page chrome is full-width like the rest of the module; the form itself stays capped so inputs remain readable. */}
      <div className="max-w-3xl space-y-4">
        <SettingsForm settings={settings} canEdit={role === "admin"} />
      </div>
    </main>
  );
}
