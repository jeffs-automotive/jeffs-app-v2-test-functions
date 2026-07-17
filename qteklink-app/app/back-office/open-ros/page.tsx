export const dynamic = "force-dynamic";

import { requireQtekUser } from "@/lib/auth";
import { getBackOfficeSettings, listActiveIssues } from "@/lib/dal/back-office";
import { PageHeader } from "@/components/PageHeader";
import { IssueTable } from "@/components/back-office/IssueTable";
import { AddInvoiceDialog } from "@/components/back-office/AddInvoiceDialog";
import AutoRefresh from "@/components/AutoRefresh";

export default async function OpenRosPage() {
  const { shopId } = await requireQtekUser();
  const [{ settings }, issues] = await Promise.all([
    getBackOfficeSettings(shopId),
    listActiveIssues(shopId, "open_ro"),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-6 py-12">
      <AutoRefresh />
      <PageHeader
        title="Invoices with open ROs"
        description="Tracked until the RO closes — you'll get a nudge to verify when it does."
      >
        <AddInvoiceDialog kind="open_ro" fallbackAdminEmail={settings.fallbackAdminEmail} />
      </PageHeader>
      <IssueTable issues={issues} kind="open_ro" staleHours={settings.staleHours} />
    </main>
  );
}
