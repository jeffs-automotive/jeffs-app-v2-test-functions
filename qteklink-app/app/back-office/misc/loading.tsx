import { Skeleton } from "@/components/ui/skeleton";

/** Loading skeleton mirroring the misc page shape (header + add + table). */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-7 w-16" />
      </div>
      <div className="overflow-hidden rounded-lg border border-border shadow-xs">
        <Skeleton className="h-10 w-full rounded-none" />
        <div className="divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-3 py-2.5">
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
