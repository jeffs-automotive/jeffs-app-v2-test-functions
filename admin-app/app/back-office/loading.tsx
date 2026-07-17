/**
 * /back-office loading skeleton. Next App Router auto-wraps page.tsx in a <Suspense> with
 * this fallback while the RSC awaits requireAdmin() + the queue read. Uses AppShellSkeleton
 * so the TopNav frame is present during streaming (matches the sibling routes' convention).
 */
import { AppShellSkeleton, TableSkeleton } from "@/components/shell/AppShellSkeleton";

export default function BackOfficeLoading() {
  return (
    <AppShellSkeleton>
      <TableSkeleton rows={6} />
    </AppShellSkeleton>
  );
}
