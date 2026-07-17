export const dynamic = "force-dynamic";

import { requireQtekUser } from "@/lib/auth";
import { getBackOfficeSettings } from "@/lib/dal/back-office";
import { PageHeader } from "@/components/PageHeader";
import { SettingsForm } from "@/components/back-office/SettingsForm";

export default async function BackOfficeSettingsPage() {
  const { shopId, role } = await requireQtekUser();
  const { settings } = await getBackOfficeSettings(shopId);

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <PageHeader title="Back office settings" description="Who gets which alert, and when an issue counts as stale." />
      <SettingsForm settings={settings} canEdit={role === "admin"} />
    </main>
  );
}
