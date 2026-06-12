/**
 * Route skeleton for /approvals/review — header + explainer + the two admin
 * forms + the open-items list. Presentational Next.js convention file.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewLoading() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Skeleton className="mt-4 h-20 w-full rounded-lg" />

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>

      <Skeleton className="mt-8 h-48 w-full rounded-xl" />
    </main>
  );
}
