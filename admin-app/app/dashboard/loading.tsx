/**
 * /dashboard loading skeleton. Next App Router auto-wraps page.tsx in a
 * <Suspense> with this as the fallback, shown while the RSC awaits
 * requireAdmin() on navigation. Pure presentation — no auth, no fetch.
 */
import { AppShellSkeleton, CardSkeleton } from "@/components/shell/AppShellSkeleton";

export default function DashboardLoading() {
  return (
    <AppShellSkeleton>
      <section className="grid gap-6 sm:grid-cols-2">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={3} />
      </section>
    </AppShellSkeleton>
  );
}
