/**
 * Route skeleton for /payroll — mirrors the page shape (header + intro band +
 * employees card + runs card) while the RSC streams. Presentational Next.js
 * convention file; no functional wiring. Modeled on app/approvals/loading.tsx.
 */
import { Skeleton } from "@/components/ui/skeleton";

function TableCardSkeleton({ rows }: { rows: number }) {
  return (
    <div className="mt-8 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-5 w-20 rounded-4xl" />
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function PayrollLoading() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-56" />
      </div>

      <Skeleton className="mt-4 h-16 w-full rounded-lg" />

      <TableCardSkeleton rows={6} />
      <TableCardSkeleton rows={6} />
    </main>
  );
}
