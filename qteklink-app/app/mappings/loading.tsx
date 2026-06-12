/**
 * Route skeleton for /mappings — header + explainer + count card + payment
 * methods table + current-mappings list. Presentational Next.js convention file.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function MappingsLoading() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Skeleton className="mt-4 h-16 w-full rounded-lg" />
      <Skeleton className="mt-8 h-24 w-full rounded-xl" />
      <Skeleton className="mt-8 h-56 w-full rounded-xl" />
      <Skeleton className="mt-8 h-48 w-full rounded-xl" />
    </main>
  );
}
