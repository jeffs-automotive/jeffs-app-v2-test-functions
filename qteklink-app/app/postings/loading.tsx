/**
 * Route skeleton for /postings — header + explainer + a few queue-row cards.
 * Presentational Next.js convention file; no functional wiring.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function PostingsLoading() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Skeleton className="mt-6 h-40 w-full rounded-lg" />

      <div className="mt-6 flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>

      <div className="mt-3 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </main>
  );
}
