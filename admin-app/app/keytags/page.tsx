/**
 * /keytags — main keytag operations dashboard.
 *
 * Server Component: gates auth via requireAdmin, then composes the
 * KeytagsTabs (client) with each tab content as a child prop.
 *
 * force-dynamic so search-param-driven audit filters re-fetch on every
 * navigation.
 *
 * Tabs are wrapped in per-tab <Suspense> so a slow tab's data fetch can't block
 * the whole action re-render (the 2026-06-25 board-spin fix) — EXCEPT the Live
 * tab. Every Server Action re-renders this force-dynamic route (Flight); a
 * Suspense fallback on the Live tab unmounts its subtree, and that tab hosts the
 * Pattern-A confirmation forms (force-assign / release / per-row). Unmounting
 * resets their useActionState + destroys the open ConfirmationDialog and its
 * already-issued token before the user can Confirm — the B1 regression
 * (force-assign tokens issued but never consumed, 2026-06-24+). So the Live tab
 * renders DIRECTLY (reconcile-in-place keeps the form state alive); its reads are
 * fast DB lookups, so the brief in-place re-render is fine. The other tabs either
 * don't suspend (PostedRevert is sync) or host no Pattern-A dialog, so their
 * Suspense is harmless. See docs/keytag/keytag-audit-fixes-plan.md (B1).
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
        live={<LiveBoardTab actorEmail={email} />}
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
