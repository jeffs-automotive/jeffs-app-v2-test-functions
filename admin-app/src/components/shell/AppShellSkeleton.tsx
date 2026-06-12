/**
 * AppShellSkeleton — presentational loading chrome for route-level
 * `loading.tsx` files. Mirrors AppShell's geometry (sticky top bar + the
 * `max-w-7xl` main gutter) so the skeleton lands in the same place the real
 * page will, then swaps in with no layout shift.
 *
 * Pure presentation: NO auth, NO data, NO TopNav/Toaster (the real ones
 * mount with the page). It renders only Skeleton blocks + static chrome.
 * The top bar reproduces the brand chip + nav silhouette so the bar doesn't
 * flash empty while the page streams.
 */
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

function TopBarSkeleton() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border bg-background/95 shadow-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/80 ring-1 ring-brand-gold/40">
          <span className="text-xs font-bold text-primary-foreground">J</span>
        </div>
        <Skeleton className="hidden h-4 w-32 sm:block" />
        <div className="ml-2 flex flex-1 items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
        <Skeleton className="h-7 w-7 rounded-md" />
        <Skeleton className="h-8 w-20" />
      </div>
    </header>
  );
}

function PageHeaderSkeleton() {
  return (
    <div className="mb-8 flex flex-col gap-3 border-b border-border pb-6">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-72" />
    </div>
  );
}

export function AppShellSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <TopBarSkeleton />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageHeaderSkeleton />
        {children}
      </main>
    </div>
  );
}

/** A row of `count` tab-chip skeletons, matching the line-variant tab strips. */
export function TabStripSkeleton({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap gap-x-1 border-b border-border pb-2">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-7 w-24" />
      ))}
    </div>
  );
}

/** A card-shaped skeleton block matching the Card primitive geometry. */
export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-xs ring-1 ring-foreground/10">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  );
}

/** A table skeleton: a header bar + `rows` body rows. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border bg-muted/40 px-2 py-2.5">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-2 py-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
