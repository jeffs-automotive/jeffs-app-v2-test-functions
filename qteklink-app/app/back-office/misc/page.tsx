export const dynamic = "force-dynamic";

import { requireQtekUser } from "@/lib/auth";
import { getBackOfficeSettings, listActiveIssues } from "@/lib/dal/back-office";
import { PageHeader } from "@/components/PageHeader";
import { IssueTable } from "@/components/back-office/IssueTable";
import { AddMiscDialog } from "@/components/back-office/AddMiscDialog";
import AutoRefresh from "@/components/AutoRefresh";

export default async function MiscPage() {
  const { shopId } = await requireQtekUser();
  const [{ settings }, issues] = await Promise.all([
    getBackOfficeSettings(shopId),
    listActiveIssues(shopId, "misc"),
  ]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-6 py-12">
      <AutoRefresh />
      <PageHeader title="Misc issues" description="One-off issues to send to the service advisors.">
        <AddMiscDialog />
      </PageHeader>
      <IssueTable issues={issues} kind="misc" staleHours={settings.staleHours} />
    </main>
  );
}
