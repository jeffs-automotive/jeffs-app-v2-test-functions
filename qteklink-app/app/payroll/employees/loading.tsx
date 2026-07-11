/**
 * Route skeleton for /payroll/employees — mirrors the page shape (header +
 * back row + intro band + roster cards + add form) while the RSC streams.
 * Presentational Next.js convention file; no functional wiring.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function PayrollEmployeesLoading() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-28" />
      </div>

      <Skeleton className="mt-4 h-16 w-full rounded-lg" />

      <div className="mt-8 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>

      <Skeleton className="mt-6 h-40 w-full rounded-lg" />
    </main>
  );
}
