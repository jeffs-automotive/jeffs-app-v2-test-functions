import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading skeleton for the SA fix-it queue. Mirrors the page's content shape (header +
 * a queue table). Rendered inside the AppShell frame by Next's loading convention.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-8 space-y-3 border-b border-border pb-6">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-36" />
        <div className="overflow-hidden rounded-lg border border-border shadow-xs">
          <Skeleton className="h-10 w-full rounded-none" />
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-3 py-2.5">
                <Skeleton className="h-4 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
