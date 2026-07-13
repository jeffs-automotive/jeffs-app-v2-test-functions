/**
 * Route skeleton for /payroll/employees/[id]/pto — mirrors the page shape
 * (header + back row + balance strip + ledger table) while the RSC streams.
 * Presentational Next.js convention file; no functional wiring.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function PtoActivityLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Skeleton className="mt-4 h-5 w-36" />
      <Skeleton className="mt-4 h-16 w-full rounded-lg" />

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="mt-px h-12 w-full rounded-none" />
        ))}
      </div>
    </main>
  );
}
