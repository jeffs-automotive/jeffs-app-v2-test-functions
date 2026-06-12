/**
 * /schedulerconfig loading skeleton. The page RSC awaits requireAdmin() +
 * 10 parallel recent-uploads reads; Next streams this fallback meanwhile
 * (auto <Suspense> via loading.tsx). Pure presentation — no auth, no fetch.
 */
import {
  AppShellSkeleton,
  TabStripSkeleton,
  CardSkeleton,
} from "@/components/shell/AppShellSkeleton";

export default function SchedulerConfigLoading() {
  return (
    <AppShellSkeleton>
      <div className="space-y-6">
        {/* 10 scheduler-config tabs */}
        <TabStripSkeleton count={10} />
        <div className="space-y-6">
          <CardSkeleton lines={1} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </AppShellSkeleton>
  );
}
