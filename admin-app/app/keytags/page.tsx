/**
 * /keytags — main keytag operations dashboard.
 *
 * Server Component: gates auth via requireAdmin, then composes the
 * KeytagsTabs (client) with each tab content as a child prop.
 *
 * force-dynamic so search-param-driven audit filters re-fetch on every
 * navigation.
 *
 * IMPORTANT (2026-06-25 board-spin fix): each tab is wrapped in its own
 * <Suspense> boundary. A Server Action re-renders this whole route tree (Flight),
 * and without Suspense a slow tab's data fetch (historically DashboardTab's
 * dashboard call) blocked the entire action response → the board buttons "spun"
 * for the duration. Per-tab Suspense lets the action's re-render stream the
 * shell immediately and resolve each tab independently, so one slow tab can
 * never pin a mutation's isPending.
 */
import { Suspense } from "react";
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

function TabLoading() {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className="size-2 animate-pulse rounded-full bg-amber-400"
        />
        Loading…
      </span>
    </div>
  );
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

  const buildSha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7);

  return (
    <AppShell email={email}>
      <PageHeader
        eyebrow="Operations"
        title="Key tags"
        description="Key tag management"
      />

      <KeytagsTabs
        defaultValue={defaultTab}
        dashboard={
          <Suspense fallback={<TabLoading />}>
            <DashboardTab actorEmail={email} />
          </Suspense>
        }
        live={
          <Suspense fallback={<TabLoading />}>
            <LiveBoardTab actorEmail={email} />
          </Suspense>
        }
        postedRevert={
          <Suspense fallback={<TabLoading />}>
            <PostedRevertTab />
          </Suspense>
        }
        reconcile={
          <Suspense fallback={<TabLoading />}>
            <ReconcileTab />
          </Suspense>
        }
        manualReviews={
          <Suspense fallback={<TabLoading />}>
            <ManualReviewsTab actorEmail={email} searchParams={params} />
          </Suspense>
        }
        auditHistory={
          <Suspense fallback={<TabLoading />}>
            <AuditHistoryTab actorEmail={email} searchParams={params} />
          </Suspense>
        }
      />

      {/* Deploy verification marker — read this on-screen and compare to the
          merged commit to confirm which build you're actually running. */}
      <p className="mt-8 text-[10px] tabular-nums tracking-wide text-muted-foreground/50">
        BUILD {buildSha || "local"}
      </p>
    </AppShell>
  );
}
