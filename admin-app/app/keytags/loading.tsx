/**
 * /keytags loading skeleton. The route is force-dynamic and the page RSC
 * awaits requireAdmin() + the live-state orchestrator read; Next streams
 * this fallback meanwhile (auto <Suspense> via loading.tsx). Pure
 * presentation — no auth, no fetch.
 */
import {
  AppShellSkeleton,
  TabStripSkeleton,
  CardSkeleton,
  TableSkeleton,
} from "@/components/shell/AppShellSkeleton";

export default function KeytagsLoading() {
  return (
    <AppShellSkeleton>
      <div className="space-y-6">
        {/* 6 keytag tabs */}
        <TabStripSkeleton count={6} />
        <div className="space-y-6">
          <CardSkeleton lines={2} />
          <TableSkeleton rows={6} />
        </div>
      </div>
    </AppShellSkeleton>
  );
}
