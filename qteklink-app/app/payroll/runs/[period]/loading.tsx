/**
 * Route skeleton for /payroll/runs/[period] — mirrors the page shape (header +
 * status/action cluster + data band + bonus band + tabs + entry-grid rows)
 * while the RSC streams the run computation. Presentational convention file.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function RunDetailLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-8 w-36 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-5 w-20 rounded-4xl" />
          <Skeleton className="h-8 w-32 rounded-lg" />
          <Skeleton className="h-8 w-44 rounded-lg" />
        </div>
      </div>

      <Skeleton className="mt-4 h-9 w-96 max-w-full rounded-lg" />
      <Skeleton className="mt-4 h-14 w-full rounded-lg" />

      <div className="mt-6 flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-md" />
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="mt-px h-12 w-full rounded-none" />
        ))}
      </div>
    </main>
  );
}
