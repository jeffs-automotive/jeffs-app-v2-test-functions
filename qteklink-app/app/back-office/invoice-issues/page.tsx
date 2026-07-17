export const dynamic = "force-dynamic";

import { requireQtekUser } from "@/lib/auth";
import { getBackOfficeSettings, listActiveIssues } from "@/lib/dal/back-office";
import { PageHeader } from "@/components/PageHeader";
import { IssueTable } from "@/components/back-office/IssueTable";
import { AddInvoiceDialog } from "@/components/back-office/AddInvoiceDialog";
import AutoRefresh from "@/components/AutoRefresh";

export default async function InvoiceIssuesPage() {
  const { shopId } = await requireQtekUser();
  const [{ settings }, issues] = await Promise.all([
    getBackOfficeSettings(shopId),
    listActiveIssues(shopId, "invoice_issue"),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <AutoRefresh />
      <PageHeader title="Invoice issues" description="Vendor invoices with a problem to fix.">
        <AddInvoiceDialog kind="invoice_issue" fallbackAdminEmail={settings.fallbackAdminEmail} />
      </PageHeader>
      <IssueTable issues={issues} kind="invoice_issue" staleHours={settings.staleHours} />
    </main>
  );
}
