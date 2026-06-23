/**
 * /keytags — main keytag operations dashboard.
 *
 * Server Component: gates auth via requireAdmin, then composes the
 * KeytagsTabs (client) with each tab content as a child prop.
 *
 * Phase C.4 — Live + Manual Reviews + Audit History tabs are real
 * (wired to orchestrator MCP tools); Assign/Release + Posted/Revert +
 * Reconcile tabs are stubs (Phase C.5 + C.6).
 *
 * force-dynamic so search-param-driven audit filters re-fetch on every
 * navigation. The other tabs don't have heavy reads, so the additional
 * RSC work is fine.
 */
import { requireAdmin } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { KeytagsTabs } from "@/components/keytag/KeytagsTabs";
import { DashboardTab } from "@/components/keytag/DashboardTab";
import { LiveBoardTab } from "@/components/keytag/LiveBoardTab";
import { AuditHistoryTab } from "@/components/keytag/AuditHistoryTab";
import { ManualReviewsTab } from "@/components/keytag/ManualReviewsTab";
import { PostedRevertTab } from "@/components/keytag/PostedRevertTab";
import { ReconcileTab } from "@/components/keytag/ReconcileTab";

export const dynamic = "force-dynamic";

export interface KeytagsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function KeytagsPage({ searchParams }: KeytagsPageProps) {
  const { email } = await requireAdmin();
  const params = await searchParams;
  const defaultTab =
    typeof params.tab === "string" &&
    [
      "dashboard",
      "live",
      "posted-revert",
      "reconcile",
      "manual-reviews",
      "audit",
    ].includes(params.tab)
      ? params.tab
      : "dashboard";

  return (
    <AppShell email={email}>
      <PageHeader
        eyebrow="Operations"
        title="Key tags"
        description="Key tag management"
      />

      <KeytagsTabs
        defaultValue={defaultTab}
        dashboard={<DashboardTab actorEmail={email} />}
        live={<LiveBoardTab actorEmail={email} />}
        postedRevert={<PostedRevertTab />}
        reconcile={<ReconcileTab />}
        manualReviews={<ManualReviewsTab actorEmail={email} searchParams={params} />}
        auditHistory={<AuditHistoryTab actorEmail={email} searchParams={params} />}
      />
    </AppShell>
  );
}
