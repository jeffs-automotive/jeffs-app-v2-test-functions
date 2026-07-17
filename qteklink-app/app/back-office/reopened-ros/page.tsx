export const dynamic = "force-dynamic";

import { requireQtekUser } from "@/lib/auth";
import { getBackOfficeSettings, listActiveIssues } from "@/lib/dal/back-office";
import { PageHeader } from "@/components/PageHeader";
import { IssueTable } from "@/components/back-office/IssueTable";
import AutoRefresh from "@/components/AutoRefresh";

export default async function ReopenedRosPage() {
  const { shopId } = await requireQtekUser();
  const [{ settings }, issues] = await Promise.all([
    getBackOfficeSettings(shopId),
    listActiveIssues(shopId, "reopened_ro"),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-6 py-12">
      <AutoRefresh />
      <PageHeader
        title="Reopened repair orders"
        description="Posted ROs that were unposted or reposted with a different date or total. Added automatically."
      />
      <IssueTable issues={issues} kind="reopened_ro" staleHours={settings.staleHours} />
    </main>
  );
}
