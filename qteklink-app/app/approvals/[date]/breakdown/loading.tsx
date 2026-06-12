/**
 * Route skeleton for /approvals/[date]/breakdown — header + explainer + tab nav
 * + a content table. Presentational Next.js convention file.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function BreakdownLoading() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-40" />
      </div>

      <Skeleton className="mt-4 h-16 w-full rounded-lg" />

      <div className="mt-6 flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-md" />
        ))}
      </div>

      <Skeleton className="mt-6 h-64 w-full rounded-lg" />
    </main>
  );
}
