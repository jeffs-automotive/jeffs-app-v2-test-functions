/**
 * Route skeleton for /payroll/settings — mirrors the page shape (header + back
 * row + explainer band + spiff-grid card + PTO tiers card + alert-emails card +
 * anchor card) while the RSC streams. Presentational Next.js convention file;
 * no functional wiring.
 */
import { Skeleton } from "@/components/ui/skeleton";

export default function PayrollSettingsLoading() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>

      <Skeleton className="mt-4 h-4 w-32" />
      <Skeleton className="mt-4 h-16 w-full rounded-lg" />

      {/* Spiff categories card: search + three-column grid of rows */}
      <div className="mt-6 space-y-3 rounded-xl p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-8 w-full" />
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <Skeleton className="h-8 w-44" />
      </div>

      {/* PTO accrual tiers card: a few tier rows + rollover cap + save */}
      <div className="mt-6 space-y-3 rounded-xl p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-64" />
        ))}
        <Skeleton className="h-8 w-32" />
      </div>

      {/* Alert-emails card: four chip lists */}
      <Skeleton className="mt-6 h-72 w-full rounded-xl" />
      <Skeleton className="mt-6 h-36 w-full rounded-xl" />
    </main>
  );
}
