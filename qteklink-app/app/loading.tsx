/**
 * Route skeleton for `/` (the module directory) — mirrors the page shape
 * (header + Modules eyebrow + two module cards) while the RSC awaits the
 * live-status hints. Presentational Next.js convention file; no functional
 * wiring. Modeled on app/payroll/loading.tsx per the design spec's
 * Addendum-2 states table.
 */
import { Skeleton } from "@/components/ui/skeleton";

function ModuleCardSkeleton() {
  return (
    <div className="rounded-xl bg-card p-6 shadow-xs ring-1 ring-foreground/10">
      <Skeleton className="size-10 rounded-lg" />
      <Skeleton className="mt-4 h-6 w-32" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-1 h-4 w-3/4" />
      <Skeleton className="mt-4 h-3 w-40" />
    </div>
  );
}

export default function ModuleDirectoryLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Skeleton className="mt-8 h-3 w-20" />

      <div className="mt-2 grid gap-6 sm:grid-cols-2">
        <ModuleCardSkeleton />
        <ModuleCardSkeleton />
      </div>
    </main>
  );
}
