/**
 * Route skeleton for /approvals — mirrors the page shape (header + info banner +
 * date nav + KPI row + snapshot table) while the RSC streams. Presentational
 * Next.js convention file; no functional wiring.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function ApprovalsLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Skeleton className="mt-4 h-20 w-full rounded-lg" />

      <div className="mt-6 flex items-center justify-center gap-3">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-8 w-36 rounded-lg" />
        <Skeleton className="size-8 rounded-lg" />
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>

      <Skeleton className="mt-6 h-44 w-full rounded-lg" />
    </main>
  );
}
